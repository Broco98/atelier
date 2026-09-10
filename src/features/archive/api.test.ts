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

  // 타입이 `mode`를 막는 것도 works 쪽과 같은 계약이고, 두 모양이 각각 어느 변형을 무는지도
  // 거기 적혀 있다(`works/api.test.ts`). **래퍼 셋에 하나도 안 빼고 건다** — 인자가 하나인
  // `list`는 `mode?: Mode`가 합법이라 대표 하나로는 못 덮는다.
  it("mode 없이는 부를 수 없다 — 타입이 막는다", () => {
    const withoutMode = () => [
      // @ts-expect-error `mode` 인자가 통째로 사라지면 이 줄이 합법이 된다
      archiveApi.docs("치운-가"),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      archiveApi.list(undefined),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      archiveApi.docs(undefined, "치운-가"),
      // @ts-expect-error `mode`가 선택으로 되돌아가면 이 줄이 합법이 된다
      archiveApi.read(undefined, "치운-가", "record.md"),
    ];
    expect(withoutMode).toBeInstanceOf(Function);
  });
});
