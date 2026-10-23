//! Claude 변환기의 상태 기계 — 입력 하나([`Input`]: 호스트의 ACP 메시지 · claude의 줄 · 끝)를 받아 낼 것들([`Output`]: ACP 줄 ·
//! claude stdin 줄 · 띄우기와 거두기 · 끝)을 돌려준다. 입출력은 하지 않는다 — stdio · claude 프로세스 · 스레드는 변환기의
//! 몸통([`super::run_claude_translator`])이 쥔다.
//!
//! 세션 열기(티켓 13) — 띄우기 플래그 · 띄운 직후 stdin `initialize`(S1) · 판 · 가리기.
//! 턴(티켓 14) — `session/prompt` 하나가 stdin user 줄 하나이고, claude의 줄을 ACP `session/update`로 옮기며(몸은
//! [`super::stream`]), `result` 하나가 턴 끝 하나다(`session/prompt`의 답).
//! 제어(티켓 15) — ACP 요청을 claude의 stdin 제어 요청으로, claude의 요청을 ACP 모양으로 옮긴다. 멈추기(`session/cancel` →
//! `interrupt`), 권한(`can_use_tool` ↔ `session/request_permission`), 계획 승인(`ExitPlanMode` → `switch_mode` 요청, S5),
//! 모드 · 모델 바꾸기(`set_permission_mode` · `set_model`)와 claude가 스스로 바꾼 모드(`system/status` → `current_mode_update`).
//! 되살리기(티켓 16) — `session/resume` · `session/load`를 둘 다 `claude … --resume <세션 id>`로 연다(워크플로 S19).
//! 백그라운드(16, S4) · 미로그인(16, S3)은 턴의 갈래([`Turn`])에 있다.
//!
//! **세션 상태는 겹치지 않는 갈래 둘이다.**
//! - 열기([`Open`]) — 없음 · 여는 중 · 열림 · 실패. 실패한 열기는 그 claude를 아직 쥔 채라, 다음 열기가 거두고 새로 띄운다 —
//!   호스트의 되살리기는 resume → load → 새 세션 순으로 같은 변환기에 묻는다(three-axes 티켓 10).
//! - 턴([`Turn`]) — 쉼 · 우리가 넣은 말의 턴 · claude가 스스로 시작한 턴(S4). 걸린 `session/prompt`와 스스로 이어 간 턴은 함께
//!   서지 않고, 미뤄 둔 말은 스스로 이어 간 턴 안에만 있다.
//!
//! **claude의 stdin에 쓸 줄을 낼 뿐 쓰지 않는다.** 쓰는 것은 몸통이다 — claude의 stdout을 비우는 손이 stdin 쓰기에 막히지 않게.
//! 쓰지 못한 줄은 [`Input::Unwritten`]으로 돌려받아, 그것이 말이면 그 말을, 바꾸기면 그 바꾸기를 오류로 답한다.
//!
//! **가리기.** claude의 원문을 처음 읽는 자리가 여기라, 읽자마자 두 자리를 가린다 — 이 뒤로 ACP에 실려 기록으로 가는 것에는
//! 계정이 남지 않는다(워크플로 S34 · 스토리 115). `initialize` 답의 `account`(이메일 · 조직 · 플랜, 워크플로 함정 19)는
//! `<email>`로, `system/init`의 `plugins[].path`(조직 · 계정 id가 실린다, 실측 함정 39)는 `<path>`로 바꾼다.

use std::collections::HashMap;

use serde_json::{json, Value};

use super::agent_flags;
use super::stream::{self, Stream};
use crate::login::AUTH_REQUIRED;
use crate::redact;

/// 모드 다섯 — claude의 모드 이름 그대로다(three-axes 결정 16 · 27). `bypassPermissions`는 띄울 때 허락하지 않았으면 도중에
/// 고를 수 없으므로(`bypass_not_launched`, 실측 함정 38) 넣지 않는다.
const MODES: [&str; 5] = ["default", "acceptEdits", "auto", "dontAsk", "plan"];

/// claude가 미로그인을 알리는 `assistant.error`의 값(실측 함정 32).
const AUTHENTICATION_FAILED: &str = "authentication_failed";

/// 띄운 직후 보내는 stdin `initialize`의 요청 id.
const INITIALIZE_REQUEST: &str = "atelier-initialize";

/// 선택지 id — 한 번 허락 · 이 대화에서 허락 · 거부, 계획은 구현 · 다시 짜기(codex-acp의 계획 승인과 같은 id).
const ALLOW_ONCE: &str = "allow_once";
const ALLOW_SESSION: &str = "allow_session";
const REJECT: &str = "reject";
const IMPLEMENT_PLAN: &str = "implement_plan";
const REVISE_PLAN: &str = "revise_plan";

/// 「거부」에 싣는 글 — claude는 이것을 그 도구의 실패 결과로 받는다. 그 도구 호출 하나만 실패하고 턴은 이어진다(스토리 60) —
/// interrupt 때 claude가 스스로 싣는 「STOP … wait for the user」와 달리 다른 길을 찾게 둔다.
const REJECTED: &str = "The user denied this tool call. Do not retry it as is; continue without it or take a different approach.";

/// 「다시 짜기」에 싣는 글(S5) — 계획 모드에 남아 사람의 다음 말을 기다리게 한다. 진짜 claude 2.1.296은 이 글을 받고 파일을
/// 고치지 않은 채 턴을 끝냈고 계획 모드에 남았다(판 02 관문 G1).
const REVISE: &str = "The user chose to revise this plan instead of implementing it. Stay in plan mode, do not change any files, \
and wait for the user's next message describing what to change.";

/// 거둬진 요청이 아직 claude를 붙잡고 있을 때 싣는 글 — 우리가 멈추지 않았는데 호스트가 요청을 거뒀다(에이전트가 턴을 끝냄).
const WITHDRAWN: &str = "The permission request was withdrawn.";

/// 상태 기계에 드는 것 하나.
pub(super) enum Input {
    /// 호스트가 보낸 ACP 메시지 하나.
    Acp(Value),
    /// 호스트가 변환기의 stdin을 닫았다.
    AcpEnded,
    /// claude의 stdout 줄 하나 — 원문 그대로다(가리기는 상태 기계가 한다).
    Claude(Value),
    /// claude가 끝났다 — 끝난 모양(`exit status: 1` 같은 글)과 종료 코드.
    ClaudeEnded { status: String, code: Option<i32> },
    /// [`Output::Launch`]로 claude를 띄우지 못했다 — 까닭.
    LaunchFailed(String),
    /// [`Output::Claude`]의 줄을 claude의 stdin에 쓰지 못했다 — 그 줄. claude가 끝났거나 stdin을 닫은 뒤다.
    Unwritten(Value),
}

/// 상태 기계가 내는 것 하나 — 낸 차례대로 한다.
#[derive(Debug)]
pub(super) enum Output {
    /// 변환기의 stdout(ACP 선)에 쓸 줄 하나.
    Acp(Value),
    /// claude의 stdin에 쓸 줄 하나.
    Claude(Value),
    /// claude를 띄운다. 쥔 claude가 있으면 앞서 [`Output::Dismiss`]를 낸다.
    Launch(Launch),
    /// 쥔 claude를 거둔다 — stdin을 닫고 [한도](super::CLAUDE_EOF_GRACE)까지 기다린 뒤 끈다. 그 claude의 줄과 끝은 더 들이지 않는다.
    Dismiss,
    /// 끄기 — 쥔 claude의 stdin을 닫는다. claude가 끝나면(한도를 넘기면 꺼서) 그 끝을 [`Input::ClaudeEnded`]로 들인다. 그동안
    /// claude의 줄은 그대로 들인다.
    Close,
    /// 변환기의 stderr에 쓸 줄 하나.
    Stderr(String),
    /// 변환기가 이 종료 코드로 끝난다.
    Exit(i32),
}

/// 띄울 claude 하나 — 실행 파일 · 인자 · 일하는 자리. env는 변환기가 받은 것(호스트가 준 로그인 env) 그대로다.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Launch {
    pub(super) program: String,
    pub(super) args: Vec<String>,
    pub(super) cwd: String,
}

/// 변환기의 세션 하나 — ACP 세션 하나 = 변환기 하나 = `claude` 하나.
#[derive(Default)]
pub(super) struct Machine {
    open: Open,
    turn: Turn,
    /// 이 claude의 stream-json을 옮기는 상태 — 낸 도구 호출과 답한 모델을 기억한다.
    stream: Stream,
    /// 첫 `system/init`을 알렸다. claude는 턴마다 `init`을 다시 내지만 새 세션이 아니다 — 같은 원문을 거듭 싣지 않는다.
    init_announced: bool,
    /// 변환기가 claude에 보낸 제어 요청의 다음 번호(`request_id`의 꼬리).
    next_control: u64,
    /// 변환기가 호스트에 보낸 요청(`session/request_permission`)의 다음 id — 0부터 센다(codex-acp와 같다).
    next_request: u64,
    /// 답을 기다리는 권한 요청 — 호스트 쪽 요청 id → claude가 물은 것.
    asked: HashMap<u64, Asked>,
    /// claude의 답을 기다리는 바꾸기 — 제어 요청 id → 답할 ACP 요청.
    changes: HashMap<String, Change>,
    /// claude의 지금 모드로 아는 것 — `initialize`의 `current_permission_mode`, 바꾸기의 답, `system/status`로 고친다.
    mode: Option<String>,
    /// 모델 설정(`configOptions`의 id `model`) — 모델을 바꾸면 그 `currentValue`를 고쳐 답에 싣는다.
    model_option: Value,
    /// 호스트가 stdin을 닫아 끄는 중이다 — 이 뒤의 claude의 끝은 죽음이 아니다.
    closing: bool,
    /// 되살리지 못한 세션 id와 그 까닭 — claude가 「그런 세션이 없다」고 끝났다. 같은 id의 load는 다시 띄우지 않고 이 까닭으로
    /// 답한다. 변환기가 사는 동안 남는다.
    forgotten: Option<(String, String)>,
    /// 이 입력에 낼 것들.
    out: Vec<Output>,
}

/// 세션 열기의 갈래.
#[derive(Default)]
enum Open {
    /// 쥔 claude가 없다.
    #[default]
    None,
    /// claude를 띄웠고 그 `initialize` 답을 기다린다.
    Opening(Opening),
    /// 세션이 열렸다 — 그 id. 이 뒤로 claude가 끝나면 변환기도 끝난다(호스트가 프로세스 죽음으로 안다).
    Open { session_id: String },
    /// 열기가 실패했다(claude가 열기에 답하지 않고 끝났거나 오류로 답했다). 그 claude를 아직 쥐고 있다.
    Failed,
}

/// 세션을 여는 중인 `session/new` · `session/resume` · `session/load` — claude의 `initialize` 답으로 짓는다.
struct Opening {
    id: Value,
    session_id: String,
    model: Option<String>,
    /// 되살리기(`--resume`)인가 — 답에 `sessionId`를 싣지 않는다(ACP의 resume · load 답 꼴).
    revive: bool,
    /// 띄운 실행 파일 — 띄우지 못한 까닭에 싣는다.
    claude: String,
}

/// 턴의 갈래.
#[derive(Default)]
enum Turn {
    /// 도는 턴이 없다.
    #[default]
    Idle,
    /// 답하지 않은 `session/prompt`의 턴 — claude의 `result`가 오면 그 턴의 끝으로 답한다.
    Ours {
        id: Value,
        /// interrupt를 보냈다 — 그 턴의 `result/error_during_execution`은 우리가 멈춘 끝(`cancelled`)이다.
        interrupted: bool,
        /// 미로그인 오류(`assistant.error:"authentication_failed"`)가 왔다 — 그 턴의 `result`는 `-32000`이다(S3).
        auth_failed: bool,
    },
    /// claude가 백그라운드 작업 알림으로 스스로 시작한 턴(S4) — 걸린 `session/prompt` 없이 `system/init`이 왔다. 그 턴의
    /// `result`가 턴 밖 끝이다.
    Claudes {
        interrupted: bool,
        /// 그 턴이 도는 동안 온 `session/prompt` — 그 턴의 `result` 뒤에 넣는다. 미룬 말은 하나뿐이다.
        held: Option<Held>,
    },
}

/// claude가 물은 권한 하나(`control_request{subtype:"can_use_tool"}`) — 호스트의 답을 claude의 답으로 옮길 재료.
struct Asked {
    /// claude 쪽 요청 id.
    request_id: Value,
    /// claude가 물은 입력 — 허락하면 그대로 돌려준다(`updatedInput`).
    input: Value,
    /// 제안 가운데 `destination:"session"`인 것 — 「이 대화에서 허락」이 돌려주는 전부다(워크플로 함정 3).
    session_suggestions: Vec<Value>,
}

/// 스스로 이어 간 턴 뒤로 미뤄 둔 `session/prompt` — 요청 id와 넣을 user 줄.
struct Held {
    id: Value,
    line: Value,
}

/// claude의 답(`control_response`)을 기다리는 바꾸기 하나 — 답할 ACP 요청 id.
enum Change {
    /// `session/set_mode` → `set_permission_mode`.
    Mode(Value),
    /// `session/set_config_option{model}` → `set_model` — 바꾼 값.
    Model(Value, String),
}

impl Change {
    fn id(&self) -> &Value {
        match self {
            Change::Mode(id) | Change::Model(id, _) => id,
        }
    }
}

impl Machine {
    /// 입력 하나 → 낼 것들.
    pub(super) fn step(&mut self, input: Input) -> Vec<Output> {
        match input {
            Input::Acp(message) => self.acp(&message),
            Input::AcpEnded => self.acp_ended(),
            Input::Claude(line) => self.claude(line),
            Input::ClaudeEnded { status, code } => self.claude_ended(&status, code),
            Input::LaunchFailed(error) => self.launch_failed(&error),
            Input::Unwritten(line) => self.unwritten(&line),
        }
        std::mem::take(&mut self.out)
    }

    // ── 호스트에게서 온 것 ────────────────────────────────────────────────────────────

    fn acp(&mut self, message: &Value) {
        let params = &message["params"];
        // id가 없으면 알림이다 — 받는 알림은 멈추기 하나다.
        let Some(id) = message.get("id").cloned() else {
            if message["method"] == "session/cancel" && self.holds_claude() {
                self.cancel();
            }
            return;
        };
        let Some(method) = message["method"].as_str() else {
            // 메서드 없이 id만 있으면 변환기가 보낸 요청(권한)의 답이다.
            if self.holds_claude() {
                self.answer(&id, message);
            }
            return;
        };
        match method {
            "initialize" => self.send(reply(&id, initialize_result())),
            "session/prompt" if self.holds_claude() => self.prompt(&id, params),
            "session/set_mode" | "session/set_config_option" if self.holds_claude() => self.change(&id, method, params),
            "session/prompt" | "session/set_mode" | "session/set_config_option" => {
                self.send(error(&id, -32602, "열린 세션이 없습니다"));
            }
            "session/new" | "session/resume" | "session/load" => self.open_session(&id, method, params),
            method => self.send(error(&id, -32601, &format!("Method not found: {method}"))),
        }
    }

    /// claude 하나를 쥐고 있다 — 여는 중이든 열렸든 열기가 실패했든.
    fn holds_claude(&self) -> bool {
        !matches!(self.open, Open::None)
    }

    /// `session/new` · `session/resume` · `session/load` — claude를 띄우고 stdin `initialize`를 보낸다(S1, three-axes 결정 27).
    /// 답은 claude의 `initialize` 답에서 한다([`Machine::opened`]).
    ///
    /// 받는 것(`params`): `cwd` · `additionalDirectories`(함께 여는 폴더) · `mcpServers` ·
    /// `_meta.atelier{claudePath, permissionMode, model, effort, instructionsFile, builtinTools, forbid}`.
    ///
    /// Agent 정의에서 오는 것(v1 구현 스펙 §3 · S4) — 지시문은 Thread 폴더에 둔 정의 스냅숏 파일의 경로로 받아
    /// `--append-system-prompt-file`로 claude의 기본 시스템 프롬프트 **뒤에** 붙인다(바꾸면 Claude Code의 도구 · 환경 안내가
    /// 사라진다). 모델 · 생각 깊이는 `--model` · `--effort`다. 변환기는 그 파일을 읽지 않고 값을 고르지도 않는다 — 비우면 플래그를
    /// 주지 않아 claude의 기본값을 쓴다.
    ///
    /// 내장 도구 · 금지(v1 티켓 12)는 추상 이름으로 받아 Claude Code의 이름으로 옮긴다([`agent_flags`]) — `--tools` ·
    /// `--disallowedTools`다. ACP `mcpServers`는 claude의 MCP 설정으로 옮겨 `--mcp-config`로 넘긴다 — 사용자 MCP와 커넥터는 그와
    /// 함께 `claude -p`가 스스로 붙인다(three-axes 결정 23). 모르는 추상 도구나 stdio가 아닌 MCP 서버면 띄우지 않고 그 까닭으로
    /// 답한다.
    ///
    /// resume · load는 되살리기다(티켓 16) — `--session-id` 대신 `--resume <그 id>`로 띄운다. 모드 · 모델 · 생각 깊이 · 지시문 ·
    /// 도구 · 금지 · MCP는 새 대화와 같이 받은 값을 플래그로 준다 — `-p --resume`은 이것들을 되살리지 않으므로 열 때마다 다시 받고,
    /// Codex처럼 열린 뒤에 다시 넣지 않는다(three-axes 결정 27). claude는 같은 세션 id로 이어 가고 지난 대화를
    /// 다시 흘리지 않는다. 그런 세션이 없으면 claude가 initialize에 답하지 않고 끝나고(판 02 관문 G4), 그 요청은 오류로 답한다 —
    /// 호스트는 다음 단계로 넘어간다.
    fn open_session(&mut self, id: &Value, method: &str, params: &Value) {
        // 앞선 열기가 실패했으면(되살릴 세션이 없어 claude가 끝났다) 그 claude를 거두고 다음 열기를 받는다 — 호스트의
        // 되살리기는 resume → load → 새 세션 순으로 같은 변환기에 묻는다(three-axes 티켓 10).
        if matches!(self.open, Open::Failed) {
            self.open = Open::None;
            self.out.push(Output::Dismiss);
        }
        let revive = (method != "session/new").then(|| params["sessionId"].as_str().unwrap_or_default().to_owned());
        if self.holds_claude() {
            return self.send(error(id, -32600, "이 변환기는 이미 세션을 열었습니다 — 세션 하나에 변환기 하나다"));
        }
        if let Some(reason) = revive.as_deref().and_then(|revive| self.forgotten(revive)) {
            // 방금 resume으로 없다는 답을 받은 그 세션이다 — load도 같은 `--resume`이라 claude를 다시 띄우지 않는다.
            return self.send(error(id, -32603, &reason));
        }
        let Some(cwd) = params["cwd"].as_str() else {
            return self.send(error(id, -32603, "세션을 여는 요청에 cwd가 없습니다"));
        };
        let atelier = &params["_meta"]["atelier"];
        let claude = atelier["claudePath"].as_str().unwrap_or("claude").to_owned();
        let mode = atelier["permissionMode"].as_str();
        let model = atelier["model"].as_str();
        let effort = atelier["effort"].as_str();
        let instructions = atelier["instructionsFile"].as_str();
        let tools = agent_flags::tools(&atelier["builtinTools"]);
        let mcp_config = agent_flags::mcp_config(&params["mcpServers"]);
        let (tools, mcp_config) = match (tools, mcp_config) {
            (Ok(tools), Ok(mcp_config)) => (tools, mcp_config),
            (Err(reason), _) | (_, Err(reason)) => return self.send(error(id, -32602, &reason)),
        };
        let disallowed = agent_flags::disallowed(&atelier["forbid"]);
        let reviving = revive.is_some();
        let session_id = revive.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let mut args: Vec<&str> = vec![
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--permission-prompt-tool",
            "stdio",
            if reviving { "--resume" } else { "--session-id" },
            &session_id,
        ];
        for dir in params["additionalDirectories"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            args.extend(["--add-dir", dir]);
        }
        // 「엔진 기본값」이면 주지 않는다 — 사용자의 `defaultMode` · 모델 설정을 물려받는다(three-axes 결정 16).
        if let Some(mode) = mode {
            args.extend(["--permission-mode", mode]);
        }
        if let Some(model) = model {
            args.extend(["--model", model]);
        }
        if let Some(effort) = effort {
            args.extend(["--effort", effort]);
        }
        if let Some(instructions) = instructions {
            args.extend(["--append-system-prompt-file", instructions]);
        }
        if let Some(tools) = &tools {
            args.extend(["--tools", tools]);
        }
        if let Some(disallowed) = &disallowed {
            args.extend(["--disallowedTools", disallowed]);
        }
        if let Some(mcp_config) = &mcp_config {
            args.extend(["--mcp-config", mcp_config]);
        }
        let launch = Launch { program: claude.clone(), args: args.into_iter().map(str::to_owned).collect(), cwd: cwd.to_owned() };

        // 새 claude의 세션 — 상태를 처음으로 돌린다. 되살리지 못한 세션은 기억한다.
        *self = Machine { forgotten: self.forgotten.take(), out: std::mem::take(&mut self.out), ..Machine::default() };
        self.open = Open::Opening(Opening { id: id.clone(), session_id, model: model.map(str::to_owned), revive: reviving, claude });
        self.out.push(Output::Launch(launch));
        // 쓰지 못했으면 claude가 이미 끝난 것이다 — 그 끝([`Input::ClaudeEnded`])에서 이 요청에 답한다.
        self.to_claude(json!({"type": "control_request", "request_id": INITIALIZE_REQUEST, "request": {"subtype": "initialize"}}));
    }

    /// 그 세션 id를 방금 되살리지 못했으면 그 까닭.
    fn forgotten(&self, session_id: &str) -> Option<String> {
        self.forgotten.as_ref().filter(|(id, _)| id == session_id).map(|(_, reason)| reason.clone())
    }

    /// `session/prompt` 하나 = stdin user 줄 하나. 첫 말도 `system/init`을 기다리지 않고 넣는다(워크플로 함정 6) — init은
    /// 첫 user 줄을 받은 뒤에야 온다. 깨진 줄 하나가 claude를 끝내므로 변환기가 지은 봉투만 쓴다(워크플로 함정 4).
    ///
    /// - 턴 도중의 둘째 말은 stdin에 쓰지 않고 오류로 답한다 — 쓰면 그 턴에 합쳐진다(three-axes 결정 20). 대기 줄은 호스트가
    ///   쥔다.
    /// - claude가 스스로 이어 간 턴(S4)이 도는 동안 온 말은 그 턴의 `result`까지 미뤄 두었다가 넣는다(워크플로 티켓 09) —
    ///   호스트가 그 턴의 시작을 알기 전에 보낸 말이다. 미룬 말은 하나뿐이다.
    /// - 여기서는 답하지 않는다 — 그 턴의 `result`에서 답한다.
    fn prompt(&mut self, id: &Value, params: &Value) {
        match &mut self.turn {
            Turn::Ours { .. } | Turn::Claudes { held: Some(_), .. } => {
                self.send(error(id, -32603, "턴이 도는 중입니다 — 턴 도중의 말은 그 턴에 합쳐지므로 넣지 않습니다"));
            }
            Turn::Claudes { held, .. } => *held = Some(Held { id: id.clone(), line: user_line(params) }),
            Turn::Idle => {
                // 넣기 전에 걸어 둔다 — claude는 user 줄을 받아야 답하므로 `result`가 이보다 먼저 올 수 없다.
                self.turn = Turn::Ours { id: id.clone(), interrupted: false, auth_failed: false };
                self.to_claude(user_line(params));
            }
        }
    }

    /// `session/cancel` — 도는 턴을 stdin `control_request interrupt`로 멈춘다. SIGINT는 쓰지 않는다 — claude가 끝난다(워크플로
    /// 함정 5). claude는 약 10ms 안에 열린 도구를 실패로 닫고 `result/error_during_execution`으로 턴을 끝내며, 프로세스는
    /// 살아 다음 말이 맥락을 잇는다(워크플로 관문 G2). 그 `result`가 이 턴의 `cancelled`다. 도는 턴이 없거나 이미 보냈으면
    /// 아무것도 하지 않는다.
    ///
    /// claude가 스스로 이어 간 턴(S4)도 같은 interrupt로 멈춘다 — 그 턴의 턴 밖 끝이 `cancelled`다. 그 턴 뒤로 미뤄 둔 말은
    /// 넣지 않고 곧바로 `cancelled`로 답한다 — 사람은 아직 claude에 닿지 않은 그 말의 턴을 멈춘 것이다.
    fn cancel(&mut self) {
        let interrupted = match &mut self.turn {
            Turn::Idle => return,
            Turn::Ours { interrupted, .. } => interrupted,
            Turn::Claudes { interrupted, held } => {
                if let Some(held) = held.take() {
                    self.out.push(Output::Acp(reply(&held.id, json!({"stopReason": "cancelled"}))));
                }
                interrupted
            }
        };
        if std::mem::replace(interrupted, true) {
            return;
        }
        let request_id = self.control_id();
        self.to_claude(json!({"type": "control_request", "request_id": request_id, "request": {"subtype": "interrupt"}}));
    }

    /// 호스트가 권한 요청에 답했다 — claude의 `can_use_tool`에 답한다(stdin `control_response`).
    ///
    /// - 한 번 허락 · 구현 → allow와 claude가 물은 입력 그대로.
    /// - 이 대화에서 허락 → 거기에 `destination:"session"`인 제안만 `updatedPermissions`로(워크플로 함정 3) — 설정 파일에 쓰는
    ///   제안(`localSettings` · `userSettings`)은 돌려주지 않는다(스토리 63).
    /// - 거부 → deny와 [`REJECTED`], 다시 짜기 → deny와 [`REVISE`].
    /// - 거둬짐(`cancelled`) — 우리가 interrupt를 보낸 턴이면 claude가 스스로 그 요청을 거둔다(`control_cancel_request`, 워크플로
    ///   관문 G2 (c)) — 답하지 않는다. 아니면 claude가 붙잡혀 있지 않게 deny로 답한다.
    /// - claude가 이미 거둔 요청(`control_cancel_request`)의 답은 버린다.
    fn answer(&mut self, id: &Value, message: &Value) {
        let Some(asked) = id.as_u64().and_then(|id| self.asked.remove(&id)) else { return };
        let outcome = &message["result"]["outcome"];
        let allow = || json!({"behavior": "allow", "updatedInput": asked.input});
        let deny = |text: &str| json!({"behavior": "deny", "message": text});
        let decision = match (outcome["outcome"].as_str(), outcome["optionId"].as_str()) {
            (Some("selected"), Some(ALLOW_ONCE | IMPLEMENT_PLAN)) => allow(),
            (Some("selected"), Some(ALLOW_SESSION)) => {
                let mut decision = allow();
                decision["updatedPermissions"] = Value::Array(asked.session_suggestions.clone());
                decision
            }
            (Some("selected"), Some(REVISE_PLAN)) => deny(REVISE),
            (Some("selected"), _) => deny(REJECTED),
            _ if self.interrupted() => return,
            _ => deny(WITHDRAWN),
        };
        self.to_claude(json!({
            "type": "control_response",
            "response": {"subtype": "success", "request_id": asked.request_id, "response": decision},
        }));
    }

    /// 도는 턴에 interrupt를 보냈나.
    fn interrupted(&self) -> bool {
        matches!(self.turn, Turn::Ours { interrupted: true, .. } | Turn::Claudes { interrupted: true, .. })
    }

    /// 모드 · 모델 바꾸기 — `session/set_mode{modeId}` → stdin `set_permission_mode{mode}`, `session/set_config_option{configId:
    /// "model", value}` → stdin `set_model{model}`(three-axes 결정 16 · 27). 답은 claude의 `control_response`를 받아 한다 — 거절이면
    /// claude가 준 까닭으로(`bypass_not_launched` · `catalog_unknown` 등, 실측 A5 · A7).
    ///
    /// - 모델 `default`(엔진 기본값)는 값 없는 `set_model`이다 — claude가 사용자의 기본 모델로 돌린다(실측 2.1.296).
    /// - Claude에 없는 설정(Codex의 「계획」 `collaboration_mode` 등)은 오류다 — Claude의 계획은 모드 `plan`이다(three-axes
    ///   결정 29).
    fn change(&mut self, id: &Value, method: &str, params: &Value) {
        let value = |key: &str| params[key].as_str().map(str::to_owned);
        let (change, request) = match (method, params["configId"].as_str()) {
            ("session/set_mode", _) => {
                let Some(mode) = value("modeId") else { return self.send(error(id, -32602, "modeId가 없습니다")) };
                (Change::Mode(id.clone()), json!({"subtype": "set_permission_mode", "mode": mode}))
            }
            (_, Some("model")) => {
                let Some(model) = value("value") else { return self.send(error(id, -32602, "value가 없습니다")) };
                let mut request = json!({"subtype": "set_model"});
                if model != "default" {
                    request["model"] = json!(model);
                }
                (Change::Model(id.clone(), model), request)
            }
            (_, config) => {
                return self.send(error(id, -32602, &format!("Claude에는 그 설정이 없습니다: {}", config.unwrap_or("(없음)"))));
            }
        };
        let request_id = self.control_id();
        self.changes.insert(request_id.clone(), change);
        self.to_claude(json!({"type": "control_request", "request_id": request_id, "request": request}));
    }

    /// 호스트가 stdin을 닫았다 — 쥔 claude가 있으면 그 stdin을 닫고 끝을 기다린다. 없으면 곧바로 끝난다.
    fn acp_ended(&mut self) {
        if self.holds_claude() {
            self.closing = true;
            self.out.push(Output::Close);
        } else {
            self.out.push(Output::Exit(0));
        }
    }

    // ── claude에게서 온 것 ────────────────────────────────────────────────────────────

    /// claude의 stdout 줄 하나.
    fn claude(&mut self, mut line: Value) {
        mask(&mut line);
        if line["type"] == "control_response" && line["response"]["request_id"] == INITIALIZE_REQUEST {
            if let Some(opening) = self.take_opening() {
                self.opened(opening, &line["response"]);
            }
        } else if line["type"] == "control_response" {
            self.changed(&line["response"]);
        } else if line["type"] == "system" && line["subtype"] == "status" {
            self.mode_changed(&line);
        } else if line["type"] == "control_request" && line["request"]["subtype"] == "can_use_tool" {
            self.ask_permission(&line);
        } else if line["type"] == "control_cancel_request" {
            // claude가 묻던 것을 거뒀다(interrupt 때, 워크플로 관문 G2 (c)) — 호스트의 늦은 답을 claude에 옮기지 않는다.
            // 호스트의 「거둬짐」은 멈추기(우리가 끊음)나 턴 끝(에이전트)이 적는다.
            self.asked.retain(|_, asked| asked.request_id != line["request_id"]);
        } else if line["type"] == "system" && line["subtype"] == "init" {
            self.self_turn_started();
            self.announce_init(line);
        } else if line["type"] == "result" && matches!(self.open, Open::Opening(_)) {
            // 세션이 열리기 전의 `result` — 되살릴 세션이 없어 claude가 initialize에 답하지 않고 끝난다(판 02 관문 G4).
            self.not_opened(&line);
        } else if line["type"] == "result" {
            self.turn_ended(&line);
        } else if line["type"] == "assistant" && line["error"] == AUTHENTICATION_FAILED {
            // S3 — 로그인이 안 된 claude의 `<synthetic>` 오류(실측 함정 32 · 33). 답으로 옮기지 않는다 — 내장 명령의
            // `<synthetic>` 답과는 `error` 키로 가른다. 그 턴의 `result`가 `-32000`이 된다.
            if let Turn::Ours { auth_failed, .. } = &mut self.turn {
                *auth_failed = true;
            }
        } else {
            let updates = self.stream.updates(&line);
            self.forward(updates);
        }
    }

    /// 여는 중이면 그 열기를 꺼낸다 — 열기의 갈래는 비운 채 둔다(부르는 쪽이 다음 갈래를 정한다).
    fn take_opening(&mut self) -> Option<Opening> {
        match std::mem::take(&mut self.open) {
            Open::Opening(opening) => Some(opening),
            other => {
                self.open = other;
                None
            }
        }
    }

    /// claude가 `initialize`에 답했다 — 세션을 여는 요청에 답하고, 명령 목록을 알린다. 답이 먼저 나가야 호스트의 기록에서
    /// 「열림」이 명령 목록보다 앞에 선다.
    fn opened(&mut self, opening: Opening, response: &Value) {
        if response["subtype"] != "success" {
            let reason = format!("claude가 initialize에 오류로 답했습니다: {}", response["error"]);
            self.send(error(&opening.id, -32603, &reason));
            self.open = Open::Failed;
            return;
        }
        let init = &response["response"];
        let current_mode = init["current_permission_mode"].as_str().unwrap_or("default");
        let model_options: Vec<Value> = init["models"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|model| {
                let value = model["value"].clone();
                let name = model.get("displayName").cloned().unwrap_or_else(|| value.clone());
                json!({"value": value, "name": name, "description": model["description"]})
            })
            .collect();
        let model_option = json!({
            "id": "model",
            "name": "Model",
            "description": "Claude가 이 대화에 쓰는 모델",
            "category": "model",
            "type": "select",
            "currentValue": opening.model.as_deref().unwrap_or("default"),
            "options": model_options,
        });
        let mut result = json!({
            "sessionId": opening.session_id,
            "modes": {
                "currentModeId": current_mode,
                "availableModes": MODES.iter().map(|mode| json!({"id": mode, "name": mode})).collect::<Vec<_>>(),
            },
            // S1 — 모델 목록은 codex-acp와 같은 모양(`configOptions`의 id `model`)으로 낸다. 화면이 엔진을 가리지 않고 모델 칩을
            // 짓는다. 「엔진 기본값」이면 claude의 `default`(사용자의 모델 설정)다.
            "configOptions": [model_option.clone()],
            // claude의 `initialize` 답 원문(계정 칸은 가렸다) — claude의 판 · 지금 모드 · 에이전트 목록이 든다. 호스트가 열림 줄에
            // 싣는다(평가의 재료, three-axes 결정 18).
            "_meta": {"claudeCode": {"initialize": init}},
        });
        if opening.revive {
            // ACP의 resume · load 답에는 세션 id가 없다 — 부른 쪽이 준 id 그대로다.
            result.as_object_mut().expect("객체").remove("sessionId");
        }
        let commands: Vec<Value> = init["commands"].as_array().into_iter().flatten().map(command).collect();
        self.send(reply(&opening.id, result));
        self.send(session_update(
            &opening.session_id,
            json!({"sessionUpdate": "available_commands_update", "availableCommands": commands}),
        ));
        self.open = Open::Open { session_id: opening.session_id };
        self.mode = Some(current_mode.to_owned());
        self.model_option = model_option;
    }

    /// 열린 세션의 id.
    fn session_id(&self) -> Option<String> {
        match &self.open {
            Open::Open { session_id } => Some(session_id.clone()),
            _ => None,
        }
    }

    /// claude의 첫 `system/init` — 세션 정보(`session_info_update`)의 `_meta`에 원문을 싣는다. 쓰는 모델 · 도구 · MCP 서버의 상태 ·
    /// 플러그인이 든다 — 화면은 그리지 않고 기록이 평가의 재료로 남긴다(three-axes 결정 18). 둘째부터는 싣지 않는다.
    fn announce_init(&mut self, init: Value) {
        let Some(session_id) = self.session_id().filter(|_| !self.init_announced) else { return };
        self.init_announced = true;
        self.send(session_update(&session_id, json!({"sessionUpdate": "session_info_update", "_meta": {"claudeCode": {"init": init}}})));
    }

    /// `system/init` — claude가 턴 하나를 시작한다. 걸린 `session/prompt`가 없으면 claude가 백그라운드 작업 알림으로 스스로 시작한
    /// 턴이다(S4, 판 02 관문 G4) — 호스트에 턴 밖 턴의 시작을 알린다. 호스트는 그 끝까지 대기 줄을 보내지 않고, 끝에서 고친 곳을
    /// 견준다. 이 턴의 줄은 턴 밖 `session/update`로 그대로 흐른다.
    fn self_turn_started(&mut self) {
        let Some(session_id) = self.session_id() else { return };
        if !matches!(self.turn, Turn::Idle) {
            return;
        }
        self.turn = Turn::Claudes { interrupted: false, held: None };
        self.send(out_of_turn(&session_id, json!({"state": "started"})));
    }

    /// claude가 바꾸기에 답했다(`control_response`) — 기다리던 ACP 요청에 답한다. 거절이면 claude가 준 까닭과 오류 코드로.
    /// 모드는 claude가 답한 값(`manual` → `default`)을 지금 모드로 적는다 — 뒤따르는 `system/status`가 그 메아리라 옮기지 않는다.
    fn changed(&mut self, response: &Value) {
        let Some(change) = response["request_id"].as_str().and_then(|id| self.changes.remove(id)) else { return };
        let (id, model) = match change {
            Change::Mode(id) => (id, None),
            Change::Model(id, model) => (id, Some(model)),
        };
        if response["subtype"] != "success" {
            let reason = response["error"].as_str().unwrap_or("claude가 바꾸기를 거절했습니다");
            return self.send(error_with_data(&id, -32602, reason, json!({"errorCode": response["error_code"]})));
        }
        match model {
            None => {
                if let Some(mode) = response["response"]["mode"].as_str() {
                    self.mode = Some(mode.to_owned());
                }
                self.send(reply(&id, json!({})));
            }
            Some(model) => {
                self.model_option["currentValue"] = json!(model);
                let options = json!({"configOptions": [self.model_option]});
                self.send(reply(&id, options));
            }
        }
    }

    /// `system/status{permissionMode}` — claude의 모드가 바뀌었다. 우리가 아는 모드와 다르면 claude가 스스로 바꾼 것이다(계획을
    /// 승인하면 `default`로 간다, 판 02 관문 G1) — `current_mode_update`로 알린다. 우리가 바꾼 모드의 메아리는 옮기지 않는다 —
    /// 사람이 바꾼 값은 호스트가 `config` 줄로 이미 적었다.
    fn mode_changed(&mut self, status: &Value) {
        let Some(mode) = status["permissionMode"].as_str() else { return };
        if self.mode.as_deref() == Some(mode) {
            return;
        }
        self.mode = Some(mode.to_owned());
        let Some(session_id) = self.session_id() else { return };
        self.send(session_update(&session_id, json!({"sessionUpdate": "current_mode_update", "currentModeId": mode})));
    }

    /// claude의 `can_use_tool` → 호스트에 `session/request_permission`. 호스트는 수신을 막지 않고 사람의 답을 기다린다(티켓 08).
    ///
    /// - 도구 요지(`toolCall`)는 앞서 낸 `tool_call`과 같은 id(`tool_use_id`) · 제목 · 종류에, claude가 물은 입력이다. 그 `_meta.claudeCode`
    ///   에는 도구 이름과 까닭(`decision_reason` → `decisionReason`)을 싣는다 — 승인 카드가 읽는 자리다(스토리 58, 티켓 21). claude가
    ///   물은 원문 전체(설명 · 막힌 경로 · 제안)는 요청의 `_meta.claudeCode.request`에 남긴다(평가의 재료, three-axes 결정 18).
    /// - 선택지는 변환기가 짓는다 — 한 번 허락 · 이 대화에서 허락 · 거부. 세션 제안이 없으면 「이 대화에서 허락」은 없다.
    /// - **계획 승인(S5)** — 계획 모드의 `ExitPlanMode`도 `can_use_tool`로 온다(판 02 관문 G1). codex-acp의 계획 승인과 같은
    ///   모양(`toolCall{kind:"switch_mode", rawInput:{plan}}`, 선택지 구현 · 다시 짜기)으로 옮긴다 — 화면은 엔진을 가리지 않고
    ///   「이 계획대로 할까요?」 카드를 세우고, 계획 본문(`input.plan`)이 계획 카드가 된다.
    fn ask_permission(&mut self, line: &Value) {
        let request = &line["request"];
        let tool = request["tool_name"].as_str().unwrap_or_default();
        let input = &request["input"];
        let option = |id: &str, name: &str, kind: &str| json!({"optionId": id, "name": name, "kind": kind});
        if tool == "ExitPlanMode" {
            let tool_call = json!({
                "toolCallId": request["tool_use_id"],
                "kind": "switch_mode",
                "status": "pending",
                "title": "Implement this plan?",
                "rawInput": {"plan": input["plan"]},
                "_meta": {"claudeCode": {"toolName": tool}},
            });
            let options = vec![
                option(IMPLEMENT_PLAN, "Yes, implement this plan", "allow_once"),
                option(REVISE_PLAN, "No, and tell Claude what to do differently", "reject_once"),
            ];
            return self.request_permission(line, tool_call, options, Vec::new());
        }
        let session_suggestions: Vec<Value> = request["permission_suggestions"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|suggestion| suggestion["destination"] == "session")
            .cloned()
            .collect();
        let mut options = vec![option(ALLOW_ONCE, "Yes", "allow_once")];
        if !session_suggestions.is_empty() {
            options.push(option(ALLOW_SESSION, "Yes, and don't ask again this conversation", "allow_always"));
        }
        options.push(option(REJECT, "No, and tell Claude what to do differently", "reject_once"));
        let mut meta = json!({"toolName": tool});
        if let Some(reason) = request["decision_reason"].as_str() {
            meta["decisionReason"] = json!(reason);
        }
        let tool_call = json!({
            "toolCallId": request["tool_use_id"],
            "title": stream::title(tool, input),
            "kind": stream::kind(tool),
            "status": "pending",
            "rawInput": input,
            "_meta": {"claudeCode": meta},
        });
        self.request_permission(line, tool_call, options, session_suggestions);
    }

    /// 호스트에 `session/request_permission`을 보내고, 답을 claude에 옮길 재료를 챙겨 둔다.
    fn request_permission(&mut self, line: &Value, tool_call: Value, options: Vec<Value>, session_suggestions: Vec<Value>) {
        let request = &line["request"];
        let Some(session_id) = self.session_id() else { return };
        let id = self.next_request;
        self.next_request += 1;
        let input = request["input"].clone();
        self.asked.insert(id, Asked { request_id: line["request_id"].clone(), input, session_suggestions });
        self.send(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "session/request_permission",
            "params": {"sessionId": session_id, "toolCall": tool_call, "options": options,
                       "_meta": {"claudeCode": {"request": request}}},
        }));
    }

    /// 턴의 줄을 옮긴 `session/update`들을 낸다. 세션이 열리기 전이면(띄운 직후의 훅 줄) 낼 곳이 없다.
    fn forward(&mut self, updates: Vec<Value>) {
        if updates.is_empty() {
            return;
        }
        let Some(session_id) = self.session_id() else { return };
        for update in updates {
            self.send(session_update(&session_id, update));
        }
    }

    /// claude의 `result` — 턴 끝 하나다. 사용량을 알리고, 걸린 `session/prompt`에 끝 까닭으로 답한다. 둘째 턴부터 다시 오는
    /// `system/init`은 새 세션이 아니므로 턴은 같은 세션에서 이어진다.
    ///
    /// - 백그라운드 작업이 남아도 여기서 턴을 끝낸다(S4) — 워크플로 티켓 09의 「한 턴으로 접기」는 하지 않는다. 사람이 dev 서버처럼
    ///   오래 사는 작업 뒤에 갇히지 않는다.
    /// - 걸린 `session/prompt`가 없는 `result`는 claude가 스스로 이어 간 턴의 끝이다 — `_meta.atelier.outOfTurn`으로 표시한 턴 밖
    ///   끝 알림(`session_info_update`)을 낸다. 몸은 `session/prompt`의 답과 같은 꼴이다. 그 턴 뒤로 미뤄 둔 말이 있으면 이제 넣는다.
    fn turn_ended(&mut self, result: &Value) {
        let Some(session_id) = self.session_id() else { return };
        if let Some(usage) = self.stream.usage(result) {
            self.send(session_update(&session_id, usage));
        }
        let (interrupted, held) = match std::mem::take(&mut self.turn) {
            Turn::Ours { id, interrupted, auth_failed } => {
                if auth_failed {
                    // S3 — codex-acp와 같은 모양이라 호스트가 엔진을 가리지 않고 로그인 필요 줄 · 안내 카드로 옮긴다(three-axes 결정 30).
                    let data = json!({"claudeCode": {"result": result}});
                    self.send(error_with_data(&id, AUTH_REQUIRED, "Authentication required", data));
                } else {
                    self.send(reply(&id, stream::prompt_response(result, interrupted)));
                }
                return;
            }
            Turn::Claudes { interrupted, held } => (interrupted, held),
            Turn::Idle => (false, None),
        };
        let response = stream::prompt_response(result, interrupted);
        self.send(out_of_turn(&session_id, json!({"state": "ended", "response": response})));
        let Some(held) = held else { return };
        self.turn = Turn::Ours { id: held.id, interrupted: false, auth_failed: false };
        self.to_claude(held.line);
    }

    /// 세션이 열리기 전에 claude가 `result`를 냈다 — 열지 못한 것이다. 되살리기면 claude가 준 까닭(「그런 세션이 없다」)으로 그
    /// 요청에 답하고, 같은 id의 다음 단계(load)가 claude를 다시 띄우지 않게 기억한다.
    fn not_opened(&mut self, result: &Value) {
        let Some(opening) = self.take_opening() else { return };
        let errors: Vec<&str> = result["errors"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
        let why = if errors.is_empty() { result["subtype"].as_str().unwrap_or("result").to_owned() } else { errors.join(" · ") };
        let reason = if opening.revive {
            format!("claude가 세션을 되살리지 못했습니다: {why}")
        } else {
            format!("claude가 세션을 열지 못했습니다: {why}")
        };
        self.send(error(&opening.id, -32603, &reason));
        self.open = Open::Failed;
        if opening.revive {
            self.forgotten = Some((opening.session_id, reason));
        }
    }

    /// claude가 끝났다.
    /// - 끄는 중이면 변환기도 끝난다(0).
    /// - 세션을 여는 중이면 그 요청에 오류로 답한다 — 호스트가 열기 실패로 받고 변환기를 끄거나 다음 열기를 묻는다.
    /// - 세션이 열린 뒤면 변환기도 끝난다 — 호스트가 수신 EOF로 프로세스 죽음을 안다. claude의 stderr는 이미 흘렸다.
    fn claude_ended(&mut self, status: &str, code: Option<i32>) {
        if self.closing {
            return self.out.push(Output::Exit(0));
        }
        if let Some(opening) = self.take_opening() {
            self.send(error(&opening.id, -32603, &format!("claude가 initialize에 답하지 않고 끝났습니다 ({status})")));
            self.open = Open::Failed;
            return;
        }
        if matches!(self.open, Open::Open { .. }) {
            self.out.push(Output::Stderr(format!("변환기: claude가 끝났습니다 ({status})")));
            self.out.push(Output::Exit(code.filter(|code| *code != 0).unwrap_or(1)));
        }
    }

    /// claude를 띄우지 못했다 — 그 열기를 오류로 답하고 다음 열기를 받는다.
    fn launch_failed(&mut self, error_text: &str) {
        let Some(opening) = self.take_opening() else { return };
        let reason = format!("claude를 실행할 수 없습니다: {} — {error_text}", opening.claude);
        self.send(error(&opening.id, -32603, &reason));
    }

    /// claude의 stdin에 쓰지 못한 줄 — claude가 끝났거나 끄는 중이다(끝은 [`Input::ClaudeEnded`]로 따로 안다).
    /// - 말(user 줄)이면 그 말을 오류로 답하고 턴을 풀어 둔다.
    /// - 바꾸기면 그 바꾸기를 오류로 답한다.
    /// - 나머지(initialize · interrupt · 권한 답)는 버린다.
    fn unwritten(&mut self, line: &Value) {
        if line["type"] == "user" {
            // 그 줄은 방금 건 턴의 말이다 — 우리 턴을 열고 곧바로 낸 줄이기 때문이다.
            if let Turn::Ours { id, .. } = &self.turn {
                let id = id.clone();
                self.turn = Turn::Idle;
                self.send(error(&id, -32603, "claude에 말을 넣지 못했습니다"));
            }
        } else if let Some(change) = line["request_id"].as_str().and_then(|id| self.changes.remove(id)) {
            self.send(error(change.id(), -32603, "claude에 바꾸기를 넣지 못했습니다"));
        }
    }

    // ── 낼 것 ───────────────────────────────────────────────────────────────────────

    fn send(&mut self, line: Value) {
        self.out.push(Output::Acp(line));
    }

    fn to_claude(&mut self, line: Value) {
        self.out.push(Output::Claude(line));
    }

    /// 변환기가 claude에 보내는 제어 요청의 새 `request_id`.
    fn control_id(&mut self) -> String {
        self.next_control += 1;
        format!("atelier-{}", self.next_control)
    }
}

/// ACP `initialize`의 답 — 자기 판을 싣는다. 호스트는 앱의 판과 다르면 「판 어긋남」으로 세션 열기를 실패시킨다(워크플로 S4).
/// 둘 다 이 크레이트의 판이고, 판 하나 검사가 크레이트와 앱을 한 값으로 묶는다.
///
/// 되살리기는 `loadSession`과 세션 `resume`을 둘 다 광고한다(워크플로 S19) — 둘 다 `--resume`으로 연다. claude는 지난 대화를
/// 다시 흘리지 않으므로(판 02 관문 G4) load에도 되감을 것이 없다.
fn initialize_result() -> Value {
    json!({
        "protocolVersion": 1,
        "agentCapabilities": {"loadSession": true, "sessionCapabilities": {"resume": {}}},
        "agentInfo": {"name": "atelier-claude", "title": "Claude Code", "version": env!("CARGO_PKG_VERSION")},
        "authMethods": []
    })
}

/// `session/prompt`의 글 블록들 → claude의 stdin user 줄. 깨진 줄 하나가 claude를 끝내므로 변환기가 지은 봉투만 쓴다(워크플로
/// 함정 4).
fn user_line(params: &Value) -> Value {
    let content: Vec<Value> = params["prompt"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block["type"] == "text")
        .map(|block| json!({"type": "text", "text": block["text"]}))
        .collect();
    json!({
        "type": "user",
        "message": {"role": "user", "content": content},
        "parent_tool_use_id": null,
        "session_id": "",
    })
}

/// 가리기 — claude의 원문 한 줄에서 계정이 실리는 두 자리를 바꾼다. 나머지는 원문 그대로다.
/// - `initialize` 답의 `account` 아래 글자 값은 다 `<email>`이다(이메일 · 조직 · 플랜). Codex의 `_auth/status_update`와 같은 규칙이다.
/// - `system/init`의 `plugins[].path`는 `<path>`다 — 동기된 플러그인의 경로에 조직 · 계정 id가 든다.
fn mask(line: &mut Value) {
    if let Some(account) = line.pointer_mut("/response/response/account") {
        redact::mask_strings(account);
    }
    if line["type"] == "system" && line["subtype"] == "init" {
        for plugin in line["plugins"].as_array_mut().into_iter().flatten() {
            if let Some(path) = plugin.get_mut("path").filter(|path| path.is_string()) {
                *path = json!("<path>");
            }
        }
    }
}

/// claude 명령 하나 → ACP 명령 하나(이름 · 설명 · 인자 힌트). 별칭은 메뉴의 찾기 말로 `_meta`에 싣는다 — 플러그인 스킬은
/// 이름(`skill-creator:skill-creator`)과 사람이 치는 말(`skill-creator`)이 다르다(실측 함정 36).
fn command(command: &Value) -> Value {
    let hint = command["argumentHint"].as_str().filter(|hint| !hint.is_empty());
    let mut acp = json!({
        "name": command["name"],
        "description": command["description"].as_str().unwrap_or_default(),
        "input": hint.map(|hint| json!({"hint": hint})),
    });
    if let Some(aliases) = command.get("aliases").filter(|aliases| aliases.as_array().is_some_and(|a| !a.is_empty())) {
        acp["_meta"] = json!({"aliases": aliases});
    }
    acp
}

fn reply(id: &Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn error(id: &Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

/// 오류 답에 까닭의 원문(`data`)을 싣는다.
fn error_with_data(id: &Value, code: i32, message: &str, data: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message, "data": data}})
}

fn notify(method: &str, params: Value) -> Value {
    json!({"jsonrpc": "2.0", "method": method, "params": params})
}

/// `session/update` 알림 하나 — 그 세션의 update 몸을 봉투(`{sessionId, update}`)에 싼다.
fn session_update(session_id: &str, update: Value) -> Value {
    notify("session/update", json!({"sessionId": session_id, "update": update}))
}

/// 턴 밖 턴의 표지(S4) — `session_info_update`의 `_meta.atelier.outOfTurn`에 시작(`{state: "started"}`) · 끝(`{state: "ended",
/// response}`)을 싣는다. 호스트와의 계약이다(`host.rs`의 `OutOfTurn`).
fn out_of_turn(session_id: &str, mark: Value) -> Value {
    session_update(session_id, json!({"sessionUpdate": "session_info_update", "_meta": {"atelier": {"outOfTurn": mark}}}))
}

#[cfg(test)]
mod tests;
