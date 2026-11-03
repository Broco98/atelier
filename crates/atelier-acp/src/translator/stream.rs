//! claude의 stream-json 턴 → ACP(three-axes 티켓 14 · 워크플로 §8). 줄 하나를 받아 내보낼 `session/update`의 몸(`update`
//! 칸)들을 돌려준다 — 쓰는 것(stdout · 세션 id · 걸린 `session/prompt`)은 변환기 몸통의 몫이다.
//!
//! - `assistant`의 블록 — `text` → `agent_message_chunk`, `thinking` → `agent_thought_chunk`, `tool_use` → `tool_call`.
//!   claude는 도구 줄의 제목을 주지 않으므로 여기서 짓는다. 내장 명령의 `<synthetic>` 답(`local_command_source`)도 같은 길로
//!   메시지가 된다(실측 함정 33).
//! - `stream_event`의 글 조각(restart 01b, `--include-partial-messages`) — `text_delta` → `agent_message_chunk`, `thinking_delta` →
//!   `agent_thought_chunk`. 같은 글이 그 블록의 `assistant` 줄로 다시 오므로, 조각을 낸 메시지와 블록 종류를 기억해 그 완성 글을
//!   내지 않는다. 조각이 없던 블록(`<synthetic>` · 옛 녹음)은 완성 글을 그대로 낸다. 완성 줄은 그 블록의 조각이 다 지난 뒤 오고
//!   (2.1.316 실측), 멈춘 턴의 완성 줄은 그때까지 낸 글이다. 합이 어긋나면 변환기의 stderr로 경고 줄을 남긴다 — 호스트가 기록한다.
//! - 다시 받은 메시지(restart 01b-10) — 조각을 낸 메시지는 `message_delta`가 와야 끝난다. 끝나지 않은 메시지를 두고 claude가 다시 부르면
//!   (`system/api_retry`) · 다른 메시지가 오면(`api_retry` 없이 스트리밍하지 않고 다시 받은 완성 줄, 2.1.316 실측) 처음부터 다시 받은
//!   것이다 — 그 메시지를 버리라는 표지(`session_info_update`의 `_meta.atelier.discardMessage`)를 낸다. 호스트가 쌓은 글을 버린다. 턴이
//!   끝나면 놓는다 — 실패한 턴의 받은 글은 남는다.
//! - `user`의 `tool_result` → `tool_call_update`. `is_error`가 `true`일 때만 실패다 — 키가 없으면 성공이다.
//! - 대화 정리(restart 01b-4) — `system`의 `status: "compacting"` → Codex와 같은 모양의 `tool_call`(`Compact conversation`, `think`).
//!   `status: null`이나 `compact_boundary`가 그 줄의 `tool_call_update`다. 화면은 이 제목으로 줄을 가려 작업 로그에 넣지 않는다(`fold.ts`).
//! - 옮기지 않는 것: 모델이 `Skill`을 부를 때 · 압축이 요약문을 넣을 때 생기는 `isSynthetic` 글(사람의 말이 아니다, 실측 함정 34) ·
//!   `isReplay` 글(사람이 보낸 말의 메아리 — 호스트가 이미 `sent`로 적었다. 압축의 `local-command-stdout`도 이 꼴이다) · 훅 ·
//!   `thinking_tokens` · `rate_limit_event` · 글 조각이 아닌 `stream_event` · 글이 빈 조각 · 서브에이전트의 조각(`parent_tool_use_id`).
//!   API 오류를 감싼 `<synthetic>` 답(`is_api_error_message`)은 상태 기계가 답으로 옮기지 않는다 — 같은 글이 `result`에 있다.
//! - **서브에이전트**(`Agent`, 워크플로 함정 10) — 그 안에서 일어난 일(`parent_tool_use_id`가 붙은 줄)과 `task_*` 이벤트는
//!   대화의 흐름이 아니라 그 도구 줄의 `_meta`로 싣는다. 서브에이전트의 글이 대화의 답으로 섞이지 않고, 기록에는 평가의
//!   재료로 남는다(three-axes 결정 18). 화면은 이 원문에서 안쪽 도구를 모두 쥐어 그린다(`subagent.ts` — 표를 바꾸면 그쪽도 바꾼다).

use std::collections::HashMap;

use serde_json::{json, Value};

use super::DISCARD_MESSAGE_KEY;

/// 사용량 `used`로 더하는 네 칸 — `result.usage.iterations` 마지막 원소의 것(워크플로 함정 1).
const USED: [&str; 4] = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];

/// 글 조각의 ACP 종류 — 답과 생각.
const MESSAGE: &str = "agent_message_chunk";
const THOUGHT: &str = "agent_thought_chunk";

/// 대화 정리 줄의 제목 — Codex가 주는 이름이다(`spec/research/runtime-실측.md`). 화면이 이 제목으로 줄을 가린다(`fold.ts`).
const COMPACT_TITLE: &str = "Compact conversation";

/// 한 대화의 stream-json을 옮기는 상태 — 낸 도구 호출을 기억해 그 결과와 서브에이전트 자료를 같은 줄에 잇는다.
#[derive(Default)]
pub(super) struct Stream {
    /// 낸 도구 호출마다 그 `_meta.claudeCode`의 바탕 — `toolName`, 서브에이전트면 `subagent`.
    tools: HashMap<String, Value>,
    /// 대화의 답을 낸 마지막 모델 — 사용량의 `size`(그 모델의 컨텍스트 창)를 고른다.
    model: Option<String>,
    /// 조각으로 낸 글 — (메시지 id, 조각 종류) → 합친 글. 그 블록의 완성 글이 오면 꺼낸다.
    sent: HashMap<(String, &'static str), String>,
    /// 호스트의 기록으로 보낼 경고 줄 — 변환기의 stderr로 낸다. `stderr` 줄은 화면에 서므로 사람이 읽을 글로 쓴다.
    warnings: Vec<String>,
    /// 끝을 알리지 않은 대화 정리 줄의 id.
    compacting: Option<String>,
    /// 조각을 낸 채 끝나지 않은 메시지의 id — `message_delta`가 오지 않았다.
    open: Option<String>,
}

impl Stream {
    /// claude의 줄 하나 → `session/update`의 몸들. 옮기지 않는 줄이면 비어 있다. `result`는 [`Self::usage`] ·
    /// [`prompt_response`]가 맡는다.
    pub(super) fn updates(&mut self, line: &Value) -> Vec<Value> {
        if line["type"] == "stream_event" {
            return self.stream_event(line);
        }
        if let Some(parent) = line["parent_tool_use_id"].as_str() {
            return self.relay(parent, line).into_iter().collect();
        }
        match line["type"].as_str() {
            Some("assistant") => self.assistant(line),
            Some("user") => self.user(line),
            Some("system") if line["subtype"] == "api_retry" => self.discard().into_iter().collect(),
            Some("system") if line["subtype"].as_str().is_some_and(|subtype| subtype.starts_with("task_")) => {
                line["tool_use_id"].as_str().and_then(|tool| self.relay(tool, line)).into_iter().collect()
            }
            Some("system") if matches!(line["subtype"].as_str(), Some("status" | "compact_boundary")) => {
                self.compaction(line).into_iter().collect()
            }
            _ => Vec::new(),
        }
    }

    /// `system`의 `status` · `compact_boundary` → 대화 정리 줄. 2.1.316 실측의 차례는 `compacting` → `status: null{compact_result}` →
    /// `compact_boundary`이고 끝 신호는 먼저 온 쪽이 닫는다. 경계는 정리가 끝난 자리라 `compact_result` 없이 `completed`다.
    /// `status: null`은 모드 메아리(`permissionMode`)로도 오는데 그것은 정리의 끝이 아니다.
    fn compaction(&mut self, line: &Value) -> Option<Value> {
        if line["status"] == "compacting" {
            if self.compacting.is_some() {
                return None;
            }
            let id = format!("compact-{}", line["uuid"].as_str().unwrap_or_default());
            self.compacting = Some(id.clone());
            let call = json!({"sessionUpdate": "tool_call", "toolCallId": id, "title": COMPACT_TITLE, "kind": "think", "status": "in_progress"});
            return Some(call);
        }
        let boundary = line["subtype"] == "compact_boundary";
        if !boundary && !(line["status"].is_null() && line["permissionMode"].is_null()) {
            return None;
        }
        let id = self.compacting.take()?;
        let status = if boundary || line["compact_result"] == "success" { "completed" } else { "failed" };
        Some(json!({"sessionUpdate": "tool_call_update", "toolCallId": id, "status": status}))
    }

    /// 턴이 끝났다 — 끝 신호를 받지 못한 정리 줄을 놓는다. 화면은 턴이 끝나면 그 줄을 닫힌 것으로 본다(`fold.ts`).
    pub(super) fn turn_ended(&mut self) {
        self.compacting = None;
        self.open = None;
    }

    fn assistant(&mut self, line: &Value) -> Vec<Value> {
        let message = &line["message"];
        let mut updates = Vec::new();
        if let Some(model) = message["model"].as_str().filter(|model| *model != "<synthetic>") {
            self.model = Some(model.to_owned());
            updates.extend(self.replacing(&message["id"]));
        }
        let message_id = &message["id"];
        let blocks = message["content"].as_array().into_iter().flatten();
        updates.extend(blocks.filter_map(|block| match block["type"].as_str() {
            Some("text") => self.finished(MESSAGE, message_id, &block["text"]),
            Some("thinking") => self.finished(THOUGHT, message_id, &block["thinking"]),
            Some("tool_use") => Some(self.tool_call(block)),
            _ => None,
        }));
        updates
    }

    /// 대화의 `stream_event` — 글 조각이면 조각을 내고, 그 메시지를 끝나지 않은 메시지로 쥔다. `message_delta`가 그 메시지를 끝낸다.
    /// 서브에이전트의 것(`parent_tool_use_id`)은 버린다 — 대화의 글이 아니고, 완성 줄이 도구 줄의 `_meta`로 실린다.
    fn stream_event(&mut self, line: &Value) -> Vec<Value> {
        if !line["parent_tool_use_id"].is_null() {
            return Vec::new();
        }
        let message = &line["api_message_id"];
        if line["event"]["type"] == "message_delta" {
            if self.open.as_deref() == message.as_str() {
                self.open = None;
            }
            return Vec::new();
        }
        let Some(piece) = self.piece(line) else { return Vec::new() };
        let mut updates: Vec<Value> = self.replacing(message).into_iter().collect();
        self.open = message.as_str().map(str::to_owned);
        updates.push(piece);
        updates
    }

    /// 끝나지 않은 메시지를 두고 다른 메시지가 왔다 — 그 메시지를 버리라는 표지.
    fn replacing(&mut self, message: &Value) -> Option<Value> {
        if self.open.as_deref().is_none_or(|open| Some(open) == message.as_str()) {
            return None;
        }
        self.discard()
    }

    /// 끝나지 않은 메시지를 버리라는 표지 — claude가 처음부터 다시 받는다. 그 메시지의 조각으로 낸 글도 잊는다.
    fn discard(&mut self) -> Option<Value> {
        let message = self.open.take()?;
        self.sent.retain(|(id, _), _| *id != message);
        Some(json!({"sessionUpdate": "session_info_update", "_meta": {"atelier": {DISCARD_MESSAGE_KEY: message}}}))
    }

    /// `stream_event`의 글 조각 → ACP 조각. 메시지 id는 조각마다 실려 온다(`api_message_id`). 글이 빈 조각은 내지 않는다.
    fn piece(&mut self, line: &Value) -> Option<Value> {
        let delta = &line["event"]["delta"];
        let (kind, text) = match delta["type"].as_str()? {
            "text_delta" => (MESSAGE, &delta["text"]),
            "thinking_delta" => (THOUGHT, &delta["thinking"]),
            _ => return None,
        };
        let piece = text.as_str().filter(|text| !text.is_empty())?;
        let message_id = &line["api_message_id"];
        self.sent.entry((message_id.as_str()?.to_owned(), kind)).or_default().push_str(piece);
        Some(chunk(kind, message_id, text))
    }

    /// 완성 블록 — 조각으로 낸 블록이면 다시 내지 않는다. 합이 완성 글과 다르면 경고 줄을 남긴다. 조각이 없던 블록은 완성 글을
    /// 그대로 낸다.
    fn finished(&mut self, kind: &'static str, message_id: &Value, text: &Value) -> Option<Value> {
        let id = message_id.as_str().unwrap_or_default();
        let Some(sent) = self.sent.remove(&(id.to_owned(), kind)) else {
            return Some(chunk(kind, message_id, text));
        };
        let finished = text.as_str().unwrap_or_default();
        if sent != finished {
            let what = if kind == MESSAGE { "답" } else { "생각" };
            let (sent, finished) = (sent.chars().count(), finished.chars().count());
            self.warnings.push(format!("받은 {what} 조각을 합친 글({sent}자)이 완성 글({finished}자)과 다릅니다 — 메시지 {id}"));
        }
        None
    }

    /// 지금까지 쌓인 경고 줄을 꺼낸다.
    pub(super) fn take_warnings(&mut self) -> Vec<String> {
        std::mem::take(&mut self.warnings)
    }

    fn user(&mut self, line: &Value) -> Vec<Value> {
        if line["isSynthetic"] == true || line["isReplay"] == true {
            return Vec::new();
        }
        let blocks = line["message"]["content"].as_array().into_iter().flatten();
        blocks.filter(|block| block["type"] == "tool_result").map(|block| self.tool_result(block)).collect()
    }

    /// `tool_use` → `tool_call`. 편집 도구는 입력의 조각으로 diff 내용을 싣는다(S2) — 파일은 읽지 않는다.
    fn tool_call(&mut self, block: &Value) -> Value {
        let id = block["id"].as_str().unwrap_or_default();
        let name = block["name"].as_str().unwrap_or_default();
        let input = &block["input"];
        let mut meta = json!({"toolName": name});
        if is_subagent(name) {
            meta["subagent"] = json!({"subagentType": input["subagent_type"], "description": input["description"]});
        }
        self.tools.insert(id.to_owned(), meta.clone());

        let mut call = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": id,
            "title": title(name, input),
            "kind": kind(name),
            "status": "in_progress",
            "rawInput": input,
        });
        if let Some(diff) = diff(name, input) {
            call["content"] = diff;
        }
        if let Some(path) = file_of(name, input) {
            call["locations"] = json!([{"path": path}]);
        }
        call["_meta"] = json!({"claudeCode": meta});
        call
    }

    /// `tool_result` → `tool_call_update`. 출력은 글 내용으로 싣되, 성공한 편집 도구는 싣지 않는다 — 화면이 앞의 `tool_call`에
    /// 이 update를 덮어 합치므로, 실으면 diff가 「파일을 고쳤습니다」 글로 바뀐다.
    fn tool_result(&self, block: &Value) -> Value {
        let id = block["tool_use_id"].as_str().unwrap_or_default();
        let failed = block["is_error"] == true;
        let mut update = json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": id,
            "status": if failed { "failed" } else { "completed" },
        });
        let edited = self.tools.get(id).and_then(|meta| meta["toolName"].as_str()).is_some_and(is_edit) && !failed;
        let output = output(&block["content"]);
        if !edited && !output.is_empty() {
            update["content"] = Value::Array(output);
        }
        update
    }

    /// 도구 호출 하나에 딸린 줄(서브에이전트 안의 줄 · `task_*`)을 그 도구 줄의 `_meta`로 싣는다. 모르는 도구면 버린다.
    /// `_meta`에는 그 도구의 바탕(`toolName` · `subagent`)을 함께 싣는다 — 화면은 update를 덮어 합치므로 바탕이 지워지지 않게.
    fn relay(&self, tool: &str, line: &Value) -> Option<Value> {
        let mut meta = self.tools.get(tool)?.clone();
        meta["event"] = line.clone();
        Some(json!({"sessionUpdate": "tool_call_update", "toolCallId": tool, "_meta": {"claudeCode": meta}}))
    }

    /// `result` → 사용량(`usage_update`). `used`는 `usage.iterations` **마지막 원소**의 네 칸 합이다 — `usage` 자체는 턴 안
    /// 모든 API 호출의 합이라 도구를 쓴 턴에서 몇 배로 부푼다(워크플로 함정 1). `size`는 답한 모델의 `contextWindow`다.
    /// 모델을 부르지 않은 턴(내장 명령)은 `iterations`가 비어 있어 내지 않는다. 화면은 답 아래 줄에 그린다.
    pub(super) fn usage(&self, result: &Value) -> Option<Value> {
        let last = result["usage"]["iterations"].as_array()?.last()?;
        let used: u64 = USED.iter().filter_map(|field| last[*field].as_u64()).sum();
        let models = result["modelUsage"].as_object()?;
        let size = self
            .model
            .as_deref()
            .and_then(|model| models.get(model))
            .and_then(|usage| usage["contextWindow"].as_u64())
            .or_else(|| models.values().filter_map(|usage| usage["contextWindow"].as_u64()).max())?;
        Some(json!({"sessionUpdate": "usage_update", "used": used, "size": size}))
    }
}

/// `result` → `session/prompt`의 답. 끝 까닭을 ACP 이름으로 옮기고, `result` 원문(비용 · 사용량 · 서브에이전트 통계 · 끝난
/// 까닭)을 `_meta`에 싣는다 — 호스트가 턴 끝 줄에 남기는 평가의 재료다(three-axes 결정 18). `interrupted`는 그 턴에
/// 변환기가 interrupt를 보냈나다. 실패한 턴([`failure`])은 답이 아니라 오류로 끝난다.
pub(super) fn prompt_response(result: &Value, interrupted: bool) -> Value {
    json!({"stopReason": stop_reason(result, interrupted), "_meta": {"claudeCode": {"result": result}}})
}

/// 턴이 실패했으면 그 까닭 — `is_error`가 참이고 우리가 끊지 않았고 끝 까닭으로 말할 수 없는 턴이다(restart 01b-5). `subtype: "success"`로
/// 오는 API 오류도 같다. 거절 · 길이 제한 · 턴 한도도 `is_error`로 끝나지만(2.1.316 실측) 그 `stopReason`으로 둔다. interrupt를 보낸 턴은
/// 어떻게 끝났든 사람이 멈춘 턴이다.
pub(super) fn failure(result: &Value, interrupted: bool) -> Option<String> {
    (result["is_error"] == true && !interrupted && stop_reason(result, interrupted) == "end_turn").then(|| why(result))
}

/// claude가 말한 까닭 — API 오류는 `result`의 글이고 실행 오류는 `errors`다. 둘 다 없으면 `subtype`이다.
pub(super) fn why(result: &Value) -> String {
    if let Some(said) = result["result"].as_str().filter(|said| !said.trim().is_empty()) {
        return said.to_owned();
    }
    let errors: Vec<&str> = result["errors"].as_array().into_iter().flatten().filter_map(Value::as_str).collect();
    if errors.is_empty() {
        result["subtype"].as_str().unwrap_or("result").to_owned()
    } else {
        errors.join(" · ")
    }
}

/// claude의 끝 → ACP `stopReason`. 모르는 값은 `end_turn`이다(워크플로 §8). 우리가 interrupt를 보낸 턴의 `error_during_execution`
/// (`terminal_reason: aborted_tools | aborted_streaming`)만 `cancelled`다 — interrupt가 닿기 전에 턴이 끝났으면 그 끝 그대로다(워크플로 관문
/// G2). 스스로 다시 묻다 끝낸 길이 제한은 `stop_reason`이 `stop_sequence`이고 끝 까닭이 `api_error` 칸에 있다(2.1.316 실측).
fn stop_reason(result: &Value, interrupted: bool) -> &'static str {
    match (result["subtype"].as_str(), result["stop_reason"].as_str()) {
        (Some("error_during_execution"), _) if interrupted => "cancelled",
        (Some("error_max_turns"), _) => "max_turn_requests",
        (Some("success"), Some("max_tokens")) => "max_tokens",
        (Some("success"), Some("refusal")) => "refusal",
        (Some("success"), _) if result["api_error"] == "max_output_tokens" => "max_tokens",
        _ => "end_turn",
    }
}

fn chunk(kind: &str, message_id: &Value, text: &Value) -> Value {
    json!({"sessionUpdate": kind, "messageId": message_id, "content": {"type": "text", "text": text}})
}

/// 서브에이전트 도구 — 호출 이름은 `Agent`다(`init.tools`에는 `Task`로 적힌다, 워크플로 함정 10).
fn is_subagent(name: &str) -> bool {
    matches!(name, "Agent" | "Task")
}

/// 편집 도구 — 입력의 옛 글 · 새 글 조각으로 diff 내용을 짓는다(S2).
fn is_edit(name: &str) -> bool {
    matches!(name, "Edit" | "MultiEdit" | "Write")
}

/// ACP 도구 갈래 — 화면이 진행형 · 완료형 문구와 안의 것(출력 · diff)을 고른다.
pub(super) fn kind(name: &str) -> &'static str {
    match name {
        "Bash" => "execute",
        "Read" => "read",
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => "edit",
        "Glob" | "Grep" => "search",
        "WebFetch" | "WebSearch" => "fetch",
        "Agent" | "Task" => "think",
        "EnterPlanMode" | "ExitPlanMode" => "switch_mode",
        _ => "other",
    }
}

/// 도구 줄의 제목 — claude는 주지 않는다. 명령은 명령 글 그대로(codex-acp와 같은 꼴), 파일 도구는 무엇을 · 어느 파일에,
/// 서브에이전트는 맡긴 일의 설명이다. 모르는 도구(MCP 도구 포함)와 입력이 모자란 것은 도구 이름 그대로다.
pub(super) fn title(name: &str, input: &Value) -> String {
    let field = |key: &str| input[key].as_str().filter(|value| !value.is_empty());
    let titled = match name {
        "Bash" => field("command").map(str::to_owned),
        "Read" | "Write" => field("file_path").map(|path| format!("{name} {path}")),
        "Edit" | "MultiEdit" => field("file_path").map(|path| format!("Edit {path}")),
        "NotebookEdit" => field("notebook_path").map(|path| format!("Edit {path}")),
        "Glob" => field("pattern").map(|pattern| format!("Find {pattern}")),
        "Grep" => field("pattern").map(|pattern| format!("Search {pattern}")),
        "WebFetch" => field("url").map(|url| format!("Fetch {url}")),
        "WebSearch" => field("query").map(|query| format!("Search the web: {query}")),
        "Agent" | "Task" => field("description").map(str::to_owned),
        "Skill" => field("skill").map(|skill| format!("Skill {skill}")),
        _ => None,
    };
    titled.unwrap_or_else(|| name.to_owned())
}

/// 도구가 다루는 파일 — 도구 줄의 파일 링크(스토리 77)가 연다.
fn file_of<'a>(name: &str, input: &'a Value) -> Option<&'a str> {
    match name {
        "Read" | "Write" | "Edit" | "MultiEdit" => input["file_path"].as_str(),
        "NotebookEdit" => input["notebook_path"].as_str(),
        _ => None,
    }
}

/// 편집 도구의 diff 내용 — 입력에 든 조각 그대로다(S2). 파일 전체의 diff를 짓지 않고(three-axes 결정 22) 파일을 읽지도
/// 않는다. 고친 곳은 호스트가 spec 폴더를 견주어 따로 찾는다.
/// - `Edit` — 옛 글(`old_string`) → 새 글(`new_string`) 하나.
/// - `MultiEdit` — 고침마다 하나.
/// - `Write` — 옛 글 없이(`null`) 새 글(`content`) 하나. 있던 파일을 덮어써도 옛 글은 모른다 — 읽지 않기 때문이다.
fn diff(name: &str, input: &Value) -> Option<Value> {
    let path = input["file_path"].as_str()?;
    let piece = |old: &Value, new: &Value| json!({"type": "diff", "path": path, "oldText": old, "newText": new});
    let pieces: Vec<Value> = match name {
        "Edit" => vec![piece(&input["old_string"], &input["new_string"])],
        "MultiEdit" => input["edits"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|edit| piece(&edit["old_string"], &edit["new_string"]))
            .collect(),
        "Write" => vec![piece(&Value::Null, &input["content"])],
        _ => return None,
    };
    Some(Value::Array(pieces))
}

/// `tool_result`의 내용(글자 하나이거나 블록 배열) → ACP 글 내용들. 글이 아닌 블록(그림 등)은 싣지 않는다.
fn output(content: &Value) -> Vec<Value> {
    let text = |text: &Value| json!({"type": "content", "content": {"type": "text", "text": text}});
    match content {
        Value::String(_) => vec![text(content)],
        Value::Array(blocks) => blocks.iter().filter(|block| block["type"] == "text").map(|block| text(&block["text"])).collect(),
        _ => Vec::new(),
    }
}
