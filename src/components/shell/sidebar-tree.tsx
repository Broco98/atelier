import type { ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// 사이드바 트리의 공용 조각 셋. **구획 헤더와 가지가 같은 것을 쓴다** — 둘은 한 컬럼에
// 세로로 붙어 서므로 접히는 곡선이나 여백이 갈리면 그 자리에서 보인다(Sidebar.tsx의
// GUTTER 주석과 같은 계약). 판 04가 작업 목록과 nav 항목 **양쪽**에 가지를 붙이면서
// 이 셋을 쓰는 자리가 셋이 됐고, 그때 한 벌로 묶었다.
//
// **여기에 상태는 없다.** 전부 받은 것만 그린다 — 그래야 정적 마크업 검사가 닿는다.

// 접기 애니메이션 — grid-template-rows를 0fr↔1fr로 보간한다. height:auto는 트랜지션되지 않고,
// max-height는 목록 길이를 추정해야 해서 항목이 많을수록 타이밍이 어긋난다.
//
// 접힌 동안에도 항목은 DOM에 남는다 — 그래야 펼치는 쪽도 애니메이션된다. 그래서 inert로
// 포커스와 포인터를 막는다: 높이 0에 가려 보이지 않는 버튼에 탭이 들어가면 안 된다.
export function SectionBody({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      inert={!open}
      className={cn(
        "grid shrink-0 transition-[grid-template-rows] duration-[180ms] ease-panel",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div className="overflow-hidden">
        <div className="flex flex-col gap-[3px] pt-[3px]">{children}</div>
      </div>
    </div>
  );
}

/**
 * 가지의 머리행 — `▾ terminal  2`. 누르면 접힌다.
 *
 * **개수는 접힘과 무관하게 늘 보인다.** 구획 헤더가 이미 그 규칙이고(SidebarWorkList의
 * SectionHeader), 둘이 한 컬럼에 서므로 한쪽만 숨기면 같은 모양이 다른 규칙을 갖는다.
 *
 * 화살표는 **늘 보인다** — 구획 헤더는 hover에만 띄우지만 그쪽은 「구획이 접힌다」가
 * 이미 알려진 관용구이고, 가지는 그 자체가 새로 생긴 것이라 접힌다는 사실이 보여야 한다.
 */
export function BranchHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      // 표식은 검사가 이 버튼을 **정체성으로** 집기 위한 것이다 — 구획 헤더도 `aria-expanded`를
      // 가진 버튼이라, 모양(클래스 문자열)으로 가르면 규격을 손보는 날 검사가 조용히 샌다
      // (TerminalPane의 `data-shell-host`와 같은 이유).
      data-branch=""
      onClick={onToggle}
      aria-expanded={open}
      className="flex h-7 w-full shrink-0 items-center gap-1 rounded-[9px] px-[9px] text-left text-[13px] text-muted-foreground transition-colors hover:bg-state-1"
    >
      {/* 목록이 접히는 것과 **같은 시간·같은 곡선**으로 돈다 — 한 동작으로 읽혀야 한다.
          트랜지션 목록에 transform이 아니라 rotate를 적는다: Tailwind v4의 rotate-*는
          독립 rotate 속성을 쓰고, transform만 걸면 화살표만 뚝 끊긴다. */}
      <ChevronDown
        className={cn(
          "size-3 shrink-0 text-tertiary transition-[rotate] duration-[180ms] ease-panel",
          !open && "-rotate-90",
        )}
        strokeWidth={2.2}
      />
      <span className="min-w-0 truncate">{label}</span>
      <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-tertiary">{count}</span>
    </button>
  );
}

/**
 * 가지가 아닌 잎 하나 — 지금은 `spec` 행이다. 눌러서 본문을 옮기는 것이 전부라 접히지 않는다.
 *
 * 켜짐은 목록 행과 **같은 표시**(`selected-row`)다. 이 트리 안에서만 다른 어휘를 쓰면
 * 같은 컬럼에서 두 종류의 「선택됨」이 생긴다.
 */
export function TreeLeaf({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // 위 `data-branch`와 같은 이유의 표식이다.
      data-leaf={label}
      onClick={onClick}
      aria-current={active || undefined}
      className={cn(
        "flex h-7 w-full shrink-0 items-center gap-[7px] rounded-[9px] px-[9px] text-left text-[13px] transition-colors",
        active ? "selected-row font-medium" : "text-muted-foreground hover:bg-state-1",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
