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
    #[error("uncommitted changes in: {0} (use --force to remove anyway)")]
    DirtyTrees(String),
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

pub use paths::{adapters_file, collapse_home, expand_home, projects_dir, sessions_dir, works_dir};
pub use slug::slugify;
pub use project::{parse_project, render_project, Project, ProjectView};
pub use git::{detect as detect_git, origin_head, GitInfo};
pub use store::{
    create_project, delete_project, get_project, list_projects, update_project, ProjectPatch,
};
pub use work::{parse_work, render_work, TreeView, Work, WorkStatus, WorkView};
pub use works::{
    attach_project, get_work, list_works, read_spec_file, remove_work, start_work,
    update_work_status, WorkReport, TreeError,
};
pub use sessions::{create_session, get_session, list_sessions, NewSession, Session, StartPoint};
