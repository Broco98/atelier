// 앱 규격으로 고친 자리: 글자 text-xs→11.5px(툴팁 글자와 같은 값, P5 — 선례가 없는 부품은 글자 크기만 앱 규격이다). 툴팁 안의 바탕·글자색(in-data-[slot=tooltip-content])은 registry 그대로다. 흰 바탕 위의 바탕(bg-muted, 3%)은 판 4(22)가 칠한다.
import { cn } from "cn"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-[11.5px] font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
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
