use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use tauri::{AppHandle, Emitter};

/// `~/.atelier/projects/` 감시 → 관련 변경 시 `projects:changed` emit.
/// `~/.atelier/works/` 감시 → 관련 변경 시 `works:changed` emit.
/// dotfile(자기 쓰기의 `.tmp` 단계 포함)은 무시한다.
pub fn start(app: AppHandle) {
    spawn_watch(
        app.clone(),
        atelier_core::projects_dir(),
        RecursiveMode::NonRecursive,
        Duration::from_millis(500),
        "projects:changed",
        |path| {
            path.file_name().is_some_and(|n| {
                let n = n.to_string_lossy();
                !n.starts_with('.') && n.ends_with(".md")
            })
        },
    );
    // works는 spec/ 하위까지 재귀 감시하되, 코드 체크아웃인 trees/ 하위는
    // 빌드 등으로 이벤트가 폭주하므로 무시한다.
    // spec 라이브 리로드는 반응성이 중요해 더 짧게 디바운스한다 (스펙: 300ms)
    spawn_watch(
        app,
        atelier_core::works_dir(),
        RecursiveMode::Recursive,
        Duration::from_millis(300),
        "works:changed",
        |path| {
            let in_trees = path
                .components()
                .any(|c| matches!(c, std::path::Component::Normal(n) if n == "trees"));
            let dotfile = path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with('.'));
            !in_trees && !dotfile
        },
    );
}

/// 폴더 하나를 디바운스로 보며 **종만 친다** — 무엇이 바뀌었는지는 안 싣고, 프런트가 그
/// 종을 듣고 다시 물어본다.
///
/// **`shells.rs`의 `watch_into`와 짝이다.** 디바운서를 세우는 앞 절반(`create_dir_all` →
/// 채널 → `new_debouncer` → `watch` → 회차 루프)이 줄 단위로 같고 오류 문구까지 겹친다.
/// 그쪽이 따로 선 근거는 **나가는 것**이지(바뀐 셸을 페이로드로 싣는다) 이 배선이 아니므로,
/// notify의 API가 바뀌거나 오류 처리를 고칠 때는 두 자리를 함께 고쳐야 한다.
fn spawn_watch(
    app: AppHandle,
    dir: PathBuf,
    mode: RecursiveMode,
    debounce: Duration,
    event: &'static str,
    relevant: fn(&Path) -> bool,
) {
    std::thread::spawn(move || {
        let _ = std::fs::create_dir_all(&dir);
        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = match new_debouncer(debounce, tx) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("atelier: watcher init failed for {}: {e}", dir.display());
                return;
            }
        };
        if let Err(e) = debouncer.watcher().watch(&dir, mode) {
            eprintln!("atelier: failed to watch {}: {e}", dir.display());
            return;
        }
        for result in rx {
            let Ok(events) = result else { continue };
            if events.iter().any(|e| relevant(&e.path)) {
                let _ = app.emit(event, ());
            }
        }
    });
}
