import { describe, expect, it } from "vitest";
import { changesOf, ciText, failedChecks, failNote, fixAsk, mergedWhen, prLineOf, reviewText, type PrLine } from "./pr";

// PR 카드와 PR 줄의 문장(v1 티켓 36 · 스토리 124 · 125 · 캔버스 Cards · WorkPanel 보드) — CI는 색 없이 문장이다. seam은 순수 함수들이다:
// 기록의 `pr` 줄 → 카드의 값, PR 상태 → 문장.

const line: PrLine = {
  work: "refund-api",
  project: "api-server",
  first: true,
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
  approvals: 1,
  changesRequested: 0,
  mergedAt: null,
};

describe("`pr` 줄", () => {
  it("엔진이 적은 줄(L1 `thread_pr`의 꼴)을 그대로 읽는다", () => {
    expect(prLineOf({ ...line })).toEqual(line);
    expect(prLineOf({ ...line, ci: { kind: "failing", failed: ["e2e", 3] } })?.ci).toEqual({ kind: "failing", failed: ["e2e"] });
    expect(prLineOf({ ...line, state: "merged", mergedAt: "2026-10-23T06:02:00Z" })?.mergedAt).toBe("2026-10-23T06:02:00Z");
  });

  it("그릴 수 없는 줄은 버린다 — 번호 · 제목 · 주소 · 상태 · CI가 꼴이 아니면", () => {
    expect(prLineOf(null)).toBeNull();
    expect(prLineOf({ ...line, number: "142" })).toBeNull();
    expect(prLineOf({ ...line, url: undefined })).toBeNull();
    expect(prLineOf({ ...line, state: "draft" })).toBeNull();
    expect(prLineOf({ ...line, ci: { kind: "flaky" } })).toBeNull();
  });
});

describe("CI 문장(스토리 125)", () => {
  it("확인 중 · 통과 · 실패이고, 검사가 없으면 문장이 없다", () => {
    expect(ciText({ kind: "pending" })).toBe("CI 확인 중");
    expect(ciText({ kind: "passing" })).toBe("CI 통과");
    expect(ciText({ kind: "failing", failed: ["e2e"] })).toBe("CI 실패");
    expect(ciText({ kind: "noChecks" })).toBeNull();
  });

  it("실패한 검사는 둘까지 이름을 적고, 셋부터는 「외 N개」로 줄인다", () => {
    expect(failedChecks(["e2e"])).toBe("e2e");
    expect(failedChecks(["e2e", "lint"])).toBe("e2e, lint");
    expect(failedChecks(["e2e", "lint", "build"])).toBe("e2e 외 2개");
    expect(failedChecks([])).toBe("");
  });

  it("요약 카드의 실패 문장은 무엇이 실패했는지 한 문장이다(보드 「빨간색 대신 문장으로」)", () => {
    expect(failNote(["e2e"])).toBe("e2e 검사가 실패했어요.");
    expect(failNote(["e2e", "lint", "build"])).toBe("e2e 외 2개 검사가 실패했어요.");
    expect(failNote([])).toBe("검사가 실패했어요.");
  });

  it("「Host에게 고쳐 달라고 하기」가 입력창에 채우는 말은 PR 번호와 실패한 검사를 모두 싣는다", () => {
    expect(fixAsk({ number: 142, ci: { kind: "failing", failed: ["e2e", "lint", "build"] } })).toBe(
      "PR #142의 CI에서 e2e, lint, build 검사가 실패했어요. 원인을 찾아 고쳐 줘.",
    );
  });
});

describe("리뷰 문장", () => {
  it("승인 수와 수정 요청 수를 따로 세고, 둘 다 없으면 「리뷰 전」이다", () => {
    expect(reviewText({ approvals: 1, changesRequested: 0 })).toEqual(["승인 1개"]);
    expect(reviewText({ approvals: 2, changesRequested: 1 })).toEqual(["승인 2개", "수정 요청 1개"]);
    expect(reviewText({ approvals: 0, changesRequested: 0 })).toEqual(["리뷰 전"]);
  });
});

describe("병합 시각", () => {
  const now = new Date(2026, 9, 23, 16, 30).getTime();
  const local = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).toISOString();

  it("오늘이면 시각만, 어제면 「어제」와 시각, 그 앞은 날짜다(보드 「오후 3:02」 · 「어제 오후 6:12」 · 「10월 20일」)", () => {
    expect(mergedWhen(local(23, 15, 2), now)).toBe("오후 3:02");
    expect(mergedWhen(local(22, 18, 12), now)).toBe("어제 오후 6:12");
    expect(mergedWhen(local(20, 9, 0), now)).toBe("10월 20일");
    expect(mergedWhen("엉뚱한 값", now)).toBe("");
  });
});

describe("「변경 사항 보기」가 넓힌 카드에서 여는 것(v1 티켓 35)", () => {
  const listed = (project: string, paths: string[]) => ({
    project,
    kind: "listed" as const,
    base: "main",
    files: paths.map((path) => ({ path, additions: 1, deletions: 0 })),
  });

  it("그 PR의 Project에서 바뀐 첫 파일의 diff를 연다", () => {
    const changes = [listed("web", ["src/a.ts"]), listed("api-server", ["src/refund.ts", "src/b.ts"])];
    expect(changesOf("api-server", changes)).toEqual({ kind: "change", project: "api-server", path: "src/refund.ts" });
  });

  it("그 Project에 바뀐 파일이 없거나 변경을 읽지 못했으면 그 Project의 트리를 연다", () => {
    expect(changesOf("api-server", [listed("api-server", [])])).toEqual({ kind: "project", project: "api-server", file: null });
    expect(changesOf("api-server", [{ project: "api-server", kind: "worktreeMissing" }])).toEqual({
      kind: "project",
      project: "api-server",
      file: null,
    });
    expect(changesOf("api-server", undefined)).toEqual({ kind: "project", project: "api-server", file: null });
  });
});
