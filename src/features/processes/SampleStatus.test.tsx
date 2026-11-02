import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { snapshotQuery } from "./hooks";
import { SampleNoteBand } from "./SampleStatus";

// restart 03-9 — **안내 띠의 「다시 읽기」**(스토리 132 · 시안 Processes 「멈춤」). L2에는 DOM이 없어 단추의 `onClick`을 그릴 때 받아 두었다가
// 부른다(`ThreadNotices.test.tsx`와 같은 수법). 재는 것은 누른 뒤 IPC에 무엇이 갔나다 — 쿼리 상태가 멈춤을 남기는지는 `sample-beat.test.ts`.

const { pressed, invoke } = vi.hoisted(() => ({
  pressed: new Map<string, () => void>(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", async (original) => ({ ...(await original<typeof import("@tauri-apps/api/core")>()), invoke }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => {
    const label = [children]
      .flat()
      .filter((child) => typeof child === "string")
      .join("");
    if (onClick) pressed.set(label, onClick);
    return <button type="button">{children}</button>;
  },
}));

/** 화면이 스냅샷을 한 번 묻다 실패한 클라이언트 — 화면의 쿼리가 캐시에 서 있다. */
async function failedOnce() {
  const client = new QueryClient();
  invoke.mockRejectedValue("프로세스 스냅샷을 찍지 못했습니다");
  await client.fetchQuery(snapshotQuery).catch(() => undefined);
  invoke.mockClear();
  pressed.clear();
  return client;
}

const band = (client: QueryClient, retry: boolean) =>
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SampleNoteBand note={{ text: "앱이 프로세스 표를 읽지 못하고 있어요.", retry }} />
    </QueryClientProvider>,
  );

describe("안내 띠의 다시 읽기", () => {
  it("멈춤 띠의 다시 읽기를 누르면 곧바로 스냅샷을 한 번 묻는다", async () => {
    const client = await failedOnce();
    expect(band(client, true)).toContain('role="status"');
    pressed.get("다시 읽기")?.();
    expect(invoke.mock.calls, "누른 그 자리에서 스냅샷을 한 번 묻지 않았다").toEqual([["processes_snapshot"]]);
  });

  // 못 읽음 띠는 말하기만 한다 — 다시 읽어도 못 읽은 것은 그대로다.
  it("못 읽음 띠에는 다시 읽기가 없다", async () => {
    const client = await failedOnce();
    expect(band(client, false)).not.toContain("다시 읽기");
    expect(pressed.size).toBe(0);
  });
});
