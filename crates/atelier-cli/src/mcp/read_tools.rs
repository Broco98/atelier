//! 조회 도구 — 읽기 전용, 로컬 파일만 만진다.

use rmcp::{
    handler::server::wrapper::Parameters, model::*, tool, tool_router, ErrorData,
};

use super::{kernel_error, AtelierServer, DO_NOT_CALL_PROJECT_TOOLS};

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
///
/// **두 벌인 이유.** 「워크트리는 사라졌고 브랜치는 저장소에 남아 있다」는 브랜치가 있던
/// work에만 참이다. 프로젝트 0개로 끝난 work — Maison의 Room은 **전부** 이쪽이다 — 에게
/// 그 문장을 주면 에이전트가 없는 브랜치를 찾으러 간다. 가리키는 `record.md`와도 어긋난다:
/// 프로젝트가 없으면 그 문서에 git 좌표 섹션이 아예 안 실린다 (커널의
/// `record_without_a_project_registry_is_the_same_document`가 그 모양을 못박는다).
///
/// 이 응답 본문은 `#[tool(description = ...)]`과 달리 `&self` 메서드가 내보내므로 **갈 수
/// 있다** — 「도구 설명은 모드별로 못 가른다」는 #180의 전제가 여기엔 안 걸린다. 옆자리
/// `atelier_archive_work`가 같은 이유로 이미 `branch`의 유무로 안내를 갈라 두었고, 갈림의
/// 기준도 같은 값이어야 한다: 같은 work를 두 도구가 다르게 말하면 안 된다.
///
/// 두 벌이 통째로 적혀 있는 것은 의도다. 공통 부분을 조각으로 빼면 문장이 어디서 갈리는지가
/// 안 보이고, 어긋남은 아래 단위 테스트가 표로 붙든다.
const ARCHIVED_NOTE_WITH_CODE: &str = "\
This work is archived (`origin` is \"archive\"): it has been put away and no longer appears in \
atelier_list_works, and its worktrees are gone — the branch is still in the project \
repositories. Read it freely: `record.md`, in the work's folder one level above `specDir`, \
holds the git coordinates of what was actually done. Do not write into `specDir`. The archive \
is the record of what happened and archiving is not undone; start a new work for anything that \
continues from here.";

/// 프로젝트도 브랜치도 없던 work — Room을 포함한다. **찾으러 갈 곳이 없다고 말한다.**
const ARCHIVED_NOTE_WITHOUT_CODE: &str = "\
This work is archived (`origin` is \"archive\"): it has been put away and no longer appears in \
atelier_list_works. It had no project and no branch, so there is nothing to look for in any \
repository: the documents that moved with it are the whole record. Read them freely; \
`record.md`, in the work's folder one level above `specDir`, says when it was put away and at \
what status. Do not write into `specDir`. The archive is the record of what happened and \
archiving is not undone; start a new work for anything that continues from here.";

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
    // 「먼저 이것을 부르라」는 순서는 설명에서 뺐다 — 그 절차는 Atelier에만 있고 설명은
    // 모드별로 못 가른다 (#180). 무엇을 돌려주는지와 브랜치 이름의 출처는 남는다.
    #[tool(
        description = "List the registered Atelier projects: slug, display name, folder path, \
                       baseBranch, description, and `git` — which carries `localBranches`, the \
                       branch names that already exist in that repository. It hands back the \
                       project slugs to pass elsewhere, and `git.localBranches` is where a \
                       branch name matching the repository's convention comes from. \
                       Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_list_projects(&self) -> Result<CallToolResult, ErrorData> {
        // Maison에는 등록부가 없다 — 읽기 전용이라도 저쪽 세계의 목록을 보여 주면
        // 에이전트가 그중 하나를 골라 붙이려 든다 (결정 17).
        if let Some(refusal) = self.refuse_project_work(DO_NOT_CALL_PROJECT_TOOLS) {
            return Ok(refusal);
        }
        match atelier_core::list_projects(&self.projects_root) {
            Ok(views) => Ok(CallToolResult::success(vec![ContentBlock::json(&views)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }

    // 정의 문장(「work는 하나의 기능」)은 지침으로 옮겼다 — Maison에서 이 목록이 돌려주는
    // 것은 Room이라 「기능」도 「공유 브랜치」도 참이 아니다. 프로젝트·브랜치·워크트리는
    // **조건절 안에서만** 말한다.
    //
    // 순서 문장(UI개선 결정 2 · 스토리 33): 순서는 사람이 앱에서 끌어 정한다. 도구가 없다고
    // 말하지 않으면 에이전트가 없는 도구를 찾거나 `.order.json`을 손으로 고친다.
    #[tool(
        description = "List the works in progress: for each entry its slug, title and status, \
                       the spec directory and the spec files already written, and — for one that \
                       spans projects — the branch they share and the worktree path of each. \
                       Anything archived is not here — see atelier_list_archive. \
                       The entries come in the order the user sees in the app: pinned works \
                       first, then the order the user set by dragging. That order is the user's \
                       to set — there is no tool that changes the order. \
                       Read-only; reads local files only.",
        annotations(read_only_hint = true, open_world_hint = false)
    )]
    async fn atelier_list_works(&self) -> Result<CallToolResult, ErrorData> {
        match atelier_core::list_works(&self.works_root) {
            Ok(views) => Ok(CallToolResult::success(vec![ContentBlock::json(&views)?])),
            Err(e) => Ok(kernel_error(e)),
        }
    }

    #[tool(
        description = "List the archived works: everything put away with \
                       atelier_archive_work, most recently archived first. Deliberately \
                       lightweight — slug, title, the status it was archived at, the projects it \
                       spanned if any, and the date, and nothing else, because the archive only \
                       ever grows. Pass a slug to atelier_get_work to open one: that hands back \
                       its `specDir` and the documents in it, and the folder also holds a \
                       `record.md` sealed at archiving time — with the git coordinates of what \
                       was done, when there were projects. Use this to find out what was already \
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
        description = "Get one work by slug: `specDir` — the directory to write its spec \
                       documents into — `specFiles`, the documents already there, and, when it \
                       spans projects, the branch they share and the worktree path of each to do \
                       code work in. Write spec documents yourself with your own file tools into \
                       `specDir`; there is no spec-writing tool. The answer also explains what \
                       the folder names inside `specDir` mean. A work that has been archived \
                       is found by the same slug — `origin` then says \"archive\", and it is a \
                       record to read, not a place to write. Paths are written with `~` for your \
                       home directory. Read-only; reads local files only.",
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
        // 출처는 **값으로 덮어쓴다.** `#[serde(flatten)]`로 덧붙이면 work.json의 미지 필드와
        // 같은 평면에 놓여, 누군가 `origin`이라는 필드를 적어 두면 키가 두 번 나간다. 관대한
        // 파서는 마지막 것을 취하지만, 이 응답을 읽는 것은 LLM이라 앞의 것을 집을 수 있다.
        let answer = match serde_json::to_value(&view) {
            Ok(serde_json::Value::Object(mut map)) => {
                map.insert("origin".to_string(), origin.into());
                Some(serde_json::Value::Object(map))
            }
            // 뷰 직렬화가 실패할 구조는 아니다. 그래도 출처 없이라도 뷰는 준다.
            _ => None,
        };
        // 아카이브 안내는 브랜치의 유무로 갈린다 — `atelier_archive_work`가 쓰는 것과 **같은
        // 값**이다. 다른 값으로 가르면 방금 치운 work를 두 도구가 다르게 설명한다.
        let note = match (origin, view.work.branch.is_some()) {
            ("archive", true) => ARCHIVED_NOTE_WITH_CODE,
            ("archive", false) => ARCHIVED_NOTE_WITHOUT_CODE,
            _ => SPEC_LAYOUT,
        };
        // JSON이 먼저다 — 기계가 읽는 값이고, 안내는 그 뒤에 붙는다
        Ok(CallToolResult::success(vec![
            match &answer {
                Some(value) => ContentBlock::json(value)?,
                None => ContentBlock::json(&view)?,
            },
            ContentBlock::text(note),
        ]))
    }
}

#[cfg(test)]
mod tests {
    use super::{ARCHIVED_NOTE_WITHOUT_CODE, ARCHIVED_NOTE_WITH_CODE, SPEC_LAYOUT};

    /// 두 벌이 갈리는 것은 **가운데 한 대목뿐이어야 한다.** 통째로 적어 둔 대가로 문장이
    /// 따로 낡을 수 있으니, 갈리면 안 되는 대목을 표로 붙든다.
    #[test]
    fn both_archived_notes_still_say_the_same_things_about_the_archive() {
        for shared in [
            // 출처 필드의 뜻 — 에이전트가 JSON의 `origin`과 이 문장을 맞춰 읽는다
            "`origin` is \"archive\"",
            "no longer appears in atelier_list_works",
            // 아카이브의 규약. 이것이 빠지면 에이전트가 치운 자리에 다시 쓴다
            "Do not write into `specDir`",
            "archiving is not undone",
            "start a new work",
        ] {
            for (which, note) in
                [("있던", ARCHIVED_NOTE_WITH_CODE), ("없던", ARCHIVED_NOTE_WITHOUT_CODE)]
            {
                assert!(note.contains(shared), "코드가 {which} 쪽 안내가 잃었다: {shared}\n{note}");
            }
        }
        // 갈리는 대목 — 브랜치·워크트리·git 좌표는 **코드가 있던 쪽에만** 있다.
        // 없던 쪽에 새어 들어오면 Room의 에이전트가 없는 브랜치를 찾으러 간다.
        for presupposing in ["worktrees", "branch is still", "git coordinates"] {
            assert!(
                ARCHIVED_NOTE_WITH_CODE.contains(presupposing),
                "코드가 있던 쪽이 좌표를 잃었다: {presupposing}"
            );
            assert!(
                !ARCHIVED_NOTE_WITHOUT_CODE.contains(presupposing),
                "코드가 없던 work에 없는 것을 약속한다: {presupposing}\n{ARCHIVED_NOTE_WITHOUT_CODE}"
            );
        }
    }

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
