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
