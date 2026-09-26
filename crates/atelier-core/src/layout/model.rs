//! 레이아웃의 모양 — `SpecLayout`과 그것을 이루는 `LayoutEntry`.
//!
//! **디스크 형식(`layout.json`)과 한 벌이다** (구현 스펙 1절 「모델」·「디스크 형식」). 읽기(parse)와
//! 검증은 이 모양 위에 따로 선다 — 여기는 「무엇을 담는가」만 적는다.

/// spec 폴더 하나의 모양. **맨 위 항목(`root`) 하나만 갖는다** — 맨 위 항목이 spec 폴더 자신이고,
/// 그 설명이 방침 문단이다(결정 10).
///
/// 표시 이름이 없다(결정 25). 레이아웃의 id(모드 이름)가 곧 이름이다.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SpecLayout {
    pub root: LayoutEntry,
    /// 모르는 최상위 키. 읽을 때 버리지 않고 쓸 때 되돌려 적는다 — 나중 판의 키(예: `extends`)를
    /// 이번 판이 지우지 않게 하는 칸이다(결정 3의 「열어 둠」).
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// 항목 하나 — 레이아웃을 이루는 파일·폴더의 자리.
///
/// 맨 위 항목에는 `pattern`과 `kind`가 없다(늘 폴더로 친다). 그 밖의 항목에는 둘 다 있어야
/// 하는데, 그것을 지키는 것은 읽기의 검증이지 이 타입이 아니다 — 그래서 둘이 `Option`이다.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct LayoutEntry {
    /// 이름 틀. 고정 이름(`overview.md`)이거나 자리 표시자(`{n}`·`{name}`)를 가진 틀이다.
    pub pattern: Option<String>,
    pub kind: Option<EntryKind>,
    /// 에이전트에게 가는 문장. **없음과 빈 문자열은 같다** — 그래서 `Option`이 아니다.
    pub description: String,
    /// 앱이 그리는 아이콘 이름. 엔진은 해석하지 않고 넘기기만 한다 — 안내문에도 안 실린다.
    pub icon: Option<String>,
    /// 레이아웃 폴더 기준 템플릿 경로. 파일 항목만 가질 수 있다.
    pub template: Option<String>,
    /// 자식 항목. 폴더 항목만 가질 수 있고 깊이 제한은 없다.
    pub children: Vec<LayoutEntry>,
    /// 모르는 키. 레이아웃의 `extra`와 같은 규약이다 — 모든 층에서 보존한다.
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// 파일인가 폴더인가. spec 트리가 JSON으로 내보낼 때는 `layout.json`의 `kind`와 같은 글자
/// (`"file"`·`"folder"`)다 — 읽기(parse)는 이 파생을 쓰지 않고 글자를 손으로 가른다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Folder,
}

impl LayoutEntry {
    /// 폴더로 치는가. **`kind`가 없으면 폴더다** — 그런 항목은 맨 위 항목뿐이고(그 밖은 검증이
    /// 거절한다), 맨 위 항목은 spec 폴더 자신이다.
    pub fn is_folder(&self) -> bool {
        self.kind != Some(EntryKind::File)
    }
}
