import { memo, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Copy, CopyX, File, FileCode, FolderOpen, Pencil, Plus, SquareTerminal, X, type LucideIcon } from "lucide-react";
import { agentMarkOf } from "@/components/ui/agent-mark";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  openMenuByKey,
} from "@/components/ui/context-menu";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { InlineRename } from "@/components/ui/inline-rename";
import { Hint } from "@/components/ui/tooltip";
import { SIGNAL_LABEL, signalTint, subagentLabel } from "@/components/shell/shell-signal";
import { everyFrame } from "@/lib/frame-loop";
import { pressed as isHotkey } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { codeTabNames } from "./code-tab-names";
import ShellPicker from "./ShellPicker";
import { runningSubagents, signalOf } from "./shell-attention";
import {
  activeIdOf,
  atCap,
  bundleOf,
  placeHint,
  runningOn,
  type ShellPlace,
  shellCapNotice,
  shellEndLabels,
  shellNameTail,
  shellRowName,
  shellsOf,
} from "./shell-registry";
import type { BundleTab, Shell, ShellOwner, ShellsState } from "./shell-registry";
import { gapLineLeft, sidewaysIntent, stripEdgeStep, tabGap } from "./tab-gap";
import type { TabStripGeometry } from "./tab-gap";

/**
 * 탭 줄 맨 앞에 고정으로 서는 문서 칸(결정 7·8).
 *
 * `on`은 **본문이 문서인가**이지 마지막으로 누른 칸이 아니다 — 분할이면 이것과 `showing`이
 * 함께 참이고, 그때 켜진 칸이 둘이다(결정 12).
 */
export interface SpecTab {
  on: boolean;
  onSelect: () => void;
  /** spec 탭 메뉴의 「Finder에서 열기」 — 그 work의 spec 폴더를 연다(codex-ds 스펙 §9). */
  onOpenFolder: () => void;
  /** spec 탭 메뉴의 「spec 경로 복사」 — 그 work의 spec 경로를 참조 표기로 쓴다(codex-ds 스펙 §9). */
  onCopyPath: () => void;
}

/**
 * 칸을 누른 순간 — 자리와, 끌기를 걸지 가를 것(누른 버튼 · ⌃). 우클릭과 macOS의 ⌃클릭은 메뉴의 몸짓이라 끌기를 안 건다(구현 노트 Q9).
 * 화면에 내려가는 것은 자리뿐이다(`onDragTab`).
 */
interface TabPress {
  clientX: number;
  clientY: number;
  button: number;
  ctrlKey: boolean;
}

/**
 * `spec` **바로 뒤에** 서는 고정 칸 하나(three-axes 결정 9 · S21) — 화면이 목록으로 넘긴다. `chat` 탭이 이 자리에 선다.
 *
 * **묶음의 칸이 아니라서 셸 칸의 성질을 하나도 안 갖는다.** 숫자 키를 받지 않고(⌘1은 `spec`, ⌘2~9는 묶음 — 번호는 묶음의
 * 칸끼리만 센다), 분할에 들지 않고(끄는 자리가 없다 — 분할은 늘 `spec ▏ 묶음의 지금 탭`), 순서를 바꾸지 않고, `×`가 없다. 모양과 켜짐을
 * 말하는 법은 `spec` 칸 그대로다.
 *
 * `id`는 칸의 `data-tab` 값이다 — `spec` · `shell` · `code`(파일 탭) · `new`는 이 줄이 이미 쓰므로 고르지 않는다. 묶음에 칸
 * 종류가 늘면 그 표식도 여기 더한다. 글리프는 값으로 받는다: 이 줄은 `features/works`를 모른다(머리말).
 */
export interface FixedTab {
  id: string;
  label: string;
  icon: LucideIcon;
  /** 본문이 이 칸의 것인가 — `spec`의 `on`과 같은 뜻이다. */
  on: boolean;
  onSelect: () => void;
}

interface ShellTabsProps {
  /**
   * **앱 전체 상태다 — 이 줄의 것만 걸러서 받지 않는다.** 좁혀 받으면 `owner`가 뜻을
   * 잃는다: 이 줄은 그 값으로 그릴 칸도 고르고 **켜진 칸도** 찾는데(`activeIdOf`),
   * 그것들은 소유자별 표를 앱 전체 상태에서 읽는다. 상한은 이제 화면마다이고
   * (결정 23) `atCap`이 `owner`를 함께 받아 이 화면만 센다.
   */
  state: ShellsState;
  /**
   * 이 줄이 그리는 화면 — work의 slug이고, **빈 글자 `""`면 최상위 터미널**이다. `null`이라는
   * 갈래는 없다.
   *
   * **이 파일에서 `null`은 다른 뜻이다.** 아래 `spec`의 `null`은 「문서 칸이 없다」,
   * `onDragTab`의 `shellId === null`은 「그 문서 칸」이다 — 최상위 터미널과는 상관이 없다.
   * 부르는 쪽(WorksPage)의 `null`은 또 「고른 작업이 없다」이고, 그 화면은 셸이 설 자리가
   * 아예 없어 이 줄을 세우지 않는다.
   */
  owner: ShellOwner;
  /** 이 Work의 프로젝트들. 둘 이상이면 `+`가 어디에 띄울지 물어본다(결정 24). */
  projects: string[];
  /**
   * 맨 앞에 고정으로 서는 `spec` 칸 — **`null`이면 셸부터 선다**(결정 8).
   *
   * **화면마다 갈리는 것이 이 한 칸뿐이다.** `shellForNav`가 `firstKey`로 같은 비대칭을
   * 이미 들고 있다: work 화면은 ⌘1이 spec이라 셸이 2부터고, `/terminal`은 문서가 없어
   * 1부터다. 여기서 갈래를 하나 더 만들지 않고 그 모양을 그대로 받는다.
   *
   * `on`은 **본문이 문서인가**이지 마지막으로 누른 칸이 아니다 — 분할이면 이것과 아래
   * `showing`이 함께 참이고, 그때 켜진 칸이 둘이다(결정 12).
   */
  spec: SpecTab | null;
  /**
   * `spec` 바로 뒤에 서는 고정 칸들(`FixedTab`) — 넘긴 순서대로 선다. **선택이다**: `/terminal`처럼 넘길 것이 없는
   * 화면은 안 준다. 빠뜨려도 조용히 망가지는 것이 없어서다 — 끄는 콜백을 필수로 둔 까닭(아래 `onDragTab`)과 반대다.
   */
  fixed?: readonly FixedTab[];
  /**
   * **본문이 이 화면의 묶음을 보여주는가** — 셸이든 파일 탭이든 묶음의 지금 탭이 본문에 서 있는가. 켜진 칸 표시를 그때만 준다.
   *
   * `activeIdOf`는 그 화면의 **기억**이지 지금 본문이 아니다 — 문서를 읽는 중에도 값이
   * 남아 있어서, 그것만 보고 칸을 켜면 「지금 보고 있는 것」이 한 화면에 둘이 된다.
   * 사이드바 셸 목록이 걷히기 전까지 같은 이름의 prop이 같은 것을 갈랐다.
   */
  showing: boolean;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  /**
   * 셸 탭의 이름을 사람이 붙인 이름으로 바꾼다(codex-ds 스펙 S7). 빈 글자면 붙인 이름을 걷어 원래 이름으로 돌아간다. 메모리에만 있다 —
   * 부르는 쪽이 터미널 스토어의 `renameShell`을 준다.
   */
  onRename: (id: number, name: string) => void;
  /** 셸 탭 메뉴의 「다른 셸 모두 닫기」(codex-ds 스펙 S8) — 부르는 쪽이 `closeOtherShells`를 준다. */
  onCloseOthers: (id: number) => void;
  /**
   * 셸 탭 메뉴의 「작업 폴더 경로 복사」 — 그 셸이 뜬 폴더(`cwd`)를 받는다. **없으면 그 줄이 안 선다** — Terminal의 셸은 데이터 루트에서
   * 떠 「작업 폴더」가 없다(구현 노트 Q10).
   */
  onCopyCwd?: (cwd: string) => void;
  /**
   * 이 화면의 **기본 자리**의 cwd(⌘T가 여는 곳 — UI개선 결정 19). 메뉴의 「모든 프로젝트」 옆에 그
   * 마지막 마디가 옅게 보인다(UI개선 결정 20). 자리를 정하는 것은 여전히 화면이고 이 줄은 글자만 읽는다.
   */
  defaultCwd: string | null;
  /**
   * 새 셸을 연다. 묻지 않는 `+`는 언제나 `default`로 부른다 — 프로젝트가 0·1개면 기본 자리와
   * 「안 고른」 자리가 같다(UI개선 스펙 §11).
   */
  onOpen: (place: ShellPlace) => void;
  /**
   * 칸을 눌렀다 — 끌기를 걸어 둔다(UI개선 결정 11 · 결정 12). 문턱을 넘으면 끄는 중이 되고, 떨군 곳이
   * 정한다: work 화면의 본문 절반이면 분할, 이 줄의 틈이면 순서(UI개선 스펙 S10).
   *
   * 맨 앞 문서 칸은 `null`, 묶음의 칸(셸 칸 · 파일 탭)은 그 칸의 id다. **갈래를 새로 만들지 않는다** —
   * `DragSource`가 `shellId`로 이미 그 둘을 가르고 있고(「묶음의 칸일 때만 있다」)
   * 여기서 그 타입을 이름으로 부를 수 없을 뿐이다. 묶음의 칸이 셸인지 파일 탭인지는 id로 부르는 쪽이
   * 레지스트리에서 찾는다(`onSelect` · `onClose`와 같다).
   *
   * **두 화면 다 준다 — 필수다.** 한때 `/terminal`은 이 콜백을 안 줘서 안 끌렸다(떨굴 분할이
   * work 화면의 것이었다). 이제 그 화면도 순서를 바꾸려고 끌므로(UI개선 결정 11) 선택으로 두면
   * 한 화면이 빼먹어도 컴파일되고 조용히 안 끌린다.
   *
   * **드래그 모듈도 스토어도 여기서 import하지 않는다.** 이 줄이 스스로 하는 것은 누른 동안
   * 제 칸 사각형을 재고 포인터 아래 틈 번호를 셈하는 데까지다 — 끌기를 거는 것, 틈을 적는 것,
   * 놓았을 때 옮기는 것은 스토어를 이미 구독하는 화면이 준다. 제스처는 기능 폴더 밖 `@/lib/pointer-drag`에 살아 두 화면 다 딛는다.
   */
  onDragTab: (shellId: number | null, from: { clientX: number; clientY: number }) => void;
  /**
   * 끄는 동안 틈 선을 세울 자리 — 드래그 상태의 틈 번호를 화면이 그대로 내린다. `null`이면
   * 선이 없다. 번호는 **이 줄 묶음 칸들 사이**의 것이다(0이 첫 칸 앞, 곧 `spec` 뒤).
   */
  slot: number | null;
  /**
   * 포인터가 이 줄 위에서 가리키는 틈을 알린다(`null`이면 틈이 아닌 자리). **묶음 칸을 누른
   * 동안에만** 부른다 — 문턱을 넘었는지는 받는 쪽(드래그 상태)이 안다.
   */
  onSlot: (slot: number | null) => void;
  /** 이 줄 위에서 손을 뗐다. 받는 쪽이 드래그 상태의 틈을 읽어 옮긴다(틈이 없으면 아무것도). */
  onDropSlot: () => void;
  /**
   * **끄는 중인가** — 문턱을 넘었고 Esc로 거두지 않았다. 드래그 상태의 `source`를 화면이 그대로 내린다.
   *
   * 줄 가장자리 자동 스크롤(`stripEdgeStep`)이 이것을 본다. 누른 순간부터 구르면 칸 하나 폭 상자의 칸을
   * **클릭만 해도** 줄이 굴러 버린다 — 문턱은 드래그 모듈만 알고 이 줄은 그 모듈을 안 딛어서(`onDragTab`
   * 계약) 값으로 받는다. 틈 알림은 받는 쪽(`hoverSlot`)이 거르지만 스크롤은 이 줄이 스스로 하는 일이다.
   */
  dragging: boolean;
  /**
   * 오른쪽 끝에 **고정되는** 조작(결정 10). 탭은 왼쪽부터 차므로 탭 개수가 변해도 이것들의
   * 자리가 안 움직인다.
   *
   * 무엇이 오는지는 화면이 정한다 — work 화면은 분할의 터미널 열에서 그 열을 닫는 `×`를 두고(codex-ds 스펙 S14),
   * 그 밖에서는 아무것도 안 둔다. 상태 배지 · ⋯ · 분할은 이 줄이 아니라 머리 줄에 선다(`WorksPage`).
   */
  actions?: React.ReactNode;
  /** 검사가 이 줄을 정체성으로 집는 표식(분할 열 머리의 `data-column`) — 줄의 머리 상자에 그대로 단다. */
  [mark: `data-${string}`]: string | undefined;
}

// 본문 카드 머리의 **가로 탭 줄**(결정 7·8·10). `[spec][고정 칸…][묶음…][+]`가 왼쪽부터 차고 오른쪽 끝에
// 조작이 고정된다. 셸을 고르는 자리가 사이드바 가지에서 화면 안으로 되돌아온 것이다(adr-03).
// 고정 칸은 화면이 넘기는 `FixedTab`이다(three-axes 결정 9) — 숫자 키를 안 받아 아래 순서의 셈에 안 든다.
// **묶음**(CONTEXT)은 스크롤 상자 안의 칸들이고 그 차례는 레지스트리가 든다(`bundleOf`) — 셸 칸과 **파일 탭** 칸이 구분선 없이
// 한 차례로 선다(git-integration 결정 31). 파일 탭의 표시(이름 · 툴팁)는 칸이 든 정체에서 나온다 — 이 줄이 따로 받지 않는다.
//
// **새 순서를 발명하지 않는다.** ⌘1~9가 이미 이 순서를 세고 있어서(work 화면은 ⌘1이 spec,
// ⌘2~9가 묶음 — `shell-registry.ts`의 `shellForNav`) 이 줄이 하는 일은 키보드가 이미 아는
// 순서를 눈에 보이게 하는 것뿐이다. 화면에 보이는 순서와 ⌘1~9가 고르는 것이 어긋나면
// 이 줄이 한 일이 없다.
//
// **이 줄이 본문 카드의 머리다**(codex-ds 스펙 §4 「탭 줄」 · DS `TabRow`). 한때 창 맨 위 줄(`<header>` — 지금의 머리 줄)에 서던 줄이
// 그 탭이 보여 줄 카드 안 맨 위로 내려왔다 — 문서 카드 · 터미널 카드 · 분할의 터미널 열 · `/terminal`의 카드가 이 줄을
// 머리로 인다(`head`). 머리 상자(46 · 아래 0.5px 선 · 안쪽 8)를 이 컴포넌트가 그리고 `data-tab-row`를 단다 — 그 줄을 이는
// 카드의 바닥(`panel-layout`의 `TAB_ROW_CARD`)과 e2e(`tab-row.ts`)가 그 표식으로 줄을 가른다. 카드 안이라 창을 끄는 자리가
// 아니다 — 끄는 자리는 크롬 맨 위 머리 줄 하나다(`ShellHeadRow` · `Frame` 머리말).
//
// **칸은 Tab으로 다닌다**(codex-ds 스펙 §9 — 목록이 아니라 roving이 없다). spec 칸 · 고정 칸 · 셸 칸과 파일 탭의 이름 · 닫기 · `+`가
// 저마다 정류장이고 `tabIndex`를 명시한다 — WebKit의 Tab은 `tabindex` 없는 버튼에 서지 않는다(`@/lib/roving` 머리말).
//
// **셸도 xterm도 여기 없다** — 상태와 콜백만 받는 그림이라 DOM 없는 기본 환경에서
// renderToStaticMarkup으로 그대로 검사된다(ShellTabs.test.tsx). terminal-store를 import하면
// 그 성질이 사라진다: `@xterm/*`와 그 CSS가 따라 들어온다. 구독은 화면(WorksPage)이 한다 —
// 사이드바 목록도 같은 계약을 지고 있고(`SidebarWorkList.test.tsx`가 리터럴로 센다), 걷힌
// 셸 목록·가지도 그랬다.
function ShellTabs({
  state,
  owner,
  projects,
  defaultCwd,
  spec,
  fixed = [],
  showing,
  onSelect,
  onClose,
  onRename,
  onCloseOthers,
  onCopyCwd,
  onOpen,
  onDragTab,
  slot,
  onSlot,
  onDropSlot,
  dragging,
  actions,
  ...marks
}: ShellTabsProps) {
  // 상한도 그리는 것도 **이 화면**의 것이다(결정 23). 두 값이 같은 상태에서 같은 범위로
  // 나오는 것이 결정 30의 전부다.
  const full = atCap(state, owner);
  // 상자에 서는 것은 **묶음의 칸**이고 그 차례 그대로다. 셸 칸이 그릴 데이터는 셸 목록에서 id로 찾는다.
  const tabs = bundleOf(state, owner);
  const shellsById = new Map(shellsOf(state, owner).map((shell) => [shell.id, shell]));
  // 파일 탭 칸의 이름 — 열린 파일 탭끼리 겹치면 상위 폴더가 붙는다(S11). 회차마다 새로 내도 칸에 내려가는 것은 글자라
  // (`folder`) `memo` 경계가 안 어긋난다.
  const codeNames = codeTabNames(
    tabs.filter((tab): tab is Extract<BundleTab, { kind: "code" }> => tab.kind === "code"),
  );
  const activeId = activeIdOf(state, owner);

  // 칸에 내려보내는 콜백을 **회차를 넘어 같은 것으로** 만든다(#140). `ShellTab`이 `memo`라
  // 여기서 회차마다 새 화살표를 주면 그 경계가 아무것도 안 막는다 — 부르는 쪽(WorksPage)이
  // `onSelect`·`onDragTab`을 인라인 화살표로 주는데, 그 자리를 고치는 대신 이 줄이 계약을
  // 진다: 콜백이 안정적이어야 한다는 것은 **이 컴포넌트의 성질**이지 부르는 쪽이 기억해야
  // 할 규칙이 아니고, 규칙으로 두면 다음에 인라인 화살표 하나가 조용히 되돌린다.
  //
  // 최신 값을 ref로 읽는다. 이것들은 **이벤트에서만** 불리므로(클릭·포인터) 그리는
  // 중에 읽히지 않고, 따라서 지난 회차의 클로저가 남지 않는다.
  //
  // **틈 알림도 여기서 한 번 만든다**(UI개선 스펙 §6). 줄 자체는 `memo`가 아니지만
  // 콜백 묶음이 두 자리가 되면 다음 콜백이 어느 쪽에 붙을지가 갈리고, 칸에 내려가는 쪽이
  // 화살표로 새면 경계가 조용히 죽는다.
  const latest = useRef({ onSelect, onClose, onRename, onCloseOthers, onCopyCwd, onDragTab, onSlot, onDropSlot });
  latest.current = { onSelect, onClose, onRename, onCloseOthers, onCopyCwd, onDragTab, onSlot, onDropSlot };
  const draggingNow = useRef(dragging);
  draggingNow.current = dragging;
  const tabIds = useRef<number[]>([]);
  tabIds.current = tabs.map((tab) => tab.id);

  // 묶음 칸을 누른 동안의 줄 기하(`tab-gap.ts`). **누를 때 한 번 재고** 손을 떼면 버린다 —
  // 움직일 때마다 재면 포인터 이동마다 레이아웃을 읽고, 버리지 않으면 다음에 문서 칸을
  // 끌 때 옛 기하로 틈이 선다.
  //
  // **같은 값을 두 곳에 둔다 — 읽는 쪽이 둘이라서다.** 틈 선은 그리는 중에 읽으므로 상태
  // (`geometry`)에서 읽고 — ref를 그리는 중에 읽으면 선이 서는지가 다시 그려진 순서라는
  // 우연에 걸린다 — 포인터 이벤트는 회차를 넘어 같은 핸들러 묶음에서 읽으므로 ref(`pressed`)
  // 에서 읽는다(위 `latest`와 같은 방향). 둘을 바꾸는 자리는 아래 `press` 하나다.
  const [geometry, setGeometry] = useState<TabStripGeometry | null>(null);
  const pressed = useRef<TabStripGeometry | null>(null);
  // 누른 칸의 id — 줄이 바뀌면 이것으로 **다시 잰다**(아래 효과). 기하만 들면 `from`이 옛 줄의 번호라
  // 새 줄에서 그 칸이 몇 번째인지 되찾을 길이 없다.
  const pressedId = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  // 누른 동안 탭 줄 위 포인터의 뷰포트 x(줄을 벗어나면 `null`)와, 가장자리 자동 스크롤의 프레임.
  // 포인터가 **가만히 있어도** 구르므로 이동 이벤트가 아니라 프레임에서 굴린다(아래 `onDragTab`).
  const pointerX = useRef<number | null>(null);
  // 누른 자리와, 그 뒤 **옆으로 끌 뜻**이 한 번이라도 보였는가(`tab-gap`의 `sidewaysIntent`). 뜻이 보이기
  // 전에는 가장자리여도 안 구른다 — 본문 절반으로 곧장 내려가는 손이 탭 줄을 지나며 줄을 밀지 않게.
  // 한 번 보이면 끌기 끝까지 붙든다 — 끝에 붙여 가만히 있는 손도 굴러야 한다.
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const sideways = useRef(false);
  const stopScroll = useRef<(() => void) | null>(null);
  useEffect(() => () => stopScroll.current?.(), []);
  const press = (id: number | null, next: TabStripGeometry | null) => {
    pressedId.current = next ? id : null;
    pressed.current = next;
    setGeometry(next);
  };

  // **끄는 도중 줄의 묶음이 바뀌면 기하를 다시 잰다.** 누를 때 잰 칸 사각형과 `from`은 그 순간의
  // 목록에 매여 있다 — 칸 하나가 스스로 빠지거나(결정 48) ⌘T로 하나가 서면 줄이 흘러, 옛 기하로 셈한
  // 틈은 선이 선 자리와 놓았을 때 `moveShell`이 옮기는 자리가 어긋난다(`isInPlaceGap`이 지키려던 약속).
  // 사이드바 행 끌기는 같은 자리에서 끌기를 거둔다(UI개선 스펙 S8) — 탭은 **남의 칸이 빠졌으면 거두지
  // 않고 다시 잰다**: 이 줄은 스토어도 드래그 모듈도 안 부르고(아래 `onDragTab` 계약), 순서가 메모리에만
  // 있어(UI개선 결정 12) 끌기를 살려도 잃을 것이 없다. **끄는 셸 자신이 빠졌으면 끌기는 거둬진다** — 그
  // 판정은 이 줄이 아니라 터미널 스토어의 구독(`hasShell` 옆)이 한다. 셸이 사라지는 길이 이 줄이 안 서
  // 있을 때도 있어서다. 여기서는 기하가 `null`이 되어 틈이 안 설 뿐이다.
  //
  // 이미 적힌 틈은 옛 줄의 번호라 **지운다** — 포인터가 안 움직인 채 떼면 그 번호로 옮긴다.
  const idSequence = tabIds.current.join(",");
  useEffect(() => {
    const id = pressedId.current;
    if (id === null) return;
    press(id, measureStrip(stripRef.current, tabIds.current.indexOf(id)));
    latest.current.onSlot(null);
  }, [idSequence]);

  const tabHandlers = useMemo(
    () => ({
      onSelect: (id: number) => latest.current.onSelect(id),
      onClose: (id: number) => latest.current.onClose(id),
      onRename: (id: number, name: string) => latest.current.onRename(id, name),
      onCloseOthers: (id: number) => latest.current.onCloseOthers(id),
      onCopyCwd: (cwd: string) => latest.current.onCopyCwd?.(cwd),
      onDragTab: (id: number | null, from: TabPress) => {
        // **오른쪽 버튼 · ⌃가 실린 누름은 끌기가 아니다**(구현 노트 Q9) — 메뉴를 여는 몸짓이다. 걸어 두면 메뉴를 연 손이 움직이는
        // 대로 문턱을 넘어 끄는 중이 된다. 문서 칸도 같은 거름을 지난다.
        if (from.button !== 0 || from.ctrlKey) return;
        // 문서 칸은 순서에 안 낀다 — 줄 기하를 안 재고 화면에 그대로 건넨다(그 칸의 주석).
        if (id === null) {
          latest.current.onDragTab(null, from);
          return;
        }
        const measured = measureStrip(stripRef.current, tabIds.current.indexOf(id));
        press(id, measured);
        if (measured) {
          // **이 정리는 끌기가 아니라 누름의 것이다** — 끄는 중 표시와 드래그 상태는 제스처
          // (`armDrag`)가 한 곳에서 걷고, 여기서 버리는 것은 이 줄이 잰 자기 칸 사각형뿐이다.
          // 수명도 다르다: Esc로 끌기를 걷어도 손은 아직 눌린 채라 기하는 뗄 때까지 산다
          // (그 사이의 틈 알림은 `hoverSlot`이 끄는 중이 아니라서 버린다).
          //
          // 창에서 듣는다 — 줄 밖(본문 · 사이드바)에서 떼도 버려야 한다. 줄 위에서 떼면
          // 아래 `onSlotDrop`이 먼저 받는다(요소가 창보다 먼저 버블을 받는다).
          // **가장자리 자동 스크롤** — 끄는 중이고(`dragging`) 옆으로 끌 뜻이 보였고(`sideways`) 포인터가 줄
          // 가장자리 띠나 그 너머(같은 탭 줄)에 있으면 프레임마다 굴리고, 굴렀으면 가만한 포인터 아래의 틈을 다시 알린다. 기하는 다시
          // 안 잰다 — 내용 좌표라 그 순간의 `scrollLeft`만 더하면 된다(`tab-gap.ts` 머리말).
          stopScroll.current?.();
          pointerX.current = null;
          pressedAt.current = { x: from.clientX, y: from.clientY };
          sideways.current = false;
          stopScroll.current = everyFrame(() => {
            const strip = stripRef.current;
            const at = pressed.current;
            const x = pointerX.current;
            if (!strip || !at || x === null || !draggingNow.current || !sideways.current) return;
            const step = stripEdgeStep(at.view, x);
            if (step === 0) return;
            const before = strip.scrollLeft;
            strip.scrollLeft = before + step;
            if (strip.scrollLeft !== before) latest.current.onSlot(tabGap(at, x, strip.scrollLeft));
          });
          const drop = () => {
            stopScroll.current?.();
            stopScroll.current = null;
            pointerX.current = null;
            pressedAt.current = null;
            sideways.current = false;
            press(null, null);
            window.removeEventListener("pointerup", drop);
            window.removeEventListener("pointercancel", drop);
          };
          window.addEventListener("pointerup", drop);
          window.addEventListener("pointercancel", drop);
        }
        latest.current.onDragTab(id, from);
      },
      onSlotMove: (event: { clientX: number; clientY: number }) => {
        const strip = stripRef.current;
        if (!pressed.current || !strip) return;
        pointerX.current = event.clientX;
        const origin = pressedAt.current;
        if (origin && sidewaysIntent(origin, { x: event.clientX, y: event.clientY })) sideways.current = true;
        latest.current.onSlot(tabGap(pressed.current, event.clientX, strip.scrollLeft));
      },
      onSlotLeave: () => {
        pointerX.current = null;
        if (pressed.current) latest.current.onSlot(null);
      },
      onSlotDrop: () => {
        if (pressed.current) latest.current.onDropSlot();
      },
    }),
    [],
  );

  // 프로젝트가 여럿인 Work에서만 `+`가 묻는다.
  const asks = projects.length > 1;
  // 꽉 찼을 때만 선다 — 잠긴 이유다(아래 `PlusButton`).
  const capNotice = full ? shellCapNotice(state, owner) : null;

  // 줄이 넘치면 **켜진 칸이 화면 밖에 있을 수 있다**(결정 20). ⌘1~9는 안 보이는 칸도
  // 고르므로(`shellForNav`는 폭을 모른다) 고른 칸이 안 보이면 「눌렀는데 아무 일도 없다」로
  // 읽힌다. 넘치지 않는 폭에서는 아무 일도 안 하는 호출이다.
  //
  // 켜진 칸을 **속성 하나를 새로 만들지 않고** 집는다 — 이름 버튼의 `aria-pressed`가 이미
  // 그것을 말하고, 이 상자 안에서 참인 것은 하나뿐이다(분할일 때 함께 켜지는 `spec`은
  // 이 상자 밖에 산다). 칸의 종류를 안 가리므로 묶음의 어느 칸이 켜져도 같은 줄이 돈다.
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>('button[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, showing]);

  return (
    // 머리 상자 — DS `.at-toolbar`다(`size-toolbar` 46 · 칸 사이 4 · 안쪽 8 · 아래 0.5px `border-heavy` 선). 선은 테두리가
    // 아니라 바닥에 붙인 0.5px 면이다 — 0.5px 테두리는 엔진마다 굵기가 갈리고(`SpecViewer`의 가름선과 같은 손버릇), 면이라 줄
    // 높이 46 안에 선다. 바탕은 흰 면(`surface`)이다 — 터미널 카드의 바탕은 터미널 테마를 따라 어두울 수 있는데(`Frame`의
    // `Card`), 칸 글자는 앱 토큰이라 그 위에서 묻힌다. 머리는 앱의 것이고 그 아래가 셸의 면이다.
    //
    // **끄는 동안 이 줄이 틈 소비자다**(UI개선 스펙 S10). **줄 전체**에서 듣는 것은 높이 때문이다 — 스크롤 상자는 칸
    // 높이(28px)에 링 자리(4px씩)만 더한 높이라 46px 줄의 위아래를 조금만 벗어나도 틈이 꺼진다. 가로는 상자 밖이면 틈이
    // 아니다(`tabGap`). 본문 받침(놓기 겹판)은 이 줄 아래부터 덮으므로(`WorksPage`) 두 소비자가 겹치지 않는다. 줄 위에서 떼면
    // 이 듣기가 창의 듣기(`drop` · 제스처의 `end`)보다 먼저 받는다 — React는 앱의 뿌리 요소에서 듣고, 그 요소가 창보다
    // 먼저 버블을 받는다.
    <div
      {...marks}
      data-tab-row
      onPointerMove={tabHandlers.onSlotMove}
      onPointerLeave={tabHandlers.onSlotLeave}
      onPointerUp={tabHandlers.onSlotDrop}
      className="relative flex h-(--size-toolbar) shrink-0 items-center gap-1 bg-surface px-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[0.5px] after:bg-border-heavy"
    >
      {/* 맨 앞 고정 칸. **`×`가 없다**(결정 7) — 문서로 돌아가는 자리가 셸 개수와 무관하게
          고정된다. ⌘W가 여기서 아무 일도 안 하는 것(결정 13)이 같은 말이다.

          닫는 버튼이 없어 칸이 버튼 하나로 끝나므로 켜짐 표시(`tab-on`)와 그것을 말하는
          속성(`aria-pressed`)이 **같은 요소**에 붙는다. 아래 셸 칸은 형제 버튼 둘이라
          그럴 수 없다 — 그쪽 주석이 이유를 든다.

          글리프는 한때 사이드바에 있던 `spec` 줄이 쓰던 `File` 그대로다 — 판 04가 그 줄을
          걷어(결정 6) 지금은 이 칸이 문서를 고르는 유일한 자리다. 라벨이 소문자 영어인 것은
          CONTEXT.md다 — 「무엇을 볼까」를 고르는 것들(탭 줄 · 레일 칸)의 한 가족이다. */}
      {spec && <SpecTabButton spec={spec} onDragTab={tabHandlers.onDragTab} />}

      {/* `spec` 뒤의 고정 칸들(three-axes 결정 9). **묶음 상자 밖, 세로선 앞이다** — 상자 안에 들면 켜진 칸 `scrollIntoView`
          · 틈 번호 · 줄어드는 몫이 이 칸까지 세어 묶음 칸의 셈이 밀린다. 모양과 켜짐은 `spec` 칸 그대로이고(결정 25 — 같은
          알약, 안 줄어든다) **`onPointerDown`이 없다**: 분할에 들지 않고 순서에도 안 낀다(`FixedTab`). */}
      {fixed.map((tab) => (
        <button
          key={tab.id}
          type="button"
          data-tab={tab.id}
          aria-pressed={tab.on}
          tabIndex={0}
          onClick={tab.onSelect}
          className={fixedTabClass(tab.on)}
        >
          <tab.icon className={fixedGlyphClass(tab.on)} />
          <span className="min-w-0 truncate">{tab.label}</span>
        </button>
      ))}

      {/* `spec`와 묶음 **사이**의 세로선(결정 25). 말하는 것은 「여기서부터 묶음이다」 하나다 —
          왼쪽은 고정된 칸(`spec`과 그 뒤 칸들)이고 오른쪽은 스크롤하는 상자(묶음)다. 종류가 다르다는 말은 위 칸의
          바탕이 따로 한다.

          **고정 칸(`spec` · 그 뒤 칸들)이 있을 때만 선다.** `/terminal`에는 그 칸이 없어(결정 8) 가를 것이 없는데,
          조건 없이 두면 그 화면에서 줄 맨 앞에 이유 없는 선 하나가 남는다. */}
      {(spec || fixed.length > 0) && (
        <span
          aria-hidden
          data-tab-rule
          // 좌우 2px이다 — 줄의 gap 4px과 합쳐 8px씩 벌어진다. 더 벌리면 **900px 창에서 줄이
          // 넘친다**(결정 20의 산술이 이 선까지 센다: mx-1이면 1px 모자랐다, 실측).
          className="mx-0.5 h-[18px] w-px shrink-0 bg-border-heavy"
        />
      )}

      {/* 묶음의 칸만 **가로로 스크롤한다**(결정 20). `spec`·`+`·조작은 이 상자 밖이라 자리가
          고정이고, 줄이 넘치는 몫은 이 상자 하나가 받는다 — 형제가 모두 `shrink-0`이고
          여기만 줄어들 수 있어서다. 그래서 **탭 줄 자체는 넘치지 않는다**: 조작이
          창 밖으로 밀려나던 것이 그것 때문이었다.

          칸은 그 전에 먼저 균등하게 줄어든다(결정 11). 스크롤은 여덟 칸이 다 최소 폭에
          닿은 **뒤**의 마지막 수단이고, 거기서 더 줄일 것이 없는 이유는 산술이다 —
          여덟 칸이 최소 폭이어도 `44×8 + gap 28 = 380`이고, 그 옆에 자리가 고정된 것들
          (`spec` · 세로선 · `+` · 조작 · 줄 사이 gap · 좌우 안쪽)이 이어 선다.
          **줄의 폭은 창 폭이 아니다** — 이 줄을 머리에 인 카드의 폭이라 창에서 사이드바 · 열린 작업 패널(분할이면 옆
          열까지) · 레일 열(칸이 둘 이상일 때만 선다)을 뺀 나머지다. 창이 더 작아질 수 없는 900px에서는 여덟 칸이 어떤 최소 폭으로도
          안 들어간다.

          **그래도 칸 하나는 늘 온전히 보인다 — 이 상자 안쪽의 바닥이 칸 하나(44px)다.** 한때
          `min-w-0`이라 바닥이 없었고, 900px 창에 작업 패널이 열린 기본 배치에서 줄이 290px을
          받자 넘치는 몫을 이 상자가 전부 받아 **0px이 됐다** — 칸이 화면에 없어 누를 수도 끌
          수도 없었다(v0.13.0부터). 바닥이 서도 줄이 넘치지 않는 것은 이 줄을 이는 카드가 그
          바닥까지 안 줄기 때문이다(`panel-layout`의 `TAB_ROW_CARD`) — 자리를 내주는 것은 작업 패널(제 최소 폭까지),
          그다음 사이드바다.

          **바닥은 폭(`w-[52px]`)으로도 적는다** — 칸의 `min-w-[44px]`에 양옆 링 자리(아래 — 4씩)를 더한
          수다. 그 카드가 버틸 폭은 이 줄의 min-content인데, 그
          계산은 flex가 줄인 폭이 아니라 각 항목이 **적어 둔 폭**을 센다 — 늘 넓게 서는 기준은
          그래서 `w-max`가 아니라 `basis-[max-content]`에 둔다. `w-max`로 두면 카드의 바닥이
          칸 여덟의 폭(380)이 되어 좁은 창에서 패널을 필요 이상으로 민다. 칸이 없으면 바닥도
          없다 — 빈 44px이 `+` 앞에 서면 안 된다.

          **합을 여기 숫자로 안 적는다.** 이 자리에 손으로 더한 수가 세 번 적혔고 세 번 다
          틀렸다(569 → 657 → 685 — 항을 빠뜨리거나 더했다 다시 뺐다). 줄이 받는 폭은
          `e2e/terminal-tabs.spec.ts`가 화면·창 폭·패널 배치마다 실제로 재고 `spill ≤ 0`과
          「칸 하나가 들어간다」로 든다.

          **링이 설 자리를 둔다**(`focus-ring-room`, codex-ds 결정 11). 구르는 상자는 넘침을 자르므로 칸에 붙은 포커스 링
          (테두리 바깥 4px)도 자른다 — 여백이 없으면 칸 높이(28)가 곧 상자 높이라 링의 위아래가, 첫 칸의 왼쪽과 끝 칸의
          오른쪽이 잘린다. 상자가 안쪽에 4px을 두고 같은 만큼 바깥으로 물러나 칸의 자리와 줄의 산술은 그대로이고, 상자의
          테두리 상자만 사방 4px 크다(바닥이 52인 까닭). 굴러서 칸을 들일 때도 그 4px을 남긴다(`scroll-px-1`).

          **막대는 저장소 공통 `scroll-quiet`이다**(결정 32). 한때 여기만 손으로 숨겼다 —
          그때의 `scroll-quiet`은 11px을 세워 44px 타이틀바에서 칸을 눌렀기 때문이다.
          이제 막대가 위로 떠서 폭을 안 먹으므로 이 줄만 다른 규칙을 쓸 이유가 없어졌다. */}
      <div
        ref={stripRef}
        // 표식이 `data-tab`이 아니라 `data-tab-strip`인 것은 검사가 `data-tab="`로 칸을
        // 잘라내기 때문이다 — 같은 이름을 쓰면 상자가 칸 하나로 세어진다.
        data-tab-strip
        // `relative`는 아래 틈 선의 기준이다 — 스크롤 상자 안의 절대 위치라 선이 칸과 함께 흐른다.
        className={cn(
          "relative flex basis-[max-content] items-center gap-1 overflow-x-auto scroll-quiet focus-ring-room scroll-px-1",
          tabs.length > 0 ? "w-[52px] min-w-[52px]" : "w-0 min-w-0",
        )}
      >
        {tabs.map((tab) => {
          if (tab.kind === "code") {
            return (
              <CodeTab
                key={tab.id}
                tab={tab}
                folder={codeNames.get(tab.id)?.folder ?? null}
                active={showing && tab.id === activeId}
                onSelect={tabHandlers.onSelect}
                onClose={tabHandlers.onClose}
                onDragTab={tabHandlers.onDragTab}
              />
            );
          }
          // 셸 칸이 가리키는 셸은 늘 셸 목록에 있다(레지스트리가 둘을 한자리에서 더하고 뺀다) — 없으면 그 칸을 안 그린다.
          const shell = shellsById.get(tab.id);
          return (
            shell && (
              <ShellTab
                key={tab.id}
                shell={shell}
                active={showing && tab.id === activeId}
                // 끝난 칸까지 센다 — 「다른 셸 모두 닫기」가 걷는 것이 그 칸들 전부다(구현 노트 Q11). 파일 탭은 안 센다 — 그
                // 메뉴가 닫는 것은 셸뿐이다(`closeOtherShells`).
                others={shellsById.size > 1}
                onSelect={tabHandlers.onSelect}
                onClose={tabHandlers.onClose}
                onRename={tabHandlers.onRename}
                onCloseOthers={tabHandlers.onCloseOthers}
                // 화면이 안 주면 그 줄이 안 선다(Terminal — 구현 노트 Q10). 주면 늘 같은 값이다.
                onCopyCwd={onCopyCwd && tabHandlers.onCopyCwd}
                // 회차를 넘어 같은 값이라 `memo`의 얕은 비교가 이 자리에서 안 어긋난다.
                onDragTab={tabHandlers.onDragTab}
              />
            )
          );
        })}
        {/* 끄는 동안 놓일 틈(UI개선 스펙 §6). **절대 위치 세로 선**이다 — 폭을 먹으면 칸이 밀리고
            좁은 창에서는 상자가 칸 하나 폭까지 줄어 있다(위 상자 주석). 높이는 이 상자(칸 28 + 링 자리 4씩) 안이다 —
            위아래 8px씩 들어와 칸 가운데 20px에 선다. 스크롤 상자라 세로로 넘치면 줄이 세로 스크롤을 얻는다. 좌우 끝도 상자
            밖으로 안 나간다(`gapLineLeft`).

            기하는 누른 순간 잰 **상태**다 — 그리는 중에 ref를 읽지 않는다(위 `geometry` 주석). */}
        {slot !== null && geometry && (
          <span
            aria-hidden
            data-tab-gap={slot}
            className="pointer-events-none absolute inset-y-2 w-px rounded-full bg-accent"
            style={{ left: gapLineLeft(geometry, slot) }}
          />
        )}
      </div>

      {/* 잠긴 이유가 툴팁(hover·포커스) 뒤에 있다. 결정 47이 세로 목록에서 그 문장을 꺼내 보이는
          글자로 쓴 것과 **같은 근거가 반대 방향을 가리킨다** — 그때의 이유는 「`+`가 행이
          되면서 글자를 넣을 폭이 생겼다」였고, 칸 하나에는 그 폭이 없다.

          work 화면에서는 그것이 유일한 통로도 아니다: ⌘T가 거절당하면 스토어가 낸 같은
          문장을 화면이 토스트로 말한다(결정 47).

          이 저장소의 잠근 버튼 관용구(disabled + pointer-events-none)를 쓰지 않는다 —
          네이티브 `disabled`에는 툴팁을 달지 않고(S23), pointer-events-none은 hover 자체를 막아
          **그 툴팁이 안 뜬다**. aria-disabled + 클릭 무시다. 메뉴를 여는 `+`도 같다 — 잠겼으면
          메뉴가 여는 것만 막는다(`ShellPicker`의 `locked`). */}
      {asks ? (
        // 프로젝트를 묻는 `+`는 여는 버튼이 아니라 메뉴를 여는 버튼이다 — 눌렀는데 셸이 안 뜨는 것이
        // 정상인 유일한 경우라, 그 사실이 속성에 드러나야 한다. 그 속성(`aria-haspopup="menu"`·
        // `aria-expanded`)은 메뉴 부품의 트리거가 단다.
        <ShellPicker
          trigger={<PlusButton notice={capNotice} />}
          locked={full}
          projects={projects}
          defaultHint={placeHint(defaultCwd)}
          onPick={onOpen}
        />
      ) : (
        <PlusButton
          notice={capNotice}
          onClick={() => {
            if (!full) onOpen({ kind: "default" });
          }}
        />
      )}

      {/* 오른쪽 끝 조작 — 조작이 있을 때만 선다(지금은 분할의 터미널 열을 닫는 `×` 하나 — `WorksPage`). 앞의 빈 자리가
          탭과 조작 사이의 남는 폭을 먹어 조작을 줄 끝에 붙이고, `min-w-4`는 칸이 꽉 찼을 때도 `+`와 조작이 맞붙지 않게
          남기는 값이다. 조작이 없는 줄에는 빈 자리도 없다 — 줄의 바닥(min-content)에 쓸모없는 16px이 들지 않게.

          조작이 여럿이면 그 사이는 DS 툴바의 4다(`.at-toolbar` — 줄 안 칸 사이와 같은 값). 한때 셸 컨트롤 간격
          (`--titlebar-control-gap`)을 빌렸는데, 그 값은 창 컨트롤의 Codex 값(2)이 되어 이 줄의 것이 아니다. 지금은 `×` 하나라
          그 간격이 드러나지 않는다. */}
      {actions && (
        <>
          <span className="min-w-4 flex-1" />
          <div data-tab-actions className="flex shrink-0 items-center gap-1">
            {actions}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 고정 칸(`spec` · 그 뒤 칸들 — `FixedTab`)의 알약. **두 자리가 한 규격이다** — 한쪽만 손보면 같은 줄의 고정 칸이 둘로 갈린다.
 *
 * **이 칸은 안 줄어든다**(결정 20). 고정 탭이라 이름이 `spec` 넉 자로 고정이고, 줄일 것이 애초에 없다 — 그런데 `shrink`가
 * 살아 있으면 넘칠 때 flex가 **폭에 비례해서** 깎아, 좁은 칸(66px)과 셸 칸(180px)이 나란히 6할씩 잃는다. 그러면 이 칸이
 * 글리프도 못 담는 27px가 되면서 정작 셸 칸은 73px로 멀쩡하다. 줄어드는 것을 셸 칸 여덟으로 몰아 두는 것이 「균등」이
 * 성립하는 조건이다.
 *
 * **셸 칸과 같은 알약이다**(결정 25). 눌린 자리(`bg-inset` + 테두리)로 종류를 가르는 안은 실물에서 접었다 — 그 칸만 규격이
 * 갈리면 줄에서 튄다. 「다른 종류」는 옆의 세로선 하나가 말한다.
 *
 * **높이 · 모양 · 켜짐 · 글자색은 DS `.at-tab`이다**(codex-ds 스펙 §4 「탭 줄」 · 결정 27) — 28px · `radius-lg` ·
 * `chat-meta`이고, 켜진 칸은 옅은 면에 `fg`(`tab-on` — `fill-hover`)다. 꺼진 칸의 글자는 `fg-secondary`이고 가리키면
 * `fg`다. 글리프는 한 단 흐리다(`.at-tab .ic` — 꺼짐 `fg-tertiary` · 켜짐 `fg-secondary`, `fixedGlyphClass`).
 */
function fixedTabClass(on: boolean): string {
  return cn(
    "flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-lg pl-2 pr-2.5 text-chat-meta transition-colors focus-ring",
    on ? "tab-on font-medium" : "text-fg-secondary hover:bg-fill-soft hover:text-fg",
  );
}

function fixedGlyphClass(on: boolean): string {
  return cn("size-3.5 shrink-0", on ? "text-fg-secondary" : "text-fg-tertiary");
}

/**
 * 탭 줄의 `+` — 셸 열기. **묻는 `+`(메뉴 트리거)와 바로 여는 `+`가 같은 버튼이다** — 갈리는 것은 누를 때
 * 하는 일뿐이다.
 *
 * 도움말은 앱 툴팁이다(스토리 112). **꽉 찼으면(`notice`) 툴팁이 잠긴 이유를 말하고**, 그 문장은
 * 설명(`aria-description`)으로도 남는다 — 툴팁은 스크린리더에 아무것도 주지 않는다(S28). 이름은 늘 「셸 열기」다.
 *
 * 메뉴를 여는 `+`에서는 메뉴 트리거가 이것을 제 버튼으로 그린다(`ShellPicker`의 `render`) — 그래서 받은 속성
 * (ref와 여닫는 손잡이까지)을 툴팁 트리거에 그대로 편다. 툴팁 트리거가 그 둘을 합쳐 버튼 하나에 단다.
 */
function PlusButton({
  notice,
  className,
  ...props
}: ComponentProps<"button"> & { notice: string | null }) {
  const full = notice !== null;
  return (
    <Hint
      text={notice ?? "셸 열기"}
      announce={full ? "description" : undefined}
      type="button"
      data-tab="new"
      aria-label="셸 열기"
      aria-disabled={full || undefined}
      tabIndex={0}
      className={cn(
        // 탭들에 **바짝 붙는다**. 줄의 gap 4px에 이 버튼의 좌우 여백 5px이 더해져 마지막
        // 칸의 `×`와 15px이 벌어지는데, 그 거리가 이 버튼을 탭의 꼬리가 아니라 따로 선
        // 조작으로 읽히게 한다(크롬의 `+`는 마지막 탭에 붙어 있다). 0으로 붙이지 않는
        // 것은 상자가 스크롤 중일 때 잘린 칸과 맞닿아 보이기 때문이다.
        //
        // 켜짐이 없는 아이콘 버튼이라 hover는 아이콘 버튼의 hover(`quiet-hover` — `fill-hover` 한 겹 · 글자 `fg`)이고, 누를
        // 때도 같은 면이다(ui-refresh 결정 18). 손으로 같은 조합을 다시 적지 않는다(`state-scale` 검사).
        //
        // `relative`는 칸 상자 **위에** 서려는 것이다. 칸 상자는 링이 설 자리(`focus-ring-room`)만큼 테두리가 바깥으로
        // 나와 있고 제가 `relative`라 위치 잡힌 층에 그려지는데, 그 테두리가 이 버튼의 왼쪽 2px(위 `-ml-0.5`) 위에 걸친다 —
        // 이 버튼이 같은 층에 서지 않으면 그 2px을 누른 손을 칸 상자가 받는다.
        "relative -ml-0.5 shrink-0 text-fg-tertiary focus-ring",
        full ? "icon-button icon-button-xs opacity-40" : "icon-button-quiet icon-button-xs active:bg-fill-hover",
        className,
      )}
      {...props}
    >
      <Plus className="size-3.5" />
    </Hint>
  );
}

interface ShellTabProps {
  shell: Shell;
  /** 본문이 지금 이 셸을 보여주는가. 켜진 칸 표시가 그때만 선다. */
  active: boolean;
  /** 이 화면에 다른 셸 칸이 있는가 — 없으면 「다른 셸 모두 닫기」가 흐리다(구현 노트 Q11). */
  others: boolean;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onRename: (id: number, name: string) => void;
  onCloseOthers: (id: number) => void;
  /** 없으면 메뉴에 「작업 폴더 경로 복사」가 없다(구현 노트 Q10). */
  onCopyCwd?: (cwd: string) => void;
  onDragTab: (id: number, from: TabPress) => void;
}

// 칸 하나. **`memo`인 것이 이 파일의 계약 하나다**(#140).
//
// 셸은 프롬프트마다 OSC 타이틀을 쏘고 `claude`는 도는 동안 계속 갈아 끼운다(adr-04).
// 그때마다 갈리는 것은 **그 셸 객체 하나**이고(`patch`가 안 바뀐 셸에는 같은 객체를 준다),
// 화면의 구독은 `sameScreen`가 이미 남의 work을 걸러 낸다. 남은 마지막 한 겹이 여기다 —
// 이 경계가 없으면 한 칸의 타이틀 한 번에 여덟 칸의 그림이 전부 다시 돈다.
//
// **비교는 기본 얕은 비교다.** 직접 쓴 비교 함수는 콜백을 빼고 보게 되는데, 그러면 칸이
// 예전 회차의 클로저를 쥔 채 남는다. 대신 부르는 쪽이 회차마다 새 화살표를 줘도 되도록
// `ShellTabs`가 콜백을 한 번만 만들어 내려보낸다(`tabHandlers`).
const ShellTab = memo(function ShellTab({
  shell,
  active,
  others,
  onSelect,
  onClose,
  onRename,
  onCloseOthers,
  onCopyCwd,
  onDragTab,
}: ShellTabProps) {
  // 결정 18. 이름을 정하는 자리는 앱에서 이 함수 하나다 — 프로젝트가 여럿인 work에서만
  // 앞에 프로젝트가 붙으므로 대부분의 칸은 타이틀만 적는다. 셋 중 하나를 **골라서**
  // 적던 `shellLabel`은 되살리지 않는다: 타이틀이 오는 순간 어느 워크트리의 셸인지가
  // 사라지는 실물 사고를 냈고 사용처가 0이 되어 지워졌다(결정 104).
  const name = shellRowName(shell);
  const end = shellEndLabels(shell);
  // 결정 4 — **탭 줄은 칸마다**다. 여기서 줄 단위로 뽑으면 한 칸이 claude를 켜는 순간 모든 칸이
  // 갈린다. 판정도 표도 새로 짓지 않는다: 「끝난 칸은 아무것도 안 돈다」는 `runningOn`
  // 하나가 알고(`shell.running`을 직접 읽으면 죽은 칸에 로고가 굳는다), 이름→그림은
  // `agentMarkOf` 하나가 안다 — Processes의 셸 행과 갈리면 같은 상태가 두 말을 한다.
  const running = runningOn(shell);
  const mark = agentMarkOf(running);
  // **물들임의 값도 칸마다다**(결정 6). 판정은 `signalOf` 하나이고 — 행도 띠도 알림도 그
  // 함수를 딛는다 — 여기서 다시 짓지 않는다. 「안 본 완료」가 이 칸을 켜는 순간 사라지는
  // 것도 그 함수 안에 있다: 「봤다」가 세워지면 `signalOf`가 아무것도 안 돌린다.
  const signal = signalOf(shell);
  const tint = signal === null ? null : signalTint(signal, active);
  // **눈과 귀가 같은 조건에서 선다**(스토리 52·55). 이름에 붙는 상태 말이 채움과 갈리면
  // 도는 중인 칸이 아무 색도 없이 귀에만 「도는 중」을 말한다 — 그래서 `tint`가 없으면
  // 이름도 조용하다.
  const spoken = signal !== null && tint !== null ? SIGNAL_LABEL[signal] : null;
  // **접근성 이름을 한 자리에서 조립한다.** `aria-label`은 자손 글자를 통째로 대체하므로,
  // 여기에 상태만 적으면 이름이 숨는 폭에서만 서는 아래 마크 마디(「claude 실행 중」)가 그
  // 폭의 접근성 이름에서 **사라진다** — 그 마디가 있는 이유가 「글리프가 `aria-hidden`이라
  // 도는 칸이 눈에만 보인다」인데 하필 부르는 칸에서만 그것을 잃는다. 그래서 도는 것도
  // 여기서 함께 싣는다. `undefined`면 라벨 자체가 없고 그때는 보이는 글자가 이름이 된다.
  const spokenName =
    spoken === null
      ? undefined
      : [name, mark && `${mark.label} 실행 중`, spoken].filter(Boolean).join(" — ");
  // **「도는 중 · 서브에이전트 N」은 이름표의 툴팁에 선다**(프로세스 스펙 S32). 턴이 멈췄는데 서브에이전트가 도는
  // 셸은 부르지 않으므로(도는 중) 띠에도 행에도 그 사실이 안 선다 — 사람이 「왜 아직 도나」를 물을 자리가 여기다.
  // 수는 레지스트리 쪽 함수가 낸다(`runningSubagents` — 죽은 칸 가리개를 딛는다). 도는 중은 채움도 이름 꼬리도
  // 없으므로(스토리 52) 접근성 이름이 아니라 **툴팁**이고, 0이면 아무것도 없다. 툴팁은 앱의 것(`Hint`)이고, 이름보다
  // 더 말하는 글자라 설명(`aria-description`)으로도 남는다(`sidebar-active-band` S28 — 옛 `title`이 이름 다음에 읽히던 몫).
  const tooltip = subagentLabel(runningSubagents(shell));
  // **셸 탭 메뉴**(codex-ds 스펙 §9)와 **이름 고치기**(S7)는 칸마다의 상태다 — 칸 하나의 일이라 줄이 들 까닭이 없고, 칸이 `memo`라
  // 줄에서 들면 한 칸의 메뉴를 열 때 여덟 칸이 다시 그려진다.
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const cell = useRef<HTMLDivElement>(null);
  // 「이름 바꾸기」로 닫혔나 — 그때는 메뉴가 포커스를 탭에 돌려주지 않는다. 막 선 입력칸이 쥐어야 한다(돌려주면 곧바로 blur되어
  // 「다른 곳 = 저장」으로 닫힌다 — `WorkContextMenu`와 같은 까닭).
  const renamed = useRef(false);
  const nameButton = () => cell.current?.querySelector<HTMLElement>("button[aria-pressed]") ?? null;
  const cwd = shell.cwd;

  return (
    // **칸 상자가 메뉴의 대상이다**(codex-ds 결정 6 · 11). 우클릭은 칸 어디서든(이름 · `×`) 이 셸의 메뉴이고, 열린 동안 칸 전체에 대상
    // 테두리(`focus-ring`의 `[data-menu-target]`)가 선다 — 이름 버튼에만 세우면 `×`가 테두리 밖에 남아 「어느 칸의 메뉴인가」가 반쪽이 된다.
    // ⇧F10 · 메뉴 키는 이름 버튼이 받아(`openMenuByKey`) 그 자리에 우클릭 사건을 내고, 그 사건이 이 상자로 올라와 같은 메뉴를 연다.
    //
    // **Root가 감싸는 것은 이 칸 하나다.** Root의 문맥은 그 아래 모든 메뉴로 새어 들어가서(포털을 건너서도), `+`(셸 고르기)나 줄 전체를
    // 감싸면 그 메뉴들이 이 Root에 붙는다.
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger
        ref={cell}
        // **고치는 동안은 물러선다** — 칸 안의 우클릭이 이름 입력칸의 편집 메뉴다(`EditMenu`, 티켓 31). 제 처리를 건너뛰어 사건을 멈추지
        // 않으므로 document까지 올라가 편집 메뉴가 연다. 입력칸 밖(`×`)의 우클릭도 그 사이엔 열지 않는다 — 셸 탭 메뉴가 서면 포커스가
        // 메뉴로 가 입력칸이 「메뉴에 갔다」로 기다리는데, 그 메뉴의 줄들은 고치는 이름과 상관이 없다.
        onContextMenu={(event) => {
          if (editing) event.preventBaseUIHandler();
        }}
        render={
          // 배경(켜짐·hover)은 이 바깥 상자가 갖는다. **가로 여백을 하나도 갖지 않는다** —
          // 바깥이 가진 padding은 두 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도 아무
          // 일이 없는 죽은 자리가 된다(커밋 c0978b1이 spec 트리에서 없앤 것).
          //
          // hover는 **꺼진 가지 안에만** 둔다. 켜진 칸의 옅은 면(`tab-on`)은 hover에 안 바뀌는데(DS `.at-tab.is-on:hover`),
          // 꺼진 칸의 hover를 함께 얹으면 배경 규칙이 두 벌이 되어 승자를 유틸리티 정렬 순서가 정한다(index.css의 경고) —
          // 지면 켜진 칸이 가리킬 때마다 꺼진 칸의 면으로 옅어진다.
          // 꺼진 칸의 hover가 `fill-soft`(1)이고 `fill-hover`(2)가 아닌 것은 2가 **켜진 칸의** 농도라서다(DS `.at-tab:hover` ·
          // `.at-tab.is-on`) — 꺼진 칸을 2로 밝히면 「켜짐」으로 읽힌다.
          //
          // **폭을 이름이 정하지 않는다**(결정 20). 칸마다 같은 폭을 주고 넘칠 때도 그 값에서
          // 깎이게 둔다 — flex가 넘친 폭을 기준 폭에 비례해 나누므로, 기준이 같으면 여덟 칸이
          // **같은 만큼** 줄어든다. 내용 폭으로 두면 이름이 긴 칸만 넓어지고,
          // 그보다 나쁜 것은 셸이 프롬프트마다 쏘는 OSC 타이틀에 칸 폭이 매달린다는 것이다 —
          // claude가 도는 동안 줄 전체가 계속 들썩인다.
          //
          // **`basis-[180px]`이 아니라 `w-[180px]`이다** — 이 칸이 `@container`라서다(실측).
          // `container-type: inline-size`는 「폭을 속으로 정하지 않는다」는 격리라, 이 칸의
          // 내재 폭이 0으로 계산되고 `min-w`만 남는다. 스크롤 상자가 그 내재 폭을 더해 제
          // 폭을 잡으므로, 기준을 `flex-basis`로만 주면 상자가 `44×칸수`로 잡혀 **칸이 늘
          // 최소 폭에 붙는다**(한 칸일 때도 44px였다). `width`로 주면 폭이 정해진 값이라
          // 격리와 무관하게 서고, flex는 그것을 기준으로 깎는다.
          //
          // 폭의 세 수(44·68·88)는 **잰 값이다.** 한때 한 뺄셈에서 나왔다 — 이름 버튼 좌우
          // 여백 14 + 로고와 스피너 30 + 닫기 24 — 그런데 결정 27이 그 자리에서 스피너를
          // 걷었으므로 이제 그 산술로는 안 나온다. 수를 다시 뽑지 않고 둔 것은 이 폭들이
          // 실물에서 확인된 값이라서다. 다음에 폭을 만질 일이 생기면 그때 다시 잰다. **여기가 바닥이고 그 아래는 스크롤이다**(결정 20) — 한때
          // 이 자리에 「여덟 칸이 최소 폭이어도 900px 창에 여유가 남는다」고 적혀 있었는데,
          // 그것은 창 폭을 잰 것이었다. 이 줄이 받는 폭은 창에서 사이드바를
          // 뺀 나머지다(위 스크롤 상자 주석의 산술).
          //
          // `@container`가 **칸마다 자기 폭을 재게** 한다. 줄을 재면 안 되는 것은 한
          // 칸의 폭이 줄 폭이 아니라 `줄 폭 ÷ 칸 수`이고 칸 수를 CSS가 모르기 때문이다.
          // `container-type: inline-size`가 내용으로 폭을 정하는 길을 막지만 여기서는 손해가
          // 아니다 — 이 칸의 폭은 이미 flex가 정한다.
          <div
            data-tab="shell"
            // 셸 키(프로세스 스펙 S34)는 화면에 뜨지 않는 말이라 글자가 아니라 표식으로만 선다 — spawn 응답 전이면 없다.
            data-shell-key={shell.shellKey ?? undefined}
            // 메뉴가 열린 동안만 서는 대상 표식 — `focus-ring`이 그것을 포커스 링과 같은 테두리로 그린다(위 머리말).
            data-menu-target={menuOpen ? "" : undefined}
            className={cn(
              // 높이 28 · `radius-lg` · 글자 `chat-meta` · 글자색은 DS `.at-tab`이다(codex-ds 스펙 §4 「탭 줄」 · 결정 27). 켜진 칸의
              // 글자는 `fg`, 꺼진 칸은 `fg-secondary`이고 가리키면 `fg`다 — 색은 아래 켜짐 · 물들임 갈래가 함께 정한다.
              "@container flex h-7 w-[180px] min-w-[44px] shrink items-center rounded-lg text-chat-meta transition-colors focus-ring",
              // 켜진 칸의 무게는 **물들어도 남는다** — 물들임이 말하는 것은 「부른다」이지 「고른
              // 칸이다」가 아니라서, 무게까지 함께 걷으면 켜진 칸을 가리는 것이 1px 테두리 하나가
              // 된다. 물들임과 무관한 사실이라 그 갈림 **밖**에 한 번만 적는다.
              active && "font-medium",
              // **채움이 이 상자에 붙는다** — 이름 버튼이 아니라. 안쪽에 두면 이름이 숨는 폭
              // (`@max-[88px]`)에서 색이 글자와 함께 사라져, 좁은 창에서 신호가 먼저 죽는다
              // (스토리 53). 상자는 늘 서 있고 늘 같은 자리다.
              //
              // **잉크는 여기 없다**(판 04 결정 15). 상자에 얹으면 안쪽이 통째로 `currentColor`로
              // 물들어 에이전트 마크까지 상태색을 받는다 — 잉크가 붙는 자리는 이름 글자 하나이고
              // 그 근거는 `signalTint` 머리말이 든다. 그래서 물든 칸도 회색 잉크를 그대로 쓴다.
              //
              // **물들면 켜짐의 면이 물러난다**(결정 6). 켜진 칸의 옅은 면(`tab-on`)까지 그렇다 —
              // 「부르는 탭」이 「고른 탭」보다 위 사실이라, 둘을 겹쳐 두면 유틸리티 정렬 순서가
              // 승자를 정하고 보고만 있는 셸이 답한 셸로 오인된다(스토리 49). 글자색은 물러나지 않는다 —
              // 물든 칸도 켜졌으면 `fg`, 꺼졌으면 `fg-secondary`다(기다리는 칸의 이름은 그 위에 잉크가 선다).
              // 물든 칸에는 hover가 없다(채움이 그 자리를 쓴다 — `ShellTabs.test`의 「물든 칸은 hover 회색을 안 얹는다」).
              tint === null
                ? active
                  ? "tab-on"
                  : "text-fg-secondary hover:bg-fill-soft hover:text-fg"
                : cn(tint.cell, active ? "text-fg" : "text-fg-secondary"),
            )}
          >
            {/* 켜짐을 `aria-pressed`로 말한다 — **`role="tab"`/`aria-selected`를 쓰지 않는다.**
                분할 중에는 켜진 칸이 둘인데(결정 12) tablist에서 selected가 둘이면 잘못된
                ARIA다. 그리고 이 저장소는 켜짐을 이미 `aria-pressed`+켜짐 면으로 말하고
                있어(분할 토글·소스 토글) 새 어휘를 들이면 화면 안에서 말이 두 벌이 된다.

                이름 버튼이 자기 오른쪽 여백까지 품는다. h-full은 칸 높이 전체가 눌리게 한다 —
                items-center는 자식을 내용 높이로 줄인다.

                gap-1.5가 글리프와 이름 사이를 벌린다(결정 4·27). */}
            {editing ? (
              // **고치는 동안 이름 버튼 자리에 입력칸이 선다**(codex-ds 스펙 S7). 버튼 안에는 입력칸을 둘 수 없어 버튼이 아닌 상자로
              // 갈아 끼운다 — 자리(이름 버튼의 왼쪽 여백 · 남는 폭)가 같아 글자와 `×`가 안 움직인다. 입력칸은 이름의 **뒤 갈래**만
              // 든다(`shellNameTail`, 구현 노트 Q8) — 앞의 `프로젝트 · `는 칸 밖에 서서 지울 수 없고, 고치는 동안에도 어느 워크트리의
              // 셸인지 보인다. 비우면 붙인 이름을 걷는다(`clear`) — 이름이 타이틀 · 셸 이름으로 돌아간다. 키로 끝내면 포커스가 다시 선
              // 이름 버튼으로 돌아온다. 입력칸 안의 누름은 칸으로 올라가지 않는다 — 칸은 누르면 켜고 끌면 옮긴다(`InlineRename`).
              //
              // 「그대로」는 보이는 꼬리가 아니라 **붙인 이름**과 견준다(`saved`). 붙인 이름이 없는 칸의 꼬리는 타이틀 · 셸 이름이라, 그
              // 글자를 손수 다시 친 저장도 붙어야 다음 프롬프트의 타이틀에 안 덮인다(S7).
              //
              // **앞말은 이 상자의 절반까지만 선다**(`max-w-1/2`). 칸은 바닥(44px)까지 주는데(결정 20), 앞말이 제 글자 폭을 다 쥐면 좁은
              // 칸에서 입력칸이 0으로 눌리고 앞말이 칸 밖으로 넘친다. 넘으면 말줄임으로 준다 — 고치는 글자가 적어도 그만큼을 쥔다.
              // 끝의 빈칸을 지키려고 `whitespace-pre`이고(줄 끝 빈칸은 접힌다), 그래서 말줄임은 `truncate`가 아니라 넘침 · 말줄임 둘이다.
              <div className="flex h-full min-w-0 flex-1 items-center pl-2 pr-1.5">
                {shell.project && (
                  <span className="min-w-0 max-w-1/2 overflow-hidden text-ellipsis whitespace-pre">{`${shell.project} · `}</span>
                )}
                <InlineRename
                  value={shellNameTail(shell)}
                  saved={shell.label ?? ""}
                  label="셸 이름"
                  emptyMeans="clear"
                  fit="fill"
                  onCommit={(next) => onRename(shell.id, next)}
                  onDone={() => setEditing(false)}
                  returnFocus={nameButton}
                  className="-ml-1 h-5 px-1"
                />
              </div>
            ) : (
              <Hint
                // 서브에이전트가 없으면 툴팁도 설명도 없다 — 트리거의 `disabled`는 툴팁만 끄고 버튼은 그대로 둔다(Base UI).
                text={tooltip ?? ""}
                announce="description"
                disabled={tooltip === null}
                type="button"
                aria-pressed={active}
                tabIndex={0}
                // **상태가 이름에 붙는다**(스토리 55 · 결정 8). 채움은 `aria-hidden`도 아니고 그냥
                // 색이라 스크린리더에 아무것도 안 남긴다 — 색만이 신호여선 안 되므로 그 사실을
                // 말하는 자리가 이 이름 하나다. 말은 `SIGNAL_LABEL` 하나에서 오고 행 버튼·띠 줄이
                // 같은 표를 읽는다.
                //
                // **`aria-label`이지 숨은 글자가 아니다** — 사이드바 행이 같은 자리에서 같은 선택을
                // 했다. 보이는 이름은 `truncate`로 줄고 좁은 폭에서는 `sr-only`로 남는데, 그 위에
                // 숨은 글자를 하나 더 얹으면 이름이 두 조각으로 읽힌다.
                aria-label={spokenName}
                // ⌃클릭은 macOS의 우클릭이다 — 메뉴를 여는 몸짓이라 켜지 않는다(구현 노트 Q9).
                onClick={(event) => {
                  if (!event.ctrlKey) onSelect(shell.id);
                }}
                // **이름을 고치는 길 셋**(codex-ds 스펙 S7) — 두 번 누르기 · F2(이 버튼이 포커스됐을 때) · 메뉴의 「이름 바꾸기」. 두 번
                // 누르기의 첫 누름은 그대로 켠다.
                onDoubleClick={() => setEditing(true)}
                // ⇧F10 · 메뉴 키는 이 칸의 메뉴를 그 이름 곁에 연다(`openMenuByKey` — 우클릭 사건을 내 칸 상자가 받는다).
                onKeyDown={(event) => {
                  if (isHotkey(event, "rename")) {
                    event.preventDefault();
                    setEditing(true);
                    return;
                  }
                  openMenuByKey(event);
                }}
                // 끄는 자리가 **이름 버튼**이다(결정 12) — 형제인 `×`가 끌리면 닫으려다
                // 분할이 켜진다. 걷히기 전 사이드바 셸 행도 같은 자리에 같은 모양으로 걸었다.
                onPointerDown={(event) => onDragTab(shell.id, event)}
                // 이름이 숨은 폭에서는 글리프를 **가운데로** 보낸다 — 왼쪽에 붙여 두면 오른쪽
                // 절반이 빈 칸으로 보여 「비었다」와 「아이콘만 남았다」가 같아진다.
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-left focus-ring @max-[88px]:justify-center"
              >
                {/* **넓은 폭에서는 글리프가 없다**(결정 27). 이름이 이미 그것을 말하기 때문이다 —
                    `claude`가 도는 칸의 타이틀이 「✳ Claude」이고, 그 옆에 같은 마크를 하나 더 세우면
                    같은 사실이 한 칸에 두 번 적힌다.

                    **이름이 숨는 폭에서만 글리프로 바뀐다.** 그 폭에서는 칸이 텅 비므로(크롬에서 그
                    일이 없는 것은 파비콘이 늘 있어서다) 무언가는 서야 하는데, 그때 세울 것이 둘로
                    갈린다: 아는 에이전트면 그 로고, 아니면 셸을 뜻하는 `SquareTerminal`이다. 두 자리가
                    같은 규칙을 쓰는 것이 「통일성」이고, 사이드바 셸 메타가 셸 수 옆에 같은 글리프를
                    쓰는 것도 그래서다(결정 4).

                    **꼬리표가 있으면 안 선다** — 죽은 칸은 그 자리를 이미 먹고 있다.

                    **색은 칸의 글자색을 물려받는다.** 이 글리프는 이름 옆에 서는 아이콘이 아니라 이름 대신 서는 것이라, DS
                    `.at-tab .ic`의 한 단 흐린 색(`spec` 칸의 `File`이 쓴다)이 아니라 이름과 같은 색이다.

                    글리프 svg가 `aria-hidden`이라(agent-mark의 계약) 이름을 따로 안 달면 도는 칸이
                    **눈에만** 보인다. 역할 없는 span의 `aria-label`은 읽히는 것이 보장되지 않아
                    `role="img"`을 함께 준다 — 넓은 폭에서는 이름 글자가 그 몫을 하므로 `sr-only`로
                    남는 이름과 겹쳐 읽히지 않게 좁은 폭에서만 이 마디가 붙는다. */}
                {!end &&
                  (mark ? (
                    <span
                      role="img"
                      aria-label={`${mark.label} 실행 중`}
                      className="hidden shrink-0 items-center @max-[88px]:flex"
                    >
                      <mark.Glyph className="size-3.5" />
                    </span>
                  ) : (
                    <SquareTerminal className="hidden size-3.5 shrink-0 @max-[88px]:block" />
                  ))}
                {/* 좁아지면 **먼저 말줄임으로 줄고**(`truncate`), 이름 몇 글자도 못 세우는 폭에서
                    자리를 비운다(결정 11). `hidden`이 아니라 `sr-only`인 것은 이름 버튼의
                    접근성 이름이 이 글자 하나라서다 — `display:none`으로 지우면 좁은 창에서 그
                    칸이 스크린리더에 「버튼」으로만 불린다. 자리는 안 먹고 이름은 남긴다. */}
                {/* **잉크가 여기 붙는다**(판 04 결정 15). 칸 상자가 아니라 이 글자 하나다 —
                    상자에 얹으면 좁은 폭의 마크가 함께 물든다(`signalTint` 머리말). 잉크는 기다리는 칸에만
                    있다 — 안 본 완료의 이름은 DS `.at-tab`대로 칸의 글자색이다(`TONE`의 `tab`). */}
                <span className={cn("min-w-0 truncate @max-[88px]:sr-only", tint?.ink)}>{name}</span>
                {/* 죽은 칸을 **누르지 않고** 알아보는 자리다(결정 17). 왜 죽었는지 한 문장은
                    그 칸을 켰을 때 종료 줄이 말한다(결정 22 그대로) — 여기 `title`로 띄우는
                    안은 기각됐다. 결정 45가 상한 문구를 `title`에서 꺼내 그 자리에 문장으로
                    쓴 것과 정면으로 어긋난다.
                    직접 선언한 색이라 칸의 글자색에 안 덮인다. */}
                {end && <span className="shrink-0 text-fg-tertiary">{end.mark}</span>}
              </Hint>
            )}
            {/* 이름 버튼의 **형제**다. 중첩 button은 HTML에서 허용되지 않고, span
                role="button"으로 흉내내면 Tab으로 도달할 수 없다(SpecTree.test.tsx가 같은
                것을 지킨다). 셸을 죽이는 길은 여전히 확인을 거치는 하나다(결정 22·92) —
                부르는 쪽이 `requestCloseShell`을 준다. */}
            <Hint
              text="셸 닫기"
              type="button"
              aria-label={`${name} 닫기`}
              onClick={() => onClose(shell.id)}
              tabIndex={0}
              className={cn(
                "icon-button-tint icon-button-xs shrink-0 text-fg-tertiary focus-ring",
                // 크롬이 하는 그대로다(결정 20) — 좁아지면 **켜진 칸에만** 닫기가 남는다.
                // 여덟 칸에 24px씩 늘 세우면 스크롤이 그만큼 일찍 시작된다.
                // 켜진 칸도 68px 아래에서는 함께 접는다: 거기부터는 글리프와 닫기가 한 칸에
                // 못 서고, 둘 중 남는 쪽은 글리프다(결정 11). 그 폭에서 닫는
                // 길은 ⌘W다(결정 13) — 새로 만드는 길이 아니라 이미 있는 길이다.
                active ? "@max-[68px]:hidden" : "@max-[88px]:hidden",
              )}
            >
              <X className="size-3" strokeWidth={SMALL_GLYPH_STROKE} />
            </Hint>
          </div>
        }
      />
      <ContextMenuContent
        finalFocus={() => {
          if (!renamed.current) return nameButton() ?? true;
          renamed.current = false;
          return false;
        }}
      >
        {/* 고치기 · 복사 — 닫기 묶음이다(codex-ds 스펙 §9). 단축키 칸은 단축키 표의 글자다 — F2는 포커스된 탭 이름이 듣고(아래 이름
            버튼), ⌘W는 켜진 셸을 닫는다(`closeShell`). */}
        <ContextMenuItem
          shortcut="rename"
          onClick={() => {
            renamed.current = true;
            setEditing(true);
          }}
        >
          <Pencil />
          <span className="min-w-0 flex-1 truncate">이름 바꾸기</span>
        </ContextMenuItem>
        {/* 그 셸이 뜬 폴더다 — 뜬 뒤 `cd`한 곳이 아니다(셸은 지금 폴더를 앱에 알리지 않는다). 해당 없는 줄은 숨긴다(구현 노트 Q10). */}
        {onCopyCwd && cwd !== null && (
          <ContextMenuItem onClick={() => onCopyCwd(cwd)}>
            <Copy />
            <span className="min-w-0 flex-1 truncate">작업 폴더 경로 복사</span>
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {/* `×` · ⌘W와 같은 닫기다 — 확인을 거치는 길 하나(결정 92). */}
        <ContextMenuItem shortcut="closeShell" onClick={() => onClose(shell.id)}>
          <X />
          <span className="min-w-0 flex-1 truncate">닫기</span>
        </ContextMenuItem>
        {/* 다른 칸이 없으면 흐리다 — 숨기지 않는다(구현 노트 Q11). 지금 못 하는 일이 메뉴에서 사라지면 그 일이 있는지도 모른다. */}
        <ContextMenuItem disabled={!others} onClick={() => onCloseOthers(shell.id)}>
          <CopyX />
          <span className="min-w-0 flex-1 truncate">다른 셸 모두 닫기</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

interface CodeTabProps {
  tab: Extract<BundleTab, { kind: "code" }>;
  /** 이름이 겹칠 때 흐리게 덧붙는 상위 폴더(`codeTabNames`). 겹치지 않으면 `null` — 이름만 선다. */
  folder: string | null;
  /** 본문이 지금 이 파일 탭을 보여주는가. 켜진 칸 표시가 그때만 선다. */
  active: boolean;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onDragTab: (id: number, from: TabPress) => void;
}

/**
 * 맨 앞 문서 칸 — **spec 탭 메뉴의 대상이다**(codex-ds 스펙 §9 · 결정 6). 메뉴는 「Finder에서 열기」 · 「spec 경로 복사」 둘이고, 셸 칸과 같은
 * 잣대다 — 커서 자리에 서고, 켜짐 · 주소는 그대로이며, 열린 동안만 이 칸에 대상 테두리(`focus-ring`의 `[data-menu-target]`)가 선다. 닫히면
 * 포커스가 이 칸으로 돌아온다.
 *
 * 제 컴포넌트인 것은 메뉴의 열림이 이 칸 하나의 상태라서다. **Root가 감싸는 것은 이 칸 하나다** — 줄을 감싸면 `+`의 셸 고르기 메뉴가 이
 * Root에 붙는다(Root의 문맥이 그 아래 메뉴로 샌다).
 */
function SpecTabButton({ spec, onDragTab }: { spec: SpecTab; onDragTab: (id: null, from: TabPress) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger
        render={
          <button
            ref={button}
            type="button"
            data-tab="spec"
            aria-pressed={spec.on}
            tabIndex={0}
            data-menu-target={menuOpen ? "" : undefined}
            // ⌃클릭은 macOS의 우클릭이다 — 메뉴를 여는 몸짓이라 문서로 가지 않는다(구현 노트 Q9).
            onClick={(event) => {
              if (!event.ctrlKey) spec.onSelect();
            }}
            // ⇧F10 · 메뉴 키는 이 칸의 메뉴를 그 곁에 연다(`openMenuByKey`).
            onKeyDown={openMenuByKey}
            // 본문 위로 끌면 그 절반에 문서가 선다(결정 12) — 사이드바의 `spec` 잎이 하던
            // 몫이 이 칸으로 왔다. **누르는 것과 끄는 것이 한 버튼에 산다**: 5px 문턱이
            // 둘을 가르므로(`armDrag`) 문턱 안쪽의 눌림은 그냥 클릭이다. 오른쪽 버튼 · ⌃가 실린 누름은 줄의 거름이 버린다.
            //
            // **순서엔 안 낀다** — 늘 맨 앞이다(UI개선 스펙 §6). 이 칸을 누르면 줄 기하를 안 재므로
            // 끄는 동안 틈이 서지 않고, 묶음 칸의 틈은 이 칸 뒤부터 센다(`tab-gap.ts`).
            onPointerDown={(event) => onDragTab(null, event)}
            // 알약의 규격은 고정 칸 한 벌이다(`fixedTabClass`) — 뒤에 서는 고정 칸들(`FixedTab`)과 갈리지 않는다.
            className={fixedTabClass(spec.on)}
          >
            <File className={fixedGlyphClass(spec.on)} />
            <span className="min-w-0 truncate">spec</span>
          </button>
        }
      />
      <ContextMenuContent finalFocus={() => button.current ?? true}>
        {/* 날 경로를 넘기지 않는다 — 경로는 백엔드가 slug로 푼다(codex-ds 스펙 S6). work 메뉴의 Finder ▸ 「spec」과 같은 길이다. */}
        <ContextMenuItem onClick={spec.onOpenFolder}>
          <FolderOpen />
          <span className="min-w-0 flex-1 truncate">Finder에서 열기</span>
        </ContextMenuItem>
        {/* 앱의 참조 표기다(끝에 `/`) — work 메뉴의 복사 ▸ 「spec 경로」와 같은 값이다. */}
        <ContextMenuItem onClick={spec.onCopyPath}>
          <Copy />
          <span className="min-w-0 flex-1 truncate">spec 경로 복사</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * **파일 탭** 칸 하나(git-integration 결정 38 — 셸 칸의 틀을 쓴다). 폭(최대 180 · 바닥 44) · 켜짐 면 · 좁아지면 이름이 글리프로
 * 물러나는 규칙 · 켜진 칸에만 남는 `×`가 셸 칸(`ShellTab`)과 같다 — 셸과 파일이 한 줄에서 같은 폭으로 줄어든다(스토리 29).
 *
 * 다른 것: 글리프 `FileCode`는 **넓은 폭에서도 선다** — 셸 칸은 이름(타이틀)이 이미 무엇이 도는지를 말해 글리프를 걷었는데
 * (결정 27), 파일 이름은 그 칸이 파일이라는 것을 말하지 않는다. 툴팁은 `<프로젝트>/<경로>`다(스토리 28). 닫기는 확인이 없다 —
 * 부르는 쪽이 그 길을 준다(스토리 37).
 *
 * **끌리는 것도 셸 칸과 같다**(결정 31 · 스토리 42) — 이름 버튼이 끄는 자리이고, 묶음의 어느 틈에나 놓인다. 틈 · 측정 · 가장자리
 * 구르기는 줄이 칸의 종류를 안 가리고 하므로(`measureStrip`) 이 칸이 하는 일은 누른 순간을 알리는 것뿐이다.
 *
 * 정체는 표식(`data-code`)으로 싣는다 — 칸 표식(`data-tab`)은 종류다(셸의 `data-shell-key`와 같은 나눔).
 *
 * 열린 파일 탭끼리 이름이 겹치면 상위 폴더가 흐리게 붙는다(S11 — `index.ts · works`). 붙은 폴더도 이름의 일부라 접근 이름과
 * `×`의 이름에 함께 든다 — `index.ts` 둘의 `×`가 같은 이름이면 화면 읽기로 어느 것을 닫는지 모른다.
 */
const CodeTab = memo(function CodeTab({ tab, folder, active, onSelect, onClose, onDragTab }: CodeTabProps) {
  const name = tab.path.slice(tab.path.lastIndexOf("/") + 1);
  const label = folder === null ? name : `${name} · ${folder}`;
  const ref = `${tab.project}/${tab.path}`;
  return (
    <div
      data-tab="code"
      data-code={ref}
      className={cn(
        "@container flex h-7 w-[180px] min-w-[44px] shrink items-center rounded-lg text-chat-meta transition-colors",
        active ? "tab-on font-medium" : "text-fg-secondary hover:bg-fill-soft hover:text-fg",
      )}
    >
      {/* 켜짐은 `aria-pressed`로 말한다 — 셸 칸과 같은 어휘다(스토리 87). */}
      <Hint
        text={ref}
        announce="description"
        type="button"
        aria-pressed={active}
        tabIndex={0}
        onClick={() => onSelect(tab.id)}
        // 끄는 자리가 이름 버튼인 것은 셸 칸과 같은 이유다 — 형제인 `×`가 끌리면 닫으려다 칸이 옮겨진다.
        onPointerDown={(event) => onDragTab(tab.id, event)}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-2 pr-1.5 text-left focus-ring @max-[88px]:justify-center"
      >
        <FileCode className={cn("size-3.5 shrink-0", active ? "text-fg-secondary" : "text-fg-tertiary")} />
        <span className="min-w-0 truncate @max-[88px]:sr-only">
          {name}
          {folder !== null && <span className="text-fg-tertiary"> · {folder}</span>}
        </span>
      </Hint>
      <Hint
        text="파일 탭 닫기"
        type="button"
        aria-label={`${label} 닫기`}
        onClick={() => onClose(tab.id)}
        tabIndex={0}
        className={cn(
          "icon-button-tint icon-button-xs shrink-0 text-fg-tertiary focus-ring",
          active ? "@max-[68px]:hidden" : "@max-[88px]:hidden",
        )}
      >
        <X className="size-3" strokeWidth={SMALL_GLYPH_STROKE} />
      </Hint>
    </div>
  );
});

/**
 * 누른 순간의 줄 기하 — 상자 안 **모든 칸**의 사각형을 **내용 좌표**(뷰포트 x + `scrollLeft`)로 잰다
 * (`tab-gap.ts` 머리말). 끄는 칸이 이 줄에 없으면(누르는 사이 빠졌다) 잴 것이 없다.
 *
 * 칸을 종류로 고르지 않는다 — 상자의 자식 중 `data-tab`을 단 것이 곧 묶음의 칸이고(틈 선은 `data-tab-gap`이라 안 걸린다),
 * 그 차례가 `from`과 틈 번호가 세는 묶음의 차례다. 종류로 고르면 셸 아닌 칸이 서는 날 번호가 그만큼 어긋난다.
 */
function measureStrip(strip: HTMLDivElement | null, from: number): TabStripGeometry | null {
  if (!strip || from < 0) return null;
  const box = strip.getBoundingClientRect();
  const tabs = [...strip.querySelectorAll<HTMLElement>(":scope > [data-tab]")].map((cell) => {
    const rect = cell.getBoundingClientRect();
    return { left: rect.left + strip.scrollLeft, right: rect.right + strip.scrollLeft };
  });
  return { tabs, view: { left: box.left, right: box.right }, from };
}

export default ShellTabs;
