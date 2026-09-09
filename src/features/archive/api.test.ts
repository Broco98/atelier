import { describe, expect, it, vi } from "vitest";
import { archiveApi } from "./api";

// works 쪽과 같은 계약이고 근거도 같다(`works/api.test.ts`).
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return Promise.resolve(undefined);
  },
}));

describe("아카이브 명령", () => {
  it("전부 세계를 싣고 나간다", async () => {
    calls.length = 0;
    for (const fn of Object.values(archiveApi)) {
      await (fn as (...args: unknown[]) => Promise<unknown>)("maison", "치운-가", "record.md");
    }

    expect(calls).toHaveLength(Object.keys(archiveApi).length);
    expect(calls.filter((call) => call.args.mode !== "maison")).toEqual([]);
  });
});
