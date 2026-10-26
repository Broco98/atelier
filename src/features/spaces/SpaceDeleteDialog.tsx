import { useRef } from "react";
import { Layers } from "lucide-react";
import { RemovalCard, RemovalDialog, RemovalFooter } from "@/components/catalog/RemovalDialog";
import { type Asking, useUndoableRemoval } from "@/components/catalog/undoable-removal";
import { AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { spacesApi } from "./api";
import { useDeleteSpace, useRestoreSpace } from "./hooks";
import { deleteDialog, deletedToast, restoreSpaceProblem } from "./space-delete";
import { spaceName } from "./space-view";
import type { DeletedSpace, Space, SpaceUsage } from "./types";

// Space 지우기 확인 창(03 구현 스펙 §14 「지우기」 · 캔버스 F4-SpaceDelete · F4-KitSpace 「확인 창」) — Space 목록 줄 ⋯과 상세 ⋯의 「삭제…」가
// 연다. 글은 `deleteDialog`가 고르고 여기는 그린다. 창 · 카드 줄 · 바닥 단추와 열고 닫는 흐름은 Project 제거 창과 같은 것이다
// (`@/components/catalog` — 03 코드 리뷰 D1).

type Deleting = Asking<Space, SpaceUsage>;

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
  const deleteRef = useRef<HTMLButtonElement>(null);
  return (
    // 첫 포커스는 「삭제」 — 토스트에서 되돌릴 수 있는 일이다(Project 제거 창과 같다).
    <RemovalDialog asking={deleting} onClose={onClose} initialFocus={() => deleteRef.current}>
      {(now) => {
        const dialog = deleteDialog(now.item, now.usage);
        return (
          <>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            {/* 지울 Space 한 줄 — 이름과 그 Project. */}
            <RemovalCard icon={Layers} name={dialog.name} sub={dialog.projects} />
            <AlertDialogDescription className="text-chat-meta break-keep text-fg-secondary">{dialog.body}</AlertDialogDescription>
            <RemovalFooter cancel="취소" action="삭제" actionRef={deleteRef} disabled={busy} onAction={() => onDelete(now.item)} />
          </>
        );
      }}
    </RemovalDialog>
  );
}

/**
 * 지우기의 길 하나 — 목록과 상세가 함께 쓴다. `ask`가 쓰임을 읽어 확인 창을 열고, 「삭제」면 엔진이 지운 뒤(비운 곳마다 「지워짐」 줄) 창을
 * 닫고 `after`(상세는 목록으로 간다)를 부른 다음 「… Space를 지웠어요 · 되돌리기」 토스트를 낸다. 토스트는 그 화면의 `<Toaster>`에 선다.
 */
export function useSpaceDelete(after?: () => void) {
  const remove = useDeleteSpace();
  const restore = useRestoreSpace();
  const removal = useUndoableRemoval<Space, SpaceUsage, DeletedSpace>({
    usage: (space) => spacesApi.usage(space.slug),
    remove: (space) => remove.mutateAsync(space.slug),
    restore: (space) => restore.mutateAsync(space.slug),
    failed: "지우지 못했어요",
    toast: (space) => deletedToast(spaceName(space)),
    restoreProblem: restoreSpaceProblem,
    after,
  });
  const dialog = (
    <SpaceDeleteDialog
      deleting={removal.asking}
      busy={remove.isPending}
      onClose={removal.close}
      onDelete={(space) => void removal.confirm(space)}
    />
  );
  return { ask: removal.ask, dialog };
}
