// 앱 규격으로 고친 자리: registry의 svg 하나를 다시 짰다(결정 5) — 겉 상자 span이 data-slot·role·aria-label을 들고(이름 Loading→불러오는 중, 문장은 한국어), 안에 호(Loader2Icon)와 원(CircleIcon)을 둬 동작 줄이기면 motion-reduce 변형이 호를 숨기고 원을 세운다.
import type { ComponentProps } from "react"
import { cn } from "cn"
import { CircleIcon, Loader2Icon } from "lucide-react"

// 크기는 부르는 자리가 `className`(size-*)으로 정한다. 두 글리프는 겉 상자를 꽉 채운다.
// 색은 currentColor라 부르는 자리의 글자색을 물려받는다. 회전은 animate-spin(linear 1초)이다.
//
// 쓰는 자리가 상태를 이미 말하면 **겉 상자**에 aria-hidden을 준다 — 안쪽 svg에 주면
// role="status"와 이름 「불러오는 중」이 남아 같은 상태를 한 번 더 읽는다.
//
// 멈춘 호는 「굳었나」로 읽혀서 동작 줄이기면 빈틈 없는 원으로 바꾼다. 가르는 것은 CSS 한 곳이다
// (자바스크립트로 미디어를 묻지 않는다). 호의 data-slot은 index.css의 전역 동작 줄이기 규칙에도
// 걸린다 — 숨은 호라 해가 없다.
function Spinner({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="불러오는 중"
      className={cn("inline-flex size-4 shrink-0", className)}
      {...props}
    >
      <Loader2Icon
        data-slot="spinner-arc"
        className="size-full animate-spin motion-reduce:hidden"
      />
      <CircleIcon
        data-slot="spinner-circle"
        className="hidden size-full motion-reduce:block"
      />
    </span>
  )
}

export { Spinner }
