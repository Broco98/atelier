//! resolve — 이번 호출에 쓸 레이아웃을 정하는 입구.
//!
//! 순서는 `work 지정 → 모드의 폴더(<데이터 루트>/layouts/<id>/) → 코드 내장본`이다(결정 3을 결정
//! 25가 좁혔다). 폴더를 못 쓰면 그 모드의 내장본으로 물러서고 까닭을 함께 준다(결정 15).
//!
//! **부를 때마다 디스크를 새로 읽고 캐시를 두지 않는다**(결정 9). 그래서 MCP 서버는 데이터 루트의
//! 경로만 기동 때 정해 두고 호출마다 이 입구를 부른다 — 세션 도중에 레이아웃을 고쳐도 다음 응답이
//! 따라온다. 읽기는 아무것도 쓰지 않는다(결정 7).

use std::path::{Path, PathBuf};

use super::model::SpecLayout;
use super::render::{Fallback, TemplateVerdict};
use crate::{Mode, Result};

/// 쓸 레이아웃이 어디서 왔는가.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutSource {
    /// 코드 내장본. 모드의 폴더가 없거나, 있어도 못 써서 물러섰다.
    Builtin,
    /// 모드의 레이아웃 폴더 — 내장본을 가린다(결정 7).
    Folder(PathBuf),
}

/// resolve의 결과 — render에 그대로 건넬 것들.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    pub layout: SpecLayout,
    pub source: LayoutSource,
    /// 파일에서 온 레이아웃일 때만 있다.
    pub templates: Option<TemplateVerdict>,
    /// 물러섰다면 그 까닭.
    pub fallback: Option<Fallback>,
}

/// `work_layout`은 work 지정 id다 — 이번에는 아무도 넘기지 않는 이음매다(결정 16).
///
/// **이 판에서는 늘 그 모드의 내장본을 준다.** 레이아웃 폴더를 읽는 것, work 지정의 id 검사,
/// 물러서기는 이 입구 **안쪽**에 붙는다 — 부르는 쪽(MCP 서버·앱)은 그때 한 줄도 안 바뀐다.
/// 그래서 실패할 길이 아직 없는데도 `Result`다: 모드 이름이 아닌 id는 거절될 자리다.
pub fn resolve_layout(
    _data_root: &Path,
    mode: Mode,
    _work_layout: Option<&str>,
) -> Result<Resolved> {
    Ok(Resolved {
        layout: super::builtin::builtin_layout(mode),
        source: LayoutSource::Builtin,
        templates: None,
        fallback: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::builtin::builtin_layout;

    /// 데이터 루트 아래 모든 경로 — 폴더도 센다. 읽기가 빈 폴더 하나라도 만들면 여기서 드러난다.
    fn everything_under(root: &Path) -> Vec<PathBuf> {
        let mut found = Vec::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    stack.push(path.clone());
                }
                found.push(path);
            }
        }
        found.sort();
        found
    }

    /// 레이아웃 폴더가 없으면 **그 모드의** 내장본이다. 템플릿 판정도 물러서기도 없다 — 내장본은
    /// 디스크에 없고, 물러선 것이 아니라 처음부터 거기 있다.
    #[test]
    fn with_no_layout_folder_each_mode_gets_its_own_builtin() {
        let root = tempfile::tempdir().unwrap();
        for mode in [Mode::Atelier, Mode::Maison] {
            let resolved = resolve_layout(root.path(), mode, None).unwrap();
            assert_eq!(resolved.layout, builtin_layout(mode), "{mode}");
            assert_eq!(resolved.source, LayoutSource::Builtin, "{mode}");
            assert_eq!(resolved.templates, None, "{mode}");
            assert_eq!(resolved.fallback, None, "{mode}");
        }
    }

    /// **읽기는 아무것도 쓰지 않는다**(결정 7) — 폴더를 만들어 두면 그 폴더가 내장본을 가리고,
    /// 앱을 켜기만 해도 파일이 생긴다.
    #[test]
    fn resolving_leaves_the_data_root_as_it_was() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("works/cart/spec")).unwrap();
        let before = everything_under(root.path());
        for mode in [Mode::Atelier, Mode::Maison] {
            resolve_layout(root.path(), mode, None).unwrap();
        }
        assert_eq!(everything_under(root.path()), before);
    }
}
