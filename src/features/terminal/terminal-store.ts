import { Store } from "@tanstack/react-store";
import { Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { terminalApi } from "./api";
import { markExited, markFailed, NO_SHELLS, openShell } from "./shell-registry";
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
}

const instances = new Map<number, ShellInstance>();

// 셸이 이미 죽은 뒤에 도착한 명령은 백엔드가 `Err`로 돌려준다. 리더 스레드가 레지스트리에서
// id를 지우는 것과 종료 프레임이 화면에 닿는 것 사이에 IPC 한 홉이 있어, 그 틈에 낀 입력이
// 실제로 그 자리에 온다. 이유는 종료 줄이 이미 말해 주므로 여기서는 흘린다 — `void`로만
// 두면 그것이 미처리 rejection이 되어 콘솔로 샌다.
const ignoreGone = (result: Promise<void>) => void result.catch(() => {});

/**
 * 화면이 뜰 때 부른다. 활성 셸이 없으면 하나 띄우고, 그 셸의 집을 `host`에 붙인 뒤
 * **`fit` → PTY `resize` 경로를 한 번 태운다** — 떼어 둔 사이에 ⌘B로 본문 폭이 바뀌었을 수 있다.
 *
 * 판 01의 터미널은 최상위 하나뿐이라 "활성 셸 하나"가 곧 전부다. 여럿과 `+`는 판 02가
 * 이 자리를 바꾼다 — 레지스트리는 이미 여럿을 안다.
 */
export function mountShell(host: HTMLElement): number {
  const instance = ensureInstance();
  host.appendChild(instance.wrapper);
  openOrReattach(instance);
  return instance.id;
}

/**
 * 화면이 사라질 때 부른다. **DOM에서 빼기만 한다** — `dispose`도 `kill`도 없다.
 * 그것이 이 티켓 전체다: 다른 nav를 한 번 본 대가로 셸이 죽지 않는다(결정 20).
 */
export function unmountShell(id: number): void {
  instances.get(id)?.wrapper.remove();
}

function ensureInstance(): ShellInstance {
  const active = terminalStore.state.activeId;
  const existing = active === null ? undefined : instances.get(active);
  if (existing) return existing;

  // StrictMode는 개발에서 마운트를 mount→unmount→mount로 돌리는데, 목록에 더하는 것과
  // 인스턴스를 만드는 것이 **여기서 한 틱에 함께 끝난다.** 그래서 두 번째 마운트는 위에서
  // 걸러지고 셸은 하나만 뜬다.
  const opened = openShell(terminalStore.state);
  terminalStore.setState(() => opened.state);
  const instance = createInstance(opened.id);
  instances.set(instance.id, instance);
  void loadFont(instance);
  return instance;
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
  };

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
  if (!instance.fontsReady || !instance.wrapper.isConnected) return;

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
    instance.ptyId = spawned.id;
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
