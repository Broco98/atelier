import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { PrChecks, ProjectPr } from "@/features/works/types";
import { followRecordLine, putChips, putSummary, threadQuery, threadsQuery } from "./hooks";
import type { RecordLine, ThreadSummary, ThreadView } from "./types";
import { workPrsKey } from "./summary-card";

// 기록 줄 하나가 연 Thread의 캐시를 고치는 것 — 훅을 렌더하지 않는다(이 저장소의 L2에는 DOM이 없다). 키는 쿼리가 짓는 것을 그대로 쓴다.

const view = (id: string, work: string | null): ThreadView => ({
  id,
  title: id,
  createdAt: "2026-10-23T15:00:00.000+09:00",
  work,
  mode: null,
  runtime: "claude-code",
  sessionId: null,
  cwd: null,
  additionalDirectories: [],
  model: null,
  effort: null,
  lastRead: 0,
  lastSeq: 0,
  askLevel: "plan",
  live: true,
  queue: [],
  readOnly: null,
  flowing: null,
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
  it("계획에서 계획대로 구현해 엔진이 적은 mode 줄은 그 Thread와 같은 Work의 연 Thread의 정도를 고친다", () => {
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

const summary = (id: string, over: Partial<ThreadSummary>): ThreadSummary => ({
  id,
  title: id,
  createdAt: "2026-10-23T15:00:00.000+09:00",
  lastAt: "2026-10-23T15:00:00.000+09:00",
  work: "refund-api",
  service: null,
  project: null,
  lastRead: 0,
  readOnly: null,
  broken: null,
  ...over,
});

// restart 03-1 — 목록의 「최근 활동」은 채팅의 마지막 줄 시각에서 선다. 엔진은 줄마다 요약을 다시 알리지 않는다 — 기록 줄 이벤트가 곧 그
// 알림이라 화면이 그 줄의 시각을 목록 요약에 앉힌다. 「최근 활동」이 분까지 말하므로 1분 안의 줄로는 목록을 갈아 끼우지 않는다(목록을 읽는
// 자리가 턴의 줄마다 다시 그려지지 않게). 늦게 온 요약(읽은 자리의 답 · 이름)이 옛 시각을 실었어도 목록은 뒤로 가지 않는다.
describe("마지막 줄 시각", () => {
  const listed = () => {
    const client = new QueryClient();
    client.setQueryData(threadsQuery().queryKey, [summary("가", {}), summary("나", {})]);
    return client;
  };
  const lastAt = (client: QueryClient) => Object.fromEntries((client.getQueryData(threadsQuery().queryKey) ?? []).map((one) => [one.id, one.lastAt]));

  it("기록 줄이 오면 그 채팅의 요약이 그 줄의 시각을 갖고, 다른 채팅은 그대로다", () => {
    const client = listed();
    followRecordLine(client, "가", { seq: 4, at: "2026-10-24T09:30:00.000+09:00", kind: "turn-end", payload: {} });
    expect(lastAt(client)).toEqual({ 가: "2026-10-24T09:30:00.000+09:00", 나: "2026-10-23T15:00:00.000+09:00" });
  });

  it("1분 안의 줄로는 목록을 갈아 끼우지 않는다", () => {
    const client = listed();
    const before = client.getQueryData(threadsQuery().queryKey);
    followRecordLine(client, "가", { seq: 2, at: "2026-10-23T15:00:59.000+09:00", kind: "update", payload: {} });
    expect(client.getQueryData(threadsQuery().queryKey)).toBe(before);
    followRecordLine(client, "가", { seq: 3, at: "2026-10-23T15:01:00.000+09:00", kind: "update", payload: {} });
    expect(lastAt(client).가).toBe("2026-10-23T15:01:00.000+09:00");
  });

  it("앞선 시각의 줄 · 요약은 마지막 줄 시각을 되돌리지 않는다", () => {
    const client = listed();
    followRecordLine(client, "가", { seq: 4, at: "2026-10-24T09:30:00.000+09:00", kind: "turn-end", payload: {} });
    followRecordLine(client, "가", { seq: 3, at: "2026-10-24T09:29:00.000+09:00", kind: "update", payload: {} });
    putSummary(client, summary("가", { lastRead: 4, lastAt: "2026-10-24T09:29:59.000+09:00" }));
    expect(lastAt(client).가).toBe("2026-10-24T09:30:00.000+09:00");
    expect(client.getQueryData(threadsQuery().queryKey)?.[0].lastRead).toBe(4);
  });
});

describe("목록 요약이 연 Thread를 고친다", () => {
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

describe("칩 바꾸기의 답", () => {
  it("바뀐 채팅의 값이 연 Thread의 모델 · 생각 깊이를 고치고, 다른 칸과 다른 Thread는 그대로다", () => {
    const client = seeded();
    putChips(client, "가", { model: "opus", effort: "high" });
    const chips = (id: string) => {
      const view = client.getQueryData(threadQuery(id).queryKey);
      return [view?.title, view?.model, view?.effort];
    };
    expect(chips("가")).toEqual(["가", "opus", "high"]);
    expect(chips("나")).toEqual(["나", null, null]);
  });

  it("아직 읽지 않은 Thread는 캐시를 세우지 않는다", () => {
    const client = new QueryClient();
    putChips(client, "가", { model: "opus", effort: null });
    expect(client.getQueryData(threadQuery("가").queryKey)).toBeUndefined();
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

  it("턴 끝에 엔진이 읽어 남긴 줄이 요약 카드의 그 Project PR 줄을 고친다 — 카드가 다시 `gh`를 부르지 않는다", () => {
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

// 03 티켓 08 — Service 질문 카드에 답하면 엔진이 그 Thread(Work에 이었으면 그 Work)의 `service`를 고치지만 묻던 Thread에는 Service 줄이 서지 않는다
// (답한 줄이 그 결정이다). 그 답 줄이 연 Thread의 칸(머리 줄)과 읽는 범위를 다시 읽게 한다.
describe("Service 질문 카드의 답 줄", () => {
  const answered = (card: string): RecordLine => ({
    seq: 9,
    at: "2026-10-23T15:00:09.000+09:00",
    kind: "question",
    payload: { state: "answered", requestId: "r", card, choice: "service", service: "결제-서비스", name: "결제 서비스" },
  });
  const stale = (client: QueryClient, id: string) => client.getQueryState(threadQuery(id).queryKey)?.isInvalidated;

  it("Service 카드의 답 줄은 그 Thread를 다시 읽게 하고, 다른 카드의 답 줄은 그러지 않는다", () => {
    const client = seeded();
    followRecordLine(client, "라", answered("project"));
    expect(stale(client, "라")).toBe(false);
    followRecordLine(client, "라", answered("service"));
    expect(stale(client, "라")).toBe(true);
    expect(stale(client, "가")).toBe(false);
  });
});
