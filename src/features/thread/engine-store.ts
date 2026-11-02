import { Store } from "@tanstack/react-store";
import { threadApi } from "./api";
import type { EngineCheck, EngineState, LoginProgress, MissingProgram, RecordLine, Runtime } from "./types";

// Runtime 상태(restart 01c-9 · 스토리 37 · 38 · 40) — 입력창 자리의 안내 카드(`GuideCard`)가 「못 찾음 · 로그인 안 됨 · 로그인 중」을 그리는
// 바탕이다. **Runtime마다 따로 산다** — Codex의 로그인 끊김이 Claude 채팅에 카드를 세우지 않게. 값은 두 길로 온다 — 화면이 부른 확인의
// 답과 엔진 상태 이벤트(`thread:engine`, 앱 층 하나가 받는다 — 세션을 열다 못 찾았거나 로그인이 필요하다는 Host의 알림도 이 길이다).
//
// 확인은 새 채팅이 Runtime을 고른 순간에 한다 — 앱이 도는 동안 Runtime마다 한 번이다(`checkEngineOnce`). 선 채팅은 세션을 열 때 Host가
// 확인하고 이벤트로 알린다.

export interface EngineView {
  found: boolean | null;
  missing: readonly MissingProgram[];
  loggedIn: boolean | null;
  login: LoginProgress | null;
  /** 확인이 도는 중이다 — 「다시 찾기」 · 「다시 확인」과 새 채팅의 보내기를 잠근다. */
  checking: boolean;
  /**
   * 마지막 「다시 찾기」 · 「다시 확인」이 카드를 걷지 못했다 — 카드의 까닭 줄이 그 결과를 말한다. 확인이 거절됐으면(로그인 셸을 읽지
   * 못함) 그 글이다. 쓸 수 있게 되거나 로그인 명령이 움직이면 걷힌다.
   */
  again: { refused: string | null } | null;
}

/** 아직 아무것도 모르는 Runtime. */
const UNKNOWN: EngineView = { found: null, missing: [], loggedIn: null, login: null, checking: false, again: null };

export type EngineViews = Readonly<Record<Runtime, EngineView>>;

export const threadEngineStore = new Store<EngineViews>({ "claude-code": UNKNOWN, codex: UNKNOWN });

/** 그 Runtime의 상태 — 이 판이 모르는 Runtime(다른 판이 쓴 채팅)은 아무것도 모른다. */
export function engineOf(views: EngineViews, runtime: string): EngineView {
  return (views as Readonly<Record<string, EngineView>>)[runtime] ?? UNKNOWN;
}

/** 엔진 이름(`atelier_acp::Agent`)을 채팅의 Runtime 값으로. */
function runtimeOfAgent(agent: EngineState["agent"]): Runtime {
  return agent === "claude" ? "claude-code" : "codex";
}

const usable = (view: Pick<EngineView, "found" | "loggedIn">) => view.found === true && view.loggedIn === true;

function patch(runtime: Runtime, change: (view: EngineView) => Partial<EngineView>): void {
  threadEngineStore.setState((views) => {
    const next = { ...views[runtime], ...change(views[runtime]) };
    return { ...views, [runtime]: usable(next) ? { ...next, again: null } : next };
  });
}

function applyCheck(runtime: Runtime, check: EngineCheck): void {
  patch(runtime, () =>
    check.state === "found"
      ? { found: true, missing: [], loggedIn: check.loggedIn }
      : { found: false, missing: check.missing, loggedIn: null },
  );
}

/** 엔진 상태 이벤트를 그 Runtime에 앉힌다. 로그인 명령이 움직였으면 「다시 확인」의 결과는 지난 일이다. */
export function applyEngineEvent(event: EngineState): void {
  patch(runtimeOfAgent(event.agent), (view) => ({
    found: event.found,
    missing: event.found ? [] : event.missing.length > 0 ? event.missing : view.missing,
    loggedIn: event.loggedIn,
    login: event.login,
    again: event.login ? null : view.again,
  }));
}

/** 이 앱에서 이미 확인한 Runtime — 「앱에서 한 번」은 Runtime마다다. */
const checked = new Set<Runtime>();

/** 확인 — 그 Runtime만 묻고 답을 그 Runtime에 앉혀 돌려준다. `reread`는 「다시 찾기」 · 「다시 확인」이다. 거절(로그인 셸을 못 읽음)은 그대로 던진다. */
export async function checkEngine(runtime: Runtime, reread: boolean): Promise<EngineCheck> {
  checked.add(runtime);
  patch(runtime, () => ({ checking: true }));
  try {
    const check = await threadApi.checkEngine(runtime, reread);
    applyCheck(runtime, check);
    return check;
  } finally {
    patch(runtime, () => ({ checking: false }));
  }
}

/** 새 채팅이 Runtime을 고른 순간의 확인 — 앱이 도는 동안 Runtime마다 한 번이다. 거절은 삼킨다(카드가 안 설 뿐이다). */
export function checkEngineOnce(runtime: Runtime): void {
  if (checked.has(runtime)) return;
  checkEngine(runtime, false).catch(() => {});
}

/**
 * 「다시 찾기」 · 「다시 확인」 — 로그인 env를 새로 읽어 다시 찾고 로그인을 다시 본다. 되면 카드가 걷히고, 안 되면 카드가 남고 까닭이 그 결과로
 * 바뀐다(`again`). 거절되면 그 글이 까닭이 된다.
 */
export async function recheckEngine(runtime: Runtime): Promise<void> {
  let refused: string | null = null;
  try {
    await checkEngine(runtime, true);
  } catch (error) {
    refused = String(error);
  }
  patch(runtime, () => ({ again: { refused } }));
}

export type GuideKind = "missing" | "logging-in" | "logged-out";

/** 입력창 자리에 설 안내 카드 — 없으면 `null`. 못 찾음이 먼저이고, 로그인 명령이 돌면 「로그인 중」, 안 됐으면 「로그인 안 됨」이다. */
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
