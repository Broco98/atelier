import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useResizableWidth, {
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
});

// 순수 함수와 핸들을 따로 검사하면 **둘을 잇는 훅이 통째로 사각지대에 남는다.** 특히
// 기존 세 패널의 부호를 실제로 정하는 것은 훅의 side 기본값 하나인데, 그 값이 뒤집혀도
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
    // 사이드바·프로젝트 목록·아카이브 목록 세 곳이 정확히 이 호출 모양이다
    const markup = renderToStaticMarkup(<Panel />);
    expect(markup.match(/right-0/g)).toHaveLength(2);
    expect(markup).not.toMatch(/left-0/);
  });

  it("훅에 넘긴 side가 핸들 가장자리까지 도달한다", () => {
    const markup = renderToStaticMarkup(<Panel side="right" />);
    expect(markup.match(/left-0/g)).toHaveLength(2);
    expect(markup).not.toMatch(/right-0/);
  });
});
