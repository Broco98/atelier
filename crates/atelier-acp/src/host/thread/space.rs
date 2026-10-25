//! Space와 이어짐(03 구현 스펙 §7 · §9 · 티켓 05) — Work · Thread의 `space` 한 칸을 붙이고 · 바꾸고 · 빼고, 흐름에 Space 줄을 남긴다.
//!
//! - **Work에 이은 Thread의 Space는 그 Work의 것이다**(§9) — Thread에서 바꾸면(Space 칩) 그 Work의 Space가 바뀐다(스토리 42). Work의
//!   Space가 바뀌면 그 Work의 Thread마다 Space 줄이 선다(S9) — 그 Thread들의 범위가 모두 바뀐다.
//! - **Space 줄**(`space`)은 사람의 줄이다(`who`가 없다). 갈래(`change` — 바꿈 `changed` · 뺌 `removed`)와 바뀐 뒤의 범위(읽는 Project의
//!   이름 · 등록된 Project 수)를 싣는다 — 화면은 그때의 범위를 다시 셀 수 없다(기록은 덧붙이기만 한다).
//! - 떠 있는 Session은 건드리지 않는다 — 다음 말을 보낼 때 새 자리로 이어 연다([`ConversationHost::move_if_needed`] — 범위가 바뀌면 함께
//!   여는 폴더가 바뀐다). 돌고 있는 턴은 끊기지 않는다(스토리 41).

use atelier_core::{ReadingScope, RecordKind, ScopeOf, ThreadFile, Work};
use serde_json::{json, Value};

use super::ConversationHost;
use crate::HostError;

impl ConversationHost {
    /// Thread의 Space 붙이기 · 바꾸기 · 빼기(`None`) — `thread.json`의 `space`만 고치고 Space 줄을 남긴다. Work에 이은 Thread면 그 Work의
    /// Space를 바꾼다([`Self::set_work_space`]). 같은 Space면 아무것도 하지 않는다. 없는 Space는 아무것도 적지 않고 거절한다.
    pub fn set_thread_space(&self, thread: &str, space: Option<&str>) -> Result<(), HostError> {
        let file = self.read_thread_file(thread)?;
        if let Some(work) = &file.work {
            return self.set_work_space(work, space);
        }
        self.check_space(space)?;
        if file.space.as_deref() == space {
            return Ok(());
        }
        let before = file.space;
        let file = self.change_thread(thread, |file| file.space = space.map(str::to_owned))?;
        self.note_space(thread, &file, None, before.as_deref())
    }

    /// Work의 Space 붙이기 · 바꾸기 · 빼기 — `work.json`의 `space`만 고치고 그 Work의 Thread마다 Space 줄을 남긴다(S9). 같은 Space면
    /// 아무것도 하지 않는다. 없는 Work · 없는 Space는 아무것도 적지 않고 거절한다.
    pub fn set_work_space(&self, work: &str, space: Option<&str>) -> Result<(), HostError> {
        let before = self.open_work(work)?.meta.space;
        self.check_space(space)?;
        if before.as_deref() == space {
            return Ok(());
        }
        let changed = atelier_core::update_work_space(&atelier_core::works_in(&self.data_root), work, space)
            .map_err(|error| HostError::Record(format!("Work의 Space를 적지 못했습니다: {error}")))?;
        let threads: Vec<String> = self.with_index(|index| index.of_work(work).iter().map(|summary| summary.id.clone()).collect())?;
        for thread in threads {
            let file = self.read_thread_file(&thread)?;
            self.note_space(&thread, &file, Some(&changed), before.as_deref())?;
        }
        Ok(())
    }

    /// 그 Thread의 읽는 범위(§7) — Session의 자리 · 머리말이 이것 하나를 쓴다. 이은 Work는 부르는 쪽이 읽어 넘긴다.
    pub(super) fn scope_of(&self, file: &ThreadFile, work: Option<&Work>) -> ReadingScope {
        atelier_core::reading_scope(&self.data_root, &ScopeOf::thread(file, work))
    }

    fn check_space(&self, space: Option<&str>) -> Result<(), HostError> {
        match space {
            Some(slug) if atelier_core::get_space(&self.data_root, slug).is_err() => Err(HostError::SpaceNotFound(slug.to_owned())),
            _ => Ok(()),
        }
    }

    /// Space 줄 하나 — 바뀐 뒤의 그 Thread의 범위를 싣는다.
    fn note_space(&self, thread: &str, file: &ThreadFile, work: Option<&Work>, before: Option<&str>) -> Result<(), HostError> {
        let scope = self.scope_of(file, work);
        let line = space_line(&scope, before, work.map(|work| work.slug.as_str()));
        self.thread_log(thread)?.write(RecordKind::Space, None, line).map_err(HostError::Record).map(drop)
    }
}

/// Space 줄의 payload — 갈래 · Space(slug · 이름) · 바꾸기 전 · 이은 Work · 읽는 Project의 이름 · 등록된 Project 수.
fn space_line(scope: &ReadingScope, before: Option<&str>, work: Option<&str>) -> Value {
    json!({
        "change": if scope.space.is_some() { "changed" } else { "removed" },
        "space": scope.space.as_ref().map(|space| &space.slug),
        "name": scope.space.as_ref().map(|space| &space.name),
        "before": before,
        "work": work,
        "projects": scope.projects.iter().map(|project| &project.name).collect::<Vec<_>>(),
        "registered": scope.registered,
    })
}

/// 머리말의 「- Space:」 한 줄(§11) — Work 줄 뒤에 선다. 읽는 Project는 slug다(Thread 도구가 slug로 받는다).
pub(super) fn space_preamble(scope: &ReadingScope) -> String {
    match &scope.space {
        Some(space) => {
            let read: Vec<&str> = scope.projects.iter().map(|project| project.slug.as_str()).collect();
            let read = if read.is_empty() { "없음".to_owned() } else { read.join(", ") };
            let troubled = if space.troubled { " — 파일에 문제가 있어 읽을 수 있는 Project만 읽는다" } else { "" };
            format!("- Space: {}(`{}`) — 읽는 Project: {read}{troubled}\n", space.name, atelier_core::collapse_home(&space.file))
        }
        None if scope.registered == 0 => "- Space: 없음 — 등록된 Project가 없다\n".to_owned(),
        None => format!("- Space: 없음 — 등록된 Project {}개를 모두 읽는다\n", scope.registered),
    }
}
