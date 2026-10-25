import { useMemo } from "react";
import { shallow, useStore } from "@tanstack/react-store";
import { terminalStore } from "@/features/terminal/terminal-store";
import { useProcessSummary } from "./hooks";
import { lookStore, useSeeWhileLooking } from "./looked";
import { formatMemory } from "./metrics";
import { NEEDS_LOOK_LABEL, lookablesOf, needsLook, ownerlessShellKeys } from "./needs-look";

/** 메타가 그리는 것 — 손볼 것의 `●`를 켤지와 앱 전체 메모리 합계(못 읽었으면 `null`). */
export interface ProcessesMeta {
  lit: boolean;
  total: number | null;
}

/**
 * **`Processes`의 메타를 센다**(프로세스 결정 11 · 티켓 29) — 평소에는 아틀리에의 메모리 합계이고, 손볼 것이 **본 뒤 새로** 생기면 그 앞에
 * `●`가 선다. 이유는 이번 문제의 출발점이 「느려지고 나서야 알았다」라서다 — 합계가 보이면 서서히 차오르는 것이 눈에 띈다.
 *
 * **앱 전체를 센다**(프로세스 결정 9) — 이름(`Processes` = 앱 전체)이 그 이유를 말한다.
 *
 * **요약 폴러가 여기 하나다**(`useProcessSummary`, 10초). **늘 서 있는 자리가 부른다** — 사이드바 바닥의 사람 줄(`PersonMenu`)이다(접혀도
 * 렌더된다). 그리는 자리는 사람 메뉴의 `Processes` 줄 끝이라(02 구현 스펙 S12) 메뉴가 열려야 보이지만, 묻는 것과 「봤다」를 앉히는 것은 메뉴가
 * 닫힌 동안에도 돈다 — 메뉴 안에서 부르면 닫힌 동안 아무도 묻지 않아 `Processes` 화면의 합계 카드(`useSummaryCache`)가 비고, 화면에서 본
 * 것이 메뉴를 열 때 늦은 요약에 실려 점을 켠다(02 결정 「04 · 메모리 합계 폴러」). 설정 nav로 갈아 서는 동안만 쉰다(그때는 사람 줄이 없다).
 *
 * **「봤다」는 띠와 같다** — `Processes` 화면이 열려 있고 창에 포커스가 있을 때다(S41 — `useSeeWhileLooking`). 그동안은 새로 온 것도
 * 곧바로 본 것이 되고, 점은 서지 않는다. 화면도 같은 판정으로 스냅샷(2초)의 손볼 것을 본 것으로 앉힌다(`ProcessesPage`) — 이
 * 요약은 최대 20초 늦다.
 */
export function useProcessesNavMeta(): ProcessesMeta {
  const { data: summary } = useProcessSummary();
  // 주인 잃은 셸 — 셸 키로 센다. 얕은 비교라 주인 잃음과 상관없는 셸의 변화(타이틀 · 도는 것)에는 다시 안 그린다.
  const ownerlessKeys = useStore(terminalStore, (state) => ownerlessShellKeys(state.shells), shallow);
  const seen = useStore(lookStore, (state) => state.seen);
  const now = useMemo(() => lookablesOf(ownerlessKeys, summary), [ownerlessKeys, summary]);
  const looking = useSeeWhileLooking("nav", now);
  // 보는 동안은 켜지 않는다 — 위 이펙트가 본 것으로 앉히기 전 한 프레임에 점이 깜박이지 않게.
  return { lit: !looking && needsLook(seen, now), total: summary?.total ?? null };
}

/**
 * **`Processes`의 메타를 그린다** — 사람 메뉴 `Processes` 줄 끝(02 구현 스펙 S12 — 한때 사람 줄 오른쪽, 그 전에는 nav `Processes` 옆). 훅을
 * 부르지 않는다: 값은 늘 선 자리가 센 것을 받는다(`useProcessesNavMeta`).
 */
export default function ProcessesNavMeta({ meta: { lit, total } }: { meta: ProcessesMeta }) {
  // 합계를 못 읽었고(macOS 밖 · 첫 답 전 · 다리의 거절) 손볼 것도 없으면 아무것도 안 선다 — 「—」를 세우지 않는다.
  if (!lit && total === null) return null;
  return (
    // 규격(가로 한 줄 · 글자 · 간격 · 오른쪽 여백)은 같은 메뉴 `Terminal` 줄의 셸 메타와 같은 `row-meta` 한 정의다(index.css) — 옮겨 적지
    // 않는다. 색은 한 단 올린 `fg-secondary`다 — `fg-tertiary`는 대비 4.5 아래이고, 이 숫자가 이 메타가 있는 이유다(셸 메타의 수도 같은 색).
    <span className="row-meta text-fg-secondary">
      {/* 점의 색은 부름의 기다림 점(`dot-wait`)이다(프로세스 결정 11) — 「나를 기다림」의 색: 손볼 것은 사람 손을 기다린다.
          「확인할 것」의 점(`dot-new`)은 끝난 일을 말하는 색이라 여기 안 맞다. */}
      {lit && <span role="img" aria-label={NEEDS_LOOK_LABEL} className="size-1.5 shrink-0 rounded-full bg-dot-wait" />}
      {total !== null && <span className="tabular-nums">{formatMemory(total)}</span>}
    </span>
  );
}
