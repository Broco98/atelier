import type { ThreadView } from "./types";

// 화면이 Runtime을 부르는 이름(스펙 「01a — Agent 걷어내기」 · 스토리 2) — 채팅은 Runtime 세션 하나라 흐름과 카드의 말이 모두 이 이름으로 선다.
// 말한 이를 가를 일이 없으므로 채팅의 Runtime 값 하나만 읽는다. 값이 없으면(세션이 서기 전) 기본 Runtime이다.

const DEFAULT_RUNTIME = "claude-code";

const NAMES: Readonly<Record<string, string>> = { "claude-code": "Claude Code" };

/** 그 채팅의 Runtime 이름. 표에 없는 값은 글자 그대로 보인다. */
export function runtimeNameOf(view: Pick<ThreadView, "participants">): string {
  const runtime = view.participants[0]?.runtime ?? DEFAULT_RUNTIME;
  return NAMES[runtime] ?? runtime;
}
