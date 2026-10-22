import {
  createContext,
  Fragment,
  useContext,
  useId,
  useRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { ChevronRight, GitFork, Pencil, Search, type LucideIcon } from "lucide-react";
import { TARGET_MENU_ARIA, openMenuByKey } from "@/components/ui/context-menu";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { InlineRename } from "@/components/ui/inline-rename";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { useShellBackground } from "@/features/terminal/terminal-settings";
import { HOTKEYS, pressed } from "@/lib/hotkeys";
import type { RovingBox } from "@/lib/roving";
import { cn } from "@/lib/utils";
import { cardGapPx, foldingInnerClass, PANEL_MOTION, TAB_ROW_CARD, TAB_ROW_COLUMN, useFoldedFocus } from "./panel-layout";
import PanelToggle from "./PanelToggle";
import Rail, { railStands, type RailProps } from "./Rail";
import { ResizeHandle, type ResizableWidth } from "./useResizableWidth";
import type { TargetRegion } from "./TargetMenu";
import useSplitRatio from "./useSplitRatio";

// 화면의 **공용 틀**(ui-refresh 결정 27). 옅은 회색 바탕(`bg-surface-shell`) 맨 위에 48 머리 줄이 서고(codex-ds 스펙 §4), 그 아래
// 본문 · 패널이 각자 둥근 흰 카드로 뜬다(ui-refresh 결정 4). 목록은 따로 뜨지 않고 본문 카드 안 오른쪽 칸이다(codex-ds 결정 28 — 내용 |
// 목록 한 카드). 머리 줄에는 지금 보는 것을 말하는 머리 카드가 뜬다. 화면은
// 카드 내용만 건넨다 — 틈 · 끌기 영역 · 손잡이 · 신호등 inset을 이 파일 한 곳이
// 지킨다. 일곱 화면이 저마다 그 규칙을 적으면 한 화면만 틈 하나를 빠뜨려도 화면으로는 어디가 죽었는지가 안 보인다. 분할의 두 열과
// 편집기의 트리 카드도 이 틀의 칸이다(`split` · `beside`) — 한때 두 화면이 그 칸의 틈 · 끌기 영역 · 손잡이를 제 손으로 다시 적었다.
// 탭 줄(`ShellTabs`)은 이 틀의 줄이 아니라 본문 카드의 머리다(codex-ds 스펙 §4 「탭 줄」) — 화면이 카드의 `head`로 건넨다.
//
//   뿌리(bg-surface-shell) ─ 머리 줄 `<header>`(HeadRow) ─ 머리 카드(남은 폭 — 레일이 안 서면 끝에 패널 토글) · 패널 토글 자리(레일이 설 때만)
//                  └ 아래 줄 ─ 본문 열(TAB_ROW_COLUMN, 아래 틈) ─ 카드 줄(오른쪽 틈 · 사이드바를 접으면 왼쪽 틈)
//                           │                                  ─ 본문(카드 하나, 내용 | 목록 카드 하나, 또는 분할의 열 카드 둘)
//                           │                                    · beside · panel · overlay
//                           └ 레일 열(rail의 칸이 둘 이상일 때만, 오른쪽 틈) ─ 칸 묶음(카드 줄 꼭대기부터)
//
// **틈도 창을 끄는 자리다.** 맨값 `data-tauri-drag-region`은 Tauri가 누른 요소 **자신**에서만 본다 — 회색 틈이 드러나는 상자(뿌리 ·
// 머리 줄 · 패널 토글 자리(레일이 설 때) · 아래 줄 · 본문 열 · 카드 줄 · 레일 열 · 접히는 바깥 상자 · 분할의 `<main>`과 왼쪽 열 상자 · 옆
// 칸) 모두에 단다. 하나라도 빠지면 그 틈은 창을 못 끄는 죽은 자리가 된다. **머리 카드는 빈 자리도 창을 끈다** — 창 맨 위 줄이라
// 제목 막대의 관례를 따른다. 그 뿌리에 `deep`을 달아 안의 빈 자리 · 보이기만 하는 것(아이콘 · 이름 글자 · 위치 · 브랜치 · 배지 글자)
// 어디를 눌러도 끌리고, 누를 것(버튼 · 포커스 받는 이름 · 입력칸)은 Tauri가 스스로 비켜 둔다(`HeadCard`). 그 밖의 카드 안(본문 · 패널
// 카드와 그 머리)은 끌기 영역이 아니다. 틈의 실제 자리와 그 자리를 누르면 무엇이 눌리는지는 `e2e/frame.spec.ts`가 잰다.
//
// **카드 줄에 flex `gap`을 쓰지 않는다.** 틈은 칸 상자의 안쪽 여백이다 — 접힌 칸 옆에 틈이 남지 않게(판 04 「지키는 것」). 분할의
// 두 열 사이 틈도 왼쪽 열 상자의 안쪽 여백이고, 틈을 둔 칸의 손잡이는 그 틈의 가운데에 선다. 목록 칸은 틈이 아니라 세로 선으로
// 갈리고 손잡이는 그 선 위에 선다(`ListCard`).

/** 칸 하나가 그리는 카드의 내용 — 이름(`aria-label`)과 카드 안(머리와 몸). 카드 상자(모서리 · 바탕)와 그 둘레의 틈은 칸이 그린다. */
interface CardContent {
  label: string;
  children: ReactNode;
}

/**
 * 오른쪽 패널 카드 한 칸 — 작업 화면의 작업 패널, Archive의 spec 목록 패널이다. 저장하는 폭은 **카드의 폭**이다(틈은 더하지 않는다).
 * 따로 여닫는 칸이라 머리 줄의 패널 토글이 함께 선다(`PanelToggle` — 이름은 이 칸의 이름 `label`에 할 일을 붙인 것이다). 토글은
 * `onToggle`을 부르고, ⌘Enter는 화면이 듣고 같은 열림을 뒤집는다 — 둘이 하는 일이 같다(codex-ds 결정 32 「⌘Enter는 그 화면의 오른쪽
 * 패널」).
 */
export interface PanelSlot extends CardContent {
  open: boolean;
  onToggle: () => void;
  size: ResizableWidth;
}

/**
 * 목록 칸(codex-ds 결정 28) — 본문 카드 안 오른쪽 칸이다. 이름은 칸의 `aria-label`이고, 안(목록 머리 · 찾기 칸 · 행)은 화면이 건넨다.
 * 접지 않는다(codex-ds 결정 32) — 열림이 없다. 저장하는 폭은 **칸의 폭**이다.
 */
export interface ListSlot extends CardContent {
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
 * 머리 카드(codex-ds 스펙 §4 · §7 · DS `HeadCard`)에 서는 것 — 지금 보는 것의 아이콘 · 이름과 오른쪽 할 일. 오른쪽은 「할 일 | 그 너머」
 * 둘이고 얇은 세로선이 가른다. 카드 상자(모서리 · 면 · 링)와 자리(머리 줄이 남긴 폭 · 머리 줄 가운데)는 이 틀이 든다. 화면마다 하나씩
 * 건넨다 — 어느 화면이든 같은 자리에서 그 화면의 이름과 할 일을 찾는다(스토리 27).
 */
export interface HeadSlot {
  /** 아이콘 앞 — 하위 화면에서 돌아가는 길(spec 레이아웃 편집기의 뒤로). 이름 앞에 서는 것은 이것뿐이다. */
  lead?: ReactNode;
  /**
   * 지금 보는 것의 아이콘 — work(작업 화면 · 아카이브한 work · 빈 Works)는 ⚡(`Zap` — work 아이콘이지 상태 글리프가 아니다. 상태는
   * 오른쪽 배지가 말한다), 프로젝트는 폴더, 그 밖의 화면은 nav의 그 아이콘이다.
   */
  icon: LucideIcon;
  /**
   * 지금 보는 것의 이름 — 고른 것(work · 프로젝트)이 있으면 그 이름, 없으면 화면 이름. 고른 것에 메뉴가 있으면 이름이 그 메뉴의 대상이
   * 되고(`nameMenu`), 바꿀 수 있으면 그 자리에서 바꾼다(`rename`).
   */
  name: string;
  /**
   * 이름을 그 자리에서 바꾸기(codex-ds 스펙 §9 · 결정 18) — 고른 work · 프로젝트의 이름에만 선다. 두 번 클릭 · F2(이름에 포커스가 선
   * 때)로 들어가고, 메뉴 「이름 바꾸기」는 화면이 `editing`을 켜서 들어간다. 고치는 동안은 이름 자리에 입력칸이 선다(`InlineRename`).
   */
  rename?: HeadRename;
  /**
   * 이름의 우클릭 메뉴(codex-ds 결정 6 — 작업 화면은 그 work의 메뉴). 틀이 이름 요소를 그리는 함수(`renderName`)를 건네고, 화면은 그것을
   * 메뉴의 대상으로 감싸 돌려준다 — 메뉴가 무엇을 펴는지는 화면이 알고, 이름의 모양과 자리는 틀이 든다. 받는 값은 「메뉴가 열려 있나」이고
   * 열린 동안 이름에 대상 테두리가 선다(결정 11). 이 이름은 포커스를 받아 ⇧F10 · 메뉴 키로도 그 메뉴를 연다. 이것도 `rename`도 없으면 이름은
   * 보이기만 한다. 이름을 고치는 동안은 메뉴가 없다 — 이름 자리에 입력칸이 서고, 입력칸의 메뉴는 그 칸의 것이다.
   */
  nameMenu?: (renderName: (open: boolean) => ReactElement) => ReactNode;
  /**
   * 이름 뒤 그 대상의 브랜치(⑂ · 고정폭 — 프로젝트 화면 Works 행의 말) — 작업 화면이 고른 work의 것을 건넨다(프로젝트가 붙은 work만 —
   * `WorksPage`). 보이기만 한다. 이름에 자리를 내준다 — 이름 상자가 제 폭을 먼저 갖고, 브랜치는 그 뒤 남는 폭에서 말줄임으로 주다가
   * 남는 폭이 80 아래면 걷힌다.
   */
  branch?: string;
  /**
   * 이름 뒤의 옅은 글자(DS `.at-winhead .sub`) — 그 화면 안에서 지금 선 곳(Settings는 항목, 편집기는 항목 › 레이아웃)이거나 고른 것을
   * 짚는 짧은 글(Archive는 프로젝트 · 치운 날)이다. 조각이 둘 이상이면 꺾쇠가 가른다. 캡슐이 아니다 — 캡슐은 경로 줄에만 선다(codex-ds
   * 결정 14).
   */
  sub?: readonly string[];
  /** 오른쪽 할 일 — 그 대상 · 화면에 거는 조작(작업 화면은 상태 배지 · ⋯ 작업 메뉴, Processes는 조용한 셸 모두 닫기). */
  actions?: ReactNode;
  /**
   * 세로선 너머 오른쪽 끝 — 작업 화면은 보기 배치(분할), Projects는 제거(되돌릴 수 없는 할 일을 다른 할 일과 떼어 둔다 — DS
   * 캔버스). 할 일과는 세로선으로 갈린다. 오른쪽 패널을 든 화면은 이 너머 맨 끝에 패널 토글이 더 선다 — 화면이 건네는 것이 아니라
   * 틀이 패널 칸에서 짓는다(`HeadRow` — Archive는 이것 없이 토글만 선다).
   */
  end?: ReactNode;
}

/**
 * 머리 카드 이름의 제자리 바꾸기(`HeadSlot.rename`). 고치는 중인지는 화면이 쥔다 — 메뉴 「이름 바꾸기」가 화면의 것이라서다. 틀은 들어가는
 * 키 · 두 번 클릭을 듣고(`onStart`), 고치기가 끝나면(저장이든 취소든) `onEnd`를 부른다.
 */
export interface HeadRename {
  /** 지금 고치는 중인가 — 켜진 동안 이름 자리에 입력칸이 선다. */
  editing: boolean;
  /** 두 번 클릭 · F2 — 화면이 `editing`을 켠다. */
  onStart: () => void;
  /** 고치기가 끝났다 — 화면이 `editing`을 끈다. */
  onEnd: () => void;
  /** 바뀐 이름으로 저장한다. 그대로이거나 비운 이름(원래 이름)은 부르지 않는다(`InlineRename`). */
  onCommit: (name: string) => void;
  /** 입력칸의 이름(`aria-label`) — 「작업 이름」 · 「프로젝트 이름」. */
  label: string;
}

interface FrameProps<Id extends string> {
  /** 사이드바가 열렸나 — 머리 줄의 왼쪽 여백과 카드 줄의 왼쪽 틈이 이것으로 갈린다. */
  sidebarOpen: boolean;
  /**
   * 머리 줄의 머리 카드 — 지금 보는 것의 아이콘 · 이름과 그 화면의 할 일(`HeadSlot`). **모든 화면이 건넨다**(codex-ds 스펙 §7) — 화면을
   * 하나 더 세우고 머리 카드를 잊으면 그 화면만 할 일을 다른 자리에 두게 되어, 여기서 타입이 막는다.
   */
  head: HeadSlot;
  /**
   * 목록 칸 — 주면 본문 자리에 내용 | 목록 카드 하나가 서고(`ListCard`), 목록 칸은 그 카드 안 오른쪽 `section`이다(`aside`는 사이드바와
   * 오른쪽 패널 — 작업 패널 · spec 목록 패널 — 둘뿐이다). 내용 칸은 `children`의 본문 카드(`<Card as="main">`)다 — 그 카드는 제
   * 모서리 · 면 · 링을 벗고 칸이 된다.
   * 두 칸을 가르는 세로 선과 그 위의 폭 손잡이는 이 틀이 들고, 화면은 칸 안(목록 머리와 몸)만 건넨다.
   */
  list?: ListSlot;
  /**
   * 오른쪽 패널 카드(작업 패널 · Archive의 spec 목록 패널) — 바깥 상자가 두 번째 `<aside>`다. 건네면 머리 줄에 그 칸의 패널 토글이
   * 함께 선다(`PanelToggle`). 고른 것(작업 · 아카이브)이 있는 화면만 건넨다 — 없으면 둘 다 없다.
   */
  panel?: PanelSlot;
  /**
   * 작업 화면의 레일 열(`Rail` — 패널이 무엇을 볼지 고르는 칸 묶음). 패널과 같은 조건으로 건넨다. 레일 열은 **칸이 둘 이상일 때만**
   * 선다(codex-ds 결정 25 — `railStands`). 레일 열이 없으면 본문 열의 오른쪽 틈 하나가 창 끝이고, 패널 토글은 머리 카드 오른쪽 끝에
   * 든다(`HeadRow`). 칸의 id 타입(`Id`)이 부르는 쪽의 것 그대로 `onPick`까지 간다.
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
  /** 본문 카드(`<Card as="main">`) — 목록 칸이 있으면(`list`) 내용 | 목록 카드의 내용 칸이 된다. 분할이면(`split`) 비워 둔다. */
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
  // 레일이 서는가 — 레일 열을 그릴지와 패널 토글이 어디 설지를 이 판정 하나가 함께 정한다(`railStands`).
  const railUp = rail !== undefined && railStands(rail.items);
  return (
    // **뿌리가 제 min-content를 바깥에 알린다**(`min-w-min`) — 그것이 탭 줄의 바닥(`TAB_ROW_COLUMN`)과 머리 줄이 사이드바에게
    // 자리를 요구하는 길이다. 뿌리는 세로라 그 값은 머리 줄과 아래 줄 가운데 큰 쪽이다. 카드 줄은 탭 줄을 품었을 때만 제
    // min-content를 알리고, 그때도 탭 줄을 이는 카드가 제 몸을 격리해(`TAB_ROW_CARD`) 넓은 문서 · xterm이 그 바닥을 부풀리지 않는다
    // — 옆 칸이 선 줄은 본문 카드의 바닥과 옆 칸 카드의 머리를 알린다(`BesideBox`). 머리 줄은 머리 카드의 조작(뒤로 · 할 일)만 알린다(이름 칸은 격리한다 — `HeadCard`).
    <div data-tauri-drag-region className="flex min-h-0 min-w-min flex-1 flex-col bg-surface-shell">
      <HeadRow
        sidebarOpen={sidebarOpen}
        head={head}
        toggle={
          panel && <PanelToggle name={panel.label} open={panel.open} onToggle={panel.onToggle} controls={panelId} />
        }
        railUp={railUp}
      />
      {/* 아래 줄 — 본문 열과 레일 열. 머리 줄 바로 아래(카드 위끝)에서 시작한다. */}
      <div data-tauri-drag-region className="flex min-h-0 flex-1">
        <div data-tauri-drag-region className={cn("flex flex-1 flex-col pb-2", TAB_ROW_COLUMN)}>
          {/* 카드 줄. 사이드바가 열렸으면 왼쪽 틈이 0이다 — 사이드바 쪽 여백이 그 틈으로 보인다(프로토타입 `.at-main` ·
              `.at-sidebar`). 사이드바가 접히면 카드가 창 왼쪽 틈까지 넓어진다. 여백은 머리 줄의 여백과 같은 곡선으로
              따라온다 — 사이드바 폭 트랜지션(`PANEL_MOTION`)과 박자가 다르면 카드 모서리가 자리를 지나쳤다 되돌아온다(index.css의
              `--ease-panel`). `relative`는 `overlay`의 기준이다. 탭 줄을 품었거나 옆 칸이 서면 이 줄은 본문 열의 격리
              (`TAB_ROW_COLUMN`)를 벗는다 — 탭 줄을 이는 카드의 바닥 · 옆 칸 카드의 머리가 모자라면 사이드바가 자리를 내준다. */}
          <div
            data-tauri-drag-region
            style={beside ? { contain: "none" } : undefined}
            className={cn(
              "relative flex min-h-0 flex-1 pr-2 transition-[padding]",
              PANEL_MOTION,
              sidebarOpen ? "pl-0" : "pl-2",
            )}
          >
            {list ? <ListCard slot={list}>{children}</ListCard> : split ? <SplitBox slot={split} /> : children}
            {beside && <BesideBox slot={beside} />}
            {/* 내용 | 목록 카드 곁의 패널은 그 카드에 두 칸의 최소 폭(목록 칸의 최소 + 내용 칸에 남기는 그만큼)을 남긴다(`PanelBox`의
                `reserve`). */}
            {panel && <PanelBox id={panelId} slot={panel} reserve={list && list.size.min * 2} />}
            {overlay}
          </div>
        </div>
        {/* 레일 열(ui-refresh 결정 10) — 본문 열의 형제라 머리 줄 `<header>` 밖이다. 칸이 둘 이상일 때만 선다(`railStands` — 하나면
            그리지 않아 본문 열이 창 오른쪽 틈까지 넓다). 왼쪽 틈은 본문 열의 오른쪽 틈(카드 줄의 `pr-2`)이다. 서면 늘
            그 자리이고(`shrink-0`) 탭 줄의 바닥을 위해 자리를 내주는 것은 작업 패널, 그다음 사이드바다. */}
        {rail && railUp && (
          <Rail
            open={panel?.open ?? false}
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
 * 내용 | 목록 카드 안이다(codex-ds 결정 28) — 그 안에 선 `Card`는 제 카드가 아니라 바깥 카드의 내용 칸이라 모서리 · 면 · 링을 그리지
 * 않는다(바깥 카드가 든다 — DS `.at-joined > .at-col`). 화면은 다른 화면처럼 본문 카드(`<Card as="main">`)를 건네고, 그것이 칸이
 * 되는 것은 이 틀이 정한다 — 화면마다 칸의 모양을 적으면 한 화면만 링을 두 번 두른다.
 */
const InListCard = createContext(false);

/**
 * 내용 | 목록 카드(codex-ds 결정 28 · 스펙 §4 「목록 칸」 · DS `.at-joined`). 본문 자리에 카드 하나가 서고, 그 안 왼쪽이 내용 칸
 * (화면의 본문 카드 — `main`), 오른쪽이 목록 칸(`section` — DS `.at-listcol`)이다. 둘 사이에 틈이 없다 — 0.5px `border-heavy` 세로
 * 선이 가른다. 선은 테두리가 아니라 목록 칸 왼쪽 끝 안쪽에 칠한 면이다(`::after` — 0.5px 테두리는 엔진마다 굵기가 갈린다).
 *
 * **마크업 차례가 보이는 차례다** — 내용 칸이 먼저, 목록 칸이 뒤다. 그래서 Tab이 왼쪽 내용 칸을 지나 오른쪽 목록 칸으로 간다. 목록
 * 칸을 CSS(`order` · `flex-row-reverse`)로 오른쪽에 세우면 Tab이 보이는 차례를 거슬러 간다.
 *
 * **그 선이 폭 손잡이다**(`ResizeHandle`의 `rule` 자리 — 선 위에 걸쳐 선다). 목록 칸이 카드 오른쪽 끝에 붙어 선은 칸의 왼쪽 끝이라,
 * 왼쪽으로 끌면 목록 칸이 넓어진다(폭 훅의 `side`가 `"right"` — 화면이 건넨다). 끈 폭은 저장되고, 두 번 누르면 기본
 * 폭이다. 폭은 칸의 폭 그대로라(틈이 없다) 출발 폭을 잴 때 뺄 것이 없다. 두 번 눌러 기본 폭으로 돌아가는 순간은 패널과 같은
 * 박자(`PANEL_MOTION`)로 움직이고, 끄는 동안에는 트랜지션을 꺼서 폭이 커서를 곧장 따라온다.
 *
 * **접지 않는다**(codex-ds 결정 32) — 내용 | 목록은 한 카드의 두 칸이라, 따로 여닫는 것은 오른쪽 패널뿐이다. 칸은 제 폭으로 서고
 * (`shrink-0`) 남는 폭을 내용 칸이 먹는다. 목록 칸의 안쪽은 좌우 8이고(DS `.at-listcol` — 머리 · 찾기 칸 · 행이 그 안에 선다), 위아래는
 * 칸 안이 든다. 카드는 카드라 안이 끌기 영역이 아니다 — 회색이 드러나는 자리가 없다.
 *
 * **창이 좁으면 목록 칸이 내준다** — 끄는 최소 폭(`--list-min`, 폭 훅이 받은 값)까지 좁게 서고, 내용 칸에는 **그 최소 폭만큼은
 * 남긴다**(`max-width` — 작업 패널 칸과 같은 손버릇, `PanelBox`). 카드 줄은 바닥을 알리지 않아(`TAB_ROW_COLUMN`) 사이드바가 자리를
 * 내주지 않으므로, 제 폭을 고집하면 카드가 넘침을 잘라 내용 칸이 0으로 눌리고 세로 선과 손잡이도 카드 밖으로 잘린다 — 접지 않는
 * 칸이라 치울 길도 없다. 줄어드는 것은 **그려진 폭**뿐이고 저장한 폭은 그대로라 창을 넓히면 돌아온다. 좁게 선 칸을 끌 때 손잡이가
 * 안 튀는 것은 폭 훅이 그려진 폭에서 출발해서다(`useResizableWidth`).
 */
function ListCard({ slot, children }: { slot: ListSlot; children?: ReactNode }) {
  const { label, size } = slot;
  return (
    <div data-slot="card" className={cn(CARD_FACE, "flex min-h-0 min-w-0 flex-1 bg-surface")}>
      <InListCard.Provider value>{children}</InListCard.Provider>
      <section
        aria-label={label}
        style={{ width: size.width, "--list-min": `${size.min}px` } as CSSProperties}
        className={cn(
          "relative flex min-h-0 max-w-[calc(100%-var(--list-min))] min-w-(--list-min) shrink-0 flex-col px-2",
          "after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-[0.5px] after:bg-border-heavy",
          !size.dragging && PANEL_MOTION,
          !size.dragging && "transition-[width]",
        )}
      >
        {slot.children}
        <ResizeHandle control={size} seat="rule" />
      </section>
    </div>
  );
}

/**
 * 오른쪽 패널 칸(ui-refresh 결정 4 · 15 — 칸 하나 = 카드 하나) — 작업 화면의 작업 패널, Archive의 spec 목록 패널. 바깥 상자가 두 번째
 * `<aside>`이고(e2e `tab-row-floor`가 `aside` 순서를 잰다) **폭이 「왼쪽 틈 + 카드」다** — 접히면 둘이 함께 0이 되어 왼쪽 카드가 오른쪽
 * 틈 끝까지 넓어진다. 틈은 안쪽 열의 왼쪽 여백이고, 손잡이는 그 틈의 가운데에 선다(여전히 `aside`의 자손이다).
 *
 * 폭은 **카드의 폭**이다(`--panel-width`). 틈은 그 위에 더해 그린다.
 *
 * **이 칸은 줄어든다**(`shrink-0`이 없다). 창이 좁으면 끄는 최소 폭(`--panel-min`, 폭 훅이 받은 값)까지 왼쪽 카드에 자리를
 * 내주고, 왼쪽 카드에는 **남길 폭(`reserve`)만큼은 남긴다**(`max-width`). 그 폭은 왼쪽 카드가 화면을 이루는 최소다:
 * - 작업 화면의 문서 카드에는 패널 자신의 최소 폭만큼이다(`reserve`가 없을 때). 문서 카드는 머리에 탭 줄을 이고 그 줄의 바닥 아래로는
 *   안 준다(`TAB_ROW_CARD`) — 패널이 최소 폭까지 줄고도 둘이 카드 줄에 안 들면 그 합이 본문 열의 바닥이 되어 사이드바가 자리를 내준다.
 * - Archive의 문서 | 목록 카드에는 두 칸의 최소(목록 칸의 최소 + 내용 칸에 남기는 그만큼 — `ListCard`)다. 그만큼을 남기지 않으면 좁은
 *   창에서 패널이 제 폭을 지키는 사이 목록 칸이 제 최소로 버텨 내용 칸이 먼저 눌린다. 그 카드 줄은 격리되어(`TAB_ROW_COLUMN`) 사이드바가
 *   자리를 내주지 않으므로, **여기서는 패널이 제 최소 폭 아래로도 내준다**(최소 폭도 「남은 폭 − 남길 폭」을 넘지 않는다). 목록과 내용은
 *   접을 수 없는 칸이고 패널은 ⌘Enter · 토글로 걷을 수 있는 칸이라, 모자란 자리는 걷을 수 있는 쪽이 진다 — 900 창에 사이드바를 넓혀
 *   두면 패널은 틈만큼 가는 띠로 선다.
 * 줄어드는 것은 **그려진 폭**뿐이고 저장한 폭은 그대로라 창을 넓히면 돌아온다.
 *
 * 폭을 `width`가 아니라 `flex-basis`로 주고 `contain-inline-size`를 다는 것은 이 칸이 제 내용이 아니라 최소 폭으로만 카드 줄의
 * min-content에 들어가게 하는 장치다 — 탭 줄을 품은 카드 줄은 제 min-content를 본문 열의 바닥으로 알리는데(`TAB_ROW_COLUMN`),
 * 넓은 트리 이름이 그 바닥도 칸의 폭도 정하지 않는다. 최소 폭은 **펼 때만** 트랜지션한다 — 펴는 순간 곧장 서면 0에서 최소 폭으로 튄 뒤
 * 자란다(접을 때는 곧장 걷는다). 접힘은 사이드바와 같은 장치다(`PANEL_MOTION` · `foldingInnerClass`). 끄는 동안에는 트랜지션을 꺼서 폭이 커서를
 * 곧장 따라온다. translateX로 밀어내는 길은 이미 실패한 길이다 — 제 상자 밖 넘침을 문서가 받아 도는 동안 가로 스크롤이 깜빡인다.
 *
 * `id`는 패널 토글 · 레일 칸이 가리키는 자리다(`aria-controls`). 접혀도 이 상자는 그대로 서 있어(폭만 0) 가리킴이 끊기지 않는다.
 * 그래서 **닫힌 동안 안쪽 열은 `inert`다** — 폭만 0인 칸 안의 트리 행에 Tab · 찾기가 닿지 않게 한다(레일의 `PanelBody` · 사이드바 목록
 * 구획과 같은 손). 접히는 동안 아직 보이는 안쪽에도 포커스가 닿지 않는다. 안에 있던 포커스는 패널 토글로 간다(`useFoldedFocus`).
 */
function PanelBox({ id, slot, reserve }: { id: string; slot: PanelSlot; reserve?: number }) {
  const { open, size, label, children } = slot;
  const box = useFoldedFocus<HTMLElement>(open);
  return (
    <aside
      ref={box}
      id={id}
      data-tauri-drag-region
      style={
        {
          "--panel-width": `${size.width}px`,
          "--panel-min": `${size.min}px`,
          "--panel-reserve": `${reserve ?? size.min}px`,
        } as CSSProperties
      }
      className={cn(
        "relative flex overflow-hidden contain-inline-size",
        !size.dragging && PANEL_MOTION,
        !size.dragging && (open ? "transition-[flex-basis,min-width]" : "transition-[flex-basis]"),
        open
          ? cn(
              "max-w-[calc(100%-var(--panel-reserve))] basis-[calc(var(--panel-width)+var(--space-2))]",
              reserve === undefined
                ? "min-w-[calc(var(--panel-min)+var(--space-2))]"
                : "min-w-[min(calc(var(--panel-min)+var(--space-2)),max(0px,calc(100%-var(--panel-reserve))))]",
            )
          : "basis-0 min-w-0",
      )}
    >
      {/* 접히는 동안 글이 되흐르지 않게 안쪽은 고정 폭이고, **펴진 뒤에만** 바깥 폭을 상한으로 받는다 — 좁게 선 칸에서 카드
          오른쪽이 잘리지 않게. 박자와 까닭은 `panel-layout`의 `foldingInnerClass`에 있다. */}
      <div
        data-tauri-drag-region
        inert={!open}
        className={cn(
          "flex h-full w-[calc(var(--panel-width)+var(--space-2))] shrink-0 pl-2",
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
 * 분할의 두 열이 나눠 갖는 폭 — `<main>`의 폭에서 두 열 사이 틈 하나를 뺀다(아래 `SplitBox`). 틈은 토큰(`--space-2`)에서 읽는다
 * (`cardGapPx`). 상자를 못 읽었으면 0이고, 그러면 비율 훅이 움직이지 않는다(`nextRatio`).
 */
function sharedWidth(host: HTMLElement | null): number {
  if (!host) return 0;
  return Math.max(0, host.getBoundingClientRect().width - cardGapPx(host));
}

/**
 * 분할(ui-refresh 결정 15 — 열 하나 = 카드 하나). 본문 자리의 `<main>` 안에 열 카드 둘이 틈(`--space-2`)을 두고 선다. `<main>`은 카드가
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
        style={{ width: `calc((100% - var(--space-2)) * ${size.ratio} + var(--space-2))` }}
        className={cn(
          "relative flex min-w-min pr-2",
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
 * 분할의 두 열처럼 본문 카드와 나란히 카드 줄에 선다. 그래서 `aside`가 아니다(`aside`는 사이드바와 오른쪽 패널 둘뿐이다 — `tab-row-floor` ·
 * `works-sidebar` · `archive-docs`가 그 순서를 센다). 상자가 「왼쪽 틈 + 카드」이고 틈은 안쪽 왼쪽 여백이다. 회색 틈이 드러나는 상자라 끌기 영역이다.
 *
 * 폭을 `flex-basis`로 주고 줄어들게 둔다(`min-w-0`) — 창이 좁아 본문 카드가 제 최소 폭보다 좁아질 때만 그만큼 자리를 내준다. 작업 패널
 * 칸이 문서 카드에 최소 폭을 남기는 것과 같은 손버릇이다(`PanelBox`). 본문 카드의 최소 폭은 그 카드의 몫이다(화면이 건넨다 — 편집기의
 * 폼 카드는 몸을 격리해 바닥이 없고, 밖 변경 배너가 선 동안만 그 배너가 바닥이다. 화면의 조작은 머리 카드에 선다).
 *
 * **이 카드의 머리가 탭 줄처럼 바닥이다.** 옆 칸이 선 카드 줄은 본문 열의 격리를 벗고(위 카드 줄), 이 카드의 몸은 제 내용 폭을 안
 * 알린다(`contain-inline-size`) — 그래서 줄의 min-content가 본문 카드의 바닥과 이 카드 머리의 폭이고, 그것이 창에 안 들면 사이드바가
 * 자리를 내준다. 머리의 글자는 시스템 글꼴이라 OS마다 폭이 달라(codex-ds 결정 3) 그 합을 수로 적어 둘 수 없다.
 */
function BesideBox({ slot }: { slot: BesideSlot }) {
  return (
    <div
      data-tauri-drag-region
      style={{ flexBasis: `calc(${slot.width}px + var(--space-2))` }}
      className="flex min-w-0 pl-2"
    >
      <Card label={slot.label} className="flex-1 [&>:not([data-slot=card-head])]:contain-inline-size">
        {slot.children}
      </Card>
    </div>
  );
}

/**
 * 머리 줄 — 창 맨 위 48의 `<header>` 하나(codex-ds 스펙 §4 · DS `AppShell` — 틈 8 · 머리 카드 32 · 틈 8). 문서의 `header`는 이 줄
 * 하나다 — 탭 줄은 이 줄이 아니라 본문 카드의 머리이고 `div`다(`ShellTabs`). 머리 카드(`head`)가 줄이 남긴 폭으로 선다.
 *
 * **머리 카드의 폭은 어느 화면이든 아래 본문 열이다**(codex-ds 스펙 §4 「사이드바 뒤부터 레일 앞까지」). 줄은 뿌리의 맨 위라 폭이
 * 바탕 전체(본문 열 + 레일 열)이고, 오른쪽 여백(`pr-2`)이 카드 줄 · 레일 열의 오른쪽 틈과 같은 값이다. 그래서 패널 토글의
 * 자리가 레일을 따라 갈린다(DS `.at-winhead` · `.with-rail` · `.at-winctl-r`):
 * - **레일이 서면**(칸 둘 이상) 토글은 머리 카드 밖, 레일 열 바로 위다(DS `.at-railtop` — 「머리 카드 오른쪽 끝 너머, 레일 바로
 *   위」). 토글 자리(틈 + 줄 폭 `size-prail`)가 레일 열과 같은 폭을 비워 머리 카드는 레일 앞에서 끝난다.
 * - **서지 않으면**(지금 작업 화면 — codex-ds 결정 25 — 과 레일이 없는 Archive) 레일 열도 토글 자리도 없어 머리 카드가 창 오른쪽
 *   틈까지 서고, 토글은 카드 안 오른쪽 끝 — 작업 화면은 보기 배치(분할) 뒤 — 에 든다(`HeadCard`의 `toggle`).
 *
 * **신호등 inset은 이 줄 하나만 계산한다.** 사이드바가 열렸으면 왼쪽 여백이 0이라 머리 카드가 본문 카드와 한 세로줄(사이드바 뒤)에서
 * 시작하고 — 신호등 · 창 컨트롤은 사이드바 위에 선다 — 접혔으면 `--titlebar-inset-head`(창 컨트롤 끝 + 틈)다(index.css의
 * `[data-titlebar]`). 여백은 사이드바 폭과 같은 박자(`PANEL_MOTION`)로 따라온다.
 *
 * **머리 줄 전부가 창을 끄는 자리다** — 이 줄과 (레일이 설 때) 패널 토글 자리가 맨값 `data-tauri-drag-region`을 들어 회색이 끌고,
 * 머리 카드는 `deep`이라 그 안의 빈 자리도 끈다(머리말 · `HeadCard`). 줄 안의 버튼은 속성이 없어 그대로 눌린다.
 */
function HeadRow({
  sidebarOpen,
  head,
  toggle,
  railUp,
}: {
  sidebarOpen: boolean;
  head: HeadSlot;
  toggle?: ReactNode;
  /** 레일이 섰나(`railStands`) — 패널 토글이 머리 카드 밖 레일 열 위에 설지, 카드 안 오른쪽 끝에 들지가 이것으로 갈린다. */
  railUp: boolean;
}) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        // 아래 경계선이 없다 — 바탕이 선으로 잘리지 않고 카드 줄로 이어진다.
        "flex h-(--titlebar-height) shrink-0 items-center pr-2 transition-[padding]",
        PANEL_MOTION,
        sidebarOpen ? "pl-0" : "pl-(--titlebar-inset-head)",
      )}
    >
      <HeadCard {...head} toggle={railUp ? undefined : toggle} />
      {railUp && toggle && (
        // 패널 토글 자리 — 레일 열과 같은 폭(틈 + 줄 폭)이라 토글이 레일 열의 가운데에 선다(DS `.at-railtop`). 회색이 드러나는
        // 상자라 끌기 영역이다. 머리 카드가 남는 폭을 다 먹어 이 자리는 줄 오른쪽 끝이다.
        <div data-tauri-drag-region className="box-content flex w-(--size-prail) shrink-0 justify-center pl-2">
          {toggle}
        </div>
      )}
    </header>
  );
}

/**
 * 머리 카드(codex-ds 스펙 §4 · DS `HeadCard` · `.at-winhead`) — 머리 줄에 뜬 흰 카드. 32(`size-head`) · `radius-xl` · `surface`에 0.5px
 * 링(`shadow-hairline`)이고, 폭은 머리 줄이 남긴 자리 전부(`flex-1`)라 아래 본문 열과 같다 — 레일이 서면 그 위의 패널 토글 자리가
 * 레일 열만큼을 비운다(`HeadRow`). 링을 바탕 위 카드처럼 안쪽에 덮어 그리지 않는다 — 넘침을 숨기는 조상이 없어 바깥 링이 잘리지
 * 않는다(`Card`의 안쪽 링은 접히는 칸의 상자 때문이다).
 *
 * 왼쪽은 **이름 상자**(DS `.at-wtitle` — 아이콘 · 이름 · 연필을 품은 24 상자, 안쪽 0 8 · 사이 7 · `radius-md`, 이름 13/500 `fg`, 아이콘 14
 * `fg-secondary`)와 그 뒤 브랜치(`branch`) · 옅은 위치(`sub`)다. 아이콘 14는 DS 부품 규칙(`.at-wtitle > .ic`)이다 — 스펙 §3의 「머리
 * 카드 15」보다 부품이 못박은 값이 앞선다(모양 정본은 DS). 카드 안쪽 8에 이름 상자의 안쪽 8이 더해져 아이콘이 카드 + 16에 선다 — 아래
 * 본문 카드의 탭 줄 첫 칸과 한 세로줄이다. 하위 화면은 그 앞에 돌아가는 길(`lead`)이 하나 선다. 브랜치 · 위치는 이름 상자 밖 형제이고
 * 상자 끝에서 6에 선다(DS `.at-winhead`의 사이 4 + `.sub`의 왼쪽 2 — 연필이 없는 이름이면 이름 끝에서 14다). 위치는 DS
 * `.at-winhead .sub`(12 `fg-tertiary`)이고, 브랜치는 프로젝트 화면 Works 행의 ⑂ 브랜치와 같은 말(⑂ 12 · 고정폭 12 `fg-secondary` · 사이
 * 5)이다. 오른쪽은 할 일 | 그 너머다(DS `.at-winctl-r` — 사이 6, 둘을 가르는 세로선 0.5 × 16 `border-heavy`). 오른쪽 패널을 든 화면은
 * 레일이 서지 않으면 그 너머 맨 끝에 패널 토글이 든다(`toggle` — DS 「보기 배치(나눠 보기 · 패널 토글)」 · Archive 「⋯ | spec 목록
 * 토글」). 위 줄에 서는 것은 모두 24다(창 컨트롤과 같다 — 글자 버튼은 `Button`의 `top`). 아이콘 버튼의 글리프는 창 컨트롤처럼 15다
 * (스펙 §3 · DS `HeadCard`의 `s15`).
 *
 * **이름 칸은 틀 뿌리의 바닥에 안 든다**(`contain-inline-size`) — 긴 work 이름이 좁은 창에서 사이드바를 밀면 안 된다. 제 폭을 알리지
 * 않는 상자라 글자 폭으로는 서지 못해, 이름 칸(이름 상자 · 브랜치 · 위치의 줄)은 남는 폭을 먹는다(`flex-1`). 그 안에서 이름 상자는 DS
 * 그대로 제 글자 폭이고(`flex: 0 1 auto`) DS 상한 520에서 멈추며, 넘치는 이름은 그 안에서 말줄임으로 준다. 브랜치는 기준 폭이 0이라
 * (`flex-[1_1_0]`) 이름 상자가 제 폭을 다 가진 뒤 남는 폭만 받는다 — 이름이 먼저다. 그 남는 폭이 80 아래면 ⑂와 몇 글자도 못 들어
 * 통째로 걷힌다(`@container` — 반쯤 잘린 ⑂가 서지 않게). 위치는 이름 상자와 함께 준다(마지막 조각의 말줄임). 오른쪽 묶음은 카드
 * 안쪽 오른쪽 끝에 붙고(`ml-auto` — DS `.at-winctl-r`) 줄지 않는다(`shrink-0`) — 그 폭이 머리 줄의 바닥이라 좁은 창에서도 할 일이 제
 * 폭으로 카드 안에 선다(편집기의 「LLM이 받는 텍스트」 · 「저장」도). 할 일이 없는 화면(Terminal · 빈 Works · 저장이 없는 설정 쪽)에는
 * 묶음이 없다. 표식 `data-head-actions`는 그것을 재는 검사가 집는다(e2e `tab-row.ts`의 `rowOf`).
 *
 * **빈 자리는 창을 끈다**(머리말) — 카드 뿌리의 `data-tauri-drag-region="deep"`이라 그 아래 어디를 눌러도 끌리고, Tauri는 누를 수
 * 있는 요소(버튼 · `tabindex` · 입력칸 · 누르는 역할)를 만나면 끌지 않는다. 그래서 보이기만 하는 것(아이콘 · 이름 글자 · 위치 · 브랜치 ·
 * Archive의 배지 글자 · 할 일 사이)은 끌고, 버튼과 포커스 받는 이름 상자(그 안의 아이콘까지)는 눌린다 — 끄는 자리의 두 번 클릭은 창
 * 키우기라, 두 번 클릭이 이름 바꾸기인 이름은 끌면 안 된다. 고치는 동안의 이름 상자는 포커스를 받지 않아 `false`로 막는다. 이
 * 판정은 Tauri의 것(`drag.js`의 `isDragRegion`)이라 누를 것을 새로 들일 때는 그 넷 중 하나로 짓는다 — `onClick`만 단 `span`은 끌린다.
 */
function HeadCard({
  lead,
  icon: Icon,
  name,
  nameMenu,
  rename,
  branch,
  sub,
  actions,
  end,
  toggle,
}: HeadSlot & {
  /** 레일이 서지 않을 때의 패널 토글 — 보기 배치(`end`) 뒤, 카드 안 오른쪽 끝에 선다(`HeadRow`). 화면이 건네는 것이 아니라 틀이 넣는다. */
  toggle?: ReactNode;
}) {
  const nameEl = useRef<HTMLSpanElement>(null);
  // **이름 상자 한 벌**(DS `.at-wtitle`) — 24 · 상한 520 · `radius-md` · 안쪽 왼쪽 8. 줄 상자(`block` · 줄 높이 24)이고 글자가 이 상자의
  // 바로 안이다 — 말줄임이 이 상자에서 끊기고, 글자로 이름을 찾는 쪽(`getByText`)이 이 상자(포커스 받는 그것)에 닿는다. 아이콘은 줄
  // 안의 글리프로 서서(`inline-block` · 위 5 — 24 줄에 14) 오른쪽 7을 둔다. 오른쪽 안쪽은 연필이 없으면 8, 있으면 연필 자리까지다(이름
  // 끝 5 · 연필 12 · 끝 8 — DS `.pen`의 왼쪽 -2가 사이 7에서 빠진다). 연필은 줄 밖에 떠(`absolute`) 말줄임이 그 앞에서 끊긴다.
  const titleBox = "block h-6 max-w-[520px] min-w-0 truncate rounded-md pl-2 text-chat-meta leading-6 font-medium text-fg";
  const titleEnd = rename ? "pr-6.25" : "pr-2";
  // 아이콘 한 벌 — 쉴 때(줄 안의 글리프)와 고칠 때(flex 줄의 칸)가 같은 크기 · 색 · 사이 7이다.
  const glyphClass = "mr-1.75 size-3.5 text-fg-secondary";
  const glyph = <Icon aria-hidden className={cn(glyphClass, "mt-1.25 inline-block align-top")} />;
  // **메뉴가 있거나 바꿀 수 있는 이름은 대상이다**(`nameMenu` · `rename`) — 이름 상자가 포커스를 받는다. 메뉴가 있으면 ⇧F10 · 메뉴
  // 키가 그 메뉴를 열고 열린 동안 표식이 서서 `focus-ring`이 테두리를 그린다 — 링 · 테두리가 아이콘부터 연필 자리까지 상자 전부를
  // 두른다. 바꿀 수 있으면 F2 · 두 번 클릭이 고치기에 든다(codex-ds 스펙 §9 — F2는 포커스된 대상의 `onKeyDown`이 듣는다, 화면의
  // window keydown이 아니다). 버튼이 아닌 것은 누르면 할 일이 없어서다(구현 노트 Q6 — 한 번 누르기는 아무것도 하지 않고, 두 번 클릭이
  // 고치기다).
  // - **역할이 없으니 키를 말한다**(`aria-keyshortcuts` — 표의 F2와 ⇧F10 · 메뉴 키, `TARGET_MENU_ARIA`). 포커스가 서면 글자(이름)와
  //   함께 「여기서 이 키가 듣는다」가 읽힌다. `aria-haspopup`은 안 단다 — 역할 없는 요소(generic)에는 ARIA가 그 속성을 허락하지 않는다.
  //   역할을 지어 붙이지 않는 것은 그 역할이 거짓말이 되어서다(`button`이면 누를 것이 있어야 한다).
  // - **바꿀 수 있는 이름은 hover에 면과 연필이 선다**(DS `button.at-wtitle:hover` · `.pen`). 면은 이름 상자 전부다 — 아이콘 앞 8부터
  //   연필 뒤 8까지 안쪽이 같다. 글리프는 면이 서도 제자리다(면은 칠만 한다).
  // - **고치는 동안 이름 글자 자리는 입력칸이다**(`InlineRename`). 폭은 이름 글자만큼이다(`fit="text"` — DS `.at-wtitle.is-edit`도 글자
  //   폭을 그대로 둔다). 상자는 같은 안쪽 · 같은 아이콘으로 서고, 입력칸은 둘레(링)를 위해 왼쪽으로 4 넓히고 그만큼 안쪽을 둬 글자가
  //   쉴 때의 자리에서 시작한다 — 오른쪽 안쪽은 입력칸 둘레 4만큼 덜어 상자 끝이 거의 그대로다. 링은 입력칸이 든다(`focus-ring` 한
  //   벌 — DS `.is-edit`은 상자 전부를 두른다). 상자는 끌기를 막는다(`false` — 위 머리말). 메뉴는 그동안 서지 않는다(`nameMenu`를 안
  //   부른다). 키로 끝내면 포커스가 다시 선 이 이름으로 돌아온다(`nameEl`).
  const shortcuts = [rename && HOTKEYS.rename.aria, nameMenu && TARGET_MENU_ARIA].filter(Boolean).join(" ");
  const renderName = (open: boolean) => (
    <span
      ref={nameEl}
      tabIndex={0}
      aria-keyshortcuts={shortcuts}
      onKeyDown={(event) => {
        if (rename && pressed(event, "rename")) {
          event.preventDefault();
          rename.onStart();
          return;
        }
        openMenuByKey(event);
      }}
      onDoubleClick={rename?.onStart}
      data-menu-target={open ? "" : undefined}
      className={cn(
        titleBox,
        titleEnd,
        "focus-ring",
        rename && "group/name relative transition-colors hover:bg-fill-hover",
      )}
    >
      {glyph}
      {name}
      {rename && (
        <Pencil
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2 size-3 -translate-y-1/2 text-fg-tertiary opacity-0 transition-opacity group-hover/name:opacity-100"
        />
      )}
    </span>
  );
  const nameNode = rename?.editing ? (
    <span data-tauri-drag-region="false" className="flex h-6 max-w-[520px] min-w-0 items-center pr-5.25 pl-2">
      <Icon aria-hidden className={cn(glyphClass, "shrink-0")} />
      <InlineRename
        value={name}
        label={rename.label}
        emptyMeans="revert"
        fit="text"
        onCommit={rename.onCommit}
        onDone={rename.onEnd}
        returnFocus={() => nameEl.current}
        className="-ml-1 h-6 px-1 text-chat-meta font-medium text-fg"
      />
    </span>
  ) : nameMenu ? (
    nameMenu(renderName)
  ) : rename ? (
    renderName(false)
  ) : (
    <span className={cn(titleBox, titleEnd)}>
      {glyph}
      {name}
    </span>
  );
  return (
    <div
      data-slot="head-card"
      data-tauri-drag-region="deep"
      className="flex h-(--size-head) min-w-0 flex-1 items-center gap-1 rounded-xl bg-surface px-2 shadow-hairline"
    >
      {lead}
      <div className="flex h-6 min-w-0 flex-1 items-center contain-inline-size">
        {nameNode}
        {branch && (
          // 브랜치의 칸 — 기준 폭 0이라 이름 상자가 제 폭을 다 가진 뒤 남는 폭만 받고, 그 폭을 제가 잰다(`@container`). 80 아래면 안이
          // 걷히고 빈 칸만 남는다. 상자 끝에서 6은 안의 왼쪽 여백이다 — 칸의 여백이면 걷힌 동안에도 이름에서 6을 앗는다.
          <span className="@container flex min-w-0 flex-[1_1_0]">
            <span className="ml-1.5 hidden min-w-0 items-center gap-1.25 font-mono text-xs text-fg-secondary @min-[80px]:flex">
              <GitFork aria-hidden className="size-3 shrink-0" />
              <span className="min-w-0 truncate">{branch}</span>
            </span>
          </span>
        )}
        {sub && (
          // 이름 상자 끝에서 위치까지 6이다(DS `.at-winhead`의 사이 4 + `.sub`의 왼쪽 2 — 위 머리말). 앞 조각은 제 폭이고 줄어드는 몫은
          // 마지막 조각의 말줄임이 받는다.
          <span className="ml-1.5 flex min-w-0 items-center gap-0.5 text-xs whitespace-nowrap text-fg-tertiary">
            {sub.map((part, at) => (
              <Fragment key={at}>
                {at > 0 && <ChevronRight aria-hidden className="size-3 shrink-0" strokeWidth={SMALL_GLYPH_STROKE} />}
                <span className={at === sub.length - 1 ? "min-w-0 truncate" : "shrink-0"}>{part}</span>
              </Fragment>
            ))}
          </span>
        )}
      </div>
      {(actions || end || toggle) && (
        <div data-head-actions className="ml-auto flex shrink-0 items-center gap-1.5">
          {actions}
          {actions && (end || toggle) && (
            <div role="separator" aria-orientation="vertical" className="mx-0.5 h-4 w-[0.5px] shrink-0 bg-border-heavy" />
          )}
          {end}
          {toggle}
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
  /**
   * 카드 머리 — 카드 머리 줄(`CardHead`) · 탭 줄(`ShellTabs`) · 경로 줄(`PathBar`)이다. 머리가 없는 카드는 곧바로 내용이 선다(ui-refresh
   * 결정 5).
   */
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
 * 바탕 위 카드의 얼굴 — 모서리 `radius-2xl`(16)과 그 안쪽 가장자리에 덮어 그린 0.5px 링(`--shadow-hairline`). 카드(`Card`)와 내용 |
 * 목록 카드(`ListCard`)가 같은 얼굴이다. 모서리는 카드가 자른다(`overflow-hidden`) — 안의 스크롤 상자 · 셸 화면이 모서리 밖으로
 * 그려지지 않는다. `relative`는 링 덮개와 카드 안에 덮이는 것(설정의 메시지 등)의 기준이다.
 *
 * **링은 카드 안쪽 가장자리에 덮어 그린다**(`::after`의 `inset` 그림자 — 값은 같은 토큰이다). 카드 바깥에 그리는 그림자는 조상의
 * 넘침 숨김에 잘린다: 작업 패널의 접히는 바깥 상자가 안쪽 열을 잘라 내려고 넘침을 숨기고, 카드는 그 상자의 세 변에 붙어
 * 선다 — 바깥 링이면 틈 쪽 한 변에만 남는다. 덮개는 카드 내용 위에 서서 내용이 가장자리까지 칠해도 링이 안 가려지고, 누름은
 * 지나보낸다(`pointer-events-none`). 네 변이 칠해지는지는 `e2e/frame.spec.ts`가 픽셀로 잰다.
 */
const CARD_FACE =
  "relative overflow-hidden rounded-2xl after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:shadow-[inset_var(--shadow-hairline)]";

/**
 * 바탕 위에 뜬 둥근 카드 하나(ui-refresh 결정 4 · 15 — 칸 하나 = 카드 하나). 얼굴(모서리 · 링)은 `CARD_FACE`다.
 *
 * 바탕은 터미널 카드면 설정의 테마에서 읽은 바탕이고, 그 밖은 흰 카드(`bg-surface`)다. **흰 카드와 터미널 카드가 한 컴포넌트다** —
 * 작업 화면의 본문 카드는 문서와 터미널을 오가는데, 둘이 다른 컴포넌트면 오갈 때마다 카드가 새로 서고 머리의 탭 줄도 함께 새로
 * 서서 방금 누른 `spec` 칸의 포커스와 줄의 스크롤을 잃는다. 테마는 터미널 카드만 구독한다 — 흰 카드는 훅이 늘 `undefined`를
 * 돌려줘 설정이 바뀌어도 다시 그려지지 않는다(`useShellBackground`). 모서리는 `radius-2xl`(16)이고
 * 외곽은 실선이 아니라 0.5px 링(`--shadow-hairline`)이다 — 바탕 위 카드의 깊이는 그것뿐이다(DS 「깊이」, codex-ds 결정 27).
 *
 * **내용 | 목록 카드 안에서는 카드가 아니라 내용 칸이다**(`InListCard` — codex-ds 결정 28). 얼굴과 면을 바깥 카드가 들어 이 상자는
 * 모서리 · 링 · 면을 그리지 않고, 카드의 표식(`data-slot="card"`)도 바깥 카드의 것이다 — 카드 줄의 카드는 하나다.
 */
function Card({ as: Tag = "section", label, head, tone, className, children }: CardProps) {
  const background = useShellBackground(tone === "terminal");
  const column = useContext(InListCard);
  return (
    <Tag
      aria-label={label}
      data-slot={column ? undefined : "card"}
      data-tone={tone}
      style={background === undefined ? undefined : { backgroundColor: background }}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden",
        !column && CARD_FACE,
        !column && tone !== "terminal" && "bg-surface",
        className,
      )}
    >
      {head}
      {children}
    </Tag>
  );
}

/**
 * 카드 머리(ui-refresh 결정 5) — 카드 안에서 고르는 것(패널 이름 · 트리의 도구)과 그 곁의 버튼이 서는 46px 줄이다(`--card-head`
 * — 탭 줄과 같은 `size-toolbar`). `div`이고 끌기 영역이 아니다(카드 안이다). 문서 카드의 머리는 이것이 아니라 경로 줄(`PathBar`)이고,
 * 목록 칸의 머리는 목록 머리(`ListHead`)다. 좌우 여백은 8(`px-2` — DS `.at-toolbar` · `.at-panel-head`의 안쪽 8)이라 머리의 첫 버튼이
 * 카드 끝에서 8, 제목은 제 안쪽 8을 더해 카드 + 16(행 글자 16 — 아래 트리 행의 글리프와 한 세로줄)에 선다.
 *
 * **화면의 이름 · 위치와 할 일은 여기 서지 않는다** — 머리 카드가 든다(`HeadSlot`, codex-ds 스펙 §7). 카드 안에 고를 것이 없으면 그
 * 카드에는 이 줄이 없다. `end`는 오른쪽 끝에 고정되는 조작이다.
 */
function CardHead({
  end,
  children,
  ...marks
}: {
  end?: ReactNode;
  /** 줄 왼쪽에 서는 것 — 작업 패널 머리의 제목(고른 레일 칸) · 편집기 트리 카드의 도구. */
  children?: ReactNode;
  /** 검사가 머리를 정체성으로 집는 표식 — 모양(클래스)으로 집으면 규격을 손보는 날 샌다. */
  [mark: `data-${string}`]: string | undefined;
}) {
  return (
    <div
      {...marks}
      data-slot="card-head"
      className="flex h-(--card-head) shrink-0 items-center gap-1.5 px-2"
    >
      {children}
      {end && <div className="ml-auto flex shrink-0 items-center gap-1.5">{end}</div>}
    </div>
  );
}

/**
 * 목록 머리(codex-ds 스펙 §4 「목록 머리」 · DS `.at-listcol-head`) — 목록 칸 맨 위 줄이다. 높이는 경로 줄과 같은 48(`size-pathbar`)이라
 * 내용 칸의 경로 줄과 한 줄에 선다(codex-ds 결정 28). 왼쪽에 제목(14/500 `fg`)과 개수(13 `fg-tertiary` · 고정폭 숫자)가 사이 4로 서고,
 * 그 목록에 거는 할 일(`end`)이 오른쪽 끝에 선다. 왼쪽 안쪽 8이 목록 칸의 안쪽 8에 더해져 제목이 칸 + 16에 선다 — 아래 행 글자와 한
 * 세로줄이다(DS 「행 글자 16」). `div`이고 끌기 영역이 아니다(카드 안이다). 표식 `data-slot="list-head"`는 검사가 집는다.
 */
function ListHead({ title, count, end }: { title: string; count?: number; end?: ReactNode }) {
  return (
    <div data-slot="list-head" className="flex h-(--size-pathbar) shrink-0 items-center gap-1 pl-2">
      <span className="min-w-0 truncate text-sm font-medium">{title}</span>
      {count !== undefined && <span className="shrink-0 text-chat-meta text-fg-tertiary tabular-nums">{count}</span>}
      {end && <div className="ml-auto flex shrink-0 items-center gap-1">{end}</div>}
    </div>
  );
}

/**
 * 목록 칸의 찾기 칸(DS `.at-search`) — 목록 머리 아래 칸 폭으로 서고 행과 8 떨어진다. Projects · Archive 목록이 쓴다. 이름은
 * `aria-label`이 든다(S37) — placeholder는 이름표가 아니라 빈 칸에만 서는 안내 글자라 같은 글자를 겸한다.
 */
function ListSearch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <InputGroup className="mb-2 shrink-0">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
      />
    </InputGroup>
  );
}

/**
 * 목록 칸의 두 줄 행(DS `.at-row.two`)의 자리 — 50 이상 · 안쪽 7 8 · 모서리 10, 두 줄 사이 2. 글자가 칸 + 16에 서서 목록 머리의 제목과
 * 한 세로줄이다. Projects · Archive 목록의 행 버튼과, 이름을 고치는 동안 그 자리에 서는 상자가 함께 쓴다. 고른 행 · hover의 면은 행이
 * 더한다(카드 안 목록의 두 단 — `selected-row` · `fill-soft`).
 */
const TWO_LINE_ROW = "flex min-h-12.5 w-full shrink-0 flex-col gap-0.5 rounded-lg px-2 py-1.75 transition-colors";

/**
 * 목록 칸의 구르는 상자 — 두 줄 행이 여기 선다. 상자가 목록의 키를 받는다: 행 메뉴의 우클릭 · ⇧F10(`menu` — `TargetMenu`의 손잡이)과
 * 목록 안 ↑↓(`roving` — 목록 하나가 Tab 정류장 하나다, `@/lib/roving`). 행은 표식(`data-roving` · 메뉴가 대상을 가르는 표)만 든다.
 *
 * **`-mx-2 px-2`가 칸의 안쪽 여백을 뚫고 나갔다 되돌린다** — 보이는 것은 안 움직이고 막대만 칸 가장자리로 간다. 상자가 안쪽 여백 안에
 * 들어앉아 있으면 막대(상자 안쪽 3~9px)가 그만큼 더 안쪽에 서서 행 위로 들어온다. 같은 병이 사이드바 work 목록에 있었고 그쪽 주석이
 * 내력을 든다. 위끝의 `-mt-1 pt-1`도 같은 손버릇이다 — 첫 행의 포커스 링(테두리 바깥 4px)이 구르는 상자의 위끝에 잘리지 않게 상자만
 * 4px 나갔다 되돌린다(codex-ds 결정 11 · `index.css`의 `focus-ring-room`). 아래끝은 `pb-2`가 그 자리이자 칸 바닥의 안쪽 8이다(DS
 * `.at-listcol`).
 */
function ListScroll({ menu, roving, children }: { menu?: TargetRegion; roving: RovingBox; children: ReactNode }) {
  return (
    <div
      onContextMenu={menu?.onContextMenu}
      onKeyDown={(event) => {
        menu?.onKeyDown(event);
        roving.onKeyDown(event);
      }}
      onFocus={roving.onFocus}
      className="-mx-2 -mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-2 scroll-quiet"
    >
      {children}
    </div>
  );
}

export { Card, CardHead, Frame, ListHead, ListScroll, ListSearch, TWO_LINE_ROW };
