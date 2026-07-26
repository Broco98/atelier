use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use assert_cmd::cargo::CommandCargoExt;
use serde_json::{json, Value};

/// `atelier mcp`를 서브프로세스로 띄우고 JSON-RPC를 한 줄씩 주고받는 최소 클라이언트.
/// 호스트가 하는 일을 그대로 흉내 낸다.
struct Server {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Server {
    fn start(home: &std::path::Path) -> Self {
        let mut child = Command::cargo_bin("atelier")
            .unwrap()
            .arg("mcp")
            .env("ATELIER_HOME", home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut server = Server { child, stdin, stdout };

        // 프로토콜 버전은 클라이언트가 제안하는 값이고, 서버가 무엇으로 응답할지는
        // SDK가 정한다 (A5 — 코드에 상수를 박지 않는다). 문자열이기만 하면 통과.
        let init = server.request(
            1,
            "initialize",
            json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "atelier-test", "version": "0" }
            }),
        );
        assert!(
            init["result"]["protocolVersion"].is_string(),
            "handshake failed: {init}"
        );
        server.send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        server
    }

    fn send(&mut self, msg: &Value) {
        writeln!(self.stdin, "{msg}").unwrap();
        self.stdin.flush().unwrap();
    }

    /// 응답을 한 줄 읽는다. Δ13 — 읽히는 모든 줄은 JSON-RPC 메시지여야 한다.
    fn request(&mut self, id: u32, method: &str, params: Value) -> Value {
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        let mut line = String::new();
        let n = self.stdout.read_line(&mut line).unwrap();
        assert!(n > 0, "server closed stdout before answering {method}");
        let msg: Value = serde_json::from_str(&line)
            .unwrap_or_else(|e| panic!("stdout is not a JSON-RPC line ({e}): {line:?}"));
        assert_eq!(msg["jsonrpc"], "2.0", "stdout polluted: {line:?}");
        assert_eq!(msg["id"], id, "out-of-order reply: {line:?}");
        msg
    }

    fn tool_names(&mut self, id: u32) -> Vec<String> {
        let res = self.request(id, "tools/list", json!({}));
        res["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn run_git(dir: &std::path::Path, args: &[&str]) {
    let out = std::process::Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

fn run_git_out(dir: &std::path::Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// 프로젝트 n개가 등록된 홈. 각 프로젝트는 main에 커밋 하나가 있는 git 저장소다.
/// 반환한 TempDir 둘은 테스트 끝까지 살려 둬야 한다 (drop되면 폴더가 사라진다).
fn fixture_with(names: &[&str]) -> (tempfile::TempDir, tempfile::TempDir) {
    let home = tempfile::tempdir().unwrap();
    let code = tempfile::tempdir().unwrap();
    for name in names {
        let repo = code.path().join(name);
        std::fs::create_dir(&repo).unwrap();
        run_git(&repo, &["init", "-b", "main"]);
        run_git(&repo, &["config", "user.email", "t@t.t"]);
        run_git(&repo, &["config", "user.name", "t"]);
        std::fs::write(repo.join("a.txt"), "x").unwrap();
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "init"]);
        atelier_core::create_project(&home.path().join("projects"), &repo).unwrap();
    }
    (home, code)
}

fn fixture() -> (tempfile::TempDir, tempfile::TempDir) {
    fixture_with(&["billing"])
}

#[test]
fn handshake_succeeds_and_stdout_carries_only_protocol_messages() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    // 배너·로그가 한 줄이라도 표준출력에 섞였다면 request()의 JSON 파싱에서 터진다
    let res = server.request(2, "tools/list", json!({}));
    assert!(res["result"]["tools"].is_array(), "tools/list failed: {res}");
}

#[test]
fn list_projects_returns_registered_projects() {
    let home = tempfile::tempdir().unwrap();
    let code = tempfile::tempdir().unwrap();
    let folder = code.path().join("billing");
    std::fs::create_dir(&folder).unwrap();
    atelier_core::create_project(&home.path().join("projects"), &folder).unwrap();

    let mut server = Server::start(home.path());
    let res = server.request(3, "tools/call",
        json!({ "name": "atelier_list_projects", "arguments": {} }));
    assert_eq!(res["result"]["isError"], false, "{res}");

    // 결과는 JSON 텍스트 한 블록이다 (A1)
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    let views: Value = serde_json::from_str(text).unwrap();
    assert_eq!(views[0]["slug"], "billing");
    assert!(views[0]["baseBranch"].is_string(), "{text}");
}

#[test]
fn list_works_returns_every_work() {
    let (home, _code) = fixture();
    atelier_core::start_work(
        &home.path().join("works"),
        &home.path().join("projects"),
        "카트 아이템 추가",
        &["billing".to_string()],
        Some("feat/cart"),
    )
    .unwrap();

    let mut server = Server::start(home.path());
    let res = server.request(3, "tools/call",
        json!({ "name": "atelier_list_works", "arguments": {} }));
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    let views: Value = serde_json::from_str(text).unwrap();
    assert_eq!(views[0]["slug"], "카트-아이템-추가");
    assert_eq!(views[0]["branch"], "feat/cart");
    assert_eq!(views[0]["status"], "active");
}

#[test]
fn get_work_hands_over_the_spec_directory_to_write_into() {
    let (home, _code) = fixture();
    atelier_core::start_work(
        &home.path().join("works"),
        &home.path().join("projects"),
        "카트",
        &["billing".to_string()],
        Some("feat/cart"),
    )
    .unwrap();

    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "카트" } }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();

    // V5 — 이 응답 하나로 spec을 쓸 위치를 안다. 추측도, 다른 도구도 필요 없다.
    let spec_dir = view["specDir"].as_str().unwrap();
    let abs = atelier_core::expand_home(spec_dir);
    assert!(abs.is_dir(), "specDir does not exist: {spec_dir}");
    assert!(view["specFiles"].as_array().unwrap().is_empty());

    // Δ7 — 에이전트는 도구가 아니라 파일시스템으로 spec을 쓴다. 그 결과가 조회에 잡힌다.
    std::fs::write(abs.join("overview.md"), "# 개요\n").unwrap();
    let res = server.request(3, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "카트" } }));
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["specFiles"][0], "overview.md");
}

#[test]
fn unknown_work_is_an_execution_error_pointing_at_the_listing_tool() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "없는작업" } }));
    // 프로토콜 오류가 아니다 — 도구는 실행됐고 실패했다
    assert!(res["error"].is_null(), "must not be a protocol error: {res}");
    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("없는작업"), "{text}");
    assert!(text.contains("atelier_list_works"), "{text}");
}

/// V2 — 이 물결이 끝난 시점의 도구 표면 전체. 도구를 더할 때마다 여기가 자란다.
/// (티켓 03이 atelier_add_project·atelier_edit_project를 더해 9개로 채운다.)
#[test]
fn listed_tools_are_exactly_this_wave() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let mut names = server.tool_names(2);
    names.sort();
    assert_eq!(
        names,
        vec![
            "atelier_attach_project",
            "atelier_get_work",
            "atelier_list_projects",
            "atelier_list_works",
            "atelier_set_work_status",
            "atelier_start_work",
        ]
    );
}

/// 읽기 전용 계약을 지켜야 하는 도구들. 쓰기 도구는 단계 6에서 따로 본다.
const READ_ONLY_TOOLS: [&str; 3] =
    ["atelier_get_work", "atelier_list_projects", "atelier_list_works"];

#[test]
fn read_tools_declare_read_only_and_local_only() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));
    for tool in res["result"]["tools"].as_array().unwrap() {
        if !READ_ONLY_TOOLS.contains(&tool["name"].as_str().unwrap()) {
            continue;
        }
        let a = &tool["annotations"];
        assert_eq!(a["readOnlyHint"], true, "{tool}");
        assert_eq!(a["openWorldHint"], false, "{tool}");
    }
}

#[test]
fn start_work_creates_the_work_and_hands_back_where_to_write() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut server = Server::start(home.path());

    let res = server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트 아이템 추가", "projects": ["billing"], "branch": "feat/cart" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");

    let report: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(report["slug"], "카트-아이템-추가");
    assert_eq!(report["branch"], "feat/cart");
    assert_eq!(report["status"], "active");
    assert_eq!(report["errors"].as_array().unwrap().len(), 0, "{report}");

    // 워크트리 경로와 spec 위치가 응답 하나에 다 있다 — 추측할 것이 없다
    let tree = report["trees"][0].clone();
    assert_eq!(tree["project"], "billing");
    assert_eq!(tree["exists"], true, "{report}");
    assert!(atelier_core::expand_home(tree["path"].as_str().unwrap()).is_dir());
    assert!(atelier_core::expand_home(report["specDir"].as_str().unwrap()).is_dir());
}

/// V11 — 같은 인자로 다시 불러도 중복 생성 없이 빠진 것만 만들어진다.
#[test]
fn start_work_repeated_adds_only_what_is_missing() {
    let (home, _code) = fixture_with(&["billing", "shipping"]);
    let mut server = Server::start(home.path());
    let args = |projects: Value| json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": projects, "branch": "feat/cart" }
    });

    let first = server.request(3, "tools/call", args(json!(["billing"])));
    assert_eq!(first["result"]["isError"], false, "{first}");

    // 프로젝트를 하나 더해 재호출 → 새 작업이 아니라 같은 작업에 이어 붙는다
    let second = server.request(4, "tools/call", args(json!(["billing", "shipping"])));
    assert_eq!(second["result"]["isError"], false, "{second}");
    let report: Value =
        serde_json::from_str(second["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(report["slug"], "카트", "must resume, not fork a new work: {report}");
    assert_eq!(report["projects"], json!(["billing", "shipping"]));
    for t in report["trees"].as_array().unwrap() {
        assert_eq!(t["exists"], true, "{report}");
    }
    assert!(!home.path().join("works/카트-2").exists(), "duplicate work created");
}

/// 워크트리 생성이 실패하도록 만든다: 워크트리가 놓일 자리에 파일을 미리 둔다.
/// (사전검증은 프로젝트 등록·git·baseBranch만 보므로 통과하고, git worktree add가
///  "fatal: '<path>' already exists"로 실패한다 — 실제로 실행해 확인한 동작이다.)
fn block_worktree(home: &std::path::Path, work_slug: &str, project: &str) -> std::path::PathBuf {
    let path = home.join("works").join(work_slug).join("trees").join(project);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "blocker").unwrap();
    path
}

/// V10 (앞쪽) — 부분 실패는 성공이 아니라 실행 오류로 오고,
/// 본문이 성공분·실패 원인·좁은 복구 경로를 전부 준다.
#[test]
fn partial_worktree_failure_is_an_execution_error_pointing_at_attach() {
    let (home, _code) = fixture_with(&["billing", "shipping"]);
    let mut server = Server::start(home.path());

    // billing 하나로 작업을 만든 뒤, shipping 워크트리 자리를 막고 이어서 시작한다
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing"], "branch": "feat/cart" }
    }));
    block_worktree(home.path(), "카트", "shipping");

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing", "shipping"], "branch": "feat/cart" }
    }));

    // 프로토콜 오류가 아니다 — 도구는 실행됐고 일부가 실패했다
    assert!(res["error"].is_null(), "must not be a protocol error: {res}");
    assert_eq!(res["result"]["isError"], true, "partial failure reported as success: {res}");

    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("shipping"), "failed project not named: {text}");
    assert!(text.contains("already exists"), "failure cause not shown: {text}");
    assert!(text.contains("billing"), "successful worktree not shown: {text}");
    // 복구는 실패한 것만 붙이는 좁은 경로다 (D5)
    assert!(text.contains("atelier_attach_project"), "no recovery path: {text}");
    assert!(
        !text.contains("call atelier_start_work again"),
        "must not send the agent back through the whole call: {text}"
    );

    // 두 번째 블록은 보고서 전문 — 성공분과 specDir이 살아 있다
    let report: Value =
        serde_json::from_str(res["result"]["content"][1]["text"].as_str().unwrap()).unwrap();
    assert_eq!(report["errors"][0]["project"], "shipping");
    assert_eq!(report["trees"][0]["exists"], true, "{report}");   // billing
    assert_eq!(report["trees"][1]["exists"], false, "{report}");  // shipping
    assert!(atelier_core::expand_home(report["specDir"].as_str().unwrap()).is_dir());
}

/// V10 — 부분 실패에서 안내받은 대로 실패한 프로젝트만 붙여 복구한다.
#[test]
fn attach_project_recovers_the_failed_worktree_alone() {
    let (home, _code) = fixture_with(&["billing", "shipping"]);
    let mut server = Server::start(home.path());

    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing"], "branch": "feat/cart" }
    }));
    let blocker = block_worktree(home.path(), "카트", "shipping");
    let failed = server.request(4, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing", "shipping"], "branch": "feat/cart" }
    }));
    assert_eq!(failed["result"]["isError"], true, "{failed}");

    // 원인 제거 후, 안내받은 그 호출 하나만 한다
    std::fs::remove_file(&blocker).unwrap();
    let res = server.request(5, "tools/call", json!({
        "name": "atelier_attach_project",
        "arguments": { "work_slug": "카트", "project_slug": "shipping" }
    }));
    assert_eq!(res["result"]["isError"], false, "recovery failed: {res}");

    let report: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(report["errors"].as_array().unwrap().len(), 0, "{report}");
    // 중복 없이 두 프로젝트, 두 워크트리 다 살아 있다
    assert_eq!(report["projects"], json!(["billing", "shipping"]));
    for t in report["trees"].as_array().unwrap() {
        assert_eq!(t["exists"], true, "{report}");
        let tree = atelier_core::expand_home(t["path"].as_str().unwrap());
        assert_eq!(run_git_out(&tree, &["branch", "--show-current"]), "feat/cart");
    }
}

/// attach도 같은 부분 실패 계약을 따른다 (Δ12는 두 도구 공통이다).
#[test]
fn attach_project_reports_its_own_worktree_failure_as_an_error() {
    let (home, _code) = fixture_with(&["billing", "shipping"]);
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing"], "branch": "feat/cart" }
    }));
    block_worktree(home.path(), "카트", "shipping");

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_attach_project",
        "arguments": { "work_slug": "카트", "project_slug": "shipping" }
    }));
    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("shipping"), "{text}");
    assert!(text.contains("atelier_attach_project"), "{text}");
}

/// 미등록 프로젝트는 커널의 **사전검증**에서 걸린다 — 워크트리는 하나도 건드리지 않으므로
/// 부분 실패가 아니라 그냥 실행 오류다.
///
/// 단언은 §2 오류 매핑표를 따른다: `attach_project`는 `get_project`의 `NotFound`를
/// `Validation("<slug>: project not registered")`로 눌러 감싸므로(`works.rs:267`),
/// `kernel_error`가 붙이는 안내는 `atelier_list_projects`가 **아니라**
/// `"Fix the arguments and call this tool again."`이다 (⚠️ G2 — 표에 기록된 안내 없는 경로).
#[test]
fn attach_unknown_project_is_an_execution_error() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing"], "branch": "feat/cart" }
    }));
    let res = server.request(4, "tools/call", json!({
        "name": "atelier_attach_project",
        "arguments": { "work_slug": "카트", "project_slug": "없는프로젝트" }
    }));
    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("없는프로젝트"), "the failing input must appear: {text}");
    assert!(text.contains("project not registered"), "cause not shown: {text}");
    assert!(text.contains("Fix the arguments"), "no next step: {text}");

    // 작업은 그대로다 — 사전검증 실패는 아무것도 바꾸지 않는다
    let got = server.request(5, "tools/call", json!({
        "name": "atelier_get_work", "arguments": { "work_slug": "카트" }
    }));
    let view: Value =
        serde_json::from_str(got["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["projects"], json!(["billing"]), "{view}");
}

#[test]
fn set_work_status_persists_and_rejects_unknown_values() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing"], "branch": "feat/cart" }
    }));

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_set_work_status",
        "arguments": { "work_slug": "카트", "status": "review" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["status"], "review");

    // 조회로도 보인다 (파일에 남았다)
    let got = server.request(5, "tools/call", json!({
        "name": "atelier_get_work", "arguments": { "work_slug": "카트" }
    }));
    let view: Value =
        serde_json::from_str(got["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["status"], "review");

    // 잘못된 값은 실행 오류이고, 유효한 값이 메시지에 들어 있다
    let bad = server.request(6, "tools/call", json!({
        "name": "atelier_set_work_status",
        "arguments": { "work_slug": "카트", "status": "paused" }
    }));
    assert_eq!(bad["result"]["isError"], true, "{bad}");
    let text = bad["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("active"), "valid values not listed: {text}");
    assert!(text.contains("done"), "{text}");
}
