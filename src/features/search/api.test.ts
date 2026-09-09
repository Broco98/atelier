import { describe, expect, it, vi } from "vitest";
import { searchApi } from "./api";

// **검색도 세계를 싣고 나간다.** 백엔드에서 `mode`는 아직 선택 인자라(없으면 Atelier,
// 필수화는 #187) 빠뜨린 호출은 오류가 아니라 **조용히 Atelier 코퍼스**를 뒤진다 — Maison에서
// 누른 ⇧⇧에 Atelier work이 서는 그 실패는 오류 하나 없이 조용하다.
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
});
