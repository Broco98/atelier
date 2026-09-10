import type { Mode } from "@/mode";

/** 빈 자리가 하는 말 — 제목과 그 아래 한 줄. */
export interface ArchiveEmptyScreen {
  title: string;
  body: string;
}

interface ArchiveCopy {
  /** 목록 패널이 텅 빈 자리 — 짧게 말한다. 옆에 본문이 같은 말을 더 길게 하고 있다. */
  emptyList: ArchiveEmptyScreen;
  /** 본문 한가운데 — 아카이빙이 **무엇을 남기는지**까지 말한다. */
  emptyScreen: ArchiveEmptyScreen;
  /** 검색어가 좁혀서 0개 */
  noSearchMatch: string;
  /**
   * 프로젝트 필터가 좁혀서 0개. **`null`이면 그 세계에 필터가 없다는 뜻이다** — 문장과
   * 그것을 만드는 컨트롤이 한 값에서 나와야, 필터는 서는데 좁혀도 아무 말 안 하거나
   * (그 반대로) 화면 어디에서도 안 뜨는 문장이 표에 남는 판이 안 난다.
   */
  filteredOut: string | null;
}

/**
 * 아카이브 화면의 빈 자리들이 하는 말. **세계마다 낱말이 다르다**(#183·결정 17) — 갈래를
 * 판정하는 규칙은 하나이고 갈리는 것은 낱말뿐이라, 조건은 화면에 한 벌로 남고 문장만
 * 여기서 꺼내 간다. `works/work-sections.ts`의 `COPY`가 같은 종류의 표다.
 *
 * 그림 안에 리터럴로 두지 않는 이유도 그쪽과 같다: 이 화면을 두 세계로 나란히 세우려면
 * 쿼리 캐시를 심어야 해서 **낱말의 계약을 글자까지 재기가 그림에서 훨씬 비싸다.**
 * 여기서 글자를 재고, 화면이 실제로 이 표를 부르는지는 `ArchivePage.test.tsx`가 본다 —
 * 빈 화면 둘은 마크업으로, 좁혀서 0개일 때의 말은 렌더로 닿을 수 없어 소스 검사로.
 */
const COPY = {
  atelier: {
    emptyList: {
      title: "아직 치운 작업이 없어요",
      body: "끝난 작업의 ⋯ 메뉴에서 아카이빙하면 여기 남아요.",
    },
    emptyScreen: {
      title: "아직 치운 작업이 없어요",
      body: "끝난 작업의 ⋯ 메뉴에서 아카이빙하면 워크트리는 정리되고 스펙과 기록이 여기 남아요.",
    },
    noSearchMatch: "검색 결과가 없어요",
    filteredOut: "해당 프로젝트의 아카이브가 없어요",
  },
  maison: {
    emptyList: {
      title: "아직 치운 Room이 없어요",
      body: "끝난 Room의 ⋯ 메뉴에서 아카이빙하면 여기 남아요.",
    },
    emptyScreen: {
      title: "아직 치운 Room이 없어요",
      // 「워크트리는 정리되고」가 빠진다 — Room에는 워크트리가 없다(결정 17). 이 세계에
      // 없는 것을 치워 준다고 말하면, 사용자는 그 말에서 Room에도 워크트리가 있다고 배운다.
      body: "끝난 Room의 ⋯ 메뉴에서 아카이빙하면 스펙과 기록이 여기 남아요.",
    },
    noSearchMatch: "검색 결과가 없어요",
    // Maison에는 프로젝트가 없으니 필터도 없다(결정 17). 문장을 하나 지어 넣으면 화면
    // 어디에도 안 뜨는 죽은 문장이 표에 앉고, 다음 사람이 그것을 고치며 뜬다고 믿는다.
    filteredOut: null,
  },
} as const satisfies Record<Mode, ArchiveCopy>;

/** 목록 패널이 텅 빈 자리. */
export function emptyListCopy(mode: Mode): ArchiveEmptyScreen {
  return COPY[mode].emptyList;
}

/** 본문 한가운데의 빈 화면. */
export function emptyScreenCopy(mode: Mode): ArchiveEmptyScreen {
  return COPY[mode].emptyScreen;
}

/**
 * 이 세계에 프로젝트 필터가 서는가. **필터가 만든 문장이 있는 세계가 곧 그 세계다** —
 * 컨트롤과 문장을 따로 가르면 한쪽만 고친 커밋이 위 두 판 중 하나를 만든다.
 */
export function hasProjectFilter(mode: Mode): boolean {
  return COPY[mode].filteredOut !== null;
}

/**
 * 목록에는 뭔가 있는데 **좁혀서** 0개일 때 하는 말. 좁힌 것은 검색어 아니면 프로젝트
 * 필터 둘뿐이고, 검색어가 이긴다 — 방금 친 글자가 화면이 비게 만든 이유로 더 가깝다.
 *
 * 필터가 없는 세계에서는 검색어 말고 좁힐 것이 없으므로 언제나 검색 쪽이다. 이 갈래를
 * 세계로 가르지 않고 표의 `null`로 가르는 이유가 그것이다 — 도달할 수 없는 문장이
 * 화면 코드에 남으면 다음 사람이 그것을 고치며 뜬다고 믿는다.
 */
export function narrowedNotice(mode: Mode, searching: boolean): string {
  const copy = COPY[mode];
  return !searching && copy.filteredOut !== null ? copy.filteredOut : copy.noSearchMatch;
}
