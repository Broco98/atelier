//! L1 — 대화 호스트가 앱 종료 확인 창에 셈을 주고, 대화 목록이 에이전트가 이 앱에 떠 있는지를 싣는다(three-axes 티켓 23 ·
//! 스토리 56 · 84 · S13).
//!
//! 종료 확인은 턴이 도는 대화 · 대기 중인 말 · 답하지 않은 승인을 센다. 대기 줄은 호스트 메모리에만 있고 지금 열지 않은 work의
//! 대화도 세야 하므로 셈의 원천이 호스트다. 시험은 호스트에 명령을 넣고 돌려받은 값과 `agents/` 기록만 본다.

mod common;

use atelier_acp::{Agent, QuitCounts};
use common::Sandbox;
use serde_json::{json, Value};

/// 가짜가 묻는 권한 요청이 기록에 섰다.
fn asked(record: &[Value]) -> bool {
    record.iter().any(|line| line["kind"] == "permission" && line["payload"]["state"] == "asked")
}

#[test]
fn 종료가_세는_것은_모든_work의_턴이_도는_대화와_대기_중인_말과_답하지_않은_승인이다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    sandbox.work("shop", &[]);
    let host = sandbox.host(sandbox.codex_login_shell("asks-permission", &[]));
    let cart = host.new_conversation("cart", Agent::Codex).expect("cart 대화");
    let idle = host.new_conversation("cart", Agent::Codex).expect("쉬는 대화");
    let shop = host.new_conversation("shop", Agent::Codex).expect("shop 대화");
    assert_eq!(host.quit_counts(), QuitCounts { running: 0, queued: 0, approvals: 0 }, "떠 있어도 쉬는 대화는 세지 않는다");

    host.send("cart", &cart.id, "워크트리 밖에 써 줘").expect("보내기");
    sandbox.wait_record("cart", &cart.id, asked);
    host.send("cart", &cart.id, "그다음 이것도").expect("턴 도중의 말은 대기 줄에 든다");
    host.send("cart", &cart.id, "마지막으로 이것").expect("둘째 대기 말");
    host.send("shop", &shop.id, "여기도 밖에 써 줘").expect("다른 work의 보내기");
    sandbox.wait_record("shop", &shop.id, asked);

    assert_eq!(
        host.quit_counts(),
        QuitCounts { running: 2, queued: 2, approvals: 2 },
        "지금 열지 않은 work(shop)의 대화도 든다 — 셈은 앱 전체다"
    );
    assert_eq!(
        serde_json::to_value(host.quit_counts()).unwrap(),
        json!({"running": 2, "queued": 2, "approvals": 2}),
        "화면이 읽는 꼴"
    );

    // 닫은 대화는 끄면서 대기 줄도 걸린 물음도 함께 사라진다 — 종료가 잃을 것이 없다.
    host.close_conversation("cart", &cart.id).expect("닫기");
    assert_eq!(host.quit_counts(), QuitCounts { running: 1, queued: 0, approvals: 1 });
    host.close_conversation("cart", &idle.id).expect("쉬는 대화 닫기");

    host.shut_down();
    assert_eq!(host.quit_counts(), QuitCounts { running: 0, queued: 0, approvals: 0 }, "끈 호스트에는 셀 것이 없다");
}

#[test]
fn 대화_목록은_에이전트가_이_앱에_떠_있는지를_싣는다_다시_켠_뒤에는_떠_있지_않다() {
    let sandbox = Sandbox::new();
    sandbox.work("cart", &[]);
    let shell = sandbox.codex_login_shell("normal", &[]);
    let host = sandbox.host(shell.clone());
    let conversation = host.new_conversation("cart", Agent::Codex).expect("새 대화");
    assert!(conversation.live, "새 대화는 곧바로 띄운다(S8)");
    assert!(host.list_conversations("cart").expect("목록")[0].live);
    host.shut_down();

    // 앱을 다시 켠 꼴 — 같은 데이터 루트에 새 호스트를 짓는다. 기록은 그대로지만 그 기록을 적던 프로세스는 없다: 화면은 이것으로
    // 기록 끝에 열린 채 남은 턴과 물음을 끝난 것으로 읽는다.
    let host = sandbox.host(shell);
    let listed = host.list_conversations("cart").expect("다시 켠 뒤의 목록");
    assert!(!listed[0].live, "다시 켠 뒤에는 말을 보내기 전까지 아무것도 떠 있지 않다");
    assert_eq!(
        serde_json::to_value(&listed[0]).unwrap()["live"],
        json!(false),
        "화면이 읽는 칸 이름"
    );

    host.send("cart", &conversation.id, "오늘의 말").expect("보내면 되살린다");
    sandbox.wait_kind("cart", &conversation.id, "turn-end", 1);
    assert!(host.list_conversations("cart").expect("되살린 뒤의 목록")[0].live);

    host.shut_down();
}
