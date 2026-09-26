//! 앱 쪽 work 응답에 spec 트리를 싣는다 — 트리 덧붙이기(구현 스펙 3절).
//!
//! **앱이 받는 work에만 붙는다.** MCP와 앱은 같은 work 뷰(`WorkView`)를 쓰는데, 거기에 필드를
//! 더하면 에이전트가 받는 JSON까지 불어난다. 그래서 뷰를 펼치고 `specTree` 하나를 더한 감싼
//! 타입을 따로 둔다 — 커널의 `WorkReport`가 같은 모양의 선례다.
//!
//! **둘로 가른다.** 규칙은 순수 함수(`classify_works`)에 있고, 디스크를 읽는 것은 얇은
//! 입구(`with_spec_trees`)뿐이다. 입구가 목록을 통째로 받으므로 「목록 한 번에 resolve 한 번」은
//! 부르는 쪽의 조심이 아니라 이 모양이 지킨다. Tauri 명령과 L4 다리가 이 입구를 함께 부른다.
//!
//! **아카이브 문서 응답도 여기서 싣는다**(`list_archived_docs`). 아카이브에는 work 뷰가 없어 따로
//! 감싼 타입(`ArchivedDocs`)과 입구(`with_archived_spec_tree`)를 두지만, 둘로 가르는 방식은 같다.

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

/// 아카이브 문서 경로에서 spec 아래를 가르는 앞머리. 아카이브의 경로는 work 폴더 기준이다.
const SPEC_PREFIX: &str = "spec/";

/// 앱 쪽 아카이브 문서 응답 — 커널의 문서 목록과, 그중 `spec/` 아래를 가른 spec 트리.
///
/// **한 응답이다.** 목록과 트리가 따로 오면 아카이브 행을 펼치는 애니메이션 도중 트리만 늦게
/// 도착해 높이가 튄다(구현 스펙 4절 「아카이브 트리」).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedDocs {
    /// 커널이 준 그대로 — work 폴더 기준(`record.md`, `spec/…`)이고 기록이 맨 앞이다. 앱은 첫
    /// 문서를 기본으로 열고, 이 경로로 문서를 읽는다.
    pub docs: Vec<String>,
    /// `spec/` 아래만 가른 트리. 경로는 **spec 기준**이라 앱이 `spec/`를 다시 붙여 쓴다.
    pub spec_tree: SpecTree,
}

/// 풀린 레이아웃 하나로 아카이브 문서 목록의 `spec/` 아래를 가른다. 기록(`record.md`)처럼 spec
/// 밖에 있는 것은 트리에 들지 않는다 — spec의 일부가 아니다.
pub fn classify_archived_docs(resolved: &Resolved, docs: Vec<String>) -> ArchivedDocs {
    let spec_files: Vec<&str> =
        docs.iter().filter_map(|doc| doc.strip_prefix(SPEC_PREFIX)).collect();
    let spec_tree = classify(resolved, &spec_files);
    ArchivedDocs { docs, spec_tree }
}

/// 아카이브 쪽 트리 덧붙이기의 입구 — work 쪽 입구(`with_spec_trees`)와 같이 데이터 루트와 모드로
/// 레이아웃을 풀어 쓴다. 아카이브된 work도 **지금 그 모드의 레이아웃**으로 그린다.
pub fn with_archived_spec_tree(
    data_root: &Path,
    mode: Mode,
    docs: Vec<String>,
) -> Result<ArchivedDocs> {
    let resolved = resolve_layout(data_root, mode, None)?;
    Ok(classify_archived_docs(&resolved, docs))
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

    /// 모드의 내장 레이아웃이 풀린 모양 — 데이터 루트에 레이아웃 폴더가 없을 때 입구가 짓는 것이다.
    fn builtin(mode: Mode) -> Resolved {
        Resolved {
            id: mode,
            layout: builtin_layout(mode),
            source: LayoutSource::Builtin,
            templates: None,
            fallback: None,
        }
    }

    /// 데이터 루트에 Atelier의 레이아웃 폴더를 심는다 — 사람이 `layouts/atelier/`를 두는 것과 같다.
    fn plant_layout(root: &std::path::Path, json: &str) {
        let folder = root.join("layouts/atelier");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("layout.json"), json).unwrap();
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
        let works = classify_works(&builtin(Mode::Atelier), vec![view("a", &["overview.md"])]);
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

        plant_layout(
            root.path(),
            r#"{ "root": { "children": [ { "pattern": "plan.md", "kind": "file", "icon": "scale" } ] } }"#,
        );

        let [planted] = trees(Mode::Atelier).try_into().unwrap();
        assert_eq!(top(&planted), [("plan.md", Some("scale")), ("overview.md", None)]);
        assert_eq!(planted.default_doc.as_deref(), Some("plan.md"));
        assert_eq!((planted.layout_id, planted.fallback), (Mode::Atelier, None));

        let [maison] = trees(Mode::Maison).try_into().unwrap();
        assert_eq!(top(&maison), [("overview.md", Some("compass")), ("plan.md", None)]);
        assert_eq!(maison.layout_id, Mode::Maison);
    }

    /// 트리 전체의 경로를 깊이 우선으로.
    fn paths(items: &[crate::layout::SpecTreeItem]) -> Vec<&str> {
        items
            .iter()
            .flat_map(|item| std::iter::once(item.path.as_str()).chain(paths(&item.children)))
            .collect()
    }

    /// 아카이브 문서 경로는 work 폴더 기준이다(`record.md`, `spec/…`). spec 트리는 **`spec/` 아래만**
    /// 가르고 경로는 spec 기준이다 — 기록은 spec의 일부가 아니다. 문서 목록은 받은 그대로 곁에 선다.
    ///
    /// 최상위 `tickets/`는 내장본의 자리 밖이라 아이콘이 없다(구현 스펙 7절 허용 차이 4) — 이름으로
    /// 알아보던 앱과 달라지는 자리가 아카이브에서도 드러난다.
    #[test]
    fn the_archive_tree_classifies_only_what_is_under_spec_by_spec_paths() {
        let docs = [
            "record.md",
            "spec/tickets/할일.md",
            "spec/01-첫-판/plan.md",
            "spec/overview.md",
        ]
        .map(String::from)
        .to_vec();
        let archived = classify_archived_docs(&builtin(Mode::Atelier), docs.clone());

        assert_eq!(archived.docs, docs);
        let tree = &archived.spec_tree;
        assert_eq!(
            top(tree),
            [("overview.md", Some("compass")), ("01-첫-판", Some("layers")), ("tickets", None)]
        );
        assert_eq!(
            paths(&tree.items),
            ["overview.md", "01-첫-판", "01-첫-판/plan.md", "tickets", "tickets/할일.md"]
        );
        assert_eq!(tree.default_doc.as_deref(), Some("overview.md"));

        // spec 파일이 하나도 없으면 트리가 비고 기본 문서도 없다 — 기록만으로는 서지 않는다
        let bare = classify_archived_docs(&builtin(Mode::Atelier), vec!["record.md".to_string()]);
        assert_eq!(bare.docs, ["record.md"]);
        assert!(bare.spec_tree.items.is_empty(), "{bare:?}");
        assert_eq!(bare.spec_tree.default_doc, None);
    }

    /// 앱 쪽 JSON은 **문서 목록과 `specTree`를 한 응답으로** 싣는다 — 둘이 따로 오면 펼침 애니메이션
    /// 도중 트리만 늦게 도착해 높이가 튄다(구현 스펙 4절 「아카이브 트리」).
    #[test]
    fn the_archive_answer_carries_the_docs_and_the_spec_tree_together() {
        let archived = classify_archived_docs(
            &builtin(Mode::Maison),
            vec!["record.md".to_string(), "spec/overview.md".to_string()],
        );
        let json = serde_json::to_value(&archived).unwrap();
        assert_eq!(json["docs"], serde_json::json!(["record.md", "spec/overview.md"]), "{json}");
        assert_eq!(json["specTree"]["layoutId"], "maison", "{json}");
        assert_eq!(json["specTree"]["items"][0]["path"], "overview.md", "{json}");
        assert_eq!(json["specTree"]["items"][0]["icon"], "compass", "{json}");
    }

    /// 아카이브의 입구도 모드의 레이아웃 폴더를 따른다. 심은 레이아웃이 `record.md`라는 파일 항목을
    /// 둬도 기록은 트리에 들지 않는다 — 가르는 것은 `spec/` 아래뿐이다.
    #[test]
    fn the_archive_entry_follows_the_modes_layout_folder() {
        let root = tempfile::tempdir().unwrap();
        plant_layout(
            root.path(),
            r#"{ "root": { "children": [
                { "pattern": "record.md", "kind": "file", "icon": "flag" },
                { "pattern": "plan.md", "kind": "file", "icon": "scale" }
            ] } }"#,
        );
        let docs = ["record.md", "spec/overview.md", "spec/plan.md"].map(String::from).to_vec();

        let planted = with_archived_spec_tree(root.path(), Mode::Atelier, docs.clone()).unwrap();
        assert_eq!(top(&planted.spec_tree), [("plan.md", Some("scale")), ("overview.md", None)]);
        assert_eq!(planted.spec_tree.default_doc.as_deref(), Some("plan.md"));
        assert_eq!(planted.spec_tree.layout_id, Mode::Atelier);
        assert_eq!(planted.docs, docs);

        // 저쪽 모드의 폴더는 이쪽을 바꾸지 않는다 — Maison은 내장본이다
        let maison = with_archived_spec_tree(root.path(), Mode::Maison, docs).unwrap();
        assert_eq!(top(&maison.spec_tree), [("overview.md", Some("compass")), ("plan.md", None)]);
        assert_eq!(maison.spec_tree.layout_id, Mode::Maison);
    }
}
