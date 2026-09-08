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
