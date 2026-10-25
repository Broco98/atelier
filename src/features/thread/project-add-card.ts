import { particle } from "@/lib/particle";
import { type PendingProjectAdd, type ProjectAddChoiceEntry } from "./fold";
import type { AnsweredCard } from "./question";
import type { ToolQuestionOption, ToolQuestionView } from "./tool-question";
import type { ProjectAddAnswer } from "./types";

// Project 추가 카드의 값(03 티켓 12 · 구현 스펙 §12 · 캔버스 F4-KitChat 「git이 아닌 폴더를 부탁받음」) — Host가 「Project 추가」 Thread 도구로
// 등록하려는 폴더가 git 저장소가 아니거나 저장소 안의 하위 폴더면, 화면 추가 창과 같은 물음을 입력창 자리의 질문 카드로 묻는다. 물음 ·
// 선택지 · 접힌 줄의 글을 짓는 **순수 함수**다 — 겉과 키는 Thread 도구 질문 카드 하나다(`tool-question.ts` · `ToolQuestionCard`).
//
// - git이 아닌 폴더 — 「git init 하고 추가」(추천) · 「추가하지 않기」.
// - 하위 폴더 — 「뿌리 폴더로 추가」(추천) · 「그대로 추가」 · 「추가하지 않기」. 아래 줄이 추가될 경로다.
// - 「나중에」는 없다 — 미루면 Host가 할 일이 없다. esc가 마지막 줄 「추가하지 않기」다.

/** 선택지 한 줄 — 고르면 가는 답과 번호 줄. */
export interface ProjectAddOption extends ToolQuestionOption {
  answer: ProjectAddAnswer;
}

/** 카드의 값 — 머리(「Host · 질문」) · 물음 · 선택지와 처음 켜진 줄(추천). */
export interface ProjectAddCardView extends ToolQuestionView {
  options: ProjectAddOption[];
}

const LABELS: Record<ProjectAddAnswer, string> = {
  init: "git init 하고 추가",
  root: "뿌리 폴더로 추가",
  "as-is": "그대로 추가",
  decline: "추가하지 않기",
};

/** 물음 — 접힌 줄의 제목과 같다. */
function asked(card: Pick<PendingProjectAdd, "look" | "folder" | "root">): string {
  const topic = `${card.folder}${particle(card.folder, "은", "는")}`;
  if (card.look === "notGit") return `${topic} git 저장소가 아니에요. 어떻게 할까요?`;
  const root = (card.root ?? "").split("/").filter(Boolean).pop() ?? "";
  return `${topic} ${root} 저장소 안의 폴더예요. 어떻게 할까요?`;
}

/** 카드의 값. `asker`는 물은 참여자의 화면 이름이다. */
export function describeProjectAddCard(card: PendingProjectAdd, asker: string): ProjectAddCardView {
  const option = (answer: ProjectAddAnswer, note: string | null, recommended = false): ProjectAddOption => ({
    answer,
    label: LABELS[answer],
    badge: recommended ? "추천" : null,
    note,
  });
  const options =
    card.look === "notGit"
      ? [option("init", "빈 레포를 만들고 기준 브랜치 main", true), option("decline", null)]
      : [option("root", card.root, true), option("as-is", card.path), option("decline", null)];
  return { head: `${asker} · 질문`, title: asked(card), sub: null, options, start: 0 };
}

/** 접힌 줄(02 §10 「답한 카드」와 같은 꼴) — 물음과 고른 답. */
export function projectAddChoiceCard(entry: ProjectAddChoiceEntry): AnsweredCard {
  return { asked: asked(entry), said: LABELS[entry.choice] };
}
