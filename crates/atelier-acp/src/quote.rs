//! 인용(three-axes 티켓 27 · 구현 스펙 「인용」 · S12) — 스펙 창에서 고른 자리를 사람의 말에 붙여 보낸다.
//!
//! 화면이 넘기는 것은 spec 폴더 기준 파일 · 원문 줄 범위 · 고른 글이다. 호스트는 그것으로 **인용 블록**을 지어 사람의
//! 글 바로 앞에 따로 된 텍스트 블록으로 둔다. 블록은 atelier 참조 꼴(실제 경로 + `:L<시작>-<끝>`, 한 줄이면 `:L<n>`)과
//! 마크다운 인용 글이다 — atelier MCP 안내문(`atelier-cli`의 `instructions.rs`)이 에이전트에게 이미 가르치는 꼴이고,
//! 스펙 창의 「줄 참조 복사」(`src/features/works/refs.ts`)가 내는 줄 범위 꼬리와 같다.

use std::fmt;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// 보낸 말에 붙은 인용 — 보내기 명령의 인자이고, `sent` 줄에 그대로 남아 화면이 보낸 말 위에 세운다(스토리 81).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Quote {
    /// spec 폴더 기준 경로(`drafts/idea.md`). 폴더 밖을 가리킬 수 없다.
    pub file: String,
    /// 원문의 시작 줄 — 1부터 센다. 렌더 보기면 고른 글이 걸친 첫 블록의 시작 줄이다.
    pub start: u32,
    /// 원문의 끝 줄(포함). 렌더 보기면 마지막 블록의 끝 줄이다.
    pub end: u32,
    /// 고른 글.
    pub text: String,
}

/// 인용이 올바르지 않다 — 화면에 그대로 보일 글이다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BadQuote(&'static str);

impl fmt::Display for BadQuote {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

/// 보낼 말에 붙은 인용과 그것으로 지은 인용 블록. 대기 줄에 든 말은 넣을 때 지어 둔 이것을 들고 있다가 차례가 오면
/// 그대로 보낸다.
#[derive(Debug, Clone)]
pub(crate) struct Attached {
    pub(crate) quote: Quote,
    pub(crate) block: Value,
}

impl Quote {
    /// 이 인용을 `spec` 폴더의 것으로 붙인다 — 인용 블록을 짓는다.
    pub(crate) fn attach(&self, spec: &Path) -> Result<Attached, BadQuote> {
        Ok(Attached { quote: self.clone(), block: self.block(spec)? })
    }

    /// 인용 블록(S12) — `spec` 폴더 안의 그 파일을 실제 경로로 가리키는 참조 한 줄, 빈 줄, 고른 글의 마크다운 인용, 빈 줄.
    /// 폴더 밖을 가리키거나 줄 범위가 뒤집혔거나 글이 비었으면 보내지 않는다.
    ///
    /// **빈 줄로 끝난다**(v1 티켓 35) — claude는 한 말의 글 블록을 사이 없이 이어 읽는다(v1 티켓 09). 인용 끝 줄 바로 뒤에 본문이 오면
    /// 마크다운의 게으른 이어짐으로 본문 첫 줄까지 인용 안의 글이 된다.
    fn block(&self, spec: &Path) -> Result<Value, BadQuote> {
        let inside = !self.file.is_empty()
            && Path::new(&self.file).components().all(|part| matches!(part, Component::Normal(_)));
        if !inside {
            return Err(BadQuote("인용한 파일이 spec 폴더 안에 있지 않습니다"));
        }
        if self.start == 0 || self.end < self.start {
            return Err(BadQuote("인용한 줄 범위가 올바르지 않습니다"));
        }
        if self.text.trim().is_empty() {
            return Err(BadQuote("인용한 글이 비었습니다"));
        }
        let lines =
            if self.end > self.start { format!("L{}-{}", self.start, self.end) } else { format!("L{}", self.start) };
        let quoted: String =
            self.text.lines().map(|line| if line.is_empty() { ">\n".to_owned() } else { format!("> {line}\n") }).collect();
        let text = format!("{}:{lines}\n\n{quoted}\n", spec.join(&self.file).display());
        Ok(json!({"type": "text", "text": text}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 렌더 보기에서 고른 자리 — `plan.md`의 문단 한 블록(3–4줄)이다. 글은 화면이 고른 그대로(두 줄)다.
    fn paragraph() -> Quote {
        Quote { file: "plan.md".into(), start: 3, end: 4, text: "요약 한 줄.\n첫 문단을 고쳤다.".into() }
    }

    #[test]
    fn 인용_블록은_실제_경로와_줄_범위_한_줄_빈_줄_마크다운_인용_글_빈_줄이다() {
        let spec = Path::new("/works/cart/spec");
        let attached = paragraph().attach(spec).expect("올바른 인용");
        assert_eq!(attached.quote, paragraph());
        assert_eq!(
            attached.block,
            json!({"type": "text", "text": "/works/cart/spec/plan.md:L3-4\n\n> 요약 한 줄.\n> 첫 문단을 고쳤다.\n\n"})
        );

        let one_line = Quote { file: "drafts/idea.md".into(), start: 2, end: 2, text: "  들여 쓴 줄\n\n끝".into() };
        assert_eq!(
            one_line.attach(spec).expect("한 줄 인용").block,
            json!({"type": "text", "text": "/works/cart/spec/drafts/idea.md:L2\n\n>   들여 쓴 줄\n>\n> 끝\n\n"}),
            "한 줄이면 `:L<n>`이고, 빈 줄도 인용 안에 남는다"
        );
    }

    #[test]
    fn spec_폴더_밖을_가리키거나_줄_범위가_뒤집히거나_글이_빈_인용은_읽히는_오류다() {
        let spec = Path::new("/works/cart/spec");
        let bad = [
            Quote { file: "../work.json".into(), ..paragraph() },
            Quote { file: "/etc/hosts".into(), ..paragraph() },
            Quote { file: String::new(), ..paragraph() },
            Quote { start: 0, end: 0, ..paragraph() },
            Quote { start: 5, end: 4, ..paragraph() },
            Quote { text: " \n ".into(), ..paragraph() },
        ];
        for quote in &bad {
            let error = quote.attach(spec).expect_err("거절");
            assert!(error.to_string().starts_with("인용"), "화면에 보일 글이다: {quote:?} → {error}");
        }
    }
}
