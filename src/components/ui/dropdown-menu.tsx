// 앱 규격으로 고친 자리: 카드 rounded-lg·ring-1 ring-foreground/10·shadow-md·bg-popover→floating-card(index.css 한 곳 — 16px·테두리 없이 shadow-prominent·bg-surface-elevated, DS `.at-float`), 폭 w-(--anchor-width)·min-w-32→208px(DS `.at-menu`), 안쪽 p-1→menu-list(index.css 한 곳 — 세로 flex·안쪽 5px·항목 사이 1px, Select 목록과 같은 것), overflow-y-auto에 scroll-quiet, 카드에 data-popover 표식, 항목 rounded-md·px-1.5·py-1·gap-1.5·text-sm→menu-row(index.css 한 곳 — 32px·10px 모서리·좌우 10px·gap 9px·text-chat-meta·글리프 15px fg-tertiary·shrink-0, Select 항목과 같은 것, DS `.at-menu-row`), 항목의 켜짐 — registry의 옅은 면(유틸리티 `accent` · 글자 `accent-foreground`)→focus:bg-fill-hover·focus:text-fg(같은 면을 Codex 이름으로 — 유틸리티 `accent`는 Codex 파랑과 이름이 겹친다, `state-scale.test.ts`), 지우기 줄의 빨강 destructive→danger(켜지면 danger 10% 면), 항목의 켜짐 focus:**:text-accent-foreground(자손 글자색 덮기)를 걷는다(켜진 줄은 바탕만 바뀐다 — 옅은 경로 힌트 같은 자손의 text-fg-tertiary가 켜져도 옅게 남게), 구분선 -mx-1 my-1→my-[3px](안쪽 여백 안에 선다), 포털 상자를 z-50에 올린다(가림막이 쌓임 순서를 가진 조작까지 덮게). 열림 애니메이션 클래스는 registry 그대로다. 라디오 항목은 보통 항목과 같은 줄 규격이고 자손 덮기(focus:**:text-accent-foreground)를 걷는다(설명 칸의 옅은 글자가 켜져도 옅게 남게), 체크 지시자는 absolute right-2 + 줄의 pr-8 → MenuCheck(menu-check.tsx — 줄 끝의 흐름 안 한 칸·size-3·줄의 글리프색 fg-tertiary·굵기 2.4, Select 항목과 같은 것. 켜진 줄에만 서므로 빈 자리를 잡아 두지 않는다), 라디오 항목은 고르면 닫힌다(closeOnClick 기본 false→true, S33). 체크 항목과 라벨은 아직 registry 그대로이고 글자색만 Codex 이름이다(보조 글자 fg-secondary · 켜진 줄 fg). registry의 다크 덧칠(`dark:` 색 변형)을 걷었다 — Codex 토큰이 `.dark`에서 다크 값을 든다. 하위 메뉴(Sub·SubTrigger·SubContent)는 걷었다 — 쓰는 자리가 없고, SubContent는 앱 카드 위에 registry 카드 모양(rounded-lg·bg-popover·ring-1·p-1)을 className으로 다시 덮었다. 폭 변형 layout(260px — 설정 「spec 레이아웃」 행의 ⋯)과 항목 크기 note(이름 아래 설명 한 줄을 이는 두 줄 항목 — menu-row를 부르고 h-auto로 고정 높이를 풀며 items-start로 위로 맞추고 위아래 7px)를 더했다.
import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

import { MenuCheck } from "@/components/ui/menu-check"

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

// 카드 폭 — 기본은 디자인 시스템의 메뉴 폭 208px다(`.at-menu`). 셸 열기 · 상태 · 작업 ⋯ · 아카이브 거르개가 이것이다
// (거르개의 옛 200px은 기본보다 좁아져 기본으로 합쳤다). 설정 「spec 레이아웃」 행의 ⋯는 260px다(두 줄 항목 — 설명
// 줄이 한 줄에 들어야 한다). 쓰는 자리가 className으로 덮지 않고 여기서 고른다.
const CONTENT_WIDTH = {
  default: "w-[208px]",
  layout: "w-[260px]",
} as const

// 항목 한 줄의 크기. 보통은 menu-row(32px 한 줄)다. `note`는 이름 아래 설명 한 줄을 이는 두 줄 항목이라
// 높이가 내용을 따르고 아이콘이 이름 줄에 맞게 위로 선다. 가로 규격(좌우 안쪽 · 모서리 · 글리프 사이)을 옮겨
// 적지 않고 menu-row를 부른다(S40 — 규격은 index.css 한 곳) — 고정 높이만 `h-auto`로 풀고, 위로 맞춤과 위아래 7px을
// 더한다. 덮는 코어 유틸리티는 menu-row 뒤에 선다 — 커스텀 @utility가 앞에 선다(index.css `floating-card` 주석 ·
// toggle.tsx 머리말).
const ITEM_SIZE = {
  default: "menu-row items-center",
  note: "menu-row h-auto items-start py-[7px]",
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
          className={cn("z-50 menu-list max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto scroll-quiet floating-card text-fg duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95", CONTENT_WIDTH[width], className )}
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
        "px-1.5 py-1 text-xs font-medium text-fg-secondary data-inset:pl-7",
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
  size = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
  size?: keyof typeof ITEM_SIZE
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default outline-hidden select-none focus:bg-fill-hover focus:text-fg data-inset:pl-7 data-[variant=destructive]:text-danger data-[variant=destructive]:focus:bg-danger/10 data-[variant=destructive]:focus:text-danger data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 data-[variant=destructive]:*:[svg]:text-danger",
        ITEM_SIZE[size],
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
        "relative flex cursor-default items-center gap-1.5 rounded-lg py-1 pr-8 pl-1.5 text-chat-meta outline-hidden select-none focus:bg-fill-hover focus:text-fg focus:**:text-fg data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
        "relative flex menu-row cursor-default items-center outline-hidden select-none focus:bg-fill-hover focus:text-fg data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children}
      {/* 체크는 **줄 끝의 흐름 안**에 선다 — Select 줄과 같은 그림이다(`menu-check.tsx`). */}
      <MenuPrimitive.RadioItemIndicator
        data-slot="dropdown-menu-radio-item-indicator"
        render={<MenuCheck />}
      />
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
        "ml-auto text-xs text-fg-secondary group-focus/dropdown-menu-item:text-fg",
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
