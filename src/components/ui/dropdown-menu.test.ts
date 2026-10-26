/// <reference types="node" />
// Node 타입을 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다(소스를 읽는 `blank-comments`).
import { describe, expect, it } from "vitest";
import { blankedSources, type Source } from "@/blank-comments";

// **메뉴 카드의 폭은 쓰는 자리가 `className`으로 덮지 않고 `dropdown-menu.tsx`의 폭 표(`CARD_WIDTH`)에서 고른다**(그 파일 「카드 폭」
// 머리말 · 03 코드 리뷰 A4). 03 화면 일곱 곳이 `w-44` · `w-70` · `w-77` …로 덮었고, 그 가운데 하나(새 Space 메뉴)는 `width="note"` 뒤에
// `w-77`을 두어 `note`의 뜻(내용 폭 · 300에서)을 지웠다. 빌드도 타입 검사도 조용하고 화면은 「조금 다른 폭」으로만 남아, 같은 뜻의
// 메뉴가 자리마다 다른 폭으로 갈린다. 그래서 메뉴 카드를 여는 태그의 `className`에 폭 유틸리티가 서면 빨갛다 — 맞는 폭이 없으면 표에
// 갈래를 더한다.

/** 메뉴 카드를 여는 부품 — 셋 다 `MenuCard` 하나를 부른다(`dropdown-menu.tsx` · `context-menu.tsx`). */
const CARDS = ["DropdownMenuContent", "DropdownMenuSubContent", "ContextMenuContent"];

/** 폭을 정하는 유틸리티 — 변형(`sm:` · `data-open:`)과 `!`를 함께 센다. */
const WIDTH = /(?<![\w-])(?:[\w-]+:)*!?(?:w|min-w|max-w|size)-[^\s"'`]+/g;

/**
 * **폭 표 밖의 예외** — 파일과 그 글자, 까닭 한 줄. 쓰이지 않는 예외는 다음 덮기의 뒷문이 되므로 함께 센다.
 */
const EXCEPTIONS: { file: string; width: string; why: string }[] = [
  {
    file: "src/components/shell/Sidebar.tsx",
    width: "w-(--anchor-width)",
    why: "바닥 사람 줄의 사람 메뉴는 그 줄(트리거)의 폭이다(02 구현 스펙 §4) — 표의 고정 폭이 아니라 여는 자리의 폭을 받는다",
  },
];

/** 여는 태그 하나 — `<이름` 뒤부터 중괄호 · 따옴표 밖의 첫 `>`까지(`onKeyDown={(e) => …}`의 `>`에서 멈추지 않는다). */
function openingTag(text: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let at = from; at < text.length; at++) {
    const one = text[at];
    if (quote) {
      if (one === quote) quote = null;
    } else if (one === '"' || one === "'" || one === "`") quote = one;
    else if (one === "{") depth++;
    else if (one === "}") depth--;
    else if (one === ">" && depth === 0) return text.slice(from, at + 1);
  }
  return text.slice(from);
}

/** 메뉴 카드 태그의 `className`에 선 폭 유틸리티 — `파일:줄: 글자`. */
function widthsOnCards(sources: Source[]): string[] {
  const head = new RegExp(`<(?:${CARDS.join("|")})(?![\\w])`, "g");
  return sources.flatMap(({ file, text }) =>
    [...text.matchAll(head)].flatMap((match) => {
      const tag = openingTag(text, match.index!);
      const line = text.slice(0, match.index).split("\n").length;
      const classes = tag.match(/className=(?:"[^"]*"|\{[\s\S]*?\}(?=\s|\/?>))/g) ?? [];
      return classes.flatMap((one) => [...one.matchAll(WIDTH)].map((width) => `${file}:${line}: ${width[0]}`));
    }),
  );
}

describe("메뉴 카드의 폭", () => {
  const sources = blankedSources();

  it("검사가 실제로 메뉴 카드 태그의 폭을 읽는다", () => {
    // 앵커: 한 줄 · 여러 줄 태그, `"…"` · `{cn(…)}` 꼴, 화살표 함수가 든 태그를 다 읽고, 폭이 아닌 클래스는 세지 않는다.
    expect(
      widthsOnCards([
        {
          file: "예",
          text: [
            '<DropdownMenuContent align="end" className="w-44">',
            "<ContextMenuContent",
            "  onKeyDown={(event) => event.preventDefault()}",
            '  className={cn("p-1", "min-w-75 sm:max-w-80")}',
            ">",
            '<DropdownMenuSubContent className="rounded-lg" />',
            '<DropdownMenuContent width="note-fold">',
          ].join("\n"),
        },
      ]),
    ).toEqual(["예:1: w-44", "예:2: min-w-75", "예:2: sm:max-w-80"]);
    // 앱의 메뉴 카드 태그를 실제로 읽었다 — 경로가 새서 빈 목록이면 아래가 그냥 초록이다.
    const cards = sources.flatMap(({ text }) => [...text.matchAll(new RegExp(`<(?:${CARDS.join("|")})(?![\\w])`, "g"))]);
    expect(cards.length).toBeGreaterThan(20);
  });

  it("쓰는 자리가 className으로 카드 폭을 덮지 않는다", () => {
    const found = widthsOnCards(sources.filter(({ file }) => !file.startsWith("src/components/ui/")));
    const excused = (place: string) => EXCEPTIONS.some((one) => place.startsWith(`${one.file}:`) && place.endsWith(`: ${one.width}`));
    // 실패하면 그 폭을 `dropdown-menu.tsx`의 `CARD_WIDTH`에서 고른다(`width="act"` …). 맞는 폭이 없으면 표에 뜻의 이름으로 갈래를 더한다.
    expect(found.filter((place) => !excused(place))).toEqual([]);
    expect(EXCEPTIONS.filter((one) => !found.some((place) => place.startsWith(`${one.file}:`) && place.endsWith(`: ${one.width}`)))).toEqual([]);
  });
});
