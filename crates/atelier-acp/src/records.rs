//! 기록 — Thread의 `events.jsonl`에 적는 줄들(v1 티켓 04).
//!
//! **줄 모양 · 줄 종류 · 반쪽 줄 규칙 · 덧붙이는 쓰기는 코어(`atelier_core`의 기록 줄)가 정본이다**(v1 티켓 02). 여기는 줄마다의
//! payload 모양과, 적은 줄을 이벤트로 내보내는 일만 갖는다.
//!
//! Thread 하나의 기록은 `ThreadLog` 하나이고, 참여자의 Session마다 쓰는 손(`Recorder`)이 그것을 함께 쥔다 — 참여자의 줄에는
//! `who`가 붙는다(S8). 사람이 보낸 줄에는 `who`가 없고 받는 이를 payload의 `to`에 적는다. three-axes의 work 대화 기록
//! (`works/<slug>/agents/`)은 v1 티켓 08이 걷었다 — 디스크에 남은 것은 옮기지도 띄우지도 않는다(구현 스펙 §4).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use atelier_core::{Attachment, RecordLog};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::host::{Emit, HostEvent, QueuedMessage};
use crate::past;
use crate::policy::Card;
use crate::quote::Quote;
use crate::runtime::{How, Withdrawal};

/// 기록을 읽거나 쓰지 못한 까닭 — 사람이 읽을 글이다.
pub(crate) type RecordError = String;

/// Runtime 쪽 세션이 새로 선 열림 줄의 payload인가 — 길이 `new` · `fresh`인 열림.
pub(crate) fn starts_session(payload: &Value) -> bool {
    matches!(SessionState::deserialize(payload), Ok(SessionState::Opened { how, .. }) if how.starts_session())
}

// 기록 줄과 그 종류는 코어의 것을 그대로 쓴다 — 앱(`thread:record` 이벤트)과 시험이 이 크레이트의 이름으로 부른다.
pub use atelier_core::{RecordKind, RecordLine};

/// `permission` 줄의 payload. `state`로 가르고, 같은 요청의 줄들은 `requestId`로 잇는다 — 기록은 덧붙이기만 하므로 답은
/// 물음 줄을 고치지 않고 뒤에 선다. 답하지 않은 물음(뒤에 답도 거둬짐도 없는 물음)이 화면의 승인 카드다(21).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub(crate) enum PermissionLine {
    /// 물음 — 요청 params 원문(선택지는 에이전트가 준 그대로)과 도구 요지(빈 칸을 앞선 `tool_call`로 채운 `toolCall`). 판정이
    /// 물었으면(v1 티켓 22) 세울 카드의 종류(`card`: `command` · `edit` · `plan`)와 왜 묻는지(`policy`: Policy 이름)를 함께 싣는다.
    Asked {
        request_id: String,
        request: Value,
        tool_call: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        card: Option<Card>,
        #[serde(skip_serializing_if = "Option::is_none")]
        policy: Option<String>,
    },
    /// 답 — 사람이 고른 선택지.
    Answered { request_id: String, option_id: String },
    /// 거둬짐 — 우리가 턴을 끊었거나(`stopped`, 그 요청에 `cancelled`로 답했다), 에이전트가 답을 기다리지 않고 턴을
    /// 끝냈거나(`agent`), 에이전트 프로세스가 죽었다(`died` — 죽음 줄 앞에 선다, three-axes 티켓 10).
    Withdrawn { request_id: String, reason: Withdrawal },
    /// 판정 — 엔진이 사람에게 묻지 않고 고른 선택지와 그 까닭(v1 티켓 18 · 22). 허용이면 까닭이 「자동으로 허용함」 줄의 글이고,
    /// 거절이면 Agent에게 돌려준 글이다 — 어느 쪽인지는 고른 선택지의 `kind`(요청의 `options`)가 가른다. 받은 자리에서 판정했으면
    /// 물음 줄이 없으므로 요청 원문과 도구 요지를 함께 싣는다. 걸린 물음에 엔진이 답했으면(사람의 허락이 쓰기 자리에 막힘) 그 둘은
    /// 물음 줄에 있다.
    Decided {
        request_id: String,
        option_id: String,
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        request: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_call: Option<Value>,
    },
}

/// `session` 줄의 payload. `state`로 가른다. 적는 쪽과 기록을 다시 읽는 쪽([`heard_since_session_start`])이 이 타입 하나를
/// 쓴다 — 적을 때 빼는 칸은 읽을 때 빈 값이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub(crate) enum SessionState {
    /// 띄우는 중 — 프로세스를 띄우기 직전. 다시 켠 뒤 · 죽은 뒤의 되살리기도 이 줄로 시작한다(three-axes 티켓 10).
    Spawning,
    /// 열림 — 어떻게 열렸나 · Runtime 판 · Runtime이 준 모드 · 모델 · configOptions 원문. 길(`how`)은 넷이다(three-axes 티켓 10):
    /// `new`(새 Session의 첫 열기) · `resumed`(`session/resume`으로 이음) · `loaded`(`session/load`로 이음) · `fresh`(되살리려 했지만
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
    /// 로그인 필요 — Runtime이 `-32000 Authentication required`로 답했다(엔진을 가리지 않고 `session/new` · 턴 도중). 화면은
    /// Thread 본문 자리에 안내 카드를 세우고, 로그인이 「됨」으로 바뀌면 호스트가 그 Session을 다시 띄운다(three-axes 티켓 12).
    LoginRequired,
    /// 죽음 — 에이전트가 없어졌다. 까닭과 stderr 꼬리(있으면). 다음 말에서 띄워 되살린다(three-axes 티켓 10).
    Died {
        reason: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        stderr_tail: Vec<String>,
    },
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

/// 기록 하나의 쓰는 손 — Thread 참여자 하나의 Session(v1 티켓 04). 같은 Thread의 참여자들이 기록 하나를 함께 쓰고, 줄마다 그
/// 참여자의 handle(`who`)이 선다(v1 구현 스펙 S8). 런타임이 넘긴 것과 턴 차례의 줄은 모두 이것으로 적는다.
pub(crate) struct Recorder {
    log: Arc<ThreadLog>,
    who: String,
}

impl Recorder {
    /// Thread 참여자 하나의 쓰는 손 — 그 Thread의 기록에 그 handle로 적는다.
    pub(crate) fn of_thread(log: Arc<ThreadLog>, who: &str) -> Self {
        Self { log, who: who.to_owned() }
    }

    /// 이 기록의 Thread id — 사람이 읽을 오류에 싣는다.
    pub(crate) fn name(&self) -> &str {
        self.log.thread()
    }

    /// 대기 줄 바뀜(기록 밖의 소식)을 기록 줄과 같은 길로 내보낸다. 받는 closure는 호스트를 다시 부르면 안 된다.
    pub(crate) fn queue_changed(&self, queue: Vec<QueuedMessage>) {
        self.log.announce(HostEvent::ThreadQueue { thread: self.log.thread().to_owned(), who: self.who.clone(), queue })
    }

    pub(crate) fn session(&self, state: SessionState) -> Result<(), RecordError> {
        self.write(RecordKind::Session, serde_json::to_value(state).expect("session 줄은 JSON이다"))
    }

    /// 보낸 말 — 사람의 줄이라 `who` 없이 받는 참여자(`to`)를 싣는다(v1 구현 스펙 §4 · S8 · S9). `prompt`는 Runtime에게 실제로 간
    /// 내용 블록 그대로다. 인용은 화면이 보낸 말 위에 세운다(three-axes 스토리 81). 첨부는 화면이 말풍선 위 칩으로 세운다(v1 티켓 06).
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
        payload["to"] = json!(self.who);
        self.log.write(RecordKind::Sent, None, payload).map(drop)
    }

    /// Agent 호출 줄(v1 티켓 16) — 줄의 참여자(`who`)는 이 기록의 참여자가 아니라 부른 Agent(`from`)다(S8: 그 줄의 참여자). 불린
    /// Agent의 Session이 맡긴 일을 받는 자리(시작 줄)에서 적는다.
    pub(crate) fn call(&self, from: &str, payload: Value) -> Result<(), RecordError> {
        self.log.write(RecordKind::Call, Some(from), payload).map(drop)
    }

    /// `session/update` 원문.
    pub(crate) fn update(&self, raw: Value) -> Result<(), RecordError> {
        self.write(RecordKind::Update, raw)
    }

    pub(crate) fn stderr(&self, line: String) -> Result<(), RecordError> {
        self.write(RecordKind::Stderr, json!({"line": line}))
    }

    pub(crate) fn permission(&self, line: PermissionLine) -> Result<(), RecordError> {
        self.write(RecordKind::Permission, serde_json::to_value(line).expect("permission 줄은 JSON이다"))
    }

    /// 사람이 바꾼 것 — `{"model": "sonnet"}` · `{"effort": "high"}`처럼 바꾼 칸과 새 값.
    pub(crate) fn config(&self, changed: Value) -> Result<(), RecordError> {
        self.write(RecordKind::Config, changed)
    }

    pub(crate) fn turn_end(&self, end: TurnEndLine) -> Result<(), RecordError> {
        self.write(RecordKind::TurnEnd, serde_json::to_value(end).expect("turn-end 줄은 JSON이다"))
    }

    /// 지난 말 블록(v1 구현 스펙 S10) — 이 참여자의 Session이 아직 보지 못한 Thread의 말. 보낼 말 바로 앞에 짓는다. 넘길 말이
    /// 없거나 기록을 읽지 못하면 블록이 없다 — 지난 말이 막혀도 말은 간다.
    pub(crate) fn past(&self) -> Option<Value> {
        match self.log.lines() {
            Ok(lines) => past::past(&lines, &self.who, past::PAST_LIMIT).map(|text| json!({"type": "text", "text": text})),
            Err(error) => {
                eprintln!("{error}");
                None
            }
        }
    }

    /// 한 줄을 그 참여자의 handle로 적고, 같은 줄을 기록 줄 이벤트로 내보낸다([`ThreadLog::write`]).
    fn write(&self, kind: RecordKind, payload: Value) -> Result<(), RecordError> {
        self.log.write(kind, Some(&self.who), payload).map(drop)
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
/// 뒤에 그에게 간 말(사람의 말 · 맡긴 일, [`past::addressed_to`])이 있나. 되살린 열림(`resumed` · `loaded`)은 같은 Session을 이은
/// 것이라 건너뛴다. 되살린 Session이 아직 첫 말을 받지 않았으면 그 첫 말에 머리말이 붙는다(v1 구현 스펙 S10 · three-axes 티켓 10).
pub(crate) fn heard_since_session_start(lines: &[RecordLine], who: &str) -> bool {
    lines
        .iter()
        .rev()
        .find_map(|line| {
            if past::addressed_to(line, who) {
                return Some(true);
            }
            (line.kind == RecordKind::Session && line.who.as_deref() == Some(who) && starts_session(&line.payload))
                .then_some(false)
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(seq: u64, kind: RecordKind, who: Option<&str>, payload: Value) -> RecordLine {
        let mut line = json!({"seq": seq, "at": "2026-10-23T10:00:00.000+09:00", "kind": kind, "payload": payload});
        if let Some(who) = who {
            line["who"] = json!(who);
        }
        serde_json::from_value(line).expect("기록 줄")
    }

    fn opened(seq: u64, who: &str, how: How) -> RecordLine {
        let state = SessionState::Opened {
            how,
            agent_version: None,
            modes: Value::Null,
            models: Value::Null,
            config_options: Value::Null,
            meta: Value::Null,
        };
        line(seq, RecordKind::Session, Some(who), serde_json::to_value(state).unwrap())
    }

    fn sent(seq: u64, to: &str) -> RecordLine {
        line(seq, RecordKind::Sent, None, json!({"text": "말", "to": to}))
    }

    #[test]
    fn 이_session이_받은_말은_session이_새로_선_new_fresh_열림_뒤의_말이고_resumed_loaded는_같은_session이다() {
        let mut lines = vec![opened(1, "host", How::New)];
        assert!(!heard_since_session_start(&lines, "host"), "새로 선 Session은 아직 말을 받지 않았다");
        lines.push(sent(2, "host"));
        assert!(heard_since_session_start(&lines, "host"));

        lines.push(opened(3, "host", How::Resumed));
        assert!(heard_since_session_start(&lines, "host"), "resume으로 이은 Session은 어제의 말을 받은 그 Session이다");
        lines.push(opened(4, "host", How::Loaded));
        assert!(heard_since_session_start(&lines, "host"), "load로 이은 Session도 그 Session이다");

        lines.push(opened(5, "host", How::Fresh));
        assert!(!heard_since_session_start(&lines, "host"), "잇지 못해 새로 선 Session은 아직 말을 받지 않았다");
        lines.push(sent(6, "host"));
        assert!(heard_since_session_start(&lines, "host"));
    }

    #[test]
    fn 다른_참여자의_열림과_그에게_간_말은_세지_않는다() {
        let lines = vec![opened(1, "host", How::New), sent(2, "host"), opened(3, "reviewer", How::New), sent(4, "reviewer")];
        assert!(heard_since_session_start(&lines, "host"), "리뷰어의 새 Session이 Host의 Session을 끊지 않는다");
        let lines = vec![opened(1, "host", How::New), opened(2, "reviewer", How::New), sent(3, "reviewer")];
        assert!(!heard_since_session_start(&lines, "host"), "리뷰어에게 간 말은 Host가 받은 말이 아니다");
    }
}
