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
import { foldingInnerClass, PANEL_MOTION, TAB_ROW_COLUMN, useFoldedFocus } from "./panel-layout";
import PanelToggle from "./PanelToggle";
import { HEAD_NAME, HeadEnd, ScreenHead } from "./ShellHead";
import { ResizeHandle, type ResizableWidth } from "./useResizableWidth";
import type { TargetRegion } from "./TargetMenu";

// 화면의 **공용 틀**(ui-refresh 결정 27 · 02 구현 스펙 §3 · restart 02a-2). Terminal · Processes · Archive · Settings · 작업 화면 · spec
// 레이아웃 편집기가 이 틀에 칸을 건넨다(Projects · Service는 03부터 `PlainFrame`이다). 틀 자체(크롬 · 머리 줄 44 · 사이드바 오른쪽 카드 자리)는
// 앱 셸 하나가 그리고(`AppShell` · `ShellHead`), 이 틀은 그 위에서 두 자리만 든다 — 머리 줄의 화면 자리에 보낼 이름 · 할 일(`HeadSlot` —
// `ScreenHead`로 포털)과 카드 자리에 뜨는 카드들이다.
// 목록은 따로 서지 않고 본문 카드 안 오른쪽 칸이다(codex-ds 결정 28 — 내용 | 목록 한 카드). 화면은 칸 내용만 건넨다 — 카드의 겉 · 카드
// 사이 틈 · 손잡이 · 머리 줄의 자리를 이 파일 한 곳이 지킨다. 일곱 화면이 저마다 그 규칙을 적으면 한 화면만 틈 하나를 빠뜨려도 화면으로는
// 어디가 샜는지 안 보인다. 편집기의 트리 칸도 이 틀의 칸이다(`beside`). 탭 줄(`ShellTabs`)은 이 틀의 줄이 아니라
// 본문 칸의 머리다(codex-ds 스펙 §4 「탭 줄」) — 화면이 `Card`의 `head`로 건넨다.
//
//   머리 줄의 화면 자리(`ScreenHead`) ─ 돌아가는 길 · 아이콘 · 이름 · 브랜치 · 위치 | 할 일 · 세로선 · 그 너머 · 패널 토글(`FrameHead`)
//   카드 자리 뿌리 ─ 본문 열(TAB_ROW_COLUMN) ─ 카드 줄 ─ 본문(카드 하나, 또는 내용 | 목록 카드 하나) · beside · panel ·
//                                                     overlay
//
// **영역마다 카드다**(restart 스펙 「02a」 · 시안 Shell 「판 한 장을 걷고 영역을 카드로 나눈다」). 본문 · 오른쪽 패널 · 옆 칸이 저마다
// 둥근 카드(`CARD_FACE` — 면 surface · 둥글기 8 · 0.5 링)로 서고, 카드끼리는 8 틈(`space-2`)으로 갈린다. 창 끝 틈 8은 앱 셸의 줄이 든다.
// 한때(02 구현 스펙 §3 S2) 판 한 장이 본문을 품어 칸들이 둘레 틈 없이 0.5 선으로 갈렸다 — 그 앞(ui-refresh)의 카드 짜임으로 돌아온
// 것이다. 한때 본문 자리에 분할의 열 카드 둘이 섰다(restart 02a-13이 분할을 걷었다).
//
// **작업공간의 spec 패널과 레일은 이 틀이 그리지 않는다**(restart 02a-14) — 앱 셸의 작업공간 도구 기둥(`WorkTools`)이 화면을 넘어 들어,
// 작업공간을 떠날 때 둘이 함께 접힌다. 작업공간 화면은 머리 줄의 패널 토글만 이 틀에 건넨다(`panelToggle`). 한때 둘은 이 틀의 칸이었다 —
// 레일 열이 본문 열의 형제로 섰다.
//
// **카드 사이 틈은 창을 끄는 자리가 아니다** — 창은 머리 줄(빈 곳 · 이름 글자 · 할 일 사이)로 끈다(`ShellHeadRow`의 `deep`).
//
// **카드 줄에 flex `gap`을 쓰지 않는다.** 틈은 뒤(오른쪽)에 선 카드 상자의 안쪽 왼쪽 여백이다 — 접힌 카드 옆에 틈이 남지 않게(판 04
// 「지키는 것」 — 작업 패널은 상자 폭이 0이 되며 틈도 걷힌다). 손잡이는 그 틈을 덮거나(`ResizeHandle`의 `gap`) 한 카드 안의 선 위에
// 선다(`rule` — 내용 | 목록).

/** 칸 하나가 그리는 내용 — 이름(`aria-label`)과 칸 안(머리와 몸). 칸 상자(바탕)와 이웃 칸과 가르는 선은 칸이 그린다. */
interface CardContent {
  label: string;
  children: ReactNode;
}

/**
 * 오른쪽 패널 칸 — 작업 화면의 작업 패널, Archive의 spec 목록 패널이다. 저장하는 폭은 **칸의 폭**이다.
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
 * 목록 칸(codex-ds 결정 28) — 본문 칸 안 오른쪽 칸이다. 이름은 칸의 `aria-label`이고, 안(목록 머리 · 찾기 칸 · 행)은 화면이 건넨다.
 * 접지 않는다(codex-ds 결정 32) — 열림이 없다. 저장하는 폭은 **칸의 폭**이다.
 */
export interface ListSlot extends CardContent {
  size: ResizableWidth;
}

/**
 * 본문 칸 오른쪽에 **늘 열려** 선 고정 폭 칸 하나(옆 칸) — 접힘 · 폭 손잡이 · 레일이 없다. 레이아웃 편집기의 트리 칸이 이것이다
 * (판 06 티켓 07). `width`는 **칸의 폭**이다.
 */
export interface BesideSlot extends CardContent {
  width: number;
}

/**
 * 머리 줄(CONTEXT 「머리 줄」 · 02 구현 스펙 §3 S2)의 화면 자리에 서는 것 — 지금 보는 것의 아이콘 · 이름과 오른쪽 할 일. 왼쪽 것은 머리
 * 줄 가운데 왼쪽에, 오른쪽 것은 머리 줄 오른쪽 끝에 선다. 오른쪽은 「할 일 | 그 너머」 둘이고 얇은 세로선이 가른다. 자리와 모양은 이
 * 틀이 든다(`FrameHead`). 화면마다 하나씩 건넨다 — 어느 화면이든 같은 자리에서 그 화면의 이름과 할 일을 찾는다(스토리 27). 한때 이것이
 * 머리 줄에 뜬 흰 카드(머리 카드) 안에 섰다 — 이제 카드 없이 머리 줄에 바로 선다.
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
   * 세로선 너머 오른쪽 끝 — 작업 화면은 요약 카드 토글, Projects는 제거(되돌릴 수 없는 할 일을 다른 할 일과 떼어 둔다 — DS
   * 캔버스). 할 일과는 세로선으로 갈린다. 오른쪽 패널을 든 화면은 이 너머 맨 끝에 패널 토글이 더 선다 — 화면이 건네는 것이 아니라
   * 틀이 패널 칸에서 짓는다(`Frame` — Archive는 이것 없이 토글만 선다).
   */
  end?: ReactNode;
}

/**
 * 머리 줄 이름의 제자리 바꾸기(`HeadSlot.rename`). 고치는 중인지는 화면이 쥔다 — 메뉴 「이름 바꾸기」가 화면의 것이라서다. 틀은 들어가는
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
  /** 입력칸의 이름(`aria-label`) — 「작업공간 이름」 · 「프로젝트 이름」. */
  label: string;
}

interface FrameProps {
  /**
   * 머리 줄에 서는 것 — 지금 보는 것의 아이콘 · 이름과 그 화면의 할 일(`HeadSlot`). **모든 화면이 건넨다**(codex-ds 스펙 §7) — 화면을
   * 하나 더 세우고 머리를 잊으면 그 화면만 머리 줄이 비고 할 일이 다른 자리에 가게 되어, 여기서 타입이 막는다.
   */
  head: HeadSlot;
  /**
   * 목록 칸 — 주면 본문 자리에 내용 | 목록 칸 하나가 서고(`ListCard`), 목록 칸은 그 안 오른쪽 `section`이다(`aside`는 사이드바와
   * 오른쪽 패널 — 작업 패널 · spec 목록 패널 — 둘뿐이다). 내용 칸은 `children`의 본문 칸(`<Card as="main">`)이다.
   * 두 칸을 가르는 세로 선과 그 위의 폭 손잡이는 이 틀이 들고, 화면은 칸 안(목록 머리와 몸)만 건넨다.
   */
  list?: ListSlot;
  /**
   * 오른쪽 패널 칸(작업 패널 · Archive의 spec 목록 패널) — 바깥 상자가 두 번째 `<aside>`다. 건네면 머리 줄 오른쪽 끝에 그 칸의 패널
   * 토글이 함께 선다(`PanelToggle`). 고른 것(작업 · 아카이브)이 있는 화면만 건넨다 — 없으면 둘 다 없다.
   */
  panel?: PanelSlot;
  /**
   * 이 틀 밖에 선 오른쪽 패널의 패널 토글 — 작업공간의 spec 패널이다(앱 셸의 작업공간 도구 기둥 — `WorkTools`, restart 02a-14). 패널 칸은
   * 그 기둥이 그리고, 이 틀은 머리 줄 오른쪽 맨 끝에 그 패널을 가리키는 토글만 세운다(`panel`과 같은 자리 · 같은 모양). `panel`과 함께
   * 건네지 않는다.
   */
  panelToggle?: { name: string; open: boolean; onToggle: () => void; controls: string };
  /** 본문 칸 오른쪽의 옆 칸 — 늘 열린 고정 폭 칸(`BesideSlot`). 편집기 트리 칸 하나가 쓴다. */
  beside?: BesideSlot;
  /**
   * 칸 줄 위를 덮는 것(토스트 · 생애 겹판). 칸 줄은 카드 자리 위끝에서 시작한다 — 탭 줄은 칸 줄 안(본문 카드의 머리)이다.
   */
  overlay?: ReactNode;
  /** 본문 칸(`<Card as="main">`) — 목록 칸이 있으면(`list`) 내용 | 목록 칸의 내용 칸이 된다. */
  children?: ReactNode;
}

function Frame({ head, list, panel, panelToggle, beside, overlay, children }: FrameProps) {
  // 패널 토글이 가리키는 패널 칸(`aria-controls`). 둘을 이 틀이 함께 그리므로 이음도 여기서 짓는다 — 화면은 모른다. 밖에 선 패널은 그
  // 자리가 id를 건넨다(`panelToggle`).
  const panelId = useId();
  const toggle = panel ? (
    <PanelToggle name={panel.label} open={panel.open} onToggle={panel.onToggle} controls={panelId} />
  ) : (
    panelToggle && <PanelToggle {...panelToggle} />
  );
  return (
    <>
      <FrameHead {...head} toggle={toggle} />
      {/* **뿌리가 제 min-content를 바깥에 알린다**(`min-w-min`) — 그것이 탭 줄의 바닥(`TAB_ROW_COLUMN`)이 사이드바에게 자리를 요구하는
          길이다. 칸 줄은 탭 줄을 품었을 때만 제 min-content를 알리고, 그때도 탭 줄을 이는 칸이 제 몸을 격리해(`TAB_ROW_CARD`) 넓은
          문서 · xterm이 그 바닥을 부풀리지 않는다 — 옆 칸이 선 줄은 본문 칸의 바닥과 옆 칸의 머리를 알린다(`BesideBox`). 그 값이 카드
          자리의 바닥이 되어 그 밖 사이드바에 닿는다(`AppShell`의 카드 자리 `min-w-min`). 카드 자리를 다 쓴다(카드 자리가 가로 줄이다). */}
      <div className="flex min-h-0 min-w-min flex-1">
        <div className={cn("flex flex-1 flex-col", TAB_ROW_COLUMN)}>
          {/* 카드 줄. 카드 자리의 끝까지 카드가 선다 — 창 끝 틈은 앱 셸의 줄이 든다. `relative`는
              `overlay`의 기준이다. 탭 줄을 품었거나 옆 칸이 서면 이 줄은 본문 열의 격리(`TAB_ROW_COLUMN`)를 벗는다 — 탭 줄을 이는
              칸의 바닥 · 옆 칸의 머리가 모자라면 사이드바가 자리를 내준다. */}
          <div style={beside ? { contain: "none" } : undefined} className="relative flex min-h-0 flex-1">
            {list ? <ListCard slot={list}>{children}</ListCard> : children}
            {beside && <BesideBox slot={beside} />}
            {/* 내용 | 목록 칸 곁의 패널은 그 칸에 두 칸의 최소 폭(목록 칸의 최소 + 내용 칸에 남기는 그만큼)을 남긴다(`PanelBox`의
                `reserve`). */}
            {panel && <PanelBox id={panelId} slot={panel} reserve={list && list.size.min * 2} />}
            {overlay}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * 내용 | 목록 칸 안이다(codex-ds 결정 28) — 그 안에 선 `Card`는 제 칸이 아니라 바깥 상자의 내용 칸이라 면을 그리지 않는다(바깥 상자가
 * 든다 — DS `.at-joined > .at-col`). 화면은 다른 화면처럼 본문 칸(`<Card as="main">`)을 건네고, 그것이 내용 칸이 되는 것은 이 틀이
 * 정한다 — 칸의 표식(`data-slot="card"`)도 바깥 상자의 것이다.
 */
const InListCard = createContext(false);

/**
 * 내용 | 목록 카드 안의 0.5 세로 선 — 목록 칸이 제 왼쪽 가장자리에 칠한다. 색과 굵기는 `border-heavy` 0.5다. 테두리가 아니라 칠한
 * 면인 것은 0.5px 테두리가 엔진마다 굵기가 갈려서다. 칸 내용 위에 서서 내용이 가장자리까지 칠해도 안 가려지고, 누름은 지나보낸다.
 * **카드 사이를 가르는 선이 아니다** — 카드끼리는 8 틈으로 갈린다(02a-2). 한때(02 S2) 판 안의 모든 칸이 이런 선으로 갈렸다.
 */
const LIST_RULE =
  "after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-[0.5px] after:bg-border-heavy";

/**
 * 내용 | 목록 카드(codex-ds 결정 28 · 스펙 §4 「목록 칸」 · DS `.at-joined`). 본문 자리에 카드 하나가 서고(`CARD_FACE`), 그 안 왼쪽이
 * 내용 칸(화면의 본문 칸 — `main`), 오른쪽이 목록 칸(`section` — DS `.at-listcol`)이다. 둘 사이는 카드 안 0.5 선 하나다(`LIST_RULE`).
 *
 * **마크업 차례가 보이는 차례다** — 내용 칸이 먼저, 목록 칸이 뒤다. 그래서 Tab이 왼쪽 내용 칸을 지나 오른쪽 목록 칸으로 간다. 목록
 * 칸을 CSS(`order` · `flex-row-reverse`)로 오른쪽에 세우면 Tab이 보이는 차례를 거슬러 간다.
 *
 * **그 선이 폭 손잡이다**(`ResizeHandle`의 `rule` 자리 — 선 위에 걸쳐 선다). 목록 칸이 상자 오른쪽 끝에 붙어 선은 칸의 왼쪽 끝이라,
 * 왼쪽으로 끌면 목록 칸이 넓어진다(폭 훅의 `side`가 `"right"` — 화면이 건넨다). 끈 폭은 저장되고, 두 번 누르면 기본
 * 폭이다. 폭은 칸의 폭 그대로라 출발 폭을 잴 때 뺄 것이 없다. 두 번 눌러 기본 폭으로 돌아가는 순간은 패널과 같은
 * 박자(`PANEL_MOTION`)로 움직이고, 끄는 동안에는 트랜지션을 꺼서 폭이 커서를 곧장 따라온다.
 *
 * **접지 않는다**(codex-ds 결정 32) — 내용 | 목록은 한 상자의 두 칸이라, 따로 여닫는 것은 오른쪽 패널뿐이다. 칸은 제 폭으로 서고
 * (`shrink-0`) 남는 폭을 내용 칸이 먹는다. 목록 칸의 안쪽은 좌우 8이고(DS `.at-listcol` — 머리 · 찾기 칸 · 행이 그 안에 선다), 위아래는
 * 칸 안이 든다.
 *
 * **창이 좁으면 목록 칸이 내준다** — 끄는 최소 폭(`--list-min`, 폭 훅이 받은 값)까지 좁게 서고, 내용 칸에는 **그 최소 폭만큼은
 * 남긴다**(`max-width` — 작업 패널 칸과 같은 손버릇, `PanelBox`). 칸 줄은 바닥을 알리지 않아(`TAB_ROW_COLUMN`) 사이드바가 자리를
 * 내주지 않으므로, 제 폭을 고집하면 상자가 넘침을 잘라 내용 칸이 0으로 눌리고 세로 선과 손잡이도 상자 밖으로 잘린다 — 접지 않는
 * 칸이라 치울 길도 없다. 줄어드는 것은 **그려진 폭**뿐이고 저장한 폭은 그대로라 창을 넓히면 돌아온다. 좁게 선 칸을 끌 때 손잡이가
 * 안 튀는 것은 폭 훅이 그려진 폭에서 출발해서다(`useResizableWidth`).
 */
function ListCard({ slot, children }: { slot: ListSlot; children?: ReactNode }) {
  const { label, size } = slot;
  return (
    <div data-slot="card" className={cn("relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface", CARD_FACE)}>
      <InListCard.Provider value>{children}</InListCard.Provider>
      <section
        aria-label={label}
        style={{ width: size.width, "--list-min": `${size.min}px` } as CSSProperties}
        className={cn(
          "relative flex min-h-0 max-w-[calc(100%-var(--list-min))] min-w-(--list-min) shrink-0 flex-col px-2",
          LIST_RULE,
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
 * 오른쪽 패널 칸(ui-refresh 결정 4 · 15) — 작업공간의 spec 패널(앱 셸의 기둥), Archive의 spec 목록 패널. 바깥 상자가 두 번째 `<aside>`이고(e2e
 * `tab-row-floor`가 `aside` 순서를 잰다) 폭이 **틈 8 + 카드의 폭**이다 — 접히면 0이 되어 틈째 걷히고 왼쪽 카드가 카드 자리 오른쪽 끝
 * (레일이 서면 레일 카드 앞 틈)까지 넓어진다(시안 Motion 「패널을 닫으면 문서 카드가 넓어진다」). 왼쪽 카드와는 그 틈으로 갈린다 —
 * 틈은 안쪽 열의 왼쪽 여백이다. 손잡이는 그 틈을 덮는다(`gap` — 틈 안이라 넘침을 숨기는 상자에 잘리지 않는다).
 *
 * 폭은 **카드의 폭**이다(`--panel-width` — 저장 · 끄는 최소 폭도 카드의 것이다). 상자의 기준 폭 · 최소 폭은 그 위에 틈 하나(`space-2`)를
 * 더하고, 끄는 손이 잴 때 그 틈을 뺀다(`useResizableWidth`의 `drawnWidth`).
 *
 * **이 칸은 줄어든다**(`shrink-0`이 없다). 창이 좁으면 끄는 최소 폭(`--panel-min`, 폭 훅이 받은 값)까지 왼쪽 칸에 자리를
 * 내주고, 왼쪽 칸에는 **남길 폭(`reserve`)만큼은 남긴다**(`max-width`). 그 폭은 왼쪽 칸이 화면을 이루는 최소다:
 * - 작업 화면의 문서 칸에는 패널 자신의 최소 폭만큼이다(`reserve`가 없을 때). 문서 칸은 머리에 탭 줄을 이고 그 줄의 바닥 아래로는
 *   안 준다(`TAB_ROW_CARD`) — 패널이 최소 폭까지 줄고도 둘이 칸 줄에 안 들면 그 합이 본문 열의 바닥이 되어 사이드바가 자리를 내준다.
 * - Archive의 문서 | 목록 칸에는 두 칸의 최소(목록 칸의 최소 + 내용 칸에 남기는 그만큼 — `ListCard`)다. 그만큼을 남기지 않으면 좁은
 *   창에서 패널이 제 폭을 지키는 사이 목록 칸이 제 최소로 버텨 내용 칸이 먼저 눌린다. 그 칸 줄은 격리되어(`TAB_ROW_COLUMN`) 사이드바가
 *   자리를 내주지 않으므로, **여기서는 패널이 제 최소 폭 아래로도 내준다**(최소 폭도 「남은 폭 − 남길 폭」을 넘지 않는다). 목록과 내용은
 *   접을 수 없는 칸이고 패널은 ⌘Enter · 토글로 걷을 수 있는 칸이라, 모자란 자리는 걷을 수 있는 쪽이 진다 — 900 창에 사이드바를 넓혀
 *   두면 패널은 가는 띠로 선다.
 * 줄어드는 것은 **그려진 폭**뿐이고 저장한 폭은 그대로라 창을 넓히면 돌아온다.
 *
 * 폭을 `width`가 아니라 `flex-basis`로 주고 `contain-inline-size`를 다는 것은 이 칸이 제 내용이 아니라 최소 폭으로만 칸 줄의
 * min-content에 들어가게 하는 장치다 — 탭 줄을 품은 칸 줄은 제 min-content를 본문 열의 바닥으로 알리는데(`TAB_ROW_COLUMN`),
 * 넓은 트리 이름이 그 바닥도 칸의 폭도 정하지 않는다. 최소 폭은 **펼 때만** 트랜지션한다 — 펴는 순간 곧장 서면 0에서 최소 폭으로 튄 뒤
 * 자란다(접을 때는 곧장 걷는다). 접힘은 사이드바와 같은 장치다(`PANEL_MOTION` · `foldingInnerClass`). 끄는 동안에는 트랜지션을 꺼서 폭이 커서를
 * 곧장 따라온다. translateX로 밀어내는 길은 이미 실패한 길이다 — 제 상자 밖 넘침을 문서가 받아 도는 동안 가로 스크롤이 깜빡인다.
 *
 * `id`는 패널 토글 · 레일 칸이 가리키는 자리다(`aria-controls`). 접혀도 이 상자는 그대로 서 있어(폭만 0) 가리킴이 끊기지 않는다.
 * 그래서 **닫힌 동안 안쪽 열은 `inert`다** — 폭만 0인 칸 안의 트리 행에 Tab · 찾기가 닿지 않게 한다(사이드바 목록 구획과 같은 손).
 * 접히는 동안 아직 보이는 안쪽에도 포커스가 닿지 않는다. 안에 있던 포커스는 패널 토글로 간다(`useFoldedFocus`). 상자 자신(`aside` — 보조
 * 랜드마크)도 닫힌 동안은 드러내지 않는다(`aria-hidden`) — 안이 다 `inert`라 빈 랜드마크만 남는다. 작업공간의 spec 패널 상자는 앱 셸에 늘
 * 서 있어, 이것이 없으면 작업공간이 아닌 화면마다 빈 `aside`가 랜드마크 목록에 읽힌다(restart 02a-14).
 *
 * **이 상자를 두 자리가 쓴다** — Archive의 spec 목록 패널은 이 틀의 카드 줄에, 작업공간의 spec 패널은 앱 셸의 작업공간 도구 기둥에 선다
 * (`WorkTools` — 화면이 바뀌어도 그 자리에 남아 작업공간을 떠날 때 접힘이 보인다, restart 02a-14). 기둥에서는 패널 뒤에 레일 카드가 한 줄로
 * 서서, 남길 폭에서 그 몫(`trail` — 레일 폭 + 틈)을 더 뺀다. 작업공간을 떠나 접힐 때는 안쪽이 옅어지지 않고 잘리기만 한다(`fade` — 시안
 * `.ra-panelwrap`, restart 02a-14b) — 접히는 동안 남긴 마지막 몸이 보인다.
 */
export function PanelBox({
  id,
  slot,
  reserve,
  trail,
  fade = true,
}: {
  id: string;
  slot: PanelSlot;
  reserve?: number;
  /** 같은 줄에서 패널 뒤(오른쪽)에 서는 것의 폭(CSS 길이) — 남길 폭을 잴 때 함께 뺀다. 없으면 0이다. */
  trail?: string;
  /** 닫힐 때 안쪽이 옅어지나(`foldingInnerClass`) — 아니면 상자가 접히며 잘리기만 한다. 펼 때는 늘 같은 장치다. */
  fade?: boolean;
}) {
  const { open, size, label, children } = slot;
  const box = useFoldedFocus<HTMLElement>(open);
  return (
    <aside
      ref={box}
      id={id}
      aria-hidden={open ? undefined : true}
      style={
        {
          "--panel-width": `${size.width}px`,
          "--panel-min": `${size.min}px`,
          "--panel-reserve": `${reserve ?? size.min}px`,
          ...(trail === undefined ? {} : { "--panel-trail": trail }),
        } as CSSProperties
      }
      className={cn(
        "relative flex overflow-hidden contain-inline-size",
        !size.dragging && PANEL_MOTION,
        !size.dragging && (open ? "transition-[flex-basis,min-width]" : "transition-[flex-basis]"),
        open
          ? cn(
              "max-w-[calc(100%-var(--panel-reserve)-var(--panel-trail,0px))] basis-[calc(var(--panel-width)+var(--space-2))]",
              reserve === undefined
                ? "min-w-[calc(var(--panel-min)+var(--space-2))]"
                : "min-w-[min(calc(var(--panel-min)+var(--space-2)),max(0px,calc(100%-var(--panel-reserve))))]",
            )
          : "basis-0 min-w-0",
      )}
    >
      {/* 접히는 동안 글이 되흐르지 않게 안쪽은 고정 폭(틈 + 카드)이고, **펴진 뒤에만** 바깥 폭을 상한으로 받는다 — 좁게 선 칸에서 카드
          오른쪽이 잘리지 않게. 박자와 까닭은 `panel-layout`의 `foldingInnerClass`에 있다. 틈은 안쪽 왼쪽 여백이다. */}
      <div
        inert={!open}
        className={cn(
          "flex h-full w-[calc(var(--panel-width)+var(--space-2))] shrink-0 pl-2",
          open || fade ? foldingInnerClass(open) : "max-w-[100vw]",
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
 * 본문 칸 오른쪽의 옆 칸(ui-refresh 결정 15 · 27, 판 06 티켓 07 — 편집기 트리). **늘 열려 있고** 접힘 · 폭 손잡이 · 레일이 없어
 * 본문 칸과 나란히 칸 줄에 선다. 그래서 `aside`가 아니다(`aside`는 사이드바와 오른쪽 패널 둘뿐이다 — `tab-row-floor` ·
 * `works-sidebar` · `archive-docs`가 그 순서를 센다). 본문 카드와는 틈 8로 갈린다 — 틈은 상자의 안쪽 왼쪽 여백이고, 기준 폭은 틈 + 카드
 * 폭이다.
 *
 * 폭을 `flex-basis`로 주고 줄어들게 둔다(`min-w-0`) — 창이 좁아 본문 칸이 제 최소 폭보다 좁아질 때만 그만큼 자리를 내준다. 작업 패널
 * 칸이 문서 칸에 최소 폭을 남기는 것과 같은 손버릇이다(`PanelBox`). 본문 칸의 최소 폭은 그 칸의 몫이다(화면이 건넨다 — 편집기의
 * 폼 칸은 몸을 격리해 바닥이 없고, 밖 변경 배너가 선 동안만 그 배너가 바닥이다. 화면의 조작은 머리 줄에 선다).
 *
 * **이 칸의 머리가 탭 줄처럼 바닥이다.** 옆 칸이 선 칸 줄은 본문 열의 격리를 벗고(위 칸 줄), 이 칸의 몸은 제 내용 폭을 안
 * 알린다(`contain-inline-size`) — 그래서 줄의 min-content가 본문 칸의 바닥과 이 칸 머리의 폭이고, 그것이 창에 안 들면 사이드바가
 * 자리를 내준다. 머리의 글자는 시스템 글꼴이라 OS마다 폭이 달라(codex-ds 결정 3) 그 합을 수로 적어 둘 수 없다.
 */
function BesideBox({ slot }: { slot: BesideSlot }) {
  return (
    <div style={{ flexBasis: `calc(${slot.width}px + var(--space-2))` }} className="relative flex min-w-0 pl-2">
      <Card label={slot.label} className="flex-1 [&>:not([data-slot=card-head])]:contain-inline-size">
        {slot.children}
      </Card>
    </div>
  );
}

/**
 * 머리 줄의 화면 것(02 구현 스펙 §3 S2 · CONTEXT 「머리 줄」) — 지금 보는 것의 아이콘 · 이름과 할 일을 앱 셸의 머리 줄로 보낸다
 * (`ScreenHead` — 포털). 한때 이것이 머리 줄에 뜬 흰 카드(머리 카드 — DS `HeadCard` · `.at-winhead`, 32 · `radius-xl` · 링)였다. 카드의
 * 겉(면 · 둥글기 · 링)만 버리고 안은 그대로다 — 왼쪽 것은 머리 줄 가운데 왼쪽에, 오른쪽 것은 머리 줄 오른쪽 끝에 선다. 자리(사이드바
 * 끝의 세로선 뒤 · 접히면 셸 컨트롤 뒤 · 오른쪽 끝 여백)와 끌기는 셸의 머리 줄이 든다(`ShellHeadRow`).
 *
 * 왼쪽은 **이름 상자**(DS `.at-wtitle` — 아이콘 · 이름 · 연필을 품은 24 상자, 안쪽 0 8 · 사이 7 · `radius-md`, 아이콘 14 `fg-secondary`)와
 * 그 뒤 브랜치(`branch`) · 옅은 위치(`sub`)다. 이름 글자는 Thread 이름과 같은 14/500 `fg`다(`HEAD_NAME` — 머리 줄은 한 결이다, 02 결정
 * 「머리 줄은 한 결이다(03 뒤)」. 한때 머리 카드의 13/500이었다). 아이콘 14는 DS 부품 규칙(`.at-wtitle > .ic`)이다. 이름 상자의 안쪽 8은
 * hover 면 · 대상 테두리의 자리라, 묶음을 6 당겨(`-ml-1.5`) 사이드바가 열렸으면 아이콘이 본문 카드 왼쪽 끝 + 16(세로선 뒤 14 − 6 + 8)
 * — 아래 탭 줄 첫 칸의 글리프와 한 세로줄 — 에 선다. 하위 화면은 그 앞에 돌아가는 길(`lead`)이 하나 선다. 브랜치 · 위치는 이름 상자 밖
 * 형제이고 상자 끝에서 6에 선다(DS `.at-winhead`의 사이 4 + `.sub`의 왼쪽 2 — 연필이 없는 이름이면 이름 끝에서 14다). 위치는 DS
 * `.at-winhead .sub`(12 `fg-tertiary`)이고, 브랜치는 프로젝트 화면 Works 행의 ⑂ 브랜치와 같은 말(⑂ 12 · 고정폭 12 `fg-secondary` · 사이
 * 5)이다. 오른쪽은 할 일 | 그 너머다 — 둘을 가르는 세로선 0.5 × 16 `border-heavy`(DS `.at-winctl-r`)가 양옆 8을 둔다. 오른쪽 패널을 든
 * 화면은 그 너머 맨 끝에 패널 토글이 든다(`toggle` — 레일이 서든 안 서든 같은 자리, DS 「보기 배치(나눠 보기 · 패널 토글)」 · Archive
 * 「⋯ | spec 목록 토글」). **오른쪽 끝 묶음과 단추는 Thread 머리 줄과 한 벌이다**(`ShellHead`의 `HeadEnd` — 단추 사이 2 · 이름 쪽과 12,
 * `headButton` — 아이콘 단추 28 · 글리프 16 `fg-titlebar`, 글자 단추는 `Button`의 `top` 28). 한때 머리 카드의 값(24 · 사이 6 · 글리프
 * 15)이었다.
 *
 * **이름 칸은 바닥을 알리지 않는다**(`contain-inline-size`) — 긴 work 이름이 좁은 창에서 할 일을 밀면 안 된다. 제 폭을 알리지 않는
 * 상자라 글자 폭으로는 서지 못해, 이름 칸(이름 상자 · 브랜치 · 위치의 줄)은 남는 폭을 먹는다(`flex-1`). 그 안에서 이름 상자는 DS
 * 그대로 제 글자 폭이고(`flex: 0 1 auto`) DS 상한 520에서 멈추며, 넘치는 이름은 그 안에서 말줄임으로 준다. 브랜치는 기준 폭이 0이라
 * (`flex-[1_1_0]`) 이름 상자가 제 폭을 다 가진 뒤 남는 폭만 받는다 — 이름이 먼저다. 그 남는 폭이 80 아래면 ⑂와 몇 글자도 못 들어
 * 통째로 걷힌다(`@container` — 반쯤 잘린 ⑂가 서지 않게). 위치는 이름 상자와 함께 준다(마지막 조각의 말줄임). 오른쪽 묶음은 화면 자리
 * 오른쪽 끝에 붙고(`ml-auto` — DS `.at-winctl-r`) 줄지 않는다(`shrink-0`) — 좁은 창에서도 할 일이 제 폭으로 선다(편집기의 「LLM이 받는
 * 텍스트」 · 「저장」도). 할 일이 없는 화면(Terminal · 빈 Works · 저장이 없는 설정 쪽)에는 묶음이 없다. 표식 `data-head-actions`는
 * 그것을 재는 검사가 집는다(e2e `tab-row.ts`의 `rowOf` — `HeadEnd`가 단다).
 *
 * **빈 자리는 창을 끈다** — 머리 줄이 `data-tauri-drag-region="deep"`이라 그 아래 어디를 눌러도 끌리고, Tauri는 누를 수 있는 요소(버튼 ·
 * `tabindex` · 입력칸 · 누르는 역할)를 만나면 끌지 않는다. 그래서 보이기만 하는 것(아이콘 · 이름 글자 · 위치 · 브랜치 · Archive의 배지
 * 글자 · 할 일 사이)은 끌고, 버튼과 포커스 받는 이름 상자(그 안의 아이콘까지)는 눌린다 — 끄는 자리의 두 번 클릭은 창 키우기라, 두 번
 * 클릭이 이름 바꾸기인 이름은 끌면 안 된다. 고치는 동안의 이름 상자는 포커스를 받지 않아 `false`로 막는다. 이 판정은 Tauri의 것
 * (`drag.js`의 `isDragRegion`)이라 누를 것을 새로 들일 때는 그 넷 중 하나로 짓는다 — `onClick`만 단 `span`은 끌린다.
 */
function FrameHead({
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
  /** 오른쪽 패널의 패널 토글 — 보기 배치(`end`) 뒤, 머리 줄 오른쪽 맨 끝에 선다. 화면이 건네는 것이 아니라 틀이 넣는다. */
  toggle?: ReactNode;
}) {
  const nameEl = useRef<HTMLSpanElement>(null);
  // **이름 상자 한 벌**(DS `.at-wtitle`) — 24 · 상한 520 · `radius-md` · 안쪽 왼쪽 8. 줄 상자(`block` · 줄 높이 24)이고 글자가 이 상자의
  // 바로 안이다 — 말줄임이 이 상자에서 끊기고, 글자로 이름을 찾는 쪽(`getByText`)이 이 상자(포커스 받는 그것)에 닿는다. 아이콘은 줄
  // 안의 글리프로 서서(`inline-block` · 위 5 — 24 줄에 14) 오른쪽 7을 둔다. 오른쪽 안쪽은 연필이 없으면 8, 있으면 연필 자리까지다(이름
  // 끝 5 · 연필 12 · 끝 8 — DS `.pen`의 왼쪽 -2가 사이 7에서 빠진다). 연필은 줄 밖에 떠(`absolute`) 말줄임이 그 앞에서 끊긴다.
  const titleBox = cn("block h-6 max-w-[520px] min-w-0 truncate rounded-md pl-2", HEAD_NAME, "leading-6");
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
        className={cn("-ml-1 h-6 px-1", HEAD_NAME)}
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
    <ScreenHead>
      <div className="-ml-1.5 flex h-full min-w-0 flex-1 items-center gap-1">
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
          <HeadEnd>
            {actions}
            {/* 세로선은 양옆 8을 둔다 — 묶음의 단추 사이 2에 제 6을 더한다. */}
            {actions && (end || toggle) && (
              <div role="separator" aria-orientation="vertical" className="mx-1.5 h-4 w-[0.5px] shrink-0 bg-border-heavy" />
            )}
            {end}
            {toggle}
          </HeadEnd>
        )}
      </div>
    </ScreenHead>
  );
}

/**
 * 카드의 겉(restart 스펙 「02a」 · 시안 `.ra-card`) — 둥글기 `radius-card`(8)와 바깥 0.5 링(`shadow-hairline`)이다. 면은 카드가 따로 칠한다
 * (흰 카드는 `surface`, 터미널 카드는 셸의 바탕). 본문 카드 · 내용 | 목록 카드 · 작업 패널 카드 · 옆 칸 카드가 이 한 벌을
 * 쓴다 — 레일 카드만 둥글기가 `radius-rail`(6)이다(`Rail`). 넘침은 카드가 자른다(`overflow-hidden`) — 링은 그림자라 제 넘침 숨김에
 * 잘리지 않는다.
 */
const CARD_FACE = "rounded-card shadow-hairline";

type CardTag = "section" | "main";

interface CardProps {
  /** 칸의 요소. 본문 칸은 `main`이고(문서의 `main`은 하나다), 그 밖은 `section`이다. */
  as?: CardTag;
  /** 칸의 이름(`aria-label`). */
  label: string;
  /**
   * 칸 머리 — 카드 머리 줄(`CardHead`) · 탭 줄(`ShellTabs`) · 경로 줄(`PathBar`)이다. 머리가 없는 칸은 곧바로 내용이 선다(ui-refresh
   * 결정 5).
   */
  head?: ReactNode;
  /**
   * `terminal`이면 칸 바탕이 **터미널 테마의 바탕**이다(판 04 기본값 — 설정이 밝게면 흰 칸). 셸의 집이 칠하는 값과 같은
   * 출처에서 읽는다(`useShellBackground`) — 둘이 갈리면 칸 가장자리에 다른 색의 띠가 선다.
   */
  tone?: "terminal";
  className?: string;
  children: ReactNode;
}

/**
 * 카드 하나(ui-refresh 결정 15 · restart 02a-2). 이름(`aria-label`)과 표식(`data-slot="card"`)을 들고, 제 겉(`CARD_FACE` — 둥글기 8 ·
 * 0.5 링)으로 선다 — 이웃 카드와는 8 틈으로 갈리고, 그 틈은 카드를 품은 상자가 든다(`PanelBox` · `BesideBox`). 카드가
 * 넘침을 자른다(`overflow-hidden`) — 안의 스크롤 상자 · 셸 화면이 칸 밖으로 그려지지 않는다. `relative`는 칸 안에 덮이는 것(설정의
 * 메시지 등)의 기준이다.
 *
 * 바탕은 터미널 칸이면 설정의 테마에서 읽은 바탕이고, 그 밖은 흰 칸(`bg-surface`)이다. **흰 칸과 터미널 칸이 한 컴포넌트다** —
 * 작업 화면의 본문 칸은 문서와 터미널을 오가는데, 둘이 다른 컴포넌트면 오갈 때마다 칸이 새로 서고 머리의 탭 줄도 함께 새로
 * 서서 방금 누른 `spec` 칸의 포커스와 줄의 스크롤을 잃는다. 테마는 터미널 칸만 구독한다 — 흰 칸은 훅이 늘 `undefined`를
 * 돌려줘 설정이 바뀌어도 다시 그려지지 않는다(`useShellBackground`).
 *
 * **내용 | 목록 칸 안에서는 내용 칸이다**(`InListCard` — codex-ds 결정 28). 면을 바깥 상자가 들어 이 상자는 면을 그리지 않고, 칸의
 * 표식(`data-slot="card"`)도 바깥 상자의 것이다 — 칸 줄의 칸은 하나다.
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
 * — 한때 탭 줄과 같은 `size-toolbar`였고, 탭 줄은 restart 02a-5부터 `size-tab-row` 40이다). `div`다. 문서 칸의 머리는 이것이 아니라 경로 줄(`PathBar`)이고,
 * 목록 칸의 머리는 목록 머리(`ListHead`)다. 좌우 여백은 8(`px-2` — DS `.at-toolbar` · `.at-panel-head`의 안쪽 8)이라 머리의 첫 버튼이
 * 카드 끝에서 8, 제목은 제 안쪽 8을 더해 카드 + 16(행 글자 16 — 아래 트리 행의 글리프와 한 세로줄)에 선다.
 *
 * **화면의 이름 · 위치와 할 일은 여기 서지 않는다** — 머리 줄이 든다(`HeadSlot`, codex-ds 스펙 §7). 칸 안에 고를 것이 없으면 그
 * 칸에는 이 줄이 없다. `end`는 오른쪽 끝에 고정되는 조작이다.
 */
function CardHead({
  end,
  children,
  ...marks
}: {
  end?: ReactNode;
  /** 줄 왼쪽에 서는 것 — spec 패널 머리의 제목 · 편집기 트리 카드의 도구. */
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
 * 세로줄이다(DS 「행 글자 16」). `div`다. 표식 `data-slot="list-head"`는 검사가 집는다.
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

export { Card, CARD_FACE, CardHead, Frame, ListHead, ListScroll, ListSearch, TWO_LINE_ROW };
