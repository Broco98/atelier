// 앱 규격으로 고친 자리: 가림막 bg-black/10·backdrop-blur-xs→modal-scrim(25% 검정, 흐림 없음), Popup에 aria-modal 직접(S31), 카드 rounded-xl·ring·bg-popover→floating-card(index.css 한 곳 — 13px·border-strong·shadow-lg·bg-background), 글자 text-sm→13.5px, 제목·설명·바닥은 확인 창(alert-dialog)과 같은 값, 닫기 버튼의 읽는 이름 Close→닫기, 변형 palette(검색 팔레트 — 위 12vh, 폭 560px, 높이 60vh까지, 안쪽 없이 세로로 쌓는다)를 더했다, Portal 없이 Overlay 뒤에 서는 창 DialogPopup을 따로 내보낸다. 가운데 창(default)은 w-full·max-w-[calc(100%-2rem)]·sm:max-w-sm→확인 창과 같은 330px·max-w-[calc(100%-4rem)](이름 바꾸기 창이 첫 쓰는 자리다). 변형 fullscreen(전체화면 뷰어 — 사방 36px 안쪽, 폭 1280px까지, 옛 뷰어의 모서리 14px, 안쪽 없이 세로로 쌓는다)을 더했다.
import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

// 가림막은 앱의 모든 모달이 쓰는 막(`modal-scrim`)이다 — 뒤를 흐리지 않고 어둡게만 한다.
function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "modal-scrim isolate duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

const dialogPopupVariants = cva(
  "fixed left-1/2 z-50 -translate-x-1/2 floating-card text-[13.5px] text-foreground duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
  {
    variants: {
      variant: {
        // 가운데의 작은 창(이름 바꾸기). 확인 창(`alert-dialog`)과 한 계열이라 자리·폭·안쪽이 그 창과 같다.
        default:
          "top-1/2 grid w-[330px] max-w-[calc(100%-4rem)] -translate-y-1/2 gap-4 p-4",
        // 검색 팔레트. 위쪽 12vh에 선다(확인 창은 가운데다). 첫 줄이 입력칸이고 나머지를 목록이
        // 채워 구르므로, 안쪽 여백 없이 세로로 쌓고 넘치는 것은 목록이 든다.
        palette:
          "top-[12vh] flex max-h-[60vh] w-[560px] max-w-[calc(100%-4rem)] flex-col overflow-hidden",
        // 전체화면 뷰어(다이어그램·표). 창 가장자리에서 사방 36px씩 물러선 큰 창이고, 넓은 창에서는 1280px에서
        // 멈춰 가운데에 선다. 머리 한 줄 아래를 본문이 채워 스스로 구르므로, 안쪽 여백 없이 세로로 쌓고 넘치는
        // 것은 본문이 든다. 모서리는 옛 뷰어의 14px이다.
        fullscreen:
          "inset-y-9 flex w-[calc(100%-4.5rem)] max-w-[1280px] flex-col overflow-hidden rounded-[14px]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

// **창만 그린다 — Portal과 가림막은 부르는 쪽이 둔다.** 보통은 셋을 함께 세우는 `DialogContent`를
// 쓴다. 창의 내용이 창과 함께 붙었다 떨어져야 하는 자리(검색 팔레트 — 떠 있는 동안에만 묻는다)는
// `DialogPortal` 안에서 이것을 그린다: Portal은 창이 떠 있는 동안(닫히는 애니메이션까지)만 자식을 세운다.
function DialogPopup({
  className,
  children,
  variant,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props &
  VariantProps<typeof dialogPopupVariants> & {
    showCloseButton?: boolean
  }) {
  return (
    <DialogPrimitive.Popup
      data-slot="dialog-content"
      // Base UI Dialog는 모달임을 바깥의 `aria-hidden`으로만 말한다 — 창 자신이 말하게 둔다(S31).
      aria-modal="true"
      className={cn(dialogPopupVariants({ variant, className }))}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          render={
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            />
          }
        >
          <XIcon
          />
          <span className="sr-only">닫기</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Popup>
  )
}

function DialogContent(props: React.ComponentProps<typeof DialogPopup>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPopup {...props} />
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("grid gap-1.5", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex justify-end gap-1.5", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          닫기
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-[14px] font-semibold tracking-[-0.01em]",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-[13px] leading-[1.6] text-tertiary *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
