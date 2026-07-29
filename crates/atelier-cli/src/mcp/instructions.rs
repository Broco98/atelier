//! 서버 지침 — 초기화 응답의 `instructions` 필드에 실린다.
//!
//! 규율(학습 교재 단계 2의 안티패턴):
//! - 개별 도구 설명을 반복하지 않는다. 도구들이 **어떻게 함께 작동하는지**(순서·의존·제약)만 담는다
//! - 항상 시스템 프롬프트에 상주하므로 짧게 유지한다 (아래 테스트가 단어 수 상한을 강제한다)
//! - CLI 명령 목록을 다시 들이지 않는다 (D3에서 버린 것)

/// 지침 전문. 문장 하나하나가 아래 `tests`의 가드에 걸려 있다 —
/// 고칠 때 무엇이 왜 거기 있는지는 테스트 이름이 말해준다.
pub const INSTRUCTIONS: &str = r#"Atelier organizes local development work. A project is a registered git repository. A work is one feature spanning one or more projects: it owns one branch name shared by every project it touches, one git worktree per project, and one spec directory.

Order matters when starting a work. Call atelier_list_projects first: it gives you the project slugs to pass, and each project's existing branches under `git.localBranches`. A work can also start with no project at all — omit `projects` for an idea that has no code yet, and attach them when it does.

Pick the branch name from those existing branches and always pass it explicitly. Match the pattern already in use — `feat/...` or `feature/...` or a bare name — and note that one name is shared by every project in the work, so it has to fit all of them. If you omit the branch, the work's slug becomes the branch name, which is almost never the repository's convention; a wrong name also creates worktrees on it, which is tedious to unwind.

There is no tool for spec documents. Write them yourself, with your own file tools, into the `specDir` path that atelier_get_work returns. Start with `overview.md`, then add files freely; markdown and mermaid diagrams are welcome. The desktop app watches these folders, so whatever you write shows up immediately — there is nothing to sync. If a skill puts a spec document in the worktree instead, move it into `specDir`; that is the only place the app and the next session look.

Do code work only inside the work's worktree paths (`trees[].path`), never in the project's own folder.

A reference like `~/.atelier/works/<slug>/spec/overview.md:L19-27` is a real path plus a line range: `:L19` means one line, and no suffix means the whole file. Read that file at those lines and follow it.

Paths are written with `~` for the home directory; expand it before opening them."#;

#[cfg(test)]
mod tests {
    use super::INSTRUCTIONS;

    /// 맵에서 확정한 도구 이름 9개. 지침이 이 밖의 이름을 부르면
    /// 에이전트가 존재하지 않는 도구를 찾아 헤맨다.
    const TOOL_NAMES: [&str; 9] = [
        "atelier_list_projects",
        "atelier_list_works",
        "atelier_get_work",
        "atelier_start_work",
        "atelier_attach_project",
        "atelier_set_work_status",
        "atelier_remove_work",
        "atelier_add_project",
        "atelier_edit_project",
    ];

    /// 지침 안에 등장하는 `atelier_…` 토큰을 전부 뽑는다.
    fn mentioned_tools(text: &str) -> Vec<String> {
        text.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .filter(|t| t.starts_with("atelier_"))
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn every_tool_it_names_actually_exists() {
        for name in mentioned_tools(INSTRUCTIONS) {
            assert!(
                TOOL_NAMES.contains(&name.as_str()),
                "instructions name a tool that does not exist: {name}"
            );
        }
    }

    /// D3이 "반드시 살릴 것"으로 지목한 지식. 하나라도 빠지면
    /// 되돌리기 번거로운 실수가 저장소에 남는다.
    #[test]
    fn carries_the_high_damage_knowledge() {
        // 브랜치 컨벤션 — 판단의 데이터 출처와 생략 시의 결과
        assert!(INSTRUCTIONS.contains("git.localBranches"), "no branch source");
        assert!(INSTRUCTIONS.contains("slug becomes the branch"), "no consequence of omitting");
        // spec 규약 — 도구가 아니라 파일시스템, 위치는 조회 응답에서
        assert!(INSTRUCTIONS.contains("no tool for spec"), "spec tool absence not stated");
        assert!(INSTRUCTIONS.contains("specDir"), "no spec location field");
        assert!(INSTRUCTIONS.contains("overview.md"), "no starting document");
        // 워크트리에서만 코드 작업
        assert!(INSTRUCTIONS.contains("trees[].path"), "no worktree rule");
        // 프로젝트 없이 시작하는 경로 — 없으면 에이전트가 이 경로를 영영 안 쓴다
        assert!(INSTRUCTIONS.contains("no project at all"), "the project-less path is hidden");
        // 스킬이 워크트리에 만들어 버린 스펙의 처치 — 안 옮기면 앱에도 다음 세션에도 안 보인다
        assert!(INSTRUCTIONS.contains("move it into `specDir`"), "no rescue for a misplaced spec");
        // 블록 참조 해석 (형식 자체는 refs_ts_still_emits_the_same_reference_shape가 지킨다)
        assert!(INSTRUCTIONS.contains(":L19-27"), "no block reference example");
    }

    /// 항상 시스템 프롬프트에 상주하는 문자열이다. 교재가 안티패턴으로
    /// 지목한 500단어급으로 자라지 않게 상한을 둔다.
    ///
    /// 320 → 360 (#45·#46): 프로젝트 없이 시작하는 경로 한 문장과, 스펙 문서가
    /// 워크트리에 생겼을 때 `specDir`로 옮기라는 규율 한 문장을 더했다. 둘 다
    /// 지침에만 둘 수 있는 지식이다 — 앞의 것은 도구를 고르기 전에, 뒤의 것은
    /// 아틀리에 도구를 부르지 않는 순간에 필요하다. 반면 spec 폴더 다섯 이름의
    /// 뜻은 여기가 아니라 atelier_get_work 응답이 들고 간다: 문서를 쓰기 직전에만
    /// 필요한 지식을 상주시키지 않기 위해서다.
    #[test]
    fn stays_short() {
        let words = INSTRUCTIONS.split_whitespace().count();
        assert!(words <= 360, "instructions grew to {words} words");
    }

    /// D3에서 버린 것이 되돌아오지 않게 한다. 티켓 05가 CLI 명령을
    /// 삭제하므로, 명령 목록이 지침에 남으면 없는 명령을 안내하게 된다.
    #[test]
    fn does_not_reintroduce_cli_commands() {
        for banned in ["atelier project ", "atelier work ", "atelier skill ", "--json"] {
            assert!(
                !INSTRUCTIONS.contains(banned),
                "CLI surface leaked back into the instructions: {banned}"
            );
        }
    }

    /// 블록 참조 형식은 프론트엔드(src/features/works/refs.ts)가 만들고
    /// 이 지침이 해석한다. 한쪽만 바뀌면 앱이 복사해준 참조를 에이전트가
    /// 못 읽는다 — refs.ts 상단 주석이 요구하는 "같은 커밋에서 함께 갱신"을
    /// 부탁이 아니라 규칙으로 만든다.
    #[test]
    fn refs_ts_still_emits_the_same_reference_shape() {
        let refs_ts = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src/features/works/refs.ts"
        ))
        .expect("refs.ts moved; update this test and the instructions together");

        assert!(refs_ts.contains("`${base}:L${start}-${end}`"), "range form changed: {refs_ts}");
        assert!(refs_ts.contains("`${base}:L${start}`"), "single-line form changed: {refs_ts}");
        assert!(refs_ts.contains("~/.atelier/works/"), "reference root changed: {refs_ts}");

        // 지침이 해석하는 형식도 같은 모양이어야 한다
        assert!(INSTRUCTIONS.contains("~/.atelier/works/<slug>/spec/overview.md:L19-27"));
        assert!(INSTRUCTIONS.contains(":L19"));
    }
}
