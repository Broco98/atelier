import { useRef, useState } from "react";
import { Layers } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { showProblem } from "@/components/ui/confirm-store";
import { showUndoToast } from "@/components/ui/toast";
import { spacesApi } from "./api";
import { useDeleteSpace, useRestoreSpace } from "./hooks";
import { deleteDialog, deletedToast, restoreSpaceProblem } from "./space-delete";
import { spaceName } from "./space-view";
import type { Space, SpaceUsage } from "./types";

// Space 지우기 확인 창(03 구현 스펙 §14 「지우기」 · 캔버스 F4-SpaceDelete · F4-KitSpace 「확인 창」) — Space 목록 줄 ⋯과 상세 ⋯의 「삭제…」가
// 연다. 글은 `deleteDialog`가 고르고 여기는 그린다. 창 상자는 Project 제거 창과 같은 시안 `.dlg.sm`(위에서 120 · 폭 420 · 모서리 20 · 안쪽
// 20/18/18 · 칸 사이 14)이다 — 확인 창(`AppDialog`)은 글만 받아 Space 카드 줄을 품지 못한다.

interface Deleting {
  space: Space;
  usage: SpaceUsage;
}

function SpaceDeleteDialog({
  deleting,
  busy,
  onClose,
  onDelete,
}: {
  /** 떠 있는 물음 — 없으면 닫혀 있다. */
  deleting: Deleting | null;
  /** 지우기를 부르는 중 — 두 번 누르지 않게 단추를 끈다. */
  busy: boolean;
  onClose: () => void;
  onDelete: (space: Space) => void;
}) {
  // 닫히는 동안에도 마지막 물음을 그린다 — 글이 빈 창이 비치지 않게(`ProjectRemoveDialog`와 같은 까닭). 다 닫히면 비운다.
  const [shown, setShown] = useState(deleting);
  if (deleting !== null && deleting !== shown) setShown(deleting);
  const now = deleting ?? shown;
  const dialog = now ? deleteDialog(now.space, now.usage) : null;
  const deleteRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog
      open={deleting !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setShown(null);
      }}
    >
      <AlertDialogContent
        // 첫 포커스는 「삭제」 — 토스트에서 되돌릴 수 있는 일이다(Project 제거 창과 같다).
        initialFocus={() => deleteRef.current}
        onBackdropClick={onClose}
        className="top-30 w-105 translate-y-0 gap-3.5 rounded-3xl px-4.5 pt-5 pb-4.5"
      >
        {now && dialog && (
          <>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            {/* 지울 Space 한 줄(시안 `.gcard` · `.grow`) — 이름과 그 Project. */}
            <div className="flex min-h-12 items-center gap-2.5 rounded-xl border border-border px-3 py-2">
              <Layers aria-hidden className="size-4 shrink-0 text-fg-icon" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-fg">{dialog.name}</span>
                <span className="truncate text-xs text-fg-tertiary">{dialog.projects}</span>
              </span>
            </div>
            <AlertDialogDescription className="text-chat-meta break-keep text-fg-secondary">{dialog.body}</AlertDialogDescription>
            <AlertDialogFooter className="pt-0.5">
              <AlertDialogCancel variant="ghost" size="top" className="rounded-full">
                취소
              </AlertDialogCancel>
              <AlertDialogAction
                ref={deleteRef}
                variant="destructive"
                size="top"
                className="rounded-full"
                disabled={busy}
                onClick={() => onDelete(now.space)}
              >
                삭제
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 지우기의 길 하나 — 목록과 상세가 함께 쓴다. `ask`가 쓰임을 읽어 확인 창을 열고, 「삭제」면 엔진이 지운 뒤(비운 곳마다 「지워짐」 줄) 창을
 * 닫고 `after`(상세는 목록으로 간다)를 부른 다음 「… Space를 지웠어요 · 되돌리기」 토스트를 낸다. 토스트는 그 화면의 `<Toaster>`에 선다.
 */
export function useSpaceDelete(after?: () => void) {
  const remove = useDeleteSpace();
  const restore = useRestoreSpace();
  const [deleting, setDeleting] = useState<Deleting | null>(null);

  const ask = async (space: Space) => {
    try {
      setDeleting({ space, usage: await spacesApi.usage(space.slug) });
    } catch (e) {
      await showProblem(`지우지 못했어요 — ${e}`);
    }
  };
  const confirm = async (space: Space) => {
    try {
      await remove.mutateAsync(space.slug);
    } catch (e) {
      setDeleting(null);
      await showProblem(`지우지 못했어요 — ${e}`);
      return;
    }
    setDeleting(null);
    after?.();
    showUndoToast(deletedToast(spaceName(space)), () => {
      restore.mutateAsync(space.slug).catch((e) => void showProblem(restoreSpaceProblem(String(e))));
    });
  };

  const dialog = (
    <SpaceDeleteDialog deleting={deleting} busy={remove.isPending} onClose={() => setDeleting(null)} onDelete={(space) => void confirm(space)} />
  );
  return { ask, dialog };
}
