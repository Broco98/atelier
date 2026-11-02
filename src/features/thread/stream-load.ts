import { frameGapReport, recordFrames, type FrameGapReport } from "@/lib/frame-gaps";
import { router } from "@/router";
import { threadApi } from "./api";
import { foldThread } from "./fold";
import { linesOf, threadFlowStore, threadRecordStore } from "./thread-store";

// 스트리밍 부하 점검의 앱 쪽(restart 티켓 01b-9). `scripts/stream-load.mjs`가 띄운 개발 빌드에서만 돈다 — 입구는 `main.tsx`의 dev 가드 한
// 곳이고, 배포 빌드에는 들지 않는다(그 스크립트의 `--check-bundle`이 잰다). 스크립트의 작은 서버에서 할 일을 받아 부하가 든 Thread를 열고,
// 말을 보내고, 턴이 끝날 때까지 `requestAnimationFrame` 간격을 재서 그 서버로 돌려준다.

/** 프레임 간격의 기준 — 스펙의 50ms다. */
const LIMIT_MS = 50;

/** 번들에 이 글이 있으면 이 파일이 든 것이다 — `--check-bundle`이 찾는다. */
const MARK = "atelier-stream-load";

/** 스크립트가 주는 할 일. */
interface Plan {
  thread: string;
  /** 열린 뒤 재기 시작할 때까지 기다릴 기록 줄 수. */
  lines: number;
  say: string;
  /** 말을 보내기 전 기준선을 재는 밀리초. */
  idleMs: number;
  /** 화면이 선 뒤와 턴이 끝난 뒤 기다리는 밀리초. */
  settleMs: number;
}

/** 프레임마다 읽는 값 — 그때 흐르던 글의 길이 · 기록 줄 수. */
type FrameNote = { chars: number; lines: number };

interface Report {
  mark: string;
  plan: Plan;
  idle: FrameGapReport<FrameNote>;
  stream: FrameGapReport<FrameNote>;
  /** 화면이 받은 흐르는 글 갱신 수. */
  flowUpdates: number;
  /** 끝난 기록 전체를 접는 한 번의 밀리초 — 50번의 평균이다. */
  foldMs: number;
  turns: number;
  lines: { before: number; after: number };
  /** 재고 난 뒤에도 낱말을 감싼 요소 수 — 낱말이 다 서면 걷으므로 0이다. */
  wordsLeft: number;
  /** 재는 동안 창이 앞에 없던 일 — 비어야 값이 유효하다. */
  away: string[];
  view: { width: number; height: number; ratio: number };
}

const sleep = (ms: number) => new Promise((done) => window.setTimeout(done, ms));

async function until(what: string, ready: () => boolean, limitMs: number): Promise<void> {
  const giveUpAt = performance.now() + limitMs;
  while (!ready()) {
    if (performance.now() > giveUpAt) throw new Error(`기다리다 끝났다: ${what}`);
    await sleep(100);
  }
}

function timed(work: () => unknown): number {
  const startedAt = performance.now();
  work();
  return performance.now() - startedAt;
}

/** 재는 동안 창이 뒤로 간 일을 적는다. */
function watchAway(away: string[]): () => void {
  const note = (what: string) => away.push(`${Math.round(performance.now())}ms ${what}`);
  const onVisibility = () => {
    if (document.hidden) note("hidden");
  };
  const onBlur = () => note("blur");
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  if (document.hidden) note("hidden");
  if (!document.hasFocus()) note("no-focus");
  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", onBlur);
  };
}

async function measure(plan: Plan): Promise<Report> {
  const { thread } = plan;
  const lines = () => linesOf(threadRecordStore.state, thread);
  await router.navigate({ to: "/threads/$id", params: { id: thread } });
  await until("기록을 읽기", () => lines().length >= plan.lines, 60_000);
  await sleep(plan.settleMs);

  const away: string[] = [];
  const stopWatching = watchAway(away);
  let flowUpdates = 0;
  const flow = threadFlowStore.subscribe(() => {
    flowUpdates += 1;
  });
  // 개발판 react-dom은 렌더마다 `performance.measure`를 남기고 지우지 않는다. 항목이 바뀐 props를 안고 쌓여 WKWebView가 2분에 1GB를 넘기고 메모리 압력 처리로 멎는다.
  // 배포 빌드에 없는 값이라 재는 동안 비운다.
  const clearing = window.setInterval(() => performance.clearMeasures(), 1000);
  const frames = recordFrames<FrameNote>(window.requestAnimationFrame.bind(window), () => ({
    chars: threadFlowStore.state[thread]?.text.length ?? 0,
    lines: lines().length,
  }));

  await sleep(plan.idleMs);
  const sentAt = performance.now();
  const before = lines();
  const lastSeq = before[before.length - 1].seq;
  await threadApi.send(thread, plan.say);
  await until("턴이 끝나기", () => lines().some((line) => line.seq > lastSeq && line.kind === "turn-end"), 30 * 60_000);
  await sleep(plan.settleMs);

  frames.stop();
  window.clearInterval(clearing);
  flow.unsubscribe();
  stopWatching();
  const stamps = frames.stamps();
  const notes = frames.notes();
  // WebKit의 시계는 1ms 단위다 — 여러 번의 평균을 낸다.
  const foldMs = timed(() => {
    for (let time = 0; time < 50; time += 1) foldThread(lines());
  }) / 50;
  const split = stamps.findIndex((stamp) => stamp >= sentAt);
  const noted = (from: number) => ({ noteAt: (frame: number) => notes[from + frame] });
  return {
    mark: MARK,
    plan,
    idle: frameGapReport(stamps.slice(0, split), LIMIT_MS, noted(0)),
    stream: frameGapReport(stamps.slice(split), LIMIT_MS, noted(split)),
    flowUpdates,
    foldMs,
    turns: foldThread(lines()).turns.length,
    lines: { before: before.length, after: lines().length },
    wordsLeft: document.querySelectorAll(".word-in").length,
    away,
    view: { width: window.innerWidth, height: window.innerHeight, ratio: window.devicePixelRatio },
  };
}

/** 점검 하나를 돈다. 어디서 실패하든 그 까닭을 스크립트로 돌려준다 — 화면을 볼 사람이 없다. */
export async function runStreamLoad(sink: string): Promise<void> {
  const send = (body: unknown) => fetch(`${sink}/report`, { method: "POST", body: JSON.stringify(body) });
  try {
    const plan = (await (await fetch(`${sink}/plan`)).json()) as Plan;
    await send(await measure(plan));
  } catch (failure) {
    await send({ error: String(failure) });
  }
}
