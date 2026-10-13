//! 검사가 진짜 `codex` 대신 상대하는 가짜 codex. 검사는 이것을 임시 PATH에 `codex`라는 이름의 링크로 둔다.
//!
//! - `login status` · `login` — 로그인 확인과 로그인 명령의 흉내(three-axes 티켓 12). 몸은 `src/fakes/login.rs`이고
//!   가짜 `claude`와 함께 쓴다 — 로그인 상태 파일 · 문 · 영수증의 약속은 그 파일 머리에 있다.
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
    if args.first().map(String::as_str) == Some("login") {
        std::process::exit(login::codex_login(&args[1..]));
    }
}
