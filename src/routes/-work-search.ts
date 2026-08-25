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
}

export const validateWorkSearch = (search: Record<string, unknown>): WorkSearch =>
  search.tab === "terminal"
    ? { ...validateFileSearch(search), tab: "terminal" }
    : validateFileSearch(search);

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
 * work마다 **마지막으로 보던 본문**(결정 77). work을 옮길 때 새 주소를 짓는 씨앗이다.
 *
 * 앞 판은 work을 옮길 때 search를 통째로 비웠다. 그래야 하는 것은 `file` 하나였는데 —
 * 문서 경로는 그 work 안에서만 뜻이 있어 딸려가면 새 work에 없는 파일을 가리킨 채 주소만
 * 남는다 — `tab`은 그 이유에 해당하지 않는다. `spec`도 `terminal`도 어느 work에나 있고,
 * 터미널을 보다 옆 work을 잠깐 들여다보고 돌아왔을 때 문서로 떨어지는 것이 결정 77이
 * 없애려는 것이다. **`file`은 계속 떨어뜨린다.**
 *
 * **영속시키지 않는다.** 「무엇을 보고 있었나」는 위치이지 설정이 아니다 — 사이드바 접힘이
 * localStorage에 살고 slug 기억이 세션에만 사는 그 구분과 같은 쪽이다(shell-store).
 * 앱을 껐다 켜면 기본값 `spec`으로 돌아온다.
 *
 * 라우터 밖 모듈 스코프인 것은 이 값이 **주소가 아니기 때문이다.** 주소에 넣으면 뒤로가기가
 * 이 기억까지 되감아, 「돌아왔을 때 그 화면」이 히스토리 위치에 따라 갈린다.
 */
const lastTab = new Map<string, ViewTab>();

export function rememberTab(slug: string, tab: ViewTab): void {
  lastTab.set(slug, tab);
}

export function recallTab(slug: string): ViewTab {
  return lastTab.get(slug) ?? "spec";
}
