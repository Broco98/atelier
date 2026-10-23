//! Thread 도구 — Atelier가 Agent에게 MCP로 주는 도구(v1 구현 스펙 §7 · S12 · S13, v1 티켓 15).
//!
//! **길은 넷을 거친다.** Thread 엔진이 Session을 열 때 ACP `mcpServers`에 이 서버를 하나 넣는다 → Claude 변환기가 claude의
//! `--mcp-config`로 옮긴다(v1 티켓 12) → claude가 이 실행 파일을 하위 모드 `thread-tools`로 띄운다 → 이 중계 서버가 도구 호출을
//! 그 Session의 Unix 소켓으로 엔진에 넘기고 답을 돌려준다.
//!
//! - **엔진은 소켓으로 부른 이를 안다.** 소켓은 Session(Thread, 참여자)마다 하나이고 엔진이 연다([`Bridge`]) — 그래서 도구 인자에
//!   Thread id를 받지 않는다. 소켓은 사용자만 여는 임시 폴더(0700)에 두고, Session을 끄면 폴더째 치운다.
//! - **중계 서버는 도구를 모른다.** MCP의 맞이(`initialize` · `ping`)만 스스로 답하고, 도구 목록과 도구 호출은 소켓으로 넘긴다. 무슨
//!   도구가 있고 무엇을 하는지는 엔진이 안다 — 목록과 인자 읽기는 이 모듈의 [`list`] · [`read_call`], 하는 일은 호스트다.
//! - **손으로 짠 줄 단위 JSON-RPC다.** 이 크레이트는 tokio를 쓰지 않는다(Cargo.toml) — 받는 메서드가 넷뿐이고, 변환기도 같은 꼴로
//!   ACP에 답한다(결정.md 15). 호출마다 스레드 하나 · 소켓 연결 하나라 오래 걸리는 도구(Agent 부르기, v1 티켓 16)가 다른 호출을
//!   막지 않는다.
//!
//! 소켓의 말은 연결마다 한 번 주고받는다 — 중계 서버가 `{"method", "params"}` 한 줄을 쓰고, 엔진이 `{"result"}` 또는
//! `{"error": {code, message}}` 한 줄로 답한 뒤 닫는다.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::host::TranslatorCommand;
use crate::process;

/// 앱 실행 파일이 Thread 도구 중계 서버가 되는 하위 모드의 이름 — 첫 인자가 정확히 이것이면 진입점이 Tauri를 짓지 않고
/// [`run_thread_tools`]로 간다. 띄우는 쪽(엔진이 넣는 `mcpServers`)과 받는 쪽(진입점)이 이 상수 하나를 함께 쓴다.
pub const THREAD_TOOLS_MODE: &str = "thread-tools";

/// claude가 보는 서버 이름 — 도구는 `mcp__atelier-thread__<도구>`로 선다. 사용자가 설치한 `atelier mcp`(흔히 `atelier`)와 따로다
/// (§7) — 이름이 같으면 한쪽이 다른 쪽을 가린다.
pub(crate) const SERVER_NAME: &str = "atelier-thread";

/// 이 서버가 말하는 MCP 판 — 새것부터. 클라이언트가 이 가운데 하나를 물으면 그것으로, 아니면 맨 앞의 것으로 답한다. 쓰는 것(도구
/// 목록 · 부르기 · 글 결과)은 네 판이 같다.
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/// 서버가 맞이에서 건네는 쓰는 법 — claude가 Agent에게 보인다. 도구마다의 것은 도구의 설명에 있다.
const INSTRUCTIONS: &str = "이 서버의 도구는 지금 이 Atelier Thread를 다룬다. Thread id는 넘기지 않는다 — 부른 Session의 Thread다.";

/// 「Thread 이름 바꾸기」(S13).
const RENAME_THREAD: &str = "rename_thread";

/// 받기에 실패한 뒤 다시 받기까지 쉬는 틈 — 파일 기술자가 바닥난 때처럼 곧바로 다시 실패하는 오류에 헛돌지 않게.
const ACCEPT_RETRY: Duration = Duration::from_millis(10);

/// 중계 서버의 몸통 — 앱 진입점의 `thread-tools` 갈래([`THREAD_TOOLS_MODE`])와 중계 서버 시험 bin이 이것 하나를 부른다. `socket`은
/// 엔진이 연 그 Session의 소켓이다(띄우는 명령의 마지막 인자). stdin이 닫히면(claude가 서버를 거두면) 끝난다. **stdout이 곧 MCP
/// 선이다** — 이 함수 밖에서 stdout에 아무것도 쓰지 않는다.
pub fn run_thread_tools(socket: Option<OsString>) -> i32 {
    let Some(socket) = socket.map(PathBuf::from) else {
        eprintln!("Thread 도구: 엔진의 소켓 경로를 받지 못했습니다 — `{THREAD_TOOLS_MODE} <소켓>`으로 띄웁니다");
        return 2;
    };
    process::for_each_line(std::io::stdin().lock(), |buf| {
        // 알림(`notifications/initialized` · `notifications/cancelled`)과 읽을 수 없는 줄에는 답하지 않는다.
        let Ok(message) = serde_json::from_slice::<Value>(buf) else { return };
        let (Some(id), Some(method)) = (message.get("id").cloned(), message["method"].as_str()) else { return };
        let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
        match method {
            "initialize" => answer(&id, Ok(welcome(&params))),
            "ping" => answer(&id, Ok(json!({}))),
            "tools/list" | "tools/call" => {
                let (socket, method) = (socket.clone(), method.to_owned());
                std::thread::spawn(move || answer(&id, ask(&socket, &method, &params)));
            }
            _ => answer(&id, Err(Fault::unknown_method(method))),
        }
    });
    0
}

/// `initialize`의 답 — 판 · 능력(도구) · 이름 · 쓰는 법.
fn welcome(params: &Value) -> Value {
    json!({
        "protocolVersion": agreed(params["protocolVersion"].as_str()),
        "capabilities": {"tools": {}},
        "serverInfo": {"name": SERVER_NAME, "title": "Atelier Thread", "version": env!("CARGO_PKG_VERSION")},
        "instructions": INSTRUCTIONS,
    })
}

/// 클라이언트가 물은 판에 맞춘 판 — 아는 판이면 그것, 아니면 아는 것 가운데 가장 새 판이다(MCP 맞이 규칙).
fn agreed(asked: Option<&str>) -> &'static str {
    PROTOCOL_VERSIONS.iter().copied().find(|known| Some(*known) == asked).unwrap_or(PROTOCOL_VERSIONS[0])
}

/// 소켓으로 엔진에 묻는다. 닿지 못하면(Session이 끝났다) 도구 호출은 그 까닭을 도구의 실패로 돌려준다 — Agent가 글로 읽는다.
fn ask(socket: &Path, method: &str, params: &Value) -> Result<Value, Fault> {
    let asked = (|| -> std::io::Result<Value> {
        let mut stream = UnixStream::connect(socket)?;
        writeln!(stream, "{}", json!({"method": method, "params": params}))?;
        let mut line = String::new();
        BufReader::new(stream).read_line(&mut line)?;
        serde_json::from_str(&line).map_err(std::io::Error::other)
    })();
    match asked {
        Ok(reply) => match reply.get("error") {
            Some(error) => Err(Fault::new(error["code"].as_i64().unwrap_or(-32603), error["message"].as_str().unwrap_or_default())),
            None => Ok(reply["result"].clone()),
        },
        Err(error) if method == "tools/call" => Ok(said(&format!("Atelier Thread에 닿지 못했다 — {error}"), true)),
        Err(error) => Err(Fault::new(-32603, format!("Atelier Thread에 닿지 못했다 — {error}"))),
    }
}

/// JSON-RPC 답 한 줄을 stdout에 쓴다. 답은 여러 스레드가 쓰므로 줄마다 stdout을 잠근다. claude가 떠났으면 쓸 곳이 없다.
fn answer(id: &Value, outcome: Result<Value, Fault>) {
    let message = match outcome {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err(fault) => json!({"jsonrpc": "2.0", "id": id, "error": fault.to_json()}),
    };
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{message}").and_then(|()| out.flush());
}

/// JSON-RPC 오류 — 도구 호출의 실패가 아니라 요청 자체가 틀렸다(모르는 메서드 · 모르는 도구).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Fault {
    code: i64,
    message: String,
}

impl Fault {
    fn new(code: i64, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    /// 모르는 메서드(`-32601`).
    pub(crate) fn unknown_method(method: &str) -> Self {
        Self::new(-32601, format!("모르는 메서드입니다: {method}"))
    }

    /// 호스트가 꺼졌다 — 앱이 끝나는 중이다.
    pub(crate) fn gone() -> Self {
        Self::new(-32603, "Atelier가 끝나는 중입니다")
    }

    fn to_json(&self) -> Value {
        json!({"code": self.code, "message": self.message})
    }
}

// ── 엔진 쪽 소켓 ────────────────────────────────────────────────────────────────

/// 엔진이 도구 호출에 답하는 손 — (메서드, params) → MCP 결과 또는 JSON-RPC 오류. 연결마다의 스레드에서 불린다.
pub(crate) type Answer = Arc<dyn Fn(&str, &Value) -> Result<Value, Fault> + Send + Sync>;

/// Session 하나의 소켓 — 그 Session의 중계 서버가 닿는 곳이다. 연결마다 스레드 하나가 [`Answer`]로 답한다. 놓으면(drop) 받기를
/// 그치고 폴더째 치운다 — Session의 프로세스를 끌 때 함께 놓인다.
pub(crate) struct Bridge {
    dir: PathBuf,
    socket: PathBuf,
    closed: Arc<AtomicBool>,
}

impl Bridge {
    /// 사용자만 여는 새 임시 폴더에 소켓을 열고 받기 시작한다.
    pub(crate) fn open(answer: Answer) -> std::io::Result<Self> {
        let dir = private_dir()?;
        let socket = dir.join("s");
        let listener = match UnixListener::bind(&socket) {
            Ok(listener) => listener,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&dir);
                return Err(error);
            }
        };
        let closed = Arc::new(AtomicBool::new(false));
        let closing = Arc::clone(&closed);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if closing.load(Ordering::SeqCst) {
                    return;
                }
                match stream {
                    Ok(stream) => {
                        let answer = Arc::clone(&answer);
                        std::thread::spawn(move || serve(&stream, &*answer));
                    }
                    Err(_) => std::thread::sleep(ACCEPT_RETRY),
                }
            }
        });
        Ok(Self { dir, socket, closed })
    }

    /// ACP `mcpServers`의 한 칸 — 중계 서버 명령(앱에서는 이 실행 파일 + `thread-tools`)에 이 소켓을 마지막 인자로 붙인 stdio
    /// 서버다(ACP stdio는 `type`이 없다 — v1 티켓 12).
    pub(crate) fn server(&self, relay: &TranslatorCommand) -> Value {
        let mut args: Vec<Value> = relay.args.iter().map(|arg| json!(arg.to_string_lossy())).collect();
        args.push(json!(self.socket));
        json!({"name": SERVER_NAME, "command": relay.program, "args": args, "env": []})
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
        // 받기에 막힌 스레드를 깨운다 — 깨어나 닫힘을 보고 끝나며 듣는 소켓도 함께 닫힌다. 기다리지는 않는다.
        let _ = UnixStream::connect(&self.socket);
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// 이 사용자만 여는(0700) 새 폴더 — 시스템 임시 폴더 아래, 겹치지 않는 이름이다. 이미 있으면 만들지 않고 실패한다(남이 미리 둔
/// 폴더 · 링크를 쓰지 않는다). 이름을 짧게 둔다 — 소켓 경로는 100바이트 남짓이 한도다.
fn private_dir() -> std::io::Result<PathBuf> {
    let name = format!("atelier-{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
    let dir = std::env::temp_dir().join(name);
    std::fs::DirBuilder::new().mode(0o700).create(&dir)?;
    // umask가 무엇이든 0700이다.
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    Ok(dir)
}

/// 연결 하나 — 요청 한 줄을 읽고 답 한 줄을 쓴다.
fn serve(stream: &UnixStream, answer: &(dyn Fn(&str, &Value) -> Result<Value, Fault> + Send + Sync)) {
    let mut line = String::new();
    if BufReader::new(stream).read_line(&mut line).is_err() || line.trim().is_empty() {
        return;
    }
    let reply = match serde_json::from_str::<Value>(&line) {
        Ok(asked) => match answer(asked["method"].as_str().unwrap_or_default(), &asked["params"]) {
            Ok(result) => json!({"result": result}),
            Err(fault) => json!({"error": fault.to_json()}),
        },
        Err(_) => json!({"error": Fault::new(-32700, "읽을 수 없는 요청입니다").to_json()}),
    };
    let mut stream = stream;
    let _ = writeln!(stream, "{reply}");
}

// ── 도구 ──────────────────────────────────────────────────────────────────────

/// 읽은 도구 호출 하나(S13). PR ②의 나머지(Agent 부르기 · Agent 저장)와 PR ④의 넷이 여기 갈래를 더한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Call {
    /// Thread 이름 바꾸기 — 새 이름.
    RenameThread { title: String },
}

/// 도구 호출을 읽지 못한 까닭.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Unread {
    /// 모르는 도구 — 요청이 틀렸다(JSON-RPC 오류).
    Unknown(Fault),
    /// 인자가 틀렸다 — 도구의 실패로 돌려 Agent가 고쳐 부르게 한다.
    Bad(String),
}

/// `tools/list`의 답 — 도구들과 그 인자 꼴. 설명은 Agent가 읽는 쓰는 법이다(S42).
pub(crate) fn list() -> Value {
    json!({"tools": [{
        "name": RENAME_THREAD,
        "title": "Thread 이름 바꾸기",
        "description": "이 Thread의 이름을 바꾼다. 사람이 사이드바와 Thread 위에서 보는 이름이다. 일이 무엇인지 드러나게 \
                        짧게 짓는다 — 한 줄이고, 줄바꿈은 빈칸 하나가 된다.",
        "inputSchema": {
            "type": "object",
            "properties": {"title": {"type": "string", "description": "새 이름"}},
            "required": ["title"],
            "additionalProperties": false,
        },
    }]})
}

/// `tools/call`의 params(`name` · `arguments`)를 읽는다.
pub(crate) fn read_call(params: &Value) -> Result<Call, Unread> {
    let name = params["name"].as_str().unwrap_or_default();
    let arguments = &params["arguments"];
    match name {
        RENAME_THREAD => match arguments["title"].as_str() {
            Some(title) => Ok(Call::RenameThread { title: title.to_owned() }),
            None => Err(Unread::Bad("title(새 이름)을 글로 주세요".to_owned())),
        },
        _ => Err(Unread::Unknown(Fault::new(-32602, format!("모르는 도구입니다: {name}")))),
    }
}

/// 도구의 결과 — 글 하나. `refused`면 도구의 실패(`isError`)다 — Agent가 그 까닭을 읽고 고쳐 부른다.
pub(crate) fn said(text: &str, refused: bool) -> Value {
    let mut result = json!({"content": [{"type": "text", "text": text}]});
    if refused {
        result["isError"] = json!(true);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 맞이의_판은_클라이언트가_물은_아는_판이고_모르면_가장_새_판이다() {
        assert_eq!(agreed(Some("2025-06-18")), "2025-06-18");
        assert_eq!(agreed(Some("2024-11-05")), "2024-11-05");
        assert_eq!(agreed(Some("2099-01-01")), "2025-11-25");
        assert_eq!(agreed(None), "2025-11-25");
    }

    #[test]
    fn 이름_바꾸기는_글_이름을_받고_모르는_도구는_요청_오류이고_틀린_인자는_도구의_실패다() {
        let call = |params: Value| read_call(&params);
        assert_eq!(
            call(json!({"name": "rename_thread", "arguments": {"title": "환불 API 버그"}})),
            Ok(Call::RenameThread { title: "환불 API 버그".into() })
        );
        assert!(matches!(call(json!({"name": "rename_thread", "arguments": {}})), Err(Unread::Bad(_))));
        assert!(matches!(call(json!({"name": "rename_thread", "arguments": {"title": 3}})), Err(Unread::Bad(_))));
        assert_eq!(
            call(json!({"name": "delete_thread", "arguments": {}})),
            Err(Unread::Unknown(Fault::new(-32602, "모르는 도구입니다: delete_thread")))
        );
        let listed: Vec<Value> = list()["tools"].as_array().unwrap().iter().map(|tool| tool["name"].clone()).collect();
        assert_eq!(listed, [json!("rename_thread")], "목록과 읽는 도구가 같다");
    }
}
