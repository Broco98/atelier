//! Thread 도구 줄의 차례(코드 리뷰 1차 A3) — Agent가 Thread 도구를 부르면 두 길로 닿는다. 도구 줄은 Runtime의 stdout(변환기 →
//! Runtime 손 → 기록)으로, 부르기는 중계 서버 → Session의 소켓으로 온다. 두 길은 서로 기다리지 않아, 부하가 걸리면 부르기가 먼저
//! 닿고 그 결과의 줄(Work 만들기 카드 · 이름 바꾸기)이 그 도구 줄과 그 앞 줄들보다 먼저 기록에 선다. 기록은
//! 사람이 읽는 차례이자 L3가 쏘는 축복 자료다 — **부르기는 그 도구 줄이 기록에 선 뒤에 받는다.**
//!
//! Runtime이 도구 줄을 내지 않으면(내지 않는 Runtime · 깨진 줄) 한도([`LIMIT`])까지만 기다리고 받는다 — 차례보다 일이 먼저다.

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::Value;

use super::seat::ends_turn;
use crate::runtime::{RuntimeEvent, Sink};
use crate::thread_tools::{app_tool, mcp_call, SERVER_NAME};

/// 도구 줄을 기다리는 한도 — 줄이 늦는 것은 부하 탓이라 보통은 곧바로 온다.
const LIMIT: Duration = Duration::from_secs(5);

/// Session 하나가 기록에 적은 Thread 도구 줄 가운데 아직 부르기와 짝짓지 않은 것들 — 도구 이름(`rename_thread` …)이 적은 차례로 선다.
#[derive(Default)]
pub(super) struct ToolLines {
    heard: Mutex<Vec<String>>,
    arrived: Condvar,
}

impl ToolLines {
    fn lock(&self) -> MutexGuard<'_, Vec<String>> {
        self.heard.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 받은 것을 `sink`에 넘겨 기록에 적은 **뒤에** Thread 도구 줄이면 센다. 턴이 끝나면 짝짓지 못한 줄을 잊는다 — 거절당한 도구의
    /// 줄이 다음 턴의 부르기와 짝지어지지 않게.
    pub(super) fn watching(self: &Arc<Self>, sink: Sink) -> Sink {
        let lines = Arc::clone(self);
        Arc::new(move |event| {
            let tool = match &event {
                RuntimeEvent::Update(raw) => thread_tool(raw),
                _ => None,
            };
            let ended = ends_turn(&event);
            sink(event);
            if let Some(tool) = tool {
                lines.lock().push(tool);
                lines.arrived.notify_all();
            }
            if ended {
                lines.lock().clear();
            }
        })
    }

    /// 그 도구의 줄이 기록에 설 때까지 기다린다 — 적힌 줄 하나와 짝짓는다. 한도가 지나면 기다리지 않고 돌아온다.
    pub(super) fn wait(&self, tool: &str) {
        self.wait_for(tool, LIMIT);
    }

    fn wait_for(&self, tool: &str, limit: Duration) {
        let heard = self.lock();
        let (mut heard, _) = self
            .arrived
            .wait_timeout_while(heard, limit, |heard| !heard.iter().any(|name| name == tool))
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(at) = heard.iter().position(|name| name == tool) {
            heard.remove(at);
        }
    }
}

/// Thread 도구의 도구 줄이면 그 도구 이름 — 표준 값을 먼저 읽는다(restart 01c-2, [`mcp_call`]): 제목이 `mcp.<서버>.<도구>`이고
/// `rawInput`의 `server` · `tool`이 그 둘이다(codex-acp 2.2.2). 없으면 Claude 변환기가 실은 도구 이름(`_meta.claudeCode.toolName`), 그것도
/// 없으면 제목을 `mcp__<서버>__<도구>`로 읽는다(Claude Code — 변환기는 MCP 도구의 제목을 도구 이름 그대로 짓는다).
///
/// Claude 판정(`policy::Act::of`)은 이 길을 쓰지 않는다 — 제목과 입력은 모델이 쓴 글일 수 있고, 여기서 틀려도 차례만 어긋난다. Codex
/// 판정(`policy::Act::of_codex`)은 표준 값만 같은 규칙으로 읽는다.
fn thread_tool(raw: &Value) -> Option<String> {
    let update = &raw["update"];
    if update["sessionUpdate"] != "tool_call" {
        return None;
    }
    if let Some((server, tool)) = mcp_call(update) {
        return (server == SERVER_NAME).then(|| tool.to_owned());
    }
    let name = update["_meta"]["claudeCode"]["toolName"].as_str().or_else(|| update["title"].as_str())?;
    app_tool(name).map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Instant;

    fn tool_call(name: &str) -> RuntimeEvent {
        RuntimeEvent::Update(json!({"sessionId": "s", "update": {
            "sessionUpdate": "tool_call", "toolCallId": "t", "title": name, "_meta": {"claudeCode": {"toolName": name}}}}))
    }

    #[test]
    fn 부르기는_그_도구_줄이_기록에_선_뒤에_받고_줄이_오지_않으면_한도까지만_기다린다() {
        let written: Arc<Mutex<Vec<String>>> = Arc::default();
        let log = Arc::clone(&written);
        let lines = Arc::new(ToolLines::default());
        let sink = lines.watching(Arc::new(move |event| {
            if let RuntimeEvent::Update(raw) = event {
                log.lock().unwrap().push(raw["update"]["title"].as_str().unwrap_or_default().to_owned());
            }
        }));

        let waiting = Arc::clone(&lines);
        let waited = std::thread::spawn(move || {
            waiting.wait_for("get_work", Duration::from_secs(10));
        });
        std::thread::sleep(Duration::from_millis(50));
        sink(tool_call("Read"));
        sink(tool_call("mcp__other__get_work"));
        assert!(!waited.is_finished(), "다른 도구 · 다른 서버의 줄로는 받지 않는다");
        sink(tool_call("mcp__atelier-thread__get_work"));
        waited.join().unwrap();
        assert_eq!(written.lock().unwrap().len(), 3, "기다림이 풀린 때에는 그 줄이 이미 적혔다");

        // 짝지은 줄은 다시 쓰지 않는다 — 다음 부르기는 제 줄을 기다린다.
        let started = Instant::now();
        lines.wait_for("get_work", Duration::from_millis(100));
        assert!(started.elapsed() >= Duration::from_millis(100));

        // 턴이 끝나면 짝짓지 못한 줄을 잊는다.
        sink(tool_call("mcp__atelier-thread__rename_thread"));
        sink(RuntimeEvent::Died(crate::life::Death { reason: "끝남".into(), stderr_tail: Vec::new() }));
        let started = Instant::now();
        lines.wait_for("rename_thread", Duration::from_millis(100));
        assert!(started.elapsed() >= Duration::from_millis(100));
    }

    /// codex-acp 2.2.2가 싣는 MCP 도구 줄 — `_meta.claudeCode`가 없고 ACP 칸만 있다(`spec/research/runtime-실측/codex-excerpts.jsonl`).
    fn standard_call(title: &str, server: &str, tool: &str) -> RuntimeEvent {
        RuntimeEvent::Update(json!({"sessionId": "s", "update": {
            "sessionUpdate": "tool_call", "toolCallId": "exec-1", "kind": "execute", "title": title, "status": "in_progress",
            "rawInput": {"server": server, "tool": tool, "arguments": {}}}}))
    }

    #[test]
    fn 표준_값만_있는_도구_줄로도_받는다() {
        let lines = Arc::new(ToolLines::default());
        let sink = lines.watching(Arc::new(|_| {}));
        let waiting = Arc::clone(&lines);
        let started = Instant::now();
        let waited = std::thread::spawn(move || waiting.wait_for("get_work", Duration::from_secs(10)));
        std::thread::sleep(Duration::from_millis(50));
        sink(standard_call("mcp.other.get_work", "other", "get_work"));
        sink(standard_call("mcp.atelier-thread.list_projects", "atelier-thread", "get_work"));
        assert!(!waited.is_finished(), "다른 서버의 줄 · 제목과 입력이 어긋난 줄로는 받지 않는다");
        sink(standard_call("mcp.atelier-thread.get_work", "atelier-thread", "get_work"));
        waited.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(5), "한도까지 기다리지 않는다");
    }
}
