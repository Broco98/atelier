import type {
  AtelierTotals,
  BodyRows,
  Breakdown,
  MacMeasure,
  OtherApp,
  PoolShell,
  ProcessGroups,
  ProcessIdentity,
  ProcessMetrics,
  ProcessRow,
  ProcessSnapshot,
  Share,
  Unread,
} from "./types";

// 검사가 짓는 프로세스 자료 — 지표 · 신원 · 스냅샷의 행 · 풀의 셸 · 스냅샷. **이 모양을 리터럴로 짓는 자리를 여기 하나로 모았다**(코드
// 리뷰 표준 68) — 행이 L2 · L3에 일곱 벌, 스냅샷이 여러 벌, 못 읽은 지표가 네 벌 있어 칸이 하나 늘면 파일마다 제각각 고쳐야 했다.
// L3의 기본 답(`e2e/fixtures.ts`의 `PROCESS_SNAPSHOT`)도 여기서 짓는다. 각 검사는 제 장면에 맞춘 얇은 감싸개만 두고 재는 칸만
// 덮어쓴다.
//
// 테스트 파일이 아니다 — `*.test.ts`면 vitest가 이것을 테스트로 돌린다. 앱 코드는 이것을 부르지 않는다(`work-fixture.ts`와 같다).
// **타입과 순수 값만 가져온다** — L3 spec이 이 파일을 부르므로, 앱 모듈을 끌어오면 그것이 Playwright 워커에 함께 실린다.

/**
 * 못 읽은 지표(티켓 28) — 숫자를 안 보는 검사의 행과 풀의 셸이 든다: 숫자 칸은 「—」로 서고, 행의 접근성 이름에 메모리 조각이 안
 * 붙는다(macOS 밖의 앱과 같다).
 */
export const NO_METRICS: ProcessMetrics = { memory: null, cpu: null, ports: [] };

/** 지표 한 벌 — CPU를 안 주면 첫 표본(`null`)이고, 포트는 없다. */
export const metricsOf = (memory: number | null, cpu: number | null = null, ports: number[] = []): ProcessMetrics => ({
  memory,
  cpu,
  ports,
});

/** pid에서 지은 신원 — 시작 시각은 2026년의 에포크 µs다. 요약의 출처 불명과 스냅샷의 행이 같은 신원을 싣게 할 때 쓴다. */
export const identityOf = (pid: number): ProcessIdentity => ({ pid, startedUs: 1_790_000_000_000_000 + pid });

/**
 * 스냅샷의 한 행. 시작 시각은 따로 준다 — 차례가 pid 순이 아니라 시작 순인지를 가르려고. 기본은 env를 못 읽은 행이고(`argv0` ·
 * `command`가 `null`) 지표도 못 읽었다.
 */
export const processRow = (
  pid: number,
  ppid: number,
  startedUs: number,
  name: string,
  over: Partial<ProcessRow> = {},
): ProcessRow => ({
  id: { pid, startedUs },
  ppid,
  name,
  argv0: null,
  command: null,
  metrics: NO_METRICS,
  ...over,
});

/**
 * 이름을 pid에서 지은 행(`p<pid>`) — 이름보다 차례 · 깊이 · 묶음을 보는 검사(L2 process-tree · process-groups)의 행이다. 이름을
 * 보는 검사는 `over`로 덮어쓴다. 이름 규칙을 파일마다 적으면 한쪽만 고친 날 두 파일의 행이 조용히 갈린다.
 */
export const pidNamedRow = (pid: number, ppid: number, startedUs: number, over: Partial<ProcessRow> = {}): ProcessRow =>
  processRow(pid, ppid, startedUs, `p${pid}`, over);

/**
 * env를 읽은 행 — 부른 이름(`argv0`)은 커널 이름 그대로이고 명령줄은 `<이름> --fixture`다. 숫자와 줄 이름을 보는 L3(processes-metrics ·
 * processes-strays)의 행이고, 지표는 `over`로 준다.
 */
export const envReadRow = (
  pid: number,
  ppid: number,
  startedUs: number,
  name: string,
  over: Partial<ProcessRow> = {},
): ProcessRow => processRow(pid, ppid, startedUs, name, { argv0: name, command: `${name} --fixture`, ...over });

/** 풀에 앉은 셸 하나. 마지막 출력은 늘 준다 — 「조용함」의 경과가 이것에서 잰다. */
export const poolShell = (ptyId: number, shellKey: string, lastOutputMs: number, metrics: ProcessMetrics = NO_METRICS): PoolShell => ({
  ptyId,
  shellKey,
  lastOutputMs,
  metrics,
});

/** 아무것도 못 읽은 아틀리에 합계(macOS 밖의 앱과 같다) — 숫자가 모두 비고 웹뷰는 제외다. */
export const NO_TOTALS: AtelierTotals = { total: null, cpu: null, app: null, webviewExcluded: true };

/** 아무것도 못 읽은 아틀리에 앱의 줄(macOS 밖의 앱과 같다). */
export const NO_BODY: BodyRows = { rust: NO_METRICS, webview: NO_METRICS, webkit: [] };

/** 못 읽은 것이 없는 장 — 까닭마다 0이다(macOS 밖의 앱과 같다). */
export const NO_UNREAD: Unread = { denied: 0, gone: 0, other: 0 };

/** 못 잰 몫 — 「—」. */
export const NO_SHARE: Share = { cpu: null, memory: null };

/**
 * 맥 전체의 나눔(restart 03-6). 기본은 **맥 전체를 못 잰 장**이다(macOS 밖의 앱과 같다) — 다른 앱이 없고 시스템 · 못 읽음과 합계가 빈다.
 * 검사는 재는 칸만 덮어쓴다. 백엔드처럼 줄의 합을 지어 주지 않는다 — 합이 맞는지는 Rust(`breakdown`)가 재고, 화면은 받은 값을 보인다.
 */
export const breakdownOf = (over: Partial<Breakdown> = {}): Breakdown => ({
  apps: [],
  system: NO_SHARE,
  total: NO_SHARE,
  over: { cpu: false, memory: false },
  ...over,
});

/** 다른 앱 한 줄 — 이름이 `null`이면 번들 밖의 줄이다. CPU를 안 주면 첫 표본이다. */
export const otherAppOf = (name: string | null, processes: number, memory: number, cpu: number | null = null): OtherApp => ({
  name,
  processes,
  memory,
  cpu,
});

/** 맥 전체 한 표본 — CPU를 안 주면 첫 표본(`null`)이다. 코어는 열 개다(시안 ProcessSheet의 예). */
export const macOf = (cpu: number | null, memory: number | null = null, cores = 10): MacMeasure => ({ cpu, memory, cores });

/** 기본 스냅샷을 잰 시각 — 2026년의 에포크 ms다. */
export const MEASURED_AT = 1_790_000_000_000;

/** 스냅샷을 덮어쓸 칸. 판정은 칸째 덮어쓴다 — 준 칸만 바뀌고 나머지 묶음은 빈 채다. */
export type SnapshotOver = Partial<Omit<ProcessSnapshot, "verdict">> & { verdict?: Partial<ProcessGroups> };

/**
 * 스냅샷 한 장. 기본은 **아무 셸도 없고 판정이 가른 것도 없는 앱**이다 — 무엇이 있어야 하는 검사는 그것을 덮어써서 스스로 말한다. 머리
 * 값(restart 03-5)도 아무것도 못 잰 장이다 — 맥 전체가 없고(macOS 밖) 아틀리에 합계가 빈다.
 */
export function snapshotFixture({ verdict = {}, ...over }: SnapshotOver = {}): ProcessSnapshot {
  return {
    verdict: {
      descendants: {},
      exceptions: [],
      helpers: [],
      orphans: { confirmed: {}, unknown: {} },
      otherInstances: {},
      chats: {},
      runtimes: [],
      ...verdict,
    },
    pool: [],
    instances: [],
    recordHead: null,
    measuredAt: MEASURED_AT,
    unread: NO_UNREAD,
    mac: null,
    atelier: NO_TOTALS,
    body: NO_BODY,
    breakdown: breakdownOf(),
    ...over,
  };
}
