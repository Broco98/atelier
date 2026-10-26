//! 문서 쓰는 중 — Work의 spec 폴더 안 파일에 편집 도구가 도는 동안 「누가 어느 문서를 쓰는 중」을 Work 단위로 낸다(v1 티켓 34 ·
//! 구현 스펙 §12 「문서」 · §18 `work:writing`). Work 카드의 문서 줄이 이것으로 파란 점과 그 Agent 이름을 세운다(스토리 108).
//!
//! - **편집 도구의 갱신으로 안다.** ACP 도구 종류(`kind`)가 `edit`인 도구가 끝나지 않은 채 서면 쓰기 시작이고, 그 도구가 끝나거나
//!   (`completed` · `failed`) 그 Session의 턴이 끝나면(턴 끝 · 스스로 이어 간 턴의 끝 · 죽음 · 꺼냄) 끝이다. 승인을 기다리는 동안도
//!   쓰는 중이다 — 곧 쓸 문서다. 권한 길을 거치지 않는 편집(사용자의 Claude Code 설정이 허용한 것)도 갱신은 오므로 함께 센다.
//! - **Work마다 지금 목록 전체를 낸다.** 화면은 마지막 것 하나를 쥐면 된다 — 사이 것을 놓쳐도 다음 것이 바로잡는다. 바뀌지 않았으면
//!   내지 않는다.
//! - 지우기 · 옮기기(`delete` · `move`)는 쓰는 것이 아니라 세지 않는다. spec 폴더 밖의 편집(worktree · Thread 폴더)도 세지 않는다 —
//!   그것은 변경 칸이 git으로 본다(v1 티켓 33).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use serde_json::Value;

use super::SessionKey;
use crate::policy::Act;

/// 문서 하나를 쓰는 중 — `work:writing`의 한 칸.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocWriting {
    /// spec 폴더 기준 경로 — Work의 spec 파일 목록(`specFiles`)과 같은 꼴(`/`로 잇는다).
    pub path: String,
    /// 쓰는 Agent의 handle.
    pub who: String,
    /// 쓰는 Agent의 이름 — 정의 스냅숏의 `name`(Host는 「Host」). 화면이 「Host가 쓰는 중」을 그 Thread 밖에서도 그린다.
    pub name: String,
    /// 그 Agent가 앉은 Thread.
    pub thread: String,
}

/// 편집 도구의 갱신 하나가 무엇인가.
#[derive(Debug, PartialEq)]
pub(super) enum ToolStep {
    /// 끝나지 않은 편집 도구가 섰다 — 도구 id와 고칠 경로들(상대 경로는 그대로다).
    Began { tool: String, paths: Vec<PathBuf> },
    /// 그 도구가 끝났다(`completed` · `failed`).
    Ended { tool: String },
    /// 그 밖의 것.
    Other,
}

impl ToolStep {
    /// Runtime이 넘긴 `session/update` 몸에서 읽는다.
    pub(super) fn of(raw: &Value) -> Self {
        let update = &raw["update"];
        let (Some("tool_call" | "tool_call_update"), Some(tool)) =
            (update["sessionUpdate"].as_str(), update["toolCallId"].as_str())
        else {
            return ToolStep::Other;
        };
        if matches!(update["status"].as_str(), Some("completed" | "failed")) {
            return ToolStep::Ended { tool: tool.to_owned() };
        }
        if update["kind"] != "edit" {
            return ToolStep::Other;
        }
        match Act::of(update) {
            Act::Edit(paths) if !paths.is_empty() => ToolStep::Began { tool: tool.to_owned(), paths },
            _ => ToolStep::Other,
        }
    }
}

/// 지금 쓰는 중인 문서들 — Work slug → 쓰는 펜들. 호스트에 하나다. 잠금은 짧게만 쥔다.
#[derive(Default)]
pub(super) struct DocDesk(Mutex<HashMap<String, Vec<Pen>>>);

/// 문서 하나에 선 편집 도구 하나.
#[derive(Debug, Clone)]
struct Pen {
    key: SessionKey,
    tool: String,
    name: String,
    path: String,
}

/// Work 하나의 지금 목록 — 바뀐 Work마다 하나씩 낸다.
pub(super) type Changed = Vec<(String, Vec<DocWriting>)>;

impl DocDesk {
    fn lock(&self) -> MutexGuard<'_, HashMap<String, Vec<Pen>>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 그 Session의 편집 도구가 그 Work의 문서(`path` — spec 기준)를 쓰기 시작했다. 목록이 바뀌었으면 그 Work의 지금 목록이다.
    pub(super) fn began(&self, work: &str, key: &SessionKey, name: &str, tool: &str, path: &str) -> Option<Vec<DocWriting>> {
        let mut desk = self.lock();
        let pens = desk.entry(work.to_owned()).or_default();
        if pens.iter().any(|pen| &pen.key == key && pen.tool == tool && pen.path == path) {
            return None;
        }
        pens.push(Pen { key: key.clone(), tool: tool.to_owned(), name: name.to_owned(), path: path.to_owned() });
        Some(listed(pens))
    }

    /// 그 Session의 그 도구가 끝났다.
    pub(super) fn ended(&self, key: &SessionKey, tool: &str) -> Changed {
        self.drop_where(|pen| &pen.key == key && pen.tool == tool)
    }

    /// 그 Session의 펜을 모두 걷는다 — 턴이 끝났거나 Session이 꺼졌다.
    pub(super) fn cleared(&self, key: &SessionKey) -> Changed {
        self.drop_where(|pen| &pen.key == key)
    }

    fn drop_where(&self, gone: impl Fn(&Pen) -> bool) -> Changed {
        let mut desk = self.lock();
        let mut changed = Vec::new();
        for (work, pens) in desk.iter_mut() {
            let before = pens.len();
            pens.retain(|pen| !gone(pen));
            if pens.len() != before {
                changed.push((work.clone(), listed(pens)));
            }
        }
        desk.retain(|_, pens| !pens.is_empty());
        changed.sort_by(|a, b| a.0.cmp(&b.0));
        changed
    }
}

/// 펜들 → 화면의 목록. 같은 Session이 같은 문서에 도구 둘을 세워도 한 줄이다. 선 차례 그대로다.
fn listed(pens: &[Pen]) -> Vec<DocWriting> {
    let mut list: Vec<DocWriting> = Vec::new();
    for pen in pens {
        if !list.iter().any(|one| one.path == pen.path && one.who == pen.key.handle && one.thread == pen.key.thread) {
            list.push(DocWriting {
                path: pen.path.clone(),
                who: pen.key.handle.clone(),
                name: pen.name.clone(),
                thread: pen.key.thread.clone(),
            });
        }
    }
    list
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn key(thread: &str, handle: &str) -> SessionKey {
        SessionKey::new(thread, handle)
    }

    fn writing(path: &str, who: &str, name: &str, thread: &str) -> DocWriting {
        DocWriting { path: path.into(), who: who.into(), name: name.into(), thread: thread.into() }
    }

    #[test]
    fn 끝나지_않은_편집_도구는_쓰기_시작이고_끝난_도구는_끝이며_지우기와_읽기는_아무것도_아니다() {
        let began = json!({"sessionId": "s", "update": {
            "sessionUpdate": "tool_call", "toolCallId": "t1", "kind": "edit", "status": "pending",
            "rawInput": {"file_path": "/w/spec/design.md"}, "locations": [{"path": "/w/spec/design.md"}]
        }});
        assert_eq!(ToolStep::of(&began), ToolStep::Began { tool: "t1".into(), paths: vec!["/w/spec/design.md".into()] });

        let later = json!({"update": {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "kind": "edit", "status": "in_progress",
            "locations": [{"path": "spec/a.md"}]}});
        assert_eq!(ToolStep::of(&later), ToolStep::Began { tool: "t1".into(), paths: vec!["spec/a.md".into()] }, "상대 경로는 그대로");

        let done = json!({"update": {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed"}});
        assert_eq!(ToolStep::of(&done), ToolStep::Ended { tool: "t1".into() });
        let failed = json!({"update": {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "failed"}});
        assert_eq!(ToolStep::of(&failed), ToolStep::Ended { tool: "t1".into() }, "거절된 편집도 끝이다");

        let delete = json!({"update": {"sessionUpdate": "tool_call", "toolCallId": "t2", "kind": "delete", "status": "pending",
            "locations": [{"path": "/w/spec/old.md"}]}});
        assert_eq!(ToolStep::of(&delete), ToolStep::Other, "지우기는 쓰기가 아니다");
        let read = json!({"update": {"sessionUpdate": "tool_call", "toolCallId": "t3", "kind": "read", "status": "pending",
            "locations": [{"path": "/w/spec/a.md"}]}});
        assert_eq!(ToolStep::of(&read), ToolStep::Other);
        let bare = json!({"update": {"sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "in_progress"}});
        assert_eq!(ToolStep::of(&bare), ToolStep::Other, "경로 없는 갱신은 아무것도 아니다");
        let text = json!({"update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "x"}}});
        assert_eq!(ToolStep::of(&text), ToolStep::Other);
    }

    #[test]
    fn work마다_지금_쓰는_문서_목록을_내고_같은_것은_다시_내지_않으며_도구가_끝나거나_턴이_끝나면_빠진다() {
        let desk = DocDesk::default();
        let host = key("a", "host");
        let reviewer = key("b", "reviewer");

        assert_eq!(desk.began("cart", &host, "Host", "t1", "design.md"), Some(vec![writing("design.md", "host", "Host", "a")]));
        assert_eq!(desk.began("cart", &host, "Host", "t1", "design.md"), None, "같은 도구의 갱신은 다시 내지 않는다");
        assert_eq!(
            desk.began("cart", &reviewer, "리뷰어", "r1", "review-notes.md"),
            Some(vec![writing("design.md", "host", "Host", "a"), writing("review-notes.md", "reviewer", "리뷰어", "b")]),
            "다른 Thread의 Agent도 같은 Work의 목록에 든다"
        );
        assert_eq!(
            desk.began("billing", &key("c", "host"), "Host", "t9", "overview.md"),
            Some(vec![writing("overview.md", "host", "Host", "c")]),
            "Work마다 따로다"
        );

        assert_eq!(desk.ended(&host, "t0"), Vec::new(), "모르는 도구가 끝나도 아무것도 내지 않는다");
        assert_eq!(desk.ended(&host, "t1"), vec![("cart".to_owned(), vec![writing("review-notes.md", "reviewer", "리뷰어", "b")])]);

        desk.began("cart", &host, "Host", "t2", "design.md");
        desk.began("cart", &host, "Host", "t3", "overview.md");
        assert_eq!(
            desk.cleared(&host),
            vec![("cart".to_owned(), vec![writing("review-notes.md", "reviewer", "리뷰어", "b")])],
            "턴이 끝나면 그 Session의 것이 모두 빠진다"
        );
        assert_eq!(desk.cleared(&reviewer), vec![("cart".to_owned(), Vec::new())], "마지막이 빠지면 빈 목록을 낸다");
        assert_eq!(desk.cleared(&reviewer), Vec::new(), "빈 Work는 다시 내지 않는다");
    }

    #[test]
    fn 같은_session이_같은_문서에_도구_둘을_세워도_한_줄이고_하나가_끝나도_남는다() {
        let desk = DocDesk::default();
        let host = key("a", "host");
        desk.began("cart", &host, "Host", "t1", "design.md");
        assert_eq!(desk.began("cart", &host, "Host", "t2", "design.md"), Some(vec![writing("design.md", "host", "Host", "a")]));
        assert_eq!(desk.ended(&host, "t1"), vec![("cart".to_owned(), vec![writing("design.md", "host", "Host", "a")])]);
    }
}
