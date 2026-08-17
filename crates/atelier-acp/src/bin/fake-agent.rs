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

/// 불러오기를 어떻게 상대하는가 — `(선, 요청 id, 불러오라고 받은 세션 id)`.
///
/// 사람이 친 말이 없는 것이 프롬프트와 다른 점이다. 불러오기는 지시가 아니라 **되감기**다.
type OnLoad = fn(&mut Wire, &Value, &Value);

/// 시나리오를 고르는 표. 더할 때는 **여기 한 줄과 함수 하나**를 더한다.
const SCENARIOS: &[(&str, Scenario)] = &[
    ("normal", normal),
    ("refuses-prompt", refuses_prompt),
    ("asks-permission", asks_permission),
    ("long-turn", long_turn),
    ("dies-mid-turn", dies_mid_turn),
    ("ignores-shutdown", ignores_shutdown),
    ("spawns-a-child", spawns_a_child),
    ("replays-on-load", replays_on_load),
];

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

/// 도구를 쓰기 전에 사람에게 묻는 에이전트. **묻고, 답을 받고, 그 답에 따라 갈린다.**
///
/// 허용이든 거부든 턴은 정상으로 끝난다 — 거부는 실패가 아니라 다른 길이다. 그래서 이 한
/// 시나리오로 허용·거부 두 경우를 다 몰 수 있다. 어느 쪽인지는 **답하는 쪽**이 정한다.
fn asks_permission(wire: &mut Wire) {
    converse(wire, |wire, id, session_id, _said| {
        // 쓰려는 도구를 **먼저 알린다.** 이름과 입력은 여기 실린다.
        wire.notify(
            "session/update",
            json!({"sessionId": session_id,
                   "update": {"sessionUpdate": "tool_call", "toolCallId": "call-1",
                              "title": "echo hi", "kind": "execute", "status": "pending",
                              "rawInput": {"command": "echo hi"}}}),
        );
        // 그리고 묻는다. 물음이 실어 오는 `toolCall`은 **갱신**이라 방금 보낸 자리가 비어
        // 있다 — 실물 Codex가 그렇게 보낸다. 화면은 같은 번호로 앞의 것을 찾아 메워야 한다.
        let asked = json!({
            "sessionId": session_id,
            "toolCall": {"toolCallId": "call-1", "kind": "execute", "status": "pending"},
            "options": [
                {"optionId": "yes", "name": "이번만 허용", "kind": "allow_once"},
                {"optionId": "no", "name": "거부", "kind": "reject_once"}
            ]
        });
        // 답을 받지 못하면 이 턴은 여기서 끝난다 — 상대가 사라진 것이므로 답할 곳도 없다.
        let Some(answer) = wire.ask("session/request_permission", asked) else {
            return;
        };

        // 고른 것이 무엇인지는 우리가 준 선택지 id로 온다. 오류로 답했다면 고른 것이 없고,
        // 없는 것은 허락이 아니다.
        let said = match answer["outcome"]["optionId"].as_str() {
            Some("yes") => "허락받아 echo hi 를 실행했다",
            _ => "허락받지 못해 다른 길로 간다",
        };
        wire.notify(
            "session/update",
            json!({"sessionId": session_id,
                   "update": {"sessionUpdate": "agent_message_chunk",
                              "content": {"type": "text", "text": said}}}),
        );
        wire.reply(id, json!({"stopReason": "end_turn"}));
    });
}

/// 오래 도는 턴. **중단이 올 때까지 답하지 않는다.**
///
/// 잠들어 기다리지 않는 것은 일부러다. 시간으로 재면 느린 기계에서 흔들리고, 무엇보다
/// **중단이 실제로 도착했는지**를 증명하지 못한다 — 여기서는 중단 알림을 읽어서 턴을 끝낸다.
fn long_turn(wire: &mut Wire) {
    converse(wire, |wire, id, session_id, _said| {
        // 턴이 실제로 돌기 시작했다는 표식. 중단은 이것을 본 뒤에 온다.
        wire.notify(
            "session/update",
            json!({"sessionId": session_id,
                   "update": {"sessionUpdate": "agent_message_chunk",
                              "content": {"type": "text", "text": "한참 걸리는 일을 시작한다…"}}}),
        );
        loop {
            // 중단도 없이 상대가 사라지면 이 턴은 여기서 끝난다 — 답할 곳이 없다.
            let Some(message) = wire.read() else { return };
            if message["method"] == "session/cancel" {
                break;
            }
        }
        // ACP는 중단된 턴이 **이 이유로** 끝나기를 요구한다. 실패가 아니라 다른 끝이다.
        wire.reply(id, json!({"stopReason": "cancelled"}));
    });
}

/// 턴 도중에 **스스로 죽는** 에이전트. 답도 오류도 없이 저쪽이 사라진다.
///
/// 상대가 끊은 것이 아니라 저쪽이 없어지는 경우다. 크래시한 실물이 이렇게 보인다.
fn dies_mid_turn(wire: &mut Wire) {
    converse(wire, |_wire, _id, _session_id, _said| std::process::exit(0));
}

/// **종료를 무시하도록 만든** 에이전트. 죽이지 않으면 그대로 남는다.
///
/// 이 스택에서 얌전한 종료 신호는 **표준입력을 닫는 것**이다 — ACP 연결이 그렇게 끝나고,
/// 아틀리에가 SIGTERM을 따로 쏘는 자리는 없다. 그래서 그것을 무시하는 것이 여기서 말하는
/// "신호를 무시한다"이고, 남는 길은 프로세스 그룹째 강제로 죽이는 것 하나뿐이다.
fn ignores_shutdown(wire: &mut Wire) {
    converse(wire, stream_a_turn);
    // 표준입력이 닫혀도 끝내지 않는다.
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}

/// 자기가 또 자식을 낳는 에이전트.
///
/// 실물에서 기본 어댑터 커맨드는 패키지 실행기를 거치므로 자식은 프로세스 하나가 아니라
/// **트리**이고, 게다가 Codex 자신이 셸 도구를 돌린다. 직계만 죽이면 손자가 살아남는데,
/// 그 손자가 정확히 이 판이 막으려는 **정체불명의 프로세스**다.
///
/// 손자의 pid는 커맨드로 받은 자리에 적는다 — 밖에서 그것을 지켜볼 수 있어야 하기 때문이다.
/// 표준입출력은 물려준 채로 둔다. 패키지 실행기 뒤의 진짜 에이전트가 바로 그 모양이다.
fn spawns_a_child(wire: &mut Wire) {
    let tell = std::env::args()
        .nth(2)
        .expect("손자의 pid를 적을 자리를 커맨드로 받지 못했다");
    // 거두지 않는 것이 이 시나리오다 — 손자는 부모보다 오래 살아야 한다. 거기까지 죽는지가
    // 검사하려는 것이므로, 여기서 기다리면 검사할 것이 사라진다.
    #[allow(clippy::zombie_processes)]
    let grandchild = std::process::Command::new("sleep")
        .arg("600")
        .spawn()
        .expect("손자를 낳지 못했다");
    std::fs::write(tell, grandchild.id().to_string()).expect("손자의 pid를 적지 못했다");

    converse(wire, stream_a_turn);
}

/// **불러오기를 지원하고, 부르면 지난 대화를 다시 흘려주는** 에이전트.
///
/// ACP에서 `session/load`는 응답보다 **먼저** 지난 대화를 `session/update`로 되돌려 줄 수 있다.
/// 그런데 화면은 그 전에 이미 재생으로 채워져 있으므로, 그 스트림을 그대로 받아 적으면 같은
/// 말이 두 번 나온다. 그것을 버리는지가 이 시나리오로 드러난다.
fn replays_on_load(wire: &mut Wire) {
    converse_loading(wire, stream_a_turn, Some(replay_the_past));
}

/// 되감아 주는 과거. 실물이 무엇을 흘리는지는 아직 모르므로 **이 판이 이미 기록한 것과 같은
/// 모양**으로 흘린다 — 버리지 않으면 기록에 그대로 두 번 쌓인다.
fn replay_the_past(wire: &mut Wire, id: &Value, session_id: &Value) {
    for text in ["받았다: ", "지난번에 하던 이야기"] {
        wire.notify(
            "session/update",
            json!({"sessionId": session_id,
                   "update": {"sessionUpdate": "agent_message_chunk",
                              "content": {"type": "text", "text": text}}}),
        );
    }
    wire.reply(id, json!({}));
}

/// 세션을 여는 데까지의 대화. 시나리오들이 공유한다 — 갈리는 곳은 프롬프트 하나다.
///
/// 불러오기는 **지원하지 않는다고 말하고** 물어 오면 모른다고 답한다. 지원하는 상대가
/// 필요하면 아래 `converse_loading`을 쓴다.
fn converse(wire: &mut Wire, on_prompt: OnPrompt) {
    converse_loading(wire, on_prompt, None);
}

/// `converse`와 같되 불러오기를 상대한다.
///
/// 광고와 구현이 따로 놀지 않도록 능력은 `on_load`가 있는지로 정한다 — 하지 않는 것을 한다고
/// 말하는 상대는 이 판이 흉내낼 어긋남이 아니다.
fn converse_loading(wire: &mut Wire, on_prompt: OnPrompt, on_load: Option<OnLoad>) {
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
                            // 하지 않는 것을 한다고 광고하지 않는다 — 상대할 자리가 있을 때만
                            // 참이다. 대부분의 시나리오는 여기서 거짓이고, 그것이 곧 "불러오기를
                            // 지원하지 않는 에이전트"다.
                            "loadSession": on_load.is_some(),
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
            // 불러오기는 세션을 **새로 열지 않는다** — 부른 쪽이 쥐고 있던 id가 그대로 산다.
            // 그래서 여기서는 세는 수도 늘지 않고 새 id도 나가지 않는다.
            "session/load" => match on_load {
                Some(load) => load(wire, &id, &message["params"]["sessionId"]),
                None => wire.reply_error(&id, -32601, "method not found: session/load"),
            },
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
    /// 이쪽에서 먼저 건 물음의 수. 다음 요청 id가 된다 — 요청 id는 방향마다 따로 센다.
    asked: i64,
}

impl Wire {
    fn stdio() -> Self {
        Self {
            input: std::io::stdin().lock(),
            output: std::io::stdout(),
            asked: 0,
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

    /// **이쪽에서 먼저 묻고** 답을 기다린다. 상대가 답하지 않고 스트림을 닫으면 `None`.
    ///
    /// 기다리는 동안 상대가 거는 말은 흘려보낸다 — 이 판에서 그 자리에 오는 것은 없다.
    /// 오류로 답한 경우 `result`가 없으므로 그대로 널이 나가고, 부르는 쪽이 그것을 읽는다.
    fn ask(&mut self, method: &str, params: Value) -> Option<Value> {
        self.asked += 1;
        let id = json!(self.asked);
        self.send(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        loop {
            let message = self.read()?;
            // 답에는 method가 없다. 그것이 상대의 물음과 상대의 답을 가르는 자리다.
            if message.get("method").is_none() && message["id"] == id {
                return Some(message["result"].clone());
            }
        }
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
