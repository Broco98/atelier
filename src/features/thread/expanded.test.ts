import { describe, expect, it } from "vitest";
import type { ToolEntry, Turn } from "./fold";
import { createdDocs, freshLines, isOpened, viewerPath, type Opened } from "./expanded";

// 넓힌 카드(v1 티켓 35 · 구현 스펙 §15 배치 1 · 캔버스 Layout-Expand · Messages · Motion 보드) — 카드가 무엇을 열었나(`Opened`)와 그 보기의
// 경로 줄, 다시 읽은 문서에서 칠할 줄, 대화 속 문서 카드를 짓는 순수 함수다. 그리는 쪽(`SummaryCard.tsx` · `ExpandedViewer.tsx` ·
// `ThreadFlow.tsx`)은 여기 나온 값만 그린다.

describe("넓힌 카드가 연 것", () => {
  const doc: Opened = { kind: "doc", path: "drafts/design.md" };
  const change: Opened = { kind: "change", project: "api-server", path: "src/refunds/refund.service.ts" };
  const tree: Opened = { kind: "project", project: "api-server", file: null };

  it("경로 줄은 보드의 앞머리를 단다 — 문서는 「문서」, 변경은 그 Project, Project는 「Project」 뒤 이름이고 연 파일이 있으면 그 경로다", () => {
    expect(viewerPath(doc)).toEqual(["문서", "drafts", "design.md"]);
    expect(viewerPath(change)).toEqual(["api-server", "src", "refunds", "refund.service.ts"]);
    expect(viewerPath(tree)).toEqual(["Project", "api-server"]);
    expect(viewerPath({ ...tree, file: "prisma/schema.prisma" })).toEqual(["api-server", "prisma", "schema.prisma"]);
  });

  it("카드 줄이 연 것인가 — 같은 칸 · 같은 Project · 같은 경로일 때만이다. Project 줄은 트리에서 파일을 열어도 켜져 있다", () => {
    expect(isOpened(doc, { kind: "doc", path: "drafts/design.md" })).toBe(true);
    expect(isOpened(doc, { kind: "doc", path: "design.md" })).toBe(false);
    expect(isOpened(change, { kind: "change", project: "web-client", path: "src/refunds/refund.service.ts" })).toBe(false);
    expect(isOpened(change, { kind: "doc", path: "src/refunds/refund.service.ts" })).toBe(false);
    expect(isOpened({ ...tree, file: "package.json" }, { kind: "project", project: "api-server" })).toBe(true);
    expect(isOpened(null, { kind: "project", project: "api-server" })).toBe(false);
  });
});

describe("다시 읽은 문서에서 칠할 줄(Motion 보드 「문서 실시간 편집」)", () => {
  it("새 글에서 더하거나 고친 줄의 번호(1부터)다 — 지우기만 한 자리는 칠할 줄이 없다", () => {
    expect(freshLines("# 고칠 것\n- 두 번 빠짐\n", "# 고칠 것\n- 두 번 빠짐\n- 남은 금액보다 큰 환불은 거절\n")).toEqual([3]);
    expect(freshLines("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([2, 4]);
    expect(freshLines("a\nb\nc\n", "a\nc\n")).toEqual([]);
  });

  it("처음 읽은 글 · 그대로인 글은 칠하지 않는다", () => {
    expect(freshLines(undefined, "a\nb\n")).toEqual([]);
    expect(freshLines("a\nb\n", "a\nb\n")).toEqual([]);
  });
});

/** 손으로 짓는 끝난 편집 도구 줄. */
const write = (id: string, content: unknown[], status = "completed"): ToolEntry => ({
  kind: "tool",
  key: `k-${id}`,
  toolCallId: id,
  call: { toolCallId: id, title: `Write ${id}`, kind: "edit", status, content },
  output: "",
  stop: null,
  cut: false,
  denied: false,
  allowed: null,
  asking: false,
  startedAt: "2026-10-23T14:31:00.000+09:00",
  endedAt: status === "completed" ? "2026-10-23T14:31:02.000+09:00" : null,
});

const turnOf = (entries: Turn["entries"], who = "host"): Pick<Turn, "entries" | "who"> => ({ who, entries });

const SPEC = "/Users/me/.atelier/works/refund-api/spec";
const lines = (n: number) => Array.from({ length: n }, (_, i) => `줄 ${i + 1}`).join("\n");

describe("대화 속 문서 카드(Messages 보드 「Agent가 만든 파일」)", () => {
  it("그 턴의 끝난 쓰기 가운데 이은 Work의 spec 폴더에 새로 쓴 문서만 — spec 기준 경로 · 줄 수 · 쓴 Agent다", () => {
    const turn = turnOf([
      write("a", [{ type: "diff", path: `${SPEC}/design.md`, oldText: null, newText: `${lines(32)}\n` }]),
      write("b", [{ type: "diff", path: `${SPEC}/notes/review.md`, newText: lines(3) }]),
      write("c", [{ type: "diff", path: "/Users/me/.atelier/works/refund-api/trees/api-server/README.md", newText: "x" }]),
      write("d", [{ type: "diff", path: `${SPEC}/overview.md`, oldText: "옛 글\n", newText: "새 글\n" }]),
      write("e", [{ type: "diff", path: `${SPEC}/later.md`, newText: "아직" }], "in_progress"),
    ]);
    expect(createdDocs(turn, SPEC)).toEqual([
      { path: "design.md", lines: 32, who: "host" },
      { path: "notes/review.md", lines: 3, who: "host" },
    ]);
  });

  it("같은 문서를 두 번 쓰면 마지막 글의 줄 수로 한 장이다. spec 폴더를 모르면(Work 없음) 카드가 없다", () => {
    const turn = turnOf(
      [
        write("a", [{ type: "diff", path: `${SPEC}/design.md`, newText: lines(10) }]),
        write("b", [{ type: "diff", path: `${SPEC}/design.md`, newText: lines(12) }]),
      ],
      "writer",
    );
    expect(createdDocs(turn, `${SPEC}/`)).toEqual([{ path: "design.md", lines: 12, who: "writer" }]);
    expect(createdDocs(turn, null)).toEqual([]);
  });
});
