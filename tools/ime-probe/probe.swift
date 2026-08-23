// 한글이 셸에 온전히 닿는지를 **사람 없이** 재는 계측기. 쓰는 법은 README.md에 있다.
//
// 진짜 WKWebView를 세우고, 진짜 두벌식 입력기를 켜고, 물리 키코드를 던져 넣은 뒤,
// xterm이 PTY로 내보낸 바이트를 읽는다. 입력 소스는 재고 나서 되돌린다.
//
// **유니코드 문자열 주입을 쓰지 않는다** — 그것은 입력기를 건너뛴다. 물리 키코드라야
// 사람이 치는 것과 같은 길을 지난다.
//
// 인자: <page.html> [키코드,쉼표,구분] [ascii]
//   ascii를 주면 입력 소스를 안 바꾼다(영문 회귀 확인용).
import Cocoa
import WebKit
import Carbon.HIToolbox

let HTML = ""

final class Log: NSObject, WKScriptMessageHandler {
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        print(m.body as? String ?? "?")
    }
}

// MARK: 입력 소스

func inputSource(id: String) -> TISInputSource? {
    let filter = [kTISPropertyInputSourceID as String: id] as CFDictionary
    guard let list = TISCreateInputSourceList(filter, true)?.takeRetainedValue() as? [TISInputSource],
          let first = list.first else { return nil }
    return first
}
func currentSourceID() -> String {
    guard let s = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue(),
          let p = TISGetInputSourceProperty(s, kTISPropertyInputSourceID) else { return "?" }
    return Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue() as String
}

// MARK: 키 주입 — 물리 키코드로 친다(유니코드 문자열 주입은 IME를 건너뛴다)

func tap(_ code: CGKeyCode) {
    let src = CGEventSource(stateID: .hidSystemState)
    CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true)?.post(tap: .cghidEventTap)
    usleep(30_000)
    CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false)?.post(tap: .cghidEventTap)
    usleep(90_000)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)

let cfg = WKWebViewConfiguration()
cfg.userContentController.add(Log(), name: "log")
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 680, height: 340), configuration: cfg)
let win = NSWindow(contentRect: NSRect(x: 200, y: 400, width: 680, height: 340),
                   styleMask: [.titled], backing: .buffered, defer: false)
win.title = "ime probe"
win.contentView = web
win.makeKeyAndOrderFront(nil)
web.loadFileURL(URL(fileURLWithPath: CommandLine.arguments[1]), allowingReadAccessTo: URL(fileURLWithPath: (CommandLine.arguments[1] as NSString).deletingLastPathComponent))

let original = currentSourceID()
let KOREAN = "com.apple.inputmethod.Korean.2SetKorean"

DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
    app.activate(ignoringOtherApps: true)
    win.makeFirstResponder(web)
    web.evaluateJavaScript("term.focus()")

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
        guard let ko = inputSource(id: KOREAN) else {
            print("!! 2벌식 입력 소스를 못 찾았다"); exit(2)
        }
        if CommandLine.arguments.count > 3 && CommandLine.arguments[3] == "ascii" {
            print("== 입력 소스 그대로(영문) ==")
        } else { TISSelectInputSource(ko) }
        usleep(600_000)
        print("== 입력 소스: \(currentSourceID()) (원래: \(original)) ==")
        print("== 두벌식 「안녕」 = d k s s u d, 이어서 space 로 확정 ==")
        fflush(stdout)

        // **메인 스레드에서 자면 안 된다.** 런루프가 막히면 IME도 웹뷰도 이벤트를 못 받고
        // 전부 뒤에 몰려 도착한다(첫 시도에서 keyup 7개가 keydown보다 먼저 왔다).
        DispatchQueue.global().async {
            let keys: [CGKeyCode] = CommandLine.arguments.count > 2 ? CommandLine.arguments[2].split(separator: ",").compactMap { CGKeyCode($0) } : [2, 40, 1, 1, 32, 2, 49]
            for code in keys { tap(code) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                web.evaluateJavaScript("window.__done()") { _, _ in
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                        if let orig = inputSource(id: original) { TISSelectInputSource(orig) }
                        print("== 입력 소스 되돌림: \(currentSourceID()) ==")
                        exit(0)
                    }
                }
            }
        }
    }
}
app.run()
