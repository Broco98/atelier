//! 검사가 진짜 `claude` 대신 상대하는 가짜 claude. 검사는 이것을 임시 PATH에 `claude`라는 이름의 링크로 둔다.
//!
//! - `auth status` · `auth login` — 로그인 확인과 로그인 명령의 흉내(three-axes 티켓 12). 몸은 `src/fakes/login.rs`이고
//!   가짜 `codex`와 함께 쓴다 — 로그인 상태 파일 · 문 · 영수증의 약속은 그 파일 머리에 있다.
//! - `-p …` — 판 02가 잰 **2.1.296**의 stream-json 원문을 되감는다(three-axes 티켓 13). 셸 스크립트로는 제어 메시지에
//!   답하기 버거워 Rust bin으로 짰다(워크플로 티켓 07). 아래는 이 갈래의 약속이다.
//!
//! 변환기가 `claude -p …`로 띄우고, env는 변환기가 받은 것(호스트가 준 로그인 env) 그대로라 시나리오와 영수증 자리는 가짜
//! 로그인 셸이 찍는 env로 받는다.
//!
//! - `FAKE_CLAUDE_SCENARIO` — 시나리오 이름(없으면 `normal`).
//! - `FAKE_CLAUDE_RECEIPTS` — 영수증 폴더. 세션 cwd에 떨어뜨리지 않는다 — cwd는 spec 폴더이거나 워크트리다.
//! - `FAKE_CLAUDE_ACCOUNT_EMAIL` — 있으면 `initialize` 응답의 `account.email`에 이 이메일을 싣는다. 실측 원문은 이미
//!   가려져 있어(`<redacted>`), 가리기를 재려면 진짜 같은 이메일이 실려 와야 한다.
//! - `FAKE_CLAUDE_FIXTURE` — 턴을 되감을 원문(`<CLI 판>/<이름>`, 없으면 `2.1.296/slash-skill-noreplay`). 고를 수 있는 것은
//!   [`FIXTURES`]다.
//! - `FAKE_CLAUDE_SUGGESTIONS` — 있으면 내는 `can_use_tool`마다 `permission_suggestions`를 이 JSON으로 바꾼다. 세션 제안이 없는
//!   요청 · 설정 파일에 쓰는 제안(`localSettings` · `userSettings`, 워크플로 관문 G1의 모양)이 섞인 요청을 만든다.
//!
//! 되감는 원문은 `tests/fixtures/claude-<판>/`의 것이다 — 진짜 claude가 그 순서로 냈다.
//! - 띄우자마자: 첫 `system/init` 앞의 줄들(SessionStart 훅의 `hook_started` · `hook_response`).
//! - stdin `control_request{subtype:"initialize"}` → `initialize.json`(2.1.296)의 응답(요청 id만 바꿔 끼운다). 원문에 든
//!   `control_response`(잰 쪽이 보낸 제어 요청의 답)는 되감지 않는다 — 제어 요청에는 가짜가 스스로 답한다.
//! - stdin user 줄 하나 → 원문의 다음 턴 하나(`system/init` … `result`). 줄의 `session_id`는 받은 `--session-id`로 바꿔
//!   낸다 — 진짜 claude는 띄울 때 받은 세션 id를 싣는다.
//! - **권한**(three-axes 티켓 15) — 턴의 `control_request{subtype:"can_use_tool"}`(워크플로 실측 2.1.282 `permission-stdio`,
//!   판 02 G1)를 내면 그 요청 id의 stdin `control_response`가 올 때까지 턴을 멈춘다. 답이 deny면 뒤따르는 그 도구의 실패
//!   `tool_result`에 받은 글을 싣는다 — 진짜 claude가 deny의 `message`를 도구 결과로 모델에게 준다. 모르는 요청 id의 답(거둔
//!   요청에 늦게 온 답)은 버린다 — 진짜 claude도 무시한다(워크플로 관문 G1).
//! - **멈추기**(티켓 15) — 녹화에서 interrupt의 답(`control_response{still_queued}`, 워크플로 실측 2.1.282 `interrupt-sigint`)이
//!   있던 자리에서 턴을 멈추고 stdin `control_request{subtype:"interrupt"}`를 기다린다. 오면 그 요청 id로 답하고 녹화의 나머지
//!   (`task_notification` · 실패 `tool_result` · `result/error_during_execution`)를 낸다. 권한 요청이 걸린 채 interrupt가 오면
//!   `control_cancel_request`로 그 요청을 거두고 interrupt에 답한 뒤, 녹화된 interrupt의 실패 `tool_result` · `result`를 그 도구
//!   id로 바꿔 낸다(워크플로 관문 G2 (c)의 모양 — 원문 파일은 없다).
//! - **모델 · 모드 바꾸기**(티켓 15) — stdin `set_model` · `set_permission_mode`에는 판 02 실측 2.1.296 `set-model` ·
//!   `set-permission-mode`에서 같은 값에 claude가 낸 답을 되감는다(모드는 뒤따른 `system/status`까지). 녹화에 없는 모델은
//!   success, 녹화에 없는 모드는 녹화된 `invalid_mode` 오류다.
//!
//! 영수증은 띄울 때 `<세션 id>.json` 한 장으로 남는다 — pid · 부모 pid · 프로세스 그룹 · Unix 세션 · 받은 인자 · cwd · env ·
//! 낳은 후손. 받은 stdin 줄은 `<세션 id>.stdin`에, 그 뒤에 일어난 일(stdin EOF · 받은 시그널)은 `<세션 id>.events`에
//! 한 줄씩 더한다. 세션 id는 받은 `--session-id`(없으면 `claude-<pid>`)다.

use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicI32, Ordering};

use serde_json::{json, Value};

#[path = "../fakes/login.rs"]
#[allow(dead_code)] // 두 가짜가 함께 쓰는 모듈이라 저쪽 엔진의 몫은 여기서 안 쓴다.
mod login;

/// 판 02 실측 2.1.296 — stdin `control_request initialize`의 응답 원문(가린 사본).
const INITIALIZE: &str = include_str!("../../tests/fixtures/claude-2.1.296/initialize.json");
/// 턴을 되감을 원문들(가린 사본) — `FAKE_CLAUDE_FIXTURE`의 이름 → 원문. 이름에 CLI 판을 적는다.
/// - `2.1.296/slash-skill-noreplay` — 슬래시 명령 · 스킬 다섯 턴. 모델이 `Skill`을 부르면 `isSynthetic` user 글이 낀다(판 02 실측 A4).
/// - `2.1.296/slash-skill-replay` — 같은 꼴을 `--replay-user-messages`로 잰 넷. 내장 `/context` · `/cost`의 `<synthetic>` 답이 든다.
/// - `2.1.296/edit-subagent` — `Read` · `Edit`의 한 턴과 서브에이전트(`Agent`)의 한 턴(티켓 14가 잰 것).
/// - `2.1.296/g1-plan-implement` — 계획 모드의 한 턴: `ExitPlanMode`의 `can_use_tool` → 허락 → `system/status{default}` → 구현의
///   `Write`가 묻는 `can_use_tool` → 허락(판 02 관문 G1).
/// - `2.1.296/g1-plan-revise` — 같은 물음을 거부(다시 짜기)한 턴과, 고칠 점을 받아 다시 물은 계획을 허락한 턴(판 02 관문 G1).
/// - `2.1.282/twoturn-tools` — 답만 하는 한 턴과 `Write` · `Read` · `Bash`의 한 턴(워크플로 실측 G3).
/// - `2.1.282/permission-stdio` — 작업 자리 밖 `Write`가 묻는 `can_use_tool`을 허락한 턴과 거부한 턴(워크플로 관문 G1).
/// - `2.1.282/interrupt-sigint` — 오래 도는 `Bash`를 interrupt로 멈춘 턴 · 맥락을 이어 답한 턴 · SIGINT로 끝난 턴(워크플로
///   관문 G2).
const FIXTURES: &[(&str, &str)] = &[
    ("2.1.296/slash-skill-noreplay", include_str!("../../tests/fixtures/claude-2.1.296/slash-skill-noreplay.jsonl")),
    ("2.1.296/slash-skill-replay", include_str!("../../tests/fixtures/claude-2.1.296/slash-skill-replay.jsonl")),
    ("2.1.296/edit-subagent", include_str!("../../tests/fixtures/claude-2.1.296/edit-subagent.jsonl")),
    ("2.1.296/g1-plan-implement", include_str!("../../tests/fixtures/claude-2.1.296/g1-plan-implement.jsonl")),
    ("2.1.296/g1-plan-revise", include_str!("../../tests/fixtures/claude-2.1.296/g1-plan-revise.jsonl")),
    ("2.1.282/twoturn-tools", include_str!("../../tests/fixtures/claude-2.1.282/twoturn-tools.jsonl")),
    ("2.1.282/permission-stdio", include_str!("../../tests/fixtures/claude-2.1.282/permission-stdio.jsonl")),
    ("2.1.282/interrupt-sigint", include_str!("../../tests/fixtures/claude-2.1.282/interrupt-sigint.jsonl")),
];
/// 판 02 실측 2.1.296 — `set_model`(값 넷)과 그 답들. 넣은 줄과 낸 줄을 요청 id로 짝짓는다.
const SET_MODEL: (&str, &str) = (
    include_str!("../../tests/fixtures/claude-2.1.296/set-model.stdin.jsonl"),
    include_str!("../../tests/fixtures/claude-2.1.296/set-model.jsonl"),
);
/// 판 02 실측 2.1.296 — `set_permission_mode`(값 아홉)와 그 답 · 뒤따른 `system/status`.
const SET_PERMISSION_MODE: (&str, &str) = (
    include_str!("../../tests/fixtures/claude-2.1.296/set-permission-mode.stdin.jsonl"),
    include_str!("../../tests/fixtures/claude-2.1.296/set-permission-mode.jsonl"),
);
/// 워크플로 실측 2.1.282 — interrupt로 멈춘 턴. 권한이 걸린 채 멈춘 턴의 실패 `tool_result` · `result`를 여기서 빌린다.
const INTERRUPT: &str = include_str!("../../tests/fixtures/claude-2.1.282/interrupt-sigint.jsonl");

/// 시나리오.
/// - `normal` — 원문대로 답한다. stdin EOF면 끝난다(진짜 claude처럼).
/// - `silent-initialize` — `initialize`에 답하지 않는다(G5 한도를 잰다). 다른 것도 답하지 않고, stdin EOF면 끝난다.
/// - `mcp-child` — `normal`에 더해 띄우자마자 오래 사는 자식 하나(stdio MCP 서버 자리)를 낳는다. stdin EOF면 그 자식을
///   끄고 끝난다 — 진짜 claude가 MCP 서버를 거두고 끝나는 꼴이다.
const SCENARIOS: &[&str] = &["normal", "silent-initialize", "mcp-child"];

/// 시그널 처리기가 쓸 `events` 영수증의 fd. 처리기 안에서는 async-signal-safe한 `write`와 `_exit`만 부른다.
static EVENTS_FD: AtomicI32 = AtomicI32::new(-1);

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("auth") {
        std::process::exit(login::claude_auth(&args[1..]));
    }
    let scenario = std::env::var("FAKE_CLAUDE_SCENARIO").unwrap_or_else(|_| "normal".to_string());
    if !SCENARIOS.contains(&scenario.as_str()) {
        eprintln!("모르는 시나리오: {scenario} (있는 것: {})", SCENARIOS.join(", "));
        std::process::exit(2);
    }
    let fixture = std::env::var("FAKE_CLAUDE_FIXTURE").unwrap_or_else(|_| "2.1.296/slash-skill-noreplay".to_string());
    let Some(&(_, recorded)) = FIXTURES.iter().find(|(name, _)| *name == fixture) else {
        let names: Vec<&str> = FIXTURES.iter().map(|(name, _)| *name).collect();
        eprintln!("모르는 원문: {fixture} (있는 것: {})", names.join(", "));
        std::process::exit(2);
    };
    let suggestions = std::env::var("FAKE_CLAUDE_SUGGESTIONS")
        .ok()
        .map(|text| serde_json::from_str::<Value>(&text).expect("FAKE_CLAUDE_SUGGESTIONS는 JSON이다"));
    let session_id = flag_value(&args, "--session-id").unwrap_or_else(|| format!("claude-{}", std::process::id()));
    let receipts = std::env::var_os("FAKE_CLAUDE_RECEIPTS").map(PathBuf::from);
    let fake = Fake { receipts, session_id };
    fake.watch_signals();

    let mut child = (scenario == "mcp-child").then(spawn_mcp_child);
    fake.leave_receipt(&args, child.as_ref().map(Child::id));

    let (startup, turns) = fixture_turns(recorded);
    for step in &startup {
        if let Step::Line(line) = step {
            fake.emit(line);
        }
    }
    let mut turns = turns.into_iter();
    let mut replay = Replay { fake: &fake, suggestions, steps: VecDeque::new(), waiting: None, denied: None };
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        fake.append("stdin", &line);
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            // 진짜 claude는 깨진 줄 하나에 exit 1로 끝난다(워크플로 함정 4).
            eprintln!("Error: 읽을 수 없는 줄");
            std::process::exit(1);
        };
        if scenario == "silent-initialize" {
            continue;
        }
        let request_id = &message["request_id"];
        match (message["type"].as_str(), message["request"]["subtype"].as_str()) {
            (Some("control_request"), Some("initialize")) => emit(&initialize_response(request_id)),
            (Some("control_request"), Some("interrupt")) => replay.interrupt(request_id),
            (Some("control_request"), Some("set_model")) => {
                emit(&set_model_response(&message["request"], request_id));
            }
            (Some("control_request"), Some("set_permission_mode")) => {
                for line in set_permission_mode_response(&message["request"], request_id) {
                    fake.emit(&line);
                }
            }
            (Some("control_request"), subtype) => emit(&json!({
                "type": "control_response",
                "response": {"subtype": "error", "request_id": request_id,
                             "error": format!("가짜 claude가 모르는 제어 요청: {}", subtype.unwrap_or("?"))},
            })),
            (Some("control_response"), _) => replay.answered(&message["response"]),
            (Some("user"), _) => replay.start(turns.next().unwrap_or_default()),
            _ => {}
        }
    }
    fake.append("events", "stdin-eof");
    if let Some(child) = child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// `--flag 값`의 값.
fn flag_value(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|arg| arg == flag).and_then(|at| args.get(at + 1)).cloned()
}

/// 되감을 원문의 한 걸음.
enum Step {
    /// 낼 줄.
    Line(Value),
    /// 녹화에서 interrupt의 답이 있던 자리 — 여기서 멈추고 stdin interrupt를 기다린다.
    AwaitInterrupt,
}

/// 원문을 띄우자마자 낼 줄들과 턴들로 가른다 — 턴은 `system/init`에서 시작해 `result`에서 끝난다. 첫 `init` 앞의 줄은
/// 띄우자마자 내고, `result`와 다음 `init` 사이의 줄은 앞 턴에 붙인다. 원문의 `control_response`는 뺀다 — 잰 쪽이 보낸
/// 제어 요청의 답이라, 가짜는 받은 제어 요청에 스스로 답한다. 다만 interrupt의 답(`still_queued`)은 그 자리에 멈춤을 남긴다.
fn fixture_turns(text: &str) -> (Vec<Step>, Vec<Vec<Step>>) {
    let mut startup = Vec::new();
    let mut turns: Vec<Vec<Step>> = Vec::new();
    let mut open = false;
    for value in json_lines(text) {
        let step = match value["type"].as_str() {
            Some("control_response") if value["response"]["response"].get("still_queued").is_some() => Step::AwaitInterrupt,
            Some("control_response") => continue,
            _ => Step::Line(value.clone()),
        };
        let is_init = value["type"] == "system" && value["subtype"] == "init";
        if is_init && !open {
            turns.push(Vec::new());
            open = true;
        }
        let ends_turn = value["type"] == "result";
        match turns.last_mut() {
            Some(turn) => turn.push(step),
            None => startup.push(step),
        }
        if ends_turn {
            open = false;
        }
    }
    (startup, turns)
}

fn json_lines(text: &str) -> impl Iterator<Item = Value> + '_ {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).expect("가짜 claude의 원문은 JSON 줄이다"))
}

/// 도는 턴 하나의 되감기 — 남은 걸음과, 멈춰 기다리는 것.
struct Replay<'a> {
    fake: &'a Fake,
    /// 내는 `can_use_tool`의 `permission_suggestions`를 바꿀 값(`FAKE_CLAUDE_SUGGESTIONS`).
    suggestions: Option<Value>,
    steps: VecDeque<Step>,
    waiting: Option<Waiting>,
    /// 방금 deny로 답한 도구 — (도구 id, 받은 글). 뒤따르는 그 도구의 실패 결과에 그 글을 싣는다.
    denied: Option<(Value, Value)>,
}

/// 턴이 멈춰 기다리는 것.
enum Waiting {
    /// 녹화에서 interrupt를 보낸 자리.
    Interrupt,
    /// 낸 권한 요청의 답 — 요청 id와 그 도구 id.
    Permission { request_id: Value, tool_use_id: Value },
}

impl Replay<'_> {
    /// user 줄 하나 — 원문의 다음 턴을 낸다.
    fn start(&mut self, turn: Vec<Step>) {
        self.steps = turn.into();
        self.waiting = None;
        self.run();
    }

    /// 남은 걸음을 멈출 자리까지 낸다.
    fn run(&mut self) {
        while let Some(step) = self.steps.pop_front() {
            match step {
                Step::AwaitInterrupt => {
                    self.waiting = Some(Waiting::Interrupt);
                    return;
                }
                Step::Line(mut line) => {
                    if line["type"] == "control_request" && line["request"]["subtype"] == "can_use_tool" {
                        if let Some(suggestions) = &self.suggestions {
                            line["request"]["permission_suggestions"] = suggestions.clone();
                        }
                        self.fake.emit(&line);
                        let request_id = line["request_id"].clone();
                        let tool_use_id = line["request"]["tool_use_id"].clone();
                        self.waiting = Some(Waiting::Permission { request_id, tool_use_id });
                        return;
                    }
                    self.carry_denial(&mut line);
                    self.fake.emit(&line);
                }
            }
        }
    }

    /// deny로 답한 도구의 실패 결과에 받은 글을 싣는다 — 진짜 claude는 deny의 `message`를 그 도구의 결과로 모델에게 준다.
    fn carry_denial(&mut self, line: &mut Value) {
        let Some((tool_use_id, message)) = self.denied.take() else { return };
        let mut carried = false;
        for block in line["message"]["content"].as_array_mut().into_iter().flatten() {
            if block["type"] == "tool_result" && block["tool_use_id"] == tool_use_id && block["is_error"] == true {
                block["content"] = message.clone();
                carried = true;
            }
        }
        if !carried {
            self.denied = Some((tool_use_id, message));
        }
    }

    /// stdin `control_response` — 걸린 권한 요청의 답이면 턴을 잇는다. 모르는 요청의 답(거둔 요청에 늦게 온 답)은 버린다.
    fn answered(&mut self, response: &Value) {
        let Some(Waiting::Permission { request_id, tool_use_id }) = &self.waiting else { return };
        if response["request_id"] != *request_id {
            return;
        }
        let decision = &response["response"];
        if decision["behavior"] == "deny" {
            self.denied = Some((tool_use_id.clone(), decision["message"].clone()));
        }
        self.waiting = None;
        self.run();
    }

    /// stdin interrupt.
    fn interrupt(&mut self, request_id: &Value) {
        let answer = json!({"type": "control_response",
                            "response": {"subtype": "success", "request_id": request_id, "response": {"still_queued": []}}});
        match self.waiting.take() {
            Some(Waiting::Interrupt) => {
                emit(&answer);
                self.run();
            }
            Some(Waiting::Permission { request_id: asked, tool_use_id }) => {
                // 워크플로 관문 G2 (c) — 걸린 요청을 거두고, 그 도구가 실패하고, 턴이 aborted_tools로 끝난다.
                emit(&json!({"type": "control_cancel_request", "request_id": asked}));
                emit(&answer);
                for mut line in interrupted_tail() {
                    for block in line["message"]["content"].as_array_mut().into_iter().flatten() {
                        block["tool_use_id"] = tool_use_id.clone();
                    }
                    self.fake.emit(&line);
                }
                self.steps.clear();
            }
            // 도는 턴이 없다 — 답만 한다.
            None => emit(&answer),
        }
    }
}

/// 녹화된 interrupt 턴의 끝 — 그 도구의 실패 `tool_result`와 `result/error_during_execution`.
fn interrupted_tail() -> Vec<Value> {
    let lines: Vec<Value> = json_lines(INTERRUPT).collect();
    let failed = lines
        .iter()
        .find(|line| line["message"]["content"][0]["is_error"] == true)
        .expect("interrupt 원문에 실패한 tool_result가 있다");
    let result = lines.iter().find(|line| line["type"] == "result").expect("interrupt 원문에 result가 있다");
    vec![failed.clone(), result.clone()]
}

/// 녹화의 제어 요청과 그 답들 — 넣은 줄의 요청 id로 짝짓는다. (요청, 답, 답 바로 뒤의 줄)
fn recorded_controls((stdin, stdout): (&str, &str)) -> Vec<(Value, Value, Option<Value>)> {
    let requests: Vec<Value> = json_lines(stdin).filter(|line| line["type"] == "control_request").collect();
    let lines: Vec<Value> = json_lines(stdout).collect();
    lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line["type"] == "control_response")
        .filter_map(|(at, line)| {
            let request = requests.iter().find(|request| request["request_id"] == line["response"]["request_id"])?;
            Some((request["request"].clone(), line.clone(), lines.get(at + 1).cloned()))
        })
        .collect()
}

/// 답에 받은 요청 id를 끼운다.
fn with_request_id(mut response: Value, request_id: &Value) -> Value {
    response["response"]["request_id"] = request_id.clone();
    response
}

/// `set_model`의 답 — 녹화에서 같은 값(값 없음 포함)을 받았을 때의 답. 녹화에 없는 값은 success다.
fn set_model_response(request: &Value, request_id: &Value) -> Value {
    recorded_controls(SET_MODEL)
        .into_iter()
        .find(|(recorded, _, _)| recorded["subtype"] == "set_model" && recorded.get("model") == request.get("model"))
        .map(|(_, response, _)| with_request_id(response, request_id))
        .unwrap_or_else(|| json!({"type": "control_response", "response": {"subtype": "success", "request_id": request_id}}))
}

/// `set_permission_mode`의 답 — 녹화에서 같은 모드를 받았을 때의 답과, 성공이면 뒤따른 `system/status`. 녹화에 없는 모드는
/// 녹화된 `invalid_mode` 오류다.
fn set_permission_mode_response(request: &Value, request_id: &Value) -> Vec<Value> {
    let recorded = recorded_controls(SET_PERMISSION_MODE);
    let same = recorded.iter().find(|(asked, _, _)| asked["subtype"] == "set_permission_mode" && asked["mode"] == request["mode"]);
    let invalid = || {
        recorded
            .iter()
            .find(|(_, response, _)| response["response"]["error_code"] == "invalid_mode")
            .expect("녹화에 invalid_mode 답이 있다")
    };
    let (_, response, next) = same.unwrap_or_else(invalid);
    let mut lines = vec![with_request_id(response.clone(), request_id)];
    if let Some(status) = next.as_ref().filter(|next| next["type"] == "system" && next["subtype"] == "status") {
        if response["response"]["subtype"] == "success" {
            lines.push(status.clone());
        }
    }
    lines
}

/// `initialize`의 답 — 원문의 응답에 받은 요청 id를 끼운다. 이메일을 받았으면 계정 칸에 싣는다.
fn initialize_response(request_id: &Value) -> Value {
    let recorded: Value = serde_json::from_str(INITIALIZE).expect("initialize 원문은 JSON이다");
    let mut response = recorded["response"].clone();
    response["request_id"] = request_id.clone();
    if let Ok(email) = std::env::var("FAKE_CLAUDE_ACCOUNT_EMAIL") {
        response["response"]["account"]["email"] = json!(email);
        response["response"]["account"]["organization"] = json!(format!("{email}'s Organization"));
    }
    json!({"type": "control_response", "response": response})
}

/// stdio MCP 서버 자리의 오래 사는 자식. stdout을 따로 문다 — stream-json 선에 섞이면 안 된다.
fn spawn_mcp_child() -> Child {
    Command::new("sleep")
        .arg("600")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("MCP 자리의 자식을 낳지 못했다")
}

fn emit(line: &Value) {
    let mut out = std::io::stdout().lock();
    // 상대가 떠났으면 쓰기가 실패한다. 가짜는 그 자리에서 할 일이 없다.
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

struct Fake {
    receipts: Option<PathBuf>,
    session_id: String,
}

impl Fake {
    /// 원문 한 줄을 낸다 — 줄의 `session_id`를 이 세션의 것으로 바꿔서.
    fn emit(&self, line: &Value) {
        let mut line = line.clone();
        if line.get("session_id").is_some_and(Value::is_string) {
            line["session_id"] = json!(self.session_id);
        }
        emit(&line);
    }

    fn path(&self, what: &str) -> Option<PathBuf> {
        self.receipts.as_ref().map(|dir| dir.join(format!("{}.{what}", self.session_id)))
    }

    /// 띄운 때의 영수증 한 장.
    fn leave_receipt(&self, args: &[String], child: Option<u32>) {
        let (Some(dir), Some(path)) = (&self.receipts, self.path("json")) else { return };
        let env: BTreeMap<String, String> = std::env::vars_os()
            .map(|(name, value)| (name.to_string_lossy().into_owned(), value.to_string_lossy().into_owned()))
            .collect();
        // SAFETY: 인자 없이 자기 번호들을 돌려줄 뿐이다.
        let (ppid, pgid, sid) = unsafe { (libc::getppid(), libc::getpgid(0), libc::getsid(0)) };
        let receipt = json!({
            "pid": std::process::id(),
            "ppid": ppid,
            "pgid": pgid,
            "sid": sid,
            "args": args,
            "cwd": std::env::current_dir().ok(),
            "env": env,
            "descendants": child.into_iter().collect::<Vec<_>>(),
        });
        // 반쯤 쓴 영수증을 검사가 읽지 않게 tmp에 쓰고 옮긴다.
        let tmp = dir.join(format!(".{}.json.tmp", self.session_id));
        let _ = std::fs::write(&tmp, receipt.to_string());
        let _ = std::fs::rename(&tmp, path);
    }

    fn append(&self, what: &str, line: &str) {
        let Some(path) = self.path(what) else { return };
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    }

    /// SIGINT · SIGTERM · SIGHUP을 받으면 `events`에 적고 끝난다 — 진짜 claude도 SIGINT에 끝난다(워크플로 함정 5).
    /// SIGKILL은 받을 수 없으니 적히지 않는다.
    fn watch_signals(&self) {
        let Some(path) = self.path("events") else { return };
        let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(path) else { return };
        EVENTS_FD.store(std::os::unix::io::IntoRawFd::into_raw_fd(file), Ordering::SeqCst);
        // SAFETY: 처리기는 async-signal-safe한 write와 _exit만 부른다.
        unsafe {
            for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGHUP] {
                libc::signal(signal, on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t);
            }
        }
    }
}

extern "C" fn on_signal(signal: libc::c_int) {
    let line: &[u8] = match signal {
        libc::SIGINT => b"signal SIGINT\n",
        libc::SIGTERM => b"signal SIGTERM\n",
        _ => b"signal SIGHUP\n",
    };
    let fd = EVENTS_FD.load(Ordering::SeqCst);
    // SAFETY: write와 _exit는 async-signal-safe다. fd는 처리기를 걸기 전에 열어 두었다.
    unsafe {
        if fd >= 0 {
            libc::write(fd, line.as_ptr().cast(), line.len());
        }
        libc::_exit(128 + signal);
    }
}
