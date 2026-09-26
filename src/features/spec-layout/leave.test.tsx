import { afterEach, describe, expect, it } from "vitest";
import { dialogStore } from "@/components/ui/confirm-store";
import { askLeave } from "./leave";

// 떠날 때 확인(spec 레이아웃 티켓 15 · 결정 27). 저장하지 않은 초안을 두고 편집기를 떠나면 묻는다 — 이 저장소의
// 첫 「떠날 때 확인」이다. 버튼은 [계속 편집], [버리고 나가기], 그리고 저장할 수 있을 때만 서는 [저장하고 나가기]다.
//
// 창은 앱의 창 하나(`AppDialog`)가 그리는데, 그 창은 Base UI AlertDialog라 포털로 서고 포털은 정적 렌더에서
// 아무것도 그리지 않는다. 그래서 여기서는 **스토어에 올라간 물음**을 읽는다 — 무슨 글자로, 무슨 버튼을, 어디에
// 포커스를 두고 묻는가(되돌리기 확인 창 `revert.test.tsx`, develop의 `confirm-store.test.ts`와 같은 방식). 버튼이
// 그 순서로 서고 경고색·주 버튼으로 보이는 것은 창의 일이라 떠날 때 L3(`e2e/spec-layout-leave.spec.ts`)가 든다.

afterEach(() => {
  dialogStore.state?.answer(false);
});

/** 물음을 올리고, 스토어에 선 물음의 글과 모양을 읽는다(답하는 함수는 뺀다). */
function askedFor(savable: boolean) {
  void askLeave(savable);
  const ask = dialogStore.state;
  if (!ask) throw new Error("물음이 스토어에 서지 않았다");
  return {
    title: ask.title,
    body: ask.body,
    cancel: ask.cancel,
    confirm: ask.confirm,
    danger: ask.danger,
    extra: ask.extra,
    focus: ask.focus,
  };
}

describe("떠날 때 확인 창", () => {
  it("저장할 수 있으면 [계속 편집], 붉은 [버리고 나가기], [저장하고 나가기] 셋을 묻고, 포커스는 [계속 편집]이다", () => {
    // 버리는 것은 되돌릴 수 없다 — 경고색이다. 반사적으로 친 Enter가 초안을 버리지 않게 포커스는 취소 자리다.
    expect(askedFor(true)).toEqual({
      title: "저장하지 않은 변경이 있어요",
      body: undefined,
      cancel: "계속 편집",
      confirm: "버리고 나가기",
      danger: true,
      extra: "저장하고 나가기",
      focus: "cancel",
    });
  });

  // 저장이 잠겨 있으면(검증 오류, 답이 아직 안 옴, 저장 중) [저장하고 나가기]가 없다 — 눌러도 저장이 안 된다.
  it("저장할 수 없으면 [저장하고 나가기]가 없다", () => {
    expect(askedFor(false)).toEqual({
      title: "저장하지 않은 변경이 있어요",
      body: undefined,
      cancel: "계속 편집",
      confirm: "버리고 나가기",
      danger: true,
      extra: undefined,
      focus: "cancel",
    });
  });

  it("[계속 편집]은 머물고, [버리고 나가기]는 버리고, [저장하고 나가기]는 저장한다고 답한다", async () => {
    const stay = askLeave(true);
    dialogStore.state!.answer(false);
    expect(await stay).toBe("stay");
    const discard = askLeave(true);
    dialogStore.state!.answer(true);
    expect(await discard).toBe("discard");
    const save = askLeave(true);
    dialogStore.state!.answer("extra");
    expect(await save).toBe("save");
  });
});
