/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { markOf, readMark, statusOf, type ThreadStatus } from "./status";
import type { RecordLine } from "./types";

// Thread 목록 상태(v1 티켓 41 · 구현 스펙 §17 · S38) — seam은 순수 함수 `statusOf` 하나다: 기록 줄과 엔진이 준 두 값(떠 있는 Session이
// 없을 때의 마지막 seq · 사람이 마지막으로 본 seq)을 넣고, 사이드바 줄이 보일 상태 하나만 본다. 바탕은 엔진 검사(L1)가 가짜 claude로
// 지어 축복한 기록이다(`fold.test.ts` 머리말) — 기록에 없는 갈래(Session 죽음 · 답하지 못한 부르기 · 로그인 필요)는 손으로 지은 줄을
// 덧붙인다.
const record = (name: string): RecordLine[] =>
  readFileSync(fileURLToPath(new URL(`../../../crates/atelier-acp/tests/records/${name}.jsonl`, import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
const through = (lines: readonly RecordLine[], seq: number) => lines.filter((line) => line.seq <= seq);

/** 두 턴을 마친 Thread — 마지막 턴 끝이 seq 19다. */
const twoTurns = record("thread-two-turns");
/** 떠 있는 Session — `goneThrough`가 없다. */
const live = (lastRead: number) => ({ goneThrough: null, lastRead });

describe("새 결과", () => {
  it("마지막 턴 끝이 읽은 자리 뒤에 있으면 새 결과이고, 맨 아래까지 읽었으면 아무 상태도 없다", () => {
    expect(statusOf(twoTurns, live(0))?.kind).toBe("new");
    expect(statusOf(twoTurns, live(8))?.kind).toBe("new");
    expect(statusOf(twoTurns, live(19))).toBeNull();
  });
});

describe("작업 중", () => {
  it("턴이 돌면 작업 중이고, 미리보기는 지금 도는 도구의 문구다", () => {
    expect(statusOf(through(twoTurns, 15), live(0))).toEqual({ kind: "working", text: "wc -c notes.txt 실행 중" });
  });

  it("도는 도구가 없으면(생각 · 답이 흐르는 중) 미리보기를 바꾸지 않는다 — 마지막 말이 남는다", () => {
    expect(statusOf(through(twoTurns, 10), live(8))).toEqual({ kind: "working", text: null });
  });
});

describe("내 차례", () => {
  /** Host가 Thread 밖 파일을 쓰려고 물은 축복 기록 — seq 8이 물음, 9가 답이다. */
  const asking = record("thread-permission");

  /** Host가 명령 실행을 묻는 줄(판정이 세운 명령 카드) — 손으로 지었다. */
  const askCommand = (seq: number, at: string, requestId: string, command: string): RecordLine => ({
    seq,
    at,
    kind: "permission",
    payload: {
      state: "asked",
      requestId,
      card: "command",
      policy: "매번 묻기",
      grant: [],
      request: {
        sessionId: "s",
        toolCall: { toolCallId: `call-${requestId}`, title: command, kind: "execute", status: "pending", rawInput: { command } },
        options: [
          { optionId: "allow_once", name: "Yes", kind: "allow_once" },
          { optionId: "reject", name: "No", kind: "reject_once" },
        ],
      },
    },
  });

  it("답을 기다리는 승인이 있으면 턴이 돌아도 내 차례이고, 미리보기는 기다리는 것 · 시각은 기다리기 시작한 때다", () => {
    expect(statusOf(through(asking, 8), live(0))).toEqual({
      kind: "mine",
      since: "2026-10-10T10:00:08.000+09:00",
      text: "승인 · allowed.txt",
    });
  });

  it("명령을 물으면 그 명령이 서고, 여럿이 기다리면 먼저 물은 것이다", () => {
    const lines = [
      ...through(twoTurns, 15),
      askCommand(17, "2026-10-10T10:00:17.000+09:00", "1", "pnpm prisma migrate dev"),
      askCommand(18, "2026-10-10T10:00:18.000+09:00", "2", "rm -rf dist"),
    ];
    expect(statusOf(lines, live(0))).toEqual({
      kind: "mine",
      since: "2026-10-10T10:00:17.000+09:00",
      text: "승인 · pnpm prisma migrate dev",
    });
  });

  it("답하면 내 차례가 걷힌다", () => {
    expect(statusOf(through(asking, 9), live(0))?.kind).toBe("working");
  });

  // Agent의 질문(v1 티켓 26)도 같은 물음 차례다 — 미리보기는 첫 물음이다(Sidebar 보드 「질문 · 수수료는 어떻게 할까요?」).
  it("질문이 서 있으면 내 차례이고, 미리보기는 「질문 · 」 뒤의 첫 물음이다", () => {
    const asked = record("thread-question");
    expect(statusOf(through(asked, 7), live(0))).toEqual({
      kind: "mine",
      since: "2026-10-10T10:00:07.000+09:00",
      text: "질문 · 부분 환불 수수료는 어떻게 할까요?",
    });
  });

  // Work 만들기 카드(v1 티켓 30)도 사람의 답을 기다리는 물음이다 — 같은 물음 차례에 선다(`ThreadModel.asks`).
  it("Work 만들기 카드가 서 있으면 내 차례이고, 미리보기는 만들 Work의 제목이다", () => {
    const working = record("thread-work");
    expect(statusOf(through(working, 55), live(0))).toEqual({
      kind: "mine",
      since: "2026-10-10T10:00:55.000+09:00",
      text: "Work 만들기 · 환불 API 부분 환불 버그 수정 (#31)",
    });
    expect(statusOf(through(working, 56), live(0))?.kind).toBe("working");
  });

  // Work 밖 Project 카드(v1 티켓 32)도 같은 물음 차례다 — 미리보기는 고치려는 Project다.
  it("Work 밖 Project 카드가 서 있으면 내 차례이고, 미리보기는 「Work 밖 Project · web-app」이다", () => {
    const outside = record("thread-project");
    expect(statusOf(through(outside, 7), live(0))).toEqual({
      kind: "mine",
      since: "2026-10-10T10:00:07.000+09:00",
      text: "Work 밖 Project · web-app",
    });
    expect(statusOf(through(outside, 8), live(0))?.kind).toBe("working");
  });

  // Service 질문 카드(03 티켓 08)는 Host가 Thread 도구로 묻는 질문이다 — 같은 물음 차례에 서고, 미리보기는 그 물음이다.
  it("Service 질문 카드가 서 있으면 내 차례이고, 미리보기는 「질문 · 어느 Service에서 할까요?」다", () => {
    const spacing = record("thread-service-ask");
    expect(statusOf(through(spacing, 7), live(0))).toEqual({
      kind: "mine",
      since: "2026-10-10T10:00:07.000+09:00",
      text: "질문 · 어느 Service에서 할까요?",
    });
    expect(statusOf(through(spacing, 8), live(0))?.kind).toBe("working");
  });

  // Project 추가 카드(03 티켓 12)도 Host가 Thread 도구로 묻는 질문이다 — 미리보기는 추가하려던 폴더다.
  it("Project 추가 카드가 서 있으면 내 차례이고, 미리보기는 「질문 · notes 추가」다", () => {
    const adding = record("thread-project-add");
    expect(statusOf(through(adding, 7), live(0))).toEqual({
      kind: "mine",
      since: "2026-10-10T10:00:07.000+09:00",
      text: "질문 · notes 추가",
    });
    expect(statusOf(through(adding, 8), live(0))?.kind).toBe("working");
  });

  // 앱을 다시 켜면 물은 프로세스가 없다 — 답할 곳이 없는 물음은 기다리는 것이 아니다(`goneThrough`).
  it("앱을 다시 켠 뒤 남은 물음은 내 차례가 아니다", () => {
    expect(statusOf(through(asking, 8), { goneThrough: 8, lastRead: 0 })?.kind).not.toBe("mine");
  });
});

describe("실패", () => {
  const second = (n: number) => `2026-10-10T10:00:${String(n).padStart(2, "0")}.000+09:00`;
  const sessionLine = (seq: number, payload: Record<string, unknown>): RecordLine => ({
    seq,
    at: second(seq),
    kind: "session",
    payload,
  });
  const sent = (seq: number, words: string): RecordLine => ({ seq, at: second(seq), kind: "sent", payload: { text: words } });
  const answer = (seq: number, words: string): RecordLine => ({
    seq,
    at: second(seq),
    kind: "update",
    payload: { sessionId: "s", update: { sessionUpdate: "agent_message_chunk", messageId: `m${seq}`, content: { type: "text", text: words } } },
  });
  const turnEnd = (seq: number, payload: Record<string, unknown> = { stopReason: "end_turn", cancelledByUs: false }): RecordLine => ({
    seq,
    at: second(seq),
    kind: "turn-end",
    payload,
  });

  it("도는 턴의 프로세스가 죽으면 실패이고, 미리보기는 끊긴 까닭이다", () => {
    const lines = [...through(twoTurns, 15), sessionLine(17, { state: "died", reason: "signal 9" })];
    expect(statusOf(lines, live(19))).toEqual({ kind: "failed", at: second(17), text: "Claude Code가 끝났어요" });
  });

  // 앱을 다시 켜면 그 앞에 돌던 턴을 적던 프로세스가 없다(`goneThrough`) — 끝을 받지 못한 턴이다.
  it("앱이 꺼지며 끊긴 턴도 실패다", () => {
    expect(statusOf(through(twoTurns, 15), { goneThrough: 15, lastRead: 0 })).toEqual({
      kind: "failed",
      at: second(15),
      text: "앱이 꺼지며 끊겼어요",
    });
    expect(statusOf(through(record("thread-permission"), 8), { goneThrough: 8, lastRead: 0 })?.kind).toBe("failed");
  });

  it("답 없이 오류로 끝난 턴은 그 오류가 미리보기다", () => {
    const lines = [...twoTurns, sent(21, "다시 해 줘"), turnEnd(22, { error: { code: -32603, message: "API 사용량을 넘었어요" } })];
    expect(statusOf(lines, live(22))).toEqual({ kind: "failed", at: second(22), text: "API 사용량을 넘었어요" });
  });

  // 로그인 필요(three-axes 티켓 12)는 Session이 열리지 못한 것이다 — 보낸 말의 턴은 답을 받지 못한 채 열려 있다.
  it("로그인이 필요해 멈춘 Thread는 작업 중이 아니라 실패다", () => {
    const lines = [...twoTurns, sent(21, "이어서 해 줘"), sessionLine(22, { state: "login-required" })];
    expect(statusOf(lines, live(19))).toEqual({ kind: "failed", at: second(22), text: "로그인이 필요해요" });
  });

  it("실패한 뒤 새 턴이 끝나면 실패가 걷힌다", () => {
    const lines = [...through(twoTurns, 15), sessionLine(17, { state: "died", reason: "signal 9" }), sent(21, "다시"), answer(22, "됐어요"), turnEnd(23)];
    expect(statusOf(lines, live(0))?.kind).toBe("new");
  });
});

describe("중단", () => {
  it("마지막 턴을 사람이 멈췄으면 읽었어도 「중단했습니다」다 — 앱을 다시 켠 뒤에도", () => {
    const stopped = { kind: "stopped", at: "2026-10-10T10:00:13.000+09:00", text: "중단했습니다" };
    expect(statusOf(record("thread-stopped"), live(13))).toEqual(stopped);
    // 끝 점검 ⑤(v1 티켓 44) — 다시 켠 앱은 떠 있는 Session이 없다고 말한다(기록 끝까지 지나감). 멈춘 턴이 「앱이 꺼지며 끊겼어요」가 되지 않는다.
    expect(statusOf(record("thread-stopped"), { goneThrough: 13, lastRead: 13 })).toEqual(stopped);
  });
});

// S38 — 읽은 자리는 맨 아래가 보일 때 적는다. 그때 무엇을 적나: 읽지 않은 턴 끝이 있을 때만 지금 끝 줄의 seq다. 턴이 도는 동안 흐르는
// 줄마다 `thread.json`을 다시 쓰지 않는다.
describe("읽은 자리", () => {
  it("읽지 않은 턴 끝이 있으면 끝 줄의 seq를 적고, 없으면 적지 않는다", () => {
    expect(readMark(twoTurns, 0)).toBe(19);
    expect(readMark(twoTurns, 11)).toBe(19);
    expect(readMark(twoTurns, 19)).toBeNull();
    expect(readMark(through(twoTurns, 15), 8)).toBeNull();
    expect(readMark([], 0)).toBeNull();
  });
});

// **상태 표시가 그리는 것**(02 구현 스펙 §4 · S11). 상태를 고르는 함수와 그 차례는 그대로이고, 그리는 법만 바뀌었다 — 줄 오른쪽 끝에 표시 하나다.
// 넷은 저마다 표시가 있고, 멈춤은 표시가 없다(사람이 멈춘 것은 일거리가 아니다).
describe("상태 표시", () => {
  it.each([
    [{ kind: "mine", since: "2026-10-10T10:00:00.000+09:00", text: "승인 · pnpm test" }, "mine"],
    [{ kind: "working", text: null }, "working"],
    [{ kind: "failed", at: "2026-10-10T10:00:00.000+09:00", text: "Claude Code와 연결이 끊겼어요" }, "failed"],
    [{ kind: "new" }, "new"],
    [{ kind: "stopped", at: "2026-10-10T10:00:00.000+09:00", text: "중단했습니다" }, null],
    [null, null],
  ] satisfies [ThreadStatus | null, string | null][])("%o → %s", (status, mark) => {
    expect(markOf(status)).toBe(mark);
  });
});
