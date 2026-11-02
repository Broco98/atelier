/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { foldThread, type ToolEntry } from "./fold";
import type { RecordLine } from "./types";
import { CopyButton } from "./CopyButton";
import { DocPlace } from "./ThreadFlow";
import { DiffCard, InnerTools, ToolRows } from "./WorkLog";

// 방패 줄(v1 티켓 23 · 캔버스 WorkLog 보드 「자동 허용 줄」) — 판정이 묻지 않고 허용한 도구 줄 앞에 「자동으로 허용함」 · 대상 · 까닭 알약이
// 선다. 까닭의 말은 `approval.test.ts`의 「방패 줄의 까닭」이 재고, 여기서는 그 말이 알약에 서는지를 정적 마크업으로 잰다(02 코드 리뷰 A1 —
// 한때 엔진의 이름 「이 Work에서는 다시 묻지 않기」가 그대로 서서, 같은 화면의 카드 · 결정 줄과 두 말이 섰다).
describe("방패 줄", () => {
  const write = (allowed: string): ToolEntry => ({
    kind: "tool",
    key: "k-1",
    toolCallId: "t-1",
    call: { toolCallId: "t-1", kind: "edit", title: "Write notes.md", status: "completed", locations: [{ path: "/w/notes.md" }] },
    output: "",
    inner: [],
    stop: null,
    cut: false,
    denied: false,
    allowed,
    asking: false,
    startedAt: "2026-10-10T10:00:00.000+09:00",
    endedAt: "2026-10-10T10:00:01.000+09:00",
  });
  const pill = (allowed: string) => {
    const markup = renderToStaticMarkup(<ToolRows tools={[write(allowed)]} />);
    const line = markup.match(/<p data-auto-allowed="[^"]*"[^>]*>.*?<\/p>/)?.[0] ?? "";
    expect(line).toContain("자동으로 허용함");
    return line.match(/<span[^>]*>([^<]*)<\/span><\/p>$/)?.[1];
  };

  it("허락으로 넘어간 편집이면 카드의 말이 알약에 선다", () => {
    expect(pill("이 Work에서는 다시 묻지 않기")).toBe("이 작업공간의 모든 편집 허용");
    expect(pill("이 Thread에서는 다시 묻지 않기")).toBe("이 채팅의 모든 편집 허용");
  });

  it("물어보는 정도의 까닭은 그대로 선다", () => {
    expect(pill("편집 자동")).toBe("편집 자동");
  });
});

// 서브에이전트 줄(01b-7 · 스토리 63 · 캔버스 Tools 보드 「서브에이전트」) — 기록된 안쪽 도구가 있으면 줄을 펼쳐 볼 수 있고, 없으면 도구 줄 하나로
// 내려간다. 바탕은 엔진이 `edit-subagent` 녹음으로 쓴 기록이다. 펼친 안은 정적 마크업에서 접혀 있어 그 안의 그리기를 따로 잰다.
describe("서브에이전트 줄", () => {
  const lines = readFileSync(fileURLToPath(new URL("../../../crates/atelier-acp/tests/records/thread-subagent.jsonl", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);
  const agentThrough = (seq: number): ToolEntry => {
    const entries = foldThread(lines.filter((line) => line.seq <= seq)).turns[1].entries;
    const agent = entries.find((entry): entry is ToolEntry => entry.kind === "tool");
    if (!agent) throw new Error("Agent 도구 줄이 없다");
    return agent;
  };
  const expanders = (tool: ToolEntry) => renderToStaticMarkup(<ToolRows tools={[tool]} />).match(/aria-expanded="[^"]*"/g) ?? [];

  it("안쪽 도구가 아직 없고 돌려준 글도 없으면 펼칠 것 없는 도구 줄 하나다", () => {
    expect(expanders(agentThrough(16))).toEqual([]);
  });

  it("안쪽 도구가 서면 도는 동안에도 줄을 펼쳐 볼 수 있다", () => {
    const running = agentThrough(20);
    expect(running.call.status).toBe("in_progress");
    expect(expanders(running)).toEqual(['aria-expanded="false"']);
  });

  it("펼친 안에는 안쪽 도구가 제 도구 줄로 선다", () => {
    const markup = renderToStaticMarkup(<InnerTools tools={agentThrough(26).inner} />);
    expect(markup).toContain('aria-label="읽음 note.md"');
    expect(markup).toMatch(/border-l/);
  });
});

// 도구 줄의 모양(restart 02b-4 · Tools 보드 「도구 줄 — 종류 × 상태」 · 「명령 출력」 · 「파일 변경」) — 문구는 `tool-view.test.ts`가 재고, 여기는 그 값이
// 줄의 무엇으로 서는지 정적 마크업으로 잰다: 멈춘 줄의 ■, 도는 줄의 반짝임, 명령 출력이 처음부터 펼쳐 있는지, 새 파일 점.
describe("도구 줄의 모양", () => {
  const line = (call: Record<string, unknown>, over: Partial<ToolEntry> = {}): ToolEntry => ({
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
  const markup = (tool: ToolEntry) => renderToStaticMarkup(<ToolRows tools={[tool]} />);
  const command = (status: string, rawOutput: Record<string, unknown> = {}) => ({
    kind: "execute",
    title: "pnpm test",
    status,
    rawInput: { command: "pnpm test" },
    rawOutput,
    content: [{ type: "content", content: { type: "text", text: "ok" } }],
  });

  it("멈춘 줄 · 끊긴 줄 · 거부한 줄은 글리프 자리에 ■가 서고, 반짝이지 않는다", () => {
    const read = { kind: "read", title: "Read /w/a.rs", locations: [{ path: "/w/a.rs" }] };
    for (const tool of [
      line({ ...read, status: "in_progress" }, { stop: "stopped" }),
      line({ ...read, status: "in_progress" }, { cut: true }),
      line({ ...read, status: "failed" }, { denied: true }),
    ]) {
      const html = markup(tool);
      expect(html).toContain('data-glyph="stopped"');
      expect(html).not.toContain('data-glyph="read"');
      expect(html).not.toContain("chat-shimmer");
    }
  });

  it("도는 줄은 「대상 동사」가 한 글로 반짝이고, 선 줄은 동사 뒤에 대상이 고정폭으로 선다", () => {
    const read = { kind: "read", title: "Read /w/a.rs", locations: [{ path: "/w/a.rs" }] };
    expect(markup(line({ ...read, status: "in_progress" }))).toMatch(/chat-shimmer[^"]*">a\.rs 읽는 중</);
    expect(markup(line({ ...read, status: "completed" }))).toMatch(/>읽음<\/span><span class="[^"]*font-mono[^"]*">a\.rs</);
  });

  it("명령 출력은 도는 동안 · 실패하면 펼쳐 서고, 성공한 채 처음 그린 줄은 접혀 선다", () => {
    expect(markup(line(command("in_progress")))).toContain('aria-expanded="true"');
    const failed = markup(line(command("failed", { exit_code: 1 }), { endedAt: "2026-11-03T10:00:02.000Z" }));
    expect(failed).toContain('aria-expanded="true"');
    expect(failed).toContain("코드 종료 1");
    expect(markup(line(command("completed", { exit_code: 0 }), { endedAt: "2026-11-03T10:00:02.000Z" }))).toContain('aria-expanded="false"');
  });

  it("옛 글 없이 쓴 파일은 「생성됨」 뒤에 새 파일 점이 선다", () => {
    const html = markup(
      line(
        { kind: "edit", title: "Write /w/b.ts", status: "completed", content: [{ type: "diff", path: "/w/b.ts", oldText: null, newText: "b\n" }] },
        { endedAt: "2026-11-03T10:00:01.000Z" },
      ),
    );
    expect(html).toContain('aria-label="생성됨 b.ts"');
    expect(html).toContain('data-dot="created"');
  });

  // Tools · Thread 보드 「변경 카드」 머리의 `.ra-ic-btn` 「변경 복사」 — 내 말 · 답 · 코드 블록의 복사와 같은 단추다(26 · 둥근 8 · 글리프 14 ·
  // `fg-tertiary`, 누르면 ✓가 1.6초 섰다 돌아온다 — `CopyButton`, restart 02b-6b). 한때 24 · `fg-tool`에 ✓가 돌아오지 않았다.
  it("변경 카드의 「변경 복사」는 대화의 복사 단추와 같은 단추다", () => {
    const piece = { path: "/w/src/watcher.rs", written: false, lines: [{ type: "add" as const, text: "retry();" }], added: 1, deleted: 0 };
    const button = (html: string) => html.match(/<button[^>]*aria-label="변경 복사"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
    const inCard = button(renderToStaticMarkup(<DiffCard piece={piece} />));
    expect(inCard).not.toBe("");
    const alone = button(renderToStaticMarkup(<CopyButton text="+retry();" label="변경 복사" className="ml-auto" />));
    expect(inCard).toBe(alone);
  });

  // Thread 보드 · States 08(restart 02b-6) — 이은 작업공간의 spec 폴더에 새로 쓴 문서는 문서 글리프 · 「생성됨 재시도-규칙.md」 · 새 파일 점이고, 셈과
  // 셰브런이 없는 줄이다(보드 `canOpen` 없음). 같은 글을 spec 폴더를 모르는 채팅에서 그리면 코드 파일처럼 연필 · `+N −N` · 펼칠 diff다.
  it("spec 폴더에 새로 쓴 문서는 문서 글리프의 셈 · 펼침 없는 줄이다", () => {
    const spec = "/h/.atelier/works/watcher/spec";
    const doc = line(
      {
        kind: "edit",
        title: `Write ${spec}/01-실패-신호/재시도-규칙.md`,
        status: "completed",
        content: [{ type: "diff", path: `${spec}/01-실패-신호/재시도-규칙.md`, oldText: null, newText: "# 재시도 규칙\n" }],
      },
      { endedAt: "2026-11-03T10:00:01.100Z" },
    );
    const inWork = renderToStaticMarkup(
      <DocPlace.Provider value={{ specRoot: spec, open: () => {} }}>
        <ToolRows tools={[doc]} />
      </DocPlace.Provider>,
    );
    expect(inWork).toContain('aria-label="생성됨 재시도-규칙.md"');
    expect(inWork).toContain('data-glyph="doc"');
    expect(inWork).toContain('data-dot="created"');
    expect(inWork).not.toContain("text-diff-added");
    expect(inWork).not.toContain("aria-expanded");

    const loose = markup(doc);
    expect(loose).toContain('data-glyph="edit"');
    expect(loose).toContain("text-diff-added");
    expect(loose).toContain('aria-expanded="false"');
  });
});
