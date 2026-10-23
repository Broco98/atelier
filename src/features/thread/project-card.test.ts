import { describe, expect, it } from "vitest";
import type { PendingProject } from "./fold";
import { describeProjectCard, projectChoiceText } from "./project-card";

// Work 밖 Project 카드의 값(v1 티켓 32 · 구현 스펙 §11 S22 · 캔버스 Cards 보드 「Work 밖 Project」 · 「결정한 뒤」) — 물음 · 선택지 셋 ·
// 결정 줄의 글. seam은 순수 함수 둘이다 — 카드와 결정 줄은 이 값을 그리기만 한다.

const card = (extra: Partial<PendingProject> = {}): PendingProject => ({
  card: "project",
  requestId: "r",
  who: "host",
  project: "web-app",
  name: "web-app",
  reason: "환불 버튼이 두 번 눌리는 문제는 web-app에 있어요",
  work: "refund-api",
  workProjects: ["api-server"],
  ...extra,
});

describe("Work 밖 Project 카드", () => {
  it("누가 무엇을 고치려는지와 선택지 셋을 보드 문장 그대로 낸다 — 아니요는 이 Work의 Project를 이름으로 든다", () => {
    expect(describeProjectCard(card(), "Host")).toEqual({
      title: "Host가 이 Work에 없는 Project를 고치려고 해요",
      reason: "환불 버튼이 두 번 눌리는 문제는 web-app에 있어요",
      name: "web-app",
      note: "이 Work에 붙어 있지 않음",
      choices: [
        { answer: "attach", label: "web-app을 이 Work에 붙이고 고치기" },
        { answer: "read", label: "읽기만 하기" },
        { answer: "decline", label: "아니요, api-server에서만 고쳐 주세요" },
      ],
    });
  });

  it("이 Work에 Project가 여럿이면 함께 들고, 없으면(기획만인 Work) 아니요만 남는다", () => {
    expect(describeProjectCard(card({ workProjects: ["api-server", "admin-console"] }), "리뷰어").choices[2].label).toBe(
      "아니요, api-server · admin-console에서만 고쳐 주세요",
    );
    expect(describeProjectCard(card({ workProjects: [] }), "Host").choices[2].label).toBe("아니요");
    expect(describeProjectCard(card(), "리뷰어").title).toBe("리뷰어가 이 Work에 없는 Project를 고치려고 해요");
  });
});

describe("결정 줄", () => {
  it("고른 것을 Project 이름과 함께 한 줄로 남긴다(보드 「web-app을 이 Work에 붙임」)", () => {
    expect(projectChoiceText("attach", "web-app")).toEqual({ name: "web-app", after: "을 이 Work에 붙임" });
    expect(projectChoiceText("read", "web-app")).toEqual({ name: "web-app", after: "을 읽기만 하기로 함" });
    expect(projectChoiceText("decline", "api-server")).toEqual({ name: "api-server", after: "를 고치지 않기로 함" });
  });
});
