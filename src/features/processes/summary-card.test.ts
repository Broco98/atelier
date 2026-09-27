import { describe, expect, it } from "vitest";
import { NO_SHELLS, ownerOf } from "@/features/terminal/shell-registry";
import type { Shell, ShellsState } from "@/features/terminal/shell-registry";
import type { Attention } from "@/features/terminal/shell-attention";
import { TREND_SPAN_MS, appBodyNote, cardCounts, sparkline } from "./summary-card";
import type { ProcessRow, ProcessSnapshot, TrendPoint } from "./types";

// 프로세스 티켓 30 — **요약 카드의 수와 추이**(프로세스 결정 10 · 프로세스 스펙 「화면 구성 › 요약 카드」). 카드는 새 박자를 걸지 않고
// 화면이 이미 받는 것(2초 스냅샷 · 10초 요약 · 스토어)에서 읽는다. 여기서 재는 것은 어느 수를 무엇으로 세는가와 스파크라인의 모양이다.
// 카드가 진짜 화면에 서는지는 L3가 잰다(`processes-summary.spec.ts`).

const 칸 = (id: number, over: Partial<Shell> = {}): Shell => ({
  id,
  status: { kind: "running" },
  title: null,
  shellName: "zsh",
  shellKey: `G-${id}`,
  owner: ownerOf("atelier", "plain-work"),
  project: null,
  cwd: null,
  running: null,
  attention: null,
  auto: false,
  firstInput: null,
  ownerless: false,
  ...over,
});

const 상태 = (kind: Attention["kind"], over: Partial<Attention> = {}): Attention => ({
  kind,
  message: null,
  since: 1_000,
  seen: false,
  source: "hook",
  agent: "claude",
  subagents: 0,
  subagentId: null,
  dialog: null,
  ...over,
});

const 끝남: Shell["status"] = { kind: "exited", exit: { exitCode: 1, signal: null } };

const 스토어 = (...shells: Shell[]): ShellsState => ({ ...NO_SHELLS, shells });

const 행 = (pid: number): ProcessRow => ({
  id: { pid, startedUs: pid * 10 },
  ppid: 1,
  name: "node",
  argv0: null,
  command: null,
  metrics: { memory: null, cpu: null, ports: [] },
});

const 스냅샷 = (over: Partial<ProcessSnapshot["verdict"]> = {}, pool = 0): ProcessSnapshot => ({
  verdict: {
    descendants: {},
    exceptions: [],
    helpers: [],
    orphans: { confirmed: {}, unknown: {} },
    otherInstances: {},
    ...over,
  },
  pool: Array.from({ length: pool }, (_, at) => ({
    ptyId: at + 1,
    shellKey: `G-${at + 1}`,
    lastOutputMs: 0,
    metrics: { memory: null, cpu: null, ports: [] },
  })),
  instances: [],
});

describe("요약 카드의 수", () => {
  // **셸 수는 풀의 셸이다** — 두 세계의 것이 함께, 스토어가 모르는 셸(화면 밖 셸)도 든다. 앱이 띄워 둔 셸이 몇인지가 이 수다.
  it("셸 수는 스냅샷의 풀이다 — 스토어의 칸 수가 아니다", () => {
    expect(cardCounts(스토어(칸(1)), 스냅샷({}, 3)).shells).toBe(3);
  });

  // **「도는 중」은 셸 상태로 센다**(티켓 30) — 레지스트리가 내놓는 문(`signalOf`)을 딛는다. 명령이 도는 것(`running`)은 셸 상태가
  // 아니다. 기다림 · 확인할 것도 도는 중이 아니다. 끝난 칸에 남은 도는 중은 가리개가 가린다(죽은 칸이 영영 돌지 않게).
  it("도는 중은 셸 상태가 도는 중인 셸이다 — 두 세계를 함께 센다", () => {
    const state = 스토어(
      칸(1, { attention: 상태("working") }),
      칸(2, { attention: 상태("working", { subagents: 2 }), owner: ownerOf("maison") }),
      칸(3, { attention: 상태("waiting") }),
      칸(4, { attention: 상태("done") }),
      칸(5, { running: "cargo" }),
      칸(6, { attention: 상태("working"), status: 끝남 }),
    );
    expect(cardCounts(state, 스냅샷()).working).toBe(2);
  });

  // **주인 잃은 셸은 아직 도는 것이다**(CONTEXT 「주인 잃은 셸」) — 두 세계를 함께 센다. 표시가 선 채 끝난 칸은 도는 것이 아니다.
  it("주인 잃은 셸은 두 세계의, 아직 도는 것만이다", () => {
    const state = 스토어(
      칸(1, { ownerless: true }),
      칸(2, { ownerless: true, owner: ownerOf("maison", "finance") }),
      칸(3, { ownerless: true, status: 끝남 }),
      칸(4),
    );
    expect(cardCounts(state, 스냅샷()).ownerlessShells).toBe(2);
  });

  // **확정 고아와 출처 불명은 갈라 센다**(CONTEXT 「고아」 — 앱이 알아서 치우는 것은 확정 고아뿐이다). 키가 여럿이어도 행을 모두 센다.
  // 화면 스냅샷에서 센다 — 같은 화면의 묶음(31)과 같은 박자라 카드와 묶음이 다른 수를 말하지 않는다.
  it("확정 고아와 출처 불명은 스냅샷의 두 묶음을 따로 센다", () => {
    const snapshot = 스냅샷({
      orphans: { confirmed: { "F-1": [행(10), 행(11)], "F-2": [행(12)] }, unknown: { "OLD-1": [행(20)] } },
      exceptions: [행(30)],
      otherInstances: { "H-1": [행(40)] },
    });
    const counts = cardCounts(NO_SHELLS, snapshot);
    expect([counts.confirmed, counts.unknown]).toEqual([3, 1]);
  });

  // **스냅샷이 아직 없으면 그것에서 세는 수는 모른다** — 「0」이라 하면 모르는 것을 없다고 한다. 스토어에서 세는 수는 선다.
  it("첫 스냅샷 전에는 스냅샷에서 세는 수가 없다", () => {
    expect(cardCounts(스토어(칸(1, { attention: 상태("working") })), undefined)).toEqual({
      shells: null,
      working: 1,
      ownerlessShells: 0,
      confirmed: null,
      unknown: null,
    });
  });
});

describe("지난 1시간 스파크라인", () => {
  const 점 = (minutesBeforeEnd: number, total: number, end = 10_000_000): TrendPoint => ({
    at: end - minutesBeforeEnd * 60_000,
    total,
  });
  const box = { width: 120, height: 20, inset: 2 };

  it("점이 없으면 그릴 것이 없다", () => {
    expect(sparkline([], box)).toEqual([]);
  });

  // **가로는 시각이다**(「지난 1시간」) — 마지막 점이 오른쪽 끝이고, 30분 전 점은 가운데다. 앱을 켠 지 5분이면 오른쪽 12분의 1에만
  // 선다: 5분치를 1시간 폭으로 늘리면 「지난 1시간」이 거짓말을 한다.
  it("가로는 마지막 점에서 거꾸로 1시간이다", () => {
    const line = sparkline([점(60, 100), 점(30, 100), 점(0, 100)], box);
    expect(line.map(([x]) => x)).toEqual([0, 60, 120]);
    const young = sparkline([점(5, 100), 점(0, 100)], box);
    expect(young.map(([x]) => x)).toEqual([110, 120]);
  });

  // **세로는 0부터다** — 합계가 서서히 차오르는 것을 보려는 줄이라(프로세스 결정 11), 가장 작은 값을 바닥에 두면 몇 MB 흔들림이
  // 절벽처럼 보인다. 가장 큰 값이 위 가장자리, 0이 아래 가장자리(선 두께만큼 안쪽)다.
  it("세로는 0부터 가장 큰 값까지다", () => {
    const line = sparkline([점(40, 200), 점(20, 100), 점(0, 0)], box);
    expect(line.map(([, y]) => y)).toEqual([2, 10, 18]);
  });

  // 1시간보다 오래된 점은 안 그린다 — 맥이 잠든 사이 고리가 1시간보다 넓어질 수 있다.
  it("마지막 점보다 1시간 넘게 앞선 점은 뺀다", () => {
    const line = sparkline([{ at: 10_000_000 - TREND_SPAN_MS - 1, total: 50 }, 점(60, 100), 점(0, 100)], box);
    expect(line).toHaveLength(2);
  });

  // 모두 0이어도 선은 바닥에 선다 — 0으로 나누지 않는다.
  it("모두 0이면 바닥에 눕는다", () => {
    expect(sparkline([점(10, 0), 점(0, 0)], box).map(([, y]) => y)).toEqual([18, 18]);
  });
});

describe("앱 본체의 툴팁", () => {
  // **GPU와 Networking은 세지 않는다**(S39) — 활성 상태 보기가 앱에 묶어 보이는 합과 차이가 나는 까닭을 툴팁이 말한다. 웹뷰를 못
  // 셌으면 그것도 말한다.
  it("GPU · Networking을 안 센다고 말하고, 웹뷰를 못 셌으면 그렇다고 말한다", () => {
    expect(appBodyNote(false)).toContain("GPU");
    expect(appBodyNote(false)).toContain("Networking");
    expect(appBodyNote(false)).not.toContain("못 셌");
    expect(appBodyNote(true)).toContain("GPU");
    expect(appBodyNote(true)).toContain("못 셌");
  });
});
