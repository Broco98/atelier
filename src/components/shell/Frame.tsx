import { useId, useRef, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Crumbs } from "@/components/ui/crumbs";
import { useShellBackground } from "@/features/terminal/terminal-settings";
import { cn } from "@/lib/utils";
import { foldingInnerClass, PANEL_MOTION, TAB_ROW_CARD, TAB_ROW_COLUMN } from "./panel-layout";
import PanelToggle from "./PanelToggle";
import Rail, { type RailProps } from "./Rail";
import { ResizeHandle, type ResizableWidth } from "./useResizableWidth";
import useSplitRatio from "./useSplitRatio";

// 화면의 **공용 틀**(ui-refresh 결정 27). 옅은 회색 바탕(`bg-surface-shell`) 맨 위에 48 머리 줄이 서고(codex-ds 스펙 §4), 그 아래
// 목록 · 본문 · 패널이 각자 둥근 흰 카드로 뜬다(ui-refresh 결정 4). 머리 줄에는 지금 보는 것을 말하는 머리 카드가 뜬다. 화면은
// 카드 내용만 건넨다 — 틈 · 끌기 영역 · 손잡이 · 신호등 inset을 이 파일 한 곳이
// 지킨다. 일곱 화면이 저마다 그 규칙을 적으면 한 화면만 틈 하나를 빠뜨려도 화면으로는 어디가 죽었는지가 안 보인다. 분할의 두 열과
// 편집기의 트리 카드도 이 틀의 칸이다(`split` · `beside`) — 한때 두 화면이 그 칸의 틈 · 끌기 영역 · 손잡이를 제 손으로 다시 적었다.
// 탭 줄(`ShellTabs`)은 이 틀의 줄이 아니라 본문 카드의 머리다(codex-ds 스펙 §4 「탭 줄」) — 화면이 카드의 `head`로 건넨다.
//
//   뿌리(bg-surface-shell) ─ 머리 줄 `<header>`(HeadRow) ─ 머리 카드(head가 있을 때만, 본문 열 폭) · 패널 토글 자리(rail이 있을 때만)
//                  └ 아래 줄 ─ 본문 열(TAB_ROW_COLUMN, 아래 틈) ─ 카드 줄(오른쪽 틈 · 사이드바를 접으면 왼쪽 틈)
//                           │                                  ─ list · 본문(카드 하나, 또는 분할의 열 카드 둘) · beside · panel · overlay
//                           └ 레일 열(rail이 있을 때만, 오른쪽 틈) ─ 칸 묶음(카드 줄 꼭대기부터)
//
// **틈도 창을 끄는 자리다.** Tauri는 누른 요소 **자신**의 `data-tauri-drag-region`만 본다 — 회색 틈이 드러나는 상자(뿌리 · 머리 줄 ·
// 패널 토글 자리 · 아래 줄 · 본문 열 · 카드 줄 · 레일 열 · 접히는 바깥 상자 · 분할의 `<main>`과 왼쪽 열 상자 · 옆 칸) 모두에 단다.
// 하나라도 빠지면 그 틈은 창을 못 끄는 죽은 자리가 된다. 카드 안(카드 머리의 빈 자리도)은 끌기 영역이 아니다 — 머리 카드도 카드다.
// 틈의 실제 자리와 그 자리를 누르면 무엇이 눌리는지는 `e2e/frame.spec.ts`가 잰다.
//
// **카드 줄에 flex `gap`을 쓰지 않는다.** 틈은 칸 상자의 안쪽 여백이다 — 접힌 칸 옆에 틈이 남지 않게(판 04 「지키는 것」). 분할의
// 두 열 사이 틈도 왼쪽 열 상자의 안쪽 여백이고, 손잡이는 어느 칸에서나 그 틈의 가운데에 선다.

/** 칸 하나가 그리는 카드의 내용 — 이름(`aria-label`)과 카드 안(머리와 몸). 카드 상자(모서리 · 바탕)와 그 둘레의 틈은 칸이 그린다. */
interface CardContent {
  label: string;
  children: ReactNode;
}

/** 왼쪽 목록 카드 · 오른쪽 패널 카드 한 칸. 저장하는 폭은 **카드의 폭**이다(틈은 더하지 않는다). */
export interface SideSlot extends CardContent {
  open: boolean;
  size: ResizableWidth;
}

/** 분할의 열 하나(CONTEXT.md 「열」) — 카드 하나다(ui-refresh 결정 15). `terminal`이면 카드 바탕이 터미널 테마를 따른다(`Card`의 `tone`). */
export interface SplitColumn extends CardContent {
  tone?: "terminal";
}

/**
 * 분할(CONTEXT.md) — 본문 자리에 열 카드 둘이 선다. 마크업에서 먼저 나오는 것이 왼쪽 열이다. 두 열 사이 틈 · 그 가운데 손잡이 · 틈
 * 끌기 영역 · 비율과 그 저장 · 더블클릭으로 반반에 돌아가는 박자는 이 틀이 든다. 화면은 두 열의 카드 내용과 저장 키만 건넨다.
 */
export interface SplitSlot {
  /** 왼쪽 열의 몫(비율)을 저장하는 키 — 화면의 것이다. */
  ratioKey: string;
  columns: readonly [SplitColumn, SplitColumn];
}

/**
 * 본문 카드 오른쪽에 **늘 열려** 선 고정 폭 카드 한 칸(옆 칸) — 접힘 · 폭 손잡이 · 레일이 없다. 레이아웃 편집기의 트리 카드가 이것이다
 * (판 06 티켓 07). `width`는 **카드의 폭**이다(틈은 더하지 않는다).
 */
export interface BesideSlot extends CardContent {
  width: number;
}

/**
 * 머리 카드(codex-ds 스펙 §4 · DS `HeadCard`)에 서는 것 — 지금 보는 것의 아이콘 · 이름과 오른쪽 할 일. 오른쪽은 「할 일 | 보기 배치」
 * 둘이고 얇은 세로선이 가른다. 카드 상자(모서리 · 면 · 링)와 자리(본문 열 폭 · 머리 줄 가운데)는 이 틀이 든다.
 */
export interface HeadSlot {
  /** 지금 보는 것의 아이콘 — 작업 화면은 ⚡(`Zap` — work 아이콘이지 상태 글리프가 아니다. 상태는 오른쪽 배지가 말한다). */
  icon: LucideIcon;
  /** 지금 보는 것의 이름. 보이기만 한다 — 그 자리에서 바꾸는 것은 codex-ds 티켓 28이다. */
  name: string;
  /** 오른쪽 할 일 — 그 대상에 거는 조작(작업 화면은 상태 배지 · ⋯ 작업 메뉴). */
  actions?: ReactNode;
  /** 오른쪽 끝 보기 배치 — 화면을 어떻게 놓아 보는가(작업 화면은 분할). 할 일과는 세로선으로 갈린다. */
  view?: ReactNode;
}

interface FrameProps<Id extends string> {
  /** 사이드바가 열렸나 — 머리 줄의 왼쪽 여백과 카드 줄의 왼쪽 틈이 이것으로 갈린다. */
  sidebarOpen: boolean;
  /**
   * 머리 줄의 머리 카드 — 지금 보는 것의 아이콘 · 이름과 그 화면의 할 일(`HeadSlot`). 없으면 머리 줄은 창을 끄기만 하는 빈 줄이다
   * (ui-refresh 결정 5 — 작업을 고르지 않은 work 화면과, 아직 머리 카드를 채우지 않은 다른 화면).
   */
  head?: HeadSlot;
  /**
   * 왼쪽 목록 카드 — `section`이다(`aside`는 사이드바와 작업 패널 둘뿐이다). 접힘 · 폭 손잡이 · 카드 오른쪽 틈은 이 틀이 들고,
   * 화면은 카드 안(머리와 몸)만 건넨다.
   */
  list?: SideSlot;
  /** 오른쪽 작업 패널 카드 — 바깥 상자가 두 번째 `<aside>`다. */
  panel?: SideSlot;
  /**
   * 작업 화면의 레일 열(`Rail` — 칸 묶음)과 그 위 머리 줄의 패널 토글(`PanelToggle`). 작업을 고른 작업 화면만 건넨다 — 없으면 레일
   * 열도 토글도 없고 본문 열의 오른쪽 틈 하나가 창 끝이다. 칸의 id 타입(`Id`)이 부르는 쪽의 것 그대로 `onPick`까지 간다.
   */
  rail?: RailProps<Id>;
  /**
   * 분할 — 본문 자리에 `<main>`이 서고 그 안에 열 카드 둘이 선다(`SplitSlot`). 주면 `children`은 그리지 않는다 — 본문은 하나다.
   */
  split?: SplitSlot;
  /** 본문 카드 오른쪽의 옆 칸 — 늘 열린 고정 폭 카드(`BesideSlot`). 편집기 트리 카드 하나가 쓴다. */
  beside?: BesideSlot;
  /**
   * 카드 줄 위를 덮는 것(놓기 겹판 · 토스트 · 생애 겹판). 카드 줄이 머리 줄 **아래**에서 시작한다 — 탭 줄은 카드 줄 안(본문
   * 카드의 머리)이라, 「끄는 것이 출발한 줄은 덮지 않는다」는 덮는 쪽이 줄 높이(`--size-toolbar`)만큼 내려 선다(`WorksPage`의 놓기 겹판).
   */
  overlay?: ReactNode;
  /** 본문 카드(`<Card as="main">`). 분할이면(`split`) 비워 둔다. */
  children?: ReactNode;
}

function Frame<Id extends string>({
  sidebarOpen,
  head,
  list,
  panel,
  rail,
  split,
  beside,
  overlay,
  children,
}: FrameProps<Id>) {
  // 패널 토글 · 레일 칸이 가리키는 패널 칸(`aria-controls`). 셋을 이 틀이 함께 그리므로 이음도 여기서 짓는다 — 화면은 모른다.
  const panelId = useId();
  return (
    // **뿌리가 제 min-content를 바깥에 알린다**(`min-w-min`) — 그것이 탭 줄의 바닥(`TAB_ROW_COLUMN`)과 머리 줄이 사이드바에게
    // 자리를 요구하는 길이다. 뿌리는 세로라 그 값은 머리 줄과 아래 줄 가운데 큰 쪽이다. 카드 줄은 탭 줄을 품었을 때만 제
    // min-content를 알리고, 그때도 탭 줄을 이는 카드가 제 몸을 격리해(`TAB_ROW_CARD`) 넓은 문서 · xterm이 그 바닥을 부풀리지 않는다
    // — 옆 칸이 선 줄은 두 카드의 머리를 알린다(`BesideBox`). 머리 줄은 머리 카드의 할 일만 알린다(이름은 격리한다 — `HeadCard`).
    <div data-tauri-drag-region className="flex min-h-0 min-w-min flex-1 flex-col bg-surface-shell">
      <HeadRow
        sidebarOpen={sidebarOpen}
        head={head}
        toggle={rail && <PanelToggle open={rail.open} onToggle={rail.onToggle} controls={panel ? panelId : undefined} />}
      />
      {/* 아래 줄 — 본문 열과 레일 열. 머리 줄 바로 아래(카드 위끝)에서 시작한다. */}
      <div data-tauri-drag-region className="flex min-h-0 flex-1">
        <div data-tauri-drag-region className={cn("flex flex-1 flex-col pb-(--gap)", TAB_ROW_COLUMN)}>
          {/* 카드 줄. 사이드바가 열렸으면 왼쪽 틈이 0이다 — 사이드바 쪽 여백이 그 틈으로 보인다(프로토타입 `.at-main` ·
              `.at-sidebar`). 사이드바가 접히면 카드가 창 왼쪽 틈까지 넓어진다. 여백은 머리 줄의 여백과 같은 곡선으로
              따라온다 — 사이드바 폭 트랜지션(`PANEL_MOTION`)과 박자가 다르면 카드 모서리가 자리를 지나쳤다 되돌아온다(index.css의
              `--ease-panel`). `relative`는 `overlay`의 기준이다. 탭 줄을 품었거나 옆 칸이 서면 이 줄은 본문 열의 격리
              (`TAB_ROW_COLUMN`)를 벗는다 — 탭 줄을 이는 카드의 바닥 · 두 카드의 머리가 모자라면 사이드바가 자리를 내준다. */}
          <div
            data-tauri-drag-region
            style={beside ? { contain: "none" } : undefined}
            className={cn(
              "relative flex min-h-0 flex-1 pr-(--gap) transition-[padding]",
              PANEL_MOTION,
              sidebarOpen ? "pl-0" : "pl-(--gap)",
            )}
          >
            {list && <ListBox slot={list} />}
            {split ? <SplitBox slot={split} /> : children}
            {beside && <BesideBox slot={beside} />}
            {panel && <PanelBox id={panelId} slot={panel} />}
            {overlay}
          </div>
        </div>
        {/* 레일 열(ui-refresh 결정 10) — 본문 열의 형제라 머리 줄 `<header>` 밖이다. 왼쪽 틈은 본문 열의 오른쪽 틈(카드 줄의
            `pr-(--gap)`)이다. 늘 그 자리에 서고(`shrink-0`) 탭 줄의 바닥을 위해 자리를 내주는 것은 작업 패널, 그다음 사이드바다. */}
        {rail && (
          <Rail
            open={rail.open}
            items={rail.items}
            active={rail.active}
            onPick={rail.onPick}
            controls={panel ? panelId : undefined}
          />
        )}
      </div>
    </div>
  );
}

/**
 * 왼쪽 목록 칸(ui-refresh 결정 15 — 칸 하나 = 카드 하나). **접히는 바깥 상자의 폭이 「카드 + 오른쪽 틈」이다** — 닫히면 둘이 함께
 * 0으로 접혀, 닫힌 칸 옆에 틈이 겹쳐 남지 않고 본문 카드가 사이드바 쪽 끝까지 넓어진다. 틈은 안쪽 열의 오른쪽 여백이다(카드 줄에
 * flex `gap`을 쓰지 않는 까닭).
 *
 * 접힘은 사이드바 · 작업 패널과 같은 장치다 — 바깥 상자의 폭 트랜지션(`PANEL_MOTION`)과, 접히는 동안 고정 폭으로 버티는 안쪽 열
 * (`foldingInnerClass`). 끄는 동안에는 트랜지션을 꺼서 폭이 커서를 곧장 따라온다.
 *
 * 폭은 **카드의 폭**이고(`--panel-width`, 저장 키는 화면의 것), 틈은 그 위에 더해 그린다. 손잡이는 카드 모서리가 아니라 그 틈의
 * 가운데에 얹힌다. 바깥 상자 · 안쪽 열 모두 끌기 영역이다 — 틈이 드러나는 상자는 모두 단다(머리말).
 */
function ListBox({ slot }: { slot: SideSlot }) {
  const { open, size, label, children } = slot;
  return (
    <div
      data-tauri-drag-region
      // 화면 둘(Projects · Archive)이 같은 이름을 각자 세운다 — 한 번에 한 화면만 서고, 이 상자 안에서만 읽힌다.
      style={{ "--panel-width": `${size.width}px` } as CSSProperties}
      className={cn(
        "relative flex shrink-0 overflow-hidden",
        !size.dragging && PANEL_MOTION,
        !size.dragging && "transition-[width]",
        open ? "w-[calc(var(--panel-width)+var(--gap))]" : "w-0",
      )}
    >
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-full w-[calc(var(--panel-width)+var(--gap))] shrink-0 pr-(--gap)",
          foldingInnerClass(open),
        )}
      >
        <Card label={label} className="flex-1">
          {children}
        </Card>
      </div>
      {open && <ResizeHandle control={size} seat="gap" />}
    </div>
  );
}

/**
 * 오른쪽 작업 패널 칸(ui-refresh 결정 4 · 15 — 칸 하나 = 카드 하나). 바깥 상자가 두 번째 `<aside>`이고(e2e `tab-row-floor`가 `aside`
 * 순서를 잰다) **폭이 「왼쪽 틈 + 카드」다** — 접히면 둘이 함께 0이 되어 문서 카드가 오른쪽 틈 끝까지 넓어진다. 틈은 안쪽 열의
 * 왼쪽 여백이고, 손잡이는 그 틈의 가운데에 선다(여전히 `aside`의 자손이다). 목록 칸과 같은 짜임이고 다른 것은 줄어드는 몫이다.
 *
 * 폭은 **카드의 폭**이다(`--work-panel-width` — 목록 칸의 `--panel-width`와 이름을 가른 것은 같은 이름이 두 상자에서 다른 값을
 * 들면 어느 쪽이 이겼는지가 상속 자리에 달려서다). 틈은 그 위에 더해 그린다.
 *
 * **이 칸은 줄어든다**(`shrink-0`이 없다). 창이 좁으면 끄는 최소 폭(`--work-panel-min`, 폭 훅이 받은 값)까지 문서 카드에 자리를
 * 내주고, 문서 카드에는 **그 최소 폭만큼은 남긴다**(`max-width`). 문서 카드는 머리에 탭 줄을 이고 그 줄의 바닥 아래로는 안
 * 준다(`TAB_ROW_CARD`) — 패널이 최소 폭까지 줄고도 둘이 카드 줄에 안 들면 그 합이 본문 열의 바닥이 되어 사이드바가 자리를
 * 내준다. 줄어드는 것은 **그려진 폭**뿐이고 저장한 폭은 그대로라 창을 넓히면 돌아온다.
 *
 * 폭을 `width`가 아니라 `flex-basis`로 주고 `contain-inline-size`를 다는 것은 이 칸이 제 내용이 아니라 최소 폭으로만 카드 줄의
 * min-content에 들어가게 하는 장치다 — 탭 줄을 품은 카드 줄은 제 min-content를 본문 열의 바닥으로 알리는데(`TAB_ROW_COLUMN`),
 * 넓은 트리 이름이 그 바닥도 칸의 폭도 정하지 않는다. 최소 폭은 **펼 때만** 트랜지션한다 — 펴는 순간 곧장 서면 0에서 최소 폭으로 튄 뒤
 * 자란다(접을 때는 곧장 걷는다). 접힘은 사이드바 · 목록 칸과 같은 장치다(`PANEL_MOTION` · `foldingInnerClass`). 끄는 동안에는 트랜지션을 꺼서 폭이 커서를
 * 곧장 따라온다. translateX로 밀어내는 길은 이미 실패한 길이다 — 제 상자 밖 넘침을 문서가 받아 도는 동안 가로 스크롤이 깜빡인다.
 *
 * `id`는 패널 토글 · 레일 칸이 가리키는 자리다(`aria-controls`). 접혀도 이 상자는 그대로 서 있어(폭만 0) 가리킴이 끊기지 않는다.
 */
function PanelBox({ id, slot }: { id: string; slot: SideSlot }) {
  const { open, size, label, children } = slot;
  return (
    <aside
      id={id}
      data-tauri-drag-region
      style={{ "--work-panel-width": `${size.width}px`, "--work-panel-min": `${size.min}px` } as CSSProperties}
      className={cn(
        "relative flex overflow-hidden contain-inline-size",
        !size.dragging && PANEL_MOTION,
        !size.dragging && (open ? "transition-[flex-basis,min-width]" : "transition-[flex-basis]"),
        open
          ? "max-w-[calc(100%-var(--work-panel-min))] basis-[calc(var(--work-panel-width)+var(--gap))] min-w-[calc(var(--work-panel-min)+var(--gap))]"
          : "basis-0 min-w-0",
      )}
    >
      {/* 접히는 동안 글이 되흐르지 않게 안쪽은 고정 폭이고, **펴진 뒤에만** 바깥 폭을 상한으로 받는다 — 좁게 선 칸에서 카드
          오른쪽이 잘리지 않게. 박자와 까닭은 `panel-layout`의 `foldingInnerClass`에 있다. */}
      <div
        data-tauri-drag-region
        className={cn(
          "flex h-full w-[calc(var(--work-panel-width)+var(--gap))] shrink-0 pl-(--gap)",
          foldingInnerClass(open),
        )}
      >
        <Card label={label} className="flex-1">
          {children}
        </Card>
      </div>
      {open && <ResizeHandle control={size} seat="gap" />}
    </aside>
  );
}

/**
 * 분할의 두 열이 나눠 갖는 폭 — `<main>`의 폭에서 두 열 사이 틈 하나를 뺀다(아래 `SplitBox`). 틈은 토큰(`--gap`)에서 읽는다 — 숫자를
 * 여기 적으면 토큰이 바뀌는 날 이 자리만 낡는다. 상자를 못 읽었으면 0이고, 그러면 비율 훅이 움직이지 않는다(`nextRatio`).
 */
function sharedWidth(host: HTMLElement | null): number {
  if (!host) return 0;
  const gap = parseFloat(getComputedStyle(host).getPropertyValue("--gap")) || 0;
  return Math.max(0, host.getBoundingClientRect().width - gap);
}

/**
 * 분할(ui-refresh 결정 15 — 열 하나 = 카드 하나). 본문 자리의 `<main>` 안에 열 카드 둘이 틈(`--gap`)을 두고 선다. `<main>`은 카드가
 * 아니라 회색 바탕이 드러나는 자리라 창을 끄는 자리다(머리말).
 *
 * **몫을 드는 것은 왼쪽 열 하나다** — 오른쪽이 남는 자리를 먹는다(패널 · 사이드바와 같은 관용구). 왼쪽 열의 상자가 「카드 + 오른쪽
 * 틈」이라 그 상자에 회색 틈이 드러나 끌기 영역을 달고, 폭 손잡이는 그 틈의 가운데에 선다. 오른쪽 열의 상자는 카드 그대로라 틈이 없다.
 *
 * 몫은 **비율**이다(`useSplitRatio` 머리말 — 두 열이 같은 본문을 나눠 갖는다). 비율은 **틈을 뺀 폭**에 걸어 반반이면 두 카드가 같은
 * 폭이고, 끄는 손이 재는 분모도 같은 폭이다(`sharedWidth`) — 둘이 갈리면 손잡이가 포인터에서 미끄러진다. 그래서 그리는 식과 재는
 * 식이 이 한 곳에 산다. 폭이 비율이라 늘 트랜지션을 걸 수 없고(창을 끄는 내내 두 열이 손을 늦게 따라온다), 더블클릭으로 반반에
 * 돌아가는 순간(`snapping`)만 접히는 칸과 같은 박자(`PANEL_MOTION`)로 움직인다 — 한 화면에서 두 폭이 다른 속도로 움직이면 한 동작으로
 * 안 읽힌다.
 *
 * 비율 상태는 분할이 서 있는 동안 이 상자가 든다. 끈 비율은 손을 떼는 순간 저장되므로, 분할을 껐다 다시 켜도 같은 몫으로 선다.
 *
 * **탭 줄을 머리에 인 열(터미널 열)은 그 줄의 바닥 아래로 안 준다**(`TAB_ROW_CARD` — 칸 하나는 늘 보인다). 두 열 상자가 제
 * min-content(`min-w-min`)까지만 줄고 — 열 카드가 탭 줄 아닌 자식을 격리해 그 값이 탭 줄의 바닥이고, 줄이 없는 문서 열은 0이다 —
 * 왼쪽 상자도 줄어든다(`shrink-0`이 없다). 그래서 좁은 창에서 터미널 열이 바닥에 닿으면 반대쪽 문서 열이 비율보다 좁게 선다. 비율은
 * 그대로라 창을 넓히면 돌아온다. `<main>`도 두 바닥의 합 아래로 안 줄어 모자라면 패널 · 사이드바가 자리를 내준다.
 */
function SplitBox({ slot }: { slot: SplitSlot }) {
  const host = useRef<HTMLElement>(null);
  const size = useSplitRatio(slot.ratioKey, () => sharedWidth(host.current));
  const [left, right] = slot.columns;
  return (
    <main ref={host} data-tauri-drag-region className="flex min-h-0 min-w-min flex-1">
      <div
        data-tauri-drag-region
        style={{ width: `calc((100% - var(--gap)) * ${size.ratio} + var(--gap))` }}
        className={cn(
          "relative flex min-w-min pr-(--gap)",
          size.snapping && PANEL_MOTION,
          size.snapping && "transition-[width]",
        )}
      >
        <ColumnCard column={left} />
        <ResizeHandle control={size} seat="gap" />
      </div>
      <div className="relative flex min-w-min flex-1">
        <ColumnCard column={right} />
      </div>
    </main>
  );
}

/**
 * 분할의 열 카드 하나 — 문서 열은 흰 카드, 터미널 열은 터미널 카드다. 두 열의 카드가 같아야 하는데 좌우가 바뀌므로 한 벌로 그린다. 바닥도
 * 같은 클래스다 — 탭 줄을 머리에 인 열만 그 줄의 폭을 바닥으로 알리고, 줄이 없는 열은 자식이 모두 격리되어 바닥이 없다(`TAB_ROW_CARD`).
 */
function ColumnCard({ column }: { column: SplitColumn }) {
  return (
    <Card label={column.label} tone={column.tone} className={cn("flex-1", TAB_ROW_CARD)}>
      {column.children}
    </Card>
  );
}

/**
 * 본문 카드 오른쪽의 옆 칸(ui-refresh 결정 15 · 27, 판 06 티켓 07 — 편집기 트리). **늘 열려 있고** 접힘 · 폭 손잡이 · 레일이 없어
 * 분할의 두 열처럼 본문 카드와 나란히 카드 줄에 선다. 그래서 `aside`가 아니다(`aside`는 사이드바와 작업 패널 둘뿐이다 — `tab-row-floor` ·
 * `works-sidebar`가 그 순서를 센다). 상자가 「왼쪽 틈 + 카드」이고 틈은 안쪽 왼쪽 여백이다. 회색 틈이 드러나는 상자라 끌기 영역이다.
 *
 * 폭을 `flex-basis`로 주고 줄어들게 둔다(`min-w-0`) — 창이 좁아 본문 카드가 제 최소 폭보다 좁아질 때만 그만큼 자리를 내준다. 앱의 최소
 * 창(900)에서 사이드바를 연 채면 고정 폭을 고집하는 순간 본문 카드 머리의 조작이 카드 모서리에 잘린다. 작업 패널 칸이 문서 카드에
 * 최소 폭을 남기는 것과 같은 손버릇이다(`PanelBox`). 본문 카드의 최소 폭은 그 카드의 몫이다(화면이 건넨다 — 편집기는 머리의 폭).
 *
 * **두 카드의 머리가 탭 줄처럼 바닥이다.** 옆 칸이 선 카드 줄은 본문 열의 격리를 벗고(위 카드 줄), 이 카드의 몸은 제 내용 폭을 안
 * 알린다(`contain-inline-size`) — 그래서 줄의 min-content가 본문 카드의 바닥과 이 카드 머리의 폭이고, 둘이 창에 안 들면 사이드바가
 * 자리를 내준다. 머리의 글자는 시스템 글꼴이라 OS마다 폭이 달라(codex-ds 결정 3) 그 합을 수로 적어 둘 수 없다.
 */
function BesideBox({ slot }: { slot: BesideSlot }) {
  return (
    <div
      data-tauri-drag-region
      style={{ flexBasis: `calc(${slot.width}px + var(--gap))` }}
      className="flex min-w-0 pl-(--gap)"
    >
      <Card label={slot.label} className="flex-1 [&>:not([data-slot=card-head])]:contain-inline-size">
        {slot.children}
      </Card>
    </div>
  );
}

/**
 * 머리 줄 — 창 맨 위 48의 `<header>` 하나(codex-ds 스펙 §4 · DS `AppShell` — 틈 8 · 머리 카드 32 · 틈 8). 문서의 `header`는 이 줄
 * 하나다 — 탭 줄은 이 줄이 아니라 본문 카드의 머리이고 `div`다(`ShellTabs`). 머리 카드(`head`)가 있으면 본문 열 폭으로 서고, 작업
 * 화면이면 그 오른쪽 끝 너머 레일 바로 위에 패널 토글이 선다. 둘 다 없으면 창을 끄기만 하는 빈 줄이다(ui-refresh 결정 5).
 *
 * **뿌리의 맨 위 줄이라 폭이 바탕 전체다**(본문 열 + 레일 열). 머리 카드의 오른쪽 끝이 본문 열의 오른쪽 끝과 한 세로줄인 것은 오른쪽
 * 셈이 아래 줄과 같아서다 — 패널 토글 자리(틈 + 레일 폭)가 레일 열과 같은 폭을 비우고, 오른쪽 여백(`pr-(--gap)`)이 레일 열 · 카드 줄의
 * 오른쪽 틈과 같은 값이다.
 *
 * **신호등 inset은 이 줄 하나만 계산한다.** 사이드바가 열렸으면 왼쪽 여백이 0이라 머리 카드가 본문 카드와 한 세로줄(사이드바 뒤)에서
 * 시작하고 — 신호등 · 창 컨트롤은 사이드바 위에 선다 — 접혔으면 `--titlebar-inset-head`(창 컨트롤 끝 + 틈)다(index.css의
 * `[data-titlebar]`). 여백은 사이드바 폭과 같은 박자(`PANEL_MOTION`)로 따라온다.
 *
 * **머리 카드 밖 회색이 창을 끄는 자리다** — 이 줄과 패널 토글 자리가 `data-tauri-drag-region`을 든다(머리말). 머리 카드는 카드라
 * 안이 끌기 영역이 아니고, 줄 안의 버튼은 이 속성이 없어 그대로 눌린다.
 */
function HeadRow({ sidebarOpen, head, toggle }: { sidebarOpen: boolean; head?: HeadSlot; toggle?: ReactNode }) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        // 아래 경계선이 없다 — 바탕이 선으로 잘리지 않고 카드 줄로 이어진다.
        "flex h-(--titlebar-height) shrink-0 items-center pr-(--gap) transition-[padding]",
        PANEL_MOTION,
        sidebarOpen ? "pl-0" : "pl-(--titlebar-inset-head)",
      )}
    >
      {head && <HeadCard {...head} />}
      {toggle && (
        // 패널 토글 자리 — 레일 열과 같은 폭(틈 + 레일)이라 토글이 레일 열의 가운데에 선다(DS `.at-railtop`). 회색이 드러나는
        // 상자라 끌기 영역이다. 머리 카드가 없으면 줄 오른쪽 끝에 붙는다(`ml-auto`).
        <div data-tauri-drag-region className="ml-auto box-content flex w-(--rail) shrink-0 justify-center pl-(--gap)">
          {toggle}
        </div>
      )}
    </header>
  );
}

/**
 * 머리 카드(codex-ds 스펙 §4 · DS `HeadCard` · `.at-winhead`) — 머리 줄에 뜬 흰 카드. 32(`size-head`) · `radius-xl` · `surface`에 0.5px
 * 링(`shadow-hairline`)이고, 폭은 머리 줄이 남긴 자리 전부(`flex-1` — 본문 열)다. 링을 바탕 위 카드처럼 안쪽에 덮어 그리지 않는다 —
 * 넘침을 숨기는 조상이 없어 바깥 링이 잘리지 않는다(`Card`의 안쪽 링은 접히는 칸의 상자 때문이다).
 *
 * 왼쪽은 아이콘 · 이름뿐이다(DS `.at-wtitle` — 24 · 안쪽 8 · 사이 7, 이름 13/500 `fg`, 아이콘 14 `fg-secondary`). 카드 안쪽 8에 이름
 * 칸의 안쪽 8이 더해져 아이콘이 카드 + 16에 선다 — 아래 본문 카드의 탭 줄 첫 칸과 한 세로줄이다. 오른쪽은 할 일 | 보기 배치다(DS
 * `.at-winctl-r` — 사이 6, 둘을 가르는 세로선 0.5 × 16 `border-heavy`). 위 줄에 서는 것은 모두 24다(창 컨트롤과 같다).
 *
 * **이름은 틀 뿌리의 바닥에 안 든다**(`contain-inline-size`) — 긴 work 이름이 좁은 창에서 사이드바를 밀면 안 된다. 그래서 이름 칸은
 * DS의 「제 글자 폭만큼」(`flex: 0 1 auto`)이 아니라 남는 폭을 먹고(`flex-1`) — 제 폭을 알리지 않는 상자라 글자 폭으로는 서지 못한다 —
 * DS 상한 520(`max-width`)에서 멈추며, 넘치는 이름은 그 안에서 말줄임으로 준다. 오른쪽 묶음은 카드 안쪽 오른쪽 끝에 붙고(`ml-auto` —
 * DS `.at-winctl-r`) 줄지 않는다(`shrink-0`) — 그 폭이 머리 줄의 바닥이라 좁은 창에서도 할 일이 제 폭으로 카드 안에 선다. 표식
 * `data-head-actions`는 그것을 재는 검사가 집는다(e2e `tab-row.ts`의 `rowOf`).
 */
function HeadCard({ icon: Icon, name, actions, view }: HeadSlot) {
  return (
    <div
      data-slot="head-card"
      className="flex h-(--size-head) min-w-0 flex-1 items-center gap-1 rounded-xl bg-surface px-2 shadow-hairline"
    >
      <div className="flex h-6 max-w-[520px] min-w-0 flex-1 items-center gap-1.75 px-2 contain-inline-size">
        <Icon className="size-3.5 shrink-0 text-fg-secondary" />
        <span className="min-w-0 truncate text-chat-meta font-medium text-fg">{name}</span>
      </div>
      {(actions || view) && (
        <div data-head-actions className="ml-auto flex shrink-0 items-center gap-1.5">
          {actions}
          {actions && view && (
            <div role="separator" aria-orientation="vertical" className="mx-0.5 h-4 w-[0.5px] shrink-0 bg-border-heavy" />
          )}
          {view}
        </div>
      )}
    </div>
  );
}

type CardTag = "section" | "main";

interface CardProps {
  /** 카드의 요소. 본문 카드는 `main`이고(문서의 `main`은 하나다), 그 밖은 `section`이다. */
  as?: CardTag;
  /** 카드의 이름(`aria-label`). */
  label: string;
  /** 카드 머리 — 위치 캡슐 줄(`CardHead`)이나 탭 줄(`ShellTabs`)이다. 머리가 없는 카드는 곧바로 내용이 선다(ui-refresh 결정 5). */
  head?: ReactNode;
  /**
   * `terminal`이면 카드 바탕이 **터미널 테마의 바탕**이다(판 04 기본값 — 설정이 밝게면 흰 카드). 셸의 집이 칠하는 값과 같은
   * 출처에서 읽는다(`useShellBackground`) — 둘이 갈리면 둥근 모서리 안쪽에 다른 색의 띠가 선다.
   */
  tone?: "terminal";
  className?: string;
  children: ReactNode;
}

/**
 * 바탕 위에 뜬 둥근 카드 하나(ui-refresh 결정 4 · 15 — 칸 하나 = 카드 하나). 모서리는 카드가 자른다(`overflow-hidden`) — 안의
 * 스크롤 상자 · 셸 화면이 모서리 밖으로 그려지지 않는다. `relative`는 카드 안에 덮이는 것(설정의 메시지 등)의 기준이다.
 *
 * 바탕은 터미널 카드면 설정의 테마에서 읽은 바탕이고, 그 밖은 흰 카드(`bg-surface`)다. **흰 카드와 터미널 카드가 한 컴포넌트다** —
 * 작업 화면의 본문 카드는 문서와 터미널을 오가는데, 둘이 다른 컴포넌트면 오갈 때마다 카드가 새로 서고 머리의 탭 줄도 함께 새로
 * 서서 방금 누른 `spec` 칸의 포커스와 줄의 스크롤을 잃는다. 테마는 터미널 카드만 구독한다 — 흰 카드는 훅이 늘 `undefined`를
 * 돌려줘 설정이 바뀌어도 다시 그려지지 않는다(`useShellBackground`). 모서리는 `radius-2xl`(16)이고
 * 외곽은 실선이 아니라 0.5px 링(`--shadow-hairline`)이다 — 바탕 위 카드의 깊이는 그것뿐이다(DS 「깊이」, codex-ds 결정 27).
 *
 * **링은 카드 안쪽 가장자리에 덮어 그린다**(`::after`의 `inset` 그림자 — 값은 같은 토큰이다). 카드 바깥에 그리는 그림자는 조상의
 * 넘침 숨김에 잘린다: 목록 칸 · 작업 패널의 접히는 바깥 상자가 안쪽 열을 잘라 내려고 넘침을 숨기고, 카드는 그 상자의 세 변에 붙어
 * 선다 — 바깥 링이면 틈 쪽 한 변에만 남는다. 덮개는 카드 내용 위에 서서 내용이 가장자리까지 칠해도 링이 안 가려지고, 누름은
 * 지나보낸다(`pointer-events-none`). 네 변이 칠해지는지는 `e2e/frame.spec.ts`가 픽셀로 잰다.
 */
function Card({ as: Tag = "section", label, head, tone, className, children }: CardProps) {
  const background = useShellBackground(tone === "terminal");
  return (
    <Tag
      aria-label={label}
      data-slot="card"
      data-tone={tone}
      style={background === undefined ? undefined : { backgroundColor: background }}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl",
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:shadow-[inset_var(--shadow-hairline)]",
        tone !== "terminal" && "bg-surface",
        className,
      )}
    >
      {head}
      {children}
    </Tag>
  );
}

/**
 * 카드 머리(ui-refresh 결정 5) — 「지금 보는 것」의 브레드크럼 캡슐과 머리의 버튼이 서는 46px 줄이다(`--card-head` — 탭 줄과 같은
 * `size-toolbar`라 문서 카드에서 탭 줄 아래 이 줄이 서도 두 머리가 한 높이다). `div`이고 끌기 영역이 아니다
 * (카드 안이다). 좌우 여백은 캡슐의 안쪽 여백(14)을 뺀 값이라 캡슐의 글자가 카드 안 여백(`--card-pad`)에 선다.
 *
 * `lead`는 캡슐 앞(하위 화면의 뒤로), `meta`는 캡슐 바로 뒤(상태 배지 등), `end`는 오른쪽 끝에 고정되는 조작이다. 목록 카드의
 * 머리는 위치를 말하지 않는다 — 캡슐 자리에 검색칸(`children`)이 선다.
 */
function CardHead({
  lead,
  crumbs,
  meta,
  end,
  children,
  ...marks
}: {
  lead?: ReactNode;
  /** 뿌리부터 지금 선 곳까지(`Crumbs`). 마지막이 지금 선 곳이다. */
  crumbs?: readonly string[];
  meta?: ReactNode;
  end?: ReactNode;
  /** 캡슐 자리에 서는 다른 것 — 목록 카드 머리의 검색칸 · 작업 패널 머리의 제목(고른 레일 칸). */
  children?: ReactNode;
  /** 검사가 머리를 정체성으로 집는 표식(분할 열 머리의 `data-column` 등) — 모양(클래스)으로 집으면 규격을 손보는 날 샌다. */
  [mark: `data-${string}`]: string | undefined;
}) {
  return (
    <div
      {...marks}
      data-slot="card-head"
      className="flex h-(--card-head) shrink-0 items-center gap-1.5 px-[calc(var(--card-pad)-14px)]"
    >
      {lead}
      {crumbs && <Crumbs items={crumbs} />}
      {children}
      {meta}
      {end && <div className="ml-auto flex shrink-0 items-center gap-1.5">{end}</div>}
    </div>
  );
}

export { Card, CardHead, Frame };
