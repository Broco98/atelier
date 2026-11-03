import { describe, expect, it } from "vitest";
import { frameGapReport, recordFrames } from "./frame-gaps";

describe("프레임 간격 보고", () => {
  it("가장 긴 간격과 문턱을 넘은 간격을 센다", () => {
    const report = frameGapReport([0, 16, 33, 100, 116, 176], 50);

    expect(report).toMatchObject({ frames: 6, maxGap: 67, overLimit: 2 });
    expect(report.worst[0]).toEqual({ at: 33, gap: 67, note: null });
  });

  it("문턱과 같은 간격은 넘은 것이 아니다", () => {
    expect(frameGapReport([0, 50], 50).overLimit).toBe(0);
  });

  it("긴 간격을 큰 차례로 몇 개만 남기고 그 프레임의 표지를 함께 싣는다", () => {
    const notes = ["a", "b", "c", "d", "e"];
    const report = frameGapReport([0, 10, 40, 100, 110], 50, { keep: 2, noteAt: (frame) => notes[frame] });

    expect(report.worst).toEqual([
      { at: 40, gap: 60, note: "c" },
      { at: 10, gap: 30, note: "b" },
    ]);
  });

  it("프레임이 둘 없으면 간격이 없다", () => {
    expect(frameGapReport([100], 50)).toMatchObject({ frames: 1, maxGap: 0, overLimit: 0, worst: [] });
  });

  it("보통 간격은 가운데 값이다 — 화면의 주사율을 말한다", () => {
    expect(frameGapReport([0, 16, 32, 48, 200], 50).medianGap).toBe(16);
  });
});

describe("프레임 기록", () => {
  it("프레임마다 때를 남기고, 멈추면 다음 프레임을 걸지 않는다", () => {
    const queued: FrameRequestCallback[] = [];
    const frames = recordFrames((callback) => queued.push(callback));

    queued.shift()?.(10);
    queued.shift()?.(26);
    frames.stop();
    queued.shift()?.(42);

    expect(frames.stamps()).toEqual([10, 26]);
    expect(queued).toEqual([]);
  });

  it("프레임마다 표지를 하나 읽어 함께 둔다", () => {
    const queued: FrameRequestCallback[] = [];
    let chars = 3;
    const frames = recordFrames((callback) => queued.push(callback), () => chars);

    queued.shift()?.(10);
    chars = 9;
    queued.shift()?.(26);

    expect(frames.notes()).toEqual([3, 9]);
  });
});
