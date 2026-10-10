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
//!
//! 영수증은 `session/new`를 받을 때 `<세션 id>.json` 한 장으로 남는다 — pid · 자기 Unix 세션 id(`getsid(0)`) ·
//! 받은 env · `initialize`와 `session/new`의 인자 · 낳은 후손의 pid. 그 뒤에 일어난 일(stdin EOF)은
//! `<세션 id>.events`에 한 줄씩 더한다.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Map, Value};

/// 시나리오 하나가 대화 전체를 스스로 몬다.
type Scenario = fn(&mut Fake);

/// 시나리오를 고르는 표. 더할 때는 **여기 한 줄과 함수 하나**를 더한다.
const SCENARIOS: &[(&str, Scenario)] = &[
    ("normal", normal),
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
                    // 진짜 codex-acp는 세션을 열자마자 명령 목록을 보낸다 — 응답보다 먼저.
                    self.wire.notify(
                        "session/update",
                        json!({"sessionId": session_id,
                               "update": {"sessionUpdate": "available_commands_update", "availableCommands": []}}),
                    );
                    self.wire.reply(&id, session_opened(&session_id));
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
        let (Some(dir), Some(session_id)) = (&self.receipts, &self.session_id) else { return };
        let Ok(mut file) =
            std::fs::OpenOptions::new().create(true).append(true).open(dir.join(format!("{session_id}.events")))
        else {
            return;
        };
        let _ = writeln!(file, "{event}");
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
