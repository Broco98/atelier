use assert_cmd::Command;

/// V7 — 진입점에 데이터를 만지는 명령이 하나도 없다 (graph-plan Δ8 · Δ9).
/// 프로젝트·작업 조작은 MCP 도구 9개가, 사람용 조작은 데스크톱 앱이 맡는다.
/// 편의를 이유로 CLI 명령이 되살아나면 여기서 걸린다.
#[test]
fn the_entry_point_exposes_no_data_commands() {
    let assert = Command::cargo_bin("atelier").unwrap().arg("--help").assert().success();
    let help = String::from_utf8(assert.get_output().stdout.clone()).unwrap();

    for gone in ["project", "work", "skill"] {
        assert!(
            !help.contains(gone),
            "data command survived in the entry point: {gone}\n{help}"
        );
    }
    assert!(help.contains("mcp"), "server command must remain: {help}");
}

/// V13 — 프로젝트 삭제는 앱이 유일한 경로다 (graph-plan D7 · Δ16).
/// 도구 표면 쪽 절반은 tests/mcp_server.rs의
/// the_tool_surface_has_no_way_to_delete_a_project 가 지킨다. 이건 나머지 절반이다.
#[test]
fn the_entry_point_cannot_delete_a_project() {
    let assert = Command::cargo_bin("atelier")
        .unwrap()
        .args(["project", "remove", "billing", "--yes"])
        .assert()
        .failure();
    let stderr = String::from_utf8(assert.get_output().stderr.clone()).unwrap();
    assert!(
        stderr.contains("unrecognized") || stderr.contains("subcommand"),
        "clap must reject 'project' as an unknown subcommand, \
         not fail for some other reason: {stderr}"
    );
}
