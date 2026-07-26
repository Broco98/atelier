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
    pub folder_path: String,
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
        match atelier_core::create_project(
            &self.projects_root,
            std::path::Path::new(&folder_path),
        ) {
            Ok(view) => Ok(CallToolResult::success(vec![ContentBlock::json(&view)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }
}
