import { describe, expect, it } from "vitest";
import {
  agentChoices,
  firstMention,
  insertMention,
  matchAgents,
  mentionAt,
  mentionOf,
  recipientOf,
  type AgentChoice,
} from "./mentions";
import type { AgentRoster } from "./types";

// @ 메뉴 · 멘션 · 받는 이(v1 티켓 14 · 구현 스펙 §14 · S9) — 화면이 엔진과 같은 규칙으로 받는 이를 읽는다. seam은 순수 함수들이다:
// 멘션 문법(`firstMention` · `mentionAt`), 메뉴 목록(`agentChoices` · `matchAgents`), 받는 이(`recipientOf`) ·
// 고른 이름 넣기(`insertMention`). 멘션 문법의 기대는 엔진 단위 시험(`host/thread.rs` `first_mention`)과 같은 예다.

const definition = (handle: string, name: string, description = "") => ({
  handle,
  name,
  description,
  avatar: null,
  model: { prefer: null, effort: null },
});

const roster: AgentRoster = {
  agents: [
    { call: "docs", from: "library", path: "/x/docs.md", definition: definition("docs", "문서 작성자", "문서만 쓴다") },
    { call: "host", from: "library", path: "/x/host.md", definition: definition("host", "Host", "다른 Agent를 부르지 않았을 때 답한다") },
    { call: "reviewer", from: "library", path: "/x/reviewer.md", definition: definition("reviewer", "리뷰어", "바뀐 코드를 읽고 리뷰한다") },
    { call: "tester", from: { project: "api" }, path: "/x/tester.md", definition: definition("tester", "테스터", "테스트를 돌린다") },
  ],
  broken: [
    { call: "api/host", handle: "host", from: { project: "api" }, path: "/x/api/host.md", problem: { kind: "hostOutsideLibrary" } },
    { call: "ghost", handle: "ghost", from: "library", path: "/x/ghost.md", problem: { kind: "unknownTool", tool: "teleport" } },
  ],
};

/** 이 Thread에 이미 앉은 Host와 리뷰어 — 이름 · 얼굴은 기록의 `joined` 줄에서 온다. */
const seated = [
  { handle: "host", from: "library" as const, name: "Host", avatar: null },
  { handle: "reviewer", from: "library" as const, name: "리뷰어", avatar: { shape: "circle", color: "green" } },
];

const rows = (choices: readonly AgentChoice[]) => choices.map((one) => [one.section, one.call, one.broken]);

describe("멘션 문법은 엔진과 같다", () => {
  it("말의 첫 멘션 — 조사는 남기고 끝의 문장 부호는 뗀다", () => {
    expect(firstMention("@reviewer 봐 줘. @host는 기다려")?.name).toBe("reviewer");
    expect(firstMention("다 됐으면 (@api-server/reviewer).")?.name).toBe("api-server/reviewer");
    expect(firstMention("끝나면 @reviewer.")?.name).toBe("reviewer");
    expect(firstMention("@reviewer가 봐 줘")?.name).toBe("reviewer가");
    expect(firstMention("me@example.com으로 보내 줘")).toBeNull();
    expect(firstMention("`@media` 쿼리를 고쳐 줘")).toBeNull();
    expect(firstMention('```\n@app.route("/")\n```\n@tester 돌려 줘')?.name).toBe("tester");
    expect(firstMention("@ 혼자 선 골뱅이")).toBeNull();
    expect(firstMention("멘션 없는 말")).toBeNull();
  });

  it("커서가 선 멘션 — 메뉴가 찾는 말과, 고르면 갈아 끼울 자리", () => {
    expect(mentionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(mentionAt("이거 @rev 봐", 7)).toEqual({ start: 3, end: 7, query: "rev" });
    // 이름 가운데에 선 커서 — 찾는 말은 커서까지, 갈아 끼울 자리는 이름 끝까지다.
    expect(mentionAt("@reviewer 봐", 4)).toEqual({ start: 0, end: 9, query: "rev" });
    expect(mentionAt("me@exa", 6)).toBeNull();
    expect(mentionAt("`@med", 5)).toBeNull();
    expect(mentionAt("@reviewer 봐", 11)).toBeNull();
  });

  it("고른 이름을 넣으면 `@<call> `이 되고 커서는 그 뒤에 선다", () => {
    expect(insertMention("이거 @rev 봐", { start: 3, end: 7 }, "reviewer")).toEqual({ text: "이거 @reviewer 봐", caret: 13 });
    expect(insertMention("@", { start: 0, end: 1 }, "api/tester")).toEqual({ text: "@api/tester ", caret: 12 });
  });
});

describe("@ 메뉴의 목록", () => {
  it("이 Thread에 있는 Agent가 먼저, 그다음 Library · Project 순이고, 깨진 것은 그 자리에 까닭과 함께 선다", () => {
    expect(rows(agentChoices(roster, seated))).toEqual([
      ["이 Thread에 있음", "host", null],
      ["이 Thread에 있음", "reviewer", null],
      ["Library", "docs", null],
      ["Library", "ghost", "모르는 도구가 있어요: teleport"],
      ["api", "tester", null],
      ["api", "api/host", "host는 Library에만 둘 수 있어요"],
    ]);
  });

  it("이미 앉은 Agent는 기록의 이름 · 얼굴에 정의 파일의 설명을 붙인다", () => {
    const reviewer = agentChoices(roster, seated)[1];
    expect([reviewer.name, reviewer.avatar, reviewer.description]).toEqual([
      "리뷰어",
      { shape: "circle", color: "green" },
      "바뀐 코드를 읽고 리뷰한다",
    ]);
  });

  it("새 Thread에는 앉은 이가 없어 Host가 Library의 맨 앞에 선다", () => {
    expect(rows(agentChoices(roster, [])).slice(0, 4)).toEqual([
      ["Library", "host", null],
      ["Library", "docs", null],
      ["Library", "reviewer", null],
      ["Library", "ghost", "모르는 도구가 있어요: teleport"],
    ]);
  });

  it("친 글자로 거른다 — handle · 이름 · 부르는 이름에서 그 글자로 시작하는 것이 먼저다", () => {
    const choices = agentChoices(roster, seated);
    expect(matchAgents(choices, "").length).toBe(choices.length);
    expect(matchAgents(choices, "re").map((one) => one.call)).toEqual(["reviewer"]);
    expect(matchAgents(choices, "테").map((one) => one.call)).toEqual(["tester"]);
    expect(matchAgents(choices, "o").map((one) => one.call)).toEqual(["host", "docs", "ghost", "api/host"]);
  });
});

describe("받는 이", () => {
  const choices = agentChoices(roster, seated);

  it("멘션이 없으면 Host다(null)", () => {
    expect(recipientOf("그냥 말", choices)).toBeNull();
  });

  it("멘션 이름의 가장 긴 앞부분 가운데 아는 이름이다 — 조사가 붙어도 고른다", () => {
    // 입력칸이 칩으로 칠할 자리는 `@`부터 고른 이름 끝까지다 — 조사는 칠하지 않는다.
    expect(recipientOf("@reviewer가 봐 줘", choices)).toMatchObject({
      mention: "reviewer가",
      agent: { call: "reviewer" },
      at: { start: 0, end: 9 },
    });
    expect(recipientOf("끝나면 @reviewer.", choices)).toMatchObject({ agent: { call: "reviewer" }, at: { start: 4, end: 13 } });
    expect(recipientOf("@api/tester 돌려", choices)).toMatchObject({ agent: { call: "tester" } });
    expect(recipientOf("@tester 돌려", choices)).toMatchObject({ agent: { call: "tester" } });
  });

  it("아는 이름이 없으면 멘션 그대로다 — 보내면 엔진이 거절 글을 준다", () => {
    expect(recipientOf("@nobody 봐", choices)).toEqual({ mention: "nobody", agent: null, at: { start: 0, end: 7 } });
  });
});

describe("보낸 말의 멘션", () => {
  it("말풍선이 칠할 자리는 첫 멘션의 `@`부터 그 턴에 답한 이의 이름 끝까지다 — 조사 · Project 이름도 가른다", () => {
    expect(mentionOf("@reviewer가 봐 줘", "reviewer")).toEqual({ start: 0, end: 9 });
    expect(mentionOf("끝나면 @api/tester 돌려", "tester")).toEqual({ start: 4, end: 15 });
    // 받는 이가 아닌 이름(엔진이 Host에게 보냈다)은 칠하지 않는다.
    expect(mentionOf("@hostname 봐 줘", "host")).toEqual({ start: 0, end: 5 });
    expect(mentionOf("@nobody 봐", "host")).toBeNull();
    expect(mentionOf("그냥 말", "host")).toBeNull();
  });
});
