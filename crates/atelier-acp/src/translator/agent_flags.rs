//! Agent 정의에서 오는 도구 · 금지와 ACP `mcpServers`를 claude의 플래그로 옮긴다(v1 구현 스펙 §3 · S19 · v1 티켓 12).
//!
//! Agent 파일은 Runtime 중립 이름(추상 도구 `read` · `edit` …, 금지 `push` …)을 쓰고, Runtime의 이름으로 옮기는 일은 이 변환기가
//! 맡는다(agent-definition.md 「Runtime 추상화」). 엔진은 정의 스냅숏의 이름을 그대로 `_meta.atelier`에 싣는다.
//!
//! 입출력은 하지 않는다 — 상태 기계([`super::machine`])가 세션을 열 때 부른다.

use serde_json::{json, Value};

/// 편집 도구 전부 · 명령 전부 — 내장 도구 표와 금지 규칙(S19)이 함께 쓴다.
const EDIT: &[&str] = &["Edit", "Write", "NotebookEdit"];
const SHELL: &[&str] = &["Bash"];

/// 추상 도구 → Claude Code 도구(v1 구현 스펙 §3 「추상 도구」 표).
const BUILTIN: [(&str, &[&str]); 5] = [
    ("read", &["Read", "Glob", "Grep", "LS"]),
    ("search", &["Glob", "Grep"]),
    ("edit", EDIT),
    ("shell", SHELL),
    ("web", &["WebFetch", "WebSearch"]),
];

/// 금지의 추상 이름이 막는 것(v1 구현 스펙 S19).
enum Forbidden {
    /// 그 도구 전부.
    Tools(&'static [&'static str]),
    /// 그 명령들 — 맨 명령(`git push`)과 인자가 붙은 것(`git push *`)을 함께 막는다. 인자 없는 `git push`가 가장 흔한 밀기다.
    Commands(&'static [&'static str]),
}

/// 금지의 추상 이름 → 막는 것(S19). `schema`(마이그레이션 명령)는 고정 목록이 없다 — 파일에 명령 패턴으로 적는다(결정.md 12).
const FORBID: [(&str, Forbidden); 4] = [
    ("edit", Forbidden::Tools(EDIT)),
    ("shell", Forbidden::Tools(SHELL)),
    ("push", Forbidden::Commands(&["git push"])),
    ("merge", Forbidden::Commands(&["gh pr merge", "git merge"])),
];

/// **내장 도구를 골라도 늘 남는 도구 — 능력이 아니라 Runtime의 반복이 사람 · Atelier와 주고받는 길이다**(결정.md 12). `--tools`는
/// 적지 않은 내장 도구를 모두 걷으므로, 이것이 빠지면 Agent가 사람에게 묻지 못하고 계획 모드에서 계획을 넘기지 못하며(v1 티켓
/// 26), 미뤄 실린 MCP 도구 — Thread 도구(S12) — 에 닿지 못한다.
const RUNTIME_TOOLS: [&str; 3] = ["AskUserQuestion", "ExitPlanMode", "ToolSearch"];

/// `tools.builtin` → `--tools`의 값. **없으면(`null`) 플래그를 주지 않는다 — claude의 기본 도구 전부다**(§3). 빈 목록은 내장
/// 도구 없음이라 [`RUNTIME_TOOLS`]만 남는다. 겹치는 도구는 처음 나온 자리에 한 번만 든다.
///
/// 모르는 추상 이름은 Agent 파일 오류다(§6) — 그 까닭으로 실패한다. 건너뛰면 Agent가 적은 것보다 적은 도구로, 플래그를 빼면 기본
/// 도구 전부로 조용히 뜬다.
pub(super) fn tools(builtin: &Value) -> Result<Option<String>, String> {
    let Some(names) = builtin.as_array() else {
        return Ok(None);
    };
    let mut tools: Vec<&str> = Vec::new();
    for name in names {
        let name = name.as_str().unwrap_or_default();
        let (_, mapped) = BUILTIN
            .iter()
            .find(|(abstract_name, _)| *abstract_name == name)
            .ok_or_else(|| format!("모르는 추상 도구입니다: {name}"))?;
        for tool in mapped.iter() {
            if !tools.contains(tool) {
                tools.push(tool);
            }
        }
    }
    tools.extend(RUNTIME_TOOLS);
    Ok(Some(tools.join(",")))
}

/// `policy.forbid` → `--disallowedTools`의 값. 추상 이름은 S19 표대로 옮기고, 명령 패턴 `Bash(…)`은 그대로 넘긴다. 금지된
/// 도구 · 명령은 claude가 묻지 않고 거절한다 — 같은 규칙으로 판정도 거절한다(§9, v1 티켓 22). 옮길 규칙이 없으면 `None`이다.
pub(super) fn disallowed(forbid: &Value) -> Option<String> {
    let mut rules: Vec<String> = Vec::new();
    for name in forbid.as_array().into_iter().flatten().filter_map(Value::as_str) {
        if name.starts_with("Bash(") && name.ends_with(')') {
            rules.push(name.to_owned());
            continue;
        }
        for (_, forbidden) in FORBID.iter().filter(|(abstract_name, _)| *abstract_name == name) {
            match forbidden {
                Forbidden::Tools(tools) => rules.extend(tools.iter().map(|tool| (*tool).to_owned())),
                Forbidden::Commands(commands) => {
                    for command in commands.iter() {
                        rules.extend([format!("Bash({command})"), format!("Bash({command} *)")]);
                    }
                }
            }
        }
    }
    (!rules.is_empty()).then(|| rules.join(","))
}

/// 호스트가 넘긴 MCP 서버의 도구 시간 제한(ms) — claude가 받는 가장 긴 값(JS 타이머의 한도 2^31-1, 약 24.8일)이다.
///
/// **엔진은 Agent 부르기에 시간 제한을 두지 않는다**(v1 구현 스펙 §8 「시간」, v1 티켓 16). 부르기는 불린 Agent의 턴이 끝날 때까지,
/// 불린 Agent가 사람에게 물으면 그 답까지 기다린다 — 리뷰 한 번이 몇 분, 사람의 답은 하룻밤일 수도 있다. claude의 시간 제한에
/// 걸리면 부른 Agent는 결과 없이 실패를 받고 불린 Agent는 그대로 일한다. env `MCP_TOOL_TIMEOUT`이 아니라 서버마다의 `timeout`
/// 칸(2.1.309 MCP 설정의 stdio 꼴)으로 준다 — 사용자의 MCP 서버는 사용자 설정 그대로다(결정.md 16).
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

/// ACP `mcpServers` → `--allowedTools`의 값 — 넘겨받은 서버마다 `mcp__<이름>`(그 서버의 도구 전부). 넘길 서버가 없으면 `None`이다.
///
/// **호스트가 넘긴 서버의 도구는 claude가 묻지 않는다**(결정.md 15). 그 서버는 엔진의 Thread 도구(S12)이고, 도구마다 스스로 가린다 —
/// 부를 수 있는 Agent인지(§8), 사람에게 카드로 물을지(Work 만들기 · Project 고치기). claude가 또 물으면 Thread의 일마다 승인 카드가
/// 서고, 판정(§9)이 아닌 곳에서 허락이 갈린다. 사용자 MCP는 여기 들지 않는다 — 사용자 설정 그대로 묻는다.
pub(super) fn allowed(servers: &Value) -> Option<String> {
    let rules: Vec<String> = servers
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|server| server["name"].as_str())
        .map(|name| format!("mcp__{name}"))
        .collect();
    (!rules.is_empty()).then(|| rules.join(","))
}
