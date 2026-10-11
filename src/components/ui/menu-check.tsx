import * as React from "react"
import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// **메뉴 줄 끝의 체크 — Select 항목과 드롭다운 체크 · 라디오 항목이 함께 그린다.** 부품 파일들이 같은 값을
// 옮겨 적던 자리다(`select.tsx`의 `SelectItem`, `dropdown-menu.tsx`의 `DropdownMenuCheckboxItem` · `DropdownMenuRadioItem`).
//
// 체크는 **줄 끝의 흐름 안**에 선다 — 켜진 줄에만 서므로(지시자는 안 켜진 줄에서 아무것도 안 그린다)
// 다른 줄에 빈 자리를 잡아 두지 않는다. 크기와 색은 DS의 체크(`.at-mi .chk` — `ic-check s14`)대로 14px · `fg`다.
// 굵기는 앱 기본이다 — DS가 따로 주는 2.4는 12px 이하의 작은 글리프 몫이다(`icon-stroke.ts`, 하위 메뉴 셰브런과 같은 까닭).
// 색은 **그림 자신에 건다** — 줄(`menu-row`)이 `text-` 클래스 없는 글리프에 `fg-secondary`를 바로 걸어, 이 상자에 준 색은
// 그림까지 내려가지 못한다(요소에 바로 걸린 선언이 상속을 이긴다).
// 지금 값은 이 그림이 아니라 줄의 `aria-selected`·`aria-checked`가 말한다.
//
// 부품의 지시자(`ItemIndicator` · `CheckboxItemIndicator` · `RadioItemIndicator`)에 `render`로 준다. 지시자가 이 상자를
// 세우고 거두는 때와 `data-*`·`aria-hidden`을 들고, 여기는 모양만 든다. 지시자가 기본으로 넘기는 글자
// (Select의 ✔️)는 아래 그림이 덮는다.
function MenuCheck({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      {...props}
      className={cn("pointer-events-none flex shrink-0 items-center", className)}
    >
      <CheckIcon className="size-3.5 text-fg" />
    </span>
  )
}

export { MenuCheck }
