import { Copy, FolderOpen, Pencil, Trash2 } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { ProjectView } from "./types";

/**
 * 프로젝트 메뉴가 부르는 동작 — **부르는 쪽이 넘긴다**(work 메뉴의 `WorkMenuActions` · 아카이브 메뉴와 같은 나눔). 메뉴는 무엇을 어떤
 * 차례로 보일지만 정하고, 부르는 길(IPC · 클립보드와 그 알림 · 확인 창 · 이름을 고칠 자리)은 메뉴를 다는 화면의 것이다.
 */
export interface ProjectMenuActions {
  /** 그 프로젝트 폴더를 Finder에서 연다 — 경로는 코어가 slug로 푼다(`open_project_folder`). */
  openFolder: () => void;
  /** 같은 폴더의 참조(`projectDirRef` — 끝에 `/`)를 클립보드에 쓰고 「… 복사됨」을 알린다. */
  copyPath: () => void;
  /** 그 프로젝트의 이름을 대상 자리(목록 행 · 머리 카드 이름)에서 고치기 시작한다. */
  rename: () => void;
  /** 확인 창을 거쳐 Atelier 목록에서 뺀다 — 코드 폴더는 그대로다. */
  remove: () => void;
}

/**
 * **대상 메뉴 「프로젝트」의 정의 — 한 자리다**(codex-ds 스펙 §9 대상 메뉴 표 · 결정 6 · 10, 티켓 30). 목록 행과 머리 카드 이름의
 * 우클릭이 이것을 편다. 항목은 메뉴 부품이라 우클릭 카드(`ContextMenu`) 안에서 그대로 선다(`context-menu.tsx` 머리말).
 *
 * 차례는 결정 10의 묶음이다 — 열기(Finder에서 열기 · 경로 복사) — 고치기(이름 바꾸기 F2) — 되돌릴 수 없는 것(제거). 「제거」는 확인
 * 창을 거친다(부르는 쪽의 흐름). 캔버스의 「LLM이 받는 텍스트」는 지금 앱에 없는 조작이라 숨긴다(codex-ds 스펙 S13 · 결정 10 「해당하지
 * 않는 항목은 숨긴다」). **폴더를 못 찾은 프로젝트**(`missing`)는 Finder 열기가 흐리다 — 열 것이 없다(결정 10 「지금 못 하는 항목은
 * 흐리게」, 머리 카드의 「폴더 열기」 잠김과 같다). 경로 복사는 등록된 경로라 선다.
 */
export function ProjectMenuItems({ project, actions }: { project: ProjectView; actions: ProjectMenuActions }) {
  return (
    <>
      <DropdownMenuItem disabled={project.missing} onClick={actions.openFolder}>
        <FolderOpen />
        <span className="min-w-0 flex-1 truncate">Finder에서 열기</span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={actions.copyPath}>
        <Copy />
        <span className="min-w-0 flex-1 truncate">경로 복사</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {/* 그 자리를 입력칸으로 바꾼다(codex-ds 스펙 §9) — 창이 뜨지 않는다. */}
      <DropdownMenuItem onClick={actions.rename} shortcut="rename">
        <Pencil />
        <span className="min-w-0 flex-1 truncate">이름 바꾸기</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={actions.remove}>
        <Trash2 />
        <span className="min-w-0 flex-1 truncate">제거</span>
      </DropdownMenuItem>
    </>
  );
}
