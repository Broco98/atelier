//! 서버 지침 — 초기화 응답의 `instructions` 필드에 실린다.
//!
//! 규율(학습 교재 단계 2의 안티패턴):
//! - 개별 도구 설명을 반복하지 않는다. 도구들이 **어떻게 함께 작동하는지**(순서·의존·제약)만 담는다
//! - 항상 시스템 프롬프트에 상주하므로 짧게 유지한다 (아래 테스트가 단어 수 상한을 강제한다)
//! - CLI 명령 목록을 다시 들이지 않는다 (D3에서 버린 것)
//!
//! **두 벌이고, 어휘 교체가 아니다.** Atelier 지침은 절차 셋을 강제한다 — 먼저
//! `atelier_list_projects`를 부르고, 브랜치는 기존 것에서 고르고, 코드는 워크트리 안에서만
//! 고친다. Maison에는 그 셋이 통째로 없다(결정 17). 같은 문장의 낱말만 갈면 에이전트는
//! Room에서도 프로젝트를 먼저 찾는다 — 그래서 절차부터 다시 쓴다.

use atelier_core::Mode;

/// 이 서버가 선 세계의 지침. **모드별 선택은 여기 한 자리다** — 부르는 쪽이 다시 고르면
/// 벌이 늘어난 날 그 자리가 낡는다.
pub fn for_mode(mode: Mode) -> &'static str {
    match mode {
        Mode::Atelier => ATELIER,
        Mode::Maison => MAISON,
    }
}

/// Atelier 벌. 문장 하나하나가 아래 `tests`의 가드에 걸려 있다 —
/// 고칠 때 무엇이 왜 거기 있는지는 테스트 이름이 말해준다.
pub const ATELIER: &str = r#"Atelier organizes local development work. A project is a registered git repository. A work is one feature spanning zero or more projects: it owns one branch name shared by every project it touches, one git worktree per project, and one spec directory.

Order matters when starting a work. Call atelier_list_projects first: it gives you the project slugs to pass, and each project's existing branches under `git.localBranches`.

Give every work an explicit `slug` in English kebab-case: it becomes the folder name and the default branch name, and it never changes. Write the `title` in the user's own language. To continue a work that already exists, pass its slug — that is what resumes it, not the title, which the user may have edited since.

When the work has projects, pick the branch name from those existing branches and always pass it explicitly. Match the pattern already in use — `feat/...` or `feature/...` or a bare name — and note that one name is shared by every project in the work. If you omit the branch, the work's slug becomes the branch name, which is rarely the repository's convention, and worktrees are created on it.

There is no tool for spec documents. Write them yourself, with your own file tools, into the `specDir` path that atelier_get_work returns. Start with `overview.md`, then add files freely; markdown and mermaid diagrams are welcome. The desktop app watches these folders, so whatever you write shows up immediately — there is nothing to sync. If a skill puts a spec document in the worktree instead, move it into `specDir`; that is the only place the app and the next session look.

Do code work only inside the work's worktree paths (`worktrees[].path`), never in the project's own folder.

A reference like `~/.atelier/works/<slug>/spec/overview.md:L19-27` is a real path plus a line range: `:L19` means one line, and no suffix means the whole file. Read that file at those lines and follow it. An archived work is referenced the same way under `~/.atelier/archive/<slug>/`.

Paths are written with `~` for the home directory; expand it before opening them."#;

/// Maison 벌. **없는 것을 먼저 말한다** — 에이전트가 이 표면에서 가장 먼저 하려는 일이
/// 「프로젝트 목록을 부르는 것」이라, 그 자리에서 되돌려 보내는 문장이 첫 문단에 있어야 한다.
/// 도구 넷은 실제로 거절되지만(mod.rs의 `refuse_project_work`), 거절은 이미 부른 뒤에 온다.
///
/// **프로젝트 도구 이름을 한 번도 안 적는다.** 이름을 적는 순간 「부르지 말라」는 문장조차
/// 그 도구를 후보로 세운다 — 없는 세계에서는 이름 자체가 없어야 한다.
pub const MAISON: &str = r#"Maison is where the user's own life and study live, apart from their work. A Room is one topic — finance, health, philosophy — and everything that happens inside it is written down as documents.

A Room has no project, no branch and no worktree, and there is no repository to do code work in. The tools that list, register, edit or attach projects all refuse to run here.

Give every Room an explicit `slug` in English kebab-case: it becomes the folder name and it never changes. Write the `title` in the user's own language. To continue a Room that already exists, pass its slug — that is what resumes it, not the title, which the user may have edited since.

There is no tool for spec documents. Write them yourself, with your own file tools, into the `specDir` path that atelier_get_work returns. Start with `overview.md`, then add files freely; markdown and mermaid diagrams are welcome. The desktop app watches these folders, so whatever you write shows up immediately — there is nothing to sync. If a skill leaves a document somewhere else, move it into `specDir`; that is the only place the app and the next session look.

A reference like `~/.atelier/maison/rooms/<slug>/spec/overview.md:L19-27` is a real path plus a line range: `:L19` means one line, and no suffix means the whole file. Read that file at those lines and follow it. An archived Room is referenced the same way under `~/.atelier/maison/archive/<slug>/`.

Paths are written with `~` for the home directory; expand it before opening them."#;

#[cfg(test)]
mod tests {
    use super::{ATELIER, MAISON};

    /// 두 벌 전부. **공통 검사는 이 표를 돌아야 한다** — 한 벌만 재면 상한도 결합도 나머지
    /// 한 벌에서 조용히 풀린다. 셋째 벌이 생기는 날 여기 한 줄을 더하면 공통 검사가 따라온다.
    const SETS: [(&str, &str); 2] = [("Atelier", ATELIER), ("Maison", MAISON)];

    /// 맵에서 확정한 도구 이름 12개 (#68이 atelier_archive_work를,
    /// #69가 atelier_list_archive를 더했다). 지침이 이 밖의 이름을 부르면
    /// 에이전트가 존재하지 않는 도구를 찾아 헤맨다.
    const TOOL_NAMES: [&str; 12] = [
        "atelier_archive_work",
        "atelier_list_archive",
        "atelier_list_projects",
        "atelier_list_works",
        "atelier_get_work",
        "atelier_start_work",
        "atelier_attach_project",
        "atelier_edit_work",
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

    /// **공통** — 어느 벌이든 없는 도구를 부르면 에이전트가 찾아 헤맨다.
    #[test]
    fn every_tool_it_names_actually_exists() {
        for (mode, text) in SETS {
            for name in mentioned_tools(text) {
                assert!(
                    TOOL_NAMES.contains(&name.as_str()),
                    "{mode} instructions name a tool that does not exist: {name}"
                );
            }
        }
    }

    /// **Atelier 벌** — D3이 "반드시 살릴 것"으로 지목한 지식. 하나라도 빠지면
    /// 되돌리기 번거로운 실수가 저장소에 남는다.
    ///
    /// 이 벌은 #180에서 **한 글자도 안 바뀌었다.** Maison 벌이 생겼다고 이쪽을 다듬으면
    /// 두 세계가 같은 속도로 낡는다 — 여기가 기준선이다.
    #[test]
    fn carries_the_high_damage_knowledge() {
        // 브랜치 컨벤션 — 판단의 데이터 출처와 생략 시의 결과
        assert!(ATELIER.contains("git.localBranches"), "no branch source");
        assert!(ATELIER.contains("slug becomes the branch"), "no consequence of omitting");
        // spec 규약 — 도구가 아니라 파일시스템, 위치는 조회 응답에서
        assert!(ATELIER.contains("no tool for spec"), "spec tool absence not stated");
        assert!(ATELIER.contains("specDir"), "no spec location field");
        assert!(ATELIER.contains("overview.md"), "no starting document");
        // 워크트리에서만 코드 작업 — 응답 필드 이름과 같은 말이어야 한다
        assert!(ATELIER.contains("worktrees[].path"), "no worktree rule");
        // 정의 문장 — 에이전트가 가장 먼저 읽는 줄이다. "one or more"로 되돌아가면
        // 프로젝트 없이 시작하는 경로를 첫 줄부터 부정하게 된다 (실제로 한 번 그랬다)
        assert!(
            ATELIER.contains("spanning zero or more projects"),
            "the definition sentence denies the project-less path"
        );
        // 브랜치 규칙은 "프로젝트가 있을 때"로 한정돼 있어야 한다 — 한정이 빠지면
        // 프로젝트 없이 시작하는 경로(브랜치도 워크트리도 안 생긴다)에 대해 거짓이 된다
        assert!(
            ATELIER.contains("When the work has projects"),
            "the branch rule lost its scope and now lies about the project-less path"
        );
        // 스킬이 워크트리에 만들어 버린 스펙의 처치 — 안 옮기면 앱에도 다음 세션에도 안 보인다
        assert!(ATELIER.contains("move it into `specDir`"), "no rescue for a misplaced spec");
        // 블록 참조 해석 (형식 자체는 refs_ts_still_emits_the_same_line_range_shape가 지킨다)
        assert!(ATELIER.contains(":L19-27"), "no block reference example");
    }

    /// **Atelier 벌** — 절차 셋. 이 셋이 Maison에 없다는 것이 「두 벌이 필요하다」의 근거
    /// 전부다(결정 15). 여기서 하나가 사라지면 Maison 벌은 어휘만 다른 복사본이 된다.
    #[test]
    fn the_atelier_set_orders_the_project_procedure() {
        for (procedure, why) in [
            ("Call atelier_list_projects first", "프로젝트를 먼저 부르는 순서"),
            ("pick the branch name from those existing branches", "브랜치는 기존 것에서 고른다"),
            ("Do code work only inside", "코드는 워크트리 안에서만"),
        ] {
            assert!(ATELIER.contains(procedure), "Atelier 벌이 절차를 잃었다 ({why}): {procedure}");
        }
    }

    /// **Maison 벌** — 「없다」 문장과 Room의 절차. 이 벌의 요점은 더한 것이 아니라 **뺀
    /// 것**이라, 뺐다는 사실 자체를 검사가 붙들어야 한다.
    #[test]
    fn the_maison_set_says_a_room_has_none_of_that() {
        assert!(
            MAISON.contains("no project, no branch and no worktree"),
            "Room에 없는 셋을 안 적었다: {MAISON}"
        );
        // **거절 예고가 넷을 다 덮어야 한다.** 실제로 거절되는 것은 넷인데(mod.rs의
        // `refuse_project_work`) 문장이 「register or attach」만 말하면 읽기 전용 조회는
        // 범위 밖으로 읽힌다 — 그런데 에이전트가 이 표면에서 가장 먼저 하려는 일이 바로
        // 그 조회다. 여기서 안 막으면 지침은 「이미 막았다」고 적힌 채 호출이 그대로 나간다.
        //
        // **그 한 문장 안에서 잰다.** 지침 전체에서 낱말을 찾으면 엉뚱한 자리의 "list"가
        // 검사를 대신 통과시킨다. 문장이 사라지면 여기서 터진다 — 못 찾으면 통과가 아니다.
        let refusal = MAISON
            .lines()
            .find(|line| line.contains("refuse to run here"))
            .unwrap_or_else(|| panic!("거절 예고 문장이 사라졌다: {MAISON}"));
        for verb in ["list", "register", "edit", "attach"] {
            assert!(
                refusal.contains(verb),
                "거절 예고가 프로젝트 도구 하나를 안 덮는다 ({verb}): {refusal}"
            );
        }
        // Atelier 절차 셋은 **한 조각도** 새어 들어오면 안 된다 — 하나라도 남으면 에이전트가
        // 없는 것을 찾아 나선다.
        for leaked in [
            "atelier_list_projects",
            "git.localBranches",
            "worktrees[].path",
            // Maison 벌은 「코드를 고칠 저장소가 없다」고 말한다 — 금지되는 것은 그 말이
            // 아니라 **워크트리 안에서만 고치라는 Atelier 절차 문장**이다.
            "Do code work only inside",
        ] {
            assert!(!MAISON.contains(leaked), "Atelier 절차가 Maison 벌에 샜다: {leaked}");
        }
        // Room을 만들고 이어 가는 절차는 남아 있어야 한다 — 뺀 자리에 아무것도 안 두면
        // 에이전트가 slug를 지어내고 spec을 아무 데나 쓴다.
        for kept in ["kebab-case", "specDir", "overview.md", "pass its slug"] {
            assert!(MAISON.contains(kept), "Room의 절차가 빠졌다: {kept}");
        }
    }

    /// **공통** — 항상 시스템 프롬프트에 상주하는 문자열이다. 교재가 안티패턴으로
    /// 지목한 500단어급으로 자라지 않게 상한을 둔다.
    ///
    /// 320 → 350 (#46): 스펙 문서가 워크트리에 생겼을 때 `specDir`로 옮기라는 규율
    /// 한 문장을 더했다. 아틀리에 도구를 부르지 않는 순간에 필요한 지식이라 여기
    /// 말고는 둘 자리가 없다. 반면 프로젝트 없이 시작하는 경로는 atelier_start_work의
    /// 설명이, spec 폴더 다섯 이름의 뜻은 atelier_get_work의 응답이 들고 간다 —
    /// 도구를 고르거나 문서를 쓰기 직전에만 필요한 지식을 상주시키지 않기 위해서다.
    ///
    /// **벌마다 잰다.** 두 벌을 합쳐 재면 상한이 사실상 두 배가 되는데, 한 셸에 상주하는
    /// 것은 자기 모드의 한 벌이라 그 셈은 재는 대상이 아니다.
    #[test]
    fn stays_short() {
        for (mode, text) in SETS {
            let words = text.split_whitespace().count();
            assert!(words <= 350, "{mode} instructions grew to {words} words");
        }
    }

    /// D3에서 버린 것이 되돌아오지 않게 한다. 티켓 05가 CLI 명령을
    /// 삭제하므로, 명령 목록이 지침에 남으면 없는 명령을 안내하게 된다.
    const BANNED_CLI: [&str; 4] =
        ["atelier project ", "atelier work ", "atelier skill ", "--json"];

    /// **공통** — 벌이 늘어도 없어진 CLI를 광고하는 벌이 하나도 없어야 한다.
    #[test]
    fn does_not_reintroduce_cli_commands() {
        for (mode, text) in SETS {
            for banned in BANNED_CLI {
                assert!(
                    !text.contains(banned),
                    "CLI surface leaked back into the {mode} instructions: {banned}"
                );
            }
        }
    }

    /// 같은 금지 규칙이 앱 문구에도 걸린다. 지침만 검사하던 위 테스트는
    /// 앱의 빈 상태가 `atelier work start ...`를 안내하는 것을 놓쳤다 —
    /// 없어진 CLI를 광고하는 자리는 지침만이 아니다 (refs_ts_… 와 같은 방식으로
    /// 프론트엔드 소스를 직접 읽는다).
    #[test]
    fn the_app_does_not_advertise_cli_commands_either() {
        // WorkList.tsx는 사이드바로 옮겨지며 SidebarWorkList.tsx가 됐다 (PR #71).
        // 이 테스트가 "moved" 패닉으로 그 사실을 알려주도록 만들어져 있었다 — 이름을 따라간다.
        for rel in ["SidebarWorkList.tsx", "WorksPage.tsx"] {
            let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/features/works/")
                .to_string()
                + rel;
            let source = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("{rel} moved ({e}); update this test with it"));
            for banned in BANNED_CLI {
                assert!(
                    !source.contains(banned),
                    "{rel} advertises a CLI command that does not exist: {banned}"
                );
            }
        }
    }

    /// 앱이 클립보드로 내보내는 참조를 읽는다 (src/features/works/refs.ts).
    /// 파일이 사라지면 여기서 터진다 — 못 읽으면 통과가 아니다.
    fn refs_ts() -> String {
        std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src/features/works/refs.ts"
        ))
        .expect("refs.ts moved; update this test and the instructions together")
    }

    /// 앱이 내보내는 참조의 **뿌리**를 읽는다 (src/mode.ts의 모드 표).
    ///
    /// 형식은 계속 `refs.ts`가 짓지만, 세계마다 다른 앞머리는 #186에서 그 파일을 떠나
    /// 모드 표 한 곳으로 모였다 — 리터럴이 사는 파일을 읽어야 결합이 성립한다.
    /// 파일이 사라지면 여기서 터진다 — 못 읽으면 통과가 아니다.
    fn mode_ts() -> String {
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/mode.ts"))
            .expect("mode.ts moved; update this test and the instructions together")
    }

    /// 세계마다 참조 뿌리 둘 — (벌 이름, 지침, work 뿌리, 아카이브 뿌리).
    ///
    /// **표를 돈다**(위 `SETS`와 같은 규율). 뿌리는 세계마다 다르지만 맞대는 **모양**은
    /// 하나라, 벌별로 검사를 손으로 하나씩 두면 셋째 벌이 생기는 날 그 세계만 결합 없이
    /// 산다 — 실제로 Maison 벌이 한 판 동안 절반만 물려 있었다.
    const REFERENCE_ROOTS: [(&str, &str, &str, &str); 2] = [
        ("Atelier", ATELIER, "~/.atelier/works/", "~/.atelier/archive/"),
        ("Maison", MAISON, "~/.atelier/maison/rooms/", "~/.atelier/maison/archive/"),
    ];

    /// **공통** — 블록 참조 형식은 프론트엔드(src/features/works/refs.ts)가 만들고
    /// 이 지침이 해석한다. 한쪽만 바뀌면 앱이 복사해준 참조를 에이전트가
    /// 못 읽는다 — refs.ts 상단 주석이 요구하는 "같은 커밋에서 함께 갱신"을
    /// 부탁이 아니라 규칙으로 만든다.
    ///
    /// **줄범위 꼬리표는 뿌리와 무관하다** — refs.ts의 `withLines`가 한 자리에서 만들어
    /// 두 뿌리에 같은 모양으로 붙으므로, 형식 쪽은 두 벌 다 같은 검사를 받는다.
    /// 뿌리는 세계마다 달라 아래 `the_instructions_read_the_roots_the_app_writes` 하나가
    /// `REFERENCE_ROOTS` 표를 돌며 든다 — 벌별 검사 둘이던 자리다(#186이 합쳤다).
    #[test]
    fn refs_ts_still_emits_the_same_line_range_shape() {
        let refs_ts = refs_ts();
        assert!(refs_ts.contains("`${base}:L${start}-${end}`"), "range form changed: {refs_ts}");
        assert!(refs_ts.contains("`${base}:L${start}`"), "single-line form changed: {refs_ts}");

        for (mode, text) in SETS {
            assert!(text.contains(":L19-27"), "{mode} 벌이 줄범위 예시를 잃었다");
            assert!(text.contains(":L19"), "{mode} 벌이 한 줄 표기를 잃었다");
        }
    }

    /// **공통** — 앱이 내는 뿌리와 지침이 읽는 뿌리가 세계마다 같아야 한다. 한쪽만 바뀌면
    /// 앱이 복사해 준 참조가 에이전트에게는 없는 경로가 된다 (Maison에서는 더 나쁘다:
    /// 뿌리가 조용히 `works/`로 되돌아가면 Room 에이전트가 남의 일 폴더를 열어 본다).
    ///
    /// **필드 이름까지 붙여 잰다.** 뿌리 리터럴이 `refs.ts`에서 `mode.ts`로 옮겨 오면서
    /// 읽는 파일이 표 하나가 아니라 주석이 긴 파일이 됐다 — 맨 글자로만 찾으면 예시로
    /// 적힌 경로 하나가 검사를 대신 통과시킨다. `work: "…"`는 그 표에만 있는 모양이다.
    #[test]
    fn the_instructions_read_the_roots_the_app_writes() {
        let mode_ts = mode_ts();
        let refs_ts = refs_ts();
        for (mode, text, work, archive) in REFERENCE_ROOTS {
            // 앱 쪽 — 모드 표가 이 세계의 뿌리 둘을 그대로 든다.
            for (field, root) in [("work", work), ("archive", archive)] {
                assert!(
                    mode_ts.contains(&format!("{field}: {root:?}")),
                    "{mode} 뿌리가 mode.ts의 모드 표에 없다: {field}: {root:?}"
                );
                // **그리고 emitter에는 그 글자가 없다.** 이 검사가 `mode.ts`만 읽게 되면서
                // 「그 표를 읽는 것이 `refs.ts`다」가 주석 하나로만 서 있게 됐다 — 누가 뿌리를
                // 저기 인라인으로 되돌린 뒤 표를 안 고치면 표는 죽은 값이 되고, 앱이
                // 클립보드로 내는 참조와 이 지침이 갈린 채 L0~L3가 전부 초록이다.
                //
                // **「부른다」가 아니라 「글자가 없다」로 잰다.** `refPrefixesOf`를 찾는
                // 모양은 주석 한 줄로도 충족돼 fail-open이고, 이쪽은 주석에 적어도 빨개진다
                // (SidebarWorkList.test.tsx의 같은 규율).
                assert!(
                    !refs_ts.contains(root),
                    "refs.ts가 {mode} 뿌리를 글자로 들고 있다 — 모드 표를 안 읽는다: {root}"
                );
            }
            // 지침 쪽 — 같은 뿌리를 예시 문장이 읽는다. 아카이브 화면도 클립보드로 참조를
            // 내보내므로(ArchivePage) 뿌리가 둘이면 가드도 둘이어야 한다.
            assert!(
                text.contains(&format!("{work}<slug>/spec/overview.md:L19-27")),
                "{mode} 벌이 work 뿌리를 잃었다: {work}"
            );
            assert!(
                text.contains(&format!("{archive}<slug>/")),
                "앱이 아카이브 참조를 복사해 주는데 {mode} 벌이 그 뿌리를 모른다: {archive}"
            );
            // 그리고 **저쪽 세계의 뿌리는 한 글자도 없다.** 위 두 줄만으로는 두 뿌리를
            // 나란히 적어 둔 벌도 초록이다 — 그런 벌을 읽은 에이전트는 남의 세계를 연다.
            for (other, _, other_work, other_archive) in REFERENCE_ROOTS {
                if other == mode {
                    continue;
                }
                for root in [other_work, other_archive] {
                    assert!(
                        !text.contains(root),
                        "{mode} 벌이 {other} 뿌리를 가리킨다 — 에이전트가 남의 폴더를 연다: {root}"
                    );
                }
            }
        }
    }
}
