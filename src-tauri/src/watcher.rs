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
