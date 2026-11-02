import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { SpecTreeGroup, SpecTreeItem } from "@/features/works/types";
import ArchiveDetail from "./ArchiveDetail";
import { archivedDocsQuery, archivedFileQuery, archiveQuery } from "./hooks";
import type { ArchivedDocs, ArchiveEntry } from "./types";

// Archive 상세(restart 03-4 · 스토리 120 · 보드 MainArchiveDetail · PlaceSheet 「세 화면」 · Places `DETAILS['process-manager']`) — seam은 그린 꼴(markup)이다(이
// 저장소의 L2에는 DOM이 없다). 누르는 것(트리로 문서 고르기 · 문서 링크 · 뒤로 · 앞으로 · 검색에서 열기)은 L3가 재고, 주소의 히스토리 뜻은
// `router.test.ts`가 잰다. 값은 보드 장면을 따른 꾸민 것이다.

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

const SHIPPED: ArchiveEntry = {
  slug: "process-manager",
  title: "프로세스 매니저",
  status: "done",
  archivedAt: "2026-10-28",
  projects: ["atelier"],
  branch: "feat/process-manager",
};
const BARE: ArchiveEntry = { slug: "old-notes", title: "old-notes", status: "draft", archivedAt: null, projects: [], branch: null };

// **입력은 손으로 적은 spec 트리다**(spec 레이아웃 구현 스펙 Testing 「앱」) — 앱에는 규칙이 없어 여기서 재는 것은 「받은 것을 받은 대로 그리는가」뿐이다.
// 그래서 아래 트리는 일부러 이름으로 세울 때의 순서가 아니다: 판이 최신부터 서고, 최상위 `tickets/`는 레이아웃의 자리 밖이라 아이콘이 없다(spec 레이아웃
// 구현 스펙 7절 허용 차이 4). 이름으로 알아보던 앱이라면 판을 오름차순으로 다시 세우고 `tickets/`에 아이콘을 줬다.
const file = (path: string, icon: string | null = null): SpecTreeItem => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  kind: "file",
  icon,
  group: null,
  children: [],
});
const folder = (path: string, children: SpecTreeItem[], icon: string | null = null, group: SpecTreeGroup | null = null): SpecTreeItem => ({
  ...file(path, icon),
  kind: "folder",
  group,
  children,
});
const iteration = (n: number, latest: boolean): SpecTreeGroup => ({ key: "{n}-{name}", n, latest });

const DOCS: ArchivedDocs = {
  docs: ["record.md", "spec/01-첫째-판/지난-계획.md", "spec/02-둘째-판/plan.md", "spec/overview.md", "spec/tickets/할일.md"],
  specTree: {
    fallback: null,
    defaultDoc: "overview.md",
    items: [
      file("overview.md", "compass"),
      folder("02-둘째-판", [file("02-둘째-판/plan.md")], "layers", iteration(2, true)),
      folder("01-첫째-판", [file("01-첫째-판/지난-계획.md")], "layers", iteration(1, false)),
      folder("tickets", [file("tickets/할일.md")]),
    ],
  },
};
const CONTENT: Record<string, string> = {
  "record.md": "# 작업 기록\n\nClaude Bash 도구가 띄운 dev 서버가 셸을 닫아도 남는 문제에서 시작했다.\n",
  "spec/02-둘째-판/plan.md": "# 계획\n\n둘째 판의 계획이다.\n",
};

function render(slug: string, current: string | null = null) {
  const client = new QueryClient();
  client.setQueryData(archiveQuery().queryKey, [SHIPPED, BARE]);
  client.setQueryData(archivedDocsQuery("process-manager").queryKey, DOCS);
  client.setQueryData(archivedDocsQuery("old-notes").queryKey, { docs: [], specTree: { fallback: null, defaultDoc: null, items: [] } });
  for (const [path, text] of Object.entries(CONTENT)) client.setQueryData(archivedFileQuery("process-manager", path).queryKey, text);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ArchiveDetail slug={slug} file={current} />
    </QueryClientProvider>,
  );
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** 문서 글 — 「문서」 트리 앞의 글 상자(`data-doc-text`). */
const docOf = (html: string) => {
  const start = html.indexOf("data-doc-text");
  return start < 0 ? "" : html.slice(start, html.indexOf('aria-label="문서"', start));
};
/** 「문서」 트리 — `nav` 하나. */
const treeOf = (html: string) => html.match(/<nav aria-label="문서"[\s\S]*?<\/nav>/)?.[0] ?? "";

describe("Archive 상세", () => {
  it("머리는 「← Archive」 · 이름 · Finder에서 열기 · ⋯이다 — 되살리기는 없다", () => {
    const html = render("process-manager");
    expect(html).toMatch(/<a href="\/archive"[^>]*>.*Archive<\/a>/);
    expect(textOf(html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)?.[0] ?? "")).toBe("프로세스 매니저");
    const head = html.slice(html.indexOf("<h1"), html.lastIndexOf("<span", html.indexOf(">상태<")));
    expect(textOf(head)).toBe("프로세스 매니저 Finder에서 열기");
    expect(head).toContain('aria-label="프로세스 매니저 메뉴"');
    expect(textOf(html)).not.toContain("되살리기");
  });

  it("위 카드는 상태 · 보관한 날 · Project · 브랜치다", () => {
    const html = render("process-manager");
    const facts = html.slice(html.lastIndexOf("<div", html.indexOf(">상태<")), html.indexOf("data-doc-text"));
    expect(textOf(facts)).toMatch(/^상태 완료 보관한 날 2026년 10월 28일 Project atelier 브랜치 feat\/process-manager/);
  });

  it("문서를 고르지 않았으면 첫 문서(기록)를 읽는다 — 글과 그 곁의 「문서」 트리가 선다", () => {
    const html = render("process-manager");
    expect(textOf(docOf(html))).toContain("작업 기록 Claude Bash 도구가 띄운 dev 서버가 셸을 닫아도 남는 문제에서 시작했다.");
    expect(textOf(treeOf(html)).startsWith("문서 ")).toBe(true);
  });

  // 검색(⌘K의 아카이브 문서 줄)이 이 주소로 온다(`hitTarget` — `/archive/$slug?file=`).
  it("주소의 문서(`?file=`)를 그대로 읽고, 목록에 없는 문서면 첫 문서로 떨어진다", () => {
    expect(textOf(docOf(render("process-manager", "spec/02-둘째-판/plan.md")))).toContain("계획 둘째 판의 계획이다.");
    expect(textOf(docOf(render("process-manager", "spec/없는.md")))).toContain("작업 기록");
  });

  it("문서가 하나도 남지 않은 아카이브는 그렇게 말하고 트리를 세우지 않는다 — 위 카드의 빈 값은 「—」다", () => {
    const html = render("old-notes");
    expect(textOf(html)).toContain("상태 초안 보관한 날 — Project — 브랜치 —");
    expect(textOf(html)).toContain("남은 문서가 없어요");
    expect(treeOf(html)).toBe("");
  });
});

describe("「문서」 트리는 기록 곁에 받은 spec 트리를 spec/ 아래에 그린다", () => {
  /** 행 이름이 트리에 선 자리. 없으면 -1이다. 행의 글자는 태그 사이에 홀로 선다(`>이름<`). */
  const at = (markup: string, name: string) => markup.indexOf(`>${name}<`);
  /** 이름으로 트리의 접히는 행 하나(여는 button부터 닫는 button까지). */
  const folderRow = (markup: string, name: string) =>
    (markup.match(/<button[^>]*aria-expanded="[^"]*"[^>]*>[\s\S]*?<\/button>/g) ?? []).find((row) => row.endsWith(`>${name}</span></button>`)) ?? "";
  /** 이름으로 파일 행 하나 — 배경(선택 표시)을 가진 바깥 div의 여는 태그부터 이름까지. */
  const fileRow = (markup: string, name: string) => {
    const end = markup.indexOf(`>${name}</span></button>`);
    if (end < 0) return "";
    return markup.slice(markup.lastIndexOf('<div class="group', end), end);
  };
  const tree = (current: string | null = null) => treeOf(render("process-manager", current));

  it("뿌리에 기록 행과 spec/ 행이 서고, 그 아래가 받은 순서대로 선다", () => {
    const markup = tree();
    const shown = ["record.md", "spec", "overview.md", "02-둘째-판", "plan.md", "01-첫째-판", "tickets", "할일.md"];
    const positions = shown.map((name) => at(markup, name));
    expect(positions.every((one) => one >= 0), `${shown} → ${positions}`).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // `spec/`는 접히는 폴더 행이고 펼친 채 선다. 판은 최신만 펼친다(spec 레이아웃 티켓 05와 같은 규칙).
    expect(folderRow(markup, "spec")).toContain('aria-expanded="true"');
    expect(folderRow(markup, "01-첫째-판")).toContain('aria-expanded="false"');
    expect(at(markup, "지난-계획.md")).toBe(-1);
  });

  it("받은 아이콘으로 선다 — 아이콘이 없는 기록 행은 확장자 첫 글자(보드 `.ra-ext`)이고, 자리 밖 tickets/에는 아이콘이 없다", () => {
    const markup = tree();
    expect(fileRow(markup, "overview.md")).toContain("lucide-compass");
    expect(fileRow(markup, "overview.md")).not.toContain("data-ext");
    expect(fileRow(markup, "record.md")).toContain('data-ext="md"');
    expect(folderRow(markup, "02-둘째-판")).toContain("lucide-layers");
    const glyphs = (row: string) => row.match(/class="lucide lucide-[^ "]+/g);
    expect(glyphs(folderRow(markup, "tickets"))).toEqual(['class="lucide lucide-chevron-right']);
    expect(glyphs(folderRow(markup, "spec"))).toEqual(['class="lucide lucide-chevron-right']);
  });

  it("선택 표시는 spec/가 다시 붙은 경로로 켜진다", () => {
    expect(fileRow(tree("spec/02-둘째-판/plan.md"), "plan.md")).toContain("selected-row");
    expect(fileRow(tree("spec/02-둘째-판/plan.md"), "record.md")).not.toContain("selected-row");
    // 기본 문서는 지금 규칙 그대로 목록의 첫 문서다 — 트리의 기본 문서(`overview.md`)가 아니다
    expect(fileRow(tree(), "record.md")).toContain("selected-row");
    expect(fileRow(tree(), "overview.md")).not.toContain("selected-row");
  });
});
