use assert_cmd::Command;

#[test]
fn skill_install_writes_to_claude_skills() {
    let home = tempfile::tempdir().unwrap();
    Command::cargo_bin("atelier").unwrap()
        .env("HOME", home.path())
        .args(["skill", "install"])
        .assert()
        .success();
    let dir = home.path().join(".claude/skills/atelier");
    let content = std::fs::read_to_string(dir.join("SKILL.md")).unwrap();
    assert!(content.contains("name: atelier"));
    assert!(content.contains("atelier work start"), "works 흐름이 스킬에 포함돼야 한다");
    let manual = std::fs::read_to_string(dir.join("manual-editing.md")).unwrap();
    assert!(manual.contains("원자적 쓰기"), "직접 편집 규칙이 별도 파일로 설치돼야 한다");
}

#[test]
fn skill_install_migrates_old_directory() {
    let home = tempfile::tempdir().unwrap();
    // 구버전 설치 흔적 — 새 설치가 스킬 중복을 막기 위해 정리한다
    let old = home.path().join(".claude/skills/atelier-projects");
    std::fs::create_dir_all(&old).unwrap();
    std::fs::write(old.join("SKILL.md"), "old").unwrap();

    Command::cargo_bin("atelier").unwrap()
        .env("HOME", home.path())
        .args(["skill", "install"])
        .assert()
        .success();
    assert!(!old.exists(), "구버전 atelier-projects 스킬이 제거돼야 한다");
    assert!(home.path().join(".claude/skills/atelier/SKILL.md").exists());
}
