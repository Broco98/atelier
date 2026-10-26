// 기록 원문(JSON)을 좁히는 작은 손들 — Thread 화면의 순수 함수들(`fold` · `tool-view` · `approval` · `chips`)이 함께 쓴다. 기록은
// Runtime이 준 원문 그대로라 칸이 늘거나 모양이 다를 수 있다: 모양을 믿지 않고 여기서 좁힌다(three-axes `chat/json.ts`를 옮겼다).

/** JSON 객체 하나. */
export type Json = Record<string, unknown>;

/** 배열도 `null`도 아닌 객체인가. */
export const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** 글이면 그 글, 아니면 `null`. 빈 글도 글이다. */
export const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** 비지 않은 글이면 그 글, 아니면 `null` — 공백만 있는 글도 빈 것이다. */
export const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
