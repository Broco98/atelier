import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScreenHead, ShellHeadRow } from "./ShellHead";

// 머리 줄(02 구현 스펙 §3 · CONTEXT 「머리 줄」) — 크롬 맨 위 44 줄 하나에 셸 컨트롤과 지금 화면의 자리가 선다. seam은 그린 꼴(markup)이다:
// 줄이 하나인가 · 셸 컨트롤과 화면 자리가 그 안에 서는가 · 화면 자리 앞의 세로선이 사이드바를 따르는가. 자리가 사이드바 끝 x와 맞는지 ·
// 사이드바를 따라 옮겨 가는지는 상자로 재는 일이라 L3(`frame.spec`)가 본다.
const row = (open: boolean) =>
  renderToStaticMarkup(
    <ShellHeadRow open={open} dragging={false} onSlot={() => {}}>
      <button type="button">사이드바 토글</button>
    </ShellHeadRow>,
  );

/** 화면 자리 — 화면이 이름 · 할 일을 보내는 그릇(`data-slot="screen-head"`)의 여는 태그. */
const slotTag = (html: string) => html.match(/<div[^>]*data-slot="screen-head"[^>]*>/)?.[0] ?? "";

describe("머리 줄", () => {
  it("크롬 맨 위 줄 하나에 셸 컨트롤이 서고, 그 뒤가 화면의 자리다", () => {
    const html = row(true);
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html).toMatch(/^<header[^>]*data-tauri-drag-region="deep"/);
    const controls = html.indexOf("사이드바 토글");
    const slot = html.indexOf('data-slot="screen-head"');
    expect([controls, slot].every((at) => at > -1)).toBe(true);
    expect(slot).toBeGreaterThan(controls);
  });

  // Codex — 사이드바가 열려 있으면 이름이 판 안 본문 왼쪽 끝 x에서 #e5e5e5 세로선 하나 뒤에 선다. 접히면 셸 컨트롤 바로 뒤라 선이 없다.
  it("사이드바가 열려 있으면 화면 자리 앞에 세로선이 서고, 접히면 없다", () => {
    expect(slotTag(row(true))).toContain("before:bg-separator");
    expect(slotTag(row(false))).not.toContain("separator");
  });

  // 이름이 없는 화면(새 Thread)은 머리 줄 가운데가 빈다 — 선 하나만 덩그러니 남지 않는다.
  it("화면이 아무것도 보내지 않으면 세로선도 서지 않는다", () => {
    expect(slotTag(row(true))).toContain("empty:before:hidden");
  });
});

describe("화면의 머리", () => {
  // 화면은 머리 줄의 자리(앱 셸이 내린다)에 제 이름 · 할 일을 보낸다. 셸 밖이면 보낼 곳이 없다 — 그 자리에 몰래 서지 않는다.
  it("머리 줄의 자리가 없으면(셸 밖) 아무것도 그리지 않는다", () => {
    expect(renderToStaticMarkup(<ScreenHead>이름</ScreenHead>)).toBe("");
  });
});
