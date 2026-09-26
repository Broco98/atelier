import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { announceStay, whenArrived } from "./arrival";

// 이동이 닿으면 할 일(develop 머지 — 셸로 가는 길이 셸을 켜고 포커스를 요청하는 때, 토스트의 [보기]가 그 토스트를 내리는 때).
// 진짜 라우터를 메모리 히스토리로 띄워 「언제 부르는가」만 본다 — 막기가 없을 때 `navigate` 안에서 곧바로, 주소가 그대로인
// 이동에도, 막혀 머물면 안, 다른 데 먼저 닿으면 안, 같은 칸에 새 요청이 오면 앞의 것은 안, 칸이 다르면 둘 다.
//
// **막기 자체는 이 층에 없다.** 히스토리는 `document`가 있을 때만 막기를 부르고 Vitest 기본 환경(node)에는 그것이 없다. 막는
// 쪽이 하는 일(`announceStay`)을 여기서 손으로 부르고, 편집기의 진짜 막기를 지나는 ⌘J와 [보기]는 L3(`shell-recall.spec.ts` ·
// `processes-view.spec.ts`)가 잰다.
//
// isServer · origin을 넘기는 까닭은 `router.test.ts` 머리말과 같다 — node에서 라우터가 제가 클라이언트인 줄 알게 한다.

// 앱의 라우트 트리를 그대로 쓰되, 데이터를 안 부르는 세 화면 사이만 오간다 — 셸로 가는 길의 목적지(작업 화면의 검색 값)가
// 닿은 주소와 같게 지어지는지는 그 길을 도는 L3가 잰다.
function setup() {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/terminal"] }),
    isServer: false,
    origin: "http://localhost",
    context: { queryClient: new QueryClient() },
  });
}

afterEach(() => {
  // 모듈 값이라 검사끼리 새지 않게 비운다 — 기다리는 것이 없으면 아무 일도 안 한다.
  announceStay();
});

describe("이동이 닿으면 할 일", () => {
  it("막기가 없으면 이동을 거는 그 자리에서 부른다 — 새 화면이 서기 전이다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, arrive, "shell");
    const done = router.navigate({ to: "/processes" });
    expect(arrive).toHaveBeenCalledTimes(1);
    await done;
    expect(router.state.location.pathname).toBe("/processes");
  });

  it("주소가 그대로인 이동(보고 있는 화면)에도 부른다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/terminal" }).href, arrive, "shell");
    await router.navigate({ to: "/terminal" });
    expect(arrive).toHaveBeenCalledTimes(1);
  });

  it("막혀 머물면 거둔다 — 뒤에 같은 주소에 닿아도 안 부른다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, arrive, "shell");
    // 막는 쪽이 [계속 편집]에서 하는 일. 막힌 이동은 히스토리에 안 적혀 라우터가 안 돈다.
    announceStay();
    // 사람이 뒤에 다른 길로 같은 화면에 간다(「앱으로 돌아가기」가 들어오기 전의 그 화면으로).
    await router.navigate({ to: "/processes" });
    expect(arrive).not.toHaveBeenCalled();
  });

  it("다른 주소에 먼저 닿으면 할 일 없이 거둔다 — 뒤에 그 주소에 닿아도 안 부른다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, arrive, "shell");
    await router.navigate({ to: "/maison/terminal" });
    await router.navigate({ to: "/processes" });
    expect(arrive).not.toHaveBeenCalled();
  });

  it("한 번만 부른다 — 떠났다가 다시 와도 또 부르지 않는다", async () => {
    const router = setup();
    await router.load();
    const arrive = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, arrive, "shell");
    await router.navigate({ to: "/processes" });
    await router.navigate({ to: "/maison/terminal" });
    await router.navigate({ to: "/processes" });
    expect(arrive).toHaveBeenCalledTimes(1);
  });

  it("새 요청이 앞의 것을 덮는다 — 앞의 할 일은 안 부른다", async () => {
    const router = setup();
    await router.load();
    const first = vi.fn();
    const second = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, first, "shell");
    whenArrived(router, router.buildLocation({ to: "/processes" }).href, second, "shell");
    await router.navigate({ to: "/processes" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  // 칸은 길마다 하나다 — 셸로 가는 길(⌘J)과 토스트의 [보기]. 한 칸에 둘을 두면 뒤의 요청이 앞의 것(셸 켜기 · 토스트 내리기)을
  // 소리 없이 지운다.
  it("칸이 다르면 서로 덮지 않는다 — 닿으면 둘 다 부른다", async () => {
    const router = setup();
    await router.load();
    const shell = vi.fn();
    const processes = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, shell, "shell");
    whenArrived(router, router.buildLocation({ to: "/processes" }).href, processes, "processes");
    await router.navigate({ to: "/processes" });
    expect(shell).toHaveBeenCalledTimes(1);
    expect(processes).toHaveBeenCalledTimes(1);
  });

  it("머묾은 모든 칸을 거둔다", async () => {
    const router = setup();
    await router.load();
    const shell = vi.fn();
    const processes = vi.fn();

    whenArrived(router, router.buildLocation({ to: "/processes" }).href, shell, "shell");
    whenArrived(router, router.buildLocation({ to: "/processes" }).href, processes, "processes");
    announceStay();
    await router.navigate({ to: "/processes" });
    expect(shell).not.toHaveBeenCalled();
    expect(processes).not.toHaveBeenCalled();
  });

  it("머묾은 기다리는 것이 없으면 아무 일도 안 한다", () => {
    expect(() => announceStay()).not.toThrow();
  });
});
