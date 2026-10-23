import { queryOptions, type InvalidateQueryFilters, type Query, type QueryClient } from "@tanstack/react-query";
import { filesApi } from "./api";

/** 모든 워크트리 데이터의 머리 — 창 포커스 신호가 통째로 낡았다고 표시한다(`refreshAllWorktrees`). */
const WORKTREE_ROOT = ["worktree"] as const;

/**
 * 워크트리 데이터의 키 머리 — (slug, 프로젝트, 무엇)으로 잇는다. **`works` 접두사 밖이다**(git-integration 구현 스펙 S8):
 * `works:changed`의 무효화는 `["works"]` 아래를 통째로 지우는데(`invalidateWorks`), 거기 들면 spec 한 줄이 바뀔 때마다
 * 워크트리 트리 · 코드까지 다시 읽는다. 워크트리의 신호는 따로다(티켓 10의 `worktree:changed`).
 */
export const worktreeKey = (slug: string) => [...WORKTREE_ROOT, slug] as const;

/**
 * 워크트리 하나의 트리. **보일 때만 읽는다**(S9) — 작업 패널의 몸은 숨어도 마운트된 채라(칸 몸은 `hidden` + `inert`)
 * 쿼리를 「보이는가」로 켜고 끈다. 숨은 동안에는 묻지 않고, 보이게 되는 순간 낡았으면 한 번 읽는다.
 *
 * **창 포커스로는 react-query가 스스로 다시 읽지 않는다**(`refetchOnWindowFocus: false`). 그 기본값은 `visibilitychange`를
 * 듣는데, 창 포커스 신호는 앱 루트가 window `focus` 하나로 따로 건다(`useFollowWorktreeChanges`) — 둘이 함께 서면 창으로
 * 돌아올 때 두 번 읽는다. 워크트리 쿼리 셋(트리 · 한 겹 · 파일 내용)이 모두 같다.
 */
export const worktreeTreeQuery = (slug: string, project: string, visible: boolean) =>
  queryOptions({
    queryKey: [...worktreeKey(slug), project, "tree"],
    queryFn: () => filesApi.tree(slug, project),
    enabled: visible,
    refetchOnWindowFocus: false,
  });

/**
 * gitignore에 걸린 폴더 하나의 한 겹(git-integration 티켓 02). 그 폴더가 펼쳐져 있는 동안만 마운트되고, 트리처럼 칸이 보일
 * 때만 읽는다(S9). 그래서 **펼칠 때 읽는다** — 접으면 관찰자가 사라지고, 다시 펼치면 낡은 값(`staleTime` 0)을 한 번 더 묻는다.
 *
 * - 키는 트리와 같은 머리(`worktreeKey(slug)`) 아래 `"folder"`다. 새로고침 버튼이 펼쳐 둔 걸린 폴더도 함께 다시 읽는다.
 *   걸린 폴더 안은 실시간 신호로 다시 읽지 않으므로(결정 37) `worktree:changed` · 턴 끝의 무효화는 이 갈래를 건너뛴다(`notOneLayer`).
 * - **다시 시도하지 않는다**(`retry: false`). 디스크가 거절한 폴더(권한 · 사라짐)는 1 · 2 · 4초 뒤에도 같다 — 기본값이면 그
 *   7초 동안 「읽는 중」에 멈춰 있다가 까닭이 선다. 다시 펼치거나 새로고침하면 다시 묻는다.
 */
export const worktreeFolderQuery = (slug: string, project: string, path: string, visible: boolean) =>
  queryOptions({
    queryKey: [...worktreeKey(slug), project, "folder", path],
    queryFn: () => filesApi.folder(slug, project, path),
    enabled: visible,
    retry: false,
    refetchOnWindowFocus: false,
  });

/**
 * Work 카드의 변경 칸(v1 티켓 33 · 34) — Work 전체의 변경을 한 번에 읽는 쿼리다. **워크트리 데이터 머리 아래다** — 턴 끝 · 창 포커스 ·
 * 새로고침이 다른 워크트리 쿼리와 함께 다시 읽는다. 감시의 신호는 워크트리 하나의 것이라(`invalidateWorktree`의 머리는 Project까지다)
 * 앱 루트가 `invalidateWorkChanges`를 따로 부른다.
 */
export const workChangesKey = (slug: string) => [...worktreeKey(slug), "changes"] as const;

/** 감시가 그 Work의 워크트리 하나가 바뀌었다고 알렸다 — 그 Work의 변경 칸을 낡았다고 표시한다(보일 때만 다시 읽는다). */
export function invalidateWorkChanges(queryClient: QueryClient, slug: string): Promise<void> {
  return invalidateMerging(queryClient, { queryKey: workChangesKey(slug), exact: true });
}

/**
 * 새로고침 버튼(스토리 16) — 그 work의 워크트리 데이터를 모두 다시 읽는다. 펼쳐 둔 걸린 폴더의 한 겹까지다. 버튼은 files 칸이
 * 보일 때만 서서, 다시 읽는 것은 보이는(켜진) 쿼리뿐이다 — 숨은 것은 낡음 표시만 남아 보이는 순간 읽힌다.
 */
export function refreshWorktrees(queryClient: QueryClient, slug: string): Promise<void> {
  return invalidateMerging(queryClient, { queryKey: worktreeKey(slug) });
}

/**
 * 걸린 폴더의 한 겹이 아닌 것. 걸린 폴더 안은 펼칠 때 · 창 포커스 · 새로고침에만 다시 읽는다(결정 37) — 감시 · 턴 끝 두 신호는
 * 이 갈래를 건너뛴다. 머리만으로 무효로 하면 펼쳐 둔 한 겹까지 걸린다.
 */
const notOneLayer = ({ queryKey }: Query) => queryKey[3] !== "folder";

/**
 * 감시가 그 워크트리의 변경을 알렸다(`worktree:changed` — 티켓 10). 그 (slug, 프로젝트)의 트리와 열린 파일 내용을 낡았다고
 * 표시한다 — 다시 읽는 것은 **보이는(켜진) 쿼리뿐이고**, 숨은 것은 보이는 순간 읽힌다(S9).
 *
 * **걸린 폴더의 한 겹은 건너뛴다**(결정 37, `notOneLayer`) — 감시는 걸리지 않은 곳만 본다.
 */
export function invalidateWorktree(queryClient: QueryClient, slug: string, project: string): Promise<void> {
  return invalidateMerging(queryClient, { queryKey: [...worktreeKey(slug), project], predicate: notOneLayer });
}

/**
 * 그 work 셸의 「도는 중」이 끝났다 — 에이전트가 턴을 마쳤다(결정 34의 예비 신호). 그 work의 워크트리 데이터를 모두 낡았다고
 * 표시한다 — 감시가 놓친 것(커밋 등)을 턴마다 메운다. 다시 읽는 것은 보이는 쿼리뿐이다(S9).
 *
 * **걸린 폴더의 한 겹은 건너뛴다**(결정 37, `notOneLayer`). 턴 끝은 한 겹을 다시 읽는 세 때(펼칠 때 · 창 포커스 · 새로고침)에 들지
 * 않는다 — 새로고침 버튼의 문(`refreshWorktrees`)을 쓰면 턴마다 펼쳐 둔 `target/debug/deps`를 통째로 다시 읽는다.
 */
export function invalidateAfterTurn(queryClient: QueryClient, slug: string): Promise<void> {
  return invalidateMerging(queryClient, { queryKey: worktreeKey(slug), predicate: notOneLayer });
}

/**
 * 모든 work의 워크트리 데이터를 낡았다고 표시한다 — 창 포커스 신호(결정 34의 예비 신호). 감시가 못 보는 것(커밋 — 워크트리가
 * 아니라 본 저장소의 `.git`에서 일어난다)과 걸린 폴더 안을 메운다. 다시 읽는 것은 보이는 쿼리뿐이다.
 */
export function refreshAllWorktrees(queryClient: QueryClient): Promise<void> {
  return invalidateMerging(queryClient, { queryKey: WORKTREE_ROOT });
}

/**
 * 워크트리 데이터를 낡았다고 표시하는 문 — 신호 셋(감시 · 창 포커스 · 턴 끝)과 새로고침 버튼이 모두 여기를 지난다.
 *
 * **도는 조회를 버리고 새로 띄우지 않는다**(`cancelRefetch: false`). 에이전트가 이어 쓰면 신호가 디바운스(300ms)마다 오는데,
 * 버리고 띄우면 IPC는 못 끊어 git이 겹겹이 돌고, 트리를 읽는 데 그보다 오래 걸리는 워크트리에서는 답이 영영 서지 않는다.
 * 대신 **도는 동안 온 신호는 그 조회가 끝난 뒤 한 번 더 읽는다** — 그 조회는 쓰기 전을 읽었을 수 있다. 몇 번 왔든 한 번이다:
 * 뒤따르는 조회가 이미 돌고 있으면 거기에 합류한다(`works:changed`의 문 `invalidateWorks`와 같은 합치기).
 */
async function invalidateMerging(queryClient: QueryClient, filters: InvalidateQueryFilters): Promise<void> {
  const busy = queryClient
    .getQueryCache()
    .findAll(filters)
    .filter((query) => query.state.fetchStatus === "fetching");
  // 도는 조회는 새로 띄우지 않고 그것이 끝나기를 기다린다 — 나머지 보이는 쿼리는 여기서 다시 읽는다.
  await queryClient.invalidateQueries(filters, { cancelRefetch: false });
  await Promise.all(
    busy.map(({ queryKey }) => queryClient.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false })),
  );
}
