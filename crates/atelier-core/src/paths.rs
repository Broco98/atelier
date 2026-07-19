use std::path::{Path, PathBuf};

/// 데이터 루트. `ATELIER_HOME`은 테스트용 내부 오버라이드.
pub fn projects_dir() -> PathBuf {
    let base = std::env::var_os("ATELIER_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().expect("no home directory").join(".atelier"));
    base.join("projects")
}

pub fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

pub fn collapse_home(path: &Path) -> String {
    if let Some(home) = dirs::home_dir() {
        if let Ok(rest) = path.strip_prefix(&home) {
            return format!("~/{}", rest.display());
        }
    }
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_and_collapse_are_inverse_for_home_paths() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_home("~/dev/billing"), home.join("dev/billing"));
        assert_eq!(collapse_home(&home.join("dev/billing")), "~/dev/billing");
    }

    #[test]
    fn non_home_paths_pass_through() {
        assert_eq!(expand_home("/opt/x"), std::path::PathBuf::from("/opt/x"));
        assert_eq!(collapse_home(std::path::Path::new("/opt/x")), "/opt/x");
    }
}
