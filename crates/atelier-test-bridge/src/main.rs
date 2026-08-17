//! L4 관통 테스트가 브라우저 밖으로 나가는 **다리**.
//!
//! 브라우저에서 `invoke("create_project", …)`가 불리면 Playwright가 그 호출을 Node로
//! 꺼내 이 바이너리를 부른다. 여기서 진짜 `atelier-core`·파일시스템·git을 탄다.
//! 데이터 루트는 `ATELIER_HOME`으로 임시 폴더에 묶여 있어 실제 `~/.atelier`는 안 건드린다.

use std::ffi::OsString;
use std::path::PathBuf;

use atelier_core::{archive_dir, projects_dir, works_dir, ProjectPatch};
use serde_json::{Map, Value};

/// 커맨드 하나가 받는 인자. Tauri와 같게 **snake_case로 정규화된 뒤** 들어온다.
type Args = Map<String, Value>;
type Handled = Result<Value, String>;
type Handler = fn(&Args) -> Handled;

/// 이 다리가 아는 커맨드. **이 표가 유일한 목록이다** — 이름 목록과 분기를 따로 두면
/// 둘이 어긋날 수 있고, 그 어긋남은 아무 신호도 내지 않는다.
///
/// 각 항목은 `src-tauri/src/commands.rs`의 같은 이름 함수와 짝이다. 그 함수들은
/// `#[tauri::command]`라 여기서 부를 수 없어(AppHandle·런타임이 필요하다) 코어를 직접
/// 부른다 — 그래서 **래퍼 자체는 이 층에서도 안 탄다**(D8이 인정한 사각지대).
const HANDLERS: &[(&str, Handler)] = &[
    ("list_projects", |_| ok(atelier_core::list_projects(&projects_dir()))),
    ("get_project", |a| ok(atelier_core::get_project(&projects_dir(), &text(a, "slug")?))),
    ("create_project", |a| {
        ok(atelier_core::create_project(&projects_dir(), &PathBuf::from(text(a, "folder")?)))
    }),
    ("update_project", |a| {
        ok(atelier_core::update_project(
            &projects_dir(),
            &text(a, "slug")?,
            ProjectPatch {
                name: maybe_text(a, "name"),
                description: maybe_text(a, "description"),
                base_branch: maybe_text(a, "base_branch"),
            },
        ))
    }),
    ("delete_project", |a| ok(atelier_core::delete_project(&projects_dir(), &text(a, "slug")?))),
    // 네이티브 파일 탐색기를 여는 일이라 대응하는 코어 함수가 없다. 표에는 남는다 —
    // 빠지면 드리프트 검사가 "덮지 않은 커맨드"로 읽고, 그러면 진짜 누락과 구별되지 않는다.
    ("open_project_folder", |_| {
        Err("이 커맨드는 다리로 탈 수 없습니다: 탐색기를 여는 일이라 코어 함수가 없습니다".into())
    }),
    ("list_works", |_| ok(atelier_core::list_works(&works_dir()))),
    ("get_work", |a| ok(atelier_core::get_work(&works_dir(), &text(a, "slug")?))),
    ("set_work_title", |a| {
        ok(atelier_core::update_work_title(&works_dir(), &text(a, "slug")?, &text(a, "title")?))
    }),
    ("set_work_status", |a| {
        let status = text(a, "status")?.parse().map_err(err)?;
        ok(atelier_core::update_work_status(&works_dir(), &text(a, "slug")?, status))
    }),
    ("archive_work", |a| {
        ok(atelier_core::archive_work(
            &works_dir(),
            &archive_dir(),
            &projects_dir(),
            &text(a, "slug")?,
        )
        .map(|_| ()))
    }),
    // commands.rs와 같이 force를 노출하지 않는다 — 커밋 안 된 변경이 있으면 거부한다.
    ("remove_work", |a| ok(atelier_core::remove_work(&works_dir(), &text(a, "slug")?, false))),
    ("read_spec_file", |a| {
        ok(atelier_core::read_spec_file(&works_dir(), &text(a, "slug")?, &text(a, "path")?))
    }),
    ("list_archive", |_| ok(atelier_core::list_archive(&archive_dir()))),
    ("list_archived_docs", |a| {
        ok(atelier_core::list_archived_docs(&archive_dir(), &text(a, "slug")?))
    }),
    ("read_archived_file", |a| {
        ok(atelier_core::read_work_file(&archive_dir(), &text(a, "slug")?, &text(a, "path")?))
    }),
];

/// 코어의 결과를 그대로 JSON으로 옮긴다. **여기서 모양을 손보지 않는다** — 손보는 순간
/// 이 층이 검증하는 것이 앱이 아니라 다리가 된다.
fn ok<T: serde::Serialize>(result: atelier_core::Result<T>) -> Handled {
    let value = result.map_err(err)?;
    serde_json::to_value(value).map_err(err)
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn text(args: &Args, key: &str) -> Result<String, String> {
    maybe_text(args, key).ok_or_else(|| format!("인자 '{key}'(문자열)가 필요합니다"))
}

fn maybe_text(args: &Args, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(str::to_string)
}

fn main() {
    if let Err(reason) = require_isolated_home(std::env::var_os("ATELIER_HOME")) {
        die(2, &reason);
    }

    let mut argv = std::env::args().skip(1);
    let Some(cmd) = argv.next() else {
        die(2, "사용법: atelier-test-bridge <커맨드> [JSON 인자]");
    };
    let raw = argv.next().unwrap_or_else(|| "{}".to_string());

    let Some((_, handler)) = HANDLERS.iter().find(|(name, _)| *name == cmd) else {
        die(2, &format!("이 다리가 모르는 커맨드입니다: {cmd}"));
    };

    let args = match parse_args(&raw) {
        Ok(args) => args,
        Err(message) => die(2, &message),
    };

    match handler(&args) {
        Ok(value) => println!("{value}"),
        Err(message) => die(1, &message),
    }
}

/// 이 다리는 **격리된 데이터 루트에서만** 돈다. 부르는 쪽이 `ATELIER_HOME`을 빠뜨리면
/// 코어가 조용히 진짜 `~/.atelier`를 쓴다 — 테스트는 "파일이 안 생겼다"로 실패하지만
/// 그때는 이미 개발자의 실제 데이터에 프로젝트가 하나 추가된 뒤다.
fn require_isolated_home(home: Option<OsString>) -> Result<(), String> {
    match home {
        Some(value) if !value.is_empty() => Ok(()),
        _ => Err("ATELIER_HOME이 없습니다. 이 다리는 임시 데이터 루트에서만 돕니다.".to_string()),
    }
}

fn die(code: i32, message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(code)
}

/// 프런트엔드는 camelCase로 보내고 Tauri가 snake_case 파라미터에 맞춰 준다.
/// 다리도 같은 자리에서 같은 변환을 한다 — 브라우저 쪽이 다리의 존재를 몰라야 한다.
fn parse_args(raw: &str) -> Result<Args, String> {
    let value: Value = serde_json::from_str(raw).map_err(|e| format!("인자가 JSON이 아닙니다: {e}"))?;
    let Value::Object(object) = value else {
        return Err(format!("인자는 JSON 객체여야 합니다: {raw}"));
    };
    Ok(object.into_iter().map(|(key, value)| (to_snake_case(&key), value)).collect())
}

fn to_snake_case(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 2);
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{require_isolated_home, HANDLERS};

    #[test]
    fn 격리되지_않은_데이터_루트에서는_돌지_않는다() {
        assert!(require_isolated_home(None).is_err());
        assert!(require_isolated_home(Some("".into())).is_err());
        assert!(require_isolated_home(Some("/tmp/atelier-home".into())).is_ok());
    }

    /// Tauri가 등록한 커맨드 이름. `include_str!`이라 파일이 사라지면 **컴파일이** 깨진다.
    fn registered() -> Vec<String> {
        let source = include_str!("../../../src-tauri/src/lib.rs");
        let open = "generate_handler![";
        let start = source.find(open).expect("generate_handler! 블록을 찾지 못했다") + open.len();
        let end = start + source[start..].find(']').expect("generate_handler! 블록이 닫히지 않았다");
        let mut names: Vec<String> = source[start..end]
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(|item| {
                // 모르는 모양을 **건너뛰지 않는다.** 건너뛰면 그 커맨드가 이 검사의 눈에서
                // 통째로 사라지고, 다리에도 없으면 양쪽에서 같이 빠져 초록이 된다.
                // `use commands::*;`로 접두사 없이 등록하면 실제로 그렇게 샜다.
                item.strip_prefix("commands::")
                    .unwrap_or_else(|| panic!("등록부에서 예상 못 한 항목을 봤다: {item}"))
                    .to_string()
            })
            .collect();
        names.sort();
        names
    }

    /// 다리가 배포되는 크레이트의 의존성이 되면 그 코드가 릴리스 바이너리 안으로 들어간다.
    /// 릴리스 워크플로가 패키징 대상을 이름으로 고르므로 tar 줄이 늘 일은 없지만, **의존성
    /// 한 줄은 아무도 안 보는 사이에 늘 수 있다.** 매니페스트는 `include_str!`로 읽으므로
    /// 파일이 옮겨지면 컴파일이 깨진다.
    #[test]
    fn 배포되는_크레이트는_다리에_의존하지_않는다() {
        for (name, manifest) in [
            ("atelier-app", include_str!("../../../src-tauri/Cargo.toml")),
            ("atelier-cli", include_str!("../../atelier-cli/Cargo.toml")),
        ] {
            assert!(
                !manifest.contains("atelier-test-bridge"),
                "{name}이 다리에 의존한다 — 릴리스 산출물에 다리 코드가 섞인다"
            );
        }
    }

    /// 커맨드가 하나 늘었는데 다리가 그대로면, 그 커맨드를 쓰는 화면은 L4에서 조용히
    /// 실패한다 — "이 다리가 모르는 커맨드"라는 말은 테스트를 돌려 봐야만 나온다.
    /// 그래서 목록이 어긋나는 순간 여기서 먼저 빨간불이 켜진다.
    #[test]
    fn 다리가_등록된_커맨드를_빠짐없이_덮는다() {
        let registered = registered();
        assert!(!registered.is_empty(), "등록된 커맨드를 하나도 읽지 못했다 — 파싱이 샜다");

        let mut handled: Vec<String> = HANDLERS.iter().map(|(name, _)| name.to_string()).collect();
        handled.sort();

        assert_eq!(handled, registered, "다리의 표와 Tauri 등록부가 어긋났다");
    }
}
