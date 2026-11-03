import { describe, expect, it } from "vitest";
import {
  TREND_SPAN_MS,
  appBodyNote,
  cardFigures,
  cpuLegend,
  cpuStack,
  sparkline,
  strayFigures,
  trendLabel,
  webviewParts,
} from "./summary-card";
import { NOT_READ } from "./metrics";
import { breakdownOf, macOf, otherAppOf, poolShell, processRow, snapshotFixture } from "./process-fixture";
import type { ProcessGroups, ProcessRow, TrendPoint } from "./types";

// 프로세스 티켓 30 — **요약 카드의 수와 추이**(프로세스 결정 10 · 프로세스 스펙 「화면 구성 › 요약 카드」). 카드는 새 박자를 걸지 않고
// 화면이 이미 받는 것(2초 스냅샷 · 10초 요약)에서 읽는다. 여기서 재는 것은 어느 수를 무엇으로 세는가와 추이 선의 모양이다.
// 카드가 진짜 화면에 서는지는 L3가 잰다(`processes-summary.spec.ts`).

const 행 = (pid: number): ProcessRow => processRow(pid, 1, pid * 10, "node");

/** 판정의 묶음을 덮어쓰고 풀에 셸 `pool`개(`G-1` …)가 앉은 스냅샷. */
const 스냅샷 = (over: Partial<ProcessGroups> = {}, pool = 0) =>
  snapshotFixture({ verdict: over, pool: Array.from({ length: pool }, (_, at) => poolShell(at + 1, `G-${at + 1}`, 0)) });

describe("손볼 것 카드(restart 03-11)", () => {
  // **손볼 것은 주인 없이 남은 프로세스다**(시안 Processes 「손볼 것」) — 판정의 확정 고아와 출처 불명을 함께 센다. 키가 여럿이어도 행을 모두
  // 센다. 예외 · 다른 인스턴스는 안 든다(보기만 하는 묶음이다). 화면 스냅샷에서 센다 — 같은 화면의 「손볼 것」 구획과 같은 박자다.
  it("확정 고아와 출처 불명을 함께 세고 아래에서 끝낼 수 있다고 말한다", () => {
    const snapshot = 스냅샷({
      orphans: { confirmed: { "F-1": [행(10), 행(11)], "F-2": [행(12)] }, unknown: { "OLD-1": [행(20)] } },
      exceptions: [행(30)],
      otherInstances: { "H-1": [행(40)] },
    });
    expect(strayFigures(snapshot)).toEqual({ count: "4개", note: "주인 없이 남은 프로세스 · 아래에서 끝낼 수 있어요", any: true });
  });

  it("남은 것이 없으면 그렇게 말한다", () => {
    expect(strayFigures(스냅샷())).toEqual({ count: "0개", note: "남은 것이 없어요", any: false });
  });

  // **스냅샷이 아직 없으면 모른다** — 「0개」라 하면 모르는 것을 없다고 한다.
  it("첫 스냅샷 전에는 「—」다", () => {
    expect(strayFigures(undefined)).toEqual({ count: NOT_READ, note: "", any: false });
  });
});

describe("요약 카드의 머리 값 — 한 표본(restart 03-5)", () => {
  const GiB = 1024 * 1024 * 1024;
  const MiB = 1024 * 1024;
  const 잰장 = snapshotFixture({
    mac: macOf(33.4, 12 * GiB, 10),
    atelier: { total: 1.5 * GiB, cpu: 3.25, app: 610 * MiB, webviewExcluded: false },
    breakdown: breakdownOf({ total: { cpu: 33.4, memory: 12 * GiB } }),
  });

  // **머리는 합계 CPU다**(스토리 122 · restart 03-6) — 정수로 반올림한다. 읽은 합이 안 넘은 장의 합계는 맥 전체 측정값이다. 아래 줄이 그
  // 눈금을 말한다 — 맥 전체이고, 코어 몇 개만큼인지(시안 Processes 「코어 10개 중 3.3개만큼」 — restart 03-11). 메모리 카드도 **같은 스냅샷**에서 읽는다 — 10초 요약을 섞으면 머리와 줄이 다른 표본이 된다. 아틀리에
  // CPU는 나눔(`cpuLegend`)이 든다.
  it("머리 · 메모리 카드가 한 스냅샷에서 선다", () => {
    expect(cardFigures(잰장)).toEqual({
      cpu: "33%",
      cpuNote: "맥 전체 · 코어 10개 중 3.3개만큼",
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

describe("지난 1시간 CPU 추이 — 두 선 · 0~100 고정 축(restart 03-11)", () => {
  const 점 = (minutesBeforeEnd: number, mac: number, atelier = mac / 4, end = 10_000_000): TrendPoint => ({
    at: end - minutesBeforeEnd * 60_000,
    mac,
    atelier,
  });
  const box = { width: 120, height: 20, inset: 2 };

  it("점이 없으면 그릴 것이 없다", () => {
    expect(sparkline([], box)).toEqual({ mac: [], atelier: [] });
  });

  // **가로는 시각이다**(「지난 1시간」) — 마지막 점이 오른쪽 끝이고, 30분 전 점은 가운데다. 앱을 켠 지 5분이면 오른쪽 12분의 1에만
  // 선다: 5분치를 1시간 폭으로 늘리면 「지난 1시간」이 거짓말을 한다. 두 선이 같은 가로다.
  it("가로는 마지막 점에서 거꾸로 1시간이다", () => {
    const lines = sparkline([점(60, 100), 점(30, 100), 점(0, 100)], box);
    expect(lines.mac.map(([x]) => x)).toEqual([0, 60, 120]);
    expect(lines.atelier.map(([x]) => x)).toEqual([0, 60, 120]);
    expect(sparkline([점(5, 100), 점(0, 100)], box).mac.map(([x]) => x)).toEqual([110, 120]);
  });

  // **두 선은 같은 0~100 축이다**(스펙 「추이」 · 시안 ProcessSheet) — 선마다 제 최댓값으로 늘리면 두 선을 견줄 수 없다. 100이 위
  // 가장자리, 0이 아래 가장자리(선 두께만큼 안쪽)다. 같은 값이면 두 선이 같은 높이에 선다.
  it("두 선은 0~100 고정 축이라 같은 값이 같은 높이다", () => {
    const lines = sparkline([점(40, 100, 50), 점(20, 50, 25), 점(0, 25, 25)], box);
    expect(lines.mac.map(([, y]) => y)).toEqual([2, 10, 14]);
    expect(lines.atelier.map(([, y]) => y)).toEqual([10, 14, 14]);
  });

  // 읽은 합이 측정값을 넘는 표본은 100을 넘을 수 있다 — 축 밖으로 안 나간다.
  it("100을 넘는 값은 위 가장자리에 선다", () => {
    expect(sparkline([점(0, 101.6, 0)], box).mac).toEqual([[120, 2]]);
  });

  // 1시간보다 오래된 점은 안 그린다 — 맥이 잠든 사이 고리가 1시간보다 넓어질 수 있다.
  it("마지막 점보다 1시간 넘게 앞선 점은 뺀다", () => {
    const lines = sparkline([{ at: 10_000_000 - TREND_SPAN_MS - 1, mac: 50, atelier: 5 }, 점(60, 100), 점(0, 100)], box);
    expect([lines.mac.length, lines.atelier.length]).toEqual([2, 2]);
  });

  // **접근성 이름은 선이 그린 점의 처음과 끝이다** — 두 선 모두. 1시간보다 오래된 점은 선에 없으니 이름에도 없다.
  it("추이의 이름은 두 선이 그린 점의 처음과 끝이다", () => {
    const stale = { at: 10_000_000 - TREND_SPAN_MS - 1, mac: 5, atelier: 1 };
    expect(trendLabel([stale, 점(60, 12.34, 3.1), 점(0, 30, 7.5)])).toBe(
      "지난 1시간 CPU 추이, 맥 전체 12.3%에서 30.0%, 아틀리에 3.1%에서 7.5%",
    );
    expect(trendLabel([])).toBe("지난 1시간 CPU 추이, 아직 없음");
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

  // **쌓인 막대는 나눔을 맥 전체 = 100의 폭으로 그린다**(시안 Processes `.pr-stack`) — 반올림 전 값이다. 읽은 합이 100을 넘는 표본은 막대
  // 밖으로 안 나간다 — 앞 조각부터 채우고 넘는 몫을 자른다. 이름은 나눔의 정수다.
  it("쌓인 막대의 폭은 나눔의 반올림 전 값이고 100을 넘지 않는다", () => {
    const sheet = snapshotFixture({
      mac: macOf(18.45, 8 * GiB),
      atelier: { total: GiB, cpu: 3.25, app: GiB, webviewExcluded: false },
      breakdown: breakdownOf({
        apps: [otherAppOf("Sketchpad", 4, GiB, 9.1), otherAppOf(null, 30, GiB, 1.2)],
        system: { cpu: 4.9, memory: 5 * GiB },
        total: { cpu: 18.45, memory: 8 * GiB },
      }),
    });
    expect(cpuStack(sheet)).toEqual({
      atelier: 3.25,
      others: 10.3,
      system: 4.9,
      label: "맥 전체 18% 사용 — 아틀리에 3%, 다른 앱 10%, 시스템과 못 읽은 것 5%",
    });
    const over = snapshotFixture({
      mac: macOf(99.0, 8 * GiB),
      atelier: { total: GiB, cpu: 40.5, app: GiB, webviewExcluded: false },
      breakdown: breakdownOf({
        apps: [otherAppOf("Sketchpad", 4, GiB, 61.1)],
        system: { cpu: 0, memory: 6 * GiB },
        total: { cpu: 101.6, memory: 8 * GiB },
        over: { cpu: true, memory: false },
      }),
    });
    const { atelier, others, system } = cpuStack(over);
    expect([atelier, others, system]).toEqual([40.5, 59.5, 0]);
    expect(cpuStack(undefined)).toEqual({ atelier: 0, others: 0, system: 0, label: "재는 중" });
  });

  // 합계를 모르면(첫 스냅샷 전 · 첫 표본 · macOS 밖) 나눔도 모른다 — 「0%」라 하면 모르는 것을 없다고 한다.
  it("합계를 모르면 나눔은 「—」다", () => {
    const blank = { atelier: NOT_READ, others: NOT_READ, system: NOT_READ, idle: NOT_READ };
    expect(cpuLegend(undefined)).toEqual(blank);
    expect(cpuLegend(snapshotFixture({ mac: macOf(null, 8 * GiB) }))).toEqual(blank);
  });
});
