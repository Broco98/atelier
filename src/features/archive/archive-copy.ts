/** 빈 자리가 하는 말 — 제목과 그 아래 한 줄. */
interface ArchiveEmptyScreen {
  title: string;
  body: string;
}

/**
 * 아카이브 화면의 빈 자리들이 하는 말. `works/work-sections.ts`의 `WORKS_COPY`가 같은 종류의 표다.
 *
 * 그림 안에 리터럴로 두지 않는 이유도 그쪽과 같다: 이 화면은 쿼리 캐시를 심어야 서서 **낱말의 계약을 글자까지 재기가
 * 그림에서 훨씬 비싸다.** 여기서 글자를 재고(`archive-copy.test.ts`), 화면이 실제로 이 표를 부르는지는
 * `ArchivePage.test.tsx`가 본다 — 빈 화면 둘은 마크업으로, 좁혀서 0개일 때의 말은 렌더로 닿을 수 없어 소스 검사로.
 */
export const ARCHIVE_COPY = {
  /** 목록 패널이 텅 빈 자리 — 짧게 말한다. 옆에 본문이 같은 말을 더 길게 하고 있다. */
  emptyList: {
    title: "아직 치운 작업이 없어요",
    body: "끝난 작업의 ⋯ 메뉴에서 아카이빙하면 여기 남아요.",
  },
  /** 본문 한가운데 — 아카이빙이 **무엇을 남기는지**까지 말한다. */
  emptyScreen: {
    title: "아직 치운 작업이 없어요",
    body: "끝난 작업의 ⋯ 메뉴에서 아카이빙하면 워크트리는 정리되고 스펙과 기록이 여기 남아요.",
  },
} as const satisfies Record<string, ArchiveEmptyScreen>;

/**
 * 목록에는 뭔가 있는데 **좁혀서** 0개일 때 하는 말. 좁힌 것은 검색어 아니면 프로젝트
 * 필터 둘뿐이고, 검색어가 이긴다 — 방금 친 글자가 화면이 비게 만든 이유로 더 가깝다.
 */
export function narrowedNotice(searching: boolean): string {
  return searching ? "검색 결과가 없어요" : "해당 프로젝트의 아카이브가 없어요";
}
