//! L1 — 가짜 ACP 에이전트가 진짜 codex-acp 2.2.2의 녹음을 재생한다(restart 티켓 01c-1 · 스펙 「시험 자료」).
//!
//! 녹음은 `tests/fixtures/codex-acp-2.2.2/`에 있다 — 진짜 `codex-acp` 2.2.2(`codex` 0.162.1)를 앱과 같은 `initialize` ·
//! `session/new`로 몰아 뜨고 계정 정보를 가렸다. 한 줄이 `{"from": "client" | "agent", "line": ACP 메시지}`다.
//!
//! 시험은 가짜를 띄워 그 stdio만 보거나(녹음의 클라이언트 줄을 보내고 나오는 줄을 녹음과 견준다), 호스트에 넣어 Thread 폴더와 가짜의
//! 영수증만 본다.

mod common;

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};

use atelier_acp::{ConversationHost, ThreadLink, TranslatorCommand};
use common::{of_kind, wait_until, Sandbox, PATIENCE};
use serde_json::{json, Value};

/// 녹음 하나의 줄들 — `(from, line)`.
fn recorded(name: &str) -> Vec<(String, Value)> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(format!("{name}.jsonl"));
    common::record_at(&path)
        .into_iter()
        .map(|row| (row["from"].as_str().expect("from").to_owned(), row["line"].clone()))
        .collect()
}

/// 녹음을 띄운 차례로 가른다 — 클라이언트의 `initialize`가 새 프로세스의 시작이다.
fn launches(rows: Vec<(String, Value)>) -> Vec<Vec<(String, Value)>> {
    let mut launches: Vec<Vec<(String, Value)>> = Vec::new();
    for row in rows {
        if row.0 == "client" && row.1["method"] == "initialize" {
            launches.push(Vec::new());
        }
        launches.last_mut().expect("녹음은 initialize로 시작한다").push(row);
    }
    launches
}

/// 재생하는 가짜 하나 — stdin에 쓰고 stdout 줄을 받는다.
struct Replaying {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Receiver<Value>,
}

impl Replaying {
    fn start(fixture: &str, receipts: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_fake-acp-agent"))
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("FAKE_ACP_SCENARIO", "replay")
            .env("FAKE_ACP_FIXTURE", fixture)
            .env("FAKE_ACP_RECEIPTS", receipts)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("가짜 ACP 에이전트");
        let stdout = BufReader::new(child.stdout.take().expect("stdout"));
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in stdout.lines().map_while(Result::ok) {
                if tx.send(serde_json::from_str::<Value>(&line).expect("가짜가 낸 줄은 JSON이다")).is_err() {
                    break;
                }
            }
        });
        Self { stdin: child.stdin.take(), child, lines }
    }

    fn send(&mut self, line: &Value) {
        let stdin = self.stdin.as_mut().expect("닫지 않은 stdin");
        writeln!(stdin, "{line}").and_then(|()| stdin.flush()).expect("가짜에 쓴다");
    }

    fn next(&self, expected: &Value) -> Value {
        self.lines.recv_timeout(PATIENCE).unwrap_or_else(|_| panic!("가짜가 다음 줄을 내지 않았다 — 기다린 줄: {expected}"))
    }

    /// stdin을 닫고, 그 뒤에 더 낸 줄을 돌려준다.
    fn finish(mut self) -> Vec<Value> {
        drop(self.stdin.take());
        let rest: Vec<Value> = self.lines.iter().collect();
        let _ = self.child.wait();
        rest
    }
}

/// 녹음의 세션 id를 가짜가 쓰는 세션 id로 바꾼 줄.
fn with_session(line: &Value, ids: &[(String, String)]) -> Value {
    let text = ids.iter().fold(line.to_string(), |text, (from, to)| text.replace(from.as_str(), to));
    serde_json::from_str(&text).expect("JSON")
}

/// 녹음의 한 차례를 그대로 몬다 — 클라이언트 줄은 보내고(세션 id만 바꿔), 에이전트 줄은 가짜가 낸 줄과 견준다. 앱의 MCP 서버는 주지
/// 않는다(`mcpServers: []`). 견준 세션 id 짝을 `ids`에 더한다.
fn drive(fixture: &str, launch: &[(String, Value)], receipts: &Path, ids: &mut Vec<(String, String)>) {
    let mut agent = Replaying::start(fixture, receipts);
    for (from, line) in launch {
        if from == "client" {
            let mut line = with_session(line, ids);
            if line["params"].get("mcpServers").is_some() {
                line["params"]["mcpServers"] = json!([]);
            }
            agent.send(&line);
            continue;
        }
        let got = agent.next(line);
        if let (Some(recorded), Some(live)) = (line["result"]["sessionId"].as_str(), got["result"]["sessionId"].as_str()) {
            ids.push((recorded.to_owned(), live.to_owned()));
        }
        assert_eq!(got, with_session(line, ids), "{fixture}");
    }
    assert_eq!(agent.finish(), Vec::<Value>::new(), "{fixture}: 녹음에 없는 줄을 더 냈다");
}

fn receipts_dir() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("임시 폴더");
    let path = dir.path().to_path_buf();
    (dir, path)
}

/// 녹음 다섯.
const FIXTURES: [&str; 5] =
    ["codex-acp-2.2.2/turns", "codex-acp-2.2.2/mcp", "codex-acp-2.2.2/resume", "codex-acp-2.2.2/compact", "codex-acp-2.2.2/edit"];

#[test]
fn 녹음의_클라이언트_줄을_보내면_녹음의_에이전트_줄이_그대로_나온다() {
    for fixture in FIXTURES {
        let (_dir, receipts) = receipts_dir();
        let mut ids = Vec::new();
        // resume은 세 번 띄웠다 — 다시 띄운 가짜는 앞서 연 세션을 되살린다.
        for launch in launches(recorded(fixture)) {
            drive(fixture, &launch, &receipts, &mut ids);
        }
    }
}

/// 그 녹음을 재생하는 가짜 ACP 에이전트를 Runtime 자리에 둔 호스트로 새 Thread를 세운다.
fn thread_replaying(sandbox: &Sandbox, fixture: &str, first: &str) -> (ConversationHost, String) {
    let receipts = sandbox.claude_receipts();
    let env = [
        ("FAKE_ACP_SCENARIO", "replay"),
        ("FAKE_ACP_FIXTURE", fixture),
        ("FAKE_ACP_VERSION", env!("CARGO_PKG_VERSION")),
        ("FAKE_ACP_RECEIPTS", receipts.to_str().unwrap()),
    ];
    let agent = TranslatorCommand::new(env!("CARGO_BIN_EXE_fake-acp-agent"), Vec::<String>::new());
    let host = sandbox.host_builder_with_translator(sandbox.claude_login_shell("normal", &env), agent, |_| {}).build();
    let thread = host.start_thread(first, ThreadLink::NoWork).expect("새 Thread의 첫 말");
    (host, thread)
}

/// 턴이 끝날 때까지 기다린다. 그 사이 승인 카드가 서면 「한 번만 허용」으로 답한다 — 이 시험은 녹음을 Claude 변환기 자리에 두어 Claude의 판정이
/// 묻는다. Codex 채팅의 판정은 앱 서버의 도구를 카드 없이 허용한다(`thread_codex.rs`, 01c-7).
fn finish_turn_allowing(sandbox: &Sandbox, host: &ConversationHost, thread: &str) -> Vec<Value> {
    let mut answered = Vec::new();
    wait_until("턴이 끝나지 않았다", || {
        let record = sandbox.thread_record(thread);
        for asked in of_kind(&record, "permission").into_iter().filter(|line| line["payload"]["state"] == "asked") {
            let request = asked["payload"]["requestId"].as_str().expect("요청 id").to_owned();
            if !answered.contains(&request) {
                host.answer_thread_permission(thread, &request, "allow_once").expect("한 번만 허용");
                answered.push(request);
            }
        }
        if of_kind(&record, "turn-end").is_empty() {
            Err(common::lines_text(&record))
        } else {
            Ok(record)
        }
    })
}

#[test]
fn 녹음의_mcp_부르기가_앱_기능_도구를_지나_thread_이름을_바꾸고_받은_답이_도구_줄에_실린다() {
    let sandbox = Sandbox::new();
    let (host, thread) = thread_replaying(&sandbox, "codex-acp-2.2.2/mcp", "환불이 두 번 빠져요");

    let record = finish_turn_allowing(&sandbox, &host, &thread);

    // 녹음의 인자(「환불 API 버그」)로 앱의 중계 서버 → Session의 소켓 → 엔진을 지났다.
    assert_eq!(sandbox.thread_json(&thread)["title"], "환불 API 버그");
    let titles = of_kind(&record, "title");
    assert_eq!(titles.len(), 1, "{}", common::lines_text(&record));
    assert_eq!(titles[0]["payload"], json!({"title": "환불 API 버그", "before": "환불이 두 번 빠져요"}));
    let session = sandbox.thread_session_id(&thread);
    let called = common::record_at(&sandbox.claude_receipts().join(format!("{session}.mcp")));
    assert_eq!(called.len(), 1, "{called:?}");
    assert_eq!((&called[0]["server"], &called[0]["tool"]), (&json!("atelier-thread"), &json!("rename_thread")));
    let listed: Vec<&str> = called[0]["tools"].as_array().unwrap().iter().filter_map(|tool| tool["name"].as_str()).collect();
    assert!(listed.contains(&"propose_work"), "녹음의 대역이 아니라 앱의 도구 목록이다: {listed:?}");
    // 도구 줄의 끝에 실린 답은 엔진이 준 것이다.
    let ended = record
        .iter()
        .find(|line| line["payload"]["update"]["sessionUpdate"] == "tool_call_update" && line["payload"]["update"]["status"] == "completed")
        .unwrap_or_else(|| panic!("끝난 도구 줄이 없다:\n{}", common::lines_text(&record)));
    assert_eq!(ended["payload"]["update"]["rawOutput"]["result"]["content"], called[0]["call"]["content"]);
    host.shut_down();
}

// ── 가리기 ─────────────────────────────────────────────────────────────────────────

/// 글에 남은 계정 흔적 — 이메일, `/Users/USER` 밖의 홈 경로, 녹음한 자리(스크래치 · `TMPDIR`), 가리지 않은 계정 칸.
fn account_traces(text: &str) -> Vec<String> {
    let around = |at: usize| text[at.saturating_sub(24)..].chars().take(64).collect::<String>();
    let mut traces = Vec::new();
    for (at, _) in text.match_indices('@') {
        let local = text[..at].chars().next_back().is_some_and(|c| c.is_ascii_alphanumeric() || "._%+-".contains(c));
        let domain: String = text[at + 1..].chars().take_while(|c| c.is_ascii_alphanumeric() || ".-".contains(*c)).collect();
        if local && domain.rsplit_once('.').is_some_and(|(_, top)| top.len() >= 2 && top.chars().all(char::is_alphabetic)) {
            traces.push(around(at));
        }
    }
    for (at, _) in text.match_indices("/Users/").chain(text.match_indices("-Users-")) {
        if !text[at + 7..].starts_with("USER") {
            traces.push(around(at));
        }
    }
    for marker in ["/var/folders/", "/private/tmp/claude-", "scratchpad"] {
        traces.extend(text.match_indices(marker).map(|(at, _)| around(at)));
    }
    for line in text.lines().filter_map(|line| serde_json::from_str::<Value>(line).ok()) {
        let status = &line["line"]["params"]["authStatus"];
        for (value, placeholder) in [(&status["label"], "<label>"), (&status["account"]["email"], "<email>"), (&status["account"]["plan"], "<plan>")] {
            if value.is_string() && value != placeholder {
                traces.push(format!("가리지 않은 계정 칸: {value}"));
            }
        }
    }
    traces
}

/// 녹음의 글 조각을 메시지마다 이어 붙인 글 — 조각은 경로와 이메일을 토막 낸다.
fn joined_chunks(text: &str) -> String {
    let mut messages: Vec<(Value, String)> = Vec::new();
    for line in text.lines().filter_map(|line| serde_json::from_str::<Value>(line).ok()) {
        let update = &line["line"]["params"]["update"];
        let Some(piece) = update["content"]["text"].as_str() else { continue };
        let key = json!([update["sessionUpdate"], update["messageId"]]);
        match messages.iter_mut().find(|(seen, _)| *seen == key) {
            Some((_, joined)) => joined.push_str(piece),
            None => messages.push((key, piece.to_owned())),
        }
    }
    messages.into_iter().map(|(_, joined)| joined).collect::<Vec<_>>().join("\n")
}

/// 녹음 한 줄의 꼴로 쓴 글 조각.
fn chunk_line(text: &str) -> String {
    json!({"from": "agent", "line": {"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "s",
           "update": {"sessionUpdate": "agent_message_chunk", "messageId": "msg_1", "content": {"type": "text", "text": text}}}}})
    .to_string()
}

#[test]
fn 계정_흔적을_찾는_손이_토막_난_것까지_잡는다() {
    let split = |one: &str, two: &str| format!("{}\n{}\n", chunk_line(one), chunk_line(two));
    assert!(account_traces(&split("/Use", "rs/dana/notes")).is_empty(), "토막 나면 줄 단위로는 보이지 않는다");
    assert!(!account_traces(&joined_chunks(&split("/Use", "rs/dana/notes"))).is_empty());
    assert!(!account_traces(&joined_chunks(&split("dana@exam", "ple.com"))).is_empty());
    let status = |email: &str| {
        json!({"from": "agent", "line": {"jsonrpc": "2.0", "method": "_auth/status_update",
               "params": {"authStatus": {"kind": "account", "label": "<label>", "account": {"email": email, "plan": "<plan>"}}}}})
        .to_string()
    };
    assert!(!account_traces(&status("dana")).is_empty(), "이메일 꼴이 아니어도 계정 칸은 가린 값이어야 한다");
    assert!(account_traces(&status("<email>")).is_empty());
    for dirty in ["/var/folders/r0/x/T/w", "/private/tmp/claude-501/-x/scratchpad/codex-rec"] {
        assert!(!account_traces(dirty).is_empty(), "{dirty}");
    }
    for clean in ["/Users/USER/.atelier", "/tmp/gate/turns/work", "@agentclientprotocol/codex-acp"] {
        assert!(account_traces(clean).is_empty(), "{clean}");
    }
}

#[test]
fn 뜬_codex_자료에_계정_정보와_홈_경로가_없다() {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/codex-acp-2.2.2");
    let mut files = 0;
    for entry in std::fs::read_dir(&folder).expect("codex-acp 2.2.2 자료 폴더") {
        let path = entry.expect("파일").path();
        let text = std::fs::read_to_string(&path).expect("글");
        files += 1;
        assert_eq!(account_traces(&text), Vec::<String>::new(), "{path:?}");
        assert_eq!(account_traces(&joined_chunks(&text)), Vec::<String>::new(), "{path:?}의 이은 조각");
    }
    assert_eq!(files, FIXTURES.len(), "재생하는 녹음과 폴더의 파일이 같다");
}
