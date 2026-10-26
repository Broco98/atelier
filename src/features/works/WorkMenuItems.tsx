import { Archive, Copy, Folder, FolderOpen, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { specDirRef } from "./refs";
import { STATUS_META, StatusIcon } from "./status";
import type { WorkStatus, WorkView } from "./types";

/**
 * work 메뉴가 부르는 동작 — **부르는 쪽이 넘긴다.** 메뉴는 무엇을 어떤 차례로 보이고 무엇을 부를지만 정하고, 부르는 길(IPC ·
 * 클립보드 · 확인 창)은 메뉴 밖의 것이다. 아카이브 · 삭제의 흐름(바쁨 막기 → 띄운 프로세스 수 → 확인 창 → 주인 붙들기 →
 * 부르기 → 실패 알림 → 셸 닫기)은 `work-menu-actions.ts` 한 자리에 있고, 메뉴를 다는 자리 넷이 모두 그것을 받는다(codex-ds 스펙 §6).
 */
export interface WorkMenuActions {
  /** Finder에서 연다 — `null`이면 spec 폴더, 프로젝트 이름이면 그 worktree다. 경로는 백엔드가 푼다(codex-ds 스펙 S6). */
  openFolder: (project: string | null) => void;
  rename: () => void;
  /** 그 글자를 클립보드에 쓰고 「… 복사됨」을 알린다 — 화면의 다른 복사와 같은 길이다. */
  copy: (text: string) => void;
  /** 바뀐 상태만 온다 — 지금 상태를 다시 고르면 부르지 않는다(아래 `StatusRadioItems`). */
  setStatus: (status: WorkStatus) => void;
  setPinned: (pinned: boolean) => void;
  archive: () => void;
  remove: () => void;
}

/**
 * **work 메뉴의 흐름 한 벌** — 메뉴를 다는 자리가 받는 값이다(`work-menu-actions.ts`의 `useWorkMenuFlows`가 짓는다). 대상 work마다
 * 동작을 꺼낸다 — 대상은 고른 work가 아닐 수 있다(codex-ds 결정 7). 이름 바꾸기만은 메뉴를 다는 자리가 넘긴다: 그 이름을 그 자리에서
 * 고치는 입력칸(머리 줄 이름 · 사이드바 행)을 세우는 것이 그쪽이라서다(codex-ds 스펙 §9).
 */
export interface WorkMenuFlows {
  /** 아카이브 · 삭제가 하나라도 도는 중이다 — 그동안 work 메뉴는 열리지 않는다. */
  busy: boolean;
  actionsFor: (work: WorkView, rename: () => void) => WorkMenuActions;
}

/**
 * **대상 메뉴 「work」의 정의 — 한 자리다**(codex-ds 결정 6 · 16 · 스펙 §9). 머리 줄의 ⋯(`DropdownMenu`)와 우클릭 메뉴(`ContextMenu`
 * — 사이드바 행 · 알림 띠 줄 · 머리 줄 이름, `WorkContextMenu`)가 이것을 편다. 항목 · 구분선 · 하위 메뉴는 두 메뉴가 함께 쓰는
 * 부품이라(`context-menu.tsx` 머리말) 이 조각이 어느 쪽 카드 안에서도 그대로 선다. 훅이 없다 — 상태를 쥘 수 없는 자리(사이드바 행 —
 * `SidebarWorkList.test.tsx`의 훅 금지)에서도 펼 수 있게.
 *
 * 묶음은 다섯이고 사이는 구분선이다(codex-ds 결정 10): 열기 — 고치기 — 상태 — 정리 — 되돌릴 수 없는 것. 하위 메뉴는 한 단계다.
 * - **해당 없는 칸은 숨긴다.** 프로젝트가 없으면 Finder ▸에 worktree가, 브랜치가 아직 없으면(첫 프로젝트가 붙을 때 정해진다) 복사 ▸에
 *   브랜치 이름이 없다.
 * - **지금 못 하는 칸은 흐리다**(`disabled` — 눌리지 않고 `aria-disabled`). 폴더가 사라진 worktree가 그렇다.
 * - 단축키 칸은 「이름 바꾸기」의 F2 하나다 — 그 이름 자리(머리 줄 이름 · 사이드바 행)에 포커스를 두고 누르는 키다(실제로 있는
 *   단축키만 적는다, 결정 10).
 *
 * 줄의 글자 · 글리프는 부품의 것이다(DS `.at-mi` — 13px 400, 글리프 15px `fg-secondary`). 여기서 굵기나 크기를 덧칠하지 않는다 —
 * 상태 ▸의 글리프(지금 상태의 아이콘)만 제 크기(14)를 들고 있어 줄 글리프의 15로 맞춘다. 이름 뒤의 흐린 글자는 그 줄이 무엇을
 * 가리키는지 말한다(DS `.at-mi .d` — `fg-tertiary`).
 */
export function WorkMenuItems({ work, actions }: { work: WorkView; actions: WorkMenuActions }) {
  return (
    <>
      <FinderSubmenu work={work} actions={actions} />
      <DropdownMenuSeparator />
      {/* 「이름 바꾸기」는 그 work의 이름을 그 자리에서 입력칸으로 바꾼다(codex-ds 스펙 §9). 창이 뜨지 않는다. */}
      <DropdownMenuItem onClick={actions.rename} shortcut="rename">
        <Pencil />
        <span className="min-w-0 flex-1 truncate">이름 바꾸기</span>
      </DropdownMenuItem>
      <CopySubmenu work={work} actions={actions} />
      <DropdownMenuSeparator />
      {/* 머리 줄의 상태 배지와 같은 라디오다 — 줄 글리프는 지금 상태의 아이콘이다(DS `ContextMenu` 보드). */}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <StatusIcon status={work.status} className="size-3.75" />
          <span className="min-w-0 flex-1 truncate">상태</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <StatusRadioItems status={work.status} onChange={actions.setStatus} />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      {/* 사이드바 행의 핀과 같은 명령이다(`set_work_pinned`). */}
      <DropdownMenuItem onClick={() => actions.setPinned(!work.pinned)}>
        {work.pinned ? <PinOff /> : <Pin />}
        <span className="min-w-0 flex-1 truncate">{work.pinned ? "고정 풀기" : "고정"}</span>
      </DropdownMenuItem>
      {/* 되돌릴 수 없어 확인 창을 거친다 — 그 흐름은 부르는 쪽의 것이다(위 `WorkMenuActions`). */}
      <DropdownMenuItem onClick={actions.archive}>
        <Archive />
        <span className="min-w-0 flex-1 truncate">아카이브</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={actions.remove}>
        <Trash2 />
        <span className="min-w-0 flex-1 truncate">삭제</span>
      </DropdownMenuItem>
    </>
  );
}

/**
 * **「Finder에서 열기 ▸」 하위 메뉴** — spec 폴더와 Project마다의 worktree. work 메뉴와 요약 카드 머리의 「…」 메뉴(v1 티켓 34 · 구현 스펙 §15
 * 「뒤의 둘은 지금 Work 메뉴의 것이다」)가 같은 조각을 편다.
 */
export function FinderSubmenu({ work, actions }: { work: WorkView; actions: Pick<WorkMenuActions, "openFolder"> }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <FolderOpen />
        <span className="min-w-0 flex-1 truncate">Finder에서 열기</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => actions.openFolder(null)}>
          <Folder />
          <span className="min-w-0 flex-1 truncate">spec 폴더</span>
        </DropdownMenuItem>
        {/* worktree는 프로젝트마다 하나이고 `projects`에 적힌 순서다(코어가 1:1로 만든다). */}
        {work.worktrees.length > 0 && <DropdownMenuSeparator />}
        {work.worktrees.map((worktree) => (
          <DropdownMenuItem
            key={worktree.project}
            disabled={!worktree.exists}
            onClick={() => actions.openFolder(worktree.project)}
          >
            <Folder />
            <Named name={worktree.project} note="worktree" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** **「복사 ▸」 하위 메뉴** — slug · 브랜치 이름(정해졌으면) · spec 경로. work 메뉴와 요약 카드 머리의 「…」 메뉴가 같은 조각을 편다. */
export function CopySubmenu({ work, actions }: { work: WorkView; actions: Pick<WorkMenuActions, "copy"> }) {
  const branch = work.branch;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Copy />
        <span className="min-w-0 flex-1 truncate">복사</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => actions.copy(work.slug)}>
          <Copy />
          <Named name="slug" note={work.slug} />
        </DropdownMenuItem>
        {branch !== null && (
          <DropdownMenuItem onClick={() => actions.copy(branch)}>
            <Copy />
            <Named name="브랜치 이름" note={branch} />
          </DropdownMenuItem>
        )}
        {/* 참조 표기다(`refs.ts` — 끝에 `/`). 경로가 길어 줄에는 이름만 선다. */}
        <DropdownMenuItem onClick={() => actions.copy(specDirRef(work.slug))}>
          <Copy />
          <span className="min-w-0 flex-1 truncate">spec 경로</span>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * 이름과 그 뒤의 흐린 글자 한 줄. 하위 메뉴 카드는 220에서 멈추므로(`dropdown-menu.tsx`) 넘치면 둘 다 줄임표로 접힐 수 있고, 제
 * 길이에 비례해 줄어 긴 쪽이 더 접힌다 — 긴 것은 slug 값일 때도(복사 ▸), 프로젝트 이름일 때도(Finder ▸) 있다.
 */
function Named({ name, note }: { name: string; note: string }) {
  return (
    <>
      <span className="min-w-0 truncate">{name}</span>
      <span className="min-w-0 truncate text-fg-tertiary">{note}</span>
    </>
  );
}

/**
 * **상태 고르기 한 벌** — 머리 줄의 상태 배지 메뉴(`WorksPage`의 `StatusMenu`)와 work 메뉴의 상태 ▸가 이것을 편다. 줄은 진행
 * 순서(`STATUS_META`의 키 순서)이고, 지금 상태가 `aria-checked`다. 고르면 닫힌다(라디오 항목의 `closeOnClick`, S33).
 *
 * **값이 바뀔 때만 부른다**(지금 규칙). 부품은 지금 값을 다시 골라도 `onValueChange`를 부른다.
 */
export function StatusRadioItems({
  status,
  onChange,
}: {
  status: WorkStatus;
  onChange: (status: WorkStatus) => void;
}) {
  return (
    <DropdownMenuRadioGroup
      value={status}
      onValueChange={(next: WorkStatus) => {
        if (next !== status) onChange(next);
      }}
    >
      {(Object.keys(STATUS_META) as WorkStatus[]).map((value) => {
        const option = STATUS_META[value];
        return (
          // 글자 치기가 맞춰 볼 이름은 라벨이다 — 옆의 설명까지 섞이지 않게 적어 둔다.
          <DropdownMenuRadioItem key={value} value={value} label={option.label}>
            <span className={cn("size-[7px] shrink-0 rounded-full", option.dotClass)} />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            <span className="shrink-0 text-xs text-fg-tertiary">{option.desc}</span>
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}
