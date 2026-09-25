#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("project not found: {0}")]
    NotFound(String),
    #[error("invalid project file for '{slug}': {message}")]
    InvalidFile { slug: String, message: String },
    #[error("folder does not exist: {0}")]
    FolderMissing(String),
    #[error("name must not be empty")]
    EmptyName,
    #[error("work not found: {0}")]
    WorkNotFound(String),
    #[error("{0}")]
    Validation(String),
    // "uncommitted"만으로는 거짓이다 — 이 게이트가 실전에서 잡는 것은 거의 다 **추적조차
    // 안 된** 파일이고, 그 말을 믿고 `git stash`(`-u` 없이)를 하면 똑같이 막힌 채 이유를
    // 알 수 없다. 사용자가 실제로 그렇게 막혔다.
    #[error("uncommitted or untracked files in: {0}")]
    DirtyWorktrees(String),
    #[error("git: {0}")]
    Git(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

mod mode;
mod paths;
mod slug;
mod project;
mod git;
mod store;
mod work;
mod works;
mod atomic;
mod order;
mod recent;
mod search;
mod layout;

pub use mode::{mode_from_env, Mode, MODE_ENV};
pub use paths::{
    archive_dir, collapse_home, data_root, expand_home, mode_home, projects_dir,
    shared_projects_root, works_dir,
};
// **`touch_recent_work` 하나만 밖으로 낸다.** 읽는 쪽은 크레이트 안의 검색뿐이라
// (`search.rs`가 `crate::recent::read_recent`로 직접 부른다) 나머지를 내면 아무도 안 읽는
// 값이 계약에 남는다 — 이 크레이트가 `truncated`를 걷을 때 든 근거가 그것이다.
pub use recent::touch_recent_work;
pub use search::{search, Destination, SearchHit, SearchResults};
pub use slug::slugify;
pub use layout::{
    builtin_layout, classify, classify_archived_docs, classify_works, parse_layout, read_layout,
    render_layout, resolve_layout, save_layout, serialize_layout, with_archived_spec_tree, with_spec_trees,
    ArchivedDocs, EntryKind, Fallback, LayoutContent, LayoutEntry, LayoutError, LayoutRead,
    LayoutSource, Rendered, Resolved, SaveOutcome, SpecLayout, SpecTree, SpecTreeGroup, SpecTreeItem,
    TemplateVerdict, WorkWithSpecTree,
};
pub use project::{parse_project, render_project, Project, ProjectView};
pub use git::{detect as detect_git, origin_head, GitInfo};
pub use store::{
    create_project, delete_project, get_project, list_projects, update_project, ProjectPatch,
};
pub use work::{parse_work, render_work, WorktreeView, Work, WorkStatus, WorkView};
pub use works::{
    archive_work, attach_project, get_work, list_archive, list_archived_docs, list_works,
    move_work, read_spec_file, read_work_file, remove_work, render_record, start_work, update_work_pinned,
    update_work_status, update_work_title, ArchiveEntry, WorkReport, WorktreeError,
};
