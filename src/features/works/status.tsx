import { cn } from "@/lib/utils";
import type { WorkStatus } from "./types";

export const STATUS_META: Record<
  WorkStatus,
  { label: string; desc: string; dotClass: string; badgeClass: string }
> = {
  // 키 순서가 상태 드롭다운 순서다 — 진행 순서대로 둔다
  draft: {
    label: "draft",
    desc: "아직 시작 전",
    dotClass: "bg-tertiary",
    badgeClass: "text-muted-foreground bg-accent",
  },
  active: {
    label: "active",
    desc: "진행 중",
    dotClass: "bg-primary",
    badgeClass: "text-primary bg-primary/10",
  },
  review: {
    label: "review",
    desc: "리뷰 대기",
    dotClass: "bg-amber-600",
    badgeClass: "text-amber-700 bg-amber-600/10",
  },
  done: {
    label: "done",
    desc: "완료",
    dotClass: "bg-green-700",
    badgeClass: "text-green-700 bg-green-700/10",
  },
};

// 상태 아이콘 4종 — draft 점선 원 / active 진행 아크 / review 시계 / done 체크
export function StatusIcon({ status, className }: { status: WorkStatus; className?: string }) {
  if (status === "draft") {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-tertiary", className)}>
        <circle
          cx="7"
          cy="7"
          r="5.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeDasharray="2.4 2.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (status === "active") {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-primary", className)}>
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.6" opacity=".35" />
        <path d="M7 1.5a5.5 5.5 0 0 1 5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="7" cy="7" r="2.2" fill="currentColor" />
      </svg>
    );
  }
  if (status === "review") {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-amber-600", className)}>
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7 4.3V7l1.9 1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" fill="none" className={cn("size-3.5 shrink-0 text-green-700", className)}>
      <circle cx="7" cy="7" r="6" fill="currentColor" />
      <path d="m4.4 7.2 1.8 1.8 3.4-3.9" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// "2026-07-19" → "7월 19일"
export function formatCreated(createdAt: string): string {
  const [, m, d] = createdAt.split("-").map(Number);
  if (!m || !d) return createdAt;
  return `${m}월 ${d}일`;
}
