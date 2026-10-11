//! 변환기 시험 bin — 앱 실행 파일의 하위 모드 `acp-claude`와 **같은 진입 함수**를 부르는 얇은 bin이다(three-axes 티켓 13).
//! L1 검사가 호스트의 변환기 명령으로 넘긴다(`env!("CARGO_BIN_EXE_claude-translator")`). 앱의 갈래는 `src-tauri/src/main.rs`다.

fn main() {
    std::process::exit(atelier_acp::run_claude_translator())
}
