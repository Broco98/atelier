//! 작업 쓰기 도구 — 로컬 데이터와 git 워크트리만 만진다. 외부 세계와는 상호작용하지 않는다.
//!
//! 커널이 `Err`를 주면 `kernel_error`로, 성공분을 유지한 채 `errors`를 실어 주면
//! `partial_failure`로 올린다. 둘 다 프로토콜 오류가 아니라 **실행 오류**다.

use rmcp::{handler::server::wrapper::Parameters, model::*, tool, tool_router, ErrorData};

use super::{kernel_error, AtelierServer};

/// `atelier_start_work`의 인자.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct StartWorkParams {
    /// Human-readable title of the work. Calling again with the same title resumes the
    /// existing work instead of creating a second one.
    pub title: String,
    /// Slugs of the projects this work spans, at least one. Use the `slug` values from
    /// atelier_list_projects.
    pub projects: Vec<String>,
    /// Branch name shared by every project's worktree. Defaults to the work slug derived
    /// from the title. Follow the target repositories' existing branch convention.
    pub branch: Option<String>,
}

#[tool_router(router = work_router, vis = "pub")]
impl AtelierServer {
    #[tool(
        description = "Start a work: one feature spanning one or more projects, sharing a \
                       single branch name. Creates the work metadata, a spec directory and \
                       one git worktree per project. Calling it again with the same title \
                       resumes that work and only creates the worktrees that are missing, so \
                       it is safe to retry. Returns the worktree paths to do code work in and \
                       `specDir` to write the spec documents into."
    )]
    async fn atelier_start_work(
        &self,
        Parameters(StartWorkParams { title, projects, branch }): Parameters<StartWorkParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match atelier_core::start_work(
            &self.works_root,
            &self.projects_root,
            &title,
            &projects,
            branch.as_deref(),
        ) {
            Ok(report) => Ok(CallToolResult::success(vec![ContentBlock::json(&report)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }
}
