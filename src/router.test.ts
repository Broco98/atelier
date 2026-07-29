import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// 위치 전이 규칙의 seam은 라우터 하나다. 컴포넌트를 렌더하지 않고 라우터만 띄워
// "어떤 조작 뒤에 위치가 무엇이 되는가"와 "히스토리가 몇 칸 늘었는가"만 관찰한다.
//
// 여기서 관찰하지 않는 것 — 셸이 URL에서 활성 탭을 뽑는 방식, 사이드바 클릭이 어느
// 경로로 가는지, 라우트 래퍼의 교차 이동. 렌더가 필요해 이 seam 밖이고, 깨지면
// 화면에서 즉시 드러나는 종류라 수동/시각 검증이 맞다 (spec의 "Seam으로 잡지 않는 것").
//
// isServer를 끄는 이유 — Vitest 기본 환경(node)에는 document가 없어 라우터가 자신을
// 서버로 판단하고, 서버 분기에서는 정규화 리다이렉트를 따라가지 않는다. 앱이 도는
// 웹뷰는 언제나 클라이언트이므로 그쪽 동작을 재현한다.
// origin을 함께 넘기는 이유 — 클라이언트로 판단한 라우터는 origin이 비어 있으면
// window.origin을 읽는데, node에는 window 자체가 없어 ReferenceError가 난다.
function setup(initialEntries: Array<string>) {
  const history = createMemoryHistory({ initialEntries });
  const router = createRouter({
    routeTree,
    history,
    isServer: false,
    origin: "http://localhost",
  });
  return { router, history };
}

// 라우터 상태를 히스토리 이동에 따라오게 한다. 앱에서는 RouterProvider 안의
// Transitioner가 history를 구독해 해주는 일을 테스트에서 손으로 한다.
async function goBack(router: ReturnType<typeof setup>["router"], history: ReturnType<typeof setup>["history"]) {
  history.back();
  await router.load({ action: { type: "BACK" } });
}

async function goForward(router: ReturnType<typeof setup>["router"], history: ReturnType<typeof setup>["history"]) {
  history.forward();
  await router.load({ action: { type: "FORWARD" } });
}

describe("진입 정규화", () => {
  it("'/'로 들어오면 프로젝트 목록으로 정규화된다", async () => {
    const { router } = setup(["/"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/projects");
  });

  it("그 정규화는 히스토리를 늘리지 않는다 — 시작 직후 뒤로갈 곳이 없다", async () => {
    const { router, history } = setup(["/"]);
    await router.load();
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
  });
});

// 탭 전환 자체가 아니라, 탭 전환이 만드는 히스토리 의미론을 고정한다
describe("페이지 이동의 히스토리 의미론", () => {
  it("Works에서 Projects로 옮기면 히스토리가 한 칸 늘어난다", async () => {
    const { router, history } = setup(["/works"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/works");
    expect(history.canGoBack()).toBe(false);

    await router.navigate({ to: "/projects" });
    expect(router.state.location.pathname).toBe("/projects");
    expect(history.length).toBe(2);
    expect(history.canGoBack()).toBe(true);
  });

  it("뒤로가기로 이전 탭에 돌아오고, 앞으로가기로 되돌린다", async () => {
    const { router, history } = setup(["/works"]);
    await router.load();
    await router.navigate({ to: "/projects" });

    await goBack(router, history);
    expect(router.state.location.pathname).toBe("/works");

    await goForward(router, history);
    expect(router.state.location.pathname).toBe("/projects");
  });

  it("이미 보고 있는 탭을 다시 눌러도 히스토리가 늘지 않는다", async () => {
    const { router, history } = setup(["/works"]);
    await router.load();

    await router.navigate({ to: "/works" });
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
  });
});
