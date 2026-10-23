//! L1 — Thread의 승인은 판정 하나를 거친다(v1 티켓 22 · 구현 스펙 §9 · S17 · S18 · S19). Thread의 Session에 온 권한 요청은 모두
//! 판정을 지나 — 허용이면 묻지 않고 허락하며 까닭과 함께 `permission` 줄(`decided`)로 남고, 거절이면 묻지 않고 Agent에게 글을
//! 돌려주며, 물음이면 카드 종류와 Policy 이름을 단 물음 줄이 선다. `claude`는 기본 모드로만(「계획만」이면 계획 모드로) 뜬다.
//!
//! 시험은 호스트의 Thread 명령과 Thread 기록(`events.jsonl`) · 가짜 claude의 영수증(받은 인자 · stdin 줄)만 본다. 판정 표의 모든
//! 갈래는 판정 함수의 표 검사(`src/policy.rs`)가 덮는다 — 여기서는 엔진에 이어졌는지를 본다.

mod common;

use atelier_acp::{AskLevel, ConversationHost, HostError, StartPicks, ThreadLink};
use common::{of_kind, Sandbox, RECORDED_PLACE};
use serde_json::{json, Value};

/// Host는 범위 안 아무 Agent나 부른다(S15). `policy`는 frontmatter에 그대로 붙는 줄들이다.
fn host_md(policy: &str) -> String {
    format!("---\nname: Host\ntools:\n  agents: any\n{policy}---\n\n너는 시험 Thread의 Host다.\n")
}

fn agent_md(name: &str) -> String {
    format!("---\nname: {name}\n---\n\n너는 시험 Thread의 {name}다.\n")
}

fn in_cart() -> ThreadLink {
    ThreadLink::Work { slug: "cart".into() }
}

/// Work `cart`의 물어보는 정도를 미리 정해 둔다 — Work에 이은 Thread는 Work 폴더의 점 파일을 읽는다(S18).
fn cart_mode(sandbox: &Sandbox, mode: &str) {
    std::fs::write(sandbox.work_dir("cart").join(".policy.json"), json!({"mode": mode}).to_string()).unwrap();
}

/// 그 참여자의 `permission` 줄들.
fn permissions<'a>(record: &'a [Value], who: &str) -> Vec<&'a Value> {
    of_kind(record, "permission").into_iter().filter(|line| line["who"] == who).collect()
}

/// 그 참여자의 권한 줄 가운데 그 상태인 것이 나올 때까지 기다린다 — 그 줄.
fn wait_permission(sandbox: &Sandbox, thread: &str, who: &str, state: &str) -> Value {
    let record = sandbox.wait_thread_record(thread, |record| {
        permissions(record, who).iter().any(|line| line["payload"]["state"] == state)
    });
    permissions(&record, who).into_iter().find(|line| line["payload"]["state"] == state).cloned().expect("기다린 줄")
}

/// 그 참여자의 턴 끝이 `n`개 적힐 때까지 기다린다.
fn wait_turns_of(sandbox: &Sandbox, thread: &str, who: &str, n: usize) -> Vec<Value> {
    sandbox.wait_thread_record(thread, |record| {
        record.iter().filter(|line| line["kind"] == "turn-end" && line["who"] == who).count() >= n
    })
}

/// 그 Session의 claude가 받은 권한 답(`can_use_tool`의 답)들.
fn decisions(sandbox: &Sandbox, session: &str) -> Vec<Value> {
    sandbox
        .claude_stdin(session)
        .into_iter()
        .filter(|line| line["type"] == "control_response")
        .map(|line| line["response"]["response"].clone())
        .collect()
}

/// 그 Session의 claude가 받은 인자.
fn args_of(sandbox: &Sandbox, session: &str) -> Vec<String> {
    let receipt = sandbox.claude_receipt(session);
    receipt["args"].as_array().expect("인자").iter().map(|arg| arg.as_str().unwrap_or_default().to_owned()).collect()
}

/// 받은 인자의 `--permission-mode` 값.
fn permission_mode(args: &[String]) -> Option<&str> {
    args.iter().position(|arg| arg == "--permission-mode").map(|at| args[at + 1].as_str())
}

/// 사람이 그 물음을 그 선택지로 답한다.
fn answer(host: &ConversationHost, thread: &str, asked: &Value, option: &str) {
    let who = asked["who"].as_str().expect("물은 참여자");
    let request = asked["payload"]["requestId"].as_str().expect("요청 id");
    host.answer_thread_permission(thread, who, request, option).expect("사람의 답");
}

#[test]
fn forbid에_걸린_요청은_사람에게_묻지_않고_policy의_글로_거절되며_claude는_그_글을_받는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md("policy:\n  forbid: [shell]\n"));
    // Host의 첫 턴은 명령(`Bash`)을 묻는다.
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/g4-background")]));
    let thread = host.start_thread("테스트를 돌려 줘", ThreadLink::NoWork).expect("새 Thread의 첫 말");

    let decided = wait_permission(&sandbox, &thread, "host", "decided");
    let record = sandbox.thread_record(&thread);
    let text = common::lines_text(&record);
    assert_eq!(permissions(&record, "host").len(), 1, "물음 줄 없이 판정 줄 하나다 — 승인 카드가 서지 않는다:\n{text}");
    let refused = "이 Agent의 Policy가 금지한 일이에요(forbid: shell) — 하지 말고 다른 길을 찾으세요";
    let payload = &decided["payload"];
    assert_eq!((payload["optionId"].clone(), payload["reason"].clone()), (json!("reject"), json!(refused)), "{text}");
    assert_eq!(payload["toolCall"]["kind"], "execute", "받은 요청을 함께 남긴다");
    let session = sandbox.thread_session_id(&thread, "host");
    assert_eq!(decisions(&sandbox, &session), [json!({"behavior": "deny", "message": refused})]);

    host.shut_down();
}

#[test]
fn claude의_금지_규칙이_앞머리로_놓친_git_전역_옵션_뒤의_push는_판정이_둘째_줄로_거절한다() {
    // 코드 리뷰 1차 A1 — 변환기가 넘기는 `--disallowedTools Bash(git push *)`는 claude 쪽 앞머리 일치라 `git -C <dir> push`가 그대로
    // 샌다. 그 요청은 claude가 묻는 대로 판정에 오고, 판정이 하위 명령을 읽어 거절한다.
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md("policy:\n  forbid: [push]\n"));
    // 녹음의 명령(`python3 -c …`) 앞에 `git -C … push`를 붙인다 — `FAKE_CLAUDE_REROOT`는 내는 줄의 글 바꾸기다.
    let pushed = "git -C ../api push origin main && python3 -c";
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/g4-background"), ("FAKE_CLAUDE_REROOT", &format!("python3 -c={pushed}"))],
    ));
    let thread = host.start_thread("배경 작업을 돌려 줘", ThreadLink::NoWork).expect("새 Thread의 첫 말");

    let decided = wait_permission(&sandbox, &thread, "host", "decided");
    let session = sandbox.thread_session_id(&thread, "host");
    let args = args_of(&sandbox, &session);
    let first_line = args.iter().position(|arg| arg == "--disallowedTools").map(|at| args[at + 1].as_str());
    assert_eq!(first_line, Some("Bash(git push),Bash(git push *)"), "claude가 먼저 막는 줄은 앞머리 규칙이다");
    let command = decided["payload"]["toolCall"]["rawInput"]["command"].as_str().unwrap_or_default();
    assert!(command.starts_with(pushed), "claude는 그 줄로 막지 못하고 묻는다: {command}");
    let refused = "이 Agent의 Policy가 금지한 일이에요(forbid: push) — 하지 말고 다른 길을 찾으세요";
    let payload = &decided["payload"];
    assert_eq!((payload["optionId"].clone(), payload["reason"].clone()), (json!("reject"), json!(refused)));
    assert_eq!(decisions(&sandbox, &session), [json!({"behavior": "deny", "message": refused})]);

    host.shut_down();
}

#[test]
fn thread_폴더의_점_파일을_고치려는_편집은_편집은_허용이어도_묻지_않고_거절된다() {
    // 코드 리뷰 1차 A2 — Thread 폴더는 Work 없는 Thread의 작업 폴더지만 `.policy.json` · `thread.json` · `events.jsonl` · `agents/`는
    // Atelier만 쓴다. 그대로면 Agent가 묻지 않고 제 허락을 넓힌다.
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    // 녹음의 `Write`(`outside/allowed.txt`)를 작업 폴더(Thread 폴더)의 `.policy.json`으로 옮긴다.
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[
            ("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"),
            ("FAKE_CLAUDE_REBASE", RECORDED_PLACE),
            ("FAKE_CLAUDE_REROOT", "allowed.txt=.policy.json"),
        ],
    ));
    let thread = host
        .start_thread_asking("점 파일을 고쳐 줘", &[], ThreadLink::NoWork, Some(AskLevel::Edits))
        .expect("편집은 허용으로 새 Thread");

    let decided = wait_permission(&sandbox, &thread, "host", "decided");
    let record = sandbox.thread_record(&thread);
    assert_eq!(permissions(&record, "host").len(), 1, "물음 줄 없이 판정 줄 하나다:\n{}", common::lines_text(&record));
    let reason = decided["payload"]["reason"].as_str().expect("까닭").to_owned();
    assert_eq!(decided["payload"]["optionId"], "reject");
    assert!(reason.starts_with("Thread 기록이라 고칠 수 없어요: "), "{reason}");
    assert!(reason.contains(&format!("{thread}/.policy.json")), "{reason}");
    let session = sandbox.thread_session_id(&thread, "host");
    assert_eq!(decisions(&sandbox, &session), [json!({"behavior": "deny", "message": reason})]);

    host.shut_down();
}

#[test]
fn work_밖의_편집은_거절되고_그_경로가_등록된_project_안이면_고치기_시작_도구를_가리킨다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    sandbox.work("cart", &["fe"]);
    // 녹음의 `Write`가 쓰는 폴더의 위가 등록된 Project다 — 그 Project는 이 Work에 붙지 않았다.
    let projects = sandbox.data_root().join("projects");
    std::fs::create_dir_all(&projects).unwrap();
    std::fs::write(
        projects.join("gate.md"),
        "---\nname: gate\npath: /tmp/gate/ws/g1\nbaseBranch: main\ncreatedAt: 2026-10-10\n---\n",
    )
    .unwrap();
    // 경로를 옮기지 않는다 — Host의 `Write`는 잰 날의 임시 폴더를 고친다.
    cart_mode(&sandbox, "auto");
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio")]));
    let thread = host.start_thread("장바구니 수량을 고쳐 줘", in_cart()).expect("Work에 이은 Thread의 첫 말");

    let decided = wait_permission(&sandbox, &thread, "host", "decided");
    let reason = decided["payload"]["reason"].as_str().expect("까닭").to_owned();
    assert_eq!(decided["payload"]["optionId"], "reject", "알아서여도 Work 밖은 거절한다");
    assert!(reason.starts_with("Work 밖의 파일이라 고칠 수 없어요: "), "{reason}");
    assert!(reason.contains("gate/ws/g1/outside/allowed.txt"), "{reason}");
    assert!(reason.ends_with("— `gate` Project를 고치려면 먼저 Thread 도구 `start_editing`(Project 고치기 시작)을 부르세요"), "{reason}");
    let session = sandbox.thread_session_id(&thread, "host");
    assert_eq!(decisions(&sandbox, &session), [json!({"behavior": "deny", "message": reason})]);

    host.shut_down();
}

#[test]
fn 알아서에서_명령은_묻지_않고_허용_줄로_남고_ask_before에_걸린_명령은_카드_종류와_policy_이름으로_묻는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md("policy:\n  ask_before: [\"Bash(python3 *)\"]\n"));
    sandbox.library_agent("runner", &agent_md("러너"));
    sandbox.work("cart", &["fe"]);
    cart_mode(&sandbox, "auto");
    // 둘 다 첫 턴에 명령(`python3 -c …`)을 묻는다.
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/g4-background")]));

    let asking = host.start_thread("배경 작업을 돌려 줘", in_cart()).expect("Host의 Thread");
    let asked = wait_permission(&sandbox, &asking, "host", "asked");
    assert_eq!(
        (asked["payload"]["card"].clone(), asked["payload"]["policy"].clone()),
        (json!("command"), json!("「python3」 실행 전에 묻기")),
        "ask_before는 알아서보다 먼저다: {asked}"
    );
    assert_eq!(asked["payload"]["toolCall"]["kind"], "execute");

    let running = host.start_thread("@runner 배경 작업을 돌려 줘", in_cart()).expect("러너의 Thread");
    let decided = wait_permission(&sandbox, &running, "runner", "decided");
    let record = sandbox.thread_record(&running);
    assert_eq!(permissions(&record, "runner").len(), 1, "물음 줄이 없다:\n{}", common::lines_text(&record));
    assert_eq!(
        (decided["payload"]["optionId"].clone(), decided["payload"]["reason"].clone()),
        (json!("allow_once"), json!("알아서")),
        "자동으로 허용한 일은 까닭과 함께 남는다"
    );
    let runner = sandbox.thread_session_id(&running, "runner");
    assert_eq!(decisions(&sandbox, &runner)[0]["behavior"], "allow", "러너의 claude는 허락을 받고 이어 간다");

    host.shut_down();
}

#[test]
fn 편집은_허용에서_묻지_않고_허용한_편집도_쓰기_자리를_쥐어_같은_work의_다른_편집은_거절된다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    sandbox.library_agent("reviewer", &agent_md("리뷰어"));
    sandbox.library_agent("tester", &agent_md("테스터"));
    sandbox.work("cart", &["fe"]);
    cart_mode(&sandbox, "edits");
    // Host는 편집(`Write`)을 묻고 그 턴 끝머리에서 리뷰어를 불러 기다린다 — 리뷰어는 멈춤을 기다리는 긴 명령을 되감는다. 테스터는
    // 편집을 묻는다. 편집의 경로는 각자의 작업 폴더(worktree)로 옮긴다.
    let fixtures = json!({"reviewer": "2.1.309/interrupt-sigint"}).to_string();
    let call = json!([{"by": "host", "at": "result", "tool": "call_agent",
                       "arguments": {"handle": "reviewer", "task": "고친 것을 확인해 줘"}}])
    .to_string();
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[
            ("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"),
            ("FAKE_CLAUDE_AGENT_FIXTURES", &fixtures),
            ("FAKE_CLAUDE_MCP_CALL", &call),
            ("FAKE_CLAUDE_REBASE", RECORDED_PLACE),
        ],
    ));

    let writing = host.start_thread("장바구니 수량을 고쳐 줘", in_cart()).expect("Host의 Thread");
    let decided = wait_permission(&sandbox, &writing, "host", "decided");
    assert_eq!(
        (decided["payload"]["optionId"].clone(), decided["payload"]["reason"].clone()),
        (json!("allow_once"), json!("편집은 허용"))
    );
    assert_eq!(decided["payload"]["toolCall"]["kind"], "edit");
    sandbox.wait_thread_record(&writing, |record| {
        record.iter().any(|line| line["who"] == "reviewer" && line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });

    // Host의 턴이 리뷰어를 기다리며 도는 동안 — 묻지 않고 허용한 편집으로도 Host가 쓰기 자리를 쥐었다(§10 · S20).
    let other = host.start_thread("@tester 장바구니 문서를 고쳐 줘", in_cart()).expect("같은 Work의 다른 Thread");
    let refused = wait_permission(&sandbox, &other, "tester", "decided");
    assert_eq!(
        refused["payload"]["reason"],
        "「장바구니 수량을 고쳐 줘」 Thread의 @host가 이 Work를 고치는 중이에요 — 끝난 뒤 다시 하세요"
    );
    assert_eq!(refused["payload"]["optionId"], "reject");

    host.shut_down();
}

#[test]
fn 물어보는_정도는_work에_이은_thread면_work_점_파일에_아니면_thread_json에_두고_다음_요청부터_든다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    sandbox.work("cart", &["fe"]);
    // Host의 턴 둘이 각각 편집(`Write`)을 묻는다 — 경로는 작업 폴더로 옮긴다.
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"), ("FAKE_CLAUDE_REBASE", RECORDED_PLACE)],
    ));

    // Work 없는 Thread — 처음은 매번 묻기다.
    let thread = host.start_thread("메모를 써 줘", ThreadLink::NoWork).expect("Work 없는 Thread");
    let asked = wait_permission(&sandbox, &thread, "host", "asked");
    assert_eq!((asked["payload"]["card"].clone(), asked["payload"]["policy"].clone()), (json!("edit"), json!("매번 묻기")));
    answer(&host, &thread, &asked, "allow_once");
    wait_turns_of(&sandbox, &thread, "host", 1);

    host.set_thread_mode(&thread, AskLevel::Edits).expect("물어보는 정도 바꾸기");
    assert_eq!(sandbox.thread_json(&thread)["mode"], "edits", "Work 없는 Thread는 thread.json의 mode에 둔다");
    let mode = of_kind(&sandbox.thread_record(&thread), "mode").into_iter().next().cloned().expect("mode 줄");
    assert_eq!(mode["payload"], json!({"mode": "edits", "work": null}));
    assert!(mode.get("who").is_none_or(Value::is_null), "사람의 줄이다");

    host.send_to_thread(&thread, "하나 더 써 줘").expect("두 번째 말");
    let record = wait_turns_of(&sandbox, &thread, "host", 2);
    let text = common::lines_text(&record);
    let states: Vec<&Value> = permissions(&record, "host").iter().map(|line| &line["payload"]["state"]).collect();
    assert_eq!(states, [&json!("asked"), &json!("answered"), &json!("decided")], "다음 요청부터 묻지 않는다:\n{text}");
    assert_eq!(permissions(&record, "host")[2]["payload"]["reason"], "편집은 허용");

    // Work에 이은 Thread — Work 폴더의 점 파일에 두고 thread.json에는 두지 않는다.
    let linked = host.start_thread("장바구니를 고쳐 줘", in_cart()).expect("Work에 이은 Thread");
    wait_permission(&sandbox, &linked, "host", "asked");
    host.set_thread_mode(&linked, AskLevel::Plan).expect("물어보는 정도 바꾸기");
    let dot: Value =
        serde_json::from_str(&std::fs::read_to_string(sandbox.work_dir("cart").join(".policy.json")).unwrap()).unwrap();
    assert_eq!(dot["mode"], "plan");
    assert!(sandbox.thread_json(&linked)["mode"].is_null(), "Work의 것이다");
    let mode = of_kind(&sandbox.thread_record(&linked), "mode").into_iter().next().cloned().expect("mode 줄");
    assert_eq!(mode["payload"], json!({"mode": "plan", "work": "cart"}));

    host.shut_down();
}

#[test]
fn thread를_열면_지금_물어보는_정도가_함께_온다_work에_이은_thread는_work의_것이다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    sandbox.work("cart", &["fe"]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools")]));

    let plain = host.start_thread("안녕", ThreadLink::NoWork).expect("Work 없는 Thread");
    wait_turns_of(&sandbox, &plain, "host", 1);
    assert_eq!(host.thread(&plain).expect("Thread").ask_level, AskLevel::Always, "처음은 매번 묻기다");
    host.set_thread_mode(&plain, AskLevel::Auto).expect("물어보는 정도 바꾸기");
    assert_eq!(host.thread(&plain).expect("Thread").ask_level, AskLevel::Auto);

    let linked = host.start_thread("장바구니를 봐 줘", in_cart()).expect("Work에 이은 Thread");
    wait_turns_of(&sandbox, &linked, "host", 1);
    // 같은 Work의 다른 Thread가 바꾼 것 — 점 파일 하나를 함께 읽는다(S18).
    cart_mode(&sandbox, "edits");
    let view = host.thread(&linked).expect("Thread");
    assert_eq!((view.ask_level, view.file.mode.clone()), (AskLevel::Edits, None), "Work의 정도다 — thread.json의 mode가 아니다");
    let shown = serde_json::to_value(&view).expect("화면이 읽는 꼴");
    assert_eq!(shown["askLevel"], "edits", "화면은 askLevel 칸을 읽는다");

    host.shut_down();
}

/// 그 Session의 claude가 받은 권한 모드 바꾸기(`set_permission_mode`)의 모드들.
fn modes_sent(sandbox: &Sandbox, session: &str) -> Vec<String> {
    sandbox
        .claude_stdin(session)
        .into_iter()
        .filter(|line| line["type"] == "control_request" && line["request"]["subtype"] == "set_permission_mode")
        .map(|line| line["request"]["mode"].as_str().unwrap_or_default().to_owned())
        .collect()
}

#[test]
fn 계획만으로_들고_나면_떠_있는_session의_모드가_바뀌고_같은_work의_다른_thread도_함께_바뀐다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    sandbox.work("cart", &["fe"]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools")]));

    let plain = host.start_thread("안녕", ThreadLink::NoWork).expect("Work 없는 Thread");
    wait_turns_of(&sandbox, &plain, "host", 1);
    let session = sandbox.thread_session_id(&plain, "host");
    host.set_thread_mode(&plain, AskLevel::Plan).expect("계획만으로");
    assert_eq!(modes_sent(&sandbox, &session), ["plan"], "떠 있는 Session을 다시 띄우지 않고 모드만 바꾼다");
    host.set_thread_mode(&plain, AskLevel::Edits).expect("계획만에서 나감");
    host.set_thread_mode(&plain, AskLevel::Auto).expect("계획만 밖에서 바꿈");
    assert_eq!(modes_sent(&sandbox, &session), ["plan", "default"], "계획만 밖끼리는 claude의 모드가 같다 — 판정만 바뀐다");

    // 같은 Work에 이은 두 Thread — 정도는 Work의 것이라 한쪽에서 바꾸면 다른 쪽의 Session도 따른다.
    let one = host.start_thread("장바구니를 봐 줘", in_cart()).expect("Work의 Thread 하나");
    wait_turns_of(&sandbox, &one, "host", 1);
    let two = host.start_thread("결제를 봐 줘", in_cart()).expect("같은 Work의 다른 Thread");
    wait_turns_of(&sandbox, &two, "host", 1);
    host.set_thread_mode(&one, AskLevel::Plan).expect("Work를 계획만으로");
    assert_eq!(modes_sent(&sandbox, &sandbox.thread_session_id(&one, "host")), ["plan"]);
    assert_eq!(modes_sent(&sandbox, &sandbox.thread_session_id(&two, "host")), ["plan"], "다른 Thread의 Session도 계획 모드다");
    assert_eq!(modes_sent(&sandbox, &session), ["plan", "default"], "다른 Work의 Session은 그대로다");

    host.shut_down();
}

/// 최근 Work에 이은 새 Thread(v1 티켓 31 · S18) — 입력창 칩은 그 Work의 지금 정도를 읽고(`work_ask_level`), 첫 말 전에 다른 정도를
/// 고르면 그 Work의 정도가 바뀌며 흐름에 「Policy를 … 바꿈」 줄이 선다 — 이은 Thread의 칩에서 바꾼 것과 같다. 같은 정도면 아무것도
/// 바뀌지 않는다.
#[test]
fn 이은_work로_시작한_thread에서_고른_정도는_그_work의_정도가_되고_칩은_work의_지금_정도를_읽는다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    sandbox.work("cart", &[]);
    cart_mode(&sandbox, "auto");
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools")]));
    assert_eq!(host.work_ask_level("cart"), Ok(AskLevel::Auto), "칩이 읽는 그 Work의 지금 정도");
    assert_eq!(host.work_ask_level("nope"), Err(HostError::WorkNotFound("nope".into())));
    let asking = |mode| StartPicks { mode: Some(mode), ..StartPicks::default() };

    let same = host.start_thread_picking("장바구니를 봐 줘", &[], in_cart(), asking(AskLevel::Auto)).expect("같은 정도");
    let record = wait_turns_of(&sandbox, &same, "host", 1);
    assert!(of_kind(&record, "mode").is_empty(), "같은 정도면 바꾼 것이 아니다");
    assert_eq!(sandbox.thread_json(&same)["mode"], Value::Null, "이은 Thread의 정도는 thread.json에 서지 않는다");

    let picked = host.start_thread_picking("계획만 세워 줘", &[], in_cart(), asking(AskLevel::Plan)).expect("계획만으로");
    let record = wait_turns_of(&sandbox, &picked, "host", 1);
    assert_eq!(host.work_ask_level("cart"), Ok(AskLevel::Plan), "고른 정도가 그 Work의 정도가 된다(S18)");
    let changed: Vec<Value> = of_kind(&record, "mode").into_iter().map(|line| line["payload"].clone()).collect();
    assert_eq!(changed, [json!({"mode": "plan", "work": "cart"})], "바꾼 것이 흐름에 남는다");
    let args = args_of(&sandbox, &sandbox.thread_session_id(&picked, "host"));
    assert_eq!(permission_mode(&args), Some("plan"), "첫 Session부터 그 정도로 뜬다: {args:?}");
    host.shut_down();
}

#[test]
fn 새_thread는_첫_말과_함께_고른_정도로_서고_계획만이면_claude가_계획_모드로_뜬다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools")]));

    let thread = host
        .start_thread_asking("계획만 세워 줘", &[], ThreadLink::NoWork, Some(AskLevel::Plan))
        .expect("계획만으로 새 Thread");
    let record = wait_turns_of(&sandbox, &thread, "host", 1);
    assert_eq!(sandbox.thread_json(&thread)["mode"], "plan", "Work 없는 Thread의 정도는 thread.json에 선다");
    assert_eq!(host.thread(&thread).expect("Thread").ask_level, AskLevel::Plan);
    let args = args_of(&sandbox, &sandbox.thread_session_id(&thread, "host"));
    assert_eq!(permission_mode(&args), Some("plan"), "첫 Session부터 계획 모드다: {args:?}");
    assert!(of_kind(&record, "mode").is_empty(), "고른 채로 섰다 — 바꾼 줄이 아니다");

    host.shut_down();
}

#[test]
fn 편집은_허용으로_세운_thread의_첫_편집은_묻지_않고_허용되며_그_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    // Host의 첫 턴이 편집(`Write`)을 묻는다 — 경로는 Thread 폴더로 옮긴다(Thread 폴더 밖이면 판정이 거절한다).
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"), ("FAKE_CLAUDE_REBASE", RECORDED_PLACE)],
    ));

    let thread = host
        .start_thread_asking("outside/allowed.txt를 Write로 만들어", &[], ThreadLink::NoWork, Some(AskLevel::Edits))
        .expect("편집은 허용으로 새 Thread");
    let record = wait_turns_of(&sandbox, &thread, "host", 1);
    let lines = permissions(&record, "host");
    assert_eq!(lines.len(), 1, "물음 줄이 없다:\n{}", common::lines_text(&record));
    let payload = &lines[0]["payload"];
    assert_eq!(
        (payload["state"].clone(), payload["optionId"].clone(), payload["reason"].clone()),
        (json!("decided"), json!("allow_once"), json!("편집은 허용"))
    );
    let session = sandbox.thread_session_id(&thread, "host");
    assert_eq!(decisions(&sandbox, &session)[0]["behavior"], "allow");

    host.shut_down();
    // 화면의 방패 줄(v1 티켓 23 — `fold.test.ts`)과 Thread 화면의 L3(v1 티켓 28)가 자동 허용 줄을 이것으로 잰다.
    let settled = common::fix_thread_record(&common::commands_after_opened(&record), &sandbox.data_root(), &thread, &[&session]);
    common::assert_record("thread-auto-allow", &settled);
}

#[test]
fn 편집은_허용으로_세운_thread를_매번_묻기로_바꾸면_다음_편집부터_다시_묻고_그_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    // 녹음의 첫 턴은 편집을 허락받고 둘째 턴은 거절당한다 — 경로는 Thread 폴더로 옮긴다.
    let host = sandbox.host(sandbox.claude_login_shell(
        "normal",
        &[("FAKE_CLAUDE_FIXTURE", "2.1.309/permission-stdio"), ("FAKE_CLAUDE_REBASE", RECORDED_PLACE)],
    ));
    let thread = host
        .start_thread_asking("outside/allowed.txt를 Write로 만들어", &[], ThreadLink::NoWork, Some(AskLevel::Edits))
        .expect("편집은 허용으로 새 Thread");
    wait_turns_of(&sandbox, &thread, "host", 1);

    host.set_thread_mode(&thread, AskLevel::Always).expect("매번 묻기로");
    host.send_to_thread(&thread, "outside/denied.txt를 Write로 만들어").expect("둘째 말");
    let asked = wait_permission(&sandbox, &thread, "host", "asked");
    assert_eq!(
        (asked["payload"]["card"].clone(), asked["payload"]["policy"].clone()),
        (json!("edit"), json!("매번 묻기")),
        "바꾼 정도가 다음 편집부터 든다"
    );
    answer(&host, &thread, &asked, "reject");
    let record = wait_turns_of(&sandbox, &thread, "host", 2);
    let session = sandbox.thread_session_id(&thread, "host");

    host.shut_down();
    // Thread 화면의 L3(v1 티켓 28)가 물어보는 정도 칩 · 방패 줄 · 「Policy를 … 바꿈」 줄을 이것으로 잰다 — 묻지 않고 허용한 첫 턴,
    // 정도 바꿈, 다시 물은 둘째 턴.
    let settled = common::fix_thread_record(&common::commands_after_opened(&record), &sandbox.data_root(), &thread, &[&session]);
    common::assert_record("thread-ask-level", &settled);
}

#[test]
fn claude는_기본_모드로만_뜨고_계획만일_때만_계획_모드로_뜬다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", &host_md(""));
    sandbox.work("cart", &["fe"]);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &[("FAKE_CLAUDE_FIXTURE", "2.1.309/twoturn-tools")]));

    let plain = host.start_thread("안녕", ThreadLink::NoWork).expect("Work 없는 Thread");
    wait_turns_of(&sandbox, &plain, "host", 1);
    let args = args_of(&sandbox, &sandbox.thread_session_id(&plain, "host"));
    assert_eq!(permission_mode(&args), Some("default"), "사용자의 defaultMode를 물려받지 않는다: {args:?}");

    cart_mode(&sandbox, "plan");
    let planning = host.start_thread("계획만 세워 줘", in_cart()).expect("Work에 이은 Thread");
    wait_turns_of(&sandbox, &planning, "host", 1);
    let args = args_of(&sandbox, &sandbox.thread_session_id(&planning, "host"));
    assert_eq!(permission_mode(&args), Some("plan"), "{args:?}");

    host.shut_down();
}
