import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PrCardEntry } from "./fold";
import type { PrLine } from "./pr";
import { PrCard, PrPlace } from "./PrCard";

// Thread의 PR 카드(v1 티켓 36 · 스토리 124 · 125 · 126 · 캔버스 Cards 보드 「PR」 · Screen-Review) — 카드는 훅 없이 그린다(동작은
// `PrPlace`가 준다). 정적 마크업으로 상태마다의 모양과 문장을 잰다.

const pr: PrLine = {
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
const now = new Date(2026, 9, 23, 16, 30).getTime();
const card = (over: Partial<PrLine> = {}, latest = true): string => {
  const entry: PrCardEntry = { key: "p1", pr: { ...pr, ...over }, latest, turnsBefore: 1 };
  return renderToStaticMarkup(<PrCard card={entry} now={now} />);
};
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("PR 카드", () => {
  it("열린 PR — 제목 · # · 열림, 브랜치 → base · +/− · 파일 수 · 리뷰 · CI 문장, 「변경 사항 보기」 · 「GitHub에서 열기」(화면 3)", () => {
    const markup = card();
    expect(markup).toContain('aria-label="PR #142 부분 환불 이중 차감 수정"');
    expect(text(markup)).toBe(
      "부분 환불 이중 차감 수정 #142 열림 fix/refund-api → main +48 −12 파일 3개 승인 1개 CI 확인 중 변경 사항 보기 GitHub에서 열기",
    );
    expect(markup).toMatch(/bg-accent-soft[^"]*text-link[^>]*>열림/);
    expect(markup).toMatch(/font-mono[^>]*>fix\/refund-api → main/);
    expect(markup).not.toContain("Host에게 고쳐 달라고 하기");
  });

  it("CI가 실패하면 색 대신 진한 ⓘ와 「CI 실패 · 검사」 문장, 「Host에게 고쳐 달라고 하기」가 선다 — 빨강은 쓰지 않는다(스토리 125)", () => {
    const markup = card({ ci: { kind: "failing", failed: ["e2e"] } });
    expect(text(markup)).toBe(
      "부분 환불 이중 차감 수정 #142 열림 fix/refund-api → main +48 −12 파일 3개 승인 1개 CI 실패 · e2e Host에게 고쳐 달라고 하기 변경 사항 보기 GitHub에서 열기",
    );
    expect(markup).toMatch(/<svg[^>]*text-fg[" ][^>]*data-ci="failing"/);
    expect(markup).toMatch(/<b[^>]*>CI 실패<\/b>/);
    expect(markup).not.toMatch(/danger|text-diff-deleted[^"]*"[^>]*>CI|text-red/);
  });

  it("지난 상태의 카드(같은 PR의 뒤 카드가 있다)에는 고쳐 달라는 버튼이 없다 — 지금의 실패가 아닐 수 있다", () => {
    expect(card({ ci: { kind: "failing", failed: ["e2e"] } }, false)).not.toContain("Host에게 고쳐 달라고 하기");
  });

  it("읽기만인 Thread(보관된 Work — v1 티켓 38)에는 고쳐 달라는 버튼이 없다 — 말을 채울 입력창이 없다", () => {
    const entry: PrCardEntry = { key: "p1", pr: { ...pr, ci: { kind: "failing", failed: ["e2e"] } }, latest: true, turnsBefore: 1 };
    const markup = renderToStaticMarkup(
      <PrPlace.Provider value={{ showChanges: () => {} }}>
        <PrCard card={entry} now={now} />
      </PrPlace.Provider>,
    );
    expect(text(markup)).toContain("CI 실패 · e2e");
    expect(markup).not.toContain("Host에게 고쳐 달라고 하기");
  });

  it("병합된 PR — 병합됨과 브랜치 → base · 병합한 때만 서고 동작이 없다(Cards 보드 「합쳐짐」)", () => {
    const mergedAt = new Date(2026, 9, 22, 18, 12).toISOString();
    const markup = card({ state: "merged", ci: { kind: "passing" }, mergedAt, number: 139, title: "릴리스 노트 0.9", headBranch: "docs/release-0.9" });
    expect(text(markup)).toBe("릴리스 노트 0.9 #139 병합됨 docs/release-0.9 → main 어제 오후 6:12");
    expect(markup).toMatch(/bg-fill-soft[^"]*text-fg-secondary[^>]*>병합됨/);
    expect(markup).toContain('data-pr-icon="merged"');
  });

  it("닫힌 PR — 닫힘, CI · 리뷰 없이 「GitHub에서 열기」만", () => {
    expect(text(card({ state: "closed", ci: { kind: "failing", failed: ["e2e"] } }))).toBe(
      "부분 환불 이중 차감 수정 #142 닫힘 fix/refund-api → main +48 −12 파일 3개 GitHub에서 열기",
    );
  });

  it("검사가 없는 열린 PR에는 CI 문장이 없고, 리뷰가 없으면 「리뷰 전」이다", () => {
    expect(text(card({ ci: { kind: "noChecks" }, approvals: 0 }))).toBe(
      "부분 환불 이중 차감 수정 #142 열림 fix/refund-api → main +48 −12 파일 3개 리뷰 전 변경 사항 보기 GitHub에서 열기",
    );
  });
});
