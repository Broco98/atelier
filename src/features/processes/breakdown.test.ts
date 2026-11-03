import { describe, expect, it } from "vitest";
import { activityMonitorTip, foldApps, OTHER_APPS, OTHER_PROCESSES, otherAppRows, systemNote, totalNote } from "./breakdown";
import { breakdownOf, macOf, otherAppOf, snapshotFixture } from "./process-fixture";

// restart 03-6 — **줄을 더하면 합계가 된다.** 합이 맞는지는 Rust가 잰다(`processes::breakdown`). 여기서 재는 것은 화면이 받은 나눔을 어떤
// 줄과 말로 세우는가다: 다른 앱의 줄(보기만 한다), 시스템 · 못 읽음과 합계 칸의 말, 포인터를 올리면 뜨는 활성 상태 보기 눈금.

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

describe("다른 앱의 줄", () => {
  // **CPU를 많이 쓰는 앱이 위다**(「지금 무엇이 내 컴퓨터를 먹나」). 못 잰 줄(첫 표본)은 아래이고, 같으면 메모리가 큰 것이 위다. 번들 밖의
  // 프로세스를 모은 줄은 늘 맨 끝이고 「그 밖의 프로세스」다. 줄마다 프로세스 수가 붙는다.
  it("CPU 순으로 서고 번들 밖의 줄이 맨 끝이다", () => {
    const sheet = snapshotFixture({
      breakdown: breakdownOf({
        apps: [
          otherAppOf("Chatter", 5, 620 * MiB, 1.7),
          otherAppOf("Notebook", 4, 1430 * MiB, null),
          otherAppOf("Shelf", 1, 40 * MiB, 1.7),
          otherAppOf("Sketchpad", 41, 2 * GiB, 9.1),
          otherAppOf(null, 120, GiB, 12.0),
        ],
      }),
    });
    expect(otherAppRows(sheet).map((row) => [row.name, row.note, row.metrics.cpu])).toEqual([
      ["Sketchpad", "프로세스 41개", 9.1],
      ["Chatter", "프로세스 5개", 1.7],
      ["Shelf", "프로세스 1개", 1.7],
      ["Notebook", "프로세스 4개", null],
      [OTHER_PROCESSES, "프로세스 120개", 12.0],
    ]);
  });

  // **메모리 순 보기에서는 메모리가 큰 앱이 위다**(restart 03-11) — 번들 밖의 줄은 그래도 맨 끝이다.
  it("메모리 순으로도 선다", () => {
    const sheet = snapshotFixture({
      breakdown: breakdownOf({
        apps: [otherAppOf("Chatter", 5, 620 * MiB, 1.7), otherAppOf("Sketchpad", 41, 2 * GiB, 9.1), otherAppOf("Notebook", 4, 1430 * MiB, null), otherAppOf(null, 120, 3 * GiB, 1.0)],
      }),
    });
    expect(otherAppRows(sheet, "memory").map((row) => row.name)).toEqual(["Sketchpad", "Notebook", "Chatter", OTHER_PROCESSES]);
  });

  // **앞의 셋만 이름으로 서고 나머지 앱은 「그 밖의 앱」 한 줄이다**(restart 03-11 · 시안 Processes 「그 밖의 앱 14개」) — 이 맥에서 앱
  // 번들이 70개 가까이라 줄마다 세우면 표가 다른 앱으로 덮인다. 그 줄은 숨긴 앱들의 합이라 줄을 더하면 그대로 합계다. 번들 밖의 줄은 앱이
  // 아니라 따로 맨 끝이다. 넷 이하면 접지 않는다 — 한 줄을 「그 밖의 앱 1개」로 바꾸면 읽을 것만 늘어난다.
  it("앞의 셋 뒤의 앱을 「그 밖의 앱」 한 줄로 더한다", () => {
    const sheet = snapshotFixture({
      breakdown: breakdownOf({
        apps: [
          otherAppOf("A", 2, 400 * MiB, 9.0),
          otherAppOf("B", 2, 300 * MiB, 4.0),
          otherAppOf("C", 2, 200 * MiB, 2.0),
          otherAppOf("D", 3, 100 * MiB, 1.0),
          otherAppOf("E", 1, 50 * MiB, null),
          otherAppOf(null, 120, GiB, 0.5),
        ],
      }),
    });
    const rows = foldApps(otherAppRows(sheet), 3);
    expect(rows.map((row) => [row.name, row.note, row.metrics.memory, row.metrics.cpu])).toEqual([
      ["A", "프로세스 2개", 400 * MiB, 9.0],
      ["B", "프로세스 2개", 300 * MiB, 4.0],
      ["C", "프로세스 2개", 200 * MiB, 2.0],
      [OTHER_APPS, "2개", 150 * MiB, 1.0],
      [OTHER_PROCESSES, "프로세스 120개", GiB, 0.5],
    ]);
    expect(foldApps(otherAppRows(sheet).slice(0, 4), 3).map((row) => row.name)).toEqual(["A", "B", "C", "D"]);
  });

  // 숫자 칸은 다른 줄과 같은 지표 모양이다 — 포트는 없다(다른 앱은 fd를 안 훑는다).
  it("줄의 숫자는 메모리 · CPU이고 포트가 없다", () => {
    const sheet = snapshotFixture({ breakdown: breakdownOf({ apps: [otherAppOf("Sketchpad", 2, 300 * MiB, 4.5)] }) });
    expect(otherAppRows(sheet)[0].metrics).toEqual({ memory: 300 * MiB, cpu: 4.5, ports: [] });
  });
});

describe("시스템 · 못 읽음과 합계 칸의 말", () => {
  const 잰장 = snapshotFixture({
    mac: macOf(20, 8 * GiB),
    breakdown: breakdownOf({ system: { cpu: 6, memory: 3 * GiB }, total: { cpu: 20, memory: 8 * GiB } }),
  });

  // 평소의 합계는 맥 전체 측정값이고, 시스템 · 못 읽음은 측정값에서 읽은 것을 뺀 몫이다(시안 Processes).
  it("평소에는 합계가 맥 전체 측정값이다", () => {
    expect(totalNote(잰장)).toBe("맥 전체 측정값과 같아요");
    expect(systemNote(잰장)).toBe("측정값에서 읽은 것을 뺀 몫");
  });

  // **읽은 합이 측정값을 넘는 표본**(스펙 「합이 맞는다」) — 합계 칸의 말이 「이 표본은 읽은 값의 합이에요」다. CPU든 메모리든 한 칸이
  // 넘으면 그 장의 합계는 읽은 합이 섞였다.
  it("읽은 합이 넘은 표본은 그렇다고 말한다", () => {
    for (const over of [
      { cpu: true, memory: false },
      { cpu: false, memory: true },
    ]) {
      const sheet = snapshotFixture({ mac: macOf(20, 8 * GiB), breakdown: breakdownOf({ over }) });
      expect(totalNote(sheet)).toBe("이 표본은 읽은 값의 합이에요");
      expect(systemNote(sheet)).toBe("이 표본은 읽은 합이 측정값을 넘어 0이에요");
    }
  });

  // macOS 밖은 맥 전체를 재지 않는다 — 측정값이 없으니 뺄 것도 없다(스펙 「Out of Scope」).
  it("맥 전체가 없으면 「측정 안 됨」이다", () => {
    expect(totalNote(snapshotFixture())).toBe("측정 안 됨");
    expect(systemNote(snapshotFixture())).toBe("측정 안 됨");
  });
});

describe("활성 상태 보기 눈금(스토리 125)", () => {
  // **포인터를 올리면 활성 상태 보기 눈금이 뜬다** — 화면의 눈금(맥 전체 = 100)에 코어 수를 곱한 것이다(시안 ProcessSheet 「CPU 눈금」 —
  // 코어 열 개에서 10%는 100%). 정수로 적는다.
  it("맥 전체 눈금에 코어 수를 곱한다", () => {
    expect(activityMonitorTip(10, 10)).toBe("활성 상태 보기 눈금으로 100%");
    expect(activityMonitorTip(30, 10)).toBe("활성 상태 보기 눈금으로 300%");
    expect(activityMonitorTip(0.26, 12)).toBe("활성 상태 보기 눈금으로 3%");
  });

  // CPU를 못 잰 줄은 왜 숫자가 없는지 말한다(시안 Processes의 툴팁).
  it("못 잰 CPU는 첫 표본이라고 말한다", () => {
    expect(activityMonitorTip(null, 10)).toBe("첫 표본이라 CPU를 아직 못 쟀어요");
  });
});
