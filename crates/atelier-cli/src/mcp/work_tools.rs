//! 작업 쓰기 도구 — 로컬 데이터와 git 워크트리만 만진다. 외부 세계와는 상호작용하지 않는다.
//!
//! 커널이 `Err`를 주면 `kernel_error`로, 성공분을 유지한 채 `errors`를 실어 주면
//! `partial_failure`로 올린다. 둘 다 프로토콜 오류가 아니라 **실행 오류**다.

use atelier_core::WorkReport;
use rmcp::{handler::server::wrapper::Parameters, model::*, tool, tool_router, ErrorData};

use super::{kernel_error, AtelierServer};

/// 커널이 성공분을 유지한 채 돌려준 부분 실패를 **실행 오류**로 올린다 (Δ12 · D5).
///
/// 성공한 워크트리는 그대로 쓸 수 있으므로 함께 담고, 복구는 **실패한 프로젝트만 붙이는**
/// 좁은 경로 하나만 가리킨다. 작업 시작 전체를 다시 돌리라고 안내하지 않는다 —
/// 커널이 멱등이라 안전하기는 하지만, 이 계약의 목적은 재시도 비용을 낮추는 것이다.
fn partial_failure(report: &WorkReport) -> Result<CallToolResult, ErrorData> {
    let slug = &report.view.work.slug;
    let mut text = format!(
        "Work '{slug}' exists and its metadata is saved, but some worktrees could not be \
         created.\n\nReady for code work:\n"
    );
    for t in report.view.trees.iter().filter(|t| t.exists) {
        text.push_str(&format!("  {}  {}\n", t.project, t.path));
    }
    text.push_str("\nFailed — do not start code work in these projects:\n");
    for e in &report.errors {
        text.push_str(&format!("  {}: {}\n", e.project, e.message));
    }
    text.push_str("\nFix the cause, then attach only the failed projects, one call each:\n");
    for e in &report.errors {
        text.push_str(&format!(
            "  atelier_attach_project {{ \"work_slug\": \"{slug}\", \"project_slug\": \"{}\" }}\n",
            e.project
        ));
    }
    text.push_str(
        "Attaching is enough — the work and the successful worktrees are already in place.\n\
         The full report follows as JSON.",
    );
    Ok(CallToolResult::error(vec![
        ContentBlock::text(text),
        ContentBlock::json(report)?,
    ]))
}

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

/// `atelier_attach_project`의 인자.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct AttachProjectParams {
    /// Slug of the work to extend, as returned by atelier_list_works.
    pub work_slug: String,
    /// Slug of the project to add, as returned by atelier_list_projects.
    pub project_slug: String,
}

/// `atelier_set_work_status`의 인자.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SetWorkStatusParams {
    /// Slug of the work to change, as returned by atelier_list_works.
    pub work_slug: String,
    /// New status. One of: "active" (being worked on), "review" (waiting for review or
    /// merge), "done" (finished). Any transition is allowed, including going back.
    pub status: String,
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
            Ok(report) if report.errors.is_empty() => {
                Ok(CallToolResult::success(vec![ContentBlock::json(&report)?]))
            }
            Ok(report) => partial_failure(&report),
            Err(e) => Ok(kernel_error(e)),
        }
    }

    #[tool(
        description = "Add one project to an existing work and create its worktree on the \
                       work's shared branch. This is also the recovery path when \
                       atelier_start_work reported that a worktree could not be created: \
                       call it once per failed project instead of starting the work again. \
                       Doing it twice for the same project changes nothing."
    )]
    async fn atelier_attach_project(
        &self,
        Parameters(AttachProjectParams { work_slug, project_slug }): Parameters<AttachProjectParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match atelier_core::attach_project(
            &self.works_root,
            &self.projects_root,
            &work_slug,
            &project_slug,
        ) {
            Ok(report) if report.errors.is_empty() => {
                Ok(CallToolResult::success(vec![ContentBlock::json(&report)?]))
            }
            Ok(report) => partial_failure(&report),
            Err(e) => Ok(kernel_error(e)),
        }
    }

    #[tool(
        description = "Set a work's status to active, review or done. Any transition is \
                       allowed. Nothing else about the work changes — the worktrees and the \
                       branch stay exactly as they are."
    )]
    async fn atelier_set_work_status(
        &self,
        Parameters(SetWorkStatusParams { work_slug, status }): Parameters<SetWorkStatusParams>,
    ) -> Result<CallToolResult, ErrorData> {
        // 상태 문자열의 정본은 커널이다. 여기서 미러 enum을 만들면 나중에 조용히 낡는다.
        let status = match status.parse::<atelier_core::WorkStatus>() {
            Ok(status) => status,
            Err(e) => return Ok(kernel_error(e)),
        };
        match atelier_core::update_work_status(&self.works_root, &work_slug, status) {
            Ok(view) => Ok(CallToolResult::success(vec![ContentBlock::json(&view)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }
}
