//! 가짜 `claude` · 가짜 `codex`가 함께 쓰는 로그인 확인 흉내(three-axes 티켓 12). **크레이트의 모듈 나무에 들지 않는다** —
//! 두 가짜 bin(`src/bin/fake-claude.rs` · `src/bin/fake-codex.rs`)이 `#[path]`로 가져다 쓴다. 영수증 배관(한 줄 더하기)은 그
//! bin들이 함께 들인 `receipts.rs`의 것이다.
//!
//! 진짜 엔진처럼 로그인 상태를 파일 하나로 쥔다 — 있으면 로그인됨이다(진짜는 Claude의 키체인 · `~/.codex/auth.json`).
//! 가짜 ACP 에이전트의 `needs-auth`도 같은 파일을 본다. 그래서 「터미널에서 로그인하고 「다시 확인」을 누르면 다시 띄운 에이전트가
//! 세션을 연다」가 실물의 모양 그대로 흐른다 — 검사는 로그인 파일을 두는 것으로 터미널의 로그인을 대신한다.
//!
//! - **로그인 확인** — `claude auth status [--json]`은 JSON의 `loggedIn`(안 됐으면 exit 1, 실측 A8), `codex login status`는
//!   exit code이고 결과 글은 stderr로 낸다(실측 함정 50).
//! - **로그인 명령**(`claude auth login` · `codex login`)은 흉내 내지 않는다 — 앱은 그 명령을 띄우지 않고 Terminal의 셸에 친다
//!   (restart 01c-10). 받으면 모르는 하위 명령으로 끝난다.
//!
//! env:
//! - `FAKE_LOGIN_RECEIPTS` — 영수증 폴더. 로그인 확인은 부를 때마다 `<엔진>-status.calls`에 한 줄을 더한다.
//! - `FAKE_CLAUDE_AUTH` · `FAKE_CODEX_AUTH` — 그 엔진의 로그인 파일 자리.
//! - `FAKE_LOGIN_EMAIL` — 로그인된 Claude의 `auth status`가 싣는 계정 이메일(없으면 `fake@example.com`).

use std::path::PathBuf;

use crate::receipts;

/// 흉내 낼 엔진 하나.
pub struct Engine {
    /// 영수증 이름의 머리 — `claude` · `codex`.
    pub name: &'static str,
    /// 로그인 파일 자리를 주는 env.
    pub auth_var: &'static str,
}

pub const CLAUDE: Engine = Engine { name: "claude", auth_var: "FAKE_CLAUDE_AUTH" };

pub const CODEX: Engine = Engine { name: "codex", auth_var: "FAKE_CODEX_AUTH" };

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
        _ => {
            eprintln!("가짜 claude auth: 모르는 하위 명령 {args:?}");
            2
        }
    }
}

/// `codex login status`. 돌려준 수가 exit code다.
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
