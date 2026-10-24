import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useMutationState } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { ChevronDown, Columns2, MessageSquare, MoreHorizontal, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import useResizableWidth from "@/components/shell/useResizableWidth";
import { copyText } from "@/components/shell/copy-text";
import { Card, Frame, type HeadSlot, type SplitColumn, type SplitSlot } from "@/components/shell/Frame";
import { togglesPanel } from "@/components/shell/PanelToggle";
import { pickRail, type RailMark } from "@/components/shell/Rail";
import { PathBar, type PathView } from "@/components/shell/PathBar";
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, TAB_ROW_CARD, WORK_PANEL_WIDTH } from "@/components/shell/panel-layout";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { Spinner } from "@/components/ui/spinner";
import { Toaster, showToast } from "@/components/ui/toast";
import { Toggle } from "@/components/ui/toggle";
import { Hint } from "@/components/ui/tooltip";
import { useProjects } from "@/features/projects/hooks";
import { changeMarksStore, markOpened, marksOf } from "@/features/chat/changes";
import ChatPane from "@/features/chat/ChatPane";
import { setQuote } from "@/features/chat/chat-store";
import { useWorkChatSignal, type WorkChatSignal } from "@/features/chat/status";
import type { Quote } from "@/features/chat/types";
import ShellTabs from "@/features/terminal/ShellTabs";
import TerminalPane from "@/features/terminal/TerminalPane";
import {
  activeIdOf,
  activeShellOf,
  activeTabOf,
  bundleOf,
  bundleTabOf,
  closesShellFromWindow,
  opensShellFromWindow,
  ownerOf,
  sameScreen,
  shellForNav,
  shellNavFromWindow,
  shellsEmptied,
  placeOrigin,
  workDefaultOrigin,
  workShellProjects,
} from "@/features/terminal/shell-registry";
import {
  closeCodeTab,
  closeOtherShells,
  dropShellOnSlot,
  onNewShellRequested,
  onShellOpenRejected,
  openNewShell,
  renameShell,
  requestCloseShell,
  selectShell,
  selectShellWithFocus,
  showCodeTab,
  showShellTab,
  terminalStore,
} from "@/features/terminal/terminal-store";
import { codeRefOf, codeTargetOf } from "@/routes/-work-search";
import type { ColumnTab, SplitSide, ViewTab } from "@/routes/-work-search";
import { armDrag, clearHalf, dragStore, hoverHalf, hoverSlot, tabDragOf } from "@/lib/pointer-drag";
import type { DragSource, SplitHalf } from "@/lib/pointer-drag";
import { columnOf, dropSplit, otherTab } from "./split-view";
import { ignoresViewSwitch } from "./doc-refs";
import { requestReveal } from "./doc-reveal";
import { cwdRef, specDirRef, specRef, worktreeDirRef } from "./refs";
import SpecViewer from "./SpecViewer";
import WorkPanel, { PANEL_VIEWS, type PanelView } from "./WorkPanel";
import { WorkContextMenu } from "./WorkContextMenu";
import { StatusRadioItems, WorkMenuItems, type WorkMenuFlows } from "./WorkMenuItems";
import { WORK_LIFECYCLE_KEY, useSetWorkStatus, useSetWorkTitle, useWorks } from "./hooks";
import { STATUS_BADGE, STATUS_META } from "./status";
import { WORKS_COPY } from "./work-sections";
import { openWorkFolder, useWorkMenuFlows } from "./work-menu-actions";
import type { BundleTab, CodeTarget, ShellOwner, ShellsState, ShellTally } from "@/features/terminal/shell-registry";
import type { WorkView } from "./types";

// 코드 보기는 따로 떼어 받는다(git-integration 결정 35) — 강조 라이브러리(`@pierre/diffs`)가 첫 로드에 붙지 않고 파일 탭이
// 처음 설 때 온다. 정적으로 부르면 그 약속이 조용히 깨진다(`code-view-chunk.test.ts`가 프로덕션 빌드로 잰다).
const CodeView = lazy(() => import("@/features/code/CodeView"));

interface WorksPageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  // 보고 있는 문서와 그것을 옮기는 길. 둘 다 주소가 정본이라 여기서 소유하지 않는다.
  // `push`는 히스토리 항목을 만들지 여부다 — 트리는 만들지 않고 문서 링크는 만든다.
  currentFile: string | null;
  onSelectFile: (path: string, push: boolean) => void;
  // 보고 있는 화면 탭도 주소가 정본이다 — `currentFile`과 같은 결이다.
  tab: ViewTab;
  onSelectTab: (tab: ViewTab) => void;
  // 본문이나 분할의 묶음 열에 선 **파일 탭**(`<프로젝트>/<경로>`) — 단일 뷰면 `tab`이 `code`일 때만, 분할이면 묶음 열이 파일
  // 탭일 때 찬다(git-integration S12 · 티켓 07). 이것도 주소가 정본이다: 묶음(메모리)은 이 값을 따라 그 탭을 열고 켠다.
  // `onOpenCode`가 「파일 탭 열기」다 — 트리는 replace, 링크는 push다.
  code: string | null;
  onOpenCode: (project: string, path: string, push: boolean) => void;
  // 분할도 주소가 정본이다(결정 97). `null`이면 단일 뷰다.
  //
  // **바꾸는 콜백이 열을 함께 받는다**: 열의 `×`는 분할을 끄면서 남는 쪽을 정하고
  // (결정 89), 헤더 토글은 지금 열을 그대로 넘긴다. 둘을 따로 옮기면 한 틱에 겹친다. 묶음 열에 설 파일 탭(`bundle`)도
  // 함께다 — 그것은 묶음(메모리)만 안다(git-integration 티켓 07).
  split: SplitSide | null;
  onSelectSplit: (split: SplitSide | null, column: ColumnTab, bundle: string | null) => void;
  // 묶음의 지금 탭이 묶음 쪽에서 바뀌었다(닫기의 이웃 · 셸의 끝 · 끌어 놓기) — 본문이나 묶음 열이 그 탭을 따라가게 주소를
  // 고친다. `bundle`은 그 탭이 파일 탭이면 `<프로젝트>/<경로>`, 셸이면 `null`이다.
  onFollowBundle: (bundle: string | null) => void;
  // 사이드바에서 끌어다 놓은 것(결정 86). **남의 work을 떨궈도 성립해야 해서**(결정 101)
  // 이동을 여기서 하지 않고 주소를 쥔 쪽으로 넘긴다. `bundle`은 묶음 열에 설 파일 탭이다(위 `onSelectSplit`).
  onDropInto: (source: DragSource, split: SplitSide, bundle: string | null) => void;
}

/** 레일 `spec` 점의 뜻(three-axes 티켓 26) — 칸의 설명으로 남는다. 트리 행의 점은 `SpecTree`의 `UNSEEN_CHANGE`가 말한다. */
const UNSEEN_IN_SPEC: RailMark = { label: "고쳐졌는데 아직 열지 않은 파일이 있어요", tone: "new" };
/**
 * 레일 `chat`의 점(three-axes 티켓 23 · 결정 10) — 그 work의 어느 대화가 나를 기다리거나 끝났고, 대화창이 지금 보이지 않을 때 선다.
 * 기다림이 이긴다(`useWorkChatSignal`).
 */
const CHAT_RAIL_MARKS: Readonly<Record<WorkChatSignal, RailMark>> = {
  waiting: { label: "나를 기다리는 대화가 있어요", tone: "wait" },
  done: { label: "끝났는데 아직 보지 않은 대화가 있어요", tone: "done" },
};

/**
 * ⌘W가 겨누는 칸 — **켜진 탭**이다(결정 13). 닫을 것이 없으면 `null`이다.
 *
 * 「켜진 탭이 무엇인가」는 이 화면만 안다. 두 갈래로 `null`이 나온다:
 * - **`spec`이 켜져 있다.** 고정 탭이라 `×`가 없는 것과 같은 말이다. 분할이면 열 둘이
 *   함께 서지만 `tab`은 그때 **포커스가 든 열**을 가리키므로(결정 97의 `focusColumn`)
 *   여기서 한 번 더 가를 것이 없다.
 * - **겨눌 칸이 없다.** 고른 작업이 없거나, 그 화면의 셸이 0개인 경우다. 묶음의 지금 탭이 파일 탭으로 남은 것도 같다
 *   (git-integration 판 01 — 주소가 셸을 말하는데 묶음에 켤 셸이 없다: 본문은 「아직 셸이 없어요」다). 그 칸을 셸을 닫는 길에
 *   넘기지 않는다 — 겨누는 것은 **켜진 셸**이다(`activeShellOf`).
 *
 * `activeShellOf`를 그냥 부르지 않고 이 함수를 두는 것은 **「고른 작업이 없다」를 여기서 한 번
 * 가르기** 위해서다. 앞 판에는 `owner`가 `null`이면 그 값이 최상위 터미널을 가리켜 고른
 * 작업이 없는 work 화면의 ⌘W가 **`/terminal`의 셸을 닫았다.** 지금은 소유자가 늘 문자열이라
 * (`ShellOwner`) 그 사고를 L0가 먼저 막지만, 이 가드가 사라질 이유는 아니다 — 여전히 이
 * 화면에는 「셸이 설 자리가 없는 상태」가 있고, 그것을 「닫을 것이 없다」로 옮기는 자리가
 * 여기 하나다.
 *
 * **함수로 꺼낸 이유는 테스트다**(⌘Enter의 `togglesPanel`과 같다). 이 저장소의 컴포넌트
 * seam은 정적 마크업이라 이펙트가 돌지 않고 키 이벤트도 없다 — 핸들러 안에 두면 소스를
 * 문자열로 훑는 검사밖에 못 걸고, 그 검사는 가드 한 줄이 뒤집혀도 초록이다(실측으로
 * 확인했다: 핸들러 첫 줄에 `return`을 얹어도 리터럴 검사가 전부 통과했다).
 */
export function shellClosedByTab(
  tab: ViewTab,
  owner: ShellOwner | null,
  state: ShellsState,
): number | null {
  if (tab !== "terminal" || owner === null) return null;
  return activeShellOf(state, owner)?.id ?? null;
}

/**
 * ⌘W가 겨누는 **파일 탭** — 본문이 파일 탭이면 그 칸이다(git-integration 스토리 50). 아니면 `null`이다.
 *
 * 위 `shellClosedByTab`과 **따로 둔다** — 닫는 길이 다르다: 파일 탭은 확인 없이 닫고(`closeCodeTab`), 셸은 확인 창을 거치는
 * 하나다(`requestCloseShell`). 한 함수가 둘을 돌려주면 받는 쪽이 종류를 다시 갈라야 하고, 그 갈림이 틀리면 셸이 확인 없이 닫힌다.
 */
export function codeTabClosedByTab(
  tab: ViewTab,
  owner: ShellOwner | null,
  state: ShellsState,
): number | null {
  if (tab !== "code" || owner === null) return null;
  const active = activeTabOf(state, owner);
  return active?.kind === "code" ? active.id : null;
}

/** 묶음의 지금 탭을 한 글자로 — 화면이 「지금 탭이 바뀌었나」를 값으로 견주는 자리(`WorksPage`의 주소 따라가기)가 쓴다. */
function shownTabKey(tab: BundleTab | null): string | null {
  if (tab === null) return null;
  return tab.kind === "code" ? codeRefOf(tab) : SHELL_SHOWN;
}

/**
 * 그 화면 묶음 열에 설 **파일 탭**(`<프로젝트>/<경로>`) — 묶음의 지금 탭이 파일 탭이면 그것이고, 셸이거나 칸이 없으면 `null`이다
 * (git-integration 결정 32 — 묶음 열에는 묶음의 지금 탭이 선다). 분할을 켜거나 칸을 끌어 놓는 순간에 읽는다: 문서를 보는 중에도
 * 묶음의 지금 탭은 기억으로 남아 있어, 분할을 켜면 그 탭이 옆 열에 선다.
 */
function bundleRefOf(state: ShellsState, owner: ShellOwner | null): string | null {
  const active = owner === null ? null : activeTabOf(state, owner);
  return active?.kind === "code" ? codeRefOf(active) : null;
}

/** 지금 탭이 셸이다 — 어느 셸인지는 주소에 없으므로(결정 33) 한 값으로 접는다. `<프로젝트>/<경로>`와 겹칠 수 없는 글자다. */
const SHELL_SHOWN = "shell:";

function WorksPage({
  sidebarOpen,
  selectedSlug,
  currentFile,
  onSelectFile,
  tab,
  onSelectTab,
  code,
  onOpenCode,
  split,
  onSelectSplit,
  onFollowBundle,
  onDropInto,
}: WorksPageProps) {
  const { data: works = [] } = useWorks();
  // 앱을 처음 켠 사람이 가장 먼저 보는 화면이 여기다. 프로젝트가 하나도 없으면
  // "새 작업을 시켜라"는 안내를 그대로 따라 해도 실패한다 — 그때는 등록으로 유도한다.
  //
  // isPending을 함께 보는 이유: 이 화면이 앱의 첫 화면이 되면서 프로젝트 목록을 처음 읽는
  // 자리도 여기가 됐다. 길이만 보면 "아직 안 왔다"를 "하나도 없다"로 읽어, 이미 등록해 둔
  // 사람에게 매 실행마다 등록하라는 안내가 한 프레임 스친다.
  const { data: projects = [], isPending: projectsPending } = useProjects();
  const needsProject = !projectsPending && works.length === 0 && projects.length === 0;
  // 아무것도 안 골랐을 때 본문이 하는 말(US 22) — 사이드바의 빈 구획과 한 표에서 나온다(`work-sections.ts`).
  const emptyScreen = WORKS_COPY.screen;

  // work 메뉴의 흐름 — 머리 카드의 ⋯와 이름의 우클릭 메뉴가 함께 쓴다(`work-menu-actions.ts`).
  const menuFlows = useWorkMenuFlows();
  // **머리 카드 이름을 고치는 중인 work**(codex-ds 스펙 §9) — 들어가는 길이 셋이라(이름의 두 번 클릭 · F2, ⋯와 이름 우클릭 메뉴의
  // 「이름 바꾸기」) 그 셋을 다 가진 이 화면이 쥔다. 값이 slug인 것은 고른 work가 바뀌면 그 그림에서 곧바로 꺼지게 하려는 것이다
  // (`editing`이 `selected.slug`와 견준다) — 다른 work의 이름 자리에 고치던 입력칸이 남지 않는다. 키로 옮겨(⌘J) 입력칸이 blur 없이
  // 내려가도 입력칸이 마지막 그림의 값(고치던 work)으로 저장하고 끝을 알려 이 값을 비운다(`InlineRename`).
  const [renamingHead, setRenamingHead] = useState<string | null>(null);
  const setTitle = useSetWorkTitle();
  // 작업 패널 접기 — 머리 줄의 패널 토글 · ⌘Enter가 이 값 하나를 뒤집는다(ui-refresh 결정 9). 레일이 서면(칸이 둘 이상 — codex-ds
  // 결정 25) 켜진 레일 칸을 다시 눌러도 닫힌다. 한때 흩어져 있던 둘(창 맨 위 줄의 여는 버튼과 패널 머리의 닫는 `×`)이 그 토글 하나로
  // 합쳐졌다.
  //
  // **초기값이 분할 여부를 본다**(결정 88). `?split=lr`로 새로 뜨거나 새로고침하면 아래
  // 「켜는 순간」이 한 번도 안 도는데, 그 화면이 3열이면 결정 88이 계산한 「터미널 ≈34칸에서
  // `claude` TUI가 깨진다」가 그대로 재현된다.
  const [workPanelOpen, setWorkPanelOpen] = useState(split === null);
  // 레일에서 고른 칸(`spec` · `chat` · `files`) — 열림 옆에 산다(ui-refresh 판 04). 레일이 패널 **밖**에 서서(ui-refresh 결정 10) 고르는
  // 자리와 그리는 자리가 갈렸고, 둘을 함께 아는 것이 이 화면이라 WorkPanel에서 올라왔다. 저장하지 않는다 — 열림도 저장하지
  // 않는다. info 칸은 걷었다(codex-ds 결정 25).
  //
  // **작업을 옮겨도 유지된다**(결정 49). 한때 「작업을 옮기면 spec으로 돌아온다」(앞 판 결정 4)가 공짜로 따라왔다 — 패널이
  // key={slug}가 걸린 SpecViewer 아래에 key 없이 놓여 함께 다시 세워졌기 때문이다. 그것은 코드가 아니라 **구조에서 나온
  // 성질**이었고 되살리지 않는다. 이 화면은 작업을 옮겨도 같은 인스턴스라 이 값도 그대로 따라온다. 패널 접기는 언마운트가
  // 아니라 폭 트랜지션이라 접었다 펴도, 본문 왕복(spec ↔ terminal)에도 유지된다.
  const [panelView, setPanelView] = useState<PanelView>("spec");
  // 작업 패널 카드의 폭. 칸(바깥 상자 · 틈 · 손잡이 · 접힘)은 공용 틀이 그리고 폭은 여기서 건넨다(ui-refresh 결정 27 — 목록 칸과
  // 같은 나눔). 화면 오른쪽에 놓인 패널이라 손잡이가 왼쪽 틈에 서고 왼쪽으로 끌면 넓어진다. 저장 키는 이 패널 전용이다: 목록
  // 칸과 같은 키를 쓰면 폭 범위가 다른 둘이 서로를 덮는다. 저장하는 폭은 **카드의 폭**이다(틈은 더하지 않는다).
  //
  // 기본 폭은 `WORK_PANEL_WIDTH`(340 — DS `size-panel`)다 — 그 수가 왜 그 값인지는 그쪽 머리말에 있다(spec 레이아웃 편집기의 트리
  // 카드가 같은 수를 읽는다). 범위(`PANEL_MIN_WIDTH` · `PANEL_MAX_WIDTH`)는 spec 목록 패널과 한 벌이고 지금 것 그대로라(codex-ds
  // 스펙 S4) 범위 안에 저장된 폭은 그대로 선다.
  const panelSize = useResizableWidth("work-panel-width", WORK_PANEL_WIDTH, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH, "right");

  // Cmd+Enter — 본문을 넓히는 토글. 원래 의미가 "콘텐츠 확대·축소"였고 대상이 목록 패널이었던 건
  // 그게 유일한 접이식이었기 때문이다. 이 화면에서 그 자리를 작업 패널이 물려받는다.
  //
  // **두 탭 모두에서 듣는다**(결정 43). 한때 여기 있던 터미널 탭 가드 한 줄 — 탭만 보고
  // 그냥 돌아가던 것 — 을 지웠다. 어느 경우가 셸 몫인지는 `togglesPanel`이 혼자 알고(패널 토글 곁 — Archive의 ⌘Enter와
  // 한 벌이다), 그 판단은 탭이 아니라 **포커스**로 갈린다. `tab`을 안 보므로 의존성도 비었다.
  //
  // (그 줄의 글자를 여기 옮겨 적지 않는다 — 되살아났는지 보는 검사가 주석까지 읽는다.)
  //
  // **뒤집는 몸은 레일의 패널 토글과 같은 함수다**(`togglePanel` — 아래). 대화창이 가운데에 선 동안(three-axes S22) 「뒤집기」가
  // 열림 하나로 끝나지 않아서 그 판단이 그 함수 하나에 산다. 이 이펙트는 그것을 그때의 것으로 부른다(참조) — 의존성은 비어 있다.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!togglesPanel(e)) return;
      e.preventDefault();
      togglePanelRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 끌고 있는 것. **드래그 중에만 값이 있다** — 그동안만 이 화면이 다시 그려진다.
  const drag = useStore(dragStore, (state) => state);

  // 소스 보기의 주인이 **여기다.** 버튼(보기 묶음)은 문서 위 경로 줄에 있고(ui-refresh 판 04 — 한때 패널 머리행에 있었다) 그것이
  // 바꾸는 것은 카드의 몸(SpecViewer)이라, 경로 줄을 세우는 이 화면이 함께 든다(결정 6·22).
  // 한때 SpecViewer의 지역 상태였고 그 컴포넌트의 `key={slug}` 덕에 "작업을 옮기면 예쁜
  // 보기로 돌아온다"가 공짜로 따라왔는데, 그 공짜는 결정 49가 고른 패널 칸에서 걷어낸 것과
  // **같은 종류의 것**이라 여기서도 되살리지 않는다. 사람이 켠 값은 작업을 옮겨도 그대로다.
  const [showSource, setShowSource] = useState(false);

  // 복사 확인 토스트는 **이 화면이 낸다**(결정 47). 앞 판에서는 SpecViewer의 지역 상태라
  // **터미널 탭에서 트리를 복사하면 아무 말이 없었다** — 그 탭에는 SpecViewer가 없다.
  // 토스트의 상태는 이제 부품(Base UI Toast)이 들고(결정 11), 여기서는 `showToast`를 부르기만 한다.
  //
  // **두 가지 말이 한 표면을 쓴다**(결정 47). 복사는 한 일을 알리고(✓) 상한 거절은 **못 한
  // 일**을 알린다(`rejected`) — 「셸은 8개까지예요」 옆에 초록 체크가 서면 그 문장이 「됐어요」로
  // 읽힌다.
  //
  // **상한 8에서 ⌘T가 조용하던 구멍을 메운다**(결정 47). 그 키는 xterm의 키 핸들러에서
  // 오는데 그것은 React 트리 밖이라, 스토어가 낸 거절을 여기서 받아 같은 표면에 붙인다.
  // 문장은 스토어가 짓는다 — 잠긴 `+` 행과 **같은 문장**이어야 해서다. 구독은 마운트 뒤에
  // 걸리므로 앱 루트의 토스트 Provider가 이미 듣고 있다.
  //
  // 이 구독이 이 화면에만 있는 것도 결정 47이다: 최상위 터미널(`/terminal`)에는 이 화면이
  // 없어 ⌘T가 계속 조용하고, 거기서는 `+`의 툴팁과 설명(`aria-description`)이 이유를 말한다. 앱 전역 토스트 표면을
  // 새로 짓는 안은 기각됐다. 그 뒤 프로세스 스펙 P2가 앱 셸에 제 토스트 자리를 세웠지만(`AppToasts`) 이 거절은 그리로
  // 옮기지 않았다 — 이 화면의 토스트는 이 화면의 자리(`Toaster`)에 선다.
  useEffect(() => onShellOpenRejected((notice) => showToast(notice, "rejected")), []);

  // 복사는 모듈 함수 `copyText`다(`copy-text.ts` — Archive · 프로젝트와 한 길) — 참조가 늘 같아 이 화면이 다시 그려질 때 마크다운
  // 트리가 리마운트(깜빡임)되지 않는다.

  // 트리 훑기는 히스토리를 만들지 않고, 문서 링크는 만든다 — 따라 들어갔으면 돌아올 수
  // 있어야 한다. 두 갈래가 이 화면에서 갈리는 것은 트리(패널)와 링크(본문)가 이제 형제라서다.
  const selectFromTree = useCallback((path: string) => onSelectFile(path, false), [onSelectFile]);
  const followLink = useCallback((path: string) => onSelectFile(path, true), [onSelectFile]);

  // 첫 항목으로 조용히 떨어지지 않는다 — 무선택은 주소 쪽에서 정규화한다 (routes/works.index.tsx).
  // 「기억한 것 → 목록 첫 줄」 규칙도 그쪽 pickSlug가 들고 있다.
  const selected = works.find((w) => w.slug === selectedSlug) ?? null;

  // **도는 아카이브 · 삭제를 캐시에서 읽는다** — 진행 표시가 메뉴 하나가 아니라 카드 줄 전체를 덮기 때문이다(`LifecycleOverlay`).
  // 그 조작을 부르는 메뉴는 넷이라(⋯ · 사이드바 행 · 띠 줄 · 머리 카드 이름 — codex-ds 결정 6) 어느 하나가 상태를 쥘 수 없고, 뮤테이션
  // 열쇠(`WORK_LIFECYCLE_KEY`)가 그 넷을 한 캐시에서 묶는다. **덮는 것은 이 화면이 보여 주는 work의 조작일 때다** — 사이드바에서 다른
  // work을 아카이브하는 동안 이 work의 본문을 덮으면 엉뚱한 것을 「정리하고 있어요」라 말한다. 그 사이 모든 work 메뉴가 닫혀 있는
  // 것은 흐름의 바쁨이 한다(`useWorkMenuFlows`의 `busy`).
  const lifecycle = useMutationState({
    filters: { mutationKey: WORK_LIFECYCLE_KEY, status: "pending" },
    select: (mutation) => ({ kind: mutation.options.mutationKey?.[1], slug: mutation.state.variables }),
  });
  const shownLifecycle = selected ? lifecycle.find((m) => m.slug === selected.slug) : undefined;
  const running = !shownLifecycle
    ? null
    : shownLifecycle.kind === "remove"
      ? { verb: "삭제", detail: "워크트리와 스펙 문서를 지우고 있어요" }
      : { verb: "아카이빙", detail: "워크트리를 정리하고 있어요" };

  // **마지막으로 고른 작업을 붙들고 있는다.** 목록이 한 프레임이라도 이 작업을 잃으면
  // (조회가 흔들리거나 갱신 사이에 낀 렌더) 아래 터미널 가지가 통째로 언마운트되고, 다시
  // 마운트될 때 진입 이펙트가 「없으면 하나 띄운다」를 또 돈다 — `×`로 비워 둔 줄에 셸이
  // 저절로 돌아와, 판 02가 못박은 「마지막 칸을 닫으면 새 셸이 저절로 뜨지 않는다」가 깨진다
  // (실물에서 한 번 봤고 재현은 못 했다. 경로는 코드에서 읽힌다).
  //
  // 진짜로 사라진 경우에 붙들려 있지 않다: 그때는 주소 정규화가 다른 작업으로 옮기고
  // `tab`은 따라오지 않으므로 이 가지가 곧 닫힌다. spec 가지는 붙들지 않는다 — 거기서는
  // 다시 마운트돼도 문서를 다시 읽을 뿐 프로세스가 생기지 않는다.
  const lastSelected = useRef(selected);
  if (selected) lastSelected.current = selected;
  // **분할이면 열 둘이 선다**(결정 87) — 문서와 묶음 열이다. 단일 뷰에서만 `tab`이 하나를 고른다. 이 값들이
  // 아래에서 「어느 본문을 그리나」와 「`</>`가 적용될 곳이 있나」를 함께 정한다.
  //
  // **파일 탭**은 본문에 서거나(git-integration 티켓 04) 분할의 **묶음 열**에 선다(티켓 07 · 결정 32 — 묶음 열에는 묶음의 지금
  // 탭이 선다). 그때 터미널 카드는 spec으로 갈 때와 같이 내려간다 — 셸 프로세스와 화면 버퍼는 스토어에 산다(결정 20 · 21).
  const codeTarget = code !== null && (tab === "code" || split !== null) ? codeTargetOf(code) : null;
  const specStands = split !== null || tab === "spec";
  const terminalStands = (split !== null && codeTarget === null) || tab === "terminal";
  const terminalWork = terminalStands ? (selected ?? lastSelected.current) : null;
  // **`chat` 탭 — 대화창이 가운데에 넓게 선다**(three-axes S21 · 결정 9). 분할에는 들지 않는다: 분할은 늘 `spec ▏ 묶음의 지금 탭`이라
  // `tab=chat`에 분할이 겹치면(손으로 친 주소 · 그것을 적어 둔 기억) 분할이 이기고 포커스는 문서 열이다(`columnOf`). 대화 탭으로
  // 가는 갱신은 분할을 함께 끈다(`tabSearch`).
  const chatStands = split === null && tab === "chat";

  // **한 대화창은 한 곳에**(three-axes S22). `chat` 탭이 떠 있으면 작업 패널은 `chat`을 보이지 않는다 — 패널이 `chat`을 고른 채였으면
  // 그동안 패널이 비켜서 가운데가 넓어진다(프로토타입 D). 고른 칸과 열림은 그대로 기억한다: `spec`으로 돌아오면 대화가 패널로 돌아온다.
  const chatAway = chatStands && panelView === "chat";
  const panelShown = workPanelOpen && !chatAway;
  // 레일 칸을 눌렀다(ui-refresh 결정 9 · 10). 켜진 칸을 다시 누르면 닫히고, 그 밖에는 그 칸으로 연다 — 규칙은 레일의 것이다
  // (`pickRail`). 켜짐은 「보이는 패널이 그 칸을 골랐다」라 열림 대신 `panelShown`을 건넨다. 토글 · ⌘Enter는 열림만 뒤집고 고른
  // 칸은 그대로다.
  //
  // **`chat` 탭이 떠 있을 때의 `chat`은 예외다**(S22 · 프로토타입 D) — 그 칸은 켜진 것으로 읽히지만 다시 눌러 닫는 칸이 아니라,
  // 대화를 패널로 데려오는 칸이다: 가운데는 `spec`으로, 작업 패널은 `chat`으로 간다.
  const pickPanelView = (next: PanelView) => {
    if (chatStands && next === "chat") {
      onSelectTab("spec");
      setPanelView("chat");
      setWorkPanelOpen(true);
      return;
    }
    const after = pickRail({ open: panelShown, active: panelView }, next);
    setPanelView(after.active);
    setWorkPanelOpen(after.open);
  };
  // 패널 토글 · ⌘Enter. 열림만 뒤집는다 — 다만 대화창이 가운데로 가 패널이 비켜선 동안(`chatAway`)은 열림을 뒤집어도 보이는 것이
  // 없다(그 패널은 `chat`을 못 보인다). 그때 펼치기는 `spec`으로 편다 — 눌러도 아무 일이 없는 버튼이 되지 않게(결정 11·21).
  const togglePanel = () => {
    if (chatAway) {
      setPanelView("spec");
      setWorkPanelOpen(true);
      return;
    }
    setWorkPanelOpen((open) => !open);
  };
  const togglePanelRef = useRef(togglePanel);
  togglePanelRef.current = togglePanel;

  // 패널이 딛고 선 작업. 두 본문 중 어느 것이 서 있든 **같은 패널 하나**가 옆에 선다
  // (결정 49). 터미널 탭에서 `terminalWork`가 붙들어 둔 작업을 쓰는 것도 그대로 따라온다 —
  // 본문이 그 작업의 셸을 보여주는데 패널만 다른 작업을 말하면 안 된다.
  const panelWork = terminalWork ?? selected;

  /**
   * 탭 줄이 그리는 것 — **스토어를 구독하는 자리가 화면이다.** 줄 자체는 상태와 콜백만
   * 받는다(ShellTabs 머리말): 그 파일이 terminal-store를 import하면 `@xterm/*`와 그 CSS가
   * 따라 들어와 정적 마크업 검사가 통째로 죽는다.
   *
   * 좁히지 않고 통째로 읽는 것은 셀렉터를 빼면 컴파일이 안 되기 때문이다(TS2554).
   * 대신 **다시 그릴지는 `sameScreen`가 가른다** — 셸은 프롬프트마다 OSC 타이틀을 쏘는데,
   * 남의 work의 타이틀 하나에 이 화면이 다시 그려지면 마크다운 본문까지 함께 다시 그려진다
   * (⌘1~9가 구독을 아예 피한 그 이유와 같다).
   *
   * **`tabOwner`가 위에 있어야 한다.** 비교 함수가 그것을 닫아 잡는데 그 함수는 `useStore`
   * 안에서 **곧바로** 불린다 — 선언보다 아래 있으면 TDZ로 터진다.
   */
  // `null`은 그대로 **「고른 작업이 없다」**이지 최상위 터미널(빈 글자 `""`)이 아니다 — 아래
  // `shellClosedByTab`의 머리말이 그 갈래를 든다.
  const tabOwner = panelWork ? ownerOf(panelWork.slug) : null;
  const shellState = useStore(
    terminalStore,
    (whole) => whole,
    (a, b) => sameScreen(a, b, tabOwner),
  );

  // ⌘T — **셸이 0개여도 통한다**(결정 93). 그 키는 지금까지 xterm의 키 핸들러에만 붙어
  // 있어, 마지막 칸을 `×`로 닫은 화면에는 들을 사람이 없었다.
  //
  // **듣는 범위가 이 화면 전체다**(결정 98). ⌘1이 spec, ⌘2~9가 셸로 본문을 옮기는 한 벌인데
  // ⌘T만 안 옮기면 혼자 어긋난다 — 그래서 spec을 읽는 중에도 듣고, 열면 본문을 함께 옮긴다.
  // **⌘W는 안 넓힌다** — 「이 칸을 닫는다」는 겨눌 칸이 있어야 한다.
  //
  // 언제 비켜야 하는지는 `opensShellFromWindow`가 혼자 안다(제목 편집 중인 `<input>`,
  // 그리고 **xterm의 숨은 `<textarea>`** — `togglesPanel`이 적어 둔 함정과 같은 자리다).
  //
  // 딛고 선 작업은 `panelWork`다 — 본문이 셸을 보여주는데 다른 작업의 셸을 여는 일이 없다.
  //
  // **자리는 기본 자리 함수 하나가 정한다**(UI개선 결정 17~19). 프로젝트가 여럿인 work이면 「모든
  // 프로젝트」이고 `null`이 없어, 프로젝트를 안 골랐다고 ⌘T가 안 먹는 경우가 사라졌다. `+`
  // 메뉴의 프로젝트 줄과 진입 셸은 여전히 `workShellOrigin`을 탄다 — 들어가도 셸이 저절로
  // 안 서는 것(UI개선 결정 30)이 그쪽의 `null`이다.
  //
  // **셸 안 ⌘T도 여기로 온다.** xterm 핸들러는 요청만 보내고(`requestNewShell`) 이 화면이
  // 같은 `open`으로 연다 — 셸 안과 밖이 언제나 같은 자리다. 요청은 **이 화면의 셸**이 보낸
  // 것만 받는다 — 거르는 자리는 스토어다(`onNewShellRequested`). 창 keydown 리스너를 하나 더 거는 모양으로 짓지 않는다(결정 93의
  // `stopPropagation`이 막아 둔 두 번 열기를 되살린다).
  useEffect(() => {
    const open = () => {
      if (!panelWork) return;
      openNewShell(workDefaultOrigin(panelWork));
      onSelectTab("terminal");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!opensShellFromWindow(e)) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKeyDown);
    // 고른 작업이 없으면 이 화면의 셸도 없다 — 들을 요청이 없다.
    const stop = tabOwner === null ? () => {} : onNewShellRequested(tabOwner, open);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stop();
    };
  }, [panelWork, tabOwner, onSelectTab]);

  /**
   * ⌘1은 spec, ⌘2~9는 **그 화면의 묶음**, ⌃Tab은 그 묶음의 순회(결정 78·79·109 · git-integration 결정 31).
   * 고른 칸이 셸이면 그 셸을 켜고 터미널로, 파일 탭이면 그 파일로 간다(「파일 탭 열기」).
   *
   * 앞 판의 「사이드바 N번째 작업 열기」가 걷혔다 — 한 화면 안에서 본문을 옮기는 한 벌이
   * 됐고, ⌘T가 그 벌에 이미 들어 있다(결정 98). 세는 것은 **이 화면의 셸**이지 사이드바에
   * 보이는 전부가 아니다: 남의 work의 가지를 펼쳐 두었어도 ⌘2는 이 work의 첫 셸이다.
   *
   * **구독한 값을 쓰지 않고 그때 읽는다.** 필요한 순간은 키를 누른 그 한 번뿐이라,
   * 의존성에 상태를 얹으면 셸이 프롬프트마다 쏘는 타이틀마다 이 이펙트가 다시 붙는다.
   * (탭 줄이 서면서 이 화면은 위 `shellState`로 **이 work의** 셸을 구독하게 됐다 —
   * 그래도 여기서 읽는 자리는 안 바꾼다: 그 값은 이 이펙트의 의존성이 아니어야 한다.)
   *
   * 셸 안에서도 먹어야 한다(결정 99) — 그 판정은 `shellNavFromWindow`가 혼자 안다.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const nav = shellNavFromWindow(e);
      if (!nav || !panelWork) return;
      e.preventDefault();
      const state = terminalStore.state;
      // 위 `tabOwner`와 **같은 값**인데 거기서 못 받는다 — 그쪽은 `ShellOwner | null`이라
      // 여기서 다시 좁혀야 하고, 좁히는 가드가 「고른 작업이 없다」와 겹쳐 뜻이 흐려진다.
      // 짓는 함수가 하나(`ownerOf`)라 두 값이 갈릴 수는 없다.
      const owner = ownerOf(panelWork.slug);
      const tabs = bundleOf(state, owner);
      // **⌘1만 이 화면의 것이다** — 문서는 묶음의 칸이 아니라 여기서 가른다. 나머지는 한 칸
      // 밀린 묶음 자리이고, 그 밀림은 `shellForNav`가 `firstKey`로 받는다.
      if (nav.kind === "index" && nav.n === 1) {
        onSelectTab("spec");
        return;
      }
      const next = shellForNav(tabs, activeIdOf(state, owner), nav, 2);
      if (next === null) return;
      // 고른 칸이 파일 탭이면 그 파일로 간다 — 켜는 일은 주소를 받은 자리가 한다(아래 주소 따라가기).
      const picked = bundleTabOf(state, owner, next);
      if (picked?.kind === "code") {
        onOpenCode(picked.project, picked.path, false);
        return;
      }
      selectShell(next);
      onSelectTab("terminal");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelWork, onSelectTab, onOpenCode]);

  /**
   * ⌘W — **켜진 탭을 닫는다**(결정 13).
   *
   * 이 키를 window에서 듣게 된 근거는 **겨눌 칸이 화면에 서게 된 것** 하나다. 한때
   * `opensShellFromWindow`의 머리말이 「⌘W는 안 넓힌다 — 겨눌 칸은 셸에 포커스가 있을
   * 때만 뚜렷하다」고 적었는데, 탭 줄이 그 전제를 없앴다(adr-03).
   *
   * **`spec`이 켜져 있으면 아무 일도 안 한다** — 고정 탭이라 `×`가 없는 것과 같은 말이다.
   * 분할이면 열 둘이 함께 서지만 `tab`은 그때 **포커스가 든 열**을 가리키므로(결정 97의
   * `focusColumn`) 여기서 한 번 더 가를 것이 없다.
   *
   * 닫는 길은 여전히 `requestCloseShell` 하나다 — 확인 창을 우회하는 길을 새로 만들지
   * 않는다(결정 92가 `closeShell`을 밖으로 안 내보내는 그 이유). 셸 안에서는 xterm 핸들러가
   * 이미 같은 함수로 보내고 `stopPropagation`으로 여기까지 안 올라오므로 창이 두 번 안 뜬다.
   *
   * **닫을 것이 없으면 `preventDefault`도 안 부른다.** 이 앱의 메뉴에는 `close_window()`가
   * 없어(src-tauri/src/lib.rs) ⌘W는 원래 아무 일도 안 하는 키다 — 삼키는 시늉을 해 두면
   * 나중에 그 자리에 무엇이 생겼을 때 왜 안 오는지가 이 줄에 숨는다.
   *
   * 겨누는 칸을 정하는 일은 `shellClosedByTab`이 혼자 안다 — 아래 그 함수의 머리말이
   * 왜 꺼냈는지를 든다.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!closesShellFromWindow(e)) return;
      // 본문이 파일 탭이면 **확인 없이** 닫는다(git-integration 스토리 50) — 프로세스가 없어 물을 것이 없다. 다음 탭과 주소는
      // 셸을 닫을 때와 같은 길로 따라온다(이웃 규칙 · 아래 주소 따라가기).
      const codeId = codeTabClosedByTab(tab, tabOwner, terminalStore.state);
      if (codeId !== null) {
        e.preventDefault();
        closeCodeTab(codeId);
        return;
      }
      const id = shellClosedByTab(tab, tabOwner, terminalStore.state);
      if (id === null) return;
      e.preventDefault();
      void requestCloseShell(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tabOwner, tab]);

  /**
   * **주소 → 묶음**(git-integration S12 — 주소가 정본이다). 주소가 파일 탭을 가리키면 그 탭이 묶음의 지금 탭이다 — 묶음에
   * 없으면 끝에 연다(스토리 60: 뒤로가기 · work 기억 · 링크가 닫힌 파일을 가리킬 수 있다). 주소가 「본문은 셸이다」라고
   * 말하는데(`tab=terminal` · 분할의 묶음 열) 지금 탭이 파일 탭이면 셸을 켠다.
   *
   * **주소가 바뀔 때만 돈다** — 묶음이 바뀌었다고 돌면 방금 닫은 파일 탭을 주소가 아직 가리키는 한 틱에 그 탭을 되살린다.
   * 묶음 쪽에서 난 변화를 주소로 옮기는 것은 아래 효과의 일이다.
   */
  useEffect(() => {
    if (tabOwner === null) return;
    if (codeTarget) showCodeTab(tabOwner, codeTarget);
    else if (tab === "terminal" || split !== null) showShellTab(tabOwner);
  }, [tabOwner, tab, code, split]);

  /**
   * **묶음 → 주소.** 묶음의 지금 탭이 묶음 쪽에서 바뀌면 — 지금 탭을 닫아 이웃이 켜졌거나(결정 30), 셸이 스스로 끝나 빠졌다
   * (결정 48) — 본문이나 분할의 묶음 열이 묶음을 보여주는 동안에는 주소가 그 탭을 따라간다: 셸이면 `code`가 없고(본문이면
   * `tab=terminal`), 파일 탭이면 `code`가 그 파일이다(git-integration 티켓 07 — 분할이면 묶음 열이 따라간다). 이 갈림을 닫는
   * 길마다 적지 않고 여기 하나에 둔다 — 셸을 닫는 길은 확인 창 뒤(`requestCloseShell`)와 셸 스스로의 끝까지 여럿이다.
   *
   * 단일 뷰에서 문서나 대화창을 보는 중(`spec` · `chat` — 대화 탭은 묶음 밖이다, three-axes S21)이면 따라가지 않는다 — 탭 줄에서
   * 뒤에 있는 칸을 닫은 것은 본문을 안 바꾼다. 묶음이 빈
   * 것은 따로다(아래 「묶음이 비면 spec」). **work을 옮긴 순간은 세지 않는다** — 그때의 지금 탭은 다른 work의 것이다.
   *
   * 지금 탭은 한 글자로 접어 구독한다 — 셸이 프롬프트마다 쏘는 타이틀에 이 화면이 다시 그려지지 않게. **의존성이 그 값과
   * 소유자뿐인 것은 의도다** — 주소(`tab` · `code`)가 바뀌어서 돌면 방금 사람이 옮긴 주소를 옛 지금 탭으로 되돌린다.
   */
  const shownKey = useStore(terminalStore, (state) =>
    tabOwner === null ? null : shownTabKey(activeTabOf(state, tabOwner)),
  );
  const shown = useRef({ owner: tabOwner, key: shownKey });
  useEffect(() => {
    const before = shown.current;
    shown.current = { owner: tabOwner, key: shownKey };
    if (before.owner !== tabOwner || before.key === shownKey || shownKey === null) return;
    if ((tab === "spec" || tab === "chat") && split === null) return;
    const bundle = shownKey === SHELL_SHOWN ? null : shownKey;
    // 주소가 이미 그 탭을 말한다 — 주소를 따라 켜진 탭이다(위 「주소 → 묶음」).
    if (bundle === code) return;
    onFollowBundle(bundle);
  }, [tabOwner, shownKey]);

  // 보고 있는 문서와 그것을 가지고 정해지는 것들. **패널과 본문이 한 값을 본다** — 트리의 "지금
  // 이 문서" 표시와 본문이 따로 정하면 뷰 탭을 오갈 때마다 트리 표시가 켜졌다 꺼진다(결정 49 —
  // 1판에서 실제로 그랬다). 파일이 삭제되면(또는 주소가 없는 파일을 가리키면) 기본 문서로 폴백.
  //
  // **기본 문서는 spec 트리의 것이다**(spec 레이아웃 결정 14). 화면은 이름을 모른다 — 레이아웃
  // 순서상 첫 파일을 엔진이 골라 work과 한 응답으로 보낸다.
  const specFiles = panelWork?.specFiles ?? [];
  const currentSpec =
    currentFile && specFiles.includes(currentFile)
      ? currentFile
      : (panelWork?.specTree.defaultDoc ?? null);
  // 잠김은 **문서가 보기 묶음(문서 | 원문)을 따르지 않는 모든 경우**다. 둘이다: 파일 종류가 묶음을 무시할 때(그림 · md도 html도
  // 아닌 것), spec 문서가 하나도 없는 작업. 본문이 셸일 때는 따로 잠그지 않는다 — 묶음이 문서 위 경로 줄에 서므로 문서 카드가
  // 없으면 묶음도 없다.
  //
  // 파일 종류로 갈리는 일은 표가 안다(`doc-refs`의 표) — 여기서 다시 풀면 본문·트리·아카이브가 다른 말을 할 자리가
  // 생긴다. 문서가 하나도 없는 작업에서 표는 마크다운으로 떨어지는데, 그 기본값은 **본문 분기(예쁜 보기)를 위한
  // 것이지 "누를 것이 있다"는 뜻이 아니다** — 본문은 "아직 spec이 없어요"에 고정이라 눌러도 아무 일이 없다(결정 11·21).
  // 그래서 `!currentSpec`이 따로 얹힌다.
  const sourceLocked = !currentSpec || ignoresViewSwitch(currentSpec);

  // 고친 곳(three-axes 티켓 26) — 그 work의 표시. 트리의 점과 레일 `spec`의 점이 「아직 열지 않은 고친 파일」(`unseen`)을 읽는다.
  // **열었다 = 본문에 문서가 서 있고 그 파일이 지금 문서다.** 고친 파일을 보던 중에 턴이 끝났어도 점이 서지 않고(프로토타입 D),
  // 터미널 탭에서 지금 문서가 고쳐졌으면 spec으로 돌아올 때 지운다. 문단의 표시는 스펙 창이 스스로 읽는다(`SpecViewer`).
  // 이 화면은 점(`unseen`)만 구독한다 — 문단의 표시가 서고 지워질 때마다 화면 전체가 다시 그려지지 않게.
  const unseen = useStore(changeMarksStore, (state) => marksOf(state, panelWork?.slug ?? "").unseen);
  const openedSpec = panelWork && specStands ? currentSpec : null;
  useEffect(() => {
    if (panelWork && openedSpec && unseen.includes(openedSpec)) markOpened(panelWork.slug, openedSpec);
  }, [panelWork, openedSpec, unseen]);
  // 레일 `spec`의 점 — 아직 열지 않은 고친 파일이 있고 트리가 지금 안 보일 때(프로토타입 D). 트리가 보이면 그 행들의 점이 말한다.
  // 레일 `chat`의 점 — 그 work의 대화가 나를 기다리거나 끝났고 대화창이 지금 안 보일 때(three-axes 결정 10). 대화창이 보이면(가운데 `chat` 탭
  // 이거나 작업 패널이 `chat`을 보인다) 대화 탭의 점이 말한다.
  const chatSignal = useWorkChatSignal(panelWork?.slug ?? null);
  const chatVisible = chatStands || (panelShown && panelView === "chat");
  const railMarks: Partial<Record<PanelView, RailMark>> = {};
  if (unseen.length > 0 && !(workPanelOpen && panelView === "spec")) railMarks.spec = UNSEEN_IN_SPEC;
  if (chatSignal && !chatVisible) railMarks.chat = CHAT_RAIL_MARKS[chatSignal];
  // 문서에서 고른 자리(three-axes 티켓 27) — 그 work의 지금 대화의 입력창에 인용 칩으로 붙인다. 대화창이 가려져 있으면(작업 패널이
  // 닫혔거나 다른 칸을 보이면) 작업 패널을 `chat`으로 연다 — 켜진 칸을 다시 누른 것이 아니라서 레일 토글 규칙(`pickPanelView`)은
  // 쓰지 않는다: 이미 보이는 대화창을 닫으면 안 된다.
  const quoteWork = selected?.slug ?? null;
  const quoteDoc = useCallback(
    (quote: Quote) => {
      if (!quoteWork) return;
      setQuote(quoteWork, quote);
      setPanelView("chat");
      setWorkPanelOpen(true);
    },
    [quoteWork],
  );
  // 대화창의 문서 링크(알약 목록의 파일) — 그 파일을 첫 고친 자리로 연다(스토리 72). 문서 링크와 같은 길이라 히스토리를 만들고
  // 탭을 spec으로 돌린다(`fileSearch`). 줄은 스펙 창이 그 파일을 그린 뒤 찾아간다(`doc-reveal`).
  const openDoc = useCallback(
    (path: string, line: number | null) => {
      if (panelWork) requestReveal(panelWork.slug, path, line);
      onSelectFile(path, true);
    },
    [panelWork, onSelectFile],
  );

  /**
   * files 트리에서 파일 행을 눌렀다 — 「파일 탭 열기」다(스토리 23 — replace: 트리 훑기는 뒤로가기 기록을 안 쌓는다, 스토리 59).
   * 이미 열린 파일이면 그 탭으로 간다(스토리 24 — 묶음이 정체로 가른다).
   *
   * **다시 누르면 닫힌다**(git-integration 결정 30 — 사용자가 더한 UX). 누른 파일이 **지금 보이는 탭**(본문이나 분할의 묶음 열에
   * 선 파일 탭 — 티켓 07)의 파일이면 그 탭을 닫는다. 분할이면 포커스가 문서 열에 있어도 옆 열에 보이는 탭이다. 닫는 길은 `×` · ⌘W와 같다 — 확인 없이 빼고, 이웃이 켜지고 주소가 따라오는 것은 묶음 → 주소가
   * 한다. 열려 있어도 뒤에 있는 탭이면 그 탭으로 갈 뿐이다(스토리 34).
   *
   * **둘째 클릭은 닫기로 치지 않는다**(S15 — `clicks`는 연속 클릭의 몇 번째인가, 키보드로 누르면 0). 더블클릭의 첫 클릭이 연
   * 탭을 둘째 클릭이 닫는 깜빡임이 없다 — 닫힌 파일을 두 번 누르면 열린 채 남는다. 탭 줄의 칸 자체를 다시 누르는 것은 여기를
   * 지나지 않아 닫지 않는다(스토리 36).
   */
  const pressCode = useCallback(
    (target: CodeTarget, clicks: number) => {
      const shown = codeTarget !== null && code === codeRefOf(target);
      // 보이는 파일 탭은 묶음의 지금 탭이다 — 주소를 따라 켜졌다(「주소 → 묶음」).
      const visible = shown && clicks < 2 && tabOwner !== null ? activeTabOf(terminalStore.state, tabOwner) : null;
      if (visible?.kind === "code") {
        closeCodeTab(visible.id);
        return;
      }
      onOpenCode(target.project, target.path, false);
    },
    [codeTarget, code, tabOwner, onOpenCode],
  );


  // 열에 포커스가 들어가면 `tab`이 **그 열**을 가리킨다(결정 97) — 토글을 끌 때 남는
  // 쪽이 그 값이다. 이미 그 값이면 옮기지 않는다: 열 머리의 `×`처럼 한 틱에 두 이동이
  // 겹치는 자리에서 앞의 것이 조용히 이기기 때문이다.
  //
  // 묶음 열은 그대로다 — 그 열에 선 파일 탭(`code`)을 함께 넘긴다(git-integration 티켓 07). 묶음 열을 가리키는 `tab`은 그 열에
  // 선 것의 종류다(`columnSearch`).
  const focusColumn = useCallback(
    (next: ColumnTab) => {
      if (next !== columnOf(tab)) onSelectSplit(split, next, code);
    },
    [tab, split, code, onSelectSplit],
  );

  /**
   * **분할을 켜면 패널을 한 번 접는다**(결정 88). 창 1280·사이드바 264·패널 330에서
   * 분할하면 열 하나가 343px이고, 거터를 빼면 터미널이 ≈34칸이라 `claude` TUI가 깨진다.
   *
   * **한 번은 「사람이 켠 그 순간」이지 상태 전이가 아니다.** 한때 `split`을 보는 이펙트로
   * 두었는데, 그러면 분할인 A에서 단일인 B로 갔다 A로 돌아올 때도 `null → lr`이라
   * **사람이 다시 열어 둔 패널을 또 접었다** — 결정 88이 적어 둔 「억지로 닫지 않는다」의
   * 반대다. 켜는 길이 둘(헤더 토글·드래그 놓기)이라 판정을 여기 하나에 둔다.
   */
  const collapseOnSplit = useCallback(
    (next: SplitSide | null) => {
      if (next !== null && split === null) setWorkPanelOpen(false);
    },
    [split],
  );

  // 분할을 바꾸는 **유일한 자리**다 — 켜기·끄기·좌우 맞바꾸기가 전부 여기를 지난다.
  //
  // 묶음 열에 설 것은 **묶음의 지금 탭**이다(git-integration 결정 32) — 누른 그 순간 묶음에서 읽는다. 문서를 보다 켜도 묶음의
  // 지금 탭은 기억으로 남아 있어, 그것이 파일 탭이면 옆 열이 그 파일이다(`bundleRefOf`).
  const changeSplit = useCallback(
    (next: SplitSide | null, column: ColumnTab) => {
      collapseOnSplit(next);
      onSelectSplit(next, column, bundleRefOf(terminalStore.state, tabOwner));
    },
    [collapseOnSplit, onSelectSplit, tabOwner],
  );

  /**
   * **묶음의 마지막 칸이 닫히면 본문이 문서로 돌아온다.** 세는 것은 셸이 아니라 **묶음의 칸**이다(git-integration 결정 30 —
   * 묶음이 비면 spec으로 간다). 셸이든 파일 탭이든 마지막 칸이 빠지면 걷는다.
   *
   * 셸이 0개인 터미널 본문은 볼 것이 없는 화면이다 — 빈 자리와 `+ 새 셸` 하나뿐이고,
   * 그 자리에 사람을 남겨 두면 다음에 무엇을 할지가 본문 밖(사이드바)에 있다.
   *
   * **분할이면 분할째로 걷는다.** 한때 「문서가 이미 옆 열에 서 있으니 그냥 둔다」로
   * 두었는데, 실물에서 그 화면은 **빈 터미널 열이 반을 차지한 채로 남았다** — 볼 것이
   * 없는 열이 절반을 먹는 것이 두 열을 나란히 세운 이유와 정면으로 어긋난다.
   * 남는 것은 문서 하나이므로 `split`을 끄면서 `tab`도 함께 문서로 보낸다(한 번의 이동이라
   * 「끄면 남는 쪽」(결정 97)도 어긋나지 않는다).
   *
   * 세는 것을 **개수 하나로 좁힌다.** 이 화면이 스토어를 통째로 구독하면 셸이 프롬프트마다
   * 쏘는 타이틀에 마크다운 본문까지 다시 그려진다(⌘1~9가 구독을 피한 그 이유와 같다).
   * 개수는 칸을 열고 닫을 때만 바뀐다.
   */
  const tabCount = useStore(terminalStore, (state) =>
    panelWork ? bundleOf(state, ownerOf(panelWork.slug)).length : 0,
  );
  const tally = useRef<ShellTally>({ owner: tabOwner, count: tabCount });
  useEffect(() => {
    const now = { owner: tabOwner, count: tabCount };
    const emptied = shellsEmptied(tally.current, now);
    tally.current = now;
    // 본문에 묶음의 탭(셸 · 파일 탭)이 서 있을 때만 걷는다 — 문서를 읽는 중에 사이드바로 셸을 닫은 것은
    // 화면에서 아무것도 안 바뀌어야 한다. 가운데의 대화창(`chat` 탭 — 묶음 밖, three-axes S21)도 그대로다.
    if (emptied && ((tab !== "spec" && tab !== "chat") || split !== null)) changeSplit(null, "spec");
  }, [tabCount, tabOwner, tab, split, changeSplit]);

  // 떨궜다. **묶음의 칸은 여기서 켜고**(스토어의 일이라 주소와 무관하다) 이동은 주소를 쥔 쪽이
  // 한다 — 남의 work을 떨구면 work이 통째로 바뀌는데(결정 101) 그 이동은 이 화면의 일이 아니다.
  //
  // 끈 칸이 셸이든 파일 탭이든 묶음 열에 선다(git-integration 결정 32 · 스토리 56) — 켠 뒤 묶음의 지금 탭을 읽으면 그 칸이다.
  // 문서 칸을 끌었으면 묶음은 그대로라 지금 탭이 옆 열에 선다.
  const dropHere = useCallback(
    (source: DragSource, half: SplitHalf) => {
      if (source.kind !== "spec" && source.shellId !== null) selectShell(source.shellId);
      const next = dropSplit(source.kind, half);
      collapseOnSplit(next);
      onDropInto(source, next, bundleRefOf(terminalStore.state, source.owner));
    },
    [collapseOnSplit, onDropInto],
  );

  // 경로 줄(codex-ds 스펙 §4 · §6 — `PathBar`) — spec 탭 문서의 머리 줄이다. 단일 뷰면 문서 카드의 탭 줄 아래에 서고, 분할이면
  // spec 열의 머리다. 경로 캡슐 `slug › spec › … › 파일`과, 그 문서에 거는 조작 둘(보기 묶음 · 경로 복사)이 선다. 닫기 ×는 없다 —
  // spec 탭은 늘 있는 탭이다(codex-ds 결정 13).
  //
  // - **보기 묶음**(문서 | 원문, ui-refresh 결정 7의 B)이 한때 작업 패널 머리의 탭 줄에서 문서 쪽으로 왔다 — 바꾸는 것이 이 카드의
  //   몸이라 그 머리가 제자리다. 한때 분할이면서 패널이 접혔을 때만 열 머리에 서던 갈래(결정 106)는 걷혔다: 묶음이 늘 문서의 경로
  //   줄 하나에 서므로 같은 일을 하는 버튼이 한 화면에 둘 설 일이 없다.
  // - **경로 복사**는 트리의 경로 복사와 같은 값을 낸다(`specRef` → `copyText`) — 새 동작이 아니라 자리가 하나 더 생긴 것이다.
  //   가리킬 파일이 없으면(spec 0개) 서지 않는다 — 눌러도 아무 일이 없는 버튼이 된다(결정 11·21).
  //
  // 캡슐은 보여 주기만 한다(누르는 칸이 아니다 — `PathBar`). 폴더는 spec 기준 경로의 조각 그대로라 판마다 `spec.md`인 문서도
  // 어느 판인지가 캡슐에서 읽힌다(결정 104가 열 머리에 판 폴더를 붙인 그 까닭).
  const docPath = selected ? [selected.slug, "spec", ...(currentSpec ? currentSpec.split("/") : [])] : [];
  const docView: PathView = { source: showSource, locked: sourceLocked, onChange: setShowSource };
  const copyDocPath = selected && currentSpec ? () => copyText(specRef(selected.slug, currentSpec)) : undefined;

  // 코드 카드의 경로 줄(git-integration S17) — 문서의 경로 줄과 같은 줄이다: 캡슐 `<프로젝트> › 폴더 › 파일`과 끝의 경로 복사. 보기
  // 묶음은 없다 — 코드 카드의 몸은 늘 코드다. 복사하는 값은 그 파일의 워크트리 경로다 — 에이전트에게 그 파일을 그대로 넘긴다(스토리
  // 69). 워크트리 자리는 코어가 준 값에서 잇는다(`worktreeDirRef` — 뿌리를 여기서 짓지 않는다). 그 프로젝트의 워크트리가 이 work에
  // 없으면 가리킬 파일이 없어 서지 않는다 — 프로젝트는 있는데 워크트리 폴더가 사라진 것(`exists`가 거짓 — files 칸이 「워크트리
  // 없음」을 띄우는 그 상태)도 같다.
  //
  // 그 워크트리 자리는 코드 카드의 몸도 받는다 — 그림 파일은 같은 자리에 코어가 링크를 푼 실제 경로를 이어 건다(티켓 09). 뿌리를
  // 두 자리가 따로 지으면 복사한 경로와 그린 그림이 다른 워크트리를 가리킬 수 있다.
  const codeWorktree =
    codeTarget && selected?.worktrees.find((one) => one.project === codeTarget.project && one.exists);
  const codeWorktreeDir = codeWorktree ? worktreeDirRef(codeWorktree.path) : null;
  const codeFilePath = codeTarget && codeWorktreeDir ? `${codeWorktreeDir}${codeTarget.path}` : null;
  const codePath = codeTarget ? [codeTarget.project, ...codeTarget.path.split("/")] : [];
  const copyCodePath = codeFilePath ? () => copyText(codeFilePath) : undefined;
  const codeBar = codeTarget && <PathBar path={codePath} onCopy={copyCodePath} />;

  // 분할의 spec 열 머리 — **분할일 때만 선다**(결정 89). 문서의 경로 줄 끝에 그 열을 닫는 `×`가 더해진 것이다 — 미리보기 ×가
  // 아니라 열 닫기다(codex-ds 스펙 S14 · `CONTEXT.md` 「열」). 모양은 터미널 열의 `×`(탭 줄 끝 — 아래 `tabRow`)와 같은 조용한
  // 아이콘 버튼이다 — 두 열의 닫기가 한 모양이다. 이 열을 닫으면 남는 쪽은 **반대쪽**이다(결정 89) — 그 값이 곧 `tab`이다.
  const specHead = (
    <PathBar
      data-column="spec"
      path={docPath}
      view={docView}
      onCopy={copyDocPath}
      end={
        <Hint
          text="spec 열 닫기"
          announce="name"
          type="button"
          tabIndex={0}
          onClick={() => changeSplit(null, otherTab("spec"))}
          className="icon-button-quiet icon-button-xs shrink-0 text-fg-tertiary focus-ring"
        >
          <X className="size-3.5" />
        </Hint>
      }
    />
  );
  // 문서 본문 — 문서 카드의 몸이다(카드와 머리는 아래 `body`가 세운다).
  const specBody = selected && (
    <SpecViewer
      key={selected.slug}
      work={selected}
      panelOpen={workPanelOpen}
      sidebarOpen={sidebarOpen}
      file={currentSpec}
      showSource={showSource}
      onNavigate={followLink}
      onCopy={copyText}
      docMenu={{ view: docView, onCopyPath: copyDocPath }}
      onQuote={quoteDoc}
    />
  );
  // `key`는 Work마다 다시 마운트시킨다: 셸은 스토어가 들고 있어 안 죽고, 다시 붙는 자리만 새로 잡힌다(in-app-terminal
  // 결정 20·21). 프로세스 결정 7이 입력 없는 자동 셸만 예외로 두었다 — 그 셸은 work을 떠날 때 앱 루트(`ShellReclaim`)가 닫는다.
  const terminalBody = terminalWork && <TerminalPane key={terminalWork.slug} work={terminalWork} />;
  // 코드 보기 — 코드 카드의 몸이다(본문 카드든 묶음 열이든). 몸은 그 파일을 읽어 강조된 코드나 갈래별 몸(그림 · 안내)을
  // 세운다(`CodeView`). 코드 보기 청크를 받는 처음 한 번은 몸이 비어 있다 — 머리(경로 줄)는 이미 서서 무엇을 여는지 말한다.
  const codeBody = selected && codeTarget && (
    <Suspense fallback={null}>
      <CodeView
        key={selected.slug}
        slug={selected.slug}
        target={codeTarget}
        worktreeDir={codeWorktreeDir}
        // 문서 본문과 같은 규칙으로 넓어진다 — 화면을 둘 다 비웠을 때만(`SpecViewer`).
        wide={!sidebarOpen && !workPanelOpen}
      />
    </Suspense>
  );

  // 분할이 실제로 서는가 — 문서와 묶음 열(셸이든 파일 탭이든)의 본문이 다 설 때만이다(아래 `splitView`). 탭 줄이 어느 카드의
  // 머리인지가 이것으로 갈린다.
  const splitting = split !== null && Boolean(specBody) && Boolean(codeBody || terminalBody);

  // 탭 줄(결정 7·10) — 셸을 고르는 자리가 사이드바 가지에서 화면 안으로 되돌아왔다(adr-03). 브레드크럼
  // (`Works / 제목`)은 그때 사라졌고, work 제목은 지금 머리 카드가 말한다(아래 `head`).
  //
  // **그 줄이 본문 카드의 머리다**(codex-ds 스펙 §4 「탭 줄」) — 탭이 그 탭이 보여 줄 카드에 붙는다. 단일 뷰면 본문 카드(문서 ·
  // 터미널 · 코드 어느 쪽이든 같은 자리)의 머리이고, 분할이면 묶음 열의 머리다 — 그때 그 열을 닫는 `×`가 줄 끝에 서고(codex-ds 스펙
  // S14), 열 머리를 집는 표식(`data-column`)을 단다. 표식은 그 열에 선 것의 종류다 — 셸이면 `terminal`, 파일 탭이면 `code`(탭 줄의
  // 칸 표식 `data-tab`과 같은 종류 이름, git-integration 티켓 07). 고른 작업이 없으면 **칸이 설 자리가 없다** — 세울 소유자가 없다: 그 값은
  // work의 slug에서 나오는데(`ownerOf(…)`) 고른 작업이 없으면 그 자리가 비고, 빈 키는 **최상위 터미널**이라 `/terminal`의 셸이
  // 이 줄에 서게 된다. `+`도 열 자리가 없어 눌러도 아무 일이 없는 버튼이 된다(결정 11·21이 금지하는 것). 그때 본문 카드의
  // 머리는 화면 이름이다(아래 `body`).
  const tabRow = panelWork ? (
    <ShellTabs
      data-column={splitting ? (codeTarget ? "code" : "terminal") : undefined}
      state={shellState}
      owner={ownerOf(panelWork.slug)}
      // **`worktrees`에서 뽑는다 — `projects`가 아니다.** `workShellOrigin`이 갈리는 기준이
      // `worktrees`라, 둘이 어긋나면 메뉴는 열리는데 고른 값으로 셸이 안 생긴다 — 눌러도
      // 아무 일이 없는 버튼(결정 11·21이 금지하는 것)이 된다.
      projects={workShellProjects(panelWork)}
      // 메뉴 맨 윗줄 「모든 프로젝트」 옆의 옅은 경로(UI개선 결정 20). ⌘T와 「모든 프로젝트」가 여는
      // 자리와 **같은 함수**(`workDefaultOrigin` — `placeOrigin`이 그것을 탄다)에서 읽는다.
      defaultCwd={workDefaultOrigin(panelWork).cwd}
      // 맨 앞 고정 칸(결정 7). **켜짐은 「본문이 문서인가」이지 마지막으로 누른 칸이 아니다** —
      // 분할이면 이 값과 아래 `showing`이 함께 참이고, 그때 켜진 탭이 둘이다(결정 12).
      //
      // 우클릭 메뉴(codex-ds 스펙 §9)의 두 줄은 work 메뉴의 Finder ▸ 「spec」 · 복사 ▸ 「spec 경로」와 같은 길이다.
      spec={{
        on: specStands,
        onSelect: () => onSelectTab("spec"),
        onOpenFolder: () => openWorkFolder(panelWork.slug, null),
        onCopyPath: () => copyText(specDirRef(panelWork.slug)),
      }}
      // `spec` 바로 뒤의 `chat`(three-axes S21 · 결정 9) — 대화창을 가운데에 띄운다. 묶음 밖의 고정 칸이라 숫자 키를 받지 않고(⌘1은
      // spec, ⌘2~9는 묶음 그대로 — git-integration 결정 31) 분할에 들지 않는다. 켜짐은 `spec`과 같은 뜻이다 — 「본문이 대화창인가」.
      fixed={[{ id: "chat", label: "chat", icon: MessageSquare, on: chatStands, onSelect: () => onSelectTab("chat") }]}
      // 본문이 묶음을 보여줄 때 — 셸이든 파일 탭이든 — 켜진 칸이 선다. 주소가 셸을 말해도 **켜진 셸이 없으면** 본문은 「아직
      // 셸이 없어요」다(git-integration 판 01): 묶음에 켤 셸이 없어 지금 탭이 파일 탭으로 남았고(`withShellActive`), 자동 셸도
      // 안 뜨는 work(프로젝트 둘 이상)이다. 그 파일 탭을 켜면 본문과 켜진 칸이 다른 것을 말한다.
      showing={codeTarget !== null || (terminalStands && activeShellOf(shellState, ownerOf(panelWork.slug)) !== null)}
      // 칸을 누르면 그 셸이 켜지고 **본문이 terminal로 넘어간다** — 사이드바 가지가 하던
      // 짝 그대로다(결정 50). 어느 work으로 갈지를 여기서 안 정하는 것은 이 줄이 늘 지금
      // 보고 있는 work의 것이기 때문이다.
      //
      // **키보드 포커스도 데려온다** — 이미 켜진 탭을 다시 눌러도다(티켓 16 · `selectShellWithFocus`).
      //
      // 파일 탭이면 그 파일로 간다(「파일 탭 열기」, replace — 탭을 고르는 손짓은 기록을 안 쌓는다). 켜는 것은 주소를 받은
      // 자리다(주소 → 묶음).
      onSelect={(id) => {
        const picked = bundleTabOf(terminalStore.state, ownerOf(panelWork.slug), id);
        if (picked?.kind === "code") {
          onOpenCode(picked.project, picked.path, false);
          return;
        }
        selectShellWithFocus(id);
        onSelectTab("terminal");
      }}
      // 셸은 확인을 거치는 길 하나다(결정 92) — ⌘W도 같은 함수로 온다. 파일 탭은 **확인 없이** 닫는다(git-integration
      // 스토리 37) — 프로세스가 없다. 그 판정은 레지스트리가 칸의 종류로 한다(`removeCodeTab`은 셸 칸을 안 뺀다).
      onClose={(id) => {
        if (bundleTabOf(terminalStore.state, ownerOf(panelWork.slug), id)?.kind === "code") closeCodeTab(id);
        else void requestCloseShell(id);
      }}
      // 셸 탭 메뉴(codex-ds 스펙 §9 · S7 · S8). 붙인 이름은 메모리에만 있다. 작업 폴더는 그 셸이 뜬 곳을 참조 표기(끝에 `/`)로 쓴다.
      onRename={renameShell}
      onCloseOthers={(id) => void closeOtherShells(id)}
      onCopyCwd={(cwd) => copyText(cwdRef(cwd))}
      onOpen={(place) => {
        // 「모든 프로젝트」(와 묻지 않는 `+`)가 ⌘T와 같은 자리라는 규칙은 `placeOrigin`이 든다
        // (UI개선 결정 18·19). 고른 이름이 목록에 없으면(열린 사이 work이 바뀌었다) 자리가 안 정해진다 —
        // 그때는 열지도, 본문을 옮기지도 않는다(결정 24).
        const origin = placeOrigin(panelWork, place);
        if (!origin) return;
        openNewShell(origin);
        onSelectTab("terminal");
      }}
      // 칸을 끌면 **한 눌림을 두 소비자가 나눠 본다**(UI개선 스펙 S10) — 본문 절반에
      // 놓으면 그 절반에 서고(결정 12, 아래 받침), 이 줄의 틈에 놓으면 순서가 바뀐다(UI개선 결정 11).
      // 놓은 곳이 이긴다.
      //
      // **끄는 자리를 여기서 만든다.** 탭 줄은 스토어도 제스처 모듈도 모르는 그림이라(그쪽
      // prop 주석) 드래그 상태를 구독하는 이 화면이 건다. `/terminal`도 같은 모양으로 건다.
      //
      // 이 줄은 늘 **지금 보고 있는 work**의 것이라 소유자가 하나로 정해진다. 원천이 slug가
      // 아니라 owner인 것은 공용 제스처가 `/terminal`(slug가 없다)에서도 같은 모양을 싣기
      // 때문이다.
      //
      // 묶음의 칸은 **그 칸의 종류**를 싣는다 — 셸 칸이든 파일 탭이든 줄의 틈에 놓이고(git-integration 결정 31), 본문
      // 절반이 받는 것은 받는 쪽이 종류로 거른다(`tabDragOf`). 종류는 레지스트리가 id로 안다(`onSelect`와 같다). 누르는
      // 사이 그 칸이 빠졌으면 걸 끌기가 없다.
      onDragTab={(shellId, from) => {
        const owner = ownerOf(panelWork.slug);
        const kind = shellId === null ? "spec" : bundleTabOf(terminalStore.state, owner, shellId)?.kind;
        if (kind) armDrag({ kind, owner, shellId }, from);
      }}
      // 틈 소비자의 두 끝 — 적는 것(`hoverSlot`)은 문턱을 넘은 뒤에만 쓰고 받침의 절반과
      // 동시에 안 켜지며, 놓는 것은 `/terminal`과 같은 함수다. 둘 다 모듈 함수라 회차를 넘어 같다.
      slot={drag.slot}
      onSlot={hoverSlot}
      onDropSlot={dropShellOnSlot}
      dragging={drag.source !== null}
      // 오른쪽 끝 고정(결정 10) — 분할이면 묶음 열을 닫는 `×`다. 이 열을 닫으면 남는 쪽은 **반대쪽**이다(결정 89) — 그 값이 곧
      // `tab`이다. 단일 뷰의 줄 끝에는 아무것도 안 선다 — 상태 배지 · ⋯ · 분할은 머리 카드에 선다(아래 `head`).
      //
      // 이름은 그 열에 선 것이다 — 셸이면 `terminal`, 파일 탭이면 그 파일 이름이다(탭 줄의 파일 탭 칸이 파일 이름으로 서는 것과
      // 같다 — 그 칸의 `×`는 「<이름> 닫기」, 이것은 「<이름> 열 닫기」). 열을 닫을 뿐 탭을 닫지 않는다 — 탭은 묶음에 그대로 남는다.
      actions={
        splitting ? (
          <Hint
            text={`${codeTarget ? codePath[codePath.length - 1] : "terminal"} 열 닫기`}
            announce="name"
            type="button"
            tabIndex={0}
            onClick={() => changeSplit(null, otherTab("terminal"))}
            className="icon-button-quiet icon-button-xs shrink-0 text-fg-tertiary focus-ring"
          >
            <X className="size-3.5" />
          </Hint>
        ) : undefined
      }
    />
  ) : undefined;

  // 머리 카드(codex-ds 스펙 §6 · 스토리 23 · 24) — 왼쪽은 ⚡(work 아이콘 — 상태 글리프가 아니다)와 work 이름이다. 사이드바를 보지
  // 않아도 지금 어느 work인지 안다(⌘B로 사이드바를 접어도). **이름은 그 자리에서 바꾼다**(codex-ds 스펙 §9 · `rename`) — 이름의 두 번
  // 클릭 · F2, 또는 ⋯ · 이름 우클릭 메뉴의 「이름 바꾸기」로 들어가고, 지금 work 이름 명령(`set_work_title`)으로 저장한다.
  //
  // **이름은 work 메뉴의 대상이다**(codex-ds 결정 6 — `nameMenu`). 우클릭하거나 포커스해 ⇧F10 · 메뉴 키를 누르면 ⋯와 같은 메뉴가
  // 이름 곁에 선다 — 겨누는 것은 고른 work이다. `key`가 work을 갈아 끼우면 메뉴를 새로 세운다: 열어 둔 채 다른 work으로 옮기면
  // 메뉴가 화면에 보이는 것과 다른 work을 겨눈다(⋯의 slug 이펙트와 같은 이유).
  //
  // 오른쪽은 **할 일 | 보기 배치**다. 할 일은 상태 배지와 ⋯ — work에 대한 조작이 한 자리에 모인다(ui-refresh 결정 14 · codex-ds
  // 결정 25). 상태 배지가 앞인 것은 자주 누르는 조작이라서다 — 메뉴 뒤에 숨기면 상태를 바꾸는 데 클릭이 두 번 든다. 보기 배치는
  // 분할 토글 하나다. 사이의 세로선과 간격은 틀의 머리 카드가 그린다(`Frame`의 `HeadCard`). 한때 이 셋은 탭 줄 끝에, 그다음 창 맨 위
  // 줄의 오른쪽 끝 묶음에 섰다. 패널 토글은 화면이 건네지 않는다 — 레일이 서는 지금은 틀이 머리 카드 밖 레일 위에 세운다(`Frame`의 머리 줄).
  //
  // 지금 선 work(`selected`)가 없으면 머리 카드는 화면 이름 「Works」 하나다(codex-ds 스펙 §7) — ⚡는 work 아이콘이라 work들의 화면도
  // 같은 아이콘이다. 걸 대상이 없어 할 일도 없다.
  const head: HeadSlot = selected
    ? {
        icon: Zap,
        name: selected.title,
        nameMenu: (renderName) => (
          <WorkContextMenu
            key={selected.slug}
            flows={menuFlows}
            targetOf={(_from, trigger) => ({ slug: selected.slug, id: selected.slug, element: trigger })}
            onRename={setRenamingHead}
          >
            {(menuTarget) => renderName(menuTarget !== null)}
          </WorkContextMenu>
        ),
        rename: {
          editing: renamingHead === selected.slug,
          onStart: () => setRenamingHead(selected.slug),
          onEnd: () => setRenamingHead(null),
          onCommit: (title) => setTitle.mutate({ slug: selected.slug, title }),
          label: "작업 이름",
        },
        // 이름 뒤의 ⑂ 브랜치 — 프로젝트가 붙은 work만 선다. 프로젝트가 없으면 이름이 미리 정해졌어도(`start_work`의 `branch`) 그
        // 이름을 가진 저장소도 worktree도 아직 없다 — ⑂는 실제 git 브랜치의 말이다(프로젝트 화면 Works 행도 worktree가 있을 때만 ⑂를
        // 세운다). 미리 정한 이름은 사이드바 행의 호버 카드가 말한다.
        branch: selected.projects.length > 0 ? (selected.branch ?? undefined) : undefined,
        actions: (
          <>
            <StatusMenu work={selected} />
            <WorkMenu
              work={selected}
              flows={menuFlows}
              processing={shownLifecycle !== undefined}
              onRename={() => setRenamingHead(selected.slug)}
            />
          </>
        ),
        // 분할 토글 — **뷰 탭이 있던 자리다**(결정 86). 켜면 spec이 왼쪽, 묶음의 지금 탭이 오른쪽이다 — 파일 탭을 보다 켜면 그
        // 파일이다(git-integration 티켓 07). 끄면 `tab`이 가리키는 쪽이 남으므로(결정 97) 여기서 정할 것이 없다 — 지금 열을 그대로
        // 넘긴다.
        //
        // **말은 「분할」이다**(CONTEXT.md). 켜고 끄는 상태이지 화면 이름이 아니라 「2열로 보기」처럼 가는 곳으로 부르지 않는다.
        // 라벨이 대상을 이름하고 켜짐은 `aria-pressed`(Toggle이 스스로 단다)가 말한다. 모양(24px 아이콘 버튼, 꺼짐 `fg-tertiary` ·
        // 켜짐 toggle-on)은 부품의 icon-xs 크기다.
        //
        // 툴팁만 상태를 탄다 — 켜져 있는데 「켜기」가 뜨면 누르기 전에 무슨 일이 날지를 틀리게 말한다. 설명(`aria-description`)은
        // 안 남긴다 — 「켜기/끄기」는 `aria-pressed`가 이미 말한다(S28).
        end: (
          <Hint
            text={split !== null ? "분할 끄기" : "분할 켜기"}
            render={
              <Toggle
                size="icon-xs"
                aria-label="분할"
                pressed={split !== null}
                onPressedChange={(on) => changeSplit(on ? "lr" : null, columnOf(tab))}
              />
            }
          >
            <Columns2 className="size-3.75" />
          </Hint>
        ),
      }
    : { icon: Zap, name: WORKS_COPY.page };

  // 분할의 열 둘 — 열 하나가 카드 하나다(ui-refresh 결정 15). 문서 열은 흰 카드, 묶음 열은 셸이면 터미널 카드 · 파일 탭이면 흰
  // 코드 카드다. 이 화면은 카드의 안(열 머리와 몸)만 건넨다 — 카드 상자 · 두 열 사이 틈 · 그 가운데 폭 손잡이 · 틈 끌기 영역 ·
  // 비율과 그 저장은 공용 틀의 분할이 든다(ui-refresh 결정 27 — `Frame`의 `split`).
  //
  // **조합은 늘 `spec ▏ 묶음의 지금 탭`이고 좌우만 바뀐다**(결정 87 · git-integration 결정 32). 그래서 정할 것이 하나다.
  //
  // 순서를 여기 한 줄에서 정한다 — 열을 그리는 조각이 둘이면 「마크업에서 먼저 나오는 것이
  // 왼쪽」이라는, 검사가 기대는 규칙이 두 자리로 갈린다.
  const specColumn: SplitColumn = {
    label: "문서",
    children: (
      <ColumnInside tab="spec" head={specHead} onFocus={focusColumn}>
        {specBody}
      </ColumnInside>
    ),
  };
  // 묶음 열 — 셸이면 터미널 열, 파일 탭이면 코드 열이다. 어느 쪽이든 같은 열(`terminal`)이라 포커스가 들면 `tab`이 그 열을 가리킨다.
  // 머리는 둘 다 탭 줄이다(위 `tabRow`) — 코드 열은 그 아래 몸의 첫 줄에 경로 줄이 선다(단일 뷰의 코드 카드와 같다). 코드 열 카드의
  // 접근 이름은 본문 코드 카드처럼 그 파일의 경로다(스토리 89).
  const bundleColumn: SplitColumn = codeTarget
    ? {
        label: codeRefOf(codeTarget),
        children: (
          <ColumnInside tab="terminal" head={tabRow} onFocus={focusColumn}>
            {codeBar}
            {codeBody}
          </ColumnInside>
        ),
      }
    : {
        label: "터미널",
        tone: "terminal",
        children: (
          <ColumnInside tab="terminal" head={tabRow} onFocus={focusColumn}>
            {terminalBody}
          </ColumnInside>
        ),
      };
  // 분할 — 두 본문이 다 설 때만이다(위 `splitting`). 비율의 저장 키는 판 05 spec이 적어 둔 `work-split-ratio`다(`useSplitRatio` 머리말).
  const splitView: SplitSlot | undefined =
    splitting
      ? {
          ratioKey: "work-split-ratio",
          columns: split === "lr" ? [specColumn, bundleColumn] : [bundleColumn, specColumn],
        }
      : undefined;

  // `drag.source`를 그대로 쓰면 아래 클로저 안에서 타입이 안 좁혀진다 — 한 번 받아 둔다.
  //
  // **사이드바 작업 행은 본문이 안 받는다**(UI개선 스펙 §4) — 그 끌기가 놓일 자리는 목록의 틈이다.
  // 여기서 거르지 않으면 행을 끄는 순간 분할 겹판이 서고, 본문에 놓으면 화면이 갈린다.
  const dragSource = tabDragOf(drag);

  // 본문 — 넷 중 하나이고 모두 공용 틀의 카드다(ui-refresh 결정 4 · 15). 분할이면 틀이 `split`으로 받아 그리므로 여기는 비어
  // 있다. **패널은 여기 들어오지 않는다**(결정 49): 어느 본문이 서 있든 패널은 틀의 패널 칸에 딱 한 번 그려진다. 그래서 뷰 탭을
  // 오가도 패널 인스턴스가 그대로 살아 탭 선택이 유지된다 — 1판은 호출부가 둘이라 인스턴스도 둘이었다.
  //
  // **문서 · 대화 · 터미널 · 코드 카드가 같은 자리 · 같은 머리다** — 넷 다 탭 줄을 머리(`head`)로 이고 그 줄의 바닥을 든다
  // (`TAB_ROW_CARD`). 오가도 카드와 탭 줄이 새로 서지 않는다(`Frame`의 `Card`) — 방금 누른 칸의 포커스와 줄의 스크롤이 그대로다.
  // 그래서 문서 · 코드 카드의 경로 줄(`PathBar`)은 머리가 아니라 몸의 첫 줄로 건넨다 — 탭 줄 아래다: 머리 자리에 묶음이 서면 탭
  // 줄이 그 자리에서 다른 것이 된다.
  const body = splitView ? undefined : chatStands && selected ? (
    // 대화창 — 작업 패널의 `chat` 보기와 **같은 대화창**이 가운데에 넓게 선다(three-axes S21 · 스토리 17 · 18). 카드 머리는 다른
    // 본문과 같은 탭 줄이고, 대화창이 그 아래 제 머리(대화 탭 줄)를 든다. 흐름과 입력창은 대화창이 읽기 좋은 폭에 가운데로
    // 모은다(`ChatPane`).
    //
    // 문서 링크(도구 줄의 파일 · 알약 목록)는 패널과 같은 길이다 — 문서를 고르면 탭이 `spec`으로 돌아간다(`fileSearch`, 스토리 19).
    <Card as="main" label="대화" className={cn("flex-1", TAB_ROW_CARD)} head={tabRow}>
      <ChatPane work={selected.slug} visible specDir={selected.specDir} onOpenDoc={openDoc} />
    </Card>
  ) : terminalWork ? (
    // 터미널 — 탭 줄 아래가 곧 셸이다(Terminal 화면과 같은 카드). 바탕은 터미널 테마를 따른다.
    <Card as="main" label="터미널" tone="terminal" className={cn("flex-1", TAB_ROW_CARD)} head={tabRow}>
      {terminalBody}
    </Card>
  ) : selected && codeTarget ? (
    // 코드 카드 — 파일 탭의 본문이다(git-integration 티켓 04). **접근 이름이 그 파일의 경로다**(스토리 89) — 화면 읽기가
    // 지금 무엇을 읽는지를 카드 이름으로 듣는다. 몸은 분할의 코드 열과 같은 경로 줄과 `codeBody`다.
    <Card as="main" label={codeRefOf(codeTarget)} className={cn("flex-1", TAB_ROW_CARD)} head={tabRow}>
      {codeBar}
      {codeBody}
    </Card>
  ) : selected ? (
    <Card as="main" label="문서" className={cn("flex-1", TAB_ROW_CARD)} head={tabRow}>
      <PathBar path={docPath} view={docView} onCopy={copyDocPath} />
      {specBody}
    </Card>
  ) : (
    // 고른 작업이 없으면 패널도 탭 줄도 없다 — 화면 이름은 머리 카드가 말하고, 카드 안에 고를 것이 없어 카드 머리도 없다.
    <Card as="main" label={WORKS_COPY.page} className="flex-1">
      {/* DS 빈 화면 물음(codex-ds 스펙 §6 · 스토리 64) — 물음 · 설명 · 할 일이 카드 한가운데에 서고 글리프 칸은 없다(`Empty`의
          `question`). 프로젝트 갈래의 문구는 여기 리터럴이고, 작업이 없을 때의 셋은 표에서 온다. */}
      <Empty variant="question">
        <EmptyHeader>
          <EmptyTitle>{needsProject ? "먼저 프로젝트를 등록해요" : emptyScreen.title}</EmptyTitle>
          <EmptyDescription>
            {needsProject
              ? "작업은 등록된 프로젝트 위에서 시작돼요. Projects에서 폴더를 고르거나, 에이전트에게 맡겨도 돼요."
              : emptyScreen.body}
          </EmptyDescription>
        </EmptyHeader>
        {/* 할 일 — 실제로 통하는 경로만 안내한다. CLI에는 등록·시작 명령이 없고, 에이전트가
            atelier_add_project / atelier_start_work를 부른다.
            아래 문구는 그대로 붙여 넣는 것이다. 단축키가 아니라 붙여 넣을 글이라 Kbd가 아니다. */}
        <EmptyContent>
          <code className="select-all rounded-lg bg-surface-code px-3 py-2 font-mono text-xs text-fg-secondary">
            {needsProject ? "atelier에 이 폴더 등록해줘" : emptyScreen.code}
          </code>
        </EmptyContent>
      </Empty>
    </Card>
  );

  return (
    // 공용 틀 위의 작업 화면(ui-refresh 결정 4 · 5 · 27). 머리 줄에 머리 카드(⚡ · 이름 | 상태 · ⋯ | 분할 · 패널 토글)가 서고, 그
    // 아래 본문 카드(머리가 탭 줄)와 작업 패널 카드가 뜬다.
    //
    // 탭 줄의 바닥은 그 줄을 이는 카드가 들고(`TAB_ROW_CARD`), 모자라면 틀의 본문 열이 사이드바에게 자리를 요구한다
    // (`TAB_ROW_COLUMN`) — 카드가 제 몸을 격리하므로 넓은 문서 · xterm이 그 바닥을 부풀리지 않고, 작업 패널은 카드 줄 안에서 제
    // 최소 폭까지 문서 카드에 자리를 내준다(`Frame`의 패널 칸).
    <Frame
      sidebarOpen={sidebarOpen}
      head={head}
      // 레일(ui-refresh 결정 9 · 10)의 칸 — `spec` · `chat` · `files`. 패널과 같은 조건으로 건넨다: 고른 작업이 없으면 열 패널이 없어 레일도
      // 머리 줄의 패널 토글(틀이 패널 칸에서 짓는다)도 없다. 칸이 둘이라 레일 열이 서고(codex-ds 결정 25 — `railStands`) 토글은 그
      // 위 머리 줄에 선다. **두 본문 모두에** 선다 — 한때 터미널 본문에서 여는 버튼을 뺐던 까닭(결정 11 — 그때 패널이 거기
      // 없었다)은 사라졌고, 지금은 양쪽 다 패널을 이고 있다.
      rail={
        panelWork
          ? {
              items: PANEL_VIEWS,
              active: panelView,
              onPick: pickPanelView,
              marks: railMarks,
              // 대화창이 가운데에 선 동안 레일 `chat`은 켜진 것으로 읽힌다(three-axes S22).
              outside: chatStands ? ["chat"] : [],
            }
          : undefined
      }
      panel={
        // **작업 패널을 그리는 유일한 자리다**(결정 49). 1판은 여기와 SpecViewer 둘에서
        // 그려서 뷰 탭을 오갈 때마다 인스턴스가 갈렸다.
        //
        // **`key`를 주지 않는다.** 앞 판 결정 4(「작업을 옮기면 패널 칸이 spec으로
        // 리셋된다」)는 코드가 아니라 `key={slug}`가 붙은 SpecViewer 아래에 있어서 공짜로
        // 나오던 성질이었고, 결정 49가 그것을 명시적으로 뒤집는다. 따라오는 것 둘:
        // (a) 본문을 오가도(spec ↔ terminal) 고른 칸이 유지된다 — 칸이 둘 이상이면 다른 칸을
        //     보던 채로 본문만 갈아탈 수 있다는 뜻이다(고른 칸은 이 화면이 든다 — 위 `panelView`).
        // (b) 트리 접힘도 작업을 넘어 유지된다 — **감수한다.** 접힘 기억의 키가 판 폴더의
        //     전체 이름이라 이름이 완전히 같을 때만 물려받고, 대부분은 기억에 없는 이름이라
        //     기본값(최신 판만 펼침)으로 뜬다.
        //
        // 트리에서 파일을 누르면 **spec으로 돌아가며** 그 문서가 열린다. `selectFile`이
        // search를 객체로 갈아 끼워 `tab`이 함께 떨어지기 때문이다(결정 15의 뒷면).
        // 래퍼를 두지 않는 것은 이동이 **한 번**이어야 해서다 — 탭과 파일을 따로 옮기면
        // 두 navigate가 한 틱에 겹친다.
        panelWork
          ? {
              // 열림은 보이는가다 — 대화창이 가운데로 가 패널이 비켜선 동안(`chatAway`)은 닫힌 것으로 읽힌다(three-axes S22).
              open: panelShown,
              onToggle: togglePanel,
              size: panelSize,
              label: "작업 패널",
              children: (
                <WorkPanel
                  work={panelWork}
                  view={panelView}
                  currentFile={currentSpec}
                  onSelectFile={selectFromTree}
                  currentCode={codeTarget}
                  onPressCode={pressCode}
                  onCopy={copyText}
                  onOpenFolder={() => openWorkFolder(panelWork.slug, null)}
                  open={workPanelOpen}
                  chatElsewhere={chatStands}
                  unseen={unseen}
                  onOpenDoc={openDoc}
                />
              ),
            }
          : undefined
      }
      split={splitView}
      // 카드 줄 위를 덮는 것 셋(판 04 「덮는 것의 기준 상자」). 머리 줄은 카드 줄 밖이라 어느 것도 안 덮는다. 놓기 겹판은 카드
      // 줄 맨 위 탭 줄의 띠까지 비운다 — 「끄는 것이 출발한 줄은 덮지 않는다」(결정 12).
      overlay={
        <>
          {/* 놓일 자리 — **끄는 동안에만 선다**(결정 86). 절반 둘이 카드 줄을 나눠 덮고,
              포인터가 그 위를 지나가면 스스로 「내 위다」를 말한다. 좌표에서 절반을 계산하지
              않는 이유는 split-view.ts 머리말에 있다.

              **패널까지 덮는다.** 패널을 도려내려면 그 폭을 여기서 알아야 하는데, 그 값은 패널이
              드래그로 바꾸는 것이라 두 곳에 적히면 한쪽만 늙는다 — 넉넉히 받는 쪽이 겨누기도 쉽다.
              탭 줄은 반대다: **끄는 것이 출발한 자리**라서다(결정 12). 덮으면 겹판이 제 출발점 위에 서서
              「제자리에 돌려놓으면 아무 일도 안 난다」가 사라진다 — 칸을 12px 흔들고 손을 떼기만 해도
              화면이 갈린다. 취소하는 몸짓이 그 한 줄뿐이라 그것을 남긴다. 탭 줄은 카드 줄 맨 위의 머리라(본문 카드 ·
              분할의 터미널 열 모두 카드 줄 꼭대기에서 선다) 겹판이 그 높이(`size-toolbar` — 줄이 읽는 토큰)만큼 아래에서
              시작한다. 그 띠 안의 다른 카드 머리(패널 머리 — 46)도 함께 안 덮인다. 문서 열의 경로 줄은 48이라
              아래 2px가 덮이지만, 그 2px는 아랫선도 컨트롤도 없는 빈 여백이다. */}
          {dragSource && (
            // 겹판 **전체**를 벗어날 때만 끈다 — `pointerleave`는 버블하지 않아 반쪽 사이를
            // 오갈 때는 안 온다.
            <div className="absolute inset-x-0 top-(--size-toolbar) bottom-0 z-40 flex" onPointerLeave={clearHalf}>
              {(["left", "right"] as const).map((half) => (
                <div
                  key={half}
                  // 표식 둘 다 검사가 **정체성으로** 집기 위한 것이다 — 밝아짐은 클래스 문자열로
                  // 표현되는데 그 모양을 손보는 날 검사가 조용히 새면 안 된다.
                  data-drop-half={half}
                  data-over={drag.half === half ? "" : undefined}
                  onPointerMove={() => hoverHalf(half)}
                  onPointerUp={() => dropHere(dragSource, half)}
                  className={cn(
                    "flex-1 transition-colors duration-basic",
                    drag.half === half && "bg-accent/12 ring-1 ring-inset ring-accent/40",
                  )}
                />
              ))}
            </div>
          )}
          {/* 토스트의 자리 — **뷰 분기 밖**이라 본문이 셸이든 문서든 같은 자리에 뜬다(결정 47).
              가운데는 문서 카드가 아니라 **카드 줄** 전체의 가운데인데, 이 표면이 패널에서
              일어나는 일(트리 복사·⌘T 거절)까지 말하기 때문이다. Provider는 앱 루트에 하나고
              자리(Viewport)는 화면마다 둔다(S14) — 아카이브 화면도 제 카드 줄 아래 가운데에 둔다. */}
          <Toaster />
          {running && <LifecycleOverlay verb={running.verb} detail={running.detail} />}
        </>
      }
    >
      {body}
    </Frame>
  );
}

/**
 * 분할의 열 하나의 안 — 열 머리와 몸이다. 카드 상자와 그 둘레(틈 · 손잡이 · 끌기 영역)는 공용 틀의 분할이 그린다(`Frame`의 `split`).
 *
 * 포커스를 받는 것은 **머리가 아니라 속**이다. 머리에 얹으면 그 열의 `×`를 누르는 것이 「이 열을 봤다」로 먼저 읽혀, 한 틱에 이동이
 * 둘 겹친다. `pointerdown`까지 보는 것은 **문서 열이 포커스를 못 받기 때문이다** — 글을 읽는 영역이라 클릭해도 focus 이벤트가 안
 * 난다(결정 97의 「포커스가 들어갈 때」를 여기까지 넓혔다).
 */
function ColumnInside({
  tab,
  head,
  onFocus,
  children,
}: {
  tab: ColumnTab;
  head: React.ReactNode;
  onFocus: (tab: ColumnTab) => void;
  children: React.ReactNode;
}) {
  return (
    <>
      {head}
      <div
        className="flex min-h-0 flex-1 flex-col"
        onFocusCapture={() => onFocus(tab)}
        onPointerDownCapture={() => onFocus(tab)}
      >
        {children}
      </div>
    </>
  );
}

// 되돌릴 수 없는 조작이 도는 동안 카드 줄을 덮는다.
//
// 워크트리 제거는 폴더 크기에 비례해 수 초가 걸린다(실측 8.9GB). 그동안 화면이 아무 말도
// 하지 않으면 **버튼이 안 눌린 것처럼 보이고**, 사이드바에는 그 작업이 아직 그대로 있어
// 더 그렇다. 덮는 것 자체도 목적이다 — 진행 중에 같은 작업을 다시 겨누지 못하게 한다.
//
// 공용 틀의 `overlay` 칸이라 카드 줄(본문 카드와 그 머리의 탭 줄 + 패널)을 덮고 머리 줄은 덮지 않는다(판 04 「덮는 것의 기준
// 상자」) — 치워지는 작업에 셸을 새로 열 길도 함께 막힌다. 머리 카드의 ⋯는
// 진행 중 `disabled`이고 우클릭 메뉴도 안 열려(`useWorkMenuFlows`의 `busy`) 다시 같은 조작을 겨눌 수 없다. 사이드바는 덮지 않는다 —
// 막이 서는 것은 본문이 보여 주는 work의 조작일 때뿐이다(위 `lifecycle`).
function LifecycleOverlay({ verb, detail }: { verb: string; detail: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-30 flex items-center justify-center bg-surface/80 backdrop-blur-[2px]"
    >
      <div className="flex flex-col items-center gap-2">
        {/* 판 1의 Spinner다 — 앱에 스피너가 한 가지만 있다(스토리 92). 크기와 색은 그대로다(S15). 이 막이
            이미 `status`이고 상태를 글로 말하므로 **겉 상자**를 가린다 — 안 가리면 「불러오는 중」이 한 번 더 읽힌다.
            움직임을 끄면 멈춘 원이 선다(부품이 가른다). */}
        <Spinner aria-hidden className="size-6 text-accent" />
        <span className="mt-1 text-heading-xs">{verb} 중…</span>
        <span className="text-chat-meta text-fg-tertiary">{detail}</span>
      </div>
    </div>
  );
}

// 머리 카드의 상태 배지 + 바꾸는 라디오 메뉴(판 3, 스토리 46~48 · 51 · 52 · codex-ds 스토리 25).
//
// **메뉴 부품(`DropdownMenu`)이 다 한다** — 여닫이, 줄 옮기기(↓/↑가 끝에서 돈다 · Home/End · 글자 치기),
// Esc 닫기와 배지로 포커스 돌려주기, 바깥 누르기가 닫기만 하는 것(S9). 배지가 「메뉴를 연다」와
// 「열렸다/닫혔다」를 말하고(`aria-haspopup` · `aria-expanded`), 지금 상태는 `menuitemradio`의
// `aria-checked`로 읽힌다. 고르면 닫힌다(라디오 항목의 `closeOnClick`, S33).
//
// 배지는 **배지 모양 그대로다**(P8 — Badge로 옮기지 않는다). 트리거가 제 버튼을 그리므로 모양은 상태 모듈의
// 배지 한 벌(`STATUS_BADGE`)을 부른다 — 아카이브 머리 · 호버 카드의 배지와 같은 모양이다. 창을 끌지 않는다 — 머리 카드의 빈 자리는
// 끌지만 버튼이라 Tauri가 끌기에서 뺀다(`Frame`의 `HeadCard`).
function StatusMenu({ work }: { work: WorkView }) {
  const setStatus = useSetWorkStatus();
  const meta = STATUS_META[work.status];

  return (
    <DropdownMenu>
      {/* 도움말 「상태 변경」은 툴팁이다. 배지의 이름은 지금 상태(라벨)라, 도움말이 이름보다 더 말하던 것 — 이것이 상태를
          바꾸는 자리라는 것 — 은 설명(`aria-description`)으로 남긴다(S28). */}
      <Hint
        text="상태 변경"
        announce="description"
        render={
          <DropdownMenuTrigger
            className={cn(STATUS_BADGE, "transition-[filter] hover:brightness-95 focus-ring", meta.badgeClass)}
          />
        }
      >
        {meta.label}
        <ChevronDown className="size-3 text-fg-tertiary" strokeWidth={SMALL_GLYPH_STROKE} />
      </Hint>
      <DropdownMenuContent>
        {/* work 메뉴의 상태 ▸와 같은 한 벌이다 — 값이 바뀔 때만 부른다(`StatusRadioItems`). */}
        <StatusRadioItems status={work.status} onChange={(status) => setStatus.mutate({ slug: work.slug, status })} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// 머리 카드의 ⋯ — work 메뉴(codex-ds 결정 16 · 스펙 §6). 무엇을 어떤 차례로 보이는지는 메뉴 정의(`WorkMenuItems`)가 들고, 그 항목이
// 부르는 동작과 아카이브 · 삭제의 흐름은 `work-menu-actions.ts` 한 자리다 — 우클릭 메뉴 셋(사이드바 행 · 띠 줄 · 머리 카드 이름)이 같은
// 흐름을 받는다(codex-ds 결정 6). 여기 남는 것은 ⋯의 몫이다: 열림과 닫힌 뒤 포커스가 갈 자리. 「이름 바꾸기」는 머리 카드 이름의
// 제자리 고치기를 켠다(`onRename` — 고치는 중인지는 화면이 쥔다).
//
// **메뉴 부품(`DropdownMenu`)이 다 한다**(판 3, 스토리 46~48) — 여닫이, 줄 옮기기(↓/↑가 끝에서 돈다 ·
// Home/End · 글자 치기), 하위 메뉴 열고 닫기(→ · ←), Esc 닫기와 ⋯로 포커스 돌려주기, 바깥 누르기가 닫기만 하는 것(S9).
// 항목은 `menuitem`이다. ⋯가 「메뉴를 연다」와 「열렸다/닫혔다」를 말한다(`aria-haspopup` · `aria-expanded`).
// 창을 끌지 않는다 — 머리 카드의 빈 자리는 끌지만 버튼이라 Tauri가 끌기에서 뺀다(`Frame`의 `HeadCard`).
function WorkMenu({
  work,
  flows,
  processing,
  onRename,
}: {
  work: WorkView;
  flows: WorkMenuFlows;
  /** 도는 아카이브 · 삭제가 **이 work의 것이다** — 그때만 ⋯가 `aria-busy`다(아래 `busy`와 다르다). */
  processing: boolean;
  /** 「이름 바꾸기」 — 머리 카드 이름을 그 자리에서 고치기 시작한다. */
  onRename: () => void;
}) {
  // 열림을 여기서 든다 — ⋯의 켜짐(`toggle-on`)이 그것을 그린다.
  const [open, setOpen] = useState(false);
  // **「이름 바꾸기」로 닫혔나** — 그때는 메뉴가 닫히며 포커스를 ⋯로 돌리지 않는다(`finalFocus`). 머리 카드 이름 자리에 막 선 입력칸이
  // 포커스를 받는데, ⋯로 돌아가면 입력칸이 곧바로 blur되어 「다른 곳 = 저장」으로 닫힌다(구현 노트 Q7). 그 밖의 닫힘은 부품의
  // 기본값이 ⋯로 돌린다. 확인 창(`askDanger`)은 앱 루트의 한 자리가 그려 ⋯를 모르지만, 그 창이 닫히면 부품의 기본값이 여기로 온다 —
  // 열기 전 자리(메뉴 항목)가 사라졌으면 그 앞에 포커스가 있던 자리로 간다(Base UI의 포커스 기록). L3가 잰다.
  const renamed = useRef(false);
  // 아카이브 · 삭제가 도는 동안은 ⋯가 꺼진다 — **어느 work의 조작이든**, 어느 메뉴에서 불렀든 같다(흐름의 `busy` — 바쁨은 앱
  // 하나다). 그런데 「바쁘다」(`aria-busy`)는 이 work이 치워지는 중일 때만 말한다(`processing`) — 사이드바에서 다른 work을
  // 아카이브하는 동안 이 ⋯가 바쁘다고 하면 이 work이 바뀌는 중이라고 읽힌다.
  const busy = flows.busy;

  // 다른 작업으로 옮겨가면 닫는다 — 열어 둔 채 전환하면 메뉴가 살아남아 **화면에 보이는
  // 것과 다른 작업**을 겨눈다.
  //
  // **이 이펙트가 그 일을 한다** — 이 메뉴는 공용 틀의 머리 카드에 서서(codex-ds 스펙 §6) 작업을 옮겨도 다시 세워지지 않는다.
  // 한때 머리행이 key={slug}인 SpecViewer 안에 있어 문서 탭에서는 리마운트가 먼저 닫았고, 이 줄은 터미널 탭에서만 일했다.
  useEffect(() => {
    setOpen(false);
  }, [work.slug]);

  // 메뉴 항목이 부르는 것 — 이 work을 겨눈 흐름 한 벌이다. 이름 바꾸기만 화면에 고치기를 켜 달라고 한다.
  const actions = flows.actionsFor(work, () => {
    renamed.current = true;
    onRename();
  });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* 도움말은 툴팁이고 이름과 같은 글자다. **처리 중에는 툴팁이 없다**(S23) — 버튼이 `disabled`이고, 옛 「처리
          중이에요」는 버튼이 포인터를 안 받고 가림막이 머리를 덮어 뜬 적이 없다. 무엇이 도는지는 이 work의 조작이면
          가림막(`LifecycleOverlay`)이 말하고, 다른 work의 조작이면 이 화면에서는 아무것도 말하지 않는다 — ⋯가 꺼져
          있을 뿐이고, 끝은 그 work이 목록에서 사라지거나(성공) 「…하지 못했습니다」 창이 서는 것(실패)으로 보인다. */}
      <Hint
        text="작업 메뉴"
        announce="name"
        disabled={busy}
        render={
          <DropdownMenuTrigger
            disabled={busy}
            aria-busy={processing}
            // **작은 아이콘 버튼 규격이다**(`icon-button-xs` — 24) — 세로선 너머 분할 토글(`Toggle`의 icon-xs 크기)과 같은 상자다.
            // 위 줄에 서는 것은 모두 24다(DS `HeadCard`) — 한 줄의 아이콘 버튼 상자가 다르면 하나만 튀어 보인다.
            // icon-button-quiet을 쓰지 않는 것은 켜짐이 있어서다 — quiet-hover는 꺼진 가지 안에만 둔다.
            className={cn(
              "icon-button icon-button-xs transition-colors focus-ring",
              "disabled:pointer-events-none disabled:opacity-50",
              open ? "toggle-on" : "text-fg-tertiary quiet-hover",
            )}
          />
        }
      >
        {/* 진행 표시는 여기가 아니라 본문을 덮는 LifecycleOverlay가 한다 — 14px 글리프의
            깜빡임은 워크트리 제거가 도는 수 초 동안 "눌리긴 했나"에 답하지 못했다.
            disabled는 그대로 둔다: 오버레이가 뜨기 전 한 프레임을 막는 것도 이 속성이다. */}
        <MoreHorizontal className="size-3.75" />
      </Hint>
      <DropdownMenuContent
        finalFocus={() => {
          if (!renamed.current) return true;
          renamed.current = false;
          return false;
        }}
      >
        <WorkMenuItems work={work} actions={actions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default WorksPage;
