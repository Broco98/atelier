import type { QueryClient } from "@tanstack/react-query";
import { worksQuery } from "@/features/works/hooks";
import { archiveQuery } from "@/features/archive/hooks";
import { pickSlug, shellStore } from "@/components/shell/shell-store";
import type { Mode } from "@/mode";

// 무선택 목록 주소(`/works`·`/maison/rooms`·`/archive`·`/maison/archive`)가 **어느 항목으로
// 고쳐 써지는가.** 두 세계가 같은 규칙을 쓰므로(스펙 「무선택 주소의 정규화 규칙이 모드별로
// 같다」) 몸통이 하나여야 한다 — 라우트 파일마다 적으면 한쪽만 고친 날 Maison에서만 다른
// 줄이 기본 선택되거나 세션 기억이 안 읽히고, 그것은 「가끔 다른 게 열린다」로만 보인다.
//
// 리다이렉트는 **부르는 쪽에 남는다.** 목적지 리터럴이 파일마다 다르고, 여기서 한 번에
// 던지려면 `to`가 두 주소의 유니온이 되어 라우터가 params를 좁히지 못한다.
//
// 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다.

/**
 * 목록을 못 가져오면(백엔드 오류) 정규화를 포기하고 빈 상태 화면으로 간다 — 셸조차 뜨지
 * 않는 것보다 낫고, 라우터 도입 전의 실패 모습과 같다.
 *
 * **목록도 모드별로 캐시가 갈린다**(`worksQuery(mode)`) — 저쪽 세계의 목록으로 이쪽 주소를
 * 정규화하면 없는 항목으로 가고, 그 slug가 우연히 양쪽에 다 있으면 **다른 세계의 이름을 가진
 * 항목**이 열린 채 화면이 멀쩡해 보인다.
 */
export async function pickWorkSlug(mode: Mode, queryClient: QueryClient) {
  const works = await queryClient.ensureQueryData(worksQuery(mode)).catch(() => []);
  return pickSlug(shellStore.state.workSlug[mode], works);
}

/** 아카이브도 같은 규칙이다 — 기억한 것 → 목록 첫 항목. */
export async function pickArchiveSlug(mode: Mode, queryClient: QueryClient) {
  const entries = await queryClient.ensureQueryData(archiveQuery(mode)).catch(() => []);
  return pickSlug(shellStore.state.archiveSlug[mode], entries);
}
