import { identityKey } from "./process-tree";
import type { CleanupOutcome, EndResult, ProcessIdentity, ProcessRow, ProcessSnapshot } from "./types";

// **끝내기 결과가 줄에 보인다**(restart 03-10 · 스토리 134 · 시안 ProcessSheet 「끝내기」). [끝내기] · [정리]를 누르면 대상 줄마다 「끝내는
// 중」이 서고, 끝내기 IPC가 대상마다 돌려준 결과가 그 줄에 선다. 결과가 무엇인지는 Rust가 정한다(`processes::ending`) — 여기는 누른 줄의
// 표시(`EndMark`)를 짓고 고치는 규칙이다. 순수 함수다. 표시를 드는 저장소와 IPC는 `endings-store.ts`가 잇는다.

/** 줄의 끝내기 상태 — 답을 기다리는 중이거나, 답이 준 결과. */
export type EndState = "ending" | CleanupOutcome;

/** 줄이 선 묶음 — 판정의 칸과 그 열쇠(셸 키 · 채팅 id · 고아의 셸 키). [끝내기] · [정리]가 서는 묶음만이다. */
export interface Place {
  group: "descendants" | "chats" | "confirmed" | "unknown";
  key: string;
}

/** 끝내기를 누른 줄 하나의 표시. */
export interface EndMark {
  state: EndState;
  /** 어느 누름의 것인가 — 답은 제 누름의 표시만 고친다. */
  press: number;
  /** 누른 순간 화면에 보인 그 행과 묶음. */
  row: ProcessRow;
  place: Place;
  /** 결과가 온 때(에포크 ms). 기다리는 중이면 `null`. */
  settledAt: number | null;
}

/** 신원(`identityKey`)마다 그 줄의 표시. */
export type EndMarks = ReadonlyMap<string, EndMark>;

export const NO_MARKS: EndMarks = new Map();

/**
 * 끝남 · 강제로 끝냄 · 이미 없음이 결과가 온 뒤 남는 시간(ms) — 시안 ProcessSheet 「끝내기」의 「2.4초 뒤 줄이 빠진다」. 그동안 표본에서 빠진
 * 줄도 제자리에 선다(`withEndings`).
 */
export const LINGER_MS = 2_400;

/** 그 신원의 줄에 선 표시. */
export function markOf(marks: EndMarks, id: ProcessIdentity): EndMark | undefined {
  return marks.get(identityKey(id));
}

/** 줄의 동작 칸에 서는 글(시안 ProcessSheet 「끝내기」). */
export function endText(state: EndState): string {
  return END_TEXT[state];
}

const END_TEXT: Readonly<Record<EndState, string>> = {
  ending: "끝내는 중",
  ended: "끝남",
  forced: "강제로 끝냄",
  survived: "못 끝냄",
  gone: "이미 없음",
};

/** 화면에 보인 표본에서 그 신원의 행과 묶음을 찾는다 — [끝내기] · [정리]가 서는 묶음에서만. */
function placeOf(snapshot: ProcessSnapshot, id: ProcessIdentity): { row: ProcessRow; place: Place } | undefined {
  const { descendants, chats, orphans } = snapshot.verdict;
  const groups: Array<[Place["group"], Record<string, ProcessRow[]>]> = [
    ["descendants", descendants],
    ["chats", chats],
    ["confirmed", orphans.confirmed],
    ["unknown", orphans.unknown],
  ];
  const key = identityKey(id);
  for (const [group, byKey] of groups) {
    for (const [at, rows] of Object.entries(byKey)) {
      const row = rows.find((one) => identityKey(one.id) === key);
      if (row) return { row, place: { group, key: at } };
    }
  }
  return undefined;
}

/**
 * **누른 순간** — 대상 줄마다 「끝내는 중」을 세운다. 줄은 누른 순간 화면에 보인 표본(`shown`)에서 찾는다 — 그 표본에 없는 신원은 세울
 * 줄이 없다.
 */
export function pressEnd(
  marks: EndMarks,
  press: number,
  shown: ProcessSnapshot | undefined,
  targets: ReadonlyArray<ProcessIdentity>,
): EndMarks {
  if (shown === undefined) return marks;
  const next = new Map(marks);
  for (const id of targets) {
    const key = identityKey(id);
    // 이미 끝내는 중인 줄은 앞 누름의 것이다 — 이 끝내기는 그 신원을 안 맡는다(이미 SIGTERM을 받았다).
    if (marks.get(key)?.state === "ending") continue;
    const found = placeOf(shown, id);
    if (found) next.set(key, { state: "ending", press, ...found, settledAt: null });
  }
  return next;
}

/**
 * **답이 왔다** — 그 누름의 줄마다 답의 결과를 세운다. 답에 없는 줄(진행 중인 끝내기가 이미 맡았다)과, 답을 못 받은 누름(`null` — IPC가
 * 거절됐다)의 줄은 표시 없이 돌아온다. 다른 누름의 줄은 건드리지 않는다.
 */
export function settleEnd(
  marks: EndMarks,
  press: number,
  results: ReadonlyArray<EndResult> | null,
  now: number,
): EndMarks {
  const outcomes = new Map((results ?? []).map((result) => [identityKey(result.id), result.outcome]));
  const next = new Map(marks);
  for (const [key, mark] of marks) {
    if (mark.press !== press) continue;
    const outcome = outcomes.get(key);
    if (outcome === undefined) next.delete(key);
    else next.set(key, { ...mark, state: outcome, settledAt: now });
  }
  return next;
}

/** 표본에서 빠진 줄의 숫자 — 「—」다. 이 표본이 잰 프로세스가 아니다. */
const UNMEASURED = { memory: null, cpu: null, ports: [] };

/** 표본의 행 전부의 신원. */
function presentIn(snapshot: ProcessSnapshot): Set<string> {
  const { descendants, chats, orphans, otherInstances, exceptions } = snapshot.verdict;
  const rows = [descendants, chats, orphans.confirmed, orphans.unknown, otherInstances].flatMap((byKey) =>
    Object.values(byKey).flat(),
  );
  return new Set([...rows, ...exceptions].map((row) => identityKey(row.id)));
}

/**
 * **표본에서 빠진 줄을 제자리에 다시 세운다** — 끝내는 중이거나 결과가 남은 줄 중 이 표본에 없는 것(곧 끝났다)을 누른 순간의 묶음에 그
 * 행으로 다시 넣는다. 부모 pid가 그대로라 트리의 깊이도 그대로다. 숫자는 「—」다: 이 표본이 잰 프로세스가 아니고, 숫자를 남기면 줄의 합이
 * 합계와 갈린다(restart 03-6 「합이 맞는다」). 못 끝냄은 다시 세우지 않는다 — 산 프로세스의 표시라 표본에서 빠지면 끝난 것이다.
 */
export function withEndings(snapshot: ProcessSnapshot, marks: EndMarks): ProcessSnapshot {
  const present = presentIn(snapshot);
  const missing = [...marks].filter(([key, mark]) => mark.state !== "survived" && !present.has(key)).map(([, mark]) => mark);
  if (missing.length === 0) return snapshot;
  const { verdict } = snapshot;
  const groups = {
    descendants: { ...verdict.descendants },
    chats: { ...verdict.chats },
    confirmed: { ...verdict.orphans.confirmed },
    unknown: { ...verdict.orphans.unknown },
  };
  for (const { row, place } of missing) {
    const byKey = groups[place.group];
    byKey[place.key] = [...(byKey[place.key] ?? []), { ...row, metrics: UNMEASURED }];
  }
  return {
    ...snapshot,
    verdict: {
      ...verdict,
      descendants: groups.descendants,
      chats: groups.chats,
      orphans: { confirmed: groups.confirmed, unknown: groups.unknown },
    },
  };
}

/**
 * **지난 표시를 거둔다.** 끝남 · 강제로 끝냄 · 이미 없음은 결과가 온 뒤 `LINGER_MS`가 지나면 빠진다. 못 끝냄은 그 프로세스가 표본에 있는
 * 동안 남고, 표본에서 빠지면(뒤늦게 끝났다) 빠진다 — 표본을 모르면(`undefined`) 거두지 않는다. 끝내는 중은 답이 올 때까지 남는다. 거둘 것이
 * 없으면 받은 것을 그대로 돌려준다.
 */
export function expireMarks(marks: EndMarks, snapshot: ProcessSnapshot | undefined, now: number): EndMarks {
  const present = snapshot ? presentIn(snapshot) : null;
  const spent = [...marks].filter(([key, mark]) => {
    if (mark.state === "ending") return false;
    if (mark.state === "survived") return present !== null && !present.has(key);
    return mark.settledAt !== null && now - mark.settledAt >= LINGER_MS;
  });
  if (spent.length === 0) return marks;
  const next = new Map(marks);
  for (const [key] of spent) next.delete(key);
  return next;
}
