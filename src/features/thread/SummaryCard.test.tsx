import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { changeSummary, fileKey, summarySections, type PrRow, type SummaryInput } from "./summary-card";
import { SummaryBody } from "./SummaryCard";

// 요약 카드의 몸(02 구현 스펙 §7 · 캔버스 v35 Screen-Live · Components 「요약 카드」) — 칸을 그리는 조각은 훅을 부르지 않아 정적 마크업으로
// 잰다. 재는 것은 칸의 차례와 글(머리 · 변경 사항 · 결과물 자리표시 · 소스) · 「＋」가 없음(S19) · 줄의 메타(쓰는 중 · 막 쓴 문서의 빛 ·
// +/− · 고치는 중 · PR 문장) · 「모두 보기」(S21) · 누르는 줄과 보이기만 하는 줄(보관 · Work 없는 Thread) · 넓힌 카드의 목록이다. 자리 ·
// 색(300 · 위 오른쪽 8 · 15 · 0.5 #dadadb)은 시안 비교와 L3가 본다.

const none = () => {};
const NOTHING: ReadonlySet<string> = new Set();

const pr: PrRow = {
  project: "api-server",
  number: 142,
  url: "https://github.com/acme/api/pull/142",
  icon: "open",
  status: "CI 통과 · 승인 1개",
  checking: false,
  note: null,
};

const refund = changeSummary([
  {
    project: "api-server",
    kind: "listed",
    base: "main",
    files: [
      { path: "src/refunds/refund.service.ts", additions: 14, deletions: 6 },
      { path: "prisma/schema.prisma", additions: 4, deletions: 0 },
    ],
  },
]);

const live: SummaryInput = {
  work: { title: "환불 API 버그 수정", archived: false },
  changes: refund,
  prs: [pr],
  docs: [{ path: "설계.md", writer: null }],
  projects: [{ project: "web-app", editing: false }],
};

const body = (input: SummaryInput, over: Partial<Parameters<typeof SummaryBody>[0]> = {}) =>
  renderToStaticMarkup(
    <SummaryBody
      sections={summarySections(input)}
      menu={<button type="button" aria-label="Work 메뉴" />}
      changes={input.changes}
      fresh={{ keys: NOTHING, flash: 0 }}
      written={{ keys: NOTHING, flash: 0 }}
      expanded={false}
      opened={null}
      onChanges={none}
      onOpen={none}
      onOpenPr={none}
      {...over}
    />,
  );
const sectionNames = (markup: string) => [...markup.matchAll(/<section aria-label="([^"]+)"/g)].map((m) => m[1]);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("요약 카드의 몸", () => {
  it("머리(Work 이름 · 「…」) → 「변경 사항」과 Work 합계 → PR 줄 → 결과물 자리표시 → 소스 차례다(Screen-Live)", () => {
    const markup = body(live);
    expect(text(markup)).toBe(
      "환불 API 버그 수정 변경 사항 +18 −6 PR #142 CI 통과 · 승인 1개 결과물 파일 또는 문서 만들기 소스 설계.md web-app 읽기만",
    );
    expect(markup).toMatch(/환불 API 버그 수정.*aria-label="Work 메뉴"/);
    expect(sectionNames(markup)).toEqual(["결과물", "소스"]);
  });

  it("결과물 · 소스에 「＋」가 없다(S19) — 누를 일이 없는 단추를 두지 않는다", () => {
    const markup = body(live);
    expect(markup).not.toMatch(/더하기|문서 추가|Project 붙이기/);
    expect(markup).not.toContain("lucide-plus");
  });

  it("「변경 사항」은 넓힌 카드의 diff를 여는 단추이고, 합계는 초록 · 빨강 diff 글자이며 0인 쪽은 적지 않는다(S17)", () => {
    const markup = body(live);
    expect(markup).toMatch(/<button type="button" data-changes=""[^>]*>.*변경 사항.*<\/button>/);
    expect(markup).toMatch(/text-diff-added[^>]*>\+18</);
    expect(markup).toMatch(/text-diff-deleted[^>]*>−6</);
    const added = body({
      ...live,
      changes: changeSummary([{ project: "api", kind: "listed", base: "main", files: [{ path: "a", additions: 3, deletions: 0 }] }]),
    });
    expect(added).toContain("+3");
    expect(added).not.toContain("−0");
    expect(text(body({ ...live, changes: null, prs: [] }))).toMatch(/^환불 API 버그 수정 변경 사항 결과물/);
  });

  it("PR 줄은 「변경 사항」 아래 지금 모양 그대로다 — CI가 실패하면 진한 ⓘ(빨강이 아님)와 그 아래 실패 문장(S18)", () => {
    const failing = body({ ...live, prs: [{ ...pr, icon: "failed", status: "CI 실패", note: "e2e 검사가 실패했어요." }] });
    expect(failing).toMatch(/변경 사항.*PR #142.*CI 실패.*<p[^>]*>e2e 검사가 실패했어요.<\/p>.*결과물/);
    expect(failing).toMatch(/<svg[^>]*text-fg[" ][^>]*data-pr-icon="failed"/);
    expect(failing).not.toMatch(/danger/);
    expect(body({ ...live, prs: [{ ...pr, status: "CI 확인 중", checking: true }] })).toMatch(/chat-shimmer[^>]*>CI 확인 중/);
  });

  it("쓰는 중인 문서 줄에 파란 점과 「Host가 쓰는 중」이, 막 쓴 문서 줄에 빛이 선다", () => {
    const writing = body({
      ...live,
      docs: [
        { path: "overview.md", writer: null },
        { path: "설계.md", writer: { path: "설계.md", who: "host", name: "Host", thread: "a" } },
      ],
    });
    expect(writing).toMatch(/data-doc="설계.md".*writing-pulse.*Host가 쓰는 중/);
    expect(writing).not.toMatch(/data-doc="overview.md"[^>]*>(?:(?!data-doc).)*쓰는 중/);
    const written = body(live, { written: { keys: new Set(["설계.md"]), flash: 1 } });
    expect(written).toMatch(/data-doc="설계.md"[^>]*class="[^"]*row-flash/);
    expect(written.match(/row-flash/g) ?? []).toHaveLength(1);
  });

  it("Project 줄 끝에 「고치는 중」 · 「읽기만」이 선다", () => {
    const markup = body({
      ...live,
      docs: [],
      projects: [
        { project: "api-server", editing: true },
        { project: "web-app", editing: false },
      ],
    });
    expect(markup).toMatch(/data-project="api-server".*고치는 중.*data-project="web-app".*읽기만/);
  });

  it("소스가 셋을 넘으면 셋만 서고 「모두 보기」 단추가 선다 — 넓힌 카드의 목록은 모두 선다(S21)", () => {
    const many: SummaryInput = {
      ...live,
      docs: [
        { path: "overview.md", writer: null },
        { path: "설계.md", writer: null },
      ],
      projects: [
        { project: "api-server", editing: true },
        { project: "web-app", editing: false },
      ],
    };
    const folded = body(many);
    expect(folded).toMatch(/<button type="button"[^>]*>(?:(?!<button).)*모두 보기<\/button>/);
    expect(folded).toContain('data-project="api-server"');
    expect(folded).not.toContain('data-project="web-app"');
    const wide = body(many, { expanded: true });
    expect(wide).toContain('data-project="web-app"');
    expect(wide).not.toContain("모두 보기");
    expect(body(live)).not.toContain("모두 보기");
  });

  it("문서 · Project 줄은 넓힌 카드를 여는 단추다 — 이름은 줄의 글 그대로다", () => {
    const markup = body(live);
    expect(markup).toMatch(/<button type="button" data-doc="설계.md"/);
    expect(markup).toMatch(/<button type="button" data-project="web-app"/);
    expect(markup).not.toContain("aria-current");
  });
});

describe("보관된 Work · Work 없는 Thread의 요약 카드", () => {
  const shelved: SummaryInput = {
    work: { title: "결제 웹훅 재시도", archived: true },
    changes: null,
    prs: [],
    docs: [{ path: "overview.md", writer: null }],
    projects: [{ project: "api-server", editing: false }],
  };

  it("보관된 Work는 머리 Work 이름 뒤에 「보관됨」이 붙고, 「…」 없이 변경 사항 · 소스가 보이기만 한다", () => {
    const markup = body(shelved, { menu: undefined, onChanges: undefined, onOpen: undefined });
    expect(text(markup)).toBe("결제 웹훅 재시도 보관됨 변경 사항 결과물 파일 또는 문서 만들기 소스 overview.md api-server 읽기만");
    expect(markup).not.toContain("<button");
    expect(markup).toMatch(/<div data-doc="overview.md"/);
  });

  it("Work 없는 Thread는 머리 · 변경 사항 없이 결과물 · 소스만이다(S20)", () => {
    const markup = body(
      { work: null, changes: null, prs: [], docs: [], projects: [{ project: "api-server", editing: false }] },
      { menu: undefined, onChanges: undefined, onOpen: undefined },
    );
    expect(text(markup)).toBe("결과물 파일 또는 문서 만들기 소스 api-server 읽기만");
    expect(markup).not.toContain("변경 사항");
  });
});

describe("넓힌 카드의 목록(v1 티켓 35 — 넓힌 카드는 그대로다)", () => {
  it("「변경 사항」 아래에 바뀐 파일마다 줄이 서고(전체 경로는 title), 연 줄 하나만 고른 면이다", () => {
    const markup = body(live, { expanded: true, opened: { kind: "change", project: "api-server", path: "prisma/schema.prisma" } });
    expect(markup).toMatch(/변경 사항.*data-change="src\/refunds\/refund.service.ts".*data-change="prisma\/schema.prisma".*PR #142/);
    expect(markup).toContain('title="prisma/schema.prisma"');
    expect(markup).toContain(">schema.prisma<");
    expect(markup.match(/aria-current="true"/g) ?? []).toHaveLength(1);
    expect(markup).toMatch(/data-change="prisma\/schema.prisma"[^>]*aria-current="true"[^>]*class="[^"]*selected-row/);
    expect(body(live, { expanded: true, opened: { kind: "project", project: "web-app", file: "package.json" } })).toMatch(
      /data-project="web-app"[^>]*aria-current="true"/,
    );
  });

  it("작은 카드에는 파일 줄이 없다 — 「변경 사항」 한 줄이다", () => {
    expect(body(live)).not.toContain("data-change=");
  });

  it("새로 바뀐 파일이 있으면 「변경 사항」 줄이, 넓힌 카드에서는 그 파일 줄이 빛난다", () => {
    const fresh = new Set([fileKey("api-server", "prisma/schema.prisma")]);
    expect(body(live, { fresh: { keys: fresh, flash: 1 } })).toMatch(/data-changes=""[^>]*class="[^"]*row-flash/);
    const wide = body(live, { fresh: { keys: fresh, flash: 1 }, expanded: true });
    expect(wide).toMatch(/data-change="prisma\/schema.prisma" data-fresh=""/);
    expect(wide.match(/row-flash/g) ?? []).toHaveLength(1);
  });
});
