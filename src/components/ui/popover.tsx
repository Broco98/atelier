// 앱 규격으로 고친 자리: 카드 rounded-lg·ring-1 ring-foreground/10·shadow-md·bg-popover→13px·border-strong·shadow-lg·bg-background(옛 PopoverPortal 카드, 넘친 hover 바탕이 모서리 밖으로 안 나가게 overflow-hidden도 그대로), 안쪽 p-2.5·gap-2.5→p-1.5·gap-0.5(ⓘ 메타의 지금 값 — 복사 행이 촘촘히 붙는다), 글자 text-sm→13.5px, 카드에 data-popover 표식. 폭 w-72(288px)는 ⓘ의 지금 값과 같아 registry 그대로다. 열림 애니메이션 클래스는 registry 그대로다. Header·Title·Description은 registry 그대로다(쓰는 자리가 없다).
import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

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
            "z-50 flex w-72 origin-(--transform-origin) flex-col gap-0.5 overflow-hidden rounded-[13px] border border-border-strong bg-background p-1.5 text-[13.5px] text-popover-foreground shadow-lg outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
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
      className={cn("flex flex-col gap-0.5 text-sm", className)}
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
      className={cn("text-muted-foreground", className)}
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
