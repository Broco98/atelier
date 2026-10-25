import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { WaitingList, WorkThreadList } from "./SidebarThreads";
import type { ThreadSummary } from "./types";
import type { Waiting } from "./waiting";

// 정적 마크업 seam — 「내 차례만」 목록이 **무엇을 말하는가**를 본다(v1 티켓 42 · 캔버스 Sidebar 보드 「내 차례만」 · 「내 차례만 · 비었을
// 때」). 그것을 켜는 위 줄 「내 차례」 행의 글자는 `components/shell/sidebar-item.test.tsx`가 본다. 무엇이 기다리는지 · 어떤 차례인지는 `waiting.test.ts`가 보고, 여기로는 그 결과만 들어온다. 누르면 무엇이
// 바뀌는지는 정적 렌더에 없다 — 시안 비교 캡처와 L3(45)가 본다.

const render = (node: ReactNode) =>
  renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
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

// v1 티켓 37 · 캔버스 Sidebar 보드 `.nest` — 펼친 Work 아래 Thread 줄. 줄은 Thread 묶음과 같은 `ThreadRow`라 상태 칸이 따라오고, 얼굴만 28로
// 작다(보드). Work 목록 상자의 Tab 정류장 하나에 든다(roving — 정류장인 줄만 `tabindex="0"`).
describe("Work 아래 Thread 줄", () => {
  const threads = [summary("a", "환불 API 버그 고쳐줘"), summary("b", "PR #142 리뷰")];
  const people = () => [{ handle: "host", avatar: null }];
  const list = (current: string | null, stop: string | null) =>
    render(
      <WorkThreadList
        threads={threads}
        peopleOf={people}
        current={current}
        now={0}
        stop={stop}
        onOpen={() => {}}
      />,
    );
  const rowsOf = (html: string) => html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];

  it("받은 차례 그대로 두 줄로 서고, 얼굴은 28이다", () => {
    const html = list(null, null);
    const text = textOf(html);
    expect(text.indexOf("환불 API 버그 고쳐줘")).toBeLessThan(text.indexOf("PR #142 리뷰"));
    expect(rowsOf(html)).toHaveLength(2);
    expect(html).toContain("size-7");
    expect(html).not.toContain("size-8");
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
