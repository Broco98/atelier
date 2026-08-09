//! 세션 매니저를 **가짜 ACP 에이전트에 붙여서** 돌린다.
//!
//! 어댑터 설정의 커맨드를 가짜 실행 파일로 가리키므로 제품이 쓰는 바로 그 경로로 들어간다 —
//! 테스트 전용 주입점은 없다. 임시 디렉터리로 격리되어 사용자 홈·네트워크·패키지 실행기에
//! 의존하지 않는다.

use std::process::Command;
use std::time::{Duration, Instant};

use atelier_acp::{SessionManager, SessionPaths};
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
        SessionManager::new(self.paths.clone())
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
