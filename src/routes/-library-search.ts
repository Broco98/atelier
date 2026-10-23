// Library 주소(`/library`)의 search 둘 — **지금 Work**(`work` — 그 Work의 Project 안 Agent를 따로 묶는다, v1 구현 스펙 S35)와 **고른
// Agent**(`agent` — 부르는 이름). 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다(`-work-search.ts`와 같다).
//
// **검증기가 주소를 청소하지 않는다** — 라우터는 검증한 값을 주소의 날값 위에 얹어 화면에 준다(`/library?work=3`의 `work`는 수 3으로
// 남는다). 그래서 화면도 같은 함수로 다시 읽는다(`readLibrarySearch`). 빈 글 · 글이 아닌 값은 없는 것이다.

export interface LibrarySearch {
  work?: string;
  agent?: string;
}

const word = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** 라우트의 검증기 — 글인 값만 남긴다. */
export function validateLibrarySearch(search: Record<string, unknown>): LibrarySearch {
  const [work, agent] = [word(search.work), word(search.agent)];
  return { ...(work !== undefined && { work }), ...(agent !== undefined && { agent }) };
}

/** 화면이 읽는 값 — 지금 Work(없으면 `null` — Library만)와 고른 Agent(없으면 첫 줄). */
export function readLibrarySearch(search: Record<string, unknown>): { work: string | null; agent: string | undefined } {
  const { work, agent } = validateLibrarySearch(search);
  return { work: work ?? null, agent };
}
