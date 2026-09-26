// 앱 규격으로 고친 자리: 변형 segment를 더한다(두 칸 토글 — 모드 전환·문서/원문, 결정 1). 눌린 바닥(state-1·10px 모서리) 위를 흰 칩 하나(ToggleGroupChip, segment-on)가 180ms ease-out으로 미끄러지고, 칸은 바탕을 안 켠다 — 서 있는 칸은 foreground, 안 선 칸은 tertiary + tint-hover(결정 31, 부품 기본의 quiet-hover·toggle-on을 안 쓴다), 잠기면 칸 disabled:opacity-40 · 칩 opacity-40. 크기 default(모드 전환: 테두리·안쪽 3px·두 칸 격자, 칸 30px·7px 모서리·12.5px)와 icon(문서/원문: 안쪽·칸 사이 2px, 칸 24px icon-button). 그룹이 칸 값의 타입을 받는다(제네릭 Value). 그룹·칸의 className이 state 함수여도 받는다(registry는 문자열로만 합친다).
"use client"

import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

import { toggleVariants } from "@/components/ui/toggle"

/**
 * 그룹이 칸에 내려 주는 모양. segment는 부품 기본(`toggleVariants`)을 안 쓰는 따로 된 가족이라
 * 크기 이름도 따로다 — 두 칸 토글의 칸은 hover 바탕도 눌림 바탕도 없다(아래 `segmentItemVariants`).
 */
type ToggleGroupLook =
  | {
      variant?: VariantProps<typeof toggleVariants>["variant"]
      size?: VariantProps<typeof toggleVariants>["size"]
    }
  | { variant: "segment"; size?: "default" | "icon" }

const ToggleGroupContext = React.createContext<
  ToggleGroupLook & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
    disabled?: boolean
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
})

// ── segment — 두 칸 사이를 미끄러지는 칩 ──
// 선택을 칸마다 바탕을 켜고 끄는 것으로 말하면 「옮겨갔다」가 아니라 「깜빡였다」로 읽힌다. 칩은 칸에
// 붙어 있지 않은 형제(`aria-hidden`)라 Base UI가 칸으로 세지 않는다 — 방향키·탭 자리는 칸 둘만 돈다.
// 칩 하나라 두 칸이 동시에 서는 판이 마크업에서 불가능하다.

/** 눌린 바닥 — 한 단계 눌려 있어야 그 위의 칩이 **떠오른 것**으로 읽힌다. */
const segmentGroupVariants = cva("relative rounded-[10px] bg-state-1", {
  variants: {
    size: {
      // 두 칸이 폭을 반씩 나눈다(사이드바 폭 240~400px을 따라 칸이 는다). 칸 수 2는 결정 5가
      // 「모드는 둘뿐」이라 못박은 값이다 — 셋이 되는 날 칩 폭 50%도 함께 낡는다.
      default: "grid grid-cols-2 border p-[3px]",
      icon: "flex shrink-0 items-center gap-0.5 p-0.5",
    },
  },
  defaultVariants: { size: "default" },
})

/**
 * 곡선은 --ease-panel이 아니라 ease-out이다 — 그 곡선은 폭처럼 긴 거리를 위한 것이고 여기 거리는
 * 칸 하나라 끝에서 질질 끌린다. transform만 트랜지션한다 — 잠김의 흐림까지 페이드하면 파일을
 * 옮길 때마다 칩이 저 혼자 밝아졌다 어두워진다.
 */
const segmentChipVariants = cva(
  "segment-on absolute transition-transform duration-[180ms] ease-out",
  {
    variants: {
      size: {
        // 칸 폭이 사이드바 폭을 따라 늘어나므로 px가 아니라 비율로 적는다 — 고정 px면 사이드바를
        // 끌어 넓히는 순간 칩이 칸에서 어긋난다.
        default: "inset-y-[3px] left-[3px] w-[calc(50%-3px)] rounded-[7px]",
        icon: "top-0.5 left-0.5 size-6 rounded-lg",
      },
      second: { true: "", false: "" },
      // 칩은 버튼이 아니라 disabled를 못 받는다 — 흐림을 따로 주지 않으면 두 칸이 흐린 위에서 칩
      // 혼자 또렷하다.
      disabled: { true: "opacity-40", false: "" },
    },
    compoundVariants: [
      // 둘째 칸으로 — 제 폭의 100%다(칸 사이 틈이 없다).
      { size: "default", second: true, class: "translate-x-full" },
      // 둘째 칸으로 — 칸 24px(icon-button) + 칸 사이 2px(gap-0.5). 둘 다 고정값이다.
      { size: "icon", second: true, class: "translate-x-[26px]" },
    ],
    defaultVariants: { size: "default", second: false, disabled: false },
  }
)

/** relative가 칩 위로 글자·글리프를 올린다 — 칩이 absolute라 그냥 두면 덮인다. */
const segmentItemVariants = cva(
  "relative outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      size: {
        default: "h-[30px] rounded-[7px] text-[12.5px] font-medium",
        icon: "icon-button",
      },
    },
    defaultVariants: { size: "default" },
  }
)

/**
 * 칸의 hover는 **배경을 안 켠다**(결정 31) — 바닥이 이미 눌린 회색이라 그 위에 hover 바탕을 얹으면
 * 서 있는 칸과 구분이 안 된다. 글자색만 짙어진다. 서 있는 칸에는 hover 규칙이 없다 — 떠올라 있음이
 * 그 칸을 말한다. 눌림에 따라 갈리므로 Base UI의 state로 고른다.
 */
const segmentItemTone = (pressed: boolean) =>
  pressed ? "text-foreground" : "text-tertiary tint-hover"

function ToggleGroup<Value extends string>({
  className,
  spacing = 2,
  orientation = "horizontal",
  disabled,
  variant,
  size,
  children,
  ...props
}: ToggleGroupPrimitive.Props<Value> &
  ToggleGroupLook & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }) {
  const look: ToggleGroupLook =
    variant === "segment" ? { variant, size } : { variant, size }
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      // segment는 칸 사이를 바닥의 크기가 정한다 — 부품 기본의 --gap을 안 읽는다.
      style={
        look.variant === "segment"
          ? undefined
          : ({ "--gap": spacing } as React.CSSProperties)
      }
      className={(state) =>
        cn(
          look.variant === "segment"
            ? segmentGroupVariants({ size: look.size })
            : "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-vertical:flex-col data-vertical:items-stretch",
          typeof className === "function" ? className(state) : className
        )
      }
      disabled={disabled}
      {...props}
    >
      <ToggleGroupContext.Provider
        value={{ ...look, spacing, orientation, disabled }}
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

  if (context.variant === "segment") {
    return (
      <TogglePrimitive
        data-slot="toggle-group-item"
        data-variant={context.variant}
        data-size={context.size}
        className={(state) =>
          cn(
            segmentItemVariants({ size: context.size }),
            segmentItemTone(state.pressed),
            typeof className === "function" ? className(state) : className
          )
        }
        {...props}
      >
        {children}
      </TogglePrimitive>
    )
  }

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
          typeof className === "function" ? className(state) : className
        )
      }
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

/**
 * 서 있는 칸을 말하는 칩 — segment 그룹 안, 칸들 **앞에** 둔다(칸이 relative라 뒤에 온 칸이 칩 위에
 * 그려진다). `at`은 칩이 서는 칸의 자리다(0부터). 두 칸이라 0이 아니면 둘째 칸이다.
 */
function ToggleGroupChip({
  at,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & { at: number }) {
  const context = React.useContext(ToggleGroupContext)
  const size = context.variant === "segment" ? context.size : "default"
  return (
    <span
      aria-hidden
      data-slot="toggle-group-chip"
      className={cn(
        segmentChipVariants({
          size,
          second: at > 0,
          disabled: context.disabled ?? false,
        }),
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem, ToggleGroupChip }
