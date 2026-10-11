//! 엔진 목록 파일(S16) — 엔진마다 마지막으로 본 모델 · 모드 목록. 데이터 루트 바로 아래 `engines.json`에 둔다.
//!
//! 세션이 열릴 때마다 그 엔진의 몫을 덮어 쓴다. 설정 「대화」 쪽(25)이 에이전트를 띄우지 않고 이것으로 새 대화의 기본값
//! 목록을 보인다. 세션을 한 번도 연 적 없는 엔진은 빈 목록이다 — 「엔진 기본값」만 고를 수 있다.
//!
//! - 데이터 루트 꼭대기라 감시 밖이다 — `works/` · `layouts/` 아래에 두지 않는다(감시 제외 규칙과 work 목록에 걸린다).
//! - 다시 지을 수 있는 사본이라 깨졌으면 빈 목록으로 읽고, 다음에 열린 세션이 새로 쓴다.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::discovery::Agent;

const ENGINES_FILE: &str = "engines.json";

/// 한 엔진의 목록 — 「엔진 목록」 명령의 답이다. 항목은 엔진이 준 원문 그대로다.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct EngineLists {
    /// 모델 — `session/new` 답의 configOptions 가운데 id `model`의 선택지(`{value, name, description?}`). Claude도 같은
    /// 모양으로 낸다(S1).
    #[serde(default)]
    pub models: Vec<Value>,
    /// 모드 — `session/new` 답의 `modes.availableModes`(`{id, name, description?}`).
    #[serde(default)]
    pub modes: Vec<Value>,
}

impl EngineLists {
    /// 열린 세션(`session/new`의 답)에서 목록을 뽑는다. 없는 칸은 빈 목록이다.
    pub(crate) fn of_session(session: &Value) -> Self {
        let models = session["configOptions"]
            .as_array()
            .and_then(|options| options.iter().find(|option| option["id"] == "model"))
            .and_then(|model| model["options"].as_array())
            .cloned()
            .unwrap_or_default();
        let modes = session["modes"]["availableModes"].as_array().cloned().unwrap_or_default();
        Self { models, modes }
    }
}

/// 그 엔진의 목록. 파일이 없거나 그 엔진의 몫이 없으면 빈 목록이다. 깨진 파일도 빈 목록으로 읽는다 — 다음에 열린 세션이
/// 새로 쓴다.
pub(crate) fn read(data_root: &Path, agent: Agent) -> EngineLists {
    read_file(data_root)
        .get(key(agent))
        .and_then(|lists| serde_json::from_value(lists.clone()).ok())
        .unwrap_or_default()
}

/// 그 엔진의 몫을 덮어 쓴다. 다른 엔진의 몫과 모르는 칸은 그대로 둔다. 데이터 루트를 만들지 않는다. 읽고 고쳐 쓰는 사이를
/// 부르는 쪽이 잠근다(호스트의 `engines_file` 잠금).
pub(crate) fn write(data_root: &Path, agent: Agent, lists: &EngineLists) -> Result<(), String> {
    let mut file = read_file(data_root);
    file.insert(key(agent).to_owned(), serde_json::to_value(lists).expect("엔진 목록은 JSON이다"));
    atelier_core::write_json_into_existing_dir(data_root, ENGINES_FILE, &file, "엔진 목록을")
        .map_err(|error| format!("엔진 목록을 쓰지 못했습니다: {} — {error}", data_root.join(ENGINES_FILE).display()))
}

fn read_file(data_root: &Path) -> Map<String, Value> {
    let path = data_root.join(ENGINES_FILE);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|error| {
            eprintln!("엔진 목록이 깨져 빈 목록으로 읽습니다: {} — {error}", path.display());
            Map::new()
        }),
        Err(_) => Map::new(),
    }
}

/// 파일 안에서 그 엔진의 칸 이름 — 기록과 화면이 쓰는 에이전트 글자 그대로다.
fn key(agent: Agent) -> &'static str {
    match agent {
        Agent::Claude => "claude",
        Agent::Codex => "codex",
    }
}
