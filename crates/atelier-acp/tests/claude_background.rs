//! L1 — 대화 호스트 ↔ Claude 변환기(시험 bin) ↔ 가짜 claude: 백그라운드 작업이 턴을 붙잡지 않고, claude가 작업 알림으로
//! 스스로 이어 간 턴은 턴 밖 update와 턴 밖 끝으로 적힌다(three-axes 티켓 16 · S4 · 스토리 45 · 46).
//!
//! 시험은 호스트에 명령을 넣고, `agents/` 기록 · 대기 줄 · 가짜 claude의 영수증(받은 stdin 줄)만 본다.
//!
//! 가짜 claude는 워크플로 실측 2.1.282 `steer-background-subagent`(관문 G8)와 판 02 관문 G4 `g4-background`(2.1.296)를
//! 되감는다 — 원문에서 `result.origin.kind`가 `task-notification`인 턴은 user 줄 없이, 앞 턴이 끝나자마자 낸다.

mod common;

use atelier_acp::{Agent, ConversationHost, QuitCounts};
use common::{of_kind, Sandbox};
use serde_json::{json, Value};

/// 그 원문을 되감는 가짜 claude로 Claude 대화 하나를 연다. `extra`는 가짜 claude에게 가는 env다.
fn open(sandbox: &Sandbox, fixture: &str, extra: &[(&str, &str)]) -> (ConversationHost, String) {
    sandbox.work("cart", &[]);
    let mut env = vec![("FAKE_CLAUDE_FIXTURE", fixture)];
    env.extend_from_slice(extra);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &env));
    let conversation = host.new_conversation("cart", Agent::Claude).expect("Claude 새 대화");
    sandbox.wait_record("cart", &conversation.id, |record| {
        record.iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "available_commands_update")
    });
    (host, conversation.id)
}

/// 기록의 `turn-end` 줄들의 payload.
fn turn_ends(record: &[Value]) -> Vec<Value> {
    of_kind(record, "turn-end").into_iter().map(|line| line["payload"].clone()).collect()
}

/// 기록의 보낸 말 글들.
fn sent_texts(record: &[Value]) -> Vec<String> {
    of_kind(record, "sent").iter().map(|line| line["payload"]["text"].as_str().unwrap().to_owned()).collect()
}

/// 그 자리(`from`) 뒤의 답 조각 글들.
fn answers_after(record: &[Value], from: usize) -> Vec<String> {
    record[from..]
        .iter()
        .filter(|line| line["kind"] == "update" && line["payload"]["update"]["sessionUpdate"] == "agent_message_chunk")
        .map(|line| line["payload"]["update"]["content"]["text"].as_str().unwrap().to_owned())
        .collect()
}

/// 기록에서 n번째(0부터) `turn-end` 줄의 자리.
fn turn_end_at(record: &[Value], n: usize) -> usize {
    record.iter().enumerate().filter(|(_, line)| line["kind"] == "turn-end").nth(n).map(|(at, _)| at).expect("그 턴 끝")
}

/// 가짜 claude가 받은 user 줄 수.
fn user_lines(sandbox: &Sandbox, session_id: &str) -> usize {
    sandbox.claude_stdin(session_id).iter().filter(|line| line["type"] == "user").count()
}

/// 원문(워크플로 관문 G7 · G8)의 둘째 턴이 끝난 뒤 백그라운드 작업이 끝나 claude가 스스로 낸 답.
const SELF_ANSWER: &str = "백그라운드 명령어가 완료되었습니다. 20초 대기 후 \"BG-done\"이 출력되었습니다.";

#[test]
fn steer_background_subagent_백그라운드를_건_턴은_result에서_끝나고_스스로_이어_간_턴은_턴_밖_update와_턴_밖_끝으로_적힌다() {
    let sandbox = Sandbox::new();
    let (host, conversation) = open(&sandbox, "2.1.282/steer-background-subagent", &[]);
    host.send("cart", &conversation, "15초 명령을 앞에서 돌리고 TURN-A-END라고 해").expect("첫 말");
    sandbox.wait_kind("cart", &conversation, "turn-end", 1);

    host.send("cart", &conversation, "20초 명령을 백그라운드로 걸고 곧바로 STARTED라고 해").expect("둘째 말");
    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 3);

    let ends = turn_ends(&record);
    let started = &ends[1];
    assert_eq!(
        (started["stopReason"].clone(), started["outOfTurn"].clone()),
        (json!("end_turn"), json!(false)),
        "백그라운드 작업이 남아도 그 턴은 result에서 끝난다 — 한 턴으로 접지 않는다(S4):\n{}",
        common::lines_text(&record)
    );
    assert_eq!(started["response"]["_meta"]["claudeCode"]["result"]["result"], "STARTED");
    let second_end = turn_end_at(&record, 1);
    assert_eq!(answers_after(&record[..second_end], turn_end_at(&record, 0)), ["STARTED"]);

    let own = &ends[2];
    assert_eq!(
        (own["stopReason"].clone(), own["outOfTurn"].clone(), own["cancelledByUs"].clone()),
        (json!("end_turn"), json!(true), json!(false)),
        "claude가 스스로 이어 간 턴의 끝은 턴 밖 끝이다"
    );
    assert_eq!(
        own["response"]["_meta"]["claudeCode"]["result"]["origin"]["kind"],
        "task-notification",
        "그 턴의 result 원문이 턴 끝 줄에 실린다 — 평가의 재료다(three-axes 결정 18)"
    );
    let between = &record[second_end + 1..turn_end_at(&record, 2)];
    assert!(between.iter().all(|line| line["kind"] != "sent"), "보낸 말 없이 온 턴이다");
    assert_eq!(answers_after(between, 0), [SELF_ANSWER], "스스로 이어 간 턴의 답이 턴 밖 update로 적힌다");
    assert!(
        between.iter().any(|line| line["payload"]["update"]["_meta"]["atelier"]["outOfTurn"]["state"] == "started"),
        "변환기가 스스로 이어 간 턴의 시작을 알린다:\n{}",
        common::lines_text(between)
    );
    assert_eq!(sent_texts(&record).len(), 2);

    host.shut_down();
}

#[test]
fn 스스로_이어_간_턴_동안_보낸_말은_대기_줄에서_그_끝을_기다렸다가_간다() {
    let sandbox = Sandbox::new();
    let (host, conversation) =
        open(&sandbox, "2.1.282/steer-background-subagent", &[("FAKE_CLAUDE_HOLD_BACKGROUND", "result")]);
    let session = sandbox.agent_session_id("cart", &conversation);
    host.send("cart", &conversation, "첫 말").expect("첫 말");
    sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    host.send("cart", &conversation, "백그라운드로 걸어").expect("둘째 말");
    // 가짜는 스스로 이어 간 턴의 답까지 내고 그 턴의 result 앞에서 멈춰 있다.
    sandbox.wait_record("cart", &conversation, |record| answers_after(record, 0).iter().any(|text| text == SELF_ANSWER));

    host.send("cart", &conversation, "그동안 보낸 말").expect("스스로 이어 간 턴 동안의 말은 대기 줄에 든다");

    let listed = host.list_conversations("cart").expect("대화 목록");
    let queue: Vec<&str> = listed[0].queue.iter().map(|queued| queued.text.as_str()).collect();
    assert_eq!(queue, ["그동안 보낸 말"], "스스로 이어 간 턴이 도는 동안은 대기 줄을 보내지 않는다(S13)");
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert_eq!(user_lines(&sandbox, &session), 2, "claude에는 아직 가지 않았다 — 도는 턴에 합쳐지지 않게(three-axes 결정 20)");
    assert_eq!(
        host.quit_counts(),
        QuitCounts { running: 1, queued: 1, approvals: 0 },
        "앱을 끄면 스스로 이어 간 턴도 잃는다 — 종료 확인이 「턴이 도는 대화」로 센다(티켓 23)"
    );

    sandbox.release_claude_background(&session);
    let record = sandbox.wait_kind("cart", &conversation, "sent", 3);

    let self_end = turn_end_at(&record, 2);
    assert_eq!(record[self_end]["payload"]["outOfTurn"], true);
    let sent_at = record.iter().rposition(|line| line["kind"] == "sent").unwrap();
    assert!(self_end < sent_at, "턴 밖 끝이 적힌 뒤에 대기 줄의 맨 앞이 간다:\n{}", common::lines_text(&record));
    assert_eq!(sent_texts(&record), ["첫 말", "백그라운드로 걸어", "그동안 보낸 말"]);
    assert_eq!(record[sent_at]["payload"]["prompt"], json!([{"type": "text", "text": "그동안 보낸 말"}]));
    let deadline = std::time::Instant::now() + common::PATIENCE;
    while user_lines(&sandbox, &session) < 3 {
        assert!(std::time::Instant::now() < deadline, "대기 줄의 말이 claude에 가지 않았다");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert!(host.list_conversations("cart").unwrap()[0].queue.is_empty());

    host.shut_down();
}

#[test]
fn 스스로_이어_간_턴이_spec_파일을_쓰면_그_턴의_끝에_changes_줄이_적힌다() {
    let sandbox = Sandbox::new();
    // 가짜는 백그라운드 작업이 도는 동안(스스로 이어 갈 턴의 앞에서) 멈춘다 — 진짜 claude 2.1.296은 14초 뒤에 이어 갔다(관문 G4).
    let (host, conversation) = open(
        &sandbox,
        "2.1.296/g4-background",
        &[("FAKE_CLAUDE_PERFORMS_WRITES", "1"), ("FAKE_CLAUDE_HOLD_BACKGROUND", "start")],
    );
    let session = sandbox.agent_session_id("cart", &conversation);
    host.send("cart", &conversation, "백그라운드로 걸고, 끝나면 결과를 bg.md에 써").expect("보내기");
    // 원문의 claude는 백그라운드 `Bash`를 묻는다(판 02 관문 G4).
    sandbox.wait_kind("cart", &conversation, "permission", 1);
    host.answer_permission("cart", &conversation, "0", "allow_once").expect("허락");
    sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    sandbox.release_claude_background(&session);
    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 2);

    let ends = turn_ends(&record);
    assert_eq!((ends[0]["outOfTurn"].clone(), ends[1]["outOfTurn"].clone()), (json!(false), json!(true)));
    let changes: Vec<(usize, Value)> = record
        .iter()
        .enumerate()
        .filter(|(_, line)| line["kind"] == "changes")
        .map(|(at, line)| (at, line["payload"].clone()))
        .collect();
    assert_eq!(
        changes,
        [(turn_end_at(&record, 1) - 1, json!({"files": [{"path": "bg.md", "change": "created", "lines": [{"start": 1, "end": 1}]}]}))],
        "고친 곳은 그 파일을 쓴 턴 밖 턴의 끝 줄 바로 앞에 선다 — 백그라운드를 건 턴에는 없다(06의 길):\n{}",
        common::lines_text(&record)
    );
    let work = sandbox.work_dir("cart");
    assert_eq!(std::fs::read_to_string(work.join("spec/bg.md")).unwrap(), "BG-done\n");

    host.shut_down();
}

#[test]
fn 스스로_이어_간_턴을_멈추면_claude가_interrupt를_받고_턴_밖_끝에_우리가_멈춤이_실린다() {
    let sandbox = Sandbox::new();
    let (host, conversation) =
        open(&sandbox, "2.1.282/steer-background-subagent", &[("FAKE_CLAUDE_HOLD_BACKGROUND", "result")]);
    let session = sandbox.agent_session_id("cart", &conversation);
    host.send("cart", &conversation, "첫 말").expect("첫 말");
    sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    host.send("cart", &conversation, "백그라운드로 걸어").expect("둘째 말");
    sandbox.wait_record("cart", &conversation, |record| answers_after(record, 0).iter().any(|text| text == SELF_ANSWER));

    host.stop("cart", &conversation).expect("스스로 이어 간 턴도 멈춘다");

    let deadline = std::time::Instant::now() + common::PATIENCE;
    while !sandbox.claude_stdin(&session).iter().any(|line| line["request"]["subtype"] == "interrupt") {
        assert!(std::time::Instant::now() < deadline, "claude가 interrupt를 받지 않았다");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    sandbox.release_claude_background(&session);
    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 3);
    let own = &turn_ends(&record)[2];
    assert_eq!((own["outOfTurn"].clone(), own["cancelledByUs"].clone()), (json!(true), json!(true)));
    assert!(
        !sandbox.claude_events(&session).iter().any(|event| event == "signal SIGINT"),
        "SIGINT는 보내지 않는다 — claude가 끝난다(워크플로 함정 5)"
    );

    host.shut_down();
}

/// 변환기를 ACP로 직접 모는 시험의 줄 받기 — 변환기의 stdout 줄을 차례로 받는다.
struct Wire {
    stdin: std::process::ChildStdin,
    lines: std::sync::mpsc::Receiver<Value>,
    seen: Vec<Value>,
}

impl Wire {
    fn send(&mut self, message: Value) {
        use std::io::Write;
        writeln!(self.stdin, "{message}").unwrap();
    }

    /// `done`을 채우는 줄이 올 때까지 받는다.
    fn until(&mut self, done: impl Fn(&Value) -> bool) -> Value {
        loop {
            let line = self.lines.recv_timeout(common::PATIENCE).expect("변환기가 기다린 줄을 내지 않았다");
            self.seen.push(line.clone());
            if done(&line) {
                return line;
            }
        }
    }
}

#[test]
fn 변환기는_스스로_이어_간_턴_동안_온_session_prompt를_그_턴의_result_뒤에_claude에_넣는다() {
    use std::io::BufRead;
    use std::os::unix::process::CommandExt;

    // 호스트가 스스로 이어 간 턴의 시작을 알기 전에 말을 보낸 꼴 — 변환기를 ACP로 직접 몬다.
    let sandbox = Sandbox::new();
    let cwd = sandbox.bin("cwd");
    let claude = sandbox.claude_bin().join("claude");
    let mut command = std::process::Command::new(env!("CARGO_BIN_EXE_claude-translator"));
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("FAKE_CLAUDE_FIXTURE", "2.1.282/steer-background-subagent")
        .env("FAKE_CLAUDE_HOLD_BACKGROUND", "result")
        .env("FAKE_CLAUDE_RECEIPTS", sandbox.claude_receipts())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    // SAFETY: fork 뒤 exec 전의 자식에서 async-signal-safe한 setsid 하나만 부른다.
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    let mut translator = command.spawn().expect("변환기 시험 bin");
    let stdout = std::io::BufReader::new(translator.stdout.take().unwrap());
    let (tx, lines) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in stdout.lines().map_while(Result::ok) {
            if tx.send(serde_json::from_str::<Value>(&line).unwrap()).is_err() {
                break;
            }
        }
    });
    let mut wire = Wire { stdin: translator.stdin.take().unwrap(), lines, seen: Vec::new() };
    let answer_to = |id: u64| move |line: &Value| line["id"] == id && line.get("method").is_none();
    let prompt = |id: u64, text: &str| {
        json!({"jsonrpc": "2.0", "id": id, "method": "session/prompt",
               "params": {"sessionId": "", "prompt": [{"type": "text", "text": text}]}})
    };

    wire.send(json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": 1}}));
    let initialized = wire.until(answer_to(1));
    assert_eq!(
        initialized["result"]["agentCapabilities"],
        json!({"loadSession": true, "sessionCapabilities": {"resume": {}}}),
        "되살리기는 load와 resume을 둘 다 광고한다(워크플로 S19)"
    );
    wire.send(json!({"jsonrpc": "2.0", "id": 2, "method": "session/new",
                     "params": {"cwd": cwd, "mcpServers": [], "_meta": {"atelier": {"claudePath": claude}}}}));
    let session = wire.until(answer_to(2))["result"]["sessionId"].as_str().unwrap().to_owned();
    wire.send(prompt(3, "첫 말"));
    wire.until(answer_to(3));
    wire.send(prompt(4, "백그라운드로 걸어"));
    assert_eq!(wire.until(answer_to(4))["result"]["stopReason"], "end_turn", "백그라운드를 건 턴은 result에서 끝난다");
    wire.until(|line| line["params"]["update"]["_meta"]["atelier"]["outOfTurn"]["state"] == "started");

    wire.send(prompt(5, "그동안 보낸 말"));
    std::thread::sleep(std::time::Duration::from_millis(300));
    assert_eq!(user_lines(&sandbox, &session), 2, "스스로 이어 간 턴이 도는 동안에는 claude에 넣지 않는다 — 그 턴에 합쳐진다(steer)");

    sandbox.release_claude_background(&session);
    let ended = wire.until(|line| line["params"]["update"]["_meta"]["atelier"]["outOfTurn"]["state"] == "ended");
    assert_eq!(ended["params"]["update"]["_meta"]["atelier"]["outOfTurn"]["response"]["stopReason"], "end_turn");
    let deadline = std::time::Instant::now() + common::PATIENCE;
    while user_lines(&sandbox, &session) < 3 {
        assert!(std::time::Instant::now() < deadline, "미뤄 둔 말이 claude에 가지 않았다");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let stdin = sandbox.claude_stdin(&session);
    let last_user = stdin.iter().rfind(|line| line["type"] == "user").unwrap();
    assert_eq!(last_user["message"]["content"], json!([{"type": "text", "text": "그동안 보낸 말"}]));
    assert!(
        !wire.seen.iter().any(|line| line["id"] == 5),
        "미뤄 둔 말에는 그 턴 밖 끝에서 답하지 않는다 — 그 말의 턴은 이제 시작한다"
    );

    // 원문의 다음 턴은 interrupt를 기다린다 — 멈추면 그 말의 턴이 cancelled로 끝난다.
    wire.send(json!({"jsonrpc": "2.0", "method": "session/cancel", "params": {"sessionId": session}}));
    assert_eq!(wire.until(answer_to(5))["result"]["stopReason"], "cancelled");

    drop(wire);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while translator.try_wait().unwrap().is_none() {
        if std::time::Instant::now() > deadline {
            // SAFETY: 이 시험이 새 세션에 띄운 그룹이다.
            unsafe { libc::killpg(translator.id() as i32, libc::SIGKILL) };
            panic!("변환기가 stdin EOF 뒤에 끝나지 않았다");
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}
