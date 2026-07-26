use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use assert_cmd::cargo::CommandCargoExt;
use serde_json::{json, Value};

/// `atelier mcp`를 서브프로세스로 띄우고 JSON-RPC를 한 줄씩 주고받는 최소 클라이언트.
/// 호스트가 하는 일을 그대로 흉내 낸다.
struct Server {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Server {
    fn start(home: &std::path::Path) -> Self {
        let mut child = Command::cargo_bin("atelier")
            .unwrap()
            .arg("mcp")
            .env("ATELIER_HOME", home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut server = Server { child, stdin, stdout };

        // 프로토콜 버전은 클라이언트가 제안하는 값이고, 서버가 무엇으로 응답할지는
        // SDK가 정한다 (A5 — 코드에 상수를 박지 않는다). 문자열이기만 하면 통과.
        let init = server.request(
            1,
            "initialize",
            json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "atelier-test", "version": "0" }
            }),
        );
        assert!(
            init["result"]["protocolVersion"].is_string(),
            "handshake failed: {init}"
        );
        server.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        server
    }

    fn send(&mut self, msg: &Value) {
        writeln!(self.stdin, "{msg}").unwrap();
        self.stdin.flush().unwrap();
    }

    /// 응답을 한 줄 읽는다. Δ13 — 읽히는 모든 줄은 JSON-RPC 메시지여야 한다.
    fn request(&mut self, id: u32, method: &str, params: Value) -> Value {
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        let mut line = String::new();
        let n = self.stdout.read_line(&mut line).unwrap();
        assert!(n > 0, "server closed stdout before answering {method}");
        let msg: Value = serde_json::from_str(&line)
            .unwrap_or_else(|e| panic!("stdout is not a JSON-RPC line ({e}): {line:?}"));
        assert_eq!(msg["jsonrpc"], "2.0", "stdout polluted: {line:?}");
        assert_eq!(msg["id"], id, "out-of-order reply: {line:?}");
        msg
    }

    fn tool_names(&mut self, id: u32) -> Vec<String> {
        let res = self.request(id, "tools/list", json!({}));
        res["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn handshake_succeeds_and_stdout_carries_only_protocol_messages() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    // 배너·로그가 한 줄이라도 표준출력에 섞였다면 request()의 JSON 파싱에서 터진다
    let res = server.request(2, "tools/list", json!({}));
    assert!(res["result"]["tools"].is_array(), "tools/list failed: {res}");
}

#[test]
fn list_projects_returns_registered_projects() {
    let home = tempfile::tempdir().unwrap();
    let code = tempfile::tempdir().unwrap();
    let folder = code.path().join("billing");
    std::fs::create_dir(&folder).unwrap();
    atelier_core::create_project(&home.path().join("projects"), &folder).unwrap();

    let mut server = Server::start(home.path());
    assert_eq!(server.tool_names(2), vec!["atelier_list_projects"]);

    let res = server.request(3, "tools/call",
        json!({ "name": "atelier_list_projects", "arguments": {} }));
    assert_eq!(res["result"]["isError"], false, "{res}");

    // 결과는 JSON 텍스트 한 블록이다 (A1)
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    let views: Value = serde_json::from_str(text).unwrap();
    assert_eq!(views[0]["slug"], "billing");
    assert!(views[0]["baseBranch"].is_string(), "{text}");
}

#[test]
fn read_tools_declare_read_only_and_local_only() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));
    for tool in res["result"]["tools"].as_array().unwrap() {
        let a = &tool["annotations"];
        assert_eq!(a["readOnlyHint"], true, "{tool}");
        assert_eq!(a["openWorldHint"], false, "{tool}");
    }
}
