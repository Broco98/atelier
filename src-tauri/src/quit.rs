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

/// 종료를 막을지의 답. macOS 훅(`terminate.rs`)이 AppKit의 `NSTerminateNow`/`NSTerminateCancel`로 옮긴다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub enum QuitReason {
    NoEvent,
    NoAttribute,
    /// 속성의 네 글자 코드(OSType — 네 바이트를 빅엔디언으로 읽은 값).
    Code(u32),
}

/// 시스템이 끄는 길 — 확인 전에도 **즉시 허락한다**(결정 16). 로그아웃 중 취소를 돌려주면 로그아웃이
/// 멈춘다. SDK `AERegistry.h`의 `kAEQuitReason` 값 넷: `quia`(`kAEQuitAll` — 예약된 업데이트 종료) ·
/// `shut` · `rest` · `rlgo`. `logo`는 허락해도 무해해서 함께 둔다.
const SYSTEM_QUIT_REASONS: [&[u8; 4]; 5] = [b"quia", b"shut", b"rest", b"rlgo", b"logo"];

/// **이유 → 허락/묻기의 순수 판정.** cfg 밖이라 리눅스 CI가 표로 잰다(S15). 「확인됨」이면 무엇이든
/// 허락하고, 시스템이 끄는 길이면 허락하고, 그 밖(이벤트 없음 · 속성 없음 · 모르는 값)은 묻는다.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn decide(reason: QuitReason, confirmed: bool) -> Verdict {
    if confirmed {
        return Verdict::Allow;
    }
    match reason {
        QuitReason::Code(code)
            if SYSTEM_QUIT_REASONS.iter().any(|four| u32::from_be_bytes(**four) == code) =>
        {
            Verdict::Allow
        }
        _ => Verdict::Ask,
    }
}

/// 지금의 「확인됨」 표시로 판정한다 — 훅이 부르는 판정은 이것 하나다. `quit_app`과 루프 정지 사이에
/// 끼어든 `terminate:`가 여기서 허락을 받는다.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn verdict(reason: QuitReason) -> Verdict {
    decide(reason, confirmed())
}

/// **되감기가 FFI 경계를 못 넘게 막고, 패닉이면 허락한다**(S14). 붙이기가 실패했을 때(= 훅 없는 지금
/// 동작)와 같은 방향이다 — 취소를 돌려주면 로그아웃이 멈추고(결정 16), 이벤트도 못 쏜 채라 앱을 끌 길이
/// 강제 종료뿐이다(결정 31).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn guarded(f: impl FnOnce() -> Verdict) -> Verdict {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or(Verdict::Allow)
}

/// `applicationShouldTerminate:`의 본문 전부. 이유를 읽는 FFI(`read_reason`)와 이벤트를 쏘는 일(`ask`)을
/// 받아 **통째로** 감싸개 안에서 돈다 — 어느 쪽이 패닉해도 허락이 나간다.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn answer(read_reason: impl FnOnce() -> QuitReason, ask: impl FnOnce()) -> Verdict {
    guarded(|| {
        let verdict = verdict(read_reason());
        if verdict == Verdict::Ask {
            ask();
        }
        verdict
    })
}

/// 훅이 기대는 네이티브 사실을 확인한 tao 판(2026-09-13 조사: 이 판의 앱 델리게이트 클래스는
/// `applicationShouldTerminate:`를 구현하지 않는다). 잠금 파일의 판이 이것과 다르면 L1이 붉어진다.
#[cfg(test)]
const CHECKED_TAO: &str = "0.35.3";

/// 잠금 파일에서 `name` 패키지의 판을 **전부** 모은다. 못 찾으면 비고, 두 판이 들었으면 둘이다 — 부르는
/// 쪽이 「조사한 판 정확히 하나」와 견줘 어느 경우든 붉어지게 한다(fail-closed).
#[cfg(test)]
fn locked_versions<'a>(lock: &'a str, name: &str) -> Vec<&'a str> {
    let name_line = format!("name = \"{name}\"");
    let mut versions = Vec::new();
    let mut lines = lock.lines();
    while let Some(line) = lines.next() {
        if line.trim() != name_line {
            continue;
        }
        // 판 줄이 바로 뒤에 없으면 담지 않는다 — 판이 빠진 목록은 조사한 판과 안 맞아 붉어진다.
        if let Some(version) = lines
            .next()
            .and_then(|next| next.trim().strip_prefix("version = \""))
            .and_then(|rest| rest.strip_suffix('"'))
        {
            versions.push(version);
        }
    }
    versions
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **「확인됨」은 확정 함수 하나만 세운다.** 앱이 뜬 순간부터 서 있으면 빨간 버튼이 묻지 않고
    /// 창을 닫고, 확정 뒤에도 안 서면 #224의 `terminate:` 훅이 `quit_app`이 부른 종료를 다시 막는다.
    ///
    /// 전역 표시라 **이 테스트 하나만** 만진다 — 둘이 나눠 쓰면 실행 순서가 결과를 정한다.
    ///
    /// **`terminate:` 훅이 보는 판정도 여기서 함께 잰다**(#224). 판정 함수가 표시를 안 읽고 다른 값을
    /// 보면, `quit_app`이 끄는 사이 끼어든 `terminate:`가 다시 막고 묻는다 — 그 판정은 표시를 세우는
    /// 이 자리 뒤에서만 잴 수 있다.
    #[test]
    fn 확정하기_전에는_서_있지_않고_확정하면_선다() {
        assert!(!confirmed(), "아무도 확정하지 않았는데 「확인됨」이 서 있다 — 빨간 버튼이 안 묻는다");
        assert_eq!(verdict(QuitReason::NoEvent), Verdict::Ask, "확정 전인데 ⌘Q가 묻지 않고 끈다");
        confirm();
        assert!(confirmed(), "확정했는데 「확인됨」이 안 섰다");
        for reason in [QuitReason::NoEvent, QuitReason::NoAttribute, QuitReason::Code(code(b"zzzz"))] {
            assert_eq!(
                verdict(reason),
                Verdict::Allow,
                "`quit_app`이 확정한 뒤인데 {reason:?}의 `terminate:`를 다시 막는다"
            );
        }
    }

    fn code(four: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*four)
    }

    /// **이유 판정 표**(결정 16 · S14). 시스템이 끄는 넷(+`logo`)은 확인 전에도 허락하고 — 취소를
    /// 돌려주면 로그아웃·재시동이 멈춘다 — 사람이 부른 길(이벤트 없음 = 메뉴·⌘Q · 속성 없음 = Dock ·
    /// 모르는 값)은 묻는다. 「확인됨」이면 무엇이든 허락한다.
    #[test]
    fn 이유_판정_표() {
        let allow = [b"quia", b"shut", b"rest", b"rlgo", b"logo"];
        for four in allow {
            let reason = QuitReason::Code(code(four));
            assert_eq!(
                decide(reason, false),
                Verdict::Allow,
                "'{}'는 시스템이 끄는 길인데 막는다 — 로그아웃·재시동이 멈춘다",
                String::from_utf8_lossy(four)
            );
        }
        let ask = [
            QuitReason::NoEvent,
            QuitReason::NoAttribute,
            QuitReason::Code(code(b"quit")),
            QuitReason::Code(code(b"aevt")),
            QuitReason::Code(0),
            // 바이트 순서를 뒤집어 읽으면 허락 목록과 우연히 맞지 않아야 한다.
            QuitReason::Code(u32::from_le_bytes(*b"shut")),
        ];
        for reason in ask {
            assert_eq!(decide(reason, false), Verdict::Ask, "{reason:?}는 사람이 부른 종료인데 안 묻는다");
        }
        for reason in ask.into_iter().chain(allow.map(|four| QuitReason::Code(code(four)))) {
            assert_eq!(decide(reason, true), Verdict::Allow, "확인된 뒤인데 {reason:?}를 막는다");
        }
    }

    /// **패닉은 FFI 경계를 못 넘고 「허락」이 된다.** 취소가 되면 로그아웃이 멈추고(결정 16) 이벤트도
    /// 못 쏜 채라 앱을 끌 길이 강제 종료뿐이다(결정 31).
    #[test]
    fn 패닉하면_허락하고_패닉이_밖으로_안_샌다() {
        let outcome = std::panic::catch_unwind(|| guarded(|| panic!("판정 중 패닉")));
        assert_eq!(outcome.ok(), Some(Verdict::Allow), "패닉이 감싸개 밖으로 샜거나 「허락」이 아니다");
        assert_eq!(guarded(|| Verdict::Ask), Verdict::Ask, "패닉이 없는데 판정을 바꾼다");
    }

    /// 핸들러 본문이 통째로 감싸개 안에 있는가 — 이유를 읽다가도, 이벤트를 쏘다가도 패닉이면 허락.
    /// (전역 표시를 안 가리는 경우만 잰다 — 표시는 위 한 테스트만 만진다.)
    #[test]
    fn 핸들러는_이유를_읽다_패닉해도_쏘다_패닉해도_허락한다() {
        let read = std::panic::catch_unwind(|| answer(|| panic!("이유를 못 읽었다"), || {}));
        assert_eq!(read.ok(), Some(Verdict::Allow), "이유를 읽다 난 패닉이 허락으로 안 바뀐다");
        let ask = std::panic::catch_unwind(|| answer(|| QuitReason::Code(code(b"zzzz")), || panic!("못 쐈다")));
        assert_eq!(ask.ok(), Some(Verdict::Allow), "이벤트를 쏘다 난 패닉이 허락으로 안 바뀐다");

        let mut asked = false;
        assert_eq!(answer(|| QuitReason::Code(code(b"shut")), || asked = true), Verdict::Allow);
        assert!(!asked, "시스템 종료인데 확인 창을 부른다");
    }

    /// **tao 판 문턱**(S15). tao가 `applicationShouldTerminate:`를 스스로 구현하기 시작하면
    /// `class_addMethod`가 실패해 훅이 조용히 빠지거나(한 줄 로그뿐), 우리 메서드가 tao의 것을 가린다.
    /// 그래서 판이 바뀌는 순간 여기가 붉어져 사람이 다시 확인하게 한다.
    #[test]
    fn tao_판이_조사한_판과_같다() {
        let lock = include_str!("../../Cargo.lock");
        assert_eq!(
            locked_versions(lock, "tao"),
            [CHECKED_TAO],
            "잠금 파일의 tao가 조사한 판({CHECKED_TAO})이 아니거나 못 찾았다 — 새 판의 앱 델리게이트가 \
             `applicationShouldTerminate:`를 구현하는지 보고(ui-improvement 구현-스펙 §8 「종료 확인」), \
             `quit.rs`의 CHECKED_TAO를 올려라"
        );
    }

    #[test]
    fn 잠금_파일_읽기는_못_찾으면_비고_이웃_이름에_안_속는다() {
        let lock = "\
[[package]]
name = \"tao-macros\"
version = \"0.1.3\"

[[package]]
name = \"tao\"
version = \"0.35.3\"
source = \"registry+https://github.com/rust-lang/crates.io-index\"

[[package]]
name = \"atao\"
version = \"9.9.9\"
";
        assert_eq!(locked_versions(lock, "tao"), ["0.35.3"]);
        assert!(locked_versions(lock, "wry").is_empty(), "없는 항목인데 판이 나온다");
        assert!(locked_versions("", "tao").is_empty());
        let two = format!("{lock}\n[[package]]\nname = \"tao\"\nversion = \"0.37.0\"\n");
        assert_eq!(locked_versions(&two, "tao"), ["0.35.3", "0.37.0"], "두 판이 함께 든 것을 하나로 뭉갠다");
    }
}
