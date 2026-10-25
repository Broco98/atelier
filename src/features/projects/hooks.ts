import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/features/settings/api";
import { saveSettingsSection } from "@/features/settings/save-section";
import { projectsApi } from "./api";
import { DEFAULT_NEW_PARENT } from "./project-add";
import type { ProjectPatch } from "./types";

const PROJECTS_KEY = ["projects"] as const;

// 라우트가 렌더 전에 목록을 확보할 수 있도록 훅 밖으로 꺼낸 정의.
// staleTime의 근거는 works 쪽 주석과 같다 — 신선도는 projects:changed 무효화가 책임진다.
export const projectsQuery = () =>
  queryOptions({
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

  return useQuery(projectsQuery());
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

/** 추가 — 추가 창의 「Project 추가」 · 「git init 하고 추가」(03 구현 스펙 §15). */
export function useCreateProject() {
  return useInvalidatingMutation(
    ({ folder, name, initGit }: { folder: string; name: string | null; initGit: boolean }) =>
      projectsApi.create(folder, name, initGit),
  );
}

/** 새로 만들기 — 추가 창의 「Project 만들기」(03 구현 스펙 §15). */
export function useMakeProject() {
  return useInvalidatingMutation(({ parent, name }: { parent: string; name: string }) => projectsApi.make(parent, name));
}

const NEW_PARENT_KEY = ["settings", "projects", "newParent"] as const;

/**
 * 「새로 만들기」의 부모 폴더(03 S18) — 「위치 바꾸기」로 고른 것, 고르기 전이면 `~/MyProjects`다. 설정 파일을 못 읽으면(깨진 파일 · L4 다리는
 * 설정을 읽지 못한다) 기본이다 — 고칠 자리는 설정 화면이 말한다.
 */
export function useNewProjectParent(): string {
  const { data } = useQuery({
    queryKey: NEW_PARENT_KEY,
    queryFn: async () => {
      try {
        return (await settingsApi.read()).projects?.newParent ?? DEFAULT_NEW_PARENT;
      } catch {
        return DEFAULT_NEW_PARENT;
      }
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  return data ?? DEFAULT_NEW_PARENT;
}

/** 「위치 바꾸기」로 고른 부모를 앱 설정에 적는다 — 다음 Project도 거기에 만든다. 설정의 다른 구획 · 모르는 칸은 그대로다(`saveSettingsSection`). */
export function useSaveNewProjectParent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (parent: string) => saveSettingsSection("projects", (latest) => ({ ...latest, newParent: parent })),
    onMutate: (parent) => queryClient.setQueryData(NEW_PARENT_KEY, parent),
  });
}

export function useUpdateProject() {
  return useInvalidatingMutation(
    ({ slug, patch }: { slug: string; patch: ProjectPatch }) =>
      projectsApi.update(slug, patch),
  );
}

/** 재설정 — 고른 폴더로 경로만 바꾼다(03 구현 스펙 §15). 고르기는 부르는 쪽(`useRelocate`)이 한다. */
export function useRelocateProject() {
  return useInvalidatingMutation(({ slug, folder }: { slug: string; folder: string }) => projectsApi.relocate(slug, folder));
}

export function useDeleteProject() {
  return useInvalidatingMutation((slug: string) => projectsApi.remove(slug));
}
