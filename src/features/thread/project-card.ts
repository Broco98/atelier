import { particle } from "@/lib/particle";
import { type PendingProject } from "./fold";
import type { ProjectAnswer } from "./types";

// Work 밖 Project 카드의 값(v1 티켓 32 · 구현 스펙 §11 S22 · 스토리 99 · 캔버스 Cards 보드 「Work 밖 Project」) — Agent가 이 Work에 없는
// Project를 고치려 하면 「Project 고치기 시작」 Thread 도구가 입력창 자리에 이 카드를 세우고 사람이 고를 때까지 기다린다. 물음 · 선택지
// 셋 · 결정 줄의 글을 짓는 **순수 함수**다 — 그리는 것은 `ProjectCard`와 흐름의 결정 줄이다.

/** 카드의 값 — 보드의 머리(물음 · 까닭), Project 상자(이름 · 「이 Work에 붙어 있지 않음」), 번호 줄 셋. */
export interface ProjectCardView {
  /** 「Host가 이 Work에 없는 Project를 고치려고 해요」. */
  title: string;
  /** Agent가 든 까닭 — 물음 아래 줄. 없으면 null이다. */
  reason: string | null;
  name: string;
  note: string;
  /** 붙이고 고치기 · 읽기만 하기 · 아니요 — 이 차례가 번호다(아니요가 마지막이라 Esc다). */
  choices: { answer: ProjectAnswer; label: string }[];
}

/** 카드의 값. `asker`는 물은 참여자의 화면 이름이다. */
export function describeProjectCard(card: PendingProject, asker: string): ProjectCardView {
  const name = card.name;
  const only = card.workProjects.length > 0 ? `아니요, ${card.workProjects.join(" · ")}에서만 고쳐 주세요` : "아니요";
  return {
    title: `${asker}${particle(asker, "이", "가")} 이 Work에 없는 Project를 고치려고 해요`,
    reason: card.reason,
    name,
    note: "이 Work에 붙어 있지 않음",
    choices: [
      { answer: "attach", label: `${name}${particle(name, "을", "를")} 이 Work에 붙이고 고치기` },
      { answer: "read", label: "읽기만 하기" },
      { answer: "decline", label: only },
    ],
  };
}

/** 결정 줄의 글 — Project 이름(진하게)과 그 뒤(보드 `.done` 「web-app을 이 Work에 붙임」). */
export function projectChoiceText(choice: ProjectAnswer, name: string): { name: string; after: string } {
  const object = particle(name, "을", "를");
  switch (choice) {
    case "attach":
      return { name, after: `${object} 이 Work에 붙임` };
    case "read":
      return { name, after: `${object} 읽기만 하기로 함` };
    case "decline":
      return { name, after: `${object} 고치지 않기로 함` };
  }
}
