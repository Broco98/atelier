import type { CodeTarget } from "@/features/terminal/shell-registry";
import { validateFileSearch } from "./-file-search";
import type { FileSearch } from "./-file-search";

// 보고 있는 **화면 탭**도 주소에 둔다 — `file`과 같은 이유다(이슈 #25). 탭이 주소에 없으면
// 링크와 새로고침이 늘 spec으로 떨어진다.
//
// **`tab`은 Works 전용이다**(결정 14). `file` 검증기는 Works와 아카이브가 일부러 공유하지만
// (같은 문서를 어느 화면에서 열든 뒤로가기가 같아야 해서) `tab`에는 그 이유가 없다 —
// 아카이브에는 터미널이 없다. 그래서 공용 검증기(`-file-search.ts`)는 그대로 두고 여기서만
// 얹는다. 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다.

/**
 * **주소에 적히는 화면 탭** — `spec`을 뺀 나머지다(`spec`은 주소에 쓰지 않는다 — 결정 14). 화면 탭 값이 느는 자리가
 * 이 목록 한 줄이다(three-axes 결정 9 — `chat` 탭이 여기 더해진다). 검증기 · `viewTab` · `tabSearch`가 전부 이 목록을
 * 읽으므로, 값 하나를 더하면 주소에 적히는 것과 모르는 값을 `spec`으로 눕히는 것이 함께 따라온다.
 *
 * `code`는 **파일 탭**이다(git-integration 결정 33 · S12) — 어느 파일인지는 따로 `code` 키가 말한다(`WorkSearch.code`).
 */
const ADDRESS_TABS = ["terminal", "code"] as const;
export type AddressTab = (typeof ADDRESS_TABS)[number];

/** 주소에 적힐 수 있는 화면 탭이면 그 값, 아니면 `null`(`spec`도 `null`이다 — 주소에 안 쓴다). 대소문자 · 공백을 안 봐준다. */
const addressTabOf = (value: unknown): AddressTab | null =>
  ADDRESS_TABS.find((tab) => tab === value) ?? null;

export type ViewTab = "spec" | AddressTab;

/**
 * 분할의 **열**(결정 87). 열 조합은 늘 `spec ▏ 묶음의 지금 탭`이라 이 둘뿐이다 — 화면 탭이 늘어도(위 목록) 여기는
 * 안 는다(three-axes S21 — 넘겨받은 탭은 분할에 들지 않는다). 분할을 다루는 자리가 `ViewTab`이 아니라 이것을 받아야
 * 새 화면 탭이 분할로 새는 것을 컴파일이 막는다.
 *
 * **`terminal`은 묶음 열이다**(git-integration 결정 32) — 묶음의 지금 탭이 셸이든 파일 탭이든 그 열에 선다. 이름은 셸만 서던
 * 때의 것이다. 그 열에 무엇이 서는지는 주소의 `code`가 말한다(아래 `columnSearch`).
 */
export type ColumnTab = "spec" | "terminal";

/**
 * 분할일 때 **spec이 어느 쪽에 서는가**(결정 97). 열 조합은 늘 `spec ▏ 묶음의 지금 탭`이라
 * (결정 87) 좌우 하나로 족하다 — 열마다 상태를 따로 들면 `spec▏spec`이 표현 가능해진다.
 */
export type SplitSide = "lr" | "rl";

export interface WorkSearch extends FileSearch {
  /**
   * **묶음의 지금 탭인 파일 탭**(git-integration 결정 33 · S12) — `<프로젝트>/<워크트리 기준 경로>`, 첫 조각이 프로젝트다.
   * 단일 뷰에서는 `tab=code`와 함께만, 분할에서는 **묶음 열**이 그 파일일 때 뜻이 있다(`tab`이 어느 열을 가리키든). 지금 탭이
   * 셸이면 이 키가 없다(`tabSearch`가 지운다). 열린 파일 탭 목록은 주소에 싣지 않는다 — 묶음은 메모리에 산다(결정 33).
   */
  code?: string;
  /**
   * **`spec`은 주소에 쓰지 않는다.** 값이 없으면 spec이라는 규칙이 이미 있으므로
   * `tab=spec`은 같은 것을 두 번 적는 것이다(결정 14).
   */
  tab?: AddressTab;
  /**
   * **분할도 주소에 적는다**(결정 97). 결정 70이 「주소가 정본」을 이미 정했으므로 분할만
   * 예외로 두면 규칙이 둘이 된다. 값이 없으면 단일 뷰다 — `tab`과 같은 규칙이라
   * `split=none` 같은 것을 쓰지 않는다.
   */
  split?: SplitSide;
}

export const validateWorkSearch = (search: Record<string, unknown>): WorkSearch => {
  const split = splitOf(search as { split?: string });
  const tab = addressTabOf(search.tab);
  const code = codeOf(search);
  return {
    ...validateFileSearch(search),
    ...(tab ? { tab } : {}),
    ...(code ? { code } : {}),
    ...(split ? { split } : {}),
  };
};

/**
 * 주소가 말하는 파일 탭(`<프로젝트>/<경로>`). **`viewTab`과 같은 이유로 있다** — 검증기가 주소를 청소하지 않으므로 모르는
 * 모양을 눕히는 자리를 하나 둔다. 프로젝트 조각도 경로 조각도 비어 있으면 안 된다 — 그런 주소는 `null`이고, `tab=code`와
 * 함께여도 화면은 spec이다(`viewTab`). 경로 안의 `..` 같은 것은 여기서 안 본다: 읽는 자리(코어)가 거절하고 탭 안에 그
 * 까닭이 선다.
 */
export const codeOf = (search: { code?: unknown }): string | null => {
  if (typeof search.code !== "string") return null;
  const target = codeTargetOf(search.code);
  return target ? search.code : null;
};

/** 주소의 `code` 값을 파일 탭의 정체로 — 첫 `/` 앞이 프로젝트다. 둘 중 하나가 비면 `null`이다. */
export function codeTargetOf(ref: string): CodeTarget | null {
  const at = ref.indexOf("/");
  if (at <= 0 || at === ref.length - 1) return null;
  return { project: ref.slice(0, at), path: ref.slice(at + 1) };
}

/** 파일 탭의 정체를 주소의 `code` 값으로 — `codeTargetOf`의 반대다. */
export const codeRefOf = (target: CodeTarget): string => `${target.project}/${target.path}`;

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
 * 온다(실측으로 확인했다. `?file=`도 예전부터 같은 성질이다). 타입은 `AddressTab | undefined`
 * 라고 말하지만 런타임 값은 아무 문자열일 수 있으므로, **모르는 값을 spec으로 눕히는 자리를
 * 하나 둔다.** 그 자리가 갈리면 화면마다 다른 값을 모르는 값으로 친다.
 */
export const viewTab = (search: { tab?: string; code?: string }): ViewTab => {
  const tab = addressTabOf(search.tab);
  // **`tab=code`인데 가리키는 파일이 없으면 spec이다**(git-integration S12) — 열 파일 탭이 없다.
  if (tab === "code" && codeOf(search) === null) return "spec";
  return tab ?? "spec";
};

/**
 * 탭을 바꿀 때 주소의 `search`를 어떻게 고치는가. **함수형 갱신의 몸통이 여기 하나다.**
 *
 * 이 라우터는 `search`에 객체를 주면 기존 search를 통째로 버려서, 가장 자연스럽게 쓰는
 * 형태가 보던 문서(`file`)를 조용히 떨어뜨린다(결정 15). 그 사고를 막는 모양을 부르는 쪽마다
 * 다시 적으면, 검사하는 쪽도 그것을 **베껴 적게 되어** 실제 이동이 퇴화해도 초록이 된다.
 */
export function tabSearch<T extends object>(prev: T, next: ViewTab): T & { tab?: AddressTab; code?: string } {
  // **`code`를 함께 지운다** — 지금 탭이 셸이거나 문서면 주소에 파일이 없다(S12). 파일 탭으로 가는 길은 `code`를 다시
  // 얹는 `codeSearch` 하나다.
  //
  // **분할이면 셸로 갈 때만 지운다**(git-integration 티켓 07). 분할의 `code`는 **묶음 열**의 것이라 `tab`이 다른 열을 가리켜도
  // (문서 열에 포커스 · ⌘1 · 문서 고르기) 그 열은 그대로 그 파일이다. 셸로 가는 것만 묶음 열을 셸로 바꾼다.
  const keepsCode = next !== "terminal" && splitOf(prev as { split?: string }) !== null;
  return {
    ...prev,
    tab: next === "spec" ? undefined : next,
    code: keepsCode ? (prev as { code?: string }).code : undefined,
  };
}

/**
 * 파일 탭으로 갈 때 주소의 `search`를 어떻게 고치는가. **넷째 축이다**(아래 `fileSearch`의 머리말 — 축이 한 파일에 나란히
 * 서야 다음 축이 생기는 날 같은 사고가 안 난다).
 *
 * `tab=code`와 `code`를 함께 적는다. **분할은 그대로다**(git-integration 티켓 07) — 분할 중이면 그 파일이 묶음 열에 선다(결정 32).
 * 보던 문서(`file`)도 그대로 둔다: spec으로 돌아오면 그 문서다.
 */
export function codeSearch<T extends object>(prev: T, ref: string): T & { tab?: AddressTab; code: string } {
  return { ...tabSearch(prev, "code"), code: ref };
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
): T & { file: string; tab?: AddressTab } {
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
 * 분할을 켜고 끄거나 열을 고를 때 주소의 `search`를 어떻게 고치는가. **다섯째 축 — 열이다**(git-integration 티켓 07).
 *
 * 분할의 한쪽은 spec, 다른 쪽은 **묶음 열**이고 거기 묶음의 지금 탭이 선다 — 셸이든 파일 탭이든(결정 32). 그 열에 무엇이 서는지는
 * 화면만 안다(묶음은 메모리에 산다 — 문서를 보다 분할을 켜면 주소에 없던 파일 탭이 그 열에 선다). 그래서 세 값을 받아 한 번에
 * 적는다: 분할(`split`), 가리키는 열(`column` — 분할을 끄면 남는 쪽이다, 결정 97), 묶음 열에 설 파일 탭(`bundle` — 묶음의 지금
 * 탭이 셸이면 `null`). 묶음 열을 가리키는 `tab`은 그 열에 선 것의 종류다 — 파일 탭이면 `code`, 셸이면 `terminal`.
 *
 * 분할을 끄고 문서가 남으면 `code`가 빠진다 — 단일 뷰의 `code`는 `tab=code`와만 산다. 셋을 따로 옮기면 한 틱에 겹쳐 앞의 것이
 * 버려진다(위 `splitSearch` 머리말).
 */
export function columnSearch<T extends object>(
  prev: T,
  split: SplitSide | null,
  column: ColumnTab,
  bundle: string | null,
): T & { split?: SplitSide; tab?: AddressTab; code?: string } {
  const code = split !== null || column === "terminal" ? bundle : null;
  return {
    ...prev,
    split: split ?? undefined,
    tab: column === "spec" ? undefined : code !== null ? "code" : "terminal",
    code: code ?? undefined,
  };
}

/**
 * 묶음의 지금 탭이 **묶음 쪽에서** 바뀌었을 때 주소를 어떻게 고치는가 — 지금 탭을 닫아 이웃이 켜졌거나(결정 30), 셸이 스스로
 * 끝나 빠졌거나, 끌어 놓은 칸이 켜졌다. 본문(단일 뷰)이나 묶음 열(분할)이 그 탭을 따라간다: 파일 탭이면 `code`가 그것이고
 * 셸이면 없다(`bundle`이 `null`). 분할에서 문서 열을 가리키던 `tab`은 그대로다 — 바뀐 것은 옆 열이다. 본문이 문서인 단일
 * 뷰는 아무것도 안 바뀐다 — 묶음이 화면에 없다.
 *
 * **고칠 것을 모두 `prev`에서 읽는다.** 묶음의 변화는 다른 이동과 한 틱에 겹친다 — 셸 탭을 끌어 본문 절반에 놓으면 그 셸을 켜는
 * 것과 분할을 켜는 주소가 함께 난다. 화면이 들고 있던 `tab` · `split`으로 지으면 한 틱 늦은 값이 방금 놓은 분할을 덮는다.
 */
export function bundleSearch<T extends object>(prev: T, bundle: string | null): T & { tab?: AddressTab; code?: string } {
  const search = prev as { tab?: string; code?: string; split?: string };
  const tab = viewTab(search);
  if (tab === "spec" && splitOf(search) === null) return { ...prev, tab: undefined, code: undefined };
  return {
    ...prev,
    tab: tab === "spec" ? undefined : bundle !== null ? "code" : "terminal",
    code: bundle ?? undefined,
  };
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
  /**
   * 보던 파일 탭(`<프로젝트>/<경로>`, git-integration S12). `tab`이 `code`일 때만 찬다. 돌아오면 그 탭이 묶음의 지금 탭이 되고,
   * 그 사이 탭을 닫았으면 끝에 다시 연다(주소가 가리키는 파일은 연다 — 스토리 60).
   */
  code: string | null;
}

/** work마다 마지막으로 보던 화면. **키가 slug다** — 세션 동안만 산다. */
const lastView = new Map<string, WorkMemory>();

export function rememberView(slug: string, view: WorkMemory): void {
  lastView.set(slug, view);
}

export function recallView(slug: string): WorkMemory {
  return lastView.get(slug) ?? { tab: "spec", split: null, file: null, code: null };
}

/**
 * 기억을 **빈 주소 위에 얹어** 새 주소를 짓는다 — 그래서 **떠나는 주소의** `file`이 안
 * 딸려가고, 얹히는 `file`은 언제나 그 work 자신의 것이다(위 주석).
 *
 * **여기를 직접 부르는 것은 기억을 안 쓰는 쪽뿐이다.** 「그 work의 기억을 씨앗으로 삼는다」는
 * 합성에는 아래 `recallSearch`라는 이름이 있고, work을 여는 문은 전부 그것을 탄다. 이
 * 머리말은 한때 「짓는 자리가 둘이라(주소 정규화·사이드바 행)」이라고 적었는데, 그 사이
 * 자리가 다섯이 되도록 그 수를 아무도 안 고쳤다 — 그래서 세는 일을 말에서 이름으로 옮겼다.
 * 기억을 안 쓰는 쪽이 하나 있다 — `dropInto`의 남의 work이다(결정 101): 끌어 놓은 배치가 곧 말한
 * 것이라 기억을 안 얹는다. 그 배치는 열 축이라 빈 주소 위에 `columnSearch`로 짓는다(git-integration 티켓 07).
 *
 * `fileSearch`를 쓰지 않는다 — 그쪽은 문서를 **고른** 자리의 규칙이라 `tab`을 spec으로
 * 눕히는데(결정 50), 여기서는 아무것도 안 골랐고 보던 화면을 그대로 세우는 것이라
 * 터미널을 보던 work은 터미널로 돌아와야 한다.
 */
export function viewSearch<T extends object>(
  prev: T,
  view: WorkMemory,
): T & { tab?: AddressTab; split?: SplitSide; file?: string; code?: string } {
  return {
    ...splitSearch(tabSearch(prev, view.tab), view.split),
    file: view.file ?? undefined,
    code: view.code ?? undefined,
  };
}

/**
 * **work을 여는 주소.** 그 work의 마지막 화면을 씨앗으로 삼는다(결정 77·97).
 *
 * 몸통은 한 줄인데 이름이 있어야 하는 것은 **부르는 자리가 여섯이기 때문이다** — 주소
 * 정규화(`-works-view`), 사이드바의 work 행, 셸로 가는 길(`useGoToShell` — 알림 띠의
 * 줄과 ⌘J 방금 부른 셸로), 팔레트의 work 줄과 문서·본문 줄(`hit-target`), 그리고 Projects의
 * 「이 프로젝트에서 시작된 작업」 행(`-projects-view`).
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
