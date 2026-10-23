//! Thread 엔진의 이벤트를 화면에 잇는 자리(v1 티켓 04 · 구현 스펙 §18). **얇게 둔다** — 엔진은 대화 호스트(`chat::host`)에 함께
//! 살고, 여기는 그것이 내보내는 Thread의 것을 화면의 이벤트 이름과 싣는 꼴로 옮길 뿐이다. 쏘는 스레드는 `chat::announce` 하나다
//! — 한 스레드라 기록 줄의 차례가 그대로 간다.

use atelier_acp::HostEvent;
use serde_json::{json, Value};

/// Thread의 기록 줄 — `events.jsonl`에 적은 것과 같은 줄이 Thread id · seq와 함께 온다. 화면은 Thread를 이것 하나로 그린다.
///
/// 이벤트 이름 넷은 프런트(`src/features/thread/events.ts`)와 **문자열로만** 이어진다 — `events.test.ts`가 이 선언을 읽어 견준다.
/// Channel이 아니라 이벤트인 것은 work 대화와 같은 까닭이다: Thread는 새로고침을 넘어야 한다(⌘R에 Agent가 죽지 않는다).
pub const RECORD_EVENT: &str = "thread:record";
/// 참여자 하나의 Session의 대기 줄 바뀜 — Thread id · 참여자 handle · 대기 줄 전체. 대기 줄은 엔진 메모리에만 있다.
pub const QUEUE_EVENT: &str = "thread:queue";
/// Thread 하나의 목록 요약이 바뀜 — 새 Thread · 참여자가 늘었다. Thread 폴더는 감시하지 않으므로 엔진이 알린다(S7).
pub const LIST_EVENT: &str = "thread:list";
/// 엔진 상태 — work 대화의 `chat:engine`과 같은 것을 Thread 화면도 듣는다. 화면이 하나로 모이면(v1 티켓 08) 이것만 남는다.
pub const ENGINE_EVENT: &str = "thread:engine";

/// 엔진의 것 하나 → Thread 화면이 듣는 이름과 싣는 것. Thread의 것이 아니면(work 대화의 기록 · 대기 줄) 없다.
pub(crate) fn wire(event: &HostEvent) -> Option<(&'static str, Value)> {
    Some(match event {
        HostEvent::ThreadRecord { thread, line } => (RECORD_EVENT, json!({"thread": thread, "seq": line.seq, "line": line})),
        HostEvent::ThreadQueue { thread, who, queue } => (QUEUE_EVENT, json!({"thread": thread, "who": who, "queue": queue})),
        HostEvent::ThreadList(summary) => (LIST_EVENT, serde_json::to_value(summary).expect("Thread 요약은 JSON이다")),
        HostEvent::Engine(state) => (ENGINE_EVENT, serde_json::to_value(state).expect("엔진 상태는 JSON이다")),
        HostEvent::Record { .. } | HostEvent::Queue { .. } => return None,
    })
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
        let (name, payload) = wire(&HostEvent::ThreadRecord { thread: "20261023-100000".into(), line }).expect("Thread의 것");
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

    /// **대기 줄 바뀜은 Thread · 참여자 · 대기 줄 전체를, 목록 요약은 요약 한 줄을 싣는다.** 엔진 상태는 work 대화와 같은 꼴이다.
    #[test]
    fn the_queue_list_and_engine_events_carry_their_whole_value() {
        let queue = vec![atelier_acp::QueuedMessage { id: "q1".into(), text: "기다리는 말".into(), send_now: false }];
        let queued = HostEvent::ThreadQueue { thread: "20261023-100000".into(), who: "host".into(), queue };
        assert_eq!(
            wire(&queued),
            Some((
                "thread:queue",
                json!({"thread": "20261023-100000", "who": "host", "queue": [{"id": "q1", "text": "기다리는 말", "sendNow": false}]})
            ))
        );
        let summary = atelier_core::ThreadSummary {
            id: "20261023-100000".into(),
            title: "장바구니".into(),
            created_at: "2026-10-23T10:00:00.000+09:00".into(),
            work: None,
            handles: vec!["host".into()],
            broken: None,
        };
        assert_eq!(
            wire(&HostEvent::ThreadList(summary)),
            Some((
                "thread:list",
                json!({"id": "20261023-100000", "title": "장바구니", "createdAt": "2026-10-23T10:00:00.000+09:00",
                       "work": null, "handles": ["host"], "broken": null})
            ))
        );
        let engine = HostEvent::Engine(atelier_acp::EngineState {
            agent: atelier_acp::Agent::Claude,
            found: true,
            logged_in: Some(false),
            login: None,
        });
        assert_eq!(
            wire(&engine),
            Some(("thread:engine", json!({"agent": "claude", "found": true, "loggedIn": false, "login": null})))
        );
    }

    /// **work 대화의 기록 · 대기 줄은 Thread 화면에 가지 않는다** — 두 화면이 한 앱에 함께 사는 동안(v1 티켓 08까지) 서로의 줄을
    /// 그리지 않게.
    #[test]
    fn work_conversation_lines_do_not_reach_the_thread_screen() {
        let line = serde_json::from_value(json!({"seq": 1, "at": "x", "kind": "sent", "payload": {}})).expect("기록 줄");
        assert_eq!(wire(&HostEvent::Record { work: "cart".into(), conversation: "c1".into(), line }), None);
        assert_eq!(wire(&HostEvent::Queue { work: "cart".into(), conversation: "c1".into(), queue: Vec::new() }), None);
    }
}
