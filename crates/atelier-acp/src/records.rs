//! 기록 — work 폴더의 `agents/`(three-axes 결정 18).
//!
//! - `agents.json` — 대화 목록. 닫은 대화도 줄을 남긴다(S14). tmp + rename으로 쓰고, **폴더를 만들지 않는다** —
//!   사라진 work 폴더를 되살리지 않는다(S10).
//! - `<id>.jsonl` — 대화 하나의 기록. 한 줄이 `{seq, at, kind, payload}`이고 seq는 대화마다 1부터 는다. 적은 줄은
//!   같은 모양의 「기록 줄」 이벤트로도 나간다 — 화면은 대화를 이것 하나로 그린다.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::discovery::Agent;
use crate::host::{Emit, HostEvent};

const AGENTS_FILE: &str = "agents.json";

/// `agents.json`의 대화 한 줄.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConversationRow {
    pub id: String,
    pub agent: Agent,
    pub name: String,
    /// 에이전트가 일하는 폴더. 대화를 만들 때 정해 되살릴 때도 그대로 쓴다(three-axes 결정 17).
    pub cwd: PathBuf,
    /// cwd와 함께 여는 폴더 — spec 폴더이거나 비었다.
    #[serde(default)]
    pub additional_directories: Vec<PathBuf>,
    pub agent_session_id: Option<String>,
    /// 모델 · 모드 · 계획. 비어 있으면 엔진 기본값이다(three-axes 결정 16).
    pub model: Option<String>,
    pub mode: Option<String>,
    pub plan: Option<bool>,
    pub created_at: String,
    pub closed_at: Option<String>,
    /// 모르는 칸은 다시 써도 남는다 — 다른 판의 앱이 더한 칸을 지우지 않게.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Default, Serialize, Deserialize)]
struct AgentsFile {
    #[serde(default)]
    conversations: Vec<ConversationRow>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

/// 기록을 읽거나 쓰지 못한 까닭 — 사람이 읽을 글이다.
pub(crate) type RecordError = String;

/// `agents.json`의 줄들. 폴더나 파일이 없으면 빈 목록이다. 깨진 파일은 오류다 — 그 위에 다시 쓰면 사람의
/// 손질을 덮는다.
pub(crate) fn read_rows(agents_dir: &Path) -> Result<Vec<ConversationRow>, RecordError> {
    Ok(read_agents_file(agents_dir)?.conversations)
}

fn read_agents_file(agents_dir: &Path) -> Result<AgentsFile, RecordError> {
    let path = agents_dir.join(AGENTS_FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text)
            .map_err(|error| format!("대화 목록을 읽지 못했습니다: {} — {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(AgentsFile::default()),
        Err(error) => Err(format!("대화 목록을 읽지 못했습니다: {} — {error}", path.display())),
    }
}

/// 그 줄을 `agents.json`에 넣는다 — 같은 id의 줄은 바꾸고, 없으면 끝에 더한다. 다른 줄은 그대로 둔다.
///
/// 읽고 고쳐 쓰는 사이를 부르는 쪽이 잠근다(호스트의 `agents` 잠금).
pub(crate) fn write_row(agents_dir: &Path, row: &ConversationRow) -> Result<(), RecordError> {
    let mut file = read_agents_file(agents_dir)?;
    match file.conversations.iter_mut().find(|existing| existing.id == row.id) {
        Some(existing) => *existing = row.clone(),
        None => file.conversations.push(row.clone()),
    }
    atelier_core::write_json_into_existing_dir(agents_dir, AGENTS_FILE, &file, "대화 목록을")
        .map_err(|error| format!("대화 목록을 쓰지 못했습니다: {} — {error}", agents_dir.join(AGENTS_FILE).display()))
}

/// `agents/` 폴더를 만든다. **부모(work 폴더)는 만들지 않는다** — 부르는 쪽이 `work.json`을 본 뒤에 부른다.
pub(crate) fn ensure_agents_dir(agents_dir: &Path) -> Result<(), RecordError> {
    match std::fs::create_dir(agents_dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(format!("기록 폴더를 만들지 못했습니다: {} — {error}", agents_dir.display())),
    }
}

/// 대화 기록 파일의 자리.
pub(crate) fn record_path(agents_dir: &Path, conversation: &str) -> PathBuf {
    agents_dir.join(format!("{conversation}.jsonl"))
}

/// 기록 파일의 마지막 seq. 없으면 0이다. 끝에 줄바꿈이 없는 꼬리(반쪽 줄)는 세지 않는다.
pub(crate) fn last_seq(path: &Path) -> u64 {
    let Ok(text) = std::fs::read_to_string(path) else { return 0 };
    let complete = match text.rfind('\n') {
        Some(end) => &text[..end],
        None => return 0,
    };
    complete
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line).ok()?["seq"].as_u64())
        .unwrap_or(0)
}

/// 기록 줄 하나 — 파일에 적은 것과 이벤트로 나가는 것이 같은 값이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordLine {
    pub seq: u64,
    pub at: String,
    pub kind: RecordKind,
    pub payload: Value,
}

/// 기록 줄의 종류. 말 보내기(04) · 권한(08) · 고친 곳(06) · 설정(09)이 차례로 더한다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecordKind {
    /// 대화의 수명 — 띄우는 중 · 열림 · 판 경고 · 죽음 · 닫힘.
    Session,
}

/// `session` 줄의 payload. `state`로 가른다.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub(crate) enum SessionState {
    /// 띄우는 중 — 프로세스를 띄우기 직전.
    Spawning,
    /// 열림 — 어떻게 열렸나(`new`) · 에이전트 판 · 엔진이 준 모드 · 모델 · configOptions 원문.
    Opened { how: &'static str, agent_version: Option<String>, modes: Value, models: Value, config_options: Value },
    /// 판 경고 — 잰 적 없는 메이저 판이다. 대화는 그대로 연다(S6).
    VersionWarning { agent_version: Option<String>, supported_major: u64 },
    /// 죽음 — 에이전트가 없어졌다. 다음 말에서 다시 띄운다(10).
    Died { reason: String },
    /// 닫힘 — 사람이 닫았다. 기록 파일은 남는다.
    Closed,
}

/// 대화 하나의 기록 파일. 대화가 열려 있는 동안 파일을 연 채로 둔다 — work 폴더가 아카이브로 옮겨져도
/// (같은 볼륨 안의 rename) 같은 파일에 이어 적힌다(S10).
pub(crate) struct Recorder {
    work: String,
    conversation: String,
    emit: Arc<Emit>,
    file: Mutex<RecordFile>,
}

struct RecordFile {
    file: File,
    last_seq: u64,
}

impl Recorder {
    /// 기록 파일을 이어 쓰도록 연다. 파일은 만들어도 폴더는 만들지 않는다.
    pub(crate) fn open(agents_dir: &Path, work: &str, conversation: &str, emit: Arc<Emit>) -> Result<Self, RecordError> {
        let path = record_path(agents_dir, conversation);
        let last_seq = last_seq(&path);
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| format!("기록 파일을 열지 못했습니다: {} — {error}", path.display()))?;
        Ok(Self {
            work: work.to_owned(),
            conversation: conversation.to_owned(),
            emit,
            file: Mutex::new(RecordFile { file, last_seq }),
        })
    }

    /// 마지막으로 적은 줄의 seq.
    pub(crate) fn last_seq(&self) -> u64 {
        self.file.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).last_seq
    }

    pub(crate) fn session(&self, state: SessionState) -> Result<(), RecordError> {
        self.write(RecordKind::Session, serde_json::to_value(state).expect("session 줄은 JSON이다"))
    }

    /// 한 줄을 적고, 같은 줄을 기록 줄 이벤트로 내보낸다. 잠금을 쥔 채 내보낸다 — 이벤트의 순서가 seq의
    /// 순서다. **그래서 이벤트를 받는 closure는 호스트를 다시 부르면 안 된다.**
    fn write(&self, kind: RecordKind, payload: Value) -> Result<(), RecordError> {
        let mut record = self.file.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let line = RecordLine { seq: record.last_seq + 1, at: now(), kind, payload };
        let mut text = serde_json::to_string(&line).expect("기록 줄은 JSON이다");
        text.push('\n');
        // 한 번의 쓰기로 줄 전체를 붙인다 — 반쪽 줄은 끝에만 생길 수 있고, 읽기가 그것을 버린다.
        record
            .file
            .write_all(text.as_bytes())
            .map_err(|error| format!("기록을 쓰지 못했습니다: {} — {error}", self.conversation))?;
        record.last_seq = line.seq;
        (self.emit)(HostEvent::Record { work: self.work.clone(), conversation: self.conversation.clone(), line });
        Ok(())
    }
}

/// 기록의 시각 — 로컬 시각대의 RFC 3339, 밀리초까지.
pub(crate) fn now() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false)
}
