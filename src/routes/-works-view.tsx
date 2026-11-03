import { useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import WorksPage from "@/features/works/WorksPage";
import { worksApi } from "@/features/works/api";
import { threadQuery, useThreads } from "@/features/thread/hooks";
import { lastSaid } from "@/features/thread/preview";
import { linesOf, threadRecordStore } from "@/features/thread/thread-store";
import { landingOf, type WorkLanding } from "@/features/thread/work-threads";
import { cardTabOf, workSeat } from "@/features/thread/right-place";
import {
  bundleSearch,
  cardDocSearch,
  chatHome,
  chatSearch,
  codeRefOf,
  codeSearch,
  newChatSearch,
  openingSearch,
  recallSearch,
  rememberView,
  tabSearch,
} from "./-work-search";
import type { BundleShown, ViewTab } from "./-work-search";
import { bundleOf, ownerOf } from "@/features/terminal/shell-registry";
import { terminalStore } from "@/features/terminal/terminal-store";
import { useWorks } from "@/features/works/hooks";
import { pickSlug, selectWork, shellStore } from "@/components/shell/shell-store";

// /works와 /works/$slug가 그리는 화면은 같다 — 다른 것은 어떤 작업이 선택됐는지뿐이다.
// 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다.
function WorksView({
  slug,
  file = null,
  tab = "chat",
  code = null,
  thread = null,
  opening = false,
}: {
  slug: string | null;
  file?: string | null;
  tab?: ViewTab;
  /** 주소가 말하는 파일 탭(`<프로젝트>/<경로>`) — 본문(`tab=code`)에 선 것이다(git-integration S12). */
  code?: string | null;
  /** 주소가 말하는 채팅 탭의 채팅 — 본문(`tab=chat`)에 선 것이다(restart 02a-4). */
  thread?: string | null;
  /**
   * 주소가 **작업공간을 처음 여는 주소**다(`opensWork` — 탭도 채팅도 적지 않았다). 이 화면이 처음 여는 규칙으로 탭을 세운다. `tab=chat`만
   * 적은 주소(새 채팅 탭, restart 02a-8)와 `tab`이 같은 `chat`이라 값만으로는 못 가른다 — 원래 주소를 읽는 라우트가 건넨다.
   */
  opening?: boolean;
}) {
  const navigate = useNavigate();
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  const { data: works = [], isPending, isFetching } = useWorks();

  const exists = slug !== null && works.some((work) => work.slug === slug);

  // 작업을 옮길 때 보던 화면을 **기억에서 되살린다**(결정 77) — 탭 · 넓힌 카드의 문서 · 파일 탭 · 채팅이다.
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

  /**
   * **넓힌 카드의 문서를 주소에 적는다**(restart 02a-12) — spec 패널의 문서 줄이 켤 카드 탭(`landing`)으로 옮기며 문서를 얹고, 넓힌 카드가 다른
   * 문서를 열면 그 문서로, 닫히거나 문서가 아닌 것을 열면(`path`가 `null`) 걷는다. 모양은 `cardDocSearch` 하나다. 트리 훑기 · 카드 안의 손짓이라
   * replace다(스토리 59 — 히스토리를 쌓지 않는다).
   */
  const openDoc = useCallback(
    (path: string | null, landing: WorkLanding | null) => {
      if (slug === null) return;
      void navigate({
        to: "/works/$slug",
        params: { slug },
        search: (prev: object) => cardDocSearch(prev, path, landing),
        replace: true,
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
   * 기록을 안 쌓는다).
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

  /**
   * **새 채팅 탭으로 간다**(restart 02a-8) — 주소만 `tab=chat`(`thread` 없음)으로 고친다. 어느 새 채팅 탭인지는 묶음이 쥐어, 그 칸을 세우거나
   * 켜는 일은 화면이 먼저 한다(셸 탭과 같다). 탭 줄 · 단축키의 손짓이라 replace다(결정 13).
   */
  const openNewChat = useCallback(() => {
    if (slug === null) return;
    void navigate({
      to: "/works/$slug",
      params: { slug },
      search: (prev: object) => newChatSearch(prev),
      replace: true,
    });
  }, [navigate, slug]);

  // 묶음의 지금 탭이 묶음 쪽에서 바뀌었다 — 지금 탭을 닫아 이웃이 켜졌거나, 셸이 스스로 끝났거나, 새 채팅 탭이 채팅 탭이 됐다
  // (git-integration 결정 30). 본문이 그 탭을 따라간다. 고칠 것을 `prev`에서만 읽는 까닭은 `bundleSearch` 머리말에 있다.
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
  // 때문이다 — 화면을 옮기는 길이 탭 줄, ⌘1~9, ⌃Tab, 넓힌 카드, 사이드바로 여럿인데, 전부
  // 주소를 바꾸므로 도착한 주소를 한 번 적으면 다 덮는다.
  //
  // 처음 여는 주소는 탭을 적지 않는다(`tab: null`, restart 02a-8) — 그 주소의 `chat`은 기본 값이지 새 채팅 탭이 아니다.
  useEffect(() => {
    if (slug !== null && exists) rememberView(slug, { tab: opening ? null : tab, file, code, thread });
  }, [slug, exists, opening, tab, file, code, thread]);

  // **작업공간을 처음 여는 규칙**(restart 02a-4) — 값이 없는 주소(`opening` — 탭도 채팅도 적지 않았다)에 닿으면 가장 최근 채팅 탭 하나를
  // 세우고 주소를 고친다. 채팅이 없는 작업공간은 새 채팅 탭이 선다(restart 02a-8 — `openingSearch`).
  // 「가장 최근」은 사이드바 작업공간 줄과 같은 규칙이다(`landingOf` — 마지막 말의 때). 그 말은 이미 읽어 둔 기록에서 이 순간에
  // 센다 — 기록 줄마다 이 화면이 다시 그려지지 않게 구독하지 않는다. 주소만 고치므로 replace다.
  //
  // 채팅 목록을 아직 못 읽었으면 기다린다 — 「채팅이 없다」로 읽으면 채팅이 있는 작업공간이 새 채팅 탭으로 열린다. 읽기가 실패하면 빈
  // 목록으로 친다.
  //
  // **`?file=`에 닿았으면 02a-10의 켤 탭 규칙이다**(restart 02a-12 · 구현 스펙 「`?file=`에 닿으면 위 규칙으로 넓힌 카드를 연다」) — 가장 최근에 켠
  // 채팅 탭, 열린 채팅 탭이 없으면 가장 최근 채팅, 채팅이 없으면 새 채팅 탭이다(`cardTabOf`). 검색 결과 · 셸 · 파일 탭에서 적은 문서가 이리로
  // 온다(`fileSearch`). 문서는 고른 탭으로 따라가고(`openingSearch`) 작업공간 화면이 그 탭에 넓힌 카드로 연다.
  const { data: threads, isPending: threadsPending } = useThreads();
  const lands = opening && slug !== null && exists && !threadsPending;
  useEffect(() => {
    if (!lands || slug === null) return;
    const records = threadRecordStore.state;
    const latest = landingOf(threads ?? [], slug, (id) => lastSaid(linesOf(records, id))?.at ?? null);
    const landing = file === null ? latest : cardTabOf(workSeat(slug), bundleOf(terminalStore.state, ownerOf(slug)), latest);
    void navigate({
      to: "/works/$slug",
      params: { slug },
      search: (prev: object) => openingSearch(prev, landing),
      replace: true,
    });
  }, [lands, slug]);

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
  // **바로 위 effect에 얹지 않는다 — 의존성이 다르다.** 저쪽은 `[slug, exists, tab,
  // file, code]`라 문서·탭을 바꿀 때마다 다시 도는데, 여기 세는 단위는 **work**이다
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
      onOpenDoc={openDoc}
      tab={tab}
      onSelectTab={selectTab}
      code={code}
      onOpenCode={openCodeTab}
      thread={thread}
      onOpenChat={openChatTab}
      onOpenNewChat={openNewChat}
      opening={opening}
      onFollowBundle={followBundle}
    />
  );
}

export default WorksView;
