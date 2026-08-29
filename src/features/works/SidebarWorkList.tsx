import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Pin, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { agentMarkOf } from "@/components/ui/agent-mark";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { recallView, viewSearch, workSlugOf } from "@/routes/-work-search";
import { useSetWorkPinned, useWorks } from "./hooks";
import { emptyMainNotice, splitWorkSections } from "./work-sections";
import type { SectionsOpen, WorkSections } from "./work-sections";
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
  shellCounts,
  renderRunning,
}: {
  open: boolean;
  /**
   * work별 셸 개수 — 둘째 줄이 서는 조건이자 그 줄이 적는 값이다(결정 2·3).
   *
   * **이 파일은 터미널 스토어를 모른다.** 개수도 로고도 위(Sidebar)에서 내려온다:
   * 여기서 `terminal-store`를 import하면 `@xterm/*`와 그 CSS가 따라 들어와 이 목록의
   * 정적 마크업 검사가 서지 못한다(SidebarWorkList.test.tsx가 그 계약을 센다).
   */
  shellCounts: Record<string, number>;
  /** 둘째 줄의 로고들. 같은 이유로 슬롯이다 — 그리는 것은 여기 있다(`RunningMarks`). */
  renderRunning: (work: WorkView) => ReactNode;
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
  //
  // **읽는 것이 슬러그 하나다.** 한때 `tab`도 따로 구독했다 — 고른 work의 `spec` 잎이
  // 켜지는지가 그것으로 갈렸는데, 그 잎이 탭 줄로 가면서(결정 6·7) 이 목록에 「지금 보고
  // 있는 것」을 말하는 자리가 행 하나로 줄었다.
  const openSlug = useRouterState({
    select: (state) => workSlugOf(state.location.pathname),
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
        {/* **자리를 예약하지 않는다**(결정 32). 한때 scroll이었다 — 폭을 갖는 클래식 막대라
            auto로 두면 넘치는 순간 콘텐츠 폭이 11px 줄어 헤더와 행이 통째로 밀렸다
            (실측 264→253). 이제 막대가 콘텐츠 **위에** 떠서(scroll-quiet) 폭을 안 먹으므로
            예약할 것이 없고, 그만큼 행이 넓어진다. */}
        <div className="flex min-h-0 flex-1 flex-col gap-(--row-gap) overflow-y-auto pb-1 scroll-quiet">
          <WorkSectionList
            sections={sections}
            open={sectionsOpen}
            selectedSlug={selectedSlug}
            shellCounts={shellCounts}
            onToggleSection={toggleSection}
            onOpen={goTo}
            onHover={openCardAfterDelay}
            onLeave={closeCard}
            onTogglePin={togglePin}
            renderRunning={renderRunning}
          />
        </div>
      </div>

      {/* onClose를 넘기지 않는다 — 바깥 클릭 막이 깔리면 포인터를 가로채 열자마자 닫힌다.
          이 카드의 여닫음은 행의 hover가 온전히 소유한다. */}
      {hovered && (
        <PopoverPortal
          anchorRef={hoverAnchor}
          side="right"
          // **행에서 재는 값이다**(결정 30). 행의 오른쪽 끝은 거터 8px과 늘 예약된
          // 스크롤바 11px 때문에 사이드바 경계선보다 19px 안쪽이라, 카드는 그 19px을
          // 덮고 경계선 위로 올라선다 — 카드가 사이드바에 얹혀 떠 있다는 사실을 그렇게 말한다.
          gap={4}
          width={272}
          className="p-3.5"
        >
          <WorkCard work={hovered} />
        </PopoverPortal>
      )}
    </>
  );
}

// 세 구획을 그리는 부분. 구독하는 자리(useWorks·라우터·localStorage)는 위에 남기고 여기는
// **받은 것만** 그린다. 이 저장소의 컴포넌트 seam은 정적 마크업이라, 구획이 서는 조건
// (결정 82·108)과 핀의 생김새(결정 85)를 그물에 걸려면 훅을 부르지 않는 자리가 있어야
// 한다(SidebarWorkList.test.tsx).
export function WorkSectionList({
  sections,
  open,
  selectedSlug,
  shellCounts,
  onToggleSection,
  onOpen,
  onHover,
  onLeave,
  onTogglePin,
  renderRunning,
}: {
  sections: WorkSections;
  open: SectionsOpen;
  selectedSlug: string | null;
  shellCounts: Record<string, number>;
  onToggleSection: (section: keyof SectionsOpen) => void;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  onTogglePin: (work: WorkView) => void;
  renderRunning: (work: WorkView) => ReactNode;
}) {
  const { pinned, main, drafts } = sections;
  // 세 구획이 같은 것을 그린다 — 한 벌로 묶어 두지 않으면 행의 모양을 정하는 자리가 셋이 된다.
  const row = (work: WorkView) => (
    <WorkRow
      key={work.slug}
      work={work}
      active={work.slug === selectedSlug}
      shellCount={shellCounts[work.slug] ?? 0}
      onOpen={onOpen}
      onHover={onHover}
      onLeave={onLeave}
      onTogglePin={onTogglePin}
      running={renderRunning(work)}
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
          <SectionBody open={open.pinned}>{pinned.map(row)}</SectionBody>
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
          main.map(row)
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
          <SectionBody open={open.drafts}>{drafts.map(row)}</SectionBody>
        </>
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

/**
 * 구획의 속 — 접기 애니메이션은 `grid-template-rows`를 0fr↔1fr로 보간한다. `height:auto`는
 * 트랜지션되지 않고, `max-height`는 목록 길이를 추정해야 해서 항목이 많을수록 타이밍이
 * 어긋난다.
 *
 * 접힌 동안에도 항목은 DOM에 남는다 — 그래야 펼치는 쪽도 애니메이션된다. 그래서 `inert`로
 * 포커스와 포인터를 막는다: 높이 0에 가려 보이지 않는 버튼에 탭이 들어가면 안 된다.
 *
 * **한때 `components/shell/sidebar-tree`에 살았다.** 그 모듈은 구획 헤더와 사이드바 가지가
 * 접히는 규격을 함께 쓰라고 만든 것인데, 판 04가 가지를 통째로 걷으면서 접히는 것이 구획
 * 하나만 남았다 — 쓰는 자리가 이 파일뿐인 조각을 `components/shell/`에 남겨 두면 다음
 * 사람이 그 이름(`tree`)에서 없는 구조를 읽는다.
 */
function SectionBody({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      inert={!open}
      className={cn(
        "grid shrink-0 transition-[grid-template-rows] duration-[180ms] ease-panel",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      {/* **위 여백을 갖지 않는다.** 이 상자는 부르는 쪽의 세로 flow 안에 서고 그쪽이 이미
          `gap-(--row-gap)`를 준다 — 여기서 한 번 더 물면 머리행 아래만 간격이 두 배가 되어
          (실측 6px 대 3px) 같은 컬럼에서 「행 사이」와 「머리행 아래」가 다른 값이 된다.
          접힐 때 함께 사라지는 자리라 오래 안 보였다. */}
      <div className="overflow-hidden">
        <div className="flex flex-col gap-(--row-gap)">{children}</div>
      </div>
    </div>
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
// 파일 행이 이미 같은 문제를 그 구조로 풀었다.
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
  shellCount,
  running,
}: {
  work: WorkView;
  active: boolean;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  onTogglePin: (work: WorkView) => void;
  /** 이 work의 셸 수 — **둘째 줄이 서는 조건이자 그 줄이 적는 값이다**(결정 2·3). */
  shellCount: number;
  /** 둘째 줄의 로고들. 슬롯으로 온다 — 그리는 것은 `RunningMarks`다. */
  running: ReactNode;
}) {
  return (
    <div
      onMouseEnter={(e) => onHover(work.slug, e.currentTarget)}
      onMouseLeave={onLeave}
      className={cn(
        // **flex가 아니라 grid다**(결정 2). 둘째 줄이 서면서 행이 두 줄이 됐는데, 첫 줄을
        // 상자로 한 겹 싸면 이름 버튼의 부모가 그 상자가 되어 **「행 상자」를 부모로 집는**
        // 자리가 조용히 어긋난다 — e2e가 핀의 `parentElement`로 배경 상자를 잰다.
        // 두 칸 grid면 이름·핀이 직계 자식으로 남고 둘째 줄만 두 칸을 걸쳐 아래에 선다.
        "group grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center rounded-[10px] pr-1 transition-colors",
        active ? "selected-row" : "text-muted-foreground hover:bg-state-1",
      )}
    >
      <button
        type="button"
        // **누르면 그 work로 간다 — 늘 그것 하나다**(결정 6). 한때 고른 work의 행만은
        // 접기 토글이었는데(결정 101), 접을 것이 없어지면서 그 갈래가 통째로 사라졌다.
        // 어느 행이든 같은 일을 하는 것이 이 목록에 남은 규칙 전부다.
        onClick={() => onOpen(work.slug)}
        // 첫 줄의 높이를 **이 버튼이 든다** — 바깥이 grid가 되면서 `h-full`은 두 줄을
        // 합친 높이가 됐다. nav 항목과 맞춰야 하는 규격은 여전히 이 한 줄의 32px이다.
        className="flex h-8 min-w-0 items-center gap-(--glyph-gap) pl-[9px] pr-1.5 text-left"
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
      </button>
      {/* 평소 숨어 있다가 hover에만 뜬다(결정 85) — 고정 여부는 구획이 이미 말하고,
          좁은 사이드바에서 상시 아이콘은 정작 봐야 할 제목보다 먼저 눈에 들어온다.
          페이드가 없는 것은 icon-button-tint가 정한다(옆 행으로 옮겨 갈 때 두 핀이
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
        className="icon-button-tint shrink-0 text-tertiary opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
      >
        <Pin
          className="size-3"
          strokeWidth={1.8}
          fill={work.pinned ? "currentColor" : "none"}
        />
      </button>
      {/* **둘째 줄 — 셸이 하나라도 있으면 선다**(결정 3). 셸이 0개인 work는 한 줄로 남아
          **행 높이 자체가 「여기서 일이 돌고 있다」는 신호**가 된다.

          「명령이 도는 동안만 선다」는 **기각됐다**: 그 값은 매 순간 바뀌어서(백엔드가
          1초마다 잰다) 행 높이에 매면 claude가 답을 마칠 때마다 목록이 접혔다 펴지고 아래
          work들이 계속 위아래로 밀린다. 줄이 서는 조건은 **안 변하는 값**이고, 변하는 것은
          줄 **안에서**만 변한다 — 그래서 로고가 하나도 없어도 이 줄은 그대로 선다.

          **표시 전용이다**(결정 5). 로고가 종류만 말하므로(결정 4) 로고와 셸이 1:1이 아니고,
          누르면 어느 셸로 갈지 정해지지 않는다. 행을 누르는 것은 위 줄의 이름 버튼이 받아
          그 work로 간다. _감수한 것_: 이 줄의 배경은 눌러도 아무 일이 없는 자리다 — 누를 수
          있게 하려면 이름 버튼 안에 넣어야 하는데, 그러면 셸 수와 로고 이름이 그 버튼의
          접근성 이름에 섞여 「제목으로 행을 집는다」가 깨진다.

          왼쪽 여백은 **제목이 시작하는 자리**다(`--tree-step` = 글리프 칸 하나 + 그 간격) —
          숫자로 박으면 글리프 크기를 손보는 날 이 정렬이 조용히 깨진다. */}
      {shellCount > 0 && (
        <div
          data-subrow={work.slug}
          className="col-span-2 flex h-[22px] items-center gap-1.5 pl-[calc(9px+var(--tree-step))] pr-1.5 text-[11.5px] text-tertiary"
        >
          <SquareTerminal className="size-3 shrink-0" strokeWidth={1.8} />
          <span className="tabular-nums">{shellCount}</span>
          {running}
        </div>
      )}
    </div>
  );
}

/**
 * 둘째 줄의 **로고들** — 그 work에서 도는 것의 종류다(결정 4). 종류마다 하나이고, 중복을
 * 지우는 것은 `runningKindsOf`이지 여기가 아니다(같은 판정이 두 벌이 되면 한쪽만 늙는다).
 *
 * **그림은 여기 있고 값은 슬롯으로 온다.** 값을 고르는 자리는 행마다 터미널 스토어를
 * 구독하는 자리라 이 파일에 둘 수 없고(위 `shellCounts` 주석의 계약), 반대로 그림을
 * Sidebar에 두면 이 저장소의 유일한 컴포넌트 seam인 정적 마크업이 닿지 못한다 — 그 파일은
 * `terminal-store`를 import해서 `@xterm/*`를 딸고 온다. 그래서 값과 그림이 갈렸다.
 *
 * `agent-mark`를 여기서 들이는 것은 계약 위반이 아니다 — 그 모듈은 react 말고 아무것도 안
 * 끌어오고, 계약이 막는 것은 터미널 feature가 딸고 오는 무게다(그쪽 머리말이 이 자리를
 * 미리 적어 뒀다). **그 경로를 여기 적을 수도 없다** — 계약 검사가 세는 것은 import가
 * 아니라 리터럴이라 주석에 한 번 쓰는 것만으로 빨개진다(실측). 그것이 그 그물의 성질이다.
 *
 * **모르는 이름에는 아무것도 안 띄운다**(`agentMarkOf`가 `null`을 준다). 셸에서 도는 것의
 * 대부분(`node`·`cargo`·`vim`)이 그 자리에 오는데 그때마다 무엇인가 뜨면 줄이 시끄러워져
 * 「어느 work에서 에이전트가 도나」라는 이 줄의 물음이 오히려 안 보인다.
 */
export function RunningMarks({ running }: { running: ReadonlyArray<string> }) {
  // **세는 일이 여기다**(결정 28). 값 쪽은 중복을 그대로 둔 문자열 배열이라야 사이드바 행의
  // 얕은 비교가 먹는다(`runningAgentsOf` 머리말) — 접는 것은 그리는 자리의 몫이다.
  // `Map`이 넣은 순서를 지키므로 로고 자리가 초마다 재배열되지 않는다.
  const counted = new Map<string, number>();
  for (const one of running) counted.set(one, (counted.get(one) ?? 0) + 1);
  return (
    <>
      {[...counted].map(([kind, count]) => {
        const mark = agentMarkOf(kind);
        if (mark === null) return null;
        return (
          // 이름은 **눈이 아니라 접근성으로만** 읽는다 — 좁은 사이드바에서 이름까지 적으면
          // 종류가 둘일 때 그 줄이 제목보다 길어진다. `title`은 안 단다: 이 행에 머물면
          // 호버 카드가 떠서 OS 툴팁이 그 위로 겹친다(핀 버튼과 같은 이유).
          //
          // **줄의 색을 그대로 따르지 않는다.** 로고는 `currentColor`로 칠하는데(결정 15)
          // 그 결정이 든 근거가 「대비 바닥 4.5를 저절로 넘는다」이고, 이 줄의 tertiary는
          // 사이드바 배경에서 그 아래다(#8e8e97 대 #f2f2f4 ≈ 2.9, 다크 ≈ 3.9). 개수는
          // 부차적이라 그 색이 맞지만 로고는 **이 줄이 있는 이유**다(결정 2) — 한 단 올린다.
          <span
            key={kind}
            role="img"
            // 수까지 함께 읽힌다 — 눈에 보이는 것과 같은 말이어야 한다.
            aria-label={`${mark.label} ${count}개`}
            className="flex shrink-0 items-center gap-1 text-muted-foreground"
          >
            <mark.Glyph className="size-3" />
            {/* 셸 수와 **같은 대접이다**(결정 28). 한 줄 안에서 셸에만 수가 붙고 에이전트에는
                안 붙으면, 그 줄이 세는 단위가 둘로 갈린다. `tabular-nums`도 그쪽과 같다. */}
            <span className="tabular-nums">{count}</span>
          </span>
        );
      })}
    </>
  );
}

export default SidebarWorkList;
