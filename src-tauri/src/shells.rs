//! 셸이 스스로 말한 것 — 훅 스크립트가 쓰는 상태 파일 한 장과 그것을 보는 감시.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

/// 앱이 설치하는 훅 스크립트의 이름.
const SCRIPT_NAME: &str = "atelier-hook.py";

/// 훅 스크립트의 본문. **소스 트리의 진짜 파일을 그대로 굽는다** — 문자열 리터럴로 Rust
/// 안에 적으면 그 언어의 문법 검사도, 편집기의 손도 닿지 않는 코드가 된다.
pub const HOOK_SCRIPT: &str = include_str!("../hooks/atelier-hook.py");

/// 셸이 말한 것이 실려 나가는 이벤트. **양쪽이 이 문자열로만 이어져 있다** — 한쪽을 고치면
/// 컴파일도 타입 검사도 통과하고 화면만 영영 조용하다. 이름을 아는 자리가 여기와 `api.ts`
/// 둘뿐이라, 그 둘이 같은지는 `shell-registry.test.ts`가 두 파일을 함께 읽어 못박는다.
const ATTENTION_EVENT: &str = "shell:attention";

/// 폴더가 흔들린 뒤 얼마나 기다렸다 읽는가.
///
/// **기존 감시 둘(300·500ms)보다 짧다.** 그쪽이 보는 것은 사람이 편집기에서 저장하는
/// 문서라 몰아서 받는 것이 이득이지만, 이 파일은 훅이 한 번에 한 장을 원자적으로 쓰는
/// 것이고 값이 「지금 나를 기다린다」다 — 늦으면 그만큼 사람이 모르는 시간이 된다.
const DEBOUNCE: Duration = Duration::from_millis(100);

/// 셸들이 자기 상태를 적어 두는 곳.
pub fn shells_dir(root: &Path) -> PathBuf {
    root.join("shells")
}

/// 이 셸이 자기 상태를 적는 파일. **이름이 곧 셸 ID다** — 훅은 env로 받은 ID 말고는
/// 아무것도 모르고, 감시는 이름에서 그것을 되뽑는다.
pub fn state_path(root: &Path, shell_id: &str) -> PathBuf {
    shells_dir(root).join(format!("{shell_id}.json"))
}

/// 훅 스크립트가 사는 곳.
pub fn hooks_dir(root: &Path) -> PathBuf {
    root.join("hooks")
}

fn script_path(root: &Path) -> PathBuf {
    hooks_dir(root).join(SCRIPT_NAME)
}

/// 훅 스크립트를 디스크에 세운다.
pub fn write_hook_script(root: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let dir = hooks_dir(root);
    std::fs::create_dir_all(&dir).map_err(|e| format!("훅 폴더를 만들지 못했습니다: {e}"))?;

    let tmp = dir.join(format!(".{SCRIPT_NAME}.tmp"));
    std::fs::write(&tmp, HOOK_SCRIPT).map_err(|e| format!("훅 스크립트를 쓰지 못했습니다: {e}"))?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("훅 스크립트에 실행 권한을 주지 못했습니다: {e}"))?;
    std::fs::rename(&tmp, script_path(root))
        .map_err(|e| format!("훅 스크립트를 바꿔 넣지 못했습니다: {e}"))
}

/// 상태 파일 한 장의 내용 — 훅이 적고 감시가 읽는다.
///
/// **`message`가 없다.** 스펙의 전이 표가 말하는 message는 이벤트마다 다른 자리에서
/// 나오고(`tool_input` 요약 · `last_assistant_message`의 첫 줄) 그 접기는 에이전트별
/// 어댑터의 일이라 프런트에 산다. 여기서 한 줄로 접으면 그 규칙이 사용자 홈에 설치된
/// 스크립트와 Rust에 반씩 갈려, 화면이 바뀔 때 두 곳을 고쳐야 한다. 대신 페이로드를
/// **통째로** 싣는다 — 접는 데 필요한 것이 다 그 안에 있다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellState {
    agent: String,
    event: String,
    at: u64,
    /// 훅이 못 읽었으면 `null`이다 — 그때도 「이 셸에서 그 이벤트가 났다」는 참이다.
    #[serde(default)]
    payload: serde_json::Value,
}

/// 한 번에 읽은 상태 전부 — 셸 ID마다 한 장이다. `BTreeMap`인 것은 나가는 순서가
/// 회차마다 흔들리지 않게 하기 위해서다(`pty.rs`의 `Running`과 같은 이유).
type Attention = BTreeMap<String, ShellState>;

/// 상태 폴더를 통째로 한 번 읽는다.
///
/// **깨진 파일은 없는 것으로 친다.** 훅이 원자적으로 쓰니 반쯤인 파일은 안 생기지만, 사람이
/// 손으로 들여다보다 저장할 수도 있고 디스크가 찰 수도 있다. 그때 감시가 죽으면 **그 뒤로
/// 어느 셸도 말을 못 한다** — 한 장 때문에 통로 전체를 잃는 것이라 조용히 건너뛴다.
fn scan(dir: &Path) -> Attention {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Attention::new();
    };
    entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            // 이름이 곧 셸 ID다. dotfile(훅이 쓰는 중인 임시 파일)은 여기서 걸린다 —
            // `.abc.json.9.tmp`의 stem은 `.abc.json.9`라 점으로 시작한다.
            let id = path.file_stem()?.to_str()?.to_string();
            if id.starts_with('.') || path.extension()? != "json" {
                return None;
            }
            let content = std::fs::read_to_string(&path).ok()?;
            Some((id, serde_json::from_str(&content).ok()?))
        })
        .collect()
}

/// 나가는 것 한 줄 — 어느 셸이 무엇을 말했나. `state`가 `null`이면 그 셸의 상태가
/// 사라졌다는 뜻이다(파일이 지워졌다 = 셸이 닫혔다).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttentionChange {
    shell_id: String,
    state: Option<ShellState>,
}

/// **재는 것과 쏘는 것을 가르는 자리** — 직전에 쏜 것과 다른 셸만 나온다.
///
/// 감시는 폴더가 흔들릴 때마다 통째로 다시 읽으므로(그래야 지워진 파일도 눈에 띈다) 여기서
/// 안 가르면 셸 하나가 말할 때마다 전부가 다시 나가고, 상태 축이 붙는 화면 넷이 함께 다시
/// 그려진다. 구조는 `pty.rs`의 `changes`와 같다 — 그쪽이 이 판의 본이다.
fn changes(sent: &Attention, now: &Attention) -> Vec<AttentionChange> {
    let mut out = Vec::new();
    for (id, state) in now {
        if sent.get(id) != Some(state) {
            out.push(AttentionChange { shell_id: id.clone(), state: Some(state.clone()) });
        }
    }
    // 사라진 셸은 **한 번 더** 쏘아 지운다. 안 그러면 마지막 값이 화면에 굳어 닫힌 칸이
    // 영영 사람을 부른다. 다음 회차에는 `sent`에도 없으므로 두 번 나가지 않는다.
    for id in sent.keys() {
        if !now.contains_key(id) {
            out.push(AttentionChange { shell_id: id.clone(), state: None });
        }
    }
    out
}

/// 앱이 뜰 때 **지난 실행이 남긴 것을 전부 걷는다.**
///
/// 셸 ID의 꼬리는 PTY 번호이고 그 번호는 실행마다 0부터 다시 난다 — 접두사가 갈라 주지
/// 않으면 지난 실행의 `…-0.json`이 이번 실행의 첫 셸에 그대로 붙어 **뜨자마자 사람을 부르는
/// 셸**이 생긴다. 앱이 정상 종료하면 셸마다 자기 파일을 걷고 나가지만(`Shell`의 `Drop`),
/// 강제 종료·패닉·전원이 나간 경우가 남는다.
///
/// **접두사는 반드시 `pty::instance_prefix()`가 준 것이어야 한다.** 여기서 시각을 따로 재면
/// 두 값이 갈려 살아 있는 셸의 상태 파일을 지운다.
///
/// 우리 모양이 아닌 것(훅이 남긴 임시 파일 등)도 함께 걷는다 — 이 폴더는 앱이 만들고 앱만
/// 쓰는 자리다.
pub fn sweep(root: &Path, prefix: &str) {
    let dir = shells_dir(root);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    // 구분자까지 붙여 견준다. `1700`만 보면 `17000-1.json`이 이번 실행의 것으로 읽혀
    // 살아남고, 다음에 그 번호의 셸이 열리면 남의 상태를 뒤집어쓴다.
    let mine = format!("{prefix}-");
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !name.to_string_lossy().starts_with(&mine) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// `~/.atelier/shells/`를 보는 **세 번째 감시**.
///
/// **기존 감시(`watcher.rs`)를 못 쓴다.** 그쪽은 「무언가 바뀌었다」는 종만 치고 페이로드를
/// 안 싣는다 — 프런트가 그 종을 듣고 다시 물어보는 구조다. 여기서 그렇게 하면 셸이 말할
/// 때마다 프런트가 폴더를 통째로 되읽는 왕복이 하나 생기고, 「바뀐 셸만」이라는 값도 잃는다.
/// 그래서 바뀐 파일에서 셸 ID를 뽑고 내용을 읽어 **바뀐 셸만** 실어 보낸다.
///
/// **한 번 흔들릴 때마다 폴더를 통째로 다시 읽는다.** 이벤트가 든 경로만 읽으면 지워진
/// 파일을 못 보고(그 셸이 화면에서 영영 안 지워진다) 감시가 놓친 회차도 못 따라잡는다.
/// 파일 수는 셸 수(화면마다 8)라 통째로 읽어도 싸다.
pub fn watch(app: AppHandle, dir: PathBuf) {
    std::thread::spawn(move || {
        watch_into(&dir, |changed| {
            let _ = app.emit(ATTENTION_EVENT, changed);
        });
    });
}

/// 감시의 **몸통**. 나가는 자리를 인자로 받는 것은 검사를 위해서다 — `AppHandle`은 창과
/// 웹뷰가 있어야 서고, 그러면 「파일이 바뀌면 바뀐 셸만 나간다」를 실행으로 잴 자리가
/// 어디에도 안 남는다(그 값이 이 감시의 전부다). 돌아오지 않는 함수다.
fn watch_into(dir: &Path, mut emit: impl FnMut(Vec<AttentionChange>)) {
    let _ = std::fs::create_dir_all(dir);
    let (tx, rx) = std::sync::mpsc::channel();
    let mut debouncer = match new_debouncer(DEBOUNCE, tx) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("atelier: shells watcher init failed for {}: {e}", dir.display());
            return;
        }
    };
    if let Err(e) = debouncer.watcher().watch(dir, RecursiveMode::NonRecursive) {
        eprintln!("atelier: failed to watch {}: {e}", dir.display());
        return;
    }
    // **프런트가 지금 믿고 있는 값**이다. 안 쏜 회차에는 잰 값과 같으므로 그대로 덮어써도
    // 어긋나지 않는다 — `pty.rs`의 폴링 스레드와 같은 한 줄이다.
    let mut sent = Attention::new();
    for result in rx {
        let Ok(_events) = result else { continue };
        let now = scan(dir);
        let changed = changes(&sent, &now);
        if !changed.is_empty() {
            emit(changed);
        }
        sent = now;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("atelier-shells-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// **아틀리에 밖 터미널에서 무해해야 한다.** 사용자가 훅을 깔면 그 훅은 앱 밖에서 띄운
    /// claude·codex에서도 돈다 — 거기엔 셸 ID가 없다. 그때 무엇이든 남기면 남의 홈에
    /// 쓰레기를 쌓는 것이고, 0이 아닌 코드로 끝나면 Claude·Codex 둘 다 그것을 훅 실패로
    /// 읽어 사람에게 오류를 보인다.
    ///
    /// **문자열로 재지 않고 실제로 돌린다.** 「스크립트에 그 줄이 쓰여 있다」는 「그 줄이
    /// 돈다」가 아니다.
    #[test]
    fn without_a_shell_id_the_hook_writes_nothing_and_exits_zero() {
        let root = temp_root("no-env");
        write_hook_script(&root).expect("스크립트를 세운다");

        let out = std::process::Command::new(script_path(&root))
            .args(["claude", "Stop"])
            .env_remove("ATELIER_SHELL")
            .env("ATELIER_HOME", &root)
            .output()
            .expect("스크립트가 돈다");

        assert!(out.status.success(), "종료 코드가 0이 아니다: {:?}", out.status);
        assert!(
            !shells_dir(&root).exists(),
            "셸 ID가 없는데 상태 폴더를 만들었다 — 아틀리에 밖에서 자국을 남긴다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 셸 ID가 있으면 **그 ID의 파일 한 장**이 생긴다. 그 한 장이 이 판의 신호 길에서
    /// 훅이 남기는 전부다.
    ///
    /// **임시 파일이 안 남는 것을 함께 잰다.** 쓰기는 원자적이어야 하는데(감시가 반쯤
    /// 쓰인 파일을 읽으면 그 셸이 조용히 사라진다) 원자성의 값은 「중간 단계가 안 보인다」
    /// 이고, 중간 단계가 그 자리에 **남아 있으면** 그 값은 이미 깨진 것이다.
    #[test]
    fn with_a_shell_id_the_hook_leaves_one_file_and_no_tmp() {
        let root = temp_root("with-env");
        write_hook_script(&root).expect("스크립트를 세운다");

        let out = run_hook(&root, "1700000000000-3", &["claude", "Stop"], r#"{"last_assistant_message":"테스트 셋 통과"}"#);
        assert!(out.status.success(), "종료 코드가 0이 아니다: {out:?}");

        let written = std::fs::read_to_string(shells_dir(&root).join("1700000000000-3.json"))
            .expect("그 셸 ID의 상태 파일이 있다");
        let state: serde_json::Value = serde_json::from_str(&written).expect("JSON이다");
        assert_eq!(state["agent"], "claude");
        assert_eq!(state["event"], "Stop");
        assert_eq!(
            state["payload"]["last_assistant_message"], "테스트 셋 통과",
            "페이로드가 그대로 안 실렸다 — 둘째 줄에 적을 말이 여기서만 온다"
        );
        assert!(state["at"].as_u64().unwrap_or(0) > 1_700_000_000_000, "적힌 시각이 없다");

        let names = files_in(&shells_dir(&root));
        assert_eq!(names, vec!["1700000000000-3.json"], "임시 파일이 남았거나 딴것이 생겼다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **훅은 남을 부르지 않는다.** 훅이 도는 시간은 그대로 사람이 기다리는 시간이라
    /// (에이전트의 턴 안에서 돈다) 프로세스를 하나 더 띄우는 것은 신호의 값을 속도로
    /// 물어내는 것이다.
    ///
    /// **금지어 목록이 아니라 허용 목록으로 잰다.** 「`subprocess`가 없다」는 다음에 누가
    /// `multiprocessing`이나 `ctypes`를 들이면 조용히 통과한다 — 파이썬에서 프로세스를
    /// 띄우는 길이 열 가지가 넘는다. 들여오는 모듈 넷과 쓰는 `os` 함수 여섯을 **못으로
    /// 박아** 그 밖의 무엇이든 빨간불이 되게 한다. 허용 목록을 우회하는 길(동적 import·
    /// eval)은 그 이름을 따로 막는다 — 그 넷이 닫히면 이 목록 밖으로 나가는 문이 없다.
    ///
    /// 재는 대상은 **앱이 실제로 굽는 문자열**(`HOOK_SCRIPT`)이라, 소스 트리의 다른 파일이
    /// 바뀌어도 이 검사가 헛도는 자리가 없다.
    #[test]
    fn the_hook_never_reaches_for_another_process() {
        let imports: Vec<&str> = HOOK_SCRIPT
            .lines()
            .map(str::trim)
            .filter(|line| line.starts_with("import ") || line.starts_with("from "))
            .collect();
        assert_eq!(
            imports,
            vec!["import json", "import os", "import sys", "import time"],
            "훅이 들여오는 모듈이 늘었다 — 프로세스를 띄우는 길이 열렸는지 눈으로 보라"
        );

        for name in os_attributes(HOOK_SCRIPT) {
            assert!(
                ["environ", "path", "makedirs", "replace", "remove", "getpid"].contains(&name.as_str()),
                "훅이 `os.{name}`을 쓴다 — 이 목록은 시스템 호출로만 채워져 있어야 한다"
            );
        }

        for door in ["__import__", "eval(", "exec(", "compile("] {
            assert!(
                !HOOK_SCRIPT.contains(door),
                "훅에 `{door}`가 있다 — 위 허용 목록을 우회해 무엇이든 들여올 수 있다"
            );
        }
    }

    /// `os.` 뒤에 오는 이름들. 앞 글자가 이름의 일부인 경우(`macos.`)는 건너뛴다.
    fn os_attributes(src: &str) -> Vec<String> {
        let bytes = src.as_bytes();
        src.match_indices("os.")
            .filter(|(at, _)| {
                *at == 0 || !(bytes[at - 1] as char).is_alphanumeric() && bytes[at - 1] != b'_'
            })
            .map(|(at, _)| {
                src[at + 3..].chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect()
            })
            .collect()
    }

    /// 깨진 파일 한 장이 나머지를 끌고 가지 않는다. 이 감시가 죽으면 화면이 조용해지는
    /// 것이 아니라 **모든 셸이 영영 말을 못 하게** 된다.
    #[test]
    fn a_broken_state_file_is_skipped_and_the_rest_still_come() {
        let root = temp_root("broken");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("prefix-1.json"), r#"{"agent":"claude","event":"Stop","at":7,"payload":null}"#).unwrap();
        std::fs::write(dir.join("prefix-2.json"), "{ 여기서 잘렸").unwrap();
        std::fs::write(dir.join(".prefix-3.json.9.tmp"), "{}").unwrap();

        let seen = scan(&dir);

        assert_eq!(seen.keys().collect::<Vec<_>>(), vec!["prefix-1"], "실린 셸이 다르다");
        assert_eq!(seen["prefix-1"].event, "Stop");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **바뀐 셸만** 나간다. 안 바뀐 셸이 함께 실리면 상태 축이 붙은 화면 넷이 파일 하나가
    /// 흔들릴 때마다 통째로 다시 그려진다.
    #[test]
    fn only_the_shells_that_changed_go_out() {
        let 조용한 = state("claude", "Stop", 1);
        let 말한 = state("claude", "PermissionRequest", 2);
        let sent = Attention::from([("가-1".into(), 조용한.clone()), ("가-2".into(), 말한.clone())]);
        let now = Attention::from([
            ("가-1".into(), 조용한.clone()),
            ("가-2".into(), state("claude", "Stop", 3)),
            ("가-3".into(), 말한.clone()),
        ]);

        let out = changes(&sent, &now);

        assert_eq!(
            out.iter().map(|c| c.shell_id.as_str()).collect::<Vec<_>>(),
            vec!["가-2", "가-3"],
            "안 바뀐 셸이 실렸거나 바뀐 셸이 빠졌다"
        );
        assert_eq!(out[0].state.as_ref().map(|s| s.at), Some(3));
    }

    /// 파일이 사라지면 **한 번** 지우러 나간다. 안 그러면 마지막 값이 화면에 굳어 닫힌
    /// 셸이 영영 사람을 부른다. 두 번 나가면 알림 엣지가 두 번 발화한다.
    #[test]
    fn a_vanished_state_goes_out_once_as_nothing() {
        let sent = Attention::from([("가-1".into(), state("claude", "Stop", 1))]);
        let 빈 = Attention::new();

        let 지움 = changes(&sent, &빈);
        assert_eq!(지움.len(), 1, "사라진 셸이 안 나갔다");
        assert_eq!(지움[0].shell_id, "가-1");
        assert_eq!(지움[0].state, None, "사라진 셸에 값이 실렸다");

        // 감시는 쏜 뒤 `sent`를 방금 잰 것으로 덮는다 — 그다음 회차가 이것이다.
        assert!(changes(&빈, &빈).is_empty(), "사라진 셸을 다시 지우러 나갔다");
    }

    /// 지난 실행의 파일은 가고 이번 실행의 것은 남는다.
    #[test]
    fn a_sweep_keeps_only_this_runs_files() {
        let root = temp_root("sweep");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["1699-0.json", "1700-0.json", "1700-12.json", ".1699-4.json.9.tmp"] {
            std::fs::write(dir.join(name), "{}").unwrap();
        }

        sweep(&root, "1700");

        assert_eq!(
            files_in(&dir),
            vec!["1700-0.json", "1700-12.json"],
            "지난 실행의 파일이 남았거나 이번 실행의 것이 지워졌다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 접두사가 **온전히** 맞아야 한다. `1700`으로 쓸어 낼 때 `17000-…`을 남기면 다음
    /// 실행이 그것을 자기 셸로 읽는다 — 이 검사가 없으면 `starts_with(prefix)` 한 줄이
    /// 조용히 통과한다.
    #[test]
    fn a_prefix_only_matches_up_to_the_separator() {
        let root = temp_root("sweep-boundary");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["1700-1.json", "17000-1.json"] {
            std::fs::write(dir.join(name), "{}").unwrap();
        }

        sweep(&root, "1700");

        assert_eq!(files_in(&dir), vec!["1700-1.json"], "다른 실행의 파일을 이번 것으로 읽었다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **파일이 바뀌면 그 셸이 나간다 — 그리고 그 셸만 나간다.** 위 `changes`가 값으로
    /// 전수되지만 그것만으로는 「감시가 이 폴더에 실제로 걸렸는가」와 「바뀐 뒤 얼마 만에
    /// 나가는가」를 하나도 모른다. 여기가 그 둘을 잰다.
    ///
    /// 나가는 자리를 채널로 받아 헤드리스로 돈다. 기다리는 시간을 넉넉히 두는 것은
    /// macOS의 FSEvents가 몇백 밀리초씩 뭉쳐 오기 때문이다 — 짧게 잡으면 러너 속도에 매인
    /// 검사가 된다.
    #[test]
    fn a_changed_file_goes_out_and_the_quiet_ones_do_not() {
        let root = temp_root("watch");
        let dir = shells_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        let watched = dir.clone();
        std::thread::spawn(move || {
            watch_into(&watched, |changed| {
                let _ = tx.send(changed);
            });
        });
        // 감시가 걸리기 전에 쓴 파일은 아무 이벤트도 안 낸다.
        std::thread::sleep(std::time::Duration::from_millis(300));

        write_state(&dir, "1700-1", 1);
        let first = rx.recv_timeout(std::time::Duration::from_secs(10)).expect("바뀐 셸이 나온다");
        assert_eq!(first.len(), 1, "한 셸만 바뀌었는데 여럿이 나갔다: {first:?}");
        assert_eq!(first[0].shell_id, "1700-1");

        write_state(&dir, "1700-2", 2);
        let second = rx.recv_timeout(std::time::Duration::from_secs(10)).expect("둘째 셸이 나온다");
        assert_eq!(
            second.iter().map(|c| c.shell_id.as_str()).collect::<Vec<_>>(),
            vec!["1700-2"],
            "안 바뀐 셸이 함께 실려 나갔다 — 화면 넷이 파일 하나에 통째로 다시 그려진다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    fn write_state(dir: &Path, shell: &str, at: u64) {
        let json = serde_json::to_string(&state("claude", "Stop", at)).unwrap();
        // 훅과 같은 길로 쓴다 — 감시가 중간 단계를 보지 않게.
        let tmp = dir.join(format!(".{shell}.json.tmp"));
        std::fs::write(&tmp, json).unwrap();
        std::fs::rename(&tmp, dir.join(format!("{shell}.json"))).unwrap();
    }

    fn state(agent: &str, event: &str, at: u64) -> ShellState {
        ShellState {
            agent: agent.to_string(),
            event: event.to_string(),
            at,
            payload: serde_json::Value::Null,
        }
    }

    fn run_hook(root: &Path, shell: &str, args: &[&str], stdin: &str) -> std::process::Output {
        use std::io::Write;

        let mut child = std::process::Command::new(script_path(root))
            .args(args)
            .env("ATELIER_SHELL", shell)
            .env("ATELIER_HOME", root)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("스크립트가 돈다");
        child.stdin.take().expect("stdin이 열려 있다").write_all(stdin.as_bytes()).unwrap();
        child.wait_with_output().expect("끝난다")
    }

    fn files_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .expect("폴더가 있다")
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }
}
