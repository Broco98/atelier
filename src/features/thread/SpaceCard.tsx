import type { ReactNode } from "react";
import { threadApi } from "./api";
import type { AskTurn } from "./asks";
import type { Avatar } from "./faces";
import type { PendingSpace } from "./fold";
import { describeSpaceCard } from "./space-card";
import ToolQuestionCard from "./ToolQuestionCard";

// Space 질문 카드(03 티켓 08 · 구현 스펙 §11 S12 · 캔버스 F4-WorkAsk) — Host가 「Space 붙이기」 Thread 도구를 불렀고 Atelier가 사람에게
// 묻기로 했으면 입력창 자리에 선다. 겉과 키는 Thread 도구 질문 카드(`ToolQuestionCard`)이고, 글은 `describeSpaceCard`가 짓는다. 고른 Space ·
// 「Space 없이」 · 「나중에」(esc)를 답 명령으로 넘기기만 한다 — 붙인 것은 칩 · 범위 줄 · 머리 줄이 기록의 답 줄 뒤에 따라온다.

interface SpaceCardProps {
  thread: string;
  /** 물은 참여자의 화면 이름 · 얼굴(들어옴 줄, `ThreadModel.cast`). */
  name: string;
  avatar: Avatar | null;
  /** 맨 앞의 답하지 않은 카드. 부르는 쪽이 요청 id를 key로 건다 — 다음 카드가 오면 새로 선다. */
  card: PendingSpace;
  count?: AskTurn["count"];
  next?: ReactNode;
}

function SpaceCard({ thread, name, avatar, card, count = null, next }: SpaceCardProps) {
  const view = describeSpaceCard(card, name);
  return (
    <ToolQuestionCard
      who={card.who}
      avatar={avatar}
      view={view}
      onPick={(at) => threadApi.answerSpace(thread, card.requestId, view.options[at].answer)}
      onLater={() => threadApi.answerSpace(thread, card.requestId, { kind: "later" })}
      count={count}
      next={next}
    />
  );
}

export default SpaceCard;
