// 앱 규격으로 고친 자리: 뿌리 h-8·rounded-lg·투명 바탕·테두리→디자인 시스템의 검색칸(`.at-search` — 32px · `radius-lg` · 옅은 면 bg-fill-soft · 테두리 없음 · 좌우 8px · 돋보기와 글자 사이 8px — 프로젝트·아카이브 목록 위의 검색칸. 알약은 codex-ds 결정 3이 걷었다), 포커스 ring-3 ring-ring/50→앱의 한 링(`focus-ring` — 상자가 입는다: 바로 안의 칸에 키보드 포커스가 오면 선다, codex-ds 결정 11), 앞 덧붙이(inline-start) pl-2·muted 글자→안쪽 없이 fg-tertiary · 돋보기 14px(뿌리의 좌우 8px 안에 선다), 칸은 Input의 bare(칸만 — 상자 · 링은 뿌리가 든다)이고 칸의 좌우 안쪽을 걷는다(뿌리가 든다), 칸 자리 글자 muted→fg-tertiary. InputGroupTextarea와 textarea import, 뿌리의 has-[>textarea]:h-auto를 걷었다 — textarea.tsx를 들이지 않는다(P8). 틀린 값(aria-invalid)의 빨간 링과 Combobox 안의 링 끄기를 걷었다(쓰는 자리가 없다). 덧붙이 버튼·글자는 registry 그대로이고 색만 Codex 이름이다(글자 fg-secondary — 쓰는 자리가 없다). 덧붙이가 버튼 · 단축키 칸을 품을 때 당기는 바깥 여백(registry의 -0.3rem · -0.15rem — 4.8 · 2.4px)은 가까운 눈금 -4 · -2로 옮겼다(4px 눈금 — `spacing-guard.test.ts`, 쓰는 자리는 아직 없다). 덧붙이 버튼의 동그란 아이콘 단(icon-xs의 rounded-full)만 Codex 작은 아이콘 버튼의 모서리 rounded-md(24 · `radius-md`, DS `.at-ib.xs`)로 옮겼다 — 동그란 아이콘 버튼은 codex-ds 결정 3이 걷었다. registry의 다크 덧칠(`dark:` 색 변형)을 걷었다 — Codex 토큰이 `.dark`에서 다크 값을 든다.
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group relative flex h-8 w-full min-w-0 items-center gap-2 rounded-lg bg-fill-soft px-2 transition-colors outline-none focus-ring has-disabled:opacity-50 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3",
        className
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium text-fg-tertiary select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-md [&>svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      align: {
        "inline-start":
          "order-first has-[>button]:-ml-1 has-[>kbd]:-ml-0.5",
        "inline-end":
          "order-last has-[>button]:-mr-1 has-[>kbd]:-mr-0.5",
        "block-start":
          "order-first w-full justify-start px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
        "block-end":
          "order-last w-full justify-start px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "flex items-center gap-2 text-sm shadow-none",
  {
    variants: {
      size: {
        xs: "h-6 gap-1 rounded-md px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
        sm: "",
        "icon-xs":
          "size-6 rounded-md p-0 has-[>svg]:p-0",
        "icon-sm": "size-8 p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  }
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset"
  }) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-sm text-fg-secondary [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      variant="bare"
      className={cn("h-full flex-1 text-sm placeholder:text-fg-tertiary", className)}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
}
