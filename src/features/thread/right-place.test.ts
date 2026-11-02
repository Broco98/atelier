import { afterEach, describe, expect, it } from "vitest";
import type { Opened } from "./expanded";
import {
  chatSeat,
  firstSeat,
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
