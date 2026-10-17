/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { blankComments, blankCssComments } from "./blank-comments";

// **여백은 DS 간격 눈금으로만 적는다**(codex-ds 스펙 §4 「여백」 · 결정 24 · 티켓 25). 눈금은 Tailwind의 `--spacing`(4px)이고 DS
// `space-*`가 곧 그 칸이다(`space-2` = `p-2` = 8). 화면은 세 줄에 맞춘다 — 틈 8 · 행 글자 16 · 글 거터 20(글 위 24). 그 밖에서 간격을
// 고르는 길을 여기서 막는다.
//   - **임의 값**(`p-[7px]` · `gap-[9px]` · `-mt-[3px]` · `left-[calc(…)]`)과 **임의 속성**(`[padding-left:9px]`). 손으로 적은 수가 눈금을
//     비켜 가, 한 세로줄에 서야 할 행끼리 1px씩 갈렸다 — 사이드바 행 글자가 17(DS 16), 트리 행의 글리프 틈이 7(DS 6)이던 것이 그렇게
//     남았다. 눈금으로 적을 수 없는 자리는 아래 `EXCEPTIONS`의 짧은 목록이다.
//   - **변수를 읽는 간격**(`p-(--card-pad)` · 타입을 단 `p-(length:--x)`). 값이 변수 뒤로 숨어 임의 값과 같은 일을 한다. 읽어도 되는
//     변수는 아래 `VARIABLES`의 짧은 목록이다(창 컨트롤 인셋 · DS 크기 토큰) — 이름과 까닭을 한 줄씩 적는다.
//   - **걷은 여백 변수**(`--gap` · `--card-pad` · `--term-inset` · `--row-gap` · `--glyph-gap` — ui-refresh 때의 이름이고 DS 2판에
//     없다). 이름을 걷었으니 쓰면 CSS가 안 나와 그 여백이 조용히 0이 된다. 분할의 폭 셈처럼 CSS 변수가 있어야 하는 자리는 DS 이름
//     `--space-*`(`index.css`)를 읽는다.
//   - **테마의 간격 이름**(`@theme`의 `--spacing-card` · `--space-2` …). 테마에 오른 이름은 유틸리티(`p-card` · `space-x-2`)가 되어
//     눈금 밖의 값을 이름 뒤로 들인다. `--space-*`는 `:root`에 선다.
//   - **눈금의 사분 단**(`.25` · `.75` 칸과 `px` — `gap-2.25` · `py-1.75` · `gap-px`). 눈금 위의 수지만 홀수 px라 세 줄을 비켜 가기
//     쉽다. DS 부품 값에 홀수 px가 있어(행의 아이콘 틈 9 · 버튼 안쪽 9 · 두 줄 행 위아래 7, DS `.at-row` · `.at-btn.xs` · `.at-row.two`)
//     막지는 않고, 서는 자리마다 그 출처를 `QUARTERS`에 한 줄씩 적는다(한 줄이 한 자리다).
// 모두 빌드도 타입 검사도 조용하고 화면에서는 「1px 들쭉날쭉」으로만 남아, 눈으로는 지켜지지 않는다. 화면이 세 줄에 서는지는 L3가
// 상자로 잰다(`e2e/spacing.spec.ts` · `frame.spec` · `path-bar.spec` · `settings-group.spec`).
//
// 유틸리티의 이름(방향 · 논리 방향 · 테마 이름공간)은 Tailwind 4.3.3의 것이다(`tailwindcss/dist/lib.js`). 세는 곳은 `src`의
// 소스(테스트 빼고)와 `index.css`(`@apply` 안도)이고 **주석은 세지 않는다**(`blank-comments.ts`) — 부품 머리말 「앱 규격으로 고친
// 자리」가 registry의 옛 값을 기록으로 적는다. **아직 안 읽는 것**이 둘 있다.
//   - **CSS 선언의 길이**(`index.css`의 `padding: 4px` — `focus-ring-room`)와 **인라인 `style`의 여백**(`paddingLeft: 8 + depth * 14` —
//     트리 들여쓰기)은 세지 않는다 — 다른 수와 글자로 갈리지 않는다. 깊이처럼 정해지지 않은 수를 셈하는 자리가 거기 선다.
//   - **크기**(`w-[…]` · `h-[22px]` · `max-w-[calc(…)]`)와 **옮기기**(`translate-*`)는 이 검사 밖이다 — 간격이 아니다(티켓은 간격만
//     말한다). 크기의 임의 값 안에서 틈을 더하는 셈(`w-[calc(var(--work-panel-width)+var(--space-2))]`)도 그래서 세지 않는다.

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// 주석을 지운 원문들 — `file`은 저장소 뿌리에서 잰 경로다.
const scripts = sourceFiles(join(root, "src")).map((path) => ({
  file: path.slice(root.length),
  text: blankComments(readFileSync(path, "utf8")),
}));
const stylesheet = { file: "src/index.css", text: blankCssComments(readFileSync(join(root, "src/index.css"), "utf8")) };

type Source = { file: string; text: string };

/** 어긴 자리 하나 — `파일:줄: 글자`로 보인다. */
type Place = { file: string; line: number; text: string };

function places(pattern: RegExp, sources: Source[] = [...scripts, stylesheet]): Place[] {
  return sources.flatMap(({ file, text }) =>
    [...text.matchAll(pattern)].map((m) => ({ file, line: text.slice(0, m.index).split("\n").length, text: m[0] })),
  );
}
const where = (place: Place) => `${place.file}:${place.line}: ${place.text}`;

/**
 * 목록의 자리 가운데 **정확히 한 번** 걸리지 않는 것 — `파일: 클래스 × 걸린 수`로 보인다. 목록의 한 줄은 그 파일의 한 자리다. 안 걸린
 * 줄(0)은 남은 허락이고, 두 번 걸린 줄은 같은 파일의 둘째 자리가 그 줄 하나로 지나간 것이다 — 어느 쪽이든 다음 쓰임의 뒷문이 된다.
 */
function notOnce(list: { file: string; className: string }[], found: Place[]): string[] {
  return list.flatMap((one) => {
    const times = found.filter((place) => one.file === place.file && one.className === place.text).length;
    return times === 1 ? [] : [`${one.file}: ${one.className} × ${times}`];
  });
}

// 간격을 받는 유틸리티의 앞말 — 안쪽(`p-*` …) · 바깥(`m-*` …) · 틈(`gap-*` · `space-x-*`) · 자리(`inset-*` · `top-*` …) · 구를 때의
// 여백(`scroll-m*` · `scroll-p*`) · 들여쓰기(`indent-*`) · 표 칸 사이(`border-spacing-*`). 크기(`w-*` · `size-*` …)와 옮기기
// (`translate-*`)는 아니다(머리말).
// 방향은 Tailwind 4.3.3의 이름 그대로다 — 한 글자(`pt` · `ps` …)와 블록 방향 두 글자(`pbs` · `pbe`), 자리는 `inset-x` · `-y` · `-s` ·
// `-e` · `-bs` · `-be`(`tailwindcss/dist/lib.js`).
const DIRECTION = "(?:[xytrblse]|b[se])";
const SPACING = [
  `p${DIRECTION}?`,
  `m${DIRECTION}?`,
  "gap(?:-[xy])?",
  "space-[xy]",
  "inset(?:-(?:[xyse]|b[se]))?",
  "top",
  "right",
  "bottom",
  "left",
  "start",
  "end",
  `scroll-[mp]${DIRECTION}?`,
  "indent",
  "border-spacing(?:-[xy])?",
];

/** 간격 유틸리티 뒤에 `value` 꼴이 붙은 것 — 변형(`hover:` · `has-[>kbd]:`) · `!` · 음수(`-mt-…`)를 함께 센다. */
const spacing = (value: string) =>
  new RegExp(`(?<![\\w-])(?:[^\\s"'\`]*:)?!?-?(?:${SPACING.join("|")})-${value}(?![\\w-])`, "g");

/** 임의 값 — `p-[7px]` · `left-[calc(…)]` · `gap-[--spacing(…)]`. 값 안에 띄어쓰기 · 따옴표 · `]`는 없다(Tailwind 문법). */
const ARBITRARY = spacing(`\\[[^\\]\\s"'\`]*\\]`);
/** 변수를 읽는 꼴 — `p-(--card-pad)` · 타입을 단 `p-(length:--x)`. Tailwind v4가 `p-[var(--card-pad)]`의 줄임으로 읽는다. */
const VARIABLE = spacing(`\\((?:[\\w-]+:)?--[\\w-]+\\)`);
/** 그 꼴이 읽는 변수의 이름 — 타입(`length:`)은 뗀다. */
const nameOf = (place: Place) => /\((?:[\w-]+:)?(--[\w-]+)\)$/.exec(place.text)![1];

// 간격을 정하는 CSS 속성 — 임의 속성(`[padding-left:9px]`)은 유틸리티 이름 없이 속성을 바로 적어 위 앞말에 안 걸린다. 방향 ·
// 논리 방향은 속성 이름 뒤에 붙는다(`padding-inline-start` · `margin-block-end` · `inset-inline` …).
const PROPERTIES = ["padding", "margin", "gap", "row-gap", "column-gap", "inset", "top", "right", "bottom", "left", "scroll-padding", "scroll-margin", "text-indent", "border-spacing"];
/** 임의 속성 — `[padding-left:9px]` · `hover:[margin-block-end:3px]`. */
const ARBITRARY_PROPERTY = new RegExp(
  `(?<![\\w-])(?:[^\\s"'\`]*:)?!?\\[(?:${PROPERTIES.join("|")})(?:-[a-z]+)*:[^\\]\\s"'\`]*\\]`,
  "g",
);

/** 눈금의 사분 단 — 칸의 `.25` · `.75`와 1px(`px`). 홀수 px가 서는 자리다(아래 「눈금의 사분 단」). */
const QUARTER = spacing(`(?:\\d+\\.(?:25|75)|px)`);

// Tailwind가 간격 유틸리티의 이름을 읽는 테마 이름공간 — `@theme`에 `--spacing-card: 7px`를 올리면 `p-card`가 서고, `--space-2`를
// 올리면 `space-x-2`가 그 값을 읽는다(`tailwindcss/dist/lib.js`의 유틸리티마다 이름공간 — `["--padding", "--spacing"]` …). 그림자의
// `--inset-shadow-*` · `--inset-ring-*`는 간격이 아니다.
const THEME_SPACING =
  /(?<![\w-])--(?:spacing|padding|margin|gap|inset(?!-shadow|-ring)|space|scroll-margin|scroll-padding|text-indent|border-spacing)(?:-[\w-]+)?(?=\s*:)/g;

/** `@theme` 블록 안의 간격 이름 선언 — 블록 밖(`:root`의 `--space-*`)은 유틸리티를 내지 않는다. */
function themeSpacing(source: Source): Place[] {
  return [...source.text.matchAll(/@theme\b[^{]*\{/g)].flatMap((m) => {
    let end = m.index + m[0].length;
    for (let depth = 1; depth > 0 && end < source.text.length; end++) {
      if (source.text[end] === "{") depth++;
      else if (source.text[end] === "}") depth--;
    }
    // 블록 앞은 같은 길이의 공백으로 둔다 — 줄 번호가 원문 그대로다.
    const block = source.text.slice(0, m.index).replace(/[^\n]/g, " ") + source.text.slice(m.index, end);
    return places(THEME_SPACING, [{ file: source.file, text: block }]);
  });
}

/** 눈금 위의 간격 — `p-2` · `gap-1.5` · `-mt-0.5` · `px-px`. 검사가 소스를 실제로 읽는지 세는 앵커다. */
const SCALE = spacing(`(?:\\d+(?:\\.\\d+)?|px)`);

it("검사가 실제로 소스를 읽는다", () => {
  // 주석 지우기가 새서 원문을 통째로 지우면 아래 「0건」이 저절로 초록이 된다 — 눈금 위의 간격이 주석 밖에서 실제로 보이고,
  // `index.css`의 `@apply` 안 간격과 DS 간격 토큰의 선언도 읽힌다.
  expect(scripts.length).toBeGreaterThan(100);
  expect(places(SCALE, scripts).length).toBeGreaterThan(300);
  expect(places(SCALE, [stylesheet]).map((place) => place.text)).toContain("p-1.5");
  expect(places(/--space-2:/g, [stylesheet])).toHaveLength(1);
});

describe("임의 간격", () => {
  /**
   * **임의 값의 예외** — 눈금(0.25칸 = 1px)으로 적을 수 없는 자리다. 자리는 파일과 그 클래스 글자 그대로이고 까닭을 한 줄씩 적는다.
   * 한 줄이 그 파일의 한 자리라, 예외마다 지금 **정확히 한 번** 걸리는지 함께 센다(`notOnce`) — 쓰이지 않는 예외도, 같은 파일에서
   * 한 번 더 쓰인 예외도 다음 임의 값의 뒷문이 된다.
   */
  const EXCEPTIONS: { file: string; className: string; why: string }[] = [
    {
      file: "src/components/shell/useResizableWidth.tsx",
      className: "left-[calc((var(--space-2)-5px)/2)]",
      why: "틈에 서는 폭 손잡이의 빛 — 5px 띠를 틈 8(`space-2`)의 가운데에 세운다. (8 − 5) / 2 = 1.5px라 눈금에 없고, 틈 토큰을 읽어 틈이 바뀌어도 가운데다",
    },
    {
      file: "src/components/shell/useResizableWidth.tsx",
      className: "right-[calc((var(--space-2)-5px)/2)]",
      why: "위와 같다 — 왼쪽에서 끄는 손잡이(패널 칸 왼쪽 틈)의 갈래다",
    },
    {
      file: "src/components/ui/dialog.tsx",
      className: "top-[12vh]",
      why: "검색 팔레트의 자리 — 창 높이의 12%에 선다. 길이가 아니라 창 높이의 몫이라 눈금이 없다(DS `Palette`는 자리를 정하지 않는다)",
    },
    {
      file: "src/components/ui/toggle-group.tsx",
      className: "gap-[--spacing(var(--toggle-gap))]",
      why: "registry `ToggleGroup`의 `spacing` — 칸 사이를 눈금의 칸 수로 받아 `--spacing`에 곱한다. 그 수의 타입이 정수 · 반 칸(`ToggleGap` — 0 · 0.5 · 1 · 1.5 · 2)이라 값이 늘 눈금 위다(설정 칩 1.5 · 기본 2)",
    },
    {
      file: "src/features/works/SpecViewer.tsx",
      className: "mr-[5.21px]",
      why: "체크박스 항목의 되돌림 — 목록 거터 22 − 체크박스 13 − 그 뒤 공백 한 칸 3.79(본문 글꼴에서 잰 값). 본문 첫 글자를 불릿 항목과 한 x에 세우는 실측값이다",
    },
  ];

  const excused = (place: Place) => EXCEPTIONS.some((one) => one.file === place.file && one.className === place.text);

  it("임의 값 꼴이 변형 · 음수 · 식까지 잡고, 간격이 아닌 것은 잡지 않는다", () => {
    // 앵커: 셋째 · 넷째는 변형의 대괄호(`has-[>kbd]`)와 음수 안 값을, 다섯째는 식을, 여섯째는 `gap-[--spacing(…)]`을, 끝의 둘은 표 칸
    // 사이(`border-spacing` — 눈금을 읽는 간격이다)를 잡는다. 크기 · 옮기기 · 글자 정렬(`text-left` · `items-start`) · 테두리 링
    // (`inset-ring-[…]`) · 그림자(`inset-shadow-[…]`) · 눈금 위의 표 칸 사이(`border-spacing-0`)는 잡지 않는다.
    const sample =
      "p-[7px] hover:gap-[9px] -mt-[3px] has-[>kbd]:ml-[-0.15rem] left-[calc((var(--space-2)-5px)/2)] gap-[--spacing(2)] inset-x-[3px] " +
      "border-spacing-[3px] border-spacing-y-[2px] " +
      "p-2 gap-1.75 text-left items-start justify-end size-[17px] max-w-[calc(100%-4rem)] inset-ring-[1px] inset-shadow-[0_1px] translate-x-[3px] " +
      "border-spacing-0";
    expect(places(ARBITRARY, [{ file: "예", text: sample }]).map((place) => place.text)).toEqual([
      "p-[7px]",
      "hover:gap-[9px]",
      "-mt-[3px]",
      "has-[>kbd]:ml-[-0.15rem]",
      "left-[calc((var(--space-2)-5px)/2)]",
      "gap-[--spacing(2)]",
      "inset-x-[3px]",
      "border-spacing-[3px]",
      "border-spacing-y-[2px]",
    ]);
  });

  it("임의 값 꼴이 논리 방향(`pbs` · `inset-s` · `scroll-mbe` …)까지 잡는다", () => {
    // 앵커: Tailwind 4.3.3은 한 글자 방향(`pt` · `ms`) 말고 블록 방향 두 글자(`pbs` · `pbe` · `mbs` · `mbe`)와 `inset-s` · `-e` ·
    // `-bs` · `-be`도 간격으로 받는다(`tailwindcss/dist/lib.js`의 유틸리티 이름). 구를 때의 여백도 같은 방향을 갖는다.
    const sample =
      "pbs-[7px] inset-s-[3px] mbe-[5px] hover:scroll-pbs-[3px] -mbs-[2px] inset-be-[1px] scroll-me-[6px] pe-[3px]";
    expect(places(ARBITRARY, [{ file: "예", text: sample }]).map((place) => place.text)).toEqual([
      "pbs-[7px]",
      "inset-s-[3px]",
      "mbe-[5px]",
      "hover:scroll-pbs-[3px]",
      "-mbs-[2px]",
      "inset-be-[1px]",
      "scroll-me-[6px]",
      "pe-[3px]",
    ]);
  });

  it("임의 속성 꼴이 간격 속성만 잡는다", () => {
    // 앵커: `[padding-left:9px]`는 유틸리티 이름 없이 CSS 속성을 바로 적는 꼴이라 위 앞말 목록에 안 걸린다. 변수 선언
    // (`[--toggle-gap:2]`) · 크기(`[width:3px]`) · 변형의 대괄호(`[&_svg]:size-3`)는 잡지 않는다.
    const sample =
      "[padding-left:9px] hover:[margin-block-end:3px] [gap:5px] [inset-inline-start:2px] [scroll-padding-top:4px] [text-indent:1em] [border-spacing:3px] " +
      "[--toggle-gap:2] [width:3px] [&_svg]:size-3 [&>[role=radio]]:mt-1";
    expect(places(ARBITRARY_PROPERTY, [{ file: "예", text: sample }]).map((place) => place.text)).toEqual([
      "[padding-left:9px]",
      "hover:[margin-block-end:3px]",
      "[gap:5px]",
      "[inset-inline-start:2px]",
      "[scroll-padding-top:4px]",
      "[text-indent:1em]",
      "[border-spacing:3px]",
    ]);
  });

  it("간격을 임의 값으로 적지 않는다", () => {
    // 실패하면 그 간격을 DS 값으로 맞춰 눈금으로 적는다 — 세 줄(틈 `p-2` · 행 글자 16 = 틈 + 행 안쪽 `px-2` · 글 거터 `px-5` · 글 위
    // `pt-6`)이나 그 부품의 DS 값(`bundle.css`의 `.at-*`)이다. 눈금 밖이어야 하는 까닭이 있으면 `EXCEPTIONS`에 이름과 까닭을 적는다.
    const found = [...places(ARBITRARY), ...places(ARBITRARY_PROPERTY)];
    expect(found.filter((place) => !excused(place)).map(where)).toEqual([]);
    expect(notOnce(EXCEPTIONS, found)).toEqual([]);
  });

  /**
   * **간격이 읽어도 되는 변수** — 창 컨트롤 인셋과 DS 크기 토큰뿐이다. 이름마다 까닭을 한 줄씩 적는다. 창 컨트롤 인셋은 신호등
   * (`tauri.conf.json`의 `trafficLightPosition`)과 셸 컨트롤의 칸 수에서 나오는 셈이라 눈금의 한 칸으로 줄일 수 없고, 한 셈을 머리 줄 ·
   * 셸 컨트롤이 함께 읽어야 갈리지 않는다(`index.css`의 `[data-titlebar]`).
   */
  const VARIABLES: { name: string; why: string }[] = [
    {
      name: "--titlebar-controls-left",
      why: "셸 컨트롤의 왼쪽 끝 — 신호등이 차지한 폭 88(전체화면이면 신호등이 숨어 16)이다",
    },
    {
      name: "--titlebar-controls-top",
      why: "셸 컨트롤의 위 — 머리 줄(48)의 가운데에 컨트롤(24)을 세우는 셈이다. 두 길이가 바뀌어도 가운데다",
    },
    {
      name: "--titlebar-control-gap",
      why: "셸 컨트롤 사이 — Codex 2(DS `.at-winctl`). 컨트롤 묶음의 폭 셈(`--titlebar-controls-width`)이 같은 값을 읽는다",
    },
    {
      name: "--titlebar-inset-head",
      why: "사이드바를 접었을 때 머리 줄의 왼쪽 여백 — 셸 컨트롤 끝 + 틈 8. 머리 카드가 신호등 · 셸 컨트롤 밑으로 들어가지 않는 경계다",
    },
    {
      name: "--size-toolbar",
      why: "분할 끌기 겹판의 위끝 — 탭 줄(카드 머리) 아래에서 시작한다. 간격이 아니라 그 줄의 높이 토큰(DS `size-toolbar` 46)을 읽는다",
    },
  ];

  it("변수를 읽는 꼴이 변형 · 음수까지 잡고, 크기는 잡지 않는다", () => {
    // 앵커: 다섯째는 타입을 단 꼴(`p-(length:--x)` — Tailwind v4가 `p-[length:var(--x)]`로 읽는다), 여섯째는 논리 방향이다.
    const sample =
      "p-(--card-pad) hover:gap-(--row-gap) -mt-(--x) pl-(--titlebar-inset-head) p-(length:--x) pbs-(--y) " +
      "w-(--size-peek) h-(--size-head) max-w-(--size-thread)";
    expect(places(VARIABLE, [{ file: "예", text: sample }]).map((place) => place.text)).toEqual([
      "p-(--card-pad)",
      "hover:gap-(--row-gap)",
      "-mt-(--x)",
      "pl-(--titlebar-inset-head)",
      "p-(length:--x)",
      "pbs-(--y)",
    ]);
    expect(places(VARIABLE, [{ file: "예", text: sample }]).map(nameOf)).toEqual([
      "--card-pad",
      "--row-gap",
      "--x",
      "--titlebar-inset-head",
      "--x",
      "--y",
    ]);
  });

  it("간격은 목록의 변수만 읽는다", () => {
    // 실패하면 그 간격을 눈금으로 적는다(위 「임의 값」의 짝). 셈이 필요한 창 컨트롤 인셋이면 `index.css`의 `[data-titlebar]`에 이름을
    // 지어 두고 `VARIABLES`에 까닭과 함께 올린다.
    const found = places(VARIABLE);
    expect(found.filter((place) => !VARIABLES.some((one) => one.name === nameOf(place))).map(where)).toEqual([]);
    const unused = VARIABLES.filter((one) => !found.some((place) => nameOf(place) === one.name));
    expect(unused).toEqual([]);
  });

  it("걷은 여백 변수를 쓰지 않는다", () => {
    // 짝은 DS 값이다 — 틈 `--gap` 8 → `p-2`(변수가 있어야 하면 `--space-2`), 카드 안 `--card-pad` 24 → 글 거터 `px-5` · 글 위 `pt-6`,
    // 터미널 `--term-inset` 12 → DS `Terminal` 안쪽 16(`p-4`), 행 사이 `--row-gap` 2 → 사이드바 · 목록 `gap-0.5` · 트리 `gap-px`(DS
    // `.at-nav` · `.at-listcol` · `.at-tree`), 글리프 뒤 `--glyph-gap` 9 → 행 `gap-2.25` · 알림 띠 줄 `gap-2.5`(DS `.at-row` · `.at-band .at-row`).
    const RETIRED = /(?<![\w-])--(?:gap|card-pad|term-inset|row-gap|glyph-gap)(?![\w-])/g;
    // 앵커: 꼴이 이름 그대로만 잡는다 — 이름 끝이 같은 다른 변수(`--titlebar-control-gap`)는 잡지 않는다.
    expect(
      places(RETIRED, [{ file: "예", text: "var(--gap) p-(--row-gap) --titlebar-control-gap --gap-x --space-2" }]).map((place) => place.text),
    ).toEqual(["--gap", "--row-gap"]);
    expect(places(RETIRED).map(where)).toEqual([]);
  });

  it("테마에 간격 이름을 올리지 않는다", () => {
    const sample =
      "@theme { --spacing-card: 7px; --radius-md: 8px; }\n@theme inline { --space-2: 8px; --inset-shadow-sm: none; --border-spacing-cell: 3px; }";
    expect(themeSpacing({ file: "예", text: sample }).map((place) => place.text)).toEqual(["--spacing-card", "--space-2", "--border-spacing-cell"]);
    expect(themeSpacing(stylesheet).map(where)).toEqual([]);
  });
});

describe("눈금의 사분 단", () => {
  it("꼴이 사분 단(`.25` · `.75` · `px`)만 잡는다", () => {
    const sample = "gap-1.25 hover:px-2.25 -top-0.75 gap-px py-px p-2 gap-1.5 mt-0.5 h-7.5 size-1.25 w-px border-px";
    expect(places(QUARTER, [{ file: "예", text: sample }]).map((place) => place.text)).toEqual([
      "gap-1.25",
      "hover:px-2.25",
      "-top-0.75",
      "gap-px",
      "py-px",
    ]);
  });

  /**
   * **사분 단이 서는 자리** — 눈금 위의 수지만 홀수 px라, 서는 자리마다 그 값의 출처(대개 DS 부품의 값 — `bundle.css`의 `.at-*`)를
   * 한 줄씩 적는다. 자리는 파일과 그 클래스 글자 그대로이고 한 줄이 그 파일의 한 자리다. 쓰이지 않는 자리도, 같은 파일에서 한 번
   * 더 선 자리도 다음 사분 단의 뒷문이 되어 정확히 한 번인지 함께 센다(`notOnce`).
   */
  const QUARTERS: { file: string; className: string; why: string }[] = [
    // 틈 9 · 7 · 5 — DS 부품의 글리프와 글자 사이
    {
      file: "src/components/shell/Frame.tsx",
      className: "gap-1.75",
      why: "머리 카드의 이름 칸 — 아이콘과 이름 사이 7(DS `.at-wtitle`)",
    },
    {
      file: "src/components/shell/Sidebar.tsx",
      className: "gap-2.25",
      why: "사이드바 nav 행 — 아이콘과 이름 사이 9(DS `.at-row`)",
    },
    {
      file: "src/features/works/WorkSectionList.tsx",
      className: "gap-2.25",
      why: "work 행 — 레인과 제목 사이 9(DS `.at-row`)",
    },
    {
      file: "src/features/works/WorkSectionList.tsx",
      className: "pl-2.25",
      why: "work 행의 메타 칸 — 제목과 메타 사이 9(DS `.at-row`의 칸 사이). 메타가 있을 때만 난다",
    },
    {
      file: "src/components/ui/button.tsx",
      className: "gap-1.25",
      why: "머리 줄 버튼(`top`) — 아이콘과 글자 사이 5(DS `.at-btn.top`)",
    },
    {
      file: "src/features/works/WorkCard.tsx",
      className: "gap-1.25",
      why: "호버 카드의 고친 표시 — 점과 글자 사이 5(DS `.at-peek .chg`)",
    },
    {
      file: "src/features/projects/ProjectDetail.tsx",
      className: "gap-1.25",
      why: "상세 work 줄의 브랜치 — 12 글리프(`GitFork`)와 글자 사이 5. DS에 그 부품이 없어 작은 글리프의 사이 5(DS `.at-btn.top` · `.at-peek .chg`)를 따른다",
    },
    // 안쪽 9 · 7 — DS 부품의 안쪽
    {
      file: "src/components/ui/button.tsx",
      className: "px-2.25",
      why: "줄 안의 버튼(`xs`) — 좌우 안쪽 9(DS `.at-btn.xs`)",
    },
    {
      file: "src/components/ui/dropdown-menu.tsx",
      className: "py-1.75",
      why: "두 줄 메뉴 항목(`note`) — 위아래 안쪽 7(DS `.at-mi.tall`)",
    },
    {
      file: "src/features/archive/ArchiveList.tsx",
      className: "py-1.75",
      why: "Archive 목록의 두 줄 행 — 위아래 안쪽 7(DS `.at-row.two`)",
    },
    {
      file: "src/features/projects/ProjectList.tsx",
      className: "py-1.75",
      why: "Projects 목록의 두 줄 행 — 위아래 안쪽 7(DS `.at-row.two`)",
    },
    {
      file: "src/components/ui/input.tsx",
      className: "px-2.25",
      why: "설정의 글자칸(`field`) — 글자까지 DS `.at-input`의 10. DS의 테두리는 폭을 안 먹는 안쪽 고리이고 이 칸의 테두리는 1px이라 그만큼 던다",
    },
    {
      file: "src/features/projects/ProjectDetail.tsx",
      className: "px-3.75",
      why: "설명을 고치는 칸 — 설명 상자의 옆 16에서 칸의 1px 테두리를 던다(상자의 고리는 폭을 안 먹는다). 글자가 상자일 때의 자리에 그대로 선다",
    },
    {
      file: "src/features/projects/ProjectDetail.tsx",
      className: "py-2.75",
      why: "위와 같다 — 설명 상자의 위아래 12에서 1px",
    },
    {
      file: "src/features/works/SpecViewer.tsx",
      className: "px-1.25",
      why: "문서의 인라인 코드 — 좌우 안쪽 5(DS `.at-prose code`의 `1px 5px`)",
    },
    {
      file: "src/features/works/SpecViewer.tsx",
      className: "py-px",
      why: "위와 같다 — 위아래 안쪽 1",
    },
    // 앱의 조용한 칩 — 좌우 7
    {
      file: "src/components/ui/select.tsx",
      className: "px-1.75",
      why: "조용한 셀렉트 칩 — 좌우 7은 옛 기준 브랜치 버튼의 값을 잇는다(높이 · 모서리 · 글자는 DS `.at-chip`, 안쪽은 DS에 짝이 없다 — DS 칩은 고리를 두른 12)",
    },
    {
      file: "src/features/projects/ProjectDetail.tsx",
      className: "px-1.75",
      why: "기준 브랜치 버튼 — 위 셀렉트 칩과 같은 모양이다(목록이 서는 프로젝트는 셀렉트 칩, 없는 프로젝트는 이 버튼)",
    },
    {
      file: "src/features/projects/ProjectDetail.tsx",
      className: "-ml-1.75",
      why: "그 칩을 속성 열에 앉히는 자리 맞춤 — 칩의 안쪽 7만큼 당겨 칩의 글자가 위 줄의 값들과 한 세로선에 선다",
    },
    // 줄 사이 1 — DS 트리 · 팔레트 목록
    {
      file: "src/features/works/SpecTree.tsx",
      className: "gap-px",
      why: "작업 패널 트리 — 줄 사이 1(DS `.at-tree`)",
    },
    {
      file: "src/features/spec-layout/SpecLayoutEditor.tsx",
      className: "gap-px",
      why: "spec 레이아웃 편집기 트리 — 줄 사이 1(DS `.at-tree`)",
    },
    {
      file: "src/features/spec-layout/SpecLayoutEditor.tsx",
      className: "pb-px",
      why: "그 트리의 머리 `spec/`과 첫 행 사이 — 트리 줄 사이와 같은 1(DS `.at-tree`)",
    },
    {
      file: "src/features/search/SearchPalette.tsx",
      className: "gap-px",
      why: "검색 팔레트의 답 목록 — 줄 사이 1(DS `.at-palette .list`)",
    },
    // 셈에서 나오는 홀수 px
    {
      file: "src/components/shell/Frame.tsx",
      className: "ml-1.75",
      why: "머리 카드의 이름 끝에서 위치까지 DS 14 — 위치가 이름 칸 안에 서서, 칸 안의 사이 7(DS `.at-wtitle`)에 7을 더한다",
    },
    {
      file: "src/features/spec-layout/SpecLayoutEditor.tsx",
      className: "-top-0.75",
      why: "놓일 자리 선(높이 6 — `h-1.5`)을 행의 위끝 가운데에 세운다 — 6 / 2 = 3",
    },
    {
      file: "src/features/spec-layout/SpecLayoutEditor.tsx",
      className: "-bottom-0.75",
      why: "위와 같다 — 아래끝의 갈래다",
    },
    {
      file: "src/components/ui/field.tsx",
      className: "has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      why: "registry `Field`의 값 그대로 — 설명이 붙은 가로 필드에서 체크박스 · 라디오를 라벨 첫 줄에 맞춰 1px 내린다",
    },
    {
      file: "src/components/ui/field.tsx",
      className: "@md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
      why: "위와 같다 — 반응형 필드가 가로로 설 때의 갈래다",
    },
  ];

  it("사분 단은 목록의 자리에만 선다", () => {
    // 실패하면 먼저 그 간격을 세 줄이나 가까운 반 칸으로 옮길 수 있는지 본다. DS 부품의 홀수 px라면 `QUARTERS`에 그 자리와 출처를 적는다.
    const found = places(QUARTER);
    const listed = (place: Place) => QUARTERS.some((one) => one.file === place.file && one.className === place.text);
    expect(found.filter((place) => !listed(place)).map(where)).toEqual([]);
    expect(notOnce(QUARTERS, found)).toEqual([]);
  });
});

describe("간격 토큰", () => {
  // **`--space-*`는 Tailwind 눈금과 한 값이다.** 유틸리티는 눈금(`p-2`)으로 적고, CSS 변수가 있어야 하는 자리(분할의 폭 셈 · 손잡이의
  // 자리 · 스크립트 · L3)만 이 이름을 읽는다 — 두 벌이 갈리면 같은 「틈」이 그 두 자리에서 다른 길이가 된다. 눈금은 Tailwind에서
  // 읽는다(`--spacing: 0.25rem` — 앱은 뿌리 글자 크기를 바꾸지 않아 4px다).
  const tailwindTheme = readFileSync(join(root, "node_modules/tailwindcss/theme.css"), "utf8");
  const unit = /--spacing:\s*([\d.]+)rem;/.exec(tailwindTheme);
  const tokens = [...stylesheet.text.matchAll(/--space-(\d+):\s*([^;]+);/g)].map((m) => ({ step: Number(m[1]), value: m[2].trim() }));

  it("DS `tokens.json`의 간격 이름이 선다", () => {
    expect(tokens.map((one) => one.step)).toEqual([1, 2, 3, 4, 5, 6, 8, 11]);
  });

  it("값이 눈금의 그 칸이다", () => {
    // 앵커: 눈금을 실제로 읽었다 — 경로가 새서 못 읽으면 아래 셈이 아무것도 안 잰다.
    expect(unit?.[1]).toBe("0.25");
    const px = Number(unit![1]) * 16;
    // 값은 식이 아니라 수로 적는다 — 등록하지 않은 변수의 계산값은 식 그대로라 이 값을 읽는 스크립트(`useResizableWidth`의 그린 폭 ·
    // e2e)가 수로 못 읽는다(`index.css`의 `--titlebar-height`와 같은 까닭).
    expect(tokens.filter((one) => one.value !== `${one.step * px}px`)).toEqual([]);
  });
});
