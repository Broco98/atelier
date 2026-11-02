import { describe, expect, it } from "vitest";
import type { ToolEntry } from "./fold";
import type { Json } from "./json";
import { describeTool, phraseText } from "./tool-view";

// 도구 줄의 문구 — 종류 × 상태(restart 02b-4 · Tools 보드 「도구 줄 — 종류 × 상태」 · 「파일 변경」). 기대값은 보드의 칸 글 그대로다: 도는 줄은 「대상 동사」가
// 한 글로 반짝이고, 선 줄은 「동사 대상」(대상은 고정폭)이다. 멈춘 줄은 종류를 가리지 않고 ■ 「중지됨 대상」이다. 실패는 색이 아니라 동사가 말한다.
// 한때 선 줄도 「대상 동사」(「watcher.rs 읽음」)였고, 실패는 「실행하지 못함 · 코드 종료 1」, 멈춘 줄은 「중단함 · 12초」였다.

const tool = (call: Json, over: Partial<ToolEntry> = {}): ToolEntry => ({
  kind: "tool",
  key: "k",
  toolCallId: "t",
  call: { toolCallId: "t", ...call },
  output: "",
  inner: [],
  stop: null,
  cut: false,
  denied: false,
  allowed: null,
  asking: false,
  startedAt: "2026-11-03T10:00:00.000Z",
  endedAt: null,
  ...over,
});

const claude = (toolName: string, call: Json): Json => ({ ...call, _meta: { claudeCode: { toolName } } });

/** 보드의 여덟 줄 — 종류마다 도는 때의 원문. 끝 · 실패 · 멈춤은 이 원문의 상태만 바꾼다. */
const KINDS: { kind: string; call: Json; glyph: string; board: [string, string, string, string] }[] = [
  {
    kind: "read",
    call: claude("Read", { kind: "read", title: "Read /w/src/watcher.rs", locations: [{ path: "/w/src/watcher.rs" }] }),
    glyph: "read",
    board: ["watcher.rs 읽는 중", "읽음 watcher.rs", "읽지 못함 watcher.rs", "중지됨 watcher.rs"],
  },
  {
    kind: "search",
    call: claude("Grep", { kind: "search", title: "Search watcher", rawInput: { pattern: "watcher" } }),
    glyph: "search",
    board: ["watcher 검색 중", "검색함 watcher", "검색하지 못함 watcher", "중지됨 watcher"],
  },
  {
    kind: "edit",
    call: claude("Edit", {
      kind: "edit",
      title: "Edit /w/src/watcher.rs",
      locations: [{ path: "/w/src/watcher.rs" }],
      content: [{ type: "diff", path: "/w/src/watcher.rs", oldText: "a\n", newText: "b\n" }],
    }),
    glyph: "edit",
    board: ["watcher.rs 편집 중", "편집함 watcher.rs", "편집하지 못함 watcher.rs", "중지됨 watcher.rs"],
  },
  {
    kind: "execute",
    call: { kind: "execute", title: "pnpm test", rawInput: { command: ["/bin/zsh", "-lc", "pnpm test"] } },
    glyph: "execute",
    board: ["pnpm test 실행 중", "실행 완료 pnpm test", "코드 종료 1 pnpm test", "중지됨 pnpm test"],
  },
  {
    kind: "fetch",
    call: claude("WebSearch", { kind: "fetch", title: "acp schema", rawInput: { query: "acp schema" } }),
    glyph: "web",
    // 실패 칸만 보드(「가져오지 못함」)와 다르다 — 웹 검색의 실패는 「웹 검색하지 못함」이다. 가져오기(WebFetch)가 「가져오지 못함」이다.
    board: ["웹 검색 중", "웹 검색함 acp schema", "웹 검색하지 못함 acp schema", "중지됨 acp schema"],
  },
  {
    kind: "mcp",
    call: claude("mcp__atelier__list_projects", { kind: "other", title: "mcp__atelier__list_projects", rawInput: {} }),
    glyph: "mcp",
    board: ["Atelier list projects", "사용함 list_projects", "실패함 list_projects", "중지됨 list_projects"],
  },
  {
    kind: "skill",
    call: claude("Skill", { kind: "other", title: "Skill watcher-debug", rawInput: { skill: "watcher-debug" } }),
    glyph: "skill",
    board: ["watcher-debug 읽는 중", "스킬 읽음 watcher-debug", "읽지 못함 watcher-debug", "중지됨 watcher-debug"],
  },
  {
    kind: "other",
    call: { kind: "other", title: "custom_tool" },
    glyph: "other",
    // 도는 칸만 보드(「실행 중」)와 다르다 — 무엇이 도는지 대상을 앞에 둔다(명령 줄과 같은 꼴).
    board: ["custom_tool 실행 중", "실행 완료 custom_tool", "실패함 custom_tool", "중지됨 custom_tool"],
  },
];

describe("도구 줄 — 종류 × 상태", () => {
  for (const { kind, call, glyph, board } of KINDS) {
    it(`${kind}: ${board.join(" · ")}`, () => {
      const running = describeTool(tool({ ...call, status: "in_progress" }));
      const done = describeTool(tool({ ...call, status: "completed" }, { endedAt: "2026-11-03T10:00:02.000Z" }));
      const failed = describeTool(
        tool({ ...call, status: "failed", rawOutput: { exit_code: 1 } }, { endedAt: "2026-11-03T10:00:02.000Z" }),
      );
      const stopped = describeTool(tool({ ...call, status: "failed" }, { stop: "stopped", endedAt: "2026-11-03T10:00:02.000Z" }));
      expect([running, done, failed, stopped].map((view) => phraseText(view.phrase))).toEqual(board);
      expect([running, done, failed, stopped].map((view) => view.glyph)).toEqual([glyph, glyph, glyph, glyph]);
      // 도는 줄만 대상이 따로 서지 않는다(한 글로 반짝인다). 멈춘 줄만 ■다. 실패한 줄만 `failed`다(색은 그대로 — 동사가 말한다).
      expect([running, done, failed, stopped].map((view) => view.phrase.target === null)).toEqual([true, false, false, false]);
      expect([running, done, failed, stopped].map((view) => view.stopped)).toEqual([false, false, false, true]);
      expect([running, done, failed, stopped].map((view) => view.phrase.failed)).toEqual([false, false, true, false]);
    });
  }
});

describe("멈추거나 끊기거나 거부한 줄", () => {
  const read = KINDS[0].call;

  it("멈춘 뒤에도 끝을 받지 못한 줄과 끊긴 줄은 ■ 「중지됨」이다 — 반짝이지 않는다", () => {
    for (const view of [
      describeTool(tool({ ...read, status: "in_progress" }, { stop: "ran-on" })),
      describeTool(tool({ ...read, status: "in_progress" }, { cut: true })),
    ]) {
      expect(phraseText(view.phrase)).toBe("중지됨 watcher.rs");
      expect(view.stopped).toBe(true);
    }
  });

  it("멈춘 뒤에 끝난 줄은 끝난 줄이다", () => {
    const view = describeTool(tool({ ...read, status: "completed" }, { stop: "ran-on", endedAt: "2026-11-03T10:00:02.000Z" }));
    expect(phraseText(view.phrase)).toBe("읽음 watcher.rs");
    expect(view.stopped).toBe(false);
  });

  it("거부한 편집은 ■ 「편집하지 않음」이다(Thread 보드 「거부」)", () => {
    const view = describeTool(tool({ ...KINDS[2].call, status: "failed" }, { denied: true }));
    expect(phraseText(view.phrase)).toBe("편집하지 않음 watcher.rs");
    expect(view.stopped).toBe(true);
  });

  it("승인을 기다리는 줄은 글리프 그대로 「승인을 기다립니다」이고 반짝이지 않는다(Thread 보드 「승인 대기」)", () => {
    const view = describeTool(tool({ ...KINDS[2].call, status: "pending" }, { asking: true }));
    expect(phraseText(view.phrase)).toBe("승인을 기다립니다 watcher.rs");
    expect(view.waiting).toBe(true);
    expect(view.stopped).toBe(false);
  });
});

// Tools 보드 「파일 변경 — 새 파일 파란 점 · 지운 파일 빨간 점」.
describe("파일 변경 줄", () => {
  const done = (call: Json) => describeTool(tool({ ...call, status: "completed" }, { endedAt: "2026-11-03T10:00:02.000Z" }));

  it("고친 파일은 「편집함」이고 점이 없다", () => {
    const view = done(KINDS[2].call);
    expect(phraseText(view.phrase)).toBe("편집함 watcher.rs");
    expect(view.dot).toBeNull();
  });

  it("옛 글 없이 쓴 파일은 「생성됨」에 새 파일 점이다 — Claude Write · Codex add", () => {
    const write = claude("Write", {
      kind: "edit",
      title: "Write /w/src/WatcherBanner.tsx",
      locations: [{ path: "/w/src/WatcherBanner.tsx" }],
      content: [{ type: "diff", path: "/w/src/WatcherBanner.tsx", oldText: null, newText: "a\nb\n" }],
    });
    const add = {
      kind: "edit",
      title: "Editing files",
      content: [{ type: "diff", path: "/w/src/WatcherBanner.tsx", oldText: null, newText: "a\n", _meta: { kind: "add" } }],
    };
    for (const view of [done(write), done(add)]) {
      expect(phraseText(view.phrase)).toBe("생성됨 WatcherBanner.tsx");
      expect(view.dot).toBe("created");
    }
    expect(phraseText(describeTool(tool({ ...write, status: "in_progress" })).phrase)).toBe("WatcherBanner.tsx 만드는 중");
  });

  it("지운 파일은 「삭제됨」에 지운 파일 점이다", () => {
    const view = done({ kind: "delete", title: "Delete legacy-watch.ts", locations: [{ path: "/w/src/legacy-watch.ts" }] });
    expect(phraseText(view.phrase)).toBe("삭제됨 legacy-watch.ts");
    expect(view.dot).toBe("deleted");
  });
});

// Tools 보드 「명령 출력」 — 끝 줄은 성공 · 코드 종료 N · 중지됨이다. 한때 「코드 종료 0 · 4.2초」 · 「끝남」 · 「끊김」이었다.
describe("명령 출력의 끝 줄", () => {
  const execute = KINDS[3].call;
  const status = (call: Json, over: Partial<ToolEntry> = {}) =>
    describeTool(tool({ ...execute, ...call }, { endedAt: "2026-11-03T10:00:04.200Z", ...over })).shell?.status ?? null;

  it("도는 동안은 끝 줄이 없다", () => {
    expect(status({ status: "in_progress" }, { endedAt: null })).toBeNull();
  });

  it("끝나면 「성공」 · 0이 아닌 종료 코드면 「코드 종료 N」 · 코드를 모르는 실패면 「실패」다", () => {
    expect(status({ status: "completed" })).toBe("성공");
    expect(status({ status: "completed", rawOutput: { exit_code: 0 } })).toBe("성공");
    expect(status({ status: "failed", rawOutput: { exit_code: 101 } })).toBe("코드 종료 101");
    expect(status({ status: "failed" })).toBe("실패");
  });

  it("멈추거나 끊긴 명령은 「중지됨」이다", () => {
    expect(status({ status: "failed" }, { stop: "stopped" })).toBe("중지됨");
    expect(status({ status: "in_progress" }, { cut: true, endedAt: null })).toBe("중지됨");
  });
});
