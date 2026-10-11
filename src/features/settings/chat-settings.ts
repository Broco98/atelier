import { settingsApi } from "./api";
import type { ChatAgent, ChatEngineDefaults, ChatSettings } from "./types";

// 설정 「대화」 구획을 **읽고 고치는 규칙**(three-axes 결정 16 · 티켓 25). 화면(`SettingsPage.tsx`의 `ChatSettingsPage`)과 `+`
// (`features/chat/ChatPane.tsx`)가 같은 규칙을 딛어야 해서 화면에서 꺼냈다 — 알림 구획의 `notifications.ts`와 같은 까닭이다.
//
// - **「엔진 기본값」은 키가 없는 것이다.** `null` 줄을 적지 않는다 — 호스트가 그 칸을 비워 두어야 Claude가 플래그를, Codex가
//   `set_*`를 받지 않는다. 그래서 비운 엔진 칸은 빠지고, 비운 구획도 빠진다(알림 구획과 같은 규칙 — 손대지 않은 사람의 파일이
//   이 구획 때문에 달라지지 않는다).
// - **읽은 것 위에 얹는다.** 손으로 적은 모르는 키는 구획 안에서도, 엔진 칸 안에서도 저장 한 번에 사라지지 않는다.

/** `+`와 첫 대화가 여는 에이전트의 처음 값 — Claude Code다(three-axes 결정 16). */
export const DEFAULT_AGENT: ChatAgent = "claude";

/** 고를 수 있는 에이전트 — 화면의 차례이기도 하다. */
export const CHAT_AGENTS: readonly ChatAgent[] = ["claude", "codex"];

/** 엔진마다 고르는 칸 둘 — 기본 모델 · 시작 모드. */
export type EngineField = keyof ChatEngineDefaults;

/**
 * `+`가 여는 에이전트. 고르지 않았거나 모르는 값(손으로 잘못 적은 이름)이면 처음 값이다 — 손으로 고친 파일 한 줄이 `+`를 막지
 * 않는다.
 */
export function defaultAgentOf(chat: ChatSettings | undefined): ChatAgent {
  const picked: unknown = chat?.defaultAgent;
  return CHAT_AGENTS.find((agent) => agent === picked) ?? DEFAULT_AGENT;
}

/**
 * 지금 설정 파일의 기본 에이전트 — `+`를 누를 때마다 다시 읽는다. 그래서 설정을 바꾸면 다음 `+`부터 들고, 작업 패널과 `chat` 탭에
 * 함께 선 대화창 둘이 같은 값을 본다. 파일이 깨져 읽지 못하면 처음 값이다 — 대화는 설정 화면과 달리 깨진 파일에 막히지 않는다
 * (호스트도 깨진 파일을 엔진 기본값으로 읽는다).
 */
export async function readDefaultAgent(): Promise<ChatAgent> {
  try {
    return defaultAgentOf((await settingsApi.read()).chat);
  } catch {
    return DEFAULT_AGENT;
  }
}

/** 그 엔진의 그 칸에 고른 값. 엔진 기본값(키 없음)이거나 글자가 아니면 `null`이다. */
export function engineChoice(chat: ChatSettings | undefined, agent: ChatAgent, field: EngineField): string | null {
  const value: unknown = chat?.[agent]?.[field];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** 기본 에이전트를 고른 구획. */
export function chooseDefaultAgent(chat: ChatSettings | undefined, agent: ChatAgent): ChatSettings {
  return { ...chat, defaultAgent: agent };
}

/**
 * 그 엔진의 그 칸을 고른 구획. `null`이면 「엔진 기본값」 — 키째 빼고, 빈 엔진 칸과 빈 구획도 뺀다(구획이 비면 `undefined`).
 */
export function chooseEngineDefault(
  chat: ChatSettings | undefined,
  agent: ChatAgent,
  field: EngineField,
  value: string | null,
): ChatSettings | undefined {
  const engine: ChatEngineDefaults = { ...chat?.[agent] };
  if (value === null) delete engine[field];
  else engine[field] = value;
  const next: ChatSettings = { ...chat, [agent]: engine };
  if (Object.keys(engine).length === 0) delete next[agent];
  return Object.keys(next).length === 0 ? undefined : next;
}
