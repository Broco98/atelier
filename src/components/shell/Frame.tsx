import { useId, useRef, type CSSProperties, type ReactNode } from "react";
import { Crumbs } from "@/components/ui/crumbs";
import { useShellBackground } from "@/features/terminal/terminal-settings";
import { cn } from "@/lib/utils";
import { foldingInnerClass, PANEL_MOTION, TAB_ROW_COLUMN } from "./panel-layout";
import Rail, { type RailProps } from "./Rail";
import { ResizeHandle, type ResizableWidth } from "./useResizableWidth";
import useSplitRatio from "./useSplitRatio";

// 화면의 **공용 틀**(ui-refresh 결정 27). 옅은 회색 바탕(`bg-chrome`) 위에 44px 바탕 줄이 서고, 그 아래 목록 · 본문 · 패널이
// 각자 둥근 흰 카드로 뜬다(ui-refresh 결정 4). 화면은 카드 내용만 건넨다 — 틈 · 끌기 영역 · 손잡이 · 신호등 inset을 이 파일 한 곳이
// 지킨다. 일곱 화면이 저마다 그 규칙을 적으면 한 화면만 틈 하나를 빠뜨려도 화면으로는 어디가 죽었는지가 안 보인다. 분할의 두 열과
// 편집기의 트리 카드도 이 틀의 칸이다(`split` · `beside`) — 한때 두 화면이 그 칸의 틈 · 끌기 영역 · 손잡이를 제 손으로 다시 적었다.
//
//   뿌리(bg-chrome) ─ 본문 열(TAB_ROW_COLUMN, 아래 틈) ─ 바탕 줄 `<header>`(TitleBar)
//                  │                                 └ 카드 줄(오른쪽 틈 · 사이드바를 접으면 왼쪽 틈)
//                  │                                     ─ list · 본문(카드 하나, 또는 분할의 열 카드 둘) · beside · panel · overlay
//                  └ 레일 열(rail이 있을 때만, 오른쪽 틈) ─ 패널 토글(바탕 줄 띠의 가운데) · 칸 묶음(카드 줄 꼭대기부터)
//
// **틈도 창을 끄는 자리다.** Tauri는 누른 요소 **자신**의 `data-tauri-drag-region`만 본다 — 회색 틈이 드러나는 상자(뿌리 ·
// 본문 열 · 카드 줄 · 레일 열 · 접히는 바깥 상자 · 분할의 `<main>`과 왼쪽 열 상자 · 옆 칸) 모두에 단다. 하나라도 빠지면 그 틈은
// 창을 못 끄는 죽은 자리가 된다. 카드 안(카드 머리의 빈 자리도)은 끌기 영역이 아니다. 틈의 실제 자리와 그 자리를 누르면 무엇이
// 눌리는지는 `e2e/frame.spec.ts`가 잰다.
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

interface FrameProps<Id extends string> {
  /** 사이드바가 열렸나 — 바탕 줄의 왼쪽 여백과 카드 줄의 왼쪽 틈이 이것으로 갈린다. */
  sidebarOpen: boolean;
  /** 바탕 줄에 서는 것(탭 줄). 없으면 창을 끄기만 하는 빈 줄이다(ui-refresh 결정 5 — 탭이 없는 화면). */
  titlebar?: ReactNode;
  /**
   * 왼쪽 목록 카드 — `section`이다(`aside`는 사이드바와 작업 패널 둘뿐이다). 접힘 · 폭 손잡이 · 카드 오른쪽 틈은 이 틀이 들고,
   * 화면은 카드 안(머리와 몸)만 건넨다.
   */
  list?: SideSlot;
  /** 오른쪽 작업 패널 카드 — 바깥 상자가 두 번째 `<aside>`다. */
  panel?: SideSlot;
  /**
   * 작업 화면의 레일 열(`Rail`) — 패널 토글과 칸 묶음. 작업을 고른 작업 화면만 건넨다 — 없으면 레일 열이 없고 본문 열의
   * 오른쪽 틈 하나가 창 끝이다. 칸의 id 타입(`Id`)이 부르는 쪽의 것 그대로 `onPick`까지 간다.
   */
  rail?: RailProps<Id>;
  /**
   * 분할 — 본문 자리에 `<main>`이 서고 그 안에 열 카드 둘이 선다(`SplitSlot`). 주면 `children`은 그리지 않는다 — 본문은 하나다.
   */
  split?: SplitSlot;
  /** 본문 카드 오른쪽의 옆 칸 — 늘 열린 고정 폭 카드(`BesideSlot`). 편집기 트리 카드 하나가 쓴다. */
  beside?: BesideSlot;
  /**
   * 카드 줄 위를 덮는 것(놓기 겹판 · 토스트 · 생애 겹판). 카드 줄이 바탕 줄 **아래**에서 시작하므로 머리행을 빼는 계산 없이
   * 「끄는 것이 출발한 줄은 덮지 않는다」가 상자로 선다.
   */
  overlay?: ReactNode;
  /** 본문 카드(`<Card as="main">`). 분할이면(`split`) 비워 둔다. */
  children?: ReactNode;
}

function Frame<Id extends string>({
  sidebarOpen,
  titlebar,
  list,
  panel,
  rail,
  split,
  beside,
  overlay,
  children,
}: FrameProps<Id>) {
  // 레일의 토글 · 칸이 가리키는 패널 칸(`aria-controls`). 둘을 이 틀이 함께 그리므로 이음도 여기서 짓는다 — 화면은 모른다.
  const panelId = useId();
  return (
    // **뿌리가 제 min-content를 바깥에 알린다**(`min-w-min`) — 그것이 탭 줄의 바닥(`TAB_ROW_COLUMN`)이 사이드바에게 자리를
    // 요구하는 길이다. 카드 줄은 제 내용 폭을 안 알리므로(아래) 넓은 문서 · xterm이 그 바닥을 부풀리지 않는다.
    <div data-tauri-drag-region className="flex min-h-0 min-w-min flex-1 bg-chrome">
      <div data-tauri-drag-region className={cn("flex flex-1 flex-col pb-(--gap)", TAB_ROW_COLUMN)}>
        <TitleBar sidebarOpen={sidebarOpen}>{titlebar}</TitleBar>
        {/* 카드 줄. 사이드바가 열렸으면 왼쪽 틈이 0이다 — 사이드바 쪽 여백이 그 틈으로 보인다(프로토타입 `.at-main` ·
            `.at-sidebar`). 사이드바가 접히면 카드가 창 왼쪽 틈까지 넓어진다. 여백은 바탕 줄의 여백과 같은 곡선으로
            따라온다 — 사이드바 폭 트랜지션(`PANEL_MOTION`)과 박자가 다르면 카드 모서리가 자리를 지나쳤다 되돌아온다(index.css의
            `--ease-panel`). `relative`는 `overlay`의 기준이다. */}
        <div
          data-tauri-drag-region
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
      {/* 레일 열(ui-refresh 결정 10) — 본문 열의 형제라 바탕 줄 `<header>` 밖이다. 왼쪽 틈은 본문 열의 오른쪽 틈(바탕 줄 · 카드
          줄의 `pr-(--gap)`)이다. 늘 그 자리에 서고(`shrink-0`) 탭 줄의 바닥을 위해 자리를 내주는 것은 작업 패널, 그다음 사이드바다. */}
      {rail && <Rail {...rail} controls={panel ? panelId : undefined} />}
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
 * 내주고, 문서 카드에는 **그 최소 폭만큼은 남긴다**(`max-width`) — 패널이 탭 줄 아래 카드 줄로 내려와 탭 줄과 폭을 다투지 않게
 * 되면서, 한때 탭 줄의 바닥이 문서 열에 남겨 주던 자리를 이 상한이 대신 남긴다. 줄어드는 것은 **그려진 폭**뿐이고 저장한 폭은
 * 그대로라 창을 넓히면 돌아온다.
 *
 * 폭을 `width`가 아니라 `flex-basis`로 주고 `contain-inline-size`를 다는 것은 이 칸이 제 내용이 아니라 최소 폭으로만 줄의
 * min-content에 들어가게 하던 장치다. 카드 줄은 이제 제 폭을 바깥에 안 알리지만(`TAB_ROW_COLUMN`) 칸의 성질로 그대로 둔다 —
 * 넓은 트리 이름이 칸의 폭을 정하지 않는다. 최소 폭은 **펼 때만** 트랜지션한다 — 펴는 순간 곧장 서면 0에서 최소 폭으로 튄 뒤
 * 자란다(접을 때는 곧장 걷는다). 접힘은 사이드바 · 목록 칸과 같은 장치다(`PANEL_MOTION` · `foldingInnerClass`). 끄는 동안에는 트랜지션을 꺼서 폭이 커서를
 * 곧장 따라온다. translateX로 밀어내는 길은 이미 실패한 길이다 — 제 상자 밖 넘침을 문서가 받아 도는 동안 가로 스크롤이 깜빡인다.
 *
 * `id`는 레일의 토글 · 칸이 가리키는 자리다(`aria-controls`). 접혀도 이 상자는 그대로 서 있어(폭만 0) 가리킴이 끊기지 않는다.
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
 */
function SplitBox({ slot }: { slot: SplitSlot }) {
  const host = useRef<HTMLElement>(null);
  const size = useSplitRatio(slot.ratioKey, () => sharedWidth(host.current));
  const [left, right] = slot.columns;
  return (
    <main ref={host} data-tauri-drag-region className="flex min-h-0 min-w-0 flex-1">
      <div
        data-tauri-drag-region
        style={{ width: `calc((100% - var(--gap)) * ${size.ratio} + var(--gap))` }}
        className={cn(
          "relative flex min-w-0 shrink-0 pr-(--gap)",
          size.snapping && PANEL_MOTION,
          size.snapping && "transition-[width]",
        )}
      >
        <ColumnCard column={left} />
        <ResizeHandle control={size} seat="gap" />
      </div>
      <div className="relative flex min-w-0 flex-1">
        <ColumnCard column={right} />
      </div>
    </main>
  );
}

/** 분할의 열 카드 하나 — 문서 열은 흰 카드, 터미널 열은 터미널 카드다. 두 열의 카드가 같아야 하는데 좌우가 바뀌므로 한 벌로 그린다. */
function ColumnCard({ column }: { column: SplitColumn }) {
  return (
    <Card label={column.label} tone={column.tone} className="flex-1">
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
 * 최소 폭을 남기는 것과 같은 손버릇이다(`PanelBox`). 본문 카드의 최소 폭은 그 카드의 몫이다(화면이 건넨다).
 */
function BesideBox({ slot }: { slot: BesideSlot }) {
  return (
    <div
      data-tauri-drag-region
      style={{ flexBasis: `calc(${slot.width}px + var(--gap))` }}
      className="flex min-w-0 pl-(--gap)"
    >
      <Card label={slot.label} className="flex-1">
        {slot.children}
      </Card>
    </div>
  );
}

/**
 * 바탕 줄 — 창 맨 위 44px의 `<header>` 하나(ui-refresh 결정 5). 문서의 **첫 `header`가 이 줄이다**(e2e `tab-row.ts`가 그것을
 * 탭 줄로 집는다). 탭 줄(`ShellTabs`)의 칸들이 이 줄의 자식으로 바로 서고, 탭이 없는 화면에서는 비어 있는 끌기 줄이다.
 *
 * **신호등 inset은 이 줄 하나만 계산한다.** 왼쪽 여백은 사이드바가 열렸으면 `--tab-lead`(사이드바 경계에서 재는 거리),
 * 접혔으면 `--titlebar-inset-tabs`(셸 컨트롤 뒤 같은 거리)다 — 갈라 두면 ⌘B로 접었다 펴는 동안 첫 칸이 두 리듬으로 움직인다
 * (index.css의 `[data-titlebar]`). 여백은 사이드바 폭과 같은 박자(`PANEL_MOTION`)로 따라온다. 오른쪽 여백은 카드 줄의 오른쪽
 * 틈과 같은 값이라 오른쪽 끝 조작이 카드 모서리와 한 줄에 선다.
 *
 * 줄 안의 버튼들은 이 속성이 없으므로 그대로 눌린다 — 칸 사이 빈 자리와 끄는 여백은 탭 줄이 제 자식에 단다.
 */
function TitleBar({ sidebarOpen, children }: { sidebarOpen: boolean; children?: ReactNode }) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        // 아래 경계선이 없다 — 바탕이 선으로 잘리지 않고 카드 줄로 이어진다.
        "flex h-(--titlebar-height) shrink-0 items-center gap-1 pr-(--gap) transition-[padding]",
        PANEL_MOTION,
        sidebarOpen ? "pl-(--tab-lead)" : "pl-(--titlebar-inset-tabs)",
      )}
    >
      {children}
    </header>
  );
}

type CardTag = "section" | "main";

interface CardProps {
  /** 카드의 요소. 본문 카드는 `main`이고(문서의 `main`은 하나다), 그 밖은 `section`이다. */
  as?: CardTag;
  /** 카드의 이름(`aria-label`). */
  label: string;
  /** 카드 머리(`CardHead`). 터미널 카드처럼 머리가 없는 카드는 곧바로 내용이 선다(ui-refresh 결정 5). */
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
 */
function Card(props: CardProps) {
  return props.tone === "terminal" ? <TerminalCard {...props} /> : <CardBox {...props} />;
}

/** 터미널 카드 — 설정의 테마를 구독하는 것은 이 갈래뿐이다(다른 카드가 설정이 바뀔 때마다 다시 그려질 까닭이 없다). */
function TerminalCard(props: CardProps) {
  const background = useShellBackground();
  return <CardBox {...props} background={background} />;
}

/** 카드의 상자. 바탕은 터미널 카드면 그 갈래가 읽어 건넨 테마의 바탕이고, 그 밖은 흰 카드(`bg-card`)다. */
function CardBox({
  as: Tag = "section",
  label,
  head,
  tone,
  className,
  background,
  children,
}: CardProps & { background?: string }) {
  return (
    <Tag
      aria-label={label}
      data-slot="card"
      data-tone={tone}
      style={background === undefined ? undefined : { backgroundColor: background }}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card",
        tone !== "terminal" && "bg-card",
        className,
      )}
    >
      {head}
      {children}
    </Tag>
  );
}

/**
 * 카드 머리(ui-refresh 결정 5) — 「지금 보는 것」의 브레드크럼 캡슐과 알약 버튼이 서는 48px 줄이다. `div`이고 끌기 영역이 아니다
 * (카드 안이다). 좌우 여백은 캡슐 · 알약의 안쪽 여백(14)을 뺀 값이라 캡슐의 글자가 카드 안 여백(`--card-pad`)에 선다.
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
