import { validateFileSearch } from "./-file-search";
import type { FileSearch } from "./-file-search";

// 보고 있는 **화면 탭**도 주소에 둔다 — `file`과 같은 이유다(이슈 #25). 탭이 주소에 없으면
// 링크와 새로고침이 늘 spec으로 떨어진다.
//
// **`tab`은 Works 전용이다**(결정 14). `file` 검증기는 Works와 아카이브가 일부러 공유하지만
// (같은 문서를 어느 화면에서 열든 뒤로가기가 같아야 해서) `tab`에는 그 이유가 없다 —
// 아카이브에는 터미널이 없다. 그래서 공용 검증기(`-file-search.ts`)는 그대로 두고 여기서만
// 얹는다. 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다.

export type ViewTab = "spec" | "terminal";

/**
 * 분할일 때 **spec이 어느 쪽에 서는가**(결정 97). 열 조합은 늘 `spec ▏터미널`이라
 * (결정 87) 좌우 하나로 족하다 — 열마다 상태를 따로 들면 `spec▏spec`이 표현 가능해진다.
 */
export type SplitSide = "lr" | "rl";

/**
 * 주소가 가리키는 work. `/works/…`가 아니면 `null`이다.
 *
 * **디코드가 필요하다** — 슬러그에 한글이 들어간다. 읽는 자리가 둘이라(사이드바 목록의
 * 강조, 가지가 자기 화면인지 아는 것) 한쪽만 디코드를 잊으면 한글 work에서만 조용히
 * 어긋난다 — 화면으로는 「가끔 강조가 안 된다」로만 보인다.
 */
export function workSlugOf(pathname: string): string | null {
  return pathname.startsWith("/works/")
    ? decodeURIComponent(pathname.slice("/works/".length))
    : null;
}

export interface WorkSearch extends FileSearch {
  /**
   * **`spec`은 주소에 쓰지 않는다.** 값이 없으면 spec이라는 규칙이 이미 있으므로
   * `tab=spec`은 같은 것을 두 번 적는 것이다(결정 14).
   */
  tab?: "terminal";
  /**
   * **분할도 주소에 적는다**(결정 97). 결정 70이 「주소가 정본」을 이미 정했으므로 분할만
   * 예외로 두면 규칙이 둘이 된다. 값이 없으면 단일 뷰다 — `tab`과 같은 규칙이라
   * `split=none` 같은 것을 쓰지 않는다.
   */
  split?: SplitSide;
}

export const validateWorkSearch = (search: Record<string, unknown>): WorkSearch => {
  const split = splitOf(search as { split?: string });
  return {
    ...validateFileSearch(search),
    ...(search.tab === "terminal" ? { tab: "terminal" as const } : {}),
    ...(split ? { split } : {}),
  };
};

/**
 * 주소가 말하는 분할. **`viewTab`과 같은 이유로 있다** — 루트에 검증기가 없어
 * `?split=zzz`가 그대로 컴포넌트까지 오므로, 모르는 값을 **단일 뷰로 눕히는 자리**를
 * 하나 둔다. 그 자리가 갈리면 화면마다 다른 값을 모르는 값으로 친다.
 */
export const splitOf = (search: { split?: string }): SplitSide | null =>
  search.split === "lr" || search.split === "rl" ? search.split : null;

/**
 * 주소가 말하는 화면 탭.
 *
 * **검증기만으로는 부족하다.** 이 라우터는 검증기의 결과를 부모의 raw search **위에 얹는다** —
 * 루트에는 검증기가 없어서 주소에 적힌 것이 전부 통과하고, `?tab=zzz`가 그대로 컴포넌트까지
 * 온다(실측으로 확인했다. `?file=`도 예전부터 같은 성질이다). 타입은 `"terminal" | undefined`
 * 라고 말하지만 런타임 값은 아무 문자열일 수 있으므로, **모르는 값을 spec으로 눕히는 자리를
 * 하나 둔다.** 그 자리가 갈리면 화면마다 다른 값을 모르는 값으로 친다.
 */
export const viewTab = (search: { tab?: string }): ViewTab =>
  search.tab === "terminal" ? "terminal" : "spec";

/**
 * 탭을 바꿀 때 주소의 `search`를 어떻게 고치는가. **함수형 갱신의 몸통이 여기 하나다.**
 *
 * 이 라우터는 `search`에 객체를 주면 기존 search를 통째로 버려서, 가장 자연스럽게 쓰는
 * 형태가 보던 문서(`file`)를 조용히 떨어뜨린다(결정 15). 그 사고를 막는 모양을 부르는 쪽마다
 * 다시 적으면, 검사하는 쪽도 그것을 **베껴 적게 되어** 실제 이동이 퇴화해도 초록이 된다.
 */
export function tabSearch<T extends object>(prev: T, next: ViewTab): T & { tab?: "terminal" } {
  return { ...prev, tab: next === "terminal" ? ("terminal" as const) : undefined };
}

/**
 * 문서를 바꿀 때 주소의 `search`를 어떻게 고치는가. **셋째 축이다.**
 *
 * 이 자리가 오래 비어 있었다. 주소에 `file` 하나뿐이던 시절에 쓴 `search: { file }`이
 * 그대로 살아, 판 04가 `tab`을 판 05가 `split`을 얹은 뒤로는 **문서를 고르는 것만으로
 * 분할이 무너졌다**(실측 — 위 `tabSearch` 머리말이 경고한 그 사고가 반대 방향으로 났다).
 * 축 셋이 한 파일에 나란히 서야 넷째가 생기는 날 같은 일이 안 난다.
 *
 * `tab`을 함께 spec으로 보내는 것은 결정 50이다 — 「문서를 고르면 spec으로 돌아온다」.
 * `split`은 건드리지 않는다: 분할 중이면 문서는 **이미 서 있는 열**의 내용일 뿐이다.
 */
export function fileSearch<T extends object>(
  prev: T,
  path: string,
): T & { file: string; tab?: "terminal" } {
  return { ...tabSearch(prev, "spec"), file: path };
}

/**
 * 분할을 바꿀 때 주소의 `search`를 어떻게 고치는가. `tabSearch`와 **같은 몸통**이다 —
 * 둘을 한 함수로 합치지 않는 것은 바꾸는 축이 둘이라서다: 열에 포커스가 들어가면 `tab`만
 * 바뀌고(분할은 그대로), 토글을 끄면 `split`만 바뀐다(남는 쪽은 `tab`이 이미 안다).
 */
export function splitSearch<T extends object>(
  prev: T,
  next: SplitSide | null,
): T & { split?: SplitSide } {
  return { ...prev, split: next ?? undefined };
}

/**
 * work마다 **마지막으로 보던 화면**(결정 77·97). 보던 문서·본문·분할을 함께 든다.
 *
 * **화면을 정하는 것은 주소이고 이 기억은 씨앗이다**(결정 97). work을 옮길 때 새 주소를
 * 무엇으로 지을지만 말한다 — 머물러 있는 동안의 정본은 언제나 주소다.
 *
 * 앞 판은 work을 옮길 때 search를 통째로 비웠다. 비워야 하는 것은 **떠나는 주소**다 —
 * 문서 경로는 그 work 안에서만 뜻이 있어 딸려가면 새 work에 없는 파일을 가리킨 채 주소만
 * 남는다. `tab`은 그 이유에 해당하지 않는다: `spec`도 `terminal`도 어느 work에나 있고,
 * 터미널을 보다 옆 work을 잠깐 들여다보고 돌아왔을 때 문서로 떨어지는 것이 결정 77이
 * 없애려는 것이다.
 *
 * **`file`도 그 work 자신의 것이면 해당하지 않는다.** 이 기억이 slug별 지도라 여기 적히는
 * 경로는 언제나 그 work 안의 것이고, 그래서 「문서 경로는 그 work 안에서만 뜻이 있다」가
 * 되살리는 쪽에서는 오히려 지켜진다 — 떠나는 주소를 버리는 일은 `viewSearch`가 **빈 객체
 * 위에** 얹는 것이 계속 한다. 셋을 함께 들어야 「마지막 보던 화면」이 온전하다(#156 수용
 * 기준 2 — 「문서·탭·분할이 살아 있다」). 적어 둔 문서가 그 사이에 사라져도 안전하다:
 * 주소가 없는 파일을 가리키면 화면이 기본 문서로 눕힌다(`WorksPage`의 `currentSpec`).
 *
 * **영속시키지 않는다.** 「무엇을 보고 있었나」는 위치이지 설정이 아니다 — 사이드바 접힘이
 * localStorage에 살고 slug 기억이 세션에만 사는 그 구분과 같은 쪽이다(shell-store).
 * 앱을 껐다 켜면 기본값 `spec`으로 돌아온다.
 *
 * 라우터 밖 모듈 스코프인 것은 이 값이 **주소가 아니기 때문이다.** 주소에 넣으면 뒤로가기가
 * 이 기억까지 되감아, 「돌아왔을 때 그 화면」이 히스토리 위치에 따라 갈린다.
 */
export interface WorkMemory {
  tab: ViewTab;
  split: SplitSide | null;
  /** 보던 문서. `null`은 주소에 `file`이 없는 것과 같은 뜻이다 — 기본 문서를 본다. */
  file: string | null;
}

const lastView = new Map<string, WorkMemory>();

export function rememberView(slug: string, view: WorkMemory): void {
  lastView.set(slug, view);
}

export function recallView(slug: string): WorkMemory {
  return lastView.get(slug) ?? { tab: "spec", split: null, file: null };
}

/**
 * 기억을 **빈 주소 위에 얹어** 새 주소를 짓는다 — 그래서 **떠나는 주소의** `file`이 안
 * 딸려가고, 얹히는 `file`은 언제나 그 work 자신의 것이다(위 주석).
 *
 * **여기를 직접 부르는 것은 기억을 안 쓰는 쪽뿐이다.** 「그 work의 기억을 씨앗으로 삼는다」는
 * 합성에는 아래 `recallSearch`라는 이름이 있고, work을 여는 문은 전부 그것을 탄다. 이
 * 머리말은 한때 「짓는 자리가 둘이라(주소 정규화·사이드바 행)」이라고 적었는데, 그 사이
 * 자리가 다섯이 되도록 그 수를 아무도 안 고쳤다 — 그래서 세는 일을 말에서 이름으로 옮겼다.
 * 남은 직접 호출은 `dropInto`의 남의 work 하나다(결정 101): 끌어 놓은 배치가 곧 말한
 * 것이라 기억을 안 얹는다.
 *
 * `fileSearch`를 쓰지 않는다 — 그쪽은 문서를 **고른** 자리의 규칙이라 `tab`을 spec으로
 * 눕히는데(결정 50), 여기서는 아무것도 안 골랐고 보던 화면을 그대로 세우는 것이라
 * 터미널을 보던 work은 터미널로 돌아와야 한다.
 */
export function viewSearch<T extends object>(
  prev: T,
  view: WorkMemory,
): T & { tab?: "terminal"; split?: SplitSide; file?: string } {
  return { ...splitSearch(tabSearch(prev, view.tab), view.split), file: view.file ?? undefined };
}

/**
 * **work을 여는 주소.** 그 work의 마지막 화면을 씨앗으로 삼는다(결정 77·97).
 *
 * 몸통은 한 줄인데 이름이 있어야 하는 것은 **부르는 자리가 다섯이기 때문이다** — 주소
 * 정규화(`-works-view`), 사이드바의 work 행, 팔레트의 work 줄과 문서·본문 줄
 * (`hit-target`), 그리고 Projects의 「이 프로젝트에서 시작된 작업」 행(`-projects-view`).
 * 합성을 자리마다 손으로 다시 적으면 **빠뜨린 문 하나가 조용하다**: 그 문으로 들어온 work은
 * 기본 화면으로 열리고, 도착한 주소를 적어 두는 effect(`-works-view`의 `rememberView`)가
 * 그 기본값으로 **기억을 덮어써** 다음에 다른 문으로 돌아와도 마지막 화면이 안 선다.
 * Projects 문이 실제로 그랬다.
 *
 * 그래서 세는 것도 이름 하나다 — 검사는 이 함수의 **값**을 재고 문마다 원문을 대조하지
 * 않는다(`-work-search.test.ts`). 원문 대조는 문이 늘 때마다 함께 늘어야 하는데, 늘지
 * 않은 것이 위 「둘」이다.
 */
export const recallSearch = (slug: string) => viewSearch({}, recallView(slug));
