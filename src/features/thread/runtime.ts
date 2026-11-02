import type { Runtime, ThreadView } from "./types";

export type { Runtime };

// 화면이 Runtime을 부르는 이름(스펙 「01a — Agent 걷어내기」 · 스토리 2) — 채팅은 Runtime 세션 하나라 흐름과 카드의 말이 모두 이 이름으로 선다.
// 말한 이를 가를 일이 없으므로 채팅의 Runtime 값 하나만 읽는다.
//
// 새 채팅에서만 Runtime을 고른다(스펙 「01c — Codex」 · 스토리 30 · 31) — 메뉴는 Claude Code와 Codex 둘이고(Composer 「Runtime 고르기」), 기본은
// Claude Code다. 턴이 시작되면 잠긴다 — 채팅 하나가 Runtime 세션 하나다.

/** 새 채팅의 Runtime — 고르지 않으면 이것이다. */
export const DEFAULT_RUNTIME: Runtime = "claude-code";

/** 새 채팅의 Runtime 메뉴 — 이름과 설명 한 줄(Composer 「Runtime 고르기」 · 「이 채팅을 돌릴 Runtime」). */
export const RUNTIMES: readonly { value: Runtime; name: string; description: string }[] = [
  { value: "claude-code", name: "Claude Code", description: "내 claude를 그대로 쓴다" },
  { value: "codex", name: "Codex", description: "내 codex를 쓴다 · 모델과 모드는 Codex가 보낸 대로" },
];

const NAMES: Readonly<Record<string, string>> = Object.fromEntries(RUNTIMES.map((one) => [one.value, one.name]));

/** 그 채팅의 Runtime 이름. 표에 없는 값은 글자 그대로 보인다. */
export function runtimeNameOf({ runtime }: Pick<ThreadView, "runtime">): string {
  return NAMES[runtime] ?? runtime;
}
