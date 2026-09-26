// 앱 규격으로 고친 자리: 가림막 bg-black/10·backdrop-blur-xs→modal-scrim(25% 검정, 흐림 없음)과 가림막 클릭 onBackdropClick, Popup에 aria-modal 직접(S31), 카드 rounded-xl·ring·bg-popover→13px·border-strong·shadow-lg·bg-background에 폭 330px(size 변형을 걷었다), 머리 가운데 정렬→왼쪽 gap-1.5, 제목 text-base font-medium→14px semibold, 설명 text-sm·muted→13px·leading-1.6·tertiary·whitespace-pre-line(P4), 바닥 회색 띠→오른쪽 정렬 gap-1.5.
import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { cn } from "cn"

import { Button } from "@/components/ui/button"

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

// 가림막은 앱의 모든 모달이 쓰는 막(`modal-scrim`)이다 — 뒤를 흐리지 않고 어둡게만 한다.
// 고정 위치에 z 50이라 Base UI의 내부 가림막(z 없음)보다 위에 그려져, 누르면 이 요소가 받는다.
function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "modal-scrim isolate duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

// **가림막과 창은 형제다.** 창은 스스로 가운데에 선다 — 가림막이 창을 싸면 가림막 위의 클릭이
// 감싸개로 가서 창 안의 클릭과 갈리지 않는다.
//
// AlertDialog는 바깥 누르기로 닫히지 않는다(Base UI가 막아 둔다). 가림막을 눌러 답하는 창이면
// `onBackdropClick`으로 받는다.
function AlertDialogContent({
  className,
  onBackdropClick,
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  onBackdropClick?: React.MouseEventHandler<HTMLDivElement>
}) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay onClick={onBackdropClick} />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        // Base UI Dialog는 모달임을 바깥의 `aria-hidden`으로만 말한다 — 창 자신이 말하게 둔다(S31).
        aria-modal="true"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[330px] max-w-[calc(100%-4rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[13px] border border-border-strong bg-background p-4 text-foreground shadow-lg duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("grid gap-1.5", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex justify-end gap-1.5", className)}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-10 items-center justify-center rounded-md bg-muted *:[svg:not([class*='size-'])]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "text-[14px] font-semibold tracking-[-0.01em]",
        className
      )}
      {...props}
    />
  )
}

// 본문 속 줄바꿈(`\n`)은 줄바꿈으로 선다(P4) — 물음과 대가(「셸 N개가 닫혀요」)가 다른 줄이다.
function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-[13px] leading-[1.6] whitespace-pre-line text-tertiary *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="alert-dialog-action"
      className={cn(className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
