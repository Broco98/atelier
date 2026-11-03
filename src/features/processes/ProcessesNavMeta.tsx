import { useProcessSummary } from "./hooks";
import { formatNavMeta } from "./metrics";

/** 메타가 그리는 것 — 앱 전체 메모리 합계와 아틀리에 CPU(못 읽었으면 `null`). */
export interface ProcessesMeta {
  total: number | null;
  /** 아틀리에 CPU(맥 전체 = 100) — restart 03-11. 첫 배경 표본은 모른다. */
  cpu: number | null;
}

/**
 * **`Processes`의 메타를 센다**(프로세스 결정 10 · 티켓 29) — 아틀리에 CPU와 메모리 합계다(restart 03-11 · 시안 Main 「13% · 3.3GB」). 이유는
 * 이번 문제의 출발점이 「느려지고 나서야 알았다」라서다 — 합계가 보이면 서서히 차오르는 것이 눈에 띈다. 한때(티켓 29 – 03-14) 손볼 것이
 * 본 뒤 새로 생기면 그 앞에 `●`가 섰다 — 시안 Main의 줄에 없어 걷었다(restart 03-15d). 「손볼 것」은 `Processes`의 카드 · 구획의 뜻 하나다.
 *
 * **앱 전체를 센다**(프로세스 결정 9) — 이름(`Processes` = 앱 전체)이 그 이유를 말한다.
 *
 * **요약 폴러가 여기 하나다**(`useProcessSummary`, 10초). **늘 서 있는 자리가 부른다** — 사이드바 위 칸의 `Processes` 줄이다(`Sidebar.tsx`의
 * `ProcessesItem` — 사이드바가 접혀도 렌더된다). 부르는 자리와 그리는 자리가 같은 줄이다(restart 02a-3). 설정 nav로 갈아 서는 동안만 쉰다(그때는
 * 위 칸이 없다) — `Processes` 화면의 추이(`useProcessTrend`)가 이 요약이 올 때마다 묻는다(합계 카드는 2초 스냅샷을 읽는다 — restart 03-5).
 * 한때(02 구현 스펙 S12 – 02a-2) 폴러는 바닥 사람 줄이 부르고 합계는 그 줄이 여는 메뉴 안에 섰다 — 메뉴 안에서 부르면 닫힌 동안 아무도
 * 묻지 않아서였다(02 결정 「04 · 메모리 합계 폴러」).
 */
export function useProcessesNavMeta(): ProcessesMeta {
  const { data: summary } = useProcessSummary();
  return { total: summary?.total ?? null, cpu: summary?.cpu ?? null };
}

/**
 * **`Processes`의 메타를 그린다** — 위 칸 `Processes` 줄 끝(restart 02a-3 — 한때 사람 메뉴의 `Processes` 줄 끝, 그 전에는 사람 줄 오른쪽 · nav `Processes` 옆). 훅을
 * 부르지 않는다: 값은 늘 선 자리가 센 것을 받는다(`useProcessesNavMeta`).
 */
export default function ProcessesNavMeta({ meta: { total, cpu } }: { meta: ProcessesMeta }) {
  const figures = formatNavMeta(cpu, total);
  // 합계를 못 읽었으면(macOS 밖 · 첫 답 전 · 다리의 거절) 아무것도 안 선다 — 「—」를 세우지 않는다.
  if (figures === null) return null;
  return (
    // 규격(가로 한 줄 · 글자 12 · 자간 · 오른쪽 여백)은 같은 위 칸 `Terminal` 줄의 셸 메타와 같은 `row-meta` 한 정의다(index.css) — 옮겨 적지
    // 않는다. 색은 시안 `.ra-sr-row .end`의 `fg-tertiary`다(「새 채팅」의 ⌘N과 같다 — restart 03-15d). 한때 한 단 올린 `fg-secondary`였다.
    <span className="row-meta text-fg-tertiary">
      <span className="tabular-nums">{figures}</span>
    </span>
  );
}
