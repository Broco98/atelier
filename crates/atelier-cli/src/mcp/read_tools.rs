//! 조회 도구 — 읽기 전용, 로컬 파일만 만진다.

use rmcp::{
    handler::server::wrapper::Parameters, model::*, tool, tool_router, ErrorData,
};

use super::{kernel_error, AtelierServer};

/// spec 폴더에서 의미를 갖는 다섯 이름. 조회는 문서를 쓰기 **직전**에 일어나므로
/// 여기가 이 안내의 정확한 자리다 — 항상 상주하는 초기화 지침을 늘리지 않는다.
///
/// 커널의 뷰가 아니라 **도구 계층**이 덧붙인다. 판(Iteration)은 데이터 모델에
/// 들어가지 않고, 아틀리에는 폴더를 만들어 주지도 않는다 (사람과 세션이 만든다).
const SPEC_LAYOUT: &str = "\
Five folder names carry meaning inside `specDir`. Nothing else is fixed — file names are \
free, and a folder that fits none of these is kept and shown just the same.

  overview.md    the work's standing summary; write this first
  NN-<name>/     one iteration, with its plan, tickets, verification and handoff inside. \
Create `01-...` when you first plan, `02-...` for the next round.
  tickets/       that iteration's tickets, normally inside its NN- folder
  research/      findings that outlive any single iteration
  explanation/   understanding worth keeping: why it ended up like this

Atelier never creates these folders and nothing breaks if you skip them. You create them \
with your own file tools; the desktop app just recognises the names.";

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
                       there is no spec-writing tool. The answer also explains what the folder \
                       names inside `specDir` mean. Paths are written with `~` for your home \
                       directory. Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_get_work(
        &self,
        Parameters(GetWorkParams { work_slug }): Parameters<GetWorkParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match atelier_core::get_work(&self.works_root, &work_slug) {
            // JSON이 먼저다 — 기계가 읽는 값이고, 폴더 관습은 그 뒤에 붙는 사람용 안내다
            Ok(view) => Ok(CallToolResult::success(vec![
                ContentBlock::json(&view)?,
                ContentBlock::text(SPEC_LAYOUT),
            ])),
            Err(e) => Ok(kernel_error(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::SPEC_LAYOUT;

    /// 다섯 이름은 두 곳에 적혀 있다 — 에이전트에게 알려주는 여기, 그리고 앱이
    /// 알아보는 트리(src/features/works/SpecTree.tsx). 한쪽만 바뀌면 에이전트가
    /// 만드는 폴더를 앱이 못 알아본다. refs.ts ↔ instructions.rs와 같은 결합이라
    /// 같은 방식으로 — 부탁이 아니라 테스트로 — 묶는다.
    #[test]
    fn the_app_recognises_the_same_folder_names_it_teaches() {
        let spec_tree = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src/features/works/SpecTree.tsx"
        ))
        .expect("SpecTree.tsx moved; update this test and the guidance together");

        for name in ["overview.md", "tickets", "research", "explanation"] {
            assert!(SPEC_LAYOUT.contains(name), "the guidance stopped naming '{name}'");
            assert!(
                spec_tree.contains(&format!("\"{name}\"")),
                "the app no longer recognises '{name}'"
            );
        }
        // 판 폴더만 이름이 아니라 접두로 알아본다 — 양쪽이 같은 규칙이어야 한다
        assert!(SPEC_LAYOUT.contains("NN-"), "the guidance stopped describing the iteration folder");
        assert!(spec_tree.contains(r"/^(\d+)-/"), "the app's iteration pattern changed: {spec_tree}");
    }
}
