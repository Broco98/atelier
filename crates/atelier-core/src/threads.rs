//! Thread 저장 — 데이터 루트 아래 `threads/<id>/{thread.json, events.jsonl}`(v1 구현 스펙 §4 · S5 ~ S8).
//!
//! - **Thread 폴더는 Thread 엔진만 쓴다**(S7). 감시를 두지 않으므로 목록이 바뀐 것은 엔진이 직접 알린다 — 엔진은 시작할 때
//!   [`ThreadIndex`]를 한 번 읽고, 쓸 때마다 [`ThreadIndex::put`]으로 고친다.
//! - **Work와의 연결은 `thread.json`의 `work`에만 적는다.** Work 쪽에는 Thread 목록이 없고, 보관이 Work 폴더를 옮겨도 Thread
//!   폴더는 그대로다 — 보관 · 지운 Work의 Thread는 [`work_gone`]으로 읽기만이 된다(v1 티켓 38).
//! - 기록 줄은 코어의 기록 줄(`records.rs`) 한 벌이다 — three-axes 대화 기록과 같은 모양에 `who`만 더했다(S8).
//! - three-axes가 `works/<slug>/agents/`에 남긴 대화 기록은 옮기지 않는다(v1 구현 스펙 §4 끝).

use std::path::{Path, PathBuf};

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::records::{RecordKind, RecordLine, RecordLog};
use crate::Result;

const THREAD_FILE: &str = "thread.json";
const RECORD_FILE: &str = "events.jsonl";
/// Thread 폴더 안에서 참여자의 정의 스냅숏(`<handle>.md`)과 지시문 파일(`<handle>.instructions.md`)이 사는 폴더(S4).
pub const THREAD_SNAPSHOTS: &str = "agents";

/// `thread.json` 한 장(v1 구현 스펙 §4 표). 칸이 빠진 파일도 읽힌다 — 다른 판의 앱이 쓴 파일을 깨진 것으로 보지 않게.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadFile {
    /// Thread 이름. 첫 말의 앞부분에서 정하고, Host가 Thread 도구로 바꾼다.
    #[serde(default)]
    pub title: String,
    /// 만든 시각 — 로컬 시각대의 RFC 3339, 밀리초까지(기록 줄의 `at`과 같은 꼴).
    #[serde(default)]
    pub created_at: String,
    /// 이어진 Work의 slug. 없으면 `null`이다.
    #[serde(default)]
    pub work: Option<String>,
    /// 물어보는 정도. Work가 없을 때만 쓴다(v1 구현 스펙 §9 · S18).
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub participants: Vec<Participant>,
    /// 사람이 마지막으로 본 줄의 seq. 0이면 아무것도 보지 않았다(S38).
    #[serde(default)]
    pub last_read: u64,
    /// Work 밖 Project 카드에서 사람이 「읽기만 하기」를 고른 Project의 slug들(v1 구현 스펙 S22 · v1 티켓 32) — 그 폴더를 Session의
    /// 함께 여는 폴더로 더한다. 고치기는 판정이 계속 거절한다. 비었으면 칸째 빠진다.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub read_only_projects: Vec<String>,
    /// 입력창 Work 칩에서 「새 Work」로 시작했나(v1 티켓 31 · 03 구현 스펙 S3) — `work`가 서기 전까지 첫 말 뒤의 잠긴 Work 칩이 흐린
    /// 「새 Work」다(Work를 만드는 중). 아니면 칸째 빠진다.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub new_work: bool,
    /// 이은 Space의 slug(03 구현 스펙 §9) — Work 없는 Thread만 쓴다. Work에 이은 Thread는 Work의 `space`를 따르고 이 칸은 쓰지 않는다
    /// (읽는 범위 규칙 1 — `scope.rs`). 없으면 칸째 빠진다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space: Option<String>,
    /// 모르는 칸은 다시 써도 남는다 — 다른 판의 앱이 더한 칸을 지우지 않게(`work.json` · `agents.json`과 같은 규약).
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// 참여한 Agent 하나(v1 구현 스펙 §4 표). handle 밖의 칸은 비어 있어도 읽힌다 — 들어온 뒤 Session이 열리며 채워진다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub handle: String,
    /// 정의가 온 곳.
    #[serde(default)]
    pub from: Option<DefinitionSource>,
    /// 들어온 시각.
    #[serde(default)]
    pub joined_at: String,
    /// Runtime 이름(`claude-code`).
    #[serde(default)]
    pub runtime: String,
    #[serde(default)]
    pub session_id: Option<String>,
    /// 지금 작업 폴더. Session 기록의 자리를 알려고 쓰지 않는다 — Runtime은 Session id만으로 기록을 찾는다(S11).
    #[serde(default)]
    pub cwd: Option<PathBuf>,
    /// 작업 폴더와 함께 여는 폴더.
    #[serde(default)]
    pub additional_directories: Vec<PathBuf>,
    #[serde(default)]
    pub model: Option<String>,
    /// 생각 깊이.
    #[serde(default)]
    pub effort: Option<String>,
    /// 모르는 칸은 다시 써도 남는다.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Agent 정의가 온 곳(v1 구현 스펙 §6 범위) — `"library"` 또는 `{"project": "<slug>"}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DefinitionSource {
    Library,
    Project(String),
}

/// 새 Thread의 처음 값 — 나머지 칸은 비어서 선다(참여자는 엔진이 Session을 연 뒤 적는다).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct NewThread {
    pub title: String,
    pub work: Option<String>,
    pub mode: Option<String>,
    /// 「새 Work」로 시작했나 — [`ThreadFile::new_work`].
    pub new_work: bool,
}

/// 첫 줄과 함께 선 Thread — 이어 적을 기록과, 방금 적은 첫 줄(엔진이 이벤트로 내보낸다).
pub struct CreatedThread {
    pub id: String,
    pub log: RecordLog,
    pub first: RecordLine,
}

/// 새 Thread를 첫 줄과 함께 디스크에 세운다(S6) — id를 지금 시각으로 잡고(S5), 폴더 · `thread.json` · `events.jsonl`을 만들고,
/// 첫 줄을 적는다.
///
/// **첫 줄 없이는 Thread를 세우지 않는다.** 열어만 둔 새 Thread는 엔진의 메모리에만 있고, 첫 말을 보낼 때 이것을 부른다 — 빈
/// Thread 폴더가 쌓이지 않는다. 첫 줄은 엔진이 고른다(사람의 `sent` 또는 Host의 `joined`).
pub fn create_thread(
    data_root: &Path,
    thread: NewThread,
    kind: RecordKind,
    who: Option<&str>,
    payload: Value,
) -> Result<CreatedThread> {
    create_thread_at(data_root, chrono::Local::now().fixed_offset(), thread, kind, who, payload)
}

/// [`create_thread`]의 몸 — 시각을 받는다. 시험이 같은 초를 세운다.
pub(crate) fn create_thread_at(
    data_root: &Path,
    at: DateTime<FixedOffset>,
    thread: NewThread,
    kind: RecordKind,
    who: Option<&str>,
    payload: Value,
) -> Result<CreatedThread> {
    let (id, dir) = claim_id(&crate::paths::threads_in(data_root), at)?;
    let file = ThreadFile {
        title: thread.title,
        created_at: at.to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
        work: thread.work,
        mode: thread.mode,
        new_work: thread.new_work,
        ..ThreadFile::default()
    };
    crate::atomic::write_json_into_existing_dir(&dir, THREAD_FILE, &file, "Thread를")?;
    let mut log = RecordLog::open(&dir.join(RECORD_FILE))?;
    let first = log.append(kind, who, payload)?;
    Ok(CreatedThread { id, log, first })
}

/// 그 시각의 id로 Thread 폴더를 잡는다(S5) — `YYYYMMDD-HHMMSS`, 그 이름의 폴더가 이미 있으면 `-2` · `-3` ….
///
/// **폴더 만들기가 곧 잡기다.** `create_dir`는 이미 있으면 실패하므로, 「있나 보고 만든다」의 틈에 같은 id를 둘이 잡는 일이
/// 없다.
fn claim_id(threads: &Path, at: DateTime<FixedOffset>) -> Result<(String, PathBuf)> {
    std::fs::create_dir_all(threads)?;
    let base = at.format("%Y%m%d-%H%M%S").to_string();
    for n in 1u32.. {
        let id = if n == 1 { base.clone() } else { format!("{base}-{n}") };
        let dir = threads.join(&id);
        match std::fs::create_dir(&dir) {
            Ok(()) => return Ok((id, dir)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    unreachable!("Thread id 번호가 다 찼다")
}

/// Thread 하나의 폴더 `threads/<id>`. 있다고 보증하지 않는다. Work 없는 Thread의 작업 폴더이고(S11), Agent 정의의 스냅숏이
/// 사는 곳이다(S4).
///
/// **경로를 품은 id는 거절한다** — id는 화면에서 명령 인자로 오므로, `..`이 `threads/` 밖을 가리키면 남의 폴더에 기록을 쓴다
/// (slug와 같은 규칙, `slug.rs`의 `is_safe_slug`).
pub fn thread_dir(data_root: &Path, id: &str) -> Result<PathBuf> {
    if !crate::slug::is_safe_slug(id) {
        return Err(crate::Error::Validation(format!("Thread id가 아닙니다: {id:?}")));
    }
    Ok(crate::paths::threads_in(data_root).join(id))
}

/// Thread 폴더 안에서 Atelier만 쓰는 자리(S7 · §19, 코드 리뷰 1차 A2) — `thread.json` · `events.jsonl` · 점 파일 `.policy.json` ·
/// 정의 스냅숏 폴더. 판정이 이 자리의 편집을 거절한다. 나머지 Thread 폴더는 Work 없는 Thread의 작업 폴더라 Agent가 고친다(S11).
pub fn thread_kept(dir: &Path) -> Vec<PathBuf> {
    [THREAD_FILE, RECORD_FILE, crate::policy_file::POLICY_FILE, THREAD_SNAPSHOTS].iter().map(|name| dir.join(name)).collect()
}

/// `thread.json`을 읽는다. 없으면 `NotFound`, 깨졌으면 `InvalidData` — 까닭은 색인의 깨진 줄과 같은 말이다.
pub fn read_thread(data_root: &Path, id: &str) -> Result<ThreadFile> {
    match load_thread(&thread_dir(data_root, id)?)? {
        Loaded::Fine(thread) => Ok(thread),
        Loaded::Missing => Err(std::io::Error::new(std::io::ErrorKind::NotFound, format!("Thread를 찾지 못했습니다: {id}")).into()),
        Loaded::Broken { reason, .. } => Err(std::io::Error::new(std::io::ErrorKind::InvalidData, format!("{reason} ({id})")).into()),
    }
}

/// `thread.json`을 읽어 고쳐 쓰고, 고친 값을 돌려준다. tmp에 쓴 뒤 rename한다.
///
/// - **Thread 폴더를 만들지 않는다** — 사라진 Thread를 되살리지 않는다(폴더가 없으면 `NotFound`).
/// - **깨진 파일이었으면 원문 바이트를 먼저 옆에 비켜 두고**(`atomic.rs`의 `keep_aside` — `thread.json.bak`, 이미 있으면
///   `.1.bak` …) 빈 값에서 고쳐 쓴다. 벌을 못 뜨면 쓰지 않는다. 순서 파일 다시 쓰기(`order.rs`의 `rewrite_order`)와 같은 규칙이다
///   — 덮이는 것은 사람이 손으로 고치다 깨뜨린 파일이다.
pub fn update_thread(data_root: &Path, id: &str, change: impl FnOnce(&mut ThreadFile)) -> Result<ThreadFile> {
    let dir = thread_dir(data_root, id)?;
    let mut thread = match load_thread(&dir)? {
        Loaded::Fine(thread) => thread,
        Loaded::Missing => ThreadFile::default(),
        Loaded::Broken { bytes, .. } => {
            let kept = crate::atomic::keep_aside(&dir, THREAD_FILE, &bytes)?;
            eprintln!(
                "atelier: thread file was unreadable as JSON ({}); kept its bytes as {} before rewriting it",
                dir.join(THREAD_FILE).display(),
                kept.display()
            );
            ThreadFile::default()
        }
    };
    change(&mut thread);
    crate::atomic::write_json_into_existing_dir(&dir, THREAD_FILE, &thread, "Thread를")?;
    Ok(thread)
}

/// 읽은 `thread.json`의 세 갈래. 깨진 파일은 원문 바이트를 함께 든다 — 다시 쓰는 쪽이 그것을 떠 두지 않고는 덮지 못하게.
enum Loaded {
    Fine(ThreadFile),
    Missing,
    Broken { bytes: Vec<u8>, reason: String },
}

/// 바이트로 읽는다 — 글로 읽으면 UTF-8이 아닌 파일이 「깨짐」이 아니라 읽기 실패로 넘어져 벌 없이 덮인다(`order.rs`와 같은 까닭).
fn load_thread(dir: &Path) -> Result<Loaded> {
    let bytes = match std::fs::read(dir.join(THREAD_FILE)) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Loaded::Missing),
        Err(e) => return Err(e.into()),
    };
    Ok(match serde_json::from_slice(&bytes) {
        Ok(thread) => Loaded::Fine(thread),
        Err(e) => Loaded::Broken { reason: format!("{THREAD_FILE}을 읽지 못했습니다: {e}"), bytes },
    })
}

/// 있는 Thread의 기록을 이어 쓰도록 연다 — 앱을 다시 켠 뒤 그 Thread에 처음 적을 때. **Thread 폴더를 만들지 않는다** — 사라진
/// Thread를 되살리지 않는다.
pub fn open_thread_log(data_root: &Path, id: &str) -> Result<RecordLog> {
    RecordLog::open(&thread_dir(data_root, id)?.join(RECORD_FILE))
}

/// 그 Thread의 기록에서 `after` 다음 seq의 줄들 — 화면은 이것으로 그리고, 그 뒤는 엔진의 기록 줄 이벤트로 잇는다. 끝의 반쪽
/// 줄과 이 판이 모르는 줄은 버린다(`records.rs`의 `read_records`). 기록이 없으면 `NotFound`다. 읽기만 한다.
pub fn read_thread_records(data_root: &Path, id: &str, after: u64) -> Result<Vec<RecordLine>> {
    Ok(crate::records::read_records(&thread_dir(data_root, id)?.join(RECORD_FILE), after)?)
}

/// Thread가 이은 Work가 진행 중이 아닌 까닭(v1 구현 스펙 §4 · §5 · v1 티켓 38) — 그 Thread는 읽기만 된다. 엔진은 그 Thread의 Session을
/// 지금 턴 뒤에 끄고 보내기를 거절하며, 화면은 입력창 자리에 그 까닭을 보인다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkGone {
    /// 보관됐다 — **works에 없고 archive에 있다**(§4).
    Archived,
    /// 지워졌다 — 어디에도 없다.
    Removed,
}

/// 그 Work가 진행 중이 아니면 그 까닭 — 진행 중이면 없다. 「있음」은 그 자리에 `work.json`이 파일로 있는가다(`works.rs`의 `read_work`와
/// 같은 판정 — 파일이 깨졌어도 있는 Work다. 사람이 손보는 중일 수 있는데 그때 Thread를 읽기만으로 두면 하던 일을 잃는다).
///
/// 보관은 Work 폴더를 통째로 옮기고 Thread 폴더는 그대로 두므로(Thread는 `work`에 slug만 적는다), 연결된 Thread가 읽기만 되는지를
/// 이 판정 하나가 정한다.
pub fn work_gone(data_root: &Path, slug: &str) -> Option<WorkGone> {
    let holds = |root: PathBuf| crate::works::work_dir(&root, slug).is_ok_and(|dir| dir.join("work.json").is_file());
    if holds(crate::paths::works_in(data_root)) {
        None
    } else if holds(crate::paths::archive_in(data_root)) {
        Some(WorkGone::Archived)
    } else {
        Some(WorkGone::Removed)
    }
}

/// 색인의 한 줄 — Thread 하나의 요약(제목 · 시각 · work · 참여자 handle · 읽은 자리). 깨진 Thread도 줄이 선다 — 그때는 `broken`에
/// 까닭만 있고 나머지 칸은 비었다. 목록에서 조용히 빠지면 「내 Thread가 어디 갔지」에 답할 자리가 없다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub work: Option<String>,
    pub handles: Vec<String>,
    /// 사람이 마지막으로 본 줄의 seq(S38) — 사이드바가 「새 결과」(끝난 턴이 이 뒤에 있다)를 가른다(v1 티켓 41).
    pub last_read: u64,
    /// 이은 Work가 보관됐거나 지워졌으면 그 까닭(v1 티켓 38) — 그 Thread는 읽기만이고 사이드바에서 빠지며, ⌘K는 보관됨을 단다(S43).
    /// Work가 없거나 진행 중이면 없다.
    pub read_only: Option<WorkGone>,
    pub broken: Option<String>,
}

/// 모든 Thread의 색인 — 엔진이 메모리에 쥐는 것(v1 구현 스펙 §4 「Work의 Thread 목록」). 새것이 먼저다.
pub struct ThreadIndex {
    /// 데이터 루트 — 요약이 이은 Work가 어디 있는지 본다([`work_gone`]).
    root: PathBuf,
    threads: Vec<ThreadSummary>,
}

impl ThreadIndex {
    /// 데이터 루트의 모든 `thread.json`을 읽는다. **읽기만 한다** — `threads/`가 없으면 빈 색인이고, 폴더를 만들지 않는다.
    pub fn load(data_root: &Path) -> Result<Self> {
        let entries = match std::fs::read_dir(crate::paths::threads_in(data_root)) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self { root: data_root.to_path_buf(), threads: Vec::new() })
            }
            Err(e) => return Err(e.into()),
        };
        let mut threads = Vec::new();
        for entry in entries {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if id.starts_with('.') || !entry.path().is_dir() {
                continue;
            }
            threads.push(match load_thread(&entry.path()) {
                Ok(Loaded::Fine(thread)) => summarize(data_root, &id, &thread),
                Ok(Loaded::Missing) => broken(id, format!("{THREAD_FILE}이 없습니다")),
                Ok(Loaded::Broken { reason, .. }) => broken(id, reason),
                Err(e) => broken(id, format!("{THREAD_FILE}을 읽지 못했습니다: {e}")),
            });
        }
        let mut index = Self { root: data_root.to_path_buf(), threads };
        index.sort();
        Ok(index)
    }

    /// 모든 Thread — 새것부터.
    pub fn all(&self) -> &[ThreadSummary] {
        &self.threads
    }

    /// 그 Work에 이어진 Thread들 — 새것부터.
    pub fn of_work(&self, slug: &str) -> Vec<&ThreadSummary> {
        self.threads.iter().filter(|summary| summary.work.as_deref() == Some(slug)).collect()
    }

    /// 방금 쓴 `thread.json`으로 그 Thread의 줄을 고친다(없으면 더한다).
    pub fn put(&mut self, id: &str, thread: &ThreadFile) {
        let summary = summarize(&self.root, id, thread);
        match self.threads.iter_mut().find(|existing| existing.id == id) {
            Some(existing) => *existing = summary,
            None => self.threads.push(summary),
        }
        self.sort();
    }

    /// 이은 Work가 보관됐거나 지워졌는지 다시 본다(v1 티켓 38) — 보관은 Work 폴더를 옮기고 Thread 폴더는 그대로라(§4) 색인이 스스로
    /// 알지 못한다. 엔진이 Work 목록이 바뀔 때마다 부른다. 바뀐 요약들을 새것부터 돌려준다 — 엔진이 그것을 알린다(S7).
    pub fn recheck_works(&mut self) -> Vec<ThreadSummary> {
        let mut changed = Vec::new();
        for summary in &mut self.threads {
            let Some(slug) = &summary.work else { continue };
            let now = work_gone(&self.root, slug);
            if summary.read_only != now {
                summary.read_only = now;
                changed.push(summary.clone());
            }
        }
        changed
    }

    fn sort(&mut self) {
        self.threads.sort_by(|a, b| order_key(&b.id).cmp(&order_key(&a.id)));
    }
}

fn summarize(data_root: &Path, id: &str, thread: &ThreadFile) -> ThreadSummary {
    ThreadSummary {
        id: id.to_owned(),
        title: thread.title.clone(),
        created_at: thread.created_at.clone(),
        work: thread.work.clone(),
        handles: thread.participants.iter().map(|participant| participant.handle.clone()).collect(),
        last_read: thread.last_read,
        read_only: thread.work.as_deref().and_then(|slug| work_gone(data_root, slug)),
        broken: None,
    }
}

/// 깨진 Thread의 줄 — 까닭만 있다. 제목 · 시각 · work · 참여자는 읽지 못했다.
fn broken(id: String, reason: String) -> ThreadSummary {
    ThreadSummary {
        id,
        title: String::new(),
        created_at: String::new(),
        work: None,
        handles: Vec::new(),
        last_read: 0,
        read_only: None,
        broken: Some(reason),
    }
}

/// 새것을 가리는 열쇠 — id의 시각, 같은 초면 붙인 번호. 글자 순서로만 견주면 `-10`이 `-2`보다 앞선다. 이 꼴이 아닌 id(손으로
/// 만든 폴더)는 id 글자 그대로 견준다.
fn order_key(id: &str) -> (&str, u32) {
    match (id.get(..15), id.get(15..)) {
        (Some(base), Some("")) => (base, 1),
        (Some(base), Some(rest)) => match rest.strip_prefix('-').and_then(|n| n.parse().ok()) {
            Some(n) => (base, n),
            None => (id, 0),
        },
        _ => (id, 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn at(text: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(text).unwrap()
    }

    fn new_thread(title: &str) -> NewThread {
        NewThread { title: title.to_owned(), work: None, mode: Some("ask".to_owned()), new_work: false }
    }

    /// 사람이 보낸 첫 말로 Thread를 세운다.
    fn create(root: &Path, when: &str, thread: NewThread, text: &str) -> CreatedThread {
        create_thread_at(root, at(when), thread, RecordKind::Sent, None, json!({"text": text})).unwrap()
    }

    fn raw_thread_json(root: &Path, id: &str) -> Value {
        serde_json::from_str(&std::fs::read_to_string(root.join("threads").join(id).join("thread.json")).unwrap()).unwrap()
    }

    /// S6 — **첫 줄을 쓸 때 폴더 · `thread.json` · `events.jsonl`이 함께 선다.** 그 전에는 데이터 루트에 아무것도 없다.
    #[test]
    fn 첫_줄을_쓸_때_폴더와_thread_json과_기록이_함께_선다() {
        let root = tempfile::tempdir().unwrap();
        assert!(!root.path().join("threads").exists(), "새 Thread를 열어만 둔 동안에는 디스크에 아무것도 없다");

        let created = create(root.path(), "2026-10-23T21:05:09.417+09:00", new_thread("카트 고치기"), "카트를 고쳐 줘");

        assert_eq!(created.id, "20261023-210509");
        assert_eq!(thread_dir(root.path(), &created.id).unwrap(), root.path().join("threads/20261023-210509"));
        assert_eq!(
            raw_thread_json(root.path(), &created.id),
            json!({
                "title": "카트 고치기",
                "createdAt": "2026-10-23T21:05:09.417+09:00",
                "work": null,
                "mode": "ask",
                "participants": [],
                "lastRead": 0,
            })
        );
        let lines = read_thread_records(root.path(), &created.id, 0).unwrap();
        assert_eq!(lines, vec![created.first.clone()]);
        assert_eq!(
            (lines[0].seq, lines[0].kind, &lines[0].who, &lines[0].payload),
            (1, RecordKind::Sent, &None, &json!({"text": "카트를 고쳐 줘"}))
        );
        assert_eq!(read_thread(root.path(), &created.id).unwrap().title, "카트 고치기");
    }

    /// S5 — **같은 초에 선 Thread는 `-2` · `-3`을 붙여 따로 선다.** 앞 Thread의 폴더와 기록은 그대로다.
    #[test]
    fn 같은_초에_선_thread는_뒤에_번호를_붙여_따로_선다() {
        let root = tempfile::tempdir().unwrap();
        let ids: Vec<String> = ["첫째", "둘째", "셋째"]
            .into_iter()
            .map(|text| create(root.path(), "2026-10-23T21:05:09.001+09:00", new_thread(text), text).id)
            .collect();

        assert_eq!(ids, ["20261023-210509", "20261023-210509-2", "20261023-210509-3"]);
        for (id, text) in ids.iter().zip(["첫째", "둘째", "셋째"]) {
            assert_eq!(read_thread(root.path(), id).unwrap().title, text);
            assert_eq!(read_thread_records(root.path(), id, 0).unwrap()[0].payload, json!({"text": text}));
        }
    }

    /// **다시 써도 이 판이 모르는 키는 남는다** — 다른 판의 앱이 더한 칸(Thread에도, 참여자에도)을 지우지 않는다. 바꾼 칸만
    /// 바뀌고 나머지는 글자 그대로다.
    #[test]
    fn 다시_써도_이_판이_모르는_키는_남는다() {
        let root = tempfile::tempdir().unwrap();
        let id = create(root.path(), "2026-10-23T21:05:09.000+09:00", new_thread("카트 고치기"), "카트를 고쳐 줘").id;
        let mut written = raw_thread_json(root.path(), &id);
        written["pinnedBy"] = json!("다음 판");
        written["participants"] = json!([{
            "handle": "host",
            "from": "library",
            "joinedAt": "2026-10-23T21:05:09.120+09:00",
            "runtime": "claude-code",
            "sessionId": "5f0c-host",
            "cwd": "/tmp/threads/20261023-210509",
            "additionalDirectories": [],
            "model": "opus",
            "effort": "high",
            "avatar": {"shape": "square"},
        }]);
        let path = root.path().join("threads").join(&id).join("thread.json");
        std::fs::write(&path, serde_json::to_string_pretty(&written).unwrap()).unwrap();

        let updated = update_thread(root.path(), &id, |thread| thread.last_read = 4).unwrap();

        assert_eq!(updated.participants[0].session_id.as_deref(), Some("5f0c-host"), "참여자 칸을 이 판이 읽는다");
        written["lastRead"] = json!(4);
        assert_eq!(raw_thread_json(root.path(), &id), written);
    }

    /// **반쯤 쓴 마지막 줄은 버린다**(three-axes와 같다). 앱이 줄을 쓰다 죽으면 끝에 줄바꿈 없는 꼬리가 남는다 — 읽기는 그것을
    /// 세지 않고, 다시 연 기록은 그 꼬리를 끊고 다음 seq로 이어 적는다. 끊긴 꼬리 때문에 이어 적은 줄이 읽히지 않으면 안 된다.
    #[test]
    fn 반쯤_쓴_마지막_줄은_버리고_다시_열면_다음_seq로_이어_적는다() {
        let root = tempfile::tempdir().unwrap();
        let created = create(root.path(), "2026-10-23T21:05:09.000+09:00", new_thread("카트 고치기"), "카트를 고쳐 줘");
        let mut log = created.log;
        log.append(RecordKind::Joined, Some("host"), json!({"from": "library"})).unwrap();
        drop(log);
        let events = root.path().join("threads").join(&created.id).join("events.jsonl");
        let mut text = std::fs::read_to_string(&events).unwrap();
        text.push_str(r#"{"seq":3,"at":"2026-10-23T21:05:10.000+09:00","kind":"update","who":"host","payload":{"sessionUp"#);
        std::fs::write(&events, text).unwrap();

        let seqs: Vec<u64> = read_thread_records(root.path(), &created.id, 0).unwrap().iter().map(|line| line.seq).collect();
        assert_eq!(seqs, [1, 2], "쓰다 끊긴 꼬리는 줄이 아니다");

        let mut log = open_thread_log(root.path(), &created.id).unwrap();
        assert_eq!(log.last_seq(), 2);
        let next = log.append(RecordKind::Sent, None, json!({"text": "다시 켠 뒤의 말"})).unwrap();
        assert_eq!(next.seq, 3);
        assert_eq!(read_thread_records(root.path(), &created.id, 2).unwrap(), vec![next], "이어 적은 줄이 꼬리에 붙지 않고 읽힌다");
    }

    /// S8 — **`who`는 참여자의 줄에만 선다.** 사람과 시스템의 줄에는 그 칸이 없다 — three-axes 줄과 같은 모양이다.
    #[test]
    fn 참여자의_줄에만_who가_선다() {
        let root = tempfile::tempdir().unwrap();
        let created = create(root.path(), "2026-10-23T21:05:09.000+09:00", new_thread("카트 고치기"), "카트를 고쳐 줘");
        let mut log = created.log;
        log.append(RecordKind::Update, Some("host"), json!({"sessionUpdate": "agent_message_chunk"})).unwrap();

        let events = std::fs::read_to_string(root.path().join("threads").join(&created.id).join("events.jsonl")).unwrap();
        let lines: Vec<Value> = events.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(lines[0].get("who"), None, "사람의 줄: {}", lines[0]);
        assert_eq!(lines[1]["who"], "host");
    }

    fn joined(handle: &str) -> Participant {
        Participant {
            handle: handle.to_owned(),
            from: Some(DefinitionSource::Library),
            joined_at: "2026-10-23T21:05:09.120+09:00".to_owned(),
            runtime: "claude-code".to_owned(),
            session_id: None,
            cwd: None,
            additional_directories: Vec::new(),
            model: None,
            effort: None,
            extra: Map::new(),
        }
    }

    fn linked(title: &str, work: &str) -> NewThread {
        NewThread { title: title.to_owned(), work: Some(work.to_owned()), mode: None, new_work: false }
    }

    fn ids<'a>(summaries: impl IntoIterator<Item = &'a ThreadSummary>) -> Vec<&'a str> {
        summaries.into_iter().map(|summary| summary.id.as_str()).collect()
    }

    /// 색인 — **모든 Thread의 요약(제목 · 시각 · work · 참여자 handle)을 새것부터 내고, Work slug로 찾는다.** 엔진은 시작할 때 한
    /// 번 읽고, 쓸 때마다 고친다 — 나중에 Work에 이은 Thread도 그 Work로 찾힌다.
    #[test]
    fn 색인은_모든_thread를_새것부터_요약하고_work로_찾는다() {
        let root = tempfile::tempdir().unwrap();
        assert!(ThreadIndex::load(root.path()).unwrap().all().is_empty());
        assert!(!root.path().join("threads").exists(), "읽기는 폴더를 만들지 않는다");

        let alone = create(root.path(), "2026-10-23T09:00:00.000+09:00", new_thread("혼자 묻기"), "이거 뭐야").id;
        let cart = create(root.path(), "2026-10-23T09:10:00.000+09:00", linked("카트 고치기", "cart"), "카트를 고쳐 줘").id;
        let billing = create(root.path(), "2026-10-23T09:20:00.000+09:00", linked("청구 정리", "billing"), "청구서").id;
        update_thread(root.path(), &cart, |thread| thread.participants = vec![joined("host"), joined("reviewer")]).unwrap();

        let mut index = ThreadIndex::load(root.path()).unwrap();
        let summary = |summary: &ThreadSummary| {
            (summary.id.clone(), summary.title.clone(), summary.created_at.clone(), summary.work.clone(), summary.handles.clone())
        };
        assert_eq!(
            index.all().iter().map(summary).collect::<Vec<_>>(),
            [
                (billing.clone(), "청구 정리".to_owned(), "2026-10-23T09:20:00.000+09:00".to_owned(), Some("billing".to_owned()), vec![]),
                (
                    cart.clone(),
                    "카트 고치기".to_owned(),
                    "2026-10-23T09:10:00.000+09:00".to_owned(),
                    Some("cart".to_owned()),
                    vec!["host".to_owned(), "reviewer".to_owned()]
                ),
                (alone.clone(), "혼자 묻기".to_owned(), "2026-10-23T09:00:00.000+09:00".to_owned(), None, vec![]),
            ]
        );
        assert_eq!(ids(index.of_work("cart")), [cart.as_str()]);
        assert!(index.of_work("nowhere").is_empty());

        let now_linked = update_thread(root.path(), &alone, |thread| thread.work = Some("cart".to_owned())).unwrap();
        index.put(&alone, &now_linked);
        assert_eq!(ids(index.of_work("cart")), [cart.as_str(), alone.as_str()], "새것부터다");
        assert_eq!(ids(index.all()), ids(ThreadIndex::load(root.path()).unwrap().all()), "고친 색인이 다시 읽은 색인과 같다");
    }

    /// 같은 초에 열 개가 넘게 서도 **붙인 번호의 크기로** 새것을 가린다 — 글자 순서면 `-10`이 `-2` 앞에 선다.
    #[test]
    fn 같은_초의_열째_thread도_번호_순서로_새것부터_선다() {
        let root = tempfile::tempdir().unwrap();
        for n in 1..=11 {
            create(root.path(), "2026-10-23T21:05:09.000+09:00", new_thread(&format!("{n}")), "말");
        }
        let index = ThreadIndex::load(root.path()).unwrap();
        let titles: Vec<&str> = index.all().iter().map(|summary| summary.title.as_str()).collect();
        assert_eq!(titles, ["11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"]);
    }

    /// 깨진 `thread.json` — **색인은 건너뛰지 않고 까닭과 함께 낸다**(Library의 깨진 Agent와 같은 쪽). 읽기는 파일을 한 글자도
    /// 건드리지 않는다. 다시 쓰는 길은 core의 「옆에 비켜 두기」(`keep_aside`)를 따른다 — 사람이 고치다 깨뜨린 원문을 벌로 떠 둔
    /// 뒤에 쓴다.
    #[test]
    fn 깨진_thread_json은_까닭과_함께_목록에_서고_다시_쓰기_전에_옆에_비켜_둔다() {
        let root = tempfile::tempdir().unwrap();
        let fine = create(root.path(), "2026-10-23T09:00:00.000+09:00", new_thread("멀쩡한 것"), "말").id;
        let broken = create(root.path(), "2026-10-23T09:10:00.000+09:00", new_thread("깨질 것"), "말").id;
        let dir = root.path().join("threads").join(&broken);
        let bytes = "{\"title\": \"카트 고치다 멈춤";
        std::fs::write(dir.join("thread.json"), bytes).unwrap();

        let index = ThreadIndex::load(root.path()).unwrap();
        assert_eq!(ids(index.all()), [broken.as_str(), fine.as_str()]);
        let reason = index.all()[0].broken.clone().expect("깨진 까닭이 선다");
        assert!(reason.starts_with("thread.json을 읽지 못했습니다"), "{reason}");
        assert_eq!(index.all()[1].broken, None);
        assert_eq!(std::fs::read_to_string(dir.join("thread.json")).unwrap(), bytes, "읽기는 파일을 고치지 않는다");
        assert!(!dir.join("thread.json.bak").exists(), "읽기는 벌을 뜨지 않는다");

        let rewritten = update_thread(root.path(), &broken, |thread| thread.last_read = 2).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("thread.json.bak")).unwrap(), bytes, "깨진 원문이 옆에 남는다");
        assert_eq!(read_thread(root.path(), &broken).unwrap(), rewritten);
        assert_eq!(rewritten.last_read, 2);
        assert_eq!(ThreadIndex::load(root.path()).unwrap().all()[0].broken, None);
    }

    fn seed_work(root: &Path, place: &str, slug: &str) {
        let dir = root.join(place).join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("work.json"), format!("{{\"slug\": \"{slug}\", \"title\": \"{slug}\"}}")).unwrap();
    }

    /// 「이은 Work가 진행 중이 아니면 그 까닭」(v1 구현 스펙 §4 · v1 티켓 38) — **보관됨은 works에 없고 archive에 있음, 지워짐은 어디에도
    /// 없음**이다. Thread 폴더는 옮기지 않으므로 이 판정이 Thread를 읽기만으로 둔다. 깨진 `work.json`도 진행 중인 Work다.
    #[test]
    fn 진행_중이_아닌_work는_보관됐거나_지워진_것이다() {
        let root = tempfile::tempdir().unwrap();
        seed_work(root.path(), "works", "live");
        seed_work(root.path(), "archive", "done");
        std::fs::create_dir_all(root.path().join("works/stale")).unwrap();
        seed_work(root.path(), "archive", "stale");
        std::fs::create_dir_all(root.path().join("works/torn")).unwrap();
        std::fs::write(root.path().join("works/torn/work.json"), "{\"title\": ").unwrap();

        assert_eq!(work_gone(root.path(), "live"), None);
        assert_eq!(work_gone(root.path(), "torn"), None, "깨진 work.json은 사람이 손보는 중일 수 있다 — 있는 Work다");
        assert_eq!(work_gone(root.path(), "done"), Some(WorkGone::Archived));
        assert_eq!(work_gone(root.path(), "stale"), Some(WorkGone::Archived), "work.json 없는 빈 폴더는 진행 중인 Work가 아니다");
        assert_eq!(work_gone(root.path(), "gone"), Some(WorkGone::Removed), "지워진 Work");
        assert_eq!(work_gone(root.path(), "../archive/done"), Some(WorkGone::Removed), "경로를 품은 slug는 어디에도 없다");
    }

    /// 요약은 **이은 Work가 보관됐거나 지워졌는지를 싣는다**(v1 티켓 38) — 읽기만 된 Thread는 사이드바에서 빠지고 ⌘K가 「보관됨」을 단다
    /// (S43). 보관이 Work 폴더를 옮겨도 `thread.json`은 그대로라 색인이 스스로 알지 못한다 — 엔진이 Work 목록이 바뀔 때 다시 보게 하고,
    /// 다시 보기는 바뀐 요약만 돌려준다.
    #[test]
    fn 요약은_이은_work가_보관되거나_지워졌는지를_싣고_다시_보면_바뀐_요약만_돌려준다() {
        let root = tempfile::tempdir().unwrap();
        seed_work(root.path(), "works", "cart");
        seed_work(root.path(), "works", "billing");
        let alone = create(root.path(), "2026-10-23T09:00:00.000+09:00", new_thread("혼자 묻기"), "이거 뭐야").id;
        let cart = create(root.path(), "2026-10-23T09:10:00.000+09:00", linked("카트 고치기", "cart"), "카트를 고쳐 줘").id;
        let billing = create(root.path(), "2026-10-23T09:20:00.000+09:00", linked("청구 정리", "billing"), "청구서").id;
        let mut index = ThreadIndex::load(root.path()).unwrap();
        let read_only = |index: &ThreadIndex| -> Vec<(String, Option<WorkGone>)> {
            index.all().iter().map(|summary| (summary.id.clone(), summary.read_only)).collect()
        };
        assert_eq!(read_only(&index), [(billing.clone(), None), (cart.clone(), None), (alone.clone(), None)]);
        assert!(index.recheck_works().is_empty(), "바뀐 Work가 없다");

        std::fs::create_dir_all(root.path().join("archive")).unwrap();
        std::fs::rename(root.path().join("works/cart"), root.path().join("archive/cart")).unwrap();
        std::fs::remove_dir_all(root.path().join("works/billing")).unwrap();
        let changed: Vec<(String, Option<WorkGone>)> =
            index.recheck_works().into_iter().map(|summary| (summary.id, summary.read_only)).collect();

        let now = [
            (billing.clone(), Some(WorkGone::Removed)),
            (cart.clone(), Some(WorkGone::Archived)),
            (alone.clone(), None),
        ];
        assert_eq!(changed, now[..2], "바뀐 요약만 새것부터");
        assert_eq!(read_only(&index), now);
        assert!(index.recheck_works().is_empty(), "한 번 본 것은 다시 내지 않는다");
        assert_eq!(read_only(&ThreadIndex::load(root.path()).unwrap()), now, "다시 읽은 색인도 같다");

        let linked_late = update_thread(root.path(), &alone, |thread| thread.work = Some("cart".to_owned())).unwrap();
        index.put(&alone, &linked_late);
        assert_eq!(read_only(&index)[2], (alone, Some(WorkGone::Archived)), "고쳐 쓴 줄도 그때 본다");
    }

    /// **경로를 품은 id는 `threads/` 밖을 가리키지 못한다** — id는 화면에서 명령 인자로 온다.
    #[test]
    fn 경로를_품은_thread_id는_거절한다() {
        let root = tempfile::tempdir().unwrap();
        seed_work(root.path(), "works", "cart");
        for id in ["../works/cart", "..", ".hidden", "a/b", "a\\b", ""] {
            assert!(matches!(thread_dir(root.path(), id), Err(crate::Error::Validation(_))), "{id:?}");
            assert!(read_thread(root.path(), id).is_err(), "{id:?}");
            assert!(open_thread_log(root.path(), id).is_err(), "{id:?}");
        }
        assert!(!root.path().join("works/events.jsonl").exists(), "밖에 기록 파일을 만들지 않았다");
    }
}
