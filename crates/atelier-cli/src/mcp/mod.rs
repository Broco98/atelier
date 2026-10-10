//! `atelier mcp` — 표준입출력 MCP 서버.
//!
//! **서버 경로(`run()` 이하)에서 표준출력은 JSON-RPC 전용 채널이다** — 그 경로의
//! 어떤 코드도 `println!`을 쓰지 않고, 진단은 전부 표준에러로 나간다 (Δ13).
//! `install`은 서버가 아니라 사람·스크립트가 부르는 명령이라 이 규칙 밖이고,
//! 사람용 문장만 표준출력으로 낸다 (install.rs 상단 참조).

mod tool_error;
mod instructions;
mod read_tools;
mod work_tools;
mod project_tools;
mod layout_tools;
mod skill_cleanup;
pub mod install;

use std::path::PathBuf;

use rmcp::{
    handler::server::router::tool::ToolRouter, model::*, tool_handler, transport::stdio,
    ServerHandler, ServiceExt,
};

pub(crate) use tool_error::kernel_error;

/// 무상태 도구 표면. 데이터 루트는 기동 시 한 번 확정하고, 모든 작업은 커널에 위임한다.
#[derive(Clone)]
pub struct AtelierServer {
    /// 프로젝트 등록부.
    projects_root: PathBuf,
    works_root: PathBuf,
    /// 끝난 work가 옮겨가 머무는 루트. 작업 목록을 읽는 경로는 여기를 보지 않는다.
    archive_root: PathBuf,
    /// 데이터 루트. spec 레이아웃을 찾는 자리다 — **경로만** 기동 때 정하고 내용은 호출마다
    /// 읽는다(spec 레이아웃 결정 9, `spec_layout_guidance`).
    data_root: PathBuf,
    tool_router: ToolRouter<AtelierServer>,
}

impl AtelierServer {
    /// 루트는 기동 때 한 번 정한다 — 도구 쪽에서 루트를 다시 고르지 않는다. 기동은 실패하지 않는다: 셸 환경에서
    /// 읽는 것은 데이터 루트(`ATELIER_HOME`, 테스트용)뿐이라, 셸에 다른 값이 남아 있어도 같은 서버가 뜬다(ui-refresh 결정 22).
    pub fn new() -> Self {
        Self {
            projects_root: atelier_core::projects_dir(),
            works_root: atelier_core::works_dir(),
            archive_root: atelier_core::archive_dir(),
            data_root: atelier_core::data_root(),
            // 영역별 라우터를 합성한다. 도구를 추가하는 티켓은 파일과 라우터를 하나씩 늘린다.
            tool_router: Self::read_router()
                + Self::work_router()
                + Self::project_router()
                + Self::layout_router(),
        }
    }

    /// 에이전트가 받는 spec 레이아웃 안내 — 레이아웃을 render한 글이다. 실패하지 않는다: 레이아웃 폴더를 못
    /// 쓰면 내장본으로 물러선 안내문이다(spec 레이아웃 결정 15).
    ///
    /// **호출마다 resolve를 새로 부른다**(spec 레이아웃 결정 9). 기동 때 한 번 읽어 두면 세션 도중에 레이아웃을
    /// 고쳐도 셸을 다시 띄울 때까지 옛 안내가 나간다 — 상주 지침에서 파일 이름을 뺀 까닭과 같다.
    fn spec_layout_guidance(&self) -> String {
        let resolved = atelier_core::resolve_layout(&self.data_root);
        // 경고(빠진 템플릿)는 설정 화면이 보이는 것이다 — 에이전트에게는 빠진 줄로 충분하다.
        atelier_core::render_layout(&resolved.layout, resolved.templates.as_ref(), resolved.fallback.as_ref())
            .text
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for AtelierServer {
    fn get_info(&self) -> ServerInfo {
        // 선언하는 프리미티브는 도구뿐이다 (A2).
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            // from_build_env()는 rmcp 자신의 이름을 내보내므로 쓰지 않는다.
            .with_server_info(Implementation::new("atelier", env!("CARGO_PKG_VERSION")))
            // 절차 지식은 여기 한 곳에만 있다. 스킬 문서는 없다. 지침은 한 벌이다.
            // 주의: #[tool_handler(instructions = ...)]는 get_info를 직접 쓴 이 impl에서
            // 조용히 무시된다 (rmcp-macros 2.2.0 tool_handler.rs:91).
            .with_instructions(instructions::ATELIER)
    }
}

pub fn run() -> anyhow::Result<()> {
    // stdio 전송에서 로그가 표준출력으로 새면 클라이언트 파싱이 깨진다 (Δ13).
    tracing_subscriber::fmt().with_writer(std::io::stderr).with_ansi(false).init();

    let server = AtelierServer::new();

    // 남아 있는 스킬 문서는 없어진 CLI 명령을 계속 안내한다 (Δ4). 첫 접촉에서 지운다.
    // 실패해도 서버는 뜬다 — 정리는 도구 표면을 막을 이유가 못 된다.
    skill_cleanup::purge_and_report();

    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let service = server.serve(stdio()).await?;
        service.waiting().await?;
        Ok::<_, anyhow::Error>(())
    })
}
