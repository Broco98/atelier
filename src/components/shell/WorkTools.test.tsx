/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  foldWorkTools,
  showWorkTools,
  WORK_PANEL_ID,
  WorkTools,
  WorkToolsColumn,
  workToolsStore,
} from "./WorkTools";

// **레일과 spec 패널은 작업공간에서만 서고, 작업공간을 떠나면 함께 접힌다**(restart 02a-14 · 스토리 80 · 82 · 83 · 시안 Shell 「레일」 ·
// 「어디에 서나」 · Motion 「레일이 들고 난다」). 둘은 앱 셸의 카드 자리 오른쪽 끝에 늘 서 있는 기둥(`WorkToolsColumn`)이고, 작업공간 화면이
// 서 있는 동안만 그 화면이 기둥을 세운다(`showWorkTools` — 떠나면 `foldWorkTools`). 화면이 바뀌어도 기둥은 그대로라 접힘이 폭 트랜지션으로
// 보인다. seam은 기둥의 그린 꼴(markup)과 그 값의 길이다. 칠해진 폭과 계산된 시간 · 곡선은 시안 비교가 WebKit에서 잰다.

const column = () => renderToStaticMarkup(<WorkToolsColumn onSlot={() => {}} />);
const asideTag = (markup: string) => markup.match(/<aside[^>]*>/)?.[0] ?? "";
const railTag = (markup: string) => markup.match(/<div[^>]*aria-label="레일"[^>]*>/)?.[0] ?? "";
const classOf = (tag: string) => tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
const stand = (open: boolean, busy = false) => showWorkTools({ open, busy, onToggle: () => {} });

describe("작업공간 도구의 기둥", () => {
  beforeEach(() => vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} }));
  afterEach(() => {
    foldWorkTools();
    vi.unstubAllGlobals();
  });

  it("작업공간이 서지 않으면 레일과 spec 패널이 함께 접혀 있다", () => {
    const markup = column();
    expect(railTag(markup), "레일을 찾지 못했다").toContain('data-show="false"');
    expect(classOf(asideTag(markup)), "패널 상자를 찾지 못했다").toContain("basis-0");
    expect(markup).not.toMatch(/cursor-col-resize/);
  });

  it("접힌 패널 상자는 랜드마크로 드러나지 않는다 — 다른 화면에 빈 `aside`가 읽히지 않고, 열리면 다시 드러난다", () => {
    // 기둥은 앱 셸에 늘 서 있어 Processes · Projects 같은 화면에도 폭 0의 상자가 있다. 안쪽은 이미 `inert`라 읽히지 않지만 상자
    // 자신(`aside` — 보조 랜드마크)은 빈 채로 랜드마크 목록에 남는다.
    expect(asideTag(column())).toMatch(/\baria-hidden="true"/);
    stand(false);
    expect(asideTag(column())).toMatch(/\baria-hidden="true"/);
    stand(true);
    expect(asideTag(column())).not.toMatch(/\baria-hidden=/);
  });

  it("작업공간이 서면 레일이 서고, 패널이 열렸으면 칸이 켜지고 패널 상자가 340 + 틈으로 선다", () => {
    stand(true);
    const markup = column();
    expect(railTag(markup)).toContain('data-show="true"');
    expect(markup.match(/<button[^>]*aria-label="spec"[^>]*>/)?.[0]).toContain('aria-pressed="true"');
    expect(classOf(asideTag(markup))).toContain("basis-[calc(var(--panel-width)+var(--space-2))]");
    expect(markup).toMatch(/--panel-width:\s*340px/);
    expect(markup).toMatch(/cursor-col-resize/);
  });

  it("작업공간을 떠나면 레일과 패널이 함께 접힌다", () => {
    stand(true);
    expect(railTag(column())).toContain('data-show="true"');
    foldWorkTools();
    const markup = column();
    expect(railTag(markup)).toContain('data-show="false"');
    expect(classOf(asideTag(markup))).toContain("basis-0");
    expect(markup.match(/<button[^>]*aria-label="spec"[^>]*>/)?.[0]).toContain('aria-pressed="false"');
  });

  it("패널을 닫아도 레일은 남고, 패널의 몸은 접힌 채 마운트돼 있다 — 다시 열면 접어 둔 폴더가 그대로다", () => {
    // 시안 Shell 「규칙」 — 닫아도 패널 몸은 언마운트하지 않는다. 몸은 작업공간 화면이 이 자리(`data-work-panel-body`)에 그린다.
    stand(false);
    const markup = column();
    expect(railTag(markup)).toContain('data-show="true"');
    expect(markup.match(/<button[^>]*aria-label="spec"[^>]*>/)?.[0]).toContain('aria-pressed="false"');
    expect(classOf(asideTag(markup))).toContain("basis-0");
    expect(markup).toMatch(/<div[^>]*data-work-panel-body[^>]*>/);
  });

  it("레일은 패널 뒤(오른쪽 끝)에 서고, 칸 · 머리 줄의 토글이 같은 패널을 가리킨다", () => {
    stand(true);
    const markup = column();
    expect(asideTag(markup)).toContain(`id="${WORK_PANEL_ID}"`);
    expect(markup.indexOf('aria-label="레일"')).toBeGreaterThan(markup.indexOf("</aside>"));
    expect(markup.match(/<button[^>]*aria-label="spec"[^>]*>/)?.[0]).toContain(`aria-controls="${WORK_PANEL_ID}"`);
  });

  it("패널은 레일과 같은 박자(500ms spring)로 여닫는다", () => {
    stand(true);
    expect(classOf(asideTag(column()))).toEqual(expect.arrayContaining(["duration-panel-open", "ease-spring"]));
  });

  it("패널 카드는 「작업공간 패널」이고, 폭은 다른 패널과 따로 기억한다", () => {
    const asked: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        asked.push(key);
        return null;
      },
      setItem: () => {},
    });
    stand(true);
    const markup = column();
    expect(markup).toMatch(/<section[^>]*aria-label="작업공간 패널"/);
    expect(asked).toContain("work-panel-width");
    expect(asked).not.toContain("archive-panel-width");
  });

  it("폭 손잡이는 본문 카드와 가르는 왼쪽 틈에 서고, 지난번에 바꾼 폭으로 다시 선다", () => {
    // 오른쪽 패널이라 끄는 방향의 부호가 반대다 — 손잡이가 건너편에 서면 잡을 곳이 사라진다. 저장값은 기본 폭과 달라야 무시해도 초록이 안 된다.
    vi.stubGlobal("localStorage", { getItem: () => "500", setItem: () => {} });
    stand(true);
    const markup = column();
    expect(markup.match(/<div[^>]*cursor-col-resize[^>]*>/)?.[0]).toMatch(/class="[^"]*\bleft-0\b/);
    expect(classOf(asideTag(markup))).toContain("relative");
    expect(markup).toMatch(/--panel-width:\s*500px/);
  });

  it("본문 카드에 패널 최소 폭만큼은 남긴다 — 패널 뒤의 레일 몫(32 + 틈)을 빼고 잰다", () => {
    // 패널 상자는 카드 자리 안에서 본문 · 레일과 한 줄이다. 한때 레일이 패널 줄 밖이라 그 줄 폭에서 최소 폭만 뺐다.
    stand(true);
    const markup = column();
    expect(markup).toMatch(/--panel-reserve:\s*260px/);
    expect(markup).toMatch(/--panel-trail:\s*calc\(var\(--size-prail\) \+ var\(--space-2\)\)/);
    expect(classOf(asideTag(markup))).toContain("max-w-[calc(100%-var(--panel-reserve)-var(--panel-trail,0px))]");
  });

  it("작업공간을 떠나 접힐 때 패널 카드는 옅어지지 않고 잘리기만 한다 — 작업공간 안에서 닫으면 옅어진다", () => {
    // 시안 `.ra-panelwrap` — 상자가 접히며 잘린다. 떠나는 동안 마지막 몸(`held-body`)이 500ms 내내 보여야 하므로 안쪽을 옅게 하지 않는다.
    // 작업공간 안의 여닫기는 앞 판의 접힘 장치(`foldingInnerClass` — 닫을 때 0.15s 옅어짐, 02a-2)를 그대로 쓴다.
    const inner = (markup: string) => classOf(markup.match(/<aside[^>]*>\s*<div[^>]*>/)?.[0].replace(/^<aside[^>]*>\s*/, "") ?? "");
    stand(false);
    expect(inner(column()), "작업공간 안에서 닫은 패널").toEqual(expect.arrayContaining(["opacity-0", "transition-opacity"]));
    foldWorkTools();
    const left = inner(column());
    expect(left, "패널 안쪽을 찾지 못했다").toContain("pl-2");
    expect(left).not.toContain("opacity-0");
    expect(left.some((name) => name.startsWith("transition"))).toBe(false);
    stand(true);
    expect(inner(column())).toContain("opacity-100");
  });

  it("작업공간의 일(아카이브 · 삭제)이 도는 동안 패널의 몸은 누를 수 없다", () => {
    stand(true, true);
    expect(column().match(/<div[^>]*data-work-panel-body[^>]*>/)?.[0]).toMatch(/\binert=""/);
    stand(true, false);
    expect(column().match(/<div[^>]*data-work-panel-body[^>]*>/)?.[0]).not.toMatch(/\binert=/);
  });
});

describe("작업공간 화면이 기둥을 세운다", () => {
  afterEach(() => foldWorkTools());

  it("화면이 건넨 몸은 앱 셸의 자리로 가고, 자리가 없는 곳(앱 셸 밖)에서는 아무 데도 서지 않는다", () => {
    const markup = renderToStaticMarkup(
      <WorkTools open onToggle={() => {}}>
        <p>spec 트리</p>
      </WorkTools>,
    );
    expect(markup).toBe("");
  });

  it("서 있는 동안 기둥을 세우고, 내려갈 때 접는다 — 같은 화면 안의 열림은 따라간다", () => {
    // 세우고 접는 것은 이펙트라 정적 그림에 없다 — 레이아웃 이펙트가 세우고 그 정리가 접는 자리를 소스로 잰다. 앱 위의 들고 남은 시안
    // 비교가 fixture로 걷는다.
    const source = readFileSync(fileURLToPath(new URL("./WorkTools.tsx", import.meta.url)), "utf8");
    expect(source).toMatch(/useLayoutEffect\(\(\) => \{\s*dropHeldBody\(\);\s*showWorkTools\(/);
    expect(source).toMatch(/foldWorkTools\(\);\s*\},\s*\[\],?\s*\);/);
  });

  it("내려갈 때 패널이 열려 있었으면 몸의 그림을 남기고 접는다 — 접히는 동안 트리가 보인다", () => {
    // 레이아웃 이펙트의 정리는 화면의 몸(포털의 자식)이 자리에서 걷히기 전에 돈다 — 그 순간 떠 둔다. 닫혀 있었으면 상자 폭이 이미 0이라
    // 남길 것이 없다. 다시 서면(`showWorkTools` 앞) 사본을 걷는다. 앱 위의 프레임은 시안 비교가 잰다.
    const source = readFileSync(fileURLToPath(new URL("./WorkTools.tsx", import.meta.url)), "utf8");
    const cleanup = source.match(/useLayoutEffect\(\s*\(\) => \(\) => \{[\s\S]*?\},\s*\[\],?\s*\);/)?.[0] ?? "";
    expect(cleanup, "내려갈 때의 정리를 찾지 못했다").toMatch(/if \(at && seen\.current\.open\) holdBody\(at\);\s*foldWorkTools\(\);/);
  });

  it("값은 앱이 도는 동안 하나다 — 세운 화면이 접으면 비고, 다시 세우면 새 값이다", () => {
    expect(workToolsStore.state).toBeNull();
    stand(true);
    expect(workToolsStore.state?.open).toBe(true);
    foldWorkTools();
    expect(workToolsStore.state).toBeNull();
  });
});
