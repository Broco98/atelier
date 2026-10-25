import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "./types";
import { landingOf, threadCounts, threadsOf, workMarks } from "./work-threads";

// 사이드바 Work 묶음이 품는 Thread(v1 티켓 37 · 구현 스펙 §13 · 스토리 104) — seam은 순수 함수 넷이다. 호버 카드의 Thread 수
// (`threadCounts`), Work 줄 상태 표시가 읽는 Thread들의 표시(`workMarks`), 펼친 Work 아래에 서는 Thread와 그 차례(`threadsOf`), Work 줄을 누르면 갈 곳(`landingOf` — 가장 최근 Thread, 없으면
// 그 Work에 이은 새 Thread). 마지막 말의 때는 부르는 쪽이 기록에서 읽어 건넨다(`lastSaid`) — 여기로는 그 값만 들어온다.

const summary = (id: string, over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  title: id,
  createdAt: "2026-10-10T09:00:00.000+09:00",
  work: null,
  handles: ["host"],
  lastRead: 0,
  readOnly: null,
  broken: null,
  ...over,
});

/** 목록은 엔진의 차례(선 때 새것부터)로 온다. */
const threads = [
  summary("pr-review", { work: "fix-refund", createdAt: "2026-10-10T11:00:00.000+09:00" }),
  summary("loose", { createdAt: "2026-10-10T10:30:00.000+09:00" }),
  summary("refund-bug", { work: "fix-refund", createdAt: "2026-10-10T10:00:00.000+09:00" }),
  summary("redesign", { work: "checkout", createdAt: "2026-10-10T09:00:00.000+09:00" }),
];

describe("Work 줄의 Thread 수", () => {
  it("Work마다 이은 Thread를 센다 — Work 없는 Thread는 세지 않는다", () => {
    expect(threadCounts(threads)).toEqual({ "fix-refund": 2, checkout: 1 });
  });
});

describe("펼친 Work 아래의 Thread", () => {
  it("그 Work에 이은 Thread만 목록의 차례 그대로 선다", () => {
    expect(threadsOf(threads, "fix-refund").map((one) => one.id)).toEqual(["pr-review", "refund-bug"]);
    expect(threadsOf(threads, "nothing")).toEqual([]);
  });
});

describe("Work 줄을 누르면", () => {
  it("마지막 말이 가장 늦은 Thread로 간다", () => {
    const said: Record<string, string> = {
      "pr-review": "2026-10-10T11:05:00.000+09:00",
      "refund-bug": "2026-10-10T12:00:00.000+09:00",
    };
    expect(landingOf(threads, "fix-refund", (id) => said[id] ?? null)).toEqual({ kind: "thread", id: "refund-bug" });
  });

  it("때는 시각으로 견준다 — 시간대가 달라도 글자 차례가 아니다", () => {
    const said: Record<string, string> = {
      "pr-review": "2026-10-10T03:30:00.000Z",
      "refund-bug": "2026-10-10T12:00:00.000+09:00",
    };
    expect(landingOf(threads, "fix-refund", (id) => said[id] ?? null)).toEqual({ kind: "thread", id: "pr-review" });
  });

  it("말이 아직 없는 Thread는 선 때로 견준다", () => {
    expect(landingOf(threads, "fix-refund", () => null)).toEqual({ kind: "thread", id: "pr-review" });
    const said: Record<string, string> = { "refund-bug": "2026-10-10T10:30:00.000+09:00" };
    expect(landingOf(threads, "fix-refund", (id) => said[id] ?? null)).toEqual({ kind: "thread", id: "pr-review" });
  });

  it("때가 같으면 목록의 앞(새것)이다", () => {
    expect(landingOf(threads, "fix-refund", () => "2026-10-10T12:00:00.000+09:00")).toEqual({
      kind: "thread",
      id: "pr-review",
    });
  });

  it("그 Work에 Thread가 없으면 그 Work에 이은 새 Thread다", () => {
    expect(landingOf(threads, "empty-work", () => null)).toEqual({ kind: "new", work: "empty-work" });
  });

  it("열 수 없는 Thread로는 가지 않는다 — 그것뿐이면 새 Thread다", () => {
    const broken = [
      summary("bad", { work: "w", broken: "thread.json을 읽지 못했어요", createdAt: "2026-10-11T09:00:00.000+09:00" }),
      summary("good", { work: "w" }),
    ];
    expect(landingOf(broken, "w", () => null)).toEqual({ kind: "thread", id: "good" });
    expect(landingOf(broken.slice(0, 1), "w", () => null)).toEqual({ kind: "new", work: "w" });
  });
});

// v1 티켓 38 — 보관되거나 지워진 Work의 Thread(읽기만)는 사이드바에서 빠진다(S43). 그 Work는 Work 목록에도 없지만, 보관이 막 일어나 목록이
// 아직 옛 것인 동안에도 그 Work 줄이 읽기만 된 Thread를 세거나 품지 않는다.
describe("읽기만 된 Thread", () => {
  const gone = [
    summary("archived-talk", { work: "fix-refund", readOnly: "archived", createdAt: "2026-10-11T09:00:00.000+09:00" }),
    summary("alive", { work: "fix-refund" }),
    summary("removed-talk", { work: "checkout", readOnly: "removed" }),
  ];

  it("세지도 펼친 Work 아래에 세우지도 않는다", () => {
    expect(threadCounts(gone)).toEqual({ "fix-refund": 1 });
    expect(threadsOf(gone, "fix-refund").map((one) => one.id)).toEqual(["alive"]);
    expect(threadsOf(gone, "checkout")).toEqual([]);
  });

  it("Work 줄을 눌러도 그리로 가지 않는다", () => {
    expect(landingOf(gone, "fix-refund", () => null)).toEqual({ kind: "thread", id: "alive" });
    expect(landingOf(gone, "checkout", () => null)).toEqual({ kind: "new", work: "checkout" });
  });
});

// **Work 줄의 상태 표시가 읽는 것**(02 티켓 05 · S8) — Work마다 그 Work에 이은 Thread들의 표시(`markOf`)다. 가장 센 하나를 고르는 것은
// `features/works/work-mark.ts`의 `workMark`이고, 여기서는 어느 Thread의 표시가 어느 Work로 가는지만 본다.
describe("Work 줄의 상태 표시가 읽는 Thread", () => {
  const marks: Record<string, "mine" | "new" | null> = { "pr-review": "new", "refund-bug": "mine", loose: "mine", redesign: null };

  it("Work마다 그 Work에 이은 Thread의 표시를 목록의 차례로 모은다 — Work 없는 Thread는 어느 Work에도 들지 않는다", () => {
    expect(workMarks(threads, (thread) => marks[thread.id] ?? null)).toEqual({
      "fix-refund": ["new", "mine"],
      checkout: [null],
    });
  });

  it("읽기만인 Thread(보관되거나 지워진 Work의 것)는 들지 않는다", () => {
    const archived = [summary("old", { work: "fix-refund", readOnly: "archived" }), ...threads];
    expect(workMarks(archived, () => "mine")["fix-refund"]).toHaveLength(2);
  });
});
