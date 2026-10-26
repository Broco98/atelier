//! 기록 줄 — 덧붙이기만 하는 `.jsonl` 한 장의 줄 모양 · 쓰기 · 읽기(three-axes 결정 18 · v1 구현 스펙 §4 · S8).
//!
//! **Thread의 `events.jsonl`과 three-axes 대화 기록(`works/<slug>/agents/<id>.jsonl`)이 이 한 벌을 딛는다.** 줄 모양 · 줄
//! 종류 · 「반쪽 줄」 규칙이 두 곳으로 갈리면 한쪽이 적은 줄을 다른 쪽 읽기가 조용히 버린다. 대화 호스트(`atelier-acp`)가
//! 이 크레이트에 의존하므로 정본은 이쪽에 산다(v1 티켓 02).
//!
//! - 한 줄은 `{seq, at, kind, who?, payload}`이고 seq는 기록마다 1부터 는다. 줄 하나는 쓰기 한 번에 붙는다.
//! - 끝에 줄바꿈이 없는 꼬리는 쓰는 중이거나 쓰다 끊긴 줄이라 읽기가 버린다. 반쪽 줄은 끝에만 생긴다.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::Result;

/// 기록 줄 하나 — 파일에 적은 것과 이벤트로 나가는 것이 같은 값이다.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordLine {
    pub seq: u64,
    pub at: String,
    pub kind: RecordKind,
    /// 그 줄을 낸 참여자의 handle(v1 구현 스펙 S8). **사람과 시스템의 줄에는 칸이 없다** — three-axes 대화 기록은 이 칸 없이
    /// 적혀 축복한 기록(`tests/records/`)과 글자 하나 다르지 않다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub who: Option<String>,
    pub payload: Value,
}

/// 기록 줄의 종류 — **여기 한 곳에서 정한다**(v1 구현 스펙 §4 표). three-axes의 여덟에 v1의 아홉을 더했다. 이 판이 모르는
/// 종류의 줄은 읽기가 건너뛴다(다른 판의 앱이 적은 줄).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecordKind {
    /// 보낸 말 — 화면에 보일 글 · 인용(붙었으면) · 실제로 보낸 내용 블록(머리말 · 인용 블록 포함) · 지금 보내기였는지. Thread는
    /// 받는 Agent · 첨부 경로 · 넘긴 머리말과 지난 말을 함께 담는다.
    Sent,
    /// `session/update` 원문(턴 밖 것 포함).
    Update,
    /// 턴 끝 — stopReason · 걸린 시간 · 우리가 멈췄는지 · 턴 밖 턴인지.
    TurnEnd,
    /// 대화의 수명 — 띄우는 중 · 열림 · 계정 상태 · 로그인 필요 · 판 경고 · 죽음 · 닫힘.
    Session,
    /// 에이전트의 stderr 한 줄 — 화면에 그리지 않는다.
    Stderr,
    /// 고친 곳 — 턴 앞뒤로 spec 폴더를 견준 바뀐 파일들(three-axes 결정 22). 턴 끝 줄 바로 앞에 서고, 바뀐 것이
    /// 없는 턴에는 없다.
    Changes,
    /// 권한 — 요청 원문(물음), 그 뒤에 같은 요청 id로 답(고른 optionId)이나 거둬짐(까닭)이 한 줄 더 선다(three-axes 티켓 08).
    /// v1은 판정 결과(허용 · 거절 · 물음)와 그 까닭(Policy 이름)을 함께 담는다.
    Permission,
    /// 사람이 바꾼 것 — 바꾼 칸과 새 값(에이전트 · 모델 · 모드 · 계획).
    Config,
    /// Agent가 낸 질문과 답. Work 만들기 카드도 이 종류다.
    Question,
    /// 참여 — 참여자가 Thread에 들어왔다.
    Joined,
    /// 나감 — 참여자가 Thread에서 나갔다.
    Left,
    /// Work 연결 · worktree 생성 · Project 붙임.
    Work,
    /// Thread 이름 바꿈.
    Title,
    /// 물어보는 정도 바꿈.
    Mode,
    /// Agent 호출의 시작과 끝 — 부른 쪽 · 불린 쪽 · 맡긴 말 · 받은 말 · 걸린 시간 · 실패 까닭.
    Call,
    /// 이 Work의 PR이 처음 보였을 때와 상태가 바뀔 때.
    Pr,
    /// Library에 Agent를 저장함 — Agent가 Thread 도구 「Agent 저장」으로 둔 정의의 handle · 이름 · 얼굴 · 자리(v1 티켓 19). 시스템 줄
    /// 「Library에 리뷰어를 저장함」이 이것이다.
    Library,
    /// Space가 붙음 · 바뀜 · 빠짐(03 구현 스펙 §9) — 갈래(`change`)와 Space, 그 뒤로 읽는 Project. 흐름의 회색 한 줄 「Space를 사내 도구로
    /// 바꿨어요 — 다음 차례부터 api-server · backoffice를 읽어요」가 이것이다. Work의 Space가 바뀌면 그 Work의 Thread마다 선다(S9).
    Space,
    /// Agent가 대화로 한 설정(03 구현 스펙 §12) — 무엇을 했나(Project 추가 · Project 고침 · Space 만듦 · Space 고침) · 대상 slug · 이름과
    /// 카드의 첫 줄 · 둘째 줄 글. 흐름의 결과 카드 「Project를 추가했어요 — landing-page · 열기」가 이것이다.
    Setting,
}

/// 기록 파일 하나를 덧붙이기로 연 것. 열려 있는 동안 파일을 쥐고 있다 — 폴더가 같은 볼륨 안에서 옮겨져도(아카이브의
/// rename) 같은 파일에 이어 적힌다(three-axes S10).
///
/// **잠그지 않는다.** 줄의 순서가 이벤트의 순서여야 하는 쪽(대화 호스트)이 이것을 뮤텍스에 넣고, 쥔 채 적고 내보낸다.
pub struct RecordLog {
    file: File,
    last_seq: u64,
}

impl RecordLog {
    /// 기록 파일을 이어 쓰도록 연다. **파일은 만들어도 폴더는 만들지 않는다** — 사라진 폴더를 되살리지 않는다.
    ///
    /// 끝에 반쪽 줄(쓰다 끊긴 줄)이 남아 있으면 줄바꿈 하나로 먼저 끊는다 — 그러지 않으면 이어 적는 첫 줄이 그 꼬리에 붙어
    /// 읽히지 않는 줄이 된다. 끊긴 꼬리는 원문 그대로 남고, 읽기가 JSON이 아닌 줄로 건너뛴다.
    pub fn open(path: &Path) -> Result<Self> {
        let last_seq = std::fs::read_to_string(path).map(|text| last_record_seq(&text)).unwrap_or(0);
        let mut file = OpenOptions::new().create(true).append(true).open(path)?;
        if ends_mid_line(path) {
            file.write_all(b"\n")?;
        }
        Ok(Self { file, last_seq })
    }

    /// 마지막으로 적은 줄의 seq. 없으면 0이다.
    pub fn last_seq(&self) -> u64 {
        self.last_seq
    }

    /// 한 줄을 적고 그 줄을 돌려준다 — 부르는 쪽이 같은 값을 이벤트로 내보낸다. `who`는 참여자의 줄에만 준다(S8).
    pub fn append(&mut self, kind: RecordKind, who: Option<&str>, payload: Value) -> Result<RecordLine> {
        let line = RecordLine { seq: self.last_seq + 1, at: record_time(), kind, who: who.map(str::to_owned), payload };
        let mut text = serde_json::to_string(&line).expect("기록 줄은 JSON이다");
        text.push('\n');
        // 한 번의 쓰기로 줄 전체를 붙인다 — 반쪽 줄은 끝에만 생길 수 있고, 읽기가 그것을 버린다.
        self.file.write_all(text.as_bytes())?;
        self.last_seq = line.seq;
        Ok(line)
    }
}

/// 기록 파일에서 `after` 다음 seq의 줄들. 파일이 없으면 `NotFound`다.
///
/// - 끝에 줄바꿈이 없는 꼬리는 버린다 — 쓰는 중인 줄이거나 쓰다 끊긴 줄이다.
/// - 읽을 수 없는 줄(이 판이 모르는 kind 등)은 건너뛴다 — 한 줄 때문에 기록 전체가 그려지지 않으면 안 된다.
pub fn read_records(path: &Path, after: u64) -> std::io::Result<Vec<RecordLine>> {
    let text = std::fs::read_to_string(path)?;
    Ok(complete_lines(&text)
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| match serde_json::from_str::<RecordLine>(line) {
            Ok(record) => Some(record),
            Err(error) => {
                eprintln!("기록 줄을 읽지 못해 건너뜁니다: {} — {error}", path.display());
                None
            }
        })
        .filter(|record| record.seq > after)
        .collect())
}

/// 한 번 읽은 기록 글의 줄들 — [`read_records`]와 같은 규칙이되 읽지 못한 줄을 알리지 않는다. 기록을 글로 한 번 읽어 여러 사실을
/// 묻는 쪽(대화 호스트의 `RecordFacts`)이 쓴다.
pub fn parse_records(text: &str) -> impl DoubleEndedIterator<Item = RecordLine> + '_ {
    complete_lines(text).filter_map(|line| serde_json::from_str(line).ok())
}

/// 줄바꿈으로 끝난 줄들 — 끝의 반쪽 줄은 뺀다.
fn complete_lines(text: &str) -> std::str::Lines<'_> {
    match text.rfind('\n') {
        Some(end) => text[..end].lines(),
        None => "".lines(),
    }
}

/// 마지막으로 적힌 줄의 seq. 없으면 0이다. **이 판이 모르는 kind의 줄도 센다** — 이어 적는 줄이 그 seq를 다시 쓰지 않게.
pub fn last_record_seq(text: &str) -> u64 {
    complete_lines(text)
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line).ok()?["seq"].as_u64())
        .unwrap_or(0)
}

/// 기록 파일이 반쪽 줄로 끝나나 — 비어 있지 않은데 끝 바이트가 줄바꿈이 아니다. 없거나 읽지 못하면 아니다.
fn ends_mid_line(path: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut file) = File::open(path) else { return false };
    let mut last = [0u8; 1];
    file.seek(SeekFrom::End(-1)).is_ok() && file.read_exact(&mut last).is_ok() && last[0] != b'\n'
}

/// 기록의 시각 — 로컬 시각대의 RFC 3339, 밀리초까지.
pub fn record_time() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false)
}
