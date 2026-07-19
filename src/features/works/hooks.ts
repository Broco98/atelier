import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  return useQuery({
    queryKey: [...WORKS_KEY, "spec", slug, path],
    queryFn: () => worksApi.readSpec(slug, path!),
    enabled: path !== null,
    // 라이브 리로드 시 이전 내용을 유지한 채 교체해 깜빡임을 막는다
    placeholderData: (prev) => prev,
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
