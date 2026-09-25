//! 이름 틀 — `overview.md`, `{n}-{name}`, `adr-{n}-{name}.md` 같은 항목의 `pattern`을 조각낸다.
//!
//! **검증과 매칭이 같은 조각을 본다.** 읽기(parse)는 이 파서가 거절하는 틀을 검증 오류로 올리고,
//! 분류(classify)는 이 파서가 낸 조각으로 파일 이름을 맞춘다. 둘이 틀을 따로 읽으면 검증이 받은
//! 틀을 매처가 다르게 읽는 날이 온다.
//!
//! 자리 표시자는 `{n}`과 `{name}` 둘뿐이고 한 틀에 각각 한 번까지다(구현 스펙 1절 「이름 틀」).
//! `{`와 `}` 사이의 것만 자리 표시자로 읽는다 — 짝 없는 괄호는 그냥 글자다.

/// 틀의 조각 하나.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Piece<'a> {
    /// 글자 그대로 맞아야 하는 부분
    Text(&'a str),
    /// `{n}` — ASCII 숫자 하나 이상
    Number,
    /// `{name}` — 비어 있지 않은 글자
    Name,
}

/// 틀을 조각낸다. 문법에 어긋나면 무엇이 틀렸는지 말하는 영어 문장을 준다 — 커널 오류라 영어다.
///
/// 거절하는 것: 빈 틀, `/`가 든 틀(비교는 경로 조각 하나 단위다), 모르는 자리 표시자, 같은 자리
/// 표시자를 두 번 쓴 틀, 두 자리 표시자가 사이에 글자 없이 붙은 틀(`{n}{name}` — 숫자가 어디서
/// 끝나고 이름이 어디서 시작하는지 정할 수 없다).
pub(crate) fn pieces(pattern: &str) -> Result<Vec<Piece<'_>>, String> {
    if pattern.is_empty() {
        return Err("`pattern` is empty".to_string());
    }
    if pattern.contains('/') {
        return Err(format!("`pattern` must not contain `/`: {pattern:?}"));
    }
    let mut out = Vec::new();
    let mut rest = pattern;
    while !rest.is_empty() {
        let placeholder = rest
            .find('{')
            .and_then(|open| rest[open..].find('}').map(|close| (open, open + close + 1)));
        let Some((open, close)) = placeholder else {
            out.push(Piece::Text(rest));
            break;
        };
        if open > 0 {
            out.push(Piece::Text(&rest[..open]));
        }
        let piece = match &rest[open..close] {
            "{n}" => Piece::Number,
            "{name}" => Piece::Name,
            // 사용자가 적은 글이라 이스케이프해 적는다 — 줄바꿈이 들면 한 줄 까닭이 여러 줄로 깨진다
            unknown => {
                return Err(format!(
                    "unknown placeholder `{}` in {pattern:?} (only `{{n}}` and `{{name}}`)",
                    unknown.escape_debug()
                ))
            }
        };
        if out.contains(&piece) {
            let written = &rest[open..close];
            return Err(format!("`{written}` appears twice in {pattern:?}"));
        }
        if let Some(before @ (Piece::Number | Piece::Name)) = out.last() {
            let pair = format!("{}{}", spelling(*before), &rest[open..close]);
            return Err(format!(
                "`{pair}` in {pattern:?} needs some text between the two placeholders"
            ));
        }
        out.push(piece);
        rest = &rest[close..];
    }
    Ok(out)
}

fn spelling(piece: Piece<'_>) -> &'static str {
    match piece {
        Piece::Number => "{n}",
        Piece::Name => "{name}",
        Piece::Text(_) => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 고정 이름은 글자 조각 하나이고, 자리 표시자는 제 조각이 된다. 짝 없는 괄호는 글자다.
    #[test]
    fn a_pattern_splits_into_text_and_placeholders() {
        assert_eq!(pieces("overview.md"), Ok(vec![Piece::Text("overview.md")]));
        assert_eq!(
            pieces("adr-{n}-{name}.md"),
            Ok(vec![Piece::Text("adr-"), Piece::Number, Piece::Text("-"), Piece::Name, Piece::Text(".md")])
        );
        assert_eq!(pieces("{name}"), Ok(vec![Piece::Name]));
        assert_eq!(pieces("a{b"), Ok(vec![Piece::Text("a{b")]));
        assert_eq!(pieces("x}{n}"), Ok(vec![Piece::Text("x}"), Piece::Number]));
    }

    /// 거절 문장은 한 줄이다 — 물러선 안내문 앞에 한 줄로 실린다. 틀 안의 줄바꿈은 이스케이프해
    /// 적는다.
    #[test]
    fn a_refusal_stays_on_one_line_even_when_the_pattern_holds_a_newline() {
        let message = pieces("{a\nb}").unwrap_err();
        assert!(message.contains("unknown placeholder `{a\\nb}`"), "{message}");
        assert!(!message.contains('\n'), "{message}");
    }
}
