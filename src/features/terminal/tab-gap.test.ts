import { describe, expect, it } from "vitest";
import { gapLineLeft, sidewaysIntent, stripEdgeStep, tabGap } from "./tab-gap";
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

// **끄는 동안 줄 가장자리에 붙으면 줄이 따라 구른다.** 900px 창에 작업 패널이 열리면 셸 칸 상자가 칸
// 하나(44px) 폭이라, 보이는 칸은 끄는 그 칸뿐이고 그 양옆 틈은 제자리다 — 구르지 않으면 어느 틈에도
// 못 놓는다. 행 목록의 가장자리 스크롤(`row-drop`의 `edgeScrollStep`)과 같은 수를 가로로 쓴다.
describe("줄 가장자리의 자동 스크롤", () => {
  const wide = { left: 100, right: 432 };
  it.each([
    ["가운데", 266, 0],
    ["오른쪽 띠 바로 밖", 404, 0],
    ["오른쪽 띠 안", 420, 6],
    ["오른쪽 끝 픽셀", 431, 10],
    ["오른쪽 밖(`+`·조작 위)", 500, 10],
    ["왼쪽 끝 픽셀", 101, -10],
    ["왼쪽 밖(`spec` 위)", 60, -10],
  ] as const)("넓은 줄의 %s(x %i) → %i", (_, x, step) => {
    expect(stripEdgeStep(wide, x)).toBe(step);
  });

  // 칸 하나 폭의 상자에서는 띠 둘이 겹치면 늘 구른다 — 띠가 상자의 절반까지만 온다.
  it("칸 하나 폭의 상자에서도 한가운데는 가만히 있다", () => {
    const narrow = { left: 100, right: 144 };
    expect(stripEdgeStep(narrow, 122)).toBe(0);
    expect(stripEdgeStep(narrow, 140)).toBe(9);
    expect(stripEdgeStep(narrow, 104)).toBe(-9);
  });

  it("상자가 없으면(칸이 없는 줄) 안 구른다", () => {
    expect(stripEdgeStep({ left: 100, right: 100 }, 100)).toBe(0);
    expect(stripEdgeStep({ left: 100, right: 100 }, 400)).toBe(0);
  });
});

// **줄이 구르는 것은 옆으로 끌 뜻이 보인 뒤다.** 칸 하나 폭 상자는 한가운데 한 픽셀 말고는 전부 띠라,
// 본문 절반으로 가려고 칸을 누른 채 곧장 아래로 내리면 머리행을 벗어나기 전 몇 프레임 동안 줄이 굴러
// 누른 칸이 옆으로 밀린다. 문턱(5px)은 방향을 안 보므로 여기서 방향을 따로 본다.
describe("옆으로 끌 뜻", () => {
  const from = { x: 120, y: 200 };
  it.each([
    ["곧장 아래로 문턱을 넘음", { x: 120, y: 212 }, false],
    ["아래로 가며 조금 흔들림", { x: 125, y: 214 }, false],
    ["옆으로 조금만(데드존 안)", { x: 127, y: 200 }, false],
    ["옆으로 데드존만큼", { x: 128, y: 200 }, true],
    ["왼쪽으로 데드존 너머", { x: 100, y: 203 }, true],
    ["대각선 — 세로가 가로만큼", { x: 132, y: 212 }, false],
    ["가로가 세로보다 크다", { x: 133, y: 212 }, true],
  ] as const)("%s → %s", (_, now, intent) => {
    expect(sidewaysIntent(from, now)).toBe(intent);
  });
});
