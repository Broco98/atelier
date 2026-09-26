//! 레이아웃 저장소 — 모드의 레이아웃을 읽고, 저장하고, 기본값으로 되돌린다.
//!
//! 에이전트의 MCP 도구와 앱의 편집기가 같은 입구를 부른다(결정 20). 규칙이 여기 한 벌이라 두
//! 표면은 어댑터로만 남는다. 되돌리기는 앱의 설정 페이지만 부른다 — 에이전트는 고치기만 한다(결정 21).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use super::builtin::builtin_layout;
use super::model::{LayoutEntry, SpecLayout};
use super::parse::{
    parse_layout_value, serialize_layout, serialize_layout_value, LayoutError, LAYOUT_FILE,
};
use super::render::{render_layout, render_with_lines, EntryLines, Rendered};
use super::resolve::{
    folder_error, folder_present, layout_folder, layout_id, read_layout_file, template_verdict,
    template_verdict_with, Unreadable,
};
use crate::atomic::write_atomically;
use crate::{Mode, Result};

/// 레이아웃 하나를 읽은 것.
#[derive(Debug, Clone, PartialEq)]
pub struct LayoutRead {
    pub id: Mode,
    /// 레이아웃 폴더 — 홈은 `~`로 줄여 둔다. 폴더가 없어도 그 자리를 준다: 처음 저장하면 거기 선다.
    pub folder: String,
    /// 고침 여부 — 내장본을 가린 폴더가 있는가. 깨진 폴더도 가린 것이다.
    pub edited: bool,
    pub content: LayoutContent,
}

/// 읽은 레이아웃의 내용 — 읽을 수 있었는가, 깨졌는가.
#[derive(Debug, Clone, PartialEq)]
pub enum LayoutContent {
    Readable {
        layout: SpecLayout,
        /// 가리키고 디스크에 있으며 읽을 수 있는 템플릿의 본문. 키는 레이아웃 폴더 기준 경로다.
        templates: BTreeMap<String, String>,
        /// 이 레이아웃의 안내문과 경고(누락 템플릿, 읽을 수 없는 템플릿).
        rendered: Rendered,
    },
    Broken {
        errors: Vec<LayoutError>,
        raw: Option<String>,
    },
}

/// 저장의 결과 — 썼는가, 검증이 거절했는가. 거절은 오류가 아니라 **데이터**다: 편집기는 그 위치의
/// 항목 아래에 오류를 세우고, 에이전트는 고쳐 다시 부른다. 쓰다가 실패한 것(IO)만 `Err`다.
#[derive(Debug, Clone, PartialEq)]
pub enum SaveOutcome {
    /// 썼다 — 저장한 레이아웃의 안내문과 경고.
    Saved(Rendered),
    /// 검증이 거절했다. 아무것도 쓰지 않았다.
    Refused(Vec<LayoutError>),
}

/// 미리보기의 답 — 안내문과 그 안의 항목의 줄, 검증 오류, 경고(`render_spec_layout`, 티켓 14). 앱은 JSON
/// `{ text, lines: [{ path, start, count }], errors: [{ path, message }], warnings }`로 받는다. 오류의 모양은
/// 저장의 것과 같다.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct LayoutPreview {
    /// 이 초안을 저장하면 에이전트가 받을 안내문. 검증 오류가 있으면 없다(결정 28).
    pub text: Option<String>,
    /// 그 안내문에서 항목마다 차지한 줄 — 팝업이 고른 항목의 줄을 칠한다. 글이 없으면 비었다.
    pub lines: Vec<EntryLines>,
    pub errors: Vec<LayoutError>,
    /// render의 경고 — 저장해도 실리지 않을 템플릿(점 파일).
    pub warnings: Vec<String>,
}

/// **읽기의 모양은 이 한 벌이다** — 앱의 `read_spec_layout`(Tauri 명령과 L4 다리)도, 에이전트의
/// `atelier_get_spec_layout`도 이 직렬화를 그대로 싣는다(결정 20). 두 표면이 JSON을 따로 짜면 키 하나를
/// 고치는 날 앱과 에이전트가 조용히 갈린다.
///
/// 읽을 수 있으면 `{ id, folder, edited, layout, templates, warnings }`이고, `layout`은 디스크 형식
/// 그대로다(`serialize_layout_value` — 모르는 키까지). 편집기와 에이전트는 그것을 고쳐 그대로 저장에
/// 돌려준다. 깨졌으면 `{ id, folder, edited, errors, raw }`다.
impl serde::Serialize for LayoutRead {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("id", &self.id)?;
        map.serialize_entry("folder", &self.folder)?;
        map.serialize_entry("edited", &self.edited)?;
        match &self.content {
            LayoutContent::Readable { layout, templates, rendered } => {
                map.serialize_entry("layout", &serialize_layout_value(layout))?;
                map.serialize_entry("templates", templates)?;
                map.serialize_entry("warnings", &rendered.warnings)?;
            }
            LayoutContent::Broken { errors, raw } => {
                map.serialize_entry("errors", errors)?;
                map.serialize_entry("raw", raw)?;
            }
        }
        map.end()
    }
}

/// **앱이 받는 저장의 답**(`write_spec_layout`) — `{ errors: [{ path, message }] }` 하나다. 검증이
/// 거절하면 위치가 붙은 오류가 **데이터로** 가고(명령의 거절은 문자열뿐이라, 위치를 글에 싸면 앱이
/// 다시 풀어야 한다), 쓰면 빈 목록이다. 쓰다가 실패한 것(IO)은 여기 오지 않는다: 명령의 거절이다.
impl serde::Serialize for SaveOutcome {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let errors: &[LayoutError] = match self {
            SaveOutcome::Saved(_) => &[],
            SaveOutcome::Refused(errors) => errors,
        };
        let mut map = serializer.serialize_map(Some(1))?;
        map.serialize_entry("errors", errors)?;
        map.end()
    }
}

/// 모드의 레이아웃을 읽는다. **아무것도 쓰지 않는다** — resolve와 같은 규칙이다(결정 7).
///
/// 폴더가 없으면 코드 내장본이다. 폴더가 있으면 그 `layout.json`이고, 가리키는 템플릿 가운데
/// 디스크에 있는 것의 본문을 함께 준다 — 있는데 읽을 수 없는 것은 본문 없이 경고다. 깨졌으면 오류
/// 전부와 원문을 준다 — 에이전트와 편집기가 그것을 고쳐 다시 저장한다(결정 20).
///
/// id는 모드 이름 둘만 받는다. `"../.."`이 데이터 루트 밖을 읽으면 안 된다.
pub fn read_layout(data_root: &Path, id: &str) -> Result<LayoutRead> {
    let id = layout_id(id)?;
    let folder = layout_folder(data_root, id);
    let shown = crate::collapse_home(&folder);
    let content = match folder_present(&folder) {
        Ok(false) => {
            let layout = builtin_layout(id);
            let rendered = render_layout(&layout, None, None);
            return Ok(LayoutRead {
                id,
                folder: shown,
                edited: false,
                content: LayoutContent::Readable { layout, templates: BTreeMap::new(), rendered },
            });
        }
        Err(e) => LayoutContent::Broken { errors: vec![folder_error(&e)], raw: None },
        Ok(true) => match read_layout_file(&folder) {
            Err(Unreadable { errors, raw }) => LayoutContent::Broken { errors, raw },
            Ok(layout) => {
                let verdict = template_verdict(&layout, &folder, shown.clone());
                let mut rendered = render_layout(&layout, Some(&verdict), None);
                // 읽을 수 없는 템플릿(UTF-8이 아님, 권한)은 본문 없이 경고다 — 읽기 전체가 실패하면
                // 레이아웃을 읽고 고쳐 저장하는 길이 막힌다. 대체 문자로 채우지 않는다: 받은 본문을
                // 저장에 돌려주면 원래 바이트가 조용히 바뀐다. 판정과 안내문은 그대로라 atelier_get_work가
                // 주는 `Template:` 줄과 같다.
                let mut templates = BTreeMap::new();
                for path in &verdict.present {
                    match std::fs::read_to_string(folder.join(path)) {
                        Ok(body) => {
                            templates.insert(path.clone(), body);
                        }
                        Err(e) => rendered
                            .warnings
                            .push(format!("cannot read template {shown}/{path}: {e}")),
                    }
                }
                LayoutContent::Readable { layout, templates, rendered }
            }
        },
    };
    Ok(LayoutRead { id, folder: shown, edited: true, content })
}

/// 모드의 레이아웃을 저장한다. 처음 저장하면 그 모드의 내장본을 가리는 폴더가 생긴다(결정 7).
///
/// `layout`은 디스크 형식의 JSON 값이다 — 글이 아니라 값으로 받아야 모르는 키가 산다.
/// `templates`는 템플릿 본문이다(레이아웃 폴더 기준 경로 → 본문). **넘기지 않은 템플릿은 디스크의
/// 지금 본문을 그대로 둔다** — 에이전트는 바꾸는 것만 넘기고, 편집기는 늘 전부 넘긴다.
///
/// - **먼저 검증한다. 실패하면 아무것도 쓰지 않는다.** 읽기(parse)의 검증에 더해, 가리키는
///   템플릿은 인자나 디스크에 본문이 있어야 하고, 넘긴 본문은 어느 파일 항목이 가리키는 것이어야
///   한다.
/// - 쓰는 순서는 템플릿 → `layout.json` → 빠진 템플릿 지우기다. 파일마다 원자적으로 쓴다(점으로
///   시작하는 임시 파일 → rename) — resolve도 감시도 점 파일을 보지 않는다.
/// - 레이아웃이 모르는 파일은 건드리지 않는다.
///
/// id는 모드 이름 둘만 받는다 — 어긋나면 디스크를 보기 전에 `Err`다.
pub fn save_layout(
    data_root: &Path,
    id: &str,
    layout: serde_json::Value,
    templates: &BTreeMap<String, String>,
) -> Result<SaveOutcome> {
    let id = layout_id(id)?;
    let folder = layout_folder(data_root, id);
    let layout = match validate(layout, &folder, templates) {
        Ok(layout) => layout,
        Err(errors) => return Ok(SaveOutcome::Refused(errors)),
    };
    // 앞 레이아웃이 가리키던 템플릿. **읽을 수 없으면(없거나 깨졌으면) 없는 것으로 친다** — 깨진
    // 레이아웃을 고쳐 저장하는 길에서 폴더의 `.md`를 하나도 지우지 않는다. 무엇이 템플릿이었는지
    // 모르는 채로 지우면 사람이 둔 파일이 사라진다.
    let previous = match folder_present(&folder) {
        Ok(true) => read_layout_file(&folder).map(|old| pointed_templates(&old)).unwrap_or_default(),
        _ => BTreeSet::new(),
    };
    for (path, body) in templates {
        let path = Path::new(path);
        let dir = match path.parent() {
            Some(parent) => folder.join(parent),
            None => folder.clone(),
        };
        let name = path.file_name().expect("a template path names a file").to_string_lossy();
        write_atomically(&dir, &name, body)?;
    }
    write_atomically(&folder, LAYOUT_FILE, &serialize_layout(&layout))?;
    // 빠진 템플릿은 새 `layout.json`이 선 **뒤에** 지운다 — 먼저 지우면 실패한 저장이 앞 레이아웃이
    // 가리키는 템플릿을 잃게 한다. 비게 된 하위 폴더는 남긴다: 폴더는 사람이 만들었을 수 있다.
    // 새 레이아웃이 쥐는 파일과 같은 파일이면 다르게 적혔어도 지우지 않는다(`Held`).
    let pointed = pointed_templates(&layout);
    let held = Held::of(&folder, pointed.iter().map(String::as_str).chain([LAYOUT_FILE]));
    for dropped in previous.difference(&pointed) {
        if held.holds(&folder, dropped) {
            continue;
        }
        match std::fs::remove_file(folder.join(dropped)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
    }
    let verdict = template_verdict(&layout, &folder, crate::collapse_home(&folder));
    Ok(SaveOutcome::Saved(render_layout(&layout, Some(&verdict), None)))
}

/// **저장하지 않은 초안의 미리보기**(티켓 14) — 편집기가 초안이 바뀔 때마다 부른다(`render_spec_layout`).
///
/// 「저장하면 받을 것」이다. 그 초안을 저장한 뒤 에이전트가 받는 안내문과 글자까지 같다(스토리 29).
/// - **검증은 저장과 같은 한 벌이다**(`validate`). 가리키는 템플릿이 초안 본문에도 디스크에도 없으면 그
///   항목 자리의 오류다. 오류가 있으면 **안내문이 없다**(결정 28) — 저장이 잠기므로 「저장하면 받을 글」이 없다.
/// - 템플릿 판정은 「초안에 본문이 있거나 디스크에 있는 경로」다(`backed`). 저장하면 있을 것이기 때문이다.
/// - 물러서기 줄은 싣지 않는다. 지금 폴더가 깨졌어도 저장하면 이 초안이 그 자리를 고친다.
/// - **디스크에 아무것도 쓰지 않는다.**
///
/// 규칙이 Tauri 명령 안에 살면 L4 다리가 같은 규칙을 한 벌 더 가져야 한다. 그래서 여기 엔진에 둔다.
/// id는 모드 이름 둘만 받는다 — 어긋나면 디스크를 보기 전에 `Err`다.
pub fn preview_layout(
    data_root: &Path,
    id: &str,
    layout: serde_json::Value,
    templates: &BTreeMap<String, String>,
) -> Result<LayoutPreview> {
    let id = layout_id(id)?;
    let folder = layout_folder(data_root, id);
    let layout = match validate(layout, &folder, templates) {
        Ok(layout) => layout,
        Err(errors) => {
            return Ok(LayoutPreview { text: None, lines: Vec::new(), errors, warnings: Vec::new() })
        }
    };
    let verdict = template_verdict_with(&layout, crate::collapse_home(&folder), |template| {
        backed(template, &folder, templates)
    });
    let (rendered, lines) = render_with_lines(&layout, Some(&verdict), None);
    Ok(LayoutPreview {
        text: Some(rendered.text),
        lines,
        errors: Vec::new(),
        warnings: rendered.warnings,
    })
}

/// 모드의 레이아웃을 **기본값으로 되돌린다** — 그 모드의 레이아웃 폴더를 지운다(결정 7). 그 뒤로는
/// 코드 내장본이 그 id를 받는다. 템플릿도 레이아웃이 모르는 파일도 폴더째 사라진다 — 그래서 설정의
/// 확인 창이 그 수를 미리 적는다(`LayoutState`).
///
/// **늘 된다.** 깨진 폴더도 지운다 — 앱이 **스스로** 깨진 파일을 고치거나 지우지 않을 뿐이고, 이것은
/// 사람이 확인 창에서 고른 일이다. 에이전트에게는 이 길이 없다(결정 21). 폴더가 없으면 할 일이 없다.
///
/// 그 자리에 무엇이 있든 **그것 자신만** 지운다 — 폴더면 폴더째, 파일이나 링크면 그 하나다. 링크를
/// 따라가 가리키는 곳을 지우지 않는다. id는 모드 이름 둘만 받는다: `"../.."`이 데이터 루트를 지우면 안 된다.
pub fn revert_layout(data_root: &Path, id: &str) -> Result<()> {
    let id = layout_id(id)?;
    let folder = layout_folder(data_root, id);
    let removed = match std::fs::symlink_metadata(&folder) {
        Ok(meta) if meta.is_dir() => std::fs::remove_dir_all(&folder),
        Ok(_) => std::fs::remove_file(&folder),
        Err(e) => Err(e),
    };
    match removed {
        // 없으면 이미 기본값이다 — 두 번 눌러도, 그사이 손으로 지웠어도 같은 끝이다
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

/// 새 레이아웃이 쥐는 파일 — 가리키는 템플릿과 레이아웃 파일 자신. 빠진 템플릿은 이것과 **같은
/// 파일이 아닐 때만** 지운다.
///
/// **어느 파일인지는 글자가 아니라 파일 시스템이 정한다.** macOS의 기본 파일 시스템에서 `ADR.md`와
/// `adr.md`는 한 파일이고, 어디서든 `sub//x.md`와 `sub/x.md`가 그렇다. 경로를 글자로 견주면
/// 템플릿 경로의 대소문자만 바꾼 저장이 새 레이아웃이 가리키는 본문을 지운다. 틀리더라도 남기는
/// 쪽으로 틀린다 — 남은 파일 하나는 해가 없지만, 산 템플릿을 지우면 사람이 쓴 본문이 사라진다.
///
/// 유닉스에서는 파일의 정체(장치와 inode)로 견준다. 그 밖에서는 정체를 얻을 안정된 길이 없어, 경로
/// 조각마다 NFC로 맞추고 대소문자를 접은 이름으로 견준다.
///
/// 상태(`states.rs`)도 이것으로 「그 밖의 파일」을 가른다 — 템플릿을 글자로 빼면 다르게 적힌 템플릿이
/// 그 밖의 파일로 한 번 더 세어진다.
pub(super) struct Held {
    #[cfg(unix)]
    ids: BTreeSet<(u64, u64)>,
    #[cfg(not(unix))]
    names: BTreeSet<Vec<String>>,
}

#[cfg(unix)]
impl Held {
    pub(super) fn of<'a>(folder: &Path, paths: impl IntoIterator<Item = &'a str>) -> Self {
        use std::os::unix::fs::MetadataExt;
        let ids = paths
            .into_iter()
            .filter_map(|path| std::fs::metadata(folder.join(path)).ok())
            .map(|meta| (meta.dev(), meta.ino()))
            .collect();
        Self { ids }
    }

    /// 지울 경로가 쥔 파일인가. 링크는 따라가지 않는다 — 지우는 것은 링크 자신이다.
    pub(super) fn holds(&self, folder: &Path, path: &str) -> bool {
        use std::os::unix::fs::MetadataExt;
        std::fs::symlink_metadata(folder.join(path))
            .is_ok_and(|meta| self.ids.contains(&(meta.dev(), meta.ino())))
    }

    /// 쥔 파일의 수 — 적기가 아니라 파일로 센다. 디스크에 없는 경로는 쥐지 않았으니 세지 않는다.
    pub(super) fn len(&self) -> usize {
        self.ids.len()
    }
}

#[cfg(not(unix))]
impl Held {
    pub(super) fn of<'a>(_folder: &Path, paths: impl IntoIterator<Item = &'a str>) -> Self {
        Self { names: paths.into_iter().map(folded_parts).collect() }
    }

    pub(super) fn holds(&self, _folder: &Path, path: &str) -> bool {
        self.names.contains(&folded_parts(path))
    }

    /// 쥔 파일의 수 — 접은 이름으로 센다.
    pub(super) fn len(&self) -> usize {
        self.names.len()
    }
}

/// 경로 조각마다 NFC로 맞추고 대소문자를 접은 이름 — 유닉스 밖에서 `Held`가 견주는 모양이다.
#[cfg(not(unix))]
fn folded_parts(path: &str) -> Vec<String> {
    let nfc = icu_normalizer::ComposingNormalizerBorrowed::new_nfc();
    Path::new(path)
        .components()
        .map(|part| super::parse::folded(&nfc.normalize(&part.as_os_str().to_string_lossy())))
        .collect()
}

/// 저장의 검증 — 읽기(parse)의 검증에 더해, 가리키는 템플릿은 인자나 디스크에 본문이 있어야 하고, 넘긴
/// 본문은 어느 파일 항목이 가리키는 것이어야 한다. **저장과 미리보기가 이 한 벌을 지난다** — 둘이 갈리면
/// 미리보기가 풀어 준 저장을 저장이 거절하거나, 잠근 저장이 사실은 되는 것이 된다.
fn validate(
    layout: serde_json::Value,
    folder: &Path,
    templates: &BTreeMap<String, String>,
) -> std::result::Result<SpecLayout, Vec<LayoutError>> {
    let layout = parse_layout_value(layout)?;
    let mut errors = unbacked_templates(&layout, folder, templates);
    errors.extend(stray_bodies(&layout, templates));
    if errors.is_empty() {
        Ok(layout)
    } else {
        Err(errors)
    }
}

/// 가리키는데 인자에도 디스크에도 본문이 없는 템플릿 — 항목마다 위치가 붙은 오류다. 문서 순서
/// (깊이 우선)로 쌓는다. 그대로 저장하면 그 `Template:` 줄이 빠진 채 에이전트에게 간다.
fn unbacked_templates(
    layout: &SpecLayout,
    folder: &Path,
    templates: &BTreeMap<String, String>,
) -> Vec<LayoutError> {
    let mut errors = Vec::new();
    walk(&layout.root, &mut Vec::new(), &mut |entry, path| {
        if let Some(template) = &entry.template {
            if !backed(template, folder, templates) {
                errors.push(LayoutError::at(
                    path,
                    format!("template {template:?} is neither given nor in the layout folder"),
                ));
            }
        }
    });
    errors
}

/// 저장하면 레이아웃 폴더에 있을 템플릿인가 — 인자(초안)에 본문이 있거나 디스크에 있다. 저장의 검증
/// (`unbacked_templates`)과 미리보기의 템플릿 판정(`preview_layout`)이 이 한 벌을 본다.
fn backed(template: &str, folder: &Path, templates: &BTreeMap<String, String>) -> bool {
    templates.contains_key(template) || folder.join(template).is_file()
}

/// 건넨 본문 가운데 **어느 파일 항목도 가리키지 않는 것** — 문서 전체의 오류다(자리가 없다).
///
/// 레이아웃 폴더 밖을 가리키는 경로는 그 까닭을 따로 적는다. 가리키지 않는 본문을 쓰지 않는 것은
/// 그 자리에 있을지 모르는 파일이 레이아웃이 모르는 파일이기 때문이다 — 저장은 그런 파일을
/// 건드리지 않는다. 경로 오타(`adrs.md`)도 여기서 드러난다.
fn stray_bodies(layout: &SpecLayout, templates: &BTreeMap<String, String>) -> Vec<LayoutError> {
    let pointed = pointed_templates(layout);
    templates
        .keys()
        .filter(|path| !pointed.contains(*path))
        .map(|path| {
            LayoutError::document(if crate::works::safe_rel(path).is_err() {
                format!("template path {path:?} in `templates` must be inside the layout folder")
            } else {
                format!("no file entry points to template {path:?} in `templates`")
            })
        })
        .collect()
}

/// 레이아웃이 가리키는 템플릿 경로 전부.
fn pointed_templates(layout: &SpecLayout) -> BTreeSet<String> {
    let mut pointed = BTreeSet::new();
    walk(&layout.root, &mut Vec::new(), &mut |entry, _| {
        pointed.extend(entry.template.clone());
    });
    pointed
}

/// 항목을 문서 순서(깊이 우선)로 걷는다. `path`는 맨 위 항목에서부터의 인덱스 경로다.
fn walk(entry: &LayoutEntry, path: &mut Vec<usize>, visit: &mut impl FnMut(&LayoutEntry, &[usize])) {
    visit(entry, path);
    for (i, child) in entry.children.iter().enumerate() {
        path.push(i);
        walk(child, path, visit);
        path.pop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 폴더가 없으면 **그 모드의 코드 내장본**이다 — 고친 적이 없고, 템플릿도 없다(내장본에는 템플릿이
    /// 없다). 폴더 자리는 그래도 준다: 처음 저장하면 거기 선다.
    #[test]
    fn without_a_folder_the_read_is_the_builtin_of_that_mode() {
        let root = tempfile::tempdir().unwrap();
        for mode in [Mode::Atelier, Mode::Maison] {
            let read = read_layout(root.path(), mode.as_str()).unwrap();
            assert_eq!(read.id, mode);
            assert!(!read.edited, "{mode}: 고친 적이 없다");
            assert_eq!(
                read.folder,
                crate::collapse_home(&root.path().join("layouts").join(mode.as_str()))
            );
            let LayoutContent::Readable { layout, templates, rendered } = read.content else {
                panic!("{mode}: 내장본은 늘 읽힌다");
            };
            assert_eq!(layout, builtin_layout(mode));
            assert!(templates.is_empty(), "{mode}: {templates:?}");
            assert_eq!(rendered, render_layout(&builtin_layout(mode), None, None));
        }
    }

    /// `<데이터 루트>/layouts/<id>/`에 파일 하나를 심는다. 폴더가 없으면 만든다.
    fn plant(root: &Path, id: &str, file: &str, content: &str) {
        let path = root.join("layouts").join(id).join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    /// 템플릿 셋을 가리키는 레이아웃 — 맨 위 층의 것, 하위 폴더의 것, 디스크에 없는 것.
    const THREE_TEMPLATES: &str = r#"{ "root": { "children": [
        { "pattern": "decisions.md", "kind": "file", "description": "why", "template": "decisions.md" },
        { "pattern": "docs", "kind": "folder", "children": [
            { "pattern": "plan.md", "kind": "file", "template": "sub/plan.md" } ] },
        { "pattern": "gone.md", "kind": "file", "template": "gone.md" } ] } }"#;

    /// 폴더가 있으면 **그 폴더의 것**이다 — 고친 레이아웃이다. 가리키고 디스크에 있는 템플릿은
    /// 본문이 함께 오고, 없는 것은 경고로 나온다. 레이아웃이 모르는 파일은 템플릿이 아니다.
    #[test]
    fn a_folder_reads_as_its_layout_with_template_bodies_and_missing_ones_as_warnings() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", THREE_TEMPLATES);
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");
        plant(root.path(), "atelier", "sub/plan.md", "# Plan\n");
        plant(root.path(), "atelier", "stray.md", "모르는 파일\n");

        let read = read_layout(root.path(), "atelier").unwrap();
        assert!(read.edited);
        let folder = crate::collapse_home(&root.path().join("layouts/atelier"));
        assert_eq!(read.folder, folder);
        let LayoutContent::Readable { layout, templates, rendered } = read.content else {
            panic!("읽혀야 한다: {:?}", read.content);
        };
        let patterns: Vec<_> =
            layout.root.children.iter().map(|e| e.pattern.clone().unwrap()).collect();
        assert_eq!(patterns, ["decisions.md", "docs", "gone.md"]);
        assert_eq!(
            templates,
            BTreeMap::from([
                ("decisions.md".to_string(), "# Decisions\n".to_string()),
                ("sub/plan.md".to_string(), "# Plan\n".to_string()),
            ])
        );
        assert_eq!(rendered.warnings, [format!("missing template for `gone.md`: {folder}/gone.md")]);
        assert!(
            rendered.text.contains(&format!("Template: {folder}/decisions.md")),
            "안내문이 폴더의 레이아웃이 아니다: {}",
            rendered.text
        );
    }

    /// 가리키는 템플릿 하나를 **읽을 수 없어도**(UTF-8이 아닌 바이트) 읽기는 실패하지 않는다 —
    /// 레이아웃을 읽어야 에이전트와 편집기가 고쳐 저장할 수 있다. 그 템플릿은 본문 없이 경고로
    /// 나온다. 안내문은 atelier_get_work가 주는 것 그대로다: 파일은 있으므로 `Template:` 줄이 선다.
    ///
    /// 본문을 대체 문자로 채워 주지 않는다 — 받은 본문을 저장에 그대로 돌려주면 원래 바이트가 조용히
    /// 바뀐다. 본문을 빼 두면, 읽은 것을 그대로 돌려준 저장이 디스크의 그 파일을 건드리지 않는다.
    #[test]
    fn an_unreadable_template_is_left_out_with_a_warning_and_the_read_goes_on() {
        let root = tempfile::tempdir().unwrap();
        plant(
            root.path(),
            "atelier",
            "layout.json",
            r#"{ "root": { "children": [
                { "pattern": "a.md", "kind": "file", "template": "a.md" },
                { "pattern": "b.md", "kind": "file", "template": "b.md" } ] } }"#,
        );
        plant(root.path(), "atelier", "a.md", "# A\n");
        let unreadable = root.path().join("layouts/atelier/b.md");
        std::fs::write(&unreadable, [0xff, 0xfe, 0x00]).unwrap();

        let read = read_layout(root.path(), "atelier").unwrap();
        let LayoutContent::Readable { layout, templates, rendered } = read.content else {
            panic!("읽혀야 한다: {:?}", read.content);
        };
        assert_eq!(templates, bodies(&[("a.md", "# A\n")]));
        let folder = crate::collapse_home(&root.path().join("layouts/atelier"));
        assert_eq!(rendered.warnings.len(), 1, "{:?}", rendered.warnings);
        assert!(
            rendered.warnings[0].contains(&format!("{folder}/b.md")),
            "어느 템플릿인지 말하지 않는다: {:?}",
            rendered.warnings
        );
        assert!(rendered.text.contains(&format!("Template: {folder}/b.md")), "{}", rendered.text);

        let saved =
            save_layout(root.path(), "atelier", crate::serialize_layout_value(&layout), &templates)
                .unwrap();
        assert!(matches!(saved, SaveOutcome::Saved(_)), "{saved:?}");
        assert_eq!(std::fs::read(&unreadable).unwrap(), [0xff, 0xfe, 0x00]);
    }

    /// 깨진 레이아웃은 **원문과 오류 전부**를 준다 — 에이전트가 그 글을 고쳐 다시 저장한다
    /// (결정 20). 오류마다 제 항목의 위치가 붙는다. 깨진 폴더도 내장본을 가린 것이라 고친 것이다.
    #[test]
    fn a_broken_layout_reads_as_its_raw_text_and_every_error() {
        let root = tempfile::tempdir().unwrap();
        let raw = r#"{ "root": { "children": [
            { "pattern": "a.md", "kind": "fil" },
            { "pattern": "{x}", "kind": "folder" } ] } }"#;
        plant(root.path(), "maison", "layout.json", raw);

        let read = read_layout(root.path(), "maison").unwrap();
        assert!(read.edited);
        let LayoutContent::Broken { errors, raw: got } = read.content else {
            panic!("깨진 레이아웃이 읽혔다: {:?}", read.content);
        };
        assert_eq!(got.as_deref(), Some(raw));
        let paths: Vec<_> = errors.iter().map(|e| e.path.clone()).collect();
        assert_eq!(paths, [Some(vec![0]), Some(vec![1])], "{errors:?}");
    }

    /// 폴더는 있는데 `layout.json`이 없으면 원문 없이 그 까닭 하나다 — 그래도 가린 폴더다.
    #[test]
    fn a_folder_without_its_layout_file_reads_as_broken_with_no_raw_text() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");

        let read = read_layout(root.path(), "atelier").unwrap();
        assert!(read.edited);
        assert_eq!(
            read.content,
            LayoutContent::Broken {
                errors: vec![LayoutError { path: None, message: "layout.json is missing".to_string() }],
                raw: None,
            }
        );
    }

    /// 레이아웃 폴더 아래 모든 파일 — 폴더 기준 경로와 내용. 폴더가 없으면 빈 목록이다.
    fn files_in(root: &Path, id: &str) -> Vec<(String, String)> {
        let base = root.join("layouts").join(id);
        let mut found = Vec::new();
        let mut stack = vec![base.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            for entry in entries {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    let rel = path.strip_prefix(&base).unwrap().to_string_lossy().into_owned();
                    found.push((rel, std::fs::read_to_string(&path).unwrap_or_default()));
                }
            }
        }
        found.sort();
        found
    }

    fn bodies(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// 템플릿 하나를 가리키는 작은 레이아웃.
    fn with_decisions(description: &str) -> serde_json::Value {
        serde_json::json!({ "root": { "description": description, "children": [
            { "pattern": "decisions.md", "kind": "file", "description": "why",
              "template": "decisions.md" } ] } })
    }

    /// **처음 저장하면 가리기가 된다**(결정 7) — 그 모드의 폴더가 생기고, 그 뒤 resolve는 폴더의
    /// 것을 준다. 저장은 그 레이아웃으로 만든 안내문을 돌려준다: 에이전트가 사용자에게 보여 준다.
    #[test]
    fn the_first_save_hides_the_builtin_and_resolve_then_gives_the_folders_layout() {
        let root = tempfile::tempdir().unwrap();
        let outcome = save_layout(
            root.path(),
            "atelier",
            with_decisions("Keep it small."),
            &bodies(&[("decisions.md", "# Decisions\n")]),
        )
        .unwrap();

        let folder = root.path().join("layouts/atelier");
        let SaveOutcome::Saved(rendered) = outcome else { panic!("거절됐다: {outcome:?}") };
        assert!(rendered.warnings.is_empty(), "{rendered:?}");
        assert!(
            rendered.text.contains(&format!("Template: {}/decisions.md", crate::collapse_home(&folder))),
            "{}",
            rendered.text
        );
        let names: Vec<_> = files_in(root.path(), "atelier").into_iter().map(|(name, _)| name).collect();
        assert_eq!(names, ["decisions.md", "layout.json"]);

        let resolved = crate::resolve_layout(root.path(), Mode::Atelier, None).unwrap();
        assert_eq!(resolved.source, crate::LayoutSource::Folder(folder));
        assert_eq!(resolved.layout.root.description, "Keep it small.");
        assert_eq!(rendered, render_layout(&resolved.layout, resolved.templates.as_ref(), None));
        // 가린 것은 그 모드의 것뿐이다
        let maison = crate::resolve_layout(root.path(), Mode::Maison, None).unwrap();
        assert_eq!(maison.layout, builtin_layout(Mode::Maison));
    }

    /// **검증이 실패하면 아무것도 쓰지 않는다** — 폴더의 파일 목록과 내용이 전후로 같다. 넘긴
    /// 템플릿 본문도 쓰이지 않는다: 템플릿을 먼저 쓰므로, 검증을 쓰기 앞에 두지 않으면 여기서 샌다.
    /// 오류에는 제 항목의 위치가 붙는다. 폴더가 없던 모드에는 폴더도 생기지 않는다.
    #[test]
    fn a_refused_save_writes_nothing() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", THREE_TEMPLATES);
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");
        let before = files_in(root.path(), "atelier");

        let invalid = serde_json::json!({ "root": { "children": [
            { "pattern": "decisions.md", "kind": "file", "template": "decisions.md" },
            { "pattern": "b.md", "kind": "fil" } ] } });
        for id in ["atelier", "maison"] {
            let outcome = save_layout(
                root.path(),
                id,
                invalid.clone(),
                &bodies(&[("decisions.md", "# 새 본문\n")]),
            )
            .unwrap();
            let SaveOutcome::Refused(errors) = outcome else { panic!("{id}: 저장됐다") };
            let paths: Vec<_> = errors.iter().map(|e| e.path.clone()).collect();
            assert_eq!(paths, [Some(vec![1])], "{id}: {errors:?}");
        }
        assert_eq!(files_in(root.path(), "atelier"), before);
        assert!(!root.path().join("layouts/maison").exists(), "거절된 저장이 가림 폴더를 만들었다");
    }

    /// 레이아웃이 가리키는 템플릿이 **인자에도 디스크에도 없으면** 그 항목의 위치가 붙은 검증 오류다
    /// — 저장하면 `Template:` 줄이 빠진 채 에이전트에게 가기 때문이다. 아무것도 쓰지 않는다.
    #[test]
    fn a_template_neither_given_nor_on_disk_is_refused_at_its_entry() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", THREE_TEMPLATES);
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");
        let before = files_in(root.path(), "atelier");

        // `decisions.md`는 디스크에, `sub/plan.md`는 인자에 있다. `gone.md`는 어디에도 없다.
        let outcome = save_layout(
            root.path(),
            "atelier",
            serde_json::from_str(THREE_TEMPLATES).unwrap(),
            &bodies(&[("sub/plan.md", "# Plan\n")]),
        )
        .unwrap();
        let SaveOutcome::Refused(errors) = outcome else { panic!("저장됐다") };
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(errors[0].path, Some(vec![2]), "{errors:?}");
        assert!(errors[0].message.contains("gone.md"), "{errors:?}");
        assert_eq!(files_in(root.path(), "atelier"), before);
    }

    /// 데이터 루트를 담은 폴더 아래 모든 경로. 저장이 데이터 루트 **밖에** 무엇이든 만들면 드러난다.
    fn everything_under(dir: &Path) -> Vec<std::path::PathBuf> {
        let mut found = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
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

    /// 템플릿 경로는 **레이아웃 폴더 안**이어야 한다 — 레이아웃이 가리키는 경로도, 본문을 건넨
    /// 경로도. 밖을 가리키면 거절되고 아무것도 쓰이지 않는다. 데이터 루트 밖에도 안 생긴다.
    #[test]
    fn a_template_path_outside_the_layout_folder_is_refused() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("home");
        std::fs::create_dir(&root).unwrap();
        let before = everything_under(outer.path());

        let pointing_out = serde_json::json!({ "root": { "children": [
            { "pattern": "a.md", "kind": "file", "template": "../../a.md" } ] } });
        let outcome =
            save_layout(&root, "atelier", pointing_out, &bodies(&[("../../a.md", "x")])).unwrap();
        let SaveOutcome::Refused(errors) = outcome else { panic!("저장됐다") };
        assert!(errors.iter().any(|e| e.path == Some(vec![0])), "그 항목에 오류가 없다: {errors:?}");

        // 절대 경로도 임시 폴더 안을 가리킨다 — 규칙이 무너져도 진짜 파일 시스템을 더럽히지 않게
        let absolute = outer.path().join("escape.md").to_string_lossy().into_owned();
        for escaping in ["../../escape.md", absolute.as_str(), "sub/../../../escape.md"] {
            let outcome = save_layout(
                &root,
                "atelier",
                with_decisions("x"),
                &bodies(&[("decisions.md", "# D\n"), (escaping, "x")]),
            )
            .unwrap();
            let SaveOutcome::Refused(errors) = outcome else { panic!("{escaping}: 저장됐다") };
            assert!(
                errors.iter().any(|e| e.message.contains(escaping)),
                "{escaping}: 무엇이 틀렸는지 말하지 않는다: {errors:?}"
            );
        }
        assert_eq!(everything_under(outer.path()), before);
    }

    /// **레이아웃 파일 이름의 폴더 아래 템플릿은 거절되고 아무것도 쓰지 않는다.** 쓰면 `layout.json`이라는
    /// 폴더가 서서 레이아웃 파일을 쓸 수 없게 되고, 그 모드는 사람이 되돌리기 전까지 깨진 채 남는다 —
    /// 에이전트에게는 되돌리는 길이 없다(결정 21). 대소문자만 다른 이름도 macOS에서는 같은 폴더다.
    #[test]
    fn a_template_under_the_layout_file_name_is_refused_and_nothing_is_written() {
        for template in ["layout.json/x.md", "LAYOUT.JSON/x.md"] {
            let root = tempfile::tempdir().unwrap();
            let layout = serde_json::json!({ "root": { "children": [
                { "pattern": "a.md", "kind": "file", "template": template } ] } });
            let outcome =
                save_layout(root.path(), "maison", layout, &bodies(&[(template, "# x\n")])).unwrap();
            let SaveOutcome::Refused(errors) = outcome else { panic!("{template}: 저장됐다: {outcome:?}") };
            assert_eq!(errors.len(), 1, "{template}: {errors:?}");
            assert_eq!(errors[0].path, Some(vec![0]), "{template}: {errors:?}");
            assert!(errors[0].message.contains("layout.json"), "{template}: {errors:?}");
            assert!(!root.path().join("layouts/maison").exists(), "{template}: 거절된 저장이 폴더를 만들었다");
        }
    }

    /// 어느 파일 항목도 가리키지 않는 본문은 거절된다 — 그 자리의 파일은 레이아웃이 모르는 파일일
    /// 수 있고, 저장은 그런 파일을 건드리지 않는다.
    #[test]
    fn a_body_no_entry_points_to_is_refused_and_the_file_there_stays() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "notes.md", "사람의 메모\n");
        let outcome = save_layout(
            root.path(),
            "atelier",
            with_decisions("x"),
            &bodies(&[("decisions.md", "# D\n"), ("notes.md", "덮어쓴 것\n")]),
        )
        .unwrap();
        let SaveOutcome::Refused(errors) = outcome else { panic!("저장됐다") };
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(errors[0].path, None, "{errors:?}");
        assert!(errors[0].message.contains("notes.md"), "{errors:?}");
        assert_eq!(files_in(root.path(), "atelier"), [("notes.md".to_string(), "사람의 메모\n".to_string())]);
    }

    /// **템플릿을 `layout.json`보다 먼저 쓴다.** 템플릿 하나를 쓸 수 없게 하면(그 경로에 같은 이름의
    /// 폴더를 둔다) 저장이 실패하고 `layout.json`은 전과 같다 — 순서가 거꾸로면 새 레이아웃이 없는
    /// 템플릿을 가리킨 채 선다.
    #[test]
    fn a_template_that_cannot_be_written_leaves_the_layout_file_as_it_was() {
        let root = tempfile::tempdir().unwrap();
        let old = r#"{ "root": { "description": "old" } }"#;
        plant(root.path(), "atelier", "layout.json", old);
        plant(root.path(), "atelier", "decisions.md/blocker.txt", "폴더다\n");

        let saved = save_layout(
            root.path(),
            "atelier",
            with_decisions("new"),
            &bodies(&[("decisions.md", "# Decisions\n")]),
        );
        assert!(saved.is_err(), "쓸 수 없는 템플릿인데 저장됐다: {saved:?}");
        assert_eq!(
            std::fs::read_to_string(root.path().join("layouts/atelier/layout.json")).unwrap(),
            old
        );
    }

    /// 앞 레이아웃이 가리켰는데 새 레이아웃은 가리키지 않는 템플릿 — **빠진 템플릿은 지워진다.**
    /// 레이아웃이 모르는 파일은 남고, 비게 된 하위 폴더도 남는다(폴더는 지우지 않는다). 인자에
    /// 없는 템플릿은 디스크의 지금 본문 그대로다.
    #[test]
    fn a_template_the_new_layout_drops_is_removed_and_nothing_else_is() {
        let root = tempfile::tempdir().unwrap();
        plant(
            root.path(),
            "atelier",
            "layout.json",
            r#"{ "root": { "children": [
                { "pattern": "decisions.md", "kind": "file", "template": "decisions.md" },
                { "pattern": "plan.md", "kind": "file", "template": "sub/plan.md" } ] } }"#,
        );
        plant(root.path(), "atelier", "decisions.md", "# 사람이 고친 본문\n");
        plant(root.path(), "atelier", "sub/plan.md", "# Plan\n");
        plant(root.path(), "atelier", "notes.md", "사람의 메모\n");

        let outcome =
            save_layout(root.path(), "atelier", with_decisions("x"), &BTreeMap::new()).unwrap();
        assert!(matches!(outcome, SaveOutcome::Saved(_)), "{outcome:?}");

        let files = files_in(root.path(), "atelier");
        let names: Vec<_> = files.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["decisions.md", "layout.json", "notes.md"]);
        assert_eq!(files[0].1, "# 사람이 고친 본문\n");
        assert_eq!(files[2].1, "사람의 메모\n");
        assert!(root.path().join("layouts/atelier/sub").is_dir(), "빈 하위 폴더를 지웠다");
    }

    /// 템플릿 하나를 `template` 경로로 가리키는 레이아웃.
    fn pointing_to(template: &str) -> serde_json::Value {
        serde_json::json!({ "root": { "children": [
            { "pattern": "adr.md", "kind": "file", "template": template } ] } })
    }

    /// **어느 파일인지는 글자가 아니라 파일 시스템이 정한다.** `sub//x.md`는 `sub/x.md`와 같은
    /// 파일이다 — 앞 레이아웃의 `sub/x.md`를 새 레이아웃이 `sub//x.md`로 적었다고 빠진 템플릿으로
    /// 지우면, 새 레이아웃이 가리키는 템플릿의 본문이 사라진다. 인자에 없는 템플릿은 디스크의 지금
    /// 본문 그대로여야 한다.
    #[test]
    fn a_template_written_another_way_is_not_removed_as_dropped() {
        let root = tempfile::tempdir().unwrap();
        let first = save_layout(
            root.path(),
            "atelier",
            pointing_to("sub/x.md"),
            &bodies(&[("sub/x.md", "# 사람이 쓴 본문\n")]),
        )
        .unwrap();
        assert!(matches!(first, SaveOutcome::Saved(_)), "{first:?}");

        let second =
            save_layout(root.path(), "atelier", pointing_to("sub//x.md"), &BTreeMap::new()).unwrap();
        let SaveOutcome::Saved(rendered) = second else { panic!("거절됐다: {second:?}") };
        assert!(rendered.warnings.is_empty(), "{rendered:?}");
        assert_eq!(
            std::fs::read_to_string(root.path().join("layouts/atelier/sub/x.md")).unwrap(),
            "# 사람이 쓴 본문\n"
        );
    }

    /// macOS의 기본 파일 시스템에서는 `ADR.md`와 `adr.md`가 한 파일이다 — 템플릿 경로의 대소문자만
    /// 바꿔 저장해도 본문이 남는다. 본문을 넘기지 않으면 지금 본문이, 넘기면 새 본문이다. 대소문자를
    /// 가리는 파일 시스템(리눅스 CI)에서는 둘이 다른 파일이라 잴 것이 없다.
    #[test]
    fn a_case_only_template_rename_keeps_the_body_on_a_case_insensitive_disk() {
        for new_body in [None, Some("# 새 본문\n")] {
            let root = tempfile::tempdir().unwrap();
            let folder = root.path().join("layouts/atelier");
            let first = save_layout(
                root.path(),
                "atelier",
                pointing_to("ADR.md"),
                &bodies(&[("ADR.md", "# 사람이 쓴 본문\n")]),
            )
            .unwrap();
            assert!(matches!(first, SaveOutcome::Saved(_)), "{first:?}");
            if !folder.join("adr.md").exists() {
                return; // 대소문자를 가리는 디스크다
            }

            let templates = new_body.map(|body| bodies(&[("adr.md", body)])).unwrap_or_default();
            let second = save_layout(root.path(), "atelier", pointing_to("adr.md"), &templates).unwrap();
            let SaveOutcome::Saved(rendered) = second else {
                panic!("{new_body:?}: 거절됐다: {second:?}")
            };
            assert!(rendered.warnings.is_empty(), "{new_body:?}: {rendered:?}");
            assert_eq!(
                std::fs::read_to_string(folder.join("adr.md")).unwrap(),
                new_body.unwrap_or("# 사람이 쓴 본문\n"),
            );
        }
    }

    /// **깨진 폴더에 저장해도 폴더 안의 `.md`는 하나도 지워지지 않는다** — 앞 레이아웃을 읽을 수
    /// 없으면 무엇이 템플릿이었는지 모른다. 깨진 레이아웃을 고쳐 저장하는 길(에이전트, 편집기)이
    /// 이 경우다. `layout.json`이 없는 폴더도 같다.
    #[test]
    fn saving_over_a_broken_folder_removes_no_markdown() {
        let broken_files = [
            r#"{ "root": { "children": [
                { "pattern": "a.md", "kind": "fil", "template": "a.md" },
                { "pattern": "b.md", "kind": "file", "template": "sub/b.md" } ] } }"#,
            "{ not json",
        ];
        for broken in broken_files.into_iter().map(Some).chain([None]) {
            let root = tempfile::tempdir().unwrap();
            if let Some(broken) = broken {
                plant(root.path(), "atelier", "layout.json", broken);
            }
            plant(root.path(), "atelier", "a.md", "# A\n");
            plant(root.path(), "atelier", "sub/b.md", "# B\n");

            let outcome = save_layout(
                root.path(),
                "atelier",
                serde_json::json!({ "root": { "description": "repaired" } }),
                &BTreeMap::new(),
            )
            .unwrap();
            assert!(matches!(outcome, SaveOutcome::Saved(_)), "{broken:?}: {outcome:?}");
            let names: Vec<_> =
                files_in(root.path(), "atelier").into_iter().map(|(name, _)| name).collect();
            assert_eq!(names, ["a.md", "layout.json", "sub/b.md"], "{broken:?}");
        }
    }

    /// 하위 폴더 경로(`sub/x.md`)의 템플릿이 쓰인다 — 폴더가 없으면 만들어서. 쓴 뒤 읽으면 그 본문이다.
    #[test]
    fn a_template_in_a_sub_folder_is_written() {
        let root = tempfile::tempdir().unwrap();
        let layout = serde_json::json!({ "root": { "children": [
            { "pattern": "{n}-{name}", "kind": "folder", "children": [
                { "pattern": "plan.md", "kind": "file", "template": "iteration/plan.md" } ] } ] } });
        let outcome = save_layout(
            root.path(),
            "maison",
            layout,
            &bodies(&[("iteration/plan.md", "# 계획\n\n## 목표\n")]),
        )
        .unwrap();
        assert!(matches!(outcome, SaveOutcome::Saved(ref r) if r.warnings.is_empty()), "{outcome:?}");
        assert_eq!(
            std::fs::read_to_string(root.path().join("layouts/maison/iteration/plan.md")).unwrap(),
            "# 계획\n\n## 목표\n"
        );
        let LayoutContent::Readable { templates, .. } = read_layout(root.path(), "maison").unwrap().content
        else {
            panic!("저장한 레이아웃이 안 읽힌다")
        };
        assert_eq!(templates, bodies(&[("iteration/plan.md", "# 계획\n\n## 목표\n")]));
    }

    /// 모르는 키는 저장에서도 산다 — 레이아웃 층과 항목 층 모두. 에이전트가 읽어 간 것을 고쳐
    /// 돌려주면 손으로 적어 둔 키가 남아 있어야 한다(결정 3의 「열어 둠」).
    #[test]
    fn unknown_keys_survive_a_save() {
        let root = tempfile::tempdir().unwrap();
        let layout = serde_json::json!({ "extends": "atelier", "root": {
            "note": "hand-written",
            "children": [ { "pattern": "a.md", "kind": "file", "color": "red" } ] } });
        let outcome = save_layout(root.path(), "atelier", layout, &BTreeMap::new()).unwrap();
        assert!(matches!(outcome, SaveOutcome::Saved(_)), "{outcome:?}");
        let written =
            std::fs::read_to_string(root.path().join("layouts/atelier/layout.json")).unwrap();
        for key in ["\"extends\"", "\"note\"", "\"color\""] {
            assert!(written.contains(key), "{key}가 사라졌다: {written}");
        }
    }

    /// **읽기와 저장의 입구가 모드 이름 둘만 받는다**(결정 25). IPC나 에이전트가 건넨 `"../.."`이
    /// 데이터 루트 밖을 읽거나 쓰면 안 된다 — 거절되고, 데이터 루트 밖에 아무것도 생기지 않는다.
    #[test]
    fn read_and_save_take_only_the_two_mode_names() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("home");
        std::fs::create_dir(&root).unwrap();
        let before = everything_under(outer.path());
        for id in ["../..", "..", "", "Atelier", "works", "atelier/", "maison/../atelier"] {
            assert!(read_layout(&root, id).is_err(), "읽기가 {id:?}를 받았다");
            let saved = save_layout(
                &root,
                id,
                with_decisions("x"),
                &bodies(&[("decisions.md", "# D\n")]),
            );
            assert!(saved.is_err(), "저장이 {id:?}를 받았다: {saved:?}");
        }
        assert_eq!(everything_under(outer.path()), before);
    }

    /// 같은 인자로 두 번 저장하면 같은 결과다 — 도구가 idempotent라고 알리는 근거다.
    #[test]
    fn saving_twice_with_the_same_arguments_leaves_the_same_folder() {
        let root = tempfile::tempdir().unwrap();
        let args = || (with_decisions("x"), bodies(&[("decisions.md", "# D\n")]));
        let (layout, templates) = args();
        let first = save_layout(root.path(), "atelier", layout, &templates).unwrap();
        let after_first = files_in(root.path(), "atelier");
        let (layout, templates) = args();
        let second = save_layout(root.path(), "atelier", layout, &templates).unwrap();
        assert_eq!(first, second);
        assert_eq!(files_in(root.path(), "atelier"), after_first);
    }

    /// **되돌리면 모드의 폴더가 지워지고 resolve가 내장본으로 돌아간다**(결정 7). 템플릿도 레이아웃이
    /// 모르는 파일도 폴더째 사라진다 — 확인 창이 그 수를 미리 적는 까닭이다. 다른 모드의 폴더는 그대로다.
    #[test]
    fn reverting_removes_the_modes_folder_and_resolve_gives_the_builtin_again() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", THREE_TEMPLATES);
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");
        plant(root.path(), "atelier", "sub/plan.md", "# Plan\n");
        plant(root.path(), "atelier", "메모.md", "사람의 메모\n");
        plant(root.path(), "maison", "layout.json", r#"{ "root": { "description": "Room" } }"#);
        let resolved = crate::resolve_layout(root.path(), Mode::Atelier, None).unwrap();
        assert!(matches!(resolved.source, crate::LayoutSource::Folder(_)), "심은 폴더가 안 가렸다");

        revert_layout(root.path(), "atelier").unwrap();

        assert!(!root.path().join("layouts/atelier").exists(), "폴더가 남았다");
        let resolved = crate::resolve_layout(root.path(), Mode::Atelier, None).unwrap();
        assert_eq!(resolved.source, crate::LayoutSource::Builtin);
        assert_eq!(resolved.layout, builtin_layout(Mode::Atelier));
        assert_eq!(resolved.fallback, None, "물러선 것이 아니라 가린 폴더가 없을 뿐이다");
        assert!(!read_layout(root.path(), "atelier").unwrap().edited);
        // 가린 것을 걷은 것은 그 모드의 폴더뿐이다
        assert_eq!(
            files_in(root.path(), "maison"),
            [("layout.json".to_string(), r#"{ "root": { "description": "Room" } }"#.to_string())]
        );
    }

    /// **깨진 폴더도 되돌려진다** — 되돌리기는 늘 된다. 앱이 스스로 깨진 파일을 지우지 않을 뿐, 사람이
    /// 고른 되돌리기는 그 폴더도 지운다. 깨진 모양은 resolve가 물러서는 것 전부다: 검증이 거절하는
    /// `layout.json`, `layout.json`이 없는 폴더, 폴더 자리에 선 파일, 대상이 사라진 링크.
    #[test]
    fn a_broken_folder_of_any_shape_is_reverted_too() {
        let layouts = |root: &Path| root.join("layouts");
        let shapes: [(&str, fn(&Path)); 4] = [
            ("검증이 거절하는 layout.json", |root| {
                plant(root, "atelier", "layout.json", r#"{ "root": { "children": [ { "pattern": "a.md", "kind": "fil" } ] } }"#);
                plant(root, "atelier", "a.md", "# A\n");
            }),
            ("layout.json이 없는 폴더", |root| plant(root, "atelier", "decisions.md", "# D\n")),
            ("폴더 자리에 선 파일", |root| {
                std::fs::create_dir_all(root.join("layouts")).unwrap();
                std::fs::write(root.join("layouts/atelier"), "폴더가 아니다\n").unwrap();
            }),
            ("대상이 사라진 링크", |root| {
                std::fs::create_dir_all(root.join("layouts")).unwrap();
                #[cfg(unix)]
                std::os::unix::fs::symlink(root.join("gone"), root.join("layouts/atelier")).unwrap();
                #[cfg(not(unix))]
                std::fs::write(root.join("layouts/atelier"), "링크 대신\n").unwrap();
            }),
        ];
        for (shape, seed) in shapes {
            let root = tempfile::tempdir().unwrap();
            seed(root.path());
            let before = crate::resolve_layout(root.path(), Mode::Atelier, None).unwrap();
            assert!(before.fallback.is_some(), "{shape}: 깨진 폴더가 아니다");

            revert_layout(root.path(), "atelier").unwrap_or_else(|e| panic!("{shape}: {e}"));

            assert!(
                std::fs::symlink_metadata(layouts(root.path()).join("atelier")).is_err(),
                "{shape}: 그 자리에 무엇이 남았다"
            );
            let after = crate::resolve_layout(root.path(), Mode::Atelier, None).unwrap();
            assert_eq!(after.source, crate::LayoutSource::Builtin, "{shape}");
            assert_eq!(after.fallback, None, "{shape}: 여전히 물러선다");
        }
    }

    /// **되돌리기의 입구도 모드 이름 둘만 받는다**(결정 25). IPC로 온 `"../.."`이 지우는 일이라 읽기·
    /// 저장보다 더 무겁다 — 거절되고, 데이터 루트의 다른 것(work, 두 모드의 레이아웃)도 데이터 루트
    /// 밖의 것도 하나도 사라지지 않는다.
    #[test]
    fn reverting_takes_only_the_two_mode_names_and_removes_nothing_else() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("home");
        plant(&root, "atelier", "layout.json", THREE_TEMPLATES);
        plant(&root, "maison", "layout.json", r#"{ "root": {} }"#);
        std::fs::create_dir_all(root.join("works/some-work/spec")).unwrap();
        std::fs::write(root.join("works/some-work/spec/overview.md"), "# 개요\n").unwrap();
        std::fs::write(outer.path().join("밖.md"), "데이터 루트 밖\n").unwrap();
        let before = everything_under(outer.path());

        for id in ["../..", "..", ".", "", "Atelier", "works", "atelier/", "maison/../atelier", "../layouts"] {
            let reverted = revert_layout(&root, id);
            let Err(crate::Error::Validation(message)) = &reverted else {
                panic!("되돌리기가 {id:?}를 받았다: {reverted:?}")
            };
            assert!(message.contains("atelier | maison"), "{id:?}: {message}");
        }
        assert_eq!(everything_under(outer.path()), before);
    }

    /// 레이아웃 폴더가 **다른 곳의 폴더를 가리키는 링크**면 링크만 지운다 — 사람이 레이아웃을 다른 곳에
    /// 두고 이어 둔 것이다. 링크를 따라가 가리키는 폴더를 지우면 되돌리기가 데이터 루트 밖을 지운다.
    #[cfg(unix)]
    #[test]
    fn reverting_a_linked_folder_removes_the_link_and_not_what_it_points_to() {
        let outer = tempfile::tempdir().unwrap();
        let root = outer.path().join("home");
        let elsewhere = outer.path().join("dotfiles/atelier-layout");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::fs::write(elsewhere.join("layout.json"), r#"{ "root": { "description": "linked" } }"#).unwrap();
        std::fs::write(elsewhere.join("decisions.md"), "# D\n").unwrap();
        std::fs::create_dir_all(root.join("layouts")).unwrap();
        std::os::unix::fs::symlink(&elsewhere, root.join("layouts/atelier")).unwrap();
        let linked = crate::resolve_layout(&root, Mode::Atelier, None).unwrap();
        assert_eq!(linked.layout.root.description, "linked", "링크가 가리지 않았다");

        revert_layout(&root, "atelier").unwrap();

        assert!(std::fs::symlink_metadata(root.join("layouts/atelier")).is_err(), "링크가 남았다");
        let mut kept: Vec<_> = std::fs::read_dir(&elsewhere)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        kept.sort();
        assert_eq!(kept, ["decisions.md", "layout.json"], "링크가 가리키던 폴더를 지웠다");
        let after = crate::resolve_layout(&root, Mode::Atelier, None).unwrap();
        assert_eq!(after.source, crate::LayoutSource::Builtin);
    }

    /// **앱의 편집기가 받는 읽기의 모양**(`read_spec_layout`, 티켓 11). 읽을 수 있는 레이아웃은 디스크
    /// 형식 그대로(모르는 키까지), 템플릿 본문, 경고다 — 편집기는 그것을 초안으로 펼쳐 고치고 저장에
    /// 돌려준다.
    #[test]
    fn the_app_reads_a_readable_layout_as_its_disk_form_with_bodies_and_warnings() {
        let root = tempfile::tempdir().unwrap();
        plant(
            root.path(),
            "atelier",
            "layout.json",
            r#"{ "owner": "사람", "root": { "description": "방침", "children": [
                { "pattern": "decisions.md", "kind": "file", "since": "0.14", "template": "decisions.md" },
                { "pattern": "gone.md", "kind": "file", "template": "gone.md" } ] } }"#,
        );
        plant(root.path(), "atelier", "decisions.md", "# 결정\n");
        let folder = crate::collapse_home(&root.path().join("layouts").join("atelier"));

        let answer = serde_json::to_value(read_layout(root.path(), "atelier").unwrap()).unwrap();

        assert_eq!(
            answer,
            serde_json::json!({
                "id": "atelier",
                "folder": folder,
                "edited": true,
                "layout": { "owner": "사람", "root": { "description": "방침", "children": [
                    { "pattern": "decisions.md", "kind": "file", "template": "decisions.md", "since": "0.14" },
                    { "pattern": "gone.md", "kind": "file", "template": "gone.md" } ] } },
                "templates": { "decisions.md": "# 결정\n" },
                "warnings": [format!("missing template for `gone.md`: {folder}/gone.md")],
            })
        );
    }

    /// 깨진 레이아웃은 **까닭과 원문**이다 — 편집기는 그때 편집 UI를 세우지 않고 까닭만 보인다.
    #[test]
    fn the_app_reads_a_broken_layout_as_its_errors_and_raw_text() {
        let root = tempfile::tempdir().unwrap();
        let raw = r#"{ "root": { "children": [ { "pattern": "a.md" } ] } }"#;
        plant(root.path(), "maison", "layout.json", raw);
        let folder = crate::collapse_home(&root.path().join("layouts").join("maison"));

        let answer = serde_json::to_value(read_layout(root.path(), "maison").unwrap()).unwrap();

        assert_eq!(
            answer,
            serde_json::json!({
                "id": "maison",
                "folder": folder,
                "edited": true,
                "errors": [{ "path": [0], "message": "`kind` is missing (\"file\" or \"folder\")" }],
                "raw": raw,
            })
        );
    }

    /// **저장의 답은 오류 목록 하나다**(`write_spec_layout`, 티켓 11). 검증이 거절하면 위치가 붙은 오류가
    /// 데이터로 오고, 쓰면 빈 목록이다 — 위치를 문자열에 싸서 앱이 다시 풀게 하지 않는다.
    #[test]
    fn the_app_gets_a_save_as_its_list_of_errors() {
        let root = tempfile::tempdir().unwrap();
        let refused = save_layout(
            root.path(),
            "atelier",
            serde_json::json!({ "root": { "children": [ { "pattern": "a.md" } ] } }),
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(refused).unwrap(),
            serde_json::json!({
                "errors": [{ "path": [0], "message": "`kind` is missing (\"file\" or \"folder\")" }]
            })
        );

        let saved =
            save_layout(root.path(), "atelier", with_decisions("방침"), &bodies(&[("decisions.md", "# D\n")]))
                .unwrap();
        assert_eq!(serde_json::to_value(saved).unwrap(), serde_json::json!({ "errors": [] }));
    }

    /// 폴더가 없어도 된다 — 이미 기본값이다. 두 번 눌러도, 그사이 손으로 지웠어도 같은 끝이다.
    #[test]
    fn reverting_a_mode_without_a_folder_changes_nothing() {
        let root = tempfile::tempdir().unwrap();
        for id in ["atelier", "maison"] {
            revert_layout(root.path(), id).unwrap();
            revert_layout(root.path(), id).unwrap();
        }
        assert_eq!(everything_under(root.path()), Vec::<std::path::PathBuf>::new());
    }

    /// 템플릿이 없는 초안 — 파일 항목, 번호 틀 폴더와 그 자식.
    fn without_templates() -> serde_json::Value {
        serde_json::json!({ "root": { "description": "방침 문단.", "children": [
            { "pattern": "overview.md", "kind": "file", "description": "요약" },
            { "pattern": "{n}-{name}", "kind": "folder", "description": "한 판", "children": [
                { "pattern": "tickets", "kind": "folder", "description": "그 판의 티켓" } ] } ] } })
    }

    /// 그 초안을 저장한 뒤 **에이전트가 받는 글** — `atelier_get_work`가 싣는 것과 같은 길(resolve → render)이다.
    fn guidance_after_saving(root: &Path, layout: serde_json::Value, templates: &BTreeMap<String, String>) -> String {
        let outcome = save_layout(root, "atelier", layout, templates).unwrap();
        assert!(matches!(outcome, SaveOutcome::Saved(_)), "저장이 거절됐다: {outcome:?}");
        let resolved = crate::resolve_layout(root, Mode::Atelier, None).unwrap();
        render_layout(&resolved.layout, resolved.templates.as_ref(), resolved.fallback.as_ref()).text
    }

    /// **미리보기는 「저장하면 받을 것」이다**(스토리 29) — 같은 초안에 대해 미리보기 글과, 그 초안을 저장한 뒤
    /// 에이전트가 받는 안내문이 글자까지 같다. 템플릿이 없는 초안, 본문을 초안에 쥔 템플릿, 디스크에만 있는
    /// 템플릿(에이전트처럼 본문을 넘기지 않았다)을 모두 본다. 깨진 폴더 위에서도 물러서기 줄이 없다 — 저장하면
    /// 그 폴더가 고쳐지기 때문이다.
    #[test]
    fn a_preview_is_the_text_the_agent_gets_after_saving_that_draft() {
        let cases: [(&str, &[(&str, &str)], serde_json::Value, BTreeMap<String, String>); 4] = [
            ("템플릿 없음", &[], without_templates(), BTreeMap::new()),
            ("초안의 본문", &[], with_decisions("방침"), bodies(&[("decisions.md", "# 결정\n")])),
            (
                "디스크의 본문",
                &[("layout.json", r#"{ "root": {} }"#), ("decisions.md", "# 결정\n")],
                with_decisions("방침"),
                BTreeMap::new(),
            ),
            ("깨진 폴더 위", &[("layout.json", "{ not json")], without_templates(), BTreeMap::new()),
        ];
        for (case, planted, layout, templates) in cases {
            let root = tempfile::tempdir().unwrap();
            for (file, content) in planted {
                plant(root.path(), "atelier", file, content);
            }

            let preview = preview_layout(root.path(), "atelier", layout.clone(), &templates).unwrap();
            assert_eq!(preview.errors, [], "{case}");
            let saved = guidance_after_saving(root.path(), layout, &templates);
            assert_eq!(preview.text.as_deref(), Some(saved.as_str()), "{case}");
            assert!(!saved.starts_with("Could not read"), "{case}: {saved}");
        }
    }

    /// **미리보기는 디스크에 아무것도 쓰지 않는다** — 부르기 전후로 데이터 루트의 파일 목록과 레이아웃 폴더의
    /// 내용이 같다. 폴더가 없는 모드에 폴더가 생기지 않고(생기면 그것이 내장본을 가린다), 초안이 쥔 새 본문도,
    /// 바꾼 본문도 쓰이지 않는다. 거절되는 초안과 모드 이름이 아닌 id도 마찬가지다.
    #[test]
    fn a_preview_writes_nothing() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", THREE_TEMPLATES);
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");
        let before = (everything_under(root.path()), files_in(root.path(), "atelier"));

        let drafts = [
            (with_decisions("새 방침"), bodies(&[("decisions.md", "# 바꾼 본문\n")])),
            (serde_json::from_str(THREE_TEMPLATES).unwrap(), bodies(&[("sub/plan.md", "# Plan\n")])),
            (without_templates(), bodies(&[("stray.md", "x")])),
        ];
        for id in ["atelier", "maison", "../.."] {
            for (layout, templates) in &drafts {
                let _ = preview_layout(root.path(), id, layout.clone(), templates);
            }
        }
        assert_eq!((everything_under(root.path()), files_in(root.path(), "atelier")), before);
        assert!(!root.path().join("layouts/maison").exists(), "미리보기가 가림 폴더를 만들었다");
    }

    /// 초안에 본문이 있는 템플릿은 **디스크에 없어도** `Template:` 줄로 실린다 — 저장하면 그 파일이 선다.
    /// 경로는 레이아웃 폴더 아래이고, 폴더가 아직 없어도 그 자리다(처음 저장하면 거기 선다).
    #[test]
    fn a_template_body_in_the_draft_goes_out_as_its_template_line() {
        let root = tempfile::tempdir().unwrap();
        let folder = crate::collapse_home(&root.path().join("layouts").join("atelier"));

        let preview = preview_layout(
            root.path(),
            "atelier",
            with_decisions("방침"),
            &bodies(&[("decisions.md", "# 결정\n")]),
        )
        .unwrap();

        let text = preview.text.expect("오류가 없으면 글이 있다");
        assert!(text.contains(&format!("Template: {folder}/decisions.md")), "{text}");
        assert_eq!(preview.warnings, Vec::<String>::new());
    }

    /// 누락 템플릿(티켓 12)이 **여기서 잠긴다** — 초안이 가리키는 템플릿이 초안 본문에도 디스크에도 없으면 그
    /// 항목 자리의 오류이고, 글이 없다(결정 28). 칸에 본문을 적은 초안은 오류가 없다.
    #[test]
    fn a_draft_pointing_to_a_missing_template_is_an_error_at_that_entry_and_has_no_text() {
        let root = tempfile::tempdir().unwrap();
        plant(root.path(), "atelier", "layout.json", THREE_TEMPLATES);
        plant(root.path(), "atelier", "decisions.md", "# Decisions\n");
        let draft: serde_json::Value = serde_json::from_str(THREE_TEMPLATES).unwrap();

        // `decisions.md`는 디스크에, `sub/plan.md`는 초안에 있다. `gone.md`는 어디에도 없다.
        let missing =
            preview_layout(root.path(), "atelier", draft.clone(), &bodies(&[("sub/plan.md", "# Plan\n")]))
                .unwrap();
        assert_eq!(missing.text, None);
        assert_eq!(missing.warnings, Vec::<String>::new());
        let places: Vec<_> = missing.errors.iter().map(|e| e.path.clone()).collect();
        assert_eq!(places, [Some(vec![2])], "{:?}", missing.errors);
        assert!(missing.errors[0].message.contains("gone.md"), "{:?}", missing.errors);

        let written = preview_layout(
            root.path(),
            "atelier",
            draft,
            &bodies(&[("sub/plan.md", "# Plan\n"), ("gone.md", "# 다시 쓴 뼈대\n")]),
        )
        .unwrap();
        assert_eq!(written.errors, []);
        assert!(written.text.is_some());
    }

    /// 미리보기는 **항목마다 제 줄이 어디인지** 준다 — 편집기의 팝업이 고른 항목의 줄을 칠한다(구현 스펙 5절
    /// 「배치」). 줄 규칙은 render의 것이라 앱이 글을 다시 읽어 셈하지 않는다(결정 13). 항목의 줄은 이름 줄과
    /// 여러 줄 설명의 뒷줄, `Template:` 줄이다. 맨 위 항목(`[]`)은 방침 문단의 줄이다. 줄은 0부터 센다.
    #[test]
    fn the_preview_says_which_lines_each_entry_holds() {
        let root = tempfile::tempdir().unwrap();
        let draft = serde_json::json!({ "root": { "description": "방침 한 줄.\n둘째 줄.", "children": [
            { "pattern": "a.md", "kind": "file", "description": "하나\n둘", "template": "a.md" },
            { "pattern": "b", "kind": "folder", "children": [
                { "pattern": "c.md", "kind": "file", "description": "셋" } ] } ] } });

        let preview = preview_layout(root.path(), "atelier", draft, &bodies(&[("a.md", "# A\n")])).unwrap();

        let text = preview.text.expect("오류가 없으면 글이 있다");
        let lines: Vec<&str> = text.split('\n').collect();
        assert_eq!(lines[2], "방침 한 줄.", "{text}");
        assert_eq!(lines[5].trim_end(), "  a.md    하나", "{text}");
        assert_eq!(lines[9], "    c.md  셋", "{text}");
        let held: Vec<_> =
            preview.lines.iter().map(|held| (held.path.clone(), held.start, held.count)).collect();
        assert_eq!(held, [(vec![], 2, 2), (vec![0], 5, 3), (vec![1], 8, 1), (vec![1, 0], 9, 1)]);
    }

    /// **앱이 받는 미리보기의 모양**(`render_spec_layout`) — 글, 항목의 줄, 오류, 경고가 한 답에 온다. 오류의
    /// 모양은 저장의 것(`{ path, message }`)과 같고, 오류가 있으면 글은 `null`이다.
    #[test]
    fn the_app_gets_a_preview_as_its_text_lines_errors_and_warnings() {
        let root = tempfile::tempdir().unwrap();
        let refused = preview_layout(
            root.path(),
            "atelier",
            serde_json::json!({ "root": { "children": [ { "pattern": "a.md" } ] } }),
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(refused).unwrap(),
            serde_json::json!({
                "text": null,
                "lines": [],
                "errors": [{ "path": [0], "message": "`kind` is missing (\"file\" or \"folder\")" }],
                "warnings": [],
            })
        );

        let draft = serde_json::json!({ "root": { "children": [ { "pattern": "a.md", "kind": "file" } ] } });
        let shown = preview_layout(root.path(), "atelier", draft, &BTreeMap::new()).unwrap();
        assert_eq!(
            serde_json::to_value(shown).unwrap(),
            serde_json::json!({
                "text": "Spec layout — how to arrange documents inside `specDir`.\n\n  a.md",
                "lines": [{ "path": [0], "start": 2, "count": 1 }],
                "errors": [],
                "warnings": [],
            })
        );
    }

    /// id는 모드 이름 둘만 받는다 — IPC로 온 `"../.."`이 데이터 루트 밖의 템플릿을 보면 안 된다.
    #[test]
    fn the_preview_takes_only_the_two_mode_names() {
        let root = tempfile::tempdir().unwrap();
        for id in ["../..", "..", "", "Atelier", "works", "atelier/"] {
            let refused = preview_layout(root.path(), id, without_templates(), &BTreeMap::new());
            assert!(refused.is_err(), "{id:?}가 통과했다: {refused:?}");
        }
        for id in ["atelier", "maison"] {
            assert!(preview_layout(root.path(), id, without_templates(), &BTreeMap::new()).is_ok(), "{id}");
        }
    }
}
