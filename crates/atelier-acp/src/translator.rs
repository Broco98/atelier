//! Claude 변환기 — 앱 실행 파일의 하위 모드 `acp-claude`로 도는 ACP 에이전트(three-axes 결정 12, 워크플로 S4).
//! `claude -p` 하나를 쥐고 stream-json ↔ ACP를 옮긴다. 호스트에게는 codex-acp와 같은 「stdio로 ACP를 말하는 자식」이다.
//!
//! - **ACP 세션 하나 = 변환기 하나 = `claude` 하나.** `claude`는 변환기의 프로세스 그룹 안에 띄운다(새 세션에 두지 않는다)
//!   — 호스트가 변환기를 새 세션에 띄우고 끌 때 그룹째 SIGKILL하므로 claude와 그 MCP 자식들도 함께 끝난다.
//! - **ACP 쪽은 손으로 짠 줄 단위 응답기다.** 받는 메서드가 몇 안 되고, claude의 답을 기다리는 동안 ACP 요청의 답을 미루고
//!   claude가 보낸 순서대로 내보내는 일을 직접 쥐어야 한다.
//! - **stdin EOF면 claude의 stdin을 닫고 끝난다** — 앱이 비정상으로 끝나도(호스트가 그룹을 끄지 못해도) 고아가 남지 않는다.
//!
//! 이 장(티켓 13)이 세우는 것은 세션 열기까지다 — 띄우기 플래그 · 띄운 직후 stdin `initialize`(S1) · 판 · 가리기.
//! 말은 stdin user 줄로 넣기까지만 하고(첫 `system/init`이 그 뒤에 오므로), 턴의 이벤트와 끝을 옮기는 것은 14다.
//! 멈추기 · 권한 · 모드와 모델 바꾸기는 15, 되살리기 · 백그라운드 · 미로그인은 16이다.
//!
//! **가리기.** claude의 원문을 처음 읽는 자리가 여기라, 읽자마자 두 자리를 가린다 — 이 뒤로 ACP에 실려 기록으로 가는 것에는
//! 계정이 남지 않는다(워크플로 S34 · 스토리 115). `initialize` 답의 `account`(이메일 · 조직 · 플랜, 워크플로 함정 19)는
//! `<email>`로, `system/init`의 `plugins[].path`(조직 · 계정 id가 실린다, 실측 함정 39)는 `<path>`로 바꾼다.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// stdin EOF 뒤 claude가 스스로 끝나기를 기다리는 시간. 진짜 claude 2.1.296은 1~1.6초에 끝났다(판 02 실측 G5). 넘으면
/// claude를 끈다 — 호스트가 없어 그룹째 끄는 손이 없을 때도 고아가 남지 않게.
const CLAUDE_EOF_GRACE: Duration = Duration::from_secs(5);

/// 모드 다섯 — claude의 모드 이름 그대로다(three-axes 결정 16 · 27). `bypassPermissions`는 띄울 때 허락하지 않았으면 도중에
/// 고를 수 없으므로(`bypass_not_launched`, 실측 함정 38) 넣지 않는다.
const MODES: [&str; 5] = ["default", "acceptEdits", "auto", "dontAsk", "plan"];

/// 띄운 직후 보내는 stdin `initialize`의 요청 id.
const INITIALIZE_REQUEST: &str = "atelier-initialize";

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
        // id가 없으면 알림이다. 이 장은 받는 알림이 없다(멈추기는 15).
        let Some(id) = message.get("id").cloned() else { continue };
        let params = &message["params"];
        match message["method"].as_str().unwrap_or_default() {
            "initialize" => send(&reply(&id, initialize_result())),
            "session/prompt" => match session.as_mut() {
                Some(session) => session.prompt(&id, params),
                None => send(&error(&id, -32602, "열린 세션이 없습니다")),
            },
            "session/new" if session.is_some() => send(&error(&id, -32600, "이 변환기는 이미 세션을 열었습니다 — 세션 하나에 변환기 하나다")),
            "session/new" => match Session::open(&id, params, &shared) {
                Ok(opened) => session = Some(opened),
                Err(reason) => send(&error(&id, -32603, &reason)),
            },
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
fn initialize_result() -> Value {
    json!({
        "protocolVersion": 1,
        "agentCapabilities": {"loadSession": false},
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
    /// stdin EOF를 받아 끄는 중이다 — 이 뒤의 claude의 끝은 죽음이 아니다.
    closing: bool,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, SharedState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// 세션을 여는 중인 `session/new` — claude의 `initialize` 답으로 짓는다.
struct Opening {
    id: Value,
    session_id: String,
    model: Option<String>,
}

/// 쥔 `claude` 하나.
struct Session {
    stdin: Option<ChildStdin>,
    child: Arc<Mutex<Child>>,
    /// 답하지 않은 `session/prompt`가 있다 — 턴이 돈다.
    prompting: bool,
}

impl Session {
    /// `session/new` — claude를 띄우고 stdin `initialize`를 보낸다(S1, three-axes 결정 27). 답은 claude를 읽는 스레드가
    /// 받아 `session/new`에 답한다.
    ///
    /// 받는 것(`params`): `cwd` · `additionalDirectories`(함께 여는 폴더) · `_meta.atelier{claudePath, permissionMode, model}`.
    /// `mcpServers`는 보지 않는다 — 사용자 MCP와 커넥터는 `claude -p`가 스스로 붙인다(three-axes 결정 23).
    fn open(id: &Value, params: &Value, shared: &Arc<Shared>) -> Result<Self, String> {
        let cwd = params["cwd"].as_str().ok_or("session/new에 cwd가 없습니다")?;
        let atelier = &params["_meta"]["atelier"];
        let claude = atelier["claudePath"].as_str().unwrap_or("claude");
        let mode = atelier["permissionMode"].as_str();
        let model = atelier["model"].as_str();
        let session_id = uuid::Uuid::new_v4().to_string();

        let mut args: Vec<&str> = vec![
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--permission-prompt-tool",
            "stdio",
            "--session-id",
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
        let mut stdin = child.stdin.take().expect("stdin을 파이프로 띄웠다");
        let stdout = child.stdout.take().expect("stdout을 파이프로 띄웠다");
        let child = Arc::new(Mutex::new(child));

        shared.lock().opening = Some(Opening { id: id.clone(), session_id, model: model.map(str::to_owned) });
        read_claude(stdout, Arc::clone(shared), Arc::clone(&child));
        let initialize = json!({"type": "control_request", "request_id": INITIALIZE_REQUEST, "request": {"subtype": "initialize"}});
        // 쓰지 못했으면 claude가 이미 끝난 것이다 — 읽는 스레드가 EOF를 보고 `session/new`에 답한다.
        let _ = writeln!(stdin, "{initialize}").and_then(|()| stdin.flush());
        Ok(Self { stdin: Some(stdin), child, prompting: false })
    }

    /// `session/prompt` 하나 = stdin user 줄 하나. 첫 말도 `system/init`을 기다리지 않고 넣는다(워크플로 함정 6) — init은
    /// 첫 user 줄을 받은 뒤에야 온다. 깨진 줄 하나가 claude를 끝내므로 변환기가 지은 봉투만 쓴다(워크플로 함정 4).
    ///
    /// - 턴 도중의 둘째 말은 stdin에 쓰지 않고 오류로 답한다 — 쓰면 그 턴에 합쳐진다(three-axes 결정 20). 대기 줄은 호스트가
    ///   쥔다.
    /// - 이 장은 답하지 않는다 — `result`를 턴 끝으로 옮기는 것은 티켓 14다.
    fn prompt(&mut self, id: &Value, params: &Value) {
        if self.prompting {
            send(&error(id, -32603, "턴이 도는 중입니다 — 턴 도중의 말은 그 턴에 합쳐지므로 넣지 않습니다"));
            return;
        }
        let content: Vec<Value> = params["prompt"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|block| block["type"] == "text")
            .map(|block| json!({"type": "text", "text": block["text"]}))
            .collect();
        let line = json!({
            "type": "user",
            "message": {"role": "user", "content": content},
            "parent_tool_use_id": null,
            "session_id": "",
        });
        let Some(stdin) = self.stdin.as_mut() else { return };
        match writeln!(stdin, "{line}").and_then(|()| stdin.flush()) {
            Ok(()) => self.prompting = true,
            Err(failed) => send(&error(id, -32603, &format!("claude에 말을 넣지 못했습니다: {failed}"))),
        }
    }

    /// stdin EOF — claude의 stdin을 닫고 스스로 끝나기를 기다린다. 넘으면 claude를 끈다.
    fn finish(mut self, shared: &Shared) -> i32 {
        shared.lock().closing = true;
        drop(self.stdin.take());
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

/// claude의 stdout을 줄 단위로 읽는 스레드.
fn read_claude(stdout: ChildStdout, shared: Arc<Shared>, child: Arc<Mutex<Child>>) {
    std::thread::spawn(move || {
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
            } else if line["type"] == "system" && line["subtype"] == "init" {
                announce_init(line, &shared);
            }
            // 그 밖의 줄(턴의 이벤트)은 티켓 14가 옮긴다.
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
    let result = json!({
        "sessionId": opening.session_id,
        "modes": {
            "currentModeId": current_mode,
            "availableModes": MODES.iter().map(|mode| json!({"id": mode, "name": mode})).collect::<Vec<_>>(),
        },
        // S1 — 모델 목록은 codex-acp와 같은 모양(`configOptions`의 id `model`)으로 낸다. 화면이 엔진을 가리지 않고 모델 칩을
        // 짓는다. 「엔진 기본값」이면 claude의 `default`(사용자의 모델 설정)다.
        "configOptions": [{
            "id": "model",
            "name": "Model",
            "description": "Claude가 이 대화에 쓰는 모델",
            "category": "model",
            "type": "select",
            "currentValue": opening.model.as_deref().unwrap_or("default"),
            "options": model_options,
        }],
        // claude의 `initialize` 답 원문(계정 칸은 가렸다) — claude의 판 · 지금 모드 · 에이전트 목록이 든다. 호스트가 열림 줄에
        // 싣는다(평가의 재료, three-axes 결정 18).
        "_meta": {"claudeCode": {"initialize": init}},
    });
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
