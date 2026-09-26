//! spec 레이아웃 도구 — 에이전트가 레이아웃을 읽고 고쳐 저장하는 길(결정 20). 엔진 저장소를
//! 부르는 얇은 어댑터다: 검증도, 쓰는 순서도, 템플릿 규칙도 저장소 한 벌에 산다(결정 13).
//!
//! **도구는 둘뿐이다.** 되돌리기는 사람이 설정 페이지에서 한다(결정 21). 만들기·지우기·모드 선택은
//! 기능 자체가 없다(결정 25). 서버는 `settings.json`을 읽지 않는다.
//!
//! **「spec 문서용 도구는 없다」는 그대로다** — 이 도구들은 spec 문서가 아니라 그 문서들이 놓일
//! 모양(레이아웃)을 다룬다.
//!
//! 어느 모드의 서버든 두 모드의 레이아웃을 다룬다. 레이아웃 폴더는 모드별 홈이 아니라 데이터 루트
//! 아래 하나라서다. 그래서 Maison 서버에서 이 둘은 Room 도구 쪽에 들고, 설명에 프로젝트 도구 이름도
//! Maison에 없는 낱말도 쓰지 않는다.

use std::collections::BTreeMap;

use atelier_core::{LayoutContent, LayoutError, SaveOutcome};
use rmcp::{handler::server::wrapper::Parameters, model::*, tool, tool_router, ErrorData};
use serde_json::{json, Value};

use super::{kernel_error, AtelierServer};

/// 형식 설명 — `atelier_get_spec_layout` 응답의 끝에 실린다.
///
/// **도구 설명에 넣지 않는다.** 도구 설명은 모든 세션의 컨텍스트에 늘 실리는데, 형식은 레이아웃을
/// 고칠 때만 필요하다. 필드 표, 자리 표시자, 검증 규칙, 템플릿 경로 규칙을 담는다 — 검증 규칙은
/// 엔진(`parse.rs`·`store.rs`)의 것을 옮겨 적은 것이라, 엔진이 규칙을 더하면 여기도 한 줄 는다.
///
/// 필드 표의 `icon` 줄은 앱이 그릴 수 있는 아이콘 이름을 모두 적는다. 앱의 아이콘 표
/// (`src/features/works/spec-icons.ts`)에서 그 순서대로 옮겨 적은 것이라, 표가 바뀌면 아래
/// 테스트(`the_format_lists_every_icon_the_app_draws`)가 빨개진다. 엔진은 아이콘을 해석하지 않아
/// 저장이 모르는 이름을 알려 주지 않으니, 에이전트가 이름을 아는 길은 이 줄뿐이다.
///
/// 글자는 기대값 파일(`tests/expected/spec-layout-format.txt`)이 고정한다. 저장소에 스냅샷 관례가
/// 없어 안내문(01)과 같은 방식이다.
const LAYOUT_FORMAT: &str = r#"Spec layout format — what `layout` holds and what a save checks.

A layout has one top entry, `root`: the `specDir` itself. Its `children` are what goes inside it, listed in the order the guidance shows them. Every entry is a JSON object:

  pattern      the file or folder name: fixed (`decisions.md`) or with placeholders (`{n}-{name}`). Required, except on `root`, which has none. Not empty, no `/`.
  kind         "file" or "folder". Required, except on `root`, which is always a folder.
  description  what agents read about this place: what it is for and when to create it. On `root` it is the paragraph at the top of the guidance. Optional.
  icon         the name of the icon the desktop app draws next to it, one of: compass, layers, list-checks, search, book-open, file-text, notebook-pen, lightbulb, flask-conical, scale, image, flag. Any other name draws none. It is not part of the guidance. Optional.
  template     files only: the path of a template in the layout folder. Optional.
  children     folders only: the entries inside it. Optional, any depth.

Keys this list does not name are kept as they are. When two sibling entries match the same name, the earlier one wins.

Placeholders: `{n}` is one or more ASCII digits and `{name}` is any name that is not empty. A pattern may use each at most once, and not side by side (`{n}{name}`). Entries with `{n}` sort by number, newest first.

A save is refused, and nothing is written, when:
- a field is not the JSON type it should be: text, except `children`, a list of entries
- `root` has a `pattern`, a `kind` or a `template`
- any other entry has no `kind`, a `kind` other than "file" or "folder", or a `pattern` that is missing, empty or holds `/`
- a pattern has an unknown placeholder, uses one twice, or puts `{n}` and `{name}` side by side
- two siblings have the same pattern
- a file entry has `children`, or a folder entry has a `template`
- a template path leaves the layout folder, does not end in a file name, has a part that starts with `.`, or is `layout.json` itself or a path under it, in any letter case
- a template has no body in `templates` and none in the layout folder
- `templates` holds a body that no file entry points to
Each error names its entry by its place under `root`, such as `root.children[1].children[0]`.

Templates are Markdown files in the layout folder, next to `layout.json`. A template path is relative to that folder and may go into sub-folders (`iteration/plan.md`). `templates` maps those paths to bodies. A template left out of `templates` keeps the body it has now, so pass only the ones you change. A template that no entry points to any more is deleted by the save. Files the layout never pointed to are left alone."#;

/// `atelier_get_spec_layout`의 인자.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct GetSpecLayoutParams {
    /// Whose layout to read: "atelier" or "maison". Omit it to read this server's own mode.
    pub id: Option<String>,
}

/// `atelier_save_spec_layout`의 인자. **`layout`은 JSON 값 그대로 받는다** — 구조체로 받으면
/// 모르는 키가 역직렬화에서 떨어진다(결정 3의 「열어 둠」).
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SaveSpecLayoutParams {
    /// Whose layout to save: "atelier" or "maison". Always pass it, even for this server's own mode.
    pub id: String,
    /// The whole layout in its `layout.json` form, as atelier_get_spec_layout returns it — keep the
    /// keys you did not change, including ones you do not know.
    pub layout: Value,
    /// Template bodies by their path in the layout folder, such as `{"decisions.md": "# Decisions"}`.
    /// Pass only the templates you add or change: the rest keep the bodies they have.
    #[serde(default)]
    pub templates: BTreeMap<String, String>,
}

/// 오류 목록을 사람이 읽는 줄로 — 위치(`root.children[1]`)가 앞에 붙는다.
fn error_lines(errors: &[LayoutError]) -> String {
    errors.iter().map(|e| format!("  {e}")).collect::<Vec<_>>().join("\n")
}

#[tool_router(router = layout_router, vis = "pub")]
impl AtelierServer {
    #[tool(
        description = "Read the spec layout of a mode: how the documents in a `specDir` are \
                       arranged, the guidance atelier_get_work and atelier_start_work carry. \
                       `~/.atelier/layouts/<id>/` refers to the layout of that mode (`atelier` or \
                       `maison`). Do not edit the files there yourself; read and save the layout \
                       with atelier_get_spec_layout and atelier_save_spec_layout. Omit `id` for \
                       this server's own mode. Answers with the layout in its `layout.json` form, \
                       the template bodies, the guidance it renders to, warnings, and whether it \
                       was edited — a layout never edited is the built-in one. A layout that \
                       cannot be read comes back as its errors and the file as it is. The answer \
                       ends with the format. Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_get_spec_layout(
        &self,
        Parameters(GetSpecLayoutParams { id }): Parameters<GetSpecLayoutParams>,
    ) -> Result<CallToolResult, ErrorData> {
        // 빼면 이 서버의 모드다 — 모드는 기동 때 정해진 프로세스의 성질이다.
        let id = id.unwrap_or_else(|| self.mode.as_str().to_string());
        let read = match atelier_core::read_layout(&self.data_root, &id) {
            Ok(read) => read,
            Err(e) => return Ok(kernel_error(e)),
        };
        let note = match &read.content {
            LayoutContent::Readable { rendered, .. } => rendered.text.clone(),
            // 깨졌으면 원문과 오류 전부다 — 에이전트는 그것을 고쳐 다시 저장한다. 고칠지는 사용자가
            // 정한다: 물러선 안내문이 「부탁받기 전에는 고치지 마라」고 말하는 것과 같은 뜻이다.
            LayoutContent::Broken { errors, .. } => format!(
                "The spec layout `{}/` cannot be read, so atelier_get_work and \
                 atelier_start_work carry the built-in guidance instead:\n{}\n\n`raw` is \
                 `layout.json` as it is now. Tell the user. If they ask you to repair it, fix \
                 these errors and save the whole layout with atelier_save_spec_layout.",
                read.folder,
                error_lines(errors)
            ),
        };
        Ok(CallToolResult::success(vec![
            // 앱의 `read_spec_layout`과 같은 값이다 — 모양은 엔진의 `LayoutRead` 직렬화 한 벌이 정한다.
            // `layout`은 디스크 형식 그대로라 모르는 키까지 `layout.json`에 적힐 모양으로 건넨다.
            // 에이전트가 이것을 고쳐 그대로 저장에 돌려준다.
            ContentBlock::json(&read)?,
            ContentBlock::text(note),
            ContentBlock::text(LAYOUT_FORMAT),
        ]))
    }

    #[tool(
        description = "Save the spec layout of a mode, checked before anything is written. \
                       `~/.atelier/layouts/<id>/` refers to the layout of that mode (`atelier` or \
                       `maison`). Do not edit the files there yourself; read and save the layout \
                       with atelier_get_spec_layout and atelier_save_spec_layout. Read it first \
                       and pass the whole layout back with your changes. The first save of a mode \
                       creates its folder, which then takes the place of the built-in layout. \
                       A layout that fails the check is refused with each error and where it is, \
                       and nothing is written. Templates the layout no longer points to are \
                       deleted. On success it answers with the guidance agents now get from \
                       atelier_get_work and atelier_start_work — show it to the user. Local files \
                       only.",
        annotations(
            read_only_hint = false,
            // 빠진 템플릿을 지운다
            destructive_hint = true,
            // 같은 인자면 같은 폴더가 된다
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn atelier_save_spec_layout(
        &self,
        Parameters(SaveSpecLayoutParams { id, layout, templates }): Parameters<SaveSpecLayoutParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match atelier_core::save_layout(&self.data_root, &id, layout, &templates) {
            // 저장한 레이아웃의 안내문 — 다음 `atelier_get_work`부터 에이전트가 받는 글이다. 에이전트가
            // 그것을 사용자에게 보여 준다(결정 20).
            Ok(SaveOutcome::Saved(rendered)) => Ok(CallToolResult::success(vec![
                ContentBlock::json(json!({ "id": id, "warnings": rendered.warnings }))?,
                ContentBlock::text(rendered.text),
            ])),
            Ok(SaveOutcome::Refused(errors)) => Ok(CallToolResult::error(vec![
                ContentBlock::text(format!(
                    "The spec layout was not saved; nothing was written.\n{}\n\nFix these and \
                     call this tool again with the whole layout.",
                    error_lines(&errors)
                )),
                ContentBlock::json(json!({ "errors": errors }))?,
            ])),
            Err(e) => Ok(kernel_error(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::LAYOUT_FORMAT;

    /// 앱의 아이콘 표(`src/features/works/spec-icons.ts`)의 키, 적힌 순서대로. 적힌 순서가 편집기의
    /// 아이콘 목록 순서다.
    ///
    /// `atelier-core`의 `every_builtin_icon_is_in_the_apps_icon_table`과 **같은 방식으로** 읽는다
    /// — `SPEC_ICONS = { … } satisfies` 리터럴 안에서, 줄머리가 따옴표 친 키인 줄만 항목으로 친다.
    /// 머리 주석에 예시로 적힌 이름이 표의 항목으로 섞여 들지 않게 하려는 것이다.
    fn app_icon_names() -> Vec<String> {
        let file = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src/features/works/spec-icons.ts"
        ))
        .expect("spec-icons.ts moved; update this test and the app's icon table together");
        let start = file
            .find("export const SPEC_ICONS = {")
            .expect("SPEC_ICONS table not found; update this test with spec-icons.ts");
        let end = start
            + file[start..]
                .find("} satisfies")
                .expect("SPEC_ICONS has no `} satisfies` end; update this test with spec-icons.ts");
        file[start..end]
            .lines()
            .map(str::trim_start)
            .filter(|line| line.starts_with('"'))
            .map(|line| line.split('"').nth(1).unwrap_or_default().to_string())
            .collect()
    }

    /// **형식 설명이 앱이 그릴 수 있는 아이콘을 모두, 표의 순서대로 적는다.** 에이전트는 이 글
    /// 말고는 아이콘 이름을 알 길이 없다 — 내장본에 쓰인 다섯만 보인다. 엔진은 아이콘을 해석하지
    /// 않아 저장이 틀린 이름을 알려 주지 않으니(spec 레이아웃 구현 스펙 4절), 「ADR 폴더에 저울
    /// 아이콘」 같은 부탁이 에이전트가 lucide 이름을 우연히 맞힐 때만 되지 않게 이름을 건넨다.
    ///
    /// 두 언어 사이라 테스트로 묶는다. 표에 아이콘을 더하거나 이름을 바꾸면 여기가 빨개진다 —
    /// 형식 설명의 `icon` 줄과 기대값 파일(`tests/expected/spec-layout-format.txt`)을 함께 고친다.
    #[test]
    fn the_format_lists_every_icon_the_app_draws() {
        let keys = app_icon_names();
        // 표를 못 읽은 것이 「다 적혔다」로 읽히지 않게 — 몸통에 항목 줄이 하나도 없으면 빨갛다
        assert!(!keys.is_empty(), "SPEC_ICONS 표에서 항목 줄을 하나도 못 읽었다");

        let line = LAYOUT_FORMAT
            .lines()
            .find(|line| line.trim_start().starts_with("icon "))
            .expect("형식 설명에 `icon` 줄이 없다");
        let listed: Vec<&str> = line
            .split_once("one of: ")
            .and_then(|(_, rest)| rest.split_once(". "))
            .map(|(names, _)| names.split(", ").collect())
            .unwrap_or_default();
        assert_eq!(listed, keys, "형식 설명의 아이콘 목록이 앱의 아이콘 표(spec-icons.ts)와 다르다: {line}");
    }
}
