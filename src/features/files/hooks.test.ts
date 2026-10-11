import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { codeFileQuery } from "@/features/code/hooks";
import { queryClient } from "@/query-client";
import {
  invalidateAfterTurn,
  invalidateWorktree,
  refreshAllWorktrees,
  refreshWorktrees,
  worktreeFolderQuery,
  worktreeTreeQuery,
} from "./hooks";

// 워크트리 데이터를 낡았다고 표시하는 문 넷이 **무엇을 지우는지**(결정 34 · 37). 다시 읽는 것은 보이는 쿼리뿐이라(S9) 그 수는
// L3(`files-live`)가 재고, 여기서는 표시만 본다 — 훅을 렌더하지 않는다(이 저장소의 L2에는 DOM이 없다).
//
// 키는 **쿼리가 짓는 것을 그대로 쓴다** — 손으로 같은 모양을 다시 지으면 진짜 키가 갈래를 옮겨도 초록이다(works 쪽 `hooks.test.ts`와
// 같은 까닭).
const KEYS = {
  tree: worktreeTreeQuery("가", "billing", true).queryKey,
  /** 펼쳐 둔 걸린 폴더의 한 겹 */
  folder: worktreeFolderQuery("가", "billing", "dist", true).queryKey,
  file: codeFileQuery("가", "billing", "src/main.ts").queryKey,
  otherProject: worktreeTreeQuery("가", "ledger", true).queryKey,
  otherWork: worktreeTreeQuery("나", "billing", true).queryKey,
};
type Marked = Record<keyof typeof KEYS, boolean>;

function seeded(): QueryClient {
  const client = new QueryClient();
  for (const key of Object.values(KEYS)) client.setQueryData<unknown>([...key], "값");
  return client;
}

/** 키마다 낡았다고 표시됐는가. */
function marked(client: QueryClient): Marked {
  const entries = Object.entries(KEYS).map(([name, key]) => [name, client.getQueryState([...key])?.isInvalidated]);
  return Object.fromEntries(entries) as Marked;
}

describe("워크트리 무효화 문", () => {
  it("`worktree:changed`는 그 (slug, 프로젝트)의 트리와 파일 내용만 — 걸린 폴더의 한 겹은 건너뛴다", async () => {
    const client = seeded();
    await invalidateWorktree(client, "가", "billing");
    expect(marked(client)).toEqual({ tree: true, folder: false, file: true, otherProject: false, otherWork: false });
  });

  // 결정 37 — 걸린 폴더 안은 펼칠 때 · 창 포커스 · 새로고침에만 다시 읽는다. 턴 끝은 그 셋에 들지 않는다. 새로고침 버튼과 같은 문을
  // 쓰면 턴마다 펼쳐 둔 `target/debug/deps`를 통째로 다시 읽는다.
  it("「도는 중」 끝은 그 work의 워크트리 전부 — 걸린 폴더의 한 겹은 건너뛴다", async () => {
    const client = seeded();
    await invalidateAfterTurn(client, "가");
    expect(marked(client)).toEqual({ tree: true, folder: false, file: true, otherProject: true, otherWork: false });
  });

  it("새로고침 버튼은 그 work의 워크트리 전부 — 걸린 폴더의 한 겹까지", async () => {
    const client = seeded();
    await refreshWorktrees(client, "가");
    expect(marked(client)).toEqual({ tree: true, folder: true, file: true, otherProject: true, otherWork: false });
  });

  it("창 포커스는 모든 work의 워크트리 전부 — 걸린 폴더의 한 겹까지", async () => {
    const client = seeded();
    await refreshAllWorktrees(client);
    expect(marked(client)).toEqual({ tree: true, folder: true, file: true, otherProject: true, otherWork: true });
  });
});

// **워크트리 쿼리 셋은 창으로 돌아올 때 react-query가 스스로 다시 읽지 않는다**(S33). 창 포커스로 다시 읽는 길은 앱 루트의 window
// `focus` 하나다 — 기본값(`visibilitychange`를 듣는다)과 함께 서면 한 번 돌아올 때 두 번 읽는다. 그 수는 L3(`files-live`의 「창으로
// 돌아오기」)가 `visibilitychange`와 `focus`를 함께 쏴 잰다.
//
// 값은 **앱 캐시가 합친 값**(`defaultQueryOptions`)으로 잰다 — 앱 캐시의 기본 옵션에서 켜고 끄는 것까지 한 값에 든다(works 쪽 같은
// 검사의 까닭).
describe("창 포커스 재조회", () => {
  it("트리 · 한 겹 · 파일 내용 쿼리는 끈다", () => {
    const merged = {
      tree: queryClient.defaultQueryOptions(worktreeTreeQuery("가", "billing", true)).refetchOnWindowFocus,
      folder: queryClient.defaultQueryOptions(worktreeFolderQuery("가", "billing", "dist", true)).refetchOnWindowFocus,
      file: queryClient.defaultQueryOptions(codeFileQuery("가", "billing", "src/main.ts")).refetchOnWindowFocus,
    };
    expect(merged).toEqual({ tree: false, folder: false, file: false });
  });
});
