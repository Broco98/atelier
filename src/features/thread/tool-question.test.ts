import { describe, expect, it } from "vitest";
import { toolQuestionKey } from "./tool-question";

// Thread 도구가 세우는 질문 카드의 키(03 티켓 08 · 캔버스 「↑↓ 고르기 · esc 닫기 · 고르기 ↵」) — Space 붙이기 · Project 추가 물음이 함께 쓴다.

describe("Thread 도구 질문 카드의 키 — ↑↓ 고르기 · esc 닫기 · 고르기 ↵", () => {
  const press = (code: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("숫자는 그 줄을 고르고, ↵는 켜진 줄을, ↑↓는 켜진 줄을 옮기며(돌아간다), esc는 나중에다", () => {
    expect(toolQuestionKey(press("Digit2"), 3, 0)).toEqual({ pick: 1 });
    expect(toolQuestionKey(press("Digit4"), 3, 0)).toBe(null);
    expect(toolQuestionKey(press("Enter"), 3, 2)).toEqual({ pick: 2 });
    expect(toolQuestionKey(press("ArrowDown"), 3, 2)).toEqual({ point: 0 });
    expect(toolQuestionKey(press("ArrowUp"), 3, 0)).toEqual({ point: 2 });
    expect(toolQuestionKey(press("Escape"), 3, 1)).toEqual({ later: true });
  });

  it("수식키가 붙으면 고르지 않는다", () => {
    expect(toolQuestionKey(press("Escape", { metaKey: true }), 3, 0)).toBe(null);
    expect(toolQuestionKey(press("Digit1", { shiftKey: true }), 3, 0)).toBe(null);
  });
});
