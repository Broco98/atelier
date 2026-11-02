import { describe, expect, it } from "vitest";
import { NO_SHELLS, ownerOf } from "@/features/terminal/shell-registry";
import type { Shell, ShellsState } from "@/features/terminal/shell-registry";
import type { Attention } from "@/features/terminal/shell-attention";
import {
  TREND_SPAN_MS,
  appBodyNote,
  cardCounts,
  cardFigures,
  cpuLegend,
  sparkline,
  trendLabel,
  webviewParts,
} from "./summary-card";
import { NOT_READ } from "./metrics";
import { breakdownOf, macOf, otherAppOf, poolShell, processRow, snapshotFixture } from "./process-fixture";
import type { ProcessGroups, ProcessRow, TrendPoint } from "./types";

// 프로세스 티켓 30 — **요약 카드의 수와 추이**(프로세스 결정 10 · 프로세스 스펙 「화면 구성 › 요약 카드」). 카드는 새 박자를 걸지 않고
// 화면이 이미 받는 것(2초 스냅샷 · 10초 요약 · 스토어)에서 읽는다. 여기서 재는 것은 어느 수를 무엇으로 세는가와 스파크라인의 모양이다.
// 카드가 진짜 화면에 서는지는 L3가 잰다(`processes-summary.spec.ts`).

const 칸 = (id: number, over: Partial<Shell> = {}): Shell => ({
  id,
  status: { kind: "running" },
  title: null,
  label: null,
  shellName: "zsh",
  shellKey: `G-${id}`,
  owner: ownerOf("plain-work"),
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

const 행 = (pid: number): ProcessRow => processRow(pid, 1, pid * 10, "node");

/** 판정의 묶음을 덮어쓰고 풀에 셸 `pool`개(`G-1` …)가 앉은 스냅샷. */
const 스냅샷 = (over: Partial<ProcessGroups> = {}, pool = 0) =>
  snapshotFixture({ verdict: over, pool: Array.from({ length: pool }, (_, at) => poolShell(at + 1, `G-${at + 1}`, 0)) });

describe("요약 카드의 수", () => {
  // **셸 수는 풀의 셸이다** — 스토어가 모르는 셸(화면 밖 셸)도 든다. 앱이 띄워 둔 셸이 몇인지가 이 수다.
  it("셸 수는 스냅샷의 풀이다 — 스토어의 칸 수가 아니다", () => {
    expect(cardCounts(스토어(칸(1)), 스냅샷({}, 3)).shells).toBe(3);
  });

  // **「도는 중」은 셸 상태로 센다**(티켓 30) — 레지스트리가 내놓는 문(`signalOf`)을 딛는다. 명령이 도는 것(`running`)은 셸 상태가
  // 아니다. 기다림 · 확인할 것도 도는 중이 아니다. 끝난 칸에 남은 도는 중은 가리개가 가린다(죽은 칸이 영영 돌지 않게).
  it("도는 중은 셸 상태가 도는 중인 셸이다", () => {
    const state = 스토어(
      칸(1, { attention: 상태("working") }),
      칸(2, { attention: 상태("working", { subagents: 2 }), owner: ownerOf() }),
      칸(3, { attention: 상태("waiting") }),
      칸(4, { attention: 상태("done") }),
      칸(5, { running: "cargo" }),
      칸(6, { attention: 상태("working"), status: 끝남 }),
    );
    expect(cardCounts(state, 스냅샷()).working).toBe(2);
  });

  // **주인 잃은 셸은 아직 살아 있는 것이다**(CONTEXT 「주인 잃은 셸」). 표시가 선 채 끝난 칸은 살아 있는 것이 아니다.
  it("주인 잃은 셸은 아직 살아 있는 것만이다", () => {
    const state = 스토어(
      칸(1, { ownerless: true }),
      칸(2, { ownerless: true, owner: ownerOf("finance") }),
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

describe("요약 카드의 머리 값 — 한 표본(restart 03-5)", () => {
  const GiB = 1024 * 1024 * 1024;
  const MiB = 1024 * 1024;
  const 잰장 = snapshotFixture({
    mac: macOf(37.5, 12 * GiB, 10),
    atelier: { total: 1.5 * GiB, cpu: 3.25, app: 610 * MiB, webviewExcluded: false },
    breakdown: breakdownOf({ total: { cpu: 37.5, memory: 12 * GiB } }),
  });

  // **머리는 합계 CPU다**(스토리 122 · restart 03-6) — 정수로 반올림한다. 읽은 합이 안 넘은 장의 합계는 맥 전체 측정값이다. 아래 줄이 그
  // 눈금(맥 전체 · 코어 수)을 말한다. 메모리 카드도 **같은 스냅샷**에서 읽는다 — 10초 요약을 섞으면 머리와 줄이 다른 표본이 된다. 아틀리에
  // CPU는 나눔(`cpuLegend`)이 든다.
  it("머리 · 메모리 카드가 한 스냅샷에서 선다", () => {
    expect(cardFigures(잰장)).toEqual({
      cpu: "38%",
      cpuNote: "맥 전체 · 코어 10개",
      memory: "1.5GB",
      app: "610MB",
      webviewExcluded: false,
    });
  });

  // **읽은 합이 측정값을 넘는 표본에서는 읽은 합이 머리 숫자다**(스펙 「합이 맞는다」) — 줄을 더한 합계와 머리가 같은 값이다. 맥 전체
  // 측정값(20%)이 아니다.
  it("읽은 합이 측정값을 넘으면 머리는 읽은 합이다", () => {
    const over = snapshotFixture({
      mac: macOf(20.0, 12 * GiB),
      atelier: { total: GiB, cpu: 12.0, app: 610 * MiB, webviewExcluded: false },
      breakdown: breakdownOf({
        apps: [otherAppOf("Sketchpad", 3, GiB, 10.4)],
        system: { cpu: 0, memory: 10 * GiB },
        total: { cpu: 22.4, memory: 12 * GiB },
        over: { cpu: true, memory: false },
      }),
    });
    expect(cardFigures(over).cpu).toBe("22%");
  });

  // **첫 표본은 CPU를 모른다** — 두 표본의 차이라 두 번 재야 안다(시안 「첫 표본」 · 스토리 130). 무엇을 기다리는지와 곧 채워진다는 것을
  // 말한다. 메모리는 첫 장부터 선다.
  it("첫 표본의 CPU는 「—」이고 무엇을 기다리는지 말한다", () => {
    const first = snapshotFixture({
      mac: macOf(null, 12 * GiB),
      atelier: { total: 1.5 * GiB, cpu: null, app: 610 * MiB, webviewExcluded: false },
    });
    const figures = cardFigures(first);
    expect([figures.cpu, figures.cpuNote, figures.memory]).toEqual([NOT_READ, "두 번 재야 알 수 있어요 · 곧 채워져요", "1.5GB"]);
  });

  // **macOS 밖은 맥 전체를 재지 않는다**(스펙 「Out of Scope」) — 숫자 대신 「측정 안 됨」으로 말하고, 깨지지 않는다.
  it("맥 전체가 없으면(macOS 밖) 「측정 안 됨」이다", () => {
    const figures = cardFigures(snapshotFixture());
    expect([figures.cpu, figures.cpuNote, figures.memory]).toEqual([NOT_READ, "측정 안 됨", NOT_READ]);
  });

  // 첫 스냅샷 전에는 아무것도 모른다 — 10초 요약으로 메우지 않는다(같은 표본이 아니다). 무엇을 기다리는지 말한다(스토리 130 — 「재는 중」은
  // 머리의 표본 상태가 말한다, `beatText`).
  it("첫 스냅샷 전에는 첫 표본을 기다린다고 말한다", () => {
    expect(cardFigures(undefined)).toEqual({
      cpu: NOT_READ,
      cpuNote: "첫 표본을 찍는 중이에요",
      memory: NOT_READ,
      app: NOT_READ,
      webviewExcluded: false,
    });
  });
});

describe("지난 1시간 스파크라인", () => {
  // 점의 값은 맥 전체 CPU다 — 아틀리에 CPU는 그 4분의 1로 둔다(선은 맥 전체 하나만 그린다. 두 선은 03-11).
  const 점 = (minutesBeforeEnd: number, mac: number, end = 10_000_000): TrendPoint => ({
    at: end - minutesBeforeEnd * 60_000,
    mac,
    atelier: mac / 4,
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
    const line = sparkline([{ at: 10_000_000 - TREND_SPAN_MS - 1, mac: 50, atelier: 5 }, 점(60, 100), 점(0, 100)], box);
    expect(line).toHaveLength(2);
  });

  // 모두 0이어도 선은 바닥에 선다 — 0으로 나누지 않는다.
  it("모두 0이면 바닥에 눕는다", () => {
    expect(sparkline([점(10, 0), 점(0, 0)], box).map(([, y]) => y)).toEqual([18, 18]);
  });

  // **접근성 이름은 선이 그린 점의 처음과 끝이다** — 귀에 남는 「얼마에서 얼마로」가 눈의 선과 같은 구간이어야 한다. 1시간보다 오래된
  // 점(맥이 잠든 사이 고리가 넓어졌다)은 선에 없으니 이름에도 없다. 선은 맥 전체 CPU다(restart 03-5 — 한때 메모리 합계였다).
  it("추이의 이름은 그린 점의 처음과 끝 맥 전체 CPU다 — 1시간보다 오래된 점은 안 든다", () => {
    const stale = { at: 10_000_000 - TREND_SPAN_MS - 1, mac: 5, atelier: 1 };
    expect(trendLabel([stale, 점(60, 12.34), 점(0, 30)])).toBe("지난 1시간 맥 전체 CPU 추이, 12.3%에서 30.0%");
    expect(trendLabel([])).toBe("지난 1시간 맥 전체 CPU 추이, 아직 없음");
  });
});

describe("앱 본체의 툴팁", () => {
  // **앱이 책임지는 WebKit 도우미를 셌으면 웹뷰가 그것까지다**(restart 03-8 · 스토리 128). 못 찾았으면(책임 프로세스를 묻는 함수가 없다 ·
  // 셸에서 띄운 개발 빌드) 예전처럼 GPU · Networking을 안 센다고 말한다 — 활성 상태 보기가 앱에 묶어 보이는 합과 차이가 나는 까닭이다
  // (S39). 웹뷰(WebContent)를 못 셌으면 그것도 말한다.
  it("센 WebKit 도우미를 웹뷰에 넣어 말하고, 못 찾았으면 안 센다고 말한다", () => {
    expect(appBodyNote(false, ["GPU", "Networking"])).toBe("Rust 본체와 웹뷰(WebContent · GPU · Networking)를 세요.");
    expect(appBodyNote(false, [])).toBe(
      "Rust 본체와 웹뷰(WebContent)를 세요. WebKit의 GPU · Networking 프로세스는 세지 않아서 활성 상태 보기의 앱 합과 차이가 나요.",
    );
    expect(appBodyNote(true, ["GPU", "Networking"])).toBe("웹뷰(WebContent)를 못 셌어요 — Rust 본체와 GPU · Networking만이에요.");
    expect(appBodyNote(true, [])).toBe(
      "웹뷰(WebContent)를 못 셌어요 — Rust 본체만이에요. WebKit의 GPU · Networking 프로세스는 세지 않아서 활성 상태 보기의 앱 합과 차이가 나요.",
    );
  });
});

describe("웹뷰 줄의 글자", () => {
  // **웹뷰 줄은 WebContent와 함께 센 WebKit 도우미를 적는다**(restart 03-8 · 시안 Processes 「WebContent · GPU · Networking」). 도우미를 못
  // 찾았으면 WebContent뿐이다. 앱이 책임지는 WebContent가 더 있어도(WebKit이 미리 띄운 것) 한 번만 적는다.
  it("WebContent 뒤에 센 도우미를 잇는다", () => {
    expect(webviewParts(["GPU", "Networking"])).toBe("WebContent · GPU · Networking");
    expect(webviewParts([])).toBe("WebContent");
    expect(webviewParts(["GPU", "Networking", "WebContent"])).toBe("WebContent · GPU · Networking");
  });
});

describe("CPU 카드의 나눔 — 아틀리에 · 다른 앱 · 시스템 · 못 읽음 · 여유(restart 03-6)", () => {
  const GiB = 1024 * 1024 * 1024;

  // **그 CPU를 무엇이 얼마나 쓰는지 나눠 보인다**(스토리 123). 머리처럼 정수다. 시스템 · 못 읽음은 머리에서 아틀리에와 다른 앱을 뺀
  // 정수라 셋을 더하면 머리 숫자다 — 따로 반올림하면 3 + 10 + 5가 18이 아니게 된다. 여유는 100에서 머리를 뺀 것이다.
  it("나눔의 정수를 더하면 머리 숫자다", () => {
    const sheet = snapshotFixture({
      mac: macOf(18.45, 8 * GiB),
      atelier: { total: GiB, cpu: 3.25, app: GiB, webviewExcluded: false },
      breakdown: breakdownOf({
        apps: [otherAppOf("Sketchpad", 4, GiB, 9.1), otherAppOf(null, 30, GiB, 1.2)],
        system: { cpu: 4.9, memory: 5 * GiB },
        total: { cpu: 18.45, memory: 8 * GiB },
      }),
    });
    expect(cardFigures(sheet).cpu).toBe("18%");
    expect(cpuLegend(sheet)).toEqual({ atelier: "3%", others: "10%", system: "5%", idle: "82%" });
  });

  // **여유는 0 아래로 내려가지 않는다**(스펙 「합이 맞는다」) — 읽은 합이 측정값을 넘어 합계가 100을 넘는 표본이다. 시스템 · 못 읽음도
  // 0이다.
  it("합계가 100을 넘는 표본에서 여유는 0이다", () => {
    const sheet = snapshotFixture({
      mac: macOf(99.0, 8 * GiB),
      atelier: { total: GiB, cpu: 40.5, app: GiB, webviewExcluded: false },
      breakdown: breakdownOf({
        apps: [otherAppOf("Sketchpad", 4, GiB, 61.1)],
        system: { cpu: 0, memory: 6 * GiB },
        total: { cpu: 101.6, memory: 8 * GiB },
        over: { cpu: true, memory: false },
      }),
    });
    expect(cpuLegend(sheet)).toEqual({ atelier: "41%", others: "61%", system: "0%", idle: "0%" });
  });

  // 합계를 모르면(첫 스냅샷 전 · 첫 표본 · macOS 밖) 나눔도 모른다 — 「0%」라 하면 모르는 것을 없다고 한다.
  it("합계를 모르면 나눔은 「—」다", () => {
    const blank = { atelier: NOT_READ, others: NOT_READ, system: NOT_READ, idle: NOT_READ };
    expect(cpuLegend(undefined)).toEqual(blank);
    expect(cpuLegend(snapshotFixture({ mac: macOf(null, 8 * GiB) }))).toEqual(blank);
  });
});
