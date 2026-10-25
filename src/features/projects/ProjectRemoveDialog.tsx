import { useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Book, ChevronRight, Folder } from "lucide-react";
import { RemovalCard, RemovalDialog, RemovalFooter } from "@/components/catalog/RemovalDialog";
import { type Asking, useUndoableRemoval } from "@/components/catalog/undoable-removal";
import { AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { workDoor } from "@/routes/-work-search";
import { projectsApi } from "./api";
import { useRemoveProject, useRestoreProject } from "./hooks";
import { removeDialog, removedToast, restoreProblem } from "./project-remove";
import type { ProjectRemoval, ProjectUsage, ProjectView } from "./types";

// Project 제거 창(03 구현 스펙 §16 「제거 창」 · 캔버스 F4-ProjRemoveBlocked · F4-KitProject 「제거 창」) — Projects 목록 줄 ⋯의 「제거…」가 연다. 세
// 갈래(보통 · Space에 들어 있음 · 진행 중인 Work가 고침)와 그 글은 `removeDialog`가 고르고, 여기는 그린다. 창 · 카드 줄 · 바닥 단추와 열고 닫는
// 흐름은 Space 삭제 창과 같은 것이다(`@/components/catalog` — 03 코드 리뷰 D1).

type Removing = Asking<ProjectView, ProjectUsage>;

/**
 * 제거의 길 — 목록이 부른다. `ask`가 쓰임을 읽어 창을 열고, 「제거」면 core가 빼고 창을 닫은 뒤 「목록에서 뺐어요 — 이름 · 되돌리기」
 * 토스트를 낸다. 그사이 진행 중인 Work가 이 Project를 붙였으면 core가 막고(`blocked`) 창이 그 자리에서 막힌 갈래로 바뀐다. 폴더 · 파일 · git
 * 기록은 그대로다. 토스트는 목록의 `<Toaster>`에 선다.
 */
export function useProjectRemoval() {
  const remove = useRemoveProject();
  const restore = useRestoreProject();
  const removal = useUndoableRemoval<ProjectView, ProjectUsage, ProjectRemoval>({
    usage: (project) => projectsApi.usage(project.slug),
    remove: (project) => remove.mutateAsync(project.slug),
    blocked: (done) => (done.kind === "blocked" ? { spaces: [], works: done.works } : null),
    restore: (project) => restore.mutateAsync(project.slug),
    failed: "제거하지 못했어요",
    toast: (project) => removedToast(project.name),
    restoreProblem,
  });
  const dialog = (
    <ProjectRemoveDialog
      removing={removal.asking}
      busy={remove.isPending}
      onClose={removal.close}
      onRemove={(project) => void removal.confirm(project)}
    />
  );
  return { ask: removal.ask, dialog };
}

function ProjectRemoveDialog({
  removing,
  busy,
  onClose,
  onRemove,
}: {
  /** 떠 있는 물음 — 없으면 닫혀 있다. */
  removing: Removing | null;
  /** 제거를 부르는 중 — 두 번 누르지 않게 단추를 끈다. */
  busy: boolean;
  onClose: () => void;
  onRemove: (project: ProjectView) => void;
}) {
  const removeRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <RemovalDialog
      asking={removing}
      onClose={onClose}
      // 첫 포커스 — 물으면 「제거」(되돌릴 수 있는 일이다), 막혔으면 「닫기」.
      initialFocus={() => (removing && removeDialog(removing.usage).canRemove ? removeRef.current : closeRef.current)}
    >
      {(now) => {
        const dialog = removeDialog(now.usage);
        return (
          <>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            <RemovalCard icon={Book} name={now.item.name} sub={now.item.path} mono />
            <AlertDialogDescription render={<div />} className="flex flex-col gap-2 text-chat-meta break-keep text-fg-secondary">
              {dialog.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </AlertDialogDescription>
            {dialog.works.length > 0 && (
              <ul aria-label="이 Project를 고치는 Work" className="flex flex-col overflow-hidden rounded-xl border border-border">
                {dialog.works.map((work) => (
                  <li key={work.slug} className="border-t-[0.5px] border-separator first:border-t-0">
                    {/* 누르면 그 Work로 — 창을 닫고 간다(스토리 132). 그 Work의 마지막 화면이다(`workDoor`, 03 코드 리뷰 A1). */}
                    <Link
                      {...workDoor(work.slug)}
                      // WebKit의 Tab은 맨 링크에 서지 않는다 — `tabIndex`를 명시한다(목록 줄의 이름과 같다).
                      tabIndex={0}
                      onClick={onClose}
                      className="flex min-h-10.5 items-center gap-2.5 px-3 py-2 text-sm text-fg transition-colors hover:bg-fill-soft focus-ring"
                    >
                      <Folder aria-hidden className="size-4 shrink-0 text-fg-icon" />
                      <span className="min-w-0 flex-1 truncate">{work.title}</span>
                      {work.branch && <span className="min-w-0 truncate font-mono text-xs text-fg-tertiary">{work.branch}</span>}
                      <ChevronRight aria-hidden className="size-3 shrink-0 text-fg-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <RemovalFooter
              cancel={dialog.cancel}
              cancelRef={closeRef}
              action="제거"
              actionRef={removeRef}
              disabled={!dialog.canRemove || busy}
              onAction={() => onRemove(now.item)}
            />
          </>
        );
      }}
    </RemovalDialog>
  );
}
