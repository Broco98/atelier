//! L1 — 대화 호스트 ↔ Claude 변환기(시험 bin) ↔ 가짜 claude: 백그라운드 작업이 턴을 붙잡지 않고, claude가 작업 알림으로
//! 스스로 이어 간 턴은 턴 밖 update와 턴 밖 끝으로 적힌다(three-axes 티켓 16 · S4 · 스토리 45 · 46).
//!
//! 시험은 호스트에 명령을 넣고, `agents/` 기록 · 대기 줄 · 가짜 claude의 영수증(받은 stdin 줄)만 본다.
//!
//! 가짜 claude는 워크플로 실측 2.1.282 `steer-background-subagent`(관문 G8)와 판 02 관문 G4 `g4-background`(2.1.296)를
//! 되감는다 — 원문에서 `result.origin.kind`가 `task-notification`인 턴은 user 줄 없이, 앞 턴이 끝나자마자 낸다.

mod common;

use atelier_acp::QuitCounts;
use common::{payloads_of, sent_texts, Sandbox};
use serde_json::{json, Value};

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
    let (host, conversation) = sandbox.open_claude("2.1.282/steer-background-subagent", &[]);
    host.send("cart", &conversation, "15초 명령을 앞에서 돌리고 TURN-A-END라고 해").expect("첫 말");
    sandbox.wait_kind("cart", &conversation, "turn-end", 1);

    host.send("cart", &conversation, "20초 명령을 백그라운드로 걸고 곧바로 STARTED라고 해").expect("둘째 말");
    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 3);

    let ends = payloads_of(&record, "turn-end");
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
        sandbox.open_claude("2.1.282/steer-background-subagent", &[("FAKE_CLAUDE_HOLD_BACKGROUND", "result")]);
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
    common::wait_for("대기 줄의 말이 claude에 가지 않았다", || user_lines(&sandbox, &session) >= 3);
    assert!(host.list_conversations("cart").unwrap()[0].queue.is_empty());

    host.shut_down();
}

#[test]
fn 스스로_이어_간_턴이_spec_파일을_쓰면_그_턴의_끝에_changes_줄이_적힌다() {
    let sandbox = Sandbox::new();
    // 가짜는 백그라운드 작업이 도는 동안(스스로 이어 갈 턴의 앞에서) 멈춘다 — 진짜 claude 2.1.296은 14초 뒤에 이어 갔다(관문 G4).
    let (host, conversation) = sandbox.open_claude("2.1.296/g4-background",
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

    let ends = payloads_of(&record, "turn-end");
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
        sandbox.open_claude("2.1.282/steer-background-subagent", &[("FAKE_CLAUDE_HOLD_BACKGROUND", "result")]);
    let session = sandbox.agent_session_id("cart", &conversation);
    host.send("cart", &conversation, "첫 말").expect("첫 말");
    sandbox.wait_kind("cart", &conversation, "turn-end", 1);
    host.send("cart", &conversation, "백그라운드로 걸어").expect("둘째 말");
    sandbox.wait_record("cart", &conversation, |record| answers_after(record, 0).iter().any(|text| text == SELF_ANSWER));

    host.stop("cart", &conversation).expect("스스로 이어 간 턴도 멈춘다");

    common::wait_for("claude가 interrupt를 받지 않았다", || {
        sandbox.claude_stdin(&session).iter().any(|line| line["request"]["subtype"] == "interrupt")
    });
    sandbox.release_claude_background(&session);
    let record = sandbox.wait_kind("cart", &conversation, "turn-end", 3);
    let own = &payloads_of(&record, "turn-end")[2];
    assert_eq!((own["outOfTurn"].clone(), own["cancelledByUs"].clone()), (json!(true), json!(true)));
    assert!(
        !sandbox.claude_events(&session).iter().any(|event| event == "signal SIGINT"),
        "SIGINT는 보내지 않는다 — claude가 끝난다(워크플로 함정 5)"
    );

    host.shut_down();
}

#[test]
fn 변환기는_스스로_이어_간_턴_동안_온_session_prompt를_그_턴의_result_뒤에_claude에_넣는다() {
    // 호스트가 스스로 이어 간 턴의 시작을 알기 전에 말을 보낸 꼴 — 변환기를 ACP로 직접 몬다.
    let sandbox = Sandbox::new();
    let (mut translator, mut wire) = common::spawn_translator(
        &sandbox,
        &[("FAKE_CLAUDE_FIXTURE", "2.1.282/steer-background-subagent"), ("FAKE_CLAUDE_HOLD_BACKGROUND", "result")],
    );
    let answer_to = |id: u64| move |line: &Value| line["id"] == id && line.get("method").is_none();
    let prompt = |id: u64, text: &str| {
        json!({"jsonrpc": "2.0", "id": id, "method": "session/prompt",
               "params": {"sessionId": "", "prompt": [{"type": "text", "text": text}]}})
    };

    let (initialized, session) = wire.open_session(&sandbox);
    assert_eq!(
        initialized["result"]["agentCapabilities"],
        json!({"loadSession": true, "sessionCapabilities": {"resume": {}}}),
        "되살리기는 load와 resume을 둘 다 광고한다(워크플로 S19)"
    );
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
    common::wait_for("미뤄 둔 말이 claude에 가지 않았다", || user_lines(&sandbox, &session) >= 3);
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
    common::assert_translator_exits(&mut translator);
}
