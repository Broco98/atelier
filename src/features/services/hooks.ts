import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showProblem } from "@/components/ui/confirm-store";
import { invalidateWorks } from "@/features/works/hooks";
import { threadApi } from "@/features/thread/api";
import { servicesApi } from "./api";
import type { ScopeOf } from "./scope";
import type { ServicePatch } from "./types";

/** Service 읽기의 머리 열쇠 — 목록은 이것 하나, 상세는 뒤에 slug를 단다. 무효화는 이 머리로 둘을 함께 한다. */
const SERVICES_KEY = ["services"] as const;

/**
 * 읽는 범위(§7)의 머리 열쇠 — **`["works"]` 아래에 둔다.** 범위는 Work 파일(`service` · Project)과 worktree에 달려 있어 `works:changed`의 무효화
 * 문(`invalidateWorks`)이 함께 지운다(core가 git을 부르지 않아 자주 다시 읽어도 싸다). Service 파일 · 등록부의 변화는 `useServicesFeed`가, Thread의
 * 칸(`service` · 읽기만 하기)과 worktree가 바뀐 기록 줄은 `followRecordLine`이 지운다.
 */
export const SCOPE_KEY = ["works", "reading-scope"] as const;

// 신선도는 `services:changed` 무효화가 책임진다(projects 쪽과 같다). **`projects:changed`도 듣는다** — Service의 문제(등록되지 않은
// Project)는 등록부에 달려 있어, Project를 더하거나 빼면 같은 Service 파일의 문제가 바뀐다.
export const servicesQuery = () =>
  queryOptions({
    queryKey: SERVICES_KEY,
    queryFn: servicesApi.list,
    staleTime: 30_000,
  });

/** 바깥 편집기로 고친 파일 · 등록부의 변화를 따라온다(스토리 184). 쓰는 자리마다 구독을 연다(`useProjects`와 같은 꼴). */
function useServicesFeed() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = ["services:changed", "projects:changed"].map((event) =>
      listen(event, () => {
        void queryClient.invalidateQueries({ queryKey: SERVICES_KEY });
        void queryClient.invalidateQueries({ queryKey: SCOPE_KEY });
      }),
    );
    return () => {
      for (const one of unlisten) void one.then((fn) => fn());
    };
  }, [queryClient]);
}

export function useServices() {
  useServicesFeed();
  return useQuery(servicesQuery());
}

/**
 * Service 파일들의 폴더(restart 03-3) — ⋯ 「경로 복사」가 누른 자리에서 곧바로 `<폴더>/<slug>.md`를 쓰도록 미리 읽어 둔다(웹뷰는 누름 밖의 클립보드
 * 쓰기를 막는다). 데이터 루트는 앱이 떠 있는 동안 바뀌지 않으니 한 번 읽으면 된다. 아직 못 읽었으면 「경로 복사」가 서지 않는다.
 */
export function useServicesFolder() {
  return useQuery({ queryKey: ["services-folder"], queryFn: servicesApi.folder, staleTime: Infinity });
}

/** Service 하나와 함께 쓰는 Service(상세). */
export function useService(slug: string) {
  useServicesFeed();
  return useQuery({
    queryKey: [...SERVICES_KEY, slug],
    queryFn: () => servicesApi.get(slug),
    staleTime: 30_000,
    retry: false,
  });
}

/** 상세의 설명 · 넣기 · 빼기. 쓴 뒤 목록과 상세를 함께 다시 읽는다 — 감시의 종보다 먼저 화면이 따라온다. */
export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, patch }: { slug: string; patch: ServicePatch }) => servicesApi.update(slug, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SERVICES_KEY }),
  });
}

// ── 고치기 화면(관계 편집 · 직접 만들기 — 03 구현 스펙 §13) ──────────────────────────────────────────────────────────────

/**
 * 관계 편집이 여는 파일 글 — 화면이 한 번 받아 편집기에 옮긴다. 열 때마다 새로 읽고(남긴 값을 쓰지 않는다), 연 뒤에 파일이 바뀌어도
 * 고치는 글을 덮지 않는다(종을 듣지 않는다). 새 Service(`null`)는 읽지 않는다.
 */
export function useServiceText(slug: string | null) {
  return useQuery({
    queryKey: ["service-text", slug],
    queryFn: () => servicesApi.readText(slug!),
    enabled: slug !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}

/**
 * 고치는 글의 검사 — 글이 바뀔 때마다 core가 다시 읽는다(S7 — 화면은 따로 검사하지 않는다). 다음 답이 오기까지 앞 답을 그대로 그려 카드가
 * 깜빡이지 않는다. 등록부 · 다른 Service 파일이 바뀌어도 다시 읽는다(머리 열쇠 아래라 그 종이 함께 무효화한다).
 */
export function useServiceDraft(slug: string | null, text: string) {
  useServicesFeed();
  return useQuery({
    queryKey: [...SERVICES_KEY, { draft: slug }, text],
    queryFn: () => servicesApi.check(slug, text),
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** 글로 저장 — 사람이 쓴 글 그대로. 쓴 뒤 목록 · 상세를 다시 읽는다. */
export function useSaveServiceText() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, text }: { slug: string | null; text: string }) => servicesApi.saveText(slug, text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SERVICES_KEY }),
  });
}

/** 범위 쿼리의 열쇠 — 범위를 셀 자리 그대로다. */
export function scopeKey(of: ScopeOf) {
  return [...SCOPE_KEY, of.thread ?? null, of.work ?? null, of.service ?? null, of.project ?? null];
}

/**
 * 읽는 범위(§7) — 연 Thread의 것, 또는 보내기 전의 새 Thread가 쥔 Work · 범위의 것. 요약 카드 「소스」 · 트레이의 범위 줄이 읽는다. 쥔 범위를
 * 바꿔 열쇠가 바뀌어도 새 답이 오기까지 앞 답을 그대로 그린다 — 범위 줄이 한 번 비었다 서며 칩 줄이 들썩이지 않게.
 */
export function useReadingScope(of: ScopeOf, enabled = true) {
  useServicesFeed();
  return useQuery({
    queryKey: scopeKey(of),
    queryFn: () => servicesApi.scope(of),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * Work의 Service 붙이기 · 바꾸기 · 빼기(`service: null`) — Work 화면 머리의 Service 메뉴. 엔진이 그 파일의 `service`만 고치고 Service 줄을 남긴다. 쓴 뒤
 * Work 목록 · 범위를 다시 읽는다 — 감시의 종보다 먼저 화면이 따라온다. 못 바꾸면 그 까닭을 띄운다.
 */
export function useSetService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ work, service }: { work: string; service: string | null }) => threadApi.setWorkService(work, service),
    onSuccess: async () => {
      await Promise.all([invalidateWorks(queryClient), queryClient.invalidateQueries({ queryKey: SCOPE_KEY })]);
    },
    onError: (error) => void showProblem(`Service를 바꾸지 못했어요 — ${error}`),
  });
}

// ── 지우기 · 되돌리기(03 티켓 07) ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * 지우기 · 되돌리기가 고친 것을 다시 읽는다 — Service 목록 · 상세, Work 목록(`service` 칸), 읽는 범위, 연 Thread들(머리 줄의 흐린 Service). 엔진이
 * 칸을 고치고 줄을 남기므로 감시의 종보다 먼저 화면이 따라오게 한다.
 */
async function refreshLinks(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: SERVICES_KEY }),
    invalidateWorks(queryClient),
    queryClient.invalidateQueries({ queryKey: SCOPE_KEY }),
    queryClient.invalidateQueries({ queryKey: ["thread"] }),
  ]);
}

/** Service 지우기 — 확인 창의 「삭제」. */
export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (slug: string) => servicesApi.remove(slug), onSuccess: () => refreshLinks(queryClient) });
}

/** Service 되돌리기 — 지운 뒤 토스트의 「되돌리기」. */
export function useRestoreService() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (slug: string) => servicesApi.restore(slug), onSuccess: () => refreshLinks(queryClient) });
}
