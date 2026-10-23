// 앱 규격으로 고친 자리: 줄 높이 leading-none을 걷었다 — 줄 높이는 글자 단계(text-sm 14/20)가 든다(codex-ds 티켓 03). 나머지는 field가 부르는 registry 원본 그대로다(쓰는 자리가 없다).
import * as React from "react"
import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
