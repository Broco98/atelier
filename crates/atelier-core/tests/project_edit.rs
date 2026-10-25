//! Project 상세의 core(03 구현 스펙 §15) — 브랜치 목록(로컬 · 원격), 고치기(기준 브랜치는 목록에 있는 값만), 재설정(git 저장소의 뿌리만 ·
//! 경로만), 원격 기준 브랜치에서 갈라지는 Work.
//!
//! **원격 브랜치는 fetch 없이 세운다** — `refs/remotes/<원격>/<이름>`을 손으로 적는다. core는 fetch하지 않고 저장소에 있는 remote-tracking
//! 브랜치만 읽으므로, 시험도 네트워크 없이 그 자리만 채운다. git 이름 · 이메일은 `project_add.rs`처럼 이 실행이 정한다.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use atelier_core::{collapse_home, ProjectPatch, RemoteBranches};
use common::{git, place, repo, Place};

/// 원격 하나와 그 remote-tracking 브랜치들 — fetch한 뒤의 모양을 손으로 적는다. `origin/HEAD`도 fetch(clone)처럼 세운다.
fn remote(dir: &Path, name: &str, branches: &[&str]) {
    git(dir, &["remote", "add", name, &format!("git@github.com:acme/{name}.git")]);
    for branch in branches {
        git(dir, &["update-ref", &format!("refs/remotes/{name}/{branch}"), "HEAD"]);
    }
    git(dir, &["symbolic-ref", &format!("refs/remotes/{name}/HEAD"), &format!("refs/remotes/{name}/{}", branches[0])]);
}


/// web-app — 로컬 `develop` · `main`, 원격 origin(`main` · `develop` · `release/2.5`)과 upstream(`main`)이 있는 저장소를 등록한다.
fn web_app(p: &Place) -> PathBuf {
    let web = repo(&p.at.join("web-app"));
    git(&web, &["branch", "develop"]);
    remote(&web, "origin", &["main", "develop", "release/2.5"]);
    remote(&web, "upstream", &["main"]);
    atelier_core::create_project(&p.projects, &web).unwrap();
    web
}

#[test]
fn 브랜치_목록은_로컬과_원격_이름마다의_remote_tracking_브랜치다() {
    let p = place();
    web_app(&p);

    let git = atelier_core::get_project(&p.projects, "web-app").unwrap().git.expect("git 저장소");
    assert_eq!(git.local_branches, vec!["develop".to_owned(), "main".to_owned()]);
    // 원격 브랜치는 원격 이름을 단 그대로다(S19) — 원격의 `HEAD`(가리키는 이름일 뿐인 자리)는 고를 브랜치가 아니다.
    assert_eq!(
        git.remote_branches,
        vec![
            RemoteBranches {
                remote: "origin".to_owned(),
                branches: vec!["origin/develop".to_owned(), "origin/main".to_owned(), "origin/release/2.5".to_owned()],
            },
            RemoteBranches { remote: "upstream".to_owned(), branches: vec!["upstream/main".to_owned()] },
        ]
    );
}

fn base(branch: &str) -> ProjectPatch {
    ProjectPatch { name: None, description: None, base_branch: Some(branch.to_owned()) }
}

#[test]
fn 기준_브랜치는_목록에_있는_값만_받고_원격_브랜치는_그_이름_그대로_적는다() {
    let p = place();
    web_app(&p);

    let local = atelier_core::update_project(&p.projects, "web-app", base("develop")).unwrap();
    assert_eq!(local.project.base_branch, "develop");

    // 원격을 고르면 원격 이름을 단 그대로다(S19) — 로컬 이름(`release/2.5`)으로 바꾸면 저장소에 없는 브랜치를 가리킨다.
    let remote = atelier_core::update_project(&p.projects, "web-app", base("origin/release/2.5")).unwrap();
    assert_eq!(remote.project.base_branch, "origin/release/2.5");
    assert_eq!(atelier_core::get_project(&p.projects, "web-app").unwrap().project.base_branch, "origin/release/2.5");
}

#[test]
fn 목록에_없는_기준_브랜치와_빈_값은_거절하고_아무것도_바꾸지_않는다() {
    let p = place();
    web_app(&p);

    for wrong in ["release/2.5", "feature/없음", "", "  "] {
        let refused = atelier_core::update_project(&p.projects, "web-app", base(wrong));
        assert!(
            matches!(&refused, Err(atelier_core::Error::BranchNotListed(branch)) if branch == wrong.trim()),
            "{wrong:?}: {refused:?}"
        );
    }
    // 이름 · 설명을 함께 고쳐도 기준 브랜치가 틀리면 하나도 쓰지 않는다.
    let mixed = ProjectPatch { name: Some("웹".into()), description: Some("설명".into()), base_branch: Some("없음".into()) };
    assert!(atelier_core::update_project(&p.projects, "web-app", mixed).is_err());
    let kept = atelier_core::get_project(&p.projects, "web-app").unwrap().project;
    assert_eq!((kept.name.as_str(), kept.description.as_str(), kept.base_branch.as_str()), ("web-app", "", "main"));
}

/// 화면에 서는 경로 — core가 돌려주는 꼴(심볼릭 링크를 푼 자리를 `~`로 줄인 것)이다.
fn shown(path: &Path) -> String {
    collapse_home(&path.canonicalize().unwrap())
}

#[test]
fn 재설정은_옮긴_저장소의_뿌리로_경로만_바꾼다() {
    let p = place();
    let web = web_app(&p);
    atelier_core::update_project(
        &p.projects,
        "web-app",
        ProjectPatch { name: Some("웹 앱".into()), description: Some("고객이 쓰는 앱".into()), base_branch: Some("develop".into()) },
    )
    .unwrap();
    let moved = p.at.join("옮긴 곳").join("web-app");
    std::fs::create_dir_all(moved.parent().unwrap()).unwrap();
    std::fs::rename(&web, &moved).unwrap();
    assert!(atelier_core::get_project(&p.projects, "web-app").unwrap().missing, "옮기면 찾을 수 없다");

    let view = atelier_core::relocate_project(&p.projects, "web-app", &moved).unwrap();
    assert_eq!(view.project.path, shown(&moved));
    assert!(!view.missing);
    let reread = atelier_core::get_project(&p.projects, "web-app").unwrap();
    assert_eq!(reread.project.path, shown(&moved));
    // 경로만 바뀐다 — slug(파일 이름) · 이름 · 설명 · 기준 브랜치는 그대로다.
    assert_eq!(
        (reread.project.slug.as_str(), reread.project.name.as_str(), reread.project.description.trim(), reread.project.base_branch.as_str()),
        ("web-app", "웹 앱", "고객이 쓰는 앱", "develop")
    );
    assert!(p.projects.join("web-app.md").is_file());
}

#[test]
fn 재설정은_git_저장소의_뿌리가_아니거나_이미_등록된_폴더를_거절하고_경로를_그대로_둔다() {
    let p = place();
    let web = web_app(&p);
    let before = atelier_core::get_project(&p.projects, "web-app").unwrap().project.path;

    let plain = p.at.join("notes");
    std::fs::create_dir_all(&plain).unwrap();
    let sub = web.join("src");
    std::fs::create_dir_all(&sub).unwrap();
    let api = repo(&p.at.join("api-server"));
    atelier_core::create_project(&p.projects, &api).unwrap();

    let refused = |folder: &Path| atelier_core::relocate_project(&p.projects, "web-app", folder);
    assert!(matches!(refused(&plain), Err(atelier_core::Error::NotGitRepo(_))), "git 아님: {:?}", refused(&plain));
    assert!(
        matches!(refused(&sub), Err(atelier_core::Error::NotRepoRoot { ref root, .. }) if *root == shown(&web)),
        "하위 폴더: {:?}",
        refused(&sub)
    );
    assert!(
        matches!(refused(&api), Err(atelier_core::Error::AlreadyRegistered { ref slug, .. }) if slug == "api-server"),
        "이미 등록: {:?}",
        refused(&api)
    );
    assert!(matches!(refused(&p.at.join("없는 폴더")), Err(atelier_core::Error::FolderMissing(_))));
    assert!(matches!(
        atelier_core::relocate_project(&p.projects, "없는-project", &web),
        Err(atelier_core::Error::NotFound(_))
    ));
    assert_eq!(atelier_core::get_project(&p.projects, "web-app").unwrap().project.path, before, "거절하면 경로는 그대로다");
}

#[test]
fn 원격_기준_브랜치에서_work의_worktree가_갈라지고_그_원격을_upstream으로_삼지_않는다() {
    let p = place();
    let web = web_app(&p);
    // origin/release/2.5만 가진 커밋 — 로컬 main과 갈라진 자리다(fetch한 뒤의 모양).
    git(&web, &["checkout", "-q", "-b", "scratch"]);
    git(&web, &["commit", "-q", "--allow-empty", "-m", "release 2.5"]);
    let release = git(&web, &["rev-parse", "HEAD"]);
    git(&web, &["update-ref", "refs/remotes/origin/release/2.5", &release]);
    git(&web, &["checkout", "-q", "main"]);
    git(&web, &["branch", "-q", "-D", "scratch"]);
    atelier_core::update_project(&p.projects, "web-app", base("origin/release/2.5")).unwrap();

    let report = atelier_core::start_work(
        &p.at.join("works"),
        &p.at.join("archive"),
        &p.projects,
        "릴리스 고치기",
        Some("release-fix"),
        &["web-app".to_owned()],
        Some("fix/release"),
    )
    .unwrap();
    assert!(report.errors.is_empty(), "worktree를 만들지 못했다: {:?}", report.errors);

    let tree = p.at.join("works/release-fix/trees/web-app");
    assert_eq!(git(&tree, &["rev-parse", "HEAD"]), release, "Work의 브랜치는 origin/release/2.5에서 갈라진다");
    assert_eq!(git(&tree, &["branch", "--show-current"]), "fix/release");
    // 원격 브랜치에서 갈라도 그 원격을 따라가지 않는다 — 따라가면 `git push`가 남의 브랜치(release/2.5)로 가려 하고, 상태 줄이 그 브랜치와
    // 견준다. 로컬 기준 브랜치에서 갈라진 Work와 같은 모양(upstream 없음)이다.
    let upstream = Command::new("git").arg("-C").arg(&tree).args(["rev-parse", "--abbrev-ref", "fix/release@{upstream}"]).output().unwrap();
    assert!(!upstream.status.success(), "upstream이 섰다: {}", String::from_utf8_lossy(&upstream.stdout));
}
