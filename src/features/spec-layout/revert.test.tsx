import { afterEach, describe, expect, it } from "vitest";
import { dialogStore } from "@/components/ui/confirm-store";
import { askRevert } from "./revert";
import type { SpecLayoutState } from "./types";

// 「기본값으로 되돌리기」의 확인 창(spec 레이아웃 티켓 10). 되돌리기는 모드의 레이아웃 폴더를 **폴더째**
// 지운다 — 템플릿도, 레이아웃이 모르는 파일도 함께 사라진다. 그래서 창은 지울 폴더와 사라지는 것의 수를
// 적는다. 수는 엔진의 상태가 준 그대로다(`spec_layout_states`) — 여기서 폴더를 세지 않는다.
//
// 창은 앱의 창 하나(`AppDialog`)가 그리는데, 그 창은 Base UI AlertDialog라 포털로 서고 포털은 정적 렌더에서
// 아무것도 그리지 않는다. 그래서 물음을 올린 뒤 **스토어에 선 물음**을 읽는다 — 창의 글이 프로미스 뒤에 있어
// 페이지 마크업에는 안 걸린다. 창이 그 글을 제목·설명으로 걸고 버튼을 경고색으로 그리는 것은 창의 일이라
// 설정 L3(`e2e/spec-layout-page.spec.ts` — 이름이 붙은 alertdialog, 본문, [되돌리기])가 든다.

afterEach(() => {
  dialogStore.state?.answer(false);
});

const state = (overrides: Partial<SpecLayoutState>): SpecLayoutState => ({
  id: "atelier",
  folder: "~/.atelier/layouts/atelier",
  edited: true,
  errors: [],
  fallback: null,
  templateCount: 2,
  otherFileCount: 1,
  ...overrides,
});

/** 물음을 올리고 스토어에 선 물음을 읽는다. */
function askedFor(one: SpecLayoutState) {
  void askRevert(one);
  const ask = dialogStore.state;
  if (!ask) throw new Error("물음이 스토어에 서지 않았다");
  return ask;
}

/** 창의 본문 — 창이 설명으로 거는 글이다. */
function bodyOf(one: SpecLayoutState): string {
  const body = askedFor(one).body;
  if (body === undefined) throw new Error("본문이 없다");
  return body;
}

describe("되돌리기 확인 창", () => {
  it("지울 폴더와, 함께 사라지는 템플릿과 그 밖의 파일의 수와, 다음 호출부터의 뜻을 적는다", () => {
    expect(askedFor(state({})).title).toBe("Atelier 레이아웃을 기본값으로 되돌릴까요?");
    expect(bodyOf(state({}))).toBe(
      "~/.atelier/layouts/atelier/ 폴더를 지워요. 템플릿 2개와 그 밖의 파일 1개가 함께 사라져요. " +
        "다음 호출부터 에이전트는 내장 안내문을 받아요.",
    );
  });

  // 레이아웃이 모르는 파일이 없으면 그 말이 없다 — 「그 밖의 파일 0개」는 없는 것을 센다.
  it("그 밖의 파일이 없으면 템플릿의 수만 적는다", () => {
    const body = bodyOf(state({ templateCount: 1, otherFileCount: 0 }));
    expect(body).toContain("~/.atelier/layouts/atelier/");
    expect(body).toContain("템플릿 1개가 함께 사라져요.");
    expect(body).not.toContain("그 밖의");
  });

  // 읽지 못한 폴더에서는 무엇이 템플릿인지 모른다(`templateCount`가 없다) — 폴더 안의 파일을 센 것만 적는다.
  it("읽지 못한 행의 창은 템플릿의 수 없이 파일의 수만 적는다", () => {
    const broken = state({
      id: "maison",
      folder: "~/.atelier/layouts/maison",
      errors: [{ path: null, message: "layout.json is missing" }],
      fallback: "layout.json is missing",
      templateCount: null,
      otherFileCount: 3,
    });
    expect(askedFor(broken).title).toBe("Maison 레이아웃을 기본값으로 되돌릴까요?");
    const body = bodyOf(broken);
    expect(body).toContain("~/.atelier/layouts/maison/ 폴더를 지워요.");
    expect(body).toContain("파일 3개가 함께 사라져요.");
    expect(body).not.toContain("템플릿");
    expect(body).not.toContain("그 밖의");
    expect(body).toContain("다음 호출부터 에이전트는 내장 안내문을 받아요.");
  });

  // 붉은 확인 창의 선례(`askDanger`) 그대로다 — [취소]와, 경고색의 [되돌리기]. 취소의 글자를 따로 주지 않아
  // 창의 기본(「취소」)이 서고, 셋째 버튼도 없다.
  it("버튼은 [취소]와 붉은 [되돌리기]다", () => {
    const ask = askedFor(state({}));
    expect(ask.confirm).toBe("되돌리기");
    expect(ask.danger).toBe(true);
    expect(ask.cancel).toBeUndefined();
    expect(ask.extra).toBeUndefined();
  });

  it("[되돌리기]를 누르면 되돌린다고 답하고, [취소]면 아니라고 답한다", async () => {
    const yes = askRevert(state({}));
    dialogStore.state!.answer(true);
    expect(await yes).toBe(true);
    const no = askRevert(state({}));
    dialogStore.state!.answer(false);
    expect(await no).toBe(false);
  });
});
