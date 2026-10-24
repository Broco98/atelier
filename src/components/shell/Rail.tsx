import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * 레일의 칸 하나 — 소문자 영어 이름(`spec` · `chat` · `files`, CONTEXT.md 「표기」)이다. 칸은 목록으로 받아 뒤에 더해진다(DS
 * `PanelRail` — 대화는 three-axes, files · changes는 git-integration이 더한다).
 */
export interface RailItem<Id extends string = string> {
  id: Id;
  label: string;
  icon: LucideIcon;
}

/**

 * 레일 칸에 선 점 하나 — 그 점이 뜻하는 말(칸의 설명 `aria-description`으로 남는다)과 색의 갈래. `new`는 고친 곳(three-axes 티켓 26),
 * `wait` · `done`은 레일 `chat`의 나를 기다림 · 끝남(티켓 23)이다. 색은 부름의 점과 한 가족이다(DS 「Atelier 낱말」 — 기다림
 * `dot-wait`, 안 본 완료와 고친 곳은 Codex 「새 답변」 점 `dot-new`).
 */
export interface RailMark {
  label: string;
  tone: "new" | "wait" | "done";
}

/**
 * 작업 화면의 레일(ui-refresh 결정 9 · 10)이 받는 것 — 칸 묶음 · 고른 칸. 칸을 고르면 `onPick`이 그 칸을 받는다 — 열림과 고른 칸의
 * 주인은 부르는 쪽이고, 고른 뒤의 둘은 `pickRail`이 정한다. 열림과 그것을 뒤집는 패널 토글은 레일이 아니라 패널 칸의 것이다(`Frame`의
 * `PanelSlot` — 레일이 없는 화면(Archive)의 오른쪽 패널도 같은 토글로 여닫는다, codex-ds 결정 32). 토글은 머리 줄에 선다(`PanelToggle`
 * — 둘을 `Frame`이 함께 그린다). 레일은 칸이 둘 이상일 때만 서지만(`railStands`) 토글은 칸 수와 상관없이 선다(codex-ds 결정 25) —
 * 레일이 서는지에 따라 머리 줄 안의 자리만 바뀐다.
 */
export interface RailProps<Id extends string = string> {
  items: readonly RailItem<Id>[];
  active: Id;
  onPick: (id: Id) => void;
  /**
   * 칸에 선 점(`RailMark`). 없는 칸에는 점이 없다. 지금은 `spec`의 고친 곳 점(three-axes 티켓 26)과 `chat`의 기다림 · 끝남 점(티켓
   * 23)이다. 점을 세울지는 부르는 쪽이 정한다 — 무엇이 보이는지(패널 · 고른 칸 · 가운데 대화창)를 아는 것이 그쪽이라서다.
   */
  marks?: Partial<Record<Id, RailMark>>;
  /**
   * 패널 밖에 서 있는 칸 — 패널이 그 칸을 안 보여도 **켜진 것으로 읽힌다**. 지금은 `chat` 탭이 대화창을 가운데에 띄운 동안의
   * `chat`이다(three-axes S22 — 한 대화창은 한 곳에). 누르면 무엇을 할지는 부르는 쪽이 정한다(그 칸을 패널로 데려온다).
   */
  outside?: readonly Id[];
}

/**
 * 칸을 고른 뒤의 열림과 고른 칸(ui-refresh 결정 9 · 10). **켜진 칸을 다시 고르면 닫힌다** — 고른 칸은 기억한 채다. 켜짐은 「열렸고
 * 그 칸이 골라졌다」이므로 닫힌 채 고른 칸은 켜진 칸이 아니다: 그 칸으로 연다. 다른 칸이면 그 칸으로 바꾼다. 상태의 주인(작업 화면)이
 * 이 규칙 하나로 고친다 — 칸이 둘인 레일을 세우는 L3 진열대(`e2e/rail-fixture.tsx`)도 같은 규칙을 부른다.
 */
export function pickRail<Id extends string>(now: { open: boolean; active: Id }, next: Id): { open: boolean; active: Id } {
  if (now.open && now.active === next) return { open: false, active: now.active };
  return { open: true, active: next };
}

/**
 * 레일이 서는가 — **칸이 둘 이상일 때만 선다**(codex-ds 결정 25 · 스펙 §4). 고를 것이 하나뿐인 줄은 자리만 차지한다. 판정은 칸 목록의
 * 길이다 — 칸이 더해지면(대화 · files · changes) 레일이 다시 선다. 공용 틀(`Frame`)이 이것 하나로 레일 열과 패널 토글의 자리를 함께
 * 가른다 — 둘이 다른 판정을 읽으면 레일 없이 토글만 레일 열 위에 서는 날이 온다.
 */
export function railStands(items: readonly RailItem[]): boolean {
  return items.length >= 2;
}

/**
 * 작업 패널의 몸 하나의 상자 — 레일 칸마다 하나이고, 고른 칸의 몸만 보인다. **안 보이는 몸도 마운트된 채다**(ui-refresh 결정 9) —
 * 칸을 다녀와도 그 몸에서 접어 둔 판 · 폴더가 그대로다. 그래서 `hidden`과 `inert`로 가린다: `hidden`은 preflight의
 * `display: none !important`로 아래 `contents`를 이겨 화면과 접근성 트리에서 빠지고, `inert`는 그 안으로 포커스 · 찾기가 들어가지
 * 못하게 한다(한때 Base UI 탭 패널이 그 둘을 달았다).
 *
 * **제 상자가 없다**(`contents`) — 안의 스크롤 상자가 패널 몸의 직계 flex 자식으로 남아야 해서다(`WorkPanel`의 `SpecTab` 머리말).
 * 표식(`data-panel-view`)은 검사가 몸을 정체성으로 집는 고리다. 작업 화면(`WorkPanel`)과 칸이 둘인 레일의 L3 진열대
 * (`e2e/rail-fixture.tsx`)가 이 상자를 함께 쓴다 — 작업 화면의 몸은 `spec` · `chat` · `files` 셋이다.
 */
export function PanelBody<Id extends string>({ view, shown, children }: { view: Id; shown: boolean; children: ReactNode }) {
  return (
    <div data-panel-view={view} hidden={!shown} inert={!shown} className="contents">
      {children}
    </div>
  );
}

/**
 * 레일 열(ui-refresh 결정 9 · 10 · DS `PanelRail`) — 작업 화면 바탕의 오른쪽 끝, 본문 열의 **형제**다. 카드 위끝(머리 줄 바로 아래)부터
 * 칸 묶음이 선다(codex-ds 결정 29). 패널이 닫혀도 남는다 — 닫힌 패널을 칸으로 다시 여는 길이 여기다. 패널 토글은 이 열이 아니라 그
 * 위 머리 줄에 선다(codex-ds 스펙 §4).
 *
 * **칸이 둘 이상일 때만 선다**(codex-ds 결정 25 · 스펙 §4 — `railStands`). 서지 않을 때는 공용 틀(`Frame`)이 이 열을 통째로 그리지
 * 않아 본문 열이 창 오른쪽 틈 끝까지 넓어지고, 패널을 여닫는 길은 머리 카드 오른쪽 끝의 패널 토글 · ⌘Enter다. 작업 화면의 칸이
 * `spec` 하나이던 동안은 서지 않았고, `chat` · `files`가 더해져 다시 선다.
 *
 * **`aside`도 `nav`도 아니다**(판 04 「지키는 것」 · DS `PanelRail` 「구현 고리」). `aside`는 사이드바와 오른쪽 패널(작업 패널 · spec 목록
 * 패널) 둘뿐이라 e2e가 그 순서를 재고(`tab-row-floor` · `archive-docs`), `nav`는 사이드바 버튼을 집는 고리다(`harness.ts`). 머리 줄 `<header>` 밖이다.
 *
 * **칸은 탭도 라디오도 아니다** — `aria-pressed` 버튼이다. 켜진 칸을 다시 누르면 닫혀 켜진 칸이 0개일 수 있다(DS는 `radiogroup`을
 * 적지만 라디오는 고른 것을 끌 수 없다 — 탭 줄이 `role="tab"`을 안 쓰는 것과 같은 가족이다, `ShellTabs`). 그래서 칸 사이 ←/→ 이동이
 * 없고 Tab으로 옮겨 간다 — 칸마다 `tabIndex`를 명시한다(WebKit의 Tab은 `tabindex` 없는 버튼에 서지 않는다, `@/lib/roving` 머리말). 켜짐은 「패널이 열렸고 그 칸이 골라졌다」이다 — 닫힌 패널의 고른 칸은 기억만 하고 켜 보이지 않는다. 패널 밖에 선 칸
 * (`outside` — 가운데 `chat` 탭의 대화창)은 패널과 상관없이 켜진 것으로 읽힌다.
 *
 * **빈 자리는 창을 끄는 자리다** — 레일 열은 회색 바탕이 드러나는 상자라 `data-tauri-drag-region`을 단다(`Frame` 머리말). 폭은 DS
 * 줄 폭 `size-prail`(32)이고, 왼쪽 틈은 본문 열의 오른쪽 틈이라 오른쪽 틈 하나만 든다(DS `.at-rail`의 `margin-right: 8px`).
 */
function Rail<Id extends string>({
  open,
  items,
  active,
  onPick,
  marks,
  outside = [],
  controls,
}: RailProps<Id> & {
  /** 레일이 고르는 패널이 열렸나 — 켜진 칸은 「열렸고 그 칸이 골라졌다」다(아래). 패널 칸의 열림을 `Frame`이 건넨다. */
  open: boolean;
  /** 레일이 고르는 패널의 id(`aria-controls`) — `Frame`이 패널 칸과 함께 짓는다. */
  controls?: string;
}) {
  return (
    <div data-tauri-drag-region className="box-content flex w-(--size-prail) shrink-0 flex-col items-center pr-2">
      {/* 칸 묶음 — 세그먼트를 세우고 색을 뒤집은 것이다(DS `.at-seg.vert` · codex-ds 결정 29). 홈은 옆 패널 카드와 같은 흰 면
          (`surface` · `shadow-hairline` · `radius-lg`, 안쪽 2 · 칸 사이 2)이고 칸은 28 · `radius-md`라 홈 폭이 줄 폭(32)이다. 켜진 칸은
          패널 트리의 고른 행과 같은 `fill-selected`이고, 꺼진 칸의 hover는 `fill-soft`다 — 켜진 칸은 hover해도 그 면 그대로다(DS
          `.is-on:hover`). 이름은 패널(`작업 패널`)과 다르다 — 같으면 「작업 패널」로 집는 자리가 둘이 된다. */}
      <div role="group" aria-label="레일" className="flex flex-col gap-0.5 rounded-lg bg-surface p-0.5 shadow-hairline">
        {items.map(({ id, label, icon: Icon }) => {
          const on = (open && id === active) || outside.includes(id);
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
              aria-description={mark?.label}
              tabIndex={0}
              className={cn(
                "relative flex size-7 items-center justify-center rounded-md transition-colors focus-ring",
                on ? "bg-fill-selected text-fg" : "text-fg-secondary hover:bg-fill-soft hover:text-fg",
              )}
            >
              <Icon className="size-4" />
              {/* 점은 칸의 오른쪽 위 7px — 홈 면(`surface`) 2px 링으로 아이콘과 갈린다(프로토타입 D의 `.rdot`, 값은 캔버스 `.cx-dot`).
                  `<div>`가 아니라 `<span>`이다 — 레일 묶음을 첫 `</div>`까지로 자르는 검사가 있다(`WorksPage.test.tsx`). 뜻은 설명이
                  말하므로 점은 그림일 뿐이다. 고친 곳의 점이라는 표식(`data-change-dot`)은 트리 행 · 스펙 창의 표시와 한 이름이다. */}
              {mark && (
                <span
                  data-change-dot={mark.tone === "new" ? "" : undefined}
                  data-rail-dot={mark.tone}
                  aria-hidden
                  className={cn(
                    "absolute right-0.5 top-0.5 size-1.75 rounded-full ring-2 ring-surface",
                    mark.tone === "wait" ? "bg-dot-wait" : "bg-dot-new",
                  )}
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
