//! 조회 도구 — 읽기 전용, 로컬 파일만 만진다.

use rmcp::{model::*, tool, tool_router, ErrorData};

use super::{kernel_error, AtelierServer};

#[tool_router(router = read_router, vis = "pub")]
impl AtelierServer {
    #[tool(
        description = "List every registered Atelier project: slug, display name, folder path, \
                       baseBranch and description. Call this first to get a valid project slug. \
                       Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_list_projects(&self) -> Result<CallToolResult, ErrorData> {
        match atelier_core::list_projects(&self.projects_root) {
            Ok(views) => Ok(CallToolResult::success(vec![ContentBlock::json(&views)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }
}
