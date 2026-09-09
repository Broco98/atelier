//! 다리 계약 테스트: `mode`를 받는 명령을 실제로 불러 어느 루트를 읽고 쓰는지 본다.
//!
//! 첫 판(#181)은 대표 몇 개를 손으로 골라 재는 것이었고, contract(#187)가 그 위에 둘을
//! 얹었다 — **명령 전부를 열거해** `maison`으로 불러 보는 것과, **모드를 빼면 거절되는지**다.
//! 열거의 목록은 손으로 안 적는다: `commands.rs`에서 파생하므로 모드를 받는 명령이 늘면
//! 아래 인자 표가 그 이름을 모른다고 빨개진다(fail-closed).
//!
//! **왜 별도 프로세스인가.** 다리를 격리하는 길은 `ATELIER_HOME` 하나뿐인데, 그 값을 단위
//! 테스트가 세우면 한 프로세스 안에서 병렬로 도는 다른 테스트의 루트까지 함께 옮긴다
//! (커널 `paths.rs`가 같은 이유로 env를 안 만진다). 여기서는 L4가 하는 것과 **같은
//! 방식으로** — 임시 홈을 주고 바이너리를 부른다 — 재므로, 재는 길과 쓰는 길이 하나다.
//!
//! **이 층이 앱의 `commands.rs`는 아니다**(D8이 인정한 사각지대). 다리와 앱은 같은 커널
//! 함수를 같은 인자로 부르는 두 벌의 얇은 위임이고, 둘이 어긋나지 않게 붙드는 것은 다리
//! 크레이트의 소스 검사들이다.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};

/// 임시 데이터 루트. 이름에 프로세스 id를 넣어 같은 기계에서 겹치지 않게 한다
/// (`settings.rs`의 `temp_root`와 같은 관례 — 이 크레이트도 `tempfile`을 안 든다).
fn temp_home(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("atelier-bridge-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// work.json 한 장을 **손으로 심는다.** 다리에도 앱에도 work를 만드는 명령이 없으므로
/// (Room을 만드는 길은 MCP뿐이다), L4가 쓰는 것과 같은 준비 방식이다.
fn plant(home: &Path, relative: &str, title: &str) {
    let dir = home.join(relative);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("work.json"),
        json!({
            "title": title,
            "status": "active",
            "createdAt": "2026-09-08T00:00:00Z",
            "projects": [],
        })
        .to_string(),
    )
    .unwrap();
}

/// 프로젝트 등록 한 장을 **손으로 심는다.** `create_project`는 진짜 git 저장소를 요구하는데
/// 여기서 재는 것은 「등록부를 걷는가」이지 등록 절차가 아니다 — 파일 모양은
/// `render_project`가 내는 것과 같은 프런트매터다.
///
/// `path`가 없는 폴더를 가리켜도 상관없다. `read_projects`는 파일만 읽고, 검색이 맞추는
/// 재료도 `name` 하나다.
fn plant_project(home: &Path, slug: &str, name: &str) {
    let dir = home.join("projects");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(format!("{slug}.md")),
        format!(
            "---\nname: {name}\npath: ~/dev/{slug}\nbaseBranch: main\ncreatedAt: 2026-09-08\n---\n"
        ),
    )
    .unwrap();
}

/// 다리를 브라우저가 부르듯 부른다. 성공하면 표준출력의 JSON, 실패하면 표준에러 그대로.
fn call(home: &Path, command: &str, args: Value) -> Result<Value, String> {
    let out = Command::new(env!("CARGO_BIN_EXE_atelier-test-bridge"))
        .arg(command)
        .arg(args.to_string())
        .env("ATELIER_HOME", home)
        .output()
        .expect("다리를 띄우지 못했다");
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        Ok(serde_json::from_str(stdout.trim())
            .unwrap_or_else(|e| panic!("다리가 JSON이 아닌 것을 냈다 ({e}): {stdout}")))
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

fn slugs(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("목록이 배열이 아니다")
        .iter()
        .map(|item| item["slug"].as_str().expect("slug가 없다").to_string())
        .collect()
}

/// **두 세계가 한 홈 안에서 갈린다.** 같은 명령이 `mode` 하나로 다른 루트를 읽는다.
///
/// 아래 열거 테스트가 명령 전부를 훑지만 그것이 드는 것은 「어느 세계를 읽었나」의 **한
/// 비트**뿐이다(찾았나·담겼나). 여기서는 두 세계를 **같은 홈에** 나란히 세워 두고, 이쪽을
/// 읽으면 저쪽이 안 보이는지까지 잰다 — 둘 다 읽는 변형은 그 한 비트로는 안 잡힌다.
#[test]
fn 모드가_목록과_조회의_루트를_가른다() {
    let home = temp_home("read");
    plant(&home, "maison/rooms/finance", "금융");
    plant(&home, "works/spec-search", "spec 검색");

    assert_eq!(
        slugs(&call(&home, "list_works", json!({ "mode": "maison" })).unwrap()),
        ["finance"],
        "Maison 목록이 Room이 아닌 것을 담았다"
    );
    // **모드를 빼면 답이 없다**(#187) — 한때 이 자리에 「없으면 Atelier」를 재는 단언이
    // 있었다. 그 갈래는 프런트가 아직 모드를 안 보내던 동안의 발판이었고, 지금은 빠뜨린
    // 호출을 오류로 되돌린다(`모드를_빼면_명령이_거절한다`가 다리를 탈 수 있는 명령 전부에
    // 대해 잰다 — 못 타는 하나는 그 머리말이 어디서 드는지 적어 뒀다).
    assert_eq!(
        slugs(&call(&home, "list_works", json!({ "mode": "atelier" })).unwrap()),
        ["spec-search"],
        "Atelier 목록이 Room을 담았거나 제 것을 못 봤다"
    );

    let room = call(&home, "get_work", json!({ "mode": "maison", "slug": "finance" })).unwrap();
    assert_eq!(room["title"], "금융");
    let spec_dir = room["specDir"].as_str().expect("specDir이 없다");
    assert!(
        spec_dir.ends_with("maison/rooms/finance/spec"),
        "에이전트에게 건네는 spec 경로가 Maison 루트가 아니다: {spec_dir}"
    );

    // **저쪽 세계의 slug는 없는 것이다.** 두 루트에 같은 slug가 공존할 수 있다는 결정이
    // 성립하려면(결정 10) 조회가 자기 루트 밖으로 나가지 않아야 한다.
    assert!(
        call(&home, "get_work", json!({ "mode": "maison", "slug": "spec-search" })).is_err(),
        "Maison 조회가 Atelier work를 찾아냈다"
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// 쓰는 쪽도 같다 — 치운 Room은 `maison/archive/`로 가고, Atelier 아카이브는 안 건드린다.
#[test]
fn maison에서_치운_room은_maison_아카이브로_간다() {
    let home = temp_home("archive");
    plant(&home, "maison/rooms/finance", "금융");

    call(&home, "archive_work", json!({ "mode": "maison", "slug": "finance" })).unwrap();

    assert!(
        home.join("maison/archive/finance/record.md").is_file(),
        "Room이 Maison 아카이브에 기록과 함께 서지 않았다"
    );
    assert!(!home.join("maison/rooms/finance").exists(), "치운 Room이 목록에 남았다");
    assert!(
        !home.join("archive/finance").exists(),
        "Room이 Atelier 아카이브로 갔다 — 두 세계가 섞인다"
    );

    assert_eq!(
        slugs(&call(&home, "list_archive", json!({ "mode": "maison" })).unwrap()),
        ["finance"],
        "Maison 아카이브 목록이 방금 치운 Room을 못 본다"
    );
    assert!(
        slugs(&call(&home, "list_archive", json!({ "mode": "atelier" })).unwrap()).is_empty(),
        "Atelier 아카이브 목록에 Room이 섞였다"
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// **Maison의 ⇧⇧에는 프로젝트 층이 없다** (결정 17, US 49·50).
///
/// 루트를 가르는 것만으로는 안 되는 자리다 — 프로젝트 등록부(`projects/`)는 모드를 안 받는
/// 공용 루트라, 「Maison에는 안 건넨다」를 명령이 직접 정한다. 뒤집으면 공부하다 팔레트를
/// 연 사람에게 `feat/spec-search`가 선다.
///
/// **아카이브 쪽 계약 테스트로는 이 갈래가 안 잡힌다.** `archive_work`도 등록부를 받지만
/// 그것을 읽는 것은 `work.projects` 루프 **안**이고, 심는 work.json은 `projects: []`라
/// 루프가 안 돈다 — `Some`이든 `None`이든 record.md가 한 글자도 안 다르다. 등록부가
/// 실제로 걸어지는 명령은 검색뿐이라 여기서 잰다.
///
/// **`destinations`는 빈 배열로 충분하다.** 그 층은 프런트가 건넨 목록만 보고
/// 등록부와 무관하다 — 빈 목록은 「나는 목적지가 없다」는 멀쩡한 답이다.
#[test]
fn maison_검색은_프로젝트_등록부를_안_걷는다() {
    let home = temp_home("search");
    plant_project(&home, "spec-search", "spec 검색");
    // 같은 질의에 걸리는 Room을 함께 심는다. **Maison 검색이 통째로 죽어도 「프로젝트가
    // 없다」는 참이 되므로**, 그 쪽이 살아 있다는 것을 같은 호출에서 함께 재야 한다.
    plant(&home, "maison/rooms/study", "spec 검색 공부");

    let hits = |mode: &str| -> Vec<Value> {
        let args = json!({ "mode": mode, "query": "spec 검색", "destinations": [] });
        call(&home, "search", args).unwrap()["hits"].as_array().unwrap().clone()
    };

    let project = json!({ "kind": "project", "slug": "spec-search", "name": "spec 검색" });
    let room = json!({ "kind": "work", "slug": "study", "title": "spec 검색 공부", "archived": false });

    // 같은 질의가 Atelier에서는 그 프로젝트를 낸다 — **양쪽 다 비게 눕히는 변형**을 여기서
    // 막는다. 등록부를 아예 안 건네도 「Maison에는 없다」만 재면 초록이기 때문이다.
    assert_eq!(hits("atelier"), vec![project], "Atelier 검색이 등록부를 안 걷는다");

    assert_eq!(
        hits("maison"),
        vec![room],
        "Maison 검색이 Atelier 프로젝트를 냈거나 제 Room을 못 봤다 — \
         공부하다 ⇧⇧를 누르면 저쪽 세계가 보인다"
    );

    let _ = std::fs::remove_dir_all(&home);
}

/// **오타는 조용히 Atelier로 눕지 않는다.** 누우면 「Maison이라고 적었는데 일 목록이
/// 나온다」가 되고, L4에서는 그것이 「기능이 안 된다」로만 보여 원인을 못 찾는다.
/// 커널의 env 파서가 모르는 값을 거절하는 것과 같은 규칙이다.
#[test]
fn 모르는_모드는_거절된다() {
    let home = temp_home("unknown");
    plant(&home, "works/spec-search", "spec 검색");

    let refused = call(&home, "list_works", json!({ "mode": "mansion" })).unwrap_err();
    assert!(refused.contains("mode"), "어느 인자가 문제인지 안 적혀 있다: {refused}");

    let _ = std::fs::remove_dir_all(&home);
}

// ─────────────────────────────────────────────────────────────────────────────
// contract (#187) — 명령 전부를 열거한다
// ─────────────────────────────────────────────────────────────────────────────

/// 앱이 등록한 명령의 원천 둘. **`include_str!`이라 파일이 옮겨지면 컴파일이 깨진다** —
/// 검사가 읽을 것을 못 찾아 조용히 통과하는 길이 없다(다리 크레이트의 소스 검사들과 같은
/// 관례).
///
/// **왜 여기서 소스를 다시 읽는가.** `atelier-test-bridge`는 `[[bin]]`뿐이라 통합 테스트가
/// 그 크레이트를 `use` 할 수 없다 — `HANDLERS`도 `APP_SOURCES`도 이 파일에서는 못 든다.
/// 목록을 손으로 적는 대신 원천을 다시 읽는 쪽을 골랐다: 손 목록은 새 명령이 늘어도 아무
/// 신호를 안 내고, 그때 빠지는 것은 검사 한 줄이 아니라 「어느 세계를 읽는가」 전부다.
const COMMANDS_RS: &str = include_str!("../../../src-tauri/src/commands.rs");
const LIB_RS: &str = include_str!("../../../src-tauri/src/lib.rs");

/// 다리가 「나는 이 커맨드를 못 탄다」고 말할 때의 말(`in_app_only`). **손 목록으로 거르지
/// 않는다** — 여기에 이름을 적으면 새로 앱 전용이 된 명령이 조용히 열거 밖으로 나간다.
/// 다리 자신의 대답으로 거르면 그런 명령은 아래 증인 목록에서 어긋나 빨개진다.
const NOT_ON_BRIDGE: &str = "다리로 탈 수 없습니다";

/// 다리로 못 타는 명령의 **증인**. 거르는 목록이 아니라 「이 층이 안 재는 자리는 여기까지」
/// 라는 기록이다 — 하나가 늘면 빨개져서, 그 명령의 모드를 무엇이 드는지 답하고 넘어가게 한다.
///
/// `pty_spawn`이 여기 있는 이유: PTY 풀은 앱 프로세스의 상태라 호출마다 새 프로세스인
/// 다리에는 없다. 그 명령의 모드는 **다른 층 둘**이 든다 — `src/tauri-commands.test.ts`가
/// 위임 인자를 글자 그대로 견주고, `src-tauri/tests/top_terminal.rs`가 살아 있는 셸의
/// cwd와 `ATELIER_MODE`를 잰다.
const SKIPPED: [&str; 1] = ["pty_spawn"];

/// Tauri가 등록한 커맨드 이름. 다리 크레이트의 `registered()`와 같은 파싱이고, 모르는
/// 모양을 **건너뛰지 않는 것**도 같다 — 건너뛰면 그 커맨드가 이 검사의 눈에서 사라진다.
fn registered() -> Vec<String> {
    let open = "generate_handler![";
    let start = LIB_RS.find(open).expect("generate_handler! 블록을 찾지 못했다") + open.len();
    let end = start + LIB_RS[start..].find(']').expect("generate_handler! 블록이 닫히지 않았다");
    let mut names: Vec<String> = LIB_RS[start..end]
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| {
            item.strip_prefix("commands::")
                .unwrap_or_else(|| panic!("등록부에서 예상 못 한 항목을 봤다: {item}"))
                .to_string()
        })
        .collect();
    names.sort();
    names
}

/// `commands.rs`가 정의한 명령들 — `(이름, 인자 목록)`.
///
/// **줄머리에서만 자른다.** `"pub async fn "`을 아무 데서나 찾으면 그 낱말을 적은 산문
/// 주석(그 파일에 둘 있다)이 명령으로 둔갑한다. 정의는 열 0에서 시작하므로 줄바꿈을 앞에
/// 붙여 그 둘을 가른다.
///
/// **파서가 새면 조용히 통과하지 않는다.** 아래 `mode_taking`이 여기서 나온 이름 집합을
/// Tauri 등록부와 통째로 견주므로, 하나라도 흘리면 두 집합이 어긋나 빨개진다.
fn declared() -> Vec<(String, String)> {
    COMMANDS_RS
        .split("\npub async fn ")
        .skip(1)
        .map(|chunk| {
            let (name, rest) = chunk.split_once('(').expect("명령 서명에서 '('를 못 찾았다");
            let (params, _) = rest.split_once(')').expect("명령 서명이 ')'로 안 닫혔다");
            (name.trim().to_string(), params.to_string())
        })
        .collect()
}

/// **모드를 받는 명령의 이름.** 이 목록이 아래 인자 표의 기준이다.
fn mode_taking() -> Vec<String> {
    let declared = declared();
    let mut names: Vec<String> = declared.iter().map(|(name, _)| name.clone()).collect();
    names.sort();
    assert_eq!(
        names,
        registered(),
        "commands.rs에서 읽은 명령과 Tauri 등록부가 어긋났다 — 서명 파싱이 샜다"
    );

    let mut taking: Vec<String> = declared
        .into_iter()
        .filter(|(_, params)| params.contains("mode: Mode"))
        .map(|(name, _)| name)
        .collect();
    taking.sort();
    assert!(!taking.is_empty(), "모드를 받는 명령을 하나도 못 찾았다 — 파싱이 샜다");
    taking
}

/// 명령이 **어느 루트를 읽었는지 드러내는 방식**. 두 갈래뿐이다.
enum Reads {
    /// 그 slug를 찾아야만 답할 수 있는 명령. 저쪽 세계에서는 「없다」로 거절된다.
    Slug,
    /// 목록·검색처럼 저쪽 세계에서도 멀쩡히 **빈 답**을 내는 명령. 「오류인가」로는 두 세계가
    /// 안 갈리므로, 답 안에 심은 이름이 섰는지로 가른다.
    Listing(&'static str),
    /// 답이 아니라 **파일 한 장**으로 세계를 드러내는 명령. 두 세계에서 다 성공하고 답도
    /// 같아서(`null`), 어느 홈 아래에 썼는지로만 갈린다.
    Writes(&'static str),
}

/// 명령마다 **모드 말고 무엇이 더 필요한가**. 이름은 위에서 파생하고, 여기 적는 것은 그
/// 명령을 부르는 데 필요한 나머지 인자뿐이다 — 그것까지 파생할 길은 없다(서명에서 타입은
/// 읽어도 「어떤 값이 이 홈에서 뜻이 있는가」는 못 읽는다).
///
/// **키 집합이 파생 목록과 정확히 같아야 한다**(아래 첫 단언). 모드를 받는 명령이 늘면
/// 여기 없는 이름이 되어 빨개지고, 반대로 어떤 명령이 모드를 안 받게 되면 남는 이름이 되어
/// 빨개진다.
fn calls() -> Vec<(&'static str, Value, Reads)> {
    vec![
        ("list_works", json!({}), Reads::Listing("finance")),
        ("get_work", json!({ "slug": "finance" }), Reads::Slug),
        ("set_work_title", json!({ "slug": "finance", "title": "새 이름" }), Reads::Slug),
        ("set_work_status", json!({ "slug": "finance", "status": "done" }), Reads::Slug),
        ("set_work_pinned", json!({ "slug": "finance", "pinned": true }), Reads::Slug),
        ("archive_work", json!({ "slug": "finance" }), Reads::Slug),
        ("remove_work", json!({ "slug": "finance" }), Reads::Slug),
        ("read_spec_file", json!({ "slug": "finance", "path": "overview.md" }), Reads::Slug),
        ("list_archive", json!({}), Reads::Listing("shelved")),
        ("list_archived_docs", json!({ "slug": "shelved" }), Reads::Slug),
        ("read_archived_file", json!({ "slug": "shelved", "path": "record.md" }), Reads::Slug),
        ("search", json!({ "query": "금융", "destinations": [] }), Reads::Listing("finance")),
        // 다리가 인자를 보기 전에 거절한다(`in_app_only`) — 그래서 무엇을 적어도 같다.
        // 그래도 실제 서명대로 적는다: 빈 객체로 두면 「이 명령은 인자가 없다」로 읽힌다.
        ("pty_spawn", json!({ "cwd": null, "cols": 80, "rows": 24 }), Reads::Slug),
        // 이력은 답을 안 낸다 — 세계는 **쓴 자리**로만 드러난다(`maison/recent.json`).
        ("touch_recent_work", json!({ "slug": "finance" }), Reads::Writes("recent.json")),
    ]
}

/// 세계를 **Maison 쪽에만** 세운다. Atelier 루트는 비워 둔다 — 같은 인자로 두 번 부를 때
/// 「저쪽에서는 못 찾는다」가 성립해야 어느 루트를 읽었는지가 갈린다.
fn plant_world(home: &Path) {
    plant(home, "maison/rooms/finance", "금융");
    let spec = home.join("maison/rooms/finance/spec");
    std::fs::create_dir_all(&spec).unwrap();
    std::fs::write(spec.join("overview.md"), "# 금융\n").unwrap();

    // 아카이브 쪽은 **다른 slug**여야 한다. 같은 이름으로 두면 `archive_work`가 「이미
    // 아카이브에 있다」로 거절해서, 그 명령만 Maison에서도 실패한다.
    plant(home, "maison/archive/shelved", "치운 방");
    std::fs::write(home.join("maison/archive/shelved/record.md"), "# 치운 방\n").unwrap();
}

/// 쓰기 갈래가 홈 아래에서 찾는 파일. **한 장뿐이다** — 여러 장이 되면 갈래마다 다른
/// 자리를 재게 되고, 그때는 표에 적힌 이름과 실제로 재는 이름이 갈릴 수 있다.
const WROTE_PROBE: &str = "recent.json";

fn with_mode(args: &Value, mode: &str) -> Value {
    let mut args = args.clone();
    args["mode"] = json!(mode);
    args
}

/// **모드를 받는 명령 전부가 `maison`에서 Maison 루트를 읽는다** (#187).
///
/// 한 명령만 빠져도 그 화면은 Maison에서 Atelier 데이터를 보여 준다 — 오류가 아니라 **다른
/// 세계의 진짜 데이터**라, 화면에는 「목록이 이상하다」로만 보이고 어느 층도 안 빨개진다.
/// 그래서 대표를 고르지 않고 전부 부른다.
///
/// **같은 인자를 모드만 바꿔 두 번 부른다.** Maison에서만 통하고 Atelier에서는 안 통해야
/// 「루트를 골랐다」가 참이다 — 한쪽만 재면 두 세계를 다 훑는 변형이 그대로 통과한다.
/// 홈은 호출마다 새로 판다: 쓰는 명령이 여럿이라(`set_*`·`archive_work`·`remove_work`)
/// 한 홈을 나눠 쓰면 순서가 결과를 정한다.
#[test]
fn 모드를_받는_명령을_전부_maison으로_불러_본다() {
    let table = calls();
    let mut listed: Vec<String> = table.iter().map(|(name, _, _)| name.to_string()).collect();
    listed.sort();
    assert_eq!(
        listed,
        mode_taking(),
        "모드를 받는 명령과 이 파일의 인자 표가 어긋났다 — 새 명령을 여기 적어라"
    );

    let mut skipped = Vec::new();
    for (name, args, reads) in table {
        let maison_home = temp_home(&format!("all-{name}-maison"));
        plant_world(&maison_home);
        let maison = call(&maison_home, name, with_mode(&args, "maison"));
        // **지우기 전에 디스크를 본다.** 답이 아니라 쓴 자리로 세계가 갈리는 명령이 있다.
        let maison_wrote = |rel: &str| {
            (maison_home.join("maison").join(rel).exists(), maison_home.join(rel).exists())
        };
        let maison_disk = maison_wrote(WROTE_PROBE);
        let _ = std::fs::remove_dir_all(&maison_home);

        if let Err(message) = &maison {
            if message.contains(NOT_ON_BRIDGE) {
                skipped.push(name);
                continue;
            }
        }

        let atelier_home = temp_home(&format!("all-{name}-atelier"));
        plant_world(&atelier_home);
        let atelier = call(&atelier_home, name, with_mode(&args, "atelier"));
        let atelier_disk =
            (atelier_home.join("maison").join(WROTE_PROBE).exists(),
             atelier_home.join(WROTE_PROBE).exists());
        let _ = std::fs::remove_dir_all(&atelier_home);

        match reads {
            Reads::Slug => {
                assert!(maison.is_ok(), "{name}이 Maison에서 제 Room을 못 찾았다: {maison:?}");
                assert!(
                    atelier.is_err(),
                    "{name}이 atelier로 불렸는데 Maison의 Room을 찾아냈다 — 루트를 안 가른다"
                );
            }
            Reads::Writes(file) => {
                assert_eq!(file, WROTE_PROBE, "쓰기 갈래가 재는 파일이 하나뿐이라는 전제가 깨졌다");
                assert!(maison.is_ok(), "{name}이 Maison에서 실패했다: {maison:?}");
                assert!(atelier.is_ok(), "{name}이 Atelier에서 실패했다: {atelier:?}");
                assert_eq!(
                    maison_disk,
                    (true, false),
                    "{name}이 maison으로 불렸는데 `maison/{file}`이 아니라 Atelier 자리에 썼다"
                );
                assert_eq!(
                    atelier_disk,
                    (false, true),
                    "{name}이 atelier로 불렸는데 Maison 자리에 썼다"
                );
            }
            Reads::Listing(needle) => {
                let answered = maison.expect("Maison 호출이 실패했다").to_string();
                assert!(
                    answered.contains(needle),
                    "{name}이 Maison에서 심은 '{needle}'을 안 담았다: {answered}"
                );
                let other = atelier.map(|value| value.to_string()).unwrap_or_default();
                assert!(
                    !other.contains(needle),
                    "{name}이 atelier로 불렸는데 Maison의 '{needle}'을 담았다: {other}"
                );
            }
        }
    }

    assert_eq!(skipped, SKIPPED, "다리로 못 타는 명령이 달라졌다 — 이 층이 안 재는 자리다");
}

/// **모드를 빼면 거절한다** (#187, contract). 한때는 「없으면 Atelier」였다.
///
/// 그 기본값이 남아 있으면 인자를 빠뜨린 호출이 오류 없이 저쪽 세계의 데이터로 답한다 —
/// 프런트가 새 화면에서 한 자리를 빠뜨려도 L4가 초록이고(하네스가 모드 표 없이 다리로
/// 넘긴다), 실물 앱에서만 「목록이 이상하다」로 나타난다.
///
/// **다른 인자는 전부 채워 넣는다.** 안 그러면 다리가 그 인자를 먼저 나무라서, 모드가
/// 필수인지와 무관하게 오류가 난다 — 그 초록은 아무것도 안 잰 초록이다. 그래서 오류가
/// 났다는 것만이 아니라 **모드를 가리켜 나무라는지**까지 본다.
///
/// **`pty_spawn`은 여기서도 안 재진다.** 다리가 인자를 보기 전에 거절하므로(`in_app_only`),
/// 「모드를 빼면 오류다」를 **실행으로** 재는 자리는 그 명령 하나에 대해 어느 층에도 없다 —
/// 위 열거 테스트가 같은 이유로 건너뛰고, `src-tauri/tests/top_terminal.rs`는 커널
/// (`pty::spawn`)을 직접 부르므로 `#[tauri::command]`의 인자 계약을 지나지 않는다. 그 자리를
/// 대신 드는 것은 소스 검사 둘이다: 다리 크레이트의 `어느_명령도_모드를_기본값으로_안_정한다`가
/// 서명이 `Option<Mode>`로 되돌아가는 것을 막고, `src/tauri-commands.test.ts`가 받은 값이
/// 커널까지 그대로 가는지를 글자로 견준다. 실행으로 재려면 `src-tauri`에 `tauri`의 `test`
/// 피처를 들여 `mock_builder`로 명령을 부르는 하네스가 있어야 하는데, 그것은 이 티켓의
/// 범위 밖이다 — **그래서 여기 적어 남긴다.**
///
/// 아래 증인이 그 사실을 붙든다: 건너뛴 이름이 `SKIPPED`와 어긋나면 빨개져서, 새로 다리를
/// 못 타게 된 명령이 조용히 이 검사 밖으로 나가지 못한다.
#[test]
fn 모드를_빼면_명령이_거절한다() {
    let mut skipped = Vec::new();
    for (name, args, _) in calls() {
        let home = temp_home(&format!("nomode-{name}"));
        plant_world(&home);
        let outcome = call(&home, name, args.clone());
        let _ = std::fs::remove_dir_all(&home);

        let refused = match outcome {
            Ok(value) => panic!("모드 없이 부른 {name}이 답했다 — 기본값이 살아 있다: {value}"),
            Err(message) => message,
        };
        if refused.contains(NOT_ON_BRIDGE) {
            skipped.push(name);
            continue;
        }
        assert!(
            refused.contains("mode"),
            "{name}이 모드 아닌 이유로 거절했다 — 이 호출은 모드 필수를 안 재고 있다: {refused}"
        );
    }

    assert_eq!(skipped, SKIPPED, "다리로 못 타는 명령이 달라졌다 — 이 층이 안 재는 자리다");
}
