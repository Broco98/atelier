// 앱 규격으로 고친 자리: Provider 지연 기본값 0→600ms(S3, 앱 루트에 하나), 글자 text-xs→11.5px(P5), 열림·닫힘 길이 duration-100 추가(결정 7의 100ms — registry 툴팁만 길이가 없어 tw-animate 기본 150ms였다). 열림 애니메이션 클래스는 registry 그대로다. Root가 Esc를 멈추지 않고 아래 층에 보낸다(allowPropagation — 툴팁은 사람이 연 층이 아니다. 첫 쓰는 자리는 전체화면 창의 닫기 버튼이다). 앱이 더한 조각 `Hint` 하나: 트리거와 툴팁과 그 글자가 스크린리더로 가는 길(S28)을 한 곳에서 잇는다.
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "cn"
import { Kbd } from "./kbd"

function TooltipProvider({
  delay = 600,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  )
}

// **Esc는 툴팁에서 멈추지 않는다.** 부품 기본은 Esc를 떠 있는 것 하나에서 멈춰 그 아래 층이 함께 닫히지 않게
// 하는데, 툴팁은 사람이 연 층이 아니다 — 창 안의 버튼(전체화면의 닫기)에 포커스가 있어 툴팁이 떠 있으면, 멈출 때는
// 첫 Esc가 툴팁만 닫고 창은 남는다. 그래서 툴팁을 닫되 그 키를 아래 층(창·팔레트)에도 보낸다.
function Tooltip({ onOpenChange, ...props }: TooltipPrimitive.Root.Props) {
  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      onOpenChange={(open, eventDetails) => {
        if (eventDetails.reason === "escape-key") eventDetails.allowPropagation()
        onOpenChange?.(open, eventDetails)
      }}
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
  sideOffset = 4,
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
            "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[11.5px] text-background duration-100 has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
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
// - `shortcut`은 글자 옆에 Kbd로 붙고 설명으로도 남는다(「검색 ⌘K」).
//
// 나머지 속성은 트리거(`TooltipTrigger`)의 것이다 — `render`로 다른 부품의 버튼(메뉴·Select·Popover 트리거)에 얹고,
// `disabled`면 툴팁이 없다(S23). 트리거에 직접 준 `aria-label`·`aria-description`이 위의 것보다 이긴다.
function Hint({
  text,
  shortcut,
  announce,
  ...props
}: TooltipPrimitive.Trigger.Props & {
  /** 툴팁 글자. */
  text: string
  /** 글자 옆의 키(Kbd). 설명으로도 남는다. */
  shortcut?: string
  /** 툴팁 글자를 이름으로 남기나, 설명으로 남기나. 없으면 눈에만 뜬다. */
  announce?: "name" | "description"
}) {
  const description =
    [announce === "description" ? text : null, shortcut].filter(Boolean).join(" ") || undefined
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={announce === "name" ? text : undefined}
        aria-description={description}
        {...props}
      />
      <TooltipContent>
        {text}
        {shortcut !== undefined && (
          <>
            {" "}
            <Kbd>{shortcut}</Kbd>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Hint }
