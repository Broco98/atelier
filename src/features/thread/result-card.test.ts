import { describe, expect, it } from "vitest";
import type { ResultEntry } from "./fold";
import { resultCardView, resultTarget } from "./result-card";

// 결과 카드의 값(03 티켓 12 · 구현 스펙 §12 · 캔버스 F4-KitChat 「대화로 한 설정 — 결과 카드」) — 기록의 `setting` 줄을 접은 카드에서 아이콘 ·
// 두 줄 · 오른쪽 단추(「열기」 · 「관계 보기」) · 단추가 갈 곳 · 꺼짐을 고르는 순수 함수다.

const card = (over: Partial<ResultEntry>): ResultEntry => ({
  kind: "result",
  key: "r8",
  action: "project-added",
  slug: "landing-page",
  name: "landing-page",
  title: "Project를 추가했어요 — landing-page",
  detail: "~/MyProjects/landing-page · git 레포 · 기준 브랜치 main",
  ...over,
});

describe("결과 카드", () => {
  it("넷의 아이콘 · 두 줄 · 단추 · 갈 곳 — Project는 Project 상세로, Space는 Space 상세로, Space 고침은 「관계 보기」다", () => {
    const cards = [
      card({}),
      card({ action: "project-edited", slug: "web-app", name: "web-app", title: "web-app의 기준 브랜치를 main으로 바꿨어요", detail: "새 Work부터 main에서 갈라져요" }),
      card({ action: "space-created", slug: "정산", name: "정산", title: "Space를 만들었어요 — 정산", detail: "api-server · ~/.atelier/spaces/정산.md" }),
      card({ action: "space-edited", slug: "결제-서비스", name: "결제 서비스", title: "결제 서비스에 backoffice를 넣었어요", detail: "Project 3 · 함께 쓰는 Space 1" }),
    ];
    expect(cards.map((one) => resultCardView(one, null))).toEqual([
      {
        icon: "project",
        title: "Project를 추가했어요 — landing-page",
        detail: "~/MyProjects/landing-page · git 레포 · 기준 브랜치 main",
        action: "열기",
        to: { to: "/projects/$slug", params: { slug: "landing-page" } },
        gone: false,
      },
      {
        icon: "project",
        title: "web-app의 기준 브랜치를 main으로 바꿨어요",
        detail: "새 Work부터 main에서 갈라져요",
        action: "열기",
        to: { to: "/projects/$slug", params: { slug: "web-app" } },
        gone: false,
      },
      {
        icon: "space",
        title: "Space를 만들었어요 — 정산",
        detail: "api-server · ~/.atelier/spaces/정산.md",
        action: "열기",
        to: { to: "/spaces/$slug", params: { slug: "정산" } },
        gone: false,
      },
      {
        icon: "space",
        title: "결제 서비스에 backoffice를 넣었어요",
        detail: "Project 3 · 함께 쓰는 Space 1",
        action: "관계 보기",
        to: { to: "/spaces/$slug", params: { slug: "결제-서비스" } },
        gone: false,
      },
    ]);
    expect(cards.map((one) => resultTarget(one))).toEqual(["project", "project", "space", "space"]);
  });

  it("대상이 그사이 사라졌으면 단추가 꺼지고, 목록을 아직 못 읽었으면 켜 둔다", () => {
    expect(resultCardView(card({}), ["web-app", "api-server"]).gone).toBe(true);
    expect(resultCardView(card({}), ["landing-page"]).gone).toBe(false);
    expect(resultCardView(card({}), []).gone).toBe(true);
    expect(resultCardView(card({}), null).gone).toBe(false);
  });
});
