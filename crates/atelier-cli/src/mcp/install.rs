//! `atelier mcp install` — MCP 호스트들에 이 서버를 등록하고 유령 스킬을 정리한다
//! (Δ10 · Δ11 · 결정 95 · 103).
//!
//! 출력 규약: 사람용 문장은 표준출력, 정리 진단은 표준에러(공유 동작이라 서버 경로와
//! 같은 채널을 쓴다 — §0.5). 이 명령은 stdio 서버가 아니므로 Δ13의 대상이 아니다.

use std::io::ErrorKind;
use std::path::Path;
use std::process::{Command, Stdio};

use super::skill_cleanup;

/// 호스트가 이 서버를 부르는 이름.
const SERVER_NAME: &str = "atelier";

/// 등록할 호스트 하나.
///
/// **스코프가 전역 상수가 아니라 호스트의 성질이다**(결정 95). Claude Code의 기본 스코프
/// local 은 "추가한 시점의 저장소 루트"에 고정되는데 Atelier는 모든 프로젝트에서 쓰는
/// 도구이고 설치 스크립트는 아무 폴더에서나 돈다 — 그래서 `user`다 (graph-plan D4 · 가정 A6).
/// Codex에는 고를 것이 없다: 설정이 `~/.codex/config.toml` 하나뿐이라 그 인자가 아예 없다.
struct Host {
    /// PATH에서 찾을 실행 파일 이름. 없을 수 있는 경계다 (graph-plan "외부 의존성").
    cli: &'static str,
    scope: Option<&'static str>,
}

const HOSTS: &[Host] = &[
    Host { cli: "claude", scope: Some("user") },
    Host { cli: "codex", scope: None },
];

enum Outcome {
    Registered,
    /// 호스트 등록 도구가 없다. 실패가 아니라 안내 대상이다.
    Missing,
    /// 도구는 있는데 등록이 0이 아닌 코드로 끝났다. 이것도 안내 대상이다 (결정 103).
    Failed,
}

pub fn run() -> anyhow::Result<()> {
    skill_cleanup::purge_and_report();

    let exe = std::env::current_exe()?;
    // **호스트 하나의 사정이 다른 호스트를 막지 않는다.** 하나가 없거나 실패해도 나머지는
    // 그대로 등록되고, 명령 전체는 0으로 끝난다 — `install.sh`가 `set -euo pipefail` 아래에서
    // 이것을 부르므로 여기서 0이 아니면 그 스크립트가 약속한 멱등성이 깨진다 (결정 103).
    for host in HOSTS {
        match register(host, &exe)? {
            Outcome::Registered => println!(
                "등록됨: {SERVER_NAME} → {} mcp ({})",
                exe.display(),
                scope_note(host)
            ),
            Outcome::Missing => {
                println!("{}를 찾지 못해 건너뜁니다. 직접 등록하려면:", host.cli);
                print_manual_line(host, &exe);
            }
            Outcome::Failed => {
                println!("{} 등록이 실패했습니다. 직접 등록하려면:", host.cli);
                print_manual_line(host, &exe);
            }
        }
    }
    Ok(())
}

fn register(host: &Host, exe: &Path) -> anyhow::Result<Outcome> {
    // 1) 먼저 지운다. 같은 이름이 이미 있으면 `add`가 종료코드 1로 거부하고
    //    **경로도 갱신하지 않는다**(§0.2 프로브). 바이너리가 옮겨간 경우까지
    //    멱등하려면 지우고 다시 넣어야 한다.
    //    원래 없어서 실패하는 것도 정상 경로이므로 결과를 보지 않는다.
    match Command::new(host.cli)
        .args(["mcp", "remove"])
        .args(scope_args(host))
        .arg(SERVER_NAME)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
    {
        Ok(_) => {}
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Outcome::Missing),
        Err(e) => return Err(e.into()),
    }

    // 2) 등록. `--` 뒤가 호스트가 띄울 실행 명령과 인자다.
    let status = Command::new(host.cli)
        .args(["mcp", "add"])
        .args(scope_args(host))
        .arg(SERVER_NAME)
        .arg("--")
        .arg(exe)
        .arg("mcp")
        .status()?;
    Ok(if status.success() { Outcome::Registered } else { Outcome::Failed })
}

fn scope_args(host: &Host) -> Vec<&'static str> {
    match host.scope {
        Some(scope) => vec!["--scope", scope],
        None => vec![],
    }
}

fn scope_note(host: &Host) -> String {
    match host.scope {
        Some(scope) => format!("scope: {scope}"),
        None => "전역".to_owned(),
    }
}

/// 그 호스트에 직접 칠 한 줄. **등록에 쓰는 것과 같은 인자로 짓는다** — 두 자리가 갈리면
/// 안내대로 쳤는데 다른 것이 등록된다.
fn print_manual_line(host: &Host, exe: &Path) {
    let scope = scope_args(host).join(" ");
    let space = if scope.is_empty() { "" } else { " " };
    println!();
    println!(
        "  {} mcp add{space}{scope} {SERVER_NAME} -- {} mcp",
        host.cli,
        exe.display()
    );
    println!();
}
