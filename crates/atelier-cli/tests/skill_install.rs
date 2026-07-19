use assert_cmd::Command;

#[test]
fn skill_install_writes_to_claude_skills() {
    let home = tempfile::tempdir().unwrap();
    Command::cargo_bin("atelier").unwrap()
        .env("HOME", home.path())
        .args(["skill", "install"])
        .assert()
        .success();
    let installed = home.path().join(".claude/skills/atelier-projects/SKILL.md");
    let content = std::fs::read_to_string(installed).unwrap();
    assert!(content.contains("name: atelier-projects"));
}
