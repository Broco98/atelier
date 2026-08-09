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

/// 에이전트가 도구를 쓰기 전에 물었다. `payload`는 그 **요청**의 파라미터 원본이다.
///
/// `requestId`가 답과 짝을 맞추는 자리다. 이것이 없으면 재생한 화면에 요청과 답이 따로 놓여
/// **무엇을 승인한 것인지** 알 수 없다.
pub fn permission_request(request_id: &str, payload: Value) -> Value {
    json!({"kind": "permission_request", "at": now(), "requestId": request_id, "payload": payload})
}

/// 사람이 답했다.
///
/// `optionId`가 실제로 고른 것이고 `outcome`은 그것을 한 마디로 줄인 것이다. 선택지는
/// 에이전트가 준 목록이라 "이번만 허용"과 "늘 허용"처럼 여럿일 수 있으므로, 줄인 말만
/// 남기면 무엇을 골랐는지가 사라진다.
pub fn permission_response(request_id: &str, option_id: &str, allow: bool) -> Value {
    json!({"kind": "permission_response", "at": now(), "requestId": request_id,
           "optionId": option_id, "outcome": if allow { "allow" } else { "deny" }})
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
