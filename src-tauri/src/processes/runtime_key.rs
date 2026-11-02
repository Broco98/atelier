//! Runtime 키 — `<세대>:<채팅 id>`(restart 스펙 「03 — Processes」 Runtime · 티켓 03-7). 채팅의 Runtime을 띄울 때 엔진이 env에 심는 표식
//! (`atelier_acp::RUNTIME_KEY_ENV`)의 값이다. 셸 키(`shell_key` — `<세대>-<PTY 번호>`)와 같은 일을 한다: 판정이 그 값으로 「이 실행의 어느
//! 채팅이 띄웠나」를 가르고, 부모가 먼저 죽은 dev 서버도 그 채팅에 묶는다. **짓는 규칙과 읽는 규칙이 이 모듈 한 자리에 산다** — 짓기
//! (`mint` — 앱이 엔진에 건다, `lib.rs`), 세대와 채팅으로 가르기(`split`), 이 세대의 것인지 가르기(`of_generation`).
//!
//! **구분자는 `:`이다.** 채팅 id는 `YYYYMMDD-HHMMSS`(같은 초면 `-2` …)라 `-`와 숫자로 끝난다 — 셸 키처럼 `-`로 이으면 `<세대>-20261010-100000`이
//! 셸 키의 모양(뒤의 `-` 다음이 숫자)이 되어 두 표식이 한 글자로 겹친다. 세대(`<에포크 ms>p<pid>`, 검사의 `test-…`)와 채팅 id(안전한 slug)에는 `:`가
//! 없다. 그래서 **앞에서 한 번** 자른다.
//!
//! 세대는 셸 키와 같은 이 실행의 세대다(`shell_key::generation`) — 인스턴스 기록의 파일 이름이 그 값이라, 판정이 Runtime 키의 머리로도 그
//! 키를 낸 실행을 찾는다.

use std::sync::OnceLock;

use super::shell_key;

/// 이 채팅의 Runtime 키 — `<이 실행의 세대>:<채팅 id>`. 앱이 엔진에 건다(`HostBuilder::mark_runtimes`).
pub(crate) fn mint(thread: &str) -> String {
    format!("{}:{thread}", shell_key::generation())
}

/// Runtime 키를 세대와 채팅 id로 가른다 — **앞에서 한 번** 자른다. 모양이 아니면 `None`이다: 구분자가 없다, 어느 쪽이 비었다, 채팅 id에
/// 또 `:`가 있다.
pub(crate) fn split(key: &str) -> Option<(&str, &str)> {
    let (generation, thread) = key.split_once(':')?;
    (!generation.is_empty() && !thread.is_empty() && !thread.contains(':')).then_some((generation, thread))
}

/// 이 세대가 지은 Runtime 키인가 — 가른 세대가 온전히 같아야 한다(`split`). 앞글자로만 겹치는 세대(`G` 대 `GX`)를 가른다.
pub(crate) fn of_generation(key: &str, generation: &str) -> bool {
    split(key).is_some_and(|(of, _)| of == generation)
}

/// 앱이 물려받은 Runtime 키 — 앱 env의 표식. 앱을 다른 실행의 채팅이 띄웠을 때만 있다(설치본의 채팅이 Bash로 `pnpm tauri dev`). 판정은
/// 이 키를 문 것을 어느 묶음에도 넣지 않는다 — 앱과 함께 뜬 vite가 그렇다(물려받은 셸 키와 같은 규칙, 프로세스 스펙 S6).
///
/// 뜬 뒤에 안 바뀌므로 한 번 읽는다.
pub(crate) fn inherited() -> Option<&'static str> {
    static KEY: OnceLock<Option<String>> = OnceLock::new();
    KEY.get_or_init(|| std::env::var(atelier_acp::RUNTIME_KEY_ENV).ok().filter(|key| !key.is_empty())).as_deref()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **지은 키는 이 실행의 세대와 그 채팅으로 돌아온다.** 채팅 id에 `-`와 숫자가 있어도(같은 초의 둘째 채팅 `…-2`) 채팅 id는 통째다.
    #[test]
    fn a_minted_key_is_this_runs_generation_and_the_thread() {
        let key = mint("20261010-100000-2");
        assert_eq!(split(&key), Some((shell_key::generation(), "20261010-100000-2")));
        assert!(of_generation(&key, shell_key::generation()), "지은 키가 이 세대의 것이 아니다");
    }

    /// **가르기는 앞에서 한 번 자른다.** 모양이 아니면 `None`이다.
    #[test]
    fn a_key_splits_at_its_first_separator_into_a_generation_and_a_thread() {
        assert_eq!(split("1757000000000:20261010-100000"), Some(("1757000000000", "20261010-100000")));
        assert_eq!(split("test-42-dead:20261010-100000"), Some(("test-42-dead", "20261010-100000")));
        for not_a_key in ["", "1757000000000", "1757000000000:", ":20261010-100000", "G:a:b", "1757000000000-3"] {
            assert_eq!(split(not_a_key), None, "{not_a_key:?}를 Runtime 키로 읽었다");
        }
    }

    /// **이 세대의 것인가.** 세대가 온전히 같아야 한다 — 앞글자로만 겹치는 세대는 아니다. 셸 키는 Runtime 키가 아니다 — 같은 세대의 셸 키를
    /// 이 세대의 Runtime 키로 읽으면 셸의 자손이 채팅에 선다. 거꾸로 Runtime 키도 셸 키의 세대로 읽히지 않는다(`shell_key::of_generation`).
    ///
    /// 앵커: 이 세대의 온전한 키는 이 세대의 것이다.
    #[test]
    fn a_key_is_of_a_generation_only_up_to_the_separator() {
        assert!(of_generation("1700:20261010-100000", "1700"));
        for (key, generation) in [
            ("17000:20261010-100000", "1700"),
            ("1700:20261010-100000", "17000"),
            ("1700-3", "1700"),
            ("1700:", "1700"),
        ] {
            assert!(!of_generation(key, generation), "{key:?}를 세대 {generation:?}의 Runtime 키로 읽었다");
        }
        assert!(!shell_key::of_generation("1700:20261010-100000", "1700"), "Runtime 키를 셸 키로 읽었다");
    }
}
