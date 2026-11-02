import { describe, expect, it } from "vitest";
import type { ReadingScope, ScopeProject } from "@/features/services/scope";
import { headService, heldScope, holdOf, holdPick, scopeArgs, scopeChip, scopeLine, shownScope, startScope } from "./service-chip";

// 트레이의 범위 칩과 범위 줄(03 구현 스펙 §5 · 티켓 06 · 캔버스 v52 F4-KitComposer · 01a-13) — 기대 글은 시안 칸의 글 그대로다.

const read = (...names: string[]): ScopeProject[] => names.map((name) => ({ slug: name, name, why: "service" as const }));
const scope = (over: Partial<ReadingScope>): ReadingScope => ({ service: null, project: null, projects: [], worked: [], kind: "all", registered: 3, ...over });
const worked = (...names: string[]) => names.map((name) => ({ slug: name, name }));
const PAYMENTS = { slug: "결제-서비스", name: "결제 서비스", troubled: false };
const API = { slug: "api-server", name: "API 서버" };

describe("범위 줄 — 읽는 범위에서 나온다", () => {
  it("Service가 없으면 등록된 Project 수를 말한다(「기본」 칸)", () => {
    expect(scopeLine(scope({ projects: read("api-server", "backoffice", "web-app") }))).toEqual({
      text: "등록된 Project 3개를 읽어요",
      warn: false,
      addProject: false,
    });
  });

  it("Service가 있으면 그 Project 이름이고, 셋을 넘으면 앞 둘과 「외 N개」다(「Service를 고름」 칸)", () => {
    expect(scopeLine(scope({ service: PAYMENTS, kind: "service", projects: read("web-app", "api-server") })).text).toBe(
      "web-app · api-server를 읽어요",
    );
    expect(
      scopeLine(scope({ service: PAYMENTS, kind: "service", projects: read("web-app", "api-server", "backoffice", "docs") })).text,
    ).toBe("web-app · api-server 외 2개를 읽어요");
    // 조사는 끝소리를 따른다 — 받침 있는 이름은 「을」.
    expect(scopeLine(scope({ service: PAYMENTS, kind: "service", projects: read("결제 화면") })).text).toBe("결제 화면을 읽어요");
  });

  // 03 코드 리뷰 P3 · 스토리 36 — worktree가 선 Project는 함께 여는 폴더에서 빠지지만(§7 규칙 4) 그 Project도 읽는다(worktree에서). Service의
  // Project를 worktree가 다 덮어도 빈 Service가 아니다.
  it("worktree에서 일하는 Project도 읽는 Project로 말한다 — 고치는 것이 먼저다(요약 카드 「소스」와 같은 차례)", () => {
    expect(scopeLine(scope({ service: PAYMENTS, kind: "service", worked: worked("web-app", "api-server") }))).toEqual({
      text: "web-app · api-server를 읽어요",
      warn: false,
      addProject: false,
    });
    expect(scopeLine(scope({ service: PAYMENTS, kind: "service", projects: read("web-app"), worked: worked("api-server") })).text).toBe(
      "api-server · web-app을 읽어요",
    );
  });

  it("Project가 적힌 Service에서 하나도 읽을 수 없으면 경고 색으로 없다고만 한다 — 넣으라고 하지 않는다(이미 적혀 있다)", () => {
    expect(scopeLine(scope({ service: { ...PAYMENTS, troubled: true }, kind: "service" }))).toEqual({
      text: "읽는 Project가 없어요",
      warn: true,
      addProject: false,
    });
  });

  it("빈 Service는 막지 않고 한 줄로 알린다 — 경고 색(「빈 Service를 고름」 칸)", () => {
    expect(scopeLine(scope({ service: { ...PAYMENTS, name: "정산" }, kind: "emptyService" }))).toEqual({
      text: "읽는 Project가 없어요 — Service에 Project를 넣어 주세요",
      warn: true,
      addProject: false,
    });
  });

  it("Project 범위면 그 Project 이름을 말하고, 폴더가 사라져 읽을 수 없으면 경고 색으로 없다고만 한다", () => {
    expect(scopeLine(scope({ project: API, kind: "project", projects: read("API 서버") }))).toEqual({
      text: "API 서버를 읽어요",
      warn: false,
      addProject: false,
    });
    expect(scopeLine(scope({ project: API, kind: "project" }))).toEqual({ text: "읽는 Project가 없어요", warn: true, addProject: false });
  });

  it("등록된 Project가 없으면 경고 색과 「Project 추가」로 이끈다(「등록된 Project가 없음」 칸)", () => {
    expect(scopeLine(scope({ kind: "noProjects", registered: 0 }))).toEqual({
      text: "등록된 Project가 없어요",
      warn: true,
      addProject: true,
    });
  });
});

const PAYMENTS_ON = { slug: "결제-서비스", name: "결제 서비스", troubled: false };
const SERVICE = { kind: "service", slug: "결제-서비스" } as const;
const TOOLS = { kind: "service", slug: "사내-도구" } as const;
const PROJECT = { kind: "project", slug: "api-server" } as const;
const SHOWN_SERVICE = { ...SERVICE, name: "결제 서비스" };
const SHOWN_TOOLS = { ...TOOLS, name: "사내 도구" };
const SHOWN_PROJECT = { ...PROJECT, name: "API 서버" };

// 03 코드 리뷰 P14 — 칩 · 머리 줄의 Service는 읽는 범위가 싣는 Service다(§7 「명령 하나가 화면에 범위를 준다」). 화면이 Work · Service 목록으로
// 다시 세지 않는다 — 곁의 범위 줄과 늘 같은 값이다.
describe("범위 칩의 갈래", () => {
  it("범위가 없으면 흐린 빈 칩이다", () => {
    expect(scopeChip(null, false)).toEqual({ kind: "ghost" });
  });

  it("고르면 흰 칩에 이름과 × — 빼기다(「Service를 고름」 칸)", () => {
    expect(scopeChip(SHOWN_SERVICE, false)).toEqual({ kind: "on", of: "service", slug: "결제-서비스", name: "결제 서비스", end: "remove" });
    expect(scopeChip(SHOWN_PROJECT, false)).toEqual({ kind: "on", of: "project", slug: "api-server", name: "API 서버", end: "remove" });
  });

  it("바꾸는 것이 Work의 Service면 × 대신 ▾ — 빼기도 메뉴에서만 한다(「최근 작업공간을 고름」 칸)", () => {
    expect(scopeChip(SHOWN_SERVICE, true)).toEqual({ kind: "on", of: "service", slug: "결제-서비스", name: "결제 서비스", end: "menu" });
  });
});

describe("칩이 보이는 쥔 범위 — 읽는 범위가 싣는 것이다", () => {
  const scoped = (service: typeof PAYMENTS_ON | null) => scope({ service, kind: service ? "service" : "all" });
  const projected = scope({ project: API, kind: "project" });

  it("쥔 것을 센 범위면 그 범위의 이름이다", () => {
    expect(shownScope(SERVICE, scoped(PAYMENTS_ON), true)).toEqual(SHOWN_SERVICE);
    expect(shownScope(PROJECT, projected, true)).toEqual(SHOWN_PROJECT);
    expect(shownScope(null, scoped(PAYMENTS_ON), true)).toBeNull();
  });

  it("그 Service 파일이 없거나 Project가 등록되어 있지 않으면 범위에 없다 — 칩도 없음이다(§7 규칙 1)", () => {
    expect(shownScope({ kind: "service", slug: "지운-것" }, scoped(null), true)).toBeNull();
    expect(shownScope({ kind: "project", slug: "지운-것" }, scoped(null), true)).toBeNull();
  });

  it("범위를 아직 못 읽었거나 앞 답(쥔 것을 바꾼 사이)이면 쥔 slug가 이름 자리에 선다", () => {
    expect(shownScope(SERVICE, undefined, false)).toEqual({ ...SERVICE, name: "결제-서비스" });
    expect(shownScope(PROJECT, undefined, false)).toEqual({ ...PROJECT, name: "api-server" });
    expect(shownScope(TOOLS, scoped(PAYMENTS_ON), false)).toEqual({ ...TOOLS, name: "사내-도구" });
    expect(shownScope(SERVICE, scoped(PAYMENTS_ON), false)).toEqual(SHOWN_SERVICE);
    expect(shownScope(PROJECT, scoped(PAYMENTS_ON), false)).toEqual({ ...PROJECT, name: "api-server" });
  });
});

describe("고른 것이 가는 때 — 첫 말 전에는 입력창이 쥐고 첫 말과 함께 간다(§5 · S4)", () => {
  const NEW_WORK = { kind: "new-work" } as const;
  const NO_WORK = { kind: "no-work" } as const;
  const REFUND = { kind: "work", slug: "refund-api" } as const;
  const NOTHING = { service: null, project: null };
  const seed = (over: { service?: string; project?: string; link?: Parameters<typeof holdOf>[0]["link"] }) =>
    holdOf({ link: null, service: null, project: null, ...over });

  it("주소 씨앗이 처음 쥔 범위다 — 「새 작업공간」 · 「작업공간 없이 대화」를 오가도 남는다", () => {
    const service = seed({ link: NEW_WORK, service: "결제-서비스" });
    expect(heldScope(NEW_WORK, service, null)).toEqual(SERVICE);
    expect(heldScope(NO_WORK, service, null)).toEqual(SERVICE);
    expect(startScope(NEW_WORK, service, SHOWN_SERVICE)).toEqual({ service: { slug: "결제-서비스" }, project: null });

    const project = seed({ link: NEW_WORK, project: "api-server" });
    expect(heldScope(NEW_WORK, project, null)).toEqual(PROJECT);
    expect(heldScope(NO_WORK, project, null)).toEqual(PROJECT);
    expect(startScope(NEW_WORK, project, SHOWN_PROJECT)).toEqual({ service: null, project: "api-server" });

    expect(startScope(NO_WORK, seed({}), null)).toEqual(NOTHING);
  });

  it("범위를 고르면 앞의 것을 갈아 치운다 — Service와 Project는 함께 서지 않는다", () => {
    const service = holdPick(NO_WORK, seed({ project: "api-server" }), SERVICE);
    expect(heldScope(NO_WORK, service, null)).toEqual(SERVICE);
    expect(startScope(NO_WORK, service, SHOWN_SERVICE)).toEqual({ service: { slug: "결제-서비스" }, project: null });
    const project = holdPick(NO_WORK, service, PROJECT);
    expect(heldScope(NO_WORK, project, null)).toEqual(PROJECT);
    expect(startScope(NO_WORK, project, SHOWN_PROJECT)).toEqual({ service: null, project: "api-server" });
    expect(heldScope(NO_WORK, holdPick(NO_WORK, project, null), null)).toBeNull();
  });

  it("쥔 범위를 범위 명령의 인자로 편다", () => {
    expect(scopeArgs(SERVICE)).toEqual({ service: "결제-서비스", project: null });
    expect(scopeArgs(PROJECT)).toEqual({ service: null, project: "api-server" });
    expect(scopeArgs(null)).toEqual(NOTHING);
  });

  it("Project 범위는 작업공간 밖의 값이다 — 최근 Work를 고른 동안 서지 않고 돌아오면 남아 있다", () => {
    const hold = seed({ project: "api-server" });
    expect(heldScope(REFUND, hold, null)).toBeNull();
    expect(startScope(REFUND, hold, null)).toEqual(NOTHING);
    expect(heldScope(NO_WORK, hold, null)).toEqual(PROJECT);
  });

  it("최근 Work를 고르면 그 Work의 Service를 보이고, 건드리지 않으면 첫 말이 그 Work의 Service를 바꾸지 않는다", () => {
    const hold = seed({ service: "결제-서비스" });
    expect(heldScope(REFUND, hold, "사내-도구")).toEqual(TOOLS);
    expect(heldScope(REFUND, hold, null)).toBeNull();
    expect(startScope(REFUND, hold, SHOWN_TOOLS)).toEqual(NOTHING);
  });

  it("최근 Work의 Service를 바꾸면 첫 말을 보낼 때 그 Work에 적는다 — 「범위 없음」도 고른 것이다", () => {
    const moved = holdPick(REFUND, seed({}), SERVICE);
    expect(heldScope(REFUND, moved, "사내-도구")).toEqual(SERVICE);
    expect(startScope(REFUND, moved, SHOWN_SERVICE)).toEqual({ service: { slug: "결제-서비스" }, project: null });
    const cleared = holdPick(REFUND, moved, null);
    expect(heldScope(REFUND, cleared, "사내-도구")).toBeNull();
    expect(startScope(REFUND, cleared, null)).toEqual({ service: { slug: null }, project: null });
    // 다른 Work를 고르면 그 Work의 Service다 — 앞 Work에서 바꾼 것은 따라가지 않는다.
    const other = { kind: "work", slug: "deploy" } as const;
    expect(heldScope(other, moved, "사내-도구")).toEqual(TOOLS);
    expect(startScope(other, moved, SHOWN_TOOLS)).toEqual(NOTHING);
    // Work 없는 쪽이 쥔 것은 그대로다.
    expect(heldScope(NO_WORK, holdPick(NO_WORK, moved, TOOLS), null)).toEqual(TOOLS);
  });

  // 03 코드 리뷰 P6 — 쥔 Service의 파일이 그사이 사라지면 칩은 빈 칩이다. 첫 말은 보이는 대로 간다 — 지운 slug를 실어 엔진이 거절하지 않게.
  it("쥔 범위가 사라졌으면(빈 칩) 보이는 대로 범위 없음으로 보낸다", () => {
    expect(startScope(NEW_WORK, seed({ link: NEW_WORK, service: "지운-것" }), null)).toEqual(NOTHING);
    expect(startScope(NEW_WORK, seed({ link: NEW_WORK, project: "지운-것" }), null)).toEqual(NOTHING);
    expect(startScope(REFUND, holdPick(REFUND, seed({}), { kind: "service", slug: "지운-것" }), null)).toEqual({ service: { slug: null }, project: null });
  });
});

// 03 구현 스펙 §10 · F4-KitChat 「머리 줄」 칸 — Work 없는 Thread는 「흐린 Service / 채팅 이름」, Service가 없으면 이름만, Work에 이은 Thread는
// 02 그대로 Work 단추만이다.
describe("Thread 머리 줄 이름 앞의 Service", () => {
  const scoped = scope({ service: PAYMENTS_ON, kind: "service" });

  it("Work 없는 Thread에 Service가 있으면 그 Thread의 읽는 범위가 싣는 Service다", () => {
    expect(headService(null, scoped)).toEqual({ slug: "결제-서비스", name: "결제 서비스" });
  });

  it("Service가 없거나 그 파일이 없으면(범위에 Service가 없다) 이름만 선다 — 범위를 읽기 전에도 비워 둔다", () => {
    expect(headService(null, scope({}))).toBeNull();
    expect(headService(null, undefined)).toBeNull();
  });

  it("Work에 이은 Thread는 Service를 머리 줄에 두지 않는다", () => {
    expect(headService("refund-api", scoped)).toBeNull();
  });
});
