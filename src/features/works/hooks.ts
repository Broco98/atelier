import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { hashKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { worksApi } from "./api";
import type { WorkStatus } from "./types";

// ["works"]로 시작하는 모든 쿼리(목록·spec 파일)가 works:changed 한 번에 무효화된다
const WORKS_KEY = ["works"] as const;

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

  return useQuery({ queryKey: WORKS_KEY, queryFn: worksApi.list });
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
