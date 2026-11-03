import { describe, expect, it } from "vitest";
import type { PendingService, ServiceChoiceEntry } from "./fold";
import { describeServiceCard, serviceChoiceCard } from "./service-card";

// Service 질문 카드의 값(03 티켓 08 · 구현 스펙 §11 · 캔버스 F4-WorkAsk · F4-KitChat 「질문 카드」 · 「답한 뒤」) — 기록의 카드 줄에서 물음 ·
// 선택지(추천 · 후보 · Service 없이) · 키 · 접힌 줄의 글을 짓는 순수 함수다.

const card = (over: Partial<PendingService> = {}): PendingService => ({
  card: "service",
  requestId: "r1",
  recommended: "결제-서비스",
  services: [
    { slug: "결제-서비스", name: "결제 서비스", projects: ["web-app", "api-server"] },
    { slug: "사내-도구", name: "사내 도구", projects: ["api-server", "backoffice"] },
  ],
  registered: 3,
  ...over,
});

describe("Service 질문 카드의 선택지", () => {
  it("머리는 「Claude Code · 질문」, 물음과 그 아래 한 줄, 1 추천 Service(추천 · Project) · 2 다른 후보 · 끝 「Service 없이」다(F4-WorkAsk)", () => {
    expect(describeServiceCard(card(), "Claude Code")).toEqual({
      head: "Claude Code · 질문",
      title: "어느 Service에서 할까요?",
      sub: "Service를 고르면 그 안의 Project만 읽어요 · 나중에 바꿀 수 있어요",
      options: [
        { answer: { kind: "service", slug: "결제-서비스" }, label: "결제 서비스", badge: "추천", note: "web-app · api-server" },
        { answer: { kind: "service", slug: "사내-도구" }, label: "사내 도구", badge: null, note: "api-server · backoffice" },
        { answer: { kind: "none" }, label: "Service 없이", badge: null, note: "등록된 Project 3개를 모두 읽어요" },
      ],
      start: 0,
    });
  });

  it("Host가 Service 없이를 넘겼으면 「Service 없이」가 추천이고 처음 켜진 줄이다", () => {
    const view = describeServiceCard(card({ recommended: null, services: [card().services[1]] }), "Claude Code");
    expect(view.options.map((one) => [one.label, one.badge])).toEqual([
      ["사내 도구", null],
      ["Service 없이", "추천"],
    ]);
    expect(view.start).toBe(1);
  });

  it("빈 Service는 「Project 없음」, Project가 넷 이상이면 「외 N개」, 등록된 Project가 없으면 「Service 없이」가 그렇다고 말한다", () => {
    const view = describeServiceCard(
      card({
        services: [
          { slug: "결제-서비스", name: "결제 서비스", projects: [] },
          { slug: "큰-것", name: "큰 것", projects: ["a", "b", "c", "d"] },
        ],
        registered: 0,
      }),
      "리뷰어",
    );
    expect(view.head).toBe("리뷰어 · 질문");
    expect(view.options.map((one) => one.note)).toEqual(["Project 없음", "a · b 외 2개", "등록된 Project가 없어요"]);
  });
});

describe("답한 뒤 접힌 줄 — 질문 카드처럼 「✓ · 물은 제목 · 고른 답」(F4-KitChat 「답한 뒤」)", () => {
  const entry = (over: Partial<ServiceChoiceEntry>): ServiceChoiceEntry => ({
    kind: "service-choice",
    key: "w9",
    choice: "service",
    name: "결제 서비스",
    toolCallId: null,
    ...over,
  });

  it("고른 Service · Service 없이는 물음과 답이고, 나중에는 답 없이 미룬 표지다", () => {
    expect(serviceChoiceCard(entry({}))).toEqual({ asked: "어느 Service에서 할까요?", said: "결제 서비스" });
    expect(serviceChoiceCard(entry({ choice: "none", name: null }))).toEqual({ asked: "어느 Service에서 할까요?", said: "Service 없이" });
    expect(serviceChoiceCard(entry({ choice: "later", name: null }))).toEqual({ asked: "Service는 나중에 정하기로 함", said: null });
  });
});
