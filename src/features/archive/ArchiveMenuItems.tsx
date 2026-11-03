import { Copy, FolderOpen } from "lucide-react";
import { copyText } from "@/components/shell/copy-text";
import { openInFinder } from "@/components/shell/open-in-finder";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { archiveSpecDirRef } from "@/features/works/refs";
import { archiveApi } from "./api";

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
 * 아카이브된 work의 spec 폴더를 Finder에서 연다(codex-ds 스펙 S6) — 메뉴의 「Finder에서 열기」와 상세 머리의 「Finder에서 열기」가 부른다. 못 열면
 * (폴더가 없는 아카이브 등) 백엔드가 돌려준 문장을 「못 한 일」 토스트로 알린다 — 앱의 Finder 열기가 모두 그 한 길이다(`openInFinder`).
 */
export function openArchivedSpecFolder(slug: string): void {
  openInFinder(() => archiveApi.openSpecFolder(slug));
}

/** 그 아카이브로 부르는 메뉴 동작 — 목록 줄의 ⋯와 상세 머리의 ⋯가 같은 한 벌을 쓴다. */
export function archiveMenuActions(slug: string): ArchiveMenuActions {
  return {
    openFolder: () => openArchivedSpecFolder(slug),
    // 「Finder에서 열기」가 여는 폴더의 참조다(`refs.ts` — 끝에 `/`).
    copyPath: () => copyText(archiveSpecDirRef(slug)),
  };
}

/**
 * **Archive ⋯ 메뉴의 정의 — 한 자리다**(codex-ds 결정 6 · 16 · 스펙 §9 · restart 03-4 · 보드 Places `MENUS.archive`). 목록 줄의 ⋯와 상세 머리의 ⋯가
 * 같은 이것을 편다. 훅이 없다 — 상태를 쥐지 않는 자리에서도 펼 수 있게. 한때 목록 행의 우클릭 · ⇧F10(`TargetMenu`)도 이것을 폈다 — 목록 틀의
 * 줄(`PlaceRow`)은 ⋯ 하나다(Projects 줄과 같다).
 *
 * 항목은 Finder에서 열기 · 경로 복사 둘이고 한 묶음이다(결정 16의 「열기 · 보기」 · PlaceSheet 「⋯ 메뉴」). 「되살리기」는 숨긴다 — 지금 앱(core ·
 * IPC · MCP)에 그 동작이 없다(codex-ds 결정 31 · 스펙 「03 — 목록과 상세」).
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
