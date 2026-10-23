//! Thread 엔진 — 대화 호스트에 Thread를 자리로 더한다(v1 티켓 04 · 구현 스펙 §5 · §18).
//!
//! - **Session** 하나 = (Thread, 참여자) 하나 = Runtime 프로세스 하나 · 턴 차례 하나다. work 대화와 같은 턴 차례 · 런타임 · 로그인
//!   창구를 쓰고, 기록은 Thread의 `events.jsonl` 하나에 참여자의 handle(`who`)을 달아 함께 적는다(S8).
//! - **받는 이는 말의 첫 @멘션이다(S9, v1 티켓 13).** 멘션이 없으면 Host다. 나머지 멘션은 글자로만 남는다. 이미 참여자인
//!   이름은 범위를 다시 보지 않고 그 참여자다(스토리 52). 아니면 범위(v1 티켓 11)에서 풀고, 범위 밖 · 깨진 파일 · 겹친 맨
//!   이름이면 아무것도 적지 않고 거절한다.
//! - 받는 Agent가 아직 참여자가 아니면 들인다 — 정의 파일을 Thread 폴더에 스냅숏하고(S4) `joined` 줄 · 참여자 줄을 적은 뒤
//!   그 Agent의 새 Session을 연다. 그 Session은 스냅숏만 읽는다 — 지시문은 스냅숏의 본문, 내장 도구 · 금지는 스냅숏의
//!   frontmatter(v1 티켓 12), 모델 · 생각 깊이는 `thread.json`의 참여자 줄(들어올 때 스냅숏에서 옮겨 적고, 입력창 칩이
//!   바꾼다)이다.
//! - Agent에게 가는 말은 머리말(Session의 첫 말) + 지난 말 + 본문이다(S10). 지난 말은 보내는 그때 기록에서 짓는다(`past`).
//! - 작업 폴더는 S11 표다 — Work 없음이면 Thread 폴더, Work면 three-axes 결정 17 표(worktree가 선 Project만 센다).
//! - Thread의 Session은 spec 폴더를 찍지 않는다 — `changes` 줄이 없다. 바뀐 것은 Work 카드가 git으로 본다(v1 티켓 33 · 34).
//! - 되살리기(resume → load → 새로) · 큐 · 멈춤 · 지금 전하기 · 권한 답 · 모델 바꾸기 · 로그인 · 죽음 · 끌 때 셈은 work 대화의
//!   길 그대로다.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use atelier_core::{
    AgentDefinition, AgentProblem, AgentRoster, DefinitionSource, FoundAgent, NewThread, Participant, RecordKind, RecordLine,
    ThreadFile, ThreadIndex, ThreadSummary, Unresolved,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{
    claude_launch, end_together, find_programs, mark_taken, record_opened, ClaudeChoice, Conv, ConversationHost, Draft,
    HostError, HostEvent, QueuedMessage, Revive, Setting, CLAUDE_OPEN_LIMIT, SETTING_LIMIT,
};
use crate::discovery::{Agent, FoundProgram};
use crate::login::Waiter;
use crate::login_env::AgentEnv;
use crate::records::{heard_since_session_start, Recorder, SessionState, ThreadLog};
use crate::runtime::{self, AgentProcess, OpenError, SessionPlace};
use crate::spec_changes::Snapshot;

/// 받는 이를 고르지 않은 말을 받는 참여자 — Library의 `host.md`다(v1 구현 스펙 S9 · S14).
const HOST: &str = "host";
/// v1이 띄우는 Runtime 하나(S3).
const RUNTIME: &str = "claude-code";
/// Thread 폴더 안에서 참여자의 정의 스냅숏(`<handle>.md`)과 지시문 파일(`<handle>.instructions.md`)이 사는 폴더(S4).
const SNAPSHOTS: &str = "agents";
/// 첫 말에서 정하는 이름의 길이 한도(글자 수).
const TITLE_LIMIT: usize = 40;
/// claude `--effort`가 받는 생각 깊이(2.1.309 도움말) — 입력창 칩이 고르는 값이다.
const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// 새 Thread를 어디에 잇나(v1 구현 스펙 §5 「말 보내기」) — 새 Thread의 첫 말과 함께 받는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ThreadLink {
    /// Work 없음 — Thread 폴더에서 일한다(S11).
    NoWork,
    /// 새 Work로 시작 — 아직 Work가 없으므로 Work 없음처럼 선다. 머리말의 표시와 Work 만들기는 v1 티켓 30 · 31이 한다.
    NewWork,
    /// 이 Work — 그 Work의 자리에서 일한다. `thread.json`의 `work`에 적는다.
    Work { slug: String },
}

/// Thread 하나의 지금 — `thread.json`에 기록의 끝 · 엔진의 살아 있는 상태를 더한 것. 화면이 Thread를 열 때(다시 켠 뒤 · ⌘R 뒤)
/// 읽고, 그 뒤는 기록 줄 · 대기 줄 이벤트로 잇는다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadView {
    pub id: String,
    #[serde(flatten)]
    pub file: ThreadFile,
    /// 기록에 마지막으로 적힌 줄의 seq.
    pub last_seq: u64,
    /// 참여자의 Session 가운데 하나라도 지금 이 앱에 떠 있고 살아 있나 — 아니면 기록 끝에 열린 채 남은 턴은 끝난 프로세스의 것이다
    /// (three-axes 티켓 23의 `live`와 같은 뜻).
    pub live: bool,
    /// 참여자마다의 대기 줄 — handle → 그 Session의 대기 줄(대기 줄 바뀜 이벤트의 `who` · `queue`와 같은 열쇠 · 값). 대기 말이
    /// 있는 참여자만 칸이 선다. 메모리에만 있으므로 다시 켠 뒤에는 비어 있다.
    pub queues: BTreeMap<String, Vec<QueuedMessage>>,
}

/// 호스트가 쥔 Thread들 — 떠 있는 Session, 연 기록, 색인.
///
/// 잠금 차례는 work 대화와 같다 — 띄우기 문(`revivals`) → Session 표 → Session의 대화(`state`) → 기록. 기록 표 · 색인 ·
/// `thread.json` 잠금은 그 밖에서 잠깐씩만 쥔다.
#[derive(Default)]
pub(super) struct Threads {
    /// 떠 있는 Session들 — (Thread id, handle)로 찾는다.
    sessions: Mutex<HashMap<SessionKey, Session>>,
    /// 연 기록 — Thread마다 하나다. Session들의 쓰는 손이 쥐고, 다 놓으면 닫힌다.
    logs: Mutex<HashMap<String, Weak<ThreadLog>>>,
    /// 모든 `thread.json`의 색인 — 처음 쓸 때 한 번 읽고, 엔진이 쓸 때마다 고친다(S7).
    index: Mutex<Option<ThreadIndex>>,
    /// `thread.json`을 읽고 고쳐 쓰는 사이를 잠근다.
    files: Mutex<()>,
}

/// Session의 열쇠 — (Thread, 참여자 handle).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SessionKey {
    thread: String,
    handle: String,
}

impl SessionKey {
    fn new(thread: &str, handle: &str) -> Self {
        Self { thread: thread.to_owned(), handle: handle.to_owned() }
    }

    /// 로그인 창구에서 이 Session의 자리.
    fn waiter(&self) -> Waiter {
        Waiter::Thread { thread: self.thread.clone(), handle: self.handle.clone() }
    }

    /// 띄우기 문의 이름 — work 대화의 id(uuid)와 겹치지 않는다.
    fn gate(&self) -> String {
        format!("thread {}/{}", self.thread, self.handle)
    }
}

/// 떠 있는 Session 하나.
pub(super) struct Session {
    pub(super) agent: AgentProcess,
    pub(super) conv: Arc<Conv>,
}

impl Threads {
    fn lock_sessions(&self) -> MutexGuard<'_, HashMap<SessionKey, Session>> {
        self.sessions.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 떠 있는 Session들의 대화 — 끌 때 셈이 센다.
    pub(super) fn live_convs(&self) -> Vec<Arc<Conv>> {
        self.lock_sessions().values().map(|session| Arc::clone(&session.conv)).collect()
    }

    /// 떠 있는 Session을 모두 꺼낸다 — 호스트 끄기.
    pub(super) fn drain_sessions(&self) -> Vec<Session> {
        self.lock_sessions().drain().map(|(_, session)| session).collect()
    }

    /// 그 Session이 떠 있으면 그 대화 — 표의 잠금은 곧바로 놓는다(work 대화의 `find_live`와 같다).
    fn find(&self, key: &SessionKey) -> Option<Arc<Conv>> {
        self.lock_sessions().get(key).map(|session| Arc::clone(&session.conv))
    }

    /// 그 Thread의 떠 있는 Session들 — handle 차례.
    fn of_thread(&self, thread: &str) -> Vec<(SessionKey, Arc<Conv>)> {
        let mut found: Vec<(SessionKey, Arc<Conv>)> = self
            .lock_sessions()
            .iter()
            .filter(|(key, _)| key.thread == thread)
            .map(|(key, session)| (key.clone(), Arc::clone(&session.conv)))
            .collect();
        found.sort_by(|a, b| a.0.handle.cmp(&b.0.handle));
        found
    }

    /// 그 Session을 표에서 꺼낸다 — 꺼낸 대화라고 적는다(work 대화의 `take_live`와 같다).
    fn take(&self, key: &SessionKey) -> Option<Session> {
        let taken = self.lock_sessions().remove(key);
        mark_taken(taken.iter().map(|session| &*session.conv));
        taken
    }

    /// Session을 표에 넣는다 — 꺼냄 표시를 걷은 뒤에.
    fn put(&self, key: SessionKey, session: Session) {
        session.conv.lock_state().taken = false;
        self.lock_sessions().insert(key, session);
    }

    fn lock_logs(&self) -> MutexGuard<'_, HashMap<String, Weak<ThreadLog>>> {
        self.logs.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 그 Thread의 연 기록이 있으면 그것.
    fn held_log(&self, thread: &str) -> Option<Arc<ThreadLog>> {
        self.lock_logs().get(thread).and_then(Weak::upgrade)
    }

    fn lock_files(&self) -> MutexGuard<'_, ()> {
        self.files.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl ConversationHost {
    /// Thread 목록 — 모든 Thread의 요약, 새것부터(S7). 깨진 Thread도 까닭과 함께 선다. 읽기만 한다.
    pub fn list_threads(&self) -> Result<Vec<ThreadSummary>, HostError> {
        self.with_index(|index| index.all().to_vec())
    }

    /// Thread 하나의 지금 — `thread.json` · 기록의 끝 · 떠 있나 · 대기 줄. 읽기만 한다.
    pub fn thread(&self, thread: &str) -> Result<ThreadView, HostError> {
        let file = self.read_thread_file(thread)?;
        let mut live = false;
        let mut queues = BTreeMap::new();
        for (key, conv) in self.threads.of_thread(thread) {
            if let Some(state) = conv.lock_found() {
                live |= state.is_up();
                let queue = state.order.queue();
                if !queue.is_empty() {
                    queues.insert(key.handle, queue);
                }
            }
        }
        let last_seq = match self.threads.held_log(thread) {
            Some(log) => log.last_seq(),
            None => self.read_thread_record(thread, 0)?.last().map_or(0, |line| line.seq),
        };
        Ok(ThreadView { id: thread.to_owned(), file, last_seq, live, queues })
    }

    /// 기록 읽기 — 그 Thread의 기록에서 `after` 다음 seq의 줄들. 화면은 이것으로 그리고 그 뒤는 기록 줄 이벤트로 잇는다.
    /// 읽기만 한다 — 에이전트를 띄우지 않는다.
    pub fn read_thread_record(&self, thread: &str, after: u64) -> Result<Vec<RecordLine>, HostError> {
        atelier_core::read_thread_records(&self.data_root, thread, after).map_err(|error| thread_error(thread, error))
    }

    /// 새 Thread의 첫 말 — Thread를 세우고 받는 Agent가 들어와 답한다(S6 · S9). 받는 이는 첫 @멘션의 Agent, 없으면 Host다.
    /// 세운 Thread의 id를 돌려준다.
    ///
    /// 1. 잇는 Work가 있는지 · Claude를 찾는지 · 받는 Agent가 범위 안에서 읽히는지 먼저 본다 — 하나라도 막히면 아무것도 세우지
    ///    않는다.
    /// 2. Thread 폴더를 첫 줄(받는 Agent의 `joined`)과 함께 세운다. 이름은 첫 말의 앞부분이다.
    /// 3. 정의를 Thread 폴더에 스냅숏하고 `thread.json`에 참여자로 적는다(S4).
    /// 4. Session을 열고(S11의 작업 폴더) 머리말 + 본문을 보낸다(S10). 답은 기록 줄 이벤트로 흐른다.
    ///
    /// 막히는 호출이다 — Session이 열릴 때까지 기다린다. 세운 뒤에 Session을 열지 못하면 Thread는 남고(기록에 까닭이 선다) 그
    /// 오류를 돌려준다 — 다음 말에서 다시 띄운다.
    pub fn start_thread(&self, text: &str, link: ThreadLink) -> Result<String, HostError> {
        let work = match link {
            ThreadLink::Work { slug } => {
                self.open_work(&slug)?;
                Some(slug)
            }
            ThreadLink::NoWork | ThreadLink::NewWork => None,
        };
        let env = self.login_env(false)?;
        find_programs(Agent::Claude, &env)?;
        let Recipient::Newcomer(found) = self.recipient(&[], work.as_deref(), text)? else {
            unreachable!("새 Thread에는 참여자가 없다")
        };
        let handle = found.definition.handle.clone();
        let new = NewThread { title: title_of(text), work, mode: None };
        let created = atelier_core::create_thread(&self.data_root, new, RecordKind::Joined, Some(&handle), joined(&found))
            .map_err(|error| HostError::Record(format!("Thread를 세우지 못했습니다: {error}")))?;
        let log = Arc::new(ThreadLog::new(&self.data_root, &created.id, created.log, Arc::clone(&self.emit)));
        self.threads.lock_logs().insert(created.id.clone(), Arc::downgrade(&log));
        log.written(created.first.clone());
        self.seat(&created.id, &found, &created.first.at)?;
        self.say_in_thread(&SessionKey::new(&created.id, &handle), text)?;
        drop(log);
        Ok(created.id)
    }

    /// 보내기 — 있는 Thread에 말한다. 받는 이는 첫 @멘션의 Agent, 없으면 Host다(S9). 기다리지 않는다: 답과 턴 끝은 기록 줄
    /// 이벤트로 온다.
    ///
    /// - 멘션한 이름이 범위 밖이거나 깨졌거나 Project 여럿에 겹치면 아무것도 적지 않고 거절한다 — 그 글이 화면의 답이다.
    /// - 받는 Agent가 아직 참여자가 아니면 먼저 들인다 — 스냅숏 · `joined` 줄 · 참여자 줄. 그 Session은 새로 연다.
    /// - Session이 떠 있지 않거나 죽었으면(다시 켠 뒤 · 죽은 뒤) 먼저 띄워 되살린다 — `thread.json`의 Session id로 resume → load →
    ///   새로 순이다. 그래서 막히는 호출일 수 있다. 새로 선 Session의 첫 말에는 머리말이 다시 붙고, 지난 말은 Thread 처음부터
    ///   간다(S10).
    /// - 턴이 도는 동안의 말은 그 Session의 대기 줄에 든다(S13). 로그인을 기다리는 Session에는 보내지 않는다.
    pub fn send_to_thread(&self, thread: &str, text: &str) -> Result<(), HostError> {
        let file = self.read_thread_file(thread)?;
        let handle = match self.recipient(&file.participants, file.work.as_deref(), text)? {
            Recipient::Seated(handle) => handle,
            Recipient::Newcomer(found) => self.join(thread, &found)?,
        };
        self.say_in_thread(&SessionKey::new(thread, &handle), text)
    }

    /// 멈추기 — Thread 전체에 건다(§5): 그 Thread의 도는 턴마다 멈춤을 보낸다. 기다리지 않는다 — 멈춘 턴의 끝(`cancelled`)은
    /// 기록 줄로 온다. 도는 턴이 없으면 아무 일도 하지 않는다. 대기 줄은 거두지 않는다.
    pub fn stop_thread(&self, thread: &str) -> Result<(), HostError> {
        for (_, conv) in self.threads.of_thread(thread) {
            let Some(mut state) = conv.lock_found() else { continue };
            conv.seat(&mut state).stop().map_err(|refused| refused.into_host(thread))?;
        }
        Ok(())
    }

    /// 대기 고치기 — 그 대기 id의 말의 글을 바꾸고 대기 줄 바뀜을 낸다.
    pub fn edit_thread_queued(&self, thread: &str, queued: &str, text: &str) -> Result<(), HostError> {
        let not_found = || HostError::QueuedNotFound(queued.to_owned());
        let (_, conv) = self.holding(thread, queued).ok_or_else(not_found)?;
        let mut state = conv.lock_found().ok_or_else(not_found)?;
        conv.seat(&mut state).edit(queued, text).map_err(|refused| refused.into_host(thread))
    }

    /// 대기 지우기 — 그 대기 id의 말을 빼고 대기 줄 바뀜을 낸다.
    pub fn delete_thread_queued(&self, thread: &str, queued: &str) -> Result<(), HostError> {
        let not_found = || HostError::QueuedNotFound(queued.to_owned());
        let (_, conv) = self.holding(thread, queued).ok_or_else(not_found)?;
        let mut state = conv.lock_found().ok_or_else(not_found)?;
        conv.seat(&mut state).delete(queued).map_err(|refused| refused.into_host(thread))
    }

    /// 지금 전하기 — 그 말을 맨 앞에 세우고 그 Session의 도는 턴을 멈춘다. 턴이 `cancelled`로 끝나면 그 말이 먼저 간다(`sent`의
    /// `sendNow`가 true). 죽은 Session이면 먼저 되살려 곧바로 보낸다 — 막히는 호출일 수 있다.
    pub fn send_thread_now(&self, thread: &str, queued: &str) -> Result<(), HostError> {
        if let Some((key, conv)) = self.holding(thread, queued) {
            let dead = conv.lock_found().is_some_and(|state| !state.is_up());
            if dead && self.logins.waiting_for(&key.waiter()).is_none() {
                self.revive_session(&key, Revive::IfNotRunning)?;
            }
        }
        let not_found = || HostError::QueuedNotFound(queued.to_owned());
        let (_, conv) = self.holding(thread, queued).ok_or_else(not_found)?;
        let mut state = conv.lock_found().ok_or_else(not_found)?;
        conv.seat(&mut state).send_now(queued).map_err(|refused| refused.into_host(thread))
    }

    /// 권한 답 — 그 참여자(`who` — `permission` 줄의 `who`)의 Session에 걸린 요청에 고른 선택지로 답한다. 요청 id는 Session마다
    /// 따로 센다. 기다리지 않는다.
    pub fn answer_thread_permission(
        &self,
        thread: &str,
        who: &str,
        request: &str,
        option: &str,
    ) -> Result<(), HostError> {
        let closed = || HostError::PermissionClosed { conversation: thread.to_owned(), request: request.to_owned() };
        let conv = self.threads.find(&SessionKey::new(thread, who)).ok_or_else(closed)?;
        let mut state = conv.lock_found().ok_or_else(closed)?;
        conv.seat(&mut state).answer(request, option).map_err(|refused| refused.into_host(thread))
    }

    /// 모델 바꾸기 — 그 참여자의 모델을 바꾼다(스토리 33). 규칙은 work 대화의 모델 바꾸기와 같다.
    ///
    /// - Session이 떠 있으면 곧바로 넣고 답을 기다린다 — 다음 턴부터 든다. 넣은 바꾸기는 `config` 줄로 남는다.
    /// - 떠 있지 않으면 `thread.json`의 참여자 줄에만 남고, 띄울 때 플래그로 준다.
    ///
    /// 답은 바뀐 참여자 줄이다. 막히는 호출이다 — 엔진의 답을 기다린다(한도 10초). 되살리는 중이면 그 끝을 기다린다.
    pub fn set_thread_model(&self, thread: &str, who: &str, model: &str) -> Result<Participant, HostError> {
        let key = SessionKey::new(thread, who);
        let gate = self.revival_gate(&key.gate());
        let _not_while_reviving = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        self.participant(thread, who)?;
        let running = self.threads.find(&key).and_then(|conv| {
            let turns = {
                let state = conv.lock_found()?;
                state.turns.clone().filter(|_| state.order.alive())
            }?;
            Some((conv, turns))
        });
        let _one_at_a_time = running.as_ref().map(|(conv, _)| conv.setting.lock().unwrap_or_else(|p| p.into_inner()));
        let setting = Setting::Model(model.to_owned());
        if let Some((_, turns)) = &running {
            let (method, fields) = setting.request();
            turns.change(method, fields, SETTING_LIMIT).map_err(HostError::Setting)?;
        }
        let file = self.change_thread(thread, |file| {
            if let Some(participant) = file.participants.iter_mut().find(|participant| participant.handle == who) {
                participant.model = Some(model.to_owned());
            }
        })?;
        if let Some((conv, _)) = &running {
            conv.recorder.config(setting.changed()).map_err(HostError::Record)?;
        }
        participant_of(&file, thread, who)
    }

    /// 생각 깊이 바꾸기(v1 티켓 05 · 스토리 33) — 그 참여자의 생각 깊이(claude `--effort`의 값 하나)를 바꾼다. claude는 떠 있는
    /// Session의 생각 깊이를 바꾸는 요청이 없어 플래그로만 받는다. 그래서 모델 바꾸기와 길이 갈린다.
    ///
    /// - 떠 있지 않으면 `thread.json`의 참여자 줄에만 남고, 띄울 때 플래그로 준다.
    /// - 떠 있고 쉬면 같은 Session으로 다시 띄운다(`--resume` + 새 `--effort`) — 다음 턴부터 든다. 넣은 바꾸기는 `config` 줄로 남는다.
    /// - 턴이 도는 동안은 거절한다 — 다시 띄우면 그 턴이 끊긴다. 입력창 칩도 그동안 잠긴다.
    ///
    /// 답은 바뀐 참여자 줄이다. 다시 띄우면 막히는 호출이다(Session이 열릴 때까지).
    pub fn set_thread_effort(&self, thread: &str, who: &str, effort: &str) -> Result<Participant, HostError> {
        if !EFFORTS.contains(&effort) {
            return Err(HostError::Setting(format!("모르는 생각 깊이입니다: {effort}")));
        }
        self.participant(thread, who)?;
        let key = SessionKey::new(thread, who);
        let up = match self.threads.find(&key) {
            Some(conv) => {
                let state = conv.lock_found();
                if state.as_ref().is_some_and(|state| state.order.turning()) {
                    return Err(HostError::Setting("턴이 도는 동안에는 생각 깊이를 바꿀 수 없습니다".into()));
                }
                state.is_some_and(|state| state.is_up())
            }
            None => false,
        };
        let file = self.change_thread(thread, |file| {
            if let Some(participant) = file.participants.iter_mut().find(|participant| participant.handle == who) {
                participant.effort = Some(effort.to_owned());
            }
        })?;
        if up {
            self.relaunch_session(thread, who)?;
            if let Some(conv) = self.threads.find(&key) {
                conv.recorder.config(json!({"effort": effort})).map_err(HostError::Record)?;
            }
        }
        participant_of(&file, thread, who)
    }

    /// 이름 바꾸기 — 사람이 위 막대에서 고친 이름(v1 티켓 05 · 구현 스펙 §14 · §18). `thread.json`의 `title`을 고치고 목록 요약을
    /// 알리고, `title` 줄을 남긴다 — 사람의 줄이라 `who`가 없다(S8). payload는 `{title, before}`다(흐름의 시스템 줄 「Thread 이름을
    /// … 로 바꿈」이 이것을 읽는다).
    ///
    /// - 줄바꿈 · 앞뒤 빈칸은 걷어 한 줄로 둔다. 빈 이름은 거절하고 아무것도 바꾸지 않는다.
    /// - 같은 이름이면 아무것도 쓰지 않는다 — 고치는 칸을 그대로 닫아도 줄이 쌓이지 않는다.
    /// - Session을 띄우지 않는다. 머리말의 제목은 다음에 여는 Session부터 바뀐다(S10).
    ///
    /// 답은 바뀐 목록 요약이다.
    pub fn rename_thread(&self, thread: &str, title: &str) -> Result<ThreadSummary, HostError> {
        let title = one_line(title);
        if title.is_empty() {
            return Err(HostError::BadTitle);
        }
        if self.read_thread_file(thread)?.title != title {
            let log = self.thread_log(thread)?;
            let mut before = String::new();
            self.change_thread(thread, |file| before = std::mem::replace(&mut file.title, title.clone()))?;
            log.write(RecordKind::Title, None, json!({"title": title, "before": before})).map_err(HostError::Record)?;
        }
        self.with_index(|index| index.all().iter().find(|summary| summary.id == thread).cloned())?
            .ok_or_else(|| HostError::ThreadNotFound(thread.to_owned()))
    }

    /// 로그인을 기다리던 Session을 다시 띄운다(three-axes 티켓 12의 길) — 떠 있으면 끄고 새로, 같은 Session id로 이어 연다. 대기
    /// 줄은 걸림이 풀린 이 자리에서 맨 앞부터 간다. Thread가 사라졌으면 아무것도 하지 않는다.
    pub(super) fn relaunch_session(&self, thread: &str, handle: &str) -> Result<(), HostError> {
        let key = SessionKey::new(thread, handle);
        match self.revive_session(&key, Revive::EvenIfRunning) {
            Err(HostError::ThreadNotFound(_)) => return Ok(()),
            revived => revived?,
        }
        if let Some(conv) = self.threads.find(&key) {
            if let Some(mut state) = conv.lock_found() {
                conv.seat(&mut state).resume();
            }
        }
        Ok(())
    }

    /// 받는 이의 Session에 말을 보낸다 — 떠 있지 않으면 먼저 띄운다. 머리말은 지금 짓는다: 대기 줄에 들어 턴 끝에 가는 말도 그
    /// 머리말을 들고 간다(턴 끝에서는 `thread.json`을 읽지 않는다).
    fn say_in_thread(&self, key: &SessionKey, text: &str) -> Result<(), HostError> {
        if !self.session_running(key) && self.logins.waiting_for(&key.waiter()).is_none() {
            self.revive_session(key, Revive::IfNotRunning)?;
        }
        let draft = Draft { text: text.to_owned(), preamble: self.thread_preamble(key)?, quote: None };
        let found = self.threads.find(key);
        let Some((conv, mut state)) = found.as_ref().and_then(|conv| conv.lock_found().map(|state| (conv, state))) else {
            return Err(match self.logins.waiting_for(&key.waiter()) {
                Some(agent) => HostError::LoginRequired { agent, conversation: key.thread.clone() },
                None => HostError::NotRunning(key.thread.clone()),
            });
        };
        conv.seat(&mut state).say(draft, Snapshot::empty()).map_err(|refused| refused.into_host(&key.thread))
    }

    /// 떠 있지 않거나 죽은 Session을 띄워 되살린다 — work 대화의 [`ConversationHost::revive`]와 같은 길이다. `thread.json`의
    /// Session id로 resume → load → 새로 순이고, 떠 있던(죽은) Session은 쓰는 손과 대기 줄을 그대로 이어 쓴다. 다시 뜨지 못하면
    /// 대기 줄은 사라지고, 화면이 옛 줄을 붙들지 않게 빈 대기 줄을 알린다.
    fn revive_session(&self, key: &SessionKey, when: Revive) -> Result<(), HostError> {
        let gate = self.revival_gate(&key.gate());
        let _one_at_a_time = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if when == Revive::IfNotRunning && self.session_running(key) {
            return Ok(());
        }
        let file = self.read_thread_file(&key.thread)?;
        let participant = participant_of(&file, &key.thread, &key.handle)?;
        let env = self.login_env(false)?;
        let programs = find_programs(Agent::Claude, &env)?;
        let conv = match self.threads.take(key) {
            Some(mut session) => {
                end_together(vec![(&mut session.agent, &*session.conv)]);
                session.conv
            }
            None => self.session_conv(key)?,
        };
        let queued = conv.lock_state().order.queued() > 0;
        let opened = self.open_session(key, &file, &participant, Arc::clone(&conv), &env, &programs);
        if queued && self.threads.find(key).is_none() {
            conv.recorder.queue_changed(Vec::new());
        }
        opened
    }

    /// Session의 Runtime을 띄워 연다 — S11의 작업 폴더에서, 스냅숏의 지시문 · 내장 도구 · 금지(v1 티켓 12)와 참여자 줄의 모델 ·
    /// 생각 깊이로. 열리면 Session id · 작업 폴더를 참여자 줄에 적고 떠 있는 표에 넣는다.
    ///
    /// - Runtime이 로그인을 요구하면 로그인 필요 줄을 적고 로그인 창구가 그 Session을 쥔다 — 실패가 아니다.
    /// - 그 밖의 까닭으로 못 열면 죽음 줄에 까닭을 적고 실패한다.
    fn open_session(
        &self,
        key: &SessionKey,
        file: &ThreadFile,
        participant: &Participant,
        conv: Arc<Conv>,
        env: &AgentEnv,
        programs: &[FoundProgram],
    ) -> Result<(), HostError> {
        let place = self.thread_place(&key.thread, file.work.as_deref())?;
        let (definition, instructions) = self.read_snapshot(key)?;
        let recorder = &conv.recorder;
        recorder.session(SessionState::Spawning).map_err(HostError::Record)?;
        let choice = ClaudeChoice {
            mode: None,
            model: participant.model.clone(),
            effort: participant.effort.clone(),
            instructions: Some(instructions),
            tools: definition.tools.builtin,
            forbid: definition.policy.forbid,
        };
        let (launch, mut terms) = claude_launch(&self.translator, programs, env, &place, &choice);
        // 참여자의 Session id가 있으면 되살린다 — 다시 켠 뒤 · 죽은 뒤 · 로그인 뒤. 처음 여는 Session은 곧바로 새로다.
        terms.revive = participant.session_id.clone();
        let limit = self.open_limit.unwrap_or(CLAUDE_OPEN_LIMIT);
        let at = SessionPlace { cwd: place.cwd.clone(), additional_directories: place.additional_directories.clone() };
        let opened = runtime::open(launch, at, terms, limit, conv.sink(), record_opened(&conv, Agent::Claude));
        let (agent, opened) = match opened {
            Ok(opened) => opened,
            Err(OpenError::AuthRequired { .. }) => {
                recorder.session(SessionState::LoginRequired).map_err(HostError::Record)?;
                self.logins.login_required(Agent::Claude, key.waiter());
                return Ok(());
            }
            Err(error) => {
                let reason = error.to_string();
                recorder
                    .session(SessionState::Died { reason: reason.clone(), stderr_tail: Vec::new() })
                    .map_err(HostError::Record)?;
                return Err(HostError::Open { conversation: key.thread.clone(), reason });
            }
        };
        // 그 Session의 첫 말이면 머리말을 붙인다(S10) — 새로 섰거나, 되살린 Session이 아직 말을 받은 적이 없다.
        let heard = self.read_thread_record(&key.thread, 0)?;
        let needs_preamble = opened.how.starts_session() || !heard_since_session_start(&heard, &key.handle);
        {
            let mut state = conv.lock_state();
            state.order.opened(needs_preamble);
            state.turns = agent.turns();
        }
        // 기록의 자리를 알려고 cwd를 쓰지 않는다 — Runtime은 Session id만으로 이어 연다(S11). 그래서 지금 작업 폴더를 적는다.
        self.change_thread(&key.thread, |file| {
            if let Some(slot) = file.participants.iter_mut().find(|slot| slot.handle == key.handle) {
                slot.session_id = Some(opened.session_id.clone());
                slot.cwd = Some(place.cwd.clone());
                slot.additional_directories = place.additional_directories.clone();
            }
        })?;
        self.threads.put(key.clone(), Session { agent, conv });
        Ok(())
    }

    /// 그 Session이 떠 있고 살아 있나 — 아니면 보내기가 먼저 되살린다.
    fn session_running(&self, key: &SessionKey) -> bool {
        self.threads.find(key).is_some_and(|conv| conv.lock_found().is_some_and(|state| state.is_up()))
    }

    /// 떠 있을 Session의 대화 — 그 Thread의 기록에 그 handle로 적고, 턴 도중의 로그인 요구를 창구에 쥐게 한다. spec 폴더를
    /// 찍지 않고, 사라진 Work를 지켜보지 않는다(보관된 Work의 Thread는 v1 티켓 38).
    fn session_conv(&self, key: &SessionKey) -> Result<Arc<Conv>, HostError> {
        let recorder = Recorder::of_thread(self.thread_log(&key.thread)?, &key.handle);
        Ok(Conv::new(recorder, None, None, Some(self.login_watch(Agent::Claude, key.waiter()))))
    }

    /// 그 Thread의 기록 — 연 것이 있으면 그것, 없으면 이어 열어 쥔다. Thread 폴더를 만들지 않는다.
    fn thread_log(&self, thread: &str) -> Result<Arc<ThreadLog>, HostError> {
        let mut logs = self.threads.lock_logs();
        if let Some(log) = logs.get(thread).and_then(Weak::upgrade) {
            return Ok(log);
        }
        let opened = atelier_core::open_thread_log(&self.data_root, thread).map_err(|error| thread_error(thread, error))?;
        let log = Arc::new(ThreadLog::new(&self.data_root, thread, opened, Arc::clone(&self.emit)));
        logs.retain(|_, held| held.strong_count() > 0);
        logs.insert(thread.to_owned(), Arc::downgrade(&log));
        Ok(log)
    }

    /// 그 대기 id의 말을 쥔 Session.
    fn holding(&self, thread: &str, queued: &str) -> Option<(SessionKey, Arc<Conv>)> {
        self.threads
            .of_thread(thread)
            .into_iter()
            .find(|(_, conv)| conv.lock_found().is_some_and(|state| state.order.contains(queued)))
    }

    /// 말을 받는 이(S9) — 첫 @멘션의 이름, 없으면 Host다. 읽기만 한다.
    ///
    /// - 이미 참여자인 이름이면 그 참여자다 — 범위를 다시 보지 않는다. 정의 파일이 바뀌거나 지워져도, Work가 붙어 같은 handle의
    ///   Project 정의가 보여도 처음 들어온 정의 그대로 이어 쓴다(S4 · 스토리 52).
    /// - 아니면 이 Thread의 범위(`work`가 없으면 Library만)에서 푼다(v1 티켓 11). 없음 · 겹친 맨 이름 · 깨진 파일은 거절이다.
    /// - 멘션은 이름 글자가 이어지는 데까지 읽고, 그 가운데 **가장 긴 앞부분**이 아는 이름이면 그것이다 — 「@reviewer가 봐 줘」의
    ///   `가`처럼 이름에 붙은 조사를 떼어 낸다([`first_mention`]).
    fn recipient(&self, seated: &[Participant], work: Option<&str>, text: &str) -> Result<Recipient, HostError> {
        let Some(mention) = first_mention(text) else {
            if seated.iter().any(|participant| participant.handle == HOST) {
                return Ok(Recipient::Seated(HOST.to_owned()));
            }
            // Host는 Library에만 있다 — 이은 Work의 범위를 읽지 않는다(사라진 Work의 Thread도 Host는 부른다).
            let roster = self.agents_in_scope(None)?;
            let host = newcomer(&roster, seated, HOST)?;
            return host.map(Recipient::Newcomer).ok_or_else(|| HostError::AgentBroken {
                handle: HOST.to_owned(),
                reason: "Library에 host.md가 없습니다".to_owned(),
            });
        };
        let mut roster = None;
        for call in name_prefixes(mention) {
            if let Some(participant) = seated.iter().find(|participant| answers_to(participant, call)) {
                return Ok(Recipient::Seated(participant.handle.clone()));
            }
            let roster = match &roster {
                Some(roster) => roster,
                None => roster.insert(self.agents_in_scope(work)?),
            };
            if let Some(found) = newcomer(roster, seated, call)? {
                return Ok(Recipient::Newcomer(found));
            }
        }
        Err(HostError::AgentNotFound { call: mention.to_owned(), work: work.map(str::to_owned) })
    }

    /// 범위 안의 Agent — 기본 파일이 지워졌으면 다시 세운 뒤에 찾는다. 앱이 뜰 때와 같은 규칙이고, 있는 파일은 덮지 않는다
    /// (S14). 이은 Work가 사라졌으면 `WorkNotFound`다 — Library로 줄여 답하지 않는다(v1 티켓 11).
    fn agents_in_scope(&self, work: Option<&str>) -> Result<AgentRoster, HostError> {
        if let Err(error) = atelier_core::ensure_default_agents(&self.data_root) {
            eprintln!("Library의 기본 Agent를 세우지 못했습니다: {error}");
        }
        atelier_core::find_agents(&self.data_root, work).map_err(|error| match error {
            atelier_core::Error::WorkNotFound(slug) => HostError::WorkNotFound(slug),
            other => HostError::Record(format!("Agent를 찾지 못했습니다: {other}")),
        })
    }

    /// 아직 참여자가 아닌 Agent를 Thread에 들인다 — `joined` 줄을 적고 정의를 스냅숏한다(S4). 들인 handle을 돌려준다.
    ///
    /// 그 handle의 띄우기 문을 쥔 채 `thread.json`을 다시 읽는다 — 같은 Agent를 멘션한 말 둘이 엇갈려도 한 번만 들어온다.
    fn join(&self, thread: &str, found: &FoundAgent) -> Result<String, HostError> {
        let handle = found.definition.handle.clone();
        let gate = self.revival_gate(&SessionKey::new(thread, &handle).gate());
        let _one_at_a_time = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.read_thread_file(thread)?.participants.iter().any(|participant| participant.handle == handle) {
            return Ok(handle);
        }
        let line = self.thread_log(thread)?.write(RecordKind::Joined, Some(&handle), joined(found)).map_err(HostError::Record)?;
        self.seat(thread, found, &line.at)?;
        Ok(handle)
    }

    /// Agent를 Thread에 앉힌다 — 정의 파일을 Thread 폴더에 스냅숏하고(S4) `thread.json`에 참여자로 적는다. 정의가 온 곳은 범위가
    /// 준 그대로(Library · Project)이고, 모델 · 생각 깊이는 스냅숏의 것을 옮겨 적는다. `joined` 줄은 부르는 쪽이 먼저 적었다.
    fn seat(&self, thread: &str, found: &FoundAgent, joined_at: &str) -> Result<(), HostError> {
        let definition = &found.definition;
        let snapshots = self.snapshots(thread)?;
        std::fs::create_dir_all(&snapshots)
            .and_then(|()| std::fs::copy(&found.path, snapshots.join(format!("{}.md", definition.handle))))
            .map_err(|error| HostError::Record(format!("@{}의 정의를 스냅숏하지 못했습니다: {error}", definition.handle)))?;
        let participant = Participant {
            handle: definition.handle.clone(),
            from: Some(found.from.clone()),
            joined_at: joined_at.to_owned(),
            runtime: RUNTIME.to_owned(),
            session_id: None,
            cwd: None,
            additional_directories: Vec::new(),
            model: definition.model.prefer.clone(),
            effort: definition.model.effort.clone(),
            extra: Default::default(),
        };
        self.change_thread(thread, |file| file.participants.push(participant)).map(drop)
    }

    /// 그 참여자의 정의 스냅숏과 지시문 파일 — Session을 열 때마다 스냅숏을 읽어 지시문 파일을 다시 짓는다. 정의는 스냅숏에서만
    /// 읽고(§19), 지운 지시문 파일도 다음 열기에 다시 선다. 내장 도구 · 금지도 여기서 읽는다(v1 티켓 12) — 이어 열 때마다 다시
    /// 싣는다.
    ///
    /// 지시문 파일은 본문만 담는다(v1 티켓 03: frontmatter가 시스템 프롬프트에 들지 않게).
    fn read_snapshot(&self, key: &SessionKey) -> Result<(AgentDefinition, PathBuf), HostError> {
        let snapshots = self.snapshots(&key.thread)?;
        let definition = atelier_core::read_agent(&snapshots.join(format!("{}.md", key.handle)))
            .map_err(|problem| HostError::AgentBroken { handle: key.handle.clone(), reason: problem_text(problem) })?;
        let path = snapshots.join(format!("{}.instructions.md", key.handle));
        std::fs::write(&path, &definition.instructions)
            .map_err(|error| HostError::Record(format!("지시문 파일을 쓰지 못했습니다: {} — {error}", path.display())))?;
        Ok((definition, path))
    }

    fn snapshots(&self, thread: &str) -> Result<PathBuf, HostError> {
        Ok(atelier_core::thread_dir(&self.data_root, thread).map_err(|error| thread_error(thread, error))?.join(SNAPSHOTS))
    }

    /// Thread의 작업 폴더(v1 구현 스펙 S11).
    ///
    /// | 이어진 곳 | cwd | 함께 여는 폴더 |
    /// |---|---|---|
    /// | Work 없음 | Thread 폴더 | — |
    /// | worktree가 선 Project가 없는 Work | spec 폴더 | — |
    /// | worktree 하나 | 그 worktree | spec 폴더 |
    /// | worktree 여럿 | `trees/` | spec 폴더 |
    fn thread_place(&self, thread: &str, work: Option<&str>) -> Result<SessionPlace, HostError> {
        let Some(slug) = work else {
            let cwd = atelier_core::thread_dir(&self.data_root, thread).map_err(|error| thread_error(thread, error))?;
            return Ok(SessionPlace { cwd, additional_directories: Vec::new() });
        };
        let work_at = self.open_work(slug)?;
        let trees: Vec<&PathBuf> = work_at.places.worktrees.iter().filter(|tree| tree.is_dir()).collect();
        let cwd = match trees.as_slice() {
            [] => return Ok(SessionPlace { cwd: work_at.places.spec.clone(), additional_directories: Vec::new() }),
            [tree] => (*tree).clone(),
            _ => work_at.places.trees.clone(),
        };
        Ok(SessionPlace { cwd, additional_directories: vec![work_at.places.spec.clone()] })
    }

    /// 머리말(v1 구현 스펙 S10) — Thread id · 제목, 이 Agent의 handle, 참여자, 이어진 Work(slug · 제목 · spec 폴더 · Project마다
    /// worktree 또는 「읽기만」). Session의 첫 말과 새로 연 뒤의 첫 말에 따로 된 텍스트 블록으로 붙는다. 화면은 그리지 않고
    /// `sent` 줄의 `prompt`에만 남는다. 도구를 쓰는 법은 Thread 도구가 서면(v1 티켓 15) 여기 더한다(S42).
    fn thread_preamble(&self, key: &SessionKey) -> Result<Value, HostError> {
        let file = self.read_thread_file(&key.thread)?;
        let participants: Vec<String> =
            file.participants.iter().map(|participant| format!("`@{}`", participant.handle)).collect();
        let mut text = format!(
            "Atelier Thread 안에서 열린 Session이다.\n\n- Thread id: `{}`\n- 제목: {}\n- 너의 handle: `@{}`\n- 참여자: {}\n",
            key.thread,
            file.title,
            key.handle,
            participants.join(", ")
        );
        match &file.work {
            None => {
                let dir = atelier_core::thread_dir(&self.data_root, &key.thread).map_err(|error| thread_error(&key.thread, error))?;
                text.push_str(&format!("- Work: 없음 — 이 Thread 폴더에서 일한다: `{}`\n", dir.display()));
            }
            Some(slug) => match self.open_work(slug) {
                Ok(work_at) => {
                    text.push_str(&format!(
                        "- Work: `{slug}` — {}\n  - spec 폴더(specDir): `{}`\n",
                        work_at.meta.title,
                        work_at.places.spec.display()
                    ));
                    for (project, tree) in work_at.meta.projects.iter().zip(&work_at.places.worktrees) {
                        if tree.is_dir() {
                            text.push_str(&format!("  - Project `{project}`: worktree `{}`\n", tree.display()));
                        } else {
                            text.push_str(&format!("  - Project `{project}`: 읽기만 — worktree가 아직 없다\n"));
                        }
                    }
                }
                Err(_) => text.push_str(&format!("- Work: `{slug}` — 찾을 수 없다\n")),
            },
        }
        Ok(json!({"type": "text", "text": text}))
    }

    fn read_thread_file(&self, thread: &str) -> Result<ThreadFile, HostError> {
        atelier_core::read_thread(&self.data_root, thread).map_err(|error| thread_error(thread, error))
    }

    fn participant(&self, thread: &str, handle: &str) -> Result<Participant, HostError> {
        participant_of(&self.read_thread_file(thread)?, thread, handle)
    }

    /// `thread.json`을 고쳐 쓰고 색인을 고친다. 목록 요약이 바뀌었으면 알린다(S7 — 감시가 없으므로 엔진이 알린다).
    fn change_thread(&self, thread: &str, change: impl FnOnce(&mut ThreadFile)) -> Result<ThreadFile, HostError> {
        // 색인을 먼저 쥔다 — 처음 읽는 색인이 고친 뒤의 파일을 읽으면 바뀜을 못 본다.
        self.with_index(|_| ())?;
        let file = {
            let _file = self.threads.lock_files();
            atelier_core::update_thread(&self.data_root, thread, change).map_err(|error| thread_error(thread, error))?
        };
        let changed = self.with_index(|index| {
            let before = index.all().iter().find(|summary| summary.id == thread).cloned();
            index.put(thread, &file);
            let after = index.all().iter().find(|summary| summary.id == thread).cloned();
            after.filter(|after| before.as_ref() != Some(after))
        })?;
        if let Some(summary) = changed {
            (self.emit)(HostEvent::ThreadList(summary));
        }
        Ok(file)
    }

    /// 색인 — 처음 쓸 때 모든 `thread.json`을 한 번 읽는다(S7).
    fn with_index<T>(&self, use_it: impl FnOnce(&mut ThreadIndex) -> T) -> Result<T, HostError> {
        let mut held = self.threads.index.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if held.is_none() {
            let loaded = ThreadIndex::load(&self.data_root)
                .map_err(|error| HostError::Record(format!("Thread 목록을 읽지 못했습니다: {error}")))?;
            *held = Some(loaded);
        }
        Ok(use_it(held.as_mut().expect("방금 읽었다")))
    }
}

/// 말을 받는 이(S9).
enum Recipient {
    /// 이미 참여자인 Agent — 그 handle.
    Seated(String),
    /// 아직 참여자가 아닌 범위 안의 Agent — 들인 뒤에 받는다.
    Newcomer(FoundAgent),
}

/// 범위에서 그 이름의 Agent — 범위에 없으면 `None`이다. 겹친 맨 이름 · 깨진 파일은 거절이고, 이미 앉은 다른 Agent와 handle이
/// 같아도 들일 수 없다(Session은 (Thread, handle)마다 하나다).
fn newcomer(roster: &AgentRoster, seated: &[Participant], call: &str) -> Result<Option<FoundAgent>, HostError> {
    let found = match roster.resolve(call) {
        Ok(found) => found,
        Err(Unresolved::NotFound) => return Ok(None),
        Err(Unresolved::Ambiguous { calls }) => return Err(HostError::AgentAmbiguous { call: call.to_owned(), calls }),
        Err(Unresolved::Broken(problem)) => {
            return Err(HostError::AgentBroken { handle: call.to_owned(), reason: problem_text(problem) })
        }
    };
    let handle = &found.definition.handle;
    if seated.iter().any(|participant| &participant.handle == handle) {
        return Err(HostError::HandleTaken { call: call.to_owned(), handle: handle.clone() });
    }
    Ok(Some(found.clone()))
}

/// 그 참여자를 이 이름으로 부르나 — handle 그대로, 또는 Project에서 온 참여자면 `project/handle`.
fn answers_to(participant: &Participant, call: &str) -> bool {
    match (&participant.from, call.split_once('/')) {
        (_, None) => participant.handle == call,
        (Some(DefinitionSource::Project(project)), Some((named, handle))) => project == named && participant.handle == handle,
        _ => false,
    }
}

/// 말의 첫 @멘션 — `@` 뒤에 이어진 이름 글자들(S9). 없으면 `None`이다.
///
/// - `@`가 말의 처음이거나 이름 글자가 아닌 것 뒤에 설 때만 멘션이다 — `a@b.com`은 멘션이 아니다.
/// - 백틱 안(인라인 코드 · 코드 블록)의 `@`는 멘션이 아니다 — 붙여 넣은 코드의 `@media` · `@tauri-apps/api`가 받는 이를 바꾸거나
///   말을 거절시키지 않게.
/// - 이름 글자는 글자 · 숫자와 `_` `-` `.` `/`(`project/handle`)이다. 끝의 `.` `-` `/`는 문장 부호로 보고 뗀다. 이름에 붙은
///   조사(「@reviewer가」)는 여기서 떼지 않는다 — 받는 이를 고를 때 아는 이름의 가장 긴 앞부분으로 고른다([`name_prefixes`]).
fn first_mention(text: &str) -> Option<&str> {
    let mut before: Option<char> = None;
    let mut in_code = false;
    for (at, c) in text.char_indices() {
        if c == '`' {
            in_code = !in_code;
        } else if c == '@' && !in_code && !before.is_some_and(is_name_char) {
            let rest = &text[at + c.len_utf8()..];
            let end = rest.find(|c: char| !is_name_char(c)).unwrap_or(rest.len());
            let name = rest[..end].trim_end_matches(['.', '-', '/']);
            if !name.is_empty() {
                return Some(name);
            }
        }
        before = Some(c);
    }
    None
}

fn is_name_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | '/')
}

/// 멘션한 이름과 그 앞부분들 — 긴 것부터. 받는 이는 이 가운데 처음으로 아는 이름이다.
fn name_prefixes(name: &str) -> impl Iterator<Item = &str> {
    let ends: Vec<usize> = name.char_indices().map(|(at, c)| at + c.len_utf8()).rev().collect();
    ends.into_iter().map(move |end| &name[..end])
}

/// `joined` 줄의 payload — 들어온 참여자와 정의가 온 곳(Library · Project).
fn joined(found: &FoundAgent) -> Value {
    json!({"handle": found.definition.handle, "name": found.definition.name, "from": found.from})
}

/// 첫 말에서 정하는 이름 — 비지 않은 첫 줄, 길면 앞 [`TITLE_LIMIT`]글자에 말줄임표.
fn title_of(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default();
    if line.chars().count() <= TITLE_LIMIT {
        return line.to_owned();
    }
    format!("{}…", line.chars().take(TITLE_LIMIT).collect::<String>())
}

/// 사람이 고친 이름 — 줄마다 앞뒤 빈칸을 걷고 빈 줄을 버린 뒤 빈칸 하나로 잇는다.
fn one_line(text: &str) -> String {
    text.lines().map(str::trim).filter(|line| !line.is_empty()).collect::<Vec<_>>().join(" ")
}

fn participant_of(file: &ThreadFile, thread: &str, handle: &str) -> Result<Participant, HostError> {
    file.participants
        .iter()
        .find(|participant| participant.handle == handle)
        .cloned()
        .ok_or_else(|| HostError::ParticipantNotFound { thread: thread.to_owned(), handle: handle.to_owned() })
}

/// 깨진 Agent 파일의 까닭을 사람이 읽을 글로.
fn problem_text(problem: AgentProblem) -> String {
    match problem {
        AgentProblem::Unreadable { message } => message,
        AgentProblem::UnknownTool { tool } => format!("모르는 도구입니다: {tool}"),
        AgentProblem::RuntimeNotAccepted => "runtimes가 claude-code를 받지 않습니다".to_owned(),
        // 범위 찾기(v1 티켓 11)에서만 나는 까닭이다 — Project 안의 `host.md`를 `@project/host`로 멘션했다.
        AgentProblem::HostOutsideLibrary => "host는 Library에만 둘 수 있습니다".to_owned(),
    }
}

/// 코어의 Thread 오류 → 화면의 오류. id의 꼴이 아니거나 폴더 · 파일이 없으면 그 Thread는 없다.
fn thread_error(thread: &str, error: atelier_core::Error) -> HostError {
    match error {
        atelier_core::Error::Validation(_) => HostError::ThreadNotFound(thread.to_owned()),
        atelier_core::Error::Io(error) if error.kind() == std::io::ErrorKind::NotFound => {
            HostError::ThreadNotFound(thread.to_owned())
        }
        other => HostError::Record(format!("Thread를 읽거나 쓰지 못했습니다: {thread} — {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 이름은_첫_말의_비지_않은_첫_줄이고_길면_앞_마흔_글자에_말줄임표를_단다() {
        assert_eq!(title_of("\n  장바구니 버그 고쳐 줘  \n자세히는 이렇고"), "장바구니 버그 고쳐 줘");
        let long = "가".repeat(41);
        assert_eq!(title_of(&long), format!("{}…", "가".repeat(40)));
        assert_eq!(title_of(&"가".repeat(40)), "가".repeat(40), "마흔 글자는 그대로다");
        assert_eq!(title_of("   \n"), "");
    }

    #[test]
    fn 첫_멘션은_말의_처음이나_이름_글자가_아닌_것_뒤의_at이고_백틱_안은_멘션이_아니다() {
        assert_eq!(first_mention("@reviewer 봐 줘. @host는 기다려"), Some("reviewer"), "첫 멘션 하나다(S9)");
        assert_eq!(first_mention("다 됐으면 (@api-server/reviewer)."), Some("api-server/reviewer"));
        assert_eq!(first_mention("끝나면 @reviewer."), Some("reviewer"), "끝의 마침표는 문장 부호다");
        assert_eq!(first_mention("@reviewer가 봐 줘"), Some("reviewer가"), "조사는 받는 이를 고를 때 뗀다");
        assert_eq!(first_mention("me@example.com으로 보내 줘"), None, "메일 주소는 멘션이 아니다");
        assert_eq!(first_mention("`@media` 쿼리를 고쳐 줘"), None, "인라인 코드 안은 멘션이 아니다");
        assert_eq!(first_mention("```\n@app.route(\"/\")\n```\n@tester 돌려 줘"), Some("tester"), "코드 블록 안도 아니다");
        assert_eq!(first_mention("@ 혼자 선 골뱅이"), None);
        assert_eq!(first_mention("멘션 없는 말"), None);
    }

    #[test]
    fn 멘션의_앞부분은_긴_것부터_한_글자까지다() {
        assert_eq!(name_prefixes("ab가").collect::<Vec<_>>(), ["ab가", "ab", "a"]);
    }

    #[test]
    fn 새_thread의_잇는_곳은_kind로_가르는_json이다() {
        let parse = |text: &str| serde_json::from_str::<ThreadLink>(text).unwrap();
        assert_eq!(parse(r#"{"kind":"no-work"}"#), ThreadLink::NoWork);
        assert_eq!(parse(r#"{"kind":"new-work"}"#), ThreadLink::NewWork);
        assert_eq!(parse(r#"{"kind":"work","slug":"cart"}"#), ThreadLink::Work { slug: "cart".into() });
    }
}
