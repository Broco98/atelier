//! 가리기 — 기록은 원문 그대로인데, 그 **유일한 예외**가 계정 칸이다(워크플로 S34 · 스토리 115). 기록이 fixture나 이슈로 옮겨져도
//! 계정이 새지 않게 한다. 가릴 자리는 엔진마다 다르고(Codex `_auth/status_update`는 런타임이, Claude `initialize`는 변환기가 고른다)
//! 가리는 규칙은 하나다.

use serde_json::Value;

/// 그 값 아래의 글자 값을 모두 `<email>`로 바꾼다 — 배열 · 객체는 내려가며 가리고, 수 · 참거짓 · null은 그대로 둔다.
pub(crate) fn mask_strings(value: &mut Value) {
    match value {
        Value::String(text) => *text = "<email>".to_string(),
        Value::Array(items) => items.iter_mut().for_each(mask_strings),
        Value::Object(fields) => fields.values_mut().for_each(mask_strings),
        _ => {}
    }
}
