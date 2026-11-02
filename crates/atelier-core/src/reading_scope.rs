//! 읽는 범위(03 구현 스펙 §7) — Thread의 Session이 읽기로 함께 여는 Project 폴더들. **함수 하나다**([`reading_scope`]) — Session의
//! 자리(엔진의 함께 여는 폴더), Host의 머리말(「- Service: …」), 트레이의 범위 줄, 요약 카드의 「소스」가 모두 이것을 쓴다. 따로 셈하면
//! 화면이 말하는 범위와 Agent가 읽는 범위가 갈린다(§17).
//!
//! 규칙(§7):
//! 1. Service를 정한다 — Work에 이었으면 그 Work의 `service`, 아니면 Thread의 `service`([`ScopeOf::thread`]). 그 slug의 Service 파일이 없으면
//!    Service가 없는 것이다.
//! 2. 바탕 — Service가 있으면 그 Service의 `projects` 가운데 등록된 것(적힌 차례), 없으면 등록된 Project 전부(이름 차례).
//! 3. 더한다 — Work의 Project 가운데 아직 worktree가 없는 것, 그리고 「읽기만 하기」로 허락한 Project(`readOnlyProjects`).
//! 4. 뺀다 — 폴더를 찾을 수 없는 Project, 그리고 이 Work에 worktree가 있는 Project(그 Project는 worktree에서 일한다).
//!
//! **고치는 범위는 이것과 상관없다** — 판정(`atelier-acp`의 `gate.rs`)이 고칠 수 있는 자리를 따로 센다. 읽기만 한다.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::threads::ThreadFile;
use crate::work::Work;
use crate::Result;

/// 범위를 셀 자리 — 이은 Work, 정해진 Service(규칙 1을 지난 것), 「읽기만 하기」로 허락한 Project.
#[derive(Debug, Clone, Copy, Default)]
pub struct ScopeOf<'a> {
    /// 이은 Work — 읽어 온 `work.json`. 없으면 Work 없는 Thread다(보내기 전 새 Thread의 「Work 없이 대화」 · 「새 Work」도).
    pub work: Option<&'a Work>,
    /// Service의 slug.
    pub service: Option<&'a str>,
    pub read_only: &'a [String],
}

impl<'a> ScopeOf<'a> {
    /// Thread 하나의 자리 — 규칙 1이 여기 있다. Work에 이은 Thread는 그 Work의 `service`를 따르고 Thread의 칸은 보지 않는다(§9). 이은
    /// Work를 읽지 못했으면(보관 · 지움) Service도 없다.
    pub fn thread(file: &'a ThreadFile, work: Option<&'a Work>) -> Self {
        let service = match &file.work {
            Some(_) => work.and_then(|work| work.service.as_deref()),
            None => file.service.as_deref(),
        };
        Self { work: work.filter(|_| file.work.is_some()), service, read_only: &file.read_only_projects }
    }
}

/// 읽는 범위 — 화면이 받는 모양 그대로다(앱 명령 `reading_scope`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingScope {
    /// 정해진 Service — 그 파일이 있을 때만 선다.
    pub service: Option<ScopeService>,
    /// 읽는 Project — 함께 여는 폴더의 차례다(바탕 → Work → 읽기만).
    pub projects: Vec<ScopeProject>,
    /// 이 Work의 worktree에서 일하는 Project(규칙 4로 뺀 것 — 등록된 것만) — 바탕 차례(Service 파일 · 등록부) 뒤 Work 차례. 범위 줄 ·
    /// Service 줄이 「web-app · api-server를 읽어요」를 이것과 `projects`로 짓는다(worktree가 Service를 다 덮어도 빈 Service가 아니다).
    /// Session의 함께 여는 폴더 · 머리말은 쓰지 않는다.
    pub worked: Vec<WorkedProject>,
    /// 범위 줄의 갈래.
    pub kind: ScopeKind,
    /// 등록된 Project 수 — 「등록된 Project N개를 읽어요」의 N.
    pub registered: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeService {
    pub slug: String,
    /// 보이는 이름 — 파일의 `name`, 읽지 못했으면 slug.
    pub name: String,
    /// 파일에 문제가 있나(검사 — `service.rs`) — 있으면 읽을 수 있는 Project만 읽는다.
    pub troubled: bool,
    /// Service 파일의 자리 — 머리말이 Agent에게 알린다.
    #[serde(skip)]
    pub file: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeProject {
    pub slug: String,
    pub name: String,
    /// 왜 읽나.
    pub why: ScopeWhy,
    /// 함께 여는 폴더 — `~`를 푼 경로.
    #[serde(skip)]
    pub folder: PathBuf,
}

/// worktree에서 일하는 Project 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkedProject {
    pub slug: String,
    pub name: String,
}

/// 왜 읽나(§7 「읽는 Project(slug · 이름 · 왜 읽나)」).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScopeWhy {
    /// 그 Service에 들어 있다.
    Service,
    /// Service가 없어 등록된 Project 전부를 읽는다.
    All,
    /// 이 Work의 Project인데 아직 worktree가 없다.
    Work,
    /// Work 밖 Project 카드에서 「읽기만 하기」로 허락했다.
    ReadOnly,
}

/// 범위 줄의 갈래(§5) — 「등록된 Project N개를 읽어요」 · 「web-app · api-server를 읽어요」 · 「읽는 Project가 없어요」 · 「등록된
/// Project가 없어요 · Project 추가」. 「빈 Service」는 Service 파일에 Project가 하나도 적히지 않았을 때만이다 — 닫히지 않은 파일도 적힌
/// 것을 읽지 못해 빈 것이다. 적힌 것을 worktree가 다 덮었거나 하나도 읽을 수 없어도 `Service`다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScopeKind {
    All,
    Service,
    EmptyService,
    NoProjects,
}

/// 읽는 범위를 센다(§7 규칙 1–4). 파일을 읽기만 한다 — 등록부 · Service 파일 · worktree 자리를 그때 본다. 못 읽는 등록부는 빈 것이다.
pub fn reading_scope(data_root: &Path, of: &ScopeOf) -> ReadingScope {
    let registered = crate::store::read_projects(&crate::paths::projects_in(data_root)).unwrap_or_default();
    // 규칙 1 — 그 slug의 파일이 없으면(지웠다 · 손으로 지웠다 · 경로를 품은 slug) Service가 없다.
    let service = of.service.and_then(|slug| crate::service::get_service(data_root, slug).ok());
    // 이 Work에 worktree가 선 Project — 그 Project는 worktree에서 일한다(규칙 4). 서지 않은 것은 읽기로 더한다(규칙 3).
    let (mut worked, mut waiting) = (Vec::new(), Vec::new());
    if let Some(work) = of.work {
        let places = crate::works::work_places(&crate::paths::works_in(data_root), work);
        for (project, tree) in work.projects.iter().zip(&places.worktrees) {
            if tree.is_dir() { &mut worked } else { &mut waiting }.push(project.as_str());
        }
    }
    let mut projects: Vec<ScopeProject> = Vec::new();
    let mut read = |slug: &str, why: ScopeWhy| {
        if projects.iter().any(|one| one.slug == slug) || worked.iter().any(|one| *one == slug) {
            return;
        }
        let Some(project) = registered.iter().find(|project| project.slug == slug) else { return };
        let folder = crate::expand_home(&project.path);
        // 규칙 4 — 폴더를 찾을 수 없는 Project는 claude에게 넘기지 않는다.
        if folder.is_dir() {
            projects.push(ScopeProject { slug: project.slug.clone(), name: project.name.clone(), why, folder });
        }
    };
    // 규칙 2 — 바탕. 등록되지 않은 것(문제 있는 Service)은 `read`가 건너뛴다.
    match &service {
        Some(service) => service.projects.iter().for_each(|slug| read(slug, ScopeWhy::Service)),
        None => registered.iter().for_each(|project| read(&project.slug, ScopeWhy::All)),
    }
    // 규칙 3 — 바탕에 이미 든 것은 그 까닭 그대로다.
    waiting.iter().for_each(|slug| read(slug, ScopeWhy::Work));
    of.read_only.iter().for_each(|slug| read(slug, ScopeWhy::ReadOnly));
    let kind = match &service {
        _ if registered.is_empty() => ScopeKind::NoProjects,
        Some(service) if service.projects.is_empty() => ScopeKind::EmptyService,
        Some(_) => ScopeKind::Service,
        None => ScopeKind::All,
    };
    // worktree에서 일하는 Project — 바탕 차례 뒤 Work 차례, 등록된 것만 한 번씩.
    let base: Vec<&str> = match &service {
        Some(service) => service.projects.iter().map(String::as_str).collect(),
        None => registered.iter().map(|project| project.slug.as_str()).collect(),
    };
    let mut worked_in: Vec<WorkedProject> = Vec::new();
    for slug in base.into_iter().chain(worked.iter().copied()).filter(|slug| worked.contains(slug)) {
        if worked_in.iter().any(|one| one.slug == slug) {
            continue;
        }
        if let Some(project) = registered.iter().find(|project| project.slug == slug) {
            worked_in.push(WorkedProject { slug: project.slug.clone(), name: project.name.clone() });
        }
    }
    let service = service.map(|service| ScopeService {
        name: service.shown_name().to_owned(),
        troubled: !service.problems.is_empty(),
        file: service.file_in(data_root),
        slug: service.slug,
    });
    ReadingScope { service, projects, worked: worked_in, kind, registered: registered.len() }
}

/// 앱이 묻는 읽는 범위(명령 `reading_scope`) — `thread`가 있으면 그 Thread(`thread.json`과 이은 Work를 읽는다), 없으면 보내기 전의 새
/// Thread(입력창이 쥔 Work · Service)다. 새 Thread의 Service는 입력창이 쥔 것 그대로다 — 최근 Work를 고르면 입력창이 그 Work의 Service를
/// 쥐고, 바꾼 Service는 첫 말 때 그 Work에 적는다(03 S4). 없는 Thread · 없는 Work는 그 까닭으로 실패한다. Thread와 입력창의 Work · Service를
/// 함께 주면 거절한다 — Thread의 범위는 그 파일이 정해, 함께 준 것을 말없이 버리게 된다.
pub fn reading_scope_of(data_root: &Path, thread: Option<&str>, work: Option<&str>, service: Option<&str>) -> Result<ReadingScope> {
    let works = crate::paths::works_in(data_root);
    if thread.is_some() && (work.is_some() || service.is_some()) {
        return Err(crate::Error::Validation("읽는 범위는 Thread 하나이거나 입력창의 Work · Service다 — 둘을 함께 주지 않는다".to_owned()));
    }
    if let Some(thread) = thread {
        let file = crate::threads::read_thread(data_root, thread)?;
        let work = file.work.as_deref().and_then(|slug| crate::works::read_work(&works, slug).ok());
        return Ok(reading_scope(data_root, &ScopeOf::thread(&file, work.as_ref())));
    }
    let work = work.map(|slug| crate::works::read_work(&works, slug)).transpose()?;
    Ok(reading_scope(data_root, &ScopeOf { work: work.as_ref(), service, read_only: &[] }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 데이터 루트 하나 — 등록된 Project(파일만, git을 묻지 않는다). 폴더는 루트 곁 `repos/<slug>`에 세운다 — `missing`이면 세우지 않는다.
    struct Home {
        dir: tempfile::TempDir,
    }

    impl Home {
        fn new() -> Self {
            Self { dir: tempfile::tempdir().unwrap() }
        }

        fn root(&self) -> PathBuf {
            self.dir.path().join("home")
        }

        fn folder(&self, slug: &str) -> PathBuf {
            self.dir.path().join("repos").join(slug)
        }

        /// Project 하나를 등록한다 — 이름은 slug와 같다.
        fn register(&self, slug: &str) -> &Self {
            std::fs::create_dir_all(self.folder(slug)).unwrap();
            self.register_missing(slug)
        }

        /// 폴더 없이 등록한다 — 등록 뒤 옮기거나 지운 저장소.
        fn register_missing(&self, slug: &str) -> &Self {
            let projects = crate::paths::projects_in(&self.root());
            std::fs::create_dir_all(&projects).unwrap();
            let file = format!(
                "---\nname: {slug}\npath: {}\nbaseBranch: main\ncreatedAt: 2026-10-01\n---\n",
                self.folder(slug).display()
            );
            std::fs::write(projects.join(format!("{slug}.md")), file).unwrap();
            self
        }

        fn service(&self, slug: &str, text: &str) {
            let services = crate::paths::services_in(&self.root());
            std::fs::create_dir_all(&services).unwrap();
            std::fs::write(services.join(format!("{slug}.md")), text).unwrap();
        }
    }

    /// 범위의 (slug, 왜) 차례.
    fn read(scope: &ReadingScope) -> Vec<(&str, ScopeWhy)> {
        scope.projects.iter().map(|project| (project.slug.as_str(), project.why)).collect()
    }

    #[test]
    fn service가_없으면_등록된_project를_이름_차례로_모두_읽는다() {
        let home = Home::new();
        home.register("web-app").register("api-server").register("backoffice");

        let scope = reading_scope(&home.root(), &ScopeOf::default());

        assert_eq!(read(&scope), [("api-server", ScopeWhy::All), ("backoffice", ScopeWhy::All), ("web-app", ScopeWhy::All)]);
        assert_eq!((scope.service.clone(), scope.kind, scope.registered), (None, ScopeKind::All, 3));
        assert_eq!(scope.projects[0].folder, home.folder("api-server"), "함께 여는 폴더는 등록부의 자리다");
    }

    #[test]
    fn service가_있으면_그_service에_적힌_차례로_그_project만_읽는다() {
        let home = Home::new();
        home.register("web-app").register("api-server").register("backoffice");
        home.service("결제-서비스", "---\nname: 결제 서비스\nprojects:\n  - web-app\n  - api-server\n---\n");

        let scope = reading_scope(&home.root(), &ScopeOf { service: Some("결제-서비스"), ..ScopeOf::default() });

        assert_eq!(read(&scope), [("web-app", ScopeWhy::Service), ("api-server", ScopeWhy::Service)]);
        assert_eq!(
            scope.service,
            Some(ScopeService {
                slug: "결제-서비스".into(),
                name: "결제 서비스".into(),
                troubled: false,
                file: crate::paths::services_in(&home.root()).join("결제-서비스.md"),
            })
        );
        assert_eq!((scope.kind, scope.registered), (ScopeKind::Service, 3));
    }

    #[test]
    fn 그_slug의_service_파일이_없으면_service가_없는_것이다() {
        let home = Home::new();
        home.register("web-app");

        let scope = reading_scope(&home.root(), &ScopeOf { service: Some("지운-것"), ..ScopeOf::default() });

        assert_eq!((scope.service.clone(), scope.kind), (None, ScopeKind::All));
        assert_eq!(read(&scope), [("web-app", ScopeWhy::All)]);
    }

    #[test]
    fn 빈_service는_읽는_project가_없고_등록이_없으면_등록_없음이다() {
        let home = Home::new();
        home.service("빈-것", "---\nname: 빈 것\nprojects: []\n---\n");
        let none = reading_scope(&home.root(), &ScopeOf { service: Some("빈-것"), ..ScopeOf::default() });
        assert_eq!((none.kind, none.registered), (ScopeKind::NoProjects, 0), "등록된 Project가 없으면 Service가 있어도 「등록 없음」이다");

        home.register("web-app");
        let empty = reading_scope(&home.root(), &ScopeOf { service: Some("빈-것"), ..ScopeOf::default() });
        assert_eq!((read(&empty), empty.kind), (vec![], ScopeKind::EmptyService));
        assert_eq!(empty.service.map(|service| service.name), Some("빈 것".to_owned()));
        assert_eq!(reading_scope(&home.root(), &ScopeOf::default()).kind, ScopeKind::All);
    }

    #[test]
    fn 문제_있는_service는_읽을_수_있는_project만_읽는다() {
        let home = Home::new();
        home.register("web-app").register("api-server");
        home.service("반쯤", "---\nname: 반쯤\nprojects:\n  - billing\n  - api-server\n  - api-server\n---\n");
        home.service("깨짐", "---\nname: 깨짐\nprojects:\n  - web-app\n");

        let half = reading_scope(&home.root(), &ScopeOf { service: Some("반쯤"), ..ScopeOf::default() });
        assert_eq!(read(&half), [("api-server", ScopeWhy::Service)], "등록되지 않은 것은 빼고 두 번 적은 것은 한 번이다");
        assert!(half.service.is_some_and(|service| service.troubled));

        let broken = reading_scope(&home.root(), &ScopeOf { service: Some("깨짐"), ..ScopeOf::default() });
        assert_eq!((read(&broken), broken.kind), (vec![], ScopeKind::EmptyService), "닫히지 않은 파일은 Project를 읽을 수 없다");
        let service = broken.service.expect("파일은 있다");
        assert_eq!((service.name.as_str(), service.troubled), ("깨짐", true));
    }

    /// Work `refund` — `projects`를 적고, `trees`에 든 Project만 worktree 폴더가 선다.
    fn work(home: &Home, projects: &[&str], trees: &[&str], service: Option<&str>) -> Work {
        work_named(home, "refund", projects, trees, service)
    }

    fn work_named(home: &Home, slug: &str, projects: &[&str], trees: &[&str], service: Option<&str>) -> Work {
        let work = Work {
            slug: slug.into(),
            title: "환불".into(),
            status: crate::WorkStatus::Active,
            branch: Some("fix/refund".into()),
            created_at: "2026-10-01".into(),
            projects: projects.iter().map(|one| (*one).to_owned()).collect(),
            pinned: false,
            service: service.map(str::to_owned),
            extra: Default::default(),
        };
        for tree in trees {
            std::fs::create_dir_all(crate::paths::works_in(&home.root()).join(slug).join("trees").join(tree)).unwrap();
        }
        work
    }

    /// 범위 줄의 갈래와 worktree에서 일하는 Project(`worked`) — 「빈 Service」는 Service 파일에 Project가 하나도 적히지 않았을 때만이다
    /// (03 §5 · 스토리 36). worktree가 Service의 Project를 다 덮거나 적힌 것을 하나도 읽을 수 없어도 Project가 있는 Service다 — 화면이 범위
    /// 줄을 `worked`와 `projects`로 짓는다. `worked`는 등록된 것만, 바탕 차례(Service 파일 · 등록부) 뒤 Work 차례다.
    #[test]
    fn 빈_service는_파일에_project가_없을_때만이고_worktree에서_일하는_project는_worked로_선다() {
        let home = Home::new();
        home.register("web-app").register("api-server").register("backoffice").register_missing("gone");
        home.service("결제-서비스", "---\nname: 결제 서비스\nprojects:\n  - web-app\n  - api-server\n---\n");
        home.service("빈-것", "---\nname: 빈 것\nprojects: []\n---\n");
        home.service("남의-것", "---\nname: 남의 것\nprojects:\n  - billing\n  - gone\n---\n");
        let covered = work_named(&home, "covered", &["api-server", "web-app"], &["api-server", "web-app"], None);
        let half = work_named(&home, "half", &["api-server"], &["api-server"], None);
        let mixed = work_named(&home, "mixed", &["backoffice", "ghost", "web-app"], &["backoffice", "ghost", "web-app"], None);
        fn of<'a>(service: Option<&'a str>, work: Option<&'a Work>) -> ScopeOf<'a> {
            ScopeOf { work, service, read_only: &[] }
        }

        let rows: [(&str, ScopeOf, ScopeKind, &[&str], &[&str]); 6] = [
            ("빈 Service", of(Some("빈-것"), None), ScopeKind::EmptyService, &[], &[]),
            ("worktree가 Service의 Project를 다 덮음", of(Some("결제-서비스"), Some(&covered)), ScopeKind::Service, &[], &["web-app", "api-server"]),
            ("일부 덮음", of(Some("결제-서비스"), Some(&half)), ScopeKind::Service, &["web-app"], &["api-server"]),
            ("적힌 것이 등록 안 됨 · 폴더 없음", of(Some("남의-것"), None), ScopeKind::Service, &[], &[]),
            ("Service 없음 — 등록부 차례", of(None, Some(&covered)), ScopeKind::All, &["backoffice"], &["api-server", "web-app"]),
            ("바탕 차례 뒤 Work 차례 · 등록된 것만", of(Some("결제-서비스"), Some(&mixed)), ScopeKind::Service, &["api-server"], &["web-app", "backoffice"]),
        ];
        for (name, of, kind, projects, worked) in rows {
            let scope = reading_scope(&home.root(), &of);
            let read: Vec<&str> = scope.projects.iter().map(|project| project.slug.as_str()).collect();
            let shown: Vec<&str> = scope.worked.iter().map(|project| project.slug.as_str()).collect();
            assert_eq!((scope.kind, read.as_slice(), shown.as_slice()), (kind, projects, worked), "{name}");
        }
        let scope = reading_scope(&home.root(), &of(Some("결제-서비스"), Some(&covered)));
        assert_eq!(
            serde_json::to_value(&scope.worked).unwrap(),
            serde_json::json!([{"slug": "web-app", "name": "web-app"}, {"slug": "api-server", "name": "api-server"}]),
            "앱 명령의 답에 slug · 이름으로 실린다"
        );
        let none = serde_json::to_value(reading_scope(&home.root(), &ScopeOf::default())).unwrap();
        assert_eq!(none["worked"], serde_json::json!([]), "비어도 칸이 선다");
    }

    #[test]
    fn work의_worktree_없는_project와_읽기만_project를_더하고_worktree가_있는_project와_사라진_폴더는_뺀다() {
        let home = Home::new();
        home.register("web-app").register("api-server").register("backoffice").register("docs").register_missing("gone");
        home.service("결제-서비스", "---\nname: 결제 서비스\nprojects:\n  - web-app\n  - api-server\n  - gone\n---\n");
        let work = work(&home, &["api-server", "backoffice"], &["api-server"], Some("결제-서비스"));
        let read_only = vec!["docs".to_owned(), "web-app".to_owned()];

        let scope = reading_scope(&home.root(), &ScopeOf { work: Some(&work), service: Some("결제-서비스"), read_only: &read_only });

        assert_eq!(
            read(&scope),
            [("web-app", ScopeWhy::Service), ("backoffice", ScopeWhy::Work), ("docs", ScopeWhy::ReadOnly)],
            "api-server는 worktree에서 일하고 gone은 폴더가 없다 — 바탕에 이미 든 것은 그 까닭 그대로다"
        );
        assert_eq!(scope.kind, ScopeKind::Service);

        let all = reading_scope(&home.root(), &ScopeOf { work: Some(&work), service: None, read_only: &[] });
        assert_eq!(
            read(&all),
            [("backoffice", ScopeWhy::All), ("docs", ScopeWhy::All), ("web-app", ScopeWhy::All)],
            "Service가 없는 Work도 등록된 Project 전부를 읽는다 — worktree가 선 api-server만 빼고"
        );
        assert_eq!((all.kind, all.registered), (ScopeKind::All, 5));
    }

    #[test]
    fn thread의_service는_work에_이었으면_그_work의_것이고_아니면_thread의_것이다() {
        let home = Home::new();
        let loose = ThreadFile { service: Some("결제-서비스".into()), read_only_projects: vec!["docs".into()], ..ThreadFile::default() };
        let of = ScopeOf::thread(&loose, None);
        assert_eq!((of.work.is_none(), of.service, of.read_only), (true, Some("결제-서비스"), &["docs".to_owned()][..]));

        let work = work(&home, &[], &[], Some("사내-도구"));
        let linked = ThreadFile { work: Some("refund".into()), service: Some("결제-서비스".into()), ..ThreadFile::default() };
        let of = ScopeOf::thread(&linked, Some(&work));
        assert_eq!((of.work.map(|work| work.slug.as_str()), of.service), (Some("refund"), Some("사내-도구")), "Thread의 칸은 보지 않는다");
        assert_eq!(ScopeOf::thread(&linked, None).service, None, "이은 Work를 읽지 못하면 Service도 없다");
    }

    /// 앱이 묻는 범위 — Thread 하나는 `thread.json`과 이은 Work를 읽어 세고, 보내기 전의 새 Thread는 입력창이 쥔 Work · Service로 센다.
    #[test]
    fn 앱이_묻는_범위는_thread_파일이나_입력창이_쥔_work와_service로_센다() {
        let home = Home::new();
        home.register("web-app").register("api-server");
        home.service("결제-서비스", "---\nname: 결제 서비스\nprojects:\n  - web-app\n---\n");
        let works = crate::paths::works_in(&home.root());
        let dir = works.join("refund");
        std::fs::create_dir_all(dir.join("trees/api-server")).unwrap();
        std::fs::write(
            dir.join("work.json"),
            r#"{"title":"환불","status":"active","createdAt":"2026-10-01","projects":["api-server"],"service":"결제-서비스"}"#,
        )
        .unwrap();
        let thread = crate::threads::create_thread(
            &home.root(),
            crate::NewThread { title: "환불".into(), work: Some("refund".into()), ..Default::default() },
            crate::RecordKind::Sent,
            serde_json::json!({"text": "환불"}),
        )
        .unwrap()
        .id;

        let linked = reading_scope_of(&home.root(), Some(&thread), None, None).unwrap();
        assert_eq!(read(&linked), [("web-app", ScopeWhy::Service)], "이은 Work의 Service를 따르고 worktree가 선 api-server는 뺀다");
        assert_eq!(linked.service.map(|service| service.slug).as_deref(), Some("결제-서비스"));

        let fresh = reading_scope_of(&home.root(), None, Some("refund"), None).unwrap();
        assert_eq!((read(&fresh), fresh.kind), (vec![("web-app", ScopeWhy::All)], ScopeKind::All), "입력창이 쥔 Service가 앞선다 — 비웠으면 없다");
        let picked = reading_scope_of(&home.root(), None, None, Some("결제-서비스")).unwrap();
        assert_eq!(read(&picked), [("web-app", ScopeWhy::Service)]);
        assert!(matches!(reading_scope_of(&home.root(), None, Some("nope"), None), Err(crate::Error::WorkNotFound(_))));
        assert!(reading_scope_of(&home.root(), Some("20990101-000000"), None, None).is_err(), "없는 Thread");
        assert!(
            matches!(reading_scope_of(&home.root(), Some(&thread), Some("refund"), None), Err(crate::Error::Validation(_))),
            "Thread의 범위는 그 파일이 정한다 — 입력창의 Work · Service를 함께 주면 말없이 버리지 않고 거절한다"
        );
    }
}
