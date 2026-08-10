//! ACP 프로토콜·프로세스 층. spawn, JSON-RPC, 세션 수명, 어댑터 설정 읽기가 여기 있다.
//!
//! 의존 방향은 `src-tauri` → `atelier-acp` → `atelier-core`이고 **역방향은 없다.**

mod adapter;
mod envelope;
mod manager;

pub use adapter::{codex_command, CODEX, DEFAULT_CODEX_COMMAND};
pub use manager::{Listener, SessionManager, SessionPaths, SessionView};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// 무엇을 실행하려다 실패했는지 사용자가 읽을 수 있어야 한다 — 커맨드를 언제나 함께 싣는다.
    #[error("cannot start agent '{command}': {message}")]
    AgentStart { command: String, message: String },
    #[error("start point folder is missing: {0}")]
    StartPointMissing(String),
    /// 살아있지 않은 세션에 말을 걸었다. 다시 띄우는 것은 `resume`이 한다.
    #[error("session is not running: {0}")]
    NotRunning(String),
    #[error("prompt failed: {0}")]
    Prompt(String),
    /// 그 카드로는 답할 수 없다 — 이미 답했거나, 에이전트가 주지 않은 선택지다.
    #[error("session {session} has no permission request '{request}' waiting for option '{option}'")]
    NoSuchPermission {
        session: String,
        request: String,
        option: String,
    },
    /// 앱이 닫히는 도중에 세션이 다 떴을 때. 그 자식은 거두고 사용자에게는 서지 않았다고 말한다.
    #[error("atelier is closing")]
    Closing,
    #[error(transparent)]
    Core(#[from] atelier_core::Error),
}

impl Error {
    fn agent_start(command: &str, source: &dyn std::fmt::Display) -> Self {
        Error::AgentStart {
            command: command.to_string(),
            message: source.to_string(),
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use agent_client_protocol::{Agent, ConnectionTo};

    /// 살아있는 클라이언트 연결을 스레드 너머로 쥘 수 있는가 — 이 판이 태워야 했던 미지수다.
    /// 이 함수가 컴파일된다는 사실 자체가 답이고, 세션 매니저가 그 위에 선다.
    #[test]
    fn live_connection_can_be_shared_across_threads() {
        fn assert_shared<T: Send + Sync + Clone + 'static>() {}
        assert_shared::<ConnectionTo<Agent>>();
    }
}
