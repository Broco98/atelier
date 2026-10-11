//! 아틀리에의 ACP 코어 — 대화창(판 02)이 짓고, 구현 축의 엔진이 나중에 같은 코어를 쓴다
//! (three-axes 결정 12).
//!
//! 앱 명령은 [`ConversationHost`] 하나만 부른다. 그 아래의 런타임 · 변환기 · 찾기는 호스트가 감춘다.

mod chat_settings;
mod discovery;
mod engines;
mod host;
mod life;
mod login;
mod login_env;
mod process;
mod quote;
mod records;
mod redact;
mod runtime;
mod spec_changes;
mod translator;

pub use discovery::{Agent, EngineCheck, FoundProgram, MissingProgram};
pub use engines::EngineLists;
pub use host::{
    Conversation, ConversationDefaults, ConversationHost, HostBuilder, HostError, HostEvent, QueuedMessage, QuitCounts,
    TranslatorCommand,
};
pub use login::{EngineState, LoginProgress};
pub use login_env::{LoginShellError, ShellSource};
pub use quote::Quote;
pub use records::{RecordKind, RecordLine};
pub use translator::run_claude_translator;
