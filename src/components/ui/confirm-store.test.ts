import { afterEach, describe, expect, it } from "vitest";
import { askChoice, askDialog, dialogStore } from "./confirm-store";

// 앱이 묻고 알리는 창의 **스토어**. 답이 어떻게 오가는가를 본다 — 약속이 풀리고, 창이 비고, 앞의
// 물음이 접힌다.
//
// 창이 **무엇을 그리는가**는 여기서 안 본다. 창은 Base UI AlertDialog라 포털로 서고, 포털은 정적
// 렌더에서 아무것도 그리지 않는다. 제목·본문·버튼·설명은 종료 확인 L3(`e2e/quit-confirm.spec.ts`)와
// 셸 닫기 L3(`e2e/works-sidebar.spec.ts`)가 든다. 답하는 쪽은 스토어를 직접 눌러서 본다.

afterEach(() => {
  dialogStore.state?.answer(false);
});

describe("답이 오가는 길", () => {
  it("답하면 창이 닫히고 그 값이 온다", async () => {
    const asked = askDialog({ title: "가", body: "나", confirm: "닫기" });
    dialogStore.state!.answer(true);
    expect(await asked).toBe(true);
    expect(dialogStore.state).toBeNull();
  });

  // **겹쳐 띄우지 않는다.** 두 창이 함께 뜨면 어느 것에 답했는지가 화면에서 사라지고,
  // 답을 기다리던 앞의 약속이 영영 안 풀린다 — 셸 하나가 못 닫히는 채로 남는다.
  it("앞의 물음은 취소로 접힌다 — 약속이 남지 않는다", async () => {
    const first = askDialog({ title: "먼저", body: "나", confirm: "닫기" });
    const second = askDialog({ title: "나중", body: "나", confirm: "닫기" });
    expect(await first).toBe(false);
    expect(dialogStore.state?.title).toBe("나중");
    dialogStore.state!.answer(true);
    expect(await second).toBe(true);
  });
});

// **셋째 갈래**(spec 레이아웃 결정 27) — 떠날 때 확인은 [계속 편집] · [버리고 나가기] · [저장하고 나가기] 셋이다.
// 기존 물음들은 그대로 둘이고 답도 참·거짓이다. 셋째 버튼과 취소 버튼의 글자와 순서는 창이 그리는 것이라 여기서
// 안 본다 — 떠날 때 L3(`e2e/spec-layout-leave.spec.ts`)가 든다. 여기는 답이 셋으로 갈려 오는가만 본다.
describe("셋째 버튼을 받는 물음", () => {
  it("셋째 버튼을 누르면 그 답이 오고, 진행과 취소는 참·거짓 그대로다", async () => {
    const ask = { title: "가", cancel: "머물기", confirm: "버리기", extra: "저장하기" };
    const extra = askChoice(ask);
    dialogStore.state!.answer("extra");
    expect(await extra).toBe("extra");
    expect(dialogStore.state).toBeNull();
    const yes = askChoice(ask);
    dialogStore.state!.answer(true);
    expect(await yes).toBe(true);
    const no = askChoice(ask);
    dialogStore.state!.answer(false);
    expect(await no).toBe(false);
  });
});
