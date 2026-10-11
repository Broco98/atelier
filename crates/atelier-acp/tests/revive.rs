//! L1 — 대화 호스트 ↔ 가짜 ACP 에이전트: 앱을 다시 켜거나 에이전트가 죽어도 다음 말에서 되살아난다
//! (three-axes 티켓 10 · 스토리 84 · 85 · 86 · 87 · 88 · 110).
//!
//! 앱 재시작은 호스트를 끄고 같은 데이터 루트로 새 호스트를 짓는 것으로 흉내 낸다. 시험은 호스트에 명령을 넣고, 나오는
//! 이벤트 · `agents/` 파일 · 가짜가 남긴 영수증만 본다.

mod common;

use atelier_acp::{Agent, ConversationHost};
use common::{of_kind, opened_hows, payloads_of, preamble, sent_texts, Sandbox};
use serde_json::{json, Value};

/// 한 턴을 돌린 대화를 남기고 호스트를 끈다 — 어제의 대화.
fn yesterday(sandbox: &Sandbox, host: ConversationHost) -> String {
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    host.send("cart", &conversation.id, "어제의 말").expect("보내기");
    sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    host.shut_down();
    conversation.id
}

#[test]
fn 호스트를_다시_지으면_대화_목록이_서고_프로세스는_0개다_말을_보내면_띄워진다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("normal", &[]);
    let id = yesterday(&sandbox, sandbox.host(shell.clone()));
    let first_session = sandbox.agent_session_id("cart", &id);
    let launched = sandbox.acp_launches();
    assert_eq!(launched.len(), 1);
    common::assert_all_gone(&common::pids_of(&launched));

    // 앱을 다시 켠 꼴 — 같은 데이터 루트에 새 호스트를 짓는다.
    let host = sandbox.host(shell);
    let listed = host.list_conversations("cart").expect("대화 목록");
    assert_eq!(listed.len(), 1, "agents.json의 열린 대화가 목록에 선다");
    assert_eq!(listed[0].id, id);
    assert_eq!(listed[0].last_seq, sandbox.record("cart", &id).last().unwrap()["seq"].as_u64().unwrap());
    host.read_record("cart", &id, 0).expect("기록으로 그린다");
    assert_eq!(sandbox.acp_launches().len(), 1, "다시 지어도 띄우지 않는다(S8 · three-axes 결정 19) — 떠 있는 에이전트는 0개다");

    host.send("cart", &id, "오늘의 말").expect("말을 보내면 띄워 되살린다");
    let record = sandbox.wait_kind("cart", &id, "turn-end", 2);
    assert_eq!(sandbox.acp_launches().len(), 2, "보낼 때 하나가 뜬다");
    assert_eq!(sent_texts(&record), ["어제의 말", "오늘의 말"], "같은 기록에 이어 적힌다");
    assert_eq!(
        opened_hows(&record),
        ["new", "fresh"],
        "되살릴 길이 없는 에이전트(resume · load를 광고하지 않음)는 새 세션으로 열리고, 열림 줄이 그렇다고 말한다"
    );

    let second_session = sandbox.agent_session_id("cart", &id);
    assert_ne!(second_session, first_session, "새 세션의 id가 agents.json에 적힌다");
    let prompts = sandbox.acp_prompts(&second_session);
    assert_eq!(
        prompts[0]["prompt"],
        json!([preamble(&work, "cart"), {"type": "text", "text": "오늘의 말"}]),
        "새 세션으로 끝나면 다음 첫 말에 머리말이 다시 붙는다(S11)"
    );

    host.shut_down();
}

/// 가짜가 받은 되살리기의 메서드와 성패 — 받은 차례대로.
fn revival_steps(sandbox: &Sandbox) -> Vec<(String, bool)> {
    sandbox
        .acp_revivals()
        .iter()
        .map(|revival| (revival["method"].as_str().unwrap().to_owned(), revival["ok"].as_bool().unwrap()))
        .collect()
}

#[test]
fn resume을_광고하면_resume으로_열리고_열림_줄이_resumed이고_같은_세션이_맥락을_잇는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("resume-advertised", &[]);
    let id = yesterday(&sandbox, sandbox.host(shell.clone()));
    let session = sandbox.agent_session_id("cart", &id);

    let host = sandbox.host(shell);
    host.send("cart", &id, "오늘의 말").expect("보내기");
    let record = sandbox.wait_kind("cart", &id, "turn-end", 2);

    assert_eq!(
        revival_steps(&sandbox),
        [("session/resume".to_owned(), true)],
        "resume을 광고하면 resume이 먼저이고, 열리면 load로 가지 않는다"
    );
    assert_eq!(sandbox.acp_revivals()[0]["params"]["sessionId"], json!(session), "agents.json의 에이전트 쪽 세션 id로 되살린다");
    assert_eq!(opened_hows(&record), ["new", "resumed"]);
    assert_eq!(sandbox.agent_session_id("cart", &id), session, "같은 세션이다");
    let prompts = sandbox.acp_prompts(&session);
    assert_eq!(prompts.len(), 2, "되살린 세션이 둘째 말을 받는다");
    assert_eq!(
        prompts[1]["prompt"],
        json!([{"type": "text", "text": "오늘의 말"}]),
        "맥락을 이었으니 머리말을 다시 붙이지 않는다(S11)"
    );

    host.shut_down();
}

#[test]
fn resume이_없으면_load로_열리고_load_답_전에_재생된_update는_0줄_적히고_답_뒤의_줄은_산다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("replays-on-load", &[]);
    let id = yesterday(&sandbox, sandbox.host(shell.clone()));
    let before = sandbox.record("cart", &id).len();
    let session = sandbox.agent_session_id("cart", &id);

    let host = sandbox.host(shell);
    host.send("cart", &id, "오늘의 말").expect("보내기");
    let record = sandbox.wait_kind("cart", &id, "turn-end", 2);

    assert_eq!(revival_steps(&sandbox), [("session/load".to_owned(), true)], "resume을 광고하지 않으면 load다");
    assert_eq!(opened_hows(&record), ["new", "loaded"]);
    assert_eq!(sandbox.agent_session_id("cart", &id), session);
    let revived: Vec<&Value> = record[before..].iter().take_while(|line| line["kind"] != "sent").collect();
    let kinds: Vec<String> = revived
        .iter()
        .map(|line| match line["kind"].as_str().unwrap() {
            "session" => format!("session:{}", line["payload"]["state"].as_str().unwrap()),
            "update" => format!("update:{}", line["payload"]["update"]["sessionUpdate"].as_str().unwrap()),
            other => other.to_owned(),
        })
        .collect();
    assert_eq!(
        kinds,
        ["session:spawning", "session:opened", "update:session_info_update"],
        "load 답 전에 되감은 update는 0줄 적히고(화면은 앱의 기록으로 그린다), 답 뒤의 줄은 열림 줄 뒤에 산다"
    );
    let text = std::fs::read_to_string(sandbox.record_path("cart", &id)).unwrap();
    assert!(!text.contains("되감은"), "재생된 줄이 기록에 없다:\n{text}");
    assert_eq!(
        sandbox.acp_prompts(&session)[1]["prompt"],
        json!([{"type": "text", "text": "오늘의 말"}]),
        "load로 이었으니 머리말을 다시 붙이지 않는다"
    );

    host.shut_down();
}

#[test]
fn resume도_load도_실패하면_새_세션으로_열리고_열림_줄이_fresh이고_다음_말에_머리말이_다시_붙는다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let id = yesterday(&sandbox, sandbox.host(sandbox.codex_login_shell("resume-advertised", &[])));
    let first_session = sandbox.agent_session_id("cart", &id);

    // 다시 켠 앱의 에이전트는 그 세션을 모른다 — 세션 저장소가 비었다.
    let host = sandbox.host(sandbox.codex_login_shell("resume-advertised", &[("FAKE_ACP_FORGETS", "1")]));
    host.send("cart", &id, "오늘의 말").expect("보내기");
    let record = sandbox.wait_kind("cart", &id, "turn-end", 2);

    assert_eq!(
        revival_steps(&sandbox),
        [("session/resume".to_owned(), false), ("session/load".to_owned(), false)],
        "앞 단계의 오류는 다음 단계로 넘어간다 — resume → load → 새 세션"
    );
    assert_eq!(opened_hows(&record), ["new", "fresh"], "맥락을 잇지 못했다고 열림 줄이 말한다(스토리 86)");
    let second_session = sandbox.agent_session_id("cart", &id);
    assert_ne!(second_session, first_session, "새 세션의 id가 agents.json에 적힌다");
    assert_eq!(
        sandbox.acp_prompts(&second_session)[0]["prompt"],
        json!([preamble(&work, "cart"), {"type": "text", "text": "오늘의 말"}]),
        "새 세션의 첫 말에 머리말이 다시 붙는다(S11)"
    );
    assert_eq!(sandbox.acp_prompts(&first_session).len(), 1, "옛 세션은 더 말을 받지 않았다");

    host.shut_down();
}

#[test]
fn resume_resets_config_되살린_뒤_가짜가_기록의_모델_모드_계획을_set으로_받는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("resume-resets-config", &[]);
    let host = sandbox.host(shell.clone());
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let id = conversation.id;
    host.set_model("cart", &id, "gpt-6-astra").expect("떠 있는 대화에서 모델을 바꾼다");
    host.shut_down();
    let session = sandbox.agent_session_id("cart", &id);
    assert_eq!(sandbox.acp_config(&session).len(), 1);

    let host = sandbox.host(shell);
    // 띄우지 않은 동안 바꾼 값 — agents.json에만 남는다(티켓 09).
    host.set_mode("cart", &id, "read-only").expect("모드");
    host.set_plan("cart", &id, true).expect("계획");
    assert_eq!(sandbox.acp_launches().len(), 1, "띄우지 않은 대화의 바꾸기는 띄우지 않는다");

    host.send("cart", &id, "오늘의 말").expect("보내기");
    let record = sandbox.wait_kind("cart", &id, "turn-end", 1);

    let opened = record.iter().rfind(|line| line["payload"]["state"] == "opened").unwrap();
    assert_eq!(opened["payload"]["how"], "resumed");
    assert_eq!(opened["payload"]["modes"]["currentModeId"], "agent", "resume은 config 기본값으로 되돌린다(three-axes 결정 27)");
    assert_eq!(
        sandbox.acp_config(&session)[1..],
        [
            json!({"method": "session/set_config_option", "params": {"sessionId": session, "configId": "model", "value": "gpt-6-astra"}}),
            json!({"method": "session/set_mode", "params": {"sessionId": session, "modeId": "read-only"}}),
            json!({"method": "session/set_config_option",
                   "params": {"sessionId": session, "configId": "collaboration_mode", "value": "plan"}}),
        ],
        "되살린 뒤 기록의 모델 · 모드 · 계획을 set_*로 다시 넣는다 — 띄우지 않은 동안 바꾼 값도 든다"
    );
    let inbox = sandbox.acp_inbox(&session);
    let resumed_at = inbox.iter().rposition(|method| method == "session/resume").expect("resume을 받았다");
    assert_eq!(
        inbox[resumed_at..],
        ["session/resume", "session/set_config_option", "session/set_mode", "session/set_config_option", "session/prompt"],
        "설정이 다 든 뒤에 말이 간다"
    );
    assert_eq!(
        payloads_of(&record, "config"),
        [json!({"model": "gpt-6-astra"})],
        "config 줄은 사람이 떠 있는 엔진에 넣은 바꾸기뿐이다 — 다시 넣은 것은 적지 않는다"
    );
    let row = sandbox.agents_row("cart", &id);
    assert_eq!((&row["model"], &row["mode"], &row["plan"]), (&json!("gpt-6-astra"), &json!("read-only"), &json!(true)));

    host.shut_down();
}

#[test]
fn 프로젝트를_나중에_붙인_work에서도_되살린_대화의_cwd는_agents_json의_것이고_새_대화부터_새_자리다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let id = yesterday(&sandbox, sandbox.host(sandbox.codex_login_shell("resume-advertised", &[])));
    let spec = work.join("spec");
    assert_eq!(sandbox.agents_row("cart", &id)["cwd"], json!(spec), "프로젝트가 없는 work의 대화는 spec 폴더에서 일한다(three-axes 결정 17)");

    // 그 뒤에 work에 프로젝트가 붙었다.
    sandbox.work("cart", &["shop"]);
    // 되살리기의 세 단계가 다 받는 자리를 보도록 다시 켠 에이전트는 그 세션을 모른다.
    let host = sandbox.host(sandbox.codex_login_shell("resume-advertised", &[("FAKE_ACP_FORGETS", "1")]));
    host.send("cart", &id, "오늘의 말").expect("보내기");
    sandbox.wait_kind("cart", &id, "turn-end", 2);

    let revivals = sandbox.acp_revivals();
    assert_eq!(revivals.len(), 2);
    for revival in &revivals {
        assert_eq!(revival["params"]["cwd"], json!(spec), "{}은 agents.json의 cwd로 간다", revival["method"]);
        assert!(revival["params"].get("additionalDirectories").is_none(), "함께 여는 폴더도 agents.json의 것(없음)이다");
    }
    let fresh = sandbox.acp_receipt(&sandbox.agent_session_id("cart", &id));
    assert_eq!(fresh["sessionNew"]["cwd"], json!(spec), "새 세션으로 끝나도 agents.json의 자리에서 연다");
    assert!(fresh["sessionNew"].get("additionalDirectories").is_none());
    assert_eq!(sandbox.agents_row("cart", &id)["cwd"], json!(spec), "agents.json의 자리는 그대로다");

    let newer = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    assert_eq!(
        sandbox.agents_row("cart", &newer.id)["cwd"],
        json!(work.join("trees/shop")),
        "새 대화부터 새 규칙(프로젝트 하나 → 그 워크트리)을 따른다(three-axes 결정 17)"
    );

    host.shut_down();
}

/// 대화 목록의 그 대화의 대기 줄 글들.
fn listed_queue(host: &ConversationHost, id: &str) -> Vec<String> {
    let listed = host.list_conversations("cart").expect("대화 목록");
    listed.iter().find(|conversation| conversation.id == id).unwrap().queue.iter().map(|queued| queued.text.clone()).collect()
}

#[test]
fn dies_mid_turn_권한이_걸린_채_죽으면_거둬짐과_죽음_줄이_적히고_대기_줄은_그대로이고_다음_말에_다시_뜬다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("dies-mid-turn", &[("FAKE_ACP_DIES_ASKING", "1")]);
    let (host, events) = sandbox.host_with_events(shell);
    let id = host.new_conversation("cart", Agent::Codex).expect("새 대화").id;
    let first_session = sandbox.agent_session_id("cart", &id);

    host.send("cart", &id, "첫 말").expect("첫 말");
    sandbox.wait_record("cart", &id, |record| record.iter().any(|line| line["payload"]["state"] == "asked"));
    host.send("cart", &id, "대기 말").expect("권한이 걸린 동안의 말은 대기 줄에 든다");
    assert_eq!(listed_queue(&host, &id), ["대기 말"]);
    let queue_events_before = events.all().len();
    sandbox.release_turn(&first_session);
    let record = sandbox.wait_record("cart", &id, |record| record.iter().any(|line| line["payload"]["state"] == "died"));

    let tail: Vec<Value> = record
        .iter()
        .filter(|line| matches!(line["kind"].as_str(), Some("permission" | "session")))
        .map(|line| line["payload"].clone())
        .skip_while(|payload| payload["state"] != "asked")
        .map(|payload| match payload["state"].as_str() {
            Some("died") => json!({"state": "died"}),
            Some("asked") => json!({"state": "asked", "requestId": payload["requestId"]}),
            _ => payload,
        })
        .collect();
    assert_eq!(
        tail,
        [
            json!({"state": "asked", "requestId": "0"}),
            json!({"state": "withdrawn", "requestId": "0", "reason": "died"}),
            json!({"state": "died"}),
        ],
        "걸린 권한 요청은 닫히고 「거둬짐(죽음)」이 죽음 줄 앞에 적힌다:\n{}",
        common::lines_text(&record)
    );
    assert_eq!(
        host.answer_permission("cart", &id, "0", "allow_once"),
        Err(atelier_acp::HostError::PermissionClosed { conversation: id.clone(), request: "0".into() }),
        "죽은 에이전트의 요청에는 답할 수 없다"
    );
    assert_eq!(listed_queue(&host, &id), ["대기 말"], "대기 줄은 그대로다(S13)");
    assert!(
        !events.all()[queue_events_before..].iter().any(|event| matches!(event, atelier_acp::HostEvent::Queue { .. })),
        "죽음은 대기 줄을 바꾸지 않는다"
    );

    host.send("cart", &id, "다음 말").expect("다음 말에서 다시 띄워 되살린다");
    let record = sandbox.wait_kind("cart", &id, "turn-end", 2);
    assert_eq!(sandbox.acp_launches().len(), 2, "앱을 다시 켜지 않고 다시 떴다(스토리 88)");
    assert_eq!(opened_hows(&record), ["new", "fresh"]);
    assert_eq!(sent_texts(&record), ["첫 말", "대기 말", "다음 말"], "남은 대기 줄이 먼저 가고 다음 말이 그 뒤에 간다");
    let second_session = sandbox.agent_session_id("cart", &id);
    let prompts = sandbox.acp_prompts(&second_session);
    assert_eq!(
        prompts[0]["prompt"],
        json!([preamble(&work, "cart"), {"type": "text", "text": "대기 말"}]),
        "새 세션의 첫 말(대기 줄의 맨 앞)에 머리말이 붙는다"
    );
    assert_eq!(listed_queue(&host, &id), Vec::<String>::new());

    host.shut_down();
    // S26 — 대화창의 L3(티켓 20 · 23)가 죽음 줄(까닭 · stderr 꼬리)과 그 뒤 끊긴 도구 줄을 이것으로 잰다. 가짜는 걸린 채 놓일 때까지
    // 기다렸다 죽으므로 stderr 줄이 update 사이에 끼지 않는다 — 줄 차례가 매번 같다.
    common::assert_record(
        "codex-died",
        &common::fix_record_sessions(&record, &sandbox.data_root(), &[&first_session, &second_session]),
    );
}

/// S26 — 「되살리기」(앱을 다시 켠 뒤 말을 보냈는데 resume도 load도 못 해 새 세션으로 열림)의 결과 기록이 검사 자료로 서고,
/// 매번 다시 지은 기록이 그것과 같다. 대화창의 L3 목업 백엔드(티켓 23)가 이 파일을 쏜다 — 다시 켠 화면이 기록으로 그려지고
/// 「새로 시작함」 상태 줄이 선다.
#[test]
fn 되살리기의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 진짜 codex-acp처럼 로그인된 계정을 알린다 — 자료에도 가린 꼴로 선다.
    let email = ("FAKE_ACP_ACCOUNT_EMAIL", "someone@example.com");
    let id = yesterday(&sandbox, sandbox.host(sandbox.codex_login_shell("resume-advertised", &[email])));
    let first_session = sandbox.agent_session_id("cart", &id);

    let host = sandbox.host(sandbox.codex_login_shell("resume-advertised", &[email, ("FAKE_ACP_FORGETS", "1")]));
    host.send("cart", &id, "오늘의 말").expect("보내기");
    let record = sandbox.wait_kind("cart", &id, "turn-end", 2);
    host.shut_down();

    let second_session = sandbox.agent_session_id("cart", &id);
    common::assert_record(
        "resume",
        &common::fix_record_sessions(&record, &sandbox.data_root(), &[&first_session, &second_session]),
    );
}

#[test]
fn 죽은_대화의_대기_말을_지금_보내면_되살린_뒤_그_말이_먼저_간다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("dies-mid-turn", &[("FAKE_ACP_DIES_ASKING", "1")]);
    let host = sandbox.host(shell);
    let id = host.new_conversation("cart", Agent::Codex).expect("새 대화").id;
    let first_session = sandbox.agent_session_id("cart", &id);
    host.send("cart", &id, "첫 말").expect("첫 말");
    sandbox.wait_record("cart", &id, |record| record.iter().any(|line| line["payload"]["state"] == "asked"));
    host.send("cart", &id, "가").expect("대기 줄");
    host.send("cart", &id, "나").expect("대기 줄");
    sandbox.release_turn(&first_session);
    sandbox.wait_record("cart", &id, |record| record.iter().any(|line| line["payload"]["state"] == "died"));

    let listed = host.list_conversations("cart").unwrap();
    let picked = listed[0].queue.iter().find(|queued| queued.text == "나").unwrap().id.clone();
    host.send_now("cart", &id, &picked).expect("죽은 대화의 지금 보내기는 보내기처럼 되살린다");
    let record = sandbox.wait_kind("cart", &id, "turn-end", 2);

    assert_eq!(opened_hows(&record), ["new", "fresh"]);
    assert_eq!(sent_texts(&record), ["첫 말", "나", "가"], "고른 말이 먼저 가고 나머지 대기 줄이 그 뒤에 간다");
    let send_now: Vec<bool> = of_kind(&record, "sent").iter().map(|line| line["payload"]["sendNow"].as_bool().unwrap()).collect();
    assert_eq!(send_now, [false, true, false]);

    host.shut_down();
}

#[test]
fn 되살리는_동안_칩으로_바꾼_모델은_되살린_뒤에도_agents_json과_엔진에_남는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let id = yesterday(&sandbox, sandbox.host(sandbox.codex_login_shell("resume-resets-config", &[])));
    let session = sandbox.agent_session_id("cart", &id);

    // 다시 켠 앱 — 되살리기가 resume의 답 앞에서 붙잡힌다.
    let host = sandbox.host(sandbox.codex_login_shell("resume-resets-config", &[("FAKE_ACP_REVIVE_HOLDS", "1")]));
    std::thread::scope(|scope| {
        let sending = scope.spawn(|| host.send("cart", &id, "오늘의 말"));
        common::wait_for("되살리기가 resume까지 가지 않았다", || !sandbox.acp_revivals().is_empty());
        let changing = scope.spawn(|| host.set_model("cart", &id, "gpt-6-astra"));
        // 바꾸기가 되살리기를 앞질러 끝나는지 잠깐 본다 — 앞질러 끝나든 되살리기를 기다리든 남는 값은 같아야 한다.
        let started = std::time::Instant::now();
        while !changing.is_finished() && started.elapsed() < std::time::Duration::from_millis(500) {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        sandbox.release_turn(&session);
        sending.join().unwrap().expect("보내기");
        changing.join().unwrap().expect("되살리는 동안의 바꾸기도 받는다");
    });
    sandbox.wait_kind("cart", &id, "turn-end", 2);

    assert_eq!(
        sandbox.agents_row("cart", &id)["model"],
        json!("gpt-6-astra"),
        "되살리는 동안 바꾼 모델이 되살리기가 다시 쓴 agents.json에 남는다"
    );
    let model_set = json!({"method": "session/set_config_option",
                           "params": {"sessionId": session, "configId": "model", "value": "gpt-6-astra"}});
    assert!(
        sandbox.acp_config(&session).contains(&model_set),
        "되살린 엔진도 그 모델을 받는다: {:?}",
        sandbox.acp_config(&session)
    );

    host.shut_down();
}

#[test]
fn 쓰다_끊긴_반쪽_줄이_남은_기록을_되살려도_이어_적은_줄이_다_읽힌다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("resume-advertised", &[]);
    let id = yesterday(&sandbox, sandbox.host(shell.clone()));
    let yesterday_end = sandbox.record("cart", &id).last().unwrap()["seq"].as_u64().unwrap();
    // 앱이 줄을 쓰다 죽었다 — 끝에 줄바꿈이 없는 반쪽 줄이 남는다.
    let path = sandbox.record_path("cart", &id);
    let mut text = std::fs::read_to_string(&path).unwrap();
    text.push_str(&format!("{{\"seq\":{},\"at", yesterday_end + 1));
    std::fs::write(&path, text).unwrap();

    let host = sandbox.host(shell);
    host.send("cart", &id, "오늘의 말").expect("보내기");
    // 반쪽 줄은 JSON으로 읽히지 않으니 파일을 줄마다 읽는 도우미 대신 호스트의 기록 읽기로 지켜본다.
    let read = common::wait_until("되살린 턴의 끝이 읽히지 않는다", || {
        let read = host.read_record("cart", &id, yesterday_end).expect("기록 읽기");
        if read.iter().any(|line| line.kind == atelier_acp::RecordKind::TurnEnd) {
            Ok(read)
        } else {
            Err(std::fs::read_to_string(&path).unwrap())
        }
    });
    let seqs: Vec<u64> = read.iter().map(|line| line.seq).collect();
    let expected: Vec<u64> = (yesterday_end + 1..=yesterday_end + seqs.len() as u64).collect();
    assert_eq!(seqs, expected, "반쪽 줄 뒤에 이어 적은 줄이 하나도 빠지지 않는다 — 되살린 첫 줄(띄우는 중)도 읽힌다");
    assert_eq!(
        serde_json::to_value(&read[0]).unwrap()["payload"],
        json!({"state": "spawning"}),
        "되살리기의 첫 줄이 반쪽 꼬리에 붙지 않고 제 줄로 선다"
    );

    host.shut_down();
}

#[test]
fn 다시_켠_뒤_함께_온_보내기_둘은_에이전트를_하나만_띄운다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("resume-advertised", &[]);
    let id = yesterday(&sandbox, sandbox.host(shell.clone()));

    let host = sandbox.host(shell);
    std::thread::scope(|scope| {
        for text in ["하나", "둘"] {
            let (host, id) = (&host, &id);
            scope.spawn(move || host.send("cart", id, text).expect("보내기"));
        }
    });
    let record = sandbox.wait_kind("cart", &id, "turn-end", 3);

    assert_eq!(sandbox.acp_launches().len(), 2, "어제의 하나와 오늘의 하나 — 함께 온 보내기가 둘을 띄우지 않는다");
    assert_eq!(opened_hows(&record), ["new", "resumed"]);
    let mut today = sent_texts(&record)[1..].to_vec();
    today.sort();
    assert_eq!(today, ["둘", "하나"], "늦은 말은 대기 줄로 가서 뒤따른다");

    host.shut_down();
}
