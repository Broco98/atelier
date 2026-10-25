import { describe, expect, it } from "vitest";
import { autoAllowReason, buttonKey, cardChoices, cardKey, decisionText, describeApproval, fieldLabel, placeOf, skipHint } from "./approval";
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
  it("명령 카드는 머리 한 줄(누가 · 무슨 일 · 어떤 규칙) · 물음 · 어디서 한 줄 · 명령이다(02 §10 · Screen-Live 단계 4)", () => {
    const view = describeApproval(request(migrate, { policy: "스키마를 바꾸기 전에 묻기" }), "Host", "api-server · fix/refund-api worktree에서 실행");
    expect(view).toMatchObject({
      kind: "command",
      head: "Host · 명령 실행 · 「스키마를 바꾸기 전에 묻기」",
      title: "이 명령을 실행해도 될까요?",
      command: "pnpm prisma migrate dev --name partial_refund",
      where: "api-server · fix/refund-api worktree에서 실행 · DB 스키마가 바뀝니다",
      diff: null,
    });
  });

  it("규칙 이름이 없으면(판정 없이 물은 옛 기록) 머리에서 그 조각을 뺀다", () => {
    expect(describeApproval(request(migrate, { policy: null }), "Host", null).head).toBe("Host · 명령 실행");
  });

  it("카드의 이름은 누가 묻는지까지 든 물음이다 — 보이는 물음은 머리가 Agent를 말하니 이름을 빼고 선다", () => {
    const view = describeApproval(request(migrate), "테스터", null);
    expect([view.label, view.title]).toEqual(["테스터가 이 명령을 실행해도 될까요?", "이 명령을 실행해도 될까요?"]);
  });

  it("계획 넘어가기 카드는 계획대로 구현해도 되는지 묻는다(v1 티켓 26) — 계획 본문은 흐름의 계획 카드가 든다", () => {
    const view = describeApproval(request({ kind: "switch_mode", rawInput: { plan: "1. 고친다" } }, { card: "plan", policy: "계획만" }), "Host", null);
    expect(view).toMatchObject({
      kind: "plan",
      head: "Host · 계획 구현 · 「계획만」",
      title: "이 계획대로 구현해도 될까요?",
      command: null,
      subject: null,
    });
  });

  it("파일 카드는 파일 · +/− · 바뀐 줄 몇 줄이다", () => {
    const view = describeApproval(request(schemaEdit, { card: "edit" }), "리뷰어", null);
    expect([view.head, view.title, view.label]).toEqual([
      "리뷰어 · 파일 고치기 · 「매번 묻기」",
      "이 파일을 고쳐도 될까요?",
      "리뷰어가 이 파일을 고쳐도 될까요?",
    ]);
    expect(view.diff && [view.diff.path, view.diff.added, view.diff.deleted]).toEqual([
      "/w/refund/trees/api-server/prisma/schema.prisma",
      2,
      0,
    ]);
    expect(view.where).toBeNull();
  });

  it("그 밖의 도구는 무엇을 다루는지로 묻는다 — 이름에 받침이 있으면 「이」다", () => {
    const fetch = describeApproval(request({ kind: "fetch", rawInput: { url: "https://example.com" } }), "테스터 봇", null);
    expect([fetch.head, fetch.label, fetch.subject]).toEqual([
      "테스터 봇 · 주소 가져오기 · 「매번 묻기」",
      "테스터 봇이 이 주소를 가져와도 될까요?",
      "https://example.com",
    ]);
    const mcp = describeApproval(
      request({ kind: "other", title: "mcp__linear__create_issue", _meta: { claudeCode: { toolName: "mcp__linear__create_issue" } } }),
      "Host",
      null,
    );
    expect([mcp.head, mcp.title, mcp.subject]).toEqual(["Host · MCP 도구 쓰기 · 「매번 묻기」", "이 MCP 도구를 써도 될까요?", "linear · create_issue"]);
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

describe("선택지 — 승인은 단추 줄, 계획은 번호 줄", () => {
  // 승인 카드의 단추 줄(02 §10 · Screen-Live 단계 4) — 왼쪽에서 오른쪽으로 「아니요, 다르게」(esc) · 「… 늘 허용」 · 맨 오른쪽 「이번만 허용」(↵).
  const row = (request: PendingPermission, scope: "work" | "thread") => {
    const { layout, choices } = cardChoices(request, scope);
    return { layout, choices: choices.map((choice) => [choice.label, choice.option, choice.remember, choice.opensField, choice.key]) };
  };

  it("아니요, 다르게 · 이 Work에서 늘 허용 · 이번만 허용 — 왼쪽에서 오른쪽 차례이고, ↵는 이번만 허용, esc는 입력칸을 여는 아니요다", () => {
    expect(row(request(migrate, { grant: ["Bash(pnpm prisma *)"] }), "work")).toEqual({
      layout: "buttons",
      choices: [
        ["아니요, 다르게", "reject", false, true, "escape"],
        ["이 Work에서 늘 허용", "allow_once", true, false, null],
        ["이번만 허용", "allow_once", false, false, "enter"],
      ],
    });
  });

  it("늘 허용 글자는 세 갈래다 — Work 없는 Thread면 「이 Thread에서」, 편집 허락이면 「편집은」", () => {
    const always = (extra: Partial<PendingPermission>, scope: "work" | "thread") =>
      cardChoices(request(migrate, extra), scope).choices.find((choice) => choice.remember)?.label;
    expect(always({ grant: ["Bash(pnpm prisma *)"] }, "work")).toBe("이 Work에서 늘 허용");
    expect(always({ grant: ["Bash(pnpm prisma *)"] }, "thread")).toBe("이 Thread에서 늘 허용");
    expect(always({ card: "edit", grant: ["edit"] }, "work")).toBe("이 Work에서 편집은 늘 허용");
    expect(always({ card: "edit", grant: ["edit"] }, "thread")).toBe("이 Thread에서 편집은 늘 허용");
  });

  it("줄 허락이 없으면(ask_before · 그 밖의 도구) 늘 허용 단추가 없다", () => {
    expect(row(request(migrate), "work").choices.map(([label]) => label)).toEqual(["아니요, 다르게", "이번만 허용"]);
  });

  it("계획 넘어가기는 번호 줄 그대로 — 계획대로 구현 · 계획 다시 쓰기이고(v1 티켓 26) 다시 쓰기는 고칠 점 입력칸을 연다. 허락 · 거부 갈래가 없으면 엔진의 선택지 그대로다", () => {
    const plan = request({ kind: "switch_mode" }, {
      card: "plan",
      options: [
        { optionId: "implement_plan", name: "Yes, implement this plan", kind: "allow_always" },
        { optionId: "revise_plan", name: "No, keep planning", kind: "reject_once" },
      ],
    });
    expect(row(plan, "work")).toEqual({
      layout: "rows",
      choices: [
        ["계획대로 구현", "implement_plan", false, false, null],
        ["계획 다시 쓰기", "revise_plan", false, true, null],
      ],
    });
    const odd = request(migrate, { options: [{ optionId: "go", name: "Go ahead", kind: "allow_once" }] });
    expect(row(odd, "work")).toEqual({ layout: "rows", choices: [["Go ahead", "go", false, false, null]] });
  });
});

describe("고르기 전에 할 말(v1 티켓 25)", () => {
  it("카드 안 입력칸에 말을 쓰면 보내면 무엇이 건너뛰어지고 누구에게 가는지 한 줄로 말한다(스토리 83)", () => {
    expect(skipHint("command", "Host")).toBe("보내면 이 명령은 건너뛰고 Host에게 말을 전해요");
    expect(skipHint("edit", "리뷰어")).toBe("보내면 이 편집은 건너뛰고 리뷰어에게 말을 전해요");
    expect(skipHint("other", "테스터")).toBe("보내면 이 요청은 건너뛰고 테스터에게 말을 전해요");
  });

  it("계획 다시 쓰기의 입력칸은 고칠 점을 받고, 보내면 그 말대로 계획을 다시 쓴다(v1 티켓 26)", () => {
    expect(fieldLabel("plan", "Host")).toBe("Host에게 고칠 점 알려 주기");
    expect(fieldLabel("command", "테스터")).toBe("테스터에게 다르게 할 방법 알려 주기");
    expect(skipHint("plan", "Host")).toBe("보내면 Host가 이 말대로 계획을 다시 써요");
    expect(skipHint("plan", "테스터 봇")).toBe("보내면 테스터 봇이 이 말대로 계획을 다시 써요");
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

  describe("승인 카드의 단추 줄 — ↵ · esc만(S25)", () => {
    const { choices } = cardChoices(request(migrate, { grant: ["Bash(pnpm prisma *)"] }), "work");
    const label = (at: number | null) => (at === null ? null : choices[at]?.label);

    it("↵는 이번만 허용, esc는 아니요, 다르게다", () => {
      expect(label(buttonKey(press("Enter"), choices, null))).toBe("이번만 허용");
      expect(label(buttonKey(press("NumpadEnter"), choices, null))).toBe("이번만 허용");
      expect(label(buttonKey(press("Escape"), choices, null))).toBe("아니요, 다르게");
    });

    it("단추에 포커스가 있으면 ↵는 그 단추다 — Tab으로 옮겨 간 손이 고른 것", () => {
      expect(label(buttonKey(press("Enter"), choices, 1))).toBe("이 Work에서 늘 허용");
      expect(label(buttonKey(press("Escape"), choices, 1))).toBe("아니요, 다르게");
    });

    it("숫자 키 · ↑↓는 없다 — 수식키가 붙은 키도 고르지 않는다", () => {
      expect(buttonKey(press("Digit1"), choices, null)).toBeNull();
      expect(buttonKey(press("Numpad2"), choices, null)).toBeNull();
      expect(buttonKey(press("ArrowDown"), choices, null)).toBeNull();
      expect(buttonKey(press("Enter", { metaKey: true }), choices, null)).toBeNull();
      expect(buttonKey(press("Escape", { shiftKey: true }), choices, null)).toBeNull();
    });
  });

  it("번호 줄(계획 · Project 카드)은 숫자는 그 선택지, Enter는 켜진 줄(처음엔 첫째), Esc는 마지막이다", () => {
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

  it("고른 것을 한 줄로 — 늘 허용의 꼬리는 단추 글과 같다(「명령 실행을 승인함 · 이 Work에서 늘 허용」)", () => {
    expect(decisionText(decision(migrate))).toBe("명령 실행을 승인함");
    expect(decisionText(decision(migrate, { granted: { rules: ["Bash(pnpm prisma *)"], work: "refund-api" } }))).toBe(
      "명령 실행을 승인함 · 이 Work에서 늘 허용",
    );
    expect(decisionText(decision(schemaEdit, { granted: { rules: ["edit"], work: null } }))).toBe(
      "파일 고치기를 승인함 · 이 Thread에서 편집은 늘 허용",
    );
    expect(decisionText(decision(migrate, { allowed: false, words: "마이그레이션 없이 할 수는 없어?" }))).toBe("명령 실행을 거부함");
    expect(decisionText(decision({ kind: "search", title: "refund" }))).toBe("검색을 승인함");
    expect(decisionText(decision({ kind: "other", title: "mcp__linear__create_issue", _meta: { claudeCode: { toolName: "mcp__linear__create_issue" } } }))).toBe(
      "MCP 도구 쓰기를 승인함",
    );
    expect(decisionText(decision({ kind: "switch_mode" }, { planReview: true }))).toBe("계획대로 구현하기로 함");
    expect(decisionText(decision({ kind: "switch_mode" }, { planReview: true, allowed: false }))).toBe("계획을 다시 쓰기로 함");
  });
});

// 02 코드 리뷰 A1 — **같은 허락을 화면에서 한 말로 부른다.** 승인 카드의 「이 Work에서 늘 허용」으로 준 허락이 다음 요청을 묻지 않고 넘기면
// 방패 줄의 까닭이 선다. 엔진은 그 까닭을 옛 이름(「이 Work에서는 다시 묻지 않기」)으로 기록에 적는다 — 엔진 · 기록은 이 판이 바꾸지 않는다
// (02 구현 스펙 §13). 그래서 화면이 그 까닭을 카드의 말로 읽는다. 지난 기록도 같다. 다른 까닭(물어보는 정도 · `tools.cli`)은 그대로다.
describe("방패 줄의 까닭", () => {
  it("「늘 허용」으로 준 허락의 까닭은 카드의 말이다 — 지난 기록의 옛 이름도", () => {
    expect(autoAllowReason("이 Work에서는 다시 묻지 않기")).toBe("이 Work에서 늘 허용");
    expect(autoAllowReason("이 Thread에서는 다시 묻지 않기")).toBe("이 Thread에서 늘 허용");
  });

  it("물어보는 정도 · `tools.cli`의 까닭은 그대로다", () => {
    expect(autoAllowReason("편집은 허용")).toBe("편집은 허용");
    expect(autoAllowReason("알아서")).toBe("알아서");
    expect(autoAllowReason("「gh」 명령은 묻지 않기")).toBe("「gh」 명령은 묻지 않기");
  });
});
