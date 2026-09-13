import { useCallback, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import WorksPage from "@/features/works/WorksPage";
import { worksApi } from "@/features/works/api";
import {
  fileSearch,
  recallSearch,
  rememberView,
  splitSearch,
  tabSearch,
  viewSearch,
} from "./-work-search";
import type { SplitSide, ViewTab } from "./-work-search";
import { tabOfDrag } from "@/features/works/split-view";
import type { DragSource } from "@/features/works/split-view";
import { useWorks } from "@/features/works/hooks";
import { pickSlug, selectWork, shellStore } from "@/components/shell/shell-store";
import { routesOf } from "@/mode";
import type { Mode } from "@/mode";

// /works와 /works/$slug가 그리는 화면은 같다 — 다른 것은 어떤 작업이 선택됐는지뿐이다.
// **Maison의 Room 화면도 같은 이 컴포넌트다**: 두 세계가 다른 것은 어느 루트를 읽고 어느
// 주소로 옮기는가뿐이라, 화면을 두 벌로 두면 한쪽만 고치는 날이 온다.
// 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다.
function WorksView({
  mode,
  slug,
  file = null,
  tab = "spec",
  split = null,
}: {
  /** 어느 세계의 화면인가. 옮길 주소와 세션 기억의 칸이 여기서 나온다 — 라우트가 넘긴다. */
  mode: Mode;
  slug: string | null;
  file?: string | null;
  tab?: ViewTab;
  split?: SplitSide | null;
}) {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const { data: works = [], isPending, isFetching } = useWorks(mode);
  // 주소 리터럴이 박히는 자리는 모드 표 하나다 — 여기서 `/works/$slug`를 다시 적으면
  // Maison에서 문서를 고를 때마다 Atelier로 튄다.
  const routes = routesOf(mode);

  const exists = slug !== null && works.some((work) => work.slug === slug);

  // 작업을 옮길 때 보던 화면을 **기억에서 되살린다**(결정 77) — 문서·본문·분할 셋이다.
  // 떠나던 주소는 통째로 떨어진다: 문서 경로는 그 작업 안에서만 뜻이 있어서 딸려가면 새
  // 작업에 없는 파일을 가리킨 채 주소만 남는다. 되살리는 `file`은 기억이 slug별이라 언제나
  // **그 작업 자신의** 문서다. 주소를 짓는 자리가 여럿이라 씨앗은 `-work-search.ts`의
  // `recallSearch` 하나가 든다 — 그 머리말에 문이 몇이고 하나를 빠뜨리면 무엇이 나는지가 있다.
  const goTo = (next: string | null, replace = false) =>
    void (next
      ? navigate({
          to: routes.item,
          params: { slug: next },
          search: recallSearch(mode, next),
          replace,
        })
      : navigate({ to: routes.list, replace }));

  // 문서 전환. **트리 훑기는 히스토리를 만들지 않고(replace), 링크를 따라간 것은 만든다.**
  // 이슈 #25가 못박은 "파일 전환은 히스토리 항목을 만들지 않는다"는 트리를 두고 한 말이다 —
  // 그때는 문서를 옮기는 길이 트리뿐이었다. 링크는 따라 들어갔다는 감각이 있으므로
  // 돌아올 자리가 있어야 하고, 그 자리를 만드는 것이 push다.
  //
  // 주소를 고치는 몸통은 `fileSearch`다 — **함수형이어야 한다**(결정 15). 그 머리말에
  // 이 자리가 왜 오래 틀려 있었는지가 적혀 있다.
  const selectFile = useCallback(
    (path: string, push: boolean) => {
      if (slug === null) return;
      void navigate({
        to: routes.item,
        params: { slug },
        search: (prev: object) => fileSearch(prev, path),
        replace: !push,
      });
    },
    [navigate, routes.item, slug],
  );

  // 분할 전환 — 켜기·끄기·좌우 맞바꾸기가 전부 여기다(결정 97). **`tab`을 함께 받는다**:
  // 열의 `×`는 분할을 끄면서 **남는 쪽**을 정하고(결정 89), 토글은 지금 `tab`을 그대로 넘긴다.
  // 두 축을 한 navigate로 옮기는 것은 두 번 옮기면 한 틱에 겹쳐 앞의 것이 버려지기 때문이다.
  const selectSplit = useCallback(
    (next: SplitSide | null, nextTab: ViewTab) => {
      if (slug === null) return;
      void navigate({
        to: routes.item,
        params: { slug },
        search: (prev) => splitSearch(tabSearch(prev, nextTab), next),
        replace: true,
      });
    },
    [navigate, routes.item, slug],
  );

  // 사이드바에서 끌어다 놓은 것(결정 86). **남의 work을 떨궈도 성립한다**(결정 101) —
  // 그때는 work이 통째로 바뀌므로 `file`을 떨어뜨려야 하고, 같은 work이면 보던 문서를
  // 지켜야 한다. 그 갈림이 여기 하나뿐이라 `search`를 짓는 두 모양이 나란히 선다.
  // 남의 work 쪽에 기억을 안 얹는 것은 **끌어 놓은 배치가 곧 말한 것**이기 때문이다 —
  // 기억을 되세우는 것은 work 행을 눌러 옮기는 길의 일이다(위 `goTo`).
  const dropInto = useCallback(
    (source: DragSource, next: SplitSide) => {
      const nextTab = tabOfDrag(source.kind);
      void navigate({
        to: routes.item,
        params: { slug: source.slug },
        search:
          source.slug === slug
            ? (prev: object) => splitSearch(tabSearch(prev, nextTab), next)
            : viewSearch({}, { tab: nextTab, split: next, file: null }),
        replace: true,
      });
    },
    [navigate, routes.item, slug],
  );

  // 화면 탭 전환. 갱신 자체는 `tabSearch`가 안다 — **함수형이어야 한다**(결정 15).
  // `replace`인 것은 결정 13이다: 탭을 한 번 눌렀는데 되돌리는 데 뒤로가기를 두 번 눌러야
  // 하는 일이 없다.
  const selectTab = useCallback(
    (next: ViewTab) => {
      if (slug === null) return;
      void navigate({
        to: routes.item,
        params: { slug },
        search: (prev) => tabSearch(prev, next),
        replace: true,
      });
    },
    [navigate, routes.item, slug],
  );

  // **보던 화면을 적어 둔다**(결정 77·97). 쓰는 자리가 여기 하나인 것은 주소가 정본이기
  // 때문이다 — 화면을 옮기는 길이 사이드바의 `spec` 잎, 셸 행, ⌘1~9, ⌃Tab, 분할 토글,
  // 드래그로 여럿인데, 전부 주소를 바꾸므로 도착한 주소를 한 번 적으면 다 덮는다.
  useEffect(() => {
    if (slug !== null && exists) rememberView(mode, slug, { tab, split, file });
  }, [mode, slug, exists, tab, split, file]);

  // **그 work을 열었다고 코어에 적는다**(결정 12·14). 팔레트의 작업 층이 이 순서로 선다.
  //
  // **바로 위 effect에 얹지 않는다 — 의존성이 다르다.** 저쪽은 `[slug, exists, tab, split,
  // file]`이라 문서·탭·분할을 바꿀 때마다 다시 도는데, 여기 세는 단위는 **work**이다
  // (결정 12: 문서를 안 열고 터미널만 돌려도 「열었다」다). 얹으면 문서를 옮길 때마다 IPC와
  // 파일 쓰기가 나가고, 그 어긋남은 화면에 아무 티도 안 난다.
  //
  // **이 하나가 문 다섯을 전부 덮는다** — 팔레트 · 사이드바 · 주소 정규화 · 앱 시작 복원 ·
  // Projects의 work 행. 전부 주소를 바꾸므로 **도착한 주소**를 한 번 세면 다 덮인다.
  // 문마다 세면 한 문만 늙고, 그것이 「왜 얘가 위에 없지」로 나타난다(결정 14가 그 형식을
  // 요구하는 이유이고, 바로 위 검사 주석에 그 사고가 적혀 있다).
  //
  // **실패는 삼키되 이유를 남긴다.** 맨 `void`로 두면 미처리 rejection이 콘솔로 샌다.
  //
  // **이 파일에서 유일하게 `features/works/api`를 직접 문다** — 다른 자리는 전부
  // `features/works/hooks`를 지난다. 그쪽은 react-query 층이고, 이 부름은 **캐시에 닿지
  // 않는다**: 답이 없고, 화면이 이 값을 도로 읽지 않으며(순서를 세우는 것은 코어의 검색이다),
  // 무효화할 쿼리도 없다. `useMutation`으로 감싸면 effect 안에서 `mutate`를 부르는 자리가
  // 하나 늘 뿐 얻는 것이 없다. `invoke` 경계(=`features/*/api.ts`)는 그대로 지킨다.
  //
  // **세계가 의존성에 든다.** 이력은 세계마다 한 장이고(`maison/recent.json`) 두 세계에 같은
  // slug가 설 수 있으므로(결정 10), 모드가 갈리면 같은 slug라도 **다른 장부에 적어야 한다.**
  useEffect(() => {
    if (slug === null || !exists) return;
    void worksApi
      .touchRecent(mode, slug)
      .catch((err: unknown) => console.warn("최근 연 work을 적지 못했습니다", err));
  }, [mode, slug, exists]);

  // 주소와 화면을 목록 변화에 맞춰 계속 붙여 둔다.
  // beforeLoad는 이동할 때만 돌기 때문에, 머물러 있는 동안 목록이 바뀌어 생기는 어긋남은
  // 여기서만 고칠 수 있다 (react-query 무효화는 라우터를 다시 돌리지 않는다).
  useEffect(() => {
    // 실제로 띄운 작업을 기억해 둔다 — /works로 돌아왔을 때 여기로 정규화된다
    if (slug !== null && exists) {
      selectWork(mode, slug);
      return;
    }
    // 목록이 아직 오는 중이면 판단을 미룬다. 방금 만들어진 항목이 목록에 반영되기 전에
    // "사라졌다"고 오판하면 사용자를 엉뚱한 데로 보낸다.
    if (isPending || isFetching) return;
    // 주소가 실제 화면과 어긋나 있다. 둘 중 하나다 —
    //  (a) 무선택 주소인데 목록이 뒤늦게 채워졌다 (빈 상태로 열어둔 채 밖에서 작업을 시작한 경우)
    //  (b) 주소가 가리키는 작업이 사라졌다 (지워졌거나 잘못된 링크)
    const next = pickSlug(shellStore.state.workSlug[mode], works);
    if (next === slug) return; // 목록이 비어 여전히 무선택 — 고칠 것이 없다
    goTo(next, true);
    // goTo는 의존성에 넣지 않는다 — navigate 하나만 닫아 잡고 그건 라우터가 고정해준다
  }, [mode, slug, exists, isPending, isFetching, works]);

  return (
    <WorksPage
      mode={mode}
      sidebarOpen={sidebarOpen}
      selectedSlug={exists ? slug : null}
      currentFile={file}
      onSelectFile={selectFile}
      tab={tab}
      onSelectTab={selectTab}
      split={split}
      onSelectSplit={selectSplit}
      onDropInto={dropInto}
      onOpenProject={(project) =>
        void navigate({ to: "/projects/$slug", params: { slug: project } })
      }
    />
  );
}

export default WorksView;
