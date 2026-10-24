import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlainFrame } from "./PlainFrame";

// Thread 화면의 틀(v1 티켓 07 · 캔버스 Screen-Home · Screen-Thread 보드) — 카드 없는 흰 면. seam은 틀의 그린 꼴(markup)이다: 머리 줄에
// 무엇이 서는가 · 본문이 카드 없이 서는가.
const render = (title?: { name: string }) =>
  renderToStaticMarkup(
    <PlainFrame sidebarOpen title={title} label="Thread">
      <p>본문</p>
    </PlainFrame>,
  );

describe("Thread 화면의 틀", () => {
  it("이름이 없으면 머리 줄이 비고 선도 없다(새 Thread)", () => {
    const html = render();
    expect(html).toMatch(/<header[^>]*><\/header>/);
    expect(html).not.toContain("border-b-");
  });

  it("이름이 서면 머리 줄 아래에 선이 선다", () => {
    const html = render({ name: "환불 API 버그 고쳐줘" });
    const header = html.match(/<header[^>]*>.*<\/header>/)?.[0] ?? "";
    expect(header).toContain("환불 API 버그 고쳐줘");
    expect(header).toContain("border-b-[0.5px]");
  });

  // 공용 틀은 둥근 본문 카드(`rounded-2xl` · 링)를 띄운다 — 이 틀의 본문은 흰 면에 곧장 선다.
  it("본문은 카드 없이 흰 면에 선다", () => {
    const html = render({ name: "Thread" });
    expect(html).toMatch(/<main aria-label="Thread"[^>]*><p>본문<\/p><\/main>/);
    expect(html).not.toContain("rounded-2xl");
    expect(html).toContain("bg-surface");
  });
});
