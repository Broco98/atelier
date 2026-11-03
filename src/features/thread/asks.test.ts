import { describe, expect, it } from "vitest";
import { askTurn, nextOf } from "./asks";
import {
  thinkingLine,
  foldThread,
  type PendingPermission,
  type PendingProject,
  type PendingProjectAdd,
  type PendingQuestion,
  type PendingService,
} from "./fold";
import type { RecordLine } from "./types";

// 물음 차례(v1 티켓 25 · 구현 스펙 §9 카드 · 캔버스 Approval 보드 A안 「두 Agent가 함께 물을 때」) — 한 Thread에 걸린 물음이 여럿이면
// 먼저 온 것 하나만 입력창 자리에 서고, 「1 / 2」와 카드 아래 「다음 · …」 줄이 차례를 말한다. seam은 기록 줄을 접은 모델에서 차례를
// 읽는 순수 함수 `askTurn(foldThread(lines))`와 다음 줄의 글 `nextOf`다.

const at = (second: number) => `2026-10-23T14:15:${String(second).padStart(2, "0")}.000+09:00`;
const OPTIONS = [
  { optionId: "allow_once", name: "Yes", kind: "allow_once" },
  { optionId: "reject", name: "No", kind: "reject_once" },
];
const sent = (seq: number, text: string): RecordLine => ({ seq, at: at(seq), kind: "sent", payload: { text } });
const toolCall = (seq: number, body: Record<string, unknown>): RecordLine => ({
  seq,
  at: at(seq),
  kind: "update",
  payload: { sessionId: "s", update: { sessionUpdate: "tool_call", status: "pending", ...body } },
});
/** 물음 줄 — 요청 id는 세션 안에서 겹치지 않는다. */
const asked = (seq: number, call: Record<string, unknown>, requestId: string): RecordLine => ({
  seq,
  at: at(seq),
  kind: "permission",
  payload: {
    state: "asked",
    requestId,
    request: { toolCall: { toolCallId: call.toolCallId }, options: OPTIONS },
    toolCall: call,
    card: "command",
    policy: "매번 묻기",
  },
});
const answered = (seq: number, optionId: string, requestId: string): RecordLine => ({
  seq,
  at: at(seq),
  kind: "permission",
  payload: { state: "answered", requestId, optionId },
});

const migrate = {
  toolCallId: "toolu_migrate",
  kind: "execute",
  title: "pnpm prisma migrate dev --name partial_refund",
  rawInput: { command: "pnpm prisma migrate dev --name partial_refund" },
};
const playwright = {
  toolCallId: "toolu_playwright",
  kind: "execute",
  title: "pnpm playwright test",
  rawInput: { command: "pnpm playwright test e2e/refund.spec.ts" },
};

/** 세션이 도구 둘을 함께 부르고 마이그레이션과 e2e 테스트 실행을 함께 기다린다. */
const bothAsking: RecordLine[] = [
  sent(1, "환불 API 버그 고쳐줘"),
  toolCall(2, migrate),
  asked(3, migrate, "0"),
  toolCall(4, playwright),
  asked(5, playwright, "1"),
];
const order = (turn: ReturnType<typeof askTurn>) => turn && [turn.current.requestId, turn.count, turn.next?.requestId ?? null];

describe("물음 차례", () => {
  it("물음이 하나면 그것만 서고 「1 / 2」도 다음 줄도 없다", () => {
    expect(order(askTurn(foldThread(bothAsking.slice(0, 3))))).toEqual(["0", null, null]);
  });

  it("함께 물으면 먼저 온 것이 서고, 「1 / 2」와 다음 차례가 선다", () => {
    expect(order(askTurn(foldThread(bothAsking)))).toEqual(["0", { at: 1, total: 2 }, "1"]);
  });

  it("앞의 것에 답하면 다음 것이 「2 / 2」로 서고, 다 답하면 차례가 걷힌다 — 묶음은 물음이 다 닫힐 때 끝난다", () => {
    const first = [...bothAsking, answered(6, "allow_once", "0")];
    expect(order(askTurn(foldThread(first)))).toEqual(["1", { at: 2, total: 2 }, null]);
    const both = [...first, answered(7, "reject", "1")];
    expect(askTurn(foldThread(both))).toBeNull();
    // 다 닫힌 뒤에 온 물음은 새 묶음이다.
    const again = { ...migrate, toolCallId: "toolu_again" };
    expect(order(askTurn(foldThread([...both, toolCall(8, again), asked(9, again, "2")])))).toEqual(["2", null, null]);
  });

  it("답을 기다리는 사이 앞의 것이 답하고 새 물음이 오면 묶음의 수가 는다", () => {
    const again = { ...migrate, toolCallId: "toolu_again" };
    const lines = [...bothAsking, answered(6, "allow_once", "0"), toolCall(7, again), asked(8, again, "2")];
    expect(order(askTurn(foldThread(lines)))).toEqual(["1", { at: 2, total: 3 }, "2"]);
  });

  it("승인을 기다리는 세션은 「생각 중」에 서지 않는다 — 입력창 자리의 카드가 말한다", () => {
    // 물음 줄이 도구 줄보다 먼저 왔다 — 턴에 아직 아무 줄도 없어 묻지 않았다면 「생각 중」이다.
    const lines = [sent(1, "환불 API 버그 고쳐줘"), asked(2, migrate, "0")];
    expect(thinkingLine(foldThread(lines.slice(0, 1)))).toBe(true);
    expect(thinkingLine(foldThread(lines))).toBe(false);
  });

  it("세션이 사라지면 걸린 물음이 모두 걷힌다 — 답할 곳이 없다", () => {
    const died: RecordLine = { seq: 6, at: at(6), kind: "session", payload: { state: "died", reason: "끝났어요" } };
    expect(askTurn(foldThread([...bothAsking, died]))).toBeNull();
  });
});

describe("Work 만들기 카드도 같은 차례다(v1 티켓 30 · §9 「같은 자리, 같은 차례」)", () => {
  /** Runtime의 Work 만들기 제안 줄 — 요청 id는 엔진이 지은 uuid다. */
  const proposed = (seq: number, requestId = "w-1"): RecordLine => ({
    seq,
    at: at(seq),
    kind: "question",
    payload: {
      state: "asked",
      requestId,
      card: "work",
      title: "환불 API 버그 수정",
      slug: "refund-api",
      reason: "고칠 Project와 브랜치를 골라 두었어요",
      branch: "fix/refund-api",
      projects: [{ slug: "api-server", name: "api-server", description: null, recommended: true, reason: null, branches: ["main"] }],
    },
  });
  const commandAsks: RecordLine[] = [sent(1, "e2e 돌려 줘"), toolCall(2, playwright), asked(3, playwright, "0"), proposed(4)];

  it("먼저 온 승인 카드 뒤에 Work 만들기 카드가 「다음 · 작업공간 만들기 답을 기다려요」로 선다", () => {
    const turn = askTurn(foldThread(commandAsks));
    expect(order(turn)).toEqual(["0", { at: 1, total: 2 }, "w-1"]);
    expect(turn?.next && nextOf(turn.next)).toEqual({
      subject: "작업공간 만들기",
      mono: false,
      what: "답을 기다려요",
    });
  });

  it("앞의 것에 답하면 Work 만들기 카드가 「2 / 2」로 서고, 그 카드에 답하면 차례가 걷힌다", () => {
    const first = [...commandAsks, answered(5, "allow_once", "0")];
    const turn = askTurn(foldThread(first));
    expect(order(turn)).toEqual(["w-1", { at: 2, total: 2 }, null]);
    expect(turn?.current.card).toBe("work");
    const done: RecordLine = {
      seq: 6,
      at: at(6),
      kind: "question",
      payload: { state: "answered", requestId: "w-1", card: "work", choice: "continue" },
    };
    expect(askTurn(foldThread([...first, done]))).toBeNull();
  });
});

describe("카드 아래 다음 줄", () => {
  const pendingOf = (toolCall: Record<string, unknown>): PendingPermission => ({
    requestId: "0",
    options: OPTIONS,
    toolCall,
    tool: null,
    planReview: toolCall.kind === "switch_mode",
    card: null,
    policy: null,
    grant: [],
  });

  it("다음 차례는 무엇을 기다리는지다 — 이름 없이, 대상은 작업 로그의 그 도구 줄과 같은 글이다(「다음 · pnpm playwright test 실행을 기다려요」)", () => {
    const turn = askTurn(foldThread(bothAsking));
    expect(turn?.next && nextOf(turn.next)).toEqual({
      subject: "pnpm playwright test",
      mono: true,
      what: "실행을 기다려요",
    });
  });

  it("파일은 그 이름을, 계획은 대상 없이 기다린다", () => {
    const write = pendingOf({
      kind: "edit",
      title: "Write e2e/refund.spec.ts",
      content: [{ type: "diff", path: "/w/trees/api-server/e2e/refund.spec.ts", oldText: null, newText: "test()\n" }],
    });
    expect(nextOf(write)).toEqual({
      subject: "refund.spec.ts",
      mono: true,
      what: "작성을 기다려요",
    });
    const edit = pendingOf({
      kind: "edit",
      title: "Edit src/refund.ts",
      content: [{ type: "diff", path: "/w/src/refund.ts", oldText: "a\n", newText: "b\n" }],
    });
    expect(nextOf(edit)).toMatchObject({ subject: "refund.ts", what: "수정을 기다려요" });
    const plan = pendingOf({ kind: "switch_mode", title: "Ready to code?", rawInput: { plan: "1. 고친다" } });
    expect(nextOf(plan)).toMatchObject({ subject: null, what: "계획 승인을 기다려요" });
  });

  it("질문은 대상 없이 답을 기다린다(v1 티켓 26)", () => {
    const question: PendingQuestion = { card: "question", requestId: "0", toolCall: {}, questions: [] };
    expect(nextOf(question)).toEqual({ subject: null, mono: false, what: "질문의 답을 기다려요" });
  });

  it("Work 밖 Project 카드는 「web-app 고치기 답을 기다려요」다(v1 티켓 32)", () => {
    const outside: PendingProject = {
      card: "project",
      requestId: "o-1",
      project: "web-app",
      name: "web-app",
      reason: null,
      work: "refund-api",
      workProjects: ["api-server"],
    };
    expect(nextOf(outside)).toEqual({ subject: "web-app 고치기", mono: false, what: "답을 기다려요" });
  });

  it("Service 질문 카드는 「Service 답을 기다려요」다(03 티켓 08)", () => {
    const service: PendingService = {
      card: "service",
      requestId: "s-1",
      recommended: null,
      services: [],
      registered: 0,
    };
    expect(nextOf(service)).toEqual({ subject: "Service", mono: false, what: "답을 기다려요" });
  });

  it("Project 추가 카드는 「notes 추가 답을 기다려요」다(03 티켓 12)", () => {
    const adding: PendingProjectAdd = {
      card: "project-add",
      requestId: "p-1",
      look: "notGit",
      path: "~/MyProjects/notes",
      folder: "notes",
      root: null,
    };
    expect(nextOf(adding)).toEqual({ subject: "notes 추가", mono: false, what: "답을 기다려요" });
  });
});
