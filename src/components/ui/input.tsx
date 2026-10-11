// 앱 규격으로 고친 자리: 글자 text-base·md:text-sm→text-sm. 기본 · field는 디자인 시스템의 입력칸(`.at-input`)이다 — 32px · `radius-md`(8) · text-sm · 1px border-heavy(registry의 border-input). 포커스는 앱의 한 링(`focus-ring` — accent 1px + 바깥 `focus-halo` 4px, codex-ds 결정 11 · DS `Keyboard`)이고 registry의 테두리 색 바꿈 · ring-3 링을 걷었다(DS `Input` README의 「accent 1px + 3px accent-soft」도 이 한 링이 갈음한다). 틀린 값(aria-invalid)이면 테두리가 danger다 — 링과 따로 서서 고치는 동안에도 보인다. 잠긴 칸의 면은 fill-soft다. registry의 다크 덧칠(`dark:` 색 변형)을 걷었다 — Codex 토큰이 `.dark`에서 다크 값을 든다. 변형 flush를 더했다(떠 있는 카드의 첫 줄로 서는 칸 — 검색 팔레트: 테두리·모서리·포커스 링 없이 아래 선 하나, text-sm, 안쪽 14×10px). 변형 bare를 더했다(칸만 — 상자 · 링은 감싼 쪽이 든다: 검색칸 `InputGroup`). 변형 field(설정의 글자칸 — 입력칸에 좌우 9px · 흰 바탕 · 자리 글자 fg-tertiary)와 인라인 편집기 둘(inline-title — 프로젝트 제목: text-heading-lg · `radius-md` · 안쪽 8×4px를 음수 여백으로 되물려 글자가 제자리에 선다, inline-chip — 기준 브랜치: 28px · `radius-md` · 좌우 7px · text-code. 둘 다 편집하는 동안에만 서고 그동안 포커스가 칸에 있어 링이 곧 칸의 테두리다)을 더했다. 늘 서 있는 제목 칸 entry-title(spec 레이아웃 편집기의 이름 틀 — 44px · `radius-md` · 좌우 8px · text-heading-lg, 평소 테두리 투명 · hover border-heavy · 포커스는 링, 틀린 값은 field처럼 테두리 danger)을 더했다. 폭은 쓰는 자리가 className w-*로 정한다(자리의 배치다 — 기본은 w-full).
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const inputVariants = cva(
  "w-full min-w-0 bg-transparent transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg placeholder:text-fg-secondary disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "h-8 rounded-md border border-border-heavy px-2.5 py-1 text-sm focus-ring disabled:bg-fill-soft aria-invalid:border-danger",
        // 제목이 없는 떠 있는 카드에서는 이 칸이 첫 줄이다 — 아래 목록과 선 하나로 갈린다. 포커스는
        // 카드가 떠 있는 동안 늘 여기 있으므로 링으로 따로 말하지 않는다.
        flush: "shrink-0 border-b border-border px-3.5 py-2.5 text-sm",
        // 칸만 — 상자(높이 · 면 · 모서리)와 포커스 링은 감싼 쪽이 든다(검색칸 `InputGroup`이 바로 안의 칸에 포커스가 오면 링을
        // 입는다 — `focus-ring`의 둘째 갈래).
        bare: "",
        // 설정의 글자칸이다. 포커스는 앱의 한 링이고, 틀린 값이면 테두리가 빨갛다 — 링은 테두리 바깥에 서서 고치는 동안에도
        // 틀렸다는 것이 보인다(스토리 107). 스크린리더는 같은 속성을 「잘못된 값」으로 읽는다.
        field:
          "h-8 rounded-md border border-border-heavy bg-surface px-[9px] text-sm placeholder:text-fg-tertiary focus-ring aria-invalid:border-danger",
        // 인라인 편집기 — 누른 글자 자리가 그대로 칸이 된다. 편집하는 동안에만 서고 그동안 포커스가 늘 칸에 있어, 테두리는
        // 투명하고 앱의 한 링이 칸의 테두리다(codex-ds 스펙 §9 「테두리는 포커스 링이다」). 쓰는 자리는 프로젝트 상세 하나이고,
        // 글자는 누르기 전 그 자리의 단계와 같다 — 제목은 `text-heading-lg`(굵기도 단계의 것), 기준 브랜치는 셀렉트 칩과 같은
        // 28px · 고정폭 `text-code`다.
        "inline-title":
          "-mx-2 -my-1 rounded-md border border-transparent bg-surface px-2 py-1 text-heading-lg focus-ring",
        "inline-chip":
          "h-7 rounded-md border border-transparent bg-surface px-[7px] font-mono text-code focus-ring",
        // 늘 서 있는 제목 칸 — 고른 항목의 제목이 곧 칸이다(spec 레이아웃 편집기의 이름 틀). 제목처럼 보이다가 가리키면
        // 테두리가 서서 눌러 고치는 제목인 것을 말한다. 포커스는 앱의 한 링이고, 틀린 값이면 빨간 테두리가 hover보다
        // 이긴다(field와 같다).
        // 글자는 큰 제목(`text-heading-lg` — 굵기도 단계의 것)이고, 높이는 앞의 아이콘 상자(44)와 같다 — 편집기 폼이 설정 틀의
        // 큰 제목 자리에 서서다(판 06 티켓 07).
        "entry-title":
          "h-11 rounded-md border border-transparent px-2 text-heading-lg hover:border-border-heavy focus-ring aria-invalid:border-danger",
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
