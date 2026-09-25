//! 시작 보고 — 앱이 뜰 때 한 일을 **붙잡아 두고**, 프런트가 부팅 때 한 번 묻는다(프로세스 결정 6 ·
//! 프로세스 스펙 S11).
//!
//! **이벤트로 쏘지 않는다.** 앱이 뜨는 순간의 일은 웹뷰가 `listen`을 걸기 전에 끝날 수 있고, 그때 쏜
//! 이벤트는 아무도 못 듣고 지나간다. 붙잡아 둔 값은 늦게 물어도 그대로 있다. 묻는 자리는 프런트의
//! `main.tsx` 한 곳이다(`src/components/shell/startup-report.ts`).
//!
//! 싣는 것은 둘이다: 지난 실행이 남긴 확정 고아를 치운 결과(티켓 10이 채운다)와, 이미 깔린 에이전트 훅을
//! 새 목록으로 맞춘 결과(티켓 21이 채운다). **이 판에서는 둘 다 비어 있고 곧바로 답한다** — 시작 때
//! 기다릴 일이 아직 없다. 「할 일이 끝날 때까지 기다렸다 답한다」는 자리는 시작 정리와 함께 선다.

use std::sync::Mutex;

use serde::Serialize;

/// 앱이 뜰 때 한 일. 프런트의 `StartupReport`(`src/components/shell/startup-report.ts`)와 **필드 이름으로만**
/// 이어진다 — 어긋나면 컴파일도 타입 검사도 통과하고 토스트만 조용히 안 선다. 그래서 와이어 모양을
/// 아래 검사가 글자로 못박는다.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupReport {
    /// 시작 정리가 **실제로 끝낸** 것 — 결과가 「끝남」이거나 「강제」인 것만 싣는다. 「이미 없음」은
    /// 끝낸 것이 아니라서 안 싣는다: 전부 이미 없었으면 알릴 것도 없다. 수는 이 목록의 길이다.
    pub cleaned: Vec<Cleaned>,
    /// 훅을 새 목록으로 맞춘 에이전트(`claude` · `codex`). 비어 있으면 맞출 것이 없었다.
    pub hooks_updated: Vec<String>,
}

/// 시작 정리가 끝낸 프로세스 하나.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Cleaned {
    pub pid: u32,
    /// 커널이 아는 이름.
    pub name: String,
}

/// 보고를 붙잡아 두는 자리. 앱이 하나 들고(`lib.rs`의 `manage`) 명령이 읽는다.
///
/// **읽어도 비우지 않는다.** 웹뷰가 새로고침되면 부팅이 다시 돌아 또 묻고, 같은 답이 가서 같은 토스트가
/// 한 번 더 선다. 한 번만 주려면 「이미 받아 갔다」를 여기서 들어야 하는데, 받아 간 웹뷰가 그것을 그리기
/// 전에 새로고침됐는지는 Rust가 모른다 — 비우면 그때 알림이 통째로 사라진다.
#[derive(Debug, Default)]
pub struct ReportHolder {
    report: Mutex<StartupReport>,
}

impl ReportHolder {
    /// 묻는 쪽에 줄 답. 잠금이 독에 걸려도 답한다 — 보고는 알림일 뿐이라 앞 스레드의 패닉이 부팅을
    /// 멈출 까닭이 없다.
    pub fn answer(&self) -> StartupReport {
        self.report.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 이 판에는 시작 때 할 일이 없다 — 붙잡아 둔 보고는 비어 있고, 프런트는 알릴 것 없이 지나간다.
    #[test]
    fn a_fresh_holder_answers_an_empty_report() {
        assert_eq!(ReportHolder::default().answer(), StartupReport::default());
        assert!(ReportHolder::default().answer().cleaned.is_empty());
        assert!(ReportHolder::default().answer().hooks_updated.is_empty());
    }

    /// 와이어 모양. 프런트는 `cleaned` · `hooksUpdated`를 읽는다 — `rename_all`이 빠지면 훅 칸이
    /// `hooks_updated`로 나가 프런트가 `undefined`를 읽는다.
    #[test]
    fn the_report_crosses_the_wire_in_the_shape_the_frontend_reads() {
        let report = StartupReport {
            cleaned: vec![Cleaned { pid: 4242, name: "node".into() }],
            hooks_updated: vec!["claude".into()],
        };
        assert_eq!(
            serde_json::to_value(&report).unwrap(),
            serde_json::json!({
                "cleaned": [{ "pid": 4242, "name": "node" }],
                "hooksUpdated": ["claude"],
            })
        );
    }
}
