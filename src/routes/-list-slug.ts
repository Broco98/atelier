import type { QueryClient } from "@tanstack/react-query";
import { worksQuery } from "@/features/works/hooks";
import { pickSlug, shellStore } from "@/components/shell/shell-store";

// 무선택 목록 주소(`/works`)가 **어느 항목으로 고쳐 써지는가.** 한때 `/archive`도 같은 규칙을 썼다 — 이제 그 주소는 목록이다
// (restart 03-4 · `/projects`와 같다).
//
// 리다이렉트는 **부르는 쪽에 남는다.** 목적지 리터럴이 파일마다 다르고, 여기서 한 번에
// 던지려면 `to`가 두 주소의 유니온이 되어 라우터가 params를 좁히지 못한다.
//
// 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다.

/**
 * 목록을 못 가져오면(백엔드 오류) 정규화를 포기하고 빈 상태 화면으로 간다 — 셸조차 뜨지
 * 않는 것보다 낫고, 라우터 도입 전의 실패 모습과 같다.
 */
export async function pickWorkSlug(queryClient: QueryClient) {
  const works = await queryClient.ensureQueryData(worksQuery()).catch(() => []);
  return pickSlug(shellStore.state.workSlug, works);
}
