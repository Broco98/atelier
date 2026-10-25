import { useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Book, ChevronRight, Layers, Plus, Search } from "lucide-react";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { navItem } from "@/components/shell/nav-items";
import { buttonVariants } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useSpaces } from "./hooks";
import { SpaceActions } from "./SpaceActions";
import { useSpaceDelete } from "./SpaceDeleteDialog";
import { spaceName } from "./space-view";
import type { Space } from "./types";

// Space 목록(03 구현 스펙 §14 · 시안 F1-Space) — 사람 메뉴 「Space」가 여는 화면이다. 머리 줄 「Space」, 판 안에 제목 · 찾기 칸과 표(이름 ·
// Project · 설명), 표 아래 한 줄 안내. 줄을 누르면 상세다. 문제가 있는 Space도 이름 뒤 「문제 있음」으로 선다(스토리 185). 파일은 바깥에서도
// 고치므로 `spaces:changed`를 듣는다(`useSpaces`).
//
// 머리 줄 「새 Space」는 빈 틀의 Space 파일을 고치기 화면에 연다(직접 만들기 — `/spaces/new`, 04). 06이 이 단추를 「Host와 만들기 ·
// 직접 만들기」 메뉴로 바꾼다. 줄 끝 ⋯는 「관계 편집 · 삭제…」다(07) — 지우면 확인 창을 거쳐 「… Space를 지웠어요 · 되돌리기」 토스트가 본문
// 아래 가운데 선다.

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

/** 「새 Space」 — 짙은 알약(시안 F1-Space `.btn.pri`). 직접 만들기 화면으로 간다. */
function NewSpaceButton() {
  return (
    <Link to="/spaces/new" className={buttonVariants({ size: "top", className: "shrink-0 rounded-full" })}>
      <Plus aria-hidden />새 Space
    </Link>
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
