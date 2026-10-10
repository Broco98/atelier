//! 대화 호스트 — 대화창의 몸통. 앱은 이것 하나를 managed state로 쥐고 명령을 위임한다.
//!
//! 이 장(three-axes 티켓 02)이 세운 것은 뼈대와 「엔진 확인」 하나다. 대화 목록 · 새 대화 · 닫기(03) ·
//! 보내기(04) · 앱 잇기(05) · 로그인(12)이 이 위에 선다.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use crate::discovery::{self, Agent, EngineCheck};
use crate::login_env::{self, AgentEnv, LoginShellError, ShellSource};

/// 호스트가 내보내는 것. 기록 줄(03) · 대기 줄 바뀜(07) · 엔진 상태(12)가 차례로 선다 — 이 장에서는
/// 아직 내보낼 것이 없다.
#[derive(Debug, Clone, PartialEq)]
pub enum HostEvent {}

/// 변환기 명령 — Claude 대화가 띄우는 ACP 에이전트. 앱에서는 `current_exe` + `acp-claude`, 검사에서는
/// 변환기 시험 bin이다. `current_exe`는 진입점에서만 읽어 넘긴다(워크플로 §1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranslatorCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
}

impl TranslatorCommand {
    pub fn new(program: impl Into<PathBuf>, args: impl IntoIterator<Item = impl Into<OsString>>) -> Self {
        Self { program: program.into(), args: args.into_iter().map(Into::into).collect() }
    }
}

type Emit = Box<dyn Fn(HostEvent) + Send + Sync>;

/// 대화 호스트를 짓는다. 넷은 꼭 받고(데이터 루트 · 변환기 명령 · 셸 경로의 원천 · 이벤트를 내보내는
/// closure), 시간 한도는 검사가 줄일 수 있다.
pub struct HostBuilder {
    data_root: PathBuf,
    translator: TranslatorCommand,
    shell: ShellSource,
    emit: Emit,
    login_shell_limit: Duration,
}

impl HostBuilder {
    /// 로그인 셸 읽기의 한도. 기본은 10초다(워크플로 §10) — 검사에서는 줄여도 된다.
    pub fn login_shell_limit(mut self, limit: Duration) -> Self {
        self.login_shell_limit = limit;
        self
    }

    pub fn build(self) -> ConversationHost {
        ConversationHost {
            data_root: self.data_root,
            translator: self.translator,
            shell: self.shell,
            emit: self.emit,
            login_shell_limit: self.login_shell_limit,
            login_env: Mutex::new(None),
        }
    }
}

pub struct ConversationHost {
    #[expect(dead_code, reason = "기록(`agents/`)을 03이 이 아래에 쓴다")]
    data_root: PathBuf,
    #[expect(dead_code, reason = "Claude 대화를 13이 이것으로 띄운다")]
    translator: TranslatorCommand,
    shell: ShellSource,
    #[expect(dead_code, reason = "기록 줄 이벤트를 03이 내보낸다")]
    emit: Emit,
    login_shell_limit: Duration,
    /// S7 — 로그인 env는 호스트가 도는 동안 한 번 읽어 메모리에 쥔다. 「다시 확인」만 다시 읽는다.
    /// 기록하지 않는다 — 비밀이 `agents/`에 남지 않게(워크플로 S37).
    ///
    /// 읽는 동안 잠금을 쥔다. 두 엔진 확인이 함께 와도 셸은 한 번만 뜨고, 뒤의 것이 앞의 결과를 쓴다.
    login_env: Mutex<Option<AgentEnv>>,
}

impl ConversationHost {
    pub fn builder(
        data_root: PathBuf,
        translator: TranslatorCommand,
        shell: ShellSource,
        emit: impl Fn(HostEvent) + Send + Sync + 'static,
    ) -> HostBuilder {
        HostBuilder {
            data_root,
            translator,
            shell,
            emit: Box::new(emit),
            login_shell_limit: login_env::DEFAULT_LIMIT,
        }
    }

    /// 엔진 확인 — 그 에이전트를 띄우는 데 드는 실행 파일을 로그인 셸의 PATH에서 찾는다.
    /// `reread`는 안내 카드의 「다시 확인」이다. 설치한 뒤 앱을 다시 켜지 않고 이어 가도록 로그인 env를
    /// 새로 읽는다.
    ///
    /// 막히는 호출이다 — 로그인 env를 아직 쥐지 않았으면 셸을 띄워 기다린다(한도 10초).
    pub fn check_engine(&self, agent: Agent, reread: bool) -> Result<EngineCheck, LoginShellError> {
        let env = self.login_env(reread)?;
        Ok(discovery::look_up(agent, env.path()))
    }

    /// 쥔 로그인 env. 없거나 다시 읽으라면 셸을 띄워 읽는다. 다시 읽기가 실패하면 쥔 것도 버린다 —
    /// 사람이 방금 본 실패와 다음 확인의 답이 어긋나지 않게.
    fn login_env(&self, reread: bool) -> Result<AgentEnv, LoginShellError> {
        let mut held = self.login_env.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if reread {
            *held = None;
        }
        if let Some(env) = held.as_ref() {
            return Ok(env.clone());
        }
        let env = AgentEnv::from_login(login_env::read(&self.shell, self.login_shell_limit)?);
        *held = Some(env.clone());
        Ok(env)
    }
}
