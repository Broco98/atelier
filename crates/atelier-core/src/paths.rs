use std::path::{Path, PathBuf};

/// 데이터 루트. `ATELIER_HOME`은 테스트용 내부 오버라이드.
///
/// **이 값을 부르는 쪽이 다시 계산하면 안 된다.** `~/.atelier`를 박아 두면 오버라이드가
/// 그 자리에서만 죽어서, 테스트가 진짜 홈을 건드리는 것이 조용히 시작된다. 아래 루트도 전부
/// 여기서 자란다. 최상위 터미널이 cwd 없이 뜰 때 서는 자리이기도 하다.
pub fn data_root() -> PathBuf {
    std::env::var_os("ATELIER_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_data_root(&dirs::home_dir().expect("no home directory")))
}

/// 오버라이드가 없을 때 그 홈의 데이터 루트 — `<홈>/.atelier`.
///
/// **데이터 루트가 필요한 자리는 이것이 아니라 `data_root()`를 부른다.** 이 값은 「이 실행의 루트가 옮겨졌나」를 묻는
/// 자리의 잣대다 — 앱이 뜰 때 사용자의 에이전트 설정(`~/.claude` · `~/.codex`)을 맞추는 일은, 그 설정이 모든 실행이 함께
/// 부르는 것이라 루트가 그 홈의 이 자리일 때만 한다(프로세스 결정 15 · 앱의 `startup::sync_hooks`). 그 물음이 `.atelier`를
/// 다시 적으면 두 자리가 갈린 날 맞춤이 조용히 영영 안 돈다.
pub fn default_data_root(home: &Path) -> PathBuf {
    home.join(".atelier")
}

/// 프로젝트 등록부.
pub fn projects_dir() -> PathBuf {
    projects_in(&data_root())
}

/// 진행 중인 work의 루트.
pub fn works_dir() -> PathBuf {
    works_in(&data_root())
}

/// 끝난 것이 옮겨가 머무는 곳. **status가 아니라 장소로** 관심 밖에 둔다 —
/// 작업 목록을 읽는 코드는 이 루트를 보지 않으므로, 목록에서 빠지는 것이 규약이 아니라
/// 구조가 된다.
pub fn archive_dir() -> PathBuf {
    archive_in(&data_root())
}

/// spec 레이아웃 폴더의 자리. 앱의 감시자가 이 폴더를 본다(spec 레이아웃 결정 22). 레이아웃은 이 안의
/// `atelier/`에 산다(아래 `layouts_in`).
pub fn layouts_dir() -> PathBuf {
    layouts_in(&data_root())
}

// 아래 넷이 **배치의 정본이다** — 루트 아래 어느 폴더가 무엇인지를 아는 자리가 여기
// 하나다. 위의 넷은 `data_root()`를 먹인 것뿐이고, 루트를 인자로 받는 코어 함수들
// (`search`)은 이쪽을 먹인다. **가르면 두 벌이 생긴다**: 한쪽만 고친 날 앱이 보는 폴더와
// 검색이 보는 폴더가 갈리는데, 화면에는 「왜 안 뜨지」로만 나타난다.

pub(crate) fn projects_in(root: &Path) -> PathBuf {
    root.join("projects")
}

pub(crate) fn works_in(root: &Path) -> PathBuf {
    root.join("works")
}

pub(crate) fn archive_in(root: &Path) -> PathBuf {
    root.join("archive")
}

/// spec 레이아웃 폴더의 자리. 데이터 루트 아래 하나이고, 레이아웃은 그 안의 고정 경로 `atelier/`에 산다
/// (ui-refresh 결정 23, `layout::resolve`의 `layout_folder`).
pub(crate) fn layouts_in(root: &Path) -> PathBuf {
    root.join("layouts")
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

    /// **루트의 자리가 한 글자도 안 바뀐다.** 마이그레이션도, 깨지는 링크도, 다시 적을 참조도 없다는
    /// 약속이 여기서 서고, 깨지면 사용자의 `~/.atelier`가 통째로 안 보이게 된다.
    ///
    /// 루트가 `ATELIER_HOME`에서 자라므로 여기서는 env를 만지지 않고 `data_root()`와의
    /// **관계**를 잰다 — env를 세우는 테스트는 한 프로세스 안에서 병렬로 돌면 서로의 값을
    /// 덮는다.
    #[test]
    fn the_roots_stay_exactly_where_they_were() {
        assert_eq!(works_dir(), data_root().join("works"));
        assert_eq!(archive_dir(), data_root().join("archive"));
        assert_eq!(projects_dir(), data_root().join("projects"));
    }
}
