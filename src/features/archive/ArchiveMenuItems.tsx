import { Copy, FolderOpen } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/**
 * 아카이브 메뉴가 부르는 동작 — **부르는 쪽이 넘긴다**(work 메뉴의 `WorkMenuActions`와 같은 나눔). 메뉴는 무엇을 어떤 차례로 보일지만
 * 정하고, 부르는 길(IPC · 클립보드와 그 알림)은 메뉴를 다는 자리의 것이다.
 */
export interface ArchiveMenuActions {
  /** 그 아카이브의 spec 폴더를 Finder에서 연다 — 경로는 백엔드가 slug로 푼다(codex-ds 스펙 S6). */
  openFolder: () => void;
  /** 같은 폴더의 경로(`archiveSpecDirRef`)를 클립보드에 쓰고 「… 복사됨」을 알린다 — 화면의 다른 복사와 같은 길이다. */
  copyPath: () => void;
}

/**
 * **대상 메뉴 「Archive 목록 행」의 정의 — 한 자리다**(codex-ds 결정 6 · 16 · 스펙 §9). Archive 머리 줄의 ⋯와 목록 행의 우클릭 ·
 * ⇧F10(`TargetMenu`)이 같은 이것을 편다. 항목은 메뉴 부품이라 ⋯(`DropdownMenu`)과 우클릭(`ContextMenu`) 어느 카드 안에서도 그대로
 * 선다(`context-menu.tsx` 머리말). 훅이 없다 — 행 목록처럼 상태를 쥐지 않는 자리에서도 펼 수 있게.
 *
 * 항목은 Finder에서 열기 · 경로 복사 둘이고 한 묶음이다(결정 16의 「열기 · 보기」). 결정 16 표의 「되살리기」는 숨긴다 — 지금 앱(core ·
 * IPC · MCP)에 그 동작이 없다(codex-ds 결정 31 · 결정 10 「해당하지 않는 항목은 숨긴다」).
 */
export function ArchiveMenuItems({ actions }: { actions: ArchiveMenuActions }) {
  return (
    <>
      <DropdownMenuItem onClick={actions.openFolder}>
        <FolderOpen />
        <span className="min-w-0 flex-1 truncate">Finder에서 열기</span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={actions.copyPath}>
        <Copy />
        <span className="min-w-0 flex-1 truncate">경로 복사</span>
      </DropdownMenuItem>
    </>
  );
}
