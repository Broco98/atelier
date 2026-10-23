import { describe, expect, it } from "vitest";
import { cardChoices, cardKey, decisionText, describeApproval, placeOf } from "./approval";
import type { DecisionEntry, PendingPermission } from "./fold";

// 승인 카드(v1 티켓 24 · 캔버스 Cards · Approval 보드 A안) — 걸린 물음을 카드의 값(제목 · Policy · 명령이나 diff · 실행할 자리)과 선택지
// 셋으로, 키 하나를 고르기로, 사람이 고른 것을 결정 줄의 글로 옮긴다. seam은 `approval.ts`의 순수 함수들이고, 그리는 쪽
// (`ApprovalCard.tsx`)은 여기 나온 값만 그린다. 문구의 정본은 보드의 글자다.

const OPTIONS = [
  { optionId: "allow_once", name: "Yes", kind: "allow_once" },
  { optionId: "reject", name: "No, and tell Claude what to do differently", kind: "reject_once" },
];

const request = (toolCall: Record<string, unknown>, extra: Partial<PendingPermission> = {}): PendingPermission => ({
  requestId: "r1",
  who: "host",
  options: OPTIONS,
  toolCall,
  tool: null,
  planReview: toolCall.kind === "switch_mode",
  card: "command",
  policy: "매번 묻기",
  grant: [],
  ...extra,
});

const migrate = {
  toolCallId: "t1",
  kind: "execute",
  title: "pnpm prisma migrate dev --name partial_refund",
  rawInput: { command: "pnpm prisma migrate dev --name partial_refund", description: "DB 스키마가 바뀝니다" },
};

const schemaEdit = {
  toolCallId: "t2",
  kind: "edit",
  title: "Edit prisma/schema.prisma",
  content: [
    {
      type: "diff",
      path: "/w/refund/trees/api-server/prisma/schema.prisma",
      oldText: "model Refund {\n}\n",
      newText: "model Refund {\n  refundedAmount Decimal @default(0)\n  idempotencyKey String  @unique\n}\n",
    },
  ],
};

describe("카드의 값", () => {
  it("명령 카드는 얼굴 옆의 물음 · Policy 이름 · 명령 · 실행할 자리와 영향 한 줄이다", () => {
    const view = describeApproval(request(migrate, { policy: "「prisma migrate」 실행 전에 묻기" }), "Host", "api-server · fix/refund-api worktree에서 실행");
    expect(view).toMatchObject({
      kind: "command",
      title: "Host가 이 명령을 실행해도 될까요?",
      policy: "「prisma migrate」 실행 전에 묻기",
      command: "pnpm prisma migrate dev --name partial_refund",
      where: "api-server · fix/refund-api worktree에서 실행 · DB 스키마가 바뀝니다",
      diff: null,
    });
  });

  it("파일 카드는 파일 · +/− · 바뀐 줄 몇 줄이다", () => {
    const view = describeApproval(request(schemaEdit, { card: "edit" }), "리뷰어", null);
    expect(view.title).toBe("리뷰어가 이 파일을 고쳐도 될까요?");
    expect(view.diff && [view.diff.path, view.diff.added, view.diff.deleted]).toEqual([
      "/w/refund/trees/api-server/prisma/schema.prisma",
      2,
      0,
    ]);
    expect(view.where).toBeNull();
  });

  it("그 밖의 도구는 무엇을 다루는지로 묻는다 — 이름에 받침이 있으면 「이」다", () => {
    const fetch = describeApproval(request({ kind: "fetch", rawInput: { url: "https://example.com" } }), "테스터 봇", null);
    expect([fetch.title, fetch.subject]).toEqual(["테스터 봇이 이 주소를 가져와도 될까요?", "https://example.com"]);
    const mcp = describeApproval(
      request({ kind: "other", title: "mcp__linear__create_issue", _meta: { claudeCode: { toolName: "mcp__linear__create_issue" } } }),
      "Host",
      null,
    );
    expect([mcp.title, mcp.subject]).toEqual(["Host가 이 MCP 도구를 써도 될까요?", "linear · create_issue"]);
  });

  it("실행할 자리는 Session의 작업 폴더를 Work의 자리들과 견줘 읽는다 — worktree면 Project와 브랜치다", () => {
    const root = "/Users/u/.atelier/works/refund-api";
    const work = {
      branch: "fix/refund-api",
      specDir: `${root}/spec`,
      worktrees: [
        { project: "api-server", path: `${root}/w/api-server` },
        { project: "web-app", path: `${root}/w/web-app` },
      ],
    };
    expect(placeOf(`${root}/w/api-server/`, work)).toBe("api-server · fix/refund-api worktree에서 실행");
    expect(placeOf(`${root}/w`, work)).toBe("Work의 worktree 폴더에서 실행");
    expect(placeOf(`${root}/spec`, work)).toBe("spec 폴더에서 실행");
    expect(placeOf("/repos/elsewhere", work)).toBe("elsewhere 폴더에서 실행");
    // Work 없는 Thread의 Session은 Thread 폴더에서 일한다(S11).
    expect(placeOf("/Users/u/.atelier/threads/20261023-101010", null)).toBe("Thread 폴더에서 실행");
    expect(placeOf(null, work)).toBeNull();
  });
});

describe("선택지 셋", () => {
  it("예 · 예, 이 Work에서는 다시 묻지 않기 · 아니요, 다르게 해 주세요 — 셋째는 입력칸을 연다", () => {
    const choices = cardChoices(request(migrate, { grant: ["Bash(pnpm prisma *)"] }), "work");
    expect(choices.map((choice) => [choice.label, choice.option, choice.remember, choice.opensField])).toEqual([
      ["예", "allow_once", false, false],
      ["예, 이 Work에서는 다시 묻지 않기", "allow_once", true, false],
      ["아니요, 다르게 해 주세요", "reject", false, true],
    ]);
  });

  it("Work가 없으면 「이 Thread에서는」이고, 파일이면 「편집을」 다시 묻지 않는다", () => {
    const labels = cardChoices(request(schemaEdit, { card: "edit", grant: ["edit"] }), "thread").map((choice) => choice.label);
    expect(labels[1]).toBe("예, 이 Thread에서는 편집을 다시 묻지 않기");
  });

  it("줄 허락이 없으면(ask_before · 그 밖의 도구) 다시 묻지 않기가 서지 않는다", () => {
    expect(cardChoices(request(migrate), "work").map((choice) => choice.label)).toEqual(["예", "아니요, 다르게 해 주세요"]);
  });

  it("계획 승인은 구현 · 다시 짜기이고, 허락 · 거부 갈래가 없으면 엔진의 선택지 그대로다", () => {
    const plan = request({ kind: "switch_mode" }, {
      card: "plan",
      options: [
        { optionId: "implement_plan", name: "Yes, implement this plan", kind: "allow_always" },
        { optionId: "revise_plan", name: "No, keep planning", kind: "reject_once" },
      ],
    });
    expect(cardChoices(plan, "work").map((choice) => [choice.label, choice.option, choice.opensField])).toEqual([
      ["구현", "implement_plan", false],
      ["다시 짜기", "revise_plan", false],
    ]);
    const odd = request(migrate, { options: [{ optionId: "go", name: "Go ahead", kind: "allow_once" }] });
    expect(cardChoices(odd, "work").map((choice) => choice.label)).toEqual(["Go ahead"]);
  });
});

describe("키보드로 고른다", () => {
  const press = (code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("숫자는 그 선택지, Enter는 켜진 줄(처음엔 첫째), Esc는 마지막이다", () => {
    expect(cardKey(press("Digit2"), 3, 0)).toEqual({ pick: 1 });
    expect(cardKey(press("Numpad3"), 3, 0)).toEqual({ pick: 2 });
    expect(cardKey(press("Enter"), 3, 0)).toEqual({ pick: 0 });
    expect(cardKey(press("NumpadEnter"), 3, 1)).toEqual({ pick: 1 });
    expect(cardKey(press("Escape"), 3, 0)).toEqual({ pick: 2 });
  });

  it("↑↓는 켜진 줄을 옮기고 끝에서 돈다", () => {
    expect(cardKey(press("ArrowDown"), 3, 2)).toEqual({ point: 0 });
    expect(cardKey(press("ArrowUp"), 3, 0)).toEqual({ point: 2 });
  });

  it("없는 번호 · 수식키가 붙은 키(⌘1은 탭 옮기기다)는 고르지 않는다", () => {
    expect(cardKey(press("Digit3"), 2, 0)).toBeNull();
    expect(cardKey(press("Digit0"), 3, 0)).toBeNull();
    expect(cardKey(press("Digit1", { metaKey: true }), 3, 0)).toBeNull();
    expect(cardKey(press("Enter", { shiftKey: true }), 3, 0)).toBeNull();
    expect(cardKey(press("KeyY"), 3, 0)).toBeNull();
  });
});

describe("결정 줄", () => {
  const decision = (toolCall: Record<string, unknown>, extra: Partial<DecisionEntry> = {}): DecisionEntry => ({
    kind: "decision",
    key: "d1",
    allowed: true,
    granted: null,
    words: null,
    toolCall,
    planReview: false,
    ...extra,
  });

  it("고른 것을 한 줄로 — 「명령 실행을 승인함 · 이 Work에서는 다시 묻지 않음」", () => {
    expect(decisionText(decision(migrate))).toBe("명령 실행을 승인함");
    expect(decisionText(decision(migrate, { granted: { rules: ["Bash(pnpm prisma *)"], work: "refund-api" } }))).toBe(
      "명령 실행을 승인함 · 이 Work에서는 다시 묻지 않음",
    );
    expect(decisionText(decision(schemaEdit, { granted: { rules: ["edit"], work: null } }))).toBe(
      "파일 고치기를 승인함 · 이 Thread에서는 편집을 다시 묻지 않음",
    );
    expect(decisionText(decision(migrate, { allowed: false, words: "마이그레이션 없이 할 수는 없어?" }))).toBe("명령 실행을 거부함");
    expect(decisionText(decision({ kind: "switch_mode" }, { planReview: true }))).toBe("계획을 승인함");
  });
});
