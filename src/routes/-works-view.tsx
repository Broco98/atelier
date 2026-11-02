import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import WorksPage from "@/features/works/WorksPage";
import { worksApi } from "@/features/works/api";
import { threadQuery, useThreads } from "@/features/thread/hooks";
import { lastSaid } from "@/features/thread/preview";
import { linesOf, threadRecordStore } from "@/features/thread/thread-store";
import { landingOf } from "@/features/thread/work-threads";
import {
  bundleSearch,
  chatHome,
  chatSearch,
  codeRefOf,
  codeSearch,
  columnSearch,
  fileSearch,
  openingSearch,
  recallSearch,
  rememberView,
  tabSearch,
} from "./-work-search";
import type { BundleShown, ColumnTab, SplitSide, ViewTab } from "./-work-search";
import { tabOfDrag } from "@/features/works/split-view";
import type { DragSource } from "@/lib/pointer-drag";
import { slugOfOwner } from "@/features/terminal/shell-registry";
import { useWorks } from "@/features/works/hooks";
import { pickSlug, selectWork, shellStore } from "@/components/shell/shell-store";

// /works와 /works/$slug가 그리는 화면은 같다 — 다른 것은 어떤 작업이 선택됐는지뿐이다.
// 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다.
function WorksView({
  slug,
  file = null,
  tab = "chat",
  split = null,
  code = null,
  thread = null,
}: {
  slug: string | null;
  file?: string | null;
  tab?: ViewTab;
  split?: SplitSide | null;
  /** 주소가 말하는 파일 탭(`<프로젝트>/<경로>`) — 본문(`tab=code`)이나 분할의 묶음 열에 선 것이다(git-integration S12). */
  code?: string | null;
  /** 주소가 말하는 채팅 탭의 채팅 — 본문(`tab=chat`)이나 분할의 묶음 열에 선 것이다(restart 02a-4). */
  thread?: string | null;
}) {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const { data: works = [], isPending, isFetching } = useWorks();

  const exists = slug !== null && works.some((work) => work.slug === slug);

  // 작업을 옮길 때 보던 화면을 **기억에서 되살린다**(결정 77) — 문서·본문·분할 셋이다.
  // 떠나던 주소는 통째로 떨어진다: 문서 경로는 그 작업 안에서만 뜻이 있어서 딸려가면 새
  // 작업에 없는 파일을 가리킨 채 주소만 남는다. 되살리는 `file`은 기억이 slug별이라 언제나
  // **그 작업 자신의** 문서다. 주소를 짓는 자리가 여럿이라 씨앗은 `-work-search.ts`의
  // `recallSearch` 하나가 든다 — 그 머리말에 문이 몇이고 하나를 빠뜨리면 무엇이 나는지가 있다.
  const goTo = (next: string | null, replace = false) =>
    void (next
      ? navigate({
          to: "/works/$slug",
          params: { slug: next },
          search: recallSearch(next),
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

  /**
   * **파일 탭 열기**(git-integration 판 01 — 「파일 탭 열기」 함수 하나). 프로젝트와 워크트리 기준 경로를 받아 그 파일 탭으로 간다 —
   * 묶음에 없으면 끝에 열리고, 있으면 그 탭이 지금 탭이 된다(그 일은 주소를 받은 화면이 한다 — 주소가 정본이다, S12).
   *
   * `push`가 둘을 가른다: 트리에서 여는 것은 **replace**(파일 스무 개를 넘겨 봐도 뒤로가기 한 번 — 스토리 59), 링크를 따라간
   * 것은 **push**다(돌아올 자리가 있어야 한다 — 문서 링크와 같다). 탭 줄 · 단축키도 replace다(결정 13 — 탭을 고르는 손짓은
   * 기록을 안 쌓는다). 분할 중이면 그 파일이 묶음 열에 선다(`codeSearch` — git-integration 티켓 07).
   */
  const openCodeTab = useCallback(
    (project: string, path: string, push: boolean) => {
      if (slug === null) return;
      void navigate({
        to: "/works/$slug",
        params: { slug },
        search: (prev: object) => codeSearch(prev, codeRefOf({ project, path })),
        replace: !push,
      });
    },
    [navigate, slug],
  );

  /**
   * **채팅 탭 열기**(restart 02a-4) — 「파일 탭 열기」와 한 벌이다. 그 채팅 탭으로 가고, 묶음에 없으면 끝에 열리고 있으면 그 탭이 지금
   * 탭이 된다(그 일은 주소를 받은 화면이 한다 — 주소가 정본이다). 탭 줄 · 단축키의 손짓이라 replace다(결정 13).
   */
  const openChatTab = useCallback(
    (next: string) => {
      if (slug === null) return;
      void navigate({
        to: "/works/$slug",
        params: { slug },
        search: (prev: object) => chatSearch(prev, next),
        replace: true,
      });
    },
    [navigate, slug],
  );

  // 분할 전환 — 켜기·끄기·좌우 맞바꾸기 · 열 고르기가 전부 여기다(결정 97). **열과 묶음 열을 함께 받는다**:
  // 열의 `×`는 분할을 끄면서 **남는 쪽**을 정하고(결정 89), 토글은 지금 열을 그대로 넘긴다. 묶음 열에 설 묶음의 지금 탭
  // (`bundle`)은 화면만 안다 — 묶음은 메모리에 산다(git-integration 티켓 07, `columnSearch`).
  // 축을 한 navigate로 옮기는 것은 두 번 옮기면 한 틱에 겹쳐 앞의 것이 버려지기 때문이다.
  const selectSplit = useCallback(
    (next: SplitSide | null, column: ColumnTab, bundle: BundleShown) => {
      if (slug === null) return;
      void navigate({
        to: "/works/$slug",
        params: { slug },
        search: (prev) => columnSearch(prev, next, column, bundle),
        replace: true,
      });
    },
    [navigate, slug],
  );

  // 묶음의 지금 탭이 묶음 쪽에서 바뀌었다 — 지금 탭을 닫아 이웃이 켜졌거나, 셸이 스스로 끝났거나, 끌어 놓은 칸이 켜졌다
  // (git-integration 결정 30). 본문이나 묶음 열이 그 탭을 따라간다. 고칠 것을 `prev`에서만 읽는 까닭은 `bundleSearch` 머리말에 있다.
  const followBundle = useCallback(
    (bundle: BundleShown) => {
      if (slug === null) return;
      void navigate({
        to: "/works/$slug",
        params: { slug },
        search: (prev) => bundleSearch(prev, bundle),
        replace: true,
      });
    },
    [navigate, slug],
  );

  // 사이드바에서 끌어다 놓은 것(결정 86). **남의 work을 떨궈도 성립한다**(결정 101) —
  // 그때는 work이 통째로 바뀌므로 `file`을 떨어뜨려야 하고, 같은 work이면 보던 문서를
  // 지켜야 한다. 그 갈림이 여기 하나뿐이라 `search`를 짓는 두 모양이 나란히 선다.
  // 남의 work 쪽에 기억을 안 얹는 것은 **끌어 놓은 배치가 곧 말한 것**이기 때문이다 —
  // 기억을 되세우는 것은 work 행을 눌러 옮기는 길의 일이다(위 `goTo`).
  //
  // 원천은 slug가 아니라 **owner**를 싣는다(공용 제스처 — `/terminal` 셸에는 slug가 없다).
  // 이 층은 두 기능 폴더를 다 부를 수 있어 여기서 slug를 되뽑는다(`slugOfOwner`). slug가 없으면
  // (최상위 터미널의 빈 글자) 갈 work이 없다 — 아무것도 안 한다.
  //
  // 묶음 열에 설 탭(`bundle`)은 놓은 쪽이 안다 — 파일 탭을 끌었으면 그 파일, 셸이면 셸, 문서 칸이면 묶음의 지금 탭이다.
  const dropInto = useCallback(
    (source: DragSource, next: SplitSide, bundle: BundleShown) => {
      const target = slugOfOwner(source.owner);
      if (target === null) return;
      const column = tabOfDrag(source.kind);
      void navigate({
        to: "/works/$slug",
        params: { slug: target },
        search:
          target === slug
            ? (prev: object) => columnSearch(prev, next, column, bundle)
            : columnSearch({}, next, column, bundle),
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
    if (slug !== null && exists) rememberView(slug, { tab, split, file, code, thread });
  }, [slug, exists, tab, split, file, code, thread]);

  // **작업공간을 처음 여는 규칙**(restart 02a-4) — 어느 채팅인지 모르는 채팅 탭(값이 없는 주소 — 기본 값이 채팅이다)에 닿으면 가장 최근
  // 채팅 탭 하나를 세우고 주소를 고친다. 채팅이 없는 작업공간은 **임시로** spec이다(02a-8이 새 채팅 탭으로 바꾼다 — `openingSearch`).
  // 「가장 최근」은 사이드바 작업공간 줄과 같은 규칙이다(`landingOf` — 마지막 말의 때). 그 말은 이미 읽어 둔 기록에서 이 순간에
  // 센다 — 기록 줄마다 이 화면이 다시 그려지지 않게 구독하지 않는다. 주소만 고치므로 replace다.
  //
  // 채팅 목록을 아직 못 읽었으면 기다린다 — 「채팅이 없다」로 읽으면 채팅이 있는 작업공간이 spec으로 열린다. 읽기가 실패하면 빈
  // 목록으로 친다.
  const { data: threads, isPending: threadsPending } = useThreads();
  const opening = slug !== null && exists && tab === "chat" && thread === null && !threadsPending;
  useEffect(() => {
    if (!opening || slug === null) return;
    const records = threadRecordStore.state;
    const landing = landingOf(threads ?? [], slug, (id) => lastSaid(linesOf(records, id))?.at ?? null);
    void navigate({
      to: "/works/$slug",
      params: { slug },
      search: (prev: object) => openingSearch(prev, landing),
      replace: true,
    });
  }, [opening, slug]);

  // **켜진 채팅 탭이 이 작업공간을 떠났다**(restart 02a-4) — 그 작업공간이 보관되거나 지워졌으면(코어의 `gone`) 그 채팅의 `/threads/:id`로
  // 옮긴다. 그 채팅은 읽기만 되는 채팅으로 거기 선다. 판단은 목록이 아니라 그 채팅의 값으로 한다(`chatHome`) — 목록은 방금 만든 작업공간을
  // 아직 모를 수 있다. 다른 작업공간에 이은 채팅이나 열 수 없는 채팅을 가리키는 주소도 그 채팅의 주소로 보낸다 — 그 자리가 다시 맞는
  // 곳으로 보내거나 까닭을 말한다.
  const { data: chatView, isError: chatMissing } = useQuery({ ...threadQuery(thread ?? ""), enabled: thread !== null });
  const chatLeft = slug !== null && thread !== null && (chatMissing || (chatView !== undefined && chatHome(chatView) !== slug));
  useEffect(() => {
    if (!chatLeft || thread === null) return;
    void navigate({ to: "/threads/$id", params: { id: thread }, replace: true });
  }, [chatLeft, thread]);

  // **그 work을 열었다고 코어에 적는다**(결정 12·14). 팔레트의 작업 층이 이 순서로 선다.
  //
  // **바로 위 effect에 얹지 않는다 — 의존성이 다르다.** 저쪽은 `[slug, exists, tab, split,
  // file, code]`라 문서·탭·분할을 바꿀 때마다 다시 도는데, 여기 세는 단위는 **work**이다
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
  useEffect(() => {
    if (slug === null || !exists) return;
    void worksApi
      .touchRecent(slug)
      .catch((err: unknown) => console.warn("최근 연 work을 적지 못했습니다", err));
  }, [slug, exists]);

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
    // **채팅 탭이 켜져 있으면 다른 작업공간으로 넘기지 않는다**(restart 02a-4) — 그 채팅이 갈 곳은 위 「켜진 채팅 탭이 이 작업공간을
    // 떠났다」가 코어의 값으로 정한다. 목록이 방금 이은 작업공간을 아직 모르는 동안 엉뚱한 작업공간으로 가지 않는다.
    if (thread !== null) return;
    // 주소가 실제 화면과 어긋나 있다. 둘 중 하나다 —
    //  (a) 무선택 주소인데 목록이 뒤늦게 채워졌다 (빈 상태로 열어둔 채 밖에서 작업을 시작한 경우)
    //  (b) 주소가 가리키는 작업이 사라졌다 (지워졌거나 잘못된 링크)
    const next = pickSlug(shellStore.state.workSlug, works);
    if (next === slug) return; // 목록이 비어 여전히 무선택 — 고칠 것이 없다
    goTo(next, true);
    // goTo는 의존성에 넣지 않는다 — navigate 하나만 닫아 잡고 그건 라우터가 고정해준다
  }, [slug, exists, isPending, isFetching, works, thread]);

  return (
    <WorksPage
      sidebarOpen={sidebarOpen}
      selectedSlug={exists ? slug : null}
      currentFile={file}
      onSelectFile={selectFile}
      tab={tab}
      onSelectTab={selectTab}
      code={code}
      onOpenCode={openCodeTab}
      thread={thread}
      onOpenChat={openChatTab}
      split={split}
      onSelectSplit={selectSplit}
      onFollowBundle={followBundle}
      onDropInto={dropInto}
    />
  );
}

export default WorksView;
