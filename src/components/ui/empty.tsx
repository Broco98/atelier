// 앱 규격으로 고친 자리: 선례가 없는 부품이라 shadcn 기본을 앱 토큰으로 그리고 글자 크기만 앱 규격이다(결정 2) — 제목 text-sm→16.5px, 설명 text-sm/relaxed→14px·leading-relaxed, 내용 칸 text-sm→13.5px(큰 빈 화면 다섯의 지금 값). 뿌리에 변형 list를 더했다(점선 목록 빈칸 둘 — 테두리 border로 border-dashed가 보이고, flex-1을 flex-none으로 걷어 목록 패널을 채우지 않는다, 제목 13.5px·설명 12.5px). 제목·설명은 뿌리의 data-variant를 group/empty로 읽는다. 아이콘 칸(EmptyMedia icon)의 바탕 bg-muted(3%)는 registry 그대로다.
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const emptyVariants = cva(
  "group/empty flex w-full min-w-0 flex-col items-center justify-center gap-4 rounded-xl border-dashed p-6 text-center text-balance",
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
        icon: "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-4",
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
        "font-heading text-[16.5px] font-medium tracking-tight group-data-[variant=list]/empty:text-[13.5px]",
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
        "text-[14px] leading-relaxed text-muted-foreground group-data-[variant=list]/empty:text-[12.5px] [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
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
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-[13.5px] text-balance",
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
