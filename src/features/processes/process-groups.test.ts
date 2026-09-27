import { describe, expect, it } from "vitest";
import { formatMemory } from "./metrics";
import { buildLabel, endAsk, instanceGroups, instanceRowLabel, tidyUnknownAsk } from "./process-groups";
import type { ProcessNode } from "./process-tree";
import type { OtherInstance, ProcessRow, ProcessSnapshot } from "./types";

// 프로세스 티켓 31 — **다른 인스턴스 묶음과 확인 창의 말**(프로세스 결정 5 · 6 · 10 · 프로세스 스펙 S54 · 기본값 [끝내기]). 다른
// 인스턴스를 실행마다 묶고, [끝내기] · [정리]가 띄울 확인 창의 말을 짓는다. 순수 함수다 — 묶음을 트리로 펴는 것과 넘길 신원은
// `process-tree.test.ts`가, 화면이 진짜 폴러 · 확인 창 · IPC를 지나 서는지는 L3가 잰다(`processes-strays.spec.ts`).

const MiB = 1024 * 1024;

const 행 = (pid: number, ppid: number, startedUs: number, over: Partial<ProcessRow> = {}): ProcessRow => ({
  id: { pid, startedUs },
  ppid,
  name: `p${pid}`,
  argv0: null,
  command: null,
  metrics: { memory: null, cpu: null, ports: [] },
  ...over,
});

const 스냅샷 = (otherInstances: Record<string, ProcessRow[]>, instances: OtherInstance[]): ProcessSnapshot => ({
  verdict: {
    descendants: {},
    exceptions: [],
    helpers: [],
    orphans: { confirmed: {}, unknown: {} },
    otherInstances,
  },
  pool: [],
  instances,
  recordHead: null,
});

const 펼침 = (nodes: ReadonlyArray<ProcessNode>) => nodes.map(({ row, depth }) => [row.id.pid, depth]);

describe("확인 창의 말", () => {
  it("[끝내기] — 하나면 그것만, 밑에 뜬 것이 있으면 그 수를 든다", () => {
    expect(endAsk("node", 1)).toEqual({ title: "'node' 끝내기", body: "이 프로세스를 끝내요.", confirm: "끝내기" });
    expect(endAsk("node", 3)).toEqual({
      title: "'node' 끝내기",
      body: "이 프로세스와 그 밑에서 뜬 프로세스 2개를 끝내요.",
      confirm: "끝내기",
    });
  });

  // 결정 6 — 출처 불명은 따로 확인 창을 거친다. 수는 그 묶음의 행 전부(키를 넘어)다.
  it("출처 불명 [정리] — 「출처를 모르는 프로세스 N개를 끝내요」", () => {
    expect(tidyUnknownAsk(2)).toEqual({
      title: "출처 불명 정리",
      body: "출처를 모르는 프로세스 2개를 끝내요.",
      confirm: "끝내기",
    });
  });
});

describe("다른 인스턴스", () => {
  // S54 — 실행마다 빌드 종류와 버전. 결정 10 그림의 「다른 인스턴스 (dev 빌드)」다. 기록을 못 읽은 실행은 모른다고 말한다.
  it("빌드 이름은 dev 빌드 · 설치본이고 버전이 붙는다", () => {
    expect(buildLabel({ build: "dev", version: "0.15.0" })).toBe("dev 빌드 · v0.15.0");
    expect(buildLabel({ build: "release", version: "0.14.1" })).toBe("설치본 · v0.14.1");
    expect(buildLabel({ build: null, version: null })).toBe("빌드 모름");
  });

  // 실행은 백엔드가 준 차례(세대 순)로 서고, 그 실행의 셸 키가 낸 행이 한 트리로 선다. 어느 실행에도 안 묶인 키(그새 기록이
  // 지워졌다)의 행도 숨기지 않는다 — 「빌드 모름」 실행 하나로 끝에 선다.
  it("실행마다 그 셸 키들의 행을 한 트리로 묶고, 안 묶인 키는 끝에 모른다고 선다", () => {
    const snapshot = 스냅샷(
      {
        "H-1": [행(600, 1, 6_000)],
        "H-2": [행(610, 1, 6_100), 행(611, 610, 6_110)],
        "R-1": [행(650, 1, 6_500)],
        "Z-9": [행(690, 1, 6_900)],
      },
      [
        { generation: "H", build: "dev", version: "0.15.0", shellKeys: ["H-1", "H-2"] },
        { generation: "R", build: "release", version: "0.14.1", shellKeys: ["R-1"] },
      ],
    );
    expect(instanceGroups(snapshot).map((group) => [group.label, 펼침(group.nodes)])).toEqual([
      [
        "dev 빌드 · v0.15.0",
        [
          [600, 1],
          [610, 1],
          [611, 2],
        ],
      ],
      ["설치본 · v0.14.1", [[650, 1]]],
      ["빌드 모름", [[690, 1]]],
    ]);
  });

  // 실행 줄의 숫자는 그 실행의 행을 더한 것이다(셸 행 · work 행과 같은 `sumMetrics`). 접근성 이름은 「빌드, 수, 메모리」 한 문장이다.
  it("실행 줄은 그 행들의 합이고, 접근성 이름이 한 문장이다", () => {
    const snapshot = 스냅샷(
      {
        "H-1": [
          행(600, 1, 6_000, { metrics: { memory: 4 * MiB, cpu: 1, ports: [5173] } }),
          행(601, 600, 6_010, { metrics: { memory: 200 * MiB, cpu: 2, ports: [] } }),
        ],
      },
      [{ generation: "H", build: "dev", version: "0.15.0", shellKeys: ["H-1"] }],
    );
    const [group] = instanceGroups(snapshot);
    expect(group.totals).toEqual({ memory: 204 * MiB, cpu: 3, ports: [5173] });
    expect(instanceRowLabel(group)).toBe(`dev 빌드 · v0.15.0, 프로세스 2개, ${formatMemory(204 * MiB)}`);
  });
});
