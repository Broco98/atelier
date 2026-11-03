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
import ServiceDetail from "./ServiceDetail";
import type { Service, ServiceDetail as Detail } from "./types";

// Service 상세(restart 03-3 · 스토리 115 · 116 · 117 · 118 · 보드 MainServiceDetail · PlaceSheet 「문제가 있는 Service」 · Places `DETAILS.payments` ·
// `DETAILS.admin`) — seam은 그린 꼴(markup)이다(이 저장소의 L2에는 DOM이 없다). 누르는 것(⋯ · 경고의 「파일로 고치기」 · 묶음 줄 · 뒤로 · 앞으로)과
// 움직임은 L3가 잰다. 값은 보드 장면을 따른 꾸민 것이다.

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

const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60_000).toISOString();

const project = (slug: string, over: Partial<ProjectView> = {}): ProjectView => ({
  slug,
  name: slug,
  path: `~/work/payments/${slug}`,
  baseBranch: "main",
  createdAt: "2026-08-14",
  description: "",
  git: null,
  missing: false,
  ...over,
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

const service = (slug: string, name: string, projects: string[], over: Partial<Detail> = {}): Detail => ({
  slug,
  name,
  projects,
  createdAt: "2026-08-14",
  createdBy: null,
  description: "",
  problems: [],
  shared: [],
  ...over,
});

const PAYMENTS = service("payments", "결제 시스템", ["backend", "front"], {
  description: "결제 승인과 정산을 맡는다. backend와 front를 함께 고친다.",
  shared: [{ slug: "admin", name: "관리자 콘솔", overlap: ["front"], projects: ["front", "legacy-api", "legacy-admin"] }],
});
const ADMIN = service("admin", "관리자 콘솔", ["front", "legacy-api", "legacy-admin"], {
  description: "운영자 화면.",
  createdAt: "2026-09-02",
  problems: [{ line: 3, kind: "unknownProject", project: "legacy-api", message: "등록되지 않은 Project예요" }],
});
const PROJECTS = [project("backend"), project("front"), project("legacy-admin", { path: "~/old/legacy-admin", missing: true })];
const WORKS = [
  { slug: "refund-webhook", title: "환불 웹훅", branch: "feat/refund-webhook", projects: ["backend"], service: "payments" },
] as unknown as WorkView[];
const THREADS = [
  chat("환불 채팅", daysAgo(3), { work: "refund-webhook" }),
  chat("front 범위", daysAgo(3), { project: "front" }),
  chat("콘솔 범위", daysAgo(28), { service: "admin" }),
  chat("legacy 범위", daysAgo(29), { project: "legacy-admin" }),
];

function render(detail: Detail) {
  const client = new QueryClient();
  client.setQueryData([...servicesQuery().queryKey, detail.slug], detail);
  client.setQueryData(servicesQuery().queryKey, [PAYMENTS, ADMIN] as Service[]);
  client.setQueryData(projectsQuery().queryKey, PROJECTS);
  client.setQueryData(worksQuery().queryKey, WORKS);
  client.setQueryData(threadsQuery().queryKey, THREADS);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ServiceDetail slug={detail.slug} />
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

// 맨 `<button>`은 macOS WebKit의 Tab이 지나친다 — 묶음 머리의 + · 경고의 글 단추도 키보드로 닿아야 한다(restart 03-13b).
const untabbable = (html: string) =>
  [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]).filter((button) => !/\btabindex="0"/.test(button));

describe("Service 상세의 Tab", () => {
  it("판의 단추(머리 단추 · ⋯ · 묶음 머리의 +)에는 모두 Tab이 앉는다", () => {
    expect(untabbable(render(PAYMENTS))).toEqual([]);
  });

  it("문제가 있는 파일의 경고 단추에도 Tab이 앉는다", () => {
    const broken = { ...PAYMENTS, problems: [{ line: 1, kind: "unclosedFrontmatter" as const, message: "frontmatter가 닫히지 않았어요" }] };
    expect(render(broken)).toMatch(/<button[^>]*>파일로 고치기<\/button>/);
    expect(untabbable(render(broken))).toEqual([]);
  });
});

describe("Service 상세", () => {
  it("머리는 「← Services」 · 이름 · 작업공간 만들기 · 새 채팅 · ⋯이고, 그 아래 설명 한 줄이다", () => {
    const html = render(PAYMENTS);
    expect(html).toMatch(/<a href="\/services"[^>]*>.*Services<\/a>/);
    expect(textOf(html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "")).toBe("결제 시스템");
    const head = html.slice(html.indexOf("<h1"), html.indexOf("결제 승인과"));
    expect(textOf(head)).toBe("결제 시스템 작업공간 만들기 새 채팅");
    expect(head).toContain('aria-label="결제 시스템 메뉴"');
    expect(textOf(html)).toContain("결제 승인과 정산을 맡는다. backend와 front를 함께 고친다.");
  });

  it("위 카드는 Project · 작업공간 · 함께 쓰는 Service · 만든 날이다", () => {
    const html = render(PAYMENTS);
    const facts = html.slice(html.indexOf("함께 고친다."), html.indexOf("<section"));
    expect(textOf(facts)).toBe("함께 고친다. Project 2개 작업공간 1개 진행 중 함께 쓰는 Service 1개 만든 날 2026년 8월 14일");
  });

  it("Projects · 작업공간 · 함께 쓰는 Service 묶음이 수와 줄(이름 · 옆 글 · 최근 활동)로 서고, 줄의 이름이 그곳으로 가는 링크다", () => {
    const html = render(PAYMENTS);
    expect(sectionOf(html, "Projects")).toEqual({
      head: "Projects 2개",
      rows: [
        ["/projects/backend", "backend ~/work/payments/backend 3일"],
        ["/projects/front", "front ~/work/payments/front 3일"],
      ],
    });
    expect(sectionOf(html, "작업공간")).toEqual({ head: "작업공간 1개", rows: [["/works/refund-webhook", "환불 웹훅 feat/refund-webhook 3일"]] });
    expect(sectionOf(html, "함께 쓰는 Service")).toEqual({
      head: "함께 쓰는 Service 1개",
      rows: [["/services/admin", "관리자 콘솔 겹치는 Project · front 4주"]],
    });
  });

  it("Projects 묶음 머리의 +는 「Project 넣기」, 작업공간 묶음의 +는 「작업공간 만들기」이고, 함께 쓰는 Service에는 +가 없다", () => {
    const html = render(PAYMENTS);
    const plus = (label: string) => [...(html.match(new RegExp(`<section aria-label="${label}"[^>]*>[\\s\\S]*?role="table"`))?.[0] ?? "").matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(plus("Projects")).toEqual(["Project 넣기"]);
    expect(plus("작업공간")).toEqual(["작업공간 만들기"]);
    expect(plus("함께 쓰는 Service")).toEqual([]);
  });

  // restart 03-15c · 보드 MainServiceDetail · Places `.pl-detail` — 보드 상세에는 고치는 자리가 없고 상세 줄에는 오른쪽 단추가 없다. 이름 · 설명 ·
  // Project는 대화나 「파일로 고치기」로 고친다. 한때 제목을 누르면 이름 칸, Projects 줄을 지나면 ⋯(「Service에서 빼기」)가 섰다.
  it("제목은 이름 글이고 Projects 줄 끝에 단추가 없다 — 눌러 고치는 자리가 없다", () => {
    const html = render(PAYMENTS);
    expect(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]).toBe("결제 시스템");
    const projects = html.match(/<section aria-label="Projects"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(projects.slice(projects.indexOf('role="table"'))).not.toContain("<button");
  });

  it("관계 그래프가 없다", () => {
    const html = render(PAYMENTS);
    expect(html).not.toContain('role="img"');
    expect(textOf(html)).not.toContain("관계");
    expect(textOf(html)).not.toContain("점선 Service");
  });

  it("문제가 있는 Service는 카드 위에 파일의 줄까지 말하는 경고와 「파일로 고치기」가 서고, 줄이 없는 묶음은 서지 않는다", () => {
    const html = render(ADMIN);
    const warn = html.slice(html.indexOf("운영자 화면."), html.lastIndexOf("<div", html.indexOf(">Project<")));
    expect(textOf(warn)).toBe("운영자 화면. 등록되지 않은 Project가 있어요. Service 파일 3번째 줄 · legacy-api 파일로 고치기");
    expect(warn).toMatch(/<button[^>]*>파일로 고치기<\/button>/);
    expect(textOf(html)).toContain("Project 2개 작업공간 없음 함께 쓰는 Service 없음 만든 날 2026년 9월 2일");
    expect(sectionOf(html, "Projects")).toEqual({
      head: "Projects 2개",
      rows: [
        ["/projects/front", "front ~/work/payments/front 3일"],
        ["/projects/legacy-admin", "legacy-admin 폴더를 찾을 수 없어요 4주"],
      ],
    });
    expect(sectionOf(html, "작업공간")).toBeNull();
    expect(sectionOf(html, "함께 쓰는 Service")).toBeNull();
  });

  it("넣은 Project가 없어도 Projects 묶음은 서서 「Project 넣기」에 닿는다", () => {
    const html = render(service("drafts", "초안", []));
    expect(sectionOf(html, "Projects")?.head).toBe("Projects 0개");
    expect(textOf(html)).toContain("넣은 Project가 없어요");
  });
});
