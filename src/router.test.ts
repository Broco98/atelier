import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { worksQuery } from "./features/works/hooks";
import { projectsQuery } from "./features/projects/hooks";
import { archiveQuery } from "./features/archive/hooks";
import { shellStore } from "./components/shell/shell-store";
import { trackCanGoForward } from "./can-go-forward";
import { tabSearch } from "./routes/-work-search";
import type { ViewTab } from "./routes/-work-search";
import type { WorkView } from "./features/works/types";
import type { ProjectView } from "./features/projects/types";
import type { ArchiveEntry } from "./features/archive/types";

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

// 정규화는 목록에서 slug와 status만 본다 — 나머지 필드는 이 seam의 관심사가 아니라 좁게 만든다.
// "draft:" 접두사를 붙인 slug는 초안이 된다 (기본 선택이 건너뛰는 대상).
const works = (...slugs: Array<string>) =>
  slugs.map((raw) => {
    const draft = raw.startsWith("draft:");
    return { slug: draft ? raw.slice("draft:".length) : raw, status: draft ? "draft" : "active" };
  }) as Array<WorkView>;
const projects = (...slugs: Array<string>) =>
  slugs.map((slug) => ({ slug })) as Array<ProjectView>;
const archives = (...slugs: Array<string>) =>
  slugs.map((slug) => ({ slug })) as Array<ArchiveEntry>;

interface SetupOptions {
  works?: Array<WorkView>;
  projects?: Array<ProjectView>;
  archives?: Array<ArchiveEntry>;
  lastWork?: string | null;
  lastProject?: string | null;
  lastArchive?: string | null;
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
  queryClient.setQueryData(
    archiveQuery.queryKey,
    options.archives ?? archives("치운-a", "치운-b"),
  );
  // "이번 세션에서 마지막으로 보던 항목"도 정규화의 입력이다. 스토어는 모듈 싱글턴이라
  // 테스트마다 여기서 덮어써 이전 테스트가 남긴 값이 새지 않게 한다.
  shellStore.setState((state) => ({
    ...state,
    workSlug: options.lastWork ?? null,
    projectSlug: options.lastProject ?? null,
    archiveSlug: options.lastArchive ?? null,
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

// 앱을 켜면 작업 화면이다 — 작업이 본업이고 프로젝트는 설정에 가깝다.
// 진입은 무선택 주소를 한 번 더 거치므로 그쪽 규칙(초안 건너뛰기 포함)을 그대로 물려받는다.
describe("진입 정규화", () => {
  it("'/'로 들어오면 작업 목록의 첫 항목까지 정규화된다", async () => {
    const { router } = setup(["/"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/works/work-a");
  });

  it("이번 세션에서 마지막으로 보던 작업이 있으면 거기로 간다", async () => {
    const { router } = setup(["/"], { lastWork: "work-b" });
    await router.load();
    expect(router.state.location.pathname).toBe("/works/work-b");
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

  // 아카이브도 같은 규칙이다. **목록 패널이 곁에 상주하기 때문에** 그래도 된다 —
  // 패널 없이 목록과 상세가 같은 영역을 번갈아 쓰던 판에서는 이 정규화가 목록을 볼 방법을
  // 통째로 없앴고, 그래서 그때는 아카이브만 규칙에서 빼야 했다. 패널이 그 예외를 지웠다.
  it("아카이브에도 같은 규칙이 적용된다", async () => {
    const { router } = setup(["/archive"], { lastArchive: "치운-b" });
    await router.load();
    expect(router.state.location.pathname).toBe("/archive/치운-b");
  });

  it("아카이브가 하나도 없으면 정규화하지 않고 빈 상태에 머문다", async () => {
    const { router } = setup(["/archive"], { archives: [] });
    await router.load();
    expect(router.state.location.pathname).toBe("/archive");
  });
});

// 사이드바 목록은 초안을 접힌 별도 구역에 둔다. 기본 선택이 거기로 떨어지면 본문에는 열려 있는데
// 목록 어디에도 강조가 없다 — 그래서 아무도 고르지 않았을 때만 초안을 건너뛴다.
// 직접 고른 초안은 건드리지 않는다.
describe("기본 선택은 초안을 건너뛴다", () => {
  it("마지막으로 보던 것이 없으면 초안이 아닌 첫 항목으로 간다", async () => {
    const { router } = setup(["/works"], { works: works("draft:초안", "진행중"), lastWork: null });
    await router.load();
    expect(router.state.location.pathname).toBe("/works/진행중");
  });

  it("초안밖에 없으면 첫 초안으로 간다 — 빈 화면보다는 낫다", async () => {
    const { router } = setup(["/works"], {
      works: works("draft:초안-a", "draft:초안-b"),
      lastWork: null,
    });
    await router.load();
    expect(router.state.location.pathname).toBe("/works/초안-a");
  });

  it("직접 열어둔 초안은 무선택 주소로 돌아와도 그대로 유지된다", async () => {
    const { router } = setup(["/works"], {
      works: works("draft:초안", "진행중"),
      lastWork: "초안",
    });
    await router.load();
    expect(router.state.location.pathname).toBe("/works/초안");
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

// 문서 전환은 두 얼굴이다. 트리 훑기는 뒤로가기를 오염시키지 않아야 하고(이슈 #25),
// 문서 링크를 따라 들어간 것은 돌아올 자리가 있어야 한다 — 그 두 규칙이 같은 navigate의
// replace 하나로 갈린다. 어느 한쪽이 잘못 붙어도 화면에서는 "뒤로가기가 이상하다"로만
// 드러나고, 그때는 이미 어느 쪽이 원인인지 보이지 않는다.
describe("문서 전환의 히스토리 의미론", () => {
  const work = (file?: string) =>
    ({ to: "/works/$slug", params: { slug: "work-a" }, search: file ? { file } : {} }) as const;

  it("트리로 문서를 훑어도 히스토리가 늘지 않는다", async () => {
    const { router, history } = setup(["/works/work-a"]);
    await router.load();

    await router.navigate({ ...work("research/prompt.md"), replace: true });
    await router.navigate({ ...work("overview.md"), replace: true });

    expect(router.state.location.search).toEqual({ file: "overview.md" });
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
  });

  it("문서 링크를 따라 들어가면 뒤로가기로 원래 문서에 돌아온다", async () => {
    const { router, history } = setup(["/works/work-a"]);
    await router.load();

    // 트리로 연 문서가 돌아올 자리다 (replace)
    await router.navigate({ ...work("검증/렌더링-확인.md"), replace: true });
    // 그 문서 안의 링크를 따라간다 (push)
    await router.navigate(work("overview.md"));
    expect(history.length).toBe(2);

    await goBack(router, history);
    expect(router.state.location.search).toEqual({ file: "검증/렌더링-확인.md" });
  });

  it("작업을 옮기면 문서가 딸려가지 않는다", async () => {
    const { router } = setup(["/works/work-a"]);
    await router.load();
    await router.navigate({ ...work("overview.md"), replace: true });

    await router.navigate({ to: "/works/$slug", params: { slug: "work-b" }, search: {} });
    expect(router.state.location.pathname).toBe("/works/work-b");
    expect(router.state.location.search).toEqual({});
  });

  // 아카이브도 같은 규칙이다 — 같은 문서를 어느 화면에서 열든 뒤로가기가 다르게 굴면 안 된다.
  // 다른 점은 하나뿐이다: 목록에서 문서를 고르는 것이 **아카이브를 고르는 것이기도 하다.**
  const archive = (slug: string, file?: string) =>
    ({ to: "/archive/$slug", params: { slug }, search: file ? { file } : {} }) as const;

  it("아카이브 목록에서 문서를 고르면 아카이브와 문서가 한 번에 옮겨진다", async () => {
    const { router, history } = setup(["/archive/치운-a"]);
    await router.load();

    await router.navigate({ ...archive("치운-b", "record.md"), replace: true });
    expect(router.state.location.pathname).toBe("/archive/치운-b");
    expect(router.state.location.search).toEqual({ file: "record.md" });
    // 두 번 옮기면 뒤로가기도 두 번이어야 한다 — 한 번의 이동이라야 그렇지 않다
    expect(history.length).toBe(1);
  });

  it("아카이브에서도 링크는 돌아올 자리를 만든다", async () => {
    const { router, history } = setup(["/archive/치운-a"]);
    await router.load();

    await router.navigate({ ...archive("치운-a", "record.md"), replace: true });
    await router.navigate(archive("치운-a", "spec/overview.md"));

    await goBack(router, history);
    expect(router.state.location.search).toEqual({ file: "record.md" });
  });

  // 이름이 같은 문서(record.md·overview.md)가 어느 아카이브에나 있다 — 딸려가면 엉뚱한
  // 것이 열린다. 예전에는 선택을 {slug, path} 쌍으로 들어 막았고, 지금은 주소가 그 일을 한다.
  it("아카이브를 옮기면 문서가 딸려가지 않는다", async () => {
    const { router } = setup(["/archive/치운-a"]);
    await router.load();
    await router.navigate({ ...archive("치운-a", "record.md"), replace: true });

    await router.navigate(archive("치운-b"));
    expect(router.state.location.search).toEqual({});
  });

});

// 화면 탭(`spec｜terminal`)도 주소가 정본이다(이슈 #25). 탭이 주소에 없으면 링크와
// 새로고침이 늘 spec으로 떨어지고, 그 어긋남은 화면에서 "왜 spec이 열리지"로만 보인다.
//
// **여기서 보는 것은 갱신 방식이다.** 이 라우터는 `search`에 객체를 주면 기존 search를
// 통째로 버려서, 가장 자연스럽게 쓰는 형태가 보던 문서를 조용히 떨어뜨린다(결정 15).
describe("화면 탭의 주소", () => {
  // **WorksView의 selectTab과 같은 함수를 쓴다.** 여기서 갱신 모양을 베껴 적으면 실제
  // 이동이 퇴화해도 이 검사는 초록이다 — 자기가 적은 것을 자기가 확인하는 꼴이 된다.
  const pick = (slug: string, next: ViewTab) =>
    ({
      to: "/works/$slug",
      params: { slug },
      search: (prev: Record<string, unknown>) => tabSearch(prev, next),
      replace: true,
    }) as const;

  it("터미널로 옮기면 주소에 남지만 히스토리는 안 는다", async () => {
    const { router, history } = setup(["/works/work-a"]);
    await router.load();

    await router.navigate(pick("work-a", "terminal"));
    expect(router.state.location.search).toEqual({ tab: "terminal" });
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
  });

  it("보던 문서가 탭을 왕복해도 그대로 남는다", async () => {
    const { router } = setup(["/works/work-a"]);
    await router.load();
    await router.navigate({
      to: "/works/$slug",
      params: { slug: "work-a" },
      search: { file: "overview.md" },
      replace: true,
    });

    await router.navigate(pick("work-a", "terminal"));
    expect(router.state.location.search).toEqual({ file: "overview.md", tab: "terminal" });

    await router.navigate(pick("work-a", "spec"));
    // spec은 주소에 안 적는다 — 값이 없으면 spec이라는 규칙이 이미 있다(결정 14).
    expect(router.state.location.search).toEqual({ file: "overview.md" });
  });

  it("`?tab=terminal`로 들어오면 그대로 열린다", async () => {
    const { router } = setup(["/works/work-a?tab=terminal"]);
    await router.load();
    expect(router.state.location.search).toEqual({ tab: "terminal" });
  });

  it("탭이 없는 주소는 아무것도 안 싣는다", async () => {
    const { router } = setup(["/works/work-a"]);
    await router.load();
    expect(router.state.location.search).toEqual({});
  });

  // **검증기는 주소를 청소하지 않는다.** 이 라우터는 검증기의 결과를 부모의 raw search
  // 위에 얹는데 루트에는 검증기가 없어서, 모르는 키가 주소에도 컴포넌트에도 그대로 온다
  // (`?file=`도 예전부터 같은 성질이다 — 이 판이 만든 것이 아니다). 그래서 「모르는 값은
  // spec」은 여기가 아니라 `-work-search.ts`의 `viewTab`이 정하고, 그쪽에서 검사한다.
  // 이 줄은 그 사실을 못박는다 — 검증기를 넓히면 주소가 깨끗해질 것이라 믿지 않도록.
  it("모르는 값은 주소에 그대로 남는다 — 읽는 규칙이 따로 있다", async () => {
    const { router } = setup(["/works/work-a?tab=zzz"]);
    await router.load();
    expect(router.state.location.search).toEqual({ tab: "zzz" });
  });

  it("작업을 옮기면 탭이 딸려가지 않는다", async () => {
    const { router } = setup(["/works/work-a?tab=terminal"]);
    await router.load();

    await router.navigate({ to: "/works/$slug", params: { slug: "work-b" }, search: {} });
    expect(router.state.location.search).toEqual({});
  });

  // 결정 14. `file` 검증기는 Works와 아카이브가 **일부러** 공유하지만 `tab`에는 그 이유가
  // 없다 — 아카이브에는 터미널이 없다. 공용 검증기를 넓히지 않았다는 것은 아카이브 화면이
  // `tab`을 **읽지 않는다**는 뜻이지 주소에서 지운다는 뜻이 아니다(위 줄과 같은 이유).
  it("아카이브 주소에서도 문서는 그대로 실린다", async () => {
    const { router } = setup(["/archive/치운-a?tab=terminal&file=record.md"]);
    await router.load();
    expect(router.state.location.search).toEqual({ tab: "terminal", file: "record.md" });
  });

  it("무선택 주소의 `?tab=`은 정규화가 떨어뜨린다", async () => {
    const { router } = setup(["/works?tab=terminal"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/works/work-a");
    expect(router.state.location.search).toEqual({});
  });

  // 알려진 구멍이다 — `works.index.tsx`에는 validateSearch가 없어서 목록이 비면 리다이렉트가
  // 안 돌고 `tab`이 주소에 남는다. 그려지는 화면은 빈 상태 안내라 아무 데도 안 쓰인다.
  it("목록이 비면 리다이렉트가 안 돌아 `tab`이 주소에 남는다", async () => {
    const { router } = setup(["/works?tab=terminal"], { works: [] });
    await router.load();
    expect(router.state.location.pathname).toBe("/works");
    expect(router.state.location.search).toEqual({ tab: "terminal" });
  });
});

// "뒤로 갈 수 있는가"는 라우터가 알려주지만 "앞으로"는 우리가 센다. 그 셈이 히스토리와
// 어긋나도 화면에서는 버튼 하나가 흐린지 아닌지로만 드러나 놓치기 쉬워서 여기서 고정한다.
//
// 여기서만 이동 방식이 다르다. 히스토리에 구독자가 하나라도 붙으면 라우터는 "누군가 나를
// 굴려준다"고 보고 이동 뒤 스스로 load하지 않는다 (router-core `router.js:429`의
// `if (!this.history.subscribers.size) this.load(...)`). 앱에서는 RouterProvider 안의
// Transitioner가 그 구독자이고, 이 블록에서는 앞으로가기 추적기가 그렇다.
// 그래서 위쪽 테스트들이 기대는 자동 load가 여기서는 오지 않는다 — 짝지어 돌리지 않으면
// navigate가 반환한 약속이 영원히 풀리지 않는다.
describe("앞으로 갈 수 있는가", () => {
  // 추적기는 최대치를 sessionStorage에 남긴다 (웹뷰가 다시 떠도 이어가려고).
  // Node에는 그게 없어 최소한만 흉내내고, 테스트마다 새로 만들어 앞 테스트가 남긴 값이 새지 않게 한다.
  beforeEach(() => {
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
      },
    });
  });

  const start = (entries: Array<string>) => {
    const { router, history } = setup(entries);
    // 첫 이동보다 먼저 붙여야 한다 — 앱에서 Transitioner가 첫 렌더에 붙는 것과 같다
    const canGoForward = trackCanGoForward(history);
    // 이동을 감싸 load를 대신 돌린다. navigate가 돌려준 약속은 load가 끝나야 풀리므로
    // 그냥 await하면 그 자리에서 멈춘다. 이동 옵션은 인자로 받지 않고 호출부에서 그대로
    // 넘기게 둔다 — 변수를 거치면 to와 params의 타입 연결이 끊어진다.
    const drive = async (committed: ReturnType<typeof router.navigate>) => {
      await router.load();
      await committed;
    };
    return { router, history, canGoForward, drive };
  };

  it("시작 직후에는 앞으로 갈 곳이 없다", async () => {
    const { router, canGoForward } = start(["/works/work-a"]);
    await router.load();
    expect(canGoForward.state).toBe(false);
  });

  it("뒤로 가면 생기고, 앞으로 가면 다시 없어진다", async () => {
    const { router, history, canGoForward, drive } = start(["/works/work-a"]);
    await router.load();

    await drive(router.navigate({ to: "/works/$slug", params: { slug: "work-b" } }));
    expect(canGoForward.state).toBe(false);

    await goBack(router, history);
    expect(canGoForward.state).toBe(true);

    await goForward(router, history);
    expect(canGoForward.state).toBe(false);
  });

  // 두 칸을 쌓고 두 칸을 되돌아온다. 한 칸이면 새 이동이 원래 최대치와 같은 자리에 떨어져,
  // 자르지 않는 구현도 우연히 같은 답을 낸다 — 그 상태로는 이 테스트가 헛돈다.
  it("뒤로 간 뒤 다른 곳으로 이동하면 앞이 잘린다", async () => {
    const { router, history, canGoForward, drive } = start(["/works/work-a"]);
    await router.load();

    await drive(router.navigate({ to: "/works/$slug", params: { slug: "work-b" } }));
    await drive(router.navigate({ to: "/projects/$slug", params: { slug: "proj-a" } }));
    await goBack(router, history);
    await goBack(router, history);
    expect(canGoForward.state).toBe(true);

    await drive(router.navigate({ to: "/projects/$slug", params: { slug: "proj-b" } }));
    expect(canGoForward.state).toBe(false);
  });

  // 뒤로 간 자리의 항목이 사라져 정규화가 일어나는 경우다. replace는 그 칸을 덮어쓸 뿐
  // 뒤따르는 항목을 지우지 않으므로, 앞으로 갈 곳은 그대로 남아 있어야 한다.
  it("제자리를 고쳐 쓰는 replace는 앞을 지우지 않는다", async () => {
    const { router, history, canGoForward, drive } = start(["/works/work-a"]);
    await router.load();

    await drive(router.navigate({ to: "/works/$slug", params: { slug: "work-b" } }));
    await goBack(router, history);

    await drive(router.navigate({ to: "/works/$slug", params: { slug: "work-b" }, replace: true }));
    expect(canGoForward.state).toBe(true);
  });

  // 앞으로가기도 한 칸씩만 움직이면 헛돈다 — 되돌아온 자리에서 한 칸 나아가면 그 자리가 곧
  // 최대치라, 앞으로가기가 최대치를 깎아내리는 구현도 같은 답을 낸다. 두 칸 되돌아와야 갈린다.
  it("두 칸 되돌아와 한 칸만 앞으로 가면 앞이 아직 남아 있다", async () => {
    const { router, history, canGoForward, drive } = start(["/works/work-a"]);
    await router.load();

    await drive(router.navigate({ to: "/works/$slug", params: { slug: "work-b" } }));
    await drive(router.navigate({ to: "/projects/$slug", params: { slug: "proj-a" } }));
    await goBack(router, history);
    await goBack(router, history);

    await goForward(router, history);
    expect(canGoForward.state).toBe(true);
  });

  // 웹뷰가 새로 뜨면(macOS 기본 우클릭 메뉴에 Reload가 있고 wry가 막지 않는다) 추적기는
  // 다시 만들어지지만 세션 히스토리는 그대로 남는다. 최대치를 세션에 남기지 않으면
  // 앞으로 갈 곳이 있는데도 버튼이 흐린 채 굳고, 되돌릴 방법이 마우스 사이드 버튼뿐이다.
  it("웹뷰가 새로 떠도 앞으로 갈 곳을 잊지 않는다", async () => {
    const { router, history, drive } = start(["/works/work-a"]);
    await router.load();
    await drive(router.navigate({ to: "/works/$slug", params: { slug: "work-b" } }));
    await goBack(router, history);

    // 새 히스토리가 곧 리로드다. 세션 히스토리는 살아남으므로 뒤따르던 항목도 그대로 있다 —
    // 항목이 하나뿐인 히스토리로 재현하면 forward()가 갈 곳이 없어, 되살린 숫자가 스택과
    // 같은 것을 가리키는지 검사하지 못한 채 초록이 된다.
    // (initialIndex: 0은 라이브러리가 falsy로 흘려버려 무시된다 — back()으로 옮긴다)
    const reloaded = createMemoryHistory({
      initialEntries: ["/works/work-a", "/works/work-b"],
    });
    reloaded.back();

    const canGoForward = trackCanGoForward(reloaded);
    expect(canGoForward.state).toBe(true);
    // 켜졌다고만 보지 않는다 — 실제로 그 칸으로 옮겨가고, 다 갔으면 꺼져야 한다
    reloaded.forward();
    expect(reloaded.location.pathname).toBe("/works/work-b");
    expect(canGoForward.state).toBe(false);
  });

  // 최대치를 세션에 남기는 일은 히스토리의 구독자 목록 안에서 돈다. 그 목록은 forEach로
  // 도므로 우리가 던지면 **뒤에 등록된 구독자가 아예 실행되지 않는다** — 앱에서 그 뒷사람은
  // 라우터의 load다. 주소만 바뀌고 화면은 안 따라오는, 되돌릴 수 없는 종류의 고장이다.
  // sessionStorage는 용량 한도에서 실제로 던진다(WKWebView 실측 5MiB).
  it("세션 저장이 실패해도 뒷사람이 실행되고 앞으로 버튼도 살아 있다", async () => {
    const { router, history, canGoForward, drive } = start(["/works/work-a"]);
    await router.load();
    await drive(router.navigate({ to: "/works/$slug", params: { slug: "work-b" } }));

    // 추적기 다음에 붙는다 — 앱에서 라우터의 load가 서 있는 자리다
    let laterRan = false;
    history.subscribe(() => {
      laterRan = true;
    });
    sessionStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    await goBack(router, history);
    expect(laterRan).toBe(true);
    expect(canGoForward.state).toBe(true);
  });

  // 이 파일이 그 환경이다 — 라우트 트리를 DOM 없는 Node에서 import해 돌린다.
  // 저장소가 아예 없어도 이번 세션의 앞으로가기는 그대로 동작해야 한다.
  it("sessionStorage가 없는 환경에서도 동작한다", async () => {
    Reflect.deleteProperty(globalThis, "sessionStorage");

    const { router, history, canGoForward, drive } = start(["/works/work-a"]);
    await router.load();
    await drive(router.navigate({ to: "/works/$slug", params: { slug: "work-b" } }));

    await goBack(router, history);
    expect(canGoForward.state).toBe(true);
  });
});
