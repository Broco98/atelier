import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "./api";
import type { ProjectPatch } from "./types";

const PROJECTS_KEY = ["projects"] as const;

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

  return useQuery({ queryKey: PROJECTS_KEY, queryFn: projectsApi.list });
}

function useInvalidatingMutation<TArgs, TResult>(
  mutationFn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PROJECTS_KEY }),
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
