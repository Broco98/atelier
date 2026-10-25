import { cardKey, type CardPress } from "./approval";

// Thread 도구가 세우는 질문 카드의 값과 키(03 티켓 08 · 구현 스펙 §11 S12 · §12 · 캔버스 F4-WorkAsk · F4-KitChat 「질문 카드」) — Agent의
// 질문(`QuestionCard`)이 아니라 Thread 도구가 「카드를 세우고 기다리는 길」로 묻는 질문이다. 겉은 질문 카드의 부품이다 — 머리 「Host ·
// 질문」, 물음과 그 아래 한 줄, 번호 줄(「추천」 표 · 아래 줄), 맨 아래 「↑↓ 고르기 · esc 닫기」와 「고르기 ↵」. 그리는 것은
// `ToolQuestionCard`이고, 카드 종류마다의 글은 그 종류의 순수 함수가 짓는다 — Space 붙이기(`space-card.ts`). 12의 Project 추가 물음(「git init
// 하고 추가」 · 「추가하지 않기」)도 이 값으로 선다.

/** 번호 줄 하나 — 이름, 「추천」 표(추천이 아니면 null), 아래 줄(없으면 null). */
export interface ToolQuestionOption {
  label: string;
  badge: "추천" | null;
  note: string | null;
}

/** 카드의 값 — 머리 · 물음 · 물음 아래 줄(없으면 null) · 번호 줄과 처음 켜진 줄. */
export interface ToolQuestionView {
  head: string;
  title: string;
  sub: string | null;
  options: ToolQuestionOption[];
  start: number;
}

/**
 * 카드의 키(캔버스 「↑↓ 고르기 · esc 닫기 · 고르기 ↵」) — 숫자 · ↵ · ↑↓는 번호 줄 카드와 같고(`cardKey`), esc는 마지막 줄이 아니라
 * 「나중에」다 — 아무것도 고르지 않고 닫는다. 수식키가 붙으면 고르지 않는다.
 */
export function toolQuestionKey(
  press: CardPress,
  count: number,
  active: number,
): { pick: number } | { point: number } | { later: true } | null {
  const bare = !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey;
  if (press.code === "Escape") return bare ? { later: true } : null;
  return cardKey(press, count, active);
}
