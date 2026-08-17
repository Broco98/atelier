import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "./api";
import type { ProjectPatch } from "./types";

const PROJECTS_KEY = ["projects"] as const;

// 라우트가 렌더 전에 목록을 확보할 수 있도록 훅 밖으로 꺼낸 정의.
// staleTime의 근거는 works 쪽 주석과 같다 — 신선도는 projects:changed 무효화가 책임진다.
export const projectsQuery = queryOptions({
  queryKey: PROJECTS_KEY,
  queryFn: projectsApi.list,
  staleTime: 30_000,
});

export function useProjects() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlisten = listen("projects:changed", () => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  return useQuery(projectsQuery);
}

function useInvalidatingMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projekts"] }),
  });
}

export function useCreateProject() {
  return useInvalidatingMutation((folder: string) => projectsApi.create(folder));
}

export function useUpdateProject() {
  return useInvalidatingMutation(
    ({ slug, patch }: { slug: string; patch: ProjectPatch }) =>
      projectsApi.update(slug, patch),
  );
}

export function useDeleteProject() {
  return useInvalidatingMutation((slug: string) => projectsApi.remove(slug));
}
