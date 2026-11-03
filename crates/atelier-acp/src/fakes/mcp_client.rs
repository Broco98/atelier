//! 가짜들이 녹음 속 MCP 부르기를 정말 부를 때 쓰는 stdio MCP 클라이언트 — 진짜 Runtime이 서버를 띄우는 꼴이다(명령 · 인자 · env,
//! env는 가짜의 env에 더한다). **크레이트의 모듈 나무에 들지 않는다** — 가짜 bin들(`fake-claude` · `fake-acp-agent`)이 `#[path]`로
//! 가져다 쓴다. 서버의 자리는 Runtime마다 꼴이 달라(claude의 `--mcp-config` · ACP `mcpServers`) 부르는 쪽이 풀어 준다.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value};

/// 띄운 stdio MCP 서버 하나와 줄 단위 JSON-RPC로 말한다.
pub struct McpServer {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    next: u64,
}

impl McpServer {
    pub fn start<'a>(program: &str, args: impl IntoIterator<Item = &'a str>, env: impl IntoIterator<Item = (&'a str, &'a str)>) -> Self {
        let mut child = Command::new(program)
            .args(args)
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap_or_else(|error| panic!("MCP 서버를 띄우지 못했다: {program} — {error}"));
        let stdin = child.stdin.take();
        let stdout = BufReader::new(child.stdout.take().expect("stdout을 파이프로 띄웠다"));
        Self { child, stdin, stdout, next: 0 }
    }

    fn send(&mut self, message: &Value) {
        let stdin = self.stdin.as_mut().expect("닫지 않은 stdin");
        writeln!(stdin, "{message}").and_then(|()| stdin.flush()).expect("MCP 서버에 쓰지 못했다");
    }

    /// 요청 하나를 보내고 그 id의 답을 받는다 — 그 사이에 온 알림은 버린다.
    pub fn request(&mut self, method: &str, params: Value) -> Value {
        self.next += 1;
        let id = self.next;
        self.send(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        loop {
            let mut line = String::new();
            if self.stdout.read_line(&mut line).expect("MCP 서버의 답을 읽지 못했다") == 0 {
                panic!("MCP 서버가 {method}에 답하지 않고 끝났다");
            }
            let Ok(answer) = serde_json::from_str::<Value>(&line) else { continue };
            if answer["id"] == id {
                return answer;
            }
        }
    }

    fn notify(&mut self, method: &str) {
        self.send(&json!({"jsonrpc": "2.0", "method": method}));
    }

    /// `initialize` → `notifications/initialized` — 진짜 Runtime이 서버를 띄운 뒤 하는 맞이.
    pub fn handshake(&mut self, client: &str) {
        self.request("initialize", json!({"protocolVersion": "2025-06-18", "capabilities": {},
                                          "clientInfo": {"name": client, "version": "0"}}));
        self.notify("notifications/initialized");
    }

    /// stdin을 닫고 끝나기를 기다린다 — stdio MCP 서버는 stdin EOF에 끝난다.
    pub fn close(mut self) {
        drop(self.stdin.take());
        let _ = self.child.wait();
    }
}
