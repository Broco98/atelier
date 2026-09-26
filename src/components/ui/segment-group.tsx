// 앱이 세운 부품(registry에 없다 — Base UI ToggleGroup 위의 두 칸 토글, 모드 전환·문서/원문, 결정 1): 눌린 바닥(state-1·10px 모서리) 위를 흰 칩 하나(segment-on)가 180ms ease-out으로 미끄러지고, 칸은 바탕을 안 켠다 — 서 있는 칸은 foreground, 안 선 칸은 tertiary + tint-hover(결정 31, Toggle 기본의 quiet-hover·toggle-on을 안 쓴다), 잠기면 칸 disabled:opacity-40 · 칩 opacity-40. 크기 default(모드 전환: 테두리·안쪽 3px·두 칸 격자, 칸 30px·7px 모서리·12.5px)와 icon(문서/원문: 안쪽·칸 사이 2px, 칸 24px icon-button). 칩은 그룹이 그리고, 서는 자리를 그룹의 값과 칸 순서(cells)에서 읽는다. 그룹이 칸 값의 타입을 받는다(제네릭 Value). 그룹·칸의 className이 state 함수여도 받는다.
"use client"

import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

import { resolveClassName } from "@/components/ui/resolve-class-name"

// 선택을 칸마다 바탕을 켜고 끄는 것으로 말하면 「옮겨갔다」가 아니라 「깜빡였다」로 읽힌다. 칩은 칸에
// 붙어 있지 않은 형제(`aria-hidden`)라 Base UI가 칸으로 세지 않는다 — 방향키·탭 자리는 칸 둘만 돈다.
// 칩 하나라 두 칸이 동시에 서는 판이 마크업에서 불가능하다.
//
// **ToggleGroup의 변형이 아니라 따로 된 부품이다.** 바닥·칸·칩·크기 이름이 부품 기본(`toggleVariants`)과
// 하나도 안 겹친다 — 한 부품의 변형으로 두면 그룹과 칸이 곳곳에서 「segment면」으로 갈리고, 칸은 받은
// variant·size를 조용히 버린다. 여기서는 칸이 그런 prop을 아예 안 받는다.

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

/** 크기 둘 — `null`(cva의 「변형 없음」)은 받지 않는다. 바닥 · 칩 · 칸이 한 크기를 함께 읽는다. */
type SegmentSize = NonNullable<VariantProps<typeof segmentGroupVariants>["size"]>

/** 그룹이 칸에 내려 주는 것은 크기 하나다. */
const SegmentGroupContext = React.createContext<SegmentSize>("default")

function SegmentGroup<Value extends string>({
  cells,
  value,
  size = "default",
  disabled,
  className,
  children,
  ...props
}: Omit<
  ToggleGroupPrimitive.Props<Value>,
  "value" | "defaultValue" | "multiple" | "orientation"
> & {
  size?: SegmentSize
  /**
   * 칸의 값을 칸이 놓인 순서대로. 칩은 이것과 `value`로 서는 자리를 안다 — 칸 순서를 부품이 모르면
   * 쓰는 자리가 칩의 자리를 그룹의 값에서 손으로 다시 적어야 한다.
   */
  cells: readonly Value[]
  /** 서 있는 칸. 칩이 이것을 따라가므로 제어 값만 받는다(`defaultValue`가 없다). */
  value: readonly Value[]
}) {
  return (
    <ToggleGroupPrimitive
      data-slot="segment-group"
      data-size={size}
      value={value}
      disabled={disabled}
      className={(state) =>
        cn(segmentGroupVariants({ size }), resolveClassName(className, state))
      }
      {...props}
    >
      {/* 칸들 **앞에** 선다 — 칸이 relative라 뒤에 온 칸이 칩 위에 그려진다. 두 칸이라 첫 칸이 아니면 둘째 칸이다. */}
      <span
        aria-hidden
        data-slot="segment-group-chip"
        className={segmentChipVariants({
          size,
          second: cells.indexOf(value[0]) > 0,
          disabled: disabled ?? false,
        })}
      />
      <SegmentGroupContext.Provider value={size}>
        {children}
      </SegmentGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function SegmentGroupItem({ className, ...props }: TogglePrimitive.Props) {
  const size = React.useContext(SegmentGroupContext)
  return (
    <TogglePrimitive
      data-slot="segment-group-item"
      data-size={size}
      className={(state) =>
        cn(
          segmentItemVariants({ size }),
          segmentItemTone(state.pressed),
          resolveClassName(className, state)
        )
      }
      {...props}
    />
  )
}

export { SegmentGroup, SegmentGroupItem }
