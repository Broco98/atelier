import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { PrChecks, ProjectPr } from "@/features/works/types";
import { followRecordLine, putSummary, threadQuery } from "./hooks";
import type { RecordLine, ThreadSummary, ThreadView } from "./types";
import { workPrsKey } from "./work-card";

// 기록 줄 하나가 연 Thread의 캐시를 고치는 것 — 훅을 렌더하지 않는다(이 저장소의 L2에는 DOM이 없다). 키는 쿼리가 짓는 것을 그대로 쓴다.

const view = (id: string, work: string | null): ThreadView => ({
  id,
  title: id,
  createdAt: "2026-10-23T15:00:00.000+09:00",
  work,
  mode: null,
  participants: [],
  lastRead: 0,
  lastSeq: 0,
  askLevel: "plan",
  live: true,
  queues: {},
  readOnly: null,
});

function seeded(): QueryClient {
  const client = new QueryClient();
  for (const one of [view("가", "refund-api"), view("나", "refund-api"), view("다", "billing"), view("라", null)]) {
    client.setQueryData(threadQuery(one.id).queryKey, one);
  }
  return client;
}

const levels = (client: QueryClient) =>
  Object.fromEntries(["가", "나", "다", "라"].map((id) => [id, client.getQueryData(threadQuery(id).queryKey)?.askLevel]));

const modeLine = (payload: unknown): RecordLine => ({ seq: 9, at: "2026-10-23T15:00:09.000+09:00", kind: "mode", payload });

describe("엔진이 바꾼 물어보는 정도(v1 티켓 26)", () => {
  it("계획만에서 계획대로 구현해 엔진이 적은 mode 줄은 그 Thread와 같은 Work의 연 Thread의 정도를 고친다", () => {
    const client = seeded();
    followRecordLine(client, "가", modeLine({ mode: "always", work: "refund-api" }));
    expect(levels(client)).toEqual({ 가: "always", 나: "always", 다: "plan", 라: "plan" });
  });

  it("Work 없는 Thread의 mode 줄은 그 Thread만 고친다", () => {
    const client = seeded();
    followRecordLine(client, "라", modeLine({ mode: "always", work: null }));
    expect(levels(client)).toEqual({ 가: "plan", 나: "plan", 다: "plan", 라: "always" });
  });

  it("모르는 정도 · 다른 줄은 아무것도 고치지 않는다", () => {
    const client = seeded();
    followRecordLine(client, "가", modeLine({ mode: "sometimes", work: "refund-api" }));
    followRecordLine(client, "가", { seq: 10, at: "2026-10-23T15:00:10.000+09:00", kind: "title", payload: { mode: "always" } });
    expect(levels(client)).toEqual({ 가: "plan", 나: "plan", 다: "plan", 라: "plan" });
  });
});

describe("목록 요약이 연 Thread를 고친다", () => {
  const summary = (id: string, over: Partial<ThreadSummary>): ThreadSummary => ({
    id,
    title: id,
    createdAt: "2026-10-23T15:00:00.000+09:00",
    work: "refund-api",
    handles: [],
    lastRead: 0,
    readOnly: null,
    broken: null,
    ...over,
  });
  const readOnly = (client: QueryClient, id: string) => client.getQueryData(threadQuery(id).queryKey)?.readOnly;

  // v1 티켓 38 — Work를 보관하면 엔진이 그 Work에 이은 Thread의 요약을 다시 알린다. 열린 화면은 그것으로 입력창 자리를 읽기만으로 바꾼다.
  it("이은 Work가 보관되면 연 Thread가 읽기만이 되고, 다른 Thread는 그대로다", () => {
    const client = seeded();
    putSummary(client, summary("가", { readOnly: "archived" }));
    expect(readOnly(client, "가")).toBe("archived");
    expect(readOnly(client, "나")).toBeNull();
    putSummary(client, summary("나", { readOnly: "removed" }));
    expect(readOnly(client, "나")).toBe("removed");
  });
});

describe("엔진이 남긴 PR 줄(v1 티켓 36)", () => {
  const found = (project: string, ci: PrChecks): Extract<ProjectPr, { kind: "found" }> => ({
    project,
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
    ci,
    approvals: 0,
    changesRequested: 0,
    mergedAt: null,
  });
  const prLine = (payload: Record<string, unknown>): RecordLine => ({ seq: 11, at: "2026-10-23T15:00:11.000+09:00", kind: "pr", payload });

  it("턴 끝에 엔진이 읽어 남긴 줄이 Work 카드의 그 Project 칸을 고친다 — 카드가 다시 `gh`를 부르지 않는다", () => {
    const client = new QueryClient();
    client.setQueryData(workPrsKey("refund-api"), [found("api-server", { kind: "pending" }), { project: "web", kind: "absent" }]);
    const { kind: _, ...pr } = found("api-server", { kind: "failing", failed: ["e2e"] });
    followRecordLine(client, "가", prLine({ ...pr, work: "refund-api", first: false }));
    expect(client.getQueryData(workPrsKey("refund-api"))).toEqual([
      found("api-server", { kind: "failing", failed: ["e2e"] }),
      { project: "web", kind: "absent" },
    ]);
  });

  it("카드가 아직 읽지 않은 Work는 그대로 둔다 — 열면 읽는다", () => {
    const client = new QueryClient();
    const { kind: _, ...pr } = found("api-server", { kind: "passing" });
    followRecordLine(client, "가", prLine({ ...pr, work: "refund-api", first: true }));
    expect(client.getQueryData(workPrsKey("refund-api"))).toBeUndefined();
  });
});
