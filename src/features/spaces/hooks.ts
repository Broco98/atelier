import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

// ── 고치기 화면(관계 편집 · 직접 만들기 — 03 구현 스펙 §13) ──────────────────────────────────────────────────────────────

/**
 * 관계 편집이 여는 파일 글 — 화면이 한 번 받아 편집기에 옮긴다. 열 때마다 새로 읽고(남긴 값을 쓰지 않는다), 연 뒤에 파일이 바뀌어도
 * 고치는 글을 덮지 않는다(종을 듣지 않는다). 새 Space(`null`)는 읽지 않는다.
 */
export function useSpaceText(slug: string | null) {
  return useQuery({
    queryKey: ["space-text", slug],
    queryFn: () => spacesApi.readText(slug!),
    enabled: slug !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}

/**
 * 고치는 글의 검사 — 글이 바뀔 때마다 core가 다시 읽는다(S7 — 화면은 따로 검사하지 않는다). 다음 답이 오기까지 앞 답을 그대로 그려 카드가
 * 깜빡이지 않는다. 등록부 · 다른 Space 파일이 바뀌어도 다시 읽는다(머리 열쇠 아래라 그 종이 함께 무효화한다).
 */
export function useSpaceDraft(slug: string | null, text: string) {
  useSpacesFeed();
  return useQuery({
    queryKey: [...SPACES_KEY, { draft: slug }, text],
    queryFn: () => spacesApi.check(slug, text),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** 글로 저장 — 사람이 쓴 글 그대로. 쓴 뒤 목록 · 상세를 다시 읽는다. */
export function useSaveSpaceText() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, text }: { slug: string | null; text: string }) => spacesApi.saveText(slug, text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SPACES_KEY }),
  });
}
