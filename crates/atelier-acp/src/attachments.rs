//! 첨부 블록(v1 티켓 06 · 구현 스펙 §14 S30) — 사람이 말에 붙인 파일 · 폴더를 Agent에게 **절대 경로 목록**으로 넘긴다.
//!
//! 블록은 사람의 글 바로 앞에 따로 된 텍스트 블록으로 선다(인용 블록과 같은 자리 꼴). 내용은 싣지 않는다 — 그림도 경로뿐이다.
//! Agent는 필요하면 그 경로를 제 도구로 읽는다. 폴더는 끝에 `/`를 붙여 파일과 가른다. 지난 말(`past.rs`)도 같은 글로 사람의
//! 말에 붙은 경로를 다른 Agent에게 옮긴다.

use atelier_core::Attachment;
use serde_json::{json, Value};

/// 블록의 머리 — Agent가 이 목록이 무엇인지, 내용이 실리지 않았다는 것을 알게.
const HEAD: &str = "첨부 — 사람이 이 말에 붙인 파일 · 폴더의 절대 경로다. 내용은 싣지 않았다. 필요하면 그 경로를 읽어라.";

/// 머리 한 줄 뒤에 경로를 한 줄씩. 첨부가 없으면 `None`.
pub(crate) fn listing(attachments: &[Attachment]) -> Option<String> {
    if attachments.is_empty() {
        return None;
    }
    let lines: String = attachments
        .iter()
        .map(|attached| format!("\n- {}{}", attached.path, if attached.folder { "/" } else { "" }))
        .collect();
    Some(format!("{HEAD}{lines}"))
}

/// 프롬프트에 넣을 첨부 블록. 첨부가 없으면 `None`(블록을 넣지 않는다).
pub(crate) fn block(attachments: &[Attachment]) -> Option<Value> {
    listing(attachments).map(|text| json!({"type": "text", "text": text}))
}
