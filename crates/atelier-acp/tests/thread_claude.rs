//! L1 — Thread 엔진 ↔ Claude 변환기(시험 bin) ↔ 가짜 claude: 멈추기 · 권한 · 스스로 이어 간 턴 · 열기 실패 · 프로세스 그룹이
//! Thread에서 claude까지 닿고 돌아온다(v1 티켓 08).
//!
//! three-axes의 work 대화가 재던 변환기 끝맺음(`claude_control` · `claude_background` · `claude_conversation`)을 Thread의 공개
//! 동작으로 옮겼다 — Work 안 대화창과 work 대화는 v1 티켓 08이 걷었다. 시험은 호스트에 Thread 명령을 넣고, Thread 기록 · 대기 줄 ·
//! 가짜 claude의 영수증(받은 stdin 줄 · 받은 시그널 · 띄운 프로세스)만 본다. 변환기 안의 갈래(interrupt의 끝 · 선택지 · 턴 밖
//! 시작과 끝)는 변환기 상태 기계의 시험(`src/translator/machine/tests.rs`)이 같은 녹화를 프로세스 없이 먹여 잰다.
//!
//! 축복한 기록(`thread-stopped` · `thread-permission` · `thread-self-turn`)은 Thread 화면의 L3(v1 티켓 10 · 28)가 `thread:record`로
//! 흘린다 — work 대화의 `claude-stopped` · `claude-self-turn` 자리다.

mod common;

use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

use atelier_acp::{ConversationHost, HostError, QuitCounts, ThreadLink, TranslatorCommand};
use common::{assert_all_gone, of_kind, payloads_of, sent_texts, Sandbox};
use serde_json::{json, Value};

/// 시험의 Library `host.md` — 모델 · 생각 깊이를 적지 않았다(엔진 기본값).
const HOST_MD: &str = "---\nname: Host\ndescription: 시험의 Host\ntools:\n  agents: any\n---\n\n너는 시험 Thread의 Host다.\n";

/// 그 원문(`FAKE_CLAUDE_FIXTURE`)을 되감는 가짜 claude로 새 Thread를 세운다 — 첫 말이 곧 첫 턴이다. `extra`는 가짜 claude에게
/// 가는 env다. 호스트 · Thread id · Host의 Session id를 돌려준다.
fn thread_on(sandbox: &Sandbox, fixture: &str, extra: &[(&str, &str)], first: &str) -> (ConversationHost, String, String) {
    sandbox.library_agent("host", HOST_MD);
    let mut env = vec![("FAKE_CLAUDE_FIXTURE", fixture)];
    env.extend_from_slice(extra);
    let host = sandbox.host(sandbox.claude_login_shell("normal", &env));
    let thread = host.start_thread(first, ThreadLink::NoWork).expect("새 Thread의 첫 말");
    let session = sandbox.thread_session_id(&thread, "host");
    (host, thread, session)
}

/// 가짜 claude가 받은 stdin 줄마다 그 꼴 — user 줄은 `user`, 제어 요청은 그 subtype, 제어 답은 `answer`.
fn stdin_shape(stdin: &[Value]) -> Vec<String> {
    stdin
        .iter()
        .map(|line| match line["type"].as_str().unwrap() {
            "control_request" => line["request"]["subtype"].as_str().unwrap().to_owned(),
            "control_response" => "answer".to_owned(),
            other => other.to_owned(),
        })
        .collect()
}

/// 축복 자료의 꼴 — 명령 목록 줄을 열림 줄 뒤로 모으고 시각 · 데이터 루트 · Thread id · Session id를 고정값으로.
fn settled(sandbox: &Sandbox, record: &[Value], thread: &str, session: &str) -> Vec<Value> {
    common::fix_thread_record(&common::commands_after_opened(record), &sandbox.data_root(), thread, &[session])
}

#[test]
fn 멈추면_claude가_interrupt를_받고_sigint는_없고_멈춘_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    let (host, thread, session) =
        thread_on(&sandbox, "2.1.282/interrupt-sigint", &[], "40초 자는 명령을 앞에서 돌리고 끝나면 FINISHED라고 해");
    // 원문은 그 명령이 도는 동안 interrupt를 보냈다 — 도구 줄이 선 뒤에 멈춘다.
    sandbox.wait_thread_record(&thread, |record| {
        of_kind(record, "update").iter().any(|line| line["payload"]["update"]["sessionUpdate"] == "tool_call")
    });

    host.stop_thread(&thread).expect("멈추기");

    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    let end = &payloads_of(&record, "turn-end")[0];
    assert_eq!(
        (end["stopReason"].clone(), end["cancelledByUs"].clone()),
        (json!("cancelled"), json!(true)),
        "우리가 interrupt를 보낸 턴은 cancelled이고 「우리가 멈춤」이다:\n{}",
        common::lines_text(&record)
    );
    assert_eq!(stdin_shape(&sandbox.claude_stdin(&session)), ["initialize", "user", "interrupt"], "멈추기는 stdin의 interrupt 하나다");
    assert!(
        !sandbox.claude_events(&session).iter().any(|event| event == "signal SIGINT"),
        "SIGINT는 보내지 않는다 — claude가 끝난다(워크플로 함정 5)"
    );

    host.shut_down();
    // S26 — Thread 화면의 L3가 Claude 꼴의 멈춘 턴(돌던 도구가 `failed`로 닫힌 뒤 `cancelled`)을 이것으로 잰다.
    common::assert_record("thread-stopped", &settled(&sandbox, &record, &thread, &session));
}

#[test]
fn 권한_요청이_permission_줄에_서고_답하면_claude가_그_답을_받고_턴이_이어진다() {
    let sandbox = Sandbox::new();
    // 녹음의 `Write`는 잰 날의 임시 폴더를 고친다 — Thread 폴더 밖이면 판정이 묻지 않고 거절하므로(v1 티켓 22) Thread 폴더로 옮긴다.
    let rebase = [("FAKE_CLAUDE_REBASE", common::RECORDED_PLACE)];
    let (host, thread, session) = thread_on(&sandbox, "2.1.282/permission-stdio", &rebase, "outside/allowed.txt를 Write로 만들어");

    let record = sandbox.wait_thread_kind(&thread, "permission", 1);
    let line = of_kind(&record, "permission")[0];
    assert_eq!(line["who"], "host", "권한 줄은 물은 참여자의 것이다(S8)");
    let asked = &line["payload"];
    assert_eq!((asked["state"].clone(), asked["requestId"].clone()), (json!("asked"), json!("0")));
    assert_eq!(
        (asked["card"].clone(), asked["policy"].clone()),
        (json!("edit"), json!("매번 묻기")),
        "판정이 물었다 — 카드 종류와 왜 묻는지(Policy 이름)가 함께 선다(v1 티켓 22)"
    );
    assert_eq!(asked["request"]["sessionId"], json!(session));
    let options: Vec<&str> =
        asked["request"]["options"].as_array().unwrap().iter().map(|option| option["optionId"].as_str().unwrap()).collect();
    assert_eq!(options, ["allow_once", "allow_session", "reject"], "변환기가 지은 선택지가 그대로 permission 줄에 선다");
    assert!(of_kind(&record, "turn-end").is_empty(), "답하기 전에는 턴이 끝나지 않는다");
    assert_eq!(
        host.quit_counts(),
        QuitCounts { running: 1, queued: 0, approvals: 1 },
        "답하지 않은 승인도 끌 때 센다 — 앱을 끄면 그 턴을 잃는다(S40)"
    );

    host.answer_thread_permission(&thread, "host", "0", "allow_once").expect("한 번 허락");

    let record = sandbox.wait_thread_kind(&thread, "turn-end", 1);
    assert_eq!(payloads_of(&record, "permission")[1], json!({"requestId": "0", "state": "answered", "optionId": "allow_once"}));
    let end = &payloads_of(&record, "turn-end")[0];
    assert_eq!((end["stopReason"].clone(), end["cancelledByUs"].clone()), (json!("end_turn"), json!(false)));
    let answers: Vec<Value> =
        sandbox.claude_stdin(&session).into_iter().filter(|line| line["type"] == "control_response").collect();
    assert_eq!(answers.len(), 1, "호스트의 답이 claude의 stdin에 닿았다: {answers:?}");
    assert_eq!(answers[0]["response"]["request_id"], "93884787-809c-4c0a-82cd-a8ed96112508", "claude가 물은 그 요청의 답이다");
    assert_eq!(answers[0]["response"]["response"]["behavior"], "allow");
    assert_eq!(
        host.answer_thread_permission(&thread, "host", "0", "allow_once"),
        Err(HostError::PermissionClosed { thread: thread.clone(), request: "0".into() }),
        "이미 답한 요청에는 다시 답할 수 없다"
    );

    host.shut_down();
    // S26 — Thread 화면의 L3(v1 티켓 28)가 입력창 자리의 승인 카드와 그 답을 이것으로 잰다.
    common::assert_record("thread-permission", &settled(&sandbox, &record, &thread, &session));
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
fn user_lines(sandbox: &Sandbox, session: &str) -> usize {
    sandbox.claude_stdin(session).iter().filter(|line| line["type"] == "user").count()
}

/// 원문(워크플로 관문 G7 · G8)의 둘째 턴이 끝난 뒤 백그라운드 작업이 끝나 claude가 스스로 낸 답.
const SELF_ANSWER: &str = "백그라운드 명령어가 완료되었습니다. 20초 대기 후 \"BG-done\"이 출력되었습니다.";

/// 원문 `steer-background-subagent`를 되감는 Thread에 백그라운드를 거는 둘째 말까지 보낸다 — 첫 턴이 끝난 뒤에 보낸다.
fn background_thread(sandbox: &Sandbox, extra: &[(&str, &str)], second: &str) -> (ConversationHost, String, String) {
    let (host, thread, session) =
        thread_on(sandbox, "2.1.282/steer-background-subagent", extra, "15초 명령을 앞에서 돌리고 TURN-A-END라고 해");
    sandbox.wait_thread_kind(&thread, "turn-end", 1);
    host.send_to_thread(&thread, second).expect("둘째 말");
    (host, thread, session)
}

#[test]
fn 백그라운드를_건_턴은_result에서_끝나고_스스로_이어_간_턴은_턴_밖_update와_턴_밖_끝으로_적힌다() {
    let sandbox = Sandbox::new();
    let (host, thread, session) = background_thread(&sandbox, &[], "20초 명령을 백그라운드로 걸고 곧바로 STARTED라고 해");
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 3);

    let ends = payloads_of(&record, "turn-end");
    let started = &ends[1];
    assert_eq!(
        (started["stopReason"].clone(), started["outOfTurn"].clone()),
        (json!("end_turn"), json!(false)),
        "백그라운드 작업이 남아도 그 턴은 result에서 끝난다 — 한 턴으로 접지 않는다(three-axes S4):\n{}",
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
        "그 턴의 result 원문이 턴 끝 줄에 실린다"
    );
    let between = &record[second_end + 1..turn_end_at(&record, 2)];
    assert!(between.iter().all(|line| line["kind"] != "sent"), "보낸 말 없이 온 턴이다");
    assert!(between.iter().all(|line| line["who"] == "host"), "스스로 이어 간 턴도 Host의 줄이다(S8)");
    assert_eq!(answers_after(between, 0), [SELF_ANSWER], "스스로 이어 간 턴의 답이 턴 밖 update로 적힌다");
    assert!(
        between.iter().any(|line| line["payload"]["update"]["_meta"]["atelier"]["outOfTurn"]["state"] == "started"),
        "변환기가 스스로 이어 간 턴의 시작을 알린다:\n{}",
        common::lines_text(between)
    );
    assert_eq!(sent_texts(&record).len(), 2);

    host.shut_down();
    // S26 — Thread 화면의 L3가 스스로 이어 간 턴(시작 표지 · 턴 밖 update · 턴 밖 끝)을 이것으로 잰다.
    common::assert_record("thread-self-turn", &settled(&sandbox, &record, &thread, &session));
}

#[test]
fn 스스로_이어_간_턴_동안_보낸_말은_대기_줄에서_그_끝을_기다렸다가_간다() {
    let sandbox = Sandbox::new();
    let (host, thread, session) =
        background_thread(&sandbox, &[("FAKE_CLAUDE_HOLD_BACKGROUND", "result")], "백그라운드로 걸어");
    // 가짜는 스스로 이어 간 턴의 답까지 내고 그 턴의 result 앞에서 멈춰 있다.
    sandbox.wait_thread_record(&thread, |record| answers_after(record, 0).iter().any(|text| text == SELF_ANSWER));

    host.send_to_thread(&thread, "그동안 보낸 말").expect("스스로 이어 간 턴 동안의 말은 대기 줄에 든다");

    let queue: Vec<String> =
        host.thread(&thread).expect("Thread의 지금").queues["host"].iter().map(|queued| queued.text.clone()).collect();
    assert_eq!(queue, ["그동안 보낸 말"], "스스로 이어 간 턴이 도는 동안은 대기 줄을 보내지 않는다");
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(user_lines(&sandbox, &session), 2, "claude에는 아직 가지 않았다 — 도는 턴에 합쳐지지 않게(three-axes 결정 20)");
    assert_eq!(
        host.quit_counts(),
        QuitCounts { running: 1, queued: 1, approvals: 0 },
        "앱을 끄면 스스로 이어 간 턴도 잃는다 — 끌 때 셈이 「턴이 도는 Session」으로 센다(S40)"
    );

    sandbox.release_claude_background(&session);
    let record = sandbox.wait_thread_kind(&thread, "sent", 3);

    let self_end = turn_end_at(&record, 2);
    assert_eq!(record[self_end]["payload"]["outOfTurn"], true);
    let sent_at = record.iter().rposition(|line| line["kind"] == "sent").unwrap();
    assert!(self_end < sent_at, "턴 밖 끝이 적힌 뒤에 대기 줄의 맨 앞이 간다:\n{}", common::lines_text(&record));
    assert_eq!(sent_texts(&record), ["15초 명령을 앞에서 돌리고 TURN-A-END라고 해", "백그라운드로 걸어", "그동안 보낸 말"]);
    common::wait_for("대기 줄의 말이 claude에 가지 않았다", || user_lines(&sandbox, &session) >= 3);
    assert!(host.thread(&thread).unwrap().queues.is_empty());

    host.shut_down();
}

#[test]
fn 스스로_이어_간_턴을_멈추면_claude가_interrupt를_받고_턴_밖_끝에_우리가_멈춤이_실린다() {
    let sandbox = Sandbox::new();
    let (host, thread, session) =
        background_thread(&sandbox, &[("FAKE_CLAUDE_HOLD_BACKGROUND", "result")], "백그라운드로 걸어");
    sandbox.wait_thread_record(&thread, |record| answers_after(record, 0).iter().any(|text| text == SELF_ANSWER));

    host.stop_thread(&thread).expect("스스로 이어 간 턴도 멈춘다");

    common::wait_for("claude가 interrupt를 받지 않았다", || {
        sandbox.claude_stdin(&session).iter().any(|line| line["request"]["subtype"] == "interrupt")
    });
    sandbox.release_claude_background(&session);
    let record = sandbox.wait_thread_kind(&thread, "turn-end", 3);
    let own = &payloads_of(&record, "turn-end")[2];
    assert_eq!((own["outOfTurn"].clone(), own["cancelledByUs"].clone()), (json!(true), json!(true)));
    assert!(
        !sandbox.claude_events(&session).iter().any(|event| event == "signal SIGINT"),
        "SIGINT는 보내지 않는다 — claude가 끝난다(워크플로 함정 5)"
    );

    host.shut_down();
}

#[test]
fn 판이_다른_변환기면_session을_열지_않고_thread에_까닭이_남고_남은_프로세스가_없다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    // 판이 다른 변환기 — 가짜 ACP 에이전트가 `initialize`에 다른 판을 싣는다. 띄운 pid는 감싼 스크립트가 적는다.
    let pids = sandbox.claude_receipts().join("translator-pids");
    let wrapper = sandbox.bin("old-translator").join("acp-claude");
    std::fs::write(
        &wrapper,
        format!("#!/bin/sh\necho $$ >> '{}'\nexec '{}'\n", pids.display(), env!("CARGO_BIN_EXE_fake-acp-agent")),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    let shell = sandbox.claude_login_shell("normal", &[("FAKE_ACP_VERSION", "0.17.9")]);
    let host = sandbox
        .host_builder_with_translator(shell, TranslatorCommand::new(&wrapper, Vec::<String>::new()), |_| {})
        .build();

    let failed = host.start_thread("첫 말", ThreadLink::NoWork).expect_err("판이 다르면 열지 않는다");

    let HostError::Open { thread, reason } = &failed else { panic!("열기 실패여야 한다: {failed:?}") };
    assert!(reason.contains("판 어긋남") && reason.contains("0.17.9"), "{reason}");
    let translator: Vec<u32> =
        std::fs::read_to_string(&pids).unwrap().lines().map(|line| line.trim().parse().unwrap()).collect();
    assert_eq!(translator.len(), 1);
    assert_all_gone(&translator);
    assert!(sandbox.all_claude_receipts().is_empty(), "판을 본 뒤에는 session/new를 보내지 않는다 — claude가 뜨지 않는다");
    let record = sandbox.thread_record(thread);
    assert!(
        record.iter().any(|line| line["who"] == "host" && line["payload"]["state"] == "died" && line["payload"]["reason"] == json!(reason)),
        "Thread는 남고 기록에 까닭이 선다 — 다음 말에서 다시 띄운다:\n{}",
        common::lines_text(&record)
    );

    host.shut_down();
}

#[test]
fn claude가_initialize에_답하지_않으면_한도_뒤_열기_실패이고_남은_프로세스가_없다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let (builder, _events) = sandbox.host_builder_with_events(sandbox.claude_login_shell("silent-initialize", &[]));
    let host = builder.open_limit(Duration::from_millis(800)).build();

    let started = Instant::now();
    let failed = host.start_thread("첫 말", ThreadLink::NoWork).expect_err("답하지 않으면 열지 않는다");

    assert!(started.elapsed() < Duration::from_secs(5), "한도에서 끊는다: {:?}", started.elapsed());
    assert!(matches!(&failed, HostError::Open { reason, .. } if reason.contains("안에 세션을 열지 않았습니다")), "{failed:?}");
    let receipts = sandbox.all_claude_receipts();
    assert_eq!(receipts.len(), 1, "claude는 떴다");
    let claude = receipts[0]["pid"].as_u64().unwrap() as u32;
    let translator = receipts[0]["ppid"].as_u64().unwrap() as u32;
    assert_all_gone(&[translator, claude]);
    let session = common::receipt_args(&receipts[0])
        .windows(2)
        .find(|pair| pair[0] == "--session-id")
        .map(|pair| pair[1].clone())
        .expect("새 Session id");
    let stdin = sandbox.claude_stdin(&session);
    assert_eq!(stdin.len(), 1, "띄운 직후 받은 것은 initialize 하나다: {stdin:?}");
    assert_eq!(stdin[0]["request"], json!({"subtype": "initialize"}));

    host.shut_down();
}

#[test]
fn claude는_변환기의_프로세스_그룹_안에_있고_호스트를_끄면_후손이_0개다() {
    let sandbox = Sandbox::new();
    sandbox.library_agent("host", HOST_MD);
    let host = sandbox.host(sandbox.claude_login_shell("mcp-child", &[]));
    let thread = host.start_thread("첫 말", ThreadLink::NoWork).expect("새 Thread");
    let session = sandbox.thread_session_id(&thread, "host");
    let receipt = sandbox.claude_receipt(&session);
    let (claude, translator) = (receipt["pid"].as_u64().unwrap() as u32, receipt["ppid"].as_u64().unwrap() as u32);
    let mcp_child = receipt["descendants"][0].as_u64().unwrap() as u32;
    assert_eq!(receipt["pgid"].as_u64(), Some(translator as u64), "claude는 변환기의 프로세스 그룹 안에 있다");
    assert_eq!(receipt["sid"].as_u64(), Some(translator as u64), "변환기는 새 세션의 리더이고 claude도 그 세션에 있다");
    assert!(common::is_running(mcp_child));

    host.shut_down();

    assert_all_gone(&[translator, claude, mcp_child]);
    let events = sandbox.claude_events(&session);
    assert!(events.contains(&"stdin-eof".to_owned()), "변환기가 claude의 stdin을 닫았다: {events:?}");
    assert!(!events.iter().any(|event| event.starts_with("signal")), "SIGINT · SIGTERM으로 끄지 않는다: {events:?}");
}

#[test]
fn 변환기의_stdin을_닫으면_claude까지_끝난다() {
    // 앱이 비정상으로 끝난 꼴 — 그룹째 끄는 호스트가 없고, 변환기의 stdin만 닫힌다. 변환기를 ACP로 직접 몬다.
    let sandbox = Sandbox::new();
    let (mut translator, mut wire) = common::spawn_translator(&sandbox, &[("FAKE_CLAUDE_SCENARIO", "mcp-child")]);
    let (_, session) = wire.open_session(&sandbox);
    let receipt = sandbox.claude_receipt(&session);
    let pids = [receipt["pid"].as_u64().unwrap() as u32, receipt["descendants"][0].as_u64().unwrap() as u32];

    drop(wire);

    let status = common::assert_translator_exits(&mut translator);
    assert!(status.success(), "변환기는 stdin EOF에 스스로 끝난다: {status}");
    assert_all_gone(&pids);
    assert!(sandbox.claude_events(&session).contains(&"stdin-eof".to_owned()), "claude가 stdin EOF를 받았다");
}
