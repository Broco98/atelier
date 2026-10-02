import { describe, expect, it, vi } from "vitest";
import { searchApi } from "./api";

// **검색도 `mode: "atelier"`를 싣고 나간다** — 근거는 works 쪽과 같다(`works/api.test.ts`). 래퍼를 이름으로 훑는 것도
// 같은 이유다: 명령이 하나 늘면 이 검사가 저절로 그것도 본다. 손으로 적은 목록은 늘어난 것을 조용히 빼놓는다.
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve(undefined);
  },
}));

describe("search 명령", () => {
  it("`mode: \"atelier\"`를 싣고 나간다", async () => {
    calls.length = 0;
    for (const fn of Object.values(searchApi)) {
      // 인자 수가 함수마다 다르다 — 남는 것은 자바스크립트가 버린다. 값은 아무래도 좋다:
      // 재는 것은 `mode`가 실렸는가 하나다.
      await (fn as (...args: unknown[]) => Promise<unknown>)("가", []);
    }

    // 하나도 안 불렀는데 초록이 되지 않게 **수를 먼저 못 박는다.**
    expect(calls).toHaveLength(Object.keys(searchApi).length);
    expect(calls.filter((call) => call.args.mode !== "atelier")).toEqual([]);
    // 인자 객체는 **평평해야 한다** — `tauri-commands.test.ts`의 이름 대조가 중첩 `{}`를
    // 만나면 그 호출을 통째로 못 보고 넘어간다(`works/api.ts` 머리말).
    expect(calls.map((call) => Object.keys(call.args).sort())).toEqual([
      ["destinations", "mode", "query"],
    ]);
  });
});
