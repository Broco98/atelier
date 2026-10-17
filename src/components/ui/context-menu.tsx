// **우클릭 메뉴의 바탕** — Base UI `ContextMenu`를 앱 메뉴의 모양으로 감싼다(codex-ds 결정 15 · 스펙 §3 「우클릭 메뉴 바탕」).
//
// 우클릭 메뉴는 그 대상의 ⋯ 메뉴와 같은 목록이라(codex-ds 결정 6) **부품도 같다** — 항목(단축키 칸은 항목의 `shortcut`) · 구분선 ·
// 하위 메뉴는 `dropdown-menu.tsx`의 함수를 다른 이름으로 다시 내보낼 뿐이고, 카드는 같은 `MenuCard`에 폭만 `size-menu-ctx`(248)를 준다.
// Base UI의 `ContextMenu`도 Root · Trigger 말고는 Menu 부품을 다시 내보낸 것이라, 메뉴 부품이 이 Root 안에서 그대로 선다.
// 여기 새로 서는 것은 여는 길(Root — 우클릭 · 길게 누르기, Trigger — 그 대상)과 카드의 자리뿐이다.
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"

import {
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  MenuCard,
  type MenuCardProps,
} from "@/components/ui/dropdown-menu"

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

// 카드의 왼쪽 위가 커서 자리다(DS `ContextMenu` 보드 「열고 닫기」). 부품의 기본은 첫 줄이 커서 밑에 오게 카드를 조금 올리고
// 비키는데, 자리를 주면 그 기본이 꺼지고 준 값 그대로 선다. 화면 끝에 닿으면 부품이 안쪽으로 밀거나 뒤집는다.
function ContextMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 0,
  ...props
}: MenuCardProps) {
  return (
    <MenuCard
      width="menu-ctx"
      dataSlot="context-menu-content"
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  DropdownMenuGroup as ContextMenuGroup,
  DropdownMenuLabel as ContextMenuLabel,
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuCheckboxItem as ContextMenuCheckboxItem,
  DropdownMenuRadioGroup as ContextMenuRadioGroup,
  DropdownMenuRadioItem as ContextMenuRadioItem,
  DropdownMenuSub as ContextMenuSub,
  DropdownMenuSubTrigger as ContextMenuSubTrigger,
  DropdownMenuSubContent as ContextMenuSubContent,
  DropdownMenuSeparator as ContextMenuSeparator,
}
