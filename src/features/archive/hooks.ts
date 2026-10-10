import { queryOptions, useQuery, type QueryClient } from "@tanstack/react-query";
import { archiveApi } from "./api";

// ["archive"]로 시작하는 모든 쿼리(목록·문서 목록·내용)가 한 번에 무효화된다. 목록의 키가 이 접두사 그대로다.
const ARCHIVE_KEY = ["archive"] as const;

/**
 * 아카이브가 바뀌었다고 알리는 문의 **아카이브 몫.** 부르는 자리는 work 목록 무효화 문(`invalidateWorks`) 하나다
 * (티켓 14). 아카이브 폴더는 감시하지 않는다(watcher.rs는 projects/works/layouts만 본다) — 아카이빙은 **언제나** works/에서
 * 하나가 사라지는 일이라, 앱에서 했든 에이전트가 MCP로 했든 `works:changed`가 반드시 함께 온다. 감시 대상을 늘리지 않고
 * 같은 신선도를 얻는다. 그 문을 타야 이벤트 한 번에 아카이브 목록 조회도 한 번이고 조회 중의 합치기를 함께 받는다 —
 * 여기를 따로 부르면 그 합치기를 건너뛴다.
 *
 * 접두사로 지우는 것도, 도는 조회를 버리지 않는 것(`cancelRefetch: false`)도, 돌려주는 promise를 삼키지 않는
 * 이유도 그 문과 같다(그 머리말에 무엇이 조용히 깨지는지가 있다).
 */
export function invalidateArchive(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ARCHIVE_KEY }, { cancelRefetch: false });
}

// 라우트가 렌더 전에 목록을 확보할 수 있도록 훅 밖으로 꺼낸 정의 (worksQuery와 같은 이유).
export const archiveQuery = () =>
  queryOptions({
    queryKey: ARCHIVE_KEY,
    queryFn: archiveApi.list,
    staleTime: 30_000,
  });

// **여기서 듣지 않는다**(티켓 14) — 신선도는 `works:changed`가 책임지고, 듣는 자리는 앱 루트 하나다(`AppShell`). 아카이브
// 화면은 라우트와 본문이 저마다 이 훅을 불러 여기서 들으면 이벤트 한 번에 아카이브 목록 조회가 둘이었다.
export function useArchive() {
  return useQuery(archiveQuery());
}

/**
 * 그 아카이브에 든 문서 목록. **키를 짓는 자리를 훅 밖에 둔다** — 훅 안에 두면 이 저장소에는
 * 그 키를 값으로 재는 길이 없다(L2에 DOM이 없다). 목록이 `archiveQuery()`로 이미 이 모양이다.
 */
export const archivedDocsQuery = (slug: string | null) =>
  queryOptions({
    queryKey: [...ARCHIVE_KEY, "docs", slug],
    queryFn: () => archiveApi.docs(slug!),
    enabled: slug !== null,
  });

/**
 * 아카이브된 문서 한 장. **slug와 경로가 둘 다 키에 실린다** — 아래 `staleTime: Infinity` 때문에 한 번 읽은 항목은 다시
 * 안 읽으므로, 키가 문서 하나를 정확히 가리켜야 다른 아카이브의 같은 이름 문서(`record.md`)가 그 자리에 안 선다.
 */
export const archivedFileQuery = (slug: string | null, path: string | null) =>
  queryOptions({
    queryKey: [...ARCHIVE_KEY, "file", slug, path],
    queryFn: () => archiveApi.read(slug!, path!),
    enabled: slug !== null && path !== null,
    // 아카이브된 문서는 바뀌지 않는다 — 읽은 것을 다시 읽을 이유가 없다.
    // (works 쪽 useSpecFile이 깜빡임을 막으려 쓰는 placeholderData도 그래서 필요 없다.)
    staleTime: Infinity,
  });

export function useArchivedDocs(slug: string | null) {
  return useQuery(archivedDocsQuery(slug));
}

export function useArchivedFile(slug: string | null, path: string | null) {
  return useQuery(archivedFileQuery(slug, path));
}
