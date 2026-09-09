//! 다리 계약 테스트의 **첫 판**: `mode`를 받는 명령을 실제로 불러 어느 루트를 읽고 쓰는지
//! 본다 (#181). 전 명령 열거와 「빠지면 오류」는 contract 티켓(#187)이 든다.
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

/// **두 세계가 한 홈 안에서 갈린다.** 같은 명령이 `mode` 하나로 다른 루트를 읽고, 인자가
/// 없으면 지금까지와 똑같이 Atelier를 읽는다 (expand).
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
    // **없으면 Atelier다** — 프런트가 아직 모드를 안 보내므로, 이 갈래가 지금 도는 화면
    // 전부다. 여기가 뒤집히면 아무 화면도 아무것도 못 읽는다.
    assert_eq!(
        slugs(&call(&home, "list_works", json!({})).unwrap()),
        ["spec-search"],
        "모드를 안 준 호출이 Atelier 목록을 안 읽는다"
    );
    assert_eq!(
        slugs(&call(&home, "list_works", json!({ "mode": "atelier" })).unwrap()),
        ["spec-search"],
        "명시한 atelier가 없음과 다르게 굴었다"
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
        slugs(&call(&home, "list_archive", json!({})).unwrap()).is_empty(),
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

    let hits = |mode: Option<&str>| -> Vec<Value> {
        let mut args = json!({ "query": "spec 검색", "destinations": [] });
        if let Some(mode) = mode {
            args["mode"] = json!(mode);
        }
        call(&home, "search", args).unwrap()["hits"].as_array().unwrap().clone()
    };

    let project = json!({ "kind": "project", "slug": "spec-search", "name": "spec 검색" });
    let room = json!({ "kind": "work", "slug": "study", "title": "spec 검색 공부", "archived": false });

    // 같은 질의가 Atelier에서는 그 프로젝트를 낸다 — **양쪽 다 비게 눕히는 변형**을 여기서
    // 막는다. 등록부를 아예 안 건네도 「Maison에는 없다」만 재면 초록이기 때문이다.
    assert_eq!(hits(Some("atelier")), vec![project.clone()], "Atelier 검색이 등록부를 안 걷는다");
    assert_eq!(hits(None), vec![project], "모드를 안 준 검색이 Atelier와 다르게 굴었다");

    assert_eq!(
        hits(Some("maison")),
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
