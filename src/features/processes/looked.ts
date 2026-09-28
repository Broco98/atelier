import { useEffect, useState } from "react";
import { Store, useStore } from "@tanstack/react-store";
import { readStored, writeStored } from "@/lib/stored";
import { windowFocused } from "@/lib/window-focus";
import { seenWith } from "./needs-look";

// **「봤다」가 사는 자리**(프로세스 스펙 S41 · 티켓 29) — 본 것의 집합과, 지금 `Processes` 화면이 열려 있는가, 그리고 언제 「봤다」인지의
// 한 판정(`useSeeWhileLooking` — 화면이 열려 있고 창에 포커스가 있을 때). 점을 켤지는 순수 함수가 가른다(`needs-look.ts`). 보는 동안
// 무엇을 본 것으로 앉히는지는 부르는 자리 둘이 준다 — nav 메타는 요약(10초)의 손볼 것을, 화면은 스냅샷(2초)의 손볼 것을. 두 자리가
// 같은 판정을 지나야 한쪽만 고친 날 「보고 있다」가 둘로 갈리지 않는다. 두 자리가 본 것은 합쳐서 앉힌다(`markSeen`).
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

/**
 * 「봤다」를 앉히는 자리 — nav 메타(`ProcessesNavMeta` — 요약의 손볼 것)와 화면(`ProcessesPage` — 스냅샷의 손볼 것). **두 자리는
 * 서로 다른 이름을 넘긴다** — 같은 이름이면 `lastMarked`의 칸이 하나라 합이 안 선다. tsc는 그것을 못 가르고, L3
 * `processes-nav-meta`의 상한을 넘는 장면이 잰다.
 */
export type LookSite = "nav" | "screen";

/**
 * 자리마다 마지막으로 앉힌 손볼 것. **두 자리의 것을 합친 것이 「지금 것」이다** — 상한은 지금 것 밖의 옛 것에만 걸리므로
 * (`seenWith`), 한 자리의 것만 지금 것으로 주면 그 수가 상한에 닿을 때(출처 불명은 한 번에 수백이 선다) 다른 자리가 방금 본
 * 것이 옛 것으로 밀려 잘린다. 그러면 보는 동안 두 자리가 서로의 것을 번갈아 지우며 그때마다 다시 적고, 떠난 뒤에는 화면에서
 * 본 출처 불명이 늦은 요약에 실려 와 점을 켠다. 합이 상한을 넘을 때도 같다.
 */
const lastMarked = new Map<LookSite, ReadonlyArray<string>>();

/**
 * 그 자리가 지금 손볼 것을 봤다. 새것이 없으면(두 자리가 마지막으로 본 것 모두) 아무 일도 안 한다(`seenWith`가 같은 집합을
 * 돌려준다) — 저장도 안 한다.
 */
export function markSeen(site: LookSite, now: ReadonlyArray<string>): void {
  lastMarked.set(site, now);
  const before = lookStore.state.seen;
  const after = seenWith(before, [...lastMarked.values()].flat());
  if (after === before) return;
  lookStore.setState((state) => ({ ...state, seen: after }));
  writeSeen(after);
}

/**
 * **보는 동안 지금 것을 본 것으로 앉힌다**(S41). 「보고 있다」는 띠와 같다 — `Processes` 화면이 열려 있고 창에 포커스가 있을 때다. 그동안은
 * 새로 온 것도 곧바로 본 것이 된다. 돌려주는 값은 지금 보고 있는가다(nav 메타가 그동안 점을 안 켠다).
 *
 * 부르는 자리가 둘이다(`LookSite`) — nav 메타(`ProcessesNavMeta` — 요약의 손볼 것)와 화면(`ProcessesPage` — 스냅샷의 손볼 것).
 * 요약은 최대 20초 늦어, nav 메타만 부르면 화면에서 본 것이 떠난 뒤 늦은 요약에 실려 점을 켠다.
 */
export function useSeeWhileLooking(site: LookSite, now: ReadonlyArray<string>): boolean {
  const screenOpen = useStore(lookStore, (state) => state.screens > 0);
  const focused = useWindowFocused();
  const looking = screenOpen && focused;
  useEffect(() => {
    if (looking) markSeen(site, now);
  }, [looking, site, now]);
  return looking;
}

/**
 * 앱 창이 포커스를 쥐고 있나 — 터미널의 「봤다」와 **같은 판정 하나**다(`windowFocused` — S41 「띠와 같은 규칙」): `document.hasFocus()`가
 * 판정이고 `focus`/`blur`는 신호일 뿐이다. 분할에서 spec 프레임을 누르면 `blur`만 오는데 그때도 앱은 앞에 있다.
 */
function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(windowFocused);
  useEffect(() => {
    const sync = () => setFocused(windowFocused());
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    sync();
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  }, []);
  return focused;
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
