import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { worksQuery } from "./features/works/hooks";
import { projectsQuery } from "./features/projects/hooks";
import { shellStore } from "./components/shell/shell-store";
import type { WorkView } from "./features/works/types";
import type { ProjectView } from "./features/projects/types";

// 위치 전이 규칙의 seam은 라우터 하나다. 컴포넌트를 렌더하지 않고 라우터만 띄워
// "어떤 조작 뒤에 위치가 무엇이 되는가"와 "히스토리가 몇 칸 늘었는가"만 관찰한다.
//
// 여기서 관찰하지 않는 것 — 셸이 URL에서 활성 탭을 뽑는 방식, 사이드바 클릭이 어느
// 경로로 가는지, 목록 클릭이 navigate로 이어지는 배선, 보던 항목이 디스크에서 사라졌을 때의
// 복구(그건 쿼리 갱신에 반응하는 컴포넌트의 몫이다). 전부 렌더가 필요해 이 seam 밖이고,
// 깨지면 화면에서 즉시 드러나는 종류라 수동/시각 검증이 맞다 (spec의 "Seam으로 잡지 않는 것").
//
// isServer를 끄는 이유 — Vitest 기본 환경(node)에는 document가 없어 라우터가 자신을
// 서버로 판단하고, 서버 분기에서는 정규화 리다이렉트를 따라가지 않는다. 앱이 도는
// 웹뷰는 언제나 클라이언트이므로 그쪽 동작을 재현한다.
// origin을 함께 넘기는 이유 — 클라이언트로 판단한 라우터는 origin이 비어 있으면
// window.origin을 읽는데, node에는 window 자체가 없어 ReferenceError가 난다.

// 정규화는 목록에서 slug만 본다 — 나머지 필드는 이 seam의 관심사가 아니라 좁게 만든다
const works = (...slugs: Array<string>) => slugs.map((slug) => ({ slug })) as Array<WorkView>;
const projects = (...slugs: Array<string>) =>
  slugs.map((slug) => ({ slug })) as Array<ProjectView>;

interface SetupOptions {
  works?: Array<WorkView>;
  projects?: Array<ProjectView>;
  lastWork?: string | null;
  lastProject?: string | null;
}

function setup(initialEntries: Array<string>, options: SetupOptions = {}) {
  const queryClient = new QueryClient();
  // 캐시를 미리 채우면 beforeLoad의 ensureQueryData가 Tauri invoke 없이 그대로 돌려준다.
  // 목록이 정규화의 입력이므로, 이 seam에서 목록은 주입하는 값이다.
  queryClient.setQueryData(worksQuery.queryKey, options.works ?? works("work-a", "work-b"));
  queryClient.setQueryData(
    projectsQuery.queryKey,
    options.projects ?? projects("proj-a", "proj-b"),
  );
  // "이번 세션에서 마지막으로 보던 항목"도 정규화의 입력이다. 스토어는 모듈 싱글턴이라
  // 테스트마다 여기서 덮어써 이전 테스트가 남긴 값이 새지 않게 한다.
  shellStore.setState((state) => ({
    ...state,
    workSlug: options.lastWork ?? null,
    projectSlug: options.lastProject ?? null,
  }));

  const history = createMemoryHistory({ initialEntries });
  const router = createRouter({
    routeTree,
    history,
    isServer: false,
    origin: "http://localhost",
    context: { queryClient },
  });
  return { router, history };
}

// 라우터 상태를 히스토리 이동에 따라오게 한다. 앱에서는 RouterProvider 안의
// Transitioner가 history를 구독해 해주는 일을 테스트에서 손으로 한다.
async function goBack(
  router: ReturnType<typeof setup>["router"],
  history: ReturnType<typeof setup>["history"],
) {
  history.back();
  await router.load({ action: { type: "BACK" } });
}

async function goForward(
  router: ReturnType<typeof setup>["router"],
  history: ReturnType<typeof setup>["history"],
) {
  history.forward();
  await router.load({ action: { type: "FORWARD" } });
}

describe("진입 정규화", () => {
  it("'/'로 들어오면 프로젝트 목록의 첫 항목까지 정규화된다", async () => {
    const { router } = setup(["/"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/projects/proj-a");
  });

  it("그 정규화는 히스토리를 늘리지 않는다 — 시작 직후 뒤로갈 곳이 없다", async () => {
    const { router, history } = setup(["/"]);
    await router.load();
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
  });
});

// 항목이 지정되지 않은 주소는 화면과 어긋나지 않도록 실제로 보고 있는 항목까지 고쳐 쓴다
describe("무선택 주소의 정규화", () => {
  it("이번 세션에서 그 탭에서 마지막으로 보던 항목으로 간다", async () => {
    const { router } = setup(["/works"], { lastWork: "work-b" });
    await router.load();
    expect(router.state.location.pathname).toBe("/works/work-b");
  });

  it("그 탭을 처음 여는 것이면 목록 첫 항목으로 간다", async () => {
    const { router } = setup(["/works"], { lastWork: null });
    await router.load();
    expect(router.state.location.pathname).toBe("/works/work-a");
  });

  it("마지막으로 보던 항목이 목록에서 사라졌으면 첫 항목으로 떨어진다", async () => {
    const { router } = setup(["/works"], { lastWork: "지워진-작업" });
    await router.load();
    expect(router.state.location.pathname).toBe("/works/work-a");
  });

  it("목록이 비어 있으면 정규화하지 않고 무선택 주소에 머문다", async () => {
    const { router } = setup(["/works"], { works: [] });
    await router.load();
    expect(router.state.location.pathname).toBe("/works");
  });

  it("정규화는 히스토리를 늘리지 않는다 — 무선택 주소가 뒤에 남지 않는다", async () => {
    const { router, history } = setup(["/works"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/works/work-a");
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
  });

  it("프로젝트에도 같은 규칙이 적용된다", async () => {
    const { router } = setup(["/projects"], { lastProject: "proj-b" });
    await router.load();
    expect(router.state.location.pathname).toBe("/projects/proj-b");
  });
});

describe("선택한 항목의 히스토리 의미론", () => {
  it("작업 A에서 B로 옮긴 뒤 뒤로가기를 누르면 A로 돌아온다", async () => {
    const { router, history } = setup(["/works/work-a"]);
    await router.load();

    await router.navigate({ to: "/works/$slug", params: { slug: "work-b" } });
    expect(router.state.location.pathname).toBe("/works/work-b");
    expect(history.length).toBe(2);

    await goBack(router, history);
    expect(router.state.location.pathname).toBe("/works/work-a");

    await goForward(router, history);
    expect(router.state.location.pathname).toBe("/works/work-b");
  });

  it("이미 보고 있는 항목을 다시 눌러도 히스토리가 늘지 않는다", async () => {
    const { router, history } = setup(["/works/work-a"]);
    await router.load();

    await router.navigate({ to: "/works/$slug", params: { slug: "work-a" } });
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
  });

  // 무선택 주소로 가는 이동은 정규화가 replace여도 그 자체는 한 칸을 남긴다 — 목적지가
  // 지금 보고 있는 항목과 같아도 마찬가지다. 그래서 "이미 그 탭"인 탭 클릭(AppShell)과
  // "보던 항목이 사라짐"인 선택 해제(뷰의 onSelect(null))는 각각 막거나 replace로 보내야 한다.
  // 그 두 곳이 왜 필요한지가 이 규칙에 달려 있어 여기서 고정한다.
  it("무선택 주소로 가면 목적지가 지금 위치와 같아도 히스토리가 한 칸 는다", async () => {
    const { router, history } = setup(["/works/work-a"], { lastWork: "work-a" });
    await router.load();
    expect(history.length).toBe(1);

    await router.navigate({ to: "/works" });
    expect(router.state.location.pathname).toBe("/works/work-a");
    expect(history.length).toBe(2);
  });

  it("그 이동을 replace로 보내면 칸이 늘지 않는다 — 선택 해제가 쓰는 경로다", async () => {
    const { router, history } = setup(["/works/work-a"], { lastWork: "work-a" });
    await router.load();

    await router.navigate({ to: "/works", replace: true });
    expect(router.state.location.pathname).toBe("/works/work-a");
    expect(history.length).toBe(1);
  });

  // 탭 전환은 무선택 주소로 가고 거기서 정규화가 한 번 더 일어난다.
  // 정규화가 push였다면 여기서 뒤로가기를 두 번 눌러야 한다 — 그 회귀를 이 테스트가 잡는다.
  it("탭을 전환한 뒤 뒤로가기 한 번이면 이전 탭에서 보던 항목으로 간다", async () => {
    const { router, history } = setup(["/works/work-a"], { lastProject: "proj-b" });
    await router.load();

    await router.navigate({ to: "/projects" });
    expect(router.state.location.pathname).toBe("/projects/proj-b");
    expect(history.length).toBe(2);

    await goBack(router, history);
    expect(router.state.location.pathname).toBe("/works/work-a");
  });
});
