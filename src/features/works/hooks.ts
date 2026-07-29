import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  hashKey,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { worksApi } from "./api";
import type { WorkStatus } from "./types";

// ["works"]로 시작하는 모든 쿼리(목록·spec 파일)가 works:changed 한 번에 무효화된다
const WORKS_KEY = ["works"] as const;

// 라우트가 렌더 전에 목록을 확보할 수 있도록 훅 밖으로 꺼낸 정의.
// 무선택 주소를 어느 작업으로 정규화할지 정하려면 beforeLoad가 목록을 알아야 한다.
//
// staleTime이 없으면 beforeLoad가 막 받아온 목록이 즉시 stale이라 이어서 마운트되는
// useWorks가 같은 IPC를 한 번 더 쏘고, 탭을 옮길 때마다 beforeLoad가 재요청을 기다린다.
// 이 목록의 신선도는 시간이 아니라 works:changed 무효화가 책임지므로(아래 useWorks),
// 여기 값은 그 사이를 메우는 안전망일 뿐이다.
export const worksQuery = queryOptions({
  queryKey: WORKS_KEY,
  queryFn: worksApi.list,
  staleTime: 30_000,
});

export function useWorks() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlisten = listen("works:changed", () => {
      queryClient.invalidateQueries({ queryKey: WORKS_KEY });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  return useQuery(worksQuery);
}

export function useSpecFile(slug: string, path: string | null) {
  const queryKey = [...WORKS_KEY, "spec", slug, path];
  return useQuery({
    queryKey,
    queryFn: () => worksApi.readSpec(slug, path!),
    enabled: path !== null,
    // 라이브 리로드(같은 파일 재요청)에서만 이전 내용을 유지해 깜빡임을 막는다.
    // 다른 파일로 전환할 때도 유지하면 새 파일 이름 아래 이전 파일 내용이 보인다.
    placeholderData: (prev, prevQuery) =>
      prevQuery && hashKey(prevQuery.queryKey) === hashKey(queryKey) ? prev : undefined,
  });
}

export function useSetWorkStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, status }: { slug: string; status: WorkStatus }) =>
      worksApi.setStatus(slug, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKS_KEY }),
  });
}
