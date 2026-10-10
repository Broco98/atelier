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
//! - `FAKE_ACP_ACCOUNT_EMAIL` — 있으면 `session/new`의 답 앞에 그 이메일이 든 `_auth/status_update`를 보낸다
//!   (진짜 codex-acp가 로그인된 계정을 알리는 모양 — 실측 turns 4줄).
//!
//! 영수증은 `session/new`를 받을 때 `<세션 id>.json` 한 장으로 남는다 — pid · 자기 Unix 세션 id(`getsid(0)`) ·
//! 받은 env · `initialize`와 `session/new`의 인자 · 낳은 후손의 pid. 그 뒤에 일어난 일(stdin EOF)은
//! `<세션 id>.events`에 한 줄씩, 받은 `session/prompt`의 인자는 `<세션 id>.prompts`에 한 줄씩 더한다.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Map, Value};

/// 시나리오 하나가 대화 전체를 스스로 몬다.
type Scenario = fn(&mut Fake);

/// 프롬프트 하나를 어떻게 상대하는가 — `(가짜, 요청 id, 세션 id)`. 시나리오들은 대개 여기서만 갈린다.
type OnPrompt = fn(&mut Fake, &Value, &str);

/// 시나리오를 고르는 표. 더할 때는 **여기 한 줄과 함수 하나**를 더한다.
const SCENARIOS: &[(&str, Scenario)] = &[
    ("normal", normal),
    ("refuses-prompt", refuses_prompt),
    ("long-turn", long_turn),
    ("dies-mid-turn", dies_mid_turn),
    ("ignores-shutdown", ignores_shutdown),
    ("spawns-a-child", spawns_a_child),
];

fn main() {
    let name = std::env::var("FAKE_ACP_SCENARIO").unwrap_or_else(|_| "normal".to_string());
    let Some(&(_, scenario)) = SCENARIOS.iter().find(|(key, _)| *key == name) else {
        let known: Vec<&str> = SCENARIOS.iter().map(|(key, _)| *key).collect();
        eprintln!("모르는 시나리오: {name} (있는 것: {})", known.join(", "));
        std::process::exit(2);
    };
    scenario(&mut Fake::new());
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
fn dies_mid_turn(fake: &mut Fake) {
    fake.on_prompt = |fake, _id, session_id| {
        fake.wire.notify(
            "session/update",
            json!({"sessionId": session_id,
                   "update": {"sessionUpdate": "agent_message_chunk",
                              "content": {"type": "text", "text": "시작한다…"}}}),
        );
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
/// (8월 가짜 그대로). 멈추기는 티켓 07이 세우고, 그 전에는 턴이 도는 동안의 일을 재는 데 쓴다.
fn long_turn(fake: &mut Fake) {
    fake.on_prompt = |fake, id, session_id| {
        fake.wire.notify(
            "session/update",
            json!({"sessionId": session_id,
                   "update": {"sessionUpdate": "agent_message_chunk",
                              "content": {"type": "text", "text": "한참 걸리는 일을 시작한다…"}}}),
        );
        loop {
            // cancel도 없이 상대가 사라지면 답할 곳이 없다.
            let Some(message) = fake.wire.read() else { return };
            if message["method"] == "session/cancel" {
                break;
            }
            if message["method"] == "session/prompt" {
                fake.append_receipt("prompts", &message["params"].to_string());
            }
        }
        fake.wire.reply(id, json!({"stopReason": "cancelled"}));
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
        fake.wire.notify("session/update", json!({"sessionId": session_id, "update": update}));
    }
    fake.wire.reply(
        id,
        json!({"stopReason": "end_turn",
               "usage": {"totalTokens": 1400, "inputTokens": 1200, "outputTokens": 200}}),
    );
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

/// 가짜 하나의 상태 — 선과, 영수증에 실을 것들.
struct Fake {
    wire: Wire,
    receipts: Option<PathBuf>,
    version: String,
    initialize: Value,
    descendants: Vec<u32>,
    session_id: Option<String>,
    on_prompt: OnPrompt,
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
        }
    }

    /// stdin이 닫힐 때까지 요청에 답한다. 닫히면 그것을 영수증에 적고 돌아온다.
    fn converse(&mut self) {
        while let Some(message) = self.wire.read() {
            // id가 없으면 알림이다. 알림에는 답하지 않는다.
            let Some(id) = message.get("id").cloned() else { continue };
            match message["method"].as_str().unwrap_or_default() {
                "initialize" => {
                    self.initialize = message["params"].clone();
                    let version = self.version.clone();
                    self.wire.reply(
                        &id,
                        json!({
                            "protocolVersion": 1,
                            "agentInfo": {"name": "atelier-fake-acp-agent", "title": "Fake ACP agent", "version": version},
                            "agentCapabilities": {
                                "loadSession": false,
                                "promptCapabilities": {"image": false, "audio": false, "embeddedContext": false}
                            }
                        }),
                    );
                }
                "session/new" => {
                    // 프로세스마다 다른 id — 검사는 `agents.json`의 에이전트 쪽 세션 id로 영수증을 찾는다.
                    let session_id = format!("fake-{}", std::process::id());
                    self.leave_receipt(&session_id, &message["params"]);
                    self.session_id = Some(session_id.clone());
                    if let Ok(email) = std::env::var("FAKE_ACP_ACCOUNT_EMAIL") {
                        self.wire.notify(
                            "_auth/status_update",
                            json!({"authStatus": {"kind": "account", "label": "ChatGPT Plus",
                                                  "account": {"email": email, "plan": "plus"}}}),
                        );
                    }
                    // 명령 목록(`available_commands_update`)은 보내지 않는다 — 진짜 codex-acp는 응답 뒤에 보내고
                    // (실측 turns 6줄), 그 시나리오는 `commands`(티켓 09)가 든다.
                    self.wire.reply(&id, session_opened(&session_id));
                    let after: usize =
                        std::env::var("FAKE_ACP_UPDATES_AFTER_OPEN").ok().and_then(|n| n.parse().ok()).unwrap_or(0);
                    for _ in 0..after {
                        self.wire.notify(
                            "session/update",
                            json!({"sessionId": session_id,
                                   "update": {"sessionUpdate": "available_commands_update", "availableCommands": []}}),
                        );
                    }
                }
                "session/prompt" => {
                    self.append_receipt("prompts", &message["params"].to_string());
                    if let Ok(lines) = std::env::var("FAKE_ACP_STDERR") {
                        for line in lines.split('|') {
                            eprintln!("{line}");
                        }
                    }
                    let session_id = message["params"]["sessionId"].as_str().unwrap_or_default().to_owned();
                    let on_prompt = self.on_prompt;
                    on_prompt(self, &id, &session_id);
                }
                unknown => {
                    let text = format!("method not found: {unknown}");
                    self.wire.reply_error(&id, -32601, &text);
                }
            }
        }
        self.note("stdin-eof");
    }

    /// `session/new`를 받은 때의 영수증 한 장.
    fn leave_receipt(&self, session_id: &str, session_new: &Value) {
        let Some(dir) = &self.receipts else { return };
        let env: BTreeMap<String, String> = std::env::vars_os()
            .map(|(name, value)| (name.to_string_lossy().into_owned(), value.to_string_lossy().into_owned()))
            .collect();
        // SAFETY: getsid(0)은 인자 없이 자기 세션 id를 돌려줄 뿐이다.
        let sid = unsafe { libc::getsid(0) };
        let mut receipt = Map::new();
        receipt.insert("pid".into(), json!(std::process::id()));
        receipt.insert("sid".into(), json!(sid));
        receipt.insert("sessionId".into(), json!(session_id));
        receipt.insert("env".into(), json!(env));
        receipt.insert("initialize".into(), self.initialize.clone());
        receipt.insert("sessionNew".into(), session_new.clone());
        receipt.insert("descendants".into(), json!(self.descendants));
        // 반쯤 쓴 영수증을 검사가 읽지 않게 tmp에 쓰고 옮긴다.
        let tmp = dir.join(format!(".{session_id}.json.tmp"));
        let _ = std::fs::write(&tmp, Value::Object(receipt).to_string());
        let _ = std::fs::rename(&tmp, dir.join(format!("{session_id}.json")));
    }

    /// 세션이 열린 뒤에 일어난 일 한 줄.
    fn note(&self, event: &str) {
        self.append_receipt("events", event);
    }

    /// 그 세션의 `<세션 id>.<what>` 영수증에 한 줄을 더한다.
    fn append_receipt(&self, what: &str, line: &str) {
        let (Some(dir), Some(session_id)) = (&self.receipts, &self.session_id) else { return };
        let Ok(mut file) =
            std::fs::OpenOptions::new().create(true).append(true).open(dir.join(format!("{session_id}.{what}")))
        else {
            return;
        };
        let _ = writeln!(file, "{line}");
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
