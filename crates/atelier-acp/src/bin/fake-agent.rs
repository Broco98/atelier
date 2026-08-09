//! 테스트가 실물 대신 상대하는 가짜 ACP 에이전트.
//!
//! 프로토콜 크레이트의 에이전트 쪽 트레이트를 쓰지 않고 표준입출력 위 **줄 단위 JSON-RPC
//! 응답기로 손수 짰다.** 크레이트가 양쪽에 있으면 테스트가 실패했을 때 클라이언트가 틀렸는지
//! 우리가 트레이트를 잘못 구현했는지 다시 구분할 수 없게 된다.
//!
//! 프레임 골격은 상상한 것이 아니라 실물 `codex-acp` 0.16.0에서 떠 온 것이다
//! (`spec/01-걷는-뼈대/explanation/02-실물-스파이크.md`). 광고하는 능력은 실물보다 좁다 —
//! 이 판이 다루는 메서드가 쓰지 않는 필드는 흉내내지 않는다.
//!
//! ```bash
//! fake-agent normal
//! ```

use std::io::{BufRead, Write};

use serde_json::{json, Value};

/// 시나리오 하나가 대화 전체를 스스로 몬다.
///
/// 요청 하나에 응답 하나를 돌려주는 좁은 자리로 두면 권한 요청(에이전트가 먼저 묻는다)이나
/// 긴 턴(당장 답하지 않는다)을 더할 때 이 자리의 모양부터 고쳐야 하고, 그러면 멀쩡한
/// 시나리오들이 함께 끌려온다.
type Scenario = fn(&mut Wire);

/// 프롬프트 하나를 어떻게 상대하는가 — `(선, 요청 id, 세션 id, 사람이 친 말)`.
/// 지금까지의 시나리오들은 여기서만 갈린다.
type OnPrompt = fn(&mut Wire, &Value, &Value, &Value);

/// 시나리오를 고르는 표. 더할 때는 **여기 한 줄과 함수 하나**를 더한다.
const SCENARIOS: &[(&str, Scenario)] = &[("normal", normal), ("refuses-prompt", refuses_prompt)];

fn main() {
    let name = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "normal".to_string());

    let Some(&(_, scenario)) = SCENARIOS.iter().find(|(key, _)| *key == name) else {
        let known: Vec<&str> = SCENARIOS.iter().map(|(key, _)| *key).collect();
        eprintln!("모르는 시나리오: {name} (있는 것: {})", known.join(", "));
        std::process::exit(2);
    };

    scenario(&mut Wire::stdio());
}

/// 무엇을 물어도 정상으로 답하는 에이전트. 뒤 티켓들이 더할 어긋난 시나리오들의 기준선이다.
///
/// 프롬프트·중단처럼 **정상 동작**이 더 필요해지면 그것을 요구하는 티켓이 이 함수를 넓힌다.
/// 새 시나리오는 그렇지 않다 — 어긋난 상대는 언제나 표에 함수를 더하는 쪽이다.
fn normal(wire: &mut Wire) {
    converse(wire, stream_a_turn);
}

/// 세션은 정상으로 열리지만 프롬프트에는 오류로 답한다.
///
/// 지어낸 모양이 아니다. 실물에서 낡은 어댑터가 모델 API의 400을 이 자리로 그대로 돌려줬다
/// (`spec/01-걷는-뼈대/explanation/05-실물-한-턴.md`).
fn refuses_prompt(wire: &mut Wire) {
    converse(wire, |wire, id, _session, _said| {
        wire.reply_error(id, -32603, "Internal error: model unavailable");
    });
}

/// 세션을 여는 데까지의 대화. 시나리오들이 공유한다 — 갈리는 곳은 프롬프트 하나다.
fn converse(wire: &mut Wire, on_prompt: OnPrompt) {
    let mut opened = 0u32;
    let mut client_capabilities = Value::Null;

    while let Some(message) = wire.read() {
        // id가 없으면 알림이다. 알림에는 답하지 않는다.
        let Some(id) = message.get("id").cloned() else {
            continue;
        };

        match message["method"].as_str().unwrap_or_default() {
            "initialize" => {
                client_capabilities = message["params"]["clientCapabilities"].clone();
                wire.reply(
                    &id,
                    json!({
                        "protocolVersion": 1,
                        "agentCapabilities": {
                            // 실물은 true라고 말하지만 이 시나리오는 session/load를 구현하지
                            // 않는다. 하지 않는 것을 한다고 광고하지 않는다 — 불러오기를 다루는
                            // 시나리오는 그것을 필요로 하는 티켓이 따로 더한다.
                            "loadSession": false,
                            "promptCapabilities": {
                                "image": false,
                                "audio": false,
                                "embeddedContext": false
                            }
                        },
                        "agentInfo": {"name": "atelier-fake-agent", "version": "0"}
                    }),
                );
            }
            "session/new" => {
                opened += 1;
                // 프로세스마다 다른 id여야 한다 — 한 프로젝트로 두 번 시작한 세션이
                // 서로 구분되는지를 뒤 티켓이 검사한다.
                let session_id = format!("fake-{}-{opened}", std::process::id());
                // 진짜 에이전트가 하는 일 중 이 판이 검사해야 하는 것 하나 — 자기가 받은
                // 디렉터리에서 실제로 움직인다. 영수증을 그 자리에 남기면 "화면이 보여주는
                // 디렉터리"와 "에이전트가 받은 디렉터리"가 같은지를 밖에서 확인할 수 있다.
                leave_receipt(&message["params"]["cwd"], &client_capabilities);
                // 실물 Codex는 세션을 열자마자 쓸 수 있는 명령 목록을 보낸다 — **답보다 먼저**.
                // 즉 클라이언트가 세션 id를 알기도 전에 오는 말이 있다. 여기서 흉내내지 않으면
                // 그 틈이 테스트 밖으로 빠진다.
                wire.notify(
                    "session/update",
                    json!({"sessionId": session_id,
                           "update": {"sessionUpdate": "available_commands_update",
                                      "availableCommands": []}}),
                );
                wire.reply(&id, json!({"sessionId": session_id}));
            }
            "session/prompt" => {
                let session_id = message["params"]["sessionId"].clone();
                let said = message["params"]["prompt"][0]["text"].clone();
                on_prompt(wire, &id, &session_id, &said);
            }
            unknown => {
                let message = format!("method not found: {unknown}");
                wire.reply_error(&id, -32601, &message);
            }
        }
    }
}

/// 한 턴이 흘러가는 모양. **이 순서가 곧 테스트가 검사하는 것**이므로 여기를 바꾸면
/// 기록의 순서를 보는 테스트가 함께 움직인다.
fn stream_a_turn(wire: &mut Wire, id: &Value, session_id: &Value, said: &Value) {
    for update in [
        json!({"sessionUpdate": "agent_message_chunk",
               "content": {"type": "text", "text": "받았다: "}}),
        json!({"sessionUpdate": "tool_call", "toolCallId": "call-1",
               "title": "echo", "kind": "execute", "status": "pending"}),
        json!({"sessionUpdate": "agent_message_chunk",
               "content": {"type": "text", "text": said}}),
        // 실물도 보낸다 — 와도 화면이 흔들리지 않고 기록에만 남는지를 이 판이 검사한다.
        json!({"sessionUpdate": "usage_update", "used": 12, "size": 200000}),
    ] {
        wire.notify(
            "session/update",
            json!({"sessionId": session_id, "update": update}),
        );
    }
    wire.reply(id, json!({"stopReason": "end_turn"}));
}

/// 영수증 파일 이름. 실행 파일이라 테스트가 이 상수를 가져다 쓸 수 없으므로 저쪽에도 같은
/// 문자열이 적혀 있다.
const RECEIPT: &str = ".atelier-fake-agent.json";

/// 세션 디렉터리에 받은 것을 적어 둔다. 테스트는 이 파일 하나로 두 가지를 본다 —
/// 세션이 열린 디렉터리가 어디인가, 그리고 클라이언트가 어떤 능력을 선언했는가(확정 결정 10).
///
/// 실패해도 조용히 넘어간다. 이건 응답이 아니라 곁다리이고, 여기서 죽으면 정작 검사하려던
/// 프로토콜 쪽이 "왜 실패했는지 모르는" 상태가 된다.
fn leave_receipt(cwd: &Value, client_capabilities: &Value) {
    let Some(dir) = cwd.as_str() else { return };
    let receipt = json!({"cwd": cwd, "clientCapabilities": client_capabilities});
    let _ = std::fs::write(std::path::Path::new(dir).join(RECEIPT), receipt.to_string());
}

/// 시나리오들이 공유하는 배관. 한 줄에 JSON-RPC 메시지 하나.
struct Wire {
    input: std::io::StdinLock<'static>,
    output: std::io::Stdout,
}

impl Wire {
    fn stdio() -> Self {
        Self {
            input: std::io::stdin().lock(),
            output: std::io::stdout(),
        }
    }

    /// 다음 메시지. 상대가 스트림을 닫으면 `None`.
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
                // 누구에게 답해야 할지 모르는 줄이므로 흘려보낸다.
                Err(error) => eprintln!("읽을 수 없는 줄을 건너뛴다: {error}"),
            }
        }
    }

    fn send(&mut self, message: &Value) {
        writeln!(self.output, "{message}").expect("stdout에 쓰지 못했다");
        self.output.flush().expect("stdout을 비우지 못했다");
    }

    /// 답을 기대하지 않고 먼저 거는 말.
    fn notify(&mut self, method: &str, params: Value) {
        self.send(&json!({"jsonrpc": "2.0", "method": method, "params": params}));
    }

    fn reply(&mut self, id: &Value, result: Value) {
        self.send(&json!({"jsonrpc": "2.0", "id": id, "result": result}));
    }

    fn reply_error(&mut self, id: &Value, code: i32, message: &str) {
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {"code": code, "message": message}
        }));
    }
}
