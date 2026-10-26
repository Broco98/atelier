// 앱 규격으로 고친 자리: Provider 지연 기본값 0→`delay-tip`(200ms — Codex `delayDuration`, 02 티켓 12. 같은 무리의 호버 카드는 `duration-tip` 150 그대로다)이고 닫힌 직후 잠깐(`timeout`)은 앱 무리의 길이를 넘긴다(S3, 앱 루트에 하나 — codex-ds 결정 20, 아래 `TooltipProvider`), Root가 포인터로 선 열림 · 닫힘을 앱 무리(`hover-group.ts`)에 알리고 키보드 포커스로 선 것은 무리 밖에 세워 무리가 서면 비키게 한다(`actionsRef`), 글자는 registry의 text-xs(12 · 500)→Codex 툴팁의 13px `text-chat-meta`(13/18 — Codex 굵기 430은 단계가 없어 가까운 보통 400, 02 티켓 12), 열림·닫힘 애니메이션(duration-100 · animate-in · fade-in-0 · zoom-in-95 · slide-in-from-* · 그 닫힘 짝)을 걷었다 — Codex 툴팁은 움직이지 않는다(02 티켓 12). Root가 Esc를 멈추지 않고 아래 층에 보낸다(allowPropagation — 툴팁은 사람이 연 층이 아니다. 첫 쓰는 자리는 전체화면 창의 닫기 버튼이다). 앱이 더한 조각 `Hint` 하나: 트리거와 툴팁과 그 글자가 스크린리더로 가는 길(S28)을 한 곳에서 잇는다. 상자는 Codex 툴팁이다(DS `.at-tip`, codex-ds 스펙 §3): 한 줄 26px(줄 18에 위아래 4 — 넘치면 줄을 바꿔 자란다) · `radius-md` · 좌우 8px · fg(#1a1c1f) 바탕에 fg-inverse(흰) 글자 · 13px · 글자와 키 사이 6px, 키(Kbd)는 칩 없이 흰 글자 60%다. 화살표는 걷었다 — Codex 툴팁에는 없고, 트리거와 6px 떨어져 선다(DS 「자리 — 아래 6」).
import { useEffect, useRef, useState } from "react"
import { useStore } from "@tanstack/react-store"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { HOTKEYS, type HotkeyId } from "@/lib/hotkeys"
import { cn } from "@/lib/utils"
import { durationMs, GROUP_WINDOW_MS, hoverGroup, instantNow, menuOpen, useOpenInHoverGroup, whenJoined } from "./hover-group"
import { Kbd } from "./kbd"

// **뜨는 시간은 공급자가 든다**(codex-ds 스펙 §8 · 결정 20). 첫 툴팁은 멈춘 지 `delay-tip`(200 — Codex, 02 티켓 12)에 서고, 하나가 떠 있는 동안과 닫힌 직후
// 잠깐(`timeout` — 앱 무리의 `GROUP_WINDOW_MS`)은 옆 트리거가 곧바로 선다. 닫힘은 기다리지 않는다(`closeDelay` 0) — 떠난 뒤 기다리는
// 것은 안으로 들어가 읽는 호버 카드뿐이다(`duration-peek-close`, `SidebarWorkList`). 지연은 토큰을 문서 뿌리에서 한 번 읽는다 — 앱 뿌리에
// 하나만 서므로 그때는 스타일시트가 있다.
function TooltipProvider({
  delay,
  timeout = GROUP_WINDOW_MS,
  ...props
}: TooltipPrimitive.Provider.Props) {
  const [tip] = useState(() => durationMs("--delay-tip"))
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay ?? tip}
      timeout={timeout}
      {...props}
    />
  )
}

// **Esc는 툴팁에서 멈추지 않는다.** 부품 기본은 Esc를 떠 있는 것 하나에서 멈춰 그 아래 층이 함께 닫히지 않게
// 하는데, 툴팁은 사람이 연 층이 아니다 — 창 안의 버튼(전체화면의 닫기)에 포커스가 있어 툴팁이 떠 있으면, 멈출 때는
// 첫 Esc가 툴팁만 닫고 창은 남는다. 그래서 툴팁을 닫되 그 키를 아래 층(창·팔레트)에도 보낸다.
//
// **포인터로 선 동안 앱 무리에 든다**(`hover-group.ts`) — 그동안 호버 카드가 곧바로 선다. 열림은 부품이 들고 있어(제어하지 않는 툴팁)
// 바뀔 때 받아 적는다(`useOpenInHoverGroup` — 메뉴의 Root와 같은 길). 거둔 열기(`isCanceled`)는 열림이 아니다.
//
// **키보드 포커스로 선 툴팁은 무리 밖에 선다**(`aside`). 포커스가 떠나야 닫히므로 포인터가 어디로 가든 서 있는데, 그것이 무리를 열어
// 두면 포인터가 스치는 행마다 카드가 곧바로 선다. 무리 밖에 선 툴팁은 그 뒤 포인터가 무리를 세우면(카드 · 다른 툴팁) 비켜 닫힌다
// (`actionsRef`의 `close` — 포커스는 트리거에 그대로 있다). 공급자의 무리에서 새로 선 툴팁이 옛것을 닫는 것과 같은 꼴이라, 멈춰 선
// 카드 옆에 남지 않는다. 툴팁끼리는 공급자의 답을 둔다 — Base UI의 무리는 포커스로 선 툴팁도 쳐서, 그동안 옆 툴팁 트리거는 곧바로 선다.
function Tooltip({ onOpenChange, open, ...props }: Omit<TooltipPrimitive.Root.Props, "actionsRef">) {
  const actions = useRef<TooltipPrimitive.Root.Actions>(null)
  const report = useOpenInHoverGroup("shown", {
    open,
    onOpenChange: (next, eventDetails: TooltipPrimitive.Root.ChangeEventDetails) => {
      if (eventDetails.reason === "escape-key") eventDetails.allowPropagation()
      onOpenChange?.(next, eventDetails)
    },
    joins: (eventDetails) => eventDetails.reason === "trigger-hover",
  })
  useEffect(() => {
    if (!report.aside) return
    return whenJoined(() => actions.current?.close())
  }, [report.aside])
  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      actionsRef={actions}
      open={open}
      onOpenChange={report.onOpenChange}
      {...props}
    />
  )
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 inline-flex min-h-6.5 w-fit max-w-xs items-center gap-1.5 rounded-md bg-fg px-2 py-1 text-chat-meta text-fg-inverse **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-md",
            className
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

// **도움말 하나 — 앱이 더한 조각이다.** 트리거와 툴팁을 한 번에 세우고, 툴팁 글자를 스크린리더에 어떻게 남길지(S28)를
// 이 한 곳이 정한다. 툴팁은 `aria-describedby`도 역할도 달지 않아 그 글자는 스크린리더에 없다 — 옛 `title`이 이름 다음에
// 읽어 주던 말을 잃지 않으려면 트리거에 옮겨 적어야 하는데, 자리마다 손으로 적으면 같은 글자를 두 번 쓰고 한쪽만
// 고치는 날 눈과 귀가 다른 말을 듣는다.
//
// - `announce="name"`: 이름이 없던 아이콘 버튼이다 — 툴팁 글자가 이름(`aria-label`)이 된다.
// - `announce="description"`: 이름보다 더 말하는 글자다(하는 일 · 잠긴 이유 · 지금 값) — 설명(`aria-description`)으로 남는다.
// - 없으면 눈에만 뜬다: 이름과 같은 말이거나 이름이 이미 품었거나, `aria-pressed`·`aria-expanded`가 말하는 켬/끔·펼침이다.
// - `shortcut`은 단축키 표의 항목 이름이다(`@/lib/hotkeys` — codex-ds 결정 19). 그 항목의 보이는 글자가 글자 옆에 Kbd로 붙고 설명으로도
//   남으며(「검색 ⌘K」), 같은 항목의 값이 트리거의 `aria-keyshortcuts`가 된다 — 툴팁의 글자와 스크린리더가 듣는 키가 한 줄에서 나온다.
// - `shortcutElsewhere`: 그 키가 **이 트리거를 누르는 키가 아니다** — 다른 자리에 초점이 있을 때 같은 일을 한다(편집기 트리의 ⌥화살표와
//   옮기기 버튼). 글자(Kbd · 설명)는 그대로 가르치고 `aria-keyshortcuts`만 안 단다 — ARIA의 그 속성은 그 요소를 누르거나 그 요소에
//   초점을 주는 키만 말한다. 떠 있는 창의 닫기(Esc)는 창 어디서나 닫기라 이쪽이 아니다.
//
// 나머지 속성은 트리거(`TooltipTrigger`)의 것이다 — `render`로 다른 부품의 버튼(메뉴·Select·Popover 트리거)에 얹고,
// `disabled`면 툴팁이 없다(S23). 트리거에 직접 준 `aria-label`·`aria-description`이 위의 것보다 이긴다.
//
// **앱 무리를 읽는다**(`hover-group.ts`, codex-ds 결정 20). 호버 카드가 떠 있거나 막 닫혔으면 지연이 0이다 — 툴팁끼리는 공급자가 이미
// 그렇게 하지만 카드는 공급자의 무리에 못 낀다. 메뉴가 열려 있으면 툴팁이 없다 — 떠 있던 것은 닫히고 걸려 있던 지연이 터져도
// 서지 않는다(Root의 `disabled` — 부품이 그 열기를 곧바로 거둔다). 트리거도 함께 끈다 — 부르는 자리가 제 `disabled`(`false`도)를
// 주면 트리거는 Root의 것을 물려받지 않아, 그대로 두면 거둘 열기를 메뉴 위에서 한 번 더 건다. ⋯ · 상태 배지처럼 메뉴를 연 버튼은
// 메뉴의 가림막이 그 자리를 비워 두어, 이것이 없으면 다시 올린 포인터에 툴팁이 메뉴 위로 선다.
function Hint({
  text,
  shortcut,
  shortcutElsewhere = false,
  announce,
  disabled = false,
  ...props
}: TooltipPrimitive.Trigger.Props & {
  /** 툴팁 글자. */
  text: string
  /** 단축키 표의 항목 — 그 글자가 글자 옆의 키(Kbd)이고 설명으로도 남는다. */
  shortcut?: HotkeyId
  /** 그 키가 이 트리거를 누르는 키가 아니다 — 글자만 가르치고 `aria-keyshortcuts`는 안 단다. */
  shortcutElsewhere?: boolean
  /** 툴팁 글자를 이름으로 남기나, 설명으로 남기나. 없으면 눈에만 뜬다. */
  announce?: "name" | "description"
}) {
  const instant = useStore(hoverGroup, instantNow)
  const blocked = useStore(hoverGroup, menuOpen)
  const hotkey = shortcut === undefined ? undefined : HOTKEYS[shortcut]
  const description =
    [announce === "description" ? text : null, hotkey?.glyph].filter(Boolean).join(" ") || undefined
  return (
    <Tooltip disabled={blocked}>
      <TooltipTrigger
        aria-label={announce === "name" ? text : undefined}
        aria-description={description}
        aria-keyshortcuts={shortcutElsewhere ? undefined : hotkey?.aria}
        delay={instant ? 0 : undefined}
        {...props}
        disabled={disabled || blocked}
      />
      <TooltipContent>
        {text}
        {hotkey !== undefined && (
          <>
            {" "}
            <Kbd>{hotkey.glyph}</Kbd>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Hint }
