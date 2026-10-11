//! 가짜 `claude` · 가짜 `codex`가 함께 쓰는 로그인 흉내(three-axes 티켓 12). **크레이트의 모듈 나무에 들지 않는다** —
//! 두 가짜 bin(`src/bin/fake-claude.rs` · `src/bin/fake-codex.rs`)이 `#[path]`로 가져다 쓴다. 영수증 배관(문 기다리기 · 한 줄
//! 더하기 · 시그널 적기)은 그 bin들이 함께 들인 `receipts.rs`의 것이다.
//!
//! 진짜 엔진처럼 로그인 상태를 파일 하나로 쥔다 — 있으면 로그인됨이다(진짜는 Claude의 키체인 · `~/.codex/auth.json`).
//! 가짜 ACP 에이전트의 `needs-auth`도 같은 파일을 본다. 그래서 「로그인 명령이 끝나면 다시 띄운 에이전트가 세션을 연다」가
//! 실물의 모양 그대로 흐른다.
//!
//! - **로그인 확인** — `claude auth status [--json]`은 JSON의 `loggedIn`(안 됐으면 exit 1, 실측 A8), `codex login status`는
//!   exit code이고 결과 글은 stderr로 낸다(실측 함정 50).
//! - **로그인 명령** — `claude auth login` · `codex login`. 실측 A3 · A8의 모양대로 URL을 찍고(Claude는 stdout, Codex는
//!   stderr), 브라우저를 여는 쪽을 부른다 — `$BROWSER`, 비었으면 PATH의 `open`(실측 함정 40). 오래 사는 손주 하나(`sleep`)를
//!   낳고, 영수증 폴더에 문이 생길 때까지 기다린다. `<엔진>-login.go`면 로그인 파일을 쓰고 exit 0, `<엔진>-login.fail`이면
//!   쓰지 않고 exit 1이다. 문이 끝내 안 서면 60초 뒤 exit 1.
//!
//! env:
//! - `FAKE_LOGIN_RECEIPTS` — 영수증 폴더. 로그인 명령은 띄울 때마다 `<엔진>-login.runs`에 한 줄(JSON: pid · Unix 세션 ·
//!   stdin이 TTY인가 · 받은 인자 · 손주 pid)을 더하고, 받은 시그널을 `<엔진>-login.signals`에 한 줄씩(`TERM` · `INT`) 적는다.
//!   로그인 확인은 부를 때마다 `<엔진>-status.calls`에 한 줄을 더한다.
//! - `FAKE_CLAUDE_AUTH` · `FAKE_CODEX_AUTH` — 그 엔진의 로그인 파일 자리.
//! - `FAKE_LOGIN_EMAIL` — 로그인된 Claude의 `auth status`가 싣는 계정 이메일(없으면 `fake@example.com`).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::receipts::{self, GATE_LIMIT};

/// 흉내 낼 엔진 하나.
pub struct Engine {
    /// 영수증 이름의 머리 — `claude` · `codex`.
    pub name: &'static str,
    /// 로그인 파일 자리를 주는 env.
    pub auth_var: &'static str,
    /// 로그인 명령이 찍는 줄들. 첫 `https://` URL이 「링크 복사」의 값이다.
    pub prints: &'static [&'static str],
    /// 찍는 곳이 stderr인가(Codex). 아니면 stdout(Claude).
    pub prints_on_stderr: bool,
    /// 줄바꿈 없이 찍고 기다리는 꼬리 — Claude의 「Paste code here if prompted > 」.
    pub prompt: &'static str,
    /// 브라우저를 여는 쪽에 넘기는 URL — Claude는 찍은 URL과 다르다(localhost 콜백, 실측 A8).
    pub opens: &'static str,
}

pub const CLAUDE: Engine = Engine {
    name: "claude",
    auth_var: "FAKE_CLAUDE_AUTH",
    prints: &[
        "Opening browser to sign in…",
        "If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=fake-client&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=fake-state",
    ],
    prints_on_stderr: false,
    prompt: "Paste code here if prompted > ",
    opens: "https://claude.com/cai/oauth/authorize?code=true&client_id=fake-client&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A61655%2Fcallback&state=fake-state",
};

pub const CODEX: Engine = Engine {
    name: "codex",
    auth_var: "FAKE_CODEX_AUTH",
    // 첫 URL은 `http://`다 — 「링크」는 처음 찍힌 `https://`여야 한다.
    prints: &[
        "Starting local login server on http://localhost:1455.",
        "If your browser did not open, navigate to this URL to authenticate:",
        "",
        "https://auth.openai.com/oauth/authorize?response_type=code&client_id=fake-client&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=fake-state",
    ],
    prints_on_stderr: true,
    prompt: "",
    opens: "https://auth.openai.com/oauth/authorize?response_type=code&client_id=fake-client&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=fake-state",
};

/// `claude auth <…>`. 돌려준 수가 exit code다.
pub fn claude_auth(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("status") => {
            note(&CLAUDE, "status.calls", &args.join(" "));
            let email = std::env::var("FAKE_LOGIN_EMAIL").unwrap_or_else(|_| "fake@example.com".to_string());
            // 실측 A8의 꼴 — 로그인됐으면 계정 칸이 더 실린다. 호스트는 `loggedIn`만 읽고 기록하지 않는다.
            let (status, code) = if logged_in(&CLAUDE) {
                (
                    serde_json::json!({"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty",
                                       "email": email, "subscriptionType": "max"}),
                    0,
                )
            } else {
                (serde_json::json!({"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty"}), 1)
            };
            println!("{}", serde_json::to_string_pretty(&status).expect("JSON이다"));
            code
        }
        Some("login") => log_in(&CLAUDE),
        _ => {
            eprintln!("가짜 claude auth: 모르는 하위 명령 {args:?}");
            2
        }
    }
}

/// `codex login [status]`. 돌려준 수가 exit code다.
pub fn codex_login(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("status") => {
            note(&CODEX, "status.calls", &args.join(" "));
            if logged_in(&CODEX) {
                eprintln!("Logged in using ChatGPT");
                0
            } else {
                eprintln!("Not logged in");
                1
            }
        }
        None => log_in(&CODEX),
        _ => {
            eprintln!("가짜 codex login: 모르는 인자 {args:?}");
            2
        }
    }
}

/// 그 엔진의 로그인 파일이 있나.
pub fn logged_in(engine: &Engine) -> bool {
    auth_file(engine).is_some_and(|path| path.exists())
}

fn auth_file(engine: &Engine) -> Option<PathBuf> {
    std::env::var_os(engine.auth_var).map(PathBuf::from)
}

fn receipts() -> Option<PathBuf> {
    std::env::var_os("FAKE_LOGIN_RECEIPTS").map(PathBuf::from)
}

/// 그 엔진의 `<엔진>-<what>` 영수증에 한 줄을 더한다.
fn note(engine: &Engine, what: &str, line: &str) {
    let Some(dir) = receipts() else { return };
    receipts::append_line(&dir.join(format!("{}-{what}", engine.name)), line);
}

/// 받은 시그널(`TERM` · `INT`)을 `<엔진>-login.signals`에 남기고 끝나도록(143 · 130) 처리기를 건다.
fn watch_signals(engine: &Engine) {
    const LINES: &[(libc::c_int, &[u8])] = &[(libc::SIGTERM, b"TERM\n"), (libc::SIGINT, b"INT\n")];
    let path = receipts().map(|dir| dir.join(format!("{}-login.signals", engine.name)));
    receipts::record_signals(path.as_deref(), LINES);
}

/// 로그인 명령 — URL을 찍고, 브라우저를 여는 쪽을 부르고, 문이 설 때까지 기다린다.
fn log_in(engine: &Engine) -> i32 {
    watch_signals(engine);
    // 오래 사는 손주 — 로그인 명령이 끝나거나 거둬질 때 그룹째 꺼지는지 잰다.
    #[allow(clippy::zombie_processes)]
    let grandchild = Command::new("sleep")
        .arg("600")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
        .map(|child| child.id());
    // SAFETY: 인자 없는 조회다.
    let (sid, tty) = (receipts::unix_session(), unsafe { libc::isatty(0) == 1 });
    note(
        engine,
        "login.runs",
        &serde_json::json!({"pid": std::process::id(), "sid": sid, "stdinTty": tty,
                            "args": std::env::args().skip(1).collect::<Vec<_>>(), "grandchild": grandchild})
        .to_string(),
    );

    let print = |text: &str, newline: bool| {
        let end = if newline { "\n" } else { "" };
        if engine.prints_on_stderr {
            eprint!("{text}{end}");
            let _ = std::io::stderr().flush();
        } else {
            print!("{text}{end}");
            let _ = std::io::stdout().flush();
        }
    };
    for line in engine.prints {
        print(line, true);
    }
    open_browser(engine.opens);
    if !engine.prompt.is_empty() {
        print(engine.prompt, false);
    }

    let Some(dir) = receipts() else { return wait_out() };
    let go = dir.join(format!("{}-login.go", engine.name));
    let fail = dir.join(format!("{}-login.fail", engine.name));
    match receipts::wait_for_any(&[&go, &fail], GATE_LIMIT) {
        Some(gate) if gate == go => {
            if let Some(path) = auth_file(engine) {
                write_auth(&path);
            }
            0
        }
        _ => 1,
    }
}

/// 영수증 폴더가 없으면 문을 볼 곳이 없다 — 한도까지 기다리다 실패로 끝난다.
fn wait_out() -> i32 {
    std::thread::sleep(GATE_LIMIT);
    1
}

fn write_auth(path: &Path) {
    let _ = std::fs::write(path, "{\"fake\": true}\n");
}

/// 진짜 엔진처럼 브라우저를 여는 쪽을 부른다 — `$BROWSER`, 비었으면 PATH의 `open`(실측 함정 40). 검사는 `BROWSER`를
/// `/usr/bin/true`로 막고, PATH 앞에 기록용 가짜 `open`을 둔다.
fn open_browser(url: &str) {
    let opener = std::env::var("BROWSER").ok().filter(|browser| !browser.is_empty()).unwrap_or_else(|| "open".to_string());
    let _ = Command::new(opener).arg(url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
}
