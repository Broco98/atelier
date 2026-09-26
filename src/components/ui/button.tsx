// 앱 규격으로 고친 자리: 뿌리의 투명 테두리·bg-clip-padding을 걷었다(채운 버튼이 제 높이 그대로 칠해진다 — 테두리는 outline만 든다), 모서리·글자를 뿌리에서 크기로 옮겼다, 포커스 링 border-ring·ring-3→ring-2 ring-ring/50(destructive도 같은 링), 누를 때 1px 내려앉기(active translate)를 걷었다, disabled 50%→40%, primary hover bg-primary/80→bg-primary/85, outline·ghost의 hover bg-muted→quiet-hover · 펼침 aria-expanded:bg-muted→toggle-on, ghost의 평소 글자 muted-foreground. 크기는 앱의 글자 버튼 셋이다: default(주 버튼 — 32px · 10px 모서리 · 좌우 16px · 14px), sm(쪽 동작 — 28px · 9px · 11px · 13.5px), 새 크기 dialog(창 바닥 — 28px · 8px · 12px · 12.5px). xs 글자 text-xs→11.5px. 변형 destructive-ghost(바탕 없이 빨간 글자, hover에 destructive/10)와 soft(primary/10 바탕에 primary 글자, hover에 /15)를 더했다.
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// 잠긴 버튼은 포인터를 안 받는다(disabled:pointer-events-none) — 테두리 없는 버튼에서는 바탕 농도가 「누를 수 있다」를
// 말하는 유일한 어휘라, 잠긴 채 hover가 걸리면 눌리는 버튼으로 읽힌다.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        outline:
          "border border-border bg-background quiet-hover aria-expanded:toggle-on dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        // 조용한 글자 버튼 — 평소에는 한 단 옅은 글자이고, hover에 버튼 hover(state-2)와 본문 글자색이 함께 선다.
        ghost:
          "text-muted-foreground quiet-hover aria-expanded:toggle-on dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        // 머리행의 「제거」처럼 평소에는 바탕 없이 빨간 글자만 서는 되돌릴 수 없는 일.
        "destructive-ghost": "text-destructive hover:bg-destructive/10",
        // 목록 빈칸의 「프로젝트 등록」 — 좁은 패널 안에서 주 버튼보다 한 단 가볍게 이끄는 자리.
        soft: "bg-primary/10 text-primary hover:bg-primary/15",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 주 버튼 — 설정의 「저장」, 프로젝트 빈 화면의 「프로젝트 등록」.
        default:
          "h-8 gap-1.5 rounded-lg px-4 text-[14px] has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-[11.5px] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        // 쪽 동작 — 「다시 읽기」, 훅의 「설치」·「제거」, 프로젝트 머리행의 「폴더 열기」·「제거」, 목록 빈칸의 「프로젝트 등록」.
        sm: "h-7 gap-1 rounded-[9px] px-[11px] text-[13.5px] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-[9px] has-data-[icon=inline-start]:pl-[9px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 rounded-lg px-2.5 text-[13.5px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // 창 바닥 — 확인 창과 이름 바꾸기 창의 버튼. 창의 글(13px)보다 한 단 작다.
        dialog:
          "h-7 gap-1 rounded-[8px] px-3 text-[12.5px] [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-8 rounded-lg",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
