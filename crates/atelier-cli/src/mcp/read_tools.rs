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

/// 아카이브에서 온 응답에 붙는 안내. `SPEC_LAYOUT` 자리를 대신한다 — 아카이브된 work에
/// "여기에 spec을 쓰라"고 안내하면 정확히 막으려던 실수를 시키게 된다.
const ARCHIVED_NOTE: &str = "\
This work is archived (`origin` is \"archive\"): it has been put away and no longer appears in \
atelier_list_works, and its worktrees are gone — the branch is still in the project \
repositories. Read it freely: `record.md`, in the work's folder one level above `specDir`, \
holds the git coordinates of what was actually done. Do not write into `specDir`. The archive \
is the record of what happened and archiving is not undone; start a new work for anything that \
continues from here.";

/// 단건 조회 응답. 뷰에 **어디서 왔는지**를 덧붙인다 — 커널의 뷰가 아니라 도구 계층이
/// 아는 사실이다(루트를 두 개 보는 쪽이 여기이므로).
#[derive(serde::Serialize)]
struct WorkAnswer<'a> {
    #[serde(flatten)]
    view: &'a atelier_core::WorkView,
    /// `"works"` 또는 `"archive"`
    origin: &'static str,
}

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
        description = "List the Atelier works in progress. A work is one feature spanning zero or \
                       more projects, sharing a single branch name. Each entry carries the shared \
                       branch, the per-project worktree paths, the spec directory and the spec \
                       files already written. Works that have been archived are not here — see \
                       atelier_list_archive. Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_list_works(&self) -> Result<CallToolResult, ErrorData> {
        match atelier_core::list_works(&self.works_root) {
            Ok(views) => Ok(CallToolResult::success(vec![ContentBlock::json(&views)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }

    #[tool(
        description = "List the archived works: everything put away with atelier_archive_work, \
                       most recently archived first. Deliberately lightweight — slug, title, the \
                       status it was archived at, the projects it spanned and the date, and \
                       nothing else, because the archive only ever grows. Pass a slug to \
                       atelier_get_work to open one: that hands back its `specDir` and the \
                       documents in it, and the work's folder also holds a `record.md` with the \
                       git coordinates of what was done. Use this to find out what was already \
                       tried and how it ended. Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_list_archive(&self) -> Result<CallToolResult, ErrorData> {
        match atelier_core::list_archive(&self.archive_root) {
            Ok(entries) => Ok(CallToolResult::success(vec![ContentBlock::json(&entries)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }

    #[tool(
        description = "Get one Atelier work by slug: its shared branch, the per-project worktree \
                       paths to do code work in, `specDir` — the directory to write this work's \
                       spec documents into — and `specFiles`, the documents already there. \
                       Write spec documents yourself with your own file tools into `specDir`; \
                       there is no spec-writing tool. The answer also explains what the folder \
                       names inside `specDir` mean. A work that has been archived is found by \
                       the same slug — `origin` then says \"archive\", and it is a record to \
                       read, not a place to write. Paths are written with `~` for your home \
                       directory. Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_get_work(
        &self,
        Parameters(GetWorkParams { work_slug }): Parameters<GetWorkParams>,
    ) -> Result<CallToolResult, ErrorData> {
        // 작업 루트에 없으면 보존소를 본다. "slug 하나를 주면 그 work를 준다"는 정신
        // 모델이 유지돼야, 에이전트가 참조를 보고 도구를 고르기 전에 위치부터 알아낼
        // 필요가 없다. **확장은 이 표면에서만 일어난다** — 커널의 get_work는 작업 루트만
        // 보고, 데스크톱 앱이 그것을 그대로 부른다 (stale한 slug 하나로 아카이브된 work가
        // Works 화면에 그려지면 안 된다).
        let (view, origin) = match atelier_core::get_work(&self.works_root, &work_slug) {
            Ok(view) => (view, "works"),
            Err(atelier_core::Error::WorkNotFound(_)) => {
                match atelier_core::get_work(&self.archive_root, &work_slug) {
                    Ok(view) => (view, "archive"),
                    // 어느 쪽에도 없다 — "없다"를 그대로 올린다
                    Err(e) => return Ok(kernel_error(e)),
                }
            }
            // 망가진 work.json 같은 것은 폴백으로 덮지 않는다. "없다"로 바뀌면 원인을 가린다.
            Err(e) => return Ok(kernel_error(e)),
        };
        let answer = WorkAnswer { view: &view, origin };
        // JSON이 먼저다 — 기계가 읽는 값이고, 안내는 그 뒤에 붙는다
        Ok(CallToolResult::success(vec![
            ContentBlock::json(&answer)?,
            ContentBlock::text(if origin == "archive" { ARCHIVED_NOTE } else { SPEC_LAYOUT }),
        ]))
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
