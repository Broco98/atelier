// 앱 규격으로 고친 자리: 탭 칸은 작업 패널 탭의 규격(26px · 9px 모서리 · 좌우 10px · 13px · 500, flex-1 없이 글자 폭)이다. 켜진 칸은 toggle-on(state-3), 안 켜진 칸은 text-tertiary + quiet-hover(버튼 hover, state-2)이고 둘을 Base UI의 state로 가른다(registry의 data-active 변형·text-foreground/60·hover:text-foreground·그림자·dark 켜짐을 걷었다). 포커스 링은 3px ring 하나다(칸에 테두리가 없어 focus-visible border·outline을 걷었다). 목록은 바탕·안쪽 여백·모서리·높이 없이 칸 사이 4px(gap-1)이고, 변형 line(밑줄)은 걷었다 — 쓰는 자리가 없고 켜짐을 state로 고르면 설 자리가 없다. 뿌리의 gap-2를 걷었다(탭 줄이 패널의 머리행이라 패널과 붙는다). 패널은 상자가 없고(contents, registry의 flex-1·text-sm을 걷었다) 숨으면 Base UI의 hidden 속성이 preflight로 이긴다. 뿌리가 탭 값의 타입을 받는다(제네릭 Value). 칸의 className이 state 함수여도 받는다.
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cn } from "cn"

type TabsProps<Value extends string> = Omit<
  TabsPrimitive.Root.Props,
  "value" | "defaultValue" | "onValueChange"
> & {
  value?: Value
  defaultValue?: Value
  onValueChange?: (
    value: Value,
    eventDetails: TabsPrimitive.Root.ChangeEventDetails
  ) => void
}

function Tabs<Value extends string>({
  className,
  orientation = "horizontal",
  ...props
}: TabsProps<Value>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "group/tabs-list inline-flex w-fit items-center justify-center gap-1 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
        className
      )}
      {...props}
    />
  )
}

/**
 * 켜짐에 따라 갈리는 칸의 색. **quiet-hover는 안 켜진 칸에만 둔다** — toggle-on은 자기 hover를 품어서, 한 요소에
 * 둘이 겹치면 hover 규칙이 두 벌이 된다. registry처럼 `data-active:` 변형으로 적으면 그 변형이 `:where`(특이도 0)라
 * 두 벌 중 승자를 유틸리티 정렬 순서가 정한다(index.css의 quiet-hover 주석). 그래서 Base UI의 state로 고른다.
 */
const tabsTriggerTone = (active: boolean) =>
  active ? "toggle-on" : "text-tertiary quiet-hover"

/**
 * 규격은 디자인 정본의 `.cp-tab`(26px · 9px 모서리 · 13px · 500)이다. 작업 패널의 탭은 헤더의 뷰 탭(`.vtab` 28 · 9 ·
 * 13 · 500)과 같은 층에 나란히 서서 **한 가족으로 읽혀야** 한다 — 정본이 모서리·글자·굵기를 맞추고 높이만 2px 낮춘
 * 이유다. 토글 버튼의 규격(`toggle.tsx`)과는 다른 가족이다.
 */
function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={(state) =>
        cn(
          "relative inline-flex h-[26px] items-center justify-center gap-1.5 rounded-[9px] px-[10px] text-[13px] font-medium whitespace-nowrap transition-colors outline-none group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          tabsTriggerTone(state.active),
          typeof className === "function" ? className(state) : className
        )
      }
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("contents outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
