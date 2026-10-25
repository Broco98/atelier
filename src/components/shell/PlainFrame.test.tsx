import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlainFrame } from "./PlainFrame";

// Thread · 첫 화면 · Library의 틀(02 구현 스펙 §3) — 틀은 앱 셸 하나다(머리 줄 · 흰 판). 이 화면들은 머리 줄에 놓을 것(이름 · 할 일)과
// 판 안에 놓을 것(본문)만 건넨다. seam은 그린 꼴(markup)이다: 제자리에 서는 것은 본문 하나이고 머리는 셸의 머리 줄로 간다(그 길은
// `ShellHead.test.tsx` — 셸 밖이면 머리가 아무 데도 안 선다).
const render = (title?: { name: string }) =>
  renderToStaticMarkup(
    <PlainFrame title={title} label="Thread">
      <p>본문</p>
    </PlainFrame>,
  );

describe("Thread 화면의 틀", () => {
  it("제자리에는 본문 하나만 서고, 이름은 셸의 머리 줄로 간다", () => {
    const html = render({ name: "환불 API 버그 고쳐줘" });
    expect(html).toMatch(/^<main aria-label="Thread"[^>]*><p>본문<\/p><\/main>$/);
    expect(html).not.toContain("<header");
    expect(html).not.toContain("환불 API 버그 고쳐줘");
  });

  // 판이 흰 면이다 — 본문이 제 카드(`rounded-2xl` · 링)나 머리 줄 아래 선을 다시 그리지 않는다.
  it("본문은 카드 · 선 없이 판에 곧장 선다", () => {
    const html = render({ name: "Thread" });
    expect(html).not.toContain("rounded-");
    expect(html).not.toContain("border-");
    expect(html).not.toContain("shadow-");
  });
});
