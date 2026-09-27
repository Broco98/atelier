import type { ProcessMetrics } from "./types";

// **지표를 글자로 — 표기가 사는 자리가 여기 하나다**(프로세스 스펙 S40 · S37 · S38 · 티켓 28). `Processes`의 행 칸, 트리 합, 행의
// 접근성 이름, 그리고 29의 nav 메타와 31의 묶음 행이 모두 이 함수를 읽는다 — 같은 숫자가 자리마다 다른 모양(「1.2GB」와 「1229MB」)으로
// 서지 않게. 순수 함수다.

/**
 * 못 읽은 값의 글자 — 첫 표본의 CPU, macOS 밖, 그사이 끝난 프로세스. 「0」은 쟀는데 없었다는 말이라 모르는 것에 쓰지 않는다.
 * `UNKNOWN`으로 부르지 않는다 — 이 화면에서 unknown은 「출처 불명」(요약 카드의 `counts.unknown`)이라, 「—」와 한 줄에 서면 거꾸로
 * 읽힌다.
 */
export const NOT_READ = "—";

const MiB = 1024 * 1024;
const MiB_PER_GiB = 1024;

/**
 * 메모리(바이트) — **1GB 이상은 소수 한 자리 GB, 그 아래는 MB 정수**(S40 — nav 메타의 폭에 맞춘 모양). 단위는 1024다: 활성 상태 보기의
 * 「메모리」 열과 같은 눈금이라, 사람이 둘을 나란히 놓고 볼 수 있다.
 *
 * **경계는 반올림한 MB로 가른다.** 1GB에 조금 못 미치는 값을 MB로 반올림하면 「1024MB」가 되는데, 그 글자는 S40이 GB로 적기로 한
 * 크기다 — 그때부터 GB로 선다.
 */
export function formatMemory(bytes: number | null): string {
  if (bytes === null) return NOT_READ;
  const mb = Math.round(bytes / MiB);
  if (mb < MiB_PER_GiB) return `${mb}MB`;
  return `${(bytes / (MiB * MiB_PER_GiB)).toFixed(1)}GB`;
}

/**
 * CPU% — 반올림한 정수 %다. 한 코어를 다 쓰면 100이고 여러 코어를 쓰면 넘는다(백엔드가 활성 상태 보기의 「% CPU」와 같은 눈금으로
 * 준다). 두 표본의 차이라 **첫 표본은 없다** — 「—」로 선다(S37).
 */
export function formatCpu(percent: number | null): string {
  if (percent === null) return NOT_READ;
  return `${Math.round(percent)}%`;
}

/** LISTEN 포트 — 받은 차례(백엔드가 오름차순으로 준다)로 「:5173 · :24678」. 없으면 빈 글자다: 포트가 없는 것은 모르는 것이 아니다. */
export function formatPorts(ports: ReadonlyArray<number>): string {
  return ports.map((port) => `:${port}`).join(" · ");
}

/**
 * 여러 프로세스의 합 — 셸 행(셸의 트리)과 work 행(그 work의 셸들)의 숫자. 메모리와 CPU는 **읽은 것끼리** 더하고, 아무것도 못 읽었으면
 * 비었다(0이 아니다 — 모르는 것을 없다고 하지 않는다). 새로 뜬 프로세스 하나만 첫 표본이면 CPU는 나머지의 합이다: 다음 박자(2초)에
 * 그것까지 든다. 포트는 합쳐 오름차순 · 겹침 없이 둔다.
 */
export function sumMetrics(all: ReadonlyArray<ProcessMetrics>): ProcessMetrics {
  const sum = (values: Array<number | null>): number | null => {
    const read = values.filter((value): value is number => value !== null);
    return read.length === 0 ? null : read.reduce((total, value) => total + value, 0);
  };
  return {
    memory: sum(all.map((one) => one.memory)),
    cpu: sum(all.map((one) => one.cpu)),
    ports: [...new Set(all.flatMap((one) => one.ports))].sort((a, b) => a - b),
  };
}
