//! git이 실패하면 아무것도 남지 않는다(03 구현 스펙 §15 · 위험 「git을 앱이 처음 쓴다」) — 사람의 git 이름 · 이메일이 없어 빈 첫 커밋이
//! 실패하는 길이다.
//!
//! **이 실행은 git 이름이 없는 기계다.** 전역 설정 한 장(`GIT_CONFIG_GLOBAL`)이 `user.useConfigOnly`만 들어, git이 이름을 짐작하지도
//! 않는다(이름 없는 CI 러너와 같다). 환경을 실행째 바꾸므로 이름이 있는 시험(`project_add.rs`)과 다른 파일이다.

use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;

use atelier_core::AddProject;

fn no_git_name() {
    static ONCE: OnceLock<()> = OnceLock::new();
    ONCE.get_or_init(|| {
        let file = std::env::temp_dir().join(format!("atelier-no-git-name-{}.gitconfig", std::process::id()));
        std::fs::write(&file, "[user]\n\tuseConfigOnly = true\n").unwrap();
        std::env::set_var("GIT_CONFIG_GLOBAL", &file);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        for name in ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"] {
            std::env::remove_var(name);
        }
    });
}

fn is_git_failure(result: &atelier_core::Result<atelier_core::ProjectView>) -> bool {
    matches!(result, Err(atelier_core::Error::Git(said)) if !said.is_empty())
}

#[test]
fn 새로_만들기가_git에서_실패하면_만든_폴더를_모두_지우고_git의_글로_실패한다() {
    no_git_name();
    let tmp = tempfile::tempdir().unwrap();
    let projects = tmp.path().join("projects");

    // 부모가 있던 자리 — 만든 폴더만 지운다
    let parent = tmp.path().join("MyProjects");
    std::fs::create_dir_all(&parent).unwrap();
    let failed = atelier_core::new_project(&projects, &parent, "landing-page");
    assert!(is_git_failure(&failed), "{failed:?}");
    assert!(!parent.join("landing-page").exists(), "빈 폴더가 남았다");
    assert!(parent.exists(), "있던 부모를 지웠다");

    // 부모가 없던 자리 — 함께 만든 부모까지 지운다
    let fresh = tmp.path().join("Code");
    let failed = atelier_core::new_project(&projects, &fresh, "landing-page");
    assert!(is_git_failure(&failed), "{failed:?}");
    assert!(!fresh.exists(), "함께 만든 부모가 남았다");

    assert!(atelier_core::list_projects(&projects).unwrap().is_empty());
}

#[test]
fn git_init_하고_추가가_git에서_실패하면_세운_git을_걷고_등록하지_않는다() {
    no_git_name();
    let tmp = tempfile::tempdir().unwrap();
    let projects = tmp.path().join("projects");
    let notes = tmp.path().join("notes");
    std::fs::create_dir_all(&notes).unwrap();
    std::fs::write(notes.join("todo.md"), "할 일").unwrap();

    let failed = atelier_core::add_project(&projects, &notes, AddProject { name: None, init_git: true });

    assert!(is_git_failure(&failed), "{failed:?}");
    assert!(!notes.join(".git").exists(), "반쯤 세운 저장소가 남았다");
    assert!(notes.join("todo.md").exists(), "사람의 파일을 지웠다");
    assert!(atelier_core::list_projects(&projects).unwrap().is_empty());
    assert!(!is_repo(&notes));
}

fn is_repo(dir: &Path) -> bool {
    Command::new("git").arg("-C").arg(dir).args(["rev-parse", "--git-dir"]).output().is_ok_and(|out| out.status.success())
}
