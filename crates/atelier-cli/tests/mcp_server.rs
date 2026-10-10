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

/// 서버를 띄우는 명령 한 벌. 격리 env(홈·스킬 루트)를 여기서 세운다 — 검사가 개발자의 실제
/// `~/.atelier`나 `~/.claude/skills`를 건드리지 않게.
fn spawn_command(home: &std::path::Path) -> Command {
    let mut cmd = Command::cargo_bin("atelier").unwrap();
    cmd.arg("mcp")
        .env("ATELIER_HOME", home)
        // 기동 시 정리(Δ11)가 개발자의 실제 ~/.claude/skills 를 건드리지 않게 한다.
        .env("ATELIER_SKILLS_DIR", home.join("skills-guard"));
    cmd
}

impl Server {
    fn start(home: &std::path::Path) -> Self {
        Self::start_from(spawn_command(home))
    }

    /// 손본 명령으로 띄운다 — 셸에 무엇이 남아 있는 상태를 흉내 낼 때 쓴다(`spawn_command`로 지은 것에 env를 더한다).
    fn start_from(mut command: Command) -> Self {
        let mut child = command
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
        &home.path().join("projects"),
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
        &home.path().join("projects"),
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
        &home.path().join("projects"),
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
    // 판 폴더는 이제 이름 틀로 말한다 — `NN-<name>/`이 `{n}-{name}/`이 됐다 (허용 차이 1)
    for name in ["overview.md", "{n}-{name}/", "tickets/", "research/", "explanation/"] {
        assert!(guidance.contains(name), "'{name}' missing from the guidance: {guidance}");
    }
    // 고정하는 것은 나열된 이름뿐이라는 것과, 첫 판을 어디서 시작하는지
    assert!(guidance.contains("file names are free"), "{guidance}");
    assert!(guidance.contains("01-"), "the first iteration folder is not named: {guidance}");

    // 관습은 데이터 모델이 아니다 — 커널이 준 뷰에는 한 글자도 실리지 않는다.
    // 머리 줄을 본다: 안내문에만 있는 글자라, 새면 곧 안내문이 샌 것이다.
    let kernel = atelier_core::get_work(&home.path().join("works"), "카트").unwrap();
    let kernel_json = serde_json::to_string(&kernel).unwrap();
    for leaked in ["Spec layout —", "explanation"] {
        assert!(
            !kernel_json.contains(leaked),
            "the folder convention leaked into the kernel view: {kernel_json}"
        );
    }
}

/// 내장 레이아웃을 render한 글. 레이아웃 폴더가 없는 홈에서 에이전트가 받는 안내문이다.
///
/// 글자 자체는 엔진의 기대값 파일이 고정한다 — 여기서 재는 것은 **배선**, 곧 그 글이 응답의 어느
/// 자리에 실리는가다.
fn builtin_guidance() -> String {
    atelier_core::render_layout(&atelier_core::builtin_layout(), None, None).text
}

/// 판 01 — 고정 안내문 자리에 **내장 레이아웃을 render한 글**이 선다.
#[test]
fn get_work_carries_the_builtin_layout() {
    let home = tempfile::tempdir().unwrap();
    plant(&home.path().join("works"), "cart", "카트");

    let mut server = Server::start(home.path());
    let res = server.request(2, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "cart" } }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let content = res["result"]["content"].as_array().unwrap();
    assert_eq!(content.len(), 2, "JSON 하나와 안내문 하나여야 한다: {res}");
    assert_eq!(content[1]["text"], builtin_guidance(), "{res}");
}

/// 두 도구의 응답에 spec 레이아웃이 실린다는 것을 **도구 설명이 말한다** — 에이전트는 설명을 보고
/// 어느 응답을 읽을지 고른다. 「폴더 이름의 뜻」이라고 적어 두면 틀린 약속이 된다: 이름은 이제
/// 레이아웃마다 다르다.
#[test]
fn the_tools_that_answer_with_the_spec_layout_say_so() {
    let home = tempfile::tempdir().unwrap();
    let res = Server::start(home.path()).request(2, "tools/list", json!({}));
    let description = |name: &str| {
        res["result"]["tools"].as_array().unwrap().iter()
            .find(|t| t["name"] == name)
            .and_then(|t| t["description"].as_str())
            .unwrap_or_else(|| panic!("{name} is not listed: {res}"))
            .to_string()
    };
    for name in ["atelier_get_work", "atelier_start_work"] {
        let text = description(name);
        assert!(text.contains("carries the spec layout"), "{name}: {text}");
    }
    let get_work = description("atelier_get_work");
    assert!(!get_work.contains("folder names"), "{get_work}");
}

/// 임시 홈의 `layouts/atelier/`에 파일 하나를 둔다 — 사용자가 손으로 두는 것과 같다.
fn plant_layout(home: &std::path::Path, file: &str, content: &str) {
    let folder = home.join("layouts/atelier");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join(file), content).unwrap();
}

/// `atelier_get_work`가 싣는 안내문 — 응답의 둘째 블록.
fn guidance_of(server: &mut Server, id: u32, slug: &str) -> String {
    let res = server.request(id, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": slug } }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    res["result"]["content"][1]["text"].as_str().unwrap_or_else(|| panic!("{res}")).to_string()
}

/// 판 01 — 손으로 둔 레이아웃 폴더가 안내문을 바꾼다. **서버를 다시 띄우지 않고** 파일을 바꾸면
/// 다음 호출에 바뀐 것이 실린다(spec 레이아웃 결정 9 — 호출마다 새로 읽는다).
///
/// 임시 홈은 홈 밖이라 `Template:` 경로가 줄지 않은 절대 경로로 실린다. 그 경로만 커널의 홈 축약
/// 함수로 만들고, 나머지 글자는 손으로 적었다 — 설명 열은 가장 긴 `  decisions.md`(14칸)에 두 칸을
/// 더한 16이다.
#[test]
fn a_hand_placed_layout_folder_changes_the_guidance_without_a_restart() {
    let home = tempfile::tempdir().unwrap();
    plant(&home.path().join("works"), "cart", "카트");
    plant_layout(home.path(), "layout.json", r#"{ "root": {
        "description": "Keep it small.",
        "children": [
          { "pattern": "decisions.md", "kind": "file", "icon": "scale",
            "description": "why we chose what we chose", "template": "decisions.md" },
          { "pattern": "notes", "kind": "folder", "description": "anything else" } ] } }"#);
    plant_layout(home.path(), "decisions.md", "# Decisions\n");

    let mut server = Server::start(home.path());
    let folder = atelier_core::collapse_home(&home.path().join("layouts/atelier"));
    assert!(folder.starts_with('/'), "임시 홈이 홈 안에 있다: {folder}");
    assert_eq!(
        guidance_of(&mut server, 2, "cart"),
        format!(
            "Spec layout — how to arrange documents inside `specDir`.\n\
             \n\
             Keep it small.\n\
             \n  decisions.md  why we chose what we chose\n\
             \x20               Template: {folder}/decisions.md\n\
             \x20 notes/        anything else\n\
             \n\
             A trailing `/` marks a folder, and indentation shows what goes inside it. Where a \
             file has a `Template:` line, read that template before you create the file and \
             follow its shape."
        )
    );

    // 같은 서버에 다시 묻는다 — 기동 때 읽어 둔 것이면 옛 안내가 그대로 나온다
    plant_layout(home.path(), "layout.json", r#"{ "root": {
        "description": "Now in rounds.",
        "children": [ { "pattern": "{n}-{name}", "kind": "folder", "description": "one round" } ] } }"#);
    assert_eq!(
        guidance_of(&mut server, 3, "cart"),
        "Spec layout — how to arrange documents inside `specDir`.\n\
         \n\
         Now in rounds.\n\
         \n  {n}-{name}/  one round\n\
         \n\
         `{n}` is a number and `{name}` is any name without `/`. A trailing `/` marks a folder, \
         and indentation shows what goes inside it."
    );
}

/// 깨진 레이아웃이면 **내장본** 안내문 앞에 물러섰다는 한 줄이 붙는다(spec 레이아웃 결정 15). 그 줄은 읽지 못한
/// 폴더와 까닭을 말하고, 사용자에게 알리되 부탁받기 전에는 고치지 말라고 한다.
#[test]
fn a_broken_layout_puts_a_fallback_line_before_the_builtin_guidance() {
    let home = tempfile::tempdir().unwrap();
    plant(&home.path().join("works"), "cart", "카트");
    plant_layout(home.path(), "layout.json",
        r#"{ "root": { "children": [ { "pattern": "a.md", "kind": "fil" } ] } }"#);

    let mut server = Server::start(home.path());
    let guidance = guidance_of(&mut server, 2, "cart");
    let (first, rest) = guidance.split_once("\n\n").unwrap();
    assert_eq!(rest, builtin_guidance(), "{guidance}");
    let folder = atelier_core::collapse_home(&home.path().join("layouts/atelier"));
    for phrase in [format!("`{folder}/`"), "root.children[0]".to_string(), "Tell the user".to_string()] {
        assert!(first.contains(&phrase), "{phrase:?}가 없다: {first}");
    }
}

/// MCP는 `settings.json`을 읽지 않는다(spec 레이아웃 결정 25) — 그 파일이 깨져 있어도 안내문은 그대로다.
#[test]
fn a_broken_settings_file_leaves_the_guidance_alone() {
    let home = tempfile::tempdir().unwrap();
    plant(&home.path().join("works"), "cart", "카트");
    std::fs::write(home.path().join("settings.json"), "{ not json").unwrap();

    let mut server = Server::start(home.path());
    assert_eq!(guidance_of(&mut server, 2, "cart"), builtin_guidance());
}

/// 판 02 — spec 트리는 **앱 쪽 work 응답에만** 붙는다(spec 레이아웃 구현 스펙 3절). 에이전트가 받는 work JSON은
/// 그대로라 불어나지 않는다. MCP와 앱이 같은 work 뷰를 쓰므로, 그 뷰에 필드를 더하는 변경이
/// 여기서 걸린다.
///
/// spec 문서와 레이아웃 폴더를 함께 심는다 — 트리가 샌다면 비지 않은 채로 샌다.
#[test]
fn the_work_json_agents_get_carries_no_spec_tree() {
    let home = tempfile::tempdir().unwrap();
    plant(&home.path().join("works"), "cart", "심은 것");
    std::fs::write(home.path().join("works/cart/spec/overview.md"), "# 개요\n").unwrap();
    plant_layout(home.path(), "layout.json",
        r#"{ "root": { "children": [ { "pattern": "overview.md", "kind": "file", "icon": "compass" } ] } }"#);

    let mut server = Server::start(home.path());
    let first_json = |res: &Value| -> Value {
        assert_eq!(res["result"]["isError"], false, "{res}");
        serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
    };

    let listed = first_json(&server.request(2, "tools/call",
        json!({ "name": "atelier_list_works", "arguments": {} })));
    let listed = listed.as_array().unwrap_or_else(|| panic!("{listed}"));
    assert_eq!(listed.len(), 1, "{listed:?}");

    let got = first_json(&server.request(3, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "cart" } })));

    let resumed = first_json(&server.request(4, "tools/call",
        json!({ "name": "atelier_start_work", "arguments": { "title": "심은 것", "slug": "cart" } })));
    let started = first_json(&server.request(5, "tools/call",
        json!({ "name": "atelier_start_work", "arguments": { "title": "새 것", "slug": "fresh" } })));

    for (tool, work) in [
        ("atelier_list_works", &listed[0]),
        ("atelier_get_work", &got),
        ("atelier_start_work (재개)", &resumed),
        ("atelier_start_work (새로)", &started),
    ] {
        // 대조군 — 엉뚱한 블록을 읽고 있으면 아래 단언이 늘 초록이다
        assert!(work["specFiles"].is_array(), "{tool}: work JSON이 아니다: {work}");
        assert!(work.get("specTree").is_none(), "{tool}: spec 트리가 샜다: {work}");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// spec 레이아웃 도구 — 에이전트가 레이아웃을 읽고 고쳐 저장한다 (#242, spec 레이아웃 결정 20·21·25)
//
// 규칙은 엔진 저장소가 L1로 잰다. 여기서 재는 것은 **배선**이다: 무엇이 응답의 어느 자리에
// 실리는가, 저장이 다음 `get_work`에 서버를 다시 띄우지 않고 닿는가.

/// 도구 하나를 부른 응답 전체.
fn call_tool(server: &mut Server, id: u32, name: &str, arguments: Value) -> Value {
    server.request(id, "tools/call", json!({ "name": name, "arguments": arguments }))
}

/// 응답의 첫 블록 — 기계가 읽는 JSON.
fn first_json(res: &Value) -> Value {
    let text = res["result"]["content"][0]["text"].as_str().unwrap_or_else(|| panic!("{res}"));
    serde_json::from_str(text).unwrap_or_else(|e| panic!("첫 블록이 JSON이 아니다 ({e}): {res}"))
}

/// 응답의 `i`번째 블록 글.
fn block_text(res: &Value, i: usize) -> String {
    res["result"]["content"][i]["text"].as_str().unwrap_or_else(|| panic!("블록 {i}가 없다: {res}")).to_string()
}

/// 형식 설명의 기대값. 저장소에 스냅샷 관례가 없어 기대값 파일과 견준다(안내문과 같은 방식).
/// 파일은 끝에 줄바꿈이 있고 응답의 글은 없다.
const LAYOUT_FORMAT: &str = include_str!("expected/spec-layout-format.txt");

/// `get`의 응답 모양 — JSON, 글, 그리고 **끝에** 형식 설명.
fn assert_ends_with_the_format(res: &Value) {
    let content = res["result"]["content"].as_array().unwrap_or_else(|| panic!("{res}"));
    assert_eq!(content.len(), 3, "JSON · 글 · 형식 설명이어야 한다: {res}");
    assert_eq!(format!("{}\n", block_text(res, 2)), LAYOUT_FORMAT, "형식 설명이 기대값과 다르다");
}

/// 레이아웃 폴더 아래 파일 전부와 그 내용 — 호출 전후를 견준다. 폴더가 없으면 빈 목록이다.
fn layout_files(home: &std::path::Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
    let folder = home.join("layouts/atelier");
    if !folder.exists() {
        return Vec::new();
    }
    let mut files: Vec<_> = walk_files(&folder)
        .into_iter()
        .map(|path| {
            let bytes = std::fs::read(&path).unwrap();
            (path, bytes)
        })
        .collect();
    files.sort();
    files
}

/// 레이아웃 도구는 **읽기와 저장 둘뿐이다.** 되돌리기는 사람이 설정 페이지에서 한다(spec 레이아웃 결정 21).
/// 만들기·지우기·고르기는 기능 자체가 없다(spec 레이아웃 결정 25) — 레이아웃은 하나다(ui-refresh 결정 23).
///
/// 이름에 `layout`이 든 도구를 통째로 잰다. 되돌리기 같은 도구가 이름에 `layout` 없이 더해지면
/// `listed_tools_are_exactly_this_wave`가 빨개진다 — 그 테스트가 도구 목록 전체를 고정한다.
#[test]
fn the_layout_tools_are_read_and_save_and_nothing_else() {
    let home = tempfile::tempdir().unwrap();
    let names = Server::start(home.path()).tool_names(2);
    let mut layout_tools: Vec<_> = names.iter().filter(|n| n.contains("layout")).cloned().collect();
    layout_tools.sort();
    assert_eq!(
        layout_tools,
        ["atelier_get_spec_layout", "atelier_save_spec_layout"],
        "레이아웃 도구는 읽기와 저장 둘뿐이다 — 되돌리기·만들기·지우기·고르기 도구는 없다"
    );
}

/// 두 도구의 설명이 **참조를 가르친다** — 설정 페이지가 복사해 준 `~/.atelier/layouts/atelier/`를
/// 받은 에이전트가 파일을 직접 고치지 않고 이 도구로 읽고 저장한다(spec 레이아웃 결정 23). 상주 지침은 350단어
/// 상한에 걸려 있어 여기가 그 자리다.
#[test]
fn both_layout_tools_teach_the_layout_reference_and_to_go_through_them() {
    let home = tempfile::tempdir().unwrap();
    let res = Server::start(home.path()).request(2, "tools/list", json!({}));
    for name in ["atelier_get_spec_layout", "atelier_save_spec_layout"] {
        let tool = res["result"]["tools"].as_array().unwrap().iter()
            .find(|t| t["name"] == name)
            .unwrap_or_else(|| panic!("{name} is not listed: {res}"));
        let description = tool["description"].as_str().unwrap().split_whitespace().collect::<Vec<_>>().join(" ");
        for phrase in [
            "`~/.atelier/layouts/atelier/` refers to this layout.",
            "Do not edit the files there yourself; read and save the layout with \
             atelier_get_spec_layout and atelier_save_spec_layout.",
        ] {
            assert!(description.contains(phrase), "{name}: {phrase:?}가 없다\n{description}");
        }
    }
}

/// **참조의 결합은 Rust 안에서 잰다**(spec 레이아웃 결정 23, 티켓 08). 설정 페이지의 [부탁]은
/// 엔진의 상태가 준 폴더 경로에 `/`를 붙여 복사하고(`refs.ts`의 `layoutDirRef` — 그 파일에는 레이아웃
/// 뿌리 글자가 없다), 그 참조를 붙여 받은 에이전트는 위 두 도구의 설명으로 뜻을 배운다. 기본 데이터
/// 루트에서 둘이 같은 모양이어야 붙인 한 줄이 에이전트에게 뜻을 가진다 — 레이아웃 폴더의 자리나 도구
/// 설명 한쪽만 바뀌면 여기서 빨개진다.
///
/// 기본 데이터 루트는 `ATELIER_HOME`이 없을 때 `data_root()`가 서는 자리다. 상태는 읽기만 한다.
#[test]
fn the_layout_reference_the_settings_page_copies_is_the_one_the_tools_teach() {
    const TAUGHT: &str = "~/.atelier/layouts/atelier/";

    let state = atelier_core::layout_state(&atelier_core::expand_home("~/.atelier"));
    assert_eq!(format!("{}/", state.folder), TAUGHT);

    let home = tempfile::tempdir().unwrap();
    let descriptions = tool_descriptions(&mut Server::start(home.path()), 2);
    for name in ["atelier_get_spec_layout", "atelier_save_spec_layout"] {
        let description = &descriptions[name];
        assert!(
            description.contains(&format!("`{TAUGHT}`")),
            "{name}이 참조를 안 가르친다:\n{description}"
        );
    }
}

/// `get`은 **인자 없이** 하나뿐인 레이아웃을 읽는다(ui-refresh 결정 22 · 23). 답에는 고르는 id가 없다 — 폴더,
/// 고침 여부, 레이아웃이다.
#[test]
fn get_spec_layout_takes_no_arguments_and_reads_the_one_layout() {
    let home = tempfile::tempdir().unwrap();
    plant_layout(home.path(), "layout.json",
        r#"{ "root": { "description": "mine", "children": [ { "pattern": "plan.md", "kind": "file" } ] } }"#);

    let mut server = Server::start(home.path());
    let res = call_tool(&mut server, 2, "atelier_get_spec_layout", json!({}));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let answer = first_json(&res);
    assert_eq!(answer["edited"], true, "{answer}");
    assert_eq!(answer["layout"]["root"]["description"], "mine", "{answer}");
    assert_eq!(answer["folder"], atelier_core::collapse_home(&home.path().join("layouts/atelier")), "{answer}");
    assert!(answer.get("id").is_none(), "읽기의 답에 레이아웃 id가 남았다: {answer}");
    assert_ends_with_the_format(&res);
}

/// 폴더가 없으면 **내장본을 디스크 형식으로** 준다 — 에이전트가 그것을 고쳐 그대로 저장에 돌려줄
/// 수 있는 모양이다. 템플릿은 없고(내장본에는 템플릿이 없다), 글은 `get_work`가 싣는 내장본 안내문이다.
#[test]
fn without_a_folder_get_spec_layout_hands_over_the_builtin_in_its_disk_form() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    let res = call_tool(&mut server, 2, "atelier_get_spec_layout", json!({}));
    let answer = first_json(&res);

    let builtin = atelier_core::builtin_layout();
    let disk_form: Value = serde_json::from_str(&atelier_core::serialize_layout(&builtin)).unwrap();
    assert_eq!(answer["layout"], disk_form, "{answer}");
    assert_eq!(answer["edited"], false, "{answer}");
    assert_eq!(answer["templates"], json!({}), "{answer}");
    assert_eq!(answer["warnings"], json!([]), "{answer}");
    assert_eq!(block_text(&res, 1), builtin_guidance());
    assert_ends_with_the_format(&res);
    assert!(!home.path().join("layouts").exists(), "읽기가 레이아웃 폴더를 만들었다");
}

/// 고친 레이아웃이면 `layout.json` 본문(모르는 키 포함), 템플릿 본문들, 그 레이아웃의 render 결과,
/// 경고(누락 템플릿), 고침 여부가 온다. render 결과는 `get_work`가 싣는 안내문과 같은 글이다.
#[test]
fn get_spec_layout_hands_over_the_layout_its_templates_its_guidance_and_the_format() {
    let home = tempfile::tempdir().unwrap();
    plant(&home.path().join("works"), "cart", "카트");
    plant_layout(home.path(), "layout.json", r#"{ "extends": "someday", "root": {
        "description": "Keep it small.",
        "children": [
          { "pattern": "decisions.md", "kind": "file", "icon": "scale", "color": "red",
            "description": "why we chose what we chose", "template": "decisions.md" },
          { "pattern": "handoff.md", "kind": "file", "template": "handoff.md" } ] } }"#);
    plant_layout(home.path(), "decisions.md", "# Decisions\n");

    let mut server = Server::start(home.path());
    let res = call_tool(&mut server, 2, "atelier_get_spec_layout", json!({}));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let answer = first_json(&res);
    let folder = atelier_core::collapse_home(&home.path().join("layouts/atelier"));

    assert_eq!(answer["edited"], true, "{answer}");
    assert_eq!(answer["folder"], folder.as_str(), "{answer}");
    assert_eq!(answer["layout"]["extends"], "someday", "모르는 키가 사라졌다: {answer}");
    assert_eq!(answer["layout"]["root"]["children"][0]["color"], "red", "모르는 키가 사라졌다: {answer}");
    assert_eq!(answer["templates"], json!({ "decisions.md": "# Decisions\n" }), "{answer}");
    assert_eq!(
        answer["warnings"],
        json!([format!("missing template for `handoff.md`: {folder}/handoff.md")]),
        "{answer}"
    );
    assert_eq!(block_text(&res, 1), guidance_of(&mut server, 3, "cart"));
    assert!(block_text(&res, 1).contains("Keep it small."), "{res}");
    assert_ends_with_the_format(&res);
}

/// 깨진 레이아웃은 **원문과 오류**가 온다 — 오류마다 제 위치가 붙는다. 에이전트는 사용자가 부탁하면
/// 그 원문을 고쳐 다시 저장한다.
#[test]
fn a_broken_layout_comes_back_as_its_raw_text_and_its_errors() {
    let home = tempfile::tempdir().unwrap();
    let raw = r#"{ "root": { "children": [ { "pattern": "a.md", "kind": "fil" } ] } }"#;
    plant_layout(home.path(), "layout.json", raw);

    let mut server = Server::start(home.path());
    let res = call_tool(&mut server, 2, "atelier_get_spec_layout", json!({}));
    assert_eq!(res["result"]["isError"], false, "읽기는 된다 — 깨진 것을 읽었을 뿐이다: {res}");
    let answer = first_json(&res);
    assert_eq!(answer["edited"], true, "{answer}");
    assert_eq!(answer["raw"], raw, "{answer}");
    assert_eq!(answer["errors"][0]["path"], json!([0]), "{answer}");
    assert!(answer["errors"][0]["message"].as_str().unwrap().contains("\"fil\""), "{answer}");
    assert!(answer.get("layout").is_none(), "깨진 레이아웃을 읽힌 것처럼 준다: {answer}");
    let note = block_text(&res, 1);
    assert!(note.contains("root.children[0]"), "글이 위치를 말하지 않는다: {note}");
    assert!(note.contains("atelier_save_spec_layout"), "고치는 길을 말하지 않는다: {note}");
    assert_ends_with_the_format(&res);
}

/// 잘못된 레이아웃은 **`isError`와 위치**가 오고, 호출 전후로 레이아웃 폴더의 파일 목록과 내용이
/// 같다. 폴더가 없던 홈에는 폴더도 생기지 않는다.
#[test]
fn save_refuses_an_invalid_layout_with_where_and_writes_nothing() {
    let invalid = json!({ "root": { "children": [
        { "pattern": "decisions.md", "kind": "file", "template": "decisions.md" },
        { "pattern": "docs", "kind": "folder", "children": [ { "pattern": "{x}.md", "kind": "file" } ] } ] } });
    let refuse = |home: &std::path::Path| {
        let mut server = Server::start(home);
        let res = call_tool(&mut server, 2, "atelier_save_spec_layout", json!({
            "layout": invalid, "templates": { "decisions.md": "# 덮어쓰면 안 된다\n" }
        }));
        assert!(res["error"].is_null(), "프로토콜 오류가 아니라 실행 오류여야 한다: {res}");
        assert_eq!(res["result"]["isError"], true, "{res}");
        let text = block_text(&res, 0);
        assert!(text.contains("root.children[1].children[0]"), "위치가 없다: {text}");
        assert!(text.contains("nothing was written"), "{text}");
        let errors = serde_json::from_str::<Value>(&block_text(&res, 1)).unwrap();
        assert_eq!(errors["errors"][0]["path"], json!([1, 0]), "{errors}");
    };

    let home = tempfile::tempdir().unwrap();
    plant_layout(home.path(), "layout.json",
        r#"{ "root": { "children": [ { "pattern": "decisions.md", "kind": "file", "template": "decisions.md" } ] } }"#);
    plant_layout(home.path(), "decisions.md", "# Decisions\n");
    let before = layout_files(home.path());
    refuse(home.path());
    assert_eq!(layout_files(home.path()), before);

    let bare = tempfile::tempdir().unwrap();
    refuse(bare.path());
    assert!(!bare.path().join("layouts").exists(), "거절된 저장이 가림 폴더를 만들었다");
}

/// 올바른 레이아웃이면 **가림 폴더와 파일이 생기고** 저장한 레이아웃의 render 결과가 온다. 그 뒤
/// `get_work`의 안내문이 **서버를 다시 띄우지 않아도** 바뀐다(spec 레이아웃 결정 9) — 에이전트가 부탁받은 일의 끝이다.
#[test]
fn save_creates_the_hiding_folder_and_the_next_get_work_follows_without_a_restart() {
    let home = tempfile::tempdir().unwrap();
    plant(&home.path().join("works"), "cart", "카트");
    let mut server = Server::start(home.path());
    assert_eq!(guidance_of(&mut server, 2, "cart"), builtin_guidance());

    let res = call_tool(&mut server, 3, "atelier_save_spec_layout", json!({
        "layout": { "root": { "description": "Keep it small.", "children": [
            { "pattern": "decisions.md", "kind": "file", "description": "why we chose what we chose",
              "template": "decisions.md" },
            { "pattern": "adr", "kind": "folder", "description": "one record per decision" } ] } },
        "templates": { "decisions.md": "# Decisions\n" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    let folder = home.path().join("layouts/atelier");
    let shown = atelier_core::collapse_home(&folder);
    let guidance = block_text(&res, 1);
    assert_eq!(
        guidance,
        format!(
            "Spec layout — how to arrange documents inside `specDir`.\n\
             \n\
             Keep it small.\n\
             \n  decisions.md  why we chose what we chose\n\
             \x20               Template: {shown}/decisions.md\n\
             \x20 adr/          one record per decision\n\
             \n\
             A trailing `/` marks a folder, and indentation shows what goes inside it. Where a \
             file has a `Template:` line, read that template before you create the file and \
             follow its shape."
        )
    );
    // 기계가 읽는 답은 경고뿐이다 — 고르는 id가 없다(ui-refresh 결정 23)
    assert_eq!(first_json(&res), json!({ "warnings": [] }), "{res}");
    assert_eq!(std::fs::read_to_string(folder.join("decisions.md")).unwrap(), "# Decisions\n");
    assert!(folder.join("layout.json").is_file(), "가림 폴더에 layout.json이 없다");

    assert_eq!(guidance_of(&mut server, 4, "cart"), guidance, "같은 서버의 다음 get_work가 안 따라왔다");
}

/// 템플릿 **하나만** 넘겨 저장하면 나머지 템플릿 본문은 그대로다 — 에이전트는 바꾸는 것만 넘긴다.
#[test]
fn saving_with_one_template_leaves_the_other_bodies_as_they_are() {
    let home = tempfile::tempdir().unwrap();
    plant_layout(home.path(), "layout.json", r#"{ "root": { "children": [
        { "pattern": "decisions.md", "kind": "file", "template": "decisions.md" },
        { "pattern": "handoff.md", "kind": "file", "template": "handoff.md" } ] } }"#);
    plant_layout(home.path(), "decisions.md", "# 사람이 고친 결정 틀\n");
    plant_layout(home.path(), "handoff.md", "# Handoff\n");

    let mut server = Server::start(home.path());
    let got = first_json(&call_tool(&mut server, 2, "atelier_get_spec_layout", json!({})));
    let res = call_tool(&mut server, 3, "atelier_save_spec_layout", json!({
        "layout": got["layout"], "templates": { "handoff.md": "# Handoff\n\n## Next\n" }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");

    let folder = home.path().join("layouts/atelier");
    assert_eq!(std::fs::read_to_string(folder.join("decisions.md")).unwrap(), "# 사람이 고친 결정 틀\n");
    assert_eq!(std::fs::read_to_string(folder.join("handoff.md")).unwrap(), "# Handoff\n\n## Next\n");
}

/// **`id`는 모르는 인자다**(ui-refresh 결정 22) — 레이아웃은 하나라 고를 것이 없다. 옛 호출처럼 `id`를 실어
/// 오면 읽기도 저장도 인자 오류로 거절되고, 아무것도 쓰이지 않는다 — 데이터 루트 밖에도, 안에도. 조용히
/// 무시하면 다른 id를 실은 에이전트가 제가 고른 줄 알고 하나뿐인 레이아웃을 덮어쓴다.
#[test]
fn an_id_is_an_unknown_argument_and_nothing_is_written() {
    let outer = tempfile::tempdir().unwrap();
    let home = outer.path().join("home");
    std::fs::create_dir(&home).unwrap();
    let mut before = walk_files(outer.path());
    before.sort();

    let mut server = Server::start(&home);
    for (i, id) in ["atelier", "gallery", "../.."].into_iter().enumerate() {
        let saved = call_tool(&mut server, 2 + 2 * i as u32, "atelier_save_spec_layout", json!({
            "id": id,
            "layout": { "root": { "children": [ { "pattern": "a.md", "kind": "file", "template": "a.md" } ] } },
            "templates": { "a.md": "x" }
        }));
        let read = call_tool(&mut server, 3 + 2 * i as u32, "atelier_get_spec_layout", json!({ "id": id }));
        for res in [&saved, &read] {
            assert_eq!(res["result"]["isError"], true, "{id:?}: 받았다: {res}");
            assert!(block_text(res, 0).contains("unknown field `id`"), "{id:?}: 어느 인자인지 말하지 않는다: {res}");
        }
    }
    let mut after = walk_files(outer.path());
    after.sort();
    assert_eq!(after, before);
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
///  #69가 atelier_list_archive를 더해 12개, #242가 레이아웃 도구 둘을 더해 14개가 됐다.)
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
            "atelier_get_spec_layout",
            "atelier_get_work",
            "atelier_list_archive",
            "atelier_list_projects",
            "atelier_list_works",
            "atelier_remove_work",
            "atelier_save_spec_layout",
            "atelier_set_work_status",
            "atelier_start_work",
        ]
    );
}

/// 읽기 전용 계약을 지켜야 하는 도구들. 쓰기 도구는 단계 6에서 따로 본다.
const READ_ONLY_TOOLS: [&str; 5] = [
    "atelier_get_spec_layout",
    "atelier_get_work",
    "atelier_list_archive",
    "atelier_list_projects",
    "atelier_list_works",
];

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

/// 새 work를 만든 세션은 `atelier_get_work` 없이 곧장 문서를 쓴다(spec 레이아웃 결정 9) — 그래서
/// `atelier_start_work`의 응답에도 안내문이 **JSON 뒤에** 실린다. 새로 만들 때도, 같은 slug로
/// 재개할 때도 그렇다.
#[test]
fn start_work_answers_with_the_spec_layout_after_the_json() {
    let home = tempfile::tempdir().unwrap();
    let mut server = Server::start(home.path());
    for (id, when) in [(2, "새로 만들 때"), (3, "재개할 때")] {
        let res = server.request(id, "tools/call", json!({
            "name": "atelier_start_work",
            "arguments": { "title": "카트", "slug": "cart" }
        }));
        assert_eq!(res["result"]["isError"], false, "{when}: {res}");
        let content = res["result"]["content"].as_array().unwrap();
        assert_eq!(content.len(), 2, "{when}: JSON 하나와 안내문 하나여야 한다: {res}");
        // 기계가 읽는 JSON이 먼저다
        let report: Value = serde_json::from_str(content[0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(report["slug"], "cart", "{when}: {report}");
        assert_eq!(content[1]["text"], builtin_guidance(), "{when}: {res}");
    }
}

/// 부분 실패도 spec 폴더는 이미 서 있다 — 에이전트가 이어서 쓰는 곳이 거기다. 그래서 안내문이
/// **셋째 블록**으로 붙는다. 앞 둘(복구 안내 → 보고서 JSON)의 순서는 그대로다.
#[test]
fn a_partial_start_carries_the_spec_layout_as_the_third_block() {
    let (home, _code) = fixture_with(&["billing", "shipping"]);
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing"], "branch": "feat/cart" }
    }));
    block_worktree(home.path(), "카트", "shipping");

    let res = server.request(4, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing", "shipping"], "branch": "feat/cart" }
    }));
    assert_eq!(res["result"]["isError"], true, "{res}");
    let content = res["result"]["content"].as_array().unwrap();
    assert_eq!(content.len(), 3, "복구 안내, 보고서, 안내문 셋이어야 한다: {res}");
    assert!(content[0]["text"].as_str().unwrap().contains("atelier_attach_project"), "{res}");
    let report: Value = serde_json::from_str(content[1]["text"].as_str().unwrap()).unwrap();
    assert_eq!(report["errors"][0]["project"], "shipping", "{report}");
    assert_eq!(content[2]["text"], builtin_guidance(), "{res}");
}

/// `atelier_attach_project`는 부분 실패 응답을 `atelier_start_work`와 함께 쓴다. 안내문을 붙이는
/// 자리는 start_work 쪽이라 attach 응답에는 없다 — 성공이든 부분 실패든.
#[test]
fn attach_project_answers_without_the_spec_layout() {
    let (home, _code) = fixture_with(&["billing", "shipping"]);
    let mut server = Server::start(home.path());
    server.request(3, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "projects": ["billing"], "branch": "feat/cart" }
    }));
    let blocker = block_worktree(home.path(), "카트", "shipping");
    let attach = json!({
        "name": "atelier_attach_project",
        "arguments": { "work_slug": "카트", "project_slug": "shipping" }
    });

    let failed = server.request(4, "tools/call", attach.clone());
    assert_eq!(failed["result"]["isError"], true, "{failed}");
    assert_eq!(failed["result"]["content"].as_array().unwrap().len(), 2, "{failed}");

    std::fs::remove_file(&blocker).unwrap();
    let attached = server.request(5, "tools/call", attach);
    assert_eq!(attached["result"]["isError"], false, "{attached}");
    assert_eq!(attached["result"]["content"].as_array().unwrap().len(), 1, "{attached}");

    for res in [&failed, &attached] {
        assert!(!res.to_string().contains("Spec layout"), "attach 응답에 안내문이 붙었다: {res}");
    }
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
    // 고정이 무엇을 하는지는 `pin_and_list_descriptions_say_where_a_pin_lands_and_who_orders_the_list`가 잰다
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

/// D2 · 스토리 21. 에이전트의 고정 한 번이 **깨진 순서 파일을 조용히 덮지 않는다** — 사람이 손으로
/// 고치던 바이트가 진행 중 루트 아래 어딘가에 남고, 고정은 여전히 먹으며, 남은 벌이 목록에 안 낀다.
#[test]
fn edit_work_pin_over_a_broken_order_file_keeps_the_persons_bytes() {
    let home = tempfile::tempdir().unwrap();
    let works = home.path().join("works");
    for slug in ["a-work", "b-work"] {
        plant(&works, slug, slug);
    }
    let broken = r#"{"order":["b-work", "a-work" 손으로 고치다 멈춤"#;
    std::fs::write(works.join(".order.json"), broken).unwrap();

    let mut server = Server::start(home.path());
    let res = server.request(3, "tools/call", json!({
        "name": "atelier_edit_work", "arguments": { "work_slug": "b-work", "pinned": true }
    }));
    assert_eq!(res["result"]["isError"], false, "{res}");
    assert_eq!(work_titles(&mut server, 4), vec!["b-work", "a-work"], "벌이 목록에 끼었다");

    let kept = walk_files(&works)
        .into_iter()
        .find(|path| std::fs::read_to_string(path).is_ok_and(|content| content == broken));
    assert!(
        kept.is_some(),
        "깨진 순서 파일의 바이트가 고정 한 번에 사라졌다 — 남은 순서 파일: {:?}",
        std::fs::read_to_string(works.join(".order.json")).ok()
    );

    // 흔적은 **stderr에** 벌의 경로로 남는다 — stdout은 프로토콜이라(위 `request`가 줄마다 잰다)
    // 진단이 새면 호스트가 끊긴다.
    let _ = server.child.kill();
    let mut stderr = String::new();
    std::io::Read::read_to_string(&mut server.child.stderr.take().unwrap(), &mut stderr).unwrap();
    let kept = kept.unwrap();
    assert!(
        stderr.contains(&kept.display().to_string()),
        "벌을 떴다는 줄이 stderr에 벌의 경로를 안 적었다 ({}): {stderr}",
        kept.display()
    );
}

/// 루트 아래 파일 전부(하위 폴더 포함). 벌의 이름은 이 검사가 정하지 않는다.
fn walk_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                files.push(path);
            }
        }
    }
    files
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
    assert!(!note.contains("Spec layout"), "아카이브에 spec 레이아웃을 안내했다: {note}");
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

    // 레이아웃 저장은 빠진 템플릿을 지우므로 파괴적이다. 같은 인자면 같은 폴더가 되므로 멱등이다.
    let a = hints("atelier_save_spec_layout");
    assert_eq!(a["readOnlyHint"], false, "{a}");
    assert_eq!(a["destructiveHint"], true, "it deletes the templates a layout drops: {a}");
    assert_eq!(a["idempotentHint"], true, "the same arguments leave the same folder: {a}");
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
// 심어 두고 읽는 도구들

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

/// **셸에 옛 모드 값이 남아 있어도 같은 서버가 뜬다**(ui-refresh 결정 22). 서버는 그 값을 읽지 않는다 —
/// 이미 떠 있는 셸이 그 값(`maison`)을 들 수 있고, 그 셸에서 띄운 `claude`가 그 값을 든 채로 이 서버를 띄운다.
/// 「없는 것을 지키는 검사를 두지 않는다」의 예외다: 그 셸들이 실제로 있다.
///
/// 뜨는 것만 보면 모르는 값에도 뜨는지만 잰다 — **같은 지침 · 같은 도구 · 등록부를 읽는 목록**까지 본다.
#[test]
fn a_shell_still_carrying_the_old_mode_value_starts_the_same_server() {
    let (home, _code) = fixture();
    let mut leftover = spawn_command(home.path());
    leftover.env("ATELIER_MODE", "maison");
    let mut leftover = Server::start_from(leftover);
    let mut bare = Server::start(home.path());

    assert_eq!(
        leftover.init["result"]["instructions"], bare.init["result"]["instructions"],
        "남은 모드 값이 지침을 바꿨다"
    );
    let tools = leftover.tool_names(2);
    assert_eq!(tools, bare.tool_names(2), "남은 모드 값이 도구 목록을 바꿨다");
    assert!(tools.contains(&"atelier_list_projects".to_string()), "{tools:?}");

    let res = leftover.request(3, "tools/call", json!({ "name": "atelier_list_projects", "arguments": {} }));
    assert_eq!(res["result"]["isError"], false, "남은 모드 값이 등록부를 막았다: {res}");
    let views: Value = serde_json::from_str(res["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(views[0]["slug"], "billing", "{views}");
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
    assert_eq!(tools.len(), 14, "도구 수가 달라졌다 — 설명 검사가 무엇을 읽는지 다시 세라: {res}");
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

/// **아카이브된, 프로젝트 없던 work을 열면 없는 브랜치를 약속하지 않는다.**
///
/// `atelier_get_work`의 아카이브 안내는 `branch`의 유무로 갈린다. 안 가르면 프로젝트 없던 work을
/// 치운 뒤 여는 에이전트가 「워크트리는 사라졌고 브랜치는
/// 프로젝트 저장소에 남아 있다」를 읽고 없는 브랜치를 찾으러 간다 — 커널은 이미 같은 교훈을
/// 배웠고(`archiving_a_project_less_work_does_not_promise_a_surviving_branch`), 이 안내가
/// 가리키는 `record.md`에는 프로젝트가 없으면 git 좌표 섹션 자체가 안 실린다.
///
/// **두 갈래를 함께 잰다.** 부정 단언만 두면 언제나 「없음」 문구를 쓰도록 회귀시켜도
/// 통과한다 (`archiving_a_work_with_a_branch_says_the_commits_are_recoverable`가 같은 이유로
/// 짝을 이룬다).
#[test]
fn opening_an_archived_project_less_work_does_not_point_at_a_branch_that_never_existed() {
    let (home, _code) = fixture_with(&["billing"]);
    let mut server = Server::start(home.path());

    server.request(2, "tools/call", json!({
        "name": "atelier_start_work", "arguments": { "title": "리서치만", "slug": "research" }
    }));
    let archived = server.request(3, "tools/call",
        json!({ "name": "atelier_archive_work", "arguments": { "work_slug": "research" } }));
    assert_eq!(archived["result"]["isError"], false, "{archived}");

    let got = server.request(4, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "research" } }));
    let view: Value =
        serde_json::from_str(got["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(view["origin"], "archive", "{view}");
    let note = got["result"]["content"][1]["text"].as_str().unwrap();
    assert!(
        !note.contains("the branch is still in the project repositories"),
        "프로젝트 없던 work에 없는 브랜치를 약속했다: {note}"
    );
    assert!(!note.contains("worktrees"), "프로젝트 없던 work에 없던 워크트리를 말한다: {note}");
    assert!(!note.contains("git coordinates"), "프로젝트 없던 work의 record.md엔 좌표가 없다: {note}");
    // 아카이브의 규약은 그대로 있어야 한다 — 갈랐다고 「여기 쓰지 마라」까지 잃으면 안 된다.
    assert!(note.contains("Do not write into `specDir`"), "{note}");

    // 반대 갈래 — 프로젝트가 있던 work는 여전히 브랜치를 가리킨다. 없으면 언제나 「없음」
    // 문구를 쓰도록 회귀시켜도 이 검사가 초록으로 남는다.
    server.request(5, "tools/call", json!({
        "name": "atelier_start_work",
        "arguments": { "title": "카트", "slug": "cart", "projects": ["billing"], "branch": "feat/cart" }
    }));
    server.request(6, "tools/call",
        json!({ "name": "atelier_archive_work", "arguments": { "work_slug": "cart" } }));
    let got = server.request(7, "tools/call",
        json!({ "name": "atelier_get_work", "arguments": { "work_slug": "cart" } }));
    let note = got["result"]["content"][1]["text"].as_str().unwrap();
    assert!(
        note.contains("the branch is still in the project repositories"),
        "코드가 있던 work의 브랜치 좌표가 사라졌다: {note}"
    );
}
