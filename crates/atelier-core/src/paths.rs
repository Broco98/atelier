use std::path::{Path, PathBuf};

use crate::Mode;

/// 데이터 루트. `ATELIER_HOME`은 테스트용 내부 오버라이드.
///
/// **이 값을 부르는 쪽이 다시 계산하면 안 된다.** `~/.atelier`를 박아 두면 오버라이드가
/// 그 자리에서만 죽어서, 테스트가 진짜 홈을 건드리는 것이 조용히 시작된다.
/// **모드가 생겨도 이 규칙은 그대로다** — 아래 모드별 루트도 전부 여기서 자란다.
pub fn data_root() -> PathBuf {
    std::env::var_os("ATELIER_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().expect("no home directory").join(".atelier"))
}

/// 프로젝트 등록부. **모드를 안 받는다 — Atelier 전용이다** (결정 17). Room은 토픽이고
/// 저장소에 붙지 않으므로 Maison에는 이 루트에 대응하는 자리가 아예 없다. 인자를 받게
/// 만들면 「Maison의 프로젝트 폴더」라는 없는 것이 이름부터 생긴다.
pub fn projects_dir() -> PathBuf {
    projects_in(&data_root())
}

/// **모드를 함께 받는 커널 함수에 건네는** 프로젝트 등록부. Maison에서는 「없음」이다
/// (결정 17).
///
/// **위 `projects_dir`와 다른 물음이다.** 그쪽은 「등록부가 어디 있나」이고 이쪽은 「이 세계에
/// 등록부가 있나」다 — 그래서 이 함수는 모드를 받고도 「Maison의 프로젝트 폴더」라는 없는
/// 자리를 만들지 않는다. 없음인 것은 규약이 아니라 **인자**다: 건네면 Maison에서도 커널이
/// 프로젝트 층을 걷는다(⇧⇧ 결과에 Atelier 프로젝트가 서고 — US 49 — 아카이브 기록이 Room에
/// 없는 구획을 렌더한다).
///
/// **표면 셋이 이 한 자리를 읽는다**: 앱 명령(`commands.rs`) · MCP 서버(`mcp/mod.rs`) ·
/// 다리(`atelier-test-bridge`). 한때 셋이 같은 `match`를 각자 들고 있었다 — 몸통도 이유도
/// 같은 사본 셋이라, 하나가 뒤집혀도 나머지 둘의 검사는 그대로 초록이고 그 표면에서만
/// `maison/rooms/<slug>/trees/<project>`에 워크트리가 선다.
pub fn shared_projects_root(mode: Mode) -> Option<PathBuf> {
    match mode {
        Mode::Atelier => Some(projects_dir()),
        Mode::Maison => None,
    }
}

/// 모드의 홈. 최상위 터미널이 cwd 없이 뜰 때 서는 자리이기도 하다.
///
/// **Atelier의 홈이 데이터 루트 자신인 것은 의도다** — 기존 경로가 한 글자도 안 바뀌어야
/// 하므로(결정 7) Atelier에는 자기 이름의 하위 폴더가 없다. Maison만 `maison/` 아래로
/// 내려간다. 그래서 두 세계는 「같은 규칙을 다른 홈에」가 아니라 「Maison이 한 칸 더
/// 깊다」로 갈린다.
pub fn mode_home(mode: Mode) -> PathBuf {
    match mode {
        Mode::Atelier => data_root(),
        Mode::Maison => data_root().join("maison"),
    }
}

/// 진행 중인 항목의 루트. Atelier에는 work가, Maison에는 Room이 산다.
///
/// **Maison 쪽 폴더 이름이 `works`가 아니라 `rooms`인 것은 화면의 말과 맞추기 위해서다** —
/// 파일은 work.json 그대로이지만(결정 2) 그 폴더를 여는 사람에게 그것은 Room이다.
pub fn works_dir(mode: Mode) -> PathBuf {
    works_in(&mode_home(mode), mode)
}

/// 끝난 것이 옮겨가 머무는 곳. **status가 아니라 장소로** 관심 밖에 둔다 —
/// 작업 목록을 읽는 코드는 이 루트를 보지 않으므로, 목록에서 빠지는 것이 규약이 아니라
/// 구조가 된다. **두 세계가 갈리는 것도 같은 방식이다**: Maison의 아카이브는 Atelier
/// 아카이브의 하위가 아니라 다른 홈 아래라, Atelier 목록이 읽을 길이 없다.
pub fn archive_dir(mode: Mode) -> PathBuf {
    archive_in(&mode_home(mode))
}

/// spec 레이아웃 폴더들의 자리. 앱의 감시자가 이 폴더를 본다(spec 레이아웃 결정 22). 모드를 안 받는
/// 까닭은 아래 `layouts_in`과 같다 — 두 모드의 레이아웃이 이 안에 `<id>/`로 나란히 산다.
pub fn layouts_dir() -> PathBuf {
    layouts_in(&data_root())
}

// 아래 셋이 **배치의 정본이다** — 어느 홈 아래 어느 폴더가 무엇인지를 아는 자리가 여기
// 하나다. 위의 모드별 셋은 `mode_home(mode)`를 먹인 것뿐이고, 루트를 인자로 받는 코어 함수들
// (`search`)은 이쪽을 먹인다. **가르면 두 벌이 생긴다**: 한쪽만 고친 날 앱이 보는 폴더와
// 검색이 보는 폴더가 갈리는데, 화면에는 「왜 안 뜨지」로만 나타난다.

pub(crate) fn projects_in(root: &Path) -> PathBuf {
    root.join("projects")
}

/// **이 하나만 모드를 함께 받는다.** 진행 중인 항목의 폴더 이름은 세계마다 다르다
/// (`works`/`rooms` — 결정 18의 「사람이 보는 층에만 새 말」). 루트만으로 파생하면
/// Maison에서 `maison/works`를 걷게 되고, 그 자리는 늘 비어 있어 **검색이 조용히 빈 답을
/// 준다** — 오류가 아니라 「왜 안 뜨지」로만 보이는 종류다.
pub(crate) fn works_in(root: &Path, mode: Mode) -> PathBuf {
    root.join(match mode {
        Mode::Atelier => "works",
        Mode::Maison => "rooms",
    })
}

pub(crate) fn archive_in(root: &Path) -> PathBuf {
    root.join("archive")
}

/// spec 레이아웃 폴더들의 자리. **모드를 안 받는다** — 모드별 홈이 아니라 데이터 루트 아래 하나이고,
/// 두 모드의 레이아웃이 그 안에 `<id>/`로 나란히 산다(구현 스펙 1절 「resolve」). 어느 모드의
/// 서버든 두 모드의 레이아웃을 읽고 고칠 수 있어야 하기 때문이다.
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

    /// **세계가 등록부를 갖는가.** 두 갈래를 함께 잰다 — 「없음」만 재면 둘 다 `None`으로
    /// 만들어도 초록이고, 그러면 프로젝트를 실은 work이 Atelier에서도 통째로 안 선다.
    #[test]
    fn only_atelier_hands_the_kernel_a_project_registry() {
        assert_eq!(shared_projects_root(Mode::Atelier), Some(projects_dir()));
        assert_eq!(
            shared_projects_root(Mode::Maison),
            None,
            "Maison이 커널에 등록부를 건넨다 — Room 안에 워크트리가 선다"
        );
    }

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

    /// **Atelier 쪽 값이 한 글자도 안 바뀐다** (결정 7). 마이그레이션도, 깨지는 링크도,
    /// 다시 적을 참조도 없다는 약속이 여기서 서고, 깨지면 사용자의 `~/.atelier`가 통째로
    /// 안 보이게 된다.
    ///
    /// 루트가 `ATELIER_HOME`에서 자라므로 여기서는 env를 만지지 않고 `data_root()`와의
    /// **관계**를 잰다 — env를 세우는 테스트는 한 프로세스 안에서 병렬로 돌면 서로의 값을
    /// 덮는다.
    #[test]
    fn atelier_roots_stay_exactly_where_they_were() {
        assert_eq!(works_dir(Mode::Atelier), data_root().join("works"));
        assert_eq!(archive_dir(Mode::Atelier), data_root().join("archive"));
        assert_eq!(mode_home(Mode::Atelier), data_root());
        assert_eq!(projects_dir(), data_root().join("projects"));
    }

    /// Maison은 자기 홈 아래 한 칸씩이다. **`works/` 아래가 아니라 형제 홈이라는 것**이
    /// 이 판의 전부다 — Atelier의 어떤 목록도 이 루트를 읽을 수 없다.
    #[test]
    fn maison_roots_live_under_their_own_home() {
        let home = data_root().join("maison");
        assert_eq!(mode_home(Mode::Maison), home);
        assert_eq!(works_dir(Mode::Maison), home.join("rooms"));
        assert_eq!(archive_dir(Mode::Maison), home.join("archive"));
    }

    /// 두 세계의 루트는 **어느 것도 서로의 하위가 아니다.** 하나라도 겹치면 재귀로 걷는
    /// 자리(watcher·검색·문서 트리)가 저쪽 세계를 함께 읽는다.
    #[test]
    fn no_root_of_one_mode_sits_inside_the_other() {
        let atelier = [works_dir(Mode::Atelier), archive_dir(Mode::Atelier), projects_dir()];
        let maison = [works_dir(Mode::Maison), archive_dir(Mode::Maison)];
        for a in &atelier {
            for m in &maison {
                assert!(!m.starts_with(a), "{} 가 {} 안에 있다", m.display(), a.display());
                assert!(!a.starts_with(m), "{} 가 {} 안에 있다", a.display(), m.display());
            }
        }
    }
}
