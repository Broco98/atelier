// 앱이 세운 부품(registry에 없다 — 디자인 시스템의 `.at-crumbs`, ui-refresh 결정 5 · 6): 카드 머리에서 지금 선 곳을 말하는
// 브레드크럼 캡슐이다. 흰 알약(h-8 · rounded-full · 안쪽 1px border) 하나에 조각들이 `text-chat-meta` · fg-secondary로 서고,
// 조각 사이에 꺾쇠(12px · fg-tertiary), 마지막 조각이 지금 선 곳이라 font-medium · fg에 넘치면 말줄임이다. 앞 아이콘 칸은
// 하나이고 준 때만 선다.
import { Fragment, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke"
import { cn } from "@/lib/utils"

/**
 * **보여 주기만 한다** — 조각은 글자이고 누르는 칸이 아니다. 위치를 옮기는 길은 사이드바 · 목록 · 팔레트가 든다.
 * 누르는 칸이 생기면 「어느 조각이 눌리나」와 「지금 선 곳」이 한 캡슐에서 갈리고, 사이드바 nav의 버튼 찾기와도 겹친다.
 *
 * 조각의 순서는 받은 그대로다(뿌리 → 지금 선 곳). 같은 글자의 조각이 둘 설 수 있어(폴더 이름) 자리를 키로 쓴다.
 * 캡슐은 줄에 눌리면 줄어들고(`min-w-0`), 줄어드는 몫은 마지막 조각의 말줄임이 받는다 — 앞 조각은 제 폭 그대로다.
 */
function Crumbs({
  items,
  icon,
  className,
}: {
  /** 뿌리부터 지금 선 곳까지. 마지막이 지금 선 곳이다. */
  items: readonly string[]
  /** 앞 아이콘 칸 — 크기를 안 준 글리프는 14px이다. */
  icon?: ReactNode
  className?: string
}) {
  const last = items.length - 1
  return (
    <nav
      aria-label="위치"
      data-slot="crumbs"
      className={cn(
        "flex h-8 max-w-full min-w-0 shrink items-center gap-0.5 overflow-hidden rounded-full bg-surface px-3.5 text-chat-meta whitespace-nowrap text-fg-secondary inset-ring inset-ring-border",
        className
      )}
    >
      {icon !== undefined && (
        <span
          data-slot="crumbs-icon"
          className="mr-1.5 -ml-0.5 flex shrink-0 [&>svg:not([class*='size-'])]:size-3.5"
        >
          {icon}
        </span>
      )}
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <ChevronRight aria-hidden className="mx-[3px] size-3 shrink-0 text-fg-tertiary" strokeWidth={SMALL_GLYPH_STROKE} />}
          {index === last ? (
            <span className="min-w-0 truncate font-medium text-fg">{item}</span>
          ) : (
            <span className="shrink-0">{item}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}

export { Crumbs }
