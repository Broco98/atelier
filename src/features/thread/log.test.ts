/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { foldThread, type ToolEntry } from "./fold";
import { changedFiles, elapsed, logRows } from "./log";
import { describeTool, phraseText, shownPath } from "./tool-view";
import type { RecordLine } from "./types";

// 작업 로그(v1 티켓 05 · 캔버스 WorkLog 보드) — 접은 도구 줄을 사람이 읽는 한 줄(대상 + 동사)로, 이어진 읽기 · 찾기를 묶음 줄로,
// 마지막 턴의 편집을 바뀐 파일 알약의 셈으로 옮긴다. seam은 순수 함수 셋(`describeTool` · `logRows` · `changedFiles`)이고, 그리는 쪽
// (`WorkLog.tsx`)은 여기 나온 값만 그린다. 문구의 정본은 보드의 글자다.
const blessed: RecordLine[] = readFileSync(
  fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-two-turns.jsonl", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as RecordLine);

/** 손으로 짓는 도구 줄 — 접기를 거치지 않고 `ToolEntry` 하나. */
const tool = (call: Record<string, unknown>, extra: Partial<ToolEntry> = {}): ToolEntry => ({
  kind: "tool",
  key: `k-${String(call.toolCallId ?? call.title)}`,
  toolCallId: String(call.toolCallId ?? call.title),
  call,
  output: "",
  stop: null,
  cut: false,
  denied: false,
  allowed: null,
  startedAt: "2026-10-10T10:00:00.000+09:00",
  endedAt: null,
  ...extra,
});
const claude = (toolName: string) => ({ claudeCode: { toolName } });

describe("도구 줄의 문구 — 대상은 고정폭, 끝나면 과거형", () => {
  it("축복한 기록의 세 도구: 쓰기 · 읽기 · 명령", () => {
    const tools = foldThread(blessed).turns[1].entries.filter((entry): entry is ToolEntry => entry.kind === "tool");
    expect(tools.map((one) => phraseText(describeTool(one).phrase))).toEqual([
      "notes.txt 작성함",
      "notes.txt 읽음",
      "wc -c /tmp/gate/ws/g3/wt/notes.txt 실행함",
    ]);
    expect(describeTool(tools[0]).diffs.map((piece) => [piece.added, piece.deleted])).toEqual([[1, 0]]);
    expect(describeTool(tools[2]).shell?.output).toBe("       4 /tmp/gate/ws/g3/wt/notes.txt");
  });

  it("하는 중에는 현재형이다", () => {
    const running = [
      tool({ title: "Read src/refund.service.ts", kind: "read", status: "in_progress", locations: [{ path: "/w/refund.service.ts" }] }),
      tool({ title: "RefundService", kind: "search", status: "in_progress" }),
      tool({
        title: "Edit refund.service.ts",
        kind: "edit",
        status: "in_progress",
        content: [{ type: "diff", path: "/w/refund.service.ts", oldText: "a", newText: "b" }],
      }),
      tool({ title: "pnpm test refunds", kind: "execute", status: "in_progress" }),
      tool({ title: "atelier_get_work", kind: "other", status: "pending", _meta: claude("mcp__atelier__get_work") }),
    ];
    expect(running.map((one) => phraseText(describeTool(one).phrase))).toEqual([
      "refund.service.ts 읽는 중",
      "RefundService 찾는 중",
      "refund.service.ts 고치는 중",
      "pnpm test refunds 실행 중",
      "atelier.get_work 부르는 중",
    ]);
  });

  it("끝난 편집 · 찾기 · 웹 검색 · MCP", () => {
    const done = [
      tool({
        title: "Edit refund.service.ts",
        kind: "edit",
        status: "completed",
        content: [{ type: "diff", path: "/w/refund.service.ts", oldText: "a\nb\n", newText: "a\nc\nd\n" }],
      }),
      tool({ title: "RefundService", kind: "search", status: "completed" }),
      tool({ title: "prisma decimal", kind: "fetch", status: "completed", rawInput: { query: "prisma decimal" }, _meta: claude("WebSearch") }),
      tool({ title: "atelier_get_work", kind: "other", status: "completed", _meta: claude("mcp__atelier__get_work") }),
    ];
    expect(done.map((one) => phraseText(describeTool(one).phrase))).toEqual([
      "refund.service.ts 수정함",
      "RefundService 찾음",
      "웹에서 prisma decimal 찾아봄",
      "atelier.get_work 불러옴",
    ]);
    expect(describeTool(done[0]).diffs.map((piece) => [piece.added, piece.deleted])).toEqual([[2, 1]]);
  });

  it("Agent 부르기 Thread 도구는 맡긴 일이 전해지기 전에도 「@reviewer에게 맡기는 중」이다 — 거절되면 그 까닭이 받은 값이다(v1 티켓 17)", () => {
    const call = (status: string, extra: Record<string, unknown> = {}) =>
      tool({
        title: "mcp__atelier-thread__call_agent",
        kind: "other",
        status,
        rawInput: { handle: "@reviewer", task: "봐 줘" },
        _meta: claude("mcp__atelier-thread__call_agent"),
        ...extra,
      });
    expect(phraseText(describeTool(call("in_progress")).phrase)).toBe("@reviewer에게 맡기는 중");
    const refused = describeTool(
      call("failed", { content: [{ type: "content", content: { type: "text", text: "@reviewer — 지금 호출 고리 안에 있어 다시 부를 수 없어요" } }] }),
    );
    expect(phraseText(refused.phrase)).toBe("@reviewer에게 맡기지 못함");
    expect(refused.mcp).toMatchObject({ received: "@reviewer — 지금 호출 고리 안에 있어 다시 부를 수 없어요", receivedCode: false });
  });

  it("MCP 상자의 받은 값은 글이면 본문 글꼴, JSON이면 고정폭이다(보드 「MCP 호출」)", () => {
    const got = (text: string) =>
      describeTool(
        tool({
          title: "atelier_get_work",
          kind: "other",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text } }],
          _meta: claude("mcp__atelier__get_work"),
        }),
      ).mcp;
    expect(got("Work 1개 · Project api-server · worktree 아직 없음")).toMatchObject({ receivedCode: false });
    expect(got('{"slug":"refund-api"}')).toMatchObject({ received: '{\n  "slug": "refund-api"\n}', receivedCode: true });
  });

  it("변경 상자의 경로는 그 Session의 작업 폴더에서 본 자리다 — 밖이면 그대로다", () => {
    expect(shownPath("/Users/me/api/src/refunds/refund.service.ts", "/Users/me/api")).toBe("src/refunds/refund.service.ts");
    expect(shownPath("/Users/me/api/notes.txt", "/Users/me/api/")).toBe("notes.txt");
    expect(shownPath("/Users/me/api-old/a.ts", "/Users/me/api")).toBe("/Users/me/api-old/a.ts");
    expect(shownPath("/etc/hosts", null)).toBe("/etc/hosts");
  });

  it("찾기의 대상은 변환기가 붙인 제목(「Search …」 · 「Find …」)이 아니라 찾은 무늬다", () => {
    const searches = [
      tool({ title: "Search RefundService", kind: "search", status: "completed", rawInput: { pattern: "RefundService" } }),
      tool({ title: "Find src/**/*.spec.ts", kind: "search", status: "in_progress", rawInput: { pattern: "src/**/*.spec.ts" } }),
    ];
    expect(searches.map((one) => phraseText(describeTool(one).phrase))).toEqual([
      "RefundService 찾음",
      "src/**/*.spec.ts 찾는 중",
    ]);
  });

  it("실패 · 중단 · 거절은 색이 아니라 문장이다", () => {
    const failed = tool({
      title: "pnpm lint",
      kind: "execute",
      status: "failed",
      rawOutput: { exit_code: 1 },
    });
    expect(describeTool(failed).phrase).toMatchObject({ subject: "pnpm lint", verb: "실행하지 못함", tail: " · 코드 종료 1", failed: true });

    const stopped = tool({ title: "pnpm test", kind: "execute", status: "failed" }, {
      stop: "stopped",
      startedAt: "2026-10-10T10:00:00.000+09:00",
      endedAt: "2026-10-10T10:00:12.000+09:00",
    });
    expect(phraseText(describeTool(stopped).phrase)).toBe("pnpm test 중단함 · 12초");

    const denied = tool({ title: "pnpm prisma migrate dev", kind: "execute", status: "failed" }, { denied: true });
    expect(phraseText(describeTool(denied).phrase)).toBe("pnpm prisma migrate dev 실행하지 않음 · 내가 거절함");
  });

  it("명령 출력의 끝 줄은 종료 코드와 걸린 시간이다 — 코드를 모르면 끝남 · 실패로 말한다", () => {
    const ok = tool({ title: "pnpm test", kind: "execute", status: "completed", rawOutput: { exit_code: 0 } }, {
      endedAt: "2026-10-10T10:00:04.200+09:00",
    });
    expect(describeTool(ok).shell?.status).toBe("코드 종료 0 · 4.2초");
    const unknown = tool({ title: "ls", kind: "execute", status: "completed" }, { endedAt: "2026-10-10T10:00:01.000+09:00" });
    expect(describeTool(unknown).shell?.status).toBe("끝남 · 1.0초");
  });

  it("걸린 시간 — 10초 아래는 소수 한 자리, 그 위는 말로", () => {
    expect(elapsed(tool({}, { endedAt: "2026-10-10T10:00:04.230+09:00" }))).toBe("4.2초");
    expect(elapsed(tool({}, { endedAt: "2026-10-10T10:01:12.000+09:00" }))).toBe("1분 12초");
    expect(elapsed(tool({}))).toBeNull();
  });
});

describe("묶음 줄 — 이어진 읽기와 찾기만 묶는다", () => {
  const read = (name: string) =>
    tool({ toolCallId: name, title: `Read ${name}`, kind: "read", status: "completed", locations: [{ path: `/w/${name}` }] });
  const search = (name: string) => tool({ toolCallId: name, title: name, kind: "search", status: "completed" });
  const edit = tool({
    toolCallId: "e",
    title: "Edit a.ts",
    kind: "edit",
    status: "completed",
    content: [{ type: "diff", path: "/w/a.ts", oldText: "x", newText: "y" }],
  });

  it("읽기 넷 · 찾기 둘이 이어지면 「파일 4개 살펴봄 · 검색 2번」 한 줄이고, 고치기는 묶지 않는다", () => {
    const rows = logRows([read("a.ts"), read("b.ts"), search("partialRefund"), read("c.ts"), search("x"), read("a.ts"), read("d.ts"), edit]);
    expect(rows.map((row) => (row.kind === "group" ? row.label : phraseText(describeTool(row.tool).phrase)))).toEqual([
      "파일 4개 살펴봄 · 검색 2번",
      "a.ts 수정함",
    ]);
  });

  it("하나뿐이면 묶지 않고, 도는 줄은 묶음에 들지 않는다", () => {
    const running = tool({ toolCallId: "r", title: "Read z.ts", kind: "read", status: "in_progress", locations: [{ path: "/w/z.ts" }] });
    const rows = logRows([read("a.ts"), edit, search("q"), running]);
    expect(rows.map((row) => row.kind)).toEqual(["tool", "tool", "tool", "tool"]);
  });

  it("찾기만 이어지면 「검색 N번 함」이다", () => {
    const rows = logRows([search("a"), search("b")]);
    expect(rows.map((row) => row.kind === "group" && row.label)).toEqual(["검색 2번 함"]);
  });

  it("판정이 묻지 않고 허용한 줄은 묶지 않는다 — 제 방패 줄과 함께 서야 한다(v1 티켓 23)", () => {
    const allowed = { ...read("b.ts"), allowed: "알아서" };
    const rows = logRows([read("a.ts"), allowed, read("c.ts")]);
    expect(rows.map((row) => (row.kind === "tool" ? row.tool.allowed : row.kind))).toEqual([null, "알아서", null]);
  });
});

describe("바뀐 파일 알약 — 마지막 턴의 편집을 센다", () => {
  it("축복한 기록의 둘째 턴은 파일 하나 · +1 −0이다", () => {
    const turn = foldThread(blessed).turns[1];
    expect(changedFiles(turn)).toEqual({ files: [{ path: "/tmp/gate/ws/g3/wt/notes.txt", added: 1, deleted: 0 }], added: 1, deleted: 0 });
  });

  it("같은 파일을 두 번 고치면 한 파일로 더하고, 고친 것이 없으면 null이다", () => {
    const turn = foldThread(blessed).turns[0];
    expect(changedFiles(turn)).toBeNull();
    const twice = {
      ...turn,
      entries: [
        tool({ toolCallId: "1", kind: "edit", status: "completed", content: [{ type: "diff", path: "/w/a.ts", oldText: "a", newText: "b\nc" }] }),
        tool({ toolCallId: "2", kind: "edit", status: "completed", content: [{ type: "diff", path: "/w/b.ts", oldText: "a\nb", newText: "a" }] }),
        tool({ toolCallId: "3", kind: "edit", status: "completed", content: [{ type: "diff", path: "/w/a.ts", oldText: "c", newText: "d" }] }),
        tool({ toolCallId: "4", kind: "edit", status: "failed", content: [{ type: "diff", path: "/w/z.ts", oldText: "c", newText: "d" }] }),
      ],
    };
    expect(changedFiles(twice)).toEqual({
      files: [
        { path: "/w/a.ts", added: 3, deleted: 2 },
        { path: "/w/b.ts", added: 0, deleted: 1 },
      ],
      added: 3,
      deleted: 3,
    });
  });
});
