import { queryOptions, useQuery } from "@tanstack/react-query";
import { processesApi } from "./api";

// **`Processes` 화면의 폴러가 사는 자리다**(프로세스 스펙 「수집」 · 티켓 26). 터미널 폴더 밖에 두는 것은 그 폴더의 시계 규칙
// 때문이다 — 터미널에서 시간을 아는 파일은 셋뿐이고(`shell-attention.test.ts`의 소스 스캔), 상태 축에 시계가 들어오는 것을 그
// 목록이 막는다. 이 박자는 셸 상태와 상관없는 수집의 박자라 여기 선다. 29의 요약 폴러(10초)도 이 폴더에 선다.

/** 화면 표본의 박자(프로세스 스펙 「수집 › 화면 표본(2초)」). 한 번에 이 맥의 프로세스 표 한 장과 판정이 든다. */
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
