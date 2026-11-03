import { describe, expect, it } from "vitest";
import { autoAllowReason, buttonKey, cardChoices, cardKey, decisionText, describeApproval, fieldLabel, skipHint } from "./approval";
import type { DecisionEntry, PendingPermission } from "./fold";
import type { Runtime } from "./types";

// 승인 카드(v1 티켓 24 · restart 02b-5 · 시안 Cards 보드 「승인 카드」) — 걸린 물음을 카드의 값(갈래 · 물음 · 명령이나 diff · 아래 한 줄)과 선택지로,
// 키 하나를 고르기로, 사람이 고른 것을 결정 줄의 글로 옮긴다. seam은 `approval.ts`의 순수 함수들이고, 그리는 쪽(`ApprovalCard.tsx`)은 여기 나온 값만
// 그린다. 문구의 정본은 보드의 글자다.

const OPTIONS = [
  { optionId: "allow_once", name: "Yes", kind: "allow_once" },
  { optionId: "reject", name: "No, and tell Claude what to do differently", kind: "reject_once" },
];

const request = (toolCall: Record<string, unknown>, extra: Partial<PendingPermission> = {}): PendingPermission => ({
  requestId: "r1",
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

// 카드의 값(Cards 보드 「승인 카드 — 입력창 자리에 선다」 여섯 칸 · restart 02b-5) — 위 칸은 갈래(글리프 · 이름) · 물음 · 명령 상자나 줄어든 diff · 아래
// 한 줄(`.why` — 사유나 대상)이다. 물음은 누가 묻는지까지 든 한 문장이고 카드의 이름도 그것이다.
describe("카드의 값", () => {
  const CWD = "/w/refund/trees/api-server";

  it("명령 카드는 「터미널」 · 「…가 이 명령을 실행하도록 허용할까요?」 · 명령 · 「사유 · …」다(보드 「명령」)", () => {
    expect(describeApproval(request(migrate), "Claude Code", CWD)).toMatchObject({
      kind: "command",
      badge: { glyph: "execute", label: "터미널" },
      title: "Claude Code가 이 명령을 실행하도록 허용할까요?",
      command: "pnpm prisma migrate dev --name partial_refund",
      diff: null,
      why: "사유 · DB 스키마가 바뀝니다",
      details: null,
    });
    // Runtime이 명령에 단 설명이 없으면 아래 한 줄이 서지 않는다.
    expect(describeApproval(request({ ...migrate, rawInput: { command: "ls" } }), "Codex", CWD).why).toBeNull();
  });

  it("파일 카드는 「파일 편집」 · 줄어든 diff · 아래 한 줄은 작업 폴더에서 본 파일 자리다(보드 「파일 편집」 · Thread 보드 승인 카드)", () => {
    const view = describeApproval(request(schemaEdit, { card: "edit" }), "Claude Code", CWD);
    expect([view.badge, view.title, view.why]).toEqual([
      { glyph: "edit", label: "파일 편집" },
      "Claude Code가 이 파일을 편집하도록 허용할까요?",
      "prisma/schema.prisma",
    ]);
    expect(view.diff && [view.diff.path, view.diff.added, view.diff.deleted]).toEqual(["/w/refund/trees/api-server/prisma/schema.prisma", 2, 0]);
    // 내용을 싣지 않은 편집(Codex `apply_patch` 요청은 `locations`만 싣는다)은 diff 없이 파일 자리만이다.
    const located = describeApproval(
      request({ kind: "edit", title: "Edit files", locations: [{ path: "/elsewhere/edit.txt" }] }, { card: "edit" }),
      "Codex",
      CWD,
    );
    expect([located.title, located.diff, located.why]).toEqual(["Codex가 이 파일을 편집하도록 허용할까요?", null, "/elsewhere/edit.txt"]);
    const removal = describeApproval(request({ kind: "delete", rawInput: { file_path: `${CWD}/old.ts` } }), "Claude Code", CWD);
    expect([removal.badge.label, removal.title, removal.why]).toEqual(["파일 삭제", "Claude Code가 이 파일을 지우도록 허용할까요?", "old.ts"]);
  });

  it("주소를 가져오는 카드는 「인터넷 액세스」 · 「…가 호스트에 연결하도록 허용할까요?」다(보드 「네트워크 · 샌드박스 밖」) — 이름에 받침이 있으면 「이」다", () => {
    const view = describeApproval(request({ kind: "fetch", rawInput: { url: "https://registry.npmjs.org/react" } }), "테스터 봇", CWD);
    expect([view.badge, view.title, view.why]).toEqual([
      { glyph: "web", label: "인터넷 액세스" },
      "테스터 봇이 registry.npmjs.org에 연결하도록 허용할까요?",
      "https://registry.npmjs.org/react",
    ]);
  });

  it("MCP 카드는 「MCP」 · 「서버에 도구 실행을 허용할까요?」이고, 「세부 정보 보기」가 펼칠 도구 입력을 든다(보드 「MCP 도구」)", () => {
    const claude = describeApproval(
      request({
        kind: "other",
        title: "mcp__linear__create_issue",
        rawInput: { title: "환불 버그" },
        _meta: { claudeCode: { toolName: "mcp__linear__create_issue" } },
      }),
      "Claude Code",
      CWD,
    );
    expect([claude.badge, claude.title, claude.why, claude.details]).toEqual([
      { glyph: "mcp", label: "MCP" },
      "linear에 create_issue 도구 실행을 허용할까요?",
      null,
      { title: "환불 버그" },
    ]);
    const codex = describeApproval(
      request({ kind: "execute", title: "mcp.github.delete_file", rawInput: { server: "github", tool: "delete_file", arguments: { path: "a.md" } } }),
      "Codex",
      CWD,
    );
    expect([codex.title, codex.command, codex.details]).toEqual(["github에 delete_file 도구 실행을 허용할까요?", null, { path: "a.md" }]);
  });

  it("계획 넘어가기 카드는 「계획」 · 「이 계획대로 진행할까요?」다(보드 「계획 승인」) — 계획 본문은 흐름의 계획 카드가 든다", () => {
    const view = describeApproval(request({ kind: "switch_mode", rawInput: { plan: "1. 고친다" } }, { card: "plan", policy: "계획" }), "Claude Code", CWD);
    expect(view).toMatchObject({
      kind: "plan",
      badge: { glyph: "plan", label: "계획" },
      title: "이 계획대로 진행할까요?",
      command: null,
      diff: null,
      why: null,
    });
  });

  it("그 밖의 도구는 무엇을 다루는지가 아래 한 줄이다 — 읽기 · 검색 · 모르는 도구", () => {
    const read = describeApproval(request({ kind: "read", rawInput: { file_path: "/etc/hosts" } }), "Claude Code", CWD);
    expect([read.badge, read.title, read.why]).toEqual([{ glyph: "read", label: "파일 읽기" }, "Claude Code가 이 파일을 읽도록 허용할까요?", "/etc/hosts"]);
    const search = describeApproval(request({ kind: "search", title: "refund" }), "Claude Code", CWD);
    expect([search.badge, search.title, search.why]).toEqual([{ glyph: "search", label: "검색" }, "Claude Code가 이렇게 찾아보도록 허용할까요?", "refund"]);
    const other = describeApproval(request({ kind: "other", title: "custom_tool" }), "Claude Code", CWD);
    expect([other.badge, other.title, other.why]).toEqual([{ glyph: "other", label: "도구" }, "Claude Code가 이 도구를 쓰도록 허용할까요?", "custom_tool"]);
  });
});

/** 카드의 선택지를 견줄 꼴 — (글, 고를 선택지, 허락 문구인가, 입력칸을 여나, 글쇠, 단추 모양). */
const row = (request: PendingPermission, scope: "work" | "thread", runtime: Runtime = "claude-code") => {
  const { layout, choices } = cardChoices(request, scope, runtime);
  return { layout, choices: choices.map((choice) => [choice.label, choice.option, choice.remember, choice.opensField, choice.key, choice.tone]) };
};

describe("선택지 — 단추 줄(Cards 보드 「승인 카드」)", () => {
  // 승인 카드의 단추 줄(Cards 보드 `.acts` · restart 02b-5) — 왼쪽에 허락 문구(`.ra-opt`), 오른쪽 끝에 「거부」(`.ra-no` · esc) · 「한 번만 허용」(`.ra-yes` · ↵).
  // 배열 차례가 곧 왼쪽에서 오른쪽이다.

  it("비슷한 명령 허용 · 거부 · 한 번만 허용 — 왼쪽에서 오른쪽 차례이고, ↵는 한 번만 허용, esc는 입력칸을 여는 거부다", () => {
    expect(row(request(migrate, { grant: ["Bash(pnpm prisma *)"] }), "work")).toEqual({
      layout: "buttons",
      choices: [
        ["비슷한 명령 허용", "allow_once", true, false, null, "opt"],
        ["거부", "reject", false, true, "escape", "no"],
        ["한 번만 허용", "allow_once", false, false, "enter", "yes"],
      ],
    });
  });

  it("명령 허락은 「비슷한 명령 허용」이고, 편집 허락은 작업공간과 밖에서 갈린다", () => {
    const always = (extra: Partial<PendingPermission>, scope: "work" | "thread") =>
      cardChoices(request(migrate, extra), scope, "claude-code").choices.find((choice) => choice.remember)?.label;
    expect(always({ grant: ["Bash(pnpm prisma *)"] }, "work")).toBe("비슷한 명령 허용");
    expect(always({ grant: ["Bash(pnpm prisma *)"] }, "thread")).toBe("비슷한 명령 허용");
    expect(always({ card: "edit", grant: ["edit"] }, "work")).toBe("이 작업공간의 모든 편집 허용");
    expect(always({ card: "edit", grant: ["edit"] }, "thread")).toBe("이 채팅의 모든 편집 허용");
  });

  it("줄 허락이 없으면(앱 경계 · 그 밖의 도구) 허락 단추가 없다", () => {
    expect(row(request(migrate), "work").choices.map(([label]) => label)).toEqual(["거부", "한 번만 허용"]);
  });

  it("계획 넘어가기는 「다시 짜기」 · 「구현」 단추다(Cards 보드 「계획 승인」 · 스토리 65) — 다시 짜기는 고칠 점 입력칸을 열고, esc가 그것이지만 글쇠는 그리지 않는다", () => {
    const plan = request({ kind: "switch_mode" }, {
      card: "plan",
      options: [
        { optionId: "implement_plan", name: "Yes, implement this plan", kind: "allow_once" },
        { optionId: "revise_plan", name: "No, and tell Claude what to do differently", kind: "reject_once" },
      ],
    });
    expect(row(plan, "work")).toEqual({
      layout: "buttons",
      choices: [
        ["다시 짜기", "revise_plan", false, true, "escape", "no"],
        ["구현", "implement_plan", false, false, "enter", "yes"],
      ],
    });
    // 보드의 「다시 짜기」에는 글쇠가 없다 — 한때 번호 줄의 Esc(마지막 줄)가 고칠 점 칸을 열던 것은 그대로다.
    expect(cardChoices(plan, "work", "claude-code").choices.map((choice) => choice.keycap)).toEqual([false, true]);
  });

  it("허락 · 거부 갈래를 고를 수 없으면 엔진의 선택지 그대로 번호 줄이다", () => {
    const odd = request(migrate, { options: [{ optionId: "go", name: "Go ahead", kind: "allow_once" }] });
    expect(row(odd, "work")).toEqual({ layout: "rows", choices: [["Go ahead", "go", false, false, null, "opt"]] });
  });
});

// Codex의 선택지(01c-7 · 스펙 「01c — Codex」 권한 판정) — Codex가 보낸 것을 그대로 그린다. 선택지는 codex-acp 2.2.2의 녹음 그대로다(`mcp` · `edit`).
// Codex 채팅의 물음에는 줄 허락(`grant`)이 없다 — 판정이 Claude의 「다시 묻지 않기」를 읽지 않는다.
describe("Codex의 선택지", () => {
  const mcpCall = { toolCallId: "exec-1", kind: "execute", status: "pending", title: "mcp.github.delete_file", rawInput: { server: "github", tool: "delete_file", arguments: {} } };
  const mcp = request(mcpCall, {
    policy: null,
    options: [
      { optionId: "allow_once", name: "Allow", kind: "allow_once" },
      { optionId: "allow_session", name: "Allow for this session", kind: "allow_always" },
      { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
      { optionId: "cancel", name: "Cancel", kind: "reject_once" },
    ],
  });

  it("allow_always는 왼쪽 단추로 Codex가 보낸 이름 그대로, reject_once는 「거부」(esc), allow_once는 맨 오른쪽 「한 번만 허용」(↵)이다", () => {
    expect(row(mcp, "work", "codex")).toEqual({
      layout: "buttons",
      choices: [
        ["Allow for this session", "allow_session", false, false, null, "opt"],
        ["Always allow", "allow_always", false, false, null, "opt"],
        ["거부", "cancel", false, false, "escape", "no"],
        ["한 번만 허용", "allow_once", false, false, "enter", "yes"],
      ],
    });
    const edit = request(schemaEdit, {
      card: "edit",
      policy: null,
      options: [
        { optionId: "allow_once", name: "Yes, proceed", kind: "allow_once" },
        { optionId: "allow_for_session", name: "Yes, and don't ask again for these files", kind: "allow_always" },
        { optionId: "cancel", name: "No, and tell Codex what to do differently", kind: "reject_once" },
      ],
    });
    expect(row(edit, "thread", "codex").choices.map(([label]) => label)).toEqual(["Yes, and don't ask again for these files", "거부", "한 번만 허용"]);
  });

  it("거부는 입력칸을 열지 않는다 — codex-acp는 답에 실은 말을 읽지 않는다. Claude의 허락 문구도 서지 않는다", () => {
    const { choices } = cardChoices({ ...mcp, grant: ["edit"] }, "work", "codex");
    expect(choices.some((choice) => choice.opensField || choice.remember)).toBe(false);
  });

  it("Codex의 긴 이름은 단추 안에서 접힌다(`.ra-opt.long`) — Claude의 허락 문구는 한 줄 그대로다", () => {
    expect(cardChoices(mcp, "work", "codex").choices.map((choice) => choice.long)).toEqual([true, true, false, false]);
    expect(cardChoices(request(migrate, { grant: ["Bash(pnpm prisma *)"] }), "work", "claude-code").choices.some((choice) => choice.long)).toBe(false);
  });

  it("키는 같다 — ↵는 「한 번만 허용」, esc는 「거부」다", () => {
    const { choices } = cardChoices(mcp, "work", "codex");
    const press = (code: string) => ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false });
    expect(choices[buttonKey(press("Enter"), choices, null) ?? -1]?.option).toBe("allow_once");
    expect(choices[buttonKey(press("Escape"), choices, null) ?? -1]?.option).toBe("cancel");
  });

  it("한 번만 허용이나 거부가 없으면 번호 줄로 Codex가 보낸 이름 그대로다", () => {
    const odd = request(mcpCall, { options: [{ optionId: "allow_session", name: "Allow for this session", kind: "allow_always" }] });
    expect(row(odd, "work", "codex")).toEqual({ layout: "rows", choices: [["Allow for this session", "allow_session", false, false, null, "opt"]] });
  });
});

describe("고르기 전에 할 말(v1 티켓 25)", () => {
  it("카드 안 입력칸에 말을 쓰면 보내면 무엇이 건너뛰어지고 누구에게 가는지 한 줄로 말한다(스토리 83)", () => {
    expect(skipHint("command", "Claude Code")).toBe("보내면 이 명령은 건너뛰고 Claude Code에게 말을 전해요");
    expect(skipHint("edit", "리뷰어")).toBe("보내면 이 편집은 건너뛰고 리뷰어에게 말을 전해요");
    expect(skipHint("other", "테스터")).toBe("보내면 이 요청은 건너뛰고 테스터에게 말을 전해요");
  });

  it("계획 다시 쓰기의 입력칸은 고칠 점을 받고, 보내면 그 말대로 계획을 다시 쓴다(v1 티켓 26)", () => {
    expect(fieldLabel("plan", "Claude Code")).toBe("Claude Code에게 고칠 점 알려 주기");
    expect(fieldLabel("command", "테스터")).toBe("테스터에게 다르게 할 방법 알려 주기");
    expect(skipHint("plan", "Claude Code")).toBe("보내면 Claude Code가 이 말대로 계획을 다시 써요");
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
    const { choices } = cardChoices(request(migrate, { grant: ["Bash(pnpm prisma *)"] }), "work", "claude-code");
    const label = (at: number | null) => (at === null ? null : choices[at]?.label);

    it("↵는 한 번만 허용, esc는 거부다", () => {
      expect(label(buttonKey(press("Enter"), choices, null))).toBe("한 번만 허용");
      expect(label(buttonKey(press("NumpadEnter"), choices, null))).toBe("한 번만 허용");
      expect(label(buttonKey(press("Escape"), choices, null))).toBe("거부");
    });

    it("단추에 포커스가 있으면 ↵는 그 단추다 — Tab으로 옮겨 간 손이 고른 것", () => {
      expect(label(buttonKey(press("Enter"), choices, 0))).toBe("비슷한 명령 허용");
      expect(label(buttonKey(press("Escape"), choices, 0))).toBe("거부");
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

// 결정 줄의 글(Tools · Thread 보드 「승인 결정 줄」 · restart 02b-5) — 누른 단추의 글에 「함」을 붙인다: 「한 번만 허용함」 · 「이 작업공간의 모든 편집
// 허용함」 · 「거부함」. 무엇을 허용했는지는 바로 아래 도구 줄이 말한다.
describe("결정 줄", () => {
  const ONCE = { optionId: "allow_once", name: "Yes", kind: "allow_once" };
  const decision = (toolCall: Record<string, unknown>, extra: Partial<DecisionEntry> = {}): DecisionEntry => ({
    kind: "decision",
    key: "d1",
    allowed: true,
    chosen: ONCE,
    granted: null,
    words: null,
    toolCall,
    planReview: false,
    ...extra,
  });

  it("누른 단추의 글 그대로다 — 「한 번만 허용함」 · 허락 문구 · 「거부함」", () => {
    expect(decisionText(decision(migrate))).toBe("한 번만 허용함");
    expect(decisionText(decision({ kind: "search", title: "refund" }))).toBe("한 번만 허용함");
    expect(decisionText(decision(migrate, { granted: { rules: ["Bash(pnpm prisma *)"], work: "refund-api" } }))).toBe("비슷한 명령 허용함");
    expect(decisionText(decision(schemaEdit, { granted: { rules: ["edit"], work: "refund-api" } }))).toBe("이 작업공간의 모든 편집 허용함");
    expect(decisionText(decision(schemaEdit, { granted: { rules: ["edit"], work: null } }))).toBe("이 채팅의 모든 편집 허용함");
    const reject = { optionId: "reject", name: "No", kind: "reject_once" };
    expect(decisionText(decision(migrate, { allowed: false, chosen: reject, words: "마이그레이션 없이 할 수는 없어?" }))).toBe("거부함");
  });

  it("Codex가 보낸 왼쪽 단추(`allow_always`)는 그 이름 그대로다 — 카드에 선 글과 같다", () => {
    const session = { optionId: "allow_for_session", name: "Yes, and don't ask again for these files", kind: "allow_always" };
    expect(decisionText(decision(schemaEdit, { chosen: session }))).toBe("Yes, and don't ask again for these files");
  });

  it("계획은 「계획대로 진행함」 · 「계획을 다시 짜기로 함」이다", () => {
    expect(decisionText(decision({ kind: "switch_mode" }, { planReview: true }))).toBe("계획대로 진행함");
    expect(decisionText(decision({ kind: "switch_mode" }, { planReview: true, allowed: false }))).toBe("계획을 다시 짜기로 함");
  });
});

// 02 코드 리뷰 A1 — **같은 허락을 화면에서 한 말로 부른다.** 승인 카드의 허락 문구로 준 허락이 다음 요청을 묻지 않고 넘기면 방패 줄의 까닭이
// 선다. 엔진은 그 까닭을 「이 Work에서는 다시 묻지 않기」로 기록에 적고 허락의 종류를 말하지 않는다. 그래서 화면이 넘어간 도구의 종류로 카드의
// 말을 고른다. 다른 까닭(물어보는 정도 · 앱 기능 도구)은 그대로다.
describe("방패 줄의 까닭", () => {
  it("허락으로 넘어간 편집은 자리를 말한다", () => {
    expect(autoAllowReason("이 Work에서는 다시 묻지 않기", { kind: "edit" })).toBe("이 작업공간의 모든 편집 허용");
    expect(autoAllowReason("이 Thread에서는 다시 묻지 않기", { kind: "edit" })).toBe("이 채팅의 모든 편집 허용");
    expect(autoAllowReason("이 Work에서는 다시 묻지 않기", { kind: "delete" })).toBe("이 작업공간의 모든 편집 허용");
    expect(autoAllowReason("이 Thread에서는 다시 묻지 않기", { kind: "move" })).toBe("이 채팅의 모든 편집 허용");
  });

  it("허락으로 넘어간 명령은 「비슷한 명령 허용」이다", () => {
    expect(autoAllowReason("이 Work에서는 다시 묻지 않기", { kind: "execute" })).toBe("비슷한 명령 허용");
    expect(autoAllowReason("이 Thread에서는 다시 묻지 않기", { kind: "execute" })).toBe("비슷한 명령 허용");
  });

  it("물어보는 정도 · 앱 기능 도구의 까닭은 그대로다", () => {
    expect(autoAllowReason("편집 자동", { kind: "edit" })).toBe("편집 자동");
    expect(autoAllowReason("묻지 않음", { kind: "execute" })).toBe("묻지 않음");
    expect(autoAllowReason("앱 기능 도구", { kind: "other" })).toBe("앱 기능 도구");
  });
});
