import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectsQuery } from "@/features/projects/hooks";
import type { ProjectView } from "@/features/projects/types";
import { threadsQuery } from "@/features/thread/hooks";
import type { ThreadSummary } from "@/features/thread/types";
import { worksQuery } from "@/features/works/hooks";
import type { WorkView } from "@/features/works/types";
import { servicesQuery } from "./hooks";
import ServicesPlace from "./ServiceList";
import type { Service } from "./types";

// Services 목록(restart 03-3 · 보드 MainServices · PlaceSheet 「세 화면」 · 「Service 없음」 · Places `DATA.services`) — seam은 그린 꼴(markup)이다(이
// 저장소의 L2에는 DOM이 없다). 누르고 치는 것(⌘F · 돌아오면 그대로 · 움직임 · 메뉴)은 L3가 잰다. 값은 보드 장면을 따른 꾸민 것이다.

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

const service = (slug: string, name: string, projects: string[], over: Partial<Service> = {}): Service => ({
  slug,
  name,
  projects,
  createdAt: "2026-08-14",
  createdBy: null,
  description: "",
  problems: [],
  ...over,
});

const project = (slug: string): ProjectView => ({
  slug,
  name: slug,
  path: `~/work/payments/${slug}`,
  baseBranch: "main",
  createdAt: "2026-08-14",
  description: "",
  git: null,
  missing: false,
});

const chat = (id: string, lastAt: string, over: Partial<ThreadSummary>): ThreadSummary => ({
  id,
  title: id,
  createdAt: "2026-08-14T09:00:00.000+09:00",
  lastAt,
  work: null,
  service: null,
  project: null,
  lastRead: 0,
  readOnly: null,
  broken: null,
  ...over,
});

const SERVICES = [
  service("admin", "관리자 콘솔", ["front", "legacy-api", "legacy-admin"], {
    problems: [{ line: 3, kind: "unknownProject", project: "legacy-api", message: "등록되지 않은 Project예요" }],
  }),
  service("payments", "결제 시스템", ["backend", "front"]),
  service("atelier-app", "Atelier 앱", ["atelier"]),
  service("drafts", "초안", []),
];
const PROJECTS = ["atelier", "backend", "front", "legacy-admin"].map(project);
const WORKS = [
  { slug: "refund-webhook", projects: ["backend"], service: "payments" },
  { slug: "console-fix", projects: ["front"], service: "admin" },
] as unknown as WorkView[];
const THREADS = [
  chat("범위 채팅", minutesAgo(12), { service: "atelier-app" }),
  chat("환불 채팅", minutesAgo(3 * 24 * 60), { work: "refund-webhook" }),
  chat("콘솔 채팅", minutesAgo(28 * 24 * 60), { work: "console-fix" }),
  // 그 Service의 Project만 범위로 고른 채팅은 Service의 활동이 아니다.
  chat("Project 범위", minutesAgo(5), { project: "front" }),
];

function render(services: Service[] = SERVICES) {
  const client = new QueryClient();
  client.setQueryData(servicesQuery().queryKey, services);
  client.setQueryData(projectsQuery().queryKey, PROJECTS);
  client.setQueryData(worksQuery().queryKey, WORKS);
  client.setQueryData(threadsQuery().queryKey, THREADS);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ServicesPlace />
    </QueryClientProvider>,
  );
}

/** 몸의 줄들 — 이름(이름 링크의 글)마다 그 줄의 꼴. 머리 줄은 링크가 없다. */
const rowsOf = (html: string) =>
  [...html.matchAll(/<div><div role="row"[^>]*>([\s\S]*?)<\/div><\/div>/g)].map((row) => [row[1].match(/<a [^>]*>([^<]+)<\/a>/)?.[1] ?? "", row[1]]);
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("Services 목록", () => {
  it("줄은 이름 · Project 수와 이름 · 최근 활동이고, 최근 활동 순이며 활동이 없는 줄은 끝에 「—」로 선다", () => {
    expect(rowsOf(render()).map(([, row]) => textOf(row))).toEqual([
      "Atelier 앱 Project 1개 · atelier 12분",
      "결제 시스템 Project 2개 · backend · front 3일",
      "관리자 콘솔 Project 2개 · front · legacy-admin 4주",
      "초안 Project 없음 —",
    ]);
  });

  it("줄의 이름이 그 Service 상세로 가는 링크이고, 오른쪽은 ⋯ · 작업공간 만들기 · 새 채팅이다", () => {
    const rows = Object.fromEntries(rowsOf(render()));
    expect(rows["결제 시스템"]).toMatch(/<a href="\/services\/payments"[^>]*>결제 시스템<\/a>/);
    const labels = [...rows["결제 시스템"].matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(["결제 시스템 메뉴", "결제 시스템 범위로 작업공간 만들기", "결제 시스템 범위로 새 채팅"]);
  });

  // 맨 `<button>`은 macOS WebKit의 Tab이 지나친다 — 줄 끝에서 범위로 시작하는 일도 키보드로 닿아야 한다(restart 03-13b).
  it("줄 끝 단추(⋯ · 작업공간 만들기 · 새 채팅)에는 모두 Tab이 앉는다", () => {
    const buttons = rowsOf(render()).flatMap(([, row]) => [...row.matchAll(/<button[^>]*>/g)].map((m) => m[0]));
    expect(buttons).toHaveLength(SERVICES.length * 3);
    for (const button of buttons) expect(button).toMatch(/\btabindex="0"/);
  });

  it("머리는 제목 · ⌘F로 서는 찾기 칸 · 만들기이고, 표의 열 머리는 이름 · 최근 활동(지금 정렬 — 내림차순)이다", () => {
    const html = render();
    expect(html).toMatch(/<h1[^>]*>Services<\/h1>/);
    expect(html).toMatch(/<input type="search"[^>]*placeholder="Service 찾기"[^>]*aria-label="Service 찾기"[^>]*aria-keyshortcuts="Meta\+F"/);
    expect(html).toMatch(/<button[^>]*>(<svg[\s\S]*?<\/svg>)?만들기<\/button>/);
    expect(html).toContain('<div role="table" aria-label="Service 목록">');
    const heads = [...html.matchAll(/<span role="columnheader"( aria-sort="(\w+)")?><button type="button"[^>]*>([^<]+)</g)].map((m) => [m[3], m[2] ?? null]);
    expect(heads).toEqual([
      ["이름", null],
      ["최근 활동", "descending"],
    ]);
    // 한때(03)의 목록 아래 한 줄 · 「문제 있음」 꼬리표는 보드에 없다 — 문제는 상세의 경고가 말한다.
    expect(textOf(html)).not.toContain("Runtime은 Service 안의 Project를 함께 읽어요");
    expect(textOf(html)).not.toContain("문제 있음");
  });

  it("Service가 없으면 찾기 칸 없이 묶는 까닭 한 줄과 만들기가 가운데에 선다", () => {
    const html = render([]);
    expect(html).not.toContain('type="search"');
    expect(textOf(html)).toContain("아직 Service가 없어요 함께 고치는 Project를 하나로 묶으면, 그 묶음을 범위로 채팅과 작업공간을 시작할 수 있어요. 만들기");
  });
});
