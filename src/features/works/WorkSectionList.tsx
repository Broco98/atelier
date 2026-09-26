import type { ReactNode } from "react";
import { ChevronDown, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SIGNAL_LABEL,
  SignalLane,
  type CallingNote,
  type ShellSignal,
} from "@/components/shell/shell-signal";
import type { DragPoint } from "@/lib/pointer-drag";
import type { Mode } from "@/mode";
import { emptyMainNotice, listLabelOf } from "./work-sections";
import type { SectionsOpen, WorkSections } from "./work-sections";
import { StatusIcon } from "./status";
import type { WorkView } from "./types";

// 제목이 흐르는 **속도**(결정 11). 거리에 비례한다 — 고정 지속시간은 기각됐다: 넘침 30px은
// 12px/s로 기고 200px은 80px/s로 달려 읽는 속도가 제목마다 갈린다.
const MARQUEE_SPEED = 50; // px/s
// 오른쪽 끝 페이드의 폭. **`index.css`의 `--title-fade`와 같은 수여야 한다** — 흐르는 거리가
// 「넘침 + 이 값」이고(결정 11), 거리는 CSS가 정하는데(결정 10) 그것을 **시간으로 바꾸는**
// 자리가 여기라서 둘이 같은 수를 읽는다. `calc()`가 길이를 시간으로 못 바꾸는 것이 이
// 한 값이 두 언어에 걸치는 이유 전부다(결정 12). 그 「같은 수」는 주석이 아니라
// `SidebarWorkList.test.tsx`의 소스 스캔이 지킨다 — 어긋나도 화면에는 속도 오차로만 나타난다.
const TITLE_FADE = 12; // px

/**
 * 행이 **셸에서 받는 값 넷** — 사이드바(`Sidebar`)가 읽어 목록(`SidebarWorkList`)을 거쳐 여기까지
 * 함께 내려온다. 넷이 늘 같이 다니므로 한 이름으로 묶었다: 따로 나르면 거치는 자리마다 prop 넷을
 * 옮겨 적고, 하나를 빠뜨려도 그 자리의 타입만 보고는 모른다.
 *
 * **넷 다 값을 고르는 자리가 위(`Sidebar`)다.** 목록은 터미널 스토어를 모른다 — 여기서
 * `terminal-store`를 import하면 `@xterm/*`와 그 CSS가 따라 들어와 이 목록의 정적 마크업 검사가
 * 서지 못한다(SidebarWorkList.test.tsx가 그 계약을 센다). 그래서 모양도 이쪽에 적는다.
 */
export interface WorkRowShells {
  /**
   * work별 셸 개수 — **행의 오른쪽 메타가 서는 조건**이다(결정 2·3). 셸이 없는 행에는 그 칸이
   * 없다. 종류·수가 무엇을 적는지는 메타 조각이 정한다: 셸 수와 도는 것을 **둘 다 아는
   * 자리**에서만 「그 밖의 셸」의 수를 낼 수 있어서, 두 값이 `ShellMeta` 하나로 합쳐졌다(결정 3·13).
   */
  shellCounts: Record<string, number>;
  /**
   * work마다의 **화면값**(#203) — 레인이 점·스피너를 세울지 work 상태 아이콘을 세울지, 그리고
   * 행 버튼의 이름에 상태 말이 붙을지를 가른다. 값이 없는 work은 **키 자체가 없다.**
   *
   * **개수와 같은 길로 온다**(위 머리말) — 이 목록은 터미널을 모른다. 슬롯이 아니라 값인 것은
   * 두 자리가 함께 읽기 때문이다: 레인은 마크업 안쪽이고 이름은 버튼의 속성이라, 슬롯 하나로는
   * 둘째 자리에 닿지 않는다. **문자열 Record라 얕은 비교가 그대로 먹는다** — 객체를 담으면
   * 회차마다 새것이라 어느 셸에서 명령이 시작될 때마다 목록 전체가 다시 그려진다
   * (`signalsByOwner` 머리말).
   */
  signals: Record<string, ShellSignal>;
  /**
   * work마다 **부르는 셸이 한 말**(`sidebar-active-band` 결정 14) — 종류와 말이다. 값이 없는 work은
   * 키 자체가 없다(부르지 않거나, 말 없이 불렀다 — S6).
   *
   * **`signals`와 같은 길로 온다 — 슬롯이 아니라 값이다.** 이 값을 읽는 자리가 둘인데 둘 다
   * 행 마크업 **안**이 아니다: 행 버튼의 접근성 설명은 버튼의 **속성**이고, 호버 카드는 목록
   * 밖의 포털에 선다(`SidebarWorkList`). 슬롯 하나로는 그 두 자리에 닿지 않는다. 고르는 자리는
   * 위(`Sidebar`) 하나이고, 그 고름이 레인·메타와 같은 셸을 딛는다 — 여기서 둘로 나눠 줄 뿐이다.
   */
  notes: Record<string, CallingNote>;
  /**
   * 행의 **오른쪽 메타**(`sidebar-active-band` S4·S5). 같은 이유로 슬롯이고, 값을 고르는 자리는
   * 터미널 스토어를 아는 Sidebar다(결정 13) — 이 목록은 터미널을 한 번도 참조하지 않는다.
   *
   * **오는 것이 하나가 아니다**: 그 셸이 부르거나 돌면 **신호의 마크와 경과**(부름은 마크 + 경과,
   * 도는 중은 마크 — `components/shell/shell-signal`의 `SignalMeta`)이고, 조용하면 종류·수
   * (`shell-meta`의 `ShellMeta`)다. 셸이 없는 행에는 칸이 아예 없다 — 슬롯을 불러도 그 행에는
   * 서지 않는다(`WorkRow`). 타입이 `ReactNode`뿐이라 이 문단이 「이 슬롯에 무엇이 오나」를
   * 묻는 유일한 자리다.
   */
  renderRowMeta: (work: WorkView) => ReactNode;
}

// 구획을 그리는 부분. 구독하는 자리(useWorks·라우터·localStorage·끌기 상태)는 `SidebarWorkList`에
// 남기고 여기는 **받은 것만** 그린다. 이 저장소의 컴포넌트 seam은 정적 마크업이라, 구획이 서는 조건
// (결정 82·108)과 핀의 생김새(결정 85)를 그물에 걸려면 훅을 부르지 않는 자리가 있어야
// 한다(SidebarWorkList.test.tsx).
//
// **제 파일로 떨어져 나온 것은 그 「훅을 안 부른다」를 파일 단위로 세기 위해서다**(UI개선 티켓 05).
// 행 끌기가 들어오며 틈·끌리는 행이 상태로 생겼는데, 한 파일에 두면 그 구독이 그림 옆에 붙기
// 쉽고 그것을 컴포넌트 단위로 잘라 세는 파서는 샌다. 행(`WorkRow`)도 여기 산다 — 행 모양을
// 정하는 자리는 하나다.
export function WorkSectionList({
  sections,
  mode,
  open,
  selectedSlug,
  shells,
  onToggleSection,
  onOpen,
  onHover,
  onLeave,
  onTogglePin,
  draggedSlug,
  lineY,
  litEmptySlot,
  onArmDrag,
}: {
  sections: WorkSections;
  /** 목록이 자기를 뭐라고 부르는가가 여기서 갈린다 — 머리 라벨과 빈 몸통의 문구 둘 다. */
  mode: Mode;
  open: SectionsOpen;
  selectedSlug: string | null;
  /** 행이 셸에서 받는 값 넷(`WorkRowShells`). 행마다 제 slug의 것을 꺼내 `WorkRow`에 건넨다. */
  shells: WorkRowShells;
  onToggleSection: (section: keyof SectionsOpen) => void;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  onTogglePin: (work: WorkView) => void;
  /**
   * 지금 끌리고 있는 행(UI개선 스펙 §4). **구독은 위(`SidebarWorkList`)가 하고 여기는 받기만 한다** —
   * 이 파일이 훅을 부르면 정적 마크업 seam이 서지 못한다(그 계약을 소스 검사가 센다).
   */
  draggedSlug: string | null;
  /** 틈 선이 설 **스크롤 내용 좌표** y(`row-drop`의 `gapMark`). 선이 아니면 `null`이다. */
  lineY: number | null;
  /**
   * 틈이 떨어진 **빈 받침**의 구획 — 그 받침이 밝아진다. `lineY`와 함께 켜지지 않는다(둘 다 `gapMark`
   * 하나에서 온다). 받침이 서는지는 여기서 정한다(끄는 중 · 그 구획이 비었다); 이 값은 불만 켠다.
   */
  litEmptySlot: keyof SectionsOpen | null;
  /** 행이 눌렸다 — 끌기를 무장하는 것은 위의 일이다(기하를 재는 자리가 거기다). */
  onArmDrag: (slug: string, from: DragPoint) => void;
}) {
  const { pinned, main } = sections;
  // **받침은 끄는 동안만, 행이 하나도 없는 구획에만 선다**(티켓 06 · 스펙 S7). 끄는 것이 작업 행일 때만이다 —
  // 탭이 사이드바를 스쳐 가도 여기 놓을 수는 없다(`draggedSlug`는 작업 행 끌기에서만 온다).
  const emptySlotFor = (section: keyof SectionsOpen, list: WorkView[]) =>
    draggedSlug !== null && list.length === 0 ? (
      <EmptySlot section={section} lit={litEmptySlot === section} />
    ) : null;
  // 두 구획이 같은 것을 그린다 — 한 벌로 묶어 두지 않으면 행의 모양을 정하는 자리가 둘이 된다.
  const row = (work: WorkView) => (
    <WorkRow
      key={work.slug}
      work={work}
      active={work.slug === selectedSlug}
      dragging={work.slug === draggedSlug}
      shellCount={shells.shellCounts[work.slug] ?? 0}
      signal={shells.signals[work.slug] ?? null}
      note={shells.notes[work.slug] ?? null}
      onOpen={onOpen}
      onHover={onHover}
      onLeave={onLeave}
      onTogglePin={onTogglePin}
      onArmDrag={onArmDrag}
      meta={shells.renderRowMeta(work)}
    />
  );
  return (
    <>
      {/* **틈 선 — 놓일 자리에 가로 선 하나**(UI개선 스펙 §4). 절대 위치라 행을 안 민다: 끄는 동안
          행이 비켜서면 재어 둔 기하가 그 순간 틀어진다. 기준은 스크롤 상자(`relative`)의 내용
          좌표라 목록이 굴러도 선이 행과 함께 간다. 좌우는 행의 둥근 모서리 안쪽에서 멎는다. */}
      {lineY !== null && (
        <div
          data-drop-line=""
          aria-hidden
          className="pointer-events-none absolute inset-x-3 z-10 h-0.5 -translate-y-1/2 rounded-full bg-primary"
          style={{ top: lineY }}
        />
      )}
      {/* '고정' 헤더는 고정된 것이 있을 때만 — 아무것도 없는 구획의 헤더는 자리만 먹는다(결정 82).
          **끄는 동안엔 머리 대신 받침이 선다** — 머리까지 되살리면 끌기가 시작되는 순간 목록이 한 줄 더
          내려앉는다. 받침이 곧 「여기가 `고정`」을 말한다. */}
      {emptySlotFor("pinned", pinned)}
      {pinned.length > 0 && (
        <>
          <SectionHeader
            section="pinned"
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
          **라벨이 세계를 탄다**(US 17): Atelier `작업` · Maison `Rooms`. 형제인 `고정`은
          상태의 이름이라 안 갈린다 — 갈리는 것은 「무엇의 목록인가」 하나뿐이다. */}
      <SectionHeader
        section="works"
        label={listLabelOf(mode)}
        className="mt-3"
        open={open.works}
        count={main.length}
        onToggle={() => onToggleSection("works")}
      />
      <SectionBody open={open.works}>
        {/* 끄는 동안엔 빈 문구 자리에 받침이 선다 — 둘을 함께 세우면 받침이 문구만큼 밀려 내려간다. */}
        {emptySlotFor("works", main) ??
          (main.length === 0 ? (
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
        ))}
      </SectionBody>
    </>
  );
}

/**
 * **빈 받침** — 행이 없는 구획에 끄는 동안만 서는 놓을 자리(UI개선 티켓 06 · 스펙 S7). 첫 고정도 마지막
 * 고정 해제도 행 사이에 놓는 것과 같은 손짓이게 한다.
 *
 * - **표식이 어느 구획인지 말한다**(`data-empty-slot`) — 끄는 동안 기하를 재는 자리가 이것으로 집는다.
 *   탭 끌기의 `slot`(탭 사이 틈)과 다른 것이라 이름을 달리한다.
 * - 밝아짐은 `data-lit`로 싣는다 — 클래스로만 두면 검사가 규격 문자열을 집어야 한다.
 * - 누를 것이 아니다(`pointer-events-none`). 놓기는 창의 떼기가 받고 틈은 좌표로 정한다.
 * - 구획마다 갈리는 것은 아래 표 한 자리다. 빈 `고정`의 받침은 머리 자리에 서므로 머리와 같은 윗 여백
 *   `mt-3`을 받고, `작업`의 받침은 머리 아래 몸통 안이라 몸통의 `gap`이 이미 띄워 여백을 안 받는다.
 */
function EmptySlot({ section, lit }: { section: keyof SectionsOpen; lit: boolean }) {
  const { margin, copy } = EMPTY_SLOT_LOOK[section];
  return (
    <div
      data-empty-slot={section}
      data-lit={lit ? "" : undefined}
      aria-hidden
      className={cn(
        "pointer-events-none flex h-9 shrink-0 items-center justify-center rounded-[10px] border border-dashed text-[12.5px] transition-colors",
        margin,
        lit ? "border-primary bg-primary/10 text-foreground" : "border-border text-tertiary",
      )}
    >
      {copy}
    </div>
  );
}

const EMPTY_SLOT_LOOK: Record<keyof SectionsOpen, { margin: string | null; copy: string }> = {
  pinned: { margin: "mt-3", copy: "여기 놓으면 고정돼요" },
  works: { margin: null, copy: "여기 놓으면 고정이 풀려요" },
};

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
  section,
  label,
  open,
  count,
  onToggle,
  className,
}: {
  /** 어느 구획의 머리인가 — 끄는 동안 기하를 재는 자리가 이것으로 머리를 집는다(`data-drop-head`). */
  section: keyof SectionsOpen;
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
      // 위 표식은 「구획 머리인가」, 이것은 「어느 구획인가」다. 하나로 합치면 위를 `""`로 집는
      // 마크업 검사가 갈린다.
      data-drop-head={section}
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        // **hover 배경이 없다**(UI개선 결정 23). 머리는 목록 사이사이에 서서 마우스가 목록을
        // 훑고 지나갈 때마다 칠해졌다 지워져 사이드바가 들썩였다. 누를 수 있다는 말은 글자가
        // 진해지는 것과 화살표가 뜨는 것(아래 둘)이 계속 한다. 행과 nav는 배경을 **남긴다** —
        // 그쪽은 누르면 가는 목적지라 긴 목록에서 지금 무엇을 가리키는지가 보여야 한다.
        "group flex h-7 w-full shrink-0 items-center gap-1 rounded-[8px] px-[9px] text-left",
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

// **한 줄(32px)이다**(`sidebar-active-band` 결정 14 · 스토리 26 — 판 05의 모양으로 돌아감).
// 레인 · 제목 · 오른쪽 메타만 선다. 두 줄(55px) 열여덟 행은 990px로 한 줄의 1.7배였다 — 둘째
// 줄이 싣던 것 가운데 셸의 마지막 말은 호버 카드의 말 칸과 행 버튼의 설명으로 옮겨 갔고(05),
// 종류·수와 신호의 마크·경과는 오른쪽 메타로 올라왔다. 셸이 없는 행의 프로젝트 이름은 호버
// 카드가 이미 싣는다. **모든 행이 같은 높이라 높이는 아무 말도 안 한다**(판 05 결정 0) — 바로
// 위 nav 항목과 규격(높이·반지름·왼쪽 여백·글자 크기)이 다시 같다.
// 좁은 폭이라 제목이 자주 넘치는데, hover하면 마퀴가 흘려 보여주고 호버 카드가 전체를
// 줄바꿈해 보여준다 — **마퀴가 빠른 답, 카드가 완전한 답**이다(결정 11). title 속성을 함께
// 두면 OS 툴팁이 카드 위로 겹쳐 뜬다. 앱 툴팁도 같은 까닭으로 안 단다 — 350ms 카드와 600ms 툴팁이
// 한 자리에 겹친다(S29 · 스토리 113). 작업 화면 떠 있는 것 spec의 툴팁 절이 그것을 잰다.
//
// 행 전체가 button이던 것이 **바깥 상자 + 형제 버튼 둘**이 됐다. 중첩 button은 HTML에서
// 허용되지 않고, span role="button"으로 흉내 내면 Tab으로 도달할 수 없다 — SpecTree의
// 파일 행이 이미 같은 문제를 그 구조로 풀었다.
// 배경(선택·hover)도 **클릭도** 바깥 상자가 갖는다. 이름 버튼이 행 높이를 다 덮지만(`h-8`),
// 2열의 오른쪽 메타는 그 버튼 **밖의 형제**다 — 클릭이 이름 버튼에만 있으면 마크와 경과가 선
// 자리가 「배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리」가 된다(스토리 34). 그래서 클릭은
// 바깥이 받고, 메타는 늘 포인터를 안 받아 그 자리의 클릭이 행으로 올라간다(메타 주석).
// 오른쪽 끝 `pr-1`은 핀과 메타를 행 가장자리에서 띄우는 값이다 — 메타의 `pr-[5px]`와 합쳐
// **9px**이 되어, 구획 헤더의 개수(`px-[9px]`)와 같은 x에 숫자의 오른쪽 끝이 선다. 한 컬럼에
// 세로로 붙어 서는 숫자들이 다른 무게로 읽히지 않게 하는 그 계약(`SidebarItem` 주석)에 work
// 행이 다시 든다.
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
  onArmDrag,
  dragging,
  shellCount,
  signal,
  note,
  meta,
}: {
  work: WorkView;
  active: boolean;
  /** 이 행이 끌리는 중인가 — 흐려진다. 행 모양이 정해지는 자리가 여기 하나라 이 값도 여기로 온다. */
  dragging: boolean;
  onOpen: (slug: string) => void;
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  onTogglePin: (work: WorkView) => void;
  onArmDrag: (slug: string, from: DragPoint) => void;
  /** 이 work의 셸 수 — **오른쪽 메타가 서는 조건이다**(결정 2·3). 0이면 그 칸이 없다. */
  shellCount: number;
  /**
   * 이 work의 **화면값**(#203). 셸이 여럿이면 그중 최고 하나이고(결정 3), 없으면 `null`이다 —
   * 그때 레인은 work 상태 아이콘으로 되돌아가고 이름에도 아무 말이 안 붙는다.
   */
  signal: ShellSignal | null;
  /**
   * 부르는 셸이 한 말(결정 14) — 이름 버튼의 **접근성 설명**이 된다. 부르는 셸이 말을 했을
   * 때만 오고(S6), 없으면 `null`이라 설명도 없다. 호버 카드의 말 칸이 같은 값을 읽는다.
   */
  note: CallingNote | null;
  /**
   * 셸이 있는 행의 **오른쪽 메타 내용**(S4). 슬롯으로 온다 — 신호가 있으면 부른·도는 셸의
   * 마크와 경과(`SignalMeta`), 없으면 종류·수(`ShellMeta`)다. 가름은 위(`RowMetaFor`)가 한다.
   */
  meta: ReactNode;
}) {
  // 제목 상자 — **hover 진입 때만** 만진다(아래 onMouseEnter). 한때 `useRef`로 쥐었는데, 이 파일이
  // 훅을 안 부르는 자리가 되면서(`SidebarWorkList.test.tsx`의 소스 검사) 이벤트가 온 행 안에서 찾는다.
  // 행마다 제목 상자는 하나이고, 찾는 때도 hover 진입·이탈 두 순간뿐이다.
  const titleBoxOf = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-title]");
  return (
    <div
      // **표식은 끄는 동안 기하를 재는 자리가 이 행을 slug로 집기 위한 것이다**(UI개선 스펙 S6).
      data-work-row={work.slug}
      // **끌기는 여기서 무장만 한다** — 5px을 넘어야 끌기이고, 그 안쪽은 아래 `onClick`의 클릭이다
      // (공용 제스처 `lib/pointer-drag`). 주 버튼만 받는다: 보조 클릭으로 끌리면 메뉴를 열려던 손이
      // 순서를 흔든다.
      onPointerDown={(event) => {
        if (event.button === 0) onArmDrag(work.slug, event);
      }}
      // **누르면 그 work로 간다 — 행 어디를 눌러도 그렇다**(결정 6 · `sidebar-active-band` 스토리
      // 34). 이 자리가 이름 버튼이 아니라 바깥 상자인 것은 이름 버튼이 1열만 덮기 때문이다:
      // 2열의 오른쪽 메타(마크·경과·종류·수)는 그 버튼 밖의 형제라, 클릭이 버튼에만 있으면 사람이
      // 가장 누르기 쉬운 **내용이 있는 자리**가 죽는다. (두 줄 행에서는 둘째 줄 29px이 그
      // 자리였다 — 이 갈래가 그때 정해졌다.)
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
        const box = titleBoxOf(e.currentTarget);
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
      onMouseLeave={(e) => {
        // 제자리로 돌아온다 — 복귀 시간(180ms)은 표식이 없는 평상시 규칙이 든다(결정 11).
        titleBoxOf(e.currentTarget)?.removeAttribute("data-marquee");
        onLeave();
      }}
      className={cn(
        // **flex가 아니라 grid다**(판 05 결정 1). 오른쪽 메타와 핀이 **2열 같은 칸에 겹쳐** 서고
        // 칸 폭이 `max(메타, 핀)`이 된다 — flex로는 두 형제를 같은 자리에 포개면서 폭만 큰 쪽을
        // 따르게 할 수 없다. 한 트랙(`items-center`)이라 이름 버튼(32px)이 행 높이를 정하고,
        // 핀(24px)과 메타는 그 가운데에 선다 — 두 줄 행이 핀에 얹었던 눈높이 보정이 필요 없다.
        //
        // **첫 줄을 상자로 한 겹 싸지 않는다.** 싸면 **이름 버튼의 부모**가 그 상자가 되어, 그것으로
        // 배경 상자를 집는 자리가 조용히 어긋난다 — e2e가 이름 버튼의 `parentElement`로 호버 카드
        // 자리를 잰다. (한때 이 주석이 「핀의 `parentElement`」라고 적어 뒀는데 그런 자리는 없다.
        // 그 한 줄이 스펙까지 물려가 안 하나를 잘못 기각했다 — 판 05 결정 1이 그 내력을 든다.)
        //
        // **2열은 아무것도 예약하지 않는다 — 그냥 `auto`다**(S34). 판 05의 결정 2·5는 여기에 한
        // 무리분(28px)을 **바닥으로** 깔라고 했고, 그것이 실물 앱을 보고 **기각됐다**:
        // 「아이콘을 고려해서 미리 빼놨다는건 말이 안됨. 아이콘 생기면 그때 가변되는게 맞아.」
        // 자리는 선 것이 **실제로 있을 때** 난다. 그 「선 것」에 **핀도 든다** — 핀은 hover·포커스에만
        // 폭을 가지므로 메타가 없는 행은 칸도 그때만 24px이 된다(핀 주석).
        //
        // **그래서 제목이 끊기는 자리는 셋일 때 움직인다**(사람이 고른 원칙의 대가, 판 2 실물 확인):
        //   - 메타가 없는 행(셸 없음)을 hover할 때 — 빈 칸에 핀 24px이 선다.
        //   - 경과의 자릿수가 바뀔 때(`9m`→`10m`, `59m`→`1h`).
        //   - 행이 조용함(종류·수)과 부름(마크·경과) 사이를 오갈 때.
        // 메타가 선 행은 hover에 안 움직인다 — 메타가 투명해질 뿐 칸을 쥐고 있고(메타 주석), 그
        // 칸이 핀보다 넓다.
        //
        // 핀을 격자 밖(`absolute right-1`)에 세우는 안은 그대로 기각이다 — 칸이 핀을
        // 모르므로 핀이 **제목 글자 위에 얹힌다**(실물에서 그 겹침을 보고 되돌렸다).
        // 사람이 고른 것이 그 갈림이다: 「호버하면, 자동으로 아이콘 위치만큼 text의 최대
        // 크기가 조정되지? 이런걸 원하는거임. (안겹치게)」
        "group grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center rounded-[10px] pr-1 transition-colors",
        // **채움은 없다.** 평평한 행이고, 회색이 서는 것은 고른 행 하나뿐이다 — 카드 채움(목업의
        // F·G)은 열여덟 행에 전부 무게를 줘 목록이 게시판이 된다.
        active ? "selected-row" : "text-muted-foreground hover:bg-state-1",
        // **끌리는 행은 흐려진다**(UI개선 스펙 §4) — 자리는 그대로 두고. 행을 빼면 아래 행들이 올라와
        // 재어 둔 기하가 그 순간 틀어지고, 「어디서 뽑았는지」도 사라진다.
        dragging && "opacity-40",
      )}
    >
      <button
        type="button"
        // **화면값이 있으면 이름에 그 말이 붙는다**(스토리 33 · 결정 8). 레인의 점·스피너는
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
        // **행의 높이를 이 버튼이 든다**(`h-8`) — 바깥이 grid라 `h-full`은 자기가 잰 높이를 되받는
        // 순환이 된다. nav 항목과 같은 32px이고, 셸이 몇 개든 무엇이 돌든 모든 work 행이 이
        // 높이다 — 겹쳐 선 메타·핀은 둘 다 이보다 낮다. 제목 폭을 푸는 자리도 이 상자이고
        // (`data-title`이 그 안에서 `flex-1`이다) 포커스 링이 그려지는 자리도 여기다.
        //
        // **오른쪽 여백은 없다.** 판 05는 여기 `pr-1.5`(6px)를 물어 제목과 2열을 띄웠는데, 그러면
        // 메타가 없는 행에서 제목 상자가 핀 앞 6px에서 멎어 그만큼 좁아진다. 띄우는 값은 이제
        // **메타 칸이 든다**(`pl-(--glyph-gap)`) — 메타가 있을 때만 난다(S34의 원칙). 제목 상자가
        // 핀 바로 앞에서 끝나는 것을 L3가 잰다.
        className="col-start-1 row-start-1 flex h-8 min-w-0 items-center gap-(--glyph-gap) pl-[9px] text-left"
        // **셸의 마지막 말은 설명으로 붙는다**(결정 14 · 스토리 38). 호버 카드는 키보드로 닿지
        // 않으므로, 포커스한 사람이 「왜 부르나」를 듣는 자리가 여기다 — 이름(`제목 — 상태`)
        // 다음에 읽힌다. 이름을 늘리지 않는 것은 그 이름이 행·띠·탭이 함께 쓰는 짧은 말이라서다.
        //
        // **`aria-describedby`를 달지 않는다.** 달면 이 속성이 무시된다. 라이브 영역도 아니라서
        // 말이 바뀌어도 알리지 않는다 — 설명만 새 말로 바뀐다.
        //
        // **`className` 뒤에 적는다.** 행 이름을 모으는 마크업 검사가 여는 태그를 `aria-label`
        // 바로 뒤에 `class`가 오는 모양으로 읽는다(`SidebarWorkList.test.tsx`의 `namesOf`).
        aria-description={note?.message}
      >
        {/* **레인** — 행 왼쪽의 14px 한 칸(두 줄 행을 연 판의 결정 5). 화면값이 있으면 점·스피너가,
            없으면 work 상태 아이콘이 선다(#203). 표식(`data-lane`)은 검사 셋이 이 칸을 집는
            이름이다(마크업 seam · hover · 폭 드래그).
            **폭을 안 내준다.** 실제로 그것을 지키는 것은 옆 제목 상자다 — `[data-title]`이
            `min-width: 0`이라 좁아지는 값을 전부 흡수하므로 이 줄이 넘칠 일이 없고, 그래서
            `shrink-0`을 지워도 지금은 화면이 안 바뀐다(L3 실측). 그래도 적는 것은 제목 쪽
            규칙이 바뀌는 날 **이 자리가 먼저 찌그러지는 것**이 가장 나쁜 회귀라서다:
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
          켜짐은 aria-pressed가 말한다(WorkPanel의 `</>` 토글과 같은 규칙). title도 앱 툴팁도
          두지 않는다 — 행에 머물면 호버 카드가 떠서 툴팁이 그 위로 겹친다(S29).

          **오른쪽 메타와 같은 2열 1행에 겹쳐 선다**(판 05 결정 1). 그래서 칸 폭이
          `max(메타, 핀)`이고, **핀이 폭을 가질 때만** 그 24px이 칸에 더해진다 — 메타가 선 행은
          칸이 이미 핀보다 넓어 안 움직이고, 메타가 없는 행만 hover에 제목이 24px 줄어든다.

          **쉴 때 폭을 걷는 것이 `max-w-0`이다** — `width`가 아니라 `max-width`인 것은
          `icon-button`이 `width: 24px`을 들기 때문이다. 둘 다 유틸리티 레이어라 `w-0`으로
          덮으려 들면 승자가 Tailwind의 정렬 순서에 걸리는데, `max-width`는 다른 속성이라
          그 싸움 밖에 선다. 격자 트랙은 아이템의 max-content 기여를 `max-width`로 clamp하므로
          쉴 때 기여가 **0**이다.

          **`display:none`은 안 된다 — 포커스가 안 들어간다.** 이 핀은 hover뿐 아니라
          **포커스에도** 떠야 하는데(판 05 결정 7) `display:none`인 요소는 `.focus()`를 받지 못해,
          e2e가 `pin.focus()`로 세는 그 계약이 통째로 무너진다. `max-w-0`은 상자를 지우지
          않으므로 포커스가 그대로 들어가고 `focus-visible:max-w-6`이 폭을 되돌린다.
          `overflow-hidden`은 그 0폭 상자 밖으로 글리프가 삐져나오지 않게 하는 것이다.

          **트랜지션을 안 건다.** `icon-button-tint`가 `transition-property: color`뿐이라
          폭은 즉시 바뀌는데, 그게 맞다 — 행의 `onMouseEnter`가 hover 스타일이 **이미 적용된
          뒤에** `clientWidth`를 읽어 마퀴 거리를 잰다. 폭에 트랜지션이 걸리면 그 순간의
          중간값이 잡혀 마퀴가 끝까지 못 흐른다.

          **`justify-self-end`가 자리를 붙든다.** 칸이 핀보다 넓을 때(메타가 선 행) 격자
          기본값 stretch면 핀 상자가 칸만큼 늘어나 글리프가 가운데로 밀린다. 끝에 붙이면
          메타가 있든 없든 **메타 자리의 끝 한 자리**다(스토리 32).

          `peer`는 **뒤에 선 메타가 이 버튼의 포커스를 보기 위한 것이다**(판 05 결정 7): 이 핀은
          hover뿐 아니라 포커스에도 뜨므로, 메타를 `group-hover`로만 물리면 키보드로 닿았을 때
          둘이 겹쳐 그려진다. 후행 형제에만 걸리는 선택자인데 DOM 순서가
          `이름 버튼 → 핀 → 메타`라 그대로 먹는다. */}
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
        className="peer icon-button-tint col-start-2 row-start-1 max-w-0 justify-self-end overflow-hidden text-tertiary opacity-0 outline-none focus-visible:max-w-6 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:max-w-6 group-hover:opacity-100"
      >
        <Pin
          className="size-3"
          strokeWidth={1.8}
          fill={work.pinned ? "currentColor" : "none"}
        />
      </button>
      {/* **오른쪽 메타 — 셸이 하나라도 있으면 선다**(결정 3 · S4). 셸이 0개인 행에는 이 칸이
          아예 없다: 「없음」은 숫자로 말하지 않고, 프로젝트 이름은 호버 카드가 싣는다. 안에 서는
          것은 슬롯이 정한다 — 부르면 부른 셸의 마크 + 경과, 돌면 도는 셸의 마크, 조용하면
          종류·수다(`RowMetaFor`). 「명령이 도는 동안만 선다」는 그때도 지금도 **기각이다**: 그
          값은 매 순간 바뀌어서 자리에 매면 claude가 답을 마칠 때마다 이 칸이 생겼다 사라진다.
          자리가 서는 조건은 **안 변하는 값**(셸을 포함하는가)이고, 변하는 것은 그 **안에서**만
          변한다.

          **핀과 같은 2열 1행에 겹쳐 서고, 칸 끝에 붙는다**(판 05 결정 1). 칸 폭은 `max(메타, 핀)`
          이다. **왼쪽 `pl-(--glyph-gap)`이 제목과 메타를 떼는 값이다** — 캔버스 보드 B의 행
          간격(9px)이고, 메타가 있을 때만 난다(S34: 바닥을 두지 않는다).

          hover하면 메타가 **투명해진다**(판 05 결정 6). `hidden`이 아니다 — `display:none`은 칸
          폭 계산에서 빠져 2열이 핀의 24px로 **줄고** 제목이 hover마다 튄다. `visibility:hidden`도
          아니다: 셸 수가 마우스 위치에 따라 있다 없다 하는 정보가 되면 안 된다. 트랜지션은
          안 건다 — 옆 행으로 옮겨 갈 때 두 페이드가 겹쳐 미끄러져 보인다(icon-button-tint가
          opacity를 뺀 것과 같은 이유). **잃는 것은 커서가 이미 가 있는 행 하나의 메타다** —
          「훑어서 찾고 → 가리켜서 누른다」에서 가리키는 순간은 이미 고른 뒤다.
          **`peer-focus-visible`이 함께 가는 이유는 핀이 포커스에도 뜨기 때문이다**(판 05 결정 7).
          `group-focus-within`은 틀린 답이다 — 이름 버튼에 포커스가 가도 메타가 물러나는데
          그때는 핀이 안 떠서 그 자리가 통째로 빈다.

          **표시 전용이다.** 무리 하나가 셸 여럿을 접으므로 무리와 셸이 1:1이 아니고, 누르면
          어느 셸로 갈지 정해지지 않는다. 그래서 `pointer-events-none`이 **상시다**(판 05 결정
          6의 정정) — 누를 것이 없을 뿐 아니라, 같은 칸에 겹쳐 서고 DOM에서 핀보다 **뒤**라
          이것이 위에 그려진다: 그대로 두면 핀의 클릭을 가로챈다. 그리고 그 자리의 클릭은 행
          상자가 받는다 — 마크나 경과를 눌러도 그 work로 간다(행 상자 주석).

          **표식이 둘이다.** `data-row-meta`는 **자리**의 이름이다 — 이 저장소의 규칙은 「표식은
          그 자리에 있는 것의 이름」인데(`data-shells`·`data-branch`·`data-section`), 이 칸은
          **싣는 것이 갈려서** 있는 것으로 이름을 붙이면 갈래 대부분에게 그 이름이 거짓이 된다
          (두 줄 행의 `data-subrow`가 같은 이유로 자리 이름이었다). `data-shells`는 그 규칙
          그대로 **종류·수일 때만** 붙는다: 신호의 마크·경과가 서 있는데 그 표식이 남으면 「이
          표식 안은 무리 나열이고 숫자의 합 = 셸 수」라는 불변조건이 DOM에서 조용히 거짓이
          된다. 가름을 여기서 다시 묻지 않고 행이 이미 쥔 `signal`로 하는 것이 요점이다: 레인이
          점을 세우는 근거와 **같은 값**이라 둘이 어긋날 수 없다. */}
      {shellCount > 0 && (
        <div
          data-row-meta={work.slug}
          data-shells={signal === null ? work.slug : undefined}
          className="pointer-events-none col-start-2 row-start-1 flex items-center justify-self-end pl-(--glyph-gap) group-hover:opacity-0 peer-focus-visible:opacity-0"
        >
          {meta}
        </div>
      )}
    </div>
  );
}
