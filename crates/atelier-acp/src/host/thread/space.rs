//! Space와 이어짐(03 구현 스펙 §7 · §9 · 티켓 05) — Work · Thread의 `space` 한 칸을 붙이고 · 바꾸고 · 빼고, 흐름에 Space 줄을 남긴다.
//!
//! - **Work에 이은 Thread의 Space는 그 Work의 것이다**(§9) — Thread에서 바꾸면(Space 칩) 그 Work의 Space가 바뀐다(스토리 42). Work의
//!   Space가 바뀌면 그 Work의 Thread마다 Space 줄이 선다(S9) — 그 Thread들의 범위가 모두 바뀐다.
//! - **Space 줄**(`space`)은 사람의 줄이다(`who`가 없다). 갈래(`change` — 바꿈 `changed` · 뺌 `removed`)와 바뀐 뒤의 범위(읽는 Project의
//!   이름 · 등록된 Project 수)를 싣는다 — 화면은 그때의 범위를 다시 셀 수 없다(기록은 덧붙이기만 한다).
//! - 떠 있는 Session은 건드리지 않는다 — 다음 말을 보낼 때 새 자리로 이어 연다([`ConversationHost::move_if_needed`] — 범위가 바뀌면 함께
//!   여는 폴더가 바뀐다). 돌고 있는 턴은 끊기지 않는다(스토리 41).
//! - **Space를 지우면**(티켓 07 · §9) 그 Space에 이은 칸이 비고 그 Space로 읽던 Thread마다 「지워짐」 줄이, 되돌리면 다시 적은 곳마다
//!   「되돌림」 줄이 선다. 앱 밖에서 파일이 사라졌으면 그 Thread의 다음 말을 보낼 때 같은 줄로 닫는다([`ConversationHost::close_lost_space`]).

use atelier_core::{DeletedSpace, ReadingScope, RecordKind, RestoredSpace, ScopeOf, SpaceLinks, ThreadFile, Work};
use serde_json::{json, Value};

use super::gate;
use super::work::{Card, Settled};
use super::{ConversationHost, SessionKey};
use crate::policy::AskLevel;
use crate::thread_tools::{self, SpaceAsk};
use crate::HostError;

/// Space 질문 카드에서 사람이 고른 것(03 §11).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpaceChoice {
    /// 그 Space(slug) — 카드의 선택지 가운데 하나다.
    Space(String),
    /// 「Space 없이」 — 등록된 Project를 모두 읽는다.
    Without,
    /// 「나중에」(esc) — 아무것도 바꾸지 않는다.
    Later,
}

impl ConversationHost {
    /// Thread의 Space 붙이기 · 바꾸기 · 빼기(`None`) — `thread.json`의 `space`만 고치고 Space 줄을 남긴다. Work에 이은 Thread면 그 Work의
    /// Space를 바꾼다([`Self::set_work_space`]). 같은 Space면 아무것도 하지 않는다. 없는 Space는 아무것도 적지 않고 거절한다.
    pub fn set_thread_space(&self, thread: &str, space: Option<&str>) -> Result<(), HostError> {
        self.put_thread_space(thread, space, Change::Picked, false)
    }

    /// Work의 Space 붙이기 · 바꾸기 · 빼기 — `work.json`의 `space`만 고치고 그 Work의 Thread마다 Space 줄을 남긴다(S9). 같은 Space면
    /// 아무것도 하지 않는다. 없는 Work · 없는 Space는 아무것도 적지 않고 거절한다.
    pub fn set_work_space(&self, work: &str, space: Option<&str>) -> Result<(), HostError> {
        self.put_work_space(work, space, Change::Picked, None)
    }

    /// Thread의 Space를 적는 몸 — 사람의 칩 · 메뉴(05)와 Host의 「Space 붙이기」(08)가 함께 쓴다. `folded`면 이 Thread에는 줄을 남기지
    /// 않는다 — 질문 카드로 고른 Space는 접힌 카드가 그 줄이다(§9). Work에 이은 Thread면 그 Work의 Space를 바꾼다.
    fn put_thread_space(&self, thread: &str, space: Option<&str>, change: Change, folded: bool) -> Result<(), HostError> {
        let file = self.read_thread_file(thread)?;
        if let Some(work) = &file.work {
            return self.put_work_space(work, space, change, folded.then_some(thread));
        }
        self.check_space(space)?;
        if file.space.as_deref() == space {
            return Ok(());
        }
        let before = file.space;
        let file = self.change_thread(thread, |file| file.space = space.map(str::to_owned))?;
        if folded {
            return Ok(());
        }
        self.note_space(thread, &file, None, before.as_deref(), change)
    }

    /// Work의 Space를 적는 몸 — `folded`는 줄을 남기지 않을 Thread(그 Thread의 질문 카드가 줄을 대신한다)다. 그 Work의 다른 Thread에는
    /// 줄이 선다(S9).
    fn put_work_space(&self, work: &str, space: Option<&str>, change: Change, folded: Option<&str>) -> Result<(), HostError> {
        let before = self.open_work(work)?.meta.space;
        self.check_space(space)?;
        if before.as_deref() == space {
            return Ok(());
        }
        let changed = atelier_core::update_work_space(&atelier_core::works_in(&self.data_root), work, space)
            .map_err(|error| HostError::Record(format!("Work의 Space를 적지 못했습니다: {error}")))?;
        let threads: Vec<String> = self.with_index(|index| index.of_work(work).iter().map(|summary| summary.id.clone()).collect())?;
        for thread in threads.iter().filter(|thread| Some(thread.as_str()) != folded) {
            let file = self.read_thread_file(thread)?;
            self.note_space(thread, &file, Some(&changed), before.as_deref(), change)?;
        }
        Ok(())
    }

    /// **Space 지우기**(§9 · §14) — 화면의 확인 창 「삭제」만 부른다(Host 도구에는 없다 — §17). core가 파일을 지운 자리로 옮기고 그 Space에
    /// 이은 칸을 비우면, 그 Space로 읽던 Thread마다 「지워짐」 줄을 남긴다(Work면 그 Work의 Thread마다). Project · 대화 · 문서 ·
    /// worktree는 그대로이고, 떠 있는 Session은 다음 말에서 「Space 없음」의 범위로 이어 연다. 없는 Space는 `SpaceNotFound`다.
    pub fn delete_space(&self, slug: &str) -> Result<DeletedSpace, HostError> {
        let deleted = {
            // core가 `thread.json`의 칸을 비우는 동안 엔진의 다른 쓰기(참여자 줄 · 이름 …)와 겹치지 않게 쥔다.
            let _files = self.threads.lock_files();
            atelier_core::delete_space(&self.data_root, slug).map_err(space_error)?
        };
        let name = if deleted.space.name.trim().is_empty() { slug } else { deleted.space.name.as_str() };
        self.note_links(&deleted.unlinked, Some(slug), Change::Deleted { slug, name });
        Ok(deleted)
    }

    /// **Space 되돌리기**(§9 · S10) — 지운 뒤 토스트의 「되돌리기」만 부른다. 파일을 제자리로 돌리고 비웠던 칸 가운데 아직 빈 것에만
    /// 다시 적은 뒤, 그 Space로 다시 읽는 Thread마다 「되돌림」 줄을 남긴다. 그사이 같은 slug가 다시 쓰였으면 아무것도 하지 않고
    /// 거절한다(core의 글 「slug is in use again: …」). 지운 것이 없으면 `SpaceNotFound`다.
    pub fn restore_space(&self, slug: &str) -> Result<RestoredSpace, HostError> {
        let restored = {
            let _files = self.threads.lock_files();
            atelier_core::restore_space(&self.data_root, slug).map_err(space_error)?
        };
        self.note_links(&restored.relinked, None, Change::Restored);
        Ok(restored)
    }

    /// **손으로 지운 Space 파일**(§9) — 이 Thread가 잇는 Space(Work에 이었으면 그 Work의 것)의 파일이 없으면 그 칸을 비우고 「지워짐」
    /// 줄을 남긴다(Work면 그 Work의 Thread마다). 지우기 도중 앱이 꺼져 반쯤 비운 채 남은 연결도 이 길로 닫힌다. 말을 보내기 전에
    /// 부른다 — 줄이 그 말 앞에 서고, 그 말부터 넓어진 범위를 읽는다(범위는 파일이 없으면 이미 「Space 없음」이다 — §7 규칙 1).
    ///
    /// 칸을 다시 읽고 비운다 — 그사이 지우기가 이미 비웠으면 줄을 두 번 남기지 않는다. 읽지 못하는 Thread · Work는 그대로 둔다(보내기가
    /// 그 까닭으로 거절한다).
    pub(super) fn close_lost_space(&self, thread: &str) -> Result<(), HostError> {
        let Ok(file) = self.read_thread_file(thread) else { return Ok(()) };
        match &file.work {
            None => {
                let Some(slug) = file.space.filter(|slug| space_gone(&self.data_root, slug)) else { return Ok(()) };
                let mut closed = false;
                let file = self.change_thread(thread, |file| {
                    if file.space.as_deref() == Some(slug.as_str()) {
                        file.space = None;
                        closed = true;
                    }
                })?;
                if closed {
                    self.note_space(thread, &file, None, Some(&slug), Change::Deleted { slug: &slug, name: &slug })?;
                }
            }
            Some(work) => {
                let Ok(at) = self.open_work(work) else { return Ok(()) };
                let Some(slug) = at.meta.space.filter(|slug| space_gone(&self.data_root, slug)) else { return Ok(()) };
                let works = atelier_core::works_in(&self.data_root);
                let closed = {
                    let _files = self.threads.lock_files();
                    let still = atelier_core::read_work(&works, work).is_ok_and(|meta| meta.space.as_deref() == Some(slug.as_str()));
                    if still {
                        atelier_core::update_work_space(&works, work, None)
                            .map_err(|error| HostError::Record(format!("Work의 Space를 비우지 못했습니다: {error}")))?;
                    }
                    still
                };
                if closed {
                    let links = SpaceLinks { works: vec![work.clone()], threads: Vec::new() };
                    self.note_links(&links, Some(&slug), Change::Deleted { slug: &slug, name: &slug });
                }
            }
        }
        Ok(())
    }

    /// 지우기 · 되돌리기가 고친 곳마다 Space 줄 — Work면 그 Work의 Thread마다(S9), Work 없는 Thread면 그 Thread에. 파일은 이미 고쳤으니
    /// 줄 하나를 못 남겨도 일을 되돌리지 않는다 — 까닭만 stderr에 남긴다.
    fn note_links(&self, links: &SpaceLinks, before: Option<&str>, change: Change) {
        let mut noted = Vec::new();
        for work in &links.works {
            let Ok(at) = self.open_work(work) else { continue };
            let threads = self.with_index(|index| index.of_work(work).iter().map(|summary| summary.id.clone()).collect::<Vec<_>>());
            for thread in threads.unwrap_or_default() {
                noted.push(self.read_thread_file(&thread).and_then(|file| self.note_space(&thread, &file, Some(&at.meta), before, change)));
            }
        }
        for thread in &links.threads {
            noted.push(self.read_thread_file(thread).and_then(|file| self.note_space(thread, &file, None, before, change)));
        }
        for error in noted.into_iter().filter_map(Result::err) {
            eprintln!("atelier: Space 줄을 남기지 못했습니다: {error}");
        }
    }

    /// Thread 도구 「Space 목록」(§11) — Space마다 slug · 이름 · 담은 Project의 slug(적힌 차례) · 설명 첫 줄과, 이 Thread의 지금
    /// Space(Work에 이었으면 그 Work의 것 — 파일이 없으면 없다, §7 규칙 1). 읽기만 한다.
    pub(super) fn list_spaces_tool(&self, key: &SessionKey) -> Value {
        let file = match self.read_thread_file(&key.thread) {
            Ok(file) => file,
            Err(error) => return thread_tools::said(&error.to_string(), true),
        };
        let spaces = match atelier_core::list_spaces(&self.data_root) {
            Ok(spaces) => spaces,
            Err(error) => return thread_tools::said(&format!("Space 목록을 읽지 못했다 — {error}"), true),
        };
        let work = file.work.as_deref().and_then(|slug| self.open_work(slug).ok()).map(|at| at.meta);
        let current = self.scope_of(&file, work.as_ref()).space.map(|space| json!({"slug": space.slug, "name": space.name}));
        let spaces: Vec<Value> = spaces
            .iter()
            .map(|space| {
                let description = space.description.lines().map(str::trim).find(|line| !line.is_empty());
                json!({"slug": space.slug, "name": space.name, "projects": space.projects, "description": description})
            })
            .collect();
        thread_tools::said(&serde_json::to_string_pretty(&json!({"current": current, "spaces": spaces})).unwrap_or_default(), false)
    }

    /// Thread 도구 「Space 붙이기」(§11 · S11 · S12) — 묻지 않고 붙이거나(「알아서」 · 지금 Space 없음 · 후보가 넘긴 것 하나), 질문 카드를
    /// 세우고 사람이 고를 때까지 기다린다. **막히는 호출일 수 있다**(연결마다의 스레드에서 불린다). 넘긴 것이 지금과 같으면 아무것도
    /// 하지 않는다. 없는 Space · 등록되지 않은 Project면 그 까닭을 도구의 실패로 돌려준다.
    pub(super) fn set_space_tool(&self, key: &SessionKey, ask: SpaceAsk) -> Value {
        let asking = match self.space_asking(key, &ask) {
            Ok(asking) => asking,
            Err(why) => return thread_tools::said(&why, true),
        };
        let current = asking.scope.space.as_ref().map(|space| space.slug.as_str());
        if current == ask.space.as_deref() {
            return thread_tools::said(&format!("{} — 바꾸지 않았다.", now_text(&asking.scope)), false);
        }
        let only = matches!(asking.candidates.as_slice(), [one] if Some(one.slug.as_str()) == ask.space.as_deref());
        let auto = gate::asking(&self.data_root, &key.thread, asking.work.as_deref()).0 == AskLevel::Auto;
        if let (true, None, true, Some(slug)) = (auto, current, only, ask.space.as_deref()) {
            return match self.put_thread_space(&key.thread, Some(slug), Change::Attached, false) {
                Ok(()) => {
                    let scope = self.scope_now(&key.thread);
                    thread_tools::said(
                        &format!(
                            "{}에 넣었다 — 물어보는 정도가 「알아서」이고 맞는 Space가 이것 하나라 사람에게 묻지 않았다. 다음 말부터 읽는 \
                             Project: {}. 이번 턴에는 지금 함께 연 폴더를 그대로 읽는다.",
                            space_name(slug, &asking.candidates[0].name),
                            reads(&scope)
                        ),
                        false,
                    )
                }
                Err(error) => thread_tools::said(&error.to_string(), true),
            };
        }
        let fields = asking.card_fields(&ask);
        let mut options: Vec<String> = ask.space.iter().cloned().collect();
        options.extend(asking.candidates.iter().map(|space| space.slug.clone()).filter(|slug| Some(slug) != ask.space.as_ref()));
        self.ask_card(key, Card::Space(SpaceCard { options }), fields)
    }

    /// 「Space 붙이기」를 셈한다 — 이 Thread(이은 Work)의 지금 범위와 후보. 넘긴 Space가 없거나 Project가 등록되지 않았으면 그 까닭(Agent가
    /// 읽고 고쳐 부를 글)이다.
    fn space_asking(&self, key: &SessionKey, ask: &SpaceAsk) -> Result<Asking, String> {
        let file = self.read_thread_file(&key.thread).map_err(|error| error.to_string())?;
        let work = match &file.work {
            Some(slug) => Some(self.open_work(slug).map_err(|error| error.to_string())?.meta),
            None => None,
        };
        let spaces = atelier_core::list_spaces(&self.data_root).map_err(|error| format!("Space 목록을 읽지 못했다 — {error}"))?;
        if let Some(slug) = &ask.space {
            if !spaces.iter().any(|space| &space.slug == slug) {
                let known: Vec<&str> = spaces.iter().map(|space| space.slug.as_str()).collect();
                let known = if known.is_empty() { "없음".to_owned() } else { known.join(", ") };
                return Err(format!("없는 Space다: {slug} — Space(list_spaces): {known}"));
            }
        }
        let registered = atelier_core::list_projects(&atelier_core::projects_in(&self.data_root))
            .map_err(|error| format!("Project 목록을 읽지 못했다 — {error}"))?;
        let unknown: Vec<&str> = ask
            .projects
            .iter()
            .filter(|slug| !registered.iter().any(|view| &view.project.slug == *slug))
            .map(String::as_str)
            .collect();
        if !unknown.is_empty() {
            let known: Vec<&str> = registered.iter().map(|view| view.project.slug.as_str()).collect();
            let known = if known.is_empty() { "없음".to_owned() } else { known.join(", ") };
            return Err(format!("등록되지 않은 Project다: {} — 등록된 Project(list_projects): {known}", unknown.join(", ")));
        }
        // 후보 — 다루는 Project를 모두 담은 Space들, 없으면 하나라도 담은 Space들(§11).
        let holds = |space: &atelier_core::Space, all: bool| {
            let held = |slug: &String| space.projects.contains(slug);
            if all { ask.projects.iter().all(held) } else { ask.projects.iter().any(held) }
        };
        let mut candidates: Vec<atelier_core::Space> = spaces.iter().filter(|space| holds(space, true)).cloned().collect();
        if candidates.is_empty() {
            candidates = spaces.iter().filter(|space| holds(space, false)).cloned().collect();
        }
        // 추천은 후보가 아니어도 맨 위에 선다 — Host가 고른 것이다.
        if let Some(slug) = &ask.space {
            if !candidates.iter().any(|space| &space.slug == slug) {
                candidates.insert(0, spaces.iter().find(|space| &space.slug == slug).cloned().expect("위에서 보았다"));
            }
        }
        let names = registered.iter().map(|view| (view.project.slug.clone(), view.project.name.clone())).collect();
        let scope = self.scope_of(&file, work.as_ref());
        Ok(Asking { work: file.work, scope, candidates, names })
    }

    /// Space 질문 카드의 답(§11) — 사람이 고른 것으로 그 카드를 닫는다. 고른 Space는 이 Thread(Work에 이었으면 그 Work)에 적고, 이 Thread에는
    /// 접힌 카드(답 줄)만 남는다 — Space 줄을 따로 남기지 않는다(§9). 그 Work의 다른 Thread에는 Space 줄이 선다(S9). 「나중에」는 아무것도
    /// 바꾸지 않는다. 적지 못하면(그사이 Space가 지워졌다) 아무것도 적지 않고 카드는 그대로 선다. 카드에 없던 Space이거나 이미 닫힌 카드면
    /// 거절이다. 기다리지 않는다 — 도구의 결과와 Host의 다음 말은 기록 줄로 온다.
    pub fn answer_space(&self, thread: &str, request: &str, choice: SpaceChoice) -> Result<(), HostError> {
        let asked = self
            .threads
            .proposals
            .take(thread, request, "space")
            .ok_or_else(|| HostError::QuestionClosed { thread: thread.to_owned(), request: request.to_owned() })?;
        let Card::Space(card) = &asked.card else { unreachable!("Space 질문 카드만 꺼냈다") };
        let picked = match &choice {
            SpaceChoice::Space(slug) if !card.options.contains(slug) => {
                self.threads.proposals.put_back(request, asked);
                return Err(HostError::SpaceNotFound(slug.clone()));
            }
            SpaceChoice::Space(slug) => Some(Some(slug.as_str())),
            SpaceChoice::Without => Some(None),
            SpaceChoice::Later => None,
        };
        let before = self.scope_now(thread);
        if let Some(space) = picked {
            if let Err(error) = self.put_thread_space(thread, space, Change::Picked, true) {
                self.threads.proposals.put_back(request, asked);
                return Err(error);
            }
        }
        let scope = self.scope_now(thread);
        let (kind, space) = match (&choice, &scope.space) {
            (SpaceChoice::Later, _) => ("later", None),
            (SpaceChoice::Without, _) => ("none", None),
            (SpaceChoice::Space(_), space) => ("space", space.as_ref()),
        };
        let line = json!({
            "state": "answered", "requestId": request, "card": "space", "choice": kind,
            "space": space.map(|space| &space.slug), "name": space.map(|space| &space.name),
        });
        self.thread_log(thread)?.write(RecordKind::Question, Some(&asked.key.handle), line).map_err(HostError::Record)?;
        let text = match choice {
            SpaceChoice::Later => format!(
                "사람이 나중에 정하기로 함 — Space를 바꾸지 않았다. {}. 같은 물음을 곧바로 다시 하지 않는다.",
                now_text(&before)
            ),
            _ if before.space.as_ref().map(|space| &space.slug) == scope.space.as_ref().map(|space| &space.slug) => {
                format!("사람이 지금 Space를 그대로 두기로 했다 — {}. 바꾸지 않았다.", now_text(&scope))
            }
            SpaceChoice::Without => format!("사람이 Space 없이 하기로 했다 — 다음 말부터 {}. {THIS_TURN}", reads(&scope)),
            SpaceChoice::Space(slug) => {
                let name = scope.space.as_ref().map_or(slug.as_str(), |space| space.name.as_str());
                format!("사람이 {}를 골랐다 — 다음 말부터 읽는 Project: {}. {THIS_TURN}", space_name(&slug, name), reads(&scope))
            }
        };
        asked.settle(Settled::Said { text, refused: false });
        Ok(())
    }

    /// 그 Thread의 지금 범위 — 읽지 못하면 등록된 Project 전부로 센다(글에만 쓴다).
    fn scope_now(&self, thread: &str) -> ReadingScope {
        let file = self.read_thread_file(thread).unwrap_or_default();
        let work = file.work.as_deref().and_then(|slug| self.open_work(slug).ok()).map(|at| at.meta);
        self.scope_of(&file, work.as_ref())
    }

    /// 그 Thread의 읽는 범위(§7) — Session의 자리 · 머리말이 이것 하나를 쓴다. 이은 Work는 부르는 쪽이 읽어 넘긴다.
    pub(super) fn scope_of(&self, file: &ThreadFile, work: Option<&Work>) -> ReadingScope {
        atelier_core::reading_scope(&self.data_root, &ScopeOf::thread(file, work))
    }

    pub(super) fn check_space(&self, space: Option<&str>) -> Result<(), HostError> {
        match space {
            Some(slug) if space_gone(&self.data_root, slug) => Err(HostError::SpaceNotFound(slug.to_owned())),
            _ => Ok(()),
        }
    }

    /// Space 줄 하나 — 바뀐 뒤의 그 Thread의 범위를 싣는다.
    fn note_space(&self, thread: &str, file: &ThreadFile, work: Option<&Work>, before: Option<&str>, change: Change) -> Result<(), HostError> {
        let scope = self.scope_of(file, work);
        let line = space_line(change, &scope, before, work.map(|work| work.slug.as_str()));
        self.thread_log(thread)?.write(RecordKind::Space, None, line).map_err(HostError::Record).map(drop)
    }
}

/// Space 질문 카드의 값(§11 · S12) — 사람이 고를 수 있는 Space(추천 · 후보의 slug). 「Space 없이」 · 「나중에」는 늘 고를 수 있다.
pub(super) struct SpaceCard {
    options: Vec<String>,
}

/// 「Space 붙이기」의 셈 — 이은 Work, 지금 범위, 후보(추천이 맨 앞 — 후보가 아니어도), 등록된 Project의 slug → 이름.
struct Asking {
    work: Option<String>,
    scope: ReadingScope,
    candidates: Vec<atelier_core::Space>,
    names: std::collections::HashMap<String, String>,
}

impl Asking {
    /// 질문 카드의 값 — `question` 줄(`card: space`)에 실린다. 추천(없으면 「Space 없이」가 추천) · 후보마다 slug · 이름 · 담은 Project의
    /// 이름(적힌 차례 — 등록되지 않은 것은 slug 그대로) · 등록된 Project 수(「Space 없이 · 등록된 Project N개를 모두 읽어요」) · 지금
    /// Space · Host의 까닭. 물음 · 선택지의 글은 화면이 짓는다(`space-card.ts`).
    fn card_fields(&self, ask: &SpaceAsk) -> Value {
        let spaces: Vec<Value> = self
            .candidates
            .iter()
            .map(|space| {
                let projects: Vec<&str> =
                    space.projects.iter().map(|slug| self.names.get(slug).map_or(slug.as_str(), String::as_str)).collect();
                json!({"slug": space.slug, "name": space.name, "projects": projects})
            })
            .collect();
        json!({
            "recommended": ask.space,
            "spaces": spaces,
            "registered": self.scope.registered,
            "current": self.scope.space.as_ref().map(|space| json!({"slug": space.slug, "name": space.name})),
            "reason": ask.reason,
        })
    }
}

/// 범위가 바뀌는 때(스토리 41) — 도구의 결과 끝에 붙는다.
const THIS_TURN: &str = "이번 턴에는 지금 함께 연 폴더를 그대로 읽는다.";

/// 「Space `결제-서비스`(결제 서비스)」.
fn space_name(slug: &str, name: &str) -> String {
    format!("Space `{slug}`({name})")
}

/// 읽는 Project — slug(Thread 도구가 받는 것)를 잇는다. Space가 없으면 「등록된 Project N개를 모두 읽는다」다.
fn reads(scope: &ReadingScope) -> String {
    if scope.space.is_none() {
        return format!("등록된 Project {}개를 모두 읽는다", scope.registered);
    }
    let read: Vec<&str> = scope.projects.iter().map(|project| project.slug.as_str()).collect();
    if read.is_empty() { "없음".to_owned() } else { read.join(", ") }
}

/// 지금 Space를 말하는 글 — 「지금 Space `…`(…)다」 · 「지금 Space 없이 등록된 Project N개를 모두 읽는다」.
fn now_text(scope: &ReadingScope) -> String {
    match &scope.space {
        Some(space) => format!("지금 {}다", space_name(&space.slug, &space.name)),
        None => format!("지금 Space 없이 {}", reads(scope)),
    }
}

/// Space 줄의 갈래 — 사람이 고른 것(바꿈 · 뺌 — 05)은 바뀐 범위가 가르고, 붙임(08) · 지움 · 되돌림(07)은 그 일이 정한다.
#[derive(Clone, Copy)]
enum Change<'a> {
    /// 칩 · 메뉴로 붙이고 · 바꾸고 · 뺐다 — 범위에 Space가 있으면 `changed`, 없으면 `removed`.
    Picked,
    /// Host가 묻지 않고 붙였다(「알아서」 — 08) — 범위의 Space가 그것이다.
    Attached,
    /// 이은 Space가 지워졌다 — 그 Space(slug · 보이는 이름. 파일이 사라졌으면 이름도 slug다).
    Deleted { slug: &'a str, name: &'a str },
    /// 지운 Space를 되돌렸다 — 범위의 Space가 그것이다.
    Restored,
}

/// Space 줄의 payload — 갈래 · Space(slug · 이름) · 바꾸기 전 · 이은 Work · 읽는 Project의 이름 · 등록된 Project 수.
fn space_line(change: Change, scope: &ReadingScope, before: Option<&str>, work: Option<&str>) -> Value {
    let now = scope.space.as_ref().map(|space| (space.slug.as_str(), space.name.as_str()));
    let (kind, space) = match change {
        Change::Picked if now.is_some() => ("changed", now),
        Change::Picked => ("removed", None),
        Change::Attached => ("attached", now),
        Change::Deleted { slug, name } => ("deleted", Some((slug, name))),
        Change::Restored => ("restored", now),
    };
    json!({
        "change": kind,
        "space": space.map(|(slug, _)| slug),
        "name": space.map(|(_, name)| name),
        "before": before,
        "work": work,
        "projects": scope.projects.iter().map(|project| &project.name).collect::<Vec<_>>(),
        "registered": scope.registered,
    })
}

/// 그 slug의 Space 파일이 없다 — 지웠거나 손으로 지웠다(§7 규칙 1과 같은 셈).
fn space_gone(data_root: &std::path::Path, slug: &str) -> bool {
    atelier_core::get_space(data_root, slug).is_err()
}

/// 지우기 · 되돌리기의 거절 — 없는 Space는 붙이기와 같은 말, 그 밖(slug가 다시 쓰임 · 디스크)은 core의 글 그대로다.
fn space_error(error: atelier_core::Error) -> HostError {
    match error {
        atelier_core::Error::SpaceNotFound(slug) => HostError::SpaceNotFound(slug),
        other => HostError::Record(other.to_string()),
    }
}

/// 머리말의 「- Space:」 한 줄(§11) — Work 줄 뒤에 선다. 읽는 Project는 slug다(Thread 도구가 slug로 받는다).
pub(super) fn space_preamble(scope: &ReadingScope) -> String {
    match &scope.space {
        Some(space) => {
            let read: Vec<&str> = scope.projects.iter().map(|project| project.slug.as_str()).collect();
            let read = if read.is_empty() { "없음".to_owned() } else { read.join(", ") };
            let troubled = if space.troubled { " — 파일에 문제가 있어 읽을 수 있는 Project만 읽는다" } else { "" };
            format!("- Space: {}(`{}`) — 읽는 Project: {read}{troubled}\n", space.name, atelier_core::collapse_home(&space.file))
        }
        None if scope.registered == 0 => "- Space: 없음 — 등록된 Project가 없다\n".to_owned(),
        None => format!("- Space: 없음 — 등록된 Project {}개를 모두 읽는다\n", scope.registered),
    }
}
