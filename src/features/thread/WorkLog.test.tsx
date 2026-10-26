import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolEntry } from "./fold";
import { ToolRows } from "./WorkLog";

// 방패 줄(v1 티켓 23 · 캔버스 WorkLog 보드 「자동 허용 줄」) — 판정이 묻지 않고 허용한 도구 줄 앞에 「자동으로 허용함」 · 대상 · 까닭 알약이
// 선다. 까닭의 말은 `approval.test.ts`의 「방패 줄의 까닭」이 재고, 여기서는 그 말이 알약에 서는지를 정적 마크업으로 잰다(02 코드 리뷰 A1 —
// 한때 엔진의 옛 이름 「이 Work에서는 다시 묻지 않기」가 그대로 서서, 같은 화면의 카드 · 결정 줄 「이 Work에서 늘 허용」과 두 말이 섰다).
describe("방패 줄", () => {
  const write = (allowed: string): ToolEntry => ({
    kind: "tool",
    key: "k-1",
    toolCallId: "t-1",
    call: { toolCallId: "t-1", kind: "edit", title: "Write notes.md", status: "completed", locations: [{ path: "/w/notes.md" }] },
    output: "",
    stop: null,
    cut: false,
    denied: false,
    allowed,
    asking: false,
    startedAt: "2026-10-10T10:00:00.000+09:00",
    endedAt: "2026-10-10T10:00:01.000+09:00",
  });
  const pill = (allowed: string) => {
    const markup = renderToStaticMarkup(<ToolRows tools={[write(allowed)]} />);
    const line = markup.match(/<p data-auto-allowed="[^"]*"[^>]*>.*?<\/p>/)?.[0] ?? "";
    expect(line).toContain("자동으로 허용함");
    return line.match(/<span[^>]*>([^<]*)<\/span><\/p>$/)?.[1];
  };

  it("「늘 허용」으로 준 허락이면 카드의 말이 알약에 선다", () => {
    expect(pill("이 Work에서는 다시 묻지 않기")).toBe("이 Work에서 늘 허용");
    expect(pill("이 Thread에서는 다시 묻지 않기")).toBe("이 Thread에서 늘 허용");
  });

  it("물어보는 정도의 까닭은 그대로 선다", () => {
    expect(pill("편집은 허용")).toBe("편집은 허용");
  });
});
