// 앱 규격으로 고친 자리: 카드 rounded-lg·ring-1 ring-foreground/10·shadow-md·bg-popover→floating-card(index.css 한 곳 — 13px·border-strong·shadow-lg·bg-background, 옛 PopoverPortal 카드), 폭 w-(--anchor-width)·min-w-32→190px(변형 wide는 200px — 아카이브 거르개의 지금 값), 안쪽 p-1→5px·항목 사이 1px(세로 flex gap-px), overflow-y-auto에 scroll-quiet, 카드에 data-popover 표식, 항목 rounded-md·px-1.5·py-1·gap-1.5·text-sm→32px·9px·9px·gap-2·12.5px, 항목의 켜짐 focus:**:text-accent-foreground(자손 글자색 덮기)를 걷는다(켜진 줄은 바탕만 바뀐다 — 옅은 경로 힌트 같은 자손의 text-tertiary가 켜져도 옅게 남게), 구분선 -mx-1 my-1→my-[3px](안쪽 여백 안에 선다), 포털 상자를 z-50에 올린다(가림막이 쌓임 순서를 가진 조작까지 덮게). 열림 애니메이션 클래스는 registry 그대로다. 라디오 항목은 보통 항목과 같은 줄 규격이고 자손 덮기(focus:**:text-accent-foreground)를 걷는다(설명 칸의 옅은 글자가 켜져도 옅게 남게), 체크 지시자는 absolute right-2 + 줄의 pr-8 → 줄 끝의 흐름 안 한 칸(켜진 줄에만 서므로 빈 자리를 잡아 두지 않는다)·size-3·text-primary·굵기 2.4, 라디오 항목은 고르면 닫힌다(closeOnClick 기본 false→true, S33). 체크 항목과 라벨은 아직 registry 그대로다. 하위 메뉴(Sub·SubTrigger·SubContent)는 걷었다 — 쓰는 자리가 없고, SubContent는 앱 카드 위에 registry 카드 모양(rounded-lg·bg-popover·ring-1·p-1)을 className으로 다시 덮었다.
import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "cn"
import { CheckIcon } from "lucide-react"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

// 카드 폭 — 메뉴마다 지금 값이다(판 3 공통: 「폭도 표면마다 지금 값을 쓴다」). 셸 열기 · 상태 · 작업 ⋯는
// 190px, 아카이브 거르개는 200px다. 쓰는 자리가 className으로 덮지 않고 여기서 고른다.
const CONTENT_WIDTH = {
  default: "w-[190px]",
  wide: "w-[200px]",
} as const

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  width = "default",
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    width?: keyof typeof CONTENT_WIDTH
  }) {
  return (
    // 메뉴가 열린 동안 화면을 덮는 부품의 가림막(바깥 누르기는 닫기만 한다, S9)은 Positioner의 **형제**라
    // 그쪽의 z-50을 못 받는다. 포털 상자째 z-50에 올려야 쌓임 순서를 가진 조작(셸 컨트롤 줄 z-20 등)까지
    // 덮는다 — 안 올리면 그 위를 누른 클릭이 메뉴를 닫고 그 조작까지 누른다.
    <MenuPrimitive.Portal className="relative z-50">
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          // 떠 있는 **카드**의 표식이다 — 검사가 이것으로 카드를 하나로 센다(툴팁에는 안 단다).
          data-popover=""
          className={cn("z-50 flex max-h-(--available-height) origin-(--transform-origin) flex-col gap-px overflow-x-hidden overflow-y-auto scroll-quiet floating-card p-[5px] text-popover-foreground duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95", CONTENT_WIDTH[width], className )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex h-8 shrink-0 cursor-default items-center gap-2 rounded-[9px] px-[9px] text-[12.5px] outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon
          />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  closeOnClick = true,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      // **고르면 닫힌다**(S33) — 부품의 기본은 안 닫힘이다(여러 번 바꿔 보는 메뉴를 위한 값). 앱의 라디오
      // 메뉴(상태 · 아카이브 거르개)는 한 번 고르면 끝이라 보통 항목처럼 닫는다.
      closeOnClick={closeOnClick}
      className={cn(
        "relative flex h-8 shrink-0 cursor-default items-center gap-2 rounded-[9px] px-[9px] text-[12.5px] outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      {/* 체크는 **줄 끝의 흐름 안**에 선다 — 켜진 줄에만 서므로(지시자는 안 켜진 줄에서 아무것도 안
          그린다) 다른 줄에 빈 자리를 잡아 두지 않는다. 지금 값은 이 그림이 아니라 줄의 `aria-checked`가
          말한다. */}
      <MenuPrimitive.RadioItemIndicator
        data-slot="dropdown-menu-radio-item-indicator"
        className="pointer-events-none flex shrink-0 items-center text-primary"
      >
        <CheckIcon className="size-3" strokeWidth={2.4} />
      </MenuPrimitive.RadioItemIndicator>
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("my-[3px] h-px shrink-0 bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
}
