//! 살아있는 세션들을 쥐는 자리.
//!
//! 모양은 티켓 02의 실물 스파이크가 정했다(`spec/01-걷는-뼈대/explanation/02-실물-스파이크.md`).
//! 연결의 수명은 `connect_with`에 준 **클로저의 수명**이므로, 세션마다 스레드 하나가 그 클로저
//! 안에서 종료 신호를 기다린다. 신호를 쏘는 것이 곧 세션을 접는 것이고, 클로저가 반환하면
//! 연결과 자식 프로세스가 함께 끝난다.

use std::collections::HashMap;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::v1::{InitializeRequest, NewSessionRequest};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use atelier_core::{NewSession, Session, StartPoint};
use serde::Serialize;

use crate::adapter::{codex_command, CODEX};
use crate::{Error, Result};

/// 매니저가 읽고 쓰는 자리들. 전부 밖에서 준다 — 데이터 루트의 생김새는 `atelier-core`가 안다.
#[derive(Debug, Clone)]
pub struct SessionPaths {
    pub sessions: PathBuf,
    pub projects: PathBuf,
    pub adapters_file: PathBuf,
}

/// 목록에 나가는 한 줄. 살아있음은 신원 파일이 아니라 여기, 런타임에서만 온다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    #[serde(flatten)]
    pub session: Session,
    pub alive: bool,
}

/// 살아있는 세션들과 "이미 닫는 중인가"를 **한 자물쇠 아래** 둔다. 둘이 갈라져 있으면
/// 세션이 뜨는 도중에 앱이 닫힐 때 그 자식만 아무도 거두지 않고 남는다.
#[derive(Default)]
struct Registry {
    sessions: HashMap<String, Live>,
    closing: bool,
}

pub struct SessionManager {
    paths: SessionPaths,
    registry: Mutex<Registry>,
}

impl SessionManager {
    pub fn new(paths: SessionPaths) -> Self {
        Self {
            paths,
            registry: Mutex::new(Registry::default()),
        }
    }

    /// 시작점의 디렉터리에서 에이전트를 띄우고, **핸드셰이크와 세션 열기가 성공한 뒤에만**
    /// 세션 폴더를 만든다. 실패하면 디스크에 아무것도 남기지 않고 읽을 수 있는 오류만 돌려준다.
    pub fn start(&self, start_point: StartPoint) -> Result<SessionView> {
        let cwd = self.resolve(&start_point)?;
        let command = codex_command(&self.paths.adapters_file);

        let (live, agent_session_id) = spawn_session(command, cwd.clone())?;

        // 자물쇠를 등록까지 쥔 채로 간다. 여기서 놓으면 그 틈에 앱이 닫힐 수 있고, 그러면
        // 이 자식은 자기 프로세스 그룹의 리더라 부모가 죽어도 따라 죽지 않고 고아로 남는다.
        let mut registry = self.registry.lock().unwrap();
        if registry.closing {
            drop(registry);
            live.close();
            return Err(Error::Closing);
        }

        let session = match atelier_core::create_session(
            &self.paths.sessions,
            NewSession {
                agent: CODEX.to_string(),
                agent_session_id,
                start_point,
                cwd,
            },
        ) {
            Ok(session) => session,
            // 신원을 남기지 못한 세션은 사용자가 다시 만날 방법이 없다. 자식을 두고 가지 않는다.
            Err(error) => {
                drop(registry);
                live.close();
                return Err(error.into());
            }
        };

        registry.sessions.insert(session.id.clone(), live);
        Ok(SessionView {
            session,
            alive: true,
        })
    }

    /// 최근 것부터. 살아있음은 이 프로세스가 지금 쥐고 있는 연결에서만 온다.
    pub fn list(&self) -> Result<Vec<SessionView>> {
        let sessions = atelier_core::list_sessions(&self.paths.sessions)?;
        let registry = self.registry.lock().unwrap();
        Ok(sessions
            .into_iter()
            .map(|session| {
                let alive = registry
                    .sessions
                    .get(&session.id)
                    .is_some_and(Live::is_alive);
                SessionView { session, alive }
            })
            .collect())
    }

    /// 모든 세션을 접는다. 앱이 닫힐 때 이것을 부른다. 이 뒤로는 새 세션이 서지 않는다.
    pub fn close_all(&self) {
        let sessions = {
            let mut registry = self.registry.lock().unwrap();
            registry.closing = true;
            std::mem::take(&mut registry.sessions)
        };
        // 자물쇠를 놓고 거둔다 — join은 오래 걸릴 수 있고 아무도 이 자물쇠를 기다릴 이유가 없다.
        for (_, session) in sessions {
            session.close();
        }
    }

    /// 시작점의 디렉터리는 **기존 도메인 읽기 API로만** 얻는다 — 세션 코드는 프로젝트 저장
    /// 형식을 알지 못한다.
    fn resolve(&self, start_point: &StartPoint) -> Result<PathBuf> {
        match start_point {
            StartPoint::Project { slug } => {
                let view = atelier_core::get_project(&self.paths.projects, slug)?;
                if view.missing {
                    return Err(Error::StartPointMissing(view.project.path));
                }
                Ok(atelier_core::expand_home(&view.project.path))
            }
        }
    }
}

impl Drop for SessionManager {
    fn drop(&mut self) {
        self.close_all();
    }
}

/// 살아있는 세션 하나를 쥔 손잡이.
struct Live {
    /// 이 송신부가 사라지면 연결 클로저의 기다림이 풀린다. 그것이 종료 신호다.
    shutdown: futures::channel::oneshot::Sender<()>,
    thread: std::thread::JoinHandle<()>,
    /// 연결이 끝나면 스레드가 내린다 — 에이전트가 스스로 죽어도 목록이 거짓말하지 않도록.
    alive: Arc<AtomicBool>,
}

impl Live {
    fn is_alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }

    fn close(self) {
        drop(self.shutdown);
        let _ = self.thread.join();
    }
}

/// 스레드 하나를 띄워 연결을 세우고, 세션이 열릴 때까지 부른 쪽을 기다리게 한다.
///
/// `npx`가 패키지를 내려받는 첫 실행은 오래 걸릴 수 있으므로 여기에 제한 시간을 두지 않는다.
fn spawn_session(command: String, cwd: PathBuf) -> Result<(Live, String)> {
    let (outcome_tx, outcome_rx) = std::sync::mpsc::channel();
    let (shutdown_tx, shutdown_rx) = futures::channel::oneshot::channel::<()>();
    let alive = Arc::new(AtomicBool::new(true));
    let attempted = command.clone();

    let thread = {
        let alive = alive.clone();
        let failure_tx = outcome_tx.clone();
        std::thread::spawn(move || {
            // 클로저가 아예 돌지 못한 경우(spawn 실패)에는 이 통로로만 소식이 나간다.
            if let Err(error) = run_connection(command, cwd, outcome_tx, shutdown_rx) {
                let _ = failure_tx.send(Err(error));
            }
            alive.store(false, Ordering::Relaxed);
        })
    };

    let live = Live {
        shutdown: shutdown_tx,
        thread,
        alive,
    };
    match outcome_rx.recv() {
        Ok(Ok(agent_session_id)) => Ok((live, agent_session_id)),
        Ok(Err(error)) => {
            live.close();
            Err(error)
        }
        // 스레드가 아무 말 없이 끝났다면 그 자체가 실패다.
        Err(_) => {
            live.close();
            Err(Error::AgentStart {
                command: attempted,
                message: "agent left no answer".to_string(),
            })
        }
    }
}

fn run_connection(
    command: String,
    cwd: PathBuf,
    outcome: std::sync::mpsc::Sender<Result<String>>,
    shutdown: futures::channel::oneshot::Receiver<()>,
) -> Result<()> {
    let agent = AcpAgent::from_str(&command).map_err(|e| Error::agent_start(&command, &e))?;
    let command_in_error = command.clone();

    // 비동기 런타임을 따로 들이지 않고 futures의 실행기로만 돈다 (티켓 02가 검증).
    futures::executor::block_on(Client.builder().name("atelier").connect_with(
        agent,
        async |cx: ConnectionTo<Agent>| {
            let opened = open_session(&cx, cwd)
                .await
                .map_err(|message| Error::AgentStart {
                    command: command_in_error,
                    message,
                });
            let opened_ok = opened.is_ok();
            let _ = outcome.send(opened);

            if opened_ok {
                // 종료 신호가 올 때까지 연결을 붙잡는다. 반환하는 순간 연결과 자식이 끝난다.
                let _ = shutdown.await;
            }
            Ok(())
        },
    ))
    .map_err(|e| Error::agent_start(&command, &e))?;

    Ok(())
}

/// 핸드셰이크와 세션 열기. 실패하면 사람이 읽을 메시지만 돌려준다 — 커맨드는 부르는 쪽이 안다.
async fn open_session(
    cx: &ConnectionTo<Agent>,
    cwd: PathBuf,
) -> std::result::Result<String, String> {
    // 클라이언트 능력은 하나도 선언하지 않는다 (확정 결정 10).
    cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
        .block_task()
        .await
        .map_err(|e| e.to_string())?;

    let opened = cx
        .send_request(NewSessionRequest::new(cwd))
        .block_task()
        .await
        .map_err(|e| e.to_string())?;

    Ok(opened.session_id.0.to_string())
}
