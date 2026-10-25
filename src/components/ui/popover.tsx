// 앱 규격으로 고친 자리: 카드 rounded-lg·ring-1 ring-foreground/10·shadow-md·bg-popover→floating-card(index.css 한 곳 — 16px·테두리 없이 shadow-prominent·bg-surface-elevated, DS `.at-float`, 넘친 hover 바탕이 모서리 밖으로 안 나가게 overflow-hidden도 그대로), 안쪽 p-2.5·gap-2.5→p-1.5·gap-0.5(옛 작업 ⓘ 메타의 값 — 행이 촘촘히 붙는다), 글자 text-sm→chat-meta(13/18), 카드에 data-popover 표식. 폭 w-72(288px)는 registry 그대로다(옛 작업 ⓘ 메타의 폭과 같았다). 열림 · 닫힘 애니메이션(duration-100 · animate-in · fade-in-0 · zoom-in-95 · slide-in-from-* · 그 닫힘 짝)을 걷었다 — Codex 팝오버는 한 프레임에 서고 곧바로 걷힌다(02 티켓 12). Header·Title·Description은 registry 그대로이고 글자색만 Codex 이름이다(본문 fg · 설명 fg-secondary — 쓰는 자리가 없다).
import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "@/lib/utils"

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          // 떠 있는 **카드**의 표식이다 — 검사가 이것으로 카드를 하나로 센다(툴팁에는 안 단다).
          data-popover=""
          className={cn(
            "z-50 flex w-72 origin-(--transform-origin) flex-col gap-0.5 overflow-hidden floating-card p-1.5 text-chat-meta text-fg outline-hidden",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-chat-meta", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-fg-secondary", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
