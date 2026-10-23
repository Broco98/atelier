//! Thread 도구 중계 서버 시험 bin — 앱 실행 파일의 하위 모드 `thread-tools`와 **같은 진입 함수**를 부르는 얇은 bin이다(v1 티켓
//! 15). L1 검사가 호스트의 중계 서버 명령으로 넘긴다(`env!("CARGO_BIN_EXE_thread-tools")`) — 소켓 경로는 첫 인자로 온다. 앱의 갈래는
//! `src-tauri/src/main.rs`다.

fn main() {
    std::process::exit(atelier_acp::run_thread_tools(std::env::args_os().nth(1)))
}
