//! 세션 매니저를 **가짜 ACP 에이전트에 붙여서** 돌린다.
//!
//! 어댑터 설정의 커맨드를 가짜 실행 파일로 가리키므로 제품이 쓰는 바로 그 경로로 들어간다 —
//! 테스트 전용 주입점은 없다. 임시 디렉터리로 격리되어 사용자 홈·네트워크·패키지 실행기에
//! 의존하지 않는다.

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use atelier_acp::{Listener, SessionManager, SessionPaths};
use atelier_core::{Session, StartPoint};

/// 어댑터 설정이 가리킬 실행 파일. cargo가 경로를 알려준다.
const FAKE_AGENT: &str = env!("CARGO_BIN_EXE_fake-agent");

struct Sandbox {
    _tmp: tempfile::TempDir,
    paths: SessionPaths,
    project_slug: String,
    project_path: String,
}

impl Sandbox {
    /// 등록된 프로젝트 하나와, 주어진 커맨드를 codex 어댑터로 삼는 설정을 갖춘 데이터 루트.
    fn with_command(command: &str) -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let paths = SessionPaths {
            sessions: tmp.path().join("sessions"),
            projects: tmp.path().join("projects"),
            adapters_file: tmp.path().join("adapters.json"),
        };
        std::fs::write(
            &paths.adapters_file,
            serde_json::json!({ "codex": command }).to_string(),
        )
        .unwrap();

        let folder = tmp.path().join("my-app");
        std::fs::create_dir_all(&folder).unwrap();
        let project = atelier_core::create_project(&paths.projects, &folder).unwrap();

        Self {
            _tmp: tmp,
            paths,
            project_slug: project.project.slug,
            project_path: project.project.path,
        }
    }

    fn normal_agent() -> Self {
        Self::with_command(&format!("{FAKE_AGENT:?} normal"))
    }

    fn manager(&self) -> SessionManager {
        self.manager_watched_by(Arc::new(|_, _, _| {}))
    }

    fn manager_watched_by(&self, listener: Listener) -> SessionManager {
        SessionManager::new(self.paths.clone(), listener)
    }

    fn start_point(&self) -> StartPoint {
        StartPoint::Project {
            slug: self.project_slug.clone(),
        }
    }

    fn session_dirs(&self) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(&self.paths.sessions) else {
            return Vec::new();
        };
        entries
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect()
    }
}

/// 가짜 에이전트는 세션 id에 자기 pid를 넣는다(`fake-<pid>-<n>`).
fn pid_of(session: &Session) -> u32 {
    session
        .agent_session_id
        .split('-')
        .nth(1)
        .unwrap_or_else(|| panic!("세션 id에서 pid를 못 읽었다: {}", session.agent_session_id))
        .parse()
        .unwrap()
}

/// 좀비는 이미 죽은 프로세스다 — 부모가 거둘 때까지 표에만 남아 있으므로 살아있음으로 세지 않는다.
fn is_running(pid: u32) -> bool {
    let out = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "state="])
        .output()
        .expect("ps를 돌리지 못했다");
    let state = String::from_utf8_lossy(&out.stdout).trim().to_string();
    !state.is_empty() && !state.starts_with('Z')
}

fn wait_until_gone(pid: u32) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if !is_running(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

#[test]
fn starting_from_a_project_opens_a_session_and_records_it() {
    let sandbox = Sandbox::normal_agent();
    let manager = sandbox.manager();

    let started = manager.start(sandbox.start_point()).unwrap();

    assert!(started.alive);
    assert_eq!(started.session.agent, "codex");
    assert_eq!(
        started.session.cwd, sandbox.project_path,
        "화면에 보이는 디렉터리"
    );
    assert_eq!(started.session.start_point, sandbox.start_point());
    assert!(
        started.session.agent_session_id.starts_with("fake-"),
        "에이전트가 준 세션 id가 남아야 한다: {}",
        started.session.agent_session_id
    );

    // 신원 파일이 디스크에 남았고, 목록으로 다시 나온다
    let listed = manager.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].session, started.session);
    assert!(listed[0].alive);
}

/// 화면에 보이는 디렉터리와 **에이전트가 실제로 받은 디렉터리**가 같은가. 아틀리에가 스스로
/// 적은 값끼리 비교하면 동어반복이므로, 상대 프로세스가 그 자리에 남긴 영수증을 읽는다.
///
/// 같은 영수증으로 확정 결정 10도 함께 본다 — 클라이언트 능력은 하나도 켜지지 않아야 한다.
#[test]
fn the_agent_is_pointed_at_the_project_directory_with_no_client_capabilities() {
    let sandbox = Sandbox::normal_agent();
    let manager = sandbox.manager();

    let started = manager.start(sandbox.start_point()).unwrap();

    let project_dir = atelier_core::expand_home(&started.session.cwd);
    // 파일 이름은 crates/atelier-acp/src/bin/fake-agent.rs 의 RECEIPT 와 같아야 한다.
    let receipt: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(project_dir.join(".atelier-fake-agent.json"))
            .expect("에이전트가 자기가 받은 디렉터리에 영수증을 남기지 않았다"),
    )
    .unwrap();

    assert_eq!(
        receipt["cwd"].as_str().unwrap(),
        project_dir.to_string_lossy(),
        "에이전트가 받은 디렉터리가 화면에 보이는 것과 달랐다"
    );

    let declared = &receipt["clientCapabilities"];
    for capability in [
        &declared["fs"]["readTextFile"],
        &declared["fs"]["writeTextFile"],
        &declared["terminal"],
    ] {
        assert!(
            !capability.as_bool().unwrap_or(false),
            "클라이언트 능력은 하나도 선언하지 않는다 (확정 결정 10): {declared}"
        );
    }
}

/// 봉투 한 줄이 무엇인지 한 마디로 — `user_prompt`, 또는 `session_update:<종류>`.
fn kind_of(line: &serde_json::Value) -> String {
    match line["kind"].as_str().unwrap_or("?") {
        "session_update" => format!(
            "session_update:{}",
            line["payload"]["update"]["sessionUpdate"]
                .as_str()
                .unwrap_or("?")
        ),
        other => other.to_string(),
    }
}

const PROMPT: &str = "첫 지시\n둘째 줄";

#[test]
fn a_prompt_and_the_agents_updates_pile_up_in_the_order_they_were_sent() {
    let sandbox = Sandbox::normal_agent();
    let manager = sandbox.manager();
    let started = manager.start(sandbox.start_point()).unwrap();

    manager.prompt(&started.session.id, PROMPT).unwrap();

    let lines = manager.updates(&started.session.id).unwrap();
    let order: Vec<String> = lines.iter().map(kind_of).collect();
    assert_eq!(
        order,
        vec![
            // 세션 id가 정해지기 전에 온 말이다. 버려지지 않고 맨 앞에 온다.
            "session_update:available_commands_update",
            "user_prompt",
            "session_update:agent_message_chunk",
            "session_update:tool_call",
            "session_update:agent_message_chunk",
            "session_update:usage_update",
        ],
        "내가 친 것과 에이전트가 보낸 것이 보낸 순서 그대로 쌓인다"
    );

    assert_eq!(lines[1]["text"], PROMPT, "내가 친 말이 그대로 남는다");
    assert!(
        lines.iter().all(|line| line["at"].is_string()),
        "모든 봉투에 시각이 있다"
    );
    // 프로토콜 페이로드는 봉투 안에 손대지 않은 채 들어간다 — 에이전트가 보낸 모양 그대로
    assert_eq!(
        lines[4]["payload"]["update"],
        serde_json::json!({
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": PROMPT}
        })
    );
    assert_eq!(
        lines[4]["payload"]["sessionId"], started.session.agent_session_id,
        "에이전트가 실은 세션 id까지 그대로 들어간다"
    );
}

/// 응답이 **완성되기를 기다리지 않고** 조각이 밖으로 나가는가. 턴이 도는 동안에 온 조각이
/// 하나라도 있으면 참이다 — 잠들었다 재는 대신 턴의 안팎을 깃발로 가른다.
#[test]
fn chunks_reach_the_listener_while_the_turn_is_still_running() {
    let sandbox = Sandbox::normal_agent();
    let turn_running = Arc::new(AtomicBool::new(false));
    let arrived_mid_turn = Arc::new(AtomicBool::new(false));
    let seen: Arc<Mutex<Vec<(usize, String)>>> = Arc::new(Mutex::new(Vec::new()));

    let manager = sandbox.manager_watched_by({
        let (turn_running, arrived_mid_turn, seen) =
            (turn_running.clone(), arrived_mid_turn.clone(), seen.clone());
        Arc::new(move |_id: &str, at: usize, line: &serde_json::Value| {
            // 내가 친 말은 세지 않는다 — 그건 턴이 시작되기 전에 우리가 스스로 적은 줄이다.
            let from_agent = line["kind"] == "session_update";
            if from_agent && turn_running.load(Ordering::SeqCst) {
                arrived_mid_turn.store(true, Ordering::SeqCst);
            }
            seen.lock().unwrap().push((at, kind_of(line)));
        })
    });
    let started = manager.start(sandbox.start_point()).unwrap();

    turn_running.store(true, Ordering::SeqCst);
    manager.prompt(&started.session.id, PROMPT).unwrap();
    turn_running.store(false, Ordering::SeqCst);

    assert!(
        arrived_mid_turn.load(Ordering::SeqCst),
        "턴이 끝난 뒤에야 몰아서 나오면 스트리밍이 아니다"
    );

    // 밖으로 흘린 줄이 **파일의 몇 번째 줄인지**까지 맞아야 화면이 재생과 라이브가 겹치는
    // 자리를 알아본다 — 겹치면 두 번 그려지고, 어긋나면 조각이 빠진다.
    let recorded: Vec<(usize, String)> = manager
        .updates(&started.session.id)
        .unwrap()
        .iter()
        .map(kind_of)
        .enumerate()
        .collect();
    assert_eq!(*seen.lock().unwrap(), recorded);
}

#[test]
fn the_first_prompt_names_the_session_and_later_ones_do_not_rename_it() {
    let sandbox = Sandbox::normal_agent();
    let manager = sandbox.manager();
    let started = manager.start(sandbox.start_point()).unwrap();

    manager.prompt(&started.session.id, PROMPT).unwrap();
    let after_first = manager.updates(&started.session.id).unwrap();

    manager.prompt(&started.session.id, "두 번째 지시").unwrap();

    let titles: Vec<Option<String>> = manager
        .list()
        .unwrap()
        .into_iter()
        .map(|view| view.session.title)
        .collect();
    assert_eq!(
        titles,
        vec![Some("첫 지시".to_string())],
        "제목은 첫 프롬프트의 첫 줄이고, 뒤 프롬프트가 덮지 않는다"
    );

    // 기록은 덧붙이기만 한다 — 앞서 쌓인 줄들이 그대로 남아 있어야 한다
    let after_second = manager.updates(&started.session.id).unwrap();
    assert_eq!(after_second[..after_first.len()], after_first[..]);
    assert!(after_second.len() > after_first.len());
}

/// 답을 얻지 못한 턴도 대화의 일부다. 다이얼로그만 띄우고 말면 그 화면을 닫는 순간 사라지고,
/// 다시 열었을 때 **내 말만 있고 답도 이유도 없는 대화**가 남는다.
#[test]
fn a_turn_that_gets_no_answer_still_leaves_its_reason_in_the_record() {
    let sandbox = Sandbox::with_command(&format!("{FAKE_AGENT:?} refuses-prompt"));
    let manager = sandbox.manager();
    let started = manager.start(sandbox.start_point()).unwrap();

    let error = manager
        .prompt(&started.session.id, PROMPT)
        .unwrap_err()
        .to_string();
    assert!(error.contains("model unavailable"), "{error}");

    let lines = manager.updates(&started.session.id).unwrap();
    let order: Vec<String> = lines.iter().map(kind_of).collect();
    assert_eq!(
        order,
        vec![
            "session_update:available_commands_update",
            "user_prompt",
            "turn_failed",
        ]
    );
    assert!(
        lines[2]["message"]
            .as_str()
            .is_some_and(|why| why.contains("model unavailable")),
        "왜 실패했는지가 기록에 남아야 한다: {}",
        lines[2]
    );
}

/// 카드에 답하는 한 턴이 남긴 것들. 스코프 안에서 본 것을 그대로 들고 나온다.
struct Asked {
    request_id: String,
    /// 답하기 직전, 목록이 "기다리는 중"을 드러냈는가.
    awaiting: bool,
    /// 에이전트가 주지 않은 선택지로 답해 봤을 때 — 거절당했는가, 그리고 카드는 남았는가.
    made_up_refused: bool,
    card_kept: bool,
    turn: atelier_acp::Result<()>,
}

/// 한 턴을 보내고, 카드가 뜨면 주어진 선택지로 답한 뒤 턴이 끝나기를 기다린다.
///
/// **스코프 안에서는 어긋난 것을 외치지 않는다.** 스코프는 자식 스레드가 끝나야 빠져나오는데
/// 답하지 못한 턴은 영원히 돌기 때문에, 여기서 패닉하면 실패가 아니라 **멈춤**이 된다. 본 것은
/// 값으로 들고 나가 밖에서 따지고, 끝내 답하지 못하면 세션을 접어 턴을 풀어 준다.
fn turn_answering_with(manager: &SessionManager, session_id: &str, option_id: &str) -> Asked {
    let asked = std::thread::scope(|scope| {
        let turn = scope.spawn(|| manager.prompt(session_id, PROMPT));

        let Some(request_id) = wait_for_permission(manager, session_id) else {
            manager.close_all();
            return None;
        };
        let awaiting = awaiting_permission(manager);
        let made_up = manager.answer_permission(session_id, &request_id, "고르지 않은 것");
        let card_kept = awaiting_permission(manager);

        if manager
            .answer_permission(session_id, &request_id, option_id)
            .is_err()
        {
            manager.close_all();
        }
        Some(Asked {
            request_id,
            awaiting,
            made_up_refused: made_up.is_err(),
            card_kept,
            turn: turn.join().unwrap(),
        })
    });
    asked.expect("권한 요청이 오지 않았다")
}

/// 카드가 뜰 때까지 기다린다. 프롬프트는 답을 줄 때까지 돌아오지 않으므로 **다른 스레드**가
/// 이것을 본다. 기다리는 자리는 기록 파일이다 — 매니저의 속을 들여다보지 않는다.
fn wait_for_permission(manager: &SessionManager, session_id: &str) -> Option<String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        let asked = manager
            .updates(session_id)
            .unwrap_or_default()
            .into_iter()
            .find_map(|line| {
                (line["kind"] == "permission_request")
                    .then(|| line["requestId"].as_str().map(str::to_string))
                    .flatten()
            });
        if asked.is_some() {
            return asked;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    None
}

fn awaiting_permission(manager: &SessionManager) -> bool {
    manager
        .list()
        .is_ok_and(|listed| listed[0].awaiting_permission)
}

/// 허용을 누르면 세션이 끊기지 않고 그 자리에서 이어진다. 그리고 그 승인이 기록에 남아
/// **기록만 읽어도 무엇을 승인했는지** 성립한다.
#[test]
fn allowing_a_permission_lets_the_turn_go_on_and_pairs_in_the_record() {
    let sandbox = Sandbox::with_command(&format!("{FAKE_AGENT:?} asks-permission"));
    let manager = sandbox.manager();
    let started = manager.start(sandbox.start_point()).unwrap();

    let asked = turn_answering_with(&manager, &started.session.id, "yes");
    let asking = asked.request_id;

    asked.turn.expect("허용했으니 턴은 끝까지 간다");
    // 답하지 않은 요청은 목록에서 눈에 띈다 — 내가 아니라 **에이전트가 나를 기다리는 중**이다
    assert!(asked.awaiting, "답을 기다리는 동안 목록이 그것을 드러내야 한다");
    // 에이전트가 주지 않은 선택지로는 답할 수 없다. 그리고 그렇게 빗나간 답이 **카드를
    // 가져가 버리면** 사람에게는 다시 답할 길이 없다.
    assert!(asked.made_up_refused, "없는 선택지로 답할 수는 없다");
    assert!(asked.card_kept, "빗나간 답이 카드를 가져가면 안 된다");

    let listed = manager.list().unwrap();
    assert!(listed[0].alive, "허용한 세션은 그대로 살아 있다");
    assert!(
        !listed[0].awaiting_permission,
        "답한 뒤에는 기다림이 사라진다"
    );

    let lines = manager.updates(&started.session.id).unwrap();
    let order: Vec<String> = lines.iter().map(kind_of).collect();
    assert_eq!(
        order,
        vec![
            "session_update:available_commands_update",
            "user_prompt",
            "session_update:tool_call",
            "permission_request",
            // 답이 **에이전트가 다시 움직이기 전에** 남는다 — 재생이 순서를 뒤집지 않도록
            "permission_response",
            "session_update:agent_message_chunk",
        ]
    );

    // 요청과 답이 서로 짝지어진다
    assert_eq!(lines[3]["requestId"], asking.as_str());
    assert_eq!(lines[4]["requestId"], asking.as_str());
    assert_eq!(lines[4]["outcome"], "allow");
    assert_eq!(lines[4]["optionId"], "yes", "실제로 고른 것도 남는다");

    // 물음이 실어 온 도구는 **갱신**이라 이름도 입력도 없다. 손대지 않고 그대로 담고,
    // 어떤 도구인지는 같은 번호로 앞의 도구 호출을 찾아 알아낸다 (화면이 그렇게 그린다).
    assert_eq!(
        lines[3]["payload"]["toolCall"],
        serde_json::json!({"toolCallId": "call-1", "kind": "execute", "status": "pending"})
    );
    assert_eq!(
        lines[2]["payload"]["update"]["rawInput"],
        serde_json::json!({"command": "echo hi"}),
        "어떤 입력으로 쓰려는지는 앞선 도구 호출에 남아 있다"
    );
    assert_eq!(
        lines[5]["payload"]["update"]["content"]["text"], "허락받아 echo hi 를 실행했다",
        "허용을 받은 에이전트가 그 자리에서 이어 간다"
    );

    // 같은 카드에 두 번 답할 수는 없다 — 두 번째 누름이 조용히 통과하면 안 된다
    let again = manager
        .answer_permission(&started.session.id, &asking, "yes")
        .unwrap_err()
        .to_string();
    assert!(again.contains(&asking), "어느 요청이 문제인지 보여야 한다: {again}");
}

/// 거부해도 세션이 죽지 않는다. 턴은 실패가 아니라 **다른 길로** 끝난다.
#[test]
fn denying_a_permission_does_not_kill_the_session() {
    let sandbox = Sandbox::with_command(&format!("{FAKE_AGENT:?} asks-permission"));
    let manager = sandbox.manager();
    let started = manager.start(sandbox.start_point()).unwrap();

    let asked = turn_answering_with(&manager, &started.session.id, "no");
    asked.turn.expect("거부는 턴의 실패가 아니다");

    let listed = manager.list().unwrap();
    assert!(listed[0].alive, "거부했다고 세션이 죽으면 안 된다");
    assert!(
        is_running(pid_of(&listed[0].session)),
        "자식 프로세스도 그대로 떠 있어야 한다"
    );

    let lines = manager.updates(&started.session.id).unwrap();
    assert_eq!(lines[4]["outcome"], "deny");
    assert_eq!(
        lines[5]["payload"]["update"]["content"]["text"], "허락받지 못해 다른 길로 간다",
        "거부를 받은 에이전트가 다른 길을 찾는다"
    );
}

#[test]
fn prompting_a_session_that_is_not_running_fails_readably() {
    let sandbox = Sandbox::normal_agent();
    let id = {
        let manager = sandbox.manager();
        manager.start(sandbox.start_point()).unwrap().session.id
    };

    // 새로 켠 앱에는 살아있는 세션이 하나도 없다
    let manager = sandbox.manager();
    let error = manager.prompt(&id, PROMPT).unwrap_err().to_string();

    assert!(
        error.contains(&id),
        "어느 세션이 말을 받지 못했는지 읽을 수 있어야 한다: {error}"
    );
    assert!(
        !manager
            .updates(&id)
            .unwrap()
            .iter()
            .any(|line| line["kind"] == "user_prompt"),
        "보내지 못한 말은 기록에도 남지 않는다"
    );
}

#[test]
fn two_starts_from_the_same_project_are_two_sessions() {
    let sandbox = Sandbox::normal_agent();
    let manager = sandbox.manager();

    let first = manager.start(sandbox.start_point()).unwrap().session;
    let second = manager.start(sandbox.start_point()).unwrap().session;

    assert_ne!(first.id, second.id);
    assert_ne!(
        first.agent_session_id, second.agent_session_id,
        "두 신원 파일의 에이전트 세션 id가 서로 달라야 한다"
    );
    assert!(
        is_running(pid_of(&first)) && is_running(pid_of(&second)),
        "자식이 둘 떠 있다"
    );
    assert_eq!(manager.list().unwrap().len(), 2);
}

#[test]
fn an_unrunnable_command_fails_readably_and_leaves_no_session() {
    let sandbox = Sandbox::with_command("atelier-no-such-agent --acp");
    let manager = sandbox.manager();

    let error = manager
        .start(sandbox.start_point())
        .unwrap_err()
        .to_string();

    assert!(
        error.contains("atelier-no-such-agent --acp"),
        "무엇을 실행하려다 실패했는지 읽을 수 있어야 한다: {error}"
    );
    assert!(
        sandbox.session_dirs().is_empty(),
        "세션 폴더가 만들어지면 안 된다"
    );
    assert!(manager.list().unwrap().is_empty(), "목록도 그대로여야 한다");
}

/// 실행은 되지만 ACP를 말하지 않는 상대. 핸드셰이크에서 막히고, 이때도 커맨드가 보여야 한다.
#[test]
fn a_command_that_is_not_an_acp_agent_also_fails_readably() {
    let sandbox = Sandbox::with_command(&format!("{FAKE_AGENT:?} no-such-scenario"));
    let manager = sandbox.manager();

    let error = manager
        .start(sandbox.start_point())
        .unwrap_err()
        .to_string();

    assert!(
        error.contains("no-such-scenario"),
        "커맨드가 오류에 보여야 한다: {error}"
    );
    assert!(sandbox.session_dirs().is_empty());
}

#[test]
fn closing_the_manager_kills_the_child() {
    let sandbox = Sandbox::normal_agent();
    let session = {
        let manager = sandbox.manager();
        let session = manager.start(sandbox.start_point()).unwrap().session;
        assert!(is_running(pid_of(&session)));
        session
    };

    assert!(
        wait_until_gone(pid_of(&session)),
        "매니저를 접었는데 자식이 남았다"
    );
}

/// 앱이 닫히기 시작한 뒤에 세션이 다 떠도 서지 않는다. 그 자식은 아무도 거두지 못하고,
/// 자기 프로세스 그룹의 리더라 부모가 죽어도 따라 죽지 않기 때문이다.
#[test]
fn a_start_that_lands_after_closing_is_refused_and_reaped() {
    let sandbox = Sandbox::normal_agent();
    let manager = sandbox.manager();
    manager.close_all();

    let error = manager
        .start(sandbox.start_point())
        .unwrap_err()
        .to_string();

    assert!(
        error.contains("closing"),
        "닫는 중이라는 오류여야 한다: {error}"
    );
    assert!(
        sandbox.session_dirs().is_empty(),
        "서지 않은 세션의 폴더가 남으면 안 된다"
    );
}

/// 살아있음은 런타임의 사실이라 신원 파일에 적히지 않는다. 그래서 새로 켠 앱에서는 전부 죽음이다.
#[test]
fn a_fresh_manager_sees_every_session_as_dead() {
    let sandbox = Sandbox::normal_agent();
    {
        let manager = sandbox.manager();
        manager.start(sandbox.start_point()).unwrap();
    }

    let listed = sandbox.manager().list().unwrap();

    assert_eq!(listed.len(), 1, "목록은 앱을 껐다 켜도 남는다");
    assert!(!listed[0].alive);

    let raw = std::fs::read_to_string(
        sandbox
            .paths
            .sessions
            .join(&listed[0].session.id)
            .join("session.json"),
    )
    .unwrap();
    assert!(
        !raw.contains("alive"),
        "살아있음이 디스크에 적히면 안 된다: {raw}"
    );
}
