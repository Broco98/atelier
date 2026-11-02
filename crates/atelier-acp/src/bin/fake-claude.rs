//! 검사가 진짜 `claude` 대신 상대하는 가짜 claude. 검사는 이것을 임시 PATH에 `claude`라는 이름의 링크로 둔다.
//!
//! - `auth status` — 로그인 확인의 흉내(three-axes 티켓 12). 몸은 `src/fakes/login.rs`이고 가짜 `codex`와 함께 쓴다 — 로그인
//!   상태 파일 · 영수증의 약속은 그 파일 머리에 있다. 로그인 명령(`auth login`)은 흉내 내지 않는다(restart 01c-10).
//! - `-p …` — 진짜 claude **2.1.309**의 stream-json 원문(v1 티켓 09가 다시 녹음)과 조각이 든 **2.1.316**의 원문(restart 티켓 01b-1)을
//!   되감는다(three-axes 티켓 13). 셸 스크립트로는 제어 메시지에 답하기 버거워 Rust bin으로 짰다(워크플로 티켓 07). 아래는 이 갈래의
//!   약속이다.
//!
//! 변환기가 `claude -p …`로 띄우고, env는 변환기가 받은 것(호스트가 준 로그인 env) 그대로라 시나리오와 영수증 자리는 가짜
//! 로그인 셸이 찍는 env로 받는다.
//!
//! - `FAKE_CLAUDE_SCENARIO` — 시나리오 이름(없으면 `normal`).
//! - `FAKE_CLAUDE_RECEIPTS` — 영수증 폴더. 세션 cwd에 떨어뜨리지 않는다 — cwd는 spec 폴더이거나 워크트리다.
//! - `FAKE_CLAUDE_ACCOUNT_EMAIL` — 있으면 `initialize` 응답의 `account.email`에 이 이메일을 싣는다. 실측 원문은 이미
//!   가려져 있어(`<redacted>`), 가리기를 재려면 진짜 같은 이메일이 실려 와야 한다.
//! - `FAKE_CLAUDE_FIXTURE` — 턴을 되감을 원문(`<CLI 판>/<이름>`, 없으면 `2.1.309/slash-skill-noreplay`). 고를 수 있는 것은
//!   `claude_replay`의 원문 표다.
//! - `FAKE_CLAUDE_SUGGESTIONS` — 있으면 내는 `can_use_tool`마다 `permission_suggestions`를 이 JSON으로 바꾼다. 세션 제안이 없는
//!   요청 · 설정 파일에 쓰는 제안(`localSettings` · `userSettings`, 워크플로 관문 G1의 모양)이 섞인 요청을 만든다.
//! - `FAKE_CLAUDE_HOLD_BACKGROUND` — `result`면 스스로 이어 간 턴의 `result` 앞에서, `start`면 그 턴을 시작하기 전에(백그라운드
//!   작업이 도는 꼴) 영수증 폴더의 `<세션 id>.go`가 생길 때까지 멈춘다 — 그동안에도 stdin은 읽어 영수증에 적는다.
//! - `FAKE_CLAUDE_PERFORMS_WRITES` — 있으면 되감는 `Write` 도구 호출마다 그 글을 cwd에 같은 파일 이름으로 정말 쓴다. 원문의
//!   경로는 잰 날의 임시 폴더라, 고친 곳(spec 폴더 비교)을 재려면 가짜가 대화의 자리에 써야 한다.
//! - `FAKE_CLAUDE_FORGETS` — 있으면 `--resume`한 세션을 모른다(세션 저장소가 빈 꼴).
//! - `FAKE_CLAUDE_MCP_CALL` — 있으면 user 줄을 받아 낼 턴의 `system/init` 바로 뒤에서 MCP 도구를 정말 부른다(v1 티켓 15).
//!   값은 `{"tool": 이름, "arguments": {…}}` 하나 또는 그 배열이다 — 배열이면 차례로 부른다. 받은 `--mcp-config`의 stdio 서버마다
//!   띄워 `initialize` → `tools/list`를 하고, 그 도구를 가진 서버에 `tools/call`한다. 진짜 claude처럼 `assistant`의
//!   `tool_use`(`mcp__<서버>__<도구>`)를 낸 뒤에 부르고, 받은 답을 `user`의 `tool_result`로 낸다. 주고받은 것은 `<세션 id>.mcp`에
//!   부르기마다 `{server, tools, tool, arguments, call}` 한 줄로 남는다.
//!   - 부르기에 `"launch": 차례`가 있으면 그 차례(0부터)로 뜬 claude만 부른다 — 채팅마다 claude가 뜨고 env는 모두 같다.
//!   - 부르기에 `"at": "result"`가 있으면 턴의 앞머리가 아니라 그 턴의 `result` 바로 앞(턴의 도구를 다 쓴 뒤)에서 부른다(v1 티켓
//!     18 — 파일을 고친 Agent가 카드의 답을 기다리며 그 턴을 이어 가는 꼴). 스스로 이어 간 턴의 `result` 앞에서는 부르지 않는다.
//! - `FAKE_CLAUDE_LAUNCH_FIXTURES` — `[원문 | null, …]` JSON. 뜬 차례(0부터 — 영수증 `launches`의 줄 수)의 칸이 있으면
//!   `FAKE_CLAUDE_FIXTURE` 대신 그 원문을 되감는다 — 둘째 채팅이 첫 채팅과 다른 턴을 돈다. 시험이 채팅을 하나씩 세우므로 차례가 곧
//!   채팅의 차례다. 다시 띄운 Session도 한 차례를 먹는다.
//! - `FAKE_CLAUDE_REBASE` — 녹음의 폴더 하나(예 `/tmp/gate/ws/g1/outside`). 있으면 내는 줄마다 그 글을 이 claude의 작업 폴더로 바꿔
//!   낸다(v1 티켓 22). 원문의 경로는 잰 날의 임시 폴더라 판정에는 늘 「Work 밖 편집」이다 — 작업 자리 안의 편집을 재려면 가짜가
//!   제 자리의 경로를 물어야 한다. 그 폴더는 진짜 claude처럼 심볼릭 링크를 푼 경로(`getcwd`)다.
//! - `FAKE_CLAUDE_REROOT` — `<녹음의 루트>=<옮길 폴더>`(예 `/tmp/gate=/private/var/…/T/.tmpX`). 있으면 `FAKE_CLAUDE_REBASE` 다음에
//!   내는 줄마다 녹음의 루트를 그 폴더로 바꾼다(v1 티켓 39). 녹음이 작업 폴더 밖(Work의 spec 폴더 · 등록한 저장소)을 가리킬 때 그
//!   자리를 시험의 임시 폴더로 옮긴다 — 판정이 녹음의 편집을 그 시험이 만든 Work 안의 것으로 본다. 내는 줄의 글 바꾸기라 녹음의
//!   명령 글을 바꾸는 데도 쓴다(코드 리뷰 1차 A1 — `python3 -c` 앞에 `git -C … push`를 붙인다).
//! - `FAKE_CLAUDE_STDOUT_LAG` — 있으면(밀리초) 내는 줄마다 그만큼 늦게 stdout에 쓴다. MCP 부르기는 늦추지 않는다 — stdout(변환기 →
//!   엔진) 길이 부하로 늦어 Thread 도구 호출(중계 서버 → 소켓)이 먼저 닿는 꼴을 늘 일으킨다(코드 리뷰 1차 A3).
//! - `FAKE_CLAUDE_STREAM_GAP_MS` · `FAKE_CLAUDE_STREAM_FOR_MS` — 부하(restart 티켓 01b-9). 둘 다 있으면 user 줄마다 녹음의 턴 대신 부하 턴을
//!   낸다 — 그 간격으로 글 조각을 그 시간 동안 흘린 뒤 완성 줄과 `result`를 낸다. `FAKE_CLAUDE_STREAM_MESSAGE_MS`가 있으면 그 시간마다 새
//!   메시지로 넘어간다 — 기록 줄이 그만큼 서서 접기가 돈다. 없으면 한 메시지다. 간격은 시작에서 잰 때를 지키므로 밀려도 늦은 만큼 쌓이지
//!   않는다. 다 흘리면 영수증 `<세션 id>.stream`에 `{chunks, messages, ms}` 한 줄을 남긴다.
//! - **녹음 속 MCP 부르기**(v1 티켓 20) — 되감는 원문의 `assistant`가 받은 `--mcp-config`의 서버 도구(`mcp__<서버>__<도구>`)를
//!   부르면, 그 줄을 낸 뒤 그 서버를 띄워 같은 입력으로 정말 부르고, 뒤따르는 원문의 그 `tool_result`를 받은 답으로 바꿔 낸다.
//!   진짜 claude가 Thread 도구를 부른 녹음(`thread-rename-host`)이 엔진의 중계 서버 → 소켓 길을 끝까지 탄다.
//!   입력은 `FAKE_CLAUDE_REBASE`로 옮긴 뒤의 것이고, 영수증 `<세션 id>.mcp`에 `FAKE_CLAUDE_MCP_CALL`과 같은 꼴로 남는다.
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

use std::cell::RefCell;
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

#[path = "../fakes/claude_replay.rs"]
mod claude_replay;
#[path = "../fakes/login.rs"]
#[allow(dead_code)] // 두 가짜가 함께 쓰는 모듈이라 저쪽 엔진의 몫은 여기서 안 쓴다.
mod login;
#[path = "../fakes/mcp_client.rs"]
mod mcp_client;
#[path = "../fakes/receipts.rs"]
#[allow(dead_code)] // 가짜들이 함께 쓰는 영수증 배관이라 이 가짜가 쓰지 않는 몫이 있다.
mod receipts;

use claude_replay::{Hold, Replay, Setup};
use mcp_client::McpServer;

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
    let receipts = std::env::var_os("FAKE_CLAUDE_RECEIPTS").map(PathBuf::from);
    let launch = launch_order(receipts.as_deref());
    let fixture = launch_fixture(launch)
        .or_else(|| std::env::var("FAKE_CLAUDE_FIXTURE").ok())
        .unwrap_or_else(|| "2.1.309/slash-skill-noreplay".to_string());
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
    let writes = std::env::var_os("FAKE_CLAUDE_PERFORMS_WRITES").is_some();
    let mcp_calls = mcp_calls_of(launch);
    let mcp_config = flag_value(&args, "--mcp-config")
        .map(|text| serde_json::from_str::<Value>(&text).expect("--mcp-config는 JSON 글이다"));
    let fake = Fake { receipts, session_id: session_id.clone(), writes, servers: mcp_config, answered: RefCell::default() };
    fake.log_launch(&args);
    if resume.is_some() && !fake.knows_session() {
        fake.forgotten_session();
    }
    fake.watch_signals();

    let mut child = (scenario == "mcp-child").then(spawn_mcp_child);
    fake.leave_receipt(&args, child.as_ref().map(Child::id));

    let email = std::env::var("FAKE_CLAUDE_ACCOUNT_EMAIL").ok();
    let load = Load::from_env();
    let (mut replay, startup) = Replay::new(recorded, Setup { session_id, suggestions, question: None, hold, email });
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
        if let Some(load) = load.as_ref().filter(|_| message["type"] == "user") {
            fake.flow(load);
            continue;
        }
        let lines = replay.receive(&message);
        fake.emit_calling(lines, &mcp_calls, message["type"] == "user");
        // 문에서 멈췄다 — 놓일 때까지 기다린다. 그동안 온 stdin 줄은 읽는 스레드가 영수증에 적고 쌓아 둔다.
        while replay.paused() {
            fake.wait_gate();
            fake.emit_all(replay.release());
        }
    }
    drain_stdout();
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

/// 이 claude가 몇째로 떴나(0부터) — 앞서 뜬 claude가 영수증 `launches`에 남긴 줄 수다. 영수증 폴더가 없으면 첫째다.
fn launch_order(receipts: Option<&Path>) -> usize {
    let launches = receipts.and_then(|dir| std::fs::read_to_string(dir.join("launches")).ok());
    launches.map_or(0, |text| text.lines().count())
}

/// 그 차례의 claude가 되감을 원문(`FAKE_CLAUDE_LAUNCH_FIXTURES`) — 없으면 `FAKE_CLAUDE_FIXTURE`를 따른다.
fn launch_fixture(launch: usize) -> Option<String> {
    let table = std::env::var("FAKE_CLAUDE_LAUNCH_FIXTURES").ok()?;
    let table: Value = serde_json::from_str(&table).expect("FAKE_CLAUDE_LAUNCH_FIXTURES는 JSON이다");
    table[launch].as_str().map(str::to_owned)
}

/// 이 claude가 부를 MCP 도구들(`FAKE_CLAUDE_MCP_CALL`) — `launch`가 없거나 이 차례인 것만.
fn mcp_calls_of(launch: usize) -> Vec<Value> {
    let Ok(text) = std::env::var("FAKE_CLAUDE_MCP_CALL") else { return Vec::new() };
    let calls = match serde_json::from_str::<Value>(&text).expect("FAKE_CLAUDE_MCP_CALL은 JSON이다") {
        Value::Array(calls) => calls,
        call => vec![call],
    };
    calls.into_iter().filter(|call| call["launch"].as_u64().is_none_or(|order| order as usize == launch)).collect()
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
    let text = rebased(line);
    match lagged() {
        Some(lagged) => lagged.send(text),
        None => write_line(&text),
    }
}

fn write_line(text: &str) {
    let mut out = std::io::stdout().lock();
    // 상대가 떠났으면 쓰기가 실패한다. 가짜는 그 자리에서 할 일이 없다.
    let _ = writeln!(out, "{text}");
    let _ = out.flush();
}

/// 늦게 쓰는 stdout(`FAKE_CLAUDE_STDOUT_LAG`) — 줄마다 낸 때에서 그만큼 지나 차례대로 쓴다. MCP 부르기는 늦추지 않는다.
struct Lagged {
    lag: Duration,
    lines: mpsc::Sender<(Instant, String)>,
    /// 아직 쓰지 않은 줄 수 — 끝나기 전에 다 쓰고 끝난다.
    pending: Arc<AtomicUsize>,
}

impl Lagged {
    fn send(&self, text: String) {
        self.pending.fetch_add(1, Ordering::SeqCst);
        let _ = self.lines.send((Instant::now() + self.lag, text));
    }
}

fn lagged() -> Option<&'static Lagged> {
    static LAGGED: OnceLock<Option<Lagged>> = OnceLock::new();
    LAGGED
        .get_or_init(|| {
            let ms: u64 = std::env::var("FAKE_CLAUDE_STDOUT_LAG").ok()?.parse().expect("FAKE_CLAUDE_STDOUT_LAG는 밀리초다");
            let (lines, due) = mpsc::channel::<(Instant, String)>();
            let pending = Arc::new(AtomicUsize::new(0));
            let left = Arc::clone(&pending);
            std::thread::spawn(move || {
                for (at, text) in due {
                    std::thread::sleep(at.saturating_duration_since(Instant::now()));
                    write_line(&text);
                    left.fetch_sub(1, Ordering::SeqCst);
                }
            });
            Some(Lagged { lag: Duration::from_millis(ms), lines, pending })
        })
        .as_ref()
}

/// 늦게 쓰는 줄이 남았으면 다 쓸 때까지 기다린다.
fn drain_stdout() {
    while lagged().is_some_and(|lagged| lagged.pending.load(Ordering::SeqCst) > 0) {
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// 낼 줄의 글 — `FAKE_CLAUDE_REBASE`가 있으면 녹음의 그 폴더를 이 claude의 작업 폴더로, 이어 `FAKE_CLAUDE_REROOT`가 있으면 녹음의
/// 임시 루트를 받은 폴더로 바꾼다.
fn rebased(line: &Value) -> String {
    static REBASE: std::sync::OnceLock<Vec<(String, String)>> = std::sync::OnceLock::new();
    let rebase = REBASE.get_or_init(|| {
        let cwd = std::env::var("FAKE_CLAUDE_REBASE")
            .ok()
            .and_then(|from| Some((from, std::env::current_dir().ok()?.to_string_lossy().into_owned())));
        let root = std::env::var("FAKE_CLAUDE_REROOT")
            .ok()
            .map(|pair| pair.split_once('=').map(|(from, to)| (from.to_owned(), to.to_owned())).expect("FAKE_CLAUDE_REROOT는 <녹음>=<옮길 곳>"));
        cwd.into_iter().chain(root).collect()
    });
    rebase.iter().fold(line.to_string(), |text, (from, to)| text.replace(from.as_str(), to))
}

/// 부하 값(`FAKE_CLAUDE_STREAM_*`).
struct Load {
    gap: Duration,
    total: Duration,
    /// 메시지 하나의 길이. 없으면 턴 전체가 한 메시지다.
    message: Option<Duration>,
}

impl Load {
    fn from_env() -> Option<Self> {
        let ms = |name: &str| {
            let value = std::env::var(name).ok()?;
            let ms: u64 = value.parse().unwrap_or_else(|_| panic!("{name}는 밀리초다: {value}"));
            Some(Duration::from_millis(ms))
        };
        Some(Self {
            gap: ms("FAKE_CLAUDE_STREAM_GAP_MS")?,
            total: ms("FAKE_CLAUDE_STREAM_FOR_MS")?,
            message: ms("FAKE_CLAUDE_STREAM_MESSAGE_MS"),
        })
    }

    /// 턴 전체의 조각 수.
    fn pieces(&self) -> usize {
        (self.total.as_millis() / self.gap.as_millis()) as usize
    }

    /// 메시지 하나의 조각 수.
    fn pieces_per_message(&self) -> usize {
        self.message.map_or(self.pieces(), |message| (message.as_millis() / self.gap.as_millis()) as usize)
    }
}

struct Fake {
    receipts: Option<PathBuf>,
    session_id: String,
    /// 되감는 `Write`를 cwd에 정말 쓰나(`FAKE_CLAUDE_PERFORMS_WRITES`).
    writes: bool,
    /// 받은 `--mcp-config` — 원문의 MCP 부르기를 정말 부를 서버들.
    servers: Option<Value>,
    /// 원문의 MCP 부르기를 정말 불러 받은 답 — 도구 id → `tools/call`의 `result`. 뒤따르는 그 `tool_result`를 이것으로 바꾼다.
    answered: RefCell<HashMap<String, Value>>,
}

impl Fake {
    /// 되감기가 낸 줄들을 차례로 낸다. 정말 쓰기로 했으면 `Write` 도구 호출의 글을 그 줄을 내기 전에 쓴다. 원문의 MCP 부르기는 그
    /// 줄을 낸 뒤 정말 부르고, 그 `tool_result`는 받은 답으로 바꿔 낸다.
    fn emit_all(&self, lines: Vec<Value>) {
        for line in lines {
            if self.writes {
                self.perform_writes(&line);
            }
            let line = self.with_answers(line);
            emit(&line);
            self.call_recorded(&line);
        }
    }

    /// 부하 턴 하나를 낸다 — 도는 동안 stdin은 읽어 영수증에 적되 답하지 않는다.
    fn flow(&self, load: &Load) {
        let session = self.session_id.as_str();
        let (init, result) = claude_replay::load_bookends(session);
        emit(&init);
        let pieces = claude_replay::load_pieces(load.pieces());
        let started = Instant::now();
        let mut sent = 0;
        let messages = pieces.chunks(load.pieces_per_message()).enumerate().map(|(nth, pieces)| (format!("msg_load_{nth}"), pieces));
        let mut count = 0;
        for (id, pieces) in messages {
            for piece in pieces {
                std::thread::sleep((started + load.gap * sent).saturating_duration_since(Instant::now()));
                emit(&claude_replay::load_piece(session, &id, piece));
                sent += 1;
            }
            emit(&claude_replay::load_finished(session, &id, &pieces.concat()));
            emit(&claude_replay::load_ended(session, &id));
            count += 1;
        }
        emit(&result);
        let receipt = json!({"chunks": sent, "messages": count, "ms": started.elapsed().as_millis() as u64});
        self.append("stream", &receipt.to_string());
    }

    /// 원문의 `assistant`가 받은 서버의 도구(`mcp__<서버>__<도구>`)를 부르면 그 서버를 띄워 같은 입력으로 부른다. 입력은
    /// `FAKE_CLAUDE_REBASE`로 옮긴 뒤의 것이다 — 낸 줄과 같다.
    fn call_recorded(&self, line: &Value) {
        if line["type"] != "assistant" {
            return;
        }
        let shown: Value = serde_json::from_str(&rebased(line)).expect("낸 줄은 JSON이다");
        for block in shown["message"]["content"].as_array().into_iter().flatten().filter(|block| block["type"] == "tool_use") {
            let Some((name, tool)) = block["name"].as_str().and_then(|name| name.strip_prefix("mcp__")?.split_once("__")) else {
                continue;
            };
            let Some(spec) = self.servers.as_ref().and_then(|config| config["mcpServers"].get(name)) else { continue };
            let mut server = start_server(spec);
            let tools = server.request("tools/list", json!({}))["result"]["tools"].clone();
            let answer = server.request("tools/call", json!({"name": tool, "arguments": block["input"]}));
            server.close();
            let result = answer.get("result").cloned().unwrap_or_else(|| json!({"isError": true, "content": [
                {"type": "text", "text": answer["error"]["message"]}]}));
            self.leave_mcp_receipt(name, &tools, tool, &block["input"], &result);
            self.answered.borrow_mut().insert(block["id"].as_str().unwrap_or_default().to_owned(), result);
        }
    }

    /// 원문의 `user` 줄 속 `tool_result`가 정말 부른 MCP 도구의 것이면 받은 답으로 바꾼다 — `content` · `is_error`와, 진짜 claude가
    /// 함께 싣는 `tool_use_result`.
    fn with_answers(&self, mut line: Value) -> Value {
        if line["type"] != "user" || self.answered.borrow().is_empty() {
            return line;
        }
        let mut answered = self.answered.borrow_mut();
        let mut received = None;
        for block in line["message"]["content"].as_array_mut().into_iter().flatten() {
            let Some(result) = block["tool_use_id"].as_str().and_then(|id| answered.remove(id)) else { continue };
            block["content"] = result["content"].clone();
            block["is_error"] = json!(result["isError"] == true);
            received = Some(result["content"].clone());
        }
        if let Some(content) = received.filter(|_| line.get("tool_use_result").is_some()) {
            line["tool_use_result"] = content;
        }
        line
    }

    /// 부른 MCP 도구 하나를 영수증 `<세션 id>.mcp`에 한 줄로 남긴다.
    fn leave_mcp_receipt(&self, server: &str, tools: &Value, tool: &str, arguments: &Value, result: &Value) {
        if let Some(path) = self.path("mcp") {
            let receipt = json!({"server": server, "tools": tools, "tool": tool, "arguments": arguments, "call": result});
            receipts::append_line(&path, &receipt.to_string());
        }
    }

    /// 되감기가 낸 줄들을 내며 MCP 도구들을 부른다(`FAKE_CLAUDE_MCP_CALL`). 앞머리의 부르기는 user 줄로 시작한 턴(`starting`)의
    /// `system/init` 바로 뒤(없으면 맨 앞)에서, `"at": "result"`인 부르기는 스스로 이어 간 턴이 아닌 턴의 `result` 바로 앞에서다.
    /// 부를 것이 없으면 줄만 낸다.
    fn emit_calling(&self, lines: Vec<Value>, calls: &[Value], starting: bool) {
        let (at_result, at_start): (Vec<&Value>, Vec<&Value>) = calls.iter().partition(|call| call["at"] == "result");
        let start = (starting && !at_start.is_empty())
            .then(|| lines.iter().position(|line| line["type"] == "system" && line["subtype"] == "init").map_or(0, |at| at + 1));
        let end = lines
            .iter()
            .position(|line| line["type"] == "result" && line["origin"]["kind"] != "task-notification")
            .filter(|_| !at_result.is_empty());
        let mut lines = lines.into_iter();
        let mut emitted = 0;
        let mut made = 0;
        for (at, calls) in [(start, at_start), (end, at_result)] {
            let Some(at) = at else { continue };
            self.emit_all(lines.by_ref().take(at - emitted).collect());
            emitted = at;
            made = self.call_tools(&calls, made);
        }
        self.emit_all(lines.collect());
    }

    /// MCP 도구들을 차례로 부른다 — 받은 `--mcp-config`의 서버마다 띄워 그 도구를 가진 서버에 부른다. 도구를 가진 서버가 없으면
    /// 부르지 않는다. `made`는 이 턴에 앞서 부른 수다(도구 호출 id를 가른다) — 부른 뒤의 수를 돌려준다.
    fn call_tools(&self, calls: &[&Value], mut made: usize) -> usize {
        for (name, spec) in self.servers.as_ref().and_then(|config| config["mcpServers"].as_object()).into_iter().flatten() {
            let mut server = start_server(spec);
            let tools = server.request("tools/list", json!({}))["result"]["tools"].clone();
            for call in calls {
                let tool = call["tool"].as_str().expect("FAKE_CLAUDE_MCP_CALL의 tool");
                if !tools.as_array().into_iter().flatten().any(|listed| listed["name"] == tool) {
                    continue;
                }
                // 첫 부르기의 id는 앞 판 그대로다 — 축복 기록(thread-rename)이 이 id를 싣는다.
                let nth = if made == 0 { String::new() } else { format!("_{made}") };
                made += 1;
                let id = format!("toolu_fake_mcp{nth}");
                emit(&json!({
                    "type": "assistant",
                    "message": {"id": format!("msg_fake_mcp{nth}"), "type": "message", "role": "assistant",
                                "content": [{"type": "tool_use", "id": id, "name": format!("mcp__{name}__{tool}"),
                                             "input": call["arguments"]}]},
                    "parent_tool_use_id": null, "session_id": self.session_id,
                }));
                let answer = server.request("tools/call", json!({"name": tool, "arguments": call["arguments"]}));
                let result = answer.get("result").cloned().unwrap_or_else(|| json!({"isError": true, "content": [
                    {"type": "text", "text": answer["error"]["message"]}]}));
                let block = json!({"type": "tool_result", "tool_use_id": id, "content": result["content"],
                                   "is_error": result["isError"] == true});
                emit(&json!({
                    "type": "user",
                    "message": {"role": "user", "content": [block]},
                    "parent_tool_use_id": null, "session_id": self.session_id,
                }));
                self.leave_mcp_receipt(name, &tools, tool, &call["arguments"], &result);
            }
            server.close();
        }
        made
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

    /// 없는 세션을 되살리라고 받았다 — 진짜 claude 2.1.296 · 2.1.309처럼(판 02 관문 G4) initialize에 답하지 않고, stderr에 까닭을,
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

/// `--mcp-config`의 stdio 서버 하나를 띄운다 — 진짜 claude가 서버를 띄우는 꼴이다(`command` · `args` · `env`, env는 이 가짜의 env에
/// 더한다). 몸은 가짜들이 함께 쓰는 `src/fakes/mcp_client.rs`다.
fn start_server(spec: &Value) -> McpServer {
    let program = spec["command"].as_str().expect("MCP 서버의 command");
    let args = spec["args"].as_array().into_iter().flatten().filter_map(Value::as_str);
    let env = spec["env"].as_object().into_iter().flatten().filter_map(|(name, value)| Some((name.as_str(), value.as_str()?)));
    let mut server = McpServer::start(program, args, env);
    server.handshake("fake-claude");
    server
}
