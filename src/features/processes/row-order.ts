import { useState } from "react";

// **포인터가 표 위에 있는 동안 줄 순서가 멈춘다**(restart 03-10 · 스토리 135 · 시안 ProcessSheet 「보기와 움직임」). 표본 값으로 서는 줄(다른
// 앱 — CPU 순)은 박자(2초)마다 자리를 바꾼다. 누르려는 줄이 도망가면 엉뚱한 것을 끝낸다. 멈추는 규칙(`holdOrder`)은 순수 함수이고, 멈춘
// 차례를 드는 것은 그 줄을 세우는 화면이다(`useHeldOrder`).

/**
 * 멈춘 차례(`held` — 멈추지 않았으면 `null`)와 이 표본의 차례(`fresh`)에서 **세울 차례**. 멈춘 동안은 멈춘 차례를 지키고, 그사이 새로 선
 * 줄은 끝에 이 표본의 차례로 붙으며(이미 선 줄을 밀지 않는다), 빠진 줄은 빠진다. `held`는 세운 차례가 이 표본의 차례와 다른가다 — 멈춤이
 * 무언가를 붙잡고 있다.
 */
export function holdOrder(
  held: ReadonlyArray<string> | null,
  fresh: ReadonlyArray<string>,
): { order: string[]; held: boolean } {
  if (held === null) return { order: [...fresh], held: false };
  const now = new Set(fresh);
  const kept = held.filter((key) => now.has(key));
  const known = new Set(kept);
  const order = [...kept, ...fresh.filter((key) => !known.has(key))];
  return { order, held: order.some((key, at) => key !== fresh[at]) };
}

/**
 * **줄을 멈춘 차례로 세운다** — `holding`인 동안 멈춘 순간의 차례를 들고(`holdOrder`), 놓으면 이 표본의 차례로 돌아간다. 멈춘 차례는 이
 * 화면의 상태다 — 렌더 중에 고친다(같은 차례면 안 고친다 — `ProcessesPage`의 `usePreviousBeat`와 같은 수법). 줄의 열쇠는 줄마다 하나여야
 * 한다.
 */
export function useHeldOrder<T>(
  rows: ReadonlyArray<T>,
  keyOf: (row: T) => string,
  holding: boolean,
): { rows: T[]; held: boolean } {
  const [kept, setKept] = useState<ReadonlyArray<string> | null>(null);
  const { order, held } = holdOrder(holding ? kept : null, rows.map(keyOf));
  const want = holding ? order : null;
  if (!sameOrder(want, kept)) setKept(want);
  const byKey = new Map(rows.map((row) => [keyOf(row), row]));
  return { rows: order.flatMap((key) => byKey.get(key) ?? []), held };
}

function sameOrder(a: ReadonlyArray<string> | null, b: ReadonlyArray<string> | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((key, at) => key === b[at]);
}
