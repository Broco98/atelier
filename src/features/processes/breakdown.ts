import { processCount } from "./process-tree";
import { NOT_MEASURED } from "./summary-card";
import type { ProcessMetrics, ProcessSnapshot } from "./types";

// **맥 전체의 나눔을 줄로 세운다**(restart 03-6 · 스펙 「합이 맞는다」 · 시안 Processes). 아틀리에의 구획들 밑에 다른 앱의 줄, 시스템 · 못
// 읽음 한 줄, 맨 끝에 합계 줄이 선다 — 그 줄들을 반올림 전 값으로 더하면 합계다. 합을 짓는 것은 Rust다(`processes::breakdown`) — 화면은
// 받은 값을 다시 셈하지 않고 줄과 말만 짓는다. 순수 함수다.

/** 번들 밖의 프로세스(데몬 · XPC 서비스 · 명령줄 도구)를 모은 줄의 이름. */
export const OTHER_PROCESSES = "그 밖의 프로세스";

/** 다른 앱 한 줄 — 이름, 프로세스 수, 숫자 칸(포트는 없다). */
export interface OtherAppRow {
  /** 줄의 열쇠 — 백엔드가 이름으로 묶었으니 이름이다. 번들 밖의 줄은 빈 글자다. */
  key: string;
  name: string;
  /** 「프로세스 N개」. */
  note: string;
  metrics: ProcessMetrics;
}

/**
 * **다른 앱의 줄**(시안 Processes 「다른 앱」) — CPU를 많이 쓰는 앱이 위다(「지금 무엇이 내 컴퓨터를 먹나」). 못 잰 줄(첫 표본)은 그
 * 아래이고, 같으면 메모리가 큰 것이 위, 그다음 이름 순이다. 번들 밖의 줄(「그 밖의 프로세스」)은 늘 맨 끝이다 — 앱이 아니라 나머지다.
 * 보기만 한다 — 끝내기가 없다.
 */
export function otherAppRows(snapshot: ProcessSnapshot): OtherAppRow[] {
  const rows = snapshot.breakdown.apps.map((app) => ({
    key: app.name ?? "",
    name: app.name ?? OTHER_PROCESSES,
    note: processCount(app.processes),
    metrics: { memory: app.memory, cpu: app.cpu, ports: [] },
    bundled: app.name !== null,
  }));
  const cpu = (row: { metrics: ProcessMetrics }) => row.metrics.cpu ?? -1;
  rows.sort(
    (a, b) =>
      Number(b.bundled) - Number(a.bundled) ||
      cpu(b) - cpu(a) ||
      (b.metrics.memory ?? 0) - (a.metrics.memory ?? 0) ||
      a.name.localeCompare(b.name),
  );
  return rows.map(({ bundled: _bundled, ...row }) => row);
}

/** 읽은 합이 맥 전체 측정값을 넘은 칸이 있다 — 그 장의 합계는 읽은 합이 섞였다. */
function overRead(snapshot: ProcessSnapshot): boolean {
  return snapshot.breakdown.over.cpu || snapshot.breakdown.over.memory;
}

/**
 * **합계 칸의 말**(시안 Processes · 스펙 「합이 맞는다」). 평소의 합계는 맥 전체 측정값이다. 읽은 합이 측정값을 넘은 표본은 「이 표본은
 * 읽은 값의 합이에요」다 — 시스템 · 못 읽음을 0으로 두고 읽은 합을 합계로 썼다. macOS 밖은 「측정 안 됨」이다.
 */
export function totalNote(snapshot: ProcessSnapshot): string {
  if (snapshot.mac === null) return NOT_MEASURED;
  return overRead(snapshot) ? "이 표본은 읽은 값의 합이에요" : "맥 전체 측정값과 같아요";
}

/** **시스템 · 못 읽음 줄의 말**(시안 Processes) — 무엇을 뺀 몫인지, 넘은 표본은 왜 0인지. macOS 밖은 「측정 안 됨」이다. */
export function systemNote(snapshot: ProcessSnapshot): string {
  if (snapshot.mac === null) return NOT_MEASURED;
  return overRead(snapshot) ? "이 표본은 읽은 합이 측정값을 넘어 0이에요" : "측정값에서 읽은 것을 뺀 몫";
}

/**
 * **활성 상태 보기 눈금**(스토리 125 · 시안 ProcessSheet 「CPU 눈금」) — 줄의 CPU(맥 전체 = 100)에 코어 수를 곱한 것이다. 코어 열 개인
 * 맥에서 한 코어를 다 쓰는 프로세스는 화면에서 10%, 활성 상태 보기에서 100%다. 포인터를 올리면 뜨는 글이다. 못 잰 CPU는 왜 없는지
 * 말한다.
 */
export function activityMonitorTip(cpu: number | null, cores: number): string {
  if (cpu === null) return "첫 표본이라 CPU를 아직 못 쟀어요";
  return `활성 상태 보기 눈금으로 ${Math.round(cpu * cores)}%`;
}
