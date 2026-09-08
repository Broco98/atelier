//! L4 관통 테스트가 브라우저 밖으로 나가는 **다리**.
//!
//! 브라우저에서 `invoke("create_project", …)`가 불리면 Playwright가 그 호출을 Node로
//! 꺼내 이 바이너리를 부른다. 여기서 진짜 `atelier-core`·파일시스템·git을 탄다.
//! 데이터 루트는 `ATELIER_HOME`으로 임시 폴더에 묶여 있어 실제 `~/.atelier`는 안 건드린다.

use std::ffi::OsString;
use std::path::PathBuf;

use atelier_core::{archive_dir, projects_dir, works_dir, Mode, ProjectPatch};
use serde_json::{Map, Value};

/// 다리가 아직 아는 모드는 하나뿐이다. **명령이 `mode` 인자를 받는 것은 다음 티켓(#181)**
/// 이고, 그때 이 상수가 인자로 바뀐다 (`commands.rs`의 같은 상수와 짝이다).
const MODE: Mode = Mode::Atelier;

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
    ("open_project_folder", |_| in_app_only("탐색기를 여는 일이라 대응하는 코어 함수가 없습니다")),
    ("list_works", |_| ok(atelier_core::list_works(&works_dir(MODE)))),
    ("get_work", |a| ok(atelier_core::get_work(&works_dir(MODE), &text(a, "slug")?))),
    ("set_work_title", |a| {
        ok(atelier_core::update_work_title(&works_dir(MODE), &text(a, "slug")?, &text(a, "title")?))
    }),
    ("set_work_status", |a| {
        let status = text(a, "status")?.parse().map_err(err)?;
        ok(atelier_core::update_work_status(&works_dir(MODE), &text(a, "slug")?, status))
    }),
    ("set_work_pinned", |a| {
        let pinned = flag(a, "pinned")?;
        ok(atelier_core::update_work_pinned(&works_dir(MODE), &text(a, "slug")?, pinned))
    }),
    ("archive_work", |a| {
        ok(atelier_core::archive_work(
            &works_dir(MODE),
            &archive_dir(MODE),
            Some(&projects_dir()),
            &text(a, "slug")?,
        )
        .map(|_| ()))
    }),
    // commands.rs와 같이 force를 노출하지 않는다 — 커밋 안 된 변경이 있으면 거부한다.
    ("remove_work", |a| ok(atelier_core::remove_work(&works_dir(MODE), &text(a, "slug")?, false))),
    ("read_spec_file", |a| {
        ok(atelier_core::read_spec_file(&works_dir(MODE), &text(a, "slug")?, &text(a, "path")?))
    }),
    ("list_archive", |_| ok(atelier_core::list_archive(&archive_dir(MODE)))),
    ("list_archived_docs", |a| {
        ok(atelier_core::list_archived_docs(&archive_dir(MODE), &text(a, "slug")?))
    }),
    ("read_archived_file", |a| {
        ok(atelier_core::read_work_file(&archive_dir(MODE), &text(a, "slug")?, &text(a, "path")?))
    }),
    ("search", |a| {
        ok(atelier_core::search(
            &works_dir(MODE),
            &archive_dir(MODE),
            Some(&projects_dir()),
            &text(a, "query")?,
            &destinations(a)?,
        ))
    }),
    // 셸 다섯은 PTY 풀이라는 **앱 프로세스의 상태**를 받는다. 다리는 호출마다 새 프로세스라
    // 그 풀이 없고, 있다 해도 프로세스가 끝나는 순간 셸도 죽는다.
    ("pty_spawn", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    ("pty_write", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    ("pty_resize", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    ("pty_kill", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    ("pty_command_running", |_| in_app_only("PTY 풀이 앱 프로세스의 상태입니다")),
    // 설정 둘은 **위 넷과 이유가 다르다.** `~/.atelier/settings.json` 한 장이라 다리가 못 탈
    // 성질이 아닌데, 읽고 쓰는 코드가 앱 크레이트(`src-tauri/src/settings.rs`)에 살고 다리는
    // 코어만 본다. 여기서 파일 규칙을 다시 적지 않는다 — 그 순간 이 층이 검증하는 것이 앱이
    // 아니라 다리가 된다(`ok`의 머리말과 같은 이유).
    //
    // 그래서 L4가 설정 화면을 관통해야 하는 날, 고칠 곳은 이 표가 아니라 저 모듈의 자리다 —
    // 코어로 옮기면 위 항목들처럼 진짜 핸들러가 된다.
    ("read_settings", |_| in_app_only("설정 모듈이 앱 크레이트에 있습니다")),
    ("write_settings", |_| in_app_only("설정 모듈이 앱 크레이트에 있습니다")),
];

/// 앱 프로세스 안에서만 뜻이 있는 커맨드. **표에는 남긴다** — 빼면 드리프트 검사가
/// "덮지 않은 커맨드"로 읽어 진짜 누락과 구별되지 않는다. 스텁으로 조용히 성공시키지도
/// 않는다: 검증 층에서 아무것도 확인하지 않은 통과는 실패보다 나쁘다.
fn in_app_only(why: &str) -> Handled {
    Err(format!("이 커맨드는 다리로 탈 수 없습니다: {why}"))
}

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

/// 프런트가 건네는 「가는 곳」 목록(결정 21). **여기서 모양을 손보지 않는다** — 라벨은
/// 프런트 것이고 코어가 그것으로 맞춘다.
fn destinations(args: &Args) -> Result<Vec<atelier_core::Destination>, String> {
    let value = args
        .get("destinations")
        .ok_or_else(|| "인자 'destinations'(배열)가 필요합니다".to_string())?;
    serde_json::from_value(value.clone()).map_err(err)
}

fn flag(args: &Args, key: &str) -> Result<bool, String> {
    args.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("인자 '{key}'(불리언)가 필요합니다"))
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

    /// 앱 크레이트 `src/` 아래의 소스 전부. **`include_str!`이라 파일이 사라지면 컴파일이
    /// 깨진다** — 검사가 읽을 것을 못 찾아 조용히 통과하는 길이 없다 (위 등록부 스캔과
    /// 같은 관례).
    ///
    /// **키는 `src/` 기준 상대 경로다.** 파일명만 적으면 `pty/mod.rs`처럼 하위 폴더로
    /// 태어난 모듈을 적을 자리가 없고, 두 폴더의 같은 이름이 한 칸을 다툰다.
    ///
    /// `src-tauri/build.rs`는 일부러 밖이다 — 빌드 스크립트는 컴파일 시각에 돌고 앱
    /// 프로세스가 아니라, 아래 검사가 막으려는 「도는 앱이 모드를 env에서 읽는다」가
    /// 성립하지 않는다. 그래서 이 표가 덮는 것은 「앱 크레이트 전부」가 아니라
    /// **`src-tauri/src/` 전부**다.
    ///
    /// 이 표가 다리에 사는 것은 **제 자신을 안 읽기 때문이다.** 앱 크레이트 안에 두면
    /// 아래 검사가 찾는 낱말이 그 검사의 문자열로도 파일에 있어, 스스로를 읽고 빨개진다.
    const APP_SOURCES: [(&str, &str); 6] = [
        ("commands.rs", include_str!("../../../src-tauri/src/commands.rs")),
        ("lib.rs", include_str!("../../../src-tauri/src/lib.rs")),
        ("main.rs", include_str!("../../../src-tauri/src/main.rs")),
        ("pty.rs", include_str!("../../../src-tauri/src/pty.rs")),
        ("settings.rs", include_str!("../../../src-tauri/src/settings.rs")),
        ("watcher.rs", include_str!("../../../src-tauri/src/watcher.rs")),
    ];

    /// CLI 크레이트 `src/` 아래의 소스 전부. 위 표와 짝이다 — 앱 쪽은 「env를 아예 안
    /// 읽는다」를, 이쪽은 「읽는 자리가 하나뿐이다」를 붙든다.
    const CLI_SOURCES: [(&str, &str); 9] = [
        ("main.rs", include_str!("../../atelier-cli/src/main.rs")),
        ("mcp/install.rs", include_str!("../../atelier-cli/src/mcp/install.rs")),
        ("mcp/instructions.rs", include_str!("../../atelier-cli/src/mcp/instructions.rs")),
        ("mcp/mod.rs", include_str!("../../atelier-cli/src/mcp/mod.rs")),
        ("mcp/project_tools.rs", include_str!("../../atelier-cli/src/mcp/project_tools.rs")),
        ("mcp/read_tools.rs", include_str!("../../atelier-cli/src/mcp/read_tools.rs")),
        ("mcp/skill_cleanup.rs", include_str!("../../atelier-cli/src/mcp/skill_cleanup.rs")),
        ("mcp/tool_error.rs", include_str!("../../atelier-cli/src/mcp/tool_error.rs")),
        ("mcp/work_tools.rs", include_str!("../../atelier-cli/src/mcp/work_tools.rs")),
    ];

    /// `dir` 아래의 `.rs`를 **재귀로** 모아 `dir` 기준 상대 경로로 돌려준다.
    ///
    /// **재귀가 요점이다.** 한 겹만 읽으면 디렉터리 항목은 `.rs`로 안 끝나 필터에서 조용히
    /// 버려지고, 하위 폴더로 태어난 모듈은 디스크 목록에도 표에도 없어 두 집합이 그대로
    /// 맞는다 — 그 모듈이 무슨 짓을 하든 아래 검사들이 한 줄도 안 읽는다. 새 파일이 검사
    /// 밖에서 태어나는 것을 막으려고 만든 커버리지 검사가 정확히 그 경우를 놓친다.
    fn rust_sources_under(dir: &std::path::Path, prefix: &str, out: &mut Vec<String>) {
        let entries = std::fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("소스 폴더를 못 읽었다 ({}): {e}", dir.display()));
        for entry in entries {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if path.is_dir() {
                rust_sources_under(&path, &format!("{prefix}{name}/"), out);
            } else if name.ends_with(".rs") {
                out.push(format!("{prefix}{name}"));
            }
        }
    }

    /// 표가 폴더를 **전부** 덮는지. 표에만 기대면 새 파일이 검사 밖에서 태어나고, 하필 그
    /// 파일이 규칙을 깨는 파일일 수 있다. 폴더를 못 읽으면 순회에서 터지고, 한 개도 못
    /// 모으면 여기서 터진다 — 「읽을 게 없어서 통과」가 이 검사에는 없다.
    fn 표가_폴더를_덮는다(relative: &str, listed: &[(&str, &str)]) {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        let mut on_disk = Vec::new();
        rust_sources_under(&dir, "", &mut on_disk);
        assert!(!on_disk.is_empty(), "{relative} 아래에서 소스를 하나도 못 읽었다 — 순회가 샜다");
        on_disk.sort();

        let mut listed: Vec<String> = listed.iter().map(|(name, _)| name.to_string()).collect();
        listed.sort();

        assert_eq!(listed, on_disk, "{relative}의 소스가 늘거나 줄었다 — 표에 함께 적어라");
    }

    #[test]
    fn 앱_소스_표가_폴더_전체를_덮는다() {
        표가_폴더를_덮는다("../../src-tauri/src", &APP_SOURCES);
    }

    #[test]
    fn cli_소스_표가_폴더_전체를_덮는다() {
        표가_폴더를_덮는다("../atelier-cli/src", &CLI_SOURCES);
    }

    /// 모드를 env에서 읽는 코드에 **반드시 나타나는 이름 셋.** 코어의 파서
    /// (`mode_from_env`)·변수 이름 상수(`MODE_ENV`)·그 상수가 담은 문자열(`ATELIER_MODE`)
    /// 이라, 어느 길로 읽든 소스에 이 중 하나는 적힌다.
    const MODE_ENV_NAMES: [&str; 3] = ["mode_from_env", "MODE_ENV", "ATELIER_MODE"];

    /// **앱은 모드를 환경에서 읽지 않는다** (결정 20).
    ///
    /// 앱은 두 세계를 한 프로세스에서 **함께** 그리므로, 프로세스에 값 하나인 env로는
    /// 애초에 못 가른다 — 모드는 URL에서 나와 명령 인자로 내려간다. 앱 어딘가가 env를
    /// 읽기 시작하면 그 자리만 저쪽 세계를 보게 되고, 화면과 데이터가 어긋난 채로 조용히
    /// 돈다. 환경에서 모드를 읽는 자리는 **MCP 진입점 하나뿐이다** (아래 검사가 그 절반).
    ///
    /// **줄을 파싱하지 않는다.** 「읽는 호출과 변수 이름이 한 줄에 함께 선다」로 좁혔던
    /// 판은 `let key = MODE_ENV;` / `let raw = var(key);` 두 줄이면 그대로 통과했다 —
    /// 파서가 새면 조용히 통과하는 검사다. 그래서 **이름이 등장하는 것 자체**를 거절한다.
    /// 지금 앱 소스에는 셋 다 한 번도 안 나오므로 이렇게 좁게 잠글 수 있다.
    ///
    /// **앱이 그 값을 셸에 심는 것**은 규칙 위반이 아니라 이 판의 설계다 (결정 15). 그
    /// 자리는 #181이 `pty.rs`에 연다 — 그때 이 검사를 **통째로 지우지 말고** 그 한 자리만
    /// 예외로 좁혀 다시 잠가야 한다. 지우면 남는 그물이 없다.
    #[test]
    fn 앱은_모드를_환경에서_읽지_않는다() {
        for (file, source) in APP_SOURCES {
            for name in MODE_ENV_NAMES {
                assert!(
                    !source.contains(name),
                    "src-tauri/src/{file}에 '{name}'가 있다 — 앱에서 모드는 인자로 내려온다"
                );
            }
        }
    }

    /// **env 파서를 부르는 자리는 MCP 진입점 하나뿐이다** (결정 20). 위 검사가 앱을
    /// 잠그고 이 검사가 CLI를 잠근다 — 둘이 함께여야 「호출처가 하나」가 참이다.
    ///
    /// 왜 세는가: 도구 핸들러나 `install`이 env를 다시 읽기 시작하면 「루트는 기동 시 한 번
    /// 확정한다」(`AtelierServer::for_mode`)가 조용히 거짓이 된다. 요청마다 env를 읽는
    /// 서버는 한 프로세스 안에서 두 세계를 오갈 수 있고, 그 순간 도구가 어느 루트에
    /// 썼는지는 호출 시점의 환경에 달린다 — 재현도 설명도 안 되는 자리다.
    ///
    /// 이름 셋 **전부**를 보는 것이 요점이다. `mode_from_env`만 세면
    /// `std::env::var(MODE_ENV)`로 파서를 우회한 자리가 그대로 빠져나간다.
    ///
    /// **문서 문자열에 그 이름을 적는 것도 같이 걸린다.** 읽는 코드와 설명하는 글을 가르려면
    /// 파싱이 필요하고, 파싱이 새면 이 검사가 조용히 통과한다 — 그 값을 치르느니 넓게
    /// 잠근다. 지침(`instructions.rs`)이 그 이름을 적어야 하는 날에는 검사를 지우지 말고
    /// 그 파일 하나를 예외로 좁혀라.
    #[test]
    fn cli에서_모드를_env로_읽는_자리는_진입점_하나뿐이다() {
        const ENTRY: &str = "mcp/mod.rs";
        for (file, source) in CLI_SOURCES {
            if file == ENTRY {
                continue;
            }
            for name in MODE_ENV_NAMES {
                assert!(
                    !source.contains(name),
                    "crates/atelier-cli/src/{file}에 '{name}'가 있다 — 모드를 읽는 자리는 {ENTRY}뿐이다"
                );
            }
        }

        // 진입점 안에서도 **한 번**이다. 두 번 부르면 두 호출 사이에 env가 바뀔 수 있고,
        // 그때 이 서버가 어느 세계인지가 부르는 순서에 달린다.
        let entry = CLI_SOURCES
            .iter()
            .find(|(file, _)| *file == ENTRY)
            .unwrap_or_else(|| panic!("{ENTRY}가 표에서 사라졌다"))
            .1;
        assert_eq!(
            entry.matches("mode_from_env").count(),
            1,
            "{ENTRY}가 env 파서를 한 번이 아니라 여러 번 부른다"
        );
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
