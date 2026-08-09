//! 어댑터의 실행 커맨드를 사용자 설정에서 읽는다 (확정 결정 2).
//!
//! 이 설정이 **제품의 seam이자 테스트의 seam이다.** 커맨드를 가짜 에이전트로 가리키면
//! 프로토콜 층 전체가 자동 테스트 안으로 들어온다. 테스트 전용 주입점을 따로 만들지 않는다.
//!
//! 설정 파일은 어댑터 키에서 커맨드 문자열로 가는 JSON 한 겹이다.
//!
//! ```json
//! { "codex": "npx @agentclientprotocol/codex-acp" }
//! ```

use std::path::Path;

/// 신원 파일에 적히는 어댑터 키. 판 01은 어댑터가 하나뿐이라 상수다 —
/// 고르는 자리는 두 번째 어댑터가 생기는 판 02에서 만든다.
pub const CODEX: &str = "codex";

/// 설정에 항목이 없을 때 쓰는 커맨드(확정 결정 2).
pub const DEFAULT_CODEX_COMMAND: &str = "npx @zed-industries/codex-acp";

/// Codex 어댑터를 띄우는 커맨드.
///
/// 파일이 없거나 읽히지 않거나 항목이 없으면 기본값을 쓴다. **아틀리에는 이 파일을 만들지
/// 않는다** — 사용자가 손으로 두면 그때부터 그게 이긴다.
pub fn codex_command(config_file: &Path) -> String {
    read_command(config_file, CODEX).unwrap_or_else(|| DEFAULT_CODEX_COMMAND.to_string())
}

fn read_command(config_file: &Path, agent: &str) -> Option<String> {
    let content = std::fs::read_to_string(config_file).ok()?;
    let config: serde_json::Value = serde_json::from_str(&content).ok()?;
    let command = config.get(agent)?.as_str()?.trim();
    if command.is_empty() {
        return None;
    }
    Some(command.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(content: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("adapters.json");
        std::fs::write(&path, content).unwrap();
        (tmp, path)
    }

    #[test]
    fn missing_file_falls_back_to_the_default_and_is_not_created() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("adapters.json");

        assert_eq!(codex_command(&path), DEFAULT_CODEX_COMMAND);
        assert!(!path.exists(), "아틀리에는 설정 파일을 만들지 않는다");
    }

    #[test]
    fn the_configured_command_wins() {
        let (_tmp, path) = config_with(r#"{"codex": "/opt/my-agent --acp"}"#);
        assert_eq!(codex_command(&path), "/opt/my-agent --acp");
    }

    #[test]
    fn a_file_without_this_adapter_falls_back() {
        let (_tmp, path) = config_with(r#"{"claude": "claude --acp"}"#);
        assert_eq!(codex_command(&path), DEFAULT_CODEX_COMMAND);
    }

    /// 손으로 두는 파일이라 깨질 수 있다. 깨진 설정 때문에 앱이 서지 않는 것보다
    /// 기본값으로 도는 편이 낫다.
    #[test]
    fn a_broken_or_blank_entry_falls_back() {
        let (_tmp, broken) = config_with("{ not json");
        assert_eq!(codex_command(&broken), DEFAULT_CODEX_COMMAND);

        let (_tmp2, blank) = config_with(r#"{"codex": "   "}"#);
        assert_eq!(codex_command(&blank), DEFAULT_CODEX_COMMAND);
    }
}
