import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import AppDialog from "./AppDialog";
import { askDialog, dialogStore, showProblem } from "./confirm-store";

// 앱이 묻고 알리는 창. **OS 시트를 대신하는 자리**라 여기서 보는 것은 두 가지다 —
// 무엇이 그려지는가(마크업)와, 답이 어떻게 오가는가(스토어).
//
// 이 seam은 정적 마크업이라 클릭이 없다. 답하는 쪽은 스토어를 직접 눌러서 본다.

afterEach(() => {
  dialogStore.state?.answer(false);
});

const render = () => renderToStaticMarkup(<AppDialog />);

describe("앱 창이 그려지는 자리", () => {
  it("물은 것이 없으면 아무것도 안 그린다", () => {
    expect(render()).toBe("");
  });

  it("제목과 본문과 진행 버튼의 글자가 선다", () => {
    void askDialog({ title: "셸 닫기", body: "실행 중인 명령이 있어요", confirm: "닫기" });
    const markup = render();
    expect(markup).toContain("셸 닫기");
    expect(markup).toContain("실행 중인 명령이 있어요");
    expect(markup).toContain(">닫기<");
  });

  // 「예/아니오」가 아니라 **할 일을 적는다** — 빠르게 넘기는 사람에게 「예」는 무엇에
  // 예인지를 말하지 않는다.
  it("물음에는 취소가 서고, 알림에는 서지 않는다", () => {
    void askDialog({ title: "가", body: "나", confirm: "닫기" });
    expect(render()).toContain(">취소<");
    void showProblem("못 했어요");
    const notice = render();
    expect(notice).not.toContain(">취소<");
    expect(notice).toContain("못 했어요");
    expect(notice).toContain(">확인<");
  });
});

// 셸이 0개인 종료 확인은 본문 줄이 **아예 없다**(결정 15). 빈 줄을 그리면 제목 아래 여백만 남는다.
// 재는 것은 창의 **설명**이다 — 본문이 있으면 창이 그 줄을 가리키고(읽기 도구가 제목 다음에 읽는다),
// 없으면 가리킬 줄이 없다. 빈 줄을 그리는 변형은 가리키는 곳을 비워 둔 채 남긴다.
describe("본문이 없는 물음", () => {
  const description = (markup: string) => {
    const id = /aria-describedby="([^"]+)"/.exec(markup)?.[1];
    if (!id) return null;
    const line = new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(markup);
    if (!line) throw new Error("창이 가리키는 설명 줄이 없다");
    return line[1];
  };

  it("본문이 있으면 창의 설명이 그 줄이다", () => {
    void askDialog({ title: "Atelier 종료", body: "셸 1 · 명령이 도는 셸 0", confirm: "종료" });
    expect(description(render())).toBe("셸 1 · 명령이 도는 셸 0");
  });

  it("본문이 없으면 설명도 본문 줄도 없다 — 제목만 선다", () => {
    void askDialog({ title: "Atelier 종료", confirm: "종료", danger: true });
    const markup = render();
    expect(description(markup)).toBeNull();
    expect(markup).toContain("Atelier 종료");
    expect(markup).not.toMatch(/ id="/);
  });
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
    expect(render()).toContain("나중");
    dialogStore.state!.answer(true);
    expect(await second).toBe(true);
  });
});
