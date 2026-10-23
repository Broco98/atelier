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
//! - 되살리기(resume → load → 새로) · 큐 · 멈춤 · 지금 전하기 · 권한 답 · 모델 바꾸기 · 로그인 · 죽음 · 끌 때 셈은 three-axes
//!   대화 호스트의 길 그대로다.
//! - **Session마다 Thread 도구의 소켓을 연다(v1 티켓 15 · S12).** Session을 열 때 소켓을 열어 ACP `mcpServers`로 중계 서버를 넘기고,
//!   그 소켓으로 온 도구 호출은 그 Session의 Thread와 Agent의 것으로 받는다([`ConversationHost::answer_tool`]). 소켓은 Session의
//!   프로세스와 함께 산다 — 끄거나 되살릴 때 놓여 치워진다.
//! - **Agent가 Agent를 부른다(v1 티켓 16 · §8, [`call`]).** 맡긴 일은 사람의 말과 같은 길(턴 차례 · 머리말 · 지난 말)로 불린 Agent의
//!   Session에 가고, 그 턴의 마지막 메시지가 부른 Agent에게 돌아간다. 멈추기는 그 Thread의 호출 고리 전체에 걸린다.
//! - **Work 하나에서 고치는 Session은 하나다(v1 티켓 18 · §10, [`seat`]).** 편집을 허락받은 Session이 그 Work의 쓰기 자리를 쥐고 턴이
//!   끝나면 놓는다. 그동안 다른 Session의 편집 요청은 묻지 않고 거절한다 — 고리 안에서 불린 쪽은 이어 쓴다.
//! - **승인은 판정 하나를 거친다(v1 티켓 22 · §9, [`gate`]).** Session에 온 권한 요청은 모두 판정을 지나 허용 · 거절 · 물음 가운데
//!   하나가 된다. `claude`는 기본 모드로만(「계획만」이면 계획 모드로) 뜬다(S17). 물어보는 정도는 Work에 이은 Thread면 Work의 것,
//!   아니면 Thread의 것이다(S18).
//! - **Work와 이어진다(v1 티켓 30 · §11, [`work`]).** Host가 Thread 도구로 Work 만들기를 제안하면 카드가 서고, 사람이 만들면 core가
//!   worktree 없이 Work를 만들고 이 Thread의 `work`를 적는다.
//! - **이은 Work가 보관되거나 지워지면 읽기만이다(v1 티켓 38 · §4 · §5, [`read_only`]).** 그 Thread의 Session은 지금 턴 뒤에 꺼지고,
//!   말은 거절된다.
//! - **worktree는 처음 고칠 때 선다(v1 티켓 32 · S21 · S22, [`project`]).** Agent가 Thread 도구 「Project 고치기 시작」을 부르면 그
//!   Project에만 worktree가 서고, Work에 없는 Project면 Work 밖 Project 카드로 묻는다. 작업 폴더가 바뀐 Session은 다음 말을 보낼 때
//!   새 작업 폴더에서 이어 연다(S11 「바꿔 이어 열기」).

mod call;
mod gate;
mod project;
mod read_only;
mod seat;
mod work;
mod writing;

pub(super) use call::Assignment;
pub use project::ProjectChoice;
pub(super) use read_only::VanishWatch;
pub use work::WorkChoice;
pub use writing::DocWriting;

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use atelier_core::{
    AgentDefinition, AgentProblem, AgentRoster, AgentSaveRefusal, Attachment, DefinitionSource, FoundAgent, NewThread, Participant, RecordKind,
    RecordLine, ThreadFile, ThreadIndex, ThreadSummary, Unresolved, WorkGone,
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
use crate::policy::{AskLevel, Card};
use crate::records::{heard_since_session_start, Recorder, SessionState, ThreadLog};
use crate::runtime::{self, AgentProcess, Answer, Granted, OpenError, QuestionAnswer, SessionPlace};
use crate::thread_tools::{self, Bridge, Call, Fault, Unread};
use gate::Gate;
use seat::{Docs, Grant, Writer};

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
/// 입력창 Work 칩에서 「새 Work로 시작」을 고른 Thread의 첫 머리말 끝 줄(v1 티켓 31 · §11) — 받은 Agent가 Work부터 만든다.
const NEW_WORK_NOTE: &str = "- 사람이 「새 Work로 시작」을 골랐다 — 먼저 `propose_work`로 Work 만들기를 제안하라. 고칠 Project가 \
                             보이지 않으면 `list_projects`로 보고 고르고, 기획만이면 Project 없이 제안한다.\n";

/// 새 Thread를 어디에 잇나(v1 구현 스펙 §5 「말 보내기」) — 새 Thread의 첫 말과 함께 받는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ThreadLink {
    /// Work 없음 — Thread 폴더에서 일한다(S11).
    NoWork,
    /// 새 Work로 시작 — 아직 Work가 없으므로 Work 없음처럼 선다. 첫 말의 머리말에 「먼저 Work 만들기를 제안하라」가 서고(v1 티켓
    /// 31 · §11), Work는 Host의 제안 카드로 만든다(v1 티켓 30).
    NewWork,
    /// 이 Work — 그 Work의 자리에서 일한다. `thread.json`의 `work`에 적는다.
    Work { slug: String },
}

/// 새 Thread의 첫 말과 함께 입력창 칩에서 고른 것(v1 티켓 23 · 31) — 고르지 않은 칸은 `None`이다.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StartPicks {
    /// 물어보는 정도 — Work 없는 Thread면 `thread.json`의 `mode`로 서고, 이은 Work면 다를 때 그 Work의 정도가 된다(S18).
    pub mode: Option<AskLevel>,
    /// 첫 Session의 모델 — 받는 Agent 정의의 `model.prefer` 대신 참여자 줄에 선다(스토리 33). claude `--model`이 받는 값(별칭 ·
    /// 모델 이름)이다.
    pub model: Option<String>,
    /// 첫 Session의 생각 깊이 — 정의의 `model.effort` 대신 선다. claude `--effort`가 받는 값만 받는다.
    pub effort: Option<String>,
}

/// 승인 카드에서 사람이 고른 것(v1 티켓 24 · 구현 스펙 §9) — 그 요청의 선택지 하나에, 함께 드는 것 둘이다.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Reply {
    /// 고른 선택지(`optionId`) — 카드는 선택지의 `kind`로 고른다(예 → 이번만 허락, 아니요 → 이번만 거부).
    pub option: String,
    /// 「예, 이 Work에서는 다시 묻지 않기」 — 판정이 그 물음과 함께 낸 허락을 점 파일에 적고 답한다. 허락하는 선택지에만 뜻이 있다.
    pub remember: bool,
    /// 「아니요, 다르게 해 주세요」의 입력칸에 쓴 말 — 거부와 함께 Agent에게 간다. 비었으면 없다.
    pub words: Option<String>,
}

impl Reply {
    /// 고른 선택지 하나 — 다시 묻지 않기도 남긴 말도 없다.
    pub fn pick(option: &str) -> Self {
        Self { option: option.to_owned(), ..Self::default() }
    }
}

/// 질문 카드에서 사람이 고른 것(v1 티켓 26 · 구현 스펙 §9 · 스토리 81) — 물음마다의 답(고른 선택지 · 직접 쓴 말), 또는 나중에.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuestionReply {
    /// 「답하기」 — 물음마다 하나. 여럿 고르기는 고른 이름들을 쉼표로 잇는다(claude가 읽는 꼴).
    Answer(Vec<QuestionAnswer>),
    /// 「나중에」 — 그 질문 하나만 답 없이 닫는다. Agent는 기다리지 않고 이어 간다.
    Later,
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
    /// 지금 물어보는 정도(S18 · v1 티켓 23) — Work에 이은 Thread면 Work 폴더의 점 파일, 아니면 `thread.json`의 `mode`다. 입력창 아래 칩이
    /// 이것을 그린다. 판정이 요청마다 읽는 값과 같은 길로 읽는다([`gate::asking`]).
    pub ask_level: AskLevel,
    /// 참여자의 Session 가운데 하나라도 지금 이 앱에 떠 있고 살아 있나 — 아니면 기록 끝에 열린 채 남은 턴은 끝난 프로세스의 것이다
    /// (three-axes 티켓 23의 `live`와 같은 뜻).
    pub live: bool,
    /// 참여자마다의 대기 줄 — handle → 그 Session의 대기 줄(대기 줄 바뀜 이벤트의 `who` · `queue`와 같은 열쇠 · 값). 대기 말이
    /// 있는 참여자만 칸이 선다. 메모리에만 있으므로 다시 켠 뒤에는 비어 있다.
    pub queues: BTreeMap<String, Vec<QueuedMessage>>,
    /// 이은 Work가 보관됐거나 지워졌으면 그 까닭 — 그 Thread는 읽기만이다(v1 티켓 38). 화면이 입력창 자리에 그 까닭을 보인다.
    pub read_only: Option<WorkGone>,
}

/// 호스트가 쥔 Thread들 — 떠 있는 Session, 연 기록, 색인.
///
/// 잠금 차례는 호스트의 것이다 — 띄우기 문(`revivals`) → Session 표 → Session의 대화(`state`) → 기록. 기록 표 · 색인 ·
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
    /// Thread마다 사람이 멈춘 횟수(v1 티켓 16) — Agent 부르기가 맡길 때 읽어 두고, 끝날 때 바뀌었으면 「사람이 멈춤」이다.
    halts: Mutex<HashMap<String, u64>>,
    /// Work마다의 쓰기 자리(v1 티켓 18) — Session들의 쓰기 자리 손이 함께 쥔다.
    seats: Arc<seat::WriteSeats>,
    /// 서 있는 카드(Work 만들기 — v1 티켓 30, Work 밖 Project — v1 티켓 32) — 사람의 답을 기다리는 도구 호출들.
    proposals: work::Proposals,
    /// Work마다 지금 쓰는 중인 문서(v1 티켓 34) — Session들의 쓰기 자리 손이 편집 도구의 갱신을 적는다.
    docs: Arc<writing::DocDesk>,
    /// worktree 짓기를 하나씩 세운다(v1 티켓 32) — 같은 Project를 둘이 함께 시작해도 git worktree를 두 번 짓지 않는다.
    trees: Mutex<()>,
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
        Waiter { thread: self.thread.clone(), handle: self.handle.clone() }
    }

    /// 띄우기 문의 이름.
    fn gate(&self) -> String {
        format!("thread {}/{}", self.thread, self.handle)
    }
}

/// 떠 있는 Session 하나.
pub(super) struct Session {
    pub(super) agent: AgentProcess,
    pub(super) conv: Arc<Conv>,
    /// 그 Session의 쓰기 자리 손(v1 티켓 18) — 런타임의 판정과 턴 끝을 보는 sink가 함께 쥔다. 사람의 권한 답이 이것으로 자리를 쥔다.
    writer: Arc<Writer>,
    /// 그 Session의 Thread 도구 소켓 — 쥐고만 있다: 프로세스와 함께 놓여 치워진다. 중계 서버 명령이 없거나 열지 못했으면 없다.
    _tools: Option<Bridge>,
}

impl Threads {
    fn lock_sessions(&self) -> MutexGuard<'_, HashMap<SessionKey, Session>> {
        self.sessions.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 떠 있는 Session들의 대화 — 끌 때 셈이 센다.
    pub(super) fn live_convs(&self) -> Vec<Arc<Conv>> {
        self.lock_sessions().values().map(|session| Arc::clone(&session.conv)).collect()
    }

    /// 떠 있는 Session을 모두 꺼낸다 — 호스트 끄기. 서 있는 Work 만들기 카드도 닫는다 — 기다리던 도구 호출이 풀린다.
    pub(super) fn drain_sessions(&self) -> Vec<Session> {
        self.proposals.close_all();
        self.lock_sessions().drain().map(|(_, session)| session).collect()
    }

    /// 그 Thread가 Work에 이어졌다 — 떠 있는 Session들의 판정 · 쓰기 자리가 곧바로 그 Work를 쓴다(v1 티켓 30).
    fn link_sessions(&self, thread: &str, work: &str) {
        for (key, session) in self.lock_sessions().iter() {
            if key.thread == thread {
                session.writer.link(work);
            }
        }
    }

    /// 그 Session이 떠 있으면 그 대화 — 표의 잠금은 곧바로 놓는다(S2). 부른 쪽은 그 대화의 잠금만 쥐고 일하고, 그 잠금은
    /// [`Conv::lock_found`]로 쥔다 — 찾은 뒤 다른 명령이 꺼냈으면 거기서 물러난다.
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

    /// 그 Work에 이어 열린 떠 있는 Session들 — Work의 물어보는 정도를 함께 쓴다(S18 · v1 티켓 23).
    fn of_work(&self, work: &str) -> Vec<SessionKey> {
        self.lock_sessions()
            .iter()
            .filter(|(_, session)| session.writer.work().as_deref() == Some(work))
            .map(|(key, _)| key.clone())
            .collect()
    }

    /// 그 Session이 떠 있으면 그 대화와 쓰기 자리 손.
    fn find_writer(&self, key: &SessionKey) -> Option<(Arc<Conv>, Arc<Writer>)> {
        self.lock_sessions().get(key).map(|session| (Arc::clone(&session.conv), Arc::clone(&session.writer)))
    }

    /// 그 Session을 표에서 꺼낸다 — 꺼낸 대화라고 적는다([`mark_taken`]). 꺼낸 뒤로는 어느 명령도 이 Session에
    /// 닿지 않는다. 꺼낸 Session의 턴은 끝 없이 사라지므로 그 쓰기 자리를 놓고(v1 티켓 18) 그 Session이 세운 Work 만들기 카드를
    /// 닫는다(v1 티켓 30).
    fn take(&self, key: &SessionKey) -> Option<Session> {
        let taken = self.lock_sessions().remove(key);
        mark_taken(taken.iter().map(|session| &*session.conv));
        if let Some(session) = &taken {
            session.writer.release();
            session.writer.put_pens_down();
            self.proposals.close_for(key);
        }
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

    fn lock_trees(&self) -> MutexGuard<'_, ()> {
        self.trees.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_halts(&self) -> MutexGuard<'_, HashMap<String, u64>> {
        self.halts.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 그 Thread를 사람이 멈춘 횟수.
    fn halts(&self, thread: &str) -> u64 {
        self.lock_halts().get(thread).copied().unwrap_or(0)
    }

    /// 사람이 그 Thread를 멈췄다.
    fn halt(&self, thread: &str) {
        *self.lock_halts().entry(thread.to_owned()).or_default() += 1;
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
        let (ask_level, _) = gate::asking(&self.data_root, thread, file.work.as_deref());
        let read_only = read_only::gone_of(&self.data_root, &file);
        Ok(ThreadView { id: thread.to_owned(), file, last_seq, ask_level, live, queues, read_only })
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
        self.start_thread_with(text, &[], link)
    }

    /// 첨부한 첫 말로 새 Thread — [`Self::start_thread`]와 같고, 첨부(`attachments` — 절대 경로들)가 본문 앞에 경로 목록으로
    /// 간다(v1 티켓 06 · S30). 첨부가 절대 경로가 아니거나 없으면 아무것도 세우지 않고 거절한다.
    pub fn start_thread_with(&self, text: &str, attachments: &[String], link: ThreadLink) -> Result<String, HostError> {
        self.start_thread_asking(text, attachments, link, None)
    }

    /// 물어보는 정도를 고른 첫 말로 새 Thread — [`Self::start_thread_with`]와 같고, 입력창 칩에서 고른 정도(`mode`)가 `thread.json`의
    /// `mode`로 선다(v1 티켓 23 · S18). 그래서 첫 Session부터 그 정도로 판정하고, 「계획만」이면 `claude`가 계획 모드로 뜬다. 고른 채로
    /// 선 것이라 `mode` 줄은 남기지 않는다. Work에 이은 Thread는 정도가 Work의 것이다 — 다르게 골랐으면 그 Work의 정도를 바꾸고
    /// `mode` 줄을 남긴다(이은 Thread의 칩에서 바꾼 것과 같다, v1 티켓 31).
    pub fn start_thread_asking(
        &self,
        text: &str,
        attachments: &[String],
        link: ThreadLink,
        mode: Option<AskLevel>,
    ) -> Result<String, HostError> {
        self.start_thread_picking(text, attachments, link, StartPicks { mode, ..StartPicks::default() })
    }

    /// 입력창 칩에서 고른 것과 함께 새 Thread — [`Self::start_thread_asking`]과 같고, 첫 말 전에 고른 모델 · 생각 깊이(v1 티켓 31 ·
    /// 스토리 33)가 받는 Agent 정의의 선호 대신 참여자 줄에 서서 첫 Session이 그 값(`--model` · `--effort`)으로 뜬다. claude가 받지
    /// 않는 생각 깊이면 아무것도 세우지 않고 거절한다.
    pub fn start_thread_picking(
        &self,
        text: &str,
        attachments: &[String],
        link: ThreadLink,
        picks: StartPicks,
    ) -> Result<String, HostError> {
        if let Some(effort) = picks.effort.as_deref().filter(|effort| !EFFORTS.contains(effort)) {
            return Err(HostError::Setting(format!("모르는 생각 깊이입니다: {effort}")));
        }
        let attachments = attachments_of(attachments)?;
        let note = (link == ThreadLink::NewWork).then_some(NEW_WORK_NOTE);
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
        // 이은 Thread의 정도는 Work의 것이라(S18) `thread.json`에 적지 않는다.
        let mode = picks.mode.filter(|_| work.is_none()).map(|mode| mode.as_str().to_owned());
        let new = NewThread { title: title_of(text), work: work.clone(), mode };
        let created = atelier_core::create_thread(&self.data_root, new, RecordKind::Joined, Some(&handle), joined(&found))
            .map_err(|error| HostError::Record(format!("Thread를 세우지 못했습니다: {error}")))?;
        let log = Arc::new(ThreadLog::new(&self.data_root, &created.id, created.log, Arc::clone(&self.emit)));
        self.threads.lock_logs().insert(created.id.clone(), Arc::downgrade(&log));
        log.written(created.first.clone());
        self.seat(&created.id, &found, &created.first.at, &picks)?;
        if let (Some(slug), Some(mode)) = (&work, picks.mode) {
            if gate::work_asking(&self.data_root, slug).0 != mode {
                self.set_thread_mode(&created.id, mode)?;
            }
        }
        self.say_noting(&SessionKey::new(&created.id, &handle), text, attachments, None, note)?;
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
    /// - 이은 Work가 보관됐거나 지워진 Thread는 읽기만이다 — 아무것도 적지 않고 거절한다(v1 티켓 38).
    pub fn send_to_thread(&self, thread: &str, text: &str) -> Result<(), HostError> {
        self.send_to_thread_with(thread, text, &[])
    }

    /// 첨부한 말 — [`Self::send_to_thread`]와 같고, 첨부(`attachments` — 절대 경로들)가 본문 앞에 경로 목록으로 간다(v1 티켓
    /// 06 · S30). 대기 줄에 들면 잰 첨부를 들고 간다. 첨부가 절대 경로가 아니거나 없으면 아무것도 적지 않고 거절한다.
    pub fn send_to_thread_with(&self, thread: &str, text: &str, attachments: &[String]) -> Result<(), HostError> {
        let attachments = attachments_of(attachments)?;
        let file = self.writable(thread)?;
        let handle = match self.recipient(&file.participants, file.work.as_deref(), text)? {
            Recipient::Seated(handle) => handle,
            Recipient::Newcomer(found) => self.join(thread, &found)?,
        };
        self.say_in_thread(&SessionKey::new(thread, &handle), text, attachments, None)
    }

    /// 멈추기 — Thread 전체에 건다(§5): 그 Thread의 도는 턴마다 멈춤을 보낸다. 기다리지 않는다 — 멈춘 턴의 끝(`cancelled`)은
    /// 기록 줄로 온다. 도는 턴이 없으면 아무 일도 하지 않는다. 사람의 대기 줄은 거두지 않는다.
    ///
    /// 호출 고리도 함께 멈춘다(§8 「멈춤」, v1 티켓 16) — 부른 턴과 불린 턴이 모두 이 Thread의 턴이라 함께 멈추고, 대기 줄에 든 맡긴
    /// 일은 거둔다. 그 부르기들의 결과는 「사람이 멈춤」이다. 서 있는 Work 만들기 카드도 거둔다(v1 티켓 30).
    pub fn stop_thread(&self, thread: &str) -> Result<(), HostError> {
        self.threads.halt(thread);
        self.stop_work_cards(thread);
        for (_, conv) in self.threads.of_thread(thread) {
            let Some(mut state) = conv.lock_found() else { continue };
            conv.seat(&mut state).withdraw_calls();
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
    /// `sendNow`가 true). 죽은 Session이면 먼저 되살려 곧바로 보낸다 — 막히는 호출일 수 있다. 읽기만 된 Thread에는 보내지 않는다.
    pub fn send_thread_now(&self, thread: &str, queued: &str) -> Result<(), HostError> {
        self.writable(thread)?;
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
    /// 따로 센다. 기다리지 않는다. 승인 카드의 셋째 · 넷째 것(다시 묻지 않기 · 남긴 말)은 [`Self::reply_thread_permission`]이다.
    pub fn answer_thread_permission(&self, thread: &str, who: &str, request: &str, option: &str) -> Result<(), HostError> {
        self.reply_thread_permission(thread, who, request, &Reply::pick(option))
    }

    /// 승인 카드의 답(v1 티켓 24) — 걸린 요청에 사람이 고른 것으로 답한다. 기다리지 않는다.
    ///
    /// - **다시 묻지 않기**(`remember`)면 판정이 그 물음과 함께 낸 허락을 먼저 점 파일에 적는다(S18 — 이은 Work의 폴더, 없으면 그 Thread
    ///   폴더). 같은 종류의 다음 요청은 판정의 5번 칸에서 넘어간다. 줄 허락이 없는 물음(`ask_before`가 물었다 · 계획 넘어가기 · 그 밖의
    ///   도구)이거나 허락하는 선택지가 아니면 아무것도 하지 않고 [`HostError::PermissionNoGrant`]다 — 요청은 그대로 걸려 있다. 적은
    ///   뒤에 답이 가지 못해도(그사이 요청이 닫혔다) 허락은 남는다 — 사람이 그렇게 고른 것이다.
    /// - **남긴 말**(`words`)은 답과 함께 Agent에게 간다 — 거부의 글이다(Claude는 그 편집 · 명령의 실패 결과로 받는다).
    /// - 둘 다 답 줄(`answered`)의 `granted` · `words`로 남는다 — 화면의 결정 줄이 읽는다.
    ///
    /// 편집을 허락하는 답이면 그 Session이 Work의 쓰기 자리를 쥔다(v1 티켓 18 · S20). 물은 사이에 다른 Session이 쥐었으면 그 허락 대신
    /// 엔진이 주인의 글로 거부한다 — 사람의 답은 받은 것이라 오류가 아니다. 답이 가지 못하면 새로 쥔 자리를 놓는다.
    ///
    /// **「계획만」에서 계획 넘어가기를 허락하면 물어보는 정도가 「매번 묻기」로 나간다**(v1 티켓 26) — 계획만은 「계획을 세우고 멈추기」
    /// 라 구현으로 넘어가면 끝난다. 답보다 먼저 적는다 — 구현의 첫 요청이 옛 정도로 판정되지 않게. 떠 있는 Session의 계획 모드는 답한
    /// 뒤에 맞춘다(물은 claude는 허락을 받으며 스스로 계획 모드를 나간다).
    ///
    /// 질문 카드의 요청에는 답하지 않는다([`HostError::NotPermission`] — [`Self::answer_thread_question`]의 몫이다).
    pub fn reply_thread_permission(&self, thread: &str, who: &str, request: &str, reply: &Reply) -> Result<(), HostError> {
        let closed = || HostError::PermissionClosed { thread: thread.to_owned(), request: request.to_owned() };
        let (conv, writer) = self.threads.find_writer(&SessionKey::new(thread, who)).ok_or_else(closed)?;
        let asked = writer.asked(request);
        if asked.as_ref().is_some_and(|(card, _)| *card == Card::Question) {
            return Err(HostError::NotPermission { request: request.to_owned() });
        }
        let implements = asked.is_some_and(|(card, options)| {
            card == Card::Plan && options.iter().any(|(id, kind)| *id == reply.option && kind.starts_with("allow"))
        });
        let granted = if reply.remember {
            let rules = writer
                .remembered(request, &reply.option)
                .ok_or_else(|| HostError::PermissionNoGrant { request: request.to_owned() })?;
            let work = writer.work();
            let place = match &work {
                Some(slug) => atelier_core::PolicyPlace::Work(slug),
                None => atelier_core::PolicyPlace::Thread(thread),
            };
            atelier_core::update_policy(&self.data_root, place, |file| {
                for rule in &rules {
                    if !file.grants.contains(rule) {
                        file.grants.push(rule.clone());
                    }
                }
            })
            .map_err(|error| HostError::Record(format!("다시 묻지 않기를 적지 못했습니다: {error}")))?;
            Some(Granted { rules, work })
        } else {
            None
        };
        let words = reply.words.as_deref().map(str::trim).filter(|words| !words.is_empty()).map(str::to_owned);
        let answer = Answer { option_id: reply.option.clone(), words, granted, answers: None };
        let left_plan = if implements { self.leave_plan_only(thread)? } else { None };
        let grant = writer.grant(request, &reply.option);
        let took = matches!(grant, Grant::Took);
        let answered = match conv.lock_found() {
            Some(mut state) => match grant {
                Grant::Refused(ruling) => conv.seat(&mut state).rule(request, ruling),
                Grant::Unchanged | Grant::Took => conv.seat(&mut state).answer(request, &answer),
            }
            .map_err(|refused| refused.into_host(thread)),
            None => Err(closed()),
        };
        if took && answered.is_err() {
            writer.release();
        }
        if let (Some(file), Ok(())) = (&left_plan, &answered) {
            if let Err(error) = self.retune_sessions(thread, file, AskLevel::Always) {
                // 정도는 이미 나갔다 — 판정은 요청마다 그것을 읽는다. 계획 모드에 남은 Session은 다음에 열 때 맞는다.
                eprintln!("계획만을 나간 Session의 모드를 맞추지 못했습니다: {error}");
            }
        }
        answered
    }

    /// 그 Work의 지금 물어보는 정도(v1 티켓 31 · S18) — 새 Thread의 입력창 칩이 「최근 Work」를 고르면 이것을 보인다. 그 Work에 이은
    /// Thread들의 판정이 읽는 것과 같은 점 파일이다. 읽기만 한다. 없는 Work는 [`HostError::WorkNotFound`]다.
    pub fn work_ask_level(&self, work: &str) -> Result<AskLevel, HostError> {
        self.open_work(work)?;
        Ok(gate::work_asking(&self.data_root, work).0)
    }

    /// 질문 카드의 답(v1 티켓 26 · 스토리 81) — 걸린 질문에 물음마다의 답이나 「나중에」로 답한다. 기다리지 않는다.
    ///
    /// - **답하기** — 허락하는 선택지에 답(물음 → 답)을 실어 보낸다. Agent는 물은 입력에 그 답이 더해진 채로 이어 간다.
    /// - **나중에** — 거부하는 선택지로 그 질문 하나만 닫는다. Agent는 답 없이 할 수 있는 일을 이어 간다.
    /// - 둘 다 `question` 줄의 답(`choice: answer | later`)으로 남는다 — 화면의 「답함: …」 줄이 읽는다.
    ///
    /// 걸려 있지 않은 질문이면 [`HostError::PermissionClosed`], 승인 카드의 요청이면 [`HostError::NotQuestion`]이다 — 요청은 그대로다.
    pub fn answer_thread_question(&self, thread: &str, who: &str, request: &str, reply: &QuestionReply) -> Result<(), HostError> {
        let closed = || HostError::PermissionClosed { thread: thread.to_owned(), request: request.to_owned() };
        let (conv, writer) = self.threads.find_writer(&SessionKey::new(thread, who)).ok_or_else(closed)?;
        let (card, options) = writer.asked(request).ok_or_else(closed)?;
        if card != Card::Question {
            return Err(HostError::NotQuestion { request: request.to_owned() });
        }
        let (option, answers) = match reply {
            QuestionReply::Answer(answers) => (seat::allowing(&options), Some(answers.clone())),
            QuestionReply::Later => (seat::rejecting(&options), None),
        };
        let option_id = option.ok_or_else(closed)?;
        let answer = Answer { option_id, answers, ..Answer::default() };
        let mut state = conv.lock_found().ok_or_else(closed)?;
        conv.seat(&mut state).answer(request, &answer).map_err(|refused| refused.into_host(thread))
    }

    /// 물어보는 정도 바꾸기(S18 · 스토리 84) — Work에 이은 Thread면 그 Work 폴더의 점 파일에(같은 Work의 Thread들이 함께 쓴다),
    /// 아니면 `thread.json`의 `mode`에 둔다. 바꾼 것은 `mode` 줄(`{mode, work}`, 사람의 줄)로 남는다(§4).
    ///
    /// 판정이 요청을 받을 때마다 읽으므로 다음 권한 요청부터 든다. `claude`의 계획 모드는 Session을 열 때 이 값으로 정하고, 「계획만」
    /// 으로 들고 나면 그 정도를 쓰는 떠 있는 Session의 모드도 곧바로 바꾼다(v1 티켓 23 — [`Self::retune_sessions`]).
    pub fn set_thread_mode(&self, thread: &str, mode: AskLevel) -> Result<(), HostError> {
        let (file, before) = self.store_thread_mode(thread, mode)?;
        if before.claude_mode() == mode.claude_mode() {
            return Ok(());
        }
        self.retune_sessions(thread, &file, mode)
    }

    /// 「계획만」이면 「매번 묻기」로 나간다(v1 티켓 26 — 계획 넘어가기를 허락함) — 적고 `mode` 줄을 남긴다. 떠 있는 Session의 모드는
    /// 맞추지 않는다 — 부르는 쪽이 답한 뒤에 맞춘다. 나갔으면 그 Thread 파일이다. 계획만이 아니면 아무것도 하지 않는다.
    fn leave_plan_only(&self, thread: &str) -> Result<Option<ThreadFile>, HostError> {
        let work = self.read_thread_file(thread)?.work;
        if gate::asking(&self.data_root, thread, work.as_deref()).0 != AskLevel::Plan {
            return Ok(None);
        }
        self.store_thread_mode(thread, AskLevel::Always).map(|(file, _)| Some(file))
    }

    /// 물어보는 정도를 적고 `mode` 줄을 남긴다 — 그 Thread 파일과 바꾸기 전의 정도.
    fn store_thread_mode(&self, thread: &str, mode: AskLevel) -> Result<(ThreadFile, AskLevel), HostError> {
        let file = self.read_thread_file(thread)?;
        let (before, _) = gate::asking(&self.data_root, thread, file.work.as_deref());
        let stored = Some(mode.as_str().to_owned());
        match &file.work {
            Some(slug) => {
                // 사라진 Work의 폴더를 점 파일 쓰기가 되살리지 않는다 — 먼저 Work를 읽는다.
                self.open_work(slug)?;
                atelier_core::update_policy(&self.data_root, atelier_core::PolicyPlace::Work(slug), |policy| policy.mode = stored)
                    .map_err(|error| HostError::Record(format!("물어보는 정도를 적지 못했습니다: {error}")))?;
            }
            None => {
                self.change_thread(thread, |file| file.mode = stored)?;
            }
        }
        let line = json!({"mode": mode.as_str(), "work": file.work});
        self.thread_log(thread)?.write(RecordKind::Mode, None, line).map_err(HostError::Record)?;
        Ok((file, before))
    }

    /// 그 정도를 쓰는 떠 있는 Session의 `claude` 권한 모드를 맞춘다(S17 · v1 티켓 23) — 그 Thread의 참여자들과, Work에 이었으면 그 Work에
    /// 이어 열린 다른 Thread의 Session들. 다시 띄우지 않고 `session/set_mode`를 넣는다 — 턴이 돌고 있으면 그 턴의 다음 도구부터 든다.
    /// 넣은 바꾸기는 그 Session의 `config` 줄로 남는다. 떠 있지 않은 Session은 다음에 열 때 이 정도로 뜬다.
    ///
    /// 되살리는 중인 Session은 그 끝을 기다린다 — 옛 정도로 열리는 중일 수 있다. 한 Session이 거절해도 나머지는 바꾸고, 처음 거절의
    /// 까닭으로 실패한다(정도는 이미 바뀌었다 — 판정은 요청마다 그것을 읽는다).
    fn retune_sessions(&self, thread: &str, file: &ThreadFile, mode: AskLevel) -> Result<(), HostError> {
        let mut keys: Vec<SessionKey> = file.participants.iter().map(|one| SessionKey::new(thread, &one.handle)).collect();
        if let Some(slug) = &file.work {
            for key in self.threads.of_work(slug) {
                if !keys.contains(&key) {
                    keys.push(key);
                }
            }
        }
        let setting = Setting::Mode(mode.claude_mode());
        let mut refused = None;
        for key in keys {
            let gate = self.revival_gate(&key.gate());
            let _not_while_reviving = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let Some(conv) = self.threads.find(&key) else { continue };
            let turns = {
                let Some(state) = conv.lock_found() else { continue };
                state.turns.clone().filter(|_| state.order.alive())
            };
            let Some(turns) = turns else { continue };
            let _one_at_a_time = conv.setting.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let (method, fields) = setting.request();
            match turns.change(method, fields, SETTING_LIMIT) {
                Ok(()) => conv.recorder.config(setting.changed()).map_err(HostError::Record)?,
                Err(why) => {
                    refused.get_or_insert(why);
                }
            }
        }
        refused.map_or(Ok(()), |why| Err(HostError::Setting(why)))
    }

    /// 모델 바꾸기 — 그 참여자의 모델을 바꾼다(스토리 33 · three-axes 티켓 09).
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

    /// 이름 바꾸기 — 사람이 위 막대에서 고친 이름(v1 티켓 05 · 구현 스펙 §14 · §18). 사람의 줄이라 `title` 줄에 `who`가 없다(S8).
    /// 규칙은 [`ConversationHost::rename`]이다. 답은 바뀐 목록 요약이다.
    pub fn rename_thread(&self, thread: &str, title: &str) -> Result<ThreadSummary, HostError> {
        self.rename(thread, title, None)
    }

    /// 읽은 자리 적기(v1 티켓 41 · 구현 스펙 §17 · S38) — 화면은 Thread를 열고 맨 아래가 보일 때 끝 줄의 seq를 적는다. `thread.json`의
    /// `lastRead`를 고치고 목록 요약을 알린다(사이드바의 「새 결과」가 걷힌다). 답은 목록 요약이다.
    ///
    /// - **뒤로 가지 않는다** — 늦게 온 옛 seq는 아무것도 바꾸지 않는다. 같은 자리도 쓰지 않는다.
    /// - 기록에 줄을 남기지 않고, Session을 띄우지 않는다 — 사람이 본 자리는 Agent가 알 일이 아니다.
    pub fn mark_thread_read(&self, thread: &str, seq: u64) -> Result<ThreadSummary, HostError> {
        if self.read_thread_file(thread)?.last_read < seq {
            self.change_thread(thread, |file| file.last_read = file.last_read.max(seq))?;
        }
        self.with_index(|index| index.all().iter().find(|summary| summary.id == thread).cloned())?
            .ok_or_else(|| HostError::ThreadNotFound(thread.to_owned()))
    }

    /// 이름 바꾸기의 몸 — 사람(위 막대)과 Agent(Thread 도구 「Thread 이름 바꾸기」, v1 티켓 15)가 함께 쓴다. `thread.json`의 `title`을
    /// 고치고 목록 요약을 알리고(사이드바 · 위 막대), `title` 줄을 남긴다 — `who`는 바꾼 Agent의 handle이고 사람이면 없다(S8).
    /// payload는 `{title, before}`다(흐름의 시스템 줄 「Thread 이름을 … 로 바꿈」이 이것을 읽는다).
    ///
    /// - 줄바꿈 · 앞뒤 빈칸은 걷어 한 줄로 둔다. 빈 이름은 거절하고 아무것도 바꾸지 않는다.
    /// - 같은 이름이면 아무것도 쓰지 않는다 — 고치는 칸을 그대로 닫아도 줄이 쌓이지 않는다.
    /// - Session을 띄우지 않는다. 머리말의 제목은 다음에 여는 Session부터 바뀐다(S10).
    /// - 읽기만 된 Thread의 이름은 바꾸지 않는다(v1 티켓 38) — 끝난 일의 기록이다.
    fn rename(&self, thread: &str, title: &str, who: Option<&str>) -> Result<ThreadSummary, HostError> {
        let title = one_line(title);
        if title.is_empty() {
            return Err(HostError::BadTitle);
        }
        if self.writable(thread)?.title != title {
            let log = self.thread_log(thread)?;
            let mut before = String::new();
            self.change_thread(thread, |file| before = std::mem::replace(&mut file.title, title.clone()))?;
            log.write(RecordKind::Title, who, json!({"title": title, "before": before})).map_err(HostError::Record)?;
        }
        self.with_index(|index| index.all().iter().find(|summary| summary.id == thread).cloned())?
            .ok_or_else(|| HostError::ThreadNotFound(thread.to_owned()))
    }

    /// Thread 도구 호출 하나에 답한다(v1 티켓 15 · S12 · S13) — 그 Session의 소켓으로 왔으므로 부른 Thread와 Agent는 `key`다. 도구의
    /// 거절(빈 이름 · 사라진 Thread)은 도구의 실패로 돌려준다 — Agent가 그 글을 읽는다. 연결마다의 스레드에서 불린다.
    fn answer_tool(&self, key: &SessionKey, method: &str, params: &Value) -> Result<Value, Fault> {
        let call = match method {
            "tools/list" => return Ok(thread_tools::list()),
            "tools/call" => thread_tools::read_call(params),
            _ => return Err(Fault::unknown_method(method)),
        };
        Ok(match call {
            Ok(Call::RenameThread { title }) => match self.rename(&key.thread, &title, Some(&key.handle)) {
                Ok(summary) => thread_tools::said(&format!("Thread 이름을 바꿨다 — {}", summary.title), false),
                Err(error) => thread_tools::said(&error.to_string(), true),
            },
            Ok(Call::CallAgent { handle, task }) => self.call_agent(key, &handle, &task),
            Ok(Call::SaveAgent { handle, content }) => match self.save_agent(key, &handle, &content) {
                Ok(path) => thread_tools::said(
                    &format!("Library에 저장했다 — {}. 이제 `@{handle}`로 부를 수 있다.", path.display()),
                    false,
                ),
                Err(why) => thread_tools::said(&why, true),
            },
            Ok(Call::ListProjects) => self.list_projects_tool(),
            Ok(Call::GetWork) => self.get_work_tool(key),
            Ok(Call::ProposeWork(proposal)) => self.propose_work(key, proposal),
            Ok(Call::StartEditing { project, reason }) => self.start_editing(key, &project, reason.as_deref()),
            Err(Unread::Bad(why)) => thread_tools::said(&why, true),
            Err(Unread::Unknown(fault)) => return Err(fault),
        })
    }

    /// Agent 저장(Thread 도구 「Agent 저장」 — v1 티켓 19 · §7 S13) — Library에만 쓰고(규칙은 [`atelier_core::save_agent`]), 저장했으면
    /// `library` 줄을 남긴다(`who`는 저장한 Agent). 줄의 payload는 저장한 정의의 handle · 이름 · 얼굴(`avatar`, 없으면 칸째 빠진다) ·
    /// 자리다 — 시스템 줄 「Library에 리뷰어를 저장함」이 이것을 그리고, 화면은 이 줄을 보고 Agent 목록을 다시 읽는다. 거절이면 그
    /// 까닭의 글이다(Agent가 읽고 고쳐 부른다) — 아무것도 적지 않는다.
    fn save_agent(&self, key: &SessionKey, handle: &str, content: &str) -> Result<PathBuf, String> {
        let saved = atelier_core::save_agent(&self.data_root, handle, content).map_err(|refusal| match refusal {
            AgentSaveRefusal::BadHandle => format!(
                "handle `{handle}`은 쓸 수 없다 — 파일 이름이자 @로 부르는 이름이라 영어 소문자 · 숫자로 시작하고 끝나며 사이에 \
                 `-` · `_`만 든다(예: security-reviewer)."
            ),
            AgentSaveRefusal::Taken { path } => format!(
                "Library에 `@{handle}`가 이미 있다 — 덮지 않는다: {}. 다른 handle로 다시 저장한다.",
                path.display()
            ),
            AgentSaveRefusal::Broken(problem) => {
                format!("Agent 파일이 깨졌다 — {}. frontmatter를 고쳐 다시 부른다.", problem_text(problem))
            }
            AgentSaveRefusal::Unwritable { message } => format!("Library에 쓰지 못했다 — {message}"),
        })?;
        let definition = &saved.definition;
        let mut payload = json!({"handle": definition.handle, "name": definition.name, "path": saved.path});
        if let Some(avatar) = &definition.avatar {
            payload["avatar"] = json!(avatar);
        }
        let log = self.thread_log(&key.thread).map_err(|error| error.to_string())?;
        log.write(RecordKind::Library, Some(&key.handle), payload)
            .map_err(|error| format!("Library에 저장했지만 Thread에 적지 못했다 — {error}"))?;
        Ok(saved.path)
    }

    /// 그 Session의 Thread 도구 소켓을 연다 — 중계 서버 명령이 없으면 없다. 열지 못하면 Thread 도구 없이 Session을 연다: 까닭은
    /// 기록의 `stderr` 줄로 남긴다(Agent는 일하되 Thread를 다루지 못한다).
    fn open_tools(&self, key: &SessionKey, conv: &Conv) -> Option<(Bridge, Value)> {
        let relay = self.thread_tools.as_ref()?;
        let host = self.weak();
        let at = key.clone();
        let answer: thread_tools::Answer = Arc::new(move |method, params| match ConversationHost::upgrade(&host) {
            Some(host) => host.answer_tool(&at, method, params),
            None => Err(Fault::gone()),
        });
        match Bridge::open(answer) {
            Ok(bridge) => {
                let server = bridge.server(relay);
                Some((bridge, server))
            }
            Err(error) => {
                if let Err(error) = conv.recorder.stderr(format!("Thread 도구의 소켓을 열지 못했습니다: {error}")) {
                    eprintln!("{error}");
                }
                None
            }
        }
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
    /// 머리말과 첨부를 들고 간다(턴 끝에서는 `thread.json`을 읽지 않는다). `call`이 있으면 사람의 말이 아니라 다른 Agent가 맡긴
    /// 일이다(v1 티켓 16) — 막히면 그 맡긴 일도 놓인다.
    fn say_in_thread(
        &self,
        key: &SessionKey,
        text: &str,
        attachments: Vec<Attachment>,
        call: Option<Assignment>,
    ) -> Result<(), HostError> {
        self.say_noting(key, text, attachments, call, None)
    }

    /// [`Self::say_in_thread`]에 머리말 끝의 한 줄(`note`)을 더한 것 — 새 Thread의 첫 말이 「새 Work로 시작」의 표시를 싣는다(v1 티켓
    /// 31). 머리말은 Session의 첫 말에만 붙으므로 그 줄도 그때만 간다.
    fn say_noting(
        &self,
        key: &SessionKey,
        text: &str,
        attachments: Vec<Attachment>,
        call: Option<Assignment>,
        note: Option<&str>,
    ) -> Result<(), HostError> {
        if !self.session_running(key) && self.logins.waiting_for(&key.waiter()).is_none() {
            self.revive_session(key, Revive::IfNotRunning)?;
        } else {
            self.move_if_needed(key)?;
        }
        let draft = Draft { text: text.to_owned(), preamble: self.thread_preamble(key, note)?, quote: None, attachments, call };
        let found = self.threads.find(key);
        let Some((conv, mut state)) = found.as_ref().and_then(|conv| conv.lock_found().map(|state| (conv, state))) else {
            return Err(match self.logins.waiting_for(&key.waiter()) {
                Some(agent) => HostError::LoginRequired { agent, thread: key.thread.clone() },
                None => HostError::NotRunning(key.thread.clone()),
            });
        };
        conv.seat(&mut state).say(draft, ()).map_err(|refused| refused.into_host(&key.thread))
    }

    /// 작업 폴더가 바뀐 Session을 새 작업 폴더에서 이어 연다(S11 「바꿔 이어 열기」 · v1 티켓 32) — Work가 나중에 붙었거나, worktree가
    /// 새로 섰거나, 읽기만 폴더를 더했다. 같은 Session id로 이어 열므로(`--resume`) 앞 맥락이 이어지고 새 턴은 새 폴더에서 일한다
    /// (실측-작업폴더.md). 옮겨 연 Session의 첫 말에는 머리말이 다시 붙어 새 자리를 알린다([`Self::open_session`]).
    ///
    /// **쉬는 Session만 옮긴다** — 턴이 도는 동안의 말은 대기 줄에 들어 그 프로세스(옛 폴더)에 간다. 그 Session은 다음에 쉬는 때 받는
    /// 말에서 옮긴다. 바뀐 것이 없으면 아무것도 하지 않는다. 막히는 호출일 수 있다(Session이 열릴 때까지).
    fn move_if_needed(&self, key: &SessionKey) -> Result<(), HostError> {
        if !self.place_moved(key) {
            return Ok(());
        }
        self.revive_session(key, Revive::IfMoved)
    }

    /// 그 Session이 연 작업 폴더 · 함께 여는 폴더(`thread.json`의 참여자 줄)가 지금 S11 표의 자리와 다른가. 처음 열기 전이거나 자리를
    /// 셀 수 없으면(사라진 Work) 다르지 않다고 본다 — 옮기지 못하는 일로 말을 막지 않는다.
    fn place_moved(&self, key: &SessionKey) -> bool {
        let Ok(file) = self.read_thread_file(&key.thread) else { return false };
        let Ok(participant) = participant_of(&file, &key.thread, &key.handle) else { return false };
        let Ok(place) = self.thread_place(&key.thread, &file) else { return false };
        moved(&participant, &place)
    }

    /// 떠 있지 않거나 죽은 Session을 띄워 되살린다(three-axes 티켓 10) — 다시 켠 뒤의 Session과 죽은 Session은 말을 보낼 때 띄운다
    /// (three-axes 결정 19). `thread.json`의 Session id로 resume → load → 새로 순이고, 떠 있던(죽은) Session은 쓰는 손과 대기 줄을
    /// 그대로 이어 쓴다. 다시 뜨지 못하면 대기 줄은 사라지고, 화면이 옛 줄을 붙들지 않게 빈 대기 줄을 알린다.
    ///
    /// 막히는 호출이다 — 세션이 열릴 때까지 기다린다. Session마다 하나씩 돈다 — 앞선 것이 되살렸으면 아무것도 하지 않는다.
    fn revive_session(&self, key: &SessionKey, when: Revive) -> Result<(), HostError> {
        let gate = self.revival_gate(&key.gate());
        let _one_at_a_time = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if when == Revive::IfNotRunning && self.session_running(key) {
            return Ok(());
        }
        // 앞선 것이 옮겼거나, 그사이 턴이 섰다 — 도는 턴을 끊지 않는다(v1 티켓 32).
        if when == Revive::IfMoved && !(self.session_idle(key) && self.place_moved(key)) {
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
        let place = self.thread_place(&key.thread, file)?;
        let (definition, instructions) = self.read_snapshot(key)?;
        let recorder = &conv.recorder;
        recorder.session(SessionState::Spawning).map_err(HostError::Record)?;
        // 기본 모드로만 띄운다 — 「계획만」이면 계획 모드다(S17). 사용자의 `defaultMode`를 물려받지 않는다.
        let (level, _) = gate::asking(&self.data_root, &key.thread, file.work.as_deref());
        let choice = ClaudeChoice {
            mode: Some(level.claude_mode().to_owned()),
            model: participant.model.clone(),
            effort: participant.effort.clone(),
            instructions: Some(instructions),
            tools: definition.tools.builtin,
            forbid: definition.policy.forbid.clone(),
        };
        let (launch, mut terms) = claude_launch(&self.translator, programs, env, &place, &choice);
        // 참여자의 Session id가 있으면 되살린다 — 다시 켠 뒤 · 죽은 뒤 · 로그인 뒤. 처음 여는 Session은 곧바로 새로다.
        terms.revive = participant.session_id.clone();
        // 열 때마다 새 소켓이다 — 되살린 Session도 앞 프로세스의 소켓은 이미 치웠다. 열지 못하면 여기서 놓여 치워진다.
        let (tools, server) = self.open_tools(key, &conv).unzip();
        terms.mcp_servers.extend(server);
        // 판정(v1 티켓 22) — 받은 권한 요청은 모두 판정을 지난다. 쓰기 자리(v1 티켓 18)는 판정의 입력이고, 턴이 끝나면 쥔 자리를 놓는다.
        // 쓰는 문서(v1 티켓 34)는 그 Agent의 이름으로 낸다 — Host는 정의 이름과 상관없이 「Host」다(머리줄 · 흐름과 같다).
        let docs = Docs {
            desk: Arc::clone(&self.threads.docs),
            emit: Arc::clone(&self.emit),
            cwd: place.cwd.clone(),
            name: if key.handle == HOST { "Host".to_owned() } else { definition.name.clone() },
        };
        let writer = Writer::new(&self.threads.seats, self.data_root.clone(), key.clone(), file.work.clone(), &conv, docs);
        let gate = Gate {
            data_root: self.data_root.clone(),
            thread: key.thread.clone(),
            cwd: place.cwd.clone(),
            policy: definition.policy,
            cli: definition.tools.cli,
            writer: Arc::clone(&writer),
        };
        terms.judge = Some(gate.judge());
        let limit = self.open_limit.unwrap_or(CLAUDE_OPEN_LIMIT);
        let at = SessionPlace { cwd: place.cwd.clone(), additional_directories: place.additional_directories.clone() };
        let opened = runtime::open(launch, at, terms, limit, writer.watching(conv.sink()), record_opened(&conv));
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
                return Err(HostError::Open { thread: key.thread.clone(), reason });
            }
        };
        // 그 Session의 첫 말이면 머리말을 붙인다(S10) — 새로 섰거나, 되살린 Session이 아직 말을 받은 적이 없다. 작업 폴더가 바뀌어
        // 옮겨 연 Session에도 붙인다(v1 티켓 32) — 이은 Work · 새 worktree · 읽기만 폴더를 그 Agent가 알게.
        let heard = self.read_thread_record(&key.thread, 0)?;
        let needs_preamble =
            opened.how.starts_session() || !heard_since_session_start(&heard, &key.handle) || moved(participant, &place);
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
        self.threads.put(key.clone(), Session { agent, conv, writer, _tools: tools });
        Ok(())
    }

    /// 그 Session이 떠 있고 살아 있나 — 아니면 보내기가 먼저 되살린다.
    fn session_running(&self, key: &SessionKey) -> bool {
        self.threads.find(key).is_some_and(|conv| conv.lock_found().is_some_and(|state| state.is_up()))
    }

    /// 그 Session이 떠 있고 살아 있고 턴이 돌지 않나 — 작업 폴더를 옮겨도 끊길 턴이 없다.
    fn session_idle(&self, key: &SessionKey) -> bool {
        self.threads.find(key).is_some_and(|conv| conv.lock_found().is_some_and(|state| state.is_up() && !state.order.turning()))
    }

    /// 떠 있을 Session의 대화 — 그 Thread의 기록에 그 handle로 적고, 턴 도중의 로그인 요구를 창구에 쥐게 하고, 턴 끝에 그 Thread가
    /// 읽기만 됐으면 끄러 보낸다(v1 티켓 38). spec 폴더를 찍지 않는다.
    fn session_conv(&self, key: &SessionKey) -> Result<Arc<Conv>, HostError> {
        let recorder = Recorder::of_thread(self.thread_log(&key.thread)?, &key.handle);
        let vanish = VanishWatch::new(self.data_root.clone(), key.clone(), self.weak());
        Ok(Conv::new(recorder, self.login_watch(Agent::Claude, key.waiter()), vanish))
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
        self.seat(thread, found, &line.at, &StartPicks::default())?;
        Ok(handle)
    }

    /// Agent를 Thread에 앉힌다 — 정의 파일을 Thread 폴더에 스냅숏하고(S4) `thread.json`에 참여자로 적는다. 정의가 온 곳은 범위가
    /// 준 그대로(Library · Project)이고, 모델 · 생각 깊이는 스냅숏의 것을 옮겨 적는다 — 새 Thread의 칩에서 고른 칸(`picks`)이
    /// 있으면 그것이다(v1 티켓 31). `joined` 줄은 부르는 쪽이 먼저 적었다.
    fn seat(&self, thread: &str, found: &FoundAgent, joined_at: &str, picks: &StartPicks) -> Result<(), HostError> {
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
            model: picks.model.clone().or_else(|| definition.model.prefer.clone()),
            effort: picks.effort.clone().or_else(|| definition.model.effort.clone()),
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
        let definition = self.snapshot_definition(key)?;
        let path = self.snapshots(&key.thread)?.join(format!("{}.instructions.md", key.handle));
        std::fs::write(&path, &definition.instructions)
            .map_err(|error| HostError::Record(format!("지시문 파일을 쓰지 못했습니다: {} — {error}", path.display())))?;
        Ok((definition, path))
    }

    /// 그 참여자의 정의 — Thread 폴더의 스냅숏에서만 읽는다(§19). Agent 부르기의 `tools.agents` 검사도 이것을 본다(v1 티켓 16).
    fn snapshot_definition(&self, key: &SessionKey) -> Result<AgentDefinition, HostError> {
        atelier_core::read_agent(&self.snapshots(&key.thread)?.join(format!("{}.md", key.handle)))
            .map_err(|problem| HostError::AgentBroken { handle: key.handle.clone(), reason: problem_text(problem) })
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
    ///
    /// Work 밖 Project 카드에서 「읽기만 하기」를 고른 Project 폴더(`readOnlyProjects`)는 함께 여는 폴더 끝에 더한다(S22 · v1 티켓 32) — 읽을 수
    /// 있게만 한다. 고칠 수 있는 자리는 판정이 따로 센다(`gate.rs`).
    fn thread_place(&self, thread: &str, file: &ThreadFile) -> Result<SessionPlace, HostError> {
        let mut place = match &file.work {
            None => {
                let cwd = atelier_core::thread_dir(&self.data_root, thread).map_err(|error| thread_error(thread, error))?;
                SessionPlace { cwd, additional_directories: Vec::new() }
            }
            Some(slug) => {
                let work_at = self.open_work(slug)?;
                let trees: Vec<&PathBuf> = work_at.places.worktrees.iter().filter(|tree| tree.is_dir()).collect();
                match trees.as_slice() {
                    [] => SessionPlace { cwd: work_at.places.spec.clone(), additional_directories: Vec::new() },
                    [tree] => SessionPlace { cwd: (*tree).clone(), additional_directories: vec![work_at.places.spec.clone()] },
                    _ => SessionPlace { cwd: work_at.places.trees.clone(), additional_directories: vec![work_at.places.spec.clone()] },
                }
            }
        };
        if !file.read_only_projects.is_empty() {
            for (slug, folder) in atelier_core::project_folders(&self.data_root) {
                if file.read_only_projects.contains(&slug) && !place.additional_directories.contains(&folder) {
                    place.additional_directories.push(folder);
                }
            }
        }
        Ok(place)
    }

    /// 머리말(v1 구현 스펙 S10) — Thread id · 제목, 이 Agent의 handle, 참여자, 이어진 Work(slug · 제목 · spec 폴더 · Project마다
    /// worktree 또는 「읽기만」), Thread 도구를 쓰는 법(S42 · v1 티켓 15). Session의 첫 말과 새로 연 뒤의 첫 말에 따로 된 텍스트
    /// 블록으로 붙는다. 화면은 그리지 않고 `sent` 줄의 `prompt`에만 남는다. `note`는 끝에 붙는 한 줄이다(「새 Work로 시작」).
    fn thread_preamble(&self, key: &SessionKey, note: Option<&str>) -> Result<Value, HostError> {
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
                Ok(work_at) => text.push_str(&work::work_lines(slug, &work_at)),
                Err(_) => text.push_str(&format!("- Work: `{slug}` — 찾을 수 없다\n")),
            },
        }
        if self.thread_tools.is_some() {
            text.push_str(&format!(
                "- Thread 도구: MCP 서버 `{}`의 도구로 이 Thread를 다룬다. Thread id는 넘기지 않는다 — 이 Session의 Thread다.\n  \
                 - `rename_thread`(title) — Thread 이름을 바꾼다. 일이 무엇인지 드러나는 짧은 이름으로.\n  \
                 - `{}`(handle, task) — 다른 Agent에게 일을 맡기고, 그 Agent가 턴을 끝낼 때의 마지막 메시지를 결과로 받는다. \
                 그때까지 기다린다.\n  \
                 - `{}`(handle, content) — 사람이 Agent를 만들어 달라면 Library에 Agent 파일로 저장한다. 「이 Project에 \
                 둬」라면 이 도구가 아니라 그 Project worktree의 `.atelier/agents/<handle>.md`에 보통 편집으로 쓴다.\n  \
                 - `{}`() — 등록된 Project와 그 저장소의 브랜치들. Work를 제안하기 전에 본다.\n  \
                 - `{}`() — 이 Thread의 Work(spec 폴더 · 브랜치 · Project마다 worktree 또는 읽기만).\n  \
                 - `{}`(title, slug, reason, branch, projects) — 일이 커지면 Work로 묶자고 사람에게 카드로 묻고, 사람이 고를 \
                 때까지 기다린다. Work는 사람의 `atelier` MCP(`atelier_start_work`)가 아니라 이 도구로 만든다 — 그래야 이 Thread가 \
                 그 Work에 이어진다.\n  \
                 - `{}`(project, reason) — Work의 Project를 처음 고치기 전에 부른다. 그 Project에만 worktree를 만들어 경로를 \
                 돌려준다. Work에 없는 Project면 사람에게 카드로 묻는다.\n",
                thread_tools::SERVER_NAME,
                thread_tools::CALL_AGENT,
                thread_tools::SAVE_AGENT,
                thread_tools::LIST_PROJECTS,
                thread_tools::GET_WORK,
                thread_tools::PROPOSE_WORK,
                thread_tools::START_EDITING
            ));
        }
        if let Some(note) = note {
            text.push_str(note);
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

/// 말을 받는 이(S9) — 사람이 멘션한 Agent이거나 다른 Agent가 부른 Agent(v1 티켓 16).
enum Recipient {
    /// 이미 참여자인 Agent — 그 handle.
    Seated(String),
    /// 아직 참여자가 아닌 범위 안의 Agent — 들인 뒤에 받는다.
    Newcomer(FoundAgent),
}

impl Recipient {
    /// 받는 Agent의 handle — 이 Thread에서 그 Session의 열쇠다.
    fn handle(&self) -> &str {
        match self {
            Recipient::Seated(handle) => handle,
            Recipient::Newcomer(found) => &found.definition.handle,
        }
    }
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

/// `joined` 줄의 payload — 들어온 참여자와 정의가 온 곳(Library · Project). 이름 · 얼굴(`avatar`)은 화면이 그 참여자를 그리는
/// 정본이다(v1 티켓 14) — 들어올 때의 정의 그대로라(S4) Agent 파일을 고치거나 지워도 이 Thread의 얼굴은 바뀌지 않는다. 파일에
/// `avatar`가 없으면 칸째 빠진다 — 화면이 handle에서 정한다(S36).
fn joined(found: &FoundAgent) -> Value {
    let mut payload = json!({"handle": found.definition.handle, "name": found.definition.name, "from": found.from});
    if let Some(avatar) = &found.definition.avatar {
        payload["avatar"] = json!(avatar);
    }
    payload
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

/// 그 참여자의 Session이 연 자리(`thread.json`의 참여자 줄)가 지금 자리와 다른가(v1 티켓 32) — 처음 열기 전(작업 폴더가 없다)이면
/// 다르지 않다.
fn moved(participant: &Participant, place: &SessionPlace) -> bool {
    participant
        .cwd
        .as_ref()
        .is_some_and(|cwd| cwd != &place.cwd || participant.additional_directories != place.additional_directories)
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

/// 사람이 말에 붙인 경로 → 첨부(v1 티켓 06). 하나라도 첨부가 될 수 없으면 그 까닭이 화면의 거절 글이다 — 무엇을 적기 전에 부른다.
fn attachments_of(paths: &[String]) -> Result<Vec<Attachment>, HostError> {
    atelier_core::describe_attachments(paths).map_err(|error| HostError::BadAttachment(error.to_string()))
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
