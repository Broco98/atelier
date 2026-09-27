import { Store } from "@tanstack/react-store";
import { readStored, writeStored } from "@/lib/stored";
import { seenWith } from "./needs-look";

// **「봤다」의 재료가 사는 자리**(프로세스 스펙 S41 · 티켓 29) — 본 것의 집합과, 지금 `Processes` 화면이 열려 있는가. 점을 켤지는 순수
// 함수가 가르고(`needs-look.ts`), 언제 「봤다」인지(화면이 열려 있고 창에 포커스가 있을 때)는 nav 메타가 이 둘과 창 포커스로 정한다
// (`ProcessesNavMeta`). 화면은 열릴 때 여기에 알리기만 한다.
//
// **본 것의 집합은 앱을 껐다 켜도 남는다**(localStorage). 정리 기록은 실행을 넘어 남는다(최근 100건) — 본 것을 실행마다 잊으면 지난주의
// 자동 기록 하나가 앱을 켤 때마다 점을 다시 켠다. 그것이 S41이 막으려던 「점이 늘 켜진다」다. 셸 키는 실행마다 새로 서니 남아도 해가
// 없고, 집합은 상한에서 잘린다(`SEEN_CAP`). 저장이 안 되는 자리(사생활 모드처럼 접근이 던지는 저장소)에서는 이번 실행 동안만 기억한다
// — 여기서 던지면 그 편의 때문에 사이드바가 죽는다. 저장소를 만지는 문은 셸 스토어와 같은 둘이다(`lib/stored.ts`).

const SEEN_KEY = "processes-seen";

export interface LookState {
  /** 본 손볼 것의 이름들(`lookablesOf`의 이름). */
  seen: ReadonlyArray<string>;
  /** 지금 떠 있는 `Processes` 화면의 수. 0보다 크면 화면이 열려 있다 — 수로 세는 것은 StrictMode의 두 번 붙기에도 셈이 맞게 하려는 것이다. */
  screens: number;
}

export const lookStore = new Store<LookState>({ seen: readSeen(), screens: 0 });

/**
 * `Processes` 화면이 떴다 — 돌려준 함수로 내려갔음을 알린다(한 번만 듣는다). 화면 컴포넌트의 이펙트가 부른다: 그 화면이 서 있다는
 * 것이 곧 「화면이 열려 있다」다.
 */
export function openProcessesScreen(): () => void {
  lookStore.setState((state) => ({ ...state, screens: state.screens + 1 }));
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    lookStore.setState((state) => ({ ...state, screens: Math.max(0, state.screens - 1) }));
  };
}

/** 지금 손볼 것을 봤다. 새것이 없으면 아무 일도 안 한다(`seenWith`가 같은 집합을 돌려준다) — 저장도 안 한다. */
export function markSeen(now: ReadonlyArray<string>): void {
  const before = lookStore.state.seen;
  const after = seenWith(before, now);
  if (after === before) return;
  lookStore.setState((state) => ({ ...state, seen: after }));
  writeSeen(after);
}

/** 저장해 둔 본 것. 없거나 모양이 아니면 빈 집합이다 — 모르는 값을 본 것으로 치면 새것을 못 가린다. */
function readSeen(): ReadonlyArray<string> {
  const stored = readStored(SEEN_KEY);
  if (stored === null) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.every((name) => typeof name === "string") ? parsed : [];
  } catch {
    return [];
  }
}

/** 본 것을 적는다. 적어 두지 못하면 다음 실행에 한 번 더 점이 설 뿐이다. */
function writeSeen(seen: ReadonlyArray<string>): void {
  writeStored(SEEN_KEY, JSON.stringify(seen));
}
