import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { useWorks } from "./hooks";
import { splitWorkSections } from "./work-sections";
import { formatCreated, StatusIcon, STATUS_META } from "./status";
import type { WorkView } from "./types";

// 목록을 훑어 지나가는 동안 카드가 연달아 튀어나오지 않을 만큼은 머물러야 한다
const HOVER_DELAY_MS = 350;

// 접기는 "설정"이라 영속한다 — 이 앱의 "설정은 영속, 위치는 세션" 원칙에서 사이드바 접힘과 같은 쪽이다.
// 초안만 기본 접힘이다: 백로그를 상시 노출하지 않는 것이 초안 구역을 만든 이유다.
const WORKS_OPEN_KEY = "sidebar-works-open";
const DRAFTS_OPEN_KEY = "sidebar-drafts-open";

// 사이드바에 상주하는 작업 목록. 어느 화면에 있든 그대로 있고, 항목을 누르면 Works로 간다.
//
// 이건 전역 컨텍스트가 아니라 **전환 수단**이다 — "선택된 작업"이 앱 전체에 걸리는 개념은
// 도입하지 않는다. 다른 화면들은 작업 선택과 무관하게 독립 동작한다.
function SidebarWorkList({
  open,
  boundaryRef,
}: {
  open: boolean;
  // 호버 카드가 비켜야 할 상자 — 사이드바 자신이다. 행의 오른쪽 끝은 거터와 스크롤바 때문에
  // 사이드바 끝보다 8~19px 안쪽이라, 행만 기준으로 삼으면 카드가 사이드바에 붙거나 파고든다.
  boundaryRef: RefObject<HTMLElement | null>;
}) {
  const { data: works = [] } = useWorks();
  const navigate = useNavigate();
  const [worksOpen, setWorksOpen] = useState(
    () => localStorage.getItem(WORKS_OPEN_KEY) !== "0",
  );
  const [draftsOpen, setDraftsOpen] = useState(
    () => localStorage.getItem(DRAFTS_OPEN_KEY) === "1",
  );

  useEffect(() => {
    localStorage.setItem(WORKS_OPEN_KEY, worksOpen ? "1" : "0");
  }, [worksOpen]);
  useEffect(() => {
    localStorage.setItem(DRAFTS_OPEN_KEY, draftsOpen ? "1" : "0");
  }, [draftsOpen]);

  // 어느 항목을 강조할지는 URL이 정한다 — 셸은 그것을 비출 뿐이다 (AppShell의 activeKey와 같은 규칙).
  // 슬러그에 한글이 들어가므로 경로에서 떼어낸 뒤 디코드한다.
  const openSlug = useRouterState({
    select: (state) =>
      state.location.pathname.startsWith("/works/")
        ? decodeURIComponent(state.location.pathname.slice("/works/".length))
        : null,
  });
  const { main, drafts, visible } = splitWorkSections(works, {
    works: worksOpen,
    drafts: draftsOpen,
  });
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

  const goTo = (slug: string) => {
    closeCard();
    void navigate({ to: "/works/$slug", params: { slug } });
  };

  // Cmd+1~9 — **화면에 보이는** 순서 기준 N번째 작업. 접힌 섹션은 세지 않는다.
  // 어느 화면에 있든 이 목록을 센다: 어디에 있든 작업으로 한 번에 돌아갈 수 있다.
  // 입력 중에는 무시.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || !/^[1-9]$/.test(e.key)) return;
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      )
        return;
      const work = visible[Number(e.key) - 1];
      if (!work) return;
      e.preventDefault();
      goTo(work.slug);
      // goTo는 의존성에 넣지 않는다 — navigate 하나만 닫아 잡고 그건 라우터가 고정해준다
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

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
          {/* '작업' 헤더는 목록이 비어도 남는다 — 섹션이 있다는 사실 자체가 정보다 */}
          <SectionHeader
            label="작업"
            className="mt-3"
            open={worksOpen}
            count={main.length}
            onToggle={() => setWorksOpen((v) => !v)}
          />
          <SectionBody open={worksOpen}>
            {main.length === 0 ? (
              <span className="px-[9px] pb-1 text-[12.5px] leading-normal text-tertiary">
                {drafts.length > 0
                  ? "진행 중인 작업이 없어요."
                  : "작업은 Claude Code에서 시작돼요."}
              </span>
            ) : (
              main.map((work) => (
                <WorkRow
                  key={work.slug}
                  work={work}
                  active={work.slug === selectedSlug}
                  onOpen={goTo}
                  onHover={openCardAfterDelay}
                  onLeave={closeCard}
                />
              ))
            )}
          </SectionBody>

          {/* '초안' 헤더는 초안이 있을 때만 — 아무것도 없는 섹션의 헤더는 자리만 먹는다 */}
          {drafts.length > 0 && (
            <>
              <SectionHeader
                label="초안"
                className="mt-3"
                open={draftsOpen}
                count={drafts.length}
                onToggle={() => setDraftsOpen((v) => !v)}
              />
              <SectionBody open={draftsOpen}>
                {drafts.map((work) => (
                  <WorkRow
                    key={work.slug}
                    work={work}
                    active={work.slug === selectedSlug}
                    onOpen={goTo}
                    onHover={openCardAfterDelay}
                    onLeave={closeCard}
                  />
                ))}
              </SectionBody>
            </>
          )}
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
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 text-tertiary transition-[opacity,transform] duration-150",
          open ? "opacity-0 group-hover:opacity-100" : "-rotate-90 opacity-100",
        )}
        strokeWidth={2.2}
      />
      <span className="ml-auto shrink-0 text-[11.5px] tabular-nums text-tertiary">{count}</span>
    </button>
  );
}

// 접기 애니메이션 — grid-template-rows를 0fr↔1fr로 보간한다. height:auto는 트랜지션되지 않고,
// max-height는 목록 길이를 추정해야 해서 항목이 많을수록 타이밍이 어긋난다.
//
// 접힌 동안에도 항목은 DOM에 남는다 — 그래야 펼치는 쪽도 애니메이션된다. 그래서 inert로
// 포커스와 포인터를 막는다: 높이 0에 가려 보이지 않는 버튼에 탭이 들어가면 안 된다.
function SectionBody({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      inert={!open}
      className={cn(
        "grid shrink-0 transition-[grid-template-rows] duration-[180ms] ease-panel",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div className="overflow-hidden">
        <div className="flex flex-col gap-[3px] pt-[3px]">{children}</div>
      </div>
    </div>
  );
}

// 한 줄 — 상태 점 + 제목. 바로 위 nav 항목과 규격을 맞춘다(높이·반지름·간격·글자 크기):
// 둘이 세로로 붙어 있어 규칙이 다르면 그 자리에서 어긋난다.
// 좁은 폭이라 제목이 자주 잘리는데, 전체는 호버 카드가 보여준다 — title 속성을 함께 두면
// OS 툴팁이 카드 위로 겹쳐 뜬다.
function WorkRow({
  work,
  active,
  onOpen,
  onHover,
  onLeave,
}: {
  work: WorkView;
  active: boolean;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(work.slug)}
      onMouseEnter={(e) => onHover(work.slug, e.currentTarget)}
      onMouseLeave={onLeave}
      className={cn(
        "flex h-8 w-full shrink-0 items-center gap-[9px] rounded-[10px] px-[9px] text-left transition-colors",
        active ? "selected-row text-foreground" : "text-muted-foreground hover:bg-state-1",
      )}
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
  );
}

export default SidebarWorkList;
