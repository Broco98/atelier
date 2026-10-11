//! 검사가 진짜 `claude` 대신 상대하는 가짜 claude. 검사는 이것을 임시 PATH에 `claude`라는 이름의 링크로 둔다.
//!
//! - `auth status` · `auth login` — 로그인 확인과 로그인 명령의 흉내(three-axes 티켓 12). 몸은 `src/fakes/login.rs`이고
//!   가짜 `codex`와 함께 쓴다 — 로그인 상태 파일 · 문 · 영수증의 약속은 그 파일 머리에 있다.
//! - `-p …`(stream-json 되감기)는 three-axes 티켓 13이 같은 bin에 더한다.

#[path = "../fakes/login.rs"]
#[allow(dead_code)] // 두 가짜가 함께 쓰는 모듈이라 저쪽 엔진의 몫은 여기서 안 쓴다.
mod login;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("auth") {
        std::process::exit(login::claude_auth(&args[1..]));
    }
    eprintln!("가짜 claude: 흉내 내지 않는 인자다 — {args:?}");
    std::process::exit(2);
}
