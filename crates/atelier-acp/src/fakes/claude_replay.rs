//! 가짜 claude의 녹화 되감기 — 입출력이 없는 몸이다. stdin 줄 하나를 받아 claude가 낼 stdout 줄들을 돌려준다.
//!
//! 두 자리가 같은 몸을 쓴다 — 같은 녹화를 같은 규칙으로 되감는다.
//! - 가짜 claude bin(`src/bin/fake-claude.rs`)은 stdin · stdout · 영수증 · 문(`<세션 id>.go`)을 두르고 L1에 선다.
//! - 변환기 상태 기계의 시험(`src/translator/machine/tests.rs`)은 프로세스 없이 이것을 상대로 놓는다.
//!
//! 되감는 원문은 `tests/fixtures/claude-<판>/`의 것이다 — 진짜 claude가 그 순서로 냈다. 지금 판은 2.1.309다 — v1 티켓 09가 판 02 ·
//! 워크플로 실측의 몰이를 같은 프롬프트 · 같은 폴더 모양으로 다시 돌려 녹음했다(몰이와 가리기는 v1 스펙 `구현-노트/녹음-2.1.309/`).
//! - 띄우자마자: 첫 `system/init` 앞의 줄들(SessionStart 훅의 `hook_started` · `hook_response`). [`Replay::new`]가 돌려준다.
//! - stdin `control_request{subtype:"initialize"}` → `initialize.json`의 응답(요청 id만 바꿔 끼운다). 원문에 든
//!   `control_response`(잰 쪽이 보낸 제어 요청의 답)는 되감지 않는다 — 제어 요청에는 되감기가 스스로 답한다.
//! - stdin user 줄 하나 → 원문의 다음 턴 하나(`system/init` … `result`). 줄의 `session_id`는 받은 세션 id로 바꿔 낸다 —
//!   진짜 claude는 띄울 때 받은 세션 id를 싣는다.
//! - **권한**(three-axes 티켓 15) — 턴의 `control_request{subtype:"can_use_tool"}`(워크플로 관문 G1 `permission-stdio`,
//!   판 02 G1)를 내면 그 요청 id의 stdin `control_response`가 올 때까지 턴을 멈춘다. 답이 deny면 뒤따르는 그 도구의 실패
//!   `tool_result`에 받은 글을 싣는다 — 진짜 claude가 deny의 `message`를 도구 결과로 모델에게 준다. 모르는 요청 id의 답(거둔
//!   요청에 늦게 온 답)은 버린다 — 진짜 claude도 무시한다(워크플로 관문 G1).
//! - **멈추기**(티켓 15) — 녹화에서 interrupt의 답(`control_response{still_queued}`, 워크플로 관문 G2 `interrupt-sigint`)이
//!   있던 자리에서 턴을 멈추고 stdin `control_request{subtype:"interrupt"}`를 기다린다. 오면 그 요청 id로 답하고 녹화의 나머지
//!   (`task_notification` · 실패 `tool_result` · `result/error_during_execution`)를 낸다. 권한 요청이 걸린 채 interrupt가 오면
//!   `control_cancel_request`로 그 요청을 거두고 interrupt에 답한 뒤, 녹화된 interrupt의 실패 `tool_result` · `result`를 그 도구
//!   id로 바꿔 낸다(워크플로 관문 G2 (c)의 모양 — 원문 파일은 없다).
//! - **모델 · 모드 바꾸기**(티켓 15) — stdin `set_model` · `set_permission_mode`에는 판 02 실측 `set-model` ·
//!   `set-permission-mode`에서 같은 값에 claude가 낸 답을 되감는다(모드는 뒤따른 `system/status`까지). 녹화에 없는 모델은
//!   success, 녹화에 없는 모드는 녹화된 `invalid_mode` 오류다.
//! - **스스로 이어 간 턴**(티켓 16, S4) — 원문에서 `result.origin.kind`가 `task-notification`인 턴은 user 줄 없이 낸다. 앞 턴이
//!   다 끝나면 곧바로 이어 낸다(진짜 claude가 백그라운드 작업이 끝나 스스로 도는 턴). [`Hold`]가 있으면 그 자리에서 멈추고
//!   [`Replay::release`]를 기다린다 — 멈춘 동안 받은 줄은 놓인 뒤 받은 차례대로 읽는다.
//! - 되살리기가 실패한 claude(판 02 관문 G4 `g4-resume-missing`)는 initialize에 답하지 않고 [`forgotten_line`] 한 줄을 낸 뒤
//!   끝난다 — 끝은 두르는 쪽의 몫이다.

use std::collections::VecDeque;

use serde_json::{json, Value};

/// stdin `control_request initialize`의 응답 원문(가린 사본) — 판 02 실측 A4의 몰이를 2.1.309로 다시 돌린 것.
const INITIALIZE: &str = include_str!("../../tests/fixtures/claude-2.1.309/initialize.json");
/// 턴을 되감을 원문들(가린 사본) — 이름 → 원문. 이름에 CLI 판을 적는다.
/// - `2.1.309/slash-skill-noreplay` — 슬래시 명령 · 스킬 다섯 턴. 모델이 `Skill`을 부르면 `isSynthetic` user 글이 낀다(판 02 실측 A4).
/// - `2.1.309/slash-skill-replay` — 같은 꼴을 `--replay-user-messages`로 잰 넷. 내장 `/context` · `/cost`의 `<synthetic>` 답이 든다.
/// - `2.1.309/edit-subagent` — `Read` · `Edit`의 한 턴과 서브에이전트(`Agent`)의 한 턴(티켓 14가 잰 것).
/// - `2.1.309/g1-plan-implement` — 계획 모드의 한 턴: `ExitPlanMode`의 `can_use_tool` → 허락 → `system/status{default}` → 구현의
///   `Write`가 묻는 `can_use_tool` → 허락(판 02 관문 G1).
/// - `2.1.309/g1-plan-revise` — 같은 물음을 거부(다시 짜기)한 턴과, 고칠 점을 받아 다시 물은 계획을 허락한 턴(판 02 관문 G1).
/// - `2.1.309/twoturn-tools` — 답만 하는 한 턴과 `Write` · `Read` · `Bash`의 한 턴(워크플로 실측 G3).
/// - `2.1.309/permission-stdio` — 작업 자리 밖 `Write`가 묻는 `can_use_tool`을 허락한 턴과 거부한 턴(워크플로 관문 G1).
/// - `2.1.309/interrupt-sigint` — 오래 도는 `Bash`를 interrupt로 멈춘 턴 · 맥락을 이어 답한 턴 · SIGINT로 끝난 턴(워크플로
///   관문 G2).
/// - `2.1.309/steer-background-subagent` — 턴 도중에 넣은 말이 합쳐진 턴 · 백그라운드 명령을 걸고 끝낸 턴 · 그 작업이 끝나
///   claude가 스스로 이어 간 턴 · 서브에이전트를 interrupt로 멈춘 턴 · 맥락을 이어 답한 턴(워크플로 관문 G7 · G8 · G9).
/// - `2.1.309/g4-background` — 백그라운드 명령을 걸고(그 `Bash`가 `can_use_tool`로 묻는다) 끝낸 턴과, 작업이 끝나 claude가
///   스스로 이어 간 턴 — 그 턴이 `Read` · `Write`로 결과를 `bg.md`에 쓴다(판 02 관문 G4).
/// - `2.1.309/noauth` — 로그인이 안 된 claude의 두 턴: `assistant{error:"authentication_failed"}` → `result{is_error:true}`
///   (판 02 실측 A8).
const FIXTURES: &[(&str, &str)] = &[
    ("2.1.309/slash-skill-noreplay", include_str!("../../tests/fixtures/claude-2.1.309/slash-skill-noreplay.jsonl")),
    ("2.1.309/slash-skill-replay", include_str!("../../tests/fixtures/claude-2.1.309/slash-skill-replay.jsonl")),
    ("2.1.309/edit-subagent", include_str!("../../tests/fixtures/claude-2.1.309/edit-subagent.jsonl")),
    ("2.1.309/g1-plan-implement", include_str!("../../tests/fixtures/claude-2.1.309/g1-plan-implement.jsonl")),
    ("2.1.309/g1-plan-revise", include_str!("../../tests/fixtures/claude-2.1.309/g1-plan-revise.jsonl")),
    ("2.1.309/twoturn-tools", include_str!("../../tests/fixtures/claude-2.1.309/twoturn-tools.jsonl")),
    ("2.1.309/permission-stdio", include_str!("../../tests/fixtures/claude-2.1.309/permission-stdio.jsonl")),
    ("2.1.309/interrupt-sigint", include_str!("../../tests/fixtures/claude-2.1.309/interrupt-sigint.jsonl")),
    (
        "2.1.309/steer-background-subagent",
        include_str!("../../tests/fixtures/claude-2.1.309/steer-background-subagent.jsonl"),
    ),
    ("2.1.309/g4-background", include_str!("../../tests/fixtures/claude-2.1.309/g4-background.jsonl")),
    ("2.1.309/noauth", include_str!("../../tests/fixtures/claude-2.1.309/noauth.jsonl")),
];
/// 판 02 관문 G4 — 없는 세션 id로 `--resume`한 claude가 끝나기 전에 낸 한 줄(`result/error_during_execution{errors}`).
const RESUME_MISSING: &str = include_str!("../../tests/fixtures/claude-2.1.309/g4-resume-missing.jsonl");
/// 판 02 실측 A5(2.1.309로 다시) — `set_model`(값 넷)과 그 답들. 넣은 줄과 낸 줄을 요청 id로 짝짓는다.
const SET_MODEL: (&str, &str) = (
    include_str!("../../tests/fixtures/claude-2.1.309/set-model.stdin.jsonl"),
    include_str!("../../tests/fixtures/claude-2.1.309/set-model.jsonl"),
);
/// 판 02 실측 A7(2.1.309로 다시) — `set_permission_mode`(값 아홉)와 그 답 · 뒤따른 `system/status`.
const SET_PERMISSION_MODE: (&str, &str) = (
    include_str!("../../tests/fixtures/claude-2.1.309/set-permission-mode.stdin.jsonl"),
    include_str!("../../tests/fixtures/claude-2.1.309/set-permission-mode.jsonl"),
);
/// 워크플로 관문 G2(2.1.309로 다시) — interrupt로 멈춘 턴. 권한이 걸린 채 멈춘 턴의 실패 `tool_result` · `result`를 여기서 빌린다.
const INTERRUPT: &str = include_str!("../../tests/fixtures/claude-2.1.309/interrupt-sigint.jsonl");

/// 그 이름(`<CLI 판>/<이름>`)의 원문.
pub fn fixture(name: &str) -> Option<&'static str> {
    FIXTURES.iter().find(|(known, _)| *known == name).map(|(_, recorded)| *recorded)
}

/// 고를 수 있는 원문 이름들.
pub fn fixture_names() -> Vec<&'static str> {
    FIXTURES.iter().map(|(name, _)| *name).collect()
}

/// 원문 글 → JSON 줄들. 빈 줄은 건너뛴다.
pub fn json_lines(text: &str) -> impl Iterator<Item = Value> + '_ {
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).expect("가짜 claude의 원문은 JSON 줄이다"))
}

/// 없는 세션을 되살리라고 받은 claude가 끝나기 전에 낸 줄 — `errors`에 그 세션 id가 든다(판 02 관문 G4).
pub fn forgotten_line(session_id: &str) -> Value {
    let mut line: Value = serde_json::from_str(RESUME_MISSING.lines().next().expect("한 줄")).expect("JSON");
    line["errors"] = json!([format!("No conversation found with session ID: {session_id}")]);
    if line.get("session_id").is_some_and(Value::is_string) {
        line["session_id"] = json!(session_id);
    }
    line
}

/// 스스로 이어 간 턴의 어디서 멈추나 — 백그라운드 작업이 도는 꼴을 시험이 붙잡는다.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Hold {
    /// 그 턴을 시작하기 전(백그라운드 작업이 도는 동안).
    Start,
    /// 그 턴의 `result` 앞.
    Result,
}

/// 되감기를 차리는 것.
pub struct Setup {
    /// 띄울 때 받은 세션 id — 내는 줄의 `session_id`가 된다.
    pub session_id: String,
    /// 있으면 내는 `can_use_tool`마다 `permission_suggestions`를 이 값으로 바꾼다.
    pub suggestions: Option<Value>,
    /// 있으면 내는 `can_use_tool`마다 그 요청을 이 입력의 `AskUserQuestion`으로 바꾼다(v1 티켓 26) — 사람에게 묻는 claude의 녹음이
    /// 없다. 도구 이름과 입력만 바꾸고 요청 id · 도구 id는 녹화 그대로라, 답한 뒤에는 녹화의 그 도구가 이어진다.
    pub question: Option<Value>,
    pub hold: Option<Hold>,
    /// 있으면 `initialize` 응답의 계정 칸(`account.email` · `organization`)에 싣는다 — 실측 원문은 이미 가려져 있어, 가리기를
    /// 재려면 진짜 같은 이메일이 실려 와야 한다.
    pub email: Option<String>,
}

/// 되감을 원문의 한 걸음.
enum Step {
    /// 낼 줄.
    Line(Value),
    /// 녹화에서 interrupt의 답이 있던 자리 — 여기서 멈추고 stdin interrupt를 기다린다.
    AwaitInterrupt,
}

/// 원문의 턴 하나 — 걸음들과, user 줄 없이 claude가 스스로 시작한 턴인가(`result.origin.kind: "task-notification"`).
#[derive(Default)]
struct Turn {
    steps: Vec<Step>,
    spontaneous: bool,
}

/// 원문을 띄우자마자 낼 줄들과 턴들로 가른다 — 턴은 `system/init`에서 시작해 `result`에서 끝난다. 첫 `init` 앞의 줄은
/// 띄우자마자 내고, `result`와 다음 `init` 사이의 줄은 앞 턴에 붙인다. 원문의 `control_response`는 뺀다 — 잰 쪽이 보낸
/// 제어 요청의 답이라, 되감기는 받은 제어 요청에 스스로 답한다. 다만 interrupt의 답(`still_queued`)은 그 자리에 멈춤을 남긴다.
fn fixture_turns(text: &str) -> (Vec<Step>, Vec<Turn>) {
    let mut startup = Vec::new();
    let mut turns: Vec<Turn> = Vec::new();
    let mut open = false;
    for value in json_lines(text) {
        let step = match value["type"].as_str() {
            Some("control_response") if value["response"]["response"].get("still_queued").is_some() => Step::AwaitInterrupt,
            Some("control_response") => continue,
            _ => Step::Line(value.clone()),
        };
        let is_init = value["type"] == "system" && value["subtype"] == "init";
        if is_init && !open {
            turns.push(Turn::default());
            open = true;
        }
        let ends_turn = value["type"] == "result";
        match turns.last_mut() {
            Some(turn) => {
                turn.steps.push(step);
                if ends_turn && value["origin"]["kind"] == "task-notification" {
                    turn.spontaneous = true;
                }
            }
            None => startup.push(step),
        }
        if ends_turn {
            open = false;
        }
    }
    (startup, turns)
}

/// 원문 하나의 되감기 — 남은 턴 · 도는 턴의 남은 걸음 · 멈춰 기다리는 것.
pub struct Replay {
    session_id: String,
    suggestions: Option<Value>,
    question: Option<Value>,
    hold: Option<Hold>,
    email: Option<String>,
    turns: VecDeque<Turn>,
    steps: VecDeque<Step>,
    waiting: Option<Waiting>,
    /// 방금 deny로 답한 도구 — (도구 id, 받은 글). 뒤따르는 그 도구의 실패 결과에 그 글을 싣는다.
    denied: Option<(Value, Value)>,
    /// 도는 턴이 스스로 이어 간 턴인가.
    spontaneous: bool,
    /// [`Hold`]에서 멈췄다 — 놓이면 이어 갈 자리.
    paused: Option<Pause>,
    /// 멈춘 동안 받은 stdin 줄 — 놓인 뒤 받은 차례대로 읽는다.
    pending: VecDeque<Value>,
    /// 낸 줄 — [`Replay::receive`] · [`Replay::release`]가 돌려준다.
    out: Vec<Value>,
}

/// 턴이 멈춰 기다리는 것.
enum Waiting {
    /// 녹화에서 interrupt를 보낸 자리.
    Interrupt,
    /// 낸 권한 요청의 답 — 요청 id와 그 도구 id.
    Permission { request_id: Value, tool_use_id: Value },
}

/// [`Hold`]에서 멈춘 자리.
enum Pause {
    /// 스스로 이어 갈 턴을 시작하기 전.
    Turn(Turn),
    /// 스스로 이어 간 턴의 `result` 앞 — 놓이면 낼 그 줄.
    Result(Value),
}

impl Replay {
    /// 원문 하나를 되감을 준비를 하고, 띄우자마자 낼 줄들을 함께 돌려준다.
    pub fn new(recorded: &str, setup: Setup) -> (Self, Vec<Value>) {
        let (startup, turns) = fixture_turns(recorded);
        let mut replay = Self {
            session_id: setup.session_id,
            suggestions: setup.suggestions,
            question: setup.question,
            hold: setup.hold,
            email: setup.email,
            turns: turns.into(),
            steps: VecDeque::new(),
            waiting: None,
            denied: None,
            spontaneous: false,
            paused: None,
            pending: VecDeque::new(),
            out: Vec::new(),
        };
        for step in startup {
            if let Step::Line(line) = step {
                replay.emit(line);
            }
        }
        let startup = std::mem::take(&mut replay.out);
        (replay, startup)
    }

    /// [`Hold`]에서 멈춰 [`Replay::release`]를 기다린다.
    pub fn paused(&self) -> bool {
        self.paused.is_some()
    }

    /// stdin 줄 하나 → 그 자리에서 낼 줄들. 멈춘 동안이면 받아 두기만 한다.
    pub fn receive(&mut self, message: &Value) -> Vec<Value> {
        if self.paused.is_some() {
            self.pending.push_back(message.clone());
            return Vec::new();
        }
        self.handle(message);
        self.settle();
        std::mem::take(&mut self.out)
    }

    /// 멈춘 자리를 놓는다 — 이어 낸 줄들과, 멈춘 동안 받아 둔 줄을 읽어 낸 줄들.
    pub fn release(&mut self) -> Vec<Value> {
        match self.paused.take() {
            Some(Pause::Turn(turn)) => self.start(turn),
            Some(Pause::Result(line)) => {
                self.emit(line);
                self.run();
            }
            None => {}
        }
        self.settle();
        while self.paused.is_none() {
            let Some(message) = self.pending.pop_front() else { break };
            self.handle(&message);
            self.settle();
        }
        std::mem::take(&mut self.out)
    }

    fn handle(&mut self, message: &Value) {
        let request_id = &message["request_id"];
        match (message["type"].as_str(), message["request"]["subtype"].as_str()) {
            (Some("control_request"), Some("initialize")) => {
                let response = initialize_response(request_id, self.email.as_deref());
                self.emit(response);
            }
            (Some("control_request"), Some("interrupt")) => self.interrupt(request_id),
            (Some("control_request"), Some("set_model")) => {
                let response = set_model_response(&message["request"], request_id);
                self.emit(response);
            }
            (Some("control_request"), Some("set_permission_mode")) => {
                for line in set_permission_mode_response(&message["request"], request_id) {
                    self.emit(line);
                }
            }
            (Some("control_request"), subtype) => self.emit(json!({
                "type": "control_response",
                "response": {"subtype": "error", "request_id": request_id,
                             "error": format!("가짜 claude가 모르는 제어 요청: {}", subtype.unwrap_or("?"))},
            })),
            (Some("control_response"), _) => self.answered(&message["response"]),
            (Some("user"), _) => {
                // 앞 턴이 끝나지 않아 내지 못한 스스로 이어 간 턴은 건너뛰고 사람의 다음 턴을 낸다.
                while self.turns.front().is_some_and(|turn| turn.spontaneous) {
                    self.turns.pop_front();
                }
                let turn = self.turns.pop_front().unwrap_or_default();
                self.start(turn);
            }
            _ => {}
        }
    }

    /// 턴이 다 끝났고 원문의 다음 턴이 스스로 이어 간 턴이면 user 줄 없이 곧바로 낸다(S4). [`Hold::Start`]면 그 앞에서 멈춘다.
    fn settle(&mut self) {
        while self.paused.is_none() && self.idle() && self.turns.front().is_some_and(|turn| turn.spontaneous) {
            let turn = self.turns.pop_front().expect("앞을 봤다");
            if self.hold == Some(Hold::Start) {
                self.paused = Some(Pause::Turn(turn));
                return;
            }
            self.start(turn);
        }
    }

    /// 원문의 다음 턴을 낸다 — 사람의 턴이면 user 줄 하나를 받은 때, 스스로 이어 간 턴이면 앞 턴이 다 끝난 때다.
    fn start(&mut self, turn: Turn) {
        self.steps = turn.steps.into();
        self.spontaneous = turn.spontaneous;
        self.waiting = None;
        self.run();
    }

    /// 도는 턴이 없다 — 낼 걸음도 기다리는 것도 없다.
    fn idle(&self) -> bool {
        self.steps.is_empty() && self.waiting.is_none()
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
                        if let Some(question) = &self.question {
                            line["request"]["tool_name"] = json!("AskUserQuestion");
                            line["request"]["input"] = question.clone();
                        }
                        let request_id = line["request_id"].clone();
                        let tool_use_id = line["request"]["tool_use_id"].clone();
                        self.emit(line);
                        self.waiting = Some(Waiting::Permission { request_id, tool_use_id });
                        return;
                    }
                    self.carry_denial(&mut line);
                    if self.spontaneous && self.hold == Some(Hold::Result) && line["type"] == "result" {
                        self.paused = Some(Pause::Result(line));
                        return;
                    }
                    self.emit(line);
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
                self.emit(answer);
                self.run();
            }
            Some(Waiting::Permission { request_id: asked, tool_use_id }) => {
                // 워크플로 관문 G2 (c) — 걸린 요청을 거두고, 그 도구가 실패하고, 턴이 aborted_tools로 끝난다.
                self.emit(json!({"type": "control_cancel_request", "request_id": asked}));
                self.emit(answer);
                for mut line in interrupted_tail() {
                    for block in line["message"]["content"].as_array_mut().into_iter().flatten() {
                        block["tool_use_id"] = tool_use_id.clone();
                    }
                    self.emit(line);
                }
                self.steps.clear();
            }
            // 도는 턴이 없다 — 답만 한다.
            None => self.emit(answer),
        }
    }

    /// 줄 하나를 낸다 — 줄의 `session_id`를 이 세션의 것으로 바꿔서.
    fn emit(&mut self, mut line: Value) {
        if line.get("session_id").is_some_and(Value::is_string) {
            line["session_id"] = json!(self.session_id);
        }
        self.out.push(line);
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
fn initialize_response(request_id: &Value, email: Option<&str>) -> Value {
    let recorded: Value = serde_json::from_str(INITIALIZE).expect("initialize 원문은 JSON이다");
    let mut response = recorded["response"].clone();
    response["request_id"] = request_id.clone();
    if let Some(email) = email {
        response["response"]["account"]["email"] = json!(email);
        response["response"]["account"]["organization"] = json!(format!("{email}'s Organization"));
    }
    json!({"type": "control_response", "response": response})
}
