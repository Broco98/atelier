import type { CSSProperties, ReactNode } from "react";
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

/** 트리 한 단의 들여쓰기(px). **이 숫자는 여기 한 곳에만 있다.** */
const INDENT_STEP = 18;

/**
 * 트리 한 단. **들여쓰기를 이 상자 하나가 정한다** — 값을 부르는 쪽마다 적으면 트리 깊이를
 * 한 번 조정할 때 한쪽만 남는다(Sidebar.tsx의 GUTTER 주석과 같은 계약).
 *
 * **주는 것은 padding이 아니라 값이다.** 상자가 왼쪽 여백을 직접 물면 그 안의 행들이
 * 배경까지 함께 밀려, 켜진 행·hover가 앞에 빈 자리를 두고 시작한다 — 한 컬럼에서 work 행과
 * 그 아래 행들의 배경 폭이 갈린다. 값으로 내려보내면 **배경은 끝까지 가고 글자만 들어간다**
 * (파일 트리들이 하는 방식이다). 행 쪽에서 `calc(var(--tree-indent) + 자기 여백)`으로 받는다.
 *
 * `depth`는 이 상자가 트리의 **몇 번째 단**인가다. 중첩된 상자가 값을 스스로 더할 수 없어서
 * (CSS 커스텀 속성은 자기 자신을 참조하면 순환이라 무효다) 부르는 쪽이 밝힌다 — 이 앱에서
 * 깊이는 둘뿐이다: nav `Terminal` 아래 셸(한 단), work 아래 `terminal` 아래 셸(두 단).
 */
export function TreeIndent({ depth = 1, children }: { depth?: 1 | 2; children: ReactNode }) {
  return (
    <div
      style={{ "--tree-indent": `${depth * INDENT_STEP}px` } as CSSProperties}
      className="flex flex-col gap-[3px]"
    >
      {children}
    </div>
  );
}

/**
 * 가지가 접혔는지 말하는 화살표.
 *
 * **목록이 접히는 것과 같은 시간·같은 곡선으로 돈다** — 한 동작으로 읽혀야 한다.
 * 트랜지션 목록에 transform이 아니라 rotate를 적는다: Tailwind v4의 rotate-*는 독립
 * rotate 속성을 쓰고, transform만 걸면 화살표만 뚝 끊긴다.
 *
 * 서는 자리가 둘이다 — 가지 머리행 안, 그리고 nav 항목의 곁(그쪽은 항목 자신이 머리행을
 * 겸해 화살표만 형제 버튼으로 선다). 규격을 두 곳에 적으면 한쪽만 남는다.
 */
export function BranchArrow({ open }: { open: boolean }) {
  return (
    <ChevronDown
      className={cn(
        "size-3 shrink-0 text-tertiary transition-[rotate] duration-[180ms] ease-panel",
        !open && "-rotate-90",
      )}
      strokeWidth={2.2}
    />
  );
}

/**
 * 가지에 딸린 것의 개수. **접힘과 무관하게 늘 보인다** — 접힌 가지에서 「몇 개가 도는가」를
 * 말하는 것이 이 숫자의 전부다. 구획 헤더도 같은 규칙이라 규격이 갈리면 그 자리에서 보인다.
 */
export function BranchCount({ count }: { count: number }) {
  return <span className="shrink-0 text-[11.5px] tabular-nums text-tertiary">{count}</span>;
}

/**
 * 가지의 머리행 — `▾ terminal  2`. 누르면 접힌다.
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
      //
      // **값을 싣는다**(`data-leaf`와 같은 규칙). 한 화면에 가지가 여럿 서므로 — work 블럭 ·
      // 그 안의 `terminal` · nav `Terminal` — 빈 값이면 검사가 어느 것을 집었는지 모른다.
      data-branch={label}
      onClick={onToggle}
      aria-expanded={open}
      className="flex h-7 w-full shrink-0 items-center gap-1 rounded-[9px] pl-[calc(var(--tree-indent,0px)+9px)] pr-[9px] text-left text-[13px] text-muted-foreground transition-colors hover:bg-state-1"
    >
      <BranchArrow open={open} />
      {/* `flex-1`이라 개수가 오른쪽 끝으로 밀린다 — `ml-auto`를 개수 쪽에 얹지 않는 것은
          그 조각이 nav 곁에도 그대로 서기 때문이다(BranchCount). */}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <BranchCount count={count} />
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
  onPointerDown,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  /**
   * 이 잎을 본문 위로 끌 수 있다면(결정 86·90). **`onClick`을 대신하지 않는다** —
   * 5px 안쪽의 움직임은 그냥 클릭이고, 그 판정은 받는 쪽이 한다.
   */
  onPointerDown?: (event: { clientX: number; clientY: number }) => void;
}) {
  return (
    <button
      type="button"
      // 위 `data-branch`와 같은 이유의 표식이다.
      data-leaf={label}
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-current={active || undefined}
      className={cn(
        "flex h-7 w-full shrink-0 items-center gap-[7px] rounded-[9px] pl-[calc(var(--tree-indent,0px)+9px)] pr-[9px] text-left text-[13px] transition-colors",
        active ? "selected-row font-medium" : "text-muted-foreground hover:bg-state-1",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.8} />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
