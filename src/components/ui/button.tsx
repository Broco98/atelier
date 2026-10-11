// 앱 규격으로 고친 자리: 뿌리의 투명 테두리·bg-clip-padding을 걷었다(채운 버튼이 제 높이 그대로 칠해진다), 모서리·글자를 뿌리에서 크기로 옮겼다, 포커스 링은 앱의 한 링(`focus-ring` — accent 1px + 바깥 `focus-halo` 4px, codex-ds 결정 11)이고 registry의 border-ring·ring-3과 틀린 값(aria-invalid)의 빨간 링을 걷었다, 누를 때 1px 내려앉기(active translate)를 걷었다, disabled 50%→40%. registry의 다크 덧칠(`dark:` 색 변형)을 걷었다 — Codex 토큰이 `.dark`에서 다크 값을 든다. **변형은 Codex `Button`이다**(codex-ds 스펙 §3 · DS `.at-btn`): default = primary(`fg` 면 · `fg-inverse` 글자 — 한 화면에 하나), secondary(`fill-soft` 면 · hover `fill-hover`), outline(투명 바탕 · 안쪽 1px `border-heavy` 링 · hover `fill-soft`, 펼친 메뉴 트리거는 `fill-hover`), ghost(`fg-secondary` 글자 · hover 버튼 hover `quiet-hover`), destructive = danger(`danger-solid` 면 · 흰 글자 `fg-on-solid` — 지우는 동작. DS가 테마와 상관없이 `#ffffff`로 적는 글자라 다크에서 검어지는 `fg-inverse`를 쓰지 않는다). 그 밖의 둘은 앱의 것이다: soft(옅은 파랑 면 accent-soft에 link 글자, hover에 Codex 파랑 20% — 변수를 바로 읽는다: 상태(hover) 뒤에 유틸리티 `accent`를 면으로 붙이는 것은 `state-scale.test.ts`가 막는다), link(text-link). 옛 hover의 손으로 섞은 면(`color-mix`)은 Codex 면 알파(`fill-*`)가 갈음했다. **크기는 Codex 단이다**: default(카드 · 툴바 안 — 32 · `radius-lg` · 좌우 12 · `chat-meta`, DS `.at-btn.sm`), top(머리 카드 — 24 · `radius-md` · 좌우 8 · `chat-meta`, `.at-btn.top`), xs(줄 안 — 26 · `radius-md` · 좌우 9 · `text-xs`, `.at-btn.xs`), lg(Codex 기본 — 36 · 알약 · 좌우 14 · `text-sm`, `.at-btn`), 아이콘 셋은 아이콘 버튼 규격(`icon-button` — icon 28 · `radius-lg`, icon-sm 26 · icon-xs 24 · `radius-md`). 앱이 따로 두던 크기(sm 28 · 창 바닥 dialog 28)와 머리 알약(pill · pill-sm)·동그란 아이콘 버튼(icon-round · icon-lg)은 걷었다(codex-ds 결정 3) — 부르던 자리는 가까운 단으로 옮겼다(창 바닥은 DS 확인 창의 `.at-btn.sm`인 default).
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// 잠긴 버튼은 포인터를 안 받는다(disabled:pointer-events-none) — 테두리 없는 버튼에서는 바탕 농도가 「누를 수 있다」를
// 말하는 유일한 어휘라, 잠긴 채 hover가 걸리면 눌리는 버튼으로 읽힌다.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors outline-none select-none focus-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Codex primary — 한 화면의 주 동작 하나(설정의 「저장」 · 확인 창의 진행 버튼).
        default: "bg-fg text-fg-inverse",
        secondary: "bg-fill-soft text-fg hover:bg-fill-hover",
        // 흰 카드 위의 보조 동작 — 테두리는 폭을 안 먹는 안쪽 링이라 채운 버튼과 높이가 같다. 펼친 메뉴의 트리거만 한 단
        // 짙다 — 목록 패널 토글처럼 `aria-expanded`로 「펼쳐져 있다」를 말하는 버튼은 평소 모양 그대로 선다.
        outline:
          "text-fg inset-ring inset-ring-border-heavy hover:bg-fill-soft aria-[haspopup=menu]:aria-expanded:bg-fill-hover",
        // 조용한 글자 버튼 — 평소에는 한 단 옅은 글자이고, hover에 버튼 hover(fill-hover)와 본문 글자색이 함께 선다.
        ghost: "text-fg-secondary quiet-hover aria-expanded:toggle-on",
        // Codex danger — 되돌릴 수 없는 동작의 진행 버튼(확인 창의 「제거」 · 「삭제」).
        destructive: "bg-danger-solid text-fg-on-solid",
        // 목록 빈칸의 「프로젝트 등록」 — 좁은 패널 안에서 주 버튼보다 한 단 가볍게 이끄는 자리.
        soft: "bg-accent-soft text-link hover:bg-(--accent)/20",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        // 카드 · 툴바 안의 버튼 — 에이전트 훅의 「설치」, 프로젝트 빈 화면의 「프로젝트 등록」, 확인 창의 바닥(DS `.at-btn.sm`).
        default:
          "h-8 gap-1.5 rounded-lg px-3 text-chat-meta has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        // 머리 카드의 글자 버튼 — 「폴더 열기」 · 「조용한 셸 모두 닫기」 · 설정의 「저장」(DS `.at-btn.top` — 24 · `radius-md` · 좌우 8 ·
        // 사이 5 · `chat-meta`, 아이콘 14). 위 줄에 서는 것은 모두 24다(DS `HeadCard`). 색은 변형이 든다 — 보통은 ghost, 저장은 default.
        top: "h-6 gap-1.25 rounded-md px-2 text-chat-meta [&_svg:not([class*='size-'])]:size-3.5",
        // 줄 안의 버튼 — 설정 행의 「기본값으로」, 토스트의 동작, 목록 빈칸의 「프로젝트 등록」(DS `.at-btn.xs`).
        xs: "h-6.5 gap-1.5 rounded-md px-2.25 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        // Codex 기본 — 카드 밖에 홀로 서는 큰 버튼(DS `.at-btn`). 둥근 것은 이 단뿐이다(codex-ds 스펙 §2 「반경」).
        lg: "h-9 gap-1.5 rounded-full px-3.5 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "icon-button",
        "icon-sm": "icon-button icon-button-sm",
        "icon-xs": "icon-button icon-button-xs [&_svg:not([class*='size-'])]:size-3",
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
