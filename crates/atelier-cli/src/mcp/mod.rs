//! `atelier mcp` — 표준입출력 MCP 서버.
//!
//! 표준출력은 JSON-RPC 전용 채널이다. 이 모듈 아래에서는 어떤 경로로도
//! `println!`을 쓰지 않는다 — 진단은 전부 표준에러로 나간다 (Δ13).

mod tool_error;
mod instructions;
mod read_tools;
mod work_tools;
mod project_tools;
mod skill_cleanup;

use rmcp::{
    handler::server::router::tool::ToolRouter, model::*, tool_handler, transport::stdio,
    ServerHandler, ServiceExt,
};

pub(crate) use tool_error::kernel_error;

/// 무상태 도구 표면. 데이터 루트는 기동 시 한 번 확정하고, 모든 작업은 커널에 위임한다.
#[derive(Clone)]
pub struct AtelierServer {
    projects_root: std::path::PathBuf,
    works_root: std::path::PathBuf,
    tool_router: ToolRouter<AtelierServer>,
}

impl AtelierServer {
    pub fn new() -> Self {
        Self {
            projects_root: atelier_core::projects_dir(),
            works_root: atelier_core::works_dir(),
            // 영역별 라우터를 합성한다. 도구를 추가하는 티켓은 파일과 라우터를 하나씩 늘린다.
            tool_router: Self::read_router() + Self::work_router() + Self::project_router(),
        }
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for AtelierServer {
    fn get_info(&self) -> ServerInfo {
        // 선언하는 프리미티브는 도구뿐이다 (A2).
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            // from_build_env()는 rmcp 자신의 이름을 내보내므로 쓰지 않는다.
            .with_server_info(Implementation::new("atelier", env!("CARGO_PKG_VERSION")))
            // 절차 지식은 여기 한 곳에만 있다. 스킬 문서는 없다.
            // 주의: #[tool_handler(instructions = ...)]는 get_info를 직접 쓴 이 impl에서
            // 조용히 무시된다 (rmcp-macros 2.2.0 tool_handler.rs:91).
            .with_instructions(instructions::INSTRUCTIONS)
    }
}

pub fn run() -> anyhow::Result<()> {
    // stdio 전송에서 로그가 표준출력으로 새면 클라이언트 파싱이 깨진다 (Δ13).
    tracing_subscriber::fmt().with_writer(std::io::stderr).with_ansi(false).init();

    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let service = AtelierServer::new().serve(stdio()).await?;
        service.waiting().await?;
        Ok::<_, anyhow::Error>(())
    })
}
