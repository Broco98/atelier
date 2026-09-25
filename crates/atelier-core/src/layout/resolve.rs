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
use super::parse::parse_layout;
use super::render::{Fallback, TemplateVerdict};
use crate::{Error, Mode, Result};

/// 레이아웃 폴더 안의 레이아웃 파일. 템플릿 `.md`가 그 옆에 산다(결정 6).
pub(crate) const LAYOUT_FILE: &str = "layout.json";

/// 쓸 레이아웃이 어디서 왔는가.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutSource {
    /// 코드 내장본. 모드의 폴더가 없거나, 있어도 못 써서 물러섰다.
    Builtin,
    /// 모드의 레이아웃 폴더 — 내장본을 가린다(결정 7).
    Folder(PathBuf),
}

/// resolve의 결과 — render에 그대로 건넬 것들.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
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
    // 폴더가 없으면 그 id는 코드 내장본의 것이다 — 가린 폴더가 없을 뿐, 물러선 것이 아니다
    if !folder.exists() {
        return Ok(Resolved {
            layout: builtin_layout(id),
            source: LayoutSource::Builtin,
            templates: None,
            fallback: None,
        });
    }
    let shown = crate::collapse_home(&folder);
    match read_folder(&folder) {
        Ok(layout) => Ok(Resolved {
            templates: Some(template_verdict(&layout, &folder, shown)),
            layout,
            source: LayoutSource::Folder(folder),
            fallback: None,
        }),
        Err(reason) => Ok(Resolved {
            layout: builtin_layout(mode),
            source: LayoutSource::Builtin,
            templates: None,
            fallback: Some(Fallback { folder: shown, reason }),
        }),
    }
}

/// 폴더의 `layout.json`을 읽는다. 못 쓰면 까닭을 한 줄로 준다 — 안내문 앞에 그대로 실린다.
/// 검증 오류는 **첫 것**과 그 위치만 적는다. 나머지는 설정 페이지가 목록으로 보인다.
fn read_folder(folder: &Path) -> std::result::Result<SpecLayout, String> {
    let text = match std::fs::read_to_string(folder.join(LAYOUT_FILE)) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("{LAYOUT_FILE} is missing"))
        }
        Err(e) => return Err(format!("cannot read {LAYOUT_FILE}: {e}")),
    };
    parse_layout(&text).map_err(|errors| {
        errors.first().map(ToString::to_string).unwrap_or_else(|| "invalid layout".to_string())
    })
}

/// 레이아웃이 가리키는 템플릿 가운데 디스크에 실제로 있는 것. render는 이 판정만 본다.
///
/// **점 파일은 없는 것으로 친다.** 저장은 파일마다 점으로 시작하는 임시 파일에 쓰고 이름을 바꾼다
/// — 그 사이에 읽혀도 반쯤 쓴 파일을 템플릿으로 건네지 않는다.
fn template_verdict(layout: &SpecLayout, folder: &Path, shown: String) -> TemplateVerdict {
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
