//! L1 — Runtime의 표식(restart 티켓 03-7 · 스펙 「03 — Processes」 Runtime). 채팅의 Runtime을 띄울 때 env에 표식 `ATELIER_RUNTIME`을
//! 심는다 — 값은 앱이 채팅 id로 지은 것이다(`HostBuilder::mark_runtimes`). Runtime의 자손은 그 env를 물려받아, `Processes`의 수집이 부모가
//! 먼저 죽은 dev 서버까지 그 채팅으로 묶는다.
//!
//! 시험은 호스트에 채팅 명령을 넣고 가짜의 영수증(받은 env)만 본다. Claude는 변환기가 띄운 가짜 claude — Runtime의 자식 — 의 env를, Codex는
//! 호스트가 띄운 가짜 `codex-acp`의 env를 본다. 로그인 env에 남의 표식을 일부러 싣는다 — 앱을 다른 채팅이 띄웠으면(설치본의 채팅이 띄운
//! dev 앱) 앱의 env와 로그인 셸이 그 표식을 물고 있다.

mod common;

use atelier_acp::{Runtime, StartPicks, ThreadLink, RUNTIME_KEY_ENV};
use common::Sandbox;
use serde_json::{json, Value};

/// 로그인 env에 실린 남의 표식 — 이 앱을 띄운 다른 실행의 채팅 것이다.
const FOREIGN: (&str, &str) = (RUNTIME_KEY_ENV, "1700000000000:20261010-090000");

/// 시험의 표식 짓기 — 앱은 이 실행의 세대와 채팅 id로 짓는다(`processes::runtime_key::mint`). 엔진은 그 모양을 모른다.
fn mint(thread: &str) -> String {
    format!("test-mark:{thread}")
}

#[test]
fn claude_채팅의_runtime과_그_자식이_그_채팅의_표식을_문다() {
    let sandbox = Sandbox::new();
    let host = sandbox
        .host_builder(sandbox.claude_login_shell("normal", &[FOREIGN]), |_| {})
        .mark_runtimes(mint)
        .build();

    let thread = host.start_thread("안녕", ThreadLink::NoWork).expect("새 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let receipt = sandbox.claude_receipt(&sandbox.thread_session_id(&thread));
    assert_eq!(receipt["env"][RUNTIME_KEY_ENV], json!(mint(&thread)), "claude가 채팅의 표식을 안 물었다: {}", receipt["env"]);
}

#[test]
fn codex_채팅의_runtime이_그_채팅의_표식을_문다() {
    let sandbox = Sandbox::new();
    let host = sandbox
        .host_builder(sandbox.codex_login_shell("codex-acp-2.2.2/turns", &[FOREIGN]), |_| {})
        .mark_runtimes(mint)
        .build();

    let picks = StartPicks { runtime: Runtime::Codex, ..StartPicks::default() };
    let thread = host
        .start_thread_picking("Reply with exactly one word: ok", &[], ThreadLink::NoWork, picks)
        .expect("Codex 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let receipt = sandbox.acp_receipt(&sandbox.thread_session_id(&thread));
    assert_eq!(receipt["env"][RUNTIME_KEY_ENV], json!(mint(&thread)), "codex-acp가 채팅의 표식을 안 물었다: {}", receipt["env"]);
}

/// **표식을 짓지 않는 호스트는 표식을 안 심고, 로그인 env의 남의 표식도 안 넘긴다** — 앱을 띄운 채팅의 표식을 물면 그 채팅의 실행이 이
/// 앱의 Runtime을 제 채팅의 자손으로 끝낸다. 앵커: 로그인 env의 다른 값(가짜 claude의 시나리오)은 그대로 간다.
#[test]
fn 로그인_env의_남의_표식은_runtime에_가지_않는다() {
    let sandbox = Sandbox::new();
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[FOREIGN]));

    let thread = host.start_thread("안녕", ThreadLink::NoWork).expect("새 채팅의 첫 말");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.shut_down();

    let env = &sandbox.claude_receipt(&sandbox.thread_session_id(&thread))["env"];
    assert_eq!(env[RUNTIME_KEY_ENV], Value::Null, "남의 표식이 Runtime에 갔다: {env}");
    assert_eq!(env["FAKE_CLAUDE_SCENARIO"], json!("normal"), "로그인 env가 claude에 안 닿았다 — 위 단언이 아무것도 안 잰다: {env}");
}
