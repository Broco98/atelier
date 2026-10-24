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
//!   `claude_replay`의 원문 표다.
//! - `FAKE_CLAUDE_SUGGESTIONS` — 있으면 내는 `can_use_tool`마다 `permission_suggestions`를 이 JSON으로 바꾼다. 세션 제안이 없는
//!   요청 · 설정 파일에 쓰는 제안(`localSettings` · `userSettings`, 워크플로 관문 G1의 모양)이 섞인 요청을 만든다.
//! - `FAKE_CLAUDE_HOLD_BACKGROUND` — `result`면 스스로 이어 간 턴의 `result` 앞에서, `start`면 그 턴을 시작하기 전에(백그라운드
//!   작업이 도는 꼴) 영수증 폴더의 `<세션 id>.go`가 생길 때까지 멈춘다 — 그동안에도 stdin은 읽어 영수증에 적는다.
//! - `FAKE_CLAUDE_PERFORMS_WRITES` — 있으면 되감는 `Write` 도구 호출마다 그 글을 cwd에 같은 파일 이름으로 정말 쓴다. 원문의
//!   경로는 잰 날의 임시 폴더라, 고친 곳(spec 폴더 비교)을 재려면 가짜가 대화의 자리에 써야 한다.
//! - `FAKE_CLAUDE_FORGETS` — 있으면 `--resume`한 세션을 모른다(세션 저장소가 빈 꼴).
//!
//! 녹화를 되감는 규칙(턴 · 권한 · 멈추기 · 바꾸기 · 스스로 이어 간 턴)은 입출력 없는 몸 `src/fakes/claude_replay.rs`에 있다 —
//! 변환기 상태 기계의 시험이 프로세스 없이 같은 몸을 상대한다. 이 bin은 그 몸에 stdin · stdout · 영수증 · 문을 두른다.
//! - **되살리기**(티켓 16) — `--resume <id>`로 뜨면 그 id가 세션 id다. 그 세션으로 뜬 적이 있으면(영수증 `<id>.json`이 있으면)
//!   보통처럼 원문의 첫 턴부터 되감는다 — 진짜 claude도 지난 대화를 다시 흘리지 않는다(판 02 관문 G4). 뜬 적이 없거나
//!   `FAKE_CLAUDE_FORGETS`가 있으면 진짜 claude처럼(G4 `g4-resume-missing`) initialize에 답하지 않고 stderr에 까닭을, stdout에
//!   `result/error_during_execution`을 내고 exit 1로 끝난다. 이때는 `<id>.json`을 쓰지 않는다.
//!
//! 영수증은 띄울 때 `<세션 id>.json` 한 장으로 남는다 — pid · 부모 pid · 프로세스 그룹 · Unix 세션 · 받은 인자 · cwd · env ·
//! 낳은 후손. 받은 stdin 줄은 받는 즉시 `<세션 id>.stdin`에, 그 뒤에 일어난 일(stdin EOF · 받은 시그널)은 `<세션 id>.events`에
//! 한 줄씩 더한다. 세션 id는 받은 `--session-id` · `--resume`(없으면 `claude-<pid>`)이다. `-p`로 뜰 때마다 `launches`에
//! `{pid, args}` 한 줄을 더한다 — 되살리기가 실패해 곧바로 끝난 claude도 남는다.

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;

use serde_json::{json, Value};

#[path = "../fakes/claude_replay.rs"]
mod claude_replay;
#[path = "../fakes/login.rs"]
#[allow(dead_code)] // 두 가짜가 함께 쓰는 모듈이라 저쪽 엔진의 몫은 여기서 안 쓴다.
mod login;
#[path = "../fakes/receipts.rs"]
#[allow(dead_code)] // 가짜들이 함께 쓰는 영수증 배관이라 이 가짜가 쓰지 않는 몫이 있다.
mod receipts;

use claude_replay::{Hold, Replay, Setup};

/// 시나리오.
/// - `normal` — 원문대로 답한다. stdin EOF면 끝난다(진짜 claude처럼).
/// - `silent-initialize` — `initialize`에 답하지 않는다(G5 한도를 잰다). 다른 것도 답하지 않고, stdin EOF면 끝난다.
/// - `mcp-child` — `normal`에 더해 띄우자마자 오래 사는 자식 하나(stdio MCP 서버 자리)를 낳는다. stdin EOF면 그 자식을
///   끄고 끝난다 — 진짜 claude가 MCP 서버를 거두고 끝나는 꼴이다.
const SCENARIOS: &[&str] = &["normal", "silent-initialize", "mcp-child"];

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
    let Some(recorded) = claude_replay::fixture(&fixture) else {
        eprintln!("모르는 원문: {fixture} (있는 것: {})", claude_replay::fixture_names().join(", "));
        std::process::exit(2);
    };
    let suggestions = std::env::var("FAKE_CLAUDE_SUGGESTIONS")
        .ok()
        .map(|text| serde_json::from_str::<Value>(&text).expect("FAKE_CLAUDE_SUGGESTIONS는 JSON이다"));
    let hold = match std::env::var("FAKE_CLAUDE_HOLD_BACKGROUND").as_deref() {
        Ok("start") => Some(Hold::Start),
        Ok("result") => Some(Hold::Result),
        _ => None,
    };
    let resume = flag_value(&args, "--resume");
    let session_id = flag_value(&args, "--session-id")
        .or_else(|| resume.clone())
        .unwrap_or_else(|| format!("claude-{}", std::process::id()));
    let receipts = std::env::var_os("FAKE_CLAUDE_RECEIPTS").map(PathBuf::from);
    let writes = std::env::var_os("FAKE_CLAUDE_PERFORMS_WRITES").is_some();
    let fake = Fake { receipts, session_id: session_id.clone(), writes };
    fake.log_launch(&args);
    if resume.is_some() && !fake.knows_session() {
        fake.forgotten_session();
    }
    fake.watch_signals();

    let mut child = (scenario == "mcp-child").then(spawn_mcp_child);
    fake.leave_receipt(&args, child.as_ref().map(Child::id));

    let email = std::env::var("FAKE_CLAUDE_ACCOUNT_EMAIL").ok();
    let (mut replay, startup) = Replay::new(recorded, Setup { session_id, suggestions, hold, email });
    fake.emit_all(startup);
    for message in fake.read_stdin() {
        let Some(message) = message else {
            // 진짜 claude는 깨진 줄 하나에 exit 1로 끝난다(워크플로 함정 4).
            eprintln!("Error: 읽을 수 없는 줄");
            std::process::exit(1);
        };
        if scenario == "silent-initialize" {
            continue;
        }
        fake.emit_all(replay.receive(&message));
        // 문에서 멈췄다 — 놓일 때까지 기다린다. 그동안 온 stdin 줄은 읽는 스레드가 영수증에 적고 쌓아 둔다.
        while replay.paused() {
            fake.wait_gate();
            fake.emit_all(replay.release());
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
    /// 되감는 `Write`를 cwd에 정말 쓰나(`FAKE_CLAUDE_PERFORMS_WRITES`).
    writes: bool,
}

impl Fake {
    /// 되감기가 낸 줄들을 차례로 낸다. 정말 쓰기로 했으면 `Write` 도구 호출의 글을 그 줄을 내기 전에 쓴다.
    fn emit_all(&self, lines: Vec<Value>) {
        for line in lines {
            if self.writes {
                self.perform_writes(&line);
            }
            emit(&line);
        }
    }

    fn path(&self, what: &str) -> Option<PathBuf> {
        self.receipts.as_ref().map(|dir| dir.join(format!("{}.{what}", self.session_id)))
    }

    /// `-p`로 뜬 것을 `launches`에 한 줄 더한다 — `{pid, args}`.
    fn log_launch(&self, args: &[String]) {
        let Some(dir) = &self.receipts else { return };
        receipts::append_line(&dir.join("launches"), &json!({"pid": std::process::id(), "args": args}).to_string());
    }

    /// `--resume`한 세션을 아는가 — 그 세션으로 뜬 적이 있다(영수증이 있다). `FAKE_CLAUDE_FORGETS`면 모른다(세션 저장소가 빈 꼴).
    fn knows_session(&self) -> bool {
        std::env::var_os("FAKE_CLAUDE_FORGETS").is_none() && self.path("json").is_some_and(|path| path.exists())
    }

    /// 없는 세션을 되살리라고 받았다 — 진짜 claude 2.1.296처럼(판 02 관문 G4) initialize에 답하지 않고, stderr에 까닭을,
    /// stdout에 `result/error_during_execution`을 내고 exit 1로 끝난다.
    fn forgotten_session(&self) -> ! {
        eprintln!("No conversation found with session ID: {}", self.session_id);
        emit(&claude_replay::forgotten_line(&self.session_id));
        std::process::exit(1);
    }

    /// stdin을 읽는 스레드를 띄우고, 받은 메시지를 차례로 내놓는다. 받은 줄은 그 자리에서 영수증에 적는다 — 가짜가 턴을 붙잡고
    /// 멈춰 있는 동안에도(`FAKE_CLAUDE_HOLD_BACKGROUND`) 무엇이 언제 들어왔는지가 남는다. 깨진 줄은 `None`이다.
    fn read_stdin(&self) -> mpsc::Receiver<Option<Value>> {
        let (tx, rx) = mpsc::channel();
        let stdin_receipt = self.path("stdin");
        std::thread::spawn(move || {
            let stdin = std::io::stdin();
            for line in stdin.lock().lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                if let Some(path) = &stdin_receipt {
                    receipts::append_line(path, &line);
                }
                let parsed = serde_json::from_str::<Value>(&line).ok();
                let broken = parsed.is_none();
                if tx.send(parsed).is_err() || broken {
                    break;
                }
            }
        });
        rx
    }

    /// 영수증 폴더의 `<세션 id>.go`가 생길 때까지 기다리고, 지운다. 다른 가짜들처럼 한도가 있다 — 검사가 놓지 않고 사라져도
    /// 끝없이 남지 않게, 한도를 넘기면 놓인 것처럼 이어 간다.
    fn wait_gate(&self) {
        let Some(gate) = self.path("go") else { return };
        receipts::wait_for(&gate, receipts::GATE_LIMIT);
        let _ = std::fs::remove_file(gate);
    }

    /// 되감는 줄의 `Write` 도구 호출마다 그 글을 cwd에 같은 파일 이름으로 쓴다(`FAKE_CLAUDE_PERFORMS_WRITES`).
    fn perform_writes(&self, line: &Value) {
        if line["type"] != "assistant" {
            return;
        }
        for block in line["message"]["content"].as_array().into_iter().flatten() {
            if block["type"] != "tool_use" || block["name"] != "Write" {
                continue;
            }
            let (Some(path), Some(content)) = (block["input"]["file_path"].as_str(), block["input"]["content"].as_str()) else {
                continue;
            };
            if let Some(name) = std::path::Path::new(path).file_name() {
                let _ = std::fs::write(name, content);
            }
        }
    }

    /// 띄운 때의 영수증 한 장.
    fn leave_receipt(&self, args: &[String], child: Option<u32>) {
        let Some(path) = self.path("json") else { return };
        // SAFETY: 인자 없이 자기 번호들을 돌려줄 뿐이다.
        let (ppid, pgid) = unsafe { (libc::getppid(), libc::getpgid(0)) };
        let receipt = json!({
            "pid": std::process::id(),
            "ppid": ppid,
            "pgid": pgid,
            "sid": receipts::unix_session(),
            "args": args,
            "cwd": std::env::current_dir().ok(),
            "env": receipts::env_map(),
            "descendants": child.into_iter().collect::<Vec<_>>(),
        });
        receipts::write_atomically(&path, &receipt);
    }

    fn append(&self, what: &str, line: &str) {
        let Some(path) = self.path(what) else { return };
        receipts::append_line(&path, line);
    }

    /// SIGINT · SIGTERM · SIGHUP을 받으면 `events`에 적고 끝난다 — 진짜 claude도 SIGINT에 끝난다(워크플로 함정 5).
    /// SIGKILL은 받을 수 없으니 적히지 않는다. 영수증 폴더가 없으면 처리기를 걸지 않는다.
    fn watch_signals(&self) {
        const LINES: &[(libc::c_int, &[u8])] = &[
            (libc::SIGINT, b"signal SIGINT\n"),
            (libc::SIGTERM, b"signal SIGTERM\n"),
            (libc::SIGHUP, b"signal SIGHUP\n"),
        ];
        let Some(path) = self.path("events") else { return };
        receipts::record_signals(Some(&path), LINES);
    }
}
