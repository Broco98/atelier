//! 앱 쪽 work 응답에 spec 트리를 싣는다 — 트리 덧붙이기(구현 스펙 3절).
//!
//! **앱이 받는 work에만 붙는다.** MCP와 앱은 같은 work 뷰(`WorkView`)를 쓰는데, 거기에 필드를
//! 더하면 에이전트가 받는 JSON까지 불어난다. 그래서 뷰를 펼치고 `specTree` 하나를 더한 감싼
//! 타입을 따로 둔다 — 커널의 `WorkReport`가 같은 모양의 선례다.
//!
//! **둘로 가른다.** 규칙은 순수 함수(`classify_works`)에 있고, 디스크를 읽는 것은 얇은
//! 입구(`with_spec_trees`)뿐이다. 입구가 목록을 통째로 받으므로 「목록 한 번에 resolve 한 번」은
//! 부르는 쪽의 조심이 아니라 이 모양이 지킨다. Tauri 명령과 L4 다리가 이 입구를 함께 부른다.

use std::path::Path;

use serde::Serialize;

use super::classify::{classify, SpecTree};
use super::resolve::{resolve_layout, Resolved};
use crate::work::WorkView;
use crate::{Mode, Result};

/// 앱 쪽 work 하나 — 커널의 뷰에 그 work의 spec 트리를 더한 것.
///
/// 사용자가 `work.json` 최상위에 `specTree` 키를 적으면 JSON에 같은 키가 두 번 나갈 수 있다.
/// 뷰의 `specFiles`가 이미 같은 위험을 안고 있는 것이라 새 위험이 아니므로 막지 않는다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkWithSpecTree {
    #[serde(flatten)]
    pub view: WorkView,
    pub spec_tree: SpecTree,
}

/// 풀린 레이아웃 하나로 work마다 **자기** spec 파일 목록을 가른다. 순서는 받은 그대로다 — 목록의
/// 순서는 커널이 정한다.
pub fn classify_works(resolved: &Resolved, works: Vec<WorkView>) -> Vec<WorkWithSpecTree> {
    works
        .into_iter()
        .map(|view| {
            let spec_tree = classify(resolved, &view.spec_files);
            WorkWithSpecTree { view, spec_tree }
        })
        .collect()
}

/// 트리 덧붙이기의 입구 — 데이터 루트와 모드로 레이아웃을 **한 번** 풀고 목록 전체에 쓴다.
///
/// work 지정 레이아웃은 아직 넘기지 않는다(결정 16). 그날 고칠 자리가 여기다 — work마다 제
/// `work.json`의 값을 넘기게 되면 한 번 풀기는 레이아웃 id마다 한 번이 된다.
///
/// 단건 조회도 이 입구를 지난다. 하나를 넣으면 하나가 나온다.
pub fn with_spec_trees(
    data_root: &Path,
    mode: Mode,
    works: Vec<WorkView>,
) -> Result<Vec<WorkWithSpecTree>> {
    let resolved = resolve_layout(data_root, mode, None)?;
    Ok(classify_works(&resolved, works))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::builtin::builtin_layout;
    use crate::layout::model::{EntryKind, LayoutEntry, SpecLayout};
    use crate::layout::resolve::LayoutSource;
    use crate::work::{Work, WorkStatus, WorkView};

    /// 커널이 주는 work 뷰 하나 — 여기서 보는 것은 slug와 spec 파일 목록뿐이다.
    fn view(slug: &str, files: &[&str]) -> WorkView {
        WorkView {
            work: Work {
                slug: slug.to_string(),
                title: format!("{slug} 제목"),
                status: WorkStatus::Active,
                branch: None,
                created_at: "2026-09-25".to_string(),
                projects: Vec::new(),
                pinned: false,
                extra: serde_json::Map::new(),
            },
            worktrees: Vec::new(),
            spec_dir: format!("~/.atelier/works/{slug}/spec"),
            spec_files: files.iter().map(ToString::to_string).collect(),
        }
    }

    fn entry(pattern: &str, kind: EntryKind, icon: &str) -> LayoutEntry {
        LayoutEntry {
            pattern: Some(pattern.to_string()),
            kind: Some(kind),
            icon: Some(icon.to_string()),
            ..LayoutEntry::default()
        }
    }

    /// 한 층의 (이름, 아이콘)을 순서대로.
    fn top(tree: &SpecTree) -> Vec<(&str, Option<&str>)> {
        tree.items.iter().map(|item| (item.name.as_str(), item.icon.as_deref())).collect()
    }

    /// 순수 함수 — 풀린 레이아웃 하나로 work마다 **자기** spec 파일 목록을 가른다. 한 work의 파일이
    /// 다른 work의 트리에 새지 않고, 뷰의 나머지는 그대로 실린다.
    #[test]
    fn each_work_gets_the_tree_of_its_own_files() {
        let resolved = Resolved {
            id: Mode::Maison,
            layout: SpecLayout {
                root: LayoutEntry {
                    children: vec![
                        entry("plan.md", EntryKind::File, "scale"),
                        entry("notes", EntryKind::Folder, "book-open"),
                    ],
                    ..LayoutEntry::default()
                },
                ..SpecLayout::default()
            },
            source: LayoutSource::Builtin,
            templates: None,
            fallback: None,
        };
        let works = classify_works(
            &resolved,
            vec![view("a", &["zeta.md", "plan.md"]), view("b", &["notes/x.md", "alpha.md"])],
        );

        let [a, b] = works.as_slice() else { panic!("work 둘이 둘로 나와야 한다: {works:?}") };
        assert_eq!(a.view.work.slug, "a");
        assert_eq!(a.view.spec_files, ["zeta.md", "plan.md"]);
        assert_eq!(top(&a.spec_tree), [("plan.md", Some("scale")), ("zeta.md", None)]);
        assert_eq!(a.spec_tree.default_doc.as_deref(), Some("plan.md"));
        assert_eq!(a.spec_tree.layout_id, Mode::Maison);

        assert_eq!(b.view.work.slug, "b");
        assert_eq!(top(&b.spec_tree), [("notes", Some("book-open")), ("alpha.md", None)]);
        // 고정 이름의 파일 항목에 맞은 파일이 없으니 코드포인트순 첫 파일이다
        assert_eq!(b.spec_tree.default_doc.as_deref(), Some("alpha.md"));
    }

    /// 앱 쪽 JSON은 **커널의 뷰를 펼치고 `specTree` 하나를 더한** 모양이다 — 뷰의 키가 한 겹
    /// 아래로 들어가면 앱의 work 타입이 통째로 어긋난다.
    #[test]
    fn the_answer_is_the_view_spread_out_with_a_spec_tree_beside_it() {
        let resolved = Resolved {
            id: Mode::Atelier,
            layout: builtin_layout(Mode::Atelier),
            source: LayoutSource::Builtin,
            templates: None,
            fallback: None,
        };
        let works = classify_works(&resolved, vec![view("a", &["overview.md"])]);
        let json = serde_json::to_value(&works).unwrap();
        assert_eq!(json[0]["slug"], "a", "{json}");
        assert_eq!(json[0]["specFiles"], serde_json::json!(["overview.md"]), "{json}");
        assert_eq!(json[0]["specDir"], "~/.atelier/works/a/spec", "{json}");
        assert_eq!(json[0]["specTree"]["layoutId"], "atelier", "{json}");
        assert_eq!(json[0]["specTree"]["defaultDoc"], "overview.md", "{json}");
        assert_eq!(json[0]["specTree"]["items"][0]["icon"], "compass", "{json}");
        assert!(json[0].get("view").is_none(), "뷰가 펼쳐지지 않았다: {json}");
    }

    /// 입구 — 데이터 루트와 모드로 레이아웃을 풀어 목록 전체에 쓴다. 모드의 레이아웃 폴더가 있으면
    /// 그것을 따르고, 없으면 내장본을 따른다. 저쪽 모드의 폴더는 이쪽을 바꾸지 않는다.
    #[test]
    fn the_entry_follows_the_modes_layout_folder_and_falls_to_the_builtin_without_one() {
        let root = tempfile::tempdir().unwrap();
        let files = ["overview.md", "plan.md"];
        let trees = |mode| {
            with_spec_trees(root.path(), mode, vec![view("a", &files)])
                .unwrap()
                .into_iter()
                .map(|work| work.spec_tree)
                .collect::<Vec<_>>()
        };

        let [builtin] = trees(Mode::Atelier).try_into().unwrap();
        assert_eq!(top(&builtin), [("overview.md", Some("compass")), ("plan.md", None)]);
        assert_eq!(builtin.default_doc.as_deref(), Some("overview.md"));

        let folder = root.path().join("layouts/atelier");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(
            folder.join("layout.json"),
            r#"{ "root": { "children": [ { "pattern": "plan.md", "kind": "file", "icon": "scale" } ] } }"#,
        )
        .unwrap();

        let [planted] = trees(Mode::Atelier).try_into().unwrap();
        assert_eq!(top(&planted), [("plan.md", Some("scale")), ("overview.md", None)]);
        assert_eq!(planted.default_doc.as_deref(), Some("plan.md"));
        assert_eq!((planted.layout_id, planted.fallback), (Mode::Atelier, None));

        let [maison] = trees(Mode::Maison).try_into().unwrap();
        assert_eq!(top(&maison), [("overview.md", Some("compass")), ("plan.md", None)]);
        assert_eq!(maison.layout_id, Mode::Maison);
    }
}
