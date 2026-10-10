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

export const STATUS_META: Record<
  WorkStatus,
  { label: string; desc: string; dotClass: string; badgeClass: string }
> = {
  // 키 순서가 상태 드롭다운 순서다 — 진행 순서대로 둔다
  draft: {
    label: "draft",
    desc: "아직 시작 전",
    dotClass: "bg-fg-tertiary",
    badgeClass: "text-fg-secondary bg-fill-hover",
  },
  active: {
    label: "active",
    desc: "진행 중",
    dotClass: "bg-(--accent)",
    badgeClass: "text-link bg-accent-soft",
  },
  review: {
    label: "review",
    desc: "리뷰 대기",
    dotClass: "bg-warning",
    badgeClass: "text-warning bg-warning/10",
  },
  done: {
    label: "done",
    desc: "완료",
    dotClass: "bg-success",
    badgeClass: "text-success bg-success/8",
  },
};

// 상태 아이콘 4종 — draft 점선 원 / active 진행 아크 / review 시계 / done 체크
export function StatusIcon({ status, className }: { status: WorkStatus; className?: string }) {
  if (status === "draft") {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-fg-tertiary", className)}>
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
      <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-(--accent)", className)}>
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth={STATUS_ICON_STROKE} opacity=".35" />
        <path d="M7 1.5a5.5 5.5 0 0 1 5.5 5.5" stroke="currentColor" strokeWidth={STATUS_ICON_STROKE} strokeLinecap="round" />
        <circle cx="7" cy="7" r="2.2" fill="currentColor" />
      </svg>
    );
  }
  if (status === "review") {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-warning", className)}>
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth={STATUS_ICON_STROKE} />
        <path d="M7 4.3V7l1.9 1.3" stroke="currentColor" strokeWidth={STATUS_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-success", className)}>
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
