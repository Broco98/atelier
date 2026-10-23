import { describe, expect, it } from "vitest";
import { askTurn, nextOf } from "./asks";
import { answeringLine, foldThread, type PendingPermission } from "./fold";
import type { RecordLine } from "./types";

// 물음 차례(v1 티켓 25 · 구현 스펙 §9 카드 · 캔버스 Approval 보드 A안 「두 Agent가 함께 물을 때」) — 한 Thread에 걸린 물음이 여럿이면
// 먼저 온 것 하나만 입력창 자리에 서고, 「1 / 2」와 카드 아래 「다음 · …」 줄이 차례를 말한다. seam은 기록 줄을 접은 모델에서 차례를
// 읽는 순수 함수 `askTurn(foldThread(lines))`와 다음 줄의 글 `nextOf`다.

const at = (second: number) => `2026-10-23T14:15:${String(second).padStart(2, "0")}.000+09:00`;
const OPTIONS = [
  { optionId: "allow_once", name: "Yes", kind: "allow_once" },
  { optionId: "reject", name: "No", kind: "reject_once" },
];
const joined = (seq: number, handle: string, name: string): RecordLine => ({
  seq,
  at: at(seq),
  kind: "joined",
  who: handle,
  payload: { handle, name, avatar: null, from: "library" },
});
const sent = (seq: number, to: string, text: string): RecordLine => ({ seq, at: at(seq), kind: "sent", payload: { text, to } });
const toolCall = (seq: number, who: string, body: Record<string, unknown>): RecordLine => ({
  seq,
  at: at(seq),
  kind: "update",
  who,
  payload: { sessionId: who, update: { sessionUpdate: "tool_call", status: "pending", ...body } },
});
/** 물음 줄 — 요청 id는 Session마다 따로 센다(엔진 `answer_thread_permission`). 두 Agent의 첫 물음은 둘 다 「0」이다. */
const asked = (seq: number, who: string, call: Record<string, unknown>, requestId = "0"): RecordLine => ({
  seq,
  at: at(seq),
  kind: "permission",
  who,
  payload: {
    state: "asked",
    requestId,
    request: { toolCall: { toolCallId: call.toolCallId }, options: OPTIONS },
    toolCall: call,
    card: "command",
    policy: "매번 묻기",
  },
});
const answered = (seq: number, who: string, optionId: string, requestId = "0"): RecordLine => ({
  seq,
  at: at(seq),
  kind: "permission",
  who,
  payload: { state: "answered", requestId, optionId },
});

const migrate = {
  toolCallId: "toolu_host",
  kind: "execute",
  title: "pnpm prisma migrate dev --name partial_refund",
  rawInput: { command: "pnpm prisma migrate dev --name partial_refund" },
};
const playwright = {
  toolCallId: "toolu_tester",
  kind: "execute",
  title: "pnpm playwright test",
  rawInput: { command: "pnpm playwright test e2e/refund.spec.ts" },
};

/** 보드 「두 Agent가 함께 물을 때」 — Host는 마이그레이션을, 테스터는 e2e 테스트 실행을 기다린다. */
const bothAsking: RecordLine[] = [
  joined(1, "host", "Host"),
  sent(2, "host", "환불 API 버그 고쳐줘"),
  toolCall(3, "host", migrate),
  asked(4, "host", migrate),
  joined(5, "tester", "테스터"),
  sent(6, "tester", "@tester e2e 돌려 줘"),
  toolCall(7, "tester", playwright),
  asked(8, "tester", playwright),
];
const who = (turn: ReturnType<typeof askTurn>) => turn && [turn.current.who, turn.count, turn.next?.who ?? null];

describe("물음 차례", () => {
  it("물음이 하나면 그것만 서고 「1 / 2」도 다음 줄도 없다", () => {
    expect(who(askTurn(foldThread(bothAsking.slice(0, 4))))).toEqual(["host", null, null]);
  });

  it("두 Agent가 함께 물으면 먼저 온 것이 서고, 「1 / 2」와 다음 차례가 선다 — 요청 id가 같아도 둘이다", () => {
    expect(who(askTurn(foldThread(bothAsking)))).toEqual(["host", { at: 1, total: 2 }, "tester"]);
  });

  it("앞의 것에 답하면 다음 것이 「2 / 2」로 서고, 다 답하면 차례가 걷힌다 — 묶음은 물음이 다 닫힐 때 끝난다", () => {
    const first = [...bothAsking, answered(9, "host", "allow_once")];
    expect(who(askTurn(foldThread(first)))).toEqual(["tester", { at: 2, total: 2 }, null]);
    const both = [...first, answered(10, "tester", "reject")];
    expect(askTurn(foldThread(both))).toBeNull();
    // 다 닫힌 뒤에 온 물음은 새 묶음이다.
    const again = { ...migrate, toolCallId: "toolu_again" };
    expect(who(askTurn(foldThread([...both, toolCall(11, "host", again), asked(12, "host", again, "1")])))).toEqual([
      "host",
      null,
      null,
    ]);
  });

  it("답을 기다리는 사이 앞의 것이 답하고 새 물음이 오면 묶음의 수가 는다", () => {
    const again = { ...migrate, toolCallId: "toolu_again" };
    const lines = [...bothAsking, answered(9, "host", "allow_once"), toolCall(10, "host", again), asked(11, "host", again, "1")];
    expect(who(askTurn(foldThread(lines)))).toEqual(["tester", { at: 2, total: 3 }, "host"]);
  });

  it("승인을 기다리는 참여자는 「답하는 중」에 서지 않는다 — 그 턴의 머리줄이 「승인을 기다립니다」를 말한다", () => {
    // 테스터의 턴이 흐름 끝이라 Host의 도는 턴은 끝이 아닌 자리에 있다 — 묻지 않았다면 「Host가 답하는 중」이다.
    expect(answeringLine(foldThread(bothAsking.filter((line) => line.kind !== "permission")))).toEqual(["host"]);
    expect(answeringLine(foldThread(bothAsking))).toBeNull();
  });

  it("물은 참여자의 Session이 사라지면 그 물음은 차례에서 빠진다 — 닫힌 물음으로 센다", () => {
    const died: RecordLine = { seq: 9, at: at(9), kind: "session", who: "host", payload: { state: "died", reason: "끝났어요" } };
    expect(who(askTurn(foldThread([...bothAsking, died])))).toEqual(["tester", { at: 2, total: 2 }, null]);
  });
});

describe("카드 아래 다음 줄", () => {
  const pendingOf = (toolCall: Record<string, unknown>): PendingPermission => ({
    requestId: "0",
    who: "tester",
    options: OPTIONS,
    toolCall,
    tool: null,
    planReview: toolCall.kind === "switch_mode",
    card: null,
    policy: null,
    grant: [],
  });

  it("다음 차례는 누가 무엇을 기다리는지다 — 대상은 작업 로그의 그 도구 줄과 같은 글이다(보드 「다음 · 테스터가 pnpm playwright test 실행을 기다려요」)", () => {
    const turn = askTurn(foldThread(bothAsking));
    expect(turn?.next && nextOf(turn.next, "테스터")).toEqual({
      name: "테스터",
      particle: "가",
      subject: "pnpm playwright test",
      mono: true,
      what: "실행을 기다려요",
    });
  });

  it("파일은 그 이름을, 계획은 대상 없이 기다린다 — 이름에 받침이 있으면 「이」다", () => {
    const write = pendingOf({
      kind: "edit",
      title: "Write e2e/refund.spec.ts",
      content: [{ type: "diff", path: "/w/trees/api-server/e2e/refund.spec.ts", oldText: null, newText: "test()\n" }],
    });
    expect(nextOf(write, "테스터 봇")).toEqual({
      name: "테스터 봇",
      particle: "이",
      subject: "refund.spec.ts",
      mono: true,
      what: "작성을 기다려요",
    });
    const edit = pendingOf({
      kind: "edit",
      title: "Edit src/refund.ts",
      content: [{ type: "diff", path: "/w/src/refund.ts", oldText: "a\n", newText: "b\n" }],
    });
    expect(nextOf(edit, "Host")).toMatchObject({ particle: "가", subject: "refund.ts", what: "수정을 기다려요" });
    const plan = pendingOf({ kind: "switch_mode", title: "Ready to code?", rawInput: { plan: "1. 고친다" } });
    expect(nextOf(plan, "Host")).toMatchObject({ subject: null, what: "계획 승인을 기다려요" });
  });
});
