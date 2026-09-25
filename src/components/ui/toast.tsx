// 앱 규격으로 고친 자리: 한 장만 선다(S26) — 모든 토스트가 고정 id 하나로 나는 `showToast`가 앱의 유일한 호출이고, 관리자(`toast`)는 내보내지 않는다(id 없이 내면 둘이 쌓인다), Provider timeout 기본 5000→1600ms(지금 규칙)·관리자를 기본으로 문다, Viewport 자리 fixed 오른쪽 아래(sm:)·max-w-sm→absolute 아래 가운데 20px·z-20(화면마다 지금 토스트 자리에 둔다, S14 — 두 화면의 relative 상자가 받는다)·이름 Notifications→메시지(S37), Portal을 걷는다(자리가 화면 안이다), `Toaster`는 Provider를 싸지 않는다 — Viewport + 목록이고 Provider는 앱 루트 하나다, 토스트 쌓기(absolute·--toast-index·peek·scale·높이 변수·data-behind/expanded)를 걷고 흐름 안의 한 줄로 선다, 모양 rounded-2xl·border·bg-popover·shadow-lg·p-4·gap-3→10px·border-strong·bg-background·shadow-lg·px-3.5 py-2·gap-2·12.5px(옛 토스트), 밀어서 닫기를 걷는다(swipeDirection 빈 배열, S27), 닫기 버튼(Close toast)·Action·Content·Description을 걷는다, 아이콘 다섯(success·info·warning·error·loading)→둘(성공 Check 초록 · 거절 Ban 옅은 글자, 14px), 제목 text-sm font-medium→물려받는다, 들고남 translateY(150%) 500ms→100ms 페이드와 확대(결정 7, 아래 가운데를 기준점으로 — 쌓임이 없어 밀어 올릴 것이 없다). 포커스 링은 registry 그대로다.
import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { cn } from "cn"
import { BanIcon, CheckIcon } from "lucide-react"

const toast = ToastPrimitive.createToastManager()

/**
 * 앱의 토스트는 **한 장이다**(S26). 모든 토스트를 이 id 하나로 낸다 — 같은 id로 다시 내면 Base UI가 그
 * 자리에서 갈아 끼우고 시간을 다시 센다. `limit` 1로는 안 된다: 한도를 넘은 토스트가 DOM에서 빠지지 않고
 * `data-limited`·`inert`로 남는다.
 */
const TOAST_ID = "app-toast"

/** 토스트의 두 말. 한 일(✓)과 못 한 일(⊘)이 같은 표면을 쓰고, 글리프가 둘을 가른다(결정 47). */
type ToastKind = "success" | "rejected"

/**
 * 토스트를 낸다 — 작업 화면과 아카이브 화면이 같은 이 호출을 쓴다. 떠 있던 것이 있으면 이 글자로 갈아 끼운다.
 * Provider가 마운트된 **뒤에** 낸 것만 선다(관리자는 Provider가 구독한 뒤부터 듣는다).
 */
function showToast(title: string, kind: ToastKind = "success") {
  toast.add({ id: TOAST_ID, title, type: kind })
}

function ToastProvider({
  toastManager = toast,
  timeout = 1600,
  ...props
}: ToastPrimitive.Provider.Props) {
  return (
    <ToastPrimitive.Provider
      toastManager={toastManager}
      timeout={timeout}
      {...props}
    />
  )
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      aria-label="메시지"
      className={cn(
        "absolute bottom-5 left-1/2 z-20 -translate-x-1/2 outline-none",
        className
      )}
      {...props}
    />
  )
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      swipeDirection={[]}
      className={cn(
        "flex origin-bottom items-center gap-2 rounded-[10px] border border-border-strong bg-background px-3.5 py-2 text-[12.5px] shadow-lg outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn(className)}
      {...props}
    />
  )
}

function ToastIcon({ type }: { type: string | undefined }) {
  if (type === "success") {
    return (
      <CheckIcon
        data-slot="toast-icon"
        className="size-3.5 shrink-0 text-green-700"
        strokeWidth={2.4}
      />
    )
  }

  if (type === "rejected") {
    return (
      <BanIcon
        data-slot="toast-icon"
        className="size-3.5 shrink-0 text-tertiary"
        strokeWidth={2.2}
      />
    )
  }

  return null
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((toastItem) => (
    <Toast key={toastItem.id} toast={toastItem}>
      <ToastIcon type={toastItem.type} />
      <ToastTitle />
    </Toast>
  ))
}

/** 화면마다 지금 토스트 자리에 하나 둔다(S14). 한 번에 한 화면만 마운트되므로 Viewport는 늘 하나다. */
function Toaster(props: ToastPrimitive.Viewport.Props) {
  return (
    <ToastViewport {...props}>
      <ToastList />
    </ToastViewport>
  )
}

export { Toaster, Toast, ToastProvider, ToastTitle, ToastViewport, showToast }
export type { ToastKind }
