import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectChanges, ProjectPr, SpecTree } from "@/features/works/types";
import type { DocWriting } from "./types";
import {
  changeSummary,
  docRows,
  fileKey,
  freshFiles,
  prRows,
  projectRows,
  readCardOpen,
  writeCardOpen,
  writerLine,
} from "./work-card";

const listed = (project: string, files: [string, number | null, number | null][]): ProjectChanges => ({
  project,
  kind: "listed",
  base: "main",
  files: files.map(([path, additions, deletions]) => ({ path, additions, deletions })),
});

describe("변경 칸", () => {
  it("Project마다 묶고 Project · Work 합계를 더하며, 셀 수 없는 파일(null)은 합계에서 뺀다", () => {
    const summary = changeSummary([
      listed("web-client", [
        ["src/CheckoutPage.tsx", 120, 64],
        ["src/PaymentSummary.tsx", 38, 12],
        ["public/logo.png", null, null],
      ]),
      { project: "admin-console", kind: "worktreeMissing" },
      listed("api-server", [["src/checkout.controller.ts", 9, 2]]),
    ]);
    expect(summary).toEqual({
      additions: 167,
      deletions: 78,
      groups: [
        {
          project: "web-client",
          additions: 158,
          deletions: 76,
          files: [
            { path: "src/CheckoutPage.tsx", additions: 120, deletions: 64 },
            { path: "src/PaymentSummary.tsx", additions: 38, deletions: 12 },
            { path: "public/logo.png", additions: null, deletions: null },
          ],
        },
        { project: "api-server", additions: 9, deletions: 2, files: [{ path: "src/checkout.controller.ts", additions: 9, deletions: 2 }] },
      ],
    });
  });

  it("바뀐 파일이 하나도 없으면 칸이 없다 — 읽기만 하는 Project · 못 읽은 Project · 빈 목록", () => {
    expect(changeSummary([])).toBeNull();
    expect(
      changeSummary([
        { project: "api-server", kind: "worktreeMissing" },
        { project: "web", kind: "baseUnknown", base: "main" },
        { project: "cli", kind: "unreadable", reason: "git 실패" },
        listed("docs", []),
      ]),
    ).toBeNull();
  });

  it("새로 바뀐 파일 — 앞 답에 없던 파일과 +/−가 바뀐 파일만 빛나고, 처음 읽은 답은 빛나지 않는다", () => {
    const before = [listed("api-server", [["refund.service.ts", 14, 6], ["schema.prisma", 4, 0]])];
    const after = [
      listed("api-server", [
        ["refund.controller.ts", 3, 0],
        ["refund.service.ts", 14, 6],
        ["schema.prisma", 5, 0],
      ]),
    ];
    expect(freshFiles(before, after)).toEqual(
      new Set([fileKey("api-server", "refund.controller.ts"), fileKey("api-server", "schema.prisma")]),
    );
    expect(freshFiles(undefined, after)).toEqual(new Set());
    expect(freshFiles(after, after)).toEqual(new Set());
  });
});

describe("문서 칸", () => {
  const tree: SpecTree = {
    fallback: null,
    defaultDoc: "overview.md",
    items: [
      { name: "overview.md", path: "overview.md", kind: "file", icon: null, group: null, children: [] },
      {
        name: "design",
        path: "design",
        kind: "folder",
        icon: null,
        group: null,
        children: [{ name: "api.md", path: "design/api.md", kind: "file", icon: null, group: null, children: [] }],
      },
      { name: "review-notes.md", path: "review-notes.md", kind: "file", icon: null, group: null, children: [] },
    ],
  };
  const host: DocWriting = { path: "design/api.md", who: "host", name: "Host", thread: "20261023-100000" };

  it("spec 트리의 파일을 트리 차례로 펴고, 쓰는 중인 문서에 그 Agent를 단다", () => {
    expect(docRows(tree, [host])).toEqual([
      { path: "overview.md", writer: null },
      { path: "design/api.md", writer: host },
      { path: "review-notes.md", writer: null },
    ]);
  });

  it("아직 트리에 없는 새 문서도 쓰는 중이면 끝에 선다 — 쓰기 시작한 순간 보인다", () => {
    const fresh: DocWriting = { ...host, path: "plan.md" };
    expect(docRows(tree, [fresh]).map((row) => row.path)).toEqual(["overview.md", "design/api.md", "review-notes.md", "plan.md"]);
  });

  it("쓰는 중 문구는 이름의 받침에 맞는 조사를 단다", () => {
    expect(writerLine("Host")).toBe("Host가 쓰는 중");
    expect(writerLine("리뷰어")).toBe("리뷰어가 쓰는 중");
    expect(writerLine("검토관")).toBe("검토관이 쓰는 중");
  });
});

describe("Project 칸", () => {
  it("worktree가 선 Project는 고치는 중, 없는 Project는 읽기만이다 — Work의 Project 차례대로", () => {
    expect(
      projectRows({
        projects: ["web-client", "api-server", "admin-console"],
        worktrees: [
          { project: "web-client", path: "/w/trees/web-client", exists: true, dirty: true },
          { project: "api-server", path: "/w/trees/api-server", exists: true, dirty: false },
          { project: "admin-console", path: "/w/trees/admin-console", exists: false, dirty: false },
        ],
      }),
    ).toEqual([
      { project: "web-client", editing: true },
      { project: "api-server", editing: true },
      { project: "admin-console", editing: false },
    ]);
  });
});

describe("PR 줄", () => {
  const found = (over: Partial<Extract<ProjectPr, { kind: "found" }>> = {}): ProjectPr => ({
    project: "api-server",
    kind: "found",
    number: 142,
    title: "부분 환불 이중 차감 수정",
    url: "https://github.com/acme/api/pull/142",
    state: "open",
    headBranch: "fix/refund-api",
    baseBranch: "main",
    additions: 48,
    deletions: 12,
    changedFiles: 3,
    ci: { kind: "pending" },
    approvals: 0,
    changesRequested: 0,
    mergedAt: null,
    ...over,
  });

  it("찾은 PR마다 한 줄이고, 없거나 못 읽은 Project는 줄이 없다", () => {
    expect(
      prRows([found(), { project: "web", kind: "absent" }, { project: "cli", kind: "unreadable", reason: "network" }]),
    ).toEqual([{ project: "api-server", number: 142, url: "https://github.com/acme/api/pull/142", status: "CI 확인 중", checking: true }]);
  });

  it("상태는 색 없이 문장이다 — 확인 중 · 통과 · 실패 · 병합됨 · 닫힘 · 검사 없는 열림", () => {
    const status = (pr: ProjectPr) => prRows([pr]).map((row) => [row.status, row.checking]);
    expect(status(found({ ci: { kind: "passing" } }))).toEqual([["CI 통과", false]]);
    expect(status(found({ ci: { kind: "failing", failed: ["e2e"] } }))).toEqual([["CI 실패", false]]);
    expect(status(found({ state: "merged", ci: { kind: "passing" } }))).toEqual([["병합됨", false]]);
    expect(status(found({ state: "closed" }))).toEqual([["닫힘", false]]);
    expect(status(found({ ci: { kind: "noChecks" } }))).toEqual([["열림", false]]);
  });
});

describe("카드 열림 기억(S32)", () => {
  const stored = new Map<string, string>();
  beforeEach(() => {
    stored.clear();
    globalThis.localStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    } as Storage;
  });
  afterEach(() => {
    // @ts-expect-error — 시험이 심은 저장소를 걷는다.
    delete globalThis.localStorage;
  });

  it("Work마다 기억하고, 적은 적이 없으면 열려 있다", () => {
    expect(readCardOpen("refund-api")).toBe(true);
    writeCardOpen("refund-api", false);
    expect(readCardOpen("refund-api")).toBe(false);
    expect(readCardOpen("checkout"), "다른 Work는 따로다").toBe(true);
    writeCardOpen("refund-api", true);
    expect(readCardOpen("refund-api")).toBe(true);
  });

  it("저장소를 읽지 못하면 열린 것으로 본다", () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("막힘");
      },
      setItem: () => {
        throw new Error("막힘");
      },
    } as unknown as Storage;
    writeCardOpen("refund-api", false);
    expect(readCardOpen("refund-api")).toBe(true);
  });
});
