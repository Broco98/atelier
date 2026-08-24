import { Store } from "@tanstack/react-store";
import { Channel } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { terminalApi } from "./api";
import {
  activateShell,
  CLOSE_NOTICE,
  confirmClose,
  markExited,
  markFailed,
  NO_SHELLS,
  openShell,
  removeShell,
  setShellName,
  setTitle,
  shellHotkey,
  shellOpenNotice,
  shellRewrite,
  shellsOf,
} from "./shell-registry";
import type { OpenedShell, ShellOrigin, ShellsState } from "./shell-registry";
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
 * `origin`이 어디서 오는가가 판 03이다 — 최상위 터미널은 `TOP_TERMINAL`, Work 화면은
 * `workShellOrigin(work, project)`. 그 함수가 `null`을 주면(프로젝트를 안 골랐다) 여기까지
 * 오지 않는다.
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
  const notice = shellOpenNotice(terminalStore.state, opened);
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
  const ask = () => confirm(CLOSE_NOTICE, { title: "셸 닫기", kind: "warning" });
  if (!(await confirmClose(shell, await commandRunning(id), ask))) return;
  closeShell(id);
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
 * 이 Work의 셸을 전부 거둔다 — 아카이빙·삭제가 **성공한 뒤에** 부른다(결정 26).
 *
 * 순서가 계약이다. 먼저 죽이면 dirty 거부에 걸렸을 때 **Work는 남고 돌던 claude만 사라진다.**
 * 고르는 것은 `shellsOf` 하나라 다른 Work의 셸과 최상위 터미널의 셸은 안 걸린다.
 */
export function closeShellsOf(owner: string): void {
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
        instance.term.write(new Uint8Array(frame));
        return;
      }
      instance.ptyId = null;
      terminalStore.setState((state) => markExited(state, instance.id, frame));
      // **결정 48의 나머지 반쪽이 여기다.** 정상 종료한 칸은 목록에서 스스로 빠지는데,
      // 빠지면 그 칸은 다시 그려지지 않아 `×`가 영영 안 생긴다 — 즉 `closeShell`이 그 id로
      // 불릴 길이 그 순간 사라진다. 여기서 안 거두면 인스턴스가 WebGL 컨텍스트와 스크롤백
      // 10,000줄을 쥔 채 리로드까지 살고, 상한 8은 컨텍스트 수를 말하는 값인데(결정 30)
      // `atCap`은 목록을 세므로 **새는 것을 못 본다.**
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
    const spawned = await terminalApi.spawn(instance.origin.cwd, cols, rows, channel);
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
