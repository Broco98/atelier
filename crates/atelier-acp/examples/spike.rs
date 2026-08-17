//! 실물 ACP 에이전트를 상대로 spawn → 핸드셰이크 → 세션 열기까지만 통과시키고 끝나는 헤드리스 스파이크.
//!
//! 저장소도 앱 층도 화면도 건드리지 않는다. 세션이 뜨는 디렉터리는 이 프로세스의 현재 디렉터리다.
//!
//! ```bash
//! cargo run -p atelier-acp --example spike                    # 확정 결정 2의 기본 커맨드
//! cargo run -p atelier-acp --example spike -- "<다른 커맨드>"
//! ```

use std::str::FromStr;

use agent_client_protocol::schema::v1::{InitializeRequest, NewSessionRequest};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use atelier_acp::DEFAULT_CODEX_COMMAND;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let command = std::env::args()
        .nth(1)
        .unwrap_or_else(|| DEFAULT_CODEX_COMMAND.to_string());
    let cwd = std::env::current_dir()?;

    eprintln!("커맨드: {command}");
    eprintln!("cwd:    {}", cwd.display());

    let agent = AcpAgent::from_str(&command)?;

    // 비동기 런타임을 따로 들이지 않고 futures의 실행기로만 돌린다. 이것이 성립하면
    // 이 크레이트는 tokio 없이 서고, 앱은 세션마다 스레드 하나로 연결을 쥘 수 있다.
    futures::executor::block_on(Client.builder().name("atelier").connect_with(
        agent,
        async |cx: ConnectionTo<Agent>| {
            // 클라이언트 능력은 하나도 선언하지 않는다 (확정 결정 10).
            let init = cx
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            eprintln!("agent_info: {:?}", init.agent_info);
            eprintln!(
                "agentCapabilities: {}",
                serde_json::to_string(&init.agent_capabilities)
                    .unwrap_or_else(|e| format!("<직렬화 실패: {e}>"))
            );
            eprintln!(
                "과거 세션 불러오기(loadSession) 지원: {}",
                init.agent_capabilities.load_session
            );

            // 연결을 복제해 다른 OS 스레드로 넘기고 거기서 session/new를 부른다.
            // 앱에서는 Tauri 커맨드 스레드가 이 자리에 온다.
            let (tx, rx) = futures::channel::oneshot::channel();
            let connection = cx.clone();
            std::thread::spawn(move || {
                let opened = futures::executor::block_on(
                    connection
                        .send_request(NewSessionRequest::new(cwd))
                        .block_task(),
                );
                let _ = tx.send(opened);
            });
            let session = rx.await.expect("세션을 연 스레드가 답하기 전에 끊겼다")?;

            eprintln!("session_id: {:?}", session.session_id);
            eprintln!("여기까지 통과. 연결을 접는다.");
            Ok(())
        },
    ))?;

    Ok(())
}
