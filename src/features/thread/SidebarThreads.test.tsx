/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { threadQuery } from "./hooks";
import { WaitingList, WorkThreadList } from "./SidebarThreads";
import { mergeLines } from "./thread-store";
import type { RecordLine, ThreadSummary, ThreadView } from "./types";
import type { Waiting } from "./waiting";

// 정적 마크업 seam — 「내 차례만」 목록 · Work 아래 Thread 줄이 **무엇을 말하는가**를 본다(v1 티켓 42 · 캔버스 Sidebar 보드 「내 차례만」 ·
// 「내 차례만 · 비었을 때」 · 02 티켓 05). 그것을 켜는 위 줄 「내 차례」 행의 글자는 `components/shell/sidebar-item.test.tsx`가 본다. 무엇이
// 기다리는지 · 어떤 차례인지는 `waiting.test.ts`가, 줄의 상태가 무엇인지는 `status.test.ts`가 보고, 여기로는 그 결과만 들어온다. 누르면
// 무엇이 바뀌는지는 정적 렌더에 없다 — 시안 비교 캡처와 L3가 본다.

/** Thread를 열 때와 같은 캐시(`threadQuery`)를 미리 채운 판 — 줄은 그 캐시와 기록 줄 스토어에서 상태를 읽는다. */
const render = (node: ReactNode, client = new QueryClient()) =>
  renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
/** 태그를 걷은 보이는 글 — 줄 사이는 한 칸으로. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const summary = (id: string, title: string): ThreadSummary => ({
  id,
  title,
  createdAt: "2026-10-10T09:00:00.000+09:00",
  work: null,
  handles: ["host"],
  lastRead: 0,
  readOnly: null,
  broken: null,
});

/** 엔진 검사(L1)가 축복한 기록 — 줄의 상태를 실제 기록으로 세운다(`status.test.ts`와 같은 바탕). */
const record = (name: string): RecordLine[] =>
  readFileSync(fileURLToPath(new URL(`../../../crates/atelier-acp/tests/records/${name}.jsonl`, import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as RecordLine);

/** 그 Thread를 이미 읽은 캐시 — 떠 있는 Session 없이 기록 끝까지다. 기록 줄은 스토어에 합친다(Thread를 열 때와 같은 자리). */
function readThread(client: QueryClient, id: string, lines: RecordLine[]): void {
  const view = { id, live: false, lastSeq: lines[lines.length - 1].seq } as ThreadView;
  client.setQueryData(threadQuery(id).queryKey, view);
  mergeLines(id, lines);
}

describe("내 차례만", () => {
  const waiting: Waiting[] = [
    { thread: summary("a", "환불 API 버그 고쳐줘"), since: "2026-10-10T10:00:00.000+09:00", text: "승인 · pnpm prisma migrate dev" },
    { thread: summary("b", "결제 페이지 리디자인"), since: "2026-10-10T10:18:00.000+09:00", text: "승인 · pnpm playwright test" },
  ];
  const list = (items: Waiting[]) => render(<WaitingList waiting={items} current={null} onOpen={() => {}} />);

  it("「기다리는 순서」 아래에 받은 차례 그대로 선다", () => {
    const text = textOf(list(waiting));
    expect(text.startsWith("기다리는 순서")).toBe(true);
    expect(text.indexOf("환불 API 버그 고쳐줘")).toBeLessThan(text.indexOf("결제 페이지 리디자인"));
  });

  it("비었으면 「지금은 나를 기다리는 Thread가 없어요」 한 줄이다", () => {
    expect(textOf(list([]))).toBe("지금은 나를 기다리는 Thread가 없어요");
  });
});

// **Thread 줄은 제목 한 줄이다**(02 구현 스펙 §4 · 티켓 05 · 캔버스 Diff-Frame 「제안」) — 얼굴 · 시각 · 미리보기 · 둘째 줄을 걷었고, 상태는 줄
// 오른쪽 끝의 표시 하나다(`StatusMark`). 펼친 Work 아래 줄(v1 티켓 37)도 같은 `ThreadRow`이고 들여 쓸 뿐이다. Work 목록 상자의 Tab 정류장 하나에
// 든다(roving — 정류장인 줄만 `tabindex="0"`). 줄 높이 · 들여쓰기 · 표시의 자리는 시안 비교와 L3가 잰다.
describe("Thread 줄", () => {
  const threads = [summary("a", "환불 API 버그 고쳐줘"), summary("b", "PR #142 리뷰")];
  const list = (current: string | null, stop: string | null, client?: QueryClient, items = threads) =>
    render(<WorkThreadList threads={items} current={current} stop={stop} onOpen={() => {}} />, client);
  const rowsOf = (html: string) => html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const marksOf = (html: string) => [...html.matchAll(/data-mark="([^"]*)"/g)].map((m) => m[1]);

  it("받은 차례 그대로 서고, 줄마다 제목 한 줄뿐이다 — 얼굴 · 시각 · 미리보기가 없다", () => {
    const rows = rowsOf(list(null, null));
    expect(rows).toHaveLength(2);
    expect(rows.map(textOf)).toEqual(["환불 API 버그 고쳐줘", "PR #142 리뷰"]);
    for (const row of rows) {
      // 얼굴(`ThreadFaces` · `HostFace`)은 svg · 글자 상자였다 — 줄 안에 그림이 하나도 없다.
      expect(row).not.toContain("<svg");
      expect(row).not.toContain("<img");
    }
  });

  it("상태가 있으면 제목 뒤 오른쪽 끝에 표시 하나가 서고, 그 말이 줄의 이름에 붙는다", () => {
    const client = new QueryClient();
    // 두 턴을 마치고 읽지 않았다 — 새 결과다(`status.test.ts` 「새 결과」).
    readThread(client, "a", record("thread-two-turns"));
    const [a = "", b = ""] = rowsOf(list(null, null, client));
    expect(marksOf(a)).toEqual(["new"]);
    expect(a.indexOf("환불 API 버그 고쳐줘")).toBeLessThan(a.indexOf('data-mark="new"'));
    expect(a).toContain('aria-label="새 결과"');
    // 새 결과는 굵은 제목이 아니다 — 표시가 말한다.
    expect(a).not.toContain("font-semibold");
    expect(marksOf(b)).toEqual([]);
  });

  it("멈춘 Thread에는 표시가 없다", () => {
    // 기록 줄 스토어는 앱에 하나라 Thread마다 다른 id로 읽는다 — 같은 id면 앞 검사의 기록과 seq로 합쳐진다.
    const client = new QueryClient();
    readThread(client, "stopped", record("thread-stopped"));
    const [row = ""] = rowsOf(list(null, null, client, [summary("stopped", "배포 스크립트 정리")]));
    expect(marksOf(row)).toEqual([]);
    expect(textOf(row)).toBe("배포 스크립트 정리");
  });

  it("지금 보는 Thread의 줄이 켜진다", () => {
    const [a, b] = rowsOf(list("b", null));
    expect(a).not.toContain("aria-current");
    expect(b).toContain('aria-current="page"');
  });

  it("목록의 정류장인 줄만 Tab이 앉고, 줄마다 목록 키를 단다", () => {
    const [a, b] = rowsOf(list(null, "thread:b"));
    expect(a).toContain('tabindex="-1"');
    expect(a).toContain('data-roving="thread:a"');
    expect(b).toContain('tabindex="0"');
    expect(b).toContain('data-roving="thread:b"');
  });
});
