//! L1 — 대화 호스트 ↔ Claude 변환기(시험 bin) ↔ 가짜 claude: Claude 두 턴의 결과 기록이 검사 자료와 같다(three-axes 티켓 14 ·
//! S26). 호스트와 변환기가 잇는 끝맺음이다 — 열림 줄 · 명령 목록 · 세션 정보 · 턴의 update · 사용량 · 턴 끝이 한 기록에 선다.
//!
//! 턴을 옮기는 갈래(답 · 생각 · 도구 · diff · 내장 명령 · 사용량 · 서브에이전트)는 변환기 상태 기계의 시험
//! (`src/translator/machine/tests.rs`)이 같은 녹화를 프로세스 없이 먹여 잰다.

mod common;

use atelier_acp::{Agent, ConversationHost};
use common::Sandbox;
use serde_json::Value;

/// 말들을 차례로 보내고, 말마다 그 턴이 끝나기를 기다린다. 다 끝난 기록을 돌려준다.
fn converse(sandbox: &Sandbox, host: &ConversationHost, conversation: &str, texts: &[&str]) -> Vec<Value> {
    for (n, text) in texts.iter().enumerate() {
        host.send("cart", conversation, text).expect("보내기");
        sandbox.wait_kind("cart", conversation, "turn-end", n + 1);
    }
    sandbox.record("cart", conversation)
}

/// S26 — 「Claude 두 턴」(답만 하는 턴 · `Write` · `Read` · `Bash`의 턴)의 결과 기록이 검사 자료로 서고, 매번 다시 지은
/// 기록이 그것과 같다. 대화창의 L3 목업 백엔드가 이 파일을 그대로 쏜다 — 도구 줄(티켓 18)과 열림 줄 · 명령 목록(티켓 19).
#[test]
fn claude_두_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 진짜 claude처럼 로그인된 계정을 싣는다 — 자료에도 가린 꼴로 선다.
    let shell = sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.282/twoturn-tools"), ("FAKE_CLAUDE_ACCOUNT_EMAIL", "someone@example.com")],
    );
    let host = sandbox.host(shell);
    let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화").id;
    sandbox.wait_record("cart", &conversation, |record| {
        record.iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "available_commands_update")
    });

    let record = converse(
        &sandbox,
        &host,
        &conversation,
        &["세 낱말로 답해 줘: hello from turn", "notes.txt에 gate를 쓰고, 읽고, wc -c로 바이트를 세 줘"],
    );
    host.shut_down();

    let session_id = sandbox.agent_session_id("cart", &conversation);
    common::assert_record("claude-two-turns", &common::fix_record(&record, &sandbox.data_root(), &session_id));
}
