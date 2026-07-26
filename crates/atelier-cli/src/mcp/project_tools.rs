//! 프로젝트 쓰기 도구 — 등록(멱등)과 부분 수정. 커널에 위임만 한다.
//!
//! **프로젝트 삭제 도구는 여기에 없다.** 삭제는 앱이 유일한 경로다 (graph-plan D7 · Δ16).
//! `atelier_core::delete_project`는 존재하지만 이 표면에 노출하지 않는다.

use rmcp::{handler::server::wrapper::Parameters, model::*, tool, tool_router, ErrorData};

use super::{kernel_error, AtelierServer};

/// `atelier_add_project`의 인자.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct AddProjectParams {
    /// 등록할 코드 폴더의 절대 경로. `~/dev/billing`처럼 `~`로 시작해도 된다.
    /// 상대 경로는 받지 않는다 — 이 서버의 작업 디렉터리는 네가 아는 값이 아니다.
    pub folder_path: String,
}

/// `atelier_edit_project`의 인자. 주지 않은 필드는 그대로 둔다.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct EditProjectParams {
    /// 수정할 프로젝트의 slug (atelier_list_projects가 돌려주는 `slug` 값)
    pub project_slug: String,
    /// 새 표시 이름. slug는 바뀌지 않는다. 공백만 있으면 거부된다.
    pub name: Option<String>,
    /// 프로젝트가 무엇인지 설명하는 새 본문(Markdown). 기존 설명을 통째로 대체한다.
    pub description: Option<String>,
    /// 워크트리가 갈라져 나올 기준 브랜치 (예: `main`, `develop`)
    pub base_branch: Option<String>,
}

#[tool_router(router = project_router, vis = "pub")]
impl AtelierServer {
    #[tool(
        description = "Register a code folder as an Atelier project, so that works can create \
                       git worktrees in it. Idempotent: registering a folder that is already \
                       registered returns the existing project unchanged — it never creates a \
                       duplicate and never overwrites an existing description. The code folder \
                       itself is never modified; only Atelier's own metadata file is written. \
                       A new project's description starts empty — fill it in right away with \
                       atelier_edit_project. Local files only.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn atelier_add_project(
        &self,
        Parameters(AddProjectParams { folder_path }): Parameters<AddProjectParams>,
    ) -> Result<CallToolResult, ErrorData> {
        // 이 표면이 내보내는 경로는 전부 `~` 축약형이다. 그대로 되돌려 받아도 동작해야 한다.
        let folder = atelier_core::expand_home(&folder_path);
        // 상대 경로는 이 서버 프로세스의 작업 디렉터리 기준으로 풀린다 — 호스트가 정하는 값이라
        // 에이전트에게 보이지 않고, 같은 이름의 폴더가 있으면 조용히 엉뚱한 폴더를 등록한다.
        if !folder.is_absolute() {
            return Ok(CallToolResult::error(vec![ContentBlock::text(format!(
                "folder_path must be an absolute path, got: {folder_path}\n\n\
                 Pass the full path to the folder (`/Users/you/dev/billing` or \
                 `~/dev/billing`) and call this tool again."
            ))]));
        }
        match atelier_core::create_project(&self.projects_root, &folder) {
            Ok(view) => Ok(CallToolResult::success(vec![ContentBlock::json(&view)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }

    #[tool(
        description = "Update an Atelier project's description, display name or base branch. \
                       Use this to fill in `description` — a short account of what the project \
                       is and what lives in it — right after registering a project, and again \
                       whenever you learn it is more than its current description says. \
                       Partial update: fields you omit are left untouched. Omitting is not \
                       clearing — pass an empty string to clear a field. `description` replaces \
                       the whole body rather than appending, so include everything you want to \
                       keep. The slug never changes and the code folder is never modified. \
                       Local files only.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn atelier_edit_project(
        &self,
        Parameters(EditProjectParams { project_slug, name, description, base_branch }): Parameters<
            EditProjectParams,
        >,
    ) -> Result<CallToolResult, ErrorData> {
        // 커널은 빈 패치를 성공으로 받아 파일을 다시 쓴다. 에이전트에게는 아무 일도
        // 안 일어난 것으로 보여 혼란만 남으므로, 무엇을 줘야 하는지 말해준다.
        if name.is_none() && description.is_none() && base_branch.is_none() {
            return Ok(CallToolResult::error(vec![ContentBlock::text(
                "nothing to change: none of name, description, base_branch was given\n\n\
                 Pass at least one of them and call this tool again.",
            )]));
        }
        let patch = atelier_core::ProjectPatch { name, description, base_branch };
        match atelier_core::update_project(&self.projects_root, &project_slug, patch) {
            Ok(view) => Ok(CallToolResult::success(vec![ContentBlock::json(&view)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }
}
