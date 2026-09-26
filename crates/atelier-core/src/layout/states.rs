//! 레이아웃 상태 — 설정의 「spec 레이아웃」 페이지가 모드 두 행에 그리는 것.
//!
//! **설정 화면은 resolve 규칙을 TS로 다시 계산하지 않는다**(결정 13). 고쳤는지, 읽을 수 있는지,
//! 물러섰다면 왜인지를 여기서 resolve와 같은 규칙으로 판정해 건넨다 — 두 벌이면 에이전트가 받는
//! 물러선 안내문과 설정의 행이 서로 다른 말을 한다.

use std::path::Path;

use super::parse::{LayoutError, LAYOUT_FILE};
use super::resolve::{
    fallback_reason, folder_error, folder_present, layout_folder, read_layout_file, template_verdict,
    Unreadable,
};
use super::store::Held;
use crate::Mode;

/// 모드 하나의 레이아웃 상태. 밖으로는 camelCase JSON으로 나간다.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutState {
    pub id: Mode,
    /// 레이아웃 폴더 — 홈은 `~`로 줄여 둔다. 폴더가 없어도 그 자리를 준다: 앱은 이것으로 에이전트에게
    /// 붙일 참조(`<폴더>/`)를 만든다(결정 23). 끝에 `/`가 없다.
    pub folder: String,
    /// 고침 여부 — 내장본을 가린 폴더가 있는가. 읽지 못하는 폴더도 가린 것이다.
    pub edited: bool,
    /// 읽기 오류 전부. 읽을 수 있으면 비어 있다.
    pub errors: Vec<LayoutError>,
    /// 물러섰다면 그 까닭 — resolve가 물러선 안내문에 적는 것과 같은 글이다.
    pub fallback: Option<String>,
    /// `layout.json`이 가리키고 디스크에 있는 템플릿 파일의 수. 읽지 못하면 없다.
    pub template_count: Option<usize>,
    /// 폴더 안에서 `layout.json`과 세어진 템플릿을 뺀 파일의 수. 점 파일은 세지 않는다. 읽지 못하면
    /// `layout.json`만 뺀 수다 — 되돌리기는 폴더째 지우므로 레이아웃이 모르는 파일도 함께 사라진다.
    pub other_file_count: usize,
}

/// 모드 둘의 레이아웃 상태 — Atelier, Maison 순서다. **아무것도 쓰지 않는다**(결정 7).
pub fn layout_states(data_root: &Path) -> Vec<LayoutState> {
    [Mode::Atelier, Mode::Maison].into_iter().map(|id| state_of(data_root, id)).collect()
}

fn state_of(data_root: &Path, id: Mode) -> LayoutState {
    let folder = layout_folder(data_root, id);
    let shown = crate::collapse_home(&folder);
    match folder_present(&folder) {
        Ok(false) => LayoutState {
            id,
            folder: shown,
            edited: false,
            errors: vec![],
            fallback: None,
            template_count: Some(0),
            other_file_count: 0,
        },
        Ok(true) => match read_layout_file(&folder) {
            Ok(layout) => {
                let verdict = template_verdict(&layout, &folder, shown.clone());
                let pointed = verdict.present.iter().map(String::as_str);
                let held = Held::of(&folder, pointed.chain([LAYOUT_FILE]));
                LayoutState {
                    id,
                    folder: shown,
                    edited: true,
                    errors: vec![],
                    fallback: None,
                    template_count: Some(verdict.present.len()),
                    other_file_count: files_besides(&folder, &held),
                }
            }
            // 무엇이 템플릿인지 모른다 — 레이아웃 파일만 뺀다
            Err(Unreadable { errors, .. }) => {
                broken(id, shown, errors, files_besides(&folder, &Held::of(&folder, [LAYOUT_FILE])))
            }
        },
        // 있는지조차 모르는 자리도 가린 것이다(resolve가 거기서 물러선다). 셀 수 있는 것이 없다.
        Err(e) => broken(id, shown, vec![folder_error(&e)], 0),
    }
}

/// 읽지 못해 내장본으로 물러선 모드 — 템플릿 개수가 없다.
fn broken(id: Mode, folder: String, errors: Vec<LayoutError>, other_file_count: usize) -> LayoutState {
    LayoutState {
        id,
        folder,
        edited: true,
        fallback: Some(fallback_reason(&errors)),
        errors,
        template_count: None,
        other_file_count,
    }
}

/// 폴더 안의 파일 가운데 `held`가 쥐지 않은 것의 수 — 하위 폴더 안까지 센다.
///
/// **점으로 시작하는 것은 파일이든 폴더든 보지 않는다** — 저장의 임시 파일과 `.DS_Store`는 사람이 둔
/// 것이 아니고, resolve도 감시도 점 파일을 보지 않는다. 링크는 따라가지 않는다: 폴더를 가리키는
/// 링크도 파일 하나로 센다(되돌리기가 지우는 것은 링크 자신이다).
///
/// **읽지 못한 폴더는 건너뛴다.** 이 수는 되돌리기 확인 창의 안내일 뿐이라, 하위 폴더 하나를 못
/// 읽었다고 두 모드의 상태를 통째로 잃으면 설정 페이지가 읽지 못한 행조차 못 그린다.
fn files_besides(folder: &Path, held: &Held) -> usize {
    let mut count = 0;
    let mut stack = vec![folder.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let path = entry.path();
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                stack.push(path);
                continue;
            }
            let relative = path.strip_prefix(folder).unwrap_or(&path).to_string_lossy();
            if !held.holds(folder, &relative) {
                count += 1;
            }
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder_of(root: &Path, id: &str) -> String {
        crate::collapse_home(&root.join("layouts").join(id))
    }

    /// 폴더가 없으면 **내장본 그대로**다 — 고친 적이 없고, 오류도 물러서기도 없다. 내장본은 템플릿이
    /// 없으니 템플릿은 0개다(읽지 못한 것이 아니다). 폴더 자리는 그래도 준다: 참조가 그 자리다.
    #[test]
    fn without_a_folder_each_mode_is_its_builtin() {
        let root = tempfile::tempdir().unwrap();
        let states = layout_states(root.path());
        assert_eq!(
            states,
            [
                LayoutState {
                    id: Mode::Atelier,
                    folder: folder_of(root.path(), "atelier"),
                    edited: false,
                    errors: vec![],
                    fallback: None,
                    template_count: Some(0),
                    other_file_count: 0,
                },
                LayoutState {
                    id: Mode::Maison,
                    folder: folder_of(root.path(), "maison"),
                    edited: false,
                    errors: vec![],
                    fallback: None,
                    template_count: Some(0),
                    other_file_count: 0,
                },
            ]
        );
    }

    /// **읽기는 아무것도 쓰지 않는다**(결정 7) — 설정 페이지를 열기만 해도 `layouts/`가 생기면 그것이
    /// 앞으로 무엇을 가릴지 아무도 모른다. `layouts/`조차 없는 데이터 루트에서 잰다.
    #[test]
    fn reading_the_states_creates_nothing() {
        let root = tempfile::tempdir().unwrap();
        layout_states(root.path());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }

    /// `<데이터 루트>/layouts/<id>/`에 파일 하나를 심는다. 폴더가 없으면 만든다.
    fn plant(root: &Path, id: &str, file: &str, content: &str) {
        let path = root.join("layouts").join(id).join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    /// 템플릿 셋을 가리키는 레이아웃 — 맨 위 층의 것, 하위 폴더의 것, 디스크에 없는 것.
    const THREE_TEMPLATES: &str = r#"{ "root": { "children": [
        { "pattern": "decisions.md", "kind": "file", "template": "decisions.md" },
        { "pattern": "docs", "kind": "folder", "children": [
            { "pattern": "plan.md", "kind": "file", "template": "sub/plan.md" } ] },
        { "pattern": "gone.md", "kind": "file", "template": "gone.md" } ] } }"#;

    /// 가림 폴더가 있으면 **고친 것**이다. 템플릿은 가리키고 디스크에 있는 것만 센다 — 가리키지만
    /// 없는 `gone.md`는 세지 않는다. 폴더는 **모드마다 따로**라 다른 모드는 여전히 내장본 그대로다.
    #[test]
    fn a_folder_is_edited_and_counts_the_templates_it_points_to_that_are_on_disk() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", THREE_TEMPLATES);
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");
        plant(root.path(), "atelier", "sub/plan.md", "# Plan\n");

        let [atelier, maison] = <[LayoutState; 2]>::try_from(layout_states(root.path())).unwrap();
        assert_eq!(atelier.id, Mode::Atelier);
        assert!(atelier.edited);
        assert_eq!(atelier.folder, folder_of(root.path(), "atelier"));
        assert_eq!(atelier.errors, []);
        assert_eq!(atelier.fallback, None);
        assert_eq!(atelier.template_count, Some(2));
        assert_eq!(atelier.other_file_count, 0);

        assert_eq!(maison.id, Mode::Maison);
        assert!(!maison.edited);
        assert_eq!(maison.template_count, Some(0));
    }

    /// 레이아웃이 모르는 파일은 **그 밖의 파일**로 센다 — 하위 폴더 안의 것도. 되돌리기가 폴더째
    /// 지우므로 확인 창이 그것까지 적는다. `layout.json`과 세어진 템플릿은 빼고, 점 파일(저장의 임시
    /// 파일, `.DS_Store`)과 점 폴더 안은 세지 않는다. 빈 폴더는 파일이 아니다.
    #[test]
    fn files_the_layout_does_not_know_are_counted_apart_and_dot_files_are_not() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", THREE_TEMPLATES);
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");
        plant(root.path(), "atelier", "sub/plan.md", "# Plan\n");
        plant(root.path(), "atelier", "notes.md", "사람이 둔 메모\n");
        plant(root.path(), "atelier", "sub/old-plan.md", "# 옛 계획\n");
        plant(root.path(), "atelier", ".DS_Store", "x");
        plant(root.path(), "atelier", ".layout.json.tmp", "x");
        plant(root.path(), "atelier", ".git/config", "x");
        std::fs::create_dir_all(root.path().join("layouts/atelier/empty")).unwrap();

        let atelier = &layout_states(root.path())[0];
        assert_eq!(atelier.template_count, Some(2));
        assert_eq!(atelier.other_file_count, 2);
    }

    /// 템플릿은 **파일로** 뺀다 — 레이아웃이 `sub//plan.md`로 적어도 디스크의 `sub/plan.md`는 그
    /// 템플릿이다. 글자로 견주면 한 파일이 템플릿으로도 그 밖의 파일로도 세어져 확인 창이 없는 파일을
    /// 하나 더 적는다.
    #[test]
    fn a_template_written_another_way_is_not_counted_again_as_another_file() {
        let root = tempfile::tempdir().unwrap();
        plant(
            root.path(),
            "atelier",
            "layout.json",
            r#"{ "root": { "children": [
                { "pattern": "plan.md", "kind": "file", "template": "sub//plan.md" } ] } }"#,
        );
        plant(root.path(), "atelier", "sub/plan.md", "# Plan\n");

        let atelier = &layout_states(root.path())[0];
        assert_eq!(atelier.template_count, Some(1));
        assert_eq!(atelier.other_file_count, 0);
    }

    /// **깨진 폴더도 고친 것이다** — 내장본을 가린 폴더가 있다. 읽기 오류 전부와, 물러선 까닭이 온다.
    /// 까닭은 에이전트가 받는 물러선 안내문의 것과 **같은 글**이다 — 설정의 행과 에이전트가 다른 말을
    /// 하면 안 된다. 무엇이 템플릿인지 모르므로 템플릿 개수는 없고, 그 밖의 파일은 `layout.json`만
    /// 뺀 수다.
    #[test]
    fn a_broken_folder_gives_its_errors_and_why_it_fell_back_and_no_template_count() {
        let root = tempfile::tempdir().unwrap();
        plant(
            root.path(),
            "maison",
            "layout.json",
            r#"{ "root": { "children": [
                { "pattern": "a.md", "kind": "fil", "template": "a.md" },
                { "pattern": "{x}", "kind": "folder" } ] } }"#,
        );
        plant(root.path(), "maison", "a.md", "# A\n");
        plant(root.path(), "maison", "notes.md", "메모\n");
        plant(root.path(), "maison", ".layout.json.tmp", "x");

        let [atelier, maison] = <[LayoutState; 2]>::try_from(layout_states(root.path())).unwrap();
        assert!(!atelier.edited, "다른 모드는 그대로다: {atelier:?}");
        assert_eq!(maison.id, Mode::Maison);
        assert!(maison.edited);
        assert_eq!(maison.folder, folder_of(root.path(), "maison"));
        assert_eq!(maison.errors.len(), 2, "{:?}", maison.errors);
        assert_eq!(maison.errors[0].path, Some(vec![0]));
        assert_eq!(maison.errors[1].path, Some(vec![1]));
        let reason = maison.fallback.clone().expect("물러선 까닭이 없다");
        assert!(reason.starts_with("root.children[0]: "), "{reason}");
        assert!(reason.contains("\"fil\""), "{reason}");
        let resolved = crate::resolve_layout(root.path(), Mode::Maison, None).unwrap();
        assert_eq!(Some(reason), resolved.fallback.map(|fallback| fallback.reason));
        assert_eq!(maison.template_count, None);
        assert_eq!(maison.other_file_count, 2);
    }

    /// 앱은 이 모양을 읽는다(`src/features/spec-layout/types.ts`) — 칸 이름은 camelCase이고, 없는 것은
    /// 빠지지 않고 `null`로 선다. 오류는 저장·미리보기와 같은 `{ path, message }`다.
    #[test]
    fn a_state_goes_out_in_the_shape_the_app_reads() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "maison", "layout.json", "{ not json");

        let states = serde_json::to_value(layout_states(root.path())).unwrap();
        let maison = &states[1];
        let keys: Vec<&str> = maison.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys.iter().copied().collect::<std::collections::BTreeSet<_>>(),
            ["edited", "errors", "fallback", "folder", "id", "otherFileCount", "templateCount"].into()
        );
        assert_eq!(maison["id"], "maison");
        assert_eq!(maison["templateCount"], serde_json::Value::Null);
        assert_eq!(maison["errors"][0]["path"], serde_json::Value::Null);
        assert!(maison["errors"][0]["message"].as_str().unwrap().contains("JSON"));
        assert_eq!(states[0]["fallback"], serde_json::Value::Null);
        assert_eq!(states[0]["templateCount"], 0);
    }

    /// `layout.json`이 없는 폴더도 깨진 것이다 — 까닭이 그것을 말한다.
    #[test]
    fn a_folder_without_its_layout_file_is_broken() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");

        let atelier = &layout_states(root.path())[0];
        assert!(atelier.edited);
        assert_eq!(atelier.errors.len(), 1);
        let reason = atelier.fallback.as_deref().unwrap_or_default();
        assert!(reason.contains("layout.json") && reason.contains("missing"), "{reason}");
        assert_eq!(atelier.template_count, None);
        assert_eq!(atelier.other_file_count, 1);
    }

    /// 있는지조차 확인하지 못하는 자리(대상이 사라진 링크)도 **없는 것으로 치지 않는다** — resolve가
    /// 그것을 깨진 것으로 보고 물러서므로, 설정의 행도 그렇게 선다. 상태를 읽는 일 자체는 실패하지
    /// 않는다: 한 모드의 폴더 때문에 두 행을 다 잃으면 안 된다.
    #[cfg(unix)]
    #[test]
    fn a_layout_folder_link_to_nowhere_is_a_broken_row_not_a_failed_read() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("layouts")).unwrap();
        std::os::unix::fs::symlink(root.path().join("gone"), root.path().join("layouts/atelier")).unwrap();

        let [atelier, maison] = <[LayoutState; 2]>::try_from(layout_states(root.path())).unwrap();
        assert!(atelier.edited);
        assert!(!atelier.errors.is_empty());
        let resolved = crate::resolve_layout(root.path(), Mode::Atelier, None).unwrap();
        assert_eq!(atelier.fallback, resolved.fallback.map(|fallback| fallback.reason));
        assert_eq!(atelier.template_count, None);
        assert_eq!(atelier.other_file_count, 0);
        assert!(!maison.edited);
    }
}
