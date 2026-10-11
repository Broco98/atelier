//! L1 — 사라진 work의 대화는 턴 끝에 꺼지고, 기록은 work를 따라간다(three-axes 티켓 11 · 스토리 92 · S10 · S18).
//!
//! 아카이브를 시킨 에이전트가 바로 그 대화 안에 있을 수 있다(MCP `atelier_archive_work`를 부른 그 턴). 그래서 호스트는
//! 곧바로 끄지 않고 턴이 끝나는 대로 끈다. 시험은 호스트에 명령을 넣고, `agents/` 파일 · 가짜가 남긴 영수증 · 프로세스만
//! 본다.

mod common;

use std::fs;
use std::path::PathBuf;

use atelier_acp::Agent;
use common::{assert_all_gone, wait_record_at, Sandbox};
use serde_json::{json, Value};

/// 기록 줄의 꼴 — kind와, 줄을 가르는 payload 칸 하나.
fn shape(line: &Value) -> (String, Value) {
    let payload = &line["payload"];
    let key = match line["kind"].as_str().unwrap_or_default() {
        "update" => payload["update"]["content"]["text"].clone(),
        "turn-end" => payload["stopReason"].clone(),
        _ => payload.clone(),
    };
    (line["kind"].as_str().unwrap_or_default().to_owned(), key)
}

fn says(line: &Value, text: &str) -> bool {
    line["kind"] == "update" && line["payload"]["update"]["content"]["text"] == text
}

fn closed(record: &[Value]) -> bool {
    record.iter().any(|line| line["kind"] == "session" && line["payload"]["state"] == "closed")
}

/// 아카이브 흉내 — work 폴더째 같은 볼륨 안의 `archive/<slug>`로 옮긴다(`atelier_core::archive_work`의 마지막 걸음).
fn archive_by_rename(sandbox: &Sandbox, slug: &str) -> PathBuf {
    let archived = sandbox.data_root().join("archive").join(slug);
    fs::create_dir_all(archived.parent().unwrap()).unwrap();
    fs::rename(sandbox.work_dir(slug), &archived).unwrap();
    archived
}

#[test]
fn 턴_도중_work_폴더가_옮겨지면_남은_줄이_옮겨진_같은_파일에_적히고_턴_끝에_꺼지고_옛_자리에_폴더가_생기지_않는다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("pauses-mid-turn", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let (session_id, pids) = sandbox.agent_tree("cart", &conversation.id);
    assert_eq!(pids.len(), 3, "에이전트 · 자식 · 손주");

    host.send("cart", &conversation.id, "이 work를 아카이브해 줘").expect("보내기");
    sandbox.wait_record("cart", &conversation.id, |record| record.iter().any(|line| says(line, "멈추기 전의 답")));
    let archived = archive_by_rename(&sandbox, "cart");
    sandbox.release_turn(&session_id);

    let moved = archived.join("agents").join(format!("{}.jsonl", conversation.id));
    let record = wait_record_at(&moved, closed);
    assert_all_gone(&pids);

    let tail: Vec<_> = record.iter().skip_while(|line| !says(line, "멈추기 전의 답")).skip(1).map(shape).collect();
    assert_eq!(
        tail,
        [
            ("update".to_owned(), json!("놓인 뒤의 답")),
            ("turn-end".to_owned(), json!("end_turn")),
            ("session".to_owned(), json!({"state": "closed", "cause": "work-vanished"})),
        ],
        "그 턴의 남은 줄이 옮겨진 자리의 같은 파일에 이어 적히고, 턴이 끝난 뒤에 꺼진다"
    );
    let seqs: Vec<u64> = record.iter().map(|line| line["seq"].as_u64().unwrap()).collect();
    assert_eq!(seqs, (1..=record.len() as u64).collect::<Vec<_>>(), "한 파일에 seq가 끊기지 않고 이어진다");
    assert_eq!(sandbox.acp_events(&session_id), ["paused", "stdin-eof"], "턴을 끊지 않고, 끝난 뒤 stdin을 닫아 끈다");
    assert!(!work.exists(), "옛 자리에 유령 work 폴더가 생기지 않는다");

    host.shut_down();
}

#[test]
fn 턴_도중_work가_지워져도_턴_끝에_꺼지고_옛_자리에_폴더가_생기지_않는다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("pauses-mid-turn", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let (session_id, pids) = sandbox.agent_tree("cart", &conversation.id);

    host.send("cart", &conversation.id, "이 work를 지워 줘").expect("보내기");
    sandbox.wait_record("cart", &conversation.id, |record| record.iter().any(|line| says(line, "멈추기 전의 답")));
    // 삭제 — 기록도 work와 함께 사라진다. 열어 둔 파일에 이어 쓴 줄은 지운 파일로 간다.
    fs::remove_dir_all(&work).unwrap();
    sandbox.release_turn(&session_id);

    assert_all_gone(&pids);
    assert_eq!(sandbox.acp_events(&session_id), ["paused", "stdin-eof"], "턴이 끝난 뒤 stdin을 닫아 끈다");
    assert!(!work.exists(), "옛 자리에 유령 work 폴더가 생기지 않는다");
    assert!(host.list_conversations("cart").is_err(), "사라진 work에는 대화 목록도 없다");

    host.shut_down();
}

#[test]
fn 쉬는_대화의_work가_사라지면_호스트가_사라짐을_안_때_꺼지고_다른_work의_대화는_그대로다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    sandbox.work("keep", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("spawns-a-child", &[]));
    let idle = host.new_conversation("cart", Agent::Codex).expect("사라질 work의 대화");
    let kept = host.new_conversation("keep", Agent::Codex).expect("남는 work의 대화");
    let (_, idle_pids) = sandbox.agent_tree("cart", &idle.id);
    let (_, kept_pids) = sandbox.agent_tree("keep", &kept.id);

    // 진짜 아카이브 — 앱의 명령과 MCP `atelier_archive_work`가 부르는 코어 함수 그대로(프로젝트가 없어 git이 없다).
    let root = sandbox.data_root();
    let works = atelier_core::works_in(&root);
    atelier_core::archive_work(&works, &root.join("archive"), &root.join("projects"), "cart").expect("아카이브");
    host.check_vanished_works();

    assert_all_gone(&idle_pids);
    let moved = root.join("archive/cart/agents").join(format!("{}.jsonl", idle.id));
    let record = wait_record_at(&moved, closed);
    assert_eq!(
        record.last().map(shape),
        Some(("session".to_owned(), json!({"state": "closed", "cause": "work-vanished"}))),
        "닫힘 줄이 work와 함께 아카이브로 간 기록에 적힌다"
    );
    assert!(!work.exists(), "옛 자리에 유령 work 폴더가 생기지 않는다");
    assert!(kept_pids.iter().all(|pid| common::is_running(*pid)), "남아 있는 work의 대화는 끄지 않는다");
    host.send("keep", &kept.id, "아직 여기 있다").expect("남은 대화는 말을 받는다");
    sandbox.wait_kind("keep", &kept.id, "turn-end", 1);

    host.shut_down();
}

#[test]
fn 턴_도중에_사라짐을_알아도_그_턴은_끊지_않고_턴이_끝나는_대로_끈다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("pauses-mid-turn", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let (session_id, pids) = sandbox.agent_tree("cart", &conversation.id);

    host.send("cart", &conversation.id, "이 work를 아카이브해 줘").expect("보내기");
    sandbox.wait_record("cart", &conversation.id, |record| record.iter().any(|line| says(line, "멈추기 전의 답")));
    let archived = archive_by_rename(&sandbox, "cart");
    // 앱의 감시가 MCP의 아카이브를 그 턴 도중에 알렸다.
    host.check_vanished_works();
    assert!(pids.iter().all(|pid| common::is_running(*pid)), "아카이브를 시킨 에이전트가 제 답을 끝맺게 둔다");
    sandbox.release_turn(&session_id);

    let moved = archived.join("agents").join(format!("{}.jsonl", conversation.id));
    let record = wait_record_at(&moved, closed);
    assert_all_gone(&pids);
    let tail: Vec<_> = record.iter().skip_while(|line| !says(line, "멈추기 전의 답")).skip(1).map(shape).collect();
    assert_eq!(
        tail,
        [
            ("update".to_owned(), json!("놓인 뒤의 답")),
            ("turn-end".to_owned(), json!("end_turn")),
            ("session".to_owned(), json!({"state": "closed", "cause": "work-vanished"})),
        ]
    );
    assert!(!work.exists(), "옛 자리에 유령 work 폴더가 생기지 않는다");

    host.shut_down();
}

#[test]
fn 다른_호스트가_같은_work에_대화를_더한_뒤_이쪽이_agents_json을_써도_두_대화의_줄이_모두_남는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    // 다른 인스턴스 흉내 — 같은 데이터 루트를 보는 호스트 둘(dev와 설치본). 둘은 서로의 잠금을 모른다.
    let shell = sandbox.codex_login_shell("normal", &[]);
    let (this, _this_events) = sandbox.host_with_events(shell.clone());
    let (other, _other_events) = sandbox.host_with_events(shell);

    let mine = this.new_conversation("cart", Agent::Codex).expect("이쪽 대화");
    let theirs = other.new_conversation("cart", Agent::Codex).expect("다른 인스턴스의 대화");
    let their_row = sandbox.agents_row("cart", &theirs.id);
    // 이쪽이 agents.json을 쓴다 — 제 대화를 닫고, 새 대화를 하나 더 연다.
    this.close_conversation("cart", &mine.id).expect("이쪽 대화 닫기");
    let more = this.new_conversation("cart", Agent::Codex).expect("이쪽의 새 대화");

    let rows = sandbox.agents_json("cart")["conversations"].as_array().expect("conversations 배열").clone();
    let ids: Vec<&str> = rows.iter().map(|row| row["id"].as_str().unwrap()).collect();
    assert_eq!(ids, [mine.id.as_str(), theirs.id.as_str(), more.id.as_str()], "남의 대화 줄을 지우지 않는다");
    assert!(sandbox.agents_row("cart", &mine.id)["closedAt"].is_string(), "이쪽 대화는 닫혔다");
    assert_eq!(sandbox.agents_row("cart", &theirs.id), their_row, "다른 인스턴스가 적은 줄이 칸까지 그대로다");
    assert!(their_row["closedAt"].is_null(), "다른 인스턴스의 대화는 열린 채다");
    let listed: Vec<String> = this.list_conversations("cart").expect("목록").into_iter().map(|c| c.id).collect();
    assert_eq!(listed, [theirs.id.clone(), more.id.clone()], "이쪽 목록에도 다른 인스턴스의 열린 대화가 선다");

    this.shut_down();
    other.shut_down();
}
