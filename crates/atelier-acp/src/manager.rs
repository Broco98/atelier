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

use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest, RequestPermissionOutcome,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionId, TextContent,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{
    AcpAgent, Agent, Client, ConnectionTo, JsonRpcNotification, JsonRpcRequest, Responder,
};
use atelier_core::{NewSession, Session, StartPoint};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::adapter::{codex_command, CODEX};
use crate::{envelope, Error, Result};

/// 제목이 될 첫 줄의 길이. 목록 한 줄에 들어갈 만큼만 남긴다.
const TITLE_CHARS: usize = 80;

/// 봉투 한 줄이 기록될 때마다 불린다 — 세션 id, **기록에서 그 줄이 앉은 자리**, 그리고 줄.
///
/// 파일에 쌓이는 줄과 밖으로 나가는 줄이 **같은 값**이어서, 재생과 라이브 스트림이 화면에서
/// 같은 렌더러를 쓴다. 자리 번호를 함께 싣는 것은 그 둘이 겹치는 지점을 화면이 알아보게
/// 하기 위해서다 — 재생이 n줄을 그렸다면 라이브는 n번째부터만 이으면 된다.
pub type Listener = Arc<dyn Fn(&str, usize, &Value) + Send + Sync>;

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
    /// 답을 기다리는 권한 요청이 있는가. 살아있음과 마찬가지로 **런타임의 사실**이라 신원
    /// 파일에 적히지 않는다 — 답할 자리는 이 프로세스의 연결에만 있기 때문이다.
    pub awaiting_permission: bool,
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
    listener: Listener,
}

impl SessionManager {
    pub fn new(paths: SessionPaths, listener: Listener) -> Self {
        Self {
            paths,
            registry: Mutex::new(Registry::default()),
            listener,
        }
    }

    /// 시작점의 디렉터리에서 에이전트를 띄우고, **핸드셰이크와 세션 열기가 성공한 뒤에만**
    /// 세션 폴더를 만든다. 실패하면 디스크에 아무것도 남기지 않고 읽을 수 있는 오류만 돌려준다.
    pub fn start(&self, start_point: StartPoint) -> Result<SessionView> {
        let cwd = self.resolve(&start_point)?;
        let command = codex_command(&self.paths.adapters_file);
        let recorder = Arc::new(Recorder {
            sessions_root: self.paths.sessions.clone(),
            listener: Arc::clone(&self.listener),
            session: Mutex::new(Recording::Waiting(Vec::new())),
        });

        let (live, agent_session_id) = spawn_session(command, cwd.clone(), recorder)?;

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

        // 이제야 기록할 자리가 정해졌다. 세션이 열리는 동안 온 말들이 여기서 쏟아진다.
        live.recorder.open(session.id.clone());

        registry.sessions.insert(session.id.clone(), live);
        Ok(SessionView {
            session,
            alive: true,
            awaiting_permission: false,
        })
    }

    /// 사람이 친 말을 보내고 **턴이 끝날 때까지** 기다린다. 그동안 오는 조각들은 알림 통로로
    /// 기록되고 밖으로 흐르므로, 부르는 쪽이 돌아왔다는 것은 곧 턴이 끝났다는 뜻이다.
    pub fn prompt(&self, session_id: &str, text: &str) -> Result<()> {
        let (cx, agent_session_id, recorder) = {
            let registry = self.registry.lock().unwrap();
            let live = registry
                .sessions
                .get(session_id)
                .filter(|live| live.is_alive())
                .ok_or_else(|| Error::NotRunning(session_id.to_string()))?;
            (
                live.cx.clone(),
                live.agent_session_id.clone(),
                Arc::clone(&live.recorder),
            )
        };

        // 세션의 이름은 첫 지시로 정해진다. 두 번째부터는 저장소가 그대로 둔다.
        if let Some(title) = title_from(text) {
            atelier_core::set_session_title_once(&self.paths.sessions, session_id, title)?;
        }
        recorder.record(envelope::user_prompt(text));

        let turn = futures::executor::block_on(
            cx.send_request(PromptRequest::new(
                SessionId::from(agent_session_id),
                vec![ContentBlock::Text(TextContent::new(text))],
            ))
            .block_task(),
        );

        if let Err(error) = turn {
            // 실패도 대화의 일부다. 기록에 남겨야 다시 열었을 때 이유가 보인다.
            let error = error.to_string();
            recorder.record(envelope::turn_failed(&error));
            return Err(Error::Prompt(error));
        }
        Ok(())
    }

    /// 권한 카드의 답. 사람이 고른 선택지 id를 그대로 받는다 — **선택지는 에이전트가 준
    /// 목록뿐이고 아틀리에가 만들어 내지 않는다**(이 판은 정책 판정 없이 매번 사람에게 묻는다).
    ///
    /// 답은 **기록에 먼저 남고 그다음 상대에게 간다.** 순서를 뒤집으면 에이전트가 답을 받고
    /// 흘린 조각이 내 답보다 앞에 쌓여, 다시 열었을 때 승낙 전에 움직인 것처럼 읽힌다.
    pub fn answer_permission(
        &self,
        session_id: &str,
        request_id: &str,
        option_id: &str,
    ) -> Result<()> {
        let (permissions, recorder) = {
            let registry = self.registry.lock().unwrap();
            let live = registry
                .sessions
                .get(session_id)
                .filter(|live| live.is_alive())
                .ok_or_else(|| Error::NotRunning(session_id.to_string()))?;
            (Arc::clone(&live.permissions), Arc::clone(&live.recorder))
        };

        let (responder, allow) = permissions.take(request_id, option_id).ok_or_else(|| {
            Error::NoSuchPermission {
                session: session_id.to_string(),
                request: request_id.to_string(),
                option: option_id.to_string(),
            }
        })?;
        recorder.record(envelope::permission_response(request_id, option_id, allow));

        responder
            .respond(RequestPermissionResponse::new(
                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                    option_id.to_string(),
                )),
            ))
            // 답을 돌려줄 통로가 닫혔다면 그 세션은 이미 살아있지 않다.
            .map_err(|_| Error::NotRunning(session_id.to_string()))
    }

    /// 지난 대화 전체. 화면은 프로세스를 띄우기 전에 이것부터 그린다.
    pub fn updates(&self, session_id: &str) -> Result<Vec<Value>> {
        Ok(atelier_core::read_updates(&self.paths.sessions, session_id)?)
    }

    /// 최근 것부터. 살아있음은 이 프로세스가 지금 쥐고 있는 연결에서만 온다.
    pub fn list(&self) -> Result<Vec<SessionView>> {
        let sessions = atelier_core::list_sessions(&self.paths.sessions)?;
        let registry = self.registry.lock().unwrap();
        Ok(sessions
            .into_iter()
            .map(|session| {
                let live = registry
                    .sessions
                    .get(&session.id)
                    .filter(|live| live.is_alive());
                SessionView {
                    alive: live.is_some(),
                    awaiting_permission: live.is_some_and(|live| live.permissions.waiting()),
                    session,
                }
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
    /// 클로저 밖으로 나온 연결. 아무 스레드에서나 요청을 보낼 수 있다(티켓 02가 검증).
    cx: ConnectionTo<Agent>,
    agent_session_id: String,
    recorder: Arc<Recorder>,
    permissions: Arc<Pending>,
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

/// 답을 기다리는 권한 요청들. 요청 id로 찾는다.
///
/// 요청을 받은 자리에서 사람을 기다릴 수는 없다 — 그 콜백은 수신 루프 안에서 돌기 때문에,
/// 붙잡고 있으면 답하는 동안 에이전트의 다른 조각이 하나도 들어오지 못한다. 그래서 **답할
/// 자리만 여기 챙겨 두고 루프를 놓아준다.**
#[derive(Default)]
struct Pending {
    cards: Mutex<HashMap<String, Card>>,
}

/// 화면에 뜬 카드 한 장 — 상대에게 답을 돌려줄 자리와, 그가 준 선택지들.
struct Card {
    responder: Responder<RequestPermissionResponse>,
    /// 선택지 id → 이것이 허용인가.
    options: HashMap<String, bool>,
}

impl Pending {
    fn open(&self, request_id: &str, card: Card) {
        self.cards.lock().unwrap().insert(request_id.to_string(), card);
    }

    /// 그 요청을 그 선택지로 답할 수 있을 때만 카드를 꺼낸다. 없는 선택지에 카드를 잃으면
    /// 사람에게는 다시 답할 길이 없다 — 그래서 지우기 전에 확인한다.
    fn take(
        &self,
        request_id: &str,
        option_id: &str,
    ) -> Option<(Responder<RequestPermissionResponse>, bool)> {
        let mut cards = self.cards.lock().unwrap();
        let allow = *cards.get(request_id)?.options.get(option_id)?;
        Some((cards.remove(request_id)?.responder, allow))
    }

    fn waiting(&self) -> bool {
        !self.cards.lock().unwrap().is_empty()
    }
}

/// 에이전트가 준 선택지에서 **id와 허용/거부만** 뽑는다. 이름과 종류는 화면의 몫이라 봉투 안
/// 원본에 그대로 있다.
///
/// ACP의 종류는 `allow_once`·`allow_always`·`reject_once`·`reject_always`이고 열려 있다.
/// 그 어휘의 규칙은 접두사이므로 접두사로 읽는다 — 뒤에 늘어난 종류도 같은 규칙을 따른다.
fn options_of(payload: &Value) -> HashMap<String, bool> {
    let Some(options) = payload["options"].as_array() else {
        return HashMap::new();
    };
    options
        .iter()
        .filter_map(|option| {
            let id = option["optionId"].as_str()?;
            let kind = option["kind"].as_str()?;
            Some((id.to_string(), kind.starts_with("allow")))
        })
        .collect()
}

/// 봉투를 파일에 쌓고 밖으로도 흘린다.
struct Recorder {
    sessions_root: PathBuf,
    listener: Listener,
    session: Mutex<Recording>,
}

/// 알림 통로는 연결과 함께 서는데 세션 폴더는 `session/new`가 성공한 뒤에야 생긴다. 그 틈에
/// 오는 말(실물 Codex는 세션을 열자마자 쓸 수 있는 명령 목록을 보낸다)을 **버리지 않는다** —
/// 스펙은 스트림을 전부 기록하라고 한다. 자리가 생길 때까지 안고 있다가 순서 그대로 쏟는다.
enum Recording {
    Waiting(Vec<Value>),
    /// `next`는 다음 줄이 앉을 자리다. 이어 여는 세션은 이미 쌓인 만큼 뒤에서 시작한다.
    Open { id: String, next: usize },
}

impl Recorder {
    fn record(&self, line: Value) {
        let mut recording = self.session.lock().unwrap();
        match &mut *recording {
            Recording::Waiting(pending) => pending.push(line),
            Recording::Open { id, next } => self.write(&id.clone(), next, &line),
        }
    }

    /// 세션의 신원이 정해졌다. 기다리던 줄들을 먼저 흘려보내고, 이후로는 곧바로 쓴다.
    /// 자물쇠를 쥔 채로 쏟아야 그 사이에 도착한 조각이 앞질러 가지 않는다.
    fn open(&self, id: String) {
        let mut recording = self.session.lock().unwrap();
        let placeholder = Recording::Waiting(Vec::new());
        let Recording::Waiting(pending) = std::mem::replace(&mut *recording, placeholder) else {
            return;
        };
        // 이어 여는 세션은 이미 쌓인 만큼 뒤에서 시작한다.
        let mut next = atelier_core::read_updates(&self.sessions_root, &id)
            .map(|lines| lines.len())
            .unwrap_or(0);
        for line in pending {
            self.write(&id, &mut next, &line);
        }
        *recording = Recording::Open { id, next };
    }

    /// 한 줄을 파일에 쌓고 밖으로 흘린다. `next`는 그 줄이 앉을 자리이고, 쓴 뒤 한 칸 나아간다.
    fn write(&self, id: &str, next: &mut usize, line: &Value) {
        if let Err(error) = atelier_core::append_update(&self.sessions_root, id, line) {
            // 기록이 막혀도 대화는 이어져야 한다. 사용자는 지금 말하고 있는 중이다.
            eprintln!("세션 {id}의 대화를 기록하지 못했다: {error}");
        }
        (self.listener)(id, *next, line);
        *next += 1;
    }
}

/// `session/update` 알림을 **날것 그대로** 받는다.
///
/// 스키마 타입으로 받아 되쓰면 우리가 아직 모르는 종류의 갱신이 통째로 사라진다. 기록은
/// 에이전트가 보낸 것을 그대로 안고, 무엇을 그릴지는 화면이 정한다.
#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcNotification)]
#[notification(method = "session/update")]
#[serde(transparent)]
struct RawSessionUpdate(Value);

/// `session/request_permission` **요청**을 날것 그대로 받는다.
///
/// 같은 이유다 — 카드에 무엇을 그릴지는 화면이 정하고, 기록은 에이전트가 보낸 것을 그대로
/// 안는다. 답은 반대로 크레이트의 타입으로 돌려준다: 나가는 와이어 모양을 손으로 짜지 않는다.
#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcRequest)]
#[request(method = "session/request_permission", response = RequestPermissionResponse)]
#[serde(transparent)]
struct RawPermissionRequest(Value);

/// 세션의 이름이 될 한 줄. 빈 줄로 시작하는 프롬프트도 있으므로 처음 비지 않은 줄을 찾는다.
fn title_from(text: &str) -> Option<&str> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    Some(match line.char_indices().nth(TITLE_CHARS) {
        Some((at, _)) => &line[..at],
        None => line,
    })
}

/// 스레드 하나를 띄워 연결을 세우고, 세션이 열릴 때까지 부른 쪽을 기다리게 한다.
///
/// `npx`가 패키지를 내려받는 첫 실행은 오래 걸릴 수 있으므로 여기에 제한 시간을 두지 않는다.
fn spawn_session(command: String, cwd: PathBuf, recorder: Arc<Recorder>) -> Result<(Live, String)> {
    let (outcome_tx, outcome_rx) = std::sync::mpsc::channel();
    let (shutdown_tx, shutdown_rx) = futures::channel::oneshot::channel::<()>();
    let alive = Arc::new(AtomicBool::new(true));
    let attempted = command.clone();
    // 답을 기다리는 카드들은 연결과 함께 나고 진다 — 답할 자리가 그 연결 안에 있기 때문이다.
    let permissions = Arc::new(Pending::default());

    let thread = {
        let alive = alive.clone();
        let failure_tx = outcome_tx.clone();
        let recorder = Arc::clone(&recorder);
        let permissions = Arc::clone(&permissions);
        std::thread::spawn(move || {
            // 클로저가 아예 돌지 못한 경우(spawn 실패)에는 이 통로로만 소식이 나간다.
            if let Err(error) =
                run_connection(command, cwd, recorder, permissions, outcome_tx, shutdown_rx)
            {
                let _ = failure_tx.send(Err(error));
            }
            alive.store(false, Ordering::Relaxed);
        })
    };

    let opened = outcome_rx.recv().unwrap_or_else(|_| {
        // 스레드가 아무 말 없이 끝났다면 그 자체가 실패다.
        Err(Error::AgentStart {
            command: attempted,
            message: "agent left no answer".to_string(),
        })
    });

    match opened {
        Ok((agent_session_id, cx)) => Ok((
            Live {
                shutdown: shutdown_tx,
                thread,
                alive,
                cx,
                agent_session_id: agent_session_id.clone(),
                recorder,
                permissions,
            },
            agent_session_id,
        )),
        // 서지 못한 세션에는 거둘 연결이 없다. 신호만 쏘고 스레드가 끝나기를 기다린다.
        Err(error) => {
            drop(shutdown_tx);
            let _ = thread.join();
            Err(error)
        }
    }
}

fn run_connection(
    command: String,
    cwd: PathBuf,
    recorder: Arc<Recorder>,
    permissions: Arc<Pending>,
    outcome: std::sync::mpsc::Sender<Result<(String, ConnectionTo<Agent>)>>,
    shutdown: futures::channel::oneshot::Receiver<()>,
) -> Result<()> {
    let agent = AcpAgent::from_str(&command).map_err(|e| Error::agent_start(&command, &e))?;
    let command_in_error = command.clone();
    let permission_recorder = Arc::clone(&recorder);

    // 비동기 런타임을 따로 들이지 않고 futures의 실행기로만 돈다 (티켓 02가 검증).
    futures::executor::block_on(
        Client
            .builder()
            .name("atelier")
            // 스트림 한 조각. 이 콜백은 수신 루프 안에서 돌므로 **도착 순서가 곧 기록 순서**다.
            .on_receive_notification(
                async move |update: RawSessionUpdate, _cx| {
                    recorder.record(envelope::session_update(update.0));
                    Ok(())
                },
                agent_client_protocol::on_receive_notification!(),
            )
            // 도구를 쓰기 전의 물음. **여기서 사람을 기다리지 않는다** — 이 콜백도 수신 루프
            // 안에서 돌기 때문에, 붙잡고 있으면 답하는 동안 스트림 전체가 멎는다.
            .on_receive_request(
                async move |asked: RawPermissionRequest, responder, _cx| {
                    let request_id = responder.id().to_string();
                    // 카드를 먼저 세우고 기록한다. 기록이 화면에 뜨는 순간 사람이 누를 수
                    // 있어야 하고, 그때 답할 자리가 아직 없으면 그 누름이 헛돈다.
                    permissions.open(
                        &request_id,
                        Card {
                            responder,
                            options: options_of(&asked.0),
                        },
                    );
                    permission_recorder.record(envelope::permission_request(&request_id, asked.0));
                    Ok(())
                },
                agent_client_protocol::on_receive_request!(),
            )
            .connect_with(agent, async |cx: ConnectionTo<Agent>| {
                let opened = open_session(&cx, cwd)
                    .await
                    .map(|agent_session_id| (agent_session_id, cx.clone()))
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
            }),
    )
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
