// 앱 규격으로 고친 자리: 글자 text-base·md:text-sm→13.5px, 변형 flush를 더했다(떠 있는 카드의 첫 줄로 서는 칸 — 검색 팔레트: 테두리·모서리·포커스 링 없이 아래 선 하나, 13px, 안쪽 14×10px).
import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const inputVariants = cva(
  "w-full min-w-0 bg-transparent transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "h-8 rounded-lg border border-input px-2.5 py-1 text-[13.5px] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        // 제목이 없는 떠 있는 카드에서는 이 칸이 첫 줄이다 — 아래 목록과 선 하나로 갈린다. 포커스는
        // 카드가 떠 있는 동안 늘 여기 있으므로 링으로 따로 말하지 않는다.
        flush: "shrink-0 border-b border-border px-3.5 py-2.5 text-[13px]",
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
