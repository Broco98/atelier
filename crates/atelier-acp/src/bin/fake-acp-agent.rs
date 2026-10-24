//! 검사가 진짜 `codex-acp` 대신 상대하는 가짜 ACP 에이전트(three-axes 결정 12 — Codex를 먼저 잇는다).
//!
//! 프로토콜 크레이트의 에이전트 쪽을 쓰지 않고 표준입출력 위 **줄 단위 JSON-RPC 응답기로 손수 짰다.**
//! 크레이트가 양쪽에 있으면 검사가 실패했을 때 런타임이 틀렸는지 가짜가 틀렸는지 가를 수 없다.
//!
//! 호스트는 이것을 임시 PATH의 `codex-acp`라는 이름으로, **인자 없이 · 로그인 env 그대로** 띄운다. 그래서
//! 시나리오와 영수증 자리는 argv가 아니라 가짜 로그인 셸이 찍는 env로 받는다.
//!
//! - `FAKE_ACP_SCENARIO` — 시나리오 이름(없으면 `normal`).
//! - `FAKE_ACP_RECEIPTS` — 영수증 폴더. 세션 cwd에 떨어뜨리지 않는다 — cwd는 spec 폴더이거나 워크트리라,
//!   거기 남긴 파일은 고친 곳 비교에 「새 문서」로 잡힌다.
//! - `FAKE_ACP_VERSION` — `initialize`의 `agentInfo.version`(없으면 판 02가 잰 `2.2.2`).
//! - `FAKE_ACP_STDERR` — 프롬프트를 받을 때마다 stderr에 쓸 줄들(`|`로 가른다).
//! - `FAKE_ACP_UPDATES_AFTER_OPEN` — `session/new`의 답 바로 뒤에 몰아 보낼 `available_commands_update`의 수.
//! - `FAKE_ACP_DIES` — `dies-mid-turn`이 어느 쪽부터 사라지나(`exit-first` · `eof-first`).
//! - `FAKE_ACP_LONG_TURNS` — `long-turn`에서 cancel을 기다리는 턴의 수(없으면 모든 턴). 그 뒤의 턴은 `normal`이다.
//! - `FAKE_ACP_ACCOUNT_EMAIL` — 있으면 `session/new`의 답 앞에 그 이메일이 든 `_auth/status_update`를 보낸다
//!   (진짜 codex-acp가 로그인된 계정을 알리는 모양 — 실측 turns 4줄).
//! - `FAKE_CODEX_AUTH` — `needs-auth`가 보는 로그인 파일. 있으면 로그인됨이다 — 가짜 `codex login`이 끝나며 쓴다
//!   (진짜는 `~/.codex/auth.json`).
//! - `FAKE_ACP_AUTH_PAUSES` — 있으면 `needs-auth`가 로그인이 풀린 채 받은 프롬프트를 `<세션 id>.go`가 설 때까지
//!   붙잡은 뒤 `-32000`으로 답한다 — 대기 줄에 말이 든 채로 로그인이 풀려 끝나는 턴을 잰다(three-axes 티켓 07 · 12).
//! - `FAKE_ACP_PERMISSION_TOOL_CALL` — `bare`면 `asks-permission`의 권한 요청 `toolCall`에 `toolCallId` · `kind` ·
//!   `status`만 싣는다(codex의 MCP 승인 모양 — 워크플로 G12). 런타임이 앞선 `tool_call`로 채우는지 잰다.
//! - `FAKE_ACP_PERMISSION_WITHDRAWS` — 있으면 `asks-permission`이 권한을 묻고 **답을 기다리지 않고** 턴을 끝낸다.
//! - `FAKE_ACP_PERMISSION_OUT_OF_TURN` — 있으면 `asks-permission`이 턴을 먼저 끝내고(`end_turn`) 그 뒤에 묻는다 — 턴 밖에서
//!   걸린 권한이다. 답 뒤의 도구 update도 턴 밖에서 온다.
//! - `FAKE_ACP_FORGETS` — 있으면 되살리기(`session/resume` · `session/load`)를 모르는 세션으로 거절한다 — 에이전트의 세션
//!   저장소가 비었다(three-axes 티켓 10). 없으면 이 영수증 폴더에 `<세션 id>.json`이 있는 세션(가짜가 연 세션)을 안다.
//! - `FAKE_ACP_DIES_ASKING` — 있으면 `dies-mid-turn`이 죽기 전에 권한을 묻고, `<세션 id>.go`가 설 때까지 기다렸다 죽는다 —
//!   권한이 걸린 채 죽는 갈래(three-axes 티켓 10).
//! - `FAKE_ACP_REVIVE_HOLDS` — 있으면 아는 세션의 되살리기(`session/resume` · `session/load`)를 답하기 전에 `<세션 id>.go`가 설
//!   때까지 붙잡는다 — 되살리는 동안 온 명령(칩의 바꾸기)을 잰다.
//! - `FAKE_ACP_LINGERS` — 있으면 시나리오가 끝나도(stdin이 닫혀도) 끝나지 않는다 — `ignores-shutdown`처럼 끄기가 1초 한도를 다
//!   쓴다. 호스트가 대화를 끄는 그 1초 사이에 닿은 명령을 잰다.
//!
//! - `writes-spec` 시나리오의 `hold` 단계는 영수증 폴더에 그 이름의 파일(문)이 생길 때까지 턴을 붙잡는다.
//! - 영수증 폴더의 `<세션 id>.go` — `pauses-mid-turn`이 턴 도중 이 파일이 생길 때까지 기다린다. 검사가 턴 한가운데에서
//!   할 일(work 폴더 옮기기 · 지우기)을 한 뒤 놓는다.
//!
//! 영수증은 `session/new`를 받을 때 `<세션 id>.json` 한 장으로 남는다 — pid · 자기 Unix 세션 id(`getsid(0)`) ·
//! 받은 env · `initialize`와 `session/new`의 인자 · 낳은 후손의 pid. 그 뒤에 일어난 일(stdin EOF)은
//! `<세션 id>.events`에 한 줄씩, 받은 `session/prompt`의 인자는 `<세션 id>.prompts`에 한 줄씩 더한다. 세션을 연 뒤
//! 받은 메시지의 메서드는 요청이든 알림이든 `<세션 id>.inbox`에 받은 차례대로 더한다 — 멈추기와 다음 말의 차례를 잰다.
//! 가짜가 보낸 요청(권한 요청)에 받은 답은 원문 그대로 `<세션 id>.responses`에 한 줄씩 더한다. 받은 모드 · 설정 바꾸기
//! (`session/set_mode` · `session/set_config_option`)는 메서드와 인자를 `<세션 id>.config`에 한 줄씩 더한다.
//!
//! 세션과 상관없는 영수증 둘(three-axes 티켓 10): 뜰 때마다(`initialize`를 받을 때마다) `launches`에 `{pid}` 한 줄, 받은
//! 되살리기마다 `revivals`에 `{pid, method, params, ok}` 한 줄. 되살린 세션은 옛 세션 id를 그대로 쓰므로 그 뒤의 영수증
//! (`prompts` · `inbox` · `config` …)은 옛 세션의 파일에 이어 적힌다.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Value};

#[path = "../fakes/receipts.rs"]
#[allow(dead_code)] // 가짜들이 함께 쓰는 영수증 배관이라 이 가짜가 쓰지 않는 몫이 있다.
mod receipts;

/// 시나리오 하나가 대화 전체를 스스로 몬다.
type Scenario = fn(&mut Fake);

/// 프롬프트 하나를 어떻게 상대하는가 — `(가짜, 요청 id, 세션 id)`. 시나리오들은 대개 여기서만 갈린다.
type OnPrompt = fn(&mut Fake, &Value, &str);

/// 시나리오를 고르는 표. 더할 때는 **여기 한 줄과 함수 하나**를 더한다.
const SCENARIOS: &[(&str, Scenario)] = &[
    ("normal", normal),
    ("refuses-prompt", refuses_prompt),
    ("long-turn", long_turn),
    ("late-update-after-cancel", late_update_after_cancel),
    ("dies-mid-turn", dies_mid_turn),
    ("ignores-shutdown", ignores_shutdown),
    ("spawns-a-child", spawns_a_child),
    ("writes-spec", writes_spec),
    ("pauses-mid-turn", pauses_mid_turn),
    ("needs-auth", needs_auth),
    ("asks-permission", asks_permission),
    ("deny-cancels", deny_cancels),
    ("modes-and-models", modes_and_models),
    ("commands", commands),
    ("plan-mode", plan_mode),
    ("resume-advertised", resume_advertised),
    ("replays-on-load", replays_on_load),
    ("resume-resets-config", resume_resets_config),
];

fn main() {
    let name = std::env::var("FAKE_ACP_SCENARIO").unwrap_or_else(|_| "normal".to_string());
    let Some(&(_, scenario)) = SCENARIOS.iter().find(|(key, _)| *key == name) else {
        let known: Vec<&str> = SCENARIOS.iter().map(|(key, _)| *key).collect();
        eprintln!("모르는 시나리오: {name} (있는 것: {})", known.join(", "));
        std::process::exit(2);
    };
    scenario(&mut Fake::new());
    if std::env::var_os("FAKE_ACP_LINGERS").is_some() {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3600));
        }
    }
}

/// 무엇을 물어도 정상으로 답하고, stdin이 닫히면 끝나는 에이전트. 어긋난 시나리오들의 기준선이다.
fn normal(fake: &mut Fake) {
    fake.converse();
}

/// 세션은 정상으로 열리지만 프롬프트마다 오류로 답한다. 실물에서 낡은 어댑터가 모델 API의 오류를 이 자리로
/// 그대로 돌려줬다(8월 가짜 그대로).
fn refuses_prompt(fake: &mut Fake) {
    fake.on_prompt = |fake, id, _session_id| fake.wire.reply_error(id, -32603, "Internal error: model unavailable");
    fake.converse();
}

/// 턴 도중에 **스스로 죽는** 에이전트 — 답도 오류도 없이 사라진다. 죽기 전에 stderr에 유언을 남긴다.
///
/// 호스트는 수신 EOF와 자식의 끝을 둘 다 본다. 어느 쪽이 먼저 와도 죽음을 알아야 하므로 순서를 고를 수 있다.
/// - `exit-first`: 출력을 쥔 손주(`sleep`)를 남기고 exit 3 — 자식은 끝났지만 수신 EOF는 오지 않는다.
/// - `eof-first`: stdout을 닫고 살아 버틴다 — 수신 EOF는 왔지만 자식은 끝나지 않는다.
///
/// `FAKE_ACP_DIES_ASKING`이 있으면 죽기 전에 권한을 묻고, 검사가 `<세션 id>.go`로 놓을 때까지 걸린 채 기다렸다 죽는다.
///
/// 한 번만 죽는다 — 죽을 때 영수증 폴더에 표지(`dies-mid-turn.died`)를 두고, 표지가 있으면 그 뒤에 뜬 가짜는 「Codex 한 턴」으로
/// 답한다. 죽은 대화가 다음 말에서 다시 뜬 뒤 이어 가는지를 잰다(three-axes 티켓 10).
fn dies_mid_turn(fake: &mut Fake) {
    fake.on_prompt = |fake, id, session_id| {
        let marker = fake.receipts.as_ref().map(|dir| dir.join("dies-mid-turn.died"));
        if marker.as_ref().is_some_and(|marker| marker.exists()) {
            return codex_one_turn(fake, id, session_id);
        }
        fake.update(
            session_id,
            json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "시작한다…"}}),
        );
        if std::env::var_os("FAKE_ACP_DIES_ASKING").is_some() {
            fake.request(
                "session/request_permission",
                json!({"sessionId": session_id,
                       "toolCall": {"toolCallId": "exec-fake-dies", "kind": "execute", "status": "pending",
                                    "title": PERMISSION_COMMAND, "rawInput": {"command": PERMISSION_COMMAND}},
                       "options": [allow_once_option(), reject_option()]}),
            );
            fake.hold_until_released(session_id);
        }
        if let Some(marker) = marker {
            let _ = std::fs::write(marker, "");
        }
        eprintln!("thread 'main' panicked at codex-rs/core/src/turn.rs:42");
        eprintln!("note: run with RUST_BACKTRACE=1");
        match std::env::var("FAKE_ACP_DIES").as_deref() {
            Ok("eof-first") => {
                // SAFETY: 자기 stdout 하나를 닫을 뿐이다. 뒤로는 stdout에 쓰지 않는다.
                unsafe {
                    libc::close(1);
                }
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(3600));
                }
            }
            _ => {
                // 손주는 stdout · stderr를 물려받아 쥔 채 남는다. 거두지 않는 것이 이 시나리오다.
                #[allow(clippy::zombie_processes)]
                let holder = Command::new("sleep").arg("600").stdin(Stdio::null()).spawn().expect("손주를 낳지 못했다");
                fake.append_receipt("pids", &holder.id().to_string());
                std::process::exit(3);
            }
        }
    };
    fake.converse();
}

/// 오래 도는 턴 — **`session/cancel`이 올 때까지 답하지 않는다.** 잠들어 기다리지 않고 cancel을 읽어서 끝낸다
/// (8월 가짜 그대로). 멈추기와 턴이 도는 동안의 일(대기 줄 · 지금 보내기)을 잰다. `FAKE_ACP_LONG_TURNS`가 있으면 그
/// 수의 턴만 그렇게 돌고, 그 뒤의 턴은 `normal`이다.
fn long_turn(fake: &mut Fake) {
    fake.on_prompt = |fake, id, session_id| {
        let long_turns = std::env::var("FAKE_ACP_LONG_TURNS").ok().and_then(|n| n.parse().ok()).unwrap_or(usize::MAX);
        if fake.prompts > long_turns {
            return codex_one_turn(fake, id, session_id);
        }
        fake.update(
            session_id,
            json!({"sessionUpdate": "agent_message_chunk",
                   "content": {"type": "text", "text": "한참 걸리는 일을 시작한다…"}}),
        );
        if fake.await_cancel() {
            fake.wire.reply(id, json!({"stopReason": "cancelled"}));
        }
    };
    fake.converse();
}

/// 멈춘 뒤에도 도구 update를 **늦게** 보내는 에이전트(three-axes 결정 28). codex의 `session/cancel`은 턴만 멈추고,
/// 돌던 셸 명령은 끝까지 돌아 그 `tool_call_update`(출력 → 완료)가 턴이 끝난 뒤에 온다. cancel 때 열린 도구 줄을 닫는
/// update는 따로 없다(실측 `codex-acp-2.2.2-cancel-late-updates.jsonl` — 18초 뒤).
///
/// 첫 턴은 답 조각과 명령 도구 줄(진행)을 보내고 `long-turn`처럼 cancel을 기다린다. cancel이 오면 `cancelled`로 답하고,
/// 잠깐 뒤 그 도구의 출력과 완료를 보낸다. 그 뒤의 턴은 `normal`이다. **이 순서가 곧 검사 자료(S26)다** — 바꾸면
/// `tests/records/late-after-cancel.jsonl`을 다시 지어야 한다.
fn late_update_after_cancel(fake: &mut Fake) {
    fake.on_prompt = |fake, id, session_id| {
        if fake.prompts > 1 {
            return codex_one_turn(fake, id, session_id);
        }
        let command = "python3 -c \"import time; time.sleep(20); print('slept-fake')\"";
        for update in [
            json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_fake_late",
                   "content": {"type": "text", "text": "I'll run the exact command and wait for it to complete."}}),
            json!({"sessionUpdate": "tool_call", "toolCallId": "exec-fake-late", "name": "exec_command",
                   "kind": "execute", "title": command, "status": "in_progress",
                   "content": [{"type": "terminal", "terminalId": "exec-fake-late"}],
                   "rawInput": {"command": command}}),
        ] {
            fake.update(session_id, update);
        }
        if !fake.await_cancel() {
            return;
        }
        fake.wire.reply(id, json!({"stopReason": "cancelled"}));
        // 명령은 멈추지 않고 끝까지 돈다 — 그 출력과 끝이 턴 밖에서 온다.
        std::thread::sleep(std::time::Duration::from_millis(100));
        for update in [
            json!({"sessionUpdate": "tool_call_update", "toolCallId": "exec-fake-late",
                   "_meta": {"terminal_output_delta": {"data": "slept-fake\n", "terminal_id": "exec-fake-late"}}}),
            json!({"sessionUpdate": "tool_call_update", "toolCallId": "exec-fake-late", "name": "exec_command",
                   "status": "completed",
                   "_meta": {"terminal_exit": {"exit_code": 0, "signal": null, "terminal_id": "exec-fake-late"}}}),
        ] {
            fake.update(session_id, update);
        }
    };
    fake.converse();
}

/// 「Codex 한 턴」 — 생각 · 답 · 도구 줄(진행 → 완료, 명령 출력) · 모르는 kind · 마지막 답 · 사용량. 모양은
/// codex-acp 2.2.2 실측(`codex-acp-2.2.2-turns.jsonl`)을 줄였다. **이 순서가 곧 검사 자료(S26)다** — 바꾸면
/// `tests/records/codex-one-turn.jsonl`을 다시 지어야 한다.
fn codex_one_turn(fake: &mut Fake, id: &Value, session_id: &str) {
    for update in [
        json!({"sessionUpdate": "agent_thought_chunk", "messageId": "rs_fake_1",
               "content": {"type": "text", "text": "**Reading the request**"}}),
        json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_fake_1",
               "content": {"type": "text", "text": "Plan: run `echo atelier`."}}),
        json!({"sessionUpdate": "tool_call", "toolCallId": "exec-fake-1", "kind": "execute",
               "title": "echo atelier", "status": "in_progress",
               "content": [{"type": "terminal", "terminalId": "exec-fake-1"}],
               "rawInput": {"command": ["/bin/zsh", "-lc", "echo atelier"]}}),
        json!({"sessionUpdate": "tool_call_update", "toolCallId": "exec-fake-1", "status": "completed",
               "_meta": {"terminal_output_delta": {"data": "atelier\n", "terminal_id": "exec-fake-1"},
                         "terminal_exit": {"exit_code": 0, "signal": null, "terminal_id": "exec-fake-1"}}}),
        // 스키마가 모르는 kind — 런타임이 역직렬화하지 않고 원문 그대로 넘기는지, 그 뒤로 턴이 이어지는지.
        json!({"sessionUpdate": "atelier_fake_unknown_kind", "note": "스키마에 없는 kind", "nested": {"kept": true}}),
        json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_fake_2",
               "content": {"type": "text", "text": "Ran `echo atelier`; it printed `atelier`."}}),
        json!({"sessionUpdate": "usage_update", "used": 1200, "size": 258400}),
    ] {
        fake.update(session_id, update);
    }
    fake.wire.reply(
        id,
        json!({"stopReason": "end_turn",
               "usage": {"totalTokens": 1400, "inputTokens": 1200, "outputTokens": 200}}),
    );
}

/// 턴 도중 spec 폴더에 파일을 쓰고 · 고치고 · 지우는 에이전트(three-axes 티켓 06 — 고친 곳은 턴 앞뒤의 비교로
/// 찾는다, three-axes 결정 22). spec 폴더는 `session/new`가 준 자리다 — 함께 여는 폴더가 있으면 그것, 없으면
/// cwd(three-axes 결정 17).
///
/// 사람의 글(프롬프트의 마지막 텍스트 블록)에 `{"op": …}` 꼴의 JSON 줄이 있으면 그 단계들을 차례로 밟고, 없으면
/// [`SPEC_PLAN`]을 밟는다. 글을 고치는 세 단계(`write` · `replace` · `delete`)는 진짜 codex-acp처럼 고치기 전에
/// edit 도구 줄을, 고친 뒤에 완료를 보낸다. `"silent": true`면 도구 update 없이 고친다 — 셸 명령으로 고친 것과
/// 같은 모양이다. 나머지 단계는 늘 조용하다.
///
/// - `write {path, text}` — 그 글로 쓴다(없으면 폴더째 만든다). `replace {path, from, to}` — 처음 만난 하나를 바꾼다.
///   `delete {path}` — 지운다.
/// - `flip {path, at}` — 그 바이트를 뒤집는다(크기는 그대로). `rewrite {path}` — 같은 바이트를 다시 쓴다(내용은 그대로).
/// - `hold {gate}` — 영수증 폴더에 `gate` 파일이 생길 때까지 턴을 붙잡는다. 함께 도는 다른 대화가 그 사이에 고친다.
fn writes_spec(fake: &mut Fake) {
    fake.on_prompt = |fake, id, session_id| {
        let text = human_text(&fake.prompt);
        let mut steps: Vec<Value> = text
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .filter(|step| step.get("op").is_some())
            .collect();
        if steps.is_empty() {
            steps = serde_json::from_str(SPEC_PLAN).expect("SPEC_PLAN은 JSON이다");
        }
        for step in &steps {
            fake.spec_step(session_id, step);
        }
        fake.update(
            session_id,
            json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_fake_spec",
                   "content": {"type": "text", "text": "spec을 고쳤다."}}),
        );
        fake.wire.reply(id, json!({"stopReason": "end_turn"}));
    };
    fake.converse();
}

/// `writes-spec`이 사람의 글에 단계가 없을 때 밟는 「고친 곳」 — 새 문서 · 고침 · 지움, 그리고 도구 update 없이
/// 고친 텍스트 파일. 검사가 먼저 깐 spec(`plan.md` · `old.md` · `notes.txt`)을 고친다.
///
/// **이 단계들이 곧 검사 자료(S26)다** — 바꾸면 `tests/records/changes.jsonl`과 `changes.spec/`을 다시 지어야 한다.
const SPEC_PLAN: &str = r##"[
    {"op": "write", "path": "drafts/idea.md", "text": "# 아이디어\n\n새로 쓴 문서다.\n"},
    {"op": "replace", "path": "plan.md", "from": "첫 문단이다.\n", "to": "요약 한 줄.\n첫 문단을 고쳤다.\n"},
    {"op": "replace", "path": "plan.md", "from": "- 둘\n", "to": "- 둘을 고쳤다.\n"},
    {"op": "delete", "path": "old.md"},
    {"op": "replace", "path": "notes.txt", "from": "초안\n", "to": "다듬은 글\n", "silent": true}
]"##;

/// 프롬프트의 마지막 텍스트 블록 — 사람의 글이다(머리말은 그 앞의 따로 된 블록이다).
fn human_text(prompt: &Value) -> String {
    prompt["prompt"]
        .as_array()
        .and_then(|blocks| blocks.iter().rev().find(|block| block["type"] == "text"))
        .and_then(|block| block["text"].as_str())
        .unwrap_or_default()
        .to_owned()
}

/// **끄기를 무시하는** 에이전트. 얌전한 끄기 신호는 stdin 닫기인데, 그것을 받고도 끝나지 않는다 — 남는 길은
/// 프로세스 그룹째 SIGKILL뿐이다.
fn ignores_shutdown(fake: &mut Fake) {
    fake.converse();
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}

/// 자식과 손주를 낳는 에이전트. 진짜 codex-acp도 node → app-server → 네이티브 codex로 트리를 이루고, codex는
/// 셸 도구를 또 띄운다. 직계만 끄면 손주가 남는다.
///
/// 자식은 셸이고, 셸이 잠드는 손주를 낳는다. 둘 다 거두지 않는다 — 부모보다 오래 사는지가 검사할 것이다.
/// 후손의 stdout은 따로 문다. ACP 선(stdout)에 섞이면 프로토콜이 깨진다.
fn spawns_a_child(fake: &mut Fake) {
    #[allow(clippy::zombie_processes)]
    let mut child = Command::new("/bin/sh")
        .args(["-c", "sleep 600 & echo $!; wait"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("자식을 낳지 못했다");
    let mut line = String::new();
    BufReader::new(child.stdout.take().expect("파이프로 띄웠다")).read_line(&mut line).expect("손주의 pid");
    let grandchild: u32 = line.trim().parse().expect("손주의 pid는 수다");
    fake.descendants = vec![child.id(), grandchild];
    fake.converse();
}

/// 턴 한가운데에서 **검사가 놓을 때까지 멈추는** 에이전트 — 사라진 work(three-axes 티켓 11)를 잰다.
///
/// 프롬프트를 받으면 update 하나를 보내고, 영수증 폴더에 `<세션 id>.go`가 생길 때까지 기다렸다가 update 하나를
/// 더 보내고 턴을 끝낸다. 그 사이 검사가 work 폴더를 옮기거나 지운다 — 아카이브를 시킨 에이전트가 바로 그 턴 안에
/// 있는 꼴이다. `spawns-a-child`처럼 자식과 손주를 낳는다 — 턴 끝에 꺼질 때 후손까지 꺼지는지 잰다.
fn pauses_mid_turn(fake: &mut Fake) {
    fake.on_prompt = |fake, id, session_id| {
        fake.update(
            session_id,
            json!({"sessionUpdate": "agent_message_chunk",
                   "content": {"type": "text", "text": "멈추기 전의 답"}}),
        );
        fake.note("paused");
        fake.hold_until_released(session_id);
        fake.update(
            session_id,
            json!({"sessionUpdate": "agent_message_chunk",
                   "content": {"type": "text", "text": "놓인 뒤의 답"}}),
        );
        fake.wire.reply(id, json!({"stopReason": "end_turn"}));
    };
    spawns_a_child(fake);
}

/// 로그인이 안 된 codex-acp(실측 A3 · `codex-acp-2.2.2-noauth.jsonl`) — `initialize`는 정상으로 답하고 곧바로
/// `_auth/status_update{kind:"none"}`을 보낸 뒤, `session/new`를 `-32000 Authentication required`로 거절한다. 세션이
/// 열린 뒤 로그인이 풀리면 `session/prompt`도 같은 오류다.
///
/// 로그인 파일(`FAKE_CODEX_AUTH`)이 있으면 보통 에이전트다 — 그래서 로그인 명령이 끝난 뒤 다시 띄운 에이전트는 세션을 연다.
fn needs_auth(fake: &mut Fake) {
    fake.needs_auth = true;
    fake.on_prompt = |fake, id, session_id| {
        if fake.logged_in() {
            codex_one_turn(fake, id, session_id);
        } else {
            if std::env::var_os("FAKE_ACP_AUTH_PAUSES").is_some() {
                fake.hold_until_released(session_id);
            }
            fake.wire.reply_error(id, -32000, "Authentication required");
        }
    };
    fake.converse();
}

/// 권한을 묻는 에이전트(three-axes 티켓 08) — 도구를 쓰기 전에 `session/request_permission`을 보내고 답을 기다린다.
/// 허락이면 도구가 끝나고 턴이 이어지고(`end_turn`), 거부면 그 도구만 실패하고 턴이 이어진다. 멈추면(`session/cancel`)
/// 진짜 codex-acp처럼 **걸린 요청의 답을 기다리지 않고** 곧바로 `cancelled`로 끝낸다(실측 G2 · `codex-acp-2.2.2-g2-cancel.jsonl`).
///
/// 모양은 codex-acp 2.2.2 실측 G2(`workspace-write` 모드에서 워크트리 밖에 쓰는 명령)를 줄였다 — 선택지 셋 · 요청 id 0.
/// 요청을 보낸 뒤 답을 기다리는 동안에도 update 둘을 보낸다. 진짜에는 없는 줄이지만, 호스트의 수신 루프가 요청에 막히지
/// 않는지를 이것으로 잰다. **이 순서가 곧 검사 자료(S26)다** — 바꾸면 `tests/records/permission.jsonl`을 다시 지어야 한다.
fn asks_permission(fake: &mut Fake) {
    fake.on_prompt = |fake, id, session_id| ask_permission(fake, id, session_id, false);
    fake.converse();
}

/// 권한 거부가 턴을 끝내는 에이전트 — codex-acp 2.2.2는 거부 선택지(`cancel`)를 받으면 그 도구를 `failed`로 닫고 턴을
/// `stopReason: cancelled`로 끝낸다. 우리가 cancel을 보내지 않았는데도 그렇다(실측 G2 · 워크플로 함정 14). **이 순서가 곧
/// 검사 자료(S26)다** — 바꾸면 `tests/records/permission-deny.jsonl`을 다시 지어야 한다.
fn deny_cancels(fake: &mut Fake) {
    fake.on_prompt = |fake, id, session_id| ask_permission(fake, id, session_id, true);
    fake.converse();
}

/// 권한을 물을 명령 — 워크트리 밖에 쓴다(실측 G2와 같은 꼴, 경로만 고정값).
const PERMISSION_COMMAND: &str = "printf 'g2' > /tmp/fake-outside/g2.txt";

/// codex-acp 2.2.2의 명령 승인 선택지 가운데 「한 번 허락」(실측 G2).
fn allow_once_option() -> Value {
    json!({"optionId": "allow_once", "name": "Yes, proceed", "kind": "allow_once"})
}

/// codex-acp 2.2.2의 명령 승인 선택지 가운데 「거부」(실측 G2) — optionId가 `cancel`이다.
fn reject_option() -> Value {
    json!({"optionId": "cancel", "name": "No, and tell Codex what to do differently", "kind": "reject_once"})
}

/// 가짜가 보낸 권한 요청이 어떻게 끝났나([`Fake::await_answer`]).
enum Answer {
    /// 멈췄다 — `session/cancel`이 왔거나, 고르지 않은 답이 왔다.
    Cancelled,
    /// 고른 선택지의 optionId.
    Selected(String),
}

/// `asks-permission` · `deny-cancels`의 턴 하나. `deny_cancels`면 거부가 턴을 `cancelled`로 끝낸다.
fn ask_permission(fake: &mut Fake, id: &Value, session_id: &str, deny_cancels: bool) {
    let call = if deny_cancels { "exec-fake-deny" } else { "exec-fake-perm" };
    // 턴의 답은 한 번만 간다 — 턴 밖에서 묻는 갈래는 처음에 답했다.
    let mut answered_turn = false;
    let mut end_turn = |fake: &mut Fake, stop_reason: &str| {
        if !std::mem::replace(&mut answered_turn, true) {
            fake.wire.reply(id, json!({"stopReason": stop_reason}));
        }
    };
    if std::env::var_os("FAKE_ACP_PERMISSION_OUT_OF_TURN").is_some() {
        end_turn(fake, "end_turn");
    }
    fake.update(
        session_id,
        json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_fake_perm_1",
               "content": {"type": "text", "text": "I'll request escalated permission for that exact command.\n"}}),
    );
    fake.update(
        session_id,
        json!({"sessionUpdate": "session_info_update",
               "_meta": {"codex": {"threadStatus": {"type": "active", "activeFlags": ["waitingOnApproval"]}}}}),
    );
    fake.update(
        session_id,
        json!({"sessionUpdate": "tool_call", "toolCallId": call, "kind": "execute", "title": PERMISSION_COMMAND,
               "status": "in_progress", "content": [{"type": "terminal", "terminalId": call}],
               "rawInput": {"command": PERMISSION_COMMAND, "cwd": "/tmp/fake-worktree"}}),
    );
    let tool_call = match std::env::var("FAKE_ACP_PERMISSION_TOOL_CALL").as_deref() {
        // codex의 MCP 승인 모양 — 제목도 입력도 없다(워크플로 G12).
        Ok("bare") => json!({"toolCallId": call, "kind": "execute", "status": "pending"}),
        _ => json!({"toolCallId": call, "title": "Run command",
                    "rawInput": {"command": format!("\"{PERMISSION_COMMAND}\""), "cwd": "/tmp/fake-worktree"},
                    "kind": "execute", "status": "pending"}),
    };
    let options = json!([
        allow_once_option(),
        {"optionId": "accept_execpolicy_amendment",
         "name": format!("Yes, and don't ask again for commands that start with `{PERMISSION_COMMAND}`"),
         "kind": "allow_always"},
        reject_option()
    ]);
    let request = fake.request(
        "session/request_permission",
        json!({"sessionId": session_id, "toolCall": tool_call, "options": options}),
    );
    for text in ["승인을 기다리는 동안에도", " update는 흐른다."] {
        fake.update(
            session_id,
            json!({"sessionUpdate": "agent_thought_chunk", "messageId": "rs_fake_perm",
                   "content": {"type": "text", "text": text}}),
        );
    }
    if std::env::var_os("FAKE_ACP_PERMISSION_WITHDRAWS").is_some() {
        // 답을 기다리지 않고 턴을 끝낸다 — 걸린 요청은 남은 채다. 뒤에 온 답은 `responses` 영수증에 남는다.
        return end_turn(fake, "end_turn");
    }
    // 상대가 사라지면 답할 곳이 없다. 멈추거나 고르지 않으면 걸린 요청의 답을 기다리지 않고 턴을 끝낸다(실측 G2).
    let Some(answer) = fake.await_answer(&request) else { return };
    let Answer::Selected(chosen) = answer else { return end_turn(fake, "cancelled") };
    let kind = options
        .as_array()
        .and_then(|options| options.iter().find(|option| option["optionId"] == chosen.as_str()))
        .and_then(|option| option["kind"].as_str())
        .unwrap_or_default();
    if kind.starts_with("allow") {
        fake.update(
            session_id,
            json!({"sessionUpdate": "tool_call_update", "toolCallId": call, "name": "exec_command",
                   "status": "completed",
                   "_meta": {"terminal_exit": {"exit_code": 0, "signal": null, "terminal_id": call}}}),
        );
        fake.update(
            session_id,
            json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_fake_perm_2",
                   "content": {"type": "text", "text": "Done."}}),
        );
        return end_turn(fake, "end_turn");
    }
    // 거부 — 그 도구가 실패로 닫힌다.
    fake.update(
        session_id,
        json!({"sessionUpdate": "tool_call_update", "toolCallId": call, "status": "failed",
               "_meta": {"terminal_exit": {"exit_code": null, "signal": null, "terminal_id": call}}}),
    );
    if deny_cancels {
        return end_turn(fake, "cancelled");
    }
    fake.update(
        session_id,
        json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_fake_perm_2",
               "content": {"type": "text", "text": "REFUSED"}}),
    );
    end_turn(fake, "end_turn");
}

/// codex-acp 2.2.2 모양의 목록을 내는 에이전트(three-axes 티켓 09) — `session/new`의 답에 모드 넷과 configOptions 다섯
/// (`mode` · `collaboration_mode` · `model` · `reasoning_effort` · `fast-mode`)을 싣고, 모드 · 설정 바꾸기(`session/set_mode` ·
/// `session/set_config_option`)에 알림 없이 `{}`로 답한다(three-axes 결정 27). 받은 바꾸기는 `config` 영수증에 남는다.
fn modes_and_models(fake: &mut Fake) {
    fake.codex_lists = true;
    fake.converse();
}

/// 명령 목록을 보내는 에이전트(three-axes 티켓 09) — 진짜 codex-acp처럼 `session/new`의 답 뒤와 턴의 답 뒤마다
/// `available_commands_update`를 보낸다(실측 turns 6줄 · plan-mode 46줄). 모양은 실측 그대로 `{name, description, input}`이다.
fn commands(fake: &mut Fake) {
    fake.commands = true;
    fake.converse();
}

/// 계획 모드의 Codex(three-axes 결정 29 · 티켓 09) — codex-acp 2.2.2 모양의 목록과 명령 목록을 내고, 턴마다 답 조각 하나 뒤에
/// `plan_update`(마크다운, 매번 전문) 넷을 보내고 끝에 「이 계획대로 할까요?」(`session/request_permission{toolCall:{kind:
/// "switch_mode"}}`, 선택지 `implement_plan` · `revise_plan`)를 묻는다. 모양은 실측 `codex-acp-2.2.2-plan-mode.jsonl` 그대로이고
/// id만 고정값이다.
///
/// - 다시 짜기(`revise_plan`)면 실측처럼 그 도구 줄을 「계획 모드에 남았다」로 닫고 턴을 끝낸다.
/// - 구현(`implement_plan`)은 재지 않았다 — 그 도구 줄을 닫고 턴을 끝낼 뿐이다.
/// - 멈추면(`session/cancel`) 걸린 요청의 답을 기다리지 않고 `cancelled`로 끝낸다(`asks-permission`과 같다).
///
/// **이 순서가 곧 검사 자료(S26)다** — 바꾸면 `tests/records/codex-plan.jsonl`을 다시 지어야 한다.
fn plan_mode(fake: &mut Fake) {
    fake.codex_lists = true;
    fake.commands = true;
    fake.on_prompt = plan_turn;
    fake.converse();
}

/// `plan-mode`가 보내는 계획 — 실측의 넷 그대로(매번 전문이 자라며 온다).
const PLAN_STEPS: [&str; 4] = [
    "## Add `hello.txt`\n\n1. Create",
    "## Add `hello.txt`\n\n1. Create a repo-root file named `hello.txt`",
    "## Add `hello.txt`\n\n1. Create a repo-root file named `hello.txt` containing `hi`.\n2. Verify the",
    "## Add `hello.txt`\n\n1. Create a repo-root file named `hello.txt` containing `hi`.\n2. Verify the file contains exactly `hi`.\n",
];

/// `plan-mode`의 턴 하나.
fn plan_turn(fake: &mut Fake, id: &Value, session_id: &str) {
    let plan_id = "fake-plan-1-plan";
    let review = format!("plan-review:{plan_id}");
    fake.update(
        session_id,
        json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_fake_plan",
               "content": {"type": "text",
                           "text": "I'll check the repo's current state and conventions, then give you a two-step plan without changing files."}}),
    );
    for content in PLAN_STEPS {
        fake.update(
            session_id,
            json!({"sessionUpdate": "plan_update", "plan": {"type": "markdown", "planId": plan_id, "content": content}}),
        );
    }
    let request = fake.request(
        "session/request_permission",
        json!({"sessionId": session_id,
               "toolCall": {"toolCallId": review, "kind": "switch_mode", "status": "pending",
                            "title": "Implement this plan?", "rawInput": {"plan": PLAN_STEPS[3]}},
               "options": [
                   {"optionId": "implement_plan", "name": "Yes, implement this plan", "kind": "allow_once"},
                   {"optionId": "revise_plan", "name": "No, and tell Codex what to do differently", "kind": "reject_once"}
               ]}),
    );
    // 상대가 사라지면 답할 곳이 없다.
    let Some(answer) = fake.await_answer(&request) else { return };
    let Answer::Selected(chosen) = answer else { return fake.wire.reply(id, json!({"stopReason": "cancelled"})) };
    let mut closed = json!({"sessionUpdate": "tool_call_update", "toolCallId": review, "status": "completed"});
    if chosen == "revise_plan" {
        closed["rawOutput"] = json!("User kept the session in plan mode.");
    }
    fake.update(session_id, closed);
    fake.wire.reply(id, json!({"stopReason": "end_turn"}));
}

/// 되살리기를 광고하는 에이전트(three-axes 티켓 10) — 진짜 codex-acp 2.2.2처럼 `sessionCapabilities.resume`과 `loadSession`을
/// 둘 다 광고한다(실측 `codex-acp-2.2.2-initialize.json`). `session/resume`은 아는 세션이면 과거를 되감지 않고 답하고, 답 뒤에
/// 명령 목록을 보낸다(실측 session-resume). 모르는 세션이면(`FAKE_ACP_FORGETS`) resume도 load도 거절한다.
fn resume_advertised(fake: &mut Fake) {
    fake.resumes = true;
    fake.loads = true;
    fake.converse();
}

/// `session/load`만 광고하는 에이전트 — load는 답 **전에** 과거를 되감는다(실측 `codex-acp-2.2.2-session-load-replay.jsonl`:
/// 명령 목록 · 사람의 말 조각 · 답 조각). 답 뒤에는 `session_info_update` 하나를 보낸다 — 재생이 아니라 살아야 하는 줄이다.
fn replays_on_load(fake: &mut Fake) {
    fake.loads = true;
    fake.converse();
}

/// 되살리면 config 기본값으로 돌아가는 Codex(three-axes 결정 27) — `resume-advertised`에 codex-acp 2.2.2 모양의 목록과 모드 ·
/// 설정 바꾸기(`modes-and-models`)를 더했다. 되살린 답의 모드 · 모델은 앞서 무엇을 바꿨든 늘 기본값이다. 받은 바꾸기는 `config`
/// 영수증에 남는다.
fn resume_resets_config(fake: &mut Fake) {
    fake.resumes = true;
    fake.loads = true;
    fake.codex_lists = true;
    fake.converse();
}

/// 가짜 하나의 상태 — 선과, 영수증에 실을 것들.
struct Fake {
    wire: Wire,
    receipts: Option<PathBuf>,
    version: String,
    initialize: Value,
    descendants: Vec<u32>,
    session_id: Option<String>,
    on_prompt: OnPrompt,
    /// 지금까지 받은 `session/prompt`의 수 — 지금 상대하는 것까지 센다.
    prompts: usize,
    /// 지금 상대하는 `session/prompt`의 인자.
    prompt: Value,
    /// 세션의 spec 폴더 — `session/new`의 함께 여는 폴더 첫째, 없으면 cwd.
    spec_dir: Option<PathBuf>,
    /// 지금까지 보낸 edit 도구 줄의 수 — 도구 id를 매번 같게 짓는다(S26).
    edits: usize,
    /// 로그인 파일을 보나(`needs-auth`).
    needs_auth: bool,
    /// 가짜가 보낼 다음 요청의 id. 진짜 codex-acp처럼 0부터 센다(관문 함정 11 — 0을 「없음」으로 다루면 깨진다).
    requests: u64,
    /// `session/new`의 답이 codex-acp 2.2.2 모양(모드 넷 · configOptions 다섯)이고, 모드 · 설정 바꾸기를 받나. 아니면 작은
    /// 답을 주고 바꾸기는 모르는 메서드다.
    codex_lists: bool,
    /// 명령 목록(`available_commands_update`)을 `session/new`의 답 뒤와 턴의 답 뒤마다 보내나(진짜 codex-acp 그대로).
    commands: bool,
    /// `sessionCapabilities.resume`을 광고하고 `session/resume`을 받나(티켓 10).
    resumes: bool,
    /// `loadSession`을 광고하고 `session/load`를 받나(티켓 10).
    loads: bool,
}

impl Fake {
    fn new() -> Self {
        Self {
            wire: Wire::stdio(),
            receipts: std::env::var_os("FAKE_ACP_RECEIPTS").map(PathBuf::from),
            version: std::env::var("FAKE_ACP_VERSION").unwrap_or_else(|_| "2.2.2".to_string()),
            initialize: Value::Null,
            descendants: Vec::new(),
            session_id: None,
            on_prompt: codex_one_turn,
            prompts: 0,
            prompt: Value::Null,
            spec_dir: None,
            edits: 0,
            needs_auth: false,
            requests: 0,
            codex_lists: false,
            commands: false,
            resumes: false,
            loads: false,
        }
    }

    /// 그 세션의 `session/update` 하나를 보낸다.
    fn update(&mut self, session_id: &str, update: Value) {
        self.wire.notify("session/update", json!({"sessionId": session_id, "update": update}));
    }

    /// `session/cancel`이 올 때까지 읽는다 — 잠들어 기다리지 않고 cancel을 읽어서 끝낸다. 그 사이 온 `session/prompt`의
    /// 인자는 `prompts` 영수증에 남긴다. cancel도 없이 상대가 사라지면 false다 — 답할 곳이 없다.
    fn await_cancel(&mut self) -> bool {
        loop {
            let Some(message) = self.read() else { return false };
            if message["method"] == "session/cancel" {
                return true;
            }
            if message["method"] == "session/prompt" {
                self.append_receipt("prompts", &message["params"].to_string());
            }
        }
    }

    /// 보낸 권한 요청 `request`가 어떻게 끝났나를 기다린다. 그 사이 온 다른 메시지는 건너뛴다. 상대가 사라지면 `None`이다 —
    /// 답할 곳이 없다.
    ///
    /// 멈추면(`session/cancel`) 진짜 codex-acp처럼 **걸린 요청의 답을 기다리지 않는다**(실측 G2) — 뒤에 온 답은 `responses`
    /// 영수증에 남는다. 고르지 않은 답(`outcome: cancelled`)도 멈춘 것과 같다.
    fn await_answer(&mut self, request: &Value) -> Option<Answer> {
        loop {
            let message = self.read()?;
            if message["method"] == "session/cancel" {
                return Some(Answer::Cancelled);
            }
            if message.get("method").is_some() || message["id"] != *request {
                continue;
            }
            let outcome = &message["result"]["outcome"];
            if outcome["outcome"] != "selected" {
                return Some(Answer::Cancelled);
            }
            return Some(Answer::Selected(outcome["optionId"].as_str().unwrap_or_default().to_owned()));
        }
    }

    /// 에이전트 쪽에서 요청 하나를 보내고 그 id를 돌려준다. 답은 `read`가 받아 `responses` 영수증에 남긴다.
    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = json!(self.requests);
        self.requests += 1;
        self.wire.send(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        id
    }

    /// 명령 목록을 보낸다 — 그것을 보내는 시나리오에서만. 모양은 실측(`codex-acp-2.2.2-plan-mode.jsonl` 5줄)의 몇 개다.
    fn send_commands(&mut self, session_id: &str) {
        if !self.commands {
            return;
        }
        self.update(
            session_id,
            json!({"sessionUpdate": "available_commands_update", "availableCommands": [
                {"name": "plan", "description": "Turn plan mode on.", "input": null},
                {"name": "mcp", "description": "Show the status of the MCP servers, or reconnect them.",
                 "input": {"hint": "[reconnect]"}},
                {"name": "review", "description": "Review uncommitted changes, or review with custom instructions.",
                 "input": {"hint": "optional review instructions"}},
                {"name": "compact", "description": "Summarize conversation to avoid hitting the context limit.", "input": null},
                {"name": "$probe-skill", "description": "Probe skill the fake agent lists.", "input": null}
            ]}),
        );
    }

    /// 검사가 그 세션의 턴을 놓을 때까지(`<세션 id>.go`가 설 때까지) 붙잡는다. 영수증 폴더가 없으면 붙잡지 않는다.
    fn hold_until_released(&self, session_id: &str) {
        if let Some(go) = self.receipts.as_ref().map(|dir| dir.join(format!("{session_id}.go"))) {
            receipts::wait_for(&go, receipts::GATE_LIMIT);
        }
    }

    /// 로그인돼 있나 — 로그인 파일을 보지 않는 시나리오는 늘 됐다.
    fn logged_in(&self) -> bool {
        !self.needs_auth || std::env::var_os("FAKE_CODEX_AUTH").is_some_and(|path| PathBuf::from(path).exists())
    }

    /// stdin이 닫힐 때까지 요청에 답한다. 닫히면 그것을 영수증에 적고 돌아온다.
    fn converse(&mut self) {
        while let Some(message) = self.read() {
            // 메서드가 없으면 가짜가 보낸 요청의 답이다 — `read`가 영수증에 남겼다.
            if message.get("method").is_none() {
                continue;
            }
            // id가 없으면 알림이다. 알림에는 답하지 않는다.
            let Some(id) = message.get("id").cloned() else { continue };
            match message["method"].as_str().unwrap_or_default() {
                "initialize" => {
                    self.append_shared("launches", &json!({"pid": std::process::id()}).to_string());
                    self.initialize = message["params"].clone();
                    let version = self.version.clone();
                    self.wire.reply(
                        &id,
                        json!({
                            "protocolVersion": 1,
                            "agentInfo": {"name": "atelier-fake-acp-agent", "title": "Fake ACP agent", "version": version},
                            "agentCapabilities": {
                                "loadSession": self.loads,
                                "promptCapabilities": {"image": false, "audio": false, "embeddedContext": false},
                                "sessionCapabilities": if self.resumes { json!({"resume": {}}) } else { json!({}) }
                            }
                        }),
                    );
                    if !self.logged_in() {
                        // 미로그인은 initialize의 답 바로 뒤에 알린다(실측 noauth 2 · 3줄).
                        self.wire.notify(
                            "_auth/status_update",
                            json!({"authStatus": {"kind": "none", "label": "Not logged in"}}),
                        );
                    }
                }
                "session/new" if !self.logged_in() => {
                    self.wire.reply_error(&id, -32000, "Authentication required");
                }
                "session/new" => {
                    // 프로세스마다 다른 id — 검사는 `agents.json`의 에이전트 쪽 세션 id로 영수증을 찾는다.
                    let session_id = format!("fake-{}", std::process::id());
                    self.leave_receipt(&session_id, &message["params"]);
                    self.session_id = Some(session_id.clone());
                    let params = &message["params"];
                    self.spec_dir = params["additionalDirectories"][0]
                        .as_str()
                        .or_else(|| params["cwd"].as_str())
                        .map(PathBuf::from);
                    if let Ok(email) = std::env::var("FAKE_ACP_ACCOUNT_EMAIL") {
                        self.wire.notify(
                            "_auth/status_update",
                            json!({"authStatus": {"kind": "account", "label": "ChatGPT Plus",
                                                  "account": {"email": email, "plan": "plus"}}}),
                        );
                    }
                    // 명령 목록(`available_commands_update`)은 답 뒤에 보낸다 — 진짜 codex-acp가 그렇다(실측 turns 6줄).
                    // 그 시나리오는 `commands` · `plan-mode`(티켓 09)가 든다.
                    let opened =
                        if self.codex_lists { codex_session_opened(&session_id) } else { session_opened(&session_id) };
                    self.wire.reply(&id, opened);
                    self.send_commands(&session_id);
                    let after: usize =
                        std::env::var("FAKE_ACP_UPDATES_AFTER_OPEN").ok().and_then(|n| n.parse().ok()).unwrap_or(0);
                    for _ in 0..after {
                        self.update(
                            &session_id,
                            json!({"sessionUpdate": "available_commands_update", "availableCommands": []}),
                        );
                    }
                }
                "session/prompt" => {
                    self.prompts += 1;
                    self.append_receipt("prompts", &message["params"].to_string());
                    if let Ok(lines) = std::env::var("FAKE_ACP_STDERR") {
                        for line in lines.split('|') {
                            eprintln!("{line}");
                        }
                    }
                    let session_id = message["params"]["sessionId"].as_str().unwrap_or_default().to_owned();
                    self.prompt = message["params"].clone();
                    let on_prompt = self.on_prompt;
                    on_prompt(self, &id, &session_id);
                    // 진짜 codex-acp는 턴마다 답 뒤에 명령 목록을 다시 보낸다(실측 plan-mode 46줄).
                    self.send_commands(&session_id);
                }
                // 모드 · 설정 바꾸기 — 알림 없이 `{}`로 답한다(three-axes 결정 27). 진짜는 `set_config_option`에
                // `{configOptions}`로 답하지만 호스트는 그 답을 쓰지 않는다 — 값은 호스트가 쥔다.
                method @ "session/resume" if self.resumes => self.revive(&id, method, &message["params"]),
                method @ "session/load" if self.loads => self.revive(&id, method, &message["params"]),
                method @ ("session/set_mode" | "session/set_config_option") if self.codex_lists => {
                    let line = json!({"method": method, "params": message["params"]});
                    self.append_receipt("config", &line.to_string());
                    self.wire.reply(&id, json!({}));
                }
                unknown => {
                    let text = format!("method not found: {unknown}");
                    self.wire.reply_error(&id, -32601, &text);
                }
            }
        }
        self.note("stdin-eof");
    }

    /// 되살리기 하나(`session/resume` · `session/load`, three-axes 티켓 10). 모르는 세션이면 오류로 답한다 — 그러면 호스트는 다음
    /// 단계로 간다. 아는 세션이면 그 세션 id로 이어 가고, 답에는 id 없이 모드 · 모델 · configOptions만 싣는다(실측 그대로) —
    /// 앞서 무엇을 바꿨든 config 기본값이다(three-axes 결정 27). load는 답 전에 과거를 되감고 답 뒤에 줄 하나를 더 보낸다.
    fn revive(&mut self, id: &Value, method: &str, params: &Value) {
        let session_id = params["sessionId"].as_str().unwrap_or_default().to_owned();
        let known = std::env::var_os("FAKE_ACP_FORGETS").is_none()
            && !session_id.is_empty()
            && self.receipts.as_ref().is_some_and(|dir| dir.join(format!("{session_id}.json")).exists());
        let receipt = json!({"pid": std::process::id(), "method": method, "params": params, "ok": known});
        self.append_shared("revivals", &receipt.to_string());
        if !known {
            // 진짜 codex는 저장소에 없는 스레드를 이 꼴로 거절한다.
            return self.wire.reply_error(id, -32603, &format!("Internal error: no rollout found for thread id {session_id}"));
        }
        self.session_id = Some(session_id.clone());
        self.append_receipt("inbox", method);
        if std::env::var_os("FAKE_ACP_REVIVE_HOLDS").is_some() {
            self.hold_until_released(&session_id);
        }
        self.spec_dir =
            params["additionalDirectories"][0].as_str().or_else(|| params["cwd"].as_str()).map(PathBuf::from);
        let mut opened = if self.codex_lists { codex_session_opened(&session_id) } else { session_opened(&session_id) };
        opened.as_object_mut().expect("답은 객체다").remove("sessionId");
        if method == "session/load" {
            // 과거를 되감는다 — 화면은 앱의 기록으로 그리므로 호스트가 버려야 한다.
            for update in [
                json!({"sessionUpdate": "available_commands_update", "availableCommands": []}),
                json!({"sessionUpdate": "user_message_chunk", "content": {"type": "text", "text": "되감은 사람의 말"}}),
                json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "되감은 답"}}),
            ] {
                self.update(&session_id, update);
            }
            self.wire.reply(id, opened);
            self.update(&session_id, json!({"sessionUpdate": "session_info_update", "title": "되살린 세션"}));
        } else {
            self.wire.reply(id, opened);
            self.send_commands(&session_id);
        }
    }

    /// 다음 메시지. 세션이 열린 뒤에 받은 것이면 그 메서드를 `inbox` 영수증에 더하고, 가짜가 보낸 요청의 답이면 원문을
    /// `responses` 영수증에 더한다.
    fn read(&mut self) -> Option<Value> {
        let message = self.wire.read()?;
        match message["method"].as_str() {
            Some(method) => self.append_receipt("inbox", method),
            None => self.append_receipt("responses", &message.to_string()),
        }
        Some(message)
    }

    /// `session/new`를 받은 때의 영수증 한 장.
    fn leave_receipt(&self, session_id: &str, session_new: &Value) {
        let Some(dir) = &self.receipts else { return };
        let receipt = json!({
            "pid": std::process::id(),
            "sid": receipts::unix_session(),
            "sessionId": session_id,
            "env": receipts::env_map(),
            "initialize": self.initialize,
            "sessionNew": session_new,
            "descendants": self.descendants,
        });
        receipts::write_atomically(&dir.join(format!("{session_id}.json")), &receipt);
    }

    /// `writes-spec`의 단계 하나.
    fn spec_step(&mut self, session_id: &str, step: &Value) {
        let spec = self.spec_dir.clone().expect("세션이 열린 뒤에만 턴이 돈다");
        let path = spec.join(step["path"].as_str().unwrap_or_default());
        let silent = step["silent"].as_bool().unwrap_or(false);
        let text = |key: &str| step[key].as_str().unwrap_or_default().to_owned();
        match step["op"].as_str().unwrap_or_default() {
            "write" => {
                let old = std::fs::read_to_string(&path).ok();
                self.edit(session_id, &path, old, Some(text("text")), silent);
            }
            "replace" => {
                let old = std::fs::read_to_string(&path).expect("고칠 파일이 있다");
                let new = old.replacen(&text("from"), &text("to"), 1);
                self.edit(session_id, &path, Some(old), Some(new), silent);
            }
            "delete" => {
                let old = std::fs::read_to_string(&path).ok();
                self.edit(session_id, &path, old, None, silent);
            }
            "flip" => {
                let mut bytes = std::fs::read(&path).expect("뒤집을 파일이 있다");
                let at = step["at"].as_u64().unwrap_or(0) as usize;
                bytes[at] ^= 0xff;
                std::fs::write(&path, bytes).expect("파일을 쓴다");
            }
            "rewrite" => {
                let bytes = std::fs::read(&path).expect("다시 쓸 파일이 있다");
                std::fs::write(&path, bytes).expect("파일을 쓴다");
            }
            "hold" => {
                let gate = self.receipts.as_ref().expect("문은 영수증 폴더에 선다").join(text("gate"));
                receipts::wait_for(&gate, receipts::GATE_LIMIT);
            }
            unknown => eprintln!("모르는 단계: {unknown}"),
        }
    }

    /// 글 파일 하나를 고친다 — `new`가 없으면 지운다. 조용하지 않으면 진짜 codex-acp처럼 고치기 전에 edit 도구 줄
    /// (diff 내용)을, 고친 뒤에 완료를 보낸다. 새 파일의 모양은 codex-acp 2.2.2 실측(`_meta.kind: "add"`) 그대로이고,
    /// 고침 · 지움은 그것을 본떴다.
    fn edit(&mut self, session_id: &str, path: &std::path::Path, old: Option<String>, new: Option<String>, silent: bool) {
        let call = (!silent).then(|| {
            self.edits += 1;
            let call_id = format!("edit-fake-{}", self.edits);
            let (kind, meta) = match (&old, &new) {
                (None, Some(_)) => ("edit", "add"),
                (Some(_), Some(_)) => ("edit", "update"),
                (_, None) => ("delete", "delete"),
            };
            self.update(
                session_id,
                json!({"sessionUpdate": "tool_call", "toolCallId": call_id, "kind": kind,
                       "title": "Editing files", "status": "in_progress",
                       "content": [{"type": "diff", "oldText": old, "newText": new.clone().unwrap_or_default(),
                                    "path": path, "_meta": {"kind": meta}}]}),
            );
            call_id
        });
        match new {
            Some(text) => {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).expect("폴더를 만든다");
                }
                std::fs::write(path, text).expect("파일을 쓴다");
            }
            None => std::fs::remove_file(path).expect("파일을 지운다"),
        }
        if let Some(call_id) = call {
            self.update(
                session_id,
                json!({"sessionUpdate": "tool_call_update", "toolCallId": call_id, "status": "completed"}),
            );
        }
    }

    /// 세션이 열린 뒤에 일어난 일 한 줄.
    fn note(&self, event: &str) {
        self.append_receipt("events", event);
    }

    /// 세션과 상관없는 영수증 `<what>`에 한 줄을 더한다 — 뜬 것(`launches`)과 되살리기(`revivals`)처럼 세션 id를 알기 전이나
    /// 모르는 세션의 일이다.
    fn append_shared(&self, what: &str, line: &str) {
        let Some(dir) = &self.receipts else { return };
        receipts::append_line(&dir.join(what), line);
    }

    /// 그 세션의 `<세션 id>.<what>` 영수증에 한 줄을 더한다.
    fn append_receipt(&self, what: &str, line: &str) {
        let (Some(dir), Some(session_id)) = (&self.receipts, &self.session_id) else { return };
        receipts::append_line(&dir.join(format!("{session_id}.{what}")), line);
    }
}

/// `session/new`의 답 — codex-acp 2.2.2 모양을 작게 줄였다(모드 · 모델 · configOptions).
fn session_opened(session_id: &str) -> Value {
    json!({
        "sessionId": session_id,
        "models": {
            "availableModels": [{"modelId": "fake-model", "name": "Fake model"}],
            "currentModelId": "fake-model"
        },
        "modes": {
            "availableModes": [{"id": "agent", "name": "Auto review"}],
            "currentModeId": "agent"
        },
        "configOptions": [
            {"id": "model", "name": "Model", "type": "select", "currentValue": "fake-model",
             "options": [{"value": "fake-model", "name": "Fake model"}]}
        ]
    })
}

/// `session/new`의 답 — codex-acp 2.2.2 모양(실측 `codex-acp-2.2.2-session-new-codex0.160.1.json`). 모드 넷은 그대로이고,
/// 모델 목록과 생각 깊이는 앞의 몇 개로 줄였다. **이 모양이 곧 검사 자료(S26)의 열림 줄이다** — 바꾸면
/// `tests/records/codex-plan.jsonl`을 다시 지어야 한다.
fn codex_session_opened(session_id: &str) -> Value {
    json!({
        "sessionId": session_id,
        "models": {
            "availableModels": [
                {"modelId": "gpt-6.1-sol[low]", "name": "6.1 Sol (low)",
                 "description": "Latest workhorse model for coding and everyday work. Fast responses with lighter reasoning"},
                {"modelId": "gpt-6-astra[low]", "name": "6 Astra (low)",
                 "description": "Frontier intelligence for the most demanding work. Fast responses with lighter reasoning"}
            ],
            "currentModelId": "gpt-6.1-sol[low]"
        },
        "modes": {
            "availableModes": [
                {"id": "read-only", "name": "Read-only", "description": "Requires approval to edit files and access the internet."},
                {"id": "workspace-write", "name": "Workspace access",
                 "description": "Edit workspace files; ask before writing outside the workspace or accessing the network."},
                {"id": "agent", "name": "Auto review", "description": "Only ask for actions detected as potentially unsafe"},
                {"id": "agent-full-access", "name": "Full access",
                 "description": "Unrestricted access to the internet and any file on your computer"}
            ],
            "currentModeId": "agent"
        },
        "configOptions": [
            {"id": "mode", "name": "Mode", "description": "Approval and sandboxing preset for the session", "category": "mode",
             "type": "select", "currentValue": "agent", "options": [
                {"value": "read-only", "name": "Read-only", "description": "Requires approval to edit files and access the internet."},
                {"value": "workspace-write", "name": "Workspace access",
                 "description": "Edit workspace files; ask before writing outside the workspace or accessing the network."},
                {"value": "agent", "name": "Auto review", "description": "Only ask for actions detected as potentially unsafe"},
                {"value": "agent-full-access", "name": "Full access",
                 "description": "Unrestricted access to the internet and any file on your computer"}]},
            {"id": "collaboration_mode", "name": "Collaboration mode", "description": "How Codex collaborates for subsequent turns",
             "category": "collaboration_mode", "type": "select", "currentValue": "default", "options": [
                {"value": "default", "name": "Default"},
                {"value": "plan", "name": "Plan", "description": "Plan before making changes"}]},
            {"id": "model", "name": "Model", "description": "Model Codex uses for the session", "category": "model",
             "type": "select", "currentValue": "gpt-6.1-sol", "options": [
                {"value": "gpt-6.1-sol", "name": "6.1 Sol", "description": "Latest workhorse model for coding and everyday work."},
                {"value": "gpt-6-astra", "name": "6 Astra", "description": "Frontier intelligence for the most demanding work."}]},
            {"id": "reasoning_effort", "name": "Reasoning effort", "description": "How much reasoning effort the model should use",
             "category": "thought_level", "type": "select", "currentValue": "low", "options": [
                {"value": "low", "name": "Low", "description": "Fast responses with lighter reasoning"},
                {"value": "medium", "name": "Medium", "description": "Balances speed and reasoning depth for everyday tasks"},
                {"value": "high", "name": "High", "description": "Greater reasoning depth for complex problems"}]},
            {"id": "fast-mode", "name": "Fast mode", "description": "1.5x speed, increased usage", "category": "model_config",
             "type": "select", "currentValue": "off", "options": [
                {"value": "off", "name": "Off", "description": "Default speed, normal usage"},
                {"value": "on", "name": "On", "description": "1.5x speed, increased usage"}]}
        ]
    })
}

/// 줄 단위 JSON-RPC 배관. 한 줄에 메시지 하나.
struct Wire {
    input: std::io::StdinLock<'static>,
    output: std::io::Stdout,
}

impl Wire {
    fn stdio() -> Self {
        Self { input: std::io::stdin().lock(), output: std::io::stdout() }
    }

    /// 다음 메시지. 상대가 stdin을 닫으면 `None`.
    fn read(&mut self) -> Option<Value> {
        let mut line = String::new();
        loop {
            line.clear();
            if self.input.read_line(&mut line).ok()? == 0 {
                return None;
            }
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str(&line) {
                Ok(message) => return Some(message),
                Err(error) => eprintln!("읽을 수 없는 줄을 건너뛴다: {error}"),
            }
        }
    }

    fn send(&mut self, message: &Value) {
        // 상대가 이미 떠났으면 쓰기가 실패한다. 가짜는 그 자리에서 할 일이 없다.
        let _ = writeln!(self.output, "{message}");
        let _ = self.output.flush();
    }

    fn notify(&mut self, method: &str, params: Value) {
        self.send(&json!({"jsonrpc": "2.0", "method": method, "params": params}));
    }

    fn reply(&mut self, id: &Value, result: Value) {
        self.send(&json!({"jsonrpc": "2.0", "id": id, "result": result}));
    }

    fn reply_error(&mut self, id: &Value, code: i32, message: &str) {
        self.send(&json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}));
    }
}
