//! 에이전트 훅 설치 — 사용자의 claude·codex 설정에 우리 훅을 **병합해** 넣고 걷어낸다.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

/// 에이전트의 이름. **훅 명령줄에 박히는 그 글자이자 화면·상태 파일의 `agent`다** —
/// 훅 스크립트가 argv로 받아 상태 파일에 그대로 적고, 프런트의 어댑터 표(`agents/index.ts`)가
/// 같은 글자로 고른다. 한때 명령을 짓는 자리와 `AGENTS` 표가 이 글자를 각각 적고 있었다:
/// 세 벌이면 한쪽만 고치는 날 **훅은 정상으로 돌고 파일도 정상으로 쓰이는데 어댑터만 못
/// 알아본다**(어느 층도 안 빨개지는 그 모양이다).
pub const CLAUDE: &str = "claude";
/// 위와 같다.
pub const CODEX: &str = "codex";

/// Claude에 거는 이벤트 다섯 (구현 결정 8).
pub const CLAUDE_EVENTS: &[&str] =
    &["UserPromptSubmit", "PermissionRequest", "Elicitation", "Stop", "SessionEnd"];

/// 훅 명령 한 줄. 스크립트 경로를 따옴표로 감싸는 것은 홈 경로에 공백이 있을 수 있어서다.
pub fn command_line(script: &Path, agent: &str, event: &str) -> String {
    let quoted = script.to_string_lossy().replace('\'', r"'\''");
    format!("'{quoted}' {agent} {event}")
}

/// 우리 훅을 알아보는 표식. **명령 문자열로 식별한다**(구현 결정 8) — 앱이 따로
/// 기억하는 것이 없으므로, 파일에 적힌 글자가 유일한 근거다.
fn is_ours(command: &str) -> bool {
    command.contains(crate::shells::SCRIPT_NAME)
}

/// 우리가 이벤트 배열에 넣는 항목 하나 — matcher 없는 그룹 안에 명령 훅 하나.
fn claude_group(script: &Path, event: &str) -> Value {
    json!({
        "hooks": [{ "type": "command", "command": command_line(script, CLAUDE, event) }]
    })
}

/// 이 그룹이 우리 것인가 — 안쪽 훅 중 하나라도 우리 명령이면 그렇다.
fn claude_group_is_ours(group: &Value) -> bool {
    group["hooks"]
        .as_array()
        .is_some_and(|inner| inner.iter().any(|h| h["command"].as_str().is_some_and(is_ours)))
}

/// 사용자의 `~/.claude/settings.json` 내용에 우리 훅을 얹은 새 내용.
///
/// **순수 함수다** — 파일 내용 문자열을 받아 새 내용 문자열을 낸다. 디스크를 아는 것은
/// 이 아래 쓰기 층뿐이라, 「남의 훅이 살아남는가」를 실물 홈 없이 표로 잴 수 있다.
///
/// **파싱 후 재직렬화하되 우리 키 밖은 그대로 싣는다**(`settings.rs`의 왕복 보존이 선례).
/// 텍스트로 끼워 넣지 않는 이유는 JSON에 「파일 끝에 덧붙인다」가 없어서다.
pub fn merge_claude(source: &str, script: &Path) -> Result<String, String> {
    let mut root = parse_claude(source)?;

    let hooks = root.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks
        .as_object_mut()
        .ok_or_else(|| "`hooks`가 객체가 아닙니다 — 손대지 않았습니다".to_string())?;

    for event in CLAUDE_EVENTS {
        let list = hooks.entry(*event).or_insert_with(|| json!([]));
        let list = list
            .as_array_mut()
            .ok_or_else(|| format!("`hooks.{event}`가 배열이 아닙니다 — 손대지 않았습니다"))?;
        // **덮어쓰기가 아니라 배열 추가다.** 이미 우리 것이 있으면 안 더한다 — 버튼을
        // 두 번 눌러도 설정이 더러워지지 않는다(스토리 72).
        if list.iter().any(claude_group_is_ours) {
            continue;
        }
        list.push(claude_group(script, event));
    }

    let mut out = serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|e| format!("설정을 옮겨 적지 못했습니다: {e}"))?;
    out.push('\n');
    Ok(out)
}

/// Codex에 거는 이벤트 다섯 (구현 결정 8). Claude와 넷이 겹치고 `Elicitation` 대신
/// `Interrupt`다 — Codex 훅 목록에 `Elicitation`이 없고, 끊은 턴을 잡는 것이 그쪽이다.
pub const CODEX_EVENTS: &[&str] =
    &["UserPromptSubmit", "PermissionRequest", "Stop", "Interrupt", "SessionEnd"];

/// 우리가 `~/.codex/config.toml` 끝에 덧붙이는 구획의 울타리.
///
/// **제거가 이 두 줄만 보고 잘라낸다.** TOML을 파싱해 다시 쓰면 488줄짜리 실물의 주석과
/// 순서가 통째로 갈리므로, 넣는 것도 걷는 것도 텍스트로 한다 — 그러려면 어디부터
/// 어디까지가 우리 것인지 파일 안에 적혀 있어야 한다.
const CODEX_BEGIN: &str = "# >>> atelier 셸 신호 훅 — 아틀리에 설정 화면이 넣었습니다 >>>";
const CODEX_END: &str = "# <<< atelier 셸 신호 훅 <<<";

/// 파일 끝에 덧붙는 글자 그대로. **미리보기도 이 함수가 낸다** — 화면이 따로 적으면
/// 「무엇이 들어가는지 보여 준다」는 약속이 실제로 들어가는 것과 갈릴 수 있다.
pub fn codex_block(script: &Path) -> String {
    codex_block_for(script, CODEX_EVENTS)
}

/// 이벤트 몇 개짜리 구획. **전부가 아닐 수 있는 이유:** 사람이 울타리 밖에 손으로 적어 둔
/// 우리 명령이 있으면 그 이벤트는 다시 안 붙인다(`merge_codex`) — 붙이면 두 벌이 된다.
fn codex_block_for(script: &Path, events: &[&str]) -> String {
    let mut out = String::from(CODEX_BEGIN);
    out.push('\n');
    for event in events {
        // **두 블록이 짝이다**(구현 결정 8). `[[hooks.<Event>]]`가 matcher 그룹이고
        // `[[hooks.<Event>.hooks]]`가 그 안의 명령이다 — 앞의 것 없이 뒤의 것만 적으면
        // 붙일 그룹이 없어 TOML이 거부한다. matcher는 안 적는다: 도구 이름으로 거르는
        // 자리가 아니라 이벤트 전부를 받는다.
        out.push_str(&format!(
            "\n[[hooks.{event}]]\n\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {}\n",
            toml_basic_string(&command_line(script, CODEX, event))
        ));
    }
    out.push_str(CODEX_END);
    out.push('\n');
    out
}

/// TOML 기본 문자열 한 개. 경로에 `"`나 `\`가 섞여도 파일이 안 깨진다.
fn toml_basic_string(value: &str) -> String {
    let escaped = value.replace('\\', r"\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

/// 사용자의 `~/.codex/config.toml` 내용에 우리 구획을 얹은 새 내용.
///
/// **파일 끝에 덧붙인다**(구현 결정 8). TOML을 파싱해 다시 쓰지 않는 이유는 실물이
/// 488줄이고 주석과 순서가 사람의 것이기 때문이다 — 덧붙이기는 그 전부를 안 건드린다.
/// 대가는 **우리 블록 뒤에 사용자가 최상위 키를 못 적게 되는 것**이다(TOML은 최상위 키가
/// 모든 테이블 헤더보다 앞에 와야 한다). 감수한다.
///
/// **먼저 우리 구획을 걷고 다시 붙인다.** 그래야 두 번 눌러도 한 번이고, 홈이 옮겨져
/// 경로가 낡았을 때 설치가 그것을 고친다.
pub fn merge_codex(source: &str, script: &Path) -> Result<String, String> {
    parse_codex(source)?;

    let mut out = strip_codex_block(source);

    // **울타리 밖에 이미 우리 명령이 있으면 그 이벤트는 안 붙인다.** 사람이 손으로 적어 둔
    // 훅 위에 우리 구획을 그대로 얹으면 같은 명령이 두 벌이 되어 이벤트마다 훅이 두 번
    // 돈다 — claude 쪽이 `claude_group_is_ours`로 막는 그 자리(스토리 72)의 codex 판이다.
    let present = codex_ours(&parse_codex(&out)?);
    let missing: Vec<&str> =
        CODEX_EVENTS.iter().copied().filter(|event| !present.contains(event)).collect();
    if missing.is_empty() {
        return Ok(out);
    }

    if !out.is_empty() {
        // **파일 끝 개행 유무를 본다.** 없는데 그냥 이으면 사용자의 마지막 키와 우리
        // 주석이 한 줄에 붙어 파일이 통째로 깨진다.
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push('\n');
    }
    out.push_str(&codex_block_for(script, &missing));
    Ok(out)
}

/// 우리 구획만 잘라낸 새 내용.
///
/// **파일 끝 개행을 하나로 고른다.** 잘라낸 자리 앞에 우리가 넣었던 빈 줄이 남으면
/// 설치·제거를 되풀이할 때마다 파일 끝에 빈 줄이 쌓인다.
pub fn unmerge_codex(source: &str) -> Result<String, String> {
    parse_codex(source)?;
    Ok(strip_codex_block(source))
}

/// 설치됐나 — **파일을 읽어, 우리 명령 문자열로 판정한다**(구현 결정 8 · claude 쪽과 같은
/// 잣대). 다섯이 다 있어야 설치된 것이다.
///
/// **울타리를 세지 않는다.** 헤더 줄만 보면 사람이 `command` 줄을 지운 파일이 「설치됨」이
/// 되어 설치 버튼이 잠기고(반쯤 깔린 것은 「아님」이라야 채울 길이 있다), 손으로 적어 둔
/// 훅은 「아님」이 되어 그 위에 사본이 하나 더 붙는다.
pub fn codex_installed(source: &str) -> Result<bool, String> {
    Ok(codex_ours(&parse_codex(source)?).len() == CODEX_EVENTS.len())
}

/// 이 내용에 우리 명령이 **하나라도** 남아 있나 — 걷고 난 뒤에 재는 물음(`leftover`).
/// 깨진 파일에서는 거짓이다: 그때 사람이 먼저 볼 것은 `error` 칸의 「손대지 않았습니다」다.
fn codex_remains(source: &str) -> bool {
    parse_codex(source).is_ok_and(|table| !codex_ours(&table).is_empty())
}

/// 이 내용에서 **우리 명령이 앉아 있는** 이벤트들. 울타리 안인지 밖인지는 안 본다 —
/// 근거는 파일에 적힌 명령 문자열 하나다.
fn codex_ours(table: &toml::Table) -> Vec<&'static str> {
    let Some(hooks) = table.get("hooks").and_then(toml::Value::as_table) else {
        return Vec::new();
    };
    CODEX_EVENTS
        .iter()
        .copied()
        .filter(|event| {
            hooks.get(*event).and_then(toml::Value::as_array).is_some_and(|groups| {
                groups.iter().any(|group| {
                    group.get("hooks").and_then(toml::Value::as_array).is_some_and(|inner| {
                        inner.iter().any(|hook| {
                            hook.get("command").and_then(toml::Value::as_str).is_some_and(is_ours)
                        })
                    })
                })
            })
        })
        .collect()
}

/// 우리 구획이 앉은 자리 — 울타리 두 줄을 포함한 바이트 범위.
///
/// **줄 단위로 견준다.** 파일 어딘가에 이 문구가 든 다른 줄이 있어도 걸리지 않게, 그리고
/// 여는 울타리보다 뒤에 있는 닫는 울타리만 짝으로 친다.
fn codex_block_span(source: &str) -> Option<(usize, usize)> {
    let line_start = |needle: &str| {
        source.match_indices(needle).find_map(|(at, _)| {
            let starts_line = at == 0 || source.as_bytes()[at - 1] == b'\n';
            let rest = &source[at + needle.len()..];
            let ends_line = rest.is_empty() || rest.starts_with('\n');
            (starts_line && ends_line).then_some(at)
        })
    };
    let from = line_start(CODEX_BEGIN)?;
    let end = line_start(CODEX_END)?;
    if end < from {
        return None;
    }
    let after = end + CODEX_END.len();
    let after = if source[after..].starts_with('\n') { after + 1 } else { after };
    Some((from, after))
}

fn strip_codex_block(source: &str) -> String {
    let Some((from, to)) = codex_block_span(source) else {
        return source.to_string();
    };
    let mut out = String::with_capacity(source.len());
    out.push_str(&source[..from]);
    out.push_str(&source[to..]);
    let mut out = out.trim_end_matches('\n').to_string();
    if !out.is_empty() {
        out.push('\n');
    }
    out
}

/// 사용자의 Claude 설정 한 장.
pub fn claude_settings_path(home: &Path) -> PathBuf {
    home.join(".claude").join("settings.json")
}

/// 사용자의 Codex 설정 한 장.
pub fn codex_config_path(home: &Path) -> PathBuf {
    home.join(".codex").join("config.toml")
}

/// 병합 결과를 파일에 넣는다 — **쓰기 전 `.bak` 한 벌, 그리고 원자적 쓰기**(구현 결정 8).
///
/// 순서가 뜻이다. 병합이 실패하면 파일에도 `.bak`에도 손이 안 간다(깨진 입력은 거부하고
/// 손대지 않는다). 바뀔 것이 없으면 아무것도 안 쓴다 — 두 번째 설치가 `.bak`을 「우리
/// 훅이 이미 든 내용」으로 덮으면 되돌릴 벌이 사라진다.
///
/// **원자성이 필요한 이유:** 반쯤 쓰인 `settings.json`은 claude가 **아예 안 뜨는** 상태다.
/// 같은 폴더의 tmp에 다 쓰고 rename하면 파일이 반쯤인 순간이 없다(`settings.rs`의 같은 규칙 —
/// tmp를 다른 폴더에 두면 경계를 넘어 복사-삭제가 되어 그 보장이 깨진다).
///
/// **원자적 교체의 대가 둘을 여기서 물어낸다** — 그리고 그 둘은 `settings.rs`의 같은
/// 관용구에는 없던 값이다. 그쪽이 쓰는 것은 우리 파일(`~/.atelier/settings.json`)이고,
/// 이 판이 같은 길을 **남의 홈**으로 옮기면서 새로 생긴 노출이다.
///
/// 1. **모드.** 새로 만든 tmp의 모드는 `0666 & !umask`(보통 0644)이고 rename은 그것을
///    목적지로 그대로 옮긴다 — 원본이 어떤 모드였는지는 아무 데서도 안 읽는다. 실물 둘 다
///    0600이고 `env` 구획이 앉아 있어 사람이 일부러 좁혀 둔 파일이다. `.bak`은
///    `std::fs::copy`라 모드가 따라가므로, 안 고치면 **백업만 좁고 살아 있는 설정이 넓어지는**
///    뒤집힌 모양이 된다. 그래서 원본이 있으면 그 모드를 tmp에 얹고 나서 rename한다.
/// 2. **심링크.** dotfiles 저장소에서 이 파일을 심링크로 걸어 둔 사람은 설치 한 번에 그것이
///    보통 파일로 갈리고, 그 뒤 저장소를 고쳐도 에이전트에 안 닿는다 — 조용하고 되돌리기
///    어렵다. 그래서 rename의 목적지를 `canonicalize`한 **실물**로 고른다. 벌은 사람이 찾는
///    자리(원래 경로 옆)에 그대로 뜬다.
fn apply(path: &Path, transform: impl Fn(&str) -> Result<String, String>) -> Result<(), String> {
    let before = read_or_empty(path)?;
    let after = transform(&before)?;
    if after == before {
        return Ok(());
    }

    // 없던 파일을 새로 만드는 길에서는 `canonicalize`가 실패한다 — 그때는 경로가 곧 실물이다.
    let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    let dir = target.parent().unwrap_or(Path::new(".")).to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| format!("설정 폴더를 만들지 못했습니다: {e}"))?;

    // 벌은 **원문이 있을 때만** 뜬다. 없던 파일을 새로 만드는 길에는 되돌릴 것이 없다.
    if path.exists() {
        let backup = backup_path(path);
        std::fs::copy(path, &backup)
            .map_err(|e| format!("설정을 백업하지 못했습니다 ({}): {e}", backup.display()))?;
    }

    // 원본의 권한. `Permissions`째로 나르므로 `cfg`가 안 든다 — CI 게이트가 리눅스라
    // macOS 전용 심벌을 여기 들이면 그쪽에서만 안 선다.
    let mode = std::fs::metadata(&target).ok().map(|m| m.permissions());

    let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.atelier.tmp"));
    std::fs::write(&tmp, after).map_err(|e| format!("설정을 쓰지 못했습니다: {e}"))?;
    if let Some(mode) = mode {
        std::fs::set_permissions(&tmp, mode)
            .map_err(|e| format!("설정의 권한을 그대로 두지 못했습니다: {e}"))?;
    }
    std::fs::rename(&tmp, &target).map_err(|e| format!("설정을 바꿔 넣지 못했습니다: {e}"))
}

/// `settings.json` → `settings.json.bak`. **확장자를 갈아 끼우지 않는다** — `with_extension`은
/// 원래 확장자를 지워 `settings.bak`이 되고, 그러면 되돌릴 때 무슨 파일이었는지가 흐려진다.
fn backup_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".bak");
    PathBuf::from(name)
}

/// 에이전트 하나의 지금 상태 — 설정 화면이 그리는 것 전부.
///
/// **앱이 따로 기억하는 상태가 없다**(구현 결정 8). 이 값은 부를 때마다 설정 파일을 읽어
/// 만든다 — 그래서 사람이 파일을 손으로 고쳐도 화면이 곧바로 그것을 말한다.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    /// `claude` · `codex`.
    pub agent: String,
    /// 사람이 읽는 경로 — `~/.claude/settings.json`.
    pub path: String,
    pub installed: bool,
    /// 파일이 깨져 **판정을 못 했으면** 그 까닭. 그때 `installed`는 거짓이지만 「안 깔렸다」가
    /// 아니라 「모른다」다 — 화면이 그 둘을 갈라 적는다.
    pub error: Option<String>,
    /// 방금 **넣거나 걷다** 난 오류. `error`와 한 칸을 쓰면 안 되는 이유가 있다 — 파일이
    /// 읽기 전용이면 쓰기만 실패하고 판정은 멀쩡히 되는데, 그때 화면이 「확인 못 함」이라
    /// 적으면 아는 사실을 「모른다」로 지우는 것이 된다.
    pub write_error: Option<String>,
    /// 그 파일에 실제로 들어가는 글자. **쓰는 함수와 같은 곳에서 나온다**(스토리 73) —
    /// 화면이 따로 적으면 「무엇이 들어가는지 보여 준다」는 약속이 실물과 갈릴 수 있다.
    pub preview: String,
}

/// Claude 쪽에 더해지는 조각을 사람이 읽을 글자로. **병합이 실제로 넣는 그 값**이다 —
/// 빈 파일에 병합한 결과가 곧 「우리가 더하는 것」이라, 두 벌로 적을 자리가 없다.
fn claude_preview(script: &Path) -> String {
    merge_claude("{}", script).unwrap_or_default()
}

/// 에이전트 하나가 무엇을 어디에 넣는지 — 이 표가 둘의 차이 전부다.
///
/// 새 에이전트가 생기면 여기 한 줄이고, 위·아래의 세 창구는 안 는다.
struct Agent {
    name: &'static str,
    path: fn(&Path) -> PathBuf,
    merge: fn(&str, &Path) -> Result<String, String>,
    unmerge: fn(&str) -> Result<String, String>,
    installed: fn(&str) -> Result<bool, String>,
    preview: fn(&Path) -> String,
    /// 이 내용에 **우리 명령이 하나라도** 앉아 있나. `installed`(다섯이 다 있나)와 다른
    /// 물음이다 — 이쪽은 「걷고 났는데 뭐가 남았나」를 재는 자리라 하나만 남아도 참이다.
    remains: fn(&str) -> bool,
}

const AGENTS: &[Agent] = &[
    Agent {
        name: CLAUDE,
        path: claude_settings_path,
        merge: merge_claude,
        unmerge: unmerge_claude,
        installed: claude_installed,
        preview: claude_preview,
        remains: claude_remains,
    },
    Agent {
        name: CODEX,
        path: codex_config_path,
        merge: merge_codex,
        unmerge: unmerge_codex,
        installed: codex_installed,
        preview: codex_block,
        remains: codex_remains,
    },
];

/// 지금 상태 둘. **실패를 에이전트마다 따로 든다** — codex 설정이 깨졌다고 claude 쪽
/// 판정까지 못 하게 되면, 화면이 아무 말도 못 하는 자리가 는다.
pub fn status(home: &Path, script: &Path) -> Vec<HookStatus> {
    AGENTS.iter().map(|agent| look(agent, home, script, None)).collect()
}

/// 둘 다에 넣는다. 돌아오는 것은 **넣고 난 뒤의 상태**다 — 화면이 다시 물어보지 않는다.
pub fn install(home: &Path, script: &Path) -> Vec<HookStatus> {
    AGENTS
        .iter()
        .map(|agent| {
            let merge = agent.merge;
            let failed = apply(&(agent.path)(home), |source| merge(source, script)).err();
            look(agent, home, script, failed)
        })
        .collect()
}

/// 둘 다에서 걷어낸다. **스크립트 파일은 남긴다**(구현 결정 8).
///
/// **걷고 난 뒤에 남은 것이 있으면 그것도 말한다**(아래 `leftover`). 못 걷은 것을 조용히
/// 두면 화면이 「설치됨」인 채 버튼만 무위가 되고, 사람에게는 그 사실을 알 칸이 없다.
pub fn uninstall(home: &Path, script: &Path) -> Vec<HookStatus> {
    AGENTS
        .iter()
        .map(|agent| {
            let unmerge = agent.unmerge;
            let path = (agent.path)(home);
            let failed = apply(&path, |source| unmerge(source)).err().or_else(|| leftover(agent, &path));
            look(agent, home, script, failed)
        })
        .collect()
}

/// 걷고 난 파일에 **우리 명령이 아직 남아 있으면** 그 사실을 사람의 말로.
///
/// **두 에이전트의 잣대가 갈리는 자리를 메운다.** claude는 넣는 것도 빼는 것도 명령
/// 문자열(`is_ours`)이 근거라 손으로 적어 둔 훅도 함께 걷힌다. codex는 판정만 명령
/// 문자열이고(`codex_ours`) 제거는 울타리 두 줄(`strip_codex_block`)이다 — 그래서 울타리
/// 밖에 손으로 적어 둔 우리 훅은 살아남는데 판정은 「설치됨」이다. 그때 `unmerge_codex`가
/// 원문을 그대로 돌려주고 `apply`가 `after == before`로 아무것도 안 쓰므로, **오류도
/// 없고 바뀐 것도 없고 화면은 여전히 「설치됨」**이 된다.
///
/// **여기서 TOML을 파싱해 마저 걷지 않는 이유:** 넣는 것도 걷는 것도 텍스트라는 것이
/// 구현 결정 8이고(488줄짜리 실물의 주석과 순서를 파서에 맡길 이유가 없다), 우리가 안 쓴
/// 모양의 항목을 텍스트로 잘라 내는 일은 사람의 파일을 깨뜨릴 길이 우리가 얻는 것보다
/// 넓다. 그래서 **아는 것만 말한다** — 어느 파일의 무엇을 지우면 되는지.
fn leftover(agent: &Agent, path: &Path) -> Option<String> {
    let source = read_or_empty(path).ok()?;
    if !(agent.remains)(&source) {
        return None;
    }
    Some(format!(
        "손으로 적어 둔 훅이 남아 있어 앱이 못 걷었습니다 — {}을 열어 `{}`이 든 줄을 직접 지워 주세요.",
        atelier_core::collapse_home(path),
        crate::shells::SCRIPT_NAME
    ))
}

/// 한 에이전트의 지금 모습을 **파일에서** 만든다. `failed`는 방금 넣거나 걷다 난 오류다 —
/// **판정과 다른 칸에 싣는다.** 둘은 다른 사실이고(하나는 방금 한 일, 하나는 지금 아는 것),
/// 한 칸에 겹치면 「쓰기는 실패했지만 설치된 것은 안다」가 「확인 못 함」으로 지워진다.
fn look(agent: &Agent, home: &Path, script: &Path, failed: Option<String>) -> HookStatus {
    let path = (agent.path)(home);
    let read = read_or_empty(&path).and_then(|source| (agent.installed)(&source));
    HookStatus {
        agent: agent.name.to_string(),
        path: atelier_core::collapse_home(&path),
        installed: read.clone().unwrap_or(false),
        error: read.err(),
        write_error: failed,
        preview: (agent.preview)(script),
    }
}

/// 파일이 없으면 빈 내용이다 — 첫 실행이 정상 경로다.
fn read_or_empty(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!(
            "설정을 읽지 못했습니다 ({}): {e}",
            atelier_core::collapse_home(path)
        )),
    }
}

/// **깨진 TOML은 거부한다.** 쓰는 것은 텍스트 덧붙이기라, 파서가 하는 일은 둘뿐이다 —
/// 「손대도 되는 파일인가」와 「우리 명령이 어디에 앉아 있나」(`codex_ours`).
fn parse_codex(source: &str) -> Result<toml::Table, String> {
    toml::from_str::<toml::Table>(source)
        .map_err(|e| format!("설정 파일이 잘못됐습니다: {e} — 손대지 않았습니다"))
}

/// 우리 훅만 걷어낸 새 내용. **스크립트 파일은 안 지운다** — 남아도 무해하고, 지우면
/// 아직 살아 있는 셸의 훅이 그 순간부터 없는 파일을 부른다.
///
/// **우리 이벤트만 보지 않는다.** 이벤트 목록이 판마다 바뀌면 지난 판이 깔아 둔 이벤트가
/// 목록 밖으로 나가 **영영 못 걷는 훅**이 된다. 근거는 목록이 아니라 명령 문자열이다.
///
/// 빈 껍데기는 함께 걷는다 — 우리가 만들어 둔 그룹·배열·`hooks` 구획이 알맹이 없이
/// 남으면 「되돌렸다」가 파일에서는 거짓이 된다. **다만 「지금 비어 있는 것」이 아니라
/// 「이번 제거가 비운 것」만이다** — 사람이 손으로 적어 둔 빈 그룹·빈 배열·빈 `hooks`는
/// 우리가 만든 껍데기가 아니라 그 사람의 내용이라, 걷으면 「우리 항목만 걷어낸다」가 깨진다.
pub fn unmerge_claude(source: &str) -> Result<String, String> {
    // 원문이 비어 있으면 걷을 것이 없다. 여기서 `{}`를 내면 claude를 한 번도 안 쓴 사람이
    // 「제거」를 누른 것만으로 `~/.claude/settings.json`이 생긴다 — codex 쪽은 빈 원문을
    // 빈 채로 돌려줘 아무것도 안 쓰는데, 같은 층에서 둘이 갈릴 이유가 없다.
    if source.trim().is_empty() {
        return Ok(source.to_string());
    }

    let mut root = parse_claude(source)?;

    // **이번 제거가 실제로 걷어낸 것이 있나.** 없으면 원문을 글자 그대로 돌려준다 —
    // 그러면 `apply`의 `after == before`가 참이 되어 디스크에 손이 안 간다. 이 플래그가
    // 없으면 비지 않은 파일은 언제나 파싱 후 재직렬화라, 사람이 4칸 들여쓰기로 관리하던
    // 파일이 **우리 것이 하나도 없어도** 통째로 다시 쓰이고 `.bak`이 뜬다. 우리가 지운 것은
    // 없는데 남의 파일만 바뀌어 있는 자리다(git dotfiles라면 전체가 diff로 뜬다).
    // `apply`의 독이 「바뀔 것이 없으면 아무것도 안 쓴다」라고 적고, `unmerge_claude`의 독이
    // 「codex 쪽은 아무것도 안 쓰는데 같은 층에서 둘이 갈릴 이유가 없다」고 적어 둔 그
    // 불변조건을 — 말이 아니라 값으로 — 세우는 한 줄이다.
    let mut removed = false;

    if let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) {
        let mut emptied_events: Vec<String> = Vec::new();
        for (event, list) in hooks.iter_mut() {
            let Some(list) = list.as_array_mut() else { continue };

            // 이번 제거가 **비운** 그룹의 자리. 처음부터 비어 있던 그룹은 여기 안 든다.
            let mut emptied: Vec<usize> = Vec::new();
            for (at, group) in list.iter_mut().enumerate() {
                // **`group["hooks"]`(IndexMut)를 안 쓴다.** serde_json의 그 구현은 없는 키를
                // `null`로 심고(남의 그룹에 우리가 키를 남긴다), 객체가 아닌 원소에서는
                // **패닉한다** — 거부가 아니라 폭발이라, 사람이 보는 것은 「제거를 눌렀더니
                // 앱이 이상해졌다」이고 그 명령의 프로미스가 안 끝나 버튼 둘이 잠긴다.
                let Some(inner) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                    continue;
                };
                let before = inner.len();
                inner.retain(|h| !h["command"].as_str().is_some_and(is_ours));
                if inner.len() < before {
                    removed = true;
                    if inner.is_empty() {
                        emptied.push(at);
                    }
                }
            }
            if emptied.is_empty() {
                continue;
            }
            let mut at = 0;
            list.retain(|_| {
                let keep = !emptied.contains(&at);
                at += 1;
                keep
            });
            if list.is_empty() {
                emptied_events.push(event.clone());
            }
        }
        for event in &emptied_events {
            hooks.remove(event);
        }
        if !emptied_events.is_empty() && hooks.is_empty() {
            root.remove("hooks");
        }
    }

    if !removed {
        return Ok(source.to_string());
    }

    let mut out = serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|e| format!("설정을 옮겨 적지 못했습니다: {e}"))?;
    out.push('\n');
    Ok(out)
}

/// 설치됐나. **설정 파일을 읽어 판정한다** — 앱은 따로 기억하지 않는다(구현 결정 8).
///
/// 다섯이 다 있어야 설치된 것이다. 하나라도 빠졌으면 「아님」이라야 설치 버튼이 그것을
/// 채운다 — 반쯤 깔린 상태를 「설치됨」이라 부르면 사람이 고칠 길이 화면에서 사라진다.
pub fn claude_installed(source: &str) -> Result<bool, String> {
    let root = parse_claude(source)?;
    let Some(hooks) = root.get("hooks").and_then(Value::as_object) else {
        return Ok(false);
    };
    Ok(CLAUDE_EVENTS.iter().all(|event| {
        hooks
            .get(*event)
            .and_then(Value::as_array)
            .is_some_and(|list| list.iter().any(claude_group_is_ours))
    }))
}

/// claude 쪽 짝(`codex_remains` 참조). 이쪽은 제거가 명령 문자열로 걷으므로 정상 경로에서
/// 늘 거짓이다 — 그래도 자리를 비워 두지 않는 것은, 걷는 규칙이 바뀌어 못 걷는 자리가
/// 생기면 화면이 침묵하는 대신 그것을 말하게 하기 위해서다.
fn claude_remains(source: &str) -> bool {
    let Ok(root) = parse_claude(source) else { return false };
    root.get("hooks").and_then(Value::as_object).is_some_and(|hooks| {
        hooks.values().any(|list| {
            list.as_array().is_some_and(|groups| groups.iter().any(claude_group_is_ours))
        })
    })
}

/// 빈 파일은 `{}`와 같다 — 첫 실행이 정상 경로다. **깨진 JSON은 거부한다**: 조용히
/// 기본값으로 넘어가면 우리 훅 다섯 줄과 맞바꿔 사용자의 설정 전부가 사라진다.
fn parse_claude(source: &str) -> Result<Map<String, Value>, String> {
    if source.trim().is_empty() {
        return Ok(Map::new());
    }
    let value: Value = serde_json::from_str(source)
        .map_err(|e| format!("설정 파일이 잘못됐습니다: {e} — 손대지 않았습니다"))?;
    match value {
        Value::Object(map) => Ok(map),
        _ => Err("설정 파일의 맨 바깥이 객체가 아닙니다 — 손대지 않았습니다".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn script() -> PathBuf {
        PathBuf::from("/Users/someone/.atelier/hooks/atelier-hook.py")
    }

    /// **첫 검사 케이스가 실물이다** — 지금 사용자의 `~/.claude/settings.json`에는 다른
    /// 도구(codegraph)의 `UserPromptSubmit` 훅이 이미 앉아 있다. 설치가 그것을 덮어쓰면
    /// 사용자는 앱을 켠 대가로 남의 도구를 잃는다.
    #[test]
    fn a_foreign_hook_on_the_same_event_survives() {
        let source = r#"{
  "model": "opus",
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "codegraph prompt-hook" } ] }
    ]
  }
}"#;

        let merged = merge_claude(source, &script()).expect("병합이 된다");
        let value: Value = serde_json::from_str(&merged).expect("JSON이다");

        assert_eq!(value["model"], "opus", "우리 키 밖의 내용이 사라졌다");

        let prompt = value["hooks"]["UserPromptSubmit"].as_array().expect("배열이다");
        let commands: Vec<&str> =
            prompt.iter().filter_map(|g| g["hooks"][0]["command"].as_str()).collect();
        assert!(
            commands.contains(&"codegraph prompt-hook"),
            "남의 훅이 사라졌다: {commands:?}"
        );
        assert!(
            commands.iter().any(|c| c.contains("atelier-hook.py")),
            "우리 훅이 안 들어갔다: {commands:?}"
        );

        for event in CLAUDE_EVENTS {
            let list = value["hooks"][event].as_array().unwrap_or_else(|| {
                panic!("`{event}`에 아무것도 안 들어갔다: {merged}")
            });
            assert!(
                list.iter().any(|g| g["hooks"][0]["command"]
                    .as_str()
                    .is_some_and(|c| c.contains("atelier-hook.py"))),
                "`{event}`에 우리 훅이 없다"
            );
        }
    }

    /// 빈 파일 · 아예 없는 파일이 **첫 실행의 정상 경로**다.
    #[test]
    fn an_empty_file_becomes_a_settings_file_with_only_our_hooks() {
        for source in ["", "   \n", "{}"] {
            let merged = merge_claude(source, &script()).expect("병합이 된다");
            let value: Value = serde_json::from_str(&merged).expect("JSON이다");
            let hooks = value["hooks"].as_object().expect("`hooks`가 섰다");
            assert_eq!(hooks.len(), CLAUDE_EVENTS.len(), "이벤트 수가 다르다: {merged}");
        }
    }

    /// **버튼을 두 번 눌러도 한 번이다**(스토리 72). 두 번째 병합은 첫 번째 결과와
    /// 글자까지 같아야 한다 — 다르면 그 차이가 곧 파일에 쌓이는 쓰레기다.
    #[test]
    fn installing_twice_is_the_same_as_installing_once() {
        let once = merge_claude("{}", &script()).unwrap();
        let twice = merge_claude(&once, &script()).unwrap();
        assert_eq!(once, twice);
    }

    /// **깨진 JSON은 거부하고 손대지 않는다.** 조용히 기본값으로 넘어가면 우리 훅 다섯
    /// 줄과 맞바꿔 사용자의 설정 전부가 사라진다.
    #[test]
    fn broken_json_is_refused() {
        for source in ["{ 여기서 잘렸", "[1, 2]", "\"글자\""] {
            let err = merge_claude(source, &script()).expect_err("거부해야 한다");
            assert!(err.contains("손대지 않았습니다"), "무슨 일이 났는지 안 말한다: {err}");
        }
    }

    /// **제거는 우리 항목만 걷어낸다.** 설치 전 파일과 글자까지 같아야 한다 — 되돌릴 수
    /// 있다는 말(스토리 74)이 「거의 되돌아간다」면 사람은 다음부터 버튼을 안 누른다.
    #[test]
    fn removing_ours_leaves_the_file_as_it_was() {
        let before = r#"{
  "model": "opus",
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "codegraph prompt-hook"
          }
        ]
      }
    ]
  }
}
"#;
        let installed = merge_claude(before, &script()).unwrap();
        assert_ne!(installed, before, "설치가 아무것도 안 했다");

        let removed = unmerge_claude(&installed).expect("제거가 된다");
        assert_eq!(removed, before, "제거가 원래 파일로 안 돌아왔다");
    }

    /// 남의 훅이 **우리 그룹 안에** 섞여 있어도 그것만은 남는다. 우리는 늘 우리 그룹을
    /// 따로 만들지만, 사람이 파일을 손으로 고쳐 한 그룹에 둘을 넣어 둘 수 있다.
    #[test]
    fn a_foreign_hook_inside_our_group_is_kept() {
        let source = format!(
            r#"{{"hooks":{{"Stop":[{{"hooks":[{{"type":"command","command":{}}},{{"type":"command","command":"say done"}}]}}]}}}}"#,
            serde_json::to_string(&command_line(&script(), "claude", "Stop")).unwrap()
        );

        let removed = unmerge_claude(&source).expect("제거가 된다");
        let value: Value = serde_json::from_str(&removed).unwrap();
        let inner = value["hooks"]["Stop"][0]["hooks"].as_array().expect("그룹이 남았다");
        assert_eq!(inner.len(), 1, "남의 훅까지 걷었거나 우리 것이 남았다: {removed}");
        assert_eq!(inner[0]["command"], "say done");
    }

    /// 깨진 파일은 제거에서도 거부한다 — 손대지 않는 쪽이 늘 안전하다.
    #[test]
    fn removing_from_broken_json_is_refused() {
        assert!(unmerge_claude("{ 잘렸").is_err());
    }

    /// **우리 훅이 하나도 없는 파일은 제거를 지나도 안 바뀐다.** 이 한 줄이 세 자리를
    /// 한꺼번에 지킨다 — 없는 `hooks` 키를 우리가 심지 않는 것, 객체가 아닌 원소에서
    /// 터지지 않는 것, 사람이 적어 둔 빈 구조를 우리가 비운 것으로 오인해 걷지 않는 것.
    ///
    /// **견주는 값이 원문 그대로다.** 한때 이 자리가 `pretty(원문)`이었다 — 제거가 늘 파싱
    /// 후 재직렬화라 들여쓰기까지 같을 수는 없다는 인정이었고, 그 인정이 **디스크 층까지
    /// 이어지지 않아** 우리 것이 하나도 없는 남의 파일이 통째로 재작성되던 자리다. 이제
    /// 걷은 것이 없으면 원문을 글자 그대로 돌려주므로, 여기서도 글자로 잰다.
    #[test]
    fn a_file_without_our_hooks_is_untouched_by_removal() {
        for source in [
            // 사람이 손으로 적어 둔 남의 그룹 — 안쪽 `hooks` 키가 아예 없다.
            r#"{"hooks":{"Stop":[{"matcher":"Bash"}]}}"#,
            // JSON으로는 멀쩡한데 모양만 다른 것. 여기서 **패닉**이 나면 거부가 아니라
            // 폭발이고, Tauri 명령의 프로미스가 안 끝나 화면의 버튼 둘이 영영 잠긴다.
            r#"{"hooks":{"Stop":["oops",null,123]}}"#,
            // 사람이 적어 둔 빈 구조 셋. 우리가 비운 것이 아니라 원래 그렇게 적힌 것이다.
            r#"{"model":"opus","hooks":{"Stop":[{"hooks":[]}],"Notification":[]}}"#,
            r#"{"model":"opus","hooks":{}}"#,
        ] {
            assert_eq!(
                unmerge_claude(source).expect("제거가 된다"),
                source,
                "제거가 남의 파일을 다시 썼다: {source}"
            );
        }
    }

    /// **없던 파일은 제거가 만들지 않는다.** claude를 한 번도 안 쓴 사람이 「제거」를 누르면
    /// `~/.claude/settings.json`이 `{}` 한 줄로 생기던 자리다 — codex 쪽은 빈 원문을 빈 채로
    /// 돌려줘 아무것도 안 쓰는데, 같은 층에서 두 에이전트가 갈릴 이유가 없다.
    #[test]
    fn removing_from_an_empty_file_writes_nothing() {
        assert_eq!(unmerge_claude("").expect("제거가 된다"), "");

        let home = temp_home("remove-empty");
        uninstall(&home, &script());
        assert!(!claude_settings_path(&home).exists(), "제거가 없던 파일을 만들었다");
        assert!(!codex_config_path(&home).exists(), "제거가 없던 파일을 만들었다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **설치 여부는 파일이 답한다.** 앱이 따로 기억하는 상태가 없다는 말이 이렇게
    /// 읽힌다 — 손으로 적어 둔 훅도 「설치됨」이고, 손으로 지운 훅은 「아님」이다.
    #[test]
    fn installed_is_read_from_the_file() {
        assert!(!claude_installed("{}").unwrap(), "빈 파일이 설치됨이다");

        let installed = merge_claude("{}", &script()).unwrap();
        assert!(claude_installed(&installed).unwrap(), "설치한 파일이 아님이다");

        let removed = unmerge_claude(&installed).unwrap();
        assert!(!claude_installed(&removed).unwrap(), "제거한 파일이 설치됨이다");
    }

    /// **반쯤 깔린 것은 「아님」이다.** 사람이 한 줄을 지웠거나 판이 바뀌어 이벤트가
    /// 늘었을 때, 「설치됨」이라 답하면 설치 버튼이 잠겨 채울 길이 사라진다.
    #[test]
    fn a_half_installed_file_is_not_installed() {
        let installed = merge_claude("{}", &script()).unwrap();
        let mut value: Value = serde_json::from_str(&installed).unwrap();
        value["hooks"].as_object_mut().unwrap().remove("Stop");

        assert!(!claude_installed(&value.to_string()).unwrap());
    }

    /// 깨진 파일에서는 **판정을 안 한다.** 「아님」이라 답하면 화면이 설치 버튼을 열고,
    /// 눌러 봐야 병합이 거부해 사람은 왜인지 모른 채 두 번 실패한다.
    #[test]
    fn installed_on_broken_json_is_refused_not_false() {
        assert!(claude_installed("{ 잘렸").is_err());
    }

    // ── Codex TOML

    /// 실물의 모양이다 — 최상위 키 몇 줄 뒤에 테이블이 줄줄이 선다. **`notify`가 이미
    /// 차 있다**: 거기 물려 둔 다른 도구가 죽으면 안 된다(구현 결정 8 · 스토리 77).
    const CODEX_REAL: &str = r#"model = "gpt-5"
notify = ["SkyComputerUseClient", "turn-ended"]

[projects."/Users/someone/dev/atelier"]
trust_level = "trusted"
"#;

    /// **matcher 그룹과 명령 블록이 짝으로 들어간다**(구현 결정 8). 한쪽만 적히면 TOML이
    /// 통째로 거부돼 사용자의 codex가 안 뜬다 — 그래서 파싱해서 잰다.
    #[test]
    fn codex_gets_a_matcher_group_and_a_command_block_per_event() {
        let merged = merge_codex(CODEX_REAL, &script()).expect("병합이 된다");
        let value: toml::Table = toml::from_str(&merged).expect("TOML이다");

        let hooks = value["hooks"].as_table().expect("`hooks` 테이블이 섰다");
        for event in CODEX_EVENTS {
            let groups = hooks[*event].as_array().unwrap_or_else(|| panic!("`{event}`가 없다"));
            assert_eq!(groups.len(), 1, "`{event}`의 matcher 그룹이 하나가 아니다");
            let inner =
                groups[0]["hooks"].as_array().unwrap_or_else(|| panic!("`{event}`에 명령 블록이 없다"));
            assert_eq!(inner.len(), 1);
            assert_eq!(inner[0]["type"].as_str(), Some("command"));
            assert!(
                inner[0]["command"].as_str().is_some_and(|c| c.contains("atelier-hook.py")),
                "`{event}`의 명령이 우리 것이 아니다"
            );
        }
    }

    /// **`notify`는 안 건드린다**(스토리 77). 그리고 파일 앞부분이 글자 그대로 살아 있어야
    /// 한다 — 덧붙이기이지 다시 쓰기가 아니다.
    #[test]
    fn codex_notify_and_the_rest_of_the_file_are_untouched() {
        let merged = merge_codex(CODEX_REAL, &script()).unwrap();
        assert!(merged.starts_with(CODEX_REAL), "앞부분이 바뀌었다:\n{merged}");

        let value: toml::Table = toml::from_str(&merged).unwrap();
        assert_eq!(
            value["notify"].as_array().map(Vec::len),
            Some(2),
            "`notify`가 바뀌었다 — 거기 물려 둔 도구가 죽는다"
        );
    }

    /// **파일 끝 개행 유무를 본다.** 마지막 줄에 개행이 없는 파일에 그냥 이어 붙이면
    /// 사용자의 마지막 키와 우리 주석이 한 줄에 붙어 TOML이 깨진다.
    #[test]
    fn codex_without_a_trailing_newline_is_still_valid_toml() {
        let merged = merge_codex("model = \"gpt-5\"", &script()).expect("병합이 된다");
        toml::from_str::<toml::Table>(&merged).expect("TOML이다");
    }

    /// 파일이 아예 없는 것도 정상 경로다 — codex를 처음 쓰는 사람이다.
    #[test]
    fn codex_from_an_empty_file_is_valid_toml() {
        let merged = merge_codex("", &script()).unwrap();
        let value: toml::Table = toml::from_str(&merged).unwrap();
        assert_eq!(value["hooks"].as_table().map(toml::Table::len), Some(CODEX_EVENTS.len()));
    }

    /// 두 번 눌러도 한 번이다 — 여기서는 블록이 두 벌 쌓이면 TOML이 **배열에 원소를
    /// 두 개** 넣어 훅이 두 번 돈다.
    #[test]
    fn merging_codex_twice_is_the_same_as_once() {
        let once = merge_codex(CODEX_REAL, &script()).unwrap();
        let twice = merge_codex(&once, &script()).unwrap();
        assert_eq!(once, twice);
    }

    /// **깨진 TOML은 거부하고 손대지 않는다.**
    #[test]
    fn broken_toml_is_refused() {
        let err = merge_codex("model = ", &script()).expect_err("거부해야 한다");
        assert!(err.contains("손대지 않았습니다"), "무슨 일이 났는지 안 말한다: {err}");
    }

    /// 제거는 설치 전 파일로 **글자까지** 돌아온다.
    #[test]
    fn removing_the_codex_block_leaves_the_file_as_it_was() {
        let installed = merge_codex(CODEX_REAL, &script()).unwrap();
        assert_ne!(installed, CODEX_REAL);
        assert_eq!(unmerge_codex(&installed).unwrap(), CODEX_REAL);
    }

    /// 설치·제거를 되풀이해도 파일 끝에 빈 줄이 쌓이지 않는다.
    #[test]
    fn install_and_remove_can_repeat_without_growing_the_file() {
        let mut now = CODEX_REAL.to_string();
        for _ in 0..3 {
            now = merge_codex(&now, &script()).unwrap();
            now = unmerge_codex(&now).unwrap();
        }
        assert_eq!(now, CODEX_REAL);
    }

    /// 설치 여부는 여기서도 파일이 답한다.
    #[test]
    fn codex_installed_is_read_from_the_file() {
        assert!(!codex_installed(CODEX_REAL).unwrap());
        let installed = merge_codex(CODEX_REAL, &script()).unwrap();
        assert!(codex_installed(&installed).unwrap());
        assert!(!codex_installed(&unmerge_codex(&installed).unwrap()).unwrap());
        assert!(codex_installed("model = ").is_err(), "깨진 파일에서 판정을 하면 안 된다");
    }

    /// **울타리만 있고 알맹이가 빠진 것은 「아님」이다.** 사람이 블록 안을 손으로
    /// 지웠거나 판이 바뀌어 이벤트가 늘었을 때 그렇다.
    #[test]
    fn a_codex_block_missing_an_event_is_not_installed() {
        let installed = merge_codex(CODEX_REAL, &script()).unwrap();
        // 헤더 한 줄만 지운다 — 남은 키들이 위 matcher 그룹으로 흘러들어 **TOML로는
        // 여전히 멀쩡하다.** 그래서 이 케이스가 「파일은 안 깨졌는데 훅은 없다」다.
        let broken = installed.replace("[[hooks.Stop.hooks]]\ntype", "type");
        toml::from_str::<toml::Table>(&broken).expect("여전히 TOML이다");
        assert!(!codex_installed(&broken).unwrap());
    }

    /// 이 내용에서 그 이벤트에 우리 명령이 앉아 있는가 — 검사 쪽 잣대. 판정 함수와 같은
    /// 길을 따로 걷는다(구현을 그대로 부르면 구현이 틀려도 검사가 같이 틀린다).
    fn codex_ours_count(source: &str, event: &str) -> usize {
        let value: toml::Table = toml::from_str(source).expect("TOML이다");
        let Some(groups) = value.get("hooks").and_then(|h| h.get(event)).and_then(toml::Value::as_array)
        else {
            return 0;
        };
        groups
            .iter()
            .filter(|group| {
                group
                    .get("hooks")
                    .and_then(toml::Value::as_array)
                    .is_some_and(|inner| {
                        inner.iter().any(|h| {
                            h.get("command").and_then(toml::Value::as_str).is_some_and(is_ours)
                        })
                    })
            })
            .count()
    }

    /// 우리 블록과 같은 모양을 **울타리 없이** 손으로 적어 둔 파일.
    fn codex_by_hand(script: &Path) -> String {
        let mut out = String::from(CODEX_REAL);
        for event in CODEX_EVENTS {
            out.push_str(&format!(
                "\n[[hooks.{event}]]\n\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {}\n",
                toml_basic_string(&command_line(script, CODEX, event))
            ));
        }
        out
    }

    /// **울타리는 있는데 우리 명령이 없으면 「아님」이다.** 판정 근거는 헤더 줄이 아니라
    /// 명령 문자열이다(구현 결정 8) — 사람이 `command` 줄만 지웠는데 「설치됨」이라 답하면
    /// 설치 버튼이 잠겨 채울 길이 사라진다(claude 쪽 `a_half_installed_file_is_not_installed`와 같은 자리).
    #[test]
    fn a_codex_block_without_our_command_is_not_installed() {
        let installed = merge_codex(CODEX_REAL, &script()).unwrap();
        let line =
            format!("command = {}\n", toml_basic_string(&command_line(&script(), "codex", "Stop")));
        let gutted = installed.replace(&line, "");
        assert_ne!(gutted, installed, "지울 줄을 못 찾았다 — 검사가 아무것도 안 재고 있다");
        toml::from_str::<toml::Table>(&gutted).expect("여전히 TOML이다");

        assert!(!codex_installed(&gutted).unwrap(), "명령이 없는데 「설치됨」이다");
    }

    /// **손으로 적어 둔 codex 훅도 「설치됨」이다** — claude 쪽 짝
    /// (`a_hand_written_hook_reads_as_installed`)과 같은 잣대여야 한다. 그리고 그 위에
    /// 설치를 눌러도 **사본이 하나 더 붙지 않는다**: 붙으면 이벤트마다 훅이 두 번 돈다.
    #[test]
    fn a_hand_written_codex_hook_reads_as_installed_and_is_not_doubled() {
        let by_hand = codex_by_hand(&script());
        assert!(codex_installed(&by_hand).unwrap(), "손으로 적은 훅이 「안 깔림」이다");

        let merged = merge_codex(&by_hand, &script()).expect("병합이 된다");
        toml::from_str::<toml::Table>(&merged).expect("TOML이다");
        for event in CODEX_EVENTS {
            assert_eq!(codex_ours_count(&merged, event), 1, "`{event}`에 우리 명령이 두 벌이다");
        }
    }

    // ── 디스크에 넣는 층

    fn temp_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("atelier-hooks-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude")).unwrap();
        dir
    }

    /// **쓰기 전에 `.bak` 한 벌**(구현 결정 8). 내 설정을 앱에 맡기는 일이라, 병합이
    /// 잘못돼도 사람이 손으로 되돌릴 벌이 옆에 있어야 한다.
    ///
    /// **원자적이어야 한다.** 반쯤 쓰인 `settings.json`은 claude가 아예 안 뜨는 상태다 —
    /// 임시 파일이 그 자리에 남아 있으면 그 보장은 이미 깨진 것이다(`settings.rs`의 같은 검사).
    #[test]
    fn writing_leaves_a_backup_and_no_tmp() {
        let home = temp_home("backup");
        let path = claude_settings_path(&home);
        let before = "{\n  \"model\": \"opus\"\n}\n";
        std::fs::write(&path, before).unwrap();

        apply(&path, |source| merge_claude(source, &script())).expect("넣는다");

        assert_eq!(
            std::fs::read_to_string(path.with_extension("json.bak")).expect(".bak이 없다"),
            before,
            ".bak이 쓰기 전 내용이 아니다"
        );
        assert!(std::fs::read_to_string(&path).unwrap().contains("atelier-hook.py"));

        let leftovers: Vec<String> = std::fs::read_dir(home.join(".claude"))
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "임시 파일이 남았다: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **원본의 권한을 그대로 물려준다.** 이 판이 새로 여는 자리는 **남의 홈**이라
    /// (`~/.claude/settings.json` · `~/.codex/config.toml`) 여기서 넓어지는 것은 우리 파일이
    /// 아니라 사람이 일부러 좁혀 둔 파일이다 — 실물 둘 다 0600이고 `env` 구획이 앉아 있다.
    ///
    /// **원자적 교체가 바로 그 자리다.** 새로 만든 tmp의 모드는 `0666 & !umask`(보통 0644)이고
    /// rename은 그 모드를 목적지로 그대로 옮긴다. `.bak`은 `std::fs::copy`라 0600으로 남으므로,
    /// 안 고치면 **백업만 좁고 살아 있는 설정이 넓어지는** 뒤집힌 모양이 된다.
    #[cfg(unix)]
    #[test]
    fn writing_keeps_the_files_mode() {
        use std::os::unix::fs::PermissionsExt;

        let home = temp_home("mode");
        let path = claude_settings_path(&home);
        std::fs::write(&path, "{\n  \"model\": \"opus\"\n}\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

        apply(&path, |source| merge_claude(source, &script())).expect("넣는다");

        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            format!("{mode:o}"),
            "600",
            "설치 한 번이 남의 설정을 이 기계의 다른 사용자에게 열었다"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **심링크를 끊지 않는다.** dotfiles 저장소에서 `~/.claude/settings.json`을 심링크로 걸어
    /// 둔 사람은 설치 한 번에 그것이 보통 파일로 갈리고, 그 뒤 저장소를 고쳐도 claude에
    /// 안 닿는다 — 조용하고 되돌리기 어려운 손해라 rename의 목적지를 실물로 고른다.
    #[cfg(unix)]
    #[test]
    fn writing_does_not_break_a_symlink() {
        let home = temp_home("symlink");
        let real = home.join("dotfiles-settings.json");
        std::fs::write(&real, "{\n  \"model\": \"opus\"\n}\n").unwrap();
        let path = claude_settings_path(&home);
        std::os::unix::fs::symlink(&real, &path).unwrap();

        apply(&path, |source| merge_claude(source, &script())).expect("넣는다");

        assert!(
            std::fs::symlink_metadata(&path).unwrap().file_type().is_symlink(),
            "심링크가 보통 파일로 갈렸다 — 저장소를 고쳐도 이제 claude에 안 닿는다"
        );
        assert!(
            std::fs::read_to_string(&real).unwrap().contains("atelier-hook.py"),
            "심링크 너머의 진짜 파일이 안 바뀌었다"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **걷은 것이 하나도 없으면 디스크에 손이 안 간다.** 순수 함수 층의
    /// `a_file_without_our_hooks_is_untouched_by_removal`이 「내용이 안 바뀐다」까지만 재고,
    /// 그 인정이 여기까지 안 이어져 있었다 — `apply`의 판정은 **글자 일치**라, 사람이 손으로
    /// 4칸 들여쓰기로 관리하던 파일은 우리 것이 하나도 없어도 통째로 재작성되고 `.bak`이 뜬다.
    /// 우리가 지운 것은 없는데 남의 파일만 바뀌어 있는 자리다(git dotfiles라면 전체가 diff).
    #[test]
    fn removing_touches_nothing_when_there_was_nothing_of_ours() {
        let home = temp_home("remove-untouched");
        let path = claude_settings_path(&home);
        // 4칸 들여쓰기 · 끝 개행 없음 — serde_json의 pretty 출력과 글자가 다르다.
        let before = "{\n    \"model\": \"opus\"\n}";
        std::fs::write(&path, before).unwrap();

        uninstall(&home, &script());

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            before,
            "우리 것이 하나도 없는데 남의 파일을 다시 썼다"
        );
        assert!(!path.with_extension("json.bak").exists(), "걷은 것이 없는데 벌을 떴다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **못 걷은 것이 있으면 화면이 그것을 말한다.** codex 쪽 제거는 우리 울타리 두 줄만 보고
    /// 잘라내므로(`strip_codex_block`), 사람이 울타리 밖에 손으로 적어 둔 우리 훅은 그대로
    /// 산다 — 그런데 판정(`codex_installed`)은 명령 문자열이라 「설치됨」이다. 두 잣대가
    /// 갈린 채 침묵하면 사람은 「제거를 눌렀는데 아무 일도 안 나고 여전히 설치됨」을 만나고,
    /// 화면에는 그 사실을 알릴 칸이 없다.
    ///
    /// claude 쪽은 명령 문자열로 걷으니 손글씨도 사라진다 — 그래서 그쪽은 아무 말도 안 한다.
    #[test]
    fn a_hook_we_could_not_remove_is_said_out_loud() {
        let home = temp_home("codex-by-hand");
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(codex_config_path(&home), codex_by_hand(&script())).unwrap();

        let by_hand: serde_json::Map<String, Value> = CLAUDE_EVENTS
            .iter()
            .map(|event| ((*event).to_string(), json!([claude_group(&script(), event)])))
            .collect();
        std::fs::write(
            claude_settings_path(&home),
            json!({ "hooks": Value::Object(by_hand) }).to_string(),
        )
        .unwrap();

        let gone = uninstall(&home, &script());

        let codex = agent(&gone, "codex");
        assert!(codex.installed, "이 파일은 여전히 우리 명령을 들고 있다");
        let said = codex.write_error.clone().unwrap_or_default();
        assert!(
            said.contains("config.toml") && said.contains(crate::shells::SCRIPT_NAME),
            "제거가 조용히 아무 일도 안 했다 — 어느 파일의 무엇을 지워야 하는지 화면이 말할 것이 없다: {said:?}"
        );

        let claude = agent(&gone, "claude");
        assert!(!claude.installed, "claude 쪽 손글씨가 안 걷혔다");
        assert_eq!(claude.write_error, None, "다 걷었는데 남았다고 말한다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **바뀔 것이 없으면 안 쓴다.** 두 번째 설치가 파일을 다시 쓰면 `.bak`이 「우리 훅이
    /// 이미 든 내용」으로 덮여, 되돌릴 벌이 사라진다.
    #[test]
    fn a_second_install_does_not_overwrite_the_backup() {
        let home = temp_home("twice");
        let path = claude_settings_path(&home);
        let before = "{\n  \"model\": \"opus\"\n}\n";
        std::fs::write(&path, before).unwrap();

        apply(&path, |s| merge_claude(s, &script())).unwrap();
        apply(&path, |s| merge_claude(s, &script())).unwrap();

        assert_eq!(
            std::fs::read_to_string(path.with_extension("json.bak")).unwrap(),
            before,
            "두 번째 설치가 되돌릴 벌을 덮어썼다"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// 깨진 파일은 **손대지 않는다** — 원문 그대로 남고 `.bak`도 안 생긴다.
    #[test]
    fn a_broken_file_is_left_alone_on_disk() {
        let home = temp_home("broken-disk");
        let path = claude_settings_path(&home);
        let before = "{ 여기서 잘렸";
        std::fs::write(&path, before).unwrap();

        apply(&path, |s| merge_claude(s, &script())).expect_err("거부해야 한다");

        assert_eq!(std::fs::read_to_string(&path).unwrap(), before, "깨진 파일을 고쳤다");
        assert!(!path.with_extension("json.bak").exists(), "손도 안 댔는데 벌을 떴다");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// 폴더가 없는 것도 정상 경로다 — codex를 처음 쓰는 사람의 홈에는 `~/.codex`가 없다.
    #[test]
    fn a_missing_folder_is_created() {
        let home = temp_home("no-folder");
        let path = codex_config_path(&home);
        assert!(!path.parent().unwrap().exists());

        apply(&path, |s| merge_codex(s, &script())).expect("넣는다");

        let written = std::fs::read_to_string(&path).unwrap();
        toml::from_str::<toml::Table>(&written).expect("TOML이다");
        let _ = std::fs::remove_dir_all(&home);
    }

    // ── 화면이 보는 창구

    fn agent<'a>(list: &'a [HookStatus], name: &str) -> &'a HookStatus {
        list.iter().find(|s| s.agent == name).unwrap_or_else(|| panic!("`{name}`이 없다"))
    }

    /// 설치 → 상태 → 제거가 한 바퀴 돈다. **판정은 늘 파일에서 온다**(구현 결정 8).
    #[test]
    fn install_then_status_then_uninstall() {
        let home = temp_home("round");

        let before = status(&home, &script());
        assert_eq!(before.len(), 2, "에이전트가 둘이다");
        assert!(!agent(&before, "claude").installed);
        assert!(!agent(&before, "codex").installed);

        let after = install(&home, &script());
        assert!(agent(&after, "claude").installed, "{:?}", agent(&after, "claude").error);
        assert!(agent(&after, "codex").installed, "{:?}", agent(&after, "codex").error);
        // **새로 물어봐도 같은 답이다** — 방금 돌려준 값이 앱의 기억이 아니라 파일의 사실이다.
        assert_eq!(status(&home, &script()), after);

        let gone = uninstall(&home, &script());
        assert!(!agent(&gone, "claude").installed);
        assert!(!agent(&gone, "codex").installed);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **한쪽이 깨져도 다른 쪽은 깔린다.** 한 번의 거부가 둘을 다 막으면, codex 설정을
    /// 손으로 고칠 때까지 claude 쪽 신호도 못 켠다.
    #[test]
    fn a_broken_file_on_one_side_does_not_block_the_other() {
        let home = temp_home("one-broken");
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(codex_config_path(&home), "model = ").unwrap();

        let after = install(&home, &script());
        assert!(agent(&after, "claude").installed, "claude가 codex 때문에 막혔다");

        let codex = agent(&after, "codex");
        assert!(!codex.installed);
        assert!(codex.error.is_some(), "왜 안 됐는지 화면이 말할 것이 없다");
        assert_eq!(
            std::fs::read_to_string(codex_config_path(&home)).unwrap(),
            "model = ",
            "깨진 파일을 고쳤다"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **손으로 적어 둔 훅도 「설치됨」이다.** 앱이 따로 기억하는 상태가 없다는 말이
    /// 이렇게 읽힌다 — 이 경로는 `install`을 한 번도 안 지났다.
    #[test]
    fn a_hand_written_hook_reads_as_installed() {
        let home = temp_home("hand-written");
        let by_hand: serde_json::Map<String, Value> = CLAUDE_EVENTS
            .iter()
            .map(|event| ((*event).to_string(), json!([claude_group(&script(), event)])))
            .collect();
        std::fs::write(
            claude_settings_path(&home),
            json!({ "hooks": Value::Object(by_hand) }).to_string(),
        )
        .unwrap();

        assert!(agent(&status(&home, &script()), "claude").installed);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **미리보기는 실제로 들어가는 글자다**(스토리 73). 화면이 따로 적으면 「무엇이
    /// 어디에 들어가는지 보여 준다」는 약속이 실물과 조용히 갈린다.
    ///
    /// **이름이 「빈 홈」인 이유:** claude 쪽 미리보기는 `merge_claude("{}")`, 곧 설정이
    /// 비어 있을 때의 결과다. 이미 내용이 있는 파일에서는 그 등식이 안 선다 — 거기서
    /// 지켜야 하는 것은 「미리보기가 보인 것이 다 들어간다」이고, 그것은 아래 검사가 잰다.
    #[test]
    fn the_preview_is_what_goes_into_an_empty_home() {
        let home = temp_home("preview");
        let before = status(&home, &script());
        install(&home, &script());

        let claude = std::fs::read_to_string(claude_settings_path(&home)).unwrap();
        assert_eq!(agent(&before, "claude").preview, claude, "미리보기가 실물과 다르다");

        let codex = std::fs::read_to_string(codex_config_path(&home)).unwrap();
        assert!(codex.contains(&agent(&before, "codex").preview), "미리보기가 실물과 다르다");

        // **어느 파일인지 값으로 못박는다.** 「`.c`가 들어 있다」는 두 경로 아무 데나
        // 걸려, 두 에이전트의 경로가 뒤바뀌어도 검사가 아무 말을 안 한다. (여기서 `~`로
        // 안 접히는 것은 임시 홈이 진짜 홈이 아니어서다 — 접는 자리는 `collapse_home`이다.)
        assert_eq!(
            agent(&before, "claude").path,
            claude_settings_path(&home).to_string_lossy(),
            "claude 칸이 claude 파일을 안 가리킨다"
        );
        assert_eq!(
            agent(&before, "codex").path,
            codex_config_path(&home).to_string_lossy(),
            "codex 칸이 codex 파일을 안 가리킨다"
        );
        assert!(agent(&before, "claude").path.ends_with("/.claude/settings.json"));
        assert!(agent(&before, "codex").path.ends_with("/.codex/config.toml"));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **내용이 이미 있는 파일에서도 미리보기가 보인 것은 다 들어간다.** 실물이 그
    /// 경우다(구현 결정 8 — 사용자의 `settings.json`에 codegraph 훅이 이미 있다).
    #[test]
    fn an_existing_file_gets_everything_the_preview_showed() {
        let home = temp_home("preview-existing");
        let before = r#"{"model":"opus","hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"codegraph prompt-hook"}]}]}}"#;
        std::fs::write(claude_settings_path(&home), before).unwrap();

        let shown = agent(&status(&home, &script()), "claude").preview.clone();
        install(&home, &script());
        let after: Value =
            serde_json::from_str(&std::fs::read_to_string(claude_settings_path(&home)).unwrap())
                .unwrap();

        assert_eq!(after["model"], "opus", "우리 키 밖의 내용이 사라졌다");
        let shown: Value = serde_json::from_str(&shown).expect("미리보기가 JSON이다");
        for (event, groups) in shown["hooks"].as_object().expect("미리보기에 `hooks`가 있다") {
            let ours = groups[0]["hooks"][0]["command"].as_str().expect("명령이 있다");
            let landed = after["hooks"][event]
                .as_array()
                .is_some_and(|list| list.iter().any(|g| g["hooks"][0]["command"] == ours));
            assert!(landed, "미리보기가 보인 `{event}`이 파일에 없다");
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    /// **쓰기가 실패했다고 아는 사실을 「모른다」로 지우지 않는다.** 파일이 읽기 전용이면
    /// 제거의 쓰기만 실패하고 판정은 멀쩡히 된다 — 그때 화면이 「확인 못 함」이라 적으면
    /// 이 판이 세운 낱말 셋(설치됨·설치 안 됨·확인 못 함)의 뜻이 그 자리에서 깨진다.
    /// 그래서 칸이 둘이다: `write_error`는 방금 난 일, `error`는 판정을 못 한 까닭.
    #[test]
    fn a_write_failure_does_not_erase_what_we_know() {
        let home = temp_home("write-failed");
        install(&home, &script());

        let one = look(&AGENTS[0], &home, &script(), Some("설정을 쓰지 못했습니다".to_string()));
        assert!(one.installed, "읽어서 아는 사실을 쓰기 실패가 지웠다");
        assert_eq!(one.error, None, "판정은 됐는데 「확인 못 함」 칸에 적혔다");
        assert_eq!(one.write_error.as_deref(), Some("설정을 쓰지 못했습니다"));
        let _ = std::fs::remove_dir_all(&home);
    }
}

