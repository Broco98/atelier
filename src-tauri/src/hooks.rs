//! 에이전트 훅 설치 — 사용자의 claude·codex 설정에 우리 훅을 **병합해** 넣고 걷어낸다.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

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
        "hooks": [{ "type": "command", "command": command_line(script, "claude", event) }]
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
    let mut out = String::from(CODEX_BEGIN);
    out.push('\n');
    for event in CODEX_EVENTS {
        // **두 블록이 짝이다**(구현 결정 8). `[[hooks.<Event>]]`가 matcher 그룹이고
        // `[[hooks.<Event>.hooks]]`가 그 안의 명령이다 — 앞의 것 없이 뒤의 것만 적으면
        // 붙일 그룹이 없어 TOML이 거부한다. matcher는 안 적는다: 도구 이름으로 거르는
        // 자리가 아니라 이벤트 전부를 받는다.
        out.push_str(&format!(
            "\n[[hooks.{event}]]\n\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {}\n",
            toml_basic_string(&command_line(script, "codex", event))
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
    validate_toml(source)?;

    let mut out = strip_codex_block(source);
    if !out.is_empty() {
        // **파일 끝 개행 유무를 본다.** 없는데 그냥 이으면 사용자의 마지막 키와 우리
        // 주석이 한 줄에 붙어 파일이 통째로 깨진다.
        if !out.ends_with('\n') {
            out.push('\n');
        }
        out.push('\n');
    }
    out.push_str(&codex_block(script));
    Ok(out)
}

/// 우리 구획만 잘라낸 새 내용.
///
/// **파일 끝 개행을 하나로 고른다.** 잘라낸 자리 앞에 우리가 넣었던 빈 줄이 남으면
/// 설치·제거를 되풀이할 때마다 파일 끝에 빈 줄이 쌓인다.
pub fn unmerge_codex(source: &str) -> Result<String, String> {
    validate_toml(source)?;
    Ok(strip_codex_block(source))
}

/// 설치됐나 — **파일을 읽어 판정한다.** 우리 구획이 서 있고 그 안에 이벤트 다섯이 다
/// 있어야 설치된 것이다(Claude 쪽과 같은 규칙).
pub fn codex_installed(source: &str) -> Result<bool, String> {
    validate_toml(source)?;
    let Some(block) = codex_block_span(source).map(|(from, to)| &source[from..to]) else {
        return Ok(false);
    };
    Ok(CODEX_EVENTS.iter().all(|event| block.contains(&format!("[[hooks.{event}.hooks]]"))))
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
fn apply(path: &Path, transform: impl Fn(&str) -> Result<String, String>) -> Result<(), String> {
    let before = read_or_empty(path)?;
    let after = transform(&before)?;
    if after == before {
        return Ok(());
    }

    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| format!("설정 폴더를 만들지 못했습니다: {e}"))?;

    // 벌은 **원문이 있을 때만** 뜬다. 없던 파일을 새로 만드는 길에는 되돌릴 것이 없다.
    if path.exists() {
        let backup = backup_path(path);
        std::fs::copy(path, &backup)
            .map_err(|e| format!("설정을 백업하지 못했습니다 ({}): {e}", backup.display()))?;
    }

    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = dir.join(format!(".{name}.atelier.tmp"));
    std::fs::write(&tmp, after).map_err(|e| format!("설정을 쓰지 못했습니다: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("설정을 바꿔 넣지 못했습니다: {e}"))
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
    /// 파일이 깨져 **판정도 설치도 못 했으면** 그 까닭. 그때 `installed`는 거짓이지만
    /// 「안 깔렸다」가 아니라 「모른다」다 — 화면이 그 둘을 갈라 적는다.
    pub error: Option<String>,
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
}

const AGENTS: &[Agent] = &[
    Agent {
        name: "claude",
        path: claude_settings_path,
        merge: merge_claude,
        unmerge: unmerge_claude,
        installed: claude_installed,
        preview: claude_preview,
    },
    Agent {
        name: "codex",
        path: codex_config_path,
        merge: merge_codex,
        unmerge: unmerge_codex,
        installed: codex_installed,
        preview: codex_block,
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
pub fn uninstall(home: &Path, script: &Path) -> Vec<HookStatus> {
    AGENTS
        .iter()
        .map(|agent| {
            let unmerge = agent.unmerge;
            let failed = apply(&(agent.path)(home), |source| unmerge(source)).err();
            look(agent, home, script, failed)
        })
        .collect()
}

/// 한 에이전트의 지금 모습을 **파일에서** 만든다. `failed`는 방금 넣거나 걷다 난 오류다 —
/// 그것이 있으면 판정보다 그쪽을 적는다(사람이 알아야 하는 것은 방금 무슨 일이 났나다).
fn look(agent: &Agent, home: &Path, script: &Path, failed: Option<String>) -> HookStatus {
    let path = (agent.path)(home);
    let read = read_or_empty(&path).and_then(|source| (agent.installed)(&source));
    HookStatus {
        agent: agent.name.to_string(),
        path: atelier_core::collapse_home(&path),
        installed: read.clone().unwrap_or(false),
        error: failed.or_else(|| read.err()),
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

/// **깨진 TOML은 거부한다.** 여기서만 파서를 쓴다 — 쓰는 것은 텍스트 덧붙이기이고,
/// 파서가 하는 일은 「손대도 되는 파일인가」를 답하는 것 하나다.
fn validate_toml(source: &str) -> Result<(), String> {
    toml::from_str::<toml::Table>(source)
        .map(|_| ())
        .map_err(|e| format!("설정 파일이 잘못됐습니다: {e} — 손대지 않았습니다"))
}

/// 우리 훅만 걷어낸 새 내용. **스크립트 파일은 안 지운다** — 남아도 무해하고, 지우면
/// 아직 살아 있는 셸의 훅이 그 순간부터 없는 파일을 부른다.
///
/// **우리 이벤트만 보지 않는다.** 이벤트 목록이 판마다 바뀌면 지난 판이 깔아 둔 이벤트가
/// 목록 밖으로 나가 **영영 못 걷는 훅**이 된다. 근거는 목록이 아니라 명령 문자열이다.
///
/// 빈 껍데기는 함께 걷는다 — 우리가 만들어 둔 그룹·배열·`hooks` 구획이 알맹이 없이
/// 남으면 「되돌렸다」가 파일에서는 거짓이 된다.
pub fn unmerge_claude(source: &str) -> Result<String, String> {
    let mut root = parse_claude(source)?;

    if let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) {
        for (_event, list) in hooks.iter_mut() {
            let Some(list) = list.as_array_mut() else { continue };
            for group in list.iter_mut() {
                let Some(inner) = group["hooks"].as_array_mut() else { continue };
                inner.retain(|h| !h["command"].as_str().is_some_and(is_ours));
            }
            // 알맹이가 없어진 그룹만 걷는다. **처음부터 빈 그룹은 남긴다** — 우리가 비운
            // 것이 아니라 사람이 그렇게 적어 둔 것이다.
            list.retain(|group| !group["hooks"].as_array().is_some_and(Vec::is_empty));
        }
        hooks.retain(|_event, list| !list.as_array().is_some_and(Vec::is_empty));
        let empty = hooks.is_empty();
        if empty {
            root.remove("hooks");
        }
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
    #[test]
    fn the_preview_is_what_actually_goes_in() {
        let home = temp_home("preview");
        let before = status(&home, &script());
        install(&home, &script());

        let claude = std::fs::read_to_string(claude_settings_path(&home)).unwrap();
        assert_eq!(agent(&before, "claude").preview, claude, "미리보기가 실물과 다르다");

        let codex = std::fs::read_to_string(codex_config_path(&home)).unwrap();
        assert!(codex.contains(&agent(&before, "codex").preview), "미리보기가 실물과 다르다");

        for one in &before {
            assert!(one.path.contains(".c"), "어느 파일인지 안 적혔다: {}", one.path);
        }
        let _ = std::fs::remove_dir_all(&home);
    }
}

