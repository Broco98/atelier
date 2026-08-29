import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { searchQuery } from "./hooks";
import type { SearchResults } from "./types";

// **디바운스를 안 두는 대신 늦게 온 답을 버린다**(결정 29). 막아야 할 것은 비용이 아니라
// 순서 뒤바뀜이다 — 실측 10~20ms짜리 일에 지연을 얹으면 「치는 동안 즉시 따라온다」를 스스로
// 깨는 것이다.
//
// 그 규칙은 훅이 아니라 **옵션**이 든다(질의가 queryKey에 실린다). 이 저장소의 L2에는 DOM이
// 없어 훅을 렌더할 수 없지만, 옵션을 `QueryObserver`에 그대로 물리면 화면이 보는 것과 같은
// 것을 잰다 — `useQuery`가 하는 일이 그 관찰자를 다는 것이다.
//
// 답을 **손으로 붙잡는다.** 순서를 뒤집을 수 없으면 이 검사는 늘 초록이고 아무것도 안 잰다.
const { pending } = vi.hoisted(() => ({
  pending: new Map<string, (results: unknown) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (_command: string, args: { query: string }) =>
    new Promise((resolve) => {
      pending.set(args.query, resolve);
    }),
}));

const results = (path: string): SearchResults => ({
  hits: [{ kind: "doc", slug: "가", title: "가 작업", path, archived: false }],
  truncated: false,
});

/** 붙잡아 둔 답을 놓아 주고 자리가 잡히기를 기다린다. */
async function answer(query: string, path: string) {
  const resolve = pending.get(query);
  if (!resolve) throw new Error(`\`${query}\`로 묻지 않았다 — 붙잡은 것: ${[...pending.keys()]}`);
  resolve(results(path));
  await new Promise((done) => setTimeout(done, 0));
}

/** 화면 하나를 세운다. 구독이 곧 첫 물음이다. */
function watch(query: string) {
  const observer = new QueryObserver(new QueryClient(), searchQuery(query));
  const seen: (string | undefined)[] = [];
  observer.subscribe((result) => seen.push((result.data as SearchResults | undefined)?.hits[0].path));
  return { observer, seen, shown: () => (observer.getCurrentResult().data as SearchResults | undefined)?.hits[0].path };
}

describe("빨리 칠 때", () => {
  it("늦게 온 답이 화면을 덮지 않는다", async () => {
    const { observer, seen, shown } = watch("가");
    await new Promise((done) => setTimeout(done, 0));

    // 앞 질의의 답이 오기 전에 한 글자를 더 친다.
    observer.setOptions(searchQuery("가나"));
    await new Promise((done) => setTimeout(done, 0));

    // 순서가 뒤집혀 도착한다 — 지금 질의의 답이 먼저, 지나간 질의의 답이 나중에.
    await answer("가나", "지금.md");
    await answer("가", "지나간.md");

    expect(shown()).toBe("지금.md");
    // 한 번도 스쳐 지나가지 않았어야 한다. 마지막 값만 보면 덮었다가 되돌아온 것도 초록이다.
    expect(seen).not.toContain("지나간.md");
  });

  // 키가 바뀔 때마다 목록이 비면 **글자 하나마다 「맞는 것이 없습니다」가 깜빡인다** — 그것은
  // 「치는 동안 즉시 따라온다」의 반대다.
  it("다음 답이 오는 동안 앞 답이 서 있는다", async () => {
    const { observer, shown } = watch("가");
    await answer("가", "먼저.md");
    expect(shown()).toBe("먼저.md");

    observer.setOptions(searchQuery("가나"));
    await new Promise((done) => setTimeout(done, 0));
    expect(shown(), "다음 답을 기다리는 동안 목록이 비었다").toBe("먼저.md");

    await answer("가나", "다음.md");
    expect(shown()).toBe("다음.md");
  });
});
