//! 대화로 하는 설정(03 구현 스펙 §12 · S13 · 티켓 12) — Thread 도구 「Project 추가」 · 「Project 고치기」 · 「Space 만들기」 · 「Space 고치기」.
//!
//! - **화면과 같은 core 함수, 같은 파일이다**(§17) — 추가는 core `add_project`(폴더 살피기 갈래 그대로), 고치기는 `update_project`(기준
//!   브랜치 검사 포함), Space는 `create_space`(만든 이 `host` — S6) · `update_space`(글 단위 고치기). 화면이 따로 검사하지 않듯 이 도구도
//!   따로 검사하지 않는다 — core의 거절을 Agent가 읽을 글로 돌려준다.
//! - **승인 카드를 세우지 않는다**(S13) — 사람이 대화로 부탁한 Atelier 설정 파일의 일이고 화면에서 모두 고치고 되돌릴 수 있다. git
//!   물음(git이 아닌 폴더 · 저장소의 하위 폴더)만 질문 카드로 묻는다(`question` · `card: project-add`) — 화면 추가 창과 같은 물음이다. 세우고
//!   기다리는 길 · 멈춤 · 닫힘은 Work 만들기 카드와 하나다([`ConversationHost::ask_card`]).
//! - **해낸 설정마다 결과 카드 줄**(`setting`)이 하나 선다 — 무엇을 했나(`action`) · 대상 slug · 이름 · 카드의 첫 줄(`title`) · 둘째 줄
//!   (`detail`). 글은 여기서 짓는다 — 그때의 값이라 화면이 나중에 다시 지을 수 없다(기록은 덧붙이기만 한다). 바뀐 것이 없으면 줄도 없다.
//! - **지우는 도구는 없다**(§17) — 머리말이 그 화면을 안내하라고 지시한다.

use std::path::{Path, PathBuf};

use atelier_core::{AddProject, FolderLook, NewSpace, Project, ProjectPatch, ProjectView, RecordKind, SpacePatch, SpaceProblemKind};
use serde_json::{json, Value};

use super::work::{Card, Settled};
use super::{ConversationHost, SessionKey};
use crate::thread_tools::{self, ProjectAdd, ProjectEdit, SpaceEdit, SpaceNew};
use crate::HostError;

/// Project 추가 질문 카드에서 사람이 고른 것(03 §12).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectAddChoice {
    /// 「git init 하고 추가」 — git이 아닌 폴더에 빈 저장소를 세우고 등록한다(기준 브랜치 `main`).
    Init,
    /// 「뿌리 폴더로 추가」 — 하위 폴더 대신 그 저장소의 뿌리를 등록한다.
    Root,
    /// 「그대로 추가」 — 하위 폴더를 그대로 등록한다.
    AsIs,
    /// 「추가하지 않기」(esc) — 아무것도 하지 않는다.
    Decline,
}

impl ProjectAddChoice {
    /// 답 줄의 `choice` 값.
    fn as_str(self) -> &'static str {
        match self {
            ProjectAddChoice::Init => "init",
            ProjectAddChoice::Root => "root",
            ProjectAddChoice::AsIs => "as-is",
            ProjectAddChoice::Decline => "decline",
        }
    }
}

/// Project 추가 질문 카드의 값 — 물은 폴더(링크를 푼 자리)와, 하위 폴더면 그 저장소의 뿌리, Agent가 준 이름 · 설명.
pub(super) struct ProjectAddCard {
    folder: PathBuf,
    /// 하위 폴더면 그 저장소의 뿌리 — git이 아닌 폴더면 없다.
    root: Option<PathBuf>,
    name: Option<String>,
    description: Option<String>,
}

impl ProjectAddCard {
    /// 이 카드가 내민 답인가 — git이 아닌 폴더는 「git init 하고 추가」 · 「추가하지 않기」, 하위 폴더는 뿌리 · 그대로 · 추가하지 않기다.
    fn offers(&self, choice: ProjectAddChoice) -> bool {
        match choice {
            ProjectAddChoice::Init => self.root.is_none(),
            ProjectAddChoice::Root | ProjectAddChoice::AsIs => self.root.is_some(),
            ProjectAddChoice::Decline => true,
        }
    }
}

/// 폴더를 등록한 결과 — 새로 등록했나, 이미 등록된 폴더였나.
enum Added {
    New(ProjectView),
    Already(ProjectView),
}

/// 해낸 설정의 갈래 넷(§12) — 결과 카드 줄의 `action`과 그 카드의 단추가 여기 하나에서 갈린다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Action {
    ProjectAdded,
    ProjectEdited,
    SpaceCreated,
    SpaceEdited,
}

impl Action {
    /// 결과 카드 줄의 `action` 값 — 화면(`result-card.ts`)이 이 글로 카드의 아이콘 · 단추를 고른다.
    fn as_str(self) -> &'static str {
        match self {
            Action::ProjectAdded => "project-added",
            Action::ProjectEdited => "project-edited",
            Action::SpaceCreated => "space-created",
            Action::SpaceEdited => "space-edited",
        }
    }

    /// 그 카드의 단추 — Project · 새 Space는 「열기」, Space 고침은 「관계 보기」(§12).
    fn button(self) -> &'static str {
        match self {
            Action::SpaceEdited => "관계 보기",
            Action::ProjectAdded | Action::ProjectEdited | Action::SpaceCreated => "열기",
        }
    }

    /// 해낸 설정의 도구 결과 끝 — 사람이 결과 카드의 단추로 그 화면에서 다시 고친다.
    fn settled(self) -> String {
        format!("흐름에 결과 카드가 섰다 — 사람이 「{}」로 그 화면에서 다시 고칠 수 있다.", self.button())
    }
}

/// 결과 카드 줄 하나(§12) — 무엇을 했나 · 대상 · 카드의 두 줄.
struct Setting {
    action: Action,
    slug: String,
    name: String,
    title: String,
    detail: String,
}

impl ConversationHost {
    /// Thread 도구 「Project 추가」(§12) — 폴더를 살펴(§15) 저장소의 뿌리면 곧바로 등록하고, git이 아니거나 하위 폴더면 질문 카드를 세우고
    /// 사람이 고를 때까지 기다린다(**막히는 호출일 수 있다**). 이미 등록된 폴더는 바꾸지 않는다. 없는 폴더는 도구의 실패다.
    pub(super) fn add_project_tool(&self, key: &SessionKey, ask: ProjectAdd) -> Value {
        let registry = atelier_core::projects_in(&self.data_root);
        let card = |folder: &str, root: Option<String>| ProjectAddCard {
            folder: atelier_core::expand_home(folder),
            root: root.as_deref().map(atelier_core::expand_home),
            name: ask.name.clone(),
            description: ask.description.clone(),
        };
        match atelier_core::inspect_folder(&registry, Path::new(&ask.path)) {
            FolderLook::Missing { path } => thread_tools::said(&format!("폴더가 없다: `{path}` — 경로를 확인하고 다시 부른다."), true),
            FolderLook::Registered { project, .. } => thread_tools::said(&already_text(&project.project), false),
            FolderLook::Repo { path, .. } => {
                let added = self.add_folder(&atelier_core::expand_home(&path), false, ask.name.clone(), ask.description.clone());
                match added.and_then(|added| self.settle_added(key, added)) {
                    Ok(text) => thread_tools::said(&text, false),
                    Err(why) => thread_tools::said(&why, true),
                }
            }
            FolderLook::NotGit { path } => {
                let fields = json!({"look": "notGit", "path": path, "folder": folder_name(&path), "root": null});
                self.ask_card(key, Card::ProjectAdd(card(&path, None)), fields)
            }
            FolderLook::Subfolder { path, root, .. } => {
                let fields = json!({"look": "subfolder", "path": path, "folder": folder_name(&path), "root": root});
                self.ask_card(key, Card::ProjectAdd(card(&path, Some(root))), fields)
            }
        }
    }

    /// Project 추가 질문 카드의 답(§12) — 사람이 고른 것으로 그 카드를 닫는다. 등록하면 답 줄 뒤에 결과 카드 줄이 선다. 등록하지 못하면
    /// (git이 실패했다 — 이름 · 이메일 설정 없음) 아무것도 적지 않고 그 까닭으로 실패하며 카드는 그대로 선다. 카드에 없던 답이거나 이미
    /// 닫힌 카드면 거절이다. 기다리지 않는다 — 도구의 결과와 Host의 다음 말은 기록 줄로 온다.
    pub fn answer_project_add(&self, thread: &str, request: &str, choice: ProjectAddChoice) -> Result<(), HostError> {
        let asked = self
            .threads
            .proposals
            .take(thread, request, "project-add")
            .ok_or_else(|| HostError::QuestionClosed { thread: thread.to_owned(), request: request.to_owned() })?;
        let Card::ProjectAdd(card) = &asked.card else { unreachable!("Project 추가 카드만 꺼냈다") };
        if !card.offers(choice) {
            self.threads.proposals.put_back(request, asked);
            return Err(HostError::ProjectNotAdded(format!("이 카드에 없는 답이에요 — {}", choice.as_str())));
        }
        let folder = match choice {
            ProjectAddChoice::Decline => None,
            ProjectAddChoice::Root => card.root.clone(),
            ProjectAddChoice::Init | ProjectAddChoice::AsIs => Some(card.folder.clone()),
        };
        let answered = |project: Option<&str>| {
            json!({"state": "answered", "requestId": request, "card": "project-add", "choice": choice.as_str(), "project": project})
        };
        let Some(folder) = folder else {
            self.thread_log(thread)?.write(RecordKind::Question, Some(&asked.key.handle), answered(None)).map_err(HostError::Record)?;
            let folder = atelier_core::collapse_home(&card.folder);
            let text = format!(
                "사람이 추가하지 않기로 했다 — `{folder}`{} Project로 등록하지 않았다. 같은 부탁을 곧바로 다시 하지 않는다.",
                particle(&folder, "은", "는")
            );
            asked.settle(Settled::Said { text, refused: false });
            return Ok(());
        };
        let added = match self.add_folder(&folder, choice == ProjectAddChoice::Init, card.name.clone(), card.description.clone()) {
            Ok(added) => added,
            Err(why) => {
                // 등록하지 못했다 — 카드는 그대로 선다. 사람이 고쳐(git 설정) 다시 고르거나 「추가하지 않기」를 고른다.
                self.threads.proposals.put_back(request, asked);
                return Err(HostError::ProjectNotAdded(why));
            }
        };
        let slug = match &added {
            Added::New(view) | Added::Already(view) => view.project.slug.clone(),
        };
        self.thread_log(thread)?.write(RecordKind::Question, Some(&asked.key.handle), answered(Some(&slug))).map_err(HostError::Record)?;
        let (text, refused) = match self.settle_added(&asked.key, added) {
            Ok(text) => (text, false),
            Err(why) => (why, true),
        };
        asked.settle(Settled::Said { text, refused });
        Ok(())
    }

    /// 그 폴더를 등록한다 — core 추가 하나(화면의 추가 창과 같다), 설명을 줬으면 core 고치기로 적는다. 이미 등록된 폴더는 이름 · 설명을
    /// 덮지 않는다. 기록 줄은 적지 않는다([`Self::settle_added`]).
    fn add_folder(&self, folder: &Path, init_git: bool, name: Option<String>, description: Option<String>) -> Result<Added, String> {
        let registry = atelier_core::projects_in(&self.data_root);
        if let FolderLook::Registered { project, .. } = atelier_core::inspect_folder(&registry, folder) {
            return Ok(Added::Already(project));
        }
        let view = atelier_core::add_project(&registry, folder, AddProject { name, init_git }).map_err(|error| {
            let folder = atelier_core::collapse_home(folder);
            format!("`{folder}`{} Project로 추가하지 못했다 — {error}", particle(&folder, "을", "를"))
        })?;
        let Some(description) = description else { return Ok(Added::New(view)) };
        let patch = ProjectPatch { name: None, description: Some(description), base_branch: None };
        atelier_core::update_project(&registry, &view.project.slug, patch)
            .map(Added::New)
            .map_err(|error| {
                let slug = &view.project.slug;
                format!("Project `{slug}`{} 추가했지만 설명을 적지 못했다 — {error}", particle(slug, "을", "를"))
            })
    }

    /// 등록한 결과를 남기고 Agent에게 돌려줄 글을 짓는다 — 새로 등록했으면 결과 카드 줄 「Project를 추가했어요 — …」, 이미 등록된 폴더면
    /// 줄 없이 그렇다는 글이다.
    fn settle_added(&self, key: &SessionKey, added: Added) -> Result<String, String> {
        let view = match added {
            Added::Already(view) => return Ok(already_text(&view.project)),
            Added::New(view) => view,
        };
        let project = &view.project;
        self.note_setting(
            key,
            Setting {
                action: Action::ProjectAdded,
                slug: project.slug.clone(),
                name: project.name.clone(),
                title: format!("Project를 추가했어요 — {}", project.name),
                detail: format!("{} · git 레포 · 기준 브랜치 {}", project.path, project.base_branch),
            },
        )?;
        Ok(format!(
            "Project `{}`({}){} 추가했다 — 폴더 `{}` · 기준 브랜치 `{}`. {}",
            project.slug,
            project.name,
            particle(&project.name, "을", "를"),
            project.path,
            project.base_branch,
            Action::ProjectAdded.settled()
        ))
    }

    /// Thread 도구 「Project 고치기」(§12 · §15 「고치기」) — 준 칸만 core 고치기 하나로 바꾼다. 기준 브랜치가 그 저장소에 없으면 아무것도
    /// 쓰지 않고 고를 수 있는 브랜치를 돌려준다(스토리 63). 바뀐 것이 있으면 결과 카드 줄이 선다.
    pub(super) fn edit_project_tool(&self, key: &SessionKey, edit: ProjectEdit) -> Value {
        let registry = atelier_core::projects_in(&self.data_root);
        let Ok(before) = atelier_core::get_project(&registry, &edit.project) else {
            return thread_tools::said(&self.unknown_project(&edit.project), true);
        };
        let patch = ProjectPatch { name: edit.name, description: edit.description, base_branch: edit.base_branch };
        let after = match atelier_core::update_project(&registry, &edit.project, patch) {
            Ok(after) => after,
            Err(atelier_core::Error::BranchNotListed(branch)) => return thread_tools::said(&branch_refusal(&before, &branch), true),
            Err(atelier_core::Error::EmptyName) => {
                return thread_tools::said("name은 비울 수 없다 — 새 이름을 주거나 name을 빼고 다시 부른다.", true);
            }
            Err(error) => {
                let failed = format!("Project `{}`{} 고치지 못했다 — {error}", edit.project, particle(&edit.project, "을", "를"));
                return thread_tools::said(&failed, true);
            }
        };
        let Some((title, detail)) = project_edited(&before.project, &after.project) else {
            let unchanged = format!("바뀐 것이 없다 — Project `{}`{} 그대로다.", edit.project, particle(&edit.project, "은", "는"));
            return thread_tools::said(&unchanged, false);
        };
        let action = Action::ProjectEdited;
        let setting = Setting { action, slug: after.project.slug.clone(), name: after.project.name.clone(), title, detail };
        match self.note_setting(key, setting) {
            Ok(()) => thread_tools::said(
                &format!(
                    "Project `{}`{} 고쳤다 — {}. {}",
                    edit.project,
                    particle(&edit.project, "을", "를"),
                    project_now(&after.project),
                    action.settled()
                ),
                false,
            ),
            Err(why) => thread_tools::said(&why, true),
        }
    }

    /// Thread 도구 「Space 만들기」(§12 · §8 「만들기」) — 만든 이는 `host`다(S6). 문제가 있으면 만들지 않고 그 문제를 돌려준다.
    pub(super) fn create_space_tool(&self, key: &SessionKey, new: SpaceNew) -> Value {
        let made = atelier_core::create_space(
            &self.data_root,
            NewSpace {
                name: new.name,
                projects: new.projects,
                description: new.description.unwrap_or_default(),
                created_by: Some(MADE_BY.to_owned()),
            },
        );
        let space = match made {
            Ok(space) => space,
            Err(error) => return thread_tools::said(&self.space_refusal(error, "만들지 않았다"), true),
        };
        let file = atelier_core::collapse_home(&atelier_core::spaces_in(&self.data_root).join(format!("{}.md", space.slug)));
        let names = self.project_names(&space.projects);
        let setting = Setting {
            action: Action::SpaceCreated,
            slug: space.slug.clone(),
            name: space.name.clone(),
            title: format!("Space를 만들었어요 — {}", space.name),
            detail: format!("{} · {file}", if names.is_empty() { "Project 없음".to_owned() } else { names.join(" · ") }),
        };
        let read = if space.projects.is_empty() { "없음".to_owned() } else { space.projects.join(", ") };
        match self.note_setting(key, setting) {
            Ok(()) => thread_tools::said(
                &format!(
                    "Space `{}`({}){} 만들었다 — 파일 `{file}` · Project: {read}. {} 이 Thread를 이 Space에 붙이려면 \
                     set_space를 부른다.",
                    space.slug,
                    space.name,
                    particle(&space.name, "을", "를"),
                    Action::SpaceCreated.settled()
                ),
                false,
            ),
            Err(why) => thread_tools::said(&why, true),
        }
    }

    /// Thread 도구 「Space 고치기」(§12 · §8 「고치기」) — 준 칸만 글 단위로 고친다(나머지 글은 그대로). 새 문제가 생기면 쓰지 않고 그 문제를
    /// 돌려준다. 바뀐 것이 있으면 결과 카드 줄(「관계 보기」)이 선다.
    pub(super) fn edit_space_tool(&self, key: &SessionKey, edit: SpaceEdit) -> Value {
        let Ok(before) = atelier_core::get_space(&self.data_root, &edit.space) else {
            return thread_tools::said(&self.unknown_space(&edit.space), true);
        };
        let patch = SpacePatch { name: edit.name, description: edit.description, add: edit.add, before: None, remove: edit.remove };
        let after = match atelier_core::update_space(&self.data_root, &edit.space, patch) {
            Ok(after) => after,
            Err(error) => return thread_tools::said(&self.space_refusal(error, "고치지 않았다"), true),
        };
        let added: Vec<String> = after.projects.iter().filter(|slug| !before.projects.contains(slug)).cloned().collect();
        let removed: Vec<String> = before.projects.iter().filter(|slug| !after.projects.contains(slug)).cloned().collect();
        let renamed = before.name != after.name;
        let described = before.description.trim() != after.description.trim();
        if added.is_empty() && removed.is_empty() && !renamed && !described {
            let unchanged = format!("바뀐 것이 없다 — Space `{}`{} 그대로다.", edit.space, particle(&edit.space, "은", "는"));
            return thread_tools::said(&unchanged, false);
        }
        let shared = atelier_core::shared_spaces(&self.data_root, &after.slug).map_or(0, |shared| shared.len());
        let title = space_edited(
            &shown(&before.name, &before.slug),
            &shown(&after.name, &after.slug),
            &self.project_names(&added),
            &self.project_names(&removed),
            described,
        );
        let setting = Setting {
            action: Action::SpaceEdited,
            slug: after.slug.clone(),
            name: after.name.clone(),
            title,
            detail: format!("Project {} · 함께 쓰는 Space {shared}", after.projects.len()),
        };
        let read = if after.projects.is_empty() { "없음".to_owned() } else { after.projects.join(", ") };
        match self.note_setting(key, setting) {
            Ok(()) => thread_tools::said(
                &format!(
                    "Space `{}`({}){} 고쳤다 — Project: {read}. {} 이 Space로 읽는 Thread는 다음 말부터 바뀐 Project를 읽는다.",
                    after.slug,
                    after.name,
                    particle(&after.name, "을", "를"),
                    Action::SpaceEdited.settled()
                ),
                false,
            ),
            Err(why) => thread_tools::said(&why, true),
        }
    }

    /// 결과 카드 줄을 남긴다 — 설정을 한 Agent가 줄의 `who`다.
    fn note_setting(&self, key: &SessionKey, setting: Setting) -> Result<(), String> {
        let payload = json!({
            "action": setting.action.as_str(), "slug": setting.slug, "name": setting.name, "title": setting.title, "detail": setting.detail,
        });
        let log = self.thread_log(&key.thread).map_err(|error| error.to_string())?;
        log.write(RecordKind::Setting, Some(&key.handle), payload)
            .map(drop)
            .map_err(|error| format!("설정은 했지만 Thread에 적지 못했다 — {error}"))
    }

    /// 등록된 Project의 이름들 — slug의 차례 그대로, 등록되지 않은 것은 slug다.
    fn project_names(&self, slugs: &[String]) -> Vec<String> {
        let registered = atelier_core::list_projects(&atelier_core::projects_in(&self.data_root)).unwrap_or_default();
        slugs
            .iter()
            .map(|slug| registered.iter().find(|view| &view.project.slug == slug).map_or(slug.clone(), |view| view.project.name.clone()))
            .collect()
    }

    /// 등록되지 않은 Project — 등록된 것을 함께 알린다(`set_space`와 같은 말).
    fn unknown_project(&self, slug: &str) -> String {
        format!("등록되지 않은 Project다: {slug} — {}", self.registered_list())
    }

    /// 「등록된 Project(list_projects): web-app, api-server」.
    fn registered_list(&self) -> String {
        let registered = atelier_core::list_projects(&atelier_core::projects_in(&self.data_root)).unwrap_or_default();
        let known: Vec<&str> = registered.iter().map(|view| view.project.slug.as_str()).collect();
        format!("등록된 Project(list_projects): {}", if known.is_empty() { "없음".to_owned() } else { known.join(", ") })
    }

    /// 없는 Space — 있는 것을 함께 알린다(`set_space`와 같은 말).
    fn unknown_space(&self, slug: &str) -> String {
        let spaces = atelier_core::list_spaces(&self.data_root).unwrap_or_default();
        let known: Vec<&str> = spaces.iter().map(|space| space.slug.as_str()).collect();
        let known = if known.is_empty() { "없음".to_owned() } else { known.join(", ") };
        format!("없는 Space다: {slug} — Space(list_spaces): {known}")
    }

    /// Space 만들기 · 고치기의 거절 — core의 문제 글 그대로(화면 · 저장과 같은 말, §8), 등록되지 않은 Project면 등록된 것을 덧붙인다.
    fn space_refusal(&self, error: atelier_core::Error, undone: &str) -> String {
        match error {
            atelier_core::Error::EmptyName => format!("name은 비울 수 없다 — {undone}."),
            atelier_core::Error::SpaceNotFound(slug) => self.unknown_space(&slug),
            atelier_core::Error::SpaceProblems(problems) => {
                let unknown = problems.iter().any(|problem| problem.kind == SpaceProblemKind::UnknownProject);
                let said = atelier_core::Error::SpaceProblems(problems).to_string();
                if unknown {
                    format!("{said} — {undone}. {}", self.registered_list())
                } else {
                    format!("{said} — {undone}.")
                }
            }
            other => format!("Space 파일을 쓰지 못했다 — {other}"),
        }
    }
}

/// Space를 만든 이 — Host 도구로 만들면 `host`다(S6). 상세의 「만든 사람」이 읽는다.
const MADE_BY: &str = "host";

/// 이미 등록된 폴더의 글(스토리 61) — 아무것도 바꾸지 않았다.
fn already_text(project: &Project) -> String {
    format!(
        "이미 등록된 폴더다 — Project `{}`({}) · 폴더 `{}` · 기준 브랜치 `{}`. 아무것도 바꾸지 않았다.",
        project.slug, project.name, project.path, project.base_branch
    )
}

/// 폴더 이름 — 질문 카드의 「notes는 git 저장소가 아니에요」.
fn folder_name(path: &str) -> String {
    path.trim_end_matches('/').rsplit('/').next().unwrap_or(path).to_owned()
}

/// 지금의 Project — 고친 뒤 Agent에게 보이는 한 줄.
fn project_now(project: &Project) -> String {
    format!("이름 {} · 기준 브랜치 `{}`", project.name, project.base_branch)
}

/// 없는 기준 브랜치의 거절(스토리 63) — 그 저장소에서 고를 수 있는 브랜치를 함께 준다. fetch하지 않는다.
fn branch_refusal(view: &ProjectView, branch: &str) -> String {
    let project = &view.project;
    let head = format!("기준 브랜치 `{branch}`{} {} 저장소에 없다 — 바꾸지 않았다.", particle(branch, "은", "는"), project.slug);
    let Some(git) = &view.git else {
        return format!("{head} 그 폴더(`{}`)를 git 저장소로 읽지 못해 고를 수 있는 브랜치가 없다.", project.path);
    };
    let mut listed = vec![format!("로컬 {}", if git.local_branches.is_empty() { "없음".to_owned() } else { git.local_branches.join(", ") })];
    for remote in git.remote_branches.iter().filter(|remote| !remote.branches.is_empty()) {
        listed.push(format!("원격 {} {}", remote.remote, remote.branches.join(", ")));
    }
    format!(
        "{head} 고를 수 있는 브랜치: {}. Atelier는 fetch하지 않는다 — 원격 브랜치는 origin/<이름> 그대로 준다.",
        listed.join(" · ")
    )
}

/// Project 고침의 결과 카드 두 줄(스토리 62) — 바뀐 칸 하나면 그 칸의 말, 여럿이면 바뀐 칸을 잇는다. 바뀐 것이 없으면 없다.
fn project_edited(before: &Project, after: &Project) -> Option<(String, String)> {
    let mut changed: Vec<(&str, String, String)> = Vec::new();
    if before.name != after.name {
        let title = format!("{}의 이름을 {}{} 바꿨어요", before.name, after.name, particle(&after.name, "으로", "로"));
        changed.push(("이름", title, format!("파일 이름({}.md)과 경로는 그대로예요", after.slug)));
    }
    if before.description.trim() != after.description.trim() {
        let first = after.description.lines().map(str::trim).find(|line| !line.is_empty());
        let title = match first {
            Some(_) => format!("{}의 설명을 고쳤어요", after.name),
            None => format!("{}의 설명을 비웠어요", after.name),
        };
        changed.push(("설명", title, first.map_or_else(|| "Agent가 이 Project를 이해할 때 읽어요".to_owned(), str::to_owned)));
    }
    if before.base_branch != after.base_branch {
        let base = &after.base_branch;
        let title = format!("{}의 기준 브랜치를 {base}{} 바꿨어요", after.name, particle(base, "으로", "로"));
        changed.push(("기준 브랜치", title, format!("새 Work부터 {base}에서 갈라져요")));
    }
    match changed.as_slice() {
        [] => None,
        [(_, title, detail)] => Some((title.clone(), detail.clone())),
        many => {
            let fields: Vec<&str> = many.iter().map(|(field, _, _)| *field).collect();
            let last = fields[fields.len() - 1];
            let details: Vec<&str> = many.iter().map(|(_, _, detail)| detail.as_str()).collect();
            Some((format!("{}의 {}{} 바꿨어요", after.name, fields.join(" · "), particle(last, "을", "를")), details.join(" · ")))
        }
    }
}

/// Space 고침의 결과 카드 첫 줄(스토리 65) — 넣고 뺀 Project가 있으면 그것(「결제 서비스에 backoffice를 넣었어요」), 없으면 이름 · 설명.
/// 이름을 함께 고쳤으면 Space는 새 이름으로 부른다.
fn space_edited(before: &str, after: &str, added: &[String], removed: &[String], described: bool) -> String {
    let object = |names: &[String]| {
        let joined = names.join(" · ");
        let particle = particle(&joined, "을", "를");
        format!("{joined}{particle}")
    };
    match (added.is_empty(), removed.is_empty()) {
        (false, false) => format!("{after}에 {} 넣고 {} 뺐어요", object(added), object(removed)),
        (false, true) => format!("{after}에 {} 넣었어요", object(added)),
        (true, false) => format!("{after}에서 {} 뺐어요", object(removed)),
        (true, true) if before != after && described => format!("{before}의 이름 · 설명을 바꿨어요"),
        (true, true) if before != after => format!("{before} Space의 이름을 {after}{} 바꿨어요", particle(after, "으로", "로")),
        (true, true) => format!("{after}의 설명을 고쳤어요"),
    }
}

/// 보이는 이름 — 이름이 없으면(문제 있는 파일) slug다.
fn shown(name: &str, slug: &str) -> String {
    if name.trim().is_empty() { slug.to_owned() } else { name.to_owned() }
}

/// 낱말 뒤의 조사 — 끝 글자가 받침 있는 한글이면 `with_final`, 아니면 `without`이다(화면 `src/lib/particle.ts`의 `particle`과 같은 규칙). 「으로/로」는
/// ㄹ 받침도 「로」다. 영어 · 숫자(slug · 브랜치)는 읽는 끝소리로 고른다 — 받침이 분명한 것만(main → 「메인」, develop → 「디벨롭」).
fn particle(word: &str, with_final: &str, without: &'static str) -> String {
    let trimmed = word.trim().trim_end_matches(|c: char| ")]}」』\"'”’.,!?…".contains(c) || c.is_whitespace());
    let Some(last) = trimmed.chars().last() else { return without.to_owned() };
    let rieul = with_final == "으로";
    if ('\u{AC00}'..='\u{D7A3}').contains(&last) {
        let fin = (u32::from(last) - 0xAC00) % 28;
        return if fin == 0 || (rieul && fin == 8) { without } else { with_final }.to_owned();
    }
    let last = last.to_ascii_lowercase();
    if !"bklmnp013678".contains(last) {
        return without.to_owned();
    }
    if rieul && "l178".contains(last) { without } else { with_final }.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 조사는_끝소리를_따른다() {
        assert_eq!(particle("main", "으로", "로"), "으로");
        assert_eq!(particle("develop", "으로", "로"), "으로");
        assert_eq!(particle("release/2.5", "으로", "로"), "로");
        assert_eq!(particle("backoffice", "을", "를"), "를");
        assert_eq!(particle("결제 서비스", "을", "를"), "를");
        assert_eq!(particle("정산", "으로", "로"), "으로");
        assert_eq!(particle("서울", "으로", "로"), "로");
        assert_eq!(particle("web-app", "을", "를"), "을");
        assert_eq!(particle("tool", "으로", "로"), "로");
    }

    #[test]
    fn space_고침의_첫_줄은_넣고_뺀_project가_먼저다() {
        let names = |list: &[&str]| list.iter().map(|one| (*one).to_owned()).collect::<Vec<_>>();
        assert_eq!(space_edited("결제 서비스", "결제 서비스", &names(&["backoffice"]), &[], false), "결제 서비스에 backoffice를 넣었어요");
        assert_eq!(space_edited("결제 서비스", "결제 서비스", &[], &names(&["web-app"]), true), "결제 서비스에서 web-app을 뺐어요");
        assert_eq!(
            space_edited("결제 서비스", "결제", &names(&["backoffice"]), &names(&["web-app"]), false),
            "결제에 backoffice를 넣고 web-app을 뺐어요"
        );
        assert_eq!(space_edited("결제 서비스", "결제", &[], &[], false), "결제 서비스 Space의 이름을 결제로 바꿨어요");
        assert_eq!(space_edited("결제 서비스", "결제 서비스", &[], &[], true), "결제 서비스의 설명을 고쳤어요");
    }
}
