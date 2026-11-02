import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArchivePlace from "./ArchivePage";
import { archiveQuery } from "./hooks";
import type { ArchiveEntry } from "./types";

// Archive 목록(restart 03-4 · 보드 MainArchive · PlaceSheet 「세 화면」 · 「Archive 없음」 · Places `DATA.archive`) — seam은 그린 꼴(markup)이다(이 저장소의
// L2에는 DOM이 없다). 누르고 치는 것(⌘F · 줄 누름 → 상세 · 돌아오면 찾는 글 · 정렬 · 스크롤이 그대로 · 움직임)은 L3가 잰다. 값은 보드 장면을 따른
// 꾸민 것이다.

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({}),
  Outlet: () => null,
  // 라우터 없이 그린다 — 이름 링크는 갈 곳을 그대로 적는 맨 링크로.
  Link: ({ to, params, children, ...rest }: { to: string; params: { slug: string }; children: ReactNode }) => (
    <a href={to.replace("$slug", params.slug)} {...rest}>
      {children}
    </a>
  ),
}));
// 토스트 자리는 앱 셸의 공급자 안에서만 선다 — 여기서는 비운다.
vi.mock("@/components/ui/toast", async (original) => ({
  ...(await original<typeof import("@/components/ui/toast")>()),
  Toaster: () => null,
}));

const NOW = new Date(2026, 10, 3, 9, 0, 0);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const entry = (slug: string, title: string, over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  slug,
  title,
  status: "done",
  archivedAt: null,
  projects: ["atelier"],
  branch: null,
  ...over,
});

// 백엔드 차례(보관한 날 내림차순)와 다르게 준다 — 화면이 보관한 날 순으로 다시 세운다.
const ENTRIES = [
  entry("moved-folder", "old-notes", { status: "draft", projects: [] }),
  entry("three-axes", "세 축 구조", { archivedAt: "2026-10-12" }),
  entry("process-manager", "프로세스 매니저", { archivedAt: "2026-10-28" }),
  entry("pay-retry", "결제 재시도", { status: "review", archivedAt: "2025-09-30", projects: ["backend", "front"] }),
];

function render(entries: ArchiveEntry[] = ENTRIES) {
  const client = new QueryClient();
  client.setQueryData(archiveQuery().queryKey, entries);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ArchivePlace />
    </QueryClientProvider>,
  );
}

/** 몸의 줄들 — [이름 링크의 갈 곳, 이름, 줄의 꼴]. 머리 줄은 링크가 없다. */
const rowsOf = (html: string) =>
  [...html.matchAll(/<div><div role="row"[^>]*>([\s\S]*?)<\/div><\/div>/g)].map((row) => [
    row[1].match(/<a href="([^"]+)"/)?.[1] ?? "",
    row[1].match(/<a [^>]*>([^<]+)<\/a>/)?.[1] ?? "",
    row[1],
  ]);
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("Archive 목록", () => {
  it("줄은 보관한 날 순이고 이름 옆에 상태와 Project, 시각 칸에 그날이 선다 — 날이 없는 줄은 끝에 「—」다", () => {
    const rows = rowsOf(render());
    expect(rows.map((row) => row[0])).toEqual([
      "/archive/process-manager",
      "/archive/three-axes",
      "/archive/pay-retry",
      "/archive/moved-folder",
    ]);
    expect(rows.map((row) => textOf(row[2]))).toEqual([
      "프로세스 매니저 완료 · atelier 10월 28일",
      "세 축 구조 완료 · atelier 10월 12일",
      "결제 재시도 검토 · backend · front 2025년 9월 30일",
      "old-notes 초안 —",
    ]);
  });

  it("줄 오른쪽은 ⋯ 하나다 — 작업공간 만들기 · 새 채팅은 없다", () => {
    const labels = (row: string) => [...row.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(rowsOf(render()).map((row) => labels(row[2]))).toEqual([
      ["프로세스 매니저 메뉴"],
      ["세 축 구조 메뉴"],
      ["결제 재시도 메뉴"],
      ["old-notes 메뉴"],
    ]);
  });

  it("머리는 제목 · ⌘F로 서는 찾기 칸뿐이고(주 단추 없음), 표의 열 머리는 이름 · 보관한 날(지금 정렬 — 내림차순)이다", () => {
    const html = render();
    expect(html).toMatch(/<h1[^>]*>Archive<\/h1>/);
    expect(html).toMatch(/<input type="search"[^>]*placeholder="Archive 찾기"[^>]*aria-label="Archive 찾기"[^>]*aria-keyshortcuts="Meta\+F"/);
    const head = html.slice(html.indexOf("<h1"), html.indexOf('role="table"'));
    expect(head.match(/<button/g)).toBeNull();
    expect(html).toContain('<div role="table" aria-label="Archive 목록">');
    const heads = [...html.matchAll(/<span role="columnheader"( aria-sort="(\w+)")?><button type="button"[^>]*>([^<]+)</g)].map((m) => [m[3], m[2] ?? null]);
    expect(heads).toEqual([
      ["이름", null],
      ["보관한 날", "descending"],
    ]);
  });

  it("보관한 것이 없으면 찾기 칸 없이 가운데에 까닭이 서고, 할 일 단추는 없다", () => {
    const html = render([]);
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain("<button");
    expect(textOf(html)).toBe("Archive 보관한 작업공간이 없어요 작업공간을 종료하면 문서와 기록이 여기에 남아요.");
  });
});
