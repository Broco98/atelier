import { describe, expect, it, vi } from "vitest";
import { worksApi } from "./api";

// **명령마다 세계가 실려 나간다.** 백엔드에서 `mode`는 아직 선택 인자라(없으면 Atelier,
// 필수화는 #187) 빠뜨린 호출은 오류가 아니라 **조용히 Atelier 데이터**로 답한다 — Maison
// 화면이 Atelier 목록을 그리는 그 실패는 화면만 봐서는 「가끔 남의 것이 보인다」로만 보인다.
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
});
