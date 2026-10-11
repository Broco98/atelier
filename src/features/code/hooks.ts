import { hashKey, queryOptions, useQuery } from "@tanstack/react-query";
import { worktreeKey } from "@/features/files/hooks";
import { codeApi } from "./api";

/**
 * 워크트리 파일 한 장. **키는 `works` 접두사 밖이다**(git-integration 구현 스펙 S8) — `works:changed`의 무효화는 `["works"]`
 * 아래를 통째로 지우는데(`invalidateWorks`), 거기 들면 spec 한 줄이 바뀔 때마다 코드까지 다시 읽는다. 키는 (slug, 프로젝트,
 * 무엇)이다 — files 칸의 트리와 같은 머리(`worktreeKey(slug)`)로 지어서, 그 work의 워크트리를 다시 읽으면 열린 파일 내용도
 * 같이 다시 읽힌다.
 *
 * 키를 짓는 자리를 훅 밖에 둔다 — L2에 DOM이 없어 키를 값으로 재려면 이 꼴이다(`specFileQuery`와 같다). 이 쿼리는 그 파일
 * 탭이 본문에 서 있을 때만 마운트된다(S9 — 보일 때만 읽는다).
 *
 * **다시 시도하지 않는다**(`retry: false`). 명령이 실패하는 것은 코어가 주소를 거절했을 때뿐이라(`..` · 절대 경로 · 밖을 가리키는
 * slug — 디스크의 실패는 답의 갈래로 온다) 1 · 2 · 4초 뒤에도 같다. 기본값이면 그 7초 동안 카드 몸이 빈 채로 있다가 「읽지
 * 못한 파일」이 선다 — 한 겹 쿼리(`worktreeFolderQuery`)와 같은 까닭이다.
 */
export const codeFileQuery = (slug: string, project: string, path: string) => {
  const queryKey = [...worktreeKey(slug), project, "file", path];
  return queryOptions({
    queryKey,
    queryFn: () => codeApi.readFile(slug, project, path),
    retry: false,
    // 창 포커스 신호는 앱 루트가 따로 건다 — `worktreeTreeQuery` 머리말.
    refetchOnWindowFocus: false,
    // 같은 파일을 다시 읽을 때만 이전 내용을 유지한다 — 다른 파일로 가면서 유지하면 새 경로 아래 이전 파일이 보인다.
    placeholderData: (prev, prevQuery) =>
      prevQuery && hashKey(prevQuery.queryKey) === hashKey(queryKey) ? prev : undefined,
  });
};

export function useCodeFile(slug: string, project: string, path: string) {
  return useQuery(codeFileQuery(slug, project, path));
}
