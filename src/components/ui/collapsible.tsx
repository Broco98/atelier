// 앱 규격으로 고친 자리: 패널에 변형 fold를 더했다 — 180ms ease-panel로 grid-template-rows를 0fr↔1fr로 옮기는 접힘(아카이브 항목, 사이드바 목록의 구획 접힘과 같은 시간·곡선)이고 안쪽 격자 칸(overflow-hidden)을 부품이 그린다. 전이는 패널 자신에 있다(Base UI는 패널 자기 위의 전이만 기다린다). 닫힌 패널(data-closed)과 열리기 직전(data-starting-style)이 접힌 트랙이다 — 닫힘이 끝나 hidden이 섰던 패널은 display:none에서 나와 전이가 돌지 않으므로 시작 상태에 0fr을 준다. 닫힌 패널은 변형과 상관없이 inert다. 기본 변형은 registry 그대로 — 움직임 없이 바로 접히고 keepMounted가 없으면 닫히며 언마운트된다. 동작 줄이기면 index.css의 전역 규칙이 전이를 끈다.
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />
  )
}

const collapsibleContentVariants = cva("", {
  variants: {
    variant: {
      default: "",
      // height:auto는 전이되지 않고 max-height는 내용 길이를 어림해야 해서, 트랙 하나짜리 격자의
      // 행 크기(fr)를 옮긴다. 안쪽 칸이 overflow-hidden이라 0fr에서 제 내용보다 줄어든다.
      fold: "grid shrink-0 grid-rows-[1fr] transition-[grid-template-rows] duration-[180ms] ease-panel data-closed:grid-rows-[0fr] data-starting-style:grid-rows-[0fr]",
    },
  },
  defaultVariants: {
    variant: "default",
  },
})

type CollapsibleContentProps = Omit<
  CollapsiblePrimitive.Panel.Props,
  "className" | "render"
> & {
  className?: string
} & VariantProps<typeof collapsibleContentVariants>

/**
 * 닫힌 패널은 **inert**다. 닫히는 전이가 도는 동안 안의 것은 아직 보이지만 포커스와 포인터가 닿으면 안 된다 —
 * Base UI의 `hidden`은 전이가 끝난 뒤에야 선다. 열리면 곧바로 풀린다.
 */
function CollapsibleContent({
  className,
  variant = "default",
  children,
  ...props
}: CollapsibleContentProps) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(collapsibleContentVariants({ variant, className }))}
      render={(panelProps, state) => <div {...panelProps} inert={!state.open} />}
      {...props}
    >
      {variant === "fold" ? <div className="overflow-hidden">{children}</div> : children}
    </CollapsiblePrimitive.Panel>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
