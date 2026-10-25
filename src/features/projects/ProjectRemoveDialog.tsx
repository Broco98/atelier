import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Book, ChevronRight, Folder } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { dialogLook } from "@/components/ui/dialog-look";
import { workDoor } from "@/routes/-work-search";
import { removeDialog } from "./project-remove";
import type { ProjectUsage, ProjectView } from "./types";

// Project 제거 창(03 구현 스펙 §16 「제거 창」 · 캔버스 F4-ProjRemoveBlocked · F4-KitProject 「제거 창」) — Projects 목록 줄 ⋯의 「제거…」가 연다. 세
// 갈래(보통 · Space에 들어 있음 · 진행 중인 Work가 고침)와 그 글은 `removeDialog`가 고르고, 여기는 그린다.
//
// 창 상자는 위에서 120에 서는 작은 창이다(`dialogLook.topSmall` — 시안 `.dlg.sm`). 확인 창(`AppDialog`)은 글만 받아 Project 카드 줄과 Work 줄을
// 품지 못해 이 창을 따로 둔다. 바닥 단추는 머리 줄 알약과 같은 28 알약이다(시안 `.btn.gh` · `.btn.redf`).

export interface Removing {
  project: ProjectView;
  usage: ProjectUsage;
}

export default function ProjectRemoveDialog({
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
  // 닫히는 동안에도 마지막 물음을 그린다 — 글이 빈 창이 비치지 않게(`AppDialog`와 같은 까닭). 다 닫히면 비운다.
  const [shown, setShown] = useState(removing);
  if (removing !== null && removing !== shown) setShown(removing);
  const now = removing ?? shown;
  const dialog = now ? removeDialog(now.usage) : null;
  const removeRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  return (
    <AlertDialog
      open={removing !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onOpenChangeComplete={(open) => {
        if (!open) setShown(null);
      }}
    >
      <AlertDialogContent
        // 첫 포커스 — 물으면 「제거」(되돌릴 수 있는 일이다), 막혔으면 「닫기」.
        initialFocus={() => (dialog?.canRemove ? removeRef.current : closeRef.current)}
        onBackdropClick={onClose}
        className={dialogLook.topSmall}
      >
        {now && dialog && (
          <>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            <ProjectCard project={now.project} />
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
                      // WebKit의 Tab은 맨 링크에 서지 않는다 — `tabIndex`를 명시한다(`ProjectsPage`의 줄 이름과 같다).
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
            <AlertDialogFooter className="pt-0.5">
              <AlertDialogCancel ref={closeRef} variant="ghost" size="top" className="rounded-full">
                {dialog.cancel}
              </AlertDialogCancel>
              <AlertDialogAction
                ref={removeRef}
                variant="destructive"
                size="top"
                className="rounded-full"
                disabled={!dialog.canRemove || busy}
                onClick={() => onRemove(now.project)}
              >
                제거
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 지울 Project 한 줄(시안 `.gcard` · `.grow`) — 이름과 경로. **`min-w-0`이 창의 격자 칸을 창 폭에 묶는다** — 없으면 말줄임하는 경로의
 * 한 줄 폭이 칸의 바닥이 되어, 긴 경로가 창 밖까지 칸을 밀고 바닥 단추가 창 밖으로 나갔다(03 티켓 13d — 진짜 앱에서 봤다).
 */
function ProjectCard({ project }: { project: ProjectView }) {
  return (
    <div className="flex min-h-12 min-w-0 items-center gap-2.5 rounded-xl border border-border px-3 py-2">
      <Book aria-hidden className="size-4 shrink-0 text-fg-icon" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-fg">{project.name}</span>
        <span className="truncate font-mono text-xs text-fg-tertiary">{project.path}</span>
      </span>
    </div>
  );
}
