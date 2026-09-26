//! 인스턴스 기록 — 지금 떠 있는 아틀리에 실행 하나가 디스크에 적어 두는 한 장(프로세스 결정 6 · 프로세스 스펙 S8).
//!
//! **dev 빌드와 설치본이 함께 떠도 서로의 셸을 고아로 오판하지 않게 하는 장치다.** 셸이 자손에게 물려주는 표식(셸 키
//! `<세대>-<번호>`)만으로는 그 셸이 아직 있는지 모른다 — 키를 낸 실행이 살아 있는지, 그 실행이 그 셸을 아직 쥐고
//! 있는지는 그 실행만 안다. 그래서 실행마다 자기 셸 키 목록을 `<데이터 루트>/instances/<세대>.json`에 적어 두고, 판정은
//! 그 기록들로 확정 고아 · 출처 불명 · 다른 인스턴스를 가른다(`verdict`). 두 빌드는 기본으로 같은 데이터 루트를 써 서로의
//! 기록을 본다. `ATELIER_HOME`을 준 경우에만 갈리고, 그때 상대 셸의 자손은 출처 불명이 된다 — 자동으로는 안 건드리니
//! 안전한 쪽이다.
//!
//! **올리기는 앞, 내리기는 뒤다**(프로세스 스펙 S52). 셸 키는 발급될 때(자식을 띄우기 **전**) 올리고, 띄우기에 실패하면
//! 내린다. 셸이 풀에서 빠지면 그 셸의 끝내기가 끝난 **뒤에** 내린다. 기록에 없는 키의 프로세스가 한순간이라도 살아 있으면
//! 다른 실행의 정리가 그것을 확정 고아로 본다 — 막 뜬 셸의 자손을, 닫히는 중인 셸의 유예 중인 자손을.
//!
//! **쓰기는 한 뮤텍스 안에서 「목록 고치기 → 파일 쓰기」다.** 키를 고치는 자리가 둘이다 — 셸 띄우기(명령 스레드)와 뒤로
//! 보낸 끝내기(셸 닫기 · 새로고침 · 셸 스스로 끝남의 뒤 스레드). 셸이 스스로 끝나면 예전에는 리더 스레드가 곧바로 내렸지만,
//! 이제 그 셸의 끝내기가 끝난 뒤에 내린다(티켓 13). 목록을 읽은 뒤 잠금 밖에서 쓰면 먼저 읽은 쪽의 늦은 쓰기가 이겨 막 올린
//! 키가 디스크에서 사라진다. 앱에 기록은 하나(풀이 쥔다, `pty::PtyPool`)라 이 뮤텍스가 곧 프로세스 전역이다. 파일은
//! 코어의 원자 쓰기로 통째 바꿔 넣는다 — 다른 실행이 아무 때나 읽기 때문이다. 코어는 잠그지 않는다: 이 파일을 쓰는
//! 프로세스는 이 실행 하나뿐이다.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

use super::cleanup_log::{self, Event};
use super::clock;
use super::ending::Outcome;
use super::verdict::InstanceRecord;
use super::{shell_key, snapshot, Identity};

/// 기록들이 사는 폴더. 루트는 부르는 쪽이 `atelier_core::data_root()`로 준다 — 여기서 `~/.atelier`를 박으면
/// `ATELIER_HOME` 오버라이드가 여기서만 죽는다.
pub fn dir(root: &Path) -> PathBuf {
    root.join("instances")
}

/// 빌드 종류. 판 04의 `Processes`가 「다른 인스턴스」마다 보인다(프로세스 스펙 S8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Build {
    /// `pnpm tauri dev` — 디버그 빌드.
    Dev,
    /// 설치본.
    Release,
}

impl Build {
    pub fn of_this_binary() -> Build {
        if cfg!(debug_assertions) {
            Build::Dev
        } else {
            Build::Release
        }
    }
}

/// 디스크의 기록 한 장. **세대는 파일 이름이다** — 안에 또 적으면 둘이 어긋날 자리가 생긴다.
///
/// 다른 빌드가 같은 모양으로 읽는다. 모르는 칸은 버리고 읽고, 칸이 빠졌으면 깨진 것이다(「기록 없음」).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceFile {
    /// 앱 프로세스의 신원. pid와 시작 시각이 함께 맞아야 그 실행이 살아 있다(프로세스 스펙 S9) — 앱 pid가 재사용되면
    /// pid만으로는 죽은 실행을 살았다고 본다.
    pub app: Identity,
    pub build: Build,
    pub version: String,
    /// 살아 있는 셸 키 — 띄우는 중인 셸과 끝내기가 아직 도는 셸도 든다.
    pub shell_keys: Vec<String>,
    /// 갱신 시각(에포크 µs). 확정 고아 (나)의 조건이다 — 목록에 없는 키를 문 프로세스는 이 시각보다 먼저 태어났을 때만
    /// 확정 고아다(`verdict`).
    pub updated_us: u64,
}

/// 기록을 어디에 누구로 쓰나.
#[derive(Debug, Clone)]
pub struct Place {
    /// `dir(root)`.
    pub dir: PathBuf,
    pub generation: String,
    pub app: Identity,
    pub build: Build,
    pub version: String,
    /// 정리 기록의 자리(`cleanup_log::path(root)`, 티켓 11). 이 실행이 디스크에 쓰는 둘째 장이다 — 쓰기가 인스턴스 기록과 같은
    /// 뮤텍스를 지나야 해서(프로세스 스펙 S12) 같은 자리에서 연다.
    pub log: PathBuf,
}

impl Place {
    /// 이 앱의 자리. **앱의 신원을 못 읽으면 기록을 쓰지 않는다**(`None`) — 시작 시각이 틀린 기록은 다른 실행에게 「죽은
    /// 인스턴스」로 읽혀 이 실행의 셸 자손이 모두 확정 고아가 된다. 기록이 없으면 출처 불명이라 아무도 안 건드린다.
    /// 리눅스는 신원을 안 읽으니(`snapshot::identity_of`) 늘 이 갈래다 — 판정할 스냅샷도 비어 있다.
    pub fn this_app(root: &Path, generation: &str, version: &str) -> Option<Place> {
        let app = snapshot::identity_of(std::process::id())?;
        Some(Place {
            dir: dir(root),
            generation: generation.to_string(),
            app,
            build: Build::of_this_binary(),
            version: version.to_string(),
            log: cleanup_log::path(root),
        })
    }

    fn file_name(&self) -> String {
        format!("{}.json", self.generation)
    }
}

/// 이 실행의 인스턴스 기록 — 셸 키 목록과 그것을 쓰는 뮤텍스. 앱에 하나이고 풀이 쥔다(`pty::PtyPool`).
///
/// **열기 전에는 목록만 든다**(`Default`). 앱은 setup에서 연다(`pty::open_record`). 검사가 세우는 풀은 안 열어 아무
/// 파일도 안 쓴다 — 진짜 데이터 루트를 안 건드린다.
#[derive(Default)]
pub struct Record {
    book: Mutex<Book>,
}

#[derive(Default)]
struct Book {
    /// `None`이면 아직 안 열었거나 이미 닫았다 — 목록은 고치되 파일은 안 쓴다.
    place: Option<Place>,
    /// 정리 기록의 자리. 열 때 서고 **닫아도 남는다** — 앱 종료가 기록을 닫은 뒤에도 그 종료의 사건과 늦게 끝난 뒤 스레드의
    /// 사건을 적는다. 안 열었으면 `None`이라 아무 사건도 안 쓴다(검사가 세우는 풀, 앱 신원을 못 읽은 실행).
    log: Option<PathBuf>,
    keys: BTreeSet<String>,
    /// 마지막으로 목록을 쓴 시각(에포크 µs). 판정이 이 실행의 확정 고아 (나)를 가를 때 쓴다.
    updated_us: u64,
}

impl Record {
    /// 잠금이 오염됐다는 것은 다른 스레드가 쓰다 패닉했다는 뜻이다. 목록은 그래도 맞다 — 안을 꺼내 이어 간다.
    fn lock(&self) -> MutexGuard<'_, Book> {
        self.book.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 기록을 열고 곧바로 쓴다 — **앱이 뜰 때**, 시작 정리(티켓 10)보다 먼저. 열기 전에 올린 키도 함께 적힌다.
    pub fn open(&self, place: Place) {
        let mut book = self.lock();
        book.log = Some(place.log.clone());
        book.place = Some(place);
        book.write();
    }

    /// **정리 기록에 사건 하나를 더한다**(티켓 11 · 프로세스 스펙 S12) — 이 기록의 뮤텍스 안에서 읽고 더하고 쓴다. 쓰는 자리가
    /// 여럿이라(셸 닫기 · 새로고침의 뒤 스레드, 앱 종료, 시작 정리) 잠금 밖에서 읽고 쓰면 늦은 쓰기가 다른 쪽 사건을 지운다.
    /// 인스턴스 기록과 같은 뮤텍스인 것은 스펙이 정한 것이다 — 앱에 기록은 하나(풀이 쥔다)라 이 잠금이 곧 프로세스 전역이다.
    ///
    /// 열지 않았으면 쓰지 않는다. 닫은 뒤에는 쓴다(`Book::log`).
    pub fn log(&self, event: Event) {
        let book = self.lock();
        if let Some(path) = &book.log {
            cleanup_log::add(path, event);
        }
    }

    /// **정리 기록 전부** — 새것부터(티켓 29의 요약이 `●`의 머리 id를 여기서 고른다). 열지 않았으면 빈 기록이다(검사의 풀은 진짜
    /// 데이터 루트를 안 읽는다).
    ///
    /// 읽기는 잠금 밖이다 — 쓰기가 원자적 바꿔 넣기라 잠금 없이 읽어도 온전한 한 장을 본다(`cleanup_log::add`). 쥔 채 읽으면 그동안
    /// 셸 띄우기의 키 올리기가 기다린다.
    pub fn events(&self) -> Vec<Event> {
        let path = self.lock().log.clone();
        path.map(|path| cleanup_log::read(&path)).unwrap_or_default()
    }

    /// 셸 키를 올린다 — **자식을 띄우기 전에**(프로세스 스펙 S52).
    pub fn raise(&self, key: &str) {
        let mut book = self.lock();
        if book.keys.insert(key.to_string()) {
            book.write();
        }
    }

    /// 셸 키들을 내린다 — 그 셸의 끝내기가 끝난 **뒤에**, 또는 띄우기에 실패했을 때. 여럿을 한 번에 쓴다(새로고침은 셸을
    /// 통째로 닫는다). 목록에 없는 키면 쓰지 않는다.
    pub fn lower<'k>(&self, keys: impl IntoIterator<Item = &'k str>) {
        let mut book = self.lock();
        let mut changed = false;
        for key in keys {
            changed |= book.keys.remove(key);
        }
        if changed {
            book.write();
        }
    }

    /// **정상 종료** — 끝내기가 끝난 뒤에 부른다. 「못 끝냄」이 없으면 기록을 지우고, 있으면 남긴다: 다음 실행의 시작
    /// 정리가 이 기록을 「죽은 인스턴스」로 읽어 한 번 더 해 본다. 어느 쪽이든 **닫는다** — 뒤 스레드의 끝내기가 늦게
    /// 끝나 키를 내려도 지운 파일을 되살리거나 남긴 파일을 고치지 않는다.
    pub fn close(&self, outcomes: &[(Identity, Outcome)]) {
        let mut book = self.lock();
        let Some(place) = book.place.take() else {
            return;
        };
        if outcomes.iter().any(|(_, outcome)| *outcome == Outcome::Survived) {
            return;
        }
        let path = place.dir.join(place.file_name());
        if let Err(e) = std::fs::remove_file(&path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                eprintln!("atelier: instance record remove failed ({}): {e}", path.display());
            }
        }
    }

    /// **죽은 실행의 기록을 지운다** — 시작 정리가 그 실행이 남긴 확정 고아를 끝낸 뒤에(프로세스 스펙 「인스턴스 기록 › 지우는
    /// 때」). 그래도 남은 것(못 끝냄)은 다음부터 출처 불명이 되어 자동으로는 아무도 안 건드린다 — 안전한 쪽이다.
    ///
    /// 죽었는지는 부르는 쪽이 가른다(`pty::carry_out`). **이 실행의 기록은 넘겨받아도 안 지운다** — 지우면 이 실행의 셸
    /// 자손이 다른 실행에게 출처 불명이 된다. 열지 않았거나 이미 닫았으면 어디를 지울지 몰라 아무것도 안 한다.
    pub fn forget<'g>(&self, generations: impl IntoIterator<Item = &'g str>) {
        let book = self.lock();
        let Some(place) = &book.place else {
            return;
        };
        for generation in generations.into_iter().filter(|generation| *generation != place.generation) {
            let path = place.dir.join(format!("{generation}.json"));
            if let Err(e) = std::fs::remove_file(&path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    eprintln!("atelier: dead instance record remove failed ({}): {e}", path.display());
                }
            }
        }
    }

    /// **한 세대의 기록 한 장** — 디스크에서(티켓 31). `Processes`의 「다른 인스턴스」가 실행마다 빌드 종류와 버전을 보인다(프로세스
    /// 스펙 S54) — 판정의 기록(`records`)은 그 두 칸을 안 싣는다(판정이 안 읽어서다). 없거나 깨졌으면 `None`이다(`read`).
    ///
    /// 열지 않은 기록은 어디를 읽을지 몰라 늘 `None`이다. 읽기는 잠금 밖이다(`events`와 같은 까닭).
    pub fn file(&self, generation: &str) -> Option<InstanceFile> {
        let dir = self.lock().place.as_ref().map(|place| place.dir.clone())?;
        read(&dir, generation)
    }

    /// 판정에 줄 기록들 — 이 실행의 것은 **메모리에서**, 남의 것은 디스크에서. 제 파일은 쓰기가 실패했으면 낡았을 수 있고,
    /// 판정이 이 실행의 셸 목록을 여기서 읽는다. **스냅샷을 찍은 뒤에** 부른다(프로세스 스펙 S52) — 그 사이 뜬 셸의
    /// 키가 여기 이미 있다.
    ///
    /// 열지 않은 기록은 아무것도 안 준다 — 어디를 읽을지 모르고, 이 실행 자신을 적을 신원도 없다. 그러면 판정은 이 세대의
    /// 목록 밖 키를 어느 묶음에도 안 넣고 남의 키는 모두 출처 불명으로 본다(자동으로 끝내는 것이 없다).
    pub fn records(&self) -> Vec<InstanceRecord> {
        let (own, dir) = {
            let book = self.lock();
            let Some(place) = &book.place else {
                return Vec::new();
            };
            let own = InstanceRecord {
                generation: place.generation.clone(),
                app: place.app,
                shell_keys: book.keys.iter().cloned().collect(),
                updated_us: book.updated_us,
            };
            (own, place.dir.clone())
        };
        let mut records: Vec<InstanceRecord> = read_all(&dir)
            .into_iter()
            .filter(|(generation, _)| *generation != own.generation)
            .map(|(generation, file)| InstanceRecord {
                generation,
                app: file.app,
                shell_keys: file.shell_keys,
                updated_us: file.updated_us,
            })
            .collect();
        records.push(own);
        records
    }
}

impl Book {
    /// 목록을 파일 한 장으로 통째 바꿔 넣는다. **잠금 안에서만 부른다.** 열지 않았으면 갱신 시각만 옮긴다.
    ///
    /// 쓰기가 실패해도 셸 띄우기를 막지 않는다 — 디스크의 기록이 낡을 뿐이고, 낡은 기록에서 새 셸의 자손은 갱신 시각보다
    /// 늦게 태어나 다른 실행에게 「다른 인스턴스」로 읽힌다(확정 고아가 아니다).
    fn write(&mut self) {
        // 프로세스의 커널 시작 시각과 같은 벽시계다 — 확정 고아 (나)가 둘을 견준다(`clock`).
        self.updated_us = clock::now_us().max(self.updated_us + 1);
        let Some(place) = &self.place else {
            return;
        };
        let file = InstanceFile {
            app: place.app,
            build: place.build,
            version: place.version.clone(),
            shell_keys: self.keys.iter().cloned().collect(),
            updated_us: self.updated_us,
        };
        if let Err(e) = atelier_core::write_json_atomically(&place.dir, &place.file_name(), &file, "인스턴스 기록을")
        {
            eprintln!("atelier: instance record write failed ({}): {e}", place.dir.join(place.file_name()).display());
        }
    }
}

/// 그 실행이 **지금** 살아 있나 — 앱 pid가 그 시작 시각 그대로 떠 있다(프로세스 스펙 S9). 표 한 장 없이 그 pid 하나만 본다.
/// pid만 보면 그 pid를 받은 남을 그 실행으로 본다. 리눅스는 신원을 못 읽어 늘 거짓이다(기록도 안 쓴다).
///
/// 판정은 같은 규칙을 스냅샷 값으로 본다(`verdict`의 `Table::alive`) — 판정은 값만 받아서다.
pub fn alive(app: Identity) -> bool {
    snapshot::identity_of(app.pid) == Some(app)
}

/// **살아 있는 실행들의 세대 — 훅 상태 파일 정리가 남길 세대**다(티켓 11 · 프로세스 스펙 S10). 이 실행의 세대
/// (`shell_key::generation`)와, 기록 폴더에서 앱이 지금 떠 있는 다른 실행들의 세대(`alive_generations`).
///
/// 예전 정리는 이 실행의 것 말고 전부 지웠다. dev 빌드와 설치본을 함께 띄우면 한쪽이 뜰 때 다른 쪽 셸의 상태 파일을 지워
/// 그 셸의 띠 상태가 사라졌다. 이제 인스턴스 기록(티켓 09)으로 살아 있는 실행을 가려 그 세대의 파일은 남긴다. 기록이 없는
/// 실행(이 기능 전의 설치본, 리눅스)은 가릴 길이 없어 예전처럼 지운다.
///
/// 이 실행의 기록은 아직 안 열렸을 수 있어(정리는 기록을 열기 전에 돈다) 세대를 따로 싣는다. 루트는 부르는 쪽이
/// `atelier_core::data_root()`로 준다.
///
/// 기록 폴더의 살아 있는 세대를 더하는 줄은 `shells.rs`의 `a_sweep_keeps_the_files_of_a_run_whose_instance_record_is_alive`가
/// 앱이 쓰는 길로 잰다(macOS) — 이 줄이 빠지면 정리가 다시 이 실행의 세대만 남긴다.
pub fn live_generations(root: &Path) -> Vec<String> {
    let mut generations = vec![shell_key::generation().to_string()];
    generations.extend(alive_generations(&dir(root)));
    generations
}

/// 폴더의 기록 중 **앱이 지금 떠 있는 것**(`alive`)의 세대. 깨진 기록은 기록이 없는 것과 같다(`read_all`).
fn alive_generations(dir: &Path) -> Vec<String> {
    read_all(dir).into_iter().filter(|(_, file)| alive(file.app)).map(|(generation, _)| generation).collect()
}

/// 한 세대의 기록. **깨졌으면 「기록 없음」이다** — 없는 것과 같게 친다. 그 세대의 셸 자손은 판정에서 출처 불명이 되고,
/// 자동으로는 아무도 안 건드린다.
pub fn read(dir: &Path, generation: &str) -> Option<InstanceFile> {
    let content = std::fs::read_to_string(dir.join(format!("{generation}.json"))).ok()?;
    serde_json::from_str(&content).ok()
}

/// 폴더의 기록 전부 — (세대, 기록). `.json`만 기록이다: 쓰는 중인 tmp는 코어의 원자 쓰기가 `.tmp`로 끝나게 짓는다.
/// 깨진 기록은 **조용히 건너뛴다** — 판정마다 읽으니, 깨진 한 장이 셸을 닫을 때마다 stderr에 줄을 남긴다.
pub fn read_all(dir: &Path) -> Vec<(String, InstanceFile)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut records: Vec<(String, InstanceFile)> = entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            let generation = path.file_stem()?.to_str()?;
            if path.extension()? != "json" {
                return None;
            }
            Some((generation.to_string(), read(dir, generation)?))
        })
        .collect();
    records.sort_by(|a, b| a.0.cmp(&b.0));
    records
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    use super::*;

    /// src-tauri에는 `tempfile`이 없다(`settings.rs`의 같은 도구와 같은 까닭). 검사 이름마다 따로 선 폴더다 — 나란히
    /// 돈다.
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("atelier-instances-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// 검사가 쓰는 자리. 앱 신원은 이 기계의 어떤 실제 프로세스와도 상관없는 값이다 — 이 파일의 검사는 파일만 본다.
    fn place(dir: &Path, generation: &str) -> Place {
        Place {
            dir: dir.to_path_buf(),
            generation: generation.to_string(),
            app: Identity { pid: 4242, started_us: 1_000 },
            build: Build::Dev,
            version: "0.14.1".to_string(),
            // 기록 폴더 안에 둔다 — 검사마다 따로 선 폴더를 한 번에 지운다. `read_all`은 이것을 깨진 기록으로 건너뛴다.
            log: dir.join("cleanup-log.json"),
        }
    }

    fn keys_on_disk(dir: &Path, generation: &str) -> Option<Vec<String>> {
        read(dir, generation).map(|file| file.shell_keys)
    }

    /// **쓰기와 읽기**(프로세스 스펙 S8). 기록을 열면 파일이 서고, 올린 키 · 내린 키가 그대로 디스크에 간다. 파일은
    /// 사람이 열어 볼 수 있는 모양이고, 다른 빌드(dev · 설치본)가 같은 모양으로 읽는다 — 그래서 와이어를 글자로 못박는다.
    #[test]
    fn an_opened_record_is_on_disk_with_the_keys_it_raised() {
        let dir = temp_dir("roundtrip");
        let record = Record::default();
        record.open(place(&dir, "1790000000000"));

        let opened = read(&dir, "1790000000000").expect("기록을 열었는데 파일이 없다");
        assert_eq!(opened.shell_keys, Vec::<String>::new(), "셸이 없는데 키가 있다");
        assert_eq!(opened.app, Identity { pid: 4242, started_us: 1_000 });

        record.raise("1790000000000-1");
        record.raise("1790000000000-0");
        let raised = read(&dir, "1790000000000").expect("파일이 있다");
        assert_eq!(raised.shell_keys, ["1790000000000-0", "1790000000000-1"], "올린 키가 디스크에 없다");
        assert!(raised.updated_us > opened.updated_us, "키를 올렸는데 갱신 시각이 그대로다");

        record.lower(["1790000000000-0"]);
        assert_eq!(keys_on_disk(&dir, "1790000000000"), Some(vec!["1790000000000-1".to_string()]), "내린 키가 남았다");

        let written = std::fs::read_to_string(dir.join("1790000000000.json")).expect("이름이 세대다");
        let value: serde_json::Value = serde_json::from_str(&written).expect("JSON이다");
        assert_eq!(
            value,
            serde_json::json!({
                "app": { "pid": 4242, "startedUs": 1_000 },
                "build": "dev",
                "version": "0.14.1",
                "shellKeys": ["1790000000000-1"],
                "updatedUs": value["updatedUs"],
            }),
            "기록의 모양이 다르다 — 다른 빌드가 못 읽으면 이 실행의 셸 자손이 그쪽에서 출처 불명이 된다"
        );
        assert!(value["updatedUs"].as_u64().is_some_and(|us| us > 0), "갱신 시각이 없다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 앱이 기록을 열기 전에 올린 키도 잃지 않는다 — 열 때 함께 쓴다. 셸 띄우기는 setup 뒤에만 오지만, 순서가 뒤집혀도
    /// 기록에 없는 키의 프로세스가 생기지 않게.
    #[test]
    fn keys_raised_before_the_record_opens_are_written_when_it_opens() {
        let dir = temp_dir("early");
        let record = Record::default();
        record.raise("G-0");
        assert_eq!(keys_on_disk(&dir, "G"), None, "열기 전에 파일을 썼다 — 어디에 쓸지 아직 모른다");
        record.open(place(&dir, "G"));
        assert_eq!(keys_on_disk(&dir, "G"), Some(vec!["G-0".to_string()]), "열기 전에 올린 키를 잃었다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **깨진 기록은 「기록 없음」이다.** 그 세대의 셸 자손은 판정에서 출처 불명이 되고, 자동으로는 아무도 안 건드린다 —
    /// 안전한 쪽이다. 한 장 때문에 다른 기록까지 못 읽으면 살아 있는 다른 실행의 셸이 모두 출처 불명이 된다.
    ///
    /// 앵커: 옆의 멀쩡한 기록은 읽힌다. 쓰는 중인 tmp(점 파일)는 기록이 아니다.
    #[test]
    fn a_broken_record_is_no_record() {
        let dir = temp_dir("broken");
        let good = Record::default();
        good.open(place(&dir, "D"));
        good.raise("D-1");
        std::fs::write(dir.join("OLD.json"), "{\"app\":").unwrap();
        std::fs::write(dir.join("HALF.json"), r#"{"app":{"pid":1,"startedUs":2},"build":"dev"}"#).unwrap();
        std::fs::write(dir.join(".D.json.77.0.tmp"), std::fs::read(dir.join("D.json")).unwrap()).unwrap();
        std::fs::write(dir.join("notes.txt"), "not a record").unwrap();

        assert_eq!(read(&dir, "OLD"), None, "깨진 JSON을 기록으로 읽었다");
        assert_eq!(read(&dir, "HALF"), None, "칸이 빠진 기록을 기록으로 읽었다");
        let all: Vec<String> = read_all(&dir).into_iter().map(|(generation, _)| generation).collect();
        assert_eq!(all, ["D"], "멀쩡한 기록 하나만 읽혀야 한다 — 깨진 것 · tmp · 다른 파일이 섞였거나 멀쩡한 것을 놓쳤다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **원자 쓰기.** 다른 실행의 판정이 이 기록을 아무 때나 읽는다 — 반쯤 쓰인 파일을 읽으면 「기록 없음」이 되어, 살아 있는
    /// 이 실행의 셸 자손이 그쪽에서 출처 불명으로 보인다. 쓰는 동안 옆에서 계속 읽어 한 번도 못 읽는 순간이 없어야 한다.
    /// 쓰기가 끝나면 tmp가 안 남는다.
    #[test]
    fn a_reader_never_sees_a_half_written_record() {
        let dir = temp_dir("atomic");
        let record = Arc::new(Record::default());
        record.open(place(&dir, "G"));
        let done = Arc::new(AtomicBool::new(false));
        let reads = Arc::new(AtomicUsize::new(0));
        let reader = {
            let (dir, done, reads) = (dir.clone(), Arc::clone(&done), Arc::clone(&reads));
            std::thread::spawn(move || {
                let mut broken = 0;
                while !done.load(Ordering::Relaxed) {
                    if read(&dir, "G").is_none() {
                        broken += 1;
                    }
                    reads.fetch_add(1, Ordering::Relaxed);
                }
                broken
            })
        };
        for n in 0..400 {
            // 파일이 자라고 줄어든다 — 길이가 바뀌는 쓰기라야 반쯤 쓰인 순간이 드러난다.
            record.raise(&format!("G-{n}"));
            if n % 3 == 0 {
                record.lower([format!("G-{}", n / 2).as_str()]);
            }
        }
        done.store(true, Ordering::Relaxed);
        let broken = reader.join().expect("읽는 스레드");

        assert!(reads.load(Ordering::Relaxed) > 100, "쓰는 동안 거의 안 읽었다 — 이 검사가 아무것도 안 쟀다");
        assert_eq!(broken, 0, "쓰는 동안 기록을 못 읽은 순간이 있다 — 파일이 반쯤 쓰인 채 보였다");
        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["G.json"], "쓰기가 끝났는데 tmp가 남았다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **두 스레드가 동시에 올리고 내려도 잃지 않는다**(프로세스 스펙 S52). 키를 고치는 자리가 둘이다 — 셸 띄우기(명령 스레드)와
    /// 뒤로 보낸 끝내기(셸 닫기 · 새로고침 · 셸 스스로 끝남). 목록을 읽고 쓰는 사이에 다른 쓰기가 끼면 먼저 읽은 쪽의 늦은 쓰기가 이겨, 막 올린
    /// 키가 디스크에서 사라진다 — 다음 쓰기까지(몇 분일 수 있다) 그 셸의 자손을 다른 실행이 확정 고아로 본다.
    ///
    /// **끝 상태 하나만 보면 못 잡는다**(실측 — 잠금 밖에서 파일을 쓰는 변형이 끝 상태 검사를 세 번 다 통과했다). 잃은
    /// 키는 다음 쓰기가 메모리의 목록으로 되살린다. 쓰는 동안 옆에서 읽는 것도 창을 자주 놓친다(다섯 번 중 둘만 잡았다).
    /// 그래서 **한 차례씩 맞춰 돈다**: 두 스레드가 같은 순간에 하나씩 쓰고, 둘 다 돌아와 아무도 안 쓰는 동안 디스크를 본다.
    /// 그 순간 디스크는 메모리와 같아야 한다.
    #[test]
    fn two_threads_raising_and_lowering_lose_nothing() {
        use std::sync::Barrier;

        const ROUNDS: usize = 150;
        let dir = temp_dir("mutex");
        let record = Arc::new(Record::default());
        record.open(place(&dir, "G"));
        let key = |side: usize, n: usize| format!("G-{side}{n:03}");
        // 차례마다 시작과 끝에서 셋(쓰는 스레드 둘과 이 스레드)이 만난다.
        let turn = Arc::new(Barrier::new(3));
        let writers: Vec<_> = [1, 2]
            .into_iter()
            .map(|side| {
                let (record, turn) = (Arc::clone(&record), Arc::clone(&turn));
                std::thread::spawn(move || {
                    for n in 0..ROUNDS {
                        turn.wait();
                        record.raise(&key(side, n));
                        turn.wait();
                    }
                    for n in 0..ROUNDS {
                        turn.wait();
                        record.lower([key(side, n).as_str()]);
                        turn.wait();
                    }
                })
            })
            .collect();

        let mut wrong = Vec::new();
        let mut look = |what: &str, n: usize, want: Vec<String>| {
            let on_disk = keys_on_disk(&dir, "G").unwrap_or_default();
            if on_disk != want && wrong.len() < 3 {
                wrong.push(format!("{what} {n}차례 뒤 — 기대 {}개, 디스크 {}개", want.len(), on_disk.len()));
            }
        };
        let upto = |from: usize, to: usize| -> Vec<String> {
            let mut keys: Vec<String> = [1, 2].iter().flat_map(|side| (from..to).map(move |n| key(*side, n))).collect();
            keys.sort();
            keys
        };
        for n in 0..ROUNDS {
            turn.wait();
            turn.wait();
            look("올리기", n, upto(0, n + 1));
        }
        for n in 0..ROUNDS {
            turn.wait();
            turn.wait();
            look("내리기", n, upto(n + 1, ROUNDS));
        }
        for writer in writers {
            writer.join().expect("쓰는 스레드");
        }

        assert!(
            wrong.is_empty(),
            "두 스레드가 함께 쓴 뒤 디스크가 메모리와 다르다 — 늦은 쓰기가 다른 쪽의 키를 지웠거나 되살렸다:\n  {}",
            wrong.join("\n  ")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **정상 종료 — 「못 끝냄」이 없으면 기록을 지우고, 있으면 남긴다**(프로세스 스펙 「인스턴스 기록 › 지우는 때」). 남긴
    /// 기록은 다음 실행의 시작 정리가 「죽은 인스턴스」로 읽어 한 번 더 해 본다. 닫은 뒤에는 늦게 온 내리기(뒤 스레드의
    /// 끝내기)가 파일을 되살리지 않는다.
    #[test]
    fn a_normal_exit_removes_the_record_unless_something_survived() {
        let ended = Identity { pid: 11, started_us: 1 };
        let survived = Identity { pid: 12, started_us: 2 };

        let dir = temp_dir("exit-clean");
        let record = Record::default();
        record.open(place(&dir, "G"));
        record.raise("G-0");
        record.close(&[(ended, Outcome::Ended), (survived, Outcome::Forced), (ended, Outcome::Gone)]);
        assert_eq!(keys_on_disk(&dir, "G"), None, "다 끝났는데 기록이 남았다 — 다음 실행이 헛일을 한다");
        record.lower(["G-0"]);
        record.raise("G-9");
        assert!(!dir.join("G.json").exists(), "닫은 기록을 뒤늦은 쓰기가 되살렸다");

        let dir = temp_dir("exit-survived");
        let record = Record::default();
        record.open(place(&dir, "G"));
        record.raise("G-0");
        record.close(&[(ended, Outcome::Ended), (survived, Outcome::Survived)]);
        assert_eq!(
            keys_on_disk(&dir, "G"),
            Some(vec!["G-0".to_string()]),
            "못 끝낸 것이 있는데 기록을 지웠다 — 다음 실행의 시작 정리가 그것을 못 찾는다"
        );
        record.lower(["G-0"]);
        assert_eq!(keys_on_disk(&dir, "G"), Some(vec!["G-0".to_string()]), "닫은 기록을 뒤늦은 쓰기가 고쳤다");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(temp_dir("exit-clean"));
    }

    /// **시작 정리가 죽은 실행의 기록을 지운다**(티켓 10). 넘겨받은 세대의 기록만 지우고, 이 실행의 기록은 넘겨받아도 안
    /// 지운다 — 지우면 이 실행의 셸 자손이 남에게 출처 불명이 된다. 열지 않은 기록은 어디를 지울지 몰라 아무것도 안 한다.
    ///
    /// 앵커: 넘겨받은 남의 기록(X)은 실제로 사라진다 — 아무것도 안 지우게 무너지면 「남았다」들이 저절로 참이 된다.
    #[test]
    fn forgetting_removes_the_named_records_but_never_this_runs() {
        let dir = temp_dir("forget");
        let others: Vec<Record> = ["X", "D"]
            .into_iter()
            .map(|generation| {
                let other = Record::default();
                other.open(place(&dir, generation));
                other.raise(&format!("{generation}-0"));
                other
            })
            .collect();
        let record = Record::default();
        record.open(place(&dir, "G"));

        Record::default().forget(["X"]);
        assert!(read(&dir, "X").is_some(), "열지 않은 기록이 무언가를 지웠다 — 어디를 지울지 모른다");

        record.forget(["X", "G"]);
        assert!(read(&dir, "X").is_none(), "넘겨받은 죽은 실행의 기록이 남았다");
        assert!(read(&dir, "D").is_some(), "넘겨받지 않은 기록을 지웠다");
        assert!(read(&dir, "G").is_some(), "이 실행의 기록을 지웠다 — 이 실행의 셸 자손이 남에게 출처 불명이 된다");
        drop(others);
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── 정리 기록(티켓 11) ── 쓰기는 이 기록의 뮤텍스를 지난다(`Record::log`).

    /// 사건 하나 — 번호(`at`)로 가른다.
    fn event(n: u64) -> Event {
        Event {
            id: 0,
            at: n,
            reason: cleanup_log::Reason::ShellClose,
            shell_key: Some(format!("G-{n}")),
            owner: None,
            targets: vec![cleanup_log::Target {
                pid: 7,
                name: "node".into(),
                command: None,
                outcome: Outcome::Ended,
            }],
        }
    }

    fn logged(dir: &Path) -> Vec<u64> {
        cleanup_log::read(&dir.join("cleanup-log.json")).into_iter().map(|event| event.at).collect()
    }

    /// **최근 100건을 새것부터 담는다**(프로세스 스펙 S12). 101번째를 더하면 가장 오래된 것(첫째)이 빠지고 새것이 맨 앞이다.
    #[test]
    fn the_hundred_and_first_event_pushes_the_oldest_out() {
        let dir = temp_dir("log-cap");
        let record = Record::default();
        record.open(place(&dir, "G"));
        for n in 1..=100 {
            record.log(event(n));
        }
        let full = logged(&dir);
        assert_eq!(full.len(), 100, "100건을 다 못 담았다");
        assert_eq!((full[0], full[99]), (100, 1), "새것부터가 아니다");

        record.log(event(101));
        let after = logged(&dir);
        assert_eq!(after.len(), 100, "100건을 넘겼다");
        assert_eq!(after[0], 101, "새 사건이 맨 앞이 아니다");
        assert_eq!(after[99], 2, "가장 오래된 사건이 안 빠졌거나 다른 것이 빠졌다");
        assert!(!after.contains(&1), "가장 오래된 사건이 남았다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **깨진 기록 파일은 빈 기록으로 읽고 새로 쓴다.** 한 장이 깨졌다고 적기를 멈추면 그 뒤로 앱이 끝낸 것이 모두 사라진다.
    #[test]
    fn a_broken_log_reads_as_empty_and_is_written_anew() {
        let dir = temp_dir("log-broken");
        let record = Record::default();
        record.open(place(&dir, "G"));
        std::fs::write(dir.join("cleanup-log.json"), "[{\"at\":").unwrap();
        assert!(cleanup_log::read(&dir.join("cleanup-log.json")).is_empty(), "깨진 파일을 기록으로 읽었다");

        record.log(event(5));
        assert_eq!(logged(&dir), [5], "깨진 파일 위에 새로 안 썼다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **적을 때마다 다음 번호가 선다**(티켓 29) — `●`가 「본 뒤 새로 생긴 기록」을 이 번호로 가른다. 번호는 파일의 가장 큰 번호 + 1이라
    /// 잘려 나간 줄 뒤에도 오르기만 하고, 번호가 없던 판이 쓴 줄(0으로 읽힘) 위에서는 1부터 선다. 짓는 쪽이 준 번호는 버린다 — 짓는
    /// 순간에는 파일을 모른다. 읽기(`events`)는 쓴 그대로 새것부터 돌려주고, 열지 않은 기록은 빈 기록이다.
    #[test]
    fn each_logged_event_takes_the_next_number() {
        let dir = temp_dir("log-ids");
        assert!(Record::default().events().is_empty(), "열지 않은 기록이 무언가를 읽었다");

        let record = Record::default();
        record.open(place(&dir, "G"));
        std::fs::write(
            dir.join("cleanup-log.json"),
            r#"[{"at":2,"reason":"shellClose","shellKey":null,"owner":null,"targets":[]},{"at":1,"reason":"reload","shellKey":null,"owner":null,"targets":[]}]"#,
        )
        .unwrap();
        record.log(Event { id: 77, ..event(3) });
        record.log(event(4));
        let ids: Vec<(u64, u64)> = record.events().iter().map(|one| (one.id, one.at)).collect();
        assert_eq!(ids, [(2, 4), (1, 3), (0, 2), (0, 1)], "번호가 파일의 가장 큰 번호 + 1로 안 섰다");

        for n in 5..=110 {
            record.log(event(n));
        }
        let kept = record.events();
        assert_eq!(kept.len(), 100);
        assert_eq!((kept[0].id, kept[99].id), (108, 9), "잘려 나간 뒤에 번호가 다시 섰다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **열지 않은 기록은 아무 사건도 안 쓴다** — 검사가 세우는 풀이 진짜 데이터 루트에 쓰지 않게. **닫은 뒤에는 쓴다** — 앱
    /// 종료가 기록을 닫은 뒤에 그 종료의 사건을 적는다. 인스턴스 기록 파일은 닫은 뒤 그대로다.
    #[test]
    fn only_an_opened_record_logs_and_closing_it_does_not_stop_the_log() {
        let dir = temp_dir("log-open");
        Record::default().log(event(1));
        assert!(std::fs::read_dir(&dir).is_err(), "열지 않은 기록이 파일을 썼다");

        let record = Record::default();
        record.open(place(&dir, "G"));
        record.close(&[]);
        record.log(event(2));
        assert_eq!(logged(&dir), [2], "닫은 뒤에 온 종료의 사건을 안 적었다");
        assert_eq!(read(&dir, "G"), None, "사건을 적으며 닫은 인스턴스 기록을 되살렸다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **다른 실행의 기록 한 장을 디스크에서 읽는다**(티켓 31) — `Processes`의 「다른 인스턴스」가 실행마다 빌드 종류와 버전을
    /// 보인다(프로세스 스펙 S54). 판정의 기록(`records`)은 그 두 칸을 안 싣는다. 없거나 깨진 기록은 `None`이고, 열지 않은 기록은
    /// 어디를 읽을지 몰라 늘 `None`이다(검사의 풀은 진짜 데이터 루트를 안 읽는다).
    #[test]
    fn another_runs_record_is_read_from_the_folder() {
        let dir = temp_dir("file");
        let other = Record::default();
        other.open(Place { build: Build::Release, version: "0.15.0".into(), ..place(&dir, "H") });
        other.raise("H-3");
        assert_eq!(Record::default().file("H"), None, "열지 않은 기록이 폴더를 읽었다");

        let record = Record::default();
        record.open(place(&dir, "G"));
        let file = record.file("H").expect("다른 실행의 기록을 못 읽었다");
        assert_eq!(
            (file.build, file.version.as_str(), file.shell_keys.as_slice()),
            (Build::Release, "0.15.0", ["H-3".to_string()].as_slice()),
            "다른 실행의 빌드 · 버전 · 셸 키를 그대로 못 읽었다"
        );
        assert_eq!(record.file("Z"), None, "없는 세대의 기록을 읽었다");
        std::fs::write(dir.join("B.json"), "{\"app\":").unwrap();
        assert_eq!(record.file("B"), None, "깨진 기록을 기록으로 읽었다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **두 스레드가 동시에 사건을 더해도 한 프로세스 안에서는 잃지 않는다**(프로세스 스펙 S12). 인스턴스 기록과 같은 뮤텍스 안에서
    /// 「읽기 → 더하기 → 쓰기」를 한다 — 잠금 밖에서 읽으면 둘이 같은 옛 목록을 읽고, 늦게 쓴 쪽이 먼저 쓴 쪽의 사건을 지운다.
    ///
    /// 끝 상태 하나만 보면 창을 놓친다(`two_threads_raising_and_lowering_lose_nothing`과 같은 까닭). 한 차례씩 맞춰 돈다 — 두
    /// 스레드가 같은 순간에 하나씩 더하고, 둘 다 돌아온 뒤 파일을 본다. 그 순간 사건은 차례의 두 배여야 한다. 한 스레드는
    /// 사건을 더하는 사이에 셸 키도 올린다 — 같은 잠금을 두 쓰기가 나눠 쓴다.
    #[test]
    fn two_threads_logging_at_once_lose_no_event() {
        use std::sync::Barrier;

        const ROUNDS: u64 = 40;
        let dir = temp_dir("log-mutex");
        let record = Arc::new(Record::default());
        record.open(place(&dir, "G"));
        let turn = Arc::new(Barrier::new(3));
        let writers: Vec<_> = [1_000, 2_000]
            .into_iter()
            .map(|side| {
                let (record, turn) = (Arc::clone(&record), Arc::clone(&turn));
                std::thread::spawn(move || {
                    for n in 0..ROUNDS {
                        turn.wait();
                        record.log(event(side + n));
                        if side == 1_000 {
                            record.raise(&format!("G-{n}"));
                        }
                        turn.wait();
                    }
                })
            })
            .collect();

        let mut wrong = Vec::new();
        for n in 0..ROUNDS {
            turn.wait();
            turn.wait();
            let count = logged(&dir).len() as u64;
            if count != 2 * (n + 1) && wrong.len() < 3 {
                wrong.push(format!("{n}차례 뒤 — 기대 {}건, 파일 {count}건", 2 * (n + 1)));
            }
        }
        for writer in writers {
            writer.join().expect("쓰는 스레드");
        }

        assert!(wrong.is_empty(), "두 스레드가 함께 적은 뒤 사건이 빠졌다 — 늦은 쓰기가 다른 쪽 사건을 지웠다:\n  {}", wrong.join("\n  "));
        let mut all = logged(&dir);
        all.sort_unstable();
        let mut want: Vec<u64> = (0..ROUNDS).flat_map(|n| [1_000 + n, 2_000 + n]).collect();
        want.sort_unstable();
        assert_eq!(all, want, "적힌 사건이 두 스레드가 더한 것과 다르다");
        assert_eq!(keys_on_disk(&dir, "G").map(|keys| keys.len()), Some(ROUNDS as usize), "사건을 적는 사이 올린 키를 잃었다");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **살아 있는 실행들의 세대**(프로세스 스펙 S9 · S10) — 앱 pid가 그 시작 시각 그대로 떠 있는 기록만. pid만 같은 기록(그
    /// pid를 남이 받았다)은 죽은 실행이다. 깨진 기록은 기록이 없는 것이다. 신원을 읽는 것은 macOS뿐이다.
    ///
    /// 앵커: 이 검사 프로세스를 앱으로 적은 기록은 산다 — 모두 죽었다고 무너지면 「죽었다」들이 저절로 참이 된다.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_alive_generations_are_the_records_whose_app_still_runs() {
        let dir = temp_dir("live");
        let me = snapshot::identity_of(std::process::id()).expect("이 검사 프로세스의 신원을 읽는다");
        for (generation, app) in [("L", me), ("D", Identity { pid: me.pid, started_us: me.started_us + 1 })] {
            Record::default().open(Place { app, ..place(&dir, generation) });
        }
        std::fs::write(dir.join("X.json"), "{").unwrap();

        assert_eq!(alive_generations(&dir), ["L"], "살아 있는 실행을 못 가렸다");
        assert!(alive(me) && !alive(Identity { pid: me.pid, started_us: 1 }));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 판정에 줄 기록들 — **이 실행의 것은 메모리에서, 남의 것은 디스크에서** 읽는다. 디스크의 제 파일은 쓰기가 실패했으면
    /// 낡았을 수 있다. 판정이 이 실행의 셸 목록을 기록에서 읽으므로 메모리가 정본이다.
    #[test]
    fn the_verdict_gets_its_own_record_from_memory_and_the_others_from_disk() {
        let dir = temp_dir("records");
        let other = Record::default();
        other.open(Place { app: Identity { pid: 70, started_us: 7 }, ..place(&dir, "D") });
        other.raise("D-1");
        let record = Record::default();
        record.open(place(&dir, "G"));
        record.raise("G-0");
        // 디스크의 제 파일이 낡았다 — 쓰기가 실패한 흉내.
        std::fs::write(dir.join("G.json"), "{").unwrap();

        let mut got: Vec<(String, Vec<String>, u32)> = record
            .records()
            .into_iter()
            .map(|one| (one.generation, one.shell_keys, one.app.pid))
            .collect();
        got.sort();
        assert_eq!(
            got,
            [("D".to_string(), vec!["D-1".to_string()], 70), ("G".to_string(), vec!["G-0".to_string()], 4242)],
            "판정에 줄 기록이 어긋났다"
        );
        assert!(Record::default().records().is_empty(), "열지 않은 기록이 무언가를 읽었다 — 어디를 읽을지 모른다");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
