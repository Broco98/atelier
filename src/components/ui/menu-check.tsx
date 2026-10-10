import * as React from "react"
import { CheckIcon } from "lucide-react"
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke"
import { cn } from "@/lib/utils"

// **메뉴 줄 끝의 체크 — Select 항목과 드롭다운 라디오 항목이 함께 그린다.** 두 부품 파일이 같은 값을
// 옮겨 적던 자리다(`select.tsx`의 `SelectItem`, `dropdown-menu.tsx`의 `DropdownMenuRadioItem`).
//
// 체크는 **줄 끝의 흐름 안**에 선다 — 켜진 줄에만 서므로(지시자는 안 켜진 줄에서 아무것도 안 그린다)
// 다른 줄에 빈 자리를 잡아 두지 않는다. 12px · primary이고, 굵기는 DS가 12px 글리프에 따로 주는 2.4다
// (`icon-stroke.ts`의 `SMALL_GLYPH_STROKE`). 지금 값은 이 그림이 아니라
// 줄의 `aria-selected`·`aria-checked`가 말한다.
//
// 부품의 지시자(`ItemIndicator` · `RadioItemIndicator`)에 `render`로 준다. 지시자가 이 상자를 세우고
// 거두는 때와 `data-*`·`aria-hidden`을 들고, 여기는 모양만 든다. 지시자가 기본으로 넘기는 글자
// (Select의 ✔️)는 아래 그림이 덮는다.
function MenuCheck({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      {...props}
      className={cn("pointer-events-none flex shrink-0 items-center text-primary", className)}
    >
      <CheckIcon className="size-3" strokeWidth={SMALL_GLYPH_STROKE} />
    </span>
  )
}

export { MenuCheck }
