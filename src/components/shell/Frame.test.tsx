import { renderToStaticMarkup } from "react-dom/server";
import { Folder } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Card, Frame, type PanelSlot } from "./Frame";

// 머리(이름 · 할 일 · 패널 토글)는 앱 셸의 머리 줄로 포털을 탄다 — 정적 렌더는 포털을 못 그려, 머리를 제자리 머리 줄에 곧장 세운다
// (`screen-head-inline`).
vi.mock("@/components/shell/ShellHead", async (actual) =>
  (await import("@/components/shell/screen-head-inline")).inlineScreenHead(actual),
);

// **앱 틀이 8 틈으로 뜬 둥근 카드들로 나뉜다**(restart 스펙 「02a」 · 스토리 79 · 티켓 02a-2 · 시안 Shell · Main). 흰 판 한 장과 칸 사이
// 선이 걷히고, 사이드바 밖의 영역(본문 · 작업 패널 · 옆 칸 · 레일)이 저마다 카드로 선다. seam은 그린 꼴(markup)이다 —
// 카드의 겉(면 · 둥글기 · 0.5 링)과 카드 사이 틈을 누가 드는지를 잰다. 칠해진 상자의 자리 · 수는 시안 비교와 L3가 잰다.

/** 공용 틀 화면 하나 — 본문 카드만, 또는 그 곁에 오른쪽 패널. */
const render = (panel?: Partial<PanelSlot>) =>
  renderToStaticMarkup(
    <Frame
      head={{ icon: Folder, name: "atelier" }}
      panel={
        panel && {
          label: "작업공간 패널",
          open: true,
          onToggle: () => {},
          size: { width: 340, min: 260, dragging: false, side: "right", handleProps: {} } as never,
          children: <p>패널</p>,
          ...panel,
        }
      }
    >
      <Card as="main" label="본문">
        <p>본문</p>
      </Card>
    </Frame>,
  );

const tagOf = (markup: string, pattern: RegExp) => markup.match(pattern)?.[0] ?? "";
const classOf = (tag: string) => tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];

describe("카드의 겉", () => {
  it("본문 칸은 면 surface · 둥글기 radius-card · 0.5 링(shadow-hairline)의 카드다", () => {
    const main = classOf(tagOf(render(), /<main[^>]*>/));
    expect(main, "본문 카드를 찾지 못했다").toContain("bg-surface");
    expect(main).toEqual(expect.arrayContaining(["rounded-card", "shadow-hairline", "overflow-hidden"]));
  });
});

// 내용 | 목록(codex-ds 결정 28 · DS `.at-joined`)은 **한 카드**의 두 칸이다 — 카드의 겉은 바깥 상자가 들고, 안의 내용 칸(본문 `main`)은
// 겉을 다시 그리지 않는다. 두 칸은 그 카드 안에서 0.5 `border-heavy` 선 하나로 갈린다(카드 사이 선이 아니라 카드 안의 선이다).
// 옆 칸(편집기 트리 — 늘 열린 고정 폭)도 본문 카드와 8 틈을 둔 제 카드다. 상자가 「틈 + 카드」이고 틈은 상자 안 왼쪽이다 — 폭(340)은
// 카드의 폭이다.
describe("옆 칸 카드", () => {
  const markup = renderToStaticMarkup(
    <Frame head={{ icon: Folder, name: "spec 레이아웃" }} beside={{ label: "항목 트리", width: 340, children: <p>트리</p> }}>
      <Card as="main" label="고른 항목">
        <p>폼</p>
      </Card>
    </Frame>,
  );

  it("본문 카드와 8 틈을 둔 제 카드이고, 칸 사이 선이 없다", () => {
    const card = classOf(tagOf(markup, /<section[^>]*aria-label="항목 트리"[^>]*>/));
    expect(card, "옆 칸 카드를 찾지 못했다").toEqual(expect.arrayContaining(["rounded-card", "shadow-hairline", "bg-surface"]));
    const box = tagOf(markup, /<div[^>]*>(?=<section[^>]*aria-label="항목 트리")/);
    expect(box).toContain("flex-basis:calc(340px + var(--space-2))");
    expect(classOf(box)).toContain("pl-2");
    expect(classOf(box).filter((one) => one.startsWith("after:"))).toEqual([]);
  });
});

// 레일과 작업공간의 spec 패널은 이 틀이 그리지 않는다(restart 02a-14) — 앱 셸의 작업공간 도구 기둥(`WorkTools`)이 화면을 넘어 들고, 작업공간
// 화면은 머리 줄의 패널 토글만 이 틀에 건넨다(`panelToggle`). 토글은 오른쪽 맨 끝에 서서 기둥의 패널을 가리킨다. 레일 카드의 겉과 칸은
// `Rail.test.tsx`가 잰다.
describe("밖에 선 패널의 토글", () => {
  const markup = renderToStaticMarkup(
    <Frame
      head={{ icon: Folder, name: "atelier", end: <button type="button" aria-label="요약 카드" /> }}
      panelToggle={{ name: "작업공간 패널", open: false, onToggle: () => {}, controls: "work-panel" }}
    >
      <Card as="main" label="문서">
        <p>문서</p>
      </Card>
    </Frame>,
  );

  it("머리 줄 오른쪽 맨 끝에 서서 밖의 패널을 가리키고, 틀에는 패널 칸도 레일도 없다", () => {
    const buttons = markup.match(/<button[^>]*>/g) ?? [];
    expect(buttons[buttons.length - 1]).toContain('aria-label="작업공간 패널 펼치기"');
    expect(buttons[buttons.length - 1]).toContain('aria-controls="work-panel"');
    expect(buttons[buttons.length - 1]).toContain('aria-expanded="false"');
    expect(markup).not.toContain("<aside");
    expect(markup).not.toContain('aria-label="레일"');
  });
});

describe("내용 | 목록 카드", () => {
  const markup = renderToStaticMarkup(
    <Frame
      head={{ icon: Folder, name: "Archive" }}
      list={{
        label: "아카이브 목록",
        size: { width: 264, min: 240, dragging: false, side: "right", handleProps: {} } as never,
        children: <p>목록</p>,
      }}
    >
      <Card as="main" label="문서">
        <p>문서</p>
      </Card>
    </Frame>,
  );

  it("겉은 바깥 상자 하나가 들고, 안의 내용 칸은 겉이 없다", () => {
    const joined = classOf(tagOf(markup, /<div[^>]*data-slot="card"[^>]*>/));
    expect(joined, "내용 | 목록 카드를 찾지 못했다").toEqual(expect.arrayContaining(["rounded-card", "shadow-hairline", "bg-surface"]));
    const main = classOf(tagOf(markup, /<main[^>]*>/));
    expect(main, "내용 칸을 찾지 못했다").toContain("flex-col");
    expect(main.filter((one) => /^(rounded|shadow|bg)-/.test(one))).toEqual([]);
  });

  it("두 칸은 카드 안의 0.5 border-heavy 선 하나로 갈린다", () => {
    const list = classOf(tagOf(markup, /<section[^>]*aria-label="아카이브 목록"[^>]*>/));
    expect(list).toEqual(expect.arrayContaining(["after:w-[0.5px]", "after:bg-border-heavy", "after:left-0"]));
  });
});

// 시안 `.ra-panelwrap` —패널 상자의 폭이 「틈 8 + 카드 340」이고 틈은 상자 안 왼쪽이다. 접히면 상자 폭이 0이 되어 틈도 함께 걷힌다 —
// 본문 카드가 창 끝 틈까지 넓어지고 접힌 자리에 틈이 남지 않는다. 칸을 가르던 0.5 선(옛 `PANE_RULE`)은 없다.
describe("작업 패널 카드", () => {
  const aside = (markup: string) => classOf(tagOf(markup, /<aside[^>]*>/));
  const inner = (markup: string) => classOf(tagOf(markup, /<aside[^>]*><div[^>]*>/).replace(/^<aside[^>]*>/, ""));

  it("본문 카드와 8 틈을 둔 제 카드이고, 칸 사이 선이 없다", () => {
    const markup = render({});
    const card = classOf(tagOf(markup, /<section[^>]*aria-label="작업공간 패널"[^>]*>/));
    expect(card, "패널 카드를 찾지 못했다").toEqual(expect.arrayContaining(["rounded-card", "shadow-hairline", "bg-surface"]));
    expect(aside(markup)).toContain("basis-[calc(var(--panel-width)+var(--space-2))]");
    expect(inner(markup)).toEqual(expect.arrayContaining(["pl-2", "w-[calc(var(--panel-width)+var(--space-2))]"]));
    expect(aside(markup).filter((one) => one.startsWith("after:"))).toEqual([]);
  });

  it("접히면 상자 폭이 0이라 틈도 함께 걷힌다", () => {
    const classes = aside(render({ open: false }));
    expect(classes).toContain("basis-0");
    expect(classes.filter((one) => /^p[xl]?-/.test(one))).toEqual([]);
  });
});
