import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import AppDialog from "@/components/ui/AppDialog";
import { dialogStore } from "@/components/ui/confirm-store";
import { askLeave } from "./leave";

// 떠날 때 확인(spec 레이아웃 티켓 15 · 결정 27). 저장하지 않은 초안을 두고 편집기를 떠나면 묻는다 — 이 저장소의
// 첫 「떠날 때 확인」이다. 버튼은 [계속 편집], [버리고 나가기], 그리고 저장할 수 있을 때만 서는 [저장하고 나가기]다.
//
// 창은 앱의 창 하나(`AppDialog`)가 그린다. 묻는 쪽이 스토어에 물음을 올리면 그 창이 그리므로, 물음을 올린 뒤 그
// 창을 그려서 잰다(되돌리기 확인 창 `revert.test.tsx`와 같은 방식).

afterEach(() => {
  dialogStore.state?.answer(false);
});

/** 물음을 올리고 앱의 창을 그린다. */
function dialogFor(savable: boolean): string {
  void askLeave(savable);
  return renderToStaticMarkup(<AppDialog />);
}

const buttonsOf = (markup: string) =>
  [...markup.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((m) => ({ text: m[2], attrs: m[1] }));

describe("떠날 때 확인 창", () => {
  it("저장할 수 있으면 [계속 편집], [버리고 나가기], [저장하고 나가기] 셋이 선다", () => {
    const markup = dialogFor(true);
    expect(markup).toContain("저장하지 않은 변경이 있어요");
    const buttons = buttonsOf(markup);
    expect(buttons.map(({ text }) => text)).toEqual(["계속 편집", "버리고 나가기", "저장하고 나가기"]);
    // 버리는 것은 되돌릴 수 없다 — 경고색이다. 저장하고 나가기가 주 버튼이다.
    expect(buttons[1].attrs).toContain("text-destructive");
    expect(buttons[2].attrs).toContain("bg-primary");
  });

  // 저장이 잠겨 있으면(검증 오류, 답이 아직 안 옴, 저장 중) [저장하고 나가기]가 없다 — 눌러도 저장이 안 된다.
  it("저장할 수 없으면 [저장하고 나가기]가 없다", () => {
    expect(buttonsOf(dialogFor(false)).map(({ text }) => text)).toEqual(["계속 편집", "버리고 나가기"]);
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
