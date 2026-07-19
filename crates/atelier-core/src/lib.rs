#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("project not found: {0}")]
    NotFound(String),
    #[error("invalid project file for '{slug}': {message}")]
    InvalidFile { slug: String, message: String },
    #[error("folder does not exist: {0}")]
    FolderMissing(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

mod paths;
mod slug;

pub use paths::{collapse_home, expand_home, projects_dir};
pub use slug::slugify;
