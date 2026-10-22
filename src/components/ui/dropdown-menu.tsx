// 앱 규격으로 고친 자리: 카드 rounded-lg·ring-1 ring-foreground/10·shadow-md·bg-popover→floating-card(index.css 한 곳 — 16px·테두리 없이 shadow-prominent·bg-surface-elevated, DS `.at-menu`), 폭 w-(--anchor-width)·min-w-32→size-menu 260(DS `.at-menu`), 안쪽 p-1→menu-list(index.css 한 곳 — 세로 flex·안쪽 6px·항목 사이 2px, Select 목록과 같은 것), overflow-y-auto에 scroll-quiet, 카드에 data-popover 표식, 열림 animate-in·duration-100·zoom-in-95·slide-in→animate-menu-enter(index.css — duration-dropdown·ease-enter-snappy·30ms 지연·scale 0.98, DS 「움직임」 — 메뉴는 scale 0.98 → 1, 지연 동안은 첫 장면에 머문다)·닫힘 animate-out→animate-menu-exit(duration-basic·ease-exit·scale 0.98, DS 「움직임」 — 사라질 때 ease-exit. 둘 다 불투명도 · 크기만 움직인다 — tw-animate 키프레임의 블러가 이 곡선과 만나면 리눅스 WebKit이 죽는다), 항목 rounded-md·px-1.5·py-1·gap-1.5·text-sm→menu-row(index.css 한 곳 — 30px·10px 모서리·좌우 8px·gap 10px·text-chat-meta·글리프 15px fg-secondary·shrink-0, Select 항목과 같은 것, DS `.at-mi`), 항목의 켜짐 — registry의 옅은 면(유틸리티 `accent` · 글자 `accent-foreground`)→focus:bg-fill-hover·focus:text-fg(같은 면을 Codex 이름으로 — 유틸리티 `accent`는 Codex 파랑과 이름이 겹친다, `state-scale.test.ts`), 지우기 줄의 빨강 destructive→danger 글자(켜짐은 다른 줄과 같은 면이다 — DS `.at-mi.danger`), 항목의 켜짐 focus:**:text-accent-foreground(자손 글자색 덮기)를 걷는다(켜진 줄은 바탕만 바뀐다 — 옅은 경로 힌트 같은 자손의 text-fg-tertiary가 켜져도 옅게 남게), 구분선 -mx-1 my-1·h-px·bg-border→mx-1 my-1·0.5px·bg-border-heavy(DS `.at-msep`), 포털 상자를 z-50에 올린다(가림막이 쌓임 순서를 가진 조작까지 덮게). 라디오 항목은 보통 항목과 같은 줄이고 자손 덮기(focus:**:text-accent-foreground)를 걷는다(설명 칸의 옅은 글자가 켜져도 옅게 남게), 체크 지시자는 absolute right-2 + 줄의 pr-8 → MenuCheck(menu-check.tsx — 줄 끝의 흐름 안 한 칸·size-3.5·fg·앱 기본 굵기, DS `.at-mi .chk`, Select 항목과 같은 것. 켜진 줄에만 서므로 빈 자리를 잡아 두지 않는다), 라디오 항목은 고르면 닫힌다(closeOnClick 기본 false→true, S33). 묶음(Group · RadioGroup)은 registry의 맨 div→menu-list와 같은 세로 flex · 항목 사이 2px(묶음 안의 줄은 목록의 flex 사이를 받지 못한다). 하위 메뉴(Sub·SubTrigger·SubContent)는 registry 카드 덮기(rounded-lg·bg-popover·ring-1·p-1)를 걷고 앱 카드와 같은 카드 · 같은 줄로 되살렸다(codex-ds 결정 10 · 15 — 한 단계까지, 트리거 끝에 14px 셰브런 fg-tertiary, 연 줄은 켜진 줄의 면, DS `.at-mi .sub` · `.is-open`). 단축키 칸 text-caption·tracking-widest·muted-foreground→줄 오른쪽 끝의 text-xs·fg-tertiary(DS `.at-mi .k`) — 켜진 줄에서도 같은 색이고 접근성 이름에서 빠진다(글자는 항목의 `shortcut`이 단축키 표에서 받는다). 체크 항목은 라디오 항목과 같은 줄이다 — registry의 py-1·pr-8·pl-1.5·gap-1.5·글리프 size-4·absolute right-2 체크→ROW·menu-row·MenuCheck(우클릭 메뉴가 함께 쓰는 부품이라 다른 줄과 갈리지 않게). 끈 줄 opacity-50→55%·글자 · 글리프 fg-tertiary(DS `.at-mi.is-off`). 라벨 px-1.5·py-1·font-medium·fg-secondary→위 4·좌우 8·아래 6·text-xs·fg-tertiary(DS `.at-mhead`). registry의 다크 덧칠(`dark:` 색 변형)을 걷었다 — Codex 토큰이 `.dark`에서 다크 값을 든다. 항목 크기 note(이름 아래 설명 한 줄을 이는 두 줄 항목 — menu-row를 부르고 h-auto로 고정 높이를 풀며 items-start로 위로 맞추고 위아래 7px, DS `.at-mi.tall`)를 더했다.
//
// **우클릭 메뉴(`context-menu.tsx`)가 이 파일의 부품을 그대로 쓴다**(codex-ds 결정 15 — 정의 하나). 항목 · 구분선 · 하위 메뉴는
// 같은 함수이고(단축키 칸은 항목의 `shortcut`이다), 카드는 같은 `MenuCard`에 폭만 다르게 준다. Base UI의 `ContextMenu`도 Root · Trigger 말고는 Menu 부품을 다시 내보낸
// 것이라 이 부품들이 그 안에서 그대로 선다.
import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { HOTKEYS, type HotkeyId } from "@/lib/hotkeys"
import { cn } from "@/lib/utils"
import { ChevronRightIcon } from "lucide-react"

import { useOpenInHoverGroup } from "@/components/ui/hover-group"
import { MenuCheck } from "@/components/ui/menu-check"

// **열린 동안 앱 무리에 든다**(`hover-group.ts`, codex-ds 결정 20) — 메뉴가 열려 있으면 툴팁도 호버 카드도 서지 않는다. 앱의 메뉴는 모두
// 이 Root나 우클릭 메뉴의 Root(`context-menu.tsx`)를 지나므로, 여는 자리마다 알리지 않는다. 열림은 제어하는 쪽이 주면 그 값이고, 아니면
// 부품이 바꿀 때 받아 적는다 — 거둔 열기(`isCanceled`)는 열림이 아니다. 받아 적는 길은 툴팁 · 우클릭 메뉴와 하나다(`useOpenInHoverGroup`).
function DropdownMenu({ open, onOpenChange, ...props }: MenuPrimitive.Root.Props) {
  const report = useOpenInHoverGroup("menus", { open, onOpenChange })
  return (
    <MenuPrimitive.Root
      data-slot="dropdown-menu"
      open={open}
      onOpenChange={report.onOpenChange}
      {...props}
    />
  )
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

// 카드 폭 — 쓰는 자리가 className으로 덮지 않고 여기서 고른다. ⋯ 메뉴 · 고르기 메뉴는 `size-menu`(260), 우클릭 메뉴는
// `size-menu-ctx`(248)다(DS 「간격 · 반경 · 크기」). 하위 메뉴는 내용 폭을 따르되 168–220 안이다(DS `Menu` 보드 「판」) — 넘치는
// 이름은 줄의 `truncate`가 줄임표로 접는다.
const CARD_WIDTH = {
  menu: "w-(--size-menu)",
  "menu-ctx": "w-(--size-menu-ctx)",
  sub: "w-max min-w-42 max-w-55",
} as const

type MenuCardProps = MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">

/**
 * **떠 있는 메뉴 카드 하나** — ⋯ 메뉴(`DropdownMenuContent`) · 하위 메뉴(`DropdownMenuSubContent`) · 우클릭 메뉴(`ContextMenuContent`)가
 * 같은 카드를 부르고 폭과 자리만 다르게 준다(codex-ds 결정 15).
 */
function MenuCard({
  width,
  dataSlot,
  align,
  alignOffset,
  side,
  sideOffset,
  className,
  ...props
}: MenuCardProps & { width: keyof typeof CARD_WIDTH; dataSlot: string }) {
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
          data-slot={dataSlot}
          // 떠 있는 **카드**의 표식이다 — 검사가 이것으로 카드를 하나로 센다(툴팁에는 안 단다).
          data-popover=""
          // 뜰 때는 DS 「움직임」의 메뉴 값이다 — `duration-dropdown` · `ease-enter-snappy` · 30ms 지연 · scale 0.98 → 1. 지연 동안은
          // 첫 장면(투명 · 0.98)에 머문다(`backwards` — 안 주면 30ms 동안 다 그려진 카드가 먼저 비쳤다가 사라진다).
          // 닫힐 때는 DS의 기본 전환(`duration-basic`)에 사라지는 곡선(`ease-exit`)이다. 둘 다 index.css의 `animate-menu-*`이다 —
          // tw-animate의 `animate-in`은 블러까지 움직여 이 곡선과 만나면 리눅스 WebKit이 죽는다.
          className={cn("z-50 menu-list max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto scroll-quiet floating-card text-fg outline-none data-open:animate-menu-enter data-closed:animate-menu-exit data-closed:overflow-hidden", CARD_WIDTH[width], className)}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: MenuCardProps) {
  return (
    <MenuCard
      width="menu"
      dataSlot="dropdown-menu-content"
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

// 묶음(Group · RadioGroup)은 **목록과 같은 세로 flex · 항목 사이 2px**다(`menu-list`의 사이 — DS `.at-menu` `gap: 2px`). 묶음 안의
// 줄은 목록의 직접 자식이 아니라 목록의 flex 사이를 받지 못한다 — registry의 맨 div 그대로면 묶음 안의 줄만 30 간격으로 붙어 선다
// (상태 메뉴 · Archive 정렬 · 거르기, codex-ds 티켓 34). 안쪽 여백은 목록이 이미 주어 묶음은 사이만 든다.
const GROUP = "flex flex-col gap-0.5"

function DropdownMenuGroup({ className, ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" className={cn(GROUP, className)} {...props} />
}

// 묶음의 머리 글자 — DS `.at-mhead`(위 4 · 좌우 8 · 아래 6, `text-xs` · `fg-tertiary`, 오른쪽 끝에 링크 하나가 설 수 있다).
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
        "flex justify-between gap-3 px-2 pt-1 pb-1.5 text-xs text-fg-tertiary data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

// **줄 하나의 바탕** — 보통 항목 · 체크 항목 · 라디오 항목 · 하위 메뉴 트리거가 함께 쓴다. 켜짐은 옅은 면(`fill-hover`, codex-ds
// 스펙 §3 — 메뉴 항목은 면으로 포커스를 보인다)이다. 지금 못 하는 줄은 흐리고 눌리지 않는다 — DS `.at-mi.is-off`대로 55%에 글자 ·
// 글리프가 `fg-tertiary`다(단축키 칸은 늘 그 색이다). 글리프의 색은 줄이 아니라 그림에 건다 — `menu-row`가 그림에 바로 건 색을
// 줄의 글자색이 못 이긴다(index.css). 줄의 규격(높이 · 모서리 · 글리프)은 `menu-row`가 든다.
const ROW =
  "relative flex cursor-default outline-hidden select-none focus:bg-fill-hover focus:text-fg data-inset:pl-7 data-disabled:pointer-events-none data-disabled:text-fg-tertiary data-disabled:opacity-55 data-disabled:*:[svg]:text-fg-tertiary [&_svg]:pointer-events-none [&_svg]:shrink-0"

// 항목 한 줄의 크기. 보통은 menu-row(30px 한 줄)다. `note`는 이름 아래 설명 한 줄을 이는 두 줄 항목이라
// 높이가 내용을 따르고 아이콘이 이름 줄에 맞게 위로 선다. 가로 규격(좌우 안쪽 · 모서리 · 글리프 사이)을 옮겨
// 적지 않고 menu-row를 부른다(S40 — 규격은 index.css 한 곳) — 고정 높이만 `h-auto`로 풀고, 위로 맞춤과 위아래 7px을
// 더한다(DS `.at-mi.tall`). 덮는 코어 유틸리티는 menu-row 뒤에 선다 — 커스텀 @utility가 앞에 선다(index.css `floating-card` 주석 ·
// toggle.tsx 머리말).
const ITEM_SIZE = {
  default: "menu-row items-center",
  note: "menu-row h-auto items-start py-1.75",
} as const

// `shortcut`은 단축키 표의 항목 이름이다(`@/lib/hotkeys` — codex-ds 결정 19). 그 항목의 보이는 글자가 줄 끝 단축키 칸에 서고, 같은
// 항목의 값이 줄의 `aria-keyshortcuts`가 된다 — 눈에 보이는 키와 스크린리더가 듣는 키가 한 줄에서 나온다. 실제로 있는 단축키만
// 단다(codex-ds 결정 10).
function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  size = "default",
  shortcut,
  children,
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
  size?: keyof typeof ITEM_SIZE
  /** 단축키 표의 항목 — 줄 끝의 단축키 칸과 줄의 `aria-keyshortcuts`가 된다. */
  shortcut?: HotkeyId
}) {
  const hotkey = shortcut === undefined ? undefined : HOTKEYS[shortcut]
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      aria-keyshortcuts={hotkey?.aria}
      className={cn(
        ROW,
        "data-[variant=destructive]:text-danger data-[variant=destructive]:focus:text-danger data-[variant=destructive]:*:[svg]:text-danger",
        ITEM_SIZE[size],
        className
      )}
      {...props}
    >
      {children}
      {hotkey !== undefined && <MenuShortcut>{hotkey.glyph}</MenuShortcut>}
    </MenuPrimitive.Item>
  )
}

// 체크 줄은 라디오 줄과 같은 줄이다 — 같은 바탕(`ROW`) · 같은 크기(`menu-row`)이고, 체크는 줄 끝의 흐름 안에 선다(`MenuCheck`).
function DropdownMenuCheckboxItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(ROW, "menu-row items-center", className)}
      {...props}
    >
      {children}
      <MenuPrimitive.CheckboxItemIndicator
        data-slot="dropdown-menu-checkbox-item-indicator"
        render={<MenuCheck />}
      />
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ className, ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      className={cn(GROUP, className)}
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
      className={cn(ROW, "menu-row items-center", className)}
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

// **하위 메뉴 — 한 단계까지만 쓴다**(codex-ds 결정 10: 상태 ▸ · Finder에서 열기 ▸ · 복사 ▸). 하위 메뉴 안에 또 하위 메뉴를 두지 않는다.
// 트리거는 보통 항목과 같은 줄이고 끝에 셰브런이 선다. 포인터를 올리거나 → · Enter로 열고 ← · Esc로 닫는 것은 부품이 한다.
function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      // 하위 메뉴를 연 동안은 켜진 줄과 같은 면이다 — 포인터가 하위 메뉴로 넘어가 이 줄의 포커스가 빠져도 어느 줄이 열었는지 남는다(DS `.at-mi.is-open`).
      className={cn(ROW, "menu-row items-center data-popup-open:bg-fill-hover", className)}
      {...props}
    >
      {children}
      {/* 14px 셰브런 · fg-tertiary(DS `.at-mi .sub`) — 12px 이하가 아니라 굵기는 앱 기본이다(`icon-stroke.ts`). */}
      <ChevronRightIcon aria-hidden className="ml-auto size-3.5 text-fg-tertiary" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

// 하위 메뉴 카드는 **연 줄의 오른쪽**에 서고 화면 끝이면 왼쪽으로 편다(부품의 충돌 피하기). 첫 줄이 연 줄과 같은 높이에 서게
// 카드를 목록의 안쪽(6 — `menu-list`)만큼 올리고, 연 줄의 오른쪽 끝에서 카드 안쪽 6 + 카드 사이 4만큼 띄운다(DS `ContextMenu` 보드).
function DropdownMenuSubContent({
  align = "start",
  alignOffset = -6,
  side = "inline-end",
  sideOffset = 10,
  ...props
}: MenuCardProps) {
  return (
    <MenuCard
      width="sub"
      dataSlot="dropdown-menu-sub-content"
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("mx-1 my-1 h-[0.5px] shrink-0 bg-border-heavy", className)}
      {...props}
    />
  )
}

// **단축키 칸** — 줄 오른쪽 끝의 작은 흐린 글자다(DS `.at-mi .k` — `text-xs` · `fg-tertiary`, 켜진 줄에서도 같은 색). 항목의
// `shortcut`만 이것을 세운다 — 내보내지 않아 글자를 손으로 넘기는 길이 없다. 보이는 글자(⌘W)는 **항목의 접근성 이름에서 뺀다** —
// 이름이 「닫기⌘W」가 되면 이름으로 집는 자리와 스크린리더가 함께 흐려진다. 읽어 주는 것은 항목의 `aria-keyshortcuts`가 맡는다
// (codex-ds 스펙 §8).
function MenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      aria-hidden
      className={cn("ml-auto shrink-0 text-xs text-fg-tertiary", className)}
      {...props}
    />
  )
}

export {
  MenuCard,
  type MenuCardProps,
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
}
