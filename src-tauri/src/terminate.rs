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
//! tao 판이 바뀌면 `quit.rs`의 `tao_판이_조사한_판과_같다`가 붉어진다 — 새 판이 이 메서드를 스스로
//! 구현하면 아래 `class_addMethod`가 실패해 훅이 조용히 빠지기 때문이다.

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

    use crate::quit::{self, QuitReason, Verdict};

    /// 핸들러가 이벤트를 쏠 앱. 핸들러는 C 함수라 붙잡을 자리가 없어 여기 한 번 둔다.
    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// `NSApplicationTerminateReply`(NSUInteger).
    const NS_TERMINATE_CANCEL: usize = 0;
    const NS_TERMINATE_NOW: usize = 1;

    /// `kAEQuitReason` — Apple Event의 **속성** 키워드(매개변수가 아니다).
    const QUIT_REASON_KEYWORD: u32 = u32::from_be_bytes(*b"why?");

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
            >(should_terminate);
            // `Q@:@` = NSUInteger(64비트 unsigned long) 반환 · self · _cmd · sender.
            let added = ffi::class_addMethod(class, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr());
            if !added.as_bool() {
                // 클래스가 이미 이 메서드를 가졌다 — tao가 구현하기 시작했다는 뜻이다(판 문턱이 먼저 붉어졌어야 한다).
                eprintln!("atelier: applicationShouldTerminate:를 못 붙였다(이미 있다) — ⌘Q가 종료 확인을 안 거친다");
            }
        }
    }

    /// AppKit이 종료 직전에 부른다. 본문은 `quit::answer` 하나다 — 패닉하면 허락이 나가고 되감기가 C로 안 넘어간다.
    unsafe extern "C-unwind" fn should_terminate(_this: *mut AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> usize {
        let verdict = quit::answer(
            // SAFETY: AppKit이 메인 스레드에서 이 핸들러를 부르고, 그동안 현재 Apple Event가 유효하다.
            || unsafe { current_reason() },
            || {
                if let Some(app) = APP.get() {
                    let _ = app.emit(quit::REQUESTED_EVENT, ());
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
