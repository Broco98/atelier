import { describe, expect, it, vi } from "vitest";
import { worksApi } from "./api";

// **명령마다 세계가 실려 나간다.** 백엔드에서 `mode`는 이제 **필수 인자다**(#187) —
// 빠뜨린 호출은 조용히 Atelier 데이터를 받는 대신 거절된다. 그래도 이 자리는 그대로다:
// **저쪽 세계의 값을 실은** 갈래는 백엔드에도 멀쩡한 인자라 아무 데서도 오류가 안 나고,
// Maison 화면이 Atelier 목록을 그리는 그 실패는 「가끔 남의 것이 보인다」로만 보인다.
//
// 래퍼를 이름으로 훑는다: 새 명령이 하나 늘면 **이 검사가 저절로 그것도 본다.** 손으로 적은
// 목록은 늘어난 명령을 조용히 빼놓는다(그 실패가 이 파일이 막으려는 것과 같은 종류다).
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve(undefined);
  },
}));

describe("works 명령", () => {
  it("전부 세계를 싣고 나간다", async () => {
    calls.length = 0;
    for (const fn of Object.values(worksApi)) {
      // 인자 수가 함수마다 다르다 — 남는 것은 자바스크립트가 버린다. 값은 아무래도 좋다:
      // 재는 것은 `mode`가 실렸는가 하나다.
      await (fn as (...args: unknown[]) => Promise<unknown>)("maison", "가", "overview.md");
    }

    // 하나도 안 불렀는데 초록이 되지 않게 **수를 먼저 못 박는다.**
    expect(calls).toHaveLength(Object.keys(worksApi).length);
    expect(calls.filter((call) => call.args.mode !== "maison")).toEqual([]);
  });

  /**
   * **`mode`가 필수 타입이라는 것 자체를 못 박는다**(#187). 위 검사는 래퍼를
   * `(...args: unknown[])`로 캐스트해 부르므로 인자가 **선택**이 되어도 그대로 초록이고,
   * 지금 호출처는 전부 값을 넘기고 있어 그 변경은 어디서도 안 터진다 — 다음에 `mode`를 잊는
   * 자리가 생겨야 비로소, 그것도 버튼을 누른 뒤 백엔드의 거절로만 드러난다.
   *
   * `@ts-expect-error`가 **fail-closed다**: 아래 호출이 합법이 되는 날 tsc가 「쓰이지 않은
   * 지시자」로 문다. 재는 자리는 vitest가 아니라 L0다(`pnpm exec tsc --noEmit`) — 이 파일이
   * 초록인 것과 무관하게 거기서 빨개진다.
   *
   * **두 모양이 서로 다른 변형을 문다.** 되돌리는 길이 둘이라 한 모양으로는 못 덮는다.
   * - `get("가")` — 인자를 **통째로 뺀** 변형(`get: (slug: string)`)만 문다. `mode?: Mode`로
   *   눕히면 `"가"`가 여전히 `Mode`에 안 맞아 오류가 남고, 그러면 지시자가 계속 쓰여
   *   TS2578이 안 난다 — 이 줄만 걸어 두면 그 변형이 초록인 채로 지나간다.
   * - `get(undefined, "가")` — **선택으로 되돌린** 변형 둘(`mode?: Mode`와 `Mode | undefined`).
   *   지금은 `undefined`가 `Mode`에 안 들어가 오류지만, 어느 쪽으로 눕혀도 합법이 되어 TS2578이
   *   뜬다. 티켓 수용 기준 2가 막으려던 것이 바로 그 상태다 — 그때 `worksApi.list()`가 `tsc`를
   *   지나 `{mode: undefined}`를 보내고, 실패는 버튼을 누른 뒤 백엔드 거절로만 온다.
   *
   * **래퍼를 하나도 안 빼고 건다.** 대표 하나만 걸면 나머지가 한 글자 변경으로 눕는다 —
   * 인자가 하나인 `list`는 `mode?: Mode`가 합법이라 특히 그렇고(인자가 둘 이상이면
   * 「필수가 선택 뒤에 못 온다」가 막아 `Mode | undefined` 쪽으로만 눕는다), 어느 쪽이든
   * 여기서 안 잡으면 잡는 층이 없다.
   */
  it("mode 없이는 부를 수 없다 — 타입이 막는다", () => {
    // 부르지 않는다 — 재는 것은 타입이고, 실제 호출은 위 검사가 세는 수를 흔든다.
    const withoutMode = () => [
      // @ts-expect-error `mode` 인자가 통째로 사라지면 이 줄이 합법이 된다
      worksApi.get("가"),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      worksApi.list(undefined),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      worksApi.get(undefined, "가"),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      worksApi.setTitle(undefined, "가", "새 이름"),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      worksApi.setStatus(undefined, "가", "done"),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      worksApi.setPinned(undefined, "가", true),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      worksApi.move(undefined, "가", true, null),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      worksApi.readSpec(undefined, "가", "overview.md"),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      worksApi.archive(undefined, "가"),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      worksApi.remove(undefined, "가"),
    ];
    // 이 줄은 위 함수를 **쓰기 위한** 것이다(`noUnusedLocals`). 재는 것은 위 지시자들이다.
    expect(withoutMode).toBeInstanceOf(Function);
  });
});
