// 앱 규격으로 고친 자리: 선례가 없는 부품이라 shadcn 기본을 앱 토큰으로 그리고 글자 크기만 앱 규격이다(결정 2) — 제목 text-sm font-medium tracking-tight→heading-lg(24/28 · 600 — DS README 「글자」 표의 빈 화면 물음, 굵기 · 자간도 단계가 든다), 설명 text-sm/relaxed→text-sm(14/20 — 줄 높이도 단계가 든다), 내용 칸은 registry의 text-sm 그대로다. 뿌리에 변형 list를 더했다(점선 목록 빈칸 둘 — 테두리 border로 border-dashed가 보이고, flex-1을 flex-none으로 걷어 목록 패널을 채우지 않는다, 제목 chat-meta 500·설명 chat-meta). 제목·설명은 뿌리의 data-variant를 group/empty로 읽는다. 아이콘 칸(EmptyMedia icon)은 registry의 바탕 bg-muted · 글자 foreground를 Codex 이름으로 옮겼다(bg-fill-soft 5% · text-fg — 같은 값). 설명 글자는 fg-secondary다.
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const emptyVariants = cva(
  "group/empty flex w-full min-w-0 flex-col items-center justify-center gap-4 rounded-2xl border-dashed p-6 text-center text-balance",
  {
    variants: {
      variant: {
        // 큰 빈 화면(작업·프로젝트·아카이브·셸·spec) — 바깥 덮개 상자 안을 채운다.
        default: "flex-1",
        // 점선 목록 빈칸(프로젝트·아카이브 목록 패널) — 제 내용만큼 선다.
        list: "flex-none border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Empty({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyVariants>) {
  return (
    <div
      data-slot="empty"
      data-variant={variant}
      className={cn(emptyVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2", className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "flex size-8 shrink-0 items-center justify-center rounded-lg bg-fill-soft text-fg [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "font-heading text-heading-lg group-data-[variant=list]/empty:text-chat-meta group-data-[variant=list]/empty:font-medium",
        className
      )}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-sm text-fg-secondary group-data-[variant=list]/empty:text-chat-meta [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-link",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-sm text-balance",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
