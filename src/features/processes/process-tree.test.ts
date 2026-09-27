import { describe, expect, it } from "vitest";
import { exceptionName, processLabel, processRowLabel, processTree, strayTree, subtreeAt } from "./process-tree";
import type { ProcessNode } from "./process-tree";
import { metricsOf as 지표, processRow } from "./process-fixture";
import type { ProcessRow } from "./types";

// 프로세스 티켓 27 · 31 — **프로세스 한 줄의 규칙**(프로세스 스펙 S53 · S54 · S58 · 기본값 [끝내기]). 셸의 자손, 확정 고아 · 출처 불명,
// 다른 인스턴스, 예외가 모두 같은 규칙으로 선다: 트리로 펴는 차례, 줄의 이름과 접근성 이름, [끝내기]가 넘길 신원. 순수 함수다 — 셸 밑에서
// 어느 깊이에 서는지는 `shell-tree.test.ts`, 실행마다 묶기는 `process-groups.test.ts`가 잰다.

const MiB = 1024 * 1024;

/** 스냅샷의 한 행 — 이름은 pid에서 짓는다(`p<pid>`). 이름을 보는 검사가 덮어쓴다. */
const 행 = (pid: number, ppid: number, startedUs: number, over: Partial<ProcessRow> = {}): ProcessRow =>
  processRow(pid, ppid, startedUs, `p${pid}`, over);

/** 편 줄마다 (pid, 깊이). */
const 펼침 = (nodes: ReadonlyArray<ProcessNode>) => nodes.map(({ row, depth }) => [row.id.pid, depth]);

describe("트리로 펴기 — 시작 순, 부모 pid로 들여쓰기", () => {
  // 판정은 pid 순으로 싣는다. 화면은 **시작 순**이다(S53) — pid는 돌고 돌아 작아질 수 있어 뜬 차례를 말하지 않는다.
  it("형제는 시작 순이다 — pid 순이 아니다", () => {
    expect(펼침(processTree([행(100, 1, 30), 행(200, 1, 10), 행(300, 1, 20)]))).toEqual([
      [200, 1],
      [300, 1],
      [100, 1],
    ]);
  });

  // 부모 행이 묶음에 있으면 그 밑에 한 칸 들여 서고, 깊이 우선으로 편다. 부모 행이 묶음에 없으면 맨 위다.
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

  // pid 재사용. 부모 행이 자식보다 늦게 태어났으면 그 pid는 남이다 — 판정이 같은 규칙으로 링크를 끊는다(`verdict.rs`). 끊지 않으면
  // 먼저 뜬 것이 나중에 뜬 것의 밑에 서고, 고리가 생기면 트리가 끝나지 않는다.
  it("부모 pid가 같아도 부모가 나중에 태어났으면 그 밑에 안 선다", () => {
    expect(펼침(processTree([행(200, 300, 10), 행(300, 1, 20)]))).toEqual([
      [200, 1],
      [300, 1],
    ]);
  });

  // 고아 · 출처 불명은 판정이 셸 키마다 가른다 — 화면은 키를 안 보인다(사람이 읽을 뜻이 없다). 키를 넘어 한 트리로 편다.
  it("셸 키마다 갈린 고아 묶음을 한 트리로 편다", () => {
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

describe("줄의 이름", () => {
  // 프로세스 줄은 부른 이름이다 — 커널 이름은 실제로 실행된 파일이라 심링크로 부른 것(`claude` → 버전 경로)이 다른 이름이 된다. 부른
  // 이름을 못 읽은 행(env를 못 읽었다)은 커널 이름이다.
  it("부른 이름의 마지막 조각이고, 없으면 커널 이름이다", () => {
    expect(processLabel(행(1, 0, 0, { name: "2.1.3", argv0: "/Users/me/.local/bin/claude" }))).toBe("claude");
    expect(processLabel(행(1, 0, 0, { name: "node", argv0: "node" }))).toBe("node");
    expect(processLabel(행(1, 0, 0, { name: "esbuild" }))).toBe("esbuild");
  });

  // 접근성 이름은 부른 이름과 그 프로세스의 메모리다 — 셸 행과 같은 모양(이름, …, 메모리)이라 줄마다 같은 자리에서 숫자가 읽힌다.
  it("접근성 이름은 부른 이름과 메모리를 잇고, 메모리를 못 읽었으면 이름만이다", () => {
    expect(processRowLabel(행(1, 0, 0, { name: "node", argv0: "node", metrics: 지표(320 * MiB, 3, [5173]) }))).toBe(
      "node, 320MB",
    );
    expect(processRowLabel(행(1, 0, 0, { name: "esbuild" }))).toBe("esbuild");
  });

  // 예외 목록은 커널 이름이나 부른 이름으로 건다(`processes/exceptions.rs`의 `caught`). 행이 보인 이름(부른 이름 → 없으면 커널 이름)을
  // 더한다 — 사람이 화면에서 본 그 글자다.
  it("「예외로 두기」가 더할 이름은 부른 이름(argv[0]의 마지막 조각)이고, 없으면 커널 이름이다", () => {
    expect(exceptionName(행(1, 1, 1, { name: "node", argv0: "/opt/homebrew/bin/pnpm" }))).toBe("pnpm");
    expect(exceptionName(행(1, 1, 1, { name: "esbuild", argv0: null }))).toBe("esbuild");
  });
});
