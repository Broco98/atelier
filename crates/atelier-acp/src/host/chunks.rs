//! 조각 쌓기 — Runtime이 보낸 글 조각을 합쳐 ACP 조각 모양의 기록 줄 하나로 낸다(스펙 「01b — 스트리밍」).
//!
//! 합친 글을 잇는 값이 흐름 번호다. 흐름 하나가 기록 줄 하나이고, 번호는 그 줄의 `update._meta.atelier.stream`에 선다. 접기의 입력
//! 모양은 그대로다 — 줄은 첫 조각의 원문에 합친 글을 실은 것이다.
//!
//! 쌓는 동안 받은 글은 화면 조각([`FlowChunk`])으로도 나간다 — 기록하지 않는 화면의 몫이다. 화면은 같은 흐름의 기록 줄이 오면 조각을 지운다.
//!
//! 잠금도 파일도 모른다. 무엇을 쌓고 무엇을 줄과 조각으로 내는지만 정하고, 언제 비우는지와 턴 밖의 조각, 조각의 박자는 [`super::Conv`]가
//! 정한다.

use serde::Serialize;
use serde_json::{json, Value};

/// 흐르는 글의 종류 — 답이나 생각이다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FlowKind {
    Message,
    Thought,
}

/// 화면에 흐르는 글 한 조각 — 기록 줄이 아니라 접기를 다시 돌리지 않는다. 앞선 글이 없는 화면(새로 그린 화면)은 `ThreadView.flowing`이 잇는다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FlowChunk {
    /// 흐름 번호 — 이 글이 합쳐질 기록 줄의 `update._meta.atelier.stream`이다.
    pub stream: u64,
    pub kind: FlowKind,
    /// 이 조각의 글이 흐름의 글 안에서 서는 자리 — 화면이 글을 다루는 단위인 UTF-16 코드 단위로 센다.
    pub offset: usize,
    pub text: String,
    /// 버린 흐름(restart 01b-10) — claude가 끊긴 메시지를 처음부터 다시 받아 이 흐름은 기록 줄이 되지 않는다. 화면은 그 흐름의 글을 지운다.
    /// 글은 비어 있다.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub discarded: bool,
}

/// `session/update` 원문이 쌓을 조각인가 — 답이나 생각의 글 조각이다. 글이 아닌 내용은 조각이 아닌 `update`로 다룬다.
pub(super) fn is_chunk(raw: &Value) -> bool {
    let update = &raw["update"];
    matches!(update["sessionUpdate"].as_str(), Some("agent_message_chunk" | "agent_thought_chunk"))
        && update["content"]["type"] == "text"
        && update["content"]["text"].is_string()
}

/// `session/update` 원문이 끝나지 않은 메시지를 버리라는 변환기의 표지면 그 메시지의 id(restart 01b-10) — claude가 끊긴 메시지를 처음부터
/// 다시 받는다. 기록할 줄이 아니다.
pub(super) fn discarded(raw: &Value) -> Option<&str> {
    let update = &raw["update"];
    if update["sessionUpdate"] != "session_info_update" {
        return None;
    }
    update["_meta"]["atelier"]["discardMessage"].as_str()
}

/// Session 하나의 쌓는 자리 — 지금 흐름 하나와 마지막으로 매긴 번호. 되살린 Session은 같은 자리를 이어 쓰고, 앱을 다시 켜면 1부터다.
#[derive(Default)]
pub(super) struct Chunks {
    flowing: Option<Flow>,
    numbered: u64,
}

impl Chunks {
    /// 조각 하나를 쌓는다. 지금 흐름의 조각이면 이어 붙이고, 아니면 앞선 흐름을 기록 줄로 돌려주고 새 흐름을 연다.
    pub(super) fn push(&mut self, raw: Value) -> Option<Value> {
        let text = raw["update"]["content"]["text"].as_str().unwrap_or_default();
        if let Some(flow) = self.flowing.as_mut().filter(|flow| flow.carries(&raw)) {
            flow.text.push_str(text);
            return None;
        }
        let text = text.to_owned();
        let finished = self.take();
        self.numbered += 1;
        self.flowing = Some(Flow { number: self.numbered, first: raw, text, sent: None });
        finished
    }

    /// 화면에 아직 보내지 않은 글 — 보낸 것으로 친다. 글이 빈 흐름도 한 번은 나간다 — 생각은 빈 글로 오고, 화면은 그것으로 생각 중임을 안다.
    pub(super) fn unsent(&mut self) -> Option<FlowChunk> {
        self.flowing.as_mut().and_then(Flow::unsent)
    }

    /// 지금 흐름의 받은 글 전부 — 오프셋 0의 조각이다.
    pub(super) fn flowing(&self) -> Option<FlowChunk> {
        self.flowing.as_ref().map(|flow| flow.chunk_from(0))
    }

    /// 쌓인 글을 기록 줄로 꺼낸다. 쌓인 것이 없으면 없다.
    pub(super) fn take(&mut self) -> Option<Value> {
        self.flowing.take().map(Flow::into_line)
    }

    /// 지금 흐름이 그 메시지의 것이면 쌓인 글을 기록 줄로 쓰지 않고 버린다 — 화면이 그 흐름을 지울 조각을 돌려준다. 이미 기록 줄이 된
    /// 흐름은 그대로다.
    pub(super) fn discard(&mut self, message: &str) -> Option<FlowChunk> {
        let flow = self.flowing.take_if(|flow| flow.first["update"]["messageId"] == message)?;
        Some(FlowChunk { offset: 0, text: String::new(), discarded: true, ..flow.chunk_from(flow.text.len()) })
    }
}

/// 합치는 중인 글 하나.
struct Flow {
    number: u64,
    /// 첫 조각의 원문 — 세션 id와 메시지 id를 그대로 안고 기록 줄이 된다.
    first: Value,
    text: String,
    /// 화면에 보낸 글의 끝(바이트). 아직 아무것도 보내지 않았으면 없다.
    sent: Option<usize>,
}

impl Flow {
    fn unsent(&mut self) -> Option<FlowChunk> {
        if self.sent == Some(self.text.len()) {
            return None;
        }
        let chunk = self.chunk_from(self.sent.unwrap_or(0));
        self.sent = Some(self.text.len());
        Some(chunk)
    }

    /// `from`(바이트)부터 끝까지의 글.
    fn chunk_from(&self, from: usize) -> FlowChunk {
        let (before, text) = self.text.split_at(from);
        let kind = if self.first["update"]["sessionUpdate"] == "agent_thought_chunk" { FlowKind::Thought } else { FlowKind::Message };
        FlowChunk { stream: self.number, kind, offset: before.encode_utf16().count(), text: text.to_owned(), discarded: false }
    }

    /// 같은 메시지, 같은 종류의 조각인가. 메시지 id가 없는 조각끼리도 같다 — 접기가 그렇게 잇는다(`fold.ts`의 `appendChunk`).
    fn carries(&self, raw: &Value) -> bool {
        let (ours, theirs) = (&self.first["update"], &raw["update"]);
        ours["sessionUpdate"] == theirs["sessionUpdate"] && ours["messageId"] == theirs["messageId"]
    }

    fn into_line(self) -> Value {
        let Flow { number, mut first, text, .. } = self;
        let update = &mut first["update"];
        update["content"]["text"] = json!(text);
        let meta = &mut update["_meta"];
        if !meta.is_object() {
            *meta = json!({});
        }
        let atelier = &mut meta["atelier"];
        if !atelier.is_object() {
            *atelier = json!({});
        }
        atelier["stream"] = json!(number);
        first
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update(update: Value) -> Value {
        json!({"sessionId": "s", "update": update})
    }

    fn message(id: Value, text: &str) -> Value {
        update(json!({"sessionUpdate": "agent_message_chunk", "messageId": id, "content": {"type": "text", "text": text}}))
    }

    #[test]
    fn 메시지_id가_없는_조각끼리는_접기처럼_이어_붙는다() {
        let mut chunks = Chunks::default();
        assert_eq!(chunks.push(message(Value::Null, "앞")), None);
        assert_eq!(chunks.push(message(Value::Null, "뒤")), None);

        let line = chunks.take().expect("쌓인 글");

        assert_eq!(line["update"]["content"]["text"], "앞뒤");
        assert_eq!(chunks.take(), None, "꺼낸 글은 다시 나오지 않는다");
    }

    #[test]
    fn 기록_줄은_첫_조각의_칸과_메타를_그대로_안고_흐름_번호를_더한다() {
        let first = update(json!({"sessionUpdate": "agent_thought_chunk", "messageId": "rs_1",
                                  "content": {"type": "text", "text": "가"},
                                  "_meta": {"codex": {"phase": "x"}, "atelier": {"note": 1}}}));
        let mut chunks = Chunks::default();
        chunks.push(first);

        assert_eq!(
            chunks.take(),
            Some(update(json!({"sessionUpdate": "agent_thought_chunk", "messageId": "rs_1",
                               "content": {"type": "text", "text": "가"},
                               "_meta": {"codex": {"phase": "x"}, "atelier": {"note": 1, "stream": 1}}})))
        );
    }

    #[test]
    fn 버리라는_메시지가_지금_흐름일_때만_쌓인_글을_버리고_그_흐름을_지울_조각을_돌려준다() {
        let mut chunks = Chunks::default();
        chunks.push(message(json!("끝난"), "끝난 글"));
        assert_eq!(chunks.discard("다른"), None, "지금 흐름이 아닌 메시지는 버리지 않는다");

        let written = chunks.push(message(json!("끊긴"), "끊긴 글")).expect("앞 흐름은 기록 줄이 된다");
        assert_eq!(written["update"]["content"]["text"], "끝난 글");
        assert_eq!(chunks.discard("끝난"), None, "이미 기록 줄이 된 흐름은 그대로다");

        let gone = FlowChunk { stream: 2, kind: FlowKind::Message, offset: 0, text: String::new(), discarded: true };
        assert_eq!(chunks.discard("끊긴"), Some(gone));
        assert_eq!((chunks.flowing(), chunks.unsent(), chunks.take()), (None, None, None), "버린 글은 어디로도 나가지 않는다");

        chunks.push(message(json!("다시"), "다시 받은 글"));
        assert_eq!(chunks.flowing().map(|chunk| (chunk.stream, chunk.text)), Some((3, "다시 받은 글".to_owned())), "다시 받은 글은 새 흐름이다");
    }

    #[test]
    fn 버리라는_표지는_session_info_update의_discardMessage다() {
        let mark = update(json!({"sessionUpdate": "session_info_update", "_meta": {"atelier": {"discardMessage": "msg_1"}}}));
        assert_eq!(discarded(&mark), Some("msg_1"));
        let other = update(json!({"sessionUpdate": "session_info_update", "_meta": {"atelier": {"outOfTurn": {"state": "started"}}}}));
        assert_eq!(discarded(&other), None);
        assert_eq!(discarded(&message(json!("msg_1"), "글")), None);
    }

    #[test]
    fn 글이_아닌_내용과_사람의_조각은_쌓을_조각이_아니다() {
        assert!(is_chunk(&message(json!("m"), "글")));
        let image = update(json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "image", "data": "…"}}));
        assert!(!is_chunk(&image));
        let user = update(json!({"sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": "말"}}));
        assert!(!is_chunk(&user));
    }
}
