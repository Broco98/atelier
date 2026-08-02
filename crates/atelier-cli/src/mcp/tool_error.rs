//! 커널 오류를 **도구 실행 오류**(`isError: true`)로 옮긴다.
//!
//! 프로토콜 오류(`Err(ErrorData)`)와 구분된다: 도구는 존재했고 라우팅도 됐으며
//! 실행이 실패한 것이므로, 메시지가 에이전트에게 그대로 닿아야 한다.
//! 그래서 "무엇이 틀렸는가"에 **"다음에 무엇을 하라"**를 항상 덧붙인다.

use atelier_core::Error;
use rmcp::model::{CallToolResult, ContentBlock};

pub fn kernel_error(err: Error) -> CallToolResult {
    let next_step = match &err {
        Error::NotFound(_) | Error::FolderMissing(_) => {
            "Call atelier_list_projects to see the registered project slugs and their folders."
        }
        Error::WorkNotFound(_) => "Call atelier_list_works to see the existing work slugs.",
        // `git stash`만 시키면 **안 듣는 처방**이다: `-u` 없이는 추적 안 된 파일이 그대로
        // 남아 다시 거부당하고, 읽는 쪽은 왜 막혔는지 알 수 없다. 실제로 그렇게 막혔다.
        Error::DirtyWorktrees(_) => {
            "Commit those files, or stash them with `git stash -u` — plain `git stash` \
             leaves untracked files behind and this will be refused again. Then call \
             this tool again."
        }
        Error::Validation(_) | Error::EmptyName => "Fix the arguments and call this tool again.",
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
