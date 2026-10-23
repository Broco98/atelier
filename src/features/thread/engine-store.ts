import { Store } from "@tanstack/react-store";
import type { ChatEngineEvent } from "@/features/chat/types";
import { threadApi } from "./api";
import type { EngineCheck, LoginProgress, MissingProgram, RecordLine } from "./types";

// Thread 엔진의 Runtime 상태(v1 티켓 05) — 안내 카드(`GuideCard`)가 「못 찾음 · 로그인 안 됨 · 로그인 중」을 그리는 바탕이다. three-axes
// 엔진 스토어(`chat/engine-store.ts`)를 옮겨 왔고, v1의 Runtime은 Claude Code 하나라 엔진마다 나누지 않는다. 값은 두 길로 온다 — 화면이
// 부른 확인의 답(빠진 것과 설치 명령이 여기에만 실린다)과 엔진 상태 이벤트(`thread:engine`, 앱 층 하나가 받는다).

export interface EngineView {
  found: boolean | null;
  missing: readonly MissingProgram[];
  loggedIn: boolean | null;
  login: LoginProgress | null;
  /** 확인이 도는 중이다 — 「다시 확인」을 잠근다. */
  checking: boolean;
}

export const threadEngineStore = new Store<EngineView>({
  found: null,
  missing: [],
  loggedIn: null,
  login: null,
  checking: false,
});

const patch = (change: (view: EngineView) => Partial<EngineView>) =>
  threadEngineStore.setState((view) => ({ ...view, ...change(view) }));

function applyCheck(check: EngineCheck): void {
  patch(() =>
    check.state === "found"
      ? { found: true, missing: [], loggedIn: check.loggedIn }
      : { found: false, missing: check.missing, loggedIn: null },
  );
}

/** 엔진 상태 이벤트를 앉힌다 — 빠진 것 목록은 이벤트에 없어 마지막 확인의 것을 둔다. */
export function applyEngineEvent(event: ChatEngineEvent): void {
  patch((view) => ({
    found: event.found,
    missing: event.found ? [] : view.missing,
    loggedIn: event.loggedIn,
    login: event.login,
  }));
}

/** Host가 로그인을 요구했다 — 기록에 로그인 필요 줄이 섰다. */
export function markLoginRequired(): void {
  patch(() => ({ found: true, loggedIn: false }));
}

let checked = false;

/** 확인 — 답을 앉히고 돌려준다. `reread`는 「다시 확인」이다. 거절(로그인 셸을 못 읽음)은 그대로 던진다. */
export async function checkEngine(reread: boolean): Promise<EngineCheck> {
  checked = true;
  patch(() => ({ checking: true }));
  try {
    const check = await threadApi.checkEngine(reread);
    applyCheck(check);
    return check;
  } finally {
    patch(() => ({ checking: false }));
  }
}

/** Thread 화면이 처음 설 때의 확인 — 앱이 도는 동안 한 번이다. 거절은 삼킨다(카드가 안 설 뿐이다). */
export function checkEngineOnce(): void {
  if (checked) return;
  checkEngine(false).catch(() => {});
}

export type GuideKind = "missing" | "logging-in" | "logged-out";

/** Thread 본문 자리에 설 안내 카드 — 없으면 `null`. 못 찾음이 먼저이고, 로그인 명령이 돌면 「로그인 중」, 안 됐으면 「로그인 안 됨」이다. */
export function guideKind(view: EngineView, awaitingLogin: boolean): GuideKind | null {
  if (view.found === false) return "missing";
  if (view.login?.state === "running") return "logging-in";
  if (view.loggedIn === false) return "logged-out";
  if (view.loggedIn !== true && awaitingLogin) return "logged-out";
  return null;
}

function sessionState(line: RecordLine): unknown {
  if (line.kind !== "session" || typeof line.payload !== "object" || line.payload === null) return null;
  return (line.payload as { state?: unknown }).state;
}

export function isLoginRequired(line: RecordLine): boolean {
  return sessionState(line) === "login-required";
}

/** 그 Thread가 로그인을 기다리나 — 마지막 `session` 줄이 로그인 필요다(계정 상태 줄은 건너뛴다). */
export function awaitingLogin(lines: readonly RecordLine[]): boolean {
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const state = sessionState(lines[at]);
    if (state === null || state === "auth-status") continue;
    return state === "login-required";
  }
  return false;
}
