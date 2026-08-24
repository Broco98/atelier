//! 사용자 설정 한 장 — `~/.atelier/settings.json` (결정 53 · `adr-02`).
//!
//! **왜 `localStorage`가 아닌가:** 이 앱의 상태는 이미 전부 `~/.atelier/`에 평문으로 산다
//! (works · projects · archive). MCP와 CLI도 같은 폴더를 본다. 그리고 설정이 nav에 자기 자리를
//! 갖게 되면서(결정 51) **1급 개념**이 됐는데, 1급 개념이 웹뷰 저장소에 숨는 것은 이 앱의
//! 성격과 어긋난다. 사용자가 손으로 열어 고칠 수 있고 백업·이관이 공짜로 따라오는 것도 같은
//! 성격에서 나온다.
//!
//! **감수한 것 — 설정이 두 곳에 갈린다.** `localStorage`에 이미 넷이 산다(섹션 접힘 둘 ·
//! 패널 열림 · 패널 폭)이고 원칙까지 주석에 있다(`SidebarWorkList.tsx:14`, 「설정은 영속,
//! 위치는 세션」). 선은 이렇게 긋는다 — 접힘·폭·패널 열림은 **화면이 어떻게 놓였나**(위치에
//! 가까운 UI 상태), 글꼴·크기·테마는 **취향**(진짜 설정). 기존 넷은 옮기지 않는다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// 터미널 테마 두 벌 (결정 54). **기본은 어둡게다** — 「너무 희다」가 이 판의 출발점이었다.
/// 앱 전체가 아니라 터미널만 다크다(앱은 라이트뿐이다).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalTheme {
    Light,
    #[default]
    Dark,
}

/// 결정 52가 연 것만 담는다 — 글꼴 · 크기 · 테마.
///
/// **스크롤백은 없다.** 결정 52가 명시적으로 뺐다 — 모양이 아니라 메모리 값이고
/// (셸 8개 × 10,000줄) 요청에도 없었다. ANSI 16색 편집도 없다(색 편집기는 별건이다).
///
/// 고르지 않은 값은 파일에도 **`null`로 남는다.** 키를 아예 빼지 않는 이유는 이것이 사람이
/// 손으로 여는 파일이라, 그 줄이 「여기를 고치면 된다」는 표시가 되기 때문이다. 미정 브랜치의
/// 키를 아예 빼는 `work.json`과 다른 선택이고, 그쪽의 이유는 **빈 문자열과 섞이는 것을
/// 피하는 것**이라 여기엔 해당이 없다.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    /// 고르지 않았으면 `null`이다. **여기에 기본 글꼴 이름을 박지 않는다** — 그 이름
    /// (결정 55로 `JetBrainsMonoNL Nerd Font`가 됐다)은 폴백 사슬과 함께
    /// `terminal-defaults.ts`가 들고 있다. 두 곳에 적으면 한쪽이 낡는다 — 「값을 정하는
    /// 유일한 지점」을 터미널 쪽에 남기고, 이 파일에는 **사용자가 고른 것만** 적는다.
    #[serde(default)]
    pub font_family: Option<String>,
    /// 크기도 같은 규칙이다 (지금 기본은 `terminal-defaults.ts`의 `FONT_SIZE`).
    #[serde(default)]
    pub font_size: Option<u16>,
    /// 테마만 여기에 기본이 있다 — 결정 54가 「기본은 어둡게」를 못박았고, 터미널 쪽에는
    /// 아직 그 값을 들 자리가 없다(다크 팔레트가 이 판에서 생긴다).
    #[serde(default)]
    pub theme: TerminalTheme,
    /// 모르는 키는 **버리지 않는다** — `work.json`과 같은 규칙이다. 손으로 여는 파일이라
    /// 우리가 모르는 줄이 들어 있을 수 있고, 크기 하나를 바꿨을 뿐인데 그것이 사라지면
    /// 「손으로 고칠 수 있다」는 말이 거짓이 된다.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// 파일 전체. 지금 구획은 `terminal` 하나다(결정 52) — 다른 구획이 생기면 여기 한 줄이다.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub terminal: TerminalSettings,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// **루트를 여기서 다시 계산하지 않는다** — 그 자리를 아는 곳은 `atelier_core::data_root()`
/// 하나이고, `~/.atelier`를 박으면 `ATELIER_HOME` 오버라이드가 여기서만 죽는다.
/// 부르는 쪽(`commands.rs`)이 루트를 넘긴다 — 테스트가 진짜 홈을 건드리지 않는 이유이기도 하다.
fn settings_path(root: &Path) -> PathBuf {
    root.join("settings.json")
}

/// 파일이 없으면 기본값이다 — **첫 실행이 정상 경로다.** 여기서 파일을 만들지 않는다:
/// 읽기가 쓰기를 겸하면 앱을 켜기만 해도 홈에 파일이 생긴다.
///
/// 파일이 깨졌으면 **실패로 말하고 파일은 그대로 둔다.** 조용히 기본값으로 넘어가면 다음
/// 저장이 사용자가 손으로 고치던 파일을 통째로 덮어쓴다 — 이 앱에 「자동으로 지우는 것은
/// 없다」(결정 14)는 관습이 있고, 손으로 고칠 수 있는 파일이라 더 그렇다. 모르는 값
/// (`"theme": "solarized"`)도 같은 길이다 — `work.json`이 모르는 status를 거부하는 것과
/// 같은 규칙이다. 메시지에 경로를 실어서 **어디를 열어야 하는지** 말한다.
pub fn read(root: &Path) -> Result<Settings, String> {
    let path = settings_path(root);
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Settings::default()),
        Err(e) => {
            return Err(format!(
                "설정을 읽지 못했습니다 ({}): {e}",
                atelier_core::collapse_home(&path)
            ))
        }
    };
    serde_json::from_str(&content).map_err(|e| {
        format!(
            "설정 파일이 잘못됐습니다 ({}): {e}",
            atelier_core::collapse_home(&path)
        )
    })
}

/// 같은 디렉터리 tmp 파일 → rename 원자적 쓰기 (`work.json`·projects와 같은 규칙).
///
/// **원자성이 필요한 이유:** 이 파일 한 장이 설정의 전부다. 반쯤 쓰인 채 앱이 죽으면 다음
/// 읽기가 파싱에 실패하고, 위 규칙대로 사용자가 손으로 고치기 전까지 설정이 돌아오지 않는다.
/// rename은 같은 파일시스템 안에서 원자적이라 **파일이 반쯤인 순간이 없다** — 그래서 tmp도
/// 반드시 **같은 디렉터리**에 둔다(`/tmp`에 두면 경계를 넘어 복사-삭제가 된다).
/// 점 접두사는 감시자가 자기 쓰기의 중간 단계를 되돌려주지 않게 하는 이 저장소의 규약이다
/// (`watcher.rs`의 「dotfile은 무시한다」).
///
/// **전제 하나 — 쓰기는 한 번에 하나다.** tmp 이름이 고정이라(코어의 `.work.json.tmp`와
/// 같은 규칙), 두 쓰기가 겹치면 한쪽의 rename이 다른 쪽이 아직 쓰는 중인 tmp를 옮길 수
/// 있다. 지금 그 경로는 없다 — 설정을 쓰는 곳이 저장 하나뿐이다. 설정 화면이 연타를
/// 허용하게 되면 그 화면이 직렬화를 지거나 여기 이름에 고유값을 붙여야 한다.
pub fn write(root: &Path, settings: &Settings) -> Result<(), String> {
    // 첫 저장이 `~/.atelier`가 아직 없는 상태일 수 있다.
    std::fs::create_dir_all(root).map_err(|e| format!("설정 폴더를 만들지 못했습니다: {e}"))?;

    let mut json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("설정을 옮겨 적지 못했습니다: {e}"))?;
    json.push('\n');

    let tmp = root.join(".settings.json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("설정을 쓰지 못했습니다: {e}"))?;
    std::fs::rename(&tmp, settings_path(root))
        .map_err(|e| format!("설정을 바꿔 넣지 못했습니다: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// src-tauri에는 `tempfile`이 없다(dev-dependency로 드는 것은 atelier-core뿐이다).
    /// 테스트 몇 개 때문에 의존성을 늘리지 않고 손으로 만들고 지운다.
    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("atelier-settings-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_file_gives_defaults_and_is_not_created() {
        let root = temp_root("missing");
        let s = read(&root).unwrap();
        assert_eq!(s.terminal.theme, TerminalTheme::Dark, "기본 테마는 어둡게다 (결정 54)");
        assert_eq!(s.terminal.font_family, None);
        assert_eq!(s.terminal.font_size, None);
        assert!(!settings_path(&root).exists(), "읽기가 파일을 만들면 안 된다");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn roundtrip_returns_the_same_values() {
        let root = temp_root("roundtrip");
        let s = Settings {
            terminal: TerminalSettings {
                font_family: Some("Menlo".to_string()),
                font_size: Some(13),
                theme: TerminalTheme::Light,
                extra: Default::default(),
            },
            extra: Default::default(),
        };
        write(&root, &s).unwrap();
        assert_eq!(read(&root).unwrap(), s);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 손으로 고친 파일이 그대로 온다 — 이 결정의 존재 이유다.
    #[test]
    fn a_hand_edited_file_is_read_as_written() {
        let root = temp_root("hand-edited");
        std::fs::write(
            settings_path(&root),
            r#"{"terminal":{"fontFamily":"SF Mono","fontSize":18,"theme":"light"}}"#,
        )
        .unwrap();
        let s = read(&root).unwrap();
        assert_eq!(s.terminal.font_family.as_deref(), Some("SF Mono"));
        assert_eq!(s.terminal.font_size, Some(18));
        assert_eq!(s.terminal.theme, TerminalTheme::Light);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **사람은 파일을 통째로 적지 않는다.** 크기 하나만 적어 두고 나머지 줄은 안 쓴다 —
    /// 그때 나머지가 기본값으로 채워지는 것이 「손으로 고칠 수 있다」의 실제 모양이다.
    /// 지금 이것을 지키는 것은 필드마다 붙은 `#[serde(default)]`뿐이라 그물을 건다.
    #[test]
    fn a_partial_hand_edit_fills_the_rest_with_defaults() {
        let root = temp_root("partial");
        std::fs::write(settings_path(&root), r#"{"terminal":{"fontSize":13}}"#).unwrap();
        let s = read(&root).unwrap();
        assert_eq!(s.terminal.font_size, Some(13));
        assert_eq!(s.terminal.font_family, None);
        assert_eq!(s.terminal.theme, TerminalTheme::Dark, "안 적힌 테마는 기본이다");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 구획째 빠진 것도 같다 — 빈 파일(`{}`)은 첫 실행과 같은 값이어야 한다.
    #[test]
    fn an_empty_object_is_the_same_as_no_file() {
        let root = temp_root("empty-object");
        std::fs::write(settings_path(&root), "{}").unwrap();
        assert_eq!(read(&root).unwrap(), Settings::default());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 깨진 파일은 **거부하고 그대로 둔다.** 기본값으로 넘어가면 다음 저장이 사용자가
    /// 고치던 파일을 덮어쓴다.
    #[test]
    fn broken_json_fails_and_leaves_the_file_alone() {
        let root = temp_root("broken");
        let src = "{ 글꼴을 여기 적으면 되나";
        std::fs::write(settings_path(&root), src).unwrap();

        let err = read(&root).unwrap_err();
        assert!(err.contains("settings.json"), "어디를 열어야 하는지 말해야 한다: {err}");
        assert_eq!(
            std::fs::read_to_string(settings_path(&root)).unwrap(),
            src,
            "읽기가 파일을 고치면 안 된다"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unknown_theme_is_an_error_not_a_silent_default() {
        let root = temp_root("unknown-theme");
        std::fs::write(settings_path(&root), r#"{"terminal":{"theme":"solarized"}}"#).unwrap();
        assert!(read(&root).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unknown_fields_survive_a_roundtrip() {
        let root = temp_root("extra");
        std::fs::write(
            settings_path(&root),
            r#"{"editor":{"tabWidth":2},"terminal":{"theme":"dark","bell":"off"}}"#,
        )
        .unwrap();

        let s = read(&root).unwrap();
        write(&root, &s).unwrap();

        let out = std::fs::read_to_string(settings_path(&root)).unwrap();
        assert!(out.contains("\"tabWidth\""), "모르는 구획이 사라졌다: {out}");
        assert!(out.contains("\"bell\""), "모르는 키가 사라졌다: {out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 원자적 쓰기의 중간 단계가 남으면 감시자와 사용자 둘 다에게 보인다
    /// (`store.rs`의 같은 검사).
    #[test]
    fn write_leaves_no_tmp_files() {
        let root = temp_root("no-tmp");
        write(&root, &Settings::default()).unwrap();

        let leftovers: Vec<String> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
