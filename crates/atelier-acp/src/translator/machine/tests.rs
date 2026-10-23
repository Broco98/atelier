//! 변환기 상태 기계의 시험 — 진짜 claude가 낸 녹화(`tests/fixtures/claude-2.1.282` · `claude-2.1.296`)를 프로세스 없이 먹인다.
//!
//! 시험은 호스트 자리에 선다. ACP 메시지를 넣고, 상태 기계가 낸 ACP 줄 · claude stdin 줄 · 띄우기 · 끝을 본다. 상태 기계가
//! 띄우라는 claude는 L1의 가짜 claude bin과 같은 몸(`src/fakes/claude_replay.rs`)이다 — 두 자리가 같은 녹화를 같은 규칙으로
//! 되감는다. 프로세스 끝(띄우기 플래그 · stdin EOF · 죽음 · 프로세스 그룹)과 호스트와 잇는 끝맺음은 L1(`tests/claude_*.rs`)이
//! 잰다.

use std::collections::VecDeque;

use serde_json::{json, Value};

use super::{Input, Launch, Machine, Output};

#[path = "../../fakes/claude_replay.rs"]
#[allow(dead_code)] // 가짜 claude bin과 함께 쓰는 몸이라 이 시험이 쓰지 않는 몫이 있다.
mod claude_replay;

use claude_replay::{Hold, Replay, Setup};

/// 세션을 여는 요청의 `cwd` — 상태 기계는 띄우기에 싣기만 하고 그 자리를 보지 않는다.
const CWD: &str = "/tmp/gate/ws/cart/spec";

/// 시험이 고르는 가짜 claude의 차림 — L1 가짜 claude의 env(`FAKE_CLAUDE_*`)와 같은 손잡이다.
struct Claude {
    /// 되감을 녹화(`<CLI 판>/<이름>`).
    fixture: &'static str,
    /// 내는 `can_use_tool`마다 바꿔 실을 `permission_suggestions`.
    suggestions: Option<Value>,
    hold: Option<Hold>,
    /// `initialize` 답의 계정 칸에 실을 이메일.
    email: Option<&'static str>,
    /// `--resume`한 세션을 모른다 — 되살리지 못하고 끝난다(판 02 관문 G4).
    forgets: bool,
    /// stdin을 읽지 않는다 — `initialize`에도 답하지 않는다.
    silent: bool,
    /// 띄우지 못한다(실행 파일이 없다).
    unlaunchable: bool,
}

impl Claude {
    fn replaying(fixture: &'static str) -> Self {
        Self { fixture, suggestions: None, hold: None, email: None, forgets: false, silent: false, unlaunchable: false }
    }
}

/// 일어난 일 하나 — 일어난 차례대로 쌓인다.
#[derive(Clone, Debug)]
enum Seen {
    /// 시험(호스트)이 넣은 ACP 메시지.
    Host(Value),
    /// 상태 기계가 낸 ACP 줄.
    Acp(Value),
    /// claude의 stdin에 든 줄.
    Stdin(Value),
    Launch(Launch),
    Dismiss,
    Close,
    Stderr(String),
    Exit(i32),
}

/// 호스트 자리에서 상태 기계를 모는 손잡이. 상태 기계가 낸 것을 그 자리에서 한다 — ACP 줄은 쌓고, claude 줄은 떠 있는
/// 되감기에 넣고, 띄우기는 되감기를 새로 차린다. claude가 낸 줄은 받을 차례를 기다렸다가 넣은 차례대로 상태 기계에 든다 —
/// 변환기의 몸통이 claude를 읽는 스레드의 줄을 받는 꼴이다.
struct Bench {
    machine: Machine,
    claude: Claude,
    /// 떠 있는 claude. 끝났거나 거뒀거나 stdin을 닫았으면 `None`이다 — 그때 쓰기는 실패한다.
    replay: Option<Replay>,
    /// 상태 기계에 들 차례를 기다리는 것.
    inbox: VecDeque<Input>,
    seen: Vec<Seen>,
    next_id: u64,
    session_id: String,
}

impl Bench {
    fn new(claude: Claude) -> Self {
        Self {
            machine: Machine::default(),
            claude,
            replay: None,
            inbox: VecDeque::new(),
            seen: Vec::new(),
            next_id: 1,
            session_id: String::new(),
        }
    }

    /// `initialize`(요청 id 1)와 `session/new`(요청 id 2)로 세션을 연다.
    fn open(claude: Claude) -> Self {
        let mut bench = Self::new(claude);
        bench.request("initialize", json!({"protocolVersion": 1}));
        let id = bench.request("session/new", json!({"cwd": CWD, "mcpServers": [], "_meta": {"atelier": {}}}));
        bench.session_id = bench.result(id)["sessionId"].as_str().expect("연 세션 id").to_owned();
        bench
    }

    // ── 호스트가 하는 것 ──────────────────────────────────────────────────────────────

    fn send(&mut self, message: Value) {
        self.send_together(vec![message]);
    }

    /// 여러 메시지를 claude가 답하기 전에 잇달아 넣는다 — 호스트가 한 번에 보낸 꼴.
    fn send_together(&mut self, messages: Vec<Value>) {
        for message in messages {
            self.seen.push(Seen::Host(message.clone()));
            self.inbox.push_back(Input::Acp(message));
        }
        self.run();
    }

    fn request(&mut self, method: &str, params: Value) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        id
    }

    fn prompt(&mut self, text: &str) -> u64 {
        let session = self.session_id.clone();
        self.request("session/prompt", json!({"sessionId": session, "prompt": [{"type": "text", "text": text}]}))
    }

    fn cancel_message(&self) -> Value {
        json!({"jsonrpc": "2.0", "method": "session/cancel", "params": {"sessionId": self.session_id}})
    }

    fn cancel(&mut self) {
        let cancel = self.cancel_message();
        self.send(cancel);
    }

    /// 권한 요청 `id`에 그 선택지로 답한다.
    fn answer(&mut self, id: u64, option: &str) {
        self.send(json!({"jsonrpc": "2.0", "id": id, "result": {"outcome": {"outcome": "selected", "optionId": option}}}));
    }

    fn set_mode(&mut self, mode: &str) -> u64 {
        let session = self.session_id.clone();
        self.request("session/set_mode", json!({"sessionId": session, "modeId": mode}))
    }

    fn set_model(&mut self, model: &str) -> u64 {
        let session = self.session_id.clone();
        self.request("session/set_config_option", json!({"sessionId": session, "configId": "model", "value": model}))
    }

    /// 호스트가 변환기의 stdin을 닫는다.
    fn hang_up(&mut self) {
        self.inbox.push_back(Input::AcpEnded);
        self.run();
    }

    // ── claude 쪽에서 일어나는 것 ─────────────────────────────────────────────────────

    /// 문에서 멈춘 claude를 놓는다.
    fn release(&mut self) {
        let said = self.replay.as_mut().expect("떠 있는 claude").release();
        self.inbox.extend(said.into_iter().map(Input::Claude));
        self.run();
    }

    /// claude가 그 종료 코드로 끝난다.
    fn claude_exits(&mut self, code: i32) {
        self.replay = None;
        self.inbox.push_back(Input::ClaudeEnded { status: format!("exit status: {code}"), code: Some(code) });
        self.run();
    }

    /// claude가 사라졌지만 그 끝을 아직 읽지 못했다 — stdin 쓰기만 실패한다.
    fn claude_vanishes(&mut self) {
        self.replay = None;
    }

    fn run(&mut self) {
        while let Some(input) = self.inbox.pop_front() {
            self.step(input);
        }
    }

    fn step(&mut self, input: Input) {
        let mut outputs: VecDeque<Output> = self.machine.step(input).into();
        while let Some(output) = outputs.pop_front() {
            match output {
                Output::Acp(line) => self.seen.push(Seen::Acp(line)),
                Output::Claude(line) => match self.replay.as_mut() {
                    Some(replay) => {
                        self.seen.push(Seen::Stdin(line.clone()));
                        if !self.claude.silent {
                            let said = replay.receive(&line);
                            self.inbox.extend(said.into_iter().map(Input::Claude));
                        }
                    }
                    None => outputs.extend(self.machine.step(Input::Unwritten(line))),
                },
                Output::Launch(launch) => {
                    self.seen.push(Seen::Launch(launch.clone()));
                    if self.claude.unlaunchable {
                        let error = "No such file or directory (os error 2)".to_owned();
                        outputs.extend(self.machine.step(Input::LaunchFailed(error)));
                    } else {
                        self.launch(&launch);
                    }
                }
                Output::Dismiss => {
                    self.seen.push(Seen::Dismiss);
                    // 거둔 claude의 줄과 끝은 더 들이지 않는다.
                    self.replay = None;
                    self.inbox.retain(|input| !matches!(input, Input::Claude(_) | Input::ClaudeEnded { .. }));
                }
                Output::Close => {
                    self.seen.push(Seen::Close);
                    self.replay = None;
                }
                Output::Stderr(line) => self.seen.push(Seen::Stderr(line)),
                Output::Exit(code) => self.seen.push(Seen::Exit(code)),
            }
        }
    }

    /// 띄우기 하나 — 받은 세션 id로 되감기를 차리고, 띄우자마자 낼 줄들을 받을 차례에 넣는다.
    fn launch(&mut self, launch: &Launch) {
        let resume = flag(&launch.args, "--resume");
        let session_id = flag(&launch.args, "--session-id").or_else(|| resume.clone()).expect("세션 id 플래그");
        if resume.is_some() && self.claude.forgets {
            // 진짜 claude 2.1.296처럼 initialize에 답하지 않고 한 줄을 낸 뒤 끝난다.
            self.replay = None;
            self.inbox.push_back(Input::Claude(claude_replay::forgotten_line(&session_id)));
            self.inbox.push_back(Input::ClaudeEnded { status: "exit status: 1".into(), code: Some(1) });
            return;
        }
        let recorded = claude_replay::fixture(self.claude.fixture).expect("고를 수 있는 녹화");
        let setup = Setup {
            session_id,
            suggestions: self.claude.suggestions.clone(),
            hold: self.claude.hold,
            email: self.claude.email.map(str::to_owned),
        };
        let (replay, startup) = Replay::new(recorded, setup);
        self.replay = Some(replay);
        self.inbox.extend(startup.into_iter().map(Input::Claude));
    }

    // ── 본 것 ───────────────────────────────────────────────────────────────────────

    fn acp(&self) -> Vec<Value> {
        self.seen.iter().filter_map(|seen| if let Seen::Acp(line) = seen { Some(line.clone()) } else { None }).collect()
    }

    fn stdin(&self) -> Vec<Value> {
        self.seen.iter().filter_map(|seen| if let Seen::Stdin(line) = seen { Some(line.clone()) } else { None }).collect()
    }

    fn launches(&self) -> Vec<Launch> {
        self.seen.iter().filter_map(|seen| if let Seen::Launch(launch) = seen { Some(launch.clone()) } else { None }).collect()
    }

    fn count(&self, pick: impl Fn(&Seen) -> bool) -> usize {
        self.seen.iter().filter(|seen| pick(seen)).count()
    }

    fn exits(&self) -> Vec<i32> {
        self.seen.iter().filter_map(|seen| if let Seen::Exit(code) = seen { Some(*code) } else { None }).collect()
    }

    fn stderr(&self) -> Vec<String> {
        self.seen.iter().filter_map(|seen| if let Seen::Stderr(line) = seen { Some(line.clone()) } else { None }).collect()
    }

    /// 그 요청에 낸 답(결과든 오류든). 없으면 터진다.
    fn reply(&self, id: u64) -> Value {
        self.acp().into_iter().find(|line| is_reply_to(line, id)).unwrap_or_else(|| panic!("요청 {id}에 답하지 않았다"))
    }

    fn replied(&self, id: u64) -> bool {
        self.acp().iter().any(|line| is_reply_to(line, id))
    }

    fn result(&self, id: u64) -> Value {
        let reply = self.reply(id);
        reply.get("result").cloned().unwrap_or_else(|| panic!("요청 {id}에 오류로 답했다: {reply}"))
    }

    fn error(&self, id: u64) -> Value {
        let reply = self.reply(id);
        reply.get("error").cloned().unwrap_or_else(|| panic!("요청 {id}에 결과로 답했다: {reply}"))
    }

    /// 낸 `session/update`의 `update` 칸들.
    fn updates(&self) -> Vec<Value> {
        bodies(&self.acp())
    }

    /// 그 `session/prompt`를 넣은 뒤부터 그 답 앞까지 낸 `update` 칸들.
    fn turn_updates(&self, id: u64) -> Vec<Value> {
        let sent = self.at(|seen| matches!(seen, Seen::Host(message) if message["id"] == id && message["method"] == "session/prompt"));
        let answered = self.at(|seen| matches!(seen, Seen::Acp(line) if is_reply_to(line, id)));
        bodies(&self.acp_in(sent..answered))
    }

    /// 그 자리 범위의 ACP 줄들.
    fn acp_in(&self, range: std::ops::Range<usize>) -> Vec<Value> {
        self.seen[range].iter().filter_map(|seen| if let Seen::Acp(line) = seen { Some(line.clone()) } else { None }).collect()
    }

    /// `pick`을 채우는 첫 일의 자리.
    fn at(&self, pick: impl Fn(&Seen) -> bool) -> usize {
        self.seen.iter().position(pick).expect("그런 일이 없었다")
    }

    /// 상태 기계가 호스트에 보낸 권한 요청들.
    fn permission_requests(&self) -> Vec<Value> {
        self.acp().into_iter().filter(|line| line["method"] == "session/request_permission").collect()
    }

    /// claude가 받은 stdin 줄마다 그 꼴 — user 줄은 `user`, 제어 요청은 그 subtype, 제어 답은 `answer`.
    fn stdin_shape(&self) -> Vec<String> {
        self.stdin()
            .iter()
            .map(|line| match line["type"].as_str().unwrap() {
                "control_request" => line["request"]["subtype"].as_str().unwrap().to_owned(),
                "control_response" => "answer".to_owned(),
                other => other.to_owned(),
            })
            .collect()
    }

    /// claude가 받은 제어 답들(`control_response`) — 권한 답이다.
    fn answers(&self) -> Vec<Value> {
        self.stdin().into_iter().filter(|line| line["type"] == "control_response").collect()
    }

    /// claude가 받은 제어 요청들의 `request` 칸 — `initialize`는 뺀다.
    fn controls(&self) -> Vec<Value> {
        self.stdin()
            .into_iter()
            .filter(|line| line["type"] == "control_request" && line["request"]["subtype"] != "initialize")
            .map(|line| line["request"].clone())
            .collect()
    }

    fn user_lines(&self) -> Vec<Value> {
        self.stdin().into_iter().filter(|line| line["type"] == "user").collect()
    }

    /// 낸 줄 전체의 글 — 원문이 새지 않았는지 본다.
    fn text(&self) -> String {
        self.acp().iter().map(Value::to_string).collect()
    }
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.windows(2).find(|pair| pair[0] == name).map(|pair| pair[1].clone())
}

fn is_reply_to(line: &Value, id: u64) -> bool {
    line["id"] == id && line.get("method").is_none()
}

/// ACP 줄들 가운데 `session/update`의 `update` 칸들.
fn bodies(lines: &[Value]) -> Vec<Value> {
    lines.iter().filter(|line| line["method"] == "session/update").map(|line| line["params"]["update"].clone()).collect()
}

/// 그 도구 이름의 `tool_call`과, 그 호출의 `tool_call_update`들.
fn tool_lines(updates: &[Value], tool_name: &str) -> (Value, Vec<Value>) {
    let call = updates
        .iter()
        .find(|update| update["sessionUpdate"] == "tool_call" && update["_meta"]["claudeCode"]["toolName"] == tool_name)
        .unwrap_or_else(|| panic!("{tool_name} 도구 줄이 없다"))
        .clone();
    let after = updates
        .iter()
        .filter(|update| update["sessionUpdate"] == "tool_call_update" && update["toolCallId"] == call["toolCallId"])
        .cloned()
        .collect();
    (call, after)
}

fn has_tool_call(updates: &[Value], tool_name: &str) -> bool {
    updates.iter().any(|update| update["sessionUpdate"] == "tool_call" && update["_meta"]["claudeCode"]["toolName"] == tool_name)
}

/// 답 조각(`agent_message_chunk`)의 글들.
fn answers_of(updates: &[Value]) -> Vec<String> {
    updates
        .iter()
        .filter(|update| update["sessionUpdate"] == "agent_message_chunk")
        .map(|update| update["content"]["text"].as_str().unwrap().to_owned())
        .collect()
}

/// 턴 밖 턴의 표지(`_meta.atelier.outOfTurn`)들 — 낸 차례대로.
fn out_of_turn_marks(updates: &[Value]) -> Vec<Value> {
    updates.iter().map(|update| update["_meta"]["atelier"]["outOfTurn"].clone()).filter(|mark| !mark.is_null()).collect()
}

fn recorded(name: &str) -> Vec<Value> {
    claude_replay::json_lines(claude_replay::fixture(name).expect("녹화")).collect()
}

// ── 열기 ────────────────────────────────────────────────────────────────────────────

/// 판 02 실측 2.1.296의 `initialize` 응답 원문 — 되감기가 답하는 것과 같은 파일이다.
fn recorded_initialize() -> Value {
    let text = include_str!("../../../tests/fixtures/claude-2.1.296/initialize.json");
    serde_json::from_str::<Value>(text).expect("initialize 원문")["response"]["response"].clone()
}

#[test]
fn 세션을_열면_claude를_띄워_initialize를_보내고_그_답으로_모델_목록과_모드_다섯을_답한_뒤_명령_목록을_알린다() {
    let bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));

    let initialized = bench.result(1);
    assert_eq!(
        initialized["agentCapabilities"],
        json!({"loadSession": true, "sessionCapabilities": {"resume": {}}}),
        "되살리기는 load와 resume을 둘 다 광고한다(워크플로 S19)"
    );
    assert_eq!(initialized["agentInfo"]["version"], json!(env!("CARGO_PKG_VERSION")), "변환기의 판은 앱의 판이다");
    let launches = bench.launches();
    assert_eq!(launches.len(), 1);
    assert_eq!(flag(&launches[0].args, "--session-id").as_deref(), Some(bench.session_id.as_str()), "답한 세션 id로 띄웠다");
    assert_eq!(
        bench.stdin(),
        [json!({"type": "control_request", "request_id": "atelier-initialize", "request": {"subtype": "initialize"}})],
        "띄운 직후 stdin initialize 하나를 보낸다(S1)"
    );

    // 모델 — codex-acp와 같은 모양(S1): configOptions의 id `model`, 값은 2.1.296의 `models[].value` 13개 그대로.
    let opened = bench.result(2);
    let model = opened["configOptions"].as_array().unwrap().iter().find(|option| option["id"] == "model").expect("model");
    assert_eq!((model["type"].as_str(), model["currentValue"].as_str()), (Some("select"), Some("default")));
    let values: Vec<&str> = model["options"].as_array().unwrap().iter().map(|o| o["value"].as_str().unwrap()).collect();
    assert_eq!(
        values,
        [
            "default", "opus", "fable", "sonnet", "haiku", "claude-haiku-4-5-20251001", "claude-sonnet-5",
            "claude-opus-5", "claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6",
        ]
    );
    let opus = model["options"].as_array().unwrap().iter().find(|o| o["value"] == "opus").unwrap();
    assert_eq!(opus["name"], "Opus 5.5", "이름은 claude의 displayName이다");

    // 모드 — claude의 이름 그대로 다섯. bypassPermissions는 띄울 때 허락하지 않았으면 고를 수 없어 없다.
    let modes: Vec<&str> = opened["modes"]["availableModes"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert_eq!(modes, ["default", "acceptEdits", "auto", "dontAsk", "plan"]);
    assert_eq!(opened["modes"]["currentModeId"], "auto", "지금 모드는 claude의 current_permission_mode다");
    assert_eq!(opened["_meta"]["claudeCode"]["initialize"]["claude_code_version"], "2.1.296", "claude의 initialize 답 원문이 실린다");

    // 명령 — 이름 · 설명 · 인자 힌트. 별칭은 찾기 말로 `_meta`에 실린다.
    let commands = bench
        .updates()
        .into_iter()
        .find(|update| update["sessionUpdate"] == "available_commands_update")
        .expect("명령 목록")["availableCommands"]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(commands.len(), recorded_initialize()["commands"].as_array().unwrap().len(), "claude의 명령이 다 온다");
    let handoff = commands.iter().find(|c| c["name"] == "claude-handoff").expect("사용자 스킬");
    assert_eq!(
        handoff["description"],
        "Hand the current conversation off to a fresh background agent that picks up the work immediately. (user)"
    );
    assert_eq!(handoff["input"]["hint"], "What will the next session be used for?");
    let ask = commands.iter().find(|c| c["name"] == "ask-matt").unwrap();
    assert!(ask["input"].is_null(), "인자 힌트가 없으면 input은 null이다(codex-acp와 같은 모양)");
    let creator = commands.iter().find(|c| c["name"] == "skill-creator:skill-creator").unwrap();
    assert_eq!(creator["_meta"]["aliases"], json!(["skill-creator"]));

    // 순서 — 열기의 답이 명령 목록보다 앞에 선다(화면은 열림 줄로 칩을 짓고, 그 뒤 메뉴를 채운다).
    let answered = bench.at(|seen| matches!(seen, Seen::Acp(line) if is_reply_to(line, 2)));
    let listed = bench.at(|seen| matches!(seen, Seen::Acp(line) if line["params"]["update"]["sessionUpdate"] == "available_commands_update"));
    assert!(answered < listed);
}

#[test]
fn claude의_계정_이메일_플랜과_플러그인_경로는_가린_채로_나간다() {
    let mut claude = Claude::replaying("2.1.296/slash-skill-noreplay");
    claude.email = Some("dana@example.com");
    let mut bench = Bench::open(claude);
    // 첫 말을 넣으면 claude가 `system/init`을 낸다 — 그 원문(플러그인 경로가 든다)이 세션 정보로 나간다.
    bench.prompt("안녕");

    // `initialize`의 계정 칸(이메일 · 조직 · 플랜)은 `<email>`이다(워크플로 함정 19). 나머지는 원문 그대로다.
    let initialize = &bench.result(2)["_meta"]["claudeCode"]["initialize"];
    let account = initialize["account"].as_object().expect("계정 칸");
    assert!(!account.is_empty() && account.values().all(|value| value == "<email>"), "{account:?}");

    // `system/init`의 `plugins[].path`에는 조직 · 계정 id가 실린다(실측 함정 39).
    let info = bench.updates().into_iter().find(|update| update["sessionUpdate"] == "session_info_update").expect("세션 정보");
    let init = &info["_meta"]["claudeCode"]["init"];
    assert_eq!((init["type"].as_str(), init["subtype"].as_str()), (Some("system"), Some("init")));
    let plugins = init["plugins"].as_array().expect("plugins");
    assert!(!plugins.is_empty() && plugins.iter().all(|plugin| plugin["path"] == "<path>"), "{plugins:?}");
    assert!(plugins.iter().any(|plugin| plugin["name"] == "hookify"), "경로 말고는 원문 그대로다");

    let text = bench.text();
    for secret in ["dana@example.com", "Claude Max", "/.claude/plugins/", "plugins/synced/"] {
        assert!(!text.contains(secret), "`{secret}`가 ACP로 나갔다");
    }
}

/// Agent 정의 스냅숏 파일의 자리 — 상태 기계는 그 경로를 claude에 넘기기만 하고 읽지 않는다.
const INSTRUCTIONS: &str = "/tmp/gate/threads/20261023-090000/agents/host.md";

/// 그 열기 요청 하나로 연 변환기가 claude를 띄운 인자.
fn launched_by(method: &str, params: Value) -> Vec<String> {
    let mut bench = Bench::new(Claude::replaying("2.1.282/twoturn-tools"));
    bench.request("initialize", json!({"protocolVersion": 1}));
    let opened = bench.request(method, params);
    assert!(bench.result(opened).is_object(), "{method}가 열렸다");
    let launches = bench.launches();
    assert_eq!(launches.len(), 1, "{method}");
    launches[0].args.clone()
}

#[test]
fn agent_정의의_지시문_모델_생각_깊이_도구_금지와_mcp_서버는_새로_열기와_이어_열기_모두_claude를_띄우는_인자에_든다() {
    // v1 구현 스펙 §3 — `claude -p --resume`은 이 값들을 되살리지 않으므로 열 때마다 다시 받는다.
    let meta = json!({"atelier": {
        "instructionsFile": INSTRUCTIONS,
        "model": "opus",
        "effort": "high",
        "builtinTools": ["read", "shell"],
        "forbid": ["push"]
    }});
    let servers = json!([{"name": "thread", "command": "atelier", "args": [], "env": []}]);
    let fresh = json!({"cwd": CWD, "mcpServers": servers, "_meta": meta});
    let revive = json!({"sessionId": "yesterday", "cwd": CWD, "mcpServers": servers, "_meta": meta});

    for (method, params) in [("session/new", fresh), ("session/resume", revive.clone()), ("session/load", revive)] {
        let args = launched_by(method, params);
        assert_eq!(
            (
                flag(&args, "--append-system-prompt-file").as_deref(),
                flag(&args, "--model").as_deref(),
                flag(&args, "--effort").as_deref(),
                flag(&args, "--tools"),
                flag(&args, "--disallowedTools").as_deref(),
                flag(&args, "--mcp-config").as_deref(),
            ),
            (
                Some(INSTRUCTIONS),
                Some("opus"),
                Some("high"),
                Some(format!("Read,Glob,Grep,LS,Bash,{RUNTIME_TOOLS}")),
                Some("Bash(git push),Bash(git push *)"),
                Some(r#"{"mcpServers":{"thread":{"type":"stdio","command":"atelier","args":[],"env":{},"timeout":2147483647}}}"#),
            ),
            "{method}: {args:?}"
        );
        assert_eq!(flag(&args, "--allowedTools").as_deref(), Some("mcp__thread"), "{method}: {args:?}");
        if method != "session/new" {
            assert_eq!(flag(&args, "--resume").as_deref(), Some("yesterday"), "{method}");
        }
    }

    // 정의가 비우면 플래그도 없다 — claude의 기본 시스템 프롬프트 · 사용자의 모델 설정 · 기본 도구 전부를 그대로 쓴다.
    let args = launched_by("session/new", json!({"cwd": CWD, "mcpServers": [], "_meta": {"atelier": {}}}));
    for name in ["--append-system-prompt-file", "--model", "--effort", "--tools", "--disallowedTools", "--mcp-config"] {
        assert!(!args.iter().any(|arg| arg == name), "{name}: {args:?}");
    }
}

/// 그 `_meta.atelier`로 새로 연 claude의 인자.
fn launched_with(atelier: Value) -> Vec<String> {
    launched_by("session/new", json!({"cwd": CWD, "mcpServers": [], "_meta": {"atelier": atelier}}))
}

/// Runtime의 반복이 쓰는 도구 — 내장 도구를 골라도 늘 남는다(결정.md 12).
const RUNTIME_TOOLS: &str = "AskUserQuestion,ExitPlanMode,ToolSearch";

#[test]
fn 내장_도구는_추상_도구_표대로_claude_code_도구_이름으로_옮겨_tools로_들고_적지_않으면_기본_도구_전부다() {
    // v1 구현 스펙 §3 「추상 도구」 표.
    let table = [
        (json!(["read"]), "Read,Glob,Grep,LS"),
        (json!(["search"]), "Glob,Grep"),
        (json!(["edit"]), "Edit,Write,NotebookEdit"),
        (json!(["shell"]), "Bash"),
        (json!(["web"]), "WebFetch,WebSearch"),
        // 기본 리뷰어 — 겹치는 도구는 한 번만 든다.
        (json!(["read", "search", "shell"]), "Read,Glob,Grep,LS,Bash"),
    ];
    for (builtin, tools) in table {
        let args = launched_with(json!({"builtinTools": builtin}));
        assert_eq!(flag(&args, "--tools"), Some(format!("{tools},{RUNTIME_TOOLS}")), "{builtin}: {args:?}");
    }

    // 빈 목록은 내장 도구 없음이다 — 능력 도구는 하나도 없고 반복의 도구만 남는다.
    let args = launched_with(json!({"builtinTools": []}));
    assert_eq!(flag(&args, "--tools").as_deref(), Some(RUNTIME_TOOLS), "{args:?}");

    // 적지 않으면 플래그가 없다 — claude의 기본 도구 전부다(Host 기본 파일).
    for atelier in [json!({}), json!({"builtinTools": null})] {
        let args = launched_with(atelier);
        assert!(!args.iter().any(|arg| arg == "--tools"), "{args:?}");
    }
}

#[test]
fn 금지는_s19_규칙으로_옮겨_disallowed_tools로_들고_명령_패턴은_그대로_간다() {
    // v1 구현 스펙 S19 — 명령은 맨 명령과 인자가 붙은 명령을 함께 막는다.
    let table = [
        (json!(["edit"]), "Edit,Write,NotebookEdit"),
        (json!(["shell"]), "Bash"),
        (json!(["push"]), "Bash(git push),Bash(git push *)"),
        (json!(["merge"]), "Bash(gh pr merge),Bash(gh pr merge *),Bash(git merge),Bash(git merge *)"),
        (json!(["Bash(npx prisma migrate *)"]), "Bash(npx prisma migrate *)"),
        (json!(["push", "Bash(rm -rf *)"]), "Bash(git push),Bash(git push *),Bash(rm -rf *)"),
    ];
    for (forbid, rules) in table {
        let args = launched_with(json!({"forbid": forbid}));
        assert_eq!(flag(&args, "--disallowedTools").as_deref(), Some(rules), "{forbid}: {args:?}");
    }

    // 마이그레이션 명령(`schema`)은 고정 목록이 없다 — 파일에 명령 패턴으로 적는다(S19). 옮길 규칙이 없으면 플래그도 없다.
    for forbid in [json!([]), json!(["schema"])] {
        let args = launched_with(json!({"forbid": forbid}));
        assert!(!args.iter().any(|arg| arg == "--disallowedTools"), "{forbid}: {args:?}");
    }
}

#[test]
fn acp_mcp_서버는_claude의_mcp_설정으로_옮겨_mcp_config로_들고_사용자_mcp는_그대로_붙는다() {
    // ACP의 stdio 서버(`type`이 없다) — Thread 도구 서버(S12)가 이 길로 온다. 서버마다 claude의 도구 시간 제한을 가장 길게 준다
    // — Agent 부르기(v1 티켓 16)는 불린 Agent의 턴과 사람의 승인을 기다리며 몇 분을 넘긴다(§8 「시간」).
    let servers = json!([
        {
            "name": "atelier-thread",
            "command": "/Applications/Atelier.app/Contents/MacOS/atelier",
            "args": ["thread-tools", "--socket", "/tmp/gate/thread.sock"],
            "env": [{"name": "ATELIER_THREAD", "value": "20261023-090000"}]
        },
        {"type": "stdio", "name": "plain", "command": "plain-server", "args": [], "env": []}
    ]);
    let args = launched_by("session/new", json!({"cwd": CWD, "mcpServers": servers, "_meta": {"atelier": {}}}));
    let config = flag(&args, "--mcp-config").unwrap_or_else(|| panic!("--mcp-config: {args:?}"));
    assert_eq!(
        serde_json::from_str::<Value>(&config).expect("JSON 글로 넘긴다"),
        json!({"mcpServers": {
            "atelier-thread": {
                "type": "stdio",
                "command": "/Applications/Atelier.app/Contents/MacOS/atelier",
                "args": ["thread-tools", "--socket", "/tmp/gate/thread.sock"],
                "env": {"ATELIER_THREAD": "20261023-090000"},
                "timeout": 2_147_483_647
            },
            "plain": {"type": "stdio", "command": "plain-server", "args": [], "env": {}, "timeout": 2_147_483_647}
        }})
    );
    // 사용자의 MCP 설정과 claude.ai 커넥터는 지금처럼 붙는다(S39 · three-axes 결정 23) — 넘긴 것만 쓰라고 하지 않는다.
    assert!(!args.iter().any(|arg| arg == "--strict-mcp-config"), "{args:?}");
    // 호스트가 넘긴 서버(Thread 도구)는 claude가 묻지 않는다 — 도구가 스스로 가리고 판정은 하나다(결정.md 15).
    assert_eq!(flag(&args, "--allowedTools").as_deref(), Some("mcp__atelier-thread,mcp__plain"), "{args:?}");

    // 넘길 서버가 없으면 플래그도 없다.
    let args = launched_with(json!({}));
    for name in ["--mcp-config", "--allowedTools"] {
        assert!(!args.iter().any(|arg| arg == name), "{name}: {args:?}");
    }
}

#[test]
fn 모르는_추상_도구나_stdio가_아닌_mcp_서버면_claude를_띄우지_않고_열기를_까닭으로_답한다() {
    let mut bench = Bench::new(Claude::replaying("2.1.282/twoturn-tools"));
    bench.request("initialize", json!({"protocolVersion": 1}));

    // 모르는 추상 도구는 Agent 파일 오류다(§6) — 기본 도구 전부로도, 내장 도구 없음으로도 미끄러지지 않는다.
    let unknown = bench.request(
        "session/new",
        json!({"cwd": CWD, "mcpServers": [], "_meta": {"atelier": {"builtinTools": ["read", "browse"]}}}),
    );
    assert_eq!(bench.error(unknown), json!({"code": -32602, "message": "모르는 추상 도구입니다: browse"}));
    // http · sse는 광고하지 않았다(ACP `mcpCapabilities`) — 받지 않는다.
    let http = bench.request(
        "session/new",
        json!({"cwd": CWD, "mcpServers": [{"type": "http", "name": "web", "url": "https://mcp.example", "headers": []}]}),
    );
    assert_eq!(bench.error(http), json!({"code": -32602, "message": "stdio가 아닌 MCP 서버는 받지 않습니다: web (http)"}));
    assert_eq!(bench.launches().len(), 0, "claude를 띄우지 않았다");

    let opened = bench.request("session/new", json!({"cwd": CWD, "mcpServers": []}));
    assert!(bench.result(opened)["sessionId"].is_string(), "다음 열기를 받는다");
}

// ── 턴 ──────────────────────────────────────────────────────────────────────────────

#[test]
fn twoturn_tools는_한_claude가_두_턴을_받고_답_생각_도구가_순서대로_update로_나가고_첫_말은_init_전에_들어간다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));

    let first = bench.prompt("세 낱말로 답해");
    let second = bench.prompt("notes.txt를 쓰고 읽고 바이트를 세");

    // 한 claude가 두 턴을 받는다 — 하나만 띄웠고, 그 stdin에 user 줄이 둘 들어갔다.
    assert_eq!(bench.launches().len(), 1, "턴마다 새로 띄우지 않는다");
    let stdin = bench.stdin();
    let kinds: Vec<&str> = stdin.iter().map(|line| line["type"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["control_request", "user", "user"], "{stdin:?}");
    assert_eq!(stdin[2]["message"]["content"], json!([{"type": "text", "text": "notes.txt를 쓰고 읽고 바이트를 세"}]));

    // 첫 말은 `system/init`을 기다리지 않고 들어간다(워크플로 함정 6) — claude는 첫 user 줄을 받은 뒤에야 init을 낸다.
    let put = bench.at(|seen| matches!(seen, Seen::Stdin(line) if line["type"] == "user"));
    let init = bench.at(|seen| matches!(seen, Seen::Acp(line) if line["params"]["update"]["sessionUpdate"] == "session_info_update"));
    assert!(put < init);

    let first_updates = bench.turn_updates(first);
    assert_eq!(first_updates[0]["sessionUpdate"], "session_info_update");
    assert_eq!(
        first_updates[1..3],
        [
            json!({"sessionUpdate": "agent_thought_chunk", "messageId": "msg_011CfPd2ps1hQpw4v1Rs8tuk",
                   "content": {"type": "text", "text": ""}}),
            json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_011CfPd2ps1hQpw4v1Rs8tuk",
                   "content": {"type": "text", "text": "Hello from turn"}}),
        ]
    );

    let notes = "/tmp/gate/ws/g3/wt/notes.txt";
    let second_updates = bench.turn_updates(second);
    let thought = |id: &str| json!({"sessionUpdate": "agent_thought_chunk", "messageId": id, "content": {"type": "text", "text": ""}});
    let output = |text: &str| json!([{"type": "content", "content": {"type": "text", "text": text}}]);
    assert_eq!(
        second_updates[..second_updates.len() - 1],
        [
            thought("msg_011CfPd34AiH7onGhJ4HX7My"),
            json!({"sessionUpdate": "tool_call", "toolCallId": "toolu_01M6s2XMKCLWJ7jLZEccS4N1",
                   "title": format!("Write {notes}"), "kind": "edit", "status": "in_progress",
                   "rawInput": {"file_path": notes, "content": "gate"},
                   "content": [{"type": "diff", "path": notes, "oldText": null, "newText": "gate"}],
                   "locations": [{"path": notes}],
                   "_meta": {"claudeCode": {"toolName": "Write"}}}),
            // 편집 도구의 성공은 diff를 덮지 않는다 — 도구 줄에 diff가 남는다.
            json!({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_01M6s2XMKCLWJ7jLZEccS4N1", "status": "completed"}),
            thought("msg_011CfPd3Z9ySN31ni8SVPHkT"),
            json!({"sessionUpdate": "tool_call", "toolCallId": "toolu_01VXai9x8h48DAUzNos1XrRq",
                   "title": format!("Read {notes}"), "kind": "read", "status": "in_progress",
                   "rawInput": {"file_path": notes}, "locations": [{"path": notes}],
                   "_meta": {"claudeCode": {"toolName": "Read"}}}),
            json!({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_01VXai9x8h48DAUzNos1XrRq", "status": "completed",
                   "content": output("1\tgate")}),
            thought("msg_011CfPd3hmtvDwNUFf4JfRJW"),
            json!({"sessionUpdate": "tool_call", "toolCallId": "toolu_01UUpYo9irycNHZBPMFkZNdz",
                   "title": format!("wc -c {notes}"), "kind": "execute", "status": "in_progress",
                   "rawInput": {"command": format!("wc -c {notes}"), "description": "Get byte count of notes.txt"},
                   "_meta": {"claudeCode": {"toolName": "Bash"}}}),
            json!({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_01UUpYo9irycNHZBPMFkZNdz", "status": "completed",
                   "content": output(&format!("       4 {notes}"))}),
            thought("msg_011CfPd3tBDJiEPbWXFpCuvQ"),
            json!({"sessionUpdate": "agent_message_chunk", "messageId": "msg_011CfPd3tBDJiEPbWXFpCuvQ",
                   "content": {"type": "text", "text": "4"}}),
        ]
    );

    // `result` 하나가 턴 끝 하나다.
    assert_eq!((bench.result(first)["stopReason"].clone(), bench.result(second)["stopReason"].clone()), (json!("end_turn"), json!("end_turn")));
}

#[test]
fn 둘째_턴의_system_init은_새_세션을_열지_않고_같은_세션에서_턴이_이어진다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));

    bench.prompt("첫 말");
    let second = bench.prompt("둘째 말");

    // claude는 턴마다 `system/init`을 다시 낸다(원문 12줄). 그것은 새 세션이 아니다.
    let infos = bench.updates().iter().filter(|update| update["sessionUpdate"] == "session_info_update").count();
    assert_eq!((bench.launches().len(), infos), (1, 1), "띄우기도 세션 정보도 한 번이다");
    let sessions: Vec<Value> = bench
        .acp()
        .into_iter()
        .filter(|line| line["method"] == "session/update")
        .map(|line| line["params"]["sessionId"].clone())
        .collect();
    assert!(sessions.iter().all(|id| *id == json!(bench.session_id)), "모든 update가 처음 연 세션의 것이다: {sessions:?}");
    assert!(!bench.turn_updates(second).is_empty(), "둘째 턴의 줄도 같은 세션으로 흐른다");
    assert_eq!(bench.result(second)["stopReason"], "end_turn");
}

#[test]
fn edit_입력은_옛_조각과_새_조각의_diff_내용으로_tool_call에_실리고_그_파일은_읽지_않는다() {
    let mut bench = Bench::open(Claude::replaying("2.1.296/edit-subagent"));

    bench.prompt("note.md의 status를 done으로 고쳐");

    // 원문(진짜 claude 2.1.296이 고친 파일)의 경로는 이 기계에 없다 — 그 파일을 읽어 diff를 지었다면 지을 수 없었다.
    let note = "/tmp/gate/ws/proj/note.md";
    assert!(!std::path::Path::new(note).exists(), "시험의 전제: 원문의 파일이 없다");
    let (edit, after) = tool_lines(&bench.updates(), "Edit");
    assert_eq!(
        edit,
        json!({"sessionUpdate": "tool_call", "toolCallId": "toolu_016oQDPXytJaFxiNBTyz9gsb",
               "title": format!("Edit {note}"), "kind": "edit", "status": "in_progress",
               "rawInput": {"replace_all": false, "file_path": note, "old_string": "status: draft", "new_string": "status: done"},
               "content": [{"type": "diff", "path": note, "oldText": "status: draft", "newText": "status: done"}],
               "locations": [{"path": note}],
               "_meta": {"claudeCode": {"toolName": "Edit"}}}),
        "diff는 입력의 조각 그대로다 — 파일 전체가 아니다(S2)"
    );
    assert_eq!(
        after,
        [json!({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_016oQDPXytJaFxiNBTyz9gsb", "status": "completed"})],
        "성공한 편집은 결과 글로 diff를 덮지 않는다"
    );
    // 고치기 전에 읽은 `Read`는 보통 도구 줄이다.
    let (read, _) = tool_lines(&bench.updates(), "Read");
    assert_eq!((read["kind"].as_str(), read.get("content")), (Some("read"), None));
}

#[test]
fn 모델이_skill을_부를_때_생기는_issynthetic_글은_나가지_않고_스킬_도구_줄과_답만_나간다() {
    let mut bench = Bench::open(Claude::replaying("2.1.296/slash-skill-noreplay"));

    bench.prompt("/probe-skill");
    let second = bench.prompt("probe-skill 스킬을 Skill 도구로 불러서 답하라");

    // 원문 17줄 — `{"type":"user","isSynthetic":true, …"Skill /probe-skill is already loaded above; …"}`. 사람의 말이 아니다(실측 함정 34).
    assert!(!bench.text().contains("is already loaded above"), "합성 글이 나갔다");
    let updates = bench.turn_updates(second);
    let kinds: Vec<Value> = updates.iter().map(|update| update["sessionUpdate"].clone()).collect();
    assert_eq!(
        kinds,
        [json!("agent_thought_chunk"), json!("tool_call"), json!("tool_call_update"), json!("agent_message_chunk"), json!("usage_update")]
    );
    let (skill, after) = tool_lines(&updates, "Skill");
    assert_eq!((skill["title"].as_str(), skill["kind"].as_str()), (Some("Skill probe-skill"), Some("other")));
    assert_eq!(after[0]["content"], json!([{"type": "content", "content": {"type": "text", "text": "Launching skill: probe-skill"}}]));
    assert_eq!(updates[3]["content"]["text"], "PROBE-SKILL-OK");
}

/// 판 02 실측 2.1.296 `slash-skill-replay`에서 내장 명령 `command`의 `<synthetic>` 답 줄.
fn builtin_answer(command: &str) -> Value {
    recorded("2.1.296/slash-skill-replay")
        .into_iter()
        .find(|line| line["local_command_run"]["command"] == command)
        .expect("내장 명령의 답 줄")
}

#[test]
fn 내장_명령_context의_synthetic_답은_agent_message_chunk로_나가고_사람의_말_메아리는_옮기지_않는다() {
    let mut bench = Bench::open(Claude::replaying("2.1.296/slash-skill-replay"));

    bench.prompt("/probe-skill");
    bench.prompt("/probe-cmd");
    let context = bench.prompt("/context");

    // 모델을 부르지 않은 턴 — `assistant{message.model:"<synthetic>", local_command_source}` + `result{local_command}`(실측 A4).
    let answer = builtin_answer("context");
    assert_eq!(answer["message"]["model"], "<synthetic>");
    assert_eq!(
        bench.turn_updates(context),
        [json!({"sessionUpdate": "agent_message_chunk", "messageId": answer["message"]["id"],
                "content": {"type": "text", "text": answer["message"]["content"][0]["text"]}})],
        "내장 명령의 답은 보통 답이다. 모델을 부르지 않아 사용량도 없다"
    );
    assert_eq!(bench.result(context)["stopReason"], "end_turn");

    // `--replay-user-messages`로 잰 원문이라 사람의 말이 `isReplay`로 되돌아온다 — 호스트가 이미 `sent`로 적은 말이다.
    assert!(!bench.text().contains("<command-message>"), "사람의 말 메아리가 나갔다");
}

#[test]
fn 사용량은_result_usage_iterations의_마지막_원소에서_세고_크기는_답한_모델의_컨텍스트_창이다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));

    let first = bench.prompt("첫 말");
    let second = bench.prompt("도구를 쓰는 둘째 말");

    let usage = |id: u64| bench.turn_updates(id).last().cloned().unwrap();
    // 원문 11줄: iterations[-1] = 입력 10 + 출력 228 + 캐시 읽기 13856 + 캐시 쓰기 6368. contextWindow 200000.
    assert_eq!(usage(first), json!({"sessionUpdate": "usage_update", "used": 20462, "size": 200000}));
    // 원문 30줄: 도구를 넷 부른 턴이라 `usage`(합) = 34 + 1096 + 94730 + 5329 = 101189로 부푼다. 지금 컨텍스트는 마지막
    // 호출 하나 — 8 + 113 + 25237 + 316.
    assert_eq!(usage(second), json!({"sessionUpdate": "usage_update", "used": 25674, "size": 200000}));

    // 사용량은 턴 끝 답의 원문에도 남는다.
    let response = bench.result(second);
    assert_eq!(response["stopReason"], "end_turn");
    assert_eq!(response["_meta"]["claudeCode"]["result"]["usage"]["output_tokens"], 1096, "result 원문이 실린다");
}

#[test]
fn 서브에이전트_도구_호출은_meta에_서브에이전트를_싣고_그_안의_일은_대화가_아니라_그_줄의_meta로_간다() {
    let mut bench = Bench::open(Claude::replaying("2.1.296/edit-subagent"));

    bench.prompt("note.md를 고쳐");
    let second = bench.prompt("서브에이전트로 셋째 줄을 읽어 와");

    let subagent = json!({"subagentType": "general-purpose", "description": "Read third line of note.md"});
    let (agent, after) = tool_lines(&bench.updates(), "Agent");
    assert_eq!(agent["toolCallId"], "toolu_01BEzxBrdDFdcVJX23ZT5jDN");
    assert_eq!((agent["title"].as_str(), agent["kind"].as_str()), (Some("Read third line of note.md"), Some("think")));
    assert_eq!(agent["_meta"], json!({"claudeCode": {"toolName": "Agent", "subagent": subagent}}), "서브에이전트 자료는 _meta에 실린다");

    // 서브에이전트 안의 줄(`parent_tool_use_id`가 붙은 것)과 `task_*` 이벤트는 그 도구 줄의 update `_meta`로 — 원문 21~27줄.
    let relayed: Vec<&Value> = after.iter().filter(|update| update["_meta"]["claudeCode"].get("event").is_some()).collect();
    let events: Vec<String> = relayed
        .iter()
        .map(|update| {
            let event = &update["_meta"]["claudeCode"]["event"];
            format!("{}/{}", event["type"].as_str().unwrap(), event["subtype"].as_str().unwrap_or(""))
        })
        .collect();
    assert_eq!(
        events,
        ["system/task_started", "user/", "system/task_progress", "assistant/", "user/", "system/task_notification"]
    );
    for update in &relayed {
        assert_eq!(update["_meta"]["claudeCode"]["subagent"], subagent, "덮어 합쳐도 서브에이전트 자료가 남는다");
        assert!(update.get("status").is_none() && update.get("content").is_none(), "도구 줄의 상태 · 내용은 건드리지 않는다");
    }
    let inner = &relayed[3]["_meta"]["claudeCode"]["event"];
    assert_eq!(inner["message"]["content"][0]["name"], "Read", "서브에이전트가 부른 도구가 그 자료에 든다");

    // 서브에이전트의 도구는 대화의 도구 줄이 아니다 — 둘째 턴의 도구 줄은 `Agent` 하나다.
    let turn = bench.turn_updates(second);
    let calls: Vec<Value> = turn
        .iter()
        .filter(|update| update["sessionUpdate"] == "tool_call")
        .map(|update| update["_meta"]["claudeCode"]["toolName"].clone())
        .collect();
    assert_eq!(calls, [json!("Agent")]);
    let done = after.last().unwrap();
    assert_eq!(done["status"], "completed");
    assert!(done["content"][0]["content"]["text"].as_str().unwrap().starts_with("[Subagent hand-back]"), "{done}");
    assert_eq!(answers_of(&turn), ["status: done"], "대화의 답은 claude 자신의 것뿐이다");
}

#[test]
fn noauth_authentication_failed가_온_턴은_session_prompt에_minus_32000으로_답하고_그_오류_글은_답으로_내지_않는다() {
    let mut bench = Bench::open(Claude::replaying("2.1.296/noauth"));

    let id = bench.prompt("ok 라고만 답해.");

    // S3 — codex-acp와 같은 모양이라 호스트가 엔진을 가리지 않고 로그인 필요 줄 · 안내 카드로 옮긴다(three-axes 결정 30).
    let error = bench.error(id);
    assert_eq!((error["code"].clone(), error["message"].clone()), (json!(-32000), json!("Authentication required")));
    assert_eq!(error["data"]["claudeCode"]["result"]["type"], "result", "그 턴의 result 원문이 실린다");
    assert!(answers_of(&bench.turn_updates(id)).is_empty(), "미로그인 오류의 <synthetic> 글은 답으로 옮기지 않는다(실측 함정 33)");
}

// ── 멈추기 · 권한 · 바꾸기 ───────────────────────────────────────────────────────────

#[test]
fn 멈추면_claude에_interrupt_제어_요청_하나만_가고_턴이_cancelled로_끝나고_다음_말이_같은_claude_같은_세션으로_간다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/interrupt-sigint"));
    let first = bench.prompt("40초 자는 명령을 앞에서 돌리고 끝나면 FINISHED라고 해");
    // 원문은 그 명령이 도는 동안 interrupt를 보냈다 — 되감기는 도구 줄이 선 뒤 그 자리에서 멈춰 있다.
    assert!(has_tool_call(&bench.updates(), "Bash"));
    assert!(!bench.replied(first), "멈추기 전에는 턴이 끝나지 않는다");

    let before = bench.seen.len();
    bench.cancel();

    // 멈추기가 claude에 한 일은 stdin의 interrupt 제어 요청 하나다 — SIGINT는 쓰지 않는다(claude가 끝난다, 워크플로 함정 5).
    let after = &bench.seen[before..];
    let to_claude: Vec<&Value> = after.iter().filter_map(|seen| if let Seen::Stdin(line) = seen { Some(line) } else { None }).collect();
    assert_eq!(to_claude.len(), 1, "{to_claude:?}");
    assert_eq!((to_claude[0]["type"].as_str(), to_claude[0]["request"]["subtype"].as_str()), (Some("control_request"), Some("interrupt")));
    assert!(
        !after.iter().any(|seen| matches!(seen, Seen::Launch(_) | Seen::Dismiss | Seen::Close | Seen::Exit(_))),
        "프로세스에는 손대지 않는다"
    );
    assert_eq!(bench.result(first)["stopReason"], "cancelled", "우리가 interrupt를 보낸 턴의 error_during_execution은 cancelled다");
    let (_, bash) = tool_lines(&bench.updates(), "Bash");
    let closed: Vec<Value> = bash.iter().filter_map(|update| update.get("status").cloned()).collect();
    assert_eq!(closed, [json!("failed")], "멈춘 명령의 도구 줄은 실패로 닫힌다");

    // 다음 말은 같은 claude · 같은 세션으로 간다 — claude는 멈춘 턴의 맥락을 잇는다(원문 21줄).
    let next = bench.prompt("방금 무엇을 돌리려 했고 끝났는지 한 문장으로");
    assert_eq!(bench.result(next)["stopReason"], "end_turn");
    assert_eq!(bench.launches().len(), 1, "다시 띄우지 않았다");
    assert_eq!(bench.stdin_shape(), ["initialize", "user", "interrupt", "user"]);
    let sessions: Vec<Value> = bench
        .acp()
        .into_iter()
        .filter(|line| line["method"] == "session/update")
        .map(|line| line["params"]["sessionId"].clone())
        .collect();
    assert!(sessions.iter().all(|id| *id == json!(bench.session_id)), "모든 update가 처음 연 세션의 것이다");
    let answer = answers_of(&bench.turn_updates(next)).pop().unwrap();
    assert!(answer.contains("완료되지 않았습니다"), "{answer}");
}

/// 변환기가 짓는 Claude 권한 선택지 — 한 번 허락 · 이 대화에서 허락 · 거부.
fn claude_options(with_session: bool) -> Value {
    let mut options = vec![json!({"optionId": "allow_once", "name": "Yes", "kind": "allow_once"})];
    if with_session {
        options.push(json!({"optionId": "allow_session", "name": "Yes, and don't ask again this conversation",
                            "kind": "allow_always"}));
    }
    options.push(json!({"optionId": "reject", "name": "No, and tell Claude what to do differently", "kind": "reject_once"}));
    Value::Array(options)
}

/// 원문(워크플로 관문 G1)의 작업 자리 밖 파일 — 첫 턴은 허락한 것, 둘째 턴은 거부한 것.
const ALLOWED: &str = "/tmp/gate/ws/g1/outside/allowed.txt";
const DENIED: &str = "/tmp/gate/ws/g1/outside/denied.txt";

#[test]
fn permission_stdio_권한_요청이_session_request_permission으로_가고_세션_제안이_있으면_선택지가_셋이고_허락하면_턴이_이어진다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/permission-stdio"));
    let first = bench.prompt("outside/allowed.txt를 Write로 만들어");

    let asked = bench.permission_requests();
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0]["id"], 0, "변환기의 요청 id는 0부터 센다(codex-acp와 같다)");
    let params = &asked[0]["params"];
    assert_eq!(
        params["toolCall"],
        json!({"toolCallId": "toolu_01N3UUSZaU6yvP6yapUN8U5P", "title": format!("Write {ALLOWED}"), "kind": "edit",
               "status": "pending", "rawInput": {"file_path": ALLOWED, "content": "x"},
               "_meta": {"claudeCode": {"toolName": "Write", "decisionReason": "Path is outside allowed working directories"}}}),
        "도구 요지 — 앞서 낸 tool_call과 같은 id · 제목 · 종류이고, 입력은 claude가 물은 그대로다. 까닭(decision_reason)은 승인 카드가 \
         읽는 자리(_meta.claudeCode.decisionReason)에 선다(티켓 21)"
    );
    assert_eq!(params["sessionId"], json!(bench.session_id));
    assert_eq!(params["options"], claude_options(true), "원문의 제안 둘이 다 session이라 선택지는 셋이다");
    let original = &params["_meta"]["claudeCode"]["request"];
    assert_eq!(
        (original["decision_reason"].as_str(), original["description"].as_str()),
        (Some("Path is outside allowed working directories"), Some(ALLOWED)),
        "claude가 물은 원문(까닭 · 설명 · 제안)이 _meta에 실린다 — 승인 카드의 재료다"
    );
    assert!(!bench.replied(first), "답하기 전에는 턴이 끝나지 않는다");

    bench.answer(0, "allow_once");

    assert_eq!(
        bench.answers(),
        [json!({"type": "control_response",
                "response": {"subtype": "success", "request_id": "93884787-809c-4c0a-82cd-a8ed96112508",
                             "response": {"behavior": "allow", "updatedInput": {"file_path": ALLOWED, "content": "x"}}}})],
        "한 번 허락은 allow와 claude가 물은 입력 그대로다 — 영구 규칙(updatedPermissions)이 없다"
    );
    assert_eq!(bench.result(first)["stopReason"], "end_turn");
    let (_, after) = tool_lines(&bench.updates(), "Write");
    assert_eq!(after.last().unwrap()["status"], "completed", "허락한 도구가 끝나고 턴이 이어진다");
}

#[test]
fn 세션_제안이_없는_권한_요청은_선택지가_한_번_허락과_거부_둘이다() {
    let mut claude = Claude::replaying("2.1.282/permission-stdio");
    claude.suggestions = Some(json!([]));
    let mut bench = Bench::open(claude);

    bench.prompt("outside/allowed.txt를 Write로 만들어");

    assert_eq!(bench.permission_requests()[0]["params"]["options"], claude_options(false));
}

#[test]
fn 이_대화에서_허락은_session_제안만_싣고_설정_파일에_쓰는_제안은_claude에_돌려주지_않는다() {
    // 세션 제안 둘(원문 그대로)과 설정 파일에 쓰는 제안 둘이 섞인 제안 — 워크플로 관문 G1에서 `Bash` 요청에 붙어 온
    // `addRules{destination:"localSettings"}`와, 사용자 설정을 고치는 `userSettings`의 꼴이다.
    let mut claude = Claude::replaying("2.1.282/permission-stdio");
    claude.suggestions = Some(json!([
        {"type": "addRules", "rules": [{"toolName": "Write", "ruleContent": "/tmp/gate/ws/g1/outside/**"}], "behavior": "allow",
         "destination": "localSettings"},
        {"type": "setMode", "mode": "acceptEdits", "destination": "session"},
        {"type": "addRules", "rules": [{"toolName": "Write"}], "behavior": "allow", "destination": "userSettings"},
        {"type": "addDirectories", "directories": ["/tmp/gate/ws/g1/outside"], "destination": "session"}
    ]));
    let mut bench = Bench::open(claude);
    let first = bench.prompt("outside/allowed.txt를 Write로 만들어");
    assert_eq!(bench.permission_requests()[0]["params"]["options"], claude_options(true));

    bench.answer(0, "allow_session");

    assert_eq!(bench.result(first)["stopReason"], "end_turn");
    assert_eq!(
        bench.answers()[0]["response"]["response"],
        json!({"behavior": "allow", "updatedInput": {"file_path": ALLOWED, "content": "x"},
               "updatedPermissions": [
                   {"type": "setMode", "mode": "acceptEdits", "destination": "session"},
                   {"type": "addDirectories", "directories": ["/tmp/gate/ws/g1/outside"], "destination": "session"}
               ]}),
        "session 제안만 돌려준다 — localSettings는 워크트리에 .claude/settings.local.json을, userSettings는 사용자 설정을 쓴다(워크플로 함정 3)"
    );
}

#[test]
fn 거부하면_claude는_deny와_거부의_글을_받고_그_도구_호출만_실패하고_턴이_이어져_end_turn으로_끝난다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/permission-stdio"));
    bench.prompt("outside/allowed.txt를 Write로 만들어");
    bench.answer(0, "allow_once");
    let second = bench.prompt("outside/denied.txt를 Write로 만들어");
    let asked = bench.permission_requests();
    assert_eq!(asked[1]["id"], 1, "변환기의 요청 id는 세션 동안 이어 센다");
    assert_eq!(asked[1]["params"]["toolCall"]["rawInput"]["file_path"], DENIED);

    let before = bench.seen.len();
    bench.answer(1, "reject");

    let denial = &bench.answers()[1]["response"];
    assert_eq!(denial["request_id"], "55ac2cb2-29bc-47b0-ad5d-d840238550ad");
    assert_eq!(denial["response"]["behavior"], "deny", "거부는 deny다");
    let message = denial["response"]["message"].clone();
    assert!(message.as_str().is_some_and(|text| !text.is_empty()), "deny에는 claude에게 줄 글이 실린다");

    // 거부한 뒤의 줄 — 그 도구가 실패로 닫히고(claude가 거부의 글을 결과로 받았다), 모델이 이어 답하고, 턴이 보통으로 끝난다.
    let after: Vec<Value> = bench
        .acp_in(before..bench.seen.len())
        .into_iter()
        .map(|line| if line["method"] == "session/update" { line["params"]["update"].clone() } else { json!("reply") })
        .collect();
    assert_eq!(
        after[0],
        json!({"sessionUpdate": "tool_call_update", "toolCallId": "toolu_01242xqAGeUr9Sx7LfbCib3t", "status": "failed",
               "content": [{"type": "content", "content": {"type": "text", "text": message}}]}),
        "그 도구 호출 하나만 실패한다"
    );
    let kinds: Vec<&str> =
        after[1..].iter().map(|item| item["sessionUpdate"].as_str().unwrap_or_else(|| item.as_str().unwrap())).collect();
    assert_eq!(kinds, ["agent_thought_chunk", "agent_message_chunk", "usage_update", "reply"], "턴이 이어진다");
    assert_eq!(bench.result(second)["stopReason"], "end_turn");
}

#[test]
fn 권한이_걸린_채_멈추면_걸린_요청에도_claude가_거둔_요청의_늦은_답에도_답하지_않고_턴이_cancelled로_끝나고_다음_말이_이어진다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/permission-stdio"));
    let first = bench.prompt("outside/allowed.txt를 Write로 만들어");
    assert_eq!(bench.permission_requests().len(), 1);

    // 호스트는 멈출 때 걸린 요청을 `cancelled`로 거둔다 — claude가 interrupt에 그 요청을 거두기(`control_cancel_request`) 전에 닿는다.
    let cancel = bench.cancel_message();
    bench.send_together(vec![cancel, json!({"jsonrpc": "2.0", "id": 0, "result": {"outcome": {"outcome": "cancelled"}}})]);

    assert_eq!(
        bench.stdin_shape(),
        ["initialize", "user", "interrupt"],
        "claude는 interrupt에 그 요청을 스스로 거둔다(워크플로 관문 G2 (c)) — 변환기는 거둔 요청에 답하지 않는다"
    );
    assert_eq!(bench.result(first)["stopReason"], "cancelled");
    let (_, write) = tool_lines(&bench.updates(), "Write");
    assert_eq!(write.last().unwrap()["status"], "failed", "묻던 도구는 돌지 않고 실패로 닫힌다");

    // claude가 거둔 요청에 뒤늦게 온 답도 claude에 옮기지 않는다.
    bench.answer(0, "allow_once");
    assert_eq!(bench.stdin_shape(), ["initialize", "user", "interrupt"]);

    // 같은 claude가 다음 말을 받는다 — 둘째 턴도 권한을 묻는다.
    bench.prompt("outside/denied.txt를 Write로 만들어");
    let asked = bench.permission_requests();
    assert_eq!((asked.len(), asked[1]["id"].clone()), (2, json!(1)));
    assert_eq!(asked[1]["params"]["toolCall"]["rawInput"]["file_path"], DENIED);
    assert_eq!(bench.launches().len(), 1);
}

#[test]
fn 모델과_모드를_바꾸면_claude에_set_model과_set_permission_mode가_가고_답에_바뀐_값이_실리고_claude의_메아리는_옮기지_않는다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));

    let model = bench.set_model("sonnet");
    let mode = bench.set_mode("acceptEdits");

    assert_eq!(
        bench.controls(),
        [json!({"subtype": "set_model", "model": "sonnet"}), json!({"subtype": "set_permission_mode", "mode": "acceptEdits"})],
        "모델 → stdin set_model, 모드 → stdin set_permission_mode(three-axes 결정 16 · 27)"
    );
    let options = bench.result(model)["configOptions"].clone();
    assert_eq!((options[0]["id"].as_str(), options[0]["currentValue"].as_str()), (Some("model"), Some("sonnet")), "답에 바뀐 모델이 실린다");
    assert_eq!(bench.result(mode), json!({}));
    assert!(
        !bench.updates().iter().any(|update| update["sessionUpdate"] == "current_mode_update"),
        "사람이 바꾼 모드에 claude가 되돌려 주는 system/status는 옮기지 않는다 — 호스트가 config 줄로 이미 적었다"
    );

    // 다음 말보다 먼저 claude에 닿았다 — 같은 claude가 다음 턴을 받는다.
    let next = bench.prompt("다음 말");
    assert_eq!(bench.result(next)["stopReason"], "end_turn");
    assert_eq!(bench.stdin_shape(), ["initialize", "set_model", "set_permission_mode", "user"]);
}

#[test]
fn 엔진_기본값으로_되돌린_모델은_값_없는_set_model이다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));

    let model = bench.set_model("default");

    // 실측 2.1.296 — 값 없는 set_model이 사용자의 기본 모델로 돌린다(`Set model to claude-opus-5-5`).
    assert_eq!(bench.controls(), [json!({"subtype": "set_model"})]);
    assert_eq!(bench.result(model)["configOptions"][0]["currentValue"], "default");
}

#[test]
fn claude가_거절한_바꾸기와_claude에_없는_설정은_까닭이_실린_오류로_답한다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));

    // 실측 2.1.296 — 띄울 때 허락하지 않은 bypassPermissions는 `bypass_not_launched`(실측 함정 38).
    let mode = bench.set_mode("bypassPermissions");
    let refused = bench.error(mode);
    assert_eq!(refused["code"], -32602);
    assert!(refused["message"].as_str().unwrap().contains("--dangerously-skip-permissions"), "claude가 준 까닭이 실린다: {refused}");
    assert!(refused["data"]["errorCode"].is_string(), "claude의 오류 코드가 실린다: {refused}");
    let model = bench.set_model("no-such-model");
    assert!(bench.error(model)["message"].as_str().unwrap().contains("not found"), "{}", bench.error(model));
    // Claude의 계획은 모드 칩의 plan이다 — Codex의 「계획」 설정(collaboration_mode)은 없다(three-axes 결정 29).
    let session = bench.session_id.clone();
    let plan = bench.request(
        "session/set_config_option",
        json!({"sessionId": session, "configId": "collaboration_mode", "value": "plan"}),
    );
    assert_eq!(bench.error(plan), json!({"code": -32602, "message": "Claude에는 그 설정이 없습니다: collaboration_mode"}));
    assert_eq!(bench.stdin_shape(), ["initialize", "set_permission_mode", "set_model"], "없는 설정은 claude에 넣지 않는다");
}

/// 판 02 관문 G1 원문(`g1-plan-revise`)에서 claude가 물은 `ExitPlanMode`들의 `can_use_tool` 요청 — 물은 차례대로.
fn recorded_plan_requests() -> Vec<Value> {
    recorded("2.1.296/g1-plan-revise")
        .into_iter()
        .filter(|line| line["type"] == "control_request" && line["request"]["tool_name"] == "ExitPlanMode")
        .collect()
}

/// G1에서 진짜 claude 2.1.296이 계획 모드에 남아 다음 말을 기다리게 한 「다시 짜기」의 글 — 잰 쪽이 넣은 deny의 `message`.
fn measured_revise_message() -> Value {
    claude_replay::json_lines(include_str!("../../../tests/fixtures/claude-2.1.296/g1-plan-revise.stdin.jsonl"))
        .find(|line| line["response"]["response"]["behavior"] == "deny")
        .expect("G1 원문에 다시 짜기의 deny가 있다")["response"]["response"]["message"]
        .clone()
}

#[test]
fn 계획_승인은_계획_본문이_든_switch_mode_권한_요청이고_다시_짜기는_deny와_고정_문구_구현은_allow로_가고_승인_뒤_claude가_바꾼_모드는_current_mode_update로_나간다() {
    let mut bench = Bench::open(Claude::replaying("2.1.296/g1-plan-revise"));
    bench.set_mode("plan");
    let first = bench.prompt("hello.txt에 hi를 담는 계획을 두 단계로 짜고 ExitPlanMode로 물어");

    // claude가 계획을 다 짜면 ExitPlanMode를 can_use_tool로 묻는다(G1) — codex-acp의 계획 승인과 같은 모양이다.
    let plans = recorded_plan_requests();
    let asked = &bench.permission_requests()[0]["params"];
    assert_eq!(
        asked["toolCall"],
        json!({"toolCallId": plans[0]["request"]["tool_use_id"], "kind": "switch_mode", "status": "pending",
               "title": "Implement this plan?", "rawInput": {"plan": plans[0]["request"]["input"]["plan"]},
               "_meta": {"claudeCode": {"toolName": "ExitPlanMode"}}}),
        "계획 본문(input.plan)이 rawInput.plan에 실린다 — 계획 카드의 재료다(S5)"
    );
    assert_eq!(
        asked["options"],
        json!([
            {"optionId": "implement_plan", "name": "Yes, implement this plan", "kind": "allow_once"},
            {"optionId": "revise_plan", "name": "No, and tell Claude what to do differently", "kind": "reject_once"}
        ]),
        "선택지는 구현 · 다시 짜기 둘이다"
    );

    bench.answer(0, "revise_plan");

    assert_eq!(
        bench.answers()[0]["response"],
        json!({"subtype": "success", "request_id": plans[0]["request_id"],
               "response": {"behavior": "deny", "message": measured_revise_message()}}),
        "다시 짜기는 deny와 고정 문구다 — G1에서 claude가 이 글을 받고 파일을 고치지 않은 채 계획 모드에 남았다"
    );
    assert_eq!(bench.result(first)["stopReason"], "end_turn");
    assert!(!bench.updates().iter().any(|update| update["sessionUpdate"] == "current_mode_update"), "계획 모드에 남는다");

    let second = bench.prompt("파일 이름을 greeting.txt로 바꿔서 다시 물어");
    assert_eq!(bench.permission_requests().len(), 2);
    let approved = bench.seen.len();
    bench.answer(1, "implement_plan");
    // 승인하면 claude가 default 모드로 가서 구현하고, 그 Write가 다시 묻는다(G1).
    let asked = bench.permission_requests();
    assert_eq!(asked[2]["params"]["toolCall"]["kind"], "edit");
    bench.answer(2, "allow_once");

    assert_eq!(bench.result(second)["stopReason"], "end_turn");
    assert_eq!(
        bench.answers()[1]["response"],
        json!({"subtype": "success", "request_id": plans[1]["request_id"],
               "response": {"behavior": "allow", "updatedInput": plans[1]["request"]["input"]}}),
        "구현은 allow와 claude가 물은 입력 그대로다"
    );
    let modes: Vec<Value> =
        bench.updates().into_iter().filter(|update| update["sessionUpdate"] == "current_mode_update").collect();
    assert_eq!(
        modes,
        [json!({"sessionUpdate": "current_mode_update", "currentModeId": "default"})],
        "claude가 스스로 바꾼 모드(system/status)는 current_mode_update다 — 우리가 넣은 plan의 메아리는 옮기지 않았다"
    );
    let shape: Vec<String> = bench
        .acp_in(approved..bench.seen.len())
        .iter()
        .map(|line| match line["method"].as_str() {
            Some("session/update") => line["params"]["update"]["sessionUpdate"].as_str().unwrap().to_owned(),
            Some(method) => method.to_owned(),
            None => "reply".to_owned(),
        })
        .take(2)
        .collect();
    assert_eq!(
        shape,
        ["current_mode_update", "tool_call_update"],
        "모드가 바뀐 것은 승인 바로 뒤, 승인된 ExitPlanMode가 끝나기 전에 선다"
    );
}

// ── 스스로 이어 간 턴(S4) ─────────────────────────────────────────────────────────────

/// 원문(워크플로 관문 G7 · G8)의 둘째 턴이 끝난 뒤 백그라운드 작업이 끝나 claude가 스스로 낸 답.
const SELF_ANSWER: &str = "백그라운드 명령어가 완료되었습니다. 20초 대기 후 \"BG-done\"이 출력되었습니다.";

#[test]
fn steer_background_subagent_백그라운드를_건_턴은_result에서_끝나고_스스로_이어_간_턴은_턴_밖_시작_턴_밖_update_턴_밖_끝으로_나간다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/steer-background-subagent"));
    bench.prompt("15초 명령을 앞에서 돌리고 TURN-A-END라고 해");

    let started = bench.prompt("20초 명령을 백그라운드로 걸고 곧바로 STARTED라고 해");

    let response = bench.result(started);
    assert_eq!(response["stopReason"], "end_turn", "백그라운드 작업이 남아도 그 턴은 result에서 끝난다 — 한 턴으로 접지 않는다(S4)");
    assert_eq!(response["_meta"]["claudeCode"]["result"]["result"], "STARTED");
    assert_eq!(answers_of(&bench.turn_updates(started)), ["STARTED"]);

    // 그 뒤 claude가 작업 알림으로 스스로 시작한 턴 — 걸린 `session/prompt` 없이 `system/init`이 왔다.
    let answered = bench.at(|seen| matches!(seen, Seen::Acp(line) if is_reply_to(line, started)));
    let own = bodies(&bench.acp_in(answered + 1..bench.seen.len()));
    let marks = out_of_turn_marks(&own);
    assert_eq!(marks.len(), 2, "{marks:?}");
    assert_eq!(marks[0], json!({"state": "started"}), "턴 밖 턴의 시작을 알린다");
    // 앞 턴의 `result` 뒤에 claude가 낸 작업 알림(`task_*`)은 그 도구 줄의 update로 먼저 흐른다 — 그 뒤 `system/init`이 턴을 연다.
    let start_at = own.iter().position(|update| update["_meta"]["atelier"]["outOfTurn"]["state"] == "started").unwrap();
    let answer_at = own.iter().position(|update| update["sessionUpdate"] == "agent_message_chunk").unwrap();
    assert!(start_at < answer_at, "시작이 그 턴의 답보다 앞에 선다: {own:?}");
    assert!(own[..start_at].iter().all(|update| update["sessionUpdate"] == "tool_call_update"), "{own:?}");
    assert_eq!(answers_of(&own), [SELF_ANSWER], "스스로 이어 간 턴의 답이 턴 밖 update로 나간다");
    let ended = &marks[1];
    assert_eq!((ended["state"].as_str(), ended["response"]["stopReason"].as_str()), (Some("ended"), Some("end_turn")));
    assert_eq!(
        ended["response"]["_meta"]["claudeCode"]["result"]["origin"]["kind"],
        "task-notification",
        "그 턴의 result 원문이 턴 밖 끝에 실린다 — 평가의 재료다(three-axes 결정 18)"
    );
    assert_eq!(out_of_turn_marks(&own[own.len() - 1..]), [ended.clone()], "끝이 그 턴의 마지막 줄이다");
    let replies = bench.acp().iter().filter(|line| line.get("method").is_none()).count();
    assert_eq!(replies, 4, "답은 받은 요청(initialize · session/new · 말 둘)에만 한다");
}

#[test]
fn 스스로_이어_간_턴_동안_온_session_prompt는_그_턴의_result_뒤에_claude에_넣고_그_턴_밖_끝에서_답하지_않는다() {
    let mut claude = Claude::replaying("2.1.282/steer-background-subagent");
    claude.hold = Some(Hold::Result);
    let mut bench = Bench::open(claude);
    bench.prompt("첫 말");
    let background = bench.prompt("백그라운드로 걸어");
    assert_eq!(bench.result(background)["stopReason"], "end_turn", "백그라운드를 건 턴은 result에서 끝난다");
    // 되감기는 스스로 이어 간 턴의 답까지 내고 그 턴의 result 앞에서 멈춰 있다.
    assert_eq!(out_of_turn_marks(&bench.updates()), [json!({"state": "started"})]);

    let held = bench.prompt("그동안 보낸 말");
    assert_eq!(bench.user_lines().len(), 2, "스스로 이어 간 턴이 도는 동안에는 claude에 넣지 않는다 — 그 턴에 합쳐진다(steer)");
    assert!(!bench.replied(held));

    bench.release();

    let marks = out_of_turn_marks(&bench.updates());
    assert_eq!((marks.len(), marks[1]["response"]["stopReason"].as_str()), (2, Some("end_turn")));
    let users = bench.user_lines();
    assert_eq!(users.len(), 3, "미뤄 둔 말이 claude에 갔다");
    assert_eq!(users[2]["message"]["content"], json!([{"type": "text", "text": "그동안 보낸 말"}]));
    let ended = bench.at(|seen| matches!(seen, Seen::Acp(line) if line["params"]["update"]["_meta"]["atelier"]["outOfTurn"]["state"] == "ended"));
    let put = bench.seen.iter().rposition(|seen| matches!(seen, Seen::Stdin(line) if line["type"] == "user")).unwrap();
    assert!(ended < put, "턴 밖 끝을 알린 뒤에 넣는다");
    assert!(!bench.replied(held), "미뤄 둔 말에는 그 턴 밖 끝에서 답하지 않는다 — 그 말의 턴은 이제 시작한다");

    // 원문의 다음 턴은 interrupt를 기다린다 — 멈추면 그 말의 턴이 cancelled로 끝난다.
    bench.cancel();
    assert_eq!(bench.result(held)["stopReason"], "cancelled");
}

#[test]
fn 스스로_이어_간_턴을_멈추면_interrupt를_한_번_보내고_미뤄_둔_말은_넣지_않고_곧바로_cancelled로_답한다() {
    let mut claude = Claude::replaying("2.1.282/steer-background-subagent");
    claude.hold = Some(Hold::Result);
    let mut bench = Bench::open(claude);
    bench.prompt("첫 말");
    bench.prompt("백그라운드로 걸어");
    let held = bench.prompt("그동안 보낸 말");
    // 미룬 말은 하나뿐이다.
    let again = bench.prompt("하나 더");
    assert_eq!(bench.error(again)["message"], "턴이 도는 중입니다 — 턴 도중의 말은 그 턴에 합쳐지므로 넣지 않습니다");

    bench.cancel();
    bench.cancel();

    // 사람은 아직 claude에 닿지 않은 그 말의 턴을 멈춘 것이다.
    assert_eq!(bench.result(held)["stopReason"], "cancelled");
    assert_eq!(bench.controls(), [json!({"subtype": "interrupt"})], "스스로 이어 간 턴도 같은 interrupt로 멈추고, 거듭 멈춰도 하나다");
    bench.release();
    let marks = out_of_turn_marks(&bench.updates());
    assert_eq!(marks.last().unwrap()["state"], "ended", "그 턴의 끝은 턴 밖 끝이다");
    assert_eq!(bench.user_lines().len(), 2, "미뤄 둔 말은 넣지 않는다");
}

// ── 열기의 사다리 · 끝 ───────────────────────────────────────────────────────────────

#[test]
fn 되살릴_세션을_claude가_모르면_그_까닭으로_답하고_같은_세션의_load는_다시_띄우지_않고_새_세션은_새로_띄운다() {
    let mut claude = Claude::replaying("2.1.282/twoturn-tools");
    claude.forgets = true;
    let mut bench = Bench::new(claude);
    bench.request("initialize", json!({"protocolVersion": 1}));
    let revive = json!({"sessionId": "yesterday", "cwd": CWD, "mcpServers": []});

    let resume = bench.request("session/resume", revive.clone());

    let reason = "claude가 세션을 되살리지 못했습니다: No conversation found with session ID: yesterday";
    assert_eq!(bench.error(resume), json!({"code": -32603, "message": reason}));
    let launches = bench.launches();
    assert_eq!((launches.len(), flag(&launches[0].args, "--resume").as_deref()), (1, Some("yesterday")));

    // 호스트의 되살리기는 resume → load → 새 세션 순으로 같은 변환기에 묻는다(three-axes 티켓 10).
    let load = bench.request("session/load", revive);
    assert_eq!(bench.error(load), json!({"code": -32603, "message": reason}), "load도 같은 `--resume`이라 같은 까닭이다");
    assert_eq!(bench.launches().len(), 1, "다시 띄우지 않는다");
    assert_eq!(bench.count(|seen| matches!(seen, Seen::Dismiss)), 1, "실패한 열기의 claude를 거둔다");

    let fresh = bench.request("session/new", json!({"cwd": CWD, "mcpServers": []}));
    let session = bench.result(fresh)["sessionId"].as_str().expect("새 세션 id").to_owned();
    let launches = bench.launches();
    assert_eq!((launches.len(), flag(&launches[1].args, "--session-id")), (2, Some(session)));
    assert!(bench.result(fresh)["modes"].is_object(), "새 세션은 보통으로 열린다");
}

#[test]
fn claude가_initialize에_답하지_않고_끝나면_열기를_오류로_답하고_다음_열기는_그_claude를_거두고_새로_띄운다() {
    let mut claude = Claude::replaying("2.1.282/twoturn-tools");
    claude.silent = true;
    let mut bench = Bench::new(claude);
    bench.request("initialize", json!({"protocolVersion": 1}));
    let first = bench.request("session/new", json!({"cwd": CWD, "mcpServers": []}));
    assert!(!bench.replied(first), "claude의 initialize 답을 기다린다");

    bench.claude_exits(1);

    assert_eq!(
        bench.error(first),
        json!({"code": -32603, "message": "claude가 initialize에 답하지 않고 끝났습니다 (exit status: 1)"})
    );
    assert!(bench.exits().is_empty(), "열리기 전의 claude가 끝나도 변환기는 남아 다음 열기를 받는다");
    bench.claude.silent = false;
    let second = bench.request("session/new", json!({"cwd": CWD, "mcpServers": []}));
    assert!(bench.result(second)["sessionId"].is_string());
    let dismissed = bench.at(|seen| matches!(seen, Seen::Dismiss));
    let relaunched = bench.seen.iter().rposition(|seen| matches!(seen, Seen::Launch(_))).unwrap();
    assert!(dismissed < relaunched, "거둔 뒤에 새로 띄운다");
}

#[test]
fn 세션이_열린_뒤_claude가_끝나면_변환기도_끝나고_claude가_0으로_끝나도_죽음이다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));
    bench.claude_exits(3);
    assert_eq!(bench.stderr(), ["변환기: claude가 끝났습니다 (exit status: 3)"]);
    assert_eq!(bench.exits(), [3], "호스트가 수신 EOF로 프로세스 죽음을 안다");

    let mut bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));
    bench.claude_exits(0);
    assert_eq!(bench.exits(), [1]);
}

#[test]
fn 호스트가_stdin을_닫으면_claude의_stdin을_닫고_claude가_끝나면_어떻게_끝났든_0으로_끝난다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));

    bench.hang_up();

    assert_eq!(bench.count(|seen| matches!(seen, Seen::Close)), 1);
    assert!(bench.exits().is_empty(), "claude가 끝나기를 기다린다");
    bench.claude_exits(137);
    assert_eq!(bench.exits(), [0], "끄는 중의 끝은 죽음이 아니다");
    assert!(bench.stderr().is_empty());

    // 쥔 claude가 없으면 곧바로 끝난다.
    let mut bench = Bench::new(Claude::replaying("2.1.282/twoturn-tools"));
    bench.hang_up();
    assert_eq!((bench.count(|seen| matches!(seen, Seen::Close)), bench.exits()), (0, vec![0]));
}

#[test]
fn claude를_띄우지_못하거나_cwd가_없으면_열기를_까닭으로_답하고_다음_열기를_받는다() {
    let mut claude = Claude::replaying("2.1.282/twoturn-tools");
    claude.unlaunchable = true;
    let mut bench = Bench::new(claude);
    bench.request("initialize", json!({"protocolVersion": 1}));

    let nowhere = bench.request(
        "session/new",
        json!({"cwd": CWD, "mcpServers": [], "_meta": {"atelier": {"claudePath": "/nowhere/claude"}}}),
    );
    assert_eq!(
        bench.error(nowhere),
        json!({"code": -32603, "message": "claude를 실행할 수 없습니다: /nowhere/claude — No such file or directory (os error 2)"})
    );
    let no_cwd = bench.request("session/new", json!({"mcpServers": []}));
    assert_eq!(bench.error(no_cwd), json!({"code": -32603, "message": "세션을 여는 요청에 cwd가 없습니다"}));
    assert_eq!(bench.launches().len(), 1, "cwd가 없으면 띄우지 않는다");

    bench.claude.unlaunchable = false;
    let opened = bench.request("session/new", json!({"cwd": CWD, "mcpServers": []}));
    assert!(bench.result(opened)["sessionId"].is_string());
    assert_eq!(bench.count(|seen| matches!(seen, Seen::Dismiss)), 0, "거둘 claude가 없었다");
}

#[test]
fn claude에_넣지_못한_말과_바꾸기는_오류로_답하고_턴을_풀어_둔다() {
    let mut bench = Bench::open(Claude::replaying("2.1.282/twoturn-tools"));
    bench.claude_vanishes();

    let first = bench.prompt("첫 말");
    assert_eq!(bench.error(first), json!({"code": -32603, "message": "claude에 말을 넣지 못했습니다"}));
    let model = bench.set_model("sonnet");
    assert_eq!(bench.error(model), json!({"code": -32603, "message": "claude에 바꾸기를 넣지 못했습니다"}));
    // 턴을 풀어 두었다 — 다음 말은 「턴이 도는 중」이 아니라 다시 넣어 보다 같은 까닭으로 답한다.
    let second = bench.prompt("둘째 말");
    assert_eq!(bench.error(second)["message"], "claude에 말을 넣지 못했습니다");
}

#[test]
fn 열린_세션이_없거나_둘째_세션이거나_모르는_메서드면_오류로_답한다() {
    let mut bench = Bench::new(Claude::replaying("2.1.282/twoturn-tools"));
    bench.request("initialize", json!({"protocolVersion": 1}));

    let prompt = bench.prompt("열기 전의 말");
    let mode = bench.set_mode("plan");
    for id in [prompt, mode] {
        assert_eq!(bench.error(id), json!({"code": -32602, "message": "열린 세션이 없습니다"}));
    }
    let unknown = bench.request("session/fork", json!({}));
    assert_eq!(bench.error(unknown), json!({"code": -32601, "message": "Method not found: session/fork"}));

    bench.request("session/new", json!({"cwd": CWD, "mcpServers": []}));
    let second = bench.request("session/new", json!({"cwd": CWD, "mcpServers": []}));
    assert_eq!(
        bench.error(second),
        json!({"code": -32600, "message": "이 변환기는 이미 세션을 열었습니다 — 세션 하나에 변환기 하나다"})
    );
    assert_eq!(bench.launches().len(), 1, "세션 하나 = 변환기 하나 = claude 하나");
}
