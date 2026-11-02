//! Service와 이어짐(03 구현 스펙 §7 · §9 · 티켓 05) — Work · Thread의 `service` 한 칸을 붙이고 · 바꾸고 · 빼고, 흐름에 Service 줄을 남긴다.
//!
//! - **Work에 이은 Thread의 Service는 그 Work의 것이다**(§9) — Thread에서 바꾸면(Service 칩) 그 Work의 Service가 바뀐다(스토리 42). Work의
//!   Service가 바뀌면 그 Work의 Thread마다 Service 줄이 선다(S9) — 그 Thread들의 범위가 모두 바뀐다.
//! - **Service 줄**(`service`)은 시스템 줄이다. 갈래 다섯(`change` — 사람이 칩 · 메뉴로 한 바꿈 `changed` · 뺌 `removed`,
//!   Host 「묻지 않음」의 붙임 `attached`(08), 지워짐 `deleted` · 되돌림 `restored`(07))과 바뀐 뒤의 범위(읽는 Project의 이름 · 등록된
//!   Project 수 · worktree에서 일하는 Project의 이름)를 싣는다 — 화면은 그때의 범위를 다시 셀 수 없다(기록은 덧붙이기만 한다).
//! - 떠 있는 Session은 건드리지 않는다 — 다음 말을 보낼 때 새 자리로 이어 연다([`ConversationHost::move_if_needed`] — 범위가 바뀌면 함께
//!   여는 폴더가 바뀐다). 돌고 있는 턴은 끊기지 않는다(스토리 41).
//! - **Service를 지우면**(티켓 07 · §9) 그 Service에 이은 칸이 비고 그 Service로 읽던 Thread마다 「지워짐」 줄이, 되돌리면 다시 적은 곳마다
//!   「되돌림」 줄이 선다. 앱 밖에서 파일이 사라졌으면 그 Thread의 다음 말을 보낼 때 같은 줄로 닫는다([`ConversationHost::close_lost_service`]).

use atelier_core::{DeletedService, ReadingScope, RecordKind, RestoredService, ScopeOf, ServiceLinks, ThreadFile, Work};
use serde_json::{json, Value};

use super::gate;
use super::work::{Card, Settled};
use super::ConversationHost;
use crate::policy::AskLevel;
use crate::thread_tools::{self, ServiceAsk};
use crate::HostError;

/// Service 질문 카드에서 사람이 고른 것(03 §11).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceChoice {
    /// 그 Service(slug) — 카드의 선택지 가운데 하나다.
    Service(String),
    /// 「Service 없이」 — 등록된 Project를 모두 읽는다.
    Without,
    /// 「나중에」(esc) — 아무것도 바꾸지 않는다.
    Later,
}

impl ServiceChoice {
    /// 답 줄의 `choice` 값 — 화면의 접힌 카드가 이 글로 「Service 없이」 · 「나중에」를 가른다.
    fn as_str(&self) -> &'static str {
        match self {
            ServiceChoice::Service(_) => "service",
            ServiceChoice::Without => "none",
            ServiceChoice::Later => "later",
        }
    }
}

impl ConversationHost {
    /// Thread의 Service 붙이기 · 바꾸기 · 빼기(`None`) — `thread.json`의 `service`만 고치고 Service 줄을 남긴다. Work에 이은 Thread면 그 Work의
    /// Service를 바꾼다([`Self::set_work_service`]). 같은 Service면 아무것도 하지 않는다. 없는 Service는 아무것도 적지 않고 거절한다.
    pub fn set_thread_service(&self, thread: &str, service: Option<&str>) -> Result<(), HostError> {
        self.put_thread_service(thread, service, Change::Picked, false)
    }

    /// Work의 Service 붙이기 · 바꾸기 · 빼기 — `work.json`의 `service`만 고치고 그 Work의 Thread마다 Service 줄을 남긴다(S9). 같은 Service면
    /// 아무것도 하지 않는다. 없는 Work · 없는 Service는 아무것도 적지 않고 거절한다.
    pub fn set_work_service(&self, work: &str, service: Option<&str>) -> Result<(), HostError> {
        self.put_work_service(work, service, Change::Picked, None)
    }

    /// Thread의 Service를 적는 몸 — 사람의 칩 · 메뉴(05)와 Host의 「Service 붙이기」(08)가 함께 쓴다. `folded`면 이 Thread에는 줄을 남기지
    /// 않는다 — 질문 카드로 고른 Service는 접힌 카드가 그 줄이다(§9). Work에 이은 Thread면 그 Work의 Service를 바꾼다.
    fn put_thread_service(&self, thread: &str, service: Option<&str>, change: Change, folded: bool) -> Result<(), HostError> {
        let file = self.read_thread_file(thread)?;
        if let Some(work) = &file.work {
            return self.put_work_service(work, service, change, folded.then_some(thread));
        }
        self.require_service(service)?;
        if file.service.as_deref() == service {
            return Ok(());
        }
        let before = file.service;
        let file = self.change_thread(thread, |file| file.service = service.map(str::to_owned))?;
        if folded {
            return Ok(());
        }
        self.note_service(thread, &file, None, before.as_deref(), change)
    }

    /// Work의 Service를 적는 몸 — `folded`는 줄을 남기지 않을 Thread(그 Thread의 질문 카드가 줄을 대신한다)다. 그 Work의 다른 Thread에는
    /// 줄이 선다(S9).
    fn put_work_service(&self, work: &str, service: Option<&str>, change: Change, folded: Option<&str>) -> Result<(), HostError> {
        let before = self.open_work(work)?.meta.service;
        self.require_service(service)?;
        if before.as_deref() == service {
            return Ok(());
        }
        let changed = atelier_core::update_work_service(&atelier_core::works_in(&self.data_root), work, service)
            .map_err(|error| HostError::Record(format!("작업공간의 Service를 적지 못했습니다: {error}")))?;
        let threads: Vec<String> = self.with_index(|index| index.of_work(work).iter().map(|summary| summary.id.clone()).collect())?;
        for thread in threads.iter().filter(|thread| Some(thread.as_str()) != folded) {
            let file = self.read_thread_file(thread)?;
            self.note_service(thread, &file, Some(&changed), before.as_deref(), change)?;
        }
        Ok(())
    }

    /// **Service 지우기**(§9 · §14) — 화면의 확인 창 「삭제」만 부른다(Host 도구에는 없다 — §17). core가 파일을 지운 자리로 옮기고 그 Service에
    /// 이은 칸을 비우면, 그 Service로 읽던 Thread마다 「지워짐」 줄을 남긴다(Work면 그 Work의 Thread마다). Project · 대화 · 문서 ·
    /// worktree는 그대로이고, 떠 있는 Session은 다음 말에서 「Service 없음」의 범위로 이어 연다. 없는 Service는 `ServiceNotFound`다.
    pub fn delete_service(&self, slug: &str) -> Result<DeletedService, HostError> {
        let deleted = {
            // core가 `thread.json`의 칸을 비우는 동안 엔진의 다른 쓰기(세션 id · 이름 …)와 겹치지 않게 쥔다.
            let _files = self.threads.lock_files();
            atelier_core::delete_service(&self.data_root, slug).map_err(service_error)?
        };
        self.note_links(&deleted.unlinked, Some(slug), Change::Deleted { slug, name: deleted.service.shown_name() });
        Ok(deleted)
    }

    /// **Service 되돌리기**(§9 · S10) — 지운 뒤 토스트의 「되돌리기」만 부른다. 파일을 제자리로 돌리고 비웠던 칸 가운데 아직 빈 것에만
    /// 다시 적은 뒤, 그 Service로 다시 읽는 Thread마다 「되돌림」 줄을 남긴다. 그사이 같은 slug가 다시 쓰였으면 아무것도 하지 않고
    /// 거절한다(core의 글 「slug is in use again: …」). 지운 것이 없으면 `ServiceNotFound`다.
    pub fn restore_service(&self, slug: &str) -> Result<RestoredService, HostError> {
        let restored = {
            let _files = self.threads.lock_files();
            atelier_core::restore_service(&self.data_root, slug).map_err(service_error)?
        };
        self.note_links(&restored.relinked, None, Change::Restored);
        Ok(restored)
    }

    /// **손으로 지운 Service 파일**(§9) — 이 Thread가 잇는 Service(Work에 이었으면 그 Work의 것)의 파일이 없으면 그 칸을 비우고 「지워짐」
    /// 줄을 남긴다(Work면 그 Work의 Thread마다). 지우기 도중 앱이 꺼져 반쯤 비운 채 남은 연결도 이 길로 닫힌다. 말을 보내기 전에
    /// 부른다 — 줄이 그 말 앞에 서고, 그 말부터 넓어진 범위를 읽는다(범위는 파일이 없으면 이미 「Service 없음」이다 — §7 규칙 1).
    ///
    /// 칸을 다시 읽고 비운다 — 그사이 지우기가 이미 비웠으면 줄을 두 번 남기지 않는다. 읽지 못하는 Thread · Work는 그대로 둔다(보내기가
    /// 그 까닭으로 거절한다).
    pub(super) fn close_lost_service(&self, thread: &str) -> Result<(), HostError> {
        let Ok(file) = self.read_thread_file(thread) else { return Ok(()) };
        match &file.work {
            None => {
                let Some(slug) = file.service.filter(|slug| service_gone(&self.data_root, slug)) else { return Ok(()) };
                let mut closed = false;
                let file = self.change_thread(thread, |file| {
                    if file.service.as_deref() == Some(slug.as_str()) {
                        file.service = None;
                        closed = true;
                    }
                })?;
                if closed {
                    self.note_service(thread, &file, None, Some(&slug), Change::Deleted { slug: &slug, name: &slug })?;
                }
            }
            Some(work) => {
                let Ok(at) = self.open_work(work) else { return Ok(()) };
                let Some(slug) = at.meta.service.filter(|slug| service_gone(&self.data_root, slug)) else { return Ok(()) };
                let works = atelier_core::works_in(&self.data_root);
                let closed = {
                    let _files = self.threads.lock_files();
                    let still = atelier_core::read_work(&works, work).is_ok_and(|meta| meta.service.as_deref() == Some(slug.as_str()));
                    if still {
                        atelier_core::update_work_service(&works, work, None)
                            .map_err(|error| HostError::Record(format!("작업공간의 Service를 비우지 못했습니다: {error}")))?;
                    }
                    still
                };
                if closed {
                    let links = ServiceLinks { works: vec![work.clone()], threads: Vec::new() };
                    self.note_links(&links, Some(&slug), Change::Deleted { slug: &slug, name: &slug });
                }
            }
        }
        Ok(())
    }

    /// 지우기 · 되돌리기가 고친 곳마다 Service 줄 — Work면 그 Work의 Thread마다(S9), Work 없는 Thread면 그 Thread에. 파일은 이미 고쳤으니
    /// 줄 하나를 못 남겨도 일을 되돌리지 않는다 — 까닭만 stderr에 남긴다.
    fn note_links(&self, links: &ServiceLinks, before: Option<&str>, change: Change) {
        let mut noted = Vec::new();
        for work in &links.works {
            let Ok(at) = self.open_work(work) else { continue };
            let threads = self.with_index(|index| index.of_work(work).iter().map(|summary| summary.id.clone()).collect::<Vec<_>>());
            for thread in threads.unwrap_or_default() {
                noted.push(self.read_thread_file(&thread).and_then(|file| self.note_service(&thread, &file, Some(&at.meta), before, change)));
            }
        }
        for thread in &links.threads {
            noted.push(self.read_thread_file(thread).and_then(|file| self.note_service(thread, &file, None, before, change)));
        }
        for error in noted.into_iter().filter_map(Result::err) {
            eprintln!("atelier: Service 줄을 남기지 못했습니다: {error}");
        }
    }

    /// Thread 도구 「Service 목록」(§11) — Service마다 slug · 이름 · 담은 Project의 slug(적힌 차례) · 설명 첫 줄과, 이 Thread의 지금
    /// Service(Work에 이었으면 그 Work의 것 — 파일이 없으면 없다, §7 규칙 1). 읽기만 한다.
    pub(super) fn list_services_tool(&self, thread: &str) -> Value {
        let file = match self.read_thread_file(thread) {
            Ok(file) => file,
            Err(error) => return thread_tools::said(&error.to_string(), true),
        };
        let services = match atelier_core::list_services(&self.data_root) {
            Ok(services) => services,
            Err(error) => return thread_tools::said(&format!("Service 목록을 읽지 못했다 — {error}"), true),
        };
        let work = file.work.as_deref().and_then(|slug| self.open_work(slug).ok()).map(|at| at.meta);
        let current = self.scope_of(&file, work.as_ref()).service.map(|service| json!({"slug": service.slug, "name": service.name}));
        let services: Vec<Value> = services
            .iter()
            .map(|service| {
                let description = service.description.lines().map(str::trim).find(|line| !line.is_empty());
                json!({"slug": service.slug, "name": service.name, "projects": service.projects, "description": description})
            })
            .collect();
        thread_tools::said(&serde_json::to_string_pretty(&json!({"current": current, "services": services})).unwrap_or_default(), false)
    }

    /// Thread 도구 「Service 붙이기」(§11 · S11 · S12) — 묻지 않고 붙이거나(「묻지 않음」 · 지금 Service 없음 · 후보가 넘긴 것 하나), 질문 카드를
    /// 세우고 사람이 고를 때까지 기다린다. **막히는 호출일 수 있다**(연결마다의 스레드에서 불린다). 넘긴 것이 지금과 같으면 아무것도
    /// 하지 않는다. 없는 Service · 등록되지 않은 Project면 그 까닭을 도구의 실패로 돌려준다.
    pub(super) fn set_service_tool(&self, thread: &str, ask: ServiceAsk) -> Value {
        let asking = match self.service_asking(thread, &ask) {
            Ok(asking) => asking,
            Err(why) => return thread_tools::said(&why, true),
        };
        let current = asking.scope.service.as_ref().map(|service| service.slug.as_str());
        if current == ask.service.as_deref() {
            return thread_tools::said(&format!("{} — 바꾸지 않았다.", now_text(&asking.scope)), false);
        }
        let auto = gate::asking(&self.data_root, thread, asking.work.as_deref()).0 == AskLevel::Auto;
        if let (true, None, true, Some(slug)) = (auto, current, asking.alone, ask.service.as_deref()) {
            return match self.put_thread_service(thread, Some(slug), Change::Attached, false) {
                Ok(()) => {
                    let scope = self.scope_now(thread);
                    thread_tools::said(
                        &format!(
                            "{}에 넣었다 — 물어보는 정도가 「묻지 않음」이고 맞는 Service가 이것 하나라 사람에게 묻지 않았다. 다음 말부터 읽는 \
                             Project: {}. 이번 턴에는 지금 함께 연 폴더를 그대로 읽는다.",
                            service_name(slug, &asking.candidates[0].name),
                            reads(&scope)
                        ),
                        false,
                    )
                }
                Err(error) => thread_tools::said(&error.to_string(), true),
            };
        }
        let fields = asking.card_fields(&ask);
        let mut options: Vec<String> = ask.service.iter().cloned().collect();
        options.extend(asking.candidates.iter().map(|service| service.slug.clone()).filter(|slug| Some(slug) != ask.service.as_ref()));
        self.ask_card(thread, Card::Service(ServiceCard { options }), fields)
    }

    /// 「Service 붙이기」를 셈한다 — 이 Thread(이은 Work)의 지금 범위와 후보. 넘긴 Service가 없거나 Project가 등록되지 않았으면 그 까닭(Agent가
    /// 읽고 고쳐 부를 글)이다.
    fn service_asking(&self, thread: &str, ask: &ServiceAsk) -> Result<Asking, String> {
        let file = self.read_thread_file(thread).map_err(|error| error.to_string())?;
        let work = match &file.work {
            Some(slug) => Some(self.open_work(slug).map_err(|error| error.to_string())?.meta),
            None => None,
        };
        let services = atelier_core::list_services(&self.data_root).map_err(|error| format!("Service 목록을 읽지 못했다 — {error}"))?;
        if let Some(slug) = ask.service.as_deref().filter(|slug| !services.iter().any(|service| service.slug == *slug)) {
            return Err(no_such_service(slug, &services));
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
            return Err(not_registered(&unknown, &registered));
        }
        // 후보 — 다루는 Project를 모두 담은 Service들, 없으면 하나라도 담은 Service들(§11).
        let holds = |service: &atelier_core::Service, all: bool| {
            let held = |slug: &String| service.projects.contains(slug);
            if all { ask.projects.iter().all(held) } else { ask.projects.iter().any(held) }
        };
        let mut candidates: Vec<atelier_core::Service> = services.iter().filter(|service| holds(service, true)).cloned().collect();
        if candidates.is_empty() {
            candidates = services.iter().filter(|service| holds(service, false)).cloned().collect();
        }
        // 묻지 않고 붙이는 「후보가 넘긴 것 하나」는 추천을 끼우기 전의 후보로 가린다 — 다루는 Project를 담은 Service가 없으면 넘긴
        // Service가 하나 남아도 맞는 Service가 아니다.
        let alone = matches!(candidates.as_slice(), [one] if Some(&one.slug) == ask.service.as_ref());
        // 추천은 맨 위에 선다 — 후보 안에 있어도(이름 차례를 앞질러), 후보가 아니어도. Host가 고른 것이다(스토리 50).
        if let Some(slug) = &ask.service {
            let recommended = match candidates.iter().position(|service| &service.slug == slug) {
                Some(at) => candidates.remove(at),
                None => services.iter().find(|service| &service.slug == slug).cloned().expect("위에서 보았다"),
            };
            candidates.insert(0, recommended);
        }
        let names = registered.iter().map(|view| (view.project.slug.clone(), view.project.name.clone())).collect();
        let scope = self.scope_of(&file, work.as_ref());
        Ok(Asking { work: file.work, scope, candidates, alone, names })
    }

    /// Service 질문 카드의 답(§11) — 사람이 고른 것으로 그 카드를 닫는다. 고른 Service는 이 Thread(Work에 이었으면 그 Work)에 적고, 이 Thread에는
    /// 접힌 카드(답 줄)만 남는다 — Service 줄을 따로 남기지 않는다(§9). 그 Work의 다른 Thread에는 Service 줄이 선다(S9). 「나중에」는 아무것도
    /// 바꾸지 않는다. 적지 못하면(그사이 Service가 지워졌다) 아무것도 적지 않고 카드는 그대로 선다. 카드에 없던 Service이거나 이미 닫힌 카드면
    /// 거절이다. 기다리지 않는다 — 도구의 결과와 Host의 다음 말은 기록 줄로 온다.
    pub fn answer_service(&self, thread: &str, request: &str, choice: ServiceChoice) -> Result<(), HostError> {
        let asked = self
            .threads
            .proposals
            .take(thread, request, "service")
            .ok_or_else(|| HostError::QuestionClosed { thread: thread.to_owned(), request: request.to_owned() })?;
        let Card::Service(card) = &asked.card else { unreachable!("Service 질문 카드만 꺼냈다") };
        let picked = match &choice {
            ServiceChoice::Service(slug) if !card.options.contains(slug) => {
                self.threads.proposals.put_back(request, asked);
                return Err(HostError::ServiceNotFound(slug.clone()));
            }
            ServiceChoice::Service(slug) => Some(Some(slug.as_str())),
            ServiceChoice::Without => Some(None),
            ServiceChoice::Later => None,
        };
        let before = self.scope_now(thread);
        if let Some(service) = picked {
            if let Err(error) = self.put_thread_service(thread, service, Change::Picked, true) {
                self.threads.proposals.put_back(request, asked);
                return Err(error);
            }
        }
        let scope = self.scope_now(thread);
        let service = matches!(choice, ServiceChoice::Service(_)).then_some(scope.service.as_ref()).flatten();
        let line = json!({
            "state": "answered", "requestId": request, "card": "service", "choice": choice.as_str(),
            "service": service.map(|service| &service.slug), "name": service.map(|service| &service.name),
        });
        self.thread_log(thread)?.write(RecordKind::Question, line).map_err(HostError::Record)?;
        let text = match choice {
            ServiceChoice::Later => format!(
                "사람이 나중에 정하기로 함 — Service를 바꾸지 않았다. {}. 같은 물음을 곧바로 다시 하지 않는다.",
                now_text(&before)
            ),
            _ if before.service.as_ref().map(|service| &service.slug) == scope.service.as_ref().map(|service| &service.slug) => {
                format!("사람이 지금 Service를 그대로 두기로 했다 — {}. 바꾸지 않았다.", now_text(&scope))
            }
            ServiceChoice::Without => format!("사람이 Service 없이 하기로 했다 — 다음 말부터 {}. {THIS_TURN}", reads(&scope)),
            ServiceChoice::Service(slug) => {
                let name = scope.service.as_ref().map_or(slug.as_str(), |service| service.name.as_str());
                format!("사람이 {}를 골랐다 — 다음 말부터 읽는 Project: {}. {THIS_TURN}", service_name(&slug, name), reads(&scope))
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

    /// 붙일 Service가 있는지 — 그 slug의 파일이 없으면 `ServiceNotFound`로 거절한다(없음은 늘 된다). 칩 · 메뉴 · Host · 첫 말이 적기 전에 본다.
    pub(super) fn require_service(&self, service: Option<&str>) -> Result<(), HostError> {
        match service {
            Some(slug) if service_gone(&self.data_root, slug) => Err(HostError::ServiceNotFound(slug.to_owned())),
            _ => Ok(()),
        }
    }

    /// Service 줄 하나 — 바뀐 뒤의 그 Thread의 범위를 싣는다.
    fn note_service(&self, thread: &str, file: &ThreadFile, work: Option<&Work>, before: Option<&str>, change: Change) -> Result<(), HostError> {
        let scope = self.scope_of(file, work);
        let line = service_line(change, &scope, before, work.map(|work| work.slug.as_str()));
        self.thread_log(thread)?.write(RecordKind::Service, line).map_err(HostError::Record).map(drop)
    }
}

/// Service 질문 카드의 값(§11 · S12) — 사람이 고를 수 있는 Service(추천 · 후보의 slug). 「Service 없이」 · 「나중에」는 늘 고를 수 있다.
pub(super) struct ServiceCard {
    options: Vec<String>,
}

/// 「Service 붙이기」의 셈 — 이은 Work, 지금 범위, 후보(추천이 맨 앞 — 후보가 아니어도), 맞는 Service가 넘긴 것 하나뿐인가, 등록된
/// Project의 slug → 이름.
struct Asking {
    work: Option<String>,
    scope: ReadingScope,
    candidates: Vec<atelier_core::Service>,
    /// 추천을 끼우기 전의 후보가 넘긴 Service 하나뿐이다 — 「묻지 않음」이 묻지 않고 붙이는 셋째 조건(§11).
    alone: bool,
    names: std::collections::HashMap<String, String>,
}

impl Asking {
    /// 질문 카드의 값 — `question` 줄(`card: service`)에 실린다. 추천(없으면 「Service 없이」가 추천) · 후보마다 slug · 이름 · 담은 Project의
    /// 이름(적힌 차례 — 등록되지 않은 것은 slug 그대로) · 등록된 Project 수(「Service 없이 · 등록된 Project N개를 모두 읽어요」) · 지금
    /// Service · Host의 까닭. 물음 · 선택지의 글은 화면이 짓는다(`service-card.ts`).
    fn card_fields(&self, ask: &ServiceAsk) -> Value {
        let services: Vec<Value> = self
            .candidates
            .iter()
            .map(|service| {
                let projects: Vec<&str> =
                    service.projects.iter().map(|slug| self.names.get(slug).map_or(slug.as_str(), String::as_str)).collect();
                json!({"slug": service.slug, "name": service.name, "projects": projects})
            })
            .collect();
        json!({
            "recommended": ask.service,
            "services": services,
            "registered": self.scope.registered,
            "current": self.scope.service.as_ref().map(|service| json!({"slug": service.slug, "name": service.name})),
            "reason": ask.reason,
        })
    }
}

/// 범위가 바뀌는 때(스토리 41) — 도구의 결과 끝에 붙는다.
const THIS_TURN: &str = "이번 턴에는 지금 함께 연 폴더를 그대로 읽는다.";

/// 「Service `결제-서비스`(결제 서비스)」.
fn service_name(slug: &str, name: &str) -> String {
    format!("Service `{slug}`({name})")
}

// **Agent에게 가는 범위 · 거절의 글은 여기 하나에서 짓는다** — 머리말 · Thread 도구의 결과(Service 붙이기 · 설정 넷)가 같은 말을 한다.

/// slug 목록을 잇는다(「web-app, api-server」) — 비면 「없음」.
pub(super) fn listed<'a>(slugs: impl IntoIterator<Item = &'a str>) -> String {
    let slugs: Vec<&str> = slugs.into_iter().collect();
    if slugs.is_empty() { "없음".to_owned() } else { slugs.join(", ") }
}

/// 읽는 Project — slug(Thread 도구가 받는 것)를 잇는다. Service가 없으면 「등록된 Project N개를 모두 읽는다」(등록이 없으면 「등록된
/// Project가 없다」)다.
fn reads(scope: &ReadingScope) -> String {
    match &scope.service {
        Some(_) => listed(scope.projects.iter().map(|project| project.slug.as_str())),
        None if scope.registered == 0 => "등록된 Project가 없다".to_owned(),
        None => format!("등록된 Project {}개를 모두 읽는다", scope.registered),
    }
}

/// 없는 Service의 거절 — 있는 Service를 함께 알린다(Agent가 고쳐 부른다). 「Service 붙이기」 · 「Service 고치기」가 같은 말을 한다.
pub(super) fn no_such_service(slug: &str, services: &[atelier_core::Service]) -> String {
    format!("없는 Service다: {slug} — Service(list_services): {}", listed(services.iter().map(|service| service.slug.as_str())))
}

/// 등록되지 않은 Project의 거절 — 등록된 Project를 함께 알린다. 「Service 붙이기」 · 「Project 고치기」가 같은 말을 한다.
pub(super) fn not_registered(slugs: &[&str], registered: &[atelier_core::ProjectView]) -> String {
    format!("등록되지 않은 Project다: {} — {}", slugs.join(", "), registered_list(registered))
}

/// 「등록된 Project(list_projects): web-app, api-server」.
pub(super) fn registered_list(registered: &[atelier_core::ProjectView]) -> String {
    format!("등록된 Project(list_projects): {}", listed(registered.iter().map(|view| view.project.slug.as_str())))
}

/// 지금 Service를 말하는 글 — 「지금 Service `…`(…)다」 · 「지금 Service 없이 등록된 Project N개를 모두 읽는다」.
fn now_text(scope: &ReadingScope) -> String {
    match &scope.service {
        Some(service) => format!("지금 {}다", service_name(&service.slug, &service.name)),
        None => format!("지금 Service 없이 {}", reads(scope)),
    }
}

/// Service 줄의 갈래 — 사람이 고른 것(바꿈 · 뺌 — 05)은 바뀐 범위가 가르고, 붙임(08) · 지움 · 되돌림(07)은 그 일이 정한다.
#[derive(Clone, Copy)]
enum Change<'a> {
    /// 칩 · 메뉴로 붙이고 · 바꾸고 · 뺐다 — 범위에 Service가 있으면 `changed`, 없으면 `removed`.
    Picked,
    /// Host가 묻지 않고 붙였다(「묻지 않음」 — 08) — 범위의 Service가 그것이다.
    Attached,
    /// 이은 Service가 지워졌다 — 그 Service(slug · 보이는 이름. 파일이 사라졌으면 이름도 slug다).
    Deleted { slug: &'a str, name: &'a str },
    /// 지운 Service를 되돌렸다 — 범위의 Service가 그것이다.
    Restored,
}

/// Service 줄의 payload — 갈래 · Service(slug · 이름) · 바꾸기 전 · 이은 Work · 읽는 Project의 이름 · 등록된 Project 수, 그리고 이 Work의
/// worktree에서 일하는 Project의 이름(`worked` — 있을 때만. 화면이 「web-app · api-server를 읽어요」를 이것과 읽는 Project로 짓는다).
fn service_line(change: Change, scope: &ReadingScope, before: Option<&str>, work: Option<&str>) -> Value {
    let now = scope.service.as_ref().map(|service| (service.slug.as_str(), service.name.as_str()));
    let (kind, service) = match change {
        Change::Picked if now.is_some() => ("changed", now),
        Change::Picked => ("removed", None),
        Change::Attached => ("attached", now),
        Change::Deleted { slug, name } => ("deleted", Some((slug, name))),
        Change::Restored => ("restored", now),
    };
    let mut line = json!({
        "change": kind,
        "service": service.map(|(slug, _)| slug),
        "name": service.map(|(_, name)| name),
        "before": before,
        "work": work,
        "projects": scope.projects.iter().map(|project| &project.name).collect::<Vec<_>>(),
        "registered": scope.registered,
    });
    // 비면 키를 두지 않는다 — worktree가 없는 Thread의 줄(축복한 기록)이 한 글자도 바뀌지 않는다.
    if !scope.worked.is_empty() {
        line["worked"] = json!(scope.worked.iter().map(|project| &project.name).collect::<Vec<_>>());
    }
    line
}

/// 그 slug의 Service 파일이 없다 — 지웠거나 손으로 지웠다(§7 규칙 1과 같은 셈).
fn service_gone(data_root: &std::path::Path, slug: &str) -> bool {
    atelier_core::get_service(data_root, slug).is_err()
}

/// 지우기 · 되돌리기의 거절 — 없는 Service는 붙이기와 같은 말, 그 밖(slug가 다시 쓰임 · 디스크)은 core의 글 그대로다.
fn service_error(error: atelier_core::Error) -> HostError {
    match error {
        atelier_core::Error::ServiceNotFound(slug) => HostError::ServiceNotFound(slug),
        other => HostError::Record(other.to_string()),
    }
}

/// Session이 마지막으로 들은 머리말의 「- Service:」 줄 — 보낸 말(`sent`) 가운데 머리말 블록을 실은 마지막 것에서 읽는다.
/// 이어 연 Session이 그사이 바뀐 Service를 듣게 한다(앱을 끈 동안 고친 파일도). 못 찾으면 없다 — 견주지 않는다.
pub(super) fn heard_service(lines: &[atelier_core::RecordLine]) -> Option<String> {
    lines.iter().rev().filter(|line| line.kind == atelier_core::RecordKind::Sent).find_map(|line| {
        let blocks = line.payload["prompt"].as_array()?;
        let preamble = blocks.iter().filter_map(|block| block["text"].as_str()).find(|text| text.starts_with(super::PREAMBLE_HEAD))?;
        preamble.lines().find(|row| row.starts_with("- Service:")).map(|row| format!("{row}\n"))
    })
}

/// 머리말의 「- Service:」 한 줄(§11) — Work 줄 뒤에 선다. 읽는 Project는 slug다(Thread 도구가 slug로 받는다).
pub(super) fn service_preamble(scope: &ReadingScope) -> String {
    match &scope.service {
        Some(service) => {
            let troubled = if service.troubled { " — 파일에 문제가 있어 읽을 수 있는 Project만 읽는다" } else { "" };
            let file = atelier_core::collapse_home(&service.file);
            format!("- Service: {}(`{file}`) — 읽는 Project: {}{troubled}\n", service.name, reads(scope))
        }
        None => format!("- Service: 없음 — {}\n", reads(scope)),
    }
}
