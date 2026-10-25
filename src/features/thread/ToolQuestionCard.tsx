import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AgentFace } from "./AgentFace";
import { ARMING_MS, ChoiceButton, SLOT_CARD } from "./ApprovalCard";
import type { AskTurn } from "./asks";
import { AskCount } from "./AskTurnMarks";
import type { Avatar } from "./faces";
import { toolQuestionKey, type ToolQuestionView } from "./tool-question";

// Thread 도구 질문 카드(03 티켓 08 · 구현 스펙 §11 S12 · 캔버스 F4-WorkAsk · F4-KitChat 「질문 카드」) — Thread 도구가 「카드를 세우고 기다리는
// 길」로 사람에게 묻는 질문이 **입력창 자리에** 선다(승인 카드와 같은 자리 · 같은 물음 차례 — `askTurn`). 따로 그린 카드가 아니라 질문
// 카드의 부품이다 — 겉은 입력창 자리 카드의 한 겉(`SLOT_CARD`), 머리는 얼굴 16과 「Host · 질문」(13 `fg-secondary`), 물음(14/20 500)과 그
// 아래 한 줄(12 `fg-tertiary`), 번호 줄(높이 32 · r12 · 켜진 줄 `fill-soft` — 앞에 번호 글쇠, 이름 뒤 파란 「추천」 표, 아래 줄 12
// `fg-tertiary`), 맨 아래 「↑↓ 고르기 · esc 닫기」와 오른쪽 「나중에」 · 검은 「고르기 ↵」(승인 카드의 28 알약 단추). 캔버스 `.qc`는 위 16 ·
// 옆 16 · 아래 12, 칸 사이 10이다. 값은 카드 종류의 순수 함수가 짓는다(`tool-question.ts`).
//
// - **키보드로 고른다** — 숫자는 그 줄을 고르고, ↵는 켜진 줄(처음엔 추천)을, ↑↓는 켜진 줄을 옮기며, esc는 「나중에」다
//   (`toolQuestionKey`). 줄을 누르면 그 줄을 고른다. 선 직후 잠깐은 키를 받지 않는다. 서면 풀린 포커스만 받는다(승인 카드와 같다).
// - **「나중에」가 없는 카드도 있다** — Project 추가 카드(03 티켓 12)는 미룰 것이 없어 바닥에 「고르기 ↵」만 서고(캔버스 F4-KitChat 「git이 아닌
//   폴더를 부탁받음」), esc는 마지막 줄(「추가하지 않기」)을 고른다.
// - 이 카드는 답을 넘기기만 한다(`onPick` · `onLater`). 고른 것은 기록의 답 줄로 오고, 그 줄이 오면 접기가 이 카드를 빼서 카드가 걷히고 그
//   도구 줄 자리에 접힌 줄이 선다. 해내지 못하면(엔진이 거절) 까닭을 보이고 다시 고를 수 있게 푼다 — 엔진도 카드를 그대로 세워 둔다.

interface ToolQuestionCardProps {
  /** 물은 참여자의 handle · 얼굴(들어옴 줄, `ThreadModel.cast`). */
  who: string;
  avatar: Avatar | null;
  view: ToolQuestionView;
  /** 그 번호 줄을 골랐다 — 실패하면 그 까닭으로 거절한다. */
  onPick: (at: number) => Promise<unknown>;
  /** 「나중에」(esc). 없으면 「나중에」 단추가 서지 않고 esc가 마지막 줄을 고른다. */
  onLater?: () => Promise<unknown>;
  /** 물음 차례의 「1 / 2」(`askTurn`) — 묶음에 물음이 하나뿐이면 null. */
  count?: AskTurn["count"];
  /** 카드 맨 아래 「다음 · …」 줄(`AskNext`) — 다음 차례가 없으면 비운다. */
  next?: ReactNode;
}

function ToolQuestionCard({ who, avatar, view, onPick, onLater, count = null, next }: ToolQuestionCardProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);
  const [active, setActive] = useState(view.start);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    shownAt.current = performance.now();
    const holder = document.activeElement;
    if (holder === null || holder === document.body) box.current?.focus({ preventScroll: true });
  }, []);

  const send = (answer: () => Promise<unknown>) => {
    if (sent) return;
    setSent(true);
    setProblem(null);
    answer().catch((error: unknown) => {
      // 답하지 못했다 — 다시 고를 수 있게 풀고 까닭을 보인다(이미 닫힌 카드면 곧 그 줄이 와서 카드가 걷힌다).
      setSent(false);
      setProblem(String(error));
    });
  };
  const choose = (at: number) => {
    if (!view.options[at]) return;
    setActive(at);
    send(() => onPick(at));
  };

  return (
    <div
      ref={box}
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.repeat) return;
        if (performance.now() - shownAt.current < ARMING_MS) return;
        const key = toolQuestionKey(event, view.options.length, active);
        if (!key) return;
        event.preventDefault();
        if ("point" in key) setActive(key.point);
        else if ("later" in key) {
          if (onLater) send(onLater);
          else choose(view.options.length - 1);
        } else choose(key.pick);
      }}
      className={cn("flex shrink-0 flex-col gap-2.5 px-4 pt-4 pb-3", SLOT_CARD)}
    >
      <div className="flex items-center gap-1.5 text-chat-meta leading-5 text-fg-secondary">
        <AgentFace handle={who} avatar={avatar} className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{view.head}</span>
        <AskCount count={count} />
      </div>
      <div className="flex flex-col gap-1">
        <p id={titleId} className="text-sm font-medium break-keep text-fg">
          {view.title}
        </p>
        {view.sub && <p className="text-xs text-fg-tertiary">{view.sub}</p>}
      </div>
      <div className="flex flex-col gap-0.5">
        {view.options.map((option, at) => (
          <button
            key={`${at}-${option.label}`}
            type="button"
            disabled={sent}
            onClick={() => choose(at)}
            onFocus={() => setActive(at)}
            aria-current={at === active ? "true" : undefined}
            className={cn(
              "flex min-h-8 w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left text-chat-meta text-fg transition-colors hover:bg-fill-hover focus-ring disabled:opacity-60",
              at === active && "bg-fill-soft",
            )}
          >
            <span aria-hidden className="flex h-4.5 shrink-0 items-center">
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-fill-hover px-1 text-xs leading-4">
                {at + 1}
              </span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="wrap-anywhere">
                {option.label}
                {option.badge && (
                  <span className="ml-1.5 inline-flex h-4 items-center rounded-md bg-mine-soft px-1.5 text-2xs font-medium tracking-normal text-mine">
                    {option.badge}
                  </span>
                )}
              </span>
              {option.note && <span className="text-xs leading-4 text-fg-tertiary wrap-anywhere">{option.note}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-xs text-fg-tertiary">
          ↑↓ 고르기 · esc 닫기
        </span>
        <div className="ml-auto flex items-center gap-2">
          {onLater && (
            <ChoiceButton
              choice={{ option: "later", label: "나중에", remember: false, opensField: false, key: null }}
              at={view.options.length}
              pressed={false}
              disabled={sent}
              onPick={() => send(onLater)}
            />
          )}
          <ChoiceButton
            choice={{ option: "pick", label: "고르기", remember: false, opensField: false, key: "enter" }}
            at={active}
            pressed={false}
            disabled={sent}
            onPick={() => choose(active)}
          />
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-fg-secondary">
          {problem}
        </p>
      )}
      {next}
    </div>
  );
}

export default ToolQuestionCard;
