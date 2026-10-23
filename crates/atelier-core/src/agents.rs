//! Agent 정의 — 사람이 읽고 고치는 Markdown 파일 하나가 Agent 하나다(v1 구현 스펙 §6 · agent-definition.md). frontmatter가
//! 이름 · 설명 · 얼굴 · 모델 · 도구 · Policy · Runtime이고 본문이 지시문(Instructions)이다. **파일 이름이 handle이다** —
//! `reviewer.md`는 `@reviewer`다.
//!
//! 이 모듈이 하는 일은 넷이다 — 파일 하나 읽기([`read_agent`])와 Library의 기본 파일 만들기([`ensure_default_agents`])
//! (v1 티켓 03), 범위 찾기 · 고르기([`find_agents`] · [`AgentRoster::resolve`], v1 티켓 11 — `scope.rs`), Library에 저장하기
//! ([`save_agent`], v1 티켓 19 — Thread 도구 「Agent 저장」).
//!
//! **깨진 파일은 오류가 아니라 까닭이다**([`AgentProblem`]). @ 메뉴와 Library가 그 Agent를 흐리게, 까닭과 함께 보이고 부르지
//! 못하게 한다(§6 「깨진 파일」) — 그래서 읽기는 까닭 셋 가운데 하나로 답하고 터지지 않는다. 화면에는 camelCase JSON으로
//! 나간다(Tauri `list_agents`) — 파일의 낱말(`ask_before` · `agents: any` · `read`)은 그대로 읽고, 내보낼 때만 이름 꼴을 바꾼다.

use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize, Serializer};

use crate::paths::library_agents_in;
use crate::project::split_frontmatter;

mod scope;
pub use scope::{agent_file_path, find_agents, read_agent_file, AgentRoster, BrokenAgent, FoundAgent, Unresolved};

/// 읽은 Agent 정의 하나.
///
/// v1이 읽지 않는 칸 — `tools.mcp` · `knowledge` · `contract`(S39)와 모르는 칸 — 은 깨진 까닭이 아니라 그냥 지나친다. 남이 만든
/// Agent 파일을 가져와도 v1에서 부를 수 있게.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    /// 파일 이름(확장자 뺌). `@`로 부르는 이름이다.
    pub handle: String,
    /// 화면에 보이는 이름. 적지 않으면 handle이다.
    pub name: String,
    /// 언제 이 Agent를 부르나 — @ 메뉴의 설명 한 줄.
    pub description: String,
    /// 얼굴(S36). 없으면 화면이 handle에서 정한다 — 모양 · 색의 이름을 푸는 일은 화면의 몫이라 여기서는 글자 그대로 둔다.
    pub avatar: Option<Avatar>,
    pub model: ModelPreference,
    pub tools: Tools,
    pub policy: Policy,
    /// 받는 Runtime 이름들. `None`이면 가리지 않는다. 있으면 `claude-code`가 들어 있다 — 아니면 깨진 파일이다(S3).
    pub runtimes: Option<Vec<String>>,
    /// 본문 — 변환기가 기본 시스템 프롬프트 뒤에 붙인다(§3).
    pub instructions: String,
}

/// frontmatter `avatar`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct Avatar {
    pub shape: Option<String>,
    pub color: Option<String>,
}

/// frontmatter `model` — 선호 모델과 생각 깊이(스토리 33 · 73). 비면 claude의 기본값(사용자 설정)이다 — 변환기가 플래그를
/// 주지 않는다. 값은 고르지 않고 claude에 그대로 넘긴다.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default)]
pub struct ModelPreference {
    pub prefer: Option<String>,
    pub effort: Option<String>,
}

/// frontmatter `tools`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Tools {
    /// 쓸 수 있는 내장 도구. **`None`이면 기본 도구 전부다**(§3) — 빈 목록(내장 도구 없음)과 다르다.
    pub builtin: Option<Vec<BuiltinTool>>,
    /// 판정이 「묻지 않고 허용」으로 보는 명령들(§9).
    pub cli: Vec<String>,
    /// 부를 수 있는 다른 Agent.
    pub agents: AgentCalls,
}

/// Runtime 중립의 추상 도구(agent-definition.md 「Runtime 추상화」). Runtime의 도구 이름으로 옮기는 일은 변환기 쪽이다(v1 티켓 12).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuiltinTool {
    Read,
    Search,
    Edit,
    Shell,
    Web,
}

/// `tools.agents` — 적힌 handle만, 또는 범위 안 아무 Agent(S15, 파일에는 `agents: any`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentCalls {
    Listed(Vec<String>),
    AnyInScope,
}

/// 적지 않으면 아무도 부르지 않는다 — 다른 Agent는 적힌 handle만 부른다(S15).
impl Default for AgentCalls {
    fn default() -> Self {
        AgentCalls::Listed(Vec::new())
    }
}

/// 파일에 적는 꼴 그대로 낸다 — handle 목록이거나 `"any"`.
impl Serialize for AgentCalls {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            AgentCalls::Listed(handles) => handles.serialize(serializer),
            AgentCalls::AnyInScope => serializer.serialize_str(ANY_AGENT),
        }
    }
}

/// frontmatter `policy` — 추상 이름 그대로다. 규칙 표(S19)로 옮기는 일은 변환기(`forbid` → claude의 금지 규칙, v1 티켓 12)와
/// 판정(v1 티켓 22)이 한다.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, rename_all(serialize = "camelCase"))]
pub struct Policy {
    pub ask_before: Vec<String>,
    pub forbid: Vec<String>,
}

/// 깨진 Agent 파일의 까닭(§6 「깨진 파일」). 파일 하나를 읽어 나는 셋([`read_agent`])과, 범위에서 나는 하나(`host` 자리)다.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentProblem {
    /// 파일을 읽지 못했거나 frontmatter가 없거나 그 모양이 틀렸다 — 그 글.
    Unreadable { message: String },
    /// `tools.builtin`에 모르는 추상 도구가 있다 — 처음 만난 그 이름.
    UnknownTool { tool: String },
    /// `runtimes`가 `claude-code`를 받지 않는다 — v1은 Claude Code만 띄운다(S3).
    RuntimeNotAccepted,
    /// Project 안의 `host.md`다 — `host`는 Library에만 있다(§6 범위). 파일을 읽지 않고 이 까닭 하나로 선다.
    HostOutsideLibrary,
}

/// Agent 파일 하나를 읽는다. 깨졌으면 그 까닭이다 — 까닭이 여럿이면 읽지 못함 → 모르는 도구 → Runtime 순으로 처음 것 하나다.
pub fn read_agent(path: &Path) -> Result<AgentDefinition, AgentProblem> {
    let unreadable = |message: String| AgentProblem::Unreadable { message };
    let handle = path.file_stem().and_then(|stem| stem.to_str()).ok_or_else(|| unreadable("파일 이름이 handle이 아니다".into()))?;
    let text = std::fs::read_to_string(path).map_err(|e| unreadable(e.to_string()))?;
    parse_agent(handle, &text)
}

/// Agent 파일의 글 하나를 그 handle의 정의로 읽는다 — 파일 읽기와 저장 전 검사가 같은 규칙을 지난다.
fn parse_agent(handle: &str, text: &str) -> Result<AgentDefinition, AgentProblem> {
    let unreadable = |message: String| AgentProblem::Unreadable { message };
    let (fm_str, body) = split_frontmatter(text).map_err(|message| unreadable(message.into()))?;
    let fm: Frontmatter = serde_yaml_ng::from_str(fm_str).map_err(|e| unreadable(e.to_string()))?;

    let raw = fm.tools.unwrap_or_default();
    let builtin = match raw.builtin {
        None => None,
        Some(names) => Some(
            names
                .into_iter()
                .map(|name| BuiltinTool::from_name(&name).ok_or(AgentProblem::UnknownTool { tool: name }))
                .collect::<Result<Vec<_>, _>>()?,
        ),
    };
    let agents = match raw.agents {
        None => AgentCalls::default(),
        Some(RawCalls::Handles(handles)) => AgentCalls::Listed(handles),
        Some(RawCalls::Marker(marker)) if marker == ANY_AGENT => AgentCalls::AnyInScope,
        Some(RawCalls::Marker(marker)) => {
            return Err(unreadable(format!("tools.agents는 handle 목록이거나 `{ANY_AGENT}`다: {marker}")));
        }
    };
    let runtimes = fm.runtimes.map(RawRuntimes::names);
    if runtimes.as_ref().is_some_and(|names| !names.iter().any(|name| name == CLAUDE_CODE)) {
        return Err(AgentProblem::RuntimeNotAccepted);
    }

    Ok(AgentDefinition {
        handle: handle.to_owned(),
        name: fm.name.unwrap_or_else(|| handle.to_owned()),
        description: fm.description.unwrap_or_default(),
        avatar: fm.avatar,
        model: fm.model,
        tools: Tools { builtin, cli: raw.cli, agents },
        policy: fm.policy,
        runtimes,
        instructions: body.trim().to_owned(),
    })
}

/// Library의 기본 파일 — 처음부터 있는 Host와, 완료 기준의 `@reviewer`(S14).
///
/// **Host 본문은 역할과 일하는 순서만 담는다**(S42). 도구를 쓰는 구체적인 방법(도구 이름 · 인자)은 Thread 도구의 설명과 머리말이
/// 맡는다 — 이 파일은 한 번 만들면 앱이 다시 쓰지 않으므로, 도구 이름에 기대면 도구가 바뀌는 날 사용자의 `host.md`가 낡는다.
const DEFAULT_AGENTS: [(&str, &str); 2] =
    [("host.md", include_str!("agents/host.md")), ("reviewer.md", include_str!("agents/reviewer.md"))];

/// Library에 기본 파일이 없으면 만든다(S14 · 스토리 64 · 65). 앱이 뜰 때마다 부른다.
///
/// **있는 파일은 절대 덮어쓰지 않는다** — 사람이 고친 것도, 깨뜨린 것도. 있는지 보고 쓰는 두 걸음이 아니라 「없을 때만 만든다」
/// 한 번의 열기(`create_new`)라, 그 사이에 사람이 만든 파일도 덮지 않는다. 쓰다 실패한 파일은 지운다 — 반쪽 파일이 남으면
/// 다음 실행이 「있는 파일」로 보고 영영 고치지 않는다.
pub fn ensure_default_agents(root: &Path) -> crate::Result<()> {
    let dir = library_agents_in(root);
    std::fs::create_dir_all(&dir)?;
    for (name, text) in DEFAULT_AGENTS {
        let path = dir.join(name);
        let mut file = match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        };
        if let Err(e) = file.write_all(text.as_bytes()) {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Err(e.into());
        }
    }
    Ok(())
}

/// Library에 저장한 Agent 하나 — 쓴 파일과, 그 글을 읽은 정의(시스템 줄의 이름 · 얼굴이 이것이다).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedAgent {
    pub path: PathBuf,
    pub definition: AgentDefinition,
}

/// Library에 저장하지 않은 까닭(Thread 도구 「Agent 저장」, v1 구현 스펙 §7 S13). 도구가 이것을 글로 돌려주면 Agent가 읽고 고쳐 부른다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentSaveRefusal {
    /// handle이 파일 이름 · @멘션이 될 꼴이 아니다 — 영어 소문자 · 숫자로 시작하고 끝나며 사이에 `-` · `_`만 든다.
    BadHandle,
    /// 그 handle의 파일이 이미 있다 — 덮지 않는다. `host`는 파일이 지워져 있어도 늘 있는 것이다(기본 Host, S14).
    Taken { path: PathBuf },
    /// 내용이 깨진 Agent 파일이다 — 읽기([`read_agent`])와 같은 까닭이다.
    Broken(AgentProblem),
    /// 쓰지 못했다 — 그 글.
    Unwritable { message: String },
}

/// 대화로 만든 Agent를 Library에 새 파일로 둔다(Thread 도구 「Agent 저장」 — v1 구현 스펙 §7 · 스토리 66, v1 티켓 19).
///
/// - **Library에만 쓴다.** 「이 Project에 둬」는 이 길이 아니다 — Host가 worktree의 `.atelier/agents/`에 보통 편집으로 쓰고 판정을
///   지난다(§7). 그래서 받는 것은 handle과 글뿐이고 자리를 받지 않는다.
/// - **쓰기 전에 읽는다.** 글을 읽기와 같은 규칙으로 읽어 깨졌으면 쓰지 않는다 — 깨진 파일을 두면 @ 메뉴에 흐린 줄이 하나 늘 뿐이고,
///   Agent는 그 까닭을 다음 턴에야 안다.
/// - **있는 파일은 덮지 않는다** — 사람이 고친 정의를 대화가 지우지 않게(스토리 65). 기본 파일 만들기와 같은 한 번의 열기
///   (`create_new`)라, 있는지 보고 쓰는 사이에 선 파일도 덮지 않는다. 쓰다 실패한 반쪽 파일은 지운다.
pub fn save_agent(root: &Path, handle: &str, text: &str) -> Result<SavedAgent, AgentSaveRefusal> {
    if !is_handle(handle) {
        return Err(AgentSaveRefusal::BadHandle);
    }
    let dir = library_agents_in(root);
    let path = dir.join(format!("{handle}.md"));
    if handle == HOST_HANDLE {
        return Err(AgentSaveRefusal::Taken { path });
    }
    let definition = parse_agent(handle, text).map_err(AgentSaveRefusal::Broken)?;
    let unwritable = |e: std::io::Error| AgentSaveRefusal::Unwritable { message: e.to_string() };
    std::fs::create_dir_all(&dir).map_err(unwritable)?;
    let mut file = match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::AlreadyExists => return Err(AgentSaveRefusal::Taken { path }),
        Err(e) => return Err(unwritable(e)),
    };
    if let Err(e) = file.write_all(text.as_bytes()) {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(unwritable(e));
    }
    Ok(SavedAgent { path, definition })
}

/// 저장할 수 있는 handle — 파일 이름이자 @멘션이다. 영어 소문자 · 숫자로 시작하고 끝나며 사이에 `-` · `_`만 든다. 대문자를 받지
/// 않는 것은 대소문자를 가리지 않는 파일 시스템(macOS)에서 `Reviewer.md`와 `reviewer.md`가 한 파일이라서다. 멘션은 끝의 `-`를
/// 문장 부호로 떼므로 끝 글자도 막는다.
fn is_handle(handle: &str) -> bool {
    let plain = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();
    handle.starts_with(plain) && handle.ends_with(plain) && handle.chars().all(|c| plain(c) || c == '-' || c == '_')
}

/// Library의 기본 Host — 저장으로 새로 두지 않는다.
const HOST_HANDLE: &str = "host";

/// `tools.agents`의 「범위 안 아무 Agent」 표시.
const ANY_AGENT: &str = "any";

/// v1이 받는 Runtime 하나.
const CLAUDE_CODE: &str = "claude-code";

impl BuiltinTool {
    fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "read" => BuiltinTool::Read,
            "search" => BuiltinTool::Search,
            "edit" => BuiltinTool::Edit,
            "shell" => BuiltinTool::Shell,
            "web" => BuiltinTool::Web,
            _ => return None,
        })
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Frontmatter {
    name: Option<String>,
    description: Option<String>,
    avatar: Option<Avatar>,
    model: ModelPreference,
    tools: Option<RawTools>,
    policy: Policy,
    runtimes: Option<RawRuntimes>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct RawTools {
    builtin: Option<Vec<String>>,
    cli: Vec<String>,
    agents: Option<RawCalls>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawCalls {
    Handles(Vec<String>),
    Marker(String),
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RawRuntimes {
    Names(Vec<String>),
    Sections(serde_yaml_ng::Mapping),
}

impl RawRuntimes {
    fn names(self) -> Vec<String> {
        match self {
            RawRuntimes::Names(names) => names,
            RawRuntimes::Sections(sections) => sections.keys().filter_map(|key| key.as_str().map(str::to_owned)).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 그 이름 · 글로 Library 폴더에 Agent 파일 하나를 둔다.
    fn agent_file(dir: &Path, name: &str, text: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, text).unwrap();
        path
    }

    const REVIEWER: &str = "---
name: 리뷰어
description: 코드 변경을 받아 리뷰한다. 구현이 끝난 뒤 부른다.
avatar:
  shape: hexagon
  color: violet
model:
  prefer: opus
  effort: high
knowledge:
  skills: [code-review]
tools:
  builtin: [read, search, shell, edit, web]
  mcp: [github]
  cli: [gh]
  agents: [security-reviewer]
policy:
  ask_before: [edit, push]
  forbid: [merge]
contract:
  input: diff
runtimes:
  claude-code: {}
---

너는 이 팀의 코드 리뷰어다.

고치지 않고 읽는다.
";

    #[test]
    fn 파일_이름이_handle이고_frontmatter의_필드와_본문의_지시문을_읽는다() {
        let dir = tempfile::tempdir().unwrap();
        let path = agent_file(dir.path(), "reviewer.md", REVIEWER);

        let agent = read_agent(&path).expect("깨지지 않은 파일");

        assert_eq!(
            agent,
            AgentDefinition {
                handle: "reviewer".into(),
                name: "리뷰어".into(),
                description: "코드 변경을 받아 리뷰한다. 구현이 끝난 뒤 부른다.".into(),
                avatar: Some(Avatar { shape: Some("hexagon".into()), color: Some("violet".into()) }),
                model: ModelPreference { prefer: Some("opus".into()), effort: Some("high".into()) },
                tools: Tools {
                    builtin: Some(vec![
                        BuiltinTool::Read,
                        BuiltinTool::Search,
                        BuiltinTool::Shell,
                        BuiltinTool::Edit,
                        BuiltinTool::Web,
                    ]),
                    cli: vec!["gh".into()],
                    agents: AgentCalls::Listed(vec!["security-reviewer".into()]),
                },
                policy: Policy { ask_before: vec!["edit".into(), "push".into()], forbid: vec!["merge".into()] },
                runtimes: Some(vec!["claude-code".into()]),
                instructions: "너는 이 팀의 코드 리뷰어다.\n\n고치지 않고 읽는다.".into(),
            }
        );
    }

    #[test]
    fn 적지_않은_칸은_비고_이름은_handle이며_도구를_적지_않으면_기본_도구_전부다() {
        let dir = tempfile::tempdir().unwrap();
        let path = agent_file(dir.path(), "writer.md", "---\ndescription: 글을 쓴다.\n---\n글을 쓴다.\n");

        let agent = read_agent(&path).unwrap();

        assert_eq!((agent.handle.as_str(), agent.name.as_str()), ("writer", "writer"));
        assert_eq!(agent.avatar, None);
        assert_eq!(agent.model, ModelPreference { prefer: None, effort: None }, "claude의 기본값을 쓴다");
        assert_eq!(agent.tools.builtin, None, "`tools`가 없으면 기본 도구 전부다(v1 구현 스펙 §3)");
        assert_eq!(agent.tools.agents, AgentCalls::Listed(vec![]), "적힌 handle이 없으면 아무도 부르지 않는다(S15)");
        assert_eq!(agent.runtimes, None, "`runtimes`가 없으면 Runtime을 가리지 않는다");

        let path = agent_file(dir.path(), "silent.md", "---\ntools:\n  builtin: []\n  agents: any\n---\n");
        let agent = read_agent(&path).unwrap();
        assert_eq!(agent.tools.builtin, Some(vec![]), "빈 목록은 내장 도구 없음이다 — 「전부」가 아니다");
        assert_eq!(agent.tools.agents, AgentCalls::AnyInScope);
        assert_eq!(agent.instructions, "");
    }

    #[test]
    fn 읽지_못하는_파일은_읽지_못함으로_깨진다() {
        let dir = tempfile::tempdir().unwrap();
        let broken = [
            ("plain.md", "frontmatter 없는 글"),
            ("open.md", "---\nname: 끝나지 않음\n"),
            ("yaml.md", "---\nname: [닫히지 않은\n---\n"),
            ("typed.md", "---\nmodel: opus\n---\n"),
            ("marker.md", "---\ntools:\n  agents: everyone\n---\n"),
        ];
        for (name, text) in broken {
            let path = agent_file(dir.path(), name, text);
            assert!(matches!(read_agent(&path), Err(AgentProblem::Unreadable { .. })), "{name}: {:?}", read_agent(&path));
        }
        assert!(
            matches!(read_agent(&dir.path().join("gone.md")), Err(AgentProblem::Unreadable { .. })),
            "없는 파일도 읽지 못함이다"
        );
    }

    #[test]
    fn 모르는_추상_도구가_있으면_그_이름과_함께_깨진다() {
        let dir = tempfile::tempdir().unwrap();
        let path = agent_file(dir.path(), "bash.md", "---\ntools:\n  builtin: [read, Bash, web]\n---\n");

        assert_eq!(read_agent(&path), Err(AgentProblem::UnknownTool { tool: "Bash".into() }), "Claude Code 도구 이름은 추상 이름이 아니다");
    }

    #[test]
    fn runtimes가_claude_code를_받지_않으면_깨지고_받으면_목록이든_구획이든_읽힌다() {
        let dir = tempfile::tempdir().unwrap();
        for text in ["---\nruntimes:\n  codex: {}\n---\n", "---\nruntimes: [codex]\n---\n", "---\nruntimes: {}\n---\n"] {
            let path = agent_file(dir.path(), "other.md", text);
            assert_eq!(read_agent(&path), Err(AgentProblem::RuntimeNotAccepted), "{text}");
        }
        for text in ["---\nruntimes:\n  codex: {}\n  claude-code:\n    plugins: [x]\n---\n", "---\nruntimes: [claude-code]\n---\n"] {
            let path = agent_file(dir.path(), "both.md", text);
            assert!(read_agent(&path).unwrap().runtimes.unwrap().contains(&"claude-code".to_owned()), "{text}");
        }
    }

    /// 데이터 뿌리 아래 Library의 Agent 자리(v1 구현 스펙 §6 · agent-definition.md 「파일 위치」).
    fn library(root: &Path) -> std::path::PathBuf {
        root.join("library").join("agents")
    }

    /// Claude Code의 도구 이름(v1 구현 스펙 §3 표)과 MCP 도구 앞말.
    const RUNTIME_TOOL_NAMES: [&str; 11] =
        ["Read", "Glob", "Grep", "LS", "Edit", "Write", "NotebookEdit", "Bash", "WebFetch", "WebSearch", "mcp__"];

    #[test]
    fn 처음이면_library에_host와_reviewer가_생기고_둘_다_깨지지_않는다() {
        let root = tempfile::tempdir().unwrap();

        ensure_default_agents(root.path()).unwrap();

        let host = read_agent(&library(root.path()).join("host.md")).expect("host.md");
        assert_eq!(host.handle, "host");
        assert_eq!(host.tools.agents, AgentCalls::AnyInScope, "Host는 범위 안 아무 Agent나 부른다(S15)");
        assert_eq!(host.tools.builtin, None, "Host는 기본 도구 전부를 쓴다");
        // 「결정은 내가 합니다」(S31) — Host는 push와 스키마 바꾸기를 하기 전에 묻는다. 스키마(마이그레이션 명령)는 고정 목록이 없어
        // 이 파일에 명령 패턴으로 적는다(S19).
        assert!(host.policy.ask_before.contains(&"push".to_owned()), "{:?}", host.policy.ask_before);
        assert!(host.policy.ask_before.contains(&"Bash(*prisma migrate *)".to_owned()), "{:?}", host.policy.ask_before);
        assert!(
            host.policy.ask_before.iter().all(|name| name == "push" || (name.starts_with("Bash(") && name.ends_with(')'))),
            "추상 이름은 push 하나, 나머지는 명령 패턴이다: {:?}",
            host.policy.ask_before
        );
        assert!(host.policy.forbid.is_empty());
        let reviewer = read_agent(&library(root.path()).join("reviewer.md")).expect("reviewer.md");
        assert_eq!(
            reviewer.tools.builtin,
            Some(vec![BuiltinTool::Read, BuiltinTool::Search, BuiltinTool::Shell]),
            "리뷰어는 읽기 · 찾기 · 명령만 쓴다(S14)"
        );
        assert_eq!(reviewer.tools.agents, AgentCalls::Listed(vec![]));
        assert_eq!(
            reviewer.avatar,
            Some(Avatar { shape: Some("circle".into()), color: Some("green".into()) }),
            "리뷰어는 캔버스의 얼굴(초록 원)로 선다(v1 티켓 14). Host는 늘 무채색이라 적지 않는다"
        );
        assert_eq!(host.avatar, None);

        for agent in [&host, &reviewer] {
            assert!(!agent.instructions.is_empty(), "{}: 지시문이 있다", agent.handle);
            for name in RUNTIME_TOOL_NAMES {
                assert!(!agent.instructions.contains(name), "{}: 도구 이름 `{name}`에 기대지 않는다(S42)", agent.handle);
            }
        }
    }

    #[test]
    fn 있는_파일은_깨졌어도_덮지_않고_없는_것만_만든다() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(library(root.path())).unwrap();
        let mine = "---\nname: 내 Host\n---\n내가 고친 Host.\n";
        let broken = "---\ntools:\n  builtin: [Bash]\n---\n";
        std::fs::write(library(root.path()).join("host.md"), mine).unwrap();

        ensure_default_agents(root.path()).unwrap();

        assert_eq!(std::fs::read_to_string(library(root.path()).join("host.md")).unwrap(), mine);
        let made = std::fs::read_to_string(library(root.path()).join("reviewer.md")).unwrap();

        // 다시 켜도 그대로다 — 앱이 만든 파일도, 사람이 깨뜨린 파일도.
        std::fs::write(library(root.path()).join("host.md"), broken).unwrap();
        ensure_default_agents(root.path()).unwrap();
        assert_eq!(std::fs::read_to_string(library(root.path()).join("host.md")).unwrap(), broken);
        assert_eq!(std::fs::read_to_string(library(root.path()).join("reviewer.md")).unwrap(), made);
    }

    const SECURITY: &str = "---
name: 보안 리뷰어
description: 보안 취약점만 본다.
avatar:
  shape: triangle
  color: purple
tools:
  builtin: [read, search]
---

너는 보안 취약점만 보는 리뷰어다.
";

    #[test]
    fn 저장은_library에_handle_파일을_받은_그대로_새로_쓰고_범위가_곧바로_그_agent를_본다() {
        let root = tempfile::tempdir().unwrap();

        let saved = save_agent(root.path(), "security-reviewer", SECURITY).expect("저장");

        assert_eq!(saved.path, library(root.path()).join("security-reviewer.md"), "Library 폴더가 없어도 세우고 쓴다");
        assert_eq!(std::fs::read_to_string(&saved.path).unwrap(), SECURITY, "받은 내용 그대로다");
        assert_eq!((saved.definition.handle.as_str(), saved.definition.name.as_str()), ("security-reviewer", "보안 리뷰어"));
        let roster = find_agents(root.path(), None).unwrap();
        assert_eq!(
            roster.resolve("security-reviewer").map(|found| found.path.clone()),
            Ok(saved.path),
            "@ 메뉴 · Library가 읽는 범위다"
        );
    }

    #[test]
    fn 있는_handle은_깨진_파일이어도_덮지_않고_거절하며_host는_늘_있는_것이다() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(library(root.path())).unwrap();
        let mine = "---\ntools:\n  builtin: [Bash]\n---\n내가 깨뜨린 리뷰어.\n";
        std::fs::write(library(root.path()).join("reviewer.md"), mine).unwrap();

        assert_eq!(
            save_agent(root.path(), "reviewer", SECURITY).map(|saved| saved.path),
            Err(AgentSaveRefusal::Taken { path: library(root.path()).join("reviewer.md") })
        );
        assert_eq!(std::fs::read_to_string(library(root.path()).join("reviewer.md")).unwrap(), mine, "덮지 않는다(스토리 65)");

        assert_eq!(
            save_agent(root.path(), "host", SECURITY).map(|saved| saved.path),
            Err(AgentSaveRefusal::Taken { path: library(root.path()).join("host.md") }),
            "host.md가 지워져 있어도 Host는 Library의 기본 Host다 — 다음 실행이 다시 세운다(S14)"
        );
        assert!(!library(root.path()).join("host.md").exists());
    }

    #[test]
    fn 깨진_내용은_쓰지_않고_그_까닭으로_거절한다() {
        let root = tempfile::tempdir().unwrap();
        let broken = [
            ("frontmatter 없는 지시문", AgentProblem::Unreadable { message: "missing frontmatter".into() }),
            ("---\ntools:\n  builtin: [read, Bash]\n---\n", AgentProblem::UnknownTool { tool: "Bash".into() }),
            ("---\nruntimes: [codex]\n---\n", AgentProblem::RuntimeNotAccepted),
        ];
        for (text, problem) in broken {
            assert_eq!(
                save_agent(root.path(), "writer", text).map(|saved| saved.path),
                Err(AgentSaveRefusal::Broken(problem)),
                "{text}"
            );
            assert!(!library(root.path()).join("writer.md").exists(), "깨진 파일은 Library에 서지 않는다: {text}");
        }
        assert!(
            matches!(
                save_agent(root.path(), "writer", "---\nname: [닫히지 않은\n---\n"),
                Err(AgentSaveRefusal::Broken(AgentProblem::Unreadable { .. }))
            ),
            "YAML이 틀렸다"
        );
    }

    #[test]
    fn handle은_영어_소문자_숫자로_시작하고_끝나며_사이에_줄표_밑줄만_든다() {
        let root = tempfile::tempdir().unwrap();
        let bad = ["", "../reviewer", "team/reviewer", "Reviewer", "reviewer.md", "@reviewer", ".hidden", "-x", "x-", "보안", "two words"];
        for handle in bad {
            assert_eq!(
                save_agent(root.path(), handle, SECURITY).map(|saved| saved.path),
                Err(AgentSaveRefusal::BadHandle),
                "{handle:?}: 파일 이름이자 @멘션이 되지 못한다"
            );
        }
        assert_eq!(std::fs::read_dir(library(root.path())).map(|dir| dir.count()).unwrap_or(0), 0, "아무것도 쓰지 않는다");
        for handle in ["qa", "qa-bot_2", "x"] {
            assert!(save_agent(root.path(), handle, SECURITY).is_ok(), "{handle}");
        }
    }
}
