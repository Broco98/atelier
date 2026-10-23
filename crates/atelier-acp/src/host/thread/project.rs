//! 처음 고칠 때의 worktree와 Work 밖 Project — Thread 도구 「Project 고치기 시작」(v1 구현 스펙 §7 S13 · §11 S21 · S22, v1 티켓 32).
//!
//! - **Work에 있는 Project는 묻지 않는다.** worktree가 없으면 core의 Project 붙이기(`attach_project`)로 그 Project에만 Work의
//!   브랜치로 worktree를 만들고, `work` 줄 `{state: worktree, project, branch, path}`(시스템 줄 「api-server에 worktree를 만듦 ·
//!   fix/refund-api」)을 남긴 뒤 그 경로를 돌려준다. 이미 있으면 그 경로만 돌려준다. 그래서 읽기만 한 Project에는 worktree가 생기지
//!   않는다(스토리 98).
//! - **Work에 없는 Project면 Work 밖 Project 카드를 세운다**(S22 · 스토리 99) — `question` 줄(`card: project`)로 서고 사람이 고를
//!   때까지 도구가 기다린다. 세우고 기다리는 길 · 멈춤 · 닫힘은 Work 만들기 카드와 하나다([`ConversationHost::ask_card`]).
//!   - 붙이고 고치기: Project를 Work에 붙이고(`work` 줄 `attached`) worktree를 만든다. 붙이지 못하면(core가 거절) 아무것도 적지 않고
//!     카드가 그대로 선다.
//!   - 읽기만 하기: `thread.json`의 `readOnlyProjects`에 적는다 — 다음 턴부터 그 Project 폴더를 함께 연다(S11). 고칠 수 있는 자리가 아니므로
//!     고치기는 판정이 계속 거절한다(§9 2번 칸).
//!   - 아니요: 거절 글을 도구의 실패로 돌려준다.
//! - **Work 없는 Thread · 등록되지 않은 Project**면 카드를 세우지 않고 그 까닭을 도구의 실패로 돌려준다 — 붙일 Work가 없다.
//! - worktree를 짓는 일은 호스트에서 하나씩이다 — 두 Agent가 같은 Project를 함께 시작해도 git worktree를 두 번 짓지 않는다.
//! - **작업 폴더는 이 턴에 바뀌지 않는다** — 다음 말을 보낼 때 그 Session을 새 작업 폴더에서 이어 연다(S11 「바꿔 이어 열기」,
//!   [`ConversationHost::move_if_needed`]). 그래서 도구의 결과는 이번 턴에 고칠 절대 경로와 다음 턴의 작업 폴더를 함께 말한다.

use std::path::PathBuf;

use atelier_core::RecordKind;
use serde_json::{json, Value};

use super::work::Card;
use super::{ConversationHost, SessionKey};
use crate::thread_tools;
use crate::HostError;

/// Work 밖 Project 카드에서 사람이 고른 것(S22).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectChoice {
    /// 「붙이고 고치기」 — Project를 이 Work에 붙이고 worktree를 만든다.
    Attach,
    /// 「읽기만 하기」 — 함께 여는 폴더로 더하되 고치기는 계속 거절한다.
    ReadOnly,
    /// 「아니요」 — 거절 글을 돌려준다.
    Decline,
}

impl ProjectChoice {
    /// 답 줄의 `choice` 값.
    fn as_str(self) -> &'static str {
        match self {
            ProjectChoice::Attach => "attach",
            ProjectChoice::ReadOnly => "read",
            ProjectChoice::Decline => "decline",
        }
    }
}

/// Work 밖 Project 카드의 값 — 고치려는 Project와 이 Thread가 이은 Work, 그 Work의 Project들(「아니요, api-server에서만 고쳐 주세요」).
pub(super) struct Outside {
    project: String,
    work: String,
    work_projects: Vec<String>,
}

/// 그 Project에 worktree를 세운 결과 — 아무것도 바뀌지 않은 실패는 [`ConversationHost::plant`]의 `Err`다.
struct Planted {
    path: PathBuf,
    branch: Option<String>,
    /// 이번에 그 Project를 Work에 붙였나.
    attached: bool,
    /// 이번에 worktree를 지었나 — 이미 있었으면 아니다.
    made: bool,
    /// 붙였지만 worktree를 짓지 못한 까닭(git).
    failed: Option<String>,
}

impl ConversationHost {
    /// Work 밖 Project 카드의 답(S22) — 사람이 고른 것으로 그 카드를 닫는다. 「붙이고 고치기」에서 core가 붙이기를 거절하면 아무것도
    /// 적지 않고 그 까닭으로 실패하며 카드는 그대로 서 있다. 이미 닫힌 카드면 [`HostError::QuestionClosed`]다. 기다리지 않는다 —
    /// 도구의 결과와 Agent의 다음 말은 기록 줄로 온다.
    pub fn answer_project(&self, thread: &str, request: &str, choice: ProjectChoice) -> Result<(), HostError> {
        let asked = self
            .threads
            .proposals
            .take(thread, request, "project")
            .ok_or_else(|| HostError::QuestionClosed { thread: thread.to_owned(), request: request.to_owned() })?;
        let Card::Project(outside) = &asked.card else { unreachable!("Work 밖 Project 카드만 꺼냈다") };
        let answered = json!({
            "state": "answered", "requestId": request, "card": "project", "choice": choice.as_str(), "project": outside.project,
        });
        let (text, refused) = match choice {
            ProjectChoice::Attach => match self.plant(&outside.work, &outside.project) {
                Ok(planted) => {
                    self.note(thread, Some(&asked.key.handle), answered)?;
                    self.note_planted(thread, &outside.project, &planted)?;
                    self.planted_text(thread, &outside.project, &planted)
                }
                Err(why) => {
                    self.threads.proposals.put_back(request, asked);
                    return Err(HostError::ProjectNotAttached(why));
                }
            },
            ProjectChoice::ReadOnly => {
                let project = outside.project.clone();
                self.change_thread(thread, |file| {
                    if !file.read_only_projects.contains(&project) {
                        file.read_only_projects.push(project.clone());
                    }
                })?;
                self.note(thread, Some(&asked.key.handle), answered)?;
                let folder = atelier_core::project_folders(&self.data_root)
                    .into_iter()
                    .find(|(slug, _)| slug == &outside.project)
                    .map_or_else(String::new, |(_, folder)| format!(" `{}`", folder.display()));
                let text = format!(
                    "사람이 `{project}`을 읽기만 하기로 했다 — 고치지 않는다. 다음 턴부터 그 Project 폴더{folder}를 함께 열어 읽을 수 \
                     있다(이번 턴에 그 폴더를 읽으면 사람에게 묻는다). 고쳐야 하면 사람에게 말로 묻는다."
                );
                (text, false)
            }
            ProjectChoice::Decline => {
                self.note(thread, Some(&asked.key.handle), answered)?;
                let only = if outside.work_projects.is_empty() {
                    "이 Work의 spec 폴더에서만 고친다".to_owned()
                } else {
                    format!("이 Work의 Project({})에서만 고친다", outside.work_projects.join(", "))
                };
                (format!("사람이 거절했다 — `{}`는 고치지 않는다. {only}.", outside.project), true)
            }
        };
        asked.settle(super::work::Settled::Said { text, refused });
        Ok(())
    }

    /// 「Project 고치기 시작」(S13) — Work에 있는 Project면 worktree를 세워(이미 있으면 그대로) 그 경로를 돌려주고, 없는 Project면 Work 밖
    /// Project 카드를 세우고 사람이 고를 때까지 기다린다. **막히는 호출일 수 있다**(연결마다의 스레드에서 불린다).
    pub(super) fn start_editing(&self, key: &SessionKey, project: &str, reason: Option<&str>) -> Value {
        let file = match self.read_thread_file(&key.thread) {
            Ok(file) => file,
            Err(error) => return thread_tools::said(&error.to_string(), true),
        };
        let Some(slug) = file.work else {
            return thread_tools::said(
                "이 Thread는 아직 Work에 이어지지 않았다 — Project를 고치려면 먼저 propose_work로 그 Project를 넣은 Work를 사람에게 \
                 제안한다. 그 전에는 이 Thread 폴더에서만 고친다.",
                true,
            );
        };
        let work_at = match self.open_work(&slug) {
            Ok(work_at) => work_at,
            Err(error) => return thread_tools::said(&error.to_string(), true),
        };
        let registered = match atelier_core::list_projects(&atelier_core::projects_in(&self.data_root)) {
            Ok(views) => views,
            Err(error) => return thread_tools::said(&format!("Project 목록을 읽지 못했다 — {error}"), true),
        };
        let Some(view) = registered.iter().find(|view| view.project.slug == project) else {
            let known: Vec<&str> = registered.iter().map(|view| view.project.slug.as_str()).collect();
            let known = if known.is_empty() { "없음".to_owned() } else { known.join(", ") };
            return thread_tools::said(&format!("등록되지 않은 Project다: {project} — 등록된 Project(list_projects): {known}"), true);
        };
        if work_at.meta.projects.iter().any(|one| one == project) {
            return match self.plant(&slug, project) {
                Ok(planted) => match self.note_planted(&key.thread, project, &planted) {
                    Ok(()) => {
                        let (text, refused) = self.planted_text(&key.thread, project, &planted);
                        thread_tools::said(&text, refused)
                    }
                    Err(error) => thread_tools::said(&error.to_string(), true),
                },
                Err(why) => thread_tools::said(&why, true),
            };
        }
        let fields = json!({
            "project": project,
            "name": view.project.name,
            "reason": reason,
            "work": slug,
            "workProjects": work_at.meta.projects,
        });
        let outside = Outside { project: project.to_owned(), work: slug, work_projects: work_at.meta.projects.clone() };
        self.ask_card(key, Card::Project(outside), fields)
    }

    /// 그 Project에 worktree를 세운다 — core의 Project 붙이기로, Work에 없으면 붙이고 Work의 브랜치로 짓는다. 이미 있으면 그대로다.
    /// `Err`는 아무것도 바뀌지 않은 거절(core의 검증 — 등록 · git · baseBranch)이다. 기록 줄은 부르는 쪽이 적는다([`Self::note_planted`]).
    fn plant(&self, slug: &str, project: &str) -> Result<Planted, String> {
        let _one_at_a_time = self.threads.lock_trees();
        let before = self.open_work(slug).map_err(|error| error.to_string())?;
        let path = before.places.trees.join(project);
        let attached = !before.meta.projects.iter().any(|one| one == project);
        if !attached && path.is_dir() {
            return Ok(Planted { path, branch: before.meta.branch, attached, made: false, failed: None });
        }
        let works = atelier_core::works_in(&self.data_root);
        let report = atelier_core::attach_project(&works, &atelier_core::projects_in(&self.data_root), slug, project, None)
            .map_err(|error| format!("`{project}`에 worktree를 만들지 못했다 — {error}"))?;
        let failed = report.errors.into_iter().map(|error| error.message).next();
        let branch = self.open_work(slug).ok().and_then(|after| after.meta.branch);
        Ok(Planted { path, branch, attached, made: failed.is_none(), failed })
    }

    /// 세운 것을 `work` 줄로 남긴다 — 붙임(`attached`)과 worktree(`worktree`). 사람이나 시스템의 일이라 `who`가 없다(S8).
    fn note_planted(&self, thread: &str, project: &str, planted: &Planted) -> Result<(), HostError> {
        if planted.attached {
            self.note_work(thread, json!({"state": "attached", "project": project}))?;
        }
        if planted.made {
            self.note_work(thread, json!({"state": "worktree", "project": project, "branch": planted.branch, "path": planted.path}))?;
        }
        Ok(())
    }

    /// 세운 것을 Agent에게 돌려줄 글 — 이번 턴에 고칠 절대 경로와 다음 턴의 작업 폴더. 짓지 못했으면 그 까닭(도구의 실패)이다.
    fn planted_text(&self, thread: &str, project: &str, planted: &Planted) -> (String, bool) {
        if let Some(why) = &planted.failed {
            let head = if planted.attached { format!("`{project}`을 이 Work에 붙였지만 ") } else { String::new() };
            return (format!("{head}worktree를 만들지 못했다 — {why}"), true);
        }
        let branch = planted.branch.as_deref().map_or_else(String::new, |branch| format!(" — 브랜치 `{branch}`"));
        let head = match (planted.attached, planted.made) {
            (true, _) => format!("사람이 `{project}`을 이 Work에 붙였다. worktree를 만들었다: `{}`{branch}", planted.path.display()),
            (false, true) => format!("`{project}`에 worktree를 만들었다: `{}`{branch}", planted.path.display()),
            (false, false) => format!("`{project}` worktree가 이미 있다: `{}`{branch}", planted.path.display()),
        };
        let next = self
            .read_thread_file(thread)
            .ok()
            .and_then(|file| self.thread_place(thread, &file).ok())
            .map_or_else(String::new, |place| format!(" 다음 턴부터 작업 폴더가 `{}`로 바뀐다.", place.cwd.display()));
        (format!("{head}\n\n이 Project는 이 worktree 안에서만 고친다 — 이번 턴에는 이 절대 경로로 고친다.{next}"), false)
    }

    /// 사람의 결정 줄(`question`) 하나를 적는다.
    fn note(&self, thread: &str, who: Option<&str>, payload: Value) -> Result<(), HostError> {
        self.thread_log(thread)?.write(RecordKind::Question, who, payload).map(drop).map_err(HostError::Record)
    }

    fn note_work(&self, thread: &str, payload: Value) -> Result<(), HostError> {
        self.thread_log(thread)?.write(RecordKind::Work, None, payload).map(drop).map_err(HostError::Record)
    }
}
