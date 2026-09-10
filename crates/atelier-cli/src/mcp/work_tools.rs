//! 작업 쓰기 도구 — 로컬 데이터와 git 워크트리만 만진다. 외부 세계와는 상호작용하지 않는다.
//!
//! 커널이 `Err`를 주면 `kernel_error`로, 성공분을 유지한 채 `errors`를 실어 주면
//! `partial_failure`로 올린다. 둘 다 프로토콜 오류가 아니라 **실행 오류**다.

use atelier_core::WorkReport;
use rmcp::{handler::server::wrapper::Parameters, model::*, tool, tool_router, ErrorData};

use super::{kernel_error, AtelierServer, DO_NOT_CALL_PROJECT_TOOLS};

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
    for t in report.view.worktrees.iter().filter(|t| t.exists) {
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
///
/// **인자 doc은 도구 설명과 같은 층이다.** schemars가 이 주석을 그대로
/// `inputSchema.properties.*.description`으로 내보내고, 에이전트는 `tools/list` 한 덩어리로
/// 둘을 함께 읽는다 — 그래서 프로젝트·브랜치·워크트리를 **전제하는** 문장은 여기에도 없어야
/// 하고(#180), 절차는 지침 두 벌이 든다. 도구 설명만 중립화하고 여기를 두면, 설명에서 걷어
/// 낸 바로 그 문장이 스무 줄 아래에서 되살아난다.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct StartWorkParams {
    /// Human-readable title of the work, written in the user's own language. This is a
    /// display name, not what identifies the work — `slug` is. It can be rewritten later
    /// with atelier_edit_work, and the user may have done so.
    pub title: String,
    /// What identifies the work: its folder name — and, for a work that spans projects,
    /// the name of the branch too, unless `branch` overrides it. Write it in English
    /// kebab-case, for example `cart-add-item`. It never changes, so pass the same value
    /// again to resume this work. If you omit it, one is derived from the title — and that
    /// keeps non-ASCII characters, so a title that is not in English leaves a folder name
    /// that is awkward to type and, where it becomes a branch name, awkward in git.
    pub slug: Option<String>,
    /// Slugs of the projects this work spans, when it spans any. Omit it for a work that
    /// has no code — nothing but the work and its spec directory is created, and no branch
    /// is decided; projects can be attached later if it ever reaches code.
    #[serde(default)]
    pub projects: Vec<String>,
    /// Branch name for the worktrees, for a work that spans projects: one name, checked
    /// out in every one of them, defaulting to the work's slug. When it does span any,
    /// follow those repositories' existing branch convention. A work with no projects has
    /// nothing to check out, so there is nothing to pass here.
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
    /// Branch name for the worktree, for a work whose branch is still `null` — this is
    /// where it gets decided. Read the project's `git.localBranches` and match the
    /// convention already in use. Omitting it falls back to the work slug. Passing a
    /// different name than the work already uses is refused: one work, one branch.
    pub branch: Option<String>,
}

/// `atelier_edit_work`의 인자. **title과 pinned만 받는다** — status는
/// `atelier_set_work_status`가 담당하고, branch는 워크트리가 체크아웃해 둔 값이라 단독으로
/// 바꿀 수 없다. 둘 다 선택이다: 안 준 쪽은 그대로 둔다 (`EditProjectParams`와 같은 계약).
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct EditWorkParams {
    /// Slug of the work to edit, as returned by atelier_list_works.
    pub work_slug: String,
    /// New title, in the user's own language. A blank title is refused. The slug, the spec
    /// directory, and any branch and worktree paths are untouched — only the display name
    /// changes. (Same words as this tool's own description: one fact, said once.)
    pub title: Option<String>,
    /// Pin the work so it sorts to the top of every work listing, above the rest.
    /// Pinning is a fact about the work, not a view setting: it is stored in the work
    /// itself and survives restarts. Pass false to unpin.
    pub pinned: Option<bool>,
}

/// `atelier_set_work_status`의 인자.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct SetWorkStatusParams {
    /// Slug of the work to change, as returned by atelier_list_works.
    pub work_slug: String,
    /// New status. One of: "draft" (written down, not started yet), "active" (being worked
    /// on), "review" (waiting for review or merge), "done" (finished). Any transition is
    /// allowed, including going back.
    pub status: String,
}

/// `atelier_remove_work`의 인자. **`force`가 없다** — 강제 삭제는 노출하지 않는다.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct RemoveWorkParams {
    /// Slug of the work to remove, as returned by atelier_list_works.
    pub work_slug: String,
}

/// `atelier_archive_work`의 인자. 여기에도 **`force`가 없다** — 이유는 삭제 쪽과 다르다.
/// "보존한다"는 행위에 "커밋 안 된 작업을 버리고 진행"은 자기모순이다.
#[derive(Debug, serde::Deserialize, rmcp::schemars::JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ArchiveWorkParams {
    /// Slug of the work to archive, as returned by atelier_list_works.
    pub work_slug: String,
}

#[tool_router(router = work_router, vis = "pub")]
impl AtelierServer {
    #[tool(
        description = "Start a work: its folder, its spec directory, and — for each project \
                       passed in `projects` — a git worktree, all on one branch name they \
                       share. Omit `projects` for an idea that has no code yet: no worktree \
                       and no branch are created, only the work and its `specDir`; projects \
                       can be attached later if it ever reaches code. \
                       Calling it again with the same `slug` resumes it and only creates the \
                       worktrees that are missing, if it has any, so it is safe to retry — on a resume the \
                       `title` you pass is ignored and the stored one is kept, because the user \
                       may have edited it. Returns `specDir` to write the spec documents into, \
                       and the path of any worktree it made.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn atelier_start_work(
        &self,
        Parameters(StartWorkParams { title, slug, projects, branch }): Parameters<StartWorkParams>,
    ) -> Result<CallToolResult, ErrorData> {
        // **`branch`도 함께 막는다.** 프로젝트가 없어도 `branch`가 오면 커널이 그것을
        // work.json에 적는다 — 오류도 워크트리도 없이 Room이 브랜치를 갖는다(결정 17이
        // 깨지는데 아무도 안 본다). 신규든 재개든 같은 문을 지나므로, 이미 있는 slug로
        // 다시 불러 브랜치만 얹는 길도 여기서 함께 닫힌다.
        if !projects.is_empty() || branch.is_some() {
            // **무엇이 걸렸는지 이름으로 적는다** — 「둘 다 안 된다」만 오면 에이전트는 어느
            // 쪽이 문제인지 몰라 하나만 빼고 다시 부른다. 이 표면의 오류는 실패한 입력을
            // 늘 그대로 싣는다 (tool_error.rs의 계약).
            let mut carried = Vec::new();
            if !projects.is_empty() {
                carried.push(format!("`projects` ({})", projects.join(", ")));
            }
            if let Some(branch) = &branch {
                carried.push(format!("`branch` ({branch})"));
            }
            if let Some(refusal) = self.refuse_project_work(&format!(
                "This call carries {}. Call atelier_start_work again with neither: a Room is \
                 its folder and its spec documents, and nothing else.",
                carried.join(" and ")
            )) {
                return Ok(refusal);
            }
        }
        match atelier_core::start_work(
            &self.works_root,
            &self.archive_root,
            // Maison에서는 「없음」이다 — 등록부를 안 읽고, `projects`가 오면 커널이 거절한다.
            self.shared_projects_root(),
            &title,
            slug.as_deref(),
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
                       work's shared branch. If the work's `branch` is still null — it was \
                       started without projects — this is where the branch is decided, so \
                       pass one that matches the repository's convention. This is also the \
                       recovery path when atelier_start_work reported that a worktree could \
                       not be created: call it once per failed project instead of starting \
                       the work again. Doing it twice for the same project changes nothing. \
                       The work's status is never changed by attaching.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn atelier_attach_project(
        &self,
        Parameters(AttachProjectParams { work_slug, project_slug, branch }): Parameters<
            AttachProjectParams,
        >,
    ) -> Result<CallToolResult, ErrorData> {
        // 이 도구만 커널 시그니처가 「없음」을 못 받는다 — 등록부가 본질적으로 늘 필요하다.
        // 그래서 거절이 여기 어댑터에 있다 (스펙의 프로젝트 루트 네 갈래 중 넷째).
        if let Some(refusal) = self.refuse_project_work(DO_NOT_CALL_PROJECT_TOOLS) {
            return Ok(refusal);
        }
        match atelier_core::attach_project(
            &self.works_root,
            &self.projects_root,
            &work_slug,
            &project_slug,
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
        description = "Edit a work's title or pin it. Rename it when the title was written in \
                       a hurry, or when the work turned out to be about something else; pin it \
                       when the user says this is what matters right now, so it sorts to the \
                       top of every listing. Pass either field or both — whichever you omit is \
                       left alone. Nothing else moves: the slug, the spec directory, and any \
                       branch and worktree paths all stay exactly as they are, so references \
                       already written down elsewhere keep working. A blank title is refused. \
                       Local files only.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn atelier_edit_work(
        &self,
        Parameters(EditWorkParams { work_slug, title, pinned }): Parameters<EditWorkParams>,
    ) -> Result<CallToolResult, ErrorData> {
        // 커널은 빈 패치를 성공으로 받아 파일을 다시 쓴다. 에이전트에게는 아무 일도
        // 안 일어난 것으로 보여 혼란만 남으므로, 무엇을 줘야 하는지 말해준다
        // (atelier_edit_project가 같은 답을 한다).
        if title.is_none() && pinned.is_none() {
            return Ok(CallToolResult::error(vec![ContentBlock::text(
                "nothing to change: neither title nor pinned was given\n\n\
                 Pass at least one of them and call this tool again.",
            )]));
        }
        // 커널에는 한 필드짜리 쓰기 둘이 있다. 제목이 거부되면 거기서 끝난다 —
        // 실패한 편집이 반쪽만 착지하지 않게 순서를 고정한다.
        let mut latest = None;
        if let Some(title) = title {
            match atelier_core::update_work_title(&self.works_root, &work_slug, &title) {
                Ok(view) => latest = Some(view),
                Err(e) => return Ok(kernel_error(e)),
            }
        }
        if let Some(pinned) = pinned {
            match atelier_core::update_work_pinned(&self.works_root, &work_slug, pinned) {
                Ok(view) => latest = Some(view),
                Err(e) => return Ok(kernel_error(e)),
            }
        }
        let view = latest.expect("the guard above leaves at least one write");
        Ok(CallToolResult::success(vec![ContentBlock::json(&view)?]))
    }

    #[tool(
        description = "Set a work's status to draft, active, review or done. Use \"draft\" when \
                       the user only wants the idea written down for later. The status is \
                       declared, never derived: a work with no projects yet can still be \
                       \"active\". Any transition is allowed. Nothing else about the work changes \
                       — any worktrees and any branch stay exactly as they are.",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
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

    #[tool(
        description = "Remove a work: delete its metadata, its spec directory and any \
                       worktrees it has. When it spans projects, the branch those worktrees \
                       share is kept in every one of those repositories, so committed work is \
                       not lost. Refused when a worktree has uncommitted or untracked files; \
                       the error names them and says which kind each is. Commit them, or stash \
                       with `git stash -u`. There is no force option.",
        annotations(
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn atelier_remove_work(
        &self,
        Parameters(RemoveWorkParams { work_slug }): Parameters<RemoveWorkParams>,
    ) -> Result<CallToolResult, ErrorData> {
        // 살아남는 브랜치 이름을 응답에 담기 위해 먼저 읽는다.
        let branch = match atelier_core::get_work(&self.works_root, &work_slug) {
            Ok(view) => view.work.branch,
            Err(e) => return Ok(kernel_error(e)),
        };
        // 브랜치가 미정인 work는 워크트리도 없다 — 되찾을 커밋이 없다는 뜻이라 안내가 다르다.
        let note = match &branch {
            Some(_) => "The worktrees are gone. The branch above still exists in every \
                        project repository, so committed work is recoverable.",
            None => "The work had no project and no branch, so only its folder and the spec \
                     documents in it are gone.",
        };
        // force = false 고정. dirty 검사와 브랜치 보존이 이 도구의 안전장치다 (D6).
        match atelier_core::remove_work(&self.works_root, &work_slug, false) {
            Ok(()) => Ok(CallToolResult::success(vec![ContentBlock::json(
                serde_json::json!({
                    "removed": work_slug,
                    "branch": branch,
                    "note": note,
                }),
            )?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }

    #[tool(
        description = "Archive a work: move it out of the works in progress, so it stops \
                       showing up in atelier_list_works and stops taking up context. Nothing is deleted — \
                       the work folder and its spec documents move to the archive intact, and a \
                       `record.md` is sealed at the work's root first, while any worktrees are still \
                       alive: for each project it captures the declared branch, the worktree \
                       HEAD, whether the branch reached the project's base branch, and the \
                       commits and files it carried. Any worktrees are then removed, and when \
                       there were any, the branch they share is kept in each of those \
                       repositories. Any status can be archived and \
                       the status is not changed — an abandoned approach is worth putting away \
                       too. Refused when a worktree has uncommitted or untracked files, and the \
                       error names them and says which kind each is. \
                       There is no force option and no way back; use atelier_remove_work \
                       instead for a work that is not worth keeping.",
        annotations(
            read_only_hint = false,
            // 지우지는 않지만 되돌릴 수 없다 — 승인 UI가 가볍게 취급하면 안 된다.
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn atelier_archive_work(
        &self,
        Parameters(ArchiveWorkParams { work_slug }): Parameters<ArchiveWorkParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match atelier_core::archive_work(
            &self.works_root,
            &self.archive_root,
            // 기록 렌더가 base 브랜치 한 줄에만 쓴다. Maison에는 프로젝트가 없으므로
            // 프로젝트 0개와 같은 갈래로 지난다.
            self.shared_projects_root(),
            &work_slug,
        ) {
            // 프로젝트가 없던 work는 브랜치도 워크트리도 없다 — "브랜치는 남아 있다"가
            // 거짓이 된다 (atelier_remove_work가 같은 이유로 안내를 갈라 두었다).
            Ok(view) => {
                let note = match view.work.branch {
                    Some(_) => {
                        "Archived. The work is no longer in atelier_list_works. Its spec \
                         documents moved with it and `record.md` next to them holds the git \
                         coordinates. The branch still exists in every project repository, so \
                         committed work is recoverable — the worktrees are not."
                    }
                    None => {
                        "Archived. The work is no longer in atelier_list_works. It had no \
                         project and no branch, so there is no code to recover anywhere: the \
                         spec documents that moved with it are the whole record."
                    }
                };
                Ok(CallToolResult::success(vec![
                    ContentBlock::json(&view)?,
                    ContentBlock::text(note),
                ]))
            }
            Err(e) => Ok(kernel_error(e)),
        }
    }
}
