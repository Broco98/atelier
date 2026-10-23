//! 아틀리에의 ACP 코어 — Thread의 참여자(Agent)마다 Session 하나를 세운다(v1 구현 스펙 §3). three-axes의 Work 안
//! 대화창이 지은 코어를 Thread가 이어 쓴다(three-axes 결정 12 · v1 티켓 08).
//!
//! 앱 명령은 [`ConversationHost`] 하나만 부른다. 그 아래의 런타임 · 변환기 · 찾기는 호스트가 감춘다.

mod attachments;
mod discovery;
mod host;
mod life;
mod login;
mod login_env;
mod past;
mod policy;
mod process;
mod quote;
mod records;
mod redact;
mod runtime;
mod thread_tools;
mod translator;

pub use discovery::{Agent, EngineCheck, FoundProgram, MissingProgram};
pub use host::{
    ConversationHost, HostBuilder, HostError, HostEvent, QuestionReply, QueuedMessage, QuitCounts, Reply, StartPicks,
    ThreadLink, ThreadView, TranslatorCommand, WorkChoice,
};
pub use login::{EngineState, LoginProgress};
pub use policy::AskLevel;
pub use login_env::{LoginShellError, ShellSource};
pub use quote::Quote;
pub use runtime::QuestionAnswer;
pub use records::{RecordKind, RecordLine};
pub use thread_tools::{run_thread_tools, THREAD_TOOLS_MODE};
pub use translator::{run_claude_translator, CLAUDE_TRANSLATOR_MODE};
