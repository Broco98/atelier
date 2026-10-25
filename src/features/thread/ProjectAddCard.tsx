import type { ReactNode } from "react";
import { threadApi } from "./api";
import type { AskTurn } from "./asks";
import type { Avatar } from "./faces";
import type { PendingProjectAdd } from "./fold";
import { describeProjectAddCard } from "./project-add-card";
import ToolQuestionCard from "./ToolQuestionCard";

// Project 추가 카드(03 티켓 12 · 구현 스펙 §12 · 캔버스 F4-KitChat 「git이 아닌 폴더를 부탁받음」) — Host가 「Project 추가」 Thread 도구로 등록하려는
// 폴더가 git 저장소가 아니거나 저장소 안의 하위 폴더면 입력창 자리에 선다. 겉과 키는 Thread 도구 질문 카드(`ToolQuestionCard`)이고, 글은
// `describeProjectAddCard`가 짓는다. 「나중에」는 없다 — esc가 「추가하지 않기」다. 고른 것을 답 명령으로 넘기기만 한다 — 추가한 것은 기록의
// 답 줄 뒤에 결과 카드로 따라온다.

interface ProjectAddCardProps {
  thread: string;
  /** 물은 참여자의 화면 이름 · 얼굴(들어옴 줄, `ThreadModel.cast`). */
  name: string;
  avatar: Avatar | null;
  /** 맨 앞의 답하지 않은 카드. 부르는 쪽이 요청 id를 key로 건다 — 다음 카드가 오면 새로 선다. */
  card: PendingProjectAdd;
  count?: AskTurn["count"];
  next?: ReactNode;
}

function ProjectAddCard({ thread, name, avatar, card, count = null, next }: ProjectAddCardProps) {
  const view = describeProjectAddCard(card, name);
  return (
    <ToolQuestionCard
      who={card.who}
      avatar={avatar}
      view={view}
      onPick={(at) => threadApi.answerProjectAdd(thread, card.requestId, view.options[at].answer)}
      count={count}
      next={next}
    />
  );
}

export default ProjectAddCard;
