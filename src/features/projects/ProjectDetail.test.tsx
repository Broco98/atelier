import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { servicesQuery } from "@/features/services/hooks";
import type { Service } from "@/features/services/types";
import { threadsQuery } from "@/features/thread/hooks";
import type { ThreadSummary } from "@/features/thread/types";
import { worksQuery } from "@/features/works/hooks";
import type { WorkView } from "@/features/works/types";
import { projectsQuery } from "./hooks";
import ProjectDetail from "./ProjectDetail";
import type { ProjectView } from "./types";

// Project 상세(restart 03-2 · 스토리 114 · 119 · 보드 MainProjectDetail · PlaceSheet 「폴더를 찾을 수 없는 Project」) — seam은 그린 꼴(markup)이다(이
// 저장소의 L2에는 DOM이 없다). 누르는 것(재설정 창 · 뒤로 · 앞으로 · 줄 누름)과 움직임은 L3가 잰다. 값은 보드 장면을 따른 꾸민 것이다.

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => () => Promise.resolve(),
  // 라우터 없이 그린다 — 링크는 갈 곳을 그대로 적는 맨 링크로.
  Link: ({ to, params = {}, search: _search, children, ...rest }: { to: string; params?: Record<string, string>; search?: unknown; children: ReactNode }) => (
    <a href={to.replace(/\$(\w+)/g, (_, key: string) => params[key])} {...rest}>
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
  path: `~/MyProjects/${slug}`,
  baseBranch: "develop",
  createdAt: "2026-03-02",
  description: "",
  git: { remoteSlug: "atelier-app/atelier", currentBranch: "develop", localBranches: ["develop"], remoteBranches: [] },
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
  project("atelier", { description: "Tauri 데스크톱 앱. 로컬 개발 작업을 Project · Service · 작업공간으로 묶어 관리한다." }),
  project("legacy-admin", { path: "~/old/legacy-admin", baseBranch: "main", createdAt: "2026-02-03", git: null, missing: true, description: "옛 관리자 화면." }),
];
const WORKS = [
  { slug: "watcher-signal", title: "워처 실패 신호", branch: "feat/watcher-failure-signal", projects: ["atelier"] },
  { slug: "runtime-driver", title: "Runtime Driver 구조", branch: "feat/runtime-driver", projects: ["atelier"], service: "atelier-app" },
] as unknown as WorkView[];
const THREADS = [
  chat("w1", minutesAgo(12), { work: "watcher-signal" }),
  chat("w2", minutesAgo(3 * 60), { work: "runtime-driver" }),
  chat("t1", minutesAgo(26 * 60), { title: "ACP v2 변경점 조사", project: "atelier" }),
];
const SERVICES = [
  { slug: "atelier-app", name: "Atelier 앱", projects: ["atelier"], problems: [] },
  { slug: "admin", name: "관리자 콘솔", projects: ["front", "legacy-admin"], problems: [] },
] as unknown as Service[];

function render(slug: string) {
  const client = new QueryClient();
  client.setQueryData(projectsQuery().queryKey, PROJECTS);
  client.setQueryData(worksQuery().queryKey, WORKS);
  client.setQueryData(threadsQuery().queryKey, THREADS);
  client.setQueryData(servicesQuery().queryKey, SERVICES);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProjectDetail slug={slug} />
    </QueryClientProvider>,
  );
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** 묶음 하나 — 머리 글과 줄마다 [이름 링크의 갈 곳, 줄의 글]. */
const sectionOf = (html: string, label: string) => {
  const body = html.match(new RegExp(`<section aria-label="${label}"[^>]*>([\\s\\S]*?)</section>`))?.[1];
  if (body === undefined) return null;
  const rows = [...body.matchAll(/<div role="row"[^>]*>([\s\S]*?)<\/div><\/div>/g)].map((row) => [
    row[1].match(/<a href="([^"]+)"/)?.[1] ?? "",
    textOf(row[1]),
  ]);
  return { head: textOf(body.slice(0, body.indexOf('role="table"'))).replace(/<div$/, "").trim(), rows };
};

// 맨 `<button>`은 macOS WebKit의 Tab이 지나친다 — 묶음 머리의 + · 경고의 「재설정」도 키보드로 닿아야 한다(restart 03-13b).
const untabbable = (html: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((button) => !/\btabindex="0"/.test(button));

describe("Project 상세의 Tab", () => {
  it("판의 단추(머리 단추 · ⋯ · 묶음 머리의 +)에는 모두 Tab이 앉는다", () => {
    expect(untabbable(render("atelier"))).toEqual([]);
  });

  it("폴더를 찾을 수 없는 Project의 경고 「재설정」에도 Tab이 앉는다", () => {
    expect(untabbable(render("legacy-admin"))).toEqual([]);
  });
});

describe("Project 상세", () => {
  it("머리는 「← Projects」 · 이름 · 작업공간 만들기 · 새 채팅 · ⋯이고, 그 아래 설명 한 줄이다", () => {
    const html = render("atelier");
    expect(html).toMatch(/<a href="\/projects"[^>]*>.*Projects<\/a>/);
    expect(textOf(html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "")).toBe("atelier");
    const head = html.slice(html.indexOf("<h1"), html.indexOf("Tauri 데스크톱"));
    expect(textOf(head)).toBe("atelier 작업공간 만들기 새 채팅");
    expect(head).toContain('aria-label="atelier 메뉴"');
    expect(textOf(html)).toContain("Tauri 데스크톱 앱. 로컬 개발 작업을 Project · Service · 작업공간으로 묶어 관리한다.");
  });

  it("위 카드는 경로 · 기준 브랜치 · 원격 · 추가한 날이다", () => {
    const html = render("atelier");
    const facts = html.slice(html.indexOf("관리한다."), html.indexOf("<section"));
    expect(textOf(facts)).toBe("관리한다. 경로 ~/MyProjects/atelier 기준 브랜치 develop 원격 atelier-app/atelier 추가한 날 2026년 3월 2일");
  });

  // restart 03-15c · 보드 MainProjectDetail · Places `.pl-detail` — 보드 상세에는 고치는 자리가 없다. 이름 · 설명 · 기준 브랜치는 대화(`atelier` MCP ·
  // Runtime의 설정 도구)로 고친다. 한때 제목을 누르면 이름 칸, 기준 브랜치 카드를 누르면 목록이 섰다.
  it("제목은 이름 글이고 기준 브랜치는 다른 칸과 같은 카드다 — 눌러 고치는 자리가 없다", () => {
    const html = render("atelier");
    expect(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]).toBe("atelier");
    const facts = html.slice(html.indexOf("관리한다."), html.indexOf("<section"));
    expect(facts).not.toMatch(/<button|role="combobox"/);
  });

  it("작업공간 · 채팅 · Service 묶음이 수와 줄(이름 · 옆 글 · 최근 활동)로 서고, 줄의 이름이 그곳으로 가는 링크다", () => {
    const html = render("atelier");
    expect(sectionOf(html, "작업공간")).toEqual({
      head: "작업공간 2개",
      rows: [
        ["/works/watcher-signal", "워처 실패 신호 feat/watcher-failure-signal 12분"],
        ["/works/runtime-driver", "Runtime Driver 구조 feat/runtime-driver 3시간"],
      ],
    });
    expect(sectionOf(html, "채팅")).toEqual({ head: "채팅 1개", rows: [["/threads/t1", "ACP v2 변경점 조사 작업공간 밖 어제"]] });
    expect(sectionOf(html, "Service")).toEqual({ head: "Service 1개", rows: [["/services/atelier-app", "Atelier 앱 Project 1개 3시간"]] });
  });

  it("폴더를 찾을 수 없는 Project는 카드 위에 경고와 「재설정」이 서고, 줄이 없는 묶음은 서지 않는다", () => {
    const html = render("legacy-admin");
    const warn = html.slice(html.indexOf("옛 관리자 화면."), html.lastIndexOf("<div", html.indexOf(">경로<")));
    expect(textOf(warn)).toBe("옛 관리자 화면. 폴더를 찾을 수 없어요. 옮겼다면 재설정으로 새 경로를 알려 주세요. 재설정");
    expect(warn).toMatch(/<button[^>]*>재설정<\/button>/);
    expect(textOf(html)).toContain("경로 ~/old/legacy-admin 기준 브랜치 main 원격 — 추가한 날 2026년 2월 3일");
    expect(sectionOf(html, "작업공간")).toBeNull();
    expect(sectionOf(html, "채팅")).toBeNull();
    expect(sectionOf(html, "Service")).toEqual({ head: "Service 1개", rows: [["/services/admin", "관리자 콘솔 Project 2개 —"]] });
  });
});
