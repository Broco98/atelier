import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fileKey, type ChangeSummary } from "./work-card";
import { ArchivedCard, WorkCardSections } from "./WorkCard";

// Work 카드의 칸(v1 티켓 34 · §15 · 캔버스 WorkPanel 보드) — 칸을 그리는 조각은 훅을 부르지 않아 정적 마크업으로 잰다. 재는 것은 칸의
// 차례 · 빈 칸이 서지 않음 · 줄의 메타(쓰는 중 · +/− · 고치는 중 · PR 문장)다.

const none = () => {};
const sections = (over: Partial<Parameters<typeof WorkCardSections>[0]> = {}) =>
  renderToStaticMarkup(
    <WorkCardSections
      docs={[]}
      changes={null}
      fresh={new Set()}
      flash={0}
      projects={[]}
      prs={[]}
      onAddDoc={none}
      onAttachProject={none}
      onOpenPr={none}
      {...over}
    />,
  );
const names = (markup: string) => [...markup.matchAll(/<section aria-label="([^"]+)"/g)].map((m) => m[1]);

const refund: ChangeSummary = {
  additions: 48,
  deletions: 12,
  groups: [
    {
      project: "api-server",
      additions: 48,
      deletions: 12,
      files: [
        { path: "src/refunds/refund.service.ts", additions: 14, deletions: 6 },
        { path: "src/refunds/refund.service.spec.ts", additions: 30, deletions: 6 },
        { path: "prisma/schema.prisma", additions: 4, deletions: 0 },
      ],
    },
  ],
};

describe("Work 카드의 칸", () => {
  it("문서 · 변경 · Project · PR 차례로 서고, 쓰는 중인 문서에 파란 점과 「Host가 쓰는 중」이 붙는다(화면 3)", () => {
    const markup = sections({
      docs: [
        { path: "overview.md", writer: null },
        { path: "design.md", writer: { path: "design.md", who: "host", name: "Host", thread: "a" } },
      ],
      changes: refund,
      projects: [{ project: "api-server", editing: true }],
      prs: [{ project: "api-server", number: 142, url: "https://github.com/acme/api/pull/142", status: "CI 확인 중", checking: true }],
    });
    expect(names(markup)).toEqual(["문서", "변경", "Project"]);
    expect(markup.indexOf("PR #142")).toBeGreaterThan(markup.indexOf("api-server"));
    expect(markup).toMatch(/data-doc="design.md".*writing-pulse.*Host가 쓰는 중/);
    expect(markup).not.toMatch(/data-doc="overview.md"[^>]*>(?:(?!data-doc).)*쓰는 중/);
    expect(markup).toContain("고치는 중");
    expect(markup).toMatch(/chat-shimmer[^>]*>CI 확인 중/);
  });

  it("변경은 파일 이름만 보이고(전체 경로는 title), 0인 쪽 숫자는 적지 않으며, Project가 하나면 Project 머리 줄이 없다", () => {
    const markup = sections({ changes: refund });
    expect(markup).toContain('title="prisma/schema.prisma"');
    expect(markup).toContain(">schema.prisma<");
    expect(markup).toMatch(/data-change="prisma\/schema.prisma".*\+4<\/span><\/span>/);
    expect(markup).not.toContain("−0");
    expect(markup).toContain("+48");
    expect(markup).toContain("−12");
    expect(markup.match(/api-server/g) ?? []).toHaveLength(0);
  });

  it("Project가 여럿이면 Project마다 머리 줄과 그 합계가 선다(보드 「Project가 셋」)", () => {
    const markup = sections({
      changes: {
        additions: 167,
        deletions: 78,
        groups: [
          { project: "web-client", additions: 158, deletions: 76, files: [{ path: "CheckoutPage.tsx", additions: 158, deletions: 76 }] },
          { project: "api-server", additions: 9, deletions: 2, files: [{ path: "checkout.controller.ts", additions: 9, deletions: 2 }] },
        ],
      },
    });
    expect(markup).toMatch(/web-client.*\+158.*−76.*CheckoutPage.tsx.*api-server.*\+9.*−2.*checkout.controller.ts/);
  });

  it("새로 바뀐 파일 줄만 빛난다", () => {
    const markup = sections({ changes: refund, fresh: new Set([fileKey("api-server", "prisma/schema.prisma")]), flash: 1 });
    expect(markup.match(/row-flash/g) ?? []).toHaveLength(1);
    expect(markup).toMatch(/data-change="prisma\/schema.prisma" data-fresh=""/);
  });

  it("빈 칸은 그리지 않는다 — 문서 · 변경 · PR이 없으면 Project 칸 하나와 「Project 붙이기」뿐이다(보드 「막 만든 Work」)", () => {
    const markup = sections();
    expect(names(markup)).toEqual(["Project"]);
    expect(markup).toContain("Project 붙이기");
    expect(markup).not.toContain("PR #");
    expect(markup).not.toContain("문서 추가");
  });

  it("읽기만 하는 Project는 「읽기만」이다", () => {
    const markup = sections({
      projects: [
        { project: "web-client", editing: true },
        { project: "admin-console", editing: false },
      ],
    });
    expect(markup).toMatch(/data-project="web-client".*고치는 중.*data-project="admin-console".*읽기만/);
  });
});

describe("보관된 Work의 카드(v1 티켓 38 · 보드 「보관된 Work」)", () => {
  const entry = { slug: "webhook-retry", title: "결제 웹훅 재시도", status: "done" as const, archivedAt: "2026-10-20", projects: ["api-server"] };
  const docs = [
    { path: "overview.md", writer: null },
    { path: "design.md", writer: null },
  ];

  it("더하기를 받지 않은 칸들은 더하기 버튼이 없고, Project가 없으면 Project 칸도 서지 않는다", () => {
    const markup = renderToStaticMarkup(
      <WorkCardSections docs={docs} changes={refund} fresh={new Set()} flash={0} projects={[]} prs={[]} onOpenPr={none} />,
    );
    expect(names(markup)).toEqual(["문서", "변경"]);
    expect(markup).not.toContain("문서 추가");
    expect(markup).not.toContain("Project 붙이기");
  });

  it("머리는 보관 글리프 · 이름 · 「보관됨 · 10월 20일」이고, 문서는 더하기 없이 서며, 누를 자리도 ⋯도 「다시 열기」도 없다(S25)", () => {
    const markup = renderToStaticMarkup(<ArchivedCard entry={entry} docs={docs} />);
    expect(markup).toContain('aria-label="Work 카드: 결제 웹훅 재시도"');
    expect(markup).toMatch(/lucide-archive.*결제 웹훅 재시도.*보관됨 · 10월 20일/);
    expect(names(markup)).toEqual(["Work 카드: 결제 웹훅 재시도", "문서"]);
    expect(markup).toMatch(/data-doc="overview.md".*data-doc="design.md"/);
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("Work 메뉴");
    expect(markup).not.toContain("다시 열기");
  });

  it("보관한 날을 모르는 Work(손으로 옮긴 폴더)는 「보관됨」만이다 — 없는 날을 지어내지 않는다", () => {
    const markup = renderToStaticMarkup(<ArchivedCard entry={{ ...entry, archivedAt: null }} docs={[]} />);
    expect(markup).toMatch(/>보관됨</);
    expect(names(markup)).toEqual(["Work 카드: 결제 웹훅 재시도"]);
  });
});
