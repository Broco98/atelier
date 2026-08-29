import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { recallView, viewSearch, workSlugOf } from "@/routes/-work-search";
import { useSetWorkPinned, useWorks } from "./hooks";
import { emptyMainNotice, splitWorkSections } from "./work-sections";
import type { SectionsOpen, WorkSections } from "./work-sections";
import { formatCreated, StatusIcon, STATUS_META } from "./status";
import type { WorkView } from "./types";

// 목록을 훑어 지나가는 동안 카드가 연달아 튀어나오지 않을 만큼은 머물러야 한다
const HOVER_DELAY_MS = 350;

// 제목이 흐르는 **속도**(결정 11). 거리에 비례한다 — 고정 지속시간은 기각됐다: 넘침 30px은
// 12px/s로 기고 200px은 80px/s로 달려 읽는 속도가 제목마다 갈린다.
const MARQUEE_SPEED = 50; // px/s
// 오른쪽 끝 페이드의 폭. **`index.css`의 `--title-fade`와 같은 수여야 한다** — 흐르는 거리가
// 「넘침 + 이 값」이고(결정 11), 거리는 CSS가 정하는데(결정 10) 그것을 **시간으로 바꾸는**
// 자리가 여기라서 둘이 같은 수를 읽는다. `calc()`가 길이를 시간으로 못 바꾸는 것이 이
// 한 값이 두 언어에 걸치는 이유 전부다(결정 12).
const TITLE_FADE = 24; // px

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
  renderShellMeta,
}: {
  open: boolean;
  /**
   * work별 셸 개수 — **행 오른쪽 끝의 메타가 서는 조건**이다(결정 2·3). 그것이 무엇을
   * 적는지는 이제 메타 조각이 정한다: 셸 수와 도는 것을 **둘 다 아는 자리**에서만 「그 밖의
   * 셸」의 수를 낼 수 있어서, 두 값이 `ShellMeta` 하나로 합쳐졌다(결정 3·13).
   *
   * **이 파일은 터미널 스토어를 모른다.** 개수도 메타도 위(Sidebar)에서 내려온다:
   * 여기서 `terminal-store`를 import하면 `@xterm/*`와 그 CSS가 따라 들어와 이 목록의
   * 정적 마크업 검사가 서지 못한다(SidebarWorkList.test.tsx가 그 계약을 센다).
   */
  shellCounts: Record<string, number>;
  /**
   * 행 오른쪽 끝의 **셸 메타**. 같은 이유로 슬롯이다 — 그리는 것은
   * `components/shell/shell-meta`의 `ShellMeta`이고, 값을 고르는 자리는 터미널 스토어를 아는
   * Sidebar다(결정 13).
   */
  renderShellMeta: (work: WorkView) => ReactNode;
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

  // 작업을 옮긴다. **보던 화면을 기억에서 되살린다**(결정 77) — 문서·본문·분할 셋이다.
  // 터미널을 보다 옆 작업을 잠깐 들여다보고 돌아왔을 때 문서로 떨어지는 것이 그 결정이
  // 없애려는 것이다. 떠나던 주소는 딸려가지 않는다: `viewSearch`가 빈 객체 위에 얹으므로
  // 실리는 것은 **이 작업의 기억**뿐이고, 그 `file`도 이 작업 안의 문서다.
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
            renderShellMeta={renderShellMeta}
          />
        </div>
      </div>

      {/* onClose를 넘기지 않는다 — 바깥 클릭 막이 깔리면 포인터를 가로채 열자마자 닫힌다.
          이 카드의 여닫음은 행의 hover가 온전히 소유한다. */}
      {hovered && (
        <PopoverPortal
          anchorRef={hoverAnchor}
          side="right"
          // **행에서 재는 값이다**(결정 30). 행의 오른쪽 끝은 거터 8px만큼 사이드바
          // 경계선보다 안쪽이라, 카드는 그 8px을 덮고 경계선 위로 올라선다 — 카드가
          // 사이드바에 얹혀 떠 있다는 사실을 그렇게 말한다. 한때 이 값이 19px이었다
          // (거터 8 + 늘 예약된 스크롤바 11) — 결정 32가 막대를 위로 띄우며 그 11을 걷었다.
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
  renderShellMeta,
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
  renderShellMeta: (work: WorkView) => ReactNode;
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
      shellMeta={renderShellMeta(work)}
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

// **한 줄이다** — 상태 점 + 제목 + (핀과 셸 메타가 겹쳐 서는 오른쪽 끝 한 칸). 바로 위 nav
// 항목과 규격을 맞춘다(높이·반지름·간격·글자 크기): 둘이 세로로 붙어 있어 규칙이 다르면 그
// 자리에서 어긋난다.
// 좁은 폭이라 제목이 자주 넘치는데, hover하면 마퀴가 흘려 보여주고 호버 카드가 전체를
// 줄바꿈해 보여준다 — **마퀴가 빠른 답, 카드가 완전한 답**이다(결정 11). title 속성을 함께
// 두면 OS 툴팁이 카드 위로 겹쳐 뜬다.
//
// 행 전체가 button이던 것이 **바깥 상자 + 형제 버튼 둘**이 됐다. 중첩 button은 HTML에서
// 허용되지 않고, span role="button"으로 흉내 내면 Tab으로 도달할 수 없다 — SpecTree의
// 파일 행이 이미 같은 문제를 그 구조로 풀었다.
// 배경(선택·hover)은 바깥 상자가 갖고, 가로 여백은 이름 버튼이 품는다: 바깥이 가진
// padding은 두 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리가
// 된다. 남는 것은 오른쪽 끝 pr-1뿐이고 그건 핀과 메타를 행 가장자리에서 띄우는 값이다 —
// 메타의 `pr-[5px]`와 합쳐 **9px**이 되어, 구획 헤더 `작업`의 개수(`px-[9px]`)와 같은 x에
// 오른쪽 끝이 선다. 한 컬럼에 세로로 붙어 서는 숫자들이 다른 무게로 읽히지 않게 하는 그
// 계약(`SidebarItem` 주석)에 이제 work 행도 들어와 있다.
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
  shellMeta,
}: {
  work: WorkView;
  active: boolean;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  onTogglePin: (work: WorkView) => void;
  /** 이 work의 셸 수 — **메타가 서는 조건이다**(결정 2·3). */
  shellCount: number;
  /** 행 오른쪽 끝의 **셸 메타**. 슬롯으로 온다 — 그리는 것은 `ShellMeta`다(결정 13). */
  shellMeta: ReactNode;
}) {
  // 제목 상자 — **hover 진입 때만** 만진다(아래 onMouseEnter).
  const titleBox = useRef<HTMLSpanElement>(null);
  return (
    <div
      onMouseEnter={(e) => {
        // **재는 것은 속도 하나이고, 이 한 번뿐이다**(결정 12). 흐르는 거리는 CSS가 정하므로
        // (결정 10) 여기서 넘침을 읽는 것은 그 거리를 **시간으로** 바꾸기 위해서다 —
        // `calc()`는 길이를 시간으로 못 바꾼다. 자리가 이 핸들러인 것은 호버 카드 타이머를
        // 이미 여기서 걸기 때문이고, 그래서 **쉴 때 계측도 관찰자도 없다**: 사이드바 폭이
        // 바뀌면 `100cqw`가 스스로 다시 풀리고, 호버 중에 폭을 끄는 경우는 없다.
        //
        // **표식을 지속시간과 함께 단다.** 마퀴를 `:hover`로 켜면 브라우저가 이 핸들러보다
        // 먼저 hover 스타일을 계산해, 그 행을 처음 가리킬 때 트랜지션이 `--marquee-ms` 없이
        // 0ms로 만들어지고 제목이 툭 튀어 끝으로 간다(실측). 둘이 한 번의 스타일 변화로
        // 들어가야 그 갈래가 없다 — 그래서 켜는 것도 여기다.
        const box = titleBox.current;
        if (box) {
          const over = box.scrollWidth - box.clientWidth;
          box.style.setProperty(
            "--marquee-ms",
            `${Math.round(((over + TITLE_FADE) / MARQUEE_SPEED) * 1000)}ms`,
          );
          box.setAttribute("data-marquee", "");
        }
        onHover(work.slug, e.currentTarget);
      }}
      onMouseLeave={() => {
        // 제자리로 돌아온다 — 복귀 시간(180ms)은 표식이 없는 평상시 규칙이 든다(결정 11).
        titleBox.current?.removeAttribute("data-marquee");
        onLeave();
      }}
      className={cn(
        // **flex가 아니라 grid다**(결정 1). 메타와 핀이 **2열 같은 칸에 겹쳐** 서야 하는데,
        // 그 둘을 상자 하나로 묶으면 요소만 늘고 칸 폭 계산은 똑같다. 그리고 첫 줄을 상자로
        // 한 겹 싸면 **이름 버튼의 부모**가 그 상자가 되어, 그것으로 배경 상자를 집는 자리가
        // 조용히 어긋난다 — e2e가 이름 버튼의 `parentElement`로 호버 카드 자리를 잰다.
        // (한때 이 주석이 「핀의 `parentElement`」라고 적어 뒀는데 그런 자리는 없다. 그
        // 한 줄이 스펙까지 물려가 안 하나를 잘못 기각했다 — 결정 1이 그 내력을 든다.)
        //
        // **2열은 한 무리분(28px)을 바닥으로 예약한다**(결정 2·5). `auto`로 두면 로고가
        // 붙을 때마다 칸이 넓어져 제목이 끊기는 자리가 초마다 밀린다 — 판 04가 행 높이에서
        // 기각한 그 흔들림을 90도 돌린 것이다. 한 무리 = 글리프 12 + 간격 4 + 숫자 7 = 23px,
        // 오른쪽 여백 5px. 셸이 하나인 work은 무리가 늘 정확히 하나라 제목이 영영 안 움직이고,
        // 셸이 0개인 행도 같은 폭을 내 제목이 끊기는 자리가 행마다 갈리지 않는다.
        // **바닥이지 상한이 아니다** — 무리가 둘 이상이면 `minmax`의 위쪽(`auto`)이 받는다.
        "group grid w-full shrink-0 grid-cols-[minmax(0,1fr)_minmax(28px,auto)] items-center rounded-[10px] pr-1 transition-colors",
        active ? "selected-row" : "text-muted-foreground hover:bg-state-1",
      )}
    >
      <button
        type="button"
        // **누르면 그 work로 간다 — 늘 그것 하나다**(결정 6). 한때 고른 work의 행만은
        // 접기 토글이었는데(결정 101), 접을 것이 없어지면서 그 갈래가 통째로 사라졌다.
        // 어느 행이든 같은 일을 하는 것이 이 목록에 남은 규칙 전부다.
        onClick={() => onOpen(work.slug)}
        // 행의 높이를 **이 버튼이 든다** — 바깥이 grid라 `h-full`은 자기가 잰 높이를 되받는
        // 순환이 된다. nav 항목과 맞춰야 하는 규격이 이 32px이고, 이제 셸이 몇 개든 무엇이
        // 돌든 모든 work 행이 이 높이다(결정 0) — 겹쳐 선 메타·핀은 둘 다 이보다 낮다.
        className="flex h-8 min-w-0 items-center gap-(--glyph-gap) pl-[9px] pr-1.5 text-left"
      >
        <StatusIcon status={work.status} />
        {/* **제목은 `…`이 아니라 오른쪽 끝 페이드로 끝나고, 마우스를 올리면 흘러 끝까지
            읽힌다**(결정 9). 폭으로는 이 문제를 못 풀어서다 — 핀을 띄워도 +24px, 이 버튼의
            여백을 없애도 +6px, 기본 사이드바 폭 조정은 저장된 폭이 이겨 0px이라 다 합쳐도
            두 글자다. 그래서 이 판은 제목 폭을 짜내지 않는다.

            **상자와 안쪽 글자가 갈려 있다.** 상자가 컨테이너이자 마스크이고 흐르는 것은
            안쪽 글자다 — 규격도 거리도 `index.css`의 `[data-title]`이 든다(결정 10·11).
            여기 `flex-1 min-w-0`은 그 딸린 조정이다: `container-type: inline-size`가
            「내 폭이 내용에 안 달렸다」는 선언이라, 내용 기반 flex-basis로 두면 상자가
            **0으로 무너져** 제목이 통째로 사라진다.

            색은 상자가 든다 — 안쪽 글자가 그대로 물려받는다. **안쪽 글자에는 클래스가
            없다** — 규격을 유틸리티로 다시 적으면 그것들이 `utilities` 레이어에 들어가 레이어
            밖의 `[data-title] > span`에 무조건 져서, 고쳐도 화면이 안 바뀌는 손잡이가 된다. */}
        <span
          ref={titleBox}
          data-title=""
          className={cn(
            "min-w-0 flex-1 text-[13.5px] font-medium",
            work.status === "done" && "text-tertiary",
          )}
        >
          <span>{work.title}</span>
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
          않는다 — 행에 머물면 호버 카드가 떠서 OS 툴팁이 그 위로 겹친다.

          **메타와 같은 칸에 선다**(결정 1) — 2열 1행에 둘 다 놓으면 겹침이 이미 되고 칸 폭은
          `max(메타, 핀)`이다. `peer`는 **아래 메타가 이 버튼의 포커스를 보기 위한 것**이다
          (결정 7): 이 핀은 hover뿐 아니라 포커스에도 뜨므로, 메타를 `group-hover`로만 물리면
          Tab으로 닿았을 때 둘이 겹쳐 그려진다. 후행 형제에만 걸리는 선택자인데 DOM 순서가
          이미 `이름 버튼 → 핀 → 메타`라 그대로 먹는다. */}
      <button
        type="button"
        aria-label={`${work.title} 고정`}
        aria-pressed={work.pinned}
        onClick={() => onTogglePin(work)}
        className="peer icon-button-tint col-start-2 row-start-1 shrink-0 justify-self-end text-tertiary opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100"
      >
        <Pin
          className="size-3"
          strokeWidth={1.8}
          fill={work.pinned ? "currentColor" : "none"}
        />
      </button>
      {/* **셸 메타 — 셸이 하나라도 있으면 선다**(결정 3). 셸이 0개인 work의 행에는 아무것도
          안 선다: 「없음」은 숫자로 말하지 않는다. 한때 이것이 왼쪽 32px을 들여쓴 **둘째 줄**
          이었고 행 높이가 곧 「여기서 일이 돌고 있다」는 신호였다 — 결정 0이 그것을 뒤집었다.
          그 줄이 실제로 쓰는 폭은 25px이었고, 왼쪽 들여쓰기는 철거된 트리의 유물이라 트리처럼
          보이는데 눌러도 아무 일이 없는 자리였다.

          「명령이 도는 동안만 선다」는 **기각됐다**: 그 값은 매 순간 바뀌어서(백엔드가
          1초마다 잰다) 자리에 매면 claude가 답을 마칠 때마다 이 칸이 생겼다 사라지고 제목이
          끊기는 자리가 좌우로 뛴다. 자리가 서는 조건은 **안 변하는 값**이고, 변하는 것은
          그 **안에서**만 변한다 — 그래서 도는 것이 하나도 없어도 이 자리는 그대로 선다.

          **여기 적히는 것은 「무리」의 나열이다**(결정 3). 무리 하나 = 글리프 + 그 무리의
          셸 수이고, **숫자를 다 더하면 이 work의 셸 수**다. 셸 수를 여기서 직접 적지 않는
          이유가 그 불변조건이다 — 「그 밖의 셸」의 수는 셸 수와 도는 것을 **둘 다 아는
          자리**에서만 나오므로, 세는 규칙도 규격도 `ShellMeta` 하나가 든다(결정 13).
          바깥인 이 상자가 드는 것은 **격자 칸 · hover 페이드 · 표식** 셋뿐이다(결정 14) —
          그림 컴포넌트는 슬러그를 모르므로 표식이 여기 있다.

          **핀과 같은 칸에 겹친다**(결정 1). hover하면 메타가 **투명해지고**(`hidden`이 아니다 —
          `display:none`은 칸 폭 계산에서 빠져 칸이 핀의 24px로 줄고 hover마다 제목이 좌우로
          뛴다) 그 자리에 핀이 선다. `visibility:hidden`도 아니다: 셸 수가 마우스 위치에 따라
          있다 없다 하는 정보가 되면 안 된다(결정 6). 트랜지션은 안 건다 — 옆 행으로 옮겨 갈 때
          두 페이드가 겹쳐 미끄러져 보인다(icon-button-tint가 opacity를 뺀 것과 같은 이유).
          **`peer-focus-visible`이 함께 가는 이유는 핀이 포커스에도 뜨기 때문이다**(결정 7).
          `group-focus-within`은 틀린 답이다 — 이름 버튼에 포커스가 가도 메타가 물러나는데
          그때는 핀이 안 떠서 그 자리가 통째로 빈다.

          **표시 전용이다**(결정 5). 무리 하나가 셸 여럿을 접으므로 무리와 셸이 1:1이 아니고,
          누르면 어느 셸로 갈지 정해지지 않는다. 그래서 `pointer-events-none`이 상시다 —
          누를 것이 없을 뿐 아니라, 겹친 자리라 이것이 위에 있으면 **핀의 클릭을 가로챈다.** */}
      {shellCount > 0 && (
        <div
          data-shells={work.slug}
          className="pointer-events-none col-start-2 row-start-1 flex items-center justify-self-end group-hover:opacity-0 peer-focus-visible:opacity-0"
        >
          {shellMeta}
        </div>
      )}
    </div>
  );
}

export default SidebarWorkList;
