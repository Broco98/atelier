//! 에이전트 찾기 — 로그인 셸의 PATH에서 에이전트를 띄우는 데 드는 실행 파일을 찾는다.

use std::ffi::OsStr;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 대화마다 고르는 에이전트. 기록과 화면에는 `claude` · `codex`로 적힌다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
}

impl Agent {
    /// 기록 · 화면 · 파일(`engines.json` · `settings.json`의 칸 이름)에 적히는 에이전트 글자 — serde 꼴(`lowercase`)과 같다.
    pub(crate) fn key(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
        }
    }

    /// 대화 이름의 머리 — 이름은 에이전트 이름으로 저절로 붙는다(Claude · Codex · Claude 2, three-axes 결정 15).
    pub fn display_name(self) -> &'static str {
        match self {
            Agent::Claude => "Claude",
            Agent::Codex => "Codex",
        }
    }

    /// 그 에이전트를 띄우는 데 드는 실행 파일. 찾은 결과도 이 순서로 싣는다.
    ///
    /// Codex는 `codex-acp`를 `npx`를 거치지 않고 바로 띄우고, 그것이 `CODEX_PATH`로 받은 사용자의
    /// `codex`를 돌린다(three-axes 결정 26). `codex-acp`는 `#!/usr/bin/env node` 스크립트라 `node`도 든다.
    fn programs(self) -> &'static [Program] {
        match self {
            Agent::Claude => &[CLAUDE],
            Agent::Codex => &[CODEX_ACP, CODEX, NODE],
        }
    }
}

/// 찾을 실행 파일 하나와, 못 찾았을 때 안내 카드가 보일 설치 명령.
struct Program {
    name: &'static str,
    install: &'static str,
}

/// Claude Code 공식 설치 명령(네이티브 설치본 — `~/.local/bin/claude`).
const CLAUDE: Program = Program { name: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash" };
const CODEX_ACP: Program = Program { name: "codex-acp", install: "npm i -g @agentclientprotocol/codex-acp" };
/// codex 공식 설치 스크립트 — npm · Homebrew 판이 아니라 이것으로 깐 `~/.local/bin/codex`를 쓴다
/// (three-axes 결정 26).
const CODEX: Program = Program { name: "codex", install: "curl -fsSL https://chatgpt.com/codex/install.sh | sh" };
const NODE: Program = Program { name: "node", install: "brew install node" };

/// 엔진 확인의 답. 앱 명령을 건너 화면으로 가므로 `state`로 가르는 꼴로 나간다 — 프런트의 `EngineCheck` 타입과
/// 같은 말이다(three-axes 티켓 05).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum EngineCheck {
    /// 찾음 — 드는 실행 파일마다 PATH 앞쪽의 것과, 그 엔진에 로그인돼 있나(three-axes 티켓 12). 로그인이 안 됐으면
    /// 안내 카드가 첫 말 전에 선다(스토리 93).
    Found { programs: Vec<FoundProgram>, logged_in: bool },
    /// 못 찾음 — 빠진 것마다 이름과 설치 명령. 찾은 것은 싣지 않는다.
    Missing { missing: Vec<MissingProgram> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FoundProgram {
    pub name: &'static str,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MissingProgram {
    pub name: &'static str,
    pub install: &'static str,
}

/// PATH에서 그 에이전트의 실행 파일들을 찾는다. PATH 앞쪽이 이기고, 실행 권한이 없는 파일은 없는 것으로
/// 치고 다음 자리를 본다(셸이 명령을 찾는 규칙과 같다). 상대 경로 자리(빈 자리 · `.`)는 보지 않는다 —
/// 앱의 cwd는 사용자가 고른 자리가 아니다.
///
/// 다 찾았으면 찾은 것들, 하나라도 없으면 빠진 것들(찾은 것은 싣지 않는다)이다.
pub(crate) fn look_up(agent: Agent, path: Option<&OsStr>) -> Result<Vec<FoundProgram>, Vec<MissingProgram>> {
    let dirs: Vec<PathBuf> = path
        .map(|path| std::env::split_paths(path).filter(|dir| dir.is_absolute()).collect())
        .unwrap_or_default();

    let mut found = Vec::new();
    let mut missing = Vec::new();
    for program in agent.programs() {
        match dirs.iter().map(|dir| dir.join(program.name)).find(|candidate| executable(candidate)) {
            Some(path) => found.push(FoundProgram { name: program.name, path }),
            None => missing.push(MissingProgram { name: program.name, install: program.install }),
        }
    }
    if missing.is_empty() {
        Ok(found)
    } else {
        Err(missing)
    }
}

/// 실행할 수 있는 파일인가. 심볼릭 링크는 따라간다 — `codex-acp`는 `dist/index.js`를 가리키는 링크다.
fn executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **파일의 칸 이름은 기록에 적히는 에이전트 글자와 같다** — 엔진 목록 · 설정의 칸 이름(`key`)과 기록 · 화면의 글자(serde)가
    /// 어긋나면 그 엔진의 몫을 못 찾는다.
    #[test]
    fn the_key_is_the_written_agent() {
        for agent in [Agent::Claude, Agent::Codex] {
            assert_eq!(serde_json::to_value(agent).unwrap(), serde_json::Value::from(agent.key()));
        }
    }
}
