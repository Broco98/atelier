import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { cn } from "@/lib/utils";
import { AgentFace } from "./AgentFace";
import { threadApi } from "./api";
import { ARMING_MS, KeyCap, SLOT_CARD } from "./ApprovalCard";
import type { AskTurn } from "./asks";
import { AskCount } from "./AskTurnMarks";
import type { Avatar } from "./faces";
import type { AskedQuestion, PendingQuestion } from "./fold";
import { answerOf, answersOf, NO_PICK, pickOption, questionKey, typeAnswer, type QuestionPick } from "./question";

// 질문 카드(v1 티켓 26 · 구현 스펙 §9 · 스토리 81 · 캔버스 Cards 보드 「Agent의 질문」) — Agent가 고를 답을 내밀며 물으면 승인 카드처럼
// **입력창 자리에** 선다(같은 자리 · 같은 물음 차례). 번호로 고르거나 직접 답하고, 「답하기」 · 「나중에」로 닫는다. 값은 순수 함수가
// 짓는다(`question.ts`).
//
// 겉은 입력창 자리 카드의 한 겉이다(`SLOT_CARD` — 02 §10 · 스토리 68: 25 · 1px 옅은 테두리 · 흰 면). 안은 v1 보드의 `.qcard`다 — 위 16 ·
// 옆 8 · 아래 8, 칸 사이 10. 머리는 얼굴 22와 물음(14/20 600) · 물음 아래 한 줄(12/18 `fg-tertiary`)이다. 선택지 줄은 승인 카드의 번호 줄과 같은 높이 36 · 반경 12에 라디오(여럿
// 고르기면 체크) 16과 글, 오른쪽 끝에 번호 글쇠이고, 고른 줄은 `fill-soft` 면이다. 「직접 답하기」 칸은 높이 38 · 머리카락 선,
// 맨 아래 줄은 「나중에」(흐린 버튼) · 「답하기」(주 버튼)다.
//
// - **물음이 여럿이면 차례로 쌓는다** — 첫 물음만 얼굴 옆에 서고, 다음 물음은 그 아래에 제 머리로 선다. 숫자 키는 지금 물음(마지막으로
//   손댄 물음, 처음엔 첫째)의 선택지를 고르고, 하나만 고르는 물음을 고르면 답하지 않은 다음 물음으로 넘어간다.
// - **Enter는 「답하기」다** — 모든 물음에 답했을 때만 간다. Esc는 고르지 않는다: 「나중에」는 그 질문을 답 없이 닫는 일이다.
// - 카드가 서면 포커스를 받는다 — 풀린 포커스만 받는다. 선 직후 잠깐(`ARMING_MS`)은 키를 받지 않는다(승인 카드와 같다).
// - 이 카드는 질문 답 명령을 부르기만 한다. 답 줄(`question` `answered`)이 오면 카드가 걷히고 그 자리에 답한 카드(✓ · 물은 것 · 고른 답
//   한 줄, 02 §10)가 선다.
// - 여럿이 물으면 머리 오른쪽의 「1 / 2」와 맨 아래 「다음 · …」 줄이 차례를 말한다(`AskTurnMarks`, v1 티켓 25).

interface QuestionCardProps {
  thread: string;
  /** 물은 참여자의 화면 이름 · 얼굴(들어옴 줄, `ThreadModel.cast`). */
  name: string;
  avatar: Avatar | null;
  /** 맨 앞의 답하지 않은 질문. 부르는 쪽이 요청 id를 key로 건다 — 다음 물음이 오면 카드가 새로 선다. */
  request: PendingQuestion;
  /** 물음 차례의 「1 / 2」(`askTurn`) — 묶음에 물음이 하나뿐이면 null. */
  count?: AskTurn["count"];
  /** 카드 맨 아래 「다음 · …」 줄(`AskNext`) — 다음 차례가 없으면 비운다. */
  next?: ReactNode;
}

function QuestionCard({ thread, name, avatar, request, count = null, next }: QuestionCardProps) {
  const cardId = useId();
  const card = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);
  const { questions } = request;
  const [picks, setPicks] = useState<QuestionPick[]>(() => questions.map(() => NO_PICK));
  const [active, setActive] = useState(0);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const answers = answersOf(questions, picks);

  useEffect(() => {
    shownAt.current = performance.now();
    const holder = document.activeElement;
    if (holder === null || holder === document.body) card.current?.focus({ preventScroll: true });
  }, []);

  const reply = (later: boolean) => {
    if (sent || (!later && answers === null)) return;
    setSent(true);
    setProblem(null);
    threadApi.answerQuestion(thread, request.who, request.requestId, later ? [] : (answers ?? []), later).catch((error: unknown) => {
      // 답하지 못했다 — 다시 고를 수 있게 풀고 까닭을 보인다(이미 닫힌 질문이면 곧 그 줄이 와서 카드가 걷힌다).
      setSent(false);
      setProblem(String(error));
    });
  };
  const change = (at: number, pick: QuestionPick) => setPicks((all) => all.map((one, index) => (index === at ? pick : one)));
  const choose = (at: number, option: number) => {
    const question = questions[at];
    if (!question || sent) return;
    const picked = pickOption(question, picks[at] ?? NO_PICK, option);
    change(at, picked);
    // 하나만 고르는 물음을 골랐다 — 답하지 않은 다음 물음으로 넘어간다. 여럿 고르는 물음은 그 자리에 남는다.
    const after = question.multiSelect
      ? -1
      : questions.findIndex((one, index) => index > at && answerOf(one, picks[index] ?? NO_PICK) === null);
    setActive(after < 0 ? at : after);
  };

  return (
    <div
      ref={card}
      role="group"
      aria-label={`${name}의 질문`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement || event.nativeEvent.isComposing || event.repeat) return;
        if (performance.now() - shownAt.current < ARMING_MS) return;
        const key = questionKey(event, questions[active]?.options.length ?? 0);
        if (!key) return;
        event.preventDefault();
        if ("submit" in key) reply(false);
        else choose(active, key.pick);
      }}
      className={cn("flex shrink-0 flex-col gap-2.5 px-2 pt-4 pb-2", SLOT_CARD)}
    >
      {questions.map((question, at) => (
        <Fragment key={`${at}-${question.question}`}>
          <Asked
            id={`${cardId}-${at}`}
            question={question}
            pick={picks[at] ?? NO_PICK}
            head={
              at === 0 ? (
                <>
                  <AgentFace handle={request.who} avatar={avatar} className="size-5.5 shrink-0" />
                  <QuestionHead id={`${cardId}-${at}`} question={question} />
                  <AskCount count={count} />
                </>
              ) : (
                <QuestionHead id={`${cardId}-${at}`} question={question} />
              )
            }
            disabled={sent}
            onFocus={() => setActive(at)}
            onPick={(option) => choose(at, option)}
            onType={(typed) => change(at, typeAnswer(question, picks[at] ?? NO_PICK, typed))}
            onSubmit={() => reply(false)}
            onLeave={() => card.current?.focus({ preventScroll: true })}
          />
        </Fragment>
      ))}
      <div className="flex items-center gap-2 px-2 pt-0.5">
        <span className="flex-1" />
        <Button variant="ghost" disabled={sent} onClick={() => reply(true)}>
          나중에
        </Button>
        <Button disabled={sent || answers === null} onClick={() => reply(false)}>
          답하기
        </Button>
      </div>
      {problem && (
        <p role="alert" className="px-3 text-xs text-fg-secondary">
          {problem}
        </p>
      )}
      {next}
    </div>
  );
}

/** 물음의 머리 — 물음(14/20 600)과 그 아래 한 줄(12/18 `fg-tertiary`). */
function QuestionHead({ id, question }: { id: string; question: AskedQuestion }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <p id={id} className="break-keep text-sm font-semibold text-fg">
        {question.question}
      </p>
      {question.description && <p className="text-xs text-fg-tertiary">{question.description}</p>}
    </div>
  );
}

/** 물음 하나 — 머리 · 선택지 줄들 · 「직접 답하기」 칸. 선택지는 하나만 고르면 라디오, 여럿 고르면 체크다. */
function Asked({
  id,
  question,
  pick,
  head,
  disabled,
  onFocus,
  onPick,
  onType,
  onSubmit,
  onLeave,
}: {
  id: string;
  question: AskedQuestion;
  pick: QuestionPick;
  head: ReactNode;
  disabled: boolean;
  onFocus: () => void;
  onPick: (option: number) => void;
  onType: (typed: string) => void;
  onSubmit: () => void;
  onLeave: () => void;
}) {
  const multi = question.multiSelect;
  return (
    <div onFocus={onFocus} className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2.5 px-2.5">{head}</div>
      {question.options.length > 0 && (
        <div role={multi ? "group" : "radiogroup"} aria-labelledby={id} className="flex flex-col gap-0.5">
          {question.options.map((option, at) => {
            const on = pick.picked.includes(at);
            return (
              <button
                key={`${at}-${option.label}`}
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={on}
                disabled={disabled}
                onClick={() => onPick(at)}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-sm text-fg transition-colors hover:bg-fill-hover focus-ring disabled:opacity-60",
                  on && "bg-fill-soft",
                )}
              >
                <Mark multi={multi} on={on} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="wrap-anywhere">{option.label}</span>
                  {option.description && <span className="text-xs text-fg-tertiary wrap-anywhere">{option.description}</span>}
                </span>
                {at < 9 && <KeyCap>{String(at + 1)}</KeyCap>}
              </button>
            );
          })}
        </div>
      )}
      <input
        value={pick.typed}
        disabled={disabled}
        aria-label={`${question.question} — 직접 답하기`}
        placeholder="직접 답하기"
        onChange={(event) => onType(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onLeave();
          }
        }}
        className="mx-2 h-9.5 min-w-0 rounded-xl bg-transparent pr-1.5 pl-3.5 text-sm text-fg shadow-hairline outline-none placeholder:text-fg-tertiary focus-ring"
      />
    </div>
  );
}

/** 선택지 줄 앞의 표지(보드 `.radio` · `.chk`) — 16, 꺼짐은 1.5 선 `fg-tertiary`, 켜짐은 라디오면 굵은 파랑 테, 체크면 파랑 면에 흰 ✓. */
function Mark({ multi, on }: { multi: boolean; on: boolean }) {
  if (!multi) {
    return (
      <span
        aria-hidden
        className={cn("size-4 shrink-0 rounded-full", on ? "inset-ring-[5px] inset-ring-accent-solid" : "inset-ring-[1.5px] inset-ring-fg-tertiary")}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-on-solid",
        on ? "bg-accent-solid" : "inset-ring-[1.5px] inset-ring-fg-tertiary",
      )}
    >
      {on && <Check className="size-3" strokeWidth={SMALL_GLYPH_STROKE} />}
    </span>
  );
}

export default QuestionCard;
