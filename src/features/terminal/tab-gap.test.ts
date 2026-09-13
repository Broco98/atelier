import { describe, expect, it } from "vitest";
import { gapLineLeft, tabGap } from "./tab-gap";
import type { TabStripGeometry } from "./tab-gap";

// UI개선 결정 11 · UI개선 스펙 §6 — 탭 줄 위의 포인터가 **몇 번째 틈**인가. DOM 없이 도는 순수 함수라 기하를
// 손으로 짓는다: 줄은 뷰포트 x 100에서 시작하고(그 왼쪽이 `spec` 칸과 세로선이다), 셸 칸은
// 폭 80 · 간격 4로 넷이 선다.
//
//   셸 칸 0: 100..180 · 1: 184..264 · 2: 268..348 · 3: 352..432   (중심 140 · 224 · 308 · 392)
const TABS = [0, 1, 2, 3].map((at) => ({ left: 100 + at * 84, right: 180 + at * 84 }));

/** 스크롤 0에서 잰 기하. `from`은 끄는 칸의 자리다. */
const geometry = (from: number): TabStripGeometry => ({
  tabs: TABS,
  view: { left: 100, right: 432 },
  from,
});

describe("탭 줄의 틈", () => {
  // 틈 g는 「중심이 포인터 왼쪽에 있는 칸의 수」다 — 칸의 오른쪽 절반을 넘으면 그 칸 뒤다.
  it.each([
    ["첫 칸의 왼쪽 절반", 120, 0],
    ["첫 칸의 오른쪽 절반", 160, 1],
    ["칸 사이 간격", 182, 1],
    ["셋째 칸의 오른쪽 절반", 330, 3],
    ["마지막 칸의 오른쪽 절반", 420, 4],
  ] as const)("%s(x %i) → 틈 %i", (_, x, gap) => {
    // 끄는 칸을 멀리(자리 없는 곳에) 두어 제자리 규칙이 이 표를 안 가리게 한다.
    expect(tabGap({ ...geometry(0), from: -10 }, x, 0)).toBe(gap);
  });

  // **`spec` 뒤부터 센다.** 줄 왼쪽 밖(`spec` 칸 위)은 틈이 아니다 — 셸 칸의 틈 0은 `spec`
  // **뒤**이고, 그 앞에 셸을 놓을 틈은 없다. 줄 오른쪽 밖(`+`·조작 위)도 틈이 아니다.
  it("줄 밖은 틈이 아니다 — `spec` 앞 틈이 없다", () => {
    expect(tabGap(geometry(3), 60, 0)).toBeNull();
    expect(tabGap(geometry(3), 99, 0)).toBeNull();
    expect(tabGap(geometry(0), 440, 0)).toBeNull();
    // 줄 첫 픽셀은 틈 0이다 — 위 null이 「늘 null」로 통과하지 않는지.
    expect(tabGap(geometry(3), 100, 0)).toBe(0);
  });

  // 끄는 칸의 양옆 틈은 제자리다 — 선을 세우면 「여기 놓인다」고 말해 놓고 아무 일도 없다.
  it("끄는 칸의 양옆 틈은 틈이 아니다", () => {
    expect(tabGap(geometry(1), 160, 0)).toBeNull(); // 틈 1
    expect(tabGap(geometry(1), 250, 0)).toBeNull(); // 틈 2
    expect(tabGap(geometry(1), 120, 0)).toBe(0);
    expect(tabGap(geometry(1), 330, 0)).toBe(3);
  });

  // 셸이 여덟이면 줄이 가로로 스크롤된다(결정 20). 기하는 끌기를 시작할 때 **내용 좌표**
  // (뷰포트 x + `scrollLeft`)로 한 번 재고, 움직일 때마다 그 순간의 `scrollLeft`를 더한다.
  it("가로 스크롤 오프셋이 더해져도 같은 답이다", () => {
    // 줄이 40만큼 스크롤돼 있으면 같은 칸이 뷰포트에서 40 왼쪽에 선다. 재는 순간에도
    // `뷰포트 x + scrollLeft`라 기하는 스크롤 0에서 잰 것과 같고(`TABS` 그대로), 같은 칸
    // 위의 포인터는 뷰포트 x가 40 작다 — 거기에 `scrollLeft`를 더하면 같은 틈이다.
    const g = geometry(-10);
    for (const [content, gap] of [[182, 1], [330, 3], [420, 4]] as const) {
      expect(tabGap(g, content, 0)).toBe(gap);
      expect(tabGap(g, content - 40, 40)).toBe(gap);
    }
    // 오프셋을 **안 더하면** 틀린 틈이 나오는 자리다 — 위가 우연히 같은 답이 아니었는지.
    expect(tabGap(g, 330 - 40, 0)).toBe(2);
    expect(tabGap(g, 420 - 40, 0)).toBe(3);
  });

  it("셸 칸이 없으면 틈도 없다", () => {
    expect(tabGap({ tabs: [], view: { left: 100, right: 100 }, from: 0 }, 100, 0)).toBeNull();
  });
});

// 틈 표시는 줄 안의 절대 위치 세로 선이다. 좌표는 **줄 내용의 원점**에서 잰다 — 스크롤 상자
// 안의 절대 위치는 내용과 함께 흐르므로 `scrollLeft`를 빼지 않는다.
describe("틈 선의 자리", () => {
  it("칸 사이면 간격 한가운데, 양 끝이면 줄 안쪽 끝이다", () => {
    const g = geometry(-10);
    // 틈 1: 180과 184 사이 가운데(182)에서 줄 원점(100)을 빼고 선 폭의 절반을 뺀다.
    expect(gapLineLeft(g, 1)).toBe(81.5);
    // 양 끝은 **줄 밖으로 안 나간다** — 나가면 스크롤 상자가 그만큼 넘쳐 스크롤을 얻는다.
    expect(gapLineLeft(g, 0)).toBe(0);
    expect(gapLineLeft(g, 4)).toBe(331);
  });
});
