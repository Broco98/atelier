import type { CodeTarget } from "@/features/terminal/shell-registry";
import type { WorkGone } from "@/features/thread/types";
import type { WorkLanding } from "@/features/thread/work-threads";
import { validateFileSearch } from "./-file-search";
import type { FileSearch } from "./-file-search";

// 보고 있는 **화면 탭**도 주소에 둔다 — `file`과 같은 이유다(이슈 #25). 탭이 주소에 없으면
// 링크와 새로고침이 늘 기본 값으로 떨어진다.
//
// **`tab`은 Works 전용이다**(결정 14). `file` 검증기는 Works와 아카이브가 일부러 공유하지만
// (같은 문서를 어느 화면에서 열든 뒤로가기가 같아야 해서) `tab`에는 그 이유가 없다 —
// 아카이브에는 터미널이 없다. 그래서 공용 검증기(`-file-search.ts`)는 그대로 두고 여기서만
// 얹는다. 파일명의 "-" 접두사는 라우트 생성기가 이 파일을 라우트로 취급하지 않게 한다.

/**
 * **주소에 적히는 화면 탭.** 화면 탭 값이 느는 자리가 이 목록 한 줄이다. 검증기 · `viewTab` · `tabSearch`가 전부 이 목록을
 * 읽으므로, 값 하나를 더하면 주소에 적히는 것과 모르는 값을 기본 값으로 눕히는 것이 함께 따라온다.
 *
 * - `chat`은 **채팅 탭**이다(restart 02a-4) — 어느 채팅인지는 따로 `thread` 키가 말한다(`WorkSearch.thread`). `spec`이 맡던 기본
 *   값을 물려받아, 값이 없거나 모르는 값이면 채팅 탭으로 읽는다(`viewTab`).
 * - `code`는 **파일 탭**이다(git-integration 결정 33 · S12) — 어느 파일인지는 따로 `code` 키가 말한다(`WorkSearch.code`).
 *
 * **`spec`(문서 탭)은 없다**(restart 02a-13 · 구현 스펙 「02a — `spec` 탭과 분할을 지운다」). 문서는 spec 패널의 문서 줄에서 채팅 탭의 넓힌 카드로
 * 연다(`file`). 옛 `?tab=spec`은 모르는 값이라 처음 여는 주소다(`opensWork`).
 */
const ADDRESS_TABS = ["chat", "terminal", "code"] as const;
export type AddressTab = (typeof ADDRESS_TABS)[number];

/** 주소에 적힐 수 있는 화면 탭이면 그 값, 아니면 `null`. 대소문자 · 공백을 안 봐준다. */
const addressTabOf = (value: unknown): AddressTab | null =>
  ADDRESS_TABS.find((tab) => tab === value) ?? null;

/** 화면 탭 — 주소에 적히는 값 그대로다. */
export type ViewTab = AddressTab;

/**
 * **분할은 없다**(restart 02a-13) — 한때 `split=lr|rl`로 `spec ▏ 묶음의 지금 탭`을 적었다(결정 97). 주소를 고치는 짝은 `split`을 적지도 걷지도
 * 않는다. 옛 주소에 남은 `split`은 모르는 키라 아무도 읽지 않는다.
 */
export interface WorkSearch extends FileSearch {
  /**
   * **묶음의 지금 탭인 파일 탭**(git-integration 결정 33 · S12) — `<프로젝트>/<워크트리 기준 경로>`, 첫 조각이 프로젝트다.
   * `tab=code`와 함께만 뜻이 있다. 지금 탭이 셸이면 이 키가 없다(`tabSearch`가 지운다). 열린 파일 탭 목록은 주소에 싣지 않는다 —
   * 묶음은 메모리에 산다(결정 33).
   */
  code?: string;
  /**
   * **채팅 탭인 채팅의 id**(restart 02a-4) — `code`와 같은 성질이다. `tab=chat`과 함께만 뜻이 있다. 지금 탭이 채팅이 아니면 이 키가
   * 없다(`tabSearch`가 지운다) — 그래서 이 키가 곧 「켜진 채팅」이다(`@/lib/path-prefix`의 `threadIdOf`가 그렇게 읽는다). 열린 채팅 탭
   * 목록은 주소에 싣지 않는다 — 묶음은 메모리에 산다.
   */
  thread?: string;
  /** 값이 없으면 채팅 탭으로 읽는다(`viewTab`). */
  tab?: AddressTab;
}

export const validateWorkSearch = (search: Record<string, unknown>): WorkSearch => {
  const tab = addressTabOf(search.tab);
  const code = codeOf(search);
  const thread = threadOf(search);
  return {
    ...validateFileSearch(search),
    ...(tab ? { tab } : {}),
    ...(code ? { code } : {}),
    ...(thread ? { thread } : {}),
  };
};

/** 주소가 말하는 채팅(`thread`). 빈 글자 · 글자가 아닌 값은 `null`이다 — 검증기가 주소를 청소하지 않는다(`viewTab` 머리말). */
export const threadOf = (search: { thread?: unknown }): string | null =>
  typeof search.thread === "string" && search.thread !== "" ? search.thread : null;

/**
 * 주소가 말하는 파일 탭(`<프로젝트>/<경로>`). **`viewTab`과 같은 이유로 있다** — 검증기가 주소를 청소하지 않으므로 모르는
 * 모양을 눕히는 자리를 하나 둔다. 프로젝트 조각도 경로 조각도 비어 있으면 안 된다 — 그런 주소는 `null`이고, `tab=code`와
 * 함께여도 화면은 기본 값이다(`viewTab`). 경로 안의 `..` 같은 것은 여기서 안 본다: 읽는 자리(코어)가 거절하고 탭 안에 그
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
 * 주소가 말하는 화면 탭.
 *
 * **검증기만으로는 부족하다.** 이 라우터는 검증기의 결과를 부모의 raw search **위에 얹는다** —
 * 루트에는 검증기가 없어서 주소에 적힌 것이 전부 통과하고, `?tab=zzz`가 그대로 컴포넌트까지
 * 온다(실측으로 확인했다. `?file=`도 예전부터 같은 성질이다). 타입은 `AddressTab | undefined`
 * 라고 말하지만 런타임 값은 아무 문자열일 수 있으므로, **모르는 값을 기본 값으로 눕히는 자리를
 * 하나 둔다.** 그 자리가 갈리면 화면마다 다른 값을 모르는 값으로 친다.
 *
 * 기본 값은 **채팅**이다(restart 02a-4 — `spec`이 맡던 자리를 물려받았다). 값이 없는 주소에 닿으면 작업공간 화면이 처음 여는 규칙으로
 * 탭을 세우고 주소를 고친다(`opensWork` · `openingSearch`). `tab=chat`을 적었는데 `thread`가 없으면 **새 채팅 탭**이다(restart 02a-8).
 */
export const viewTab = (search: { tab?: string; code?: string }): ViewTab => {
  const tab = addressTabOf(search.tab);
  // **`tab=code`인데 가리키는 파일이 없으면 기본 값이다**(git-integration S12) — 열 파일 탭이 없다.
  if (tab === "code" && codeOf(search) === null) return "chat";
  return tab ?? "chat";
};

/**
 * 탭을 바꿀 때 주소의 `search`를 어떻게 고치는가. **함수형 갱신의 몸통이 여기 하나다.**
 *
 * 이 라우터는 `search`에 객체를 주면 기존 search를 통째로 버려서, 가장 자연스럽게 쓰는
 * 형태가 보던 문서(`file`)를 조용히 떨어뜨린다(결정 15). 그 사고를 막는 모양을 부르는 쪽마다
 * 다시 적으면, 검사하는 쪽도 그것을 **베껴 적게 되어** 실제 이동이 퇴화해도 초록이 된다.
 */
export function tabSearch<T extends object>(
  prev: T,
  next: ViewTab,
): T & { tab?: AddressTab; code?: string; thread?: string } {
  return {
    ...prev,
    tab: next,
    // **`code`와 `thread`를 함께 지운다** — 지금 탭이 셸이면 주소에 파일도 채팅도 없다(S12 · restart 02a-4). 파일 탭으로 가는 길은 `code`를 다시
    // 얹는 `codeSearch`, 채팅 탭으로 가는 길은 `thread`를 다시 얹는 `chatSearch` 하나씩이다.
    code: undefined,
    thread: undefined,
    // **셸 · 파일 탭으로 가면 `file`도 걷는다**(restart 02a-12) — `file`은 넓힌 카드의 문서라 `tab`이 비었거나 `chat`일 때만 뜻이 있다. 남기면 셸로
    // 가는 주소가 채팅 탭과 넓힌 카드로 떨어진다.
    ...(leavesCard(next) ? { file: undefined } : {}),
  };
}

/** 넓힌 카드가 설 수 없는 탭 — 셸 · 파일 탭이다. 그리로 가는 주소에는 넓힌 카드의 문서(`file`)가 남지 않는다(restart 02a-12). */
const leavesCard = (tab: ViewTab | null): boolean => tab === "terminal" || tab === "code";

/**
 * 넓힌 카드의 문서(`file`)를 걷는 조각(restart 02a-12) — 탭을 옮기는 짝이 「남는가」를 가른 뒤 얹는다. 넓힌 카드의 문서는 **그 카드 탭의 것**이라 다른
 * 채팅 탭 · 새 채팅 탭으로 따라가지 않는다(SummarySheet 표 「다른 채팅 탭을 켠다 → 넓힌 카드는 작은 카드로」). 따라가면 다른 작업공간에서 그 채팅으로
 * 돌아올 때 주소의 문서가 넓힌 카드를 다시 세운다. 남는 것은 둘이다 — 처음 여는 주소(고른 탭으로 따라간다 — `?file=`), 같은 탭.
 */
const fileUnless = (stays: boolean): { file?: undefined } => (stays ? {} : { file: undefined });

/**
 * **작업공간을 처음 여는 주소인가**(restart 02a-4 · 02a-8) — 탭도 채팅도 적지 않은 주소다(모르는 탭 값 · 가리키는 파일이 없는 `tab=code`도
 * 같다 — 기본 값으로 눕는다). 작업공간 화면이 처음 여는 규칙으로 탭을 세운다(`openingSearch`). `tab=chat`을 적은 주소는 아니다 — `thread`가
 * 없으면 새 채팅 탭이라는 다른 뜻이다.
 */
export const opensWork = (search: { tab?: unknown; code?: unknown; thread?: unknown }): boolean =>
  viewTab(search as { tab?: string; code?: string }) === "chat" && search.tab !== "chat" && threadOf(search) === null;

/**
 * **새 채팅 탭으로 갈 때** 주소의 `search`를 어떻게 고치는가(restart 02a-8). `tab=chat`만 적고 `thread`와 `code`는 걷는다 — 어느 새 채팅
 * 탭인지는 셸 탭처럼 묶음이 쥔다.
 *
 * 넓힌 카드의 문서(`file`)는 처음 여는 주소와 새 채팅 탭에서만 따라온다(restart 02a-12 — `fileUnless`). 새 채팅 탭끼리는 주소로 어느 탭인지 못
 * 가른다 — 남기고, 다른 탭이었으면 탭 줄 규칙이 카드를 접어 화면이 주소에서 걷는다.
 */
export function newChatSearch<T extends object>(prev: T): T & { tab?: AddressTab; code?: string; thread?: string } {
  const search = prev as { tab?: string; thread?: unknown };
  const stays = opensWork(search) || (search.tab === "chat" && threadOf(search) === null);
  return { ...prev, tab: "chat", code: undefined, thread: undefined, ...fileUnless(stays) };
}

/**
 * **채팅 탭으로 갈 때** 주소의 `search`를 어떻게 고치는가(restart 02a-4) — 파일 탭의 `codeSearch`와 한 벌이다. `tab=chat`과 `thread`를
 * 함께 적고, 서던 파일 탭(`code`)은 걷는다 — 묶음의 지금 탭은 하나다.
 *
 * 넓힌 카드의 문서(`file`)는 같은 채팅 탭 · 처음 여는 주소에서만 남는다(restart 02a-12 — `fileUnless`).
 */
export function chatSearch<T extends object>(
  prev: T,
  thread: string,
): T & { tab?: AddressTab; code?: string; thread: string } {
  const search = prev as { tab?: string; thread?: unknown };
  const stays = opensWork(search) || (search.tab === "chat" && threadOf(search) === thread);
  return { ...tabSearch(prev, "chat"), code: undefined, thread, ...fileUnless(stays) };
}

/**
 * 파일 탭으로 갈 때 주소의 `search`를 어떻게 고치는가. **넷째 축이다**(아래 `fileSearch`의 머리말 — 축이 한 파일에 나란히
 * 서야 다음 축이 생기는 날 같은 사고가 안 난다).
 *
 * `tab=code`와 `code`를 함께 적는다. 넓힌 카드의 문서(`file`)는 걷힌다(`tabSearch` — restart 02a-12).
 */
export function codeSearch<T extends object>(
  prev: T,
  ref: string,
): T & { tab?: AddressTab; code: string; thread?: string } {
  return { ...tabSearch(prev, "code"), code: ref, thread: undefined };
}

/**
 * 문서를 바꿀 때 주소의 `search`를 어떻게 고치는가. **셋째 축이다.**
 *
 * 이 자리가 오래 비어 있었다. 주소에 `file` 하나뿐이던 시절에 쓴 `search: { file }`이
 * 그대로 살아, 판 04가 `tab`을 판 05가 `split`을 얹은 뒤로는 **문서를 고르는 것만으로
 * 분할이 무너졌다**(실측 — 위 `tabSearch` 머리말이 경고한 그 사고가 반대 방향으로 났다).
 * 축이 한 파일에 나란히 서야 다음 축이 생기는 날 같은 일이 안 난다.
 *
 * **`file`은 넓힌 카드의 문서다**(restart 02a-12 · 구현 스펙 「02a — `spec` 탭과 분할을 지운다」) — 한때 결정 50(「문서를 고르면 spec으로 돌아온다」)대로
 * `tab`을 spec으로 보냈다. 이제 `tab`이 비었거나 `chat`일 때만 뜻이 있다. 지금 탭이 채팅 탭 · 새 채팅 탭이면 그 탭에 문서를 얹고(작업공간 화면이
 * 넓힌 카드로 연다), 아니면(셸 · 파일 탭 · 처음 여는 주소) **`tab`을 비운다** — 처음 여는 규칙이 02a-10의 켤 탭 규칙(가장 최근에 켠 채팅
 * 탭 → 가장 최근 채팅 → 새 채팅 탭)으로 채팅 탭을 고르고 거기 넓힌 카드가 선다(`-works-view`). `tab=chat`만 적으면 새 채팅 탭이라는 다른 뜻이라
 * 채팅이 있는 작업공간도 새 채팅 탭으로 떨어진다.
 */
export function fileSearch<T extends object>(
  prev: T,
  path: string,
): T & { file: string; tab?: AddressTab; code?: string; thread?: string } {
  if ((prev as { tab?: string }).tab === "chat") return { ...prev, code: undefined, file: path };
  return { ...prev, tab: undefined, code: undefined, thread: undefined, file: path };
}

/**
 * **넓힌 카드의 문서를 주소에 적는다**(restart 02a-12) — 작업공간 화면이 부른다. 셋이다.
 * - spec 패널의 문서 줄을 셸 · 파일 탭에서 눌렀다 — 켤 카드 탭(`landing` — 02a-10의 `cardTabOf`)으로 옮기며 문서를 얹는다. 한 번에
 *   옮긴다 — 탭과 문서를 따로 옮기면 두 navigate가 한 틱에 겹쳐 앞의 것이 버려진다.
 * - 카드 탭이 이미 본문인데 넓힌 카드가 다른 문서를 열었다(`landing`이 `null`) — 그 탭에 얹는다.
 * - 넓힌 카드가 닫히거나 문서가 아닌 것을 열었다 · 없는 문서다(`path`가 `null`) — 주소에서 걷는다.
 */
export function cardDocSearch<T extends object>(
  prev: T,
  path: string | null,
  landing: WorkLanding | null,
): T & { file?: string; tab?: AddressTab; code?: string; thread?: string } {
  const at = landing === null ? prev : landing.kind === "thread" ? chatSearch(prev, landing.id) : newChatSearch(prev);
  return path === null ? { ...at, file: undefined } : fileSearch(at, path);
}

/**
 * **묶음의 지금 탭이 주소에 남기는 것**(restart 02a-4) — 셸이면 어느 셸인지는 주소에 없고(결정 33), 파일 탭이면 그 파일(`code`),
 * 채팅 탭이면 그 채팅(`thread`)이다. 새 채팅 탭(restart 02a-8)도 셸처럼 어느 탭인지가 주소에 없다. 본문이 묶음을 따라가는 자리
 * (`bundleSearch`)가 이것을 받는다.
 */
export type BundleShown =
  | { kind: "shell" }
  | { kind: "code"; code: string }
  | { kind: "chat"; thread: string }
  | { kind: "new-chat" };

/** 묶음의 지금 탭을 가리키는 `tab` — 셸은 `terminal`, 파일 탭은 `code`, 채팅 탭과 새 채팅 탭은 `chat`이다. */
const tabOfShown = (shown: BundleShown): AddressTab =>
  shown.kind === "shell" ? "terminal" : shown.kind === "new-chat" ? "chat" : shown.kind;

/**
 * 묶음의 지금 탭이 **묶음 쪽에서** 바뀌었을 때 주소를 어떻게 고치는가 — 지금 탭을 닫아 이웃이 켜졌거나(결정 30), 셸이 스스로
 * 끝나 빠졌거나, 첫 말로 새 채팅 탭이 채팅 탭이 됐다. 본문이 그 탭을 따라간다: 파일 탭이면 `code`, 채팅 탭이면 `thread`가 그것이고
 * 셸이면 둘 다 없다. 새 채팅 탭이 켜지면 본문이 그 탭이 된다(`newChatSearch`).
 *
 * **고칠 것을 모두 `prev`에서 읽는다.** 묶음의 변화는 다른 이동과 한 틱에 겹친다 — 화면이 들고 있던 `tab`으로 지으면 한 틱 늦은 값이 방금
 * 옮긴 주소를 덮는다.
 */
export function bundleSearch<T extends object>(
  prev: T,
  bundle: BundleShown,
): T & { tab?: AddressTab; code?: string; thread?: string } {
  if (bundle.kind === "new-chat") return newChatSearch(prev);
  const search = prev as { tab?: string; thread?: unknown };
  // 넓힌 카드의 문서(`file`)는 같은 카드 탭에 머물 때만 남는다(restart 02a-12) — 새 채팅 탭이 첫 말로 그 채팅 탭이 된 것(같은 칸)이 그렇다.
  const at = threadOf(search);
  const stays = bundle.kind === "chat" && search.tab === "chat" && (at === null || at === bundle.thread);
  return {
    ...prev,
    tab: tabOfShown(bundle),
    code: bundle.kind === "code" ? bundle.code : undefined,
    thread: bundle.kind === "chat" ? bundle.thread : undefined,
    ...fileUnless(stays),
  };
}

/**
 * **작업공간을 처음 여는 주소**(restart 02a-4) — 값이 없는 주소(`opensWork`)에 닿으면 작업공간 화면이 이것으로 주소를 고친다. 가장
 * 최근 채팅 탭 하나가 선다(`landingOf` — 사이드바의 작업공간 줄과 같은 규칙). 채팅이 없는 작업공간은 새 채팅 탭이 선다(restart 02a-8 —
 * `newChatSearch`). **기본 문서를 열지 않는다**(restart 02a-13 — 결정 14를 뒤집는다) — 주소에 문서가 있을 때만 그 문서가 고른 탭의 넓힌 카드로 선다.
 */
export function openingSearch<T extends object>(
  prev: T,
  landing: WorkLanding,
): T & { tab?: AddressTab; code?: string; thread?: string } {
  return landing.kind === "thread" ? chatSearch(prev, landing.id) : newChatSearch(prev);
}

/**
 * **그 채팅이 서는 작업공간**(restart 02a-4) — 작업공간에 이었고 그 작업공간이 살아 있으면 그 slug, 아니면 `null`이다. `null`인 채팅
 * (작업공간 밖 채팅 · 보관되거나 지워져 읽기만 되는 채팅)은 `/threads/:id`에 그대로 선다. 판단은 코어가 주는 `gone`(`readOnly`)으로
 * 한다 — 작업공간 목록은 방금 만든 작업공간을 아직 모를 수 있다. 보내는 자리 셋(`/threads/:id` · 작업공간 화면 · 채팅으로 가는 문)이
 * 이 하나를 딛는다.
 */
export function chatHome(thread: { work: string | null; readOnly: WorkGone | null }): string | null {
  return thread.readOnly === null ? thread.work : null;
}

/**
 * work마다 **마지막으로 보던 화면**(결정 77·97). 보던 탭 · 넓힌 카드의 문서 · 파일 탭 · 채팅을 함께 든다. 한때 분할도 들었다(restart 02a-13이
 * 분할을 걷었다).
 *
 * **화면을 정하는 것은 주소이고 이 기억은 씨앗이다**(결정 97). work을 옮길 때 새 주소를
 * 무엇으로 지을지만 말한다 — 머물러 있는 동안의 정본은 언제나 주소다.
 *
 * 앞 판은 work을 옮길 때 search를 통째로 비웠다. 비워야 하는 것은 **떠나는 주소**다 —
 * 문서 경로는 그 work 안에서만 뜻이 있어 딸려가면 새 work에 없는 파일을 가리킨 채 주소만
 * 남는다. `tab`은 그 이유에 해당하지 않는다: `chat`도 `terminal`도 어느 work에나 있고,
 * 터미널을 보다 옆 work을 잠깐 들여다보고 돌아왔을 때 다른 탭으로 떨어지는 것이 결정 77이
 * 없애려는 것이다.
 *
 * **`file`도 그 work 자신의 것이면 해당하지 않는다.** 이 기억이 slug별 지도라 여기 적히는
 * 경로는 언제나 그 work 안의 것이고, 그래서 「문서 경로는 그 work 안에서만 뜻이 있다」가
 * 되살리는 쪽에서는 오히려 지켜진다 — 떠나는 주소를 버리는 일은 `viewSearch`가 **빈 객체
 * 위에** 얹는 것이 계속 한다. 함께 들어야 「마지막 보던 화면」이 온전하다(#156 수용
 * 기준 2 — 「문서·탭이 살아 있다」). 적어 둔 문서가 그 사이에 사라져도 안전하다:
 * 주소가 없는 문서를 가리키면 넓힌 카드를 열지 않고 주소에서 걷는다(`docArrival` — restart 02a-12).
 *
 * **영속시키지 않는다.** 「무엇을 보고 있었나」는 위치이지 설정이 아니다 — 사이드바 접힘이
 * localStorage에 살고 slug 기억이 세션에만 사는 그 구분과 같은 쪽이다(shell-store).
 * 앱을 껐다 켜면 기본값(탭 없음 — 작업공간을 처음 여는 규칙)으로 돌아온다.
 *
 * 라우터 밖 모듈 스코프인 것은 이 값이 **주소가 아니기 때문이다.** 주소에 넣으면 뒤로가기가
 * 이 기억까지 되감아, 「돌아왔을 때 그 화면」이 히스토리 위치에 따라 갈린다.
 */
export interface WorkMemory {
  /**
   * 보던 화면 탭. **`null`이면 주소에 탭을 적지 않는다** — 작업공간을 처음 여는 규칙이 탭을 세운다(`opensWork`). 아직 안 본 work이
   * 그렇다. 「채팅 · `thread` 없음」은 새 채팅 탭이라(restart 02a-8) 처음 여는 규칙과 다른 값이다.
   */
  tab: ViewTab | null;
  /**
   * 보던 문서 — 채팅 탭 · 새 채팅 탭이면 넓힌 카드의 문서다(restart 02a-12). `null`은 주소에 `file`이 없는 것과 같은 뜻이다. 셸 · 파일 탭을 보던
   * 기억의 문서는 씨앗에 실리지 않는다(`viewSearch`).
   */
  file: string | null;
  /**
   * 보던 파일 탭(`<프로젝트>/<경로>`, git-integration S12). `tab`이 `code`일 때만 찬다(주소의 `code`와 같은 규칙이다 —
   * `WorkSearch.code`). 돌아오면 그 탭이 묶음의 지금 탭이 되고, 그 사이 탭을 닫았으면 끝에 다시 연다(주소가 가리키는 파일은
   * 연다 — 스토리 60).
   */
  code: string | null;
  /**
   * 보던 채팅 탭의 채팅(restart 02a-4) — `code`와 같은 규칙이다: `tab`이 `chat`일 때만 찬다. 돌아오면 그 채팅 탭이 묶음의 지금 탭이
   * 된다.
   */
  thread: string | null;
}

/** work마다 마지막으로 보던 화면. **키가 slug다** — 세션 동안만 산다. */
const lastView = new Map<string, WorkMemory>();

export function rememberView(slug: string, view: WorkMemory): void {
  lastView.set(slug, view);
}

/**
 * 적어 둔 화면. 없으면 **탭 없음**이다 — 그 기억은 주소에 탭을 남기지 않아(`viewSearch`) 작업공간을 처음 여는 규칙이 탭을 세운다.
 */
export function recallView(slug: string): WorkMemory {
  return lastView.get(slug) ?? { tab: null, file: null, code: null, thread: null };
}

/**
 * 목록에서 **사라진 work의 기억을 걷는다**(git-integration 판 01). 받는 것은 목록에 남은 slug들이다.
 *
 * 키가 slug라서다 — 삭제는 slug를 풀어 주므로 같은 세션에서 같은 slug로 새 work이 설 수 있고, 그러면 지운 work의 마지막
 * 화면이 새 work을 여는 주소(`recallSearch`)의 씨앗이 된다. `code`가 실려 있으면 새 work의 묶음에 옛 파일 탭이 다시 열린다
 * (주소가 가리키는 파일은 연다 — 스토리 60). 묶음에서 그 work의 파일 탭을 빼는 것(터미널 스토어의 `closeShellsOf` ·
 * `settleOwners`)과 짝이라 부르는 자리도 같은 목록 결과다(`ShellOwners`).
 */
export function forgetVanishedViews(listed: readonly string[]): void {
  const kept = new Set(listed);
  for (const slug of lastView.keys()) if (!kept.has(slug)) lastView.delete(slug);
}

/**
 * 기억을 **빈 주소 위에 얹어** 새 주소를 짓는다 — 그래서 **떠나는 주소의** `file`이 안
 * 딸려가고, 얹히는 `file`은 언제나 그 work 자신의 것이다(위 주석).
 *
 * **여기를 직접 부르는 것은 기억을 안 쓰는 쪽뿐이다.** 「그 work의 기억을 씨앗으로 삼는다」는
 * 합성에는 아래 `recallSearch`라는 이름이 있고, work을 여는 문은 전부 그것을 탄다. 이
 * 머리말은 한때 「짓는 자리가 둘이라(주소 정규화·사이드바 행)」이라고 적었는데, 그 사이
 * 자리가 다섯이 되도록 그 수를 아무도 안 고쳤다 — 그래서 세는 일을 말에서 이름으로 옮겼다.
 *
 * `fileSearch`를 쓰지 않는다 — 그쪽은 문서를 **고른** 자리의 규칙이라 셸 · 파일 탭이면 `tab`을
 * 비우는데(restart 02a-12), 여기서는 아무것도 안 골랐고 보던 화면을 그대로 세우는 것이라
 * 터미널을 보던 work은 터미널로 돌아와야 한다.
 */
export function viewSearch<T extends object>(
  prev: T,
  view: WorkMemory,
): T & { tab?: AddressTab; file?: string; code?: string; thread?: string } {
  return {
    ...tabSearch(prev, view.tab ?? "chat"),
    // **탭이 없는 기억은 주소에 탭을 안 적는다**(restart 02a-4) — 값이 없는 주소가 곧 「작업공간을 처음 여는 규칙으로 탭을 세워라」다
    // (`openingSearch`). `tab=chat`만 적으면 새 채팅 탭이라는 다른 뜻이다(restart 02a-8).
    ...(view.tab === null ? { tab: undefined } : {}),
    // 셸 · 파일 탭을 보다 떠난 기억에는 넓힌 카드의 문서가 없다(restart 02a-12 — `tabSearch`와 같다).
    file: leavesCard(view.tab) ? undefined : (view.file ?? undefined),
    code: view.code ?? undefined,
    thread: view.thread ?? undefined,
  };
}

/**
 * **work을 여는 주소.** 그 work의 마지막 화면을 씨앗으로 삼는다(결정 77·97).
 *
 * 몸통은 한 줄인데 이름이 있어야 하는 것은 **부르는 자리가 여럿이기 때문이다** — 주소
 * 정규화(`-works-view`), 「앱으로 돌아가기」(`appReturnTarget`), 셸로 가는 길(`useGoToShell` — 알림 띠의
 * 줄과 ⌘J 방금 부른 셸로), 팔레트의 work 줄과 문서·본문 줄(`hit-target`), 잠긴 Work 칩(`ThreadScreen`의 `useOpenWork`), 그리고
 * `<Link>`로 여는 문(아래 `workDoor` — Service 상세의 「작업공간」 묶음 줄 · Project 제거 창의 Work 줄). 사이드바의 Work 행은 한때 여기 들었는데
 * 이제 그 Work의 대화(가장 최근 Thread)로 간다(v1 티켓 37). Projects 상세의 「이 프로젝트에서 시작된 작업」 행도 한때 여기 들었는데, 상세가
 * 기준 브랜치 · 경로 · 설명만 들게 되며 걷혔다(03 S21).
 * 합성을 자리마다 손으로 다시 적으면 **빠뜨린 문 하나가 조용하다**: 그 문으로 들어온 work은
 * 기본 화면으로 열리고, 도착한 주소를 적어 두는 effect(`-works-view`의 `rememberView`)가
 * 그 기본값으로 **기억을 덮어써** 다음에 다른 문으로 돌아와도 마지막 화면이 안 선다.
 * Projects 문이 실제로 그랬고, 03의 Service 상세 · 제거 창의 Work 줄이 다시 그랬다(03 코드 리뷰 A1).
 *
 * 그래서 세는 것도 이름 하나다 — 검사는 이 함수의 **값**을 재고 문마다 원문을 대조하지
 * 않는다(`-work-search.test.ts`). 원문 대조는 문이 늘 때마다 함께 늘어야 하는데, 늘지
 * 않은 것이 위 「둘」이다.
 */
export const recallSearch = (slug: string) => viewSearch({}, recallView(slug));

/**
 * **`<Link>`로 work을 여는 자리** — `to` · `params` · `search`(`recallSearch`)를 한 덩이로 준다. 부르는 쪽은 펼치기만 한다
 * (`<Link {...workDoor(slug)}>`) — 주소와 씨앗을 자리마다 다시 적으면 위 「빠뜨린 문 하나」가 또 난다.
 */
export const workDoor = (slug: string) => ({ to: "/works/$slug" as const, params: { slug }, search: recallSearch(slug) });

/**
 * **그 작업공간의 새 채팅 탭으로 가는 문**(restart 02a-8 · 구현 스펙 「02a — 새 채팅으로 가는 길」) — 요약 카드 ⋯의 「이 작업공간에서 새 채팅」,
 * 채팅이 없는 작업공간 줄, `?work=` 씨앗이 지난다. 그 작업공간의 기억(보던 문서)을 씨앗으로 삼고(`recallSearch`) 새 채팅 탭으로 간다
 * (`newChatSearch`). 어느 새 채팅 탭인지는 묶음이 쥔다 — 새 채팅 탭이 있으면 그 탭이고, 없으면 작업공간 화면이 하나 세운다.
 */
export const newChatDoor = (slug: string) => ({
  to: "/works/$slug" as const,
  params: { slug },
  search: newChatSearch(recallSearch(slug)),
});
