import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import PageHeader from "@/components/shell/PageHeader";
import { terminalApi } from "./api";
import { terminalTheme } from "./terminal-theme";
import type { PtyFrame } from "./types";
// `@xterm/*` import는 **이 파일에만** 둔다. `__root.tsx`는 autoCodeSplitting이 떼어내지
// 않으므로(vite.config.ts 주석) 셸 쪽에 한 줄이라도 새면 Node에서 routeTree.gen.ts를
// import하는 router.test.ts가 함께 죽는다. `/terminal`은 분할되는 라우트 component라 안전하다.
import "@xterm/xterm/css/xterm.css";

// index.css의 `--font-mono`와 같은 목록이어야 한다 — 다르면 앱의 다른 모노 글자와 어긋난다.
// 그 일치는 주석이 아니라 `theme-tokens.test.ts`가 지킨다.
const FONT_FAMILY = "Geist Mono Variable, ui-monospace, SFMono-Regular, monospace";
// 첫 항목만 따로 든다 — 아래에서 이 얼굴을 이름으로 청구한다.
const MONO_FACE = "Geist Mono Variable";
// xterm의 기본값과 같은 값이지만 명시한다 — `document.fonts.load`에 같은 크기를 줘야 한다.
const FONT_SIZE = 15;

// 셸이 이미 죽은 뒤에 도착한 명령은 백엔드가 `Err`로 돌려준다. 리더 스레드가 레지스트리에서
// id를 지우는 것과 종료 프레임이 화면에 닿는 것 사이에 IPC 한 홉이 있어, 그 틈에 낀 입력이나
// 언마운트가 실제로 그 자리에 온다. 이유는 종료 줄이 이미 말해 주므로 여기서는 흘린다 —
// `void`로만 두면 그것이 미처리 rejection이 되어 콘솔로 샌다.
const ignoreGone = (result: Promise<void>) => void result.catch(() => {});

function TerminalPage({ sidebarOpen }: { sidebarOpen: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 죽은 셸과 못 뜬 셸을 그 자리에 적는다(결정 22·23). 화면은 지우지 않는다 —
  // 마지막 xterm 내용 위에 이 한 줄만 붙는다. 탭 줄이 아니다(판 02).
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let alive = true;
    // 살아 있는 셸의 id. 종료 프레임이 오면 다시 null이 된다 — 죽은 셸에는 쓰지도 죽이지도 않는다.
    let id: number | null = null;
    let observer: ResizeObserver | null = null;

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

    // PTY resize는 `cols`/`rows`가 **실제로 바뀔 때만** 나가야 한다(⌘B의 220ms 폭 트랜지션이
    // 프레임마다 관측을 일으킨다). 그 판정을 우리가 다시 하지 않는다 — xterm의 `resize`가
    // `e!==this.cols||t!==this.rows`일 때만 `onResize`를 때린다(lib/xterm.js 확인).
    term.onResize(({ cols, rows }) => {
      if (id !== null) ignoreGone(terminalApi.resize(id, cols, rows));
    });
    term.onData((data) => {
      if (id !== null) ignoreGone(terminalApi.write(id, data));
    });

    const refit = () => {
      // 컨테이너가 아직 안 펴진 프레임에는 재지 않는다. **`clientWidth`로 보면 안 된다** —
      // 그것은 패딩 박스라 안이 0이어도 좌우 패딩(32px)이 남아 절대 0이 되지 않는다.
      // `fit()`이 실제로 읽는 값과 같은 것을 본다: 부모의 **계산된 content 폭·높이**다.
      // 이 판정을 놓치면 `fit()`이 음수 폭에서 최소 격자를 제안하고(`Math.max(2, …)`),
      // 그 2×1이 PTY로 나가 셸이 두 칸짜리로 다시 흐른다. 컨테이너가 펴져도 돌아오지 않는다.
      const box = getComputedStyle(host);
      if (parseFloat(box.width) === 0 || parseFloat(box.height) === 0) return;
      fit.fit();
    };

    void (async () => {
      try {
        // 폰트가 뜨기 전에 셀을 재면 폴백 글꼴 폭으로 굳어 TUI 박스 선이 어긋난다.
        // **xterm은 폰트 로딩을 스스로 듣지 않는다** — `lib/xterm.js`에 `fonts`가 0건이고
        // `open()` 시점에 한 번 재고 끝이다. 그래서 `open()`부터가 이 await 뒤에 있다.
        //
        // `ready`만으로는 부족하다: 그것은 **이미 걸려 있는** 로딩만 기다리는데, 이 화면
        // 전까지 앱이 모노 글꼴을 한 글자도 안 썼으면 로딩이 애초에 안 걸려 있다.
        await document.fonts.load(`${FONT_SIZE}px "${MONO_FACE}"`);
        await document.fonts.ready;
        // StrictMode는 개발에서 effect를 mount→unmount→mount로 돌리는데 그 셋이 이 await보다
        // 앞에서 전부 끝난다. 그래서 첫 번째 effect는 여기서 돌아가고 **셸을 띄우지 않는다.**
        if (!alive) return;

        term.open(host);
        // 컨텍스트를 잃으면 그 애드온을 **dispose한다 — 잃은 자리에서 되살리지 않는다.**
        // dispose하면 xterm이 DOM 렌더러로 떨어져 화면이 계속 보이고, 안 하면 검게 굳는다.
        // 붙이는 데 실패하는 것도 같은 종류의 실패라 같은 자리로 떨어뜨린다 — `activate()`는
        // WebGL2를 못 얻으면 **동기로 던지고**, 안 잡으면 셸을 띄우기도 전에 화면이 죽는다.
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        try {
          term.loadAddon(webgl);
        } catch (error) {
          console.warn("atelier: WebGL 렌더러를 붙이지 못했다 — DOM 렌더러로 간다", error);
        }
        refit();
        observer = new ResizeObserver(refit);
        observer.observe(host);

        const channel = new Channel<PtyFrame>();
        channel.onmessage = (frame) => {
          if (!alive) return;
          if (frame instanceof ArrayBuffer) {
            term.write(new Uint8Array(frame));
            return;
          }
          id = null;
          setNotice(
            frame.signal !== null ? `신호로 종료 — ${frame.signal}` : `종료 코드 ${frame.exitCode}`,
          );
        };

        // cwd를 비운다 — `~/.atelier`가 어디인지는 `ATELIER_HOME`을 보는 백엔드만 안다(결정 25)
        const spawned = await terminalApi.spawn(null, term.cols, term.rows, channel);
        // 여기서 죽은 뒤에 응답이 오는 경우 — 그 셸을 그대로 두면 고아가 된다
        if (!alive) {
          ignoreGone(terminalApi.kill(spawned.id));
          return;
        }
        id = spawned.id;
        term.focus();
      } catch (error) {
        // spawn 거부만이 아니라 이 시작 절차에서 터지는 무엇이든 같은 자리에 적는다(결정 23).
        // 이유가 없는 빈 화면이 남는 것이 제일 나쁘다 — 그러면 왜 안 뜨는지 아무 데도 안 남는다.
        if (alive) setNotice(String(error));
      }
    })();

    return () => {
      alive = false;
      observer?.disconnect();
      if (id !== null) ignoreGone(terminalApi.kill(id));
      term.dispose();
    };
  }, []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <PageHeader root="Terminal" inset={!sidebarOpen} />
        {/* 이 줄은 **비어 있어도 자리를 차지한다.** 죽은 셸의 마지막 화면을 그대로 두라는
            것이 결정 22인데, 조건부로 끼워 넣으면 나타나는 순간 컨테이너가 그만큼 낮아지고
            ResizeObserver가 그 화면을 한두 행 줄여 다시 흐르게 한다. 높이를 고정하면 없다. */}
        <div className="h-5 shrink-0 px-4 text-[12px] text-muted-foreground">{notice}</div>
        <div ref={hostRef} className="min-h-0 min-w-0 flex-1 px-4 pb-3" />
      </main>
    </div>
  );
}

export default TerminalPage;
