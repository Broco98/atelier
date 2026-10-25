//! Space와 이어짐(03 구현 스펙 §7 · §9 · 티켓 05) — Work · Thread의 `space` 한 칸을 붙이고 · 바꾸고 · 빼고, 흐름에 Space 줄을 남긴다.
//!
//! - **Work에 이은 Thread의 Space는 그 Work의 것이다**(§9) — Thread에서 바꾸면(Space 칩) 그 Work의 Space가 바뀐다(스토리 42). Work의
//!   Space가 바뀌면 그 Work의 Thread마다 Space 줄이 선다(S9) — 그 Thread들의 범위가 모두 바뀐다.
//! - **Space 줄**(`space`)은 사람의 줄이다(`who`가 없다). 갈래(`change` — 바꿈 `changed` · 뺌 `removed`)와 바뀐 뒤의 범위(읽는 Project의
//!   이름 · 등록된 Project 수)를 싣는다 — 화면은 그때의 범위를 다시 셀 수 없다(기록은 덧붙이기만 한다).
//! - 떠 있는 Session은 건드리지 않는다 — 다음 말을 보낼 때 새 자리로 이어 연다([`ConversationHost::move_if_needed`] — 범위가 바뀌면 함께
//!   여는 폴더가 바뀐다). 돌고 있는 턴은 끊기지 않는다(스토리 41).
//! - **Space를 지우면**(티켓 07 · §9) 그 Space에 이은 칸이 비고 그 Space로 읽던 Thread마다 「지워짐」 줄이, 되돌리면 다시 적은 곳마다
//!   「되돌림」 줄이 선다. 앱 밖에서 파일이 사라졌으면 그 Thread의 다음 말을 보낼 때 같은 줄로 닫는다([`ConversationHost::close_lost_space`]).

use atelier_core::{DeletedSpace, ReadingScope, RecordKind, RestoredSpace, ScopeOf, SpaceLinks, ThreadFile, Work};
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
        self.note_space(thread, &file, None, before.as_deref(), Change::Picked)
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
            self.note_space(&thread, &file, Some(&changed), before.as_deref(), Change::Picked)?;
        }
        Ok(())
    }

    /// **Space 지우기**(§9 · §14) — 화면의 확인 창 「삭제」만 부른다(Host 도구에는 없다 — §17). core가 파일을 지운 자리로 옮기고 그 Space에
    /// 이은 칸을 비우면, 그 Space로 읽던 Thread마다 「지워짐」 줄을 남긴다(Work면 그 Work의 Thread마다). Project · 대화 · 문서 ·
    /// worktree는 그대로이고, 떠 있는 Session은 다음 말에서 「Space 없음」의 범위로 이어 연다. 없는 Space는 `SpaceNotFound`다.
    pub fn delete_space(&self, slug: &str) -> Result<DeletedSpace, HostError> {
        let deleted = {
            // core가 `thread.json`의 칸을 비우는 동안 엔진의 다른 쓰기(참여자 줄 · 이름 …)와 겹치지 않게 쥔다.
            let _files = self.threads.lock_files();
            atelier_core::delete_space(&self.data_root, slug).map_err(space_error)?
        };
        let name = if deleted.space.name.trim().is_empty() { slug } else { deleted.space.name.as_str() };
        self.note_links(&deleted.unlinked, Some(slug), Change::Deleted { slug, name });
        Ok(deleted)
    }

    /// **Space 되돌리기**(§9 · S10) — 지운 뒤 토스트의 「되돌리기」만 부른다. 파일을 제자리로 돌리고 비웠던 칸 가운데 아직 빈 것에만
    /// 다시 적은 뒤, 그 Space로 다시 읽는 Thread마다 「되돌림」 줄을 남긴다. 그사이 같은 slug가 다시 쓰였으면 아무것도 하지 않고
    /// 거절한다(core의 글 「slug is in use again: …」). 지운 것이 없으면 `SpaceNotFound`다.
    pub fn restore_space(&self, slug: &str) -> Result<RestoredSpace, HostError> {
        let restored = {
            let _files = self.threads.lock_files();
            atelier_core::restore_space(&self.data_root, slug).map_err(space_error)?
        };
        self.note_links(&restored.relinked, None, Change::Restored);
        Ok(restored)
    }

    /// **손으로 지운 Space 파일**(§9) — 이 Thread가 잇는 Space(Work에 이었으면 그 Work의 것)의 파일이 없으면 그 칸을 비우고 「지워짐」
    /// 줄을 남긴다(Work면 그 Work의 Thread마다). 지우기 도중 앱이 꺼져 반쯤 비운 채 남은 연결도 이 길로 닫힌다. 말을 보내기 전에
    /// 부른다 — 줄이 그 말 앞에 서고, 그 말부터 넓어진 범위를 읽는다(범위는 파일이 없으면 이미 「Space 없음」이다 — §7 규칙 1).
    ///
    /// 칸을 다시 읽고 비운다 — 그사이 지우기가 이미 비웠으면 줄을 두 번 남기지 않는다. 읽지 못하는 Thread · Work는 그대로 둔다(보내기가
    /// 그 까닭으로 거절한다).
    pub(super) fn close_lost_space(&self, thread: &str) -> Result<(), HostError> {
        let Ok(file) = self.read_thread_file(thread) else { return Ok(()) };
        match &file.work {
            None => {
                let Some(slug) = file.space.filter(|slug| space_gone(&self.data_root, slug)) else { return Ok(()) };
                let mut closed = false;
                let file = self.change_thread(thread, |file| {
                    if file.space.as_deref() == Some(slug.as_str()) {
                        file.space = None;
                        closed = true;
                    }
                })?;
                if closed {
                    self.note_space(thread, &file, None, Some(&slug), Change::Deleted { slug: &slug, name: &slug })?;
                }
            }
            Some(work) => {
                let Ok(at) = self.open_work(work) else { return Ok(()) };
                let Some(slug) = at.meta.space.filter(|slug| space_gone(&self.data_root, slug)) else { return Ok(()) };
                let works = atelier_core::works_in(&self.data_root);
                let closed = {
                    let _files = self.threads.lock_files();
                    let still = atelier_core::read_work(&works, work).is_ok_and(|meta| meta.space.as_deref() == Some(slug.as_str()));
                    if still {
                        atelier_core::update_work_space(&works, work, None)
                            .map_err(|error| HostError::Record(format!("Work의 Space를 비우지 못했습니다: {error}")))?;
                    }
                    still
                };
                if closed {
                    let links = SpaceLinks { works: vec![work.clone()], threads: Vec::new() };
                    self.note_links(&links, Some(&slug), Change::Deleted { slug: &slug, name: &slug });
                }
            }
        }
        Ok(())
    }

    /// 지우기 · 되돌리기가 고친 곳마다 Space 줄 — Work면 그 Work의 Thread마다(S9), Work 없는 Thread면 그 Thread에. 파일은 이미 고쳤으니
    /// 줄 하나를 못 남겨도 일을 되돌리지 않는다 — 까닭만 stderr에 남긴다.
    fn note_links(&self, links: &SpaceLinks, before: Option<&str>, change: Change) {
        let mut noted = Vec::new();
        for work in &links.works {
            let Ok(at) = self.open_work(work) else { continue };
            let threads = self.with_index(|index| index.of_work(work).iter().map(|summary| summary.id.clone()).collect::<Vec<_>>());
            for thread in threads.unwrap_or_default() {
                noted.push(self.read_thread_file(&thread).and_then(|file| self.note_space(&thread, &file, Some(&at.meta), before, change)));
            }
        }
        for thread in &links.threads {
            noted.push(self.read_thread_file(thread).and_then(|file| self.note_space(thread, &file, None, before, change)));
        }
        for error in noted.into_iter().filter_map(Result::err) {
            eprintln!("atelier: Space 줄을 남기지 못했습니다: {error}");
        }
    }

    /// 그 Thread의 읽는 범위(§7) — Session의 자리 · 머리말이 이것 하나를 쓴다. 이은 Work는 부르는 쪽이 읽어 넘긴다.
    pub(super) fn scope_of(&self, file: &ThreadFile, work: Option<&Work>) -> ReadingScope {
        atelier_core::reading_scope(&self.data_root, &ScopeOf::thread(file, work))
    }

    fn check_space(&self, space: Option<&str>) -> Result<(), HostError> {
        match space {
            Some(slug) if space_gone(&self.data_root, slug) => Err(HostError::SpaceNotFound(slug.to_owned())),
            _ => Ok(()),
        }
    }

    /// Space 줄 하나 — 바뀐 뒤의 그 Thread의 범위를 싣는다.
    fn note_space(&self, thread: &str, file: &ThreadFile, work: Option<&Work>, before: Option<&str>, change: Change) -> Result<(), HostError> {
        let scope = self.scope_of(file, work);
        let line = space_line(change, &scope, before, work.map(|work| work.slug.as_str()));
        self.thread_log(thread)?.write(RecordKind::Space, None, line).map_err(HostError::Record).map(drop)
    }
}

/// Space 줄의 갈래 — 사람이 고른 것(바꿈 · 뺌 — 05)은 바뀐 범위가 가르고, 지움 · 되돌림(07)은 그 일이 정한다.
#[derive(Clone, Copy)]
enum Change<'a> {
    /// 칩 · 메뉴로 붙이고 · 바꾸고 · 뺐다 — 범위에 Space가 있으면 `changed`, 없으면 `removed`.
    Picked,
    /// 이은 Space가 지워졌다 — 그 Space(slug · 보이는 이름. 파일이 사라졌으면 이름도 slug다).
    Deleted { slug: &'a str, name: &'a str },
    /// 지운 Space를 되돌렸다 — 범위의 Space가 그것이다.
    Restored,
}

/// Space 줄의 payload — 갈래 · Space(slug · 이름) · 바꾸기 전 · 이은 Work · 읽는 Project의 이름 · 등록된 Project 수.
fn space_line(change: Change, scope: &ReadingScope, before: Option<&str>, work: Option<&str>) -> Value {
    let now = scope.space.as_ref().map(|space| (space.slug.as_str(), space.name.as_str()));
    let (kind, space) = match change {
        Change::Picked if now.is_some() => ("changed", now),
        Change::Picked => ("removed", None),
        Change::Deleted { slug, name } => ("deleted", Some((slug, name))),
        Change::Restored => ("restored", now),
    };
    json!({
        "change": kind,
        "space": space.map(|(slug, _)| slug),
        "name": space.map(|(_, name)| name),
        "before": before,
        "work": work,
        "projects": scope.projects.iter().map(|project| &project.name).collect::<Vec<_>>(),
        "registered": scope.registered,
    })
}

/// 그 slug의 Space 파일이 없다 — 지웠거나 손으로 지웠다(§7 규칙 1과 같은 셈).
fn space_gone(data_root: &std::path::Path, slug: &str) -> bool {
    atelier_core::get_space(data_root, slug).is_err()
}

/// 지우기 · 되돌리기의 거절 — 없는 Space는 붙이기와 같은 말, 그 밖(slug가 다시 쓰임 · 디스크)은 core의 글 그대로다.
fn space_error(error: atelier_core::Error) -> HostError {
    match error {
        atelier_core::Error::SpaceNotFound(slug) => HostError::SpaceNotFound(slug),
        other => HostError::Record(other.to_string()),
    }
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
