import type { LucideIcon } from "lucide-react";
import { PanelRight } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 레일의 칸 하나 — 소문자 영어 이름(`spec` · `chat` · `info`, CONTEXT.md)이다. 칸은 목록으로 받아 뒤에 더해진다. */
export interface RailItem<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

/**
 * 작업 화면의 레일(ui-refresh 결정 9 · 10) — 패널 토글 하나와 칸 묶음. 토글은 열림만 뒤집고 고른 칸은 그대로 둔다. 칸을 고르면
 * `onPick`이 그 칸을 받는다 — **켜진 칸을 다시 고르면 부르는 쪽이 닫는다**(열림과 고른 칸의 주인이 부르는 쪽이라서다).
 */
export interface RailProps<Id extends string = string> {
  open: boolean;
  onToggle: () => void;
  items: readonly RailItem<Id>[];
  active: Id;
  onPick: (id: Id) => void;
  /**
   * 칸에 선 점 — 그 점이 뜻하는 말이다(칸의 설명 `aria-description`으로 남는다). 없는 칸에는 점이 없다. 지금은 `spec`의 고친 곳
   * 점(three-axes 티켓 26)이다. 점을 세울지는 부르는 쪽이 정한다 — 무엇이 보이는지(패널 · 고른 칸)를 아는 것이 그쪽이라서다.
   */
  marks?: Partial<Record<Id, string>>;
}

/**
 * 레일 열(ui-refresh 결정 9 · 10) — 작업 화면 바탕의 오른쪽 끝, 본문 열의 **형제**다. 맨 위 바탕 줄 44px 띠의 가운데에 패널
 * 토글이, 카드 줄 꼭대기부터 흰 알약 캡슐 안의 세로 칸 묶음이 선다. 패널이 닫혀도 남는다 — 닫힌 패널을 칸으로 다시 여는 길이
 * 여기다(기각된 안: 카드 머리의 `spec | info` — 닫히면 버튼도 사라진다).
 *
 * **`aside`도 `nav`도 아니다**(판 04 「지키는 것」). `aside`는 사이드바와 작업 패널 둘뿐이라 e2e가 그 순서를 재고(`tab-row-floor`),
 * `nav`는 사이드바 버튼을 집는 고리다(`harness.ts`). 바탕 줄 `<header>` 밖이라 `data-tab-actions`는 여전히 그 줄의 마지막 자식이다.
 *
 * **칸은 탭이 아니다** — `aria-pressed` 버튼이다. 켜진 칸을 다시 누르면 닫혀 켜진 칸이 0개일 수 있다(탭 줄이 켜진 칸이 둘일 수
 * 있어 `role="tab"`을 안 쓰는 것과 같은 가족이다 — `ShellTabs`). 그래서 칸 사이 ←/→ 이동이 없고 Tab으로 옮겨 간다. 켜짐은 「패널이
 * 열렸고 그 칸이 골라졌다」이다 — 닫힌 패널의 고른 칸은 기억만 하고 켜 보이지 않는다(누르면 그 칸으로 열린다).
 *
 * 토글의 이름과 도움말은 상태를 탄다 — 누르면 무슨 일이 날지를 말한다(분할 토글 · 목록 토글과 같다). 열림은 `aria-expanded`가
 * 이미 말하므로 설명은 달지 않고, 키(⌘Enter)만 도움말 옆 Kbd와 설명으로 남는다(S28 — `Hint`의 `shortcut`).
 *
 * **빈 자리는 창을 끄는 자리다** — 레일 열과 토글을 앉힌 띠는 회색 바탕이 드러나는 상자라 `data-tauri-drag-region`을 단다
 * (`Frame` 머리말). 폭은 `--rail`이고, 왼쪽 틈은 본문 열의 오른쪽 틈이라 오른쪽 틈 하나만 든다.
 */
function Rail<Id extends string>({
  open,
  onToggle,
  items,
  active,
  onPick,
  marks,
  controls,
}: RailProps<Id> & {
  /** 레일이 여닫고 고르는 패널의 id(`aria-controls`) — `Frame`이 패널 칸과 함께 짓는다. */
  controls?: string;
}) {
  return (
    <div data-tauri-drag-region className="box-content flex w-(--rail) shrink-0 flex-col items-center pr-(--gap)">
      <div data-tauri-drag-region className="flex h-(--titlebar-height) shrink-0 items-center">
        {/* 패널 토글(ui-refresh 결정 9) — 왼쪽 사이드바 토글(`PanelLeft`)을 뒤집은 그림이다. 열렸으면 켜진 모양(흰 원)이고, 바탕
            위 버튼이라 hover는 바탕의 한 단(`chrome-hover`)이다(DS `.at-rail-toggle` · `.at-icon-btn.on-chrome`). */}
        <Hint
          text={open ? "작업 패널 접기" : "작업 패널 펼치기"}
          shortcut="⌘Enter"
          announce="name"
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={controls}
          aria-keyshortcuts="Meta+Enter"
          className={cn(
            "flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-chrome-hover hover:text-foreground",
            open && "bg-card text-foreground",
          )}
        >
          <PanelRight className="size-4" strokeWidth={1.7} />
        </Hint>
      </div>
      {/* 칸 묶음 — 흰 알약 캡슐(안쪽 2px · 칸 사이 2px) 안의 28px 원 칸이라 캡슐 폭이 레일 폭(32)이다(DS `.at-rail-group`).
          이름은 패널(`작업 패널`)과 다르다 — 같으면 「작업 패널」로 집는 자리가 둘이 된다. 켜진 칸은 사이드바의 고른 행과 같은
          `sidebar-accent`이고, 꺼진 칸의 hover(`quiet-hover`)는 꺼진 가지에만 둔다 — 켜진 칸에 겹치면 hover가 켜짐을 덮는다. */}
      <div
        role="group"
        aria-label="레일"
        className="flex flex-col gap-0.5 rounded-pill bg-card p-0.5 inset-ring inset-ring-border-pill"
      >
        {items.map(({ id, label, icon: Icon }) => {
          const on = open && id === active;
          const mark = marks?.[id];
          return (
            <Hint
              key={id}
              text={label}
              announce="name"
              type="button"
              onClick={() => onPick(id)}
              aria-pressed={on}
              aria-controls={controls}
              aria-description={mark}
              className={cn(
                "relative flex size-7 items-center justify-center rounded-full transition-colors",
                on ? "bg-sidebar-accent text-foreground" : "text-tertiary quiet-hover",
              )}
            >
              <Icon className="size-4" strokeWidth={1.7} />
              {/* 점은 칸 원의 오른쪽 위 7px — 캡슐 바탕색 2px 테두리로 아이콘과 갈린다(프로토타입 D의 `.rdot`, 값은 캔버스 `.cx-dot`).
                  `<div>`가 아니라 `<span>`이다 — 레일 묶음을 첫 `</div>`까지로 자르는 검사가 있다(`WorksPage.test.tsx`). 뜻은 설명이
                  말하므로 점은 그림일 뿐이다. */}
              {mark && (
                <span
                  data-change-dot
                  aria-hidden
                  className="absolute right-0.5 top-0.5 size-[7px] rounded-full bg-(--chat-dot-new) shadow-[0_0_0_2px_var(--card)]"
                />
              )}
            </Hint>
          );
        })}
      </div>
    </div>
  );
}

export default Rail;
