//! 가짜 ACP 에이전트의 녹음 재생 — 원문 표와, 녹음을 차례대로 짚어 가는 자리(restart 티켓 01c-1). 입출력은 하지 않는다 — 가짜
//! ACP 에이전트(`src/bin/fake-acp-agent.rs`의 `replay` 시나리오)가 stdin · stdout · 영수증 · MCP 서버를 두른다. **크레이트의 모듈 나무에
//! 들지 않는다** — 가짜 bin이 `#[path]`로 가져다 쓴다.
//!
//! 원문은 `tests/fixtures/codex-acp-2.2.2/`의 것이다 — 진짜 `codex-acp` 2.2.2(`codex` 0.162.1)를 앱과 같은 `initialize` · `session/new`로
//! 몰아 뜨고 가렸다(몰이와 가리기는 restart 스펙 `구현-노트/녹음-codex-2.2.2/`). 한 줄이 `{"from": "client" | "agent", "line": ACP
//! 메시지}`이고, 클라이언트의 `initialize`마다 새로 띄운 codex-acp다.

use serde_json::Value;

/// 재생할 원문들 — 이름 → 원문. 이름은 `codex-acp-<판>/<이름>`이다. 세션을 열면 언제나 `session/set_mode workspace-write`를 보냈다.
/// - `codex-acp-2.2.2/turns` — 답만 하는 턴과 `echo atelier` 명령의 턴.
/// - `codex-acp-2.2.2/mcp` — 앱 기능 도구 서버(`atelier-thread`)의 `rename_thread`를 부른 턴. `tool_call`(`mcp.<서버>.<도구>`,
///   `rawInput.server`) → 서버 이름 없는 `session/request_permission`(`_meta.is_mcp_tool_approval`) → `allow_once` → 끝난 도구 줄의
///   `rawOutput.result`. 녹음의 서버는 앱의 것과 이름 · 도구가 같은 대역이다.
/// - `codex-acp-2.2.2/resume` — 세 번 띄웠다. 연 세션의 한 턴 · `session/resume`(재생 없음) 뒤의 한 턴 · `session/load`(답 전에 과거를
///   되감는다) 뒤의 한 턴.
/// - `codex-acp-2.2.2/compact` — 말 두 턴 · `/compact`의 턴(`tool_call` 「Compact conversation」, 답 글 없음) · 정리한 맥락으로 답한 턴.
/// - `codex-acp-2.2.2/edit` — 작업 폴더 안 `apply_patch`(묻지 않음)의 턴과, 작업 폴더 밖 `apply_patch`가 `kind: "edit"` ·
///   `locations`로 물은 것을 거부(`cancel`)한 턴. 거부하면 턴은 `cancelled`로 끝나고 그 도구의 `failed`는 턴의 답 **뒤에** 온다.
const FIXTURES: &[(&str, &str)] = &[
    ("codex-acp-2.2.2/turns", include_str!("../../tests/fixtures/codex-acp-2.2.2/turns.jsonl")),
    ("codex-acp-2.2.2/mcp", include_str!("../../tests/fixtures/codex-acp-2.2.2/mcp.jsonl")),
    ("codex-acp-2.2.2/resume", include_str!("../../tests/fixtures/codex-acp-2.2.2/resume.jsonl")),
    ("codex-acp-2.2.2/compact", include_str!("../../tests/fixtures/codex-acp-2.2.2/compact.jsonl")),
    ("codex-acp-2.2.2/edit", include_str!("../../tests/fixtures/codex-acp-2.2.2/edit.jsonl")),
];

/// 그 이름의 원문.
pub fn fixture(name: &str) -> Option<&'static str> {
    FIXTURES.iter().find(|(known, _)| *known == name).map(|(_, recorded)| *recorded)
}

/// 고를 수 있는 원문 이름들.
pub fn fixture_names() -> Vec<&'static str> {
    FIXTURES.iter().map(|(name, _)| *name).collect()
}

/// 녹음의 한 줄 — 누가 보냈나와 ACP 메시지.
pub struct Row {
    pub from_client: bool,
    pub line: Value,
}

impl Row {
    /// 클라이언트가 보낸 요청(답을 기다리는 것)인가.
    pub fn is_client_request(&self) -> bool {
        self.from_client && self.line.get("method").is_some() && self.line.get("id").is_some()
    }
}

/// 녹음을 짚어 가는 자리 — 띄운 차례들과, 지금 차례 안의 다음 줄.
pub struct Script {
    launches: Vec<Vec<Row>>,
    launch: usize,
    at: usize,
}

impl Script {
    pub fn new(text: &str) -> Self {
        let mut launches: Vec<Vec<Row>> = Vec::new();
        for raw in text.lines().filter(|raw| !raw.trim().is_empty()) {
            let row: Value = serde_json::from_str(raw).expect("녹음은 JSON 줄이다");
            let row = Row { from_client: row["from"] == "client", line: row["line"].clone() };
            if (row.from_client && row.line["method"] == "initialize") || launches.is_empty() {
                launches.push(Vec::new());
            }
            launches.last_mut().expect("방금 더했다").push(row);
        }
        Self { launches, launch: 0, at: 0 }
    }

    /// 다음 줄 — 자리는 그대로다.
    pub fn peek(&self) -> Option<&Row> {
        self.launches.get(self.launch)?.get(self.at)
    }

    /// 다음 줄로 민다.
    pub fn advance(&mut self) {
        self.at += 1;
    }

    /// 다음 클라이언트 요청까지 건너뛴다 — 멈춘 턴의 나머지를 버린다.
    pub fn skip_to_request(&mut self) {
        while self.peek().is_some_and(|row| !row.is_client_request()) {
            self.advance();
        }
    }

    /// 지금 차례에서 그 요청 id에 녹음이 준 답.
    pub fn answer_to(&self, id: &Value) -> Option<&Value> {
        let rows = self.launches.get(self.launch)?;
        rows[self.at..].iter().find(|row| !row.from_client && row.line.get("method").is_none() && row.line["id"] == *id).map(|row| &row.line)
    }

    /// 받은 요청 `method`에 맞는 녹음의 클라이언트 요청으로 가서 그 줄을 돌려주고, 자리는 그 뒤다. 지금 차례의 남은 줄에서 먼저 찾고,
    /// 없으면 뒤 차례들에서 찾는다(되살리기는 다시 띄운 codex-acp의 일이다). 지금 차례에서 건너뛴 줄 가운데 에이전트의 알림은 함께
    /// 돌려준다 — 앱이 보내지 않은 요청(`session/set_mode`)과 그 답만 빠지고 세션의 흐름은 남는다. 뒤 차례로 가면 앞의 것은 모두 버린다.
    /// 맞는 것이 없으면 `None`이고 자리는 그대로다.
    pub fn seek(&mut self, method: &str) -> Option<(Value, Vec<Value>)> {
        let wanted = |row: &Row| row.is_client_request() && row.line["method"] == method;
        let rows = self.launches.get(self.launch)?;
        if let Some(found) = rows[self.at..].iter().position(wanted).map(|offset| self.at + offset) {
            let skipped = rows[self.at..found]
                .iter()
                .filter(|row| !row.from_client && row.line.get("method").is_some() && row.line.get("id").is_none())
                .map(|row| row.line.clone())
                .collect();
            let request = rows[found].line.clone();
            self.at = found + 1;
            return Some((request, skipped));
        }
        let (launch, found) = (self.launch + 1..self.launches.len())
            .find_map(|launch| self.launches[launch].iter().position(wanted).map(|found| (launch, found)))?;
        let request = self.launches[launch][found].line.clone();
        (self.launch, self.at) = (launch, found + 1);
        Some((request, Vec::new()))
    }
}
