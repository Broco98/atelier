import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Settings, type LucideIcon } from "lucide-react";
import { shallow, useStore } from "@tanstack/react-store";
import { cn } from "@/lib/utils";
import SidebarWorkList from "@/features/works/SidebarWorkList";
import type { WorkView } from "@/features/works/types";
import { useWorks } from "@/features/works/hooks";
import {
  ownerOf,
  shellCountsOf,
  shellsOf,
  slugOfOwner,
  type ShellsState,
} from "@/features/terminal/shell-registry";
import type { ShellOwner } from "@/features/terminal/shell-registry";
import {
  bandRows,
  callingNotesOf,
  signalsOf,
  topSignalView,
} from "@/features/terminal/shell-attention";
import type { BandRow } from "@/features/terminal/shell-attention";
import { setNotifyTitles, terminalStore } from "@/features/terminal/terminal-store";
import ProcessesNavMeta from "@/features/processes/ProcessesNavMeta";
import { SETTINGS_ITEMS, type SettingsItemKey } from "@/features/settings/pages";
import { AttentionBand, type BandItem } from "./attention-band";
import { foldingInnerClass, PANEL_MOTION } from "./panel-layout";
import { navItems, TERMINAL_LABEL, type NavKey } from "./nav-items";
import { ShellMeta } from "./shell-meta";
import { SignalMeta, showsElapsed, type CallingNote } from "./shell-signal";
import useGoToShell from "./useGoToShell";
import useResizableWidth, { ResizeHandle, type ResizableWidth } from "./useResizableWidth";

interface SidebarProps {
  open: boolean;
  // Works 화면에서는 활성 항목이 없다 — nav에 Works가 없기 때문이다
  activeKey: NavKey | null;
  onSelect: (key: NavKey) => void;
  /**
   * 지금 선 설정 항목. **`null`이 아니면 사이드바가 설정 nav를 그린다**(UI개선 결정 21) — 한 값이
   * 「설정 nav인가」와 「어느 항목이 켜졌나」를 함께 답한다. 앱 셸이 원시값 select로 읽어 내린다.
   */
  currentSettingsItem: SettingsItemKey | null;
  // 설정은 nav 항목이 아니라 바닥에 따로 산다(결정 51)
  onOpenSettings: () => void;
  onPickSettingsItem: (key: SettingsItemKey) => void;
  /** 설정 nav 맨 위 「앱으로 돌아가기」. 어디로 가는지는 앱 셸이 안다(결정 27). */
  onLeaveSettings: () => void;
}

// 좌우 8px로 같다. 한때 오른쪽만 19px(= 거터 8 + 스크롤바 11)이었다 — 가운데 작업 목록이
// 막대 자리를 늘 예약하고 있어서, 같은 값을 비워 둬야 nav 항목과 목록 항목의 오른쪽 끝이
// 맞았다. 막대가 콘텐츠 위로 뜨면서(결정 32) 목록이 그 11px을 돌려받았고, 이 거터도 함께
// 돌아왔다. 둘이 세로로 붙어 있어 어긋나면 그 자리에서 보인다.
// **바닥의 설정도 같은 거터를 쓴다** — 결정 51이 이 정렬 계약의 경계를 하나 늘렸다.
const GUTTER = "pl-2 pr-2";

// 고정 nav 블록 + 상주하는 작업 목록 + 바닥에 고정된 설정. 앱의 어느 화면에 있든 이 사이드바는
// 바뀌지 않고, 설정에서만 설정 nav로 갈아 선다(UI개선 결정 21).
// 목록이 여기 살면서 셸이 작업 데이터를 직접 읽게 됐다 — 순수 프레젠테이션이 아니다.
function Sidebar({
  open,
  activeKey,
  onSelect,
  currentSettingsItem,
  onOpenSettings,
  onPickSettingsItem,
  onLeaveSettings,
}: SidebarProps) {
  const size = useResizableWidth("sidebar-width", 280, 240, 400);
  // **work마다 셸이 몇 개인가만 읽는다**(결정 2·3). 셀렉터가 얕은 비교를 타므로 셸이
  // 열리고 닫힐 때만 이 셸이 다시 그려진다 — 프롬프트마다 오는 OSC 타이틀에는 안 흔들린다.
  // 목록이 스스로 구독하지 않는 이유는 `WorkRowShells`(`WorkSectionList.tsx`) 머리말에 있다.
  // 키가 slug인 것은 목록이 터미널을 모르기 때문이다 — `shellCountsOf` 머리말이 그 사정을 든다.
  // nav `Processes`의 메타는 앱 전체의 메모리 합계와 손볼 것을 세운다(`ProcessesNavMeta` · 프로세스 결정 9).
  const shellCounts = useStore(terminalStore, (state) => shellCountsOf(state), shallow);
  // 최상위 셸은 어느 work의 것도 아니라 nav 항목이 그 수를 안는다 — 세는 자리도 따로다.
  // 숫자 하나라 얕은 비교가 필요 없다. 이 값도 work 행과 **같은 어휘**로 선다(결정 4).
  // 소유자는 최상위 터미널의 것이다(빈 글자 `""`).
  const topShells = useStore(terminalStore, (state) => shellsOf(state, ownerOf()).length);
  // **화면값은 한 번에 읽어 내린다**(#203). 행마다 고르는 시각(`RowMetaFor`)과 반대 방향인 것은 값의 모양 때문이다:
  // 이 Record는 문자열만 담아 얕은 비교가 그대로 먹는다(`signalsByOwner` 머리말). 행마다
  // 구독하면 열여덟이 같은 셀렉터를 각자 돌면서 얻는 것이 없다.
  const signals = useStore(terminalStore, (state) => signalsOf(state), shallow);
  // **부르는 셸이 한 말도 한 번에 읽어 내린다**(`sidebar-active-band` 결정 14). 호버 카드의 말 칸과
  // 행 버튼의 설명이 이 값 하나를 나눠 읽는다 — 설명은 버튼의 속성이라 슬롯으로 못 가고, 카드는
  // 목록 밖의 포털이다. 고르는 것은 레인·오른쪽 메타와 같은 `topSignalView`라 같은 셸의 말이다.
  //
  // **여기만 비교가 한 겹 더 깊다**(`sameNotes`). 값이 문자열이 아니라 종류와 말을 든 객체라
  // 회차마다 새것이고, 기본 얕은 비교면 셸이 프롬프트마다 쏘는 타이틀 하나에 목록 전체가 다시
  // 그려진다(띠의 `sameBand`와 같은 함정).
  const notes = useStore(terminalStore, (state) => callingNotesOf(state), sameNotes);
  // **띠가 읽는 줄들**(#204). 이것만은 위 셋과 달리 얕은 비교로는 안 걸린다 — 값이 객체
  // 배열이라 회차마다 새것이다. 그래서 비교를 한 겹 더 벗기는 `sameBand`를 쓴다(그쪽 주석):
  // 띠는 셸이 프롬프트마다 쏘는 타이틀에도, 1초 폴링의 「도는 것」에도 안 흔들려야 한다.
  const rows = useStore(terminalStore, (state) => bandRows(state), sameBand);
  // **펼침은 여기 산다 — `useState`다.** 「앱이 떠 있는 동안만 기억한다」(결정 5)가 그 뜻이고,
  // 이 앱의 「위치는 세션, 설정은 영속」에서 위치 쪽이다. localStorage에 적으면 어제 펼쳐 둔
  // 것이 오늘 처음 뜨는 띠에 되살아난다 — 그때 부르는 셸은 어제의 그것들이 아니다.
  const [bandOpen, setBandOpen] = useState(false);
  // work 제목은 목록 API가 준다 — 터미널은 슬러그까지만 안다(`bandRows` 머리말).
  const { data: works = [] } = useWorks();
  // **규칙 하나를 둘이 나눠 쓴다**(`titleResolver` 머리말). `useMemo`인 것은 이 함수가 곧
  // 알림 배선의 의존이기 때문이다 — 회차마다 새로 지으면 목록이 안 바뀌어도 배선이 다시 걸린다.
  const resolveTitle = useMemo(() => titleResolver(works), [works]);
  const items = bandItems(rows, resolveTitle);
  useNotifyTitles(resolveTitle);
  // 띠의 줄은 늘 경과를 단다(부르는 것만 서므로) — 줄이 하나라도 있으면 시계가 돈다.
  const bandNow = useNow(items.length > 0);
  // 띠의 줄을 누르면 그 셸로 간다 — ⌘J(방금 부른 셸로)와 **같은 길**이다(`useGoToShell`).
  const openBand = useGoToShell();

  // **설정이면 설정 nav를 그린다**(UI개선 결정 21) — nav·띠·작업 목록·바닥 Settings가
  // 빠지고 「← 앱으로 돌아가기」와 항목만 선다.
  //
  // **훅을 다 부른 뒤, 이 컴포넌트 안에서 가른다.** 사이드바를 통째로 바꿔 끼우면 위의 알림 제목
  // 배선(`useNotifyTitles`)이 설정에 있는 동안 멎는다 — 설정에서도 셸이 부르면 OS 알림은 운다
  // (그 셸이 보이면 안 울리는 규칙 그대로이고, 설정에서는 어느 셸도 안 보인다). 띠를 펼친 상태도
  // 여기 살아 있어 돌아가면 띠가 그대로다.
  //
  // 겉 상자(`SidebarFrame`)는 두 갈래가 **같은 컴포넌트**라 React가 그대로 이어 쓴다 — 폭 트랜지션도
  // 접힘도 새로 시작하지 않는다. 접힌 채 들어오면 접힌 채다(새 규칙 없음).
  if (currentSettingsItem !== null) {
    return (
      <SidebarFrame open={open} size={size}>
        <SettingsNav
          current={currentSettingsItem}
          onLeave={onLeaveSettings}
          onPick={onPickSettingsItem}
        />
      </SidebarFrame>
    );
  }

  // 행의 오른쪽 메타도 **여기서 읽어 내린다**(결정 2) — 개수(`shellCounts`)가 이미 쓰는 그
  // 우회와 같은 길이고, 이유도 같다: 목록은 터미널을 한 번도 참조하지 않는다. **셸 수는
  // 구독하지 않고 위에서 읽은 Record에서 꺼내 내려준다**(결정 8) — 행마다 구독하는 것은
  // 신호 하나다. 구독이 행마다 따로인 이유는 `RowMetaFor`가 든다.
  const renderRowMeta = (work: WorkView) => (
    <RowMetaFor owner={ownerOf(work.slug)} shellCount={shellCounts[work.slug] ?? 0} />
  );

  return (
    <SidebarFrame open={open} size={size}>
      {/* 거터는 GUTTER 하나가 정한다 — 그 정렬 계약이 걸리는 자리는 GUTTER 주석이 든다 */}
      <nav className={cn("flex shrink-0 flex-col gap-(--row-gap)", GUTTER)}>
        {/* **`navItems`를 돈다**(#183) — 활성 판정(AppShell)과 팔레트의 「가는 곳」(`destinations.ts`)도 같은
            배열을 본다. */}
        {navItems.map((item) => (
          <SidebarItem
            key={item.key}
            icon={item.icon}
            label={item.label}
            active={item.key === activeKey}
            onClick={() => onSelect(item.key)}
            // **최상위 셸이 몇 개인가는 남는다**(결정 6이 걷은 것은 펼침이지 이 숫자가
            // 아니다). work 행이 오른쪽 메타로 「여기서 일이 돌고 있다」를 말하는 것과 같은
            // 몫이고, 여기가 아니면 그 셸들의 수가 사이드바 어디에도 안 남는다 —
            // 그 화면에 들어가야만 보인다.
            //
            // **개수가 아니라 메타 슬롯이다**(결정 4·13). work 행과 같은 어휘(`⌨ 셸 수`)로
            // 서고, 최상위 셸에서 claude가 돌아도 로고는 안 뜬다(ui-refresh 결정 13).
            // 「없으면 아무것도 안 선다」도 슬롯 안으로 내려갔다.
            //
            // **`Processes`의 메타는 앱 전체다**(프로세스 결정 9 · 11) — 메모리 합계와 손볼
            // 것의 `●`. 요약 폴러(10초)가 그 안에 산다.
            meta={
              item.key === "terminal" ? (
                <RowMetaFor owner={ownerOf()} shellCount={topShells} />
              ) : item.key === "processes" ? (
                <ProcessesNavMeta />
              ) : null
            }
          />
        ))}
      </nav>

      {/* **목록 위, nav 아래**(결정 5). 부르는 셸이 없으면 이 자리에 아무것도 없다 —
          그 가름은 조각 안에 있다(`AttentionBand`의 첫 줄). 거터가 nav·설정과 같은 것은
          그 셋이 한 컬럼에 세로로 붙어 서기 때문이다(GUTTER 주석).

          **목록 밖에 서는 것이 이 띠의 값 절반이다**(스토리 43) — 스크롤로 밀려난 work의
          셸이 불러도 여기서는 보인다. 안에 넣으면 판 04 결정 21이 감수했던 「어디에도 안
          보인다」가 그대로 남는다.

          **이 래퍼는 형제들과 달리 `shrink-0`이 아니라 `min-h-0`이다.** nav도 설정도
          `shrink-0`을 다는데 여기서 따라 달면 낮은 창에서 띠가 자기 높이를 끝까지 우겨
          바닥의 Settings가 `aside`의 `overflow-hidden` 밖으로 잘린다 — 목록은 이미
          `flex-1 min-h-0`인데 flex-basis가 0이라 줄일 것이 없고(줄어드는 몫은 base에
          비례한다), 그래서 남는 것을 내놓을 수 있는 것이 이 자리뿐이다. `min-h-0`이
          **명시**여야 하는 것은 자동 최소 크기 때문이다: 안쪽 띠가 스크롤 상자라 자기
          최소는 0이지만, 그 사실이 이 래퍼의 `min-height: auto`까지 눕히지는 않아
          래퍼가 안 줄어든다(실측 — 창 300px에서 Settings가 16px 잘렸다).

          그래서 낮은 창에서 양보하는 쪽이 「띠가 굴러간다」이고 지키는 쪽이 「목록과
          Settings가 남는다」다(스토리 39). */}
      <div className={cn("flex min-h-0 flex-col", GUTTER)}>
        <AttentionBand
          items={items}
          now={bandNow}
          expanded={bandOpen}
          onToggle={() => setBandOpen((on) => !on)}
          onOpen={openBand}
        />
      </div>

      <SidebarWorkList
        open={open}
        // 셸에서 오는 값 넷은 **한 묶음으로** 내려간다(`WorkRowShells`) — 목록은 그것을 행까지
        // 나를 뿐 터미널을 한 번도 참조하지 않는다.
        shells={{ shellCounts, signals, notes, renderRowMeta }}
      />

      {/* **바닥 고정** — 「설정은 목적지 셋과 성질이 다르다」를 위치로 말한다(결정 51).
          `navItems` 배열에 한 줄 넣는 안은 기각됐다: 그 배열의 주석이 「앞으로 늘어날
          목적지는 이 배열에 한 줄」로 길을 열어 뒀지만, 설정은 그 목적지들이 아니다.
          대가는 여기 그대로 있다 — 작업 목록 아래에 새 영역이 생기고, 위 nav와 같은
          규격을 쓰면서 자리가 갈린다. 그래서 규격은 `SidebarItem` 하나로, 거터는 GUTTER
          하나로 묶어 「같은 규격」이 주석이 아니라 구조가 되게 했다.

          **윗변에 늘 1px 선이 있다**(UI개선 결정 25) — 작업 목록과 설정 사이다. 스크롤과
          무관하다: 목록 **윗** 가장자리의 선은 굴렀을 때만 서지만(`SidebarWorkList`), 바닥은
          목록이 어디에 있든 「여기부터 목록이 아니다」라서. 이 칸은 스크롤 상자가 아니라
          테두리가 막대를 밀 일이 없다 — 목록 윗선이 테두리를 못 쓰는 이유가 여기엔 없다.

          표식은 검사가 이 칸을 정체성으로 집기 위한 것이다 — 버튼에서 부모를 몇 겹 거슬러
          오르는 길은 `SidebarItem`의 감싸개 수에 묶인다. */}
      <div data-sidebar-foot="" className={cn("shrink-0 border-t pt-1.5", GUTTER)}>
        {/* 켜질 일이 없다 — 설정에 들어가면 이 칸째 설정 nav로 바뀐다(UI개선 결정 21). */}
        <SidebarItem icon={Settings} label="Settings" active={false} onClick={onOpenSettings} />
      </div>
    </SidebarFrame>
  );
}

/**
 * 사이드바의 겉 상자 — `aside` · 폭이 고정된 안쪽 열 · 신호등 띠 · 폭 손잡이. 두 갈래(앱·설정)가
 * **이 컴포넌트 하나**를 지나서, 「같은 자리에 같은 요소」가 주석이 아니라 구조가 된다 — 한쪽만
 * 고치면 설정에 들어갈 때 폭이 튀거나 트랜지션이 새로 시작한다.
 */
function SidebarFrame({
  open,
  size,
  children,
}: {
  open: boolean;
  size: ResizableWidth;
  children: ReactNode;
}) {
  return (
    <aside
      style={
        {
          "--sidebar-width": `${size.width}px`,
          "--sidebar-min": `${size.min}px`,
        } as React.CSSProperties
      }
      className={asideClass(open, size.dragging)}
    >
      {/* fixed inner width so text doesn't reflow while the width animates.

          **선 뒤에는 바깥 폭을 넘지 않는다** — 작업 패널 안쪽 열과 같은 장치다(`panel-layout`의 `foldingInnerClass`).
          사이드바가 탭 줄에 자리를 내줘 좁게 서면 고정 폭 그대로는 행 오른쪽의 셸 수·신호가
          잘린다. 상한은 작업 패널과 같은 `100%`다 — 바깥 상자에 오른쪽 경계선이 없어(ui-refresh 결정 4)
          안쪽 열이 든 폭이 곧 바깥 폭이다. */}
      <div
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col pb-2.5",
          foldingInnerClass(open),
        )}
      >
        {/* traffic light strip — same height as the main header (the header no
            longer draws a bottom border; the 44px strip is what keeps the two
            columns aligned). It is also the nav's top breathing room, which is
            why the nav below carries no top padding of its own. */}
        <div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />
        {children}
      </div>
      {open && <ResizeHandle control={size} />}
    </aside>
  );
}

/** 바깥 상자의 규격 — 접힘과 드래그만 받는다. */
function asideClass(open: boolean, dragging: boolean): string {
  return cn(
    // **탭 줄에 자리를 내준다** — 줄어들 수 있고(`shrink-0`이 없다) 끄는 최소 폭(`--sidebar-min`)
    // 까지만 준다. 탭 줄이 모자랄 때 여기 차례가 온다(`panel-layout`의 `TAB_ROW_COLUMN`) — 작업 패널은 줄 아래
    // 카드 줄에 서서(ui-refresh 결정 4) 줄과 폭을 다투지 않으므로, 이제 그 차례는 앱 창의 최소 폭(900) 아래에서만
    // 온다(e2e `tab-row.ts`의 `squeezedWidth`). 탭 줄 말고 자리를 요구하는 것은 편집기의 두 카드 머리 하나다(`Frame`의
    // `BesideBox` — 넓혀 둔 사이드바와 좁은 창이면 온다). 다른 화면의 본문은 자리를 요구하지 않아 그 화면들에서는 늘 고른 폭이다.
    // 최소 폭을 **펼 때만** 트랜지션하는 이유는 작업 패널 칸(`Frame`의 `PanelBox`) 주석과 같다.
    //
    // **오른쪽 경계선이 없다**(ui-refresh 결정 4) — 사이드바는 창 바탕에 붙고, 경계는 옆 카드의 모서리가 말한다.
    // 바탕(`bg-surface-shell`)은 그래도 칠한다: 창 바탕과 같은 색이지만 투명이면 대비를 재는 e2e가 `aside`의 바탕을
    // `rgba(0,0,0,0)`으로 읽는다(`works-sidebar.spec.ts` — 행 메타와 점의 대비를 그 바탕 위에서 잰다).
    "relative overflow-hidden bg-surface-shell",
    // 드래그 중엔 폭 트랜지션을 꺼서 커서를 즉각 따라오게 한다.
    // 곡선은 --ease-panel — 접히는 칸(사이드바 · 작업 패널 · 목록 칸)이 같은 값을 읽는다 (index.css)
    !dragging && PANEL_MOTION,
    !dragging && (open ? "transition-[width,min-width]" : "transition-[width]"),
    open ? "w-(--sidebar-width) min-w-(--sidebar-min)" : "w-0 min-w-0",
  );
}

/**
 * 설정 nav(UI개선 결정 21). 맨 위 「← 앱으로 돌아가기」, 그 아래 설정 nav 항목들 — 표는
 * `SETTINGS_ITEMS`(`features/settings/pages.ts`)가 든다.
 *
 * **규격은 main nav와 같은 `SidebarItem`이고 거터도 GUTTER다** — 같은 사이드바 자리에 갈아 서는
 * 것이라 규격이 갈리면 들어가는 순간 행이 튄다. 켜짐은 앱 셸이 내린 원시값과 견준다 — 라우터 링크의
 * 활성 매칭은 링크마다 주소를 구독한다.
 *
 * 돌아가기와 항목 사이는 `pb-3`으로 뗀다 — 돌아가기는 「고르는 것」 위에 선 「어디에 있나」다.
 */
function SettingsNav({
  current,
  onLeave,
  onPick,
}: {
  current: SettingsItemKey;
  onLeave: () => void;
  onPick: (key: SettingsItemKey) => void;
}) {
  return (
    <>
      <div className={cn("shrink-0 pb-3", GUTTER)}>
        <SidebarItem icon={ArrowLeft} label="앱으로 돌아가기" active={false} onClick={onLeave} />
      </div>
      <nav aria-label="설정" className={cn("flex shrink-0 flex-col gap-(--row-gap)", GUTTER)}>
        {SETTINGS_ITEMS.map((item) => (
          <SidebarItem
            key={item.key}
            icon={item.icon}
            label={item.label}
            active={item.key === current}
            onClick={() => onPick(item.key)}
          />
        ))}
      </nav>
    </>
  );
}

/**
 * 띠의 줄들이 **다 같은가**. `useStore`의 얕은 비교를 한 겹 더 벗긴 것이다.
 *
 * 이 한 겹이 필요한 이유는 값의 모양이다: `bandRows`는 **객체 배열**을 새로 지어 돌려주므로
 * 기본 얕은 비교는 늘 어긋나고, 그러면 셸이 프롬프트마다 쏘는 OSC 타이틀 하나에, 1초 폴링의
 * 「도는 것」 한 칸에, 띠가 통째로 다시 그려진다 — 회차마다 새 객체를 주는 셀렉터의 그 함정이고
 * (`signalsOf` 머리말), 여기서는 목록이 아니라 띠가 그 자리에 선다.
 *
 * 안쪽을 `shallow`로 견주는 것은 줄이 **원시값만** 담기 때문이다(`BandRow`). 한 겹 더 깊은
 * 비교가 필요해지는 날은 줄에 객체가 들어오는 날이고, 그때는 이 비교가 아니라 그 값을 다시 봐야 한다.
 */
function sameBand(a: ReadonlyArray<BandRow>, b: ReadonlyArray<BandRow>): boolean {
  return a.length === b.length && a.every((row, index) => shallow(row, b[index]));
}

/**
 * work마다의 말이 **다 같은가** — `sameBand`와 같은 한 겹이고, 배열이 아니라 Record라 키로 견준다.
 * 안쪽이 원시값 둘(`kind`·`message`)뿐이라 `shallow`로 끝난다. 한쪽에만 있는 키는 저쪽 값이
 * `undefined`라 거기서 어긋난다.
 */
function sameNotes(
  a: Readonly<Record<string, CallingNote>>,
  b: Readonly<Record<string, CallingNote>>,
): boolean {
  const slugs = Object.keys(a);
  return slugs.length === Object.keys(b).length && slugs.every((slug) => shallow(a[slug], b[slug]));
}

/**
 * 셸이 앉은 자리(`owner`)를 **화면의 이름**으로 바꾸는 규칙 — 그리고 **이 규칙이 적히는
 * 유일한 자리**다. 터미널은 슬러그까지만 알고(`bandRows` 머리말) 제목은 목록 API가 주므로,
 * 둘을 다 쥔 이 컴포넌트가 그 자리다.
 *
 * **띠와 알림이 같은 함수를 딛는다.** 한때 이 규칙이 스무 줄 사이에 **글자 그대로 두 벌**로
 * 있었다(`bandItems`와 `useNotifyTitles`가 각자 같은 Map을 짓고 같은 삼항을 적었다) — 두
 * 티켓이 서로 못 본 채 넣은 것이고, 둘이 같은 값을 내야 하는 것은 우연이 아니라 계약이다:
 * 띠 줄을 눌러 가는 곳과 알림이 가리키는 곳이 같은 화면이다. 「지워진 work을 뭐라 적나」
 * 같은 물음이 한 번이라도 늘면 한쪽만 고쳐지고, 그러면 같은 셸이 띠에서는 `결제 정산`,
 * 알림에서는 `payment-recon`이 된다 — 알림은 화면 밖에서 오는 것이라 대조할 것이 없다.
 * `TERMINAL_LABEL`·`BAND_LABEL`·`showsElapsed`가 전부 같은 이유로 한 자리에 서 있다.
 *
 * 최상위 셸의 이름은 nav 항목의 것 그대로다(`TERMINAL_LABEL`) — 누르면 가는 곳이 그 항목이
 * 가는 곳이라, 이름이 갈리면 같은 화면이 사이드바에서 두 이름을 갖는다.
 *
 * **모르는 슬러그는 슬러그를 적는다.** 목록이 아직 안 왔거나 그 사이 지워진 work의 셸이
 * 부를 수 있는데, 그때 줄을 빼면 사람은 부르는 셸을 못 찾고 이름을 비우면 「— 나를 기다림」만
 * 남는다. 둘 다 이 띠가 있는 이유를 스스로 무너뜨린다. (배선 전 기본값도 같은 답을 낸다 —
 * `terminal-store.ts`의 `notifyTitleOf`.)
 */
function titleResolver(works: ReadonlyArray<WorkView>): (owner: ShellOwner) => string {
  const titles = new Map(works.map((work) => [work.slug, work.title]));
  return (owner) => {
    const slug = slugOfOwner(owner);
    if (slug === null) return TERMINAL_LABEL;
    // **못 찾으면 슬러그다** — 목록이 아직 안 왔거나 그 사이 지워진 work의 셸이다(위 머리말).
    return titles.get(slug) ?? slug;
  };
}

/** 줄에 화면의 이름을 붙인다. 규칙은 위 하나이고 여기는 그것을 줄마다 부르기만 한다. */
function bandItems(
  rows: ReadonlyArray<BandRow>,
  resolve: (owner: ShellOwner) => string,
): BandItem[] {
  if (rows.length === 0) return [];
  return rows.map((row) => ({ ...row, title: resolve(row.owner) }));
}

/**
 * 알림 제목이 읽을 이름표를 배선에 건넨다(#206). **띠가 쓰는 그 함수 그대로다**(위
 * `titleResolver` 머리말) — 알림은 터미널 쪽 모듈 구독이 쏘므로 그쪽은 목록 API를 모른다.
 *
 * **이 사이드바는 늘 서 있다**(`AppShell`) — 접혀도 렌더된다. 그래서 「알림이 배선을 못 찾는
 * 화면」이 없다.
 */
function useNotifyTitles(resolve: (owner: ShellOwner) => string): void {
  useEffect(() => {
    setNotifyTitles(resolve);
  }, [resolve]);
}


/**
 * 행의 **오른쪽 메타** 하나가 자기 것만 구독한다(결정 2·4 · `sidebar-active-band` S4·S5). 스토어를
 * 아는 자리가 여기라서 그림(`ShellMeta`·`SignalMeta`)과 갈렸다 — 그쪽은 터미널을 모르는 순수
 * 컴포넌트라 정적 마크업 seam에 산다.
 *
 * **갈래가 둘이다**: 그 행의 셸이 부르거나 돌면 **그 셸의 신호**(부르면 경과, 돌면 비움 —
 * `SignalMeta`)이고, 조용하면 셸 수(`ShellMeta`)다. 에이전트 마크는 어느 갈래에도 없다(ui-refresh
 * 결정 13). 가름이 **한 컴포넌트 안**인 것이 요점이다 — 조건을 둘로 나누면 레인은 부르는데
 * 메타는 셸 수인 화면이 한 프레임 난다. 이름이 `ShellMetaFor`가 아닌 것은 그 때문이다: 이 자리가
 * 고르는 것은 셸 메타가 아니라 **오른쪽 메타 전체**다. (두 줄 행에서는 이 자리가 둘째 줄 전체를
 * 골라 `SubrowFor`였다 — S5.)
 *
 * **신호는 행마다 자기 것을 고른다.** 화면값과 시각이 한 묶음이라 문자열 하나로 안 접히고, 위에서
 * Record로 한 번에 읽어 내리면 안쪽 객체가 회차마다 새것이라 얕은 비교가 늘 어긋나 셸 하나가
 * 말할 때마다 **목록 전체가** 다시 그려진다. 행마다 고르면 안 바뀐 행은 같은 값을 받아 그 자리에 머문다.
 *
 * **개수는 반대로 위에서 한 번에 읽어 prop으로 내려온다**(`shellCounts`) — 그 값은 셸이
 * 열리고 닫힐 때만 바뀌어 얕은 비교가 실제로 걸린다(결정 8). 둘이 갈리는 자리가 여기다.
 *
 * **소유자의 slug가 비어 있으면 최상위, 곧 nav `Terminal`이다**(결정 10). work 행과 nav가
 * 이 컴포넌트 **하나**를 함께 쓴다 — nav를 위해 구독을 하나 더 파면 「셀렉터를 부르는 자리가
 * 하나」가 깨지고(Sidebar.test.tsx가 센다) 같은 값을 고르는 자리가 둘이 된다.
 */
function RowMetaFor({ owner, shellCount }: { owner: ShellOwner; shellCount: number }) {
  // **신호의 셋**(종류·말·시각, #203). 위 Record에 못 태우는 것은 문자열 하나로 안 접히기
  // 때문이고 — 객체를 담으면 얕은 비교가 늘 어긋난다 — 그래서 셸 수를 받는 **같은 자리에서**
  // 자기 것만 고른다. 한 컴포넌트인 것이 중요하다: 갈래를 가르는 조건이 둘로 나뉘면 레인은
  // 부르는데 메타는 셸 수인 화면이 한 프레임 난다.
  //
  // 얕은 비교가 여기서 먹는 것은 안쪽이 **원시값 셋**이라서다(`SignalView`). 값이 없을
  // 때 `null`인 것도 그대로 견줘진다(`Object.is(null, null)`). 그중 말(`message`)은 이
  // 자리가 안 그리지만(말은 카드와 설명이 `callingNotesOf`로 읽는다) 셀렉터를 가르지 않는다 —
  // 고르는 함수가 레인·카드와 같은 `topSignalView` 하나인 것이 스토리 39의 전부라서다.
  const signal = useStore(terminalStore, (state) => rowSignalOf(state, owner), shallow);
  // 경과는 시각이 아니라 **지금과의 차**라 아무도 안 건드려도 늙는다. 도는 중과 조용한
  // 셸에는 경과가 안 붙으므로(결정 13) 그때는 시계도 안 돈다 — 그 판정을 여기서 다시 적지
  // 않고 그리는 쪽과 **같은 함수**를 딛는다(`showsElapsed`). 규칙이 바뀌는 날 한쪽만 고치면
  // 값이 조용히 늙거나, 아무도 안 읽는 시계가 열여덟 행에서 돈다.
  const now = useNow(signal !== null && showsElapsed(signal.kind));

  if (signal !== null) {
    return <SignalMeta kind={signal.kind} since={signal.since} now={now} />;
  }
  return <ShellMeta shellCount={shellCount} />;
}

/**
 * 그 자리가 그릴 화면값. **최상위 셸(nav `Terminal`)은 여기서 아무것도 안 그린다.**
 *
 * 스펙의 Out of Scope가 「셸 메타 규격의 nav `Terminal` 변경」을 이 판에서 빼 뒀다 — 그 행은
 * 셸 수 그대로이고, 최상위 셸이 부르는 것을 받는 자리는 알림 띠다(#204, 결정 13의
 * 다섯째). work 행과 **같은 구독 컴포넌트**를 쓰기 때문에 이 가름이 빠지기 쉬운데, 빠지면
 * nav 행이 work 행의 어휘를 반쯤 흉내 낸다 — 실제로 한 번 그렇게 났고 L3가 잡았다.
 */
function rowSignalOf(state: ShellsState, owner: ShellOwner) {
  return slugOfOwner(owner) === null ? null : topSignalView(shellsOf(state, owner));
}

/**
 * 경과를 다시 그리는 주기.
 *
 * **첫 1분의 `s`가 반 칸 넘게 늙지 않는 값이다.** 적히는 것은 대개 분 단위라(`s`는 첫 1분뿐)
 * 그 뒤로는 60초여도 충분하지만, 갓 부른 행이 `0s`에 59초 동안 앉아 있으면 「방금 불렀나」가
 * 거짓이 된다 — 가장 자주 보는 순간이 그 첫 1분이다. 두 배로 촘촘하게 도는 대가는 행마다
 * 30초에 한 번의 리렌더이고, 그것도 **부르는 행에만** 붙는다(`useNow`).
 */
const ELAPSED_TICK = 30_000;

/**
 * 경과를 늙게 하는 시계.
 *
 * **스피너와 아무 상관이 없다.** 레인의 스피너를 돌리는 것은 CSS이고(`Spinner`의 호), 이
 * 시계는 「몇 분 기다렸나」라는 **글자**의 것이다 — 그 가름이 흐려지면 스토리 30이 막으려던
 * 「신호가 대가를 낸다」가 되돌아온다.
 *
 * 부르는 행에만 돌고, 그 행이 조용해지면 멎는다.
 */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    // 켜지는 순간 한 번 맞춘다 — 멎어 있던 동안 흘러간 시간이 첫 화면에 그대로 앉는다.
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), ELAPSED_TICK);
    return () => window.clearInterval(timer);
  }, [ticking]);
  return now;
}

// nav 항목과 바닥의 설정이 **같은 컴포넌트**를 쓴다. 둘은 한 컬럼에 세로로 붙어 있어
// 규격이 갈리면 그 자리에서 보이는데(위 GUTTER 주석과 같은 계약), 같은 문자열을 두 곳에
// 적어 두면 다음에 규격을 한 번 조정할 때 한쪽만 남는다 — index.css의 quiet-hover 주석이
// 같은 이유로 열 자리를 하나로 묶었다.
//
// **누르면 바로 간다**(결정 6). 한때 `Terminal`이 가는 곳이면서 셸 가지를 이고 있어 한
// 행에 누를 것이 둘이었는데(결정 72), 셸을 고르는 자리가 화면 안 탭 줄로 되돌아가면서
// (adr-03) 그것이 통째로 걷혔다 — 이 항목은 다시 **더 갈라지지 않는 줄**이다.
//
// 남은 메타는 **접힌 가지의 잔재가 아니다**: 그 work에서 무엇이 몇 개 도는지를 말하는 work
// 행 오른쪽 메타와 같은 몫이고(결정 2), 여기 없으면 최상위 셸의 수가 사이드바에서 사라진다.
// 배경(선택·hover)은 바깥 상자가 갖고 가로 여백은 이름 버튼이 품는다 — 바깥이 가진 padding은
// 두 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리가 된다.
// 메타가 행 전체를 누르는 데 걸리적거리지 않게 이름 버튼 **안**에 두지 않는다: 그러면 셸
// 수가 이 항목의 접근성 이름에 섞여 「이름으로 nav를 집는다」가 깨진다(WorkRow의 메타와
// 같은 함정이다).
function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
  meta = null,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  /**
   * 이 항목이 안고 있는 셸의 **메타**(결정 13). 개수가 아니라 슬롯인 것은 그 값이 터미널
   * 스토어를 구독해야 나오기 때문이고(셸 수 · Processes의 메모리), 「없으면 아무것도 안 선다」는 규칙도 그 안으로
   * 내려갔다 — `ShellMeta`가 셸 0개일 때 아무것도 돌려주지 않는다.
   */
  meta?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center rounded-lg pr-1 transition-colors",
        // 안 고른 행도 행 글자색이다(ui-refresh 결정 11 — Codex 사이드바). 흐린 회색으로 두면 고른 행만 읽힌다.
        active ? "selected-row" : "text-fg hover:bg-fill-soft",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex h-full min-w-0 flex-1 items-center gap-[9px] pl-[9px] pr-1.5 text-left text-nav-row"
      >
        <Icon className="size-[17px] shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {/* 배지가 아니라 옅은 숫자다 — 구획 헤더의 개수와 같은 규격이라, 한 컬럼에 세로로
          붙어 서는 둘이 다른 무게로 읽히지 않는다(GUTTER 주석과 같은 계약). 오른쪽 끝도
          그 헤더와 같은 9px에 선다: 바깥 상자가 이미 pr-1(4px)을 물고 있어 5px만 더한다.
          **그 계약이 사는 자리는 둘이다** — 여기와 work 행의 오른쪽 메타(판 05 결정 13의 「두
          자리」). 두 줄 행에서는 work 행이 메타를 둘째 줄로 내려 여기 하나였다가, 행이 한 줄로
          돌아오면서(`sidebar-active-band` 결정 14) 다시 둘이 됐다. 그래서 규격은 `row-meta`
          하나가 들고(오른쪽 여백까지), 셸 수(`ShellMeta`)와 work 행의 신호 갈래(`SignalMeta` — 경과)가 그것을 부른다.
          「같은 x에 오른쪽 끝이 선다」는 두 자리 다 L3가 실측으로 잰다(works-sidebar.spec.ts). */}
      {meta}
    </div>
  );
}

export default Sidebar;
