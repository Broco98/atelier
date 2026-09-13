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
/// 다만 **파싱에 성공했을 때만** 보존된다: 깨진 파일은 빈 순서로 눕고, 그때 쓰는 쪽은 아예 안
/// 쓴다(`forget_in_order`).
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

/// 순서를 읽는다. **실패하지 않는다 — 없으면 빈 순서, 깨졌으면 빈 순서 + stderr 한 줄.**
///
/// `recent.json`과 같은 판단이다(`recent.rs`의 `read_recent`): 목록 읽기는 검색이 글자마다 부르는
/// 자리라 파일 한 장 때문에 사이드바도 팔레트도 못 뜨면 안 된다. 순서 파일은 사람이 손으로도
/// 고치는 값이지만, 눕는 것은 **이 판정 하나**이고 파일은 안 건드린다 — 고치던 손질이 그대로
/// 남아 사람이 다시 고칠 수 있다. 조용히 비면 「순서가 왜 풀렸지」에 답할 자리가 없어 한 줄 남긴다.
///
/// **알고 두는 비용**: 검색이 글자마다 부르므로 깨진 파일은 글자마다 한 줄씩 남는다.
///
/// **파일도 폴더도 만들지 않는다.** 읽기가 무엇을 만들면 「읽기만 한다」가 거짓이 된다.
pub(crate) fn read_order(works_root: &Path) -> WorkOrder {
    let path = order_path(works_root);
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        // 없는 것은 정상이다 — 순서를 한 번도 안 만진 루트가 그 자리다(결정 4의 회귀 기준).
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return WorkOrder::default(),
        Err(e) => {
            eprintln!("atelier: order read failed ({}): {e}", path.display());
            return WorkOrder::default();
        }
    };
    match serde_json::from_str(&content) {
        Ok(order) => order,
        Err(e) => {
            eprintln!("atelier: order parse failed ({}): {e}", path.display());
            WorkOrder::default()
        }
    }
}

/// 원자적으로 쓴다(`atomic.rs`). **잠그지 않는다** — 앱·MCP·CLI가 겹쳐 쓰면 나중 쓰기가 이긴다.
/// 대가는 「방금 옮긴 자리가 한 번 풀린다」이고 다음 옮김이 고치는 반면, 잠금은 세 프로세스에
/// 걸친 기전을 하나 들인다(`recent.json`과 같은 판단).
pub(crate) fn write_order(works_root: &Path, order: &WorkOrder) -> Result<()> {
    let mut json = serde_json::to_string_pretty(order)
        .map_err(|e| crate::Error::Validation(format!("순서를 옮겨 적지 못했습니다: {e}")))?;
    json.push('\n');
    crate::atomic::write_atomically(works_root, ORDER_FILE, &json)
}

/// 순서 파일에서 그 slug를 뺀다 — work **삭제**가 부른다(S2). 지운 slug는 다시 쓸 수 있어서,
/// 안 빼면 같은 이름으로 새로 만든 작업이 파일 속 옛 자리에 선다(결정 4 위반).
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
