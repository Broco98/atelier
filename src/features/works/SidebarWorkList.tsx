import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { SIGNAL_LABEL, SignalLane, type ShellSignal } from "@/components/shell/shell-signal";
import { recallSearch } from "@/routes/-work-search";
import { routesOf, slugOf, type Mode } from "@/mode";
import { useSetWorkPinned, useWorks } from "./hooks";
import { WorkCard } from "./WorkCard";
import { emptyMainNotice, listLabelOf, splitWorkSections } from "./work-sections";
import type { SectionsOpen, WorkSections } from "./work-sections";
import { StatusIcon } from "./status";
import type { WorkView } from "./types";

// 목록을 훑어 지나가는 동안 카드가 연달아 튀어나오지 않을 만큼은 머물러야 한다
const HOVER_DELAY_MS = 350;

// 제목이 흐르는 **속도**(결정 11). 거리에 비례한다 — 고정 지속시간은 기각됐다: 넘침 30px은
// 12px/s로 기고 200px은 80px/s로 달려 읽는 속도가 제목마다 갈린다.
const MARQUEE_SPEED = 50; // px/s
// 오른쪽 끝 페이드의 폭. **`index.css`의 `--title-fade`와 같은 수여야 한다** — 흐르는 거리가
// 「넘침 + 이 값」이고(결정 11), 거리는 CSS가 정하는데(결정 10) 그것을 **시간으로 바꾸는**
// 자리가 여기라서 둘이 같은 수를 읽는다. `calc()`가 길이를 시간으로 못 바꾸는 것이 이
// 한 값이 두 언어에 걸치는 이유 전부다(결정 12). 그 「같은 수」는 주석이 아니라
// `SidebarWorkList.test.tsx`의 소스 스캔이 지킨다 — 어긋나도 화면에는 속도 오차로만 나타난다.
const TITLE_FADE = 12; // px

// 접기는 "설정"이라 영속한다 — 이 앱의 "설정은 영속, 위치는 세션" 원칙에서 사이드바 접힘과 같은 쪽이다.
// 초안만 기본 접힘이다: 백로그를 상시 노출하지 않는 것이 초안 구역을 만든 이유다.
const PINNED_OPEN_KEY = "sidebar-pinned-open";
const WORKS_OPEN_KEY = "sidebar-works-open";
const DRAFTS_OPEN_KEY = "sidebar-drafts-open";

// 사이드바에 상주하는 목록. 어느 화면에 있든 그대로 있고, 항목을 누르면 그 항목의 화면으로
// 간다 — **어느 세계의 목록인가는 `mode`가 정한다**(Atelier `작업` · Maison `Rooms`).
//
// 이건 전역 컨텍스트가 아니라 **전환 수단**이다 — "선택된 작업"이 앱 전체에 걸리는 개념은
// 도입하지 않는다. 다른 화면들은 작업 선택과 무관하게 독립 동작한다.
function SidebarWorkList({
  open,
  mode,
  shellCounts,
  signals,
  renderSubrow,
}: {
  open: boolean;
  /**
   * 어느 세계의 목록인가. **읽는 곳과 가는 곳이 이 값 하나에서 함께 나온다**(#183) —
   * 데이터만 모드로 갈면 Maison에서 목록은 Room인데 행을 누르면 Atelier로 튄다.
   *
   * 주소에서 다시 읽지 않고 셸이 내려준다: `/settings`에는 모드가 안 실려 마지막 모드를
   * 얹어야 답이 나오는데(`shellMode`), 그 합성이 두 자리에 있으면 설정 화면에서만 목록과
   * 세그먼트가 다른 세계를 가리킨다.
   */
  mode: Mode;
  /**
   * work별 셸 개수 — **둘째 줄이 종류·수를 싣는가, 프로젝트 이름을 싣는가**를 가르는
   * 값이다(결정 2·3, 이 판 결정 5). 종류·수가 무엇을 적는지는 메타 조각이 정한다: 셸 수와
   * 도는 것을 **둘 다 아는 자리**에서만 「그 밖의 셸」의 수를 낼 수 있어서, 두 값이
   * `ShellMeta` 하나로 합쳐졌다(결정 3·13).
   *
   * **이 파일은 터미널 스토어를 모른다.** 개수도 메타도 위(Sidebar)에서 내려온다:
   * 여기서 `terminal-store`를 import하면 `@xterm/*`와 그 CSS가 따라 들어와 이 목록의
   * 정적 마크업 검사가 서지 못한다(SidebarWorkList.test.tsx가 그 계약을 센다).
   */
  shellCounts: Record<string, number>;
  /**
   * work마다의 **화면값**(#203) — 레인이 점·링을 세울지 work 상태 아이콘을 세울지, 그리고
   * 행 버튼의 이름에 상태 말이 붙을지를 가른다. 값이 없는 work은 **키 자체가 없다.**
   *
   * **개수와 같은 길로 온다**(위 주석) — 이 목록은 터미널을 모른다. 슬롯이 아니라 값인 것은
   * 두 자리가 함께 읽기 때문이다: 레인은 마크업 안쪽이고 이름은 버튼의 속성이라, 슬롯 하나로는
   * 둘째 자리에 닿지 않는다. **문자열 Record라 얕은 비교가 그대로 먹는다** — 객체를 담으면
   * 회차마다 새것이라 어느 셸에서 명령이 시작될 때마다 목록 전체가 다시 그려진다
   * (`signalsByOwner` 머리말).
   */
  signals: Record<string, ShellSignal>;
  /**
   * 둘째 줄의 **셸 갈래**. 같은 이유로 슬롯이고, 값을 고르는 자리는 터미널 스토어를 아는
   * Sidebar다(결정 13) — 이 목록은 터미널을 한 번도 참조하지 않는다.
   *
   * **오는 것이 하나가 아니다**(#203): 그 셸이 스스로 말했으면 **그 말**(마크 · message ·
   * 경과, `components/shell/shell-signal`의 `SignalLine`)이고, 조용하면 지금까지처럼 종류·수
   * (`shell-meta`의 `ShellMeta`)다. 셋째 갈래인 프로젝트 이름은 이 슬롯 밖이다 — 셸이 없는
   * 행의 것이라 터미널을 몰라도 그릴 수 있다(아래 `WorkRow`). 타입이 `ReactNode`뿐이라
   * 이 문단이 「이 슬롯에 무엇이 오나」를 묻는 유일한 자리다.
   */
  renderSubrow: (work: WorkView) => ReactNode;
}) {
  const { data: works = [] } = useWorks(mode);
  const navigate = useNavigate();
  const setPinned = useSetWorkPinned(mode);
  // 주소 리터럴이 박히는 자리는 모드 표 하나다(`-works-view.tsx`의 같은 줄) — 여기서
  // `/works/$slug`를 다시 적으면 Maison에서 Room을 누를 때마다 Atelier로 튄다.
  const routes = routesOf(mode);
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
  //
  // **읽는 자리가 `@/mode`의 `slugOf` 하나다.** 이 목록이 두 세계의 항목 주소를 다 읽어야 해서
  // 그리로 옮겼고, `/works/`를 박아 두던 `-work-search.ts`의 옛 파서는 호출부가 없어져 함께
  // 걷었다 — 답이 갈리는 파서 둘(`/works/a/b`를 `"a/b"`로 읽던 쪽)이 남아 있으면 항목 아래로
  // 화면이 갈라지는 날 다음 사람이 틀린 쪽을 고른다.
  const openSlug = useRouterState({
    select: (state) => slugOf(state.location.pathname),
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
  // 없애려는 것이다. 떠나던 주소는 딸려가지 않는다: `recallSearch`가 빈 객체 위에 얹으므로
  // 실리는 것은 **이 작업의 기억**뿐이고, 그 `file`도 이 작업 안의 문서다.
  const goTo = (slug: string) => {
    closeCard();
    void navigate({
      to: routes.item,
      params: { slug },
      search: recallSearch(mode, slug),
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
      {/* 두 섹션은 이 한 스크롤 영역에 이어진다 — 헤더도 함께 스크롤한다. */}
      <div className="flex min-h-0 flex-1 flex-col px-2">
        {/* **자리를 예약하지 않는다**(결정 32). 한때 scroll이었다 — 폭을 갖는 클래식 막대라
            auto로 두면 넘치는 순간 콘텐츠 폭이 11px 줄어 헤더와 행이 통째로 밀렸다
            (실측 264→253). 이제 막대가 콘텐츠 **위에** 떠서(scroll-quiet) 폭을 안 먹으므로
            예약할 것이 없고, 그만큼 행이 넓어진다.

            **`-mx-2 px-2`가 거터를 뚫고 나갔다 되돌린다.** 상자가 사이드바 폭을 통째로 쓰고
            (0~280) 안쪽 패딩이 콘텐츠를 제자리(8~272)에 둔다 — 보이는 것은 하나도 안 움직이고
            **막대만** 옮겨 간다.

            한때 거터가 이 상자 **바깥**에 있었고, 근거는 「스크롤바는 padding이 아니라 border
            안쪽 끝에 놓이므로 상자가 사이드바 폭을 그대로 쓰면 막대가 폭 조절 핸들 아래로
            들어가 막대를 잡으려다 폭 드래그가 시작된다」였다. **그 근거는 죽었다** — 결정 32가
            네이티브 막대를 걷고 우리가 그리면서 막대에 `pointer-events: none`이 붙었다(그쪽
            주석). 잡을 수 없는 것이 핸들을 가릴 일이 없다.

            대신 그 바깥 거터가 병을 하나 만들고 있었다. 막대는 **상자 안쪽 3~9px**에 서므로
            (`lib/scroll-quiet.ts`의 EDGE·THICKNESS), 상자가 이미 8px 들여쓰여 있으면 막대가
            사이드바 경계에서 **11~17px** 안쪽 — 즉 행 한가운데로 들어온다. 실측으로 핀·셸
            메타 상자(~268px)를 **5px 침범**했고, 사람이 실물에서 그것을 보고 말했다:
            「스크롤이 아직도 좀 이상한대?」 뚫고 나간 지금은 막대가 271~277에 서서 헤더 개수
            (263px)와 **8px**, 핀·메타 상자와 **3px** 떨어진다.

            같은 병이 프로젝트·아카이브 목록에도 있었고 같은 한 줄로 고쳤다(그쪽 `-mx-3 px-3`).
            바깥 거터가 없는 상자들(본문·설정)은 처음부터 막대가 경계에서 3~9px이라 성했다. */}
        {/* **표식은 검사가 이 목록을 정체성으로 집기 위한 것이다.** 한때 L3가
            `aside .scroll-quiet`로 집었는데, 그 클래스는 「굴러가는 상자」라는 겉모습이라
            같은 컬럼에 굴러가는 상자가 하나 더 서는 날(#204의 「확인할 것」 띠가 펼쳐지면
            그렇다) 자리(`.first()`)로 고르는 쪽이 **엉뚱한 상자를 집는다.** */}
        <div
          data-worklist=""
          className="-mx-2 flex min-h-0 flex-1 flex-col gap-(--row-gap) overflow-y-auto px-2 pb-1 scroll-quiet"
        >
          <WorkSectionList
            sections={sections}
            mode={mode}
            open={sectionsOpen}
            selectedSlug={selectedSlug}
            shellCounts={shellCounts}
            signals={signals}
            onToggleSection={toggleSection}
            onOpen={goTo}
            onHover={openCardAfterDelay}
            onLeave={closeCard}
            onTogglePin={togglePin}
            renderSubrow={renderSubrow}
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
          <WorkCard mode={mode} work={hovered} />
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
  mode,
  open,
  selectedSlug,
  shellCounts,
  signals,
  onToggleSection,
  onOpen,
  onHover,
  onLeave,
  onTogglePin,
  renderSubrow,
}: {
  sections: WorkSections;
  /** 목록이 자기를 뭐라고 부르는가가 여기서 갈린다 — 머리 라벨과 빈 몸통의 문구 둘 다. */
  mode: Mode;
  open: SectionsOpen;
  selectedSlug: string | null;
  shellCounts: Record<string, number>;
  signals: Record<string, ShellSignal>;
  onToggleSection: (section: keyof SectionsOpen) => void;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  onTogglePin: (work: WorkView) => void;
  renderSubrow: (work: WorkView) => ReactNode;
}) {
  const { pinned, main, drafts } = sections;
  // 세 구획이 같은 것을 그린다 — 한 벌로 묶어 두지 않으면 행의 모양을 정하는 자리가 셋이 된다.
  const row = (work: WorkView) => (
    <WorkRow
      key={work.slug}
      work={work}
      active={work.slug === selectedSlug}
      shellCount={shellCounts[work.slug] ?? 0}
      signal={signals[work.slug] ?? null}
      onOpen={onOpen}
      onHover={onHover}
      onLeave={onLeave}
      onTogglePin={onTogglePin}
      subrow={renderSubrow(work)}
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

      {/* 상주 목록의 헤더는 목록이 비어도 남는다 — 섹션이 있다는 사실 자체가 정보다.
          **라벨이 세계를 탄다**(US 17): Atelier `작업` · Maison `Rooms`. 형제인 `고정`·`초안`은
          상태의 이름이라 안 갈린다 — 갈리는 것은 「무엇의 목록인가」 하나뿐이다. */}
      <SectionHeader
        label={listLabelOf(mode)}
        className="mt-3"
        open={open.works}
        count={main.length}
        onToggle={() => onToggleSection("works")}
      />
      <SectionBody open={open.works}>
        {main.length === 0 ? (
          // **`mr-1`이 막대 자리를 비운다.** 이 span은 `SectionBody`의 grid 안에 있어
          // **블록으로 눕고**(grid item), 그래서 글자 길이와 무관하게 상자 폭을 통째로 쓴다 —
          // 8~272다. 바깥 상자가 `-mx-2 px-2`로 거터를 뚫고 나가 있어 막대는 271~277에 서므로
          // (`lib/scroll-quiet.ts`의 EDGE·THICKNESS) 그 272가 막대 자리를 4px 먹는다. 이웃한
          // 행들은 같은 272까지 오지만 **잎이 아니라** 안쪽 잎(핀·메타)이 268에서 멎어 성했고,
          // 폭을 통째로 쓰는 잎은 이것 하나뿐이라 여기만 어긋나 있었다. 아카이브의 같은 모양이
          // 성한 것은 그쪽 거터가 `-mx-3 px-3`이라 12px여서다.
          //
          // **목록이 넘칠 때만 보이는 병이라 오래 안 보였다.** 이 자리는 work이 0개일 때만 서고
          // 그때는 대개 목록이 안 넘치는데, 사이드바 최상단에 모드 세그먼트가 서면서 넘치는
          // 창이 넓어졌다 — 목록이 오기 전 한 프레임에 이 문구가 서는 그 창이다.
          <span className="mr-1 px-[9px] pb-1 text-[12.5px] leading-normal text-tertiary">
            {emptyMainNotice(sections, mode)}
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

// **두 줄이다**(이 판 결정 4) — 첫 줄에 레인과 제목, 둘째 줄에 셸의 종류·수나 프로젝트
// 이름. 오른쪽 끝 한 칸에는 hover에만 뜨는 핀만 남았다. **모든 행이 두 줄이라 높이는
// 신호이길 그만둔다** — 판 05가 32px 한 줄로 죽였던 「행 높이가 곧 여기서 일이 돈다는
// 뜻」을, 이 판은 줄을 되살리면서도 안 되살린다.
// 바로 위 nav 항목과는 이제 높이가 갈린다(nav 32 · 행 55) — 맞춰야 하는 규격은 반지름·
// 왼쪽 여백·글자 크기이고, 높이는 **행이 두 줄이 되면서 어차피 갈리는 값**이다.
// 좁은 폭이라 제목이 자주 넘치는데, hover하면 마퀴가 흘려 보여주고 호버 카드가 전체를
// 줄바꿈해 보여준다 — **마퀴가 빠른 답, 카드가 완전한 답**이다(결정 11). title 속성을 함께
// 두면 OS 툴팁이 카드 위로 겹쳐 뜬다.
//
// 행 전체가 button이던 것이 **바깥 상자 + 형제 버튼 둘**이 됐다. 중첩 button은 HTML에서
// 허용되지 않고, span role="button"으로 흉내 내면 Tab으로 도달할 수 없다 — SpecTree의
// 파일 행이 이미 같은 문제를 그 구조로 풀었다.
// 배경(선택·hover)도 **클릭도** 바깥 상자가 갖는다. SpecTree는 이름 버튼에 `h-full`을 줘
// 행 높이를 덮게 했는데(28px 한 줄이라 그것으로 됐다), 이 행은 두 줄 55px이고 둘째 줄이
// 그 버튼 밖의 형제라 같은 길이 없다 — 클릭이 이름 버튼에만 있으면 아래 29px이 배경만
// 덮이고 눌러도 아무 일이 없는 죽은 자리가 된다. 그래서 클릭이 바깥으로 올라갔고, 안쪽
// 여백은 그대로 안쪽 것들이 품는다(그 여백이 어느 버튼에도 안 속해도 이제 행이 받는다).
// 오른쪽 끝 `pr-[10px]`은 핀을 행 가장자리에서 띄우는 값이자 **이 행의 유일한 우 여백**이다.
// **「구획 헤더의 개수와 같은 x에 오른쪽 끝이 선다」는 계약은 여기서 떠났다** — 그 x에 서던
// 것이 셸 메타였고, 이 판이 그것을 둘째 줄로 내리면서 work 행의 오른쪽 끝에는 잴 것이 없다.
// 계약은 그것을 여전히 지키는 한 자리, nav `Terminal`로 갔다(`SidebarItem` 주석).
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
  signal,
  subrow,
}: {
  work: WorkView;
  active: boolean;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  onTogglePin: (work: WorkView) => void;
  /** 이 work의 셸 수 — **둘째 줄이 아래 슬롯을 싣는가 프로젝트 이름을 싣는가**를 가른다. */
  shellCount: number;
  /**
   * 이 work의 **화면값**(#203). 셸이 여럿이면 그중 최고 하나이고(결정 3), 없으면 `null`이다 —
   * 그때 레인은 work 상태 아이콘으로 되돌아가고 이름에도 아무 말이 안 붙는다.
   */
  signal: ShellSignal | null;
  /**
   * 셸이 있는 행의 **둘째 줄 내용**. 슬롯으로 온다 — 그 셸이 스스로 말했으면 그 말
   * (`SignalLine`), 아니면 종류·수(`ShellMeta`)다(#203). 셸이 없는 행의 프로젝트 이름은
   * 이 슬롯 밖이고 아래에서 그린다.
   */
  subrow: ReactNode;
}) {
  // 제목 상자 — **hover 진입 때만** 만진다(아래 onMouseEnter).
  const titleBox = useRef<HTMLSpanElement>(null);
  return (
    <div
      // **누르면 그 work로 간다 — 행 어디를 눌러도 그렇다**(결정 6). 이 자리가 이름 버튼이
      // 아니라 바깥 상자인 것은 **행이 두 줄이 되면서** 정해졌다: 이름 버튼은 첫 줄 26px만
      // 덮는데 배경(선택·hover)은 55px 전체에 깔리므로, 클릭이 그 버튼에만 있으면 아래
      // 29px이 「배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리」가 된다 — 이 파일이 아래
      // 두 자리에서 금지 사유로 드는 바로 그 모양이고, 게다가 그 29px은 프로젝트 이름·
      // 종류·수가 실리는 **내용이 있는 줄**이라 사람이 가장 누르기 쉬운 자리다. 판 05에는
      // 없던 갈림이다(그때는 이름 버튼이 `h-8`로 행 높이 전부를 덮었다).
      //
      // 그래서 **이름 버튼은 onClick을 안 든다** — 눌러도, 키보드로 켜도 그 클릭이 여기로
      // 올라온다(두 자리에 두면 한 번 눌러 두 번 돈다). 끊는 것은 핀 하나뿐이고, 그 한
      // 줄이 `stopPropagation`이다(핀 주석).
      onClick={() => onOpen(work.slug)}
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
        // **grid이고, 이제 칸이 넷이다**(2열 × 2행). 판 05는 메타와 핀을 2열 한 칸에 **겹쳐**
        // 세워 칸 폭을 `max(메타, 핀)`으로 만들었는데, 이 판이 메타를 둘째 줄로 내리면서
        // 그 겹침이 통째로 사라졌다 — **2열에 남은 것은 핀 하나뿐이다.**
        //
        // 대신 안 바뀐 것이 하나 있다: **첫 줄을 상자로 한 겹 싸지 않는다.** 싸면 **이름
        // 버튼의 부모**가 그 상자가 되어, 그것으로 배경 상자를 집는 자리가 조용히 어긋난다 —
        // e2e가 이름 버튼의 `parentElement`로 호버 카드 자리를 잰다. (한때 이 주석이 「핀의
        // `parentElement`」라고 적어 뒀는데 그런 자리는 없다. 그 한 줄이 스펙까지 물려가 안
        // 하나를 잘못 기각했다 — 결정 1이 그 내력을 든다.)
        //
        // **2열은 아무것도 예약하지 않는다 — 그냥 `auto`다.** 결정 2·5는 여기에 한 무리분
        // (28px)을 **바닥으로** 깔라고 했고, 그것이 실물 앱을 보고 **기각됐다**:
        // 「아이콘을 고려해서 미리 빼놨다는건 말이 안됨. 아이콘 생기면 그때 가변되는게 맞아.」
        // 자리는 선 것이 **실제로 있을 때** 난다. 그 「선 것」에 **핀도 든다** — 핀은 hover에만
        // 뜨므로 칸도 hover에만 24px이 된다(핀 주석).
        //
        // **그래서 이제 모든 행이 똑같이 움직인다** — hover에 핀이 서면 2열이 처음으로
        // 24px을 갖고 제목 상자가 그만큼 물러난다. 판 05에서는 그 뜀이 셸 0개인 행에만
        // 있었고(메타 27.91 > 핀 24라 메타가 선 행은 안 움직였다), 그 갈림이 곧 **셸이
        // 붙고 떨어질 때 제목이 끊기는 자리가 좌우로 뛰던** 병의 다른 쪽 얼굴이었다.
        // 메타가 둘째 줄로 내려가면서 둘 다 사라진다: 2열은 셸을 모르므로 **첫 줄의 폭이
        // 셸 수와 무관하다.**
        //
        // 핀을 격자 밖(`absolute right-1`)에 세우는 안은 그대로 기각이다 — 칸이 핀을
        // 모르므로 핀이 **제목 글자 위에 얹힌다**(실물에서 그 겹침을 보고 되돌렸다).
        // 사람이 고른 것이 그 갈림이다: 「호버하면, 자동으로 아이콘 위치만큼 text의 최대
        // 크기가 조정되지? 이런걸 원하는거임. (안겹치게)」
        //
        // **행 치수를 트랙으로 못박는다**(26px + 29px = 55px). 판 05가 눈으로 고른 flat
        // 안의 값이다(목업 `행-신호-세-안.html`): 안쪽 위 8 · 아래 7 · 좌 9 · 우 10,
        // 줄 높이 18·18, 줄 간격 4. 트랙을 auto로 두면 핀이 첫 줄 글자와 눈높이를 맞추려
        // 얹은 `mt-[5px]`가 트랙을 29px로 밀어 올려 행이 58px이 된다 — 높이가 다시
        // **아무도 안 시킨 값**이 되는 자리라, 이 판에서는 수를 여기 적는다.
        //
        // **여백은 안쪽 것들이 품는다.** 위 8은 이름 버튼의 `pt-2`, 아래 7은 둘째 줄의
        // `pb-[7px]`, 왼쪽 9는 이름 버튼의 `pl-[9px]`이 든다. 한때 그 분담의 근거가
        // 「바깥이 가진 띠는 두 버튼 어디에도 안 속해 죽은 자리가 된다」였는데, 클릭이
        // 바깥으로 올라가면서 그 근거는 사라졌다 — 지금 남은 이유는 **트랙마다 여백이
        // 갈린다**는 것 하나다(위 8은 1행, 아래 7은 2행). 오른쪽 10만 여기 있다: 그 자리에
        // 서는 것이 핀뿐이고, 핀은 자기 오른쪽에 여백을 두는 대신 칸 끝에 붙기 때문이다
        // (`justify-self-end`). 이름 버튼은 오른쪽 여백을 **안 든다** — 들면 그 6px이 이
        // 10에 더해져 우 여백이 16이 된다(그쪽 주석).
        "group grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[26px_29px] rounded-[10px] pr-[10px] transition-colors",
        // **채움은 없다**(이 판 결정 5). 지금처럼 평평한 행이고, 회색이 서는 것은 고른
        // 행 하나뿐이다 — 카드 채움(목업의 F·G)은 열여덟 행에 전부 무게를 줘 목록이
        // 게시판이 된다. 행이 두 줄이 되면서 그 유혹이 커진 자리라 여기 적어 둔다.
        active ? "selected-row" : "text-muted-foreground hover:bg-state-1",
      )}
    >
      <button
        type="button"
        // **화면값이 있으면 이름에 그 말이 붙는다**(스토리 33 · 결정 8). 레인의 점·링은
        // `aria-hidden`이라(shell-signal.tsx) 상태를 말하는 자리가 여기 하나다 — 색만이
        // 신호여선 안 된다. 말은 `SIGNAL_LABEL` 하나에서 오고 탭(#205)·띠(#204)가 같은
        // 표를 읽는다.
        //
        // **`aria-label`이지 숨은 글자가 아니다.** 이름을 이 속성이 통째로 정하면 붙는 자리와
        // 순서가 한눈에 보이고(제목이 먼저, 상태가 뒤), 값이 없을 때는 속성 자체가 없어
        // 이름이 안에 든 제목 글자 그대로가 된다 — 조용한 행의 이름으로 행을 집는 검사가
        // 그대로 산다.
        aria-label={signal === null ? undefined : `${work.title} — ${SIGNAL_LABEL[signal]}`}
        // **여는 것은 이 버튼이 아니라 행 상자다**(그쪽 주석) — 여기 onClick이 없는 것은
        // 클릭이 두 번 도는 것을 막기 위해서다. 그래도 버튼인 이유는 **이름과 포커스**다:
        // 「어느 행이든 누르면 그 work로 간다」(결정 6)를 스크린리더와 Tab에 말하는 자리가
        // 여기 하나이고, 상태 축이 들어오면서(#203) 그 말이 이 버튼의 이름에 덧붙었다(위 `aria-label`).
        // 한때 고른 work의 행만은 접기 토글이었는데(결정 101), 접을 것이 없어지면서 그
        // 갈래가 통째로 사라졌다 — 어느 행이든 같은 일을 하는 것이 이 목록에 남은 규칙이다.
        //
        // **첫 줄이다** — 위 8 + 줄 높이 18. 높이를 트랙이 이미 정하지만 여기도 적는 것은
        // 이 상자가 제목 폭을 푸는 자리이고(`data-title`이 그 안에서 `flex-1`이다) 포커스
        // 링이 그려지는 자리라서다.
        //
        // **오른쪽 여백은 없다.** 판 05는 여기 `pr-1.5`(6px)를 물어 행의 `pr-1`(4)과 합쳐
        // 우 10을 만들었는데, 이 판이 그 10을 통째로 행 상자로 옮기면서 그 6px이 남으면 우
        // 여백이 **16**이 된다 — 스펙이 적은 수(우 10)와 어긋나고, 셸이 없는 행의 제목이
        // 판 05보다 오히려 **6px 좁아진다**(스토리 25가 넓히라고 한 그 자리다). 핀과의
        // 겹침은 격자가 이미 막으므로(핀이 2열을 차지해 이 칸이 그만큼 물러난다) 이 6px은
        // 아무것도 안 지킨다 — 제목 상자가 핀 바로 앞에서 끝나는 것을 L3가 잰다.
        className="col-start-1 row-start-1 flex h-[26px] min-w-0 items-center gap-(--glyph-gap) pl-[9px] pt-2 text-left"
      >
        {/* **레인** — 첫 줄 왼쪽의 14px 한 칸(이 판 결정 5). **이 자리가 이 판에서 처음
            눈에 보이는 곳이다**(#203): 화면값이 있으면 점·링이, 없으면 work 상태 아이콘이
            선다. 표식(`data-lane`)은 그 앞 티켓이 자리에 붙여 둔 이름이고, 검사 셋이
            그것으로 이 칸을 집는다(마크업 seam · hover · 폭 드래그).
            **폭을 안 내준다.** 실제로 그것을 지키는 것은 옆 제목 상자다 — `[data-title]`이
            `min-width: 0`이라 좁아지는 값을 전부 흡수하므로 이 줄이 넘칠 일이 없고, 그래서
            `shrink-0`을 지워도 지금은 화면이 안 바뀐다(L3 실측). 그래도 적는 것은 제목 쪽
            규칙이 바뀌는 날 **이 자리가 먼저 찌그러지는 것**이 이 판에서 가장 나쁜 회귀라서다:
            제목은 잘려도 읽히지만 8px 점은 12px만 줄어도 사라진다. */}
        <span data-lane="" className="flex size-3.5 shrink-0 items-center justify-center">
          {/* **화면값이 있으면 그것이 이 자리를 가져간다**(결정 5). 없으면 work 상태 아이콘이
              그대로 선다 — draft·review·done을 가르던 자리가 사라지지 않는 것이 스토리 19다.
              둘이 함께 서는 갈래는 없다: 레인은 14px 한 칸이고, 거기서 두 글리프가 겹치면
              「한 자리만 보면 된다」(스토리 18)가 깨진다. */}
          {signal === null ? <StatusIcon status={work.status} /> : <SignalLane kind={signal} />}
        </span>
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

          **2열 1행에 혼자 선다.** 판 05에서는 셸 메타와 겹쳐 서서 칸 폭이 `max(메타, 핀)`
          이었는데, 메타가 둘째 줄로 내려가면서 이 칸에 남은 것이 핀뿐이다 — 그래서 이제
          **모든 행이 hover에 똑같이 24px 줄어든다**(판 05에서는 메타가 선 행만 안 움직였다).

          **`mt-[5px]`는 눈높이다.** 격자 1행이 첫 줄의 위 여백 8px까지 안고 있어(26px 트랙)
          그냥 두면 24px 핀이 트랙 위쪽에 붙어 제목 글자보다 5px 위에 뜬다. 트랙을 `auto`로
          두면 이 5px이 트랙을 밀어 행이 58px이 되므로, 행 상자가 트랙 높이를 수로 못박는다
          (그쪽 주석).

          **쉴 때 폭을 걷는 것이 `max-w-0`이다** — `width`가 아니라 `max-width`인 것은
          `icon-button`이 `width: 24px`을 들기 때문이다. 둘 다 유틸리티 레이어라 `w-0`으로
          덮으려 들면 승자가 Tailwind의 정렬 순서에 걸리는데, `max-width`는 다른 속성이라
          그 싸움 밖에 선다. 격자 트랙은 아이템의 max-content 기여를 `max-width`로 clamp하므로
          쉴 때 기여가 **0**이다(실측: 핀 상자가 268.0~268.0).

          **`display:none`은 안 된다 — 포커스가 안 들어간다.** 이 핀은 hover뿐 아니라
          **포커스에도** 떠야 하는데(결정 7) `display:none`인 요소는 `.focus()`를 받지 못해,
          e2e가 `pin.focus()`로 세는 그 계약이 통째로 무너진다. `max-w-0`은 상자를 지우지
          않으므로 포커스가 그대로 들어가고 `focus-visible:max-w-6`이 폭을 되돌린다.
          `overflow-hidden`은 그 0폭 상자 밖으로 글리프가 삐져나오지 않게 하는 것이다.

          **트랜지션을 안 건다.** `icon-button-tint`가 `transition-property: color`뿐이라
          폭은 즉시 바뀌는데, 그게 맞다 — 행의 `onMouseEnter`가 hover 스타일이 **이미 적용된
          뒤에** `clientWidth`를 읽어 마퀴 거리를 잰다(실측: 셸 0개 행에서 `client=198`,
          `scroll=284`, 넘침 86 + 페이드 12 = 98px → 1960ms). 폭에 트랜지션이 걸리면 그
          순간의 중간값이 잡혀 마퀴가 끝까지 못 흐른다.

          **`justify-self-end`가 자리를 붙든다.** 칸이 핀보다 넓을 때(메타 27.91px) 격자
          기본값 stretch면 핀 상자가 칸만큼 늘어나 글리프가 가운데로 밀린다. 끝에 붙이면
          셸이 있든 없든 **244~268px 한 자리**다(실측, 두 행 모두).

          **겹침이 없다.** 칸이 핀의 폭을 세므로 제목 상자가 그만큼 물러난다 — hover에
          제목 끝이 셸 0개 행에서 238.00px, 핀 시작이 244.00px로 **6px 떨어진다**(이름 버튼의
          `pr-1.5`). 페이드 띠(226~238px)와 핀 글리프(250~262px)도 갈린다. 한때 핀을 격자
          밖에 세웠을 때는 이 둘이 250~262px에서 **정확히 겹쳐** 끝 글자가 뭉개졌고, 사람이
          실물에서 그것을 보고 되돌렸다(행 상자 주석).

          **`peer`는 걷었다.** 판 05에서는 뒤에 선 셸 메타가 이 버튼의 포커스를 보고
          물러나야 해서 필요했는데(결정 7), 이 판이 그 물러남을 뒤집으면서 이 클래스를 읽는
          형제가 하나도 없어졌다. 읽는 사람이 없는 표식은 「여기 무슨 규칙이 걸려 있다」고
          거짓말한다. */}
      <button
        type="button"
        aria-label={`${work.title} 고정`}
        aria-pressed={work.pinned}
        onClick={(event) => {
          // **행 상자의 클릭을 끊는다.** 이 버튼은 행 안에 있으므로 그냥 두면 핀을 누를
          // 때마다 그 work가 함께 열린다 — 클릭이 행 상자로 올라가게 되면서 처음 생긴
          // 길이라, 이 한 줄이 그 길의 유일한 마개다.
          event.stopPropagation();
          onTogglePin(work);
        }}
        className="icon-button-tint col-start-2 row-start-1 mt-[5px] max-w-0 justify-self-end overflow-hidden text-tertiary opacity-0 outline-none focus-visible:max-w-6 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:max-w-6 group-hover:opacity-100"
      >
        <Pin
          className="size-3"
          strokeWidth={1.8}
          fill={work.pinned ? "currentColor" : "none"}
        />
      </button>
      {/* **둘째 줄 — 모든 행에 선다**(이 판 결정 4). 판 05가 이 줄을 걷어 오른쪽 끝
          한 칸으로 옮겼던 것을 되돌리되, 그때 걷은 병은 안 되돌린다: 그 판이 고친 것은
          「줄이 **셸이 있는 행에만** 서서 행 높이가 곧 신호였다」이고, 이 판은 **줄을 모든
          행에 세워** 같은 병을 없앤다. 높이는 여전히 아무 말도 안 한다.

          **왼쪽 32px 들여쓰기가 돌아왔지만 뜻이 다르다.** 판 05가 걷은 것은 철거된 트리의
          유물이라 트리처럼 보이는데 눌러도 아무 일이 없던 자리였다. 여기 32는 **첫 줄
          레인(9 + 14) + 간격 9**의 합이라, 이 줄의 왼쪽 끝이 위 제목의 왼쪽 끝과 정확히
          같은 x에 선다. 계단이 아니라 한 기둥이다.

          **두 칸을 다 쓴다**(`col-span-2`). 2열에는 핀이 서지만 그것은 1행뿐이라 이 줄은
          핀 아래를 지나간다 — 그래서 hover에 핀이 떠도 이 줄의 폭이 안 변한다. 1열에만
          두면 핀이 뜰 때마다 이 줄이 24px 좁아져 프로젝트 이름이 hover마다 잘렸다 폈다 한다.

          **기본색이 `muted-foreground`다.** 판 05의 오른쪽 메타는 `tertiary`였고 사이드바
          배경에서 대비가 3.0이었다 — 이 판이 시작된 사람의 말이 「이 한 줄이 가독성이 안
          좋다」이므로, 자리를 옮기는 것만으로는 그 말에 답이 안 된다. 부차 정보(무리의
          숫자·앞으로 붙을 경과)는 그 안에서 `tertiary`로 한 단 내려간다 —— 색을 내리는
          자리가 `ShellMeta` 안이라 이 상자는 **바닥만** 든다.

          **잘리는 쪽이 여기다**(`min-w-0 overflow-hidden`). 사이드바를 좁히면 레인은
          그대로고 제목과 이 줄의 글자가 먼저 잘린다.

          **누를 것이 없어 클릭을 통째로 흘려보낸다**(`pointer-events-none`). 이 줄이 이름
          버튼 밖의 형제라, 손으로 받으면 행의 아래 절반이 눌리지 않는 자리가 된다 — 클릭은
          행 상자가 받아야 한다(그쪽 주석). 딸려 오는 것이 하나 더 있다: 핀이 `mt-[5px]` +
          24px이라 1행 트랙(26px)을 3px 넘는데, 이 줄이 DOM에서 핀보다 **뒤**라 그 3px 띠에
          위로 얹힌다. 여기가 클릭을 안 받으면 그 띠도 핀의 것으로 남는다 —
          `icon-button-tint`가 규격을 그대로 쓰는 이유가 「배경이 없어도 **누르는 자리는
          같아야** 한다」이기 때문이다(index.css).

          **표식이 자리 이름인 것은 여기뿐이다.** 이 저장소의 규칙은 「표식은 그 자리에 있는
          것의 이름」인데(`data-shells`·`data-branch`·`data-section`), 이 줄은 **싣는 것이
          갈린다** — 셸이 있으면 종류·수, 없으면 프로젝트 이름, 셸이 스스로 말했으면 그 마지막
          말과 경과. 있는 것으로 이름을 붙이면 세 갈래 중 둘에게 그 이름이 거짓이 된다.
          안쪽 `data-shells`는 그 규칙을 그대로 지킨다 — 종류·수 갈래에만 붙는다(아래). */}
      <div
        data-subrow={work.slug}
        className="pointer-events-none col-span-2 row-start-2 flex min-w-0 items-center overflow-hidden pb-[7px] pl-[32px] pt-1 text-[11.5px] text-muted-foreground"
      >
        {shellCount > 0 ? (
          /* **셸 갈래 — 셸이 하나라도 있으면 선다**(결정 3). 「없음」은 숫자로 말하지
             않으므로 셸이 0개면 이 갈래가 통째로 없고, 대신 아래 프로젝트 이름이 선다.
             안에 오는 것은 종류·수이거나 그 셸의 마지막 말이다(#203, 슬롯의 주석) —
             아래 문단들이 「종류·수」를 말하는 것은 그 갈래를 두고 하는 말이다.

             「명령이 도는 동안만 선다」는 그때도 지금도 **기각이다**: 그 값은 매 순간
             바뀌어서(백엔드가 1초마다 잰다) 자리에 매면 claude가 답을 마칠 때마다 이
             칸이 생겼다 사라진다. 자리가 서는 조건은 **안 변하는 값**(셸을 포함하는가)
             이고, 변하는 것은 그 **안에서**만 변한다.

             **여기 적히는 것은 「무리」의 나열이다**(결정 3). 무리 하나 = 글리프 + 그
             무리의 셸 수이고, **숫자를 다 더하면 이 work의 셸 수**다 — 자리가 오른쪽
             끝에서 둘째 줄로 옮겨 와도 그 불변조건은 그대로이고, 그것을 재는 검사도
             `ShellMeta`를 보므로 함께 따라온다(shell-meta.test.tsx). 바깥인 이 상자가
             드는 것은 **표식** 하나뿐이다 — 그림 컴포넌트는 슬러그를 모른다.

             **표시 전용이다**(결정 5). 무리 하나가 셸 여럿을 접으므로 무리와 셸이 1:1이
             아니고, 누르면 어느 셸로 갈지 정해지지 않는다. 그 사실을 구조로 적는
             `pointer-events-none`은 이제 **바깥 줄이 통째로 든다**(그쪽 주석) — 여기 한 번
             더 적으면 「이 상자만의 규칙」으로 읽혀, 옆 갈래(프로젝트 이름)는 클릭을 받아도
             되는 것처럼 보인다. 둘 다 안 받는다.

             **표식은 종류·수일 때만 붙는다**(#203). 이 상자는 슬롯이라 셸이 말하기 시작하면
             안에 드는 것이 신호 줄(마크·말·경과)로 갈리는데, 그때도 `data-shells`가 붙어
             있으면 「이 표식 안은 무리 나열이고 숫자의 합 = 셸 수」라는 불변조건이 DOM에서
             조용히 거짓이 된다 — 표식을 딛는 검사는 그 사실을 못 보고 엉뚱한 것을 센다.
             가름을 여기서 다시 묻지 않고 행이 이미 쥔 `signal`로 하는 것이 요점이다: 레인이
             점을 세우는 근거와 **같은 값**이라 둘이 어긋날 수 없다. 상자 자체는 남는다 —
             레이아웃(`flex`)은 갈래와 무관하다. */
          <div
            data-shells={signal === null ? work.slug : undefined}
            /* **남는 폭을 다 차지한다**(`flex-1`) — 안에 드는 것이 신호 줄일 때 그 성질이
               결정적이다. `SignalLine`의 말 상자는 `flex-1`이라 이 상자가 내용에 붙어 앉으면
               (`flex: 0 1 auto`) 폭이 정확히 글자 폭이 되고, `[data-fade]`의 마스크는
               **상시라**(index.css · 결정 12) 오른쪽 끝 12px이 빈 자리가 아니라 **실제
               글자** 위에 떨어진다 — 넘치지도 않는 짧은 말이 늘 잘린 것처럼 읽혔다.
               띠(`attention-band.tsx`의 줄은 `w-full` 버튼 안이다)와 목업(`.row2 .l2`는 세로
               flex의 자식이라 stretch로 행 폭을 다 쓴다)은 둘 다 이 상자를 늘린다 — 행만
               어긋나 있었다. 종류·수 갈래는 안쪽이 왼쪽 정렬 `shrink-0`이라 화면이 그대로다.

               **조각 사이를 6px 띄운다**(`gap-1.5`, 목업 `.row2 .l2 { gap: 6px }`). 마크
               글리프는 `viewBox 0 0 16 16`을 거의 꽉 채우므로 0이면 로고가 첫 글자에 그대로
               닿는다. 자식이 하나인 종류·수 갈래에는 아무 영향이 없다. */
            className="flex min-w-0 flex-1 items-center gap-1.5"
          >
            {subrow}
          </div>
        ) : (
          /* **셸이 없으면 프로젝트 이름이다**(이 판 결정 5). 둘째 줄이 빈 채로 서지
             않게 하는 것이 이 갈래의 전부다 — 모든 행이 두 줄이라 빈 줄은 「여기엔
             아무 일도 없다」가 아니라 그냥 구멍으로 읽힌다.
             여럿이면 ` · `로 잇는다. 호버 카드는 같은 목록을 `, `로 적는데(위 CardField)
             거기는 문장 안이고 여기는 한 줄 메타라 구분자가 갈린다. 프로젝트가 하나도
             없는 work(초안이 흔하다)은 여기가 빈 문자열이고, 그때도 줄과 높이는 남는다. */
          <span className="truncate">{work.projects.join(" · ")}</span>
        )}
      </div>
    </div>
  );
}

export default SidebarWorkList;
