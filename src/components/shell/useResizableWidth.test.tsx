import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useResizableWidth, {
  drawnWidth,
  nextWidth,
  ResizeHandle,
  type PanelSide,
  type ResizableWidth,
} from "./useResizableWidth";

// 부호가 뒤집혀도 화면은 멀쩡히 그려진다 — 잘못된 방향으로 움직일 뿐이다. 그리고 그
// 방향은 포인터 이벤트 없이는 볼 수 없어서, 계산을 순수 함수로 떼어낸 자리가 seam이 된다.
// side는 **패널이 놓인 쪽**이지 핸들이 붙는 가장자리가 아니다.

const base = { startX: 100, startWidth: 300, min: 260, max: 520 };

describe("nextWidth", () => {
  it("왼쪽 패널은 오른쪽으로 끈 만큼 넓어진다", () => {
    expect(nextWidth({ ...base, side: "left", clientX: 140 })).toBe(340);
    expect(nextWidth({ ...base, side: "left", clientX: 80 })).toBe(280);
  });

  it("오른쪽 패널은 왼쪽으로 끈 만큼 넓어진다", () => {
    expect(nextWidth({ ...base, side: "right", clientX: 60 })).toBe(340);
    expect(nextWidth({ ...base, side: "right", clientX: 130 })).toBe(270);
  });

  it("시작 폭과 시작 좌표를 각각 제 자리에서 읽는다", () => {
    // base의 startX·startWidth가 모든 단언에서 고정이면 둘을 혼동하거나 상수로 박은
    // 구현도 통과한다. 값을 통째로 다르게 준 케이스 하나가 그 구멍을 막는다.
    expect(nextWidth({ side: "left", startX: 700, startWidth: 410, clientX: 665, min: 260, max: 520 })).toBe(375);
    expect(nextWidth({ side: "right", startX: 700, startWidth: 410, clientX: 665, min: 260, max: 520 })).toBe(445);
  });

  it("폭은 언제나 정수다", () => {
    // 트랙패드·레티나에서 clientX가 분수로 들어온다. 그대로 두면 패널 폭이
    // `326.3828125px` 같은 값이 되고(실제로 저장돼 있던 값이다), 본문이 다시 배치될 때마다
    // 경계선이 장치 픽셀 격자에 다르게 얹혀 1px씩 떨린다. 끄는 감각은 정수로도 같다.
    expect(nextWidth({ ...base, side: "left", clientX: 140.6 })).toBe(341);
    expect(nextWidth({ ...base, side: "right", clientX: 60.4 })).toBe(340);
    expect(Number.isInteger(nextWidth({ ...base, side: "right", clientX: 137.3828125 }))).toBe(true);
  });

  it("최소·최대가 양쪽 부호에서 똑같이 걸린다", () => {
    expect(nextWidth({ ...base, side: "left", clientX: 1000 })).toBe(520);
    expect(nextWidth({ ...base, side: "left", clientX: -1000 })).toBe(260);
    expect(nextWidth({ ...base, side: "right", clientX: -1000 })).toBe(520);
    expect(nextWidth({ ...base, side: "right", clientX: 1000 })).toBe(260);
  });
});

function control(side: PanelSide): ResizableWidth {
  return {
    width: 300,
    min: 260,
    dragging: false,
    side,
    handleProps: {
      onPointerDown: () => {},
      onPointerMove: () => {},
      onPointerUp: () => {},
      onPointerCancel: () => {},
      onDoubleClick: () => {},
    },
  };
}

describe("ResizeHandle", () => {
  // 핸들과 심 라인이 반대쪽 가장자리에 붙으면 잡을 곳이 패널 건너편에 생긴다.
  // 부호가 맞아도 이건 따로 틀릴 수 있어 따로 본다.
  it("왼쪽 패널의 핸들과 심 라인은 오른쪽 가장자리에 붙는다", () => {
    const markup = renderToStaticMarkup(<ResizeHandle control={control("left")} />);
    expect(markup.match(/right-0/g)).toHaveLength(2);
    expect(markup).not.toMatch(/left-0/);
  });

  it("오른쪽 패널의 핸들과 심 라인은 왼쪽 가장자리에 붙는다", () => {
    const markup = renderToStaticMarkup(<ResizeHandle control={control("right")} />);
    expect(markup.match(/left-0/g)).toHaveLength(2);
    expect(markup).not.toMatch(/right-0/);
  });

  // 02a-2 — 카드 사이 틈(8)에 서는 손잡이(작업 패널 카드 왼쪽 틈). 손잡이가 틈 전부(`w-2` — 틈 토큰 `space-2`와 같은
  // 눈금)를 덮어 틈 어디를 짚어도 잡히고, 빛은 그 가운데다 — 카드 모서리에 붙이면 둥근 모서리를 따라 잘린 것처럼 보인다.
  it("틈 자리 손잡이는 틈 전부를 덮고 빛은 그 가운데다", () => {
    for (const [side, edge] of [
      ["right", "left-0"],
      ["left", "right-0"],
    ] as const) {
      const markup = renderToStaticMarkup(<ResizeHandle control={control(side)} seat="gap" />);
      const [handle, line] = [...markup.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(" "));
      expect(handle, side).toEqual(expect.arrayContaining([edge, "w-2"]));
      expect(handle, side).not.toContain("w-[5px]");
      expect(line, side).toEqual(expect.arrayContaining(["inset-x-0", "mx-auto"]));
      expect(markup, side).toContain('data-seat="gap"');
    }
  });
});

// 끌기는 **그려진 폭에서 출발한다**(좁게 선 패널에서 안 튀게 — `useResizableWidth`의 `onPointerDown`). 틈 자리 손잡이의 부모는 「틈 +
// 카드」 상자라 그 폭에서 틈을 빼야 카드의 폭(저장하는 폭)이다 — 빼지 않으면 첫 움직임에 손잡이가 틈만큼 튄다. 틈은 토큰 `--space-2`에서
// 읽는다. 가장자리 · 세로 선 자리의 부모는 칸 그 자체라 뺄 것이 없다.
describe("drawnWidth", () => {
  const handle = (seat: string, parent: number) =>
    ({ dataset: { seat }, parentElement: { getBoundingClientRect: () => ({ width: parent }) } }) as unknown as HTMLElement;
  beforeEach(() => {
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: (name: string) => (name === "--space-2" ? " 8px" : "") }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("틈 자리면 부모 폭에서 틈을 뺀 카드의 폭이고, 가장자리 · 세로 선 자리면 부모 폭 그대로다", () => {
    expect(drawnWidth(handle("gap", 348))).toBe(340);
    expect(drawnWidth(handle("edge", 348))).toBe(348);
    expect(drawnWidth(handle("rule", 264))).toBe(264);
  });
});

// 순수 함수와 핸들을 따로 검사하면 **둘을 잇는 훅이 통째로 사각지대에 남는다.** 특히
// 사이드바의 부호를 실제로 정하는 것은 훅의 side 기본값 하나인데, 그 값이 뒤집혀도
// 위 검사들은 전부 초록이다. 그래서 훅을 진짜로 렌더한다 —
// 초기 폭을 localStorage에서 읽으므로 node 환경에 그것만 세워 준다.
function Panel({ side }: { side?: PanelSide }) {
  const size = useResizableWidth("probe-width", 300, 260, 520, side);
  return <ResizeHandle control={size} />;
}

describe("useResizableWidth가 핸들까지 잇는 배선", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("side를 넘기지 않은 패널은 왼쪽 패널이라 핸들이 오른쪽 가장자리에 붙는다", () => {
    // 사이드바가 정확히 이 호출 모양이다
    const markup = renderToStaticMarkup(<Panel />);
    expect(markup.match(/right-0/g)).toHaveLength(2);
    expect(markup).not.toMatch(/left-0/);
  });

  it("훅에 넘긴 side가 핸들 가장자리까지 도달한다", () => {
    // 오른쪽 패널(작업 패널 · Archive의 spec 목록 패널)과 목록 칸(프로젝트 · 아카이브 목록)이 이 호출 모양이다
    const markup = renderToStaticMarkup(<Panel side="right" />);
    expect(markup.match(/left-0/g)).toHaveLength(2);
    expect(markup).not.toMatch(/right-0/);
  });
});
