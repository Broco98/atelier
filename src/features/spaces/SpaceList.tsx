import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Book, ChevronRight, Layers, Search } from "lucide-react";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { navItem } from "@/components/shell/nav-items";
import { cn } from "@/lib/utils";
import { useSpaces } from "./hooks";
import { spaceName } from "./space-view";
import type { Space } from "./types";

// Space 목록(03 구현 스펙 §14 · 시안 F1-Space) — 사람 메뉴 「Space」가 여는 화면이다. 머리 줄 「Space」, 판 안에 제목 · 찾기 칸과 표(이름 ·
// Project · 설명), 표 아래 한 줄 안내. 줄을 누르면 상세다. 문제가 있는 Space도 이름 뒤 「문제 있음」으로 선다(스토리 185). 파일은 바깥에서도
// 고치므로 `spaces:changed`를 듣는다(`useSpaces`).
//
// 「새 Space ⌄」(04 · 06)와 줄 ⋯(관계 편집 04 · 삭제 07)는 그 티켓이 단다.

/** 표의 칸 — 이름 · Project · 설명 · 끝 칸(⋯ 자리). 머리 줄과 몸 줄이 같은 격자다(시안 `.th` · `.srow`). */
const COLUMNS = "grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.5fr)_28px] items-center gap-4 pr-2.5 pl-3.5";

export default function SpaceList() {
  const { data: spaces = [], isPending } = useSpaces();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => spaces.filter((space) => matches(space, query)), [spaces, query]);
  const label = navItem("spaces").label;

  return (
    <PlainFrame label={label} title={{ name: label }}>
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
        </header>
        {!isPending && spaces.length === 0 ? (
          <p className="px-3.5 py-6 text-sm text-fg-tertiary">아직 Space가 없어요</p>
        ) : (
          <div role="table" aria-label="Space 목록" className="flex flex-col">
            <div role="row" className={cn(COLUMNS, "h-7.5 text-xs text-fg-tertiary")}>
              <span role="columnheader">이름</span>
              <span role="columnheader">Project</span>
              <span role="columnheader">설명</span>
              <span role="columnheader" aria-hidden />
            </div>
            {shown.map((space) => (
              <SpaceRow key={space.slug} space={space} />
            ))}
            {/* 마지막 줄 아래 선 — 줄마다 위 선이라 끝에 한 줄 더 둔다(시안 `.pend`). */}
            <div aria-hidden className="mx-2.5 h-[0.5px] bg-separator" />
          </div>
        )}
        <p className="px-3.5 text-xs text-fg-tertiary">Space는 Project를 묶어요. Agent는 Space 안의 Project를 함께 읽어요.</p>
      </div>
    </PlainFrame>
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
 * 전체가 상세로 가는 링크다.
 */
function SpaceRow({ space }: { space: Space }) {
  const problems = space.problems.length > 0;
  return (
    <Link
      to="/spaces/$slug"
      params={{ slug: space.slug }}
      role="row"
      className={cn(
        COLUMNS,
        "group/row relative h-12 rounded-xl text-sm text-fg transition-colors hover:bg-fill-soft focus-ring",
        "before:absolute before:inset-x-2.5 before:top-0 before:h-[0.5px] before:bg-separator hover:before:opacity-0",
      )}
    >
      <span role="cell" className="flex min-w-0 items-center gap-2.5">
        <Layers aria-hidden className="size-4 shrink-0 text-fg-icon" />
        <span className="min-w-0 truncate">{spaceName(space)}</span>
        {problems && <span className="tag text-xs text-danger">문제 있음</span>}
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-titlebar opacity-0 group-hover/row:opacity-100" />
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
      <span role="cell" aria-hidden />
    </Link>
  );
}
