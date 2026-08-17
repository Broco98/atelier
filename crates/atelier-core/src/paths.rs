use std::path::{Path, PathBuf};

/// 데이터 루트. `ATELIER_HOME`은 테스트용 내부 오버라이드.
fn data_root() -> PathBuf {
    std::env::var_os("ATELIER_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().expect("no home directory").join(".atelier"))
}

pub fn projects_dir() -> PathBuf {
    data_root().join("projects")
}

pub fn works_dir() -> PathBuf {
    data_root().join("works")
}

pub fn sessions_dir() -> PathBuf {
    data_root().join("sessions")
}

/// 어댑터별 실행 커맨드를 담는 사용자 설정. **아틀리에는 이 파일을 만들지 않는다** — 읽기만 한다.
pub fn adapters_file() -> PathBuf {
    data_root().join("adapters.json")
}

/// 끝난 work가 옮겨가 머무는 곳. **status가 아니라 장소로** 관심 밖에 둔다 —
/// 작업 목록을 읽는 코드는 이 루트를 보지 않으므로, 목록에서 빠지는 것이 규약이 아니라
/// 구조가 된다.
pub fn archive_dir() -> PathBuf {
    data_root().join("archive")
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
