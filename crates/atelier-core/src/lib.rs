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
    #[error("session not found: {0}")]
    SessionNotFound(String),
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

mod paths;
mod slug;
mod project;
mod git;
mod store;
mod work;
mod works;
mod sessions;

pub use paths::{
    adapters_file, archive_dir, collapse_home, expand_home, projects_dir, sessions_dir, works_dir,
};
pub use slug::slugify;
pub use project::{parse_project, render_project, Project, ProjectView};
pub use git::{detect as detect_git, origin_head, GitInfo};
pub use store::{
    create_project, delete_project, get_project, list_projects, update_project, ProjectPatch,
};
pub use work::{parse_work, render_work, WorktreeView, Work, WorkStatus, WorkView};
pub use works::{
    archive_work, attach_project, get_work, list_archive, list_archived_docs, list_works,
    read_spec_file, read_work_file, remove_work, render_record, start_work, update_work_status,
    update_work_title, ArchiveEntry, WorkReport, WorktreeError,
};
pub use sessions::{
    append_update, create_session, get_session, list_sessions, read_updates,
    set_session_agent_session_id, set_session_title_once, NewSession, Session, StartPoint,
};
