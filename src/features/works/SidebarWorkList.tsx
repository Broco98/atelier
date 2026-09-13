import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { PopoverPortal } from "@/components/ui/popover-portal";
import type { ShellSignal } from "@/components/shell/shell-signal";
import { armDrag, cancelDrag, dragStore, type DragPoint } from "@/lib/pointer-drag";
import { recallSearch } from "@/routes/-work-search";
import { routesOf, slugOf, type Mode } from "@/mode";
import { useMoveWork, useSetWorkPinned, useWorks } from "./hooks";
import { WorkCard } from "./WorkCard";
import { WorkSectionList } from "./WorkSectionList";
import {
  edgeScrollStep,
  gapMark,
  orderChanged,
  rowGap,
  type ListGeometry,
  type RowGap,
  type SectionGeometry,
} from "./row-drop";
import { splitWorkSections } from "./work-sections";
import type { SectionsOpen } from "./work-sections";
import type { WorkView } from "./types";

// 목록을 훑어 지나가는 동안 카드가 연달아 튀어나오지 않을 만큼은 머물러야 한다
const HOVER_DELAY_MS = 350;

// 접기는 "설정"이라 영속한다 — 이 앱의 "설정은 영속, 위치는 세션" 원칙에서 사이드바 접힘과 같은 쪽이다.
// 한때 초안 구역의 접힘(`sidebar-drafts-open`)도 여기 있었다 — 구역이 걷히면서(UI개선 결정 5) 키도
// 걷었다. 남은 값은 읽지 않고 버려 둔다: 지울 이유가 없고, 지우는 코드는 영영 남는다.
const PINNED_OPEN_KEY = "sidebar-pinned-open";
const WORKS_OPEN_KEY = "sidebar-works-open";

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
   * 주소에서 다시 읽지 않고 셸이 내려준다: 세계를 판정하는 자리는 셸 하나이고(`shellMode`),
   * 그 합성이 두 자리에 있으면 둘이 갈리는 날 목록과 세그먼트가 다른 세계를 가리킨다.
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

  useEffect(() => {
    localStorage.setItem(PINNED_OPEN_KEY, pinnedOpen ? "1" : "0");
  }, [pinnedOpen]);
  useEffect(() => {
    localStorage.setItem(WORKS_OPEN_KEY, worksOpen ? "1" : "0");
  }, [worksOpen]);

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
  };
  const sections = splitWorkSections(works, sectionsOpen);
  const { visible } = sections;
  // 어느 구획을 접었는지만 아래에서 올라온다 — 어느 setState인지는 여기서 고른다.
  const toggleSection = (section: keyof SectionsOpen) => {
    ({ pinned: setPinnedOpen, works: setWorksOpen })[section]((v) => !v);
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
  // 없고, 앵커가 문서에서 떨어져 위치 계산이 0,0으로 무너진다. (예: `고정`이 접힌 채로
  // 호버 중인 작업을 고정하면 그 행이 접힌 구획으로 옮겨져 사라진다)
  const hovered = visible.find((work) => work.slug === hoveredSlug) ?? null;

  // **목록이 내려가 있는가**(UI개선 결정 24). 윗 가장자리의 선이 이 한 값을 읽는다. 스크롤
  // 위치 자체가 아니라 「0인가」만 들고 있어, 굴러가는 동안 같은 값이 연달아 와도 React가
  // 다시 그리지 않는다 — 다시 그려지는 것은 맨 위를 떠나고 돌아오는 두 순간뿐이다.
  const [scrolled, setScrolled] = useState(false);

  const closeCard = () => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHoveredSlug(null);
  };
  const openCardAfterDelay = (slug: string, row: HTMLElement) => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    // **끄는 동안엔 카드가 안 뜬다**(UI개선 스펙 §4) — 놓을 자리를 가린다. 끄는 것이 탭이어도
    // 같다: 사이드바를 스쳐 가는 포인터마다 행이 hover를 받는다. 기다리는 사이 끌기가 시작될 수
    // 있어 뜨는 순간에도 다시 본다.
    if (dragStore.state.source !== null) return;
    hoverTimer.current = window.setTimeout(() => {
      if (dragStore.state.source !== null) return;
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

  // ── 행 끌기(UI개선 스펙 §4) ─────────────────────────────────────────────────────────────
  // **드래그 상태는 여기서 구독해 아래로 내린다** — 구획 목록은 훅을 안 부르는 그림이다(그쪽 파일
  // 머리 · 소스 검사). 몸짓 자체(문턱 · 창 리스너 · 클릭 삼킴 · Esc)는 공용 모듈의 것이고, 이
  // 목록이 쥐는 것은 **틈**뿐이다: 행 사이에는 「내 위다」를 말할 요소가 없어 좌표로 정해야 한다.
  const moveWork = useMoveWork(mode);
  const listBox = useRef<HTMLDivElement>(null);
  const dragging = useStore(dragStore, (state) => state.source !== null);
  const draggedSlug = useStore(dragStore, (state) =>
    state.source?.kind === "work" ? state.source.slug : null,
  );
  // 끄는 동안 쥐는 기하 — 시작해 받침이 선 **다음 프레임에 한 번** 잰다(`row-drop` 머리말). 렌더에 안 쓰여
  // 상태가 아니다.
  const geometry = useRef<ListGeometry | null>(null);
  const [gap, setGap] = useState<RowGap | null>(null);
  // 재는 자리가 읽는 **최신** 구획. 끄는 손잡이는 누른 순간의 렌더에서 만들어져, 그 클로저의 `sections`는
  // 문턱을 넘기 전에 목록이 바뀌었으면 옛 것이다 — 기하의 slug와 화면의 행이 갈린다.
  const latest = useRef({ sections, sectionsOpen });
  useEffect(() => {
    latest.current = { sections, sectionsOpen };
  });

  // 문턱을 넘는 순간 이미 떠 있던 카드를 닫는다 — 끄는 것이 탭이어도(위 `openCardAfterDelay`).
  useEffect(() => {
    if (dragging) closeCard();
  }, [dragging]);

  // **끄는 도중 목록의 `(slug, pinned)` 순열이 바뀌면 끌기를 거둔다**(스펙 S8 · `orderChanged`). 재어 둔
  // 기하가 옛 순서의 것이라, 그대로 두면 보이는 선과 실제로 놓이는 자리가 갈린다. 거두는 것은 Esc와
  // 같은 길이라 아무것도 안 부른다. **제목·상태만 바뀐 갱신은 끌기를 살린다** — 에이전트가 spec을
  // 고칠 때마다 `works:changed`가 오고, 그때마다 끊기면 손이 논다.
  //
  // 비교 상대는 **바로 앞에 받은 목록**이다. 순열이 같음은 전이적이라, 앞 목록과만 대도 끌기를 시작할
  // 때의 목록과 댄 것과 답이 같다. (목록이 깊이 같으면 react-query가 같은 참조를 주어 여기 오지도 않는다.)
  const seenWorks = useRef(works);
  useEffect(() => {
    const before = seenWorks.current;
    seenWorks.current = works;
    if (dragStore.state.source?.kind === "work" && orderChanged(before, works)) cancelDrag();
  }, [works]);

  /** 스크롤 상자 안의 머리·행·받침을 재어 **내용 좌표** 기하로 옮긴다. */
  const measure = (): ListGeometry | null => {
    const box = listBox.current;
    if (!box) return null;
    const { sections, sectionsOpen } = latest.current;
    const rect = box.getBoundingClientRect();
    // 뷰포트 y → 내용 y. 잰 순간의 스크롤을 더해 두면 뒤에 굴러도 포인터 쪽에만 더하면 된다.
    const shift = box.scrollTop - rect.top;
    const span = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + shift, bottom: r.bottom + shift };
    };
    const rowEls = new Map(
      [...box.querySelectorAll<HTMLElement>("[data-work-row]")].map((el) => [el.dataset.workRow, el]),
    );
    const sectionOf = (key: keyof SectionsOpen, list: WorkView[]): SectionGeometry[] => {
      const head = box.querySelector(`[data-drop-head="${key}"]`);
      // 빈 받침(티켓 06). 빈 `고정`은 머리 없이 받침만 서므로 둘 다 없을 때만 구획이 없다.
      const slotEl = box.querySelector(`[data-empty-slot="${key}"]`);
      // 접힌 구획의 행·받침은 높이 0으로 DOM에 남는다(`SectionBody`) — 가리킬 수 없으니 안 싣는다.
      // 빈 `고정`의 받침은 몸통 밖이라 접힘과 무관하다.
      const reachable = sectionsOpen[key] || head === null;
      const emptySlot = slotEl && reachable ? span(slotEl) : undefined;
      const rows = sectionsOpen[key]
        ? list.flatMap((work) => {
            const el = rowEls.get(work.slug);
            return el ? [{ slug: work.slug, ...span(el) }] : [];
          })
        : [];
      const rest = { pinned: key === "pinned", rows, slugs: list.map((work) => work.slug) };
      if (head) return [{ ...rest, head: span(head), emptySlot }];
      return emptySlot ? [{ ...rest, head: null, emptySlot }] : [];
    };
    return {
      box: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      sections: [...sectionOf("pinned", sections.pinned), ...sectionOf("works", sections.main)],
    };
  };

  /**
   * 상자의 **지금** 뷰포트 사각형. 재어 둔 기하에서 이것만은 끄는 동안 낡는다 — 목록 바로 위의 「확인할 것」
   * 띠는 부르는 셸이 없으면 높이가 0이라, 끄는 사이 셸이 부르기 시작하면 목록이 띠 높이만큼 내려앉는다.
   * 순열은 그대로라 끌기는 살고(S8), 잰 순간의 상자를 쓰면 포인터가 그만큼 아래 내용을 가리킨다. 행과
   * 머리는 내용 좌표라 안 낡으므로 다시 재는 것은 이 사각형 하나 — 포인터를 읽을 때마다 레이아웃 읽기 한 번이다.
   */
  const liveBox = (box: HTMLElement): ListGeometry["box"] => {
    const { left, right, top, bottom } = box.getBoundingClientRect();
    return { left, right, top, bottom };
  };

  const gapUnder = (slug: string, point: DragPoint): RowGap | null =>
    geometry.current && listBox.current
      ? rowGap({ ...geometry.current, box: liveBox(listBox.current) }, slug, {
          x: point.clientX,
          y: point.clientY,
          scrollTop: listBox.current.scrollTop,
        })
      : null;

  const startDrag = (slug: string, from: DragPoint) => {
    // 끄는 동안의 프레임 루프 하나가 두 일을 한다 — 첫 프레임에 기하를 재고, 그 뒤로 가장자리에서 굴린다.
    let frame: number | null = null;
    let last: DragPoint | null = null;
    // 같은 틈이면 같은 객체를 둔다 — 포인터 이동마다 새 객체를 내면 그 빈도로 목록이 다시 그려진다.
    const aimAt = (point: DragPoint) => {
      const next = gapUnder(slug, point);
      setGap((now) => (now?.pinned === next?.pinned && now?.before === next?.before ? now : next));
    };
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const box = listBox.current;
      // **받침이 선 다음 프레임에 잰다**(스펙 S6). 문턱을 넘는 순간 드래그 상태가 켜지고 받침은 그 렌더에서
      // 서므로, 같은 콜백 안에서 재면 받침이 없는(또는 목록이 아직 안 밀린) 기하를 쥔다.
      if (geometry.current === null) {
        geometry.current = measure();
        if (last) aimAt(last);
        return;
      }
      if (!box || !last) return;
      // **가장자리 자동 스크롤**(스토리 13). 기하는 다시 안 잰다 — 내용 좌표라 포인터 쪽에 그 순간의
      // `scrollTop`만 더하면 된다(`row-drop` 머리말). 대신 포인터가 가만히 있어도 그 아래 내용이 바뀌므로
      // 틈을 다시 겨눈다.
      const step = edgeScrollStep(liveBox(box), { x: last.clientX, y: last.clientY });
      if (step === 0) return;
      const before = box.scrollTop;
      box.scrollTop = before + step;
      if (box.scrollTop !== before) aimAt(last);
    };
    armDrag({ kind: "work", slug }, from, {
      start: () => {
        frame = requestAnimationFrame(tick);
      },
      move: (point) => {
        last = { clientX: point.clientX, clientY: point.clientY };
        aimAt(point);
      },
      // 놓인 자리를 **놓는 순간의 포인터로 다시** 판정한다 — 마지막 이동과 떼기 사이에 굴렀을 수 있다.
      drop: (point) => {
        const at = gapUnder(slug, point);
        if (at) moveWork.mutate({ slug, ...at });
      },
      end: () => {
        if (frame !== null) cancelAnimationFrame(frame);
        geometry.current = null;
        setGap(null);
      },
    });
  };

  // 선이냐 밝아진 받침이냐는 `gapMark` 한 자리가 재어 둔 기하로 정한다 — 둘이 함께 켜지는 일이 없다.
  const mark = gap && geometry.current ? gapMark(geometry.current, gap) : null;
  const lineY = mark && "lineY" in mark ? mark.lineY : null;
  const litEmptySlot = mark && "emptySlot" in mark ? mark.emptySlot : null;

  return (
    <>
      {/* 두 섹션은 이 한 스크롤 영역에 이어진다 — 헤더도 함께 스크롤한다. */}
      <div className="relative flex min-h-0 flex-1 flex-col px-2">
        {/* **목록이 스크롤됐을 때만 윗 가장자리에 선이 선다**(UI개선 결정 24). 선은 굴러가는 상자
            **밖**, 스크롤하지 않는 이 부모에 절대 위치로 선다 — 상자 안에서 그리는 길 셋이 다 막혔다:
            - 상자에 `border-top`: 오버레이 막대가 `clientTop`만큼 밀리고(`lib/scroll-quiet.ts`의
              `show`) 콘텐츠가 1px 내려앉는다. 선이 서고 사라질 때마다 목록이 들썩인다 — 이 판이
              없애려는 그것이다.
            - inset 그림자: 행의 배경(선택·hover)이 그 위를 덮는다.
            - 상자 안 `::before`: 내용과 함께 굴러 올라가 버린다.
            부모의 윗변이 곧 상자의 윗변이라 띠가 있으면 띠 아래, 없으면 nav 아래가 저절로 된다.
            폭은 `inset-x-0`이 부모의 패딩까지 덮어 사이드바 폭 그대로다 — 바닥 Settings 칸의 윗선과
            같은 폭이다. 누를 것이 아니라 `pointer-events-none`이다: 첫 행 윗변 1px을 가리면 안 된다. */}
        {scrolled && (
          <div
            data-worklist-edge=""
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-border"
          />
        )}
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
          ref={listBox}
          onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
          // `relative`는 틈 선의 기준이다 — 선이 내용 좌표로 서서 목록과 함께 구른다(구획 목록의 선 주석).
          className="relative -mx-2 flex min-h-0 flex-1 flex-col gap-(--row-gap) overflow-y-auto px-2 pb-1 scroll-quiet"
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
            draggedSlug={draggedSlug}
            lineY={lineY}
            litEmptySlot={litEmptySlot}
            onArmDrag={startDrag}
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

export default SidebarWorkList;
