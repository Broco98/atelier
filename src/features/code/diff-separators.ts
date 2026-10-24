// **접힌 줄의 글을 한국어로 옮긴다**(v1 티켓 46 · 캔버스 Layout-Expand 보드 「변경 없는 34줄」). `@pierre/diffs`의 diff는 덩어리 사이의 접힌 줄에
// 「32 unmodified lines」 · 「More unchanged context may be available」 · 「Expand all」을 영어 글자 그대로 그린다 — 글을 바꾸는 길은 걷힌
// `custom` 갈래(그 자리를 통째로 다시 짓는다)뿐이라, 그린 뒤에 그 글자만 갈아 끼운다(`onPostRender` — `HighlightedDiff`). 펼치기 단추 ·
// 자리는 라이브러리 것 그대로라 숨긴 줄 펼치기가 그대로 돈다.
//
// 이 모듈은 라이브러리를 읽지 않는다 — 라이브러리가 그린 표식(`data-unmodified-lines` · `data-expand-all-button`)만 안다.

/** 라이브러리의 접힌 줄 글 하나를 옮긴 글 — 모르는 글(이미 옮긴 글도)이면 `null`이라 손대지 않는다. */
export function separatorText(english: string): string | null {
  const lines = /^(\d+) unmodified lines?$/.exec(english.trim());
  if (lines) return `변경 없는 ${lines[1]}줄`;
  switch (english.trim()) {
    case "More unchanged context may be available":
      return "변경 없는 줄 더 보기";
    case "Expand all":
      return "모두 펼치기";
    default:
      return null;
  }
}

/** 그린 diff 안의 접힌 줄 글을 옮긴다 — 라이브러리는 shadow DOM에 그린다. 다시 그려도 옮긴 글은 그대로 지나간다. */
export function koreanSeparators(node: HTMLElement): void {
  const scope: ParentNode = node.shadowRoot ?? node;
  for (const el of scope.querySelectorAll<HTMLElement>("[data-unmodified-lines], [data-expand-all-button]")) {
    const text = separatorText(el.textContent ?? "");
    if (text !== null) el.textContent = text;
  }
}
