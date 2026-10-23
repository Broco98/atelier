import { describe, expect, it } from "vitest";
import type { AgentChoice } from "@/features/thread/mentions";
import type { ThreadSummary } from "@/features/thread/types";
import { agentPathPieces, frontmatterAsCode, groupsOf, pickedAgent, workOfPlace } from "./library";

// Library 화면(v1 티켓 19 · 구현 스펙 §16 S35)의 순수 규칙 — 목록 묶음 · 고른 줄 · 문서 보기의 글 · 경로 줄 · 사이드바 Library 줄이 여는
// Work. 화면은 이것들을 잇기만 한다.

const choice = (call: string, section: string, broken: string | null = null): AgentChoice => ({
  call,
  handle: call.split("/").pop() ?? call,
  name: call,
  description: "",
  avatar: null,
  from: section === "Library" ? "library" : { project: section },
  section,
  seated: false,
  broken,
  model: null,
});

describe("목록 묶음", () => {
  it("Library가 먼저이고, 지금 Work의 Project 안 Agent는 Project마다 따로 묶인다 — 깨진 줄도 제 묶음에 선다", () => {
    const groups = groupsOf([
      choice("host", "Library"),
      choice("reviewer", "Library"),
      choice("api/reviewer", "api"),
      choice("api/writer", "api", "모르는 도구가 있어요: Bash"),
      choice("web/tester", "web"),
    ]);
    expect(groups.map((group) => [group.section, group.rows.map((row) => row.call)])).toEqual([
      ["Library", ["host", "reviewer"]],
      ["api", ["api/reviewer", "api/writer"]],
      ["web", ["web/tester"]],
    ]);
  });
});

describe("고른 줄", () => {
  const rows = [choice("host", "Library"), choice("reviewer", "Library"), choice("old", "Library", "깨짐")];

  it("주소가 고른 Agent가 목록에 있으면 그것이고, 깨진 줄도 고를 수 있다 — 무엇이 틀렸는지 읽게", () => {
    expect(pickedAgent(rows, "reviewer")?.call).toBe("reviewer");
    expect(pickedAgent(rows, "old")?.call).toBe("old");
  });

  it("고르지 않았거나 목록에서 사라졌으면 첫 줄이고, 목록이 비면 없다", () => {
    expect(pickedAgent(rows, undefined)?.call).toBe("host");
    expect(pickedAgent(rows, "gone")?.call).toBe("host");
    expect(pickedAgent([], "reviewer")).toBeNull();
  });
});

describe("문서 보기의 글", () => {
  it("frontmatter는 YAML 코드 블록이 되고 줄 수는 그대로다 — 블록 복사의 줄 번호가 파일의 줄 번호다", () => {
    const file = "---\nname: 리뷰어\ntools:\n  builtin: [read]\n---\n\n너는 리뷰어다.\n";
    const shown = frontmatterAsCode(file);
    expect(shown).toBe("```yaml\nname: 리뷰어\ntools:\n  builtin: [read]\n```\n\n너는 리뷰어다.\n");
    expect(shown.split("\n")).toHaveLength(file.split("\n").length);
  });

  it("본문이 없어도, frontmatter가 없거나 닫히지 않았어도 글을 잃지 않는다", () => {
    expect(frontmatterAsCode("---\nname: 빈\n---")).toBe("```yaml\nname: 빈\n```");
    expect(frontmatterAsCode("frontmatter 없는 글")).toBe("frontmatter 없는 글");
    expect(frontmatterAsCode("---\nname: 닫히지 않음\n")).toBe("---\nname: 닫히지 않음\n");
  });
});

describe("경로 줄", () => {
  it("Library의 Agent는 Library › 파일, Project의 Agent는 레포 안 자리다", () => {
    expect(agentPathPieces(choice("reviewer", "Library"))).toEqual(["Library", "reviewer.md"]);
    expect(agentPathPieces(choice("api/reviewer", "api"))).toEqual(["api", ".atelier", "agents", "reviewer.md"]);
  });
});

describe("사이드바의 Library 줄이 여는 Work", () => {
  const summary = (id: string, work: string | null): ThreadSummary => ({
    id,
    title: id,
    createdAt: "2026-10-23T10:00:00+09:00",
    work,
    handles: ["host"],
    lastRead: 0,
    readOnly: null,
    broken: null,
  });
  const threads = [summary("20261023-100000", "refund-api"), summary("20261023-110000", null)];

  it("Work에 이은 Thread에 서 있으면 그 Work이고, Work 없는 Thread · 새 Thread면 없다", () => {
    expect(workOfPlace("/threads/20261023-100000", threads, null)).toBe("refund-api");
    expect(workOfPlace("/threads/20261023-110000", threads, null)).toBeNull();
    expect(workOfPlace("/", threads, null)).toBeNull();
    expect(workOfPlace("/threads/모르는-id", undefined, null)).toBeNull();
  });

  it("Work 화면이면 그 Work이고, Library에 서 있으면 지금 보는 Work를 그대로 둔다", () => {
    expect(workOfPlace("/works/refund-api", threads, null)).toBe("refund-api");
    expect(workOfPlace("/works/refund-api/", threads, null)).toBe("refund-api");
    expect(workOfPlace("/library", threads, "refund-api")).toBe("refund-api");
    expect(workOfPlace("/projects/api", threads, "refund-api")).toBeNull();
  });
});
