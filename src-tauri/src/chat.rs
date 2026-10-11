//! 대화 호스트를 앱에 잇는 자리(three-axes 티켓 05). **얇게 둔다** — 호스트(`atelier_acp::ConversationHost`)를 짓고, 그것이
//! 내보내는 것을 화면의 이벤트로 옮길 뿐이다. 대화창의 몸통은 호스트에 있고, 명령은 `commands.rs`가 위임만 한다.
//!
//! 호스트는 앱 프로세스에 하나 산다 — 다른 work로 가거나 화면을 새로고침해도 에이전트가 계속 돈다(S9). 끄는 것은 앱 종료
//! (`lib.rs`의 종료 훅)와 대화 닫기뿐이다(three-axes 결정 19). Processes 화면과 메모리 합계에는 넣지 않는다.

use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};

use atelier_acp::{ConversationHost, HostEvent, ShellSource, TranslatorCommand};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// 기록 줄 — 기록 파일에 적은 것과 같은 줄이 work · 대화 · seq와 함께 온다. 화면은 대화를 이것 하나로 그린다.
///
/// 이벤트 이름 셋은 프런트(`src/features/chat/api.ts`)와 **문자열로만** 이어진다 — `api.test.ts`가 이 선언을 읽어 견준다.
/// Channel이 아니라 이벤트인 것은 대화가 새로고침을 넘어야 해서다: Channel은 페이지와 함께 죽는다.
pub const RECORD_EVENT: &str = "chat:record";
/// 대기 줄 바뀜 — work · 대화 · 대기 줄 전체. 대기 줄은 호스트 메모리에만 있고 기록에 없다(S13).
pub const QUEUE_EVENT: &str = "chat:queue";
/// 엔진 상태 — 에이전트 · 찾음 여부 · 로그인 여부 · 로그인 진행(링크 · 끝남). 안내 카드가 이것으로 「로그인 안 됨 · 로그인
/// 중 · 끝남」을 그린다(three-axes 티켓 12).
pub const ENGINE_EVENT: &str = "chat:engine";

/// 앱의 대화 호스트를 짓는다. 데이터 루트는 코어가 정하고(`ATELIER_HOME`), 로그인 셸은 사용자의 것이다.
///
/// - Claude 대화가 띄우는 변환기는 **이 실행 파일 자신**의 하위 모드 `acp-claude`다(갈래는 `main.rs`, three-axes 티켓 13). 그
///   이름은 진입점과 함께 쓰는 상수 [`atelier_acp::CLAUDE_TRANSLATOR_MODE`]다.
///   `exe`는 진입점이 한 번 읽어 넘긴다(워크플로 §1). 읽지 못했으면 빈 경로라 Claude 열기만 그 자리에서 읽히는 오류로 실패한다.
/// - 호스트가 내보내는 것은 `events`로 보낸다 — 앱 핸들이 서기 전(빌더 앞)에 지어지므로, 셋업이 건 [`announce`]가 받아
///   쏜다. 보내기는 막히지 않는다: 호스트는 기록의 잠금을 쥔 채 내보내므로 여기서 기다리면 대화가 멎는다.
pub fn host(exe: PathBuf, events: Sender<HostEvent>) -> ConversationHost {
    let translator = TranslatorCommand::new(exe, [atelier_acp::CLAUDE_TRANSLATOR_MODE]);
    ConversationHost::builder(atelier_core::data_root(), translator, ShellSource::User, move |event| {
        // 받는 스레드는 앱이 사는 동안 산다. 끊겼다면 앱이 끝나는 중이라 버린다.
        let _ = events.send(event);
    })
    .build()
}

/// 호스트가 내보낸 것을 화면으로 쏘는 스레드를 건다. 스레드 하나라 기록 줄의 차례가 그대로 간다. 셋업 전에 쌓인 것도
/// 채널에 남아 있다가 여기서 나간다 — 듣는 화면이 아직 없으면 사라지지만, 화면은 기록을 seq로 다시 읽는다.
pub fn announce(app: AppHandle, events: Receiver<HostEvent>) {
    std::thread::spawn(move || {
        for event in events {
            let (name, payload) = wire(&event);
            let _ = app.emit(name, payload);
        }
    });
}

/// 호스트의 것 하나 → 화면이 듣는 이름과 싣는 것. 싣는 꼴은 프런트의 `ChatRecordEvent` · `ChatQueueEvent` ·
/// `ChatEngineEvent`와 같은 말이다.
fn wire(event: &HostEvent) -> (&'static str, Value) {
    match event {
        HostEvent::Record { work, conversation, line } => (
            RECORD_EVENT,
            json!({"work": work, "conversation": conversation, "seq": line.seq, "line": line}),
        ),
        HostEvent::Queue { work, conversation, queue } => {
            (QUEUE_EVENT, json!({"work": work, "conversation": conversation, "queue": queue}))
        }
        HostEvent::Engine(state) => (ENGINE_EVENT, serde_json::to_value(state).expect("엔진 상태는 JSON이다")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **기록 줄 이벤트는 work · 대화 · seq · 줄을 싣는다**(three-axes 구현 스펙 「대화 호스트 › 나오는 것」). 줄은 기록 파일의
    /// 한 줄 그대로다 — 화면은 이것으로 그리고, 어느 work의 어느 대화인지로 다른 work에 가 있어도 쌓는다. 칸 이름이
    /// 어긋나면 tsc도 IPC 검사도 못 본다(이벤트는 문자열과 JSON으로만 건넌다).
    #[test]
    fn a_record_event_carries_the_work_the_conversation_the_seq_and_the_line() {
        let line = serde_json::from_value(json!({
            "seq": 3,
            "at": "2026-10-11T00:43:20.123+09:00",
            "kind": "turn-end",
            "payload": {"stopReason": "end_turn"},
        }))
        .expect("기록 줄");
        let (name, payload) = wire(&HostEvent::Record { work: "cart".into(), conversation: "c1".into(), line });
        assert_eq!(name, "chat:record");
        assert_eq!(
            payload,
            json!({
                "work": "cart",
                "conversation": "c1",
                "seq": 3,
                "line": {
                    "seq": 3,
                    "at": "2026-10-11T00:43:20.123+09:00",
                    "kind": "turn-end",
                    "payload": {"stopReason": "end_turn"},
                },
            }),
        );
    }

    /// **대기 줄 바뀜은 work · 대화 · 대기 줄 전체를 싣는다**(three-axes 구현 스펙 「대화 호스트 › 나오는 것」 · 티켓 07). 대기
    /// 줄은 기록에 없어서(S13) 화면은 이것과 대화 목록으로만 「대기 중」을 그린다 — 바뀐 하나가 아니라 줄 전체라 차례가
    /// 그대로 온다. 대기 말의 칸 이름은 프런트의 `QueuedMessage`와 같은 말이다.
    #[test]
    fn a_queue_event_carries_the_work_the_conversation_and_the_whole_queue() {
        let queue = vec![
            atelier_acp::QueuedMessage { id: "q2".into(), text: "지금 보낼 말".into(), send_now: true },
            atelier_acp::QueuedMessage { id: "q1".into(), text: "기다리는 말".into(), send_now: false },
        ];
        let (name, payload) = wire(&HostEvent::Queue { work: "cart".into(), conversation: "c1".into(), queue });
        assert_eq!(name, "chat:queue");
        assert_eq!(
            payload,
            json!({
                "work": "cart",
                "conversation": "c1",
                "queue": [
                    {"id": "q2", "text": "지금 보낼 말", "sendNow": true},
                    {"id": "q1", "text": "기다리는 말", "sendNow": false},
                ],
            }),
        );
    }

    /// **엔진 상태 이벤트는 에이전트 · 찾음 여부 · 로그인 여부 · 로그인 진행을 싣는다**(three-axes 구현 스펙 「대화 호스트 ›
    /// 나오는 것」). 안내 카드가 진행의 `state`로 「로그인 중(링크)」과 「끝남」을 가르고, 「링크 복사」는 `url`을 쓴다 —
    /// 프런트의 `ChatEngineEvent`와 같은 말이다.
    #[test]
    fn an_engine_event_carries_the_agent_found_logged_in_and_the_login_progress() {
        use atelier_acp::{Agent, EngineState, LoginProgress};

        let running = HostEvent::Engine(EngineState {
            agent: Agent::Claude,
            found: true,
            logged_in: None,
            login: Some(LoginProgress::Running { url: Some("https://claude.com/cai/oauth/authorize?x".into()) }),
        });
        assert_eq!(
            wire(&running),
            (
                "chat:engine",
                json!({
                    "agent": "claude", "found": true, "loggedIn": null,
                    "login": {"state": "running", "url": "https://claude.com/cai/oauth/authorize?x"},
                }),
            ),
        );
        let ended = HostEvent::Engine(EngineState {
            agent: Agent::Codex,
            found: true,
            logged_in: Some(true),
            login: Some(LoginProgress::Ended { cancelled: false, exit_code: Some(0) }),
        });
        assert_eq!(
            wire(&ended).1,
            json!({"agent": "codex", "found": true, "loggedIn": true,
                   "login": {"state": "ended", "cancelled": false, "exitCode": 0}}),
        );
        let missing = HostEvent::Engine(EngineState { agent: Agent::Codex, found: false, logged_in: None, login: None });
        assert_eq!(wire(&missing).1, json!({"agent": "codex", "found": false, "loggedIn": null, "login": null}));
    }
}
