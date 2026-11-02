//! ACP `mcpServers`를 claude의 플래그로 옮긴다(v1 티켓 12 · 15).
//!
//! 입출력은 하지 않는다 — 상태 기계([`super::machine`])가 세션을 열 때 부른다.

use serde_json::{json, Value};

/// 호스트가 넘긴 MCP 서버의 도구 시간 제한(ms) — claude가 받는 가장 긴 값(JS 타이머의 한도 2^31-1, 약 24.8일)이다.
///
/// **엔진은 사람을 기다리는 도구에 시간 제한을 두지 않는다.** 카드를 세운 Thread 도구는 사람이 고를 때까지 기다린다 — 사람의 답은
/// 하룻밤일 수도 있다. claude의 시간 제한에 걸리면 Agent는 결과 없이 실패를 받고 카드는 그대로 선다. env `MCP_TOOL_TIMEOUT`이 아니라
/// 서버마다의 `timeout` 칸(2.1.309 MCP 설정의 stdio 꼴)으로 준다 — 사용자의 MCP 서버는 사용자 설정 그대로다(결정.md 16).
const TOOL_TIMEOUT_MS: u64 = 2_147_483_647;

/// ACP `mcpServers` → `--mcp-config`의 값(claude의 MCP 설정 JSON 글). 넘길 서버가 없으면 `None`이다.
///
/// stdio 서버(ACP에서 `type`이 없다)를 claude의 `{"type": "stdio", command, args, env, timeout}`로 옮긴다 — `env`는 이름 · 값
/// 목록에서 맵으로, `timeout`은 [`TOOL_TIMEOUT_MS`]다. **`--strict-mcp-config`는 주지 않는다** — 사용자의 MCP 설정과 claude.ai
/// 커넥터는 지금처럼 함께 붙는다(S39 · three-axes 결정 23).
///
/// http · sse는 받지 않는다 — 변환기가 `mcpCapabilities`로 광고하지 않았으므로 오는 것은 호스트의 잘못이다. 건너뛰면 그 서버의
/// 도구가 소리 없이 빠진다.
pub(super) fn mcp_config(servers: &Value) -> Result<Option<String>, String> {
    let mut config = serde_json::Map::new();
    for server in servers.as_array().into_iter().flatten() {
        let name = server["name"].as_str().unwrap_or_default().to_owned();
        if let Some(kind) = server["type"].as_str().filter(|kind| *kind != "stdio") {
            return Err(format!("stdio가 아닌 MCP 서버는 받지 않습니다: {name} ({kind})"));
        }
        let env: serde_json::Map<String, Value> = server["env"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|var| Some((var["name"].as_str()?.to_owned(), var["value"].clone())))
            .collect();
        let args = server.get("args").cloned().unwrap_or_else(|| json!([]));
        config.insert(
            name,
            json!({"type": "stdio", "command": server["command"], "args": args, "env": env, "timeout": TOOL_TIMEOUT_MS}),
        );
    }
    Ok((!config.is_empty()).then(|| json!({"mcpServers": config}).to_string()))
}

/// ACP `mcpServers`의 서버 이름들 — 앱이 넘긴 서버다.
pub(super) fn names(servers: &Value) -> Vec<String> {
    servers.as_array().into_iter().flatten().filter_map(|server| server["name"].as_str()).map(str::to_owned).collect()
}

/// ACP `mcpServers` → `--allowedTools`의 값 — 넘겨받은 서버마다 `mcp__<이름>`(그 서버의 도구 전부). 넘길 서버가 없으면 `None`이다.
///
/// **호스트가 넘긴 서버의 도구는 claude가 묻지 않는다**(결정.md 15). 그 서버는 엔진의 Thread 도구(S12)이고, 도구마다 스스로 가린다 —
/// 사람에게 카드로 물을지(Work 만들기 · Project 고치기). claude가 또 물으면 Thread의 일마다 승인 카드가 서고, 판정(§9)이 아닌 곳에서
/// 허락이 갈린다. 사용자 MCP는 여기 들지 않는다 — 사용자 설정 그대로 묻는다.
pub(super) fn allowed(servers: &Value) -> Option<String> {
    let rules: Vec<String> = names(servers).iter().map(|name| format!("mcp__{name}")).collect();
    (!rules.is_empty()).then(|| rules.join(","))
}
