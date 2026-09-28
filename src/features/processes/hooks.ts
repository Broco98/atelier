import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { processesApi } from "./api";

// **`Processes` 화면의 폴러가 사는 자리다**(프로세스 스펙 「수집」 · 티켓 26). 터미널 폴더 밖에 두는 것은 그 폴더의 시계 규칙
// 때문이다 — 터미널에서 시간을 아는 파일은 셋뿐이고(`shell-attention.test.ts`의 소스 스캔), 상태 축에 시계가 들어오는 것을 그
// 목록이 막는다. 이 박자는 셸 상태와 상관없는 수집의 박자라 여기 선다. nav 메타의 요약 폴러(10초, 티켓 29)도 여기 선다. 요약
// 카드(티켓 30)는 **새 박자를 걸지 않는다** — 요약의 캐시를 읽고(`useSummaryCache`), 추이는 요약이 올 때마다 한 번 묻는다
// (`useProcessTrend`).

/**
 * 화면 표본의 박자(프로세스 스펙 「수집 › 화면 표본(2초)」). 한 번에 이 맥의 프로세스 표 한 장과 판정, 그리고 우리 트리의 지표(티켓 28)가
 * 든다. CPU%는 백엔드가 앞 표본과의 차이로 짓는다 — 박자가 10초 넘게 쉬었으면(창이 가려짐 · 화면을 떠남) 첫 표본으로 친다
 * (`processes/metrics.rs`의 `STALE`).
 */
export const SNAPSHOT_EVERY_MS = 2_000;

/**
 * 화면 스냅샷. **화면이 열려 있을 때만 묻는다**(스토리 95) — 박자는 이 쿼리를 보는 쪽이 있을 때만 돈다. 화면이 내려가면 보는
 * 쪽이 없어 박자가 멎고, 다시 열면 곧바로 한 번 묻고 박자를 다시 건다. 그래서 이 훅을 부르는 자리는 `Processes` 화면 하나여야
 * 한다: 늘 떠 있는 자리(사이드바 · 앱 셸)에서 부르면 화면이 닫혀도 2초마다 표 전체를 읽는다.
 *
 * 창이 가려져 있으면(문서가 안 보임) 박자를 쉰다 — react-query의 기본값(`refetchIntervalInBackground: false`)이다.
 *
 * **다시 시도하지 않는다.** 2초 뒤 박자가 곧 다시 묻는다 — 기본 재시도(1 · 2 · 4초)는 그 박자 위에 호출을 겹쳐 쌓는다. 거절되는
 * 자리가 실제로 있다: L4의 다리는 이 명령을 「앱 안에서만」으로 거절한다.
 */
export const snapshotQuery = queryOptions({
  queryKey: ["processes", "snapshot"],
  queryFn: () => processesApi.snapshot(),
  refetchInterval: SNAPSHOT_EVERY_MS,
  retry: false,
});

export function useProcessSnapshot() {
  return useQuery(snapshotQuery);
}

/**
 * 요약의 박자(프로세스 스펙 「수집 › 배경 표본(10초)」 · 티켓 29). Rust의 배경 표본도 10초마다 모으므로(`processes::summary::EVERY`)
 * 이보다 자주 물어도 같은 장이 온다. 요약이 늦는 때(`SUMMARY_LAG_MS`)가 이 박자에 기댄다 — 늦추면 그것도 늘린다(`looked.test`가 잰다).
 */
export const SUMMARY_EVERY_MS = 10_000;

/**
 * nav 메타의 요약 — 앱 전체 메모리 합계, 출처 불명의 신원, `●`를 켜는 기록의 머리 id(티켓 29). **nav 메타가 두 세계의 모든 화면에
 * 서므로 늘 돈다** — 화면 스냅샷(`snapshotQuery`)과 반대다. 부르는 자리는 nav 메타 하나다(`ProcessesNavMeta`): 보는 쪽이 둘이면
 * 박자도 둘이다(react-query는 보는 쪽마다 `refetchInterval`을 건다). 요약 카드(티켓 30)는 새 박자를 걸지 않고 이 캐시를 읽는다
 * (`useSummaryCache`).
 *
 * 창이 가려져 있으면 쉰다(`refetchIntervalInBackground` 기본값) — 그동안은 아무도 nav를 안 본다. Rust의 배경 표본은 그래도 돈다.
 * 다시 시도하지 않는다(스냅샷과 같은 까닭 — 박자가 곧 다시 묻고, L4의 다리는 이 명령을 거절한다).
 */
export const summaryQuery = queryOptions({
  queryKey: ["processes", "summary"],
  queryFn: () => processesApi.summary(),
  refetchInterval: SUMMARY_EVERY_MS,
  retry: false,
});

export function useProcessSummary() {
  return useQuery(summaryQuery);
}

/**
 * **요약의 캐시를 읽기만 한다**(티켓 30) — 요약 카드가 nav 메타와 같은 장을 본다. 묻지 않는 쪽이다(`enabled: false`): 보는 쪽이 하나
 * 더 박자를 걸면 요약을 10초에 두 번 묻고, 화면을 열 때마다 한 번 더 묻는다. 새 장은 nav 메타의 박자가 가져와 캐시에 앉히면 이
 * 쪽에도 그대로 선다. 사이드바가 늘 서 있으니(`ProcessesNavMeta`) `Processes` 화면이 열린 동안 박자가 비는 일은 없다.
 */
export function useSummaryCache() {
  return useQuery({ ...summaryQuery, enabled: false });
}

/**
 * 추이 — 배경 표본이 든 합계의 1시간치(티켓 30). **요약이 올 때마다 한 번 묻는다**: 키에 그 요약이 도착한 때를 싣는다. 고리는
 * 배경 표본이 10초마다 한 점씩 더하고, 요약도 10초마다 오므로 따로 박자를 걸 까닭이 없다(티켓 30 「새 폴러를 두지 않는다」). 같은
 * 요약에는 다시 묻지 않는다(`staleTime: Infinity`) — 창 포커스 · 다시 열기가 같은 고리를 또 옮기지 않게.
 *
 * 키가 바뀌는 동안 앞 추이가 서 있는다(`keepPreviousData`) — 스파크라인이 박자마다 깜박이지 않게. 지나간 키는 곧바로 버린다
 * (`gcTime: 0`): 박자마다 360점짜리 장이 캐시에 쌓이지 않게.
 */
export function trendQuery(summaryAt: number) {
  return queryOptions({
    queryKey: ["processes", "trend", summaryAt],
    queryFn: () => processesApi.trend(),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** 요약 카드의 추이. `Processes` 화면에서만 부른다 — 화면이 내려가면 묻기도 멎는다. */
export function useProcessTrend() {
  const { dataUpdatedAt } = useSummaryCache();
  return useQuery(trendQuery(dataUpdatedAt));
}

/**
 * 정리 기록(티켓 32) — **화면 스냅샷이 올 때마다 한 번 묻는다**: 키에 그 스냅샷이 도착한 때를 싣는다. 기록은 끝내기가 끝날 때 서는데
 * (셸 닫기 · [끝내기] · [정리]) 그 뒤 다음 스냅샷이 곧 온다 — 따로 박자를 걸지 않는다(추이와 같은 수법 — `trendQuery`). 스냅샷
 * 박자가 화면이 열려 있을 때만 돌므로 이것도 그렇다.
 *
 * 같은 스냅샷에는 다시 묻지 않는다(`staleTime: Infinity`). 키가 바뀌는 동안 앞 기록이 서 있고(`keepPreviousData` — 펼친 사건이
 * 박자마다 접히지 않게), 지나간 키는 곧바로 버린다(`gcTime: 0`).
 */
export function cleanupLogQuery(snapshotAt: number) {
  return queryOptions({
    queryKey: ["processes", "cleanup-log", snapshotAt],
    queryFn: () => processesApi.cleanupLog(),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/**
 * `Processes` 화면의 정리 기록. 스냅샷이 도착한 때는 **화면이 넘긴다** — 여기서 스냅샷 훅을 또 부르면 스냅샷 박자가 하나 더 걸린다
 * (react-query는 보는 쪽마다 `refetchInterval`을 건다).
 */
export function useCleanupLog(snapshotAt: number) {
  return useQuery(cleanupLogQuery(snapshotAt));
}
