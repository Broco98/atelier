import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useMutationState } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { ChevronDown, MoreHorizontal, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyText } from "@/components/shell/copy-text";
import { Card, Frame, type HeadSlot } from "@/components/shell/Frame";
import { togglesPanel } from "@/components/shell/PanelToggle";
import { HEAD_GLYPH, headButton } from "@/components/shell/ShellHead";
import { PathBar } from "@/components/shell/PathBar";
import { TAB_ROW_CARD } from "@/components/shell/panel-layout";
import { WORK_PANEL_ID, WORK_PANEL_LABEL, WorkTools } from "@/components/shell/WorkTools";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { Spinner } from "@/components/ui/spinner";
import { Toaster, showToast } from "@/components/ui/toast";
import { Hint } from "@/components/ui/tooltip";
import { useProjects } from "@/features/projects/hooks";
import { WorkServiceCrumb } from "@/features/services/ServiceMenu";
import ShellTabs, { type ChatTabs } from "@/features/terminal/ShellTabs";
import TerminalPane from "@/features/terminal/TerminalPane";
import {
  activeIdOf,
  activeShellOf,
  activeTabOf,
  bundleOf,
  bundleTabOf,
  chatPlaceOf,
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
  closeViewTab,
  closeOtherShells,
  dropShellOnSlot,
  keepChatTabPlace,
  onNewShellRequested,
  onShellOpenRejected,
  openNewChat,
  openNewShell,
  renameShell,
  requestCloseShell,
  selectShell,
  selectShellWithFocus,
  settleNewChat,
  showChatTab,
  showCodeTab,
  showNewChatTab,
  showShellTab,
  terminalStore,
} from "@/features/terminal/terminal-store";
import { chatName } from "@/features/thread/chat-name";
import { useRenameThread, useThreads } from "@/features/thread/hooks";
import { forgetNewChat, newChatKey } from "@/features/thread/new-chat";
import { lastSaid } from "@/features/thread/preview";
import { cardDocFile, cardTabOf, docArrival, workSeat, type BodyTab } from "@/features/thread/right-place";
import { linesOf, threadRecordStore } from "@/features/thread/thread-store";
import { landingOf, type WorkLanding } from "@/features/thread/work-threads";
import { SummaryToggle, ThreadMenuItems } from "@/features/thread/ThreadHead";
import { useWorkRightPlace, WorkChat, WorkNewChat } from "@/features/thread/ThreadScreen";
import { codeRefOf, codeTargetOf } from "@/routes/-work-search";
import type { BundleShown, ViewTab } from "@/routes/-work-search";
import { armDrag, dragStore, hoverSlot } from "@/lib/pointer-drag";
import { cwdRef, worktreeDirRef } from "./refs";
import WorkPanel from "./WorkPanel";
import { WorkContextMenu } from "./WorkContextMenu";
import { StatusRadioItems, WorkMenuItems, type WorkMenuFlows } from "./WorkMenuItems";
import { WORK_LIFECYCLE_KEY, useSetWorkStatus, useSetWorkTitle, useWorks } from "./hooks";
import { STATUS_BADGE, STATUS_META } from "./status";
import { WORKS_COPY } from "./work-sections";
import { openWorkFolder, useWorkMenuFlows } from "./work-menu-actions";
import type { BundleTab, ShellOwner, ShellsState, ShellTally } from "@/features/terminal/shell-registry";
import type { WorkView } from "./types";

// 코드 보기는 따로 떼어 받는다(git-integration 결정 35) — 강조 라이브러리(`@pierre/diffs`)가 첫 로드에 붙지 않고 파일 탭이
// 처음 설 때 온다. 정적으로 부르면 그 약속이 조용히 깨진다(`code-view-chunk.test.ts`가 프로덕션 빌드로 잰다).
const CodeView = lazy(() => import("@/features/code/CodeView"));

interface WorksPageProps {
  sidebarOpen: boolean;
  selectedSlug: string | null;
  // 보고 있는 문서 — 주소가 정본이라 여기서 소유하지 않는다. **넓힌 카드의 문서다**(restart 02a-12) — 카드가 서는 탭(채팅 탭 · 새 채팅 탭)이
  // 본문일 때 이 값이 넓힌 카드를 열고, 카드가 다른 것을 열거나 닫히면 따라간다(`onOpenDoc`). 트리의 「지금 이 문서」도 이 값이다 — 없으면
  // 기본 문서로 눕히지 않는다(restart 02a-13).
  currentFile: string | null;
  // **넓힌 카드의 문서를 주소에 적는다**(restart 02a-12) — 켤 카드 탭(`landing`)이 있으면 그리로 옮기며 얹고, `null`이면 지금 카드 탭에 얹는다.
  // `path`가 `null`이면 걷는다. 주소를 쥔 쪽이 한 번에 옮긴다(`cardDocSearch`).
  onOpenDoc: (path: string | null, landing: WorkLanding | null) => void;
  // 보고 있는 화면 탭도 주소가 정본이다 — `currentFile`과 같은 결이다.
  tab: ViewTab;
  onSelectTab: (tab: ViewTab) => void;
  // 본문에 선 **파일 탭**(`<프로젝트>/<경로>`) — `tab`이 `code`일 때만 찬다(git-integration S12). 이것도 주소가 정본이다: 묶음(메모리)은
  // 이 값을 따라 그 탭을 열고 켠다. `onOpenCode`가 「파일 탭 열기」다 — 트리는 replace, 링크는 push다.
  code: string | null;
  onOpenCode: (project: string, path: string, push: boolean) => void;
  // 본문에 선 **채팅 탭**의 채팅(restart 02a-4) — `code`와 같은 결이다: `tab`이 `chat`일 때만 찬다. 묶음(메모리)은 이 값을 따라 그 탭을
  // 열고 켠다. `onOpenChat`이 「채팅 탭 열기」다 — 탭을 고르는 손짓이라 기록을 안 쌓는다(결정 13).
  thread: string | null;
  onOpenChat: (thread: string) => void;
  // **새 채팅 탭으로 간다**(restart 02a-8) — 주소를 `tab=chat`(`thread` 없음)으로 고친다. 어느 새 채팅 탭인지는 묶음이 쥐므로 그 칸을 세우거나
  // 켜는 일은 이 화면이 먼저 하고(`openNewChat` · `selectShell`), 주소를 쥔 쪽은 주소만 바꾼다 — 셸 탭과 같은 나눔이다.
  onOpenNewChat: () => void;
  /**
   * 주소가 **아직 탭을 고르지 않았다**(`opensWork` — 값이 없는 주소). 작업공간을 처음 여는 규칙이 주소를 고칠 때까지 기다린다 — 그 한 틱의
   * `tab`은 기본 값 `chat`이지만 새 채팅 탭이 아니다(restart 02a-8). 새 채팅 탭으로 치면 채팅이 있는 작업공간에도 새 채팅 탭이 하나 선다.
   */
  opening?: boolean;
  // 묶음의 지금 탭이 묶음 쪽에서 바뀌었다(닫기의 이웃 · 셸의 끝 · 첫 말로 채팅 탭이 된 새 채팅 탭) — 본문이 그 탭을 따라가게 주소를
  // 고친다. `bundle`은 그 탭이 주소에 남기는 것이다 — 파일 탭이면 그 파일, 채팅 탭이면 그 채팅, 셸이면 종류만(`BundleShown`).
  // 분할(`split`)과 그것을 켜고 끄는 콜백 · 본문 절반에 끌어 놓는 길은 걷혔다(restart 02a-13).
  onFollowBundle: (bundle: BundleShown) => void;
}

/**
 * ⌘W가 겨누는 칸 — **켜진 탭**이다(결정 13). 닫을 것이 없으면 `null`이다.
 *
 * 「켜진 탭이 무엇인가」는 이 화면만 안다. 두 갈래로 `null`이 나온다:
 * - **본문이 셸이 아니다.** 채팅 탭 · 파일 탭은 아래 `viewTabClosedByTab`이 겨눈다.
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
 * 보기 탭(파일 탭 · 채팅 탭 · 새 채팅 탭)을 **확인 없이** 닫는다 — 칸만 빠진다(`closeViewTab`). 새 채팅 탭이면 그 탭의 글 · 첨부 · 인용도
 * 함께 지운다(restart 02a-8 — 열쇠가 탭마다라 닫은 탭의 것은 다시 설 곳이 없다). 칸 id는 앱이 도는 동안 다시 쓰지 않아 다른 종류의 칸
 * id로 지어도 그 열쇠에는 아무것도 없다 — 종류를 묻지 않고 지운다(`forgetNewChat`은 지울 것이 없으면 아무 일도 안 한다).
 */
function closeBundleView(id: number): void {
  forgetNewChat(newChatKey(id));
  closeViewTab(id);
}

/**
 * ⌘W가 겨누는 **보기 탭** — 본문이 파일 탭(git-integration 스토리 50)이나 채팅 탭(restart 02a-5) · 새 채팅 탭(02a-8)이면 그 칸이다. 아니면
 * `null`이다. 주소가 말하는 종류와 지금 탭의 종류가 같을 때만이다 — 본문에 선 것과 다른 칸을 닫지 않는다. 새 채팅 탭의 주소는 채팅 탭과 같은
 * `chat`이다.
 *
 * 위 `shellClosedByTab`과 **따로 둔다** — 닫는 길이 다르다: 보기 탭은 확인 없이 닫고(`closeViewTab`), 셸은 확인 창을 거치는
 * 하나다(`requestCloseShell`). 한 함수가 둘을 돌려주면 받는 쪽이 종류를 다시 갈라야 하고, 그 갈림이 틀리면 셸이 확인 없이 닫힌다.
 */
export function viewTabClosedByTab(
  tab: ViewTab,
  owner: ShellOwner | null,
  state: ShellsState,
): number | null {
  if ((tab !== "code" && tab !== "chat") || owner === null) return null;
  const active = activeTabOf(state, owner);
  const kind = active?.kind === "new-chat" ? "chat" : active?.kind;
  return kind === tab ? (active?.id ?? null) : null;
}

/**
 * 묶음의 지금 탭이 주소에 남기는 것(`BundleShown`) — 파일 탭이면 그 파일, 채팅 탭이면 그 채팅, 새 채팅 탭이면 종류만(restart 02a-8 — 어느
 * 탭인지는 묶음이 쥔다), 셸이거나 칸이 없으면 셸이다.
 */
function shownOf(tab: BundleTab | null): BundleShown {
  if (tab?.kind === "code") return { kind: "code", code: codeRefOf(tab) };
  if (tab?.kind === "chat") return { kind: "chat", thread: tab.thread };
  if (tab?.kind === "new-chat") return NEW_CHAT;
  return SHELL;
}

/** 지금 탭이 새 채팅 탭이다 — 어느 새 채팅 탭인지는 주소에 없으므로 한 값으로 접는다(셸과 같다). */
const NEW_CHAT: BundleShown = { kind: "new-chat" };

/** 지금 탭이 셸이다 — 어느 셸인지는 주소에 없으므로(결정 33) 한 값으로 접는다. 회차를 넘어 같은 값이다. */
const SHELL: BundleShown = { kind: "shell" };

/**
 * `BundleShown`을 한 글자로 — 화면이 「지금 탭이 바뀌었나」를 값으로 견주는 자리(`WorksPage`의 주소 따라가기)가 쓴다. 셸은 `shell:`,
 * 채팅은 `chat:<id>`다 — 파일 탭의 `<프로젝트>/<경로>`는 콜론으로 시작하는 프로젝트 이름이 없어 둘과 겹치지 않는다.
 */
function shownKeyOf(shown: BundleShown): string {
  if (shown.kind === "code") return shown.code;
  if (shown.kind === "chat") return `chat:${shown.thread}`;
  return shown.kind === "new-chat" ? "new-chat:" : "shell:";
}

/** 그 화면 **묶음의 지금 탭**이 주소에 남기는 것 — 묶음 쪽에서 지금 탭이 바뀐 순간에 읽는다(아래 「묶음 → 주소」). */
function bundleShownOf(state: ShellsState, owner: ShellOwner | null): BundleShown {
  return shownOf(owner === null ? null : activeTabOf(state, owner));
}

/**
 * **본문 탭**(restart 02a-10 · `BodyTab`) — 본문에 선 탭이다. 카드가 서는 탭(채팅 탭 · 새 채팅 탭)이면 그 칸의 id, 셸 · 파일 탭이면
 * `null`이다. 주소가 가리키는 칸이 아직 묶음에 서지 않은 한 틱(주소 → 묶음이 아직 안 돌았다)은 `undefined`다 — 그 틱의 지금 탭은 앞
 * 탭이라 세면 탭이 두 번 바뀐 것으로 읽힌다.
 */
function bodyTabOf(state: ShellsState, owner: ShellOwner, chat: string | null, newChat: boolean): BodyTab | undefined {
  if (chat !== null) return bundleOf(state, owner).find((tab) => tab.kind === "chat" && tab.thread === chat)?.id;
  if (!newChat) return null;
  const active = activeTabOf(state, owner);
  return active?.kind === "new-chat" ? active.id : undefined;
}

function WorksPage({
  sidebarOpen,
  selectedSlug,
  currentFile,
  onOpenDoc,
  tab,
  onSelectTab,
  code,
  onOpenCode,
  thread,
  onOpenChat,
  onOpenNewChat,
  opening = false,
  onFollowBundle,
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

  // work 메뉴의 흐름 — 머리 줄의 ⋯와 이름의 우클릭 메뉴가 함께 쓴다(`work-menu-actions.ts`).
  const menuFlows = useWorkMenuFlows();
  // **머리 줄 이름을 고치는 중인 work**(codex-ds 스펙 §9) — 들어가는 길이 셋이라(이름의 두 번 클릭 · F2, ⋯와 이름 우클릭 메뉴의
  // 「이름 바꾸기」) 그 셋을 다 가진 이 화면이 쥔다. 값이 slug인 것은 고른 work가 바뀌면 그 그림에서 곧바로 꺼지게 하려는 것이다
  // (`editing`이 `selected.slug`와 견준다) — 다른 work의 이름 자리에 고치던 입력칸이 남지 않는다. 키로 옮겨(⌘J) 입력칸이 blur 없이
  // 내려가도 입력칸이 마지막 그림의 값(고치던 work)으로 저장하고 끝을 알려 이 값을 비운다(`InlineRename`).
  const [renamingHead, setRenamingHead] = useState<string | null>(null);
  const setTitle = useSetWorkTitle();
  // spec 패널의 상자 · 폭 · 레일은 이 화면이 아니라 앱 셸의 작업공간 도구 기둥이 든다(restart 02a-14 · `WorkTools`) — 화면이 바뀌어도 그 자리에
  // 남아 작업공간을 떠날 때 레일과 함께 접힌다. 이 화면은 서 있는 동안 기둥에 열림 · 여닫기 · 바쁨을 건네고 패널의 몸을 그 자리로 보낸다(아래
  // `WorkTools`). 한때 레일의 칸(`spec` · `files`)을 이 화면이 골랐다 — files 칸이 걷혀 칸은 `spec` 하나다.

  // 끌고 있는 것. **드래그 중에만 값이 있다** — 그동안만 이 화면이 다시 그려진다.
  const drag = useStore(dragStore, (state) => state);

  // 복사 확인 토스트는 **이 화면이 낸다**(결정 47). 앞 판에서는 문서 본문의 지역 상태라
  // **터미널 탭에서 트리를 복사하면 아무 말이 없었다** — 그 탭에는 문서 본문이 없었다.
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

  // 첫 항목으로 조용히 떨어지지 않는다 — 무선택은 주소 쪽에서 정규화한다 (routes/works.index.tsx).
  // 「기억한 것 → 목록 첫 줄」 규칙도 그쪽 pickSlug가 들고 있다.
  const selected = works.find((w) => w.slug === selectedSlug) ?? null;

  // **도는 아카이브 · 삭제를 캐시에서 읽는다** — 진행 표시가 메뉴 하나가 아니라 카드 줄 전체를 덮기 때문이다(`LifecycleOverlay`).
  // 그 조작을 부르는 메뉴는 넷이라(⋯ · 사이드바 행 · 띠 줄 · 머리 줄 이름 — codex-ds 결정 6) 어느 하나가 상태를 쥘 수 없고, 뮤테이션
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
  // `tab`은 따라오지 않으므로 이 가지가 곧 닫힌다. 채팅 · 파일 가지는 붙들지 않는다 — 거기서는
  // 다시 마운트돼도 다시 읽을 뿐 프로세스가 생기지 않는다.
  const lastSelected = useRef(selected);
  if (selected) lastSelected.current = selected;
  // **본문은 하나다** — `tab`이 셸 · 파일 탭 · 채팅 탭 중 하나를 고른다. 한때 분할이면 문서와 묶음 열 둘이 섰다(결정 87 — restart 02a-13이
  // 걷었다).
  //
  // **파일 탭**은 본문에 선다(git-integration 티켓 04). 그때 터미널 카드는 내려간다 — 셸 프로세스와 화면 버퍼는 스토어에 산다(결정 20 · 21).
  const codeTarget = code !== null && tab === "code" ? codeTargetOf(code) : null;
  // **채팅 탭**(restart 02a-4)도 본문에 선다 — 파일 탭과 같은 결이다. 주소의 `code`와 `thread`는 함께 서지 않는다(묶음의 지금 탭은 하나다 —
  // `chatSearch` · `codeSearch`). 채팅 탭은 `thread`가 아직 없을 수 있다 — 어느 채팅인지 모르는 주소에 닿은 한 틱이고, 주소를 쥔 쪽이 작업공간을
  // 처음 여는 규칙으로 고친다(`-works-view`).
  const chatThread = codeTarget === null && tab === "chat" ? thread : null;
  // **새 채팅 탭**(restart 02a-8) — `tab=chat`에 `thread`가 없으면 새 채팅 탭이 본문에 선다. 어느 새 채팅 탭인지는 묶음이 쥔다(셸과 같다 — 아래
  // 「주소 → 묶음」이 지금 탭을 새 채팅 탭으로 맞춘다).
  const newChatShown = selected !== null && tab === "chat" && chatThread === null && !opening;
  const terminalStands = tab === "terminal";
  // 주소가 본문(셸 · 파일 탭 · 채팅 탭 · 새 채팅 탭)에 세우라고 말하는 것 — 묶음 쪽 변화가 이미 주소를 따른 것인지 잴 때 견준다.
  const addressShown: BundleShown =
    codeTarget !== null
      ? { kind: "code", code: codeRefOf(codeTarget) }
      : chatThread !== null
        ? { kind: "chat", thread: chatThread }
        : newChatShown
          ? NEW_CHAT
          : SHELL;
  const terminalWork = terminalStands ? (selected ?? lastSelected.current) : null;

  // 패널이 딛고 선 작업. 두 본문 중 어느 것이 서 있든 **같은 패널 하나**가 옆에 선다
  // (결정 49). 터미널 탭에서 `terminalWork`가 붙들어 둔 작업을 쓰는 것도 그대로 따라온다 —
  // 본문이 그 작업의 셸을 보여주는데 패널만 다른 작업을 말하면 안 된다.
  const panelWork = terminalWork ?? selected;

  // **오른쪽 자리**(restart 02a-9 · 구현 스펙 「02a — 오른쪽 자리」 · 보드 SummarySheet) — spec 패널(작업 패널)과 요약 카드가 본문 카드 오른쪽의
  // 한 자리를 나눠 쓰는 값 하나다(`spec` · `summary` · 없음). **작업공간마다 하나이고 이 화면이 쥔다**(`useWorkRightPlace` — 한때 패널 열림은
  // 이 화면의 값 하나(`workPanelOpen`)라 작업을 옮겨도 따라왔고, 요약 카드 열림 · 넓힌 카드는 채팅 화면의 지역 상태였다). 머리 줄의 패널
  // 토글 · ⌘Enter · 레일 칸이 spec 패널을, 창 머리의 「요약 카드」가 요약 카드를 여닫는다. 넓힌 카드는 채팅 탭 · 새 채팅 탭이 본문에 서 있을 때만이고(`chat`),
  // 넓은 동안 사이드바가 접힌다. 처음 값은 spec 패널이다(한때 분할인 채 열면 접혀 있었다 — 결정 88, restart 02a-13이 분할을 걷었다).
  //
  // **탭을 옮겨도 표의 규칙이 지켜진다**(restart 02a-10 · SummarySheet 표의 탭 줄) — 본문 탭(`bodyTab`)이 셸 · 파일 탭으로 바뀌면 요약 카드가
  // 닫히고, 다른 채팅 탭으로 바뀌면 넓힌 카드가 작은 카드로 돌아온다. 본문 탭은 칸의 id로 잰다 — 새 채팅 탭이 첫 말로 채팅 탭이 되어도 같은
  // 칸이라 같은 탭이다(`settleNewChat`). 묶음 쪽 변화를 한 값으로 접어 구독한다 — 셸 타이틀에 이 화면이 다시 그려지지 않게.
  const bodyTab = useStore(terminalStore, (state) =>
    selected === null || opening ? undefined : bodyTabOf(state, ownerOf(selected.slug), chatThread, newChatShown),
  );
  const right = useWorkRightPlace(panelWork, {
    // 카드가 서는 탭(채팅 탭 · 새 채팅 탭 — restart 02a-11)이 본문일 때만 넓힌 카드가 선다.
    chat: selected !== null && (chatThread !== null || newChatShown),
    tab: bodyTab,
    // 넓힌 카드의 Project 트리에서 바뀌지 않은 파일은 파일 탭으로 연다(restart 02a-12 · 스토리 102) — 트리 훑기라 replace다. 파일 탭이 켜지면 탭 줄
    // 규칙이 카드를 닫는다(02a-10).
    openFile: (target) => onOpenCode(target.project, target.path, false),
  });
  const { move: moveRight, panelOpen } = right;

  // spec 패널을 여닫는다 — 머리 줄의 패널 토글 · 레일의 spec 칸 · ⌘Enter가 같은 일이다(SummarySheet 표 「레일의 spec을 누른다」 — 요약 카드가
  // 서 있으면 걷고 패널을 연다). 칸이 하나라 레일도 여닫기 하나다 — 한때 칸이 둘이라 「켜진 칸을 다시 누르면 닫히고 다른 칸이면 바꾼다」였다.
  const togglePanel = useCallback(() => moveRight({ kind: "toggle", place: "spec" }), [moveRight]);

  // Cmd+Enter — 본문을 넓히는 토글. 원래 의미가 "콘텐츠 확대·축소"였고 대상이 목록 패널이었던 건
  // 그게 유일한 접이식이었기 때문이다. 이 화면에서 그 자리를 작업 패널(오른쪽 자리의 spec 패널)이 물려받는다 — 패널 토글과 같은 손짓이다.
  //
  // **두 탭 모두에서 듣는다**(결정 43). 한때 여기 있던 터미널 탭 가드 한 줄 — 탭만 보고
  // 그냥 돌아가던 것 — 을 지웠다. 어느 경우가 셸 몫인지는 `togglesPanel`이 혼자 알고(패널 토글 곁 — Archive의 ⌘Enter와
  // 한 벌이다), 그 판단은 탭이 아니라 **포커스**로 갈린다. `tab`을 안 보므로 의존성은 오른쪽 자리를 바꾸는 길 하나다.
  //
  // (그 줄의 글자를 여기 옮겨 적지 않는다 — 되살아났는지 보는 검사가 주석까지 읽는다.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!togglesPanel(e)) return;
      e.preventDefault();
      moveRight({ kind: "toggle", place: "spec" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveRight]);

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
  // **듣는 범위가 이 화면 전체다**(결정 98). ⌘1~9가 묶음의 칸으로 본문을 옮기는 한 벌인데
  // ⌘T만 안 옮기면 혼자 어긋난다 — 그래서 어느 본문에서도 듣고, 열면 본문을 함께 옮긴다.
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
  //
  // **작업공간의 ⌘T는 새 채팅 탭을 연다**(restart 02a-8 — `+` 메뉴의 맨 윗줄이 「새 채팅」이고, `+` → Enter 한 번이 ⌘T와 같다는 규칙(#222)이
  // 그대로 선다). 셸은 `+` 메뉴의 셸 줄로 연다. 셸 안 ⌘T(`requestNewShell`)도 같은 길이다 — 셸 안과 밖이 같은 키다.
  const startNewChat = useCallback(() => {
    if (tabOwner === null) return;
    if (openNewChat(tabOwner) !== null) onOpenNewChat();
  }, [tabOwner, onOpenNewChat]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!opensShellFromWindow(e)) return;
      e.preventDefault();
      startNewChat();
    };
    window.addEventListener("keydown", onKeyDown);
    // 고른 작업이 없으면 이 화면의 셸도 없다 — 들을 요청이 없다.
    const stop = tabOwner === null ? () => {} : onNewShellRequested(tabOwner, startNewChat);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      stop();
    };
  }, [tabOwner, startNewChat]);

  /**
   * ⌘1~9는 **그 화면의 묶음**, ⌃Tab은 그 묶음의 순회(결정 78·79·109 · git-integration 결정 31). 한때 ⌘1이 `spec` 탭이라 묶음은 ⌘2부터였다
   * (restart 02a-13이 `spec` 탭을 걷었다 — 이제 ⌘1이 묶음의 첫 칸이다. `/terminal`과 같다).
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
      // 묶음 앞에 고정 칸이 없어 ⌘1이 첫 칸이다(`firstKey` 1).
      const next = shellForNav(tabs, activeIdOf(state, owner), nav, 1);
      if (next === null) return;
      // 고른 칸이 파일 탭이면 그 파일로, 채팅 탭이면 그 채팅으로 간다 — 켜는 일은 주소를 받은 자리가 한다(아래 주소 따라가기).
      const picked = bundleTabOf(state, owner, next);
      if (picked?.kind === "code") {
        onOpenCode(picked.project, picked.path, false);
        return;
      }
      if (picked?.kind === "chat") {
        onOpenChat(picked.thread);
        return;
      }
      selectShell(next);
      // 새 채팅 탭이면 그 탭을 켜고 본문이 새 채팅 탭이 된다(restart 02a-8) — 어느 새 채팅 탭인지는 묶음이 쥐어 켜는 것은 여기서 한다(셸과 같다).
      if (picked?.kind === "new-chat") onOpenNewChat();
      else onSelectTab("terminal");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panelWork, onSelectTab, onOpenCode, onOpenChat, onOpenNewChat]);

  /**
   * ⌘W — **켜진 탭을 닫는다**(결정 13).
   *
   * 이 키를 window에서 듣게 된 근거는 **겨눌 칸이 화면에 서게 된 것** 하나다. 한때
   * `opensShellFromWindow`의 머리말이 「⌘W는 안 넓힌다 — 겨눌 칸은 셸에 포커스가 있을
   * 때만 뚜렷하다」고 적었는데, 탭 줄이 그 전제를 없앴다(adr-03).
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
      // 본문이 보기 탭(파일 탭 · 채팅 탭)이면 **확인 없이** 닫는다(git-integration 스토리 50 · restart 02a-5) — 프로세스가 없어 물을
      // 것이 없고, 채팅 탭은 칸만 빠져 채팅과 돌던 턴이 남는다. 다음 탭과 주소는 셸을 닫을 때와 같은 길로 따라온다(이웃 규칙 · 아래
      // 주소 따라가기).
      const viewId = viewTabClosedByTab(tab, tabOwner, terminalStore.state);
      if (viewId !== null) {
        e.preventDefault();
        closeBundleView(viewId);
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
   * **주소 → 묶음**(git-integration S12 — 주소가 정본이다). 주소가 파일 탭 · 채팅 탭(restart 02a-4)을 가리키면 그 탭이 묶음의 지금
   * 탭이다 — 묶음에 없으면 끝에 연다(스토리 60: 뒤로가기 · work 기억 · 링크가 닫힌 탭을 가리킬 수 있다 — 사이드바의 채팅 줄이 탭을 세우는
   * 길도 이것이다). 주소가 「본문은 셸이다」라고 말하는데(`tab=terminal`) 지금 탭이 셸이 아니면 셸을 켠다.
   *
   * **주소가 바뀔 때만 돈다** — 묶음이 바뀌었다고 돌면 방금 닫은 파일 탭을 주소가 아직 가리키는 한 틱에 그 탭을 되살린다.
   * 묶음 쪽에서 난 변화를 주소로 옮기는 것은 아래 효과의 일이다.
   */
  useEffect(() => {
    if (tabOwner === null) return;
    if (codeTarget) showCodeTab(tabOwner, codeTarget);
    else if (chatThread !== null) showChatTab(tabOwner, chatThread);
    // 새 채팅 탭(restart 02a-8) — 지금 탭이 새 채팅 탭이면 그대로, 아니면 묶음의 첫 새 채팅 탭을 켜고, 없으면 끝에 하나 세운다
    // (`withNewChatActive`). 처음 여는 규칙이 주소를 고치는 한 틱은 세지 않는다(`opening`).
    else if (newChatShown) showNewChatTab(tabOwner);
    else if (tab === "terminal") showShellTab(tabOwner);
  }, [tabOwner, tab, code, thread, opening]);

  /**
   * **묶음 → 주소.** 묶음의 지금 탭이 묶음 쪽에서 바뀌면 — 지금 탭을 닫아 이웃이 켜졌거나(결정 30), 셸이 스스로 끝나 빠졌다
   * (결정 48) — 주소가 그 탭을 따라간다: 셸이면 `tab=terminal`이고 `code`가 없으며, 파일 탭이면 `code`가 그 파일이다. 이 갈림을 닫는
   * 길마다 적지 않고 여기 하나에 둔다 — 셸을 닫는 길은 확인 창 뒤(`requestCloseShell`)와 셸 스스로의 끝까지 여럿이다.
   *
   * 묶음이 빈 것은 따로다(아래 「묶음이 비면 새 채팅 탭」). **work을 옮긴 순간은 세지 않는다** — 그때의 지금 탭은 다른 work의 것이다.
   *
   * 지금 탭은 한 글자로 접어 구독한다 — 셸이 프롬프트마다 쏘는 타이틀에 이 화면이 다시 그려지지 않게. **의존성이 그 값과
   * 소유자뿐인 것은 의도다** — 주소(`tab` · `code`)가 바뀌어서 돌면 방금 사람이 옮긴 주소를 옛 지금 탭으로 되돌린다.
   */
  const shownKey = useStore(terminalStore, (state) => {
    const active = tabOwner === null ? null : activeTabOf(state, tabOwner);
    return active === null ? null : shownKeyOf(shownOf(active));
  });
  const shown = useRef({ owner: tabOwner, key: shownKey });
  useEffect(() => {
    const before = shown.current;
    shown.current = { owner: tabOwner, key: shownKey };
    if (before.owner !== tabOwner || before.key === shownKey || shownKey === null || tabOwner === null) return;
    // 주소가 이미 그 탭을 말한다 — 주소를 따라 켜진 탭이다(위 「주소 → 묶음」).
    if (shownKey === shownKeyOf(addressShown)) return;
    onFollowBundle(bundleShownOf(terminalStore.state, tabOwner));
  }, [tabOwner, shownKey]);

  /**
   * **주소의 문서와 넓힌 카드**(restart 02a-12 · 구현 스펙 「02a — `spec` 탭과 분할을 지운다」) — 주소의 `file`은 넓힌 카드의 문서다. 카드가 서는 탭이
   * 본문일 때(`cardBody`)만 뜻이 있다.
   *
   * - **주소 → 카드.** 문서가 닿으면(검색 결과 · 화면 기억 · 처음 여는 규칙이 고른 탭으로 따라온 `?file=`) 넓힌 카드가 그 문서를 연다. 없는 문서면
   *   열지 않고 주소에서 걷는다(`docArrival`). 작업공간 · 문서가 바뀌거나 카드가 서는 탭이 본문이 될 때만 잰다 — 처음 여는 규칙이 탭을 고른 뒤에
 *   연다.
   * - **카드 → 주소.** 넓힌 카드가 다른 문서를 열면 그 문서로, 닫히거나(× · 요약 단추 · 레일의 spec · 다른 채팅 탭) 문서가 아닌 것을 열면 걷는다
   *   (`cardDocFile`). 카드 쪽에서 바뀐 것만 센다 — 작업공간이나 주소의 문서가 함께 바뀐 틱은 위 「주소 → 카드」의 몫이라 건너뛴다. 셸 · 파일 탭으로
   *   간 것은 그 주소가 이미 걷었다(`tabSearch`).
   */
  const cardBody = selected !== null && (chatThread !== null || newChatShown);
  const cardDoc = right.card.opened?.kind === "doc" ? right.card.opened.path : null;
  useEffect(() => {
    if (!cardBody || selected === null || currentFile === null) return;
    const move = docArrival(currentFile, selected.specFiles, right.card.opened);
    if (move === "clear") onOpenDoc(null, null);
    else if (move !== null) moveRight(move);
  }, [selected?.slug, currentFile, cardBody]);
  const seenCard = useRef({ slug: selected?.slug, file: currentFile, doc: cardDoc });
  useEffect(() => {
    const before = seenCard.current;
    seenCard.current = { slug: selected?.slug, file: currentFile, doc: cardDoc };
    if (!cardBody || before.slug !== selected?.slug || before.file !== currentFile || before.doc === cardDoc) return;
    const next = cardDocFile(right.card.opened, currentFile);
    if (next !== undefined) onOpenDoc(next, null);
  }, [selected?.slug, currentFile, cardDoc, cardBody]);

  // 트리의 「지금 이 문서」 — 주소의 문서(넓힌 카드의 문서)가 spec 폴더에 있을 때만 선다. **기본 문서로 눕히지 않는다**(restart 02a-13 · 구현
  // 스펙 「작업공간을 열어도 기본 문서를 열지 않는다」 — spec 레이아웃 결정 14를 뒤집는다). 한때 주소에 문서가 없거나 없는 파일을 가리키면 spec 트리의
  // 기본 문서(`specTree.defaultDoc`)로 눕혀 문서 탭에 세웠다. 그 값은 코어가 그대로 보낸다(L4가 잰다) — 화면만 읽지 않는다.
  const specFiles = panelWork?.specFiles ?? [];
  const currentDoc = currentFile !== null && specFiles.includes(currentFile) ? currentFile : null;

  /**
   * **묶음의 마지막 칸이 닫히면 새 채팅 탭이 선다**(restart 02a-8 — 한때 「묶음이 비면 spec」이었다, git-integration 결정 30). 세는 것은
   * 셸이 아니라 **묶음의 칸**이다 — 셸이든 파일 탭이든 채팅 탭이든 새 채팅 탭이든 마지막 칸이 빠지면 새 채팅 탭 하나를 세운다. 작업공간의
   * 묶음은 비지 않는다.
   *
   * 본문이 그 새 채팅 탭으로 간다 — 따로 옮기지 않는다: 세운 칸이 지금 탭이 되고, 「묶음 → 주소」가 그것을 따라간다(`bundleSearch`).
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
    if (emptied && tabOwner !== null) openNewChat(tabOwner);
  }, [tabCount, tabOwner]);

  // 코드 카드의 경로 줄(git-integration S17) — 문서의 경로 줄과 같은 줄이다: 캡슐 `<프로젝트> › 폴더 › 파일`과 끝의 경로 복사. 보기
  // 묶음은 없다 — 코드 카드의 몸은 늘 코드다. 복사하는 값은 그 파일의 워크트리 경로다 — 에이전트에게 그 파일을 그대로 넘긴다(스토리
  // 69). 워크트리 자리는 코어가 준 값에서 잇는다(`worktreeDirRef` — 뿌리를 여기서 짓지 않는다). 그 프로젝트의 워크트리가 이 work에
  // 없으면 가리킬 파일이 없어 서지 않는다 — 프로젝트는 있는데 워크트리 폴더가 사라진 것(`exists`가 거짓 — 워크트리 트리가 「워크트리
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

  // `key`는 Work마다 다시 마운트시킨다: 셸은 스토어가 들고 있어 안 죽고, 다시 붙는 자리만 새로 잡힌다(in-app-terminal
  // 결정 20·21). 프로세스 결정 7이 입력 없는 자동 셸만 예외로 두었다 — 그 셸은 work을 떠날 때 앱 루트(`ShellReclaim`)가 닫는다.
  const terminalBody = terminalWork && <TerminalPane key={terminalWork.slug} work={terminalWork} />;
  // 코드 보기 — 코드 카드의 몸이다. 몸은 그 파일을 읽어 강조된 코드나 갈래별 몸(그림 · 안내)을
  // 세운다(`CodeView`). 코드 보기 청크를 받는 처음 한 번은 몸이 비어 있다 — 머리(경로 줄)는 이미 서서 무엇을 여는지 말한다.
  const codeBody = selected && codeTarget && (
    <Suspense fallback={null}>
      <CodeView
        key={selected.slug}
        slug={selected.slug}
        target={codeTarget}
        worktreeDir={codeWorktreeDir}
        // 문서 본문(`SpecViewer`)과 같은 규칙으로 넓어진다 — 화면을 둘 다 비웠을 때만.
        wide={!sidebarOpen && !panelOpen}
      />
    </Suspense>
  );

  // 채팅 탭의 몸 — 채팅의 흐름과 입력창이다(restart 02a-4 · `WorkChat`). 머리는 탭 줄이라 채팅은 머리 없이 몸만 꽂는다. 채팅마다 새로
  // 선다(`key`) — 굴린 자리 · 펼친 줄이 다른 채팅으로 따라가지 않게(`/threads/:id`와 같다).
  //
  // **켜진 채팅 탭 하나만 꽂는다 — 숨은 채팅 탭은 내려간다**(restart 02a-6 · 구현 스펙 「02a — 숨은 탭」). 기록 구독과 조각 그리기가
  // 함께 멈춘다. 기록 · 글 · 첨부 · 인용은 스토어에 있어 남고, 굴림 자리는 묶음의 그 탭이 쥔다 — 몸이 내려갈 때 건네고(`onLeave`),
  // 돌아오면 그 자리에서 선다(`place`). 쥐는 길은 그때의 묶음에서 탭을 찾는다 — 닫힌 탭에는 쥐지 않는다.
  const chatBody = selected && chatThread !== null && (
    <WorkChat
      key={chatThread}
      thread={chatThread}
      card={right.card}
      place={chatPlaceOf(shellState, ownerOf(selected.slug), chatThread)}
      onLeave={(place) => keepChatTabPlace(ownerOf(selected.slug), chatThread, place)}
    />
  );

  // **새 채팅 탭의 몸**(restart 02a-8) — 입력창 하나다(`WorkNewChat` — 홈의 새 채팅과 같은 몸, 이 작업공간에 이어 보낸다). 글 · 첨부 ·
  // 인용은 탭마다의 열쇠에 산다(`newChatKey`). 첫 말의 답이 오면 그 칸이 그 채팅의 채팅 탭이 된다(`settleNewChat` — 켜짐은 그대로다).
  // 켜져 있었으면 「묶음 → 주소」가 주소를 그 채팅으로 옮기고, 꺼져 있었으면 주소는 그대로다 — 그 탭으로 끌고 오지 않는다.
  //
  // **숨은 새 채팅 탭은 내리지 않는다**(구현 스펙 「02a — 숨은 탭」의 예외). 고른 서비스 · 보내는 중 상태는 그 몸의 지역 상태라 내리면
  // 사라진다 — 채팅 탭처럼 스토어에 쥘 것이 없다. 그래서 그 작업공간의 새 채팅 탭을 **모두** 꽂고 켜진 하나만 보인다. 본문 카드마다 같은
  // 자리(첫 자식)에 꽂는다 — 카드가 하나라(`Card`) 셸 · 파일 · 채팅을 오가도 그 자리의 몸이 그대로 산다. 작업공간을 옮기면 내려간다.
  //
  // **켜진 새 채팅 탭에 오른쪽 자리를 건넨다**(restart 02a-11) — 채팅 탭 몸과 같은 값(`right.card`)이라 요약 카드 · 넓힌 카드가 선다. 숨은 탭은
  // 받지 않는다 — 카드가 보이지 않는 곳에서 변경 · PR을 읽지 않게.
  const visibleNewChat = newChatShown && tabOwner !== null ? activeTabOf(shellState, tabOwner) : null;
  const newChats =
    panelWork &&
    bundleOf(shellState, ownerOf(panelWork.slug)).flatMap((one) =>
      one.kind === "new-chat"
        ? [
            <div key={one.id} data-new-chat={one.id} className={visibleNewChat?.id === one.id ? "contents" : "hidden"}>
              <WorkNewChat
                work={panelWork.slug}
                draftKey={newChatKey(one.id)}
                card={visibleNewChat?.id === one.id ? right.card : null}
                onStarted={(started) => {
                  settleNewChat(one.id, started);
                  forgetNewChat(newChatKey(one.id));
                }}
              />
            </div>,
          ]
        : [],
    );

  // 채팅 탭의 이름 — 칸은 채팅 id만 든다. 이름은 채팅 목록(사이드바와 같은 캐시)에서 읽는다 — 사이드바 채팅 줄과 같은 말이다(`chatName`).
  const { data: threads } = useThreads();
  const chatTitle = useCallback((id: string) => chatName(threads?.find((one) => one.id === id)), [threads]);
  // 채팅 탭의 몫(restart 02a-5 — 탭 줄의 `chat`). 칸에서 고친 이름은 채팅 이름 명령으로 간다 — 머리 줄에서 고치던 것과 같은 길이고, 답(바뀐
  // 요약)이 목록과 연 채팅의 이름을 고쳐 사이드바 줄 · 탭이 함께 바뀐다. 못 바꾸면 토스트로 말한다(탭에는 까닭을 적을 자리가 없다).
  // 우클릭 메뉴 앞머리는 채팅의 ⋯ 항목이다 — 정의는 채팅 쪽 한 자리다(`ThreadMenuItems`).
  const renameThread = useRenameThread();
  const chatTabs: ChatTabs = {
    title: chatTitle,
    onRename: (thread, title) =>
      renameThread.mutate(
        { thread, title },
        { onError: (failure) => showToast(`채팅 이름을 바꾸지 못했어요: ${String(failure)}`, "rejected") },
      ),
    menu: (rename) => <ThreadMenuItems rename={rename} />,
  };

  // 탭 줄(결정 7·10) — 셸을 고르는 자리가 사이드바 가지에서 화면 안으로 되돌아왔다(adr-03). 브레드크럼
  // (`Works / 제목`)은 그때 사라졌고, work 제목은 지금 머리 줄이 말한다(아래 `head`).
  //
  // **그 줄이 본문 카드의 머리다**(codex-ds 스펙 §4 「탭 줄」) — 탭이 그 탭이 보여 줄 카드에 붙는다. 본문 카드(채팅 · 터미널 · 코드 어느
  // 쪽이든 같은 자리)의 머리다. **맨 앞이 묶음의 첫 칸이다**(restart 02a-13) — 한때 그 앞에 고정 칸 `spec`과 세로선이 섰다. 문서는 spec 패널의
  // 문서 줄에서 넓힌 카드로 연다(02a-12). 고른 작업이 없으면 **칸이 설 자리가 없다** — 세울 소유자가 없다: 그 값은
  // work의 slug에서 나오는데(`ownerOf(…)`) 고른 작업이 없으면 그 자리가 비고, 빈 키는 **최상위 터미널**이라 `/terminal`의 셸이
  // 이 줄에 서게 된다. `+`도 열 자리가 없어 눌러도 아무 일이 없는 버튼이 된다(결정 11·21이 금지하는 것). 그때 본문 카드의
  // 머리는 화면 이름이다(아래 `body`).
  const tabRow = panelWork ? (
    <ShellTabs
      state={shellState}
      owner={ownerOf(panelWork.slug)}
      // **`worktrees`에서 뽑는다 — `projects`가 아니다.** `workShellOrigin`이 갈리는 기준이
      // `worktrees`라, 둘이 어긋나면 메뉴는 열리는데 고른 값으로 셸이 안 생긴다 — 눌러도
      // 아무 일이 없는 버튼(결정 11·21이 금지하는 것)이 된다.
      projects={workShellProjects(panelWork)}
      // 메뉴 맨 윗줄 「모든 프로젝트」 옆의 옅은 경로(UI개선 결정 20). ⌘T와 「모든 프로젝트」가 여는
      // 자리와 **같은 함수**(`workDefaultOrigin` — `placeOrigin`이 그것을 탄다)에서 읽는다.
      defaultCwd={workDefaultOrigin(panelWork).cwd}
      // 본문이 묶음을 보여줄 때 — 셸이든 파일 탭이든 — 켜진 칸이 선다. 주소가 셸을 말해도 **켜진 셸이 없으면** 본문은 「아직
      // 셸이 없어요」다(git-integration 판 01): 묶음에 켤 셸이 없어 지금 탭이 파일 탭으로 남았고(`withShellActive`), 자동 셸도
      // 안 뜨는 work(프로젝트 둘 이상)이다. 그 파일 탭을 켜면 본문과 켜진 칸이 다른 것을 말한다.
      showing={
        codeTarget !== null ||
        chatThread !== null ||
        newChatShown ||
        (terminalStands && activeShellOf(shellState, ownerOf(panelWork.slug)) !== null)
      }
      chat={chatTabs}
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
        // 채팅 탭이면 그 채팅으로 간다(restart 02a-4) — 켜는 것은 주소를 받은 자리다(주소 → 묶음).
        if (picked?.kind === "chat") {
          onOpenChat(picked.thread);
          return;
        }
        // 새 채팅 탭이면 그 탭을 켜고 본문이 새 채팅 탭이 된다(restart 02a-8) — 어느 새 채팅 탭인지는 묶음이 쥐므로 켜는 것은 여기서 한다.
        if (picked?.kind === "new-chat") {
          selectShell(id);
          onOpenNewChat();
          return;
        }
        selectShellWithFocus(id);
        onSelectTab("terminal");
      }}
      // 셸은 확인을 거치는 길 하나다(결정 92) — ⌘W도 같은 함수로 온다. 보기 탭(파일 탭 · 채팅 탭)은 **확인 없이** 닫는다
      // (git-integration 스토리 37 · restart 02a-5) — 프로세스가 없다. 채팅 탭은 칸만 빠진다: 채팅에는 아무것도 부르지 않아 채팅과
      // 세션이 남고 돌던 턴도 계속 돈다. 그 판정은 레지스트리가 칸의 종류로 한다(`removeViewTab`은 셸 칸을 안 뺀다).
      onClose={(id) => {
        const kind = bundleTabOf(terminalStore.state, ownerOf(panelWork.slug), id)?.kind;
        if (kind === "shell") void requestCloseShell(id);
        else if (kind) closeBundleView(id);
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
      // `+` 메뉴 맨 윗줄 「새 채팅」(restart 02a-8) — ⌘T와 같은 길이다(위 `startNewChat`).
      onNewChat={startNewChat}
      // 칸을 끌면 이 줄의 틈에 놓여 순서가 바뀐다(UI개선 결정 11). 한때 본문 절반에도 놓여 분할이 섰다(결정 12 — restart 02a-13이
      // 분할을 걷었다) — 이제 놓을 곳은 틈 하나다.
      //
      // **끄는 자리를 여기서 만든다.** 탭 줄은 스토어도 제스처 모듈도 모르는 그림이라(그쪽
      // prop 주석) 드래그 상태를 구독하는 이 화면이 건다. `/terminal`도 같은 모양으로 건다.
      //
      // 이 줄은 늘 **지금 보고 있는 work**의 것이라 소유자가 하나로 정해진다. 원천이 slug가
      // 아니라 owner인 것은 공용 제스처가 `/terminal`(slug가 없다)에서도 같은 모양을 싣기
      // 때문이다.
      //
      // 묶음의 칸은 **그 칸의 종류**를 싣는다 — 셸 칸이든 파일 탭이든 채팅 탭이든 줄의 틈에 놓인다(git-integration 결정 31 · restart 02a-5).
      // 종류는 레지스트리가 id로 안다(`onSelect`와 같다). 누르는 사이 그 칸이 빠졌으면 걸 끌기가 없다. 새 채팅 탭은 채팅 탭으로 싣는다(틈은
      // 종류를 안 본다 — restart 02a-8).
      onDragTab={(shellId, from) => {
        const owner = ownerOf(panelWork.slug);
        const kind = bundleTabOf(terminalStore.state, owner, shellId)?.kind;
        if (kind) armDrag({ kind: kind === "new-chat" ? "chat" : kind, owner, shellId }, from);
      }}
      // 틈 소비자의 두 끝 — 적는 것(`hoverSlot`)은 문턱을 넘은 뒤에만 쓰고, 놓는 것은 `/terminal`과 같은 함수다. 둘 다 모듈 함수라 회차를
      // 넘어 같다.
      slot={drag.slot}
      onSlot={hoverSlot}
      onDropSlot={dropShellOnSlot}
      dragging={drag.source !== null}
      // 줄 끝에는 아무것도 안 선다 — 상태 배지 · ⋯ · 요약 카드는 머리 줄에 선다(아래 `head`). 한때 분할의 묶음 열을 닫는 `×`가 섰다.
    />
  ) : undefined;

  /**
   * **요약 카드가 설 탭을 지금 고른다**(restart 02a-10 · `cardTabOf`) — 셸 · 파일 탭에서 카드를 여는 손짓(「요약 카드」 · spec 패널의 문서 줄)이
   * 함께 쓴다. 가장 최근에 켠 채팅 탭, 열린 채팅 탭이 없으면 가장 최근 채팅(사이드바 작업공간 줄과 같은 `landingOf`), 채팅이 없으면 새 채팅 탭이다.
   * 「가장 최근」의 말은 이미 읽어 둔 기록에서 누른 순간에 센다(`-works-view`의 처음 여는 규칙과 같다).
   */
  const cardTabNow = (slug: string): WorkLanding => {
    const records = threadRecordStore.state;
    const latest = landingOf(threads ?? [], slug, (id) => lastSaid(linesOf(records, id))?.at ?? null);
    return cardTabOf(workSeat(slug), bundleOf(terminalStore.state, ownerOf(slug)), latest);
  };

  /**
   * 「요약 카드」를 눌렀다(restart 02a-10 · 구현 스펙 「02a — 오른쪽 자리」 · SummarySheet 표 「셸 · 파일 탭에서 요약 단추를 누른다」). 본문이 카드가
   * 서는 탭(채팅 탭 · 새 채팅 탭)이면 그 자리에서 여닫는다. 아니면(셸 · 파일 탭) **채팅 탭을 먼저 켜고** 작은 카드를 세운다 — spec 패널은
   * 접힌다. 켤 탭은 가장 최근에 켠 채팅 탭이고, 열린 채팅 탭이 없으면 가장 최근 채팅(사이드바 작업공간 줄과 같은 `landingOf`)을 탭으로 세우며,
   * 채팅이 없으면 새 채팅 탭이다(`cardTabOf`). 새 채팅 탭은 이미 선 것이 있으면 그 탭을 켠다(주소 → 묶음의 `showNewChatTab`).
   *
   * 「가장 최근」의 말은 이미 읽어 둔 기록에서 누른 순간에 센다(`-works-view`의 처음 여는 규칙과 같다). 값을 먼저 바꿔도 탭 줄 규칙이 걷지
   * 않는다 — 그 규칙은 본문 탭이 바뀔 때만 돌고, 바뀐 본문은 채팅 탭이다.
   */
  const pressSummary = () => {
    if (chatThread !== null || newChatShown) {
      moveRight({ kind: "toggle", place: "summary" });
      return;
    }
    if (selected === null) return;
    const landing = cardTabNow(selected.slug);
    if (landing.kind === "thread") onOpenChat(landing.id);
    else onOpenNewChat();
    moveRight({ kind: "show", place: "summary" });
  };

  /**
   * **spec 패널의 문서 줄을 눌렀다**(restart 02a-12 · 스토리 95 · SummarySheet 표의 문서 줄 셋) — 넓힌 카드로 연다. spec 패널과 사이드바가 접힌다.
   * 카드가 서는 탭이 본문이면 그 자리에서 넓히고 주소는 카드를 따라간다(위 「카드 → 주소」). 아니면(셸 · 파일 탭) 「요약 카드」처럼 켤 탭을
   * 먼저 고르고(`cardTabNow`) 그 탭으로 옮기며 문서를 주소에 얹는다 — 한 번에 옮긴다. 값을 먼저 넓혀도 탭 줄 규칙이 걷지 않는다 — 바뀐 본문이 카드가
   * 서는 탭이다(02a-10). 문서가 열리는 자리는 이것 하나다 — 한때 문서 탭과 분할의 문서 열이 있었다(restart 02a-13이 걷었다).
   */
  const openDoc = (path: string) => {
    if (selected === null) return;
    moveRight({ kind: "expand", target: { kind: "doc", path } });
    if (!cardBody) onOpenDoc(path, cardTabNow(selected.slug));
  };

  // 머리 줄의 화면 것(codex-ds 스펙 §6 · 스토리 23 · 24 · 02 구현 스펙 §3 S2) — 왼쪽은 ⚡(work 아이콘 — 상태 글리프가 아니다)와 work 이름이다. 사이드바를 보지
  // 않아도 지금 어느 work인지 안다(⌘B로 사이드바를 접어도). **이름은 그 자리에서 바꾼다**(codex-ds 스펙 §9 · `rename`) — 이름의 두 번
  // 클릭 · F2, 또는 ⋯ · 이름 우클릭 메뉴의 「이름 바꾸기」로 들어가고, 지금 work 이름 명령(`set_work_title`)으로 저장한다.
  //
  // **이름은 work 메뉴의 대상이다**(codex-ds 결정 6 — `nameMenu`). 우클릭하거나 포커스해 ⇧F10 · 메뉴 키를 누르면 ⋯와 같은 메뉴가
  // 이름 곁에 선다 — 겨누는 것은 고른 work이다. `key`가 work을 갈아 끼우면 메뉴를 새로 세운다: 열어 둔 채 다른 work으로 옮기면
  // 메뉴가 화면에 보이는 것과 다른 work을 겨눈다(⋯의 slug 이펙트와 같은 이유).
  //
  // 오른쪽은 **할 일 | 보기 배치**다. 할 일은 상태 배지와 ⋯ — work에 대한 조작이 한 자리에 모인다(ui-refresh 결정 14 · codex-ds
  // 결정 25). 상태 배지가 앞인 것은 자주 누르는 조작이라서다 — 메뉴 뒤에 숨기면 상태를 바꾸는 데 클릭이 두 번 든다. 보기 배치는
  // 요약 단추 하나다(한때 그 앞에 분할 토글이 섰다 — restart 02a-13이 분할을 걷었다). 사이의 세로선과 간격은 틀이 그린다(`Frame`의
  // `FrameHead`). 한때 이 셋은 탭 줄 끝에, 그다음 창 맨 위 줄의 오른쪽 끝 묶음에, 그다음 머리 카드에 섰다. 패널 토글은 화면이 건네지
  // 않는다 — 틀이 요약 단추 뒤 오른쪽 맨 끝에 세운다(레일이 서도 같다).
  //
  // 지금 선 work(`selected`)가 없으면 머리 줄에는 화면 이름 「작업공간」 하나가 선다(codex-ds 스펙 §7) — ⚡는 work 아이콘이라 work들의 화면도
  // 같은 아이콘이다. 걸 대상이 없어 할 일도 없다.
  const head: HeadSlot = selected
    ? {
        // 이름 앞의 흐린 Service(03 §10) — 누르면 Service 메뉴가 열리고 고르면 이 Work의 Service가 바뀐다. 없으면 흐린 「Service 없음」이다.
        lead: <WorkServiceCrumb work={selected} />,
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
          label: "작업공간 이름",
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
        // 보기 배치는 **요약 단추**(「요약 카드」 — restart 02a-9 · 스토리 93 · 시안 Main 창 머리 `.ra-tbtn` 「요약 카드」 · 「spec 패널 접기」) 하나다 —
        // 오른쪽 자리를 요약 카드로 세우거나 걷는다. 틀이 그 뒤 맨 끝에 패널 토글을 세워, 오른쪽 자리를 나눠 쓰는 둘이 나란히 선다. 한때
        // 채팅 탭 몸 오른쪽 위에 섰다(02a-4의 임시). **셸 · 파일 탭에서도 선다**(restart 02a-10 — `pressSummary`가 채팅 탭을 먼저 켠다). 한때
        // 채팅이 본문일 때만 섰다(02a-9). 그 앞에 서던 분할 토글은 걷혔다(restart 02a-13 — 시안 Main 창 머리에 없다).
        end: <SummaryToggle open={right.summaryOpen} onToggle={pressSummary} />,
      }
    : { icon: Zap, name: WORKS_COPY.page };

  // 본문 — 넷 중 하나이고 모두 공용 틀의 카드다(ui-refresh 결정 4 · 15). **패널은 여기 들어오지 않는다**(결정 49): 어느 본문이 서 있든
  // 패널은 틀의 패널 칸에 딱 한 번 그려진다. 그래서 탭을 오가도 패널 인스턴스가 그대로 살아 탭 선택이 유지된다 — 1판은 호출부가 둘이라
  // 인스턴스도 둘이었다. 한때 분할이면 틀이 열 둘을 그렸고(결정 87) 문서 탭이면 문서 카드가 섰다 — restart 02a-13이 둘을 걷었다.
  //
  // **채팅 · 터미널 · 코드 카드가 같은 자리 · 같은 머리다** — 셋 다 탭 줄을 머리(`head`)로 이고 그 줄의 바닥을 든다(`TAB_ROW_CARD`).
  // 오가도 카드와 탭 줄이 새로 서지 않는다(`Frame`의 `Card`) — 방금 누른 칸의 포커스와 줄의 스크롤이 그대로다. 그래서 코드 카드의
  // 경로 줄(`PathBar`)은 머리가 아니라 몸의 첫 줄로 건넨다 — 탭 줄 아래다: 머리 자리에 묶음이 서면 탭 줄이 그 자리에서 다른 것이 된다.
  const body = terminalWork ? (
    // 터미널 — 탭 줄 아래가 곧 셸이다(Terminal 화면과 같은 카드). 바탕은 터미널 테마를 따른다.
    <Card as="main" label="터미널" tone="terminal" className={cn("flex-1", TAB_ROW_CARD)} head={tabRow}>
      {newChats}
      {terminalBody}
    </Card>
  ) : selected && codeTarget ? (
    // 코드 카드 — 파일 탭의 본문이다(git-integration 티켓 04). **접근 이름이 그 파일의 경로다**(스토리 89) — 화면 읽기가
    // 지금 무엇을 읽는지를 카드 이름으로 듣는다. 몸은 경로 줄과 `codeBody`다.
    <Card as="main" label={codeRefOf(codeTarget)} className={cn("flex-1", TAB_ROW_CARD)} head={tabRow}>
      {newChats}
      {codeBar}
      {codeBody}
    </Card>
  ) : selected ? (
    // 채팅 카드 — 채팅 탭의 본문이다(restart 02a-4 — 셸 · 파일 탭이 아니면 이것이다, 기본 값이 `chat`이다). 머리는 탭 줄이고 몸은 채팅
    // (`WorkChat`)이다. `thread`가 없으면 새 채팅 탭이 선다(restart 02a-8 — 몸은 위 `newChats`의 켜진 하나다). 처음 여는 규칙이 주소를 고치는
    // 한 틱에는 몸이 비어 있다.
    <Card as="main" label={newChatShown ? "새 채팅" : "채팅"} className={cn("flex-1", TAB_ROW_CARD)} head={tabRow}>
      {newChats}
      {chatBody}
    </Card>
  ) : (
    // 고른 작업이 없으면 패널도 탭 줄도 없다 — 화면 이름은 머리 줄이 말하고, 카드 안에 고를 것이 없어 카드 머리도 없다.
    <Card as="main" label={WORKS_COPY.page} className="flex-1">
      {/* DS 빈 화면 물음(codex-ds 스펙 §6 · 스토리 64) — 물음 · 설명 · 할 일이 카드 한가운데에 서고 글리프 칸은 없다(`Empty`의
          `question`). 프로젝트 갈래의 문구는 여기 리터럴이고, 작업이 없을 때의 셋은 표에서 온다. */}
      <Empty variant="question">
        <EmptyHeader>
          <EmptyTitle>{needsProject ? "먼저 프로젝트를 등록해요" : emptyScreen.title}</EmptyTitle>
          <EmptyDescription>
            {needsProject
              ? "작업공간은 등록된 프로젝트 위에서 시작돼요. Projects에서 폴더를 고르거나, 에이전트에게 맡겨도 돼요."
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
    // 공용 틀 위의 작업 화면(ui-refresh 결정 4 · 5 · 27 · restart 02a-2). 머리 줄에 ⚡ · 이름 | 상태 · ⋯ | 요약 카드 · 패널 토글이
    // 서고, 카드 자리에 본문 카드(머리가 탭 줄)가 선다. 그 뒤 spec 패널 카드 · 레일 카드는 앱 셸의 작업공간 도구 기둥이다(아래 `WorkTools`).
    //
    // 탭 줄의 바닥은 그 줄을 이는 카드가 들고(`TAB_ROW_CARD`), 모자라면 틀의 본문 열이 사이드바에게 자리를 요구한다
    // (`TAB_ROW_COLUMN`) — 카드가 제 몸을 격리하므로 넓은 문서 · xterm이 그 바닥을 부풀리지 않고, spec 패널은 같은 카드 자리 줄에서 제
    // 최소 폭까지 본문 카드에 자리를 내준다(`Frame`의 `PanelBox`).
    <>
      <Frame
        head={head}
        // 머리 줄 오른쪽 맨 끝의 패널 토글 — 앱 셸 기둥의 spec 패널을 가리킨다. 패널과 같은 조건으로 건넨다: 고른 작업이 없으면 열 패널이
        // 없어 토글도 레일도 없다. **두 본문 모두에** 선다(결정 11).
        panelToggle={panelWork ? { name: WORK_PANEL_LABEL, open: panelOpen, onToggle: togglePanel, controls: WORK_PANEL_ID } : undefined}
        // 카드 줄 위를 덮는 것 둘(판 04 「덮는 것의 기준 상자」) — 토스트와 생애 겹판이다. 머리 줄은 카드 줄 밖이라 어느 것도 안 덮는다. 한때
        // 탭 칸을 끄는 동안 본문 절반 둘(놓을 자리)이 카드 줄을 덮었다 — 분할이 걷혀(restart 02a-13) 놓을 곳은 탭 줄의 틈 하나다.
        overlay={
          <>
            {/* 토스트의 자리 — **뷰 분기 밖**이라 본문이 셸이든 채팅이든 같은 자리에 뜬다(결정 47).
                가운데는 이 틀의 **카드 줄** 가운데다. 한때 그 줄에 spec 패널이 함께 서서 패널에서
                일어나는 일(트리 복사)까지 말하는 토스트가 둘을 아우른 가운데에 떴다 — 패널이 앱 셸의
                기둥으로 옮겨(restart 02a-14) 이제 본문 카드의 가운데다. Provider는 앱 루트에 하나고
                자리(Viewport)는 화면마다 둔다(S14) — 아카이브 화면도 제 카드 줄 아래 가운데에 둔다.
                **넓힌 카드가 서 있으면 그 보기의 자리가 받는다**(`ExpandedViewer` — 채팅 본문의 `toasts={!expanded}`와 같다). 두 자리가 한
                관리자를 읽으면 같은 토스트가 두 자리에 함께 선다 — 토스트는 한 장이다(S26, 02a-15). */}
            {right.card.opened === null && <Toaster />}
            {running && <LifecycleOverlay verb={running.verb} detail={running.detail} />}
          </>
        }
      >
        {body}
      </Frame>
      {/* **spec 패널과 레일 — 앱 셸의 작업공간 도구 기둥**(restart 02a-14 · 스토리 80 · 82 · 83 · `WorkTools`). 이 화면이 서 있는 동안 기둥을
          세우고(열림 · 여닫기 · 바쁨) 패널의 몸을 그 자리로 보낸다. 내려가면(작업공간을 떠나면) 레일과 패널이 함께 500ms로 접힌다. 한때 둘은
          이 틀의 칸이었다 — 화면과 함께 내려가 접힘 없이 사라졌다. 바쁨은 생애 겹판 몫이다 — 겹판은 카드 줄을 덮고, 그 밖 기둥의 몸은 바쁨이 막는다.

          **작업 패널을 그리는 유일한 자리다**(결정 49). 1판은 여기와 SpecViewer 둘에서 그려서 뷰 탭을 오갈 때마다 인스턴스가 갈렸다.
          **`key`를 주지 않는다** — 앞 판 결정 4(「작업을 옮기면 패널 칸이 spec으로 리셋된다」)는 `key={slug}`가 붙은 SpecViewer 아래에 있어서
          공짜로 나오던 성질이었고, 결정 49가 그것을 뒤집는다. 트리 접힘은 패널을 여닫아도(restart 02a-14 · 스토리 83), 본문을 오가도(채팅 ↔
          셸), 작업을 옮겨도 남는다 — 마지막은 **감수한다**: 접힘 기억의 키가 판 폴더의 전체 이름이라 이름이 완전히 같을 때만 물려받는다.

          spec 트리에서 문서를 누르면 **넓힌 카드로 연다**(restart 02a-12 — `openDoc`). 트리의 「지금 이 문서」는 주소의 문서다(`currentDoc` —
          기본 문서로 눕히지 않는다). 셸 · 파일 탭에서 누르면 켤 채팅 탭으로 옮기는 이동과 문서를 한 번에 적는다 — 탭과 파일을 따로 옮기면 두
          navigate가 한 틱에 겹친다. */}
      {panelWork && (
        <WorkTools open={panelOpen} busy={running !== null} onToggle={togglePanel}>
          <WorkPanel
            work={panelWork}
            currentFile={currentDoc}
            onSelectFile={openDoc}
            onCopy={copyText}
            onOpenFolder={() => openWorkFolder(panelWork.slug, null)}
          />
        </WorkTools>
      )}
    </>
  );
}

// 되돌릴 수 없는 조작이 도는 동안 카드 줄을 덮는다.
//
// 워크트리 제거는 폴더 크기에 비례해 수 초가 걸린다(실측 8.9GB). 그동안 화면이 아무 말도
// 하지 않으면 **버튼이 안 눌린 것처럼 보이고**, 사이드바에는 그 작업이 아직 그대로 있어
// 더 그렇다. 덮는 것 자체도 목적이다 — 진행 중에 같은 작업을 다시 겨누지 못하게 한다.
//
// 공용 틀의 `overlay` 칸이라 카드 줄(본문 카드와 그 머리의 탭 줄)을 덮고 머리 줄은 덮지 않는다(판 04 「덮는 것의 기준
// 상자」) — 치워지는 작업에 셸을 새로 열 길도 함께 막힌다. spec 패널은 카드 줄 밖 앱 셸의 기둥이라(restart 02a-14) 덮지 않고, 같은 동안
// 그 몸을 바쁨이 막는다(`WorkTools`의 `busy`). 머리 줄의 ⋯는
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

// 머리 줄의 상태 배지 + 바꾸는 라디오 메뉴(판 3, 스토리 46~48 · 51 · 52 · codex-ds 스토리 25).
//
// **메뉴 부품(`DropdownMenu`)이 다 한다** — 여닫이, 줄 옮기기(↓/↑가 끝에서 돈다 · Home/End · 글자 치기),
// Esc 닫기와 배지로 포커스 돌려주기, 바깥 누르기가 닫기만 하는 것(S9). 배지가 「메뉴를 연다」와
// 「열렸다/닫혔다」를 말하고(`aria-haspopup` · `aria-expanded`), 지금 상태는 `menuitemradio`의
// `aria-checked`로 읽힌다. 고르면 닫힌다(라디오 항목의 `closeOnClick`, S33).
//
// 배지는 **배지 모양 그대로다**(P8 — Badge로 옮기지 않는다). 트리거가 제 버튼을 그리므로 모양은 상태 모듈의
// 배지 한 벌(`STATUS_BADGE`)을 부른다 — 아카이브 머리 · 호버 카드의 배지와 같은 모양이다. 창을 끌지 않는다 — 머리 줄의 빈 자리는
// 끌지만 버튼이라 Tauri가 끌기에서 뺀다(`Frame`의 `FrameHead`).
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

// 머리 줄의 ⋯ — work 메뉴(codex-ds 결정 16 · 스펙 §6). 무엇을 어떤 차례로 보이는지는 메뉴 정의(`WorkMenuItems`)가 들고, 그 항목이
// 부르는 동작과 아카이브 · 삭제의 흐름은 `work-menu-actions.ts` 한 자리다 — 우클릭 메뉴 셋(사이드바 행 · 띠 줄 · 머리 줄 이름)이 같은
// 흐름을 받는다(codex-ds 결정 6). 여기 남는 것은 ⋯의 몫이다: 열림과 닫힌 뒤 포커스가 갈 자리. 「이름 바꾸기」는 머리 줄 이름의
// 제자리 고치기를 켠다(`onRename` — 고치는 중인지는 화면이 쥔다).
//
// **메뉴 부품(`DropdownMenu`)이 다 한다**(판 3, 스토리 46~48) — 여닫이, 줄 옮기기(↓/↑가 끝에서 돈다 ·
// Home/End · 글자 치기), 하위 메뉴 열고 닫기(→ · ←), Esc 닫기와 ⋯로 포커스 돌려주기, 바깥 누르기가 닫기만 하는 것(S9).
// 항목은 `menuitem`이다. ⋯가 「메뉴를 연다」와 「열렸다/닫혔다」를 말한다(`aria-haspopup` · `aria-expanded`).
// 창을 끌지 않는다 — 머리 줄의 빈 자리는 끌지만 버튼이라 Tauri가 끌기에서 뺀다(`Frame`의 `FrameHead`).
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
  /** 「이름 바꾸기」 — 머리 줄 이름을 그 자리에서 고치기 시작한다. */
  onRename: () => void;
}) {
  // 열림을 여기서 든다 — ⋯의 켜짐(`toggle-on`)이 그것을 그린다.
  const [open, setOpen] = useState(false);
  // **「이름 바꾸기」로 닫혔나** — 그때는 메뉴가 닫히며 포커스를 ⋯로 돌리지 않는다(`finalFocus`). 머리 줄 이름 자리에 막 선 입력칸이
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
  // **이 이펙트가 그 일을 한다** — 이 메뉴는 공용 틀의 머리 줄에 서서(codex-ds 스펙 §6) 작업을 옮겨도 다시 세워지지 않는다.
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
        text="작업공간 메뉴"
        announce="name"
        disabled={busy}
        render={
          <DropdownMenuTrigger
            disabled={busy}
            aria-busy={processing}
            // **머리 줄의 아이콘 단추 한 벌이다**(`headButton` — 28 · 글리프 16, 펼친 동안 hover와 같은 면) — 세로선 너머 「요약 카드」 ·
            // Thread의 「…」와 같은 상자다(02 결정 「머리 줄은 한 결이다(03 뒤)」) — 한 줄의 아이콘 버튼 상자가 다르면 하나만 튀어 보인다.
            className={cn(headButton(open ? "open" : "rest"), "disabled:pointer-events-none disabled:opacity-50")}
          />
        }
      >
        {/* 진행 표시는 여기가 아니라 본문을 덮는 LifecycleOverlay가 한다 — 14px 글리프의
            깜빡임은 워크트리 제거가 도는 수 초 동안 "눌리긴 했나"에 답하지 못했다.
            disabled는 그대로 둔다: 오버레이가 뜨기 전 한 프레임을 막는 것도 이 속성이다. */}
        <MoreHorizontal className={HEAD_GLYPH} />
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
