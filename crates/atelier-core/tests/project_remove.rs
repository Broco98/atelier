//! Project 제거 · 되돌리기 · 제거 확인 읽기(03 구현 스펙 §15 「제거」 · 「되돌리기」 · S10).
//!
//! 등록부 · Space · Work 파일을 손으로 세운 데이터 루트 하나에서 잰다 — git을 묻지 않는다(제거는 폴더 · git 기록을 건드리지 않는다).

use std::path::{Path, PathBuf};

use atelier_core::{ListingSpace, ProjectRemoval, ProjectUsage, UsingWork};

struct Home {
    _tmp: tempfile::TempDir,
    root: PathBuf,
}

impl Home {
    fn projects(&self) -> PathBuf {
        atelier_core::projects_in(&self.root)
    }

    /// 등록된 Project 하나 — 폴더는 데이터 루트 밖 자리(있든 없든 제거는 보지 않는다).
    fn project(&self, slug: &str) -> &Self {
        let file = format!("---\nname: {slug}\npath: {}\nbaseBranch: main\ncreatedAt: 2026-10-01\n---\n", self.folder(slug).display());
        write(&self.projects().join(format!("{slug}.md")), &file);
        self
    }

    fn folder(&self, slug: &str) -> PathBuf {
        self.root.join("code").join(slug)
    }

    fn space(&self, slug: &str, text: &str) -> &Self {
        write(&atelier_core::spaces_in(&self.root).join(format!("{slug}.md")), text);
        self
    }

    fn space_text(&self, slug: &str) -> String {
        std::fs::read_to_string(atelier_core::spaces_in(&self.root).join(format!("{slug}.md"))).unwrap()
    }

    /// 진행 중인 Work(`works/`) 하나.
    fn work(&self, slug: &str, title: &str, branch: &str, projects: &[&str]) -> &Self {
        write(&atelier_core::works_in(&self.root).join(slug).join("work.json"), &work_json(title, branch, projects));
        self
    }

    /// 보관된 Work(`archive/`) 하나.
    fn archived(&self, slug: &str, title: &str, branch: &str, projects: &[&str]) -> &Self {
        write(&atelier_core::archive_in(&self.root).join(slug).join("work.json"), &work_json(title, branch, projects));
        self
    }

    fn registered(&self) -> Vec<String> {
        atelier_core::list_projects(&self.projects()).unwrap().into_iter().map(|view| view.project.slug).collect()
    }
}

fn home() -> Home {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    Home { root, _tmp: tmp }
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn work_json(title: &str, branch: &str, projects: &[&str]) -> String {
    serde_json::json!({ "title": title, "status": "active", "branch": branch, "createdAt": "2026-10-20", "projects": projects }).to_string()
}

fn work(slug: &str, title: &str, branch: &str) -> UsingWork {
    UsingWork { slug: slug.into(), title: title.into(), branch: Some(branch.into()) }
}

#[test]
fn 진행_중인_work가_고치는_project는_제거하지_않고_그_work들을_돌려준다() {
    let home = home();
    home.project("api-server").project("web-app");
    home.work("refund-api", "환불 API 버그 수정", "fix/refund-api", &["api-server"])
        .work("checkout", "결제 페이지 리디자인", "feat/checkout-redesign", &["web-app", "api-server"])
        .work("docs", "문서 사이트 이전", "chore/docs", &["web-app"]);

    let removal = atelier_core::remove_project(&home.root, "api-server").unwrap();

    let ProjectRemoval::Blocked { mut works } = removal else { panic!("막혀야 한다: {removal:?}") };
    works.sort_by(|a, b| a.slug.cmp(&b.slug));
    assert_eq!(
        works,
        vec![work("checkout", "결제 페이지 리디자인", "feat/checkout-redesign"), work("refund-api", "환불 API 버그 수정", "fix/refund-api")]
    );
    assert_eq!(home.registered(), vec!["api-server", "web-app"], "막히면 등록부를 건드리지 않는다");
}

#[test]
fn 보관된_work만_있으면_제거하고_project_파일을_지운_자리로_옮긴다() {
    let home = home();
    home.project("playground").project("web-app");
    let folder = home.folder("playground");
    write(&folder.join("README.md"), "그대로");
    home.archived("old", "지난 실험", "feat/old", &["playground"]);

    let removal = atelier_core::remove_project(&home.root, "playground").unwrap();

    assert_eq!(removal, ProjectRemoval::Removed { spaces: vec![] });
    assert_eq!(home.registered(), vec!["web-app"]);
    assert!(home.projects().join(".deleted").join("playground.md").is_file(), "지운 자리에 파일이 있다");
    assert_eq!(std::fs::read_to_string(folder.join("README.md")).unwrap(), "그대로", "폴더 · 파일은 그대로다");
}

/// 사람이 손으로 적은 Space — 주석 · 모르는 칸 · 본문이 제거 뒤에도 그대로여야 한다.
const PAYMENTS: &str = "---\n# 결제팀이 관리\nname: 결제 서비스\nowner: 결제팀\nprojects:\n  - web-app   # 화면\n  - api-server\n  - backoffice\ncreatedAt: 2026-10-23\n---\n\n결제와 환불을 한 흐름으로 다뤄요.\n";
const TOOLS: &str = "---\nname: 사내 도구\nprojects: [backoffice, api-server]\n---\n";
const DOCS: &str = "---\nname: 문서\nprojects:\n  - web-app\n---\n";

#[test]
fn 제거하면_그_slug를_적은_space_파일에서_그_줄만_빠지고_나머지_글은_남는다() {
    let home = home();
    home.project("web-app").project("api-server").project("backoffice");
    home.space("결제-서비스", PAYMENTS).space("사내-도구", TOOLS).space("문서", DOCS);

    let removal = atelier_core::remove_project(&home.root, "api-server").unwrap();

    let ProjectRemoval::Removed { spaces } = removal else { panic!("제거돼야 한다: {removal:?}") };
    let names: Vec<(&str, &str)> = spaces.iter().map(|space| (space.slug.as_str(), space.name.as_str())).collect();
    assert_eq!(names, vec![("결제-서비스", "결제 서비스"), ("사내-도구", "사내 도구")]);
    assert_eq!(home.space_text("결제-서비스"), PAYMENTS.replace("  - api-server\n", ""));
    assert_eq!(home.space_text("사내-도구"), "---\nname: 사내 도구\nprojects:\n  - backoffice\n---\n", "한 줄 목록은 목록으로 다시 적는다");
    assert_eq!(home.space_text("문서"), DOCS, "적지 않은 Space는 건드리지 않는다");
    for slug in ["결제-서비스", "사내-도구"] {
        assert_eq!(atelier_core::get_space(&home.root, slug).unwrap().problems, vec![], "등록되지 않은 Project가 남지 않는다");
    }
}

#[test]
fn 되돌리면_project_파일과_빠졌던_space의_slug가_제자리에_다시_선다() {
    let home = home();
    home.project("web-app").project("api-server").project("backoffice");
    home.space("결제-서비스", PAYMENTS).space("사내-도구", TOOLS).space("문서", DOCS);
    atelier_core::remove_project(&home.root, "api-server").unwrap();

    let restored = atelier_core::restore_project(&home.root, "api-server").unwrap();

    assert_eq!(restored.project.slug, "api-server");
    assert_eq!(home.registered(), vec!["api-server", "backoffice", "web-app"]);
    assert_eq!(home.space_text("결제-서비스"), PAYMENTS, "뺀 줄이 그 자리에 다시 선다");
    assert_eq!(home.space_text("사내-도구"), "---\nname: 사내 도구\nprojects:\n  - backoffice\n  - api-server\n---\n");
    assert_eq!(home.space_text("문서"), DOCS);
    let deleted: Vec<_> = std::fs::read_dir(home.projects().join(".deleted")).unwrap().collect();
    assert!(deleted.is_empty(), "되돌리면 지운 자리가 빈다");
}

#[test]
fn 되돌리기는_아직_있고_slug가_없는_space에만_다시_넣는다() {
    let home = home();
    home.project("web-app").project("api-server").project("backoffice");
    home.space("결제-서비스", PAYMENTS).space("사내-도구", TOOLS);
    atelier_core::remove_project(&home.root, "api-server").unwrap();
    // 그사이 사람이 사내 도구 Space를 지우고, 결제 서비스 Space에 손으로 다시 적었다
    std::fs::remove_file(atelier_core::spaces_in(&home.root).join("사내-도구.md")).unwrap();
    let by_hand = PAYMENTS.replace("  - api-server\n", "").replace("  - backoffice\n", "  - backoffice\n  - api-server # 다시\n");
    home.space("결제-서비스", &by_hand);

    atelier_core::restore_project(&home.root, "api-server").unwrap();

    assert_eq!(home.space_text("결제-서비스"), by_hand, "이미 든 Space는 건드리지 않는다");
    assert!(!atelier_core::spaces_in(&home.root).join("사내-도구.md").exists(), "지운 Space를 되살리지 않는다");
}

#[test]
fn 그사이_같은_slug가_다시_쓰였으면_되돌리지_못하고_새로_선_것을_덮지_않는다() {
    let home = home();
    home.project("playground");
    atelier_core::remove_project(&home.root, "playground").unwrap();
    let again = "---\nname: 새 놀이터\npath: ~/elsewhere/playground\nbaseBranch: main\ncreatedAt: 2026-10-26\n---\n";
    write(&home.projects().join("playground.md"), again);

    let refused = atelier_core::restore_project(&home.root, "playground");

    assert!(matches!(refused, Err(atelier_core::Error::SlugReused(ref slug)) if slug == "playground"), "{refused:?}");
    assert_eq!(std::fs::read_to_string(home.projects().join("playground.md")).unwrap(), again);
}

#[test]
fn 그사이_같은_폴더가_다른_slug로_다시_추가됐으면_되돌리지_못한다() {
    let home = home();
    home.project("playground");
    let kept = std::fs::read_to_string(home.projects().join("playground.md")).unwrap();
    atelier_core::remove_project(&home.root, "playground").unwrap();
    write(&home.projects().join("playground-2.md"), &kept);

    let refused = atelier_core::restore_project(&home.root, "playground");

    assert!(matches!(refused, Err(atelier_core::Error::AlreadyRegistered { ref slug, .. }) if slug == "playground-2"), "{refused:?}");
    assert_eq!(home.registered(), vec!["playground-2"], "한 폴더가 두 Project가 되지 않는다");
}

#[test]
fn 지운_자리는_slug마다_마지막_하나이고_되돌릴_것이_없으면_찾지_못한다() {
    let home = home();
    home.project("web-app").project("api-server");
    home.space("결제-서비스", PAYMENTS);
    atelier_core::remove_project(&home.root, "api-server").unwrap();
    atelier_core::restore_project(&home.root, "api-server").unwrap();
    // 둘째 제거 전에 Space에서 손으로 뺐다 — 마지막 제거는 Space를 지우지 않았다
    home.space("결제-서비스", &PAYMENTS.replace("  - api-server\n", ""));
    atelier_core::remove_project(&home.root, "api-server").unwrap();

    atelier_core::restore_project(&home.root, "api-server").unwrap();

    assert_eq!(home.space_text("결제-서비스"), PAYMENTS.replace("  - api-server\n", ""), "앞선 제거의 기록으로 되돌리지 않는다");
    assert!(matches!(atelier_core::restore_project(&home.root, "api-server"), Err(atelier_core::Error::NotFound(_))));
    assert!(matches!(atelier_core::restore_project(&home.root, "../projects/web-app"), Err(atelier_core::Error::NotFound(_))));
}

#[test]
fn 제거_확인_읽기는_이_project를_적은_space와_고치는_진행_중인_work다() {
    let home = home();
    home.project("web-app").project("api-server").project("backoffice");
    home.space("결제-서비스", PAYMENTS).space("사내-도구", TOOLS).space("문서", DOCS);
    home.work("refund-api", "환불 API 버그 수정", "fix/refund-api", &["api-server"]).work("docs", "문서 사이트 이전", "chore/docs", &["web-app"]);
    home.archived("old", "지난 실험", "feat/old", &["backoffice"]);

    let usage = atelier_core::project_usage(&home.root, "api-server").unwrap();

    let space = |slug: &str, name: &str| ListingSpace { slug: slug.into(), name: name.into() };
    assert_eq!(
        usage,
        ProjectUsage {
            spaces: vec![space("결제-서비스", "결제 서비스"), space("사내-도구", "사내 도구")],
            works: vec![work("refund-api", "환불 API 버그 수정", "fix/refund-api")],
        }
    );
    assert_eq!(
        atelier_core::project_usage(&home.root, "backoffice").unwrap().works,
        vec![],
        "보관된 Work는 세지 않는다"
    );
    assert!(matches!(atelier_core::project_usage(&home.root, "없음"), Err(atelier_core::Error::NotFound(_))));
}
