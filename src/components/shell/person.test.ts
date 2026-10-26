import { describe, expect, it } from "vitest";
import { initialOf, PERSON_FALLBACK } from "./person";

// 사람 메뉴의 얼굴 글자(v1 티켓 07 · 캔버스 「Thread 목록과 아바타」 보드 「사람은 글자」). seam은 순수 함수 `initialOf`다.
describe("사람의 얼굴 글자", () => {
  // 보드는 세 음절 이름을 둘째 글자로 그렸다 — 세 음절 한국 이름은 성을 뺀 이름의 첫 글자다.
  it("세 음절 한글 이름은 이름의 첫 글자다", () => {
    expect(initialOf("홍길동")).toBe("길");
  });

  it("그 밖의 이름은 첫 글자를 대문자로 쓴다", () => {
    expect(initialOf("Hong Gildong")).toBe("H");
    expect(initialOf("gildong")).toBe("G");
    expect(initialOf("남궁민수")).toBe("남");
  });

  it("이름을 모르면 「나」다", () => {
    expect(initialOf(PERSON_FALLBACK)).toBe("나");
    expect(PERSON_FALLBACK).toBe("나");
  });
});
