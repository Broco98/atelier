//! 종료 확인(결정 14·15 · #223). 앱을 끄는 길은 **프런트가 사람에게 물은 뒤에만** 열린다.
//!
//! 이 파일은 **플랫폼 cfg 밖이다.** 빨간 버튼의 창 닫기(`lib.rs`의 `on_window_event`)와
//! #224가 붙일 macOS 델리게이트 훅이 같은 이벤트 이름과 같은 「확인됨」 표시를 쓰므로, 여기가
//! macOS 전용이 되면 리눅스 CI가 이 판정을 한 줄도 안 잰다.
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

#[cfg(test)]
mod tests {
    use super::*;

    /// **「확인됨」은 확정 함수 하나만 세운다.** 앱이 뜬 순간부터 서 있으면 빨간 버튼이 묻지 않고
    /// 창을 닫고, 확정 뒤에도 안 서면 #224의 `terminate:` 훅이 `quit_app`이 부른 종료를 다시 막는다.
    ///
    /// 전역 표시라 **이 테스트 하나만** 만진다 — 둘이 나눠 쓰면 실행 순서가 결과를 정한다.
    #[test]
    fn 확정하기_전에는_서_있지_않고_확정하면_선다() {
        assert!(!confirmed(), "아무도 확정하지 않았는데 「확인됨」이 서 있다 — 빨간 버튼이 안 묻는다");
        confirm();
        assert!(confirmed(), "확정했는데 「확인됨」이 안 섰다");
    }
}
