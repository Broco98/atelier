import { afterEach, describe, expect, it } from "vitest";
import type { BundleTab } from "@/features/terminal/shell-registry";
import type { Opened } from "./expanded";
import type { WorkLanding } from "./work-threads";
import {
  bodyTabStore,
  cardDocFile,
  cardTabOf,
  chatSeat,
  docArrival,
  firstSeat,
  followTab,
  moveSeat,
  nextSeat,
  rightPlaceStore,
  rightShown,
  seatOf,
  workSeat,
  type RightMove,
  type RightSeat,
} from "./right-place";

// restart 02a-9 · 스토리 93 · 94 · 96 · 보드 SummarySheet 「오른쪽 자리는 하나다」 — spec 패널과 요약 카드는 오른쪽 자리 하나를 나눠 쓴다. 값은
// `spec` · `summary` · 없음 중 하나이고 넓힌 카드가 연 것(`opened`)이 곁에 산다. 표의 앞 다섯 줄을 줄마다 잰다. 사이드바는 「넓힌 카드가 서
// 있나」(`opened`)를 따른다 — 서면 접히고 걷히면 되돌아온다.

const DOC: Opened = { kind: "doc", path: "01-실패-신호/재시도-규칙.md" };
const CHANGE: Opened = { kind: "change", project: "atelier", path: "src/watcher.rs" };

/** 작업공간의 채팅 탭이 보는 것 — 넓힐 수 있는 자리다. */
const inWork = (seat: RightSeat) => rightShown(seat, true);

describe("오른쪽 자리 — SummarySheet 표의 앞 다섯 줄", () => {
  it("채팅을 처음 열면 spec 패널이 열려 있고 요약 카드는 닫혀 있다", () => {
    expect(inWork(firstSeat("spec"))).toEqual({ panel: true, card: false, opened: null });
  });

  it("요약 단추를 누르면 spec 패널이 접히고 작은 카드가 선다 — 넓힌 카드가 없어 사이드바는 그대로다", () => {
    const seat = nextSeat(firstSeat("spec"), { kind: "toggle", place: "summary" });
    expect(inWork(seat)).toEqual({ panel: false, card: true, opened: null });
  });

  it("레일의 spec을 누르면 spec 패널이 열리고 요약 카드가 닫힌다", () => {
    const summary = nextSeat(firstSeat("spec"), { kind: "show", place: "summary" });
    expect(inWork(nextSeat(summary, { kind: "show", place: "spec" }))).toEqual({ panel: true, card: false, opened: null });
  });

  it("문서 카드 · PR의 변경 사항 보기가 넓히면 spec 패널이 접히고 넓힌 카드가 선다 — 사이드바가 접힌다", () => {
    for (const target of [DOC, CHANGE]) {
      expect(inWork(nextSeat(firstSeat("spec"), { kind: "expand", target }))).toEqual({ panel: false, card: true, opened: target });
    }
  });

  it("넓힌 카드의 ×를 누르면 spec 패널은 접힌 채 작은 카드로 돌아온다 — 사이드바가 되돌아온다", () => {
    const wide = nextSeat(firstSeat("spec"), { kind: "expand", target: DOC });
    expect(inWork(nextSeat(wide, { kind: "collapse" }))).toEqual({ panel: false, card: true, opened: null });
  });
});

describe("오른쪽 자리의 손짓", () => {
  it("요약 단추를 다시 누르면 카드가 닫히고 자리는 빈다 — 넓혀 있었으면 넓힌 것도 걷힌다", () => {
    const wide = nextSeat(firstSeat("spec"), { kind: "expand", target: DOC });
    const closed = nextSeat(wide, { kind: "toggle", place: "summary" });
    expect(closed).toEqual({ place: null, opened: null });
    expect(inWork(nextSeat(closed, { kind: "toggle", place: "summary" }))).toEqual({ panel: false, card: true, opened: null });
  });

  it("작은 카드를 다시 여는 손짓(머리의 작업공간 이름)은 넓힌 카드를 걷지 않는다", () => {
    const wide = nextSeat(firstSeat("spec"), { kind: "expand", target: DOC });
    expect(nextSeat(wide, { kind: "show", place: "summary" })).toBe(wide);
  });

  it("패널 토글 · ⌘Enter는 spec 패널을 여닫는다 — 카드가 서 있었으면 걷힌다", () => {
    const wide = nextSeat(firstSeat("spec"), { kind: "expand", target: DOC });
    const spec = nextSeat(wide, { kind: "toggle", place: "spec" });
    expect(inWork(spec)).toEqual({ panel: true, card: false, opened: null });
    expect(nextSeat(spec, { kind: "toggle", place: "spec" })).toEqual({ place: null, opened: null });
  });

  it("분할을 켤 때 패널을 접는 것은 spec 패널만 걷는다 — 서 있는 요약 카드는 그대로다", () => {
    expect(nextSeat(firstSeat("spec"), { kind: "hide", place: "spec" })).toEqual({ place: null, opened: null });
    const summary = nextSeat(firstSeat("spec"), { kind: "show", place: "summary" });
    expect(nextSeat(summary, { kind: "hide", place: "spec" })).toBe(summary);
  });

  it("넓힌 카드를 다른 파일로 옮기면 그 파일이다", () => {
    const wide = nextSeat(firstSeat("spec"), { kind: "expand", target: DOC });
    expect(nextSeat(wide, { kind: "expand", target: CHANGE }).opened).toBe(CHANGE);
  });

  // 스토리 94 · Acceptance 「오른쪽 자리에는 하나만 선다」 — 어느 값에서 어느 손짓을 해도 패널과 카드가 함께 서지 않는다.
  it("어느 손짓 뒤에도 오른쪽 자리에는 하나만 선다", () => {
    const moves: RightMove[] = [
      { kind: "show", place: "spec" },
      { kind: "show", place: "summary" },
      { kind: "hide", place: "spec" },
      { kind: "hide", place: "summary" },
      { kind: "toggle", place: "spec" },
      { kind: "toggle", place: "summary" },
      { kind: "expand", target: DOC },
      { kind: "collapse" },
    ];
    const seats = [firstSeat("spec"), firstSeat("summary"), firstSeat(null), nextSeat(firstSeat(null), { kind: "expand", target: DOC })];
    for (const seat of seats) {
      for (const move of moves) {
        const shown = inWork(nextSeat(seat, move));
        expect(shown.panel && shown.card, `${JSON.stringify(seat)} → ${JSON.stringify(move)}`).toBe(false);
        if (shown.opened !== null) expect(shown.card).toBe(true);
      }
    }
  });
});

// 구현 스펙 「02a — 작업공간 밖 채팅」 — 오른쪽 자리는 작은 요약 카드만 쓴다. 넓힐 곳이 없다.
describe("넓힐 수 없는 자리", () => {
  it("작업공간 밖 채팅에는 넓힌 카드가 없다 — 값이 넓혀 있어도 작은 카드다", () => {
    const wide = nextSeat(firstSeat(null), { kind: "expand", target: DOC });
    expect(rightShown(wide, false)).toEqual({ panel: false, card: true, opened: null });
  });
});

// restart 02a-10 · 스토리 94 · 96 · 보드 SummarySheet 표의 탭 줄 — 요약 카드와 넓힌 카드는 채팅 탭에 선다. 본문 탭은 카드가 서는 탭(채팅 탭 ·
// 새 채팅 탭)이면 그 칸의 id, 셸 · 파일 탭 · 문서면 `null`이다.
describe("탭을 옮길 때의 오른쪽 자리 — SummarySheet 표의 탭 줄", () => {
  afterEach(() => {
    rightPlaceStore.setState(() => ({}));
    bodyTabStore.setState(() => ({}));
  });
  const key = workSeat("refund-api");
  const now = () => seatOf(rightPlaceStore.state, key, "spec");
  const CHAT = 3;
  const OTHER_CHAT = 7;
  const SHELL = null;

  it("셸 · 파일 탭을 켜면 요약 카드가 닫히고 값은 없음이 된다 — 넓혀 있었으면 사이드바가 되돌아온다", () => {
    followTab(key, "spec", CHAT);
    moveSeat(key, "spec", { kind: "expand", target: DOC });
    followTab(key, "spec", SHELL);
    expect(now()).toEqual({ place: null, opened: null });
    expect(inWork(now())).toEqual({ panel: false, card: false, opened: null });
  });

  it("셸 · 파일 탭을 켜도 spec 패널은 그대로다", () => {
    followTab(key, "spec", CHAT);
    followTab(key, "spec", SHELL);
    expect(inWork(now())).toEqual({ panel: true, card: false, opened: null });
  });

  it("다른 채팅 탭을 켜면 넓힌 카드가 작은 카드로 돌아온다 — 사이드바가 되돌아온다", () => {
    followTab(key, "spec", CHAT);
    moveSeat(key, "spec", { kind: "expand", target: DOC });
    followTab(key, "spec", OTHER_CHAT);
    expect(inWork(now())).toEqual({ panel: false, card: true, opened: null });
  });

  it("넓힌 채 다른 작업공간을 다녀와도 탭은 작업공간마다 잰다 — 같은 채팅 탭이면 그대로, 다른 채팅 탭이면 작은 카드다", () => {
    followTab(key, "spec", CHAT);
    moveSeat(key, "spec", { kind: "expand", target: DOC });
    followTab(workSeat("watcher"), "spec", SHELL);
    followTab(key, "spec", CHAT);
    expect(now().opened).toBe(DOC);
    followTab(workSeat("watcher"), "spec", 11);
    followTab(key, "spec", OTHER_CHAT);
    expect(inWork(now())).toEqual({ panel: false, card: true, opened: null });
  });

  it("셸에서 채팅 탭으로 돌아와도 닫힌 카드는 닫힌 채다", () => {
    followTab(key, "spec", CHAT);
    moveSeat(key, "spec", { kind: "show", place: "summary" });
    followTab(key, "spec", SHELL);
    followTab(key, "spec", CHAT);
    expect(now()).toEqual({ place: null, opened: null });
  });
});

// 구현 스펙 「02a — 오른쪽 자리」 — 요약 카드를 여는 손짓은 채팅 탭을 먼저 켠다. 가장 최근에 켠 채팅 탭, 열린 채팅 탭이 없으면 가장 최근 채팅을
// 탭으로 세우고(`landingOf`가 고른 것), 채팅이 없으면 새 채팅 탭이다.
describe("요약 카드가 설 채팅 탭", () => {
  afterEach(() => bodyTabStore.setState(() => ({})));
  const key = workSeat("refund-api");
  const chatTab = (id: number, thread: string): BundleTab => ({ kind: "chat", id, thread });
  const LATEST: WorkLanding = { kind: "thread", id: "latest" };

  it("가장 최근에 켠 채팅 탭이다", () => {
    const bundle = [chatTab(3, "a"), { kind: "shell", id: 5 } as const, chatTab(7, "b")];
    followTab(key, "spec", 7);
    followTab(key, "spec", 3);
    followTab(key, "spec", null);
    expect(cardTabOf(key, bundle, LATEST)).toEqual({ kind: "thread", id: "a" });
  });

  it("가장 최근에 켠 채팅 탭이 닫혔으면 그 앞에 켠 채팅 탭이다", () => {
    followTab(key, "spec", 7);
    followTab(key, "spec", 3);
    expect(cardTabOf(key, [chatTab(7, "b")], LATEST)).toEqual({ kind: "thread", id: "b" });
  });

  it("새 채팅 탭은 채팅 탭이 아니다 — 첫 말을 보내 채팅 탭이 된 칸은 채팅 탭이다", () => {
    followTab(key, "spec", 7);
    followTab(key, "spec", 9);
    expect(cardTabOf(key, [chatTab(7, "b"), { kind: "new-chat", id: 9 }], LATEST)).toEqual({ kind: "thread", id: "b" });
    expect(cardTabOf(key, [chatTab(7, "b"), chatTab(9, "settled")], LATEST)).toEqual({ kind: "thread", id: "settled" });
  });

  it("열린 채팅 탭이 없으면 가장 최근 채팅을 탭으로 세우고, 채팅이 없으면 새 채팅 탭이다", () => {
    followTab(key, "spec", 7);
    const bundle = [{ kind: "shell", id: 5 } as const, { kind: "new-chat", id: 9 } as const];
    expect(cardTabOf(key, bundle, LATEST)).toEqual(LATEST);
    expect(cardTabOf(key, bundle, { kind: "new", work: "refund-api" })).toEqual({ kind: "new", work: "refund-api" });
  });

  it("열린 채팅 탭을 켠 적이 없어도 그 탭이다 — 묶음 끝의 것(가장 늦게 연 것)이다", () => {
    expect(cardTabOf(key, [chatTab(3, "a"), chatTab(7, "b"), { kind: "shell", id: 9 }], LATEST)).toEqual({
      kind: "thread",
      id: "b",
    });
  });

  it("켠 차례는 작업공간마다다", () => {
    followTab(workSeat("watcher"), "spec", 7);
    followTab(key, "spec", 3);
    expect(cardTabOf(key, [chatTab(3, "a"), chatTab(7, "b")], LATEST)).toEqual({ kind: "thread", id: "a" });
  });
});

// restart 02a-12 · SummarySheet 표의 문서 줄 셋 — spec 패널의 문서 줄을 누르면 넓힌 카드가 선다(spec 패널 · 사이드바 접힘). 카드가 서는 탭이 아니면
// 켤 탭(위 `cardTabOf`)을 먼저 켠다 — 값을 먼저 넓히고 본문이 그 채팅 탭 · 새 채팅 탭으로 바뀌어도 탭 줄 규칙이 넓힌 카드를 걷지 않는다.
describe("문서 줄을 누를 때의 오른쪽 자리 — SummarySheet 표의 문서 줄", () => {
  afterEach(() => {
    rightPlaceStore.setState(() => ({}));
    bodyTabStore.setState(() => ({}));
  });
  const key = workSeat("refund-api");
  const now = () => inWork(seatOf(rightPlaceStore.state, key, "spec"));
  const press = { kind: "expand", target: DOC } as const;

  it("채팅 탭에서 문서 줄을 누르면 spec 패널이 접히고 넓힌 카드가 선다 — 사이드바가 접힌다", () => {
    followTab(key, "spec", 3);
    moveSeat(key, "spec", press);
    expect(now()).toEqual({ panel: false, card: true, opened: DOC });
  });

  it("셸 · 파일 탭에서 누르면 최근 채팅 탭을 켜고 넓힌 카드가 선다", () => {
    followTab(key, "spec", 3);
    followTab(key, "spec", null);
    moveSeat(key, "spec", press);
    followTab(key, "spec", 3);
    expect(now()).toEqual({ panel: false, card: true, opened: DOC });
  });

  it("채팅이 없는 작업공간에서 누르면 새 채팅 탭에 넓힌 카드가 선다", () => {
    followTab(key, "spec", null);
    moveSeat(key, "spec", press);
    followTab(key, "spec", 9);
    expect(now()).toEqual({ panel: false, card: true, opened: DOC });
  });
});

// restart 02a-12 · 구현 스펙 「02a — `spec` 탭과 분할을 지운다」 — 주소의 `file`은 넓힌 카드의 문서다. 닿으면 넓힌 카드가 열고(없는 문서면 열지 않고
// 걷는다), 카드가 닫히거나 문서가 아닌 것을 열면 걷힌다.
describe("주소의 문서와 넓힌 카드", () => {
  const SPEC = ["overview.md", DOC.path];

  it("주소에 문서가 닿으면 넓힌 카드가 그 문서를 연다 — 이미 그 문서면 아무 일도 없다", () => {
    expect(docArrival(DOC.path, SPEC, null)).toEqual({ kind: "expand", target: DOC });
    expect(docArrival(DOC.path, SPEC, CHANGE)).toEqual({ kind: "expand", target: DOC });
    expect(docArrival(DOC.path, SPEC, DOC)).toBeNull();
  });

  it("없는 문서면 카드를 열지 않고 주소에서 걷는다", () => {
    expect(docArrival("지운-문서.md", SPEC, null)).toBe("clear");
    expect(docArrival("지운-문서.md", SPEC, DOC)).toBe("clear");
  });

  it("넓힌 카드가 다른 문서를 열면 주소가 그 문서다 — 닫히거나 문서가 아닌 것을 열면 걷힌다", () => {
    expect(cardDocFile(DOC, "overview.md")).toBe(DOC.path);
    expect(cardDocFile(null, DOC.path)).toBeNull();
    expect(cardDocFile(CHANGE, DOC.path)).toBeNull();
    expect(cardDocFile({ kind: "project", project: "atelier" }, DOC.path)).toBeNull();
  });

  it("주소가 이미 그 값이면 고칠 것이 없다", () => {
    expect(cardDocFile(DOC, DOC.path)).toBeUndefined();
    expect(cardDocFile(null, null)).toBeUndefined();
    expect(cardDocFile(CHANGE, null)).toBeUndefined();
  });
});

describe("오른쪽 자리를 쥐는 곳", () => {
  afterEach(() => rightPlaceStore.setState(() => ({})));

  it("값이 작업공간마다 하나다 — 한 작업공간의 손짓이 다른 작업공간의 값을 바꾸지 않는다", () => {
    moveSeat(workSeat("refund-api"), "spec", { kind: "show", place: "summary" });
    expect(seatOf(rightPlaceStore.state, workSeat("refund-api"), "spec").place).toBe("summary");
    expect(seatOf(rightPlaceStore.state, workSeat("watcher"), "spec").place).toBe("spec");
  });

  it("처음 보는 열쇠는 처음 값이다 — 손짓은 그 처음 값에서 출발한다", () => {
    expect(seatOf(rightPlaceStore.state, workSeat("refund-api"), null)).toEqual({ place: null, opened: null });
    moveSeat(workSeat("refund-api"), "spec", { kind: "toggle", place: "spec" });
    expect(seatOf(rightPlaceStore.state, workSeat("refund-api"), "spec")).toEqual({ place: null, opened: null });
  });

  it("작업공간과 채팅은 같은 글자여도 다른 열쇠다", () => {
    expect(workSeat("x")).not.toBe(chatSeat("x"));
    moveSeat(chatSeat("x"), null, { kind: "show", place: "summary" });
    expect(seatOf(rightPlaceStore.state, workSeat("x"), "spec").place).toBe("spec");
  });
});
