import { EDGE_BAND, EDGE_MAX_STEP } from "@/lib/edge-scroll";
import type { WorkView } from "./types";
import type { SectionsOpen } from "./work-sections";

/**
 * 작업 행을 끌어 놓을 **틈**(UI개선 스펙 §4 · S6). 입력은 구획 단위 기하와 포인터이고, 출력은
 * 곧바로 옮기기 명령의 인자 `(pinned, before)`이거나 「놓을 곳 없음」이다.
 *
 * **DOM을 모른다.** 사각형을 재는 것은 사이드바 목록이 끌기를 시작할 때 한 번 하고, 여기는 그
 * 수만 받는다 — 경계 규칙이 표로 적힐 만큼 갈래가 많아서(티켓 05의 틈 표) 렌더 없이 재는 자리가
 * 있어야 했다(`row-drop.test.ts`).
 *
 * **좌표는 스크롤 내용 좌표다** — 0이 목록 내용의 맨 위. 기하를 끌기 시작 뒤 한 번만 재도, 움직일
 * 때마다 포인터 y에 그 순간의 `scrollTop`을 더하면 같은 사각형을 가리킨다. 뷰포트 좌표로 재면
 * 목록이 구르는 순간(자동 스크롤 — 티켓 06) 선이 어긋나고, 그렇다고 움직일 때마다 다시 재면
 * 포인터 이동마다 레이아웃을 읽는다.
 */

export interface Span {
  top: number;
  bottom: number;
}

/**
 * 구획 하나의 기하. **머리와 받침 중 하나는 반드시 있다** — 둘 다 없는 구획은 가리킬 사각형이 없어
 * 기하에 안 싣는다. 그 보장을 타입이 말한다: 머리가 없는 구획(빈 `고정` — 결정 82가 머리를 걷었다)은
 * 받침이 있어야만 선다.
 */
export type SectionGeometry = SectionRects & {
  /** 이 구획이 `고정`인가. 틈의 `pinned`가 여기서 나온다. */
  pinned: boolean;
  /** **보이는** 행들, 위에서부터. 접힌 구획은 비어 있다. */
  rows: Array<Span & { slug: string }>;
  /**
   * 그 구획의 slug 전부(접혀도). 접힌 머리에 놓을 때의 `before`와 「자기 바로 다음」이 여기서
   * 나온다 — 보이는 행에서 찾으면 접힌 구획에는 첫 slug가 없다.
   */
  slugs: string[];
};

/**
 * - `head` — 구획 머리. 접혀도 펼쳐도 선다.
 * - `emptySlot` — **빈 받침**(티켓 06 · 스펙 S7): 행이 하나도 없는 구획에 끄는 동안만 서는 사각형. 머리
 *   아래(빈 `작업`)거나 머리 대신(빈 `고정`)이다. 가리킬 수 없으면(접힌 몸통 안) 안 싣는다.
 *   탭 끌기의 `slot`(탭 사이 틈)과 다른 것이라 이름을 달리한다.
 */
type SectionRects = { head: Span; emptySlot?: Span } | { head: null; emptySlot: Span };

export interface ListGeometry {
  /**
   * 스크롤 상자의 **뷰포트** 사각형. 이 밖이면 놓을 곳이 없다. 내용 좌표인 구획과 달리 목록이 화면에서
   * 밀리면 낡으므로, 부르는 쪽이 포인터를 읽는 **그 순간의** 사각형을 넣는다(`SidebarWorkList`의 `liveBox`).
   */
  box: { left: number; right: number; top: number; bottom: number };
  /** 화면에 선 순서대로. 좌표는 내용 좌표다. */
  sections: SectionGeometry[];
}

/** 옮기기 명령의 인자 그대로 — `before: null`은 그 구획의 끝이다. */
export interface RowGap {
  pinned: boolean;
  before: string | null;
}

export interface DropPointer {
  x: number;
  y: number;
  /** 그 순간 목록의 `scrollTop`. */
  scrollTop: number;
}

/**
 * 포인터 아래의 틈. **위에서 먼저 맞는 줄이 이긴다**(티켓 05의 표):
 *
 * 1. 스크롤 상자 밖 → 없음
 * 2. 구획 머리(접힘·펼침 무관) → 그 구획 맨 위
 * 3. 빈 받침 → 그 구획(`before` 없음)
 * 4. 행: 중심선 위 → 그 행 앞 · 아래 → 같은 구획 다음 행 앞(마지막 행이면 그 구획 끝)
 * 5. 사각형 사이·아래의 빈 곳 → 바로 위 사각형의 판정
 * 6. 결과가 원래 자리와 같으면 없음
 */
export function rowGap(geometry: ListGeometry, dragged: string, pointer: DropPointer): RowGap | null {
  const { box } = geometry;
  if (!insideBox(box, pointer)) return null;
  const gap = gapAt(geometry.sections, pointer.y - box.top + pointer.scrollTop);
  return gap === null || staysPut(geometry.sections, dragged, gap) ? null : gap;
}

/** 틈 규칙 1의 상자 — 이 밖은 놓을 곳이 없고, 그래서 자동 스크롤도 안 돈다. */
function insideBox(box: ListGeometry["box"], point: { x: number; y: number }): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

function gapAt(sections: SectionGeometry[], y: number): RowGap | null {
  // 지금까지 지나온 사각형 중 **바로 위의 판정**(5). 빈 곳에 떨어지면 이것이 답이다.
  let above: RowGap | null = null;
  for (const section of sections) {
    const top: RowGap = { pinned: section.pinned, before: section.slugs[0] ?? null };
    const { head, emptySlot } = section;
    // 첫 머리 위의 여백(`mt-3`)은 위에 사각형이 없다 — 표가 비워 둔 자리라 그 구획 첫 사각형의 판정을
    // 준다. 머리가 없는 구획(빈 `고정`)은 받침이 그 첫 사각형이고, 빈 구획의 「맨 위」와 받침의 답은 같다.
    if (y < (head ?? emptySlot).top) return above ?? top;
    if (head) {
      if (y < head.bottom) return top;
      above = top;
    }
    if (emptySlot) {
      const into: RowGap = { pinned: section.pinned, before: null };
      if (y < emptySlot.top) return above;
      if (y < emptySlot.bottom) return into;
      above = into;
    }
    for (const row of section.rows) {
      const next = section.slugs[section.slugs.indexOf(row.slug) + 1] ?? null;
      const below: RowGap = { pinned: section.pinned, before: next };
      if (y < row.top) return above;
      if (y < row.bottom) {
        return y < (row.top + row.bottom) / 2 ? { pinned: section.pinned, before: row.slug } : below;
      }
      above = below;
    }
  }
  return above;
}

/**
 * 놓아도 아무것도 안 바뀌는 자리인가(6). 없음으로 접는 것은 명령을 아끼려는 것만이 아니다 —
 * `before`가 자기 자신이면 코어가 오류로 돌려준다(스펙 §2의 검증).
 */
function staysPut(sections: SectionGeometry[], dragged: string, gap: RowGap): boolean {
  if (gap.before === dragged) return true;
  const home = sections.find((section) => section.slugs.includes(dragged));
  if (!home || home.pinned !== gap.pinned) return false;
  const index = home.slugs.indexOf(dragged);
  return gap.before === null
    ? index === home.slugs.length - 1
    : home.slugs[index + 1] === gap.before;
}

/**
 * 틈을 화면에 어떻게 보이나 — **선이거나, 밝아진 받침이거나** 둘 중 하나다. 둘을 한 자리에서 같은
 * 기하로 정한다: 따로 정하면(선은 기하로, 받침은 목록 데이터로) 접힌 빈 구획처럼 둘의 입력이 갈리는
 * 곳에서 선과 받침이 함께 켜진다.
 *
 * - **받침이 기하에 실린 구획이면 받침이 밝아진다**(`emptySlot`에 그 구획 — 받침의 `data-empty-slot`과 같은 이름) — 빈 구획엔 선이 설
 *   「사이」가 없고, 머리 아랫변에 세우면 받침 윗변에 붙어 「받침 위의 틈」으로 읽힌다.
 * - 아니면 선의 내용 좌표 y. **사이의 가운데**에 선다 — 행 윗변에 붙이면 선이 그 행의 것으로 읽힌다.
 *   접힌 구획처럼 보이는 행이 없으면 머리 아랫변이다.
 */
export type GapMark = { lineY: number } | { emptySlot: keyof SectionsOpen };

export function gapMark(geometry: ListGeometry, gap: RowGap): GapMark | null {
  const section = geometry.sections.find((one) => one.pinned === gap.pinned);
  if (!section) return null;
  if (section.head === null || section.emptySlot) return { emptySlot: section.pinned ? "pinned" : "works" };
  const { rows, head } = section;
  if (rows.length === 0) return { lineY: head.bottom };
  const bottomBefore = (index: number) => (index === 0 ? head.bottom : rows[index - 1].bottom);
  if (gap.before === null) {
    const last = rows.length - 1;
    return { lineY: rows[last].bottom + (rows[last].top - bottomBefore(last)) / 2 };
  }
  const index = rows.findIndex((row) => row.slug === gap.before);
  if (index < 0) return { lineY: head.bottom };
  return { lineY: (bottomBefore(index) + rows[index].top) / 2 };
}

/**
 * **끄는 도중 받은 목록이 끌기를 거둘 만큼 바뀌었나**(티켓 06 · 스펙 S8). 보는 것은 `(slug, pinned)`의
 * 순열 하나다 — 재어 둔 기하(`ListGeometry`)가 틀어지는 것이 그것이 바뀔 때뿐이라서다. 제목·상태·셸은
 * 행 높이를 안 바꾼다(행이 두 줄 55px로 못박혀 있다 — `WorkRow`).
 *
 * 좁히는 까닭은 흔한 쪽을 살리려는 것이다: 에이전트가 spec을 고치면 `works:changed`가 오고 목록이 다시
 * 온다. 그때마다 끌기가 끊기면 사람은 까닭 없이 손을 놓친다.
 */
export function orderChanged(before: readonly WorkView[], after: readonly WorkView[]): boolean {
  return (
    before.length !== after.length ||
    before.some((work, index) => work.slug !== after[index].slug || work.pinned !== after[index].pinned)
  );
}

/**
 * **가장자리 자동 스크롤**의 한 프레임 걸음(티켓 06 · 스토리 13). 양수면 아래로. 좌표는 **뷰포트**다 —
 * 포인터가 상자의 어느 가장자리에 붙었는가를 묻는 것이라 내용 좌표가 뜻이 없다.
 *
 * - 띠 안에서 가장자리에 깊이 붙을수록 빠르다 — 멈추고 싶으면 조금만 물러나면 된다.
 * - **상자 밖에서는 안 구른다.** 목록 밖은 놓을 곳이 없는 자리(틈 규칙 1)라, 거기서 구르면 본문으로
 *   끌고 나간 손이 사이드바를 흔든다.
 */
export function edgeScrollStep(box: ListGeometry["box"], point: { x: number; y: number }): number {
  if (!insideBox(box, point)) return 0;
  const speed = (depth: number) => Math.ceil((EDGE_MAX_STEP * Math.min(depth, EDGE_BAND)) / EDGE_BAND);
  const fromBottom = box.bottom - point.y;
  if (fromBottom < EDGE_BAND) return speed(EDGE_BAND - fromBottom);
  const fromTop = point.y - box.top;
  if (fromTop < EDGE_BAND) return -speed(EDGE_BAND - fromTop);
  return 0;
}

/**
 * 놓는 순간 캐시에 **낙관적으로** 쓸 목록(스펙 §5). 규칙은 코어 `move_work`의 2단계 그대로다 —
 * 빼서 `before` 앞에, 없으면 목표 구획의 마지막 작업 뒤에. `status`는 안 건드린다(결정 9).
 *
 * 응답이 오면 그 목록으로 갈아 끼우므로 여기가 틀려도 오래 안 남는다. 그래도 같게 두는 것은 응답이
 * 도착하는 순간 화면이 한 번 더 뛰지 않게 하려는 것이다.
 */
export function movedWorks(works: WorkView[], slug: string, gap: RowGap): WorkView[] {
  const moving = works.find((work) => work.slug === slug);
  if (!moving) return works;
  const rest = works.filter((work) => work.slug !== slug);
  let at = gap.before === null ? -1 : rest.findIndex((work) => work.slug === gap.before);
  if (at < 0) {
    // 목표 구획의 마지막 뒤. 목록이 「고정이 먼저」로 오므로(코어의 정렬) 빈 `고정`의 끝은 맨 앞이다.
    at = gap.pinned ? 0 : rest.length;
    rest.forEach((work, index) => {
      if (work.pinned === gap.pinned) at = index + 1;
    });
  }
  return [...rest.slice(0, at), { ...moving, pinned: gap.pinned }, ...rest.slice(at)];
}
