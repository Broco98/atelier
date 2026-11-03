import { createContext, useContext } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleAlert, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import { cn } from "@/lib/utils";
import { useArrival } from "./arrival";
import type { PrCardEntry } from "./fold";
import { OptionButton } from "./OptionButton";
import { ciText, failNote, mergedWhen, reviewText, type PrLine } from "./pr";

// **PR 카드**(v1 티켓 36 · 구현 스펙 §12 S24 · 스토리 77 · 124 · 125 · 126 · ChatCards 보드 「PR 카드」 `.ra-prc` · restart 02b-6) — 엔진이 그 Work의
// PR이 처음 보였을 때와 상태가 바뀔 때 남긴 `pr` 줄 하나다. 턴의 일이 아니라 Work의 일이라 턴 사이 — 앞 턴의 상자 끝, 답 아래 16에 선다(MainCards).
// 카드는 **그때의 상태**다 — 상태가 바뀌면 새 카드가 아래에 선다. 대화가 선 뒤에 새로 서면 아래 12에서 올라온다(Motion 「문서 · PR 카드가 선다」 —
// `card-rise`).
//
//   열 폭 · 안쪽 14 16 · 칸 사이 10 · 둥근 12 · 0.5 링 + 카드 그림자(`shadow-lifted`) · 14 / 20
//   머리(PR 글리프 15 · 제목 600 · #번호 · 오른쪽 끝 상태 알약 22 — 열림은 옅은 파랑, 병합됨 · 닫힘은 옅은 회색)
//   메타(12/18 옅은 글자 — 브랜치 → base(고정폭) · +N · −N · 파일 N개 · 리뷰 · CI 문장, 조각 사이 14 · 줄 사이 6. 확인 중인 CI는 반짝인다)
//   CI 실패 칸(둥근 8 · `fill-soft` · 안쪽 8 8 8 10 · 13 / 18 `fg-secondary` — 진한 ⓘ 14 · **CI 실패** · 「watcher-retry 검사가 실패했어요.」(`failNote` —
//   요약 카드 PR 줄의 실패 문장과 같다), 오른쪽 끝 「고쳐 달라고 하기」)
//   동작(「변경 사항 보기」 · 「GitHub에서 열기 ↗」 — 28 알약 `OptionButton`, 사이 6)
//
// - **CI는 색 없이 문장이다**(스토리 125) — 실패의 글리프도 빨강이 아니라 진한 글자색이다(빨강은 사이드바 목록의 「실패」만 — v1 티켓 41).
// - 「고쳐 달라고 하기」는 **지금의 카드**(같은 PR의 마지막 카드)에만 선다 — 지난 카드의 실패는 이미 고쳐졌을 수 있다. 누르면 이
//   Thread의 입력창에 맡기는 말을 채운다(보내는 것은 사람이다). 읽기만인 Thread(v1 티켓 38)에는 서지 않는다.
// - 「변경 사항 보기」는 요약 카드의 변경으로 간다 — 넓힌 카드(v1 티켓 35)가 그 자리다. 병합된 PR은 동작 없이 브랜치와 병합한 때만 남는다
//   (보드 「합쳐짐」). 닫힌 PR은 「GitHub에서 열기」만.
// - 동작은 그리는 자리(Thread 화면)가 `PrPlace`로 준다(정적 마크업으로 잰다, `PrCard.test.tsx`).

/** 카드의 동작 — Thread 화면이 준다. */
export interface PrActions {
  /** 「변경 사항 보기」 — 요약 카드의 변경으로 간다. */
  showChanges: (pr: PrLine) => void;
  /** 「고쳐 달라고 하기」 — 이 Thread의 입력창에 맡기는 말을 채운다. 없으면(읽기만인 Thread — v1 티켓 38) 버튼이 서지 않는다. */
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
      className={cn("flex w-full flex-col gap-2.5 rounded-xl bg-surface px-4 py-3.5 text-sm shadow-lifted", useArrival("card-rise", card.key))}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon data-pr-icon={pr.state} className="size-3.75 shrink-0" aria-hidden />
        <b className="min-w-0 truncate font-semibold">{pr.title}</b>
        <span className="shrink-0 text-fg-tertiary">#{pr.number}</span>
        <span
          className={cn(
            "ml-auto inline-flex h-5.5 shrink-0 items-center rounded-full px-2 text-xs font-medium tracking-normal",
            pr.state === "open" ? "bg-accent-soft text-link" : "bg-fill-soft text-fg-secondary",
          )}
        >
          {STATE[pr.state]}
        </span>
      </div>
      <PrMeta pr={pr} now={now} />
      {failing && (
        <div className="flex items-center gap-2 rounded-md bg-fill-soft py-2 pr-2 pl-2.5 text-chat-meta text-fg-secondary">
          <CircleAlert data-ci="failing" className="size-3.5 shrink-0 text-fg" aria-hidden />
          <span className="min-w-0 flex-1 wrap-anywhere">
            <b className="font-medium text-fg">CI 실패</b>
            {` · ${failNote(failing)}`}
          </span>
          {card.latest && actions.askFix && <OptionButton onClick={() => actions.askFix?.(pr)}>고쳐 달라고 하기</OptionButton>}
        </div>
      )}
      {pr.state !== "merged" && (
        <div className="flex flex-wrap gap-1.5">
          {pr.state === "open" && <OptionButton onClick={() => actions.showChanges(pr)}>변경 사항 보기</OptionButton>}
          <OptionButton onClick={() => void openUrl(pr.url)}>
            GitHub에서 열기
            <ExternalLink data-icon="inline-end" className="size-3 text-fg-tertiary" aria-hidden />
          </OptionButton>
        </div>
      )}
    </section>
  );
}

/** 메타 줄 — 브랜치 → base와, 병합됐으면 그 때, 아니면 +N · −N · 파일 수(열린 PR은 리뷰 · CI 문장까지). 조각마다 사이 14다. */
function PrMeta({ pr, now }: { pr: PrLine; now: number }) {
  const ci = pr.state === "open" && pr.ci.kind !== "failing" ? ciText(pr.ci) : null;
  const merged = pr.state === "merged" && pr.mergedAt ? mergedWhen(pr.mergedAt, now) : "";
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs tracking-normal text-fg-tertiary">
      <span className="font-mono">
        {pr.headBranch} → {pr.baseBranch}
      </span>
      {pr.state === "merged" ? (
        merged && <span>{merged}</span>
      ) : (
        <>
          {pr.additions > 0 && <span className="text-diff-added tabular-nums">+{pr.additions}</span>}
          {pr.deletions > 0 && <span className="text-diff-deleted tabular-nums">−{pr.deletions}</span>}
          <span>파일 {pr.changedFiles}개</span>
          {pr.state === "open" && reviewText(pr).map((said) => <span key={said}>{said}</span>)}
          {/* 확인 중인 CI는 그 글이 반짝인다(ChatCards 「열림 · 확인 중」 `.ra-shimmer`) — 끝난 CI 문장은 그대로다. */}
          {ci && <span className={cn(pr.state === "open" && pr.ci.kind === "pending" && "chat-shimmer")}>{ci}</span>}
        </>
      )}
    </div>
  );
}
