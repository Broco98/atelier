import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { archiveApi } from "./api";

// ["archive"]로 시작하는 모든 쿼리(목록·문서 목록·내용)가 한 번에 무효화된다.
// 아카이빙을 실행하는 쪽(works/hooks.ts)이 이 키를 함께 무효화한다.
export const ARCHIVE_KEY = ["archive"] as const;

// 라우트가 렌더 전에 목록을 확보할 수 있도록 훅 밖으로 꺼낸 정의 (worksQuery와 같은 이유).
export const archiveQuery = queryOptions({
  queryKey: ARCHIVE_KEY,
  queryFn: archiveApi.list,
  staleTime: 30_000,
});

export function useArchive() {
  const queryClient = useQueryClient();

  // 아카이브 폴더는 감시하지 않는다(watcher.rs는 projects/works만 본다). 대신 works:changed를
  // 듣는다 — 아카이빙은 **언제나** works/에서 하나가 사라지는 일이라, 앱에서 했든 에이전트가
  // MCP로 했든 그 이벤트가 반드시 함께 온다. 감시 대상을 늘리지 않고 같은 신선도를 얻는다.
  useEffect(() => {
    const unlisten = listen("works:changed", () => {
      queryClient.invalidateQueries({ queryKey: ARCHIVE_KEY });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  return useQuery(archiveQuery);
}

export function useArchivedDocs(slug: string) {
  return useQuery({
    queryKey: [...ARCHIVE_KEY, "docs", slug],
    queryFn: () => archiveApi.docs(slug),
  });
}

export function useArchivedFile(slug: string, path: string | null) {
  return useQuery({
    queryKey: [...ARCHIVE_KEY, "file", slug, path],
    queryFn: () => archiveApi.read(slug, path!),
    enabled: path !== null,
    // 아카이브된 문서는 바뀌지 않는다 — 읽은 것을 다시 읽을 이유가 없다.
    // (works 쪽 useSpecFile이 깜빡임을 막으려 쓰는 placeholderData도 그래서 필요 없다.)
    staleTime: Infinity,
  });
}
