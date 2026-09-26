import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PreviewText } from "./PreviewDialog";
import type { EntryPath } from "./draft";
import type { LayoutPreview } from "./types";

// 「LLM이 받는 텍스트」 팝업의 본문(spec 레이아웃 티켓 14 · 결정 28 · 구현 스펙 5절 「배치」). 글과 항목의 줄은 엔진이
// 준 그대로다 — 여기서는 그 답을 손으로 넣고 마크업만 잰다. 여닫기는 L3가 잰다(jsdom이 없다).

/** 엔진이 이 초안에 내는 모양 그대로의 답 — 방침 문단 두 줄, 여러 줄 설명과 템플릿 줄이 붙은 파일 항목, 폴더와 그 자식. */
const SHOWN: LayoutPreview = {
  text: [
    "Spec layout — how to arrange documents inside `specDir`.",
    "",
    "방침 한 줄.",
    "둘째 줄.",
    "",
    "  a.md    하나",
    "          둘",
    "          Template: ~/.atelier/layouts/atelier/a.md",
    "  b/",
    "    c.md  셋",
  ].join("\n"),
  lines: [
    { path: [], start: 2, count: 2 },
    { path: [0], start: 5, count: 3 },
    { path: [1], start: 8, count: 1 },
    { path: [1, 0], start: 9, count: 1 },
  ],
  errors: [],
  warnings: [],
};

function render(answer: LayoutPreview | null, selected: EntryPath = [0]): string {
  return renderToStaticMarkup(<PreviewText answer={answer} selected={selected} />);
}

/** 칠한 줄의 글, 위에서부터. */
function selectedLines(html: string): string[] {
  return [...html.matchAll(/<div\b[^>]*data-selected=""[^>]*>([^<]*)<\/div>/g)].map((m) => m[1]);
}

describe("LLM이 받는 텍스트", () => {
  it("오류가 없으면 엔진이 준 글을 줄마다 그대로 보인다", () => {
    const html = render(SHOWN);
    const lines = [...html.matchAll(/<div\b[^>]*data-line=""[^>]*>([^<]*)<\/div>/g)].map((m) => m[1]);
    expect(lines).toEqual(SHOWN.text!.split("\n"));
  });

  // 고른 항목의 줄은 칠해 둔다 — 이름 줄, 설명의 뒷줄, 템플릿 줄이 모두 그 항목의 것이다.
  it("고른 항목의 줄을 칠한다", () => {
    expect(selectedLines(render(SHOWN, [0]))).toEqual([
      "  a.md    하나",
      "          둘",
      "          Template: ~/.atelier/layouts/atelier/a.md",
    ]);
    expect(selectedLines(render(SHOWN, [1, 0]))).toEqual(["    c.md  셋"]);
  });

  it("머리 `spec/`을 골랐으면 방침 문단의 줄을 칠한다", () => {
    expect(selectedLines(render(SHOWN, []))).toEqual(["방침 한 줄.", "둘째 줄."]);
  });

  // 결정 28 — 저장이 잠겨 있으니 「저장하면 받을 글」이 없다. 오류 난 항목을 뺀 글도, 마지막으로 오류가 없던 글도
  // 보이지 않는다.
  it("답에 오류가 있으면 글 대신 「오류를 고치면 보여요」 한 줄을 보인다", () => {
    const html = render({
      text: null,
      lines: [],
      errors: [{ path: [1], message: "two siblings have the pattern `b`" }],
      warnings: [],
    });
    expect(html.replace(/<[^>]+>/g, "")).toBe("오류를 고치면 보여요");
  });
});
