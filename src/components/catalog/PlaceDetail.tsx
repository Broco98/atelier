import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, CircleAlert, MoreHorizontal, Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/toast";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PLACE_COLUMN, PLACE_HEAD, PLACE_TITLE, PlaceFix } from "./PlaceList";

// **공용 상세 틀**(restart 03-2 · 스펙 「03 — 목록과 상세」 · 보드 PlaceSheet 「규격」 · 「상세 상태」 · Places `.pl-detail`) — Projects · Services ·
// Archive의 상세가 한 틀을 쓴다. 목록(`PlaceList`)과 같은 판 · 가운데 열이라 목록과 상세가 한 자리를 번갈아 써도 열이 움직이지 않는다. 여기는 그리기만
// 하고 안의 것(이름 · 단추 · 카드 · 묶음의 줄)은 화면이 준다.
//
//   판(`PlaceDetail`) ─ 스스로 구른다. 가운데 열 최대 1120 · 위 36 · 옆 56 · 아래 56(목록과 같다 — 좁은 창은 20 · 16 · 32)
//     「← 목록」 ─ 28 · 13 · `fg-secondary`, 언제나 목록으로 간다(보드 `.pl-back` · PlaceSheet 「뒤로 · 앞으로」)
//     머리 ─ 이름 24/32 · 600, 오른쪽에 단추(34)와 ⋯(28) — 아래 6(보드 `.pl-detail .pl-head`). 좁은 창은 이름 한 줄 · 단추가 그 아래 줄
//     설명(`PlaceLede`) ─ 14/22 · `fg-secondary` · 최대 680 · 아래 20
//     경고(`PlaceWarn`) ─ 36 · `wait-soft` 면 · 둥글기 4 · ⓘ 14 `warning` · 13/19 · 끝에 할 일(보드 `.pl-warn`)
//     위 카드(`PlaceFacts`) ─ 네 칸(좁은 창은 두 칸 두 줄) · 사이 8 · 칸마다 이름 12 · 값 13/19(보드 `.pl-facts` · `.pl-fact`)
//     묶음(`PlaceSection`) ─ 머리 36 · 13 · 500 · 수 · 끝에 +(26), 위 28 · 아래 0.5 선. 줄은 목록과 같은 격자의 46(`PlaceRow`의 `sub`)
//
// 한때(03) 상세는 「← 목록」 알약 · 제목 · 설명 묶음 | 오른쪽 칸 270(기준 브랜치 · 경로 · 함께 쓰는 Service) 두 단이었다(`DetailParts`의
// `DetailPanel`). Project 상세(03-2)와 Service 상세(03-3)가 이 틀로 옮겼다.

/**
 * 상세 판 — 「← 목록」, 머리(이름 · `actions`), 그 아래 몸(`children` — 설명 · 경고 · 위 카드 · 묶음). 토스트 자리는 목록과 같은 자리다(상세가 선 동안
 * 목록의 자리는 서지 않는다 — 한 화면에 하나). 창(제거 확인)은 `after`다.
 */
export function PlaceDetail({
  back,
  title,
  actions,
  children,
  after,
}: {
  back: { to: "/projects" | "/services" | "/archive"; label: string };
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
        {/* 글 바탕이 14/20이다(보드 `.pl-root`) — 「← 목록」은 줄 안의 상자라 그 줄 높이에 앉는다(16/24면 2.7 아래로 선다). */}
        <article className={cn(PLACE_COLUMN, "text-sm")}>
          {/* `tabIndex`를 명시한다 — WebKit의 Tab은 맨 링크에 서지 않는다(`@/lib/roving` 머리말). */}
          <Link
            to={back.to}
            tabIndex={0}
            className="-mt-2 mb-2.5 -ml-2 inline-flex h-7 items-center gap-1.5 rounded-ctl pr-2 pl-1.5 text-chat-meta text-fg-secondary transition-colors hover:bg-fill-soft hover:text-fg focus-ring"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            {back.label}
          </Link>
          <div className={cn("mb-1.5", PLACE_HEAD)}>
            <h1 className={PLACE_TITLE}>{title}</h1>
            {actions}
          </div>
          {children}
        </article>
      </div>
      <Toaster />
      {after}
    </div>
  );
}

/** 이름 아래 설명 한 줄(보드 `.pl-lede`) — 비어도 자리(아래 20)는 남는다: 위 카드가 설명이 있든 없든 같은 틈에 선다. */
export function PlaceLede({ children }: { children?: ReactNode }) {
  return <p className="mb-5 max-w-170 text-sm leading-5.5 whitespace-pre-wrap text-fg-secondary">{children}</p>;
}

/** 상세 경고(보드 `.pl-warn` · PlaceSheet 「폴더를 찾을 수 없는 Project」) — 한 줄과 끝의 할 일(링크 색 글 단추). 할 일은 ⋯ 안이 아니라 여기서 바로 닿는다. */
export function PlaceWarn({ text, action }: { text: string; action: { label: string; onClick: () => void } }) {
  return (
    <div className="mb-2 flex min-h-9 items-center gap-2 rounded-ctl bg-wait-soft px-3 py-1.5 text-chat-meta leading-4.75 text-fg">
      <CircleAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
      <span className="min-w-0">{text}</span>
      <PlaceFix label={action.label} onClick={action.onClick} />
    </div>
  );
}

/** 위 카드 줄 — 네 칸이 같은 폭이다(보드 `.pl-facts`). 좁은 창은 두 칸씩 두 줄이다. */
export function PlaceFacts({ children }: { children: ReactNode }) {
  return <div className="mb-2 grid grid-cols-4 gap-2 narrow:grid-cols-2">{children}</div>;
}

/** 위 카드 한 칸의 겉(보드 `.pl-fact` — 위아래 12 · 옆 14 · 둥글기 8 · `surface-under` 면 · 안쪽 0.5 `border` 고리). */
const PLACE_FACT =
  "flex min-w-0 flex-col items-start gap-0.5 rounded-card bg-surface-under px-3.5 py-3 text-left inset-ring-[0.5px] inset-ring-border";
/** 칸의 이름(12 · .025em · `fg-tertiary`)과 값(13/19 · 한 줄 · 말줄임). */
const PLACE_FACT_LABEL = "text-xs text-fg-tertiary";
const PLACE_FACT_VALUE = "max-w-full truncate text-chat-meta leading-4.75 text-fg";

/** 위 카드 한 칸 — 이름과 값. 값이 잘리면 가리켜 전부를 본다(`title`). */
export function PlaceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className={PLACE_FACT}>
      <span className={PLACE_FACT_LABEL}>{label}</span>
      <span title={value} className={PLACE_FACT_VALUE}>
        {value}
      </span>
    </div>
  );
}

/**
 * 묶음 하나(보드 `.pl-sec`) — 머리(이름 · 수 · 끝의 +)와 줄들. 줄은 목록과 같은 격자의 46 줄(`PlaceRow`의 `sub`)이고 읽기는 표다(이름이 링크).
 * 줄이 없는 묶음은 부르는 쪽이 그리지 않는다(보드 — 채팅이 없는 Project에는 채팅 묶음이 없다).
 */
export function PlaceSection({
  title,
  count,
  add,
  children,
}: {
  title: string;
  count: number;
  add?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mt-7">
      <div className="flex h-9 items-center gap-2 border-b-[0.5px] border-border-heavy text-chat-meta font-medium text-fg">
        <h2>{title}</h2>
        <span className="font-normal text-fg-tertiary tabular-nums">{count}개</span>
        {add && (
          // `tabIndex`를 명시한다 — WebKit의 Tab은 맨 단추에 서지 않는다(`@/lib/roving` 머리말, restart 03-13b).
          <Hint
            text={add.label}
            aria-label={add.label}
            type="button"
            tabIndex={0}
            onClick={add.onClick}
            className="ml-auto flex size-6.5 shrink-0 items-center justify-center rounded-ctl text-fg-secondary transition-colors quiet-hover focus-ring"
          >
            <Plus aria-hidden className="size-3.5" />
          </Hint>
        )}
      </div>
      <div role="table" aria-label={title}>
        {children}
      </div>
    </section>
  );
}

/** 머리의 글 단추(보드 `.pl-btn` — 34 · 완전히 둥글게 · 옆 14 · 13 · 500 · 안쪽 0.5 `border-heavy` 고리, 지나면 `fill-soft`). 주 단추는 `PlaceAdd`다. */
export function PlaceButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <Button variant="outline" size="place" onClick={onClick} className={cn("pl-3.5 inset-ring-[0.5px]", className)}>
      {label}
    </Button>
  );
}

/** 머리 · 줄의 ⋯ 같은 상세의 아이콘 단추(보드 `.ra-tbtn` — 28 · 둥글기 4 · `fg-secondary`, 지나거나 펼치면 `fill-hover` 면과 `fg`). */
export const PLACE_ICON_BUTTON =
  "icon-button icon-button-ctl text-fg-secondary transition-colors quiet-hover focus-ring aria-expanded:bg-fill-hover aria-expanded:text-fg";

/**
 * 상세 머리의 ⋯(보드 Places 상세 머리의 `.ra-tbtn`) — 항목은 화면이 준다. 목록 줄의 ⋯와 같은 항목이다(restart 03-15c — Project는 PlaceSheet 표,
 * Service는 보드 `MENUS.services`). 메뉴 카드는 단추 오른쪽 끝에 맞춘 208 폭이다. 한때(03-2 · 03-3) 앞에 「이름 바꾸기 · 설명 고치기」가 섰고, 그것으로
 * 닫히면 포커스를 ⋯로 돌리지 않았다.
 */
export function PlaceDetailMenu<A extends string>({
  label,
  items,
  icons,
  onAct,
}: {
  label: string;
  items: readonly { act: A; label: string }[];
  icons: Record<A, LucideIcon>;
  onAct: (act: A) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={label} className={PLACE_ICON_BUTTON}>
        <MoreHorizontal aria-hidden className="size-3.75" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width="place">
        {items.map((item) => {
          const Icon: LucideIcon = icons[item.act];
          return (
            <DropdownMenuItem key={item.act} onClick={() => onAct(item.act)}>
              <Icon />
              <span>{item.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
