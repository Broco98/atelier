import { useEffect, useMemo, useState } from "react";
import { shallow, useStore } from "@tanstack/react-store";
import { terminalStore } from "@/features/terminal/terminal-store";
import { useProcessSummary } from "./hooks";
import { lookStore, markSeen } from "./looked";
import { formatMemory } from "./metrics";
import { NEEDS_LOOK_LABEL, lookablesOf, needsLook, orphanShellKeys } from "./needs-look";

/**
 * **nav `Processes`의 메타**(프로세스 결정 11 · 티켓 29) — 평소에는 아틀리에의 메모리 합계이고, 손볼 것이 **본 뒤 새로** 생기면 그
 * 앞에 `●`가 선다. 이유는 이번 문제의 출발점이 「느려지고 나서야 알았다」라서다 — 합계가 늘 보이면 서서히 차오르는 것이 눈에 띈다.
 *
 * **앱 전체를 센다** — 사이드바의 다른 숫자와 달리 「이 세계의 것만 센다」의 예외다(프로세스 결정 9). 이름(`Processes` = 앱 전체)이 그
 * 이유를 말한다. 두 세계의 nav가 같은 값을 보인다.
 *
 * **요약 폴러가 여기 하나다**(`useProcessSummary`, 10초). 이 조각은 사이드바에 늘 서 있다(접혀도 렌더된다) — 화면이 닫혀 있어도
 * 합계와 점이 늙지 않는다. 설정 nav로 갈아 서는 동안만 쉰다(그때는 nav가 없다).
 *
 * **「봤다」는 띠와 같다** — `Processes` 화면이 열려 있고 창에 포커스가 있을 때다(S41). 그동안은 새로 온 것도 곧바로 본 것이 되고,
 * 점은 서지 않는다.
 */
export default function ProcessesNavMeta() {
  const { data: summary } = useProcessSummary();
  // 두 세계의 주인 잃은 셸 — 셸 키로 센다. 얕은 비교라 주인 잃음과 상관없는 셸의 변화(타이틀 · 도는 것)에는 다시 안 그린다.
  const orphanKeys = useStore(terminalStore, (state) => orphanShellKeys(state.shells), shallow);
  const seen = useStore(lookStore, (state) => state.seen);
  const screenOpen = useStore(lookStore, (state) => state.screens > 0);
  const focused = useWindowFocused();
  const now = useMemo(() => lookablesOf(orphanKeys, summary), [orphanKeys, summary]);
  const looking = screenOpen && focused;

  useEffect(() => {
    if (looking) markSeen(now);
  }, [looking, now]);

  // 보는 동안은 켜지 않는다 — 위 이펙트가 본 것으로 앉히기 전 한 프레임에 점이 깜박이지 않게.
  const lit = !looking && needsLook(seen, now);
  const total = summary?.total ?? null;
  // 합계를 못 읽었고(macOS 밖 · 첫 답 전 · 다리의 거절) 손볼 것도 없으면 아무것도 안 선다 — 「—」를 nav에 세우지 않는다.
  if (!lit && total === null) return null;
  return (
    // 규격은 nav `Terminal`의 셸 메타와 같다(`ShellMeta` — 글자 크기 · 오른쪽 여백). 색은 한 단 올린 `muted-foreground`다 — 이 자리의
    // tertiary는 사이드바 배경에서 대비 4.5 아래이고, 이 숫자가 이 메타가 있는 이유다.
    <span className="flex shrink-0 items-center gap-1.5 pr-[5px] text-[11.5px] text-muted-foreground">
      {/* 점의 색은 신호 토큰이다(결정 11) — 「나를 기다림」의 앰버: 손볼 것은 사람 손을 기다린다. 「확인할 것」의 초록은 끝난 일을
          말하는 색이라 여기 안 맞다. */}
      {lit && <span role="img" aria-label={NEEDS_LOOK_LABEL} className="size-1.5 shrink-0 rounded-full bg-wait" />}
      {total !== null && <span className="tabular-nums">{formatMemory(total)}</span>}
    </span>
  );
}

/**
 * 앱 창이 포커스를 쥐고 있나 — 터미널의 「봤다」와 같은 판정이다(`terminal-store.ts`의 `windowFocused` 머리말): **`document.hasFocus()`가
 * 판정이고 `focus`/`blur`는 신호일 뿐이다.** 분할에서 spec 프레임을 누르면 `blur`만 오는데 그때도 앱은 앞에 있다.
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

function windowFocused(): boolean {
  return typeof document !== "undefined" && document.hasFocus();
}
