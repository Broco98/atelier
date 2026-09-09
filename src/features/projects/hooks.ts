import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasProjects } from "@/mode";
import type { Mode } from "@/mode";
import { projectsApi } from "./api";
import type { ProjectPatch } from "./types";

const PROJECTS_KEY = ["projects"] as const;

// 라우트가 렌더 전에 목록을 확보할 수 있도록 훅 밖으로 꺼낸 정의.
// staleTime의 근거는 works 쪽 주석과 같다 — 신선도는 projects:changed 무효화가 책임진다.
//
// **모드는 키가 아니라 `enabled`로 받는다**(결정 17). Maison에 *다른* 프로젝트가 있는 것이
// 아니라 프로젝트라는 것이 **없다** — 키를 갈라 두면 저쪽 세계에도 채워질 수 있는 칸이
// 생기고, 같은 목록이 캐시에 두 벌 앉는다. `works`·`archive` 쪽이 키에 모드를 싣는 것과
// 갈리는 자리라 여기 적어 둔다.
//
// **`enabled`를 훅 밖에 둔다** — 훅 안에 두면 이 저장소에는 그 조건을 값으로 잴 길이 없어
// (L2에 DOM이 없다) 판정이 한쪽으로 누워도 아무것도 안 빨개진다. 아카이브 쪽
// `archivedDocsQuery`가 이미 이 모양이고, 그 근거를 그대로 잇는다.
export const projectsQuery = (mode: Mode) =>
  queryOptions({
    queryKey: PROJECTS_KEY,
    queryFn: projectsApi.list,
    staleTime: 30_000,
    enabled: hasProjects(mode),
  });

export function useProjects(mode: Mode) {
  const queryClient = useQueryClient();

  // **구독은 모드로 안 가른다.** 무효화는 「다음에 읽을 때 다시 읽어라」로 표시할 뿐이고,
  // 관찰자가 전부 꺼져 있으면(Maison) 그 표시로 깨어나지 않는다 — 명령은 여전히 안 나간다.
  // 반대로 저쪽 세계에서 구독을 끊으면, Maison에 머무는 동안 바뀐 목록을 Atelier로 돌아와
  // staleTime 안에서는 낡은 채로 본다.
  useEffect(() => {
    const unlisten = listen("projects:changed", () => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  return useQuery(projectsQuery(mode));
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
