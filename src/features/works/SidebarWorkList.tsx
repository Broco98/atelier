import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, File, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverPortal } from "@/components/ui/popover-portal";
import {
  BranchHeader,
  SectionBody,
  TreeIndent,
  TreeLeaf,
} from "@/components/shell/sidebar-tree";
import { recallView, tabSearch, viewSearch, workSlugOf, type ViewTab } from "@/routes/-work-search";
import { useSetWorkPinned, useWorks } from "./hooks";
import { emptyMainNotice, splitWorkSections } from "./work-sections";
import type { SectionsOpen, WorkSections } from "./work-sections";
import { armDrag } from "./split-view";
import { formatCreated, StatusIcon, STATUS_META } from "./status";
import type { WorkView } from "./types";

// 목록을 훑어 지나가는 동안 카드가 연달아 튀어나오지 않을 만큼은 머물러야 한다
const HOVER_DELAY_MS = 350;

// 접기는 "설정"이라 영속한다 — 이 앱의 "설정은 영속, 위치는 세션" 원칙에서 사이드바 접힘과 같은 쪽이다.
// 초안만 기본 접힘이다: 백로그를 상시 노출하지 않는 것이 초안 구역을 만든 이유다.
const PINNED_OPEN_KEY = "sidebar-pinned-open";
const WORKS_OPEN_KEY = "sidebar-works-open";
const DRAFTS_OPEN_KEY = "sidebar-drafts-open";

// 사이드바에 상주하는 작업 목록. 어느 화면에 있든 그대로 있고, 항목을 누르면 Works로 간다.
//
// 이건 전역 컨텍스트가 아니라 **전환 수단**이다 — "선택된 작업"이 앱 전체에 걸리는 개념은
// 도입하지 않는다. 다른 화면들은 작업 선택과 무관하게 독립 동작한다.
function SidebarWorkList({
  open,
  boundaryRef,
  shellCounts,
  renderShells,
}: {
  open: boolean;
  // 호버 카드가 비켜야 할 상자 — 사이드바 자신이다. 행의 오른쪽 끝은 거터와 스크롤바 때문에
  // 사이드바 끝보다 8~19px 안쪽이라, 행만 기준으로 삼으면 카드가 사이드바에 붙거나 파고든다.
  boundaryRef: RefObject<HTMLElement | null>;
  /**
   * work별 셸 개수 — 어느 work에 가지가 서는가를 정한다(결정 73).
   *
   * **이 파일은 터미널 스토어를 모른다.** 개수도 가지의 속도 위(Sidebar)에서 내려온다:
   * 여기서 `terminal-store`를 import하면 `@xterm/*`와 그 CSS가 따라 들어와 이 목록의
   * 정적 마크업 검사가 서지 못한다(SidebarWorkList.test.tsx).
   */
  shellCounts: Record<string, number>;
  /** 가지의 속. 터미널 스토어를 구독하는 자리라 슬롯으로 받는다(ShellBranch). */
  renderShells: (work: WorkView) => ReactNode;
}) {
  const { data: works = [] } = useWorks();
  const navigate = useNavigate();
  const setPinned = useSetWorkPinned();
  const [pinnedOpen, setPinnedOpen] = useState(
    () => localStorage.getItem(PINNED_OPEN_KEY) !== "0",
  );
  const [worksOpen, setWorksOpen] = useState(
    () => localStorage.getItem(WORKS_OPEN_KEY) !== "0",
  );
  const [draftsOpen, setDraftsOpen] = useState(
    () => localStorage.getItem(DRAFTS_OPEN_KEY) === "1",
  );

  useEffect(() => {
    localStorage.setItem(PINNED_OPEN_KEY, pinnedOpen ? "1" : "0");
  }, [pinnedOpen]);
  useEffect(() => {
    localStorage.setItem(WORKS_OPEN_KEY, worksOpen ? "1" : "0");
  }, [worksOpen]);
  useEffect(() => {
    localStorage.setItem(DRAFTS_OPEN_KEY, draftsOpen ? "1" : "0");
  }, [draftsOpen]);

  // 어느 항목을 강조할지는 URL이 정한다 — 셸은 그것을 비출 뿐이다 (AppShell의 activeKey와 같은 규칙).
  const openSlug = useRouterState({
    select: (state) => workSlugOf(state.location.pathname),
  });
  // 본문이 지금 무엇인가 — 고른 work의 `spec` 잎이 켜지는지가 이것으로 갈린다.
  // `openSlug`와 **따로** 구독한다: 객체 하나로 묶어 돌려주면 매번 새 객체라 걸러내지 못해
  // 주소가 바뀔 때마다 목록 전체가 다시 그려진다(AppShell의 같은 주석).
  const tab: ViewTab = useRouterState({
    select: (state) => ((state.location.search as { tab?: string }).tab === "terminal" ? "terminal" : "spec"),
  });

  const sectionsOpen: SectionsOpen = {
    pinned: pinnedOpen,
    works: worksOpen,
    drafts: draftsOpen,
  };
  const sections = splitWorkSections(works, sectionsOpen);
  const { visible } = sections;
  // 어느 구획을 접었는지만 아래에서 올라온다 — 어느 setState인지는 여기서 고른다.
  const toggleSection = (section: keyof SectionsOpen) => {
    ({ pinned: setPinnedOpen, works: setWorksOpen, drafts: setDraftsOpen })[section]((v) => !v);
  };
  // 목록에 없는 슬러그는 강조하지 않는다 — 지워진 작업을 가리키는 주소로 들어온 순간이 있다
  const selectedSlug = works.some((work) => work.slug === openSlug) ? openSlug : null;

  // 호버 정보 카드 — 한 줄로 줄이며 행에서 빠진 것(프로젝트·생성일)을 돌려주고,
  // 지금은 작업을 선택해야만 보이던 브랜치와 spec 파일 수까지 마우스만 올리면 보인다.
  // 여는 행을 슬러그로 들고 있어서 목록이 갱신되면 카드 내용도 따라오고, 그 작업이
  // 사라지면 카드도 사라진다.
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const hoverAnchor = useRef<HTMLElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  // visible에서 찾는다 — works가 아니다. 작업이 지워질 때뿐 아니라 **화면에서만 빠질 때**도
  // 카드가 따라 사라져야 한다. 행이 언마운트되면 mouseleave가 오지 않아 카드를 닫을 사람이
  // 없고, 앵커가 문서에서 떨어져 위치 계산이 0,0으로 무너진다. (예: 초안이 접힌 채로
  // 호버 중인 작업의 상태가 draft로 바뀌면 그 행이 접힌 구역으로 옮겨져 사라진다)
  const hovered = visible.find((work) => work.slug === hoveredSlug) ?? null;

  const closeCard = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHoveredSlug(null);
  };
  const openCardAfterDelay = (slug: string, row: HTMLElement) => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      hoverAnchor.current = row;
      setHoveredSlug(slug);
    }, HOVER_DELAY_MS);
  };

  // 사이드바가 접히면 행은 DOM에 남은 채 폭만 0이 된다 — 열려 있던 카드가 허공에 남는다.
  // 앵커 행이 목록에서 빠져 카드가 이미 사라진 경우에는 남아 있는 슬러그도 지운다 —
  // 그 행이 도로 나타났을 때 마우스가 그대로인데 카드가 되살아나지 않게.
  const hoverLost = hoveredSlug !== null && hovered === null;
  useEffect(() => {
    if (!open || hoverLost) closeCard();
  }, [open, hoverLost]);
  // 언마운트 시 대기 중인 타이머를 정리한다
  useEffect(() => () => closeCard(), []);

  // 작업을 옮긴다. **보던 본문을 기억에서 되살린다**(결정 77) — 터미널을 보다 옆 작업을
  // 잠깐 들여다보고 돌아왔을 때 문서로 떨어지는 것이 그 결정이 없애려는 것이다.
  // `file`은 딸려가지 않는다: `viewSearch`가 빈 객체 위에 얹으므로 이전 주소가 통째로 버려진다.
  const goTo = (slug: string) => {
    closeCard();
    void navigate({
      to: "/works/$slug",
      params: { slug },
      search: viewSearch({}, recallView(slug)),
    });
  };

  /**
   * 가지가 펼쳐졌는가 — **세션 메모리다**(결정 107). 앱을 껐다 켜면 기본값으로 돌아온다.
   * 구획 접힘(`sidebar-*-open`)이 localStorage에 사는 것과 갈리는 자리인데, 그쪽은 「설정」이고
   * 이쪽은 「지금 무엇을 펼쳐 두었나」라는 위치다(shell-store의 수명 구분과 같은 규칙).
   *
   * 기록에 없는 슬러그는 **접힌 것**이다. 자동 펼침은 그 work을 **처음 고를 때 한 번**이고
   * (아래 이펙트), 사람이 접으면 기록에 `false`가 남아 다시 골라도 접힌 채다.
   */
  const [branchOpen, setBranchOpen] = useState<Record<string, boolean>>({});
  const isBranchOpen = (slug: string) => branchOpen[slug] === true;

  /**
   * work 블럭이 펼쳐졌는가 — **기본이 펼침이라 위 `branchOpen`과 반대다.** 이 블럭은
   * 오늘까지 늘 서 있었고, 접는 것이 새로 생긴 일이다: 아무것도 안 한 사람의 화면이
   * 달라지면 안 된다. 그래서 기록에 남는 것은 **접었다는 사실**뿐이다.
   *
   * 수명은 `branchOpen`과 같은 세션 메모리다(결정 107) — 접힘은 위치이지 설정이 아니다.
   */
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const isNodeOpen = (slug: string) => folded[slug] !== true;
  const toggleNode = (slug: string) =>
    setFolded((prev) => ({ ...prev, [slug]: prev[slug] !== true }));

  useEffect(() => {
    if (selectedSlug === null) return;
    setBranchOpen((prev) => openBranchOnSelect(prev, selectedSlug));
  }, [selectedSlug]);

  /**
   * `terminal` 가지의 머리행을 눌렀다.
   *
   * **남의 work의 것이면 그 work로 간다**(결정 101) — 사이드바 규칙이 그 하나로 줄었다.
   * 고른 work의 것이면 접기 토글이다(결정 90·107).
   */
  const toggleBranch = (work: WorkView) => {
    if (work.slug !== selectedSlug) {
      goTo(work.slug);
      setBranchOpen((prev) => ({ ...prev, [work.slug]: true }));
      return;
    }
    setBranchOpen((prev) => ({ ...prev, [work.slug]: !isBranchOpen(work.slug) }));
  };

  /**
   * `spec` 잎을 눌렀다 — 본문이 문서로 돌아온다. 이 잎은 **고른 work에만** 서므로
   * 여기 오는 것은 늘 지금 보고 있는 work이다.
   *
   * **`tabSearch`로 갈아 끼운다 — 객체를 주지 않는다.** 이 라우터는 `search`에 객체를 주면
   * 기존 search를 통째로 버려서 보던 문서(`file`)가 조용히 떨어진다(결정 15). `replace`인
   * 것도 탭 전환과 같은 이유다(결정 13).
   */
  const openSpec = (work: WorkView) => {
    closeCard();
    void navigate({
      to: "/works/$slug",
      params: { slug: work.slug },
      search: (prev) => tabSearch(prev, "spec"),
      replace: true,
    });
  };

  // 고정을 뒤집는다. 카드를 함께 닫는 것은 행이 다른 구획으로 **옮겨 가기** 때문이다
  // (결정 82) — 앵커 행이 사라지면 카드가 허공에 남는다.
  const togglePin = (work: WorkView) => {
    closeCard();
    setPinned.mutate({ slug: work.slug, pinned: !work.pinned });
  };

  return (
    <>
      {/* 거터를 스크롤 상자 **바깥**에 둔다. 스크롤바는 padding이 아니라 border 안쪽 끝에
          놓이므로, 스크롤 상자가 사이드바 폭을 그대로 쓰면 스크롤바가 폭 조절 핸들(오른쪽 5px)
          아래로 들어가 막대를 잡으려다 폭 드래그가 시작된다.
          두 섹션은 이 한 스크롤 영역에 이어진다 — 헤더도 함께 스크롤한다. */}
      <div className="flex min-h-0 flex-1 flex-col px-2">
        {/* auto가 아니라 scroll이다 — 자리를 **항상** 예약한다.
            scroll-quiet의 스크롤바는 폭을 갖는 클래식이라, auto로 두면 목록이 넘치는 순간
            콘텐츠 폭이 11px 줄어 헤더와 행이 통째로 왼쪽으로 밀린다(실측 264→253). 접었다
            펴는 것만으로도 폭이 오가는 자리다. scrollbar-gutter:stable은 이 WebKit에서
            먹지 않아(실측) 확실한 쪽을 쓴다. 늘 있어도 보이지는 않는다 — track·thumb가
            투명이고 lib/scroll-quiet.ts가 실제 스크롤 중에만 색을 준다.
            예약된 11px만큼 nav도 오른쪽을 비워 둔다(Sidebar.tsx). */}
        <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-scroll pb-1 scroll-quiet">
          <WorkSectionList
            sections={sections}
            open={sectionsOpen}
            selectedSlug={selectedSlug}
            tab={tab}
            shellCounts={shellCounts}
            branchOpen={isBranchOpen}
            nodeOpen={isNodeOpen}
            onToggleSection={toggleSection}
            onOpen={goTo}
            onHover={openCardAfterDelay}
            onLeave={closeCard}
            onTogglePin={togglePin}
            onToggleBranch={toggleBranch}
            onToggleNode={toggleNode}
            onOpenSpec={openSpec}
            renderShells={renderShells}
          />
        </div>
      </div>

      {/* onClose를 넘기지 않는다 — 바깥 클릭 막이 깔리면 포인터를 가로채 열자마자 닫힌다.
          이 카드의 여닫음은 행의 hover가 온전히 소유한다. */}
      {hovered && (
        <PopoverPortal
          anchorRef={hoverAnchor}
          boundaryRef={boundaryRef}
          side="right"
          gap={8}
          width={272}
          className="p-3.5"
        >
          <WorkCard work={hovered} />
        </PopoverPortal>
      )}
    </>
  );
}

/**
 * work을 골랐을 때 가지의 접힘 기록이 어떻게 되는가(결정 107).
 *
 * **처음 고를 때 한 번만 펼친다.** 기록에 이미 있으면 그대로 둔다 — 그 값은 사람이 접거나
 * 편 결과이고, 다시 고를 때마다 펼치면 「사람이 접으면 접힌 채 남는다」가 거짓이 된다.
 * `false`가 기록에 남아 있는 것과 기록이 아예 없는 것을 **가르는 것이 전부**이므로,
 * `prev[slug] ?? true`처럼 값을 보는 판정으로 바꾸면 그 둘이 같아진다.
 *
 * **안 바뀌면 같은 객체를 돌려준다** — 새 객체를 만들면 그 work을 다시 고를 때마다 목록이
 * 통째로 다시 그려진다.
 *
 * **함수로 꺼낸 이유는 테스트다.** 이 저장소의 컴포넌트 seam은 정적 마크업이라 이펙트가
 * 돌지 않는다 — 이 판단을 이펙트 안에 두면 「고를 때마다 펼친다」로 뒤집어도 검사가 전부
 * 초록이었다(실측). `togglesWorkPanel`이 같은 이유로 같은 모양이다.
 */
export function openBranchOnSelect(
  open: Record<string, boolean>,
  slug: string,
): Record<string, boolean> {
  return slug in open ? open : { ...open, [slug]: true };
}

// 세 구획을 그리는 부분. 구독하는 자리(useWorks·라우터·localStorage)는 위에 남기고 여기는
// **받은 것만** 그린다 — ShellList와 같은 모양이다. 이 저장소의 컴포넌트 seam은 정적
// 마크업이라, 가지 조건(결정 82·108)과 핀의 생김새(결정 85)를 그물에 걸려면 훅을 부르지
// 않는 자리가 있어야 한다(SidebarWorkList.test.tsx).
export function WorkSectionList({
  sections,
  open,
  selectedSlug,
  tab,
  shellCounts,
  branchOpen,
  nodeOpen,
  onToggleSection,
  onOpen,
  onHover,
  onLeave,
  onTogglePin,
  onToggleBranch,
  onToggleNode,
  onOpenSpec,
  renderShells,
}: {
  sections: WorkSections;
  open: SectionsOpen;
  selectedSlug: string | null;
  tab: ViewTab;
  shellCounts: Record<string, number>;
  branchOpen: (slug: string) => boolean;
  nodeOpen: (slug: string) => boolean;
  onToggleSection: (section: keyof SectionsOpen) => void;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  onTogglePin: (work: WorkView) => void;
  onToggleBranch: (work: WorkView) => void;
  onToggleNode: (slug: string) => void;
  onOpenSpec: (work: WorkView) => void;
  renderShells: (work: WorkView) => ReactNode;
}) {
  const { pinned, main, drafts } = sections;
  // 세 구획이 같은 것을 그린다 — 한 벌로 묶어 두지 않으면 가지를 붙이는 자리가 셋이 된다.
  const node = (work: WorkView) => (
    <WorkNode
      key={work.slug}
      work={work}
      active={work.slug === selectedSlug}
      tab={tab}
      shellCount={shellCounts[work.slug] ?? 0}
      branchOpen={branchOpen(work.slug)}
      onOpen={onOpen}
      onHover={onHover}
      onLeave={onLeave}
      onTogglePin={onTogglePin}
      onToggleBranch={onToggleBranch}
      nodeOpen={nodeOpen(work.slug)}
      onToggleNode={() => onToggleNode(work.slug)}
      onOpenSpec={onOpenSpec}
      shells={renderShells(work)}
    />
  );
  return (
    <>
      {/* '고정' 헤더도 고정된 것이 있을 때만 — '초안'과 같은 규칙이다(결정 82) */}
      {pinned.length > 0 && (
        <>
          <SectionHeader
            label="고정"
            className="mt-3"
            open={open.pinned}
            count={pinned.length}
            onToggle={() => onToggleSection("pinned")}
          />
          <SectionBody open={open.pinned}>{pinned.map(node)}</SectionBody>
        </>
      )}

      {/* '작업' 헤더는 목록이 비어도 남는다 — 섹션이 있다는 사실 자체가 정보다 */}
      <SectionHeader
        label="작업"
        className="mt-3"
        open={open.works}
        count={main.length}
        onToggle={() => onToggleSection("works")}
      />
      <SectionBody open={open.works}>
        {main.length === 0 ? (
          <span className="px-[9px] pb-1 text-[12.5px] leading-normal text-tertiary">
            {emptyMainNotice(sections)}
          </span>
        ) : (
          main.map(node)
        )}
      </SectionBody>

      {/* '초안' 헤더는 초안이 있을 때만 — 아무것도 없는 섹션의 헤더는 자리만 먹는다 */}
      {drafts.length > 0 && (
        <>
          <SectionHeader
            label="초안"
            className="mt-3"
            open={open.drafts}
            count={drafts.length}
            onToggle={() => onToggleSection("drafts")}
          />
          <SectionBody open={open.drafts}>{drafts.map(node)}</SectionBody>
        </>
      )}
    </>
  );
}

/**
 * work 한 줄과 그 아래 트리(결정 71·73).
 *
 * **가지가 서는 조건은 합집합이다** — 지금 고른 work **또는** 셸이 하나라도 있는 work.
 * 뒤쪽이 있어야 「다른 work에서 `claude`가 돌고 있다」가 화면에서 사라지지 않는다.
 * `spec` 잎은 **고른 work에만** 선다: 남의 work의 문서는 그 work로 가야 뜻이 있고, 셋 넷의
 * work마다 `spec`이 서면 트리가 목록이 아니라 벽이 된다.
 *
 * 가지의 **속**은 슬롯으로 받는다(`shells`) — 터미널 스토어를 구독하는 자리를 그 한 곳으로
 * 좁히기 위해서다(ShellBranch 머리말). 여기서는 그것을 어디에 놓을지만 정한다.
 */
function WorkNode({
  work,
  active,
  tab,
  shellCount,
  branchOpen,
  nodeOpen,
  onOpen,
  onHover,
  onLeave,
  onTogglePin,
  onToggleBranch,
  onToggleNode,
  onOpenSpec,
  shells,
}: {
  work: WorkView;
  active: boolean;
  tab: ViewTab;
  shellCount: number;
  branchOpen: boolean;
  nodeOpen: boolean;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  onTogglePin: (work: WorkView) => void;
  onToggleBranch: (work: WorkView) => void;
  onToggleNode: () => void;
  onOpenSpec: (work: WorkView) => void;
  shells: ReactNode;
}) {
  const stands = active || shellCount > 0;

  // **블럭이 새로 설 때도 부드럽게 뜬다.** 접기 토글은 `SectionBody`가 이미 nav와 같은
  // 애니메이션(grid-rows 0fr↔1fr)으로 돌리는데, work를 **처음 고르는** 순간은 토글이
  // 아니라 마운트라 트랜지션이 출발할 자리가 없다 — CSS 트랜지션은 요소의 초기 스타일에서는
  // 돌지 않는다(WorkPanel이 같은 함정을 적어 뒀다). 닫힌 채로 세우고 다음 프레임에 편다.
  //
  // `useEffect`는 페인트 뒤에 돌지만 rAF를 한 겹 더 두는 것은 그 보장이 커밋 방식에 달려
  // 있어서다 — 한 프레임 늦는 대신 「가끔 뚝 뜬다」가 없다.
  //
  // **첫 렌더는 이미 서 있는 값으로 시작한다.** 앱을 켠 순간이나 목록이 처음 도착한 순간은
  // 「나타나는 것」이 아니라 그냥 첫 화면이라, 그때까지 애니메이션하면 켤 때마다 사이드바가
  // 펼쳐지는 것을 보게 된다.
  const [entered, setEntered] = useState(stands);
  useEffect(() => {
    if (!stands) {
      setEntered(false);
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [stands]);
  return (
    <>
      <WorkRow
        work={work}
        active={active}
        onOpen={onOpen}
        onHover={onHover}
        onLeave={onLeave}
        onTogglePin={onTogglePin}
        // 접기 토글은 **고른 work의 것에만** 있다(결정 101). 남의 work 행을 건드리면
        // 그 work로 가는 것이 사이드바에 남은 규칙 하나다.
        branch={active && stands ? { open: nodeOpen, onToggle: onToggleNode } : undefined}
      />
      {stands && (
        // 블럭의 속. nav 항목이 자기 가지를 이는 모양과 **같은 겹**이다(Sidebar.tsx) —
        // 머리행 + `SectionBody` + 그 안의 `TreeIndent`.
        <SectionBody open={nodeOpen && entered}>
          <TreeIndent>
            {active && (
              <TreeLeaf
                icon={File}
                label="spec"
                active={tab === "spec"}
                onClick={() => onOpenSpec(work)}
                // 본문 위로 끌면 그 절반에 문서가 선다(결정 86·90). 이 잎은 **고른 work에만**
                // 서므로 떨궈도 work이 바뀌지 않는다 — 셸 행과 다른 점이 그 하나다.
                onPointerDown={(event) =>
                  armDrag({ kind: "spec", slug: work.slug, shellId: null }, event)
                }
              />
            )}
            <BranchHeader
              label="terminal"
              count={shellCount}
              open={branchOpen}
              onToggle={() => onToggleBranch(work)}
            />
            <SectionBody open={branchOpen}>{shells}</SectionBody>
          </TreeIndent>
        </SectionBody>
      )}
    </>
  );
}

// 정보 전용이다 — 누를 수 있는 것을 넣지 않는다. 클릭 대상이 생기면 마우스가 행에서 카드로
// 건너가는 경로(safe triangle)를 살려둬야 하고, 열림 상태의 소유가 행에서 카드로 넘어간다.
//
// 알려진 한계: 키보드로는 이 카드에 닿을 수 없다. 숫자 단축키로 작업을 고르는 경로에서는
// 이 정보가 보이지 않는다. 감수한다.
function WorkCard({ work }: { work: WorkView }) {
  const meta = STATUS_META[work.status];
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[13.5px] font-medium leading-snug">{work.title}</span>
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "shrink-0 rounded-[6px] px-1.5 py-px text-[11px] font-medium",
            meta.badgeClass,
          )}
        >
          {meta.label}
        </span>
        <span className="text-[11.5px] text-tertiary">{formatCreated(work.createdAt)}</span>
      </span>
      <div className="flex flex-col gap-1 border-t pt-2.5 text-[12px]">
        {/* 브랜치는 첫 프로젝트가 붙을 때 정해진다 — 그전에는 보여줄 이름이 없다 */}
        <CardField label="브랜치" muted={work.branch === null} mono={work.branch !== null}>
          {work.branch ?? "프로젝트가 붙으면 정해져요"}
        </CardField>
        <CardField label="프로젝트" muted={work.projects.length === 0}>
          {work.projects.length === 0 ? "아직 없어요" : work.projects.join(", ")}
        </CardField>
        <CardField label="spec">{`${work.specFiles.length}개`}</CardField>
      </div>
    </div>
  );
}

function CardField({
  label,
  muted = false,
  mono = false,
  children,
}: {
  label: string;
  muted?: boolean;
  mono?: boolean;
  children: string;
}) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="w-[46px] shrink-0 text-tertiary">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          muted ? "text-tertiary" : "text-muted-foreground",
          mono && "font-mono",
        )}
      >
        {children}
      </span>
    </span>
  );
}

// 섹션 헤더 — **헤더 전체가 접기 토글이다.** 라벨을 누르면 그 섹션이 접힌다.
//
// 라벨은 항목과 **같은 크기**이고 색으로만 구분된다. 한 단계 작게 두면 라벨이 아니라 목록과
// 목록 사이의 구분선처럼 읽힌다.
//
// 접기 아이콘은 평소 숨어 있다가 헤더에 마우스를 올리면 나타난다 — 좁은 사이드바에서
// 섹션마다 상시 노출된 아이콘은 정작 봐야 할 목록보다 먼저 눈에 들어온다. 다만 **접혀 있으면
// 계속 보인다**: 그것이 "비어 있는 게 아니라 접힌 것"을 알리는 유일한 표시다.
//
// 개수는 접힘과 무관하게 항상 보인다. 배지가 아니라 옅은 숫자다 — 상시 노출인데 배지로 두면
// 헤더가 목록보다 무거워진다.
function SectionHeader({
  label,
  open,
  count,
  onToggle,
  className,
}: {
  label: string;
  open: boolean;
  count: number;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      // 표식은 검사가 이 버튼을 **정체성으로** 집기 위한 것이다. 판 04가 이 서브트리 안에
      // `aria-expanded`를 가진 가지 머리행을 넣으면서, 「접히는 버튼」이라는 자리만으로는
      // 구획 헤더를 집을 수 없게 됐다 (TerminalPane의 `data-shell-host`와 같은 이유).
      data-section=""
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "group flex h-7 w-full shrink-0 items-center gap-1 rounded-[8px] px-[9px] text-left transition-colors hover:bg-state-1",
        className,
      )}
    >
      <span className="shrink-0 text-[13.5px] font-medium text-tertiary transition-colors group-hover:text-muted-foreground">
        {label}
      </span>
      {/* 목록이 접히는 것과 **같은 시간·같은 곡선**으로 돈다 — 한 동작으로 읽혀야 한다.
          트랜지션 목록에 transform이 아니라 rotate를 적는다: Tailwind v4의 rotate-*는
          독립 rotate 속성을 쓰고, transform만 걸면 화살표만 뚝 끊긴다. */}
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 text-tertiary transition-[opacity,rotate] duration-[180ms] ease-panel",
          open ? "opacity-0 group-hover:opacity-100" : "-rotate-90 opacity-100",
        )}
        strokeWidth={2.2}
      />
      <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-tertiary">{count}</span>
    </button>
  );
}

// 한 줄 — 상태 점 + 제목 + 핀. 바로 위 nav 항목과 규격을 맞춘다(높이·반지름·간격·글자 크기):
// 둘이 세로로 붙어 있어 규칙이 다르면 그 자리에서 어긋난다.
// 좁은 폭이라 제목이 자주 잘리는데, 전체는 호버 카드가 보여준다 — title 속성을 함께 두면
// OS 툴팁이 카드 위로 겹쳐 뜬다.
//
// 행 전체가 button이던 것이 **바깥 상자 + 형제 버튼 둘**이 됐다. 중첩 button은 HTML에서
// 허용되지 않고, span role="button"으로 흉내 내면 Tab으로 도달할 수 없다 — SpecTree의
// 파일 행과 ShellList가 이미 같은 문제를 그 구조로 풀었다.
// 배경(선택·hover)은 바깥 상자가 갖고, 가로 여백은 이름 버튼이 품는다: 바깥이 가진
// padding은 두 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리가
// 된다. 남는 것은 오른쪽 끝 pr-1뿐이고 그건 핀을 행 가장자리에서 띄우는 값이다.
//
// hover(카드 여는 것)는 바깥 상자가 듣는다 — 이름 버튼에 걸면 핀 위로 마우스를 옮기는
// 순간 카드가 닫힌다.
function WorkRow({
  work,
  active,
  onOpen,
  onHover,
  onLeave,
  onTogglePin,
  branch,
}: {
  work: WorkView;
  active: boolean;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  onTogglePin: (work: WorkView) => void;
  /**
   * 이 행이 **블럭의 머리행**이면(아래에 `spec`·`terminal`이 딸린다). 있으면 이 행을
   * 누르는 것이 곧 접기 토글이고, 없으면 그 work으로 가는 것이다.
   *
   * **남의 work의 행에는 없다**(결정 101 — 남의 work 항목을 건드리면 그 work로 간다.
   * 접기 토글은 고른 work의 것에만 있다).
   */
  branch?: { open: boolean; onToggle: () => void };
}) {
  return (
    <div
      onMouseEnter={(e) => onHover(work.slug, e.currentTarget)}
      onMouseLeave={onLeave}
      className={cn(
        "group flex h-8 w-full shrink-0 items-center rounded-[10px] pr-1 transition-colors",
        active ? "selected-row" : "text-muted-foreground hover:bg-state-1",
      )}
    >
      <button
        type="button"
        // 표식과 `aria-expanded`가 **이 버튼에 있다** — 행 전체가 곧 토글이라서다.
        // 값을 싣는 것은 한 화면에 가지가 여럿이기 때문이고(sidebar-tree의 같은 주석),
        // 슬러그로 갈리는 것은 제목을 사람이 고쳐도 슬러그는 안 바뀌기 때문이다.
        data-branch={branch ? work.slug : undefined}
        aria-expanded={branch?.open}
        // **누르면 무엇이 되는가가 갈린다**(결정 101). 남의 work 행이면 그 work로 가고,
        // 고른 work의 행이면 접기 토글이다 — `terminal` 머리행이 이미 쓰는 규칙 그대로이고,
        // 구획 헤더(`작업`)가 행 전체로 접히는 것과도 같은 모양이다.
        onClick={branch ? branch.onToggle : () => onOpen(work.slug)}
        className="group/row flex h-full min-w-0 flex-1 items-center gap-[9px] pl-[9px] pr-1.5 text-left"
      >
        <StatusIcon status={work.status} />
        <span
          className={cn(
            "min-w-0 truncate text-[13.5px] font-medium",
            work.status === "done" && "text-tertiary",
          )}
        >
          {work.title}
        </span>
        {/* 화살표가 **제목 곁**에 선다 — 구획 헤더와 같은 자리·같은 규칙이다. 펼쳐져 있을 때
            숨는 것은 결정 85가 핀에 세운 것과 같은 근거다: 좁은 사이드바에서 상시 아이콘은
            정작 봐야 할 제목보다 먼저 눈에 들어온다. 접혀 있으면 늘 보인다 — 그때는
            「아래에 더 있다」가 그 화살표 말고는 화면에 없다. */}
        {branch && (
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-tertiary transition-[opacity,rotate] duration-[180ms] ease-panel",
              branch.open ? "opacity-0 group-hover/row:opacity-100" : "-rotate-90 opacity-100",
            )}
            strokeWidth={2.2}
          />
        )}
      </button>
      {/* 평소 숨어 있다가 hover에만 뜬다(결정 85) — 고정 여부는 구획이 이미 말하고,
          좁은 사이드바에서 상시 아이콘은 정작 봐야 할 제목보다 먼저 눈에 들어온다.
          페이드가 없는 것은 icon-button-quiet이 정한다(옆 행으로 옮겨 갈 때 두 핀이
          겹쳐 미끄러져 보인다). focus-visible:opacity-100이 없으면 Tab으로 도달은
          하는데 보이지 않는다 — spec 트리의 복사 버튼이 이미 같은 답을 한다.
          채운 핀 / 빈 핀으로 갈린다. PinOff(사선 그은 핀)를 쓰지 않는 것은 이 저장소의
          아이콘이 전부 외곽선이고, 결정 85가 말한 것도 「채운 핀」이기 때문이다.
          켜짐은 aria-pressed가 말한다(WorkPanel의 `</>` 토글과 같은 규칙). title은 두지
          않는다 — 행에 머물면 호버 카드가 떠서 OS 툴팁이 그 위로 겹친다. */}
      <button
        type="button"
        aria-label={`${work.title} 고정`}
        aria-pressed={work.pinned}
        onClick={() => onTogglePin(work)}
        className="icon-button-quiet shrink-0 text-tertiary opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
      >
        <Pin
          className="size-3"
          strokeWidth={1.8}
          fill={work.pinned ? "currentColor" : "none"}
        />
      </button>
    </div>
  );
}

export default SidebarWorkList;
