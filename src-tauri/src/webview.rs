//! 웹뷰에게 WebContent 프로세스의 pid를 묻는 macOS FFI(프로세스 스펙 S39 · 티켓 30).
//!
//! **왜 묻는가.** 앱 본체는 Rust 본체와 웹뷰(WebContent) 프로세스다. WebContent는 WebKit이 XPC로 띄워 부모가 launchd라
//! PID 트리로 안 잡히고, 앱이 물려준 env도 없다 — 이름(`com.apple.WebKit.WebContent`)으로 고르면 이 맥의 모든 WKWebView 앱(다른
//! 아틀리에 실행 포함)의 것이 섞인다. 그 pid를 아는 것은 그 웹뷰뿐이다.
//!
//! **비공개 SPI다.** `-[WKWebView _webProcessIdentifier]`(pid_t)는 공개 헤더에 없고 `objc2-web-kit`에도 없다 — 메시지를 이름으로
//! 보낸다. 부르기 전에 그 셀렉터가 있는지 묻는다: 앞으로의 WebKit이 걷으면 「없음」으로 떨어져 요약이 「웹뷰 제외」를 단다(앱은 산다).
//! 이 맥(macOS 26.6.2)의 실측은 티켓 30의 첫 단계 — 로드 뒤 100ms 안에 pid가 서고, 그 프로세스는 부모가 1인
//! `com.apple.WebKit.WebContent`다. 로드 전에는 0을 준다.
//!
//! **메인 스레드에서만 묻는다.** AppKit 객체라 다른 스레드에서 메시지를 보내지 않는다 — 배경 표본(다른 스레드)은 Tauri의
//! `with_webview`로 메인 스레드에 물음을 보내고 답을 잠깐(`ASK_WITHIN`) 기다린다. 늦으면 「늦음」이다(요약은 마지막으로 안 신원을 쓴다).
//!
//! **여기엔 FFI만 산다.** 답을 신원으로 바꾸고, 늦은 답에 옛 신원을 쓰고, 앱 본체와 합계에 더하는 것은 `processes::summary`가
//! 모든 OS에서 잰다. macOS 밖은 늘 「없음」이다 — 요약은 「웹뷰 제외」다.

use tauri::AppHandle;

use crate::processes::summary::Asked;

/// 웹뷰에게 WebContent의 pid를 묻는다. 창이 없으면(아직 안 떴다 · 닫혔다) 「없음」이다. 메인 스레드가 `ASK_WITHIN` 안에 답하지
/// 않으면 「늦음」이다. **메인 스레드에서 부르지 않는다** — 그 자리에서는 물음이 곧바로 돌아 기다릴 것이 없지만, 배경 표본만 부른다.
#[cfg(target_os = "macos")]
pub fn content_pid(app: &AppHandle) -> Asked {
    macos::content_pid(app)
}

/// macOS 밖에는 물을 SPI가 없다 — 요약은 「웹뷰 제외」다.
#[cfg(not(target_os = "macos"))]
pub fn content_pid(_app: &AppHandle) -> Asked {
    Asked::Answered(None)
}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::mpsc;
    use std::time::Duration;

    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    use tauri::{AppHandle, Manager};

    use crate::processes::summary::Asked;

    /// 창 하나의 라벨. `tauri.conf.json`이 라벨을 안 적어 Tauri의 기본값(`main`)이다(`terminate.rs`와 같다).
    const MAIN_WINDOW: &str = "main";

    /// 메인 스레드의 답을 기다리는 한계. 셀렉터 둘을 보내는 일이라 평소엔 1ms 안이다 — 이보다 늦으면 메인 스레드가 다른 일에 묶였다.
    /// 배경 표본의 박자(10초)에 견줘 짧게 둔다: 그 스레드는 이것을 기다리는 동안 다음 장을 못 모은다.
    const ASK_WITHIN: Duration = Duration::from_millis(500);

    pub(super) fn content_pid(app: &AppHandle) -> Asked {
        let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
            return Asked::Answered(None);
        };
        let (answer, answered) = mpsc::sync_channel(1);
        let sent = window.with_webview(move |webview| {
            // SAFETY: `with_webview`는 이 클로저를 메인 스레드에서 부르고, `inner()`는 그 창의 WKWebView 포인터다.
            let pid = unsafe { web_process_identifier(webview.inner().cast()) };
            let _ = answer.send(pid);
        });
        if sent.is_err() {
            return Asked::Answered(None);
        }
        match answered.recv_timeout(ASK_WITHIN) {
            Ok(pid) => Asked::Answered(pid),
            Err(_) => Asked::Late,
        }
    }

    /// `-[WKWebView _webProcessIdentifier]`. 셀렉터가 없으면(이 WebKit이 SPI를 걷었다) 없음, 아직 아무것도 안 띄웠으면(0) 없음.
    ///
    /// # Safety
    /// `webview`는 살아 있는 WKWebView이거나 널이어야 하고, 메인 스레드에서 불러야 한다.
    unsafe fn web_process_identifier(webview: *mut AnyObject) -> Option<u32> {
        if webview.is_null() {
            return None;
        }
        let responds: bool = msg_send![webview, respondsToSelector: sel!(_webProcessIdentifier)];
        if !responds {
            return None;
        }
        let pid: libc::pid_t = msg_send![webview, _webProcessIdentifier];
        u32::try_from(pid).ok().filter(|pid| *pid > 0)
    }

    #[cfg(test)]
    mod tests {
        use objc2::runtime::{AnyClass, Bool};
        use objc2::{msg_send, sel};

        /// **이 맥의 WebKit에 그 SPI가 있다**(티켓 30 첫 단계). 앱이 부르는 셀렉터(`_webProcessIdentifier`)를 WKWebView가 아는지 클래스에
        /// 묻는다 — 웹뷰를 띄우지 않고(메인 스레드가 필요하다) 잴 수 있는 것은 여기까지다. 빨개지면 macOS가 SPI를 걷었다는 뜻이다: 앱은
        /// 셀렉터를 먼저 물어 「웹뷰 제외」로 떨어지니 죽지 않지만, 요약 카드의 앱 본체가 다시 Rust 본체뿐이 된다. 실제로 pid가 서는지는
        /// 첫 단계의 실측이 쟀다(구현 기록 30).
        ///
        /// 앵커: 공개 셀렉터(`loadHTMLString:baseURL:`)도 같은 물음으로 참이다 — 클래스를 못 찾아 둘 다 거짓인 것이 아니다.
        #[test]
        fn this_webkit_names_its_web_content_process() {
            // 앱 바이너리가 웹뷰를 띄우는 길(wry)이 WebKit을 링크하므로 검사 바이너리에도 클래스가 있다.
            let class = AnyClass::get(c"WKWebView").expect("WKWebView 클래스가 있다 — WebKit이 링크되지 않았다");
            let knows = |selector| -> bool {
                let answer: Bool = unsafe { msg_send![class, instancesRespondToSelector: selector] };
                answer.as_bool()
            };
            assert!(knows(sel!(loadHTMLString:baseURL:)), "공개 셀렉터도 모른다 — 물음이 헛돈다");
            assert!(knows(sel!(_webProcessIdentifier)), "이 WebKit에 `_webProcessIdentifier`가 없다 — 앱 본체가 웹뷰를 못 센다");
        }
    }
}
