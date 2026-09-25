// 앱 규격으로 고친 자리: 트리거 테두리 있는 입력칸(border-input·h-8/h-7·rounded-lg·text-sm·size 변형)→조용한 칩 하나(26px·9px 모서리·좌우 7px·12.5px·muted 글자·quiet-hover, 옛 기준 브랜치 버튼), 트리거 화살표 size-4→size-2.5·굵기 2.2, 카드 rounded-lg·ring-1 ring-foreground/10·shadow-md·bg-popover→13px·border-strong·shadow-lg·bg-background(옛 PopoverPortal 카드), 폭 w-(--anchor-width)·min-w-36→248px(기준 브랜치의 지금 값), overflow-y-auto에 scroll-quiet, 카드에 data-popover 표식, 트리거 맞춤 alignItemWithTrigger 기본 true→false·align center→start(목록은 트리거 아래 왼쪽 끝에 붙는다, S32), 카드 안 목록 앞뒤에 머리·바닥 칸(header·footer — listbox 밖에 선다), 목록 안쪽 5px·항목 사이 1px, 항목 rounded-md·py-1·pl-1.5·pr-8·gap-1.5·text-sm→32px·9px 모서리·좌우 9px·gap-2·13px(기준 브랜치 줄의 지금 값), 항목의 자손 글자색 덮기(focus:**:text-accent-foreground)를 걷는다(켜진 줄은 바탕만 바뀐다), 항목 글자 칸 shrink-0·whitespace-nowrap→min-w-0·truncate(긴 가지 이름이 줄임표로 접힌다), 체크 지시자 absolute right-2→줄 끝의 흐름 안 한 칸·size-3·text-primary·굵기 2.4(드롭다운 라디오 줄과 같다), 스크롤 화살표 bg-popover→bg-background. 열림 애니메이션 클래스는 registry 그대로다. 라벨·구분선·그룹은 registry 그대로다(쓰는 자리가 없다).
"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { cn } from "cn"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-[26px] w-fit items-center gap-1.5 rounded-[9px] px-[7px] text-[12.5px] whitespace-nowrap text-muted-foreground transition-colors outline-none select-none quiet-hover focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        render={
          <ChevronDownIcon className="pointer-events-none size-2.5" strokeWidth={2.2} />
        }
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  header,
  footer,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = false,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  > & {
    // 카드 안 목록의 **앞뒤 칸**(머리·바닥 안내). `listbox` 밖에 선다 — 목록의 역할 안에 고를 수 없는 글이
    // 섞이지 않게. 기준 브랜치의 「브랜치 N개」와 「checkout은 하지 않아요」가 여기 온다.
    header?: React.ReactNode
    footer?: React.ReactNode
  }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        // **트리거 맞춤을 끈다**(S32) — registry 기본은 고른 값이 트리거 자리에 오도록 카드를 올려 겹친다. 앱의
        // 목록은 트리거 **아래로** 뜬다(지금 모양). 머리 칸이 카드 안에 있어 맞춤이면 그만큼 더 올라간다.
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          // 떠 있는 **카드**의 표식이다 — 검사가 이것으로 카드를 하나로 센다(툴팁에는 안 단다).
          data-popover=""
          className={cn("relative isolate z-50 max-h-(--available-height) w-[248px] origin-(--transform-origin) overflow-x-hidden overflow-y-auto scroll-quiet rounded-[13px] border border-border-strong bg-background text-popover-foreground shadow-lg duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className )}
          {...props}
        >
          {header}
          <SelectScrollUpButton />
          <SelectPrimitive.List className="flex flex-col gap-px p-[5px] outline-none">
            {children}
          </SelectPrimitive.List>
          <SelectScrollDownButton />
          {footer}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex h-8 w-full shrink-0 cursor-default items-center gap-2 rounded-[9px] px-[9px] text-[13px] outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">
        {children}
      </SelectPrimitive.ItemText>
      {/* 체크는 **줄 끝의 흐름 안**에 선다 — 켜진 줄에만 서므로 다른 줄에 빈 자리를 잡아 두지 않는다(드롭다운
          라디오 줄과 같다). 지금 값은 이 그림이 아니라 줄의 `aria-selected`가 말한다. */}
      <SelectPrimitive.ItemIndicator
        data-slot="select-item-indicator"
        className="pointer-events-none flex shrink-0 items-center text-primary"
      >
        <CheckIcon className="size-3" strokeWidth={2.4} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-background py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-background py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
