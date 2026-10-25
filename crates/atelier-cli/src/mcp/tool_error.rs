//! 커널 오류를 **도구 실행 오류**(`isError: true`)로 옮긴다.
//!
//! 프로토콜 오류(`Err(ErrorData)`)와 구분된다: 도구는 존재했고 라우팅도 됐으며
//! 실행이 실패한 것이므로, 메시지가 에이전트에게 그대로 닿아야 한다.
//! 그래서 "무엇이 틀렸는가"에 **"다음에 무엇을 하라"**를 항상 덧붙인다.

use atelier_core::Error;
use rmcp::model::{CallToolResult, ContentBlock};

pub fn kernel_error(err: Error) -> CallToolResult {
    // 이 `match`는 **일부러 와일드카드를 두지 않는다** — 변형이 늘 때마다 컴파일러가
    // "다음에 무엇을 하라"를 쓰도록 강제한다. `_ =>` 하나를 넣으면 그 강제가 사라지고,
    // 새 오류는 안내 없이 에이전트에게 나간다.
    let next_step = match &err {
        Error::NotFound(_) | Error::FolderMissing(_) => {
            "Call atelier_list_projects to see the registered project slugs and their folders."
        }
        Error::WorkNotFound(_) => "Call atelier_list_works to see the existing work slugs.",
        // Space(03 구현 스펙 §8)는 바깥 MCP에 도구가 없고 Project 제거도 없다 — 지금 이 두 오류를 내는 도구는 없다. 와일드카드 없는
        // `match`라 갈래를 두고, Space 파일을 읽는 커널 함수를 바깥 도구가 부르게 되면 이 안내가 나간다.
        Error::SpaceNotFound(_) => "That Space no longer exists. Spaces are managed in the Atelier app — tell the user.",
        Error::SpaceProblems(_) => {
            "The Space file has the problems listed above. Ask the user to fix those lines in the Atelier app, then call \
             this tool again."
        }
        // 폴더를 git 저장소로 만드는 것은 사람의 폴더를 바꾸는 일이라 묻고 한다 — 화면의 「git init 하고 추가」와 같은 물음이다.
        Error::NotGitRepo(_) => {
            "Ask the user whether to turn this folder into a git repository. If they agree, \
             call atelier_add_project again with init_git: true — it runs `git init -b main` \
             and an empty first commit, and leaves the files as they are."
        }
        // `git stash`만 시키면 **안 듣는 처방**이다: `-u` 없이는 추적 안 된 파일이 그대로
        // 남아 다시 거부당하고, 읽는 쪽은 왜 막혔는지 알 수 없다. 실제로 그렇게 막혔다.
        Error::DirtyWorktrees(_) => {
            "Commit those files, or stash them with `git stash -u` — plain `git stash` \
             leaves untracked files behind and this will be refused again. Then call \
             this tool again."
        }
        // 기준 브랜치는 그 저장소의 브랜치 목록에 있는 값만 받는다(03 구현 스펙 §15) — 목록을 읽는 자리를 알려 준다.
        Error::BranchNotListed(_) => {
            "Call atelier_list_projects and pass one of that project's branches: `git.localBranches`, or one of \
             `git.remoteBranches[].branches` written as is (like `origin/release/2.5`). Atelier does not fetch — a \
             branch that is only on the remote server has to be fetched by the user first."
        }
        Error::Validation(_)
        | Error::EmptyName
        | Error::AlreadyExists(_)
        | Error::SlugReused(_)
        | Error::NotRepoRoot { .. }
        | Error::AlreadyRegistered { .. } => "Fix the arguments and call this tool again.",
        Error::InvalidFile { .. } | Error::Git(_) | Error::Io(_) => {
            "This is a local data or git problem. Report it to the user instead of retrying."
        }
    };
    CallToolResult::error(vec![ContentBlock::text(format!("{err}\n\n{next_step}"))])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_of(result: &CallToolResult) -> String {
        serde_json::to_string(result).unwrap()
    }

    #[test]
    fn kernel_errors_become_execution_errors_with_a_next_step() {
        let missing_work = kernel_error(atelier_core::Error::WorkNotFound("없음".into()));
        let json = text_of(&missing_work);
        assert_eq!(missing_work.is_error, Some(true), "must be a tool execution error");
        assert!(json.contains("없음"), "the failing input must appear: {json}");
        assert!(json.contains("atelier_list_works"), "no next step: {json}");

        let missing_project = kernel_error(atelier_core::Error::NotFound("nope".into()));
        assert!(text_of(&missing_project).contains("atelier_list_projects"));

        // 검증 실패는 인자를 고쳐 재호출하라고 안내한다
        let invalid = kernel_error(atelier_core::Error::Validation("title must not be empty".into()));
        let json = text_of(&invalid);
        assert!(json.contains("title must not be empty"), "{json}");
        assert!(json.contains("again"), "{json}");
    }
}
