import type { ComponentType, ReactNode } from "react";
import { ArrowRight, Check, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnsweredCards } from "./AnsweredCards";
import { threadApi } from "./api";
import { useArrival } from "./arrival";
import type { AskTurn } from "./asks";
import type { Avatar } from "./faces";
import type { ProjectAddChoiceEntry, ProjectChoiceEntry, SpaceChoiceEntry, WorkChoiceEntry } from "./fold";
import { describeProjectAddCard, projectAddChoiceCard } from "./project-add-card";
import { projectChoiceText } from "./project-card";
import ProjectCard from "./ProjectCard";
import { describeSpaceCard, spaceChoiceCard } from "./space-card";
import { cardOfChoice, type ToolCard, type ToolCardAsk, type ToolCardShapes, type ToolChoiceEntry } from "./tool-cards";
import type { ToolQuestionOption, ToolQuestionView } from "./tool-question";
import ToolQuestionCard from "./ToolQuestionCard";
import WorkProposalCard from "./WorkProposalCard";

// Thread 도구 카드의 그리는 쪽 표(03 코드 리뷰 D2) — 갈래마다 **한 줄**이다: 입력창 자리에 서는 카드(`Card` — 승인 카드와 같은 자리 · 같은 물음
// 차례, `askTurn`)와, 답한 뒤 그 도구 줄 자리에 서는 결정 줄(`Row` — 접힌 턴에도 남는다). Thread 화면(`ThreadScreen`)은 `ToolCardSlot`, 흐름
// (`ThreadFlow`)은 `ToolChoiceRow` 하나로 그린다. 값 · 글의 표는 `tool-cards.ts`다.
//
// - **카드는 답을 넘기기만 한다.** 고른 것은 기록의 답 줄로 오고, 그 줄이 오면 접기가 카드를 빼서 카드가 걷히고 그 도구 줄 자리에 결정 줄이 선다.
// - **Thread 도구 질문 카드**(Space 질문 · Project 추가 — 03 티켓 08 · 12)는 겉과 키가 하나다(`ToolQuestionCard`). 글은 그 갈래의 순수 함수
//   (`describe…Card`)가 짓고, 고른 번호 줄의 답을 그 갈래의 답 명령으로 넘긴다(`ToolQuestionSlot`). Space 질문 카드는 esc · 「나중에」가 「나중에」,
//   Project 추가 카드는 「나중에」가 없어 esc가 마지막 줄 「추가하지 않기」다(03 결정 12). 붙인 Space는 칩 · 범위 줄 · 머리 줄이, 추가한 Project는
//   결과 카드가 기록의 답 줄 뒤에 따라온다.

/** 입력창 자리의 Thread 도구 카드가 받는 것. */
export interface ToolCardProps<A> {
  thread: string;
  /** 물은 참여자의 화면 이름 · 얼굴(들어옴 줄, `ThreadModel.cast`). */
  name: string;
  avatar: Avatar | null;
  /** 맨 앞의 답하지 않은 카드. 부르는 쪽이 요청 id를 key로 건다 — 다음 카드가 오면 새로 선다. */
  card: A;
  /** 물음 차례의 「1 / 2」(`askTurn`) — 묶음에 물음이 하나뿐이면 null. */
  count?: AskTurn["count"];
  /** 카드 맨 아래 「다음 · …」 줄(`AskNext`) — 다음 차례가 없으면 비운다. */
  next?: ReactNode;
}

/** 표의 한 줄 — 그 갈래의 카드와 결정 줄. */
interface ToolCardScreen<C extends ToolCard> {
  Card: ComponentType<ToolCardProps<ToolCardShapes[C]["ask"]>>;
  Row: ComponentType<{ entry: ToolCardShapes[C]["choice"] }>;
}

const SCREENS: { readonly [C in ToolCard]: ToolCardScreen<C> } = {
  work: { Card: WorkProposalCard, Row: WorkChoiceRow },
  project: { Card: ProjectCard, Row: ProjectChoiceRow },
  space: {
    Card: (props) => (
      <ToolQuestionSlot
        {...props}
        describe={describeSpaceCard}
        answer={threadApi.answerSpace}
        later={(thread, request) => threadApi.answerSpace(thread, request, { kind: "later" })}
      />
    ),
    Row: SpaceChoiceRow,
  },
  "project-add": {
    Card: (props) => <ToolQuestionSlot {...props} describe={describeProjectAddCard} answer={threadApi.answerProjectAdd} />,
    Row: ProjectAddChoiceRow,
  },
};

/** 입력창 자리의 Thread 도구 카드 — 그 갈래의 카드다. */
export function ToolCardSlot(props: ToolCardProps<ToolCardAsk>) {
  return slotOf(props.card.card, props);
}

function slotOf<C extends ToolCard>(card: C, props: ToolCardProps<ToolCardShapes[C]["ask"]>) {
  const { Card } = SCREENS[card];
  return <Card {...props} />;
}

/** 흐름의 결정 줄 — 그 카드 갈래의 줄이다. */
export function ToolChoiceRow({ entry }: { entry: ToolChoiceEntry }) {
  const card = cardOfChoice(entry);
  return card && rowOf(card, entry);
}

function rowOf<C extends ToolCard>(card: C, entry: ToolCardShapes[C]["choice"]) {
  const { Row } = SCREENS[card];
  return <Row entry={entry} />;
}

/** 답 하나를 실은 번호 줄의 카드 값 — 갈래의 순수 함수(`describe…Card`)가 짓는다. */
type AnsweringView<T> = ToolQuestionView & { options: (ToolQuestionOption & { answer: T })[] };

/** Thread 도구 질문 카드 하나 — 갈래의 글(`describe`)을 그리고, 고른 번호 줄의 답 · 「나중에」를 그 갈래의 답 명령으로 넘긴다. */
function ToolQuestionSlot<A extends ToolCardAsk, T>({
  thread,
  name,
  avatar,
  card,
  count = null,
  next,
  describe,
  answer,
  later,
}: ToolCardProps<A> & {
  describe: (card: A, asker: string) => AnsweringView<T>;
  answer: (thread: string, request: string, answer: T) => Promise<unknown>;
  /** 「나중에」(esc)의 답 — 없으면 「나중에」 단추가 서지 않고 esc가 마지막 줄을 고른다. */
  later?: (thread: string, request: string) => Promise<unknown>;
}) {
  const view = describe(card, name);
  return (
    <ToolQuestionCard
      who={card.who}
      avatar={avatar}
      view={view}
      onPick={(at) => answer(thread, card.requestId, view.options[at].answer)}
      onLater={later && (() => later(thread, card.requestId))}
      count={count}
      next={next}
    />
  );
}

/**
 * Work 만들기 결정 줄(화면 2 보드 `.done-line` · Cards 보드 「결정한 뒤」 `.done`) — 승인 결정 줄과 같은 모양이다. 만들었으면 ✓와 「Work
 * 만들기 · api-server · fix/refund-api」, 아니면 →와 「Work 없이 계속함」.
 */
function WorkChoiceRow({ entry }: { entry: WorkChoiceEntry }) {
  const Icon = entry.created ? Check : ArrowRight;
  const text = entry.created
    ? ["Work 만들기", ...entry.projects, ...(entry.branch ? [entry.branch] : [])].join(" · ")
    : "Work 없이 계속함";
  return (
    <p
      data-decision={entry.created ? "work-created" : "work-skipped"}
      className={cn("flex min-h-7 flex-wrap items-center gap-2 text-chat-meta leading-5 text-fg-tertiary", useArrival("chip-in", entry.key))}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 wrap-anywhere">{text}</span>
    </p>
  );
}

/**
 * Work 밖 Project 결정 줄(v1 티켓 32 · Cards 보드 「결정한 뒤」 `.done`) — 승인 결정 줄과 같은 모양에 폴더 글리프, Project 이름은
 * `fg-secondary`(보드 `.o`)다. 「web-app을 이 Work에 붙임」 · 「web-app을 읽기만 하기로 함」 · 「web-app을 고치지 않기로 함」.
 */
function ProjectChoiceRow({ entry }: { entry: ProjectChoiceEntry }) {
  const { name, after } = projectChoiceText(entry.choice, entry.project);
  return (
    <p
      data-decision={`project-${entry.choice}`}
      className={cn("flex min-h-7 flex-wrap items-center gap-2 text-chat-meta leading-5 text-fg-tertiary", useArrival("chip-in", entry.key))}
    >
      <Folder className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 wrap-anywhere">
        <span className="text-fg-secondary">{name}</span>
        {after}
      </span>
    </p>
  );
}

/**
 * Space 질문 카드에 답한 줄(03 티켓 08 · 캔버스 F4-WorkSpaced · F4-KitChat 「답한 뒤」) — 질문 카드에 답한 카드와 같은 한 줄이다: ✓ ·
 * 「어느 Space에서 할까요?」 · 고른 Space(「Space 없이」), 나중에면 시계와 「Space는 나중에 정하기로 함」. Space 줄은 따로 서지 않는다 — 이
 * 줄이 그 결정이다(`spaceChoiceCard`).
 */
function SpaceChoiceRow({ entry }: { entry: SpaceChoiceEntry }) {
  return <AnsweredCards cards={[spaceChoiceCard(entry)]} card="space" choice={entry.choice} arrival={entry.key} />;
}

/**
 * Project 추가 카드에 답한 줄(03 티켓 12) — Space 질문 카드에 답한 줄과 같은 한 줄이다: ✓ · 「notes는 git 저장소가 아니에요. 어떻게 할까요?」 ·
 * 고른 답(「git init 하고 추가」). 추가했으면 바로 뒤에 결과 카드가 따로 선다(`projectAddChoiceCard`).
 */
function ProjectAddChoiceRow({ entry }: { entry: ProjectAddChoiceEntry }) {
  return <AnsweredCards cards={[projectAddChoiceCard(entry)]} card="project-add" choice={entry.choice} arrival={entry.key} />;
}
