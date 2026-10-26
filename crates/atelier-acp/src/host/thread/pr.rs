//! Work의 PR 지켜보기 — Work의 PR을 `gh`로 읽고, 처음 보인 PR과 상태 변화를 그 Work에서 가장 최근에 말한 Thread에 `pr` 줄로 남긴다
//! (v1 티켓 36 · 구현 스펙 §12 S24 · §4 `pr`). 이 줄이 Thread의 PR 카드가 된다(스토리 124).
//!
//! - **읽는 때.** Work에 이은 Thread에서 턴이 끝날 때마다 엔진이 스스로 읽는다([`ConversationHost::reading_prs`]). 화면은 Work 카드가 열릴
//!   때와 열린 동안 60초마다 부른다([`ConversationHost::read_work_prs`]). 읽기는 core 하나이고(v1 티켓 33), `gh`는 로그인 셸의 PATH로
//!   찾는다.
//! - **상태는 PR 번호 · 열림/닫힘/병합됨 · CI · 승인 수 · 수정 요청 수다**(§12 「열림 · CI 확인 중 · 통과 · 실패 · 병합됨 · 리뷰 수」).
//!   제목 · +/− · 파일 수가 바뀐 것은 상태 변화가 아니다 — 고쳐 올릴 때마다 줄이 서지 않게. 처음 보는 번호는 「처음 보인 PR」이다.
//! - **없음 · 읽지 못함은 변화가 아니다**(v1 티켓 33) — `gh`가 없거나 로그인이 풀렸거나 네트워크가 끊겼다고 PR이 사라진 것이 아니다. 본
//!   상태는 그대로 두어, 다시 읽히면 같은 PR을 「처음」으로 적지 않는다.
//! - **본 상태는 기록이 정본이다.** 엔진이 Work를 처음 볼 때 그 Work의 Thread 기록에서 Project마다 마지막 `pr` 줄을 읽어 채운다 — 앱을
//!   다시 켜도 같은 상태를 다시 적지 않는다. 적지 못한 상태는 보지 않은 것으로 남아 다음 읽기가 다시 적는다.
//! - **`gh`에는 시간 한도가 없다**(v1 티켓 33). Work마다 읽기는 하나씩이다 — 앞 읽기가 도는 동안 온 턴 끝은 읽지 않고 넘긴다(돌고 있는
//!   읽기나 다음 읽기가 본다). 화면의 부름은 앞 읽기가 끝나기를 기다린다 — 화면도 앞 부름의 답을 받기 전에 다음을 부르지 않는다.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, TryLockError};

use atelier_core::{Ci, PrLookup, PrState, ProjectPr, PullRequest, RecordKind, RecordLine};
use serde_json::json;

use super::seat::{ends_turn, Writer};
use super::ConversationHost;
use crate::runtime::Sink;
use crate::HostError;

/// 호스트의 PR 지켜보기 — Work마다 본 상태와 읽기의 문.
#[derive(Default)]
pub(super) struct PrWatch {
    /// Work → Project → 마지막으로 적은 상태. 처음 볼 때 기록에서 채운다.
    seen: Mutex<HashMap<String, HashMap<String, PrMark>>>,
    /// Work마다 읽기를 하나씩 세우는 문.
    gates: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl PrWatch {
    fn lock_seen(&self) -> MutexGuard<'_, HashMap<String, HashMap<String, PrMark>>> {
        self.seen.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn gate(&self, work: &str) -> Arc<Mutex<()>> {
        let mut gates = self.gates.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        Arc::clone(gates.entry(work.to_owned()).or_default())
    }
}

/// PR 하나의 상태 — 이것이 바뀌면 `pr` 줄이 선다.
#[derive(Debug, Clone, PartialEq, Eq)]
struct PrMark {
    number: u64,
    state: PrState,
    ci: Ci,
    approvals: u32,
    changes_requested: u32,
}

impl PrMark {
    fn of(pr: &PullRequest) -> Self {
        Self {
            number: pr.number,
            state: pr.state,
            ci: pr.ci.clone(),
            approvals: pr.approvals,
            changes_requested: pr.changes_requested,
        }
    }
}

impl ConversationHost {
    /// Work의 PR(§12 S24) — Project마다 Work 브랜치의 PR을 `gh`로 읽어 돌려주고, 처음 보인 PR과 상태 변화를 그 Work에서 가장 최근에 말한
    /// Thread에 `pr` 줄로 남긴다. Work 카드가 열릴 때와 열린 동안 60초마다 화면이 부른다.
    ///
    /// 막히는 호출이다 — `gh`가 GitHub에 묻는 것과, 같은 Work의 앞 읽기가 끝나기를 기다린다. 로그인 env를 아직 쥐지 않았으면 셸도 띄운다.
    pub fn read_work_prs(&self, work: &str) -> Result<Vec<ProjectPr>, HostError> {
        let gate = self.threads.prs.gate(work);
        let _reading = gate.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        self.read_and_note(work)
    }

    /// 턴 끝을 넘긴 뒤 이은 Work의 PR을 읽는 sink(§12 「Work의 Thread에서 턴이 끝날 때」) — 받은 것을 `sink`에 넘긴 **뒤에** 따로 선
    /// 스레드에서 읽는다. 그래서 `pr` 줄은 턴 끝 줄 뒤에 서고, 런타임의 읽는 스레드는 `gh`를 기다리지 않는다. 호스트는 약하게 쥔다 —
    /// Session이 호스트를 쥐면 끄지 못한다.
    pub(super) fn reading_prs(&self, sink: Sink, writer: &Arc<Writer>) -> Sink {
        let host = self.weak();
        let writer = Arc::clone(writer);
        Arc::new(move |event| {
            let ended = ends_turn(&event);
            sink(event);
            let Some(work) = ended.then(|| writer.work()).flatten() else { return };
            let host = host.clone();
            std::thread::spawn(move || {
                if let Some(host) = ConversationHost::upgrade(&host) {
                    host.read_prs_after_turn(&work);
                }
            });
        })
    }

    /// 턴 끝의 읽기 — 같은 Work의 앞 읽기가 돌고 있으면 넘긴다. 실패(Work가 사라졌다)는 화면에 갈 곳이 없다.
    fn read_prs_after_turn(&self, work: &str) {
        let gate = self.threads.prs.gate(work);
        let _reading = match gate.try_lock() {
            Ok(held) => held,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return,
        };
        if let Err(error) = self.read_and_note(work) {
            eprintln!("턴 끝에 PR을 읽지 못했습니다: {error}");
        }
    }

    fn read_and_note(&self, work: &str) -> Result<Vec<ProjectPr>, HostError> {
        let path = self.login_path();
        let works = atelier_core::works_in(&self.data_root);
        let prs = atelier_core::read_work_prs(&works, work, path.as_deref())
            .map_err(|_| HostError::WorkNotFound(work.to_owned()))?;
        self.note_prs(work, &prs);
        Ok(prs)
    }

    /// 읽은 PR들 가운데 처음 보이거나 상태가 바뀐 것을 `pr` 줄로 남긴다. 줄은 그 Work에서 가장 최근에 말한 Thread 하나에 선다.
    fn note_prs(&self, work: &str, prs: &[ProjectPr]) {
        let found: Vec<(&str, &PullRequest)> = prs
            .iter()
            .filter_map(|one| match &one.pr {
                PrLookup::Found(pr) => Some((one.project.as_str(), pr)),
                PrLookup::Absent | PrLookup::Unreadable { .. } => None,
            })
            .collect();
        if found.is_empty() {
            return;
        }
        let mut seen = self.threads.prs.lock_seen();
        if !seen.contains_key(work) {
            let marks = self.marks_in_records(work);
            seen.insert(work.to_owned(), marks);
        }
        let marks = seen.get_mut(work).expect("방금 채웠다");
        let fresh: Vec<(&str, &PullRequest)> =
            found.into_iter().filter(|(project, pr)| marks.get(*project) != Some(&PrMark::of(pr))).collect();
        if fresh.is_empty() {
            return;
        }
        let Some(thread) = self.latest_spoken(work) else { return };
        let log = match self.thread_log(&thread) {
            Ok(log) => log,
            Err(error) => {
                eprintln!("PR 줄을 적지 못했습니다: {error}");
                return;
            }
        };
        for (project, pr) in fresh {
            let first = marks.get(project).is_none_or(|mark| mark.number != pr.number);
            let mut payload = serde_json::to_value(pr).expect("PR은 JSON이다");
            let head = json!({"work": work, "project": project, "first": first});
            payload.as_object_mut().expect("PR은 객체다").extend(head.as_object().expect("객체").clone());
            match log.write(RecordKind::Pr, None, payload) {
                Ok(_) => {
                    marks.insert(project.to_owned(), PrMark::of(pr));
                }
                Err(error) => eprintln!("{error}"),
            }
        }
    }

    /// 그 Work의 Thread 기록에 남은 Project마다 마지막 상태 — 줄의 시각 차례로 뒤의 것이 이긴다.
    fn marks_in_records(&self, work: &str) -> HashMap<String, PrMark> {
        let mut lines: Vec<RecordLine> = self
            .work_records(work)
            .into_iter()
            .flat_map(|(_, lines)| lines)
            .filter(|line| line.kind == RecordKind::Pr && line.payload["work"] == work)
            .collect();
        lines.sort_by(|a, b| a.at.cmp(&b.at));
        let mut marks = HashMap::new();
        for line in lines {
            let Some(project) = line.payload["project"].as_str().map(str::to_owned) else { continue };
            if let Ok(pr) = serde_json::from_value::<PullRequest>(line.payload) {
                marks.insert(project, PrMark::of(&pr));
            }
        }
        marks
    }

    /// 그 Work에서 가장 최근에 말한 Thread — 사람의 말(`sent`)이나 Agent의 턴 끝(`turn-end`)이 가장 늦은 Thread다. 말이 하나도 없으면
    /// 가장 새 Thread, Thread가 없으면 없다.
    fn latest_spoken(&self, work: &str) -> Option<String> {
        let records = self.work_records(work);
        let spoken = records
            .iter()
            .filter_map(|(id, lines)| {
                let said = lines.iter().rev().find(|line| matches!(line.kind, RecordKind::Sent | RecordKind::TurnEnd))?;
                Some((said.at.as_str(), id))
            })
            .max_by(|a, b| a.0.cmp(b.0))
            .map(|(_, id)| id.clone());
        spoken.or_else(|| records.first().map(|(id, _)| id.clone()))
    }

    /// 그 Work에 이은 Thread들(새것부터)과 그 기록 — 읽지 못한 기록은 비어 있다.
    fn work_records(&self, work: &str) -> Vec<(String, Vec<RecordLine>)> {
        let ids: Vec<String> = self
            .with_index(|index| index.of_work(work).into_iter().map(|summary| summary.id.clone()).collect())
            .unwrap_or_default();
        ids.into_iter()
            .map(|id| {
                let lines = atelier_core::read_thread_records(&self.data_root, &id, 0).unwrap_or_default();
                (id, lines)
            })
            .collect()
    }
}
