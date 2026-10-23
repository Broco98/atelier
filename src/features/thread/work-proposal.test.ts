import { describe, expect, it } from "vitest";
import type { WorkProjectChoice } from "./fold";
import { branchHint, decisionsDue, firstPicked } from "./work-proposal";

// Work 만들기 카드의 값(v1 티켓 30 · 구현 스펙 §11 · 캔버스 Cards 보드 「Work 만들기」) — 브랜치 칸 오른쪽의 규칙 설명 · 처음 골라 둘
// Project · 「결정은 내가 합니다」 카드가 설 때. seam은 순수 함수 셋이다 — 카드는 이 값을 그리기만 한다.

const project = (slug: string, branches: string[], extra: Partial<WorkProjectChoice> = {}): WorkProjectChoice => ({
  slug,
  name: slug,
  description: null,
  recommended: false,
  reason: null,
  branches,
  ...extra,
});
const api = project("api-server", ["main", "fix/login-timeout", "feat/coupon"], { recommended: true });
const web = project("web-app", ["main", "feature/refund-button"]);
const admin = project("admin-console", ["main"]);

describe("브랜치 칸의 규칙 설명", () => {
  it("고른 Project에 같은 머리(fix/)의 브랜치가 있으면 그 규칙을 따른다고 말한다(보드 「api-server의 fix/... 규칙을 따름」)", () => {
    expect(branchHint("fix/refund-api", [api, web], new Set(["api-server"]))).toEqual({
      text: "api-server의 fix/... 규칙을 따름",
      problem: false,
    });
  });

  it("머리가 어느 Project와도 맞지 않으면 고른 Project가 쓰는 머리를 알려 준다", () => {
    expect(branchHint("bugfix/refund-api", [api, web], new Set(["web-app"]))).toEqual({
      text: "web-app의 브랜치는 feature/... 규칙이에요",
      problem: false,
    });
  });

  it("규칙을 읽을 브랜치가 없으면 한 Work의 브랜치는 모든 Project가 같이 쓴다는 core 규칙을 말한다", () => {
    expect(branchHint("refund-api", [admin], new Set(["admin-console"]))).toEqual({
      text: "고른 Project가 모두 이 브랜치를 같이 써요",
      problem: false,
    });
  });

  it("고른 Project에 이미 있는 브랜치 · 빈 이름은 문제다 — 「Work 만들기」가 잠긴다", () => {
    expect(branchHint("fix/login-timeout", [api, web], new Set(["api-server", "web-app"]))).toEqual({
      text: "api-server에 이미 있는 브랜치예요",
      problem: true,
    });
    expect(branchHint("  ", [api], new Set(["api-server"]))).toEqual({ text: "브랜치 이름을 적어 주세요", problem: true });
  });

  it("Project를 다 빼면 브랜치도 없다 — 기획만인 Work다", () => {
    expect(branchHint("fix/refund-api", [api], new Set())).toEqual({
      text: "Project를 넣으면 이 이름으로 만들어요",
      problem: false,
    });
    expect(branchHint("", [api], new Set())).toEqual({ text: "Project를 넣으면 이 이름으로 만들어요", problem: false });
  });
});

describe("처음 골라 둘 Project", () => {
  it("Host가 추천한 것만 골라 둔다 — 추천이 없으면 아무것도 고르지 않는다", () => {
    expect([...firstPicked([api, web, admin])]).toEqual(["api-server"]);
    expect([...firstPicked([web, admin])]).toEqual([]);
  });
});

describe("「결정은 내가 합니다」 카드", () => {
  const made = { system: [{ kind: "work" as const }] };
  const none = { system: [{ kind: "title" as const }] };

  it("이 Thread에 Work를 만든 줄이 있고 아직 보지 않았으면 선다 — 처음 한 번(S31)", () => {
    expect(decisionsDue(made, false)).toBe(true);
    expect(decisionsDue(made, true)).toBe(false);
    expect(decisionsDue(none, false)).toBe(false);
  });

  it("설정을 아직 읽지 못했으면 서지 않는다 — 본 사람에게 잠깐 번쩍이지 않게", () => {
    expect(decisionsDue(made, null)).toBe(false);
  });
});
