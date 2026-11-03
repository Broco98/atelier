import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threadsQuery } from "@/features/thread/hooks";
import type { ThreadSummary } from "@/features/thread/types";
import { worksQuery } from "@/features/works/hooks";
import type { WorkView } from "@/features/works/types";
import { projectsQuery } from "./hooks";
import ProjectsPlace from "./ProjectsPage";
import type { ProjectView } from "./types";

// Projects 목록(restart 03-1 · 보드 MainProjects · PlaceSheet 「규격」 · 「목록 상태」) — seam은 그린 꼴(markup)이다(이 저장소의 L2에는 DOM이 없다).
// 누르고 치는 것(⌘F · 돌아오면 찾는 글 · 정렬 · 스크롤이 그대로 · 움직임)은 L3가 잰다. 값은 꾸민 것이다.

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

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const project = (slug: string, over: Partial<ProjectView> = {}): ProjectView => ({
  slug,
  name: slug,
  path: `~/code/${slug}`,
  baseBranch: "main",
  createdAt: "2026-09-01",
  description: "",
  git: null,
  missing: false,
  ...over,
});

const chat = (id: string, lastAt: string, over: Partial<ThreadSummary>): ThreadSummary => ({
  id,
  title: id,
  createdAt: "2026-09-01T09:00:00.000+09:00",
  lastAt,
  work: null,
  service: null,
  project: null,
  lastRead: 0,
  readOnly: null,
  broken: null,
  ...over,
});

const PROJECTS = [
  project("web-app"),
  project("api-server"),
  project("playground", { missing: true, path: "~/old/playground" }),
  project("docs-site"),
];
const WORKS = [{ slug: "refund-hook", projects: ["api-server"] }] as unknown as WorkView[];
const THREADS = [
  chat("작업공간 채팅", minutesAgo(12), { work: "refund-hook" }),
  chat("범위 채팅", minutesAgo(3 * 24 * 60), { project: "web-app" }),
  chat("옛 범위 채팅", minutesAgo(15 * 24 * 60), { project: "docs-site" }),
];

function render(projects: ProjectView[] = PROJECTS) {
  const client = new QueryClient();
  client.setQueryData(projectsQuery().queryKey, projects);
  client.setQueryData(worksQuery().queryKey, WORKS);
  client.setQueryData(threadsQuery().queryKey, THREADS);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProjectsPlace />
    </QueryClientProvider>,
  );
}

/** 몸의 줄들 — 이름(이름 링크의 글)마다 그 줄의 꼴. 머리 줄은 링크가 없다. */
const rowsOf = (html: string) =>
  [...html.matchAll(/<div><div role="row"[^>]*>([\s\S]*?)<\/div><\/div>/g)].map((row) => [
    row[0],
    row[1].match(/<a [^>]*>([^<]+)<\/a>/)?.[1] ?? "",
    row[1],
  ]);
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("Projects 목록", () => {
  it("줄은 최근 활동 순이고, 활동이 없는 줄은 끝에 「—」로 선다", () => {
    const rows = rowsOf(render());
    expect(rows.map((row) => row[1])).toEqual(["api-server", "web-app", "docs-site", "playground"]);
    expect(rows.map((row) => textOf(row[2]))).toEqual([
      "api-server ~/code/api-server 12분",
      "web-app ~/code/web-app 3일",
      "docs-site ~/code/docs-site 2주",
      "playground 폴더를 찾을 수 없어요 · ~/old/playground — 재설정",
    ]);
  });

  it("줄 오른쪽은 ⋯ · 작업공간 만들기 · 새 채팅이고, 폴더를 찾을 수 없는 줄은 재설정 · ⋯이다", () => {
    const labels = (row: string) => [...row.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    const rows = Object.fromEntries(rowsOf(render()).map((row) => [row[1], row[2]]));
    expect(labels(rows["web-app"])).toEqual(["web-app 메뉴", "web-app 범위로 작업공간 만들기", "web-app 범위로 새 채팅"]);
    expect(textOf(rows.playground)).toContain("재설정");
    expect(labels(rows.playground)).toEqual(["playground 메뉴"]);
    expect(rows.playground).toMatch(/>재설정<\/button><button[^>]*aria-label="playground 메뉴"/);
  });

  it("머리는 제목 · ⌘F로 서는 찾기 칸 · Project 추가이고, 표의 열 머리는 이름 · 최근 활동(지금 정렬 — 내림차순)이다", () => {
    const html = render();
    expect(html).toMatch(/<h1[^>]*>Projects<\/h1>/);
    expect(html).toMatch(/<input type="search"[^>]*placeholder="Project 찾기"[^>]*aria-label="Project 찾기"[^>]*aria-keyshortcuts="Meta\+F"/);
    expect(textOf(html)).toContain("Project 추가");
    expect(html).toContain('<div role="table" aria-label="Project 목록">');
    const heads = [...html.matchAll(/<span role="columnheader"( aria-sort="(\w+)")?><button type="button"[^>]*>([^<]+)</g)].map((m) => [m[3], m[2] ?? null]);
    expect(heads).toEqual([
      ["이름", null],
      ["최근 활동", "descending"],
    ]);
  });

  it("Project가 없으면 찾기 칸 없이 할 일이 가운데에 선다", () => {
    const html = render([]);
    expect(html).not.toContain('type="search"');
    expect(textOf(html)).toContain("등록한 Project가 없어요 폴더를 이 화면에 끌어다 놓거나 Project를 추가하면, 그 폴더를 범위로 채팅하고 작업공간을 만들 수 있어요. Project 추가");
  });
});
