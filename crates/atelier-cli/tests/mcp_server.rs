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
    /// initialize 응답 전문. 호스트가 시스템 프롬프트를 만들 때 보는 것과 같은 값이다.
    init: Value,
}

/// 서버를 띄우는 명령 한 벌. **`Server::start`와 기동 실패를 보는 helper가 같은 것을
/// 써야 한다** — 격리 env(홈·스킬 루트)가 한쪽에만 있으면 그쪽 검사가 개발자의 실제
/// `~/.atelier`나 `~/.claude/skills`를 건드린다.
fn spawn_command(home: &std::path::Path, mode: Option<&str>) -> Command {
    let mut cmd = Command::cargo_bin("atelier").unwrap();
    cmd.arg("mcp")
        .env("ATELIER_HOME", home)
        // 기동 시 정리(Δ11)가 개발자의 실제 ~/.claude/skills 를 건드리지 않게 한다.
        .env("ATELIER_SKILLS_DIR", home.join("skills-guard"));
    // **없음과 빈 값은 다르다** — 안 주는 것은 `env`를 아예 안 부르는 것이다.
    // `.env(name, "")`으로 흉내 내면 서버가 그것을 모르는 값으로 거절한다.
    match mode {
        Some(mode) => cmd.env("ATELIER_MODE", mode),
        None => cmd.env_remove("ATELIER_MODE"),
    };
    cmd
}

/// **핸드셰이크 전에 죽는 것**을 보는 자리. `Server::start`는 initialize 응답을 기다리므로
/// 뜨지 않는 서버를 못 잰다 — 여기서는 프로세스가 끝나기를 기다려 종료 코드와 두 스트림을
/// 통째로 본다.
///
/// 표준입력을 파이프로 열지 않는다: 규칙이 무너져 서버가 정상 기동해 버리면 즉시 EOF를
/// 읽고 **0으로** 끝나므로, 매달리지 않고 종료 코드에서 빨개진다.
fn spawn_expecting_startup_failure(
    home: &std::path::Path,
    mode: &str,
) -> (std::process::ExitStatus, String, String) {
    let out = spawn_command(home, Some(mode))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
        .wait_with_output()
        .unwrap();
    (
        out.status,
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

impl Server {
    fn start(home: &std::path::Path) -> Self {
        Self::start_with_mode(home, None)
    }

    /// `mode`가 `None`이면 `ATELIER_MODE`를 **안 준다** — 앱 밖 셸에서 뜬 기존 MCP와 같은
    /// 상태다. 이 파일의 나머지 검사 전부가 그 상태로 돌아, 「값이 없으면 지금과 한 글자도
    /// 안 다르다」가 새 검사 하나가 아니라 기존 검사 전부로 붙들린다.
    fn start_with_mode(home: &std::path::Path, mode: Option<&str>) -> Self {
        let mut child = spawn_command(home, mode)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut server = Server { child, stdin, stdout, init: Value::Null };

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
        server.init = init;
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

/// "work는 프로젝트 하나 이상"이라는 정의가 지침·start_work·list_works 세 곳에
/// 복제돼 있다. 실제로 지침만 고치고 도구 설명 둘을 놔둔 적이 있는데, start_work는
/// 한 설명 안에서 "one or more projects"라고 해놓고 세 문장 뒤에 "projects는 생략
/// 가능"이라고 말하는 자기모순이었다. 에이전트는 지침보다 도구 설명을 더 자주 읽으니
/// 여기서 어긋나면 지침을 고친 의미가 없다 — 셋을 한 줄로 묶는다.
#[test]
fn no_tool_description_denies_the_project_less_path() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));
    for tool in res["result"]["tools"].as_array().unwrap() {
        let description = tool["description"].as_str().unwrap_or("");
        assert!(
            !description.contains("one or more projects"),
            "{} still says a work needs at least one project",
            tool["name"]
        );
    }
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
        &home.path().join("archive"),
        Some(&home.path().join("projects")),
        "카트 아이템 추가",
        None,
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
        &home.path().join("archive"),
        Some(&home.path().join("projects")),
        "카트",
        None,
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

/// 조회는 문서를 쓰기 **직전**에 일어난다 — spec 폴더 관습이 실려 오는 자리가 여기다.
/// 항상 상주하는 초기화 지침이 아니라 이 응답이 들고 간다.
#[test]
fn get_work_explains_what_the_spec_folder_names_mean() {
    let (home, _code) = fixture();
    atelier_core::start_work(
        &home.path().join("works"),
        &home.path().join("archive"),
        Some(&home.path().join("projects")),
        "카트",
        None,
        &["billing".to_string()],
        Some("feat/cart"),
    )
    .unwrap();

    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "카트" } }));
    assert_eq!(res["result"]["isError"], false, "{res}");

    // 기계가 읽는 JSON이 먼저고, 안내는 그 뒤 텍스트 블록이다
    let content = res["result"]["content"].as_array().unwrap();
    let view: Value = serde_json::from_str(content[0]["text"].as_str().unwrap()).unwrap();
    assert!(view["specDir"].is_string(), "{view}");

    let guidance = content
        .get(1)
        .and_then(|c| c["text"].as_str())
        .unwrap_or_else(|| panic!("no spec layout guidance in the answer: {res}"));
    for name in ["overview.md", "NN-", "tickets/", "research/", "explanation/"] {
        assert!(guidance.contains(name), "'{name}' missing from the guidance: {guidance}");
    }
    // 고정하는 것은 폴더 이름뿐이라는 것과, 첫 판을 어디서 시작하는지
    assert!(guidance.contains("file names are free"), "{guidance}");
    assert!(guidance.contains("01-"), "the first iteration folder is not named: {guidance}");

    // 관습은 데이터 모델이 아니다 — 커널이 준 뷰에는 한 글자도 실리지 않는다
    let kernel = atelier_core::get_work(&home.path().join("works"), "카트").unwrap();
    let kernel_json = serde_json::to_string(&kernel).unwrap();
    for leaked in ["Five folder names", "explanation"] {
        assert!(
            !kernel_json.contains(leaked),
            "the folder convention leaked into the kernel view: {kernel_json}"
        );
    }
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
/// (티켓 03이 atelier_add_project·atelier_edit_project를 더해 9개로 채웠고,
///  #23이 atelier_edit_work를 더해 10개, #68이 atelier_archive_work를 더해 11개,
///  #69가 atelier_list_archive를 더해 12개가 됐다.)
#[test]
fn listed_tools_are_exactly_this_wave() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let mut names = server.tool_names(2);
    names.sort();
    assert_eq!(
        names,
        vec![
            "atelier_add_project",
            "atelier_archive_work",
            "atelier_attach_project",
            "atelier_edit_project",
            "atelier_edit_work",
            "atelier_get_work",
            "atelier_list_archive",
            "atelier_list_projects",
            "atelier_list_works",
            "atelier_remove_work",
            "atelier_set_work_status",
            "atelier_start_work",
        ]
    );
}

/// 읽기 전용 계약을 지켜야 하는 도구들. 쓰기 도구는 단계 6에서 따로 본다.
const READ_ONLY_TOOLS: [&str; 4] =
    ["atelier_get_work", "atelier_list_archive", "atelier_list_projects", "atelier_list_works"];

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
    let worktree = report["worktrees"][0].clone();
    assert_eq!(worktree["project"], "billing");
    assert_eq!(worktree["exists"], true, "{report}");
    assert!(atelier_core::expand_home(worktree["path"].as_str().unwrap()).is_dir());
    assert!(atelier_core::expand_home(report["specDir"].as_str().unwrap()).is_dir());
}

/// 문턱 낮추기 — 아이디어 한 줄에도 갈 곳이 생긴다. `projects` 없이 부르면
/// 워크트리도, 빈 `trees/`도, 쓰지도 않을 브랜치도 만들지 않는다.
#[test]
fn start_work_without_projects_creates_no_worktree_and_no_branch() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());

    let res = server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "언젠가 해볼 것" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let report: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(report["slug"], "언젠가-해볼-것");
    assert!(report["branch"].is_null(), "an unused branch must not be invented: {report}");
    assert!(report["worktrees"].as_array().unwrap().is_empty(), "{report}");
    // spec을 쓸 자리는 그대로 내려온다 — 문서부터 쓰는 것이 이 경로의 목적이다
    assert!(atelier_core::expand_home(report["specDir"].as_str().unwrap()).is_dir());
    assert!(
        !home.path().join("works/언젠가-해볼-것/trees").exists(),
        "an empty trees/ reads as a broken worktree"
    );

    // 조회도 같은 모양이다 — 키 유무가 아니라 값(null)으로 판단하게 한다
    let got = server.request(4, "tools/call", json!({
        "name": "atelier_get_work", "arguments": { "work_slug": "언젠가-해볼-것" }
    }));
    let view: Value =
        serde_json::from_str(got["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(view["branch"].is_null(), "{view}");
    assert!(view["worktrees"].as_array().unwrap().is_empty(), "{view}");

    // 도구 표면에도 드러나야 에이전트가 이 경로를 고를 수 있다
    let tools = server.request(5, "tools/list", json!({}));
    let tool = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "atelier_start_work")
        .expect("atelier_start_work missing");
    let required = tool["inputSchema"]["required"].as_array().unwrap();
    assert!(required.iter().any(|r| r == "title"), "{tool}");
    assert!(!required.iter().any(|r| r == "projects"), "projects must be optional: {tool}");
    assert!(
        tool["description"].as_str().unwrap().contains("no worktree and no branch"),
        "the no-project path is undocumented: {tool}"
    );
}

/// 워크트리 목록의 이름은 `worktrees`다. 옛 이름 `trees`는 파일 트리와 구별되지 않아
/// 매번 문맥으로 추측하게 만들었다 — **함께 내보내지 않는다.** 두 키가 같이 있으면
/// 어느 쪽이 정본인지 에이전트가 알 수 없다.
#[test]
fn every_response_names_the_worktree_list_worktrees_and_never_trees() {
    let (home, _code) = fixture_with(&["billing", "shipping"]);
    let mut server = Server::start(home.path());

    let read = |res: &Value| -> Value {
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
    };

    let started = read(&server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing"], "branch": "feat/cart" }
    })));
    let attached = read(&server.request(4, "tools/call", json!({
        "name": "atelier_attach_project",
        "arguments": { "work_slug": "카트", "project_slug": "shipping" }
    })));
    let got = read(&server.request(5, "tools/call", json!({
        "name": "atelier_get_work", "arguments": { "work_slug": "카트" }
    })));
    let listed = read(&server.request(6, "tools/call",
        json!({ "name": "atelier_list_works", "arguments": {} })));

    for (name, view) in
        [("start", &started), ("attach", &attached), ("get", &got), ("list", &listed[0])]
    {
        assert!(view["worktrees"].is_array(), "{name} has no worktrees[]: {view}");
        assert!(view["trees"].is_null(), "{name} still emits the old trees[] key: {view}");
        assert_eq!(view["worktrees"][0]["project"], "billing", "{view}");
    }

    // 필드 이름만 바뀐다 — 폴더는 여전히 trees/ 이고, 기존 Work가 그대로 열려야 한다
    let path = got["worktrees"][0]["path"].as_str().unwrap();
    assert!(path.contains("/trees/"), "the on-disk folder must not move: {path}");
    assert!(atelier_core::expand_home(path).is_dir(), "{path}");
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
    for t in report["worktrees"].as_array().unwrap() {
        assert_eq!(t["exists"], true, "{report}");
    }
    assert!(!home.path().join("works/카트-2").exists(), "duplicate work created");
}

/// slug 파생 규칙이 유니코드를 그대로 남기므로 한국어 제목은 한국어 폴더와, 브랜치를
/// 생략하면 한국어 브랜치까지 만든다. 영어 slug를 직접 줘서 사람이 읽는 이름과
/// 기계가 쓰는 이름을 갈라 놓는다.
#[test]
fn start_work_takes_an_english_slug_for_the_folder_and_the_default_branch() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut server = Server::start(home.path());

    // branch를 주지 않는다 — 기본값이 제목이 아니라 slug에서 오는지 보는 것이 요점이다
    let res = server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트 아이템 추가", "slug": "cart-add-item", "projects": ["billing"] }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let report: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();

    assert_eq!(report["slug"], "cart-add-item", "the given slug must win: {report}");
    assert_eq!(report["title"], "카트 아이템 추가", "title stays in the user's language");
    assert_eq!(report["branch"], "cart-add-item", "branch defaults to the slug: {report}");

    // 폴더도 그 slug다 — 한국어 폴더가 생기지 않는다
    assert!(home.path().join("works/cart-add-item").is_dir());
    assert!(!home.path().join("works/카트-아이템-추가").exists());

    let worktree = atelier_core::expand_home(report["worktrees"][0]["path"].as_str().unwrap());
    assert_eq!(run_git_out(&worktree, &["branch", "--show-current"]), "cart-add-item");
}

/// 재개의 정본은 slug다. 제목은 바뀔 수 있으므로 멱등 키가 될 수 없고, slug는 불변이라
/// 될 수 있다. 그리고 재개가 **호출자의 제목으로 기존 제목을 덮어쓰지 않는다** —
/// 사용자가 다듬어 둔 이름을 에이전트가 되돌리면 안 된다.
#[test]
fn start_work_resumes_on_the_slug_and_never_clobbers_the_stored_title() {
    let (home, _code) = fixture_with(&["billing", "shipping"]);
    let mut server = Server::start(home.path());

    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": {
            "title": "카트 아이템 추가", "slug": "cart-add-item",
            "projects": ["billing"], "branch": "feat/cart"
        }
    }));

    // 같은 slug, 다른 제목으로 재호출 — 새 작업이 아니라 재개다
    let res = server.request(4, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": {
            "title": "전혀 다른 제목", "slug": "cart-add-item",
            "projects": ["billing", "shipping"], "branch": "feat/cart"
        }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let report: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();

    assert_eq!(report["slug"], "cart-add-item", "must resume, not fork: {report}");
    assert_eq!(report["title"], "카트 아이템 추가", "resume overwrote the stored title: {report}");
    assert_eq!(report["projects"], json!(["billing", "shipping"]));
    // 명시된 slug는 충돌이 아니라 재개다 — 중복 회피 접미사가 붙지 않는다
    assert!(!home.path().join("works/cart-add-item-2").exists(), "duplicate work created");
    assert!(!home.path().join("works/전혀-다른-제목").exists(), "duplicate work created");
}

/// slug는 디렉터리명이 된다. 경로 구분자가 통과하면 데이터 루트 밖에 폴더가 생긴다.
#[test]
fn start_work_refuses_a_slug_that_could_escape_the_data_root() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut server = Server::start(home.path());

    for bad in ["../탈출", "a/b", ".hidden", "   "] {
        let res = server.request(3, "tools/call", json!({
            "name": "atelier_start_work",
            "arguments": { "title": "카트", "slug": bad, "projects": ["billing"] }
        }));
        assert!(res["error"].is_null(), "must not be a protocol error: {res}");
        assert_eq!(res["result"]["isError"], true, "slug '{bad}' was accepted: {res}");
        let text = res["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("slug"), "must name the failing input: {text}");
        assert!(text.contains("again"), "no next step: {text}");
    }
    // 거부된 호출은 아무것도 만들지 않는다
    let listed = server.request(4, "tools/call",
        json!({ "name": "atelier_list_works", "arguments": {} }));
    let listed: Value =
        serde_json::from_str(listed["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(listed.as_array().unwrap().is_empty(), "{listed}");
}

/// slug와 branch는 둘 다 브랜치 이름이 된다. 경로로는 멀쩡해도 git이 ref로 거부하는
/// 이름이 통과하면, work.json과 spec 디렉터리만 남고 워크트리 생성만 실패하는 반쪽이 착지한다.
#[test]
fn start_work_refuses_a_branch_name_git_will_not_accept() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut server = Server::start(home.path());

    for bad in ["cart add", "cart.lock", "cart~1", "cart..v2"] {
        // slug에서 파생된 브랜치와 직접 넘긴 브랜치가 같은 문을 지난다
        for arguments in [
            json!({ "title": "카트", "slug": bad, "projects": ["billing"] }),
            json!({ "title": "카트", "branch": bad, "projects": ["billing"] }),
        ] {
            let res = server.request(3, "tools/call",
                json!({ "name": "atelier_start_work", "arguments": arguments }));
            assert!(res["error"].is_null(), "must not be a protocol error: {res}");
            assert_eq!(res["result"]["isError"], true, "'{bad}' was accepted: {res}");
            let text = res["result"]["content"][0]["text"].as_str().unwrap();
            assert!(text.contains("branch name"), "must name what git refused: {text}");
        }
    }
    // 거부된 호출은 반쪽짜리 work를 남기지 않는다
    let listed = server.request(4, "tools/call",
        json!({ "name": "atelier_list_works", "arguments": {} }));
    let listed: Value =
        serde_json::from_str(listed["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(listed.as_array().unwrap().is_empty(), "{listed}");
}

/// 에이전트는 스키마를 보고 "안 줘도 된다"를 판단한다 — edit_project와 같은 계약이다.
#[test]
fn start_work_schema_shows_slug_and_branch_are_optional() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));
    let tool = res["result"]["tools"].as_array().unwrap().iter()
        .find(|t| t["name"] == "atelier_start_work")
        .unwrap_or_else(|| panic!("tool not listed: {res}"));

    let mut required: Vec<&str> = tool["inputSchema"]["required"].as_array().unwrap()
        .iter().map(|v| v.as_str().unwrap()).collect();
    required.sort();
    // `projects`가 여기 없는 것은 문턱 낮추기의 결정이다 — 그 계약은
    // start_work_without_projects_creates_no_worktree_and_no_branch가 지킨다.
    assert_eq!(required, vec!["title"], "{tool}");
    assert!(!tool["inputSchema"]["properties"]["slug"].is_null(), "no slug property: {tool}");
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
    assert_eq!(report["worktrees"][0]["exists"], true, "{report}");   // billing
    assert_eq!(report["worktrees"][1]["exists"], false, "{report}");  // shipping
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
    for t in report["worktrees"].as_array().unwrap() {
        assert_eq!(t["exists"], true, "{report}");
        let worktree = atelier_core::expand_home(t["path"].as_str().unwrap());
        assert_eq!(run_git_out(&worktree, &["branch", "--show-current"]), "feat/cart");
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

/// draft → active 경로의 마지막 한 칸 — 프로젝트를 붙이는 그 호출에서 브랜치가
/// 정해진다. 상태는 선언된 것이므로 붙였다고 저절로 바뀌지 않는다.
#[test]
fn attach_project_fixes_the_branch_of_a_work_that_had_none() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work", "arguments": { "title": "빈손으로 시작" }
    }));
    server.request(4, "tools/call", json!({
        "name": "atelier_set_work_status",
        "arguments": { "work_slug": "빈손으로-시작", "status": "draft" }
    }));

    let res = server.request(5, "tools/call", json!({
        "name": "atelier_attach_project",
        "arguments": {
            "work_slug": "빈손으로-시작", "project_slug": "billing", "branch": "feat/late"
        }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let report: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(report["branch"], "feat/late", "{report}");
    assert_eq!(report["worktrees"][0]["exists"], true, "{report}");
    assert_eq!(report["status"], "draft", "attaching must not declare progress: {report}");

    // 한 work는 브랜치 하나를 공유한다 — 다른 이름은 거부되고 저장된 값이 그대로다
    let bad = server.request(6, "tools/call", json!({
        "name": "atelier_attach_project",
        "arguments": {
            "work_slug": "빈손으로-시작", "project_slug": "billing", "branch": "feat/other"
        }
    }));
    assert_eq!(bad["result"]["isError"], true, "{bad}");
    let text = bad["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("feat/late"), "the branch it already uses must appear: {text}");

    // 도구 표면에 드러나야 에이전트가 이름을 고를 기회를 잡는다
    let tools = server.request(7, "tools/list", json!({}));
    let tool = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "atelier_attach_project")
        .expect("atelier_attach_project missing");
    assert!(tool["inputSchema"]["properties"]["branch"].is_object(), "{tool}");
    let required = tool["inputSchema"]["required"].as_array().unwrap();
    assert!(!required.iter().any(|r| r == "branch"), "branch must be optional: {tool}");
    assert!(
        tool["description"].as_str().unwrap().contains("this is where the branch is decided"),
        "the deciding moment is undocumented: {tool}"
    );
}

/// 미등록 프로젝트는 커널의 **사전검증**에서 걸린다 — 워크트리는 하나도 건드리지 않으므로
/// 부분 실패가 아니라 그냥 실행 오류다.
///
/// 단언은 §2 오류 매핑표를 따른다: `attach_project`는 `get_project`의 `NotFound`를
/// `Validation("<slug>: project not registered")`로 눌러 감싸므로(works.rs의 attach_project),
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
    for valid in ["draft", "active", "review", "done"] {
        assert!(text.contains(valid), "valid value '{valid}' not listed: {text}");
    }
}

/// "일단 적어만 둬"를 그대로 표현할 수 있어야 한다. 상태는 **선언**이므로
/// 프로젝트가 붙어 있어도 draft일 수 있고, 워크트리는 그대로 남는다.
#[test]
fn set_work_status_accepts_draft_and_leaves_everything_else_alone() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "언젠가 할 것", "projects": ["billing"], "branch": "feat/someday" }
    }));

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_set_work_status",
        "arguments": { "work_slug": "언젠가-할-것", "status": "draft" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["status"], "draft");
    assert_eq!(view["branch"], "feat/someday", "draft must not touch the branch: {view}");
    assert_eq!(view["worktrees"][0]["exists"], true, "draft must not touch the worktrees: {view}");

    // 네 상태의 뜻이 도구 설명에 적혀 있어야 에이전트가 draft를 고를 수 있다
    let tools = server.request(5, "tools/list", json!({}));
    let tool = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "atelier_set_work_status")
        .expect("atelier_set_work_status missing");
    let described = format!("{} {}", tool["description"], tool["inputSchema"]);
    for status in ["draft", "active", "review", "done"] {
        assert!(described.contains(status), "'{status}' undocumented: {described}");
    }
}

/// 이 기능의 핵심 불변식 — **제목을 바꿔도 slug와 워크트리 경로는 그대로다.**
/// 사용자가 열어 둔 터미널·에디터 탭, 다른 문서에 박힌 spec 참조가 전부 살아 있어야 한다.
#[test]
fn edit_work_renames_the_title_and_moves_nothing_else() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut server = Server::start(home.path());

    let before: Value = serde_json::from_str(server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": {
            "title": "카트", "slug": "cart-add-item",
            "projects": ["billing"], "branch": "feat/cart"
        }
    }))["result"]["content"][0]["text"].as_str().unwrap()).unwrap();

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_edit_work",
        "arguments": { "work_slug": "cart-add-item", "title": "  카트 아이템 추가  " }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let after: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();

    assert_eq!(after["title"], "카트 아이템 추가", "앞뒤 공백은 잘라낸다: {after}");
    assert_eq!(after["slug"], before["slug"], "slug must never move");
    assert_eq!(after["branch"], before["branch"], "branch must not follow the title");
    assert_eq!(after["status"], before["status"], "status must not follow the title");
    assert_eq!(after["worktrees"], before["worktrees"], "worktree paths must not move");
    assert_eq!(after["specDir"], before["specDir"], "spec references must stay valid");

    // 파일에 남았고, 그 워크트리에서 git이 그대로 동작한다
    let got: Value = serde_json::from_str(server.request(5, "tools/call", json!({
        "name": "atelier_get_work", "arguments": { "work_slug": "cart-add-item" }
    }))["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(got["title"], "카트 아이템 추가");
    let worktree = atelier_core::expand_home(got["worktrees"][0]["path"].as_str().unwrap());
    assert_eq!(run_git_out(&worktree, &["branch", "--show-current"]), "feat/cart");
}

/// #22와 #23이 맞물리는 지점 — 제목이 바뀐 **뒤에도** slug로 재개된다.
/// 이것이 성립하지 않으면 이름을 바꾸는 순간 중복 작업과 중복 워크트리가 생긴다.
#[test]
fn start_work_still_resumes_by_slug_after_the_title_was_edited() {
    let (home, _code) = fixture_with(&["billing", "shipping"]);
    let mut server = Server::start(home.path());

    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": {
            "title": "카트", "slug": "cart-add-item",
            "projects": ["billing"], "branch": "feat/cart"
        }
    }));
    server.request(4, "tools/call", json!({
        "name": "atelier_edit_work",
        "arguments": { "work_slug": "cart-add-item", "title": "사용자가 다듬은 이름" }
    }));

    // 옛 제목을 그대로 들고 재호출해도 slug가 맞으면 재개다
    let res = server.request(5, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": {
            "title": "카트", "slug": "cart-add-item",
            "projects": ["billing", "shipping"], "branch": "feat/cart"
        }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let report: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();

    assert_eq!(report["slug"], "cart-add-item", "renaming broke resume: {report}");
    assert_eq!(report["title"], "사용자가 다듬은 이름", "resume undid the user's edit: {report}");
    assert_eq!(report["projects"], json!(["billing", "shipping"]));
    assert!(!home.path().join("works/카트").exists(), "duplicate work created");
}

/// 프로젝트의 빈 이름 거부와 같은 계약 — 거부되고 기존 값이 살아 있다.
#[test]
fn edit_work_blank_title_is_rejected_and_keeps_the_old_one() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_edit_work", "arguments": { "work_slug": "cart", "title": "   " }
    }));
    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("empty"), "{text}");
    assert!(text.contains("again"), "no next step: {text}");

    let got: Value = serde_json::from_str(server.request(5, "tools/call", json!({
        "name": "atelier_get_work", "arguments": { "work_slug": "cart" }
    }))["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(got["title"], "카트", "failed edit must not change anything: {got}");
}

#[test]
fn edit_unknown_work_points_at_the_listing_tool() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/call", json!({
        "name": "atelier_edit_work", "arguments": { "work_slug": "없는작업", "title": "x" }
    }));
    assert!(res["error"].is_null(), "must not be a protocol error: {res}");
    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("없는작업"), "{text}");
    assert!(text.contains("atelier_list_works"), "no next step: {text}");
}

/// 이 도구는 제목과 고정만 받는다. status는 atelier_set_work_status가 담당하고, branch는
/// 워크트리가 체크아웃해 둔 값이라 메타데이터만 바꾸면 실제 상태와 어긋난다.
#[test]
fn edit_work_takes_only_the_slug_the_title_and_the_pin() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));
    let tool = res["result"]["tools"].as_array().unwrap().iter()
        .find(|t| t["name"] == "atelier_edit_work")
        .unwrap_or_else(|| panic!("tool not listed: {res}"));

    let props = tool["inputSchema"]["properties"].as_object().unwrap();
    assert_eq!(props.len(), 3, "only work_slug, title and pinned are inputs: {tool}");
    for field in ["work_slug", "title", "pinned"] {
        assert!(props.contains_key(field), "missing property {field}: {tool}");
    }
    for field in ["status", "branch", "slug", "projects"] {
        assert!(!props.contains_key(field), "{field} must not be editable here: {tool}");
    }
    // 고정이 무엇인지 한 줄로 말한다 — 에이전트가 읽는 것은 이 문장뿐이다
    let described = format!("{} {}", tool["description"], props["pinned"]);
    assert!(described.contains("top"), "what pinning does is undocumented: {described}");
}

/// 에이전트도 고정할 수 있다 (결정 81). **제목을 함께 주지 않아도 된다** — 둘 다 선택
/// 인자이고, 안 준 쪽은 그대로 남는다 (atelier_edit_project와 같은 계약).
#[test]
fn edit_work_pins_a_work_without_touching_the_title() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_edit_work", "arguments": { "work_slug": "cart", "pinned": true }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let after: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(after["pinned"], true, "{after}");
    assert_eq!(after["title"], "카트", "an omitted title must not be cleared: {after}");

    // 파일에 남는다 — 앱을 껐다 켜도 고정이 살아 있어야 한다
    let got: Value = serde_json::from_str(server.request(5, "tools/call", json!({
        "name": "atelier_get_work", "arguments": { "work_slug": "cart" }
    }))["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(got["pinned"], true, "{got}");

    // 끄는 것도 같은 길이다
    let off = server.request(6, "tools/call", json!({
        "name": "atelier_edit_work", "arguments": { "work_slug": "cart", "pinned": false }
    }));
    let off: Value =
        serde_json::from_str(off["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(off["pinned"], false, "{off}");
}

/// 빈 패치는 파일만 다시 쓰고 아무 일도 안 일어난 것처럼 보인다 — atelier_edit_project가
/// 이미 같은 답을 한다.
#[test]
fn edit_work_with_nothing_to_change_says_what_to_pass() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_edit_work", "arguments": { "work_slug": "cart" }
    }));
    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("title"), "{text}");
    assert!(text.contains("pinned"), "{text}");
    assert!(text.contains("again"), "no next step: {text}");
}

/// 고정은 목록 **순서**로 나타난다 (결정 100). 앱이 그 위에 정렬을 얹지 않아도 되도록
/// 이 표면도 같은 순서를 본다.
#[test]
fn list_works_puts_pinned_first() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut server = Server::start(home.path());
    for slug in ["a-work", "b-work"] {
        server.request(3, "tools/call", json!({
            "name": "atelier_start_work", "arguments": { "title": slug, "slug": slug }
        }));
    }
    // 같은 날 만들어졌으므로 기존 규칙(slug 오름차순)으로는 a-work이 먼저다
    server.request(4, "tools/call", json!({
        "name": "atelier_edit_work", "arguments": { "work_slug": "b-work", "pinned": true }
    }));

    let listed: Value = serde_json::from_str(server.request(5, "tools/call", json!({
        "name": "atelier_list_works", "arguments": {}
    }))["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    let order: Vec<&str> =
        listed.as_array().unwrap().iter().map(|w| w["slug"].as_str().unwrap()).collect();
    assert_eq!(order, vec!["b-work", "a-work"], "pinned must come first: {listed}");
}

/// UI개선 결정 1·2. 작업 루트의 순서 파일(`.order.json`)이 이 표면에도 먹는다 — 사람이 사이드바에서
/// 본 「맨 위의 일」과 에이전트가 받는 맨 위가 같다(스토리 32). 파일은 **손으로** 적는다: 순서를
/// 바꾸는 도구는 없다.
#[test]
fn list_works_follows_the_order_file() {
    let home = tempfile::tempdir().unwrap();
    for slug in ["a-work", "b-work", "c-work"] {
        plant(&home.path().join("works"), slug, slug);
    }
    // 같은 날이라 지금 규칙(slug 오름차순)으로는 a·b·c다 — 뒤집어 적는다.
    std::fs::write(
        home.path().join("works/.order.json"),
        r#"{"order":["c-work","b-work","a-work"]}"#,
    )
    .unwrap();

    let mut server = Server::start(home.path());
    assert_eq!(work_titles(&mut server, 2), vec!["c-work", "b-work", "a-work"]);
}

/// UI개선 결정 28 · 스토리 34·35. 에이전트가 `pinned`를 바꾸면 앱의 핀 버튼과 **같은 자리**에 선다 —
/// 켜면 고정 구획 맨 위, 끄면 비고정 구획 맨 위. 이미 그 값이면 **아무 파일도 안 바뀐다**: 순서
/// 파일이 안 생기고, 심은 한 줄 `work.json`이 렌더러의 들여쓴 모양으로 다시 써지지 않는다.
#[test]
fn edit_work_pins_to_the_top_of_the_section_and_repeating_it_changes_no_file() {
    let home = tempfile::tempdir().unwrap();
    let works = home.path().join("works");
    for slug in ["a-work", "b-work", "c-work"] {
        plant(&works, slug, slug);
    }
    let mut server = Server::start(home.path());
    let pin = |server: &mut Server, id: u32, slug: &str, pinned: bool| {
        let res = server.request(id, "tools/call", json!({
            "name": "atelier_edit_work", "arguments": { "work_slug": slug, "pinned": pinned }
        }));
        assert_eq!(res["result"]["isError"], false, "{res}");
    };

    // 같은 날이라 옛 규칙(slug 오름차순)이면 고정 구획이 b·c다 — 나중에 고정한 c가 위여야 한다.
    pin(&mut server, 3, "b-work", true);
    pin(&mut server, 4, "c-work", true);
    assert_eq!(work_titles(&mut server, 5), vec!["c-work", "b-work", "a-work"], "고정 구획 맨 위가 아니다");
    pin(&mut server, 6, "c-work", false);
    assert_eq!(work_titles(&mut server, 7), vec!["b-work", "c-work", "a-work"], "비고정 구획 맨 위가 아니다");

    let order = works.join(".order.json");
    std::fs::remove_file(&order).unwrap();
    let planted = r#"{"title":"b-work","status":"active","createdAt":"2026-09-07","projects":[],"pinned":true}"#;
    std::fs::write(works.join("b-work/work.json"), planted).unwrap();
    pin(&mut server, 8, "b-work", true);
    assert!(!order.exists(), "같은 값 고정이 순서 파일을 썼다");
    assert_eq!(std::fs::read_to_string(works.join("b-work/work.json")).unwrap(), planted);
}

/// 설명 두 자리(도구 설명 · `pinned` 인자)가 **고정 구획 맨 위**라고 말한다 — 「모든 목록 맨 위」는
/// 순서 파일이 생긴 뒤로 거짓이다. `atelier_list_works`는 순서를 사람이 정하고 **바꾸는 도구가
/// 없다**고 말한다(결정 2 · 스토리 33) — 안 말하면 에이전트가 없는 도구를 찾거나 파일을 손댄다.
#[test]
fn pin_and_list_descriptions_say_where_a_pin_lands_and_who_orders_the_list() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));
    let tools = res["result"]["tools"].as_array().unwrap();
    let find = |name: &str| {
        tools.iter().find(|t| t["name"] == name).unwrap_or_else(|| panic!("{name} not listed: {res}"))
    };
    let normalize = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");

    let edit = find("atelier_edit_work");
    let described = normalize(edit["description"].as_str().unwrap());
    let pinned = normalize(edit["inputSchema"]["properties"]["pinned"]["description"].as_str().unwrap());
    for (place, text) in [("tool description", &described), ("pinned argument", &pinned)] {
        assert!(text.contains("top of the pinned section"), "{place}: {text}");
        assert!(!text.contains("every listing") && !text.contains("every work listing"), "{place}: {text}");
    }

    let list = normalize(find("atelier_list_works")["description"].as_str().unwrap());
    assert!(list.contains("no tool that changes the order"), "{list}");
}

/// V12 — 커밋 안 된 변경이 있으면 거부되고, 제거한 뒤에도 브랜치는 남는다.
#[test]
fn remove_work_refuses_dirty_worktrees_and_leaves_the_branch_behind() {
    let (home, code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing"], "branch": "feat/cart" }
    }));
    let worktree = home.path().join("works/카트/trees/billing");
    std::fs::write(worktree.join("wip.txt"), "uncommitted").unwrap();

    // 강제 옵션이 없으므로 커널의 거부가 그대로 최종 결과다
    let refused = server.request(4, "tools/call", json!({
        "name": "atelier_remove_work", "arguments": { "work_slug": "카트" }
    }));
    assert_eq!(refused["result"]["isError"], true, "{refused}");
    let text = refused["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("uncommitted"), "{text}");
    // 다음 단계가 `git stash`만 시키면 **안 듣는 처방**이다 — `-u` 없이는 추적 안 된 파일이
    // 그대로 남아 다시 거부당하고, 읽는 쪽은 왜 막혔는지 알 수 없다. 사용자가 실제로 겪었다.
    assert!(text.contains("untracked"), "추적 안 된 파일이라는 사실이 안 나온다: {text}");
    assert!(text.contains("stash -u"), "stash만 시키면 추적 안 된 파일이 남는다: {text}");
    // 삭제도 아카이빙과 같은 수준으로 말한다 — 경로만 주면 에이전트가 무엇을 치워야
    // 하는지 모른 채 워크트리를 뒤져야 한다. 삭제 쪽이 더 파괴적이다.
    assert!(text.contains("wip.txt"), "무엇 때문에 막혔는지 안 알려준다: {text}");
    assert!(!text.contains("--force"), "dead CLI flag leaked into the tool surface: {text}");
    assert!(home.path().join("works/카트").exists(), "refused remove deleted data");

    // 변경을 치우면 제거된다
    std::fs::remove_file(worktree.join("wip.txt")).unwrap();
    let res = server.request(5, "tools/call", json!({
        "name": "atelier_remove_work", "arguments": { "work_slug": "카트" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    assert!(!home.path().join("works/카트").exists());

    // 브랜치는 남는다 — 되돌릴 수 없는 손실이 없다는 근거
    let repo = code.path().join("billing");
    assert!(run_git_out(&repo, &["branch", "--list", "feat/cart"]).contains("feat/cart"));
    assert!(!run_git_out(&repo, &["worktree", "list"]).contains("trees/billing"));

    // 응답이 살아남은 브랜치 이름을 알려준다
    let out: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(out["branch"], "feat/cart", "{out}");
}

/// 프로젝트가 없는 work는 지울 워크트리도, 살아남을 브랜치도 없다. 응답이
/// "브랜치는 남아 있으니 복구 가능하다"고 말하면 거짓말이 된다.
#[test]
fn removing_a_project_less_work_does_not_promise_a_surviving_branch() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work", "arguments": { "title": "지울 아이디어" }
    }));

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_remove_work", "arguments": { "work_slug": "지울-아이디어" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let out: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(out["removed"], "지울-아이디어");
    assert!(out["branch"].is_null(), "there was no branch to report: {out}");
    let note = out["note"].as_str().unwrap();
    assert!(!note.contains("recoverable"), "nothing was recoverable here: {note}");
    assert!(!home.path().join("works/지울-아이디어").exists());
}

/// 아카이브는 지우는 게 아니라 옮긴다. 목록에서 빠지는 것이 규약이 아니라 **구조**다 —
/// 목록 조회는 보존소를 아예 보지 않는다.
#[test]
fn archiving_moves_the_work_out_of_the_list_and_seals_a_record() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));
    std::fs::write(home.path().join("works/cart/spec/overview.md"), "# 개요\n").unwrap();

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_archive_work", "arguments": { "work_slug": "cart" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");

    assert!(!home.path().join("works/cart").exists(), "작업 루트에 남아 있다");
    let dir = home.path().join("archive/cart");
    assert_eq!(std::fs::read_to_string(dir.join("spec/overview.md")).unwrap(), "# 개요\n");
    // 기록은 spec 밖, work 루트에 봉인된다
    let record = std::fs::read_to_string(dir.join("record.md")).unwrap();
    assert!(record.contains("feat/cart"), "{record}");
    assert!(!dir.join("spec/record.md").exists());

    let listed = server.request(5, "tools/call",
        json!({ "name": "atelier_list_works", "arguments": {} }));
    let views: Value =
        serde_json::from_str(listed["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(views.as_array().unwrap().is_empty(), "아카이브된 work가 목록에 남았다: {views}");
}

/// "보존한다"는 행위에 "커밋 안 된 작업을 버리고 진행"은 자기모순이다. 거부하되,
/// 기존 삭제 도구와 달리 **어떤 파일 때문인지**를 말한다.
#[test]
fn archive_refuses_dirty_worktrees_and_names_the_files() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));
    let worktree = home.path().join("works/cart/trees/billing");
    std::fs::create_dir_all(worktree.join("docs")).unwrap();
    std::fs::write(worktree.join("docs/plan.md"), "계획\n").unwrap();

    let refused = server.request(4, "tools/call", json!({
        "name": "atelier_archive_work", "arguments": { "work_slug": "cart" }
    }));
    assert_eq!(refused["result"]["isError"], true, "{refused}");
    let text = refused["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("docs/plan.md"), "무엇 때문인지 말하지 않는다: {text}");
    assert!(!home.path().join("archive/cart").exists(), "거부됐는데 옮겨졌다");
    assert!(worktree.join("docs/plan.md").is_file(), "거부됐는데 파일이 사라졌다");
}

/// 이 기능의 주된 소비자가 미래 세션이다. **도구 목록에 이름이 떠 있는 것 자체가
/// 발견 경로**이므로 목록 도구를 둔다. 응답은 경량이다 — 아카이브는 쌓이기만 한다.
#[test]
fn list_archive_returns_archived_works_without_their_spec_files() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));
    std::fs::write(home.path().join("works/cart/spec/overview.md"), "# 개요\n").unwrap();
    server.request(4, "tools/call",
        json!({ "name": "atelier_archive_work", "arguments": { "work_slug": "cart" } }));

    let res = server.request(5, "tools/call",
        json!({ "name": "atelier_list_archive", "arguments": {} }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let entries: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    let entry = &entries[0];
    assert_eq!(entry["slug"], "cart");
    assert_eq!(entry["title"], "카트");
    assert_eq!(entry["status"], "active", "아카이브가 status를 바꿨다: {entry}");
    assert!(entry["archivedAt"].is_string(), "{entry}");
    assert_eq!(entry["projects"][0], "billing");
    // 작업 목록 조회가 spec 파일까지 뱉어 컨텍스트를 먹는 문제를 물려받으면 안 된다
    assert!(entry["specFiles"].is_null(), "경량이어야 한다: {entry}");
    assert!(entry["specDir"].is_null(), "경량이어야 한다: {entry}");
    assert!(entry["worktrees"].is_null(), "경량이어야 한다: {entry}");
}

/// "slug 하나를 주면 그 work를 준다"는 정신 모델이 유지돼야, 에이전트가 참조를 보고
/// 도구를 고르기 전에 위치부터 알아낼 필요가 없다. 대신 **어느 쪽에서 왔는지**를
/// 말해준다 — 아카이브된 work의 spec을 고치려 드는 실수를 막기 위해서다.
#[test]
fn get_work_falls_back_to_the_archive_and_says_where_it_came_from() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));

    // 아카이브 전에는 작업 루트에서 온다
    let live = server.request(4, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "cart" } }));
    let view: Value =
        serde_json::from_str(live["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["origin"], "works", "{view}");
    assert!(live["result"]["content"][1]["text"].as_str().unwrap().contains("specDir"));

    server.request(5, "tools/call",
        json!({ "name": "atelier_archive_work", "arguments": { "work_slug": "cart" } }));

    // 같은 slug, 같은 도구 — 이제 보존소에서 온다
    let res = server.request(6, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "cart" } }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["origin"], "archive", "{view}");
    assert!(view["specDir"].as_str().unwrap().contains("archive"), "{view}");

    // spec을 쓸 자리를 안내하면 안 된다 — 여기는 일어난 일의 기록이다
    let note = res["result"]["content"][1]["text"].as_str().unwrap();
    assert!(note.contains("archived"), "{note}");
    assert!(!note.contains("write this first"), "아카이브에 spec 작성을 안내했다: {note}");
}

/// 출처를 `flatten`으로 덧붙이면 work.json의 미지 필드와 같은 평면에 놓인다 —
/// 누가 `origin` 필드를 적어 두면 키가 두 번 나가고, 읽는 쪽이 LLM이라 앞의 것을 집는다.
#[test]
fn get_work_reports_one_origin_even_when_the_work_file_already_has_that_field() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work", "arguments": { "title": "카트", "slug": "cart" }
    }));
    let meta = home.path().join("works/cart/work.json");
    let mut work: Value = serde_json::from_str(&std::fs::read_to_string(&meta).unwrap()).unwrap();
    work["origin"] = json!("사용자가 손으로 적은 값");
    std::fs::write(&meta, serde_json::to_string(&work).unwrap()).unwrap();

    let res = server.request(4, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "cart" } }));
    let raw = res["result"]["content"][0]["text"].as_str().unwrap();
    assert_eq!(raw.matches("\"origin\"").count(), 1, "출처 키가 두 번 나갔다: {raw}");
    let view: Value = serde_json::from_str(raw).unwrap();
    assert_eq!(view["origin"], "works", "{view}");
}

/// 프로젝트가 없던 work는 브랜치도 커밋도 없다. "브랜치는 남아 있다"고 말하면
/// 에이전트가 사용자에게 "코드는 브랜치에 있다"고 잘못 보고한다.
#[test]
fn archiving_a_project_less_work_does_not_promise_a_surviving_branch() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work", "arguments": { "title": "리서치만", "slug": "research" }
    }));

    let res = server.request(4, "tools/call",
        json!({ "name": "atelier_archive_work", "arguments": { "work_slug": "research" } }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let note = res["result"]["content"][1]["text"].as_str().unwrap();
    assert!(!note.contains("branch still exists"), "없는 브랜치를 약속했다: {note}");
    assert!(!note.contains("recoverable"), "되찾을 것이 없다: {note}");
}

/// 위 테스트는 부정 단언뿐이라 반대 방향을 못 잡는다 — 항상 "브랜치 없음" 문구를 쓰도록
/// 회귀시켜도 통과한다. 브랜치가 **살아 있는** 쪽도 함께 걸어야 갈래가 고정된다.
#[test]
fn archiving_a_work_with_a_branch_says_the_commits_are_recoverable() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));

    let res = server.request(4, "tools/call",
        json!({ "name": "atelier_archive_work", "arguments": { "work_slug": "cart" } }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let note = res["result"]["content"][1]["text"].as_str().unwrap();
    assert!(note.contains("branch still exists"), "살아 있는 브랜치를 안 알려줬다: {note}");
    assert!(note.contains("recoverable"), "{note}");
}

/// 폴백은 **"없다"일 때만** 탄다. 망가진 work.json의 오류까지 폴백으로 넘기면
/// 보존소에도 없으므로 결국 "work not found"로 보고되고, 에이전트는 원인을 못 보고
/// 같은 work을 다시 만들려 든다. 계약이 주석에만 있었어서 여기에 건다.
#[test]
fn get_work_does_not_hide_a_broken_work_file_behind_the_archive_fallback() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));
    std::fs::write(home.path().join("works/cart/work.json"), "{ 이건 JSON이 아니다").unwrap();

    let res = server.request(4, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "cart" } }));

    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        !text.contains("not found"),
        "망가진 파일을 '없다'로 덮었다 — 원인이 가려진다: {text}"
    );
}

#[test]
fn get_work_that_is_in_neither_root_still_reports_not_found() {
    let (home, _code) = fixture();
    let mut server = Server::start(home.path());
    let res = server.request(3, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "없는-것" } }));
    assert_eq!(res["result"]["isError"], true, "{res}");
    assert!(res["result"]["content"][0]["text"].as_str().unwrap().contains("없는-것"));
}

/// 삭제 도구의 force가 없는 이유(그것은 "지운다")와 아카이브의 이유는 다르지만,
/// 결론은 같다 — 표면에 강제가 없다.
#[test]
fn archive_work_exposes_no_force_option() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));
    let tool = res["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "atelier_archive_work")
        .expect("atelier_archive_work missing");
    let props = tool["inputSchema"]["properties"].as_object().unwrap();
    assert!(!props.contains_key("force"), "force must not be exposed: {tool}");
    assert_eq!(props.len(), 1, "only work_slug is an input: {tool}");
    // 되돌릴 수 없는 동작이다 — 승인 UI가 그렇게 취급해야 한다
    assert_eq!(tool["annotations"]["destructiveHint"], true, "{tool}");
    assert_eq!(tool["annotations"]["idempotentHint"], false, "{tool}");
}

/// D6 — 강제 삭제 옵션은 도구 표면에 존재하지 않는다.
#[test]
fn remove_work_exposes_no_force_option() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));
    let tool = res["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "atelier_remove_work")
        .expect("atelier_remove_work missing");
    let props = tool["inputSchema"]["properties"].as_object().unwrap();
    assert!(!props.contains_key("force"), "force must not be exposed: {tool}");
    assert_eq!(props.len(), 1, "only work_slug is an input: {tool}");
}

/// A4 — 쓰기 도구는 넷 다 힌트를 전부 명시한다. 안 적으면 wire에 필드가 나가지 않아
/// 클라이언트 기본값(destructiveHint = true)이 적용되고, 승인 UI가 작업 시작을
/// 삭제와 같은 등급으로 취급한다.
#[test]
fn write_tools_declare_their_blast_radius() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));

    let hints = |name: &str| -> Value {
        res["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["name"] == name)
            .unwrap_or_else(|| panic!("{name} missing"))["annotations"]
            .clone()
    };

    for name in [
        "atelier_start_work",
        "atelier_attach_project",
        "atelier_set_work_status",
        "atelier_edit_work",
    ] {
        let a = hints(name);
        assert_eq!(a["readOnlyHint"], false, "{name}: {a}");
        assert_eq!(a["destructiveHint"], false, "{name} is additive only: {a}");
        assert_eq!(a["idempotentHint"], true, "{name} is safe to retry: {a}");
        assert_eq!(a["openWorldHint"], false, "{name} touches local files only: {a}");
    }

    // 제거만 파괴적이고, 두 번째 호출은 없는 작업이라 멱등이 아니다
    let a = hints("atelier_remove_work");
    assert_eq!(a["readOnlyHint"], false, "{a}");
    assert_eq!(a["destructiveHint"], true, "{a}");
    assert_eq!(a["idempotentHint"], false, "{a}");
    assert_eq!(a["openWorldHint"], false, "{a}");
}

#[test]
fn remove_unknown_work_is_an_execution_error() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(3, "tools/call", json!({
        "name": "atelier_remove_work", "arguments": { "work_slug": "없는작업" }
    }));
    assert_eq!(res["result"]["isError"], true, "{res}");
    assert!(res["result"]["content"][0]["text"]
        .as_str()
        .unwrap()
        .contains("atelier_list_works"));
}

#[test]
fn add_project_registers_a_folder_and_is_idempotent() {
    let home = tempfile::tempdir().unwrap();
    let code = tempfile::tempdir().unwrap();
    let folder = code.path().join("billing");
    std::fs::create_dir(&folder).unwrap();

    let mut server = Server::start(home.path());
    assert!(server.tool_names(2).contains(&"atelier_add_project".to_string()));

    let res = server.request(3, "tools/call", json!({
        "name": "atelier_add_project",
        "arguments": { "folder_path": folder.to_str().unwrap() }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");

    // 결과는 ProjectView를 직렬화한 JSON 텍스트 한 블록이다 (A1)
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["slug"], "billing");
    assert_eq!(view["baseBranch"], "main");       // git 없는 폴더 → 폴백
    assert_eq!(view["missing"], false);
    // 등록 직후 설명은 비어 있다 — 도구 설명이 edit로 이어 부르라고 지시하는 이유
    assert_eq!(view["description"], "");

    // 멱등 (D7의 안전 근거이자 idempotent_hint=true의 공개 주장)
    let again = server.request(4, "tools/call", json!({
        "name": "atelier_add_project",
        "arguments": { "folder_path": folder.to_str().unwrap() }
    }));
    let again_view: Value =
        serde_json::from_str(again["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(again_view["slug"], "billing", "re-registering must return the existing project");

    let listed = server.request(5, "tools/call",
        json!({ "name": "atelier_list_projects", "arguments": {} }));
    let listed: Value =
        serde_json::from_str(listed["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(listed.as_array().unwrap().len(), 1, "duplicate registration: {listed}");
}

#[test]
fn add_project_declares_additive_idempotent_and_local_only() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));
    let tool = res["result"]["tools"].as_array().unwrap().iter()
        .find(|t| t["name"] == "atelier_add_project")
        .unwrap_or_else(|| panic!("tool not listed: {res}"));

    // A4 — 기본값이 destructive:true / idempotent:false 라서 넷 다 명시해야 뜻이 통한다
    let a = &tool["annotations"];
    assert_eq!(a["readOnlyHint"], false, "{tool}");
    assert_eq!(a["destructiveHint"], false, "{tool}");
    assert_eq!(a["idempotentHint"], true, "{tool}");
    assert_eq!(a["openWorldHint"], false, "{tool}");
}

#[test]
fn add_project_missing_folder_is_an_execution_error() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/call", json!({
        "name": "atelier_add_project",
        "arguments": { "folder_path": "/no/such/dir" }
    }));
    // 프로토콜 오류가 아니다 — 도구는 실행됐고 실패했다
    assert!(res["error"].is_null(), "must not be a protocol error: {res}");
    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("/no/such/dir"), "{text}");
    assert!(text.contains("atelier_list_projects"), "no next step: {text}");
}

#[test]
fn add_project_accepts_the_tilde_paths_it_hands_out() {
    // 이 표면이 내보내는 경로는 전부 `~` 축약형이다(project.path · worktrees[].path · specDir).
    // 읽은 값을 그대로 되돌려 넣을 수 있어야 한다.
    let home_dir = dirs::home_dir().unwrap();
    let code = tempfile::TempDir::new_in(&home_dir).unwrap();
    let folder = code.path().join("billing");
    std::fs::create_dir(&folder).unwrap();
    let tilde = format!("~/{}", folder.strip_prefix(&home_dir).unwrap().display());

    let atelier_home = tempfile::tempdir().unwrap();
    let mut server = Server::start(atelier_home.path());
    let res = server.request(2, "tools/call", json!({
        "name": "atelier_add_project",
        "arguments": { "folder_path": tilde }
    }));
    assert_eq!(res["result"]["isError"], false, "tilde path rejected: {res}");
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["slug"], "billing");
}

#[test]
fn add_project_refuses_relative_paths_instead_of_guessing() {
    // 상대 경로는 서버 프로세스의 작업 디렉터리 기준으로 풀린다. 호스트가 정하는 값이라
    // 에이전트가 알 수 없고, 같은 이름의 폴더가 우연히 있으면 조용히 엉뚱한 걸 등록한다.
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/call", json!({
        "name": "atelier_add_project",
        "arguments": { "folder_path": "some/relative/dir" }
    }));
    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("absolute"), "must say what is wrong: {text}");
    assert!(text.contains("again"), "must say what to do next: {text}");

    // 아무것도 등록되지 않았다
    let listed = server.request(3, "tools/call",
        json!({ "name": "atelier_list_projects", "arguments": {} }));
    let listed: Value =
        serde_json::from_str(listed["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(listed.as_array().unwrap().is_empty(), "{listed}");
}

/// 프로젝트 하나를 등록한 홈을 만들고 서버를 띄운다.
/// git 없는 폴더를 쓴다 — 02의 `fixture_with`에 기대지 않아 머지 순서와 무관하다 (§1.1).
fn server_with_one_project() -> (tempfile::TempDir, tempfile::TempDir, Server) {
    let home = tempfile::tempdir().unwrap();
    let code = tempfile::tempdir().unwrap();
    let folder = code.path().join("billing");
    std::fs::create_dir(&folder).unwrap();
    atelier_core::create_project(&home.path().join("projects"), &folder).unwrap();
    let server = Server::start(home.path());
    (home, code, server)
}

#[test]
fn edit_project_fills_in_the_description() {
    let (_home, _code, mut server) = server_with_one_project();
    assert!(server.tool_names(2).contains(&"atelier_edit_project".to_string()));

    let res = server.request(3, "tools/call", json!({
        "name": "atelier_edit_project",
        "arguments": {
            "project_slug": "billing",
            "description": "결제·정산 서비스. 카트 도메인과 인보이스 발행을 담당한다."
        }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(view["description"].as_str().unwrap().contains("인보이스"), "{view}");
    assert_eq!(view["slug"], "billing", "slug must not change");
}

#[test]
fn edit_project_leaves_omitted_fields_untouched() {
    // 부분 갱신은 커널이 Option으로 이미 보장한다. 여기서 보는 것은 그게 아니라
    // **wire에서 생략한 키가 None으로 도착하는가** — 커널 테스트가 닿을 수 없는 지점이다.
    let (_home, _code, mut server) = server_with_one_project();

    server.request(2, "tools/call", json!({
        "name": "atelier_edit_project",
        "arguments": { "project_slug": "billing", "description": "지켜져야 할 설명" }
    }));
    // base_branch만 준다 — name과 description은 아예 키가 없다
    let res = server.request(3, "tools/call", json!({
        "name": "atelier_edit_project",
        "arguments": { "project_slug": "billing", "base_branch": "develop" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["baseBranch"], "develop");
    assert_eq!(view["description"], "지켜져야 할 설명", "omitted field was clobbered: {view}");
    assert_eq!(view["name"], "billing", "omitted field was clobbered: {view}");

    // 생략 ≠ 비우기. 비우려면 빈 문자열을 준다 — 도구 설명이 약속하는 대로 동작해야 한다.
    let res = server.request(4, "tools/call", json!({
        "name": "atelier_edit_project",
        "arguments": { "project_slug": "billing", "description": "" }
    }));
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["description"], "");
}

#[test]
fn edit_project_schema_shows_which_fields_are_optional() {
    // 에이전트는 스키마를 보고 "안 주면 안 바뀐다"를 판단한다. 그게 계약이다.
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/list", json!({}));
    let tool = res["result"]["tools"].as_array().unwrap().iter()
        .find(|t| t["name"] == "atelier_edit_project")
        .unwrap_or_else(|| panic!("tool not listed: {res}"));

    let required: Vec<&str> = tool["inputSchema"]["required"].as_array().unwrap()
        .iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(required, vec!["project_slug"], "{tool}");
    let props = &tool["inputSchema"]["properties"];
    for field in ["name", "description", "base_branch"] {
        assert!(!props[field].is_null(), "missing property {field}: {tool}");
    }

    let a = &tool["annotations"];
    assert_eq!(a["readOnlyHint"], false, "{tool}");
    assert_eq!(a["destructiveHint"], false, "{tool}");
    assert_eq!(a["idempotentHint"], true, "{tool}");
    assert_eq!(a["openWorldHint"], false, "{tool}");
}

#[test]
fn edit_unknown_project_points_at_the_listing_tool() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/call", json!({
        "name": "atelier_edit_project",
        "arguments": { "project_slug": "없는프로젝트", "description": "x" }
    }));
    assert!(res["error"].is_null(), "must not be a protocol error: {res}");
    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("없는프로젝트"), "{text}");
    assert!(text.contains("atelier_list_projects"), "no next step: {text}");
}

#[test]
fn edit_with_no_fields_says_so_instead_of_rewriting_the_file() {
    let (_home, _code, mut server) = server_with_one_project();
    let res = server.request(2, "tools/call", json!({
        "name": "atelier_edit_project",
        "arguments": { "project_slug": "billing" }
    }));
    assert_eq!(res["result"]["isError"], true, "{res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("description"), "must name the fields it wants: {text}");
    assert!(text.contains("again"), "must say what to do next: {text}");
}

#[test]
fn edit_blank_name_is_rejected_and_keeps_the_old_one() {
    let (_home, _code, mut server) = server_with_one_project();
    let res = server.request(2, "tools/call", json!({
        "name": "atelier_edit_project",
        "arguments": { "project_slug": "billing", "name": "   " }
    }));
    assert_eq!(res["result"]["isError"], true, "{res}");
    // 커널의 EmptyName이 kernel_error를 타고 그대로 온다 (새 변환을 만들지 않았다는 증거)
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("empty"), "{text}");

    let listed = server.request(3, "tools/call",
        json!({ "name": "atelier_list_projects", "arguments": {} }));
    let listed: Value =
        serde_json::from_str(listed["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(listed[0]["name"], "billing", "failed edit must not change anything: {listed}");
}

#[test]
fn the_tool_surface_has_no_way_to_delete_a_project() {
    // 프로젝트 삭제는 앱이 유일한 경로다 (graph-plan D7 · Δ16).
    // atelier_core::delete_project는 존재하지만 도구로 노출하지 않는다.
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    for name in server.tool_names(2) {
        assert!(
            !(name.contains("project") && (name.contains("delete") || name.contains("remove"))),
            "project deletion must not be exposed as a tool: {name}"
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 모드 — 같은 도구 표면이 다른 루트를 읽는다 (결정 15·20)
//
// **재는 것은 바깥 동작이다** — 「Maison 셸의 MCP가 rooms만 돌려준다」이지 「서버가
// `maison/rooms`를 들고 있다」가 아니다. 그래서 여기서는 전부 서브프로세스를 띄우고,
// 파일이 실제로 어느 폴더에 앉는지를 본다.

/// 항목 하나를 **파일로** 심는다. 도구를 안 쓰는 것이 요점이다 — 도구로 심으면 「썼고
/// 읽었다」가 같은 루트 계산을 두 번 지나서, 그 계산이 틀려도 앞뒤가 맞는다.
fn plant(root: &std::path::Path, slug: &str, title: &str) {
    std::fs::create_dir_all(root.join(slug).join("spec")).unwrap();
    std::fs::write(
        root.join(slug).join("work.json"),
        format!(
            r#"{{"title":"{title}","status":"active","createdAt":"2026-09-07","projects":[]}}"#
        ),
    )
    .unwrap();
}

fn work_titles(server: &mut Server, id: u32) -> Vec<String> {
    let res = server
        .request(id, "tools/call", json!({ "name": "atelier_list_works", "arguments": {} }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let views: Value = serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap())
        .unwrap();
    views.as_array().unwrap().iter().map(|v| v["title"].as_str().unwrap().to_string()).collect()
}

/// **판 01의 첫 약속.** 같은 홈에 둘을 심어 두고 두 서버를 띄우면, 각자 자기 세계만 본다 —
/// 규약이 아니라 구조로 갈리므로 목록을 읽는 쪽이 필터를 기억할 필요가 없다.
#[test]
fn each_mode_lists_only_its_own_root() {
    let home = tempfile::tempdir().unwrap();
    plant(&home.path().join("works"), "spec-search", "spec 검색");
    plant(&home.path().join("maison/rooms"), "finance", "금융");

    let mut maison = Server::start_with_mode(home.path(), Some("maison"));
    assert_eq!(work_titles(&mut maison, 2), vec!["금융"]);

    let mut atelier = Server::start_with_mode(home.path(), Some("atelier"));
    assert_eq!(work_titles(&mut atelier, 2), vec!["spec 검색"]);

    // 값이 없는 것은 Atelier와 같다 — 앱 밖 셸에서 뜬 기존 MCP가 지금과 똑같다.
    let mut bare = Server::start(home.path());
    assert_eq!(work_titles(&mut bare, 2), vec!["spec 검색"]);
}

/// UI개선 결정 8 · 스토리 31. **Room 루트의 순서 파일은 Room 목록에만 먹는다.** 순서 파일이
/// 모드 홈이 아니라 진행 중 루트 안에 사는 까닭이 이것이다(S1) — 두 세계에 같은 slug를 같은
/// 날로 심고 `rooms/`에만 뒤집은 순서를 적으면, Atelier 목록은 지금 규칙 그대로 남아야 한다.
#[test]
fn a_rooms_order_file_orders_only_the_room_list() {
    let home = tempfile::tempdir().unwrap();
    for root in ["works", "maison/rooms"] {
        for slug in ["a-one", "b-two"] {
            plant(&home.path().join(root), slug, slug);
        }
    }
    std::fs::write(home.path().join("maison/rooms/.order.json"), r#"{"order":["b-two","a-one"]}"#)
        .unwrap();

    let mut maison = Server::start_with_mode(home.path(), Some("maison"));
    assert_eq!(work_titles(&mut maison, 2), vec!["b-two", "a-one"]);

    let mut atelier = Server::start_with_mode(home.path(), Some("atelier"));
    assert_eq!(work_titles(&mut atelier, 2), vec!["a-one", "b-two"], "Room의 순서가 Atelier로 샜다");
}

/// Room을 만드는 길은 MCP 하나다. **`projects`도 `branch`도 없이** 불린 `start_work`가
/// `maison/rooms/` 아래에 앉고, `specDir`가 그 아래를 가리킨다.
#[test]
fn maison_start_work_creates_a_room_and_points_the_spec_dir_at_it() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start_with_mode(home.path(), Some("maison"));

    let res = server.request(2, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "금융", "slug": "finance" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");

    let room = home.path().join("maison/rooms/finance");
    assert!(room.join("work.json").is_file(), "Room이 rooms 아래에 없다");
    assert!(!home.path().join("works/finance").exists(), "Atelier 루트에 새어 나갔다");
    // Room에는 브랜치도 워크트리도 없다 (결정 17).
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(view["branch"].is_null(), "{view}");
    assert!(view["worktrees"].as_array().unwrap().is_empty(), "{view}");

    let res = server.request(3, "tools/call", json!({
        "name": "atelier_get_work",
        "arguments": { "work_slug": "finance" }
    }));
    let view: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    let spec_dir = atelier_core::expand_home(view["specDir"].as_str().unwrap());
    assert_eq!(spec_dir, room.join("spec"), "에이전트가 spec을 엉뚱한 자리에 쓴다");
    assert!(spec_dir.is_dir());
}

/// MCP로 치운 Room이 앱의 Maison Archive에 보여야 한다 — 그러려면 `maison/archive/`로
/// 가야 하고, Atelier 아카이브에 섞이면 안 된다 (스펙 US 25).
#[test]
fn maison_archive_work_moves_the_room_into_the_maison_archive() {
    let home = tempfile::tempdir().unwrap();
    plant(&home.path().join("maison/rooms"), "finance", "금융");
    let mut server = Server::start_with_mode(home.path(), Some("maison"));

    let res = server.request(2, "tools/call", json!({
        "name": "atelier_archive_work",
        "arguments": { "work_slug": "finance" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");

    assert!(!home.path().join("maison/rooms/finance").exists());
    assert!(home.path().join("maison/archive/finance/work.json").is_file());
    assert!(home.path().join("maison/archive/finance/record.md").is_file());
    assert!(!home.path().join("archive/finance").exists(), "Atelier 아카이브에 섞였다");

    // 목록에서 빠지고 같은 모드의 아카이브 목록에 선다.
    assert!(work_titles(&mut server, 3).is_empty());
    let res = server
        .request(4, "tools/call", json!({ "name": "atelier_list_archive", "arguments": {} }));
    let views: Value =
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(views[0]["slug"], "finance");
}

/// **`atelier`를 명시해도 한 글자도 안 달라진다** (결정 7·15). 앱은 두 모드 다 명시해서
/// 심으므로 이 값이 정상값이어야 하고, 여기가 어긋나면 앱에서 뜬 셸만 조용히 다른 폴더를
/// 쓰게 된다.
///
/// 읽기만이 아니라 **쓰기 경로까지** 잰다: 만들고 치우는 두 도구가 앉히는 자리를 본다.
#[test]
fn an_explicit_atelier_mode_writes_exactly_where_the_bare_server_does() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start_with_mode(home.path(), Some("atelier"));

    let res = server.request(2, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    assert!(home.path().join("works/cart/work.json").is_file());

    let res = server.request(3, "tools/call", json!({
        "name": "atelier_archive_work",
        "arguments": { "work_slug": "cart" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    assert!(home.path().join("archive/cart/work.json").is_file());

    // Maison 루트는 **생기지도 않는다** — 「모드가 생겼다」가 Atelier 홈에 폴더를 늘리지 않는다.
    assert!(!home.path().join("maison").exists(), "Atelier에서 maison/이 생겼다");
}

/// **등록된 프로젝트를 실어 불러도 Maison에는 아무것도 안 앉는다** — 디스크로 보는 US 42다.
///
/// **이름이 재는 것을 바꿔 달았다.** #180 전에는 이 검사가 `shared_projects_root()`의
/// Maison 갈래(`None`)를 재고 있었다 — 호출이 커널까지 가서 「project not registered」로
/// 실패했으므로, 배선을 `Some`으로 뒤집으면 성공해 버려 여기서 빨개졌다. 지금은 어댑터의
/// 거절이 커널 앞에서 되돌려 보내므로 그 배선은 이 경로에서 관찰되지 않는다. 그래서 그
/// 불변조건은 값을 정하는 자리로 옮겨 갔다 — mcp/mod.rs의
/// `the_maison_server_hands_the_kernel_no_project_registry`. 여기 남은 것은 바깥 사실
/// 하나다: **Maison 루트에 아무것도 안 앉는다.**
///
/// **등록부를 실제로 심는 것이 요점이다.** 등록 안 된 이름을 쓰면 Atelier 경로도
/// 「project not registered」로 똑같이 실패해서, 이 검사가 재는 것이 「모드」인지
/// 「이름이 없다」인지 흐려진다.
///
/// **순서가 붙들고 있는 것이 있다.** Maison을 **먼저** 부른다 — Atelier 대조를 앞에 두면
/// 그쪽이 저장소에 `finance` 브랜치를 만들어 버려서, 거절이 무너진 Maison 호출이
/// 「이미 체크아웃된 브랜치」라는 **엉뚱한 이유**로 실패한다. 그러면 무너진 거절이 초록으로
/// 지나간다.
///
/// 거절의 문구와 재개 경로를 재는 것은 아래
/// `maison_start_work_refuses_projects_or_branch_on_a_new_room_and_on_a_resume`다.
#[test]
fn maison_start_work_with_registered_projects_lands_nothing() {
    let (home, _code) = fixture_with(&["billing"]);
    let arguments = json!({ "title": "금융", "slug": "finance", "projects": ["billing"] });

    let mut maison = Server::start_with_mode(home.path(), Some("maison"));
    let res = maison.request(
        2,
        "tools/call",
        json!({ "name": "atelier_start_work", "arguments": arguments }),
    );
    assert_eq!(res["result"]["isError"], true, "Maison이 프로젝트를 받아 들였다: {res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("billing"), "무엇이 거절됐는지 안 적혀 있다: {text}");

    // 거절은 **아무것도 안 만든다.** 반쪽만 앉은 Room이 남으면 다음 호출이 그것을 재개한다.
    assert!(!home.path().join("maison/rooms/finance").exists(), "거절했는데 Room이 생겼다");

    // 대조 — 같은 홈, 같은 인자, Atelier 서버. 여기서 성공하고 워크트리까지 서야
    // 위 실패가 「모드 때문」임이 확정된다.
    let mut atelier = Server::start_with_mode(home.path(), Some("atelier"));
    let res = atelier.request(
        2,
        "tools/call",
        json!({ "name": "atelier_start_work", "arguments": arguments }),
    );
    assert_eq!(res["result"]["isError"], false, "{res}");
    assert!(
        home.path().join("works/finance/trees/billing").is_dir(),
        "대조가 안 섰다 — 위 실패가 모드 때문인지 알 수 없다"
    );
}

/// 도구 표면은 **모드와 무관하게 같다** (결정 15). 여기가 갈리면 에이전트가 세계마다
/// 다른 도구 이름을 외워야 하고, 지침 두 벌로는 못 메운다.
#[test]
fn the_tool_surface_is_the_same_in_both_modes() {
    let home = tempfile::tempdir().unwrap();
    let atelier = Server::start(home.path()).tool_names(2);
    let maison = Server::start_with_mode(home.path(), Some("maison")).tool_names(2);
    assert_eq!(atelier, maison);
}

/// **오타가 조용히 Atelier로 눕지 않는다** (스펙 US 46). 핸드셰이크는커녕 아무것도 하기 전에
/// 끝나고, 표준에러에 받은 값과 허용값이 남는다. 표준출력은 JSON-RPC 전용이라 비어 있다 (Δ13).
#[test]
fn an_unknown_mode_dies_before_the_handshake_and_says_what_it_got() {
    let home = tempfile::tempdir().unwrap();
    let (status, stdout, stderr) = spawn_expecting_startup_failure(home.path(), "MAISON");

    assert!(!status.success(), "모르는 값으로 서버가 떴다 (stderr: {stderr})");
    assert!(stdout.is_empty(), "표준출력이 오염됐다: {stdout:?}");
    assert!(stderr.contains("MAISON"), "받은 값이 안 적혔다: {stderr}");
    for allowed in ["atelier", "maison"] {
        assert!(stderr.contains(allowed), "허용값 '{allowed}'가 안 적혔다: {stderr}");
    }

    // 뜨지도 않은 서버가 파일은 지우는 일이 없어야 한다 — 기동 정리(Δ11)보다 앞이다.
    let skills = home.path().join("skills-guard/atelier");
    std::fs::create_dir_all(&skills).unwrap();
    let (_, _, _) = spawn_expecting_startup_failure(home.path(), "mansion");
    assert!(skills.is_dir(), "안 뜬 서버가 스킬 폴더를 지웠다");
}

/// 빈 값도 모르는 값이다 — `ATELIER_MODE=$UNSET`으로 값이 증발한 셸이 생활 쪽인지
/// 일 쪽인지 아무도 모르는 채로 뜨면 안 된다.
#[test]
fn an_empty_mode_is_refused_rather_than_read_as_absent() {
    let home = tempfile::tempdir().unwrap();
    let (status, stdout, stderr) = spawn_expecting_startup_failure(home.path(), "");
    assert!(!status.success(), "빈 값으로 서버가 떴다 (stderr: {stderr})");
    assert!(stdout.is_empty(), "표준출력이 오염됐다: {stdout:?}");
    assert!(stderr.contains("ATELIER_MODE"), "어느 변수가 문제인지 안 적혔다: {stderr}");
}

/// V4 전반부 — 지침이 실제로 클라이언트에게 전달되는 채널에 실린다.
/// 클라이언트는 이 필드를 모델의 시스템 프롬프트에 주입하도록 의도돼 있다.
#[test]
fn initialize_carries_server_instructions() {
    let home = tempfile::tempdir().unwrap();
    let server = Server::start(home.path());

    let instructions = server.init["result"]["instructions"]
        .as_str()
        .unwrap_or_else(|| panic!("no instructions in initialize result: {}", server.init));

    // 채널만 확인하고 끝내면 빈 문자열도 통과한다. 지침이 실제로
    // 고피해 지식을 싣고 있는지는 여기서 대표 두 개로 못 박고,
    // 나머지 내용 가드는 instructions.rs의 단위 테스트가 맡는다.
    assert!(
        instructions.contains("localBranches"),
        "branch convention lost its data source: {instructions}"
    );
    assert!(
        instructions.contains("specDir"),
        "spec convention lost the location field: {instructions}"
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Maison에는 프로젝트가 없다 (결정 17 · 스펙 US 42·44)
//
// 도구 표면은 두 세계가 **같이** 쓴다(위 `the_tool_surface_is_the_same_in_both_modes`).
// 그래서 「Maison엔 없다」를 말하는 자리가 셋이다 — 부르면 돌아오는 **거절**, 상주하는
// **지침**, 그리고 늘 읽히는 **도구 설명**. 아래 넷이 그 셋을 각각 붙든다.

/// Maison에서 거절되는 프로젝트 도구 넷. 이 목록이 곧 스펙 US 42의 대상이다.
const PROJECT_TOOLS: [&str; 4] = [
    "atelier_list_projects",
    "atelier_add_project",
    "atelier_edit_project",
    "atelier_attach_project",
];

/// 거절이 말해야 하는 것. 문장 전체를 못박지 않고 **조각**으로 본다 — 「없다」와 「왜
/// 없는가」는 다섯 자리가 공유하고(`NO_PROJECTS_IN_MAISON`), 「다음에 무엇을」은 자리마다
/// 다르므로 부르는 쪽이 `next_step`으로 준다.
///
/// **다음 걸음을 함께 재는 이유.** 안내가 통째로 비어도 앞의 두 조각은 그대로라 검사가
/// 초록으로 남는다. 그러면 Maison 에이전트는 무엇이 없는지만 듣고 무엇을 대신 하라는지는
/// 모른 채 다음 문을 두드린다 — mcp/mod.rs가 이 표면의 규약으로 적어 둔 「무엇이 틀렸는가
/// + 다음에 무엇을 하라」의 뒤 절반이 통째로 풀린다. 이 저장소의 다른 오류 경로는 전부
/// 그 뒤 절반을 테스트로 지킨다 (`edit_unknown_project_points_at_the_listing_tool`).
fn assert_refused_as_maison(res: &Value, what: &str, next_step: &[&str]) {
    // 프로토콜 오류가 아니다 — 도구는 실재하고 라우팅도 됐으며, 이 세계에서 할 일이 없을 뿐이다.
    assert!(res["error"].is_null(), "{what}: 프로토콜 오류로 나갔다: {res}");
    assert_eq!(res["result"]["isError"], true, "{what}가 Maison에서 실행됐다: {res}");
    let text = res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("Maison has no projects"), "{what}: 「없다」가 없다: {text}");
    assert!(
        text.contains("a Room is a topic"),
        "{what}: 왜 없는지가 없다 — 에이전트가 등록으로 우회한다: {text}"
    );
    assert!(!next_step.is_empty(), "{what}: 재야 할 다음 걸음을 안 줬다");
    for fragment in next_step {
        assert!(
            text.contains(fragment),
            "{what}: 다음에 무엇을 하라가 없다 ({fragment}): {text}"
        );
    }
}

/// **US 42의 절반** — 프로젝트 도구 넷이 거절되고, 거절이 파일 시스템에 아무것도 안 남긴다.
///
/// **등록부를 실제로 심어 두고 부르는 것이 요점이다.** 없는 이름을 쓰면 Atelier에서도
/// 「project not registered」로 똑같이 빨개져, 이 검사가 재는 것이 「모드」인지 「이름이
/// 없다」인지 흐려진다. 마지막의 Atelier 대조가 그 판별을 마저 세운다.
#[test]
fn maison_refuses_the_four_project_tools_and_leaves_the_disk_alone() {
    let (home, code) = fixture_with(&["billing"]);
    // 등록 **안 된** 폴더 하나 — add_project가 지나가면 여기에 등록부 파일이 생긴다.
    let unregistered = code.path().join("shipping");
    std::fs::create_dir(&unregistered).unwrap();
    // Room 하나를 심어 둔다 — attach가 「work가 없다」로 빨개지면 무엇을 재는지 흐려진다.
    plant(&home.path().join("maison/rooms"), "finance", "금융");

    let calls = [
        json!({ "name": "atelier_list_projects", "arguments": {} }),
        json!({
            "name": "atelier_add_project",
            "arguments": { "folder_path": unregistered.to_str().unwrap() }
        }),
        json!({
            "name": "atelier_edit_project",
            "arguments": { "project_slug": "billing", "description": "Maison이 적은 설명" }
        }),
        json!({
            "name": "atelier_attach_project",
            "arguments": { "work_slug": "finance", "project_slug": "billing" }
        }),
    ];
    // 표와 호출이 어긋나면 검사가 도구 하나를 조용히 안 부른다. **길이를 먼저 못박는다** —
    // `zip`은 짧은 쪽에서 끝나므로, 호출을 하나 지우면 이름 대조는 전부 통과하고 뒤의 실행
    // 루프도 그 도구를 안 부른다. 「넷을 잰다」가 조용히 셋으로 줄어든다.
    assert_eq!(calls.len(), PROJECT_TOOLS.len(), "거절 호출 표가 도구 하나를 빠뜨렸다");
    for (call, name) in calls.iter().zip(PROJECT_TOOLS) {
        assert_eq!(call["name"], name, "거절 호출 표가 어긋났다");
    }

    let mut maison = Server::start_with_mode(home.path(), Some("maison"));
    for (i, call) in calls.iter().enumerate() {
        let res = maison.request(2 + i as u32, "tools/call", call.clone());
        // 넷이 같은 다음 걸음을 받는다 — 「프로젝트 도구를 부르지 말고, Room은 slug와
        // specDir로 만들어라」 (mcp/mod.rs의 `DO_NOT_CALL_PROJECT_TOOLS`).
        assert_refused_as_maison(
            &res,
            call["name"].as_str().unwrap(),
            &["atelier_start_work", "`slug`", "`specDir`"],
        );
    }

    // 아무것도 안 만들었다 — 프로젝트는 `projects/<slug>.md` 하나로 산다.
    assert!(!home.path().join("projects/shipping.md").exists(), "Maison이 프로젝트를 등록했다");
    let billing = std::fs::read_to_string(home.path().join("projects/billing.md")).unwrap();
    assert!(!billing.contains("Maison이 적은 설명"), "거절했는데 등록부가 바뀌었다: {billing}");
    assert!(
        !home.path().join("maison/rooms/finance/trees").exists(),
        "거절했는데 Room에 워크트리 자리가 생겼다"
    );
    // Room 자체는 멀쩡하다 — 거절이 남의 것을 치우지 않는다.
    assert_eq!(work_titles(&mut maison, 20), vec!["금융"]);

    // 대조 — 같은 홈, 같은 두 호출, Atelier 서버. 여기서 지나가야 위 거절이 「모드 때문」이다.
    let mut atelier = Server::start_with_mode(home.path(), Some("atelier"));
    let listed = atelier.request(2, "tools/call", calls[0].clone());
    assert_eq!(listed["result"]["isError"], false, "대조가 안 섰다: {listed}");
    let views: Value =
        serde_json::from_str(listed["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(views[0]["slug"], "billing", "{views}");
    let added = atelier.request(3, "tools/call", calls[1].clone());
    assert_eq!(added["result"]["isError"], false, "대조가 안 섰다: {added}");
    assert!(home.path().join("projects/shipping.md").exists(), "대조가 등록을 안 했다");
}

/// **US 42의 나머지 절반** — `projects`나 `branch`가 실린 `atelier_start_work`.
///
/// `branch`를 함께 막는 이유가 이 검사의 요점이다: 프로젝트 없이 `branch`만 오면 커널은
/// **아무 오류도 없이** 그 이름을 work.json에 적는다. Room에는 브랜치가 없으므로(결정 17)
/// 그것은 조용히 어긋난 데이터이고, 화면에도 오류로 안 뜬다.
///
/// **재개까지 본다.** 신규만 막으면 「먼저 맨몸으로 만들고 같은 slug로 브랜치를 얹는」 길이
/// 열린 채로 남는다 — 그 길이 정확히 위의 조용한 어긋남이다.
#[test]
fn maison_start_work_refuses_projects_or_branch_on_a_new_room_and_on_a_resume() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut maison = Server::start_with_mode(home.path(), Some("maison"));
    let room = home.path().join("maison/rooms/finance");

    // ── 신규 ──
    for (id, arguments) in [
        (2, json!({ "title": "금융", "slug": "finance", "projects": ["billing"] })),
        (3, json!({ "title": "금융", "slug": "finance", "branch": "feat/finance" })),
    ] {
        let res = maison
            .request(id, "tools/call", json!({ "name": "atelier_start_work", "arguments": arguments }));
        // 다음 걸음은 여기서만 다르다 — 「부르지 말라」가 아니라 「둘 다 빼고 다시 부르라」다.
        assert_refused_as_maison(
            &res,
            "atelier_start_work",
            &["Call atelier_start_work again with neither"],
        );
        // 무엇이 걸렸는지 이름으로 적혀 있다 — 안 적히면 에이전트가 하나만 빼고 다시 부른다.
        let text = res["result"]["content"][0]["text"].as_str().unwrap();
        let carried = if arguments["branch"].is_null() { "billing" } else { "feat/finance" };
        assert!(text.contains(carried), "무엇이 거절됐는지 안 적혀 있다: {text}");
        // 거절은 **아무것도 안 만든다.** 반쪽만 앉은 Room이 남으면 다음 호출이 그것을 재개한다.
        assert!(!room.exists(), "거절했는데 Room이 생겼다: {arguments}");
    }

    // ── 맨몸으로는 지나간다. 재개의 대조군이자, 거절이 도구 자체를 막은 게 아니라는 증거다.
    let res = maison.request(4, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "금융", "slug": "finance" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    assert!(room.join("work.json").is_file());

    // ── 재개 ── 같은 slug로 다시 부르며 프로젝트·브랜치를 얹으려 한다
    for (id, arguments) in [
        (5, json!({ "title": "금융", "slug": "finance", "projects": ["billing"] })),
        (6, json!({ "title": "금융", "slug": "finance", "branch": "feat/finance" })),
    ] {
        let res = maison
            .request(id, "tools/call", json!({ "name": "atelier_start_work", "arguments": arguments }));
        assert_refused_as_maison(
            &res,
            "atelier_start_work (재개)",
            &["Call atelier_start_work again with neither"],
        );
    }

    // 막으려던 조용한 어긋남 — 브랜치 이름이 work.json에 앉지 않았다
    let stored = std::fs::read_to_string(room.join("work.json")).unwrap();
    assert!(!stored.contains("feat/finance"), "브랜치가 Room에 적혔다: {stored}");
    assert!(!stored.contains("billing"), "프로젝트가 Room에 적혔다: {stored}");
    assert!(!room.join("trees").exists(), "Room에 워크트리 자리가 생겼다");

    // 응답으로도 같은 것이 보인다 — 파일만 보면 필드 이름이 바뀌는 날 검사가 눈을 감는다
    let got = maison.request(7, "tools/call", json!({
        "name": "atelier_get_work", "arguments": { "work_slug": "finance" }
    }));
    let view: Value =
        serde_json::from_str(got["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert!(view["branch"].is_null(), "{view}");
    assert!(view["projects"].as_array().unwrap().is_empty(), "{view}");
}

/// 서버가 초기화 응답에 싣는 지침. 호스트가 시스템 프롬프트에 넣는 바로 그 값이다.
fn instructions_of(server: &Server) -> String {
    server.init["result"]["instructions"]
        .as_str()
        .unwrap_or_else(|| panic!("no instructions in initialize result: {}", server.init))
        .to_string()
}

/// **US 44** — Maison 셸의 에이전트가 받는 절차는 Room의 절차다. 「먼저 프로젝트 목록을
/// 부르라」가 남아 있으면 에이전트는 거절당하고 나서야 그 사실을 안다.
#[test]
fn the_maison_instructions_teach_the_room_procedure_instead_of_the_project_one() {
    let home = tempfile::tempdir().unwrap();
    let text = instructions_of(&Server::start_with_mode(home.path(), Some("maison")));

    assert!(text.contains("no project, no branch and no worktree"), "「없다」가 없다: {text}");
    assert!(
        text.contains("~/.atelier/maison/rooms/<slug>/spec/overview.md:L19-27"),
        "Room 참조 뿌리가 없다: {text}"
    );
    assert!(text.contains("~/.atelier/maison/archive/<slug>/"), "아카이브 뿌리가 없다: {text}");
    assert!(text.contains("specDir"), "spec을 쓸 자리가 없다: {text}");
    for atelier_only in PROJECT_TOOLS {
        assert!(!text.contains(atelier_only), "Atelier 절차가 샜다 ({atelier_only}): {text}");
    }
}

/// **Atelier 벌은 지금 그대로다.** 값 없이 뜬 서버와 `atelier`를 명시한 서버가 **같은 글자**를
/// 내고, 그것이 Maison 벌과 **다르다** — 뒤 절반이 없으면 「두 벌」이 배선 안 된 판(늘 한 벌만
/// 나가는 판)이 초록으로 지나간다.
#[test]
fn the_atelier_instructions_are_unchanged_and_the_two_sets_really_differ() {
    let home = tempfile::tempdir().unwrap();
    let bare = instructions_of(&Server::start(home.path()));
    let explicit = instructions_of(&Server::start_with_mode(home.path(), Some("atelier")));
    let maison = instructions_of(&Server::start_with_mode(home.path(), Some("maison")));

    assert_eq!(bare, explicit, "값을 명시했다고 지침이 갈렸다");
    assert_ne!(bare, maison, "모드별 선택이 배선 안 됐다 — 두 세계가 같은 지침을 받는다");
    // 절차 셋이 그대로 서 있다 (내용 가드 전체는 instructions.rs의 단위 테스트가 든다)
    assert!(bare.contains("Call atelier_list_projects first"), "{bare}");
    assert!(bare.contains("git.localBranches"), "{bare}");
    assert!(bare.contains("worktrees[].path"), "{bare}");
}

/// JSON에 실린 **문자열 값**을 전부 모은다. 키는 안 본다 — 인자 이름은 문장이 아니다.
///
/// `properties.*.description`만 집으면, schemars가 `title`로도 내보내기 시작하는 날
/// (doc 주석이 `#`로 시작하면 그렇게 된다) 그 문장이 조용히 그물 밖에 남는다.
fn collect_prose(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(s) => out.push(s.clone()),
        Value::Array(items) => items.iter().for_each(|v| collect_prose(v, out)),
        Value::Object(map) => map.values().for_each(|v| collect_prose(v, out)),
        _ => {}
    }
}

/// 도구 이름별로, `tools/list` 한 항목에서 **에이전트가 읽는 문장 전부**.
///
/// **인자 스키마까지 걷는 것이 요점이다.** 도구 설명과 인자 doc은 같은 응답에 함께 실려
/// 한 덩어리로 읽히고, 이 파일은 이미 두 자리에서 그렇게 재고 있다
/// (`format!("{} {}", tool["description"], tool["inputSchema"])`). `description`만 읽으면
/// 중립화가 절반에서 멈춰도 초록이다 — 실제로 그랬다: `atelier_edit_work`의 설명에서
/// 걷어 낸 문장이 `EditWorkParams.title`의 doc에 그대로 살아 있었다.
///
/// **공백을 고른다.** schemars는 doc 주석의 줄바꿈을 그대로 `description`에 싣는데
/// (rmcp가 재수출하는 1.2.1), 아래 조각 대조는 리터럴이라 줄바꿈 한 번에 조용히 빗나간다.
///
/// **fail-closed** — 도구 수가 달라지거나, 도구든 인자든 설명이 하나라도 없으면 여기서 터진다.
fn tool_descriptions(server: &mut Server, id: u32) -> std::collections::BTreeMap<String, String> {
    let res = server.request(id, "tools/list", json!({}));
    let tools = res["result"]["tools"].as_array().unwrap_or_else(|| panic!("no tools: {res}"));
    assert_eq!(tools.len(), 12, "도구 수가 달라졌다 — 설명 검사가 무엇을 읽는지 다시 세라: {res}");
    tools
        .iter()
        .map(|tool| {
            let name = tool["name"].as_str().unwrap().to_string();
            let description = tool["description"]
                .as_str()
                .unwrap_or_else(|| panic!("{name}에 설명이 없다 — 못 읽으면 통과가 아니다: {tool}"));
            assert!(description.len() > 40, "{name}의 설명이 사라지다시피 했다: {description}");
            // 인자에 설명이 없으면 그물이 아니라 **에이전트**가 못 읽는다 — 무엇을 실어야
            // 하는지 모르는 인자가 하나라도 생기면 여기서 터져야 한다.
            if let Some(props) = tool["inputSchema"]["properties"].as_object() {
                for (field, prop) in props {
                    let described = prop["description"].as_str().unwrap_or("");
                    assert!(!described.trim().is_empty(), "{name}.{field}에 설명이 없다: {prop}");
                }
            }
            let mut prose = vec![description.to_string()];
            collect_prose(&tool["inputSchema"], &mut prose);
            (name, prose.join(" ").split_whitespace().collect::<Vec<_>>().join(" "))
        })
        .collect()
}

/// 걷어 낸 **전제**. 뜻이 아니라 전제를 잰다 — 「프로젝트」라는 낱말 자체는 금지가 아니고
/// (프로젝트 도구는 프로젝트를 설명해야 한다), 금지되는 것은 **있음을 단정하는 형태**와
/// **Atelier에만 있는 순서**다. 조건절 안의 같은 말(`when it spans projects`)은 참이라 남는다.
///
/// 파서가 아니라 **되돌아옴 방지 그물**이다 (`BANNED_CLI`와 같은 수법). 실제로 걷어 낸 조각을
/// 그대로 못박아 두고, 새 전제가 생기면 여기 한 줄을 더한다.
const PRESUPPOSING: [(&str, &str); 12] = [
    ("one feature", "Room은 기능이 아니라 토픽이다 (결정 17)"),
    ("sharing a single branch name", "브랜치가 있음을 단정한다"),
    ("the shared branch", "정관사가 「어느 것에나 하나 있다」로 읽힌다"),
    ("one git worktree per project", "워크트리가 늘 생긴다고 단정한다"),
    ("the per-project worktree paths", "워크트리가 있음을 단정한다"),
    ("Call this first", "Atelier에만 있는 순서 — 절차는 지침이 든다"),
    // 여기부터는 **인자 스키마**에서 걷어 낸 것들. 도구 설명만 고치고 인자 doc을 두면 같은
    // 문장이 스무 줄 아래에서 되살아난다 — 실제로 그 상태로 한 번 초록이었다.
    ("shared by every project's worktree", "`start_work`의 `branch` 인자가 워크트리를 단정한다"),
    (
        "the branch simply stays undecided",
        "`projects` 없이 `branch`만 실은 호출을 정상 선택지로 안내한다 — 그것이 Maison에서 \
         거절되는 바로 그 호출이다",
    ),
    (
        "the branch and the worktree paths are untouched",
        "`atelier_edit_work`의 설명에서 걷어 낸 문장이 `title` 인자에 남아 있던 자리",
    ),
    ("a folder and a branch name", "slug가 언제나 브랜치 이름이 된다고 단정한다"),
    ("A branch they share is kept in every project repository", "관사만 갈아 낀 같은 단정"),
    ("they share is kept in every repository", "관사만 갈아 낀 같은 단정"),
];

/// 저 세계에 없는 것들. **낱말 자체는 금지가 아니다** — 아래 검사는 이 말이 나온 문장이
/// **조건절을 달고 있는지**만 본다.
const ABSENT_IN_MAISON: [&str; 3] = ["branch", "worktree", "repositor"];

/// 그 문장이 조건절이라는 표식. 하나라도 있으면 「있을 때의 이야기」로 읽힌다.
///
/// `each project`·`per project`가 여기 있는 것은 Room에 프로젝트가 0개라 그 절이 Maison에서
/// **한 번도 안 도는** 이야기이기 때문이다 — 단정이 아니라 범위다.
const CONDITIONAL: [&str; 7] =
    ["when", "When", "if ", "If ", "any", "each project", "spans project"];

/// **도구 설명은 모드별로 못 가른다** (static attribute라 인스턴스가 없다). 그래서 하나뿐인
/// 문장을 두 세계가 함께 읽고, 프로젝트·브랜치·워크트리를 **전제하는** 문장은 Maison
/// 에이전트를 없는 것으로 보낸다. 절차와 세계별 사실은 지침 두 벌이 든다.
///
/// 앞머리의 「두 세계가 같은 설명을 읽는다」 대조가 이 검사의 근거다 — 갈 수 있었다면
/// 애초에 이 검사가 필요 없다.
///
/// 재는 표면은 도구 설명 **더하기 인자 스키마**다 (`tool_descriptions` 참조) — 에이전트는
/// 둘을 한 덩어리로 읽으므로, 절반만 재는 검사는 「걷어 냈다」를 절반만 강제한다.
#[test]
fn no_tool_description_presupposes_a_project_a_branch_or_a_worktree() {
    let home = tempfile::tempdir().unwrap();
    let atelier = tool_descriptions(&mut Server::start(home.path()), 2);
    let maison = tool_descriptions(&mut Server::start_with_mode(home.path(), Some("maison")), 2);
    assert_eq!(atelier, maison, "설명이 모드별로 갈렸다 — 그럴 수 있었다면 이 검사는 필요 없다");

    for (name, description) in &maison {
        for (fragment, why) in PRESUPPOSING {
            assert!(
                !description.contains(fragment),
                "{name}의 설명이 전제한다 ({why}): \"{fragment}\"\n{description}"
            );
        }
    }

    // **여기부터가 되돌아옴 방지를 넘어선다.** 위 표는 걷어 낸 조각을 그대로 못박는 것이라
    // **관사만 갈아 끼우면 빠져나간다** — 실제로 한 판 동안 그렇게 빠져나가 있었다
    // (`A branch they share is kept in every project repository`). 그래서 낱말이 아니라
    // **문장의 모양**을 본다: 저 세계에 없는 것을 말하는 문장은 조건절을 달고 있어야 한다.
    //
    // 프로젝트 도구 넷은 밖이다 — 넷은 프로젝트 세계 자체이고 Maison에서 통째로 거절된다.
    //
    // **fail-closed다.** 새 문장이 조건절 없이 브랜치를 말하면 표에 한 줄을 안 더해도
    // 그 자리에서 빨개진다. 반대 방향(조건절을 단 참인 문장)이 걸리는 것은 값이 싸다 —
    // `when it spans projects` 한 마디를 붙이면 되고, 그 마디가 곧 이 검사가 원하는 것이다.
    for (name, description) in &maison {
        if PROJECT_TOOLS.contains(&name.as_str()) {
            continue;
        }
        for sentence in description.split(". ") {
            let Some(word) = ABSENT_IN_MAISON.iter().find(|w| sentence.contains(*w)) else {
                continue;
            };
            assert!(
                CONDITIONAL.iter().any(|c| sentence.contains(c)),
                "{name}의 한 문장이 `{word}`를 조건절 없이 말한다 — Maison 에이전트는 그것을 \
                 자기 Room의 사실로 읽는다. `when …`·`any …`로 조건을 달아라.\n  {sentence}"
            );
        }
    }
}

/// **Room이 쓰는 도구는 프로젝트 도구를 가리키면 안 된다.** 지침이 「부르지 말라」고 해도
/// 인자 스키마가 이름을 대며 부르라고 하면 에이전트는 부른다 — 그리고 거절당하고 나서야
/// 안다. US 44가 없애려던 것이 정확히 그 순서다. (`atelier_start_work`의 `projects` doc이
/// 실제로 `atelier_list_projects`를 이름으로 불렀다.)
///
/// 프로젝트 도구 넷은 이 검사 밖이다 — 넷은 프로젝트 세계 자체이고 Maison에서 통째로
/// 거절되므로, 자기들끼리 이름을 부르는 것이 맞다 (`atelier_add_project`의 설명이
/// `atelier_edit_project`를 가리키는 것처럼). 표를 손으로 적지 않고 `PROJECT_TOOLS`의
/// 여집합으로 두는 것이 요점이다 — 도구가 하나 늘면 검사가 저절로 그것을 덮는다.
#[test]
fn the_tools_a_room_needs_do_not_send_the_agent_to_a_project_tool() {
    let home = tempfile::tempdir().unwrap();
    let surface = tool_descriptions(&mut Server::start_with_mode(home.path(), Some("maison")), 2);
    let room_tools: Vec<_> =
        surface.iter().filter(|(name, _)| !PROJECT_TOOLS.contains(&name.as_str())).collect();
    // 여집합이 비면 이 검사는 아무것도 안 잰다 — 12 − 4 = 8.
    assert_eq!(room_tools.len(), 8, "Room이 쓰는 도구가 여덟이 아니다: {:?}", surface.keys());

    for (name, text) in room_tools {
        for project_tool in PROJECT_TOOLS {
            assert!(
                !text.contains(project_tool),
                "{name}가 Maison에서 거절되는 도구를 부르라고 한다: {project_tool}\n{text}"
            );
        }
    }
}

/// **아카이브된 Room을 열면 없는 브랜치를 약속하지 않는다.**
///
/// `atelier_get_work`의 아카이브 안내는 `#[tool(description)]`과 달리 `&self` 메서드가
/// 내보내므로 **갈 수 있다** — 「도구 설명은 모드별로 못 가른다」는 이 티켓의 전제가 여기엔
/// 안 걸린다. 안 가르면 Room을 치운 뒤 여는 에이전트가 「워크트리는 사라졌고 브랜치는
/// 프로젝트 저장소에 남아 있다」를 읽고 없는 브랜치를 찾으러 간다 — 커널은 이미 같은 교훈을
/// 배웠고(`archiving_a_project_less_work_does_not_promise_a_surviving_branch`), 이 안내가
/// 가리키는 `record.md`에는 프로젝트가 없으면 git 좌표 섹션 자체가 안 실린다.
///
/// **두 갈래를 함께 잰다.** 부정 단언만 두면 언제나 「없음」 문구를 쓰도록 회귀시켜도
/// 통과한다 (`archiving_a_work_with_a_branch_says_the_commits_are_recoverable`가 같은 이유로
/// 짝을 이룬다).
#[test]
fn opening_an_archived_room_does_not_point_at_a_branch_that_never_existed() {
    let (home, _code) = fixture_with(&["billing"]);

    let mut maison = Server::start_with_mode(home.path(), Some("maison"));
    maison.request(2, "tools/call", json!({
        "name": "atelier_start_work", "arguments": { "title": "금융", "slug": "finance" }
    }));
    let archived = maison.request(3, "tools/call",
        json!({ "name": "atelier_archive_work", "arguments": { "work_slug": "finance" } }));
    assert_eq!(archived["result"]["isError"], false, "{archived}");

    let got = maison.request(4, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "finance" } }));
    let view: Value =
        serde_json::from_str(got["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["origin"], "archive", "{view}");
    let note = got["result"]["content"][1]["text"].as_str().unwrap();
    assert!(
        !note.contains("the branch is still in the project repositories"),
        "Room에 없는 브랜치를 약속했다: {note}"
    );
    assert!(!note.contains("worktrees"), "Room에 없던 워크트리를 말한다: {note}");
    assert!(!note.contains("git coordinates"), "Room의 record.md엔 좌표가 없다: {note}");
    // 아카이브의 규약은 그대로 있어야 한다 — 갈랐다고 「여기 쓰지 마라」까지 잃으면 안 된다.
    assert!(note.contains("Do not write into `specDir`"), "{note}");

    // 반대 갈래 — 프로젝트가 있던 work는 여전히 브랜치를 가리킨다. 없으면 언제나 「없음」
    // 문구를 쓰도록 회귀시켜도 이 검사가 초록으로 남는다.
    let mut atelier = Server::start_with_mode(home.path(), Some("atelier"));
    atelier.request(2, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));
    atelier.request(3, "tools/call",
        json!({ "name": "atelier_archive_work", "arguments": { "work_slug": "cart" } }));
    let got = atelier.request(4, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "cart" } }));
    let note = got["result"]["content"][1]["text"].as_str().unwrap();
    assert!(
        note.contains("the branch is still in the project repositories"),
        "코드가 있던 work의 브랜치 좌표가 사라졌다: {note}"
    );
}
