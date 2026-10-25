import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronsUpDown, LayoutGrid, Settings } from "lucide-react";
import { shallow, useStore } from "@tanstack/react-store";
import { useRouterState } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useRoving, type RovingBox } from "@/lib/roving";
import SidebarThreads, { type ThreadListFilter } from "@/features/thread/SidebarThreads";
import { useWaiting } from "@/features/thread/hooks";
import SidebarWorkList from "@/features/works/SidebarWorkList";
import type { WorkView } from "@/features/works/types";
import { useWorks } from "@/features/works/hooks";
import { useWorkMenuFlows } from "@/features/works/work-menu-actions";
import { WorkContextMenu, type MenuTarget } from "@/features/works/WorkContextMenu";
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
import ProcessesNavMeta, { useProcessesNavMeta } from "@/features/processes/ProcessesNavMeta";
import { SETTINGS_ITEMS, type SettingsItemKey } from "@/features/settings/pages";
import { isBlankNewThread } from "@/routes/-new-thread-search";
import { AttentionBand, type BandItem } from "./attention-band";
import { foldingInnerClass, SIDEBAR_ID, SIDEBAR_MOTION, useFoldedFocus } from "./panel-layout";
import { navItems, TERMINAL_LABEL, type NavKey } from "./nav-items";
import { initialOf, usePersonName } from "./person";
import { ShellMeta } from "./shell-meta";
import { SIDEBAR_ROWS, sidebarRowTone } from "./sidebar-look";
import { LIBRARY_KEY, MINE_KEY, MineRow, NEW_THREAD_KEY, NewThreadRow, SidebarItem } from "./sidebar-item";
import { SignalMeta, showsElapsed, type CallingNote } from "./shell-signal";
import useGoToShell from "./useGoToShell";
import { ResizeHandle, type ResizableWidth } from "./useResizableWidth";

interface SidebarProps {
  open: boolean;
  /** 폭(끌어서 바꾸고 기억한다) — 앱 셸이 쥐고 뿌리에 싣는다(`--sidebar-width` · `--sidebar-min` — 머리 줄의 이름 자리도 같은 값을 읽는다). */
  size: ResizableWidth;
  /** 「새 Thread」(v1 티켓 05) — 앱 셸이 씨앗 없는 `/`로 간다. 켜짐은 그 항목이 스스로 읽는다(`NewThreadItem`). */
  onNewThread: () => void;
  /** 「Library」(v1 티켓 19) — 앱 셸이 지금 선 자리의 Work를 실어 `/library`로 간다. 켜짐은 그 항목이 스스로 읽는다(`LibraryItem`). */
  onOpenLibrary: () => void;
  /** 지금 선 화면이 사람 메뉴의 어느 곳인가 — 그 밖(Thread · Works)이면 `null`이다. */
  activeKey: NavKey | null;
  /** 사람 메뉴에서 고른 곳(v1 구현 스펙 S27 — 지금 main nav 넷이 이리로 왔다). */
  onSelect: (key: NavKey) => void;
  /**
   * 지금 선 설정 항목. **`null`이 아니면 사이드바가 설정 nav를 그린다**(UI개선 결정 21) — 한 값이
   * 「설정 nav인가」와 「어느 항목이 켜졌나」를 함께 답한다. 앱 셸이 원시값 select로 읽어 내린다.
   */
  currentSettingsItem: SettingsItemKey | null;
  // 설정은 사람 메뉴의 끝에 산다 — 목적지 넷과 성질이 달라 구분선 뒤다(결정 51 · v1 구현 스펙 S27)
  onOpenSettings: () => void;
  onPickSettingsItem: (key: SettingsItemKey) => void;
  /** 설정 nav 맨 위 「앱으로 돌아가기」. 어디로 가는지는 앱 셸이 안다(결정 27). */
  onLeaveSettings: () => void;
}

// 좌우 8px로 같다. 한때 오른쪽만 19px(= 거터 8 + 스크롤바 11)이었다 — 가운데 작업 목록이
// 막대 자리를 늘 예약하고 있어서, 같은 값을 비워 둬야 nav 항목과 목록 항목의 오른쪽 끝이
// 맞았다. 막대가 콘텐츠 위로 뜨면서(결정 32) 목록이 그 11px을 돌려받았고, 이 거터도 함께
// 돌아왔다. 둘이 세로로 붙어 있어 어긋나면 그 자리에서 보인다.
// **바닥의 사람 줄도 같은 거터를 쓴다** — 결정 51이 이 정렬 계약의 경계를 하나 늘렸다(그때는 바닥의 설정이었다).
const GUTTER = "pl-2 pr-2";

// nav 목록(앱 갈래의 위 줄 — 새 Thread · 내 차례 · Library, 설정 갈래의 항목) — 사이드바 줄 목록의 리듬(`sidebar-look`)이다. 두 갈래가 한 벌이다.
const NAV = cn(SIDEBAR_ROWS, "shrink-0", GUTTER);

// 사이드바는 캔버스 「Atelier 공간 시안」의 차례다(02 구현 스펙 §4 · F1-Home · Diff-Frame 「제안」 — v1 구현 스펙 §13 · 티켓 07 · 42를 이었다) —
// 위 줄(새 Thread · 내 차례 · Library) · 알림 띠 · Work 묶음 · Thread 묶음 · 맨 아래 사람 줄. 위에 머리(옛 「전체 | 내 차례」 마디)가 없다 —
// Codex 사이드바처럼 조용하다. 지금 화면들(Projects · Terminal · Processes · Archive · Settings)은 사람 메뉴와 ⌘K로 간다(S27).
// **결은 Codex 사이드바다**(v1 티켓 46 · 결정.md 「46」) — 사용자가 준 Codex 그림을 재어 줄 30 · 줄 사이 1 · 글자 14/400 · 소제목 14
// `fg-tertiary` · 고른 줄 `fill-selected`를 맞췄다. 맨 위의 검색 칸은 걷었다 — 검색은 창 위 줄의 돋보기(`ShellControls`)와 ⌘K가 연다.
// 앱의 어느 화면에 있든 이 사이드바는 바뀌지 않고, 설정에서만 설정 nav로 갈아 선다(UI개선 결정 21).
// 목록이 여기 살면서 셸이 작업 데이터를 직접 읽게 됐다 — 순수 프레젠테이션이 아니다.
function Sidebar({
  open,
  size,
  onNewThread,
  onOpenLibrary,
  activeKey,
  onSelect,
  currentSettingsItem,
  onOpenSettings,
  onPickSettingsItem,
  onLeaveSettings,
}: SidebarProps) {
  // **work마다 셸이 몇 개인가만 읽는다**(결정 2·3). 셀렉터가 얕은 비교를 타므로 셸이
  // 열리고 닫힐 때만 이 셸이 다시 그려진다 — 프롬프트마다 오는 OSC 타이틀에는 안 흔들린다.
  // 목록이 스스로 구독하지 않는 이유는 `WorkRowShells`(`WorkSectionList.tsx`) 머리말에 있다.
  // 키가 slug인 것은 목록이 터미널을 모르기 때문이다 — `shellCountsOf` 머리말이 그 사정을 든다.
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
  // **work 우클릭 메뉴의 흐름**(codex-ds 결정 6) — 띠 줄과 목록 행의 메뉴가 함께 쓴다. 셸 수 · 셸 닫기가 그 안에 있어 터미널을 아는
  // 이 자리가 짓고 목록에 내린다(목록은 터미널을 모른다 — `shells`와 같은 길).
  const menu = useWorkMenuFlows();
  // **이름을 그 자리에서 고치는 work**(codex-ds 스펙 §9) — 고치는 자리는 목록의 그 work 행이고, 들어가는 길은 행의 F2 · 우클릭 메뉴와
  // 띠 줄의 우클릭 메뉴다. 띠의 메뉴는 목록 밖이라 띠와 목록을 함께 품은 여기서 쥔다. 띠 줄은 셸 줄이라 이름을 적는 자리가 아니어서,
  // 띠에서 들어가도 목록의 그 행이 고친다(접힌 구획이면 목록이 연다 — `SidebarWorkList`). 고치던 행이 바깥에서 사라져도(MCP 아카이브 ·
  // 지우기) 이 값은 비워진다 — 입력칸이 blur 없이 내려가도 끝을 알린다(`InlineRename`의 `onDone`).
  const [renaming, setRenaming] = useState<string | null>(null);
  // **위 줄 「내 차례」 행이 켠 거르기**(v1 티켓 42 · 02 구현 스펙 §4 · S3) — 펼친 띠처럼 앱이 떠 있는 동안만 기억한다(위 `bandOpen`). 설정에
  // 다녀와도 그대로다. 그 행을 다시 누르거나 위 줄의 다른 행(새 Thread · Library)을 고르면 「전체」로 돌아온다.
  const [threadFilter, setThreadFilter] = useState<ThreadListFilter>("all");
  // **nav 하나가 Tab 정류장 하나다**(roving, codex-ds 스펙 S10 — `@/lib/roving`). 정류장은 켜진 항목, 없으면(Works 화면) 첫 항목이고
  // 목록 안은 ↑↓로 옮긴다. 설정 nav도 같은 규칙이다 — 같은 `SidebarItem`이 같은 자리에 갈아 선다. 둘 다 아래 갈림보다 먼저 부른다.
  // nav에는 위 줄 셋 — 「새 Thread」 · 「내 차례」 · 「Library」가 선다(v1 티켓 07 · 19 · 02 스펙 §4 — 지금 화면들은 사람 메뉴로 갔다).
  const navRoving = useRoving([NEW_THREAD_KEY, MINE_KEY, LIBRARY_KEY], null);
  const settingsRoving = useRoving(
    SETTINGS_ITEMS.map((item) => item.key),
    currentSettingsItem,
  );

  // **설정이면 설정 nav를 그린다**(UI개선 결정 21) — 검색·nav·띠·작업 목록·Thread 묶음·사람 줄이
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
          stop={settingsRoving.stop}
          rovingBox={settingsRoving.box}
          onLeave={onLeaveSettings}
          onPick={onPickSettingsItem}
        />
      </SidebarFrame>
    );
  }

  return (
    <SidebarFrame open={open} size={size}>
      {/* **위 줄이 맨 위다**(02 구현 스펙 §4 · 스토리 9 — 시안 F1-Home · Diff-Frame 「제안」). 거르기 머리(옛 「전체 | 내 차례」 마디 — v1
          티켓 42)를 걷고 「내 차례」가 위 줄의 행이 됐다. 그 행을 켜면 Work 묶음과 Thread 묶음 대신 나를 기다리는 Thread만 기다린 순서로
          선다 — 위 줄 · 알림 띠는 그대로다(셸의 띠와 Thread 목록은 섞지 않는다 — v1 구현 스펙 §17). 켜진 동안은 그 행 하나가 고른 줄이다
          — 「새 Thread」 · 「Library」는 주소가 그쪽이어도 고른 모양을 내려놓는다(위 줄 셋이 「지금 무엇을 보나」 하나를 답한다).

          거터는 GUTTER 하나가 정한다 — 그 정렬 계약이 걸리는 자리는 GUTTER 주석이 든다. 지금 화면들로 가는 줄(옛 main nav 넷)은 사람
          메뉴로 갔다(S27). */}
      <nav className={NAV} {...navRoving.box}>
        <NewThreadItem
          stop={navRoving.stop === NEW_THREAD_KEY}
          yielded={threadFilter === "mine"}
          onClick={() => {
            setThreadFilter("all");
            onNewThread();
          }}
        />
        <MineItem
          stop={navRoving.stop === MINE_KEY}
          on={threadFilter === "mine"}
          onToggle={() => setThreadFilter((filter) => (filter === "mine" ? "all" : "mine"))}
        />
        <LibraryItem
          stop={navRoving.stop === LIBRARY_KEY}
          yielded={threadFilter === "mine"}
          onClick={() => {
            setThreadFilter("all");
            onOpenLibrary();
          }}
        />
      </nav>

      {/* **목록 위, nav 아래**(결정 5). 부르는 셸이 없으면 이 자리에 아무것도 없다 —
          그 가름은 조각 안에 있다(`AttentionBand`의 첫 줄). 거터가 nav·사람 줄과 같은 것은
          그 셋이 한 컬럼에 세로로 붙어 서기 때문이다(GUTTER 주석).

          **목록 밖에 서는 것이 이 띠의 값 절반이다**(스토리 43) — 스크롤로 밀려난 work의
          셸이 불러도 여기서는 보인다. 안에 넣으면 판 04 결정 21이 감수했던 「어디에도 안
          보인다」가 그대로 남는다.

          **이 래퍼는 형제들과 달리 `shrink-0`이 아니라 `min-h-0`이다.** nav도 사람 줄도
          `shrink-0`을 다는데 여기서 따라 달면 낮은 창에서 띠가 자기 높이를 끝까지 우겨
          바닥의 사람 줄이 `aside`의 `overflow-hidden` 밖으로 잘린다. `min-h-0`이
          **명시**여야 하는 것은 자동 최소 크기 때문이다: 안쪽 띠가 스크롤 상자라 자기
          최소는 0이지만, 그 사실이 이 래퍼의 `min-height: auto`까지 눕히지는 않아
          래퍼가 안 줄어든다(실측 — 창 300px에서 그때의 바닥 줄이 16px 잘렸다).

          그래서 낮은 창에서 양보하는 쪽이 「띠가 굴러간다」이고 지키는 쪽이 「목록과
          바닥 줄이 남는다」다(스토리 39). */}
      {/* **띠 줄의 우클릭은 그 work의 메뉴다**(codex-ds 결정 6 · 7) — 띠 하나에 메뉴 하나이고, 난 자리의 줄이 대상이다(`bandTarget`).
          누르면 셸로 가는 줄이지만 우클릭은 아무 데도 안 간다 — 고름도 주소도 그대로다. 「이름 바꾸기」는 아래 목록의 그 work 행을
          고친다(위 `renaming`). */}
      {/* 띠에서 이름 바꾸기를 고르면 「전체」로 돌아간다 — 고치는 자리는 Work 묶음의 그 행이고, 「내 차례」를 켠 동안은 그 묶음이 서지 않는다. */}
      <WorkContextMenu
        flows={menu}
        targetOf={bandTarget}
        onRename={(slug) => {
          setThreadFilter("all");
          setRenaming(slug);
        }}
      >
        {(menuTarget) => (
          <div className={cn("flex min-h-0 flex-col", GUTTER)}>
            <AttentionBand
              items={items}
              now={bandNow}
              expanded={bandOpen}
              onToggle={() => setBandOpen((on) => !on)}
              onOpen={openBand}
              menuTarget={menuTarget}
            />
          </div>
        )}
      </WorkContextMenu>

      {/* **두 묶음은 남는 자리 하나를 나눠 쓴다**(`flex-1` · 바탕 0). 창이 낮으면 이 상자가 먼저 줄어 두 묶음이 구르고, 그래도
          모자랄 때만 띠가 양보한다(위 띠 래퍼 주석 · 스토리 39). 두 묶음이 저마다 제 높이로 서면 넘침이 높이 비율로 갈려 목록이 아직
          자리를 쥔 채 띠 래퍼가 함께 준다 — v1 티켓 07이 이 상자를 걷은 뒤 그렇게 줄어든 래퍼 밖으로 띠가 넘쳐 목록을 덮었다(v1 티켓
          10 — `sidebar-quiet`의 띠 아래 선이 잡았다). 「내 차례」면 Work 묶음이 빠지고 기다리는 Thread 줄들이 이 자리를 쓴다. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {threadFilter === "all" && (
          <SidebarWorkList
            open={open}
            // 셸에서 오는 값 셋은 **한 묶음으로** 내려간다(`WorkRowShells`) — 목록은 그것을 행까지
            // 나를 뿐 터미널을 한 번도 참조하지 않는다. 한때 넷째로 행의 오른쪽 메타(`⌨ N` · 부른 셸의 경과 — `RowMetaFor`)가 함께
            // 내려갔다 — 02 티켓 05가 Work 줄 오른쪽 끝을 상태 표시 하나로 모으며 걷었다(셸 수는 호버 카드로, 경과는 알림 띠에 남는다).
            shells={{ shellCounts, signals, notes }}
            menu={menu}
            renaming={renaming}
            onRename={setRenaming}
            onRenameEnd={() => setRenaming(null)}
          />
        )}

        {/* **Work 묶음 바로 아래 Thread 묶음**(v1 구현 스펙 §13) — Work 없는 Thread들이 제목 한 줄씩 선다(02 티켓 05).
            두 묶음은 제 높이로 서고 넘치면 저마다 구른다 — 남는 자리는 사람 줄 위의 빈 자리다(캔버스 화면 1). */}
        <SidebarThreads filter={threadFilter} />
      </div>

      {/* **바닥 고정의 사람 메뉴**(v1 구현 스펙 S27) — 이름과 지금 화면들(Projects · Terminal · Processes · Archive · Settings). */}
      <PersonMenu
        activeKey={activeKey}
        onSelect={onSelect}
        onOpenSettings={onOpenSettings}
        topShells={topShells}
      />
    </SidebarFrame>
  );
}

/**
 * 사이드바의 겉 상자 — `aside` · 폭이 고정된 안쪽 열 · 폭 손잡이. 두 갈래(앱·설정)가
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
  const box = useFoldedFocus<HTMLElement>(open);
  return (
    // 표식(`data-sidebar`)이 고른 행의 면을 가른다 — 이 안에서는 `selected-row`가 투명한 `fill-nav-selected`(.053)다(index.css의 그
    // 유틸리티 · 02 티켓 05 — Codex 사이드바). 흰 카드 안 목록 · 트리의 고른 행은 그대로 불투명한 `fill-selected`다.
    // 폭 변수(`--sidebar-width` · `--sidebar-min`)는 앱 셸 뿌리가 싣는다 — 머리 줄의 이름 자리가 같은 값으로 사이드바 끝을 따른다.
    <aside ref={box} id={SIDEBAR_ID} data-sidebar="" className={asideClass(open, size.dragging)}>
      {/* fixed inner width so text doesn't reflow while the width animates.

          **선 뒤에는 바깥 폭을 넘지 않는다** — 작업 패널 안쪽 열과 같은 장치다(`panel-layout`의 `foldingInnerClass`).
          사이드바가 탭 줄에 자리를 내줘 좁게 서면 고정 폭 그대로는 행 오른쪽의 셸 수·신호가
          잘린다. 상한은 작업 패널과 같은 `100%`다 — 바깥 상자에 오른쪽 경계선이 없어(ui-refresh 결정 4)
          안쪽 열이 든 폭이 곧 바깥 폭이다. */}
      {/* **접힌 동안 `inert`다** — 폭 0에 가려 안 보이는 nav · 목록이 Tab 정류장으로 남지 않게(오른쪽 패널의 안쪽 열 · 접힌 구획과
          같은 장치). 접힐 때 안에 있던 포커스는 사이드바 토글로 간다(바깥 상자의 `useFoldedFocus`). */}
      <div
        inert={!open}
        // 위 2 · 아래 8 — 사이드바는 판 밖 크롬 위에서 머리 줄 바로 밑부터 창 아래 끝까지 선다(03 구현 스펙 §3 · 시안 v49 `.sb`의 위 2). 「새
        // Thread」가 머리 줄 바로 밑에서 시작해 신호등 줄과 위 줄 사이에 빈 띠가 없다. 한때 위 12였다 — 사이드바가 흰 판 안에 들어 판의
        // 위끝에서 띄운 값이었다(02). 그보다 앞에는 맨 위에 머리 줄과 같은 높이의 빈 끌기 띠가 있었다 — 신호등 · 셸 컨트롤이 그 띠 가운데에
        // 겹쳐 떴고, 그것들은 이제 머리 줄에 선다. 아래 8은 바닥 사람 줄(36)이 창 아래끝에서 떨어지는 값이다(시안 `.sb-foot` — 판 아래 띄움
        // 5 + `.sb` 아래 3).
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col pt-0.5 pb-2",
          foldingInnerClass(open, "sidebar"),
        )}
      >
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
    // 까지만 준다. 탭 줄이 모자랄 때 여기 차례가 온다(`panel-layout`의 `TAB_ROW_COLUMN`) — 탭 줄은 본문 카드의
    // 머리라 작업 패널과 같은 카드 줄에 서고(codex-ds 스펙 §4) 패널이 제 최소 폭까지 먼저 자리를 내주므로, 그 차례는 앱 창의
    // 최소 폭(900) 아래에서만 온다(e2e `tab-row.ts`의 `squeezedWidth`). 탭 줄 말고 자리를 요구하는 것은 편집기 트리 칸의 머리다
    // (`Frame`의 `BesideBox` — 넓혀 둔 사이드바와 좁은 창이면 온다). 머리 줄의 할 일 묶음은 판 밖 크롬의 줄이라 자리를 요구하지 않는다.
    // 다른 화면의 본문도 자리를 요구하지 않는다.
    // 최소 폭을 **펼 때만** 트랜지션하는 이유는 작업 패널 칸(`Frame`의 `PanelBox`) 주석과 같다.
    //
    // **바탕도 오른쪽 선도 없다** — 사이드바는 판 밖 크롬(`surface-shell`) 위에 서서 머리 줄 왼쪽 칸과 한 기둥이다(03 구현 스펙 §3 · 02 결정
    // 「시안 — 사이드바는 크롬 위에」). 경계는 옆 흰 판의 테두리가 말한다. 한때(v1 티켓 46 – 02) 흰 판 안에서 Codex 대화 사이드바의 바탕
    // `surface-sidebar`에 오른쪽 0.5 선(`border-heavy`)을 칠했다 — 머리 줄 왼쪽 칸과 사이드바가 판 테두리로 갈려 길잡이가 두 덩어리로
    // 읽혔다. 대비를 재는 e2e는 처음 만나는 불투명한 바탕(앱 셸 뿌리의 크롬)에서 잰다(하네스 `글자대비`).
    "relative overflow-hidden",
    // 드래그 중엔 폭 트랜지션을 꺼서 커서를 즉각 따라오게 한다.
    // 박자는 Codex 사이드바의 spring(.3s · `ease-spring` — 02 구현 스펙 §12)이다 — 내용은 그대로 둔 채(안쪽 고정 폭) 잘리며 옅어진다.
    // 머리 줄의 왼쪽 칸(`ShellHead`)이 같은 박자로 사이드바 끝을 따른다(`panel-layout`의 `SIDEBAR_MOTION`).
    !dragging && SIDEBAR_MOTION,
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
  stop,
  rovingBox,
  onLeave,
  onPick,
}: {
  current: SettingsItemKey;
  /** 설정 nav의 Tab 정류장 — 고르는 것은 `Sidebar`다(그 컴포넌트가 갈림 앞에서 훅을 다 부른다). */
  stop: string | null;
  rovingBox: RovingBox;
  onLeave: () => void;
  onPick: (key: SettingsItemKey) => void;
}) {
  return (
    <>
      {/* 돌아가기는 목록이 아니라 혼자 선 Tab 정류장이다 — 그 아래 항목들이 목록이다. */}
      <div className={cn("shrink-0 pb-3", GUTTER)}>
        <SidebarItem icon={ArrowLeft} label="앱으로 돌아가기" active={false} onClick={onLeave} />
      </div>
      <nav aria-label="설정" className={NAV} {...rovingBox}>
        {SETTINGS_ITEMS.map((item) => (
          <SidebarItem
            key={item.key}
            icon={item.icon}
            label={item.label}
            active={item.key === current}
            roving={{ key: item.key, stop: item.key === stop }}
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

/**
 * 줄에 화면의 이름을 붙인다. 규칙은 위 하나이고 여기는 그것을 줄마다 부르기만 한다. 그 셸의 work(`slug` — 줄의 우클릭 메뉴가 펴는
 * work)도 함께 붙인다 — 최상위 셸이면 `null`이다.
 */
function bandItems(
  rows: ReadonlyArray<BandRow>,
  resolve: (owner: ShellOwner) => string,
): BandItem[] {
  if (rows.length === 0) return [];
  return rows.map((row) => ({ ...row, title: resolve(row.owner), slug: slugOfOwner(row.owner) }));
}

/**
 * 띠 안 우클릭의 대상 — 그 자리를 품은 work의 셸 줄이다(`BandLine`의 표식). 머리 · ⌄ · 최상위 셸 줄이면 `null`이라 메뉴가 안 선다.
 */
function bandTarget(from: Element): MenuTarget | null {
  const line = from.closest<HTMLElement>("[data-band-work]");
  const slug = line?.dataset.bandWork;
  const id = line?.dataset.bandLine;
  return line && slug && id ? { slug, id, element: line } : null;
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
 * **소유자의 slug가 비어 있으면 최상위, 곧 사람 메뉴의 `Terminal`이다**(결정 10). 한때 work 행과 nav가
 * 이 컴포넌트 **하나**를 함께 썼다 — **02 티켓 05가 work 행에서 걷었다**: Work 줄 오른쪽 끝은 상태 표시 하나의 자리라
 * (`WorkSectionList`의 `workMark` — 셸이 부르면 「내 차례」 알약, 안 본 끝은 새 결과 점), 셸 수는 호버 카드로, 부른 셸의
 * 경과는 알림 띠로 갔다. 그래서 지금 이 자리를 부르는 곳은 사람 메뉴의 `Terminal` 줄 하나다(Sidebar.test.tsx가 센다).
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

// 위 줄의 항목들 — 그림(이름 · 끝 글자 · 누름)은 `sidebar-item.tsx`가 들고(정적 마크업 seam — 이 파일은 렌더로 못 들인다), 여기 항목은 켜짐을
// 무엇이 정하는지(주소 · 거르기 · 기다리는 수)만 읽어 넘긴다. 설정 nav의 항목도 같은 `SidebarItem`이다(같은 자리에 갈아 선다).
//
// 한때 nav `Terminal` · `Processes`가 오른쪽 메타(셸 수 · 메모리)를 이 줄에 이었다. 그 줄들이 사람 메뉴로 가며(v1 구현 스펙 S27) 셸 수는
// 메뉴의 `Terminal` 줄로, Processes 메타는 사람 줄 오른쪽으로 옮겼다가 메뉴의 `Processes` 줄 끝으로 갔다(02 스펙 S12 · `PersonMenu`).

/**
 * 「새 Thread」 항목(v1 티켓 05) — **씨앗 없는 새 Thread**(`/`)에 서 있으면 켜진다. 앱 셸의 가드와 같은 물음이다(`isBlankNewThread`): 켜져
 * 있으면 눌러도 그 자리이고, 씨앗을 단 새 Thread(+로 연 `/?new=work` · 이 Work에서 새 Thread `/?work=<slug>`)에서는 켜지지 않아 누르면
 * 씨앗이 걷힌 첫 화면으로 간다(02 코드 리뷰 S1 — 한때 경로만 봐서 거기서도 켜진 채 눌러도 아무 일이 없었다).
 *
 * **켜짐을 이 항목이 스스로 구독한다**: 셸이 구독하면 라우터 구독이 늘고(`AppShell.test.ts`), 사이드바 몸이 구독하면 Thread를 오갈 때마다
 * 목록 전체가 다시 그려진다. 값이 원시값 하나라 그 자리를 드나들 때만 이 항목이 다시 그려진다. 「내 차례」가 켜진 동안(`yielded`)은 고른
 * 모양을 내려놓는다 — 고른 줄은 위 줄에 하나다. 끝의 ⌘N은 앱 셸의 키와 같은 길로 간다(`AppShell`의 ⌘N — 단축키 표 `newThread`).
 */
function NewThreadItem({ stop, yielded, onClick }: { stop: boolean; yielded: boolean; onClick: () => void }) {
  const here = useRouterState({ select: (state) => isBlankNewThread(state.location) });
  return <NewThreadRow active={here && !yielded} stop={stop} onClick={onClick} />;
}

/**
 * 「내 차례」 항목(02 구현 스펙 §4 · 스토리 12~15) — 끝의 수는 나를 기다리는 Thread 수다(`useWaiting` — 거르기가 세우는 목록과 ⌘J가 읽는 그
 * 차례). **이 항목이 늘 서 있어 그 읽기가 살아 있다** — ⌘J가 누른 순간 읽는 캐시(`waitingNow`)가 이 구독 덕에 따뜻하다(옛 마디가 하던 일).
 */
function MineItem({ stop, on, onToggle }: { stop: boolean; on: boolean; onToggle: () => void }) {
  const count = useWaiting().length;
  return <MineRow count={count} on={on} stop={stop} onToggle={onToggle} />;
}

/**
 * 「Library」 항목(v1 티켓 19) — `/library`에 서 있으면 켜진다. 「새 Thread」와 같은 까닭으로 켜짐을 이 항목이 스스로 구독한다(원시값
 * 하나 — `/library`를 드나들 때만 다시 그려진다). 「내 차례」가 켜진 동안은 고른 모양을 내려놓는다(위와 같다). 글리프는 시안의 네 칸이다
 * (F1-Home · Diff-Frame 「제안」 — 한때 책꽂이 `Library`였다).
 */
function LibraryItem({ stop, yielded, onClick }: { stop: boolean; yielded: boolean; onClick: () => void }) {
  const here = useRouterState({ select: (state) => state.location.pathname === "/library" });
  return (
    <SidebarItem icon={LayoutGrid} label="Library" active={here && !yielded} roving={{ key: LIBRARY_KEY, stop }} onClick={onClick} />
  );
}

// 사람 메뉴의 줄 — Components 보드 「사람 메뉴」(02 구현 스펙 §5 · 스토리 35 — 사이드바 줄과 같은 결): 30 · 둥글기 8 · 14px · 줄 글자색
// `fg-sidebar`, 켜진 줄(포인터 · 키보드)은 사이드바 · 사람 메뉴의 고른 면 `fill-nav-selected`(.053)에 글자 `fg`다(시안 `.mi` · `.mi.on`).
// 높이 · 좌우 8은 메뉴 줄 한 벌(`menu-row`)을 그대로 두고 나머지를 덮는다 — 덮는 코어 유틸리티는 `menu-row` 뒤에 선다(dropdown-menu.tsx
// `ITEM_SIZE` 주석). 앱의 다른 메뉴(⋯ · 우클릭)는 그대로다 — 이 메뉴만 사이드바에서 열리는 사이드바의 일부다.
const PERSON_ROW = "gap-2 rounded-md text-sm text-fg-sidebar focus:bg-fill-nav-selected focus:text-fg";
// 줄 글리프 — 16 · `fg-icon`(시안 `.mi .ico` #5d5f61). 크기와 색을 그림에 바로 건다 — `menu-row`의 15 · `fg-secondary`를 이긴다(index.css).
const PERSON_GLYPH = "size-4 text-fg-icon";

/**
 * 사람 메뉴(v1 구현 스펙 S27 · 02 구현 스펙 §4 · §5) — 사이드바 맨 아래 **사람 줄**과 그것이 여는 메뉴. 줄은 얼굴 · 이름 · 위아래 꺾쇠뿐이고
 * (스토리 31 — 시안 F1-Home `.sb-foot`), 누르면 지금 화면들로 가는 메뉴가 위로 뜬다: `navItems`의 넷(옛 main nav)과, 구분선 뒤에 설정.
 * ⌘K의 행선지는 그대로다(`destinations.ts`가 같은 배열을 읽는다). Space 항목은 없다(02 경계 — Projects를 둔다).
 *
 * - **줄 위에 선이 없다**(02 스펙 §4) — 한때 윗변에 0.5 선이 섰다(UI개선 결정 25). Codex 사이드바 바닥에는 선이 없다. 표식
 *   (`data-sidebar-foot`)은 검사가 이 칸을 집는다.
 * - **Processes 메타는 메뉴의 `Processes` 줄 끝이다**(02 스펙 S12 · 스토리 32) — 한때 사람 줄 오른쪽에 늘 섰다(프로세스 결정 11). 요약
 *   폴러와 「봤다」 앉히기는 **이 줄의 몸에서 돈다**(`useProcessesNavMeta`) — 줄은 늘 서고 메뉴는 열 때만 그려져, 메뉴 안에서 세면 닫힌 동안
 *   아무도 묻지 않는다(02 결정 「04 · 메모리 합계 폴러」). 메뉴의 줄은 받은 값을 그리기만 한다.
 * - 최상위 셸의 수는 메뉴의 `Terminal` 줄이 든다(옛 nav 줄의 메타 — 결정 13).
 * - 지금 선 화면의 줄은 `aria-current`로 말한다 — 메뉴의 켜짐(`fill-nav-selected`)은 포인터 · 키보드가 가리키는 줄의 것이라 겹치지 않게 면을
 *   칠하지 않는다.
 */
function PersonMenu({
  activeKey,
  onSelect,
  onOpenSettings,
  topShells,
}: {
  activeKey: NavKey | null;
  onSelect: (key: NavKey) => void;
  onOpenSettings: () => void;
  topShells: number;
}) {
  const name = usePersonName();
  const processes = useProcessesNavMeta();
  return (
    <div data-sidebar-foot="" className={cn("mt-auto flex shrink-0 items-center", GUTTER)}>
      <DropdownMenu>
        {/* 시안의 사람 줄(F1-Home `.sb-foot` · Components 「바닥 사람 줄」) — 36 · 둥글기 10 · 안쪽 왼 8 · 오른 4, 얼굴 24 · 사이 8 · 이름 14
            `fg-sidebar` · 오른쪽 끝 위아래 꺾쇠 14 `fg-faint`(꺾쇠 뒤 6). 줄은 nav 줄과 같은 거터라 얼굴이 창 끝 + 16에 선다(DS 「행 글자
            16」). hover와 메뉴가 열린 동안은 사이드바 · 사람 메뉴의 고른 면이다(Codex — hover와 고른 면이 같은 .053, 시안 `.sb-foot.on`). */}
        <DropdownMenuTrigger
          aria-label={`${name} — 사람 메뉴`}
          className={cn(
            "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg pr-1 pl-2 text-left text-sm transition-colors focus-ring",
            // 쉬는 글자 · 지나는 면은 사이드바 줄 한 벌이다(`sidebar-look` — 02 코드 리뷰 S2). 메뉴가 열린 동안도 그 면이다.
            sidebarRowTone(false),
            "data-popup-open:bg-fill-nav-selected",
          )}
        >
          {/* 얼굴은 글자다(캔버스 「사람은 글자」) — 24 · 짙은 면 `face-person`에 흰 글자(시안 `.ava`). 글자는 12다(시안 11 — 글자 단계에
              11이 없다). */}
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-face-person text-xs text-fg-on-solid"
          >
            {initialOf(name)}
          </span>
          <span className="min-w-0 truncate">{name}</span>
          <ChevronsUpDown aria-hidden className="mr-1.5 ml-auto size-3.5 shrink-0 text-fg-faint" />
        </DropdownMenuTrigger>
        {/* 시안의 사람 메뉴(Components 「사람 메뉴」) — 흰 면 · 둥글기 12(superellipse 15 — 시안 `.r-xl`) · 그림자 `shadow-menu`(0.5 링이 첫
            겹에 든다) · 안쪽 4 · 줄 사이 1(사이드바 줄 리듬 `SIDEBAR_ROWS`). 폭은 사람 줄과 같고(시안이 바닥 줄과 같은 폭으로 그렸다) 줄 위 6에
            선다. 열고 닫을 때 움직이지 않는다 — 메뉴 부품 한 벌이 곧바로 서고 걷힌다(02 스펙 §12 · 티켓 12). */}
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={6}
          className={cn(SIDEBAR_ROWS, "w-(--anchor-width) rounded-summary corner-superellipse p-1 shadow-menu")}
        >
          {navItems.map((item) => (
            <DropdownMenuItem
              key={item.key}
              aria-current={item.key === activeKey ? "page" : undefined}
              onClick={() => onSelect(item.key)}
              className={PERSON_ROW}
            >
              <item.icon aria-hidden className={PERSON_GLYPH} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {/* 끝 글자는 줄 안쪽 8에 선다(시안 `.mi .end`) — 메타 한 벌(`row-meta`)의 오른쪽 여백 4를 이 자리에서 되돌려, 아래 설정의 ⌘,와
                  같은 세로줄에 끝이 선다. */}
              <span className="-mr-1 flex shrink-0">
                {item.key === "terminal" && <RowMetaFor owner={ownerOf()} shellCount={topShells} />}
                {item.key === "processes" && <ProcessesNavMeta meta={processes} />}
              </span>
            </DropdownMenuItem>
          ))}
          {/* 구분선 — .5 `separator` · 위아래 4 · 좌우 6(시안 `.msep`). */}
          <DropdownMenuSeparator className="mx-1.5 bg-separator" />
          {/* 설정은 목적지 넷과 성질이 다르다(결정 51) — 구분선 뒤 끝에 서고, 키(⌘,)를 단다. */}
          <DropdownMenuItem shortcut="settings" onClick={onOpenSettings} className={PERSON_ROW}>
            <Settings aria-hidden className={PERSON_GLYPH} />
            <span className="min-w-0 flex-1 truncate">Settings</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default Sidebar;
