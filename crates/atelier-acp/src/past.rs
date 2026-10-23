//! 지난 말 — Thread의 Session에게 그 Session이 아직 보지 못한 말을 글로 넘긴다(v1 구현 스펙 §5 · S10 · v1 티켓 13).
//!
//! - **Session은 Agent마다 따로라서 다른 이의 말을 모른다.** 그래서 그 Agent에게 말을 보낼 때마다, 이 Session이 마지막으로 본
//!   줄(그에게 간 마지막 `sent`) 뒤의 말을 머리말과 본문 사이에 한 블록으로 넣는다. 새로 선 Session(처음 들어옴 · 되살리지
//!   못해 새로)은 아무것도 보지 못했으니 Thread 처음부터다.
//! - 담는 것은 **사람의 말**(`sent`의 글 · 첨부 경로와 받는 이)과 **Agent 턴마다의 마지막 메시지**뿐이다. 도구 기록 · 생각은 넘기지
//!   않는다 — 그 Agent는 같은 Work의 파일을 직접 읽는다(plan 「v1의 Contract는 텍스트다」).
//! - 이 Session이 스스로 한 말은 넣지 않는다 — 이미 안다. 새로 선 Session이면 앞 Session의 제 말도 모르므로 넣는다.
//! - 상한([`PAST_LIMIT`]글자)을 넘으면 오래된 말부터 빼고 뺐다고 머리에 적는다. 남은 가장 새 말 하나도 넘으면 그 앞을 자르고
//!   잘랐다고 적는다.
//! - **보내는 그때 기록에서 짓는다**(턴 차례의 `past` 손) — 대기 줄에 들었다가 턴 끝에 가는 말도 그사이 선 말까지 받고, 대기
//!   줄의 두 말이 같은 말을 두 번 싣지 않는다.

use std::collections::HashMap;

use atelier_core::{Attachment, RecordKind, RecordLine};
use serde::Deserialize;
use serde_json::Value;

use crate::attachments;
use crate::records::starts_session;

/// 지난 말의 상한(글자 수). 긴 Thread에 새로 들어온 Agent도 맥락 창의 작은 몫만 쓰게 한다 — claude의 맥락 창(20만 토큰)에서
/// 한국어로 2만 토큰 안팎이다.
pub(crate) const PAST_LIMIT: usize = 32_000;

/// 블록의 머리 — Agent가 이것이 무엇인지 알게.
const HEAD: &str =
    "지난 말 — 이 Thread에서 네가 아직 보지 못한 말이다. 사람의 말과 다른 Agent의 마지막 메시지만, 누가 했는지와 함께 담았다.";

/// 블록 안에서 말과 말 사이.
const GAP: &str = "\n\n";

/// 그 참여자(`who`)의 지금 Session이 아직 보지 못한 말 — 없으면 `None`(블록을 넣지 않는다). `lines`는 그 Thread의 기록 전체다.
pub(crate) fn past(lines: &[RecordLine], who: &str, limit: usize) -> Option<String> {
    let started = session_start(lines, who);
    let seen = last_heard(lines, who, started);
    let unseen: Vec<Said> = said(lines)
        .into_iter()
        .filter(|said| said.seq > seen)
        .filter(|said| !(said.seq > started && matches!(&said.by, Speaker::Agent(by) if by == who)))
        .collect();
    if unseen.is_empty() {
        return None;
    }
    Some(render(&unseen, limit))
}

/// 그 참여자의 지금 Session이 선 줄 — 새로 선(`new` · `fresh`) 마지막 열림 줄의 seq. 되살린 열림(`resumed` · `loaded`)은 같은
/// Session을 이은 것이라 건너뛴다. 연 적이 없으면 0이다.
fn session_start(lines: &[RecordLine], who: &str) -> u64 {
    lines
        .iter()
        .rev()
        .find(|line| line.kind == RecordKind::Session && line.who.as_deref() == Some(who) && starts_session(&line.payload))
        .map_or(0, |line| line.seq)
}

/// 이 Session이 마지막으로 본 줄 — 이 Session이 선 뒤 그에게 간 마지막 `sent`. 그 말에 그때까지의 지난 말이 실려 갔다. 아직
/// 받은 말이 없으면 0(Thread 처음)이다.
fn last_heard(lines: &[RecordLine], who: &str, started: u64) -> u64 {
    lines
        .iter()
        .rev()
        .take_while(|line| line.seq > started)
        .find(|line| line.kind == RecordKind::Sent && line.payload["to"] == who)
        .map_or(0, |line| line.seq)
}

/// 지난 말 하나 — 선 자리(사람의 말은 그 `sent`, Agent의 메시지는 그 턴 끝), 한 이, 글.
struct Said {
    seq: u64,
    by: Speaker,
    text: String,
}

enum Speaker {
    /// 사람 — 그 말을 받은 참여자와 함께.
    Human { to: String },
    /// 참여자 — handle.
    Agent(String),
}

impl Said {
    fn label(&self) -> String {
        match &self.by {
            Speaker::Human { to } => format!("[사람 → @{to}]"),
            Speaker::Agent(by) => format!("[@{by}]"),
        }
    }

    fn render(&self) -> String {
        format!("{}\n{}", self.label(), self.text)
    }
}

/// 기록의 모든 사람 말과 Agent 턴마다의 마지막 메시지 — 선 차례로.
///
/// 「메시지」는 화면이 한 덩이로 그리는 답 글과 같다(`features/chat/fold.ts`의 `appendChunk`): 같은 메시지 id의 답 조각이 다른
/// 것(생각 · 도구 · 계획) 없이 이어지면 한 메시지다. 턴이 끝날 때 그 턴의 마지막 메시지가 선다 — 끝나지 않은 턴(도는 중 · 죽음)의
/// 글은 아직 넘기지 않는다.
fn said(lines: &[RecordLine]) -> Vec<Said> {
    let mut said = Vec::new();
    let mut last: HashMap<&str, Message> = HashMap::new();
    for line in lines {
        match (line.kind, line.who.as_deref()) {
            (RecordKind::Sent, _) => {
                if let (Some(text), Some(to)) = (line.payload["text"].as_str(), line.payload["to"].as_str()) {
                    // 붙인 경로도 함께 — 그 말을 받지 않은 Agent도 사람이 보인 파일을 읽을 수 있게(v1 티켓 06).
                    let attached = Vec::<Attachment>::deserialize(&line.payload["attachments"]).unwrap_or_default();
                    let text = match attachments::listing(&attached) {
                        Some(listing) => format!("{listing}\n{text}"),
                        None => text.to_owned(),
                    };
                    said.push(Said { seq: line.seq, by: Speaker::Human { to: to.to_owned() }, text });
                }
            }
            (RecordKind::Update, Some(who)) => {
                let update = &line.payload["update"];
                match update["sessionUpdate"].as_str() {
                    Some("agent_message_chunk") => {
                        let chunk = update["content"]["text"].as_str().unwrap_or_default();
                        let id = &update["messageId"];
                        match last.get_mut(who) {
                            Some(message) if message.open && &message.id == id => message.text.push_str(chunk),
                            _ => {
                                last.insert(who, Message { id: id.clone(), text: chunk.to_owned(), open: true });
                            }
                        }
                    }
                    // 화면에서 답 글을 끊는 것들 — 그 뒤의 조각은 새 메시지다.
                    Some("agent_thought_chunk" | "tool_call" | "plan_update" | "plan") => {
                        if let Some(message) = last.get_mut(who) {
                            message.open = false;
                        }
                    }
                    _ => {}
                }
            }
            (RecordKind::TurnEnd, Some(who)) => {
                if let Some(message) = last.remove(who).filter(|message| !message.text.trim().is_empty()) {
                    said.push(Said { seq: line.seq, by: Speaker::Agent(who.to_owned()), text: message.text });
                }
            }
            // 끝 없이 사라진 턴(죽음)의 글은 다음 턴에 묻어 가지 않는다.
            (RecordKind::Session, Some(who)) => {
                last.remove(who);
            }
            _ => {}
        }
    }
    said
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

    /// 기록 줄들 — `(kind, who, payload)`를 seq 1부터 차례로.
    fn record(lines: &[(&str, Option<&str>, Value)]) -> Vec<RecordLine> {
        lines
            .iter()
            .enumerate()
            .map(|(n, (kind, who, payload))| {
                serde_json::from_value(json!({
                    "seq": n + 1, "at": "2026-10-23T10:00:00.000+09:00", "kind": kind, "who": who, "payload": payload,
                }))
                .expect("기록 줄")
            })
            .collect()
    }

    fn opened<'a>(who: &'a str, how: &str) -> (&'static str, Option<&'a str>, Value) {
        let state = json!({"state": "opened", "how": how, "agentVersion": null, "modes": null, "models": null, "configOptions": null});
        ("session", Some(who), state)
    }

    fn sent<'a>(to: &str, text: &str) -> (&'static str, Option<&'a str>, Value) {
        ("sent", None, json!({"text": text, "prompt": [], "sendNow": false, "to": to}))
    }

    fn update<'a>(who: &'a str, update: Value) -> (&'static str, Option<&'a str>, Value) {
        ("update", Some(who), json!({"sessionId": "s", "update": update}))
    }

    fn chunk<'a>(who: &'a str, id: &str, text: &str) -> (&'static str, Option<&'a str>, Value) {
        update(who, json!({"sessionUpdate": "agent_message_chunk", "messageId": id, "content": {"type": "text", "text": text}}))
    }

    fn tool(who: &str) -> (&'static str, Option<&str>, Value) {
        update(who, json!({"sessionUpdate": "tool_call", "toolCallId": "t", "title": "Read a.md", "kind": "read"}))
    }

    fn end(who: &str) -> (&'static str, Option<&str>, Value) {
        ("turn-end", Some(who), json!({"stopReason": "end_turn"}))
    }

    #[test]
    fn 남의_턴은_마지막_메시지만_넘기고_도구와_그_앞의_메시지는_넘기지_않는다() {
        let lines = record(&[
            opened("host", "new"),
            sent("host", "장바구니 고쳐 줘"),
            chunk("host", "m1", "먼저 "),
            chunk("host", "m1", "읽어 볼게요"),
            tool("host"),
            chunk("host", "m2", "고쳤어요. "),
            chunk("host", "m2", "테스트도 초록이에요"),
            end("host"),
            opened("reviewer", "new"),
        ]);
        assert_eq!(
            past(&lines, "reviewer", PAST_LIMIT).as_deref(),
            Some(format!("{HEAD}\n\n[사람 → @host]\n장바구니 고쳐 줘\n\n[@host]\n고쳤어요. 테스트도 초록이에요").as_str())
        );
    }

    #[test]
    fn 이어_쓰는_session은_자기에게_온_마지막_말_뒤의_것만_받고_제_말은_받지_않는다() {
        let lines = record(&[
            opened("reviewer", "new"),
            sent("reviewer", "봐 줘"),
            chunk("reviewer", "r1", "봤어요"),
            end("reviewer"),
            sent("host", "반영해 줘"),
            chunk("host", "h1", "반영했어요"),
            end("host"),
        ]);
        assert_eq!(
            past(&lines, "reviewer", PAST_LIMIT).as_deref(),
            Some(format!("{HEAD}\n\n[사람 → @host]\n반영해 줘\n\n[@host]\n반영했어요").as_str())
        );
        assert_eq!(past(&record(&[opened("reviewer", "new"), sent("reviewer", "봐 줘")]), "reviewer", PAST_LIMIT), None);
    }

    #[test]
    fn 새로_선_session은_thread_처음부터_받고_앞_session의_제_말도_받는다() {
        let lines = record(&[
            opened("host", "new"),
            sent("host", "어제의 말"),
            chunk("host", "h1", "어제의 답"),
            end("host"),
            opened("host", "resumed"),
            opened("host", "fresh"),
        ]);
        assert_eq!(
            past(&lines, "host", PAST_LIMIT).as_deref(),
            Some(format!("{HEAD}\n\n[사람 → @host]\n어제의 말\n\n[@host]\n어제의 답").as_str()),
            "되살리지 못해 새로 선 Session은 앞 Session을 모른다"
        );
        let resumed = &lines[..5];
        assert_eq!(past(resumed, "host", PAST_LIMIT), None, "resume으로 이은 Session은 그 말을 받았던 Session이다");
    }

    #[test]
    fn 끝나지_않은_턴의_글은_아직_넘기지_않고_죽은_턴의_글은_다음_턴에_묻어_가지_않는다() {
        let lines = record(&[
            opened("host", "new"),
            sent("host", "첫 말"),
            chunk("host", "h1", "죽기 전의 글"),
            ("session", Some("host"), json!({"state": "died", "reason": "끝남"})),
            opened("host", "resumed"),
            sent("host", "다시 말"),
            tool("host"),
            end("host"),
            chunk("host", "h2", "도는 중의 글"),
            opened("reviewer", "new"),
        ]);
        assert_eq!(
            past(&lines, "reviewer", PAST_LIMIT).as_deref(),
            Some(format!("{HEAD}\n\n[사람 → @host]\n첫 말\n\n[사람 → @host]\n다시 말").as_str())
        );
    }

    #[test]
    fn 상한을_넘으면_오래된_말부터_빼고_뺐다고_적는다() {
        let lines = record(&[
            opened("reviewer", "new"),
            sent("host", "하나"),
            sent("host", "둘"),
            sent("host", "셋"),
        ]);
        // 「[사람 → @host]\n둘」은 14글자, 사이(GAP) 2글자를 더해 16 — 둘 · 셋을 담으면 32다.
        assert_eq!(
            past(&lines, "reviewer", 32).as_deref(),
            Some(format!("{HEAD}\n앞의 말 1개는 상한 32글자를 넘어 뺐다.\n\n[사람 → @host]\n둘\n\n[사람 → @host]\n셋").as_str())
        );
    }

    #[test]
    fn 가장_새_말_하나도_상한을_넘으면_그_앞을_자르고_잘랐다고_적는다() {
        let lines = record(&[opened("reviewer", "new"), sent("host", "가나다라마바사아자차카타파하거너더러머버")]);
        // 말 하나가 이름표 「[사람 → @host]」 12글자 + 줄바꿈 1 + 글 20글자 + 사이 2 = 35로 상한 26을 넘는다. 자르면 이름표 ·
        // 줄바꿈 · 「…(앞을 줄였다)」 줄 10글자로 23이고, 남은 3글자에 글의 끝 셋이 든다.
        assert_eq!(
            past(&lines, "reviewer", 26).as_deref(),
            Some(format!("{HEAD}\n\n[사람 → @host]\n…(앞을 줄였다)\n러머버").as_str())
        );
    }
}
