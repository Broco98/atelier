import { createContext, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode, type Ref } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ArrowDown, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toast";
import { HOTKEYS, pressed } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import type { PlaceSort } from "./place-list";

// **공용 목록 틀**(restart 03-1 · 스펙 「03 — 목록과 상세」 · 스토리 107 – 113 · 보드 PlaceSheet 「규격」 · 「목록 상태」 · 「움직임과 조작」 · Places) —
// Projects · Services · Archive가 한 틀을 쓴다. 목록은 이름과 시각만 보여 빠르게 고르고, 줄을 누르면 상세로 들어간다. 여기는 그리기만 하고
// 줄 안의 것(이름 옆 글 · 오른쪽 단추 · ⋯ 항목)과 줄의 차례는 화면이 준다(차례 · 시각 글은 `place-list.ts`).
//
//   판(`PlaceList`) ─ 스스로 구른다. 가운데 열 최대 1120 · 위 36 · 옆 56 · 아래 56(보드 `.pl-col`)
//     머리 ─ 제목 24/32 · 600, 찾기 칸 240 × 34, 주 단추 34(보드 `.pl-head`)
//     표(`PlaceTable`) ─ 열 머리 36 · 12 · 활성 칸만 화살표, 줄 64 · 0.5 선 · 아이콘 15 · 이름 14(보드 `.pl-th` · `.pl-row`)
//   자리(`PlaceStage`) ─ 목록과 상세가 한 자리를 번갈아 쓴다. 목록은 언마운트하지 않는다 — 찾는 글 · 정렬 · 스크롤이 그대로다
//
// 한때(03) 같은 짝의 판 · 찾기 칸 · 표가 `ListParts`였다(줄 48 · 경로 칸 · 판 안 위 30 · 옆 40). Services 목록이 이 틀로 옮길 때까지 그쪽이 남는다.

/** 표의 칸 — 이름(옆 글 포함) · 시각 · 오른쪽 동작. 머리 줄과 몸 줄이 같은 격자다(보드 `--pl-cols` · `column-gap: 12px`). */
export const PLACE_COLUMNS = "grid grid-cols-[minmax(0,1fr)_132px_108px] items-center gap-x-3";

/** 목록이 지금 보이나 — 상세가 선 동안 목록은 마운트된 채 숨는다(`PlaceStage`). 찾기 칸의 ⌘F와 토스트 자리가 읽는다. 자리 밖이면 늘 보인다. */
const ListShown = createContext(true);

/**
 * **목록과 상세가 한 자리를 번갈아 쓴다**(보드 Places `.pl-list` · `.pl-detail` · PlaceSheet 「움직임과 조작」 · Motion 「목록에서 상세로」). 상세가
 * 서면 목록은 마운트된 채 숨고(보이지 않고 손이 닿지 않는다 — 구른 자리를 잃지 않게 접지 않는다), 상세가 오른쪽 10에서 옅음을 벗으며 선다
 * (`place-in` — 240ms `ease-enter-snappy`). 돌아오면 상세는 곧바로 걷히고 목록이 왼쪽 10에서 선다(`place-back`). 동작 줄이기면 곧바로다.
 * 상세가 다른 것으로 바뀌면(뒤로 · 앞으로) 다시 선다 — `detailKey`가 상세의 열쇠다. **이 자리가 처음 선 장면은 움직이지 않는다** — 다른 화면
 * (팔레트 · 사이드바 · 앱을 다시 연 자리)에서 곧장 상세로 오면 상세가 그냥 선다. 움직임은 이 자리 안에서 장면이 바뀔 때만이다.
 */
export function PlaceStage({ list, detail, detailKey }: { list: ReactNode; detail: ReactNode; detailKey: string | null }) {
  const showing = detailKey !== null;
  // 이 자리 안에서 장면이 바뀌었나. 렌더 중에 앞 장면과 견준다(효과로 고치면 새 장면이 한 번 움직임 없이 먼저 선다).
  const [seen, setSeen] = useState(detailKey);
  const [moved, setMoved] = useState(false);
  if (seen !== detailKey) {
    setSeen(detailKey);
    setMoved(true);
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1">
      <div
        inert={showing}
        className={cn("col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col", showing ? "invisible" : moved && "place-back")}
      >
        <ListShown.Provider value={!showing}>{list}</ListShown.Provider>
      </div>
      {showing && (
        <div key={detailKey} className={cn("col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col", moved && "place-in")}>
          {detail}
        </div>
      )}
    </div>
  );
}

/**
 * 목록 판 — 스스로 구르는 판 안의 가운데 열(보드 `.pl-scroll` · `.pl-col`): 머리(제목 · 도구)와 몸. 도구(찾기 칸 · 주 단추)는 목록이 있을 때만
 * 준다 — 빈 목록 · 처음 읽는 중에는 제목뿐이다. 토스트 자리(본문 아래 가운데)는 목록이 보이는 동안만 선다 — 상세가 제 자리를 세운다(한
 * 화면에 하나 — `Toaster`). 창(제거 확인)은 `after`다.
 */
export function PlaceList({ title, tools, children, after }: { title: string; tools?: ReactNode; children: ReactNode; after?: ReactNode }) {
  const shown = useContext(ListShown);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        <div className="mx-auto w-full max-w-(--measure-wide) px-14 pt-9 pb-14">
          {/* 머리 — `<header>`가 아니다: 창의 머리는 머리 줄 하나다(ui-refresh 결정 5 · `ShellHead`). */}
          <div className="mb-6 flex min-h-9 items-center gap-2.5">
            <h1 className="min-w-0 flex-1 text-heading-lg leading-8 tracking-[-0.015em] wrap-anywhere text-fg">{title}</h1>
            {tools}
          </div>
          {children}
        </div>
      </div>
      {shown && <Toaster />}
      {after}
    </div>
  );
}

/**
 * 찾기 칸(보드 `.pl-search` — 240 × 34 · 완전히 둥글게 · 0.5 고리). 쓰는 동안은 앱의 포커스 링이다(`focus-ring` — 1 파랑 선과 옅은 둘레, 보드는
 * 안쪽 1 파랑 고리 — 포커스 모양은 앱 한 벌이다, `state-scale.test.ts`). 칠 때마다 곧바로 거른다 — 한글을 조합하는 동안에도
 * 거른다(`input` 이벤트마다 — 보드 「찾기」). **⌘F로 이 칸에 선다**(스토리 111) — 목록이 보이는 동안만 듣는다. 칸의 이름이 자리표시와 같다.
 */
export function PlaceSearch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const shown = useContext(ListShown);
  useEffect(() => {
    if (!shown) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !pressed(event, "find") || !input.current) return;
      event.preventDefault();
      input.current.focus();
      input.current.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);
  return (
    <label className="flex h-8.5 w-60 shrink-0 items-center gap-2 rounded-full pr-3.5 pl-3 text-fg-tertiary inset-ring-[0.5px] inset-ring-border-heavy focus-ring">
      <Search aria-hidden className="size-3.5 shrink-0" />
      <input
        ref={input}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        aria-keyshortcuts={HOTKEYS.find.aria}
        className="min-w-0 flex-1 bg-transparent text-chat-meta text-fg outline-none placeholder:text-fg-placeholder"
      />
    </label>
  );
}

/** 주 단추(보드 `.pl-btn.main` — 34 · 완전히 둥글게 · 면 `fg` · + 15). 머리와 빈 목록의 할 일이 같은 단추다. */
export function PlaceAdd({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <Button size="place" onClick={onClick} className={cn("hover:opacity-86", className)}>
      <Plus aria-hidden />
      {label}
    </Button>
  );
}

/**
 * 표 — 열 머리(이름 · 시각 — 누르면 그 칸 기준, 다시 누르면 방향이 뒤집힌다. 줄은 곧바로 바뀐다)와 줄들. 활성 칸만 화살표가 서고 오름이면 180도
 * 돈다(`duration-relaxed`). 찾기 결과가 없으면 열 머리 아래에 그렇게 말한다(`empty` — 보드 「찾기 결과 없음」: 찾기 칸과 열 머리는 남는다).
 * 그림은 격자지만 읽기는 표다(`role="table"` — 칸 · 열 머리로 오가고, 지금 정렬은 열 머리의 `aria-sort`가 말한다). 동작 칸은 머리가 없다.
 */
export function PlaceTable({
  label,
  whenLabel,
  sort,
  onSort,
  empty,
  children,
}: {
  label: string;
  whenLabel: string;
  sort: PlaceSort;
  onSort: (key: PlaceSort["key"]) => void;
  empty?: string | null;
  children: ReactNode;
}) {
  return (
    <div role="table" aria-label={label}>
      <div role="row" className={cn(PLACE_COLUMNS, "h-9 border-b-[0.5px] border-border-heavy text-xs text-fg-tertiary")}>
        <SortHead label="이름" sort={sort} by="name" onSort={onSort} />
        <SortHead label={whenLabel} sort={sort} by="when" onSort={onSort} />
        <span role="columnheader" aria-hidden />
      </div>
      {children}
      {empty && <p className="py-10 text-center text-chat-meta text-fg-tertiary">{empty}</p>}
    </div>
  );
}

function SortHead({ label, sort, by, onSort }: { label: string; sort: PlaceSort; by: PlaceSort["key"]; onSort: (key: PlaceSort["key"]) => void }) {
  const on = sort.key === by;
  const dir = on ? sort.dir : "desc";
  return (
    <span role="columnheader" aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => onSort(by)}
        className="flex w-fit items-center gap-1 rounded-ctl transition-colors hover:text-fg-secondary focus-ring"
      >
        {label}
        <ArrowDown
          aria-hidden
          data-sort-arrow=""
          className={cn(
            "size-3 [transition:transform_var(--duration-relaxed)_var(--ease-enter),opacity_var(--duration-basic)_var(--ease-default)]",
            on ? "opacity-100" : "opacity-0",
            dir === "asc" && "rotate-180",
          )}
        />
      </button>
    </span>
  );
}

/**
 * 줄 하나(보드 `.pl-row` — 64 · 0.5 선 · 둥글기 4 · 옆으로 8 나간 면). **줄 어디를 눌러도 상세다** — 이름이 그 링크(`link`)이고, 줄의 빈 자리
 * 누름은 줄이 받는다(링크 안에 단추를 둘 수 없다). 오른쪽 단추 · 메뉴는 제 일만 한다(포털로 뜬 메뉴도 React 나무로는 줄 안이라 누름이 올라온다
 * — 줄 안 DOM에서 온 누름만 받고 단추 · 링크는 거른다). Tab은 이름 링크에 서고 Enter로 연다 — 링크가 키보드로 서면 줄이 지날 때와 같은 면이다
 * (보드 `.pl-row:focus-visible`). 이름 옆 글(`desc` — 경로 · 수)은 흐리게 잘린다. 폴더를 찾을 수 없는 줄(`missing`)은 이름이 흐리고 옆 글이
 * 주황이다. `anchor`는 줄을 감싼 상자다(보드 `.pl-rowwrap` — 옆으로 나간 면 없이 열의 폭) — ⋯ 메뉴가 그 아래 오른쪽 끝에 선다. 상세 묶음의 줄은
 * `sub`다(보드 `.pl-row.sm` — 46 · 아이콘 14, 격자와 면은 같다 — PlaceSheet 「상세 줄」).
 */
export function PlaceRow({
  icon,
  name,
  link,
  desc,
  when,
  missing = false,
  onOpen,
  actions,
  anchor,
  size = "list",
}: {
  icon: ReactNode;
  name: string;
  /** 이름 링크가 가는 곳 — 줄의 빈 자리 누름(`onOpen`)과 같은 상세다. */
  link: LinkProps;
  desc: string;
  when: string;
  missing?: boolean;
  onOpen: () => void;
  actions: ReactNode;
  anchor?: Ref<HTMLDivElement>;
  size?: "list" | "sub";
}) {
  const fromRow = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (!event.currentTarget.contains(target) || target.closest("a, button")) return;
    onOpen();
  };
  return (
    <div ref={anchor}>
      <div
        role="row"
        data-missing={missing || undefined}
        onClick={fromRow}
        className={cn(
          PLACE_COLUMNS,
          "group/row relative -mx-2 cursor-pointer rounded-ctl border-b-[0.5px] border-border px-2 transition-colors hover:bg-fill-soft has-[[data-row-link]:focus-visible]:bg-fill-soft",
          size === "sub" ? "min-h-11.5" : "min-h-16",
        )}
      >
        <span role="cell" className="flex min-w-0 items-center gap-3">
          <span aria-hidden className={cn("flex shrink-0 text-fg-secondary", size === "sub" ? "[&_svg]:size-3.5" : "[&_svg]:size-3.75")}>
            {icon}
          </span>
          {/* `tabIndex`를 명시한다 — WebKit의 Tab은 맨 링크에 서지 않는다(`@/lib/roving` 머리말). */}
          <Link
            {...link}
            tabIndex={0}
            data-row-link=""
            className={cn("max-w-[56%] shrink-0 truncate text-sm outline-none", missing ? "text-fg-tertiary" : "text-fg")}
          >
            {name}
          </Link>
          <span className={cn("min-w-0 flex-1 truncate text-chat-meta", missing ? "text-warning" : "text-fg-tertiary")}>{desc}</span>
        </span>
        <span role="cell" className="text-chat-meta text-fg-tertiary tabular-nums">
          {when}
        </span>
        <span role="cell" className="flex min-w-0 items-center justify-end gap-0.5">
          {actions}
        </span>
      </div>
    </div>
  );
}

/** 줄 오른쪽의 아이콘 단추 꼴(보드 `.pl-acts .ra-tbtn` — 30 · 둥글기 4 · 쉴 때 흐린 글리프, 지나면 면과 진한 글리프). ⋯ 트리거도 이 꼴이다. */
export const PLACE_ROW_BUTTON =
  "flex size-7.5 shrink-0 items-center justify-center rounded-ctl text-fg-tertiary transition-colors quiet-hover focus-ring aria-expanded:bg-fill-hover aria-expanded:text-fg";

/** 줄 끝의 글 단추(보드 `.pl-fix` — 링크 색 13) — 폴더를 찾을 수 없는 Project의 「재설정」. ⋯ 안이 아니라 줄 끝에서 바로 닿는다(스토리 119). */
export function PlaceFix({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 rounded-ctl text-chat-meta text-link hover:underline focus-ring">
      {label}
    </button>
  );
}

/** 빈 목록(보드 `.pl-empty` · PlaceSheet 「Project 없음」) — 찾기 칸이 없고 할 일이 가운데에 선다. 글리프 20 · 제목 16 · 600 · 까닭 한 줄. */
export function PlaceEmpty({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-2.5 p-8 text-center">
      <span aria-hidden className="flex text-fg-tertiary [&_svg]:size-5">
        {icon}
      </span>
      <h2 className="text-heading-xs text-fg">{title}</h2>
      <p className="max-w-90 text-chat-meta text-fg-tertiary">{body}</p>
      {action}
    </div>
  );
}

/** 처음 읽는 중의 뼈대(보드 `.pl-skelrow` · PlaceSheet 「처음 읽는 중」) — 열 머리(누르지 않는 글)와 네 줄. 300ms 넘게 걸릴 때만 선다(`useLate`). */
export function PlaceSkeleton({ whenLabel }: { whenLabel: string }) {
  return (
    <div aria-busy="true" aria-label="불러오는 중">
      <div className={cn(PLACE_COLUMNS, "h-9 border-b-[0.5px] border-border-heavy text-xs text-fg-tertiary")}>
        <span>이름</span>
        <span>{whenLabel}</span>
        <span />
      </div>
      {SKELETON_BARS.map((bar) => (
        <div key={bar} className="flex min-h-16 items-center gap-3 border-b-[0.5px] border-border">
          <span className="size-4.5 shrink-0 rounded-md skeleton-sweep" />
          <span className={cn("h-3 rounded-md skeleton-sweep", bar)} />
        </div>
      ))}
    </div>
  );
}

/** 뼈대 줄의 막대 폭 — 148 · 112 · 176 · 96(보드 `skels`). */
const SKELETON_BARS = ["w-37", "w-28", "w-44", "w-24"] as const;

/** 처음 읽기가 그 시간보다 오래 걸리나 — 뼈대는 300ms를 넘겨야 선다(보드 「처음 읽는 중」 — 빨리 오면 뼈대가 번쩍이지 않게). */
export function useLate(pending: boolean, ms = 300): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!pending) {
      setLate(false);
      return;
    }
    const timer = window.setTimeout(() => setLate(true), ms);
    return () => window.clearTimeout(timer);
  }, [pending, ms]);
  return pending && late;
}
