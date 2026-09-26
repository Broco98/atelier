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

/// 물러섰을 때 안내문 앞에 붙는 한 줄. 뜻은 셋이다 — 어느 폴더를 왜 못 읽었는가, 사용자에게
/// 알려라, 부탁받기 전에는 고치지 마라(결정 15). 고치는 것은 사용자가 부탁한 뒤 레이아웃 도구로
/// 한다(결정 20) — 에이전트가 먼저 손대면 사용자가 모르는 새 안내문이 바뀐다.
fn fallback_line(fallback: &Fallback) -> String {
    format!(
        "Could not read the edited spec layout `{}/` ({}), so this is the built-in layout. \
         Tell the user. Do not fix the layout unless the user asks.",
        fallback.folder, fallback.reason
    )
}

/// 안내문에서 항목 하나가 차지한 줄 — 편집기의 미리보기 팝업이 고른 항목의 줄을 칠한다(구현 스펙 5절
/// 「배치」). 줄 규칙이 여기 한 벌이라 앱이 글을 다시 읽어 셈하지 않는다(결정 13).
///
/// 항목의 줄은 이름 줄, 여러 줄 설명의 뒷줄, `Template:` 줄이다. 맨 위 항목(`path`가 `[]`)의 줄은 방침
/// 문단이고, 그 설명이 비었으면 줄이 없어 여기에도 없다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct EntryLines {
    /// 맨 위 항목에서부터의 인덱스 경로 — 검증 오류의 자리(`LayoutError.path`)와 같은 모양이다.
    pub path: Vec<usize>,
    /// 첫 줄. 안내문을 `\n`으로 가른 줄을 0부터 센다.
    pub start: usize,
    pub count: usize,
}

/// 레이아웃을 안내문으로 옮긴다. **디스크를 보지 않는다** — 템플릿이 디스크에 있는지는
/// `templates`가, 물러섰는지는 `fallback`이 말한다.
///
/// 가리킨 템플릿이 판정에 없으면 그 `Template:` 줄을 빼고 경고로 돌려준다(결정 15). 판정이 아예
/// 없으면(내장본) 가리킨 템플릿은 모두 없는 것이다.
pub fn render_layout(
    layout: &SpecLayout,
    templates: Option<&TemplateVerdict>,
    fallback: Option<&Fallback>,
) -> Rendered {
    render_with_lines(layout, templates, fallback).0
}

/// `render_layout`과 같은 안내문에, 항목마다 그 글에서 차지한 줄을 더한다(`EntryLines`). 편집기의 미리보기가
/// 부른다 — 에이전트는 줄 자리가 필요 없다.
pub(crate) fn render_with_lines(
    layout: &SpecLayout,
    templates: Option<&TemplateVerdict>,
    fallback: Option<&Fallback>,
) -> (Rendered, Vec<EntryLines>) {
    let mut rows = Vec::new();
    collect_rows(&layout.root.children, &mut Vec::new(), &mut rows);
    let mut warnings = Vec::new();
    for row in &mut rows {
        row.template = template_path(row.entry, templates, &mut warnings);
    }
    let column = rows.iter().map(|row| row.head.chars().count()).max().unwrap_or(0) + 2;
    let list: Vec<String> = rows.iter().map(|row| row.line(column)).collect();

    let policy = &layout.root.description;
    let sections = [
        fallback.map(fallback_line).unwrap_or_default(),
        HEADER.to_string(),
        policy.clone(),
        list.join("\n"),
        grammar(&rows),
    ];
    // 덩어리마다 첫 줄을 센다 — 빈 덩어리는 줄이 없고, 덩어리 사이에는 빈 줄 하나가 선다.
    let mut starts = [0; 5];
    let mut next = 0;
    for (i, section) in sections.iter().enumerate() {
        starts[i] = next;
        if !section.is_empty() {
            next += line_count(section) + 1;
        }
    }
    let mut lines = Vec::new();
    if !policy.is_empty() {
        lines.push(EntryLines { path: Vec::new(), start: starts[2], count: line_count(policy) });
    }
    let mut start = starts[3];
    for (row, line) in rows.iter().zip(&list) {
        let count = line_count(line);
        lines.push(EntryLines { path: row.path.clone(), start, count });
        start += count;
    }

    // 빈 덩어리는 앞뒤 빈 줄과 함께 빠진다 — 덩어리 사이의 빈 줄은 늘 하나다.
    let text = sections.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n");
    (Rendered { text, warnings }, lines)
}

/// 글이 `\n`으로 갈리는 줄의 수 — 빈 글도 한 줄이다.
fn line_count(text: &str) -> usize {
    text.split('\n').count()
}

/// 항목의 템플릿을 `Template:` 줄에 실을 경로로 옮긴다. 판정에 없으면 경고를 남기고 없음이다.
fn template_path(
    entry: &LayoutEntry,
    templates: Option<&TemplateVerdict>,
    warnings: &mut Vec<String>,
) -> Option<String> {
    let template = entry.template.as_deref()?;
    let name = entry.pattern.as_deref().unwrap_or_default();
    match templates {
        Some(verdict) if verdict.present.contains(template) => {
            Some(format!("{}/{template}", verdict.folder))
        }
        Some(verdict) => {
            warnings.push(format!("missing template for `{name}`: {}/{template}", verdict.folder));
            None
        }
        None => {
            warnings.push(format!("missing template for `{name}`: {template}"));
            None
        }
    }
}

/// 문법 문단. **코드 틀은 문법만 말한다** — 방침은 맨 위 항목의 설명에 산다(결정 10).
///
/// 문장 셋이 따로따로 빠진다. 레이아웃이 쓰지 않은 문법을 설명하면 에이전트는 그런 자리가
/// 어딘가 있는 줄 안다. 템플릿 문장은 **실린** `Template:` 줄과 함께 선다 — 가리키기만 하고
/// 빠진 줄은 에이전트에게 없는 줄이다.
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
    let templates = rows.iter().any(|row| row.template.is_some()).then_some(
        "Where a file has a `Template:` line, read that template before you create the file and \
         follow its shape.",
    );
    [placeholders, folders, templates].into_iter().flatten().collect::<Vec<_>>().join(" ")
}

/// 안내문의 한 줄이 될 항목 — 「들여쓰기 + 이름」과 그 항목, 그 자리, 그리고 실을 템플릿 경로.
struct Row<'a> {
    head: String,
    entry: &'a LayoutEntry,
    /// 맨 위 항목에서부터의 인덱스 경로. 깊이는 이 길이다.
    path: Vec<usize>,
    /// `Template:` 줄에 실을 경로. 판정에 있는 템플릿일 때만 있다.
    template: Option<String>,
}

impl Row<'_> {
    /// 「들여쓰기 + 이름」 뒤에 설명을 `column`에 맞춰 붙인다. 설명 안의 줄바꿈은 같은 열에서
    /// 잇고, `Template:` 줄은 설명을 다 적은 뒤 같은 열에 선다.
    fn line(&self, column: usize) -> String {
        let mut description = self.entry.description.lines();
        let mut out = self.head.clone();
        if let Some(first) = description.next() {
            out.push_str(&" ".repeat(column - self.head.chars().count()));
            out.push_str(first);
        }
        let template = self.template.as_ref().map(|path| format!("Template: {path}"));
        for more in description.chain(template.as_deref()) {
            out.push('\n');
            out.push_str(&" ".repeat(column));
            out.push_str(more);
        }
        out
    }
}

/// 나열 순서 그대로, 깊이 우선으로 편다. 깊이마다 두 칸이고 최상위 항목이 두 칸이다. `parent`는 이
/// 항목들을 쥔 항목의 자리다.
fn collect_rows<'a>(entries: &'a [LayoutEntry], parent: &mut Vec<usize>, rows: &mut Vec<Row<'a>>) {
    for (i, entry) in entries.iter().enumerate() {
        parent.push(i);
        let name = entry.pattern.as_deref().unwrap_or_default();
        let slash = if entry.is_folder() { "/" } else { "" };
        let head = format!("{}{name}{slash}", "  ".repeat(parent.len()));
        rows.push(Row { head, entry, path: parent.clone(), template: None });
        collect_rows(&entry.children, parent, rows);
        parent.pop();
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

    /// 템플릿 판정도 물러서기도 없는 render — 줄 규칙과 문법 문단만 볼 때 쓴다.
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
    fn grammar_paragraph(guidance: &str) -> &str {
        guidance.rsplit("\n\n").next().unwrap()
    }

    /// 자리 표시자 문장은 레이아웃이 **쓴** 자리 표시자만 말한다. `{n}`만 쓴 레이아웃은 `{name}`을
    /// 모르고, 그 반대도 그렇다. 틀이 어느 깊이에 있든 쓴 것이다.
    #[test]
    fn the_placeholder_sentence_explains_only_the_placeholders_in_use() {
        let numbered = text(&layout("", vec![file("adr-{n}.md", "")]));
        assert_eq!(grammar_paragraph(&numbered), "`{n}` is a number.");

        let named = text(&layout("", vec![folder("docs", "", vec![file("{name}.md", "")])]));
        assert_eq!(
            grammar_paragraph(&named),
            "`{name}` is any name without `/`. A trailing `/` marks a folder, and indentation \
             shows what goes inside it."
        );

        let both = text(&layout("", vec![file("{n}-{name}.md", "")]));
        assert_eq!(
            grammar_paragraph(&both),
            "`{n}` is a number and `{name}` is any name without `/`."
        );
    }

    /// 폴더 항목이 없으면 폴더 문장이 빠지고, `Template:` 줄이 없으면 템플릿 문장이 빠진다.
    /// 셋 다 빠지면 문단도 없다 — 목록이 마지막 덩어리다.
    #[test]
    fn with_no_grammar_to_explain_the_paragraph_is_gone() {
        let plain = text(&layout("", vec![file("a.md", "A")]));
        assert_eq!(plain, "Spec layout — how to arrange documents inside `specDir`.\n\n  a.md  A");
    }

    fn with_template(mut entry: LayoutEntry, template: &str) -> LayoutEntry {
        entry.template = Some(template.to_string());
        entry
    }

    /// 템플릿 판정 — 디스크 없이 손으로 적는다. render는 판정만 본다.
    fn verdict(present: &[&str]) -> TemplateVerdict {
        TemplateVerdict {
            present: present.iter().map(|path| path.to_string()).collect(),
            folder: "~/.atelier/layouts/atelier".to_string(),
        }
    }

    /// 템플릿을 가진 파일 둘(설명 있음·없음)과 폴더 하나.
    fn templated() -> SpecLayout {
        layout(
            "",
            vec![
                with_template(file("decisions.md", "why"), "decisions.md"),
                with_template(file("plan.md", ""), "templates/plan.md"),
                folder("notes", "N", vec![]),
            ],
        )
    }

    /// 판정에 있는 템플릿은 `Template:` 줄로 실린다 — **그 파일 항목 바로 아래, 설명 열에** 선다.
    /// 경로는 판정의 레이아웃 폴더에 템플릿 경로를 이은 것이다. 설명이 빈 항목도 그렇다.
    #[test]
    fn a_present_template_gets_a_template_line_under_its_file() {
        let present = verdict(&["decisions.md", "templates/plan.md"]);
        let out = render_layout(&templated(), Some(&present), None);
        assert_eq!(
            rows(&out.text),
            [
                "  decisions.md  why",
                "                Template: ~/.atelier/layouts/atelier/decisions.md",
                "  plan.md",
                "                Template: ~/.atelier/layouts/atelier/templates/plan.md",
                "  notes/        N",
            ]
        );
        assert_eq!(out.warnings, Vec::<String>::new());
    }

    /// 여러 줄 설명이면 `Template:` 줄은 설명을 다 적은 뒤에 선다 — 설명 사이에 끼면 둘째 줄이
    /// 템플릿의 설명처럼 읽힌다.
    #[test]
    fn the_template_line_follows_a_multi_line_description() {
        let multi = layout("", vec![with_template(file("a.md", "first\nsecond"), "a.md")]);
        let out = render_layout(&multi, Some(&verdict(&["a.md"])), None);
        assert_eq!(
            rows(&out.text),
            ["  a.md  first", "        second", "        Template: ~/.atelier/layouts/atelier/a.md"]
        );
    }

    /// 판정에 없는 템플릿은 줄이 빠지고 **경고로 돌아온다**(결정 15). 없는 파일을 읽으라고 하면
    /// 에이전트는 읽기에 실패하고 모양을 지어낸다. 경고는 빠진 경로를 말한다.
    #[test]
    fn a_missing_template_drops_its_line_and_comes_back_as_a_warning() {
        let out = render_layout(&templated(), Some(&verdict(&["decisions.md"])), None);
        assert_eq!(
            rows(&out.text),
            [
                "  decisions.md  why",
                "                Template: ~/.atelier/layouts/atelier/decisions.md",
                "  plan.md",
                "  notes/        N",
            ]
        );
        assert_eq!(out.warnings.len(), 1, "{:?}", out.warnings);
        assert!(
            out.warnings[0].contains("~/.atelier/layouts/atelier/templates/plan.md"),
            "{:?}",
            out.warnings
        );

        // 판정이 아예 없으면(내장본의 자리) 가리킨 템플릿은 모두 없는 것이다
        let none = render_layout(&templated(), None, None);
        assert!(!none.text.contains("Template:"), "{}", none.text);
        assert_eq!(none.warnings.len(), 2, "{:?}", none.warnings);
    }

    /// 템플릿 문장은 **실린** `Template:` 줄이 있을 때만 문법 문단에 선다 — 가리키기만 하고 빠진
    /// 줄은 세지 않는다.
    #[test]
    fn the_template_sentence_stands_only_beside_a_template_line() {
        let with_line = render_layout(&templated(), Some(&verdict(&["decisions.md"])), None);
        assert_eq!(
            grammar_paragraph(&with_line.text),
            "A trailing `/` marks a folder, and indentation shows what goes inside it. Where a \
             file has a `Template:` line, read that template before you create the file and \
             follow its shape."
        );

        let without = render_layout(&templated(), Some(&verdict(&[])), None);
        assert_eq!(
            grammar_paragraph(&without.text),
            "A trailing `/` marks a folder, and indentation shows what goes inside it."
        );
    }

    /// 물러섰을 때 **맨 앞에** 붙는 한 줄이 담아야 할 뜻 셋(구현 스펙 1절 「render」) — 01의 뜻
    /// 보존과 같은 방식으로 뜻마다 대표 구절 하나다.
    const FALLBACK_MEANING: [(&str, &str); 4] = [
        ("읽지 못한 레이아웃 폴더", "`~/.atelier/layouts/atelier/`"),
        ("그 이유", "(layout.json is missing)"),
        ("사용자에게 알려라", "Tell the user"),
        ("부탁하기 전에는 고치지 마라", "Do not fix the layout unless the user asks"),
    ];

    /// 물러서면 안내문 **앞에** 한 줄이 붙는다 — 먼저 읽혀야 알릴 수 있다. 그 뒤는 물러서지 않은
    /// render와 글자까지 같다.
    #[test]
    fn a_fallback_puts_one_line_in_front_of_the_guidance() {
        let builtin = crate::layout::builtin::builtin_layout(crate::Mode::Atelier);
        let fallback = Fallback {
            folder: "~/.atelier/layouts/atelier".to_string(),
            reason: "layout.json is missing".to_string(),
        };
        let out = render_layout(&builtin, None, Some(&fallback)).text;
        let (first, rest) = out.split_once("\n\n").unwrap();
        assert!(!first.contains('\n'), "앞에 붙는 것은 한 줄이다: {first}");
        for (what, phrase) in FALLBACK_MEANING {
            assert!(first.contains(phrase), "물러선 줄이 뜻을 잃었다 ({what}): {first}");
        }
        assert_eq!(rest, text(&builtin));
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
