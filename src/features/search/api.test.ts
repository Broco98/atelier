import { describe, expect, it, vi } from "vitest";
import { searchApi } from "./api";

// **검색도 세계를 싣고 나간다.** 백엔드에서 `mode`는 이제 **필수 인자다**(#187) — 빠뜨린
// 물음은 거절된다. 여기서 재는 것은 그 앞자리다: **저쪽 세계의 값을 실은** 물음은 어디서도
// 오류가 아니라, Maison에서 누른 ⇧⇧에 Atelier work이 서는 화면으로만 나타난다.
//
// 래퍼를 이름으로 훑는 것은 works 쪽과 같은 이유다(`works/api.test.ts`): 명령이 하나 늘면
// 이 검사가 저절로 그것도 본다. 손으로 적은 목록은 늘어난 것을 조용히 빼놓는다.
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve(undefined);
  },
}));

describe("search 명령", () => {
  it("세계를 싣고 나간다", async () => {
    calls.length = 0;
    for (const fn of Object.values(searchApi)) {
      // 인자 수가 함수마다 다르다 — 남는 것은 자바스크립트가 버린다. 값은 아무래도 좋다:
      // 재는 것은 `mode`가 실렸는가 하나다.
      await (fn as (...args: unknown[]) => Promise<unknown>)("maison", "가", []);
    }

    // 하나도 안 불렀는데 초록이 되지 않게 **수를 먼저 못 박는다.**
    expect(calls).toHaveLength(Object.keys(searchApi).length);
    expect(calls.filter((call) => call.args.mode !== "maison")).toEqual([]);
    // 인자 객체는 **평평해야 한다** — `tauri-commands.test.ts`의 이름 대조가 중첩 `{}`를
    // 만나면 그 호출을 통째로 못 보고 넘어간다(`works/api.ts` 머리말).
    expect(calls.map((call) => Object.keys(call.args).sort())).toEqual([
      ["destinations", "mode", "query"],
    ]);
  });

  // 타입이 `mode`를 막는 것도 works 쪽과 같은 계약이고, 두 모양이 각각 어느 변형을 무는지도
  // 거기 적혀 있다(`works/api.test.ts`).
  it("mode 없이는 부를 수 없다 — 타입이 막는다", () => {
    const withoutMode = () => [
      // @ts-expect-error `mode` 인자가 통째로 사라지면 이 줄이 합법이 된다
      searchApi.run("가", []),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      searchApi.run(undefined, "가", []),
    ];
    expect(withoutMode).toBeInstanceOf(Function);
  });
});
