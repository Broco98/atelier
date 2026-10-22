// 앱 규격으로 고친 자리: 가림막 bg-black/10·backdrop-blur-xs→modal-scrim(Codex `scrim`, 흐림 없음)과 가림막 클릭 onBackdropClick, Popup에 aria-modal 직접(S31), 카드 rounded-xl·ring·bg-popover→floating-card(index.css 한 곳 — 떠 있는 면 bg-surface-elevated)에 DS 확인 창(`.at-dialog`)의 모양 — 폭 400 · 안쪽 20 · `radius-4xl` · `shadow-modal`(prominent + 2xl)(size 변형을 걷었다), 머리 가운데 정렬→왼쪽 gap-2, 제목 text-base font-medium→heading-xs(16/24 · 600 — DS README 「글자」 표의 확인 창 제목), 설명 muted→fg-secondary·whitespace-pre-line(P4 — 글자는 registry의 text-sm 그대로이고 값은 DS 14/20이다), 바닥 회색 띠→오른쪽 정렬 gap-2 — 가림막·창 상자·가운데 자리·머리·제목·설명·바닥은 창(dialog)과 같은 값이라 두 파일이 dialog-look.ts 한 곳에서 읽는다(설명의 whitespace-pre-line만 여기 것이다), Action·Cancel은 카드 안 버튼(Button 기본 크기 32 — DS 확인 창의 `.at-btn.sm`)이고 Cancel의 변형 outline→secondary(옅은 면 `fill-soft` — DS 확인 창의 「취소」). 아이콘 칸(Media)의 바탕 bg-muted→bg-fill-soft(5% — 같은 값).
import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { dialogLook } from "@/components/ui/dialog-look"

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

// 가림막은 앱의 모든 모달이 쓰는 막(`modal-scrim`)이다 — 뒤를 흐리지 않고 어둡게만 한다. 창(dialog)과
// 같은 것이라 `dialogLook`에서 읽는다. 고정 위치에 z 50이라 Base UI의 내부 가림막(z 없음)보다 위에
// 그려져, 누르면 이 요소가 받는다.
function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(dialogLook.overlay, className)}
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
        // 창 상자와 가운데 자리 · 폭 · 안쪽은 이름 바꾸기 창(dialog의 default)과 같은 것이다.
        className={cn(dialogLook.popup, dialogLook.center, className)}
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
      className={cn(dialogLook.header, className)}
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
      className={cn(dialogLook.footer, className)}
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
        "mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-fill-soft *:[svg:not([class*='size-'])]:size-6",
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
      className={cn(dialogLook.title, className)}
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
      className={cn(dialogLook.description, "whitespace-pre-line", className)}
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

// 「취소」는 창을 닫는 버튼이다(Base UI Close). 누르면 창이 `onOpenChange(false)`로 알린다 — Esc와 같은 길이다.
function AlertDialogCancel({
  className,
  variant = "secondary",
  size,
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
