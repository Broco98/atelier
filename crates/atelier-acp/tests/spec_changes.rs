//! L1 — 턴이 끝나면 호스트가 spec 폴더를 견주어 고친 곳을 `changes` 줄로 적는다
//! (three-axes 티켓 06 · three-axes 결정 22 · 스토리 68 · 73 · 74 · 75 · 76).
//!
//! 시험은 호스트에 명령을 넣고, 기록 파일 · 이벤트만 본다. 고치는 쪽은 가짜 ACP 에이전트 `writes-spec`이다 —
//! 사람의 글에 단계(JSON 줄)가 없으면 「고친 곳」 단계를, 있으면 그 단계를 밟는다.

mod common;

use std::fs;
use std::path::Path;

use atelier_acp::{Agent, HostEvent, RecordKind};
use common::{of_kind, payloads_of, Sandbox};
use serde_json::{json, Value};

/// `writes-spec`의 「고친 곳」 단계가 고칠 처음 spec. `keep.md`는 손대지 않는다.
fn lay_spec(work: &Path) {
    let spec = work.join("spec");
    fs::write(spec.join("plan.md"), "# 계획\n\n첫 문단이다.\n\n## 할 일\n\n- 하나\n- 둘\n").unwrap();
    fs::write(spec.join("old.md"), "# 지울 문서\n").unwrap();
    fs::write(spec.join("notes.txt"), "초안\n").unwrap();
    fs::write(spec.join("keep.md"), "# 그대로 둘 문서\n").unwrap();
}

#[test]
fn writes_spec의_턴_끝에_새_문서_고침_지움이_서고_고친_md의_줄_범위는_새_글_기준이다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    lay_spec(&work);
    let (host, events) = sandbox.host_with_events(sandbox.codex_login_shell("writes-spec", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    host.send("cart", &conversation.id, "spec을 고쳐 줘").expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);

    assert_eq!(
        fs::read_to_string(work.join("spec/plan.md")).unwrap(),
        "# 계획\n\n요약 한 줄.\n첫 문단을 고쳤다.\n\n## 할 일\n\n- 하나\n- 둘을 고쳤다.\n",
        "가짜가 고친 새 글 — 옛 글의 3줄이 새 글의 3 · 4줄이 되고, 옛 8줄이 새 9줄이 된다"
    );
    assert_eq!(
        payloads_of(&record, "changes"),
        [json!({"files": [
            {"path": "drafts/idea.md", "change": "created", "lines": [{"start": 1, "end": 3}]},
            {"path": "notes.txt", "change": "modified"},
            {"path": "old.md", "change": "deleted"},
            {"path": "plan.md", "change": "modified", "lines": [{"start": 3, "end": 4}, {"start": 9, "end": 9}]},
        ]})],
        "손대지 않은 keep.md는 없고, md가 아닌 파일과 지운 파일에는 줄 범위가 없다"
    );
    let kinds: Vec<&str> = record.iter().rev().take(2).map(|line| line["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["turn-end", "changes"], "고친 곳은 턴 끝 줄 바로 앞에 선다 — 화면이 턴 끝을 받을 때 이미 와 있다");
    let emitted: Vec<Value> = events
        .all()
        .into_iter()
        .filter_map(|event| match event {
            HostEvent::Record { line, .. } if line.kind == RecordKind::Changes => Some(serde_json::to_value(line).unwrap()),
            _ => None,
        })
        .collect();
    assert_eq!(emitted, of_kind(&record, "changes").into_iter().cloned().collect::<Vec<_>>(), "같은 seq의 기록 줄 이벤트로 나간다");

    host.shut_down();
}

/// 사람의 글 — `writes-spec`이 밟을 단계들을 JSON 줄로.
fn steps(steps: &[Value]) -> String {
    steps.iter().map(|step| format!("{step}\n")).collect()
}

#[test]
fn 도구_update_없이_셸로_고친_것처럼_쓴_파일도_적힌다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    lay_spec(&work);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("writes-spec", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    let text = steps(&[
        json!({"op": "write", "path": "shell.md", "text": "첫 줄\n둘째 줄\n", "silent": true}),
        json!({"op": "replace", "path": "plan.md", "from": "## 할 일\n", "to": "## 할 일 (고침)\n", "silent": true}),
        json!({"op": "delete", "path": "old.md", "silent": true}),
    ]);
    host.send("cart", &conversation.id, &text).expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);

    let tool_updates: Vec<_> = of_kind(&record, "update")
        .into_iter()
        .filter(|line| line["payload"]["update"]["sessionUpdate"].as_str().is_some_and(|kind| kind.starts_with("tool_call")))
        .collect();
    assert_eq!(tool_updates, Vec::<&Value>::new(), "에이전트는 도구 줄을 하나도 보내지 않았다");
    assert_eq!(
        payloads_of(&record, "changes"),
        [json!({"files": [
            {"path": "old.md", "change": "deleted"},
            {"path": "plan.md", "change": "modified", "lines": [{"start": 5, "end": 5}]},
            {"path": "shell.md", "change": "created", "lines": [{"start": 1, "end": 2}]},
        ]})]
    );

    host.shut_down();
}

#[test]
fn 두_대화가_겹쳐_돌며_한쪽만_고치면_두_대화의_턴_끝에_모두_적힌다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    lay_spec(&work);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("writes-spec", &[]));
    let holding = host.new_conversation("cart", Agent::Codex).expect("고치지 않는 대화");
    let writing = host.new_conversation("cart", Agent::Codex).expect("고치는 대화");

    // 고치지 않는 대화의 턴이 먼저 열려 문이 열릴 때까지 돈다.
    host.send("cart", &holding.id, &steps(&[json!({"op": "hold", "gate": "holding-may-end"})])).expect("붙잡는 턴");
    sandbox.wait_kind("cart", &holding.id, "sent", 1);
    // 그동안 다른 대화가 고치고 끝난다.
    let text = steps(&[
        json!({"op": "write", "path": "together.md", "text": "함께 돈 대화가 쓴 문서\n"}),
        json!({"op": "replace", "path": "plan.md", "from": "- 하나\n", "to": "- 하나를 고쳤다.\n"}),
    ]);
    host.send("cart", &writing.id, &text).expect("고치는 턴");
    let written = sandbox.wait_kind("cart", &writing.id, "turn-end", 1);
    let expected = json!({"files": [
        {"path": "plan.md", "change": "modified", "lines": [{"start": 7, "end": 7}]},
        {"path": "together.md", "change": "created", "lines": [{"start": 1, "end": 1}]},
    ]});
    assert_eq!(payloads_of(&written, "changes"), std::slice::from_ref(&expected), "고친 대화의 턴 끝");
    assert_eq!(of_kind(&sandbox.record("cart", &holding.id), "turn-end").len(), 0, "붙잡힌 턴은 아직 돈다");

    sandbox.open_gate("holding-may-end");
    let held = sandbox.wait_kind("cart", &holding.id, "turn-end", 1);

    assert_eq!(payloads_of(&held, "changes"), [expected], "고치지 않은 대화의 턴에도 같은 고친 곳이 적힌다 — 누가 고쳤는지 모를 때도 놓치지 않는다");

    host.shut_down();
}

/// 1MB(1024 × 1024바이트)를 넘는 md — 줄마다 `line NNNNNN`.
fn big_markdown() -> String {
    let text: String = (0..100_000).map(|n| format!("line {n:06}\n")).collect();
    assert!(text.len() > 1024 * 1024, "{}바이트", text.len());
    text
}

#[test]
fn mb_하나를_넘는_파일은_해시로만_바뀜을_알고_md_텍스트가_아닌_파일은_크기_해시로_안다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let spec = work.join("spec");
    fs::write(spec.join("big.md"), big_markdown()).unwrap();
    fs::write(spec.join("big-same.md"), big_markdown()).unwrap();
    let image: Vec<u8> = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a].into_iter().chain((0..56).map(|n| 0x80 | n)).collect();
    assert!(String::from_utf8(image.clone()).is_err(), "UTF-8로 읽히지 않는 파일이다");
    fs::write(spec.join("image.png"), &image).unwrap();
    fs::write(spec.join("same.png"), &image).unwrap();
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("writes-spec", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    let text = steps(&[
        // 크기는 그대로, 가운데 한 줄만 바뀐다.
        json!({"op": "replace", "path": "big.md", "from": "line 040000\n", "to": "line 04000X\n", "silent": true}),
        json!({"op": "flip", "path": "image.png", "at": 20}),
        // 같은 바이트를 다시 쓴다 — 고친 때는 바뀌어도 내용은 같다.
        json!({"op": "rewrite", "path": "big-same.md"}),
        json!({"op": "rewrite", "path": "same.png"}),
    ]);
    host.send("cart", &conversation.id, &text).expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);

    assert_eq!(fs::metadata(spec.join("image.png")).unwrap().len(), image.len() as u64, "크기는 그대로다");
    assert_eq!(
        payloads_of(&record, "changes"),
        [json!({"files": [
            {"path": "big.md", "change": "modified"},
            {"path": "image.png", "change": "modified"},
        ]})],
        "1MB를 넘는 md는 줄 범위 없이 바뀜만 서고, 내용이 같게 다시 쓴 파일은 없다"
    );

    host.shut_down();
}

#[test]
fn 바뀐_것이_없는_턴에는_changes_줄이_없다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    lay_spec(&work);
    let (host, events) = sandbox.host_with_events(sandbox.codex_login_shell("writes-spec", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    let text = steps(&[
        // 썼다가 같은 턴에 지운 문서, 같은 글로 다시 쓴 문서 — 턴 앞뒤가 같다.
        json!({"op": "write", "path": "scratch.md", "text": "잠깐 쓴 글\n"}),
        json!({"op": "delete", "path": "scratch.md"}),
        json!({"op": "write", "path": "plan.md", "text": "# 계획\n\n첫 문단이다.\n\n## 할 일\n\n- 하나\n- 둘\n"}),
        // 스펙 트리에 뜨지 않는 점 파일은 고친 곳이 아니다.
        json!({"op": "write", "path": ".draft.md", "text": "숨은 초안\n"}),
    ]);
    host.send("cart", &conversation.id, &text).expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);

    assert!(work.join("spec/.draft.md").is_file(), "가짜는 점 파일을 썼다");
    assert_eq!(of_kind(&record, "changes").len(), 0, "{}", common::lines_text(&record));
    assert!(
        !events.all().iter().any(|event| matches!(event, HostEvent::Record { line, .. } if line.kind == RecordKind::Changes)),
        "이벤트로도 나가지 않는다"
    );

    host.shut_down();
}

#[test]
fn 턴_도중에_work_폴더가_옮겨지면_턴_끝에_모든_파일을_지움으로_적지_않는다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    lay_spec(&work);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("writes-spec", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    host.send("cart", &conversation.id, &steps(&[json!({"op": "hold", "gate": "may-end"})])).expect("붙잡는 턴");
    sandbox.wait_kind("cart", &conversation.id, "sent", 1);

    // 아카이브 흉내 — work 폴더째 옮긴다. 열어 둔 기록 파일은 옮겨진 자리를 따라간다.
    let archived = sandbox.data_root().join("archive/cart");
    fs::create_dir_all(archived.parent().unwrap()).unwrap();
    fs::rename(&work, &archived).unwrap();
    sandbox.open_gate("may-end");

    let path = archived.join("agents").join(format!("{}.jsonl", conversation.id));
    let record = common::wait_record_at(&path, |record| !of_kind(record, "turn-end").is_empty());
    assert_eq!(of_kind(&record, "changes").len(), 0, "옛 자리에는 아무것도 없지만 지운 것이 아니다");
    assert!(!work.exists(), "옛 자리에 폴더를 다시 만들지 않았다");

    host.shut_down();
}

#[test]
fn md의_줄_범위는_새_글_기준이고_지우기만_한_자리는_범위가_없다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    lay_spec(&work);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("writes-spec", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    // 옛 글: `# 계획` · `` · `첫 문단이다.` · `` · `## 할 일` · `` · `- 하나` · `- 둘`
    // 새 글: 맨 앞에 한 줄을 더하고, `## 할 일` 뒤의 빈 줄을 지우고, 맨 끝에 한 줄을 더한다.
    let new = "머리 줄.\n# 계획\n\n첫 문단이다.\n\n## 할 일\n- 하나\n- 둘\n- 셋\n";
    host.send("cart", &conversation.id, &steps(&[json!({"op": "write", "path": "plan.md", "text": new})])).expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);

    assert_eq!(
        payloads_of(&record, "changes"),
        [json!({"files": [{"path": "plan.md", "change": "modified", "lines": [{"start": 1, "end": 1}, {"start": 9, "end": 9}]}]})],
        "더한 줄은 새 글의 1줄과 9줄이고, 빈 줄을 지운 자리는 새 글에 줄이 없다"
    );

    host.shut_down();
}

/// S26 — 「고친 곳」(새 문서 · 고침 · 지움 · 도구 update 없이 고친 파일)의 결과 기록과 그 뒤의 spec 폴더가 검사
/// 자료로 서고, 매번 다시 지은 것이 그것과 같다. 대화창의 L3 목업 백엔드(티켓 26)가 기록을 쏘고 spec 사본을 문서
/// 본문으로 그린다.
#[test]
fn 고친_곳의_기록과_spec_사본이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    lay_spec(&work);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("writes-spec", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    host.send("cart", &conversation.id, "spec을 고쳐 줘").expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    host.shut_down();

    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    common::assert_record("changes", &common::fix_record(&record, &sandbox.data_root(), &session_id));
    common::assert_record_spec("changes", &work.join("spec"));
}
