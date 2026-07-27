//! 조회 도구 — 읽기 전용, 로컬 파일만 만진다.

use rmcp::{
    handler::server::wrapper::Parameters, model::*, tool, tool_router, ErrorData,
};

use super::{kernel_error, AtelierServer};

/// `atelier_get_work`의 인자.
///
/// `schemars(crate = ...)`는 필수다 — derive 확장이 크레이트 루트의 `schemars`를
/// 찾는데 우리는 rmcp의 재수출만 쓴다. 직접 의존을 추가하면 rmcp가 쓰는 버전과
/// 어긋날 수 있으므로 재수출을 가리킨다. 파라미터 구조체는 전부 이 형태다.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct GetWorkParams {
    /// Slug of the work to look up, as returned by atelier_list_works.
    pub work_slug: String,
}

#[tool_router(router = read_router, vis = "pub")]
impl AtelierServer {
    #[tool(
        description = "List every registered Atelier project: slug, display name, folder path, \
                       baseBranch, description, and `git` — which carries `localBranches`, the \
                       branch names that already exist in that repository. Call this first to \
                       get a valid project slug, and read `git.localBranches` to pick a branch \
                       name that matches the repository's convention. \
                       Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_list_projects(&self) -> Result<CallToolResult, ErrorData> {
        match atelier_core::list_projects(&self.projects_root) {
            Ok(views) => Ok(CallToolResult::success(vec![ContentBlock::json(&views)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }

    #[tool(
        description = "List every Atelier work. A work is one feature spanning one or more \
                       projects, sharing a single branch name. Each entry carries the shared \
                       branch, the per-project worktree paths, the spec directory and the spec \
                       files already written. Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_list_works(&self) -> Result<CallToolResult, ErrorData> {
        match atelier_core::list_works(&self.works_root) {
            Ok(views) => Ok(CallToolResult::success(vec![ContentBlock::json(&views)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }

    #[tool(
        description = "Get one Atelier work by slug: its shared branch, the per-project worktree \
                       paths to do code work in, `specDir` — the directory to write this work's \
                       spec documents into — and `specFiles`, the documents already there. \
                       Write spec documents yourself with your own file tools into `specDir`; \
                       there is no spec-writing tool. Paths are written with `~` for your home \
                       directory. Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_get_work(
        &self,
        Parameters(GetWorkParams { work_slug }): Parameters<GetWorkParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match atelier_core::get_work(&self.works_root, &work_slug) {
            Ok(view) => Ok(CallToolResult::success(vec![ContentBlock::json(&view)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }
}
