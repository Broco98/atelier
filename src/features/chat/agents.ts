import type { Agent } from "./types";

// 대화의 에이전트 — 고를 수 있는 목록(화면의 차례)과 화면 이름. 입력창 칩 · 자리 표시 글 · 승인 카드 · 안내 카드와 설정 「대화」가
// 함께 읽는다. 엔진이 하나 늘면 여기와 `types.ts`의 `Agent`를 고친다.

/** 고를 수 있는 에이전트 — 칩 메뉴와 설정 「대화」의 차례다. */
export const AGENTS: readonly Agent[] = ["claude", "codex"];

/** 에이전트의 화면 이름. */
export const AGENT_LABEL: Readonly<Record<Agent, string>> = { claude: "Claude Code", codex: "Codex" };
