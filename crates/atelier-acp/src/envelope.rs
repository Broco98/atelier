//! `updates.jsonl`에 쌓이는 봉투 한 줄. **형식이 정해지는 유일한 자리다.**
//!
//! ACP 페이로드는 `payload` 안에 손대지 않은 채 들어간다. 그런데도 봉투가 필요한 이유는
//! 재생 때문이다 — 내가 친 프롬프트는 애초에 에이전트가 보낸 것이 아니라서, 봉투가 없으면
//! 재생한 화면에 **에이전트의 말만 남고 대화가 성립하지 않는다.**

use serde_json::{json, Value};

/// 에이전트가 보낸 `session/update` 알림. `payload`는 그 알림의 파라미터 원본이다.
pub fn session_update(payload: Value) -> Value {
    json!({"kind": "session_update", "at": now(), "payload": payload})
}

/// 사람이 친 말.
pub fn user_prompt(text: &str) -> Value {
    json!({"kind": "user_prompt", "at": now(), "text": text})
}

/// 턴이 답을 얻지 못하고 끝났다.
///
/// 다이얼로그만 띄우면 그 화면을 닫는 순간 사라진다. 다시 열었을 때 **내 말만 있고 답도
/// 이유도 없는 대화**가 남지 않도록, 실패도 대화의 한 줄로 남긴다.
pub fn turn_failed(message: &str) -> Value {
    json!({"kind": "turn_failed", "at": now(), "message": message})
}

fn now() -> String {
    chrono::Local::now().to_rfc3339()
}
