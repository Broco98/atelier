//! 대화 호스트 — 대화창의 몸통. 앱은 이것 하나를 managed state로 쥐고 명령을 위임한다.
//!
//! 엔진 확인(three-axes 티켓 02) 위에 대화 목록 · 새 대화 · 대화 닫기 · 호스트 끄기(03), 보내기 · 기록 읽기(04),
//! 사라진 work의 대화 끄기(11)가 선다. 앱 잇기(05) · 로그인(12)이 이 위에 선다.
//!
//! 대화 하나 = 에이전트 프로세스 하나 · 에이전트 쪽 세션 하나 · 기록 파일 하나다. 동시 개수 상한은 없다
//! (three-axes 결정 19).

use std::collections::{BTreeMap, HashMap};
use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::discovery::{self, Agent, EngineCheck, MissingProgram};
use crate::login_env::{self, AgentEnv, LoginShellError, ShellSource};
use crate::records::{self, CloseCause, ConversationRow, RecordLine, Recorder, SessionState, TurnEndLine};
use crate::runtime::{self, AgentProcess, Launch, RuntimeEvent, SessionPlace, Sink};

/// 판 02가 잰 codex-acp의 메이저 판(S6). 다르면 판 경고 줄을 남기고 계속한다.
const CODEX_ACP_MAJOR: u64 = 2;

/// 세션 열기(띄우기 → initialize → `session/new`)의 기본 한도. ACP가 아닌 명령이 말없이 살아 있어도 새 대화가
/// 끝없이 막히지 않게 한다. 진짜 codex-acp는 1초 안팎에 연다(실측 A1).
const DEFAULT_OPEN_LIMIT: Duration = Duration::from_secs(30);

/// 호스트가 내보내는 것. 대기 줄 바뀜(07) · 엔진 상태(12)가 이어 선다.
#[derive(Debug, Clone, PartialEq)]
pub enum HostEvent {
    /// 기록 줄 — 기록 파일에 적은 것과 같은 줄이다. 화면은 대화를 이것 하나로 그린다.
    Record { work: String, conversation: String, line: RecordLine },
}

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

/// 이벤트를 내보내는 closure. 기록 줄은 기록의 잠금을 쥔 채 내보내므로 **이 안에서 호스트를 다시 부르지
/// 않는다** — 받은 값을 밖으로 넘기는 것까지가 이 자리의 일이다(앱에서는 화면으로 emit한다).
pub(crate) type Emit = dyn Fn(HostEvent) + Send + Sync;

/// 대화 호스트를 짓는다. 넷은 꼭 받고(데이터 루트 · 변환기 명령 · 셸 경로의 원천 · 이벤트를 내보내는
/// closure), 시간 한도는 검사가 줄일 수 있다.
pub struct HostBuilder {
    data_root: PathBuf,
    translator: TranslatorCommand,
    shell: ShellSource,
    emit: Arc<Emit>,
    login_shell_limit: Duration,
    open_limit: Duration,
}

impl HostBuilder {
    /// 로그인 셸 읽기의 한도. 기본은 10초다(워크플로 §10) — 검사에서는 줄여도 된다.
    pub fn login_shell_limit(mut self, limit: Duration) -> Self {
        self.login_shell_limit = limit;
        self
    }

    /// 세션 열기의 한도. 기본은 30초다 — 검사에서는 줄여도 된다.
    pub fn open_limit(mut self, limit: Duration) -> Self {
        self.open_limit = limit;
        self
    }

    pub fn build(self) -> ConversationHost {
        ConversationHost {
            data_root: self.data_root,
            translator: self.translator,
            shell: self.shell,
            emit: self.emit,
            login_shell_limit: self.login_shell_limit,
            open_limit: self.open_limit,
            login_env: Mutex::new(None),
            live: Arc::new(Mutex::new(HashMap::new())),
            agents_file: Mutex::new(()),
        }
    }
}

pub struct ConversationHost {
    data_root: PathBuf,
    #[expect(dead_code, reason = "Claude 대화를 13이 이것으로 띄운다")]
    translator: TranslatorCommand,
    shell: ShellSource,
    emit: Arc<Emit>,
    login_shell_limit: Duration,
    open_limit: Duration,
    /// S7 — 로그인 env는 호스트가 도는 동안 한 번 읽어 메모리에 쥔다. 「다시 확인」만 다시 읽는다.
    /// 기록하지 않는다 — 비밀이 `agents/`에 남지 않게(워크플로 S37).
    ///
    /// 읽는 동안 잠금을 쥔다. 두 엔진 확인이 함께 와도 셸은 한 번만 뜨고, 뒤의 것이 앞의 결과를 쓴다.
    login_env: Mutex<Option<AgentEnv>>,
    /// 에이전트가 떠 있는 대화들 — 대화 id로 찾는다. 대화마다 이 표를 약하게 쥔다 — 사라진 work의 대화가 턴
    /// 끝에 스스로 표에서 빠져 꺼진다(S10).
    live: Arc<LiveTable>,
    /// `agents.json`을 읽고 고쳐 쓰는 사이를 잠근다 — 함께 연 두 대화가 서로의 줄을 지우지 않게.
    agents_file: Mutex<()>,
}

/// 에이전트가 떠 있는 대화들의 표.
type LiveTable = Mutex<HashMap<String, Live>>;

/// 에이전트가 떠 있는 대화 하나.
struct Live {
    work: String,
    agent: AgentProcess,
    conv: Arc<Conv>,
}

/// 대화 하나의 기록과 턴의 상태. 런타임의 sink가 함께 쥔다 — 받은 것은 sink가 곧바로 적는다.
///
/// 잠금 순서는 늘 `state` → 기록이다. 턴 끝 줄은 `state`를 쥔 채 적고 나서 턴을 비운다 — 그래야 다음 말의
/// `sent` 줄이 턴 끝 줄보다 앞에 서지 않는다.
struct Conv {
    recorder: Recorder,
    state: Mutex<ConvState>,
    /// 턴 끝에 work가 사라졌는지 본다(S10). 떠 있지 않은 대화(닫힘 줄만 적으려고 연 기록)에는 없다.
    vanish: Option<VanishWatch>,
}

struct ConvState {
    /// 에이전트가 살아 있나. 죽으면 다시 띄우기(티켓 10) 전까지 말을 받지 않는다.
    alive: bool,
    /// 도는 턴이 시작한 때. 쉬면 `None`이다.
    turn: Option<Instant>,
    /// 다음 말에 머리말을 붙이나 — 에이전트 쪽 세션의 첫 말이다(S11).
    needs_preamble: bool,
}

impl Conv {
    fn new(recorder: Recorder, vanish: Option<VanishWatch>) -> Arc<Self> {
        Arc::new(Self {
            recorder,
            state: Mutex::new(ConvState { alive: true, turn: None, needs_preamble: true }),
            vanish,
        })
    }

    fn lock_state(&self) -> MutexGuard<'_, ConvState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 런타임이 넘긴 것을 기록에 적는 sink.
    fn sink(self: &Arc<Self>) -> Sink {
        let conv = Arc::clone(self);
        Arc::new(move |event| conv.receive(event))
    }

    fn receive(&self, event: RuntimeEvent) {
        let written = match event {
            RuntimeEvent::Update(raw) => self.recorder.update(raw),
            RuntimeEvent::Stderr(line) => self.recorder.stderr(line),
            RuntimeEvent::AuthStatus(params) => self.recorder.session(SessionState::AuthStatus { params }),
            RuntimeEvent::Died(death) => {
                // 답 없이 사라진 턴에는 턴 끝이 없다 — 죽음 줄이 그 자리를 맡고, 턴은 쉬는 것으로 돌린다.
                let mut state = self.lock_state();
                state.alive = false;
                state.turn = None;
                self.recorder.session(SessionState::Died { reason: death.reason, stderr_tail: death.stderr_tail })
            }
            RuntimeEvent::TurnEnd(end) => {
                let written = {
                    let mut state = self.lock_state();
                    let started = state.turn.take();
                    let (response, error) = match end.result {
                        Ok(response) => (Some(response), None),
                        Err(error) => (None, Some(error)),
                    };
                    self.recorder.turn_end(TurnEndLine {
                        stop_reason: response.as_ref().and_then(|r| r["stopReason"].as_str()).map(str::to_owned),
                        duration_ms: elapsed_ms(started),
                        cancelled_by_us: end.cancelled_by_us,
                        out_of_turn: false,
                        response,
                        error,
                    })
                };
                // S10 — 아카이브를 시킨 에이전트가 바로 이 턴 안에 있을 수 있다(MCP `atelier_archive_work`를 부른
                // 그 턴). 그래서 턴 도중에는 끄지 않고, 턴 끝 줄을 적은 뒤에 work가 남아 있는지 본다.
                if let Some(watch) = &self.vanish {
                    watch.retire_if_vanished();
                }
                written
            }
        };
        if let Err(error) = written {
            // 기록이 막혀도 대화는 이어 간다 — sink는 오류를 돌려줄 곳이 없다.
            eprintln!("{error}");
        }
    }
}

/// 턴 끝에 그 대화의 work가 사라졌는지 보는 것(S10). 턴 끝은 런타임의 sink 안이라 호스트를 부를 수 없으므로, 떠
/// 있는 대화의 표를 약하게 쥐고 끄기는 따로 띄운 스레드가 한다.
struct VanishWatch {
    works: PathBuf,
    work: String,
    conversation: String,
    live: Weak<LiveTable>,
}

impl VanishWatch {
    fn retire_if_vanished(&self) {
        if !work_vanished(&self.works, &self.work) {
            return;
        }
        let live = self.live.clone();
        let conversation = self.conversation.clone();
        // 이 자리에서 끄지 않는다 — 끄기는 연결을 놓고 1초를 기다리는데, 이 자리가 바로 그 연결의 수신 루프다.
        std::thread::spawn(move || {
            if let Some(live) = live.upgrade() {
                retire_vanished(&live, |id, _| id == conversation);
            }
        });
    }
}

/// work가 사라졌나 — `work.json`이 없다(아카이브 · 삭제). 깨진 `work.json`은 사라진 것이 아니다 — 사람이 손보는
/// 중일 수 있는데, 그때 대화를 끄면 하던 일을 잃는다.
fn work_vanished(works: &Path, work: &str) -> bool {
    matches!(atelier_core::read_work(works, work), Err(atelier_core::Error::WorkNotFound(_)))
}

/// 사라진 work의 대화들을 끈다(S10) — 떠 있는 표에서 `pick`이 고른 것을 꺼내 남김없이 끄고(stdin 닫기 → 1초 →
/// 그룹째 SIGKILL), 기록에 닫힘 줄을 적는다.
///
/// - 열어 둔 기록 파일은 work 폴더의 rename을 따라가므로, 닫힘 줄도 work와 함께 아카이브로 간다.
/// - `agents.json`은 쓰지 않는다 — 옛 자리에 쓰면 `work.json` 없는 유령 work 폴더가 선다. 그래서 닫은 때도 적지
///   않는다(대화를 닫은 것은 사람이 아니다).
/// - 고른 것이 표에 없으면 아무 일도 하지 않는다 — 턴 끝과 감시 소식이 같은 대화를 함께 골랐으면 먼저 꺼낸 쪽이 끈다.
fn retire_vanished(live: &LiveTable, pick: impl Fn(&str, &Live) -> bool) {
    let mut retiring: Vec<Live> = {
        let mut table = live.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let ids: Vec<String> =
            table.iter().filter(|(id, conversation)| pick(id, conversation)).map(|(id, _)| id.clone()).collect();
        ids.iter().filter_map(|id| table.remove(id)).collect()
    };
    shut_down_together(&mut retiring);
    for conversation in &retiring {
        let closed = SessionState::Closed { cause: Some(CloseCause::WorkVanished) };
        if let Err(error) = conversation.conv.recorder.session(closed) {
            eprintln!("{error}");
        }
    }
}

/// 대화 여럿의 프로세스 그룹을 끈다 — 모두의 stdin을 **한꺼번에** 닫고 1초를 **한 번만** 기다린 뒤 그룹들을
/// SIGKILL한다. 대화마다 1초씩 줄을 세우면 N초가 된다.
fn shut_down_together(live: &mut [Live]) {
    let deadline = Instant::now() + runtime::SHUTDOWN_GRACE;
    for conversation in live.iter_mut() {
        conversation.agent.begin_shutdown();
    }
    for conversation in live.iter_mut() {
        conversation.agent.finish_shutdown(deadline);
    }
}

fn elapsed_ms(started: Option<Instant>) -> u64 {
    started.map_or(0, |at| u64::try_from(at.elapsed().as_millis()).unwrap_or(u64::MAX))
}

/// 대화 목록의 한 줄 — 화면이 대화 탭을 짓는 것.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub agent: Agent,
    pub name: String,
    pub model: Option<String>,
    pub mode: Option<String>,
    pub plan: Option<bool>,
    /// 기록에 마지막으로 적힌 줄의 seq. 화면은 이 다음부터 기록 줄 이벤트로 잇는다.
    pub last_seq: u64,
}

/// 호스트 명령이 실패한 까닭 — 화면에 그대로 보일 글이다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostError {
    /// `work.json`이 있는 work 폴더가 없다.
    WorkNotFound(String),
    LoginShell(LoginShellError),
    /// 에이전트를 띄우는 데 드는 실행 파일을 로그인 셸의 PATH에서 찾지 못했다.
    EngineMissing { agent: Agent, missing: Vec<MissingProgram> },
    /// 이 판에서 아직 열 수 없는 에이전트(Claude — 변환기가 서면 연다).
    AgentNotReady(Agent),
    /// 대화는 섰지만 에이전트가 세션을 열지 못했다. 까닭은 그 대화의 기록에도 `session` 죽음 줄로 남는다.
    Open { conversation: String, reason: String },
    ConversationNotFound(String),
    /// 에이전트가 떠 있지 않은 대화 — 다시 켠 뒤이거나 에이전트가 죽었다. 다시 띄우기는 티켓 10이다.
    NotRunning(String),
    /// 턴이 도는 동안의 보내기. 대기 줄은 티켓 07이 세운다.
    TurnRunning(String),
    /// 에이전트에 말을 보내지 못했다(연결이 끊겼다).
    Send(String),
    /// `agents/`를 읽거나 쓰지 못했다.
    Record(String),
}

impl fmt::Display for HostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HostError::WorkNotFound(work) => write!(f, "work를 찾을 수 없습니다: {work}"),
            HostError::LoginShell(error) => write!(f, "{error}"),
            HostError::EngineMissing { agent, missing } => {
                let names: Vec<&str> = missing.iter().map(|program| program.name).collect();
                write!(f, "{}를 띄우는 데 드는 것을 찾지 못했습니다: {}", agent.display_name(), names.join(", "))
            }
            HostError::AgentNotReady(agent) => write!(f, "{} 대화는 아직 열 수 없습니다", agent.display_name()),
            HostError::Open { reason, .. } => write!(f, "{reason}"),
            HostError::ConversationNotFound(conversation) => write!(f, "대화를 찾을 수 없습니다: {conversation}"),
            HostError::NotRunning(conversation) => write!(f, "에이전트가 떠 있지 않은 대화입니다: {conversation}"),
            HostError::TurnRunning(_) => write!(f, "턴이 도는 중이라 보낼 수 없습니다. 턴이 끝난 뒤에 보내세요"),
            HostError::Send(reason) => write!(f, "{reason}"),
            HostError::Record(reason) => write!(f, "{reason}"),
        }
    }
}

impl std::error::Error for HostError {}

impl From<LoginShellError> for HostError {
    fn from(error: LoginShellError) -> Self {
        HostError::LoginShell(error)
    }
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
            emit: Arc::new(emit),
            login_shell_limit: login_env::DEFAULT_LIMIT,
            open_limit: DEFAULT_OPEN_LIMIT,
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

    /// 대화 목록 — 그 work의 열린 대화들을 만든 순서로 준다. 닫은 대화는 `agents.json`에 줄이 남아도 빠진다
    /// (S14). 읽기만 한다 — `agents/`가 없으면 빈 목록이고, 아무것도 만들지 않는다.
    pub fn list_conversations(&self, work: &str) -> Result<Vec<Conversation>, HostError> {
        let works = atelier_core::works_in(&self.data_root);
        let meta = atelier_core::read_work(&works, work).map_err(|_| HostError::WorkNotFound(work.to_owned()))?;
        let places = atelier_core::work_places(&works, &meta);
        let rows = records::read_rows(&places.agents).map_err(HostError::Record)?;
        let live = self.lock_live();
        Ok(rows
            .iter()
            .filter(|row| row.closed_at.is_none())
            .map(|row| {
                let last_seq = match live.get(&row.id) {
                    Some(conversation) => conversation.conv.recorder.last_seq(),
                    None => records::last_seq(&records::record_path(&places.agents, &row.id)),
                };
                summary(row, last_seq)
            })
            .collect())
    }

    /// 기록 읽기 — 그 대화의 기록에서 `after` 다음 seq의 줄들을 준다. 화면은 이것으로 그리고, 그 뒤는 기록 줄
    /// 이벤트로 잇는다(앱을 다시 켠 뒤 · 다른 work에서 돌아온 뒤). 끝에 줄바꿈이 없는 꼬리(반쪽 줄)는 버린다.
    ///
    /// 읽기만 한다 — 에이전트를 띄우지 않고, 아무것도 만들지 않는다.
    pub fn read_record(&self, work: &str, conversation: &str, after: u64) -> Result<Vec<RecordLine>, HostError> {
        let works = atelier_core::works_in(&self.data_root);
        let meta = atelier_core::read_work(&works, work).map_err(|_| HostError::WorkNotFound(work.to_owned()))?;
        if !is_conversation_id(conversation) {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        }
        let places = atelier_core::work_places(&works, &meta);
        let path = records::record_path(&places.agents, conversation);
        records::read_lines(&path, after).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => HostError::ConversationNotFound(conversation.to_owned()),
            _ => HostError::Record(format!("기록을 읽지 못했습니다: {} — {error}", path.display())),
        })
    }

    /// 새 대화 — 엔진 기본값으로 만들고 곧바로 띄워 세션을 연다(S8). 그래서 칩 · 메뉴 · 로그인 실패가 첫 말
    /// 전에 선다. 이름은 에이전트 이름으로 저절로 붙는다(Codex · Codex 2).
    ///
    /// 막히는 호출이다 — 세션이 열릴 때까지(한도 30초) 기다린다.
    ///
    /// - work 폴더에 `work.json`이 없으면 아무것도 만들지 않고 실패한다(`agents/`도 만들지 않는다).
    /// - 에이전트를 못 찾으면 대화를 만들지 않고 실패한다 — 안내 카드가 빠진 것과 설치 명령을 보인다.
    /// - 대화를 만든 뒤 세션을 열지 못하면, 프로세스를 남김없이 끄고 기록에 까닭(`session` 죽음 줄)을 적고
    ///   실패한다. 대화는 목록에 남는다 — 다음 말에서 다시 띄운다(10).
    pub fn new_conversation(&self, work: &str, agent: Agent) -> Result<Conversation, HostError> {
        let works = atelier_core::works_in(&self.data_root);
        let meta = atelier_core::read_work(&works, work).map_err(|_| HostError::WorkNotFound(work.to_owned()))?;
        let places = atelier_core::work_places(&works, &meta);
        if agent == Agent::Claude {
            // three-axes 결정 12 — Codex를 먼저 잇는다. Claude는 변환기(티켓 13)가 서면 연다.
            return Err(HostError::AgentNotReady(agent));
        }
        let env = self.login_env(false)?;
        let programs = match discovery::look_up(agent, env.path()) {
            EngineCheck::Found { programs } => programs,
            EngineCheck::Missing { missing } => return Err(HostError::EngineMissing { agent, missing }),
        };
        let place = workplace(&places, meta.projects.len());

        records::ensure_agents_dir(&places.agents).map_err(HostError::Record)?;
        let mut row = {
            let _file = self.lock_agents_file();
            let rows = records::read_rows(&places.agents).map_err(HostError::Record)?;
            let row = ConversationRow {
                id: uuid::Uuid::new_v4().to_string(),
                agent,
                name: next_name(agent, &rows),
                cwd: place.cwd.clone(),
                additional_directories: place.additional_directories.clone(),
                agent_session_id: None,
                model: None,
                mode: None,
                plan: None,
                created_at: records::now(),
                closed_at: None,
                extra: Default::default(),
            };
            records::write_row(&places.agents, &row).map_err(HostError::Record)?;
            row
        };
        let conv = Conv::new(
            Recorder::open(&places.agents, work, &row.id, Arc::clone(&self.emit)).map_err(HostError::Record)?,
            Some(VanishWatch {
                works: works.clone(),
                work: work.to_owned(),
                conversation: row.id.clone(),
                live: Arc::downgrade(&self.live),
            }),
        );
        let recorder = &conv.recorder;
        recorder.session(SessionState::Spawning).map_err(HostError::Record)?;

        let launch = codex_launch(&programs, &env, &place);
        let (agent_process, opened) =
            match runtime::open(launch, place, self.open_limit, conv.sink(), record_opened(&conv)) {
                Ok(opened) => opened,
                Err(error) => {
                    let reason = error.to_string();
                    recorder
                        .session(SessionState::Died { reason: reason.clone(), stderr_tail: Vec::new() })
                        .map_err(HostError::Record)?;
                    return Err(HostError::Open { conversation: row.id, reason });
                }
            };

        row.agent_session_id = Some(opened.session_id.clone());
        {
            let _file = self.lock_agents_file();
            records::write_row(&places.agents, &row).map_err(HostError::Record)?;
        }

        let conversation = summary(&row, recorder.last_seq());
        self.lock_live().insert(row.id, Live { work: work.to_owned(), agent: agent_process, conv });
        Ok(conversation)
    }

    /// 보내기 — 턴이 쉬면 말을 보낸다. 기다리지 않는다: 답은 기록 줄 이벤트로 흐르고, 턴 끝도 `turn-end` 줄로
    /// 온다. 에이전트가 말을 받지 않으면(오류로 답하면) 그 까닭이 `turn-end` 줄에 실리고 대화는 산다.
    ///
    /// - 에이전트 쪽 세션의 첫 말이면 머리말(work slug · 제목 · specDir)을 따로 된 텍스트 블록으로 앞에 붙인다
    ///   (S11, three-axes 결정 23). 화면에는 `sent`의 글만 보이고, 기록에는 보낸 블록이 다 남는다.
    /// - 턴이 도는 동안의 보내기는 읽히는 오류다 — 대기 줄은 티켓 07이 세운다.
    /// - 에이전트가 떠 있지 않은 대화(다시 켠 뒤 · 죽은 뒤)는 아직 보낼 수 없다 — 다시 띄우기는 티켓 10이다.
    pub fn send(&self, work: &str, conversation: &str, text: &str) -> Result<(), HostError> {
        if !is_conversation_id(conversation) {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        }
        let works = atelier_core::works_in(&self.data_root);
        let meta = atelier_core::read_work(&works, work).map_err(|_| HostError::WorkNotFound(work.to_owned()))?;
        let places = atelier_core::work_places(&works, &meta);

        let live = self.lock_live();
        let Some(found) = live.get(conversation).filter(|live| live.work == work) else {
            return Err(HostError::NotRunning(conversation.to_owned()));
        };
        let mut state = found.conv.lock_state();
        if !state.alive {
            return Err(HostError::NotRunning(conversation.to_owned()));
        }
        if state.turn.is_some() {
            return Err(HostError::TurnRunning(conversation.to_owned()));
        }
        let mut prompt = Vec::new();
        if state.needs_preamble {
            prompt.push(preamble(&meta, &places));
        }
        prompt.push(json!({"type": "text", "text": text}));
        // `sent`를 먼저 적는다 — 보낸 뒤에 적으면 첫 update가 그보다 앞에 설 수 있다.
        found.conv.recorder.sent(text, &prompt, false).map_err(HostError::Record)?;
        state.turn = Some(Instant::now());
        state.needs_preamble = false;
        if let Err(reason) = found.agent.prompt(prompt) {
            // 보내지 못했다. 턴을 연 채로 두지 않는다 — 화면이 「일하는 중」에 갇히지 않게 끝 줄도 적는다.
            let started = state.turn.take();
            found
                .conv
                .recorder
                .turn_end(TurnEndLine {
                    stop_reason: None,
                    duration_ms: elapsed_ms(started),
                    cancelled_by_us: false,
                    out_of_turn: false,
                    response: None,
                    error: Some(json!({"message": reason})),
                })
                .map_err(HostError::Record)?;
            return Err(HostError::Send(reason));
        }
        Ok(())
    }

    /// 대화 닫기 — 그 에이전트의 프로세스를 남김없이 끄고(stdin 닫기 → 1초 → 그룹째 SIGKILL), 기록에 `session`
    /// 닫힘 줄을, `agents.json`에 닫은 때를 적는다. 줄은 남기고(S14) 기록 파일도 남긴다 — 평가의 재료다.
    ///
    /// 막히는 호출이다 — 끄기가 최대 1초 남짓 걸린다. 이미 닫은 대화를 다시 닫으면 아무 일도 하지 않는다.
    pub fn close_conversation(&self, work: &str, conversation: &str) -> Result<(), HostError> {
        if !is_conversation_id(conversation) {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        }
        let mut live = self.take_live(work, conversation);
        if let Some(live) = live.as_mut() {
            live.agent.shut_down();
        }

        let works = atelier_core::works_in(&self.data_root);
        let Ok(meta) = atelier_core::read_work(&works, work) else {
            // work 폴더가 사라졌다(아카이브 · 삭제). 끈 것으로 끝낸다 — 열어 둔 기록 파일은 옮겨진 자리를 따라가지만,
            // 사라진 자리의 `agents.json`은 다시 만들지 않는다(S10).
            return match live {
                Some(live) => live.conv.recorder.session(SessionState::Closed { cause: None }).map_err(HostError::Record),
                None => Err(HostError::WorkNotFound(work.to_owned())),
            };
        };
        let places = atelier_core::work_places(&works, &meta);
        let _file = self.lock_agents_file();
        let Some(mut row) =
            records::read_rows(&places.agents).map_err(HostError::Record)?.into_iter().find(|row| row.id == conversation)
        else {
            return Err(HostError::ConversationNotFound(conversation.to_owned()));
        };
        if row.closed_at.is_some() && live.is_none() {
            return Ok(());
        }
        let conv = match live {
            Some(live) => live.conv,
            None => Conv::new(
                Recorder::open(&places.agents, work, conversation, Arc::clone(&self.emit)).map_err(HostError::Record)?,
                None,
            ),
        };
        conv.recorder.session(SessionState::Closed { cause: None }).map_err(HostError::Record)?;
        row.closed_at = Some(records::now());
        records::write_row(&places.agents, &row).map_err(HostError::Record)
    }

    /// 사라진 work의 대화를 끈다(S10) — 앱은 work 목록이 바뀌었다는 감시 소식(`works:changed`)마다 부른다. work가
    /// 사라지는 길은 아카이브든 삭제든, 앱에서든 앱 밖의 MCP 프로세스에서든 같다 — 감시는 `works/`를 보므로 다 안다.
    ///
    /// - 쉬는 대화는 지금 끈다.
    /// - 턴이 도는 대화는 두고 그 턴이 끝나는 대로 끈다 — 아카이브를 시킨 에이전트가 바로 그 턴 안에 있을 수 있다.
    ///   턴 끝에는 대화가 스스로 `work.json`을 보므로, 이 소식이 턴 도중에 와도 턴 끝에 꺼진다.
    /// - 기록은 열어 둔 파일에 닫힘 줄을 적고 끝낸다. `agents.json`은 쓰지 않는다 — 옛 자리를 다시 만들지 않는다.
    ///
    /// 막히는 호출이다 — 끌 대화가 있으면 끄기가 최대 1초 남짓 걸린다.
    pub fn check_vanished_works(&self) {
        let works = atelier_core::works_in(&self.data_root);
        // 떠 있는 대화의 work마다 한 번씩, 표를 잠그지 않은 채 본다 — 감시 소식은 spec을 고칠 때마다 온다.
        let mut held: Vec<String> = self.lock_live().values().map(|live| live.work.clone()).collect();
        held.sort();
        held.dedup();
        let vanished: Vec<String> = held.into_iter().filter(|work| work_vanished(&works, work)).collect();
        if vanished.is_empty() {
            return;
        }
        retire_vanished(&self.live, |_, live| {
            vanished.contains(&live.work) && live.conv.lock_state().turn.is_none()
        });
    }

    /// 호스트 끄기 — 모든 대화의 프로세스 그룹을 끈다(앱 종료). 대화를 닫지는 않는다: `agents.json`과 기록은
    /// 그대로이고, 앱을 다시 켜면 말을 보낼 때 되살린다(three-axes 결정 19).
    ///
    /// 모든 대화의 stdin을 **한꺼번에** 닫고 1초를 **한 번만** 기다린 뒤 그룹들을 SIGKILL한다 — 대화마다 1초씩
    /// 줄을 세우면 N초가 된다.
    pub fn shut_down(&self) {
        let mut live: Vec<Live> = self.lock_live().drain().map(|(_, live)| live).collect();
        shut_down_together(&mut live);
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

    /// 그 work의 그 대화가 떠 있으면 꺼낸다.
    fn take_live(&self, work: &str, conversation: &str) -> Option<Live> {
        let mut live = self.lock_live();
        match live.get(conversation) {
            Some(found) if found.work == work => live.remove(conversation),
            _ => None,
        }
    }

    fn lock_live(&self) -> MutexGuard<'_, HashMap<String, Live>> {
        self.live.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_agents_file(&self) -> MutexGuard<'_, ()> {
        self.agents_file.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// 에이전트가 일하는 자리(three-axes 결정 17).
///
/// | 프로젝트 | cwd | 함께 여는 폴더 |
/// |---|---|---|
/// | 없음 | spec 폴더 | — |
/// | 하나 | 그 워크트리 | spec 폴더 |
/// | 여럿 | `trees/` | spec 폴더 |
fn workplace(places: &atelier_core::WorkPlaces, projects: usize) -> SessionPlace {
    let cwd = match (projects, places.worktrees.first()) {
        (0, _) | (_, None) => return SessionPlace { cwd: places.spec.clone(), additional_directories: Vec::new() },
        (1, Some(tree)) => tree.clone(),
        _ => places.trees.clone(),
    };
    SessionPlace { cwd, additional_directories: vec![places.spec.clone()] }
}

/// 세션이 열린 순간 적는 줄 — 판 경고(S6)와 열림. 런타임의 순서 장벽 안에서 돌아, 답 뒤에 온 update보다 앞에 선다.
fn record_opened(conv: &Arc<Conv>) -> runtime::OnOpened {
    let conv = Arc::clone(conv);
    Box::new(move |opened| {
        let agent_version = opened.initialize["agentInfo"]["version"].as_str().map(str::to_owned);
        let written = (|| {
            if major(agent_version.as_deref()) != Some(CODEX_ACP_MAJOR) {
                conv.recorder.session(SessionState::VersionWarning {
                    agent_version: agent_version.clone(),
                    supported_major: CODEX_ACP_MAJOR,
                })?;
            }
            conv.recorder.session(SessionState::Opened {
                how: "new",
                agent_version: agent_version.clone(),
                modes: opened.session.get("modes").cloned().unwrap_or(Value::Null),
                models: opened.session.get("models").cloned().unwrap_or(Value::Null),
                config_options: opened.session.get("configOptions").cloned().unwrap_or(Value::Null),
            })
        })();
        if let Err(error) = written {
            eprintln!("{error}");
        }
    })
}

/// Codex를 띄우는 것 — 찾은 `codex-acp`를 `npx` 없이 바로 띄운다(three-axes 결정 26). env는 로그인 env에
/// `CODEX_PATH=<찾은 codex>`를 더한 것이다. `INITIAL_AGENT_MODE`는 넣지 않는다 — 시작 모드는 엔진 기본값이다.
/// 사용자의 `CODEX_HOME`은 로그인 env에 있으면 그대로 간다(로그인 · config의 MCP · 모델이 이어진다).
fn codex_launch(programs: &[discovery::FoundProgram], env: &AgentEnv, place: &SessionPlace) -> Launch {
    let found = |name: &str| -> PathBuf {
        programs.iter().find(|program| program.name == name).expect("찾은 것에 Codex의 셋이 다 있다").path.clone()
    };
    let mut vars: BTreeMap<OsString, OsString> = env.vars().clone();
    vars.insert("CODEX_PATH".into(), found("codex").into_os_string());
    Launch { program: found("codex-acp"), args: Vec::new(), env: vars, cwd: place.cwd.clone() }
}

/// 머리말(S11) — 에이전트가 첫 말에서 어느 work인지 안다(스토리 107). 따로 된 텍스트 블록이라 화면은 이것을
/// 그리지 않고 `sent`의 글만 그린다(스토리 108). 봉투처럼 한국어 마크다운 한 장이다(워크플로 S18).
fn preamble(meta: &atelier_core::Work, places: &atelier_core::WorkPlaces) -> Value {
    let text = format!(
        "Atelier work 안에서 열린 대화다.\n\n- work slug: `{}`\n- 제목: {}\n- spec 폴더(specDir): `{}`\n",
        meta.slug,
        meta.title,
        places.spec.display()
    );
    json!({"type": "text", "text": text})
}

/// 열린 대화 가운데 쓰지 않은 가장 작은 이름 — `Codex`, `Codex 2`, `Codex 3` …
fn next_name(agent: Agent, rows: &[ConversationRow]) -> String {
    let taken: Vec<&str> = rows.iter().filter(|row| row.closed_at.is_none()).map(|row| row.name.as_str()).collect();
    (1..)
        .map(|n| if n == 1 { agent.display_name().to_owned() } else { format!("{} {n}", agent.display_name()) })
        .find(|name| !taken.contains(&name.as_str()))
        .expect("이름은 언젠가 빈다")
}

/// 화면이 넘긴 대화 id가 이 호스트가 지은 꼴인가 — 기록 파일 이름이 되므로 경로 요소를 들이지 않는다.
fn is_conversation_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// 판 글의 메이저 — `2.2.2` → 2. 읽을 수 없으면 `None`이다.
fn major(version: Option<&str>) -> Option<u64> {
    version?.split('.').next()?.trim().parse().ok()
}

fn summary(row: &ConversationRow, last_seq: u64) -> Conversation {
    Conversation {
        id: row.id.clone(),
        agent: row.agent,
        name: row.name.clone(),
        model: row.model.clone(),
        mode: row.mode.clone(),
        plan: row.plan,
        last_seq,
    }
}
