//! Thread 엔진을 앱에 잇는 자리(v1 티켓 04 · 구현 스펙 §18). **얇게 둔다** — 엔진(`atelier_acp::ConversationHost`)을 짓고, 그것이
//! 내보내는 것을 화면의 이벤트 이름과 싣는 꼴로 옮길 뿐이다. Thread의 몸통은 엔진에 있고, 명령은 `commands.rs`가 위임만 한다.
//!
//! 엔진은 앱 프로세스에 하나 산다 — 다른 화면으로 가거나 새로고침해도 Agent가 계속 돈다(three-axes S9). 끄는 것은 앱 종료
//! (`lib.rs`의 종료 훅)다. 엔진이 띄우는 Runtime에는 그 채팅의 표식을 심게 한다 — `Processes`가 Runtime과 그것이 띄운 것을 「채팅」
//! 구획에 채팅마다 세우고 아틀리에 합계에 넣는다(restart 03-7). three-axes의 Work 안 대화창(`chat_*` 명령 · `chat:*` 이벤트)은 v1 티켓
//! 08이 걷었다.

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
/// 흐르는 글 한 조각 — Thread id · 조각. 기록하지 않는 화면의 몫이고(스펙 「01b — 스트리밍」), 같은 흐름의 기록 줄이 오면 화면이 지운다.
pub const CHUNK_EVENT: &str = "thread:chunk";
/// Thread의 Session의 대기 줄 바뀜 — Thread id · 대기 줄 전체. 대기 줄은 엔진 메모리에만 있다(S13).
pub const QUEUE_EVENT: &str = "thread:queue";
/// Thread 하나의 목록 요약이 바뀜 — 새 Thread · 이름 · 읽은 자리. Thread 폴더는 감시하지 않으므로 엔진이 알린다(S7).
pub const LIST_EVENT: &str = "thread:list";
/// 엔진 상태 — Runtime 엔진 · 찾음 여부 · 로그인 여부 · 로그인 진행(링크 · 끝남). Thread의 안내 카드가 이것으로 「로그인 안 됨 ·
/// 로그인 중 · 끝남」을 그린다(three-axes 티켓 12).
pub const ENGINE_EVENT: &str = "thread:engine";
/// Work 하나에서 지금 쓰는 중인 문서들 — Work slug · 그 Work의 목록 전체(문서 · Thread). Work 카드의 문서 줄이 파란 점과 「쓰는 중」을
/// 세운다(v1 티켓 34 · 구현 스펙 §12 · §18).
pub const WRITING_EVENT: &str = "work:writing";

/// 앱의 Thread 엔진을 짓는다. 데이터 루트는 코어가 정하고(`ATELIER_HOME`), 로그인 셸은 사용자의 것이다.
///
/// - Session이 띄우는 Claude 변환기는 **이 실행 파일 자신**의 하위 모드 `acp-claude`다(갈래는 `main.rs`, three-axes 티켓 13). 그
///   이름은 진입점과 함께 쓰는 상수 [`atelier_acp::CLAUDE_TRANSLATOR_MODE`]다.
///   `exe`는 진입점이 한 번 읽어 넘긴다(워크플로 §1). 읽지 못했으면 빈 경로라 Session 열기만 그 자리에서 읽히는 오류로 실패한다.
/// - Session마다 claude가 띄우는 Thread 도구 중계 서버도 **이 실행 파일 자신**의 하위 모드 `thread-tools`다(v1 티켓 15 · S12,
///   상수 [`atelier_acp::THREAD_TOOLS_MODE`]). 엔진이 Session의 소켓 경로를 마지막 인자로 붙인다.
/// - Session마다 띄우는 Runtime에 **그 채팅의 표식**을 심는다(restart 03-7) — 값은 이 실행의 Runtime 키(`processes::runtime_key::mint` —
///   `<세대>:<채팅 id>`)다. Runtime의 자손이 물려받아, 수집이 부모가 먼저 죽은 dev 서버까지 그 채팅에 묶고 앱 종료가 끝낸다.
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
    .mark_runtimes(crate::processes::runtime_key::mint)
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

/// 엔진의 것 하나 → 화면이 듣는 이름과 싣는 것. 싣는 꼴은 프런트의 `ThreadRecordEvent` · `ThreadChunkEvent` · `ThreadQueueEvent` ·
/// `ThreadList` · `EngineState` · `WorkWritingEvent`와 같은 말이다.
fn wire(event: &HostEvent) -> (&'static str, Value) {
    match event {
        HostEvent::ThreadRecord { thread, line } => (RECORD_EVENT, json!({"thread": thread, "seq": line.seq, "line": line})),
        HostEvent::ThreadChunk { thread, chunk } => (CHUNK_EVENT, json!({"thread": thread, "chunk": chunk})),
        HostEvent::ThreadQueue { thread, queue } => (QUEUE_EVENT, json!({"thread": thread, "queue": queue})),
        HostEvent::ThreadList(summary) => (LIST_EVENT, serde_json::to_value(summary).expect("Thread 요약은 JSON이다")),
        HostEvent::Engine(state) => (ENGINE_EVENT, serde_json::to_value(state).expect("엔진 상태는 JSON이다")),
        HostEvent::WorkWriting { work, writing } => (WRITING_EVENT, json!({"work": work, "writing": writing})),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **Thread의 기록 줄 이벤트는 Thread id · seq · 줄을 싣는다**(v1 구현 스펙 §18). 줄은 `events.jsonl`의 한 줄 그대로다.
    /// 칸 이름이 어긋나면 tsc도 IPC 검사도 못 본다.
    #[test]
    fn a_thread_record_event_carries_the_thread_the_seq_and_the_line() {
        let line = serde_json::from_value(json!({
            "seq": 7, "at": "2026-10-23T10:00:07.000+09:00", "kind": "turn-end",
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
                "line": {"seq": 7, "at": "2026-10-23T10:00:07.000+09:00", "kind": "turn-end",
                         "payload": {"stopReason": "end_turn"}},
            })
        );
    }

    /// **흐르는 글의 조각은 Thread와 흐름 번호 · 종류 · 오프셋 · 글을 싣는다**(스펙 「01b — 스트리밍」). 화면이 번호로 지우고 오프셋으로 잇는다.
    #[test]
    fn a_flow_chunk_event_carries_the_thread_and_the_chunk() {
        let chunk = atelier_acp::FlowChunk {
            stream: 3,
            kind: atelier_acp::FlowKind::Thought,
            offset: 12,
            text: "살펴본다".into(),
            discarded: false,
        };
        assert_eq!(
            wire(&HostEvent::ThreadChunk { thread: "20261023-100000".into(), chunk }),
            (
                "thread:chunk",
                json!({"thread": "20261023-100000",
                       "chunk": {"stream": 3, "kind": "thought", "offset": 12, "text": "살펴본다"}})
            )
        );
    }

    /// **대기 줄 바뀜은 Thread · 대기 줄 전체를, 목록 요약은 요약 한 줄을, 엔진 상태는 엔진 · 찾음 · 로그인 여부 · 빠진 것을
    /// 싣는다.** 로그인 진행은 없다 — 로그인은 Terminal의 셸에서 한다(restart 01c-10).
    #[test]
    fn the_queue_list_and_engine_events_carry_their_whole_value() {
        let queue = vec![atelier_acp::QueuedMessage { id: "q1".into(), text: "기다리는 말".into(), send_now: false }];
        let queued = HostEvent::ThreadQueue { thread: "20261023-100000".into(), queue };
        assert_eq!(
            wire(&queued),
            (
                "thread:queue",
                json!({"thread": "20261023-100000", "queue": [{"id": "q1", "text": "기다리는 말", "sendNow": false}]})
            )
        );
        let summary = atelier_core::ThreadSummary {
            id: "20261023-100000".into(),
            title: "장바구니".into(),
            created_at: "2026-10-23T10:00:00.000+09:00".into(),
            work: Some("cart".into()),
            last_read: 7,
            read_only: Some(atelier_core::WorkGone::Archived),
            broken: None,
        };
        assert_eq!(
            wire(&HostEvent::ThreadList(summary)),
            (
                "thread:list",
                json!({"id": "20261023-100000", "title": "장바구니", "createdAt": "2026-10-23T10:00:00.000+09:00",
                       "work": "cart", "lastRead": 7, "readOnly": "archived", "broken": null})
            )
        );
        let engine = HostEvent::Engine(atelier_acp::EngineState {
            agent: atelier_acp::Agent::Claude,
            found: true,
            logged_in: Some(false),
            missing: vec![],
        });
        assert_eq!(
            wire(&engine),
            ("thread:engine", json!({"agent": "claude", "found": true, "loggedIn": false, "missing": []}))
        );
        // 못 찾았으면 빠진 것과 설치 명령이 실린다(restart 01c-9) — 세션을 열다 못 찾은 채팅에도 설치 안내 카드가 선다.
        let missing = HostEvent::Engine(atelier_acp::EngineState {
            agent: atelier_acp::Agent::Codex,
            found: false,
            logged_in: None,
            missing: vec![atelier_acp::MissingProgram { name: "node", install: "brew install node" }],
        });
        assert_eq!(
            wire(&missing).1,
            json!({"agent": "codex", "found": false, "loggedIn": null,
                   "missing": [{"name": "node", "install": "brew install node"}]}),
        );
    }

    /// **앱의 엔진은 Runtime에 이 실행의 Runtime 키를 심는다**(restart 03-7). 심는 동작은 엔진의 시험(`atelier-acp`의 `runtime_mark.rs`)이
    /// 가짜 Runtime의 env로 재고, 키의 모양은 `runtime_key`가 잰다 — 여기는 앱이 그 둘을 잇는 자리라 실행으로 못 재 자리로 잰다. 이 줄이
    /// 빠지면 엔진은 아무 표식도 안 심고, `Processes`의 「채팅」이 비며 채팅이 띄운 dev 서버가 「다른 앱」으로 간다(그 시험들은 모두 초록이다).
    #[test]
    fn the_app_engine_marks_its_runtimes_with_this_runs_runtime_key() {
        let body = crate::tests::body_of(include_str!("thread.rs"), "pub fn host(", "\n}\n");
        assert!(
            body.contains(".mark_runtimes(crate::processes::runtime_key::mint)"),
            "앱의 엔진이 Runtime에 이 실행의 Runtime 키를 안 심는다"
        );
    }

    /// **문서 쓰는 중은 Work와 그 Work의 목록 전체를 싣는다**(v1 티켓 34). 화면은 마지막 것 하나를 쥐므로 빈 목록도 그대로 간다.
    #[test]
    fn the_writing_event_carries_the_work_and_its_whole_list() {
        let writing = vec![atelier_acp::DocWriting { path: "design.md".into(), thread: "20261023-100000".into() }];
        assert_eq!(
            wire(&HostEvent::WorkWriting { work: "refund-api".into(), writing }),
            (
                "work:writing",
                json!({"work": "refund-api", "writing": [{"path": "design.md", "thread": "20261023-100000"}]})
            )
        );
        assert_eq!(
            wire(&HostEvent::WorkWriting { work: "refund-api".into(), writing: Vec::new() }).1,
            json!({"work": "refund-api", "writing": []})
        );
    }
}
