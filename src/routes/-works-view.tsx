import { useCallback, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import WorksPage from "@/features/works/WorksPage";
import {
  fileSearch,
  recallView,
  rememberView,
  splitSearch,
  tabSearch,
  viewSearch,
} from "./-work-search";
import type { SplitSide, ViewTab } from "./-work-search";
import { tabOfDrag } from "@/features/works/split-view";
import type { DragSource } from "@/features/works/split-view";
import { isDefaultSelectable, useWorks } from "@/features/works/hooks";
import { pickSlug, selectWork, shellStore } from "@/components/shell/shell-store";

// /works와 /works/$slug가 그리는 화면은 같다 — 다른 것은 어떤 작업이 선택됐는지뿐이다.
// 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다.
function WorksView({
  slug,
  file = null,
  tab = "spec",
  split = null,
}: {
  slug: string | null;
  file?: string | null;
  tab?: ViewTab;
  split?: SplitSide | null;
}) {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const { data: works = [], isPending, isFetching } = useWorks();

  const exists = slug !== null && works.some((work) => work.slug === slug);

  // 작업을 옮길 때 `file`은 떨어뜨리고 `tab`은 **기억에서 되살린다**(결정 77). 문서 경로는
  // 그 작업 안에서만 뜻이 있어서 딸려가면 새 작업에 없는 파일을 가리킨 채 주소만 남지만,
  // 「무엇을 보고 있었나」는 어느 작업에나 있는 값이다. 주소를 짓는 자리가 여기와
  // 사이드바 둘이라 씨앗을 `-work-search.ts` 한 곳에 뒀다.
  const goTo = (next: string | null, replace = false) =>
    void (next
      ? navigate({
          to: "/works/$slug",
          params: { slug: next },
          search: viewSearch({}, recallView(next)),
          replace,
        })
      : navigate({ to: "/works", replace }));

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
        to: "/works/$slug",
        params: { slug },
        search: (prev: object) => fileSearch(prev, path),
        replace: !push,
      });
    },
    [navigate, slug],
  );

  // 분할 전환 — 켜기·끄기·좌우 맞바꾸기가 전부 여기다(결정 97). **`tab`을 함께 받는다**:
  // 열의 `×`는 분할을 끄면서 **남는 쪽**을 정하고(결정 89), 토글은 지금 `tab`을 그대로 넘긴다.
  // 두 축을 한 navigate로 옮기는 것은 두 번 옮기면 한 틱에 겹쳐 앞의 것이 버려지기 때문이다.
  const selectSplit = useCallback(
    (next: SplitSide | null, nextTab: ViewTab) => {
      if (slug === null) return;
      void navigate({
        to: "/works/$slug",
        params: { slug },
        search: (prev) => splitSearch(tabSearch(prev, nextTab), next),
        replace: true,
      });
    },
    [navigate, slug],
  );

  // 사이드바에서 끌어다 놓은 것(결정 86). **남의 work을 떨궈도 성립한다**(결정 101) —
  // 그때는 work이 통째로 바뀌므로 `file`을 떨어뜨려야 하고, 같은 work이면 보던 문서를
  // 지켜야 한다. 그 갈림이 여기 하나뿐이라 `search`를 짓는 두 모양이 나란히 선다.
  const dropInto = useCallback(
    (source: DragSource, next: SplitSide) => {
      const nextTab = tabOfDrag(source.kind);
      void navigate({
        to: "/works/$slug",
        params: { slug: source.slug },
        search:
          source.slug === slug
            ? (prev: object) => splitSearch(tabSearch(prev, nextTab), next)
            : viewSearch({}, { tab: nextTab, split: next }),
        replace: true,
      });
    },
    [navigate, slug],
  );

  // 화면 탭 전환. 갱신 자체는 `tabSearch`가 안다 — **함수형이어야 한다**(결정 15).
  // `replace`인 것은 결정 13이다: 탭을 한 번 눌렀는데 되돌리는 데 뒤로가기를 두 번 눌러야
  // 하는 일이 없다.
  const selectTab = useCallback(
    (next: ViewTab) => {
      if (slug === null) return;
      void navigate({
        to: "/works/$slug",
        params: { slug },
        search: (prev) => tabSearch(prev, next),
        replace: true,
      });
    },
    [navigate, slug],
  );

  // **보던 화면을 적어 둔다**(결정 77·97). 쓰는 자리가 여기 하나인 것은 주소가 정본이기
  // 때문이다 — 화면을 옮기는 길이 사이드바의 `spec` 잎, 셸 행, ⌘1~9, ⌃Tab, 분할 토글,
  // 드래그로 여럿인데, 전부 주소를 바꾸므로 도착한 주소를 한 번 적으면 다 덮는다.
  useEffect(() => {
    if (slug !== null && exists) rememberView(slug, { tab, split });
  }, [slug, exists, tab, split]);

  // 주소와 화면을 목록 변화에 맞춰 계속 붙여 둔다.
  // beforeLoad는 이동할 때만 돌기 때문에, 머물러 있는 동안 목록이 바뀌어 생기는 어긋남은
  // 여기서만 고칠 수 있다 (react-query 무효화는 라우터를 다시 돌리지 않는다).
  useEffect(() => {
    // 실제로 띄운 작업을 기억해 둔다 — /works로 돌아왔을 때 여기로 정규화된다
    if (slug !== null && exists) {
      selectWork(slug);
      return;
    }
    // 목록이 아직 오는 중이면 판단을 미룬다. 방금 만들어진 항목이 목록에 반영되기 전에
    // "사라졌다"고 오판하면 사용자를 엉뚱한 데로 보낸다.
    if (isPending || isFetching) return;
    // 주소가 실제 화면과 어긋나 있다. 둘 중 하나다 —
    //  (a) 무선택 주소인데 목록이 뒤늦게 채워졌다 (빈 상태로 열어둔 채 밖에서 작업을 시작한 경우)
    //  (b) 주소가 가리키는 작업이 사라졌다 (지워졌거나 잘못된 링크)
    const next = pickSlug(shellStore.state.workSlug, works, isDefaultSelectable);
    if (next === slug) return; // 목록이 비어 여전히 무선택 — 고칠 것이 없다
    goTo(next, true);
    // goTo는 의존성에 넣지 않는다 — navigate 하나만 닫아 잡고 그건 라우터가 고정해준다
  }, [slug, exists, isPending, isFetching, works]);

  return (
    <WorksPage
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
