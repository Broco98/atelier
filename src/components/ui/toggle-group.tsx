// 앱 규격으로 고친 자리: 크기 chip(설정 칩 — 테마·글꼴 프리셋)의 줄은 칩 사이 6px(spacing 기본 1.5)이고 넘치면 다음 줄로 흐른다(flex-wrap). 그룹이 칸 값의 타입을 받는다(제네릭 Value). 그룹에 deselectable을 더했다(거짓이면 서 있는 칸을 다시 눌러 값을 비우지 못한다 — S16, 기본은 Base UI대로 비운다). 그룹·칸의 className이 state 함수여도 받는다(registry는 문자열로만 합친다). 칸 사이 수를 싣는 변수 이름을 registry의 `--gap`에서 `--toggle-gap`으로 바꿨다 — 값은 길이가 아니라 눈금의 칸 수이고(`--spacing`에 곱한다), `--gap`은 걷은 앱 틈 변수의 이름이다(`spacing-guard.test.ts`). 그 수(`spacing`)의 타입을 `number`에서 눈금 위의 칸 수(`ToggleGap` — 0 · 0.5 · 1 · 1.5 · 2)로 좁혔다. 두 칸 토글(문서/원문 · spec 레이아웃 편집기의 종류 · 템플릿)은 이 부품의 변형이 아니라 따로 된 부품이다(segment-group.tsx).
"use client"

import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

import { resolveClassName } from "@/components/ui/resolve-class-name"
import { toggleVariants } from "@/components/ui/toggle"

/**
 * 서 있는 칸을 다시 누르면 Base UI는 값을 비운다(`[]`). `deselectable`이 거짓이면 그 바꿈을 없던 일로 한다 —
 * 칸은 그대로 서 있고 `onValueChange`도 안 불린다(S16). 그 누름이 뜻할 것이 없는 자리(설정 칩 · 편집기의 종류 · 템플릿)가
 * 빈 값을 저마다 손으로 거르지 않게 부품이 든다. 선 칸 누름을 제 뜻으로 읽는 자리(문서/원문 — 뒤집기)는
 * 기본(`true`)대로 빈 값을 받는다. 두 칸 토글(`segment-group.tsx`)도 같은 규칙을 이것으로 건다.
 */
function keepOnePressed<Value extends string>(
  onValueChange: ToggleGroupPrimitive.Props<Value>["onValueChange"],
  deselectable: boolean
): ToggleGroupPrimitive.Props<Value>["onValueChange"] {
  if (deselectable) return onValueChange
  return (value, eventDetails) => {
    if (value.length === 0) {
      eventDetails.cancel()
      return
    }
    onValueChange?.(value, eventDetails)
  }
}

/**
 * 칸 사이 — 길이가 아니라 눈금(`--spacing` 4px)의 칸 수다. 정수 · 반 칸만 받아 칸 사이가 늘 눈금 위에 선다 — 그룹의
 * `gap-[--spacing(var(--toggle-gap))]`가 이 수를 눈금에 곱하고, 여백 지킴(`spacing-guard.test.ts`)이 그 임의 값을 받는 까닭이
 * 이 타입이다. 0은 칸을 붙여 한 덩어리로 세운다(registry의 붙은 그룹 — 아래 `data-[spacing=0]`).
 */
type ToggleGap = 0 | 0.5 | 1 | 1.5 | 2

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: ToggleGap
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
})

function ToggleGroup<Value extends string>({
  className,
  spacing: spacingProp,
  orientation = "horizontal",
  variant,
  size,
  deselectable = true,
  onValueChange,
  children,
  ...props
}: ToggleGroupPrimitive.Props<Value> &
  VariantProps<typeof toggleVariants> & {
    spacing?: ToggleGap
    orientation?: "horizontal" | "vertical"
    /** 거짓이면 서 있는 칸을 다시 눌러 값을 비우지 못한다(위 `keepOnePressed`). */
    deselectable?: boolean
  }) {
  // 설정 칩 줄(크기 chip)은 칩 사이가 6px이고(옛 칩 줄의 gap-1.5), 좁은 창에서 넘치면 다음 줄로 흐른다
  // (아래 data-[size=chip]:flex-wrap — 칩이 shrink-0이라 안 흐르면 칸 밖으로 샌다). 나머지는 registry 기본(8px)이다.
  const spacing = spacingProp ?? (size === "chip" ? 1.5 : 2)
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      style={{ "--toggle-gap": spacing } as React.CSSProperties}
      onValueChange={keepOnePressed(onValueChange, deselectable)}
      className={(state) =>
        cn(
          "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--toggle-gap))] rounded-lg data-[size=chip]:flex-wrap data-vertical:flex-col data-vertical:items-stretch",
          resolveClassName(className, state)
        )
      }
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={(state) =>
        cn(
          "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
          toggleVariants({
            variant: context.variant || variant,
            size: context.size || size,
          }),
          resolveClassName(className, state)
        )
      }
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem, keepOnePressed }
