import type { CardPress } from "./approval";
import type { AskedQuestion, QuestionEntry } from "./fold";
import type { QuestionAnswer } from "./types";

// 질문 카드의 화면 값(v1 티켓 26 · 구현 스펙 §9 · 스토리 81 · 캔버스 Cards 보드 「Agent의 질문」) — 물음마다 사람이 고른 것 · 직접 쓴
// 말을 엔진에 보낼 답으로, 키 하나를 고르기로, 답한 것(`QuestionEntry`)을 「답함: …」 줄의 글로 옮기는 **순수 함수**다. 그리는 것은
// `QuestionCard` · `ThreadFlow`다.
//
// - **한 물음에 답은 하나다** — 하나만 고르는 물음은 고른 선택지 하나이거나 직접 쓴 말이다(나중 것이 앞의 것을 지운다). 여럿 고르는
//   물음은 고른 이름들에 직접 쓴 말을 더해 쉼표로 잇는다 — claude의 질문 도구가 여럿 고른 답을 그 꼴로 읽는다.
// - **모든 물음에 답해야 「답하기」가 선다** — 비운 물음을 남기려면 「나중에」다.

/** 물음 하나에 사람이 한 것 — 고른 선택지의 자리들과 직접 쓴 말. */
export interface QuestionPick {
  picked: number[];
  typed: string;
}

export const NO_PICK: QuestionPick = { picked: [], typed: "" };

/** 선택지를 누른다 — 하나만 고르는 물음은 그것 하나(직접 쓴 말은 지운다), 여럿 고르는 물음은 넣거나 뺀다. */
export function pickOption(question: AskedQuestion, pick: QuestionPick, at: number): QuestionPick {
  if (!question.multiSelect) return { picked: [at], typed: "" };
  const picked = pick.picked.includes(at) ? pick.picked.filter((one) => one !== at) : [...pick.picked, at].sort((a, b) => a - b);
  return { ...pick, picked };
}

/** 직접 쓴다 — 하나만 고르는 물음이면 고른 것을 푼다(쓴 말이 답이다). */
export function typeAnswer(question: AskedQuestion, pick: QuestionPick, typed: string): QuestionPick {
  return question.multiSelect ? { ...pick, typed } : { picked: [], typed };
}

/** 물음 하나의 답 글 — 아무것도 고르지도 쓰지도 않았으면 null이다. */
export function answerOf(question: AskedQuestion, pick: QuestionPick): string | null {
  const labels = pick.picked.flatMap((at) => (question.options[at] ? [question.options[at].label] : []));
  const typed = pick.typed.trim();
  const parts = typed === "" ? labels : [...labels, typed];
  return parts.length === 0 ? null : parts.join(", ");
}

/** 카드의 답 — 물음마다 하나. 답하지 않은 물음이 있으면 null이다(「답하기」가 서지 않는다). */
export function answersOf(questions: readonly AskedQuestion[], picks: readonly QuestionPick[]): QuestionAnswer[] | null {
  const answers: QuestionAnswer[] = [];
  for (const [at, question] of questions.entries()) {
    const answer = answerOf(question, picks[at] ?? NO_PICK);
    if (answer === null) return null;
    answers.push({ question: question.question, answer });
  }
  return answers;
}

/**
 * 키 하나의 고르기 — 숫자는 지금 물음의 그 번호 선택지, Enter는 「답하기」다. 카드 안 키라 단축키 표 밖이다(승인 카드와 같다 —
 * `cardKey`). 수식키가 붙으면 고르지 않는다. Esc는 고르지 않는다 — 「나중에」는 그 질문을 답 없이 닫는 일이라 키 하나로 하지 않는다.
 */
export function questionKey(press: CardPress, count: number): { pick: number } | { submit: true } | null {
  if (press.metaKey || press.ctrlKey || press.altKey || press.shiftKey) return null;
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(press.code);
  if (digit) {
    const at = Number(digit[1]) - 1;
    return at < count ? { pick: at } : null;
  }
  return press.code === "Enter" || press.code === "NumpadEnter" ? { submit: true } : null;
}

/** 「답함: 비율대로 돌려준다」 줄의 글(보드 「답한 뒤」) — 물음이 여럿이면 답을 「 · 」로 잇는다. 나중에면 그렇게 말한다. */
export function answeredText(entry: QuestionEntry): string {
  const said = saidOf(entry);
  return said === null ? "나중에 답하기로 함" : `답함: ${said}`;
}

/** 답한 줄에서 진하게 서는 답 — 「답함: 」 뒤의 글. 나중에면 null이다. */
export function saidOf(entry: QuestionEntry): string | null {
  return entry.choice === "answer" ? entry.answers.map((one) => one.answer).join(" · ") : null;
}
