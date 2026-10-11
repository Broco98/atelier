//! L1 — 대화 호스트 ↔ 가짜 ACP 에이전트(임시 PATH의 `codex-acp`): `+`를 누르면 에이전트가 떠서 세션을 열고,
//! 대화를 닫거나 앱을 끄면 남김없이 꺼진다(three-axes 티켓 03 · 스토리 3 · 4 · 9 · 10 · 89 · 104 · 105 · 106 · 109).
//!
//! 시험은 호스트에 명령을 넣고, 나오는 이벤트 · `agents/` 파일 · 가짜가 남긴 영수증만 본다.

mod common;

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use atelier_acp::{Agent, HostError, HostEvent};
use common::{assert_all_gone, is_running, own_sid, Sandbox};
use serde_json::json;

#[test]
fn 새_대화는_fs와_terminal을_끄고_plan만_광고하고_세션을_mcp_없이_연다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));

    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    let row = sandbox.agents_row("cart", &conversation.id);
    let receipt = sandbox.acp_receipt(row["agentSessionId"].as_str().expect("에이전트 쪽 세션 id"));
    assert_eq!(
        receipt["initialize"]["clientCapabilities"],
        json!({"fs": {"readTextFile": false, "writeTextFile": false}, "terminal": false, "plan": {}}),
        "elicitation은 광고하지 않는다(three-axes 결정 30)"
    );
    assert_eq!(receipt["initialize"]["protocolVersion"], json!(1));
    assert_eq!(
        receipt["sessionNew"],
        json!({"cwd": work.join("spec"), "mcpServers": []}),
        "프로젝트가 없으면 spec 폴더에서 일하고 함께 여는 폴더가 없다"
    );

    host.shut_down();
}

#[test]
fn 프로젝트가_하나면_그_워크트리에서_여럿이면_trees에서_일하고_spec_폴더를_함께_연다() {
    let sandbox = Sandbox::new();
    let one = sandbox.work("one", &["atelier"]);
    let many = sandbox.work("many", &["atelier", "site"]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));

    let in_one = host.new_conversation("one", Agent::Codex).expect("프로젝트 하나");
    let in_many = host.new_conversation("many", Agent::Codex).expect("프로젝트 여럿");

    let session_new = |slug: &str, id: &str| {
        let row = sandbox.agents_row(slug, id);
        sandbox.acp_receipt(row["agentSessionId"].as_str().unwrap())["sessionNew"].clone()
    };
    assert_eq!(
        session_new("one", &in_one.id),
        json!({"cwd": one.join("trees/atelier"), "additionalDirectories": [one.join("spec")], "mcpServers": []}),
    );
    assert_eq!(
        session_new("many", &in_many.id),
        json!({"cwd": many.join("trees"), "additionalDirectories": [many.join("spec")], "mcpServers": []}),
    );

    host.shut_down();
}

#[test]
fn 자식_env는_준_env와_정확히_같고_자식은_새_세션에_있다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 로그인 env에 사용자 변수 하나와, 에이전트에게 새면 안 되는 앱 · Claude 세션 변수를 싣는다.
    let shell = sandbox.codex_login_shell(
        "normal",
        &[("KEEP_ME", "yes"), ("CODEX_HOME", "/somewhere/.codex"), ("ATELIER_SHELL", "7"), ("CLAUDECODE", "1")],
    );
    let (host, _events) = sandbox.host_with_events(shell);

    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    let row = sandbox.agents_row("cart", &conversation.id);
    let receipt = sandbox.acp_receipt(row["agentSessionId"].as_str().unwrap());
    let child_env: BTreeMap<String, String> = serde_json::from_value(receipt["env"].clone()).unwrap();

    // 준 env = 로그인 env에서 앱 · Claude 세션 변수를 빼고(three-axes 티켓 02) GIT_OPTIONAL_LOCKS=0과
    // 찾은 codex를 가리키는 CODEX_PATH를 더한 것. 부모(이 시험 프로세스)에만 있는 변수는 없다.
    let mut given = sandbox.login_env();
    given.remove("ATELIER_SHELL");
    given.remove("CLAUDECODE");
    given.insert("GIT_OPTIONAL_LOCKS".into(), "0".into());
    given.insert("CODEX_PATH".into(), sandbox.bin("codex-bin").join("codex").display().to_string());
    assert_eq!(child_env, given);
    assert_eq!(child_env.get("KEEP_ME").map(String::as_str), Some("yes"), "로그인 env의 변수가 그대로 간다");
    assert_eq!(child_env.get("CODEX_HOME").map(String::as_str), Some("/somewhere/.codex"), "사용자의 CODEX_HOME을 그대로 쓴다");
    assert!(!child_env.contains_key("INITIAL_AGENT_MODE"), "시작 모드는 엔진 기본값이다");
    assert!(!child_env.contains_key("CARGO_PKG_NAME"), "부모에만 있는 변수가 새지 않는다");

    let pid = receipt["pid"].as_i64().unwrap();
    assert_eq!(receipt["sid"].as_i64(), Some(pid), "자식이 새 세션의 리더다");
    assert_ne!(receipt["sid"].as_i64(), Some(own_sid() as i64), "시험의 세션과 갈린다");

    host.shut_down();
}

#[test]
fn 새_대화가_agents_json에_서고_기록에_띄우는_중_열림_줄이_같은_seq의_이벤트로도_온다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let (host, events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));

    let first = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let second = host.new_conversation("cart", Agent::Codex).expect("둘째 대화");

    assert_eq!((first.name.as_str(), second.name.as_str()), ("Codex", "Codex 2"), "이름은 에이전트 이름으로 저절로 붙는다");
    let row = sandbox.agents_row("cart", &first.id);
    assert!(row["createdAt"].as_str().is_some_and(|at| !at.is_empty()));
    let mut fixed = row.clone();
    fixed["agentSessionId"] = json!("<session>");
    fixed["createdAt"] = json!("<at>");
    assert_eq!(
        fixed,
        json!({
            "id": first.id, "agent": "codex", "name": "Codex",
            "cwd": work.join("spec"), "additionalDirectories": [],
            "agentSessionId": "<session>", "model": null, "mode": null, "plan": null,
            "createdAt": "<at>", "closedAt": null
        }),
        "엔진 기본값으로 만든 대화 — 모델 · 모드 · 계획이 비어 있다"
    );
    assert_eq!(sandbox.agents_json("cart")["conversations"].as_array().unwrap().len(), 2);

    let record = sandbox.record("cart", &first.id);
    let shapes: Vec<_> = record.iter().map(|line| (line["seq"].clone(), line["kind"].clone(), line["payload"].clone())).collect();
    assert_eq!(
        shapes,
        vec![
            (json!(1), json!("session"), json!({"state": "spawning"})),
            (
                json!(2),
                json!("session"),
                json!({
                    "state": "opened", "how": "new", "agentVersion": "2.2.2",
                    "modes": {"availableModes": [{"id": "agent", "name": "Auto review"}], "currentModeId": "agent"},
                    "models": {"availableModels": [{"modelId": "fake-model", "name": "Fake model"}], "currentModelId": "fake-model"},
                    "configOptions": [{"id": "model", "name": "Model", "type": "select", "currentValue": "fake-model",
                                       "options": [{"value": "fake-model", "name": "Fake model"}]}]
                })
            ),
        ],
    );
    assert!(record.iter().all(|line| line["at"].as_str().is_some_and(|at| !at.is_empty())), "줄마다 시각이 있다");
    assert_eq!(first.last_seq, 2);

    let emitted: Vec<serde_json::Value> = events
        .all()
        .into_iter()
        .filter_map(|event| match event {
            HostEvent::Record { work, conversation, line } if work == "cart" && conversation == first.id => {
                Some(serde_json::to_value(line).unwrap())
            }
            _ => None,
        })
        .collect();
    assert_eq!(emitted, record, "적은 줄이 같은 seq · 같은 모양의 기록 줄 이벤트로 나간다");

    let mut names: Vec<String> = std::fs::read_dir(work.join("agents"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    let mut expected = vec!["agents.json".to_owned(), format!("{}.jsonl", first.id), format!("{}.jsonl", second.id)];
    expected.sort();
    assert_eq!(names, expected, "tmp를 남기지 않는다");

    host.shut_down();
}

/// 에이전트와 그 후손의 pid — 가짜가 영수증에 적었다.
fn agent_tree(sandbox: &Sandbox, slug: &str, conversation: &str) -> (String, Vec<u32>) {
    let row = sandbox.agents_row(slug, conversation);
    let session_id = row["agentSessionId"].as_str().expect("에이전트 쪽 세션 id").to_owned();
    let receipt = sandbox.acp_receipt(&session_id);
    let mut pids = vec![receipt["pid"].as_u64().unwrap() as u32];
    pids.extend(receipt["descendants"].as_array().unwrap().iter().map(|pid| pid.as_u64().unwrap() as u32));
    (session_id, pids)
}

#[test]
fn 대화를_닫으면_자식과_손주까지_꺼지고_닫은_때가_적히고_줄과_기록은_남는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("spawns-a-child", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let (session_id, pids) = agent_tree(&sandbox, "cart", &conversation.id);
    assert_eq!(pids.len(), 3, "에이전트 · 자식 · 손주");
    assert!(pids.iter().all(|pid| is_running(*pid)), "닫기 전에는 셋 다 살아 있다");

    host.close_conversation("cart", &conversation.id).expect("닫기");

    assert_all_gone(&pids);
    assert_eq!(sandbox.acp_events(&session_id), ["stdin-eof"], "먼저 stdin을 닫아 얌전히 끝낼 틈을 준다");
    let row = sandbox.agents_row("cart", &conversation.id);
    assert!(row["closedAt"].as_str().is_some_and(|at| !at.is_empty()), "닫은 때가 적힌다: {row}");
    let record = sandbox.record("cart", &conversation.id);
    let last = record.last().unwrap();
    assert_eq!((&last["seq"], &last["kind"], &last["payload"]), (&json!(3), &json!("session"), &json!({"state": "closed"})));
}

#[test]
fn 끄기를_무시하는_에이전트도_stdin을_닫은_1초_뒤에_그룹째_꺼진다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("ignores-shutdown", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let (session_id, pids) = agent_tree(&sandbox, "cart", &conversation.id);

    let started = Instant::now();
    host.close_conversation("cart", &conversation.id).expect("닫기");
    let took = started.elapsed();

    assert_all_gone(&pids);
    assert_eq!(sandbox.acp_events(&session_id), ["stdin-eof"], "stdin EOF를 받고도 버텼다");
    assert!(took >= Duration::from_millis(900), "스스로 끝나기를 1초 기다린다: {took:?}");
    assert!(took < Duration::from_secs(3), "1초가 지나면 곧바로 SIGKILL한다: {took:?}");
}

#[test]
fn 호스트를_끄면_모든_대화의_후손이_꺼지고_대화는_닫히지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    sandbox.work("site", &["web"]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("spawns-a-child", &[]));
    let a = host.new_conversation("cart", Agent::Codex).expect("cart 대화");
    let b = host.new_conversation("site", Agent::Codex).expect("site 대화");
    let mut pids = agent_tree(&sandbox, "cart", &a.id).1;
    pids.extend(agent_tree(&sandbox, "site", &b.id).1);
    assert_eq!(pids.len(), 6);

    host.shut_down();

    assert_all_gone(&pids);
    for (slug, conversation) in [("cart", &a.id), ("site", &b.id)] {
        assert_eq!(sandbox.agents_row(slug, conversation)["closedAt"], json!(null), "앱 종료는 대화를 닫지 않는다 — 다시 켜면 이어 간다");
    }
}

#[test]
fn 호스트_끄기는_모든_대화의_stdin을_함께_닫고_1초를_한_번만_기다린다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("ignores-shutdown", &[]));
    let mut pids = Vec::new();
    for _ in 0..3 {
        let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
        pids.extend(agent_tree(&sandbox, "cart", &conversation.id).1);
    }

    let started = Instant::now();
    host.shut_down();
    let took = started.elapsed();

    assert_all_gone(&pids);
    assert!(took >= Duration::from_millis(900), "1초는 기다린다: {took:?}");
    assert!(took < Duration::from_secs(2), "대화마다 1초씩 줄을 세우지 않는다: {took:?}");
}

/// 기록 줄의 `kind` · `payload`만.
fn shapes(record: &[serde_json::Value]) -> Vec<(serde_json::Value, serde_json::Value)> {
    record.iter().map(|line| (line["kind"].clone(), line["payload"].clone())).collect()
}

#[test]
fn 판_메이저가_다른_에이전트는_판_경고_줄을_남기고_대화는_열린다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[("FAKE_ACP_VERSION", "3.0.0")]));

    let conversation = host.new_conversation("cart", Agent::Codex).expect("판이 달라도 연다");

    let record = sandbox.record("cart", &conversation.id);
    let states: Vec<_> = record.iter().map(|line| line["payload"]["state"].clone()).collect();
    assert_eq!(states, [json!("spawning"), json!("version-warning"), json!("opened")]);
    assert_eq!(record[1]["payload"], json!({"state": "version-warning", "agentVersion": "3.0.0", "supportedMajor": 2}));
    assert_eq!(record[2]["payload"]["agentVersion"], json!("3.0.0"));

    host.shut_down();
}

#[test]
fn 실행할_수_없는_codex_acp는_읽히는_오류이고_대화에_까닭이_남는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 실행 비트는 있지만 해석기가 없다 — 지운 node를 가리키는 shebang 같은 꼴이다.
    let (host, _events) =
        sandbox.host_with_events(sandbox.codex_login_shell_with_program(b"#!/nonexistent/node\nconsole.log(1)\n"));

    let error = host.new_conversation("cart", Agent::Codex).expect_err("띄울 수 없다");

    let HostError::Open { conversation, reason } = &error else { panic!("열기 실패여야 한다: {error:?}") };
    assert!(error.to_string().contains("실행할 수 없습니다"), "왜 못 열었는지 말한다: {error}");
    assert!(error.to_string().contains("codex-acp"), "무엇을 띄우려 했는지 말한다: {error}");
    let record = sandbox.record("cart", conversation);
    assert_eq!(
        shapes(&record),
        [(json!("session"), json!({"state": "spawning"})), (json!("session"), json!({"state": "died", "reason": reason}))],
    );
    assert_eq!(sandbox.agents_row("cart", conversation)["closedAt"], json!(null), "대화는 남는다 — 다음 말에서 다시 띄운다");
}

#[test]
fn acp가_아닌_말을_하고_끝나는_명령은_읽히는_오류이고_남은_프로세스가_없다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let script = b"#!/bin/sh\necho $$ >> \"$FAKE_ACP_RECEIPTS/pids\"\necho 'usage: codex-acp [options]'\nexit 1\n";
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell_with_program(script));

    let error = host.new_conversation("cart", Agent::Codex).expect_err("ACP가 아니다");

    assert!(matches!(error, HostError::Open { .. }), "{error:?}");
    assert!(error.to_string().contains("initialize에 답하지 않고 끝났습니다"), "{error}");
    assert!(error.to_string().contains("codex-acp"), "{error}");
    let pids = sandbox.receipt_pids("pids");
    assert_eq!(pids.len(), 1, "스크립트가 떴어야 한다");
    assert_all_gone(&pids);
}

#[test]
fn acp가_아닌_말을_하고_버티는_명령은_한도에서_끊기고_후손까지_남지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let script = b"#!/bin/sh\n\
        echo $$ >> \"$FAKE_ACP_RECEIPTS/pids\"\n\
        sleep 600 &\n\
        echo $! >> \"$FAKE_ACP_RECEIPTS/pids\"\n\
        echo 'hello, this is not ACP'\n\
        wait\n";
    let (builder, _events) = sandbox.host_builder_with_events(sandbox.codex_login_shell_with_program(script));
    let host = builder.open_limit(Duration::from_secs(1)).build();

    let started = Instant::now();
    let error = host.new_conversation("cart", Agent::Codex).expect_err("세션을 열지 않는다");

    assert!(matches!(error, HostError::Open { .. }), "{error:?}");
    assert!(error.to_string().contains("1초 안에 세션을 열지 않았습니다"), "{error}");
    assert!(started.elapsed() < Duration::from_secs(5), "한도에서 끊는다: {:?}", started.elapsed());
    let pids = sandbox.receipt_pids("pids");
    assert_eq!(pids.len(), 2, "스크립트와 그 자식");
    assert_all_gone(&pids);
}

#[test]
fn work_json이_없는_폴더에는_agents를_만들지_않는다() {
    let sandbox = Sandbox::new();
    // 아카이브로 work.json이 옮겨 간 뒤에 남은 꼴 — 폴더와 spec은 있지만 work.json이 없다.
    let ghost = sandbox.work_dir("ghost");
    std::fs::create_dir_all(ghost.join("spec")).unwrap();
    let (host, events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));

    for slug in ["ghost", "nowhere", "../escape"] {
        let error = host.new_conversation(slug, Agent::Codex).expect_err("work가 없다");
        assert_eq!(error, HostError::WorkNotFound(slug.to_owned()));
        assert!(error.to_string().contains(slug), "{error}");
    }

    assert!(!ghost.join("agents").exists(), "work.json이 없는 폴더에 agents/가 생기지 않는다");
    assert!(!sandbox.work_dir("nowhere").exists(), "없는 work의 폴더를 만들지 않는다");
    assert!(!sandbox.data_root().join("escape").exists(), "데이터 루트 밖에 아무것도 만들지 않는다");
    assert!(events.all().is_empty(), "기록 줄도 없다");
}

#[test]
fn 대화_목록은_열린_대화를_만든_순서로_주고_닫은_대화는_빠진다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    sandbox.work("empty", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));
    assert_eq!(host.list_conversations("empty").expect("대화 없는 work"), []);
    assert!(!sandbox.work_dir("empty").join("agents").exists(), "목록 읽기는 아무것도 만들지 않는다");

    let first = host.new_conversation("cart", Agent::Codex).expect("첫 대화");
    let second = host.new_conversation("cart", Agent::Codex).expect("둘째 대화");
    let third = host.new_conversation("cart", Agent::Codex).expect("셋째 대화");
    host.close_conversation("cart", &second.id).expect("둘째를 닫는다");

    let listed = host.list_conversations("cart").expect("목록");
    assert_eq!(listed, [first.clone(), third.clone()]);
    assert_eq!(
        serde_json::to_value(&listed[0]).unwrap(),
        json!({"id": first.id, "agent": "codex", "name": "Codex", "model": null, "mode": null, "plan": null, "lastSeq": 2,
               "queue": [], "live": true}),
    );
    let fourth = host.new_conversation("cart", Agent::Codex).expect("넷째 대화");
    assert_eq!(fourth.name, "Codex 2", "닫은 대화의 이름은 다시 쓴다");
    assert_eq!(host.list_conversations("nowhere"), Err(HostError::WorkNotFound("nowhere".into())));

    host.shut_down();
}

#[test]
fn codex_acp를_못_찾으면_대화를_만들지_않고_빠진_것과_설치_명령을_준다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let bin = sandbox.bin("bin");
    sandbox.plant(&bin, "codex");
    sandbox.plant(&bin, "node");
    let shell = sandbox.login_shell(common::LoginShell::Normal, &[&bin]);
    let (host, events) = sandbox.host_with_events(atelier_acp::ShellSource::Path(shell));

    let error = host.new_conversation("cart", Agent::Codex).expect_err("codex-acp가 없다");

    assert_eq!(
        error,
        HostError::EngineMissing {
            agent: Agent::Codex,
            missing: vec![atelier_acp::MissingProgram {
                name: "codex-acp",
                install: "npm i -g @agentclientprotocol/codex-acp"
            }],
        }
    );
    assert!(error.to_string().contains("codex-acp"), "{error}");
    assert!(!sandbox.work_dir("cart").join("agents").exists(), "대화를 만들지 않는다");
    assert!(events.all().is_empty());
}
