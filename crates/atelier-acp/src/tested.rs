//! 시험한 판과 견주기(restart 스펙 「01c — Codex」 판 · 스토리 43 · 티켓 01c-11) — Codex를 열 때 연 `codex-acp`의 `agentInfo.version`과
//! `codex --version`이 시험한 판(`discovery.rs`)과 다르면 Runtime 경고 글을 짓는다. 경고는 01b-8의 길(`stderr` 줄)로 적히고 대화는 막지 않는다.
//! `claude`는 보지 않는다.

use std::path::Path;

use crate::discovery::{CODEX_ACP_TESTED, CODEX_TESTED};
use crate::login::run_to_end;
use crate::login_env::AgentEnv;

/// `codex --version`이 말한 판 — 마지막 낱말이 숫자로 시작하는 첫 줄의 그 낱말이다(진짜 꼴은 `codex-cli 0.162.1`, 공식 설치 스크립트도
/// 이렇게 읽는다). 돌릴 수 없거나 판이 없으면 `None`이다. 막히는 호출이다(한도는 로그인 확인과 같다).
pub(crate) fn codex_version(codex: &Path, env: &AgentEnv, cwd: &Path) -> Option<String> {
    let ran = run_to_end(codex, &["--version"], env, cwd);
    let stdout = String::from_utf8_lossy(&ran.stdout).into_owned();
    stdout
        .lines()
        .filter_map(|line| line.split_whitespace().last())
        .find(|word| word.starts_with(|first: char| first.is_ascii_digit()))
        .map(str::to_owned)
}

/// 연 Codex의 판들이 시험한 판과 다르면 Runtime 경고 글 한 줄 — 다른 것마다 「이름 판(시험한 판 …)」을 잇는다. 판을 알 수 없으면 다른 것으로
/// 친다(시험한 판이라고 말할 수 없다). 둘 다 시험한 판이면 `None`이다.
pub(crate) fn codex_warning(agent_version: Option<&str>, codex_version: Option<&str>) -> Option<String> {
    let differs: Vec<String> = [("codex-acp", agent_version, CODEX_ACP_TESTED), ("codex", codex_version, CODEX_TESTED)]
        .into_iter()
        .filter(|(_, version, tested)| *version != Some(*tested))
        .map(|(name, version, tested)| format!("{name} {}(시험한 판 {tested})", version.unwrap_or("판 모름")))
        .collect();
    (!differs.is_empty()).then(|| {
        format!("시험하지 않은 Codex 판이에요 — {}. 대화는 그대로 이어 가지만 다르게 움직일 수 있어요", differs.join(" · "))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 판을_알_수_없으면_시험하지_않은_판으로_적는다() {
        assert_eq!(
            codex_warning(None, Some(CODEX_TESTED)).as_deref(),
            Some("시험하지 않은 Codex 판이에요 — codex-acp 판 모름(시험한 판 2.2.2). 대화는 그대로 이어 가지만 다르게 움직일 수 있어요")
        );
        assert_eq!(codex_warning(Some(CODEX_ACP_TESTED), Some(CODEX_TESTED)), None);
    }
}
