/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { foldThread, type ToolEntry } from "./fold";
import type { RecordLine } from "./types";
import { InnerTools, ToolRows } from "./WorkLog";

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
    expect(markup).toContain('aria-label="note.md 읽음"');
    expect(markup).toMatch(/border-l/);
  });
});
