import { describe, expect, it } from "vitest";
import type { AskedQuestion, QuestionEntry } from "./fold";
import { answeredCards, answersOf, NO_PICK, pickOption, questionKey, typeAnswer } from "./question";

// 질문 카드(v1 티켓 26 · 캔버스 Cards 보드 「Agent의 질문」) — 물음마다 고른 것 · 직접 쓴 말을 답으로, 키 하나를 고르기로, 답한 것을
// 흐름의 답한 카드(02 §10)로 옮긴다. seam은 `question.ts`의 순수 함수들이고, 그리는 쪽(`QuestionCard.tsx`)은 여기 나온 값만 그린다. 문구의
// 정본은 보드의 글자다.

const FEE: AskedQuestion = {
  question: "부분 환불 수수료는 어떻게 할까요?",
  description: "design.md 3장에 적어 둘게요",
  multiSelect: false,
  options: [
    { label: "비율대로 돌려준다", description: null },
    { label: "돌려주지 않는다", description: null },
    { label: "마지막 환불 때 한 번에 돌려준다", description: null },
  ],
};

const SCREEN: AskedQuestion = {
  question: "어느 화면에 보일까요?",
  description: null,
  multiSelect: true,
  options: [
    { label: "주문 상세", description: null },
    { label: "환불 내역", description: null },
  ],
};

describe("고르고 쓴 것이 답이 된다", () => {
  it("하나만 고르는 물음은 고른 하나가 답이고, 직접 쓰면 쓴 말이 고른 것을 대신한다", () => {
    const picked = pickOption(FEE, NO_PICK, 0);
    expect(answersOf([FEE], [picked])).toEqual([{ question: FEE.question, answer: "비율대로 돌려준다" }]);
    expect(pickOption(FEE, picked, 2).picked).toEqual([2]);

    const typed = typeAnswer(FEE, picked, "환불 금액의 절반만");
    expect(typed.picked).toEqual([]);
    expect(answersOf([FEE], [typed])).toEqual([{ question: FEE.question, answer: "환불 금액의 절반만" }]);
    // 다시 고르면 쓴 말은 지워진다 — 한 물음에 답은 하나다.
    expect(pickOption(FEE, typed, 1)).toEqual({ picked: [1], typed: "" });
  });

  it("여럿 고르는 물음은 넣고 빼며, 고른 이름들과 직접 쓴 말을 쉼표로 잇는다(claude가 읽는 꼴)", () => {
    const both = pickOption(SCREEN, pickOption(SCREEN, NO_PICK, 1), 0);
    expect(both.picked).toEqual([0, 1]);
    expect(answersOf([SCREEN], [both])).toEqual([{ question: SCREEN.question, answer: "주문 상세, 환불 내역" }]);
    expect(pickOption(SCREEN, both, 1).picked).toEqual([0]);
    const typed = typeAnswer(SCREEN, both, " 메일 ");
    expect(answersOf([SCREEN], [typed])).toEqual([{ question: SCREEN.question, answer: "주문 상세, 환불 내역, 메일" }]);
  });

  it("모든 물음에 답해야 답이 선다 — 빈 칸 · 공백뿐인 말은 답이 아니다", () => {
    expect(answersOf([FEE, SCREEN], [pickOption(FEE, NO_PICK, 0), NO_PICK])).toBeNull();
    expect(answersOf([FEE], [typeAnswer(FEE, NO_PICK, "   ")])).toBeNull();
    expect(answersOf([FEE, SCREEN], [pickOption(FEE, NO_PICK, 0), pickOption(SCREEN, NO_PICK, 1)])).toEqual([
      { question: FEE.question, answer: "비율대로 돌려준다" },
      { question: SCREEN.question, answer: "환불 내역" },
    ]);
  });
});

describe("키보드로 고른다", () => {
  const press = (code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("숫자는 그 번호의 선택지, Enter는 답하기다 — 물리 키로 읽고, 수식키가 붙으면 고르지 않는다", () => {
    expect(questionKey(press("Digit2"), 3)).toEqual({ pick: 1 });
    expect(questionKey(press("Numpad3"), 3)).toEqual({ pick: 2 });
    expect(questionKey(press("Digit4"), 3)).toBeNull();
    expect(questionKey(press("Enter"), 3)).toEqual({ submit: true });
    expect(questionKey(press("NumpadEnter"), 0)).toEqual({ submit: true });
    expect(questionKey(press("Digit1", { metaKey: true }), 3)).toBeNull();
    expect(questionKey(press("Enter", { shiftKey: true }), 3)).toBeNull();
    expect(questionKey(press("Escape"), 3)).toBeNull();
  });
});

describe("답한 뒤의 카드(02 §10 · Components 「답한 카드」)", () => {
  const entry = (extra: Partial<QuestionEntry>): QuestionEntry => ({ kind: "question", key: "q1", choice: "answer", answers: [], ...extra });

  it("물음마다 한 줄 카드 — 물은 제목과 고른 답(여럿 고른 답은 쉼표로 이은 그대로)이다", () => {
    expect(
      answeredCards(
        entry({
          answers: [
            { question: FEE.question, answer: "비율대로 돌려준다" },
            { question: SCREEN.question, answer: "주문 상세, 환불 내역" },
          ],
        }),
      ),
    ).toEqual([
      { asked: "부분 환불 수수료는 어떻게 할까요?", said: "비율대로 돌려준다" },
      { asked: "어느 화면에 보일까요?", said: "주문 상세, 환불 내역" },
    ]);
  });

  it("나중에로 닫은 질문은 답이 없다 — 「나중에 답하기로 함」 한 줄이고, 아직 기다리면 카드가 없다", () => {
    expect(answeredCards(entry({ choice: "later" }))).toEqual([{ asked: "나중에 답하기로 함", said: null }]);
    expect(answeredCards(entry({ choice: null }))).toEqual([]);
  });
});
