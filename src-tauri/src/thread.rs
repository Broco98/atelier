//! Thread 엔진을 앱에 잇는 자리(v1 티켓 04 · 구현 스펙 §18). **얇게 둔다** — 엔진(`atelier_acp::ConversationHost`)을 짓고, 그것이
//! 내보내는 것을 화면의 이벤트 이름과 싣는 꼴로 옮길 뿐이다. Thread의 몸통은 엔진에 있고, 명령은 `commands.rs`가 위임만 한다.
//!
//! 엔진은 앱 프로세스에 하나 산다 — 다른 화면으로 가거나 새로고침해도 Agent가 계속 돈다(three-axes S9). 끄는 것은 앱 종료
//! (`lib.rs`의 종료 훅)다. Processes 화면과 메모리 합계에는 넣지 않는다. three-axes의 Work 안 대화창(`chat_*` 명령 · `chat:*`
//! 이벤트)은 v1 티켓 08이 걷었다.

use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};

use atelier_acp::{ConversationHost, HostEvent, ShellSource, TranslatorCommand};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

/// Thread의 기록 줄 — `events.jsonl`에 적은 것과 같은 줄이 Thread id · seq와 함께 온다. 화면은 Thread를 이것 하나로 그린다.
///
/// 이벤트 이름들은 프런트(`src/features/thread/events.ts`)와 **문자열로만** 이어진다 — `events.test.ts`가 이 선언을 읽어 견준다.
/// Channel이 아니라 이벤트인 것은 Thread가 새로고침을 넘어야 해서다(⌘R에 Agent가 죽지 않는다): Channel은 페이지와 함께 죽는다.
pub const RECORD_EVENT: &str = "thread:record";
/// 참여자 하나의 Session의 대기 줄 바뀜 — Thread id · 참여자 handle · 대기 줄 전체. 대기 줄은 엔진 메모리에만 있다(S13).
pub const QUEUE_EVENT: &str = "thread:queue";
/// Thread 하나의 목록 요약이 바뀜 — 새 Thread · 참여자가 늘었다. Thread 폴더는 감시하지 않으므로 엔진이 알린다(S7).
pub const LIST_EVENT: &str = "thread:list";
/// 엔진 상태 — Runtime 엔진 · 찾음 여부 · 로그인 여부 · 로그인 진행(링크 · 끝남). Thread의 안내 카드가 이것으로 「로그인 안 됨 ·
/// 로그인 중 · 끝남」을 그린다(three-axes 티켓 12).
pub const ENGINE_EVENT: &str = "thread:engine";
/// Work 하나에서 지금 쓰는 중인 문서들 — Work slug · 그 Work의 목록 전체(문서 · 쓰는 Agent의 handle · 이름 · Thread). Work 카드의
/// 문서 줄이 파란 점과 「Host가 쓰는 중」을 세운다(v1 티켓 34 · 구현 스펙 §12 · §18).
pub const WRITING_EVENT: &str = "work:writing";

/// 앱의 Thread 엔진을 짓는다. 데이터 루트는 코어가 정하고(`ATELIER_HOME`), 로그인 셸은 사용자의 것이다.
///
/// - Session이 띄우는 Claude 변환기는 **이 실행 파일 자신**의 하위 모드 `acp-claude`다(갈래는 `main.rs`, three-axes 티켓 13). 그
///   이름은 진입점과 함께 쓰는 상수 [`atelier_acp::CLAUDE_TRANSLATOR_MODE`]다.
///   `exe`는 진입점이 한 번 읽어 넘긴다(워크플로 §1). 읽지 못했으면 빈 경로라 Session 열기만 그 자리에서 읽히는 오류로 실패한다.
/// - Session마다 claude가 띄우는 Thread 도구 중계 서버도 **이 실행 파일 자신**의 하위 모드 `thread-tools`다(v1 티켓 15 · S12,
///   상수 [`atelier_acp::THREAD_TOOLS_MODE`]). 엔진이 Session의 소켓 경로를 마지막 인자로 붙인다.
/// - 엔진이 내보내는 것은 `events`로 보낸다 — 앱 핸들이 서기 전(빌더 앞)에 지어지므로, 셋업이 건 [`announce`]가 받아 쏜다.
///   보내기는 막히지 않는다: 엔진은 기록의 잠금을 쥔 채 내보내므로 여기서 기다리면 Session이 멎는다.
pub fn host(exe: PathBuf, events: Sender<HostEvent>) -> ConversationHost {
    let relay = TranslatorCommand::new(exe.clone(), [atelier_acp::THREAD_TOOLS_MODE]);
    let translator = TranslatorCommand::new(exe, [atelier_acp::CLAUDE_TRANSLATOR_MODE]);
    ConversationHost::builder(atelier_core::data_root(), translator, ShellSource::User, move |event| {
        // 받는 스레드는 앱이 사는 동안 산다. 끊겼다면 앱이 끝나는 중이라 버린다.
        let _ = events.send(event);
    })
    .thread_tools(relay)
    .build()
}

/// 엔진이 내보낸 것을 화면으로 쏘는 스레드를 건다. 스레드 하나라 기록 줄의 차례가 그대로 간다. 셋업 전에 쌓인 것도 채널에
/// 남아 있다가 여기서 나간다 — 듣는 화면이 아직 없으면 사라지지만, 화면은 기록을 seq로 다시 읽는다.
pub fn announce(app: AppHandle, events: Receiver<HostEvent>) {
    std::thread::spawn(move || {
        for event in events {
            let (name, payload) = wire(&event);
            let _ = app.emit(name, payload);
        }
    });
}

/// 엔진의 것 하나 → 화면이 듣는 이름과 싣는 것. 싣는 꼴은 프런트의 `ThreadRecordEvent` · `ThreadQueueEvent` · `ThreadList` ·
/// `EngineState` · `WorkWritingEvent`와 같은 말이다.
fn wire(event: &HostEvent) -> (&'static str, Value) {
    match event {
        HostEvent::ThreadRecord { thread, line } => (RECORD_EVENT, json!({"thread": thread, "seq": line.seq, "line": line})),
        HostEvent::ThreadQueue { thread, who, queue } => (QUEUE_EVENT, json!({"thread": thread, "who": who, "queue": queue})),
        HostEvent::ThreadList(summary) => (LIST_EVENT, serde_json::to_value(summary).expect("Thread 요약은 JSON이다")),
        HostEvent::Engine(state) => (ENGINE_EVENT, serde_json::to_value(state).expect("엔진 상태는 JSON이다")),
        HostEvent::WorkWriting { work, writing } => (WRITING_EVENT, json!({"work": work, "writing": writing})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **Thread의 기록 줄 이벤트는 Thread id · seq · 줄을 싣는다**(v1 구현 스펙 §18). 줄은 `events.jsonl`의 한 줄 그대로다 —
    /// 참여자의 줄에는 `who`가 있고 사람의 줄에는 없다(S8). 칸 이름이 어긋나면 tsc도 IPC 검사도 못 본다.
    #[test]
    fn a_thread_record_event_carries_the_thread_the_seq_and_the_line() {
        let line = serde_json::from_value(json!({
            "seq": 7, "at": "2026-10-23T10:00:07.000+09:00", "kind": "turn-end", "who": "host",
            "payload": {"stopReason": "end_turn"},
        }))
        .expect("기록 줄");
        let (name, payload) = wire(&HostEvent::ThreadRecord { thread: "20261023-100000".into(), line });
        assert_eq!(name, "thread:record");
        assert_eq!(
            payload,
            json!({
                "thread": "20261023-100000",
                "seq": 7,
                "line": {"seq": 7, "at": "2026-10-23T10:00:07.000+09:00", "kind": "turn-end", "who": "host",
                         "payload": {"stopReason": "end_turn"}},
            })
        );
    }

    /// **대기 줄 바뀜은 Thread · 참여자 · 대기 줄 전체를, 목록 요약은 요약 한 줄을, 엔진 상태는 엔진 · 찾음 · 로그인 여부 ·
    /// 로그인 진행을 싣는다.** 안내 카드가 진행의 `state`로 「로그인 중(링크)」과 「끝남」을 가르고, 「링크 복사」는 `url`을 쓴다.
    #[test]
    fn the_queue_list_and_engine_events_carry_their_whole_value() {
        let queue = vec![atelier_acp::QueuedMessage { id: "q1".into(), text: "기다리는 말".into(), send_now: false }];
        let queued = HostEvent::ThreadQueue { thread: "20261023-100000".into(), who: "host".into(), queue };
        assert_eq!(
            wire(&queued),
            (
                "thread:queue",
                json!({"thread": "20261023-100000", "who": "host", "queue": [{"id": "q1", "text": "기다리는 말", "sendNow": false}]})
            )
        );
        let summary = atelier_core::ThreadSummary {
            id: "20261023-100000".into(),
            title: "장바구니".into(),
            created_at: "2026-10-23T10:00:00.000+09:00".into(),
            work: None,
            handles: vec!["host".into()],
            last_read: 7,
            broken: None,
        };
        assert_eq!(
            wire(&HostEvent::ThreadList(summary)),
            (
                "thread:list",
                json!({"id": "20261023-100000", "title": "장바구니", "createdAt": "2026-10-23T10:00:00.000+09:00",
                       "work": null, "handles": ["host"], "lastRead": 7, "broken": null})
            )
        );
        let engine = HostEvent::Engine(atelier_acp::EngineState {
            agent: atelier_acp::Agent::Claude,
            found: true,
            logged_in: Some(false),
            login: None,
        });
        assert_eq!(wire(&engine), ("thread:engine", json!({"agent": "claude", "found": true, "loggedIn": false, "login": null})));
        let running = HostEvent::Engine(atelier_acp::EngineState {
            agent: atelier_acp::Agent::Claude,
            found: true,
            logged_in: None,
            login: Some(atelier_acp::LoginProgress::Running { url: Some("https://claude.com/cai/oauth/authorize?x".into()) }),
        });
        assert_eq!(
            wire(&running).1,
            json!({"agent": "claude", "found": true, "loggedIn": null,
                   "login": {"state": "running", "url": "https://claude.com/cai/oauth/authorize?x"}}),
        );
        let ended = HostEvent::Engine(atelier_acp::EngineState {
            agent: atelier_acp::Agent::Claude,
            found: true,
            logged_in: Some(true),
            login: Some(atelier_acp::LoginProgress::Ended { cancelled: false, exit_code: Some(0) }),
        });
        assert_eq!(
            wire(&ended).1,
            json!({"agent": "claude", "found": true, "loggedIn": true,
                   "login": {"state": "ended", "cancelled": false, "exitCode": 0}}),
        );
    }

    /// **문서 쓰는 중은 Work와 그 Work의 목록 전체를 싣는다**(v1 티켓 34). 화면은 마지막 것 하나를 쥐므로 빈 목록도 그대로 간다.
    #[test]
    fn the_writing_event_carries_the_work_and_its_whole_list() {
        let writing = vec![atelier_acp::DocWriting {
            path: "design.md".into(),
            who: "host".into(),
            name: "Host".into(),
            thread: "20261023-100000".into(),
        }];
        assert_eq!(
            wire(&HostEvent::WorkWriting { work: "refund-api".into(), writing }),
            (
                "work:writing",
                json!({"work": "refund-api",
                       "writing": [{"path": "design.md", "who": "host", "name": "Host", "thread": "20261023-100000"}]})
            )
        );
        assert_eq!(
            wire(&HostEvent::WorkWriting { work: "refund-api".into(), writing: Vec::new() }).1,
            json!({"work": "refund-api", "writing": []})
        );
    }
}
