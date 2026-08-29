import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@tanstack/react-store";
import {
  Archive,
  Ban,
  Check,
  ChevronDown,
  Columns2,
  Folder,
  LoaderCircle,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceToggle } from "@/components/ui/SourceToggle";
import { askDanger, showProblem } from "@/components/ui/confirm-store";
import PageHeader from "@/components/shell/PageHeader";
import { ResizeHandle } from "@/components/shell/useResizableWidth";
import useSplitRatio from "@/components/shell/useSplitRatio";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { useProjects } from "@/features/projects/hooks";
import ShellHeadName from "@/features/terminal/ShellHeadName";
import ShellTabs from "@/features/terminal/ShellTabs";
import TerminalPane from "@/features/terminal/TerminalPane";
import {
  activeIdOf,
  closesShellFromWindow,
  opensShellFromWindow,
  runningShellsOf,
  sameScreen,
  shellForNav,
  shellNavFromWindow,
  shellsEmptied,
  shellsOf,
  workShellOrigin,
} from "@/features/terminal/shell-registry";
import {
  closeShellsOf,
  onShellOpenRejected,
  openNewShell,
  requestCloseShell,
  selectShell,
  terminalStore,
} from "@/features/terminal/terminal-store";
import type { SplitSide, ViewTab } from "@/routes/-work-search";
import {
  armDrag,
  clearHalf,
  dragStore,
  dropSplit,
  hoverHalf,
  otherTab,
  specHeadLabel,
} from "./split-view";
import type { DragSource, SplitHalf } from "./split-view";
import { ignoresSourceToggle } from "./doc-refs";
import SpecViewer from "./SpecViewer";
import WorkPanel from "./WorkPanel";
import WorkMetaMenu from "./WorkMetaMenu";
import {
  useArchiveWork,
  useRemoveWork,
  useSetWorkStatus,
  useSetWorkTitle,
  useWorks,
} from "./hooks";
import { STATUS_META } from "./status";
import type { ShellsState, ShellTally } from "@/features/terminal/shell-registry";
import type { WorkStatus, WorkView } from "./types";

interface WorksPageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  // 보고 있는 문서와 그것을 옮기는 길. 둘 다 주소가 정본이라 여기서 소유하지 않는다.
  // `push`는 히스토리 항목을 만들지 여부다 — 트리는 만들지 않고 문서 링크는 만든다.
  currentFile: string | null;
  onSelectFile: (path: string, push: boolean) => void;
  onOpenProject: (slug: string) => void;
  // 보고 있는 화면 탭도 주소가 정본이다 — `currentFile`과 같은 결이다.
  tab: ViewTab;
  onSelectTab: (tab: ViewTab) => void;
  // 분할도 주소가 정본이다(결정 97). `null`이면 단일 뷰다.
  //
  // **바꾸는 콜백이 `tab`을 함께 받는다**: 열의 `×`는 분할을 끄면서 남는 쪽을 정하고
  // (결정 89), 헤더 토글은 지금 `tab`을 그대로 넘긴다. 둘을 따로 옮기면 한 틱에 겹친다.
  split: SplitSide | null;
  onSelectSplit: (split: SplitSide | null, tab: ViewTab) => void;
  // 사이드바에서 끌어다 놓은 것(결정 86). **남의 work을 떨궈도 성립해야 해서**(결정 101)
  // 이동을 여기서 하지 않고 주소를 쥔 쪽으로 넘긴다.
  onDropInto: (source: DragSource, split: SplitSide) => void;
}

// 주소가 가리키는 문서가 없을 때 대신 열 것. **이 판단이 여기로 올라왔다** — 한때
// SpecViewer의 지역 함수였는데, 작업 패널이 이 화면으로 올라오면서 트리의 "지금 이 문서"
// 표시와 본문이 **같은 값**을 봐야 하게 됐다(결정 49). 값을 정하는 지점이 둘이면 뷰 탭을
// 오갈 때마다 트리 표시가 켜졌다 꺼진다 — 1판에서 실제로 그랬다(터미널 탭에서는 폴백을
// 거치지 않은 raw 값이 내려갔다).
function defaultFile(files: string[]): string | null {
  if (files.includes("overview.md")) return "overview.md";
  return files[0] ?? null;
}

/**
 * ⌘Enter가 **작업 패널 몫인가** (결정 43).
 *
 * 앞 판은 이 판단에 `tab === "terminal"`을 얹어 두었다 — 「여는 길은 버튼 하나」(결정 35)의
 * 부산물이었는데, 패널이 이 화면으로 올라오면서 터미널 탭에서도 트리·패널에 포커스가 갈 수
 * 있게 됐다. 그 상태에서 안 듣는 것이 앞 판이 「알려진 비대칭」으로 남긴 구멍이다. 그 줄을
 * 지운다.
 *
 * **셸 안에 포커스가 있으면 여전히 셸 몫이다**(결정 29). 아래 `HTMLTextAreaElement` 가드가
 * 그것을 그대로 지킨다 — **xterm의 입력 자리가 바로 숨은 `<textarea>`**이기 때문이다
 * (`@xterm/xterm`의 `Terminal.textarea`가 `HTMLTextAreaElement`이고, 실제 요소는
 * `document.createElement("textarea")`로 만든 `.xterm-helper-textarea`다 — 둘 다 소스에서 확인함).
 * 셸이 이 키를 삼키지도 않는다: `shellHotkey`가 아는 것은 ⌘T·⌘W 둘뿐이라
 * `attachCustomKeyEventHandler`가 `true`를 돌려주고, 이벤트는 window까지 올라온다.
 *
 * **함수로 꺼낸 이유는 테스트다.** 이 저장소의 컴포넌트 seam은 정적 마크업이라 이펙트가
 * 돌지 않고 키 이벤트도 없다 — 핸들러 안에 두면 소스를 문자열로 훑는 검사밖에 못 건다.
 * 구조적 이벤트 형태를 받는 순수 함수는 `shellHotkey`가 이미 쓰는 방식이고, 그쪽과 같은
 * 이유로 여기도 그렇게 둔다.
 */
export function togglesWorkPanel(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  key: string;
  target: EventTarget | null;
}): boolean {
  if (!event.metaKey || event.shiftKey || event.altKey || event.ctrlKey || event.key !== "Enter")
    return false;
  const target = event.target as HTMLElement;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  )
    return false;
  return true;
}

/**
 * ⌘W가 겨누는 칸 — **켜진 탭**이다(결정 13). 닫을 것이 없으면 `null`이다.
 *
 * 「켜진 탭이 무엇인가」는 이 화면만 안다. 두 갈래로 `null`이 나온다:
 * - **`spec`이 켜져 있다.** 고정 탭이라 `×`가 없는 것과 같은 말이다. 분할이면 열 둘이
 *   함께 서지만 `tab`은 그때 **포커스가 든 열**을 가리키므로(결정 97의 `focusColumn`)
 *   여기서 한 번 더 가를 것이 없다.
 * - **겨눌 칸이 없다.** 고른 작업이 없거나, 그 화면의 셸이 0개인 경우다.
 *
 * `activeIdOf`를 그냥 부르지 않고 이 함수를 두는 것은 **소유자를 여기서 한 번 가르기**
 * 위해서다 — `owner`가 `null`이면 그 값은 `shellsOf`의 계약상 최상위 터미널을 가리켜,
 * 고른 작업이 없는 work 화면에서 ⌘W가 **`/terminal`의 셸을 닫는다.**
 *
 * **함수로 꺼낸 이유는 테스트다**(위 `togglesWorkPanel`과 같다). 이 저장소의 컴포넌트
 * seam은 정적 마크업이라 이펙트가 돌지 않고 키 이벤트도 없다 — 핸들러 안에 두면 소스를
 * 문자열로 훑는 검사밖에 못 걸고, 그 검사는 가드 한 줄이 뒤집혀도 초록이다(실측으로
 * 확인했다: 핸들러 첫 줄에 `return`을 얹어도 리터럴 검사가 전부 통과했다).
 */
export function shellClosedByTab(
  tab: ViewTab,
  owner: string | null,
  state: ShellsState,
): number | null {
  if (tab !== "terminal" || owner === null) return null;
  return activeIdOf(state, owner);
}

function WorksPage({
  sidebarOpen,
  selectedSlug,
  currentFile,
  onSelectFile,
  onOpenProject,
  tab,
  onSelectTab,
  split,
  onSelectSplit,
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

  // 생애주기 조작은 ⋯ 메뉴가 부르지만 **상태는 여기서 소유한다** — 진행 표시가 메뉴 하나가
  // 아니라 본문 전체를 덮기 때문이다. 메뉴 안에 두면 그 표시를 메뉴 크기 안에서만 할 수 있다.
  const archive = useArchiveWork();
  const remove = useRemoveWork();
  const running = archive.isPending
    ? { verb: "아카이빙", detail: "워크트리를 정리하고 있어요" }
    : remove.isPending
      ? { verb: "삭제", detail: "워크트리와 스펙 문서를 지우고 있어요" }
      : null;
  // 작업 패널 접기. [소스]는 그 패널 머리행으로 갔지만 **상태는 이 화면이 다시 든다** —
  // 패널이 여기로 올라오면서(결정 49) 버튼(패널)과 그것이 바꾸는 것(본문)의 공통 조상이
  // 이 화면뿐이 됐다. 아래 `showSource`가 그 자리다 (한때 SpecViewer가 들고 있었다 — 결정 6·22).
  //
  // **초기값이 분할 여부를 본다**(결정 88). `?split=lr`로 새로 뜨거나 새로고침하면 아래
  // 「켜는 순간」이 한 번도 안 도는데, 그 화면이 3열이면 결정 88이 계산한 「터미널 ≈34칸에서
  // `claude` TUI가 깨진다」가 그대로 재현된다.
  const [workPanelOpen, setWorkPanelOpen] = useState(split === null);

  // Cmd+Enter — 본문을 넓히는 토글. 원래 의미가 "콘텐츠 확대·축소"였고 대상이 목록 패널이었던 건
  // 그게 유일한 접이식이었기 때문이다. 이 화면에서 그 자리를 작업 패널이 물려받는다.
  //
  // **두 탭 모두에서 듣는다**(결정 43). 한때 여기 있던 터미널 탭 가드 한 줄 — 탭만 보고
  // 그냥 돌아가던 것 — 을 지웠다. 어느 경우가 셸 몫인지는 `togglesWorkPanel`이 혼자 알고,
  // 그 판단은 탭이 아니라 **포커스**로 갈린다. `tab`을 안 보므로 의존성도 비었다.
  //
  // (그 줄의 글자를 여기 옮겨 적지 않는다 — 되살아났는지 보는 검사가 주석까지 읽는다.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!togglesWorkPanel(e)) return;
      e.preventDefault();
      setWorkPanelOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 두 열의 경계. **비율로 든다** — px가 아니다(useSplitRatio 머리말). 두 열이 같은 본문을
  // 나눠 갖는 것이라 기본값이 「반」이고, 창이 넓어지면 둘 다 넓어져야 한다.
  //
  // 분모가 이 상자의 폭이라 상자를 가리켜야 한다.
  const splitHost = useRef<HTMLDivElement>(null);
  const splitSize = useSplitRatio("work-split-ratio", splitHost);

  // 끌고 있는 것. **드래그 중에만 값이 있다** — 그동안만 이 화면이 다시 그려진다.
  const drag = useStore(dragStore, (state) => state);

  // 소스 보기의 주인이 **여기로 올라왔다.** 버튼은 패널 머리행에 있고 그것이 바꾸는 것은
  // 본문(SpecViewer)인데, 패널이 본문의 형제가 되면서 둘의 공통 조상이 이 화면뿐이다.
  // 한때 SpecViewer의 지역 상태였고 그 컴포넌트의 `key={slug}` 덕에 "작업을 옮기면 예쁜
  // 보기로 돌아온다"가 공짜로 따라왔는데, 그 공짜는 결정 49가 패널 탭에서 걷어낸 것과
  // **같은 종류의 것**이라 여기서도 되살리지 않는다. 사람이 켠 값은 작업을 옮겨도 그대로다.
  const [showSource, setShowSource] = useState(false);

  // 복사 확인 토스트도 여기로 올라왔다(결정 47). 앞 판에서는 SpecViewer의 지역 상태라
  // **터미널 탭에서 트리를 복사하면 아무 말이 없었다** — 그 탭에는 SpecViewer가 없다.
  // 패널이 올라오면 토스트도 함께 올라와야 하는 것이 그래서다.
  //
  // **`done`은 한 표면이 두 가지 말을 하게 됐기 때문에 있다**(결정 47). 복사는 한 일을
  // 알리고(✓) 상한 거절은 **못 한 일**을 알린다 — 「셸은 8개까지예요」 옆에 초록 체크가
  // 서면 그 문장이 「됐어요」로 읽힌다.
  const [toast, setToast] = useState<{ text: string; done: boolean } | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((text: string, done = true) => {
    setToast({ text, done });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // **상한 8에서 ⌘T가 조용하던 구멍을 메운다**(결정 47). 그 키는 xterm의 키 핸들러에서
  // 오는데 그것은 React 트리 밖이라, 스토어가 낸 거절을 여기서 받아 같은 표면에 붙인다.
  // 문장은 스토어가 짓는다 — 잠긴 `+` 행과 **같은 문장**이어야 해서다.
  //
  // 이 구독이 이 화면에만 있는 것도 결정 47이다: 최상위 터미널(`/terminal`)에는 이 화면이
  // 없어 ⌘T가 계속 조용하고, 거기서는 `+`의 title이 이유를 말한다. 앱 전역 알림 표면을
  // 새로 짓는 안은 기각됐다.
  useEffect(() => onShellOpenRejected((notice) => showToast(notice, false)), [showToast]);

  // 참조가 안정적이어야 토스트 표시/해제 리렌더 때 마크다운 트리가 리마운트(깜빡임)되지 않는다
  const copyText = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text);
      showToast(`${text} 복사됨`);
    },
    [showToast],
  );

  // 트리 훑기는 히스토리를 만들지 않고, 문서 링크는 만든다 — 따라 들어갔으면 돌아올 수
  // 있어야 한다. 두 갈래가 이 화면에서 갈리는 것은 트리(패널)와 링크(본문)가 이제 형제라서다.
  const selectFromTree = useCallback((path: string) => onSelectFile(path, false), [onSelectFile]);
  const followLink = useCallback((path: string) => onSelectFile(path, true), [onSelectFile]);

  // 첫 항목으로 조용히 떨어지지 않는다 — 무선택은 주소 쪽에서 정규화한다 (routes/works.index.tsx).
  // "기본 선택은 초안을 건너뛴다"는 규칙도 그쪽 pickSlug가 들고 있다.
  const selected = works.find((w) => w.slug === selectedSlug) ?? null;

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
  // **분할이면 둘 다 선다**(결정 87) — 단일 뷰에서만 `tab`이 하나를 고른다. 이 두 값이
  // 아래에서 「어느 본문을 그리나」와 「`</>`가 적용될 곳이 있나」를 함께 정한다.
  const specStands = split !== null || tab === "spec";
  const terminalStands = split !== null || tab === "terminal";
  const terminalWork = terminalStands ? (selected ?? lastSelected.current) : null;

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
  const tabOwner = panelWork?.slug ?? null;
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
  // 그리고 **xterm의 숨은 `<textarea>`** — `togglesWorkPanel`이 적어 둔 함정과 같은 자리다).
  //
  // 딛고 선 작업은 `panelWork`다 — 본문이 셸을 보여주는데 다른 작업의 셸을 여는 일이 없다.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!opensShellFromWindow(e)) return;
      e.preventDefault();
      // 프로젝트가 여럿인데 안 골랐으면 셸이 설 자리가 안 정해진다 — 그때는 열지도, 본문을
      // 옮기지도 않는다(결정 24). `+`가 그 화면에서 프로젝트를 묻는 것과 같은 규칙이다.
      const origin = panelWork && workShellOrigin(panelWork, null);
      if (!origin) return;
      openNewShell(origin);
      onSelectTab("terminal");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelWork, onSelectTab]);

  /**
   * ⌘1은 spec, ⌘2~9는 **그 화면의 셸**, ⌃Tab은 그 셸들의 순회(결정 78·79·109).
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
      const shells = shellsOf(state, panelWork.slug);
      // **⌘1만 이 화면의 것이다** — 문서는 셸이 아니라 여기서 가른다. 나머지는 한 칸
      // 밀린 셸 자리이고, 그 밀림은 `shellForNav`가 `firstKey`로 받는다.
      if (nav.kind === "index" && nav.n === 1) {
        onSelectTab("spec");
        return;
      }
      const next = shellForNav(shells, activeIdOf(state, panelWork.slug), nav, 2);
      if (next !== null) {
        selectShell(next);
        onSelectTab("terminal");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelWork, onSelectTab]);

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
      const id = shellClosedByTab(tab, tabOwner, terminalStore.state);
      if (id === null) return;
      e.preventDefault();
      void requestCloseShell(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tabOwner, tab]);

  // 보고 있는 문서와 그것을 가지고 정해지는 것들. **패널과 본문이 한 값을 본다**(위
  // defaultFile 주석). 파일이 삭제되면(또는 주소가 없는 파일을 가리키면) 기본 파일로 폴백.
  const specFiles = panelWork?.specFiles ?? [];
  const currentSpec =
    currentFile && specFiles.includes(currentFile) ? currentFile : defaultFile(specFiles);
  // 잠김은 **본문이 이 토글을 따르지 않는 모든 경우**다. 셋이다: 본문이 셸일 때(터미널 탭 —
  // `</>`가 적용될 곳이 아예 없다), 파일 종류가 토글을 무시할 때(그림 · md도 html도 아닌
  // 것), spec 문서가 하나도 없는 작업.
  //
  // **앞 둘만 이 화면의 것이다.** 파일 종류로 갈리는 일은 표가 안다(`doc-refs`의 표) —
  // 여기서 다시 풀면 본문·트리·아카이브가 다른 말을 할 자리가 생긴다. 문서가 하나도 없는
  // 작업에서 표는 마크다운으로 떨어지는데, 그 기본값은 **본문 분기(예쁜 보기)를 위한
  // 것이지 "누를 것이 있다"는 뜻이 아니다** — 본문은 "아직 spec이 없어요"에 고정이라
  // 눌러도 아무 일이 없다(결정 11·21). 그래서 `!currentSpec`이 따로 얹힌다.
  const sourceLocked = !specStands || !currentSpec || ignoresSourceToggle(currentSpec);

  // 머리행은 **본문 열 안에서만** 산다. 작업 패널이 이 열의 형제이자 머리행과 같은 층이라
  // (창 맨 위에서 시작해 아래까지 내려온다) 머리행이 그 위를 지나갈 수 없다. 그래서 화면이
  // 여기서 만들어 두고, 작업이 골라졌으면 SpecViewer에 슬롯으로 넘긴다.
  //
  // **그 머리행이 탭 줄이 됐다**(결정 7·10) — 셸을 고르는 자리가 사이드바 가지에서 화면
  // 안으로 되돌아왔다(adr-03). 브레드크럼(`Works / 제목`)은 함께 사라진다: **work 제목은
  // 사이드바 행이 말한다.** 감수한 것은 ⌘B로 사이드바를 접으면 화면 어디에도 제목이
  // 없다는 것이고, 이름을 고치는 길은 ⋯ 메뉴로 갔다(아래 `WorkMenu`).
  const header = panelWork ? (
    <ShellTabs
      state={shellState}
      owner={panelWork.slug}
      // **`worktrees`에서 뽑는다 — `projects`가 아니다.** `workShellOrigin`이 갈리는 기준이
      // `worktrees`라, 둘이 어긋나면 메뉴는 열리는데 고른 값으로 셸이 안 생긴다 — 눌러도
      // 아무 일이 없는 버튼(결정 11·21이 금지하는 것)이 된다.
      projects={panelWork.worktrees.map((tree) => tree.project)}
      // 맨 앞 고정 칸(결정 7). **켜짐은 「본문이 문서인가」이지 마지막으로 누른 칸이 아니다** —
      // 분할이면 이 값과 아래 `showing`이 함께 참이고, 그때 켜진 탭이 둘이다(결정 12).
      spec={{ on: specStands, onSelect: () => onSelectTab("spec") }}
      showing={terminalStands}
      // 왼쪽에 남은 것이 사이드바뿐이다 — 그게 접히면 이 줄이 창 왼쪽 끝에 붙는다
      inset={!sidebarOpen}
      // 칸을 누르면 그 셸이 켜지고 **본문이 terminal로 넘어간다** — 사이드바 가지가 하던
      // 짝 그대로다(결정 50). 어느 work으로 갈지를 여기서 안 정하는 것은 이 줄이 늘 지금
      // 보고 있는 work의 것이기 때문이다.
      onSelect={(id) => {
        selectShell(id);
        onSelectTab("terminal");
      }}
      // 확인을 거치는 길 하나다(결정 92) — ⌘W도 같은 함수로 온다.
      onClose={requestCloseShell}
      onOpen={(project) => {
        // 프로젝트가 여럿인데 안 골랐으면 셸이 설 자리가 안 정해진다 — 그때는 열지도,
        // 본문을 옮기지도 않는다(결정 24). ⌘T가 위에서 같은 규칙을 탄다.
        const origin = workShellOrigin(panelWork, project);
        if (!origin) return;
        openNewShell(origin);
        onSelectTab("terminal");
      }}
      // 칸을 본문 위로 끌면 그 절반에 선다(결정 12) — 사이드바 행이 하던 몸짓 그대로이고
      // **바뀐 것은 출발점뿐이다**(놓일 자리도 분할 계산도 그대로다).
      //
      // **끄는 자리를 여기서 만든다.** 탭 줄이 스스로 만들면 `terminal → works` 방향이
      // 값 차원에서 생겨 반대 방향과 맞물린다(그쪽 prop 주석 — 걷히기 전 Sidebar가 셸
      // 가지에 같은 이유로 같은 일을 해 줬다). 이 화면은 이미 양쪽을 다 알고 있다.
      //
      // 이 줄은 늘 **지금 보고 있는 work**의 것이라 `slug`가 하나로 정해진다 — 남의 work을
      // 떨구는 길(결정 101)은 사이드바에만 있다.
      onDragTab={(shellId, from) =>
        armDrag(
          shellId === null
            ? { kind: "spec", slug: panelWork.slug, shellId: null }
            : { kind: "shell", slug: panelWork.slug, shellId },
          from,
        )
      }
      // 오른쪽 끝 고정(결정 10) — 상태 배지 · ⓘ · ⋯ · 분할 · 패널 열기. 탭은 왼쪽부터
      // 차므로 탭 개수가 변해도 이것들의 자리가 안 움직인다.
      //
      // 상태 배지가 여기 있는 이유는 자주 누르는 조작이라서다 — 탭이나 메뉴 뒤에 숨기면
      // 상태를 바꾸는 데 클릭이 두 번 든다. ⓘ·⋯는 브레드크럼에 있던 것이 제목과 함께
      // 이리로 왔다: 제목이 사라져 「작업 그 자체를 말하는 덩어리」가 설 자리가 없어졌다.
      actions={
        selected && (
          <>
            <StatusMenu work={selected} />
            {/* ⓘ와 ⋯가 **줄의 간격을 그대로 받는다**(결정 24). 한때 둘을 gap 0인 상자에
                묶어 뒀는데 — hover 배경이 한 버튼에서 다음으로 끊김 없이 옮겨가게 하려던
                것이었다 — 그 둘만 붙어 있어 한 줄 안에 간격이 두 벌이 됐다. 붙이는 이득보다
                리듬이 갈리는 값이 크다. */}
            <WorkMetaMenu work={selected} />
            <WorkMenu work={selected} archive={archive} remove={remove} />
            {/* 본문을 고르던 `spec｜terminal` 토글이 여기 있었다 — **사이드바 트리가
                그 일을 가져갔다**(결정 70). 같은 것을 두 자리에서 고르게 두면 어느 쪽이
                지금인지가 화면마다 갈린다. 그리고 이번 판이 그 일을 다시 가져와 **탭 줄**에
                두었다 — 사이드바에서 셸 가지가 걷혔으므로 자리는 여전히 하나다(adr-03).
                (그 줄의 글자를 여기 옮겨 적지 않는다 — 되살아났는지 보는 검사가
                주석까지 읽는다.) */}
            {/* 분할 토글 — **뷰 탭이 있던 자리다**(결정 86). 켜면 spec이 왼쪽,
                터미널이 오른쪽이다. 끄면 `tab`이 가리키는 쪽이 남으므로(결정 97)
                여기서 정할 것이 없다 — 지금 `tab`을 그대로 넘긴다. */}
            <button
              type="button"
              onClick={() => changeSplit(split === null ? "lr" : null, tab)}
              // **말은 「분할」이다**(CONTEXT.md). 켜고 끄는 상태이지 화면 이름이
              // 아니라 「2열로 보기」처럼 가는 곳으로 부르지 않는다. 라벨이 대상을
              // 이름하고 켜짐은 `aria-pressed`가 말하는 것은 옆 `</>`와 같은 규칙이다.
              aria-label="분할"
              aria-pressed={split !== null}
              // 툴팁만 상태를 탄다 — 켜져 있는데 「켜기」가 뜨면 누르기 전에 무슨 일이
              // 날지를 틀리게 말한다(작업 메뉴의 `title`이 이미 같은 모양이다).
              title={split !== null ? "분할 끄기" : "분할 켜기"}
              className={cn(
                "icon-button transition-colors",
                split !== null ? "toggle-on" : "text-tertiary quiet-hover",
              )}
            >
              <Columns2 className="size-4" strokeWidth={2} />
            </button>
            {/* 패널 여는 버튼은 두 본문 **모두**에 그린다. 한때 터미널에서 뺐던 것은
                그때 패널이 거기 없었기 때문이고(결정 11), 그 이유는 #100이 머지되며
                사라졌다. 지금은 양쪽 다 패널을 이고 있으므로 누르면 실제로 열린다.

                여는 길은 이 버튼 하나, 닫는 길은 패널 안 × 하나다. 늘 보이는 토글로 두면
                닫는 길이 둘이 된다. 본문 확대 단축키(⌘Enter)는 양쪽을 겸한다.

                닫혀 있을 때만 그리는 것으로 "닫기 애니메이션이 시작할 때 함께 뜬다"가
                따라온다 — workPanelOpen이 먼저 뒤집히고 패널 폭이 220ms 동안 줄어든다. */}
            {!workPanelOpen && (
              <button
                type="button"
                onClick={() => setWorkPanelOpen(true)}
                aria-label="작업 패널 펼치기"
                aria-expanded={false}
                title="작업 패널 펼치기"
                className="icon-button-quiet text-tertiary"
              >
                <PanelRight className="size-4" strokeWidth={2} />
              </button>
            )}
          </>
        )
      }
    />
  ) : (
    // 고른 작업이 없으면 **칸이 설 자리가 없다** — 문서도 셸도 없는 화면이라 탭 줄 대신
    // 화면 이름만 이고 선다. 여기에 탭 줄을 세우면 `owner`가 `null`이 되는데 그 값은
    // `shellsOf`의 계약상 **최상위 터미널**을 가리켜, `/terminal`의 셸이 이 줄에 서고
    // `+`는 열 자리가 없어 눌러도 아무 일이 없는 버튼이 된다(결정 11·21이 금지하는 것).
    <PageHeader root="Works" inset={!sidebarOpen} />
  );

  // 열에 포커스가 들어가면 `tab`이 **그 열**을 가리킨다(결정 97) — 토글을 끌 때 남는
  // 쪽이 그 값이다. 이미 그 값이면 옮기지 않는다: 열 머리의 `×`처럼 한 틱에 두 이동이
  // 겹치는 자리에서 앞의 것이 조용히 이기기 때문이다.
  const focusColumn = useCallback(
    (next: ViewTab) => {
      if (next !== tab) onSelectTab(next);
    },
    [tab, onSelectTab],
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
  const changeSplit = useCallback(
    (next: SplitSide | null, nextTab: ViewTab) => {
      collapseOnSplit(next);
      onSelectSplit(next, nextTab);
    },
    [collapseOnSplit, onSelectSplit],
  );

  /**
   * **마지막 셸이 닫히면 본문이 문서로 돌아온다.**
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
   * 개수는 셸을 열고 닫을 때만 바뀐다.
   */
  const shellCount = useStore(terminalStore, (state) =>
    panelWork ? shellsOf(state, panelWork.slug).length : 0,
  );
  const tally = useRef<ShellTally>({ owner: panelWork?.slug ?? null, count: shellCount });
  useEffect(() => {
    const now = { owner: panelWork?.slug ?? null, count: shellCount };
    const emptied = shellsEmptied(tally.current, now);
    tally.current = now;
    // 본문에 터미널이 서 있을 때만 걷는다 — 문서를 읽는 중에 사이드바로 셸을 닫은 것은
    // 화면에서 아무것도 안 바뀌어야 한다.
    if (emptied && (tab === "terminal" || split !== null)) changeSplit(null, "spec");
  }, [shellCount, panelWork, tab, split, changeSplit]);

  // 떨궜다. **셸은 여기서 켜고**(스토어의 일이라 주소와 무관하다) 이동은 주소를 쥔 쪽이
  // 한다 — 남의 work을 떨구면 work이 통째로 바뀌는데(결정 101) 그 이동은 이 화면의 일이 아니다.
  const dropHere = useCallback(
    (source: DragSource, half: SplitHalf) => {
      if (source.kind === "shell" && source.shellId !== null) selectShell(source.shellId);
      const next = dropSplit(source.kind, half);
      collapseOnSplit(next);
      onDropInto(source, next);
    },
    [collapseOnSplit, onDropInto],
  );

  // 열 머리 둘 — **분할일 때만 쓰인다**(결정 89). 단일 뷰에 두면 분할을 켤 때마다 층이
  // 하나 늘었다 줄어 본문이 위아래로 밀린다.
  const specHead = (
    <ColumnHead
      kind="spec"
      label={specHeadLabel(currentSpec)}
      closeLabel="spec 열 닫기"
      // 이 열을 닫으면 남는 쪽은 **반대쪽**이다(결정 89) — 그 값이 곧 `tab`이다.
      onClose={() => changeSplit(null, otherTab("spec"))}
      // `</>`는 **패널이 접혔을 때만** 여기 선다(결정 106). 결정 89가 이 버튼을 열 머리에
      // 놓은 근거는 「분할이 패널을 접으면 함께 사라진다」 하나뿐이라, 패널이 열려 있으면
      // 근거가 없어진다 — 이 저장소는 같은 일을 하는 버튼을 한 화면에 둘 두지 않는다.
      source={
        !workPanelOpen && (
          // 패널 머리행에도 **같은 접근성 이름**의 칸이 있다(같은 일을 하니 당연하다).
          // 검사가 「열 머리의 것」만 셀 수 있게 표식을 단다 — 접힌 패널도 마운트된 채라
          // 이름으로 세면 둘이 잡힌다. 컨트롤 자신은 이 표식을 모른다: 세 자리가 함께 쓰는
          // 것이라 한 호출부의 검사 사정을 그 안으로 들이지 않는다.
          <span data-column-source="">
            <SourceToggle on={showSource} locked={sourceLocked} onChange={setShowSource} />
          </span>
        )
      }
    />
  );
  const terminalHead = terminalWork && (
    <ColumnHead
      kind="terminal"
      // 탭 줄의 셸 칸과 **같은 이름**이어야 한 셸로 읽힌다(결정 104). 그 이름은 셸이
      // 프롬프트마다 쏘는 타이틀에 바뀌므로 조각 하나가 따로 구독한다.
      label={<ShellHeadName owner={terminalWork.slug} />}
      closeLabel="terminal 열 닫기"
      onClose={() => changeSplit(null, otherTab("terminal"))}
    />
  );

  // 문서 본문. **머리행은 단일 뷰에서만 이 안에 있다** — 분할이면 열 둘 위에 한 번 선다.
  const specBody = selected && (
    <SpecViewer
      key={selected.slug}
      work={selected}
      header={split === null ? header : undefined}
      panelOpen={workPanelOpen}
      sidebarOpen={sidebarOpen}
      file={currentSpec}
      showSource={showSource}
      onNavigate={followLink}
      onCopy={copyText}
    />
  );
  const terminalBody = terminalWork && (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {/* `key`는 Work마다 다시 마운트시킨다 — 단일 뷰 쪽과 같은 계약이다(결정 20·21). */}
      <TerminalPane key={terminalWork.slug} work={terminalWork} />
    </div>
  );

  // **조합은 늘 `spec ▏터미널`이고 좌우만 바뀐다**(결정 87). 그래서 정할 것이 하나다.
  //
  // 순서를 여기 한 줄에서 정한다 — 열을 그리는 조각이 둘이면 「마크업에서 먼저 나오는 것이
  // 왼쪽」이라는, 검사가 기대는 규칙이 두 자리로 갈린다.
  const specColumn = { tab: "spec" as const, head: specHead, body: specBody };
  const terminalColumn = { tab: "terminal" as const, head: terminalHead, body: terminalBody };
  const [leftColumn, rightColumn] =
    split === "lr" ? [specColumn, terminalColumn] : [terminalColumn, specColumn];

  // `drag.source`를 그대로 쓰면 아래 클로저 안에서 타입이 안 좁혀진다 — 한 번 받아 둔다.
  const dragSource = drag.source;

  // 본문 열 — 셋 중 하나다. **패널은 여기 들어오지 않는다**(결정 49): 어느 본문이 서 있든
  // 패널은 그 형제로 아래 return에서 딱 한 번 그려진다. 그래서 뷰 탭을 오가도 패널
  // 인스턴스가 그대로 살아 탭 선택이 유지된다 — 1판은 호출부가 둘이라 인스턴스도 둘이었다.
  const body = split !== null && specBody && terminalBody ? (
    // 분할 — 머리행 하나 아래에 열 둘이 선다. 이 상자가 `<main>`이 아닌 것은 **문서 열이
    // 이미 `<main>`이기 때문이다**(SpecViewer) — 겹치면 화면에 `<main>`이 둘이 된다.
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {header}
      <div ref={splitHost} className="flex min-h-0 flex-1">
        {/* **몫을 드는 것은 왼쪽 열 하나다** — 오른쪽이 남는 자리를 먹는다(패널·사이드바와
            같은 관용구). 폭 핸들은 그 열의 오른쪽 가장자리에 얹힌다. */}
        <SplitColumn
          column={leftColumn}
          width={`${splitSize.ratio * 100}%`}
          // 더블클릭으로 반반에 돌아갈 때만 애니메이션한다(useSplitRatio의 `snapping`).
          // 값은 패널이 접히는 것과 같다 — 같은 화면에서 두 폭이 다른 속도로 움직이면
          // 한 동작으로 안 읽힌다.
          snapping={splitSize.snapping}
          onFocus={focusColumn}
        >
          <ResizeHandle control={splitSize} />
        </SplitColumn>
        <SplitColumn column={rightColumn} onFocus={focusColumn} />
      </div>
    </div>
  ) : terminalWork ? (
    <main className="relative flex min-w-0 flex-1 flex-col">
      {header}
      {/* `key`는 Work마다 다시 마운트시킨다: 셸은 스토어가 들고 있어 안 죽고, 다시 붙는
          자리만 새로 잡힌다(결정 20·21). */}
      <TerminalPane key={terminalWork.slug} work={terminalWork} />
    </main>
  ) : specBody ? (
    specBody
  ) : (
    // 고른 작업이 없으면 패널도 없다 — 이 열이 머리행을 직접 이고 있는다.
    <main className="relative flex min-w-0 flex-1 flex-col">
      {header}
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="flex max-w-[420px] flex-col items-center gap-[7px] text-center">
          <div className="mb-2.5 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
            {needsProject ? (
              <Folder className="size-5" strokeWidth={1.6} />
            ) : (
              <Zap className="size-5" strokeWidth={1.6} />
            )}
          </div>
          <span className="text-[16.5px] font-semibold tracking-[-0.01em]">
            {needsProject ? "먼저 프로젝트를 등록해요" : "아직 작업이 없어요"}
          </span>
          <span className="text-[14px] leading-[1.65] text-tertiary">
            {needsProject
              ? "작업은 등록된 프로젝트 위에서 시작돼요. Projects에서 폴더를 고르거나, 에이전트에게 맡겨도 돼요."
              : "작업은 Claude Code에서 시작돼요. 작업이 시작되면 스펙 문서와 진행 상황이 여기에 나타나요."}
          </span>
          {/* 실제로 통하는 경로만 안내한다 — CLI에는 등록·시작 명령이 없고, 에이전트가
              atelier_add_project / atelier_start_work를 부른다.
              아래 문구는 그대로 붙여 넣는 것이다. */}
          <code className="mt-3 select-all rounded-[10px] border bg-inset px-3 py-2 font-mono text-[12.5px] text-muted-foreground">
            {needsProject ? "atelier에 이 폴더 등록해줘" : 'atelier로 "새 작업" 시작해줘'}
          </code>
        </div>
      </div>
    </main>
  );

  return (
    // 본문 열과 작업 패널을 담는 행이다. **min-w-0이 빠지면 패널이 창 밖으로 밀린다** —
    // 이 행은 스스로도 flex 항목이라 min-width가 auto면 자기 min-content(=본문 열의
    // min-content + 패널 폭)만큼 부푼다. 본문 열에 min-w-0을 달아 둔 것만으로는 막히지
    // 않는다. 부푼 만큼 패널이 오른쪽으로 밀려 잘리는데 **미는 양이 본문 내용에 따라
    // 달라져서**, 소스 보기를 켜고 끌 때마다 패널 폭이 바뀌는 것처럼 보였다 (실측: 예쁜
    // 보기에서 패널 오른쪽 끝이 1521, 창은 1512 — 9px이 창 밖에 있었다).
    //
    // relative는 생애주기 오버레이가 이 영역 전체를 덮기 위한 것이다 — 패널까지 포함한다.
    // 보관·제거가 도는 동안 패널만 살아 있으면 그 위에서 조작이 계속된다.
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {body}
      {/* **작업 패널을 그리는 유일한 자리다**(결정 49). 1판은 여기와 SpecViewer 둘에서
          그려서 뷰 탭을 오갈 때마다 인스턴스가 갈렸다.

          **`key`를 주지 않는다.** 앞 판 결정 4(「작업을 옮기면 패널 탭이 spec으로
          리셋된다」)는 코드가 아니라 `key={slug}`가 붙은 SpecViewer 아래에 있어서 공짜로
          나오던 성질이었고, 결정 49가 그것을 명시적으로 뒤집는다. 따라오는 것 둘:
          (a) 본문을 오가도(spec ↔ terminal) 패널 탭이 유지된다 — `info`를 보던 채로
              본문만 갈아탈 수 있다는 뜻이다.
          (b) 트리 접힘도 작업을 넘어 유지된다 — **감수한다.** 접힘 기억의 키가 판 폴더의
              전체 이름이라 이름이 완전히 같을 때만 물려받고, 대부분은 기억에 없는 이름이라
              기본값(최신 판만 펼침)으로 뜬다.

          트리에서 파일을 누르면 **spec으로 돌아가며** 그 문서가 열린다. `selectFile`이
          search를 객체로 갈아 끼워 `tab`이 함께 떨어지기 때문이다(결정 15의 뒷면).
          래퍼를 두지 않는 것은 이동이 **한 번**이어야 해서다 — 탭과 파일을 따로 옮기면
          두 navigate가 한 틱에 겹친다. */}
      {panelWork && (
        <WorkPanel
          work={panelWork}
          currentFile={currentSpec}
          onSelectFile={selectFromTree}
          onCopy={copyText}
          onClose={() => setWorkPanelOpen(false)}
          onOpenProject={onOpenProject}
          // 켜짐은 **사람이 정한 값 그대로** 내려간다. 터미널 탭에서 억지로 false로
          // 끄지 않는 것은 잠김과 켜짐이 독립이기 때문이다(WorkPanel의 sourceOn 주석) —
          // 탭마다 다른 값을 내려주면 뷰 탭을 오갈 때 버튼이 저 혼자 켜졌다 꺼진다.
          sourceOn={showSource}
          sourceLocked={sourceLocked}
          onToggleSource={() => setShowSource((v) => !v)}
          open={workPanelOpen}
        />
      )}
      {/* 놓일 자리 — **끄는 동안에만 선다**(결정 86). 절반 둘이 이 영역을 나눠 덮고,
          포인터가 그 위를 지나가면 스스로 「내 위다」를 말한다. 좌표에서 절반을 계산하지
          않는 이유는 split-view.ts 머리말에 있다.

          **패널까지 덮되 머리행은 뺀다.** 패널을 도려내려면 그 폭을 여기서 알아야 하는데,
          그 값은 패널이 드래그로 바꾸는 것이라 두 곳에 적히면 한쪽만 늙는다 — 넉넉히 받는
          쪽이 겨누기도 쉽다. 머리행은 반대다: 높이가 상수(`--titlebar-height`)이고, **끄는
          것이 출발한 자리**라서다(결정 12). 덮으면 겹판이 제 출발점 위에 서서 「제자리에
          돌려놓으면 아무 일도 안 난다」가 사라진다 — 칸을 12px 흔들고 손을 떼기만 해도
          화면이 갈린다. 취소하는 몸짓이 그 한 줄뿐이라 그것을 남긴다. */}
      {dragSource && (
        // 겹판 **전체**를 벗어날 때만 끈다 — `pointerleave`는 버블하지 않아 반쪽 사이를
        // 오갈 때는 안 온다.
        <div
          className="absolute inset-x-0 bottom-0 top-(--titlebar-height) z-40 flex"
          onPointerLeave={clearHalf}
        >
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
                "flex-1 transition-colors duration-150",
                drag.half === half && "bg-primary/12 ring-1 ring-inset ring-primary/40",
              )}
            />
          ))}
        </div>
      )}
      {/* 토스트 — **뷰 분기 밖**이라 본문이 셸이든 문서든 같은 자리에 뜬다(결정 47).
          가운데는 본문 열이 아니라 **본문+패널** 전체의 가운데인데, 이 표면이 이제 패널에서
          일어나는 일(트리 복사·⌘T 거절)까지 말하기 때문이다. */}
      {toast && (
        <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-[10px] border border-border-strong bg-background px-3.5 py-2 text-[12.5px] shadow-lg">
          {/* 한 일과 못 한 일이 같은 표면을 쓴다(결정 47) — 글리프가 그 둘을 가른다. */}
          {toast.done ? (
            <Check className="size-3.5 text-green-700" strokeWidth={2.4} />
          ) : (
            <Ban className="size-3.5 text-tertiary" strokeWidth={2.2} />
          )}
          {toast.text}
        </div>
      )}
      {running && <LifecycleOverlay verb={running.verb} detail={running.detail} />}
    </div>
  );
}

/** 분할의 열 하나 — 머리행과 본문. */
interface SplitColumnView {
  tab: ViewTab;
  head: React.ReactNode;
  body: React.ReactNode;
}

/**
 * 열 하나를 그린다. 두 열의 상자가 같아야 하는데 좌우가 바뀌므로, 같은 마크업을 두 번
 * 적으면 한쪽만 손보는 날이 온다.
 */
function SplitColumn({
  column,
  width,
  snapping = false,
  onFocus,
  children,
}: {
  column: SplitColumnView;
  /**
   * 주면 **몫을 드는 쪽**(왼쪽)이다. 없으면 남는 자리를 먹고 경계선을 그린다.
   *
   * CSS 길이 문자열인 것은 이 값이 비율이기 때문이다 — px로 두면 창이 넓어질 때
   * 오른쪽 열만 자란다(useSplitRatio 머리말).
   */
  width?: string;
  /** 폭이 훌쩍 뛰는 중인가 — 그때만 트랜지션을 켠다(useSplitRatio의 `snapping`). */
  snapping?: boolean;
  onFocus: (tab: ViewTab) => void;
  /** 폭 핸들. 왼쪽 열에만 온다 — 이 상자의 오른쪽 가장자리에 얹힌다. */
  children?: React.ReactNode;
}) {
  return (
    <div
      style={width === undefined ? undefined : { width }}
      className={cn(
        "relative flex min-w-0 flex-col",
        width === undefined && "flex-1 border-l",
        snapping && "transition-[width] duration-[220ms] ease-panel",
      )}
    >
      {column.head}
      {/* 포커스를 받는 것은 **머리행이 아니라 속**이다. 머리행에 얹으면 그 열의 `×`를
          누르는 것이 「이 열을 봤다」로 먼저 읽혀, 한 틱에 이동이 둘 겹친다.
          `pointerdown`까지 보는 것은 **문서 열이 포커스를 못 받기 때문이다** — 글을 읽는
          영역이라 클릭해도 focus 이벤트가 안 난다(결정 97의 「포커스가 들어갈 때」를
          여기까지 넓혔다). */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        onFocusCapture={() => onFocus(column.tab)}
        onPointerDownCapture={() => onFocus(column.tab)}
      >
        {column.body}
      </div>
      {children}
    </div>
  );
}

/**
 * 열 머리 — **분할일 때만 선다**(결정 89). 왼쪽은 `문서명 · </> · ×`, 오른쪽은 `셸 이름 · ×`.
 *
 * **아래에 선을 긋지 않는다.** 이 행은 화면 브레드크럼 바로 아래에 붙는데 그쪽이
 * 「아래 경계선이 없다 — 화면이 선으로 잘리지 않고 본문으로 이어진다」를 이미 정해 뒀다
 * (PageHeader, 작업 패널 머리행도 같다). 열의 구분은 두 열 사이의 세로선이 맡는다.
 */
function ColumnHead({
  kind,
  label,
  closeLabel,
  onClose,
  source,
}: {
  // 표식은 검사가 이 행을 **정체성으로** 집기 위한 것이다 — 모양(클래스 문자열)으로
  // 가르면 규격을 손보는 날 검사가 조용히 샌다(`data-branch`·`data-shell-host`와 같은 이유).
  // 순서도 이 표식으로 읽힌다: 마크업에서 먼저 나오는 것이 왼쪽 열이다.
  kind: ViewTab;
  label: React.ReactNode;
  closeLabel: string;
  onClose: () => void;
  // 왼쪽 열에만 있는 `</>`. 오른쪽 열에는 아무것도 오지 않는다.
  source?: React.ReactNode;
}) {
  return (
    <div
      data-column={kind}
      className="flex h-8 shrink-0 items-center gap-1 pl-3 pr-1.5 text-[12.5px] text-tertiary"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {source}
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        title={closeLabel}
        className="icon-button-quiet shrink-0 text-tertiary"
      >
        <X className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

// 되돌릴 수 없는 조작이 도는 동안 본문을 덮는다.
//
// 워크트리 제거는 폴더 크기에 비례해 수 초가 걸린다(실측 8.9GB). 그동안 화면이 아무 말도
// 하지 않으면 **버튼이 안 눌린 것처럼 보이고**, 사이드바에는 그 작업이 아직 그대로 있어
// 더 그렇다. 덮는 것 자체도 목적이다 — 진행 중에 같은 작업을 다시 겨누지 못하게 한다.
//
// 헤더까지 덮는다. ⋯ 버튼이 거기 있고, 그것을 다시 누르는 것이 막아야 할 바로 그 동작이다.
// 사이드바는 덮지 않는다 — 이 조작은 본문이 보여주는 작업 하나에만 걸린다.
function LifecycleOverlay({ verb, detail }: { verb: string; detail: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-[2px]"
    >
      <div className="flex flex-col items-center gap-2">
        <LoaderCircle className="size-6 animate-spin text-primary" strokeWidth={2} />
        <span className="mt-1 text-[15px] font-semibold tracking-[-0.01em]">{verb} 중…</span>
        <span className="text-[13px] text-tertiary">{detail}</span>
      </div>
    </div>
  );
}

// 이름 바꾸기 — **⋯ 메뉴 안에 산다**(결정 10). slug는 바뀌지 않는다 (ProjectDetail의
// TitleEditor와 같은 계약).
//
// **한때 브레드크럼 말단의 제자리 편집이었다.** 탭 줄이 머리행을 차지하면서 제목이 화면에서
// 빠졌고(사이드바 행이 말한다) 그 자리와 함께 편집도 사라졌는데, **이름을 고칠 길이 없어지면
// 안 된다** — 그래서 여는 자리만 ⋯ 메뉴 항목으로 옮기고 편집 자체는 그대로 왔다.
//
// **늘 입력이다.** 예전의 「누르면 입력이 되는 버튼」은 여는 일을 겸하고 있었는데, 그 일을
// 메뉴 항목이 가져갔으므로 남겨 두면 같은 일을 하는 자리가 둘이 된다.
//
// 끝나는 길이 셋이다 — Enter(적용) · Escape(버림) · 포커스 이탈(적용). 메뉴가 바깥 클릭으로
// 닫히면 입력이 언마운트되며 그냥 사라진다: blur가 안 오는 경로라 그때는 안 고쳐지고,
// 그것이 「메뉴를 닫았다」의 자연스러운 뜻이다.
function TitleEditor({ work, onDone }: { work: WorkView; onDone: () => void }) {
  const setTitle = useSetWorkTitle();
  const [draft, setDraft] = useState(work.title);
  // blur와 Enter가 함께 들어와 두 번 커밋되는 것을 막는다
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const value = draft.trim();
    if (commit && value && value !== work.title) {
      setTitle.mutate({ slug: work.slug, title: value });
    }
    // 재조회가 돌아오기 전에 이 자리를 먼저 걷는다 — draft가 새 값과 싸우지 않게
    onDone();
  };

  return (
    <input
      autoFocus
      aria-label="작업 이름"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        // Escape는 삼키지 않는다 — 메뉴의 Escape 핸들러가 함께 들어도 하는 일이 같다
        // (아래 `onDone`이 메뉴를 닫는다). 삼키면 「같은 일을 두 번 막았다」만 남는다.
        if (e.key === "Escape") finish(false);
      }}
      className="w-full min-w-0 rounded-[7px] border border-primary bg-background px-1.5 py-0.5 text-[12.5px] font-medium outline-none"
    />
  );
}

// 브레드크럼 상태 배지 + 변경 드롭다운
function StatusMenu({ work }: { work: WorkView }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const setStatus = useSetWorkStatus();
  const meta = STATUS_META[work.status];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className="relative flex">
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="상태 변경"
        className={cn(
          "flex h-[22px] items-center gap-1 rounded-[7px] px-2 text-[12px] font-medium transition-[filter] hover:brightness-95",
          meta.badgeClass,
        )}
      >
        {meta.label}
        <ChevronDown className="size-2.5" strokeWidth={2.2} />
      </button>
      {open && (
        <PopoverPortal
          anchorRef={anchor}
          width={190}
          onClose={() => setOpen(false)}
          className="flex flex-col gap-px p-[5px]"
        >
          {(Object.keys(STATUS_META) as WorkStatus[]).map((status) => {
              const option = STATUS_META[status];
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (status !== work.status) {
                      setStatus.mutate({ slug: work.slug, status });
                    }
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
                >
                  <span className={cn("size-[7px] shrink-0 rounded-full", option.dotClass)} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {option.label}
                  </span>
                  <span className="shrink-0 text-[11px] text-tertiary">{option.desc}</span>
                  {status === work.status && (
                    <Check className="size-3 shrink-0 text-primary" strokeWidth={2.4} />
                  )}
                </button>
              );
            })}
        </PopoverPortal>
      )}
    </span>
  );
}

// 생애주기 조작 — 뷰 토글이 모인 우측 actions가 아니라 StatusMenu 옆에 산다.
// 둘 다 되돌릴 수 없어서 네이티브 확인을 거치고, 거절 사유(커밋 안 된 변경 등)는
// 코어가 파일 단위로 말해주므로 그대로 보여준다.
//
// 성공 뒤에 선택을 옮기지 않는다 — 목록 무효화로 이 작업이 사라지면 -works-view.tsx의
// 정규화(`exists`가 false가 되는 경로)가 주소까지 함께 옮긴다. 여기서 또 옮기면 같은 일을
// 두 곳이 하게 되고, 그쪽이 "사라진 작업" 일반을 이미 담당한다.
function WorkMenu({
  work,
  archive,
  remove,
}: {
  work: WorkView;
  // 상태를 위에서 받는다 — 진행 표시가 본문 전체를 덮으므로 소유자가 WorksPage다
  archive: ReturnType<typeof useArchiveWork>;
  remove: ReturnType<typeof useRemoveWork>;
}) {
  const [open, setOpen] = useState(false);
  // **이름 바꾸기가 이 메뉴로 왔다**(결정 10 · #141). 제목이 머리행에서 빠지면서 제자리
  // 편집도 함께 사라졌는데, 이름을 고칠 길이 없어지면 안 된다. 항목을 누르면 메뉴가 닫히지
  // 않고 **그 자리가 입력으로 바뀐다** — 팝오버 밖에 입력을 세우면 앵커가 사라진 뒤에도
  // 떠 있는 자리가 하나 더 생기고, 그것을 닫는 규칙을 또 정해야 한다.
  const [renaming, setRenaming] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const busy = archive.isPending || remove.isPending;
  // 이 Work의 **살아 있는** 셸. 확인 대화가 그 수를 말한다(결정 26). 고르는 규칙은
  // `shellsOf` 하나라 다른 Work의 셸과 최상위 터미널의 셸은 안 걸린다.
  //
  // 끝난 칸과 못 뜬 칸은 세지 않는다 — 그 칸들은 남아 있지만 죽일 프로세스가 없어서,
  // 함께 세면 "셸 2개가 닫혀요"라고 해놓고 실제로는 하나만 끝난다. **거두는 것은 그래도
  // 전부다**(아래): Work가 사라지는데 그 Work를 가리키는 칸만 남으면 닫을 길이 없다.
  const liveShells = useStore(terminalStore, (state) => runningShellsOf(state, work.slug));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 다른 작업으로 옮겨가면 닫는다 — 열어 둔 채 전환하면 메뉴가 살아남아 **화면에 보이는
  // 것과 다른 작업**을 겨눈다.
  //
  // **지금은 이 이펙트가 돌기 전에 리마운트가 먼저 닫는다.** 머리행이 key={slug}인
  // SpecViewer 안으로 들어가면서(디자인 정본 정렬) 작업을 옮기면 이 컴포넌트째 새로 선다.
  // 남겨 두는 것은 그 배치가 이 화면의 계약이 아니기 때문이다 — 머리행을 다시 SpecViewer
  // 밖으로 끌어내면 리마운트가 사라지고 이 줄만 남아 같은 일을 한다. 형제인 StatusMenu는
  // 이 줄이 없어서, 지금은 리마운트에만 기대고 있다.
  //
  // 작업 패널이 WorksPage로 올라온 뒤(결정 49)에도 **머리행은 SpecViewer 안에 그대로 있다** —
  // 올라간 것은 패널이지 머리행이 아니다. 터미널 탭에서는 이 이펙트가 실제로 일한다.
  //
  // 편집도 함께 걷는다 — 남겨 두면 다음에 이 메뉴를 열었을 때 **다른 작업의 이름**을
  // 고치는 입력이 먼저 서 있다.
  useEffect(() => {
    setOpen(false);
    setRenaming(false);
  }, [work.slug]);

  // 진행 중에는 다시 부르지 않는다. 두 번째 호출은 이미 옮겨진 작업을 찾지 못해 실패하는데,
  // 성공한 아카이빙 위에 "아카이빙하지 못했습니다" 창이 뜨는 것이 그 결과다.
  const run = async (
    verb: string,
    detail: string,
    call: () => Promise<unknown>,
  ) => {
    setOpen(false);
    if (busy) return;
    // 셸은 이 Work의 워크트리에서 도는 프로세스라 폴더가 정리되면 함께 끝난다. 누르기 전에
    // 그 사실을 말한다 — 용어는 「셸」이다("터미널"은 화면을 가리키는 말이라 여기서 쓰면
    // 다른 것을 센 것처럼 읽힌다). 0개면 그 줄을 쓰지 않는다.
    const notice = liveShells > 0 ? `${detail}\n셸 ${liveShells}개가 닫혀요.` : detail;
    // **앱의 창이다**(OS 시트가 아니다) — 창 하나만 남의 글꼴·남의 모서리로 뜨면 그것이
    // 앱 밖의 일처럼 읽힌다.
    if (!(await askDanger(`'${work.title}' ${verb}`, notice, verb))) return;
    try {
      await call();
    } catch (e) {
      await showProblem(`${verb}하지 못했습니다: ${e}`);
      return;
    }
    // **성공한 뒤에** 거둔다(결정 26). 순서가 계약이다 — dirty 판정은 확인 대화가 아니라
    // 그 뒤 코어에서 나므로, 먼저 죽이면 거부당했을 때 **Work는 남고 돌던 claude만
    // 사라진다.** 터미널에서 claude를 돌리는 것 자체가 워크트리를 dirty로 만든다.
    closeShellsOf(work.slug);
  };

  // 문구는 실제로 남는 것과 사라지는 것을 **둘 다** 말한다. 아카이빙 쪽만 "보존"을 말하면
  // 대비로 인해 삭제가 커밋까지 지우는 것처럼 읽히고(브랜치는 양쪽 다 남는다), 워크트리
  // 제거가 gitignore된 파일(.env·로컬 DB·빌드 산출물)까지 가져간다는 사실은 **양쪽 다**
  // 적는다. 그 파일들은 dirty 검사에 잡히지 않으므로 이 문구가 유일한 경고이고, 둘 다
  // 같은 worktree_remove를 탄다 — 삭제 쪽은 스펙까지 지우니 더 잃는다.
  const handleArchive = () =>
    run(
      "아카이빙",
      "스펙과 기록은 남고 워크트리 폴더가 정리돼요. 브랜치와 커밋은 그대로예요.\n" +
        "다만 git이 무시하는 파일(.env, 로컬 DB, 빌드 산출물)은 폴더와 함께 사라져요.\n" +
        "되돌릴 수 없어요.",
      () => archive.mutateAsync(work.slug),
    );

  const handleRemove = () =>
    run(
      "삭제",
      "워크트리 폴더와 스펙 문서가 모두 지워져요. 브랜치와 커밋은 남지만 기록은 안 남아요 —\n" +
        "남길 것이 있다면 아카이빙을 쓰세요.\n" +
        "git이 무시하는 파일(.env, 로컬 DB, 빌드 산출물)도 폴더와 함께 사라져요.\n" +
        "되돌릴 수 없어요.",
      () => remove.mutateAsync(work.slug),
    );

  return (
    <span className="relative flex">
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-label="작업 메뉴"
        aria-expanded={open}
        aria-busy={busy}
        title={busy ? "처리 중이에요" : "작업 메뉴"}
        // **icon-button 규격이다** — 바로 왼쪽 ⓘ와 맞붙어 서기 때문이다.
        // 둘 사이에 여백이 없어(탭 줄 actions의 gap 없는 묶음) hover 배경이 한 버튼에서
        // 다음 버튼으로 끊김 없이 옮겨가고, 그 순간 상자가 다르면 배경이 커졌다 작아진다.
        // 22px·radius 7은 옛 이웃이던 상태 배지에 맞춰 둔 값인데, 그 배지가 오른쪽
        // actions로 가면서 맞춰야 할 상대가 24px 아이콘 버튼으로 바뀌었다.
        // icon-button-quiet을 쓰지 않는 것은 켜짐이 있어서다 — quiet-hover는 꺼진 가지 안에만 둔다.
        className={cn(
          "icon-button transition-colors",
          "disabled:pointer-events-none disabled:opacity-50",
          open ? "toggle-on" : "text-tertiary quiet-hover",
        )}
      >
        {/* 진행 표시는 여기가 아니라 본문을 덮는 LifecycleOverlay가 한다 — 14px 글리프의
            깜빡임은 워크트리 제거가 도는 수 초 동안 "눌리긴 했나"에 답하지 못했다.
            disabled는 그대로 둔다: 오버레이가 뜨기 전 한 프레임을 막는 것도 이 속성이다. */}
        <MoreHorizontal className="size-4" strokeWidth={2.2} />
      </button>
      {open && (
        <PopoverPortal
          anchorRef={anchor}
          width={190}
          onClose={() => {
            setOpen(false);
            setRenaming(false);
          }}
          className="flex flex-col gap-px p-[5px]"
        >
          {renaming ? (
            <TitleEditor
              work={work}
              onDone={() => {
                setRenaming(false);
                setOpen(false);
              }}
            />
          ) : (
            <>
              {/* **이름 바꾸기가 맨 위다.** 아래 둘은 되돌릴 수 없는 조작이라 확인 창을
                  거치는데, 이것은 되돌릴 수 있다 — 성질이 다른 것을 구분선으로 가른다. */}
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
              >
                <Pencil className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">이름 바꾸기</span>
              </button>
              <span className="my-[3px] h-px bg-border" />
              <button
                type="button"
                onClick={handleArchive}
                className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
              >
                <Archive className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">아카이빙</span>
              </button>
              <span className="my-[3px] h-px bg-border" />
              <button
                type="button"
                onClick={handleRemove}
                className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5 shrink-0" strokeWidth={1.9} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">삭제</span>
              </button>
            </>
          )}
        </PopoverPortal>
      )}
    </span>
  );
}

export default WorksPage;
