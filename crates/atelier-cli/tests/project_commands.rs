use assert_cmd::Command;
use predicates::str::contains;

fn atelier(home: &std::path::Path) -> Command {
    let mut cmd = Command::cargo_bin("atelier").unwrap();
    cmd.env("ATELIER_HOME", home);
    cmd
}

#[test]
fn full_crud_flow() {
    let home = tempfile::tempdir().unwrap();
    let work = tempfile::tempdir().unwrap();
    let folder = work.path().join("my-app");
    std::fs::create_dir(&folder).unwrap();

    // add
    atelier(home.path())
        .args(["project", "add"]).arg(&folder).arg("--json")
        .assert().success().stdout(contains("\"slug\": \"my-app\""));

    // list
    atelier(home.path())
        .args(["project", "list"])
        .assert().success().stdout(contains("my-app"));

    // edit
    atelier(home.path())
        .args(["project", "edit", "my-app", "--description", "설명입니다"])
        .assert().success();
    atelier(home.path())
        .args(["project", "show", "my-app", "--json"])
        .assert().success().stdout(contains("설명입니다"));

    // remove: non-tty에서 --yes 없으면 실패(1)
    atelier(home.path())
        .args(["project", "remove", "my-app"])
        .assert().code(1);
    atelier(home.path())
        .args(["project", "remove", "my-app", "--yes"])
        .assert().success();
    atelier(home.path())
        .args(["project", "list", "--json"])
        .assert().success().stdout(contains("[]"));
}

#[test]
fn not_found_exits_2() {
    let home = tempfile::tempdir().unwrap();
    atelier(home.path()).args(["project", "show", "nope"]).assert().code(2);
    atelier(home.path()).args(["project", "remove", "nope", "--yes"]).assert().code(2);
}

#[test]
fn edit_without_flags_errors() {
    let home = tempfile::tempdir().unwrap();
    let work = tempfile::tempdir().unwrap();
    let folder = work.path().join("x");
    std::fs::create_dir(&folder).unwrap();
    atelier(home.path()).args(["project", "add"]).arg(&folder).assert().success();
    atelier(home.path()).args(["project", "edit", "x"]).assert().code(1);
}

#[test]
fn add_missing_folder_exits_1() {
    let home = tempfile::tempdir().unwrap();
    atelier(home.path())
        .args(["project", "add", "/no/such/dir"])
        .assert().code(1);
}
