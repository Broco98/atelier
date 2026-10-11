// 앱 규격으로 고친 자리: hover bg-muted·text-foreground(5%, 행 hover 농도)→quiet-hover(fill-hover, 버튼 hover), 눌림 aria-pressed:bg-muted·data-[state=on]:bg-muted→aria-pressed:toggle-on(fill-active — 켜짐), 글자 text-sm→text-chat-meta(sm 0.8rem→text-chat-meta). 안 눌린 글자는 text-fg-tertiary(variant default — 분할·「코드」의 꺼진 가지 색, 눌리면 toggle-on의 글자색이 이긴다). 포커스는 앱의 한 링(`focus-ring` — accent 1px + 바깥 `focus-halo` 4px, codex-ds 결정 11)이고 registry의 border-ring·ring-ring/50과 틀린 값(aria-invalid)의 빨간 테두리를 걷었다, outline의 테두리 border-input→폭을 안 먹는 안쪽 링 border-heavy. registry의 다크 덧칠(`dark:` 색 변형)을 걷었다 — Codex 토큰이 `.dark`에서 다크 값을 든다. rounded-lg를 뿌리에서 크기로 옮겼다 — icon 크기가 부르는 icon-button(모서리를 변수로 든다)을 코어 유틸리티가 덮지 않게(커스텀 @utility가 앞에 선다). 크기를 더했다: icon(아이콘 버튼 규격 `icon-button` — 28 · `radius-lg`), icon-xs(그 24 단 `icon-button-xs` — 창 위 줄의 분할), toolbar(22px 툴바 버튼 — 다이어그램 머리 줄의 「코드」, rounded-md · 좌우 4px · text-xs · 400, MermaidBlock의 toolbarButtonQuiet과 같은 값), chip(설정 칩 — Codex 칩 `.at-chip`: 28px 알약 · 좌우 12px · text-chat-meta 400 · 안쪽 1px border-heavy 링 · hover fill-soft, 켜지면 옅은 파랑 면 accent-soft · link 글자 · accent 링). 칩의 hover · 켜짐은 버튼의 것(quiet-hover · toggle-on)이 아니라 칩 제 것이다 — 그 둘은 칩이 아닌 크기에만 걸린다. 두 칸 토글(문서/원문 · spec 레이아웃 편집기의 종류 · 템플릿)은 이 기본을 안 쓴다 — 따로 된 부품 segment-group이 든다.
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 text-chat-meta font-medium whitespace-nowrap transition-colors outline-none focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent text-fg-tertiary",
        outline: "bg-transparent inset-ring inset-ring-border-heavy",
      },
      size: {
        default:
          "h-8 min-w-8 rounded-lg px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-7 min-w-7 rounded-lg px-2.5 text-chat-meta has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 min-w-9 rounded-lg px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // 앱의 아이콘 버튼 규격을 그대로 부른다 — 값을 옮겨 적지 않는다(규격은 index.css 한 곳).
        icon: "icon-button",
        "icon-xs": "icon-button icon-button-xs",
        // 다이어그램 머리 줄의 툴바 버튼 — 배율 글자(「100%」)가 들어가는 이웃들과 한 줄에 서서 정사각이 아니다.
        toolbar: "h-[22px] min-w-[22px] rounded-md px-1 text-xs font-normal",
        // 설정 칩(테마·글꼴 프리셋) — Codex 칩(`.at-chip`)이다. 알약은 칩이 쓰는 모양이다(codex-ds 스펙 §2 「반경」 — `full`은
        // 경로 줄 · 칩 · 36 버튼). 켜진 칩은 굵어지지 않고 면 · 글자 · 링의 색으로 선다.
        chip: "h-7 min-w-7 rounded-full px-3 text-chat-meta font-normal text-fg inset-ring inset-ring-border-heavy hover:bg-fill-soft aria-pressed:bg-accent-soft aria-pressed:text-link aria-pressed:inset-ring-accent",
      },
    },
    compoundVariants: [
      // 버튼의 hover · 켜짐 — 칩이 아닌 크기 모두. 켜짐의 바탕(fill-active)과 글자색은 `toggle-on`이 든다.
      {
        size: ["default", "sm", "lg", "icon", "icon-xs", "toolbar"],
        class: "quiet-hover aria-pressed:toggle-on",
      },
    ],
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
