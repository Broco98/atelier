import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, CircleQuestionMark } from "lucide-react";
import { threadApi } from "./api";
import { useSlotCard } from "./ApprovalCard";
import { ASK_CARD, ASK_WHY, AskActs, AskButton, AskGrow, AskKind, AskTitle, AskTop } from "./AskCard";
import type { AskTurn } from "./asks";
import { AskCount } from "./AskTurnMarks";
import type { AskedQuestion, PendingQuestion } from "./fold";
import { answersAtOnce, answersOf, answerOf, NO_PICK, pickOption, questionKey, typeAnswer, type QuestionPick } from "./question";

// 질문 카드(v1 티켓 26 · restart 02b-5 · 시안 Cards 보드 「질문」) — Runtime이 고를 답을 내밀며 물으면 승인 카드처럼 **입력창 자리에** 선다(같은 자리 ·
// 같은 물음 차례). 겉은 승인 카드와 같은 한 겉(`AskCard` — 보드 `.ra-ask`)이고, 위 칸은 「질문」 · 물음(14 / 20 · 500) · 물음 아래 한 줄, 아래 줄은 선택지
// 알약(`.ra-opt`) · 빈칸 · 「나중에」 · 「직접 쓰기」(`.ra-no`)다. 값은 순수 함수가 짓는다(`question.ts`).
//
// - **물음 하나에 하나만 고르면 고르는 것이 곧 답이다**(`answersAtOnce` — 보드에 「답하기」가 없다). 숫자 키도 그 선택지로 답한다. 선택지의 설명은 알약에
//   마우스를 올리면 선다(`title`) — 보드의 알약에는 설명 자리가 없다.
// - **여럿 고르는 물음 · 물음이 여럿이면** 물음마다 알약 줄이 쌓이고(고른 알약은 `fill-selected`), 맨 아래 「답하기 ↵」로 보낸다 — 모든 물음에 답했을 때만
//   간다. 숫자 키는 지금 물음(마지막으로 손댄 물음, 처음엔 첫째)의 선택지를 고르고, 하나만 고르는 물음을 고르면 답하지 않은 다음 물음으로 넘어간다.
// - **「직접 쓰기」는 카드 안에 입력칸을 연다** — 물음 하나면 Enter가 그 말로 답하고, 여럿이면 그 물음의 답이 된다. 칸의 Esc는 칸을 닫고 카드로 돌아간다.
// - **「나중에」**는 그 질문을 답 없이 닫는다 — 보드에 없지만 카드가 입력창 자리를 가려 사람이 질문을 비켜 갈 길이 이것뿐이다. Esc는 고르지 않는다.
// - 카드가 서면 포커스를 받는다 — 풀린 포커스만 받는다. 선 직후 잠깐(`ARMING_MS`)은 키를 받지 않는다(승인 카드와 같다).
// - 이 카드는 질문 답 명령을 부르기만 한다. 답 줄(`question` `answered`)이 오면 카드가 걷히고 그 자리에 답한 카드(✓ · 물은 것 · 고른 답 한 줄, 02 §10)가 선다.
// - 여럿이 물으면 갈래 줄 오른쪽의 「1 / 2」와 맨 아래 「다음 · …」 줄이 차례를 말한다(`AskTurnMarks`, v1 티켓 25).

interface QuestionCardProps {
  thread: string;
  /** 그 채팅의 Runtime 이름(`runtimeNameOf`) — 카드의 이름에 선다. */
  name: string;
  /** 맨 앞의 답하지 않은 질문. 부르는 쪽이 요청 id를 key로 건다 — 다음 물음이 오면 카드가 새로 선다. */
  request: PendingQuestion;
  /** 물음 차례의 「1 / 2」(`askTurn`) — 묶음에 물음이 하나뿐이면 null. */
  count?: AskTurn["count"];
  /** 카드 맨 아래 「다음 · …」 줄(`AskNext`) — 다음 차례가 없으면 비운다. */
  next?: ReactNode;
}

function QuestionCard({ thread, name, request, count = null, next }: QuestionCardProps) {
  const cardId = useId();
  const { box: card, armed, sent, problem, send } = useSlotCard();
  const field = useRef<HTMLInputElement>(null);
  const { questions } = request;
  const atOnce = answersAtOnce(questions);
  const [picks, setPicks] = useState<QuestionPick[]>(() => questions.map(() => NO_PICK));
  const [active, setActive] = useState(0);
  // 「직접 쓰기」로 칸을 연 물음 — 없으면 null이다.
  const [writing, setWriting] = useState<number | null>(null);
  const answers = answersOf(questions, picks);

  useLayoutEffect(() => {
    if (writing !== null) field.current?.focus();
  }, [writing]);

  const submit = (all: ReturnType<typeof answersOf>) => {
    if (all === null) return;
    send(() => threadApi.answerQuestion(thread, request.requestId, all, false));
  };
  const later = () => send(() => threadApi.answerQuestion(thread, request.requestId, [], true));
  const change = (at: number, pick: QuestionPick) => setPicks((all) => all.map((one, index) => (index === at ? pick : one)));
  const choose = (at: number, option: number) => {
    const question = questions[at];
    if (!question || sent) return;
    const picked = pickOption(question, picks[at] ?? NO_PICK, option);
    // 물음 하나에 하나만 고르면 고르는 것이 곧 답이다.
    if (atOnce) {
      submit(answersOf(questions, [picked]));
      return;
    }
    change(at, picked);
    // 하나만 고르는 물음을 골랐다 — 답하지 않은 다음 물음으로 넘어간다. 여럿 고르는 물음은 그 자리에 남는다.
    const after = question.multiSelect
      ? -1
      : questions.findIndex((one, index) => index > at && answerOf(one, picks[index] ?? NO_PICK) === null);
    setActive(after < 0 ? at : after);
  };
  const leave = () => {
    setWriting(null);
    card.current?.focus({ preventScroll: true });
  };

  return (
    <div
      ref={card}
      role="group"
      aria-label={`${name}의 질문`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || event.nativeEvent.isComposing || event.repeat) return;
        if (!armed()) return;
        const key = questionKey(event, questions[active]?.options.length ?? 0);
        if (!key) return;
        if ("submit" in key && atOnce) return;
        event.preventDefault();
        if ("submit" in key) submit(answers);
        else choose(active, key.pick);
      }}
      className={ASK_CARD}
    >
      {questions.map((question, at) => {
        const id = `${cardId}-${at}`;
        const pick = picks[at] ?? NO_PICK;
        const top = (
          <AskTop>
            {at === 0 && <AskKind icon={CircleQuestionMark} label="질문" aside={<AskCount count={count} />} />}
            <AskTitle id={id}>{question.question}</AskTitle>
            {question.description && <p className={ASK_WHY}>{question.description}</p>}
          </AskTop>
        );
        const typed = writing === at && <div className="px-4 pb-2">{typeField(question, at)}</div>;
        if (atOnce) {
          return (
            <Fragment key={`${at}-${question.question}`}>
              {top}
              {typed}
              <AskActs>
                {question.options.map((option, index) => (
                  <AskButton
                    key={`${index}-${option.label}`}
                    tone="opt"
                    title={option.description ?? undefined}
                    disabled={sent}
                    onClick={() => choose(at, index)}
                  >
                    {option.label}
                  </AskButton>
                ))}
                <AskGrow />
                <AskButton tone="quiet" disabled={sent} onClick={later}>
                  나중에
                </AskButton>
                <AskButton tone="no" aria-pressed={writing === at} disabled={sent} onClick={() => setWriting(at)} className="aria-pressed:bg-fill-hover">
                  직접 쓰기
                </AskButton>
              </AskActs>
            </Fragment>
          );
        }
        const multi = question.multiSelect;
        return (
          <Fragment key={`${at}-${question.question}`}>
            {top}
            <div
              role={multi ? "group" : "radiogroup"}
              aria-labelledby={id}
              onFocus={() => setActive(at)}
              className="flex flex-wrap items-center gap-2 px-3 pb-2.5"
            >
              {question.options.map((option, index) => (
                <AskButton
                  key={`${index}-${option.label}`}
                  tone="opt"
                  role={multi ? "checkbox" : "radio"}
                  aria-checked={pick.picked.includes(index)}
                  title={option.description ?? undefined}
                  disabled={sent}
                  onClick={() => choose(at, index)}
                  className="aria-checked:bg-fill-selected"
                >
                  {option.label}
                </AskButton>
              ))}
              <AskButton
                tone="opt"
                aria-pressed={writing === at || pick.typed.trim() !== ""}
                disabled={sent}
                onClick={() => setWriting(at)}
                className="aria-pressed:bg-fill-selected"
              >
                직접 쓰기
              </AskButton>
            </div>
            {typed}
          </Fragment>
        );
      })}
      {!atOnce && (
        <AskActs>
          <AskGrow />
          <AskButton tone="quiet" disabled={sent} onClick={later}>
            나중에
          </AskButton>
          <AskButton tone="yes" keycap="↵" disabled={sent || answers === null} onClick={() => submit(answers)}>
            답하기
          </AskButton>
        </AskActs>
      )}
      {problem && (
        <p role="alert" className="px-4 pb-3 text-xs text-fg-secondary">
          {problem}
        </p>
      )}
      {next && <div className="px-3 pb-2">{next}</div>}
    </div>
  );

  /** 「직접 쓰기」가 연 칸 — 물음 하나면 Enter가 그 말로 답하고, 여럿이면 그 물음의 답이 된다. 칸의 Esc는 칸만 닫는다. */
  function typeField(question: AskedQuestion, at: number) {
    const pick = picks[at] ?? NO_PICK;
    const done = () => {
      if (atOnce) submit(answersOf(questions, [typeAnswer(question, pick, pick.typed)]));
      else leave();
    };
    return (
      <div className="flex h-10 items-center gap-2 rounded-xl pr-1.5 pl-3.5 inset-ring inset-ring-border-heavy">
        <input
          ref={field}
          value={pick.typed}
          disabled={sent}
          aria-label={`${question.question} — 직접 쓰기`}
          placeholder="직접 쓰기"
          onChange={(event) => change(at, typeAnswer(question, pick, event.target.value))}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              done();
            } else if (event.key === "Escape") {
              event.preventDefault();
              leave();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm leading-5.5 text-fg outline-none placeholder:text-fg-tertiary"
        />
        <button
          type="button"
          tabIndex={0}
          aria-label={atOnce ? "보내기" : "적기"}
          disabled={sent || pick.typed.trim() === ""}
          onClick={done}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fg text-fg-inverse focus-ring disabled:opacity-40"
        >
          <ArrowUp className="size-3.5" aria-hidden />
        </button>
      </div>
    );
  }
}

export default QuestionCard;
