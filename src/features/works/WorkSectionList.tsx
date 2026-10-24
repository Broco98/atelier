import { Fragment, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SIGNAL_LABEL,
  SignalLane,
  type CallingNote,
  type ShellSignal,
} from "@/components/shell/shell-signal";
import { openMenuByKey } from "@/components/ui/context-menu";
import { InlineRename } from "@/components/ui/inline-rename";
import { pressed } from "@/lib/hotkeys";
import type { DragPoint } from "@/lib/pointer-drag";
import { emptyMainNotice, sectionKey, WORKS_COPY } from "./work-sections";
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
// 줄 목록 — 줄 30 · 줄 사이 1이다(Codex 사이드바, v1 티켓 46). 구획의 줄들과 Work 아래 펼친 Thread 줄들이 한 벌이다.
const ROWS = "flex flex-col gap-px";

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
   * 없다. 조용한 행이 그 수를 어떻게 적는지는 메타 조각이 정한다(`ShellMeta` — `⌨ N`, ui-refresh 결정 13) —
   * 이 목록이 수를 다시 적으면 같은 셸을 두 번 센다.
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
   * **오는 것이 하나가 아니다**: 그 셸이 부르면 **경과**, 돌면 **아무것도**(`components/shell/shell-signal`의
   * `SignalMeta`)이고, 조용하면 셸 수(`shell-meta`의 `ShellMeta`)다. 에이전트 마크는 없다(ui-refresh
   * 결정 13). 셸이 없는 행에는 칸이 아예 없다 — 슬롯을 불러도 그 행에는
   * 서지 않는다(`WorkRow`). 타입이 `ReactNode`뿐이라 이 문단이 「이 슬롯에 무엇이 오나」를
   * 묻는 유일한 자리다.
   */
  renderRowMeta: (work: WorkView) => ReactNode;
}

/**
 * 행이 **그 Work의 Thread에서 받는 값**(v1 티켓 37 · 구현 스펙 §13) — 위(`SidebarWorkList`)가 목록 요약과 펼침 기억을 읽어 내린다. 이
 * 파일은 훅을 안 부르므로 Thread 줄은 슬롯으로 온다(`renderThreads` — 줄마다 그 Thread의 기록을 읽는 구독이 그 안에 산다).
 */
export interface WorkRowThreads {
  /** Work마다 이은 Thread 수(`threadCounts`) — 이은 것이 없는 Work는 키가 없고, 그 행에는 수도 펼침 단추도 서지 않는다. */
  counts: Record<string, number>;
  /** 펼친 Work의 slug. Thread가 없는 Work는 적혀 있어도 펴지 않는다 — 펼 것이 없다. */
  expanded: readonly string[];
  /** 펼침 단추(▸) · 이름 버튼의 → ←가 그 Work의 펼침을 뒤집는다. */
  onToggle: (slug: string) => void;
  /** 펼친 Work 아래에 설 Thread 줄들. */
  renderThreads: (work: WorkView) => ReactNode;
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
  open,
  selectedSlug,
  stop,
  shells,
  threads,
  onToggleSection,
  onOpen,
  onHover,
  onLeave,
  onTogglePin,
  draggedSlug,
  lineY,
  litEmptySlot,
  onArmDrag,
  menuTarget,
  renaming,
  onRename,
  onRenameCommit,
  onRenameEnd,
}: {
  sections: WorkSections;
  open: SectionsOpen;
  selectedSlug: string | null;
  /**
   * 목록의 Tab 정류장 — 그 키(행의 slug · 구획 머리의 `sectionKey`)를 단 자리만 `tabIndex={0}`이고 나머지는 `-1`이다(roving,
   * codex-ds 스펙 S10). 무엇이 정류장인지는 위(`SidebarWorkList`의 `useRoving`)가 정한다 — 이 파일은 훅을 안 부른다.
   */
  stop: string | null;
  /** 행이 셸에서 받는 값 넷(`WorkRowShells`). 행마다 제 slug의 것을 꺼내 `WorkRow`에 건넨다. */
  shells: WorkRowShells;
  /** 행이 그 Work의 Thread에서 받는 값(`WorkRowThreads`, v1 티켓 37). */
  threads: WorkRowThreads;
  onToggleSection: (section: keyof SectionsOpen) => void;
  /** 행을 눌렀다 — 그 work로 간다. `pointer`는 포인터로 눌렀는가다(`WorkRow`의 같은 이름). */
  onOpen: (slug: string, pointer: boolean) => void;
  /** 포인터가 행에 들었거나 그 위에서 움직였다 — 카드는 멈춤을 잰다(`SidebarWorkList`의 `aimCard`). */
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  /** 핀을 눌렀다. `pointer`는 `onOpen`의 것과 같다. */
  onTogglePin: (work: WorkView, pointer: boolean) => void;
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
  /**
   * 우클릭 메뉴가 열린 행(codex-ds 결정 11) — 그 행의 이름 버튼에 대상 테두리가 선다. 닫혔으면 `null`이다. **메뉴 상태는 위
   * (`SidebarWorkList`의 `WorkContextMenu`)가 쥐고 여기는 받기만 한다** — 끌리는 행과 같은 규칙이다.
   */
  menuTarget: string | null;
  /**
   * 이름을 그 자리에서 고치는 행(codex-ds 스펙 §9) — 그 행의 이름 자리가 입력칸이 된다. 아무 행도 아니면 `null`이다. **고치는 상태도
   * 위가 쥐고 여기는 받기만 한다**(스펙 §9 — 행은 상태를 갖는 훅을 둘 수 없다). 들어가는 길은 이름 버튼의 F2(`onRename`)와 우클릭
   * 메뉴 · 알림 띠 메뉴의 「이름 바꾸기」(위의 `WorkContextMenu`)다. 두 번 클릭은 들어가는 길이 아니다 — 행의 두 번 클릭은 열기다.
   */
  renaming: string | null;
  /** 이름 버튼에서 F2 — 그 행의 이름 고치기를 켜 달라고 한다. */
  onRename: (slug: string) => void;
  /** 바뀐 이름으로 저장한다(그대로이거나 비운 이름은 안 온다 — `InlineRename`). */
  onRenameCommit: (slug: string, title: string) => void;
  /** 고치기가 끝났다(저장이든 취소든). */
  onRenameEnd: () => void;
}) {
  const { pinned, main } = sections;
  // **받침은 끄는 동안만, 행이 하나도 없는 구획에만 선다**(티켓 06 · 스펙 S7). 끄는 것이 작업 행일 때만이다 —
  // 탭이 사이드바를 스쳐 가도 여기 놓을 수는 없다(`draggedSlug`는 작업 행 끌기에서만 온다).
  const emptySlotFor = (section: keyof SectionsOpen, list: WorkView[]) =>
    draggedSlug !== null && list.length === 0 ? (
      <EmptySlot section={section} lit={litEmptySlot === section} />
    ) : null;
  // 두 구획이 같은 것을 그린다 — 한 벌로 묶어 두지 않으면 행의 모양을 정하는 자리가 둘이 된다.
  //
  // **펼친 Work 아래에 그 Work의 Thread 줄이 선다**(v1 티켓 37 · 캔버스 「Thread 목록과 아바타」 보드 `.nest`) — 행 상자 밖, 바로 뒤의 형제다.
  // 행 상자 안에 두면 행의 누름(그 Work로 가기) · 끌기 · 호버 카드 · 우클릭 대상이 Thread 줄까지 덮는다. 들여쓰기는 상자가 아니라 줄의 속이
  // 든다 — 고른 줄의 면은 목록 폭 그대로이고 얼굴이 Work 제목과 한 세로줄에 선다(Codex 프로젝트 아래 줄 — v1 티켓 46, `ThreadRow`의 `compact`).
  // 접힌 Work의 줄은 그리지 않는다 — 구획 접기와 달리 움직임이 없어(보드) DOM에 남겨 둘 까닭이 없다.
  const row = (work: WorkView) => {
    const threadCount = threads.counts[work.slug] ?? 0;
    const expanded = threadCount > 0 && threads.expanded.includes(work.slug);
    return (
      <Fragment key={work.slug}>
        {workRow(work, threadCount, expanded)}
        {expanded && (
          <div data-work-threads={work.slug} className={ROWS}>
            {threads.renderThreads(work)}
          </div>
        )}
      </Fragment>
    );
  };
  const workRow = (work: WorkView, threadCount: number, expanded: boolean) => (
    <WorkRow
      work={work}
      active={work.slug === selectedSlug}
      stop={work.slug === stop}
      dragging={work.slug === draggedSlug}
      menuTarget={work.slug === menuTarget}
      editing={work.slug === renaming}
      onRename={onRename}
      onRenameCommit={onRenameCommit}
      onRenameEnd={onRenameEnd}
      shellCount={shells.shellCounts[work.slug] ?? 0}
      signal={shells.signals[work.slug] ?? null}
      note={shells.notes[work.slug] ?? null}
      onOpen={onOpen}
      onHover={onHover}
      onLeave={onLeave}
      onTogglePin={onTogglePin}
      onArmDrag={onArmDrag}
      meta={shells.renderRowMeta(work)}
      threadCount={threadCount}
      expanded={expanded}
      onToggleThreads={threads.onToggle}
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
          className="pointer-events-none absolute inset-x-3 z-10 h-0.5 -translate-y-1/2 rounded-full bg-accent"
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
            stop={stop === sectionKey("pinned")}
            count={pinned.length}
            onToggle={() => onToggleSection("pinned")}
          />
          <SectionBody open={open.pinned}>{pinned.map(row)}</SectionBody>
        </>
      )}

      {/* 상주 목록의 헤더는 목록이 비어도 남는다 — 섹션이 있다는 사실 자체가 정보다.
          라벨은 어휘 표가 든다(US 17). 형제인 `고정`은 상태의 이름이다. */}
      <SectionHeader
        section="works"
        label={WORKS_COPY.label}
        className={pinned.length > 0 ? "mt-5.75" : "mt-3"}
        open={open.works}
        stop={stop === sectionKey("works")}
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
          // 그때는 대개 목록이 안 넘친다 — 목록이 오기 전 한 프레임에 이 문구가 서는 창이 그 드문 때다.
          <span className="mr-1 px-2 pb-1 text-chat-meta text-fg-tertiary">
            {emptyMainNotice(sections)}
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
 * - 구획마다 갈리는 것은 아래 표 한 자리다. 빈 `고정`의 받침은 머리 자리에 서므로 첫 머리와 같은 윗 여백
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
        "pointer-events-none flex h-9 shrink-0 items-center justify-center rounded-lg border border-dashed text-chat-meta transition-colors",
        margin,
        lit ? "border-accent bg-accent-soft text-fg" : "border-border text-fg-tertiary",
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
          줄 사이 1(`gap-px`)을 준다 — 머리 아래의 몫은 머리가 든다(`SectionHeader`의 `mb-0.75`). 여기서 한 번 더 물면 그 자리만
          값이 갈린다. 접힐 때 함께 사라지는 자리라 오래 안 보였다.

          **펼친 동안 링이 설 자리를 둔다**(`focus-ring-room`, codex-ds 결정 11). 접기의 `overflow-hidden`은 행의 포커스
          링(테두리 바깥 4px)도 자른다 — 행이 이 상자 끝에 붙어 서서 첫 행의 위와 모든 행의 왼쪽 · 오른쪽 링이 사라졌다. 상자가
          안쪽에 4px을 두고 같은 만큼 바깥으로 물러나 행의 자리는 그대로다. 물러난 테두리는 위 구획 머리 아래 끝(줄 사이 2px 너머)을
          덮으므로 그 자리는 누르는 자리가 아니다(`pointer-events-none`) — 머리의 아래 끝을 눌러도 머리가 받는다. 행은 다시 받는다.
          **접히면 그 자리를 걷는다.** 이 상자는 접힌 뒤에도 DOM에 남는데(위 `inert`), 자리를 둔 채면 트랙이 0이어도 상자가
          안쪽 8px로 남아 첫 행의 위 4px이 머리 아래에 비친다. 접힌 상자는 포커스를 못 받으니 링이 설 일도 없다 — 걷어도 행의
          자리는 그대로라(안쪽과 바깥이 같은 만큼이다) 접고 펼 때 행이 움직이지 않는다. */}
      <div className={cn("pointer-events-none overflow-hidden", open && "focus-ring-room")}>
        <div className={cn("pointer-events-auto", ROWS)}>{children}</div>
      </div>
    </div>
  );
}

// 섹션 헤더 — **헤더 전체가 접기 토글이다.** 라벨을 누르면 그 섹션이 접힌다.
//
// **라벨은 Codex 사이드바의 소제목이다**(v1 티켓 46 — 「프로젝트」 · 「최근」을 재었다): 줄 글자와 같은 14/20 400에 색만 `fg-tertiary`다. 한때
// 한 단 작은 `text-chat-meta`(13/18)였다. 바탕 위 옅은 것은 알고 둔 값이다(handoff 「대비 미달을 알고 둔 값」) — 머리는 목적지가 아니라
// 목록의 이름표라서다.
//
// **세로는 Codex의 사이다.** 머리는 높이 30(`h-7.5`)에 라벨을 가운데 세우고, 아래 3(`mb-0.75`)과 줄 사이 1을 둬 라벨 가운데에서 첫 줄
// 가운데까지 34다. 위는 부르는 쪽이 준다 — 첫 구획은 nav 뒤 12(`mt-3` — nav 끝 줄 가운데에서 라벨 가운데까지 42), 다음 구획은 앞 구획의
// 끝 줄 뒤 23(`mt-5.75`)에 줄 사이 1을 더해 24다(끝 줄 가운데에서 라벨 가운데까지 54). 셋 다 Codex 그림에서 잰 값이다.
//
// 접기 아이콘은 평소 숨어 있다가 헤더에 마우스를 올리면 나타난다 — 좁은 사이드바에서
// 섹션마다 상시 노출된 아이콘은 정작 봐야 할 목록보다 먼저 눈에 들어온다. 다만 **접혀 있으면
// 계속 보인다**: 그것이 "비어 있는 게 아니라 접힌 것"을 알리는 유일한 표시다.
//
// **개수는 눈에서 걷었다**(v1 티켓 46 — Codex의 소제목에는 수가 없다). 이름에는 남는다(`sr-only`) — 머리의 접근성 이름(「고정 3」 ·
// 「Work 7」)이 그대로다. 행의 수는 행을 세면 보이고, 「몇 개가 접혀 있나」는 접힌 머리를 펴면 보인다.
function SectionHeader({
  section,
  label,
  open,
  stop,
  count,
  onToggle,
  className,
}: {
  /** 어느 구획의 머리인가 — 끄는 동안 기하를 재는 자리가 이것으로 머리를 집는다(`data-drop-head`). */
  section: keyof SectionsOpen;
  label: string;
  open: boolean;
  /** 목록의 Tab 정류장인가 — 머리도 행처럼 ↑↓로 지나는 자리다(Enter가 접는다). */
  stop: boolean;
  count: number;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      // 표식은 검사가 이 버튼을 **정체성으로** 집기 위한 것이다. 판 04가 이 서브트리 안에
      // `aria-expanded`를 가진 가지 머리를 넣으면서, 「접히는 버튼」이라는 자리만으로는
      // 구획 헤더를 집을 수 없게 됐다 (TerminalPane의 `data-shell-host`와 같은 이유).
      data-section=""
      // 위 표식은 「구획 머리인가」, 이것은 「어느 구획인가」다. 하나로 합치면 위를 `""`로 집는
      // 마크업 검사가 갈린다.
      data-drop-head={section}
      tabIndex={stop ? 0 : -1}
      data-roving={sectionKey(section)}
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        // **hover 배경이 없다**(UI개선 결정 23). 머리는 목록 사이사이에 서서 마우스가 목록을
        // 훑고 지나갈 때마다 칠해졌다 지워져 사이드바가 들썩였다. 누를 수 있다는 말은 글자가
        // 진해지는 것과 화살표가 뜨는 것(아래 둘)이 계속 한다. 행과 nav는 배경을 **남긴다** —
        // 그쪽은 누르면 가는 목적지라 긴 목록에서 지금 무엇을 가리키는지가 보여야 한다.
        "group mb-0.75 flex h-7.5 w-full shrink-0 items-center gap-1 rounded-lg px-2 text-left focus-ring",
        className,
      )}
    >
      <span className="shrink-0 text-sm text-fg-tertiary transition-colors group-hover:text-fg-secondary">{label}</span>
      {/* 목록이 접히는 것과 **같은 시간·같은 곡선**으로 돈다 — 한 동작으로 읽혀야 한다.
          트랜지션 목록에 transform이 아니라 rotate를 적는다: Tailwind v4의 rotate-*는
          독립 rotate 속성을 쓰고, transform만 걸면 화살표만 뚝 끊긴다. */}
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 text-fg-tertiary transition-[opacity,rotate] duration-[180ms] ease-panel",
          open ? "opacity-0 group-hover:opacity-100" : "-rotate-90 opacity-100",
        )}
      />
      {/* 수는 이름에만 든다(위 머리말) — 「고정 3」. 앞 빈칸은 이름의 띄어쓰기다(플렉스 안의 빈칸 글은 그려지지 않는다). */}{" "}
      <span className="sr-only">{count}</span>
    </button>
  );
}

// **한 줄(30px — `size-row-nav`, v1 티켓 46이 Codex 사이드바를 재어 32에서 내렸다)이다**(`sidebar-active-band` 결정 14 · 스토리 26 — 판 05의 모양으로 돌아감).
// 레인 · 제목 · 오른쪽 메타만 선다. 두 줄(55px) 열여덟 행은 990px로 한 줄의 1.7배였다 — 둘째
// 줄이 싣던 것 가운데 셸의 마지막 말은 호버 카드의 말 칸과 행 버튼의 설명으로 옮겨 갔고(05),
// 종류·수와 신호의 마크·경과는 오른쪽 메타로 올라왔다(마크는 그 뒤 ui-refresh 결정 13으로 빠졌다). 셸이 없는 행의 프로젝트 이름은 호버
// 카드가 이미 싣는다. **모든 행이 같은 높이라 높이는 아무 말도 안 한다**(판 05 결정 0) — 바로
// 위 nav 항목과 규격(높이·반지름·왼쪽 여백·글자 크기)이 다시 같다.
// 좁은 폭이라 제목이 자주 넘치는데, hover하면 마퀴가 흘려 보여주고 호버 카드가 전체를
// 줄바꿈해 보여준다 — 마퀴는 제목 자리에서 일부를 흘려 보이고 **카드가 완전한 답**이다(결정 11). title 속성을 함께
// 두면 OS 툴팁이 카드 위로 겹쳐 뜬다. 앱 툴팁도 같은 까닭으로 안 단다 — 카드와 툴팁은 같은 길이
// (`duration-tip`)에 서는 한 무리라(codex-ds 결정 20) 둘이 한 자리에 함께 선다(S29 · 스토리 113).
// 작업 화면 떠 있는 것 spec의 툴팁 절이 그것을 잰다.
//
// 행 전체가 button이던 것이 **바깥 상자 + 형제 버튼 둘**이 됐다. 중첩 button은 HTML에서
// 허용되지 않고, span role="button"으로 흉내 내면 Tab으로 도달할 수 없다 — SpecTree의
// 파일 행이 이미 같은 문제를 그 구조로 풀었다.
// 배경(선택·hover)도 **클릭도** 바깥 상자가 갖는다. 이름 버튼이 행 높이를 다 덮지만(`size-row-nav`),
// 끝 칸의 오른쪽 메타는 그 버튼 **밖의 형제**다 — 클릭이 이름 버튼에만 있으면 셸 수와 경과가 선
// 자리가 「배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리」가 된다(스토리 34). 그래서 클릭은
// 바깥이 받고, 메타는 늘 포인터를 안 받아 그 자리의 클릭이 행으로 올라간다(메타 주석).
// 오른쪽 끝 `pr-1`은 핀과 메타를 행 가장자리에서 띄우는 값이다 — 메타의 `pr-1`과 합쳐
// **8px**(행 안쪽 — DS `.at-row`)이 되어, 구획 헤더의 개수(`px-2`)와 같은 x에 숫자의 오른쪽 끝이 선다. 한 컬럼에
// 세로로 붙어 서는 숫자들이 다른 무게로 읽히지 않게 하는 그 계약(`SidebarItem` 주석)에 work
// 행이 다시 든다.
//
// hover(카드 여는 것)는 바깥 상자가 듣는다 — 이름 버튼에 걸면 핀 위로 마우스를 옮기는
// 순간 카드가 닫힌다.
function WorkRow({
  work,
  active,
  stop,
  onOpen,
  onHover,
  onLeave,
  onTogglePin,
  onArmDrag,
  dragging,
  menuTarget,
  editing,
  onRename,
  onRenameCommit,
  onRenameEnd,
  shellCount,
  signal,
  note,
  meta,
  threadCount,
  expanded,
  onToggleThreads,
}: {
  work: WorkView;
  active: boolean;
  /** 이 행이 목록의 Tab 정류장인가 — 이름 버튼이 `tabIndex={0}`을 받는다(roving, 목록 주석). */
  stop: boolean;
  /** 이 행이 끌리는 중인가 — 흐려진다. 행 모양이 정해지는 자리가 여기 하나라 이 값도 여기로 온다. */
  dragging: boolean;
  /** 이 행의 우클릭 메뉴가 열려 있는가 — 이름 버튼에 대상 테두리가 선다(codex-ds 결정 11). 고름(`active`)과 따로다(결정 7). */
  menuTarget: boolean;
  /** 이 행의 이름을 고치는 중인가 — 이름 버튼 자리에 레인과 입력칸이 선다(codex-ds 스펙 §9). */
  editing: boolean;
  onRename: (slug: string) => void;
  onRenameCommit: (slug: string, title: string) => void;
  onRenameEnd: () => void;
  /**
   * 행을 눌렀다 — 그 work로 간다. **`pointer`는 포인터로 눌렀는가다** — 키(Enter · Space)로 켠 클릭은 `detail`이 0이다. 누른 행에
   * 카드를 잠재우는 것은 포인터로 누른 것뿐이다(`SidebarWorkList`의 `quiet` — 포인터가 떠나야 깨는데, 키로 누른 행에는 떠날 포인터가 없다).
   */
  onOpen: (slug: string, pointer: boolean) => void;
  /** 포인터가 행에 들었거나 그 위에서 움직였다 — 카드는 멈춤을 잰다(`SidebarWorkList`의 `aimCard`). */
  onHover: (slug: string, row: HTMLElement) => void;
  onLeave: () => void;
  /** 핀을 눌렀다. `pointer`는 `onOpen`의 것과 같다. */
  onTogglePin: (work: WorkView, pointer: boolean) => void;
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
   * 셸이 있는 행의 **오른쪽 메타 내용**(S4). 슬롯으로 온다 — 신호가 있으면 부른 셸의 경과
   * (도는 중은 비움 — `SignalMeta`), 없으면 셸 수(`ShellMeta`)다. 가름은 위(`RowMetaFor`)가 한다.
   */
  meta: ReactNode;
  /** 이 Work에 이은 Thread 수(v1 티켓 37) — 0이면 수도 펼침 단추도 없다. */
  threadCount: number;
  /** 이 Work의 Thread가 아래에 펴져 있는가. */
  expanded: boolean;
  /** 펼침을 뒤집는다 — 펼침 단추와 이름 버튼의 → ←. */
  onToggleThreads: (slug: string) => void;
}) {
  // 제목 상자 — **hover 진입 때만** 만진다(아래 onMouseEnter). 한때 `useRef`로 쥐었는데, 이 파일이
  // 훅을 안 부르는 자리가 되면서(`SidebarWorkList.test.tsx`의 소스 검사) 이벤트가 온 행 안에서 찾는다.
  // 행마다 제목 상자는 하나이고, 찾는 때도 hover 진입·이탈 두 순간뿐이다.
  const titleBoxOf = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-title]");
  // 이름 칸의 자리 — 이름 버튼과, 이름을 고치는 동안 그 자리에 서는 상자가 함께 쓴다(높이 · 레인과 제목 사이 · 안쪽은 버튼 주석).
  // **레인이 Codex의 폴더 자리다**(v1 티켓 46) — 행 안쪽 8에 16 칸이 서서 창 끝 + 16, 제목은 그 뒤 8에 서서 창 끝 + 40이다(nav 줄의 아이콘 ·
  // 글자와 같은 세로줄). 한때 맨 앞에 펼침 단추 칸(22)이 늘 서 있어 제목이 + 59에서 시작했다 — 사용자가 짚은 「줄 글이 왼쪽 끝에서 멀다」다.
  const nameCell = "col-start-1 row-start-1 flex h-(--size-row-nav) min-w-0 items-center gap-2 rounded-lg pl-2";
  // **레인** — 행 왼쪽의 14px 한 칸(두 줄 행을 연 판의 결정 5). 화면값이 있으면 점·스피너가,
  // 없으면 work 상태 아이콘이 선다(#203). 표식(`data-lane`)은 검사 셋이 이 칸을 집는
  // 이름이다(마크업 seam · hover · 폭 드래그).
  // **폭을 안 내준다.** 실제로 그것을 지키는 것은 옆 제목 상자다 — `[data-title]`이
  // `min-width: 0`이라 좁아지는 값을 전부 흡수하므로 이 줄이 넘칠 일이 없고, 그래서
  // `shrink-0`을 지워도 지금은 화면이 안 바뀐다(L3 실측). 그래도 적는 것은 제목 쪽
  // 규칙이 바뀌는 날 **이 자리가 먼저 찌그러지는 것**이 가장 나쁜 회귀라서다:
  // 제목은 잘려도 읽히지만 8px 점은 12px만 줄어도 사라진다.
  // 이은 Thread가 있는 행은 가리키면 레인이 비키고 그 자리에 펼침 단추(▸)가 선다(아래 단추 주석).
  const lane = (
    <span
      data-lane=""
      className={cn("flex size-4 shrink-0 items-center justify-center", threadCount > 0 && "group-hover:opacity-0")}
    >
      {/* **화면값이 있으면 그것이 이 자리를 가져간다**(결정 5). 없으면 work 상태 아이콘이
          그대로 선다 — draft·review·done을 가르던 자리가 사라지지 않는 것이 스토리 19다.
          둘이 함께 서는 갈래는 없다: 레인은 14px 한 칸이고, 거기서 두 글리프가 겹치면
          「한 자리만 보면 된다」(스토리 18)가 깨진다. */}
      {signal === null ? <StatusIcon status={work.status} /> : <SignalLane kind={signal} />}
    </span>
  );
  return (
    <div
      // **표식은 끄는 동안 기하를 재는 자리가 이 행을 slug로 집기 위한 것이다**(UI개선 스펙 S6).
      data-work-row={work.slug}
      // **끌기는 여기서 무장만 한다** — 5px을 넘어야 끌기이고, 그 안쪽은 아래 `onClick`의 클릭이다
      // (공용 제스처 `lib/pointer-drag`). 주 버튼만 받는다: 보조 클릭으로 끌리면 메뉴를 열려던 손이
      // 순서를 흔든다. ⌃클릭도 받지 않는다 — macOS에서 ⌃클릭은 우클릭이라(같은 메뉴가 열린다) 주 버튼으로 와도 메뉴를 여는 손이다.
      onPointerDown={(event) => {
        if (event.button === 0 && !event.ctrlKey) onArmDrag(work.slug, event);
      }}
      // **누르면 그 work로 간다 — 행 어디를 눌러도 그렇다**(결정 6 · `sidebar-active-band` 스토리
      // 34). 이 자리가 이름 버튼이 아니라 바깥 상자인 것은 이름 버튼이 이름 칸만 덮기 때문이다:
      // 끝 칸의 오른쪽 메타(경과·셸 수)는 그 버튼 밖의 형제라, 클릭이 버튼에만 있으면 사람이
      // 가장 누르기 쉬운 **내용이 있는 자리**가 죽는다. (두 줄 행에서는 둘째 줄 29px이 그
      // 자리였다 — 이 갈래가 그때 정해졌다.)
      //
      // 그래서 **이름 버튼은 onClick을 안 든다** — 눌러도, 키보드로 켜도 그 클릭이 여기로
      // 올라온다(두 자리에 두면 한 번 눌러 두 번 돈다). 끊는 것은 핀 하나뿐이고, 그 한
      // 줄이 `stopPropagation`이다(핀 주석).
      //
      // ⌃클릭은 열지 않는다 — 우클릭과 같은 메뉴를 여는 손이고, 메뉴는 고름을 안 바꾼다(codex-ds 결정 7 · 위 `onPointerDown`).
      onClick={(event) => {
        if (!event.ctrlKey) onOpen(work.slug, event.detail > 0);
      }}
      onMouseEnter={(e) => {
        // **재는 것은 속도 하나이고, 이 한 번뿐이다**(결정 12). 흐르는 거리는 CSS가 정하므로
        // (결정 10) 여기서 넘침을 읽는 것은 그 거리를 **시간으로** 바꾸기 위해서다 —
        // `calc()`는 길이를 시간으로 못 바꾼다. 자리가 이 핸들러인 것은 호버 카드 타이머를
        // 이미 여기서 걸기 때문이고(움직임마다 다시 거는 것은 아래 `onMouseMove`이고, 재는 일은 들 때 한 번이다),
        // 그래서 **쉴 때 계측도 관찰자도 없다**: 사이드바 폭이
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
      // **움직이는 동안은 카드가 기다린다** — 멈춘 지 `duration-tip`에 선다(codex-ds 결정 20). 툴팁의 지연과 같은 꼴이라
      // 움직일 때마다 처음부터 다시 잰다.
      onMouseMove={(e) => onHover(work.slug, e.currentTarget)}
      onMouseLeave={(e) => {
        // 제자리로 돌아온다 — 복귀 시간(180ms)은 표식이 없는 평상시 규칙이 든다(결정 11).
        titleBoxOf(e.currentTarget)?.removeAttribute("data-marquee");
        onLeave();
      }}
      className={cn(
        // **flex가 아니라 grid다**(판 05 결정 1). 오른쪽 메타와 핀이 **끝 칸에 겹쳐** 서고
        // 칸 폭이 `max(메타, 핀)`이 된다 — flex로는 두 형제를 같은 자리에 포개면서 폭만 큰 쪽을
        // 따르게 할 수 없다. 한 트랙(`items-center`)이라 이름 버튼(32px)이 행 높이를 정하고,
        // 핀(24px)과 메타는 그 가운데에 선다 — 두 줄 행이 핀에 얹었던 눈높이 보정이 필요 없다.
        //
        // **첫 줄을 상자로 한 겹 싸지 않는다.** 싸면 **이름 버튼의 부모**가 그 상자가 되어, 그것으로
        // 배경 상자를 집는 자리가 조용히 어긋난다 — e2e가 이름 버튼의 `parentElement`로 호버 카드
        // 자리를 잰다. (한때 이 주석이 「핀의 `parentElement`」라고 적어 뒀는데 그런 자리는 없다.
        // 그 한 줄이 스펙까지 물려가 안 하나를 잘못 기각했다 — 판 05 결정 1이 그 내력을 든다.)
        //
        // **끝 칸은 아무것도 예약하지 않는다 — 그냥 `auto`다**(S34). 판 05의 결정 2·5는 여기에 한
        // 무리분(28px)을 **바닥으로** 깔라고 했고, 그것이 실물 앱을 보고 **기각됐다**:
        // 「아이콘을 고려해서 미리 빼놨다는건 말이 안됨. 아이콘 생기면 그때 가변되는게 맞아.」
        // 자리는 선 것이 **실제로 있을 때** 난다. 그 「선 것」에 **핀도 든다** — 핀은 hover에만
        // 폭을 가지므로 메타가 없는 행은 칸도 그때만 24px이 된다(핀 주석).
        //
        // **그래서 제목이 끊기는 자리는 셋일 때 움직인다**(사람이 고른 원칙의 대가, 판 2 실물 확인):
        //   - 메타가 없는 행(셸 없음)을 hover할 때 — 빈 칸에 핀 24px이 선다.
        //   - 경과의 자릿수가 바뀔 때(`9m`→`10m`, `59m`→`1h`).
        //   - 행이 조용함(셸 수) · 부름(경과) · 도는 중(비움) 사이를 오갈 때.
        // 메타가 선 행은 hover에 안 움직인다 — 메타가 투명해질 뿐 칸을 쥐고 있고(메타 주석), 그
        // 칸이 핀보다 넓다.
        //
        // 핀을 격자 밖(`absolute right-1`)에 세우는 안은 그대로 기각이다 — 칸이 핀을
        // 모르므로 핀이 **제목 글자 위에 얹힌다**(실물에서 그 겹침을 보고 되돌렸다).
        // 사람이 고른 것이 그 갈림이다: 「호버하면, 자동으로 아이콘 위치만큼 text의 최대
        // 크기가 조정되지? 이런걸 원하는거임. (안겹치게)」
        //
        // **이름 뒤 칸은 Thread 수다**(v1 티켓 37 · 보드 `.wrow`). 펼침 단추는 칸이 아니라 레인 위에 겹쳐 선다(`relative` — 아래 단추 주석). 단추는
        // DOM에서 이름 버튼 **뒤**에 선다 — 행의 첫 버튼이 이름 버튼이어야 대상 메뉴(`rowTarget`) · 이름 고치기의 포커스 돌아올 자리가 그대로다.
        "group relative grid w-full shrink-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center rounded-lg pr-1 transition-colors",
        // **채움은 없다.** 평평한 행이고, 회색이 서는 것은 고른 행 하나뿐이다 — 카드 채움(목업의
        // F·G)은 열여덟 행에 전부 무게를 줘 목록이 게시판이 된다.
        // 안 고른 행도 행 글자색이다(ui-refresh 결정 11) — nav 항목(`SidebarItem`)과 같은 값이다. 고른 행의 면도 nav와 같은
        // `fill-hover`다(사이드바 안의 `selected-row` — index.css).
        active ? "selected-row" : "text-fg-sidebar hover:bg-fill-soft",
        // **끌리는 행은 흐려진다**(UI개선 스펙 §4) — 자리는 그대로 두고. 행을 빼면 아래 행들이 올라와
        // 재어 둔 기하가 그 순간 틀어지고, 「어디서 뽑았는지」도 사라진다.
        dragging && "opacity-40",
      )}
    >
      {/* **이름을 고치는 동안 이름 버튼 자리에 레인과 입력칸이 선다**(codex-ds 스펙 §9). 버튼 안에는 입력칸을 둘 수 없어 버튼이 아닌
          상자로 갈아 끼운다 — 자리(`nameCell`)는 같아 레인과 글자가 움직이지 않는다. 입력칸은 제목 상자 자리의 남는 폭을 먹고, 글자가
          제목 글자와 한 세로줄에 서도록 왼쪽으로 4 넓힌 만큼 안쪽을 둔다. 입력칸 안의 누름은 행으로 올라가지 않는다 — 행은 누르면
          열고 끌면 옮긴다(`InlineRename`). 키로 끝내면 포커스가 다시 선 이름 버튼으로 돌아온다. 이 상자는 work 메뉴의 대상이 아니다
          — 위의 대상 찾기가 행의 첫 버튼만 집는다(`SidebarWorkList`의 `rowTarget`). 입력칸의 우클릭은 편집 메뉴다(`EditMenu` — 행
          메뉴의 Trigger가 그 자리에서 물러선다, `WorkContextMenu`). */}
      {editing ? (
        <div className={nameCell}>
          {lane}
          <InlineRename
            value={work.title}
            label="작업 이름"
            emptyMeans="revert"
            fit="fill"
            onCommit={(title) => onRenameCommit(work.slug, title)}
            onDone={onRenameEnd}
            returnFocus={() => document.querySelector<HTMLElement>(`[data-work-row="${work.slug}"] > button`)}
            className="-ml-1 h-6 px-1 text-sm text-fg"
          />
        </div>
      ) : (
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
          // **행의 높이를 이 버튼이 든다**(`size-row-nav`) — 바깥이 grid라 `h-full`은 자기가 잰 높이를 되받는
          // 순환이 된다. nav 항목과 같은 32px이고(DS `SidebarRow`), 셸이 몇 개든 무엇이 돌든 모든 work 행이 이
          // 높이다 — 겹쳐 선 메타·핀은 둘 다 이보다 낮다. 제목 폭을 푸는 자리도 이 상자이고
          // (`data-title`이 그 안에서 `flex-1`이다) 포커스 링이 그려지는 자리도 여기다.
          //
          // **오른쪽 여백은 없다.** 판 05는 여기 `pr-1.5`(6px)를 물어 제목과 끝 칸을 띄웠는데, 그러면
          // 메타가 없는 행에서 제목 상자가 핀 앞 6px에서 멎어 그만큼 좁아진다. 띄우는 값은 이제
          // **메타 칸이 든다**(`pl-2.25`) — 메타가 있을 때만 난다(S34의 원칙). 제목 상자가
          // 핀 바로 앞에서 끝나는 것을 L3가 잰다.
          className={`${nameCell} text-left focus-ring`}
          // **목록 하나가 Tab 정류장 하나다**(roving, codex-ds 스펙 S10) — 정류장 행의 이 버튼만 `0`이고 나머지는 `-1`이다. ↑↓는 목록
          // 상자가 받아 옆 행의 이 버튼으로 옮긴다(`@/lib/roving`). 표식은 그 키(slug)다. 아래 `aria-description`과 같은 까닭으로
          // `className` 뒤에 적는다.
          tabIndex={stop ? 0 : -1}
          data-roving={work.slug}
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
          // **우클릭 메뉴의 대상이 이 버튼이다**(codex-ds 결정 6 · 11). 열린 동안 표식이 서고 `focus-ring`이 그것을 포커스 링과 같은
          // 테두리로 그린다(`index.css`). ⇧F10 · 메뉴 키는 포커스된 이 버튼이 받아 같은 메뉴를 곁에 연다(`openMenuByKey`). 메뉴가
          // 닫히면 포커스가 여기로 돌아온다.
          //
          // **F2도 이 버튼이 듣는다**(codex-ds 스펙 §9) — 이 행의 이름을 그 자리에서 고친다. 고치는 상태는 위가 쥔다(`onRename`).
          data-menu-target={menuTarget ? "" : undefined}
          onKeyDown={(event) => {
            if (pressed(event, "rename")) {
              event.preventDefault();
              onRename(work.slug);
              return;
            }
            // **→ ←가 그 Work의 Thread를 펴고 접는다**(v1 티켓 37 — 트리의 버릇). 펼침 단추는 Tab 정류장이 아니라(핀과 같다) 키보드의
            // 길이 이것이다. 이미 그 상태면 아무것도 하지 않는다.
            const flips = event.key === "ArrowRight" ? !expanded : event.key === "ArrowLeft" && expanded;
            if (threadCount > 0 && flips && !hasModifier(event)) {
              event.preventDefault();
              onToggleThreads(work.slug);
              return;
            }
            openMenuByKey(event);
          }}
        >
          {lane}
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
              // 굵기는 400이다 — nav 항목도 400이다(Codex 사이드바는 줄마다 보통 굵기이고 고른 줄은 면으로만 드러난다 — v1 티켓 46).
              "min-w-0 flex-1 text-sm",
              work.status === "done" && "text-fg-tertiary",
            )}
          >
            <span>{work.title}</span>
          </span>
        </button>
      )}
      {/* **펼침 단추 — 이은 Thread가 있는 Work에만 선다**(v1 티켓 37 · 보드 `.wrow .ch`). ▸ 14 `fg-tertiary`, 펴면 ⌄로 돈다(구획 머리의 ⌄와
          같은 시간 · 곡선). 누르면 펼침만 뒤집는다 — 행의 누름(그 Work로 가기)으로 올라가지 않는다. Tab 정류장이 아니다(핀과 같다) — 키보드는
          이름 버튼의 → ←다.
          **레인 위에 겹쳐 서고, 행을 가리킬 때만 보인다**(v1 티켓 46 — Codex 프로젝트 줄은 폴더 아이콘 하나가 그 자리를 든다). 한때 행 맨
          앞의 제 칸(22)이 늘 서 있었고, 이은 Thread가 없는 행도 그만큼 비워 제목이 모든 줄에서 그만큼 밀렸다. 이제 단추는 행 왼쪽 32(행
          안쪽 8 + 레인 16 + 사이 8)를 덮고 ▸가 레인 가운데에 선다 — 가리키면 레인이 비키고 ▸가 선다. 펼친 것은 아래에 선 Thread 줄이 말한다. */}
      {threadCount > 0 && (
        <button
          type="button"
          data-expander={work.slug}
          aria-label={`${work.title}의 Thread ${expanded ? "접기" : "펼치기"}`}
          aria-expanded={expanded}
          tabIndex={-1}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleThreads(work.slug);
          }}
          className="absolute inset-y-0 left-0 flex w-8 items-center justify-center rounded-lg text-fg-tertiary opacity-0 outline-none transition-colors group-hover:opacity-100 hover:text-fg-secondary focus-ring"
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-[rotate] duration-[180ms] ease-panel",
              expanded && "rotate-90",
            )}
          />
        </button>
      )}
      {/* **Thread 수**(v1 티켓 37 · 구현 스펙 §13 「Work 줄 오른쪽의 숫자는 Thread 수다」 · 보드 `.wrow .n`) — 12 `fg-tertiary`, 구획 머리의
          수와 같은 글자다. 제목과의 사이는 보드의 6이다. 셸 메타와 따로 선다: 셸 수(`⌨ N`)는 그 Work의 터미널이고 이 수는 그 Work의 대화다. 표시 전용이라 포인터를 안
          받는다 — 그 자리의 누름은 행이 받아 그 Work로 간다. 0이면 칸이 없다(「없음」은 숫자로 말하지 않는다 — 셸 메타와 같다). */}
      {threadCount > 0 && (
        <span
          data-thread-count={work.slug}
          className="pointer-events-none col-start-2 row-start-1 pr-1 pl-1.5 text-xs tabular-nums text-fg-tertiary"
        >
          {threadCount}
        </span>
      )}
      {/* 평소 숨어 있다가 hover에만 뜬다(결정 85) — 고정 여부는 구획이 이미 말하고,
          좁은 사이드바에서 상시 아이콘은 정작 봐야 할 제목보다 먼저 눈에 들어온다.
          페이드가 없는 것은 icon-button-tint가 정한다(옆 행으로 옮겨 갈 때 두 핀이
          겹쳐 미끄러져 보인다).
          **Tab 정류장이 아니다**(`tabIndex={-1}`, codex-ds 스펙 S10) — 목록은 Tab 한 번이고(이름 버튼 주석) 행 안 버튼은
          빠진다. 키보드로 고정하는 길은 그 행의 work 메뉴(⇧F10 · 메뉴 키)의 「고정」이다. 그래서 포커스에 뜨는 갈래도 없다.
          포커스는 여전히 받으므로(보조 기술 · 코드, WebKit 밖의 누름) 링(`focus-ring`)은 단다 — 없으면 브라우저 기본 테두리다.
          채운 핀 / 빈 핀으로 갈린다. PinOff(사선 그은 핀)를 쓰지 않는 것은 이 저장소의
          아이콘이 전부 외곽선이고, 결정 85가 말한 것도 「채운 핀」이기 때문이다.
          켜짐은 aria-pressed가 말한다(WorkPanel의 `</>` 토글과 같은 규칙). title도 앱 툴팁도
          두지 않는다 — 행에 머물면 호버 카드가 떠서 툴팁이 그 위로 겹친다(S29).

          **오른쪽 메타와 같은 끝 칸에 겹쳐 선다**(판 05 결정 1). 그래서 칸 폭이
          `max(메타, 핀)`이고, **핀이 폭을 가질 때만** 그 24px(`icon-button-xs`)이 칸에 더해진다 — 메타가 선 행은
          칸이 이미 핀보다 넓어 안 움직이고, 메타가 없는 행만 hover에 제목이 24px 줄어든다.

          **쉴 때 폭을 걷는 것이 `max-w-0`이다** — `width`가 아니라 `max-width`인 것은
          `icon-button`이 폭(`width`)을 들기 때문이다. 둘 다 유틸리티 레이어라 `w-0`으로
          덮으려 들면 승자가 Tailwind의 정렬 순서에 걸리는데, `max-width`는 다른 속성이라
          그 싸움 밖에 선다. 격자 트랙은 아이템의 max-content 기여를 `max-width`로 clamp하므로
          쉴 때 기여가 **0**이다. `overflow-hidden`은 그 0폭 상자 밖으로 글리프가 삐져나오지 않게 하는
          것이다. (한때 이 핀은 포커스에도 떴고(판 05 결정 7) `display:none`이면 포커스가 안 들어가 상자를
          지우지 않는 이 꼴이 됐다 — Tab에서 빠진 지금도 꼴은 그대로다.)

          **트랜지션을 안 건다.** `icon-button-tint`가 `transition-property: color`뿐이라
          폭은 즉시 바뀌는데, 그게 맞다 — 행의 `onMouseEnter`가 hover 스타일이 **이미 적용된
          뒤에** `clientWidth`를 읽어 마퀴 거리를 잰다. 폭에 트랜지션이 걸리면 그 순간의
          중간값이 잡혀 마퀴가 끝까지 못 흐른다.

          **`justify-self-end`가 자리를 붙든다.** 칸이 핀보다 넓을 때(메타가 선 행) 격자
          기본값 stretch면 핀 상자가 칸만큼 늘어나 글리프가 가운데로 밀린다. 끝에 붙이면
          메타가 있든 없든 **메타 자리의 끝 한 자리**다(스토리 32). */}
      <button
        type="button"
        aria-label={`${work.title} 고정`}
        aria-pressed={work.pinned}
        onClick={(event) => {
          // **행 상자의 클릭을 끊는다.** 이 버튼은 행 안에 있으므로 그냥 두면 핀을 누를
          // 때마다 그 work가 함께 열린다 — 클릭이 행 상자로 올라가게 되면서 처음 생긴
          // 길이라, 이 한 줄이 그 길의 유일한 마개다.
          event.stopPropagation();
          onTogglePin(work, event.detail > 0);
        }}
        tabIndex={-1}
        className="icon-button-tint icon-button-xs col-start-3 row-start-1 max-w-0 justify-self-end overflow-hidden text-fg-tertiary opacity-0 outline-none focus-ring group-hover:max-w-6 group-hover:opacity-100"
      >
        <Pin
          className="size-3"
          fill={work.pinned ? "currentColor" : "none"}
        />
      </button>
      {/* **오른쪽 메타 — 셸이 하나라도 있으면 선다**(결정 3 · S4). 셸이 0개인 행에는 이 칸이
          아예 없다: 「없음」은 숫자로 말하지 않고, 프로젝트 이름은 호버 카드가 싣는다. 안에 서는
          것은 슬롯이 정한다 — 부르면 부른 셸의 경과, 돌면 아무것도, 조용하면 셸 수다(`RowMetaFor` ·
          ui-refresh 결정 13). 「명령이 도는 동안만 선다」는 그때도 지금도 **기각이다**: 그
          값은 매 순간 바뀌어서 자리에 매면 claude가 답을 마칠 때마다 이 칸이 생겼다 사라진다.
          자리가 서는 조건은 **안 변하는 값**(셸을 포함하는가)이고, 변하는 것은 그 **안에서**만
          변한다.

          **핀과 같은 끝 칸에 겹쳐 서고, 칸 끝에 붙는다**(판 05 결정 1). 칸 폭은 `max(메타, 핀)`
          이다. **왼쪽 `pl-2.25`가 제목과 메타를 떼는 값이다** — DS `.at-row`의 사이(9px — 레인과 제목
          사이와 같다)이고, 메타가 있을 때만 난다(S34: 바닥을 두지 않는다).

          **슬롯이 아무것도 안 그리면 칸이 통째로 빠진다(`empty:hidden`)** — 「칸의 폭은 선 것들의
          폭이다」(스펙 S34). 조용한 갈래(`ShellMeta`)는 셸이 하나라도 있으면 늘 무언가를 그리므로
          여기 안 걸리고, 걸리는 것은 도는 행이다 — 신호 갈래가 도는 중에는 `null`이다(경과도
          마크도 없다 — `SignalMeta` 머리말). 그때 빈 상자가 9px 틈을 쥐면 제목만 까닭 없이 짧아진다.
          칸이 서는가를 여기서 묻지 못하는 것은 무엇을 그릴지가 슬롯 **안의** 구독에서 정해지기
          때문이라(`RowMetaFor`), 빈 것을 보고 물러나는 일은 CSS가 한다. 아래 hover의 투명과는
          뜻이 반대다: 그쪽은 선 것이 **있어서** 칸을 쥔 채 안 보이게 하고, 여기는 선 것이 없다.

          hover하면 메타가 **투명해진다**(판 05 결정 6). `hidden`이 아니다 — `display:none`은 칸
          폭 계산에서 빠져 끝 칸이 핀의 24px로 **줄고** 제목이 hover마다 튄다. `visibility:hidden`도
          아니다: 셸 수가 마우스 위치에 따라 있다 없다 하는 정보가 되면 안 된다. 트랜지션은
          안 건다 — 옆 행으로 옮겨 갈 때 두 페이드가 겹쳐 미끄러져 보인다(icon-button-tint가
          opacity를 뺀 것과 같은 이유). **잃는 것은 커서가 이미 가 있는 행 하나의 메타다** —
          「훑어서 찾고 → 가리켜서 누른다」에서 가리키는 순간은 이미 고른 뒤다.
          **포커스에는 물러나지 않는다** — 핀이 Tab에서 빠져(핀 주석) 포커스에 뜨는 것이 없다.
          `group-focus-within`으로 물리면 이름 버튼에 포커스가 갈 때 메타만 사라져 그 자리가 통째로 빈다.

          **표시 전용이다.** 무리 하나가 셸 여럿을 접으므로 무리와 셸이 1:1이 아니고, 누르면
          어느 셸로 갈지 정해지지 않는다. 그래서 `pointer-events-none`이 **상시다**(판 05 결정
          6의 정정) — 누를 것이 없을 뿐 아니라, 같은 칸에 겹쳐 서고 DOM에서 핀보다 **뒤**라
          이것이 위에 그려진다: 그대로 두면 핀의 클릭을 가로챈다. 그리고 그 자리의 클릭은 행
          상자가 받는다 — 셸 수나 경과를 눌러도 그 work로 간다(행 상자 주석).

          **표식이 둘이다.** `data-row-meta`는 **자리**의 이름이다 — 이 저장소의 규칙은 「표식은
          그 자리에 있는 것의 이름」인데(`data-shells`·`data-branch`·`data-section`), 이 칸은
          **싣는 것이 갈려서** 있는 것으로 이름을 붙이면 갈래 대부분에게 그 이름이 거짓이 된다
          (두 줄 행의 `data-subrow`가 같은 이유로 자리 이름이었다). `data-shells`는 그 규칙
          그대로 **셸 수일 때만** 붙는다: 신호의 경과가 서 있는데 그 표식이 남으면 「이
          표식 안은 무리 나열이고 숫자의 합 = 셸 수」라는 불변조건이 DOM에서 조용히 거짓이
          된다. 가름을 여기서 다시 묻지 않고 행이 이미 쥔 `signal`로 하는 것이 요점이다: 레인이
          점을 세우는 근거와 **같은 값**이라 둘이 어긋날 수 없다. */}
      {shellCount > 0 && (
        <div
          data-row-meta={work.slug}
          data-shells={signal === null ? work.slug : undefined}
          className="pointer-events-none col-start-3 row-start-1 flex items-center justify-self-end pl-2.25 group-hover:opacity-0 empty:hidden"
        >
          {meta}
        </div>
      )}
    </div>
  );
}

/** 수식 키가 눌렸나 — → ←는 맨 키일 때만 펼침이다(⌥→ 등은 다른 손이다). */
function hasModifier(event: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): boolean {
  return event.altKey || event.metaKey || event.ctrlKey || event.shiftKey;
}
