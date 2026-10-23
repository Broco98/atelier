//! 기록 — work 폴더의 `agents/`(three-axes 결정 18).
//!
//! - `agents.json` — 대화 목록. 닫은 대화도 줄을 남긴다(S14). tmp + rename으로 쓰고, **폴더를 만들지 않는다** —
//!   사라진 work 폴더를 되살리지 않는다(S10).
//! - `<id>.jsonl` — 대화 하나의 기록. 한 줄이 `{seq, at, kind, payload}`이고 seq는 대화마다 1부터 는다. 적은 줄은
//!   같은 모양의 「기록 줄」 이벤트로도 나간다 — 화면은 대화를 이것 하나로 그린다.
//!
//! **줄 모양 · 줄 종류 · 반쪽 줄 규칙 · 덧붙이는 쓰기는 코어(`atelier_core`의 기록 줄)가 정본이다** — Thread의 `events.jsonl`과 한
//! 벌이다(v1 티켓 02). 여기는 대화 목록과, 줄마다의 payload 모양과, 적은 줄을 이벤트로 내보내는 일만 갖는다.
//!
//! Thread의 Session(v1 티켓 04)도 같은 `Recorder`로 적는다 — 줄은 Thread 하나의 `events.jsonl`(`ThreadLog`, 참여자가 함께 쓴다)로
//! 가고, 참여자의 줄에는 `who`가 붙는다(S8). 사람이 보낸 줄에는 `who`가 없고 받는 이를 payload의 `to`에 적는다.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use atelier_core::{Attachment, RecordLog};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::discovery::Agent;
use crate::host::{Emit, HostEvent, QueuedMessage};
use crate::past;
use crate::quote::Quote;
use crate::runtime::{How, Withdrawal};
use crate::spec_changes::FileChange;

const AGENTS_FILE: &str = "agents.json";

/// `agents.json`의 대화 한 줄.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationRow {
    pub id: String,
    pub agent: Agent,
    pub name: String,
    /// 에이전트가 일하는 폴더. 대화를 만들 때 정해 되살릴 때도 그대로 쓴다(three-axes 결정 17).
    pub cwd: PathBuf,
    /// cwd와 함께 여는 폴더 — spec 폴더이거나 비었다.
    #[serde(default)]
    pub additional_directories: Vec<PathBuf>,
    pub agent_session_id: Option<String>,
    /// 모델 · 모드 · 계획. 비어 있으면 엔진 기본값이다(three-axes 결정 16).
    pub model: Option<String>,
    pub mode: Option<String>,
    pub plan: Option<bool>,
    pub created_at: String,
    pub closed_at: Option<String>,
    /// 모르는 칸은 다시 써도 남는다 — 다른 판의 앱이 더한 칸을 지우지 않게.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Default, Serialize, Deserialize)]
struct AgentsFile {
    #[serde(default)]
    conversations: Vec<ConversationRow>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

/// 기록을 읽거나 쓰지 못한 까닭 — 사람이 읽을 글이다.
pub(crate) type RecordError = String;

/// `agents.json`의 줄들. 폴더나 파일이 없으면 빈 목록이다. 깨진 파일은 오류다 — 그 위에 다시 쓰면 사람의
/// 손질을 덮는다.
pub(crate) fn read_rows(agents_dir: &Path) -> Result<Vec<ConversationRow>, RecordError> {
    Ok(read_agents_file(agents_dir)?.conversations)
}

fn read_agents_file(agents_dir: &Path) -> Result<AgentsFile, RecordError> {
    let path = agents_dir.join(AGENTS_FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|error| format!("대화 목록을 읽지 못했습니다: {} — {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AgentsFile::default()),
        Err(error) => Err(format!("대화 목록을 읽지 못했습니다: {} — {error}", path.display())),
    }
}

/// 그 줄을 `agents.json`에 넣는다 — 같은 id의 줄은 바꾸고, 없으면 끝에 더한다. 다른 줄은 그대로 둔다.
///
/// 읽고 고쳐 쓰는 사이를 부르는 쪽이 잠근다(호스트의 `agents` 잠금).
pub(crate) fn write_row(agents_dir: &Path, row: &ConversationRow) -> Result<(), RecordError> {
    let mut file = read_agents_file(agents_dir)?;
    match file.conversations.iter_mut().find(|existing| existing.id == row.id) {
        Some(existing) => *existing = row.clone(),
        None => file.conversations.push(row.clone()),
    }
    atelier_core::write_json_into_existing_dir(agents_dir, AGENTS_FILE, &file, "대화 목록을")
        .map_err(|error| format!("대화 목록을 쓰지 못했습니다: {} — {error}", agents_dir.join(AGENTS_FILE).display()))
}

/// `agents/` 폴더를 만든다. **부모(work 폴더)는 만들지 않는다** — 부르는 쪽이 `work.json`을 본 뒤에 부른다.
pub(crate) fn ensure_agents_dir(agents_dir: &Path) -> Result<(), RecordError> {
    match std::fs::create_dir(agents_dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(format!("기록 폴더를 만들지 못했습니다: {} — {error}", agents_dir.display())),
    }
}

/// 대화 기록 파일의 자리.
pub(crate) fn record_path(agents_dir: &Path, conversation: &str) -> PathBuf {
    agents_dir.join(format!("{conversation}.jsonl"))
}

/// 그 대화의 기록이 답하는 사실 — 호스트가 판단에 쓰는 것. 기록 파일은 여기서 한 번 읽는다. 없거나 읽지 못하면 아무것도
/// 적히지 않은 기록이다.
pub(crate) fn facts(agents_dir: &Path, conversation: &str) -> RecordFacts {
    RecordFacts { text: std::fs::read_to_string(record_path(agents_dir, conversation)).unwrap_or_default() }
}

/// 한 번 읽은 기록 — 사실마다 그 사실에 드는 줄만 읽는다. 마지막 seq는 끝 줄 하나로 답한다.
///
/// 줄을 읽는 규칙은 [`read_lines`]와 같다(코어의 한 벌) — 끝에 줄바꿈이 없는 꼬리(쓰는 중이거나 쓰다 끊긴 줄)는 세지 않고,
/// 읽을 수 없는 줄은 건너뛴다.
pub(crate) struct RecordFacts {
    text: String,
}

impl RecordFacts {
    /// 마지막으로 적힌 줄의 seq. 없으면 0이다. 이 판이 모르는 kind의 줄도 센다 — 이어 적는 줄이 그 seq를 다시 쓰지 않게.
    pub(crate) fn last_seq(&self) -> u64 {
        atelier_core::last_record_seq(&self.text)
    }

    /// 보낸 말(`sent`)이 있나 — 에이전트 바꾸기는 첫 말 전에만 된다(three-axes 결정 15).
    pub(crate) fn sent(&self) -> bool {
        self.lines().any(|line| line.kind == RecordKind::Sent)
    }

    /// 지금 에이전트 쪽 세션이 말을 받은 적이 있나 — 세션이 새로 선 마지막 열림 줄(`new` · `fresh`) 뒤에 `sent`가 있나. 되살린
    /// 열림(`resumed` · `loaded`)은 같은 세션을 이은 것이라 건너뛴다. 되살린 세션이 아직 첫 말을 받지 않았으면 그 첫 말에
    /// 머리말이 붙는다(S11, three-axes 티켓 10).
    pub(crate) fn sent_since_session_start(&self) -> bool {
        self.lines()
            .rev()
            .find_map(|line| match line.kind {
                RecordKind::Sent => Some(true),
                RecordKind::Session if starts_session(&line.payload) => Some(false),
                _ => None,
            })
            .unwrap_or(false)
    }

    fn lines(&self) -> impl DoubleEndedIterator<Item = RecordLine> + '_ {
        atelier_core::parse_records(&self.text)
    }
}

/// 에이전트 쪽 세션이 새로 선 열림 줄의 payload인가 — 길이 `new` · `fresh`인 열림.
pub(crate) fn starts_session(payload: &Value) -> bool {
    matches!(SessionState::deserialize(payload), Ok(SessionState::Opened { how, .. }) if how.starts_session())
}

// 기록 줄과 그 종류 · 읽기 · 시각은 코어의 것을 그대로 쓴다 — 앱(`chat:record` 이벤트)과 시험이 이 크레이트의 이름으로 부른다.
pub use atelier_core::{RecordKind, RecordLine};
pub(crate) use atelier_core::{read_records as read_lines, record_time as now};

/// `permission` 줄의 payload. `state`로 가르고, 같은 요청의 줄들은 `requestId`로 잇는다 — 기록은 덧붙이기만 하므로 답은
/// 물음 줄을 고치지 않고 뒤에 선다. 답하지 않은 물음(뒤에 답도 거둬짐도 없는 물음)이 화면의 승인 카드다(21).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub(crate) enum PermissionLine {
    /// 물음 — 요청 params 원문(선택지는 에이전트가 준 그대로)과 도구 요지(빈 칸을 앞선 `tool_call`로 채운 `toolCall`).
    Asked { request_id: String, request: Value, tool_call: Value },
    /// 답 — 사람이 고른 선택지.
    Answered { request_id: String, option_id: String },
    /// 거둬짐 — 우리가 턴을 끊었거나(`stopped`, 그 요청에 `cancelled`로 답했다), 에이전트가 답을 기다리지 않고 턴을
    /// 끝냈거나(`agent`), 에이전트 프로세스가 죽었다(`died` — 죽음 줄 앞에 선다, three-axes 티켓 10).
    Withdrawn { request_id: String, reason: Withdrawal },
}

/// `session` 줄의 payload. `state`로 가른다. 적는 쪽과 기록을 다시 읽는 쪽([`facts`])이 이 타입 하나를 쓴다 — 적을 때
/// 빼는 칸은 읽을 때 빈 값이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub(crate) enum SessionState {
    /// 띄우는 중 — 프로세스를 띄우기 직전. 다시 켠 뒤 · 죽은 뒤의 되살리기도 이 줄로 시작한다(three-axes 티켓 10).
    Spawning,
    /// 열림 — 어떻게 열렸나 · 에이전트 판 · 엔진이 준 모드 · 모델 · configOptions 원문. 길(`how`)은 넷이다(three-axes 티켓 10):
    /// `new`(새 대화의 첫 열기) · `resumed`(`session/resume`으로 이음) · `loaded`(`session/load`로 이음) · `fresh`(되살리려 했지만
    /// 잇지 못해 새 세션 — 화면의 「새로 시작함」 상태 줄). 세션을 연 답에 `_meta`가 있으면 그것도 싣는다 — Claude 변환기는
    /// claude의 `initialize` 답(계정 칸을 가린 것)을 여기 싣는다.
    Opened {
        how: How,
        agent_version: Option<String>,
        modes: Value,
        models: Value,
        config_options: Value,
        #[serde(default, skip_serializing_if = "Value::is_null")]
        meta: Value,
    },
    /// 계정 상태 — 에이전트가 알린 로그인 상태 원문(`_auth/status_update`의 params). 계정 칸은 런타임이 가렸다.
    AuthStatus { params: Value },
    /// 로그인 필요 — 에이전트가 `-32000 Authentication required`로 답했다(Codex `session/new`, 엔진을 가리지 않고 턴
    /// 도중). 화면은 대화창 자리에 안내 카드를 세우고, 로그인이 「됨」으로 바뀌면 호스트가 그 대화를 다시 띄운다
    /// (three-axes 티켓 12).
    LoginRequired,
    /// 판 경고 — 잰 적 없는 메이저 판이다. 대화는 그대로 연다(S6).
    VersionWarning { agent_version: Option<String>, supported_major: u64 },
    /// 죽음 — 에이전트가 없어졌다. 까닭과 stderr 꼬리(있으면). 다음 말에서 띄워 되살린다(three-axes 티켓 10).
    Died {
        reason: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        stderr_tail: Vec<String>,
    },
    /// 닫힘 — 대화가 꺼지고 다시 띄우지 않는다. 기록 파일은 남는다. 사람이 닫았으면 `cause`가 없고, 그 밖의
    /// 까닭이면 그것을 싣는다.
    Closed {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cause: Option<CloseCause>,
    },
}

/// 사람이 닫지 않았는데 대화가 닫힌 까닭.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CloseCause {
    /// work가 사라졌다(아카이브 · 삭제) — 그 턴이 끝난 뒤, 쉬고 있었으면 사라짐을 안 때 껐다(S10).
    WorkVanished,
}

/// `turn-end` 줄의 payload.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TurnEndLine {
    /// 에이전트가 준 끝 까닭(`end_turn` · `cancelled` · `max_tokens` …). 말을 받지 않았으면 null이다.
    pub stop_reason: Option<String>,
    /// 말을 보낸 때부터 턴이 끝날 때까지.
    pub duration_ms: u64,
    /// 우리가 `session/cancel`을 보냈나.
    pub cancelled_by_us: bool,
    /// 우리가 보내지 않은 턴(에이전트가 스스로 이어 간 턴)의 끝인가.
    pub out_of_turn: bool,
    /// `session/prompt`의 답 원문 — 사용량 같은 수치는 보이지 않고 기록만 한다.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response: Option<Value>,
    /// 에이전트가 말을 받지 않은 오류 원문(`{code, message, data?}`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

/// 기록 하나의 쓰는 손 — 대화 하나 또는 Thread 참여자 하나(v1 티켓 04). 런타임이 넘긴 것과 턴 차례의 줄은 모두 이것으로
/// 적는다.
pub(crate) struct Recorder {
    lines: Lines,
}

/// 줄이 가는 곳.
enum Lines {
    /// three-axes 대화 기록 — 대화마다 파일 하나다. 대화가 열려 있는 동안 파일을 연 채로 둔다 — work 폴더가 아카이브로
    /// 옮겨져도(같은 볼륨 안의 rename) 같은 파일에 이어 적힌다(S10).
    Conversation { work: String, conversation: String, emit: Arc<Emit>, log: Mutex<RecordLog> },
    /// Thread 참여자 하나의 Session — 같은 Thread의 참여자들이 기록 하나를 함께 쓰고, 줄마다 그 참여자의 handle(`who`)이
    /// 선다(v1 구현 스펙 S8).
    Thread { log: Arc<ThreadLog>, who: String },
}

impl Recorder {
    /// 기록 파일을 이어 쓰도록 연다. 파일은 만들어도 폴더는 만들지 않는다. 끝에 남은 반쪽 줄은 코어의 쓰기가 먼저 끊는다.
    pub(crate) fn open(agents_dir: &Path, work: &str, conversation: &str, emit: Arc<Emit>) -> Result<Self, RecordError> {
        let path = record_path(agents_dir, conversation);
        let log = RecordLog::open(&path)
            .map_err(|error| format!("기록 파일을 열지 못했습니다: {} — {error}", path.display()))?;
        Ok(Self {
            lines: Lines::Conversation {
                work: work.to_owned(),
                conversation: conversation.to_owned(),
                emit,
                log: Mutex::new(log),
            },
        })
    }

    /// Thread 참여자 하나의 쓰는 손 — 그 Thread의 기록에 그 handle로 적는다.
    pub(crate) fn of_thread(log: Arc<ThreadLog>, who: &str) -> Self {
        Self { lines: Lines::Thread { log, who: who.to_owned() } }
    }

    /// 이 기록의 대화 id 또는 Thread id — 사람이 읽을 오류에 싣는다.
    pub(crate) fn name(&self) -> &str {
        match &self.lines {
            Lines::Conversation { conversation, .. } => conversation,
            Lines::Thread { log, .. } => log.thread(),
        }
    }

    /// 대기 줄 바뀜(기록 밖의 소식)을 기록 줄과 같은 길로 내보낸다. 받는 closure는 호스트를 다시 부르면 안 된다.
    pub(crate) fn queue_changed(&self, queue: Vec<QueuedMessage>) {
        match &self.lines {
            Lines::Conversation { work, conversation, emit, .. } => {
                emit(HostEvent::Queue { work: work.clone(), conversation: conversation.clone(), queue })
            }
            Lines::Thread { log, who } => {
                log.announce(HostEvent::ThreadQueue { thread: log.thread().to_owned(), who: who.clone(), queue })
            }
        }
    }

    /// 마지막으로 적은 줄의 seq.
    pub(crate) fn last_seq(&self) -> u64 {
        match &self.lines {
            Lines::Conversation { log, .. } => log.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).last_seq(),
            Lines::Thread { log, .. } => log.last_seq(),
        }
    }

    pub(crate) fn session(&self, state: SessionState) -> Result<(), RecordError> {
        self.write(RecordKind::Session, serde_json::to_value(state).expect("session 줄은 JSON이다"))
    }

    /// 보낸 말. `prompt`는 에이전트에게 실제로 간 내용 블록 그대로다. 인용은 화면이 보낸 말 위에 세운다(스토리 81). 첨부는 화면이
    /// 말풍선 위 칩으로 세운다(v1 티켓 06).
    pub(crate) fn sent(
        &self,
        text: &str,
        quote: Option<&Quote>,
        attachments: &[Attachment],
        prompt: &[Value],
        send_now: bool,
    ) -> Result<(), RecordError> {
        let mut payload = json!({"text": text});
        // 인용 · 첨부는 붙은 말에만 칸이 선다(three-axes 티켓 27 · v1 티켓 06) — 없는 말은 앞 장의 꼴 그대로다.
        if let Some(quote) = quote {
            payload["quote"] = serde_json::to_value(quote).expect("인용은 JSON이다");
        }
        if !attachments.is_empty() {
            payload["attachments"] = serde_json::to_value(attachments).expect("첨부는 JSON이다");
        }
        payload["prompt"] = json!(prompt);
        payload["sendNow"] = json!(send_now);
        match &self.lines {
            Lines::Conversation { .. } => self.write(RecordKind::Sent, payload),
            // Thread에서는 사람의 줄이다 — `who` 없이 받는 참여자(`to`)를 싣는다(v1 구현 스펙 §4 · S8 · S9).
            Lines::Thread { log, who } => {
                payload["to"] = json!(who);
                log.write(RecordKind::Sent, None, payload).map(drop)
            }
        }
    }

    /// `session/update` 원문.
    pub(crate) fn update(&self, raw: Value) -> Result<(), RecordError> {
        self.write(RecordKind::Update, raw)
    }

    pub(crate) fn stderr(&self, line: String) -> Result<(), RecordError> {
        self.write(RecordKind::Stderr, json!({"line": line}))
    }

    /// 고친 곳 — 파일마다 바뀜 종류와, md 파일이면 새 글 기준의 바뀐 줄 범위.
    pub(crate) fn changes(&self, files: &[FileChange]) -> Result<(), RecordError> {
        self.write(RecordKind::Changes, json!({"files": files}))
    }

    pub(crate) fn permission(&self, line: PermissionLine) -> Result<(), RecordError> {
        self.write(RecordKind::Permission, serde_json::to_value(line).expect("permission 줄은 JSON이다"))
    }

    /// 사람이 바꾼 것 — `{"agent": "claude"}` · `{"model": "gpt-6-astra"}`처럼 바꾼 칸과 새 값.
    pub(crate) fn config(&self, changed: Value) -> Result<(), RecordError> {
        self.write(RecordKind::Config, changed)
    }

    pub(crate) fn turn_end(&self, end: TurnEndLine) -> Result<(), RecordError> {
        self.write(RecordKind::TurnEnd, serde_json::to_value(end).expect("turn-end 줄은 JSON이다"))
    }

    /// 지난 말 블록(v1 구현 스펙 S10) — 이 참여자의 Session이 아직 보지 못한 Thread의 말. 보낼 말 바로 앞에 짓는다. 대화 기록에는
    /// 없다 — 대화마다 에이전트가 하나다. 넘길 말이 없거나 기록을 읽지 못하면 블록이 없다 — 지난 말이 막혀도 말은 간다.
    pub(crate) fn past(&self) -> Option<Value> {
        let Lines::Thread { log, who } = &self.lines else { return None };
        match log.lines() {
            Ok(lines) => past::past(&lines, who, past::PAST_LIMIT).map(|text| json!({"type": "text", "text": text})),
            Err(error) => {
                eprintln!("{error}");
                None
            }
        }
    }

    /// 한 줄을 적고, 같은 줄을 기록 줄 이벤트로 내보낸다. 잠금을 쥔 채 내보낸다 — 이벤트의 순서가 seq의
    /// 순서다. **그래서 이벤트를 받는 closure는 호스트를 다시 부르면 안 된다.**
    ///
    /// 대화 기록의 줄에는 `who`가 없다 — 대화마다 에이전트가 하나다. Thread의 줄에는 그 참여자의 handle이 선다(v1 구현 스펙 S8).
    fn write(&self, kind: RecordKind, payload: Value) -> Result<(), RecordError> {
        match &self.lines {
            Lines::Conversation { work, conversation, emit, log } => {
                let mut log = log.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                let line = log
                    .append(kind, None, payload)
                    .map_err(|error| format!("기록을 쓰지 못했습니다: {conversation} — {error}"))?;
                emit(HostEvent::Record { work: work.clone(), conversation: conversation.clone(), line });
                Ok(())
            }
            Lines::Thread { log, who } => log.write(kind, Some(who), payload).map(drop),
        }
    }
}

/// Thread 하나의 기록 `events.jsonl` — 그 Thread의 참여자들([`Recorder::of_thread`])과 엔진(참여 줄)이 함께 쓴다(v1 티켓 04).
/// 열려 있는 동안 파일을 연 채로 둔다. 한 Thread에 하나만 연다 — 둘이면 seq를 따로 센다(호스트가 Thread마다 하나를 쥔다).
pub(crate) struct ThreadLog {
    thread: String,
    /// 데이터 루트 — 적힌 줄을 다시 읽을 때(지난 말) 쓴다.
    root: PathBuf,
    emit: Arc<Emit>,
    log: Mutex<RecordLog>,
}

impl ThreadLog {
    /// 연 기록을 쥔다 — 새 Thread의 것(`create_thread`)이거나 이어 연 것(`open_thread_log`)이다.
    pub(crate) fn new(root: &Path, thread: &str, log: RecordLog, emit: Arc<Emit>) -> Self {
        Self { thread: thread.to_owned(), root: root.to_owned(), emit, log: Mutex::new(log) }
    }

    pub(crate) fn thread(&self) -> &str {
        &self.thread
    }

    /// 적힌 줄 전부 — 파일에서 다시 읽는다(쓰는 잠금을 쥐지 않는다). 쓰는 중인 끝 줄은 읽지 않는다.
    pub(crate) fn lines(&self) -> Result<Vec<RecordLine>, RecordError> {
        atelier_core::read_thread_records(&self.root, &self.thread, 0)
            .map_err(|error| format!("Thread 기록을 읽지 못했습니다: {} — {error}", self.thread))
    }

    pub(crate) fn last_seq(&self) -> u64 {
        self.log.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).last_seq()
    }

    /// 한 줄을 적고 같은 줄을 기록 줄 이벤트로 내보낸다 — 잠금을 쥔 채 내보내므로 이벤트의 순서가 seq의 순서다. 적은 줄을
    /// 돌려준다(참여 줄의 시각이 참여자의 들어온 시각이다).
    pub(crate) fn write(&self, kind: RecordKind, who: Option<&str>, payload: Value) -> Result<RecordLine, RecordError> {
        let mut log = self.log.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let line = log
            .append(kind, who, payload)
            .map_err(|error| format!("Thread 기록을 쓰지 못했습니다: {} — {error}", self.thread))?;
        (self.emit)(HostEvent::ThreadRecord { thread: self.thread.clone(), line: line.clone() });
        Ok(line)
    }

    /// 이미 적힌 줄(새 Thread의 첫 줄)을 기록 줄 이벤트로 내보낸다. 이어 적기 전에 부른다 — 그래야 이벤트의 순서가 seq의 순서다.
    pub(crate) fn written(&self, line: RecordLine) {
        let _held = self.log.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        (self.emit)(HostEvent::ThreadRecord { thread: self.thread.clone(), line });
    }

    /// 기록 밖의 소식(대기 줄 바뀜 · 목록 요약)을 같은 길로 내보낸다.
    pub(crate) fn announce(&self, event: HostEvent) {
        (self.emit)(event);
    }
}

/// Thread의 그 참여자가 지금 Session에서 말을 받은 적이 있나 — 그 참여자의 Session이 새로 선 마지막 열림 줄(`new` · `fresh`)
/// 뒤에 그에게 간 `sent`가 있나. [`RecordFacts::sent_since_session_start`]의 Thread 판이다 — 되살린 Session이 아직 첫 말을 받지
/// 않았으면 그 첫 말에 머리말이 붙는다(v1 구현 스펙 S10).
pub(crate) fn heard_since_session_start(lines: &[RecordLine], who: &str) -> bool {
    lines
        .iter()
        .rev()
        .find_map(|line| match line.kind {
            RecordKind::Sent if line.payload["to"] == who => Some(true),
            RecordKind::Session if line.who.as_deref() == Some(who) && starts_session(&line.payload) => Some(false),
            _ => None,
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 기록이_없으면_적힌_줄도_보낸_말도_없다() {
        let agents = tempfile::tempdir().unwrap();
        let record = facts(agents.path(), "c1");
        assert_eq!((record.last_seq(), record.sent(), record.sent_since_session_start()), (0, false, false));
    }

    fn recorder(agents: &Path) -> Recorder {
        let emit: Arc<Emit> = Arc::new(|_| {});
        Recorder::open(agents, "cart", "c1", emit).expect("기록을 연다")
    }

    fn opened(how: How) -> SessionState {
        SessionState::Opened {
            how,
            agent_version: None,
            modes: Value::Null,
            models: Value::Null,
            config_options: Value::Null,
            meta: Value::Null,
        }
    }

    fn send(recorder: &Recorder, text: &str) {
        recorder.sent(text, None, &[], &[json!({"type": "text", "text": text})], false).unwrap();
    }

    #[test]
    fn 첫_말을_보내기_전에는_보낸_말이_없고_보낸_뒤에는_있다() {
        let agents = tempfile::tempdir().unwrap();
        let recorder = recorder(agents.path());
        recorder.session(SessionState::Spawning).unwrap();
        recorder.session(opened(How::New)).unwrap();
        let before = facts(agents.path(), "c1");
        assert_eq!((before.last_seq(), before.sent()), (2, false));

        send(&recorder, "첫 말");
        let after = facts(agents.path(), "c1");
        assert_eq!((after.last_seq(), after.sent()), (3, true));
    }

    #[test]
    fn 이_세션이_받은_말은_세션이_새로_선_new_fresh_열림_뒤의_말이고_resumed_loaded는_같은_세션이다() {
        let agents = tempfile::tempdir().unwrap();
        let recorder = recorder(agents.path());
        let in_session = || facts(agents.path(), "c1").sent_since_session_start();

        recorder.session(opened(How::New)).unwrap();
        assert!(!in_session(), "새로 선 세션은 아직 말을 받지 않았다");
        send(&recorder, "어제의 말");
        assert!(in_session());

        recorder.session(SessionState::Died { reason: "끝남".to_owned(), stderr_tail: Vec::new() }).unwrap();
        recorder.session(opened(How::Resumed)).unwrap();
        assert!(in_session(), "resume으로 이은 세션은 어제의 말을 받은 그 세션이다");
        recorder.session(opened(How::Loaded)).unwrap();
        assert!(in_session(), "load로 이은 세션도 그 세션이다");

        recorder.session(opened(How::Fresh)).unwrap();
        let fresh = facts(agents.path(), "c1");
        assert!(!fresh.sent_since_session_start(), "잇지 못해 새로 선 세션은 아직 말을 받지 않았다");
        assert!(fresh.sent(), "보낸 말은 그대로 있다 — 에이전트 바꾸기는 여전히 거절된다");
        send(&recorder, "오늘의 말");
        assert!(in_session());
    }

    #[test]
    fn 줄바꿈으로_끝나지_않은_꼬리는_쓰는_중인_줄이라_세지_않는다() {
        let agents = tempfile::tempdir().unwrap();
        let recorder = recorder(agents.path());
        recorder.session(opened(How::New)).unwrap();
        let path = record_path(agents.path(), "c1");
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str(r#"{"seq":2,"at":"2026-10-11T09:00:00.000+09:00","kind":"sent","payload":{"text":"쓰는 중"}}"#);
        std::fs::write(&path, text).unwrap();

        let record = facts(agents.path(), "c1");
        assert_eq!(
            (record.last_seq(), record.sent(), record.sent_since_session_start()),
            (1, false, false),
            "JSON으로 읽혀도 끝에 줄바꿈이 없으면 아직 적히지 않은 줄이다"
        );
    }

    #[test]
    fn 이_판이_모르는_줄도_seq는_센다_이어_적는_줄이_그_seq를_다시_쓰지_않게() {
        let agents = tempfile::tempdir().unwrap();
        let recorder = recorder(agents.path());
        recorder.session(opened(How::New)).unwrap();
        drop(recorder);
        let path = record_path(agents.path(), "c1");
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str("{\"seq\":2,\"at\":\"2026-10-11T09:00:00.000+09:00\",\"kind\":\"from-a-later-build\",\"payload\":{}}\n");
        text.push_str("쓰다 끊긴 꼬리를 앞선 열기가 줄바꿈으로 끊었다\n");
        std::fs::write(&path, text).unwrap();

        assert_eq!(facts(agents.path(), "c1").last_seq(), 2);
    }
}
