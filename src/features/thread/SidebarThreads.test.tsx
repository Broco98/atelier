import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { FilterSegment, WaitingList } from "./SidebarThreads";
import type { ThreadSummary } from "./types";
import type { Waiting } from "./waiting";

// 정적 마크업 seam — 「전체 | 내 차례」 마디와 「내 차례만」 목록이 **무엇을 말하는가**를 본다(v1 티켓 42 · 캔버스 Sidebar 보드 「내 차례만」 ·
// 「내 차례만 · 비었을 때」). 무엇이 기다리는지 · 어떤 차례인지는 `waiting.test.ts`가 보고, 여기로는 그 결과만 들어온다. 누르면 무엇이
// 바뀌는지는 정적 렌더에 없다 — 시안 비교 캡처와 L3(45)가 본다.

const render = (node: ReactNode) =>
  renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
/** 태그를 걷은 보이는 글 — 줄 사이는 한 칸으로. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** 그 이름의 칸 버튼 하나(여는 태그부터 닫는 태그까지). */
const cellOf = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>${label}.*?</button>`))?.[0] ?? "";

const summary = (id: string, title: string): ThreadSummary => ({
  id,
  title,
  createdAt: "2026-10-10T09:00:00.000+09:00",
  work: null,
  handles: ["host"],
  lastRead: 0,
  broken: null,
});

describe("「전체 | 내 차례」 마디", () => {
  it("두 칸이 서고 고른 칸이 눌려 있다", () => {
    const html = render(<FilterSegment filter="all" count={0} onChange={() => {}} />);
    expect(cellOf(html, "전체")).toContain('aria-pressed="true"');
    expect(cellOf(html, "내 차례")).toContain('aria-pressed="false"');
    const mine = render(<FilterSegment filter="mine" count={0} onChange={() => {}} />);
    expect(cellOf(mine, "내 차례")).toContain('aria-pressed="true"');
  });

  it("「내 차례」 칸에 기다리는 Thread 수가 서고, 없으면 수가 없다", () => {
    const two = cellOf(render(<FilterSegment filter="all" count={2} onChange={() => {}} />), "내 차례");
    expect(textOf(two)).toBe("내 차례 2");
    expect(two).toContain('aria-label="내 차례 2"');
    expect(textOf(cellOf(render(<FilterSegment filter="mine" count={0} onChange={() => {}} />), "내 차례"))).toBe("내 차례");
  });
});

describe("내 차례만", () => {
  const waiting: Waiting[] = [
    { thread: summary("a", "환불 API 버그 고쳐줘"), since: "2026-10-10T10:00:00.000+09:00", text: "승인 · pnpm prisma migrate dev" },
    { thread: summary("b", "결제 페이지 리디자인"), since: "2026-10-10T10:18:00.000+09:00", text: "승인 · pnpm playwright test" },
  ];
  const list = (items: Waiting[]) =>
    render(<WaitingList waiting={items} peopleOf={() => []} current={null} now={0} onOpen={() => {}} />);

  it("「기다리는 순서」 아래에 받은 차례 그대로 선다", () => {
    const text = textOf(list(waiting));
    expect(text.startsWith("기다리는 순서")).toBe(true);
    expect(text.indexOf("환불 API 버그 고쳐줘")).toBeLessThan(text.indexOf("결제 페이지 리디자인"));
  });

  it("비었으면 「지금은 나를 기다리는 Thread가 없어요」 한 줄이다", () => {
    expect(textOf(list([]))).toBe("지금은 나를 기다리는 Thread가 없어요");
  });
});
