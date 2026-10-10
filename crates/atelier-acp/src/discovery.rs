//! 에이전트 찾기 — 로그인 셸의 PATH에서 에이전트를 띄우는 데 드는 실행 파일을 찾는다.

use std::ffi::OsStr;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// 대화마다 고르는 에이전트.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Agent {
    Claude,
    Codex,
}

impl Agent {
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

/// 엔진 확인의 답.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineCheck {
    /// 찾음 — 드는 실행 파일마다 PATH 앞쪽의 것.
    Found { programs: Vec<FoundProgram> },
    /// 못 찾음 — 빠진 것마다 이름과 설치 명령. 찾은 것은 싣지 않는다.
    Missing { missing: Vec<MissingProgram> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundProgram {
    pub name: &'static str,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingProgram {
    pub name: &'static str,
    pub install: &'static str,
}

/// PATH에서 그 에이전트의 실행 파일들을 찾는다. PATH 앞쪽이 이기고, 실행 권한이 없는 파일은 없는 것으로
/// 치고 다음 자리를 본다(셸이 명령을 찾는 규칙과 같다). 상대 경로 자리(빈 자리 · `.`)는 보지 않는다 —
/// 앱의 cwd는 사용자가 고른 자리가 아니다.
pub(crate) fn look_up(agent: Agent, path: Option<&OsStr>) -> EngineCheck {
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
        EngineCheck::Found { programs: found }
    } else {
        EngineCheck::Missing { missing }
    }
}

/// 실행할 수 있는 파일인가. 심볼릭 링크는 따라간다 — `codex-acp`는 `dist/index.js`를 가리키는 링크다.
fn executable(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}
