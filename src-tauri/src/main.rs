// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 하위 모드 — Tauri를 짓기 전에 첫 인자로 가른다(three-axes 티켓 13, 워크플로 S4). 정확히 `acp-claude`면 이 실행 파일이
    // Claude 변환기가 되어 stdin/stdout으로 ACP를 말한다. Tauri를 짓지 않으므로 Dock 아이콘이 서지 않고 가볍게 뜬다
    // (워크플로 G17). stdout이 곧 ACP 선이라 이 갈래 앞에서는 아무것도 쓰지 않는다.
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new(atelier_acp::CLAUDE_TRANSLATOR_MODE)) {
        std::process::exit(atelier_acp::run_claude_translator());
    }
    // 하위 모드 — 정확히 `thread-tools`면 Thread 도구 중계 서버가 되어 stdin/stdout으로 MCP를 말한다(v1 티켓 15 · S12). claude가
    // `--mcp-config`의 서버로 띄우고, 둘째 인자는 엔진이 그 Session에 연 소켓이다. stdout이 곧 MCP 선이다.
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new(atelier_acp::THREAD_TOOLS_MODE)) {
        std::process::exit(atelier_acp::run_thread_tools(std::env::args_os().nth(2)));
    }
    atelier_lib::run()
}
