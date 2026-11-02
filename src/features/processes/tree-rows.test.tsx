import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { endAsk } from "./process-groups";
import { identityOf, metricsOf, snapshotFixture } from "./process-fixture";
import { EndAskContext, TreeRow, type OpenAsk } from "./tree-rows";

// restart 03-11 — **[끝내기]는 줄 밑의 묻는 줄로 묻는다**(시안 ProcessSheet 「끝내기」 · Processes `.pr-ask`). 한때 앱 확인 창이었다. L2에는 DOM이
// 없어 단추의 `onClick`을 그릴 때 받아 두었다가 부른다(`SampleStatus.test.tsx`와 같은 수법). 재는 것은 무엇이 펴지고, 누르면 IPC에 무엇이
// 가는가다.

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

const vitest = identityOf(403);
const child = identityOf(404);
const ending = { ask: endAsk("vitest", 2), targets: [vitest, child] };

/** 줄 하나를 묻는 줄의 상태(`open`)와 함께 그린다 — 펴기 · 닫기를 받아 둔다. */
function row(open: OpenAsk | null) {
  pressed.clear();
  const start = vi.fn();
  const close = vi.fn();
  const html = renderToStaticMarkup(
    <EndAskContext.Provider value={{ open, start, close }}>
      <TreeRow level={1} label="vitest, 402MB" kind="process" metrics={metricsOf(402 * 1024 * 1024, 3)} ending={ending}>
        vitest
      </TreeRow>
    </EndAskContext.Provider>,
  );
  return { html, start, close };
}

describe("끝내기를 묻는 줄", () => {
  it("[끝내기]를 누르면 그 줄의 묻는 줄을 편다 — 아직 아무것도 안 끝낸다", () => {
    const { html, start } = row(null);
    expect(html).not.toContain('role="alertdialog"');
    pressed.get("끝내기")?.();
    expect(start).toHaveBeenCalledWith("403@1790000000000403", undefined);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("펴진 묻는 줄은 무엇을 끝내는지와 끝내기가 하는 일을 말한다", () => {
    const { html } = row({ key: "403@1790000000000403", shown: undefined });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("vitest 프로세스를 끝낼까요?");
    expect(html).toContain("그 밑에서 뜬 프로세스 1개도 함께 끝내요. TERM을 보내고 2초 뒤에도 남아 있으면 KILL을 보내요.");
  });

  // 다른 줄의 묻는 줄이 펴져 있으면 이 줄 밑에는 안 선다 — 표에 하나다.
  it("다른 줄의 묻는 줄은 이 줄 밑에 안 선다", () => {
    expect(row({ key: "999@1", shown: undefined }).html).not.toContain('role="alertdialog"');
  });

  it("[취소]는 닫기만 하고, [끝내기]는 그 줄과 그 밑의 신원을 끝내기에 넘긴다", async () => {
    invoke.mockResolvedValue([]);
    const shown = snapshotFixture();
    const first = row({ key: "403@1790000000000403", shown });
    pressed.get("취소")?.();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();

    const second = row({ key: "403@1790000000000403", shown });
    // 묻는 줄의 [끝내기]가 줄의 [끝내기]보다 뒤에 그려진다 — 받아 둔 것은 묻는 줄의 것이다.
    pressed.get("끝내기")?.();
    expect(second.close).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("processes_end", { targets: [vitest, child] }));
  });
});
