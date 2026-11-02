import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "@/features/thread/types";
import { problemNotice, serviceFacts, serviceSections } from "./service-detail";
import type { ServiceDetail, ServiceProblem } from "./types";

// Service 상세의 묶음(restart 03-3 · 스토리 115 · 116 · 보드 MainServiceDetail · Places `DETAILS.payments` · `DETAILS.admin`) — Projects · 작업공간 ·
// 함께 쓰는 Service. 값은 보드 장면을 따른 꾸민 것이다.

const chat = (id: string, lastAt: string, over: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id,
  title: id,
  createdAt: "2026-10-01T09:00:00.000+09:00",
  lastAt,
  work: null,
  service: null,
  project: null,
  lastRead: 0,
  readOnly: null,
  broken: null,
  ...over,
});

const project = (slug: string, over: { path?: string; missing?: boolean; name?: string } = {}) => ({
  slug,
  name: over.name ?? slug,
  path: over.path ?? `~/work/payments/${slug}`,
  missing: over.missing ?? false,
});

const work = (slug: string, projects: string[], over: { title?: string; branch?: string | null; service?: string } = {}) => ({
  slug,
  title: over.title ?? slug,
  branch: over.branch === undefined ? `feat/${slug}` : over.branch,
  projects,
  ...(over.service !== undefined && { service: over.service }),
});

const unknown = (line: number, slug: string): ServiceProblem => ({ line, kind: "unknownProject", project: slug, message: "등록되지 않은 Project예요" });

const detail = (over: Partial<ServiceDetail> = {}): ServiceDetail => ({
  slug: "payments",
  name: "결제 시스템",
  projects: ["backend", "front"],
  createdAt: "2026-08-14",
  createdBy: null,
  description: "결제 승인과 정산을 맡는다. backend와 front를 함께 고친다.",
  problems: [],
  shared: [],
  ...over,
});

const REGISTERED = [
  project("backend"),
  project("front"),
  project("legacy-admin", { path: "~/old/legacy-admin", missing: true }),
  project("atelier", { path: "~/MyProjects/atelier" }),
];

describe("Projects 묶음", () => {
  it("넣은 Project가 이름 · 경로 · 그 Project의 최근 활동으로 서고, 최근 활동 순이다", () => {
    const threads = [
      chat("front 범위", "2026-11-02T09:00:00.000+09:00", { project: "front" }),
      chat("backend 작업공간", "2026-11-03T06:00:00.000+09:00", { work: "refund-webhook" }),
    ];
    const works = [work("refund-webhook", ["backend"], { service: "payments" })];
    expect(serviceSections(detail(), REGISTERED, works, threads).projects).toEqual([
      { slug: "backend", name: "backend", desc: "~/work/payments/backend", at: "2026-11-03T06:00:00.000+09:00", missing: false },
      { slug: "front", name: "front", desc: "~/work/payments/front", at: "2026-11-02T09:00:00.000+09:00", missing: false },
    ]);
  });

  it("등록되지 않은 Project는 줄로 서지 않고(경고가 말한다), 폴더를 찾을 수 없는 Project는 그렇게 말하는 줄이다", () => {
    const admin = detail({ slug: "admin", projects: ["front", "legacy-api", "legacy-admin"], problems: [unknown(3, "legacy-api")] });
    expect(serviceSections(admin, REGISTERED, [], []).projects).toEqual([
      { slug: "front", name: "front", desc: "~/work/payments/front", at: null, missing: false },
      { slug: "legacy-admin", name: "legacy-admin", desc: "폴더를 찾을 수 없어요", at: null, missing: true },
    ]);
  });
});

describe("작업공간 묶음", () => {
  it("그 Service를 쓰는 작업공간이 이름 · 브랜치 · 그 작업공간 채팅의 마지막 줄 시각으로 서고, 최근 활동 순이다", () => {
    const works = [
      work("refund-webhook", ["backend"], { title: "환불 웹훅", service: "payments" }),
      work("settle-batch", ["backend", "front"], { title: "정산 배치", service: "payments", branch: null }),
      work("console-fix", ["front"], { title: "콘솔 고치기", service: "admin" }),
      work("loose", ["front"], { title: "Service 없는 작업공간" }),
    ];
    const threads = [
      chat("옛 채팅", "2026-10-31T09:00:00.000+09:00", { work: "refund-webhook" }),
      chat("새 채팅", "2026-11-01T09:00:00.000+09:00", { work: "refund-webhook" }),
      chat("콘솔 채팅", "2026-11-03T08:00:00.000+09:00", { work: "console-fix" }),
      chat("깨진 채팅", "2026-11-03T08:30:00.000+09:00", { work: "settle-batch", broken: "기록을 읽지 못했어요" }),
    ];
    expect(serviceSections(detail(), REGISTERED, works, threads).works).toEqual([
      { slug: "refund-webhook", name: "환불 웹훅", desc: "feat/refund-webhook", at: "2026-11-01T09:00:00.000+09:00" },
      { slug: "settle-batch", name: "정산 배치", desc: "", at: null },
    ]);
  });
});

describe("위 카드", () => {
  it("Project · 작업공간 · 함께 쓰는 Service의 수와 만든 날이다 — Project 수는 등록된 것만이다", () => {
    const admin = detail({
      projects: ["front", "legacy-api", "legacy-admin"],
      problems: [unknown(3, "legacy-api")],
      shared: [{ slug: "platform", name: "플랫폼", overlap: ["front"], projects: ["front"] }],
    });
    const works = [work("refund-webhook", ["backend"], { service: "payments" }), work("console-fix", ["front"], { service: "admin" })];
    expect(serviceFacts(admin, works)).toEqual([
      { label: "Project", value: "2개" },
      { label: "작업공간", value: "1개 진행 중" },
      { label: "함께 쓰는 Service", value: "1개" },
      { label: "만든 날", value: "2026년 8월 14일" },
    ]);
  });

  it("없는 것은 「없음」, 읽지 못한 날은 「—」다", () => {
    expect(serviceFacts(detail({ projects: [], createdAt: "" }), [])).toEqual([
      { label: "Project", value: "없음" },
      { label: "작업공간", value: "없음" },
      { label: "함께 쓰는 Service", value: "없음" },
      { label: "만든 날", value: "—" },
    ]);
  });
});

// 스토리 118 · 보드 PlaceSheet 「문제가 있는 Service — 파일의 몇째 줄인지까지 말한다」. 고치는 길(「파일로 고치기」)은 경고 끝의 단추다.
describe("상세 경고", () => {
  const problem = (line: number, kind: ServiceProblem["kind"], message: string, project?: string): ServiceProblem => ({
    line,
    kind,
    message,
    ...(project && { project }),
  });

  it("문제가 없으면 경고가 없다", () => {
    expect(problemNotice([])).toBeNull();
  });

  it("첫 문제의 갈래와 파일의 줄, 그 Project를 한 줄로 말한다", () => {
    expect(problemNotice([unknown(3, "legacy-api")])).toBe("등록되지 않은 Project가 있어요. Service 파일 3번째 줄 · legacy-api");
    expect(problemNotice([problem(5, "duplicateProject", "같은 Project가 두 번 있어요", "front")])).toBe(
      "같은 Project를 두 번 적었어요. Service 파일 5번째 줄 · front",
    );
    expect(problemNotice([problem(2, "noName", "이름(name)이 비어 있어요")])).toBe("이름(name)이 비어 있어요. Service 파일 2번째 줄");
    expect(problemNotice([problem(1, "unclosedFrontmatter", "frontmatter가 닫히지 않았어요")])).toBe("frontmatter가 닫히지 않았어요. Service 파일 1번째 줄");
    expect(problemNotice([problem(4, "badYaml", "YAML로 읽을 수 없어요")])).toBe("frontmatter를 YAML로 읽을 수 없어요. Service 파일 4번째 줄");
  });

  it("글로 읽을 수 없는 파일은 줄이 없다", () => {
    expect(problemNotice([problem(1, "unreadable", "파일을 읽을 수 없어요")])).toBe("Service 파일을 글로 읽을 수 없어요");
  });

  it("문제가 더 있으면 그 수를 덧붙인다", () => {
    expect(problemNotice([unknown(3, "legacy-api"), unknown(4, "old-api"), problem(2, "noName", "이름(name)이 비어 있어요")])).toBe(
      "등록되지 않은 Project가 있어요. Service 파일 3번째 줄 · legacy-api · 다른 문제 2개",
    );
  });
});

// 스토리 116 — 한 Project가 여러 Service에 든다. 같은 Project를 넣은 다른 Service가 이 묶음에 선다(그 Service의 상세에서는 이쪽이 선다).
describe("함께 쓰는 Service 묶음", () => {
  it("같은 Project를 넣은 다른 Service가 이름 · 겹치는 Project · 그 Service의 최근 활동으로 서고, 최근 활동 순이다", () => {
    const shared = [
      { slug: "admin", name: "관리자 콘솔", overlap: ["front"], projects: ["front", "legacy-admin"] },
      { slug: "platform", name: "플랫폼", overlap: ["backend", "front"], projects: ["backend", "front", "infra"] },
    ];
    const works = [work("console-fix", ["front"], { service: "admin" })];
    const threads = [
      chat("콘솔 채팅", "2026-10-06T09:00:00.000+09:00", { work: "console-fix" }),
      chat("범위 채팅", "2026-11-03T08:00:00.000+09:00", { service: "platform" }),
    ];
    expect(serviceSections(detail({ shared }), REGISTERED, works, threads).shared).toEqual([
      { slug: "platform", name: "플랫폼", desc: "겹치는 Project · backend · front", at: "2026-11-03T08:00:00.000+09:00" },
      { slug: "admin", name: "관리자 콘솔", desc: "겹치는 Project · front", at: "2026-10-06T09:00:00.000+09:00" },
    ]);
  });
});
