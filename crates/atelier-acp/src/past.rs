//! 지난 말 — 앞선 Session이 나눈 말을 새로 선 Session의 첫 말에 글로 넘긴다(v1 구현 스펙 §5 · S10 · v1 티켓 13).
//!
//! - **채팅 하나가 Runtime 세션 하나다.** 이어 쓰는 Session(`resumed` · `loaded`)은 지난 말을 이미 안다. 되살리지 못해 새로 선
//!   Session(`fresh`)만 앞을 모르므로, 그 Session이 받는 첫 말의 머리말과 본문 사이에 한 블록으로 넣는다.
//! - 담는 것은 **사람의 말**(`sent`의 글 · 첨부 경로)과 **턴마다의 마지막 메시지**뿐이다. 도구 기록 · 생각은 넘기지 않는다 — 같은
//!   자리의 파일을 직접 읽는다(plan 「v1의 Contract는 텍스트다」).
//! - 상한([`PAST_LIMIT`]글자)을 넘으면 오래된 말부터 빼고 뺐다고 머리에 적는다. 남은 가장 새 말 하나도 넘으면 그 앞을 자르고
//!   잘랐다고 적는다.
//! - **보내는 그때 기록에서 짓는다**(턴 차례의 `past` 손) — 대기 줄에 들었다가 턴 끝에 가는 말도 그사이 선 말까지 받고, 대기
//!   줄의 두 말이 같은 말을 두 번 싣지 않는다.

use atelier_core::{Attachment, RecordKind, RecordLine};
use serde::Deserialize;
use serde_json::Value;

use crate::attachments;
use crate::records::{heard_since_session_start, starts_session};

/// 지난 말의 상한(글자 수). 긴 Thread에서 새로 선 Session도 맥락 창의 작은 몫만 쓰게 한다 — claude의 맥락 창(20만 토큰)에서
/// 한국어로 2만 토큰 안팎이다.
pub(crate) const PAST_LIMIT: usize = 32_000;

/// 블록의 머리 — Runtime이 이것이 무엇인지 알게.
const HEAD: &str = "지난 말 — 이 Thread의 앞선 Session이 나눈 말이다. 이 Session은 보지 못했다. 사람의 말과 턴마다의 마지막 답만 담았다.";

/// 블록 안에서 말과 말 사이.
const GAP: &str = "\n\n";

/// 지금 Session이 아직 보지 못한 말 — 없으면 `None`(블록을 넣지 않는다). `lines`는 그 Thread의 기록 전체다. 이 Session이 말을 받은
/// 적이 있으면 그 말에 앞의 것이 실려 갔으므로 없다.
pub(crate) fn past(lines: &[RecordLine], limit: usize) -> Option<String> {
    if heard_since_session_start(lines) {
        return None;
    }
    let started = session_start(lines);
    let unseen: Vec<Said> = said(lines).into_iter().filter(|said| said.seq < started).collect();
    if unseen.is_empty() {
        return None;
    }
    Some(render(&unseen, limit))
}

/// 지금 Session이 선 줄 — 새로 선(`new` · `fresh`) 마지막 열림 줄의 seq. 되살린 열림(`resumed` · `loaded`)은 같은 Session을 이은
/// 것이라 건너뛴다. 연 적이 없으면 0이다.
fn session_start(lines: &[RecordLine]) -> u64 {
    lines.iter().rev().find(|line| line.kind == RecordKind::Session && starts_session(&line.payload)).map_or(0, |line| line.seq)
}

/// 지난 말 하나 — 선 자리(사람의 말은 그 `sent`, 답은 그 턴 끝), 한 이, 글.
struct Said {
    seq: u64,
    by: Speaker,
    text: String,
}

enum Speaker {
    Human,
    Runtime,
}

impl Said {
    fn label(&self) -> &'static str {
        match self.by {
            Speaker::Human => "[사람]",
            Speaker::Runtime => "[답]",
        }
    }

    fn render(&self) -> String {
        format!("{}\n{}", self.label(), self.text)
    }
}

/// 기록의 모든 사람 말과 턴마다의 마지막 메시지 — 선 차례로.
///
/// 턴이 끝날 때 그 턴의 마지막 메시지가 선다([`Message`]) — 끝나지 않은 턴(도는 중 · 죽음)의 글은 아직 넘기지 않는다.
fn said(lines: &[RecordLine]) -> Vec<Said> {
    let mut said = Vec::new();
    let mut last: Option<Message> = None;
    for line in lines {
        match line.kind {
            RecordKind::Sent => {
                if let Some(text) = line.payload["text"].as_str() {
                    // 붙인 경로도 함께 — 새로 선 Session도 사람이 보인 파일을 읽을 수 있게(v1 티켓 06).
                    let attached = Vec::<Attachment>::deserialize(&line.payload["attachments"]).unwrap_or_default();
                    let text = match attachments::listing(&attached) {
                        Some(listing) => format!("{listing}\n{text}"),
                        None => text.to_owned(),
                    };
                    said.push(Said { seq: line.seq, by: Speaker::Human, text });
                }
            }
            RecordKind::Update => follow(&mut last, &line.payload["update"]),
            RecordKind::TurnEnd => {
                if let Some(text) = last.take().map(|message| message.text).filter(|text| !text.trim().is_empty()) {
                    said.push(Said { seq: line.seq, by: Speaker::Runtime, text });
                }
            }
            // 끝 없이 사라진 턴(죽음)의 글은 다음 턴에 묻어 가지 않는다.
            RecordKind::Session => last = None,
            _ => {}
        }
    }
    said
}

/// `session/update` 하나를 따라 짓는 중인 답 글을 고친다.
///
/// 「메시지」는 화면이 한 덩이로 그리는 답 글과 같다(`features/thread/fold.ts`의 `appendChunk`): 같은 메시지 id의 답 조각이 다른
/// 것(생각 · 도구 · 계획) 없이 이어지면 한 메시지다.
fn follow(last: &mut Option<Message>, update: &Value) {
    match update["sessionUpdate"].as_str() {
        Some("agent_message_chunk") => {
            let chunk = update["content"]["text"].as_str().unwrap_or_default();
            let id = &update["messageId"];
            match last {
                Some(message) if message.open && &message.id == id => message.text.push_str(chunk),
                _ => *last = Some(Message { id: id.clone(), text: chunk.to_owned(), open: true }),
            }
        }
        // 화면에서 답 글을 끊는 것들 — 그 뒤의 조각은 새 메시지다.
        Some("agent_thought_chunk" | "tool_call" | "plan_update" | "plan") => {
            if let Some(message) = last {
                message.open = false;
            }
        }
        _ => {}
    }
}

/// 짓는 중인 답 글 하나.
struct Message {
    id: Value,
    text: String,
    /// 아직 이어 붙나 — 생각 · 도구 · 계획이 끼면 닫힌다.
    open: bool,
}

/// 블록의 글 — 머리, (줄였으면) 줄인 것, 말들. 상한은 말들의 글자 수에 건다.
fn render(unseen: &[Said], limit: usize) -> String {
    let mut kept: Vec<String> = Vec::new();
    let mut total = 0;
    for said in unseen.iter().rev() {
        let block = said.render();
        let length = block.chars().count() + GAP.len();
        if total + length > limit {
            break;
        }
        total += length;
        kept.push(block);
    }
    if kept.is_empty() {
        // 가장 새 말 하나도 넘는다 — 그 앞을 자른다.
        let newest = unseen.last().expect("지난 말이 있다");
        let marker = "…(앞을 줄였다)\n";
        let room = limit.saturating_sub(newest.label().chars().count() + 1 + marker.chars().count());
        let skip = newest.text.chars().count().saturating_sub(room);
        let tail: String = newest.text.chars().skip(skip).collect();
        kept.push(format!("{}\n{marker}{tail}", newest.label()));
    }
    let dropped = unseen.len() - kept.len();
    kept.reverse();
    let mut text = HEAD.to_owned();
    if dropped > 0 {
        text.push_str(&format!("\n앞의 말 {dropped}개는 상한 {limit}글자를 넘어 뺐다."));
    }
    text.push_str(GAP);
    text.push_str(&kept.join(GAP));
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 기록 줄들 — `(kind, payload)`를 seq 1부터 차례로.
    fn record(lines: &[(&str, Value)]) -> Vec<RecordLine> {
        lines
            .iter()
            .enumerate()
            .map(|(n, (kind, payload))| {
                serde_json::from_value(json!({
                    "seq": n + 1, "at": "2026-10-23T10:00:00.000+09:00", "kind": kind, "payload": payload,
                }))
                .expect("기록 줄")
            })
            .collect()
    }

    fn opened(how: &str) -> (&'static str, Value) {
        ("session", json!({"state": "opened", "how": how, "agentVersion": null, "modes": null, "models": null, "configOptions": null}))
    }

    fn sent(text: &str) -> (&'static str, Value) {
        ("sent", json!({"text": text, "prompt": [], "sendNow": false}))
    }

    fn update(update: Value) -> (&'static str, Value) {
        ("update", json!({"sessionId": "s", "update": update}))
    }

    fn chunk(id: &str, text: &str) -> (&'static str, Value) {
        update(json!({"sessionUpdate": "agent_message_chunk", "messageId": id, "content": {"type": "text", "text": text}}))
    }

    fn tool() -> (&'static str, Value) {
        update(json!({"sessionUpdate": "tool_call", "toolCallId": "t", "title": "Read a.md", "kind": "read"}))
    }

    fn end() -> (&'static str, Value) {
        ("turn-end", json!({"stopReason": "end_turn"}))
    }

    #[test]
    fn 새로_선_session은_턴마다_마지막_메시지만_받고_도구와_그_앞의_메시지는_받지_않는다() {
        let lines = record(&[
            opened("new"),
            sent("장바구니 고쳐 줘"),
            chunk("m1", "먼저 "),
            chunk("m1", "읽어 볼게요"),
            tool(),
            chunk("m2", "고쳤어요. "),
            chunk("m2", "테스트도 초록이에요"),
            end(),
            opened("fresh"),
        ]);
        assert_eq!(
            past(&lines, PAST_LIMIT).as_deref(),
            Some(format!("{HEAD}\n\n[사람]\n장바구니 고쳐 줘\n\n[답]\n고쳤어요. 테스트도 초록이에요").as_str())
        );
    }

    #[test]
    fn 이어_쓰는_session은_지난_말을_받지_않는다() {
        let lines = record(&[opened("new"), sent("어제의 말"), chunk("h1", "어제의 답"), end(), opened("resumed")]);
        assert_eq!(past(&lines[..1], PAST_LIMIT), None, "첫 Session에는 앞이 없다");
        assert_eq!(past(&lines[..4], PAST_LIMIT), None, "말을 받은 Session은 그 말을 안다");
        assert_eq!(past(&lines, PAST_LIMIT), None, "resume으로 이은 Session은 그 말을 받았던 Session이다");
    }

    #[test]
    fn 새로_선_session은_첫_말에만_thread_처음부터_받는다() {
        let lines = record(&[opened("new"), sent("어제의 말"), chunk("h1", "어제의 답"), end(), opened("resumed"), opened("fresh")]);
        assert_eq!(
            past(&lines, PAST_LIMIT).as_deref(),
            Some(format!("{HEAD}\n\n[사람]\n어제의 말\n\n[답]\n어제의 답").as_str()),
            "되살리지 못해 새로 선 Session은 앞 Session을 모른다"
        );
        let told = record(&[opened("new"), sent("어제의 말"), opened("fresh"), sent("오늘의 말")]);
        assert_eq!(past(&told, PAST_LIMIT), None, "첫 말에 실려 갔다");
    }

    #[test]
    fn 끝나지_않은_턴의_글은_넘기지_않고_죽은_턴의_글은_다음_턴에_묻어_가지_않는다() {
        let lines = record(&[
            opened("new"),
            sent("첫 말"),
            chunk("h1", "죽기 전의 글"),
            ("session", json!({"state": "died", "reason": "끝남"})),
            opened("resumed"),
            sent("다시 말"),
            tool(),
            end(),
            chunk("h2", "도는 중의 글"),
            opened("fresh"),
        ]);
        assert_eq!(
            past(&lines, PAST_LIMIT).as_deref(),
            Some(format!("{HEAD}\n\n[사람]\n첫 말\n\n[사람]\n다시 말").as_str())
        );
    }

    #[test]
    fn 사람이_첨부한_경로도_지난_말에_함께_간다() {
        let attached = json!({"text": "이 로그 봐 줘", "attachments": [{"path": "/desk/error.log", "size": 12, "folder": false}]});
        let lines = record(&[opened("new"), ("sent", attached), opened("fresh")]);
        let listing = attachments::listing(&[Attachment { path: "/desk/error.log".into(), size: Some(12), folder: false }]);
        assert_eq!(
            past(&lines, PAST_LIMIT),
            Some(format!("{HEAD}\n\n[사람]\n{}\n이 로그 봐 줘", listing.expect("첨부 목록")))
        );
    }

    #[test]
    fn 상한을_넘으면_오래된_말부터_빼고_뺐다고_적는다() {
        let lines = record(&[opened("new"), sent("하나"), sent("둘"), sent("셋"), opened("fresh")]);
        // 「[사람]\n둘」은 6글자, 사이(GAP) 2글자를 더해 8 — 둘 · 셋을 담으면 16이다.
        assert_eq!(
            past(&lines, 16).as_deref(),
            Some(format!("{HEAD}\n앞의 말 1개는 상한 16글자를 넘어 뺐다.\n\n[사람]\n둘\n\n[사람]\n셋").as_str())
        );
    }

    #[test]
    fn 가장_새_말_하나도_상한을_넘으면_그_앞을_자르고_잘랐다고_적는다() {
        let lines = record(&[opened("new"), sent("가나다라마바사아자차카타파하거너더러머버"), opened("fresh")]);
        // 말 하나가 이름표 「[사람]」 4글자 + 줄바꿈 1 + 글 20글자 + 사이 2 = 27로 상한 18을 넘는다. 자르면 이름표 · 줄바꿈 ·
        // 「…(앞을 줄였다)」 줄 10글자로 15이고, 남은 3글자에 글의 끝 셋이 든다.
        assert_eq!(past(&lines, 18).as_deref(), Some(format!("{HEAD}\n\n[사람]\n…(앞을 줄였다)\n러머버").as_str()));
    }
}
