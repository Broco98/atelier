import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { filesApi } from "./api";

/**
 * 워크트리 데이터의 키 머리 — (slug, 프로젝트, 무엇)으로 잇는다. **`works` 접두사 밖이다**(git-integration 구현 스펙 S8):
 * `works:changed`의 무효화는 `["works"]` 아래를 통째로 지우는데(`invalidateWorks`), 거기 들면 spec 한 줄이 바뀔 때마다
 * 워크트리 트리 · 코드까지 다시 읽는다. 워크트리의 신호는 따로다(티켓 10의 `worktree:changed`).
 */
export const worktreeKey = (slug: string) => ["worktree", slug] as const;

/**
 * 워크트리 하나의 트리. **보일 때만 읽는다**(S9) — 작업 패널의 몸은 숨어도 마운트된 채라(칸 몸은 `hidden` + `inert`)
 * 쿼리를 「보이는가」로 켜고 끈다. 숨은 동안에는 묻지 않고, 보이게 되는 순간 낡았으면 한 번 읽는다.
 */
export const worktreeTreeQuery = (slug: string, project: string, visible: boolean) =>
  queryOptions({
    queryKey: [...worktreeKey(slug), project, "tree"],
    queryFn: () => filesApi.tree(slug, project),
    enabled: visible,
  });

/**
 * gitignore에 걸린 폴더 하나의 한 겹(git-integration 티켓 02). 그 폴더가 펼쳐져 있는 동안만 마운트되고, 트리처럼 칸이 보일
 * 때만 읽는다(S9). 그래서 **펼칠 때 읽는다** — 접으면 관찰자가 사라지고, 다시 펼치면 낡은 값(`staleTime` 0)을 한 번 더 묻는다.
 *
 * - 키는 트리와 같은 머리(`worktreeKey(slug)`) 아래 `"folder"`다. 새로고침 버튼이 펼쳐 둔 걸린 폴더도 함께 다시 읽는다.
 *   걸린 폴더 안은 실시간 신호로 다시 읽지 않으므로(결정 37) `worktree:changed`의 무효화는 이 갈래를 건너뛰어야 한다.
 * - **다시 시도하지 않는다**(`retry: false`). 디스크가 거절한 폴더(권한 · 사라짐)는 1 · 2 · 4초 뒤에도 같다 — 기본값이면 그
 *   7초 동안 「읽는 중」에 멈춰 있다가 까닭이 선다. 다시 펼치거나 새로고침하면 다시 묻는다.
 */
export const worktreeFolderQuery = (slug: string, project: string, path: string, visible: boolean) =>
  queryOptions({
    queryKey: [...worktreeKey(slug), project, "folder", path],
    queryFn: () => filesApi.folder(slug, project, path),
    enabled: visible,
    retry: false,
  });

/**
 * 새로고침 버튼(스토리 16) — 그 work의 워크트리 데이터를 모두 다시 읽는다. 버튼은 files 칸이 보일 때만 서서, 다시 읽는 것은
 * 보이는(켜진) 쿼리뿐이다 — 숨은 것은 낡음 표시만 남아 보이는 순간 읽힌다.
 */
export function refreshWorktrees(queryClient: QueryClient, slug: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: worktreeKey(slug) });
}
