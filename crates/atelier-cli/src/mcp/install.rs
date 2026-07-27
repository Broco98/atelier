//! `atelier mcp install` — MCP 호스트에 이 서버를 등록하고 유령 스킬을 정리한다
//! (Δ10 · Δ11).
//!
//! 출력 규약: 사람용 문장은 표준출력, 정리 진단은 표준에러(공유 동작이라 서버 경로와
//! 같은 채널을 쓴다 — §0.5). 이 명령은 stdio 서버가 아니므로 Δ13의 대상이 아니다.

use std::io::ErrorKind;
use std::path::Path;
use std::process::{Command, Stdio};

use super::skill_cleanup;

/// 호스트가 이 서버를 부르는 이름.
const SERVER_NAME: &str = "atelier";

/// **사용자 전역** 스코프 (graph-plan D4 · 가정 A6).
/// `claude mcp add`의 기본값 local 은 "추가한 시점의 저장소 루트"에 고정되는데,
/// Atelier는 모든 프로젝트에서 쓰는 도구이고 설치 스크립트는 아무 폴더에서나 돈다.
const SCOPE: &str = "user";

/// 호스트 등록 도구. 없을 수 있는 경계다 (graph-plan "외부 의존성").
const HOST_CLI: &str = "claude";

enum Outcome {
    Registered,
    /// 호스트 등록 도구가 없다. 실패가 아니라 안내 대상이다.
    HostToolMissing,
}

pub fn run() -> anyhow::Result<()> {
    skill_cleanup::purge_and_report();

    let exe = std::env::current_exe()?;
    match register(&exe)? {
        Outcome::Registered => {
            println!("등록됨: {SERVER_NAME} → {} mcp (scope: {SCOPE})", exe.display());
        }
        Outcome::HostToolMissing => print_manual_guide(&exe),
    }
    Ok(())
}

fn register(exe: &Path) -> anyhow::Result<Outcome> {
    // 1) 먼저 지운다. 같은 이름이 이미 있으면 `add`가 종료코드 1로 거부하고
    //    **경로도 갱신하지 않는다**(§0.2 프로브). 바이너리가 옮겨간 경우까지
    //    멱등하려면 지우고 다시 넣어야 한다.
    //    원래 없어서 실패하는 것도 정상 경로이므로 결과를 보지 않는다.
    match Command::new(HOST_CLI)
        .args(["mcp", "remove", "--scope", SCOPE, SERVER_NAME])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        Ok(_) => {}
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Outcome::HostToolMissing),
        Err(e) => return Err(e.into()),
    }

    // 2) 등록. `--` 뒤가 호스트가 띄울 실행 명령과 인자다.
    let status = Command::new(HOST_CLI)
        .args(["mcp", "add", "--scope", SCOPE, SERVER_NAME, "--"])
        .arg(exe)
        .arg("mcp")
        .status()?;
    anyhow::ensure!(
        status.success(),
        "{HOST_CLI} mcp add 가 실패했습니다 (종료코드 {:?}). 위 출력을 확인하세요.",
        status.code()
    );
    Ok(Outcome::Registered)
}

/// 등록 도구가 없는 환경. **안내만 하고 성공으로 끝낸다** — `install.sh`는
/// `set -euo pipefail` 아래에서 이 명령을 부르고, 여기서 실패하면 스크립트가
/// 약속한 "실패 시 재실행하면 이어서 진행"이 깨진다 (graph-plan D4).
fn print_manual_guide(exe: &Path) {
    let exe = exe.display();
    println!("MCP 호스트 등록 도구(`{HOST_CLI}`)를 찾지 못해 자동 등록을 건너뜁니다.");
    println!("Claude Code를 쓰신다면 아래 한 줄을 직접 실행하세요:");
    println!();
    println!("  {HOST_CLI} mcp add --scope {SCOPE} {SERVER_NAME} -- {exe} mcp");
    println!();
    println!("다른 호스트는 각 설정 파일에 stdio 서버로 같은 명령을 등록하세요:");
    println!("  Codex   ~/.codex/config.toml   [mcp_servers.{SERVER_NAME}]");
    println!("  Gemini  ~/.gemini/settings.json  mcpServers.{SERVER_NAME}");
    println!("  실행 명령: {exe} · 인자: [\"mcp\"]");
}
