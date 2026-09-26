// 앱 규격으로 고친 자리: 크기 chip(설정 칩 — 테마·글꼴 프리셋)의 줄은 칩 사이 6px(spacing 기본 1.5)이고 넘치면 다음 줄로 흐른다(flex-wrap). 그룹이 칸 값의 타입을 받는다(제네릭 Value). 그룹·칸의 className이 state 함수여도 받는다(registry는 문자열로만 합친다). 두 칸 토글(모드 전환·문서/원문)은 이 부품의 변형이 아니라 따로 된 부품이다(segment-group.tsx).
"use client"

import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { type VariantProps } from "class-variance-authority"
import { cn } from "cn"

import { resolveClassName } from "@/components/ui/resolve-class-name"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
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
  children,
  ...props
}: ToggleGroupPrimitive.Props<Value> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
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
      style={{ "--gap": spacing } as React.CSSProperties}
      className={(state) =>
        cn(
          "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=chip]:flex-wrap data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-vertical:flex-col data-vertical:items-stretch",
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

export { ToggleGroup, ToggleGroupItem }
