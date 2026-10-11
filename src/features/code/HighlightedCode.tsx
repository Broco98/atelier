import { useMemo, useState, useSyncExternalStore } from "react";
import { File as FileView, Virtualizer, WorkerPoolContext, type FileOptions } from "@pierre/diffs/react";
import { getOrCreateWorkerPoolSingleton, type WorkerPoolManager } from "@pierre/diffs/worker";
// Vite가 워커를 따로 묶어 그 주소를 준다 — 모듈 워커라 `vite.config.ts`의 `worker.format`이 `es`다.
import highlightWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url";
import { cn } from "@/lib/utils";
import { bodyColumn } from "@/features/works/SpecViewer";
import { CODE_THEME, registerCodeTheme } from "./code-theme";

/**
 * **강조 상한** — 이보다 줄이 많은 파일은 평문이다(결정 35 — 2만 줄). 라이브러리가 줄 수로 견준다(`tokenizeMaxLength`). 한 줄이
 * 1000자를 넘으면 그 줄만 강조하지 않는 것은 라이브러리 기본값 그대로다(`tokenizeMaxLineLength`).
 */
export const HIGHLIGHT_MAX_LINES = 20_000;

/**
 * **워커가 뜨지 못했을 때의 강조 상한**(결정 35의 물러서기 — 「메인 스레드 + 약 2천 줄」). 워커가 뜨지 못하면 라이브러리가 풀을
 * 멈추고 메인 스레드에서 강조하는데, 그 강조는 그리는 스레드를 붙든다 — 2만 줄 상한 그대로면 큰 파일을 여는 순간 화면이 선다.
 * 그래서 그때는 상한을 이 값으로 내린다. G1(빌드된 앱에서 워커 · WASM이 뜨는가)이 실패하는 기계도 이 길을 탄다.
 */
export const HIGHLIGHT_MAX_LINES_MAIN_THREAD = 2_000;

/** 워커 수(결정 35). 라이브러리 기본 8은 탭 하나를 보는 화면에 넘친다. */
const POOL_SIZE = 2;

/**
 * 워커가 답하기를 기다리는 한도. 라이브러리 기본 10초를 넘기면 풀을 멈추고 메인 스레드로 물러서는데(강조 상한도 2천 줄로 내려가
 * 앱이 끝날 때까지 간다), 붐비는 기계에서는 워커 기동과 WASM 컴파일이 그 안에 못 끝나 멀쩡한 풀을 버린다(L3에서 실제로 그랬다).
 * 기다리는 동안 본문은 앱의 평문 보기라(`PlainCode` — 라이브러리는 풀이 서기 전에는 평문도 그리지 못한다) 읽기는 바로 시작되고
 * 늦어지는 것은 색뿐이므로 넉넉히 둔다. 스크립트를 못 받는 워커는 이 한도와 상관없이 곧바로 실패하고, 오류 없이 답하지 않는
 * 워커만 이 한도를 다 쓴다 — 그동안에도 글자는 평문으로 서 있고, 한도가 지나면 메인 스레드가 칠한다.
 */
const WORKER_INIT_TIMEOUT_MS = 60_000;

/**
 * 엔진은 WASM이다(결정 35). 라이브러리 기본(shiki JS 엔진)은 WKWebView에서 첫 강조가 시간 제한을 넘겨 **토큰이 틀린다**
 * (사실 12) — L3(WebKit)의 오토큰 검사가 그것을 잡는다.
 */
const ENGINE = "shiki-wasm";

/**
 * 파일 보기의 옵션. 워커 풀이 서 있으면 테마는 풀이 쥐지만, 풀이 뜨지 못해 메인 스레드로 물러설 때도 같은 엔진 · 같은 색이게
 * 여기에도 적는다(라이브러리의 「워커 오류」 — 초기화가 실패하면 풀을 멈추고 메인 스레드에서 강조한다).
 */
const OPTIONS: FileOptions<undefined, undefined> = {
  theme: CODE_THEME,
  themeType: "light",
  preferredHighlighter: ENGINE,
  tokenizeMaxLength: HIGHLIGHT_MAX_LINES,
  // 가로로 넘치는 줄은 줄바꿈하지 않고 스크롤한다. 줄 번호는 켠 채다(기본).
  overflow: "scroll",
  // 경로는 카드 머리가 이미 말한다(`<프로젝트> › 폴더 › 파일`) — 라이브러리의 파일 머리는 두 번째 머리다.
  disableFileHeader: true,
  // 거터 도구는 WebKit을 죽이는 이슈가 열려 있다(#1184, 사실 12).
  enableGutterUtility: false,
};

/**
 * 워커 풀 — 앱에 **하나**이고(라이브러리의 싱글턴), 코드 보기가 처음 설 때 띄워 앱이 끝날 때까지 둔다. 라이브러리의 React
 * 공급자(`WorkerPoolContextProvider`)는 마지막 공급자가 내려가면 풀을 끄는데, 파일 탭은 셸 탭과 오가며 수시로 내려간다 — 그때마다
 * 워커 둘을 다시 띄우고 WASM을 다시 올리지 않게 공급자를 쓰지 않고 풀을 곧장 건넨다(`WorkerPoolContext`). 아무도 끄지 않는다.
 */
function highlightPool(): WorkerPoolManager {
  // 테마가 먼저 올라야 풀이 그 이름을 풀어 워커에 건넨다.
  registerCodeTheme();
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory: () => new Worker(highlightWorkerUrl, { type: "module" }),
      poolSize: POOL_SIZE,
      workerInitializationTimeout: WORKER_INIT_TIMEOUT_MS,
    },
    highlighterOptions: { theme: CODE_THEME, preferredHighlighter: ENGINE },
  });
}

/**
 * **강조된 코드 한 장**(git-integration 판 01 티켓 08) — 파일 탭의 텍스트 몸. `@pierre/diffs`의 파일 보기를 가상화 틀 안에 둔다
 * (결정 35): 보이는 줄 언저리만 그리고, 강조는 워커가 하는 동안 평문이 먼저 선다 — 큰 파일을 열어도 화면이 멈추지 않는다
 * (스토리 68). 언어는 파일 이름으로 라이브러리가 고른다.
 *
 * **풀이 서기 전에는 앱이 평문을 세운다**(스토리 67 — `PlainCode`). 라이브러리는 평문도 풀이 쥔 하이라이터로 그리는데, 그
 * 하이라이터는 워커 둘의 기동과 WASM이 다 끝나야 생긴다 — 그전에는 줄 하나 그리지 못한다. 앱을 켜고 처음 여는 파일 탭이 그때다.
 *
 * **이 틀이 카드의 스크롤 상자다** — 카드의 직계 flex 자식이어야 남는 높이를 받는다(`CodeView`의 다른 갈래와 같은 자리).
 * 열 규격은 문서 본문과 같은 것을 쓴다(`bodyColumn`) — 04의 원문 보기(`SourceView`)가 선 자리 그대로다.
 *
 * 같은 파일의 내용이 바뀌면 같은 인스턴스에 새 내용을 넣는다 — 다시 세우지 않아 스크롤 자리가 남는다(G6). **다른 파일은 새
 * 인스턴스다**(부르는 쪽이 파일마다 키를 준다 — `CodeView`): 라이브러리는 강조된 파일을 든 보기에 다른 파일이 오면 그 파일의
 * 강조가 올 때까지 앞 파일을 그리므로, 같은 인스턴스에 넣으면 새 경로 아래 앞 파일이 선다.
 */
export function HighlightedCode({ path, content, wide }: { path: string; content: string; wide: boolean }) {
  const [workers] = useState(highlightPool);
  const phase = usePoolPhase(workers);
  const onMainThread = phase === "mainThread";
  const options = useMemo(
    () => (onMainThread ? { ...OPTIONS, tokenizeMaxLength: HIGHLIGHT_MAX_LINES_MAIN_THREAD } : OPTIONS),
    [onMainThread],
  );
  const file = useMemo(() => ({ name: path, contents: content }), [path, content]);
  return (
    <WorkerPoolContext.Provider value={workers}>
      <Virtualizer
        className="min-h-0 flex-1 overflow-y-auto scroll-quiet"
        contentClassName={cn(bodyColumn(wide), "py-4")}
      >
        {/* 범위 토큰(`--code-syntax-*`)이 이 상자에서 서고, 강조 결과가 서는 shadow DOM 안으로 상속된다(`index.css`).
            -ml로 규격의 좌측 여백(48px)만큼 되돌린다 — 그 여백은 줄 번호의 자리다(`SourceView`와 같다). */}
        <div data-code-view="" className="-ml-12">
          {phase === "starting" ? <PlainCode content={content} /> : <FileView file={file} options={options} />}
        </div>
      </Virtualizer>
    </WorkerPoolContext.Provider>
  );
}

/**
 * 풀이 어디쯤인가 — `starting`은 아직 서는 중이라 라이브러리가 아무것도 그리지 못하고, `ready`는 워커가 섰고, `mainThread`는
 * 워커를 잃고 메인 스레드로 물러섰다. 풀의 상태가 바뀔 때마다 다시 읽는다.
 */
function usePoolPhase(workers: WorkerPoolManager): "starting" | "ready" | "mainThread" {
  return useSyncExternalStore(
    (onChange) => workers.subscribeToStatChanges(onChange),
    () => {
      const { workersFailed, managerState } = workers.getStats();
      if (workersFailed) return "mainThread";
      return managerState === "initialized" ? "ready" : "starting";
    },
  );
}

/** 줄을 가르는 것 — 라이브러리와 같이 `\r\n` · `\r` · `\n`을 모두 줄바꿈으로 센다(줄 번호가 라이브러리의 보기와 같게). */
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * **평문 보기** — 워커 풀이 서기 전의 본문(스토리 67). 글자와 줄 번호만 세우고, 풀이 서면 라이브러리의 보기가 그 자리를 잇는다.
 *
 * 라이브러리가 줄을 세우는 **바로 그 자리**에 글자를 둔다 — 보기가 바뀌어도 글자가 뛰지 않는다(L3가 첫 글자의 자리로 잰다).
 * 위 여백 8px(라이브러리의 `--diffs-gap-block` 기본값), 줄 번호 칸은 왼쪽 2ch + 숫자 자릿수 + 오른쪽 1ch + 칸 경계 2px, 줄의 좌우
 * 여백 1ch다. 글꼴 · 크기 · 줄 높이 · 탭 폭 · 색은 라이브러리에 건네는 것과 같은 전역 토큰이다(`index.css`의 `[data-code-view]`).
 *
 * 줄마다 요소를 짓지 않고 `pre` 둘(줄 번호 한 덩이 · 글 한 덩이)에 담는다 — 가상화 없이 수만 줄을 세워도 요소는 둘이라 큰
 * 파일을 열어도 그리는 스레드를 붙들지 않는다.
 */
function PlainCode({ content }: { content: string }) {
  const { text, numbers } = useMemo(() => {
    const lines = content.split(LINE_BREAK);
    return { text: lines.join("\n"), numbers: lines.map((_, i) => i + 1).join("\n") };
  }, [content]);
  return (
    <div className="flex py-2 font-mono text-mono [tab-size:4]">
      {/* 줄 번호는 읽을 글이 아니다 — 고를 수도 없다(라이브러리의 줄 번호 칸과 같다). */}
      <pre
        data-plain-numbers=""
        aria-hidden
        className="shrink-0 select-none border-r-2 border-background pr-[1ch] pl-[2ch] text-right text-tertiary"
      >
        {numbers}
      </pre>
      <pre data-plain-lines="" className="min-w-0 flex-1 overflow-x-auto px-[1ch] text-foreground scroll-quiet">
        {text}
      </pre>
    </div>
  );
}
