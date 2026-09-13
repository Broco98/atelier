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
import { countQuitShells } from "@/components/shell/quit-request";
import type { QuitCounts } from "@/components/shell/quit-request";
import { TERMINAL_LABEL } from "@/components/shell/nav-items";
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
  CLOSE_NOTICE,
  confirmClose,
  markExited,
  markFailed,
  NO_SHELLS,
  openShell,
  removeShell,
  runningOfId,
  setAttention,
  setRunning,
  setShellName,
  setTitle,
  shellHotkey,
  shellOpenNotice,
  shellRewrite,
  shellsOf,
  slugOfOwner,
} from "./shell-registry";
import type { OpenedShell, ShellOrigin, ShellOwner, ShellsState } from "./shell-registry";
import { terminalLook } from "./terminal-defaults";
import type { TerminalLook } from "./terminal-defaults";
import { attachIme } from "./terminal-ime";
import { terminalSettingsStore } from "./terminal-settings";
import { terminalThemeFor } from "./terminal-theme";
import type { PtyFrame } from "./types";
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
  // 컨텍스트를 잃어 dispose했으면 null이 된다. 다시 붙일 때 그러면 새로 만든다.
  webgl: WebglAddon | null;
  // PTY가 떠 있는 동안의 id. 종료 프레임이 오면 다시 null이다 — 죽은 셸에는 쓰지 않는다.
  // 레지스트리의 `id`와 다른 번호다(shell-registry.ts의 openShell 주석).
  ptyId: number | null;
  // 이 셸을 어디서 띄웠는가. cwd는 `~` 축약 표기 그대로 넘긴다 — 펴는 것은 백엔드다(결정 25).
  // `cwd`가 `null`이면 데이터 루트다(최상위 터미널).
  //
  // **cwd만이 아니라 origin 통째로 든다.** Ctrl+T가 「이 칸과 같은 자리에」 새 칸을 여는데,
  // 프로젝트가 여럿인 Work에서는 소유자만으로 자리가 안 정해진다(`workShellOrigin`이 null을
  // 준다). 지금 칸이 어느 프로젝트에서 떴는지는 그 칸만 안다.
  origin: ShellOrigin;
  fontsReady: boolean;
  opened: boolean;
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
 * 새로 짓는 안은 그 결정이 기각했다(한 판에 전역 신설 둘은 위험하다).
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
function openShellQuietly(origin: ShellOrigin): OpenedShell | null {
  // 여기만 상태를 **읽어서** 계산한다 — `openShell`이 새 상태와 함께 발급한 id를 돌려주고
  // 그 id로 인스턴스를 만들어야 해서다. 읽기와 쓰기 사이에 await가 없고 Store.setState가
  // 동기라 그 틈에 낄 갱신이 없다. 다른 setter들은 전부 updater 꼴이다.
  const opened = openShell(terminalStore.state, origin);
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
 * `workShellOrigin(mode, work, project)`. 그 함수가 `null`을 주면(프로젝트를 안 골랐다)
 * 여기까지 오지 않는다.
 */
export function openNewShell(origin: ShellOrigin): void {
  const opened = openShellQuietly(origin);
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
 */
export function ensureShell(origin: ShellOrigin): void {
  // **그 화면의 칸만 센다.** 전체를 세면 다른 Work에 셸이 있다는 이유로 이 화면이 빈 채로
  // 열린다 — 판 03에서 화면이 여럿이 되면서 갈린 자리다.
  if (shellsOf(terminalStore.state, origin.owner).length === 0) openShellQuietly(origin);
}

/** 칸을 고른다. */
export function selectShell(id: number): void {
  terminalStore.setState((state) => activateShell(state, id));
}

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
 * 인스턴스를 거둔다 — **이것이 유일한 정리 경로다.** 부르는 곳이 둘이다: `×`(`closeShell`)와
 * 정상 종료(결정 48로 목록에서 스스로 빠지는 칸). 흩어 놓으면 PTY만 죽고 인스턴스가
 * 남거나(WebGL 컨텍스트를 계속 쥔 채 상한만 갉아먹는다) 목록에서만 빠지고 셸이 살아남는다.
 *
 * **`kill`은 스스로 갈린다.** 정상 종료로 오면 PTY가 이미 죽었고 `ptyId`도 그 자리에서
 * null로 눕혀지므로 아래 가드가 그대로 건너뛴다 — 부르는 쪽이 플래그로 말할 것이 없다.
 */
function disposeInstance(instance: ShellInstance): void {
  instances.delete(instance.id);
  instance.closed = true;
  if (instance.ptyId !== null) ignoreGone(terminalApi.kill(instance.ptyId));
  instance.observer.disconnect();
  // Terminal이 자기가 만든 DOM과 애드온을 함께 거둔다 — `_addonManager`가 `_register`로
  // 묶여 있어 **WebGL 컨텍스트도 여기서 풀린다.** 상한 8이 컨텍스트 수를 말하는 이상
  // 이 한 줄이 상한을 되돌려주는 자리다.
  instance.term.dispose();
  instance.wrapper.remove();
}

/**
 * 셸을 거둔다. **셸을 죽이는 유일한 길이다**(결정 22). 화면을 옮기는 것으로는 여기 오지
 * 않는다(결정 20).
 *
 * 목록에서 빼는 길은 이제 **둘이다** — 결정 48이 정상 종료한 칸을 스스로 빼기 때문이다.
 * 그쪽은 아래 채널 콜백이 같은 정리를 태운다.
 *
 * **밖으로 내보내지 않는다**(결정 92). ⌘W와 `×`는 확인을 거치는 `requestCloseShell`만
 * 볼 수 있어야 한다 — 「두 길이 같은 판정을 쓴다」를 주석으로 부탁하는 대신, 확인을
 * 건너뛰는 이름이 아예 손에 안 잡히게 둔다. 아카이빙의 회수(`closeShellsOf`)만 여기를
 * 직접 부르는데, 그 길에는 사람이 이미 한 번 확인했다.
 */
function closeShell(id: number): void {
  const instance = instances.get(id);
  if (instance) disposeInstance(instance);
  terminalStore.setState((state) => removeShell(state, id));
}

/**
 * 사람이 셸을 닫으려 한다 — **⌘W와 `×`가 함께 여기로 온다**(결정 92). 셸 하나를 없애는
 * 길이 둘인데 한쪽만 막으면 같은 사고가 마우스로만 남는다.
 *
 * **닫기 직전에** 백엔드에 묻는다. 셸 상태에 얹어 두지 않는 것은 그 값이 매 순간 바뀌기
 * 때문이다 — 얹으면 폴링이 생기고, 필요한 순간은 닫을 때 한 번뿐이다.
 *
 * 무엇을 보고 묻는지도, 물은 답을 어떻게 읽는지도 `confirmClose`가 혼자 안다(끝난 칸·못 얻은
 * 판정까지). 여기서 한 번 더 가르지 않는다 — 여기 남는 것은 **확인 창을 건네는 일**뿐이고,
 * 그것이 저쪽을 순수하게 잴 수 있는 모양으로 만든다.
 */
export async function requestCloseShell(id: number): Promise<void> {
  const shell = terminalStore.state.shells.find((one) => one.id === id);
  // **앱의 창이다**(OS 시트가 아니다) — 창 하나만 남의 글꼴·남의 모서리로 뜨면 그것이
  // 앱 밖의 일처럼 읽힌다. 문구는 `CLOSE_NOTICE`가 든다(결정 105).
  const ask = () => askDialog({ title: "셸 닫기", body: CLOSE_NOTICE, confirm: "닫기", danger: true });
  if (!(await confirmClose(shell, await commandRunning(id), ask))) return;
  closeShell(id);
}

/**
 * 종료 확인이 적을 수(결정 15). **두 세계를 합친** 목록 전부를 센다 — 이 스토어는 세계마다 갈리지
 * 않고 한 벌이다(owner가 세계를 싣는다). 명령이 도는지는 셸 닫기 확인과 **같은 물음**으로 지금
 * 묻는다 — 1초 폴링 값(`running`)은 늦다. 세는 규칙은 `countQuitShells`가 혼자 안다.
 */
export function quitShellCounts(): Promise<QuitCounts> {
  return countQuitShells(terminalStore.state.shells, commandRunning);
}

/**
 * 백엔드에 「이 칸에서 명령이 도는가」를 묻는다. **못 얻으면 `null`이다** — 모르는 것을
 * 이유로 닫는 길을 막지 않는다(결정 92).
 *
 * `null`로 오는 길이 둘이다: PTY가 아직·이미 없는 칸(`ptyId`가 null — 못 뜬 칸과 스스로
 * 끝난 칸이 그렇다)과, 백엔드가 판정을 못 낸 경우(tcgetpgrp 실패, 이미 지워진 id).
 */
async function commandRunning(id: number): Promise<boolean | null> {
  const ptyId = instances.get(id)?.ptyId ?? null;
  if (ptyId === null) return null;
  try {
    return await terminalApi.commandRunning(ptyId);
  } catch {
    return null;
  }
}

/**
 * pty id로 그 칸의 **레지스트리 id**를 되찾는다. **둘은 다른 번호다** — 레지스트리는 자기
 * 번호를 스스로 발급하고(`openShell`의 주석: 못 뜬 칸에는 pty id라는 것이 아예 없다),
 * 백엔드는 그것을 모른다. 위 `commandRunning`이 반대 방향으로 가는 그 사이를 이쪽으로 잇는다.
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

// **구독은 이 하나다.** 설정은 스토어가 아니라 평범한 모듈 값이라(`notify-settings.ts`의
// 머리말 — 그 이유가 여기서 났다) 이 콜백이 읽어도 딸려 오는 의존이 없다.
terminalStore.subscribe(notifyTick);
// 설정이 바뀌면 배지가 그 자리에서 따라와야 한다 — 끈 순간 독에 수가 남아 있으면 「껐는데
// 아직 부른다」로 읽힌다.
onNotifySettingsChanged(notifyTick);

/**
 * 이 Work의 셸을 전부 거둔다 — 아카이빙·삭제가 **성공한 뒤에** 부른다(결정 26).
 *
 * 순서가 계약이다. 먼저 죽이면 dirty 거부에 걸렸을 때 **Work는 남고 돌던 claude만 사라진다.**
 * 고르는 것은 `shellsOf` 하나라 다른 Work의 셸과 최상위 터미널의 셸은 안 걸린다.
 */
export function closeShellsOf(owner: ShellOwner): void {
  for (const shell of shellsOf(terminalStore.state, owner)) closeShell(shell.id);
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
  openOrReattach(instance);
}

/**
 * 집을 DOM에서 뺀다. **`dispose`도 `kill`도 없다** — 다른 nav를 한 번 본 대가로, 또는 옆
 * 칸으로 갈아탄 대가로 셸이 죽지 않는다(결정 20·21).
 */
export function detachShell(id: number): void {
  instances.get(id)?.wrapper.remove();
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
  attachIme(wrapper, (data) => term.input(data, true), () => {
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
    if (instance.ptyId !== null) ignoreGone(terminalApi.write(instance.ptyId, data));
  });

  // ⌘T는 새 칸, ⌘W는 이 칸 닫기. 여기 붙이는 것은 `onTitleChange`와 같은 이유다:
  // 이펙트에 두면 배경 칸이 못 받는다.
  //
  // `false`를 돌려주면 xterm이 그 키를 처리하지 않는다. 어느 키가 앱 몫인지와 그 근거는
  // `shellHotkey`가 혼자 안다(결정 29의 예외 둘).
  //
  // **여기서 가르는 것이 둘이다.** 앱이 가져가는 키(위 둘)와, 셸에 가되 **바이트가 갈리는**
  // 키(⇧Enter — 결정 91). 판정도 그래서 둘이고, 아래 두 분기가 각각을 탄다.
  //
  // **새 칸은 자기 origin으로 연다.** 프로젝트를 다시 묻지 않는 이유는 답이 이미 있어서다 —
  // 이 칸이 뜬 자리가 곧 새 칸의 자리다. 상한에 닿으면 `openNewShell`이 열지 않고
  // 거절을 알리고, 듣는 화면이 그것을 말한다(결정 47).
  //
  // 닫는 것은 `×`와 **같은 길**이다 — 마지막 칸을 닫아도 새 셸이 저절로 뜨지 않는 것까지
  // 그대로 따라온다(판 02).
  term.attachCustomKeyEventHandler((event) => {
    const hotkey = shellHotkey(event);
    // **앱 몫이되 이 셸이 하지 않는다**(결정 99). 본문을 옮기는 키(⌘1~9·⌃Tab)가 그것이라,
    // `false`로 xterm의 타이핑만 막고 **그대로 위로 흘려보낸다** — 어느 본문으로 갈지는
    // 화면이 알고, 그 화면이 window에서 이 키를 듣는다. 여기서 `stopPropagation`을 부르면
    // 셸에 포커스가 있는 동안 그 키가 영영 안 먹는다.
    if (hotkey === "app") return false;
    if (hotkey) {
      event.preventDefault();
      // **`stopPropagation`이 함께 있어야 한다**(결정 93). ⌘T를 window에서도 듣게 되면서
      // (셸이 0개인 화면 때문이다) 이 키를 듣는 자리가 둘이 됐다 — `preventDefault`만으로는
      // window 리스너가 안 막혀 한 번 눌러 셸이 둘 열린다.
      event.stopPropagation();
      if (hotkey === "new") openNewShell(instance.origin);
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
    const rewrite = shellRewrite(event);
    if (rewrite !== null) {
      event.preventDefault();
      term.input(rewrite, true);
      return false;
    }
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

async function loadFont(instance: ShellInstance) {
  // 위에서 삼킨 실패가 여기까지 와야 한다. 던져 올리면 `fontsReady`가 false로 굳어 이
  // 인스턴스는 영영 안 열린다 — 다시 마운트해도 아래 게이트를 통과하지 못한다.
  await claimFont(terminalLook(terminalSettingsStore.state));
  instance.fontsReady = true;
  openOrReattach(instance);
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
 */
function openOrReattach(instance: ShellInstance) {
  if (instance.closed || !instance.fontsReady || !instance.wrapper.isConnected) return;

  const first = !instance.opened;
  if (first) {
    try {
      instance.term.open(instance.wrapper);
      // **막대도 앱의 것 하나로 통일한다**(결정 32). xterm의 막대는 꺼 둔 채다(결정 26 —
      // 켜면 `FitAddon`이 폭에서 14px을 뺀다). `xterm-viewport`는 진짜로 구르는 상자라
      // (`overflow-y: scroll`) 문서 하나가 받는 그 리스너에 이 클래스만으로 걸린다.
      instance.wrapper.querySelector(".xterm-viewport")?.classList.add("scroll-quiet");
      // **`open()`이 돌아온 뒤에 세운다.** 앞에 세우면 여기서 터졌을 때 열리지도 않은 채
      // "열렸다"로 굳어, 다음 마운트부터는 spawn도 관측도 없는 죽은 화면이 된다.
      instance.opened = true;
      instance.observer.observe(instance.wrapper);
    } catch (error) {
      fail(instance, error);
      return;
    }
  }

  // **다시 붙는 길에서 터지는 것은 셸의 실패가 아니다.** 이 자리에서 `fail()`을 부르면
  // 이미 적힌 종료 코드(결정 22)를 "띄우지 못했다"로 덮어써, 이 터미널의 핵심 용도인
  // "claude가 조용히 죽었을 때 이유를 읽는 것"이 사라진다. 화면 문제는 화면 문제로 남긴다.
  try {
    loadWebgl(instance);
    refit(instance);
    // 돌아온 사용자는 이어 치려고 온 것이다. 포커스가 없으면 커서가 빈 테두리로 그려져
    // "치다 만 자리"가 남았는지도 눈에 안 띈다.
    instance.term.focus();
  } catch (error) {
    console.warn("atelier: 터미널을 다시 붙이는 중 문제가 났다", error);
  }

  if (first) void spawn(instance);
}

function loadWebgl(instance: ShellInstance) {
  if (instance.webgl) return;

  const webgl = new WebglAddon();
  // 컨텍스트를 잃으면 그 애드온을 **dispose한다 — 잃은 자리에서 되살리지 않는다.**
  // dispose하면 xterm이 DOM 렌더러로 떨어져 화면이 계속 보이고, 안 하면 검게 굳는다.
  // 되살리는 자리는 여기다: DOM에서 뗐다 붙이는 동안 잃었으면 다시 붙을 때 새로 만든다.
  webgl.onContextLoss(() => {
    webgl.dispose();
    instance.webgl = null;
  });
  try {
    // `activate()`는 WebGL2를 못 얻으면 **동기로 던진다.** 안 잡으면 셸을 띄우기도 전에
    // 화면이 죽으므로 같은 자리(DOM 렌더러)로 떨어뜨린다.
    instance.term.loadAddon(webgl);
    instance.webgl = webgl;
  } catch (error) {
    console.warn("atelier: WebGL 렌더러를 붙이지 못했다 — DOM 렌더러로 간다", error);
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
      // Terminal에 쓰면 던지고, 그 던짐은 채널 콜백 안이라 아무 데도 안 걸린다.
      if (instance.closed) return;
      // **떼어 둔 사이에도 그대로 받아 적는다.** 그것이 결정 20이다 — 다른 화면에 가 있는
      // 동안 흐른 줄이 돌아왔을 때 빠져 있으면 셸이 살아 있는 것이 아니다.
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
      if (!terminalStore.state.shells.some((shell) => shell.id === instance.id)) {
        disposeInstance(instance);
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
    // 이미 막고 있었는데 이 자리만 비어 있었다.
    if (instance.closed) {
      ignoreGone(terminalApi.kill(spawned.id));
      return;
    }
    instance.ptyId = spawned.id;
    // 타이틀을 안 쏘는 셸의 칸 이름이 된다(결정 31). `$SHELL`의 basename이라 프런트는 모른다.
    terminalStore.setState((state) => setShellName(state, instance.id, spawned.shellName));
    // 이 왕복 사이에 폭이 바뀌었으면 그 `resize`는 `ptyId`가 없어서 버려졌고, xterm은 값이
    // **바뀔 때만** `onResize`를 때리므로 스스로 다시 알려주지 않는다. 그대로 두면 셸이
    // 옛 격자에 영영 갇힌다 — 여기서 한 번 맞춘다.
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
