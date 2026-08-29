use std::path::{Path, PathBuf};

use crate::work::{parse_work, render_work, WorktreeView, Work, WorkStatus, WorkView};
use crate::{collapse_home, expand_home, git, slugify, Error, Result};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeError {
    pub project: String,
    pub message: String,
}

/// start/attach의 결과. 검증 통과 후 개별 워크트리 생성 실패는
/// 전체 실패가 아니라 `errors`로 보고된다 (성공분 유지, 재실행 멱등).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkReport {
    #[serde(flatten)]
    pub view: WorkView,
    pub errors: Vec<WorktreeError>,
}

/// `slug`를 주면 그것이 디렉터리명이자 브랜치 기본값이고, **재개 판정의 정본**이다.
/// 생략하면 지금까지처럼 제목에서 파생하고 제목으로 재개를 판정한다.
///
/// 제목은 바뀔 수 있으므로 멱등 키가 될 수 없다(`update_work_title` 참조). slug는
/// 불변이라 될 수 있다 — 그래서 slug를 아는 호출자는 제목이 어떻게 바뀌었든 재개된다.
pub fn start_work(
    works_root: &Path,
    archive_root: &Path,
    projects_root: &Path,
    title: &str,
    slug: Option<&str>,
    project_slugs: &[String],
    branch: Option<&str>,
) -> Result<WorkReport> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Validation("title must not be empty".into()));
    }
    // slug는 디렉터리명이 된다 — 경로 구분자가 통과하면 데이터 루트 밖에 폴더가 생긴다.
    // 명시했든 제목에서 파생했든 폴더가 될 값은 하나뿐이므로, 검사도 한 문으로 함께 지난다.
    let explicit_slug = slug.map(str::trim);
    let slug = match explicit_slug {
        Some(slug) => slug.to_string(),
        None => slugify(title),
    };
    if !crate::slug::is_safe_slug(&slug) {
        return Err(Error::Validation(format!(
            "invalid slug '{slug}': it becomes a folder name, so it must not be empty, \
             start with '.', or contain '/' or '\\'"
        )));
    }
    std::fs::create_dir_all(works_root)?;

    // 재개 판정: slug가 있으면 slug가 정본, 없을 때만 제목으로 찾는다 (멱등)
    let existing_work = match explicit_slug {
        Some(_) => match read_work(works_root, &slug) {
            Ok(work) => Some(work),
            // 아카이브에 있는 이름은 새 work가 쓸 수 없고, 재개도 아니다 — 아카이브는
            // 되돌리지 않는다. 아래 주석이 "이미 있으면 재개했을 것"을 근거로 명시 slug의
            // 중복 회피를 생략하는데, 보존소가 정확히 그 전제를 깬다.
            Err(Error::WorkNotFound(_)) if archive_root.join(&slug).is_dir() => {
                return Err(Error::Validation(format!(
                    "slug '{slug}' is already in the archive. Pick another slug — \
                     archiving is not undone."
                )))
            }
            Err(Error::WorkNotFound(_)) => None,
            // 망가진 work.json을 "없음"으로 읽으면 그 위에 덮어쓴다 — 그대로 올린다
            Err(e) => return Err(e),
        },
        None => find_by_title(works_root, title)?,
    };
    let resuming = existing_work.is_some();
    let mut work = match existing_work {
        Some(mut work) => {
            for p in project_slugs {
                if !work.projects.contains(p) {
                    work.projects.push(p.clone());
                }
            }
            work
        }
        None => {
            // slug를 명시했으면 그대로 쓴다 — 이미 있으면 위에서 재개했을 것이므로
            // 여기까지 온 이상 충돌이 아니다. 중복 회피 접미사는 파생 slug에만 붙인다.
            let slug = match explicit_slug {
                Some(_) => slug,
                None => unique_dir_slug(works_root, archive_root, &slug),
            };
            // 브랜치 이름 검사는 여기 없다 — 이름을 정하는 decide_branch가 한다.
            // 여기서 `branch.unwrap_or(&slug)`로 다시 판단하면 결정표를 재구현하게 되고,
            // 실제로 그렇게 두었을 때 재개 경로와 attach_project가 뚫려 있었다.
            Work {
                slug,
                title: title.to_string(),
                status: WorkStatus::Active,
                branch: None,
                created_at: chrono::Local::now().format("%Y-%m-%d").to_string(),
                projects: project_slugs.to_vec(),
                pinned: false,
                extra: Default::default(),
            }
        }
    };
    // 프로젝트가 없으면 워크트리도 없다. 쓰지도 않을 브랜치를 저장소에 남기지 않으려고
    // 이름을 정하지 않고 미룬다 — 첫 프로젝트가 붙을 때 확정된다 (attach_project).
    let nothing_to_decide =
        work.projects.is_empty() && work.branch.is_none() && branch.is_none();
    work.branch = if nothing_to_decide { None } else { Some(decide_branch(&work, branch)?) };

    // 사전검증: 워크트리가 없는 프로젝트 전부를 먼저 검사하고, 하나라도 실패면 아무것도 만들지 않는다
    let dir = works_root.join(&work.slug);
    let pending: Vec<&String> =
        work.projects.iter().filter(|p| !worktrees_dir(&dir).join(p.as_str()).is_dir()).collect();
    let mut reasons = Vec::new();
    let mut repos = Vec::new();
    // 브랜치가 미정이면 프로젝트도 없다 — 검사할 워크트리가 아예 없다는 뜻이다
    if let Some(branch) = work.branch.as_deref() {
        for p in &pending {
            match validate_for_worktree(projects_root, p, branch, resuming) {
                Ok(repo_base) => repos.push(repo_base),
                Err(reason) => reasons.push(format!("{p}: {reason}")),
            }
        }
    }
    if !reasons.is_empty() {
        return Err(Error::Validation(reasons.join("; ")));
    }

    std::fs::create_dir_all(spec_dir(&dir))?;
    // 빈 trees/는 "망가진 워크트리"로 읽힌다 — 만들 것이 있을 때만 만든다
    if !pending.is_empty() {
        std::fs::create_dir_all(worktrees_dir(&dir))?;
    }
    write_work(works_root, &work)?;

    // 검증을 통과한 뒤의 개별 실패는 성공분을 유지한 채 보고만 한다
    let mut errors = Vec::new();
    if let Some(branch) = work.branch.as_deref() {
        for (p, (repo, base)) in pending.iter().zip(repos) {
            let worktree = worktrees_dir(&dir).join(p.as_str());
            if let Err(message) = git::worktree_add(&repo, &worktree, branch, &base) {
                errors.push(WorktreeError { project: p.to_string(), message });
            }
        }
    }

    // 소유권상 work를 다시 읽지 않고 뷰만 파생
    let view = to_view(works_root, work);
    Ok(WorkReport { view, errors })
}

/// 이름을 **무엇으로** 정할지 답하는 유일한 지점. 돌려주기만 하고 저장은 호출부가 한다.
///
/// | work의 branch | 넘긴 branch | 결과 |
/// |---|---|---|
/// | 있음 | 없음 / 같은 값 | 기존 브랜치 그대로 |
/// | 있음 | 다른 값 | 거부 — 한 work는 브랜치 하나를 공유한다 |
/// | 없음 | 있음 | 그 값으로 확정 |
/// | 없음 | 없음 | slug로 확정 |
///
/// **이름을 지금 정할지 말지**는 표 밖, 호출부의 결정이다. 프로젝트도 브랜치도 없이
/// 시작하는 start_work만 이 함수를 부르지 않고 미정으로 남긴다 — 쓰지도 않을 이름을
/// 저장소에 남기지 않으려고. attach_project는 늘 부른다: 프로젝트가 붙는 순간이 곧
/// 이름이 필요해지는 순간이라, 만들 워크트리가 남았는지와는 무관하다.
fn decide_branch(work: &Work, given: Option<&str>) -> Result<String> {
    let decided = match (work.branch.as_deref(), given) {
        (Some(current), Some(given)) if given != current => {
            return Err(Error::Validation(format!(
                "work '{}' already uses branch '{current}'",
                work.slug
            )))
        }
        // 이미 확정된 이름은 그대로 돌려준다. 여기서 다시 검사하면 나쁜 이름이 이미
        // 들어가 있는 work를 여는 것까지 막게 된다 — 막을 것은 **새로 쓰는 것**이다.
        (Some(current), _) => return Ok(current.to_string()),
        (None, Some(given)) => given.to_string(),
        (None, None) => work.slug.clone(),
    };
    // slug에서 파생됐든 직접 넘어왔든, git이 ref로 거부하는 이름이면 워크트리 생성만
    // 실패해 반쪽짜리 work가 남는다. 게다가 확정은 조건 없이 저장되므로 한 번 들어가면
    // 그 work는 영구히 워크트리를 못 갖는다 — 되돌릴 수 없으니 쓰기 전에 막는다.
    //
    // 검사가 **이름을 정하는 이 지점**에 있어야 하는 이유: 이름이 처음 정해지는 자리는
    // 셋(신규 start_work · 미정 work 재개 · attach_project)이고, 그중 하나에만 두었을 때
    // 나머지 둘이 뚫려 있었다.
    if !git::is_valid_branch_name(&decided) {
        return Err(Error::Validation(format!(
            "invalid branch name '{decided}': git will not accept it. \
             Pass a 'branch' git accepts, or a 'slug' that works as one."
        )));
    }
    Ok(decided)
}

/// 검증 통과 시 (저장소 절대경로, baseBranch) 반환.
/// `allow_existing_branch`: 기존 work의 재개/attach는 부분 실패로 브랜치만 남은
/// 상태를 이어가야 하므로 브랜치 충돌을 허용한다 (worktree_add가 채택).
fn validate_for_worktree(
    projects_root: &Path,
    project_slug: &str,
    branch: &str,
    allow_existing_branch: bool,
) -> std::result::Result<(PathBuf, String), String> {
    let view = crate::get_project(projects_root, project_slug)
        .map_err(|_| "project not registered".to_string())?;
    if view.missing {
        return Err(format!("folder does not exist: {}", view.project.path));
    }
    let repo = expand_home(&view.project.path);
    if view.git.is_none() {
        return Err("not a git repository".to_string());
    }
    let base = view.project.base_branch;
    if !git::rev_exists(&repo, &base) {
        return Err(format!("baseBranch '{base}' does not exist"));
    }
    if !allow_existing_branch && git::branch_exists(&repo, branch) {
        return Err(format!("branch '{branch}' already exists"));
    }
    Ok((repo, base))
}

fn find_by_title(works_root: &Path, title: &str) -> Result<Option<Work>> {
    for view in list_works(works_root)? {
        if view.work.title == title {
            return Ok(Some(view.work));
        }
    }
    Ok(None)
}

/// 아카이브 보존소까지 본다. 아카이브에 같은 이름이 있는데 새 work가 그것을 쓰면
/// 단건 조회가 모호해지고, 사람도 두 디렉터리를 오가며 헷갈린다.
fn unique_dir_slug(works_root: &Path, archive_root: &Path, base: &str) -> String {
    let mut slug = base.to_string();
    let mut n = 2;
    while works_root.join(&slug).exists() || archive_root.join(&slug).exists() {
        slug = format!("{base}-{n}");
        n += 1;
    }
    slug
}

fn work_dir(works_root: &Path, slug: &str) -> Result<PathBuf> {
    if !crate::slug::is_safe_slug(slug) {
        return Err(Error::WorkNotFound(slug.to_string()));
    }
    Ok(works_root.join(slug))
}

pub(crate) fn read_work(works_root: &Path, slug: &str) -> Result<Work> {
    let path = work_dir(works_root, slug)?.join("work.json");
    let content =
        std::fs::read_to_string(&path).map_err(|_| Error::WorkNotFound(slug.to_string()))?;
    parse_work(slug, &content)
}

/// 같은 디렉토리 tmp 파일 → rename 원자적 쓰기 (projects와 동일 규칙)
fn write_work(works_root: &Path, work: &Work) -> Result<()> {
    let dir = works_root.join(&work.slug);
    let tmp_path = dir.join(".work.json.tmp");
    std::fs::write(&tmp_path, render_work(work))?;
    std::fs::rename(&tmp_path, dir.join("work.json"))?;
    Ok(())
}

fn to_view(works_root: &Path, work: Work) -> WorkView {
    let dir = works_root.join(&work.slug);
    let worktrees = work
        .projects
        .iter()
        .map(|p| {
            let worktree = worktrees_dir(&dir).join(p);
            let exists = worktree.is_dir();
            WorktreeView {
                project: p.clone(),
                path: collapse_home(&worktree),
                exists,
                dirty: exists && git::is_dirty(&worktree),
            }
        })
        .collect();
    WorkView {
        spec_dir: collapse_home(&spec_dir(&dir)),
        spec_files: spec_files(&dir),
        work,
        worktrees,
    }
}

/// 워크트리가 놓이는 디렉터리 — 같은 규칙이다.
///
/// **응답의 필드 이름은 `worktrees`지만 폴더는 `trees/`다.** git이 등록해 둔 워크트리
/// 경로라 폴더를 옮기면 기존 work가 열리지 않는다. 그 불일치를 아는 자리를 여기 하나로
/// 둔다 — 이름이 두 개인 것은 사실이고, 사실을 일곱 군데에 적어두면 하나가 낡는다.
fn worktrees_dir(work_dir: &Path) -> PathBuf {
    work_dir.join("trees")
}

/// spec 문서를 두는 디렉터리. 뷰가 알려주는 위치와 목록이 읽는 위치가 어긋나지
/// 않도록 경로를 만드는 곳은 여기 하나다 (work_dir와 같은 규칙).
pub(crate) fn spec_dir(work_dir: &Path) -> PathBuf {
    work_dir.join("spec")
}

/// 아카이브 기록의 파일 이름. **spec/ 밖, work 디렉터리 루트다** — spec은 사람과
/// 에이전트가 쓴 것이고 기록은 기계가 뽑은 것이라, 섞으면 장래의 증류가 "의도"와
/// "증거"를 대조할 두 항을 잃는다. spec 안의 파일명은 자유롭게 쓰기로 한 관습이 있어
/// 예약어를 심으면 사용자의 파일과 충돌하기도 한다.
const RECORD_FILE: &str = "record.md";

/// 기록 문서의 뼈대. **렌더러(`render_record`)와 병합 판정(`completeness`)이 같은 문자열을
/// 봐야 한다.** 라벨 한 글자가 한쪽에서만 바뀌면 등급이 조용히 0으로 떨어져 완전한 기록을
/// 빈 섹션으로 덮고, 아카이브에는 되돌리기가 없어 그것이 영구다. 상수를 나눠 쓰는 것으로도
/// 부족해서(누군가 다시 문자열을 박을 수 있다) `the_renderers_own_output_grades_as_written`이
/// **렌더러의 실제 출력**을 판정에 먹여 본다.
const PROJECT_HEADING: &str = "## ";
const HEAD_LABEL: &str = "- 워크트리 HEAD:";
const COMMITS_HEADING: &str = "### 커밋";

/// spec/ 아래 파일들의 상대 경로 (정렬, dotfile 제외)
pub(crate) fn spec_files(work_dir: &Path) -> Vec<String> {
    let mut files = Vec::new();
    collect_files(&spec_dir(work_dir), "", &mut files);
    files.sort();
    files
}

fn collect_files(dir: &Path, prefix: &str, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, &rel, out);
        } else {
            out.push(rel);
        }
    }
}

pub fn list_works(works_root: &Path) -> Result<Vec<WorkView>> {
    std::fs::create_dir_all(works_root)?;
    let mut views = Vec::new();
    for entry in std::fs::read_dir(works_root)? {
        let entry = entry?;
        let slug = entry.file_name().to_string_lossy().to_string();
        if slug.starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        // AI가 망가뜨린 파일 하나가 전체 목록을 막지 않도록 파싱 실패는 건너뜀
        if let Ok(work) = read_work(works_root, &slug) {
            views.push(to_view(works_root, work));
        }
    }
    // **고정이 먼저다** (결정 100). 사이드바가 고정 구획을 맨 위에 세우므로, 그 순서를
    // 화면이 백엔드 순서 위에 얹으면 「보이는 첫 항목 = 무선택 정규화가 고르는 항목」이
    // 갈린다 — 이슈 #58이 정확히 그것이었다. 여기서 먼저 주면 어떤 조합에서도 저절로
    // 성립하고, 앱·MCP·CLI가 같은 순서를 본다.
    views.sort_by(|a, b| {
        b.work
            .pinned
            .cmp(&a.work.pinned)
            .then_with(|| b.work.created_at.cmp(&a.work.created_at))
            .then_with(|| a.work.slug.cmp(&b.work.slug))
    });
    Ok(views)
}

/// **작업 루트만 본다.** 보존소로 넘어가는 폴백은 여기 넣지 않는다 — 데스크톱 앱의
/// 단건 조회가 이 함수를 그대로 부르므로, 여기 넣으면 stale한 slug 하나로 아카이브된
/// work가 Works 화면에 그려진다. 두 루트를 다 보고 싶은 호출부는 루트를 바꿔 두 번
/// 부르면 된다 (MCP 표면이 그렇게 한다).
pub fn get_work(works_root: &Path, slug: &str) -> Result<WorkView> {
    Ok(to_view(works_root, read_work(works_root, slug)?))
}

/// 아카이브 목록의 한 줄. **경량이다** — `specFiles`도 워크트리도 담지 않는다.
/// 아카이브는 계속 쌓이기만 하므로, 작업 목록 조회가 spec 파일 목록까지 뱉어 컨텍스트를
/// 먹는 문제를 물려받으면 안 된다. 문서가 필요하면 slug로 단건 조회한다.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEntry {
    pub slug: String,
    pub title: String,
    pub status: WorkStatus,
    /// 손으로 옮겨 둔 폴더에는 없을 수 있다 — 없는 것을 지어내지 않는다.
    pub archived_at: Option<String>,
    pub projects: Vec<String>,
}

pub fn list_archive(archive_root: &Path) -> Result<Vec<ArchiveEntry>> {
    // 폴더는 첫 아카이빙이 만든다 — 조회는 만들지 않는다. `atelier_list_archive`가
    // `read_only_hint = true`로 선언돼 있어, 여기서 만들면 그 표시가 거짓말이 된다.
    let dir = match std::fs::read_dir(archive_root) {
        Ok(dir) => dir,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut entries = Vec::new();
    for entry in dir {
        let entry = entry?;
        let slug = entry.file_name().to_string_lossy().to_string();
        if slug.starts_with('.') || !entry.path().is_dir() {
            continue;
        }
        // 망가진 파일 하나가 전체 목록을 막지 않게 한다 (list_works와 같은 규칙)
        if let Ok(work) = read_work(archive_root, &slug) {
            entries.push(ArchiveEntry {
                archived_at: work.extra.get("archivedAt").and_then(|v| v.as_str()).map(str::to_string),
                slug: work.slug,
                title: work.title,
                status: work.status,
                projects: work.projects,
            });
        }
    }
    // 최근에 치운 것이 먼저, 같은 날이면 slug 오름차순 (list_works와 같은 규칙)
    entries.sort_by(|a, b| b.archived_at.cmp(&a.archived_at).then_with(|| a.slug.cmp(&b.slug)));
    Ok(entries)
}

/// 표시 이름만 바꾼다. **slug는 건드리지 않는다** — 디렉터리명이 slug의 원천이라
/// 바꾸면 git이 등록해 둔 워크트리 경로와 배포된 spec 참조가 전부 깨진다
/// (프로젝트의 `update_project`가 파일명을 건드리지 않는 것과 같은 규칙).
pub fn update_work_title(works_root: &Path, slug: &str, title: &str) -> Result<WorkView> {
    let mut work = read_work(works_root, slug)?;
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Validation("title must not be empty".into()));
    }
    work.title = title.to_string();
    write_work(works_root, &work)?;
    Ok(to_view(works_root, work))
}

pub fn update_work_status(works_root: &Path, slug: &str, status: WorkStatus) -> Result<WorkView> {
    let mut work = read_work(works_root, slug)?;
    work.status = status;
    write_work(works_root, &work)?;
    Ok(to_view(works_root, work))
}

/// 고정을 켜고 끈다. **목록 순서가 함께 바뀐다** — 고정된 것은 `list_works`가 먼저 준다
/// (결정 100). 그 외에는 상태와 마찬가지로 아무것도 건드리지 않는다.
pub fn update_work_pinned(works_root: &Path, slug: &str, pinned: bool) -> Result<WorkView> {
    let mut work = read_work(works_root, slug)?;
    work.pinned = pinned;
    write_work(works_root, &work)?;
    Ok(to_view(works_root, work))
}

/// 프로젝트를 붙인다. `branch`는 **브랜치가 아직 미정인 work를 위한 것**이다 —
/// 코드를 건드릴 때가 되어서야 저장소 관례에 맞는 이름을 고르게 한다.
/// 이미 정해진 work에 다른 이름을 넘기면 거부된다 (decide_branch의 규칙표).
pub fn attach_project(
    works_root: &Path,
    projects_root: &Path,
    slug: &str,
    project_slug: &str,
    branch: Option<&str>,
) -> Result<WorkReport> {
    let mut work = read_work(works_root, slug)?;
    let dir = works_root.join(&work.slug);
    let worktree = worktrees_dir(&dir).join(project_slug);
    // 미정이던 work의 브랜치는 여기서 확정된다. 만들 워크트리가 남았는지는 보지 않는다.
    let branch = decide_branch(&work, branch)?;

    // 만들 워크트리가 있을 때만 검증한다. 실패하면 여기서 끝나고 아무것도 쓰지 않는다.
    let pending_worktree = if worktree.is_dir() {
        None
    } else {
        Some(
            validate_for_worktree(projects_root, project_slug, &branch, true)
                .map_err(|reason| Error::Validation(format!("{project_slug}: {reason}")))?,
        )
    };
    // 확정은 조건 없이 저장한다 (결정표에 조건이 없다). 워크트리 생성 **전**이라
    // 생성이 실패해도 다음 시도가 같은 이름을 쓴다 — 성공분 유지·재실행 멱등이라는
    // 부분 실패 계약과 같은 결이다.
    if work.branch.is_none() {
        work.branch = Some(branch.clone());
        write_work(works_root, &work)?;
    }

    let mut errors = Vec::new();
    if let Some((repo, base)) = pending_worktree {
        std::fs::create_dir_all(worktrees_dir(&dir))?;
        if let Err(message) = git::worktree_add(&repo, &worktree, &branch, &base) {
            errors.push(WorktreeError { project: project_slug.to_string(), message });
        }
    }
    if !work.projects.iter().any(|p| p == project_slug) {
        work.projects.push(project_slug.to_string());
        write_work(works_root, &work)?;
    }
    Ok(WorkReport { view: to_view(works_root, work), errors })
}

pub fn remove_work(works_root: &Path, slug: &str, force: bool) -> Result<()> {
    let work = read_work(works_root, slug)?;
    let dir = works_root.join(&work.slug);

    let existing: Vec<(&String, PathBuf)> = work
        .projects
        .iter()
        .map(|p| (p, worktrees_dir(&dir).join(p)))
        .filter(|(_, t)| t.is_dir())
        .collect();

    if !force {
        // 거부 사유는 `archive_work`와 **같은 수준으로** 적는다(같은 `dirty_report`).
        // 그전에는 워크트리 경로만 줘서, 무엇을 커밋해야 풀리는지 알려면 직접 가서
        // `git status`를 쳐야 했다. 삭제는 스펙 문서까지 지우므로 아카이빙보다 더
        // 잃는데 말은 덜 해 주고 있었다.
        let mut dirty = Vec::new();
        for (project, tree) in &existing {
            match git::dirty_files(tree) {
                Some(files) if files.is_empty() => {}
                Some(files) => dirty.push(dirty_report(project, &files)),
                // 읽을 수 없으면 보수적으로 거부한다 — `is_dirty`가 하던 그대로다.
                // 다만 "커밋 안 된 변경"이라 하지 않고 못 읽었다고 말한다.
                None => dirty.push(format!("{project} ({}): not a readable git worktree", collapse_home(tree))),
            }
        }
        if !dirty.is_empty() {
            return Err(Error::DirtyWorktrees(dirty.join("; ")));
        }
    }
    for (_, worktree) in &existing {
        git::worktree_remove(worktree, force).map_err(Error::Git)?;
    }
    std::fs::remove_dir_all(&dir)?;
    Ok(())
}

/// Work를 아카이브 보존소로 **옮긴다.** 지우지 않는다 — `remove_work`와 공존한다.
///
/// **순서가 계약이다:** 검증 → 기록 → 워크트리 제거 → 이동. 기록은 워크트리가 살아 있는
/// 유일한 순간에만 뽑을 수 있고, 아카이브에는 되돌리기가 없으므로 순서가 뒤바뀌면 복구
/// 경로도 없다. 아카이브 일시는 **이동이 성공한 뒤에** 쓴다 — 이동이 성립한 것만이
/// 아카이브됐다는 사실의 근거이고, 먼저 쓰면 실패했을 때 작업 루트에 남은 work가 일시를
/// 단 채 목록에 뜬다.
///
/// 3단계와 4단계 사이에서 멈추면 재실행이 그 상태를 흡수한다: 지울 워크트리가 없으니
/// 곧장 이동으로 간다. 그 창에서 잃는 것은 없다 — 브랜치는 워크트리 제거가 건드리지
/// 않고, 커밋 안 된 변경은 1단계가 이미 막았으며, 기록은 덮어쓰지 않는다.
///
/// `status`는 건드리지 않는다. 중단·기각된 접근도 치워야 하는데, 치우려고 상태를 거짓
/// 기재하게 만드는 게이트는 잘못된 게이트다.
pub fn archive_work(
    works_root: &Path,
    archive_root: &Path,
    projects_root: &Path,
    slug: &str,
) -> Result<WorkView> {
    let mut work = read_work(works_root, slug)?;
    let dir = works_root.join(&work.slug);
    let dest = archive_root.join(&work.slug);

    // 1. 검증 — 실패하면 아무것도 건드리지 않고 끝난다.
    if dest.exists() {
        return Err(Error::Validation(format!(
            "'{slug}' is already in the archive. The archive is never overwritten."
        )));
    }
    let worktrees: Vec<(String, PathBuf)> = work
        .projects
        .iter()
        .map(|p| (p.clone(), worktrees_dir(&dir).join(p)))
        .filter(|(_, t)| t.is_dir())
        .collect();
    // 강제 실행 옵션은 없다. "보존한다"는 행위에 "커밋 안 된 작업을 버리고 진행"은
    // 자기모순이고, 되돌리기가 없으니 잘못 밀면 복구 경로도 없다 (remove_work와 다른 점).
    //
    // **못 읽는 것과 더러운 것을 갈라서 말한다.** 폴더는 있는데 git이 못 읽는 상태(워크트리
    // 등록이 끊겼거나 권한이 막혔거나)를 "커밋 안 된 변경"이라고 하면, 사용자는 있지도 않은
    // 변경을 찾아 헤매고 3단계도 어차피 실패하므로 아카이브도 삭제도 못 한 채 갇힌다.
    // 사실대로 말하고 빠져나갈 길(폴더를 직접 지우면 다음 실행이 그 프로젝트를 건너뛴다)을 준다.
    let mut dirty = Vec::new();
    let mut unreadable = Vec::new();
    for (project, tree) in &worktrees {
        match git::dirty_files(tree) {
            Some(files) if files.is_empty() => {}
            Some(files) => dirty.push(dirty_report(project, &files)),
            None => unreadable.push(format!("{project} ({})", collapse_home(tree))),
        }
    }
    if !unreadable.is_empty() {
        return Err(Error::Validation(format!(
            "these folders are no longer readable git worktrees: {}. \
             Nothing was touched. Delete the folder yourself and run this again — \
             a worktree that is not there is skipped.",
            unreadable.join("; ")
        )));
    }
    if !dirty.is_empty() {
        return Err(Error::DirtyWorktrees(dirty.join("; ")));
    }

    // 2. 기록 — 워크트리가 살아 있는 유일한 순간. 매번 새로 뽑되, 앞선 실행이 남긴 기록이
    //    있으면 **이번에 좌표를 못 읽은 섹션만** 그쪽에서 되살린다. 통째로 덮으면 이미
    //    지워진 워크트리의 좌표가 빈 문서로 지워지고, 통째로 두면 그 사이 쌓인 커밋이
    //    영영 안 들어온다 (3단계가 아무것도 못 지우고 실패하는 경우가 실재한다).
    let archived_at = chrono::Local::now().format("%Y-%m-%d").to_string();
    let record = dir.join(RECORD_FILE);
    let fresh = render_record(works_root, projects_root, &work, &archived_at);
    let document = match std::fs::read_to_string(&record) {
        Ok(previous) => merge_record(&fresh, &previous),
        Err(_) => fresh,
    };
    std::fs::write(&record, document)?;

    // 3. 워크트리 전부 제거. 하나라도 실패하면 옮기지 않는다 — 반쯤 옮겨진 디렉터리는
    //    양쪽 어디에도 온전히 없다. 생성 쪽의 "성공분 유지" 계약을 물려받지 않는 이유다.
    for (_, worktree) in &worktrees {
        git::worktree_remove(worktree, false).map_err(Error::Git)?;
    }

    // 4. 이동. 성공한 뒤에야 일시를 쓴다.
    std::fs::create_dir_all(archive_root)?;
    std::fs::rename(&dir, &dest)?;
    work.extra.insert("archivedAt".to_string(), serde_json::Value::String(archived_at));
    write_work(archive_root, &work)?;
    Ok(to_view(archive_root, work))
}

/// 이번 실행이 **덜 담은** 프로젝트 섹션을 앞선 실행의 것으로 되돌린다.
/// **기록이 덜 완전해지는 일은 없어야 한다** — 아카이브는 되돌릴 수 없고, 이 문서가
/// 저장소 없이도 완결된 원본이라는 것이 커밋을 통째로 담기로 한 이유다.
///
/// 좌표(HEAD) 유무만으로 판정하면 안 된다. `BaseUnknown`·`NoMergeCommit`은 **좌표는 쓰고
/// 커밋은 비운 채로** 돌아오므로, 1차 실행이 커밋 표를 봉인해 둔 뒤 base를 못 읽게 되거나
/// (프로젝트 등록 해제) 브랜치가 base로 fast-forward되면, 그 빈 섹션이 완전한 기록을
/// 덮어 영구히 지운다. 등록 해제는 커밋을 통째로 담기로 한 **바로 그 이유**였다.
fn merge_record(fresh: &str, previous: &str) -> String {
    let mut out = String::new();
    for (i, section) in fresh.split(&format!("\n{PROJECT_HEADING}")).enumerate() {
        // 0번은 머리말이다 — 날짜와 상태는 언제나 이번 실행 것이 맞다.
        if i == 0 {
            out.push_str(section);
            continue;
        }
        let project = section.lines().next();
        let recovered = previous
            .split(&format!("\n{PROJECT_HEADING}"))
            .find(|p| p.lines().next() == project)
            .filter(|p| completeness(p) > completeness(section));
        out.push_str(&format!("\n{PROJECT_HEADING}"));
        out.push_str(recovered.unwrap_or(section));
    }
    out
}

/// 섹션이 담은 것의 등급. 큰 쪽이 이긴다. 라벨은 렌더러와 **같은 상수**를 본다 —
/// 이 함수가 `merge_record` 안에 숨어 있으면 그 계약을 테스트로 못 건다.
fn completeness(section: &str) -> u8 {
    if !section.contains(&format!("\n{HEAD_LABEL}")) {
        0 // 좌표조차 못 읽었다
    } else if !section.contains(&format!("\n{COMMITS_HEADING}\n")) {
        1 // 좌표는 있으나 커밋 범위를 특정하지 못했다
    } else {
        2 // 커밋 표까지 담았다
    }
}

/// 거부 사유를 **어떤 파일 때문인지**로 적는다. 목록이 길어지면 잘라 낸다 —
/// 이 문장은 에이전트 컨텍스트로 들어간다.
///
/// 추적 안 된 것과 커밋 안 된 것을 **갈라서** 적는다. 뭉쳐서 "uncommitted"라고만 하면
/// 읽는 쪽이 `git stash`를 고르는데 그것은 `-u` 없이 추적 안 된 파일을 안 치운다 —
/// 사용자가 실제로 그렇게 막혔고 왜 막혔는지 알 수 없었다. 실전에서 이 게이트가 잡는
/// 것은 거의 다 추적조차 안 된 계획·리서치 문서다.
fn dirty_report(project: &str, files: &[git::DirtyEntry]) -> String {
    const CAP: usize = 10;
    // 라벨은 오류 문장과 같은 낱말을 쓴다("uncommitted or untracked"). 추적된 쪽을
    // "modified"라 부르면 안 된다 — porcelain의 `D`(삭제)·`A`(스테이징)·`R`(이름 바꿈)이
    // 전부 그 통에 들어가서, 지운 파일을 고쳤다고 말하게 된다.
    let groups: Vec<String> = [("untracked", true), ("uncommitted", false)]
        .into_iter()
        .filter_map(|(label, untracked)| {
            let paths: Vec<&str> = files
                .iter()
                .filter(|f| f.untracked == untracked)
                .map(|f| f.path.as_str())
                .collect();
            let shown = paths.iter().take(CAP).copied().collect::<Vec<_>>().join(", ");
            match paths.len().saturating_sub(CAP) {
                _ if paths.is_empty() => None,
                0 => Some(format!("{label}: {shown}")),
                more => Some(format!("{label}: {shown} 외 {more}개")),
            }
        })
        .collect();
    format!("{project} ({})", groups.join("; "))
}

/// 주어진 work 디렉터리 밖을 가리키지 않는 상대 경로만 통과시킨다. 빈 문자열·절대 경로·
/// `..`이 든 경로 셋 다 밖을 가리킬 수 있어 한자리에서 함께 막는다.
fn safe_rel(rel_path: &str) -> Result<&Path> {
    let rel = Path::new(rel_path);
    let safe = !rel_path.is_empty()
        && rel.is_relative()
        && rel.components().all(|c| matches!(c, std::path::Component::Normal(_)));
    safe.then_some(rel).ok_or_else(|| Error::Validation(format!("invalid path: {rel_path}")))
}

pub fn read_spec_file(works_root: &Path, slug: &str, rel_path: &str) -> Result<String> {
    let dir = work_dir(works_root, slug)?;
    if !dir.join("work.json").is_file() {
        return Err(Error::WorkNotFound(slug.to_string()));
    }
    Ok(std::fs::read_to_string(spec_dir(&dir).join(safe_rel(rel_path)?))?)
}

/// 문서 하나를 work 디렉터리 **루트 기준**으로 읽는다.
///
/// `read_spec_file`은 `spec/` 안에 갇혀 있어 아카이브의 `record.md`에 닿지 못한다 —
/// 기록은 spec의 일부가 아니라 아카이브가 만든 것이고, spec 안에 넣지 않는다는 것을
/// `archive_moves_the_work_out_of_the_works_root_with_its_spec`이 못 박고 있다.
/// 아카이브 화면은 기록과 spec을 한 트리로 보여주므로 읽는 창구가 하나여야 하고,
/// 그 하나가 성립하는 기준점이 work 루트다.
pub fn read_work_file(works_root: &Path, slug: &str, rel_path: &str) -> Result<String> {
    let dir = work_dir(works_root, slug)?;
    if !dir.join("work.json").is_file() {
        return Err(Error::WorkNotFound(slug.to_string()));
    }
    Ok(std::fs::read_to_string(dir.join(safe_rel(rel_path)?))?)
}

/// 아카이브된 work가 가진 문서들. 경로는 **work 루트 기준**이라 `read_work_file`에 그대로
/// 넘어간다. 기록이 맨 앞이고, 없으면 넣지 않는다 — 손으로 옮겨 둔 폴더에는 기록이 없을 수
/// 있고(`ArchiveEntry::archived_at`이 없을 수 있는 것과 같은 이유), 목록이 곧 화면이 가진
/// 것이어야 읽기 실패로 그 사실을 알게 되는 일이 없다.
pub fn list_archived_docs(archive_root: &Path, slug: &str) -> Result<Vec<String>> {
    let dir = work_dir(archive_root, slug)?;
    if !dir.join("work.json").is_file() {
        return Err(Error::WorkNotFound(slug.to_string()));
    }
    let mut docs = Vec::new();
    if dir.join(RECORD_FILE).is_file() {
        docs.push(RECORD_FILE.to_string());
    }
    docs.extend(spec_files(&dir).into_iter().map(|f| format!("spec/{f}")));
    Ok(docs)
}

/// 아카이브 시점의 코드 좌표를 마크다운 한 장으로 봉인한다.
///
/// **워크트리가 살아 있는 동안에만** 뽑을 수 있다 — 사라지면 HEAD를 못 읽고, 아카이브에는
/// 되돌리기가 없으니 복구 경로도 없다. 그래서 이 함수는 파일을 쓰지도 워크트리를 지우지도
/// 않는다: 문자열을 돌려주고, 언제 쓸지는 아카이브 실행이 정한다.
///
/// 프로젝트가 없는 work도 머리말만으로 문서를 갖는다 — 파일 존재가 조건부이면 읽는 쪽이
/// 매번 분기해야 한다.
pub fn render_record(
    works_root: &Path,
    projects_root: &Path,
    work: &Work,
    archived_at: &str,
) -> String {
    // 제목의 개행을 접는다. `merge_record`가 섹션을 `"\n## "`로 가르므로, 제목에 그 형태가
    // 들어가면 머리말이 통째로 섹션 취급을 받아 사라지고 프로젝트 섹션이 중복된다.
    // 제목은 사용자·에이전트가 자유롭게 쓰는 값이라 여기서 막는 것이 유일한 지점이다.
    let title = work.title.replace(['\n', '\r'], " ");
    let mut out = format!(
        "# 기록 — {title}\n\n- 아카이브: {archived_at}\n- 아카이브 시점 상태: {}\n",
        work.status
    );
    let trees = worktrees_dir(&works_root.join(&work.slug));
    for project in &work.projects {
        out.push_str(&format!("\n{PROJECT_HEADING}{project}\n\n"));
        push_worktree_record(&mut out, projects_root, project, &trees.join(project), work);
    }
    out
}

fn push_worktree_record(
    out: &mut String,
    projects_root: &Path,
    project: &str,
    worktree: &Path,
    work: &Work,
) {
    let declared = work.branch.as_deref().unwrap_or("없음");
    // base는 프로젝트 등록에서 온다. 등록이 사라졌으면 `origin/HEAD`로 물러서고, 그것도
    // 없으면 base 없이 간다 — **좌표까지 버리지는 않는다.** 커밋 목록을 통째로 담기로 한
    // 이유가 "프로젝트를 등록 해제하면 SHA로 복원이 안 된다"였는데, 바로 그 경우에
    // 아무것도 안 남기면 그 결정이 산 것을 그대로 잃는다.
    let base = crate::get_project(projects_root, project)
        .ok()
        .map(|view| view.project.base_branch)
        .or_else(|| git::origin_head(worktree));
    let Some(r) = git::inspect_worktree(worktree, base.as_deref(), work.branch.as_deref()) else {
        // 워크트리 자체를 못 읽었다 — 여기서만 좌표가 없다.
        out.push_str(&format!(
            "- 선언 브랜치: {declared}\n- 기록 없음: 워크트리를 읽을 수 없다\n"
        ));
        return;
    };
    // 분석은 선언 브랜치의 끝을 따르고, 워크트리가 실제로 선 자리는 따로 적는다.
    // 둘이 어긋난 work가 실제로 있으므로 한쪽을 골라 진실인 척하면 안 된다.
    match &r.branch_tip {
        Some(tip) => out.push_str(&format!("- 선언 브랜치: {declared} — {tip}\n")),
        // 브랜치가 정리돼 사라진 뒤일 수 있다. HEAD를 그 브랜치의 끝인 양 적지 않는다.
        None => out.push_str(&format!(
            "- 선언 브랜치: {declared} — 이 저장소에 없다 (아래는 워크트리 HEAD 기준)\n"
        )),
    }
    out.push_str(&format!("{HEAD_LABEL} {}\n", r.head));
    match &base {
        Some(base) => out.push_str(&format!("- base: {base}\n")),
        None => out.push_str("- base: 알 수 없다 — 프로젝트가 등록돼 있지 않다\n"),
    }
    out.push_str(&format!("- base 반영: {}\n", base_state_line(&r)));
    out.push_str(&format!(
        "- 커밋 {}개 · {}파일 · +{} / −{}\n",
        r.commits.len(),
        r.files.len(),
        r.insertions,
        r.deletions
    ));
    if !r.commits.is_empty() {
        out.push_str(&format!("\n{COMMITS_HEADING}\n\n| SHA | 제목 |\n| --- | --- |\n"));
        for (sha, subject) in &r.commits {
            out.push_str(&format!("| {sha} | {subject} |\n"));
        }
    }
    if !r.files.is_empty() {
        out.push_str("\n### 변경 파일\n\n");
        for file in &r.files {
            out.push_str(&format!("- {file}\n"));
        }
    }
}

fn base_state_line(r: &git::WorktreeRecord) -> String {
    match &r.state {
        git::BaseState::Merged { sha, subject, merges } => {
            let pr = match pr_number(subject) {
                Some(pr) => format!("예 — {sha} (PR #{pr})"),
                None => format!("예 — {sha}"),
            };
            // 여러 번 머지된 브랜치는 범위가 첫 머지 직전부터 마지막 머지까지다.
            match merges {
                1 => pr,
                n => format!("{pr} — 이 브랜치는 {n}번에 걸쳐 머지됐고, 아래는 그 전체다"),
            }
        }
        git::BaseState::NoMergeCommit if Some(&r.tip) == r.base_sha.as_ref() => {
            "예 — 브랜치 끝이 곧 base다".to_string()
        }
        // fast-forward든 커밋 없는 브랜치든 결과는 같다: 어느 커밋이 이 브랜치 것인지
        // git에게 물을 수 없다. 둘을 갈라 적으면 알 수 없는 것을 아는 척하게 된다.
        git::BaseState::NoMergeCommit => {
            "예 — 이 브랜치를 들여온 머지 커밋을 특정할 수 없다 (fast-forward이거나 \
             브랜치 커밋이 없다). 커밋 범위도 특정할 수 없다"
                .to_string()
        }
        // 스쿼시·리베이스는 SHA가 바뀌므로 여기서 구별할 수 없다. 단정하지 않는다.
        git::BaseState::NotMerged => {
            "아니오 — base에서 이 커밋들을 찾지 못했다 (미반영이거나 스쿼시·리베이스로 \
             SHA가 바뀌었다)"
                .to_string()
        }
        git::BaseState::BaseUnknown => "알 수 없다 — base를 못 읽어 판정하지 않았다".to_string(),
    }
}

/// `Merge pull request #57 from ...` 형태에서만 뽑는다. 다른 형태를 추측하지 않는다 —
/// 틀린 PR 번호는 없는 것보다 나쁘다.
fn pr_number(subject: &str) -> Option<String> {
    let rest = subject.split_once("pull request #")?.1;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    (!digits.is_empty()).then_some(digits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn run_git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn init_repo(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        run_git(dir, &["init", "-b", "main"]);
        run_git(dir, &["config", "user.email", "t@t.t"]);
        run_git(dir, &["config", "user.name", "t"]);
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        run_git(dir, &["add", "."]);
        run_git(dir, &["commit", "-m", "init"]);
    }

    /// tempdir 아래 works/·projects/ 루트와 git 저장소 2개(fe, be)를 프로젝트로 등록
    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let works = tmp.path().join("works");
        let projects = tmp.path().join("projects");
        for name in ["fe", "be"] {
            let repo = tmp.path().join(name);
            init_repo(&repo);
            crate::create_project(&projects, &repo).unwrap();
        }
        (tmp, works, projects)
    }

    fn slugs(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn start_creates_meta_spec_and_worktrees() {
        let (tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "카트 아이템 추가", None, &slugs(&["fe", "be"]), Some("feat/cart"))
            .unwrap();
        assert!(report.errors.is_empty());

        let w = &report.view.work;
        assert_eq!(w.slug, "카트-아이템-추가");
        assert_eq!(w.title, "카트 아이템 추가");
        assert_eq!(w.status, WorkStatus::Active);
        assert_eq!(w.branch.as_deref(), Some("feat/cart"));
        assert_eq!(w.projects, vec!["fe", "be"]);

        let dir = works.join(&w.slug);
        assert!(dir.join("work.json").is_file());
        assert!(dir.join("spec").is_dir());
        for (i, proj) in ["fe", "be"].iter().enumerate() {
            let worktree = dir.join("trees").join(proj);
            assert!(worktree.is_dir(), "worktree missing for {proj}");
            // 워크트리는 공유 브랜치명으로, 각 저장소의 baseBranch(main) 커밋에서 분기
            assert_eq!(run_git(&worktree, &["branch", "--show-current"]), "feat/cart");
            let base = run_git(&tmp.path().join(proj), &["rev-parse", "main"]);
            assert_eq!(run_git(&worktree, &["rev-parse", "HEAD"]), base);
            let t = &report.view.worktrees[i];
            assert_eq!(t.project, *proj);
            assert!(t.exists);
            assert!(!t.dirty);
        }
    }

    #[test]
    fn start_defaults_branch_to_slug() {
        let (_tmp, works, projects) = setup();
        let report =
            start_work(&works, &archive_root(&works), &projects, "Cart Add", None, &slugs(&["fe"]), None).unwrap();
        assert_eq!(report.view.work.branch.as_deref(), Some("cart-add"));
        let worktree = works.join("cart-add/trees/fe");
        assert_eq!(run_git(&worktree, &["branch", "--show-current"]), "cart-add");
    }

    /// 문턱 낮추기의 핵심 — 아이디어 한 줄에도 갈 곳이 생긴다.
    /// 워크트리도, 빈 `trees/`도, **쓰지도 않을 브랜치도** 만들지 않는다.
    #[test]
    fn start_without_projects_creates_only_the_work_and_its_spec() {
        let (_tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "언젠가 해볼 것", None, &[], None).unwrap();
        assert!(report.errors.is_empty());

        let w = &report.view.work;
        assert_eq!(w.slug, "언젠가-해볼-것");
        assert_eq!(w.branch, None, "an unused branch must not be invented");
        assert!(w.projects.is_empty());
        assert!(report.view.worktrees.is_empty());
        // 직교성: 프로젝트가 없다고 draft가 되지 않는다. 상태는 선언되는 것이고,
        // 프로젝트 없이 진행 중인 리서치 work가 draft로 오표기되면 안 된다.
        assert_eq!(w.status, WorkStatus::Active);

        let dir = works.join(&w.slug);
        assert!(dir.join("work.json").is_file());
        assert!(dir.join("spec").is_dir());
        assert!(!dir.join("trees").exists(), "an empty trees/ reads as a broken worktree");

        // 파일에는 branch 키가 아예 없다
        let file = std::fs::read_to_string(dir.join("work.json")).unwrap();
        assert!(!file.contains("branch"), "undecided branch must not be persisted: {file}");

        // 조회도 같은 모양이고 specDir는 그대로 내려온다
        let view = get_work(&works, &w.slug).unwrap();
        assert_eq!(view.work.branch, None);
        assert!(view.worktrees.is_empty());
        assert!(expand_home(&view.spec_dir).is_dir());
    }

    /// 브랜치 이름만 미리 정해 두는 것도 된다. 그래도 붙일 프로젝트가 없으면
    /// 워크트리는 생기지 않는다 — 브랜치 확정과 워크트리 생성은 별개다.
    #[test]
    fn start_without_projects_still_records_an_explicit_branch() {
        let (_tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "미리 정한 것", None, &[], Some("feat/planned")).unwrap();
        assert_eq!(report.view.work.branch.as_deref(), Some("feat/planned"));
        assert!(!works.join("미리-정한-것/trees").exists());
    }

    /// 프로젝트가 없으면 지울 워크트리도 없다 — 폴더만 사라지고 git 경고도 없다.
    #[test]
    fn remove_project_less_work_deletes_only_its_folder() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "아이디어", None, &[], None).unwrap();
        remove_work(&works, "아이디어", false).unwrap();
        assert!(!works.join("아이디어").exists());
    }

    /// 이미 만들어 둔 work는 마이그레이션 없이 그대로 읽힌다.
    #[test]
    fn existing_work_files_still_parse_and_keep_unknown_fields() {
        let (_tmp, works, _projects) = setup();
        let dir = works.join("옛날-작업");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("work.json"),
            r#"{"title":"옛날 작업","status":"active","branch":"feat/old","createdAt":"2026-01-02","projects":["fe"],"customField":"keep-me"}"#,
        )
        .unwrap();

        let view = get_work(&works, "옛날-작업").unwrap();
        assert_eq!(view.work.branch.as_deref(), Some("feat/old"));
        assert_eq!(view.work.projects, vec!["fe"]);
        // 뒤에 는 필드는 없으면 기본값으로 읽힌다 — 마이그레이션은 없다 (결정 81)
        assert!(!view.work.pinned, "a work.json without `pinned` must read as not pinned");

        // 상태만 바꿔 다시 써도 모르는 필드와 브랜치가 그대로다
        update_work_status(&works, "옛날-작업", WorkStatus::Review).unwrap();
        let file = std::fs::read_to_string(dir.join("work.json")).unwrap();
        assert!(file.contains("keep-me"), "unknown field lost: {file}");
        assert!(file.contains("feat/old"), "branch lost: {file}");
    }

    #[test]
    fn start_validation_failure_creates_nothing() {
        let (tmp, works, projects) = setup();
        // be 저장소에 충돌 브랜치를 미리 만들어 사전검증이 실패하게 한다
        run_git(&tmp.path().join("be"), &["branch", "feat/cart"]);
        let result = start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe", "be"]), Some("feat/cart"));
        assert!(matches!(result, Err(Error::Validation(_))), "expected validation error");
        // 아무것도 만들지 않는다 — fe 워크트리도, work 디렉터리도
        assert!(!works.join("카트").exists());
        assert!(!git::branch_exists(&tmp.path().join("fe"), "feat/cart"));
    }

    #[test]
    fn start_rejects_unknown_project() {
        let (_tmp, works, projects) = setup();
        let result = start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["nope"]), None);
        assert!(matches!(result, Err(Error::Validation(_))));
        assert!(!works.join("카트").exists());
    }

    #[test]
    fn start_resumes_missing_worktrees_idempotently() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), Some("feat/cart")).unwrap();
        // 같은 제목으로 재실행 + 프로젝트 추가 → 새 slug가 아니라 기존 work에 이어서 생성
        let report =
            start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe", "be"]), Some("feat/cart")).unwrap();
        assert!(report.errors.is_empty());
        assert_eq!(report.view.work.slug, "카트");
        assert_eq!(report.view.work.projects, vec!["fe", "be"]);
        assert!(works.join("카트/trees/fe").is_dir());
        assert!(works.join("카트/trees/be").is_dir());
        assert!(!works.join("카트-2").exists());
    }

    #[test]
    fn list_derives_dirty_and_spec_files_and_sorts() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "첫 작업", None, &slugs(&["fe"]), Some("b1")).unwrap();
        start_work(&works, &archive_root(&works), &projects, "둘째 작업", None, &slugs(&["be"]), Some("b2")).unwrap();

        // 워크트리에 커밋 안 된 변경 → dirty, spec 파일 → specFiles
        std::fs::write(works.join("첫-작업/trees/fe/new.txt"), "x").unwrap();
        std::fs::create_dir_all(works.join("첫-작업/spec/sub")).unwrap();
        std::fs::write(works.join("첫-작업/spec/overview.md"), "# o").unwrap();
        std::fs::write(works.join("첫-작업/spec/sub/arch.md"), "# a").unwrap();
        std::fs::write(works.join("첫-작업/spec/.hidden"), "x").unwrap();

        let listed = list_works(&works).unwrap();
        assert_eq!(listed.len(), 2);
        // createdAt 동일 → slug 오름차순
        assert_eq!(listed[0].work.slug, "둘째-작업");

        let first = get_work(&works, "첫-작업").unwrap();
        assert!(first.worktrees[0].dirty);
        assert_eq!(first.spec_files, vec!["overview.md", "sub/arch.md"]);
        let second = get_work(&works, "둘째-작업").unwrap();
        assert!(!second.worktrees[0].dirty);
        assert!(second.spec_files.is_empty());

        assert!(matches!(get_work(&works, "없음"), Err(Error::WorkNotFound(_))));
        assert!(matches!(get_work(&works, "../탈출"), Err(Error::WorkNotFound(_))));
    }

    /// spec 폴더의 다섯 이름은 **표시 계층**의 약속이다. 커널은 정렬된 상대 경로
    /// 목록만 주고, 관습에 없는 폴더도 빠뜨리지 않는다.
    #[test]
    fn spec_files_stay_a_flat_sorted_list_whatever_the_folder_names_are() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &[], None).unwrap();
        let spec = works.join("카트/spec");
        for dir in ["01-첫-판/tickets", "02-둘째-판", "research", "explanation", "잡동사니"] {
            std::fs::create_dir_all(spec.join(dir)).unwrap();
        }
        for (path, body) in [
            ("overview.md", "# o"),
            ("01-첫-판/plan.md", "p"),
            ("01-첫-판/tickets/t1.md", "t"),
            ("02-둘째-판/plan.md", "p"),
            ("research/api.md", "r"),
            ("explanation/why.md", "w"),
            ("잡동사니/메모.md", "m"),
        ] {
            std::fs::write(spec.join(path), body).unwrap();
        }

        let mut expected = vec![
            "overview.md",
            "01-첫-판/plan.md",
            "01-첫-판/tickets/t1.md",
            "02-둘째-판/plan.md",
            "research/api.md",
            "explanation/why.md",
            "잡동사니/메모.md",
        ];
        expected.sort();
        assert_eq!(get_work(&works, "카트").unwrap().spec_files, expected);
    }

    /// 고정된 것이 **먼저**다. 그다음이 기존 규칙(createdAt 내림차순 → slug 오름차순)이라
    /// 고정 구획 안의 순서도 그대로 산다 (결정 100).
    ///
    /// 순서를 여기서 주는 이유: 화면이 백엔드 순서 위에 정렬을 얹으면 「보이는 첫 항목 =
    /// 무선택 정규화가 고르는 항목」이 갈린다. 이슈 #58이 정확히 그것이었고, 사이드바의
    /// 고정 구획이 바로 그 얹는 정렬이다. 앱·MCP·CLI가 같은 순서를 보려면 여기가 유일한 자리다.
    #[test]
    fn list_puts_pinned_first_even_when_it_is_older() {
        let (_tmp, works, _projects) = setup();
        // start_work는 오늘 날짜를 박으므로 날짜를 벌리려면 파일을 직접 쓴다
        let write = |slug: &str, created: &str, pinned: bool| {
            let dir = works.join(slug);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(
                dir.join("work.json"),
                format!(
                    r#"{{"title":"{slug}","status":"active","createdAt":"{created}","projects":[],"pinned":{pinned}}}"#
                ),
            )
            .unwrap();
        };
        write("새-것", "2026-08-20", false);
        write("오래된-것", "2026-01-02", true);
        write("고정-최신", "2026-08-22", true);

        let listed: Vec<String> =
            list_works(&works).unwrap().into_iter().map(|v| v.work.slug).collect();
        assert_eq!(listed, slugs(&["고정-최신", "오래된-것", "새-것"]), "pinned must sort first");
    }

    /// 상태와 같은 모양의 한 필드 쓰기 — 파일에 남고 조회가 같은 값을 준다 (결정 81).
    #[test]
    fn update_pinned_persists() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
        assert!(!get_work(&works, "카트").unwrap().work.pinned);

        let view = update_work_pinned(&works, "카트", true).unwrap();
        assert!(view.work.pinned);
        assert!(get_work(&works, "카트").unwrap().work.pinned);
        // 고정은 그 작업에 대한 사실이라 상태·브랜치·워크트리는 건드리지 않는다
        assert_eq!(view.work.status, WorkStatus::Active);
        assert!(view.worktrees[0].exists);

        let off = update_work_pinned(&works, "카트", false).unwrap();
        assert!(!off.work.pinned);
        assert!(matches!(update_work_pinned(&works, "없음", true), Err(Error::WorkNotFound(_))));
    }

    #[test]
    fn update_status_persists() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
        let view = update_work_status(&works, "카트", WorkStatus::Review).unwrap();
        assert_eq!(view.work.status, WorkStatus::Review);
        assert_eq!(get_work(&works, "카트").unwrap().work.status, WorkStatus::Review);
        // 자유 전환: done → active 도 허용
        update_work_status(&works, "카트", WorkStatus::Done).unwrap();
        let back = update_work_status(&works, "카트", WorkStatus::Active).unwrap();
        assert_eq!(back.work.status, WorkStatus::Active);
        assert!(matches!(
            update_work_status(&works, "없음", WorkStatus::Done),
            Err(Error::WorkNotFound(_))
        ));
    }

    /// draft는 **선언된** 상태다. 지정해도 프로젝트·브랜치·워크트리는 하나도 건드리지
    /// 않고, 프로젝트가 붙어 있어도 draft일 수 있다 (직교성).
    #[test]
    fn draft_is_declared_and_changes_nothing_else() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), Some("feat/cart")).unwrap();

        let view = update_work_status(&works, "카트", WorkStatus::Draft).unwrap();
        assert_eq!(view.work.status, WorkStatus::Draft);
        assert_eq!(view.work.projects, vec!["fe"]);
        assert_eq!(view.work.branch.as_deref(), Some("feat/cart"));
        assert!(view.worktrees[0].exists, "draft must not touch the worktrees");
        assert_eq!(get_work(&works, "카트").unwrap().work.status, WorkStatus::Draft);

        // 되돌아오는 것도 자유다 — 전이 제약은 없다
        let back = update_work_status(&works, "카트", WorkStatus::Active).unwrap();
        assert_eq!(back.work.status, WorkStatus::Active);
    }

    #[test]
    fn attach_adds_project_with_worktree_and_is_idempotent() {
        let (tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), Some("feat/cart")).unwrap();

        let report = attach_project(&works, &projects, "카트", "be", None).unwrap();
        assert!(report.errors.is_empty());
        assert_eq!(report.view.work.projects, vec!["fe", "be"]);
        let worktree = works.join("카트/trees/be");
        assert_eq!(run_git(&worktree, &["branch", "--show-current"]), "feat/cart");

        // 이미 붙은 프로젝트 재attach → 멱등
        let again = attach_project(&works, &projects, "카트", "be", None).unwrap();
        assert!(again.errors.is_empty());
        assert_eq!(again.view.work.projects, vec!["fe", "be"]);

        // 검증 실패(미등록 프로젝트) → 에러, projects 불변
        assert!(matches!(
            attach_project(&works, &projects, "카트", "nope", None),
            Err(Error::Validation(_))
        ));
        assert_eq!(get_work(&works, "카트").unwrap().work.projects, vec!["fe", "be"]);
        drop(tmp);
    }

    /// 빈손으로 시작한 work가 코드를 건드릴 때가 되어서야 저장소 관례에 맞는 이름을
    /// 고른다. draft → active 경로가 여기서 처음 끝까지 뚫린다.
    #[test]
    fn attach_fixes_the_branch_of_a_project_less_work() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "Late Branch", None, &[], None).unwrap();
        assert_eq!(get_work(&works, "late-branch").unwrap().work.branch, None);

        // 미정 + 명시 → 그 값으로 확정·저장되고 워크트리가 생긴다
        let report = attach_project(&works, &projects, "late-branch", "fe", Some("feat/late")).unwrap();
        assert!(report.errors.is_empty(), "{report:?}");
        assert_eq!(report.view.work.branch.as_deref(), Some("feat/late"));
        assert_eq!(get_work(&works, "late-branch").unwrap().work.branch.as_deref(), Some("feat/late"));
        let tree = works.join("late-branch/trees/fe");
        assert_eq!(run_git(&tree, &["branch", "--show-current"]), "feat/late");

        // 이미 정해진 뒤에 다른 이름은 거부된다 — 한 work는 브랜치 하나를 공유한다
        assert!(matches!(
            attach_project(&works, &projects, "late-branch", "be", Some("feat/other")),
            Err(Error::Validation(_))
        ));
        let after = get_work(&works, "late-branch").unwrap();
        assert_eq!(after.work.branch.as_deref(), Some("feat/late"));
        assert_eq!(after.work.projects, vec!["fe"], "a refused attach must change nothing");
        assert!(!works.join("late-branch/trees/be").exists());

        // 같은 값을 넘기는 것은 기존 동작 그대로다
        let same = attach_project(&works, &projects, "late-branch", "be", Some("feat/late")).unwrap();
        assert!(same.errors.is_empty(), "{same:?}");
        assert_eq!(same.view.work.projects, vec!["fe", "be"]);
    }

    /// 미정 work에 이름을 생략하면 slug로 확정된다 (규칙표 마지막 행).
    #[test]
    fn attach_without_a_branch_name_falls_back_to_the_slug() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "Late Branch", None, &[], None).unwrap();
        let report = attach_project(&works, &projects, "late-branch", "fe", None).unwrap();
        assert_eq!(report.view.work.branch.as_deref(), Some("late-branch"));
    }

    /// git이 ref로 거부하는 이름은 **쓰기 전에** 막는다. 이 보장이 반만 참이면
    /// 최악이다 — 확정은 조건 없이 저장되므로(attach_saves_the_branch_before_…)
    /// 한 번 나쁜 이름이 들어가면 그 work는 영구히 워크트리를 못 갖는다.
    ///
    /// 이름이 처음 정해지는 자리가 셋이라 셋을 다 검사한다. 신규 경로만 막던 때에
    /// 나머지 둘이 뚫려 있었다 — `is_safe_slug`는 빈 문자열·앞 `.`·`/`·`\`만 보므로
    /// `bad..name`처럼 slug로는 멀쩡하고 브랜치로는 거부되는 이름이 통과한다.
    #[test]
    fn a_branch_name_git_would_reject_is_refused_wherever_it_is_first_decided() {
        let bad = "bad..name";
        assert!(!git::is_valid_branch_name(bad), "이 테스트의 전제가 깨졌다");

        // (1) 신규 work — 처음부터 막혔던 경로
        let (_t1, works, projects) = setup();
        let new_work = start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), Some(bad));
        assert!(matches!(new_work, Err(Error::Validation(_))), "{new_work:?}");
        assert!(!works.join("카트").exists(), "거부됐으면 아무것도 남지 않는다");

        // (2) 브랜치 미정 work를 재개하며 나쁜 이름을 넘긴다
        let (_t2, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "아이디어", Some("idea"), &[], None).unwrap();
        let resumed = start_work(&works, &archive_root(&works), &projects, "아이디어", Some("idea"), &[], Some(bad));
        assert!(matches!(resumed, Err(Error::Validation(_))), "{resumed:?}");
        assert_eq!(
            get_work(&works, "idea").unwrap().work.branch, None,
            "거부된 이름이 확정되어 남으면 이 work는 되살릴 수 없다"
        );

        // (3) 프로젝트를 붙이며 slug가 브랜치로 승격되는 순간
        let (_t3, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "아이디어", Some(bad), &[], None)
            .expect("slug로는 멀쩡한 이름이다 — 브랜치를 정하지 않는 경로는 통과해야 한다");
        let attached = attach_project(&works, &projects, bad, "fe", None);
        assert!(matches!(attached, Err(Error::Validation(_))), "{attached:?}");
        assert_eq!(
            get_work(&works, bad).unwrap().work.branch, None,
            "거부됐으면 확정도 없다"
        );
    }

    /// 확정은 워크트리를 만들기 **전에** 저장한다. 생성이 실패해도 다음 시도가
    /// 같은 이름을 쓰게 하기 위해서다 (부분 실패 보고 계약과 같은 결).
    #[test]
    fn attach_saves_the_branch_before_it_tries_the_worktree() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "Late Branch", None, &[], None).unwrap();
        // 워크트리가 놓일 자리를 파일로 막아 git worktree add를 실패시킨다
        let tree = works.join("late-branch/trees/fe");
        std::fs::create_dir_all(tree.parent().unwrap()).unwrap();
        std::fs::write(&tree, "blocker").unwrap();

        let report =
            attach_project(&works, &projects, "late-branch", "fe", Some("feat/late")).unwrap();
        assert_eq!(report.errors.len(), 1, "the worktree must have failed: {report:?}");
        assert_eq!(
            get_work(&works, "late-branch").unwrap().work.branch.as_deref(),
            Some("feat/late"),
            "the fixed branch must survive a failed worktree"
        );

        // 원인을 치우고 이름 없이 재시도해도 slug가 아니라 확정된 이름을 쓴다
        std::fs::remove_file(&tree).unwrap();
        let retry = attach_project(&works, &projects, "late-branch", "fe", None).unwrap();
        assert!(retry.errors.is_empty(), "{retry:?}");
        assert_eq!(run_git(&tree, &["branch", "--show-current"]), "feat/late");
    }

    /// 결정표에는 "워크트리를 만들 때만"이라는 조건이 없다. 자리가 이미 차 있으면
    /// 만들 것은 없지만 확정된 이름은 그래도 남아야 한다 — 안 남으면 프로젝트는
    /// 붙었는데 branch가 null인 work가 생긴다.
    #[test]
    fn attach_saves_the_branch_even_when_the_tree_is_already_there() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "Late Branch", None, &[], None).unwrap();
        // 자리를 미리 채워 둔다 — attach는 만들 워크트리가 없다고 판단한다
        std::fs::create_dir_all(works.join("late-branch/trees/fe")).unwrap();

        let report =
            attach_project(&works, &projects, "late-branch", "fe", Some("feat/late")).unwrap();
        assert!(report.errors.is_empty(), "{report:?}");
        assert_eq!(report.view.work.branch.as_deref(), Some("feat/late"));
        let stored = get_work(&works, "late-branch").unwrap().work;
        assert_eq!(
            stored.branch.as_deref(),
            Some("feat/late"),
            "the decision must be stored even with no worktree to create"
        );
        assert_eq!(stored.projects, ["fe"]);
    }

    /// 직교성 회귀 가드 — 진행 상태는 사람과 세션이 선언한다. 프로젝트가 붙었다고
    /// 저절로 active가 되지 않는다.
    #[test]
    fn attach_does_not_change_the_status() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "Draft Work", None, &[], None).unwrap();
        update_work_status(&works, "draft-work", WorkStatus::Draft).unwrap();

        let report =
            attach_project(&works, &projects, "draft-work", "fe", Some("feat/draft")).unwrap();
        assert_eq!(report.view.work.status, WorkStatus::Draft);
        assert_eq!(get_work(&works, "draft-work").unwrap().work.status, WorkStatus::Draft);
    }

    #[test]
    fn remove_refuses_dirty_worktrees_unless_forced() {
        let (tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe", "be"]), Some("feat/cart")).unwrap();
        std::fs::write(works.join("카트/trees/be/wip.txt"), "uncommitted").unwrap();

        let result = remove_work(&works, "카트", false);
        assert!(matches!(result, Err(Error::DirtyWorktrees(_))), "dirty worktree must be refused");
        assert!(works.join("카트").exists(), "refused remove must not delete anything");

        // 아카이브와 **같은 수준으로** 말한다. 삭제가 더 파괴적인데(스펙 문서까지 지운다)
        // 워크트리 경로만 주면 무엇을 커밋해야 풀리는지 알 수 없어, 사용자가 직접 가서
        // `git status`를 쳐야 한다. 어느 쪽인지도 밝힌다 — `git stash`는 `-u` 없이 못 치운다.
        let message = result.unwrap_err().to_string();
        assert!(message.contains("wip.txt"), "파일이 아니라 경로만 알려준다: {message}");
        assert!(message.contains("be"), "어느 프로젝트인지 안 알려준다: {message}");
        assert!(message.contains("untracked:"), "추적 안 됨을 안 밝힌다: {message}");

        remove_work(&works, "카트", true).unwrap();
        assert!(!works.join("카트").exists());
        // 브랜치는 유지된다 (복구 가능)
        assert!(git::branch_exists(&tmp.path().join("fe"), "feat/cart"));
        assert!(git::branch_exists(&tmp.path().join("be"), "feat/cart"));
        // 저장소에 워크트리 잔재가 남지 않는다
        let wt = run_git(&tmp.path().join("fe"), &["worktree", "list"]);
        assert!(!wt.contains("trees/fe"), "stale worktree entry: {wt}");
    }

    #[test]
    fn remove_clean_work_without_force() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
        remove_work(&works, "카트", false).unwrap();
        assert!(!works.join("카트").exists());
        assert!(list_works(&works).unwrap().is_empty());
        assert!(matches!(remove_work(&works, "카트", false), Err(Error::WorkNotFound(_))));
    }

    #[test]
    fn read_spec_file_reads_and_guards_traversal() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
        std::fs::create_dir_all(works.join("카트/spec/sub")).unwrap();
        std::fs::write(works.join("카트/spec/overview.md"), "# 개요\n").unwrap();
        std::fs::write(works.join("카트/spec/sub/arch.md"), "# 구조\n").unwrap();

        assert_eq!(read_spec_file(&works, "카트", "overview.md").unwrap(), "# 개요\n");
        assert_eq!(read_spec_file(&works, "카트", "sub/arch.md").unwrap(), "# 구조\n");
        assert!(matches!(
            read_spec_file(&works, "카트", "../work.json"),
            Err(Error::Validation(_))
        ));
        assert!(matches!(
            read_spec_file(&works, "카트", "/etc/hosts"),
            Err(Error::Validation(_))
        ));
        assert!(read_spec_file(&works, "카트", "없는파일.md").is_err());
        assert!(matches!(
            read_spec_file(&works, "없는작업", "overview.md"),
            Err(Error::WorkNotFound(_))
        ));
    }

    #[test]
    fn archived_docs_lead_with_the_record_and_omit_it_when_absent() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
        std::fs::create_dir_all(works.join("카트/spec/sub")).unwrap();
        std::fs::write(works.join("카트/spec/overview.md"), "# 개요\n").unwrap();
        std::fs::write(works.join("카트/spec/sub/arch.md"), "# 구조\n").unwrap();

        // 손으로 옮겨 둔 폴더에는 기록이 없다. 없는 것을 목록에 지어내면 화면은 그것을
        // 읽기 실패로만 알게 된다 — 목록이 곧 "이 아카이브가 가진 것"이어야 한다.
        assert_eq!(
            list_archived_docs(&works, "카트").unwrap(),
            ["spec/overview.md", "spec/sub/arch.md"]
        );

        std::fs::write(works.join("카트/record.md"), "# 기록\n").unwrap();
        // 기록이 맨 앞이다 — 아카이브를 열었을 때 먼저 보여야 하는 것이 그것이다
        assert_eq!(
            list_archived_docs(&works, "카트").unwrap(),
            ["record.md", "spec/overview.md", "spec/sub/arch.md"]
        );

        assert!(matches!(
            list_archived_docs(&works, "없는작업"),
            Err(Error::WorkNotFound(_))
        ));
    }

    #[test]
    fn read_work_file_reaches_the_record_which_spec_reads_cannot() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
        std::fs::create_dir_all(works.join("카트/spec")).unwrap();
        std::fs::write(works.join("카트/spec/overview.md"), "# 개요\n").unwrap();
        std::fs::write(works.join("카트/record.md"), "# 기록\n").unwrap();

        // 기록은 spec 밖에 산다. 아카이브 화면은 기록과 spec을 한 트리로 보여주므로
        // 읽는 창구도 하나여야 하고, 그 창구의 기준은 work 루트다.
        assert_eq!(read_work_file(&works, "카트", "record.md").unwrap(), "# 기록\n");
        assert_eq!(read_work_file(&works, "카트", "spec/overview.md").unwrap(), "# 개요\n");
        // spec 창구로는 기록에 닿을 수 없다 — 이 함수가 따로 있는 이유가 그것이다
        assert!(read_spec_file(&works, "카트", "record.md").is_err());

        for bad in ["../work.json", "/etc/hosts", ""] {
            assert!(
                matches!(read_work_file(&works, "카트", bad), Err(Error::Validation(_))),
                "work 디렉터리 밖을 가리키는 경로를 허용했다: {bad:?}"
            );
        }
        assert!(matches!(
            read_work_file(&works, "없는작업", "record.md"),
            Err(Error::WorkNotFound(_))
        ));
    }

    #[test]
    fn resume_adopts_leftover_branch_instead_of_dead_ending() {
        let (tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), Some("feat/cart")).unwrap();
        // 부분 실패 잔재 시뮬레이션: be에 브랜치만 만들어지고 워크트리는 없는 상태
        run_git(&tmp.path().join("be"), &["branch", "feat/cart"]);

        // 재실행이 "branch already exists"로 막히면 영구 dead-end — 기존 브랜치를 채택해야 한다
        let report =
            start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe", "be"]), Some("feat/cart")).unwrap();
        assert!(report.errors.is_empty(), "resume must adopt the existing branch: {:?}", report.errors);
        let worktree = works.join("카트/trees/be");
        assert_eq!(run_git(&worktree, &["branch", "--show-current"]), "feat/cart");

        // attach도 동일하게 기존 브랜치를 채택한다
        run_git(&tmp.path().join("fe"), &["worktree", "remove", "--force", works.join("카트/trees/fe").to_str().unwrap()]);
        run_git(&tmp.path().join("fe"), &["worktree", "prune"]);
        let report = attach_project(&works, &projects, "카트", "fe", None).unwrap();
        assert!(report.errors.is_empty(), "attach must adopt the existing branch: {:?}", report.errors);
    }

    #[test]
    fn view_reports_spec_dir_next_to_spec_files() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트", None, &slugs(&["fe"]), None).unwrap();
        std::fs::write(works.join("카트/spec/overview.md"), "# 개요\n").unwrap();

        let view = get_work(&works, "카트").unwrap();
        // 위치는 추측이 아니라 응답에서 온다 (V5)
        assert_eq!(view.spec_dir, collapse_home(&works.join("카트/spec")));
        assert!(expand_home(&view.spec_dir).is_dir());
        // specFiles는 그 디렉터리 기준 상대 경로다
        assert_eq!(view.spec_files, vec!["overview.md"]);

        // wire 계약: camelCase specDir
        let json = serde_json::to_value(&view).unwrap();
        assert!(json["specDir"].is_string(), "specDir missing: {json}");

        // list_works도 같은 값을 준다
        let listed = list_works(&works).unwrap();
        assert_eq!(listed[0].spec_dir, view.spec_dir);
    }

    #[test]
    fn start_with_different_title_gets_unique_slug() {
        let (_tmp, works, projects) = setup();
        start_work(&works, &archive_root(&works), &projects, "카트 추가", None, &slugs(&["fe"]), None).unwrap();
        // slugify 결과가 같지만 제목이 다르면 별개 work
        let report =
            start_work(&works, &archive_root(&works), &projects, "카트/추가", None, &slugs(&["be"]), Some("b2")).unwrap();
        assert_eq!(report.view.work.slug, "카트-추가-2");
    }

    // ── 아카이브 기록 (render_record) ──────────────────────────────────────
    // 워크트리가 살아 있는 동안에만 뽑을 수 있는 좌표라, 검증도 실제 저장소 위에서 한다.

    /// 아카이브 보존소는 works와 형제다 (`data_root()/works`, `data_root()/archive`).
    fn archive_root(works: &Path) -> PathBuf {
        works.parent().unwrap().join("archive")
    }

    fn commit(worktree: &Path, file: &str, body: &str, message: &str) {
        std::fs::write(worktree.join(file), body).unwrap();
        run_git(worktree, &["add", "."]);
        run_git(worktree, &["commit", "-m", message]);
    }

    /// 메타에 적힌 브랜치와 워크트리가 실제로 체크아웃한 브랜치가 어긋난 work가 실제로
    /// 있었다. 기계가 한쪽을 골라 진실인 척하면 안 된다 — 둘을 각각 적는다.
    #[test]
    fn record_reports_declared_branch_and_actual_head_separately() {
        let (_tmp, works, projects) = setup();
        let report =
            start_work(&works, &archive_root(&works), &projects, "좌표", None, &slugs(&["fe"]), Some("feat/declared"))
                .unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        let declared_tip = run_git(&worktree, &["rev-parse", "HEAD"]);
        run_git(&worktree, &["checkout", "-b", "feat/actual"]);
        commit(&worktree, "b.txt", "y\n", "다른 브랜치의 커밋");
        let head = run_git(&worktree, &["rev-parse", "HEAD"]);
        assert_ne!(head, declared_tip);

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains(&format!("- 선언 브랜치: feat/declared — {declared_tip}")), "{doc}");
        assert!(doc.contains(&format!("- 워크트리 HEAD: {head}")), "{doc}");
    }

    /// 렌더러와 병합 판정이 **같은 문자열을 본다**는 것을 실제 출력으로 지킨다.
    ///
    /// 상수를 나눠 쓰는 것만으로는 부족하다 — 누군가 라벨을 다시 박아 넣으면 등급이 조용히
    /// 0으로 떨어지고, 그러면 `merge_record`가 완전한 앞선 기록을 빈 섹션으로 덮는다.
    /// 아카이브에는 되돌리기가 없어 그것이 영구다. 그래서 세 등급을 **렌더러가 실제로 뽑은
    /// 문서로** 확인한다: 문자열이 갈라지는 순간 어느 한 등급이 어긋난다.
    #[test]
    fn the_renderers_own_output_grades_as_written() {
        let (_tmp, works, projects) = setup();
        let report = start_work(
            &works,
            &archive_root(&works),
            &projects,
            "등급",
            None,
            &slugs(&["fe"]),
            Some("feat/grade"),
        )
        .unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");

        fn grade_of(doc: &str) -> u8 {
            let section =
                doc.split(&format!("\n{PROJECT_HEADING}")).nth(1).expect("프로젝트 섹션이 없다");
            completeness(section)
        }

        // 1등급 — 좌표는 있으나 담을 커밋이 없다 (막 만든 워크트리는 base와 같은 자리다)
        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains(HEAD_LABEL), "좌표 라벨이 렌더러 출력에 없다: {doc}");
        assert_eq!(grade_of(&doc), 1, "커밋 없는 기록이 1등급으로 안 읽힌다: {doc}");

        // 2등급 — 커밋 표까지 담았다
        commit(&worktree, "b.txt", "y\n", "담길 커밋");
        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains(COMMITS_HEADING), "커밋 표 제목이 렌더러 출력에 없다: {doc}");
        assert_eq!(grade_of(&doc), 2, "커밋 표를 담은 기록이 2등급으로 안 읽힌다: {doc}");

        // 0등급 — 워크트리를 읽을 수 없어 좌표조차 없다
        std::fs::remove_dir_all(&worktree).unwrap();
        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert_eq!(grade_of(&doc), 0, "좌표 없는 기록이 0등급으로 안 읽힌다: {doc}");
    }

    /// 브랜치가 중간 브랜치를 거쳐 base에 올라오는 구조(이 저장소의 승격 구조)에서
    /// 머지 커밋 역추적이 **첫 부모만 따라가면 결과가 사라진다.** 사라지면 반영된
    /// 브랜치가 fast-forward로 오판되고 커밋 목록이 통째로 빈다.
    #[test]
    fn record_traces_the_merge_commit_through_a_nested_merge() {
        let (tmp, works, projects) = setup();
        let report =
            start_work(&works, &archive_root(&works), &projects, "중첩", None, &slugs(&["fe"]), Some("feat/nested"))
                .unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        commit(&worktree, "feature.txt", "f\n", "기능 커밋");

        let repo = tmp.path().join("fe");
        run_git(&repo, &["checkout", "-b", "develop"]);
        let subject = "Merge pull request #7 from Broco98/feat/nested";
        run_git(&repo, &["merge", "--no-ff", "feat/nested", "-m", subject]);
        run_git(&repo, &["checkout", "main"]);
        run_git(&repo, &["merge", "--no-ff", "develop", "-m", "Merge develop into main"]);

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("- base 반영: 예"), "{doc}");
        assert!(doc.contains("(PR #7)"), "머지 커밋을 못 찾았다: {doc}");
        assert!(doc.contains("기능 커밋"), "머지된 브랜치의 커밋이 비었다: {doc}");
        assert!(doc.contains("커밋 1개 · 1파일 · +1 / −0"), "{doc}");
        assert!(doc.contains("- feature.txt"), "{doc}");
    }

    /// 조상인데 머지 커밋이 **없는** 경우가 있다. 조상 관계만 보고 머지 커밋의 존재를
    /// 가정하면 빈 역추적 결과가 깨진 범위 인자로 흘러간다. 없는 것을 지어내지 않는다.
    #[test]
    fn record_marks_a_fast_forwarded_branch_without_inventing_a_merge_commit() {
        let (tmp, works, projects) = setup();
        let report =
            start_work(&works, &archive_root(&works), &projects, "빨리감기", None, &slugs(&["fe"]), Some("feat/ff"))
                .unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        commit(&worktree, "ff.txt", "f\n", "ff 커밋");

        let repo = tmp.path().join("fe");
        run_git(&repo, &["merge", "--ff-only", "feat/ff"]);
        // base가 더 나아가야 HEAD가 base의 진짜 조상이 된다 (HEAD == base가 아니라)
        commit(&repo, "after.txt", "a\n", "이후 커밋");

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("- base 반영: 예"), "{doc}");
        assert!(doc.contains("fast-forward"), "머지 커밋이 없다는 사실이 빠졌다: {doc}");
        assert!(!doc.contains("(PR #"), "없는 머지 커밋을 지어냈다: {doc}");
        assert!(doc.contains("커밋 0개 · 0파일"), "{doc}");
        assert!(!doc.contains("이후 커밋"), "base의 커밋이 브랜치 것으로 섞였다: {doc}");
    }

    /// 커밋이 하나도 없는 브랜치는 base의 오래된 커밋을 그대로 가리킨다. 조상이라는 것만으로
    /// 머지를 고르면 **그 뒤에 base로 들어온 남의 머지**가 이 브랜치 것으로 붙는다.
    /// 실제 `~/.atelier` 데이터에서 이 오탐이 나왔다 — 틀린 PR 번호는 없는 것보다 나쁘다.
    #[test]
    fn record_does_not_attribute_someone_elses_merge_to_a_branch_that_never_diverged() {
        let (tmp, works, projects) = setup();
        let report =
            start_work(&works, &archive_root(&works), &projects, "빈브랜치", None, &slugs(&["fe"]), Some("feat/empty"))
                .unwrap();
        let work = report.view.work;

        let repo = tmp.path().join("fe");
        run_git(&repo, &["checkout", "-b", "feat/other"]);
        commit(&repo, "other.txt", "o\n", "남의 커밋");
        run_git(&repo, &["checkout", "main"]);
        let subject = "Merge pull request #99 from x/feat-other";
        run_git(&repo, &["merge", "--no-ff", "feat/other", "-m", subject]);

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(!doc.contains("(PR #99)"), "남의 머지를 이 브랜치 것으로 붙였다: {doc}");
        assert!(!doc.contains("남의 커밋"), "남의 커밋이 이 브랜치 것으로 섞였다: {doc}");
        assert!(doc.contains("커밋 0개 · 0파일"), "{doc}");
    }

    /// 첫 부모 검사를 통과하는 머지도 있다 — 커밋 없는 브랜치가 가리키는 **분기 시점의
    /// 커밋**이 크로스 머지로 남의 브랜치에 쓸려 들어가면, 그 머지는 "첫 부모 쪽에 없다"를
    /// 만족한다. 실제 `~/.atelier`에서 커밋 0개짜리 work가 develop 커밋 40개를 자기 것으로
    /// 삼았다. 머지 커밋이 이 브랜치 이름을 말해야 한다는 조건이 그 구멍을 막는다.
    #[test]
    fn record_does_not_inherit_a_cross_merge_that_swept_up_its_branch_point() {
        let (tmp, works, projects) = setup();
        let repo = tmp.path().join("fe");
        run_git(&repo, &["checkout", "-b", "feat/other"]);
        commit(&repo, "other.txt", "o\n", "남의 커밋");
        run_git(&repo, &["checkout", "main"]);
        commit(&repo, "main.txt", "m\n", "main 커밋");

        // 브랜치는 여기서 갈라지고, 커밋을 하나도 만들지 않는다
        let report =
            start_work(&works, &archive_root(&works), &projects, "분기만", None, &slugs(&["fe"]), Some("feat/branch-point"))
                .unwrap();
        let work = report.view.work;

        // main이 남의 브랜치로 역머지되면서 우리 분기점이 그 머지의 둘째 부모가 된다
        run_git(&repo, &["checkout", "feat/other"]);
        run_git(&repo, &["merge", "--no-ff", "main", "-m", "Merge branch 'main' into feat/other"]);
        run_git(&repo, &["checkout", "main"]);
        let subject = "Merge pull request #3 from Broco98/feat/other";
        run_git(&repo, &["merge", "--no-ff", "feat/other", "-m", subject]);

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(!doc.contains("(PR #3)"), "남의 머지를 물려받았다: {doc}");
        assert!(!doc.contains("남의 커밋") && !doc.contains("main 커밋"), "{doc}");
        assert!(doc.contains("커밋 0개 · 0파일"), "{doc}");
    }

    #[test]
    fn record_reports_an_unmerged_branch_against_base() {
        let (_tmp, works, projects) = setup();
        let report =
            start_work(&works, &archive_root(&works), &projects, "미반영", None, &slugs(&["fe"]), Some("feat/open"))
                .unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        std::fs::write(worktree.join("one.txt"), "1\n").unwrap();
        commit(&worktree, "two.txt", "2\n", "미반영 커밋");

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("- base 반영: 아니오"), "{doc}");
        assert!(doc.contains("커밋 1개 · 2파일 · +2 / −0"), "{doc}");
        assert!(doc.contains("| 미반영 커밋 |"), "커밋 표가 비었다: {doc}");
        assert!(doc.contains("- one.txt") && doc.contains("- two.txt"), "{doc}");
    }

    /// 파일 존재 여부가 조건부이면 읽는 쪽이 매번 분기해야 한다 — 머리말만이라도 만든다.
    #[test]
    fn record_for_a_work_without_projects_is_the_header_alone() {
        let (_tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "리서치만", None, &[], None).unwrap();

        let doc = render_record(&works, &projects, &report.view.work, "2026-08-02");
        assert!(doc.starts_with("# 기록 — 리서치만\n"), "{doc}");
        assert!(doc.contains("- 아카이브: 2026-08-02"), "{doc}");
        assert!(doc.contains("- 아카이브 시점 상태: active"), "{doc}");
        assert!(!doc.contains("##"), "프로젝트 섹션이 없어야 한다: {doc}");
    }

    // ── 아카이브 실행 (archive_work) ──────────────────────────────────────
    // 지우는 게 아니라 **옮긴다.** 목록에서 빠지는 것이 규약이 아니라 구조가 된다.

    /// 여러 프로젝트를 붙인 work를 세워 두고 (works_root, archive_root, slug)를 준다.
    fn started(works: &Path, projects: &Path, names: &[&str]) -> (PathBuf, String) {
        let report =
            start_work(works, &archive_root(works), projects, "치울 것", None, &slugs(names), Some("feat/tidy"))
                .unwrap();
        assert!(report.errors.is_empty());
        (archive_root(works), report.view.work.slug)
    }

    #[test]
    fn archive_moves_the_work_out_of_the_works_root_with_its_spec() {
        let (_tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        std::fs::write(works.join(&slug).join("spec/overview.md"), "# 개요\n").unwrap();

        let view = archive_work(&works, &archive, &projects, &slug).unwrap();

        assert!(!works.join(&slug).exists(), "작업 루트에 남아 있다");
        assert!(archive.join(&slug).join("work.json").is_file());
        assert_eq!(
            std::fs::read_to_string(archive.join(&slug).join("spec/overview.md")).unwrap(),
            "# 개요\n"
        );
        // 목록에서 빠지는 것이 구조다 — 목록을 읽는 코드는 보존소를 보지 않는다
        assert!(list_works(&works).unwrap().is_empty());
        assert_eq!(view.work.slug, slug);
        // 돌려주는 뷰는 **보존소를 기준으로** 읽어야 한다. 이 값이 그대로 MCP 응답 본체가
        // 되므로, 작업 루트로 읽으면 방금 옮겨간 spec을 "없다"고 답하게 된다.
        assert!(view.spec_dir.contains("archive"), "spec_dir: {}", view.spec_dir);
        assert_eq!(view.spec_files, ["overview.md"], "옮겨간 spec을 못 읽었다");
    }

    /// spec은 사람과 에이전트가 **쓴** 것이고 기록은 기계가 **뽑은** 것이다.
    /// 섞이면 장래의 증류가 "의도"와 "증거"를 대조할 두 항을 잃는다.
    #[test]
    fn archive_writes_the_record_at_the_work_root_not_inside_spec() {
        let (_tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        commit(&works.join(&slug).join("trees/fe"), "x.txt", "x\n", "치울 커밋");

        archive_work(&works, &archive, &projects, &slug).unwrap();

        let dir = archive.join(&slug);
        let record = std::fs::read_to_string(dir.join("record.md")).unwrap();
        assert!(record.starts_with("# 기록 — 치울 것\n"), "{record}");
        assert!(record.contains("치울 커밋"), "{record}");
        assert!(!dir.join("spec/record.md").exists(), "기록이 spec 안에 들어갔다");
        // spec 파일 목록에도 새어들면 안 된다
        let view = get_work(&archive, &slug).unwrap();
        assert!(!view.spec_files.iter().any(|f| f.contains("record")), "{:?}", view.spec_files);
    }

    #[test]
    fn archive_removes_the_worktrees_but_keeps_the_branch() {
        let (tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe", "be"]);

        archive_work(&works, &archive, &projects, &slug).unwrap();

        for name in ["fe", "be"] {
            let repo = tmp.path().join(name);
            assert!(!run_git(&repo, &["worktree", "list"]).contains("trees/"), "{name} 워크트리가 남았다");
            // 커밋한 것을 되찾을 유일한 경로다
            assert!(crate::git::branch_exists(&repo, "feat/tidy"), "{name} 브랜치가 사라졌다");
        }
    }

    /// 중단·기각된 접근도 치워야 한다. 치우려고 상태를 거짓 기재하게 만드는 게이트는
    /// 잘못된 게이트다 — 어떤 상태든 아카이브되고, 그 값은 바뀌지 않는다.
    #[test]
    fn archive_keeps_whatever_status_the_work_had() {
        let (_tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        update_work_status(&works, &slug, WorkStatus::Draft).unwrap();

        let view = archive_work(&works, &archive, &projects, &slug).unwrap();
        assert_eq!(view.work.status, WorkStatus::Draft);
        assert_eq!(get_work(&archive, &slug).unwrap().work.status, WorkStatus::Draft);
    }

    /// 목록 조회(#69)가 읽을 기계 판독 필드. `record.md`를 파싱하는 것은 취약하다.
    #[test]
    fn archive_stamps_the_date_in_the_work_meta() {
        let (_tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);

        let before = chrono::Local::now().format("%Y-%m-%d").to_string();
        archive_work(&works, &archive, &projects, &slug).unwrap();

        let raw = std::fs::read_to_string(archive.join(&slug).join("work.json")).unwrap();
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let stamped = json["archivedAt"].as_str().expect("archivedAt missing");
        // 자정을 넘겨도 안 깨지게 — 실행 전후 중 하나면 된다
        assert!([&before[..], &chrono::Local::now().format("%Y-%m-%d").to_string()[..]]
            .contains(&stamped), "{stamped}");
    }

    /// 보존소에 같은 이름이 이미 있으면 **아무것도 건드리지 않고** 거절한다.
    ///
    /// 워크트리가 살아남았는지까지 보는 것이 이 테스트의 값이다 — 이 검사가 1단계에
    /// 있다는 사실을 고정한다. 검사가 없으면 1~3단계(검증·기록·워크트리 제거)가 전부
    /// 돌고 나서 4단계 rename이 `Directory not empty`로 죽는다: 워크트리는 이미 사라진
    /// 뒤고, 사용자가 받는 것은 OS 오류 문자열뿐이다.
    ///
    /// 이 상태는 사람이 `~/.atelier/archive/`를 직접 만졌을 때 생긴다 — 되돌리기가
    /// 없으므로 손으로 되돌리는 것이 유일한 경로이고, `mv` 대신 `cp -r`이면 양쪽에 남는다.
    #[test]
    fn archive_never_overwrites_and_refuses_before_touching_anything() {
        let (_tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        let occupied = archive.join(&slug);
        std::fs::create_dir_all(&occupied).unwrap();
        std::fs::write(occupied.join("record.md"), "먼저 있던 기록\n").unwrap();

        let err = archive_work(&works, &archive, &projects, &slug).unwrap_err();

        assert!(err.to_string().contains("never overwritten"), "{err}");
        assert!(works.join(&slug).join("trees/fe").is_dir(), "워크트리를 이미 지웠다");
        assert_eq!(
            std::fs::read_to_string(occupied.join("record.md")).unwrap(),
            "먼저 있던 기록\n",
            "먼저 있던 것을 덮었다"
        );
    }

    /// 거부할 때는 **무엇 때문인지**를 말한다 — 워크트리 경로만 주면 사용자가 직접 가서
    /// `git status`를 쳐야 한다. 삭제도 같은 `dirty_report`를 쓴다(remove 쪽 테스트 참조).
    ///
    /// 그리고 추적 안 된 것과 커밋 안 된 것을 **가른다.** 둘을 뭉쳐 "uncommitted"라고만 하면
    /// 읽는 쪽이 `git stash`를 고르는데 그것은 `-u` 없이는 추적 안 된 파일을 안 치운다 —
    /// 사용자가 실제로 그렇게 막혔고 왜 막혔는지 알 수 없었다. 이 게이트가 실전에서 잡는
    /// 것은 거의 다 추적조차 안 된 계획·리서치 문서다.
    #[test]
    fn archive_refuses_dirty_worktrees_and_tells_untracked_from_uncommitted() {
        let (_tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        let worktree = works.join(&slug).join("trees/fe");
        std::fs::create_dir_all(worktree.join("docs")).unwrap();
        std::fs::write(worktree.join("docs/plan.md"), "계획\n").unwrap(); // 추적 안 됨(`??`)
        // 추적된 쪽은 **삭제**로 낸다(` D`). 라벨을 "modified"라 붙이면 지운 파일을 고쳤다고
        // 말하게 되고, 앞 공백이 깎이는 첫 줄이라 경로 잘림도 이 줄이 함께 지킨다.
        std::fs::remove_file(worktree.join("a.txt")).unwrap();

        let err = archive_work(&works, &archive, &projects, &slug).unwrap_err();
        let message = err.to_string();
        assert!(message.contains("docs/plan.md"), "파일이 아니라 경로만 알려준다: {message}");
        assert!(message.contains("fe"), "{message}");

        // 두 종류가 각자의 이름표를 달고 갈려 있어야 한다. 라벨은 오류 문장과 같은 낱말을
        // 쓴다("uncommitted or untracked") — 처방이 갈리는 선이 정확히 거기다.
        assert!(message.contains("untracked:"), "추적 안 됨을 안 밝힌다: {message}");
        assert!(message.contains("uncommitted:"), "커밋 안 됨을 안 밝힌다: {message}");
        assert!(!message.contains("modified"), "지운 파일을 고쳤다고 말한다: {message}");
        let untracked = message.find("untracked:").unwrap();
        let uncommitted = message.find("uncommitted:").unwrap();
        let plan = message.find("docs/plan.md").unwrap();
        // 추적된 파일은 이름이 온전해야 한다 — `.txt`로 잘려 나간 적이 있다
        let tracked = message.find("a.txt").unwrap();
        assert!(untracked < plan && plan < uncommitted, "추적 안 된 파일이 그 이름표 아래가 아니다: {message}");
        assert!(uncommitted < tracked, "커밋 안 된 파일이 그 이름표 아래가 아니다: {message}");
    }

    #[test]
    fn archive_refused_leaves_the_work_and_its_worktrees_untouched() {
        let (_tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        let worktree = works.join(&slug).join("trees/fe");
        std::fs::write(worktree.join("dirty.txt"), "d\n").unwrap();

        assert!(archive_work(&works, &archive, &projects, &slug).is_err());

        assert!(works.join(&slug).join("work.json").is_file(), "work이 사라졌다");
        assert!(worktree.join("dirty.txt").is_file(), "커밋 안 된 파일이 사라졌다");
        assert!(worktree.join(".git").exists(), "워크트리가 제거됐다");
        assert!(!archive.join(&slug).exists(), "보존소에 반쯤 옮겨졌다");
        // 이동이 성립한 것만이 아카이브됐다는 사실의 근거다
        let raw = std::fs::read_to_string(works.join(&slug).join("work.json")).unwrap();
        assert!(!raw.contains("archivedAt"), "옮기지도 않고 일시를 적었다: {raw}");
        assert!(!works.join(&slug).join("record.md").exists(), "검증 전에 기록을 썼다");
    }

    /// 디렉터리 이동은 반쯤 된 상태가 양쪽 어디에도 온전히 없는 결과를 만든다 —
    /// 생성 쪽의 "성공분 유지·재실행 멱등" 계약을 물려받지 않는 이유다.
    #[test]
    fn archive_moves_nothing_when_a_worktree_cannot_even_be_inspected() {
        let (tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe", "be"]);
        // 원본 저장소가 사라진 워크트리 — 실제로 겪은 상태다
        std::fs::remove_dir_all(tmp.path().join("be")).unwrap();

        assert!(archive_work(&works, &archive, &projects, &slug).is_err());

        assert!(works.join(&slug).join("work.json").is_file());
        assert!(!archive.join(&slug).exists(), "하나가 실패했는데 옮겨졌다");
    }

    /// 프로젝트가 없는 리서치 work도 치울 수 있어야 한다. 기록도 갖는다.
    #[test]
    fn archive_handles_a_work_that_has_no_worktree() {
        let (_tmp, works, projects) = setup();
        let archive = archive_root(&works);
        start_work(&works, &archive, &projects, "리서치만", None, &[], None).unwrap();

        archive_work(&works, &archive, &projects, "리서치만").unwrap();

        assert!(!works.join("리서치만").exists());
        let record = std::fs::read_to_string(archive.join("리서치만/record.md")).unwrap();
        assert!(record.starts_with("# 기록 — 리서치만\n"), "{record}");
    }

    /// 워크트리 제거와 이동 사이에서 멈춘 실행은 재실행이 흡수한다. 이 창에서 잃는 것은
    /// 없다 — 되돌리기가 없다는 결정과 충돌하지 않는 이유가 이것이다.
    /// **기록은 다시 뽑지 않는다**: 워크트리가 이미 없어 좌표가 빈 문서가 되고,
    /// 살아 있을 때 뽑아 둔 좋은 기록을 덮어쓴다.
    #[test]
    fn archive_rerun_absorbs_a_run_that_stopped_after_the_worktrees_were_removed() {
        let (tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        let dir = works.join(&slug);
        commit(&dir.join("trees/fe"), "x.txt", "x\n", "살아 있을 때 뽑은 커밋");

        // 3단계까지 간 뒤 이동 직전에 멈춘 상태를 만든다
        let work = get_work(&works, &slug).unwrap().work;
        let taken = render_record(&works, &projects, &work, "2026-08-02");
        std::fs::write(dir.join("record.md"), taken).unwrap();
        crate::git::worktree_remove(&dir.join("trees/fe"), false).unwrap();
        assert!(!run_git(&tmp.path().join("fe"), &["worktree", "list"]).contains("trees/"));

        archive_work(&works, &archive, &projects, &slug).unwrap();

        assert!(archive.join(&slug).join("work.json").is_file());
        let record = std::fs::read_to_string(archive.join(&slug).join("record.md")).unwrap();
        assert!(record.contains("살아 있을 때 뽑은 커밋"), "좋은 기록을 덮어썼다: {record}");
    }

    /// 3단계가 **아무것도 못 지우고** 실패하는 경우가 실재한다(잠긴 워크트리, 서브모듈).
    /// 워크트리는 살아 있는데 기록만 남고, 재실행이 그것을 갱신하지 않으면 되돌릴 수 없는
    /// 원본이 옛 시점에 고정된다.
    #[test]
    fn archive_refreshes_a_record_left_by_a_run_that_removed_nothing() {
        let (tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        let worktree = works.join(&slug).join("trees/fe");
        let repo = tmp.path().join("fe");
        run_git(&repo, &["worktree", "lock", worktree.to_str().unwrap()]);

        assert!(archive_work(&works, &archive, &projects, &slug).is_err());
        assert!(works.join(&slug).join("record.md").is_file(), "1차 기록이 없다");
        assert!(worktree.is_dir(), "워크트리는 살아 있어야 하는 상황이다");

        run_git(&repo, &["worktree", "unlock", worktree.to_str().unwrap()]);
        commit(&worktree, "later.txt", "l\n", "1차 실패 뒤에 올린 커밋");
        archive_work(&works, &archive, &projects, &slug).unwrap();

        let record = std::fs::read_to_string(archive.join(&slug).join("record.md")).unwrap();
        assert!(record.contains("1차 실패 뒤에 올린 커밋"), "기록이 옛 시점에 고정됐다: {record}");
    }

    /// 좌표를 **읽을 수는 있는데 커밋 범위를 못 특정하게 된** 재실행이 앞선 커밋 표를
    /// 지우면 안 된다. 1차 실패 뒤 프로젝트 등록이 사라지면 base를 못 읽어 `BaseUnknown`이
    /// 되는데, 그 섹션도 HEAD 줄은 쓴다 — 좌표 유무만 보면 완전한 것으로 통과해 덮는다.
    ///
    /// **등록 해제는 커밋을 통째로 담기로 한 바로 그 이유였다**(SHA로 복원이 안 된다).
    /// 그 경우에 커밋 표를 잃으면 그 결정이 산 것을 그대로 잃는다.
    #[test]
    fn archive_rerun_keeps_the_commit_table_when_it_can_no_longer_read_the_base() {
        let (tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        let worktree = works.join(&slug).join("trees/fe");
        let repo = tmp.path().join("fe");
        commit(&worktree, "keep.txt", "k\n", "잃으면 안 되는 커밋");
        run_git(&repo, &["worktree", "lock", worktree.to_str().unwrap()]);

        assert!(archive_work(&works, &archive, &projects, &slug).is_err());
        let first = std::fs::read_to_string(works.join(&slug).join("record.md")).unwrap();
        assert!(first.contains("잃으면 안 되는 커밋"), "1차 기록에 커밋 표가 없다: {first}");

        // 재실행 전에 등록이 사라진다 — base를 못 읽어 커밋 범위를 특정할 수 없게 된다
        run_git(&repo, &["worktree", "unlock", worktree.to_str().unwrap()]);
        crate::delete_project(&projects, "fe").unwrap();
        archive_work(&works, &archive, &projects, &slug).unwrap();

        let sealed = std::fs::read_to_string(archive.join(&slug).join("record.md")).unwrap();
        assert!(sealed.contains("잃으면 안 되는 커밋"), "커밋 표가 사라졌다: {sealed}");
        assert!(sealed.contains("keep.txt"), "변경 파일 목록이 사라졌다: {sealed}");
    }

    /// 반대쪽 위험: 이번 실행에서 **못 읽게 된** 섹션은 앞선 기록을 지켜야 한다.
    /// 3단계가 프로젝트 하나를 지운 뒤 실패했다면 그 좌표는 다시 못 읽는다.
    #[test]
    fn archive_rerun_keeps_the_section_of_a_worktree_it_can_no_longer_read() {
        let (tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe", "be"]);
        let dir = works.join(&slug);
        commit(&dir.join("trees/fe"), "fe.txt", "f\n", "fe 커밋");
        let be_worktree = dir.join("trees/be");
        let be_repo = tmp.path().join("be");
        run_git(&be_repo, &["worktree", "lock", be_worktree.to_str().unwrap()]);

        assert!(archive_work(&works, &archive, &projects, &slug).is_err());
        assert!(!dir.join("trees/fe").exists(), "fe는 제거됐어야 이 상황이 된다");

        run_git(&be_repo, &["worktree", "unlock", be_worktree.to_str().unwrap()]);
        commit(&be_worktree, "be.txt", "b\n", "be 커밋");
        archive_work(&works, &archive, &projects, &slug).unwrap();

        let record = std::fs::read_to_string(archive.join(&slug).join("record.md")).unwrap();
        assert!(record.contains("fe 커밋"), "못 읽게 된 섹션을 빈 문서로 덮었다: {record}");
        assert!(record.contains("be 커밋"), "읽을 수 있는 섹션을 갱신하지 않았다: {record}");
    }

    /// 3단계 **부분 실패**의 원자성 — 워크트리 하나가 사라진 채 디렉터리는 그대로 남는다.
    /// (dirty 게이트에 걸리는 경로와 다른 길이다. 그쪽은 아래 별도 테스트가 본다.)
    #[test]
    fn archive_moves_nothing_when_worktree_removal_fails_partway() {
        let (tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe", "be"]);
        let be_worktree = works.join(&slug).join("trees/be");
        run_git(&tmp.path().join("be"), &["worktree", "lock", be_worktree.to_str().unwrap()]);

        assert!(archive_work(&works, &archive, &projects, &slug).is_err());

        assert!(!archive.join(&slug).exists(), "부분 실패인데 옮겨졌다");
        assert!(works.join(&slug).join("work.json").is_file());
        let raw = std::fs::read_to_string(works.join(&slug).join("work.json")).unwrap();
        assert!(!raw.contains("archivedAt"), "옮기지 못했는데 일시를 적었다: {raw}");
    }

    /// 인수 조건 "이동이 성공하지 않았으면 아카이브 일시가 적히지 않는다"를 고정한다.
    /// 일시 기록을 rename 앞으로 옮기는 회귀가 어떤 테스트도 깨지 않았다.
    #[cfg(unix)]
    #[test]
    fn archive_does_not_stamp_the_date_when_the_move_itself_fails() {
        use std::os::unix::fs::PermissionsExt;
        let (_tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        std::fs::create_dir_all(&archive).unwrap();
        let mut perms = std::fs::metadata(&archive).unwrap().permissions();
        perms.set_mode(0o500); // 안으로 새 항목을 만들 수 없다 — rename이 실패한다
        std::fs::set_permissions(&archive, perms.clone()).unwrap();

        assert!(archive_work(&works, &archive, &projects, &slug).is_err());

        perms.set_mode(0o700);
        std::fs::set_permissions(&archive, perms).unwrap();
        let raw = std::fs::read_to_string(works.join(&slug).join("work.json")).unwrap();
        assert!(!raw.contains("archivedAt"), "옮기지 못했는데 일시를 적었다: {raw}");
        // 목록에 뜨는 아카이브된 work라는 모순 상태가 생기면 안 된다
        assert_eq!(list_works(&works).unwrap().len(), 1);
    }

    /// 아카이브에 같은 이름이 있는데 새 work가 그 이름을 쓰면 단건 조회가 모호해지고
    /// 사람도 두 디렉터리를 오가며 헷갈린다. **거는 지점이 하나가 아니다** — 제목에서
    /// 파생하는 경로와 slug를 명시하는 경로가 따로 있고, 명시 경로는 중복 회피를 거치지
    /// 않는다("이미 있으면 재개했을 것"이라는 전제를 아카이브가 깬다).
    #[test]
    fn start_does_not_reuse_a_slug_that_is_already_archived() {
        let (_tmp, works, projects) = setup();
        let archive = archive_root(&works);
        start_work(&works, &archive, &projects, "카트", Some("cart"), &slugs(&["fe"]), Some("feat/cart"))
            .unwrap();
        archive_work(&works, &archive, &projects, "cart").unwrap();

        // 명시 경로: 재개가 아니다 — 아카이브는 되돌리지 않는다
        let err =
            start_work(&works, &archive, &projects, "카트 다시", Some("cart"), &[], None).unwrap_err();
        assert!(err.to_string().contains("archive"), "{err}");
        assert!(!works.join("cart").exists(), "거부됐는데 폴더가 생겼다");

        // 제목에서 파생하는 경로: 접미사가 붙는다
        let report = start_work(&works, &archive, &projects, "cart", None, &[], None).unwrap();
        assert_eq!(report.view.work.slug, "cart-2");
    }

    // ── 아카이브 조회 (list_archive) ──────────────────────────────────────

    /// 아카이브는 계속 쌓이기만 한다. 작업 목록 조회가 spec 파일 목록까지 뱉어
    /// 컨텍스트를 먹는 문제를 물려받으면 안 된다.
    #[test]
    fn archive_list_is_lightweight_and_carries_no_spec_files() {
        let (_tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        std::fs::write(works.join(&slug).join("spec/overview.md"), "# 개요\n").unwrap();
        let before = chrono::Local::now().format("%Y-%m-%d").to_string();
        archive_work(&works, &archive, &projects, &slug).unwrap();

        let listed = list_archive(&archive).unwrap();
        assert_eq!(listed.len(), 1);
        let e = &listed[0];
        assert_eq!(e.slug, slug);
        assert_eq!(e.title, "치울 것");
        assert_eq!(e.status, WorkStatus::Active);
        assert_eq!(e.projects, vec!["fe"]);
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        assert!([&before[..], &today[..]].contains(&e.archived_at.as_deref().unwrap()), "{e:?}");

        // wire 계약: 경량 필드만. specFiles·worktrees·specDir이 새어나오면 안 된다
        //
        // **정렬해서 비교한다.** 이 계약이 말하는 것은 "어떤 필드가 나가는가"이지 그 차례가
        // 아니다. serde_json의 키 차례는 `preserve_order` feature가 정하는데, 그 feature는
        // 워크스페이스의 어느 크레이트가 켜도 전부에 켜진다 — PR #99가 들여온
        // `agent-client-protocol`(#102로 다시 걷어냈다)이 그것을 켜자, 크레이트 하나만
        // 돌릴 때는 사전순, `--workspace`로 돌릴 때는 선언순이라 같은 코드가 명령에 따라
        // 다른 답을 냈다. 차례에 기대면 이 계약은 자기와 무관한 의존성이 바뀔 때마다 깨진다.
        let json = serde_json::to_value(e).unwrap();
        let mut keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, vec!["archivedAt", "projects", "slug", "status", "title"], "{json}");
    }

    /// 조회는 아무것도 만들지 않는다. `atelier_list_archive`가 `read_only_hint = true`로
    /// 선언돼 있고, 그 표시를 보고 호출을 자유롭게 하는 쪽이 LLM이다 — 한 번 읽었을 뿐인데
    /// 홈에 폴더가 생기면 그 표시가 거짓말이 된다. 폴더는 첫 아카이빙이 만든다.
    #[test]
    fn archive_list_is_empty_before_anything_is_archived_and_creates_nothing() {
        let (_tmp, works, _projects) = setup();
        let archive = archive_root(&works);
        assert!(list_archive(&archive).unwrap().is_empty());
        assert!(!archive.exists(), "읽기가 아카이브 폴더를 만들었다: {}", archive.display());
    }

    /// 최근에 치운 것이 먼저, 같은 날이면 slug 오름차순 (list_works와 같은 규칙).
    #[test]
    fn archive_list_puts_the_most_recently_archived_first() {
        let (_tmp, works, projects) = setup();
        let archive = archive_root(&works);
        for slug in ["나중", "먼저"] {
            start_work(&works, &archive, &projects, slug, Some(slug), &[], None).unwrap();
            archive_work(&works, &archive, &projects, slug).unwrap();
        }
        let listed = list_archive(&archive).unwrap();
        let slugs: Vec<&str> = listed.iter().map(|e| e.slug.as_str()).collect();
        assert_eq!(slugs, vec!["나중", "먼저"], "같은 날짜의 tiebreak가 slug 오름차순이 아니다");
    }

    /// 데스크톱 앱의 단건 조회가 이 함수를 그대로 부른다. 여기에 폴백을 넣으면
    /// stale한 slug 하나로 아카이브된 work가 Works 화면에 그려진다 — 확장은 MCP 표면에서만.
    #[test]
    fn get_work_does_not_reach_into_the_archive() {
        let (_tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        archive_work(&works, &archive, &projects, &slug).unwrap();

        assert!(matches!(get_work(&works, &slug), Err(Error::WorkNotFound(_))));
        // 같은 함수를 보존소 루트로 부르면 나온다 — 폴백은 호출부가 정한다
        assert_eq!(get_work(&archive, &slug).unwrap().work.slug, slug);
    }

    // ── 귀속 회귀 (리뷰에서 재현된 것들) ──────────────────────────────────

    /// PR이 머지된 뒤 워크트리에서 브랜치를 base로 당겨오면(이미 다 머지됐으니 fast-forward)
    /// 브랜치 ref가 **자기 머지 커밋 위로** 올라간다. 머지를 `tip..base`에서만 찾으면 그 순간
    /// 범위 밖으로 나가 커밋이 통째로 사라진다 — 실측에서 6커밋·33파일이 "커밋 0개"가 됐다.
    #[test]
    fn record_still_finds_the_merge_after_the_branch_was_synced_onto_it() {
        let (tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "동기화", None, &slugs(&["fe"]), Some("feat/synced")).unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        commit(&worktree, "s.txt", "s\n", "동기화 전 커밋");

        let repo = tmp.path().join("fe");
        let subject = "Merge pull request #8 from o/feat/synced";
        run_git(&repo, &["merge", "--no-ff", "feat/synced", "-m", subject]);
        run_git(&worktree, &["merge", "--ff-only", "main"]);

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("(PR #8)"), "동기화 뒤 머지를 못 찾았다: {doc}");
        assert!(doc.contains("동기화 전 커밋"), "커밋이 통째로 사라졌다: {doc}");
        assert!(doc.contains("커밋 1개 · 1파일"), "{doc}");
    }

    /// 브랜치가 base로 동기화된 뒤에는 브랜치 ref와 base가 같은 커밋을 가리켜, ref만으로
    /// 머지의 **방향**을 알 수 없다. `Merge branch 'develop' into feat/x`는 이 브랜치가 받는
    /// 쪽이라 둘째 부모가 develop인데, 그것을 이 브랜치 구간으로 쓰면 base 커밋이 통째로
    /// 딸려 온다 — 실측에서 6커밋짜리 work가 55커밋으로 기록됐다.
    #[test]
    fn record_ignores_merges_that_pulled_base_into_the_branch() {
        let (tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "역방향", None, &slugs(&["fe"]), Some("feat/back")).unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        let repo = tmp.path().join("fe");

        commit(&worktree, "mine.txt", "m\n", "내 커밋");
        // base가 앞서 나가고, 그것을 브랜치로 당겨온다 (받는 쪽 머지)
        commit(&repo, "theirs.txt", "t\n", "남의 커밋");
        run_git(&worktree, &["merge", "--no-ff", "main", "-m", "Merge branch 'main' into feat/back"]);
        // 그 다음 브랜치가 base로 들어간다
        run_git(&repo, &["merge", "--no-ff", "feat/back", "-m", "Merge pull request #6 from o/feat/back"]);
        run_git(&worktree, &["merge", "--ff-only", "main"]);

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("(PR #6)"), "{doc}");
        assert!(doc.contains("내 커밋"), "{doc}");
        assert!(!doc.contains("2번에 걸쳐"), "받는 쪽 머지를 구간으로 셌다: {doc}");
        // 남의 커밋은 브랜치가 당겨온 것이지 이 work가 만든 것이 아니다
        assert!(doc.contains("커밋 2개"), "{doc}");
    }

    /// 이름만 대조하면 접두 관계 브랜치(`feat/x`와 `feat/x-followup`)가 서로의 머지를 자기
    /// 것으로 삼는다. 이름으로 좁히고 **구조로 확인해야** 한다.
    #[test]
    fn record_does_not_take_the_merge_of_a_branch_whose_name_extends_its_own() {
        let (tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "짧은", Some("short"), &slugs(&["fe"]), Some("feat/x")).unwrap();
        let work = report.view.work;
        commit(&works.join("short/trees/fe"), "x.txt", "x\n", "내 커밋");

        let repo = tmp.path().join("fe");
        run_git(&repo, &["checkout", "-b", "feat/x-followup", "feat/x"]);
        commit(&repo, "y.txt", "y\n", "남의 커밋");
        run_git(&repo, &["checkout", "main"]);
        let subject = "Merge pull request #9 from o/feat/x-followup";
        run_git(&repo, &["merge", "--no-ff", "feat/x-followup", "-m", subject]);

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(!doc.contains("(PR #9)"), "이름이 겹치는 남의 머지를 삼켰다: {doc}");
        assert!(!doc.contains("남의 커밋"), "남의 커밋이 이 work 것으로 기록됐다: {doc}");
    }

    #[test]
    fn record_covers_every_merge_when_a_branch_landed_twice() {
        let (tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "두번", None, &slugs(&["fe"]), Some("feat/twice")).unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        let repo = tmp.path().join("fe");

        commit(&worktree, "one.txt", "1\n", "첫 커밋");
        run_git(&repo, &["merge", "--no-ff", "feat/twice", "-m", "Merge pull request #1 from o/feat/twice"]);
        commit(&worktree, "two.txt", "2\n", "둘째 커밋");
        run_git(&repo, &["merge", "--no-ff", "feat/twice", "-m", "Merge pull request #2 from o/feat/twice"]);

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("첫 커밋"), "첫 머지분이 통째로 빠졌다: {doc}");
        assert!(doc.contains("둘째 커밋"), "{doc}");
        assert!(doc.contains("커밋 2개 · 2파일"), "{doc}");
        assert!(doc.contains("2번에 걸쳐"), "여러 번 머지된 사실이 안 적혔다: {doc}");
    }

    /// 선언 브랜치가 정리돼 없어졌는데 워크트리 HEAD를 그 브랜치의 끝인 양 적으면,
    /// 기계가 한쪽을 골라 진실인 척하는 것이다 — 이 결정이 막으려던 바로 그것이다.
    #[test]
    fn record_says_the_declared_branch_is_gone_rather_than_passing_head_off_as_its_tip() {
        let (_tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "사라진", None, &slugs(&["fe"]), Some("feat/gone")).unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        run_git(&worktree, &["checkout", "-b", "release-x"]);
        run_git(&worktree, &["branch", "-D", "feat/gone"]);
        let head = run_git(&worktree, &["rev-parse", "HEAD"]);

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("- 선언 브랜치: feat/gone — 이 저장소에 없다"), "{doc}");
        assert!(doc.contains(&format!("- 워크트리 HEAD: {head}")), "{doc}");
    }

    /// 커밋 목록을 통째로 담기로 한 근거가 *"프로젝트를 등록 해제하면 SHA로 복원이 안 된다"*
    /// 였다. 정작 그 경우에 좌표까지 버리면 그 결정이 산 것을 그대로 잃는다.
    #[test]
    fn record_keeps_the_coordinates_when_the_project_is_no_longer_registered() {
        let (_tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "고아", None, &slugs(&["fe"]), Some("feat/orphan")).unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        commit(&worktree, "o.txt", "o\n", "고아 커밋");
        let head = run_git(&worktree, &["rev-parse", "HEAD"]);
        crate::delete_project(&projects, "fe").unwrap();

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains(&format!("- 워크트리 HEAD: {head}")), "등록이 사라지자 좌표를 버렸다: {doc}");
        assert!(doc.contains("base: 알 수 없다"), "{doc}");
    }

    /// base 판정은 **원격을 먼저 본다.** 로컬 base ref는 뒤처져 있기 일쑤인데(이 저장소에서도
    /// 실제로 그랬다), 뒤처진 ref로 보면 원격에서 이미 머지된 work가 "반영 안 됨"으로
    /// 기록된다. 아카이브에는 되돌리기가 없으니 그 오판이 영구히 굳는다.
    #[test]
    fn record_reads_the_base_from_the_remote_when_the_local_ref_lags() {
        let (tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "뒤처짐", None, &slugs(&["fe"]), Some("feat/lag")).unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        commit(&worktree, "l.txt", "l\n", "머지될 커밋");

        // 저장소에서 브랜치를 main으로 머지한 뒤, 그 결과를 **원격에만** 남기고 로컬은 되돌린다
        let repo = tmp.path().join("fe");
        run_git(&repo, &["merge", "--no-ff", "-m", "Merge branch 'feat/lag'", "feat/lag"]);
        let merged = run_git(&repo, &["rev-parse", "main"]);
        run_git(&repo, &["update-ref", "refs/remotes/origin/main", &merged]);
        run_git(&repo, &["reset", "--hard", &format!("{merged}^1")]);

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("- base 반영: 예"), "뒤처진 로컬 ref로 판정했다: {doc}");
        assert!(doc.contains("머지될 커밋"), "커밋 범위를 못 특정했다: {doc}");
    }

    /// 등록이 사라져도 **저장소 자신이 origin/HEAD를 알면** base는 거기서 온다.
    ///
    /// 위 테스트만으로는 이 갈래가 한 번도 실행되지 않는다 — `init_repo`가 만드는 저장소에는
    /// origin이 없어서 폴백이 늘 None을 통과한다. 폴백을 통째로 지워도 초록이었다.
    #[test]
    fn record_falls_back_to_origin_head_when_the_project_is_gone() {
        let (_tmp, works, projects) = setup();
        let report = start_work(&works, &archive_root(&works), &projects, "고아", None, &slugs(&["fe"]), Some("feat/orphan")).unwrap();
        let work = report.view.work;
        let worktree = works.join(&work.slug).join("trees/fe");
        commit(&worktree, "o.txt", "o\n", "고아 커밋");

        // 원격이 있는 저장소를 흉내낸다: origin/main을 만들고 origin/HEAD가 그것을 가리키게 한다
        let main = run_git(&worktree, &["rev-parse", "main"]);
        run_git(&worktree, &["remote", "add", "origin", "."]);
        run_git(&worktree, &["update-ref", "refs/remotes/origin/main", &main]);
        run_git(&worktree, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
        crate::delete_project(&projects, "fe").unwrap();

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("- base: main"), "origin/HEAD를 안 봤다: {doc}");
    }

    /// 이 저장소의 계획·리서치 문서 이름이 한글이다. git 기본값(`core.quotePath`)은 그것을
    /// 8진 이스케이프로 뱉어, "무엇 때문인지 말한다"는 목적이 실제 파일에서 깨진다.
    #[test]
    fn record_and_refusal_write_non_ascii_paths_readably() {
        let (tmp, works, projects) = setup();
        let (archive, slug) = started(&works, &projects, &["fe"]);
        let worktree = works.join(&slug).join("trees/fe");
        commit(&worktree, "한글 문서.md", "내용\n", "한글 파일 추가");
        let subject = "Merge pull request #2 from o/feat/tidy";
        run_git(&tmp.path().join("fe"), &["merge", "--no-ff", "feat/tidy", "-m", subject]);

        let work = get_work(&works, &slug).unwrap().work;
        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("- 한글 문서.md"), "파일명이 이스케이프됐다: {doc}");

        std::fs::create_dir_all(worktree.join("docs")).unwrap();
        std::fs::write(worktree.join("docs/설계 근거.md"), "메모\n").unwrap();
        let err = archive_work(&works, &archive, &projects, &slug).unwrap_err();
        assert!(err.to_string().contains("docs/설계 근거.md"), "거부 사유를 못 읽는다: {err}");
    }

    /// 워크트리가 이미 없어도 문서는 만든다. 없는 좌표를 지어내지 않고 그렇게 적는다.
    #[test]
    fn record_has_a_section_per_project_even_when_a_worktree_is_gone() {
        let (_tmp, works, projects) = setup();
        let report =
            start_work(&works, &archive_root(&works), &projects, "둘", None, &slugs(&["fe", "be"]), Some("feat/two"))
                .unwrap();
        let work = report.view.work;
        std::fs::remove_dir_all(works.join(&work.slug).join("trees/be")).unwrap();

        let doc = render_record(&works, &projects, &work, "2026-08-02");
        assert!(doc.contains("## fe") && doc.contains("## be"), "{doc}");
        assert_eq!(doc.matches("\n## ").count(), 2, "{doc}");
        assert!(doc.contains("기록 없음"), "읽지 못한 사실이 기록되지 않았다: {doc}");
    }
}
