// 앱 규격으로 고친 자리: 선례가 없는 부품이라 shadcn 기본을 앱 토큰으로 그리고 글자 크기만 앱 규격이다(결정 2) — 설명 text-sm→13.5px(경로 못 찾음 띠의 지금 설명 값). 제목은 뿌리의 text-sm(14px)을 물려받아 지금 띠의 제목과 같은 값이라 registry 그대로다. 색은 Codex 이름이다 — 바탕은 흰 면 `surface`, destructive의 빨강은 `danger`, 설명 글자는 `fg-secondary`다. role="alert"는 registry 그대로다.
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-ui has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-surface text-fg",
        destructive:
          "bg-surface text-danger *:data-[slot=alert-description]:text-danger/90 *:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-fg",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-ui text-balance text-fg-secondary md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-fg [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
