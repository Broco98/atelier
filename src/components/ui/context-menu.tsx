// **우클릭 메뉴의 바탕** — Base UI `ContextMenu`를 앱 메뉴의 모양으로 감싼다(codex-ds 결정 15 · 스펙 §3 「우클릭 메뉴 바탕」).
//
// 우클릭 메뉴는 그 대상의 ⋯ 메뉴와 같은 목록이라(codex-ds 결정 6) **부품도 같다** — 항목(단축키 칸은 항목의 `shortcut`) · 구분선 ·
// 하위 메뉴는 `dropdown-menu.tsx`의 함수를 다른 이름으로 다시 내보낼 뿐이고, 카드는 같은 `MenuCard`에 폭만 `size-menu-ctx`(248)를 준다.
// Base UI의 `ContextMenu`도 Root · Trigger 말고는 Menu 부품을 다시 내보낸 것이라, 메뉴 부품이 이 Root 안에서 그대로 선다.
// 여기 새로 서는 것은 여는 길(Root — 우클릭 · 길게 누르기, Trigger — 그 대상 · 키 — ⇧F10과 메뉴 키)과 카드의 자리뿐이다.
//
// 웹뷰의 기본 메뉴는 앱 뿌리가 늘 막는다(`AppShell`, codex-ds 결정 8) — 이 메뉴가 없는 자리를 우클릭하면 아무것도 서지 않는다.
// 입력칸 · 터미널의 편집 메뉴도 이 바탕이다(`EditMenu`) — document에서 우클릭을 가려 숨은 Trigger로 연다. 대상 메뉴의 Trigger는
// 우클릭을 받아 멈추므로 대상 위의 우클릭은 대상 메뉴다. 그 Trigger가 감싼 자리 안의 입력칸(사이드바 행의 이름을 고치는 칸 —
// `WorkContextMenu`, 셸 탭 이름을 고치는 칸 — `ShellTabs`의 `editing`)에서는 Trigger가 물러서 편집 메뉴다. 프로젝트 · Archive 목록
// 행 · Processes 행 · spec 레이아웃 행 · spec 트리 파일 행 · 문서 글의 메뉴도 숨은 Trigger로 연다(`TargetMenu`) — 자리가 우클릭을
// 받아 대상을 가르고 멈춘 뒤, 자리 곁의 숨은 Trigger로 연다. 두 메뉴의 숨은 Trigger는 한 손잡이다(`useHiddenContextMenu`). 자리 안의 입력칸(프로젝트 목록 행의 이름을 고치는 칸)에서는 자리가
// 물러서 편집 메뉴다(`opensEditMenu`).
//
// **Root(와 그 안의 Trigger)가 감싸는 자리에 다른 메뉴를 두지 않는다.** Base UI는 우클릭 메뉴 Root의 밑에 선 메뉴 줄을 모두 「우클릭
// 메뉴의 줄」로 쳐서 오른쪽 버튼의 놓음으로만 고른다 — 그 밑의 ⋯ 메뉴(`DropdownMenu`)를 누른 채 끌어 줄 위에서 놓으면 아무것도 안
// 돈다. 그래서 편집 메뉴는 앱을 감싸지 않고, work · 탭 대상 메뉴의 Trigger는 그 대상(행 목록 · 띠 · 머리 카드 이름 · 탭 칸 하나)만
// 감싼다. 안에 ⋯을 품은 자리(Processes 행 · spec 레이아웃 행)는 Root를 자리 곁의 형제로 둔다(`TargetMenu`).
import type * as React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
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
import { useOpenInHoverGroup } from "@/components/ui/hover-group"
import { HOTKEYS, pressed, type KeyChord } from "@/lib/hotkeys"

// 열린 동안 앱 무리에 든다 — ⋯ 메뉴의 Root(`DropdownMenu`)와 같은 까닭 · 같은 길이다.
function ContextMenu({ open, onOpenChange, ...props }: ContextMenuPrimitive.Root.Props) {
  const report = useOpenInHoverGroup("menus", { open, onOpenChange })
  return (
    <ContextMenuPrimitive.Root
      data-slot="context-menu"
      open={open}
      onOpenChange={report.onOpenChange}
      {...props}
    />
  )
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

/** 대상 메뉴를 여는 키인가 — ⇧F10이나 메뉴 키(표의 `openMenu` · `menuKey`, codex-ds 결정 19). 무엇의 메뉴인지는 포커스가 정한다. */
export function opensTargetMenu(event: KeyChord): boolean {
  return pressed(event, "openMenu") || pressed(event, "menuKey")
}

/**
 * 그 두 키의 `aria-keyshortcuts` 값 — 표의 `aria`를 띄어 잇는다(ARIA는 여럿을 빈칸으로 가른다). 역할이 없어 스스로는 아무것도 말하지
 * 않는 대상(머리 카드 이름 — `Frame`)이 「여기서 이 키가 듣는다」를 말하는 자리다. 글자를 여기 적지 않는다 — 키의 이름은 표 한 자리다
 * (`hotkey-glyphs.test.ts`).
 */
export const TARGET_MENU_ARIA = [HOTKEYS.openMenu.aria, HOTKEYS.menuKey.aria].join(" ")

/**
 * **⇧F10 · 메뉴 키로 대상의 메뉴를 그 대상 곁에 연다**(codex-ds 스펙 §9) — 메뉴가 있는 대상(포커스를 받는 요소)이 제 `onKeyDown`에
 * 단다. macOS WebKit은 이 키로 `contextmenu`를 스스로 내지 않아서, 그 대상에 우클릭 사건을 대신 낸다 — 그러면 우클릭과 같은 길
 * (`ContextMenuTrigger`)이 같은 메뉴를 연다. 자리는 대상의 왼쪽 아래다(커서가 없다). 그렇게 열면 카드 자신이 포커스를 쥐고 ↓가 첫
 * 항목이다 — ⋯를 눌러 연 것과 같다.
 *
 * 키의 기본 동작은 막는다 — 메뉴 키를 스스로 아는 웹뷰가 제 메뉴를 한 번 더 내지 않게. 입력칸의 이 키는 여기 안 온다 — 이것을 다는
 * 대상 안에 입력칸이 없고, 이름을 고치는 칸은 그 대상을 갈아 끼우고 선다. 입력칸에서는 편집 메뉴가 document에서 받는다(`EditMenu`).
 */
export function openMenuByKey(event: React.KeyboardEvent<HTMLElement>): void {
  if (!opensTargetMenu(event)) return
  event.preventDefault()
  const spot = event.currentTarget.getBoundingClientRect()
  event.currentTarget.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: spot.left, clientY: spot.bottom }),
  )
}

/**
 * **숨은 Trigger로 여는 우클릭 메뉴의 손잡이** — 뿌리가 대상을 감싸지 않는 두 메뉴(입력칸 · 터미널의 편집 메뉴 `EditMenu`, 목록 행 ·
 * 문서 글의 대상 메뉴 `TargetMenu`)가 함께 쓴다. 부르는 쪽이 우클릭 · 키를 받아 대상을 가른 뒤 `openAt`을 부르면, 화면에 안 서는
 * Trigger(`hiddenTrigger`)에 그 자리의 우클릭 사건을 대신 낸다. 그러면 우클릭 메뉴의 길(`ContextMenuTrigger`)이 그대로 돈다 — 카드가
 * 그 자리에 서고, 메뉴를 연 오른쪽 버튼의 놓음은 줄을 누르지 않는다.
 * - **숨은 Trigger만 연다** — `openAt`이 겨눈 대상이 없는 열기는 거둔다(`details.cancel()`).
 * - **닫혀도 대상을 남긴다**(`menu`) — 닫히는 움직임 동안 카드가 같은 줄을 그린다.
 * - **대상 테두리**(`focus-ring`의 `[data-menu-target]` — codex-ds 결정 11)는 열린 동안 `ringOf`가 준 요소에 달고 닫히면 걷는다.
 *
 * 무엇을 듣고 대상을 어떻게 가르는지, 닫힐 때 포커스가 어디로 가는지는 부르는 쪽 몫이다.
 */
export function useHiddenContextMenu<T>({
  ringOf,
  onOpen,
}: {
  /** 열린 동안 테두리가 설 요소. 없으면 테두리가 없다. */
  ringOf: (target: T) => HTMLElement | null | undefined
  /** 메뉴가 그 대상으로 열렸다. */
  onOpen?: (target: T) => void
}) {
  const [menu, setMenu] = useState<{ target: T; open: boolean } | null>(null)
  // 숨은 Trigger — 화면에 안 서고 포커스도 안 받는다.
  const trigger = useRef<HTMLElement | null>(null)
  // 다음 열기가 겨눌 대상. 부르는 쪽이 가른 것을 숨은 Trigger의 열기(`onOpenChange`)가 받아 간다.
  const pending = useRef<{ target: T } | null>(null)

  /** 그 대상의 메뉴를 화면의 그 자리(`x` · `y`)에 연다 — 숨은 Trigger에 그 자리의 우클릭 사건을 낸다. */
  const openAt = useCallback((target: T, x: number, y: number) => {
    pending.current = { target }
    trigger.current?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    )
  }, [])

  const ringed = menu?.open === true ? (ringOf(menu.target) ?? null) : null
  useEffect(() => {
    if (!ringed) return
    ringed.setAttribute("data-menu-target", "")
    return () => ringed.removeAttribute("data-menu-target")
  }, [ringed])

  const onOpenChange = (next: boolean, details: ContextMenuPrimitive.Root.ChangeEventDetails) => {
    if (!next) {
      setMenu((now) => now && { ...now, open: false })
      return
    }
    // 숨은 Trigger만 연다 — 가른 대상이 없는 열기는 거둔다.
    const hit = pending.current
    pending.current = null
    if (!hit) {
      details.cancel()
      return
    }
    setMenu({ target: hit.target, open: true })
    onOpen?.(hit.target)
  }

  return {
    /** 메뉴가 겨누는 대상과 열림. 한 번도 안 열렸으면 `null`이다. */
    menu,
    openAt,
    /** 숨은 Trigger 요소 — 거기 낸 사건을 document에서 다시 가르지 않으려는 쪽(`EditMenu`)이 읽는다. */
    trigger,
    /** `ContextMenu`에 그대로 편다. */
    root: { open: menu?.open === true, onOpenChange },
    /** `ContextMenu` 안에 세운다. */
    hiddenTrigger: (
      <ContextMenuTrigger
        ref={(node: HTMLElement | null) => {
          trigger.current = node
        }}
        render={<span hidden />}
      />
    ),
  }
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
