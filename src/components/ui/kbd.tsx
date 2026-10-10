// 앱 규격으로 고친 자리: 글자 text-xs→11.5px(툴팁 글자와 같은 값, P5 — 선례가 없는 부품은 글자 크기만 앱 규격이다). 툴팁 안에서는 칩이 아니라 흰 글자 60%다(바탕·높이·좌우 안쪽·최소 폭 없이 — 디자인 시스템의 `.at-tooltip kbd`, ui-refresh 결정 18). 흰 바탕 위의 바탕 bg-muted(--muted = state-1, 5%)→bg-accent(유틸리티 accent = state-2와 같은 `fill-hover` 8% — 칩 바탕의 자리다. CSS 변수 `--accent`(파랑)가 아니다).
import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-inner bg-accent px-1 font-sans text-caption font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:h-auto in-data-[slot=tooltip-content]:min-w-0 in-data-[slot=tooltip-content]:bg-transparent in-data-[slot=tooltip-content]:px-0 in-data-[slot=tooltip-content]:text-background/60 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
