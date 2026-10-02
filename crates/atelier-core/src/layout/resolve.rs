//! resolve — 이번 호출에 쓸 레이아웃을 정하는 입구.
//!
//! 순서는 `레이아웃 폴더(<데이터 루트>/layouts/atelier/) → 코드 내장본`이다. 레이아웃은 하나라 고르는
//! id가 없다(ui-refresh 결정 23) — 폴더는 고정 경로다. 폴더를 못 쓰면 내장본으로 물러서고 까닭을 함께
//! 준다(결정 15).
//!
//! **부를 때마다 디스크를 새로 읽고 캐시를 두지 않는다**(결정 9). 그래서 MCP 서버는 데이터 루트의
//! 경로만 기동 때 정해 두고 호출마다 이 입구를 부른다 — 세션 도중에 레이아웃을 고쳐도 다음 응답이
//! 따라온다. 읽기는 아무것도 쓰지 않는다(결정 7).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use super::builtin::builtin_layout;
use super::model::SpecLayout;
use super::parse::{parse_layout, LayoutError, LAYOUT_FILE};
use super::render::{Fallback, TemplateVerdict};

/// 쓸 레이아웃이 어디서 왔는가.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutSource {
    /// 코드 내장본. 레이아웃 폴더가 없거나, 있어도 못 써서 물러섰다.
    Builtin,
    /// 레이아웃 폴더 — 내장본을 가린다(결정 7).
    Folder(PathBuf),
}

/// resolve의 결과 — render와 classify에 그대로 건넬 것들.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    pub layout: SpecLayout,
    pub source: LayoutSource,
    /// 파일에서 온 레이아웃일 때만 있다.
    pub templates: Option<TemplateVerdict>,
    /// 물러섰다면 그 까닭.
    pub fallback: Option<Fallback>,
}

/// 레이아웃 폴더 — `<데이터 루트>/layouts/atelier/`. **고정 경로다**(ui-refresh 결정 23): 폴더 이름은 이미
/// 고친 레이아웃이 옮기지 않아도 그대로 읽히게 둔 자리일 뿐, 무엇을 고르는 값이 아니다. 읽기 · 저장 ·
/// 되돌리기 · 설정의 상태가 모두 이 한 자리를 지난다 — 경로가 밖에서 오지 않으니 데이터 루트 밖을 가리킬
/// 길이 없다.
pub(crate) fn layout_folder(data_root: &Path) -> PathBuf {
    crate::paths::layouts_in(data_root).join("atelier")
}

/// 이번 호출에 쓸 레이아웃. **실패하지 않는다** — 폴더를 못 쓰는 모든 길은 내장본으로 물러선 결과다.
/// 물러서기의 도착지는 늘 코드 내장본이다(결정 7의 「돌아갈 곳」은 코드 안의 것이다).
///
/// `settings.json`은 보지 않는다(결정 25) — 레이아웃은 고정 경로에서 바로 찾는다.
pub fn resolve_layout(data_root: &Path) -> Resolved {
    let folder = layout_folder(data_root);
    let shown = crate::collapse_home(&folder);
    let reason = match folder_present(&folder) {
        // 폴더가 없으면 코드 내장본이다 — 가린 폴더가 없을 뿐, 물러선 것이 아니다
        Ok(false) => {
            return Resolved {
                layout: builtin_layout(),
                source: LayoutSource::Builtin,
                templates: None,
                fallback: None,
            };
        }
        Err(e) => fallback_reason(&[folder_error(&e)]),
        Ok(true) => match read_layout_file(&folder) {
            Ok(layout) => {
                return Resolved {
                    templates: Some(template_verdict(&layout, &folder, shown)),
                    layout,
                    source: LayoutSource::Folder(folder),
                    fallback: None,
                };
            }
            Err(unreadable) => fallback_reason(&unreadable.errors),
        },
    };
    Resolved {
        layout: builtin_layout(),
        source: LayoutSource::Builtin,
        templates: None,
        fallback: Some(Fallback { folder: shown, reason }),
    }
}

/// 레이아웃 폴더가 있는가 — 가린 폴더가 있는가(결정 7).
///
/// **없음은 `NotFound`뿐이다.** `Path::exists`는 쓰지 않는다 — 권한 오류도, 대상이 사라진 링크도
/// 「없음」으로 삼켜서 사용자가 둔 폴더가 알림 없이 무시된다. 링크는 따라가지 않고 그 자리에
/// 무엇이 있는지만 본다. 폴더가 있는지 묻는 자리(resolve, 저장소)가 모두 이 한 규칙을 지나야
/// 답이 서로 맞는다.
pub(crate) fn folder_present(folder: &Path) -> std::io::Result<bool> {
    match std::fs::symlink_metadata(folder) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

/// 물러선 까닭 — **첫** 오류와 그 위치만 적는다(구현 스펙 1절 「물러서기」의 표). 오류 전부는 설정의
/// 상태(`LayoutState.errors`)와 저장소 읽기(`LayoutContent::Broken`, 에이전트의 읽기 도구)가 준다 —
/// 설정의 행은 이 까닭 한 줄만 보인다.
///
/// resolve와 설정의 상태(`states.rs`)가 이 한 자리를 지난다 — 에이전트가 받는 물러선 안내문과 설정의
/// 행이 같은 까닭을 말해야 한다.
pub(crate) fn fallback_reason(errors: &[LayoutError]) -> String {
    errors.first().map(ToString::to_string).unwrap_or_default()
}

/// 폴더가 있는지조차 확인하지 못한 까닭 — 문서 전체의 오류다.
pub(crate) fn folder_error(e: &std::io::Error) -> LayoutError {
    LayoutError::document(format!("cannot read the layout folder: {e}"))
}

/// 읽지 못한 `layout.json` — 오류 전부와, 읽었다면 그 원문.
#[derive(Debug)]
pub(crate) struct Unreadable {
    /// 비어 있지 않다.
    pub errors: Vec<LayoutError>,
    /// 파일을 읽었으나 검증이 거절했다면 그 글. 에이전트가 고쳐 다시 저장할 때 쓴다(결정 20).
    pub raw: Option<String>,
}

/// 폴더의 `layout.json`을 읽는다. 못 쓰면 까닭을 오류 목록으로 준다 — 파일이 없거나 못 읽으면
/// 문서 전체의 오류 하나, 검증이 거절하면 위치가 붙은 오류 전부다.
pub(crate) fn read_layout_file(folder: &Path) -> std::result::Result<SpecLayout, Unreadable> {
    let unreadable = |message: String| Unreadable { errors: vec![LayoutError::document(message)], raw: None };
    let text = match std::fs::read_to_string(folder.join(LAYOUT_FILE)) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(unreadable(format!("{LAYOUT_FILE} is missing")))
        }
        Err(e) => return Err(unreadable(format!("cannot read {LAYOUT_FILE}: {e}"))),
    };
    parse_layout(&text).map_err(|errors| Unreadable { errors, raw: Some(text) })
}

/// 레이아웃이 가리키는 템플릿 가운데 디스크에 실제로 있는 것. render는 이 판정만 본다.
///
/// **점 파일은 없는 것으로 친다.** 저장은 파일마다 점으로 시작하는 임시 파일에 쓰고 이름을 바꾼다
/// — 그 사이에 읽혀도 반쯤 쓴 파일을 템플릿으로 건네지 않는다.
pub(crate) fn template_verdict(layout: &SpecLayout, folder: &Path, shown: String) -> TemplateVerdict {
    template_verdict_with(layout, shown, |template| folder.join(template).is_file())
}

/// 템플릿 판정의 틀 — 가리키는 템플릿 가운데 `exists`가 있다고 하는 것. 점 파일은 `exists`가 무엇을 말하든
/// 없는 것이다(위 판정의 까닭).
///
/// 미리보기(`preview_layout`)가 「초안에 본문이 있거나 디스크에 있는 것」으로 이것을 부른다 — 점 파일 규칙이
/// 여기 한 벌이라, 저장한 뒤 resolve가 내릴 판정과 미리보기의 판정이 갈리지 않는다.
pub(crate) fn template_verdict_with(
    layout: &SpecLayout,
    shown: String,
    exists: impl Fn(&str) -> bool,
) -> TemplateVerdict {
    let mut present = BTreeSet::new();
    let mut stack = vec![&layout.root];
    while let Some(entry) = stack.pop() {
        if let Some(template) = &entry.template {
            if !hidden_template(template) && exists(template) {
                present.insert(template.clone());
            }
        }
        stack.extend(&entry.children);
    }
    TemplateVerdict { present, folder: shown }
}

/// 템플릿 경로에 점으로 시작하는 조각이 있는가(`.plan.md`, `.templates/adr.md`) — 판정은 그런 템플릿을
/// 없는 것으로 친다(`template_verdict`의 까닭). **규칙은 이 한 자리다**: 저장의 검증(`store::validate`)도
/// 이것으로 그런 경로를 거절한다 — 받아 쓰면 저장은 됐다는데 그 `Template:` 줄이 영영 실리지 않는다.
/// 손으로 적은 `layout.json`에 든 것은 거절하지 않고 판정이 없는 것으로 친다.
pub(crate) fn hidden_template(template: &str) -> bool {
    Path::new(template).components().any(|part| part.as_os_str().to_string_lossy().starts_with('.'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::builtin::builtin_layout;
    use crate::layout::model::{EntryKind, LayoutEntry};

    /// 데이터 루트 아래 모든 경로 — 폴더도 센다. 읽기가 빈 폴더 하나라도 만들면 여기서 드러난다.
    fn everything_under(root: &Path) -> Vec<PathBuf> {
        let mut found = Vec::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    stack.push(path.clone());
                }
                found.push(path);
            }
        }
        found.sort();
        found
    }

    /// 레이아웃 폴더가 없으면 내장본이다. 템플릿 판정도 물러서기도 없다 — 내장본은 디스크에 없고,
    /// 물러선 것이 아니라 처음부터 거기 있다.
    #[test]
    fn with_no_layout_folder_the_builtin_is_used() {
        let root = tempfile::tempdir().unwrap();
        let resolved = resolve_layout(root.path());
        assert_eq!(resolved.layout, builtin_layout());
        assert_eq!(resolved.source, LayoutSource::Builtin);
        assert_eq!(resolved.templates, None);
        assert_eq!(resolved.fallback, None);
    }

    /// 앱의 감시자는 기동할 때 `layouts/`를 만든다(spec 레이아웃 결정 22 — 다른 감시와 같다). **그 빈
    /// 폴더는 아무것도 가리지 않는다**: resolve는 `atelier/`만 보므로 내장본 그대로이고, 물러선 것도
    /// 아니다. 설정의 상태도 「고침」이 안 된다. 빈 `layouts/`가 무엇이든 가리면, 앱을 한 번 띄운 것만으로
    /// 에이전트가 받는 안내문과 설정의 행이 바뀐다.
    ///
    /// 곁에 남은 다른 이름의 폴더(`layouts/old/`)도 그렇다 — 레이아웃은 고정 경로 하나만 읽는다
    /// (ui-refresh 결정 23). 깨진 파일을 두어, 읽었다면 물러섰을 것으로 잰다.
    #[test]
    fn the_empty_layouts_folder_the_watcher_makes_hides_nothing() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("layouts")).unwrap();
        let check = |root: &Path| {
            let resolved = resolve_layout(root);
            assert_eq!(resolved.layout, builtin_layout());
            assert_eq!(resolved.source, LayoutSource::Builtin);
            assert_eq!(resolved.fallback, None);
            assert!(!crate::layout_state(root).edited, "빈 layouts/가 고친 것으로 읽힌다");
        };
        check(root.path());

        let other = root.path().join("layouts/old");
        std::fs::create_dir(&other).unwrap();
        std::fs::write(other.join("layout.json"), "{ not json").unwrap();
        check(root.path());
    }

    /// **감시자가 보는 자리가 resolve가 읽는 레이아웃 폴더를 품는다.** 둘이 갈리면 에이전트가 저장해도
    /// 종이 안 울려, 설정과 spec 패널 탭이 다시 띄울 때까지 옛것을 든다.
    #[test]
    fn the_layout_folder_sits_in_the_folder_the_app_watches() {
        let folder = layout_folder(&crate::data_root());
        assert_eq!(folder.parent(), Some(crate::layouts_dir().as_path()), "레이아웃 폴더가 감시 밖이다");
    }

    /// `<데이터 루트>/layouts/atelier/`에 파일 하나를 심는다. 폴더가 없으면 만든다.
    fn plant(root: &Path, file: &str, content: &str) {
        let path = root.join("layouts/atelier").join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    /// 템플릿 하나를 가리키는 작은 레이아웃. 설명으로 어느 것인지 가른다.
    fn small_layout(whose: &str) -> String {
        format!(
            r#"{{ "root": {{ "description": "{whose}", "children": [
                {{ "pattern": "decisions.md", "kind": "file", "description": "why",
                   "template": "decisions.md" }} ] }} }}"#
        )
    }

    fn small_model(whose: &str) -> SpecLayout {
        SpecLayout {
            root: LayoutEntry {
                description: whose.to_string(),
                children: vec![LayoutEntry {
                    pattern: Some("decisions.md".to_string()),
                    kind: Some(EntryKind::File),
                    description: "why".to_string(),
                    template: Some("decisions.md".to_string()),
                    ..LayoutEntry::default()
                }],
                ..LayoutEntry::default()
            },
            ..SpecLayout::default()
        }
    }

    /// 레이아웃 폴더가 있으면 **그것이 쓰는 레이아웃이다** — 내장본을 가린다(결정 7). 이미 고친
    /// `layouts/atelier/`가 옮기지 않아도 그대로 읽힌다(ui-refresh 결정 23).
    ///
    /// 파일에서 온 레이아웃이라 템플릿 판정이 붙는다. 판정의 폴더는 홈을 `~`로 줄인 경로다 — 임시
    /// 폴더는 홈 밖이라 줄지 않은 채다.
    #[test]
    fn the_layout_folder_hides_the_builtin() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "layout.json", &small_layout("mine"));
        plant(root.path(), "decisions.md", "# Decisions\n");

        let resolved = resolve_layout(root.path());
        let folder = root.path().join("layouts/atelier");
        assert_eq!(resolved.layout, small_model("mine"));
        assert_eq!(resolved.source, LayoutSource::Folder(folder.clone()));
        assert_eq!(
            resolved.templates,
            Some(TemplateVerdict {
                present: ["decisions.md".to_string()].into(),
                folder: crate::collapse_home(&folder),
            })
        );
        assert_eq!(resolved.fallback, None);
    }

    /// 물러선 결과는 늘 같은 모양이다 — **코드 내장본**, 판정 없음, 까닭 하나.
    fn assert_fell_back(resolved: &Resolved, folder: &Path) -> String {
        assert_eq!(resolved.layout, builtin_layout());
        assert_eq!(resolved.source, LayoutSource::Builtin);
        assert_eq!(resolved.templates, None);
        let fallback = resolved.fallback.as_ref().expect("물러섰다는 까닭이 없다");
        assert_eq!(fallback.folder, crate::collapse_home(folder));
        fallback.reason.clone()
    }

    /// 물러서기 첫째 — 폴더는 있는데 `layout.json`이 없거나 읽지 못한다. 까닭이 그것을 말한다.
    #[test]
    fn a_folder_without_a_readable_layout_file_falls_back_to_the_builtin() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("layouts/atelier");
        plant(root.path(), "decisions.md", "# Decisions\n");
        let missing = resolve_layout(root.path());
        let reason = assert_fell_back(&missing, &folder);
        assert!(reason.contains("layout.json") && reason.contains("missing"), "{reason}");

        // 읽지 못함: `layout.json`이 파일이 아니라 폴더다
        std::fs::create_dir(folder.join("layout.json")).unwrap();
        let unreadable = resolve_layout(root.path());
        let reason = assert_fell_back(&unreadable, &folder);
        assert!(reason.contains("layout.json") && !reason.contains("missing"), "{reason}");
    }

    /// 사용자가 둔 것이 있는데 **있는지조차 확인하지 못하면** 없는 것으로 치지 않는다 — 조용히
    /// 내장본을 쓰면 사용자가 고친 레이아웃이 알림 없이 무시된다(결정 15). 대상이 사라진
    /// 심볼릭 링크(dotfiles로 걸어 둔 폴더 따위)로 잰다. 권한으로 재면 root로 도는 CI에서 헛되이
    /// 통과한다.
    #[cfg(unix)]
    #[test]
    fn a_layout_folder_link_to_nowhere_falls_back_instead_of_counting_as_absent() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("layouts")).unwrap();
        let folder = root.path().join("layouts/atelier");
        std::os::unix::fs::symlink(root.path().join("gone"), &folder).unwrap();

        let resolved = resolve_layout(root.path());
        let reason = assert_fell_back(&resolved, &folder);
        assert!(reason.contains("layout.json"), "{reason}");
    }

    /// 물러서기 둘째 — 검증 오류. 까닭은 **첫** 오류와 그 위치다. 사용자가 열어 고칠 자리를 찾게
    /// JSON의 경로로 적는다.
    #[test]
    fn an_invalid_layout_falls_back_naming_its_first_error_and_where() {
        let root = tempfile::tempdir().unwrap();
        plant(
            root.path(),
            "layout.json",
            r#"{ "root": { "children": [
                { "pattern": "a.md", "kind": "file" },
                { "pattern": "b.md", "kind": "fil" },
                { "pattern": "{x}", "kind": "folder" } ] } }"#,
        );
        let resolved = resolve_layout(root.path());
        let reason = assert_fell_back(&resolved, &root.path().join("layouts/atelier"));
        assert!(reason.contains("root.children[1]"), "위치가 없다: {reason}");
        assert!(reason.contains("\"fil\""), "첫 오류가 없다: {reason}");
        assert!(!reason.contains("{x}"), "첫 오류만 적는다: {reason}");
    }

    /// 판정은 **가리키고 디스크에 있는** 템플릿만 담는다. 점 파일은 없는 것이다 — 저장이 원자적으로
    /// 쓰는 동안 점으로 시작하는 임시 파일이 레이아웃 폴더에 잠깐 선다.
    #[test]
    fn the_template_verdict_holds_only_present_templates_and_no_dot_files() {
        let root = tempfile::tempdir().unwrap();
        plant(
            root.path(),
            "layout.json",
            r#"{ "root": { "children": [
                { "pattern": "decisions.md", "kind": "file", "template": "decisions.md" },
                { "pattern": "draft.md", "kind": "file", "template": ".draft.md" },
                { "pattern": "plan.md", "kind": "file", "template": "templates/plan.md" },
                { "pattern": "gone.md", "kind": "file", "template": "gone.md" },
                { "pattern": "docs", "kind": "folder", "children": [
                    { "pattern": "a.md", "kind": "file", "template": "a.md" } ] } ] } }"#,
        );
        for file in ["decisions.md", ".draft.md", "templates/plan.md", "a.md", ".layout.json.tmp", "stray.md"] {
            plant(root.path(), file, "x");
        }
        let resolved = resolve_layout(root.path());
        let present = resolved.templates.unwrap().present;
        let expected: std::collections::BTreeSet<String> =
            ["a.md", "decisions.md", "templates/plan.md"].map(String::from).into();
        assert_eq!(present, expected);
    }

    /// **읽기는 아무것도 쓰지 않는다**(결정 7) — 폴더를 만들어 두면 그 폴더가 내장본을 가리고,
    /// 앱을 켜기만 해도 파일이 생긴다. 깨진 파일도 고치거나 옮기지 않는다.
    ///
    /// 폴더가 없는 길과 있는 길을 둘 다 잰다. 없는 길에서 폴더를 만드는 것(결정 7이 기각한 씨
    /// 뿌리기)이 가장 그럴 법한 어긋남이라, `layouts/`조차 없는 데이터 루트와 `layouts/`만 있는
    /// 데이터 루트를 따로 둔다.
    #[test]
    fn resolving_leaves_the_data_root_as_it_was() {
        let unchanged_by_resolving = |root: &Path| {
            let before = everything_under(root);
            let _ = resolve_layout(root);
            let _ = resolve_layout(root);
            assert_eq!(everything_under(root), before);
        };

        // 폴더가 없는 길 — `layouts/`도 `layouts/atelier/`도 생기면 안 된다
        let bare = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(bare.path().join("works/cart/spec")).unwrap();
        unchanged_by_resolving(bare.path());

        // `layouts/`는 있고 레이아웃 폴더만 없다 — 없는 쪽을 만들면 드러난다
        let half = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(half.path().join("layouts")).unwrap();
        unchanged_by_resolving(half.path());

        // 폴더가 있는 길 — 점 파일도 그대로 둔다
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("works/cart/spec")).unwrap();
        plant(root.path(), "layout.json", &small_layout("mine"));
        plant(root.path(), ".layout.json.tmp", "x");
        unchanged_by_resolving(root.path());

        // 깨진 파일도 고치거나 옮기지 않는다
        let broken = tempfile::tempdir().unwrap();
        plant(broken.path(), "layout.json", "{ not json");
        unchanged_by_resolving(broken.path());
        assert_eq!(
            std::fs::read_to_string(broken.path().join("layouts/atelier/layout.json")).unwrap(),
            "{ not json"
        );
    }
}
