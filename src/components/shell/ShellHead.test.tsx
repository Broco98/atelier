import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cssBlocks } from "@/css-tokens";
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

  // 창 머리 줄의 높이는 restart 시안 토큰 `size-titlebar`(44) 하나다(02a-1이 더하고 02a-2가 옮겼다 — 한때 같은 값의 `--titlebar-height`를
  // 읽었다). 이름이 둘이면 한쪽만 고친 날 머리 줄과 그 높이를 읽는 자리가 갈린다.
  it("머리 줄 높이는 창 머리 줄 토큰 size-titlebar다", () => {
    const header = row(true).match(/^<header[^>]*>/)?.[0] ?? "";
    expect(header).toContain("h-(--size-titlebar)");
    const css = readFileSync("src/index.css", "utf8");
    expect(cssBlocks(css).some((block) => block.decls.has("--titlebar-height")), "옛 이름 --titlebar-height가 남았다").toBe(false);
  });

  // 사이드바가 열려 있으면 화면 자리가 카드 자리 왼쪽 끝 x — 사이드바 오른쪽 끝(restart 02a-2 — 사이드바와 카드 사이에 테두리도 띄움도
  // 없다) — 에서 시작한다. 한때 「크롬 띄움 5 + 흰 판 테두리 0.5 + 사이드바 폭」이었다.
  it("사이드바가 열려 있으면 화면 자리가 사이드바 폭 그 끝에서 선다", () => {
    const css = readFileSync("src/index.css", "utf8");
    const inset = cssBlocks(css).find((block) => block.head.includes("[data-titlebar]"))?.decls.get("--titlebar-inset-sidebar");
    expect(inset).toBe("var(--sidebar-width)");
    expect(row(true)).toContain("w-(--titlebar-inset-sidebar)");
  });

  // Codex — 사이드바가 열려 있으면 이름이 본문 카드 왼쪽 끝 x에서 #e5e5e5 세로선 하나 뒤에 선다. 접히면 셸 컨트롤 바로 뒤라 선이 없다.
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
