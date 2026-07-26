use std::path::Path;
use std::process::{Command, Stdio};

use assert_cmd::cargo::CommandCargoExt;

/// 유령 스킬 폴더를 만들어 둔다.
fn plant_ghost(skills: &Path, name: &str) {
    let dir = skills.join(name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("SKILL.md"), "---\nname: atelier\n---\n").unwrap();
}

/// `atelier mcp`를 띄우고 표준입력을 즉시 닫아 스스로 끝나게 한다.
/// 정리는 serve() 이전에 동기적으로 돌기 때문에, 프로세스가 끝난 시점에는
/// 반드시 끝나 있다.
fn run_server_to_completion(skills: &Path, data_home: &Path) -> std::process::Output {
    Command::cargo_bin("atelier")
        .unwrap()
        .arg("mcp")
        .env("ATELIER_SKILLS_DIR", skills)
        .env("ATELIER_HOME", data_home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .unwrap()
}

/// V9 — 스킬 폴더가 있는 상태에서 서버를 띄우면 폴더가 사라지고,
/// 두 번째 기동에서도 오류 없이 넘어간다 (Δ11). 이 삭제가 Δ4의
/// `AI 에이전트 →(확률적 발동)→ 스킬 문서` 간선을 실제로 끊는다.
#[test]
fn starting_the_server_purges_ghost_skills_and_the_second_start_is_quiet() {
    let tmp = tempfile::tempdir().unwrap();
    let skills = tmp.path().join("skills");
    let data = tmp.path().join("data");
    plant_ghost(&skills, "atelier");
    plant_ghost(&skills, "atelier-projects");

    let first = run_server_to_completion(&skills, &data);
    assert!(!skills.join("atelier").exists(), "유령 스킬이 남았다");
    assert!(!skills.join("atelier-projects").exists(), "구버전 유령 스킬이 남았다");

    let err = String::from_utf8_lossy(&first.stderr).into_owned();
    assert!(err.contains("유령 스킬 제거됨"), "정리를 진단으로 알려야 한다: {err}");

    // Δ13 — 정리 진단이 표준출력을 오염시키면 호스트의 JSON-RPC 파싱이 깨진다.
    assert!(
        first.stdout.is_empty(),
        "표준출력에 프로토콜 외 바이트가 흘렀다: {:?}",
        String::from_utf8_lossy(&first.stdout)
    );

    let second = run_server_to_completion(&skills, &data);
    let err2 = String::from_utf8_lossy(&second.stderr).into_owned();
    assert!(
        !err2.contains("유령 스킬 제거됨"),
        "지울 것이 없으면 조용해야 한다: {err2}"
    );
    assert!(
        !err2.contains("지우지 못했습니다"),
        "두 번째 기동에서 정리가 오류를 내면 안 된다: {err2}"
    );
    assert!(second.stdout.is_empty());

    // 이 하네스는 핸드셰이크를 하지 않고 stdin을 즉시 닫으므로, 서버는
    // "initialize 전에 연결이 끊겼다"로 0이 아닌 코드를 낸다 — 티켓 01부터의 동작이고
    // 첫 기동도 똑같다. V9가 주장하는 것은 **정리가 조용하다**이지 이 종료코드가
    // 아니므로 success()를 단정하지 않는다. 대신 실패 사유가 딱 그것 하나인지는
    // 잠근다 — 다른 종류의 기동 실패는 여기서 걸린다.
    for out in [&first, &second] {
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(
            out.status.success() || err.contains("connection closed"),
            "핸드셰이크 미완 외의 이유로 기동이 실패했다: {out:?}"
        );
    }
}

/// 진짜 `claude`를 절대 부르지 않게 하는 하네스.
/// PATH를 이 디렉터리 하나로 갈아끼우고, 받은 argv를 로그 파일에 적는 가짜를 심는다.
/// → 사용자의 실제 ~/.claude.json 은 어떤 경로로도 열리지 않는다.
fn plant_fake_claude(bin: &Path, log: &Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(bin).unwrap();
    let script = format!(
        "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"{}\"\nexit 0\n",
        log.display()
    );
    let path = bin.join("claude");
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn install_with_path(bin: &Path, skills: &Path) -> std::process::Output {
    Command::cargo_bin("atelier")
        .unwrap()
        .args(["mcp", "install"])
        .env("PATH", bin)                       // 진짜 claude로 새지 않는다
        .env("ATELIER_SKILLS_DIR", skills)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .unwrap()
}

/// V8 · Δ10 — 등록 한 번으로 사용자 전역 스코프에 서버가 붙는다.
/// 스코프가 user 여야 하는 이유는 graph-plan D4 / A6: 기본 스코프 local 은
/// "추가한 시점의 저장소 루트"에 고정되는데, 설치 스크립트는 아무 폴더에서나 돈다.
#[test]
fn install_registers_the_server_at_user_scope() {
    let tmp = tempfile::tempdir().unwrap();
    let bin = tmp.path().join("bin");
    let log = tmp.path().join("claude-argv.log");
    plant_fake_claude(&bin, &log);

    let out = install_with_path(&bin, &tmp.path().join("skills"));
    assert!(out.status.success(), "등록이 실패했다: {out:?}");

    let argv = std::fs::read_to_string(&log).unwrap();
    let lines: Vec<&str> = argv.lines().collect();
    assert_eq!(lines.len(), 2, "remove 후 add 두 번을 불러야 한다: {argv}");

    // 1) 먼저 지운다 — add 단독은 이미 있는 이름에 종료코드 1을 내고 경로도 갱신하지 않는다.
    assert!(lines[0].starts_with("mcp remove"), "먼저 remove: {argv}");
    assert!(lines[0].contains("--scope user"), "remove도 같은 스코프: {argv}");

    // 2) 그다음 등록한다.
    let add = lines[1];
    assert!(add.starts_with("mcp add"), "그다음 add: {argv}");
    assert!(add.contains("--scope user"), "등록은 사용자 전역이어야 한다 (A6): {add}");
    assert!(add.contains(" atelier -- "), "서버 이름은 atelier: {add}");
    assert!(add.ends_with(" mcp"), "서버 실행 인자는 mcp 하나여야 한다: {add}");
    assert!(
        !add.contains("skill"),
        "등록 명령이 스킬을 다시 설치하려 한다: {add}"
    );
}

/// V9의 나머지 절반 — 등록 경로도 같은 정리 동작을 공유한다 (작업 계약).
/// 정리가 install 안에 두 번째로 구현돼 있으면 여기서 갈라진다.
#[test]
fn install_purges_ghost_skills_too() {
    let tmp = tempfile::tempdir().unwrap();
    let bin = tmp.path().join("bin");
    plant_fake_claude(&bin, &tmp.path().join("claude-argv.log"));
    let skills = tmp.path().join("skills");
    plant_ghost(&skills, "atelier");
    plant_ghost(&skills, "atelier-projects");

    let out = install_with_path(&bin, &skills);
    assert!(out.status.success(), "{out:?}");
    assert!(!skills.join("atelier").exists());
    assert!(!skills.join("atelier-projects").exists());
}
