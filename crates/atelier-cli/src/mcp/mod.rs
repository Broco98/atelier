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

use std::path::{Path, PathBuf};

use atelier_core::Mode;
use rmcp::{
    handler::server::router::tool::ToolRouter, model::*, tool_handler, transport::stdio,
    ServerHandler, ServiceExt,
};

pub(crate) use tool_error::kernel_error;

/// Maison의 거절 **첫 줄**. 다섯 자리(프로젝트 도구 넷 + `projects`나 `branch`가 실린
/// `atelier_start_work`)가 이 한 문장을 공유한다 — 자리마다 다르게 적으면 에이전트가
/// 「어떤 것은 없고 어떤 것은 안 된다」로 읽고 다음 문을 두드린다.
///
/// **영어인 것은 이 표면이 통째로 영어이기 때문이다** — 도구 설명도 지침도 커널 오류도
/// 에이전트가 읽는 층이라 영어다. 스펙에 적힌 한국어 문장은 뜻이지 리터럴이 아니다.
const NO_PROJECTS_IN_MAISON: &str =
    "Maison has no projects — a Room is a topic and does not attach to a repository.";

/// 프로젝트 도구가 Maison에서 거절될 때 붙는 다음 걸음. 넷이 같은 문장을 쓴다 — 넷 다
/// 「없는 것을 만들려는 시도」라 안내가 갈릴 이유가 없고, 갈라 두면 하나를 고칠 때
/// 나머지 셋이 낡는다.
pub(crate) const DO_NOT_CALL_PROJECT_TOOLS: &str =
    "Do not call the project tools here. A Room needs none of them: give atelier_start_work \
     a `slug` and write the Room's documents into the `specDir` it hands back.";

/// 무상태 도구 표면. 데이터 루트는 기동 시 한 번 확정하고, 모든 작업은 커널에 위임한다.
#[derive(Clone)]
pub struct AtelierServer {
    /// 이 서버가 선 세계. **기동 시 한 번 정해지고 그 뒤로 안 바뀐다** — 호스트가 셸마다
    /// 서버를 새로 띄우므로 모드는 요청의 성질이 아니라 프로세스의 성질이다 (결정 15).
    /// 그래서 도구 이름도 시그니처도 모드를 안 받는다.
    mode: Mode,
    /// 프로젝트 등록부. **모드가 갈려도 하나뿐이다** — 프로젝트는 Atelier에만 있고
    /// (결정 17), Maison 서버는 이 값을 커널에 안 건넨다 (아래 `shared_projects`).
    ///
    /// 프로젝트 **도구**는 이 값을 갈래 없이 쓴다. Maison에서 그 도구들이 커널에 닿기 전에
    /// `refuse_project_work`가 되돌려 보내기 때문이다 — 그쪽이 「없는 것을 만들려는 시도」에
    /// 이유를 붙여 답하는 자리라, 여기서 한 번 더 막으면 같은 사실을 두 곳이 말한다.
    projects_root: PathBuf,
    /// **모드를 함께 받는 커널 함수**에 건네는 등록부. Maison에서는 「없음」이다.
    ///
    /// 갈래를 여기서 안 적는다 — `atelier_core::shared_projects_root`가 앱 명령·다리와
    /// **같은 한 자리**에서 정한다. 세 표면이 각자 `match`를 들고 있던 판에는 하나가
    /// 뒤집혀도 나머지 둘의 검사가 그대로 초록이었다.
    shared_projects: Option<PathBuf>,
    works_root: PathBuf,
    /// 끝난 work가 옮겨가 머무는 루트. 작업 목록을 읽는 경로는 여기를 보지 않는다.
    archive_root: PathBuf,
    /// 데이터 루트. spec 레이아웃을 찾는 자리다 — **경로만** 기동 때 정하고 내용은 호출마다
    /// 읽는다(spec 레이아웃 결정 9, `spec_layout_guidance`).
    data_root: PathBuf,
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
            shared_projects: atelier_core::shared_projects_root(mode),
            works_root: atelier_core::works_dir(mode),
            archive_root: atelier_core::archive_dir(mode),
            data_root: atelier_core::data_root(),
            // 영역별 라우터를 합성한다. 도구를 추가하는 티켓은 파일과 라우터를 하나씩 늘린다.
            tool_router: Self::read_router()
                + Self::work_router()
                + Self::project_router()
                + Self::layout_router(),
        }
    }

    /// **모드를 함께 받는 커널 함수**에 건네는 프로젝트 루트. Maison에서는 「없음」이다.
    ///
    /// 없음인 것은 규약이 아니라 인자다 — 커널이 프로젝트 층을 안 걷고, `start_work`가
    /// `projects`를 받으면 검증에서 걸린다. 프로젝트 **도구** 자체는 아래
    /// `refuse_project_work`가 커널에 닿기 전에 되돌려 보낸다.
    fn shared_projects_root(&self) -> Option<&Path> {
        self.shared_projects.as_deref()
    }

    /// 에이전트가 받는 spec 레이아웃 안내 — 이 서버 모드의 레이아웃을 render한 글이다.
    ///
    /// **호출마다 resolve를 새로 부른다**(spec 레이아웃 결정 9). 기동 때 한 번 읽어 두면 세션 도중에 레이아웃을
    /// 고쳐도 셸을 다시 띄울 때까지 옛 안내가 나간다 — 상주 지침에서 파일 이름을 뺀 까닭과 같다.
    ///
    /// work 지정은 아직 아무도 안 넘긴다(spec 레이아웃 결정 16). 그래서 resolve가 실패할 길이 지금은 없지만,
    /// 실패하면 도구 오류로 올린다 — 안내 없는 응답을 성공으로 내면 에이전트는 모양을 지어낸다.
    fn spec_layout_guidance(&self) -> atelier_core::Result<String> {
        let resolved = atelier_core::resolve_layout(&self.data_root, self.mode, None)?;
        // 경고(빠진 템플릿)는 설정 화면이 보이는 것이다 — 에이전트에게는 빠진 줄로 충분하다.
        Ok(atelier_core::render_layout(
            &resolved.layout,
            resolved.templates.as_ref(),
            resolved.fallback.as_ref(),
        )
        .text)
    }

    /// Maison이면 프로젝트를 건드리는 호출을 **도구 오류**로 되돌려 보낸다.
    /// Atelier면 `None`이라 호출이 그대로 지나간다.
    ///
    /// **거절이 커널이 아니라 어댑터에 있는 이유.** 커널에 맡기면 이유가 엉뚱해진다 —
    /// 등록부를 안 건넨 자리(`shared_projects_root`)는 「project not registered」로 실패하고,
    /// `attach_project`는 등록부를 늘 필요로 해서 시그니처가 「없음」을 받지도 못하며,
    /// `branch`만 온 `start_work`는 **아무 오류도 없이** 그 이름을 work.json에 적는다
    /// (Room에는 브랜치가 없다 — 결정 17). 셋 다 에이전트에게는 「등록만 하면 되겠다」로
    /// 읽혀 없는 것을 만들려 든다.
    ///
    /// `next_step`이 자리마다 다른 것은 이 표면의 규약이다 — 「무엇이 틀렸는가」에 「다음에
    /// 무엇을 하라」를 늘 붙인다 (tool_error.rs).
    fn refuse_project_work(&self, next_step: &str) -> Option<CallToolResult> {
        match self.mode {
            Mode::Atelier => None,
            Mode::Maison => Some(CallToolResult::error(vec![ContentBlock::text(format!(
                "{NO_PROJECTS_IN_MAISON}\n\n{next_step}"
            ))])),
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
            // **지침은 모드별 두 벌이다** — 어휘 교체가 아니라 절차가 다르다 (결정 15).
            // 인스턴스별로 고를 수 있는 것은 `get_info`가 `&self`를 받기 때문이고,
            // 도구 설명(static attribute)은 그 길이 없어 모드 중립으로 적혀 있다.
            // 주의: #[tool_handler(instructions = ...)]는 get_info를 직접 쓴 이 impl에서
            // 조용히 무시된다 (rmcp-macros 2.2.0 tool_handler.rs:91).
            .with_instructions(instructions::for_mode(self.mode))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// **두 번째 자물쇠에 그물을 건다.** 지금 이 배선을 밖에서 관찰할 길이 하나도 없다 —
    /// `shared_projects_root`를 부르는 자리는 둘뿐인데, `start_work`는 위
    /// `refuse_project_work`가 커널 앞에서 되돌려 보내 프로젝트가 실린 호출이 애초에 못
    /// 닿고, Room의 아카이브는 등록부가 `Some`이든 `None`이든 같은 기록을 낸다 (커널의
    /// `record_without_a_project_registry_is_the_same_document`가 그 동치를 못박는다).
    /// 그래서 `Mode::Maison => None`을 뒤집어도 stdio 통합 검사는 전부 초록으로 지나간다.
    ///
    /// 그래서 이 서버가 **그 갈래를 실제로 태웠는지**를 여기서 직접 잰다. 갈래 자체는
    /// 코어(`atelier_core::shared_projects_root`)가 세 표면을 통틀어 한 자리에서 정하고
    /// 거기 자기 검사가 있지만, 그 함수를 이 서버가 부르는지는 그 검사가 못 본다 — 기동에서
    /// 한 번 굳는 값이라(`for_mode`) 되돌리기 쉽고, 되돌아가면 Maison 서버가 Atelier 등록부를
    /// 든 채로 뜬다. 그때 `maison/rooms/<slug>/trees/<project>`에 워크트리가 서는 것을 막는
    /// 마지막 방어선이 이 배선이다 (결정 17).
    #[test]
    fn the_maison_server_hands_the_kernel_no_project_registry() {
        assert!(
            AtelierServer::for_mode(Mode::Maison).shared_projects_root().is_none(),
            "Maison 서버가 커널에 프로젝트 등록부를 건넨다 — Room 안에 워크트리가 선다"
        );
        // Atelier 쪽도 함께 잰다. 「없음」만 재면 둘 다 `None`으로 만들어도 초록이고,
        // 그러면 프로젝트를 실은 work가 통째로 안 선다.
        let atelier = AtelierServer::for_mode(Mode::Atelier);
        assert_eq!(
            atelier.shared_projects_root(),
            Some(atelier.projects_root.as_path()),
            "Atelier 서버가 등록부를 잃었다"
        );
    }
}
