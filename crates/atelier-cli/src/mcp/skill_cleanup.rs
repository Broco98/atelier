//! 유령 스킬 정리 — 없어진 CLI를 안내하는 스킬 폴더를 제거한다 (Δ4 · Δ11).
//!
//! 서버 기동(`atelier mcp`)과 등록 명령(`atelier mcp install`)이 **같은 동작**을
//! 공유한다. 정리 로직은 이 파일 밖 어디에도 없다.
//!
//! 규칙 셋:
//! 1. 멱등 — 없으면 아무 일도 일어나지 않는다.
//! 2. 실패해도 호출자를 죽이지 않는다 — 정리 실패가 도구 표면 전체를 막는 것이 더 나쁘다.
//! 3. 진단은 표준에러로만 — 서버 경로에서 표준출력은 JSON-RPC 전용이다 (Δ13).

use std::path::{Path, PathBuf};

/// 이 제품이 `~/.claude/skills/` 아래에 만든 적 있는 폴더 전부.
/// - `atelier-projects` — 구버전(projects 전용). 삭제된 `skill install`이 이미 정리하던 대상.
/// - `atelier` — 그 `skill install`이 **설치하던** 폴더. 티켓 05가 자산을 지운 뒤 유령이 됐다.
const GHOST_SKILLS: [&str; 2] = ["atelier", "atelier-projects"];

/// 스킬 루트. `ATELIER_SKILLS_DIR`은 테스트용 내부 오버라이드
/// (커널 `paths.rs`의 `ATELIER_HOME`과 같은 관례).
pub fn skills_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("ATELIER_SKILLS_DIR") {
        return Some(PathBuf::from(dir));
    }
    dirs::home_dir().map(|home| home.join(".claude/skills"))
}

/// 정리 결과. 어디에 출력할지는 호출자가 정한다 — 이 모듈은 아무것도 찍지 않는다.
#[derive(Debug, Default)]
pub struct Purged {
    pub removed: Vec<PathBuf>,
    pub failed: Vec<(PathBuf, std::io::Error)>,
}

/// 주어진 스킬 루트에서 유령 폴더를 지운다. 멱등하고, 실패해도 나머지를 계속 시도한다.
pub fn purge_in(skills_root: &Path) -> Purged {
    let mut purged = Purged::default();
    for name in GHOST_SKILLS {
        let dir = skills_root.join(name);
        if !dir.exists() {
            continue;
        }
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => purged.removed.push(dir),
            Err(e) => purged.failed.push((dir, e)),
        }
    }
    purged
}

/// 기본 위치를 정리하고 진단을 표준에러로 남긴다. **절대 실패를 전파하지 않는다.**
pub fn purge_and_report() {
    let Some(root) = skills_dir() else {
        return; // 홈을 못 찾는 환경. 정리할 것도 없다.
    };
    let purged = purge_in(&root);
    for dir in &purged.removed {
        eprintln!("유령 스킬 제거됨: {}", dir.display());
    }
    for (dir, e) in &purged.failed {
        eprintln!("유령 스킬을 지우지 못했습니다 (무시하고 계속): {} — {e}", dir.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Δ11 — 지금까지 `atelier skill install`이 만든 적 있는 폴더를 전부 지운다.
    /// 05 §6: 삭제된 main.rs는 `atelier-projects`만 지웠지만, 자기가 설치하던
    /// `atelier`는 남겼다. 이제 둘 다 유령이다.
    #[test]
    fn both_generations_of_the_installed_skill_are_removed() {
        let root = tempfile::tempdir().unwrap();
        for name in ["atelier", "atelier-projects"] {
            let dir = root.path().join(name);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("SKILL.md"), "ghost").unwrap();
        }

        let purged = purge_in(root.path());

        assert!(!root.path().join("atelier").exists());
        assert!(!root.path().join("atelier-projects").exists());
        assert_eq!(purged.removed.len(), 2, "지운 것을 전부 보고해야 한다: {purged:?}");
        assert!(purged.failed.is_empty(), "{purged:?}");
    }

    /// V9 후반 — 두 번째 기동에서도 오류 없이 넘어간다.
    /// 스킬 루트 자체가 없는 환경(스킬을 한 번도 설치한 적 없는 사용자)도 같은 경로다.
    #[test]
    fn purging_twice_is_quiet_and_reports_nothing_the_second_time() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("atelier")).unwrap();

        let first = purge_in(root.path());
        assert_eq!(first.removed.len(), 1);

        let second = purge_in(root.path());
        assert!(second.removed.is_empty(), "두 번째는 지울 것이 없다: {second:?}");
        assert!(second.failed.is_empty(), "없는 폴더는 오류가 아니다: {second:?}");

        let missing = purge_in(&root.path().join("nope"));
        assert!(missing.removed.is_empty() && missing.failed.is_empty(), "{missing:?}");
    }

    /// 우리가 만든 적 없는 것은 지우지 않는다 (§0.3).
    #[test]
    fn unrelated_skills_are_left_alone() {
        let root = tempfile::tempdir().unwrap();
        let other = root.path().join("someone-elses-skill");
        std::fs::create_dir_all(&other).unwrap();
        // 이름이 겹쳐 보이지만 우리 것이 아니다
        let lookalike = root.path().join("atelier-notes");
        std::fs::create_dir_all(&lookalike).unwrap();

        purge_in(root.path());

        assert!(other.exists(), "남의 스킬을 지웠다");
        assert!(lookalike.exists(), "접두사만 같은 폴더를 지웠다");
    }

    /// `ATELIER_SKILLS_DIR`이 기본 위치를 덮는다 (§0.4).
    /// 이 오버라이드가 없으면 `cargo test`가 개발자의 실제 홈을 변형한다.
    #[test]
    fn the_test_override_wins_over_the_home_directory() {
        // 환경변수는 프로세스 전역이라 다른 테스트와 섞이면 안 된다.
        // 이 테스트만 값을 세우고 즉시 확인한 뒤 지운다.
        let root = tempfile::tempdir().unwrap();
        std::env::set_var("ATELIER_SKILLS_DIR", root.path());
        let resolved = skills_dir();
        std::env::remove_var("ATELIER_SKILLS_DIR");
        assert_eq!(resolved.as_deref(), Some(root.path()));
    }
}
