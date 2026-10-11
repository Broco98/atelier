//! Claude 변환기 — 앱 실행 파일의 하위 모드 `acp-claude`로 도는 ACP 에이전트(three-axes 결정 12, 워크플로 S4).
//! `claude -p` 하나를 쥐고 stream-json ↔ ACP를 옮긴다. 호스트에게는 codex-acp와 같은 「stdio로 ACP를 말하는 자식」이다.
//!
//! - **ACP 세션 하나 = 변환기 하나 = `claude` 하나.** `claude`는 변환기의 프로세스 그룹 안에 띄운다(새 세션에 두지 않는다)
//!   — 호스트가 변환기를 새 세션에 띄우고 끌 때 그룹째 SIGKILL하므로 claude와 그 MCP 자식들도 함께 끝난다.
//! - **ACP 쪽은 손으로 짠 줄 단위 응답기다.** 받는 메서드가 몇 안 되고, claude의 답을 기다리는 동안 ACP 요청의 답을 미루고
//!   claude가 보낸 순서대로 내보내는 일을 직접 쥐어야 한다.
//! - **stdin EOF면 claude의 stdin을 닫고 끝난다** — 앱이 비정상으로 끝나도(호스트가 그룹을 끄지 못해도) 고아가 남지 않는다.
//!
//! 세션 열기(티켓 13) — 띄우기 플래그 · 띄운 직후 stdin `initialize`(S1) · 판 · 가리기.
//! 턴(티켓 14) — `session/prompt` 하나가 stdin user 줄 하나이고, claude의 줄을 ACP `session/update`로 옮기며(몸은
//! [`stream`]), `result` 하나가 턴 끝 하나다(`session/prompt`의 답).
//! 제어(티켓 15) — ACP 요청을 claude의 stdin 제어 요청으로, claude의 요청을 ACP 모양으로 옮긴다. 멈추기(`session/cancel` →
//! `interrupt`), 권한(`can_use_tool` ↔ `session/request_permission`), 계획 승인(`ExitPlanMode` → `switch_mode` 요청, S5),
//! 모드 · 모델 바꾸기(`set_permission_mode` · `set_model`)와 claude가 스스로 바꾼 모드(`system/status` → `current_mode_update`).
//! 되살리기(티켓 16) — `session/resume` · `session/load`를 둘 다 `claude … --resume <세션 id>`로 연다(워크플로 S19).
//! 백그라운드(16, S4) · 미로그인(16, S3)은 [`turn_ended`] · [`read_claude`]에 있다.
//!
//! **가리기.** claude의 원문을 처음 읽는 자리가 여기라, 읽자마자 두 자리를 가린다 — 이 뒤로 ACP에 실려 기록으로 가는 것에는
//! 계정이 남지 않는다(워크플로 S34 · 스토리 115). `initialize` 답의 `account`(이메일 · 조직 · 플랜, 워크플로 함정 19)는
//! `<email>`로, `system/init`의 `plugins[].path`(조직 · 계정 id가 실린다, 실측 함정 39)는 `<path>`로 바꾼다.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

mod stream;

use stream::Stream;

/// stdin EOF 뒤 claude가 스스로 끝나기를 기다리는 시간. 진짜 claude 2.1.296은 1~1.6초에 끝났다(판 02 실측 G5). 넘으면
/// claude를 끈다 — 호스트가 없어 그룹째 끄는 손이 없을 때도 고아가 남지 않게.
const CLAUDE_EOF_GRACE: Duration = Duration::from_secs(5);

/// 모드 다섯 — claude의 모드 이름 그대로다(three-axes 결정 16 · 27). `bypassPermissions`는 띄울 때 허락하지 않았으면 도중에
/// 고를 수 없으므로(`bypass_not_launched`, 실측 함정 38) 넣지 않는다.
const MODES: [&str; 5] = ["default", "acceptEdits", "auto", "dontAsk", "plan"];

/// claude가 미로그인을 알리는 `assistant.error`의 값(실측 함정 32).
const AUTHENTICATION_FAILED: &str = "authentication_failed";

/// ACP의 「로그인 필요」 오류 코드 — codex-acp가 `session/new`에 내는 것과 같다(실측 A3). 호스트는 엔진을 가리지 않고 받는다.
const AUTH_REQUIRED: i32 = -32000;

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

/// 변환기의 몸통 — 앱 진입점의 `acp-claude` 갈래와 변환기 시험 bin이 이것 하나를 부른다. stdin이 닫히면 끝나고 종료 코드를
/// 돌려준다. **stdout이 곧 ACP 선이다** — 이 함수 밖에서 stdout에 아무것도 쓰지 않는다.
pub fn run_claude_translator() -> i32 {
    let shared = Arc::new(Shared::default());
    let mut session: Option<Session> = None;
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match input.read_until(b'\n', &mut buf) {
            Ok(0) => break,
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
        let line = String::from_utf8_lossy(&buf);
        if line.trim().is_empty() {
            continue;
        }
        let message: Value = match serde_json::from_str(&line) {
            Ok(message) => message,
            Err(error) => {
                eprintln!("변환기: 읽을 수 없는 ACP 줄을 건너뜁니다 — {error}");
                continue;
            }
        };
        let params = &message["params"];
        // id가 없으면 알림이다 — 받는 알림은 멈추기 하나다.
        let Some(id) = message.get("id").cloned() else {
            if message["method"] == "session/cancel" {
                if let Some(session) = session.as_mut() {
                    session.cancel(&shared);
                }
            }
            continue;
        };
        let Some(method) = message["method"].as_str() else {
            // 메서드 없이 id만 있으면 변환기가 보낸 요청(권한)의 답이다.
            if let Some(session) = session.as_mut() {
                session.answer(&id, &message, &shared);
            }
            continue;
        };
        match method {
            "initialize" => send(&reply(&id, initialize_result())),
            "session/prompt" => match session.as_mut() {
                Some(session) => session.prompt(&id, params, &shared),
                None => send(&error(&id, -32602, "열린 세션이 없습니다")),
            },
            "session/set_mode" | "session/set_config_option" => match session.as_mut() {
                Some(session) => session.change(&id, method, params, &shared),
                None => send(&error(&id, -32602, "열린 세션이 없습니다")),
            },
            "session/new" | "session/resume" | "session/load" => {
                // 앞선 열기가 실패했으면(되살릴 세션이 없어 claude가 끝났다) 그 claude를 거두고 다음 열기를 받는다 — 호스트의
                // 되살리기는 resume → load → 새 세션 순으로 같은 변환기에 묻는다(three-axes 티켓 10).
                let failed = session.is_some() && shared.lock().failed_open();
                if failed {
                    if let Some(dead) = session.take() {
                        dead.finish(&shared);
                    }
                }
                let revive = (method != "session/new").then(|| params["sessionId"].as_str().unwrap_or_default().to_owned());
                if session.is_some() {
                    send(&error(&id, -32600, "이 변환기는 이미 세션을 열었습니다 — 세션 하나에 변환기 하나다"));
                } else if let Some(reason) = revive.as_ref().and_then(|revive| shared.lock().forgotten(revive)) {
                    // 방금 resume으로 없다는 답을 받은 그 세션이다 — load도 같은 `--resume`이라 claude를 다시 띄우지 않는다.
                    send(&error(&id, -32603, &reason));
                } else {
                    match Session::open(&id, params, revive, &shared) {
                        Ok(opened) => session = Some(opened),
                        Err(reason) => send(&error(&id, -32603, &reason)),
                    }
                }
            }
            method => send(&error(&id, -32601, &format!("Method not found: {method}"))),
        }
    }
    match session {
        Some(session) => session.finish(&shared),
        None => 0,
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

/// 변환기의 두 스레드(ACP를 읽는 몸통 · claude를 읽는 스레드)가 함께 보는 것.
#[derive(Default)]
struct Shared {
    state: Mutex<SharedState>,
}

#[derive(Default)]
struct SharedState {
    /// claude의 `initialize` 답을 기다리는 `session/new`.
    opening: Option<Opening>,
    /// 세션이 열렸다 — 이 뒤로 claude가 끝나면 변환기도 끝난다(호스트가 프로세스 죽음으로 안다).
    open: bool,
    /// 열린 세션의 id — claude에게서 온 것을 `session/update`로 알릴 때 싣는다.
    session_id: Option<String>,
    /// 첫 `system/init`을 알렸다. claude는 턴마다 `init`을 다시 내지만 새 세션이 아니다 — 같은 원문을 거듭 싣지 않는다.
    init_announced: bool,
    /// 답하지 않은 `session/prompt`의 요청 id — 턴이 돈다. claude의 `result`가 오면 그 턴의 끝으로 답한다.
    prompt: Option<Value>,
    /// 도는 턴에 interrupt를 보냈다 — 그 턴의 `result/error_during_execution`은 우리가 멈춘 끝(`cancelled`)이다.
    interrupted: bool,
    /// 도는 턴에 미로그인 오류(`assistant.error:"authentication_failed"`)가 왔다 — 그 턴의 `result`는 `-32000`이다(S3).
    auth_failed: bool,
    /// claude가 백그라운드 작업 알림으로 스스로 시작한 턴이 돈다(S4) — 걸린 `session/prompt` 없이 `system/init`이 왔다. 그
    /// 턴의 `result`가 턴 밖 끝이다.
    self_turn: bool,
    /// 스스로 이어 간 턴이 도는 동안 온 `session/prompt` — 그 턴의 `result` 뒤에 넣는다.
    held: Option<Held>,
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
    /// stdin EOF를 받아 끄는 중이다 — 이 뒤의 claude의 끝은 죽음이 아니다.
    closing: bool,
    /// 세션 열기가 실패했다(claude가 열기에 답하지 않고 끝났다). 다음 열기가 그 claude를 거두고 새로 띄운다.
    open_failed: bool,
    /// 되살리지 못한 세션 id와 그 까닭 — claude가 「그런 세션이 없다」고 끝났다. 같은 id의 load는 다시 띄우지 않고 이 까닭으로
    /// 답한다.
    forgotten: Option<(String, String)>,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, SharedState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl SharedState {
    /// 앞선 세션 열기가 실패해 다음 열기를 받을 수 있나.
    fn failed_open(&self) -> bool {
        self.open_failed && !self.open && self.opening.is_none()
    }

    /// 그 세션 id를 방금 되살리지 못했으면 그 까닭.
    fn forgotten(&self, session_id: &str) -> Option<String> {
        self.forgotten.as_ref().filter(|(id, _)| id == session_id).map(|(_, reason)| reason.clone())
    }

    /// 실패한 열기 뒤에 새 claude를 띄우기 전 — 세션 하나의 상태를 처음으로 돌린다. 되살리지 못한 세션은 기억한다.
    fn reset_for_open(&mut self) {
        let forgotten = self.forgotten.take();
        *self = SharedState { forgotten, ..SharedState::default() };
    }

    /// 변환기가 claude에 보내는 제어 요청의 새 `request_id`.
    fn control_id(&mut self) -> String {
        self.next_control += 1;
        format!("atelier-{}", self.next_control)
    }
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

/// 세션을 여는 중인 `session/new` · `session/resume` · `session/load` — claude의 `initialize` 답으로 짓는다.
struct Opening {
    id: Value,
    session_id: String,
    model: Option<String>,
    /// 되살리기(`--resume`)인가 — 답에 `sessionId`를 싣지 않는다(ACP의 resume · load 답 꼴).
    revive: bool,
}

/// claude의 stdin — 몸통(ACP 요청)과 claude를 읽는 스레드(스스로 이어 간 턴 뒤에 미뤄 둔 말, S4)가 함께 쓴다. 끄면 `None`이다.
type ClaudeStdin = Arc<Mutex<Option<ChildStdin>>>;

/// claude의 stdin에 줄 하나를 쓴다. 대화의 상태 잠금을 쥐고 부르지 않는다 — claude의 stdin이 막히면 읽는 스레드가 그 잠금을
/// 기다리다 claude의 stdout을 비우지 못한다. 쓰지 못했으면(끄는 중이거나 claude가 끝났다) false다 — 끝은 읽는 스레드가 EOF로 안다.
fn write_line(stdin: &ClaudeStdin, line: &Value) -> bool {
    let mut held = stdin.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(pipe) = held.as_mut() else { return false };
    writeln!(pipe, "{line}").and_then(|()| pipe.flush()).is_ok()
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

/// 쥔 `claude` 하나.
struct Session {
    stdin: ClaudeStdin,
    child: Arc<Mutex<Child>>,
}

impl Session {
    /// `session/new` · `session/resume` · `session/load` — claude를 띄우고 stdin `initialize`를 보낸다(S1, three-axes 결정 27).
    /// 답은 claude를 읽는 스레드가 받아 그 요청에 답한다.
    ///
    /// 받는 것(`params`): `cwd` · `additionalDirectories`(함께 여는 폴더) · `_meta.atelier{claudePath, permissionMode, model}`.
    /// `mcpServers`는 보지 않는다 — 사용자 MCP와 커넥터는 `claude -p`가 스스로 붙인다(three-axes 결정 23).
    ///
    /// `revive`가 있으면 되살리기다(티켓 16) — `--session-id` 대신 `--resume <그 id>`로 띄운다. 모드 · 모델은 새 대화와 같이
    /// 받은 값을 플래그로 준다 — Codex처럼 열린 뒤에 다시 넣지 않는다(결정 27). claude는 같은 세션 id로 이어 가고 지난 대화를
    /// 다시 흘리지 않는다. 그런 세션이 없으면 claude가 initialize에 답하지 않고 끝나고(판 02 관문 G4), 그 요청은 오류로 답한다 —
    /// 호스트는 다음 단계로 넘어간다.
    fn open(id: &Value, params: &Value, revive: Option<String>, shared: &Arc<Shared>) -> Result<Self, String> {
        let cwd = params["cwd"].as_str().ok_or("세션을 여는 요청에 cwd가 없습니다")?;
        let atelier = &params["_meta"]["atelier"];
        let claude = atelier["claudePath"].as_str().unwrap_or("claude");
        let mode = atelier["permissionMode"].as_str();
        let model = atelier["model"].as_str();
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

        // env는 받은 것(호스트가 준 로그인 env) 그대로다. claude의 stderr는 변환기의 stderr로 흘린다 — 호스트가 그 줄을
        // 기록하고, 죽음 줄의 꼬리에도 싣는다.
        let mut child = Command::new(claude)
            .args(&args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("claude를 실행할 수 없습니다: {claude} — {error}"))?;
        let stdin: ClaudeStdin = Arc::new(Mutex::new(Some(child.stdin.take().expect("stdin을 파이프로 띄웠다"))));
        let stdout = child.stdout.take().expect("stdout을 파이프로 띄웠다");
        let child = Arc::new(Mutex::new(child));

        {
            let mut state = shared.lock();
            state.reset_for_open();
            state.opening =
                Some(Opening { id: id.clone(), session_id, model: model.map(str::to_owned), revive: reviving });
        }
        read_claude(stdout, Arc::clone(shared), Arc::clone(&child), Arc::clone(&stdin));
        let initialize = json!({"type": "control_request", "request_id": INITIALIZE_REQUEST, "request": {"subtype": "initialize"}});
        // 쓰지 못했으면 claude가 이미 끝난 것이다 — 읽는 스레드가 EOF를 보고 `session/new`에 답한다.
        write_line(&stdin, &initialize);
        Ok(Self { stdin, child })
    }

    /// `session/prompt` 하나 = stdin user 줄 하나. 첫 말도 `system/init`을 기다리지 않고 넣는다(워크플로 함정 6) — init은
    /// 첫 user 줄을 받은 뒤에야 온다. 깨진 줄 하나가 claude를 끝내므로 변환기가 지은 봉투만 쓴다(워크플로 함정 4).
    ///
    /// - 턴 도중의 둘째 말은 stdin에 쓰지 않고 오류로 답한다 — 쓰면 그 턴에 합쳐진다(three-axes 결정 20). 대기 줄은 호스트가
    ///   쥔다.
    /// - claude가 스스로 이어 간 턴(S4)이 도는 동안 온 말은 그 턴의 `result`까지 미뤄 두었다가 넣는다(워크플로 티켓 09) —
    ///   호스트가 그 턴의 시작을 알기 전에 보낸 말이다. 미룬 말은 하나뿐이다.
    /// - 여기서는 답하지 않는다 — claude를 읽는 스레드가 그 턴의 `result`에서 답한다.
    fn prompt(&mut self, id: &Value, params: &Value, shared: &Shared) {
        {
            let mut state = shared.lock();
            if state.prompt.is_some() || state.held.is_some() {
                send(&error(id, -32603, "턴이 도는 중입니다 — 턴 도중의 말은 그 턴에 합쳐지므로 넣지 않습니다"));
                return;
            }
            if state.self_turn {
                state.held = Some(Held { id: id.clone(), line: user_line(params) });
                return;
            }
            // 쓰기 전에 걸어 둔다 — claude는 user 줄을 받아야 답하므로 `result`가 이보다 먼저 올 수 없다. 잠금은 쓰기 전에
            // 놓는다: claude의 stdin이 막히면 읽는 스레드가 잠금을 기다리다 claude의 stdout을 비우지 못한다.
            state.prompt = Some(id.clone());
        }
        put_prompt(&self.stdin, id, &user_line(params), shared);
    }

    /// `session/cancel` — 도는 턴을 stdin `control_request interrupt`로 멈춘다. SIGINT는 쓰지 않는다 — claude가 끝난다(워크플로
    /// 함정 5). claude는 약 10ms 안에 열린 도구를 실패로 닫고 `result/error_during_execution`으로 턴을 끝내며, 프로세스는
    /// 살아 다음 말이 맥락을 잇는다(워크플로 관문 G2). 그 `result`가 이 턴의 `cancelled`다. 도는 턴이 없거나 이미 보냈으면
    /// 아무것도 하지 않는다.
    ///
    /// claude가 스스로 이어 간 턴(S4)도 같은 interrupt로 멈춘다 — 그 턴의 턴 밖 끝이 `cancelled`다. 그 턴 뒤로 미뤄 둔 말은
    /// 넣지 않고 곧바로 `cancelled`로 답한다 — 사람은 아직 claude에 닿지 않은 그 말의 턴을 멈춘 것이다.
    fn cancel(&mut self, shared: &Shared) {
        let request_id = {
            let mut state = shared.lock();
            if let Some(held) = state.held.take() {
                send(&reply(&held.id, json!({"stopReason": "cancelled"})));
            }
            if (state.prompt.is_none() && !state.self_turn) || state.interrupted {
                return;
            }
            state.interrupted = true;
            state.control_id()
        };
        self.write(&json!({"type": "control_request", "request_id": request_id, "request": {"subtype": "interrupt"}}));
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
    fn answer(&mut self, id: &Value, message: &Value, shared: &Shared) {
        let (asked, interrupted) = {
            let mut state = shared.lock();
            let asked = id.as_u64().and_then(|id| state.asked.remove(&id));
            (asked, state.interrupted)
        };
        let Some(asked) = asked else { return };
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
            _ if interrupted => return,
            _ => deny(WITHDRAWN),
        };
        self.write(&json!({
            "type": "control_response",
            "response": {"subtype": "success", "request_id": asked.request_id, "response": decision},
        }));
    }

    /// 모드 · 모델 바꾸기 — `session/set_mode{modeId}` → stdin `set_permission_mode{mode}`, `session/set_config_option{configId:
    /// "model", value}` → stdin `set_model{model}`(three-axes 결정 16 · 27). 답은 claude의 `control_response`를 받아 읽는 스레드가
    /// 한다 — 거절이면 claude가 준 까닭으로(`bypass_not_launched` · `catalog_unknown` 등, 실측 A5 · A7).
    ///
    /// - 모델 `default`(엔진 기본값)는 값 없는 `set_model`이다 — claude가 사용자의 기본 모델로 돌린다(실측 2.1.296).
    /// - Claude에 없는 설정(Codex의 「계획」 `collaboration_mode` 등)은 오류다 — Claude의 계획은 모드 `plan`이다(three-axes
    ///   결정 29).
    fn change(&mut self, id: &Value, method: &str, params: &Value, shared: &Shared) {
        let value = |key: &str| params[key].as_str().map(str::to_owned);
        let (change, request) = match (method, params["configId"].as_str()) {
            ("session/set_mode", _) => {
                let Some(mode) = value("modeId") else { return send(&error(id, -32602, "modeId가 없습니다")) };
                (Change::Mode(id.clone()), json!({"subtype": "set_permission_mode", "mode": mode}))
            }
            (_, Some("model")) => {
                let Some(model) = value("value") else { return send(&error(id, -32602, "value가 없습니다")) };
                let mut request = json!({"subtype": "set_model"});
                if model != "default" {
                    request["model"] = json!(model);
                }
                (Change::Model(id.clone(), model), request)
            }
            (_, config) => {
                return send(&error(id, -32602, &format!("Claude에는 그 설정이 없습니다: {}", config.unwrap_or("(없음)"))));
            }
        };
        let request_id = {
            let mut state = shared.lock();
            let request_id = state.control_id();
            state.changes.insert(request_id.clone(), change);
            request_id
        };
        if !self.write(&json!({"type": "control_request", "request_id": request_id, "request": request})) {
            shared.lock().changes.remove(&request_id);
            send(&error(id, -32603, "claude에 바꾸기를 넣지 못했습니다"));
        }
    }

    /// claude의 stdin에 줄 하나를 쓴다. 잠금을 쥐고 부르지 않는다 — claude의 stdin이 막히면 읽는 스레드가 잠금을 기다리다
    /// claude의 stdout을 비우지 못한다. 쓰지 못했으면 claude가 끝난 것이다 — 읽는 스레드가 EOF로 안다.
    fn write(&mut self, line: &Value) -> bool {
        write_line(&self.stdin, line)
    }

    /// stdin EOF — claude의 stdin을 닫고 스스로 끝나기를 기다린다. 넘으면 claude를 끈다.
    fn finish(self, shared: &Shared) -> i32 {
        shared.lock().closing = true;
        drop(self.stdin.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take());
        let deadline = Instant::now() + CLAUDE_EOF_GRACE;
        loop {
            let mut child = self.child.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            match child.try_wait() {
                Ok(Some(_)) => return 0,
                Ok(None) if Instant::now() < deadline => {}
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return 0;
                }
            }
            drop(child);
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

/// 걸어 둔 `session/prompt`의 user 줄을 claude에 넣는다. 넣지 못했으면 그 말을 오류로 답하고 턴을 풀어 둔다.
fn put_prompt(stdin: &ClaudeStdin, id: &Value, line: &Value, shared: &Shared) {
    if !write_line(stdin, line) {
        shared.lock().prompt = None;
        send(&error(id, -32603, "claude에 말을 넣지 못했습니다"));
    }
}

/// claude의 stdout을 줄 단위로 읽는 스레드.
fn read_claude(stdout: ChildStdout, shared: Arc<Shared>, child: Arc<Mutex<Child>>, stdin: ClaudeStdin) {
    std::thread::spawn(move || {
        let mut stream = Stream::default();
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) => break,
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
            let Ok(mut line) = serde_json::from_slice::<Value>(&buf) else { continue };
            mask(&mut line);
            if line["type"] == "control_response" && line["response"]["request_id"] == INITIALIZE_REQUEST {
                let opening = shared.lock().opening.take();
                if let Some(opening) = opening {
                    opened(opening, &line["response"], &shared);
                }
            } else if line["type"] == "control_response" {
                changed(&line["response"], &shared);
            } else if line["type"] == "system" && line["subtype"] == "status" {
                mode_changed(&line, &shared);
            } else if line["type"] == "control_request" && line["request"]["subtype"] == "can_use_tool" {
                ask_permission(&line, &shared);
            } else if line["type"] == "control_cancel_request" {
                // claude가 묻던 것을 거뒀다(interrupt 때, 워크플로 관문 G2 (c)) — 호스트의 늦은 답을 claude에 옮기지 않는다.
                // 호스트의 「거둬짐」은 멈추기(우리가 끊음)나 턴 끝(에이전트)이 적는다.
                shared.lock().asked.retain(|_, asked| asked.request_id != line["request_id"]);
            } else if line["type"] == "system" && line["subtype"] == "init" {
                self_turn_started(&shared);
                announce_init(line, &shared);
            } else if line["type"] == "result" && shared.lock().opening.is_some() {
                // 세션이 열리기 전의 `result` — 되살릴 세션이 없어 claude가 initialize에 답하지 않고 끝난다(판 02 관문 G4).
                not_opened(&line, &shared);
            } else if line["type"] == "result" {
                turn_ended(&line, &stream, &shared, &stdin);
            } else if line["type"] == "assistant" && line["error"] == AUTHENTICATION_FAILED {
                // S3 — 로그인이 안 된 claude의 `<synthetic>` 오류(실측 함정 32 · 33). 답으로 옮기지 않는다 — 내장 명령의
                // `<synthetic>` 답과는 `error` 키로 가른다. 그 턴의 `result`가 `-32000`이 된다.
                shared.lock().auth_failed = true;
            } else {
                forward(stream.updates(&line), &shared);
            }
        }
        claude_closed(&shared, &child);
    });
}

/// claude가 `initialize`에 답했다 — `session/new`에 답하고, 명령 목록을 알린다. 답이 먼저 나가야 호스트의 기록에서 「열림」이
/// 명령 목록보다 앞에 선다.
fn opened(opening: Opening, response: &Value, shared: &Shared) {
    if response["subtype"] != "success" {
        let reason = format!("claude가 initialize에 오류로 답했습니다: {}", response["error"]);
        send(&error(&opening.id, -32603, &reason));
        shared.lock().open_failed = true;
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
    let mut state = shared.lock();
    send(&reply(&opening.id, result));
    send(&notify(
        "session/update",
        json!({"sessionId": opening.session_id,
               "update": {"sessionUpdate": "available_commands_update", "availableCommands": commands}}),
    ));
    state.open = true;
    state.session_id = Some(opening.session_id);
    state.mode = Some(current_mode.to_owned());
    state.model_option = model_option;
}

/// claude의 첫 `system/init` — 세션 정보(`session_info_update`)의 `_meta`에 원문을 싣는다. 쓰는 모델 · 도구 · MCP 서버의 상태 ·
/// 플러그인이 든다 — 화면은 그리지 않고 기록이 평가의 재료로 남긴다(three-axes 결정 18). 둘째부터는 싣지 않는다.
fn announce_init(init: Value, shared: &Shared) {
    let mut state = shared.lock();
    let Some(session_id) = state.session_id.clone().filter(|_| !state.init_announced) else { return };
    state.init_announced = true;
    send(&notify(
        "session/update",
        json!({"sessionId": session_id,
               "update": {"sessionUpdate": "session_info_update", "_meta": {"claudeCode": {"init": init}}}}),
    ));
}

/// `system/init` — claude가 턴 하나를 시작한다. 걸린 `session/prompt`가 없으면 claude가 백그라운드 작업 알림으로 스스로 시작한
/// 턴이다(S4, 판 02 관문 G4) — 호스트에 턴 밖 턴의 시작을 알린다. 호스트는 그 끝까지 대기 줄을 보내지 않고, 끝에서 고친 곳을
/// 견준다. 이 턴의 줄은 턴 밖 `session/update`로 그대로 흐른다.
fn self_turn_started(shared: &Shared) {
    let mut state = shared.lock();
    if !state.open || state.prompt.is_some() || state.self_turn {
        return;
    }
    let Some(session_id) = state.session_id.clone() else { return };
    state.self_turn = true;
    send(&notify(
        "session/update",
        json!({"sessionId": session_id, "update": {"sessionUpdate": "session_info_update",
                                                    "_meta": {"atelier": {"outOfTurn": {"state": "started"}}}}}),
    ));
}

/// claude가 바꾸기에 답했다(`control_response`) — 기다리던 ACP 요청에 답한다. 거절이면 claude가 준 까닭과 오류 코드로.
/// 모드는 claude가 답한 값(`manual` → `default`)을 지금 모드로 적는다 — 뒤따르는 `system/status`가 그 메아리라 옮기지 않는다.
fn changed(response: &Value, shared: &Shared) {
    let mut state = shared.lock();
    let Some(change) = response["request_id"].as_str().and_then(|id| state.changes.remove(id)) else { return };
    let (id, model) = match change {
        Change::Mode(id) => (id, None),
        Change::Model(id, model) => (id, Some(model)),
    };
    if response["subtype"] != "success" {
        let reason = response["error"].as_str().unwrap_or("claude가 바꾸기를 거절했습니다");
        send(&json!({"jsonrpc": "2.0", "id": id,
                     "error": {"code": -32602, "message": reason, "data": {"errorCode": response["error_code"]}}}));
        return;
    }
    match model {
        None => {
            if let Some(mode) = response["response"]["mode"].as_str() {
                state.mode = Some(mode.to_owned());
            }
            send(&reply(&id, json!({})));
        }
        Some(model) => {
            state.model_option["currentValue"] = json!(model);
            send(&reply(&id, json!({"configOptions": [state.model_option]})));
        }
    }
}

/// `system/status{permissionMode}` — claude의 모드가 바뀌었다. 우리가 아는 모드와 다르면 claude가 스스로 바꾼 것이다(계획을
/// 승인하면 `default`로 간다, 판 02 관문 G1) — `current_mode_update`로 알린다. 우리가 바꾼 모드의 메아리는 옮기지 않는다 —
/// 사람이 바꾼 값은 호스트가 `config` 줄로 이미 적었다.
fn mode_changed(status: &Value, shared: &Shared) {
    let Some(mode) = status["permissionMode"].as_str() else { return };
    let mut state = shared.lock();
    if state.mode.as_deref() == Some(mode) {
        return;
    }
    state.mode = Some(mode.to_owned());
    let Some(session_id) = state.session_id.as_deref() else { return };
    send(&notify(
        "session/update",
        json!({"sessionId": session_id, "update": {"sessionUpdate": "current_mode_update", "currentModeId": mode}}),
    ));
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
fn ask_permission(line: &Value, shared: &Shared) {
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
        return request_permission(line, tool_call, options, Vec::new(), shared);
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
    request_permission(line, tool_call, options, session_suggestions, shared);
}

/// 호스트에 `session/request_permission`을 보내고, 답을 claude에 옮길 재료를 챙겨 둔다.
fn request_permission(line: &Value, tool_call: Value, options: Vec<Value>, session_suggestions: Vec<Value>, shared: &Shared) {
    let request = &line["request"];
    let mut state = shared.lock();
    let Some(session_id) = state.session_id.clone() else { return };
    let id = state.next_request;
    state.next_request += 1;
    let input = request["input"].clone();
    state.asked.insert(id, Asked { request_id: line["request_id"].clone(), input, session_suggestions });
    send(&json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "session/request_permission",
        "params": {"sessionId": session_id, "toolCall": tool_call, "options": options,
                   "_meta": {"claudeCode": {"request": request}}},
    }));
}

/// 턴의 줄을 옮긴 `session/update`들을 낸다. 세션이 열리기 전이면(띄운 직후의 훅 줄) 낼 곳이 없다.
fn forward(updates: Vec<Value>, shared: &Shared) {
    if updates.is_empty() {
        return;
    }
    let state = shared.lock();
    let Some(session_id) = state.session_id.as_deref() else { return };
    for update in updates {
        send(&notify("session/update", json!({"sessionId": session_id, "update": update})));
    }
}

/// claude의 `result` — 턴 끝 하나다. 사용량을 알리고, 걸린 `session/prompt`에 끝 까닭으로 답한다. 둘째 턴부터 다시 오는
/// `system/init`은 새 세션이 아니므로 턴은 같은 세션에서 이어진다.
///
/// - 백그라운드 작업이 남아도 여기서 턴을 끝낸다(S4) — 워크플로 티켓 09의 「한 턴으로 접기」는 하지 않는다. 사람이 dev 서버처럼
///   오래 사는 작업 뒤에 갇히지 않는다.
/// - 걸린 `session/prompt`가 없는 `result`는 claude가 스스로 이어 간 턴의 끝이다 — `_meta.atelier.outOfTurn`으로 표시한 턴 밖
///   끝 알림(`session_info_update`)을 낸다. 몸은 `session/prompt`의 답과 같은 꼴이다. 그 턴 뒤로 미뤄 둔 말이 있으면 이제 넣는다.
fn turn_ended(result: &Value, stream: &Stream, shared: &Arc<Shared>, stdin: &ClaudeStdin) {
    let mut state = shared.lock();
    let Some(session_id) = state.session_id.clone() else { return };
    if let Some(usage) = stream.usage(result) {
        send(&notify("session/update", json!({"sessionId": session_id, "update": usage})));
    }
    let interrupted = std::mem::take(&mut state.interrupted);
    let auth_failed = std::mem::take(&mut state.auth_failed);
    if let Some(id) = state.prompt.take() {
        if auth_failed {
            // S3 — codex-acp와 같은 모양이라 호스트가 엔진을 가리지 않고 로그인 필요 줄 · 안내 카드로 옮긴다(three-axes 결정 30).
            send(&json!({"jsonrpc": "2.0", "id": id, "error": {
                "code": AUTH_REQUIRED, "message": "Authentication required",
                "data": {"claudeCode": {"result": result}},
            }}));
        } else {
            send(&reply(&id, stream::prompt_response(result, interrupted)));
        }
        return;
    }
    state.self_turn = false;
    let ended = json!({"state": "ended", "response": stream::prompt_response(result, interrupted)});
    send(&notify(
        "session/update",
        json!({"sessionId": session_id, "update": {"sessionUpdate": "session_info_update",
                                                    "_meta": {"atelier": {"outOfTurn": ended}}}}),
    ));
    let Some(held) = state.held.take() else { return };
    state.prompt = Some(held.id.clone());
    drop(state);
    // 이 자리(claude를 읽는 스레드)에서 쓰지 않는다 — claude의 stdin이 막히면 그 stdout을 비울 손이 없다.
    let (stdin, shared) = (Arc::clone(stdin), Arc::clone(shared));
    std::thread::spawn(move || put_prompt(&stdin, &held.id, &held.line, &shared));
}

/// 가리기 — claude의 원문 한 줄에서 계정이 실리는 두 자리를 바꾼다. 나머지는 원문 그대로다.
/// - `initialize` 답의 `account` 아래 글자 값은 다 `<email>`이다(이메일 · 조직 · 플랜). Codex의 `_auth/status_update`와 같은 규칙이다.
/// - `system/init`의 `plugins[].path`는 `<path>`다 — 동기된 플러그인의 경로에 조직 · 계정 id가 든다.
fn mask(line: &mut Value) {
    fn mask_strings(value: &mut Value) {
        match value {
            Value::String(text) => *text = "<email>".to_string(),
            Value::Array(items) => items.iter_mut().for_each(mask_strings),
            Value::Object(fields) => fields.values_mut().for_each(mask_strings),
            _ => {}
        }
    }
    if let Some(account) = line.pointer_mut("/response/response/account") {
        mask_strings(account);
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

/// 세션이 열리기 전에 claude가 `result`를 냈다 — 열지 못한 것이다. 되살리기면 claude가 준 까닭(「그런 세션이 없다」)으로 그
/// 요청에 답하고, 같은 id의 다음 단계(load)가 claude를 다시 띄우지 않게 기억한다.
fn not_opened(result: &Value, shared: &Shared) {
    let mut state = shared.lock();
    let Some(opening) = state.opening.take() else { return };
    let errors: Vec<&str> = result["errors"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    let why = if errors.is_empty() { result["subtype"].as_str().unwrap_or("result").to_owned() } else { errors.join(" · ") };
    let reason = if opening.revive {
        format!("claude가 세션을 되살리지 못했습니다: {why}")
    } else {
        format!("claude가 세션을 열지 못했습니다: {why}")
    };
    send(&error(&opening.id, -32603, &reason));
    state.open_failed = true;
    if opening.revive {
        state.forgotten = Some((opening.session_id, reason));
    }
}

/// claude가 stdout을 닫았다.
/// - 끄는 중이면 아무것도 하지 않는다.
/// - 세션을 여는 중이면 `session/new`에 오류로 답한다 — 호스트가 열기 실패로 받고 변환기를 끈다.
/// - 세션이 열린 뒤면 변환기도 끝난다 — 호스트가 수신 EOF로 프로세스 죽음을 안다. claude의 stderr는 이미 흘렸다.
fn claude_closed(shared: &Shared, child: &Mutex<Child>) {
    let mut state = shared.lock();
    if state.closing {
        return;
    }
    let status = child.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).wait();
    let ended = match &status {
        Ok(status) => format!("{status}"),
        Err(error) => error.to_string(),
    };
    if let Some(opening) = state.opening.take() {
        send(&error(&opening.id, -32603, &format!("claude가 initialize에 답하지 않고 끝났습니다 ({ended})")));
        state.open_failed = true;
        return;
    }
    if state.open {
        eprintln!("변환기: claude가 끝났습니다 ({ended})");
        std::process::exit(status.ok().and_then(|status| status.code()).filter(|code| *code != 0).unwrap_or(1));
    }
}

fn reply(id: &Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn error(id: &Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn notify(method: &str, params: Value) -> Value {
    json!({"jsonrpc": "2.0", "method": method, "params": params})
}

/// ACP 한 줄을 stdout에 쓴다. 두 스레드가 쓰므로 줄 하나를 잠금 하나로 쓴다. 호스트가 떠났으면 쓰기가 실패하고, 할 일이 없다.
fn send(message: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{message}").and_then(|()| out.flush());
}
