import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { blankedSources, placesOf, where } from "@/blank-comments";
import { cssBlocks } from "@/css-tokens";
import { ScreenHead, ShellHeadRow } from "./ShellHead";

// 머리 줄(02 구현 스펙 §3 · CONTEXT 「머리 줄」) — 크롬 맨 위 44 줄 하나에 셸 컨트롤과 지금 화면의 자리가 선다. seam은 그린 꼴(markup)과
// 그 자리를 정하는 토큰이다: 줄이 하나인가 · 셸 컨트롤과 화면 자리가 그 안에 서는가 · 화면 자리가 셸 컨트롤 바로 뒤 세로선 다음에 서는가.
// 칠해진 상자의 x는 시안 비교와 L3(`frame.spec`)가 잰다.
const row = () =>
  renderToStaticMarkup(
    <ShellHeadRow onSlot={() => {}}>
      <button type="button">사이드바 토글</button>
    </ShellHeadRow>,
  );

/** `[data-titlebar]` 상자에 선언한 머리 줄 자리 변수. */
const titlebarVar = (name: string) =>
  cssBlocks(readFileSync("src/index.css", "utf8"))
    .find((block) => block.head.includes("[data-titlebar]") && !block.head.includes("fullscreen"))
    ?.decls.get(name);

/** 화면 자리 — 화면이 이름 · 할 일을 보내는 그릇(`data-slot="screen-head"`)의 여는 태그. */
const slotTag = (html: string) => html.match(/<div[^>]*data-slot="screen-head"[^>]*>/)?.[0] ?? "";

describe("머리 줄", () => {
  it("크롬 맨 위 줄 하나에 셸 컨트롤이 서고, 그 뒤가 화면의 자리다", () => {
    const html = row();
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html).toMatch(/^<header[^>]*data-tauri-drag-region="deep"/);
    const controls = html.indexOf("사이드바 토글");
    const slot = html.indexOf('data-slot="screen-head"');
    expect([controls, slot].every((at) => at > -1)).toBe(true);
    expect(slot).toBeGreaterThan(controls);
  });

  // **창의 머리는 머리 줄 하나다**(ui-refresh 결정 5) — 화면 몸 맨 위의 줄(제목 · 잰 시각 · 할 일)은 `<header>`가 아니다(공용 목록 틀
  // `PlaceList`의 맨 위 줄과 같다). 몸에 `<header>`가 서면 보조 기술의 머리 랜드마크가 둘이 되고 L3(`frame` · `frame-sidebar`의 「머리는 머리 줄 하나」)가 빨갛다 —
  // 03-11이 Processes 몸 머리를 `<header>`로 들였다(02a-15). 앱 소스(주석 빼고)에서 `<header`를 그리는 곳은 머리 줄과, 그것을 본뜨는 검사
  // 도우미(`screen-head-inline`)뿐이다.
  it("앱에서 `<header>`를 그리는 것은 머리 줄 하나다 — 화면 몸의 머리 줄은 `<header>`가 아니다", () => {
    const drawn = placesOf(/<header\b/g, blankedSources()).map(where);
    expect(drawn.map((one) => one.split(":")[0]).sort(), drawn.join("\n")).toEqual([
      "src/components/shell/ShellHead.tsx",
      "src/components/shell/screen-head-inline.tsx",
    ]);
  });

  // 창 머리 줄의 높이는 restart 시안 토큰 `size-titlebar`(44) 하나다(02a-1이 더하고 02a-2가 옮겼다 — 한때 같은 값의 `--titlebar-height`를
  // 읽었다). 이름이 둘이면 한쪽만 고친 날 머리 줄과 그 높이를 읽는 자리가 갈린다.
  it("머리 줄 높이는 창 머리 줄 토큰 size-titlebar다", () => {
    const header = row().match(/^<header[^>]*>/)?.[0] ?? "";
    expect(header).toContain("h-(--size-titlebar)");
    const css = readFileSync("src/index.css", "utf8");
    expect(cssBlocks(css).some((block) => block.decls.has("--titlebar-height")), "옛 이름 --titlebar-height가 남았다").toBe(false);
  });

  // restart 02a-7 · 시안 Main · MainLoose `.ra-title` — 화면의 이름은 사이드바가 열렸든 접혔든 셸 컨트롤 바로 뒤 세로선(`.ra-tsep`) 다음에
  // 흐른다. 한때(02 – 02a-6) 사이드바가 열려 있으면 본문 카드 왼쪽 끝 x(사이드바 폭)에서 섰고, 그 폭을 따라 옮겨 갔다.
  it("화면 자리는 사이드바와 상관없이 셸 컨트롤 끝에서 선다", () => {
    expect(titlebarVar("--titlebar-inset-head")).toBe("calc(var(--titlebar-controls-left) + var(--titlebar-controls-width))");
    expect(titlebarVar("--titlebar-inset-sidebar"), "사이드바를 따르는 이름 자리가 남았다").toBeUndefined();
    const left = row().match(/<header[^>]*><div[^>]*>/)?.[0] ?? "";
    expect(left).toContain("w-(--titlebar-inset-head)");
    expect(row()).not.toMatch(/--sidebar-width|inset-sidebar/);
  });

  // 시안 `.ra-tsep` — 0.5 × 16 `border-heavy`, 셸 컨트롤 끝에서 6 뒤에 서고 이름은 그 뒤 10에서 시작한다(`margin: 0 10px 0 6px`).
  // 줄(44) 가운데라 위아래 14씩 비운다. 한때 사이드바가 열렸을 때만 1 × 20 `separator`가 섰다.
  it("화면 자리 앞에 늘 세로선이 선다 — 0.5 × 16 border-heavy, 앞 6 · 뒤 10", () => {
    const slot = slotTag(row()).match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    expect(slot).toEqual(
      expect.arrayContaining(["ml-1.5", "pl-2.5", "before:left-0", "before:inset-y-3.5", "before:w-[0.5px]", "before:bg-border-heavy"]),
    );
    expect(slot.filter((one) => one.includes("separator"))).toEqual([]);
  });

  // 이름이 없는 화면(새 Thread)은 머리 줄 가운데가 빈다 — 선 하나만 덩그러니 남지 않는다.
  it("화면이 아무것도 보내지 않으면 세로선도 서지 않는다", () => {
    expect(slotTag(row())).toContain("empty:before:hidden");
  });
});

describe("화면의 머리", () => {
  // 화면은 머리 줄의 자리(앱 셸이 내린다)에 제 이름 · 할 일을 보낸다. 셸 밖이면 보낼 곳이 없다 — 그 자리에 몰래 서지 않는다.
  it("머리 줄의 자리가 없으면(셸 밖) 아무것도 그리지 않는다", () => {
    expect(renderToStaticMarkup(<ScreenHead>이름</ScreenHead>)).toBe("");
  });
});
