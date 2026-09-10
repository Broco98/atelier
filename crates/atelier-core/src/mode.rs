use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// 어느 세계의 것인가. **화면이 아니라 루트를 가르는 축**이다 — 같은 컴포넌트가 다른
/// 디렉터리를 읽는다 (결정 1). work.json에 표시를 다는 것으로는 안 됐다: 필드로 가르면
/// 목록을 읽는 모든 자리가 필터를 기억해야 하고, 하나가 잊으면 그 자리에서 두 세계가 섞인다.
///
/// **레지스트리가 아니라 둘뿐이다** (결정 5). 「나중에 모드를 더할 수 있게」 열어 두면
/// 루트를 고르는 자리마다 「모르는 모드면 어디를 읽나」라는 갈래가 생기고, 그 갈래는
/// 아무도 안 쓴 채 낡는다. 셋째가 실제로 필요해지는 날 그때 연다.
///
/// **문자열 표기는 하나뿐이다** — serde와 `FromStr`이 같은 소문자 표기를 쓴다. 둘이 갈리면
/// `ATELIER_MODE`로 받는 값과 파일·응답에 적히는 값이 달라져, 어느 쪽이 정본인지 아무도
/// 모르게 된다.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// 일하는 자리. `works/`·`archive/`·`projects/` — **한 글자도 안 바뀐다** (결정 7).
    Atelier,
    /// 생활하는 자리. `maison/rooms/`·`maison/archive/`. 프로젝트도 브랜치도 없다 (결정 17).
    Maison,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Atelier => "atelier",
            Mode::Maison => "maison",
        }
    }
}

impl std::fmt::Display for Mode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for Mode {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "atelier" => Ok(Mode::Atelier),
            "maison" => Ok(Mode::Maison),
            _ => Err(Error::Validation(format!("invalid mode '{s}' ({ALLOWED})"))),
        }
    }
}

/// 거절 문장에 함께 실리는 허용값. **받은 값과 이 목록 둘 다** 나가야 한다 — MCP 서버는
/// 이 문장 하나만 표준에러에 쓰고 뜨지 않으므로(스펙 US 46), 여기서 빠지면 사용자에게 남는
/// 단서가 없다.
const ALLOWED: &str = "atelier | maison";

/// 앱이 셸에 심고 MCP 서버가 읽는 환경 변수 이름. **심는 자리와 읽는 자리가 이 상수
/// 하나로만 이어진다** — 양쪽에 문자열을 박으면 한쪽 오타가 조용히 Atelier로 눕는다.
pub const MODE_ENV: &str = "ATELIER_MODE";

/// 환경에서 모드를 읽는다. 네 갈래 — 없음 → Atelier · `atelier` → Atelier ·
/// `maison` → Maison · 그 밖 → 오류.
///
/// **없음이 Atelier인 것은 앱 밖 셸을 위한 규칙이다** — 앱은 두 모드 다 명시해서 심으므로
/// `atelier`도 정상값이어야 한다 (결정 15).
///
/// **부르는 곳은 MCP 진입점 하나뿐이다.** 앱은 env를 안 읽는다 — 앱은 두 세계를 한
/// 프로세스에서 함께 그리므로 프로세스에 값 하나인 env로는 애초에 못 가르고, 모드를
/// 인자로 받는다 (결정 20).
///
/// 그 성질은 `crates/atelier-test-bridge/src/main.rs`의 소스 검사 둘이 붙든다 —
/// `앱은_모드를_환경에서_읽지_않는다`(앱 소스에 이 이름들이 아예 없다)와
/// `cli에서_모드를_env로_읽는_자리는_진입점_하나뿐이다`(호출이 한 자리, 한 번이다).
/// **검사가 앱도 CLI도 아닌 다리에 사는 것은 제 자신을 안 읽기 위해서다** — 검사가 찾는
/// 낱말이 검사 자신의 문자열로도 파일에 있으면 스스로를 읽고 빨개진다. 자리를 옮기려는
/// 다음 사람이 여기서 되돌아오도록 이유까지 적어 둔다.
pub fn mode_from_env() -> Result<Mode> {
    from_var(std::env::var_os(MODE_ENV).as_deref())
}

/// 위 함수의 **판정만** 떼어 놓은 것. 진짜 env를 만지는 테스트는 한 프로세스 안에서
/// 병렬로 돌면 서로의 값을 덮어쓰므로 네 갈래를 여기서 잰다 — 실제 env를 타는 길은
/// MCP stdio 통합 테스트가 프로세스를 갈라 잰다.
fn from_var(raw: Option<&std::ffi::OsStr>) -> Result<Mode> {
    let Some(raw) = raw else { return Ok(Mode::Atelier) };
    // **빈 값은 「없음」이 아니라 「모르는 값」이다.** 「비었으면 안 준 것」으로 받으면
    // `ATELIER_MODE=$SOMETHING_UNSET`처럼 값이 증발한 셸이 조용히 Atelier로 눕는데,
    // 이 갈래가 막으려던 것이 정확히 그 조용한 눕기다 (스펙 US 46).
    //
    // UTF-8이 아닌 값도 같은 길로 간다. 대체 문자를 섞어서라도 받은 것을 적는다 —
    // 무엇이 왔는지 안 보이면 고칠 자리를 못 찾는다.
    let raw = raw.to_string_lossy();
    raw.parse()
        .map_err(|_| Error::Validation(format!("invalid {MODE_ENV} '{raw}' ({ALLOWED})")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    /// serde와 `FromStr`이 **같은 표기**를 쓴다. 갈리면 env로 받은 값과 파일에 적히는 값이
    /// 달라진다.
    #[test]
    fn one_lowercase_spelling_serves_serde_and_from_str() {
        for (text, mode) in [("atelier", Mode::Atelier), ("maison", Mode::Maison)] {
            assert_eq!(text.parse::<Mode>().unwrap(), mode);
            assert_eq!(mode.as_str(), text);
            assert_eq!(mode.to_string(), text);
            assert_eq!(serde_json::to_value(mode).unwrap(), serde_json::json!(text));
            assert_eq!(serde_json::from_value::<Mode>(serde_json::json!(text)).unwrap(), mode);
        }
    }

    /// 거절 메시지는 유효값 목록이자 유일한 안내다 — 모드가 늘면 여기도 늘어야 한다.
    #[test]
    fn unknown_text_is_a_validation_error_that_lists_the_allowed_values() {
        let msg = "Maison".parse::<Mode>().unwrap_err().to_string();
        assert!(msg.contains("Maison"), "받은 값이 없다: {msg}");
        for valid in ["atelier", "maison"] {
            assert!(msg.contains(valid), "'{valid}'가 빠졌다: {msg}");
        }
    }

    /// env 파서의 **네 갈래 전부**. 없음만 Atelier로 눕고, 나머지 모르는 값은 전부 오류다.
    #[test]
    fn the_env_parser_has_exactly_four_branches() {
        assert_eq!(from_var(None).unwrap(), Mode::Atelier);
        assert_eq!(from_var(Some(OsStr::new("atelier"))).unwrap(), Mode::Atelier);
        assert_eq!(from_var(Some(OsStr::new("maison"))).unwrap(), Mode::Maison);
        assert!(from_var(Some(OsStr::new("mansion"))).is_err());
    }

    /// **빈 값은 없음이 아니다.** `ATELIER_MODE=$UNSET`으로 값이 증발한 셸이 조용히
    /// Atelier가 되면, 생활 쪽 에이전트가 일 목록을 그대로 본다.
    #[test]
    fn an_empty_value_is_refused_rather_than_read_as_absent() {
        let err = from_var(Some(OsStr::new(""))).unwrap_err().to_string();
        assert!(err.contains(MODE_ENV), "어느 변수가 문제인지 안 적혀 있다: {err}");
        assert!(err.contains("atelier | maison"), "허용값이 없다: {err}");
    }

    /// 대소문자도 공백도 봐주지 않는다. 봐주면 「무엇이 유효한가」가 두 벌이 되고,
    /// 앱이 심는 값과 사람이 적는 값이 다른 규칙을 타게 된다.
    #[test]
    fn the_env_parser_does_not_forgive_case_or_padding() {
        for raw in ["MAISON", "Maison", " maison", "maison "] {
            assert!(from_var(Some(OsStr::new(raw))).is_err(), "'{raw}'가 통과했다");
        }
    }

    /// 받은 값을 못 적으면(UTF-8이 아닌 바이트) 고칠 자리를 못 찾는다 — 죽지 말고
    /// 대체 문자를 섞어서라도 적는다.
    #[test]
    fn a_non_utf8_value_is_refused_without_panicking() {
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            let raw = OsStr::from_bytes(&[0xff, 0xfe]);
            let err = from_var(Some(raw)).unwrap_err().to_string();
            assert!(err.contains(MODE_ENV), "{err}");
        }
    }
}
