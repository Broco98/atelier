//! 물어보는 정도와 「다시 묻지 않기」 허락의 자리 — Work 폴더 · Thread 폴더의 점 파일 `.policy.json`(v1 구현 스펙 §9 · S18).
//!
//! - **Work에 이은 Thread의 물어보는 정도와 허락은 Work 폴더의 점 파일에 둔다.** 같은 Work의 Thread들이 함께 쓴다. 감시(watcher)가
//!   점 파일을 무시하고(`watcher.rs`의 「dotfile은 무시한다」), 보관할 때 Work 폴더와 함께 옮겨진다.
//! - Work 없는 Thread의 물어보는 정도는 `thread.json`의 `mode`다(§4 표). 그 Thread에 준 허락(「이 Thread에서는 다시 묻지 않기」)은
//!   Thread 폴더의 같은 점 파일에 둔다 — `thread.json`에 칸을 더하지 않는다.
//! - 값은 글자 그대로다 — 물어보는 정도의 이름(`always` …)과 허락의 규칙 이름(S19의 `edit` · `Bash(…)` …)을 푸는 일은 판정(Thread
//!   엔진 `atelier-acp`의 `policy.rs`)의 몫이다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::Result;

pub(crate) const POLICY_FILE: &str = ".policy.json";

/// 점 파일이 사는 곳 — Work(slug) 폴더 또는 Thread(id) 폴더.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyPlace<'a> {
    Work(&'a str),
    Thread(&'a str),
}

/// `.policy.json` 한 장. 칸이 빠진 파일도 읽힌다.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PolicyFile {
    /// 물어보는 정도 — Work 폴더에서만 쓴다(Thread의 것은 `thread.json`의 `mode`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// 「다시 묻지 않기」 허락 — 규칙 이름들.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub grants: Vec<String>,
    /// 모르는 칸은 다시 써도 남는다(`thread.json`과 같은 규약).
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 그 자리의 폴더 — 경로를 품은 slug · id는 거절한다.
fn folder(data_root: &Path, place: PolicyPlace) -> Result<PathBuf> {
    match place {
        PolicyPlace::Work(slug) if crate::slug::is_safe_slug(slug) => Ok(crate::works_in(data_root).join(slug)),
        PolicyPlace::Work(slug) => Err(crate::Error::Validation(format!("Work slug가 아닙니다: {slug:?}"))),
        PolicyPlace::Thread(id) => crate::thread_dir(data_root, id),
    }
}

/// 점 파일을 읽는다. **실패하지 않는다 — 없거나 깨졌으면 빈 값이다**(깨짐은 stderr 한 줄). 판정이 받은 요청마다 읽는다: 깨진 파일은
/// 「허락 없음 · 매번 묻기」로 눕는다 — 묻지 않고 넘기는 쪽으로 눕지 않는다.
pub fn read_policy(data_root: &Path, place: PolicyPlace) -> PolicyFile {
    match folder(data_root, place) {
        Ok(dir) => crate::atomic::read_json_or_default(&dir.join(POLICY_FILE), "policy file"),
        Err(_) => PolicyFile::default(),
    }
}

/// 점 파일을 고쳐 쓴다. **폴더를 만들지 않는다** — 보관 · 삭제로 사라진 Work 폴더를 되살리지 않는다. 깨진 파일은 원문을 옆에 떠 둔
/// 뒤 빈 값에서 고친다.
pub fn update_policy(data_root: &Path, place: PolicyPlace, change: impl FnOnce(&mut PolicyFile)) -> Result<PolicyFile> {
    let dir = folder(data_root, place)?;
    let path = dir.join(POLICY_FILE);
    let mut file = match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).or_else(|_| {
            let kept = crate::atomic::keep_aside(&dir, POLICY_FILE, &bytes)?;
            eprintln!("atelier: policy file was unreadable as JSON ({}); kept its bytes as {}", path.display(), kept.display());
            Ok::<_, crate::Error>(PolicyFile::default())
        })?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => PolicyFile::default(),
        Err(e) => return Err(e.into()),
    };
    change(&mut file);
    crate::atomic::write_json_into_existing_dir(&dir, POLICY_FILE, &file, "물어보는 정도를")?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work(root: &Path, slug: &str) -> std::path::PathBuf {
        let dir = crate::works_in(root).join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn work의_정도와_허락은_work_폴더의_점_파일에_쓰이고_모르는_칸을_지킨다() {
        let root = tempfile::tempdir().unwrap();
        let dir = work(root.path(), "cart");
        assert_eq!(read_policy(root.path(), PolicyPlace::Work("cart")), PolicyFile::default(), "없으면 빈 값이다");

        std::fs::write(dir.join(".policy.json"), r#"{"grants": ["edit"], "later": 1}"#).unwrap();
        let written = update_policy(root.path(), PolicyPlace::Work("cart"), |file| {
            file.mode = Some("edits".into());
            file.grants.push("Bash(pnpm test *)".into());
        })
        .unwrap();
        assert_eq!(written.grants, ["edit", "Bash(pnpm test *)"]);
        let read = read_policy(root.path(), PolicyPlace::Work("cart"));
        assert_eq!(read, written);
        assert_eq!(read.mode.as_deref(), Some("edits"));
        assert_eq!(read.extra.get("later"), Some(&Value::from(1)), "다른 판이 더한 칸은 다시 써도 남는다");
    }

    #[test]
    fn 깨진_점_파일은_빈_값으로_읽고_고쳐_쓸_때는_원문을_떠_둔다() {
        let root = tempfile::tempdir().unwrap();
        let dir = work(root.path(), "cart");
        std::fs::write(dir.join(".policy.json"), "{ 깨짐").unwrap();
        assert_eq!(read_policy(root.path(), PolicyPlace::Work("cart")), PolicyFile::default(), "깨졌으면 아무 허락도 없다");

        update_policy(root.path(), PolicyPlace::Work("cart"), |file| file.mode = Some("auto".into())).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join(".policy.json.bak")).unwrap(), "{ 깨짐");
        assert_eq!(read_policy(root.path(), PolicyPlace::Work("cart")).mode.as_deref(), Some("auto"));
    }

    #[test]
    fn 없는_work_폴더는_되살리지_않고_thread의_점_파일은_thread_폴더에_선다() {
        let root = tempfile::tempdir().unwrap();
        assert!(update_policy(root.path(), PolicyPlace::Work("gone"), |file| file.grants.push("edit".into())).is_err());
        assert!(!crate::works_in(root.path()).join("gone").exists(), "보관 · 삭제로 사라진 Work 폴더를 다시 세우지 않는다");
        assert!(update_policy(root.path(), PolicyPlace::Work("../x"), |_| {}).is_err(), "경로를 품은 slug는 거절한다");
        assert_eq!(read_policy(root.path(), PolicyPlace::Work("../x")), PolicyFile::default());

        let thread = crate::thread_dir(root.path(), "20261023-101010").unwrap();
        std::fs::create_dir_all(&thread).unwrap();
        update_policy(root.path(), PolicyPlace::Thread("20261023-101010"), |file| file.grants.push("edit".into())).unwrap();
        assert!(thread.join(".policy.json").is_file());
        assert_eq!(read_policy(root.path(), PolicyPlace::Thread("20261023-101010")).grants, ["edit"]);
    }
}
