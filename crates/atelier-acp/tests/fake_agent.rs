//! 가짜 ACP 에이전트의 독립 검증.
//!
//! 실행 파일에 요청을 흘려 넣고 나오는 응답 프레임을 본다. 테스트 전용 주입점을 만들지
//! 않고 제품과 같은 방식으로 — 커맨드 한 줄로 — 가짜를 가리킨다.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

/// 어댑터 설정의 커맨드가 가리킬 실행 파일. cargo가 경로를 알려준다.
const FAKE_AGENT: &str = env!("CARGO_BIN_EXE_fake-agent");

struct Wire {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Wire {
    fn spawn(scenario: &str) -> Self {
        let mut child = Command::new(FAKE_AGENT)
            .arg(scenario)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("가짜 에이전트를 띄우지 못했다");
        let stdin = child.stdin.take().expect("stdin");
        let stdout = BufReader::new(child.stdout.take().expect("stdout"));
        Self {
            child,
            stdin,
            stdout,
        }
    }

    fn request(&mut self, line: &str) -> serde_json::Value {
        writeln!(self.stdin, "{line}").expect("요청을 쓰지 못했다");
        self.stdin.flush().expect("flush");
        let mut answer = String::new();
        self.stdout
            .read_line(&mut answer)
            .expect("응답을 읽지 못했다");
        assert!(!answer.is_empty(), "응답 없이 스트림이 닫혔다");
        serde_json::from_str(&answer).expect("응답이 JSON 한 줄이 아니다")
    }
}

impl Drop for Wire {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn normal_scenario_answers_handshake() {
    let mut wire = Wire::spawn("normal");

    let frame = wire.request(
        r#"{"jsonrpc":"2.0","id":"h1","method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}}}"#,
    );

    assert_eq!(frame["jsonrpc"], "2.0");
    assert_eq!(frame["id"], "h1", "응답이 요청 id를 그대로 돌려줘야 한다");
    assert_eq!(frame["result"]["protocolVersion"], 1);
    assert!(
        frame["result"]["agentCapabilities"].is_object(),
        "핸드셰이크는 능력을 광고해야 한다: {frame}"
    );
}

#[test]
fn normal_scenario_opens_a_session() {
    let mut wire = Wire::spawn("normal");

    wire.request(
        r#"{"jsonrpc":"2.0","id":"h1","method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}"#,
    );
    let frame = wire.request(
        r#"{"jsonrpc":"2.0","id":"s1","method":"session/new","params":{"cwd":"/tmp","mcpServers":[]}}"#,
    );

    assert_eq!(frame["id"], "s1");
    let session_id = frame["result"]["sessionId"]
        .as_str()
        .unwrap_or_else(|| panic!("세션 id가 문자열이 아니다: {frame}"));
    assert!(!session_id.is_empty());
}

/// 세션 id는 프로세스마다 달라야 한다. 티켓 04가 같은 프로젝트로 두 번 시작해
/// 두 신원 파일의 에이전트 세션 id가 서로 다름을 검사할 것이기 때문이다.
#[test]
fn session_ids_differ_between_processes() {
    let open = || {
        let mut wire = Wire::spawn("normal");
        wire.request(
            r#"{"jsonrpc":"2.0","id":"s1","method":"session/new","params":{"cwd":"/tmp","mcpServers":[]}}"#,
        )["result"]["sessionId"]
            .as_str()
            .expect("세션 id")
            .to_string()
    };

    assert_ne!(open(), open());
}

#[test]
fn unknown_method_becomes_an_error_frame_not_a_crash() {
    let mut wire = Wire::spawn("normal");

    let frame = wire.request(r#"{"jsonrpc":"2.0","id":"x1","method":"session/nope","params":{}}"#);

    assert_eq!(frame["id"], "x1");
    assert!(
        frame["error"].is_object(),
        "모르는 메서드는 오류 프레임이어야 한다: {frame}"
    );
}
