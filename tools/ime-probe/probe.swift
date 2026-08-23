// 한글이 셸에 온전히 닿는지를 **사람 없이** 재는 계측기. 쓰는 법은 README.md에 있다.
//
// 진짜 WKWebView를 세우고, 진짜 두벌식 입력기를 켜고, 물리 키코드를 던져 넣은 뒤,
// xterm이 PTY로 내보낸 바이트를 읽는다.
//
// **유니코드 문자열 주입을 쓰지 않는다** — 그것은 입력기를 건너뛴다. 물리 키코드라야
// 사람이 치는 것과 같은 길을 지난다. 수식키도 **진짜로 눌렀다 뗀다**: 플래그만 얹으면
// 입력기에 keydown이 안 가서, 재려는 것(수식키가 조합을 끊는가)이 통째로 빠진다.
//
// 인자: <page.html> [키코드,쉼표,구분] [ascii]
//   키코드 앞의 `s` = Shift와 함께, `c` = ⌘와 함께  (예: `5,31,s17` = ㅎ ㅐ Shift+ㅅ)
//   ascii = 영문 배열을 **골라** 친다(회귀 확인용). 안 주면 두벌식을 고른다.
//   wide  = 치기 전에 커서를 넓은 글자 뒤칸에 세운다(xterm이 인라인 `width: 0px`을 쓰는 자리).
import Cocoa
import WebKit
import Carbon.HIToolbox

// MARK: 입력 소스 — 되돌리기가 모든 경로에 걸려야 한다

let KOREAN = "com.apple.inputmethod.Korean.2SetKorean"
let ASCII = "com.apple.keylayout.ABC"

/// **켜져 있는** 소스만 본다. `includeAllInstalled: true`로 부르면 시스템 설정에서 꺼 둔
/// 입력기까지 돌려주므로 「두벌식이 꺼져 있다」를 영영 못 잡는다.
func inputSource(id: String) -> TISInputSource? {
    let filter = [kTISPropertyInputSourceID as String: id] as CFDictionary
    let list = TISCreateInputSourceList(filter, false)?.takeRetainedValue() as? [TISInputSource]
    return list?.first
}

func currentSourceID() -> String {
    guard let s = TISCopyCurrentKeyboardInputSource()?.takeRetainedValue(),
          let p = TISGetInputSourceProperty(s, kTISPropertyInputSourceID) else { return "?" }
    return Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue() as String
}

/// 시작할 때의 소스. 아래 `restore()`가 **모든** 끝나는 길에서 이 값으로 되돌린다.
let original = currentSourceID()
func restore() {
    if currentSourceID() != original, let orig = inputSource(id: original) {
        TISSelectInputSource(orig)
    }
}
func die(_ message: String, _ code: Int32) -> Never {
    restore()
    FileHandle.standardError.write(("!! " + message + "\n").data(using: .utf8)!)
    exit(code)
}

// MARK: 키 주입

func tap(_ code: CGKeyCode, shift: Bool = false, cmd: Bool = false) {
    let src = CGEventSource(stateID: .hidSystemState)
    let modKey: CGKeyCode? = shift ? 56 : (cmd ? 55 : nil)
    if let m = modKey {
        CGEvent(keyboardEventSource: src, virtualKey: m, keyDown: true)?.post(tap: .cghidEventTap)
        usleep(40_000)
    }
    let down = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false)
    if shift { down?.flags = .maskShift; up?.flags = .maskShift }
    if cmd { down?.flags = .maskCommand; up?.flags = .maskCommand }
    down?.post(tap: .cghidEventTap)
    usleep(30_000)
    up?.post(tap: .cghidEventTap)
    if let m = modKey {
        usleep(40_000)
        CGEvent(keyboardEventSource: src, virtualKey: m, keyDown: false)?.post(tap: .cghidEventTap)
    }
    usleep(90_000)
}

// MARK: 배선

final class Log: NSObject, WKScriptMessageHandler {
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        print(m.body as? String ?? "?")
        fflush(stdout)
    }
}

guard CommandLine.arguments.count > 1 else { die("쓰는 법: probe <page.html> [키코드…] [ascii] [wide]", 2) }
let page = CommandLine.arguments[1]
guard FileManager.default.fileExists(atPath: page) else { die("페이지가 없다: \(page)", 2) }

// 중간에 끊겨도 기계가 두벌식으로 남지 않게 한다. **C 시그널 핸들러가 아니라 `DispatchSource`**
// 로 받는다 — 핸들러 안에서 `TISSelectInputSource`를 부르는 것은 async-signal-safe하지 않다.
// 이쪽은 큐에서 평범한 코드로 돌므로 마음대로 불러도 된다.
// (강제 종료·크래시까지 막지는 못한다. 그때는 손으로 입력 소스를 되돌려야 한다.)
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM, SIGHUP] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler { restore(); exit(130) }
    source.resume()
    signalSources.append(source)
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
let url = URL(fileURLWithPath: page)
web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())

let wantAscii = CommandLine.arguments.contains("ascii")

DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
    app.activate(ignoringOtherApps: true)
    win.makeFirstResponder(web)
    web.evaluateJavaScript("term.focus()")

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
        // **영문도 골라서 친다.** 「그냥 두면」 한글이 기본인 기계에서 영문 회귀 검사가
        // 영영 초록이 될 수 없다.
        let wanted = wantAscii ? ASCII : KOREAN
        guard let source = inputSource(id: wanted) else {
            die("입력 소스가 켜져 있지 않다: \(wanted) — 시스템 설정 ▸ 키보드 ▸ 입력 소스에서 켤 것", 3)
        }
        TISSelectInputSource(source)
        usleep(600_000)
        guard currentSourceID() == wanted else {
            die("입력 소스를 못 바꿨다: \(currentSourceID()) (원한 것 \(wanted))", 3)
        }
        print("== 입력 소스: \(currentSourceID()) (원래: \(original)) ==")
        fflush(stdout)

        // **메인 스레드에서 자면 안 된다.** 런루프가 막히면 IME도 웹뷰도 이벤트를 못 받고
        // 전부 뒤에 몰려 도착한다(첫 시도에서 keyup 7개가 keydown보다 먼저 왔다).
        DispatchQueue.global().async {
            if CommandLine.arguments.contains("wide") {
                // **없으면 죽는다.** `&&`로 넘기면 페이지가 바뀌었을 때 준비가 조용히 안 돌고
                // 그대로 초록이 된다.
                var missing = false
                DispatchQueue.main.sync {
                    web.evaluateJavaScript("typeof window.__wide") { value, _ in
                        missing = (value as? String) != "function"
                    }
                }
                usleep(200_000)
                if missing { die("페이지에 window.__wide가 없다 — wide 준비를 못 한다", 2) }
                DispatchQueue.main.sync { web.evaluateJavaScript("window.__wide()") }
                usleep(500_000)
            }
            let spec = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "2,40,1,1,32,2,49"
            for token in spec.split(separator: ",") {
                let shift = token.hasPrefix("s"), cmd = token.hasPrefix("c")
                let digits = shift || cmd ? String(token.dropFirst()) : String(token)
                guard let code = CGKeyCode(digits) else { die("키코드를 못 읽었다: \(token)", 2) }
                tap(code, shift: shift, cmd: cmd)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                web.evaluateJavaScript("window.__done()") { _, _ in
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                        restore()
                        print("== 입력 소스 되돌림: \(currentSourceID()) ==")
                        exit(0)
                    }
                }
            }
        }
    }
}
app.run()
