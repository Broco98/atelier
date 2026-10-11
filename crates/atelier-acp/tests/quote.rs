//! L1 — 문서에서 고른 자리를 인용으로 붙여 보내면, 에이전트는 사람의 글 앞에서 그 자리의 실제 경로 · 줄 범위와 인용
//! 글을 받는다(three-axes 티켓 27 · 구현 스펙 S12 · 스토리 81 · 82).
//!
//! 시험은 호스트에 명령을 넣고, 가짜가 받은 `session/prompt` 영수증과 기록 파일만 본다.

mod common;

use atelier_acp::{Agent, HostError, Quote};
use common::{of_kind, Sandbox};
use serde_json::json;

/// 렌더 보기에서 고른 자리 — `plan.md`의 문단 한 블록(3–4줄)이다. 글은 화면이 고른 그대로(두 줄)다.
fn paragraph() -> Quote {
    Quote { file: "plan.md".into(), start: 3, end: 4, text: "요약 한 줄.\n첫 문단을 고쳤다.".into() }
}

#[test]
fn 인용이_든_첫_말은_머리말_인용_블록_사람의_글_순서로_가고_sent에_인용과_보낸_블록이_남는다() {
    let sandbox = Sandbox::new();
    let work = sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    host.send_message("cart", &conversation.id, "이 문단을 한 줄로 줄여 줘", Some(&paragraph())).expect("첫 말");
    sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    // 둘째 말 — 한 줄짜리 인용(원문 보기에서 고른 줄 하나)이고 머리말은 붙지 않는다.
    let one_line = Quote { file: "drafts/idea.md".into(), start: 2, end: 2, text: "  들여 쓴 줄".into() };
    host.send_message("cart", &conversation.id, "여기도", Some(&one_line)).expect("둘째 말");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 2);

    let spec = work.join("spec");
    let preamble = json!({
        "type": "text",
        "text": format!(
            "Atelier work 안에서 열린 대화다.\n\n- work slug: `cart`\n- 제목: cart 제목\n- spec 폴더(specDir): `{}`\n",
            spec.display()
        )
    });
    // atelier 참조 꼴(실제 경로 + `:L<시작>-<끝>`, 한 줄이면 `:L<n>`)과 마크다운 인용 글 — atelier MCP 안내문이 가르치는 꼴이다.
    let first_quote = json!({
        "type": "text",
        "text": format!("{}:L3-4\n\n> 요약 한 줄.\n> 첫 문단을 고쳤다.\n", spec.join("plan.md").display())
    });
    let second_quote = json!({
        "type": "text",
        "text": format!("{}:L2\n\n>   들여 쓴 줄\n", spec.join("drafts/idea.md").display())
    });
    let first = json!({"type": "text", "text": "이 문단을 한 줄로 줄여 줘"});
    let second = json!({"type": "text", "text": "여기도"});

    let prompts = sandbox.acp_prompts(&sandbox.agent_session_id("cart", &conversation.id));
    let blocks: Vec<_> = prompts.iter().map(|prompt| prompt["prompt"].clone()).collect();
    assert_eq!(
        blocks,
        [json!([preamble, first_quote, first]), json!([second_quote, second])],
        "인용 블록은 사람의 글 바로 앞에 선다(S12) — 머리말은 에이전트 쪽 세션의 첫 말에만 붙는다(S11)"
    );

    let sent: Vec<_> = of_kind(&record, "sent").into_iter().map(|line| line["payload"].clone()).collect();
    assert_eq!(
        sent,
        [
            json!({
                "text": "이 문단을 한 줄로 줄여 줘",
                "quote": {"file": "plan.md", "start": 3, "end": 4, "text": "요약 한 줄.\n첫 문단을 고쳤다."},
                "prompt": [preamble, first_quote, first],
                "sendNow": false
            }),
            json!({
                "text": "여기도",
                "quote": {"file": "drafts/idea.md", "start": 2, "end": 2, "text": "  들여 쓴 줄"},
                "prompt": [second_quote, second],
                "sendNow": false
            }),
        ],
        "화면이 보낸 말 위에 세울 인용(파일 · 줄 범위 · 글)과 실제로 보낸 블록이 함께 남는다"
    );

    host.shut_down();
}

#[test]
fn 인용_없는_말의_sent에는_인용_칸이_없다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    host.send_message("cart", &conversation.id, "그냥 말", None).expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);

    let sent = of_kind(&record, "sent");
    assert_eq!(sent.len(), 1);
    assert!(sent[0]["payload"].get("quote").is_none(), "인용 없는 말은 앞 장의 `sent` 꼴 그대로다: {}", sent[0]);
    host.shut_down();
}

#[test]
fn spec_폴더_밖을_가리키거나_줄_범위가_뒤집힌_인용은_읽히는_오류이고_아무것도_보내거나_적지_않는다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    let before = sandbox.record("cart", &conversation.id);

    let bad = [
        Quote { file: "../work.json".into(), ..paragraph() },
        Quote { file: "/etc/hosts".into(), ..paragraph() },
        Quote { file: String::new(), ..paragraph() },
        Quote { start: 0, end: 0, ..paragraph() },
        Quote { start: 5, end: 4, ..paragraph() },
        Quote { text: " \n ".into(), ..paragraph() },
    ];
    for quote in &bad {
        let error = host.send_message("cart", &conversation.id, "고쳐 줘", Some(quote)).expect_err("거절");
        assert!(matches!(error, HostError::BadQuote(_)), "{quote:?} → {error:?}");
        assert!(error.to_string().starts_with("인용"), "화면에 보일 글이다: {error}");
    }

    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    assert!(sandbox.acp_prompts(&session_id).is_empty(), "에이전트는 아무 말도 받지 않았다");
    assert_eq!(sandbox.record("cart", &conversation.id), before, "기록에 아무것도 적히지 않았다");

    // 거절 뒤에도 대화는 그대로다 — 첫 말에 머리말이 붙는다.
    host.send_message("cart", &conversation.id, "고쳐 줘", Some(&paragraph())).expect("올바른 인용");
    sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    let prompts = sandbox.acp_prompts(&session_id);
    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts[0]["prompt"].as_array().unwrap().len(), 3, "머리말 · 인용 블록 · 사람의 글");
    host.shut_down();
}

/// S26 — 「인용이 든 Codex 한 턴」의 결과 기록이 검사 자료로 서고, 매번 다시 지은 기록이 그것과 같다. 대화창의 L3
/// 목업 백엔드(티켓 27)가 이 파일을 쏘아 보낸 말 위에 인용이 서는지 잰다. 인용한 자리는 「고친 곳」 자료(`changes.spec/`)의
/// `plan.md` 문단이다 — L3가 같은 본문을 스펙 창에 띄운다.
#[test]
fn 인용이_든_codex_한_턴의_기록이_검사_자료와_같다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let (host, _events) = sandbox.host_with_events(sandbox.codex_login_shell("normal", &[]));
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");

    host.send_message("cart", &conversation.id, "이 문단을 한 줄로 줄여 줘", Some(&paragraph())).expect("보내기");
    let record = sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    host.shut_down();

    let session_id = sandbox.agent_session_id("cart", &conversation.id);
    common::assert_record("codex-quote", &common::fix_record(&record, &sandbox.data_root(), &session_id));
}
