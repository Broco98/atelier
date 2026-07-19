use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use tauri::{AppHandle, Emitter};

/// `~/.atelier/projects/` 감시 → 관련 변경 시 `projects:changed` emit.
/// dotfile(자기 쓰기의 `.tmp` 단계 포함)은 무시한다.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let dir = atelier_core::projects_dir();
        let _ = std::fs::create_dir_all(&dir);
        let (tx, rx) = std::sync::mpsc::channel();
        let Ok(mut debouncer) = new_debouncer(Duration::from_millis(500), tx) else {
            return;
        };
        if debouncer.watcher().watch(&dir, RecursiveMode::NonRecursive).is_err() {
            return;
        }
        for result in rx {
            let Ok(events) = result else { continue };
            let relevant = events.iter().any(|e| {
                e.path.file_name().is_some_and(|n| {
                    let n = n.to_string_lossy();
                    !n.starts_with('.') && n.ends_with(".md")
                })
            });
            if relevant {
                let _ = app.emit("projects:changed", ());
            }
        }
    });
}
