// 앱 규격으로 고친 자리: 뿌리의 투명 테두리·bg-clip-padding을 걷었다(채운 버튼이 제 높이 그대로 칠해진다 — 테두리는 outline만 든다), 모서리·글자를 뿌리에서 크기로 옮겼다, 포커스 링 border-ring·ring-3→ring-2 ring-ring/50(destructive도 같은 링), 누를 때 1px 내려앉기(active translate)를 걷었다, disabled 50%→40%, 채운 면 bg-primary→bg-primary-strong(흰 글자를 얹는 파랑 면 — `accent` 위 흰 글자는 2.9:1이라 한 단 짙은 `accent-solid`에서 3.6:1, DS README 「대비」가 알고 둔 값)이고 hover bg-primary/80→같은 면에 검정 8%, outline·ghost의 hover bg-muted→quiet-hover · 펼침 aria-expanded:bg-muted→toggle-on, ghost의 평소 글자 muted-foreground. 크기는 앱의 글자 버튼 셋이다: default(주 버튼 — 32px · 10px 모서리 · 좌우 16px · 14px), sm(쪽 동작 — 28px · 9px · 11px · 13.5px), 새 크기 dialog(창 바닥 — 28px · 8px · 12px · 12.5px). xs 글자 text-xs→11.5px. 변형 soft(primary/10 바탕에 primary-ink 글자, hover에 /15)를 더했다. link의 글자 text-primary→text-link. 머리 컨트롤 크기 셋을 더했다(ui-refresh 결정 5 · 6, DS `.at-pill` · `.at-pill.sm` · `.at-icon-btn.outline`): pill(카드 머리의 글자 알약 — 32px · rounded-pill · 좌우 14px · 글리프 사이 6px · text-ui · 400 · 글리프 14px), pill-sm(작은 알약 — 28px · 좌우 12px, 나머지는 pill과 같다), icon-round(카드 머리의 원형 아이콘 버튼 — 32px 원). 셋 다 outline과 함께 흰 바탕 · 안쪽 1px border-pill · hover에 state-1 한 겹 · 펼친 메뉴 트리거(aria-haspopup=menu)만 state-2 한 겹이고, default와 함께인 알약은 글자가 500이다(DS `.at-pill.primary`). 폼의 outline(그 밖의 크기)은 흰 바탕 · 테두리 border-border→border-strong · hover quiet-hover다(DS `.at-btn.outline`).
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// 잠긴 버튼은 포인터를 안 받는다(disabled:pointer-events-none) — 테두리 없는 버튼에서는 바탕 농도가 「누를 수 있다」를
// 말하는 유일한 어휘라, 잠긴 채 hover가 걸리면 눌리는 버튼으로 읽힌다.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary-strong text-primary-foreground hover:bg-[color-mix(in_srgb,var(--primary-strong),black_8%)]",
        // 흰 바탕 버튼 — 테두리와 hover는 크기가 가른다(아래 compoundVariants). 머리 알약과 폼 버튼이 다른 테두리를 쓴다.
        outline: "bg-card text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        // 조용한 글자 버튼 — 평소에는 한 단 옅은 글자이고, hover에 버튼 hover(state-2)와 본문 글자색이 함께 선다.
        ghost:
          "text-muted-foreground quiet-hover aria-expanded:toggle-on dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        // 목록 빈칸의 「프로젝트 등록」 — 좁은 패널 안에서 주 버튼보다 한 단 가볍게 이끄는 자리.
        soft: "bg-primary/10 text-primary-ink hover:bg-primary/15",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        // 주 버튼 — 설정의 「저장」, 프로젝트 빈 화면의 「프로젝트 등록」.
        default:
          "h-8 gap-1.5 rounded-lg px-4 text-ui has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-6 gap-1 rounded-inner px-2 text-caption in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        // 쪽 동작 — 「다시 읽기」, 훅의 「설치」·「제거」, 목록 빈칸의 「프로젝트 등록」.
        sm: "h-7 gap-1 rounded-lg px-[11px] text-ui in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-[9px] has-data-[icon=inline-start]:pl-[9px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 rounded-lg px-2.5 text-ui has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // 창 바닥 — 확인 창과 이름 바꾸기 창의 버튼. 글자는 창의 글과 같은 `text-ui`이고, 높이가 주 버튼(32)보다 한 단 낮은 28이다.
        dialog:
          "h-7 gap-1 rounded-lg px-3 text-ui [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-8 rounded-full",
        "icon-xs":
          "size-6 rounded-full in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-full in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9 rounded-full",
        // 카드 머리의 글자 알약 — 「폴더 열기」 · 「제거」처럼 카드 머리 끝에 서는 동작(ui-refresh 결정 5 · 6). 글자는 굵지
        // 않다 — 폼 버튼(500)과 갈리는 자리다(DS `.at-pill`).
        pill: "h-8 gap-1.5 rounded-pill px-3.5 text-ui font-normal [&_svg:not([class*='size-'])]:size-3.5",
        // 작은 알약 — 카드 머리 아래 한 줄이나 트리 카드 머리처럼 32px 알약이 줄을 채우는 자리(Archive의 정렬 · 거르기,
        // 레이아웃 편집기의 파일 · 폴더 추가). 높이와 좌우만 `pill`과 갈린다(DS `.at-pill.sm`).
        "pill-sm": "h-7 gap-1.5 rounded-pill px-3 text-ui font-normal [&_svg:not([class*='size-'])]:size-3.5",
        // 카드 머리의 원형 아이콘 버튼 — 복사 · 목록 접기(ui-refresh 결정 6). 크기는 `icon`과 같고, outline과 함께 서는
        // 모양이 갈린다(DS `.at-icon-btn.outline`).
        "icon-round": "size-8 rounded-full",
      },
    },
    compoundVariants: [
      // 머리 컨트롤의 흰 알약 · 흰 원 — 안쪽 1px `border-pill`이고, hover는 흰 바탕 위에 state-1 한 겹이다(바탕을 투명한
      // 회색으로 갈면 카드 밖 바탕이 비친다). 펼친 메뉴의 트리거는 한 단 더 짙다(state-2). **그 겹은 메뉴 트리거
      // (`aria-haspopup="menu"`)만 입는다** — 목록 패널 토글처럼 `aria-expanded`로 「펼쳐져 있다」를 말하는 버튼은 평소 흰
      // 원 그대로 선다.
      {
        variant: "outline",
        size: ["pill", "pill-sm", "icon-round"],
        class:
          "inset-ring inset-ring-border-pill hover:bg-[image:linear-gradient(var(--state-1),var(--state-1))] aria-[haspopup=menu]:aria-expanded:bg-[image:linear-gradient(var(--state-2),var(--state-2))]",
      },
      // 파란 알약 — 카드 머리의 주 동작(레이아웃 편집기의 「저장」). 글자가 주 버튼의 굵기(500)다 — 알약 크기의 400은 흰
      // 알약의 것이다(DS `.at-pill.primary`).
      {
        variant: "default",
        size: ["pill", "pill-sm"],
        class: "font-medium",
      },
      // 폼의 흰 버튼 — 테두리가 border-strong이고 hover는 버튼 hover(state-2), 펼침은 켜짐(state-3)이다.
      {
        variant: "outline",
        size: ["default", "xs", "sm", "lg", "dialog", "icon", "icon-xs", "icon-sm", "icon-lg"],
        class:
          "border border-border-strong quiet-hover aria-expanded:toggle-on dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
      },
    ],
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
