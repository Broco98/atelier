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
mod skill_cleanup;
pub mod install;

use std::path::{Path, PathBuf};

use atelier_core::Mode;
use rmcp::{
    handler::server::router::tool::ToolRouter, model::*, tool_handler, transport::stdio,
    ServerHandler, ServiceExt,
};

pub(crate) use tool_error::kernel_error;

/// 무상태 도구 표면. 데이터 루트는 기동 시 한 번 확정하고, 모든 작업은 커널에 위임한다.
#[derive(Clone)]
pub struct AtelierServer {
    /// 이 서버가 선 세계. **기동 시 한 번 정해지고 그 뒤로 안 바뀐다** — 호스트가 셸마다
    /// 서버를 새로 띄우므로 모드는 요청의 성질이 아니라 프로세스의 성질이다 (결정 15).
    /// 그래서 도구 이름도 시그니처도 모드를 안 받는다.
    mode: Mode,
    /// 프로젝트 등록부. **모드가 갈려도 하나뿐이다** — 프로젝트는 Atelier에만 있고
    /// (결정 17), Maison 서버는 이 값을 커널에 안 건넨다 (`shared_projects_root`).
    projects_root: PathBuf,
    works_root: PathBuf,
    /// 끝난 work가 옮겨가 머무는 루트. 작업 목록을 읽는 경로는 여기를 보지 않는다.
    archive_root: PathBuf,
    tool_router: ToolRouter<AtelierServer>,
}

impl AtelierServer {
    /// **기동은 실패할 수 있다.** `ATELIER_MODE`에 모르는 값이 오면 여기서 끝난다 —
    /// 조용히 Atelier로 누우면 생활 쪽 셸의 에이전트가 일 목록을 그대로 본다 (스펙 US 46).
    pub fn new() -> atelier_core::Result<Self> {
        Ok(Self::for_mode(atelier_core::mode_from_env()?))
    }

    /// 루트 셋을 모드 하나로 정한다. **여기가 두 세계가 갈리는 유일한 자리다** —
    /// 도구 쪽에서 루트를 다시 고르면 새 도구가 그 분기를 잊는 날 세계가 섞인다.
    fn for_mode(mode: Mode) -> Self {
        Self {
            mode,
            projects_root: atelier_core::projects_dir(),
            works_root: atelier_core::works_dir(mode),
            archive_root: atelier_core::archive_dir(mode),
            // 영역별 라우터를 합성한다. 도구를 추가하는 티켓은 파일과 라우터를 하나씩 늘린다.
            tool_router: Self::read_router() + Self::work_router() + Self::project_router(),
        }
    }

    /// **모드를 함께 받는 커널 함수**에 건네는 프로젝트 루트. Maison에서는 「없음」이다.
    ///
    /// 없음인 것은 규약이 아니라 인자다 — 커널이 프로젝트 층을 안 걷고, `start_work`가
    /// `projects`를 받으면 검증에서 걸린다. 프로젝트 **도구** 자체(`atelier_list_projects`·
    /// `add`·`edit`·`attach`)를 거절하는 것은 다음 티켓(#180)이고, 그때까지 그 넷은
    /// `projects_root`를 직접 읽어 Atelier 등록부를 본다.
    fn shared_projects_root(&self) -> Option<&Path> {
        match self.mode {
            Mode::Atelier => Some(&self.projects_root),
            Mode::Maison => None,
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

    // **모드를 가장 먼저 읽는다.** 모르는 값이면 핸드셰이크는커녕 아무것도 하기 전에
    // 끝나야 한다 (스펙 US 46) — 아래 스킬 정리보다 뒤로 밀면 「뜨지도 않은 서버가 파일은
    // 지웠다」가 된다. 오류는 main이 표준에러에 쓰고 0 아닌 코드로 나간다.
    let server = AtelierServer::new()?;

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
