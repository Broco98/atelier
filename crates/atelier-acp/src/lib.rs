/// 어댑터 커맨드의 기본값(확정 결정 2). 설정 파일에 항목이 없으면 이것을 쓴다.
pub const DEFAULT_CODEX_COMMAND: &str = "npx @zed-industries/codex-acp";

#[cfg(test)]
mod tests {
    use agent_client_protocol::{Agent, ConnectionTo};

    /// 살아있는 클라이언트 연결을 스레드 너머로 쥘 수 있는가 — 이 판이 태워야 했던 미지수다.
    /// 이 함수가 컴파일된다는 사실 자체가 답이고, 세션 매니저가 그 위에 선다.
    #[test]
    fn live_connection_can_be_shared_across_threads() {
        fn assert_shared<T: Send + Sync + Clone + 'static>() {}
        assert_shared::<ConnectionTo<Agent>>();
    }
}
