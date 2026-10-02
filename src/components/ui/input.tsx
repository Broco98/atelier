// 앱 규격으로 고친 자리: 글자 text-base·md:text-sm→13.5px, 변형 flush를 더했다(떠 있는 카드의 첫 줄로 서는 칸 — 검색 팔레트: 테두리·모서리·포커스 링 없이 아래 선 하나, 13px, 안쪽 14×10px). 변형 field(설정의 글자칸 — 30px · 9px 모서리 · 좌우 9px · 13px · border-strong · 흰 바탕, 포커스는 링 없이 테두리 primary, 틀린 값은 aria-invalid로 빨간 테두리 red-500 · 링 없음, 자리 글자 tertiary)와 인라인 편집기 둘(inline-title — 프로젝트 제목: 25px · semibold · 자간 -0.015em · 10px 모서리 · 안쪽 8×4px를 음수 여백으로 되물려 글자가 제자리에 선다, inline-chip — 기준 브랜치: 26px · 9px 모서리 · 좌우 7px · mono 12.5px. 둘 다 편집하는 동안에만 서서 테두리가 늘 primary다)을 더했다. 늘 서 있는 제목 칸 entry-title(spec 레이아웃 편집기의 이름 틀 — 36px · 9px 모서리 · 좌우 8px · 18px semibold, 평소 테두리 투명 · hover border-strong · 포커스 primary, 틀린 값은 field처럼 aria-invalid로 빨간 테두리 red-500)을 더했다. 폭은 쓰는 자리가 className w-*로 정한다(자리의 배치다 — 기본은 w-full). 기본 · field는 디자인 시스템의 입력칸(`.at-input`)이다 — 32px · rounded-lg · text-ui · 1px border-strong, 포커스는 테두리 primary + 바깥 3px 옅은 링(primary/20)이고 틀린 값이면 링도 빨갛다(ui-refresh 결정 6 — 폼 컨트롤은 10px).
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const inputVariants = cva(
  "w-full min-w-0 bg-transparent transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-ui file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "h-8 rounded-lg border border-border-strong px-2.5 py-1 text-ui focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        // 제목이 없는 떠 있는 카드에서는 이 칸이 첫 줄이다 — 아래 목록과 선 하나로 갈린다. 포커스는
        // 카드가 떠 있는 동안 늘 여기 있으므로 링으로 따로 말하지 않는다.
        flush: "shrink-0 border-b border-border px-3.5 py-2.5 text-ui",
        // 설정의 글자칸이다. 포커스는 테두리 primary와 옅은 링이고, 틀린 값이면 빨간 테두리 · 링이 포커스보다 이긴다 —
        // 고치는 동안에도 틀렸다는 것이 보인다(스토리 107). 스크린리더는 같은 속성을 「잘못된 값」으로 읽는다.
        field:
          "h-8 rounded-lg border border-border-strong bg-background px-[9px] text-ui placeholder:text-tertiary focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/20 aria-invalid:border-red-500 aria-invalid:ring-destructive/20",
        // 인라인 편집기 — 누른 글자 자리가 그대로 칸이 된다. 편집하는 동안에만 서므로 테두리가 늘 primary다. 쓰는 자리는
        // 프로젝트 상세 하나이고, 글자는 누르기 전 그 자리의 단계와 같다 — 제목은 `text-title`(자간도 단계의 것), 기준 브랜치는
        // 셀렉트 칩과 같은 28px · 고정폭 `text-mono`다.
        "inline-title":
          "-mx-2 -my-1 rounded-lg border border-primary bg-background px-2 py-1 text-title",
        "inline-chip":
          "h-7 rounded-lg border border-primary bg-background px-[7px] font-mono text-mono",
        // 늘 서 있는 제목 칸 — 고른 항목의 제목이 곧 칸이다(spec 레이아웃 편집기의 이름 틀). 제목처럼 보이다가 가리키면
        // 테두리가 서서 눌러 고치는 제목인 것을 말한다. 틀린 값이면 빨간 테두리가 hover · 포커스보다 이긴다(field와 같다).
        "entry-title":
          "h-9 rounded-lg border border-transparent px-2 text-h2 font-semibold hover:border-border-strong focus-visible:border-primary aria-invalid:border-red-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Input({
  className,
  type,
  variant,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Input, inputVariants }
