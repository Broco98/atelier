import { describe, expect, it, vi } from "vitest";
import { searchApi } from "./api";

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve(undefined);
  },
}));

describe("search 명령", () => {
  it("질의와 목적지를 평평하게 싣는다", async () => {
    calls.length = 0;
    await searchApi.run("가", []);

    // 인자 객체는 **평평해야 한다** — `tauri-commands.test.ts`의 이름 대조가 중첩 `{}`를
    // 만나면 그 호출을 통째로 못 보고 넘어간다(`works/api.ts` 머리말).
    expect(calls).toEqual([{ name: "search", args: { query: "가", destinations: [] } }]);
  });
});
