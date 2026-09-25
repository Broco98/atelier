//! 진행 중 루트의 순서 파일 한 장 — `<작업 루트>/.order.json` (UI개선 결정 1~4 · S1).
//!
//! **자리가 모드 홈이 아니라 진행 중 루트 안이다.** 목록 읽기(`list_works`)가 이미 그 루트 하나만
//! 받으므로, 앱 명령·MCP·테스트 다리 세 표면이 호출을 안 바꾸고 같은 순서를 받는다. `recent.json`
//! 옆에 두면 세 표면의 호출을 다 바꿔야 하고, 하나를 빠뜨리면 그 표면만 옛 순서를 준다.
//! 점 파일이라 slug와 못 부딪치고(slug 검사가 앞 점을 거부한다) 목록 열거와 감시자가 건너뛴다.
//!
//! **여기 사는 것은 파일 한 장의 읽기·쓰기뿐이다.** 그 순서로 목록을 세우는 규칙은
//! `works.rs`의 `order_works` 한 자리가 쥔다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::Result;

/// 파일 이름. 점으로 시작하는 것이 계약이다 — 목록 열거가 work로 안 읽고, 감시자가 소식으로
/// 안 읽는다(tmp 이름도 여기서 나와 같은 접두사를 진다).
const ORDER_FILE: &str = ".order.json";

/// 순서 파일 전체. **`order`가 유일한 칸이고 앞이 위다.**
///
/// 모르는 최상위 키는 `extra`에 담아 그대로 되쓴다 — `recent.json`·`work.json`과 같은 규약이다.
/// 다만 **파싱에 성공했을 때만** 보존된다 — 깨진 파일은 옮기기가 벌로 떠 두고 덮는다
/// (`read_order`·`rewrite_order` 머리말).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct WorkOrder {
    #[serde(default)]
    pub(crate) order: Vec<String>,
    #[serde(flatten)]
    pub(crate) extra: serde_json::Map<String, serde_json::Value>,
}

fn order_path(works_root: &Path) -> PathBuf {
    works_root.join(ORDER_FILE)
}

/// 순서를 읽는다. **실패하지 않는다 — 없으면 빈 순서, 깨졌으면 빈 순서 + stderr 한 줄**
/// (`atomic.rs`의 `read_json_or_default`).
///
/// **순서 파일은 사람이 손으로도 고치는 값인데도 설정 파일 편이 아니라 `recent.json` 편이다 —
/// 예외인 까닭을 여기 적는다.** 설정이 「실패로 말한다」 쪽인 것은 조용히 기본값으로 넘어가면
/// 다음 저장이 그 손질을 덮어쓰기 때문이다. 순서 파일에서는 그 위험을 **쓰는 쪽이 막는다**:
/// 눕는 것은 이 판정 하나이고 파일은 안 건드리며, 지우기(`forget_in_order`)는 빈 순서에서 뺄
/// slug가 없으니 아예 안 쓴다. 깨진 파일을 다시 쓰는 길은 **옮기기**(`works.rs`의 `reorder` —
/// 고정 토글도 탄다) 하나이고, 그 길은 이 읽기를 안 쓴다 — `read_order_to_rewrite`가 깨짐을
/// 가려 받아, 덮기 전에 원문 바이트를 벌로 떠 둔다(D2). 그러면서 목록 읽기는 검색이 글자마다
/// 부르는 자리라, 실패로 말하면 파일 한 장 때문에 사이드바도 팔레트도 못 뜬다 — 그쪽 비용이
/// 더 크다. 조용히 비면 「순서가 왜 풀렸지」에 답할 자리가 없어 한 줄 남긴다.
///
/// **알고 두는 비용**: 검색이 글자마다 부르므로 깨진 파일은 글자마다 한 줄씩 남는다.
pub(crate) fn read_order(works_root: &Path) -> WorkOrder {
    crate::atomic::read_json_or_default(&order_path(works_root), "order")
}

/// 다시 쓰려고 읽은 순서. 깨진 파일이었다면 **그 원문 바이트를 함께 든다** — 쓰는 자리
/// (`rewrite_order`)가 그것을 벌로 떠 두지 않고는 덮을 수 없게, 둘을 한 값에 묶었다.
pub(crate) struct OrderToRewrite {
    pub(crate) order: WorkOrder,
    broken: Option<Vec<u8>>,
}

/// 옮기기가 **다시 쓰려고** 읽는다. `read_order`와 달리 세 갈래를 가른다:
///
/// - 없음 → 빈 순서(첫 옮김).
/// - 읽혔고 파싱됨 → 그 순서.
/// - **읽혔는데 못 쓰는 바이트**(JSON이 아니다 · UTF-8이 아니다) → 빈 순서 + 원문 바이트. 옮기기는
///   그대로 되고, 쓰기 직전에 원문이 벌로 남는다. 「못 쓴다」를 파싱 실패로만 좁히면 UTF-8이
///   아닌 파일은 `read_to_string`에서 먼저 넘어져 조용히 덮인다 — 그래서 바이트로 읽는다.
/// - **아예 못 읽음**(권한 등, 없음이 아닌 오류) → 거절한다. 떠 둘 바이트가 없는데 덮으면 그
///   파일은 흔적 없이 사라진다.
pub(crate) fn read_order_to_rewrite(works_root: &Path) -> Result<OrderToRewrite> {
    let path = order_path(works_root);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(OrderToRewrite { order: WorkOrder::default(), broken: None })
        }
        Err(e) => {
            // 인자가 아니라 로컬 파일 탓이다 — `Validation`이면 MCP가 에이전트에게 「인자를 고쳐 다시
            // 불러라」라고 시킨다(`atelier-cli`의 `tool_error.rs`). `Io`는 「사람에게 알려라」로 간다.
            return Err(crate::Error::Io(std::io::Error::new(
                e.kind(),
                format!("순서 파일을 읽지 못해 순서를 바꾸지 않았습니다 ({}): {e}", path.display()),
            )))
        }
    };
    Ok(match serde_json::from_slice(&bytes) {
        Ok(order) => OrderToRewrite { order, broken: None },
        Err(_) => OrderToRewrite { order: WorkOrder::default(), broken: Some(bytes) },
    })
}

/// 다시 쓴다. **깨진 파일이었으면 먼저 원문을 벌로 떠 두고**(`atomic.rs`의 `keep_aside` —
/// 이전 벌을 안 덮는다) 그 경로를 stderr 한 줄로 남긴 뒤 쓴다. 벌을 못 뜨면 안 쓴다.
///
/// 앱 화면에 알리는 자리는 아직 없다 — `move_work`의 응답이 목록 한 벌이라, 알리려면 응답
/// 모양을 바꿔야 한다. 그날까지 흔적은 벌 파일 자체와 이 줄이다.
pub(crate) fn rewrite_order(works_root: &Path, rewrite: OrderToRewrite) -> Result<()> {
    if let Some(bytes) = &rewrite.broken {
        let kept = crate::atomic::keep_aside(works_root, ORDER_FILE, bytes)?;
        eprintln!(
            "atelier: order file was unreadable as JSON ({}); kept its bytes as {} before rewriting it",
            order_path(works_root).display(),
            kept.display()
        );
    }
    write_order(works_root, &rewrite.order)
}

/// 원자적으로 쓴다(`atomic.rs`). **잠그지 않는다** — 앱·MCP·CLI가 겹쳐 쓰면 나중 쓰기가 이긴다.
/// 대가는 「방금 옮긴 자리가 한 번 풀린다」이고 다음 옮김이 고치는 반면, 잠금은 세 프로세스에
/// 걸친 기전을 하나 들인다(`recent.json`과 같은 판단).
///
/// **이 모듈 밖으로 안 연다** — 밖에서 `read_order`(깨진 파일 = 빈 순서)와 짝지으면 D2가 돌아온다.
/// 다시 쓰는 길은 `rewrite_order`(벌을 먼저 뜬다)나 `forget_in_order`(뺄 것이 없으면 안 쓴다)다.
fn write_order(works_root: &Path, order: &WorkOrder) -> Result<()> {
    crate::atomic::write_json_atomically(works_root, ORDER_FILE, order, "순서를")
}

/// 순서 파일에서 그 slug를 뺀다 — work **삭제**가 부른다(S2). 지운 slug는 다시 쓸 수 있어서,
/// 안 빼면 같은 이름으로 새로 만든 작업이 파일 속 옛 자리에 선다(UI개선 결정 4 위반).
///
/// **그 slug가 파일에 없으면 아무것도 안 쓴다.** 없던 파일을 만들지 않고, 깨진 파일을 빈 순서로
/// 덮지도 않는다 — 깨진 파일은 읽기에서 빈 순서로 눕으므로 「없음」과 같은 갈래로 떨어진다.
///
/// 아카이브는 이것을 안 부른다: 아카이브된 slug는 코어가 재사용을 막고(`start_work`), 남은
/// 흔적은 목록 규칙 4(폴더 없는 slug는 흘린다)가 흘린다.
pub(crate) fn forget_in_order(works_root: &Path, slug: &str) -> Result<()> {
    let mut order = read_order(works_root);
    let before = order.order.len();
    order.order.retain(|listed| listed != slug);
    if order.order.len() == before {
        return Ok(());
    }
    write_order(works_root, &order)
}
