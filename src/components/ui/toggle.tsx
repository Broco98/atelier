// 앱 규격으로 고친 자리: hover bg-muted·text-foreground(5%, 행 hover 농도)→quiet-hover(fill-hover, 버튼 hover), 눌림 aria-pressed:bg-muted·data-[state=on]:bg-muted→aria-pressed:toggle-on(fill-active — 켜짐), 글자 text-sm→text-chat-meta(sm 0.8rem→text-chat-meta). 안 눌린 글자는 text-fg-tertiary(variant default — 분할·「코드」의 꺼진 가지 색, 눌리면 toggle-on의 글자색이 이긴다. 설정 칩은 fg-secondary다). 포커스 링 border-ring·ring-ring/50→Codex 파랑(`border-(--accent)` · `ring-(--accent)/50` — 유틸리티 `accent`는 아직 옅은 면이다), 틀린 값 destructive→danger, outline의 테두리 border-input→border-heavy. registry의 다크 덧칠(`dark:` 색 변형)을 걷었다 — Codex 토큰이 `.dark`에서 다크 값을 든다. rounded-lg를 뿌리에서 크기로 옮겼다 — icon 크기가 부르는 icon-button(원)을 코어 유틸리티가 덮는다(커스텀 @utility가 앞에 선다). 크기 셋을 더했다: icon(24px 아이콘 버튼 — 머리행의 분할, icon-button을 부른다), toolbar(22px 툴바 버튼 — 다이어그램 머리 줄의 「코드」, rounded-md · 좌우 4px · text-xs · 400, MermaidBlock의 toolbarButtonQuiet과 같은 값), chip(설정 칩 — 28px · rounded-lg · 좌우 10px · text-chat-meta, 꺼진 칩 400 · fg-secondary · 켜진 칩 500, DS `.at-chip`). 두 칸 토글(문서/원문 · spec 레이아웃 편집기의 종류 · 템플릿)은 이 기본을 안 쓴다 — 따로 된 부품 segment-group이 든다.
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 text-chat-meta font-medium whitespace-nowrap transition-all outline-none quiet-hover focus-visible:border-(--accent) focus-visible:ring-[3px] focus-visible:ring-(--accent)/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20 aria-pressed:toggle-on [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent text-fg-tertiary",
        outline: "border border-border-heavy bg-transparent",
      },
      size: {
        default:
          "h-8 min-w-8 rounded-lg px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-lg px-2.5 text-chat-meta has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 rounded-lg px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // 앱의 24px 아이콘 버튼 규격을 그대로 부른다 — 값을 옮겨 적지 않는다(규격은 index.css 한 곳).
        icon: "icon-button",
        // 다이어그램 머리 줄의 툴바 버튼 — 배율 글자(「100%」)가 들어가는 이웃들과 한 줄에 서서 정사각이 아니다.
        toolbar: "h-[22px] min-w-[22px] rounded-md px-1 text-xs font-normal",
        // 설정 칩(테마·글꼴 프리셋) — 디자인 시스템의 칩(`.at-chip`)이다. 높이 · 모서리 · 글자는 28px ·
        // 10px · 13px이고, 켜진 칩만 굵다(`.at-chip.on`) — 꺼진 칩은 400 · fg-secondary다(다른 크기의 꺼진 가지는 fg-tertiary). 켜짐의
        // 바탕(fill-active)과 글자색은 뿌리의 `toggle-on`이 든다.
        chip: "h-7 min-w-7 rounded-lg px-2.5 text-chat-meta font-normal text-fg-secondary aria-pressed:font-medium",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
