//! Project 추가 창의 core(03 구현 스펙 §15) — 폴더 살피기 다섯 갈래, 추가(git init 하고 추가 · 하위 폴더 그대로), 새로 만들기.
//!
//! **git의 이름 · 이메일은 이 실행이 정한다.** 추가와 새로 만들기는 빈 첫 커밋을 하고, 그 커밋은 git 설정의 이름 · 이메일을 읽는다 — 그
//! 값은 기계의 것이라 개발 기계(있음)와 CI 러너(없음)가 갈린다. 이 파일의 시험은 모두 이름이 있는 전역 설정 한 장(`GIT_CONFIG_GLOBAL`)으로
//! 돈다. 이름이 없어 git이 실패하는 길은 따로 한 파일이다(`project_new_without_git_name.rs`) — 같은 실행 안에서 환경을 바꾸면 나란히 도는
//! 시험이 서로의 설정을 읽는다.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use atelier_core::{collapse_home, AddProject, FolderLook};

/// 이 실행의 git 전역 설정 — 이름 · 이메일만 든 한 장. 시스템 설정도 끈다(기계마다 다른 `init.defaultBranch` · 훅이 끼지 않게).
fn git_env() {
    static ONCE: OnceLock<PathBuf> = OnceLock::new();
    ONCE.get_or_init(|| {
        let file = std::env::temp_dir().join(format!("atelier-project-add-{}.gitconfig", std::process::id()));
        std::fs::write(&file, "[user]\n\tname = t\n\temail = t@t\n").unwrap();
        std::env::set_var("GIT_CONFIG_GLOBAL", &file);
        std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
        file
    });
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

/// 빈 첫 커밋 하나가 있는 저장소(브랜치 `main`).
fn repo(dir: &Path) -> PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["commit", "-q", "--allow-empty", "-m", "first"]);
    dir.to_path_buf()
}

/// 화면에 서는 경로 — core가 돌려주는 꼴(심볼릭 링크를 푼 자리를 `~`로 줄인 것)이다.
fn shown(path: &Path) -> String {
    collapse_home(&path.canonicalize().unwrap())
}

struct Place {
    _tmp: tempfile::TempDir,
    at: PathBuf,
    projects: PathBuf,
}

fn place() -> Place {
    git_env();
    let tmp = tempfile::tempdir().unwrap();
    let at = tmp.path().to_path_buf();
    Place { projects: at.join("projects"), at, _tmp: tmp }
}

#[test]
fn 저장소의_뿌리를_고르면_원격과_기준_브랜치를_찾아_둔다() {
    let p = place();
    let web = repo(&p.at.join("web-app"));
    git(&web, &["remote", "add", "origin", "git@github.com:acme/web-app.git"]);
    git(&web, &["branch", "develop"]);

    match atelier_core::inspect_folder(&p.projects, &web) {
        FolderLook::Repo { path, base_branch, remotes, git } => {
            assert_eq!(path, shown(&web));
            assert_eq!(base_branch, "main");
            assert_eq!(remotes, vec!["origin".to_owned()]);
            assert_eq!(git.remote_slug.as_deref(), Some("acme/web-app"));
            assert_eq!(git.local_branches, vec!["develop".to_owned(), "main".to_owned()]);
        }
        other => panic!("저장소의 뿌리가 아니라 {other:?}"),
    }
}

#[test]
fn 저장소의_하위_폴더를_고르면_그_뿌리를_말한다() {
    let p = place();
    let atelier = repo(&p.at.join("atelier"));
    let crates = atelier.join("crates");
    std::fs::create_dir_all(&crates).unwrap();

    match atelier_core::inspect_folder(&p.projects, &crates) {
        FolderLook::Subfolder { path, root, base_branch } => {
            assert_eq!(path, shown(&crates));
            assert_eq!(root, shown(&atelier));
            assert_eq!(base_branch, "main");
        }
        other => panic!("하위 폴더가 아니라 {other:?}"),
    }
}

#[test]
fn git이_아닌_폴더는_git_저장소가_아니라고_말한다() {
    let p = place();
    let notes = p.at.join("notes");
    std::fs::create_dir_all(&notes).unwrap();

    match atelier_core::inspect_folder(&p.projects, &notes) {
        FolderLook::NotGit { path } => assert_eq!(path, shown(&notes)),
        other => panic!("git 아님이 아니라 {other:?}"),
    }
}

#[test]
fn 없는_폴더나_파일은_폴더가_없다고_말한다() {
    let p = place();
    let gone = p.at.join("gone");
    let file = p.at.join("readme.md");
    std::fs::write(&file, "x").unwrap();

    for one in [&gone, &file] {
        match atelier_core::inspect_folder(&p.projects, one) {
            FolderLook::Missing { path } => assert_eq!(path, collapse_home(one)),
            other => panic!("{one:?}: 폴더 없음이 아니라 {other:?}"),
        }
    }
}

#[test]
fn 이미_등록된_폴더는_그_project를_말한다() {
    let p = place();
    let web = repo(&p.at.join("web-app"));
    let added = atelier_core::create_project(&p.projects, &web).unwrap();

    match atelier_core::inspect_folder(&p.projects, &web) {
        FolderLook::Registered { path, project } => {
            assert_eq!(path, shown(&web));
            assert_eq!(project.project.slug, added.project.slug);
        }
        other => panic!("이미 등록됨이 아니라 {other:?}"),
    }
}

#[test]
fn git이_아닌_폴더는_git_init을_고르지_않으면_추가하지_않는다() {
    let p = place();
    let notes = p.at.join("notes");
    std::fs::create_dir_all(&notes).unwrap();

    let refused = atelier_core::add_project(&p.projects, &notes, AddProject::default());
    assert!(matches!(refused, Err(atelier_core::Error::NotGitRepo(_))), "{refused:?}");
    assert!(atelier_core::list_projects(&p.projects).unwrap().is_empty());
    assert!(!notes.join(".git").exists(), "거절이 폴더를 고쳤다");
}

#[test]
fn git_init_하고_추가하면_main과_빈_첫_커밋을_만들고_기준_브랜치_main으로_등록한다() {
    let p = place();
    let notes = p.at.join("notes");
    std::fs::create_dir_all(&notes).unwrap();
    std::fs::write(notes.join("todo.md"), "할 일").unwrap();

    let added = atelier_core::add_project(&p.projects, &notes, AddProject { name: None, init_git: true }).unwrap();

    assert_eq!(added.project.base_branch, "main");
    assert_eq!(added.project.slug, "notes");
    assert_eq!(git(&notes, &["branch", "--show-current"]), "main");
    assert_eq!(git(&notes, &["log", "--format=%s"]), "init", "커밋은 「init」 하나다");
    assert_eq!(git(&notes, &["show", "--name-only", "--format=", "HEAD"]), "", "첫 커밋은 비었다 — 파일을 담지 않는다");
    assert!(notes.join("todo.md").exists(), "파일은 그대로다");
}

#[test]
fn 하위_폴더는_그대로_추가하고_이름_칸은_이름만_정한다() {
    let p = place();
    let atelier = repo(&p.at.join("atelier"));
    let crates = atelier.join("crates");
    std::fs::create_dir_all(&crates).unwrap();

    let added = atelier_core::add_project(&p.projects, &crates, AddProject { name: Some("  러스트 크레이트 ".into()), init_git: false })
        .unwrap();

    assert_eq!(added.project.path, shown(&crates), "뿌리로 바꾸지 않는다 — 사람이 그대로를 골랐다");
    assert_eq!(added.project.name, "러스트 크레이트");
    assert_eq!(added.project.slug, "crates", "slug는 폴더 이름에서 짓는다");
    assert_eq!(added.project.base_branch, "main");
}

#[test]
fn 같은_폴더를_다시_추가하면_있던_project_그대로다() {
    let p = place();
    let web = repo(&p.at.join("web-app"));
    let first = atelier_core::add_project(&p.projects, &web, AddProject { name: Some("웹".into()), init_git: false }).unwrap();

    let again = atelier_core::add_project(&p.projects, &web, AddProject { name: Some("다른 이름".into()), init_git: true }).unwrap();

    assert_eq!(again.project.slug, first.project.slug);
    assert_eq!(again.project.name, "웹", "다시 추가가 이름을 덮지 않는다");
    assert_eq!(atelier_core::list_projects(&p.projects).unwrap().len(), 1);
}

#[test]
fn 새로_만들기는_부모_아래에_폴더를_만들고_main과_빈_첫_커밋으로_등록한다() {
    let p = place();
    let parent = p.at.join("MyProjects");

    let made = atelier_core::new_project(&p.projects, &parent, "Landing Page").unwrap();

    let folder = parent.join("landing-page");
    assert_eq!(made.project.path, shown(&folder), "폴더 이름은 이름에서 짓는다(slug 규칙)");
    assert_eq!(made.project.name, "Landing Page");
    assert_eq!(made.project.slug, "landing-page");
    assert_eq!(made.project.base_branch, "main");
    assert_eq!(git(&folder, &["branch", "--show-current"]), "main");
    assert_eq!(git(&folder, &["log", "--format=%s"]), "init");
    assert_eq!(atelier_core::list_projects(&p.projects).unwrap().len(), 1);
}

#[test]
fn 새로_만들_자리에_무엇이_있으면_만들지_않고_이미_있다고_한다() {
    let p = place();
    let parent = p.at.join("MyProjects");
    let web = parent.join("web-app");
    std::fs::create_dir_all(&web).unwrap();
    std::fs::write(parent.join("notes"), "파일").unwrap();

    for (name, there) in [("web-app", &web), ("notes", &parent.join("notes"))] {
        match atelier_core::new_project(&p.projects, &parent, name) {
            Err(atelier_core::Error::AlreadyExists(path)) => assert_eq!(path, collapse_home(there)),
            other => panic!("{name}: 이미 있음이 아니라 {other:?}"),
        }
    }
    assert!(!web.join(".git").exists(), "있는 폴더를 건드렸다");
    assert!(atelier_core::list_projects(&p.projects).unwrap().is_empty());
}

#[test]
fn 새로_만들_자리는_부모와_이름에서_짓고_그_자리에_무엇이_있는지_말한다() {
    let p = place();
    let parent = p.at.join("MyProjects");
    std::fs::create_dir_all(parent.join("web-app")).unwrap();

    let free = atelier_core::new_project_place(&parent, "Landing Page");
    assert_eq!(free.parent, collapse_home(&parent));
    assert_eq!(free.path.as_deref(), Some(collapse_home(&parent.join("landing-page")).as_str()));
    assert!(!free.taken);

    assert!(atelier_core::new_project_place(&parent, "web-app").taken);

    let unnamed = atelier_core::new_project_place(&parent, "  ");
    assert_eq!(unnamed.path, None, "이름이 없으면 자리도 없다");
    assert!(!unnamed.taken);
}
