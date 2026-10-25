import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { spacesApi } from "./api";
import type { SpacePatch } from "./types";

/** Space 읽기의 머리 열쇠 — 목록은 이것 하나, 상세는 뒤에 slug를 단다. 무효화는 이 머리로 둘을 함께 한다. */
const SPACES_KEY = ["spaces"] as const;

// 신선도는 `spaces:changed` 무효화가 책임진다(projects 쪽과 같다). **`projects:changed`도 듣는다** — Space의 문제(등록되지 않은
// Project)는 등록부에 달려 있어, Project를 더하거나 빼면 같은 Space 파일의 문제가 바뀐다.
export const spacesQuery = () =>
  queryOptions({
    queryKey: SPACES_KEY,
    queryFn: spacesApi.list,
    staleTime: 30_000,
  });

/** 바깥 편집기로 고친 파일 · 등록부의 변화를 따라온다(스토리 184). 쓰는 자리마다 구독을 연다(`useProjects`와 같은 꼴). */
function useSpacesFeed() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = ["spaces:changed", "projects:changed"].map((event) =>
      listen(event, () => queryClient.invalidateQueries({ queryKey: SPACES_KEY })),
    );
    return () => {
      for (const one of unlisten) void one.then((fn) => fn());
    };
  }, [queryClient]);
}

export function useSpaces() {
  useSpacesFeed();
  return useQuery(spacesQuery());
}

/** Space 하나와 함께 쓰는 Space(상세). */
export function useSpace(slug: string) {
  useSpacesFeed();
  return useQuery({
    queryKey: [...SPACES_KEY, slug],
    queryFn: () => spacesApi.get(slug),
    staleTime: 30_000,
    retry: false,
  });
}

/** 상세의 설명 · 넣기 · 빼기. 쓴 뒤 목록과 상세를 함께 다시 읽는다 — 감시의 종보다 먼저 화면이 따라온다. */
export function useUpdateSpace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, patch }: { slug: string; patch: SpacePatch }) => spacesApi.update(slug, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SPACES_KEY }),
  });
}
