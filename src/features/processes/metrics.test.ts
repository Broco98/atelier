import { describe, expect, it } from "vitest";
import { NOT_READ, formatCpu, formatMemory, formatPorts, sumMetrics } from "./metrics";
import { metricsOf as 지표 } from "./process-fixture";

// 프로세스 티켓 28 — **지표를 글자로**(프로세스 스펙 S40 · S37 · S38). 행의 숫자 칸 · 트리 합 · 접근성 이름, 그리고 29의 nav 메타와 31의
// 행이 모두 이 함수를 읽는다 — 같은 숫자가 자리마다 다른 모양으로 서지 않게 표기가 한 자리에 산다. 화면에 선 글자가 이 결과와
// 같은지는 L3가 잰다(`processes-metrics.spec.ts`).

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

describe("메모리 표기(S40) — 1GB 이상은 소수 한 자리 GB, 그 아래는 MB 정수", () => {
  it("1GB 아래는 MB 정수다 — 반올림한다", () => {
    expect(formatMemory(0)).toBe("0MB");
    expect(formatMemory(12.4 * MiB)).toBe("12MB");
    expect(formatMemory(12.6 * MiB)).toBe("13MB");
    expect(formatMemory(320 * MiB)).toBe("320MB");
    expect(formatMemory(1023.4 * MiB)).toBe("1023MB");
  });

  it("1GB 이상은 소수 한 자리 GB다", () => {
    expect(formatMemory(GiB)).toBe("1.0GB");
    expect(formatMemory(1.2 * GiB)).toBe("1.2GB");
    expect(formatMemory(3.44 * GiB)).toBe("3.4GB");
    expect(formatMemory(12.36 * GiB)).toBe("12.4GB");
  });

  it("경계 — MB로 반올림해 1024가 되는 값은 GB로 선다(「1024MB」가 서지 않는다)", () => {
    expect(formatMemory(GiB - 1)).toBe("1.0GB");
    expect(formatMemory(1023.6 * MiB)).toBe("1.0GB");
  });

  it("단위는 1024다 — 활성 상태 보기의 「메모리」 열과 같은 눈금", () => {
    expect(formatMemory(1_000_000_000)).toBe("954MB");
  });

  it("못 읽었으면 「—」다", () => {
    expect(formatMemory(null)).toBe(NOT_READ);
    expect(NOT_READ).toBe("—");
  });
});

describe("CPU 표기(S37) — 정수 %, 첫 표본은 「—」", () => {
  it("반올림한 정수 %다. 여러 코어를 쓰면 100을 넘는다", () => {
    expect(formatCpu(0)).toBe("0%");
    expect(formatCpu(0.4)).toBe("0%");
    expect(formatCpu(12.5)).toBe("13%");
    expect(formatCpu(250)).toBe("250%");
  });

  it("첫 표본이거나 못 읽었으면 「—」다", () => {
    expect(formatCpu(null)).toBe(NOT_READ);
  });
});

describe("포트 표기(S38)", () => {
  it("포트마다 「:」를 붙여 받은 차례로 잇는다. 없으면 빈 글자다", () => {
    expect(formatPorts([])).toBe("");
    expect(formatPorts([5173])).toBe(":5173");
    expect(formatPorts([3000, 5173])).toBe(":3000 · :5173");
  });
});

describe("트리 합 — 셸 행 · work 행의 숫자", () => {
  it("메모리와 CPU는 읽은 것끼리 더하고, 포트는 합쳐 오름차순 · 겹침 없이 둔다", () => {
    expect(sumMetrics([지표(10 * MiB, 1, [5173]), 지표(20 * MiB, 2.5, [3000, 5173]), 지표(null, null, [8080])])).toEqual(
      지표(30 * MiB, 3.5, [3000, 5173, 8080]),
    );
  });

  it("아무것도 못 읽었으면 비었다 — 0이 아니다(「0MB」는 모르는 것을 없다고 한다)", () => {
    expect(sumMetrics([지표(null), 지표(null)])).toEqual(지표(null));
    expect(sumMetrics([])).toEqual(지표(null));
  });

  it("첫 표본에서는 모든 행의 CPU가 비어 합도 비었다. 새로 뜬 하나만 비었으면 나머지의 합이다", () => {
    expect(sumMetrics([지표(MiB, null), 지표(MiB, null)]).cpu).toBeNull();
    expect(sumMetrics([지표(MiB, 4), 지표(MiB, null)]).cpu).toBe(4);
  });
});
