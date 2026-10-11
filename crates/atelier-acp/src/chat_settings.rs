//! 설정 「대화」 묶음(three-axes 결정 16 · 티켓 25) — 데이터 루트의 `settings.json`에서 `chat` 구획의 새 대화 기본값만 읽는다.
//!
//! ```json
//! "chat": {
//!   "defaultAgent": "codex",
//!   "claude": { "model": "sonnet", "mode": "acceptEdits" },
//!   "codex": { "model": "gpt-6-astra", "mode": "workspace-write" }
//! }
//! ```
//!
//! - **「엔진 기본값」은 키가 없는 것이다.** 그 칸은 비워 둔다 — Claude는 `--model` · `--permission-mode`를 받지 않고, Codex는
//!   `set_*`를 받지 않는다. 기본 에이전트(`defaultAgent`)는 `+`를 누른 화면이 읽어 새 대화 명령에 싣는다 — 여기서 읽지 않는다.
//! - **읽기만 한다.** 설정 파일의 정본과 쓰기는 앱 크레이트(`src-tauri/src/settings.rs`)이고, 그쪽이 모르는 키를 남긴다.
//!   호스트는 이 파일을 절대 쓰지 않는다.
//! - **새 대화를 만들 때마다 다시 읽는다.** 그래서 설정을 바꾸면 다음 `+`부터 들고, 이미 열린 대화의 `agents.json`은 그대로다
//!   (스토리 113).
//! - **깨졌으면 엔진 기본값으로 눕는다.** 손으로 고치다 깨진 파일이 대화를 막지 않는다 — 까닭은 앱의 stderr에만 남긴다.
//!   글자가 아닌 값과 빈 글자도 「엔진 기본값」으로 읽는다.

use std::path::Path;

use serde_json::Value;

use crate::discovery::Agent;
use crate::host::ConversationDefaults;

/// 앱 설정 파일의 이름 — 앱 크레이트의 `settings_path`와 같은 자리(데이터 루트 바로 아래)다.
const SETTINGS_FILE: &str = "settings.json";

/// 그 엔진의 새 대화 기본값(모델 · 모드). 파일이 없거나 그 엔진의 칸이 없으면 둘 다 비어 있다(엔진 기본값).
pub(crate) fn conversation_defaults(data_root: &Path, agent: Agent) -> ConversationDefaults {
    let Some(chat) = read_chat(data_root) else { return ConversationDefaults::default() };
    let engine = &chat[agent.key()];
    ConversationDefaults { model: chosen(&engine["model"]), mode: chosen(&engine["mode"]) }
}

/// `chat` 구획. 파일이 없으면 조용히, 깨졌으면 stderr에 까닭을 남기고 `None`이다.
fn read_chat(data_root: &Path) -> Option<Value> {
    let path = data_root.join(SETTINGS_FILE);
    let text = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<Value>(&text) {
        Ok(mut settings) => Some(settings.get_mut("chat")?.take()),
        Err(error) => {
            eprintln!("설정 파일이 깨져 새 대화를 엔진 기본값으로 엽니다: {} — {error}", path.display());
            None
        }
    }
}

/// 고른 값 — 비지 않은 글자만이다. 그 밖은 「엔진 기본값」이다.
fn chosen(value: &Value) -> Option<String> {
    value.as_str().filter(|text| !text.trim().is_empty()).map(str::to_owned)
}

