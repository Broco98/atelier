//! classify — spec 파일 목록을 레이아웃의 자리로 갈라, 앱이 그대로 그릴 spec 트리를 만든다.
//!
//! **앱에는 규칙이 없다**(결정 13). 무엇이 어느 자리에 맞는지, 한 층을 어떤 순서로 세우는지, 어느
//! 것이 최신인지, 무엇을 먼저 열지를 모두 여기서 정한다. 앱은 받은 순서 그대로 그린다 — 번호로
//! 다시 세지도 않는다. 규칙은 구현 스펙 1절 「spec 트리(classify의 결과)」다.
//!
//! - 경로로 트리를 세운 뒤 층마다 그 층의 항목들과 맞춘다. 최상위 층은 맨 위 항목의 자식들과
//!   맞춘다. 종류와 이름이 모두 맞아야 하고, 여럿이 맞으면 나열 순서상 앞의 항목이 이긴다.
//! - 맞은 것은 항목의 아이콘을 받고, 폴더이면 그 항목의 자식들로 한 층 더 내려간다.
//! - **맞지 않은 것은 그대로 남는다.** 아이콘이 없고, 그 아래는 분류하지 않는다 — 레이아웃은
//!   이름이 아니라 자리를 본다(결정 18의 허용 차이가 여기서 나온다).
//! - 이름 맞추기는 이름 틀 모듈(`pattern.rs`)이 한다. 검증이 읽은 틀을 매처가 다르게 읽지 않는다.

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use super::model::{EntryKind, LayoutEntry};
use super::pattern::{is_fixed, match_name};
use super::resolve::Resolved;
use crate::Mode;

/// spec 트리 — 앱이 순서도 바꾸지 않고 그대로 그리는 것. 앱 쪽 JSON으로 나가고 L3 fixture가 손으로
/// 적으므로 **필드 이름(camelCase)이 약속이다.** TS의 타입 이름도 같다.
///
/// 식별자에 `Node`·`Entry`를 쓰지 않는다 — `Node`는 피할 말(결정 12)이고, `Entry`는 레이아웃의
/// 항목(`LayoutEntry`)과 헷갈린다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecTree {
    /// 이 트리를 가른 레이아웃의 id(`"atelier"` | `"maison"`)
    pub layout_id: Mode,
    /// 모드의 폴더를 못 써서 내장본으로 물러섰다면 그 까닭
    pub fallback: Option<String>,
    /// 처음 열 문서. spec 기준 경로다. 파일이 하나도 없으면 없다.
    pub default_doc: Option<String>,
    /// 최상위 층. 그리는 순서 그대로다.
    pub items: Vec<SpecTreeItem>,
}

/// 트리의 파일·폴더 하나.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecTreeItem {
    /// 입력에 적힌 이름 그대로 — NFC로 바꾸지 않는다. 앱은 `path`로 문서를 연다.
    pub name: String,
    /// spec 기준 경로
    pub path: String,
    pub kind: EntryKind,
    /// 맞은 항목의 아이콘. 맞지 않았거나 항목에 아이콘이 없으면 없다.
    pub icon: Option<String>,
    /// `{n}` 항목에 맞았으면 그 번호 묶음
    pub group: Option<SpecTreeGroup>,
    /// 폴더 안의 층. 그리는 순서 그대로다. 파일이면 비어 있다.
    pub children: Vec<SpecTreeItem>,
}

/// 번호 묶음 소속 — `{n}` 항목 하나가 폴더 하나 안에서 맞은 것들의 모임이다. 판 폴더 안의 `{n}`
/// 항목은 판 폴더마다 따로 묶음이 선다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecTreeGroup {
    /// 같은 묶음이면 같고 다른 묶음이면 다르다. 글자 모양은 약속이 아니다.
    pub key: String,
    /// `{n}`의 값. 앱은 이것으로 계산하지 않는다 — 순서는 이미 섰다.
    pub n: u64,
    /// 묶음의 맨 앞(최신) 하나에만 붙는다. 앱은 그것만 기본으로 펼친다.
    pub latest: bool,
}

/// spec 상대 파일 경로 목록을 풀린 레이아웃으로 가른다. 입력은 커널이 주는 목록(파일만)이고,
/// **그 순서에 기대지 않는다.**
///
/// 각 층의 순서는 그리는 순서다. (1) 항목의 나열 순서, (2) 같은 항목에 맞은 것끼리는 번호
/// 내림차순(최신이 앞), 번호가 같거나 없으면 이름의 코드포인트순, (3) 맞지 않은 것은 맨 뒤에 이름의
/// 코드포인트순 — 이때 폴더는 이름 뒤에 `/`를 붙여 견준다. 그래야 커널이 준 경로 순서와 같다.
///
/// 기본 문서는 레이아웃을 깊이 우선으로 훑어 처음 만나는, 실제로 있는 파일 항목이다. 후보는 맨
/// 위 항목에서 그 항목까지 모두 고정 이름인 파일 항목뿐이다. 후보가 없으면 입력을 코드포인트순으로
/// 정렬한 첫 파일이다. 내장본에서는 「있으면 `overview.md`, 없으면 첫 파일」이 된다(결정 14).
pub fn classify<S: AsRef<str>>(resolved: &Resolved, files: &[S]) -> SpecTree {
    let paths: Vec<String> = files.iter().filter_map(|file| clean(file.as_ref())).collect();
    let mut first = None;
    let items = level(&Raw::of(&paths), &resolved.layout.root.children, "", Some(&[]), &mut first);
    let default_doc =
        first.map(|candidate: Candidate| candidate.path).or_else(|| paths.iter().min().cloned());
    let fallback = resolved.fallback.as_ref().map(|fallback| fallback.reason.clone());
    SpecTree { layout_id: resolved.id, fallback, default_doc, items }
}

/// 경로를 조각으로 다시 잇는다 — 빈 조각(`a//b`, 앞뒤의 `/`)은 버린다. 조각이 없으면 없음이다.
fn clean(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// 경로로 세운 날것의 트리 — 폴더 하나 안의 파일 이름과 폴더.
#[derive(Default)]
struct Raw<'a> {
    files: BTreeSet<&'a str>,
    folders: BTreeMap<&'a str, Raw<'a>>,
}

impl<'a> Raw<'a> {
    fn of(paths: &'a [String]) -> Self {
        let mut top = Raw::default();
        for path in paths {
            let mut parts: Vec<&str> = path.split('/').collect();
            let Some(name) = parts.pop() else { continue };
            let mut here = &mut top;
            for part in parts {
                here = here.folders.entry(part).or_default();
            }
            here.files.insert(name);
        }
        top
    }
}

/// 한 층의 자리. 파생된 순서가 곧 그리는 순서다 — 맞은 것이 먼저, 항목의 나열 순서로 선다.
/// 같은 항목에 맞은 것끼리는 번호 내림차순(최신이 앞), 번호가 같거나 없으면 이름의 코드포인트순이다.
/// 맞지 않은 것은 맨 뒤에 이름의 코드포인트순이다.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum Place {
    Matched { entry: usize, newest: Reverse<Option<u64>>, name: String },
    Stray { name: String },
}

/// 기본 문서 후보 — 고정 이름만 지나 닿은 파일 항목에 맞은 파일. `at`은 맨 위 항목에서 그 항목까지의
/// 인덱스 경로라, 파생된 순서가 곧 레이아웃을 깊이 우선으로 훑는 순서다.
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct Candidate {
    at: Vec<usize>,
    path: String,
}

/// 폴더 하나 안의 파일·폴더를 `entries`와 맞춰 그릴 순서로 세운다.
///
/// `fixed`는 맨 위 항목에서 이 층까지 고정 이름만 지나왔을 때 그 인덱스 경로다. 그 길의 파일
/// 항목에 맞은 파일이 기본 문서 후보가 되고, 가장 앞선 것이 `first`에 남는다.
fn level(
    raw: &Raw<'_>,
    entries: &[LayoutEntry],
    parent: &str,
    fixed: Option<&[usize]>,
    first: &mut Option<Candidate>,
) -> Vec<SpecTreeItem> {
    let mut placed: Vec<(Place, SpecTreeItem)> = Vec::new();
    let kinds = raw
        .files
        .iter()
        .map(|name| (*name, EntryKind::File, None))
        .chain(raw.folders.iter().map(|(name, inner)| (*name, EntryKind::Folder, Some(inner))));
    for (name, kind, inner) in kinds {
        let path = if parent.is_empty() { name.to_string() } else { format!("{parent}/{name}") };
        let matched = entries.iter().enumerate().find_map(|(i, entry)| {
            let pattern = entry.pattern.as_deref().filter(|_| entry.kind == Some(kind))?;
            match_name(pattern, name).map(|m| (i, entry, pattern, m.n))
        });
        let (place, icon, group, below, chain) = match matched {
            Some((i, entry, pattern, n)) => (
                Place::Matched { entry: i, newest: Reverse(n), name: name.to_string() },
                entry.icon.clone(),
                n.map(|n| SpecTreeGroup { key: group_key(parent, pattern), n, latest: false }),
                entry.children.as_slice(),
                fixed.filter(|_| is_fixed(pattern)).map(|at| [at, &[i]].concat()),
            ),
            // 폴더는 `/`를 붙여 견준다 — 커널이 준 경로 순서(`notes-old.md` → `notes/a.md`)와 같다
            None => {
                let slash = if kind == EntryKind::Folder { "/" } else { "" };
                (Place::Stray { name: format!("{name}{slash}") }, None, None, &[][..], None)
            }
        };
        let children = match inner {
            Some(inner) => level(inner, below, &path, chain.as_deref(), first),
            None => {
                if let Some(at) = chain {
                    let candidate = Candidate { at, path: path.clone() };
                    if first.as_ref().is_none_or(|best| candidate < *best) {
                        *first = Some(candidate);
                    }
                }
                Vec::new()
            }
        };
        let item = SpecTreeItem { name: name.to_string(), path, kind, icon, group, children };
        placed.push((place, item));
    }
    placed.sort_by(|a, b| a.0.cmp(&b.0));
    let mut items: Vec<SpecTreeItem> = placed.into_iter().map(|(_, item)| item).collect();
    // 한 묶음은 한 층 안에 붙어 서고 최신이 맨 앞이다 — 키가 처음 나온 자리가 최신이다
    let mut seen = BTreeSet::new();
    for group in items.iter_mut().filter_map(|item| item.group.as_mut()) {
        group.latest = seen.insert(group.key.clone());
    }
    items
}

/// 번호 묶음의 키 — 폴더의 경로와 `{n}` 항목의 틀이다. 형제 사이에 같은 틀은 둘일 수 없으니(검증)
/// 폴더 하나 안의 항목 하나가 키 하나다. 틀에는 `/`가 없어서 두 부분이 섞여 읽히지 않는다.
fn group_key(parent: &str, pattern: &str) -> String {
    if parent.is_empty() {
        pattern.to_string()
    } else {
        format!("{parent}/{pattern}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::builtin::builtin_layout;
    use crate::layout::model::{LayoutEntry, SpecLayout};
    use crate::layout::render::Fallback;
    use crate::layout::resolve::LayoutSource;

    fn file(pattern: &str, icon: &str) -> LayoutEntry {
        LayoutEntry {
            pattern: Some(pattern.to_string()),
            kind: Some(EntryKind::File),
            icon: Some(icon.to_string()),
            ..LayoutEntry::default()
        }
    }

    fn folder(pattern: &str, icon: &str, children: Vec<LayoutEntry>) -> LayoutEntry {
        LayoutEntry {
            pattern: Some(pattern.to_string()),
            kind: Some(EntryKind::Folder),
            icon: Some(icon.to_string()),
            children,
            ..LayoutEntry::default()
        }
    }

    /// 손으로 지은 레이아웃을 풀린 모양으로 싼다 — classify는 풀린 레이아웃을 받는다.
    fn resolved(children: Vec<LayoutEntry>) -> Resolved {
        Resolved {
            id: Mode::Atelier,
            layout: SpecLayout {
                root: LayoutEntry { children, ..LayoutEntry::default() },
                ..SpecLayout::default()
            },
            source: LayoutSource::Builtin,
            templates: None,
            fallback: None,
        }
    }

    fn tree(children: Vec<LayoutEntry>, files: &[&str]) -> SpecTree {
        classify(&resolved(children), files)
    }

    /// 트리를 한 줄에 하나씩 편다 — 깊이마다 두 칸, 이름(폴더는 끝에 `/`), 아이콘 `(…)`, 번호 묶음
    /// `[묶음 번호]`(최신이면 `latest`까지). 기대값을 사람이 한눈에 읽고 손으로 적게 하려는 모양이다.
    ///
    /// 묶음은 키 대신 처음 나온 차례의 이름(`g1`, `g2` …)으로 적는다 — 키의 글자 모양은 구현이
    /// 정한다. 약속은 「같은 묶음이면 같고 다른 묶음이면 다르다」뿐이고, 이 이름이 그것만 싣는다.
    ///
    /// 경로는 줄에 적지 않는 대신 여기서 모두 잰다 — 늘 부모의 경로 + `/` + 이름이다. 파일에는
    /// 자식이 없다.
    fn outline(tree: &SpecTree) -> Vec<String> {
        fn walk(
            items: &[SpecTreeItem],
            parent: &str,
            depth: usize,
            groups: &mut Vec<String>,
            out: &mut Vec<String>,
        ) {
            for item in items {
                let path =
                    if parent.is_empty() { item.name.clone() } else { format!("{parent}/{}", item.name) };
                assert_eq!(item.path, path, "{}의 경로가 부모에서 이어지지 않는다", item.name);
                let mut line = format!("{}{}", "  ".repeat(depth), item.name);
                if item.kind == EntryKind::Folder {
                    line.push('/');
                } else {
                    assert!(item.children.is_empty(), "파일 {path}에 자식이 있다");
                }
                if let Some(icon) = &item.icon {
                    line.push_str(&format!(" ({icon})"));
                }
                if let Some(group) = &item.group {
                    let label = match groups.iter().position(|key| *key == group.key) {
                        Some(i) => i + 1,
                        None => {
                            groups.push(group.key.clone());
                            groups.len()
                        }
                    };
                    let latest = if group.latest { " latest" } else { "" };
                    line.push_str(&format!(" [g{label} {}{latest}]", group.n));
                }
                out.push(line);
                walk(&item.children, &item.path, depth + 1, groups, out);
            }
        }
        let mut out = Vec::new();
        walk(&tree.items, "", 0, &mut Vec::new(), &mut out);
        out
    }

    /// 한 층의 이름만 순서대로.
    fn names(items: &[SpecTreeItem]) -> Vec<&str> {
        items.iter().map(|item| item.name.as_str()).collect()
    }

    /// 최상위 층은 맨 위 항목의 자식과 맞춘다. 맞은 것은 항목의 아이콘을 받고 항목의 나열 순서로
    /// 서며, 맞지 않은 것은 아이콘 없이 맨 뒤에 선다. 맞은 폴더 안이라도 항목이 없는 자리는 맞지
    /// 않은 것이다.
    ///
    /// 이름은 대소문자를 가려 견준다 — `Overview.md`·`Research/`는 `overview.md`·`research` 항목의
    /// 자리를 받지 못하고 맞지 않은 것으로 남는다.
    #[test]
    fn fixed_names_take_their_icon_in_layout_order_and_the_rest_trails() {
        let layout = vec![file("overview.md", "compass"), folder("research", "search", vec![])];
        let files =
            ["zeta.md", "research/a.md", "overview.md", "alpha/b.md", "Overview.md", "Research/c.md"];
        assert_eq!(
            outline(&tree(layout, &files)),
            [
                "overview.md (compass)",
                "research/ (search)",
                "  a.md",
                "Overview.md",
                "Research/",
                "  c.md",
                "alpha/",
                "  b.md",
                "zeta.md",
            ]
        );
    }

    /// 맞지 않은 것은 층의 맨 뒤에 이름의 코드포인트순으로 선다. 폴더는 이름 뒤에 `/`를 붙여
    /// 견준다 — 그래서 `notes-old.md`가 `notes/`보다 앞이다(`-`가 `/`보다 앞). 커널이 준 경로
    /// 순서와 같다.
    ///
    /// 그 아래는 분류하지 않는다. 맞지 않은 폴더 안의 `overview.md`·`research/`는 레이아웃의 이름과
    /// 같아도 아이콘이 없다 — 레이아웃은 이름이 아니라 자리를 본다.
    #[test]
    fn what_fits_no_entry_trails_in_code_point_order_and_stays_unclassified_below() {
        let layout = vec![file("overview.md", "compass"), folder("research", "search", vec![])];
        let files = [
            "notes/a.md",
            "잡동사니/메모.md",
            "notes-old.md",
            "misc/research/x.md",
            "misc/research-old.md",
            "misc/overview.md",
            "Zeta.md",
        ];
        assert_eq!(
            outline(&tree(layout, &files)),
            [
                "Zeta.md",
                "misc/",
                "  overview.md",
                "  research-old.md",
                "  research/",
                "    x.md",
                "notes-old.md",
                "notes/",
                "  a.md",
                "잡동사니/",
                "  메모.md",
            ]
        );
    }

    /// 번호는 **숫자로** 센다 — 글자로 견주면 `100-`이 `02-`보다 뒤에 선다. 최신(큰 번호)이 앞이다.
    ///
    /// `{n}`은 ASCII 숫자 하나 이상이고 64비트 정수에 들어야 한다. 넘치면 맞지 않는다(가장 큰 값은
    /// 맞는다). `{name}`은 비어 있으면 안 되므로 `01-`은 판이 아니다. 다른 글자의 숫자(`٣`)도
    /// 숫자로 치지 않는다.
    #[test]
    fn numbers_count_as_numbers_newest_first_and_an_overflow_fits_nothing() {
        let layout = vec![folder("{n}-{name}", "layers", vec![])];
        let files = [
            "02-b/x.md",
            "1-a/x.md",
            "100-c/x.md",
            "01-/x.md",
            "99999999999999999999-big/x.md",
            "18446744073709551615-max/x.md",
            "x-01/x.md",
            "\u{663}-arabic/x.md",
        ];
        let tree = tree(layout, &files);
        assert_eq!(
            names(&tree.items),
            [
                "18446744073709551615-max",
                "100-c",
                "02-b",
                "1-a",
                "01-",
                "99999999999999999999-big",
                "x-01",
                "\u{663}-arabic",
            ]
        );
        let icons: Vec<Option<&str>> = tree.items.iter().map(|item| item.icon.as_deref()).collect();
        assert_eq!(
            icons,
            [Some("layers"), Some("layers"), Some("layers"), Some("layers"), None, None, None, None]
        );
    }

    /// 셋째 층까지 — 폴더 항목 안 폴더 항목 안의 파일 항목도 맞고 아이콘을 받는다. 항목은 제
    /// 자리에서만 맞는다. `docs/index.md`는 셋째 층의 `index.md`와 이름이 같아도 그 자리가 아니다.
    #[test]
    fn an_entry_three_levels_down_still_fits_and_gives_its_icon() {
        let layout = vec![folder(
            "docs",
            "book",
            vec![folder("guides", "map", vec![file("index.md", "house")])],
        )];
        let files = ["docs/index.md", "docs/guides/other.md", "docs/guides/index.md"];
        assert_eq!(
            outline(&tree(layout, &files)),
            [
                "docs/ (book)",
                "  guides/ (map)",
                "    index.md (house)",
                "    other.md",
                "  index.md",
            ]
        );
    }

    /// 번호 묶음은 `{n}` 항목 하나가 **폴더 하나 안에서** 맞은 것들의 모임이다. 판 폴더와 파일 묶음
    /// (`adr-{n}-{name}.md`)이 한 층에 있으면 둘은 따로 선다. 판 폴더 안의 `{n}` 항목은 판 폴더마다
    /// 따로 묶음이 선다. 묶음마다 맨 앞(최신) 하나에만 표시가 붙는다.
    #[test]
    fn each_number_group_stands_alone_with_only_its_newest_marked() {
        let layout = vec![
            folder(
                "{n}-{name}",
                "layers",
                vec![folder("tickets", "list-checks", vec![]), file("{n}-{name}.md", "ticket")],
            ),
            file("adr-{n}-{name}.md", "scale"),
        ];
        let files = [
            "01-a/01-x.md",
            "adr-1-first.md",
            "01-a/tickets/t.md",
            "02-b/01-z.md",
            "adr-3-third.md",
            "01-a/02-y.md",
            "03-c/plan.md",
            "adr-2-second.md",
        ];
        assert_eq!(
            outline(&tree(layout, &files)),
            [
                "03-c/ (layers) [g1 3 latest]",
                "  plan.md",
                "02-b/ (layers) [g1 2]",
                "  01-z.md (ticket) [g2 1 latest]",
                "01-a/ (layers) [g1 1]",
                "  tickets/ (list-checks)",
                "    t.md",
                "  02-y.md (ticket) [g3 2 latest]",
                "  01-x.md (ticket) [g3 1]",
                "adr-3-third.md (scale) [g4 3 latest]",
                "adr-2-second.md (scale) [g4 2]",
                "adr-1-first.md (scale) [g4 1]",
            ]
        );
    }

    /// 여럿이 맞으면 나열 순서상 앞의 항목이 이긴다 — `decisions.md`는 제 항목보다 앞선
    /// `{name}.md`의 것이다. 종류가 다르면 이름이 맞아도 맞지 않는다. 파일 `research`는 폴더 항목에,
    /// 폴더 `x.md/`는 파일 항목에 맞지 않는다.
    #[test]
    fn the_earlier_entry_wins_and_a_different_kind_never_fits() {
        let layout = vec![
            folder("research", "search", vec![]),
            file("{name}.md", "file-text"),
            file("decisions.md", "scale"),
        ];
        let files = ["x.md/a.txt", "research", "decisions.md"];
        assert_eq!(
            outline(&tree(layout, &files)),
            ["decisions.md (file-text)", "research", "x.md/", "  a.txt"]
        );
    }

    /// 기본 문서는 레이아웃을 깊이 우선으로 훑어 처음 만나는, 실제로 있는 파일 항목이다. 후보는
    /// 맨 위 항목에서 그 항목까지 모든 조상이 고정 이름인 파일 항목뿐이다 — 이름 틀 파일
    /// (`adr-{n}-{name}.md`)과 이름 틀 폴더 아래의 파일(`01-a/plan.md`)은 앞에 서도 빠진다.
    ///
    /// 깊이 우선이라 `guide/` 안의 `index.md`가 뒤 형제 `overview.md`보다 먼저다. 그것이 없으면
    /// 다음 후보인 `overview.md`다.
    #[test]
    fn the_default_doc_is_the_first_present_file_reached_through_fixed_names_only() {
        let layout = || {
            vec![
                file("adr-{n}-{name}.md", "scale"),
                folder("{n}-{name}", "layers", vec![file("plan.md", "map")]),
                folder("guide", "book", vec![file("index.md", "house")]),
                file("overview.md", "compass"),
            ]
        };
        let everything = ["adr-1-x.md", "01-a/plan.md", "overview.md", "guide/index.md"];
        assert_eq!(tree(layout(), &everything).default_doc.as_deref(), Some("guide/index.md"));

        let no_guide_index = ["adr-1-x.md", "01-a/plan.md", "overview.md", "guide/other.md"];
        assert_eq!(tree(layout(), &no_guide_index).default_doc.as_deref(), Some("overview.md"));
    }

    /// 후보가 없으면 입력을 코드포인트순으로 정렬했을 때의 첫 파일이다 — 이름 틀에만 맞는 파일은
    /// 후보가 아니다. 빈 목록이면 기본 문서가 없다.
    #[test]
    fn with_no_candidate_the_default_doc_is_the_first_file_in_code_point_order() {
        let layout = || {
            vec![
                file("adr-{n}-{name}.md", "scale"),
                folder("{n}-{name}", "layers", vec![file("plan.md", "map")]),
                file("overview.md", "compass"),
            ]
        };
        let files = ["b.md", "adr-1-x.md", "a/z.md", "01-a/plan.md"];
        assert_eq!(tree(layout(), &files).default_doc.as_deref(), Some("01-a/plan.md"));

        // 폴더 안의 파일도 경로 그대로 견준다 — `-`가 `/`보다 앞이다
        let notes = ["notes/a.md", "notes-old.md"];
        assert_eq!(tree(layout(), &notes).default_doc.as_deref(), Some("notes-old.md"));

        let empty: [&str; 0] = [];
        assert_eq!(tree(layout(), &empty).default_doc, None);
    }

    /// 이름 틀과 파일 이름을 **둘 다** NFC로 맞춘 뒤 견준다 — macOS에서는 한글 이름이 NFD로
    /// 적히기도 한다. 어느 쪽이 NFD여도 맞는다. 트리의 이름과 경로는 입력에 적힌 그대로다 — 앱은
    /// 그 경로로 문서를 연다.
    #[test]
    fn a_korean_name_fits_whether_it_is_written_composed_or_decomposed() {
        const NFC: &str = "학습-계획.md";
        const NFD: &str =
            "\u{1112}\u{1161}\u{11A8}\u{1109}\u{1173}\u{11B8}-\u{1100}\u{1168}\u{1112}\u{116C}\u{11A8}.md";
        const PLAN_NFD: &str = "01-\u{1100}\u{1168}\u{1112}\u{116C}\u{11A8}";
        assert_ne!(NFC, NFD, "두 표기가 바이트로는 달라야 재는 것이 있다");

        let decomposed_file = tree(vec![file(NFC, "target")], &[NFD]);
        assert_eq!(outline(&decomposed_file), [format!("{NFD} (target)")]);
        assert_eq!(decomposed_file.items[0].path, NFD);
        assert_eq!(decomposed_file.default_doc.as_deref(), Some(NFD));

        let decomposed_pattern = tree(vec![file(NFD, "target")], &[NFC]);
        assert_eq!(outline(&decomposed_pattern), [format!("{NFC} (target)")]);

        let placeholder = tree(vec![folder("{n}-계획", "layers", vec![])], &[&format!("{PLAN_NFD}/a.md")]);
        assert_eq!(outline(&placeholder), [format!("{PLAN_NFD}/ (layers) [g1 1 latest]"), "  a.md".to_string()]);
    }

    /// 결과는 앱 쪽 JSON으로 나간다 — 필드 이름(camelCase)이 약속이다. L3 fixture가 이 모양을
    /// 손으로 적는다. 없는 값은 빠지지 않고 `null`이고, 파일의 `children`은 빈 배열이다.
    #[test]
    fn the_tree_goes_out_as_json_with_the_agreed_field_names() {
        let resolved = Resolved {
            id: Mode::Maison,
            fallback: Some(Fallback {
                folder: "~/.atelier/layouts/maison".to_string(),
                reason: "layout.json is missing".to_string(),
            }),
            ..resolved(vec![folder("{n}-{name}", "layers", vec![])])
        };
        let json = serde_json::to_value(classify(&resolved, &["01-a/x.md"])).unwrap();
        // 키의 글자 모양은 구현이 정한다 — 글자이기만 하면 된다
        let key = json["items"][0]["group"]["key"].clone();
        assert!(key.is_string(), "{json}");
        assert_eq!(
            json,
            serde_json::json!({
                "layoutId": "maison",
                "fallback": "layout.json is missing",
                "defaultDoc": "01-a/x.md",
                "items": [{
                    "name": "01-a",
                    "path": "01-a",
                    "kind": "folder",
                    "icon": "layers",
                    "group": { "key": key, "n": 1, "latest": true },
                    "children": [{
                        "name": "x.md",
                        "path": "01-a/x.md",
                        "kind": "file",
                        "icon": null,
                        "group": null,
                        "children": []
                    }]
                }]
            })
        );
    }

    /// 트리는 **쓴** 레이아웃의 id와, 물러섰다면 그 까닭을 싣는다. work 지정이 있으면 그 id이고,
    /// 그 폴더가 깨져 물러섰으면 도착한 내장본의 모드다. 물러서지 않았으면 까닭이 없다.
    #[test]
    fn the_tree_names_the_layout_it_used_and_why_it_fell_back() {
        let root = tempfile::tempdir().unwrap();
        let spec_tree = |mode, work: Option<&str>| {
            let resolved = crate::layout::resolve::resolve_layout(root.path(), mode, work).unwrap();
            classify(&resolved, &["overview.md"])
        };
        let plain = spec_tree(Mode::Maison, None);
        assert_eq!((plain.layout_id, plain.fallback), (Mode::Maison, None));
        let chosen = spec_tree(Mode::Atelier, Some("maison"));
        assert_eq!((chosen.layout_id, chosen.fallback), (Mode::Maison, None));

        let broken = root.path().join("layouts/maison");
        std::fs::create_dir_all(&broken).unwrap();
        std::fs::write(broken.join("layout.json"), "{ not json").unwrap();
        let fell_back = spec_tree(Mode::Atelier, Some("maison"));
        assert_eq!(fell_back.layout_id, Mode::Atelier);
        let reason = fell_back.fallback.expect("물러선 까닭이 없다");
        assert!(reason.contains("JSON"), "{reason}");
    }

    /// 커널 테스트(`works.rs`의 `spec_files_stay_a_flat_sorted_list_whatever_the_folder_names_are`)의
    /// 파일 목록을 옮겨 적고 경우를 더했다 — 그 목록은 커널의 비공개 인라인 테스트 안에 있어 가져다
    /// 쓸 수 없다. 더한 것: 깊은 자리의 이름(`research/x/…`, 최상위 `tickets/`), 같은 번호의 판
    /// (`01-a`·`01-b`), 이름이 빈 판(`01-`), 이름 앞부분이 겹치는 파일과 폴더(`notes-old.md`·`notes/`).
    const KERNEL_FILES: [&str; 15] = [
        "overview.md",
        "01-첫-판/plan.md",
        "01-첫-판/tickets/t1.md",
        "02-둘째-판/plan.md",
        "research/api.md",
        "explanation/why.md",
        "잡동사니/메모.md",
        "research/x/overview.md",
        "research/x/01-y/a.md",
        "tickets/a.md",
        "01-a/plan.md",
        "01-b/plan.md",
        "01-/a.md",
        "notes-old.md",
        "notes/a.md",
    ];

    /// 내장본 분류 — 기대값을 명시적으로 적었다(구현 스펙 7절).
    ///
    /// 지금 앱과 같은 것: 같은 번호의 판은 `01-a`가 위다. 기본 문서는 `overview.md`다. 맞지 않은
    /// 것은 커널이 준 경로 순서다(`notes-old.md`가 `notes/`보다 앞).
    ///
    /// 달라지는 것(허용 차이):
    /// - 4 — 깊은 자리의 이름은 아이콘을 잃는다: `research/x/overview.md`, `research/x/01-y/`,
    ///   최상위 `tickets/`.
    /// - 5 — 판 폴더 안에서 `tickets/`가 먼저 서고 나머지는 이름순이다.
    /// - 6 — `01-`은 판이 아니다.
    /// - 8 — 최상위는 한 층이다: `overview.md` → 판(최신이 앞) → `research/` → `explanation/` →
    ///   나머지. 판이 `overview.md` 아래에 선다.
    #[test]
    fn the_builtins_classify_the_kernel_files_as_the_app_draws_them() {
        for mode in [Mode::Atelier, Mode::Maison] {
            let resolved = Resolved { id: mode, layout: builtin_layout(mode), ..resolved(vec![]) };
            let tree = classify(&resolved, &KERNEL_FILES);
            assert_eq!(tree.layout_id, mode);
            assert_eq!(tree.fallback, None);
            assert_eq!(tree.default_doc.as_deref(), Some("overview.md"), "{mode}");
            assert_eq!(
                outline(&tree),
                [
                    "overview.md (compass)",
                    "02-둘째-판/ (layers) [g1 2 latest]",
                    "  plan.md",
                    "01-a/ (layers) [g1 1]",
                    "  plan.md",
                    "01-b/ (layers) [g1 1]",
                    "  plan.md",
                    "01-첫-판/ (layers) [g1 1]",
                    "  tickets/ (list-checks)",
                    "    t1.md",
                    "  plan.md",
                    "research/ (search)",
                    "  api.md",
                    "  x/",
                    "    01-y/",
                    "      a.md",
                    "    overview.md",
                    "explanation/ (book-open)",
                    "  why.md",
                    "01-/",
                    "  a.md",
                    "notes-old.md",
                    "notes/",
                    "  a.md",
                    "tickets/",
                    "  a.md",
                    "잡동사니/",
                    "  메모.md",
                ],
                "{mode}"
            );
        }
    }

    /// classify는 입력의 순서에 기대지 않는다 — 커널은 정렬해서 주지만, 아카이브의 문서 목록처럼
    /// 다른 길로 온 목록도 같은 트리가 되어야 한다.
    #[test]
    fn shuffling_the_input_changes_nothing() {
        let resolved = Resolved { layout: builtin_layout(Mode::Atelier), ..resolved(vec![]) };
        let expected = classify(&resolved, &KERNEL_FILES);
        let mut reversed = KERNEL_FILES;
        reversed.reverse();
        let mut rotated = KERNEL_FILES;
        rotated.rotate_left(6);
        // 홀수 자리 먼저, 짝수 자리 나중
        let interleaved: Vec<&str> =
            KERNEL_FILES.iter().skip(1).step_by(2).chain(KERNEL_FILES.iter().step_by(2)).copied().collect();
        for shuffled in [reversed.to_vec(), rotated.to_vec(), interleaved] {
            assert_eq!(classify(&resolved, &shuffled), expected, "{shuffled:?}");
        }
    }
}
