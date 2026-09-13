//! ⌘Q · 메뉴 Quit · Dock 종료를 묻게 하는 macOS 델리게이트 훅(결정 14·16 · #224).
//!
//! **왜 훅인가.** tao 0.35.3의 앱 델리게이트 클래스는 `applicationShouldTerminate:`를 구현하지 않는다.
//! 그래서 `terminate:`(⌘Q · 메뉴 Quit) · Dock 종료 · 시스템 종료는 `RunEvent::ExitRequested` 없이 바로
//! 끝나고 `prevent_exit`로는 못 막는다(tauri#9198, 열림). 빨간 버튼만 `CloseRequested`로 온다(`lib.rs`).
//! 다른 Tauri 앱 넷(dbx · minutes · unsloth · screenpipe)이 같은 자리를 같은 방식으로 판다 — 업스트림이
//! 고쳐지면 이 파일을 걷고 `ExitRequested`로 옮긴다.
//!
//! **여기엔 FFI만 산다.** 무엇을 허락하고 무엇을 묻는지(이유 판정 · 「확인됨」 · 패닉이면 허락)는
//! `quit.rs`에 cfg 밖으로 두어 리눅스 CI가 잰다. 이 파일이 cfg 아래로 들어간 것이 새면 리눅스 빌드가
//! 깨지고, 그것은 PR의 `Verify` job이 잰다.
//!
//! tao 판이 바뀌면 아래 `tao_판이_조사한_판과_같다`가 붉어진다 — 새 판이 이 메서드를 스스로
//! 구현하면 `class_addMethod`가 실패해 훅이 조용히 빠지기 때문이다. 그 테스트는 cfg 밖이라 리눅스 CI도 돈다.

use tauri::AppHandle;

/// 앱 델리게이트 클래스에 `applicationShouldTerminate:`를 붙인다. **셋업 안에서** 부른다 — 셋업은
/// `applicationDidFinishLaunching:` 안에서 돌아 그때는 델리게이트가 이미 붙어 있다.
///
/// 붙이지 못하면 한 줄 남기고 훅 없이 뜬다 — ⌘Q가 묻지 않고 끄는, 훅 이전의 동작이다.
#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle) {
    macos::install(app);
}

/// macOS 밖에는 `terminate:`가 없다 — 창 닫기 훅(`lib.rs`)이 종료로 가는 길 전부다.
#[cfg(not(target_os = "macos"))]
pub fn install(_app: &AppHandle) {}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::OnceLock;

    use objc2::ffi;
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use tauri::{AppHandle, Emitter};

    use crate::quit::hook::{self, QuitReason, Verdict};
    use crate::quit::REQUESTED_EVENT;

    /// 핸들러가 이벤트를 쏠 앱. 핸들러는 C 함수라 붙잡을 자리가 없어 여기 한 번 둔다.
    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// `NSApplicationTerminateReply`(NSUInteger).
    const NS_TERMINATE_CANCEL: usize = 0;
    const NS_TERMINATE_NOW: usize = 1;

    /// `kAEQuitReason` — Apple Event의 **속성** 키워드(매개변수가 아니다).
    const QUIT_REASON_KEYWORD: u32 = hook::four_cc(b"why?");

    pub fn install(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            // 두 번 붙이면 `class_addMethod`가 어차피 거부한다 — 먼저 걸러 로그를 남기지 않는다.
            return;
        }
        // SAFETY: 셋업은 메인 스레드에서 돈다. 받는 것은 전부 AppKit이 주는 객체 포인터이고 널을 먼저 본다.
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = if ns_app.is_null() { std::ptr::null_mut() } else { msg_send![ns_app, delegate] };
            if delegate.is_null() {
                eprintln!("atelier: 앱 델리게이트가 없어 종료 확인 훅을 못 붙였다 — ⌘Q가 묻지 않고 끈다");
                return;
            }
            let class = ffi::object_getClass(delegate) as *mut AnyClass;
            // SAFETY: AppKit이 이 셀렉터를 `(id self, SEL _cmd, id sender) -> NSUInteger`로 부른다.
            // `Imp`는 인자 없는 함수 포인터 모양일 뿐이고 실제 호출 규약은 아래 형식 문자열이 정한다.
            let imp: Imp = std::mem::transmute::<
                unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize,
                Imp,
            >(application_should_terminate_imp);
            // `Q@:@` = NSUInteger(64비트 unsigned long) 반환 · self · _cmd · sender.
            let added = ffi::class_addMethod(class, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr());
            if !added.as_bool() {
                // 클래스가 이미 이 메서드를 가졌다 — tao가 구현하기 시작했다는 뜻이다(판 문턱이 먼저 붉어졌어야 한다).
                eprintln!("atelier: applicationShouldTerminate:를 못 붙였다(이미 있다) — ⌘Q가 종료 확인을 안 거친다");
            }
        }
    }

    /// AppKit이 종료 직전에 부른다. 본문은 `quit::hook::application_should_terminate` 하나다 — 패닉하면 허락이 나가고 되감기가 C로 안 넘어간다.
    ///
    /// 이름에 `_imp`를 붙인 것은 이것이 클래스에 붙는 ObjC **IMP**라서다 — `quit::hook::should_terminate`(순수
    /// 판정)와 같은 이름이면 grep·백트레이스에서 두 층이 안 갈린다.
    unsafe extern "C-unwind" fn application_should_terminate_imp(_this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> usize {
        let verdict = hook::application_should_terminate(
            // SAFETY: AppKit이 메인 스레드에서 이 핸들러를 부르고, 그동안 현재 Apple Event가 유효하다.
            || unsafe { current_reason() },
            || {
                if let Some(app) = APP.get() {
                    let _ = app.emit(REQUESTED_EVENT, ());
                }
            },
        );
        match verdict {
            Verdict::Allow => NS_TERMINATE_NOW,
            Verdict::Ask => NS_TERMINATE_CANCEL,
        }
    }

    /// 지금 처리 중인 Apple Event의 `why?` 속성. ⌘Q·메뉴는 `terminate:`를 직접 불러 이벤트가 없고,
    /// Dock은 `quit` 이벤트에 속성이 없다.
    ///
    /// 값은 `typeCodeValue`로 읽는다 — `why?`의 값은 `typeType`으로 온다(screenpipe가 같은 판정으로 출하).
    unsafe fn current_reason() -> QuitReason {
        let manager: *mut AnyObject = msg_send![class!(NSAppleEventManager), sharedAppleEventManager];
        if manager.is_null() {
            return QuitReason::NoEvent;
        }
        let event: *mut AnyObject = msg_send![manager, currentAppleEvent];
        if event.is_null() {
            return QuitReason::NoEvent;
        }
        let descriptor: *mut AnyObject = msg_send![event, attributeDescriptorForKeyword: QUIT_REASON_KEYWORD];
        if descriptor.is_null() {
            return QuitReason::NoAttribute;
        }
        let code: u32 = msg_send![descriptor, typeCodeValue];
        QuitReason::Code(code)
    }
}

#[cfg(test)]
mod tests {
    /// 훅이 기대는 네이티브 사실을 확인한 tao 판(2026-09-13 조사: 이 판의 앱 델리게이트 클래스는
    /// `applicationShouldTerminate:`를 구현하지 않는다). 잠금 파일의 판이 이것과 다르면 붉어진다.
    const CHECKED_TAO: &str = "0.35.3";

    /// 잠금 파일에서 `name` 패키지의 판을 **전부** 모은다. 못 찾으면 비고, 두 판이 들었으면 둘이다 — 부르는
    /// 쪽이 「조사한 판 정확히 하나」와 견줘 어느 경우든 붉어지게 한다(fail-closed).
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
             `terminate.rs`의 CHECKED_TAO를 올려라"
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
