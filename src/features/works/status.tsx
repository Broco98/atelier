import { STATUS_ICON_STROKE } from "@/components/ui/icon-stroke";
import { cn } from "@/lib/utils";
import type { WorkStatus } from "./types";

/**
 * **상태 배지의 모양 한 벌**(디자인 시스템의 `.at-badge`, ui-refresh 결정 6 — 머리 컨트롤이라 알약이다). 상단의 상태 메뉴
 * 트리거(`WorksPage`의 `StatusMenu`) · 아카이브 상세 머리 · 사이드바 호버 카드(`WorkCard`)가 이것을 부르고, 색은 상태마다
 * `badgeClass`가 든다. 꺾쇠(▾)를 품은 배지는 오른쪽 안쪽이 한 단 좁다(DS `.at-badge` 10 / 8 — 꺾쇠가 없으면 `.plain` 10 / 10).
 */
export const STATUS_BADGE =
  "inline-flex h-6 shrink-0 items-center gap-[3px] rounded-full px-2.5 text-xs font-medium whitespace-nowrap has-[>svg]:pr-2";

/**
 * **상태 표** — 이름 · 설명과 색. 색은 Atelier 낱말의 상태 넷이다(`st-draft` · `st-active` · `st-review` · `st-done`, codex-ds 스펙
 * 2절 — `fg-tertiary` · `accent-solid` · `warning` · `success`의 별칭). 상태 메뉴의 점(`dotClass`), 배지의 글자와 면(`badgeClass`),
 * 아래 `StatusIcon`이 모두 그 토큰을 읽는다. 배지 면은 그 색의 10% 무리다 — 넷이 한 규칙이라 draft의 면은 Codex `fill-soft`(전경
 * 5%)와 같은 값이 된다.
 *
 * DS `StatusBadge`(회색 `fill-soft` 면 + 6px 색 점 + `fg-secondary` 글자)와는 셋이 다르다 — 글자, 면, 그리고 배지 안의 점이
 * 없다. 티켓 06이 배지의 글자를 그 상태의 색으로, 면을 그 색의 옅은 무리로 정했다(L3 `frame.spec.ts`가 상태마다 잰다).
 *   - 그래서 `draft` · `active` · `review`의 배지 글자는 글자 바닥(4.5) 아래다 — 그 색들은 흰 면 위에서도 3.3 · 3.6 · 3.8:1이다
 *     (DS README 「대비」). draft 글자가 `fg-tertiary`인 것은 codex-ds 스펙 S17(읽는 글은 `fg-secondary`)과도 어긋난다.
 *   - 상태의 점은 배지 안이 아니라 배지가 여는 상태 메뉴의 줄 앞(`dotClass`)에 서고, 사이드바 행 레인에는 `StatusIcon`이 선다.
 */
export const STATUS_META: Record<
  WorkStatus,
  { label: string; desc: string; dotClass: string; badgeClass: string }
> = {
  // 키 순서가 상태 드롭다운 순서다 — 진행 순서대로 둔다
  draft: {
    label: "draft",
    desc: "아직 시작 전",
    dotClass: "bg-st-draft",
    badgeClass: "text-st-draft bg-st-draft/10",
  },
  active: {
    label: "active",
    desc: "진행 중",
    dotClass: "bg-st-active",
    badgeClass: "text-st-active bg-st-active/10",
  },
  review: {
    label: "review",
    desc: "리뷰 대기",
    dotClass: "bg-st-review",
    badgeClass: "text-st-review bg-st-review/10",
  },
  done: {
    label: "done",
    desc: "완료",
    dotClass: "bg-st-done",
    badgeClass: "text-st-done bg-st-done/10",
  },
};

// 상태 아이콘 4종 — draft 점선 원 / active 진행 아크 / review 시계 / done 체크. 색은 상태 표와 같은 `st-*`다(DS `.ic-st-*`).
export function StatusIcon({ status, className }: { status: WorkStatus; className?: string }) {
  if (status === "draft") {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-st-draft", className)}>
        <circle
          cx="7"
          cy="7"
          r="5.5"
          stroke="currentColor"
          strokeWidth={STATUS_ICON_STROKE}
          strokeDasharray="2.4 2.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (status === "active") {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-st-active", className)}>
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth={STATUS_ICON_STROKE} opacity=".35" />
        <path d="M7 1.5a5.5 5.5 0 0 1 5.5 5.5" stroke="currentColor" strokeWidth={STATUS_ICON_STROKE} strokeLinecap="round" />
        <circle cx="7" cy="7" r="2.2" fill="currentColor" />
      </svg>
    );
  }
  if (status === "review") {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-st-review", className)}>
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth={STATUS_ICON_STROKE} />
        <path d="M7 4.3V7l1.9 1.3" stroke="currentColor" strokeWidth={STATUS_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-st-done", className)}>
      <circle cx="7" cy="7" r="6" fill="currentColor" />
      <path d="m4.4 7.2 1.8 1.8 3.4-3.9" stroke="var(--surface)" strokeWidth={STATUS_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// "2026-07-19" → "7월 19일"
export function formatCreated(createdAt: string): string {
  const [, m, d] = createdAt.split("-").map(Number);
  if (!m || !d) return createdAt;
  return `${m}월 ${d}일`;
}
