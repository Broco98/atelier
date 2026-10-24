import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { WorkProjectChoice } from "./fold";
import type { AgentRoster, FoundAgent } from "./types";
import { branchHint, decisionItems, decisionsDue, firstPicked } from "./work-proposal";

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

describe("「결정은 내가 합니다」 카드의 줄", () => {
  // 코드 리뷰 1차 B7 — 카드는 고정 셋이 아니라 Library Host 정의의 `ask_before`에서 선다. 판정이 걸지 않는 이름(`schema` · 모르는 이름)은
  // 서지 않고, 끝에는 늘 Work 밖 Project(S22)가 선다.
  const host = (askBefore: string[], from: FoundAgent["from"] = "library"): FoundAgent => ({
    call: from === "library" ? "host" : "api/host",
    from,
    path: "/Users/tester/.atelier/library/agents/host.md",
    definition: {
      handle: "host",
      name: "Host",
      description: "",
      avatar: null,
      model: { prefer: null, effort: null },
      policy: { askBefore, forbid: [] },
    },
  });
  const roster = (...agents: FoundAgent[]): AgentRoster => ({ agents, broken: [] });
  const texts = (value: AgentRoster | null) => decisionItems(value).map((item) => item.text);

  it("Host 기본 파일이면 보드의 셋이 보드 차례로 선다 — 스키마 명령 패턴 여럿은 한 줄이다", () => {
    const defaults = ["push", "Bash(*prisma migrate *)", "Bash(*rails db:migrate*)", "Bash(*supabase db push*)"];
    expect(texts(roster(host(defaults)))).toEqual(["데이터베이스 스키마 바꾸기", "원격 저장소에 push", "이 Work 밖의 Project 건드리기"]);
  });

  it("사람이 고친 파일의 이름 · 명령 패턴이 그대로 서고, 판정이 걸지 않는 이름은 서지 않는다", () => {
    const edited = ["Bash(pnpm deploy:*)", "merge", "schema", "edit", "shell", "push"];
    expect(decisionItems(roster(host(edited))).map(({ kind, text }) => [kind, text])).toEqual([
      ["push", "원격 저장소에 push"],
      ["merge", "브랜치 · PR merge"],
      ["edit", "파일 고치기"],
      ["shell", "명령 실행"],
      ["command", "「pnpm deploy」 실행"],
      ["project", "이 Work 밖의 Project 건드리기"],
    ]);
  });

  it("Host를 읽지 못했거나 묻는 일을 다 지웠으면 Work 밖 Project 한 줄이다 — Project 안의 host는 Host가 아니다", () => {
    expect(texts(null)).toEqual(["이 Work 밖의 Project 건드리기"]);
    expect(texts(roster(host([])))).toEqual(["이 Work 밖의 Project 건드리기"]);
    expect(texts(roster(host(["push"], { project: "api" })))).toEqual(["이 Work 밖의 Project 건드리기"]);
  });

  // 카드의 줄 이름과 명령 패턴의 보이는 꼴도 **두 언어가 문자열로만** 잇는다(코드 리뷰 2차 B6) — 판정(`policy.rs`의 `rule` · `NAMED` ·
  // `shown`)이 거는 이름을 카드가 모르면 줄이 서지 않고, 보이는 꼴이 다르면 카드와 물음 줄(Policy 이름)이 다른 말을 한다. 표를 못
  // 찾으면 던진다(fail-closed).
  const policy = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/src/policy.rs", import.meta.url)), "utf8");
  const inPolicy = (pattern: RegExp, what: string): string => {
    const found = pattern.exec(policy)?.[1];
    if (!found) throw new Error(`policy.rs에서 ${what}을 못 찾았다`);
    return found;
  };

  it("판정이 거는 이름마다 그 이름의 줄이 서고, 판정이 걸지 않는 `schema`는 서지 않는다", () => {
    const named = [...inPolicy(/const NAMED: [^=]*= \[(.*?)\];/s, "NAMED").matchAll(/\("(\w+)",/g)].map(([, name]) => name);
    const ruled = [...inPolicy(/fn rule\(name: &str\) -> Rule<'_> \{(.*?)\n\}/s, "rule").matchAll(/"(\w+)" => Rule::/g)].map(([, name]) => name);
    expect([...named, ...ruled]).toEqual(["push", "merge", "edit", "shell"]);
    for (const name of [...named, ...ruled]) {
      expect(decisionItems(roster(host([name]))).map((item) => item.kind)).toEqual([name, "project"]);
    }
    expect(texts(roster(host(["schema"])))).toEqual(["이 Work 밖의 Project 건드리기"]);
  });

  it("명령 패턴의 줄은 판정의 물음 이름과 같은 꼴로 보인다", () => {
    const shown = [...inPolicy(/const SHOWN: [^=]*= \[(.*?)\];/s, "SHOWN").matchAll(/\("([^"]+)", "([^"]+)"\)/g)];
    expect(shown.length).toBeGreaterThan(0);
    for (const [, rule, text] of shown) {
      expect(texts(roster(host([rule])))).toEqual([`「${text}」 실행`, "이 Work 밖의 Project 건드리기"]);
    }
  });
});
