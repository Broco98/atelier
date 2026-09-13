//! 여러 쓰기가 겹칠 수 있는 파일의 원자적 쓰기 — `recent.json`과 진행 중 루트의 `.order.json`이
//! 함께 딛는다.
//!
//! **둘이 한 자리를 쓰는 것은 「tmp 이름이 쓰기마다 다르다」가 둘 다에 필요해서다.** 한쪽만
//! 고정 이름으로 돌아가면 겹친 rename이 반쯤 쓰인 파일을 남기는데, 그 차이는 검사로도 실물로도
//! 좀처럼 안 드러난다.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::Result;

/// 같은 디렉터리 tmp 파일 → rename 원자적 쓰기 (`work.json`·projects·설정과 같은 규칙).
/// rename은 같은 파일시스템 안에서 원자적이라 파일이 반쯤인 순간이 없고, 그래서 tmp도
/// 반드시 **같은 디렉터리**에 둔다. 점 접두사는 감시자가 자기 쓰기의 중간 단계를
/// 되돌려주지 않게 하는 규약이다(`watcher.rs`의 「dotfile은 무시한다」).
///
/// **tmp 이름에 고유값을 붙인다 — 이웃들과 갈리는 자리다.** 설정 파일은 고정 이름을 쓰되
/// 「쓰기는 한 번에 하나다」를 **명시로 깔아 두고** 그렇게 했는데(설정을 쓰는 곳이 저장
/// 하나뿐이다), 이 파일들에는 그 전제가 안 선다: 이력은 **work을 옮길 때마다** 쓰이고,
/// 커맨드가 async이며, 앱이 StrictMode 아래라 dev에서 effect가 마운트마다 두 번 돈다. 순서
/// 파일은 앱·MCP·CLI 세 프로세스가 같은 루트에 쓴다. 고정 이름이면 겹친 rename이 다른 쪽이
/// 아직 쓰는 중인 tmp를 옮겨 **반쯤 쓰인 파일**을 남긴다.
///
/// **잠그지 않는다** — 겹친 두 쓰기는 나중 것이 이긴다. 그 판단은 부르는 쪽 모듈에 적혀 있다.
///
/// 첫 쓰기가 폴더가 아직 없는 상태일 수 있다. **쓰기는 만들어도 된다** — 만들지 않기로 한 것은
/// 읽기 쪽이다.
pub(crate) fn write_atomically(dir: &Path, file_name: &str, contents: &str) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(tmp_name(file_name));
    std::fs::write(&tmp, contents)?;
    if let Err(e) = std::fs::rename(&tmp, dir.join(file_name)) {
        // 바꿔 넣지 못했으면 **찌꺼기를 남기지 않는다.** 남으면 다음 사람이 그 파일을
        // 진짜로 착각할 여지가 생기고, 감시자가 무시하는 dotfile이라 화면에도 안 뜬다.
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// 이 쓰기만의 tmp 이름. 프로세스와 호출을 함께 세므로 **한 기계 안에서 안 겹친다** —
/// 시계를 안 쓰는 것은 같은 밀리초에 두 번 쓰는 것이 정확히 이 파일들의 흔한 경우라서다
/// (StrictMode가 effect를 두 번 돌린다).
///
/// **이미 점으로 시작하는 이름에 점을 하나 더 붙이지 않는다** — `.order.json`의 tmp는
/// `.order.json.<pid>.<n>.tmp`다. 어느 쪽이든 점 접두사라 감시자는 같게 보지만, 사람이 폴더를
/// 볼 때 이름이 최종 파일과 같은 머리로 읽혀야 무엇의 찌꺼기인지 안다.
fn tmp_name(file_name: &str) -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    format!(".{}.{}.{n}.tmp", file_name.trim_start_matches('.'), std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **tmp 이름에 고유값이 붙는다.** 고정 이름이면 겹친 rename이 반쯤 쓰인 파일을 남긴다.
    #[test]
    fn tmp_이름이_쓰기마다_다르다() {
        assert_ne!(tmp_name("recent.json"), tmp_name("recent.json"));
    }

    /// tmp는 **점으로 시작한다** — 감시자가 자기 쓰기의 중간 단계를 소식으로 안 읽는 규약이다.
    /// 최종 이름이 이미 점 파일이어도 같은 모양이다.
    #[test]
    fn tmp_이름은_점_파일이다() {
        for name in ["recent.json", ".order.json"] {
            let tmp = tmp_name(name);
            assert!(tmp.starts_with('.') && !tmp.starts_with(".."), "{tmp}");
            assert!(tmp.ends_with(".tmp"), "{tmp}");
        }
    }

    /// 쓰고 나면 **찌꺼기가 없다.** 고유 이름을 붙였으므로 지우는 자리가 확실해야 한다 —
    /// 남으면 dotfile이라 화면에도 안 뜬 채 쌓인다.
    #[test]
    fn 쓰고_나면_tmp가_안_남는다() {
        let tmp = tempfile::tempdir().unwrap();
        write_atomically(tmp.path(), ".order.json", "{}").unwrap();
        write_atomically(tmp.path(), ".order.json", "{}").unwrap();

        let names: Vec<String> = std::fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![".order.json"]);
    }
}
