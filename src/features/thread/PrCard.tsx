import { createContext, useContext } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleAlert, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PrCardEntry } from "./fold";
import { ciText, failedChecks, mergedWhen, reviewText, type PrLine } from "./pr";

// **PR 카드**(v1 티켓 36 · 구현 스펙 §12 S24 · 스토리 124 · 125 · 126 · 캔버스 Cards 보드 「PR」 · Screen-Review) — 엔진이 그 Work의 PR이
// 처음 보였을 때와 상태가 바뀔 때 남긴 `pr` 줄 하나다. 시스템 줄처럼 턴 사이에 선다. 카드는 **그때의 상태**다 — 상태가 바뀌면 새 카드가
// 아래에 선다.
//
//   머리(PR 글리프 · 제목 14/600 · #번호 · 오른쪽 끝 상태 알약 — 열림은 옅은 파랑, 병합됨 · 닫힘은 옅은 회색)
//   메타(12/18 옅은 글자 — 브랜치 → base(고정폭) · +/− · 파일 N개 · 리뷰 · CI 문장)
//   CI 실패 칸(옅은 바탕 — 진한 ⓘ · **CI 실패** · 실패한 검사, 오른쪽 끝 「Host에게 고쳐 달라고 하기」)
//   동작(「변경 사항 보기」 · 「GitHub에서 열기 ↗」)
//
// - **CI는 색 없이 문장이다**(스토리 125) — 실패의 글리프도 빨강이 아니라 진한 글자색이다(빨강은 사이드바 목록의 「실패」만 — v1 티켓 41).
// - 「Host에게 고쳐 달라고 하기」는 **지금의 카드**(같은 PR의 마지막 카드)에만 선다 — 지난 카드의 실패는 이미 고쳐졌을 수 있다. 누르면 이
//   Thread의 입력창에 맡기는 말을 채운다(보내는 것은 사람이다 — Work 카드의 더하기와 같은 길). 읽기만인 Thread(v1 티켓 38)에는 서지 않는다.
// - 「변경 사항 보기」는 Work 카드의 변경으로 간다 — 넓힌 카드(v1 티켓 35)가 그 자리다. 병합된 PR은 동작 없이 브랜치와 병합한 때만 남는다
//   (보드 「합쳐짐」). 닫힌 PR은 「GitHub에서 열기」만.
// - 동작은 그리는 자리(Thread 화면)가 `PrPlace`로 준다 — 카드는 훅 없이 그린다(정적 마크업으로 잰다, `PrCard.test.tsx`).

/** 카드의 동작 — Thread 화면이 준다. */
export interface PrActions {
  /** 「변경 사항 보기」 — Work 카드의 변경으로 간다. */
  showChanges: (pr: PrLine) => void;
  /** 「Host에게 고쳐 달라고 하기」 — 이 Thread의 입력창에 맡기는 말을 채운다. 없으면(읽기만인 Thread — v1 티켓 38) 버튼이 서지 않는다. */
  askFix?: (pr: PrLine) => void;
}

const none = () => {};
export const PrPlace = createContext<PrActions>({ showChanges: none, askFix: none });

const STATE = { open: "열림", merged: "병합됨", closed: "닫힘" } as const;
const ICONS = { open: GitPullRequest, merged: GitMerge, closed: GitPullRequestClosed } as const;

export function PrCard({ card, now }: { card: PrCardEntry; now: number }) {
  const actions = useContext(PrPlace);
  const { pr } = card;
  const Icon = ICONS[pr.state];
  const failing = pr.state === "open" && pr.ci.kind === "failing" ? pr.ci.failed : null;
  return (
    <section
      aria-label={`PR #${pr.number} ${pr.title}`}
      data-pr={pr.number}
      data-pr-state={pr.state}
      className="flex w-full flex-col gap-2.5 rounded-2xl bg-surface px-4 py-3.5 shadow-card"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Icon data-pr-icon={pr.state} className="size-4 shrink-0" aria-hidden />
        <b className="min-w-0 truncate font-semibold">{pr.title}</b>
        <span className="shrink-0 text-fg-tertiary">#{pr.number}</span>
        <span
          className={cn(
            "ml-auto inline-flex h-5.5 shrink-0 items-center rounded-full px-2 text-xs font-medium",
            pr.state === "open" ? "bg-accent-soft text-link" : "bg-fill-soft text-fg-secondary",
          )}
        >
          {STATE[pr.state]}
        </span>
      </div>
      <PrMeta pr={pr} now={now} />
      {failing && (
        <div className="flex items-center gap-2 rounded-xl bg-surface-under px-2.5 py-2 text-chat-meta">
          <CircleAlert data-ci="failing" className="size-3.5 shrink-0 text-fg" aria-hidden />
          <span className="min-w-0 flex-1 wrap-anywhere text-fg-secondary">
            <b className="font-medium text-fg">CI 실패</b>
            {failing.length > 0 && ` · ${failedChecks(failing)}`}
          </span>
          {card.latest && actions.askFix && (
            <Button variant="outline" size="xs" onClick={() => actions.askFix?.(pr)}>
              Host에게 고쳐 달라고 하기
            </Button>
          )}
        </div>
      )}
      {pr.state !== "merged" && (
        <div className="flex flex-wrap gap-1.5">
          {pr.state === "open" && (
            <Button variant="outline" onClick={() => actions.showChanges(pr)}>
              변경 사항 보기
            </Button>
          )}
          <Button variant="outline" onClick={() => void openUrl(pr.url)}>
            GitHub에서 열기
            <ExternalLink data-icon="inline-end" aria-hidden />
          </Button>
        </div>
      )}
    </section>
  );
}

/** 메타 줄 — 브랜치 → base와, 병합됐으면 그 때, 아니면 +/− · 파일 수(열린 PR은 리뷰 · CI 문장까지). */
function PrMeta({ pr, now }: { pr: PrLine; now: number }) {
  const ci = pr.state === "open" && pr.ci.kind !== "failing" ? ciText(pr.ci) : null;
  const merged = pr.state === "merged" && pr.mergedAt ? mergedWhen(pr.mergedAt, now) : "";
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-fg-tertiary">
      <span className="font-mono">
        {pr.headBranch} → {pr.baseBranch}
      </span>
      {pr.state === "merged" ? (
        merged && <span>{merged}</span>
      ) : (
        <>
          {(pr.additions > 0 || pr.deletions > 0) && (
            <span className="flex gap-1">
              {pr.additions > 0 && <span className="text-diff-added">+{pr.additions}</span>}
              {pr.deletions > 0 && <span className="text-diff-deleted">−{pr.deletions}</span>}
            </span>
          )}
          <span>파일 {pr.changedFiles}개</span>
          {pr.state === "open" && reviewText(pr).map((said) => <span key={said}>{said}</span>)}
          {ci && <span>{ci}</span>}
        </>
      )}
    </div>
  );
}
