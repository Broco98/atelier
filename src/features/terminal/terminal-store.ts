import { Store } from "@tanstack/react-store";
import { Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { terminalApi } from "./api";
import {
  activateShell,
  markExited,
  markFailed,
  NO_SHELLS,
  openShell,
  removeShell,
  setShellName,
  setTitle,
} from "./shell-registry";
import type { ShellsState } from "./shell-registry";
import { terminalTheme } from "./terminal-theme";
import type { PtyFrame } from "./types";
// `@xterm/*` import는 이 파일과 이것을 부르는 화면에만 둔다. `__root.tsx`는
// autoCodeSplitting이 떼어내지 않으므로(vite.config.ts 주석) 셸 쪽에 한 줄이라도 새면
// Node에서 routeTree.gen.ts를 import하는 router.test.ts가 함께 죽는다. 이 모듈은
// `/terminal`의 화면만 부르고, 그 화면은 분할되는 라우트 component라 안전하다.
import "@xterm/xterm/css/xterm.css";

// index.css의 `--font-mono`와 같은 목록이어야 한다 — 다르면 앱의 다른 모노 글자와 어긋난다.
// 그 일치는 주석이 아니라 `theme-tokens.test.ts`가 지킨다.
const FONT_FAMILY = "Geist Mono Variable, ui-monospace, SFMono-Regular, monospace";
// 첫 항목만 따로 든다 — 아래에서 이 얼굴을 이름으로 청구한다.
const MONO_FACE = "Geist Mono Variable";
// xterm의 기본값과 같은 값이지만 명시한다 — `document.fonts.load`에 같은 크기를 줘야 한다.
const FONT_SIZE = 15;

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
 * 셸을 하나 띄운다 — `+`가 이것이다. **상한에서는 아무 일도 안 한다**(결정 30).
 *
 * 목록에 더하는 것과 인스턴스를 만드는 것이 **한 틱에 함께 끝난다.** StrictMode가 마운트를
 * mount→unmount→mount로 돌려도 `ensureShell`의 "비었나" 판정이 그 사이에서 이미 참이 아니라
 * 셸은 하나만 뜬다.
 */
export function openNewShell(): void {
  // 여기만 상태를 **읽어서** 계산한다 — `openShell`이 새 상태와 함께 발급한 id를 돌려주고
  // 그 id로 인스턴스를 만들어야 해서다. 읽기와 쓰기 사이에 await가 없고 Store.setState가
  // 동기라 그 틈에 낄 갱신이 없다. 다른 setter들은 전부 updater 꼴이다.
  const opened = openShell(terminalStore.state);
  // `+`는 상한에서 이미 잠겨 있으므로 여기 닿는 것은 경주뿐이다. 조용히 돌아간다 —
  // 잠긴 이유는 그 버튼의 title이 말한다.
  if (!opened) return;

  terminalStore.setState(() => opened.state);
  const instance = createInstance(opened.id);
  instances.set(instance.id, instance);
  void loadFont(instance);
}

/**
 * 화면에 들어올 때 한 번. 칸이 하나도 없으면 하나 띄운다 — 판 01이 정한 규칙이고 여기서
 * 바꾸지 않는다.
 *
 * **마지막 칸을 `×`로 닫은 자리에서는 뜨지 않는다.** 그것이 이 함수가 화면 진입 이펙트에만
 * 붙어 있는 이유다 — 닫자마자 새 셸이 뜨면 `×`가 무의미해진다.
 */
export function ensureShell(): void {
  if (terminalStore.state.shells.length === 0) openNewShell();
}

/** 칸을 고른다. */
export function selectShell(id: number): void {
  terminalStore.setState((state) => activateShell(state, id));
}

/**
 * 셸을 거둔다 — `×`가 이것이다. **셸을 죽이는 유일한 길이고, 목록에서 빼는 유일한 길이다**
 * (결정 22). 화면을 옮기는 것으로는 여기 오지 않는다(결정 20).
 *
 * 넷을 **한자리에서** 한다. 흩어 놓으면 PTY만 죽고 인스턴스가 남거나(WebGL 컨텍스트를 계속
 * 쥔 채 상한만 갉아먹는다) 목록에서만 빠지고 셸이 살아남는다.
 */
export function closeShell(id: number): void {
  const instance = instances.get(id);
  if (instance) {
    instances.delete(id);
    instance.closed = true;
    if (instance.ptyId !== null) ignoreGone(terminalApi.kill(instance.ptyId));
    instance.observer.disconnect();
    // Terminal이 자기가 만든 DOM과 애드온을 함께 거둔다 — `_addonManager`가 `_register`로
    // 묶여 있어 **WebGL 컨텍스트도 여기서 풀린다.** 상한 8이 컨텍스트 수를 말하는 이상
    // 이 한 줄이 상한을 되돌려주는 자리다.
    instance.term.dispose();
    instance.wrapper.remove();
  }
  terminalStore.setState((state) => removeShell(state, id));
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

function createInstance(id: number): ShellInstance {
  const term = new Terminal({
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE,
    theme: terminalTheme,
    scrollback: 10000,
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

  const instance: ShellInstance = {
    id,
    term,
    fit,
    wrapper,
    observer: new ResizeObserver(() => refit(instance)),
    webgl: null,
    ptyId: null,
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

  return instance;
}

async function loadFont(instance: ShellInstance) {
  try {
    // 폰트가 뜨기 전에 셀을 재면 폴백 글꼴 폭으로 굳어 TUI 박스 선이 어긋난다.
    // **xterm은 폰트 로딩을 스스로 듣지 않는다** — `lib/xterm.js`에 `fonts`가 0건이고
    // `open()` 시점에 한 번 재고 끝이다.
    //
    // `ready`만으로는 부족하다: 그것은 **이미 걸려 있는** 로딩만 기다리는데, 이 화면
    // 전까지 앱이 모노 글꼴을 한 글자도 안 썼으면 로딩이 애초에 안 걸려 있다.
    await document.fonts.load(`${FONT_SIZE}px "${MONO_FACE}"`);
    await document.fonts.ready;
  } catch (error) {
    // **글꼴을 못 얻는 것은 셸의 실패가 아니다** — 폴백 글꼴로 흐를 뿐이다. 여기서 멈추면
    // 이 인스턴스는 영영 안 열린다: `fontsReady`가 false로 굳어 다시 마운트해도 아래 게이트를
    // 통과하지 못한다. 결정 23이 적으라는 이유는 "셸을 못 띄운" 이유지 글꼴 얘기가 아니다.
    console.warn("atelier: 모노 글꼴을 못 얻었다 — 폴백으로 간다", error);
  }
  instance.fontsReady = true;
  openOrReattach(instance);
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
    };

    // cwd를 비운다 — `~/.atelier`가 어디인지는 `ATELIER_HOME`을 보는 백엔드만 안다(결정 25)
    const cols = instance.term.cols;
    const rows = instance.term.rows;
    const spawned = await terminalApi.spawn(null, cols, rows, channel);
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
