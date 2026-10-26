import { useState, type ReactNode, type Ref } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { dialogLook } from "@/components/ui/dialog-look";
import { cn } from "@/lib/utils";

// **빼기 · 지우기 창의 껍데기**(03 구현 스펙 §14 「지우기」 · §16 「제거 창」 · 시안 `.dlg.sm` · `.gcard`) — Project 제거 창과 Space 삭제 창이 함께
// 쓴다(03 코드 리뷰 D1). 확인 창(`AppDialog`)은 글만 받아 카드 줄을 품지 못해 따로 선 창이다(03 결정 11). 창 안의 글(제목 · 설명 · Work 줄)은
// 창마다 다르고 여기는 창 · 카드 줄 · 바닥 단추를 든다. 열고 닫는 흐름은 `useUndoableRemoval`이다.

/**
 * 창 하나 — `asking`이 서면 열린다. **닫히는 동안에도 마지막 물음을 그린다** — 글이 빈 창이 비치지 않게(`AppDialog`와 같은 까닭). 다 닫히면
 * 비운다. 바깥을 누르거나 Esc면 `onClose`다. `initialFocus`는 열 때의 첫 포커스다(되돌릴 수 있는 일이면 그 단추).
 */
export function RemovalDialog<A>({
  asking,
  onClose,
  initialFocus,
  children,
}: {
  asking: A | null;
  onClose: () => void;
  initialFocus: () => HTMLElement | null;
  children: (now: A) => ReactNode;
}) {
  const [shown, setShown] = useState(asking);
  if (asking !== null && asking !== shown) setShown(asking);
  const now = asking ?? shown;
  return (
    <AlertDialog
      open={asking !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setShown(null);
      }}
    >
      <AlertDialogContent initialFocus={initialFocus} onBackdropClick={onClose} className={dialogLook.topSmall}>
        {now !== null && children(now)}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 빼거나 지울 것 한 줄(시안 `.gcard` · `.grow`) — 글리프 · 이름과 그 아래 흐린 한 줄(Project는 경로라 고정폭 글자). **`min-w-0`이 창의 격자
 * 칸을 창 폭에 묶는다** — 없으면 말줄임하는 아래 줄의 한 줄 폭이 칸의 바닥이 되어, 긴 경로가 창 밖까지 칸을 밀고 바닥 단추가 창 밖으로
 * 나갔다(03 티켓 13d — 진짜 앱에서 봤다).
 */
export function RemovalCard({ icon: Icon, name, sub, mono = false }: { icon: LucideIcon; name: string; sub: string; mono?: boolean }) {
  return (
    <div className="flex min-h-12 min-w-0 items-center gap-2.5 rounded-xl border border-border px-3 py-2">
      <Icon aria-hidden className="size-4 shrink-0 text-fg-icon" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-fg">{name}</span>
        <span className={cn("truncate text-xs text-fg-tertiary", mono && "font-mono")}>{sub}</span>
      </span>
    </div>
  );
}

/** 바닥 단추 둘 — 닫기(옅은 알약)와 빼기 · 지우기(빨간 알약). 머리 줄 알약과 같은 28이다(시안 `.btn.gh` · `.btn.redf`). */
export function RemovalFooter({
  cancel,
  cancelRef,
  action,
  actionRef,
  disabled,
  onAction,
}: {
  cancel: string;
  cancelRef?: Ref<HTMLButtonElement>;
  action: string;
  actionRef: Ref<HTMLButtonElement>;
  disabled: boolean;
  onAction: () => void;
}) {
  return (
    <AlertDialogFooter className="pt-0.5">
      <AlertDialogCancel ref={cancelRef} variant="ghost" size="top" className="rounded-full">
        {cancel}
      </AlertDialogCancel>
      <AlertDialogAction ref={actionRef} variant="destructive" size="top" className="rounded-full" disabled={disabled} onClick={onAction}>
        {action}
      </AlertDialogAction>
    </AlertDialogFooter>
  );
}
