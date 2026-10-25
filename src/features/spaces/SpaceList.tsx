import { useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Book, ChevronDown, ChevronRight, Layers, Plus, Search, SquareM, SquarePen } from "lucide-react";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { navItem } from "@/components/shell/nav-items";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useSpaces } from "./hooks";
import { SpaceActions } from "./SpaceActions";
import { useSpaceDelete } from "./SpaceDeleteDialog";
import { HOST_MAKE, spaceName } from "./space-view";
import type { Space } from "./types";

// Space 목록(03 구현 스펙 §14 · 시안 F1-Space) — 사람 메뉴 「Space」가 여는 화면이다. 머리 줄 「Space」, 판 안에 제목 · 찾기 칸과 표(이름 ·
// Project · 설명), 표 아래 한 줄 안내. 줄을 누르면 상세다. 문제가 있는 Space도 이름 뒤 「문제 있음」으로 선다(스토리 185). 파일은 바깥에서도
// 고치므로 `spaces:changed`를 듣는다(`useSpaces`).
//
// 머리 줄 「새 Space ⌄」는 두 길의 메뉴다(§14 · F4-SpaceNewMenu) — 「Host와 만들기」(기본 — Work 없는 새 대화에 맡기는 말을 넣어 연다, S16)와
// 「직접 만들기」(빈 틀의 Space 파일을 고치기 화면에 연다 — `/spaces/new`, 04). 줄 끝 ⋯는 「관계 편집 · 삭제…」다(07) — 지우면 확인 창을
// 거쳐 「… Space를 지웠어요 · 되돌리기」 토스트가 본문 아래 가운데 선다.

/** 표의 칸 — 이름 · Project · 설명 · 끝 칸(⋯ 자리). 머리 줄과 몸 줄이 같은 격자다(시안 `.th` · `.srow`). */
const COLUMNS = "grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.5fr)_28px] items-center gap-4 pr-2.5 pl-3.5";

export default function SpaceList() {
  const { data: spaces = [], isPending } = useSpaces();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => spaces.filter((space) => matches(space, query)), [spaces, query]);
  const label = navItem("spaces").label;
  const removing = useSpaceDelete();

  return (
    <PlainFrame label={label} title={{ name: label }}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4.5 overflow-y-auto px-10 pt-7.5 pb-10 scroll-quiet">
          <header className="flex min-h-8 items-center gap-2.5">
            <h1 className="text-heading-md text-fg">{label}</h1>
            <label className="ml-auto flex h-7.5 w-60 items-center gap-1.5 rounded-full border border-border-heavy px-3 text-fg-tertiary focus-ring">
              <Search aria-hidden className="size-3.5 shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Space 찾기"
                aria-label="Space 찾기"
                className="min-w-0 flex-1 bg-transparent text-chat-meta text-fg outline-none placeholder:text-fg-tertiary"
              />
            </label>
            <NewSpaceButton />
          </header>
          {!isPending && spaces.length === 0 ? (
            // S15 — 빈 목록은 안내 한 줄과 「새 Space」(머리 줄과 같은 길)다.
            <div className="flex flex-col items-start gap-3 px-3.5 py-6">
              <p className="text-sm text-fg-tertiary">아직 Space가 없어요</p>
              <NewSpaceButton />
            </div>
          ) : (
            <div role="table" aria-label="Space 목록" className="flex flex-col">
              <div role="row" className={cn(COLUMNS, "h-7.5 text-xs text-fg-tertiary")}>
                <span role="columnheader">이름</span>
                <span role="columnheader">Project</span>
                <span role="columnheader">설명</span>
                <span role="columnheader" aria-hidden />
              </div>
              {shown.map((space) => (
                <SpaceRow key={space.slug} space={space} onDelete={(one) => void removing.ask(one)} />
              ))}
              {/* 마지막 줄 아래 선 — 줄마다 위 선이라 끝에 한 줄 더 둔다(시안 `.pend`). */}
              <div aria-hidden className="mx-2.5 h-[0.5px] bg-separator" />
            </div>
          )}
          <p className="px-3.5 text-xs text-fg-tertiary">Space는 Project를 묶어요. Agent는 Space 안의 Project를 함께 읽어요.</p>
        </div>
        {/* 지운 뒤의 「되돌리기」가 여기 선다 — 본문 아래 가운데(시안 `.toast`). 상세에서 지우고 목록으로 와도 같은 자리다. */}
        <Toaster />
        {removing.dialog}
      </div>
    </PlainFrame>
  );
}

/**
 * 「새 Space ⌄」 — 짙은 알약(시안 F1-Space `.btn.pri`)이 메뉴를 연다(F4-SpaceNewMenu — 단추 오른쪽 끝에 맞춰 아래 6). 「Host와 만들기」(끝에
 * 「기본」)는 첫 화면을 「Work 없이 대화」와 맡기는 말로 열고 보내기는 사람이 한다(S16), 「직접 만들기」는 빈 틀의 고치기 화면이다.
 */
function NewSpaceButton() {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={buttonVariants({ size: "top", className: "shrink-0 rounded-full" })}>
        <Plus aria-hidden />새 Space
        <ChevronDown aria-hidden className="size-3 opacity-70" />
      </DropdownMenuTrigger>
      {/* 폭은 시안 그대로 308이고 설명은 낱말 단위로 두 줄에 접힌다(F4-SpaceNewMenu `.pop{min-width:300px}` — 단추에 붙은 칸이라 내용 폭으로 넓어지지 않는다). */}
      <DropdownMenuContent side="bottom" align="end" sideOffset={6} width="note" className="w-77">
        <DropdownMenuItem
          size="note"
          aria-description="Host가 Project를 읽고 초안을 내요 — 승인하면 만들어져요"
          onClick={() => void navigate({ to: "/", search: HOST_MAKE })}
        >
          <SquarePen className="mt-0.5" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">Host와 만들기</span>
            <span className="text-xs break-keep text-fg-tertiary">Host가 Project를 읽고 초안을 내요 — 승인하면 만들어져요</span>
          </span>
          <span className="shrink-0 pl-3 text-xs text-fg-tertiary">기본</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          size="note"
          aria-description="Space 파일을 빈 틀로 열어요 — 이름과 Project를 적어요"
          onClick={() => void navigate({ to: "/spaces/new" })}
        >
          <SquareM className="mt-0.5" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">직접 만들기</span>
            <span className="text-xs break-keep text-fg-tertiary">Space 파일을 빈 틀로 열어요 — 이름과 Project를 적어요</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 찾기 — 이름 · slug · Project · 설명 가운데 하나라도 그 글을 품으면 남는다(대소문자 무시). */
function matches(space: Space, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [space.name, space.slug, space.description, ...space.projects].some((one) => one.toLowerCase().includes(needle));
}

/**
 * 표의 줄 하나 — 48 · 둥글기 12, 줄 위에 0.5 선(옆 10 들여), 지나면 옅은 면과 이름 끝 꺾쇠가 서고 위아래 선이 숨는다(시안 `.srow`). 줄
 * 어디를 눌러도 상세다 — 이름이 그 링크이고(키보드는 이름에 선다), 줄의 누름은 끝의 ⋯가 아닐 때만 상세로 간다(Projects 목록과 같은 꼴 —
 * 링크 안에 단추를 둘 수 없다).
 */
function SpaceRow({ space, onDelete }: { space: Space; onDelete: (space: Space) => void }) {
  const problems = space.problems.length > 0;
  const navigate = useNavigate();
  // 줄의 누름 — 줄 안 단추 · 링크와 메뉴(포털로 떠도 React 나무로는 줄 안이라 누름이 올라온다)에서 온 것은 제 일만 한다.
  const openFromRow = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (!event.currentTarget.contains(target) || target.closest("a, button")) return;
    void navigate({ to: "/spaces/$slug", params: { slug: space.slug } });
  };
  return (
    <div
      role="row"
      onClick={openFromRow}
      className={cn(
        COLUMNS,
        "group/row relative h-12 rounded-xl text-sm text-fg transition-colors hover:bg-fill-soft",
        "before:absolute before:inset-x-2.5 before:top-0 before:h-[0.5px] before:bg-separator hover:before:opacity-0",
      )}
    >
      <span role="cell" className="flex min-w-0 items-center">
        <Link
          to="/spaces/$slug"
          params={{ slug: space.slug }}
          className="-mx-1 flex min-w-0 items-center gap-2.5 rounded-md px-1 focus-ring"
        >
          <Layers aria-hidden className="size-4 shrink-0 text-fg-icon" />
          <span className="min-w-0 truncate">{spaceName(space)}</span>
          {problems && <span className="tag text-xs text-danger">문제 있음</span>}
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-titlebar opacity-0 group-hover/row:opacity-100" />
        </Link>
      </span>
      <span role="cell" className="flex min-w-0 items-center gap-1.5 overflow-hidden text-chat-meta whitespace-nowrap text-fg-secondary">
        {space.projects.map((project) => (
          <span key={project} className="inline-flex items-center gap-1">
            <Book aria-hidden className="size-3 shrink-0 text-fg-subtle" />
            {project}
          </span>
        ))}
      </span>
      <span role="cell" className="line-clamp-2 text-xs text-fg-tertiary">
        {space.description}
      </span>
      <span role="cell" className="flex justify-end">
        <SpaceActions space={space} onDelete={onDelete} />
      </span>
    </div>
  );
}
