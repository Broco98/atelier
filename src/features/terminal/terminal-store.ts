import { Store } from "@tanstack/react-store";
import { Channel } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { askDialog } from "@/components/ui/confirm-store";
import { appToasts, showAppToast } from "@/components/shell/app-toast";
import { cancelGoneShellDrag, dragStore, shellMoveOf } from "@/lib/pointer-drag";
import { TERMINAL_LABEL } from "@/components/shell/nav-items";
import type { Mode } from "@/mode";
import type { AgentSignal } from "./agents/types";
import { onPtyRunning, onShellAttention, terminalApi } from "./api";
import { applySignal, markShellsSeen, nextAttention, nextOnOutput, ptyIdOf } from "./shell-attention";
import type { AttentionSource, ShellView } from "./shell-attention";
import { bellSignal, oscSignal } from "./shell-osc";
import { createNotifier, notifyShells, outgoing } from "./shell-notify";
import type { NotifyPayload } from "./shell-notify";
import { notifyChoice, onNotifySettingsChanged } from "./notify-settings";
import {
  activateShell,
  attentionOfId,
  CLOSE_REASONS,
  confirmClose,
  countQuitShells,
  countSpawned,
  firstInputOfId,
  isQuietShell,
  liveOrphansOf,
  markExited,
  markFailed,
  markFirstInput,
  markOrphaned,
  moveShell,
  NO_SHELLS,
  openShell,
  orphansCloseNotice,
  orphansOf,
  removeShell,
  runningOfId,
  setAttention,
  setRunning,
  setShellName,
  setTitle,
  shellOpenNotice,
  shellsOf,
  slugOfOwner,
} from "./shell-registry";
import type {
  CloseChecks,
  ClosePath,
  OpenedShell,
  QuitCounts,
  ShellOrigin,
  ShellOwner,
  ShellsState,
} from "./shell-registry";
import { deferAttach, focusOnAttach, focusPlaceOf, nextPendingFocus } from "./shell-focus";
import type { AttachKind, FocusPlace, PendingFocus } from "./shell-focus";
import { humanInput, keyRoute } from "./shell-input";
import type { InputHappening } from "./shell-input";
import { reclaimOnLeave } from "./shell-leave";
import { orphanedWorldOf, orphanNotice, orphanToastId, vanishedOwners } from "./shell-owners";
import type { ListResult } from "./shell-owners";
import { attachWebgl, closeWebgl, failWebgl, loseWebgl, NO_WEBGL_SEATS } from "./shell-webgl";
import type { WebglSeats } from "./shell-webgl";
import { terminalLook } from "./terminal-defaults";
import type { TerminalLook } from "./terminal-defaults";
import { attachIme } from "./terminal-ime";
import { terminalSettingsStore } from "./terminal-settings";
import { terminalThemeFor } from "./terminal-theme";
import type { CloseCheck, PtyFrame } from "./types";
// `@xterm/*` import는 이 파일과 이것을 부르는 화면에만 둔다. 청크가 `/terminal`과 Work 화면에만
// 붙는 것은 사실이지만, **그것이 앱 시작 무게를 줄이지는 않는다** — 첫 화면이 `/works`이고
// (`routes/index.tsx`가 그리로 redirect한다) `WorksPage`가 `TerminalPane`을 **정적으로** 들여서,
// 600KB대인 이 청크는 터미널을 한 번도 안 여는 사람에게도 앱을 켜는 순간 함께 온다(실측:
// `vite build`의 청크 그래프).
//
// 그래도 격리를 유지하는 값은 둘이다 — Node 테스트가 셸 모듈을 파싱하지 않는 것과, 값의
// 정의(`terminal-defaults.ts`)가 인스턴스 관리에 매이지 않는 것. 본문이 lazy로 갈리는 날
// 무게 쪽 값도 살아난다.
//
// 한때 여기 「`__root.tsx`는 autoCodeSplitting이 떼어내지 않으므로 셸 쪽에 한 줄이라도 새면
// Node에서 `routeTree.gen.ts`를 import하는 `router.test.ts`가 함께 죽는다」고 적혀 있었지만
// **사실이 아니었다** — 실측은 `terminal-defaults.ts` 머리말에 있다.
import "@xterm/xterm/css/xterm.css";

// 글꼴·크기·테마의 기본값은 **여기 없다** — `terminal-defaults.ts`로 꺼냈다. 설정 화면이
// 「고르지 않았을 때 무엇이 쓰이는지」를 같은 상수에서 읽어야 하는데, 이 파일을 import하면
// 위의 `@xterm/*`가 함께 따라가기 때문이다. 고른 값과 그 기본값을 합치는 규칙도 그쪽이 안다.

/**
 * 화면이 구독하는 값. **인스턴스는 여기 없다** — 리렌더가 xterm을 다시 만드는 경로가
 * 아예 없어야 해서 그 옆 모듈 스코프(`instances`)에 따로 산다. 둘 다 모듈 싱글턴이라
 * 라우트 언마운트를 넘긴다(결정 21).
 */
export const terminalStore = new Store<ShellsState>(NO_SHELLS);

/**
 * 셸 하나가 쥐고 있는 것 전부. 화면이 아니라 이 모듈이 소유하므로 `/terminal`을 떠나도
 * 그대로 남는다 — 떼는 것은 `wrapper`를 DOM에서 빼는 것뿐이고 `dispose`는 부르지 않는다.
 */
interface ShellInstance {
  id: number;
  term: Terminal;
  fit: FitAddon;
  // xterm이 열려 있는 집. 화면은 이것을 자기 컨테이너에 `appendChild`할 뿐이다.
  // 부모를 바꿔 `term.open()`을 다시 부르지 않는다.
  wrapper: HTMLDivElement;
  // wrapper를 본다 — 화면의 컨테이너가 아니라. 떼어 두면 크기가 0이라 저절로 조용해지고,
  // 다시 붙으면 크기가 생겨 저절로 깨어난다. 화면 수명과 무관하므로 disconnect도 없다.
  observer: ResizeObserver;
  // WebGL 렌더러. **최근에 붙은 셸 몇 개만 쥔다**(티켓 17 · `shell-webgl`) — 자리를 내주고 놓았거나 컨텍스트를 잃어
  // 놓았으면 null이고, 그동안 xterm은 DOM 렌더러로 그린다. 다시 붙을 때 자리가 나면 새로 싣는다.
  webgl: WebglAddon | null;
  // PTY가 떠 있는 동안의 id. 종료 프레임이 오면 다시 null이다 — 죽은 셸에는 쓰지 않는다.
  // 레지스트리의 `id`와 다른 번호다(shell-registry.ts의 openShell 주석).
  ptyId: number | null;
  // 이 셸을 어디서 띄웠는가. cwd는 `~` 축약 표기 그대로 넘긴다 — 펴는 것은 백엔드다(결정 25).
  // `cwd`가 `null`이면 데이터 루트다(최상위 터미널).
  //
  // **새 칸의 자리가 아니다.** 셸 안 ⌘T는 이 값의 `owner`로 화면에 요청만 보내고, 자리는
  // 화면의 기본 자리 함수가 정한다(UI개선 결정 19). 여기서 읽는 것은 spawn의 세계·cwd와 그 소유자다.
  origin: ShellOrigin;
  fontsReady: boolean;
  opened: boolean;
  // **여는 데 실패했다.** 이미 뜬 PTY를 거두고 이 칸에 다시는 쓰지 않는다 — 떠 있는데 볼 수
  // 없는 셸은 상한만 갉아먹는다(`failOpen`).
  broken: boolean;
  // `×`로 거둔 뒤. 이 뒤에는 이 인스턴스에 아무것도 하지 않는다 — dispose된 Terminal에
  // 쓰면 던지는데, PTY를 죽인 **뒤에도 종료 프레임이 한 번 더 온다.**
  closed: boolean;
}

const instances = new Map<number, ShellInstance>();

// 셸이 이미 죽은 뒤에 도착한 명령은 백엔드가 `Err`로 돌려준다. 리더 스레드가 레지스트리에서
// id를 지우는 것과 종료 프레임이 화면에 닿는 것 사이에 IPC 한 홉이 있어, 그 틈에 낀 입력이
// 실제로 그 자리에 온다. 이유는 종료 줄이 이미 말해 주므로 여기서는 흘린다 — `void`로만
// 두면 그것이 미처리 rejection이 되어 콘솔로 샌다.
const ignoreGone = (result: Promise<void>) => void result.catch(() => {});

/**
 * 상한에서 셸을 못 열었다는 것을 듣는 자리. **⌘T 하나 때문에 있다**(결정 47).
 *
 * 그 키는 `attachCustomKeyEventHandler`에서 오는데 그 핸들러는 **React 트리 밖**이라,
 * 화면의 지역 토스트를 부를 길이 이 통로 말고는 없다. `+`는 잠긴 채 이유를 이미 적어
 * 두고 있어(결정 47) 이리로 오는 것은 경주뿐이지만, 두 입구를 갈라 두면 같은 사실을
 * 두 곳이 말하게 되므로 거절은 한 자리에서 알린다.
 *
 * **듣는 화면이 없으면 아무 일도 안 일어난다.** 최상위 터미널(`/terminal`)이 그쪽이고,
 * 거기 ⌘T는 계속 조용하다 — 결정 47이 알려진 것으로 남긴 자리다. 앱 전역 알림 표면을
 * 새로 짓는 안은 그 결정이 기각했다(한 판에 전역 신설 둘은 위험하다). 그 뒤 프로세스 스펙 P2가
 * 앱 셸에 토스트 자리를 세웠지만(`AppToasts`) 이 거절은 그리로 옮기지 않았다.
 *
 * Set인 것은 StrictMode 때문이다 — 마운트를 두 번 돌리면 구독도 두 번 걸린다.
 */
const openRejectedListeners = new Set<(notice: string) => void>();

export function onShellOpenRejected(listen: (notice: string) => void): () => void {
  openRejectedListeners.add(listen);
  return () => {
    openRejectedListeners.delete(listen);
  };
}

/**
 * 셸 **안에서** 누른 ⌘T가 그 셸의 화면에 「새 셸」을 요청하는 통로(UI개선 결정 19).
 *
 * **셸이 자리를 정하지 않는다.** 한때 xterm 핸들러가 그 셸이 뜬 자리(`instance.origin`)로
 * 스스로 열었는데, 그러면 프로젝트 셸 안의 ⌘T만 그 프로젝트에서 떠 셸 안과 밖이 다른 자리가
 * 됐다. 자리는 **창 단축키와 같은 기본 자리 함수**로 화면이 정한다 — work에 프로젝트가 붙어
 * 기본 자리가 바뀌어도 그 순간의 값을 쓴다. 그래서 요청에 실리는 것은 소유자 하나다.
 *
 * 통로가 위 거절 알림과 같은 모양인 것도 같은 이유다: 핸들러가 **React 트리 밖**이라 화면을
 * 부를 길이 이것뿐이다. 창 keydown 리스너로 짓지 않는 것은 `stopPropagation`으로 막아 둔 그
 * 리스너와 한 번 눌러 두 번 여는 길을 다시 잇지 않기 위해서다.
 *
 * **듣는 화면이 둘이다** — work 화면과 최상위 터미널. 한쪽이 안 들으면 그 화면에서 셸에
 * 포커스가 있는 동안 ⌘T가 죽는다. 듣는 화면이 없으면 아무 일도 안 일어난다.
 *
 * **그 셸의 화면만 듣는다 — 가르는 자리가 여기 하나다.** 화면은 제 소유자를 들고 구독하고,
 * 요청의 소유자와 같을 때만 불린다. 화면마다 제가 거르게 두면 거르기를 잊은 화면 하나가 남의
 * 셸의 ⌘T에 제 셸을 열어, 한 번 눌러 두 화면에 셸이 선다.
 */
const newShellRequestListeners = new Set<{ owner: ShellOwner; listen: () => void }>();

export function onNewShellRequested(owner: ShellOwner, listen: () => void): () => void {
  const entry = { owner, listen };
  newShellRequestListeners.add(entry);
  return () => {
    newShellRequestListeners.delete(entry);
  };
}

/** 그 소유자의 화면에 새 셸을 요청한다. **여기서 열지 않는다** — 위 머리말. */
export function requestNewShell(owner: ShellOwner): void {
  for (const entry of newShellRequestListeners) if (entry.owner === owner) entry.listen();
}

/**
 * 셸 한 칸을 목록에 더하고 그 인스턴스를 세운다. **거절을 알리는 일은 여기 없다** — 그래야
 * 부르는 쪽이 「누가 눌렀나」로 갈릴 수 있다(`openNewShell` / `ensureShell`).
 *
 * 목록에 더하는 것과 인스턴스를 만드는 것이 **한 틱에 함께 끝난다.** StrictMode가 마운트를
 * mount→unmount→mount로 돌려도 `ensureShell`의 "비었나" 판정이 그 사이에서 이미 참이 아니라
 * 셸은 하나만 뜬다.
 *
 * **`OpenedShell`을 그대로 돌려준다 — 불리언으로 접지 않는다.** 접으면 「열렸나 거절인가」를
 * 부르는 쪽이 다시 정하게 되어, 그 판정을 한 자리에 모아 둔 `shellOpenNotice`의 계약이 깨진다
 * (그 함수 주석).
 */
function openShellQuietly(origin: ShellOrigin, auto: boolean): OpenedShell | null {
  // 여기만 상태를 **읽어서** 계산한다 — `openShell`이 새 상태와 함께 발급한 id를 돌려주고
  // 그 id로 인스턴스를 만들어야 해서다. 읽기와 쓰기 사이에 await가 없고 Store.setState가
  // 동기라 그 틈에 낄 갱신이 없다. 다른 setter들은 전부 updater 꼴이다.
  const opened = openShell(terminalStore.state, origin, auto);
  if (!opened) return null;

  terminalStore.setState(() => opened.state);
  const instance = createInstance(opened.id, origin);
  instances.set(instance.id, instance);
  void loadFont(instance);
  return opened;
}

/**
 * 셸을 하나 띄운다 — **사람이 누른 길이다**: `+`와 ⌘T. **상한에서는 열지 않고 알리기만
 * 한다**(결정 30·47).
 *
 * `origin`이 어디서 오는가가 판 03이다 — 최상위 터미널은 `topTerminal(mode)`, Work 화면은
 * ⌘T와 `+` 메뉴의 「모든 프로젝트」가 `workDefaultOrigin(mode, work)`(UI개선 결정 18·19), 메뉴의
 * 프로젝트 줄이 `workShellOrigin(mode, work, project)`. 뒤 함수가 `null`을 주면 여기까지 오지 않는다.
 */
export function openNewShell(origin: ShellOrigin): void {
  const opened = openShellQuietly(origin, false);
  // 상한에 닿으면 열지 않고 **거절을 알린다.** `+`로 온 것이라면 그 버튼이 이미 잠긴 채
  // 이유를 적고 있어 여기 닿는 것은 경주뿐이지만, ⌘T로 오면 다르다 — 그쪽에는 이유를
  // 말할 자리가 없어 아무 일도 안 일어난 것처럼 보였다(사용자 스토리 33의 알려진 구멍).
  //
  // **가르는 것도 문장을 짓는 것도 여기가 아니다** — `shellOpenNotice`가 둘을 함께 정하고,
  // 잠긴 `+` 행도 같은 문장을 읽는다(결정 47). 판정을 이리로 되돌리면 계약의 절반이 검사
  // 밖으로 샌다: 여는 길은 열리는 순간 xterm을 세워 **성공 경로를 테스트에서 못 돈다.**
  // 「열렸으면 아무 말도 안 한다」가 안 걸린 채 새면 열 때마다 거절 문구가 뜬다.
  const notice = shellOpenNotice(terminalStore.state, opened, origin.owner);
  if (notice !== null) {
    for (const listen of openRejectedListeners) listen(notice);
  }
}

/**
 * 화면에 들어올 때 한 번. 칸이 하나도 없으면 하나 띄운다 — 판 01이 정한 규칙이고 여기서
 * 바꾸지 않는다.
 *
 * **마지막 칸을 `×`로 닫은 자리에서는 뜨지 않는다.** 그것이 이 함수가 화면 진입 이펙트에만
 * 붙어 있는 이유다 — 닫자마자 새 셸이 뜨면 `×`가 무의미해진다.
 *
 * **상한에서 거절당해도 알리지 않는다 — 이 길에는 누른 사람이 없어서다.** 결정 47이 토스트를
 * 만든 근거는 「⌘T에는 이유를 말할 자리가 없다」이고 그것은 **사람이 누른 것에 대한 답**인데,
 * 이 함수는 화면에 들어온 부작용이다. 게다가 그 화면에는 이미 말할 자리가 있다 — 패널 `shell`
 * 탭의 잠긴 `+` 행이 같은 문장을 hover가 아니라 보이는 글자로 쓰고 있다(결정 47). 여기서 또
 * 알리면 아무도 안 누른 토스트가 탭을 오갈 때마다 다시 뜬다.
 *
 * **판정이 갈린 것은 아니다.** 「열렸나 거절인가」는 여전히 `shellOpenNotice` 한 곳이 정하고
 * (그 함수 주석), 이 길은 그것을 아예 지나지 않는다 — 갈린 것은 「누가 듣느냐」뿐이다.
 *
 * **이 길로 뜬 셸은 「자동」이다**(프로세스 결정 7). 사람 입력을 한 번도 안 받은 채 이 화면을 떠나면
 * 닫힌다(`closeUnusedShells`) — 둘러보기만 해도 로그인 셸과 셸 도우미가 앱을 끌 때까지 쌓이던 자리다.
 * 다시 들어오면 이 함수가 새로 띄운다.
 */
export function ensureShell(origin: ShellOrigin): void {
  // **그 화면의 칸만 센다.** 전체를 세면 다른 Work에 셸이 있다는 이유로 이 화면이 빈 채로
  // 열린다 — 판 03에서 화면이 여럿이 되면서 갈린 자리다.
  if (shellsOf(terminalStore.state, origin.owner).length === 0) openShellQuietly(origin, true);
}

/** 칸을 고른다. */
export function selectShell(id: number): void {
  terminalStore.setState((state) => activateShell(state, id));
}

/**
 * 기다리는 포커스(티켓 16 · 프로세스 스펙 S21) — 한 번에 하나다. 무엇이 남기고 무엇이 지우는지는 `nextPendingFocus`가
 * 혼자 안다. 여기는 그 답을 들고 있기만 한다. `shownShell`처럼 모듈 값이고 스토어에 두지 않는다 — 화면이 그리는
 * 것이 아니라서, 스토어에 두면 바뀔 때마다 구독한 화면이 깨어난다.
 */
let pendingFocus: PendingFocus = null;

/** 지금 포커스가 앉은 자리. 문서가 없는 자리(웹뷰 밖)에서는 「그 밖」이다. */
function focusPlaceNow(): FocusPlace {
  return typeof document === "undefined" ? "elsewhere" : focusPlaceOf(document.activeElement);
}

/** 셸이 붙어 있나 — 열려 있고 DOM에 있다. 그때만 xterm이 포커스를 받을 수 있다. */
function isAttached(instance: ShellInstance): boolean {
  return instance.opened && !instance.closed && !instance.broken && instance.wrapper.isConnected;
}

/**
 * 그 셸로 키보드 포커스를 **요청한다**(티켓 16 · 프로세스 결정 18 ②). 셸로 가는 길의 클릭 처리기가 `selectShell`과
 * 함께 부른다 — 띠의 줄과 셸 탭이다. 판 03의 단축키와 판 04의 [이동]도 여기로 온다.
 *
 * **붙어 있으면 그 자리에서 준다 — 붙기가 다시 도는지와 상관없다.** 이미 켜진 셸을 다시 고르면 레지스트리가 같은
 * 상태를 돌려줘(`activateShell`) 붙기가 안 돈다. 포커스가 붙기에만 달려 있던 때는 그래서 띠에서 보고 있는 셸을
 * 눌러도 키가 아무 데도 안 들어갔다 — WebKit은 누른 버튼으로 포커스를 옮기지 않는 대신 mousedown에서 **비워서**
 * (`body`로 간다), 셸에 있던 포커스까지 그 순간 떠난다.
 *
 * 붙어 있지 않으면(다른 탭 · 다른 work의 셸) 기다리는 포커스로 적는다 — 그 셸이 붙는 순간 한 번 준다(`openOrReattach`).
 *
 * **사이드바 work 행은 부르지 않는다.** 행은 기억된 화면을 연다 — spec 화면일 수도 있다.
 */
export function focusShell(id: number): void {
  const instance = instances.get(id);
  if (!instance) return;
  const attached = isAttached(instance);
  pendingFocus = nextPendingFocus(pendingFocus, { kind: "request", id, attached });
  if (attached) instance.term.focus();
}

/**
 * 탭 줄 위에서 손을 뗐다 — 드래그 상태가 틈을 들고 있으면 끈 셸을 그 틈으로 옮긴다
 * (UI개선 결정 11 · UI개선 스펙 S10). **두 화면(work 화면 · `/terminal`)이 같은 이것을
 * 준다** — 탭 줄은 스토어를 모르고, 「놓은 곳이 이긴다」의 탭 줄 몫을 화면마다 적으면 한쪽만
 * 늙는다.
 *
 * 틈이 없으면(탭 줄 밖에서 틈이 꺼졌다 · 제자리 · Esc로 취소해 상태가 비었다) 아무것도 안
 * 한다. 켜진 탭은 안 바뀐다 — 끌어 놓은 탭은 켜지지 않는다(제스처가 클릭을 삼킨다).
 * 순서는 메모리에만 있다(UI개선 결정 12).
 */
export function dropShellOnSlot(): void {
  const move = shellMoveOf(dragStore.state);
  if (move === null) return;
  terminalStore.setState((state) => moveShell(state, move.shellId, move.slot));
}

/** 이 id의 셸이 아직 목록에 있나. 끌기의 원천이 살아 있는지를 묻는 자리가 이것 하나다. */
function hasShell(id: number): boolean {
  return terminalStore.state.shells.some((shell) => shell.id === id);
}

// **끄는 셸이 목록에서 빠지면 끌기를 거둔다**(결정 48 · UI개선 스펙 S8). 셸이 사라지는 길은 여럿인데
// (정상 종료 · `×`·⌘W · 아카이빙의 회수) 모두 이 스토어의 상태를 바꾸므로, 길마다 부르는 대신 **상태를
// 보고** 거둔다 — 한 길만 빠뜨리면 받침이 선 채 없는 셸로 분할이 켜진다. 두 화면(work · `/terminal`)이
// 같은 이것을 딛는다. 비교는 id로만 한다: 소유자 키는 세계(Atelier·Maison)마다 다르지만 id는 하나다.
// 끝났어도 목록에 남은 칸(0 아닌 코드 · 시그널 — `markExited`)은 살아 있는 원천이라 끌기가 산다.
// **판정하는 자리는 이 구독 하나다.** 받는 자리(`dropShellOnSlot` · 본문 받침의 `dropHere`)는 다시 보지
// 않는다 — 구독이 상태 변경과 같은 틱에 끌기를 걷어 받침도 틈도 사라지므로 거기까지 닿을 길이 없고,
// 닿지 않는 검사는 어떤 시험도 붙들지 못한다.
terminalStore.subscribe(() => cancelGoneShellDrag(hasShell));

/**
 * 지금 본문이 보여 주고 있는 셸. **본문이 그 칸을 실제로 그리고 있을 때만** 찬다 —
 * 「어느 칸이 켜져 있나」(`activeByOwner`)는 그 화면의 **기억**이라 문서를 읽는 중에도 남아
 * 있고, 그것으로 「봤다」를 세우면 spec을 보는 내내 안 본 완료가 조용히 지워진다.
 *
 * 값을 채우는 자리는 `TerminalPane` 하나다 — 그 조각이 서 있다는 것이 곧 「본문이 셸을
 * 보여준다」이고, 두 화면(work · `/terminal`)이 같은 조각을 쓴다.
 *
 * **하나다.** 한때 배열이었고 그 근거가 「분할이면 켜진 탭이 둘」이었는데, 이 앱의 분할은
 * 조합이 늘 `spec ▏터미널`이라(결정 87 · `WorksPage`) **셸 열이 둘이 되는 화면이 없다**.
 * 그리고 배열이어도 그 날에 대비가 안 됐다 — 채우는 쪽이 목록을 통째로 대체하므로 둘째
 * pane의 `[B]`가 첫째의 `[A]`를 지우고, 정리(`showShell(null)`)는 살아 있는 쪽까지 비운다.
 * 그러니 배열은 「분할 때문」이 아니라 그저 없는 화면을 흉내 낸 모양이었다. 판정 쪽
 * (`ShellView.activeIds`)은 여전히 여럿을 받는데, 그것은 순수 함수의 계약이라 이 배선과
 * 무관하게 산다 — 열이 둘이 되는 날 고칠 자리는 여기 하나다.
 */
let shownShell: number | null = null;

/**
 * 앱 창이 포커스를 쥐고 있나(결정 7). 이 앱은 창이 하나라 어느 창인지 물을 것이 없다.
 *
 * **`document.hasFocus()`가 판정이고 `focus`/`blur`는 신호일 뿐이다.** 이벤트만으로는 못
 * 가른다 — 분할에서 spec 프레임을 누르면 부모 `window`에 `blur`가 오는데(SpecViewer의
 * `useFrameFocused`가 그 실측을 들고 있다) 그때도 앱은 앞에 있다. `hasFocus()`는 그
 * 경우에 참이고 다른 앱으로 넘어갔을 때만 거짓이라, 두 경우가 갈린다.
 *
 * **Tauri의 `onFocusChanged`를 안 쓴다.** 값은 더 정확하겠지만 IPC 구독이 하나 더 늘어
 * 픽스처 백엔드가 모르는 호출이 되고(L3의 `unknownIpcCalls`), 얻는 것은 이 DOM 이벤트가
 * 이미 주는 사실 하나다.
 *
 * **이 줄에 그물이 걸려 있다.** 여기가 참을 늘 돌려주면 아무도 안 보는 곳에서 「봤다」가
 * 서는데 그 fail-open은 초록이 안 뜨는 것으로만 나타나 화면에서 안 보인다 — 헤드리스
 * WebKit은 `document.hasFocus()`가 늘 참이라 브라우저에 맡길 수 없어서, L3가 그 함수를
 * 손으로 잡고 「창이 뒤에 있으면 초록이 선다」를 잰다(`e2e/terminal-tabs.spec.ts`).
 */
function windowFocused(): boolean {
  // 문서가 없는 자리(웹뷰 밖)에서는 **거짓**이다.
  return typeof document !== "undefined" && document.hasFocus();
}

/** 「봤다」 판정이 딛는 것 전부 — 지금 보이는 칸과 창 포커스(결정 7). */
function currentView(): ShellView {
  return { activeIds: shownShell === null ? [] : [shownShell], focused: windowFocused() };
}

/**
 * 보고 있는 셸에 「봤다」를 앉힌다. **판정은 `markShellsSeen` 하나**이고 이 자리는 그것에
 * 「지금 무엇이 보이나」를 건네기만 한다 — 알림 억제(#206)가 같은 함수를 쓴다.
 *
 * 안 바뀌면 같은 상태가 그대로 돌아오므로(그 함수의 계약) 창을 눌렀다 뗄 때마다 목록이
 * 다시 그려지지 않는다.
 */
function syncSeen(): void {
  terminalStore.setState((state) => markShellsSeen(state, currentView()));
}

/**
 * 본문이 지금 그리고 있는 셸을 알린다 — `TerminalPane`이 붙고 갈아타고 떠날 때마다 부른다.
 * 안 보이면 `null`이다.
 */
export function showShell(id: number | null): void {
  shownShell = id;
  syncSeen();
}

// **창이 앞으로 오는 것만으로도 「봤다」가 된다**(결정 7 · 스토리 10) — 알림을 눌러 돌아오면
// 그때 보고 있던 셸의 초록이 그 순간 꺼져야 「와서 봤다」로 읽힌다. 모듈 최상위에 거는 것은
// 위 구독들과 같은 이유이고, 웹뷰 밖(노드 seam)에서는 `window`가 없어 이 줄을 건너뛴다.
if (typeof window !== "undefined") {
  window.addEventListener("focus", syncSeen);
  // **`blur`에서도 부르는 것은 iframe 하나 때문이다.** 진짜 blur(다른 앱으로 넘어감)에서는
  // 이 호출이 아무 일도 안 한다 — `hasFocus()`가 거짓이라 「봤다」가 하나도 안 서고, 안
  // 바뀐 상태가 그대로 돌아온다. 값이 나는 것은 **blur는 오는데 `hasFocus()`는 참인** 경우
  // 뿐이고(위 `windowFocused` 머리말의 그 사례), 그 길이 실재한다: 다른 앱을 보다가 분할된
  // 화면의 spec 프레임을 **바로 눌러** 돌아오면 포커스가 자식 문서로 들어가므로 부모
  // `window`에는 `focus` 없이 `blur`만 온다. 그때 이 줄이 없으면 눈앞의 셸이 초록인 채로
  // 남는다 — 다음 이벤트가 올 때까지.
  window.addEventListener("blur", syncSeen);
}

/**
 * 그 칸의 PTY를 닫는다 — 닫기 IPC를 부르는 **세 자리**(`disposeInstance` · `failOpen` · spawn 왕복 중 닫힘)가 함께
 * 쓴다. 까닭은 닫는 자리로 표(`CLOSE_REASONS`)에서 고르고, 주인은 그 칸의 것을 싣는다(티켓 11). 백엔드는 그 닫기가
 * 끝낸 것을 정리 기록에 이 둘로 적는다. `ptyId`는 부르는 쪽이 준다 — spawn 왕복 중 닫힘은 칸에 아직 안 앉은 번호를 닫는다.
 */
function killPty(instance: ShellInstance, ptyId: number, path: ClosePath): void {
  ignoreGone(terminalApi.kill(ptyId, CLOSE_REASONS[path], instance.origin.owner));
}

/**
 * 인스턴스를 거둔다 — **이것이 유일한 정리 경로다.** 부르는 곳이 둘이다: `×`(`closeShell`)와
 * 정상 종료(결정 48로 목록에서 스스로 빠지는 칸). 흩어 놓으면 PTY만 죽고 인스턴스가
 * 남거나(스크롤백과, 쥐고 있었으면 WebGL 자리까지 쥔 채 리로드까지 산다) 목록에서만 빠지고 셸이 살아남는다.
 *
 * **`kill`은 스스로 갈린다.** 정상 종료로 오면 PTY가 이미 죽었고 `ptyId`도 그 자리에서
 * null로 눕혀지므로 아래 가드가 그대로 건너뛴다. 닫는 자리(`path`)는 닫기 IPC의 까닭을 고르는
 * 열쇠라(티켓 11) 정상 종료에는 없다 — 셸 스스로 끝남은 Rust가 안다.
 */
function disposeInstance(instance: ShellInstance, path: ClosePath | null): void {
  instances.delete(instance.id);
  instance.closed = true;
  // 그 셸을 기다리던 포커스는 버린다(프로세스 스펙 S21) — 줄 셸이 없다.
  pendingFocus = nextPendingFocus(pendingFocus, { kind: "closed", id: instance.id });
  // WebGL 자리에서도 뺀다(티켓 17) — 그 자리만큼 다음에 붙는 셸이 남의 addon을 놓지 않고 싣는다.
  webglSeats = closeWebgl(webglSeats, instance.id);
  if (instance.ptyId !== null && path !== null) killPty(instance, instance.ptyId, path);
  instance.observer.disconnect();
  // Terminal이 자기가 만든 DOM과 애드온을 함께 거둔다 — `_addonManager`가 `_register`로 묶여 있어 WebGL
  // 애드온도 여기서 놓인다. _한때 여기 「상한 8이 컨텍스트 수를 말하는 이상 이 한 줄이 상한을 되돌려준다」고 적혀
  // 있었는데 둘 다 틀렸다_(프로세스 결정 18 ③이 이렇게 고쳤다): 상한 8(`MAX_SHELLS`)은 컨텍스트가 아니라 **화면
  // (owner)마다의 셸 수**이고(결정 23), WebKit의 컨텍스트 슬롯은 dispose가 아니라 **GC 때** 풀린다. 앱 전체에서 쥐는
  // 컨텍스트 수를 지키는 것은 이제 WebGL 자리(`shell-webgl`)다.
  instance.term.dispose();
  instance.wrapper.remove();
}

/**
 * 셸을 거둔다. **셸을 죽이는 유일한 길이다**(결정 22). 화면을 옮기는 것으로는 여기 오지
 * 않는다(결정 20) — 프로세스 결정 7이 입력 없는 자동 셸만 예외로 두었다: 그 셸은 화면을 떠나면
 * 이 길로 닫힌다(`closeUnusedShells`).
 *
 * 목록에서 빼는 길은 이제 **둘이다** — 결정 48이 정상 종료한 칸을 스스로 빼기 때문이다.
 * 그쪽은 아래 채널 콜백이 같은 정리를 태운다.
 *
 * **밖으로 내보내지 않는다**(결정 92). ⌘W와 `×`는 확인을 거치는 `requestCloseShell`만
 * 볼 수 있어야 한다 — 「두 길이 같은 판정을 쓴다」를 주석으로 부탁하는 대신, 확인을
 * 건너뛰는 이름이 아예 손에 안 잡히게 둔다. 여기를 직접 부르는 길은 넷이다 — 아카이빙의
 * 회수(`closeShellsOf`)에는 사람이 이미 한 번 확인했고, 안 쓴 자동 셸의 회수(`closeUnusedShells`)에는
 * 물을 것이 없다(입력이 없으면 자손은 모두 셸 도우미다 — 프로세스 스펙 P1). MCP로 아카이브된 work의
 * 조용한 셸(`settleOwners`)에도 물을 것이 없고(명령도 사람이 띄운 자손도 없다), 주인 잃은 셸의
 * [모두 닫기](`closeOrphans`)는 셸마다가 아니라 **한 번** 물었다(티켓 12).
 *
 * 부르는 쪽은 **닫는 자리**(`path`)를 말한다 — 까닭은 그 자리로 표가 고른다(`CLOSE_REASONS` · 티켓 11).
 */
function closeShell(id: number, path: ClosePath): void {
  const instance = instances.get(id);
  if (instance) disposeInstance(instance, path);
  terminalStore.setState((state) => removeShell(state, id));
}

/**
 * 사람이 셸을 닫으려 한다 — **⌘W와 `×`가 함께 여기로 온다**(결정 92). 셸 하나를 없애는
 * 길이 둘인데 한쪽만 막으면 같은 사고가 마우스로만 남는다.
 *
 * **닫기 직전에** 백엔드에 묻는다 — 명령이 도는가와 함께 끝날 프로세스 수(프로세스 결정 3). 셸 상태에 얹어 두지
 * 않는 것은 그 값이 매 순간 바뀌기 때문이다 — 얹으면 폴링이 생기고, 필요한 순간은 닫을 때 한 번뿐이다.
 *
 * 무엇을 보고 묻는지도, 무엇이라 묻는지도, 물은 답을 어떻게 읽는지도 `confirmClose`가 혼자 안다(끝난 칸·못 얻은
 * 판정까지). 여기서 한 번 더 가르지 않는다 — 여기 남는 것은 **확인 창을 건네는 일**뿐이고,
 * 그것이 저쪽을 순수하게 잴 수 있는 모양으로 만든다.
 */
export async function requestCloseShell(id: number): Promise<void> {
  const shell = terminalStore.state.shells.find((one) => one.id === id);
  // **앱의 창이다**(OS 시트가 아니다) — 창 하나만 남의 글꼴·남의 모서리로 뜨면 그것이
  // 앱 밖의 일처럼 읽힌다. 문구는 `closeNotice`가 든다(결정 105 · 프로세스 스펙 P6).
  const ask = (body: string) => askDialog({ title: "셸 닫기", body, confirm: "닫기", danger: true });
  if (!(await confirmClose(shell, await closeCheck(id), ask))) return;
  closeShell(id, "person");
}

/**
 * 종료 확인이 적을 수(UI개선 결정 15 · 프로세스 스펙 S18). **두 세계를 합친** 목록 전부를 센다 — 이 스토어는
 * 세계마다 갈리지 않고 한 벌이다(owner가 세계를 싣는다). 명령이 도는지와 띄운 프로세스 수는 셸 닫기 확인과 **같은
 * 물음**을 셸 여럿에 한 번에 보내 지금 묻는다 — 1초 폴링 값(`running`)은 늦다. 세는 규칙은 `countQuitShells`가
 * 혼자 안다.
 */
export function quitShellCounts(): Promise<QuitCounts> {
  return countQuitShells(terminalStore.state.shells, closeChecks);
}

/**
 * 이 owner의 셸들에서 띄워 함께 끝날 프로세스 수 — 아카이브 · 삭제 확인 창의 「(띄운 프로세스 M개 포함)」이다
 * (프로세스 스펙 S18). 못 얻으면 `null`이다. 세는 규칙은 `countSpawned`가 혼자 안다.
 */
export function spawnedCountOf(owner: ShellOwner): Promise<number | null> {
  return countSpawned(shellsOf(terminalStore.state, owner), closeChecks);
}

/**
 * 백엔드에 이 칸의 닫기 전 물음 — 명령이 도는가와 함께 끝날 프로세스 수 — 을 묻는다. **못 얻으면 `null`이다** —
 * 모르는 것을 이유로 사람이 고른 닫기를 막지 않는다.
 *
 * `null`로 오는 길이 둘이다: PTY가 아직·이미 없는 칸(`ptyId`가 null — 못 뜬 칸과 스스로
 * 끝난 칸이 그렇다)과, 백엔드가 판정을 못 낸 경우(tcgetpgrp 실패, 이미 지워진 id).
 */
async function closeCheck(id: number): Promise<CloseCheck | null> {
  const ptyId = instances.get(id)?.ptyId ?? null;
  if (ptyId === null) return null;
  try {
    return await terminalApi.commandRunning(ptyId);
  } catch {
    return null;
  }
}

/**
 * 여러 칸의 닫기 전 물음을 **한 번에** 보낸다(티켓 08) — 레지스트리 id를 pty id로 바꿔 묻고, 답을 레지스트리 id로
 * 되돌린다. 답한 칸만 든다: pty가 아직·이미 없는 칸은 묻지도 않는다. 물을 칸이 하나도 없으면 IPC 없이 빈 답이다.
 * 물음이 실패하면 `null`이다.
 */
async function closeChecks(ids: number[]): Promise<CloseChecks | null> {
  const asked = ids.flatMap((id) => {
    const ptyId = instances.get(id)?.ptyId ?? null;
    return ptyId === null ? [] : [{ id, ptyId }];
  });
  if (asked.length === 0) return new Map();
  try {
    const answers = await terminalApi.closeChecks(asked.map(({ ptyId }) => ptyId));
    return new Map(asked.flatMap(({ id, ptyId }) => (answers[ptyId] ? [[id, answers[ptyId]] as const] : [])));
  } catch {
    return null;
  }
}

/**
 * pty id로 그 칸의 **레지스트리 id**를 되찾는다. **둘은 다른 번호다** — 레지스트리는 자기
 * 번호를 스스로 발급하고(`openShell`의 주석: 못 뜬 칸에는 pty id라는 것이 아예 없다),
 * 백엔드는 그것을 모른다. 위 `closeCheck`가 반대 방향으로 가는 그 사이를 이쪽으로 잇는다.
 *
 * **모르는 pty id가 실제로 온다.** 이벤트가 오는 사이에 그 칸이 `×`로 닫혔거나 스스로
 * 끝났으면 `ptyId`가 이미 null로 눕혀져 있다. 그때는 `null`이고, 부르는 쪽이 건너뛴다.
 *
 * 훑는 것이 화면마다 최대 8칸이라(결정 23) 뒤집힌 색인을 따로 들지 않는다 — 앱 전체로는
 * 화면 수만큼 곱해지지만 사람이 동시에 여는 화면은 손에 꼽는다. 그 색인은 `ptyId`가
 * 바뀌는 자리 셋(spawn 응답·종료 프레임·`×`)과 늘 맞춰야 하고, 어긋나면 값이 남의 칸에 앉는다.
 */
function shellOfPty(ptyId: number): number | null {
  for (const instance of instances.values()) {
    if (instance.ptyId === ptyId) return instance.id;
  }
  return null;
}

/**
 * 도는 명령을 **상시 구독한다**(adr-04). 백엔드가 1초마다 재서 **바뀐 셸만** 실어 보낸다.
 *
 * **모듈 최상위에 건다 — 이펙트가 아니다.** `onTitleChange`를 인스턴스에 붙이는 것과 같은
 * 이유다: 이펙트에 두면 배경 칸(결정 21로 React 트리 밖에 사는 칸)이 못 받는다. 받는 쪽이
 * React가 아니라 모듈 싱글턴 스토어라 붙일 화면도 필요 없다.
 *
 * **한 번의 `setState`로 끝낸다.** 회차마다 여러 셸이 실려 오는데 칸마다 setState를 부르면
 * 그 수만큼 구독자가 깨어난다.
 *
 * **못 걸어도 셸은 뜬다.** 웹뷰 밖(노드 seam)에서는 이 통로가 없어 여기가 실제로 거절당한다.
 * 멈추면 터미널을 통째로 못 쓰는데 로고 하나를 못 얻은 값으로는 과하다 — `loadTerminalSettings`
 * 와 같은 판단이고, 이유만 남긴다.
 */
void onPtyRunning((changed) => {
  terminalStore.setState((state) => {
    let next = state;
    for (const one of changed) {
      const id = shellOfPty(one.id);
      if (id !== null) next = setRunning(next, id, one.running);
    }
    return next;
  });
}).catch((error) => {
  console.warn("atelier: 도는 명령을 구독하지 못했다 — 로고가 안 뜬다", error);
});

/**
 * 셸이 훅으로 **스스로 말한 것**을 상시 구독한다. 자리와 이유는 바로 위와 같다 — 모듈
 * 최상위라야 배경 칸(결정 21)도 받는다. 회차 하나를 **`setState` 한 번**으로 끝내는 것도
 * 같은 이유다.
 *
 * 번호를 두 번 옮긴다: 셸 ID → pty 번호(`ptyIdOf`) → 레지스트리 번호(`shellOfPty`). 훅은
 * env로 받은 문자열 하나만 알고, 백엔드는 pty 번호만 알고, 목록은 자기 번호를 스스로
 * 발급하기 때문이다. **모르는 번호가 실제로 온다** — 파일이 사라진 알림이 오는 사이에 그
 * 칸이 닫혔으면 이을 것이 없고, 그때는 그냥 건너뛴다.
 *
 * **무엇이 되는지는 여기서 안 정한다.** 접는 것은 `nextAttention` 하나이고 이 자리는 그
 * 답을 칸에 앉히기만 한다 — 규칙이 스토어로 새면 검사가 DOM 있는 seam으로 올라간다.
 */
void onShellAttention((changed) => {
  terminalStore.setState((state) => {
    let next = state;
    for (const one of changed) {
      const ptyId = ptyIdOf(one.shellId);
      const id = ptyId === null ? null : shellOfPty(ptyId);
      if (id === null) continue;
      next = setAttention(next, id, nextAttention(attentionOfId(next, id), one.state));
    }
    // **막 도착한 사실도 「봤다」를 거친다.** `applySignal`이 `seen`을 늘 푸는데(그 머리말),
    // 그 셸을 지금 보고 있는 중이라면 사람은 이미 본 것이다 — 안 거치면 켜진 칸이 초록으로
    // 번쩍였다가 다음 포커스 변화에나 꺼지고, 같은 판정을 쓰는 알림(#206)이 「보고 있는데
    // 울리는」 그림이 된다(스토리 58).
    return markShellsSeen(next, currentView());
  });
}).catch((error) => {
  console.warn("atelier: 셸이 말한 것을 구독하지 못했다 — 상태가 안 뜬다", error);
});

/**
 * **훅 없는 셸의 보너스 길**이 상태를 앉히는 자리(#208 · 결정 11의 P). OSC 9·777과 벨이 여기
 * 하나로 모인다 — 아래 `createInstance`가 인스턴스마다 셋을 걸고, 무엇이 되는지는
 * `shell-osc.ts`(정규 이벤트)와 `shell-attention.ts`(화면값)가 나눠 안다.
 *
 * **훅 길과 같은 문으로 들어간다.** `applySignal` 하나만 딛으므로 권위 규칙(훅이 한 번이라도
 * 말한 셸에서는 무시)이 이 길에도 저절로 걸린다 — 여기서 칸을 직접 짜면 그 규칙을 두 번
 * 적게 되고, 한쪽만 늙는 날 훅 셸의 앰버가 Codex TUI의 OSC 한 장에 꺼진다.
 *
 * **누가 말했는지는 `null`이다.** PTY는 그 바이트가 어느 프로세스에서 나왔는지 안 적는다 —
 * 이 갈래에서 마크를 내는 것은 「지금 도는 것」뿐이다(`SignalView.running`).
 *
 * **번호를 안 옮긴다.** 여기 오는 것은 xterm 인스턴스의 **레지스트리 id**라 훅 길이 하는
 * 두 번의 변환(셸 ID → pty 번호 → 레지스트리 번호)이 필요 없다.
 *
 * 「봤다」를 마지막에 한 번 거치는 것은 훅 길과 같은 이유다 — 지금 보고 있는 셸에 도착한
 * 완료는 사람이 이미 본 것이라, 안 거치면 켜진 칸이 초록으로 번쩍였다 꺼지고 알림이 운다.
 */
function applyBonusSignal(id: number, signal: AgentSignal | null, source: AttentionSource): void {
  if (signal === null) return;
  terminalStore.setState((state) => {
    const prev = attentionOfId(state, id);
    const next = setAttention(state, id, applySignal(prev, signal, Date.now(), source, null));
    return markShellsSeen(next, currentView());
  });
}

/**
 * **출력이 도착했다**를 그 칸에 알린다 — 이 판에서 상태를 푸는 유일한 이벤트다(#208).
 *
 * **`setState` 앞에서 먼저 판정한다.** 이 함수는 PTY 프레임마다 불리는데(초당 수십 번),
 * 스토어는 값이 안 바뀌어도 부르면 구독자를 깨운다 — 그대로 두면 셸이 글자를 뱉는 내내
 * 사이드바 열여덟 행이 다시 그려진다. `nextOnOutput`이 안 바뀔 때 **받은 것을 그대로**
 * 돌려주는 것이 그래서 계약이고, 이 자리는 그 항등성만 보고 문을 연다.
 */
function noteOutput(id: number): void {
  const prev = attentionOfId(terminalStore.state, id);
  const next = nextOnOutput(prev, Date.now());
  if (next === prev) return;
  terminalStore.setState((state) => setAttention(state, id, next));
}

// ── 알림과 독 배지 (#206 · 결정 10)
//
// **판정은 여기 없다.** 무엇이 울리는지는 `shell-notify.ts`의 순수 함수 둘이 정하고
// (`decideNotification`과 그것을 회차에 거는 `createNotifier`), 이 자리가 하는 일은 셋이다 —
// 회차마다 재료를 뽑아 건네고, 나온 답을 채널로 내보내고, 배지를 맞춘다.
//
// **자리가 여기인 이유는 「보고 있는가」다.** 알림 억제는 결정 7의 판정을 그대로 쓰는데
// (스토리 80) 그 값(`currentView`)은 이 모듈의 것이다. 사이드바에 두면 「봤다」를 아는 자리가
// 둘이 되고, 그러면 탭의 초록과 알림이 다른 순간에 같은 판정을 쓰게 된다.
//
// **이펙트가 아니라 모듈 구독인 것**도 위 두 구독과 같은 이유다: 배경 칸(결정 21)이 부르는
// 것도 알려야 하고, `main.tsx`가 StrictMode라 이펙트에 두면 개발 중에 판정기가 두 벌이 된다.

const notifier = createNotifier();

/**
 * 슬러그를 사람이 읽는 이름으로 바꾸는 함수. **밖에서 온다** — 터미널은 슬러그까지만 알고
 * (`bandRows` 머리말) work 제목은 목록 API의 것이다. 채우는 자리는 사이드바 하나이고
 * (`setNotifyTitles`), 아직 안 왔으면 슬러그가 그대로 제목이 된다 — 띠가 모르는 슬러그를
 * 다루는 방식과 같다.
 */
let notifyTitleOf: (owner: ShellOwner) => string = (owner) => slugOfOwner(owner) ?? TERMINAL_LABEL;

/**
 * 알림 제목이 읽을 이름표를 건넨다. 사이드바가 목록을 받을 때마다 부른다 — 그쪽이 슬러그와
 * 제목을 둘 다 쥔 유일한 자리다(`bandItems`가 같은 이유로 거기 산다).
 */
export function setNotifyTitles(resolve: (owner: ShellOwner) => string): void {
  notifyTitleOf = resolve;
}

/** 지금 독에 붙어 있는 수. 안 바뀌면 IPC를 안 태운다 — 이 배선은 상태가 바뀔 때마다 돈다. */
let badgeShown = 0;

/**
 * 회차 하나. **구독이 부르고, 설정이 바뀔 때도 부른다.**
 *
 * **판정기는 알림이 꺼져 있어도 돈다.** 안 돌리면 꺼 둔 동안의 전이가 기억에 안 앉고, 다시
 * 켜는 순간 그동안 쌓인 것이 한꺼번에 「처음 들어옴」으로 울린다 — 조용히 있으라고 끈
 * 사람에게 가장 나쁜 모양이다.
 */
function notifyTick(): void {
  const rows = notifyShells(terminalStore.state, currentView(), notifyTitleOf);
  const fired = notifier.step(rows, Date.now());
  // **고른 값이 무엇을 바꾸는지도 여기 없다**(`outgoing`). 「끄면 조용하다」·「소리만 끈다」를
  // 이 배선 안의 `if`로 들면 그 두 줄을 지워도 어느 층도 빨개지지 않는다 — 순수 함수로
  // 내려야 표가 그것을 잡는다(2026-09-10 리뷰).
  const { toShow, badge } = outgoing(fired, rows.length, notifyChoice());
  setBadge(badge);
  for (const one of toShow) show(one);
}

/**
 * 독 아이콘의 수(스토리 65). **크로스 플랫폼 API라 `cfg` 분기가 없다** — Windows에서만
 * 조용히 무시된다.
 *
 * `undefined`가 「배지를 없앤다」다(`setBadgeCount`의 계약) — 0을 넘기면 동그라미 안에 0이
 * 앉는다.
 */
function setBadge(count: number): void {
  if (count === badgeShown) return;
  badgeShown = count;
  getCurrentWindow()
    .setBadgeCount(count === 0 ? undefined : count)
    .catch((error) => {
      console.warn("atelier: 독 배지를 못 붙였다", error);
    });
}

/**
 * 알림 하나를 내보낸다. **모양은 이미 정해져 왔다**(`notificationPayload`) — 이 함수가 아는
 * 것은 채널 하나뿐이다.
 *
 * **앱이 클릭에 걸 것이 없다.** 스펙은 「되면 셸 탭까지, 안 되면 창 앞세우기까지」라 적었는데,
 * 이 플러그인의 데스크톱 경로는 **클릭을 아예 안 받는다** — `desktop.rs`의
 * `NotificationBuilder::show()`가 `notify_rust`에 title·body·icon·sound만 넘기고 응답
 * 핸들러를 걸지 않으며(그래서 `notify_rust`의 `wait_for_click`도 안 탄다), 액션 API는
 * 모바일 전용이다.
 *
 * **그래도 창 앞세우기는 OS가 한다** — 같은 `show()`가 macOS에서
 * `notify_rust::set_application(…)`으로 알림 주체를 세우는데, 그 인자가 릴리스에서는 앱의
 * 번들 id이고 **`tauri::is_dev()`이면 `com.apple.Terminal`이다**(2.4.0 `desktop.rs`). 그래서
 * 이 자리의 실물 확인은 **번들된 `.app`으로 해야 한다**: `tauri dev`로 누르면 앞으로 오는
 * 것은 터미널 앱이고, 그것을 「안 된다」로 읽으면 기준이 거짓 음성으로 닫힌다.
 *
 * 창이 앞으로 온 뒤는 스토리 10이 받는다 — 포커스를 얻는 순간 켜져 있던 셸의 초록이
 * 꺼진다(`syncSeen`의 `focus` 리스너).
 */
function show(payload: NotifyPayload): void {
  try {
    sendNotification(payload);
  } catch (error) {
    // 웹뷰 밖(노드 seam)이나 채널이 없는 자리에서 여기가 실제로 터진다. 알림 하나를 못 낸
    // 값으로 상태 갱신을 멈추지 않는다 — 화면은 이미 같은 사실을 그리고 있다.
    console.warn("atelier: 알림을 못 띄웠다", error);
  }
}

// **알림의 구독은 이 하나다.** 설정은 스토어가 아니라 평범한 모듈 값이라(`notify-settings.ts`의
// 머리말 — 그 이유가 여기서 났다) 이 콜백이 읽어도 딸려 오는 의존이 없다.
terminalStore.subscribe(notifyTick);
// 설정이 바뀌면 배지가 그 자리에서 따라와야 한다 — 끈 순간 독에 수가 남아 있으면 「껐는데
// 아직 부른다」로 읽힌다.
onNotifySettingsChanged(notifyTick);

/**
 * 이 Work의 셸을 전부 거둔다 — **UI에서** 아카이빙·삭제가 **성공한 뒤에** 부른다(결정 26).
 *
 * 순서가 계약이다. 먼저 죽이면 dirty 거부에 걸렸을 때 **Work는 남고 돌던 claude만 사라진다.**
 * 고르는 것은 `shellsOf` 하나라 다른 Work의 셸과 최상위 터미널의 셸은 안 걸린다.
 *
 * 결정 26은 MCP로 아카이브 · 삭제된 work의 셸을 「알려진 대가」로 남겨 두었다 — 그 길은 이 함수를 안 지난다. 프로세스
 * 결정 4가 이렇게 고쳤다: 앱 루트가 목록 재조회로 알아채(`settleOwners`) 조용한 셸은 닫고, 나머지는 「주인 잃은 셸」로
 * 남겨 알린다. 그 감지가 이 길의 셸을 세지 않게 부르는 쪽이 제외 창을 연다(`holdOwner`).
 */
export function closeShellsOf(owner: ShellOwner): void {
  for (const shell of shellsOf(terminalStore.state, owner)) closeShell(shell.id, "archive");
}

/**
 * **제외 창**(티켓 12 · 프로세스 스펙 S13) — UI 아카이브 · 삭제가 도는 동안의 owner. owner마다 **센다**: 같은 work을 두
 * 길이 겹쳐 잡으면(아카이브가 도는 사이 삭제) 먼저 끝난 쪽이 창을 닫아 남은 쪽의 셸이 감지에 걸리면 안 된다.
 */
const heldOwners = new Map<ShellOwner, number>();

/** 지금 판정 중인 칸 — 배치 물음을 기다리는 사이 다음 목록이 앉아도 같은 칸을 두 번 판정하지 않는다. */
const judging = new Set<number>();

/**
 * 그 owner를 감지에서 뺀다 — **돌려주는 함수로 닫는다**(두 번 불러도 한 번만 닫힌다). UI 아카이브 · 삭제 길은 성공한 뒤
 * 제 손으로 닫으므로(`closeShellsOf`) 그동안 앉은 재조회가 사람이 이미 확인한 셸을 주인 잃은 셸로 세우면 안 된다.
 *
 * 여는 자리는 확인 창이 참을 돌려준 뒤 · 코어 호출 **전**이고, 닫는 자리는 그 owner의 셸 닫기가 끝난 **뒤**다. 호출이
 * 실패하면 그 자리에서 닫는다(`WorksPage`). 삭제는 재조회가 앉은 뒤에야 돌아오고 아카이브는 안 기다려서, 워처의 재조회가
 * 회수 앞뒤 어디에나 올 수 있다 — 창이 이만큼 넓어야 하는 까닭이다.
 */
export function holdOwner(owner: ShellOwner): () => void {
  heldOwners.set(owner, (heldOwners.get(owner) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (heldOwners.get(owner) ?? 1) - 1;
    if (left > 0) heldOwners.set(owner, left);
    else heldOwners.delete(owner);
  };
}

/**
 * 그 세계의 목록이 새로 앉았다 — **slug가 사라진 work의 셸을 다룬다**(프로세스 결정 4 · 티켓 12). 부르는 자리는 앱 루트
 * 하나다(`ShellOwners`): 목록 쿼리가 성공으로 앉을 때마다.
 *
 * 1. 사라진 owner를 찾는다(`vanishedOwners` — 실패 · 로딩이면 판단 안 함, 제외 창 · 이미 주인 잃은 셸은 뺀다).
 * 2. 그 셸들이 조용한지 **배치 물음 한 번으로** 본다(티켓 08의 `pty_close_checks`).
 * 3. 조용한 셸은 곧바로 닫는다 — 까닭은 「MCP 아카이브」다. 나머지는 「주인 잃은 셸」로 표시하고 남긴다: 부탁을 보낸
 *    claude가 대개 그 셸 안에 있어, 닫으면 도구 호출 도중 죽는다. 기다렸다가 저절로 닫지 않는다(결정 4의 기각).
 * 4. 남긴 것이 있으면 토스트를 세운다(`showOrphans`).
 *
 * **물음을 기다린 뒤 다시 본다.** 그사이 사람이 UI로 아카이브를 시작했거나(제외 창) 셸이 닫혔을 수 있다 — 기다리기 전에
 * 고른 목록을 그대로 믿으면 사람이 확인한 셸이 주인 잃은 셸로 선다.
 */
export async function settleOwners(mode: Mode, result: ListResult | undefined): Promise<void> {
  const gone = vanishedOwners(terminalStore.state, mode, result, heldOwners);
  const ids = terminalStore.state.shells
    .filter((shell) => gone.includes(shell.owner) && !judging.has(shell.id))
    .map((shell) => shell.id);
  if (ids.length === 0) return;
  for (const id of ids) judging.add(id);
  try {
    const checks = await closeChecks(ids);
    const left: number[] = [];
    for (const id of ids) {
      const shell = terminalStore.state.shells.find((one) => one.id === id);
      if (!shell || shell.orphaned || heldOwners.has(shell.owner)) continue;
      if (isQuietShell(shell, checks)) closeShell(id, "mcpArchive");
      else left.push(id);
    }
    if (left.length === 0) return;
    terminalStore.setState((state) => markOrphaned(state, left));
    showOrphans(mode);
  } finally {
    for (const id of ids) judging.delete(id);
  }
}

/**
 * 그 세계의 주인 잃은 셸 토스트를 세운다(티켓 12). **동작 토스트다** — 자기 id를 써서(`orphanToastId`) 다시 오면 그
 * 자리를 고치고, 누르거나 닫을 때까지 남는다. N은 **도는** 주인 잃은 셸이다. 도는 것이 없으면 세우지 않는다 — 「아직
 * 도는 것이 있어요」가 거짓이 된다.
 */
function showOrphans(mode: Mode): void {
  const count = liveOrphansOf(terminalStore.state, mode).length;
  if (count === 0) return;
  showAppToast({
    id: orphanToastId(mode),
    text: orphanNotice(mode, count),
    action: { label: "모두 닫기", run: () => void closeOrphans(mode) },
  });
}

/**
 * [모두 닫기] — 그 세계의 주인 잃은 셸을 **한 번 묻고** 모두 닫는다(티켓 12). 셸마다 닫기 확인 창(08)을 띄우면 창이 N번
 * 뜬다. 창은 N과, 그 셸들에서 띄워 함께 끝날 프로세스 수 M을 말한다(M은 배치 물음 한 번 — 못 얻으면 안 붙는다).
 *
 * 닫는 길은 셸 닫기이고 까닭은 **「셸 닫기」**다 — 사람이 누른 닫기라 판 04의 `●`를 켜지 않는다(프로세스 스펙 S41).
 * 끝난 칸도 함께 거둔다(`orphansOf`). 도는 것이 없으면 물을 것이 없어 묻지 않는다. 취소하면 토스트는 그대로 남는다.
 *
 * 판 04의 `Processes` 주인 잃은 셸 묶음의 [모두 닫기](티켓 32)도 이 규칙을 그대로 쓴다.
 */
async function closeOrphans(mode: Mode): Promise<void> {
  const live = liveOrphansOf(terminalStore.state, mode);
  if (live.length > 0) {
    const spawned = await countSpawned(live, closeChecks);
    const body = orphansCloseNotice(live.length, spawned);
    if (!(await askDialog({ title: "주인 잃은 셸 닫기", body, confirm: "모두 닫기", danger: true }))) return;
  }
  appToasts.close(orphanToastId(mode));
  for (const shell of orphansOf(terminalStore.state, mode)) closeShell(shell.id, "orphans");
}

/**
 * 띠에서 누른 셸이 **주인 잃은 셸이면** 그 세계의 토스트를 다시 세우고 참을 돌려준다(프로세스 스펙 S14). 부르는 쪽은
 * 참이면 **화면을 옮기지 않는다** — 그 work은 목록에 없다. 판 04부터는 `Processes`로 간다(티켓 32).
 */
export function remindOrphan(id: number): boolean {
  const mode = orphanedWorldOf(terminalStore.state, id);
  if (mode === null) return false;
  showOrphans(mode);
  return true;
}

/**
 * 화면을 떠났다 — `from` owner의 **안 쓴 자동 셸**을 닫는다(프로세스 결정 7 · 프로세스 스펙 S17). 부르는 자리는
 * 앱 루트 하나다(`ShellReclaim`): 라우터의 현재 owner가 바뀌는 순간이다. 무엇을 닫는지는 `reclaimOnLeave`가
 * 혼자 정한다 — 같은 owner에 머무는 spec 탭 전환은 떠남이 아니고, 사람이 연 셸과 입력을 받은 셸은 안 나온다.
 *
 * **묻지 않는다.** 닫는 길은 `×`와 같은 `closeShell`이라 그 셸의 자손까지 끝난다(프로세스 결정 3). 입력이 없으면
 * 자손은 모두 셸 도우미라 확인 창이 물을 것이 없다 — 프로세스 스펙 P1의 기본값에 기대는 문장이다.
 */
export function closeUnusedShells(from: ShellOwner | null, to: ShellOwner | null): void {
  for (const id of reclaimOnLeave(terminalStore.state, from, to)) closeShell(id, "reclaim");
}

/**
 * 셸 쪽에서 일어난 일을 사람 입력인지 가려, **첫 것**이면 시각을 찍어 적고 백엔드에 알린다(프로세스 결정 7 ·
 * 프로세스 스펙 S16 · P1). 무엇이 사람 입력인지는 `humanInput`이 혼자 정한다 — 이 자리는 그 답에 시각을 붙인다.
 *
 * **시각을 찍는 자리가 여기인 것은 시계 규칙 때문이다.** 터미널 폴더에서 시간을 아는 파일은 셋뿐이고
 * (`shell-attention.test.ts`의 소스 스캔) 이 스토어가 그중 하나다. 판정 모듈은 시간을 모른다.
 *
 * 둘째 입력부터는 판정도 안 탄다 — 키를 칠 때마다 불리는 자리다.
 */
function noteInput(instance: ShellInstance, happening: InputHappening): void {
  if (instance.closed || firstInputOfId(terminalStore.state, instance.id) !== null) return;
  if (!humanInput(happening)) return;
  const at = Date.now();
  terminalStore.setState((state) => markFirstInput(state, instance.id, at));
  tellFirstInput(instance, at);
}

/**
 * 첫 사람 입력을 백엔드에 알린다 — **셸마다 한 번이다.** 백엔드는 그 셸의 자손 중 이 순간 전에 태어난 것을
 * 셸 도우미로 가른다(티켓 08). 시각은 사람 입력을 본 순간의 값이다 — 백엔드가 받은 순간이 아닌 까닭은
 * `pty::note_first_input`이 든다.
 *
 * pty가 아직 없으면(spawn 응답 전) 여기서는 못 알린다. 응답이 앉는 자리가 다시 부른다(`spawn`).
 * 실패는 흘린다 — 셸이 이미 끝났거나(다른 IPC와 같은 경주) 다리(L4)가 PTY를 모르는 것이다.
 */
function tellFirstInput(instance: ShellInstance, at: number): void {
  if (instance.ptyId !== null) ignoreGone(terminalApi.firstInput(instance.ptyId, at));
}

/**
 * 활성 칸의 집을 `host`에 들인다. 이미 열려 있으면 다시 붙는 길이고, 그때 **`fit` → PTY
 * `resize`를 한 번 태운다** — 떼어 둔 사이에 ⌘B로 본문 폭이 바뀌었을 수 있다.
 */
export function attachShell(host: HTMLElement, id: number): void {
  const instance = instances.get(id);
  // 그리는 것과 이펙트가 도는 것 사이에 그 칸이 `×`로 빠질 수 있다. 다음 상태가 곧 이
  // 이펙트를 다시 돌린다.
  if (!instance) return;
  host.appendChild(instance.wrapper);
  openOrReattach(instance, "attach");
}

/**
 * 집을 DOM에서 뺀다. **`dispose`도 `kill`도 없다** — 다른 nav를 한 번 본 대가로, 또는 옆
 * 칸으로 갈아탄 대가로 셸이 죽지 않는다(결정 20·21). 프로세스 결정 7이 입력 없는 자동 셸만 예외로
 * 두었는데, 그 회수도 여기가 아니다 — 패인이 내려가는 것은 spec 탭 전환에도 일어나 떠남이 아니다.
 * 떠남은 앱 루트가 owner로 잰다(`closeUnusedShells`).
 */
export function detachShell(id: number): void {
  instances.get(id)?.wrapper.remove();
  // 열리지 못한 채 떨어진 셸의 기다리는 포커스는 버린다 — 사람이 떠났다(`nextPendingFocus`). 열린 셸은 붙는 순간
  // 이미 소비했다.
  pendingFocus = nextPendingFocus(pendingFocus, { kind: "detached", id });
}

function createInstance(id: number, origin: ShellOrigin): ShellInstance {
  // **설정을 여기서 파일에서 읽지 않는다** — 앱이 뜰 때 한 번 읽어 스토어에 들어 있고
  // (`terminal-settings.ts`), 셸을 만들 때마다 읽으면 ⌘T가 IPC 왕복을 탄다. 아직 안 왔으면
  // `terminalLook`이 기본값으로 답하고, 늦게 오면 아래 `restyleShells`가 이 칸을 따라오게 한다.
  const look = terminalLook(terminalSettingsStore.state);
  const term = new Terminal({
    fontFamily: look.fontFamily,
    fontSize: look.fontSize,
    theme: terminalThemeFor(look.theme),
    scrollback: 10000,
    // **팔레트와 함께 와야 하는 값이다.** 결정 54가 ANSI 16색을 VS Code Dark+에서
    // 그대로 가져왔는데, 그 열여섯 색이 VS Code에서 읽히는 이유의 절반은 VS Code가
    // 대비 바닥 4.5를 함께 출하하기 때문이다. xterm의 기본값은 1(= 아무것도 안 한다)이라
    // 검정(SGR 30) `#000000`이 새 바탕 `#1e1e1e` 위에서 1.26:1로 묻힌다.
    //
    // 색을 우리가 고르는 것이 아니다 — 팔레트는 그대로 두고 **그리는 순간의 바닥만**
    // 준다. 기본을 어둡게로 옮긴 이 판이 만든 경로라, 고치는 자리도 이 판이다.
    minimumContrastRatio: 4.5,
    // **막대 자리를 예약하지 않는다 — 그래야 오른쪽 끝까지 글자가 간다**(결정 26).
    //
    // `FitAddon`이 `cols`를 셀 때 `showScrollbar`면 폭에서 **14px 빼고** 나눈다
    // (`addon-fit`의 `proposeDimensions`). xterm 6의 막대는 `position: absolute`로 화면 위에
    // **겹쳐** 뜨는 것이라(VS Code식 `xterm-scrollable-element`) 그 14px은 「막대가 글자를
    // 덮지 않게」 비워 두는 자리다 — 실측으로 오른쪽에 22px이 남았고, 그중 14가 이것,
    // 나머지 8이 `cols` 내림 잉여였다.
    //
    // **그 막대는 평소 `opacity: 0`이다**(`xterm-invisible`) — 스크롤·hover에만 잠깐 뜬다.
    // 늘 보이지도 않는 것을 위해 한 화면의 오른쪽 끝을 늘 비워 두는 셈이라, 오른쪽에 붙는
    // 프롬프트를 쓰는 셸에서는 그 자리가 「끝나지 않은 여백」으로 보인다.
    //
    // _한때 감수했던 것_: 스크롤백 10,000줄에 위치를 알려 주는 막대가 없었다. 결정 32가
    // 그것을 돌려줬다 — 앱 공통 막대가 콘텐츠 **위에** 떠서 폭을 한 칸도 안 먹는다
    // (`open()` 뒤에 `xterm-viewport`에 `scroll-quiet`을 건다).
    scrollbar: { showScrollbar: false },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // **핸들러를 반드시 준다.** 기본 핸들러는 `window.open`이라 웹뷰에서 아무 일도 안 한다.
  // 이 경로라야 기본 브라우저가 열리고 앱 화면은 그 자리에 그대로 남는다(결정 30).
  term.loadAddon(new WebLinksAddon((_, uri) => void openUrl(uri)));

  const wrapper = document.createElement("div");
  // Tailwind가 아니라 인라인이다 — JSX 밖에서 만드는 요소라 클래스 스캔에 기대지 않는다.
  wrapper.style.width = "100%";
  wrapper.style.height = "100%";

  // **한글은 xterm이 혼자 못 받는다.** WKWebView가 조합 이벤트 대신 `insertReplacementText`로
  // 완성 음절을 주는데 xterm의 입력 경로가 그 종류를 안 본다 — 낱자만 새고 음절은 버려진다.
  // 왜 그런지와 무엇으로 갈랐는지는 `terminal-ime.ts` 머리말에 있다.
  //
  // **`term.input`으로 되돌린다.** 아래 `onData`가 유일한 출구로 남아야 `pty_write`가 한 곳에서
  // 나가고, xterm이 스스로 보내는 것과 순서도 안 뒤집힌다(다리가 capture로 먼저 돌기 때문).
  //
  // 여기서 거는 이유는 `onTitleChange`와 같다 — 이펙트에 두면 배경 칸이 못 받는다.
  // 얼굴을 **그때그때 묻는다** — 스냅숏을 넘기면 설정으로 글꼴이나 테마를 바꿨을 때 조합
  // 표시만 옛 얼굴로 남는다. `term.options`가 이 칸의 정본이고 `restyleShells`가 그것을 고친다.
  // 색은 뒤집어 준다: 터미널 글자색이 표시의 바탕이 된다.
  //
  // **다리가 보내는 순간이 사람 입력이다**(프로세스 스펙 S16) — WKWebView는 한글에 조합 사건을 안 준다.
  // 인스턴스는 아래에서 서므로 부를 때 읽는다(다리는 사람이 칠 때만 부른다).
  attachIme(wrapper, (data) => {
    noteInput(instance, { kind: "ime", data });
    term.input(data, true);
  }, () => {
    const theme = term.options.theme ?? {};
    return {
      family: term.options.fontFamily ?? look.fontFamily,
      size: term.options.fontSize ?? look.fontSize,
      background: theme.foreground ?? "#000000",
      foreground: theme.background ?? "#ffffff",
    };
  });

  const instance: ShellInstance = {
    id,
    term,
    fit,
    wrapper,
    observer: new ResizeObserver(() => refit(instance)),
    webgl: null,
    ptyId: null,
    origin,
    fontsReady: false,
    opened: false,
    broken: false,
    closed: false,
  };

  // **인스턴스를 만들 때 붙인다 — 이펙트가 아니다.** 이펙트에 붙이면 배경 칸(결정 21로
  // React 트리 밖에 사는 칸)의 이름이 갱신되지 않는다: 그 칸에는 도는 이펙트가 없다.
  term.onTitleChange((title) => {
    terminalStore.setState((state) => setTitle(state, id, title));
  });

  // **훅 없는 셸의 보너스 길 셋**(#208 · 결정 11의 P). 붙이는 자리가 바로 위와 같고 이유도
  // 같다 — 배경 칸이 부르는 것도 띠와 알림이 받아야 한다. 사람이 다른 work을 보는 동안
  // 뒤에서 도는 셸이 정확히 이 길로 말을 건다.
  //
  // **9와 777이 같은 함수를 탄다.** 스펙이 둘을 한 줄로 묶었고(「그 밖의 OSC 9·777은 전부
  // `done`」), 갈라 두면 같은 판정이 두 벌이 된다.
  //
  // **`true`를 돌려주는 것은 「우리가 처리했다」다.** 이 xterm 버전에는 9·777의 기본 핸들러가
  // 없어(`lib/xterm.js`의 `registerOscHandler` 등록 목록에 0·1·2·4·8·10~12·104·110~112뿐)
  // 밀려날 곳도 없지만, `false`를 돌려주면 파서가 그 시퀀스를 「처리 못 함」으로 흘린다.
  const osc = (body: string): boolean => {
    applyBonusSignal(id, oscSignal(body), "osc");
    return true;
  };
  term.parser.registerOscHandler(9, osc);
  term.parser.registerOscHandler(777, osc);

  // **포커스 보고(DEC 1004)는 여기서 켤 것이 없다.** xterm이 스스로 진다 — `?1004h`를 받으면
  // `decPrivateModes.sendFocus`를 세우고, 그 뒤 포커스/블러마다 `ESC [I`·`ESC [O`를
  // `triggerDataEvent`로 흘린다(`lib/xterm.js` 확인). 그 데이터는 위 `onData` 하나를 지나
  // 그대로 PTY로 나가므로, Codex의 `notification_condition = unfocused`가 딛는 신호가
  // 이 앱에서도 셸까지 닿는다. **아직 실물로는 못 봤다** — 남은 물음은 macOS 창이 뒤로 갈 때
  // WKWebView가 xterm의 숨은 입력칸에 실제로 블러를 주는가이고, 그것은 사람이 봐야 안다.
  // 무엇을 어떤 순서로 눌러 보고 결과를 어디에 적는지는 이 work의 `spec/OSC-벨-실물-확인.md`
  // 3절에 있다(선례: 티켓 04의 `spec/훅-실물-확인.md`).

  // **벨의 「모르는 명령」 판정은 울린 그 순간의 값으로 한다**(구현 결정 1). 1초 폴링이라
  // 경계에서 어긋날 수 있고, 어긋나면 초록이 하나 더 뜨는 쪽으로 틀린다 — 스펙이 택한 방향이다.
  // 죽은 칸을 가리는 것은 `runningOfId`가 딛는 `runningOn` 하나다.
  term.onBell(() => {
    applyBonusSignal(id, bellSignal(runningOfId(terminalStore.state, id)), "bell");
  });

  // PTY resize는 `cols`/`rows`가 **실제로 바뀔 때만** 나가야 한다(⌘B의 220ms 폭 트랜지션이
  // 프레임마다 관측을 일으킨다). 그 판정을 우리가 다시 하지 않는다 — xterm의 `resize`가
  // `e!==this.cols||t!==this.rows`일 때만 `onResize`를 때린다(lib/xterm.js 확인).
  term.onResize(({ cols, rows }) => {
    if (instance.ptyId !== null) ignoreGone(terminalApi.resize(instance.ptyId, cols, rows));
  });
  term.onData((data) => {
    // **xterm이 내보내는 데이터는 사람 입력이 아니다**(프로세스 스펙 S16) — 사람이 친 키의 바이트도 여기로
    // 오지만 그것은 앞의 키다운이 이미 적었고, 데이터만 오는 것은 xterm의 응답(DA · CPR · 포커스 보고)이다.
    // 판정에 그대로 건네는 것은 셸로 가는 모든 길이 한 판정을 지나게 하려는 것이다 — 모양을 보는 갈래가
    // 판정에 생기면 p10k가 프롬프트마다 묻는 커서 위치가 모든 셸을 「입력을 받은」 셸로 만든다.
    noteInput(instance, { kind: "data", data });
    if (instance.ptyId !== null) ignoreGone(terminalApi.write(instance.ptyId, data));
  });
  // **붙여넣기는 사람 입력이다**(프로세스 스펙 S16). xterm은 입력칸과 화면 두 자리에서 `paste`를 받는데
  // 둘 다 이 집 안이라, 집의 capture 단계에서 한 번에 본다(IME 다리와 같은 자리).
  wrapper.addEventListener("paste", () => noteInput(instance, { kind: "paste" }), true);

  // ⌘T는 새 칸, ⌘W는 이 칸 닫기. 여기 붙이는 것은 `onTitleChange`와 같은 이유다:
  // 이펙트에 두면 배경 칸이 못 받는다.
  //
  // `false`를 돌려주면 xterm이 그 키를 처리하지 않는다. 어느 키가 앱 몫인지와 그 근거는
  // `shellHotkey`가 혼자 안다(결정 29의 예외 둘).
  //
  // **여기서 가르는 것이 둘이다.** 앱이 가져가는 키(위 둘)와, 셸에 가되 **바이트가 갈리는**
  // 키(⇧Enter — 결정 91). 판정도 그래서 둘이고, 아래 두 분기가 각각을 탄다.
  //
  // **새 칸의 자리를 여기서 정하지 않는다**(UI개선 결정 19). 이 칸의 화면에 요청만 보내고, 화면이
  // 창 단축키와 같은 기본 자리 함수로 연다 — 셸 안과 밖의 ⌘T가 언제나 같은 자리다
  // (`requestNewShell` 머리말). 상한에 닿으면 화면이 부른 `openNewShell`이 열지 않고
  // 거절을 알리고, 듣는 화면이 그것을 말한다(결정 47).
  //
  // 닫는 것은 `×`와 **같은 길**이다 — 마지막 칸을 닫아도 새 셸이 저절로 뜨지 않는 것까지
  // 그대로 따라온다(판 02).
  //
  // **키다운을 가르는 자리는 여기 하나다**(프로세스 스펙 S16). 한 번 가른 답(`keyRoute`)으로 셋을 고른다 —
  // 앱이 가져갈지, 바꿔 보낼지, 사람 입력으로 적을지. 뒤 판의 중단 추론(Esc · Ctrl-C)과 승인 추론(확정 키)도
  // 이 답을 이 자리에서 더 읽는다.
  term.attachCustomKeyEventHandler((event) => {
    const route = keyRoute(event);
    // keypress · keyup — xterm이 평소대로 한다.
    if (route === null) return true;
    noteInput(instance, { kind: "keydown", event });
    // **앱 몫이되 이 셸이 하지 않는다**(결정 99). 본문을 옮기는 키(⌘1~9·⌃Tab)가 그것이라,
    // `false`로 xterm의 타이핑만 막고 **그대로 위로 흘려보낸다** — 어느 본문으로 갈지는
    // 화면이 알고, 그 화면이 window에서 이 키를 듣는다. 여기서 `stopPropagation`을 부르면
    // 셸에 포커스가 있는 동안 그 키가 영영 안 먹는다.
    if (route.to === "app" && route.hotkey === "app") return false;
    if (route.to === "app" && route.hotkey !== null) {
      event.preventDefault();
      // **`stopPropagation`이 함께 있어야 한다**(결정 93). ⌘T를 window에서도 듣게 되면서
      // (셸이 0개인 화면 때문이다) 이 키를 듣는 자리가 둘이 됐다 — `preventDefault`만으로는
      // window 리스너가 안 막혀 한 번 눌러 셸이 둘 열린다.
      event.stopPropagation();
      if (route.hotkey === "new") requestNewShell(instance.origin.owner);
      // 확인을 거치는 길로 간다(결정 92) — `×`와 **같은 함수**다.
      else void requestCloseShell(instance.id);
      return false;
    }

    // ⇧Enter는 셸에 가되 **다른 바이트로** 간다(결정 91). 앱이 가져가는 것이 아니라
    // 바꿔 보내는 것이라 위 분기와 따로 선다. `false`를 돌려주는 것은 xterm이 같은 키로
    // `\r`을 한 번 더 보내지 않게 하려는 것이다.
    //
    // **`term.input`으로 보낸다 — `terminalApi.write`를 직접 부르지 않는다.** 위 IME 다리가
    // 같은 이유로 같은 길을 쓴다(80줄 위 주석): `onData`가 유일한 출구로 남아야 `pty_write`가
    // 한 곳에서 나가고 xterm이 스스로 보내는 것과 순서도 안 뒤집힌다. 한글 조합 중의 ⇧Enter가
    // 정확히 그 순서가 걸리는 자리라 여기에 예외를 둘 이유가 없다.
    if (route.to === "shell" && route.rewrite !== null) {
      event.preventDefault();
      term.input(route.rewrite, true);
      return false;
    }
    // 나머지는 xterm이 평소대로 한다 — 앱 몫이지만 가져가지 않는 ⌘ 화음(⌘B · ⌘C)도 막지 않는다.
    return true;
  });

  return instance;
}

/**
 * 지금 쓸 얼굴을 **이름으로 청구하고 기다린다.** 부르는 곳이 둘이다 — 셸을 처음 열기 전과,
 * 설정이 바뀌어 얼굴이 갈릴 때(`restyleShells`).
 *
 * **얼굴을 인자로 받는다 — 여기서 다시 읽지 않는다.** `restyleShells`는 이 `await` 뒤에
 * 옵션을 먹이는데, 그 사이 설정이 또 바뀌면 스스로 읽는 판에서는 **청구한 얼굴과 먹인
 * 얼굴이 갈린다** — 안 뜬 글꼴로 셀을 재는 바로 그 함정으로 되돌아간다. 값을 넘겨받으면
 * 그 어긋남이 구조적으로 없다.
 *
 * 폰트가 뜨기 전에 셀을 재면 폴백 글꼴 폭으로 굳어 TUI 박스 선이 어긋난다.
 * **xterm은 폰트 로딩을 스스로 듣지 않는다** — `lib/xterm.js`에 `fonts`가 0건이고
 * `open()` 시점에 한 번 재고 끝이다.
 *
 * `ready`만으로는 부족하다: 그것은 **이미 걸려 있는** 로딩만 기다리는데, 이 화면 전까지 앱이
 * 그 얼굴을 한 글자도 안 썼으면 로딩이 애초에 안 걸려 있다. 고른 글꼴이 시스템 글꼴이면
 * (`Menlo`) `document.fonts`에 없어 곧바로 돌아온다 — 기다릴 것이 없다는 뜻이라 맞다.
 */
async function claimFont(look: TerminalLook): Promise<void> {
  try {
    await document.fonts.load(`${look.fontSize}px "${look.monoFace}"`);
    await document.fonts.ready;
  } catch (error) {
    // **글꼴을 못 얻는 것은 셸의 실패가 아니다** — 폴백 글꼴로 흐를 뿐이다. 결정 23이 적으라는
    // 이유는 "셸을 못 띄운" 이유지 글꼴 얘기가 아니다.
    console.warn("atelier: 모노 글꼴을 못 얻었다 — 폴백으로 간다", error);
  }
}

/**
 * 글꼴이 오면 **셸을 띄운다 — 화면에 붙어 있든 아니든.** 사람이 연 셸은 뒤에서도 돈다
 * (결정 20·21). 프로세스 결정 7이 입력 없는 자동 셸만 예외로 두었다 — 그 셸은 글꼴이 오기 전에
 * 화면을 떠나면 뜨지도 않고 닫힌다(`closeUnusedShells`).
 *
 * _한때 여는 것과 띄우는 것이 한 게이트였다_: 글꼴이 온 순간 칸이 DOM에 붙어 있을 때만 열고,
 * 처음 열 때만 spawn했다. 글꼴(0.94MB)이 오는 사이에 `+`·⌘T로 둘째 칸을 켜거나 다른 work·
 * `/terminal`로 옮기면 첫 칸이 떼어진 채 글꼴이 도착해 그냥 돌아갔고, 그 뒤로 spawn을 부를
 * 자리는 그 칸이 다시 붙는 길 하나뿐이었다 — 안 본 칸은 `셸`인 채 시작도 안 했다. 픽스처에서는
 * spawn 순서가 칸 순서와 갈려 pty 번호까지 뒤섞였다.
 *
 * **순서가 계약이다: 열고 나서 띄운다.** 붙어 있는 칸은 먼저 열고 맞춰야 제 격자로 뜬다 —
 * 거꾸로 하면 보이는 셸까지 xterm 기본 격자(80×24)로 떴다가 곧바로 SIGWINCH를 받는다.
 * 떼어진 채 뜬 칸만 기본 격자로 뜨고, 처음 붙을 때 `fit()`이 격자를 바꾸면 `onResize`가 PTY로
 * 알린다(응답이 그보다 늦으면 `spawn`의 응답 뒤 맞춤이 받는다). 형제 칸의 격자를 빌려 뜨는 안은
 * 안 한다 — 이 틈이 서는 것은 사실상 글꼴이 처음 오는 콜드 스타트뿐이고, 그때는 빌릴 격자를
 * 가진 칸이 아직 없다(같은 글꼴을 기다린 형제도 이 칸 **뒤에** 열린다).
 *
 * 떼어진 채 뜬 셸의 출력은 아직 안 연 xterm에 그대로 쓴다 — xterm은 `open()` 전에도 받아
 * 파싱하고 버퍼에 들고 있다가, 붙는 순간 그린다(타이틀·OSC·벨 핸들러도 그때 이미 돈다).
 */
async function loadFont(instance: ShellInstance) {
  // 위에서 삼킨 실패가 여기까지 와야 한다. 던져 올리면 `fontsReady`가 false로 굳어 이
  // 인스턴스는 영영 안 열리고 셸도 안 뜬다.
  await claimFont(terminalLook(terminalSettingsStore.state));
  instance.fontsReady = true;
  openOrReattach(instance, "fontLate");
  // **스스로 거른다** — 글꼴을 기다리는 사이 `×`·아카이빙으로 거둔 칸(`closed`)과, 바로 위에서
  // 열다 터진 칸(`broken`)은 띄우지 않는다.
  //
  // **셸마다 한 번 뜨는 것은 부르는 자리가 지킨다 — 플래그가 아니다.** `spawn`을 부르는 곳은 이
  // 줄 하나이고, 이 함수는 `openShellQuietly`가 인스턴스를 세울 때 한 번 부른다. 다시 붙는 길
  // (`openOrReattach`)은 열기만 한다. 부르는 자리를 하나 더 만들면 그때 셸이 둘 뜬다.
  if (instance.closed || instance.broken) return;
  void spawn(instance);
}

/**
 * 설정이 바뀌면 **이미 떠 있는 셸도 따라간다**(결정 52). 재생성은 없다 — xterm은
 * `options.fontFamily`/`fontSize`/`theme`을 런타임에 받아 다시 그린다.
 *
 * 구독을 모듈 최상위에 건다. 이펙트에 두면 배경 칸(결정 21로 React 트리 밖에 사는 칸)이
 * 못 받는다 — `onTitleChange`를 인스턴스에 붙이는 것과 같은 이유다.
 */
terminalSettingsStore.subscribe(() => void restyleShells());

async function restyleShells(): Promise<void> {
  // **글꼴을 먼저 기다린다.** 옵션을 먼저 바꾸면 xterm이 그 자리에서 셀을 다시 재는데
  // (`charSizeService`가 `fontFamily`·`fontSize` 변화를 듣는다 — lib/xterm.js 확인) 새 얼굴이
  // 아직 안 떠 있으면 폴백 폭으로 굳는다. `loadFont`가 처음 열 때 막는 그 함정이 여기도 있다.
  const look = terminalLook(terminalSettingsStore.state);
  await claimFont(look);
  const theme = terminalThemeFor(look.theme);
  for (const instance of instances.values()) {
    // 거둔 인스턴스에 쓰면 던진다. **아직 안 연 칸에는 그대로 먹인다** — 그 칸은 지금 폰트를
    // 기다리는 중이고(fontsReady 게이트), 열릴 때 이 값으로 열려야 한다. 옵션 변화를 듣는
    // 서비스들은 `open()`이 만들므로 안 연 칸에서는 값만 적히고 아무것도 안 돈다.
    if (instance.closed) continue;
    instance.term.options.fontFamily = look.fontFamily;
    instance.term.options.fontSize = look.fontSize;
    instance.term.options.theme = theme;
    // **크기를 바꾸면 격자가 바뀐다**(결정 52). `fit()`이 새 cols/rows를 정하고, 값이 실제로
    // 달라졌을 때만 `onResize`가 PTY로 나간다 — 그 판정은 위 `onResize` 주석대로 xterm이 한다.
    // 안 연 칸에서는 `fit()`이 스스로 돌아간다(element가 아직 없다).
    refit(instance);
  }
}

/**
 * 열 수 있으면 열고, 이미 열려 있으면 다시 붙는다. **문 둘이 함께 열려야 한다** — 폰트가
 * 준비됐고 집이 DOM에 붙어 있어야 한다. 그래서 이 함수는 그 둘이 각각 갖춰질 때마다
 * 불리고 아직 아니면 그냥 돌아간다.
 *
 * 순서가 아니라 게이트인 이유: 폰트를 기다리는 동안 사용자가 다른 nav로 떠나면 집이
 * 떨어진다. 그 상태로 `open()`하면 xterm이 크기를 0으로 재고 그 값이 굳는다.
 *
 * **이 게이트는 화면만 막는다 — 셸은 안 막는다.** PTY를 띄우는 것은 글꼴이 온 순간의
 * `loadFont`이고 여기서는 부르지 않는다. 한때 여기가 「처음 열 때 spawn」이라 떼어진 칸의
 * 셸이 사람이 그 칸을 다시 볼 때까지 시작도 안 했다(`loadFont` 머리말).
 *
 * `kind`는 누가 불렀나다 — 셸이 붙었다(`attachShell`)와 글꼴이 늦게 와 이제 연다(`loadFont`). 붙는 순간 포커스를
 * 줄지가 이것으로 갈린다(아래 포커스 줄).
 */
function openOrReattach(instance: ShellInstance, kind: AttachKind) {
  if (instance.closed || instance.broken || !instance.wrapper.isConnected) return;
  if (!instance.fontsReady) {
    // **붙었는데 글꼴이 아직이다**(여기 오는 것은 `attach`뿐이다 — 글꼴 길은 문을 먼저 연다). 지금 열렸으면 포커스를
    // 받았을 자리면 그 붙음을 기다리는 포커스로 남긴다(`deferAttach`). 글꼴 길은 기다리는 것이 이 셸일 때만 주므로,
    // 안 남기면 콜드 스타트의 첫 셸은 포커스를 영영 못 받는다 — 첫 셸은 늘 글꼴보다 먼저 붙는다.
    pendingFocus = deferAttach(instance.id, pendingFocus, focusPlaceNow());
    return;
  }

  if (!instance.opened) {
    try {
      instance.term.open(instance.wrapper);
      // **막대도 앱의 것 하나로 통일한다**(결정 32). xterm의 막대는 꺼 둔 채다(결정 26 —
      // 켜면 `FitAddon`이 폭에서 14px을 뺀다). `xterm-viewport`는 진짜로 구르는 상자라
      // (`overflow-y: scroll`) 문서 하나가 받는 그 리스너에 이 클래스만으로 걸린다.
      instance.wrapper.querySelector(".xterm-viewport")?.classList.add("scroll-quiet");
      // **`open()`이 돌아온 뒤에 세운다.** 앞에 세우면 여기서 터졌을 때 열리지도 않은 채
      // "열렸다"로 굳어, 다음 마운트부터는 관측도 없는 죽은 화면이 된다.
      instance.opened = true;
      instance.observer.observe(instance.wrapper);
    } catch (error) {
      failOpen(instance, error);
      return;
    }
  }

  // **포커스 줄 — 조건이 있다**(티켓 16 · 프로세스 스펙 S21). 돌아온 사용자는 이어 치려고 온 것이다: 포커스가 없으면
  // 커서가 빈 테두리로 그려져 "치다 만 자리"가 남았는지도 눈에 안 띈다. 그런데 한때 이 줄에 조건이 없어서, 요청하지
  // 않은 셸이 늦게 열리면서 — 글꼴이 늦게 와 열 때도, 사람이 팔레트나 이름 바꾸기 칸에 가 있어도 — 포커스를 빼앗았다.
  // 줄지 말지는 `focusOnAttach`가 혼자 정한다. 여기는 그 답대로 xterm을 부른다.
  //
  // **판정을 먼저 하고 기다리는 포커스를 소비한 뒤 연다.** 아래가 터져도 그 셸의 붙음은 지나갔다 — 남기면 다른 셸이
  // 붙을 때마다 「다른 셸을 기다린다」로 막힌다.
  const give = focusOnAttach({ kind, id: instance.id }, pendingFocus, focusPlaceNow());
  pendingFocus = nextPendingFocus(pendingFocus, { kind: "attached", id: instance.id });

  // **다시 붙는 길에서 터지는 것은 셸의 실패가 아니다.** 이 자리에서 `fail()`을 부르면
  // 이미 적힌 종료 코드(결정 22)를 "띄우지 못했다"로 덮어써, 이 터미널의 핵심 용도인
  // "claude가 조용히 죽었을 때 이유를 읽는 것"이 사라진다. 화면 문제는 화면 문제로 남긴다.
  try {
    holdWebgl(instance);
    refit(instance);
    if (give) instance.term.focus();
  } catch (error) {
    console.warn("atelier: 터미널을 다시 붙이는 중 문제가 났다", error);
  }
}

/**
 * 처음 여는 `open()`이 터졌다 — **이 칸은 셸을 보여 줄 수 없다.** 이유를 칸에 적고(결정 23),
 * 이미 떠 있는 PTY가 있으면 거둔다.
 *
 * 떼어진 채 먼저 뜬 셸(`loadFont`)이 여기 온다: 한때는 열기가 spawn 앞이라 이 자리에 PTY가
 * 있을 수 없었다. 거두지 않으면 볼 길도 입력할 길도 없는 셸이 ⌘Q까지 돌고, 「띄우지 못했다」는
 * 적혔는데 프로세스는 살아 있는 거짓 그림이 된다. 응답이 아직이면 `spawn`이 `broken`을 보고
 * 응답 자리에서 거둔다. 다시 열어 보지 않는 것(`openOrReattach`의 게이트)도 같은 이유다 —
 * 반쯤 연 xterm에 두 번째 `open()`이 무엇을 할지 모른다.
 *
 * 다시 붙는 길에서 터지는 것은 여기 오지 않는다(`openOrReattach`의 아래 `try`) — 그쪽은
 * 이미 적힌 종료 코드를 덮어쓰면 안 되는 화면 문제다.
 *
 * **처음 여는 길에도 먼저 적힌 이유가 있을 수 있다.** 떼어진 채 뜬 셸은 사람이 그 칸을 보기 전에
 * 끝나거나(종료 코드 — 결정 22) 못 뜰(거절 이유 — 결정 23) 수 있다. 그때는 적지 않는다 — 사람이
 * 읽어야 하는 것은 셸의 이유고, 열기 실패로 덮으면 「claude가 조용히 죽은 이유」가 사라진다.
 * 칸은 그래도 `broken`이다: 반쯤 연 xterm에 다시 `open()`하지 않는다.
 */
function failOpen(instance: ShellInstance, error: unknown) {
  instance.broken = true;
  // 이 칸은 다시 안 열린다 — 닫힌 셸처럼 그 셸을 기다리던 포커스를 버린다. 남기면 다른 셸이 붙을 때마다 막힌다.
  pendingFocus = nextPendingFocus(pendingFocus, { kind: "closed", id: instance.id });
  const shell = terminalStore.state.shells.find((candidate) => candidate.id === instance.id);
  if (shell?.status.kind === "running") fail(instance, error);
  if (instance.ptyId !== null) {
    killPty(instance, instance.ptyId, "openFailed");
    instance.ptyId = null;
  }
}

/**
 * 어느 셸이 WebGL을 쥐나(티켓 17 · 프로세스 결정 18 ③). 누구를 놓고 누구에게 싣는지, 잃으면 무엇을 하는지는
 * `shell-webgl`이 혼자 안다. 여기는 그 답을 들고 있기만 한다 — `pendingFocus`처럼 모듈 값이고 화면이 그리지 않는다.
 */
let webglSeats: WebglSeats = NO_WEBGL_SEATS;

/**
 * 붙는 셸에 WebGL을 싣는 자리 — 셸을 열거나 다시 붙이는 함수가 포커스 줄 바로 위에서 부른다(처음 붙음 · 떼었다 다시
 * 붙음 · 글꼴이 늦게 와 엶). 컨텍스트를 잃은 보이는 셸을 다시 싣는 것도 이 길이다.
 *
 * _한때 셸마다 한 번 실으면 놓지 않았다._ 셸이 WebKit 한도(열여섯)를 넘으면 붙일 때마다 숨은 셸 하나가 밀려났고, 밀려난
 * 셸로 3초 안에 돌아가면 `instance.webgl`이 아직 남아 있어 다시 싣지 않고 잃은 캔버스에 그렸다 — xterm은 잃은 뒤
 * 복구를 3초 기다리고서야 `onContextLoss`를 쏜다. 그 3초 동안 셸 화면이 비었다.
 */
function holdWebgl(instance: ShellInstance): void {
  const plan = attachWebgl(webglSeats, instance.id);
  webglSeats = plan.seats;
  if (plan.kind === "dom") return;
  if (plan.kind === "hold") {
    // **이미 쥔 셸은 한 번 그린다.** 숨었다 돌아온 셸은 그사이 바뀐 것이 없으면 xterm이 다시 안 그린다. 그러면 WebKit이
    // 한도에서 잃힐 것을 고르는 순서(가장 오래 안 그림)가 우리가 놓는 순서(가장 오래 안 붙음)와 갈려, GC를 기다리는
    // 놓은 컨텍스트보다 쥔 셸이 먼저 잃힐 수 있다. 붙을 때마다 그리면 쥔 셸은 늘 놓은 것보다 나중에 그린 것이다.
    instance.term.refresh(0, instance.term.rows - 1);
    return;
  }
  // **먼저 놓고 싣는다.** 거꾸로 하면 싣는 순간 N+1개를 쥔다.
  for (const id of plan.release) {
    const holder = instances.get(id);
    if (holder) releaseWebgl(holder);
  }
  loadWebgl(instance);
}

/** 그 셸의 addon을 놓는다 — xterm이 DOM 렌더러로 돌아간다. 자리(`webglSeats`)는 부르는 쪽이 이미 고쳤다. */
function releaseWebgl(instance: ShellInstance): void {
  const webgl = instance.webgl;
  if (webgl === null) return;
  instance.webgl = null;
  webgl.dispose();
}

function loadWebgl(instance: ShellInstance): void {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => loseContext(instance, webgl));
    // `activate()`는 WebGL2를 못 얻으면 **동기로 던진다.** 안 잡으면 셸을 띄우기도 전에
    // 화면이 죽으므로 같은 자리(DOM 렌더러)로 떨어뜨린다.
    instance.term.loadAddon(webgl);
    instance.webgl = webgl;
  } catch (error) {
    // 쥐지 않았으니 자리에서 뺀다 — 남기면 쥐지도 않은 셸 때문에 다른 셸이 addon을 놓는다. 다음 붙음에 다시 싣는다.
    webglSeats = failWebgl(webglSeats, instance.id);
    console.warn("atelier: WebGL 렌더러를 붙이지 못했다 — DOM 렌더러로 간다", error);
  }
}

/**
 * 컨텍스트를 잃었다 — xterm이 복구를 3초 기다리다 포기했다(`onContextLoss`). 그 addon을 **놓는다 — 잃은 자리에서
 * 되살리지 않는다.** 놓으면 xterm이 DOM 렌더러로 떨어져 화면이 계속 보이고, 안 놓으면 검게 굳는다.
 *
 * 다시 싣는 것은 붙음과 같은 길(`holdWebgl`)이다(프로세스 스펙 S24). 보이는 셸은 **다음 프레임에** — 잃은 그 사건
 * 처리 안에서 새 컨텍스트를 만들지 않는다 — 셸마다 세 번까지 싣고, 넘으면 앱을 다시 켤 때까지 DOM에 머문다. 숨은
 * 셸은 예산을 안 쓰고 다시 붙을 때 싣는다.
 */
function loseContext(instance: ShellInstance, webgl: WebglAddon): void {
  // 이미 놓은 addon의 늦은 알림이다 — 그 셸은 그사이 새로 실었거나 닫혔다.
  if (instance.webgl !== webgl) return;
  releaseWebgl(instance);
  const lost = loseWebgl(webglSeats, instance.id, isAttached(instance));
  webglSeats = lost.seats;
  if (lost.next === "stayDom") {
    console.warn("atelier: 이 셸은 WebGL 컨텍스트를 거듭 잃어 앱을 다시 켤 때까지 DOM 렌더러로 그린다");
  }
  if (lost.next === "reload") {
    requestAnimationFrame(() => {
      if (isAttached(instance)) holdWebgl(instance);
    });
  }
}

function refit(instance: ShellInstance) {
  // 떼어 둔 동안에는 재지 않는다. **`clientWidth`로 보면 안 된다** — 그것은 패딩 박스라
  // 안이 0이어도 패딩이 남아 절대 0이 되지 않고, 떼어 둔 요소에서는 계산 값이 `auto`라
  // `parseFloat`이 `NaN`을 준다. `NaN === 0`은 거짓이라 그 가드는 아무것도 안 막는다.
  // `fit()`이 실제로 읽는 것과 같은 값을, **양수인지로** 본다.
  //
  // 이 판정을 놓치면 `fit()`이 음수 폭에서 최소 격자를 제안하고(`Math.max(2, …)`),
  // 그 2×1이 PTY로 나가 셸이 두 칸짜리로 다시 흐른다. 컨테이너가 펴져도 돌아오지 않는다.
  if (!instance.wrapper.isConnected) return;
  const box = getComputedStyle(instance.wrapper);
  if (!(parseFloat(box.width) > 0) || !(parseFloat(box.height) > 0)) return;
  instance.fit.fit();
}

async function spawn(instance: ShellInstance) {
  try {
    const channel = new Channel<PtyFrame>();
    channel.onmessage = (frame) => {
      // **죽인 뒤에도 한 번 더 온다** — SIGHUP을 받은 셸의 종료 프레임이다. dispose된
      // Terminal에 쓰면 던지고, 그 던짐은 채널 콜백 안이라 아무 데도 안 걸린다. 열다 터져
      // 거둔 칸(`failOpen`)도 같다 — 그 종료 프레임이 적어 둔 실패 이유를 덮으면 안 된다.
      if (instance.closed || instance.broken) return;
      // **떼어 둔 사이에도 그대로 받아 적는다.** 그것이 결정 20이다 — 다른 화면에 가 있는
      // 동안 흐른 줄이 돌아왔을 때 빠져 있으면 셸이 살아 있는 것이 아니다(프로세스 결정 7이 입력
      // 없는 자동 셸만 예외로 두었다 — 그 셸은 떠날 때 닫혀 받아 적을 것이 없다). 한 번도 안 연
      // 칸(떼어진 채 뜬 셸 — `loadFont`)도 같다: xterm은 `open()` 전에도 받아 버퍼에 든다.
      if (frame instanceof ArrayBuffer) {
        // **출력이 도착했다는 사실 하나를 알린다**(#208). OSC가 세운 기다림을 푸는 것이
        // 여기이고, 그 밖에는 아무것도 안 한다 — 「몇 초 조용했나」로 상태를 만드는 코드는
        // 이 판에 없다(결정 2·3).
        //
        // **쓰기 전에 알린다.** 이 프레임에 실려 온 OSC는 **이 프레임보다 새 사실**이라
        // 나중에 앉아야 한다: 순서가 바뀌면 승인 요청과 그 뒤 몇 글자가 한 프레임에 실려 온
        // 자리에서 방금 선 앰버가 그 자리에서 꺼진다. 훅 없는 codex에서 사람이 `y`로 승인한
        // 직후가 정확히 그 모양이라(다음 승인 요청이 첫 프레임에 실려 온다) 이 판이 존재하는
        // 이유가 통째로 사라진다.
        //
        // **`write()` 뒤에 두면 그 순서가 안 지켜진다** — 한때 「파싱한 뒤에 알린다」로 적혀
        // 있었고 근거가 뒤집혀 있었다. xterm의 `write()`는 평소 파싱을 다음 tick으로 미루지만
        // (`WriteBuffer._scheduleInnerWrite`), **바로 앞에 사람 입력이 있었으면 그 한 번은
        // 동기로 파싱한다**(`_didUserInput` 갈래). 그래서 뒤에 두면 평소에는 우연히 맞고 키를
        // 친 직후에만 뒤집혔다. 앞에 두면 두 갈래가 같은 순서를 탄다.
        noteOutput(instance.id);
        instance.term.write(new Uint8Array(frame));
        return;
      }
      instance.ptyId = null;
      terminalStore.setState((state) => markExited(state, instance.id, frame));
      // **결정 48의 나머지 반쪽이 여기다.** 정상 종료한 칸은 목록에서 스스로 빠지는데,
      // 빠지면 그 칸은 다시 그려지지 않아 `×`가 영영 안 생긴다 — 즉 `closeShell`이 그 id로
      // 불릴 길이 그 순간 사라진다. 여기서 안 거두면 인스턴스가 WebGL 컨텍스트와 스크롤백
      // 10,000줄을 쥔 채 리로드까지 살고, `atCap`은 목록을 세므로 **새는 것을 못 본다.**
      // (상한이 화면마다가 된 뒤에도 같다 — 결정 23이 바꾼 것은 세는 범위뿐이다.)
      //
      // **조건을 여기 다시 적지 않는다.** `exitCode === 0 && signal === null`은
      // `markExited`가 아는 것이고, 우리는 그 결과에 "뺐느냐"만 묻는다. 두 곳에 적으면
      // 한쪽만 고쳐지는 날이 온다.
      if (!hasShell(instance.id)) {
        disposeInstance(instance, null);
      }
    };

    // `~` 축약 표기를 그대로 넘긴다 — 펴는 것은 `expand_home`을 가진 백엔드 한 곳이다
    // (결정 25). `null`이면 데이터 루트이고 그 자리가 어디인지도 백엔드만 안다.
    const cols = instance.term.cols;
    const rows = instance.term.rows;
    // **세계도 함께 나간다**(결정 10). cwd가 `null`인 최상위 셸은 백엔드가 그 세계의 홈에
    // 세우고, 셸 env의 `ATELIER_MODE`도 이 값이 정한다 — 안 실으면 백엔드가 인자를 거절해
    // 셸이 아예 안 뜨고(#187), 저쪽 세계의 값을 실으면 Maison 터미널이 Atelier 홈에서
    // 조용히 뜬다.
    // **owner를 파싱해서 뽑지 않는다** — origin이 `Mode`로 직접 든다(`ShellOrigin.mode`).
    const spawned = await terminalApi.spawn(
      instance.origin.mode,
      instance.origin.cwd,
      cols,
      rows,
      channel,
    );
    // **이 왕복 사이에 `×`가 눌렸을 수 있다.** 그때 `closeShell`은 `ptyId`가 아직 null이라
    // kill을 못 보냈고, 이 인스턴스는 `instances`에서도 목록에서도 이미 빠졌다. 그대로
    // 두면 그 셸은 상한에도 안 세이고 다시 닫을 길도 없이 ⌘Q의 회수까지 산다 —
    // "그 셸과 자식만 사라진다"가 이 창에서만 깨진다. 아래 채널 콜백은 같은 위험을
    // 이미 막고 있었는데 이 자리만 비어 있었다. 떼어진 채 먼저 뜬 칸이 이 왕복 사이에 처음
    // 붙다가 열기에 터진 경우(`broken`)도 같은 자리에서 거둔다 — `failOpen`이 그때는 죽일
    // pty 번호를 아직 몰랐다.
    if (instance.closed || instance.broken) {
      killPty(instance, spawned.id, "spawnRace");
      return;
    }
    instance.ptyId = spawned.id;
    // **응답 전에 사람이 쳤으면 여기서 알린다**(`tellFirstInput`) — 그때는 알릴 pty가 없었다.
    const typed = firstInputOfId(terminalStore.state, instance.id);
    if (typed !== null) tellFirstInput(instance, typed);
    // 타이틀을 안 쏘는 셸의 칸 이름이 된다(결정 31). `$SHELL`의 basename이라 프런트는 모른다.
    terminalStore.setState((state) => setShellName(state, instance.id, spawned.shellName));
    // 이 왕복 사이에 폭이 바뀌었으면 그 `resize`는 `ptyId`가 없어서 버려졌고, xterm은 값이
    // **바뀔 때만** `onResize`를 때리므로 스스로 다시 알려주지 않는다. 그대로 두면 셸이
    // 옛 격자에 영영 갇힌다 — 여기서 한 번 맞춘다. 떼어진 채 기본 격자로 나간 칸이 응답 전에
    // 처음 붙은 경우가 정확히 이 모양이다(`loadFont`).
    if (instance.term.cols !== cols || instance.term.rows !== rows) {
      ignoreGone(terminalApi.resize(spawned.id, instance.term.cols, instance.term.rows));
    }
  } catch (error) {
    fail(instance, error);
  }
}

// spawn 거부만이 아니라 시작 절차에서 터지는 무엇이든 그 셸의 칸에 적는다(결정 23).
// 이유가 없는 빈 화면이 남는 것이 제일 나쁘다 — 그러면 왜 안 뜨는지 아무 데도 안 남는다.
function fail(instance: ShellInstance, error: unknown) {
  terminalStore.setState((state) => markFailed(state, instance.id, String(error)));
}
