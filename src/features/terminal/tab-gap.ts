import { isInPlaceGap } from "./shell-registry";

// 탭 줄 위의 포인터가 **몇 번째 틈**인가(결정 11 · ui-improvement 스펙 §6). DOM을 안 읽는
// 순수 함수다 — 기하는 탭 줄이 끌기를 시작할 때 한 번 재서 넘기고(`ShellTabs`), 여기는
// 그 숫자만 본다. 그래서 DOM 없는 기본 환경에서 표로 잰다(tab-gap.test.ts).
//
// 좌표는 **내용 좌표**다 — 뷰포트 x에 줄의 `scrollLeft`를 더한 값. 셸이 여덟이면 줄이 가로로
// 스크롤되는데(결정 20), 칸의 뷰포트 자리는 스크롤마다 움직여도 내용 좌표는 안 움직여서
// 한 번 잰 기하가 끄는 내내 맞는다. 움직일 때마다 포인터 쪽에만 그 순간의 `scrollLeft`를 더한다.
//
// **셸 칸만 센다.** 맨 앞 `spec` 칸은 이 줄(스크롤 상자) 밖에 서므로 기하에 안 들고, 그래서
// 틈 0이 곧 「`spec` 뒤」다 — 셸을 `spec` 앞에 놓을 틈이 애초에 없다.

/** 끌기를 시작할 때 한 번 잰 탭 줄. */
export interface TabStripGeometry {
  /** 셸 칸들의 가로 자리, 줄에 선 순서대로 — 내용 좌표. */
  tabs: ReadonlyArray<{ left: number; right: number }>;
  /**
   * 줄 상자가 화면에 보이는 가로 범위 — **뷰포트 좌표**. 스크롤해도 상자는 안 움직인다.
   * 내용 좌표의 원점도 이 `left`다(내용의 첫 픽셀은 스크롤과 무관하게 `상자 left + 0`).
   */
  view: { left: number; right: number };
  /** 끄는 칸이 줄에서 몇 번째인가. */
  from: number;
}

/**
 * 포인터 아래의 틈. 틈 g는 **중심이 포인터 왼쪽에 있는 칸의 수**다 — 칸의 오른쪽 절반을
 * 넘으면 그 칸 뒤다.
 *
 * `null`인 경우가 셋이다: 줄 상자 밖(`spec` 칸 · `+` · 조작 위) · 셸 칸이 없음 · **끄는 칸의
 * 양옆 틈**. 마지막은 놓아도 제자리라(레지스트리 `isInPlaceGap` — `moveShell`이 같은 판정으로
 * 같은 상태를 돌려준다) 선을 세우면 화면이 「여기 놓인다」고 말해 놓고 아무것도 안 하는 셈이다.
 */
export function tabGap(geometry: TabStripGeometry, clientX: number, scrollLeft: number): number | null {
  const { tabs, view, from } = geometry;
  if (tabs.length === 0) return null;
  if (clientX < view.left || clientX > view.right) return null;

  const x = clientX + scrollLeft;
  const gap = tabs.filter((tab) => (tab.left + tab.right) / 2 < x).length;
  return isInPlaceGap(from, gap) ? null : gap;
}

/** 틈 선의 폭(px). 그리는 쪽(`ShellTabs`의 `w-px`)과 같은 값이다. */
const LINE = 1;

/**
 * 틈 선의 `left` — 줄 **내용의 원점**에서 잰 px. 스크롤 상자 안의 절대 위치는 내용과 함께
 * 흐르므로 `scrollLeft`를 빼지 않는다.
 *
 * 칸 사이면 간격 한가운데다. 양 끝은 줄 안쪽 끝에 붙는다 — **줄 밖으로 내밀면 스크롤 상자가
 * 그만큼 넘쳐** 넘치지 않던 줄이 스크롤을 얻는다(900px 창의 여유는 3.5px뿐이다).
 */
export function gapLineLeft(geometry: TabStripGeometry, gap: number): number {
  const { tabs, view } = geometry;
  if (tabs.length === 0) return 0;
  const end = tabs[tabs.length - 1].right - view.left - LINE;
  const at =
    gap <= 0
      ? tabs[0].left
      : gap >= tabs.length
        ? tabs[tabs.length - 1].right
        : (tabs[gap - 1].right + tabs[gap].left) / 2;
  return Math.min(Math.max(at - view.left - LINE / 2, 0), end);
}
