import type { WorkView } from "./types";

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

export interface SectionGeometry {
  /** 이 구획이 `고정`인가. 틈의 `pinned`가 여기서 나온다. */
  pinned: boolean;
  /** 구획 머리 — 접혀도 펼쳐도 선다. */
  head: Span;
  /** **보이는** 행들, 위에서부터. 접힌 구획은 비어 있다. */
  rows: Array<Span & { slug: string }>;
  /**
   * 그 구획의 slug 전부(접혀도). 접힌 머리에 놓을 때의 `before`와 「자기 바로 다음」이 여기서
   * 나온다 — 보이는 행에서 찾으면 접힌 구획에는 첫 slug가 없다.
   */
  slugs: string[];
}

export interface ListGeometry {
  /** 스크롤 상자의 **뷰포트** 사각형. 이 밖이면 놓을 곳이 없다. */
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
 * 3. (06이 더한다) 빈 받침 → 그 구획
 * 4. 행: 중심선 위 → 그 행 앞 · 아래 → 같은 구획 다음 행 앞(마지막 행이면 그 구획 끝)
 * 5. 사각형 사이·아래의 빈 곳 → 바로 위 사각형의 판정
 * 6. 결과가 원래 자리와 같으면 없음
 */
export function rowGap(geometry: ListGeometry, dragged: string, pointer: DropPointer): RowGap | null {
  const { box } = geometry;
  if (pointer.x < box.left || pointer.x > box.right || pointer.y < box.top || pointer.y > box.bottom) {
    return null;
  }
  const gap = gapAt(geometry.sections, pointer.y - box.top + pointer.scrollTop);
  return gap === null || staysPut(geometry.sections, dragged, gap) ? null : gap;
}

function gapAt(sections: SectionGeometry[], y: number): RowGap | null {
  // 지금까지 지나온 사각형 중 **바로 위의 판정**(5). 빈 곳에 떨어지면 이것이 답이다.
  let above: RowGap | null = null;
  for (const section of sections) {
    const top: RowGap = { pinned: section.pinned, before: section.slugs[0] ?? null };
    // 첫 머리 위의 여백(`mt-3`)은 위에 사각형이 없다 — 표가 비워 둔 자리라 그 머리의 판정을 준다.
    if (y < section.head.top) return above ?? top;
    if (y < section.head.bottom) return top;
    above = top;
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
 * 틈 선이 설 내용 좌표 y. **사이의 가운데**에 선다 — 행 윗변에 붙이면 선이 그 행의 것으로 읽힌다.
 * 접힌 구획처럼 보이는 행이 없으면 머리 아랫변이다.
 */
export function gapLineY(geometry: ListGeometry, gap: RowGap): number | null {
  const section = geometry.sections.find((one) => one.pinned === gap.pinned);
  if (!section) return null;
  const { rows, head } = section;
  if (rows.length === 0) return head.bottom;
  const bottomBefore = (index: number) => (index === 0 ? head.bottom : rows[index - 1].bottom);
  if (gap.before === null) {
    const last = rows.length - 1;
    return rows[last].bottom + (rows[last].top - bottomBefore(last)) / 2;
  }
  const index = rows.findIndex((row) => row.slug === gap.before);
  if (index < 0) return head.bottom;
  return (bottomBefore(index) + rows[index].top) / 2;
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
