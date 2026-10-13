import { Store } from "@tanstack/react-store";
import { chatApi } from "./api";
import type { Agent, ChatEngineEvent, EngineCheck, LoginProgress, MissingProgram, RecordLine } from "./types";

// 엔진 상태(three-axes 티켓 22) — 안내 카드가 「못 찾음 · 로그인 안 됨 · 로그인 중」을 그리는 바탕이다(three-axes 결정 24 · 30).
//
// **대화가 아니라 엔진의 것이다.** 찾음 · 로그인은 그 엔진의 모든 대화에 같으므로, 한 대화에서 로그인하면 같은 엔진의 카드가 다
// 걷힌다. 값은 두 길로 온다 — 화면이 부른 엔진 확인의 답(빠진 것과 설치 명령이 여기에만 실린다)과, 호스트가 내보내는 엔진 상태
// 이벤트(확인할 때 · 에이전트가 로그인을 요구할 때 · 로그인 명령이 돌고 끝날 때). 이벤트는 앱 층이 하나로 받는다(`useChatEngineFeed`).
// 저장하지 않는다 — 앱을 다시 켜면 대화창이 다시 확인한다.

/** 엔진 하나의 상태. 처음은 다 모른다(`null`). */
export interface EngineView {
  /** 에이전트를 띄우는 데 드는 실행 파일을 다 찾았나. */
  found: boolean | null;
  /** 못 찾았으면 빠진 것마다 이름과 설치 명령 — 엔진 확인의 답에서 온다(이벤트에는 없다). */
  missing: readonly MissingProgram[];
  /** 로그인돼 있나. 로그인 명령이 도는 동안은 모른다. */
  loggedIn: boolean | null;
  /** 로그인 명령의 진행 — 도는 중(링크)이거나 막 끝남. */
  login: LoginProgress | null;
  /** 엔진 확인이 도는 중이다 — 「다시 확인」을 잠근다. */
  checking: boolean;
}

const UNKNOWN: EngineView = { found: null, missing: [], loggedIn: null, login: null, checking: false };

export const chatEngineStore = new Store<Readonly<Partial<Record<Agent, EngineView>>>>({});

function patch(agent: Agent, change: (view: EngineView) => Partial<EngineView>): void {
  chatEngineStore.setState((state) => {
    const view = state[agent] ?? UNKNOWN;
    return { ...state, [agent]: { ...view, ...change(view) } };
  });
}

/** 엔진 확인의 답을 앉힌다. 로그인 진행은 이벤트의 것이라 그대로 둔다. */
function applyCheck(agent: Agent, check: EngineCheck): void {
  patch(agent, () =>
    check.state === "found"
      ? { found: true, missing: [], loggedIn: check.loggedIn }
      : { found: false, missing: check.missing, loggedIn: null },
  );
}

/** 엔진 상태 이벤트를 앉힌다 — 호스트가 낸 그대로다. 빠진 것 목록은 이벤트에 없어 마지막 확인의 것을 둔다. */
export function applyEngineEvent(event: ChatEngineEvent): void {
  patch(event.agent, (view) => ({
    found: event.found,
    missing: event.found ? [] : view.missing,
    loggedIn: event.loggedIn,
    login: event.login,
  }));
}

/**
 * 그 엔진의 대화가 로그인을 요구했다 — 기록에 로그인 필요 줄이 섰다(Codex `session/new`, 엔진을 가리지 않고 턴 도중). 호스트는
 * 같은 때 엔진 상태(안 됨)도 내보내지만, 줄 하나로도 같은 카드가 서게 한다(스토리 100).
 */
export function markLoginRequired(agent: Agent): void {
  patch(agent, () => ({ found: true, loggedIn: false }));
}

// 앱이 도는 동안 엔진마다 처음 한 번은 화면이 스스로 확인한다 — 그 뒤는 이벤트가 잇고, `+`와 「다시 확인」이 다시 부른다.
const checked = new Set<Agent>();

/**
 * 엔진 확인 — 답을 상태에 앉히고 돌려준다. `reread`는 「다시 확인」이다(로그인 환경을 새로 읽는다 — 설치한 뒤 앱을 다시 켜지
 * 않고 이어 간다, 스토리 102). 거절(로그인 셸을 못 읽음)은 그대로 던진다.
 */
export async function checkEngine(agent: Agent, reread: boolean): Promise<EngineCheck> {
  checked.add(agent);
  patch(agent, () => ({ checking: true }));
  try {
    const check = await chatApi.checkEngine(agent, reread);
    applyCheck(agent, check);
    return check;
  } finally {
    patch(agent, () => ({ checking: false }));
  }
}

/** 대화창이 그 엔진의 대화를 처음 보일 때의 확인 — 앱이 도는 동안 엔진마다 한 번이다. 거절은 삼킨다(카드가 안 설 뿐이다). */
export function checkEngineOnce(agent: Agent): void {
  if (checked.has(agent)) return;
  checkEngine(agent, false).catch(() => {});
}

/** 안내 카드의 갈래. */
export type GuideKind = "missing" | "logging-in" | "logged-out";

/**
 * 그 대화 자리에 설 안내 카드 — 없으면 `null`(대화가 선다). 못 찾음이 먼저이고, 로그인 명령이 돌면 「로그인 중」, 안 됐으면
 * 「로그인 안 됨」이다. 엔진이 「됨」이면 기록에 로그인 필요 줄이 남아 있어도 카드가 걷힌다 — 호스트가 그 대화를 다시 띄운다.
 * 엔진 상태를 아직 모르면(다시 켠 뒤 확인이 오기 전) 기록의 로그인 필요 줄이 카드를 세운다.
 */
export function guideKind(view: EngineView | undefined, awaitingLogin: boolean): GuideKind | null {
  if (view?.found === false) return "missing";
  if (view?.login?.state === "running") return "logging-in";
  if (view?.loggedIn === false) return "logged-out";
  if (view?.loggedIn !== true && awaitingLogin) return "logged-out";
  return null;
}

/** `session` 줄의 갈래(`state`) — 다른 줄이면 `null`. */
function sessionState(line: RecordLine): unknown {
  if (line.kind !== "session" || typeof line.payload !== "object" || line.payload === null) return null;
  return (line.payload as { state?: unknown }).state;
}

/** 기록 줄이 로그인 필요 줄인가 — 에이전트가 `-32000`으로 답했다(three-axes 티켓 12). */
export function isLoginRequired(line: RecordLine): boolean {
  return sessionState(line) === "login-required";
}

/**
 * 그 대화가 로그인을 기다리나 — 마지막 `session` 줄이 로그인 필요다. 다시 띄우면 그 뒤에 띄우는 중 · 열림 줄이 선다. 계정 상태
 * 줄(`auth-status`)은 엔진이 알린 원문일 뿐이라 건너뛴다 — 로그인 필요 줄 앞뒤 어디에나 설 수 있다.
 */
export function awaitingLogin(lines: readonly RecordLine[]): boolean {
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const state = sessionState(lines[at]);
    if (state === null || state === "auth-status") continue;
    return state === "login-required";
  }
  return false;
}
