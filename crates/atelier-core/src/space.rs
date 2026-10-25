use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::paths::spaces_in;
use crate::{Error, Result};

/// Space 하나 — 파일을 읽은 값과 그 검사의 문제(03 구현 스펙 §8). 문제가 있어도 선다: 목록이 「문제 있음」으로 보이고 관계 편집에서
/// 고친다(스토리 185). 읽을 수 없는 칸은 비어 있다 — 닫히지 않은 파일 · 읽을 수 없는 파일은 이름도 없어 화면이 slug로 부른다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Space {
    /// 파일 이름 — 만든 뒤 바뀌지 않는다.
    pub slug: String,
    pub name: String,
    /// 적힌 차례 그대로, 한 번씩. 등록되지 않은 Project도 적힌 대로 든다(그 일은 문제가 말한다).
    pub projects: Vec<String>,
    pub created_at: String,
    /// 만든 이 — Host 도구로 만들면 `host`, 화면에서 만들면 없다(S6).
    pub created_by: Option<String>,
    /// 본문 — Agent가 이 Space에서 일할 때 처음 읽는 설명.
    pub description: String,
    pub problems: Vec<SpaceProblem>,
}

impl Space {
    /// 보이는 이름 — 파일의 `name`, 비었으면(닫히지 않은 · 읽을 수 없는 파일) slug다. 목록 차례 · 함께 쓰는 Space · 읽는 범위 · 제거
    /// 확인 창 · 엔진의 Space 줄과 결과 카드가 이것 하나로 부른다.
    pub fn shown_name(&self) -> &str {
        if self.name.trim().is_empty() {
            &self.slug
        } else {
            &self.name
        }
    }

    /// 그 Space 파일의 자리(`<데이터 루트>/spaces/<slug>.md`) — 머리말 · 결과 카드가 Agent에게 알린다.
    pub fn file_in(&self, data_root: &Path) -> PathBuf {
        spaces_in(data_root).join(format!("{}.md", self.slug))
    }
}

/// 검사가 돌려주는 것 — 문제와 조각 자리.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceCheck {
    pub problems: Vec<SpaceProblem>,
    pub pieces: SpacePieces,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceProblem {
    pub line: usize,
    pub kind: SpaceProblemKind,
    /// 문제의 Project slug — 등록되지 않은 · 두 번 적은 Project에만 선다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// 화면이 그 줄 끝에 붙이는 말(「등록되지 않은 Project예요」). 말은 여기 하나다 — 화면 · 저장 실패 · Host 도구가 같은 말을 한다.
    pub message: String,
}

impl SpaceProblem {
    fn new(line: usize, kind: SpaceProblemKind, project: Option<String>) -> Self {
        let message = match kind {
            SpaceProblemKind::UnclosedFrontmatter => "frontmatter가 닫히지 않았어요",
            SpaceProblemKind::BadYaml => "YAML로 읽을 수 없어요",
            SpaceProblemKind::NoName => "이름(name)이 비어 있어요",
            SpaceProblemKind::UnknownProject => "등록되지 않은 Project예요",
            SpaceProblemKind::DuplicateProject => "같은 Project가 두 번 있어요",
            SpaceProblemKind::Unreadable => "파일을 읽을 수 없어요",
        };
        SpaceProblem { line, kind, project, message: message.to_string() }
    }
}

/// 문제들을 한 문장으로 — 저장이 거절될 때의 말(「Space 파일에 문제가 있어요 — 5행 등록되지 않은 Project예요(billing)」).
pub(crate) fn describe_problems(problems: &[SpaceProblem]) -> String {
    let each: Vec<String> = problems
        .iter()
        .map(|problem| match &problem.project {
            Some(project) => format!("{}행 {}({project})", problem.line, problem.message),
            None => format!("{}행 {}", problem.line, problem.message),
        })
        .collect();
    format!("Space 파일에 문제가 있어요 — {}", each.join(" · "))
}

/// 문제의 갈래 — 검사의 다섯(03 구현 스펙 §8 「검사」)과, 글을 읽지 못한 파일 하나(§8 「읽기」).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SpaceProblemKind {
    /// frontmatter가 `---`로 열리지 않았거나 닫히지 않았다.
    UnclosedFrontmatter,
    BadYaml,
    /// `name`이 없거나 비었다.
    NoName,
    UnknownProject,
    DuplicateProject,
    /// 파일의 글을 읽지 못했다(UTF-8이 아님 · 권한 없음) — 목록 · 하나 읽기만 내고, 글을 받는 검사는 내지 않는다.
    Unreadable,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpacePieces {
    pub name: Option<usize>,
    pub projects: Option<Lines>,
    pub body: Option<Lines>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Lines {
    pub first: usize,
    pub last: usize,
}

/// Space 파일을 고칠 것 — 상세 화면(설명 · 넣기 · 빼기)과 Host 도구가 쓴다. 비어 있는 칸은 그대로 둔다.
#[derive(Debug, Clone, Default)]
pub struct SpacePatch {
    pub name: Option<String>,
    pub description: Option<String>,
    /// 넣을 Project — 이미 든 것은 건너뛰고, 목록 끝에 차례로 선다. `before`가 있으면 그 Project 앞에 선다(빼기를 되돌려 제자리로).
    pub add: Vec<String>,
    pub before: Option<String>,
    /// 뺄 Project — 같은 것을 두 번 적었으면 둘 다 뺀다.
    pub remove: Vec<String>,
}

/// **글 단위 고치기** — 고친 칸만 그 자리에서 바꾸고 나머지 글자(주석 · 칸 차례 · 따옴표 · 모르는 칸 · 들여쓰기)는 그대로 둔 새 글을
/// 돌려준다. 파일을 쓰지 않고 검사도 하지 않는다 — 검사는 [`update_space`]가 앞뒤로 한다.
///
/// serde로 읽고 다시 쓰면(`render_project`처럼) 사람이 적은 주석 · 차례 · 따옴표를 잃는다. 「Space는 파일이다」 — 사람이 손으로
/// 고치는 파일이라 앱이 고친 자리만 바뀌어야 diff로 읽힌다(03 구현 스펙 §8 「고치기」 · 결정 「조정」).
///
/// - 이름: `name` 줄 하나를 바꾼다(없으면 frontmatter 첫 줄에 세운다).
/// - 설명: 닫는 `---` 아래를 바꾼다. 비우면 본문 없이 끝난다.
/// - Project: 줄마다 `- ` 항목 하나인 목록이면 그 항목 줄만 지우거나 끼운다 — 끼우는 줄은 이웃 항목의 들여쓰기를 따른다. 마지막을
///   빼면 `projects: []`다. 한 줄 목록(`[a, b]`) · 빈 목록 · 칸이 없을 때는 `projects` 칸을 목록으로 다시 적는다(칸이 없으면 `name`
///   아래에 세운다).
///
/// frontmatter가 닫히지 않았거나 YAML로 읽을 수 없으면 고칠 자리를 모른다 — 그 문제로 실패한다.
pub fn edit_space_text(text: &str, patch: &SpacePatch) -> Result<String> {
    let structural: Vec<SpaceProblem> = read_text(text, &[])
        .check
        .problems
        .into_iter()
        .filter(|problem| matches!(problem.kind, SpaceProblemKind::UnclosedFrontmatter | SpaceProblemKind::BadYaml))
        .collect();
    let Some(outline) = Outline::of(text).filter(|_| structural.is_empty()) else {
        return Err(Error::SpaceProblems(structural));
    };
    let yaml: serde_yaml_ng::Value = serde_yaml_ng::from_str(outline.yaml).unwrap_or_default();
    // 고칠 자리마다 (원래 글의 줄 범위, 새 줄들) — 모두 원래 글의 줄 번호로 짓고 아래 자리부터 바꾼다. 한 칸을 고쳐 줄 수가 바뀌어도 다른
    // 칸의 자리가 밀리지 않는다.
    let mut edits: Vec<(std::ops::Range<usize>, Vec<String>)> = Vec::new();
    if let Some(description) = &patch.description {
        let description = description.trim();
        let body = if description.is_empty() { String::new() } else { format!("\n{description}\n") };
        edits.push((outline.close + 1..outline.lines.len(), vec![body]));
    }
    if !patch.add.is_empty() || !patch.remove.is_empty() {
        edits.extend(projects_edit(&outline, &yaml, patch));
    }
    if let Some(name) = &patch.name {
        let line = format!("name: {}", yaml_scalar(&name.split_whitespace().collect::<Vec<_>>().join(" ")));
        let at = outline.key("name").map_or(1..1, |key| key.first..key.last + 1);
        edits.push((at, vec![line]));
    }
    // 같은 자리에 끼우는 둘(칸이 없는 name · projects)은 나중에 바꾼 것이 위에 선다 — name이 projects 위다.
    edits.sort_by_key(|(at, _)| std::cmp::Reverse(at.start));
    let mut lines: Vec<String> = outline.lines.iter().map(|line| line.to_string()).collect();
    for (at, new_lines) in edits {
        lines.splice(at, new_lines);
    }
    Ok(lines.join("\n"))
}

/// `projects` 칸에 넣고 빼는 자리와 새 줄 — [`edit_space_text`]의 Project 갈래. 바꿀 것이 없으면 없다.
fn projects_edit(
    outline: &Outline,
    yaml: &serde_yaml_ng::Value,
    patch: &SpacePatch,
) -> Option<(std::ops::Range<usize>, Vec<String>)> {
    let items = outline.projects(yaml);
    let kept: Vec<&String> = items.iter().map(|(slug, _)| slug).filter(|slug| !patch.remove.contains(slug)).collect();
    let mut adding: Vec<&String> = Vec::new();
    for slug in &patch.add {
        if !kept.contains(&slug) && !adding.contains(&slug) {
            adding.push(slug);
        }
    }
    let key = outline.key("projects");
    let item_lines = key.map(|key| outline.item_lines(key)).unwrap_or_default();

    if let Some(key) = key.filter(|_| !kept.is_empty() && !items.is_empty() && item_lines.len() == items.len()) {
        // 줄마다 항목 하나 — 칸 안의 줄을 차례로 옮겨 적으며 뺄 항목 줄은 거르고 넣을 줄을 끼운다. 주석 · 빈 줄은 그대로다.
        let removed = |at: usize| item_lines.iter().position(|&line| line == at).is_some_and(|index| patch.remove.contains(&items[index].0));
        let anchor = patch
            .before
            .as_ref()
            .filter(|before| kept.contains(before))
            .and_then(|before| items.iter().position(|(slug, _)| slug == before))
            .map(|index| item_lines[index]);
        let neighbor = anchor.unwrap_or(*item_lines.last()?);
        let prefix = item_prefix(outline.lines[neighbor]);
        let added: Vec<String> = adding.iter().map(|slug| format!("{prefix}{}", yaml_scalar(slug))).collect();
        let mut block = Vec::new();
        for at in key.first..=key.last {
            if Some(at) == anchor {
                block.extend(added.iter().cloned());
            }
            if !removed(at) {
                block.push(outline.lines[at].to_string());
            }
        }
        if anchor.is_none() {
            block.extend(added);
        }
        return Some((key.first..key.last + 1, block));
    }

    // 칸을 목록으로 다시 적는다 — 한 줄 목록 · 빈 목록 · 칸이 없을 때, 그리고 마지막 항목을 뺄 때.
    let all: Vec<&String> = kept.into_iter().chain(adding).collect();
    if key.is_none() && all.is_empty() {
        return None;
    }
    let mut block = vec![if all.is_empty() { "projects: []".to_string() } else { "projects:".to_string() }];
    block.extend(all.iter().map(|slug| format!("  - {}", yaml_scalar(slug))));
    let at = match key {
        Some(key) => key.first..key.last + 1,
        None => {
            let at = outline.key("name").map_or(1, |name| name.last + 1);
            at..at
        }
    };
    Some((at, block))
}

/// 항목 줄의 머리(`    - `) — 그 뒤가 값이다.
fn item_prefix(line: &str) -> String {
    let indent = line.len() - line.trim_start().len();
    let after_dash = &line[indent + 1..];
    let gap = after_dash.len() - after_dash.trim_start().len();
    format!("{}-{}", &line[..indent], " ".repeat(gap.max(1)))
}

/// YAML 한 줄 값 — 그대로 적어 글로 읽히면 그대로, 수 · 참거짓 · 기호로 읽힐 글이면 따옴표를 단다(serde가 고른다).
fn yaml_scalar(text: &str) -> String {
    serde_yaml_ng::to_string(text).map(|out| out.trim_end().to_string()).unwrap_or_else(|_| format!("{text:?}"))
}

/// 새 Space — 화면의 「직접 만들기」와 Host 도구가 만든다.
#[derive(Debug, Clone, Default)]
pub struct NewSpace {
    pub name: String,
    pub projects: Vec<String>,
    pub description: String,
    /// 만든 이 — Host 도구면 `host`. 화면에서 만들면 없다(S6).
    pub created_by: Option<String>,
}

/// 같은 Project를 적은 다른 Space — 상세의 「함께 쓰는 Space」와 관계 그래프의 점선 노드.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedSpace {
    pub slug: String,
    pub name: String,
    /// 겹치는 Project — 이 Space에 적힌 차례다.
    pub overlap: Vec<String>,
    /// 그 Space의 Project 전부 — 그래프가 겹치지 않는 것을 그 곁에 옅게 그린다.
    pub projects: Vec<String>,
}

/// Space 상세가 읽는 것 — Space와 함께 쓰는 Space.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceDetail {
    #[serde(flatten)]
    pub space: Space,
    pub shared: Vec<SharedSpace>,
}

/// Space 하나와 그 둘레 — 상세 화면의 한 번 읽기(앱 명령 `get_space`).
pub fn space_detail(data_root: &Path, slug: &str) -> Result<SpaceDetail> {
    Ok(SpaceDetail { space: get_space(data_root, slug)?, shared: shared_spaces(data_root, slug)? })
}

/// Space를 만든다 — 이름에서 slug를 짓고(겹치면 `-2` · `-3`) 파일을 쓴다. 문제가 있으면 쓰지 않고 그 문제로 실패한다.
pub fn create_space(data_root: &Path, new: NewSpace) -> Result<Space> {
    let name = new.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(Error::EmptyName);
    }
    let mut text = format!("---\nname: {}\n", yaml_scalar(&name));
    if new.projects.is_empty() {
        text.push_str("projects: []\n");
    } else {
        text.push_str("projects:\n");
        for slug in &new.projects {
            text.push_str(&format!("  - {}\n", yaml_scalar(slug)));
        }
    }
    text.push_str(&format!("createdAt: {}\n", chrono::Local::now().format("%Y-%m-%d")));
    if let Some(by) = &new.created_by {
        text.push_str(&format!("createdBy: {}\n", yaml_scalar(by)));
    }
    text.push_str("---\n");
    let description = new.description.trim();
    if !description.is_empty() {
        text.push_str(&format!("\n{description}\n"));
    }
    let registered = registered_projects(data_root);
    let read = read_text(&text, &registered);
    if !read.check.problems.is_empty() {
        return Err(Error::SpaceProblems(read.check.problems));
    }
    let slug = new_space_slug(data_root, &name);
    crate::atomic::write_atomically(&spaces_in(data_root), &format!("{slug}.md"), &text)?;
    Ok(read.into_space(&slug))
}

/// 이 이름으로 만들 때의 slug — Project와 같은 `slugify`(한글 유지)이고 이미 있으면 `-2` · `-3`이다. 새 Space 화면의 파일 경로가 이것을
/// 미리 보인다.
///
/// `new`는 쓰지 않는다(`new-2`) — `/spaces/new`가 새 Space 화면의 주소라, 그 slug의 상세가 가려진다(04 결정).
pub fn new_space_slug(data_root: &Path, name: &str) -> String {
    let dir = spaces_in(data_root);
    let base = crate::slugify(name);
    let mut slug = base.clone();
    let mut n = 2;
    while slug == NEW_SPACE_PAGE || dir.join(format!("{slug}.md")).exists() {
        slug = format!("{base}-{n}");
        n += 1;
    }
    slug
}

/// 새 Space 화면의 주소 끝(`/spaces/new`) — 앱이 짓는 slug가 비켜 간다.
const NEW_SPACE_PAGE: &str = "new";

/// Space 파일의 글 그대로 — 관계 편집이 연다(03 구현 스펙 §13). 읽을 수 없는 파일은 그 IO 오류다(고칠 글이 없다).
pub fn read_space_text(data_root: &Path, slug: &str) -> Result<String> {
    space_text(data_root, slug)
}

/// 그 slug의 Space 파일 글 — 파일이 **없을** 때만 `SpaceNotFound`, 그 밖에 읽지 못하면(UTF-8이 아님 · 권한 없음) 그 IO 오류다.
fn space_text(data_root: &Path, slug: &str) -> Result<String> {
    match std::fs::read_to_string(space_path(data_root, slug)?) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(Error::SpaceNotFound(slug.to_string())),
        Err(e) => Err(e.into()),
    }
}

/// 글을 읽지 못한 Space 파일 — slug와 문제 하나로 선다(§8 「읽을 수 없는 파일도 slug와 「문제 있음」으로 선다」). 이름 · Project ·
/// 설명은 비어 있다.
fn unreadable(slug: &str) -> Space {
    Space {
        slug: slug.to_string(),
        name: String::new(),
        projects: Vec::new(),
        created_at: String::new(),
        created_by: None,
        description: String::new(),
        problems: vec![SpaceProblem::new(1, SpaceProblemKind::Unreadable, None)],
    }
}

/// 고치기 화면(관계 편집 · 직접 만들기)이 고칠 때마다 부르는 한 번 읽기 — 그 글의 검사(문제 · 조각 자리)와 미리보기 카드가 그릴 것,
/// 안내 줄의 등록된 Project, 파일 자리다(03 구현 스펙 §13 · S7). 화면은 따로 검사하지 않는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceDraft {
    /// 그 글을 읽은 Space — 문제는 `problems`에 든다. slug는 관계 편집이면 그 Space의 것, 새 Space면 이름에서 지을 것이다(이름이 비면 빈
    /// 글 — 아직 파일 이름이 없다).
    pub space: Space,
    pub pieces: SpacePieces,
    /// 그 글의 Project를 적은 다른 Space — 카드의 「함께 쓰는 Space」와 그래프의 점선 노드. 고치는 Space 자신은 빠진다.
    pub shared: Vec<SharedSpace>,
    /// 등록된 Project — 안내 줄 「Project는 … 중에서」.
    pub registered: Vec<String>,
    /// Space 파일들의 폴더 — 홈은 `~`로 접는다. 파일 칸 머리의 경로가 이 아래 `<slug>.md`다.
    pub folder: String,
    /// 새 Space에서 같은 이름의 Space가 있어 slug 끝에 붙인 것(`-2`). 겹치지 않으면 없다.
    pub suffix: Option<String>,
}

/// `slug`가 있으면 그 Space를 고치는 글이고, 없으면 새 Space의 글이다. 파일은 읽지도 쓰지도 않는다(다른 Space · 등록부만 읽는다).
pub fn draft_space(data_root: &Path, slug: Option<&str>, text: &str) -> Result<SpaceDraft> {
    let registered = registered_projects(data_root);
    let read = read_text(text, &registered);
    let pieces = read.check.pieces.clone();
    let (slug, suffix) = match slug {
        Some(slug) => {
            space_path(data_root, slug)?;
            (slug.to_string(), None)
        }
        None => {
            let name = folded(&read.name);
            if name.is_empty() {
                (String::new(), None)
            } else {
                let slug = new_space_slug(data_root, &name);
                let suffix = slug.strip_prefix(&crate::slugify(&name)).filter(|rest| !rest.is_empty()).map(str::to_string);
                (slug, suffix)
            }
        }
    };
    let space = read.into_space(&slug);
    let others = list_spaces(data_root)?;
    let shared = overlapping(&others, &space);
    Ok(SpaceDraft {
        space,
        pieces,
        shared,
        registered,
        folder: crate::paths::collapse_home(&spaces_in(data_root)),
        suffix,
    })
}

/// **글로 저장**(03 구현 스펙 §8) — 사람이 쓴 글을 검사하고, 문제가 없으면 **그 글 그대로** 쓴다(줄 차례 · 주석 · 모르는 칸 · 끝의 줄바꿈까지).
/// 문제가 하나라도 있으면 쓰지 않고 그 문제로 실패한다 — 고치기 화면이 저장을 끈 것과 같은 검사다(S7).
///
/// `slug`가 있으면 그 Space 파일을 바꾼다(없으면 `SpaceNotFound` — 지운 Space를 몰래 다시 세우지 않는다). 없으면 새 파일이고, 그 글의
/// `name`에서 slug를 짓는다(겹치면 `-2` — [`new_space_slug`]). 이름을 고쳐도 있던 파일 이름은 그대로다.
pub fn save_space_text(data_root: &Path, slug: Option<&str>, text: &str) -> Result<Space> {
    let read = read_text(text, &registered_projects(data_root));
    if !read.check.problems.is_empty() {
        return Err(Error::SpaceProblems(read.check.problems));
    }
    let slug = match slug {
        Some(slug) => {
            if !space_path(data_root, slug)?.is_file() {
                return Err(Error::SpaceNotFound(slug.to_string()));
            }
            slug.to_string()
        }
        None => new_space_slug(data_root, &folded(&read.name)),
    };
    crate::atomic::write_atomically(&spaces_in(data_root), &format!("{slug}.md"), text)?;
    Ok(read.into_space(&slug))
}

/// 이름의 빈칸을 하나로 접는다 — 만들기([`create_space`])와 같은 이름에서 같은 slug가 나온다.
fn folded(name: &str) -> String {
    name.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Space를 고쳐 쓴다 — 고친 칸만 바꾼다([`edit_space_text`]). 고친 글이 **새 문제**를 만들면(등록되지 않은 Project를 넣었다 · 이름을
/// 비웠다) 쓰지 않고 그 문제로 실패한다. 이미 있던 문제는 막지 않는다 — 손으로 깨뜨린 Project 한 줄이 있어도 설명을 고치고, 그 줄을
/// 빼서 문제를 걷을 수 있다.
pub fn update_space(data_root: &Path, slug: &str, patch: SpacePatch) -> Result<Space> {
    if patch.name.as_ref().is_some_and(|name| name.trim().is_empty()) {
        return Err(Error::EmptyName);
    }
    let text = space_text(data_root, slug)?;
    let registered = registered_projects(data_root);
    let before = read_text(&text, &registered).check.problems;
    let edited = edit_space_text(&text, &patch)?;
    let after = read_text(&edited, &registered);
    let mut old: Vec<(SpaceProblemKind, Option<&String>)> =
        before.iter().map(|problem| (problem.kind, problem.project.as_ref())).collect();
    let new: Vec<SpaceProblem> = after
        .check
        .problems
        .iter()
        .filter(|problem| match old.iter().position(|seen| *seen == (problem.kind, problem.project.as_ref())) {
            Some(at) => {
                old.remove(at);
                false
            }
            None => true,
        })
        .cloned()
        .collect();
    if !new.is_empty() {
        return Err(Error::SpaceProblems(new));
    }
    if edited != text {
        crate::atomic::write_atomically(&spaces_in(data_root), &format!("{slug}.md"), &edited)?;
    }
    Ok(after.into_space(slug))
}

/// 이 Space와 같은 Project를 하나라도 적은 다른 Space — 목록 차례(이름)다.
pub fn shared_spaces(data_root: &Path, slug: &str) -> Result<Vec<SharedSpace>> {
    let spaces = list_spaces(data_root)?;
    let Some(this) = spaces.iter().find(|space| space.slug == slug) else {
        return Err(Error::SpaceNotFound(slug.to_string()));
    };
    Ok(overlapping(&spaces, this))
}

/// `spaces` 가운데 `this`와 같은 Project를 하나라도 적은 다른 Space — `this` 자신(같은 slug)은 빠진다.
fn overlapping(spaces: &[Space], this: &Space) -> Vec<SharedSpace> {
    spaces
        .iter()
        .filter(|other| other.slug != this.slug)
        .filter_map(|other| {
            let overlap: Vec<String> = this.projects.iter().filter(|project| other.projects.contains(project)).cloned().collect();
            (!overlap.is_empty()).then(|| SharedSpace {
                slug: other.slug.clone(),
                name: other.shown_name().to_string(),
                overlap,
                projects: other.projects.clone(),
            })
        })
        .collect()
}

/// 데이터 루트의 Space 전부 — 이름 차례(이름이 없으면 slug). 점 파일(쓰기의 tmp · 지운 자리)과 `.md`가 아닌 것은 건너뛴다.
/// 폴더가 없으면 빈 목록이다 — 만들지 않는다(`read_projects`와 같은 규칙). 글을 읽지 못한 파일은 slug와 문제 하나로 선다 — 파일 하나가
/// 목록을 깨지 않는다. 폴더 자체를 읽지 못하면 그 오류다.
pub fn list_spaces(data_root: &Path) -> Result<Vec<Space>> {
    let dir = spaces_in(data_root);
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let registered = registered_projects(data_root);
    let mut spaces = Vec::new();
    for entry in entries {
        let file_name = entry?.file_name().to_string_lossy().to_string();
        let Some(slug) = file_name.strip_suffix(".md").filter(|_| !file_name.starts_with('.')) else {
            continue;
        };
        match std::fs::read_to_string(dir.join(&file_name)) {
            Ok(text) => spaces.push(read_text(&text, &registered).into_space(slug)),
            // 훑는 사이 사라졌다 — 목록에 서지 않는다.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => spaces.push(unreadable(slug)),
        }
    }
    spaces.sort_by_cached_key(|space| space.shown_name().to_lowercase());
    Ok(spaces)
}

/// Space 하나 — 파일이 없으면 `SpaceNotFound`, 글을 읽지 못하면 목록과 같이 slug와 문제 하나로 선다(파일은 있다 — 없는 Space가 아니다).
pub fn get_space(data_root: &Path, slug: &str) -> Result<Space> {
    match space_text(data_root, slug) {
        Ok(text) => Ok(read_text(&text, &registered_projects(data_root)).into_space(slug)),
        Err(Error::Io(_)) => Ok(unreadable(slug)),
        Err(other) => Err(other),
    }
}

/// 이 Space에 이은 곳 — `space`가 이 slug인 진행 중인 Work(`works/`)와 Work 없는 Thread(03 구현 스펙 §9). Work에 이은 Thread는 그 Work의
/// 칸을 따르므로 들지 않는다. 지우기가 비운 곳 · 되돌리기가 다시 적은 곳이고, 지운 자리에 파일 곁에 적는 것(`.deleted/<slug>.json`)이다.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceLinks {
    /// Work의 slug — Work 목록 차례.
    pub works: Vec<String>,
    /// Thread의 id — 새것부터.
    pub threads: Vec<String>,
}

/// 쓰임(§8 「둘레 읽기」) — 지우기 확인 창의 「Thread 3개 · Work 1개가 이 Space에서 빠져 「Space 없음」이 돼요」.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct SpaceUsage {
    /// 이 Space에 이은 진행 중인 Work.
    pub works: usize,
    /// 이 Space로 읽는 Thread — Work 없는 Thread와 이은 Work의 Thread. 지우면 이 Thread마다 「지워짐」 줄이 선다.
    pub threads: usize,
}

/// 지운 것 — 그 Space(줄이 이름을 말한다)와 비운 곳.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedSpace {
    pub space: Space,
    pub unlinked: SpaceLinks,
}

/// 되돌린 것 — 제자리에 선 Space와 다시 적은 곳.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredSpace {
    pub space: Space,
    pub relinked: SpaceLinks,
}

/// 쓰임 읽기 — 지우기 확인 창이 부른다. 보관된 Work(`archive/`)는 읽기만이라 세지 않는다.
pub fn space_usage(data_root: &Path, slug: &str) -> Result<SpaceUsage> {
    get_space(data_root, slug)?;
    let links = linked(data_root, slug)?;
    let index = crate::threads::ThreadIndex::load(data_root)?;
    let in_works: usize = links.works.iter().map(|work| index.of_work(work).len()).sum();
    Ok(SpaceUsage { works: links.works.len(), threads: links.threads.len() + in_works })
}

/// **Space 지우기**(§9) — 파일을 지운 자리(`spaces/.deleted/`)로 옮기고, 그 slug를 적은 `work.json` · `thread.json`의 `space`를 비운다.
/// Project · 대화 · 문서 · worktree는 건드리지 않는다. 흐름의 「지워짐」 줄은 엔진이 비운 곳마다 남긴다(기록은 엔진의 것 하나다).
///
/// - **비운 곳을 먼저 적고 → 파일을 옮기고 → 칸을 비운다.** 여러 파일을 고치는 사이 앱이 꺼지면 반쯤 비운 채 남는다 — 남은 칸은 없는
///   Space를 가리켜 「Space 없음」으로 읽히고(§7 규칙 1) 그 Thread의 다음 말에서 닫힌다(손으로 지운 파일과 같은 길). 되돌리기는 적어 둔
///   곳을 안다. 반대 차례면 칸만 빈 채 Space가 남아 연결이 몰래 사라진다.
/// - 칸을 비우지 못한 곳은 답의 `unlinked`에서 빠진다 — 위의 길로 닫힌다.
/// - 지운 자리는 slug마다 마지막 하나다(S10) — 같은 slug를 다시 지우면 앞의 파일 · 기록을 덮는다.
pub fn delete_space(data_root: &Path, slug: &str) -> Result<DeletedSpace> {
    let space = get_space(data_root, slug)?;
    let links = linked(data_root, slug)?;
    crate::aside::Aside::of(&spaces_in(data_root), slug).put(&links, "지운 Space의 연결을")?;
    let unlinked = SpaceLinks {
        works: links.works.into_iter().filter(|work| swap_work_space(data_root, work, Some(slug), None)).collect(),
        threads: links.threads.into_iter().filter(|thread| swap_thread_space(data_root, thread, Some(slug), None)).collect(),
    };
    Ok(DeletedSpace { space, unlinked })
}

/// **Space 되돌리기**(§9 · S10) — 지운 뒤 토스트의 「되돌리기」만 부른다.
///
/// - 지운 자리의 파일을 제자리로 돌리고, 비웠던 곳 가운데 **아직 비어 있는 것에만** 다시 적는다 — 그사이 다른 Space를 고른 칸, Work가 된
///   Thread(이제 Work의 칸을 따른다), 보관 · 지운 Work와 Thread는 건드리지 않는다.
/// - 그사이 같은 slug가 다시 쓰였으면(`SlugReused`) 되돌리지 않는다 — 새로 선 Space를 덮지 않는다. 지운 것이 없으면 `SpaceNotFound`다.
pub fn restore_space(data_root: &Path, slug: &str) -> Result<RestoredSpace> {
    space_path(data_root, slug)?;
    let aside = crate::aside::Aside::of(&spaces_in(data_root), slug);
    aside.ready(Error::SpaceNotFound(slug.to_string()))?;
    let links: SpaceLinks = aside.take_back("지운 Space의 연결")?;
    let relinked = SpaceLinks {
        works: links.works.into_iter().filter(|work| swap_work_space(data_root, work, None, Some(slug))).collect(),
        threads: links.threads.into_iter().filter(|thread| swap_thread_space(data_root, thread, None, Some(slug))).collect(),
    };
    aside.forget();
    Ok(RestoredSpace { space: get_space(data_root, slug)?, relinked })
}

/// 이 Space에 이은 곳을 훑는다 — Space 파일엔 Work · Thread를 적지 않으므로(§9) 앱이 모은다.
fn linked(data_root: &Path, slug: &str) -> Result<SpaceLinks> {
    let works = crate::works::read_works(&crate::paths::works_in(data_root))?
        .into_iter()
        .filter(|work| work.space.as_deref() == Some(slug))
        .map(|work| work.slug)
        .collect();
    let threads = crate::threads::ThreadIndex::load(data_root)?
        .all()
        .iter()
        .filter(|summary| {
            crate::threads::read_thread(data_root, &summary.id).is_ok_and(|file| file.work.is_none() && file.space.as_deref() == Some(slug))
        })
        .map(|summary| summary.id.clone())
        .collect();
    Ok(SpaceLinks { works, threads })
}

/// 그 Work의 `space`가 아직 `from`이면 `to`로 바꾼다 — 바꿨으면 참. 읽지 못하는 Work(보관 · 지움)는 그대로다.
fn swap_work_space(data_root: &Path, work: &str, from: Option<&str>, to: Option<&str>) -> bool {
    let works = crate::paths::works_in(data_root);
    crate::works::read_work(&works, work).is_ok_and(|read| read.space.as_deref() == from)
        && crate::works::update_work_space(&works, work, to).is_ok()
}

/// 그 Work 없는 Thread의 `space`가 아직 `from`이면 `to`로 바꾼다 — 바꿨으면 참. 그사이 Work에 이었거나 지워진 Thread는 그대로다.
fn swap_thread_space(data_root: &Path, thread: &str, from: Option<&str>, to: Option<&str>) -> bool {
    crate::threads::read_thread(data_root, thread).is_ok_and(|file| file.work.is_none() && file.space.as_deref() == from)
        && crate::threads::update_thread(data_root, thread, |file| file.space = to.map(str::to_owned)).is_ok()
}

/// 등록된 Project의 slug들 — 검사가 Space 파일의 `projects`와 맞댄다.
fn registered_projects(data_root: &Path) -> Vec<String> {
    crate::store::read_projects(&crate::paths::projects_in(data_root))
        .unwrap_or_default()
        .into_iter()
        .map(|project| project.slug)
        .collect()
}

/// 그 slug의 Space 파일 자리 — 뿌리 밖을 가리키는 slug는 없는 Space다.
fn space_path(data_root: &Path, slug: &str) -> Result<PathBuf> {
    if !crate::slug::is_safe_slug(slug) {
        return Err(Error::SpaceNotFound(slug.to_string()));
    }
    Ok(spaces_in(data_root).join(format!("{slug}.md")))
}

/// 글 하나를 읽은 것 — 검사와 값. 값은 읽을 수 있는 데까지만 선다.
struct Read {
    check: SpaceCheck,
    name: String,
    projects: Vec<String>,
    created_at: String,
    created_by: Option<String>,
    description: String,
}

impl Read {
    fn into_space(self, slug: &str) -> Space {
        Space {
            slug: slug.to_string(),
            name: self.name,
            projects: self.projects,
            created_at: self.created_at,
            created_by: self.created_by,
            description: self.description,
            problems: self.check.problems,
        }
    }
}

fn read_text(text: &str, registered: &[String]) -> Read {
    let mut read = Read {
        check: SpaceCheck::default(),
        name: String::new(),
        projects: Vec::new(),
        created_at: String::new(),
        created_by: None,
        description: String::new(),
    };
    let Some(outline) = Outline::of(text) else {
        read.check.problems = vec![SpaceProblem::new(1, SpaceProblemKind::UnclosedFrontmatter, None)];
        return read;
    };
    read.description = outline.body().trim().to_string();
    let pieces = SpacePieces {
        name: outline.key("name").map(|key| key.first + 1),
        projects: outline.key("projects").map(|key| Lines { first: key.first + 1, last: key.last + 1 }),
        body: outline.body_lines(),
    };
    let mut problems = Vec::new();
    match serde_yaml_ng::from_str::<serde_yaml_ng::Value>(outline.yaml) {
        Ok(yaml) => {
            let name = yaml.get("name").and_then(scalar).unwrap_or_default();
            read.name = name.trim().to_string();
            read.created_at = yaml.get("createdAt").and_then(scalar).unwrap_or_default();
            read.created_by = yaml.get("createdBy").and_then(scalar);
            if name.trim().is_empty() {
                let line = pieces.name.unwrap_or(2);
                problems.push(SpaceProblem::new(line, SpaceProblemKind::NoName, None));
            }
            if !matches!(yaml.get("projects"), None | Some(serde_yaml_ng::Value::Null | serde_yaml_ng::Value::Sequence(_))) {
                // `projects: web-app`처럼 목록이 아니다 — 읽을 수 없는 꼴이다.
                let line = pieces.projects.map_or(2, |lines| lines.first);
                problems.push(SpaceProblem::new(line, SpaceProblemKind::BadYaml, None));
            }
            let mut seen: Vec<String> = Vec::new();
            for (slug, line) in outline.projects(&yaml) {
                let kind = if seen.contains(&slug) {
                    Some(SpaceProblemKind::DuplicateProject)
                } else if !registered.contains(&slug) {
                    Some(SpaceProblemKind::UnknownProject)
                } else {
                    None
                };
                if !seen.contains(&slug) {
                    read.projects.push(slug.clone());
                }
                seen.push(slug.clone());
                if let Some(kind) = kind {
                    problems.push(SpaceProblem::new(line, kind, Some(slug)));
                }
            }
        }
        Err(error) => {
            // 오류의 줄은 frontmatter 안에서 1부터다 — 파일에서는 여는 `---` 한 줄 아래다.
            let line = 1 + error.location().map_or(1, |at| at.line());
            problems.push(SpaceProblem::new(line, SpaceProblemKind::BadYaml, None));
        }
    }
    problems.sort_by_key(|problem| problem.line);
    read.check = SpaceCheck { problems, pieces };
    read
}

/// 글자 · 수 · 참거짓 칸을 글로 — 사람이 `name: 2024`라고 적어도 이름이다. 목록 · 표는 글이 아니다.
fn scalar(value: &serde_yaml_ng::Value) -> Option<String> {
    use serde_yaml_ng::Value;
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

/// 파일 글을 줄로 본 것 — frontmatter의 자리와 그 안 맨 위 칸들의 줄. 줄 번호는 0부터다(밖으로 낼 때 1을 더한다).
struct Outline<'a> {
    lines: Vec<&'a str>,
    /// frontmatter의 YAML 글.
    yaml: &'a str,
    /// frontmatter를 닫는 `---` 줄.
    close: usize,
    keys: Vec<Key>,
}

/// frontmatter 맨 위 칸 하나 — 이름 줄부터 마지막으로 이어지는 줄까지(뒤따르는 빈 줄 · 주석은 넣지 않는다).
struct Key {
    name: String,
    first: usize,
    last: usize,
}

impl<'a> Outline<'a> {
    /// frontmatter를 가르는 규칙은 Project · Agent 파일과 같은 하나다(`split_frontmatter`). 닫히지 않았으면 `None`이다.
    fn of(text: &'a str) -> Option<Self> {
        let (yaml, _) = crate::project::split_frontmatter(text).ok()?;
        let lines: Vec<&str> = text.split('\n').collect();
        let close = 1 + yaml.split('\n').count();
        let mut keys: Vec<Key> = Vec::new();
        for (at, line) in lines.iter().enumerate().take(close).skip(1) {
            if line.trim().is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with([' ', '\t', '-']) {
                if let Some(key) = keys.last_mut() {
                    key.last = at;
                }
                continue;
            }
            let name = line.split_once(':').map_or(*line, |(name, _)| name).trim().trim_matches(['"', '\'']);
            keys.push(Key { name: name.to_string(), first: at, last: at });
        }
        Some(Outline { lines, yaml, close, keys })
    }

    /// `projects`의 항목마다 (slug, 1부터 센 줄). 줄마다 `- ` 항목 하나인 목록이면 그 항목 줄이고, 한 줄 목록(`[a, b]`)처럼 줄과 항목이
    /// 맞지 않으면 모두 `projects` 줄이다. 목록이 아니거나 글이 아닌 항목은 건너뛴다.
    fn projects(&self, yaml: &serde_yaml_ng::Value) -> Vec<(String, usize)> {
        let Some(serde_yaml_ng::Value::Sequence(items)) = yaml.get("projects") else {
            return Vec::new();
        };
        let Some(key) = self.key("projects") else {
            return Vec::new();
        };
        let item_lines = self.item_lines(key);
        let lines: Vec<usize> = if item_lines.len() == items.len() {
            item_lines.iter().map(|at| at + 1).collect()
        } else {
            vec![key.first + 1; items.len()]
        };
        items.iter().zip(lines).filter_map(|(item, line)| Some((scalar(item)?, line))).collect()
    }

    /// 칸 안의 `- ` 항목 줄들(0부터).
    fn item_lines(&self, key: &Key) -> Vec<usize> {
        (key.first + 1..=key.last)
            .filter(|&at| {
                let line = self.lines[at].trim_start();
                line == "-" || line.starts_with("- ")
            })
            .collect()
    }

    fn key(&self, name: &str) -> Option<&Key> {
        self.keys.iter().find(|key| key.name == name)
    }

    /// 닫는 `---` 줄 아래 글 전부.
    fn body(&self) -> String {
        self.lines[self.close + 1..].join("\n")
    }

    /// 본문의 첫 줄 · 끝 줄(빈 줄을 뺀) — 1부터 센다. 본문이 비었으면 없다.
    fn body_lines(&self) -> Option<Lines> {
        let filled: Vec<usize> =
            (self.close + 1..self.lines.len()).filter(|&at| !self.lines[at].trim().is_empty()).collect();
        Some(Lines { first: filled.first()? + 1, last: filled.last()? + 1 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAYMENTS: &str = "---\nname: 결제 서비스\nprojects:\n  - web-app\n  - api-server\ncreatedAt: 2026-10-23\n---\n\n결제와 환불을 한 흐름으로 다뤄요.\n";

    fn registered() -> Vec<String> {
        ["web-app", "api-server", "backoffice"].map(String::from).to_vec()
    }

    /// 검사 하나 — 그 글의 문제와 조각 자리(목록 · 하나 읽기 · 고치기 화면 · 저장이 모두 이것을 탄다).
    fn check_space(text: &str, registered: &[String]) -> SpaceCheck {
        read_text(text, registered).check
    }

    #[test]
    fn 형식대로_적은_파일은_문제가_없고_조각_자리를_돌려준다() {
        let check = check_space(PAYMENTS, &registered());
        assert_eq!(check.problems, vec![]);
        assert_eq!(
            check.pieces,
            SpacePieces {
                name: Some(2),
                projects: Some(Lines { first: 3, last: 5 }),
                body: Some(Lines { first: 9, last: 9 }),
            }
        );
    }

    fn problems(text: &str) -> Vec<(usize, SpaceProblemKind)> {
        check_space(text, &registered()).problems.into_iter().map(|problem| (problem.line, problem.kind)).collect()
    }

    #[test]
    fn 닫히지_않은_frontmatter는_첫_줄의_문제다() {
        assert_eq!(problems("---\nname: 결제\nprojects: []\n\n설명\n"), vec![(1, SpaceProblemKind::UnclosedFrontmatter)]);
        assert_eq!(problems("name: 결제\n"), vec![(1, SpaceProblemKind::UnclosedFrontmatter)], "---로 열리지 않았다");
    }

    #[test]
    fn 읽을_수_없는_yaml은_그_줄의_문제다() {
        assert_eq!(
            problems("---\nname: 결제\nprojects:\n  - web-app\n  bad: [\ncreatedAt: 2026-10-23\n---\n"),
            vec![(5, SpaceProblemKind::BadYaml)]
        );
    }

    #[test]
    fn name이_없거나_비면_그_자리의_문제다() {
        // 없으면 frontmatter의 첫 줄 — name이 설 자리다
        assert_eq!(problems("---\nprojects: []\ncreatedAt: 2026-10-23\n---\n"), vec![(2, SpaceProblemKind::NoName)]);
        assert_eq!(problems("---\nprojects: []\nname:\n---\n"), vec![(3, SpaceProblemKind::NoName)]);
        assert_eq!(problems("---\nprojects: []\nname: \"  \"\n---\n"), vec![(3, SpaceProblemKind::NoName)]);
    }

    #[test]
    fn 등록되지_않은_project와_두_번_적은_project는_그_항목_줄의_문제다() {
        let text = "---\nname: 결제\nprojects:\n  - web-app\n  - billing\n  # 주석\n  - web-app\n---\n";
        assert_eq!(
            problems(text),
            vec![(5, SpaceProblemKind::UnknownProject), (7, SpaceProblemKind::DuplicateProject)]
        );
        let check = check_space(text, &registered());
        assert_eq!(check.problems[0].project.as_deref(), Some("billing"));
        assert_eq!(check.problems[1].project.as_deref(), Some("web-app"));
    }

    #[test]
    fn 한_줄_목록의_문제는_projects_줄에_선다() {
        assert_eq!(
            problems("---\nname: 결제\nprojects: [web-app, billing]\n---\n"),
            vec![(3, SpaceProblemKind::UnknownProject)]
        );
    }

    /// 데이터 루트 하나 — 등록된 Project 셋(파일만, git을 묻지 않는다)과 빈 `spaces/`.
    fn home() -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        let projects = crate::paths::projects_in(home.path());
        std::fs::create_dir_all(&projects).unwrap();
        for slug in registered() {
            let file = format!("---\nname: {slug}\npath: ~/MyProjects/{slug}\nbaseBranch: main\ncreatedAt: 2026-10-01\n---\n");
            std::fs::write(projects.join(format!("{slug}.md")), file).unwrap();
        }
        std::fs::create_dir_all(spaces_in(home.path())).unwrap();
        home
    }

    fn put(home: &tempfile::TempDir, slug: &str, text: &str) {
        std::fs::write(spaces_in(home.path()).join(format!("{slug}.md")), text).unwrap();
    }

    fn file(home: &tempfile::TempDir, slug: &str) -> String {
        std::fs::read_to_string(spaces_in(home.path()).join(format!("{slug}.md"))).unwrap()
    }

    #[test]
    fn 손으로_둔_파일이_목록에_서고_문제_있는_파일도_문제를_달고_선다() {
        let home = home();
        put(&home, "결제-서비스", PAYMENTS);
        put(&home, "사내-도구", "---\nname: 사내 도구\nprojects:\n  - api-server\n  - billing\n---\n");
        put(&home, "깨진", "---\nname: 깨진\n");
        put(&home, ".결제-서비스.md.1.2.tmp", PAYMENTS);
        std::fs::write(spaces_in(home.path()).join("메모.txt"), "x").unwrap();

        let spaces = list_spaces(home.path()).unwrap();
        let rows: Vec<(&str, &str, usize)> =
            spaces.iter().map(|space| (space.slug.as_str(), space.name.as_str(), space.problems.len())).collect();
        // 이름 차례다 — 읽을 수 없는 파일은 이름이 없어 slug로 선다
        assert_eq!(rows, vec![("결제-서비스", "결제 서비스", 0), ("깨진", "", 1), ("사내-도구", "사내 도구", 1)]);

        let payments = &spaces[0];
        assert_eq!(payments.projects, vec!["web-app", "api-server"]);
        assert_eq!(payments.created_at, "2026-10-23");
        assert_eq!(payments.created_by, None);
        assert_eq!(payments.description, "결제와 환불을 한 흐름으로 다뤄요.");
        assert_eq!(spaces[2].projects, vec!["api-server", "billing"], "등록되지 않은 Project도 적힌 대로 읽는다");
    }

    /// 읽을 수 없는 파일(UTF-8이 아님 · 권한 없음) 하나가 목록을 깨지 않는다 — 그 파일은 slug와 문제 하나로 선다(§8 · 스토리 185).
    #[test]
    fn 읽을_수_없는_space_파일은_slug와_문제_하나로_서고_목록을_깨지_않는다() {
        let home = home();
        put(&home, "결제-서비스", PAYMENTS);
        std::fs::write(spaces_in(home.path()).join("깨진-글.md"), [b'-', b'-', b'-', b'\n', 0xff, 0xfe, b'\n']).unwrap();

        let spaces = list_spaces(home.path()).expect("파일 하나가 목록을 깨지 않는다");
        let rows: Vec<(&str, &str, usize)> =
            spaces.iter().map(|space| (space.slug.as_str(), space.name.as_str(), space.projects.len())).collect();
        assert_eq!(rows, vec![("결제-서비스", "결제 서비스", 2), ("깨진-글", "", 0)], "이름이 없어 slug 차례로 선다");
        let unreadable = &spaces[1];
        assert_eq!(
            serde_json::to_value(&unreadable.problems).unwrap(),
            serde_json::json!([{"line": 1, "kind": "unreadable", "message": "파일을 읽을 수 없어요"}])
        );
        assert_eq!((unreadable.description.as_str(), unreadable.created_by.as_ref()), ("", None));
        assert_eq!(get_space(home.path(), "깨진-글").unwrap(), *unreadable, "하나 읽기도 같은 것이다 — 파일이 있으니 없는 Space가 아니다");
        assert!(matches!(get_space(home.path(), "없음"), Err(crate::Error::SpaceNotFound(_))), "없을 때만 찾지 못한다");
    }

    #[test]
    fn 빈_space는_문제가_아니다() {
        let home = home();
        put(&home, "정산", "---\nname: 정산\nprojects: []\ncreatedAt: 2026-10-26\ncreatedBy: host\n---\n");
        put(&home, "운영", "---\nname: 운영\n---\n");
        let settle = get_space(home.path(), "정산").unwrap();
        assert_eq!((settle.projects.len(), settle.problems.len()), (0, 0));
        assert_eq!(settle.created_by.as_deref(), Some("host"));
        assert_eq!(settle.description, "");
        assert_eq!(get_space(home.path(), "운영").unwrap().problems, vec![], "projects 칸이 없어도 빈 Space다");
    }

    #[test]
    fn 없는_space와_뿌리_밖을_가리키는_slug는_찾지_못한다() {
        let home = home();
        assert!(matches!(get_space(home.path(), "없음"), Err(crate::Error::SpaceNotFound(_))));
        assert!(matches!(get_space(home.path(), "../projects/web-app"), Err(crate::Error::SpaceNotFound(_))));
    }

    /// 사람이 손으로 적은 파일 — 주석 · 칸 차례 · 따옴표 · 모르는 칸 · 탭 들여쓰기가 고치기 뒤에도 그대로여야 한다.
    const HAND: &str = "---\n# 결제팀이 관리\nname: \"결제 서비스\"\nowner: 결제팀\nprojects:\n    - web-app   # 화면\n    - api-server\ncreatedAt: 2026-10-23\n---\n\n결제와 환불.\n\n둘째 문단.\n";

    fn edited(text: &str, patch: SpacePatch) -> String {
        edit_space_text(text, &patch).unwrap()
    }

    #[test]
    fn 설명을_고치면_본문만_바뀌고_frontmatter는_한_글자도_안_바뀐다() {
        let out = edited(HAND, SpacePatch { description: Some("새 설명".into()), ..Default::default() });
        let fm_end = HAND.find("---\n\n").unwrap() + 4;
        assert_eq!(&out[..fm_end], &HAND[..fm_end]);
        assert_eq!(&out[fm_end..], "\n새 설명\n");
        let cleared = edited(HAND, SpacePatch { description: Some("  ".into()), ..Default::default() });
        assert_eq!(&cleared[fm_end..], "", "비운 설명은 본문 없이 끝난다");
    }

    #[test]
    fn 이름을_고치면_name_줄만_바뀐다() {
        let out = edited(HAND, SpacePatch { name: Some("결제 · 환불".into()), ..Default::default() });
        assert_eq!(out, HAND.replace("name: \"결제 서비스\"", "name: 결제 · 환불"));
    }

    #[test]
    fn 넣으면_마지막_항목_뒤에_같은_들여쓰기로_한_줄이_선다() {
        let out = edited(HAND, SpacePatch { add: vec!["backoffice".into(), "web-app".into()], ..Default::default() });
        assert_eq!(out, HAND.replace("    - api-server\n", "    - api-server\n    - backoffice\n"), "이미 든 Project는 다시 넣지 않는다");
    }

    #[test]
    fn 빼면_그_항목_줄만_사라지고_되돌리면_제자리에_선다() {
        let out = edited(HAND, SpacePatch { remove: vec!["web-app".into()], ..Default::default() });
        assert_eq!(out, HAND.replace("    - web-app   # 화면\n", ""));
        let back = edited(&out, SpacePatch { add: vec!["web-app".into()], before: Some("api-server".into()), ..Default::default() });
        assert_eq!(back, HAND.replace("    - web-app   # 화면\n", "    - web-app\n"));
    }

    #[test]
    fn 마지막_project를_빼면_빈_목록이_되고_빈_목록에_넣으면_목록이_선다() {
        let one = "---\nname: 결제\nprojects:\n  - web-app\ncreatedAt: 2026-10-23\n---\n";
        let empty = edited(one, SpacePatch { remove: vec!["web-app".into()], ..Default::default() });
        assert_eq!(empty, "---\nname: 결제\nprojects: []\ncreatedAt: 2026-10-23\n---\n");
        assert_eq!(edited(&empty, SpacePatch { add: vec!["web-app".into()], ..Default::default() }), one);
    }

    #[test]
    fn projects_칸이_없으면_name_아래에_세우고_한_줄_목록은_목록으로_다시_적는다() {
        let bare = "---\nname: 운영\ncreatedAt: 2026-10-23\n---\n";
        assert_eq!(
            edited(bare, SpacePatch { add: vec!["api-server".into()], ..Default::default() }),
            "---\nname: 운영\nprojects:\n  - api-server\ncreatedAt: 2026-10-23\n---\n"
        );
        let flow = "---\nname: 운영\nprojects: [web-app, api-server] # 둘\nowner: x\n---\n";
        assert_eq!(
            edited(flow, SpacePatch { remove: vec!["web-app".into()], ..Default::default() }),
            "---\nname: 운영\nprojects:\n  - api-server\nowner: x\n---\n"
        );
    }

    #[test]
    fn yaml이_오해할_글은_따옴표로_적는다() {
        let out = edited("---\nname: x\nprojects: []\n---\n", SpacePatch { name: Some("2024".into()), add: vec!["true".into()], ..Default::default() });
        assert_eq!(out, "---\nname: '2024'\nprojects:\n  - 'true'\n---\n");
    }

    #[test]
    fn 고치기는_그_칸만_바꿔_파일에_쓰고_파일_이름은_그대로다() {
        let home = home();
        put(&home, "결제-서비스", HAND);
        let space = update_space(
            home.path(),
            "결제-서비스",
            SpacePatch { name: Some("결제 · 환불".into()), remove: vec!["web-app".into()], ..Default::default() },
        )
        .unwrap();
        assert_eq!((space.slug.as_str(), space.name.as_str()), ("결제-서비스", "결제 · 환불"), "이름을 고쳐도 slug는 그대로다");
        assert_eq!(space.projects, vec!["api-server"]);
        assert_eq!(
            file(&home, "결제-서비스"),
            HAND.replace("name: \"결제 서비스\"", "name: 결제 · 환불").replace("    - web-app   # 화면\n", ""),
            "모르는 칸 · 주석 · 들여쓰기 · 본문이 남는다"
        );
        let names: Vec<String> = std::fs::read_dir(spaces_in(home.path()))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["결제-서비스.md"], "tmp가 남지 않고 새 파일이 서지 않는다");
    }

    #[test]
    fn 고치기는_새_문제를_만들면_쓰지_않고_이미_있던_문제는_막지_않는다() {
        let home = home();
        put(&home, "결제-서비스", PAYMENTS);
        let refused = update_space(home.path(), "결제-서비스", SpacePatch { add: vec!["billing".into()], ..Default::default() });
        let Err(crate::Error::SpaceProblems(problems)) = refused else { panic!("등록되지 않은 Project를 넣었다: {refused:?}") };
        assert_eq!((problems[0].kind, problems[0].project.as_deref()), (SpaceProblemKind::UnknownProject, Some("billing")));
        assert_eq!(file(&home, "결제-서비스"), PAYMENTS, "거절하면 파일을 건드리지 않는다");
        assert!(matches!(
            update_space(home.path(), "결제-서비스", SpacePatch { name: Some(" ".into()), ..Default::default() }),
            Err(crate::Error::EmptyName)
        ));

        // 손으로 깨뜨린 Project 한 줄이 있어도 설명은 고친다 — 그 문제를 빼는 것도 된다
        let broken = PAYMENTS.replace("  - api-server\n", "  - api-server\n  - billing\n");
        put(&home, "결제-서비스", &broken);
        let space =
            update_space(home.path(), "결제-서비스", SpacePatch { description: Some("새 설명".into()), ..Default::default() }).unwrap();
        assert_eq!((space.description.as_str(), space.problems.len()), ("새 설명", 1));
        let fixed = update_space(home.path(), "결제-서비스", SpacePatch { remove: vec!["billing".into()], ..Default::default() }).unwrap();
        assert_eq!(fixed.problems, vec![]);

        // 닫히지 않은 파일은 고칠 자리를 모른다
        put(&home, "깨진", "---\nname: 깨진\n");
        assert!(matches!(
            update_space(home.path(), "깨진", SpacePatch { description: Some("x".into()), ..Default::default() }),
            Err(crate::Error::SpaceProblems(_))
        ));
        assert!(matches!(update_space(home.path(), "없음", SpacePatch::default()), Err(crate::Error::SpaceNotFound(_))));
    }

    #[test]
    fn 만들기는_이름에서_slug를_짓고_겹치면_뒤에_수를_붙인다() {
        let home = home();
        let made = create_space(
            home.path(),
            NewSpace {
                name: " 결제 서비스 ".into(),
                projects: vec!["web-app".into(), "api-server".into()],
                description: "결제와 환불.".into(),
                created_by: Some("host".into()),
            },
        )
        .unwrap();
        assert_eq!((made.slug.as_str(), made.name.as_str()), ("결제-서비스", "결제 서비스"));
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        assert_eq!(
            file(&home, "결제-서비스"),
            format!("---\nname: 결제 서비스\nprojects:\n  - web-app\n  - api-server\ncreatedAt: {today}\ncreatedBy: host\n---\n\n결제와 환불.\n")
        );

        assert_eq!(new_space_slug(home.path(), "결제 서비스"), "결제-서비스-2");
        let empty = create_space(home.path(), NewSpace { name: "결제 서비스".into(), ..Default::default() }).unwrap();
        assert_eq!(empty.slug, "결제-서비스-2");
        assert_eq!(file(&home, "결제-서비스-2"), format!("---\nname: 결제 서비스\nprojects: []\ncreatedAt: {today}\n---\n"), "빈 Space · 화면에서 만들면 만든 이를 적지 않는다");
    }

    #[test]
    fn 만들기는_문제가_있으면_파일을_쓰지_않는다() {
        let home = home();
        assert!(matches!(create_space(home.path(), NewSpace { name: "  ".into(), ..Default::default() }), Err(crate::Error::EmptyName)));
        let refused = create_space(home.path(), NewSpace { name: "결제".into(), projects: vec!["billing".into()], ..Default::default() });
        assert!(matches!(refused, Err(crate::Error::SpaceProblems(_))));
        assert_eq!(list_spaces(home.path()).unwrap(), vec![]);
    }

    #[test]
    fn 함께_쓰는_space는_같은_project를_적은_다른_space와_겹치는_project다() {
        let home = home();
        put(&home, "결제-서비스", PAYMENTS);
        put(&home, "사내-도구", "---\nname: 사내 도구\nprojects:\n  - backoffice\n  - api-server\n---\n");
        put(&home, "정산", "---\nname: 정산\nprojects: []\n---\n");
        put(&home, "화면", "---\nname: 화면\nprojects:\n  - web-app\n  - api-server\n---\n");
        let shared = shared_spaces(home.path(), "결제-서비스").unwrap();
        let rows: Vec<(&str, Vec<&str>)> =
            shared.iter().map(|one| (one.slug.as_str(), one.overlap.iter().map(String::as_str).collect())).collect();
        assert_eq!(rows, vec![("사내-도구", vec!["api-server"]), ("화면", vec!["web-app", "api-server"])]);
        assert_eq!(shared[0].projects, vec!["backoffice", "api-server"], "그래프가 그 Space의 다른 Project도 옅게 그린다");
        assert_eq!(shared_spaces(home.path(), "정산").unwrap(), vec![], "빈 Space는 겹칠 것이 없다");
    }

    #[test]
    fn 목록이_아닌_projects는_읽을_수_없는_꼴이다() {
        assert_eq!(problems("---\nname: 결제\nprojects: web-app\n---\n"), vec![(3, SpaceProblemKind::BadYaml)]);
    }

    #[test]
    fn 관계_편집은_파일_글을_그대로_읽는다() {
        let home = home();
        put(&home, "결제-서비스", HAND);
        assert_eq!(read_space_text(home.path(), "결제-서비스").unwrap(), HAND);
        assert!(matches!(read_space_text(home.path(), "없음"), Err(crate::Error::SpaceNotFound(_))));
        assert!(matches!(read_space_text(home.path(), "../projects/web-app"), Err(crate::Error::SpaceNotFound(_))));
    }

    #[test]
    fn 글로_저장은_사람이_쓴_글을_한_글자도_바꾸지_않고_쓴다() {
        let home = home();
        put(&home, "결제-서비스", HAND);
        // 차례를 바꾸고 · 주석을 더하고 · 따옴표 없는 이름 · 모르는 칸 — 앱이 다시 적지 않는다
        let text = HAND
            .replace("name: \"결제 서비스\"", "name: 결제 · 환불 # 고침")
            .replace("    - api-server\n", "    - backoffice\n    - api-server\n")
            .replace("둘째 문단.\n", "둘째 문단.");
        let space = save_space_text(home.path(), Some("결제-서비스"), &text).unwrap();
        assert_eq!(file(&home, "결제-서비스"), text);
        assert_eq!((space.slug.as_str(), space.name.as_str()), ("결제-서비스", "결제 · 환불"), "이름을 고쳐도 파일 이름은 그대로다");
        assert_eq!(space.projects, vec!["web-app", "backoffice", "api-server"]);
    }

    #[test]
    fn 글로_저장은_문제가_있으면_쓰지_않는다() {
        let home = home();
        put(&home, "결제-서비스", PAYMENTS);
        let broken = PAYMENTS.replace("  - api-server\n", "  - api-server\n  - billing\n  - web-app\n");
        let Err(crate::Error::SpaceProblems(problems)) = save_space_text(home.path(), Some("결제-서비스"), &broken) else {
            panic!("등록되지 않은 Project · 같은 Project 두 번")
        };
        let kinds: Vec<_> = problems.iter().map(|problem| (problem.line, problem.kind)).collect();
        assert_eq!(kinds, vec![(6, SpaceProblemKind::UnknownProject), (7, SpaceProblemKind::DuplicateProject)]);
        assert_eq!(file(&home, "결제-서비스"), PAYMENTS, "거절하면 파일을 건드리지 않는다");

        assert!(matches!(
            save_space_text(home.path(), None, "---\nname: \nprojects: []\ncreatedAt: 2026-10-26\n---\n"),
            Err(crate::Error::SpaceProblems(_))
        ));
        assert!(matches!(save_space_text(home.path(), None, "---\nname: 정산\n"), Err(crate::Error::SpaceProblems(_))));
        assert_eq!(list_spaces(home.path()).unwrap().len(), 1, "새 파일도 서지 않는다");
    }

    #[test]
    fn 관계_편집의_저장은_없는_space를_새로_만들지_않는다() {
        let home = home();
        assert!(matches!(save_space_text(home.path(), Some("결제-서비스"), PAYMENTS), Err(crate::Error::SpaceNotFound(_))));
        assert!(matches!(save_space_text(home.path(), Some("../x"), PAYMENTS), Err(crate::Error::SpaceNotFound(_))));
        assert_eq!(list_spaces(home.path()).unwrap(), vec![]);
    }

    #[test]
    fn 새_파일은_글의_이름에서_slug를_짓고_겹치면_뒤에_수를_붙인다() {
        let home = home();
        let text = "---\nname:  결제   서비스 \nprojects: []\ncreatedAt: 2026-10-26\n---\n";
        let made = save_space_text(home.path(), None, text).unwrap();
        assert_eq!(made.slug, "결제-서비스", "이름의 빈칸은 하나로 접어 slug를 짓는다");
        assert_eq!(file(&home, "결제-서비스"), text, "글은 적은 그대로다");
        assert_eq!(save_space_text(home.path(), None, text).unwrap().slug, "결제-서비스-2");
        assert_eq!(file(&home, "결제-서비스-2"), text);
    }

    #[test]
    fn 새_space의_slug는_new가_아니다() {
        // `/spaces/new`는 새 Space 화면의 주소다 — 그 slug의 상세가 가려지지 않게 앱이 그 이름의 파일을 만들지 않는다
        let home = home();
        assert_eq!(new_space_slug(home.path(), "New"), "new-2");
        assert_eq!(new_space_slug(home.path(), "news"), "news");
    }

    #[test]
    fn 고치기_화면의_검사는_문제와_조각과_그_글의_미리보기를_돌려준다() {
        let home = home();
        put(&home, "결제-서비스", PAYMENTS);
        put(&home, "사내-도구", "---\nname: 사내 도구\nprojects:\n  - backoffice\n  - api-server\n---\n");
        let text = PAYMENTS.replace("  - api-server\n", "  - api-server\n  - billing\n");
        let draft = draft_space(home.path(), Some("결제-서비스"), &text).unwrap();
        assert_eq!(draft.space.slug, "결제-서비스");
        assert_eq!(draft.space.name, "결제 서비스");
        assert_eq!(
            draft.space.problems.iter().map(|problem| (problem.line, problem.kind)).collect::<Vec<_>>(),
            vec![(6, SpaceProblemKind::UnknownProject)]
        );
        assert_eq!(draft.pieces, check_space(&text, &registered()).pieces, "조각 자리는 검사 하나의 것이다");
        assert_eq!(draft.registered, vec!["api-server", "backoffice", "web-app"], "안내 줄의 넣을 수 있는 Project — 등록부 차례");
        let shared: Vec<(&str, Vec<&str>)> =
            draft.shared.iter().map(|one| (one.slug.as_str(), one.overlap.iter().map(String::as_str).collect())).collect();
        assert_eq!(shared, vec![("사내-도구", vec!["api-server"])], "고치는 Space 자신은 함께 쓰는 Space가 아니다");
        assert_eq!(draft.suffix, None);
        assert!(draft.folder.ends_with("spaces"), "{}", draft.folder);
    }

    #[test]
    fn 새_space의_검사는_이름을_따라_파일_이름을_미리_보인다() {
        let home = home();
        put(&home, "사내-도구", "---\nname: 사내 도구\nprojects:\n  - api-server\n---\n");
        let draft = draft_space(home.path(), None, "---\nname: 정산\nprojects:\n  - api-server\n---\n").unwrap();
        assert_eq!((draft.space.slug.as_str(), draft.suffix.as_deref()), ("정산", None));
        assert_eq!(draft.shared.len(), 1, "새 Space도 같은 Project를 쓰는 Space를 본다");

        let taken = draft_space(home.path(), None, "---\nname: 사내 도구\nprojects: []\n---\n").unwrap();
        assert_eq!((taken.space.slug.as_str(), taken.suffix.as_deref()), ("사내-도구-2", Some("-2")));

        let blank = draft_space(home.path(), None, "---\nname: \nprojects: []\ncreatedAt: 2026-10-26\n---\n").unwrap();
        assert_eq!((blank.space.slug.as_str(), blank.suffix.as_deref()), ("", None), "이름이 비면 파일 이름도 없다");
        assert_eq!(blank.space.problems[0].kind, SpaceProblemKind::NoName);
    }
}
