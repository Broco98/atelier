//! spec 레이아웃 엔진 — spec 폴더의 모양을 데이터로 들고, 에이전트가 받는 안내문과 앱이 그리는
//! spec 트리를 만든다.
//!
//! **규칙은 여기 한 벌이다**(결정 13). MCP 서버, 앱의 Tauri 명령, L4 다리가 모두 이 함수들을
//! 부르고 어댑터로만 남는다. 데이터 루트는 늘 인자로 받는다 — 엔진은 환경 변수를 읽지 않는다.
//!
//! **파일마다 무리 하나다.** 모델, 디스크 형식(parse), 이름 틀, 내장본, render, resolve, 분류
//! (classify)가 각자 파일을 갖고, 저장소도 그렇게 붙는다. 여러 판이 같은 모듈을 만지므로 한
//! 파일이면 판마다 부딪친다.

mod builtin;
mod classify;
mod model;
mod parse;
mod pattern;
mod render;
mod resolve;
mod work_trees;

pub use builtin::builtin_layout;
pub use classify::{classify, SpecTree, SpecTreeGroup, SpecTreeItem};
pub use model::{EntryKind, LayoutEntry, SpecLayout};
pub use parse::{parse_layout, serialize_layout, LayoutError};
pub use render::{render_layout, Fallback, Rendered, TemplateVerdict};
pub use resolve::{resolve_layout, LayoutSource, Resolved};
pub use work_trees::{
    classify_archived_docs, classify_works, with_archived_spec_tree, with_spec_trees, ArchivedDocs,
    WorkWithSpecTree,
};
