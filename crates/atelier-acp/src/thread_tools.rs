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

/// 「Agent 부르기」(S13 · §8, v1 티켓 16).
pub(crate) const CALL_AGENT: &str = "call_agent";

/// 「Agent 저장」(S13, v1 티켓 19).
pub(crate) const SAVE_AGENT: &str = "save_agent";

/// 「Project 목록」(S13, v1 티켓 30).
pub(crate) const LIST_PROJECTS: &str = "list_projects";

/// 「Work 읽기」(S13, v1 티켓 30).
pub(crate) const GET_WORK: &str = "get_work";

/// 「Work 만들기 제안」(S13 · §11, v1 티켓 30).
pub(crate) const PROPOSE_WORK: &str = "propose_work";

/// 「Project 고치기 시작」(S13 · §11 S21 · S22, v1 티켓 32). 판정의 Work 밖 편집 거절 글이 이 이름을 가리킨다(`policy.rs`).
pub(crate) const START_EDITING: &str = "start_editing";

/// 「Space 목록」(03 구현 스펙 §11 · 티켓 08).
pub(crate) const LIST_SPACES: &str = "list_spaces";

/// 「Space 붙이기」(03 구현 스펙 §11 · S11 · S12 · 티켓 08).
pub(crate) const SET_SPACE: &str = "set_space";

/// 「Project 추가」(03 구현 스펙 §12 · 티켓 12).
pub(crate) const ADD_PROJECT: &str = "add_project";

/// 「Project 고치기」(03 구현 스펙 §12 · 티켓 12).
pub(crate) const EDIT_PROJECT: &str = "edit_project";

/// 「Space 만들기」(03 구현 스펙 §12 · S6 · 티켓 12).
pub(crate) const CREATE_SPACE: &str = "create_space";

/// 「Space 고치기」(03 구현 스펙 §12 · 티켓 12).
pub(crate) const EDIT_SPACE: &str = "edit_space";

/// 대화로 하는 설정 넷이 함께 지키는 것(§12 · S13) — 묻지 않고 하는 일, 결과 카드, 지우는 도구가 없다는 것.
const SETTING_NOTE: &str = "사람이 대화로 부탁한 설정이다 — 승인 카드 없이 곧바로 하고, 흐름에 결과 카드가 서서 사람이 그 카드의 단추(Project \
추가 · 고치기와 Space 만들기는 「열기」, Space 고치기는 「관계 보기」)로 그 화면에서 다시 고친다. 화면에서 하는 것과 같은 파일을 같은 꼴로 \
쓴다. Project 제거 · Space 삭제는 도구가 없다 — 화면에서만 한다.";

/// 「Project 추가」의 쓰는 법 — 폴더의 갈래마다 무엇이 일어나는지(§12 · §15).
const ADD_PROJECT_GUIDE: &str = "사람의 폴더(git 저장소 하나)를 Atelier의 Project로 등록한다. 사람이 폴더를 등록해 달라고 할 때 부른다.\n\n\
- git 저장소의 뿌리면 곧바로 등록한다 — 기준 브랜치는 origin/HEAD → 지금 브랜치 → main 차례로 정한다.\n\
- 이미 등록된 폴더면 아무것도 바꾸지 않고 그 Project를 돌려준다.\n\
- git 저장소가 아니면 사람에게 질문 카드(「git init 하고 추가」 · 「추가하지 않기」)로 묻고, 저장소 안의 하위 폴더면 「뿌리 폴더로 추가」 · \
「그대로 추가」 · 「추가하지 않기」를 묻는다 — 사람이 고를 때까지 기다리고, 고른 대로 한다.\n\n";

/// 「Project 고치기」의 쓰는 법 — 기준 브랜치의 규칙(§15 「고치기」 · S19).
const EDIT_PROJECT_GUIDE: &str = "등록된 Project의 이름 · 설명 · 기준 브랜치를 고친다. 준 칸만 바꾼다. slug(파일 이름)와 폴더는 바꾸지 않는다.\n\n\
- 기준 브랜치는 그 저장소에 이미 있는 브랜치만 받는다 — list_projects의 git.localBranches · git.remoteBranches[].branches에서 고른다(원격 \
브랜치는 origin/release/2.5처럼 그 이름 그대로). Atelier는 fetch하지 않는다. 없는 브랜치면 실패하고 고를 수 있는 브랜치를 돌려준다.\n\
- 새 기준 브랜치는 새 Work부터 든다.\n\n";

/// 「Space 만들기」의 쓰는 법 — 초안을 먼저 보이는 지시(§12 · 티켓 06 「Host와 만들기」).
const CREATE_SPACE_GUIDE: &str = "Space(함께 다루는 Project의 묶음)를 새로 만든다 — `~/.atelier/spaces/<slug>.md` 파일 하나다. slug는 이름에서 \
화면과 같은 규칙으로 짓는다(한글 유지 · 겹치면 -2). 만들기 전에 이름 · Project · 설명의 초안을 사람에게 보이고, 사람이 좋다고 하면 부른다.\n\n\
- projects는 등록된 Project의 slug(list_projects)다 — 비워도 된다(빈 Space).\n\
- 파일에 문제가 생기면(등록되지 않은 Project · 같은 Project 두 번 · 빈 이름) 만들지 않고 그 문제를 돌려준다.\n\n";

/// 「Space 고치기」의 쓰는 법(§12 · §8 「고치기」).
const EDIT_SPACE_GUIDE: &str = "Space의 이름 · 설명을 고치고 Project를 넣고 뺀다. 준 칸만 바꾸고 파일의 나머지 글(주석 · 차례 · 모르는 칸)은 \
그대로 둔다. 이름을 고쳐도 파일 이름(slug)은 그대로다. 그 Space로 읽는 Thread는 다음 말부터 바뀐 Project를 읽는다.\n\n\
- add · remove는 Project의 slug(list_projects) 목록이다. 이미 든 것을 넣거나 없는 것을 빼면 그대로다.\n\
- 고친 글에 새 문제가 생기면(등록되지 않은 Project · 빈 이름) 쓰지 않고 그 문제를 돌려준다.\n\n";

/// 「Space 붙이기」의 쓰는 법 — 언제 부르고, Atelier가 언제 묻지 않고 붙이며 언제 사람에게 묻는지, 답이 무엇인지(S42). 묻지 않고 붙이는
/// 때(「알아서」 · 지금 Space 없음 · 맞는 Space가 넘긴 것 하나)는 Atelier가 지킨다 — Agent가 고르지 않는다(S12).
const SET_SPACE_GUIDE: &str = "이 Thread의 Space를 붙이고 · 바꾸고 · 뺀다(space를 비우면 Space 없이). Space는 함께 다루는 Project의 묶음이고, \
붙으면 이 Thread는 그 Space의 Project만 읽는다. 다루는 Project가 정해지면 list_spaces로 그 Project를 담은 Space를 보고 부른다. 이미 \
붙어 있으면 바꿀 까닭이 있을 때만 부른다. Work에 이은 Thread면 그 Work의 Space가 바뀐다 — 그 Work의 다른 Thread도 함께 바뀐다.\n\n\
- Atelier가 projects를 모두 담은 Space들(없으면 하나라도 담은 Space들)을 후보로 세우고, 넘긴 space를 추천으로 맨 위에 둔다.\n\
- 물어보는 정도가 「알아서」이고 지금 Space가 없으며 후보가 넘긴 Space 하나뿐이면 묻지 않고 붙인다(projects를 담은 Space가 없으면 묻는다). 그 밖에는 사람의 입력창 자리에 \
질문 카드(「어느 Space에서 할까요?」)가 서고 사람이 고를 때까지 기다린다 — 결과로 사람이 고른 Space가 온다. 「나중에」면 아무것도 \
바꾸지 않는다 — 같은 물음을 곧바로 다시 하지 않는다.\n\
- 바뀐 범위는 다음 말부터다 — 이번 턴에는 지금 함께 연 폴더를 그대로 읽는다.";

/// 「Work 만들기 제안」의 쓰는 법 — 언제 부르고, 카드에서 사람이 무엇을 고치고, 답이 무엇인지(S42). 사람이 설치한 `atelier` MCP로 Work를
/// 만들면 Thread가 이어지지 않으므로 그 길을 막는 말도 여기 둔다(§7).
const PROPOSE_WORK_GUIDE: &str = "이 Thread의 일을 Work로 묶자고 사람에게 묻는다. 일이 커지면 부른다 — 여러 파일을 고치거나 \
며칠 이어질 일이다. 먼저 list_projects로 고칠 Project와 그 저장소의 브랜치 이름 규칙(localBranches)을 본다.\n\n\
사람의 입력창 자리에 Work 만들기 카드가 서고, 사람이 고를 때까지 기다린다. 사람은 카드에서 Project를 넣고 빼고 브랜치 이름을 고친 \
뒤 「Work 만들기」나 「Work 없이 계속」을 고른다.\n\
- 만들면 이 Thread가 그 Work에 이어지고, 결과로 Work의 spec 폴더(설계 문서를 쓰는 곳) · 브랜치 · Project가 온다. 사람이 고친 \
것이 정본이다. worktree는 아직 없다 — Project는 처음 고칠 때까지 읽기만이다.\n\
- 「Work 없이 계속」이면 Work 없이 이 Thread에서 이어 간다. 같은 제안을 곧바로 다시 하지 않는다.\n\n\
Work는 사람이 설치한 atelier MCP의 atelier_start_work가 아니라 이 도구로 만든다 — 그래야 이 Thread가 그 Work에 이어진다. 이미 \
Work에 이어진 Thread에서는 부를 수 없다(get_work로 그 Work를 읽는다).";

/// 「Project 고치기 시작」의 쓰는 법 — 언제 부르고, Work에 없는 Project면 사람이 무엇을 고르고, 작업 폴더가 언제 바뀌는지(S42).
const START_EDITING_GUIDE: &str = "Work의 Project를 고치기 시작한다 — 그 Project의 파일을 처음 고치기 전에 부른다. Work의 Project는 \
처음 고칠 때까지 읽기만이라 worktree가 없다. 이 도구가 그 Project에만 worktree를 Work의 브랜치로 만들고 그 경로를 돌려준다(이미 \
있으면 그 경로).\n\n\
- 이번 턴에는 돌려받은 worktree 안을 절대 경로로 고친다. 다음 턴부터는 작업 폴더가 Work의 자리(worktree)로 바뀐다.\n\
- 이 Work에 없는 Project면 사람에게 카드로 묻고 고를 때까지 기다린다 — 「붙이고 고치기」면 그 Project를 Work에 붙이고 worktree를 \
만든다. 「읽기만 하기」면 다음 턴부터 그 Project 폴더를 읽을 수 있지만 고치지 않는다. 「아니요」면 고치지 않고 이 Work의 \
Project에서만 고친다. 같은 턴에 곧바로 다시 묻지 않는다.\n\
- Work에 이어지지 않은 Thread에서는 부를 수 없다 — 먼저 propose_work로 Work를 만든다.\n\n\
Project의 원래 폴더(list_projects의 path)는 고치지 않는다 — 판정이 거절한다.";

/// 「Agent 저장」의 쓰는 법 — Agent 파일의 꼴과, 이 도구가 하지 않는 일(「이 Project에 둬」). 파일의 꼴은 Agent가 이 설명만 보고
/// 깨지지 않은 파일을 짓도록 적는다(S42 — 쓰는 법은 도구의 설명이 맡는다). 깨지면 도구가 그 까닭을 돌려준다.
const SAVE_AGENT_GUIDE: &str = "새 Agent를 사람의 Library에 Agent 파일 하나로 저장한다. Library의 Agent는 어느 Thread에서든 \
`@handle`로 부른다. 있는 handle은 덮지 않고 거절한다 — 다른 handle로 다시 부른다. 사람이 「이 Project에 둬」라고 하면 이 도구를 \
쓰지 않는다: 그 Project worktree의 `.atelier/agents/<handle>.md`에 보통 편집으로 쓴다.\n\n\
content는 Markdown 파일 하나다 — `---` 사이의 YAML frontmatter와, 그 아래 본문(이 Agent의 지시문). frontmatter의 칸은 모두 \
고를 수 있다:\n\
- name: 화면에 보이는 이름(사람의 말로). description: 언제 부르는지 한 줄.\n\
- avatar: {shape: circle|triangle|pill|drop, color: blue|green|yellow|pink|purple|slate|lime|cyan|magenta}\n\
- model: {prefer: 모델 이름, effort: low|medium|high|xhigh|max} — 적지 않으면 사람의 기본값이다.\n\
- tools: {builtin: [read, search, edit, shell, web] 가운데 쓸 것 — 적지 않으면 전부, cli: [묻지 않고 부를 명령], \
agents: [부를 수 있는 handle]}\n\
- policy: {ask_before: [edit, push …], forbid: [merge …]}";

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

/// 읽은 도구 호출 하나(S13). PR ④의 넷이 여기 갈래를 더한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Call {
    /// Thread 이름 바꾸기 — 새 이름.
    RenameThread { title: String },
    /// Agent 부르기 — 부를 Agent의 이름(`handle` 또는 `project/handle`, 앞의 `@`는 뗀다)과 맡길 일(글).
    CallAgent { handle: String, task: String },
    /// Agent 저장 — handle과 Agent 파일의 글. Library에만 쓴다(v1 티켓 19).
    SaveAgent { handle: String, content: String },
    /// Project 목록 — 등록된 Project와 그 저장소의 브랜치들(v1 티켓 30).
    ListProjects,
    /// Work 읽기 — 이 Thread가 이어진 Work(v1 티켓 30).
    GetWork,
    /// Work 만들기 제안 — Host가 골라 둔 것(v1 티켓 30). 사람이 카드에서 고친다.
    ProposeWork(Proposal),
    /// Project 고치기 시작 — 고칠 Project의 slug와, Work 밖 Project 카드에 설 까닭(v1 티켓 32).
    StartEditing { project: String, reason: Option<String> },
    /// Space 목록 — Space마다 slug · 이름 · Project · 설명 첫 줄과, 이 Thread의 지금 Space(03 티켓 08).
    ListSpaces,
    /// Space 붙이기 — Host가 고른 Space와 다루려는 Project(03 티켓 08). 묻지 않고 붙이거나 질문 카드로 묻는다.
    SetSpace(SpaceAsk),
    /// Project 추가 — 등록할 폴더와 이름 · 설명(03 티켓 12). git이 아니거나 하위 폴더면 질문 카드로 묻는다.
    AddProject(ProjectAdd),
    /// Project 고치기 — 고칠 Project와 바꿀 칸(03 티켓 12).
    EditProject(ProjectEdit),
    /// Space 만들기 — 이름 · Project · 설명(03 티켓 12). 만든 이는 `host`다(S6).
    CreateSpace(SpaceNew),
    /// Space 고치기 — 고칠 Space와 바꿀 칸 · 넣고 뺄 Project(03 티켓 12).
    EditSpace(SpaceEdit),
}

/// Project 추가의 인자(03 §12) — 폴더(절대 경로 또는 `~`로 시작), 이름(없으면 폴더 이름), 설명.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProjectAdd {
    pub(crate) path: String,
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
}

/// Project 고치기의 인자(03 §12) — 준 칸만 바꾼다. 설명은 빈 글이면 비운다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProjectEdit {
    pub(crate) project: String,
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) base_branch: Option<String>,
}

/// Space 만들기의 인자(03 §12) — Project는 차례 그대로, 겹치지 않는다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SpaceNew {
    pub(crate) name: String,
    pub(crate) projects: Vec<String>,
    pub(crate) description: Option<String>,
}

/// Space 고치기의 인자(03 §12) — 준 칸만 바꾼다. 설명은 빈 글이면 비운다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SpaceEdit {
    pub(crate) space: String,
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) add: Vec<String>,
    pub(crate) remove: Vec<String>,
}

/// Space 붙이기의 인자(03 §11) — 추천할 Space(없으면 Space 없이), Host가 다루려는 Project(후보를 가른다), 까닭.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SpaceAsk {
    pub(crate) space: Option<String>,
    /// 차례 그대로, 겹치지 않는다.
    pub(crate) projects: Vec<String>,
    pub(crate) reason: Option<String>,
}

/// Work 만들기 제안(S13) — Host가 골라 둔 제목 · slug · 까닭 · 브랜치 · Project들. 카드가 이것으로 서고, 사람이 Project와 브랜치를
/// 고친다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Proposal {
    pub(crate) title: String,
    /// Work 폴더 이름이자 브랜치 기본값 — 영어 kebab-case다(바뀌지 않는다).
    pub(crate) slug: String,
    /// 왜 Work로 묶는지 — 카드의 제목 옆에 선다.
    pub(crate) reason: String,
    /// Project들이 함께 쓸 브랜치 — Project가 없으면 없어도 된다.
    pub(crate) branch: Option<String>,
    /// Host가 추천하는 Project — 고른 차례 그대로, 겹치지 않는다.
    pub(crate) projects: Vec<Pick>,
}

/// Host가 추천한 Project 하나 — slug와 고른 까닭(「refund.service.ts가 여기 있어요」).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Pick {
    pub(crate) slug: String,
    pub(crate) reason: Option<String>,
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
    json!({"tools": [
        {
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
        },
        {
            "name": CALL_AGENT,
            "title": "Agent 부르기",
            "description": "이 Thread의 다른 Agent에게 일을 맡기고, 그 Agent가 턴을 끝내면 그 마지막 메시지를 결과로 받는다. \
                            그때까지 기다린다 — 불린 Agent가 사람에게 물으면 그 답까지. 불린 Agent는 이 Thread에 들어와 지난 말을 \
                            받으므로, 맡길 일과 기대하는 결과만 글로 분명히 준다. 부를 수 있는 Agent는 네 정의의 tools.agents에 \
                            적힌 Agent다(Host는 이 Thread의 범위 안 아무 Agent). 지금 호출 고리에 든 Agent — 너와 너에게 일을 맡긴 \
                            Agent들 — 는 부를 수 없다.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "handle": {
                        "type": "string",
                        "description": "부를 Agent의 handle(@ 없이). 같은 handle이 Project 여럿에 있으면 project/handle",
                    },
                    "task": {"type": "string", "description": "맡길 일 — 불린 Agent에게 본문으로 간다"},
                },
                "required": ["handle", "task"],
                "additionalProperties": false,
            },
        },
        {
            "name": SAVE_AGENT,
            "title": "Agent 저장",
            "description": SAVE_AGENT_GUIDE,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "handle": {
                        "type": "string",
                        "description": "파일 이름이자 @로 부르는 이름 — 영어 소문자 · 숫자로 시작하고 끝나며 사이에 `-` · `_`만 \
                                        (예: security-reviewer)",
                    },
                    "content": {"type": "string", "description": "Agent 파일의 글 — frontmatter와 본문"},
                },
                "required": ["handle", "content"],
                "additionalProperties": false,
            },
        },
        {
            "name": LIST_PROJECTS,
            "title": "Project 목록",
            "description": "사람이 Atelier에 등록한 Project(git 저장소)들 — slug · 이름 · 폴더 · baseBranch · 설명과, 그 저장소에 \
                            이미 있는 브랜치들(git.localBranches). Work 만들기를 제안하기 전에 부른다: 고칠 Project의 slug와, 그 \
                            저장소의 브랜치 이름 규칙(fix/… · feature/…)이 여기서 나온다. 읽기만 한다.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        },
        {
            "name": GET_WORK,
            "title": "Work 읽기",
            "description": "이 Thread가 이어진 Work — slug · 제목 · 브랜치 · spec 폴더(설계 문서를 쓰는 곳)와 Project마다의 worktree(아직 \
                            없으면 읽기만), 그리고 spec 폴더 안 문서의 배치. Work에 이어지지 않았으면 그렇다고 돌려준다. 읽기만 한다.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        },
        {
            "name": PROPOSE_WORK,
            "title": "Work 만들기 제안",
            "description": PROPOSE_WORK_GUIDE,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Work 제목 — 사람의 말로 짧게(예: 환불 API 버그 수정)"},
                    "slug": {
                        "type": "string",
                        "description": "영어 소문자 · 숫자를 `-`로 이은 이름(예: refund-api) — Work 폴더 이름이자 브랜치 기본값이고 \
                                        바뀌지 않는다",
                    },
                    "reason": {"type": "string", "description": "왜 Work로 묶는지 한 줄 — 카드에 제목과 함께 선다"},
                    "branch": {
                        "type": "string",
                        "description": "Project들이 함께 쓸 브랜치 이름 — 그 저장소의 규칙(list_projects의 localBranches)을 따른다. \
                                        고칠 Project가 없으면 뺀다",
                    },
                    "projects": {
                        "type": "array",
                        "description": "고칠 Project — 카드에 「Host 추천」으로 선다. 기획만이면 빈 목록",
                        "items": {
                            "type": "object",
                            "properties": {
                                "slug": {"type": "string", "description": "list_projects의 slug"},
                                "reason": {"type": "string", "description": "이 Project를 고른 까닭 한 줄(예: refund.service.ts가 여기 있어요)"},
                            },
                            "required": ["slug"],
                            "additionalProperties": false,
                        },
                    },
                },
                "required": ["title", "slug", "reason"],
                "additionalProperties": false,
            },
        },
        {
            "name": START_EDITING,
            "title": "Project 고치기 시작",
            "description": START_EDITING_GUIDE,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {"type": "string", "description": "고칠 Project의 slug(list_projects · get_work의 slug)"},
                    "reason": {
                        "type": "string",
                        "description": "왜 이 Project를 고치는지 한 줄 — Work에 없는 Project면 사람에게 묻는 카드에 선다(예: 환불 버튼이 \
                                        두 번 눌리는 문제는 web-app에 있어요)",
                    },
                },
                "required": ["project"],
                "additionalProperties": false,
            },
        },
        {
            "name": LIST_SPACES,
            "title": "Space 목록",
            "description": "사람이 만든 Space들 — Space마다 slug · 이름 · 담은 Project의 slug · 설명 첫 줄과, 이 Thread의 지금 Space(Work에 \
                            이었으면 그 Work의 Space). Space는 함께 다루는 Project의 묶음이다 — 붙은 Thread는 그 Project만 읽는다. \
                            set_space 전에 부른다. 읽기만 한다.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        },
        {
            "name": SET_SPACE,
            "title": "Space 붙이기",
            "description": SET_SPACE_GUIDE,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "space": {
                        "type": ["string", "null"],
                        "description": "붙일 Space의 slug(list_spaces의 slug) — 사람에게 물으면 「추천」으로 선다. 비우면 Space 없이",
                    },
                    "projects": {
                        "type": "array",
                        "description": "이 Thread에서 다루려는 Project의 slug(list_projects의 slug) — 후보 Space를 가른다",
                        "items": {"type": "string"},
                    },
                    "reason": {"type": "string", "description": "왜 이 Space인지 한 줄(예: 환불은 web-app과 api-server에 걸쳐 있어요)"},
                },
                "required": ["projects"],
                "additionalProperties": false,
            },
        },
        {
            "name": ADD_PROJECT,
            "title": "Project 추가",
            "description": format!("{ADD_PROJECT_GUIDE}{SETTING_NOTE}"),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "등록할 폴더 — 절대 경로나 ~로 시작하는 경로(예: ~/MyProjects/landing-page)"},
                    "name": {"type": "string", "description": "Project 이름 — 사람이 화면에서 보는 이름. 없으면 폴더 이름이다"},
                    "description": {"type": "string", "description": "이 Project가 무엇인지 — Agent가 이 Project를 이해할 때 읽는다"},
                },
                "required": ["path"],
                "additionalProperties": false,
            },
        },
        {
            "name": EDIT_PROJECT,
            "title": "Project 고치기",
            "description": format!("{EDIT_PROJECT_GUIDE}{SETTING_NOTE}"),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {"type": "string", "description": "고칠 Project의 slug(list_projects의 slug)"},
                    "name": {"type": "string", "description": "새 이름 — 비울 수 없다"},
                    "description": {"type": "string", "description": "새 설명 — 빈 글이면 설명을 비운다"},
                    "baseBranch": {"type": "string", "description": "새 기준 브랜치 — 그 저장소에 있는 브랜치(로컬 또는 origin/<이름>)"},
                },
                "required": ["project"],
                "additionalProperties": false,
            },
        },
        {
            "name": CREATE_SPACE,
            "title": "Space 만들기",
            "description": format!("{CREATE_SPACE_GUIDE}{SETTING_NOTE}"),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Space 이름 — 파일 이름(slug)이 여기서 나온다(예: 정산)"},
                    "projects": {"type": "array", "description": "담을 Project의 slug(list_projects의 slug)", "items": {"type": "string"}},
                    "description": {"type": "string", "description": "이 Space가 무엇인지 — Agent가 이 Space에서 일할 때 처음 읽는다"},
                },
                "required": ["name", "projects"],
                "additionalProperties": false,
            },
        },
        {
            "name": EDIT_SPACE,
            "title": "Space 고치기",
            "description": format!("{EDIT_SPACE_GUIDE}{SETTING_NOTE}"),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "space": {"type": "string", "description": "고칠 Space의 slug(list_spaces의 slug)"},
                    "name": {"type": "string", "description": "새 이름 — 비울 수 없다. 파일 이름은 그대로다"},
                    "description": {"type": "string", "description": "새 설명 — 빈 글이면 설명을 비운다"},
                    "add": {"type": "array", "description": "넣을 Project의 slug", "items": {"type": "string"}},
                    "remove": {"type": "array", "description": "뺄 Project의 slug", "items": {"type": "string"}},
                },
                "required": ["space"],
                "additionalProperties": false,
            },
        },
    ]})
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
        CALL_AGENT => {
            let handle = arguments["handle"].as_str().map(|handle| handle.trim().trim_start_matches('@'));
            let task = arguments["task"].as_str().filter(|task| !task.trim().is_empty());
            match (handle.filter(|handle| !handle.is_empty()), task) {
                (Some(handle), Some(task)) => Ok(Call::CallAgent { handle: handle.to_owned(), task: task.to_owned() }),
                (None, _) => Err(Unread::Bad("handle(부를 Agent)을 글로 주세요".to_owned())),
                (_, None) => Err(Unread::Bad("task(맡길 일)를 글로 주세요".to_owned())),
            }
        }
        SAVE_AGENT => match (arguments["handle"].as_str(), arguments["content"].as_str()) {
            (Some(handle), Some(content)) => Ok(Call::SaveAgent { handle: handle.to_owned(), content: content.to_owned() }),
            _ => Err(Unread::Bad("handle과 content(Agent 파일의 글)를 글로 주세요".to_owned())),
        },
        LIST_PROJECTS => Ok(Call::ListProjects),
        GET_WORK => Ok(Call::GetWork),
        PROPOSE_WORK => read_proposal(arguments).map(Call::ProposeWork).map_err(Unread::Bad),
        START_EDITING => {
            let text = |field: &str| arguments[field].as_str().map(str::trim).filter(|value| !value.is_empty()).map(str::to_owned);
            match text("project") {
                Some(project) => Ok(Call::StartEditing { project, reason: text("reason") }),
                None => Err(Unread::Bad("project(고칠 Project의 slug)를 글로 주세요".to_owned())),
            }
        }
        LIST_SPACES => Ok(Call::ListSpaces),
        SET_SPACE => read_space_ask(arguments).map(Call::SetSpace).map_err(Unread::Bad),
        ADD_PROJECT => read_project_add(arguments).map(Call::AddProject).map_err(Unread::Bad),
        EDIT_PROJECT => read_project_edit(arguments).map(Call::EditProject).map_err(Unread::Bad),
        CREATE_SPACE => read_space_new(arguments).map(Call::CreateSpace).map_err(Unread::Bad),
        EDIT_SPACE => read_space_edit(arguments).map(Call::EditSpace).map_err(Unread::Bad),
        _ => Err(Unread::Unknown(Fault::new(-32602, format!("모르는 도구입니다: {name}")))),
    }
}

/// 글 칸 하나 — 앞뒤 빈칸을 걷고, 비었으면 없다(빈 글을 받지 않는 칸).
fn filled_text(arguments: &Value, name: &str) -> Option<String> {
    arguments[name].as_str().map(str::trim).filter(|value| !value.is_empty()).map(str::to_owned)
}

/// 바꿀 글 칸 하나 — 빈 글도 받는다(설명을 비운다 · 빈 이름은 core가 거절한다). 글이 아니면 없다.
fn text_or_empty(arguments: &Value, name: &str) -> Option<String> {
    arguments[name].as_str().map(|value| value.trim().to_owned())
}

/// Project slug 목록 칸 — 없으면 빈 목록, 같은 것은 한 번만 든다.
fn slug_list(arguments: &Value, name: &str) -> Result<Vec<String>, String> {
    let listed = match &arguments[name] {
        Value::Null => Vec::new(),
        Value::Array(items) => items.clone(),
        _ => return Err(format!("{name}는 Project slug의 목록으로 주세요(예: [\"api-server\"])")),
    };
    let mut slugs: Vec<String> = Vec::new();
    for item in &listed {
        let Some(slug) = item.as_str().map(str::trim).filter(|slug| !slug.is_empty()) else {
            return Err(format!("{name}의 칸마다 Project의 slug(list_projects의 slug)를 글로 주세요"));
        };
        if !slugs.iter().any(|one| one == slug) {
            slugs.push(slug.to_owned());
        }
    }
    Ok(slugs)
}

/// 「Project 추가」의 인자 — 폴더는 절대 경로이거나 `~`로 시작해야 한다(도구 서버의 작업 폴더에 기대지 않는다).
fn read_project_add(arguments: &Value) -> Result<ProjectAdd, String> {
    let path = filled_text(arguments, "path").ok_or("path(등록할 폴더)를 글로 주세요")?;
    if !(path.starts_with('/') || path == "~" || path.starts_with("~/")) {
        return Err(format!("path `{path}`는 절대 경로나 ~로 시작하는 경로로 주세요(예: ~/MyProjects/landing-page)"));
    }
    Ok(ProjectAdd { path, name: filled_text(arguments, "name"), description: filled_text(arguments, "description") })
}

/// 「Project 고치기」의 인자 — 바꿀 칸이 하나도 없으면 고칠 것이 없다.
fn read_project_edit(arguments: &Value) -> Result<ProjectEdit, String> {
    let project = filled_text(arguments, "project").ok_or("project(고칠 Project의 slug)를 글로 주세요")?;
    let edit = ProjectEdit {
        project,
        name: text_or_empty(arguments, "name"),
        description: text_or_empty(arguments, "description"),
        base_branch: text_or_empty(arguments, "baseBranch"),
    };
    if edit.name.is_none() && edit.description.is_none() && edit.base_branch.is_none() {
        return Err("바꿀 칸(name · description · baseBranch)을 하나 이상 주세요".to_owned());
    }
    Ok(edit)
}

/// 「Space 만들기」의 인자.
fn read_space_new(arguments: &Value) -> Result<SpaceNew, String> {
    let name = filled_text(arguments, "name").ok_or("name(Space 이름)을 글로 주세요")?;
    Ok(SpaceNew { name, projects: slug_list(arguments, "projects")?, description: filled_text(arguments, "description") })
}

/// 「Space 고치기」의 인자 — 바꿀 칸이 하나도 없으면 고칠 것이 없다.
fn read_space_edit(arguments: &Value) -> Result<SpaceEdit, String> {
    let space = filled_text(arguments, "space").ok_or("space(고칠 Space의 slug)를 글로 주세요")?;
    let edit = SpaceEdit {
        space,
        name: text_or_empty(arguments, "name"),
        description: text_or_empty(arguments, "description"),
        add: slug_list(arguments, "add")?,
        remove: slug_list(arguments, "remove")?,
    };
    if edit.name.is_none() && edit.description.is_none() && edit.add.is_empty() && edit.remove.is_empty() {
        return Err("바꿀 칸(name · description · add · remove)을 하나 이상 주세요".to_owned());
    }
    Ok(edit)
}

/// 「Space 붙이기」의 인자 — 글 칸은 앞뒤 빈칸을 걷고, 빈 space는 Space 없이다. Project는 slug 글자 목록이고 같은 것은 한 번만 든다.
fn read_space_ask(arguments: &Value) -> Result<SpaceAsk, String> {
    let space = match &arguments["space"] {
        Value::Null => None,
        Value::String(slug) => Some(slug.trim()).filter(|slug| !slug.is_empty()).map(str::to_owned),
        _ => return Err("space는 Space의 slug(list_spaces의 slug) 글자로 주세요 — Space 없이면 비운다".to_owned()),
    };
    let listed = match &arguments["projects"] {
        Value::Null => Vec::new(),
        Value::Array(items) => items.clone(),
        _ => return Err("projects는 Project slug의 목록으로 주세요(예: [\"web-app\", \"api-server\"])".to_owned()),
    };
    let mut projects: Vec<String> = Vec::new();
    for item in &listed {
        let Some(slug) = item.as_str().map(str::trim).filter(|slug| !slug.is_empty()) else {
            return Err("projects의 칸마다 Project의 slug(list_projects의 slug)를 글로 주세요".to_owned());
        };
        if !projects.iter().any(|one| one == slug) {
            projects.push(slug.to_owned());
        }
    }
    let reason = arguments["reason"].as_str().map(str::trim).filter(|reason| !reason.is_empty()).map(str::to_owned);
    Ok(SpaceAsk { space, projects, reason })
}

/// 「Work 만들기 제안」의 인자 — 틀리면 Agent가 고쳐 부를 까닭의 글이다. 글 칸은 앞뒤 빈칸을 걷는다. Project는 `{slug, reason}`
/// 꼴이고, slug 글자 하나만 줘도 받는다. 같은 Project는 한 번만 든다.
fn read_proposal(arguments: &Value) -> Result<Proposal, String> {
    let text = |field: &str| arguments[field].as_str().map(str::trim).filter(|value| !value.is_empty()).map(str::to_owned);
    let title = text("title").ok_or("title(Work 제목)을 글로 주세요")?;
    let slug = text("slug").ok_or("slug(Work 폴더 이름)를 글로 주세요")?;
    if !is_kebab(&slug) {
        return Err(format!(
            "slug `{slug}`은 쓸 수 없다 — 영어 소문자 · 숫자를 `-`로 이은 이름이다(예: refund-api). Work 폴더 이름이자 브랜치 \
             기본값이 된다."
        ));
    }
    let reason = text("reason").ok_or("reason(왜 Work로 묶는지)을 글로 주세요")?;
    let mut projects: Vec<Pick> = Vec::new();
    let listed = match &arguments["projects"] {
        Value::Null => Vec::new(),
        Value::Array(items) => items.clone(),
        _ => return Err("projects는 [{slug, reason}] 목록으로 주세요".to_owned()),
    };
    for item in &listed {
        let (slug, reason) = match item {
            Value::String(slug) => (Some(slug.trim()), None),
            Value::Object(_) => (item["slug"].as_str().map(str::trim), item["reason"].as_str().map(str::trim)),
            _ => (None, None),
        };
        let Some(slug) = slug.filter(|slug| !slug.is_empty()) else {
            return Err("projects의 칸마다 slug(list_projects의 slug)를 글로 주세요".to_owned());
        };
        if !projects.iter().any(|pick| pick.slug == slug) {
            let reason = reason.filter(|reason| !reason.is_empty()).map(str::to_owned);
            projects.push(Pick { slug: slug.to_owned(), reason });
        }
    }
    Ok(Proposal { title, slug, reason, branch: text("branch"), projects })
}

/// 영어 kebab-case인가 — 소문자 · 숫자 조각을 `-` 하나로 잇는다.
fn is_kebab(slug: &str) -> bool {
    slug.split('-').all(|piece| !piece.is_empty() && piece.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()))
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
    fn agent_저장은_handle과_글을_받고_하나라도_빠지면_도구의_실패다() {
        let call = |params: Value| read_call(&params);
        assert_eq!(
            call(json!({"name": "save_agent", "arguments": {"handle": "qa", "content": "---\n---\n"}})),
            Ok(Call::SaveAgent { handle: "qa".into(), content: "---\n---\n".into() })
        );
        assert!(matches!(call(json!({"name": "save_agent", "arguments": {"handle": "qa"}})), Err(Unread::Bad(_))));
        assert!(matches!(call(json!({"name": "save_agent", "arguments": {"content": "x"}})), Err(Unread::Bad(_))));
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
        assert_eq!(
            listed,
            [
                json!("rename_thread"),
                json!("call_agent"),
                json!("save_agent"),
                json!("list_projects"),
                json!("get_work"),
                json!("propose_work"),
                json!("start_editing"),
                json!("list_spaces"),
                json!("set_space"),
                json!("add_project"),
                json!("edit_project"),
                json!("create_space"),
                json!("edit_space")
            ],
            "목록과 읽는 도구가 같다 — 지우는 도구는 없다(03 §12 · §17)"
        );
    }

    #[test]
    fn 대화로_하는_설정_넷은_준_칸만_읽고_폴더는_절대_경로이며_바꿀_칸이_없으면_도구의_실패다() {
        let call = |name: &str, arguments: Value| read_call(&json!({"name": name, "arguments": arguments}));
        assert_eq!(
            call("add_project", json!({"path": " ~/MyProjects/landing-page ", "name": " ", "description": "랜딩"})),
            Ok(Call::AddProject(ProjectAdd { path: "~/MyProjects/landing-page".into(), name: None, description: Some("랜딩".into()) }))
        );
        for path in ["MyProjects/landing-page", "./notes", "~notes", ""] {
            assert!(matches!(call("add_project", json!({"path": path})), Err(Unread::Bad(_))), "{path}");
        }
        assert_eq!(
            call("edit_project", json!({"project": "web-app", "baseBranch": " main ", "description": ""})),
            Ok(Call::EditProject(ProjectEdit {
                project: "web-app".into(),
                name: None,
                description: Some(String::new()),
                base_branch: Some("main".into()),
            })),
            "빈 설명은 설명을 비운다"
        );
        assert!(matches!(call("edit_project", json!({"project": "web-app"})), Err(Unread::Bad(_))), "바꿀 칸이 없다");
        assert_eq!(
            call("create_space", json!({"name": " 정산 ", "projects": ["api-server", "api-server"]})),
            Ok(Call::CreateSpace(SpaceNew { name: "정산".into(), projects: vec!["api-server".into()], description: None }))
        );
        assert!(matches!(call("create_space", json!({"projects": []})), Err(Unread::Bad(_))));
        assert!(matches!(call("create_space", json!({"name": "정산", "projects": "api-server"})), Err(Unread::Bad(_))));
        assert_eq!(
            call("edit_space", json!({"space": "결제-서비스", "add": ["backoffice"]})),
            Ok(Call::EditSpace(SpaceEdit {
                space: "결제-서비스".into(),
                name: None,
                description: None,
                add: vec!["backoffice".into()],
                remove: Vec::new(),
            }))
        );
        assert!(matches!(call("edit_space", json!({"space": "결제-서비스"})), Err(Unread::Bad(_))), "바꿀 칸이 없다");
        assert!(matches!(call("edit_space", json!({"space": "결제-서비스", "remove": [3]})), Err(Unread::Bad(_))));
    }

    #[test]
    fn space_붙이기는_space_slug나_없음과_다루는_project와_까닭을_받고_틀린_인자는_도구의_실패다() {
        let call = |arguments: Value| read_call(&json!({"name": "set_space", "arguments": arguments}));
        assert_eq!(
            call(json!({"space": " 결제-서비스 ", "projects": ["web-app", " api-server ", "web-app"], "reason": "환불은 둘에 걸쳐 있어요"})),
            Ok(Call::SetSpace(SpaceAsk {
                space: Some("결제-서비스".into()),
                projects: vec!["web-app".into(), "api-server".into()],
                reason: Some("환불은 둘에 걸쳐 있어요".into()),
            })),
            "Project는 겹치지 않게 차례대로 받는다"
        );
        assert_eq!(
            call(json!({"space": null, "projects": []})),
            Ok(Call::SetSpace(SpaceAsk { space: None, projects: Vec::new(), reason: None })),
            "space가 없으면 Space 없이(빼기)다"
        );
        assert_eq!(call(json!({"space": "", "reason": " "})), Ok(Call::SetSpace(SpaceAsk { space: None, projects: Vec::new(), reason: None })));
        assert!(matches!(call(json!({"space": 3})), Err(Unread::Bad(_))));
        assert!(matches!(call(json!({"space": "a", "projects": "web-app"})), Err(Unread::Bad(_))));
        assert!(matches!(call(json!({"space": "a", "projects": [""]})), Err(Unread::Bad(_))));
        assert_eq!(read_call(&json!({"name": "list_spaces", "arguments": {}})), Ok(Call::ListSpaces));
    }

    #[test]
    fn agent_부르기는_handle과_맡길_일을_글로_받고_앞의_at은_떼며_빈_것은_도구의_실패다() {
        let call = |arguments: Value| read_call(&json!({"name": "call_agent", "arguments": arguments}));
        assert_eq!(
            call(json!({"handle": "@api-server/reviewer", "task": "diff를 봐 줘"})),
            Ok(Call::CallAgent { handle: "api-server/reviewer".into(), task: "diff를 봐 줘".into() })
        );
        assert!(matches!(call(json!({"handle": " @ ", "task": "봐 줘"})), Err(Unread::Bad(_))));
        assert!(matches!(call(json!({"handle": "reviewer", "task": "  "})), Err(Unread::Bad(_))));
        assert!(matches!(call(json!({"task": "봐 줘"})), Err(Unread::Bad(_))));
    }

    #[test]
    fn work_만들기_제안은_제목_slug_까닭을_받고_project는_겹치지_않게_차례대로_받으며_틀린_인자는_도구의_실패다() {
        let call = |arguments: Value| read_call(&json!({"name": "propose_work", "arguments": arguments}));
        assert_eq!(
            call(json!({
                "title": " 환불 API 버그 수정 ", "slug": "refund-api", "reason": "고칠 곳을 골라 두었어요", "branch": "fix/refund-api",
                "projects": [{"slug": "api-server", "reason": "refund.service.ts가 여기 있어요"}, "web-app", {"slug": "api-server"}],
            })),
            Ok(Call::ProposeWork(Proposal {
                title: "환불 API 버그 수정".into(),
                slug: "refund-api".into(),
                reason: "고칠 곳을 골라 두었어요".into(),
                branch: Some("fix/refund-api".into()),
                projects: vec![
                    Pick { slug: "api-server".into(), reason: Some("refund.service.ts가 여기 있어요".into()) },
                    Pick { slug: "web-app".into(), reason: None },
                ],
            }))
        );
        assert_eq!(
            call(json!({"title": "기획", "slug": "plan-2", "reason": "문서부터", "branch": " "})),
            Ok(Call::ProposeWork(Proposal {
                title: "기획".into(),
                slug: "plan-2".into(),
                reason: "문서부터".into(),
                branch: None,
                projects: Vec::new(),
            })),
            "Project 없이 기획만으로도 제안한다(스토리 97)"
        );
        for slug in ["Refund", "refund_api", "refund--api", "-refund", "환불"] {
            let refused = call(json!({"title": "t", "slug": slug, "reason": "r"}));
            assert!(matches!(refused, Err(Unread::Bad(_))), "slug {slug}: {refused:?}");
        }
        assert!(matches!(call(json!({"slug": "a", "reason": "r"})), Err(Unread::Bad(_))));
        assert!(matches!(call(json!({"title": "t", "slug": "a"})), Err(Unread::Bad(_))));
        assert!(matches!(call(json!({"title": "t", "slug": "a", "reason": "r", "projects": [{"reason": "x"}]})), Err(Unread::Bad(_))));
        assert_eq!(read_call(&json!({"name": "list_projects", "arguments": {}})), Ok(Call::ListProjects));
        assert_eq!(read_call(&json!({"name": "get_work"})), Ok(Call::GetWork));
    }

    #[test]
    fn project_고치기_시작은_project_slug와_까닭을_받고_slug가_없으면_도구의_실패다() {
        let call = |arguments: Value| read_call(&json!({"name": "start_editing", "arguments": arguments}));
        assert_eq!(
            call(json!({"project": " web-app ", "reason": "환불 버튼은 web-app에 있어요"})),
            Ok(Call::StartEditing { project: "web-app".into(), reason: Some("환불 버튼은 web-app에 있어요".into()) })
        );
        assert_eq!(call(json!({"project": "api-server", "reason": " "})), Ok(Call::StartEditing { project: "api-server".into(), reason: None }));
        assert!(matches!(call(json!({"reason": "r"})), Err(Unread::Bad(_))));
        assert!(matches!(call(json!({"project": ""})), Err(Unread::Bad(_))));
    }
}
