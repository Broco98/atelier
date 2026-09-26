//! spec 레이아웃 엔진 — spec 폴더의 모양을 데이터로 들고, 에이전트가 받는 안내문과 앱이 그리는
//! spec 트리를 만든다.
//!
//! **규칙은 여기 한 벌이다**(결정 13). MCP 서버, 앱의 Tauri 명령, L4 다리가 모두 이 함수들을
//! 부르고 어댑터로만 남는다. 데이터 루트는 늘 인자로 받는다 — 엔진은 환경 변수를 읽지 않는다.
//!
//! **파일마다 무리 하나다.** 코드 내장본 둘(`builtin`), 파일 목록을 spec 트리로 가르기(`classify`),
//! 레이아웃의 모양(`model`), 디스크 형식 — 읽기가 곧 검증이다(`parse`), 이름 틀(`pattern`), 에이전트가
//! 받는 안내문(`render`), 이번 호출에 쓸 레이아웃 고르기와 물러서기(`resolve`), 설정 페이지의 모드 행
//! 상태(`states`), 저장소 — 읽기·미리보기·저장·되돌리기(`store`), 앱 쪽 work 응답에 트리 싣기
//! (`work_trees`)가 각자 파일을 갖는다. 한 무리를 고치러 온 사람이 다른 무리를 열지 않아도 되게
//! 나눴고, 무리의 규칙과 그 까닭은 제 파일 머리말에 적는다.

mod builtin;
mod classify;
mod model;
mod parse;
mod pattern;
mod render;
mod resolve;
mod states;
mod store;
mod work_trees;

pub use builtin::builtin_layout;
pub use classify::{classify, SpecTree, SpecTreeGroup, SpecTreeItem};
pub use model::{EntryKind, LayoutEntry, SpecLayout};
pub use parse::{parse_layout, serialize_layout, serialize_layout_value, LayoutError};
pub use render::{render_layout, EntryLines, Fallback, Rendered, TemplateVerdict};
pub use resolve::{resolve_layout, LayoutSource, Resolved};
pub use states::{layout_states, LayoutState};
pub use store::{
    preview_layout, read_layout, revert_layout, save_layout, LayoutContent, LayoutPreview, LayoutRead,
    SaveOutcome,
};
pub use work_trees::{
    classify_archived_docs, classify_works, with_archived_spec_tree, with_spec_trees, ArchivedDocs,
    WorkWithSpecTree,
};
