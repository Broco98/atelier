//! Work와 이어짐 — Thread 도구 「Project 목록」 · 「Work 읽기」 · 「Work 만들기 제안」(v1 구현 스펙 §7 S13 · §11 · S21, v1 티켓 30).
//!
//! - **「Work 만들기 제안」은 사람에게 묻는 도구다.** Host가 골라 둔 제목 · slug · 까닭 · 브랜치 · Project를 받아 Work 만들기 카드를
//!   `question` 줄(`card: work`)로 세우고, 사람이 고를 때까지 그 도구 호출(연결마다의 스레드)이 기다린다. 카드에는 등록된 Project가
//!   모두 선다 — Host가 추천한 것이 먼저 그 까닭과 함께, 나머지는 사람이 넣을 수 있게(스토리 90). 저장소의 브랜치들도 싣는다 — 카드의
//!   브랜치 칸이 그것으로 「api-server의 fix/... 규칙을 따름」을 말한다.
//! - **「Work 만들기」**([`ConversationHost::answer_work`]) — core가 worktree 없이 Work를 만든다(S21 · v1 티켓 29). 그리고 이 Thread의
//!   `work`를 적고(연결은 `thread.json`의 `work` 한 곳이다 — §19) `work` 줄 「Work … 을 만들고 이 Thread에 연결함」을 남긴다. 그
//!   Thread의 떠 있는 Session들은 곧바로 그 Work의 판정 · 쓰기 자리를 쓴다 — 턴 가운데라도 Host가 spec 폴더에 설계 문서를 쓸 수 있게.
//!   만들지 못하면(브랜치가 저장소에 이미 있다 · 사라진 Project) 아무것도 적지 않고 그 까닭으로 실패한다 — 카드는 그대로 서 있고 사람이
//!   고쳐 다시 고른다.
//! - **「Work 없이 계속」**은 도구의 결과로 그렇게 돌려준다. 아무것도 만들지 않는다.
//! - 사람이 Thread를 멈추면 서 있는 카드를 거둔다(`withdrawn` — 도구는 「사람이 멈춤」). 그 Session을 표에서 꺼내면(죽음 · 다시 띄우기 ·
//!   끄기) 카드도 닫힌다.
//! - **카드를 세우고 기다리는 길은 하나다**([`ConversationHost::ask_card`]) — Work 밖 Project 카드(v1 티켓 32, [`super::project`])도 같은
//!   표([`Proposals`])에 서서 같은 멈춤 · 닫힘을 쓴다. 카드의 종류는 `question` 줄의 `card`로 가른다.
//! - 이은 Work가 바뀐 Session의 작업 폴더(S11)는 다음 턴부터다 — 그 턴의 프로세스는 그대로 두고, 다음 말을 보낼 때 새 작업 폴더에서
//!   이어 연다(v1 티켓 32, [`ConversationHost::move_if_needed`]).

use std::collections::HashMap;
use std::sync::{mpsc, Mutex, MutexGuard};

use atelier_core::{PolicyPlace, ProjectView, RecordKind};
use serde_json::{json, Value};

use super::project::Outside;
use super::space::SpaceCard;
use super::{ConversationHost, SessionKey};
use crate::host::WorkAt;
use crate::thread_tools::{self, Proposal};
use crate::HostError;

/// Work 만들기 카드에서 사람이 고른 것.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkChoice {
    /// 「Work 만들기」 — 카드에서 고친 Project들과 브랜치(Project가 없으면 없어도 된다).
    Create { projects: Vec<String>, branch: Option<String> },
    /// 「Work 없이 계속」.
    Continue,
}

/// 서 있는 카드들 — 요청 id → 카드. 호스트에 하나다. 잠금은 짧게만 쥔다. Work 만들기 카드와 Work 밖 Project 카드(v1 티켓 32) · Space 질문
/// 카드(03 티켓 08)가 함께 선다.
#[derive(Default)]
pub(super) struct Proposals(Mutex<HashMap<String, Asked>>);

/// 서 있는 카드 하나 — 물은 Session과 카드의 값, 그리고 기다리는 도구 호출.
pub(super) struct Asked {
    pub(super) key: SessionKey,
    pub(super) card: Card,
    settled: mpsc::Sender<Settled>,
}

/// 카드의 값 — 무엇을 묻나.
pub(super) enum Card {
    /// Work 만들기(v1 티켓 30) — Host가 골라 둔 것.
    Work(Proposal),
    /// Work 밖 Project(v1 티켓 32) — 고치려는 Project와 이은 Work.
    Project(Outside),
    /// 어느 Space에서 할까(03 티켓 08) — 고를 수 있는 Space.
    Space(SpaceCard),
}

impl Card {
    /// `question` 줄의 `card` 값.
    fn kind(&self) -> &'static str {
        match self {
            Card::Work(_) => "work",
            Card::Project(_) => "project",
            Card::Space(_) => "space",
        }
    }

    /// 도구의 결과 글에 쓰는 카드 이름.
    fn label(&self) -> &'static str {
        match self {
            Card::Work(_) => "Work 만들기 카드",
            Card::Project(_) => "Work 밖 Project 카드",
            Card::Space(_) => "Space 질문 카드",
        }
    }
}

/// 카드가 어떻게 닫혔나 — 기다리던 도구 호출이 받는다.
pub(super) enum Settled {
    /// 사람이 골랐다 — Agent에게 돌려줄 글과, 도구의 실패인가.
    Said { text: String, refused: bool },
    /// 사람이 Thread를 멈췄다.
    Stopped,
}

/// 「Work 없이 계속」의 도구 결과(S13 표 「사용자가 Work 없이 계속하기로 함」).
const CONTINUED: &str = "사용자가 Work 없이 계속하기로 함 — Work를 만들지 않고 이 Thread에서 이어 간다. 같은 제안을 곧바로 다시 하지 않는다.";

impl Asked {
    /// 기다리던 도구 호출에 닫힘을 건넨다 — 이미 떠났으면(그 Session이 끝났다) 받을 이가 없다.
    pub(super) fn settle(self, settled: Settled) {
        let _ = self.settled.send(settled);
    }
}

impl Proposals {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Asked>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 그 Thread의 그 종류 카드를 꺼낸다 — 꺼낸 뒤로는 다른 답이 닿지 않는다. 다른 Thread · 다른 종류의 카드면 꺼내지 않는다.
    pub(super) fn take(&self, thread: &str, request: &str, kind: &str) -> Option<Asked> {
        let mut asked = self.lock();
        asked.get(request).filter(|one| one.key.thread == thread && one.card.kind() == kind)?;
        asked.remove(request)
    }

    /// 꺼낸 카드를 다시 세운다 — 사람의 고름을 해내지 못해 카드가 그대로 선다.
    pub(super) fn put_back(&self, request: &str, asked: Asked) {
        self.lock().insert(request.to_owned(), asked);
    }

    /// 그 Session의 카드를 닫는다 — 기다리던 도구 호출은 받을 것 없이 풀린다(Session을 표에서 꺼냈다).
    pub(super) fn close_for(&self, key: &SessionKey) {
        self.lock().retain(|_, one| &one.key != key);
    }

    /// 카드를 모두 닫는다 — 호스트 끄기.
    pub(super) fn close_all(&self) {
        self.lock().clear();
    }

    /// 그 Thread의 카드를 모두 꺼낸다 — 사람이 Thread를 멈췄다.
    fn take_thread(&self, thread: &str) -> Vec<Asked> {
        let mut asked = self.lock();
        let ids: Vec<String> = asked.iter().filter(|(_, one)| one.key.thread == thread).map(|(id, _)| id.clone()).collect();
        ids.iter().filter_map(|id| asked.remove(id)).collect()
    }
}

impl ConversationHost {
    /// Work 만들기 카드의 답(v1 티켓 30 · §11) — 사람이 고른 것으로 그 카드를 닫는다. 「Work 만들기」는 core로 Work를 만들고 이 Thread를
    /// 잇는다 — 만들지 못하면 아무것도 적지 않고 그 까닭으로 실패하며 카드는 그대로 서 있다. 이미 닫힌 카드면
    /// [`HostError::QuestionClosed`]다. 기다리지 않는다 — 도구의 결과와 Host의 다음 말은 기록 줄로 온다.
    pub fn answer_work(&self, thread: &str, request: &str, choice: WorkChoice) -> Result<(), HostError> {
        let asked = self
            .threads
            .proposals
            .take(thread, request, "work")
            .ok_or_else(|| HostError::QuestionClosed { thread: thread.to_owned(), request: request.to_owned() })?;
        let text = match choice {
            WorkChoice::Continue => {
                let line = json!({"state": "answered", "requestId": request, "card": "work", "choice": "continue"});
                self.thread_log(thread)?.write(RecordKind::Question, Some(&asked.key.handle), line).map_err(HostError::Record)?;
                CONTINUED.to_owned()
            }
            WorkChoice::Create { projects, branch } => match self.create_work(request, &asked, &projects, branch.as_deref()) {
                Ok(text) => text,
                Err(error) => {
                    // 만들지 못했다 — 카드는 그대로 선다. 사람이 고쳐 다시 고른다.
                    self.threads.proposals.put_back(request, asked);
                    return Err(error);
                }
            },
        };
        asked.settle(Settled::Said { text, refused: false });
        Ok(())
    }

    /// 「Work 만들기」 — Work를 worktree 없이 만들고 이 Thread를 잇는다. Agent에게 돌려줄 글을 돌려준다.
    fn create_work(&self, request: &str, asked: &Asked, projects: &[String], branch: Option<&str>) -> Result<String, HostError> {
        let thread = &asked.key.thread;
        let not_created = |why: String| HostError::WorkNotCreated(why);
        let file = self.read_thread_file(thread)?;
        if let Some(work) = &file.work {
            return Err(not_created(format!("이 Thread는 이미 Work `{work}`에 이어져 있어요")));
        }
        let Card::Work(proposal) = &asked.card else { unreachable!("Work 만들기 카드만 꺼냈다") };
        // 같은 slug의 Work가 그사이 섰으면 core는 그 Work를 「다시 연다」 — 새 Work가 아니다.
        let works = atelier_core::works_in(&self.data_root);
        if atelier_core::read_work(&works, &proposal.slug).is_ok() {
            return Err(not_created(format!("Work `{}`가 이미 있어요 — Host에게 다른 slug로 다시 제안해 달라고 해 주세요", proposal.slug)));
        }
        let branch = if projects.is_empty() { None } else { branch.map(str::trim).filter(|branch| !branch.is_empty()) };
        atelier_core::start_work_deferred(
            &works,
            &atelier_core::archive_in(&self.data_root),
            &atelier_core::projects_in(&self.data_root),
            &proposal.title,
            Some(&proposal.slug),
            projects,
            branch,
        )
        .map_err(|error| not_created(error.to_string()))?;
        let slug = proposal.slug.clone();
        // Thread에서 고른 물어보는 정도를 Work로 옮긴다 — 이은 뒤로는 Work의 정도를 쓰므로(S18), 옮기지 않으면 정도가 말없이 바뀐다.
        if let Some(mode) = &file.mode {
            let carried = atelier_core::update_policy(&self.data_root, PolicyPlace::Work(&slug), |policy| {
                policy.mode.get_or_insert_with(|| mode.clone());
            });
            if let Err(error) = carried {
                eprintln!("물어보는 정도를 Work로 옮기지 못했습니다: {error}");
            }
        }
        // Thread의 Space를 Work로 옮기고 Thread의 칸은 비운다(03 §9) — 이은 뒤로는 Work의 Space를 따르므로(§7 규칙 1) 범위가 그대로다.
        // 옮기지 못했으면 칸은 남긴다 — 읽히지는 않지만(규칙 1) 사람이 고른 것을 잃지 않게.
        let moved = file.space.as_deref().is_none_or(|space| match atelier_core::update_work_space(&works, &slug, Some(space)) {
            Ok(_) => true,
            Err(error) => {
                eprintln!("Space를 Work로 옮기지 못했습니다: {error}");
                false
            }
        });
        self.change_thread(thread, |file| {
            file.work = Some(slug.clone());
            if moved {
                file.space = None;
            }
        })?;
        self.threads.link_sessions(thread, &slug);
        let work_at = self.open_work(&slug)?;
        let log = self.thread_log(thread)?;
        let answered = json!({
            "state": "answered", "requestId": request, "card": "work", "choice": "create",
            "work": slug, "projects": projects, "branch": work_at.meta.branch,
        });
        log.write(RecordKind::Question, Some(&asked.key.handle), answered).map_err(HostError::Record)?;
        let created = json!({
            "state": "created", "slug": slug, "title": work_at.meta.title, "branch": work_at.meta.branch, "projects": projects,
        });
        log.write(RecordKind::Work, None, created).map_err(HostError::Record)?;
        Ok(format!(
            "사람이 Work를 만들었다 — 이 Thread가 그 Work에 이어졌다. 사람이 카드에서 Project와 브랜치를 고쳤을 수 있다: 아래가 \
             정본이다.\n\n{}",
            self.work_text(&slug, &work_at)
        ))
    }

    /// 「Project 목록」 — 등록된 Project들(MCP `atelier_list_projects`와 같은 꼴). 읽기만 한다.
    pub(super) fn list_projects_tool(&self) -> Value {
        match atelier_core::list_projects(&atelier_core::projects_in(&self.data_root)) {
            Ok(views) if views.is_empty() => thread_tools::said(
                "등록된 Project가 없다 — 사람이 Atelier의 Projects 화면에서 git 저장소를 등록해야 고칠 수 있다. Project 없이 기획만으로 \
                 Work를 제안할 수는 있다.",
                false,
            ),
            Ok(views) => thread_tools::said(&serde_json::to_string_pretty(&views).unwrap_or_default(), false),
            Err(error) => thread_tools::said(&format!("Project 목록을 읽지 못했다 — {error}"), true),
        }
    }

    /// 「Work 읽기」 — 이 Thread가 이은 Work. 읽기만 한다.
    pub(super) fn get_work_tool(&self, key: &SessionKey) -> Value {
        let file = match self.read_thread_file(&key.thread) {
            Ok(file) => file,
            Err(error) => return thread_tools::said(&error.to_string(), true),
        };
        let Some(slug) = file.work else {
            return thread_tools::said(
                "이 Thread는 아직 Work에 이어지지 않았다 — Thread 폴더에서 일한다. 일이 커지면 propose_work로 Work를 제안한다.",
                false,
            );
        };
        match self.open_work(&slug) {
            Ok(work_at) => thread_tools::said(&self.work_text(&slug, &work_at), false),
            Err(error) => thread_tools::said(&error.to_string(), true),
        }
    }

    /// 「Work 만들기 제안」(§11) — 카드를 세우고 사람이 고를 때까지 기다린다. **막히는 호출이다**(연결마다의 스레드에서 불린다).
    /// 이미 Work에 이은 Thread · 등록되지 않은 Project · 이미 쓰인 slug면 카드를 세우지 않고 그 까닭을 도구의 실패로 돌려준다.
    pub(super) fn propose_work(&self, key: &SessionKey, proposal: Proposal) -> Value {
        match self.work_card(key, &proposal) {
            Ok(fields) => self.ask_card(key, Card::Work(proposal), fields),
            Err(why) => thread_tools::said(&why, true),
        }
    }

    /// 카드를 세우고 사람이 고를 때까지 기다린다 — 카드의 값(`fields`)을 `question` 줄(`asked`)로 적고, 답 · 멈춤 · 닫힘 가운데 먼저
    /// 온 것을 도구의 결과로 돌려준다. **막히는 호출이다.** Work 만들기(v1 티켓 30) · Work 밖 Project(v1 티켓 32) · Space 질문(03 티켓 08)이
    /// 이 길 하나를 쓴다.
    pub(super) fn ask_card(&self, key: &SessionKey, card: Card, fields: Value) -> Value {
        let request = uuid::Uuid::new_v4().to_string();
        let (kind, label) = (card.kind(), card.label());
        let (settled, waiting) = mpsc::channel();
        self.threads.proposals.lock().insert(request.clone(), Asked { key: key.clone(), card, settled });
        let mut asked = json!({"state": "asked", "requestId": request, "card": kind});
        asked.as_object_mut().expect("객체").extend(fields.as_object().expect("객체").clone());
        let written = self.thread_log(&key.thread).map_err(|error| error.to_string()).and_then(|log| {
            log.write(RecordKind::Question, Some(&key.handle), asked).map(drop)
        });
        if let Err(why) = written {
            self.threads.proposals.take(&key.thread, &request, kind);
            return thread_tools::said(&format!("{label}를 세우지 못했다 — {why}"), true);
        }
        match waiting.recv() {
            Ok(Settled::Said { text, refused }) => thread_tools::said(&text, refused),
            Ok(Settled::Stopped) => {
                self.withdraw_card(key, &request, kind, "stopped");
                thread_tools::said(&format!("사람이 멈춤 — 사람이 이 Thread를 멈춰 {label}를 거뒀다"), true)
            }
            Err(_) => {
                self.withdraw_card(key, &request, kind, "closed");
                thread_tools::said(&format!("{label}가 닫혔다 — 사람이 답하기 전에 이 Session이 끝났다"), true)
            }
        }
    }

    /// 사람이 Thread를 멈췄다 — 그 Thread에 서 있는 카드를 거둔다(기다리던 도구 호출이 `withdrawn` 줄을 적는다).
    pub(super) fn stop_work_cards(&self, thread: &str) {
        for asked in self.threads.proposals.take_thread(thread) {
            asked.settle(Settled::Stopped);
        }
    }

    fn withdraw_card(&self, key: &SessionKey, request: &str, kind: &str, reason: &str) {
        let line = json!({"state": "withdrawn", "requestId": request, "card": kind, "reason": reason});
        let written = self.thread_log(&key.thread).map_err(|error| error.to_string()).and_then(|log| {
            log.write(RecordKind::Question, Some(&key.handle), line).map(drop)
        });
        if let Err(error) = written {
            eprintln!("{error}");
        }
    }

    /// 카드의 값 — 제목 · slug · 까닭 · 브랜치와 등록된 Project 모두(Host 추천이 먼저, 그 까닭과 함께). 세울 수 없으면 그 까닭(Agent가
    /// 읽고 고쳐 부를 글)이다.
    fn work_card(&self, key: &SessionKey, proposal: &Proposal) -> Result<Value, String> {
        let file = self.read_thread_file(&key.thread).map_err(|error| error.to_string())?;
        if let Some(work) = &file.work {
            return Err(format!("이 Thread는 이미 Work `{work}`에 이어져 있다 — get_work로 그 Work를 읽는다."));
        }
        if atelier_core::read_work(&atelier_core::works_in(&self.data_root), &proposal.slug).is_ok() {
            return Err(format!("Work `{}`가 이미 있다 — 다른 slug로 다시 제안한다.", proposal.slug));
        }
        if atelier_core::archive_in(&self.data_root).join(&proposal.slug).is_dir() {
            return Err(format!("`{}`는 보관된 Work의 slug다 — 보관은 되돌리지 않는다. 다른 slug로 다시 제안한다.", proposal.slug));
        }
        let registered = atelier_core::list_projects(&atelier_core::projects_in(&self.data_root))
            .map_err(|error| format!("Project 목록을 읽지 못했다 — {error}"))?;
        let unknown: Vec<&str> = proposal
            .projects
            .iter()
            .filter(|pick| !registered.iter().any(|view| view.project.slug == pick.slug))
            .map(|pick| pick.slug.as_str())
            .collect();
        if !unknown.is_empty() {
            let known: Vec<&str> = registered.iter().map(|view| view.project.slug.as_str()).collect();
            let known = if known.is_empty() { "없음".to_owned() } else { known.join(", ") };
            return Err(format!("등록되지 않은 Project다: {} — 등록된 Project(list_projects): {known}", unknown.join(", ")));
        }
        let row = |view: &ProjectView, reason: Option<&str>| {
            json!({
                "slug": view.project.slug,
                "name": view.project.name,
                "description": view.project.description,
                "recommended": proposal.projects.iter().any(|pick| pick.slug == view.project.slug),
                "reason": reason,
                "branches": view.git.as_ref().map(|git| git.local_branches.clone()).unwrap_or_default(),
            })
        };
        let mut projects: Vec<Value> = proposal
            .projects
            .iter()
            .filter_map(|pick| {
                let view = registered.iter().find(|view| view.project.slug == pick.slug)?;
                Some(row(view, pick.reason.as_deref()))
            })
            .collect();
        projects.extend(
            registered
                .iter()
                .filter(|view| !proposal.projects.iter().any(|pick| pick.slug == view.project.slug))
                .map(|view| row(view, None)),
        );
        let mut card = json!({
            "title": proposal.title,
            "slug": proposal.slug,
            "reason": proposal.reason,
            "branch": proposal.branch,
            "projects": projects,
        });
        // 붙을 Space(03 §9) — 받아들이면 이 Thread의 Space가 새 Work로 옮겨 간다. 카드에서 바꾸지 않는다(S8). 파일이 없는 Space는 Space가
        // 없는 것이다(§7 규칙 1) — 줄이 서지 않는다.
        if let Some(space) = self.scope_of(&file, None).space {
            card["space"] = json!({"slug": space.slug, "name": space.name});
        }
        Ok(card)
    }

    /// Work를 Agent에게 보이는 글 — 머리말의 Work 칸(S10)과 같은 줄에 브랜치와, spec 폴더 안 문서의 배치(spec 레이아웃 — MCP
    /// `atelier_start_work`가 싣는 것과 같다)를 더한다.
    fn work_text(&self, slug: &str, work_at: &WorkAt) -> String {
        let mut text = work_lines(slug, work_at);
        if let Some(branch) = &work_at.meta.branch {
            text.push_str(&format!("  - 브랜치: `{branch}` — Project마다 이 브랜치로 worktree가 선다\n"));
        }
        let resolved = atelier_core::resolve_layout(&self.data_root);
        let layout =
            atelier_core::render_layout(&resolved.layout, resolved.templates.as_ref(), resolved.fallback.as_ref()).text;
        format!("{text}\n{layout}")
    }
}

/// 이은 Work의 줄들 — slug · 제목 · spec 폴더, Project마다 worktree 또는 「읽기만」(머리말 S10과 Thread 도구가 함께 쓴다).
pub(super) fn work_lines(slug: &str, work_at: &WorkAt) -> String {
    let mut text = format!("- Work: `{slug}` — {}\n  - spec 폴더(specDir): `{}`\n", work_at.meta.title, work_at.places.spec.display());
    for (project, tree) in work_at.meta.projects.iter().zip(&work_at.places.worktrees) {
        if tree.is_dir() {
            text.push_str(&format!("  - Project `{project}`: worktree `{}`\n", tree.display()));
        } else {
            text.push_str(&format!("  - Project `{project}`: 읽기만 — worktree가 아직 없다\n"));
        }
    }
    text
}
