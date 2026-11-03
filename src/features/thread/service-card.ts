import { readingList, registeredText } from "@/features/services/scope";
import type { PendingService, ServiceChoiceEntry } from "./fold";
import type { AnsweredCard } from "./question";
import type { ToolQuestionOption, ToolQuestionView } from "./tool-question";
import type { ServiceAnswer } from "./types";

// Service 질문 카드의 값(03 티켓 08 · 구현 스펙 §11 · S12 · 캔버스 F4-WorkAsk · F4-KitChat 「질문 카드」) — Host가 「Service 붙이기」 Thread
// 도구를 불렀고 Atelier가 사람에게 묻기로 했으면(「묻지 않음」이 아니다 · 이미 붙어 있다 · 후보가 여럿) 그 도구가 입력창 자리에 이 카드를
// 세우고 사람이 고를 때까지 기다린다. 물음 · 선택지(추천 · 다른 후보 · Service 없이) · 접힌 줄의 글을 짓는 **순수 함수**다 — 겉과 키는 Thread
// 도구 질문 카드 하나다(`tool-question.ts` · `ToolQuestionCard`). 그리는 것은 Thread 도구 카드의 표(`ToolCards.tsx`)와 흐름의 답한 카드(`AnsweredCards`)다.

/** 물음 — 접힌 줄의 제목과 같다. */
const ASKED = "어느 Service에서 할까요?";

/** 선택지 한 줄 — 고르면 가는 답과 번호 줄(이름 · 「추천」 · 아래 줄 — 담은 Project · 읽는 범위). */
export interface ServiceCardOption extends ToolQuestionOption {
  answer: Exclude<ServiceAnswer, { kind: "later" }>;
}

/** 카드의 값 — 머리(「Host · 질문」) · 물음 · 물음 아래 줄 · 선택지와 처음 켜진 줄(추천). */
export interface ServiceCardView extends ToolQuestionView {
  options: ServiceCardOption[];
}

/** 카드의 값. `asker`는 그 채팅의 Runtime 이름이다. */
export function describeServiceCard(card: PendingService, asker: string): ServiceCardView {
  const options: ServiceCardOption[] = card.services.map((service) => ({
    answer: { kind: "service", slug: service.slug },
    label: service.name,
    badge: service.slug === card.recommended ? "추천" : null,
    note: service.projects.length > 0 ? readingList(service.projects) : "Project 없음",
  }));
  options.push({
    answer: { kind: "none" },
    label: "Service 없이",
    badge: card.recommended === null ? "추천" : null,
    note: registeredText(card.registered, { all: true }),
  });
  return {
    head: `${asker} · 질문`,
    title: ASKED,
    sub: "Service를 고르면 그 안의 Project만 읽어요 · 나중에 바꿀 수 있어요",
    options,
    start: Math.max(0, options.findIndex((one) => one.badge !== null)),
  };
}

/** 접힌 줄(02 §10 「답한 카드」와 같은 꼴) — 고른 Service · Service 없이는 물음과 답, 나중에는 답 없이 미룬 표지다. */
export function serviceChoiceCard(entry: ServiceChoiceEntry): AnsweredCard {
  if (entry.choice === "later") return { asked: "Service는 나중에 정하기로 함", said: null };
  return { asked: ASKED, said: entry.choice === "none" ? "Service 없이" : (entry.name ?? "") };
}
