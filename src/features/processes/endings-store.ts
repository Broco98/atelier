import { Store, useStore } from "@tanstack/react-store";
import { queryClient } from "@/query-client";
import { expireMarks, LINGER_MS, markOf, NO_MARKS, pressEnd, settleEnd, type EndMark, type EndMarks } from "./endings";
import { snapshotQuery } from "./hooks";
import type { EndResult, ProcessIdentity, ProcessSnapshot } from "./types";

// **누른 줄의 끝내기 표시를 드는 자리**(restart 03-10 · 스토리 134). 표시를 짓고 고치는 규칙은 `endings.ts`(순수)이고, 여기는 그것을 앱
// 한 벌로 들고 시계에 건다. 화면이 아니라 모듈에 두는 것은 끝내기가 화면보다 오래 살 수 있어서다 — 누른 뒤 다른 화면에 갔다 와도 답이 오면
// 그 줄에 선다. 표시는 길어야 답 뒤 2.4초(못 끝냄은 그 프로세스가 표본에 있는 동안)라 쌓이지 않는다.

export const endingsStore = new Store<EndMarks>(NO_MARKS);

/** 누름마다 하나 — 답은 제 누름의 표시만 고친다. */
let presses = 0;

/** 지금 화면에 보인 표본 — 화면 스냅샷의 캐시다. 화면을 안 열었으면 없다. */
export function shownSnapshot(): ProcessSnapshot | undefined {
  return queryClient.getQueryData(snapshotQuery.queryKey);
}

/** **누른 순간** — 대상 줄마다 「끝내는 중」을 세우고 그 누름의 번호를 돌려준다. 줄은 누른 순간 화면에 보인 표본(`shown`)에서 찾는다. */
export function beginEnding(shown: ProcessSnapshot | undefined, targets: ReadonlyArray<ProcessIdentity>): number {
  presses += 1;
  const press = presses;
  endingsStore.setState((marks) => pressEnd(marks, press, shown, targets));
  return press;
}

/**
 * **답이 왔다** — 그 누름의 줄마다 결과를 세운다(`null`이면 답을 못 받았다 — 표시가 빠진다). 결과가 남는 시간(`LINGER_MS`)이 지나면
 * 거둔다. 화면이 열려 있으면 박자마다도 거둔다(`expireEndings`).
 */
export function finishEnding(press: number, results: ReadonlyArray<EndResult> | null): void {
  endingsStore.setState((marks) => settleEnd(marks, press, results, Date.now()));
  if (results !== null) setTimeout(() => expireEndings(shownSnapshot()), LINGER_MS);
}

/** 지난 표시를 거둔다 — 표본을 알면 표본에서 빠진 못 끝냄도(`expireMarks`). */
export function expireEndings(snapshot: ProcessSnapshot | undefined): void {
  const now = Date.now();
  const marks = endingsStore.state;
  const next = expireMarks(marks, snapshot, now);
  if (next !== marks) endingsStore.setState(() => next);
}

/** 모든 줄의 표시 — 화면이 표본에서 빠진 줄을 제자리에 다시 세울 때 읽는다(`withEndings`). */
export function useEndMarks(): EndMarks {
  return useStore(endingsStore, (marks) => marks);
}

/** 그 신원의 줄에 선 표시 — 줄마다 읽는다. 다른 줄의 표시가 바뀌어도 이 줄은 다시 안 그린다. */
export function useEndMark(id: ProcessIdentity): EndMark | undefined {
  return useStore(endingsStore, (marks) => markOf(marks, id));
}
