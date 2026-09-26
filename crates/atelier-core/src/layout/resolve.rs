//! resolve — 이번 호출에 쓸 레이아웃을 정하는 입구.
//!
//! 순서는 `work 지정 → 모드의 폴더(<데이터 루트>/layouts/<id>/) → 코드 내장본`이다(결정 3을 결정
//! 25가 좁혔다). 폴더를 못 쓰면 그 모드의 내장본으로 물러서고 까닭을 함께 준다(결정 15).
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
use crate::{Error, Mode, Result};

/// 쓸 레이아웃이 어디서 왔는가.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutSource {
    /// 코드 내장본. 모드의 폴더가 없거나, 있어도 못 써서 물러섰다.
    Builtin,
    /// 모드의 레이아웃 폴더 — 내장본을 가린다(결정 7).
    Folder(PathBuf),
}

/// resolve의 결과 — render와 classify에 그대로 건넬 것들.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    /// `layout`이 누구의 것인가 — 그 레이아웃의 id(모드 이름). work 지정의 폴더가 있으면 그 id이고,
    /// 물러섰으면 도착한 내장본의 모드다. spec 트리가 이 값을 그대로 싣는다.
    pub id: Mode,
    pub layout: SpecLayout,
    pub source: LayoutSource,
    /// 파일에서 온 레이아웃일 때만 있다.
    pub templates: Option<TemplateVerdict>,
    /// 물러섰다면 그 까닭.
    pub fallback: Option<Fallback>,
}

/// 레이아웃 id를 읽는다. **id는 모드 이름 둘뿐이다**(결정 25) — 커널의 모드 파싱을 그대로 쓰므로
/// 두 이름만 받는 것이 따라온다. id를 받는 모든 입구가 이 한 자리를 지난다: IPC로 온 `"../.."`이
/// 데이터 루트 밖을 읽거나 지우면 안 된다. 기존 slug 검사는 이 용도에 너무 느슨하다.
pub(crate) fn layout_id(id: &str) -> Result<Mode> {
    id.parse()
        .map_err(|_| Error::Validation(format!("invalid spec layout id '{id}' (atelier | maison)")))
}

/// id가 가리키는 레이아웃 폴더 — `<데이터 루트>/layouts/<id>/`.
pub(crate) fn layout_folder(data_root: &Path, id: Mode) -> PathBuf {
    crate::paths::layouts_in(data_root).join(id.as_str())
}

/// `work_layout`은 work 지정 id다 — 이번에는 아무도 넘기지 않는 이음매다(결정 16). 테스트가 직접
/// 넘겨 잰다. 모드 이름이 아니면 거절한다.
///
/// work 지정이 있으면 그 id만 본다. 그 폴더가 깨졌으면 **모드의 폴더를 거치지 않고** 코드
/// 내장본으로 간다 — 모드의 폴더로 가면 그 work에 아무도 고르지 않은 레이아웃이 조용히 선다.
/// 물러서기의 도착지는 늘 `mode`의 코드 내장본이다(결정 7의 「돌아갈 곳」은 코드 안의 것이다).
///
/// `settings.json`은 보지 않는다(결정 25) — 레이아웃은 모드 이름으로 바로 찾는다.
pub fn resolve_layout(data_root: &Path, mode: Mode, work_layout: Option<&str>) -> Result<Resolved> {
    let id = match work_layout {
        Some(id) => layout_id(id)?,
        None => mode,
    };
    let folder = layout_folder(data_root, id);
    let shown = crate::collapse_home(&folder);
    let reason = match folder_present(&folder) {
        // 폴더가 없으면 그 id는 코드 내장본의 것이다 — 가린 폴더가 없을 뿐, 물러선 것이 아니다
        Ok(false) => {
            return Ok(Resolved {
                id,
                layout: builtin_layout(id),
                source: LayoutSource::Builtin,
                templates: None,
                fallback: None,
            });
        }
        Err(e) => fallback_reason(&[folder_error(&e)]),
        Ok(true) => match read_layout_file(&folder) {
            Ok(layout) => {
                return Ok(Resolved {
                    id,
                    templates: Some(template_verdict(&layout, &folder, shown)),
                    layout,
                    source: LayoutSource::Folder(folder),
                    fallback: None,
                });
            }
            Err(unreadable) => fallback_reason(&unreadable.errors),
        },
    };
    Ok(Resolved {
        id: mode,
        layout: builtin_layout(mode),
        source: LayoutSource::Builtin,
        templates: None,
        fallback: Some(Fallback { folder: shown, reason }),
    })
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
    let mut present = BTreeSet::new();
    let mut stack = vec![&layout.root];
    while let Some(entry) = stack.pop() {
        if let Some(template) = &entry.template {
            let hidden = Path::new(template)
                .components()
                .any(|part| part.as_os_str().to_string_lossy().starts_with('.'));
            if !hidden && folder.join(template).is_file() {
                present.insert(template.clone());
            }
        }
        stack.extend(&entry.children);
    }
    TemplateVerdict { present, folder: shown }
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

    /// 레이아웃 폴더가 없으면 **그 모드의** 내장본이다. 템플릿 판정도 물러서기도 없다 — 내장본은
    /// 디스크에 없고, 물러선 것이 아니라 처음부터 거기 있다.
    #[test]
    fn with_no_layout_folder_each_mode_gets_its_own_builtin() {
        let root = tempfile::tempdir().unwrap();
        for mode in [Mode::Atelier, Mode::Maison] {
            let resolved = resolve_layout(root.path(), mode, None).unwrap();
            assert_eq!(resolved.layout, builtin_layout(mode), "{mode}");
            assert_eq!(resolved.source, LayoutSource::Builtin, "{mode}");
            assert_eq!(resolved.templates, None, "{mode}");
            assert_eq!(resolved.fallback, None, "{mode}");
        }
    }

    /// 앱의 감시자는 기동할 때 `layouts/`를 만든다(spec 레이아웃 결정 22 — 다른 감시와 같다). **그 빈
    /// 폴더는 아무것도 가리지 않는다**: resolve는 `<id>/`만 보므로 두 모드 모두 내장본 그대로이고, 물러선
    /// 것도 아니다. 설정의 상태도 「고침」이 안 된다. 빈 `layouts/`가 무엇이든 가리면, 앱을 한 번 띄운
    /// 것만으로 에이전트가 받는 안내문과 설정의 행이 바뀐다.
    #[test]
    fn the_empty_layouts_folder_the_watcher_makes_hides_nothing() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("layouts")).unwrap();
        for mode in [Mode::Atelier, Mode::Maison] {
            let resolved = resolve_layout(root.path(), mode, None).unwrap();
            assert_eq!(resolved.layout, builtin_layout(mode), "{mode}");
            assert_eq!(resolved.source, LayoutSource::Builtin, "{mode}");
            assert_eq!(resolved.fallback, None, "{mode}");
        }
        for state in crate::layout_states(root.path()) {
            assert!(!state.edited, "{}: 빈 layouts/가 고친 것으로 읽힌다", state.id);
        }
    }

    /// **감시자가 보는 자리가 resolve가 읽는 레이아웃 폴더들을 품는다.** 둘이 갈리면 에이전트가
    /// 저장해도 종이 안 울려, 설정과 spec 패널 탭이 다시 띄울 때까지 옛것을 든다.
    #[test]
    fn every_layout_folder_sits_in_the_folder_the_app_watches() {
        let watched = crate::layouts_dir();
        for mode in [Mode::Atelier, Mode::Maison] {
            let folder = layout_folder(&crate::data_root(), mode);
            assert_eq!(folder.parent(), Some(watched.as_path()), "{mode}의 레이아웃 폴더가 감시 밖이다");
        }
    }

    /// `<데이터 루트>/layouts/<id>/`에 파일 하나를 심는다. 폴더가 없으면 만든다.
    fn plant(root: &Path, id: &str, file: &str, content: &str) {
        let folder = root.join("layouts").join(id);
        let path = folder.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    /// 템플릿 하나를 가리키는 작은 레이아웃. 설명으로 어느 폴더의 것인지 가른다.
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

    /// 모드의 폴더가 있으면 **그 id는 폴더의 것이다** — 내장본을 가린다(결정 7). 폴더는 모드마다
    /// 따로라 다른 모드는 여전히 제 내장본이다.
    ///
    /// 파일에서 온 레이아웃이라 템플릿 판정이 붙는다. 판정의 폴더는 홈을 `~`로 줄인 경로다 — 임시
    /// 폴더는 홈 밖이라 줄지 않은 채다.
    #[test]
    fn the_mode_folder_hides_the_builtin() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", &small_layout("mine"));
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");

        let resolved = resolve_layout(root.path(), Mode::Atelier, None).unwrap();
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

        let maison = resolve_layout(root.path(), Mode::Maison, None).unwrap();
        assert_eq!(maison.layout, builtin_layout(Mode::Maison));
        assert_eq!(maison.source, LayoutSource::Builtin);
    }

    /// work 지정 인자가 모드의 폴더를 이긴다 — 순서는 `work 지정 → 모드의 폴더 → 내장`이다.
    #[test]
    fn the_work_layout_beats_the_mode_folder() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", &small_layout("atelier's"));
        plant(root.path(), "maison", "layout.json", &small_layout("maison's"));

        let resolved = resolve_layout(root.path(), Mode::Atelier, Some("maison")).unwrap();
        assert_eq!(resolved.layout, small_model("maison's"));
        assert_eq!(resolved.source, LayoutSource::Folder(root.path().join("layouts/maison")));
    }

    /// 물러선 결과는 늘 같은 모양이다 — **그 모드의 코드 내장본**, 판정 없음, 까닭 하나.
    fn assert_fell_back(resolved: &Resolved, mode: Mode, folder: &Path) -> String {
        assert_eq!(resolved.layout, builtin_layout(mode));
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
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");
        let missing = resolve_layout(root.path(), Mode::Atelier, None).unwrap();
        let reason = assert_fell_back(&missing, Mode::Atelier, &folder);
        assert!(reason.contains("layout.json") && reason.contains("missing"), "{reason}");

        // 읽지 못함: `layout.json`이 파일이 아니라 폴더다
        std::fs::create_dir(folder.join("layout.json")).unwrap();
        let unreadable = resolve_layout(root.path(), Mode::Atelier, None).unwrap();
        let reason = assert_fell_back(&unreadable, Mode::Atelier, &folder);
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

        let resolved = resolve_layout(root.path(), Mode::Atelier, None).unwrap();
        let reason = assert_fell_back(&resolved, Mode::Atelier, &folder);
        assert!(reason.contains("layout.json"), "{reason}");
    }

    /// 물러서기 둘째 — 검증 오류. 까닭은 **첫** 오류와 그 위치다. 사용자가 열어 고칠 자리를 찾게
    /// JSON의 경로로 적는다.
    #[test]
    fn an_invalid_layout_falls_back_naming_its_first_error_and_where() {
        let root = tempfile::tempdir().unwrap();
        plant(
            root.path(),
            "maison",
            "layout.json",
            r#"{ "root": { "children": [
                { "pattern": "a.md", "kind": "file" },
                { "pattern": "b.md", "kind": "fil" },
                { "pattern": "{x}", "kind": "folder" } ] } }"#,
        );
        let resolved = resolve_layout(root.path(), Mode::Maison, None).unwrap();
        let reason =
            assert_fell_back(&resolved, Mode::Maison, &root.path().join("layouts/maison"));
        assert!(reason.contains("root.children[1]"), "위치가 없다: {reason}");
        assert!(reason.contains("\"fil\""), "첫 오류가 없다: {reason}");
        assert!(!reason.contains("{x}"), "첫 오류만 적는다: {reason}");
    }

    /// 물러서기 셋째 — work 지정이 걸리면 **모드의 폴더를 거치지 않고** 코드 내장본으로 간다.
    /// 모드의 폴더로 가면 사용자가 그 work에 고르지 않은 레이아웃이 조용히 선다.
    #[test]
    fn a_broken_work_layout_skips_the_mode_folder_on_its_way_to_the_builtin() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", &small_layout("atelier's"));
        plant(root.path(), "maison", "layout.json", "{ not json");

        let resolved = resolve_layout(root.path(), Mode::Atelier, Some("maison")).unwrap();
        let reason =
            assert_fell_back(&resolved, Mode::Atelier, &root.path().join("layouts/maison"));
        assert!(reason.contains("JSON"), "{reason}");
    }

    /// id는 모드 이름 둘뿐이다(결정 25). IPC로 온 `"../.."`이 데이터 루트 밖을 읽으면 안 된다 —
    /// 대소문자도 봐주지 않는다.
    #[test]
    fn a_work_layout_that_is_not_a_mode_name_is_refused() {
        let root = tempfile::tempdir().unwrap();
        for id in ["../..", "..", "", "Atelier", "works", "atelier/", "maison/../atelier"] {
            let refused = resolve_layout(root.path(), Mode::Atelier, Some(id));
            assert!(refused.is_err(), "{id:?}가 통과했다: {refused:?}");
        }
    }

    /// 판정은 **가리키고 디스크에 있는** 템플릿만 담는다. 점 파일은 없는 것이다 — 저장이 원자적으로
    /// 쓰는 동안 점으로 시작하는 임시 파일이 레이아웃 폴더에 잠깐 선다.
    #[test]
    fn the_template_verdict_holds_only_present_templates_and_no_dot_files() {
        let root = tempfile::tempdir().unwrap();
        plant(
            root.path(),
            "atelier",
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
            plant(root.path(), "atelier", file, "x");
        }
        let resolved = resolve_layout(root.path(), Mode::Atelier, None).unwrap();
        let present = resolved.templates.unwrap().present;
        let expected: std::collections::BTreeSet<String> =
            ["a.md", "decisions.md", "templates/plan.md"].map(String::from).into();
        assert_eq!(present, expected);
    }

    /// **읽기는 아무것도 쓰지 않는다**(결정 7) — 폴더를 만들어 두면 그 폴더가 내장본을 가리고,
    /// 앱을 켜기만 해도 파일이 생긴다. 깨진 파일도 고치거나 옮기지 않는다.
    ///
    /// 폴더가 없는 길과 있는 길을 둘 다 잰다. 없는 길에서 폴더를 만드는 것(결정 7이 기각한 씨
    /// 뿌리기)이 가장 그럴 법한 어긋남이라, `layouts/`조차 없는 데이터 루트와 한 모드의 폴더만
    /// 있는 데이터 루트를 따로 둔다.
    #[test]
    fn resolving_leaves_the_data_root_as_it_was() {
        // 모드마다, work 지정마다(없음 · 모드 이름 둘 · 거절될 id) 한 번씩 읽고 목록을 견준다
        let unchanged_by_resolving = |root: &Path| {
            let before = everything_under(root);
            for mode in [Mode::Atelier, Mode::Maison] {
                for work in [None, Some("atelier"), Some("maison"), Some("../..")] {
                    let _ = resolve_layout(root, mode, work);
                }
            }
            assert_eq!(everything_under(root), before);
        };

        // 폴더가 없는 길 — `layouts/`도 `layouts/<id>/`도 생기면 안 된다
        let bare = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(bare.path().join("works/cart/spec")).unwrap();
        unchanged_by_resolving(bare.path());

        // `layouts/`는 있고 maison의 폴더만 없다 — 없는 쪽을 만들면 드러난다
        let half = tempfile::tempdir().unwrap();
        plant(half.path(), "atelier", "layout.json", &small_layout("mine"));
        unchanged_by_resolving(half.path());

        // 폴더가 있는 길 — 점 파일도 깨진 파일도 그대로 둔다
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("works/cart/spec")).unwrap();
        plant(root.path(), "atelier", "layout.json", &small_layout("mine"));
        plant(root.path(), "atelier", ".layout.json.tmp", "x");
        plant(root.path(), "maison", "layout.json", "{ not json");
        unchanged_by_resolving(root.path());
        assert_eq!(
            std::fs::read_to_string(root.path().join("layouts/maison/layout.json")).unwrap(),
            "{ not json"
        );
    }
}
