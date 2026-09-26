import { describe, expect, it } from "vitest";
import { formatMemory } from "./metrics";
import {
  buildLabel,
  endAsk,
  exceptionName,
  instanceGroups,
  instanceRowLabel,
  strayTree,
  subtreeAt,
  tidyUnknownAsk,
} from "./process-groups";
import { processTree } from "./shell-tree";
import type { OtherInstance, ProcessRow, ProcessSnapshot } from "./types";

// 프로세스 티켓 31 — **고아 · 다른 인스턴스 · 예외 묶음을 짓는 규칙**(프로세스 결정 5 · 6 · 10 · 프로세스 스펙 S54 · 기본값 [끝내기]).
// 판정이 가른 묶음(셸 키마다)을 화면이 트리로 펴고, 다른 인스턴스를 실행마다 묶고, [끝내기] · [정리]가 넘길 신원과 확인 창의 말을
// 짓는다. 순수 함수다 — 화면이 진짜 폴러 · 확인 창 · IPC를 지나 서는지는 L3가 잰다(`processes-strays.spec.ts`).

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
});

const 펼침 = (nodes: ReturnType<typeof processTree>) => nodes.map(({ row, depth }) => [row.id.pid, depth]);

describe("프로세스 트리", () => {
  // 셸의 자손 트리와 같은 규칙이다(`shellNode`) — 형제는 시작 순이고, 부모 pid로 들여쓰고, 부모가 자식보다 늦게 태어났으면 그 pid는
  // 재사용된 남이라 잇지 않는다.
  it("부모 pid로 들여쓰고 형제는 시작 순이며, 자식보다 늦게 태어난 부모에는 잇지 않는다", () => {
    const rows = [행(30, 1, 300), 행(10, 1, 100), 행(11, 10, 110), 행(12, 11, 120), 행(40, 50, 90), 행(50, 1, 500)];
    expect(펼침(processTree(rows))).toEqual([
      [40, 1],
      [10, 1],
      [11, 2],
      [12, 3],
      [30, 1],
      [50, 1],
    ]);
  });

  // 고아 · 출처 불명은 판정이 셸 키마다 가른다 — 화면은 키를 안 보인다(사람이 읽을 뜻이 없다). 키를 넘어 한 트리로 편다.
  it("셸 키마다 갈린 묶음을 한 트리로 편다", () => {
    const tree = strayTree({ "OLD-3": [행(400, 1, 4_000), 행(410, 400, 4_100)], "OLD-5": [행(450, 1, 4_500)] });
    expect(펼침(tree)).toEqual([
      [400, 1],
      [410, 2],
      [450, 1],
    ]);
  });
});

describe("[끝내기]가 넘길 신원", () => {
  // 기본값 [끝내기] — 「그 프로세스와 그 PID 트리」. 깊이 우선으로 편 줄에서 그 줄 뒤로 더 깊은 줄이 이어지는 데까지가 그 트리다.
  it("그 줄과 그 밑의 줄들이고, 같은 깊이의 형제에서 멈춘다", () => {
    const tree = processTree([행(10, 1, 100), 행(11, 10, 110), 행(12, 11, 120), 행(13, 10, 130), 행(20, 1, 200)]);
    expect(subtreeAt(tree, 0).map((id) => id.pid)).toEqual([10, 11, 12, 13]);
    expect(subtreeAt(tree, 1).map((id) => id.pid)).toEqual([11, 12]);
    expect(subtreeAt(tree, 4).map((id) => id.pid)).toEqual([20]);
  });

  // 넘기는 것은 **화면에 보인 표본의 신원**이다 — pid만이 아니라 시작 시각까지(끝내기가 신호 직전에 둘을 함께 본다).
  it("신원은 표본의 (pid, 시작 시각) 그대로다", () => {
    const tree = processTree([행(10, 1, 123_456)]);
    expect(subtreeAt(tree, 0)).toEqual([{ pid: 10, startedUs: 123_456 }]);
  });
});

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

describe("「예외로 두기」가 더할 이름", () => {
  // 예외 목록은 커널 이름이나 부른 이름으로 건다(`processes/exceptions.rs`의 `caught`). 행이 보인 이름(부른 이름 → 없으면 커널 이름)을
  // 더한다 — 사람이 화면에서 본 그 글자다.
  it("부른 이름(argv[0]의 마지막 조각)이고, 없으면 커널 이름이다", () => {
    expect(exceptionName(행(1, 1, 1, { name: "node", argv0: "/opt/homebrew/bin/pnpm" }))).toBe("pnpm");
    expect(exceptionName(행(1, 1, 1, { name: "esbuild", argv0: null }))).toBe("esbuild");
  });
});
