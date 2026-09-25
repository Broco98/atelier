//! 디스크 형식 — `layout.json`을 읽고(parse) 쓴다(serialize). 읽기가 곧 검증이다.
//!
//! 모양은 구현 스펙 1절 「디스크 형식」의 JSON이다. 사용자가 손으로도 고치는 계약이라, 읽기는
//! 틀린 곳을 **항목의 위치와 함께** 모두 돌려준다 — 설정 페이지가 그 항목을 가리키고, 물러선
//! 안내문이 첫 오류를 적는다.

use serde_json::{Map, Value};

use super::model::{EntryKind, LayoutEntry, SpecLayout};
use super::pattern::pieces;
use super::resolve::LAYOUT_FILE;

/// 검증 오류 하나. 밖으로는 `{ path, message }`로 나간다 — 편집기와 에이전트가 위치를 글에서
/// 다시 풀지 않게 데이터로 건넨다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct LayoutError {
    /// 맨 위 항목에서부터의 인덱스 경로 — `[]`이 맨 위 항목, `[2, 0]`이 그 셋째 자식의 첫 자식이다.
    /// `None`이면 항목이 아니라 문서 전체의 오류다(JSON 문법, `root` 없음).
    pub path: Option<Vec<usize>>,
    pub message: String,
}

/// 위치를 JSON의 경로로 적는다(`root.children[1].children[0]: …`) — 사람이 `layout.json`을 열어
/// 그 항목을 찾아갈 수 있는 모양이다. 물러선 안내문의 까닭이 이 글이다.
impl std::fmt::Display for LayoutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(path) = &self.path {
            f.write_str("root")?;
            for i in path {
                write!(f, ".children[{i}]")?;
            }
            f.write_str(": ")?;
        }
        f.write_str(&self.message)
    }
}

impl LayoutError {
    pub(crate) fn document(message: impl Into<String>) -> Self {
        Self { path: None, message: message.into() }
    }

    pub(crate) fn at(path: &[usize], message: impl Into<String>) -> Self {
        Self { path: Some(path.to_vec()), message: message.into() }
    }
}

/// `layout.json` 본문을 읽는다. 틀린 곳이 하나라도 있으면 레이아웃 대신 오류 **목록**을 준다.
///
/// **serde 파생 대신 값을 손으로 걷는다.** 모르는 키를 담는 `flatten`이 걸린 구조체는 serde가
/// 통째로 버퍼에 담아 읽어서, `"kind": "fil"` 같은 타입 오류가 어느 항목의 것인지 흐려진다.
/// 걸으면 모든 오류가 제 항목의 위치를 갖고, 첫 오류에서 멈추지 않고 전부 모은다.
pub fn parse_layout(text: &str) -> Result<SpecLayout, Vec<LayoutError>> {
    let value: Value = serde_json::from_str(text)
        .map_err(|e| vec![LayoutError::document(format!("layout.json is not valid JSON: {e}"))])?;
    parse_layout_value(value)
}

/// 이미 JSON 값인 레이아웃을 읽는다 — 저장이 받는 모양이다. 에이전트와 편집기는 레이아웃을 글이
/// 아니라 값으로 건넨다(모르는 키가 그 안에 산다). 검증은 글에서 읽을 때와 한 벌이다.
pub(crate) fn parse_layout_value(value: Value) -> Result<SpecLayout, Vec<LayoutError>> {
    let Value::Object(mut top) = value else {
        return Err(vec![LayoutError::document("layout.json must be a JSON object")]);
    };
    let root = match top.remove("root") {
        Some(Value::Object(root)) => root,
        Some(_) => return Err(vec![LayoutError::document("`root` must be a JSON object")]),
        None => return Err(vec![LayoutError::document("`root` is missing")]),
    };
    let mut errors = Vec::new();
    let root = read_entry(root, &mut Vec::new(), &mut errors);
    if errors.is_empty() {
        Ok(SpecLayout { root, extra: top })
    } else {
        Err(errors)
    }
}

/// 레이아웃을 `layout.json` 본문으로 쓴다. 모르는 키도 제 층에 되돌려 적는다.
///
/// 빈 설명, 없는 아이콘·템플릿, 빈 자식 목록은 키째 빠진다 — 읽기가 그것들을 없음으로 읽으므로
/// 다시 읽으면 같은 레이아웃이다. 사람이 여는 파일이라 끝에 줄바꿈을 둔다.
pub fn serialize_layout(layout: &SpecLayout) -> String {
    let mut top = Map::new();
    top.insert("root".to_string(), write_entry(&layout.root));
    keep_unknown(&mut top, &layout.extra);
    let mut out = serde_json::to_string_pretty(&Value::Object(top))
        .expect("a JSON value always serializes");
    out.push('\n');
    out
}

/// 아는 키는 스펙 예시의 순서(이름 틀, 종류, 아이콘, 설명, 템플릿, 자식)로 적는다. 순서가 파일에
/// 남는 것은 `preserve_order`가 켜진 앱에서뿐이다.
fn write_entry(entry: &LayoutEntry) -> Value {
    let mut map = Map::new();
    let mut put = |key: &str, value: Value| {
        map.insert(key.to_string(), value);
    };
    if let Some(pattern) = &entry.pattern {
        put("pattern", pattern.clone().into());
    }
    if let Some(kind) = entry.kind {
        put("kind", match kind {
            EntryKind::File => "file",
            EntryKind::Folder => "folder",
        }
        .into());
    }
    if let Some(icon) = &entry.icon {
        put("icon", icon.clone().into());
    }
    if !entry.description.is_empty() {
        put("description", entry.description.clone().into());
    }
    if let Some(template) = &entry.template {
        put("template", template.clone().into());
    }
    if !entry.children.is_empty() {
        put("children", entry.children.iter().map(write_entry).collect());
    }
    keep_unknown(&mut map, &entry.extra);
    Value::Object(map)
}

/// 모르는 키를 되돌려 적는다. **아는 키가 이긴다** — 손으로 지은 `extra`에 `root` 같은 아는 이름이
/// 들어 있어도 모델의 값을 덮지 않는다.
fn keep_unknown(map: &mut Map<String, Value>, extra: &Map<String, Value>) {
    for (key, value) in extra {
        map.entry(key.clone()).or_insert_with(|| value.clone());
    }
}

/// 항목 하나를 읽고 검증한다. 아는 키를 떼어 내고 남은 것이 모르는 키다(`extra`).
///
/// 오류는 문서 순서로 쌓인다 — 이 항목의 것이 먼저, 자식들의 것이 그 뒤다. 경로가 비었으면 맨 위
/// 항목이다.
fn read_entry(
    mut map: Map<String, Value>,
    path: &mut Vec<usize>,
    errors: &mut Vec<LayoutError>,
) -> LayoutEntry {
    let mut text = |key: &str| take_text(&mut map, key, path, errors);
    let pattern = text("pattern");
    let kind = text("kind");
    let description = text("description").ok().flatten().unwrap_or_default();
    let icon = text("icon").ok().flatten();
    let template = text("template").ok().flatten();
    let mut refuse = |message: String| errors.push(LayoutError::at(path, message));

    let top = path.is_empty();
    let kind = if top {
        // 맨 위 항목은 spec 폴더 자신이다 — 이름은 work가 정하고, 늘 폴더다
        for (key, given) in [("pattern", &pattern), ("kind", &kind)] {
            if matches!(given, Ok(Some(_))) {
                refuse(format!("the top entry takes no `{key}`: it is the spec folder itself"));
            }
        }
        None
    } else {
        match &pattern {
            Ok(None) => refuse("`pattern` is missing".to_string()),
            Ok(Some(pattern)) => {
                if let Err(message) = pieces(pattern) {
                    refuse(message);
                }
            }
            Err(Mistyped) => {}
        }
        // `kind`는 글자로 받아 여기서 가른다 — 오타도 제 항목의 위치를 갖는다
        match kind {
            Ok(None) => {
                refuse("`kind` is missing (\"file\" or \"folder\")".to_string());
                None
            }
            Ok(Some(kind)) => match kind.as_str() {
                "file" => Some(EntryKind::File),
                "folder" => Some(EntryKind::Folder),
                _ => {
                    refuse(format!("`kind` must be \"file\" or \"folder\", not {kind:?}"));
                    None
                }
            },
            Err(Mistyped) => None,
        }
    };

    let has_children = matches!(map.get("children"), Some(Value::Array(items)) if !items.is_empty());
    if kind == Some(EntryKind::File) && has_children {
        refuse("a file entry takes no `children`".to_string());
    }
    if let Some(template) = &template {
        // 종류를 못 읽은 항목에는 이 둘을 따지지 않는다 — 종류 오류 하나로 충분하다
        if top || kind == Some(EntryKind::Folder) {
            refuse("a folder entry takes no `template`; only files have templates".to_string());
        } else if kind.is_some() && crate::works::safe_rel(template).is_err() {
            refuse(format!("`template` must be a path inside the layout folder, not {template:?}"));
        } else if kind.is_some() && template == LAYOUT_FILE {
            // 레이아웃 파일 자신을 템플릿으로 삼으면 저장이 그 본문으로 레이아웃을 덮고, 빠진
            // 템플릿을 지울 때 레이아웃 파일을 지운다
            refuse(format!("`template` must not be the layout file {LAYOUT_FILE:?} itself"));
        }
    }

    let mut children = Vec::new();
    match map.remove("children") {
        None | Some(Value::Null) => {}
        Some(Value::Array(items)) => {
            // 형제 사이에 같은 틀이 둘이면 뒤의 것이 오류다. 종류는 가리지 않는다 — 파일
            // `notes`와 폴더 `notes`를 둘 다 두면 에이전트가 받는 목록에 같은 이름이 두 번 선다.
            let mut seen = std::collections::BTreeSet::new();
            for (i, item) in items.into_iter().enumerate() {
                path.push(i);
                match item {
                    Value::Object(child) => {
                        if let Some(Value::String(pattern)) = child.get("pattern") {
                            if !pattern.is_empty() && !seen.insert(pattern.clone()) {
                                errors.push(LayoutError::at(
                                    path,
                                    format!("{pattern:?} repeats the pattern of an earlier sibling"),
                                ));
                            }
                        }
                        children.push(read_entry(child, path, errors));
                    }
                    _ => errors.push(LayoutError::at(path, "an entry must be a JSON object")),
                }
                path.pop();
            }
        }
        Some(_) => errors.push(LayoutError::at(path, "`children` must be an array")),
    }

    let pattern = pattern.ok().flatten();
    LayoutEntry { pattern, kind, description, icon, template, children, extra: map }
}

/// 타입이 틀린 필드 — 오류는 이미 쌓였다. 「없음」과 갈라야 「없다」는 오류가 겹쳐 서지 않는다.
struct Mistyped;

/// 글자 필드 하나를 떼어 낸다. `null`은 없음과 같다 — 손으로 적는 파일에서 「비워 둠」의 흔한 모양이다.
fn take_text(
    map: &mut Map<String, Value>,
    key: &str,
    path: &[usize],
    errors: &mut Vec<LayoutError>,
) -> Result<Option<String>, Mistyped> {
    match map.remove(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text)),
        Some(_) => {
            errors.push(LayoutError::at(path, format!("`{key}` must be a string")));
            Err(Mistyped)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::model::{EntryKind, LayoutEntry};

    fn file(pattern: &str, icon: Option<&str>, description: &str) -> LayoutEntry {
        LayoutEntry {
            pattern: Some(pattern.to_string()),
            kind: Some(EntryKind::File),
            description: description.to_string(),
            icon: icon.map(str::to_string),
            ..LayoutEntry::default()
        }
    }

    fn folder(pattern: &str, icon: &str, description: &str, children: Vec<LayoutEntry>) -> LayoutEntry {
        LayoutEntry {
            pattern: Some(pattern.to_string()),
            kind: Some(EntryKind::Folder),
            description: description.to_string(),
            icon: Some(icon.to_string()),
            children,
            ..LayoutEntry::default()
        }
    }

    /// 구현 스펙 1절 「디스크 형식」의 예시 그대로 — 사용자가 내장 `atelier`를 고쳐 `decisions.md`와
    /// 그 템플릿을 더한 모양이다.
    const SPEC_EXAMPLE: &str = r#"{
      "root": {
        "description": "Nothing else is fixed.",
        "children": [
          { "pattern": "overview.md", "kind": "file", "icon": "compass",
            "description": "the work's standing summary; write this first" },
          { "pattern": "decisions.md", "kind": "file", "icon": "scale",
            "description": "decisions and the reasons behind them",
            "template": "decisions.md" },
          { "pattern": "{n}-{name}", "kind": "folder", "icon": "layers",
            "description": "one iteration",
            "children": [
              { "pattern": "tickets", "kind": "folder", "icon": "list-checks",
                "description": "that iteration's tickets" } ] },
          { "pattern": "research", "kind": "folder", "icon": "search", "description": "findings" }
        ]
      }
    }"#;

    #[test]
    fn the_spec_example_reads_into_the_model() {
        let mut decisions =
            file("decisions.md", Some("scale"), "decisions and the reasons behind them");
        decisions.template = Some("decisions.md".to_string());
        let expected = SpecLayout {
            root: LayoutEntry {
                description: "Nothing else is fixed.".to_string(),
                children: vec![
                    file(
                        "overview.md",
                        Some("compass"),
                        "the work's standing summary; write this first",
                    ),
                    decisions,
                    folder(
                        "{n}-{name}",
                        "layers",
                        "one iteration",
                        vec![folder("tickets", "list-checks", "that iteration's tickets", vec![])],
                    ),
                    folder("research", "search", "findings", vec![]),
                ],
                ..LayoutEntry::default()
            },
            ..SpecLayout::default()
        };
        assert_eq!(parse_layout(SPEC_EXAMPLE), Ok(expected));
    }

    /// 모르는 키는 **모든 층에서** 읽을 때 버리지 않고 쓸 때 되돌려 적는다 — 설정의
    /// `unknown_fields_survive_a_roundtrip`과 같은 규칙이다. 나중 판의 최상위 키(`extends`)를 이번
    /// 판이 지우지 않고, 손으로 적어 둔 항목의 줄도 산다.
    ///
    /// **바이트가 아니라 키가 있는지를 본다.** 키 순서는 약속하지 않는다 — `preserve_order`는 앱만
    /// 켜므로, 이 크레이트만 테스트하면 키가 알파벳순이 되고 워크스페이스를 함께 테스트하면 적은
    /// 순서가 된다. 바이트를 견주면 한쪽에서만 초록이다.
    #[test]
    fn unknown_keys_survive_a_roundtrip_on_every_level() {
        let src = r#"{
          "extends": "atelier",
          "root": {
            "note": { "why": "hand-written" },
            "children": [
              { "pattern": "a.md", "kind": "file", "color": "red" },
              { "pattern": "docs", "kind": "folder",
                "children": [ { "pattern": "b.md", "kind": "file", "weight": 3 } ] }
            ]
          }
        }"#;
        let layout = parse_layout(src).unwrap();
        let out = serialize_layout(&layout);
        for key in ["\"extends\"", "\"note\"", "\"why\"", "\"color\"", "\"weight\""] {
            assert!(out.contains(key), "모르는 키 {key}가 사라졌다: {out}");
        }
        assert_eq!(parse_layout(&out), Ok(layout), "다시 읽으면 같은 레이아웃이어야 한다: {out}");
    }

    /// 맨 위 항목의 자식들만 적어 레이아웃 본문을 만든다.
    fn with_children(children: &str) -> String {
        format!(r#"{{ "root": {{ "children": [{children}] }} }}"#)
    }

    /// 구현 스펙 1절 「검증 오류」의 경우마다 하나씩. 각 경우가 **제 항목의 위치와 함께** 거절된다 —
    /// 설정 페이지가 그 항목을 가리키고, 물러선 안내문이 그 위치를 적는다. 위치가 틀리면 사용자는
    /// 멀쩡한 항목을 고치러 간다.
    ///
    /// 표의 셋째 칸은 메시지가 담아야 할 구절이다 — 무엇이 틀렸는지 말하는지만 본다.
    #[test]
    fn every_validation_error_is_refused_at_its_entry() {
        let docs = r#"{ "pattern": "docs", "kind": "folder", "children": [ ENTRY ] }"#;
        let nested = |entry: &str| with_children(&format!("{{ \"pattern\": \"a.md\", \"kind\": \"file\" }}, {}", docs.replace("ENTRY", entry)));
        let cases: Vec<(&str, String, Option<Vec<usize>>, &str)> = vec![
            ("JSON 문법", r#"{ "root": { "children": [ "#.to_string(), None, "not valid JSON"),
            ("맨 위가 객체가 아님", "[]".to_string(), None, "object"),
            ("`root` 없음", r#"{ "layout": {} }"#.to_string(), None, "`root`"),
            ("`kind` 없음", with_children(r#"{ "pattern": "a.md" }"#), Some(vec![0]), "`kind`"),
            // `kind`는 문자열로 받아 따로 검사한다 — 깊은 자리의 오타도 위치가 정확해야 한다
            ("`kind` 오타", nested(r#"{ "pattern": "b.md", "kind": "fil" }"#), Some(vec![1, 0]), "\"fil\""),
            ("`kind`가 글자가 아님", nested(r#"{ "pattern": "b.md", "kind": 3 }"#), Some(vec![1, 0]), "`kind`"),
            ("`pattern` 없음", with_children(r#"{ "kind": "file" }"#), Some(vec![0]), "`pattern`"),
            ("빈 `pattern`", nested(r#"{ "pattern": "", "kind": "file" }"#), Some(vec![1, 0]), "empty"),
            ("`/`가 든 `pattern`", with_children(r#"{ "pattern": "a/b.md", "kind": "file" }"#), Some(vec![0]), "`/`"),
            ("모르는 자리 표시자", nested(r#"{ "pattern": "{x}.md", "kind": "file" }"#), Some(vec![1, 0]), "`{x}`"),
            ("같은 자리 표시자 두 번", with_children(r#"{ "pattern": "{n}-{n}", "kind": "folder" }"#), Some(vec![0]), "`{n}`"),
            ("사이 없이 붙은 틀", with_children(r#"{ "pattern": "{n}{name}", "kind": "folder" }"#), Some(vec![0]), "`{n}{name}`"),
            ("거꾸로 붙은 틀", with_children(r#"{ "pattern": "{name}{n}.md", "kind": "file" }"#), Some(vec![0]), "`{name}{n}`"),
            // 종류는 가리지 않는다 — 파일 `notes`와 폴더 `notes`도 같은 틀이다
            (
                "형제 사이의 같은 틀",
                nested(r#"{ "pattern": "notes", "kind": "file" }, { "pattern": "notes", "kind": "folder" }"#),
                Some(vec![1, 1]),
                "notes",
            ),
            (
                "파일 항목의 `children`",
                with_children(r#"{ "pattern": "a.md", "kind": "file", "children": [ { "pattern": "b.md", "kind": "file" } ] }"#),
                Some(vec![0]),
                "`children`",
            ),
            ("폴더 항목의 `template`", nested(r#"{ "pattern": "t", "kind": "folder", "template": "t.md" }"#), Some(vec![1, 0]), "`template`"),
            ("폴더 밖을 가리키는 템플릿", with_children(r#"{ "pattern": "a.md", "kind": "file", "template": "../a.md" }"#), Some(vec![0]), "../a.md"),
            ("절대 경로 템플릿", nested(r#"{ "pattern": "b.md", "kind": "file", "template": "/etc/b.md" }"#), Some(vec![1, 0]), "/etc/b.md"),
            // 레이아웃 파일 자신은 템플릿이 아니다 — 저장이 그 본문으로 레이아웃을 덮고, 빠진 템플릿을
            // 지울 때 레이아웃 파일을 지운다
            ("레이아웃 파일을 가리키는 템플릿", nested(r#"{ "pattern": "b.md", "kind": "file", "template": "layout.json" }"#), Some(vec![1, 0]), "layout.json"),
            // 맨 위 항목은 spec 폴더 자신이다 — 이름 틀도 종류도 없다
            ("맨 위 항목의 `pattern`", r#"{ "root": { "pattern": "spec" } }"#.to_string(), Some(vec![]), "`pattern`"),
            ("맨 위 항목의 `kind`", r#"{ "root": { "kind": "folder" } }"#.to_string(), Some(vec![]), "`kind`"),
            ("맨 위 항목의 `template`", r#"{ "root": { "template": "a.md" } }"#.to_string(), Some(vec![]), "`template`"),
            ("글자가 아닌 설명", nested(r#"{ "pattern": "b.md", "kind": "file", "description": 3 }"#), Some(vec![1, 0]), "`description`"),
            ("객체가 아닌 항목", with_children(r#""a.md""#), Some(vec![0]), "object"),
        ];
        for (case, text, path, phrase) in cases {
            let errors = parse_layout(&text).expect_err(case);
            assert_eq!(errors.len(), 1, "{case}: 오류 하나여야 한다: {errors:?}");
            assert_eq!(errors[0].path, path, "{case}: 위치가 틀렸다: {errors:?}");
            assert!(errors[0].message.contains(phrase), "{case}: {phrase:?}가 없다: {errors:?}");
        }
    }

    /// 오류는 첫 것에서 멈추지 않고 **전부** 모인다 — 문서 순서(깊이 우선)다. 하나 고치고 다시
    /// 저장해야 다음 오류가 보이면, 사용자는 저장을 오류 수만큼 되풀이한다.
    #[test]
    fn every_error_in_the_layout_is_listed_in_document_order() {
        let text = with_children(
            r#"{ "pattern": "a/b", "kind": "file" },
               { "pattern": "docs", "kind": "folder", "children": [ { "pattern": "c.md", "kind": "fil" } ] },
               { "pattern": "{x}", "kind": "folder" }"#,
        );
        let paths: Vec<_> =
            parse_layout(&text).unwrap_err().into_iter().map(|e| e.path).collect();
        assert_eq!(paths, [Some(vec![0]), Some(vec![1, 0]), Some(vec![2])]);
    }

    /// 앞 항목에 가려 결코 맞지 않는 항목(`{name}.md` 뒤의 `decisions.md`)은 **오류가 아니다** —
    /// 나열 순서가 이긴다(구현 스펙 1절). 틀이 다르므로 형제 사이의 같은 틀도 아니다.
    #[test]
    fn an_entry_shadowed_by_an_earlier_sibling_is_not_an_error() {
        let text = with_children(
            r#"{ "pattern": "{name}.md", "kind": "file" },
               { "pattern": "decisions.md", "kind": "file" }"#,
        );
        let layout = parse_layout(&text).unwrap();
        assert_eq!(layout.root.children.len(), 2);
    }

    /// 아는 필드도 왕복에서 그대로다 — 쓴 것을 다시 읽으면 같은 레이아웃이다.
    #[test]
    fn what_is_written_reads_back_as_the_same_layout() {
        let layout = parse_layout(SPEC_EXAMPLE).unwrap();
        assert_eq!(parse_layout(&serialize_layout(&layout)), Ok(layout));
    }
}
