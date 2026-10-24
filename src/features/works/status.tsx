import { STATUS_ICON_STROKE } from "@/components/ui/icon-stroke";
import { cn } from "@/lib/utils";
import type { WorkStatus } from "./types";

/**
 * **상태 배지의 모양 한 벌** — DS `StatusBadge`(`.at-badge`)다. 24 높이 · `radius-sm` · 좌우 8 · 사이 6, 면은 회색 `fill-soft`,
 * 글자는 12/500 `fg-secondary`이고, 앞에 6px 점이 그 상태의 색(`st-*`)으로 선다 — **색은 점 하나에만 쓴다**(DS 「회색 면 + 색 점
 * 하나 — 색은 상태에만」). 알약이 아니다: `radius-full`은 경로 줄 · 칩 · 36 버튼 · 컴포저 컨트롤에만 쓰고(codex-ds 스펙 §2) 머리
 * 컨트롤은 각지다(codex-ds 결정 3). 상단의 상태 메뉴 트리거(`WorksPage`의 `StatusMenu`) · 아카이브 상세 머리 · 사이드바 호버
 * 카드(`WorkPeek`)가 이것을 부르고, 점의 색은 상태마다 `badgeClass`가 든다. 점은 배지의 `::before`라 부르는 자리가 마크업을
 * 더하지 않는다. 꺾쇠(▾)를 품은 배지(상태 메뉴 트리거)도 안쪽은 같은 8이다 — 꺾쇠는 12 `fg-tertiary`다(DS `.at-badge .ic` ·
 * `HeadCard` 미리보기의 `s12`).
 */
export const STATUS_BADGE =
  "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm bg-fill-soft px-2 text-xs font-medium whitespace-nowrap text-fg-secondary before:size-1.5 before:shrink-0 before:rounded-full";

/**
 * **상태 표** — 이름 · 설명과 색. 색은 Atelier 낱말의 상태 넷이다(`st-draft` · `st-active` · `st-review` · `st-done`, codex-ds 스펙
 * 2절 — `fg-tertiary` · `accent-solid` · `warning` · `success`의 별칭). 상태 메뉴의 점(`dotClass`), 배지 앞의 점(`badgeClass` —
 * 배지의 `::before`), 아래 `StatusIcon`이 모두 그 토큰을 읽는다. 배지의 글자와 면은 상태와 상관없이 `fg-secondary` · `fill-soft`다
 * (위 `STATUS_BADGE`) — 상태색이 글자가 되면 `draft` · `active` · `review`의 배지 글자가 흰 면 위 3.3 · 3.6 · 3.8:1로 글자 바닥(4.5)
 * 아래이고, draft 글자가 `fg-tertiary`라 codex-ds 스펙 S17(읽는 글은 `fg-secondary`)과도 어긋났다.
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
    badgeClass: "before:bg-st-draft",
  },
  active: {
    label: "active",
    desc: "진행 중",
    dotClass: "bg-st-active",
    badgeClass: "before:bg-st-active",
  },
  review: {
    label: "review",
    desc: "리뷰 대기",
    dotClass: "bg-st-review",
    badgeClass: "before:bg-st-review",
  },
  done: {
    label: "done",
    desc: "완료",
    dotClass: "bg-st-done",
    badgeClass: "before:bg-st-done",
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
