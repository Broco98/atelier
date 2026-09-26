//! 셸 키 — `<세대>-<PTY 번호>`(프로세스 결정 3 · 프로세스 스펙 S34). 셸 하나를 가리키는 이름이다: 셸 env의 표식
//! (`ATELIER_SHELL`)의 값, 훅 상태 파일의 이름(`shells::state_path`), 셸 띄우기 답의 `shellKey`, 인스턴스 기록의 목록이 모두 이
//! 값이다. **짓는 규칙과 읽는 규칙이 이 모듈 한 자리에 산다** — 짓기(`mint`), 이 세대의 것인지 가르기(`of_generation`), 세대와
//! 번호로 가르기(`split`). 읽는 자리(판정 · 화면 · 훅 상태 파일의 읽기와 쓸기)가 규칙을 따로 적으면 한 자리만 옛 규칙으로
//! 남는다 — 훅 상태 파일의 읽기가 머리(`<세대>-`)만 보던 것이 그랬다.
//!
//! **세대는 이 실행을 가리키는 값이다**(`generation`). 셸 번호는 실행마다 0부터 다시 나므로 세대가 실행끼리 갈라 준다. 인스턴스
//! 기록의 파일 이름도 이 값이다(`instances`).
//!
//! **프런트의 짝은 `src/features/terminal/shell-key.ts`다**(`ptyIdOf` — 키에서 PTY 번호를 되뽑는다). 두 언어는 규칙을 글자로만
//! 나눈다: 구분자는 하나, 뒤에서 한 번 자르고, 꼬리는 숫자다. 한쪽을 바꾸면 다른 쪽도 함께 바꾼다.

use std::sync::OnceLock;
use std::time::SystemTime;

use super::clock;

/// 이 셸의 키 — `<세대>-<PTY 번호>`.
///
/// **세대가 실행마다 바뀌는 것이 이 모양의 값이다.** 상태 파일은 셸 키로 이름 지어지는데, 앱을 껐다 켜면 PTY 번호는 다시
/// 0부터 나므로 세대가 없으면 지난 실행이 남긴 파일이 이번 실행의 새 셸에 그대로 붙는다 — 뜨자마자 「나를 기다림」인 셸이
/// 생긴다. 세대가 갈라 준다.
///
/// 구분자를 **하나만** 둔다. 되읽는 쪽(`split`, 프런트의 `ptyIdOf`)이 뒤에서 한 번만 자르면 되도록.
pub(crate) fn mint(pty_id: u32) -> String {
    format!("{}-{pty_id}", generation())
}

/// 이 실행의 세대. 한 번 잡히면 프로세스가 사는 동안 안 바뀐다.
///
/// **잡히는 순간은 이 함수가 처음 불린 때다** — `OnceLock`이 지연 초기화이기 때문이다.
/// 지금 그 첫 호출자는 `lib.rs`의 `setup`에서 도는 `shells::sweep(&root, &instances::live_generations(&root))`
/// (그 안의 `live_generations`)라, 값은 사실상 **앱이 뜬 시각**이다. 이 함수가 기대는 성질은 그것이 아니라 「실행끼리
/// 안 겹친다」 하나이므로 첫 호출자가 누구든 다 서지만, 남은 파일을 눈으로 볼 때 시각이
/// 앱을 켠 때와 맞는 것은 그 배선 덕이다.
///
/// **정리(`shells::sweep`)가 남길 이 실행의 세대는 반드시 이 함수에서 온다**(`instances::live_generations`) — 앱 시작 시각을
/// 따로 재면 두 값이 갈라져 살아 있는 셸의 상태 파일을 지운다. 그 둘이 갈리는 순간은
/// `shells.rs`의 `a_sweep_keeps_the_file_a_live_shell_is_named_with`가 값으로 잡는다.
///
/// **인스턴스 기록의 세대(파일 이름)도 이 값이다**(`pty::open_record`). 판정은 셸 키의 머리로 그 키를 낸 기록을 찾으니,
/// 기록 이름을 따로 지으면 이 실행의 셸 자손이 제 기록을 못 찾아 「출처 불명」이 된다.
pub(crate) fn generation() -> &'static str {
    static GENERATION: OnceLock<String> = OnceLock::new();
    GENERATION.get_or_init(|| generation_at(SystemTime::now()))
}

/// 시각 하나 → 세대 하나 — 그 시각의 에포크 ms(`clock::ms_at`). **시계를 인자로 뺀 것은 검사를 위해서다.** 세대의 값은
/// 「실행마다 바뀐다」인데, `SystemTime::now()`를 안에서 부르면 그 성질을 헤드리스로 잴 자리가 없어져 고정 문자열로 갈아도
/// 아무 검사가 안 울린다 — 그러면 지난 실행이 남긴 파일이 새 셸에 그대로 붙는다는, 세대를 둔 이유가 통째로 사라진다.
///
/// 시각을 쓰는 이유는 실행끼리 겹치지 않으면서 **순서가 읽히기** 때문이다 — 남은 파일을 눈으로 볼 때 어느 실행 것인지 안다.
/// 시계가 뒤로 가는 경우(`UNIX_EPOCH` 이전)는 0으로 눕는다(`clock`). 그때 두 실행이 같은 세대를 가질 수 있지만, 그 상황에서
/// 할 수 있는 더 나은 일이 없고 대가는 「지난 파일 몇 개가 안 지워진다」뿐이다.
fn generation_at(t: SystemTime) -> String {
    clock::ms_at(t).to_string()
}

/// 셸 키를 세대와 PTY 번호로 가른다 — **뒤에서 한 번** 자른다. 세대에도 `-`가 있을 수 있어서다(검사가 짓는
/// `test-<pid>-dead` 같은 세대). 모양이 아니면 `None`이다: 구분자가 없다, 세대가 비었다, 꼬리가 숫자만이 아니다(빈 꼬리,
/// `+1`, `1a`), 꼬리가 PTY 번호(`u32`)에 안 든다.
pub(crate) fn split(key: &str) -> Option<(&str, u32)> {
    let (generation, number) = key.rsplit_once('-')?;
    if generation.is_empty() || number.is_empty() || !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((generation, number.parse().ok()?))
}

/// 이 세대가 지은 셸 키인가 — 가른 세대가 온전히 같아야 한다(`split`). 앞글자로만 겹치는 다른 세대(`G` 대 `GX`)와, 이 세대의
/// 머리를 달았지만 꼬리가 PTY 번호가 아닌 것(`G-x` · `G-`)을 가른다. 판정(이 세대의 표식), 화면(다른 인스턴스를 그 실행으로 묶기),
/// 훅 상태 파일의 정리(살아 있는 실행의 세대, `shells::sweep`) · 읽기(이 실행의 세대, `shells::scan`)가 이 규칙 하나를 쓴다.
pub(crate) fn of_generation(key: &str, generation: &str) -> bool {
    split(key).is_some_and(|(of, _)| of == generation)
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    use super::*;

    /// 셸 키의 **모양**. `<세대>-<PTY 번호>`이고, 세대는 한 실행 안에서 안 바뀐다. 세대가 실행마다 바뀌는 것이 이 모양의
    /// 값이다 — 앱을 껐다 켜면 지난 실행이 남긴 상태 파일이 새 셸에 안 붙는다.
    ///
    /// 구분자가 **하나**인 것도 함께 잰다. 상태 파일 이름에서 PTY 번호를 되뽑는 쪽이 갈라 읽을 자리가 둘이면 어느 쪽이
    /// 세대인지 알 수 없다. 지은 키는 되읽는 규칙(`split`)으로 그 세대와 그 번호로 돌아온다.
    #[test]
    fn a_minted_key_is_this_runs_generation_and_the_pty_id() {
        let three = mint(3);
        // **자는 것이 이 검사의 핵심이다 — 「느린 테스트」로 읽고 걷어 내지 마라.** 아래
        // 마지막 단언이 재려는 것은 세대의 메모이제이션(`generation`의 `OnceLock`)인데,
        // 세대는 **밀리초** 시계라 두 호출을 붙여 부르면 메모이제이션을 걷어 낸 판에서도
        // 두 값이 우연히 같게 나온다(실측: 메모이제이션 없는 판으로 1만 번 돌려 1만 번
        // 통과). 눈금보다 벌려야 그 변형이 빨개진다.
        std::thread::sleep(Duration::from_millis(2));
        let seven = mint(7);

        assert_eq!(split(&three), Some((generation(), 3)), "지은 키가 이 실행의 세대와 그 번호로 안 돌아온다");
        assert!(!generation().is_empty(), "세대가 비었다 — 실행을 못 가른다");
        assert_eq!(three.matches('-').count(), 1, "구분자가 하나가 아니다 — 파일 이름에서 PTY 번호를 되뽑을 자리가 흐려진다");
        assert_eq!(
            split(&seven).map(|(of, _)| of),
            split(&three).map(|(of, _)| of),
            "한 실행 안에서 세대가 바뀌었다 — 같은 실행의 셸들이 남남이 된다"
        );
        assert_eq!(split(&seven).map(|(_, number)| number), Some(7));
    }

    /// **세대의 값은 「실행마다 바뀐다」이다.** 그것이 없으면 지난 실행이 남긴 `~/.atelier/shells/<세대>-0.json`이 이번 실행의
    /// 첫 셸에 그대로 붙어 뜨자마자 「나를 기다림」인 셸이 생긴다. `generation`을 고정 문자열로 갈아도 다른 검사는 전부
    /// 초록이므로, 시계를 인자로 뺀 순수 함수 쪽에서 값으로 잰다.
    #[test]
    fn two_different_clocks_give_two_different_generations() {
        let early = generation_at(UNIX_EPOCH + Duration::from_millis(1_700_000_000_000));
        let late = generation_at(UNIX_EPOCH + Duration::from_millis(1_700_000_000_001));

        assert_eq!(early, "1700000000000", "세대가 epoch 밀리초가 아니다");
        assert_ne!(early, late, "다른 시각이 같은 세대를 냈다 — 실행을 못 가른다");
    }

    /// 시계가 `UNIX_EPOCH` 이전으로 가 있으면 세대는 `0`으로 눕는다 — 셸 띄우기가 무너지지 않는다.
    #[test]
    fn a_clock_before_the_epoch_gives_the_generation_zero() {
        assert_eq!(generation_at(UNIX_EPOCH - Duration::from_secs(1)), "0", "epoch 이전 시각이 0으로 안 눕었다");
    }

    /// **가르기는 뒤에서 한 번 자른다.** 세대에 `-`가 있어도(검사가 짓는 세대) 번호는 마지막 `-` 뒤다. 모양이 아니면 `None`
    /// 이다 — 프런트의 `ptyIdOf`와 같은 표다(`shell-key.test.ts`).
    #[test]
    fn a_key_splits_at_its_last_separator_into_a_generation_and_a_number() {
        assert_eq!(split("1757000000-3"), Some(("1757000000", 3)));
        assert_eq!(split("1757000000-12"), Some(("1757000000", 12)));
        assert_eq!(split("l3-fixture-7"), Some(("l3-fixture", 7)));
        assert_eq!(split("test-42-inherited-1"), Some(("test-42-inherited", 1)));
        for not_a_key in ["", "1757000000", "1757000000-", "1757000000-abc", "1757000000-3x", "-3", "G-+1", "G-99999999999"] {
            assert_eq!(split(not_a_key), None, "{not_a_key:?}를 셸 키로 읽었다");
        }
    }

    /// **이 세대의 것인가.** 세대가 온전히 같고 꼬리가 PTY 번호여야 한다 — 앞글자로만 겹치는 세대(`1700` 대 `17000-1`),
    /// 꼬리가 숫자가 아닌 것(`1700-x`), 빈 꼬리(`1700-`), 번호 뒤에 또 붙은 것(`1700-1-2`)은 이 세대의 것이 아니다.
    ///
    /// 앵커: 이 세대의 온전한 키는 이 세대의 것이다 — 모두 아니라고 무너지면 「아니다」들이 저절로 참이 된다.
    #[test]
    fn a_key_is_of_a_generation_only_up_to_the_separator_and_a_number() {
        assert!(of_generation("1700-1", "1700"));
        assert!(of_generation("1700-12", "1700"));
        assert!(of_generation("test-42-dead-1", "test-42-dead"));
        for (key, generation) in [
            ("17000-1", "1700"),
            ("1700-1", "17000"),
            ("1700-x", "1700"),
            ("1700-", "1700"),
            ("1700-1-2", "1700"),
            ("1700-1a", "1700"),
            ("1700", "1700"),
            ("-1", ""),
        ] {
            assert!(!of_generation(key, generation), "{key:?}를 세대 {generation:?}의 것으로 읽었다");
        }
    }
}
