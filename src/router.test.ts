import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { worksQuery } from "./features/works/hooks";
import { projectsQuery } from "./features/projects/hooks";
import { archiveQuery } from "./features/archive/hooks";
import {
  lastMode,
  modeSwitchTarget,
  rememberVisit,
  shellMode,
  shellStore,
} from "./components/shell/shell-store";
import { trackCanGoForward } from "./can-go-forward";
import { recallSearch, rememberView, tabSearch } from "./routes/-work-search";
import type { ViewTab } from "./routes/-work-search";
import type { Mode } from "./mode";
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
// "draft:" 접두사를 붙인 slug는 초안이 된다 (기본 선택이 **안** 건너뛰는 대상 — UI개선 결정 6).
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
  /**
   * Maison 쪽 목록. 안 주면 Atelier의 것을 그대로 쓴다 — 두 세계에 같은 이름이 설 수 있어
   * (결정 10) 대부분의 케이스에는 그게 오히려 현실적이고, **갈라 주면 어느 캐시를 읽었는지**를
   * 잴 수 있다(「Maison은 Maison 목록으로 정규화한다」).
   */
  rooms?: Array<WorkView>;
  projects?: Array<ProjectView>;
  archives?: Array<ArchiveEntry>;
  /** 같은 이유로 갈라 둘 수 있는 Maison 아카이브 목록. */
  maisonArchives?: Array<ArchiveEntry>;
  lastWork?: string | null;
  /** Maison 쪽 칸. 같은 목록을 두 세계가 다른 기억으로 읽는 것이 이 티켓의 요점이다. */
  lastRoom?: string | null;
  lastProject?: string | null;
  lastArchive?: string | null;
}

/**
 * 이 파일은 DOM 없는 Node에서 돌아 localStorage가 **아예 없다.** 마지막 모드가 거기 살므로
 * 케이스마다 새로 심는다 — 전역이라 안 심으면 앞 케이스가 적어 둔 세계로 뒷 케이스가 뜬다.
 *
 * 돌려주는 것은 저장소의 속이다: 키 이름을 테스트가 베껴 적으면 그 이름이 바뀌는 날
 * 「모르는 값이 남아 있다」 케이스가 **빈 저장소**를 재고 초록이 된다.
 */
function installStorage(broken?: Partial<Storage>) {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
    ...broken,
  } as unknown as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  return values;
}

beforeEach(() => {
  installStorage();
});

function setup(initialEntries: Array<string>, options: SetupOptions = {}) {
  const queryClient = new QueryClient();
  // 캐시를 미리 채우면 beforeLoad의 ensureQueryData가 Tauri invoke 없이 그대로 돌려준다.
  // 목록이 정규화의 입력이므로, 이 seam에서 목록은 주입하는 값이다.
  //
  // **캐시가 모드별로 갈렸다**(`worksQuery(mode)`) — 두 칸을 다 심는다. 한쪽만 심으면 저쪽
  // 세계의 beforeLoad가 IPC를 타려다 node에서 빈 배열로 떨어져 「정규화가 안 된다」로만 보인다.
  const worksSeed = options.works ?? works("work-a", "work-b");
  const archiveSeed = options.archives ?? archives("치운-a", "치운-b");
  queryClient.setQueryData(worksQuery("atelier").queryKey, worksSeed);
  queryClient.setQueryData(worksQuery("maison").queryKey, options.rooms ?? worksSeed);
  queryClient.setQueryData(
    projectsQuery("atelier").queryKey,
    options.projects ?? projects("proj-a", "proj-b"),
  );
  queryClient.setQueryData(archiveQuery("atelier").queryKey, archiveSeed);
  queryClient.setQueryData(archiveQuery("maison").queryKey, options.maisonArchives ?? archiveSeed);
  // "이번 세션에서 마지막으로 보던 항목"도 정규화의 입력이다. 스토어는 모듈 싱글턴이라
  // 테스트마다 여기서 덮어써 이전 테스트가 남긴 값이 새지 않게 한다.
  shellStore.setState((state) => ({
    ...state,
    workSlug: { atelier: options.lastWork ?? null, maison: options.lastRoom ?? null },
    projectSlug: options.lastProject ?? null,
    archiveSlug: { atelier: options.lastArchive ?? null, maison: null },
    lastPlace: { atelier: null, maison: null },
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
// 진입은 무선택 주소를 한 번 더 거치므로 그쪽 규칙을 그대로 물려받는다.
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

// 앱을 다시 켜면 **떠났던 세계로 돌아온다**(결정 9). 위 describe의 케이스들이 Atelier로
// 가는 것은 저장소가 비어 있기 때문이다 — 그 기본값과 여기의 기억이 같은 함수에서 나온다.
describe("진입은 마지막 세계로 간다", () => {
  it("마지막이 Maison이었으면 Rooms의 첫 화면까지 정규화된다", async () => {
    // 앞 세션이 남긴 것. 적는 문이 하나뿐이라 테스트도 그 문으로 심는다 —
    // 저장소 키를 여기서 베껴 적으면 이름이 바뀌는 날 이 케이스가 빈 저장소를 잰다.
    rememberVisit("/maison/rooms/work-b");

    const { router } = setup(["/"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/maison/rooms/work-a");
  });

  it("저장소에 모르는 값이 남아 있으면 Atelier로 떨어진다", async () => {
    const stored = installStorage();
    rememberVisit("/maison/rooms/work-b");
    // 적힌 칸을 이름이 아니라 **있는 그대로** 찾아 더럽힌다
    for (const key of stored.keys()) stored.set(key, "wonderland");

    const { router } = setup(["/"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/works/work-a");
  });

  it("그 정규화도 히스토리를 늘리지 않는다 — 세계를 건너도 뒤로갈 곳이 없다", async () => {
    rememberVisit("/maison/rooms/work-b");

    const { router, history } = setup(["/"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/maison/rooms/work-a");
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
  });

  // 사생활 모드의 웹뷰는 localStorage가 **있는데 만지면 던진다.** 그때 죽는 것은 저장이
  // 아니라 앱이다 — 진입의 첫 줄이 이 읽기라 화면이 통째로 안 뜬다.
  it("저장소가 던져도 앱이 뜬다 — Atelier로 간다", async () => {
    installStorage({
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });

    const { router } = setup(["/"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/works/work-a");
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

// 초안도 다른 작업들 사이에 서므로(UI개선 결정 5) 기본 선택이 초안을 가리지 않는다(UI개선 결정 6) —
// **기억한 것 → 목록 첫 줄**, 그것이 초안이어도. 한때 초안을 건너뛰었는데, 그것은 초안이
// 접힌 별도 구역에 살아 거기로 떨어지면 강조가 안 보였기 때문이다. 구역이 사라진 지금
// 건너뛰면 도리어 보이는 첫 줄과 열리는 것이 갈린다.
describe("기본 선택은 초안이어도 목록 첫 줄이다", () => {
  it("마지막으로 보던 것이 없으면 첫 줄이 초안이어도 그리로 간다", async () => {
    const { router } = setup(["/works"], { works: works("draft:초안", "진행중"), lastWork: null });
    await router.load();
    expect(router.state.location.pathname).toBe("/works/초안");
  });

  it("초안밖에 없으면 첫 초안으로 간다", async () => {
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

// 두 세계가 **같은 규칙**을 쓴다 — 규칙을 라우트 파일마다 적었다면 여기서 갈렸을 자리다.
describe("Maison 무선택 주소의 정규화", () => {
  it("이번 세션에서 마지막으로 보던 Room으로 간다", async () => {
    const { router } = setup(["/maison/rooms"], { lastRoom: "work-b" });
    await router.load();
    expect(router.state.location.pathname).toBe("/maison/rooms/work-b");
  });

  it("처음 여는 것이면 첫 줄의 Room으로 간다 — 초안이어도", async () => {
    const { router } = setup(["/maison/rooms"], {
      works: works("draft:초안", "진행중"),
      lastRoom: null,
    });
    await router.load();
    expect(router.state.location.pathname).toBe("/maison/rooms/초안");
  });

  it("Room이 하나도 없으면 정규화하지 않고 머문다", async () => {
    const { router } = setup(["/maison/rooms"], { works: [] });
    await router.load();
    expect(router.state.location.pathname).toBe("/maison/rooms");
  });

  it("Maison 아카이브도 같은 규칙이다", async () => {
    const { router } = setup(["/maison/archive"]);
    await router.load();
    expect(router.state.location.pathname).toBe("/maison/archive/치운-a");
  });

  // **세션 기억을 모드별로 가른 이유가 이 한 줄이다.** 한 칸으로 들면 Atelier에서 보던
  // slug가 Maison 정규화의 입력이 되어, 같은 이름의 Room이 있으면 **다른 세계의 이름으로**
  // 열리고 없으면 첫 Room으로 떨어진다 — 화면은 멀쩡해 보인다.
  // 양쪽을 함께 잰다: 한쪽만 보면 두 칸을 맞바꾼 구현도 초록이다.
  // **목록도 세계별로 갈린다.** 캐시 키에서 모드를 빠뜨리면(또는 한 모드로 굳히면) 여기서
  // Atelier의 첫 항목이 나온다 — 그 이름의 Room이 없으면 화면이 빈 채로 서고, 우연히 있으면
  // **저쪽 세계의 이름을 가진 Room**이 열린다.
  it("Maison은 Maison 목록으로 정규화한다", async () => {
    const { router } = setup(["/maison/rooms"], {
      works: works("작업만"),
      rooms: works("방만"),
    });
    await router.load();
    expect(router.state.location.pathname).toBe("/maison/rooms/방만");
  });

  it("Maison 아카이브도 자기 목록으로 정규화한다", async () => {
    const { router } = setup(["/maison/archive"], {
      archives: archives("치운-작업"),
      maisonArchives: archives("치운-방"),
    });
    await router.load();
    expect(router.state.location.pathname).toBe("/maison/archive/치운-방");
  });

  it("Atelier의 마지막 slug가 Maison 정규화에 새지 않는다 — 반대도 마찬가지다", async () => {
    const maison = setup(["/maison/rooms"], { lastWork: "work-b", lastRoom: null });
    await maison.router.load();
    expect(maison.router.state.location.pathname).toBe("/maison/rooms/work-a");

    const atelier = setup(["/works"], { lastWork: null, lastRoom: "work-b" });
    await atelier.router.load();
    expect(atelier.router.state.location.pathname).toBe("/works/work-a");
  });
});

// **두 세계에 같은 이름이 설 수 있다**(결정 10). 그때 work의 문서·탭·분할 기억이 Room을 여는
// 주소에 실리면, Room에 없는 문서 경로가 주소에 박힌 채 엉뚱한 분할로 열린다 — 화면으로는
// 「가끔 다른 문서가 떠 있다」로만 보인다.
//
// **여는 씨앗은 view가 쓰는 그 함수를 그대로 부른다**(위 `pick`과 같은 규칙) — 합성 모양을
// 여기 베껴 적으면 실제 이동이 퇴화해도 이 검사는 초록이다. 그 함수를 view가 실제로 부르는지,
// 그리고 모드를 굳히지 않았는지는 `-work-search.test.ts`의 배선 검사가 든다(그 층에 박힌
// 세계가 하나도 없다).
describe("같은 이름의 work과 Room", () => {
  const openWork = (slug: string) =>
    ({ to: "/works/$slug", params: { slug }, search: recallSearch("atelier", slug) }) as const;
  const openRoom = (slug: string) =>
    ({ to: "/maison/rooms/$slug", params: { slug }, search: recallSearch("maison", slug) }) as const;

  it("문서·탭·분할 기억을 서로 덮어쓰지 않는다", async () => {
    // Atelier work `겹친이름`을 터미널·분할·문서로 두고 떠난 상태.
    rememberView("atelier", "겹친이름", { tab: "terminal", split: "rl", file: "작업/spec.md" });

    const { router } = setup(["/maison/rooms"], {
      works: works("겹친이름"),
      rooms: works("겹친이름"),
    });
    await router.load();

    // 같은 이름의 Room을 연다 — 저쪽 세계의 기억이 씨앗에 실리면 여기서 드러난다.
    await router.navigate(openRoom("겹친이름"));
    expect(router.state.location.pathname).toBe("/maison/rooms/겹친이름");
    expect(router.state.location.search).toEqual({});

    // 반대 방향도 함께 잰다 — Room을 여는 것이 work의 기억을 지우지도 않는다.
    await router.navigate(openWork("겹친이름"));
    expect(router.state.location.search).toEqual({
      tab: "terminal",
      split: "rl",
      file: "작업/spec.md",
    });
  });
});

// 세그먼트가 저쪽 세계로 건너갈 때 어디로 데려갈지가 이 칸에서 나온다(그것을 읽어 실제로
// 건너는 것은 아래 describe다). 적는 자리가 라우트 트리의 뿌리 하나라, 화면이 늘어도 함께
// 늘지 않는다.
describe("모드별 마지막 주소", () => {
  it("도착한 주소가 그 세계의 칸에만 적힌다", async () => {
    const { router } = setup(["/works/work-a"]);
    await router.load();
    expect(shellStore.state.lastPlace).toEqual({ atelier: "/works/work-a", maison: null });

    await router.navigate({ to: "/maison/rooms/$slug", params: { slug: "work-b" } });
    expect(shellStore.state.lastPlace).toEqual({
      atelier: "/works/work-a",
      maison: "/maison/rooms/work-b",
    });
  });

  // 설정에는 모드 접두사가 없어 `modeOf`가 Atelier로 눕힌다. 그 기본값을 적으면 **Maison에서
  // 설정을 한 번 열었다는 이유로** 다음 실행이 Atelier로 뜨고, 세그먼트도 저쪽을 켠다.
  it("설정은 어느 칸에도 안 적힌다 — 마지막 세계도 그대로다", async () => {
    const { router } = setup(["/maison/rooms/work-a"]);
    await router.load();

    await router.navigate({ to: "/settings" });
    expect(shellStore.state.lastPlace).toEqual({
      atelier: null,
      maison: "/maison/rooms/work-a",
    });
    expect(lastMode()).toBe("maison");
  });

  // 적히지 않는다는 것과 **셸이 무엇을 드는가**는 다른 물음이다. 그 화면에서도 nav는 무언가를
  // 그려야 하고(세그먼트도 곧 그렇다 — #183), `modeOf`로 물으면 `/settings`가 언제나 Atelier라
  // Maison에서 설정을 거쳐 nav의 `Archive`를 누른 순간 Atelier의 `/archive`로 간다.
  // 마지막 모드는 여전히 Maison인데 화면만 조용히 세계를 건너는 것이다.
  it("설정 화면의 셸은 떠나온 세계를 이어 든다", async () => {
    const { router } = setup(["/maison/rooms/work-a"]);
    await router.load();
    expect(shellMode(router.state.location.pathname)).toBe("maison");

    await router.navigate({ to: "/settings" });
    expect(shellMode(router.state.location.pathname)).toBe("maison");
  });

  // 반대쪽도 함께 못 박는다 — 늘 `lastMode()`를 쓰는 변형은 위 검사만으로는 초록이다.
  // 세계를 싣는 주소에서는 저장소를 **아예 안 봐야** 한다.
  //
  // **라우터를 안 태운다.** 도착하면 `rememberVisit`이 그 세계를 곧바로 적어 버려서, 저장소와
  // 주소가 어긋난 순간이 관찰 전에 사라진다 — 그 어긋남이 바로 이 검사의 전부다.
  it("세계를 싣는 주소는 저장소가 아니라 주소가 정한다", () => {
    rememberVisit("/maison/rooms/work-b"); // 저장소는 Maison
    expect(shellMode("/works/work-a")).toBe("atelier");
    expect(shellMode("/maison/rooms/work-a")).toBe("maison");
  });
});

// 세그먼트를 눌러 세계를 건너는 일. **히스토리가 절반이다** — 어디에 도착하는가만큼이나 몇
// 칸이 쌓이는가가 규칙이고, 그쪽이 틀리면 화면은 멀쩡한데 뒤로가기만 이상해진다(뒤로가기를
// 여러 번 눌러야 이쪽으로 돌아오거나, 눌러도 화면이 그대로인 죽은 칸이 생긴다).
describe("세그먼트가 세계를 건넌다", () => {
  // 세그먼트를 누른 것과 같은 일. **규칙을 여기 안 적는다** — 목적지도 「같은 세계면 안 간다」도
  // `modeSwitchTarget` 하나가 답하고, 셸(`AppShell`의 `onPickMode`)이 하는 것도 이 두 줄이다.
  // 규칙을 이 파일에 베껴 적으면 그 함수가 무엇으로 바뀌어도 아래 케이스들이 초록으로 남는다.
  const pick = async (router: ReturnType<typeof setup>["router"], from: Mode, to: Mode) => {
    const go = modeSwitchTarget(from, to);
    if (go) await router.navigate(go);
  };

  it("한 칸 건너가고, 뒤로가기가 이쪽으로 돌아온다", async () => {
    const { router, history } = setup(["/works/work-a"]);
    await router.load();
    expect(history.length).toBe(1);

    await pick(router, "atelier", "maison");
    // 저쪽에 마지막 주소가 없으니 첫 화면이다. 그 주소는 무선택이라 정규화를 한 번 더 타지만
    // 그 리다이렉트가 replace라(위 「정규화는 히스토리를 늘리지 않는다」) 칸은 하나만 는다.
    expect(router.state.location.pathname).toBe("/maison/rooms/work-a");
    expect(history.length).toBe(2);

    await goBack(router, history);
    expect(router.state.location.pathname).toBe("/works/work-a");

    await goForward(router, history);
    expect(router.state.location.pathname).toBe("/maison/rooms/work-a");
  });

  it("같은 세계를 다시 골라도 아무 데도 안 간다", async () => {
    const { router, history } = setup(["/works/work-a"]);
    await router.load();

    await pick(router, "atelier", "atelier");
    expect(router.state.location.pathname).toBe("/works/work-a");
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
  });

  // 마지막 주소가 없을 때 첫 화면으로 가는 것은 위 첫 케이스가 잰다. 여기서 재는 것은 그
  // 반대쪽이다 — **첫 화면이 아닌 곳**으로 가야 기억을 읽었다는 뜻이 된다.
  it("건너간 곳은 그 세계의 마지막 주소다", async () => {
    const { router } = setup(["/works/work-a"], { rooms: works("room-a", "room-b") });
    await router.load();

    // 저쪽 세계에서 첫 화면이 아닌 곳에 서 본다. **도착이 곧 기억이다**(`rememberVisit`) —
    // `lastPlace`를 손으로 심으면 다음 `router.load()`가 뿌리의 `beforeLoad`에서 다시 덮어써,
    // 무엇을 재고 있는지가 실행 순서에 달린다.
    await router.navigate({ to: "/maison/rooms/$slug", params: { slug: "room-b" } });
    await pick(router, "maison", "atelier");
    expect(router.state.location.pathname).toBe("/works/work-a");

    await pick(router, "atelier", "maison");
    // 첫 화면이었다면 `/maison/rooms/room-a`다 — 목록 첫 Room이 그것이고, 이 세션의 Room
    // 기억(`workSlug.maison`)은 화면이 적는 것이라 라우터만 태운 여기서는 비어 있다.
    expect(router.state.location.pathname).toBe("/maison/rooms/room-b");
  });

  // **가드가 실제로 무는 자리가 여기다.** 다른 화면에서는 그 세계의 마지막 주소가 곧 지금
  // 주소라, 가드가 없어도 제자리를 고쳐 쓰고 마는 이동이 된다. 설정은 어느 칸에도 안 적히므로
  // (`rememberVisit`) 마지막 주소가 **떠나온 그 화면**이고, 그래서 가드가 없으면 켜져 있는
  // 칸을 누른 것만으로 설정을 떠난다.
  it("설정에서 떠나온 세계를 다시 골라도 안 움직인다", async () => {
    const { router, history } = setup(["/maison/rooms/work-a"]);
    await router.load();
    await router.navigate({ to: "/settings" });
    const length = history.length;

    // 설정은 세계를 안 싣는 주소라, 셸이 드는 세계가 곧 떠나온 세계다.
    const here = shellMode(router.state.location.pathname);
    expect(here).toBe("maison");

    await pick(router, here, "maison");
    expect(router.state.location.pathname).toBe("/settings");
    expect(history.length).toBe(length);
  });

  it("설정에서 저쪽을 고르면 그 세계로 건너간다", async () => {
    const { router } = setup(["/maison/rooms/work-a"]);
    await router.load();
    await router.navigate({ to: "/settings" });

    await pick(router, shellMode(router.state.location.pathname), "atelier");
    // Atelier에는 아직 마지막 주소가 없다 — 첫 화면으로 간다.
    expect(router.state.location.pathname).toBe("/works/work-a");
  });

  // **왕복이 기억을 지우면 안 된다.** `lastPlace`가 드는 것은 pathname뿐이라, 세그먼트가 씨앗
  // 없이 이동하면 빈 `search`로 도착하고 그 순간 도착 주소를 적어 두는 effect가 기본값으로
  // 기억을 덮어쓴다 — 손해가 그 한 번의 왕복에서 안 끝난다: 그 뒤에 사이드바 행이나 팔레트로
  // 열어도 `recallSearch`가 방금 덮어써진 기본값을 돌려주므로 결정 77·97이 그 work에 대해
  // 영영 풀린다. **pathname만 재는 위 케이스들은 그 변형에 전부 초록이다.**
  it("저쪽에 다녀와도 그 work의 마지막 화면이 안 지워진다", async () => {
    const { router } = setup(["/works/work-a"]);
    await router.load();

    // 터미널을 보던 중이다 — 이 기억을 심는 것도 **도착이다**(`-works-view`의 effect가 라우터
    // 밖이라 여기서는 손으로 적는다. 씨앗이 실제로 실려 오는지는 도착 주소로 잰다).
    rememberView("atelier", "work-a", { tab: "terminal", split: null, file: "spec/notes.md" });

    await pick(router, "atelier", "maison");
    await pick(router, "maison", "atelier");

    expect(router.state.location.pathname).toBe("/works/work-a");
    // 씨앗이 주소에 실려 왔다 — 실리지 않았다면 여기가 `{}`이고, 그 빈 주소가 곧 기억을 덮어쓴다.
    expect(router.state.location.search).toEqual({ tab: "terminal", file: "spec/notes.md" });
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

// 설정은 목록도 선택도 없는 화면이라(결정 51·52) 위 규칙 둘이 **걸리지 않아야 한다** —
// 무선택 주소 정규화도, 마지막으로 보던 항목도 여기엔 없다. 그리고 사이드바 바닥과 네이티브
// 메뉴(⌘,) 둘이 같은 이동을 하므로, 그 이동이 히스토리에 어떻게 남는지가 두 자리의 공통
// 계약이다 — AppShell이 nav 항목에만 「이미 그 화면이면 가만히 있는다」 가드를 두고 설정에는
// 두지 않은 근거가 아래 마지막 줄이다.
describe("설정 화면의 주소", () => {
  it("`/settings`로 들어오면 그대로 머문다 — 정규화가 건드리지 않는다", async () => {
    const { router } = setup(["/settings"], { lastWork: "work-b" });
    await router.load();
    expect(router.state.location.pathname).toBe("/settings");
    expect(router.state.location.search).toEqual({});
    // 주소만 보면 **라우트가 없어도 초록이다** — 못 찾은 주소도 위치는 그대로 남는다.
    // 실제로 그 화면에 닿았는지는 매치를 봐야 안다.
    expect(router.state.matches.map((match) => match.routeId)).toContain("/settings");
  });

  // 터미널을 쓰다 ⌘,로 열고 되돌아오는 흐름이다 — 한 칸이어야 뒤로가기 한 번에 돌아온다.
  it("설정을 열면 한 칸이 남고 뒤로가기로 보던 작업에 돌아온다", async () => {
    const { router, history } = setup(["/works/work-a"]);
    await router.load();

    await router.navigate({ to: "/settings" });
    expect(router.state.location.pathname).toBe("/settings");
    expect(history.length).toBe(2);

    await goBack(router, history);
    expect(router.state.location.pathname).toBe("/works/work-a");
  });

  it("이미 설정에 있을 때 다시 열어도 히스토리가 늘지 않는다", async () => {
    const { router, history } = setup(["/settings"]);
    await router.load();

    await router.navigate({ to: "/settings" });
    expect(history.length).toBe(1);
    expect(history.canGoBack()).toBe(false);
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
