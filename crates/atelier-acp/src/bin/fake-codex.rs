//! 검사가 진짜 `codex` 대신 상대하는 가짜 codex. 검사는 이것을 임시 PATH에 `codex`라는 이름의 링크로 둔다.
//!
//! - `login status` — 로그인 확인의 흉내(three-axes 티켓 12). 몸은 `src/fakes/login.rs`이고 가짜 `claude`와 함께 쓴다 — 로그인
//!   상태 파일 · 영수증의 약속은 그 파일 머리에 있다. 로그인 명령(`login`)은 흉내 내지 않는다(restart 01c-10).
//! - `--version` — 진짜 codex의 꼴(`codex-cli <판>`)로 판을 찍는다. 판은 `FAKE_CODEX_VERSION`, 없으면 시험한 판 `0.162.1`이다
//!   (restart 티켓 01c-11 — Codex를 열 때 Host가 판을 본다).
//! - 그 밖의 인자는 아무것도 하지 않고 exit 0이다. 대화의 `codex`는 가짜 ACP 에이전트가 `CODEX_PATH`로 받기만 하고
//!   부르지 않는다.

#[path = "../fakes/login.rs"]
#[allow(dead_code)] // 두 가짜가 함께 쓰는 모듈이라 저쪽 엔진의 몫은 여기서 안 쓴다.
mod login;
#[path = "../fakes/receipts.rs"]
#[allow(dead_code)] // 가짜들이 함께 쓰는 영수증 배관이라 로그인 흉내가 쓰지 않는 몫이 있다.
mod receipts;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("login") => std::process::exit(login::codex_login(&args[1..])),
        Some("--version") => {
            let version = std::env::var("FAKE_CODEX_VERSION").unwrap_or_else(|_| "0.162.1".to_owned());
            println!("codex-cli {version}");
        }
        _ => {}
    }
}
