/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { RecordLine, ThreadSummary } from "./types";
import { jumpTarget, threadMark, waitingOrder } from "./waiting";

// 「내 차례」 거르기와 ⌘J(v1 티켓 42 · 구현 스펙 §13 S28 · §17 · 스토리 131 · 132) — seam은 순수 함수 둘이다. 「내 차례만」 목록과 그
// 수 · ⌘J가 함께 읽는 차례(`waitingOrder` — 목록 요약 · 기록 줄 · 엔진의 살아 있음에서 기다리는 Thread를 기다린 순서로)와, ⌘J가 어디로
// 가는지(`jumpTarget`). 기록의 바탕은 `status.test.ts`와 같은 축복 기록이고, 물음 줄은 손으로 덧붙인다.
const record = (name: string): RecordLine[] =>
  readFileSync(fileURLToPath(new URL(`../../../crates/atelier-acp/tests/records/${name}.jsonl`, import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
const through = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq <= seq);

/** 두 턴을 마친 Thread — 마지막 턴 끝이 seq 20이다. 16에서 자르면 둘째 턴이 돈다. */
const twoTurns = record("thread-two-turns");

/** Host가 명령 실행을 묻는 줄 — 그 시각이 기다리기 시작한 때다. */
const asks = (seq: number, at: string, command: string): RecordLine => ({
  seq,
  at,
  kind: "permission",
  who: "host",
  payload: {
    state: "asked",
    requestId: String(seq),
    card: "command",
    policy: "매번 묻기",
    grant: [],
    request: {
      sessionId: "s",
      toolCall: { toolCallId: `call-${seq}`, title: command, kind: "execute", status: "pending", rawInput: { command } },
      options: [
        { optionId: "allow_once", name: "Yes", kind: "allow_once" },
        { optionId: "reject", name: "No", kind: "reject_once" },
      ],
    },
  },
});

/** 둘째 턴이 돌다 `at`에 `command`를 묻는 기록. */
const asking = (at: string, command: string) => [...through(twoTurns, 16), asks(17, at, command)];

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

/** 앱에 떠 있는 Thread들 — 열쇠마다 기록 줄. 엔진은 모두 살아 있다고 답했다. */
const live = (records: Record<string, readonly RecordLine[]>) => (thread: string) =>
  thread in records ? { lines: records[thread], view: { live: true, lastSeq: records[thread][records[thread].length - 1].seq } } : null;

describe("내 차례만 — 기다린 순서", () => {
  it("나를 기다리는 Thread만, 기다리기 시작한 때가 이른 것부터 선다 — 목록의 차례(새것 먼저)가 아니다", () => {
    const threads = [summary("새것"), summary("일하는"), summary("중간"), summary("오래된")];
    const order = waitingOrder(
      threads,
      live({
        새것: asking("2026-10-10T10:20:00.000+09:00", "rm -rf dist"),
        일하는: through(twoTurns, 16),
        중간: asking("2026-10-10T10:10:00.000+09:00", "pnpm playwright test"),
        오래된: asking("2026-10-10T10:00:30.000+09:00", "pnpm prisma migrate dev"),
      }),
    );
    expect(order.map((one) => [one.thread.id, one.since, one.text])).toEqual([
      ["오래된", "2026-10-10T10:00:30.000+09:00", "승인 · pnpm prisma migrate dev"],
      ["중간", "2026-10-10T10:10:00.000+09:00", "승인 · pnpm playwright test"],
      ["새것", "2026-10-10T10:20:00.000+09:00", "승인 · rm -rf dist"],
    ]);
  });

  // 보드 「내 차례만」의 「환불 API 버그 고쳐줘」는 Work 아래 Thread다 — 「내 차례」에서는 Work 묶음과 Thread 묶음이 한 줄에 섞인다.
  it("Work에 이은 Thread도 들고, 깨진 Thread · 아직 읽지 않은 Thread · 답할 곳이 없는 물음은 들지 않는다", () => {
    const at = "2026-10-10T10:00:30.000+09:00";
    const threads = [
      summary("Work 안", { work: "refund-bug" }),
      summary("깨진", { broken: "thread.json을 읽지 못했어요" }),
      summary("안 읽은"),
      summary("다시 켠"),
    ];
    const readings: Record<string, ReturnType<ReturnType<typeof live>>> = {
      "Work 안": live({ "Work 안": asking(at, "pnpm prisma migrate dev") })("Work 안"),
      깨진: live({ 깨진: asking(at, "rm -rf dist") })("깨진"),
      // 앱을 다시 켜면 물은 프로세스가 없다 — 엔진이 살아 있지 않다고 답한 기록 끝까지의 물음은 기다리는 것이 아니다.
      "다시 켠": { lines: asking(at, "pnpm test"), view: { live: false, lastSeq: 17 } },
    };
    expect(waitingOrder(threads, (thread) => readings[thread] ?? null).map((one) => one.thread.id)).toEqual(["Work 안"]);
  });

  // v1 티켓 38 · S43 — 보관된(지워진) Work의 Thread는 사이드바에서 빠진다. 보관된 때 돌던 턴이 물음을 남겼어도 그 Thread는 ⌘K로 연다.
  it("보관되거나 지워진 Work의 Thread는 들지 않는다", () => {
    const at = "2026-10-10T10:00:30.000+09:00";
    const threads = [
      summary("보관됨", { work: "webhook", readOnly: "archived" }),
      summary("지워짐", { work: "gone", readOnly: "removed" }),
      summary("지금 일", { work: "refund-bug" }),
    ];
    const readings = live({ 보관됨: asking(at, "rm -rf dist"), 지워짐: asking(at, "pnpm test"), "지금 일": asking(at, "pnpm prisma migrate dev") });
    expect(waitingOrder(threads, readings).map((one) => one.thread.id)).toEqual(["지금 일"]);
  });
});

// **Work 줄의 상태 표시가 읽는 Thread 하나의 표시**(02 티켓 05 · S8) — 사이드바 Thread 줄과 같은 판정이다(`statusOf` → `markOf`). Work 줄은
// 접혀 있어도 그 Work의 Thread들을 이것으로 읽어 가장 센 하나를 세운다(`workMarks` → `workMark`).
describe("Thread 하나의 상태 표시", () => {
  const at = "2026-10-10T10:00:30.000+09:00";

  it("나를 기다리면 내 차례, 돌면 도는 중, 끝났는데 안 봤으면 새 결과다", () => {
    const readings = live({ 묻는: asking(at, "pnpm test"), 도는: through(twoTurns, 16), 끝난: twoTurns });
    expect(["묻는", "도는", "끝난"].map((id) => threadMark(summary(id), readings(id)))).toEqual(["mine", "working", "new"]);
  });

  it("본 Thread · 아직 읽지 않은 Thread · 깨진 Thread는 표시가 없다", () => {
    const readings = live({ 본: twoTurns, 깨진: twoTurns });
    expect(threadMark(summary("본", { lastRead: 20 }), readings("본"))).toBeNull();
    expect(threadMark(summary("안 읽은"), null)).toBeNull();
    expect(threadMark(summary("깨진", { broken: "thread.json을 읽지 못했어요" }), readings("깨진"))).toBeNull();
  });
});

// S28 — ⌘J는 기다린 순서대로 내 차례 Thread로 간다. 내 차례가 없으면 지금처럼 나를 기다리는 셸로 간다(스토리 132 「다음 내 차례 Thread로,
// 그다음 나를 기다리는 셸로」). `shell`은 방금 부른 셸이 지금 떠 있나다(`recalledShell`이 갈 셸을 돌려주나).
describe("⌘J — 어디로 가나", () => {
  const order = ["가", "나", "다"];

  it("내 차례 Thread 밖에서 누르면 가장 오래 기다린 Thread로 간다", () => {
    expect(jumpTarget(order, null, true)).toEqual({ kind: "thread", id: "가" });
    expect(jumpTarget(order, "기다리지 않는 Thread", true)).toEqual({ kind: "thread", id: "가" });
  });

  it("내 차례 Thread에서 누르면 기다린 순서의 다음 Thread로 건너뛴다", () => {
    expect(jumpTarget(order, "가", true)).toEqual({ kind: "thread", id: "나" });
    expect(jumpTarget(order, "나", false)).toEqual({ kind: "thread", id: "다" });
  });

  it("마지막 Thread에서 누르면 부른 셸로 가고, 부른 셸이 없으면 처음 Thread로 돈다", () => {
    expect(jumpTarget(order, "다", true)).toEqual({ kind: "shell" });
    expect(jumpTarget(order, "다", false)).toEqual({ kind: "thread", id: "가" });
  });

  it("기다리는 Thread가 지금 보는 하나뿐이고 부른 셸도 없으면 아무 데도 가지 않는다", () => {
    expect(jumpTarget(["가"], "가", false)).toBeNull();
  });

  // 「지금처럼」 — 셸 쪽 길(방금 부른 셸로 · 닫혔으면 「그 셸은 닫혔어요」 · 없으면 아무것도)은 그대로 그 길이 정한다.
  it("내 차례가 없으면 셸 쪽 길로 간다", () => {
    expect(jumpTarget([], null, false)).toEqual({ kind: "shell" });
    expect(jumpTarget([], "가", true)).toEqual({ kind: "shell" });
  });
});
