import type { LucideIcon } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 레일의 칸 하나 — 소문자 영어 이름(`spec` · `info`, CONTEXT.md)이다. 칸은 목록으로 받아 뒤에 더해진다. */
export interface RailItem<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

/**
 * 작업 화면의 레일(ui-refresh 결정 9 · 10)과 그 위 패널 토글이 받는 것 — 열림 · 칸 묶음 · 고른 칸. 토글(`onToggle`)은 열림만 뒤집고
 * 고른 칸은 그대로 둔다. 칸을 고르면 `onPick`이 그 칸을 받는다 — **켜진 칸을 다시 고르면 부르는 쪽이 닫는다**(열림과 고른 칸의 주인이
 * 부르는 쪽이라서다). 토글은 레일이 아니라 머리 줄에 선다(`PanelToggle` — 둘을 `Frame`이 함께 그린다).
 */
export interface RailProps<Id extends string = string> {
  open: boolean;
  onToggle: () => void;
  items: readonly RailItem<Id>[];
  active: Id;
  onPick: (id: Id) => void;
}

/**
 * 레일 열(ui-refresh 결정 9 · 10) — 작업 화면 바탕의 오른쪽 끝, 본문 열의 **형제**다. 카드 줄 꼭대기(머리 줄 바로 아래)부터 흰 알약
 * 캡슐 안의 세로 칸 묶음이 선다. 패널이 닫혀도 남는다 — 닫힌 패널을 칸으로 다시 여는 길이 여기다(기각된 안: 카드 머리의
 * `spec | info` — 닫히면 버튼도 사라진다). 패널 토글은 이 열이 아니라 그 위 머리 줄에 선다(codex-ds 스펙 §4 · 티켓 13 — 한때 이
 * 열 맨 위의 띠에 섰다). 모양은 아직 판 04의 것이다(DS `PanelRail`로 옮기는 것은 codex-ds 티켓 18).
 *
 * **`aside`도 `nav`도 아니다**(판 04 「지키는 것」). `aside`는 사이드바와 작업 패널 둘뿐이라 e2e가 그 순서를 재고(`tab-row-floor`),
 * `nav`는 사이드바 버튼을 집는 고리다(`harness.ts`). 머리 줄 `<header>` 밖이다.
 *
 * **칸은 탭이 아니다** — `aria-pressed` 버튼이다. 켜진 칸을 다시 누르면 닫혀 켜진 칸이 0개일 수 있다(탭 줄이 켜진 칸이 둘일 수
 * 있어 `role="tab"`을 안 쓰는 것과 같은 가족이다 — `ShellTabs`). 그래서 칸 사이 ←/→ 이동이 없고 Tab으로 옮겨 간다. 켜짐은 「패널이
 * 열렸고 그 칸이 골라졌다」이다 — 닫힌 패널의 고른 칸은 기억만 하고 켜 보이지 않는다(누르면 그 칸으로 열린다).
 *
 * **빈 자리는 창을 끄는 자리다** — 레일 열은 회색 바탕이 드러나는 상자라 `data-tauri-drag-region`을 단다(`Frame` 머리말). 폭은
 * `--rail`이고, 왼쪽 틈은 본문 열의 오른쪽 틈이라 오른쪽 틈 하나만 든다.
 */
function Rail<Id extends string>({
  open,
  items,
  active,
  onPick,
  controls,
}: Omit<RailProps<Id>, "onToggle"> & {
  /** 레일이 고르는 패널의 id(`aria-controls`) — `Frame`이 패널 칸과 함께 짓는다. */
  controls?: string;
}) {
  return (
    <div data-tauri-drag-region className="box-content flex w-(--rail) shrink-0 flex-col items-center pr-(--gap)">
      {/* 칸 묶음 — 흰 알약 캡슐(안쪽 2px · 칸 사이 2px) 안의 28px 원 칸이라 캡슐 폭이 레일 폭(32)이다(DS `.at-rail-group`).
          이름은 패널(`작업 패널`)과 다르다 — 같으면 「작업 패널」로 집는 자리가 둘이 된다. 켜진 칸은 패널 트리의 고른 행과 같은
          `fill-selected`이고(codex-ds 결정 29), 꺼진 칸의 hover(`quiet-hover`)는 꺼진 가지에만 둔다 — 켜진 칸에 겹치면 hover가 켜짐을 덮는다. */}
      <div
        role="group"
        aria-label="레일"
        className="flex flex-col gap-0.5 rounded-full bg-surface p-0.5 inset-ring inset-ring-border"
      >
        {items.map(({ id, label, icon: Icon }) => {
          const on = open && id === active;
          return (
            <Hint
              key={id}
              text={label}
              announce="name"
              type="button"
              onClick={() => onPick(id)}
              aria-pressed={on}
              aria-controls={controls}
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-colors focus-ring",
                on ? "bg-fill-selected text-fg" : "text-fg-tertiary quiet-hover",
              )}
            >
              <Icon className="size-4" />
            </Hint>
          );
        })}
      </div>
    </div>
  );
}

export default Rail;
