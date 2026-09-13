//! 종료 확인(결정 14·15·16 · #223 · #224). 앱을 끄는 길은 **프런트가 사람에게 물은 뒤에만** 열린다 —
//! macOS가 스스로 끄는 길(시스템 종료 · 재시동 · 로그아웃 · 예약된 업데이트)만 빼고.
//!
//! 이 파일은 **플랫폼 cfg 밖이다.** 빨간 버튼의 창 닫기(`lib.rs`의 `on_window_event`)와
//! ⌘Q·메뉴 Quit·Dock의 macOS 델리게이트 훅(`terminate.rs`)이 같은 이벤트 이름과 같은 「확인됨」
//! 표시를 쓰고, 그 훅이 무엇을 허락할지(이유 판정 · 패닉이면 허락)도 여기서 정한다. 여기가
//! macOS 전용이 되면 리눅스 CI가 이 판정을 한 줄도 안 잰다(S15). FFI만 `terminate.rs`의 cfg 아래다.
//!
//! **안전판은 없다**(결정 31). 웹뷰가 멈춰 확인 창을 못 띄우면 강제 종료로 끈다 — 그래서
//! 「묻는 중」 표시가 안 내려가는 길을 프런트가 막는다(`quit-request.ts`).

use std::sync::atomic::{AtomicBool, Ordering};

/// 「앱을 끄려 한다」를 프런트에 알리는 이벤트. 프런트의 `QUIT_REQUESTED_EVENT`와 **문자열로만**
/// 이어진다 — 어긋나면 창은 막혔는데 아무도 안 물어 앱을 끌 길이 없어진다. 그래서
/// `src/components/shell/quit-request.test.ts`가 이 선언을 읽어 견준다(선언 모양을 바꾸면 거기가 던진다).
pub const REQUESTED_EVENT: &str = "app:quit-requested";

/// 사람이 「종료」를 골랐는가. **한 번 서면 내리지 않는다** — 선 뒤로는 앱이 꺼지는 중이다.
static CONFIRMED: AtomicBool = AtomicBool::new(false);

/// **「확인됨」을 세우는 유일한 자리**다. `quit_app`이 `app.exit(0)` 앞에서 부른다.
///
/// 세우는 이유: `app.exit`와 이벤트 루프가 멈추는 사이에 #224의 `terminate:` 훅이 끼어들면 그
/// 훅이 다시 막고 물어, 「종료」를 누른 사람 앞에 창이 한 번 더 뜨거나 종료가 멈춘다. 빨간 버튼
/// 쪽은 지금 그 길이 없다 — tauri-runtime-wry 2.11의 `app.exit`는 `RequestExit`로 루프를 바로
/// 끝내 `CloseRequested`를 안 지난다. 그 자리가 이 표시를 보는 것은 두 입구가 규칙 한 벌
/// (「확인됨이면 막지 않는다」)을 쓰게 하려는 것이다.
///
/// 이 성질(`quit_app`만, 끄기 전에)은 자리로 잰다 — `atelier-test-bridge`의
/// `확인됨은_quit_app만_끄기_전에_세운다`.
pub fn confirm() {
    CONFIRMED.store(true, Ordering::SeqCst);
}

/// 「확인됨」이 서 있는가. 서 있으면 막지 않고 그대로 보낸다.
pub fn confirmed() -> bool {
    CONFIRMED.load(Ordering::SeqCst)
}

/// ⌘Q·메뉴 Quit·Dock의 macOS 델리게이트 훅(`terminate.rs`)이 무엇을 허락할지. 훅의 FFI는 macOS에만
/// 있어 리눅스에선 여기 전부가 안 쓰인다 — 그래서 경고 끄기를 **이 모듈 한 자리**에 둔다.
pub mod hook {
    #![cfg_attr(not(target_os = "macos"), allow(dead_code))]

    use std::fmt;

    /// 네 글자 코드(OSType)를 AppKit이 주는 `u32`로 — **네 바이트를 빅엔디언으로 읽는다.** 이 규칙을
    /// 쓰는 자리는 이 함수 하나다(허락 목록 · `terminate.rs`의 `why?` 키워드 · 테스트).
    pub const fn four_cc(four: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*four)
    }

    /// 종료를 막을지의 답. 훅이 AppKit의 `NSTerminateNow`/`NSTerminateCancel`로 옮긴다.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Verdict {
        /// 막지 않는다 — 앱이 그대로 꺼진다.
        Allow,
        /// 막고 프런트에 종료 요청 이벤트를 쏜다 — 끌지는 확인 창이 정한다.
        Ask,
    }

    /// 지금 처리 중인 Apple Event가 말하는 종료 이유(`kAEQuitReason` = `why?` **속성**).
    ///
    /// 셋으로 가르는 것은 「무엇이 없었나」가 곧 누가 불렀는가라서다 — ⌘Q·메뉴 Quit은 `terminate:`를
    /// 직접 불러 **이벤트가 없고**, Dock 종료는 `quit` 이벤트가 오지만 **속성이 없다.**
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum QuitReason {
        NoEvent,
        NoAttribute,
        /// 속성의 네 글자 코드(`four_cc`로 읽은 값).
        Code(u32),
    }

    /// 실패 메시지가 `Code(1936225652)`가 아니라 `Code('shut')`로 읽히게.
    impl fmt::Debug for QuitReason {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            match self {
                QuitReason::NoEvent => f.write_str("NoEvent"),
                QuitReason::NoAttribute => f.write_str("NoAttribute"),
                QuitReason::Code(code) => {
                    write!(f, "Code('{}' = {code:#010x})", String::from_utf8_lossy(&code.to_be_bytes()))
                }
            }
        }
    }

    /// 시스템이 끄는 길 — 확인 전에도 **즉시 허락한다**(결정 16). 로그아웃 중 취소를 돌려주면 로그아웃이
    /// 멈춘다. SDK `AERegistry.h`의 `kAEQuitReason` 값 넷: `quia`(`kAEQuitAll` — 예약된 업데이트 종료) ·
    /// `shut` · `rest` · `rlgo`. `logo`는 허락해도 무해해서 함께 둔다.
    const SYSTEM_QUIT_REASONS: [u32; 5] =
        [four_cc(b"quia"), four_cc(b"shut"), four_cc(b"rest"), four_cc(b"rlgo"), four_cc(b"logo")];

    /// **이유 → 허락/묻기의 순수 판정.** cfg 밖이라 리눅스 CI가 표로 잰다(S15). 「확인됨」이면 무엇이든
    /// 허락하고, 시스템이 끄는 길이면 허락하고, 그 밖(이벤트 없음 · 속성 없음 · 모르는 값)은 묻는다.
    pub fn decide(reason: QuitReason, confirmed: bool) -> Verdict {
        if confirmed {
            return Verdict::Allow;
        }
        match reason {
            QuitReason::Code(code) if SYSTEM_QUIT_REASONS.contains(&code) => Verdict::Allow,
            _ => Verdict::Ask,
        }
    }

    /// `applicationShouldTerminate:`의 본문 전부 — 「확인됨」을 **값으로** 받는다(테스트가 전역 표시와
    /// 안 얽히게). 이유를 읽는 FFI(`read_reason`)와 이벤트를 쏘는 일(`ask`)이 **통째로** `catch_unwind`
    /// 안에서 돈다: 되감기가 FFI 경계를 못 넘고, 어느 쪽이 패닉해도 허락이 나간다(S14). 붙이기가 실패했을
    /// 때(= 훅 없는 동작)와 같은 방향이다 — 취소를 돌려주면 로그아웃이 멈추고(결정 16), 이벤트도 못 쏜
    /// 채라 앱을 끌 길이 강제 종료뿐이다(결정 31).
    pub fn should_terminate(
        confirmed: bool,
        read_reason: impl FnOnce() -> QuitReason,
        ask: impl FnOnce(),
    ) -> Verdict {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let verdict = decide(read_reason(), confirmed);
            if verdict == Verdict::Ask {
                ask();
            }
            verdict
        }))
        .unwrap_or(Verdict::Allow)
    }

    /// 훅이 부르는 것은 이것 하나다 — **지금의** 「확인됨」 표시로 `should_terminate`를 돈다. `quit_app`과
    /// 루프 정지 사이에 끼어든 `terminate:`가 여기서 허락을 받는다.
    pub fn application_should_terminate(
        read_reason: impl FnOnce() -> QuitReason,
        ask: impl FnOnce(),
    ) -> Verdict {
        should_terminate(super::confirmed(), read_reason, ask)
    }
}

#[cfg(test)]
mod tests {
    use super::hook::*;
    use super::*;

    /// **「확인됨」은 확정 함수 하나만 세운다.** 앱이 뜬 순간부터 서 있으면 빨간 버튼이 묻지 않고
    /// 창을 닫고, 확정 뒤에도 안 서면 #224의 `terminate:` 훅이 `quit_app`이 부른 종료를 다시 막는다.
    ///
    /// 전역 표시라 **이 테스트 하나만** 만진다 — 둘이 나눠 쓰면 실행 순서가 결과를 정한다. 표시를 읽는
    /// 함수(`confirmed` · `application_should_terminate`)도 이 테스트만 부른다.
    ///
    /// **훅이 부르는 입구가 표시를 읽는가도 여기서 잰다**(#224). 입구가 표시를 안 읽고 다른 값을 보면,
    /// `quit_app`이 끄는 사이 끼어든 `terminate:`가 다시 막고 묻는다.
    #[test]
    fn 확정하기_전에는_서_있지_않고_확정하면_선다() {
        assert!(!confirmed(), "아무도 확정하지 않았는데 「확인됨」이 서 있다 — 빨간 버튼이 안 묻는다");
        let mut asked = false;
        assert_eq!(
            application_should_terminate(|| QuitReason::NoEvent, || asked = true),
            Verdict::Ask,
            "확정 전인데 ⌘Q가 묻지 않고 끈다"
        );
        assert!(asked, "확정 전 ⌘Q를 막고도 종료 요청 이벤트를 안 쏜다");

        confirm();
        assert!(confirmed(), "확정했는데 「확인됨」이 안 섰다");
        for reason in [QuitReason::NoEvent, QuitReason::NoAttribute, QuitReason::Code(four_cc(b"zzzz"))] {
            let mut asked = false;
            assert_eq!(
                application_should_terminate(|| reason, || asked = true),
                Verdict::Allow,
                "`quit_app`이 확정한 뒤인데 {reason:?}의 `terminate:`를 다시 막는다"
            );
            assert!(!asked, "확정한 뒤인데 {reason:?}에 확인 창을 또 부른다");
        }
    }

    /// **이유 판정 표**(결정 16 · S14). 시스템이 끄는 넷(+`logo`)은 확인 전에도 허락하고 — 취소를
    /// 돌려주면 로그아웃·재시동이 멈춘다 — 사람이 부른 길(이벤트 없음 = 메뉴·⌘Q · 속성 없음 = Dock ·
    /// 모르는 값)은 묻는다. 「확인됨」이면 무엇이든 허락한다.
    #[test]
    fn 이유_판정_표() {
        let allow = [b"quia", b"shut", b"rest", b"rlgo", b"logo"].map(|four| QuitReason::Code(four_cc(four)));
        for reason in allow {
            assert_eq!(
                decide(reason, false),
                Verdict::Allow,
                "{reason:?}는 시스템이 끄는 길인데 막는다 — 로그아웃·재시동이 멈춘다"
            );
        }
        let ask = [
            QuitReason::NoEvent,
            QuitReason::NoAttribute,
            QuitReason::Code(four_cc(b"quit")),
            QuitReason::Code(four_cc(b"aevt")),
            QuitReason::Code(0),
            // 바이트 순서를 뒤집어 읽으면 허락 목록과 우연히 맞지 않아야 한다.
            QuitReason::Code(u32::from_le_bytes(*b"shut")),
        ];
        for reason in ask {
            assert_eq!(decide(reason, false), Verdict::Ask, "{reason:?}는 사람이 부른 종료인데 안 묻는다");
        }
        for reason in ask.into_iter().chain(allow) {
            assert_eq!(decide(reason, true), Verdict::Allow, "확인된 뒤인데 {reason:?}를 막는다");
        }
    }

    #[test]
    fn 네_글자_코드는_빅엔디언이다() {
        assert_eq!(four_cc(b"shut"), 0x7368_7574);
        assert_eq!(format!("{:?}", QuitReason::Code(four_cc(b"shut"))), "Code('shut' = 0x73687574)");
    }

    /// **핸들러 본문이 통째로 감싸개 안에 있는가**(S14) — 「확인됨」을 `false`로 **넘겨** 전역 표시와
    /// 상관없이 묻는 길을 반드시 탄다. 이유를 읽다가도, 이벤트를 쏘다가도 패닉이면 허락이고 패닉이
    /// 밖으로 안 샌다. 쏘는 쪽은 **실제로 들어갔는지**까지 본다 — 안 들어가고 허락이 나오면 아무것도 안 잰 것이다.
    #[test]
    fn 핸들러는_이유를_읽다_패닉해도_쏘다_패닉해도_허락한다() {
        let read = std::panic::catch_unwind(|| should_terminate(false, || panic!("이유를 못 읽었다"), || {}));
        assert_eq!(read.ok(), Some(Verdict::Allow), "이유를 읽다 난 패닉이 허락으로 안 바뀌거나 밖으로 샌다");

        let entered = std::cell::Cell::new(false);
        let emit = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            should_terminate(false, || QuitReason::Code(four_cc(b"zzzz")), || {
                entered.set(true);
                panic!("못 쐈다")
            })
        }));
        assert!(entered.get(), "확인 전 모르는 이유인데 종료 요청 이벤트를 쏘러 안 들어간다");
        assert_eq!(emit.ok(), Some(Verdict::Allow), "이벤트를 쏘다 난 패닉이 허락으로 안 바뀌거나 밖으로 샌다");

        let mut asked = false;
        assert_eq!(should_terminate(false, || QuitReason::NoEvent, || asked = true), Verdict::Ask);
        assert!(asked, "⌘Q를 막고도 종료 요청 이벤트를 안 쏜다 — 앱을 끌 길이 없다");

        let mut asked = false;
        assert_eq!(should_terminate(false, || QuitReason::Code(four_cc(b"shut")), || asked = true), Verdict::Allow);
        assert!(!asked, "시스템 종료인데 확인 창을 부른다");
    }
}
