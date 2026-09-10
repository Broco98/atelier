import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { archiveApi } from "./api";
import type { Mode } from "@/mode";

// ["archive"]로 시작하는 모든 쿼리(두 세계의 목록·문서 목록·내용)가 한 번에 무효화된다.
// 모드는 이 접두사 **바로 뒤**에 실린다 — 근거는 works 쪽 `WORKS_KEY`와 같다.
const ARCHIVE_KEY = ["archive"] as const;

/**
 * 아카이브가 바뀌었다고 알리는 유일한 문. 아카이빙을 실행하는 쪽(works/hooks.ts)도 이것을
 * 부른다 — **두 세계를 함께 지운다**는 이유는 `invalidateWorks`와 같다.
 *
 * 돌려주는 promise를 삼키지 않는 이유도 그 짝과 같다(그 머리말에 무엇이 조용히 깨지는지가
 * 있다) — 기다릴지 말지는 부르는 쪽이 정한다.
 */
export function invalidateArchive(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ARCHIVE_KEY });
}

// 라우트가 렌더 전에 목록을 확보할 수 있도록 훅 밖으로 꺼낸 정의 (worksQuery와 같은 이유).
export const archiveQuery = (mode: Mode) =>
  queryOptions({
    queryKey: [...ARCHIVE_KEY, mode],
    queryFn: () => archiveApi.list(mode),
    staleTime: 30_000,
  });

export function useArchive(mode: Mode) {
  const queryClient = useQueryClient();

  // 아카이브 폴더는 감시하지 않는다(watcher.rs는 projects/works만 본다). 대신 works:changed를
  // 듣는다 — 아카이빙은 **언제나** works/에서 하나가 사라지는 일이라, 앱에서 했든 에이전트가
  // MCP로 했든 그 이벤트가 반드시 함께 온다. 감시 대상을 늘리지 않고 같은 신선도를 얻는다.
  useEffect(() => {
    const unlisten = listen("works:changed", () => {
      // 이벤트에는 기다릴 사람이 없다 — works 쪽 리스너와 같다.
      void invalidateArchive(queryClient);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  return useQuery(archiveQuery(mode));
}

/**
 * 그 아카이브에 든 문서 목록. **키를 짓는 자리를 훅 밖에 둔다** — 훅 안에 두면 이 저장소에는
 * 그 키를 값으로 재는 길이 없어(L2에 DOM이 없다) 키에서 `mode`가 빠져도 아무것도 안 빨개진다.
 * 목록이 `archiveQuery(mode)`로 이미 이 모양이다.
 */
export const archivedDocsQuery = (mode: Mode, slug: string | null) =>
  queryOptions({
    queryKey: [...ARCHIVE_KEY, mode, "docs", slug],
    queryFn: () => archiveApi.docs(mode, slug!),
    enabled: slug !== null,
  });

/**
 * 아카이브된 문서 한 장. 같은 이름이 두 세계에 설 수 있으므로(결정 10) **모드가 키에 실려야
 * 한다** — 안 실리면 Atelier work `가`의 `record.md`를 읽은 뒤 Maison Room `가`의 같은 문서를
 * 열 때 같은 캐시 항목을 맞고, 아래 `staleTime: Infinity` 때문에 **다시 읽지도 않는다.**
 * 저쪽 세계의 본문이 영구히 뜬 채 화면은 멀쩡해 보인다.
 */
export const archivedFileQuery = (mode: Mode, slug: string | null, path: string | null) =>
  queryOptions({
    queryKey: [...ARCHIVE_KEY, mode, "file", slug, path],
    queryFn: () => archiveApi.read(mode, slug!, path!),
    enabled: slug !== null && path !== null,
    // 아카이브된 문서는 바뀌지 않는다 — 읽은 것을 다시 읽을 이유가 없다.
    // (works 쪽 useSpecFile이 깜빡임을 막으려 쓰는 placeholderData도 그래서 필요 없다.)
    staleTime: Infinity,
  });

export function useArchivedDocs(mode: Mode, slug: string | null) {
  return useQuery(archivedDocsQuery(mode, slug));
}

export function useArchivedFile(mode: Mode, slug: string | null, path: string | null) {
  return useQuery(archivedFileQuery(mode, slug, path));
}
