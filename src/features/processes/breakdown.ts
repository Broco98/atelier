import { sumMetrics } from "./metrics";
import { processCount } from "./process-tree";
import { NOT_MEASURED } from "./summary-card";
import type { ProcessMetrics, ProcessSnapshot } from "./types";

// **맥 전체의 나눔을 줄로 세운다**(restart 03-6 · 스펙 「합이 맞는다」 · 시안 Processes). 아틀리에의 구획들 밑에 다른 앱의 줄, 시스템 · 못
// 읽음 한 줄, 맨 끝에 합계 줄이 선다 — 그 줄들을 반올림 전 값으로 더하면 합계다. 합을 짓는 것은 Rust다(`processes::breakdown`) — 화면은
// 받은 값을 다시 셈하지 않고 줄과 말만 짓는다. 순수 함수다.

/** 번들 밖의 프로세스(데몬 · XPC 서비스 · 명령줄 도구)를 모은 줄의 이름. */
export const OTHER_PROCESSES = "그 밖의 프로세스";

/** 앞의 몇 앱 뒤를 모은 줄의 이름(restart 03-11 · 시안 Processes 「그 밖의 앱」). */
export const OTHER_APPS = "그 밖의 앱";

/** 「그 밖의 앱」 줄의 열쇠 — 번들 이름과 안 겹치게 글자로 못 쓰는 문자로 시작한다. 번들 밖의 줄은 빈 글자다. */
const OTHER_APPS_KEY = "\u0000apps";

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
 * 아래이고, 같으면 메모리가 큰 것이 위, 그다음 이름 순이다. 메모리 순 보기(restart 03-11)는 메모리가 큰 것이 위다. 번들 밖의 줄(「그 밖의
 * 프로세스」)은 늘 맨 끝이다 — 앱이 아니라 나머지다. 보기만 한다 — 끝내기가 없다.
 */
export function otherAppRows(snapshot: ProcessSnapshot, by: "cpu" | "memory" = "cpu"): OtherAppRow[] {
  const rows = snapshot.breakdown.apps.map((app) => ({
    key: app.name ?? "",
    name: app.name ?? OTHER_PROCESSES,
    note: processCount(app.processes),
    metrics: { memory: app.memory, cpu: app.cpu, ports: [] },
    bundled: app.name !== null,
  }));
  const cpu = (row: { metrics: ProcessMetrics }) => row.metrics.cpu ?? -1;
  const memory = (row: { metrics: ProcessMetrics }) => row.metrics.memory ?? 0;
  const [first, second] = by === "cpu" ? [cpu, memory] : [memory, cpu];
  rows.sort(
    (a, b) =>
      Number(b.bundled) - Number(a.bundled) ||
      first(b) - first(a) ||
      second(b) - second(a) ||
      a.name.localeCompare(b.name),
  );
  return rows.map(({ bundled: _bundled, ...row }) => row);
}

/**
 * **앞의 `keep`개 앱만 이름으로 세우고 나머지 앱은 「그 밖의 앱 N개」 한 줄로 더한다**(restart 03-11 · 시안 Processes). 이 맥에서 앱 번들이
 * 70개 가까이라 줄마다 세우면 표가 다른 앱으로 덮인다. 더한 줄은 숨긴 앱의 합이라 줄을 더하면 그대로 합계다(`sumMetrics`). 번들 밖의
 * 줄은 앱이 아니라 맨 끝에 그대로 선다. 접을 앱이 하나뿐이면 접지 않는다 — 한 줄을 「그 밖의 앱 1개」로 바꾸면 읽을 것만 는다. 받은
 * 차례를 지킨다 — 멈춘 차례(`useHeldOrder`)를 받으면 멈춘 동안 앞의 셋이 안 바뀐다.
 */
export function foldApps(rows: ReadonlyArray<OtherAppRow>, keep: number): OtherAppRow[] {
  const apps = rows.filter((row) => row.key !== "");
  const rest = rows.filter((row) => row.key === "");
  if (apps.length <= keep + 1) return [...apps, ...rest];
  const folded = apps.slice(keep);
  const metrics = sumMetrics(folded.map((row) => row.metrics));
  return [
    ...apps.slice(0, keep),
    { key: OTHER_APPS_KEY, name: OTHER_APPS, note: `${folded.length}개`, metrics },
    ...rest,
  ];
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

/**
 * **시스템 · 못 읽음 줄의 말**(시안 Processes) — 무엇을 뺀 몫인지, 넘은 표본은 왜 0인지. 못 읽은 것이 있으면 그 수가 이 몫에 들었다고
 * 앞에 적는다(restart 03-9 · 시안 「일부 못 읽음」 — 까닭은 이 줄의 툴팁 `unreadNote`). macOS 밖은 「측정 안 됨」이다.
 */
export function systemNote(snapshot: ProcessSnapshot): string {
  if (snapshot.mac === null) return NOT_MEASURED;
  if (overRead(snapshot)) return "이 표본은 읽은 합이 측정값을 넘어 0이에요";
  const unread = unreadCount(snapshot);
  return unread > 0 ? `읽지 못한 ${unread}개 포함 · 측정값에서 읽은 것을 뺀 몫` : "측정값에서 읽은 것을 뺀 몫";
}

/** 이 장에서 못 읽은 것의 수 — 까닭을 가리지 않고. */
function unreadCount(snapshot: ProcessSnapshot): number {
  const { denied, gone, other } = snapshot.unread;
  return denied + gone + other;
}

/**
 * **못 읽은 수와 까닭**(restart 03-9 · 스토리 133 · 시안 Processes 「일부 못 읽음」) — 「3개를 읽지 못했어요 · 권한 없음 2, 그사이 끝남 1. 그 몫은
 * 「시스템 · 못 읽음」에 들어 있어요.」 0인 까닭은 안 적는다. 다 읽었으면 없다. 안내 띠(`sampleNote`)와 시스템 · 못 읽음 줄의 툴팁이 이 글이다.
 * 맥 전체가 없으면(macOS 밖) 그 몫을 보이는 줄이 없어 뒤 문장을 뺀다.
 */
export function unreadNote(snapshot: ProcessSnapshot): string | null {
  const count = unreadCount(snapshot);
  if (count === 0) return null;
  const { denied, gone, other } = snapshot.unread;
  const why = (
    [
      ["권한 없음", denied],
      ["그사이 끝남", gone],
      ["그 밖", other],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name} ${n}`)
    .join(", ");
  const head = `${count}개를 읽지 못했어요 · ${why}.`;
  return snapshot.mac === null ? head : `${head} 그 몫은 「시스템 · 못 읽음」에 들어 있어요.`;
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
