//! 여러 쓰기가 겹칠 수 있는 JSON 파일 한 장의 읽기·쓰기 — `recent.json`과 진행 중 루트의
//! `.order.json`이 함께 딛는다.
//!
//! **둘이 한 자리를 쓰는 것은 「tmp 이름이 쓰기마다 다르다」가 둘 다에 필요해서다.** 한쪽만
//! 고정 이름으로 돌아가면 겹친 rename이 반쯤 쓰인 파일을 남기는데, 그 차이는 검사로도 실물로도
//! 좀처럼 안 드러난다. 읽기(없음·깨짐 = 기본값 + stderr 한 줄)도 같은 까닭으로 여기 한 벌이다 —
//! 파일이 하나 더 늘 때 두 모듈의 사본과 그 사본을 세는 주석이 함께 늘지 않게.
//!
//! 다시 쓰기 전에 깨진 원문을 옆에 떠 두는 벌(`keep_aside` — 이전 벌을 절대 안 덮는다)도 여기 있다.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{de::DeserializeOwned, Serialize};

use crate::Result;

/// JSON 파일 한 장을 읽는다. **실패하지 않는다 — 없으면 기본값, 못 읽거나 깨졌으면 기본값 +
/// stderr 한 줄.** 기본값으로 눕는 판단 자체는 부르는 쪽 모듈에 적혀 있다(`recent.rs`의
/// `read_recent`, `order.rs`의 `read_order`). `label`은 그 줄에서 어느 파일인지 가리는 이름이다.
///
/// **이 크레이트에서 stderr로 나가는 자리는 여기와 순서 파일 다시 쓰기(`order.rs`의
/// `rewrite_order`가 벌을 떴다고 알리는 줄) 둘뿐이다 — 알고 그렇게 뒀다.** 나머지 진단은 전부
/// 호스트(`src-tauri`·CLI)의 몫이고, 층으로 보면 「어떻게 알리나」는 기전이라 바깥의 것이 맞다.
/// 그런데 이 읽기는 **오류를 안 돌려준다**(그것이 부르는 쪽 결정의 전부다) — 알릴 것을 밖으로
/// 내보내려면 반환 모양을 바꾸거나 검색 전체에 진단 채널을 하나 꿰야 하고, 그 값은 셋뿐인
/// 호스트가 전부 stderr를 진단 채널로 쓰고 있어서 0이다(MCP는 stdout이 프로토콜이라 특히
/// 그렇다). 진단 채널이 생기는 날 이 줄들이 그리로 간다.
///
/// **이 읽기의 결과를 그대로 다시 쓰면 안 된다** — 깨진 파일이 기본값으로 누워 있어서 그 쓰기가
/// 사람의 손질을 덮는다. 다시 쓰는 길은 깨짐을 가려 받는 읽기를 따로 둔다(`order.rs`의
/// `read_order_to_rewrite`).
///
/// **파일도 폴더도 만들지 않는다.** 글자마다 부르는 자리가 무엇을 만들면 「읽기만 한다」가
/// 거짓이 된다.
pub(crate) fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path, label: &str) -> T {
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        // 없는 것은 정상이다 — 첫 실행, 순서를 한 번도 안 만진 루트가 그 자리다.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return T::default(),
        Err(e) => {
            eprintln!("atelier: {label} read failed ({}): {e}", path.display());
            return T::default();
        }
    };
    match serde_json::from_str(&content) {
        Ok(value) => value,
        Err(e) => {
            eprintln!("atelier: {label} parse failed ({}): {e}", path.display());
            T::default()
        }
    }
}

/// 값을 보기 좋은 JSON(끝 줄바꿈 포함)으로 옮겨 `write_atomically`로 쓴다. `what`은 직렬화
/// 실패 메시지의 목적어다(「순서를」·「이력을」).
pub(crate) fn write_json_atomically<T: Serialize>(
    dir: &Path,
    file_name: &str,
    value: &T,
    what: &str,
) -> Result<()> {
    let mut json = serde_json::to_string_pretty(value)
        .map_err(|e| crate::Error::Validation(format!("{what} 옮겨 적지 못했습니다: {e}")))?;
    json.push('\n');
    write_atomically(dir, file_name, &json)
}

/// 같은 디렉터리 tmp 파일 → rename 원자적 쓰기 (`work.json`·projects·설정과 같은 규칙).
/// rename은 같은 파일시스템 안에서 원자적이라 파일이 반쯤인 순간이 없고, 그래서 tmp도
/// 반드시 **같은 디렉터리**에 둔다. 점 접두사는 감시자가 자기 쓰기의 중간 단계를
/// 되돌려주지 않게 하는 규약이다(`watcher.rs`의 「dotfile은 무시한다」).
///
/// **tmp 이름에 고유값을 붙인다 — 이웃들과 갈리는 자리다.** 설정 파일은 고정 이름을 쓰되
/// 「쓰기는 한 번에 하나다」를 **명시로 깔아 두고** 그렇게 했는데(설정을 쓰는 곳이 저장
/// 하나뿐이다), 이 파일들에는 그 전제가 안 선다: 이력은 **work을 옮길 때마다** 쓰이고,
/// 커맨드가 async이며, 앱이 StrictMode 아래라 dev에서 effect가 마운트마다 두 번 돈다. 순서
/// 파일은 앱·MCP·CLI 세 프로세스가 같은 루트에 쓴다. 고정 이름이면 겹친 rename이 다른 쪽이
/// 아직 쓰는 중인 tmp를 옮겨 **반쯤 쓰인 파일**을 남긴다.
///
/// **잠그지 않는다** — 겹친 두 쓰기는 나중 것이 이긴다. 그 판단은 부르는 쪽 모듈에 적혀 있다.
///
/// 첫 쓰기가 폴더가 아직 없는 상태일 수 있다. **쓰기는 만들어도 된다** — 만들지 않기로 한 것은
/// 읽기 쪽이다.
pub(crate) fn write_atomically(dir: &Path, file_name: &str, contents: &str) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(tmp_name(file_name));
    std::fs::write(&tmp, contents)?;
    if let Err(e) = std::fs::rename(&tmp, dir.join(file_name)) {
        // 바꿔 넣지 못했으면 **찌꺼기를 남기지 않는다.** 남으면 다음 사람이 그 파일을
        // 진짜로 착각할 여지가 생기고, 감시자가 무시하는 dotfile이라 화면에도 안 뜬다.
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// 곧 덮일 파일의 **바이트 그대로**를 같은 폴더의 벌 한 장에 떠 두고 그 경로를 돌려준다 —
/// 사람이 손으로 고치다 깨뜨린 파일을 다시 쓰기 전에 부른다.
///
/// 이름은 `<파일>.bak`이다(훅 설치기 `hooks.rs`의 `.bak`과 같은 머리 — 확장자를 갈지 않고
/// 붙인다). **다만 이미 있는 벌은 절대 안 덮는다** — 설치기의 `.bak`은 「방금 우리가 떠 둔 것」
/// 이라 덮어도 되지만, 여기서 덮일 것은 **지난번에 깨졌던 사람의 손질**이다. 그래서
/// `create_new`로 `<파일>.bak` → `<파일>.1.bak` → `<파일>.2.bak` 순으로 빈 이름을 잡는다.
/// 벌은 파일이 깨졌을 때만 뜨므로 쌓일 일이 드물다.
///
/// 이름이 `.tmp`로 끝나지 않는 것이 계약이다 — tmp 찌꺼기로 읽혀 치워지면 안 된다. 점 파일에서
/// 부르면 벌도 점 파일이라 목록 열거와 감시자가 건너뛴다.
pub(crate) fn keep_aside(dir: &Path, file_name: &str, bytes: &[u8]) -> Result<PathBuf> {
    use std::io::Write;
    for n in 0u64.. {
        let name = if n == 0 { format!("{file_name}.bak") } else { format!("{file_name}.{n}.bak") };
        let path = dir.join(name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(e) = file.write_all(bytes).and_then(|()| file.sync_all()) {
                    // 잘린 벌을 남기면 사람이 그것을 원문으로 착각한다.
                    drop(file);
                    let _ = std::fs::remove_file(&path);
                    return Err(e.into());
                }
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    unreachable!("벌 이름이 다 찼다")
}

/// 이 쓰기만의 tmp 이름. 프로세스와 호출을 함께 세므로 **한 기계 안에서 안 겹친다** —
/// 시계를 안 쓰는 것은 같은 밀리초에 두 번 쓰는 것이 정확히 이 파일들의 흔한 경우라서다
/// (StrictMode가 effect를 두 번 돌린다).
///
/// **이미 점으로 시작하는 이름에 점을 하나 더 붙이지 않는다** — `.order.json`의 tmp는
/// `.order.json.<pid>.<n>.tmp`다. 어느 쪽이든 점 접두사라 감시자는 같게 보지만, 사람이 폴더를
/// 볼 때 이름이 최종 파일과 같은 머리로 읽혀야 무엇의 찌꺼기인지 안다.
fn tmp_name(file_name: &str) -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    format!(".{}.{}.{n}.tmp", file_name.trim_start_matches('.'), std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **tmp 이름에 고유값이 붙는다.** 고정 이름이면 겹친 rename이 반쯤 쓰인 파일을 남긴다.
    #[test]
    fn tmp_이름이_쓰기마다_다르다() {
        assert_ne!(tmp_name("recent.json"), tmp_name("recent.json"));
    }

    /// tmp는 **점으로 시작한다** — 감시자가 자기 쓰기의 중간 단계를 소식으로 안 읽는 규약이다.
    /// 최종 이름이 이미 점 파일이어도 같은 모양이다.
    #[test]
    fn tmp_이름은_점_파일이다() {
        for name in ["recent.json", ".order.json"] {
            let tmp = tmp_name(name);
            assert!(tmp.starts_with('.') && !tmp.starts_with(".."), "{tmp}");
            assert!(tmp.ends_with(".tmp"), "{tmp}");
        }
    }

    /// 쓰고 나면 **찌꺼기가 없다.** 고유 이름을 붙였으므로 지우는 자리가 확실해야 한다 —
    /// 남으면 dotfile이라 화면에도 안 뜬 채 쌓인다.
    #[test]
    fn 쓰고_나면_tmp가_안_남는다() {
        let tmp = tempfile::tempdir().unwrap();
        write_atomically(tmp.path(), ".order.json", "{}").unwrap();
        write_atomically(tmp.path(), ".order.json", "{}").unwrap();

        let names: Vec<String> = std::fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![".order.json"]);
    }
}
