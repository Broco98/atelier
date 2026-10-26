import type { MouseEvent, ReactNode } from "react";
import { Search } from "lucide-react";
import { Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// **목록 화면의 뼈대 · 찾기 칸 · 표**(03 구현 스펙 §14 · §16 · 시안 F1-Projects · F1-Space) — Projects 목록과 Space 목록이 같은 시안의 짝이라 함께
// 쓴다(03 코드 리뷰 D1). 두 화면이 옮겨 적던 동안 지날 때 줄 선이 숨는 꼴이 이미 갈렸다 — Space 목록만 다음 줄의 선을 남겼다. 여기는 그리기만
// 하고, 표의 칸(격자)과 줄 안의 것은 화면이 준다.

/**
 * 목록 판 하나 — 맨 위 줄(제목 · 도구), 그 아래 본문, 판 밖 아래의 토스트 자리(본문 아래 가운데 — 시안 `.toast`)와 창. 판 안은 위 30 ·
 * 옆 40 · 줄 사이 18(시안 `.pl`)이고 스스로 구른다.
 */
export function ListPanel({ title, tools, children, after }: { title: string; tools?: ReactNode; children: ReactNode; after?: ReactNode }) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4.5 overflow-y-auto px-10 pt-7.5 pb-10 scroll-quiet">
        {/* 본문 맨 위 줄(제목 · 찾기 · 추가) — `<header>`가 아니다: 창의 머리는 머리 줄 하나다(ui-refresh 결정 5 · `ShellHead`). */}
        <div className="flex min-h-8 items-center gap-2.5">
          <h1 className="text-heading-md text-fg">{title}</h1>
          {tools}
        </div>
        {children}
      </div>
      {/* 「되돌리기」 · 「경로 복사」 같은 토스트가 여기 선다 — 본문 아래 가운데(시안 `.toast`). */}
      <Toaster />
      {after}
    </div>
  );
}

/** 알약 찾기 칸(시안 `.find` — 30 · 폭 240 · 테두리 · 앞에 돋보기) — 맨 위 줄의 오른쪽에 선다. 칸의 이름이 자리표시와 같다. */
export function SearchPill({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="ml-auto flex h-7.5 w-60 items-center gap-1.5 rounded-full border border-border-heavy px-3 text-fg-tertiary focus-ring">
      <Search aria-hidden className="size-3.5 shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-chat-meta text-fg outline-none placeholder:text-fg-tertiary"
      />
    </label>
  );
}

/**
 * 표 하나(시안 `.th` · `.pend`) — 머리 줄(칸 이름들 · 끝의 ⋯ 칸)과 줄들, 마지막 줄 아래 선. 줄마다 위 선이라 끝에 한 줄 더 둔다. `columns`는
 * 머리 줄과 몸 줄이 함께 쓰는 격자이고, `after`는 표 끝 선 아래에 선다(「찾는 Project가 없어요」).
 */
export function ListTable({
  label,
  columns,
  heads,
  children,
  after,
}: {
  label: string;
  columns: string;
  heads: readonly string[];
  children: ReactNode;
  after?: ReactNode;
}) {
  return (
    <div role="table" aria-label={label} className="flex flex-col">
      <div role="row" className={cn(columns, "h-7.5 text-xs text-fg-tertiary")}>
        {heads.map((head) => (
          <span key={head} role="columnheader">
            {head}
          </span>
        ))}
        <span role="columnheader" aria-hidden />
      </div>
      {children}
      {/* 마지막 줄 아래 선 — 줄마다 위 선이라 끝에 한 줄 더 둔다(시안 `.pend`). */}
      <div aria-hidden className="mx-2.5 h-[0.5px] bg-separator" />
      {after}
    </div>
  );
}

/**
 * 표의 줄 하나의 꼴(시안 `.prow` · `.srow`) — 48 · 둥글기 12, 줄 위에 0.5 선(옆 10 들여). 지나면 옅은 면이 서고 **그 줄의 위 선과 다음 줄의 위
 * 선(마지막 줄이면 표 끝 선)이 숨는다** — 시안 `:hover::before, :hover+.srow::before, :hover+.pend::before{opacity:0}`. 이름 끝 꺾쇠 같은
 * 지날 때의 것은 줄 안의 것이 `group-hover/row`로 받는다.
 */
const ROW = cn(
  "group/row relative h-12 rounded-xl text-sm text-fg transition-colors hover:bg-fill-soft",
  "before:absolute before:inset-x-2.5 before:top-0 before:h-[0.5px] before:bg-separator hover:before:opacity-0",
  "[&:hover+[role=row]]:before:opacity-0 [&:hover+[aria-hidden]]:opacity-0",
);

/**
 * 표의 줄 하나 — 줄 어디를 눌러도 `onOpen`(상세)이다. 이름이 그 링크이고(키보드는 이름에 선다), 줄의 누름은 줄 안 단추 · 링크(⋯ · 「재설정」)가
 * 아닐 때만 연다 — 링크 안에 단추를 둘 수 없어 줄이 누름을 받는다.
 */
export function ListRow({ columns, onOpen, children }: { columns: string; onOpen: () => void; children: ReactNode }) {
  // 줄 안 단추 · 링크와 메뉴(포털로 떠도 React 나무로는 줄 안이라 누름이 올라온다)에서 온 것은 제 일만 한다.
  const openFromRow = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (!event.currentTarget.contains(target) || target.closest("a, button")) return;
    onOpen();
  };
  return (
    <div role="row" onClick={openFromRow} className={cn(columns, ROW)}>
      {children}
    </div>
  );
}
