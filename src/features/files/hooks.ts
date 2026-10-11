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
 * 새로고침 버튼(스토리 16) — 그 work의 워크트리 데이터를 모두 다시 읽는다. 버튼은 files 칸이 보일 때만 서서, 다시 읽는 것은
 * 보이는(켜진) 쿼리뿐이다 — 숨은 것은 낡음 표시만 남아 보이는 순간 읽힌다.
 */
export function refreshWorktrees(queryClient: QueryClient, slug: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: worktreeKey(slug) });
}
