//! 읽기만 된 Thread — 이은 Work가 보관됐거나 지워진 Thread(v1 티켓 38 · 구현 스펙 §4 · §5 · §11 「보관」 · 스토리 103).
//!
//! - **판정은 하나다** — `thread.json`의 `work`가 가리키는 Work가 works에 없으면 읽기만이다(core [`atelier_core::work_gone`]). 보관은 Work
//!   폴더를 옮기고 Thread 폴더는 그대로라 Thread 쪽에 적는 것이 없다(§4).
//! - **Session은 지금 턴 뒤에 끈다**(§5). 앱은 Work 목록이 바뀔 때마다(`works:changed`) [`ConversationHost::check_vanished_works`]를
//!   부른다 — 쉬던 Session은 곧바로 끄고, 도는 턴은 끊지 않는다(보관을 시킨 Agent가 바로 그 턴 안에 있을 수 있다). 턴 끝에는 Session이
//!   스스로 Work를 보고 끄러 보낸다([`VanishWatch`]) — 소식이 턴 도중에 와도 그 턴 끝에 꺼진다. 대기 줄의 말은 가지 않는다.
//! - **Thread의 기록 폴더가 사라져도 같은 차례로 끈다**(§5 「끄는 때」, 코드 리뷰 1차 B9) — 앱은 `threads/`가 바뀔 때마다
//!   [`ConversationHost::check_vanished_threads`]를 부르고, 턴 끝에는 [`VanishWatch`]가 폴더도 본다.
//! - **말은 받지 않는다** — 사람의 말 · 지금 전하기 · 다시 맡기기 · Agent 부르기 · 이름 바꾸기를 거절하고 아무것도 적지 않는다
//!   ([`ConversationHost::writable`]). 멈추기 · 물음의 답은 받는다 — 보관된 때 돌던 턴을 사람이 끝낼 수 있게.
//! - **목록 요약도 읽기만인 까닭을 싣는다**(`readOnly`) — 색인이 Work 목록이 바뀔 때 다시 보고, 바뀐 요약을 알린다(S7). 열린 화면은 그
//!   요약으로 입력창 자리를 바꾸고, 사이드바는 그 Thread를 뺀다(S43).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Weak;

use atelier_core::{ThreadFile, WorkGone};

use super::{Session, SessionKey};
use crate::host::{end_together, Conv, ConversationHost, HostCore, HostError, HostEvent};

/// 턴 끝에 그 Session의 Thread가 읽기만 됐는지 보는 것. 턴 끝은 런타임의 sink 안이라 호스트를 부를 수 없으므로, 호스트를 약하게 쥐고
/// 끄기는 따로 띄운 스레드가 한다(three-axes 티켓 11의 길).
pub(in crate::host) struct VanishWatch {
    data_root: PathBuf,
    key: SessionKey,
    host: Weak<HostCore>,
}

impl VanishWatch {
    pub(super) fn new(data_root: PathBuf, key: SessionKey, host: Weak<HostCore>) -> Self {
        Self { data_root, key, host }
    }

    /// 그 Thread가 읽기만 됐거나 기록 폴더가 사라졌으면(코드 리뷰 1차 B9) 그 Session을 끄러 보내고 true다 — 턴 차례는 대기 줄을
    /// 보내지 않는다. 이 자리에서 끄지 않는다: 끄기는 연결을 놓고 1초를 기다리는데, 이 자리가 바로 그 연결의 수신 루프다. 폴더는 있는데
    /// `thread.json`을 못 읽으면(쓰는 중 · 깨짐) 지켜볼 것이 없다.
    pub(in crate::host) fn retire_if_vanished(&self) -> bool {
        let vanished = !folder_stands(&self.data_root, &self.key.thread)
            || atelier_core::read_thread(&self.data_root, &self.key.thread)
                .is_ok_and(|file| gone_of(&self.data_root, &file).is_some());
        if !vanished {
            return false;
        }
        let host = self.host.clone();
        let key = self.key.clone();
        std::thread::spawn(move || {
            if let Some(host) = ConversationHost::upgrade(&host) {
                host.retire(|at, _| *at == key);
            }
        });
        true
    }
}

impl ConversationHost {
    /// 보관되거나 지워진 Work의 Thread를 읽기만으로 둔다(v1 티켓 38) — 앱은 Work 목록이 바뀌었다는 감시 소식(`works:changed`)마다
    /// 부른다. Work가 사라지는 길은 보관이든 지우기든, 앱에서든 앱 밖의 MCP 프로세스에서든 같다 — 감시는 `works/`를 보므로 다 안다.
    ///
    /// - 색인이 이은 Work를 다시 보고, 읽기만이 바뀐 요약을 알린다 — 열린 화면의 입력창 자리와 사이드바가 따라온다.
    /// - 읽기만 된 Thread의 쉬던 Session은 지금 끈다. 턴이 도는 Session은 두고 그 턴이 끝나는 대로 끈다([`VanishWatch`]).
    ///
    /// 막히는 호출이다 — 끌 Session이 있으면 끄기가 1초 남짓 걸린다.
    pub fn check_vanished_works(&self) {
        let changed = match self.with_index(|index| index.recheck_works()) {
            Ok(changed) => changed,
            Err(error) => {
                eprintln!("{error}");
                return;
            }
        };
        for summary in changed {
            (self.emit)(HostEvent::ThreadList(summary));
        }
        let read_only: HashSet<String> = self
            .with_index(|index| {
                index.all().iter().filter(|summary| summary.read_only.is_some()).map(|summary| summary.id.clone()).collect()
            })
            .unwrap_or_default();
        if !read_only.is_empty() {
            self.retire(|key, conv| read_only.contains(&key.thread) && !conv.lock_state().order.turning());
        }
    }

    /// 기록 폴더가 사라진 Thread의 Session을 끈다(구현 스펙 §5 「끄는 때」, 코드 리뷰 1차 B9) — 앱은 Thread 폴더들의 뿌리(`threads/`)가
    /// 바뀌었다는 감시 소식마다 부른다. 쉬던 Session은 지금 끄고, 턴이 도는 Session은 그 턴이 끝나는 대로 끈다([`VanishWatch`]) — 보관된
    /// Work의 Thread와 같은 차례다. 막히는 호출이다 — 끌 Session이 있으면 끄기가 1초 남짓 걸린다.
    pub fn check_vanished_threads(&self) {
        let data_root = self.data_root.clone();
        self.retire(|key, conv| !folder_stands(&data_root, &key.thread) && !conv.lock_state().order.turning());
    }

    /// 말을 받는 Thread인가 — 이은 Work가 보관됐거나 지워졌으면 [`HostError::ReadOnly`]다. 받으면 그 Thread 파일이다. 무엇을 적기 전에
    /// 부른다.
    pub(super) fn writable(&self, thread: &str) -> Result<ThreadFile, HostError> {
        let file = self.read_thread_file(thread)?;
        match gone_of(&self.data_root, &file) {
            Some(gone) => Err(HostError::ReadOnly { thread: thread.to_owned(), gone }),
            None => Ok(file),
        }
    }

    /// 고른 Session들을 떠 있는 표에서 꺼내 남김없이 끈다(stdin 닫기 → 1초 → 그룹째 SIGKILL). 대기 줄에 말이 남았으면 빈 대기 줄을
    /// 알린다 — 그 말은 가지 않는다. 고르기는 표의 잠금 안에서 Session의 잠금을 쥔다(표 → Session의 차례). 고른 것이 그새 표에서
    /// 빠졌으면 먼저 꺼낸 쪽이 끈다.
    fn retire(&self, pick: impl Fn(&SessionKey, &Conv) -> bool) {
        let picked: Vec<SessionKey> = self
            .threads
            .lock_sessions()
            .iter()
            .filter(|(key, session)| pick(key, &session.conv))
            .map(|(key, _)| key.clone())
            .collect();
        let mut retiring: Vec<Session> = picked.iter().filter_map(|key| self.threads.take(key)).collect();
        end_together(retiring.iter_mut().map(|session| (&mut session.agent, &*session.conv)).collect());
        for session in &retiring {
            if session.conv.lock_state().order.queued() > 0 {
                session.conv.recorder.queue_changed(Vec::new());
            }
        }
    }
}

/// 그 Thread의 기록 폴더가 서 있나 — 없거나 id가 경로를 품었으면 아니다.
fn folder_stands(data_root: &Path, thread: &str) -> bool {
    atelier_core::thread_dir(data_root, thread).is_ok_and(|dir| dir.is_dir())
}

/// 그 Thread가 읽기만인 까닭 — 이은 Work가 진행 중이 아니면 보관됨 · 지워짐이다. Work 없는 Thread는 늘 말을 받는다.
pub(super) fn gone_of(data_root: &Path, file: &ThreadFile) -> Option<WorkGone> {
    file.work.as_deref().and_then(|slug| atelier_core::work_gone(data_root, slug))
}
