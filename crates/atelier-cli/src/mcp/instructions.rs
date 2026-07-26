//! 서버 지침 — 초기화 응답의 `instructions` 필드에 실린다.
//!
//! 규율(학습 교재 단계 2의 안티패턴):
//! - 개별 도구 설명을 반복하지 않는다. 도구들이 **어떻게 함께 작동하는지**(순서·의존·제약)만 담는다
//! - 항상 시스템 프롬프트에 상주하므로 짧게 유지한다 (아래 테스트가 단어 수 상한을 강제한다)
//! - CLI 명령 목록을 다시 들이지 않는다 (D3에서 버린 것)

/// 지침 전문. 문장 하나하나가 아래 `tests`의 가드에 걸려 있다 —
/// 고칠 때 무엇이 왜 거기 있는지는 테스트 이름이 말해준다.
pub const INSTRUCTIONS: &str = r#"Atelier organizes local development work. A project is a registered git repository. A work is one feature spanning one or more projects: it owns one branch name shared by every project it touches, one git worktree per project, and one spec directory.

Order matters when starting a work. Call atelier_list_projects first: it gives you the project slugs you must pass, and each project's existing branches under `git.localBranches`.

Pick the branch name from those existing branches and always pass it explicitly. Match the pattern already in use — `feat/...` or `feature/...` or a bare name — and note that one name is shared by every project in the work, so it has to fit all of them. If you omit the branch, the work's slug becomes the branch name, which is almost never the repository's convention; a wrong name also creates worktrees on it, which is tedious to unwind.

There is no tool for spec documents. Write them yourself, with your own file tools, into the `specDir` path that atelier_get_work returns. Start with `overview.md`, then add files freely; markdown and mermaid diagrams are welcome. The desktop app watches these folders, so whatever you write shows up immediately — there is nothing to sync.

Do code work only inside the work's worktree paths (`trees[].path`), never in the project's own folder.

A reference like `~/.atelier/works/<slug>/spec/overview.md:L19-27` is a real path plus a line range: `:L19` means one line, and no suffix means the whole file. Read that file at those lines and follow it.

Paths are written with `~` for the home directory; expand it before opening them."#;
