//! render — 레이아웃을 에이전트가 받는 안내문으로 옮긴다.

use std::collections::BTreeSet;

use super::model::{LayoutEntry, SpecLayout};

/// 파일에서 온 레이아웃의 템플릿 판정. resolve가 만들고 render는 **이것만** 본다 — 디스크를
/// 직접 보지 않는다. 내장본에는 없다(템플릿이 디스크에 있어야 경로로 건넬 수 있다).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TemplateVerdict {
    /// 레이아웃 폴더 기준 템플릿 경로 가운데 디스크에 실제로 있는 것
    pub present: BTreeSet<String>,
    /// 안내문에 보일 레이아웃 폴더 경로. 홈은 `~`로 줄여 둔다.
    pub folder: String,
}

/// 모드의 폴더를 못 써서 내장본으로 물러선 까닭.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fallback {
    /// 읽지 못한 레이아웃 폴더. 홈은 `~`로 줄여 둔다.
    pub folder: String,
    pub reason: String,
}

/// render의 결과 — 안내문과 경고.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Rendered {
    pub text: String,
    pub warnings: Vec<String>,
}

/// 머리 줄. 코드 틀이라 영어다 — 이 표면(도구 설명·지침·커널 오류)은 통째로 영어이고, 사용자가
/// 적은 이름과 설명만 사용자의 언어다.
const HEADER: &str = "Spec layout — how to arrange documents inside `specDir`.";

/// 레이아웃을 안내문으로 옮긴다. **디스크를 보지 않는다** — 템플릿이 디스크에 있는지는
/// `templates`가, 물러섰는지는 `fallback`이 말한다.
///
/// 이 판은 둘을 아직 안 쓴다. `Template:` 줄과 물러섰을 때의 앞 줄은 레이아웃 폴더를 읽는 판이
/// 더한다 — 인자 모양을 먼저 열어 두어 그 판에서 부르는 쪽이 안 바뀌게 했다.
pub fn render_layout(
    layout: &SpecLayout,
    _templates: Option<&TemplateVerdict>,
    _fallback: Option<&Fallback>,
) -> Rendered {
    let mut rows = Vec::new();
    collect_rows(&layout.root.children, 1, &mut rows);
    let column = rows.iter().map(|row| row.head.chars().count()).max().unwrap_or(0) + 2;
    let list: Vec<String> = rows.iter().map(|row| row.line(column)).collect();

    let sections = [
        HEADER.to_string(),
        layout.root.description.clone(),
        list.join("\n"),
        grammar(&rows),
    ];
    // 빈 덩어리는 앞뒤 빈 줄과 함께 빠진다 — 덩어리 사이의 빈 줄은 늘 하나다.
    let text = sections.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n");
    Rendered { text, warnings: Vec::new() }
}

/// 문법 문단. **코드 틀은 문법만 말한다** — 방침은 맨 위 항목의 설명에 산다(결정 10).
///
/// 문장 셋이 따로따로 빠진다. 레이아웃이 쓰지 않은 문법을 설명하면 에이전트는 그런 자리가
/// 어딘가 있는 줄 안다. `Template:` 줄의 문장은 그 줄과 함께 붙는다 — 이 판의 레이아웃은 늘
/// 내장본이라 그 줄이 아직 없다.
fn grammar(rows: &[Row]) -> String {
    let uses = |placeholder: &str| {
        rows.iter().any(|row| row.entry.pattern.as_deref().is_some_and(|p| p.contains(placeholder)))
    };
    let placeholders = match (uses("{n}"), uses("{name}")) {
        (true, true) => Some("`{n}` is a number and `{name}` is any name without `/`."),
        (true, false) => Some("`{n}` is a number."),
        (false, true) => Some("`{name}` is any name without `/`."),
        (false, false) => None,
    };
    let folders = rows
        .iter()
        .any(|row| row.entry.is_folder())
        .then_some("A trailing `/` marks a folder, and indentation shows what goes inside it.");
    [placeholders, folders].into_iter().flatten().collect::<Vec<_>>().join(" ")
}

/// 안내문의 한 줄이 될 항목 — 「들여쓰기 + 이름」과 그 항목.
struct Row<'a> {
    head: String,
    entry: &'a LayoutEntry,
}

impl Row<'_> {
    /// 「들여쓰기 + 이름」 뒤에 설명을 `column`에 맞춰 붙인다. 설명 안의 줄바꿈은 같은 열에서
    /// 잇는다.
    fn line(&self, column: usize) -> String {
        let mut description = self.entry.description.lines();
        let mut out = self.head.clone();
        if let Some(first) = description.next() {
            out.push_str(&" ".repeat(column - self.head.chars().count()));
            out.push_str(first);
        }
        for more in description {
            out.push('\n');
            out.push_str(&" ".repeat(column));
            out.push_str(more);
        }
        out
    }
}

/// 나열 순서 그대로, 깊이 우선으로 편다. 깊이마다 두 칸이고 최상위 항목이 두 칸이다.
fn collect_rows<'a>(entries: &'a [LayoutEntry], depth: usize, rows: &mut Vec<Row<'a>>) {
    for entry in entries {
        let name = entry.pattern.as_deref().unwrap_or_default();
        let slash = if entry.is_folder() { "/" } else { "" };
        rows.push(Row { head: format!("{}{name}{slash}", "  ".repeat(depth)), entry });
        collect_rows(&entry.children, depth + 1, rows);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::model::EntryKind;

    fn file(pattern: &str, description: &str) -> LayoutEntry {
        LayoutEntry {
            pattern: Some(pattern.to_string()),
            kind: Some(EntryKind::File),
            description: description.to_string(),
            ..LayoutEntry::default()
        }
    }

    fn folder(pattern: &str, description: &str, children: Vec<LayoutEntry>) -> LayoutEntry {
        LayoutEntry {
            pattern: Some(pattern.to_string()),
            kind: Some(EntryKind::Folder),
            description: description.to_string(),
            children,
            ..LayoutEntry::default()
        }
    }

    fn layout(root_description: &str, children: Vec<LayoutEntry>) -> SpecLayout {
        SpecLayout {
            root: LayoutEntry {
                description: root_description.to_string(),
                children,
                ..LayoutEntry::default()
            },
            ..SpecLayout::default()
        }
    }

    /// 템플릿 판정도 물러서기도 없는 render — 이 판의 레이아웃은 늘 내장본이다.
    fn text(layout: &SpecLayout) -> String {
        render_layout(layout, None, None).text
    }

    /// 항목 줄만. 항목 줄은 들여쓰기로 시작하고, 머리 줄·방침·문법 문단은 그렇지 않다.
    fn rows(text: &str) -> Vec<&str> {
        text.lines().filter(|line| line.starts_with("  ")).collect()
    }

    /// 깊이마다 두 칸 — 최상위 항목이 두 칸, 그 자식이 네 칸, 셋째 층이 여섯 칸이다. 폴더는 끝에
    /// `/`를 달고 파일은 안 단다. 순서는 나열 순서를 깊이 우선으로 편 것이다.
    #[test]
    fn every_level_indents_two_more_spaces_and_folders_end_in_a_slash() {
        let nested =
            layout("", vec![folder("a", "A", vec![folder("b", "B", vec![file("c.md", "C")])])]);
        assert_eq!(rows(&text(&nested)), ["  a/        A", "    b/      B", "      c.md  C"]);
    }

    /// 설명 열은 가장 긴 「들여쓰기 + 이름」에 두 칸을 더한 자리다. **글자 수로 센다** — 한국어
    /// 이름을 바이트로 세면 그 줄만 열이 밀린다.
    #[test]
    fn descriptions_line_up_two_spaces_past_the_longest_name() {
        let korean = layout("", vec![file("overview.md", "x"), folder("학습-계획", "y", vec![])]);
        assert_eq!(rows(&text(&korean)), ["  overview.md  x", "  학습-계획/       y"]);
    }

    /// 설명 안의 줄바꿈은 설명 열에 맞춰 잇는다 — 둘째 줄이 줄 머리로 돌아가면 다음 항목의
    /// 이름처럼 읽힌다.
    #[test]
    fn a_multi_line_description_continues_at_the_description_column() {
        let multi = layout("", vec![file("a.md", "first\nsecond"), file("longer.md", "z")]);
        let guidance = text(&multi);
        let list: Vec<&str> =
            guidance.lines().skip_while(|line| !line.starts_with("  a.md")).take(3).collect();
        assert_eq!(list, ["  a.md       first", "             second", "  longer.md  z"]);
    }

    /// 설명이 비면 이름만 적는다 — 열을 맞추려는 빈칸이 줄 끝에 남지 않는다.
    #[test]
    fn an_empty_description_leaves_the_name_alone() {
        let bare = layout("", vec![file("a.md", ""), file("bb.md", "B")]);
        assert_eq!(rows(&text(&bare)), ["  a.md", "  bb.md  B"]);
    }

    /// 맨 위 항목의 설명이 비면 그 문단이 **앞뒤 빈 줄과 함께** 빠진다 — 머리 줄과 목록 사이에 빈
    /// 줄이 둘 남지 않는다.
    #[test]
    fn an_empty_root_description_drops_its_paragraph() {
        let no_policy = layout("", vec![folder("notes", "N", vec![])]);
        assert_eq!(
            text(&no_policy),
            "Spec layout — how to arrange documents inside `specDir`.\n\
             \n  notes/  N\n\
             \nA trailing `/` marks a folder, and indentation shows what goes inside it."
        );
    }

    /// 마지막 문단 — 문법 문단. 레이아웃이 쓰지 않은 문법은 설명하지 않는다.
    fn grammar(guidance: &str) -> &str {
        guidance.rsplit("\n\n").next().unwrap()
    }

    /// 자리 표시자 문장은 레이아웃이 **쓴** 자리 표시자만 말한다. `{n}`만 쓴 레이아웃은 `{name}`을
    /// 모르고, 그 반대도 그렇다. 틀이 어느 깊이에 있든 쓴 것이다.
    #[test]
    fn the_placeholder_sentence_explains_only_the_placeholders_in_use() {
        let numbered = text(&layout("", vec![file("adr-{n}.md", "")]));
        assert_eq!(grammar(&numbered), "`{n}` is a number.");

        let named = text(&layout("", vec![folder("docs", "", vec![file("{name}.md", "")])]));
        assert_eq!(
            grammar(&named),
            "`{name}` is any name without `/`. A trailing `/` marks a folder, and indentation \
             shows what goes inside it."
        );

        let both = text(&layout("", vec![file("{n}-{name}.md", "")]));
        assert_eq!(grammar(&both), "`{n}` is a number and `{name}` is any name without `/`.");
    }

    /// 폴더 항목이 없으면 폴더 문장이 빠지고, `Template:` 줄이 없으면 템플릿 문장이 빠진다.
    /// 셋 다 빠지면 문단도 없다 — 목록이 마지막 덩어리다.
    #[test]
    fn with_no_grammar_to_explain_the_paragraph_is_gone() {
        let plain = text(&layout("", vec![file("a.md", "A")]));
        assert_eq!(plain, "Spec layout — how to arrange documents inside `specDir`.\n\n  a.md  A");
    }

    /// `icon`은 앱만 쓰는 값이다 — 에이전트에게 가는 글에는 없다.
    #[test]
    fn the_icon_is_not_part_of_the_guidance() {
        let mut overview = file("overview.md", "the summary");
        overview.icon = Some("compass".to_string());
        let guidance = text(&layout("", vec![overview]));
        assert!(!guidance.contains("compass"), "{guidance}");
    }
}
