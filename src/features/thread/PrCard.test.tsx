import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Arrival, settledPlace } from "./arrival";
import type { PrCardEntry } from "./fold";
import type { PrLine } from "./pr";
import { PrCard, PrPlace } from "./PrCard";

// Thread의 PR 카드(v1 티켓 36 · 스토리 124 · 125 · 126 · ChatCards 보드 「PR 카드」) — 동작은 `PrPlace`가 준다. 정적 마크업으로 상태마다의 모양과
// 문장을 잰다.

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
    expect(markup).not.toContain("고쳐 달라고 하기");
  });

  // 실패 칸의 문장은 ChatCards 「CI 실패 · 지금 카드」 그대로다 — 「CI 실패 · watcher-retry 검사가 실패했어요.」(restart 02b-6, 요약 카드 PR 줄의 실패 문장과 같다).
  it("CI가 실패하면 색 대신 진한 ⓘ와 「CI 실패 · 검사가 실패했어요」 문장, 「고쳐 달라고 하기」가 선다 — 빨강은 쓰지 않는다(스토리 125)", () => {
    const markup = card({ ci: { kind: "failing", failed: ["e2e"] } });
    expect(text(markup)).toBe(
      "부분 환불 이중 차감 수정 #142 열림 fix/refund-api → main +48 −12 파일 3개 승인 1개 CI 실패 · e2e 검사가 실패했어요. 고쳐 달라고 하기 변경 사항 보기 GitHub에서 열기",
    );
    expect(markup).toMatch(/<svg[^>]*text-fg[" ][^>]*data-ci="failing"/);
    expect(markup).toMatch(/<b[^>]*>CI 실패<\/b>/);
    expect(markup).not.toMatch(/danger|text-diff-deleted[^"]*"[^>]*>CI|text-red/);
  });

  it("지난 상태의 카드(같은 PR의 뒤 카드가 있다)에는 고쳐 달라는 버튼이 없다 — 지금의 실패가 아닐 수 있다", () => {
    expect(card({ ci: { kind: "failing", failed: ["e2e"] } }, false)).not.toContain("고쳐 달라고 하기");
  });

  it("읽기만인 Thread(보관된 Work — v1 티켓 38)에는 고쳐 달라는 버튼이 없다 — 말을 채울 입력창이 없다", () => {
    const entry: PrCardEntry = { key: "p1", pr: { ...pr, ci: { kind: "failing", failed: ["e2e"] } }, latest: true, turnsBefore: 1 };
    const markup = renderToStaticMarkup(
      <PrPlace.Provider value={{ showChanges: () => {} }}>
        <PrCard card={entry} now={now} />
      </PrPlace.Provider>,
    );
    expect(text(markup)).toContain("CI 실패 · e2e 검사가 실패했어요.");
    expect(markup).not.toContain("고쳐 달라고 하기");
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

// ChatCards 보드 「PR 카드」(restart 02b-6 · `.ra-prc`) — 열 폭 · 안쪽 14 16 · 칸 사이 10 · 둥근 12 · 0.5 링 + 카드 그림자, 머리 글리프 15. 메타는 조각마다
// 사이 14(줄 사이 6)이고 +N · −N도 한 조각씩이다. 확인 중인 CI는 반짝인다. 실패 칸은 둥근 8 · `fill-soft` · 안쪽 8 8 8 10이고, 단추는 28 알약
// (`.ra-opt`)이다. 대화가 선 뒤에 새로 서면 아래 12에서 올라온다(Motion 「문서 · PR 카드가 선다」).
describe("PR 카드의 모양", () => {
  const classes = (markup: string, pattern: RegExp) => pattern.exec(markup)?.[1].split(" ") ?? [];

  it("카드는 둥근 12 · 링과 카드 그림자 · 안쪽 14 16 · 칸 사이 10이고 머리 글리프는 15다", () => {
    const markup = card();
    expect(classes(markup, /<section[^>]*class="([^"]*)"/)).toEqual(
      expect.arrayContaining(["rounded-xl", "shadow-lifted", "px-4", "py-3.5", "gap-2.5", "bg-surface"]),
    );
    expect(markup).toMatch(/<svg[^>]*data-pr-icon="open"[^>]*class="[^"]*\bsize-3\.75\b|<svg[^>]*class="[^"]*\bsize-3\.75\b[^"]*"[^>]*data-pr-icon="open"/);
  });

  it("메타의 +N · −N은 브랜치 · 파일 수와 같은 사이의 한 조각씩이다", () => {
    const markup = card();
    expect(markup).toMatch(/fix\/refund-api → main<\/span><span class="[^"]*text-diff-added[^"]*">\+48<\/span><span class="[^"]*text-diff-deleted[^"]*">−12<\/span><span[^>]*>파일 3개/);
  });

  it("확인 중인 CI는 반짝이고, 지난 CI 문장은 반짝이지 않는다", () => {
    expect(card()).toMatch(/<span class="[^"]*\bchat-shimmer\b[^"]*">CI 확인 중<\/span>/);
    expect(card({ ci: { kind: "passing" } })).not.toContain("chat-shimmer");
  });

  it("실패 칸은 둥근 8 · 옅은 면이고 단추는 28 알약이다", () => {
    const markup = card({ ci: { kind: "failing", failed: ["e2e"] } });
    expect(classes(markup, /<div class="([^"]*)"><svg[^>]*data-ci="failing"/)).toEqual(
      expect.arrayContaining(["rounded-md", "bg-fill-soft", "py-2", "pr-2", "pl-2.5", "gap-2"]),
    );
    for (const name of ["고쳐 달라고 하기", "변경 사항 보기", "GitHub에서 열기"]) {
      const button = new RegExp(`<button[^>]*class="([^"]*)"[^>]*>${name}`).exec(markup);
      expect(button?.[1].split(" "), name).toEqual(expect.arrayContaining(["h-7", "rounded-full", "px-3", "inset-ring-border-heavy"]));
      expect(button?.[1].split(" "), name).not.toContain("font-medium");
    }
  });

  it("대화가 선 뒤에 새로 선 카드는 아래에서 올라온다", () => {
    expect(card()).not.toContain("card-rise");
    const entry: PrCardEntry = { key: "p1", pr, latest: true, turnsBefore: 1 };
    const arrived = renderToStaticMarkup(
      <Arrival.Provider value={settledPlace()}>
        <PrCard card={entry} now={now} />
      </Arrival.Provider>,
    );
    expect(classes(arrived, /<section[^>]*class="([^"]*)"/)).toContain("card-rise");
  });
});
