/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { blankCssComments, blankedSources, placesOf, type Source, where } from "./blank-comments";
import { SHADCN_NAMES } from "./css-tokens";

// **색은 Codex 이름으로만 적는다**(codex-ds 결정 27 · 스펙 S1 · 티켓 07). 값의 정본은 `index.css`의 Codex 토큰 하나다 — 그
// 밖에서 색을 고르는 길이 셋 있었고 여기서 아래 꼴을 막는다.
//   - **걷은 옛 이름**(앱 전용 `chrome` · `state-1..4` · `signal-*` …). 이름을 걷었으니 쓰면 CSS가 안 나와 조용히 투명해진다.
//   - **shadcn 이름**(`bg-background` · `text-muted-foreground` …). Codex 토큰의 별칭으로 남았지만 읽는 자리는 shadcn 바탕
//     CSS(`index.css`의 `@layer base`)와 공용 부품(`components/ui` — registry에서 들인 부품이 그 이름으로 온다)뿐이다. 앱
//     호출부(틀 · 화면)가 쓰면 같은 면이 두 이름으로 갈려, 별칭을 걷거나 바꾸는 날 그 자리만 따로 논다.
//   - **손으로 고른 색** — Tailwind 팔레트 색(`text-amber-700` · `bg-red-600` · `bg-black/10`)과 그 변수(`--color-red-600`), 색
//     유틸리티의 임의 값 안 색 이름(`bg-[color-mix(…,white_10%)]`), tsx · ts 안의 색 리터럴(hex · `rgb(` · `oklch(` … — 임의 값의
//     `_` 뒤도 센다). 그림자의 임의 값(`shadow-[…]`)은 `type-scale.test.ts`가 막는다. Codex 토큰을 비켜 가서, 토큰 값을
//     고치는 날 그 자리만 옛 색으로 남고 `.dark`도 따라오지 않는다. 인라인 `style`의 색 이름(`color: "red"`)은 다른 문자열과
//     갈리지 않아 세지 않는다.
// 셋 다 빌드도 타입 검사도 조용하고 화면에서는 「조금 다른 색」으로만 남아, 눈으로는 지켜지지 않는다.
//
// 세는 곳은 `src`의 소스(테스트 빼고)와 `index.css`이고 **주석은 세지 않는다**(`blank-comments.ts`) — 부품 머리말 「앱 규격으로
// 고친 자리」가 registry의 옛 이름을 기록으로 적는다. 색 리터럴은 tsx · ts만 센다 — `index.css`는 토큰의 값을 드는 자리다.

const root = fileURLToPath(new URL("..", import.meta.url));

// 주석을 지운 원문들 — `file`은 저장소 뿌리에서 잰 경로다.
const scripts = blankedSources();
const stylesheet = { file: "src/index.css", text: blankCssComments(readFileSync(join(root, "src/index.css"), "utf8")) };

// 어긴 자리를 `파일:줄: 글자`로 센다.
function offenders(pattern: RegExp, sources: Source[] = [...scripts, stylesheet]): string[] {
  return placesOf(pattern, sources).map(where);
}

// 색을 받는 유틸리티의 앞말 — `bg-*` · `text-*` · `border-t-*` · `inset-ring-*` · `from-*` …(Tailwind의 `--color-*` 이름공간).
const COLOR_UTILITY = [
  "bg", "text", "border(?:-[trblxyse]{1,2})?", "ring", "ring-offset", "inset-ring", "outline", "fill", "stroke",
  "from", "via", "to", "divide", "decoration", "caret", "accent", "placeholder", "shadow",
];

/**
 * 그 색 이름들을 받는 유틸리티 — 변형(`hover:` …)과 알파(`/50`)를 함께 센다. `shade`는 이름 뒤의 단(`-700`)이고, `prefixes`는
 * 세는 앞말이다.
 */
const utilities = (names: readonly string[], shade = "", prefixes: readonly string[] = COLOR_UTILITY) =>
  new RegExp(
    `(?<![\\w-])(?:[^\\s"'\`]*:)?!?(?:${prefixes.join("|")})-(?:${names.join("|")})${shade}(?:/[\\w.%]+)?(?![\\w-])`,
    "g",
  );

/** 그 이름의 CSS 변수 — 선언(`--chrome:`)이든 읽기(`var(--chrome)` · `bg-(--chrome)`)든. */
const variables = (names: readonly string[]) => new RegExp(`--(?:${names.join("|")})(?![\\w-])`, "g");

it("검사가 실제로 소스를 읽는다", () => {
  // 주석 지우기가 새서 원문을 통째로 지우면 아래 「0건」이 저절로 초록이 된다 — Codex 글자색이 주석 밖에서 실제로 보이고,
  // `index.css`의 토큰 선언도 읽힌다.
  expect(scripts.length).toBeGreaterThan(100);
  expect(offenders(utilities(["fg", "fg-secondary", "fg-tertiary"]), scripts).length).toBeGreaterThan(100);
  expect(offenders(/--surface-shell:/g, [stylesheet]).length).toBeGreaterThan(0);
});

describe("옛 색 이름", () => {
  // **걷은 앱 전용 이름**(codex-ds 티켓 07). 짝은 DS README 「앱 토큰 이름과의 짝」이다 — 창 바탕 `chrome` → `surface-shell`,
  // `state-1` · `2` · `3/4` → `fill-soft` · `fill-hover` · `fill-active`, 흐린 글자 `text-tertiary` · `text-section` → `fg-tertiary`,
  // 부름 `signal-*` → `dot-wait` · `wait-soft` · `warning` / `dot-new` · `new-soft` · `accent-solid` …
  // 변수 이름과 유틸리티 이름이 갈린 것은 글자색 둘(`--text-tertiary` → `text-tertiary`)과 묶음 면(`--bg-group` → `bg-group`),
  // 부름(`--signal-wait-ink` → `text-wait-ink`)이다 — Tailwind가 `--text-*`를 글자 크기로 읽어 앞말을 떼고 이었었다.
  const OLD_VARIABLES = [
    "chrome",
    "chrome-hover",
    "primary-strong",
    "primary-ink",
    "border-pill",
    "border-strong",
    "text-tertiary",
    "text-section",
    "bg-group",
    "callout-important",
    "signal-wait",
    "signal-wait-soft",
    "signal-wait-ink",
    "signal-done",
    "signal-done-soft",
    "signal-done-ink",
    "state-1",
    "state-2",
    "state-3",
    "state-4",
    "shadow-float",
  ];
  const OLD_UTILITY_COLORS = [
    "chrome",
    "chrome-hover",
    "primary-strong",
    "primary-ink",
    "border-pill",
    "border-strong",
    "tertiary",
    "section",
    "group",
    "callout-important",
    "wait",
    "wait-ink",
    "done",
    "done-soft",
    "done-ink",
    "state-1",
    "state-2",
    "state-3",
    "state-4",
  ];

  it("걷은 앱 전용 이름이 index.css와 src에 없다", () => {
    expect([
      ...offenders(variables(OLD_VARIABLES)),
      ...offenders(variables(OLD_UTILITY_COLORS.map((name) => `color-${name}`))),
      ...offenders(utilities(OLD_UTILITY_COLORS)),
      ...offenders(/(?<![\w-])(?:[^\s"'`]*:)?shadow-float(?![\w-])/g),
    ]).toEqual([]);
  });

  // **`shadow-*`는 그림자 이름부터 읽힌다** — Tailwind가 `--shadow-card`를 `--color-card`보다 먼저 찾아, `shadow-card`는 shadcn 색
  // `card`가 아니라 Codex 그림자(codex-ds 스펙 §2 그림자)다. 그림자 이름은 `index.css`에서 읽는다.
  const codexShadows = [...new Set([...stylesheet.text.matchAll(/--shadow-([\w-]+)\s*:/g)].map((m) => m[1]))];
  const shadcnUtilities = [
    utilities(SHADCN_NAMES, "", COLOR_UTILITY.filter((prefix) => prefix !== "shadow")),
    utilities(SHADCN_NAMES.filter((name) => !codexShadows.includes(name)), "", ["shadow"]),
  ];
  const shadcnOffenders = (sources: Source[]) => [
    ...shadcnUtilities.flatMap((pattern) => offenders(pattern, sources)),
    ...offenders(variables(SHADCN_NAMES), sources),
  ];

  it("shadcn 이름은 바탕 CSS와 공용 부품 밖에서 쓰지 않는다", () => {
    // 앵커: Codex 그림자 `shadow-card`는 세지 않고, 같은 이름의 색 유틸리티와 그림자 이름이 아닌 shadcn 그림자 색은 센다.
    expect(codexShadows).toContain("card");
    expect(shadcnOffenders([{ file: "예", text: "shadow-card hover:shadow-card/50 bg-card shadow-primary" }])).toEqual([
      "예:1: bg-card",
      "예:1: shadow-primary",
    ]);
    // 실패하면 그 자리를 Codex 이름으로 옮긴다 — 짝은 `index.css` 별칭 묶음의 shadcn 줄이다(`background` · `card` → `surface`,
    // `muted-foreground` → `fg-secondary`, `primary` → `accent` …).
    // 검사가 읽는 이름 목록(`css-tokens.ts`)은 호출부가 아니다 — 그 이름들을 글자로 든다.
    const callers = scripts.filter(({ file }) => !file.startsWith("src/components/ui/") && file !== "src/css-tokens.ts");
    expect(callers.length).toBeGreaterThan(50);
    expect(shadcnOffenders(callers)).toEqual([]);
  });
});

describe("색 지킴", () => {
  // **Tailwind 팔레트 이름은 Tailwind에서 읽는다** — 판이 오르며 이름이 는다(4.2의 `mauve` · `olive` · `mist` · `taupe`).
  // 목록을 여기 적어 두면 새 이름이 조용히 샌다. 검정 · 흰색도 팔레트다 — 앱은 그 색을 뜻의 이름으로 적는다(면은 `surface` ·
  // `scrim`, 글자는 `fg` · `fg-inverse`, 채운 색 면 위의 흰 것은 `fg-on-solid`).
  const tailwindTheme = readFileSync(join(root, "node_modules/tailwindcss/theme.css"), "utf8");
  const palette = [...new Set([...tailwindTheme.matchAll(/--color-([a-z]+)(?:-\d+)?:/g)].map((m) => m[1]))];

  it("Tailwind 팔레트 색 유틸리티를 쓰지 않는다", () => {
    // 앵커: 팔레트를 실제로 읽었다 — 경로가 새서 빈 목록이면 아래가 그냥 통과한다.
    expect(palette).toEqual(expect.arrayContaining(["red", "amber", "green", "gray", "black", "white"]));
    // 실패하면 뜻의 색으로 옮긴다 — 경고는 `warning`, 오류 · 지우기는 `danger`, 성공은 `success`, 막은 `scrim`이다.
    expect(offenders(utilities(palette, "(?:-\\d+)?"))).toEqual([]);
  });

  // **팔레트 색은 변수 이름으로도 읽힌다.** `@theme`이 색 이름공간을 비우지 않아(`--color-*: initial`이 없다) Tailwind 기본
  // 팔레트의 변수(`--color-red-600` …)가 그대로 서 있다 — `text-(--color-red-600)` · `bg-[var(--color-amber-500)]`처럼 변수로
  // 부르면 위 유틸리티 꼴(`text-red-600`)도 아래 리터럴 꼴도 비켜 가고 Codex 밖의 색이 칠해진다. 그래서 그 변수 이름을 어디서든
  // 막는다 — Codex 토큰의 색 변수(`--color-fg` · `--color-chat-accent-purple` …)는 팔레트 이름으로 시작하지 않는다.
  const PALETTE_VARIABLE = new RegExp(`--color-(?:${palette.join("|")})(?:-\\d+)?(?![\\w-])`, "g");

  it("Tailwind 팔레트 색을 변수 이름으로 부르지 않는다", () => {
    // 앵커: 변수 꼴을 실제로 잡는다 — 셋 다 위 두 검사를 비켜 가던 꼴이고, Codex 토큰 변수는 잡지 않는다.
    expect(
      offenders(PALETTE_VARIABLE, [
        {
          file: "예",
          text: "text-(--color-red-600) bg-[var(--color-amber-500)] shadow-[0_0_0_1px_var(--color-gray-200)] text-(--color-fg) bg-(--color-chat-accent-purple)",
        },
      ]),
    ).toEqual(["예:1: --color-red-600", "예:1: --color-amber-500", "예:1: --color-gray-200"]);
    // 실패하면 그 자리를 Codex 토큰으로 옮긴다 — 위 「팔레트 색 유틸리티」의 짝과 같다.
    expect(offenders(PALETTE_VARIABLE)).toEqual([]);
  });

  /**
   * **색 리터럴의 예외** — 앱 CSS 변수가 닿지 않거나 Codex 토큰에 그 한 단이 없는 자리다. 자리는 파일(과 그 글자)이고 까닭을
   * 한 줄씩 적는다. 예외마다 지금도 어딘가에 걸리는지 함께 센다 — 쓰이지 않는 예외는 다음 리터럴의 뒷문이 된다.
   */
  const LITERAL_EXCEPTIONS: { file: string; literal?: string; why: string }[] = [
    {
      file: "src/features/terminal/terminal-theme.ts",
      why: "xterm 테마 — xterm은 CSS 변수를 못 읽어 값을 옮겨 적는다. 앱과 이어진 넷의 짝은 `theme-tokens.test.ts`가 본다",
    },
    {
      file: "src/features/works/SpecViewer.tsx",
      literal: "#faf9f5",
      why: "아티팩트 런타임의 껍데기 바탕(`ARTIFACT_SHELL_HEAD`) — 샌드박스 iframe 안이라 앱 CSS 변수가 닿지 않고, 앱 토큰이 아니라 그 런타임의 값이다",
    },
    {
      file: "src/features/works/SpecViewer.tsx",
      literal: "#141413",
      why: "아티팩트 런타임의 껍데기 글자색 — 위와 같다",
    },
  ];

  /**
   * 색 리터럴 — hex(`#fff` · `#00000014`)와 색 함수(`rgb(` · `oklch(` …). **경계는 영숫자만이다** — `_`는 경계 안이다. Tailwind
   * 임의 값은 띄어쓰기를 `_`로 적어(`shadow-[0_2px_8px_#00000014]` · `border-[1px_solid_#ddd]`) 색이 `_` 바로 뒤에 선다. 손으로
   * 적은 색이 가장 잘 나오는 자리가 그 여러 칸짜리 임의 값(그림자 · 테두리 묶음 · 그러데이션)인데, 경계에 `_`를 넣으면(`\w`) 그
   * 꼴이 통째로 빠진다. `&#`는 HTML 문자 참조라 뺀다.
   */
  const LITERAL =
    /(?<![a-z0-9&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![a-z0-9-])|(?<![a-z0-9-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;

  it("색 리터럴 꼴이 임의 값의 `_` 뒤에서도 잡힌다", () => {
    // 앵커: `_` 뒤 · `[` 뒤 · `(` 뒤의 리터럴을 다 잡고, 색이 아닌 `#`(문자 참조 · 낱말 안 · 짧은 낱말)는 잡지 않는다.
    expect(
      offenders(LITERAL, [
        {
          file: "예",
          text: "shadow-[0_2px_8px_#00000014] shadow-[0_2px_8px_rgba(0,0,0,.1)] border-[1px_solid_#ddd] bg-[#fff] bg-[linear-gradient(#fff_0%,oklch(0.5_0_0))] &#123; a#bc #ab #section",
        },
      ]),
    ).toEqual([
      "예:1: #00000014",
      "예:1: rgba(",
      "예:1: #ddd",
      "예:1: #fff",
      "예:1: #fff",
      "예:1: oklch(",
    ]);
  });

  it("tsx · ts 안에 색 리터럴이 없다", () => {
    // 색 유틸리티의 임의 값(`bg-[…]`) 안의 색 이름 — 팔레트와 같은 이름(`black` · `white` · `red` …)이 `_`(띄어쓰기) · `,` · `(`
    // 사이에 선다(`black_8%`). 변수 이름(`var(--red-500)`) 안의 글자는 세지 않는다.
    const NAMED = new RegExp(
      `(?<=(?<![\\w-])(?:${COLOR_UTILITY.join("|")})-\\[[^\\]\\s"'\`]*)(?<![a-z0-9-])(?:${palette.join("|")})(?![a-z0-9-])(?=[^\\]\\s"'\`]*\\])`,
      "gi",
    );
    const found = [...offenders(LITERAL, scripts), ...offenders(NAMED, scripts)];
    const excused = (place: string) =>
      LITERAL_EXCEPTIONS.some(
        (one) => place.startsWith(`${one.file}:`) && (one.literal === undefined || place.endsWith(`: ${one.literal}`)),
      );
    // 실패하면 그 색을 Codex 토큰으로 옮긴다 — 클래스(`text-fg-secondary` · `bg-fill-hover`)나 CSS 변수(`var(--accent)`)다.
    expect(found.filter((place) => !excused(place))).toEqual([]);
    const unused = LITERAL_EXCEPTIONS.filter(
      (one) => !found.some((place) => place.startsWith(`${one.file}:`) && (one.literal === undefined || place.endsWith(`: ${one.literal}`))),
    );
    expect(unused).toEqual([]);
  });
});

describe("빨강", () => {
  // **Thread 화면과 사이드바의 빨강은 사이드바 줄의 「실패」와 diff뿐이다**(v1 구현 스펙 스토리 130 · v1 티켓 41 · 02 구현 스펙 §4 S11 ·
  // 캔버스 Components 「사이드바 줄」) — 빨강을 보면 정말 실패한 것이다. Thread 화면의 오류 · 끊김은 색 대신 문장이다(캔버스 Messages 보드
  // 「오류와 중단」의 `fg2` 글). 빨강 토큰은 `danger` · `danger-solid`(오류 글 · 지우는 버튼)와 diff 토큰(`diff-deleted*` · `dot-deleted`)이다.
  // diff 토큰은 이름이 diff를 그리는 자리만 부르므로 두고, `danger` 계열을 Thread 화면(`src/features/thread/`)과 사이드바(`SIDEBAR`)에서
  // 막는다 — 자리는 사이드바 줄의 상태 표시 「실패」 하나다(`status-mark.tsx` — Thread 줄 · Work 줄이 함께 부른다, 02 티켓 05). 앱의
  // 다른 화면(확인 창 · 설정의 오류 글)은 이 판에서 그대로다.
  const RED = [utilities(["danger", "danger-solid"]), variables(["danger", "danger-solid", "color-danger", "color-danger-solid"])];
  const reds = (sources: Source[]) => RED.flatMap((pattern) => offenders(pattern, sources));
  /** 사이드바를 그리는 파일 — Thread 묶음(`SidebarThreads`)은 `src/features/thread/` 쪽으로 함께 든다. 없어진 이름은 아래에서 빨개진다. */
  const SIDEBAR = [
    "src/components/shell/Sidebar.tsx",
    "src/components/shell/sidebar-item.tsx",
    "src/components/shell/sidebar-look.ts",
    "src/components/shell/status-mark.tsx",
    "src/components/shell/attention-band.tsx",
    "src/components/shell/shell-signal.tsx",
    "src/components/shell/shell-meta.tsx",
    "src/features/works/SidebarWorkList.tsx",
    "src/features/works/WorkSectionList.tsx",
    "src/features/works/WorkPeek.tsx",
  ];
  /** 빨강이 서는 자리 — 파일과 그 글자. 쓰이지 않는 자리는 다음 빨강의 뒷문이 되므로 함께 센다. */
  const RED_PLACES: { file: string; literal: string; why: string }[] = [
    { file: "src/components/shell/status-mark.tsx", literal: "text-danger", why: "사이드바 줄의 「실패」 — 빨강을 쓰는 단 하나의 상태" },
  ];
  const placed = (place: string) => RED_PLACES.some((one) => place.startsWith(`${one.file}:`) && place.endsWith(`: ${one.literal}`));

  it("Thread 화면과 사이드바는 줄의 「실패」 말고는 danger 빨강을 쓰지 않는다", () => {
    // 앵커: 변형 · 알파 · 변수 꼴을 잡고, diff 토큰은 잡지 않는다.
    expect(
      reds([{ file: "예", text: "text-danger hover:bg-danger-solid/90 text-diff-deleted bg-diff-deleted-line var(--danger) bg-(--color-danger)" }]),
    ).toEqual(["예:1: text-danger", "예:1: hover:bg-danger-solid/90", "예:1: --danger", "예:1: --color-danger"]);
    const thread = scripts.filter(({ file }) => file.startsWith("src/features/thread/"));
    expect(thread.length).toBeGreaterThan(20);
    const sidebar = scripts.filter(({ file }) => SIDEBAR.includes(file));
    expect(sidebar.map(({ file }) => file).sort()).toEqual([...SIDEBAR].sort());
    const found = reds([...thread, ...sidebar]);
    // 실패하면 그 오류를 색 대신 문장으로 둔다 — 글은 `text-fg-secondary`다(Messages 보드 `.errl`).
    expect(found.filter((place) => !placed(place))).toEqual([]);
    expect(RED_PLACES.filter((one) => !found.some((place) => place.startsWith(`${one.file}:`) && place.endsWith(`: ${one.literal}`)))).toEqual([]);
  });

  // **문제 빨강**(03 구현 스펙 Testing 「빨강은 문제 글 · 문제 알약에만」 · 티켓 04) — Space 파일 고치기 화면이 문제 줄의 끝 글 · 줄 번호 ·
  // 값 밑 물결 · 문제 줄의 면 · 「⚠ 문제 N개」 알약에 쓰는 시안 빨강(`fg-problem` #b4302a · `problem-soft`)이다. 같은 Space의 문제는 목록의
  // 「문제 있음」 · 상세의 문제 줄에서도 같은 빨강이다(03 코드 리뷰 P11). 다른 화면이 이 이름을 빌리면 문제가 아닌 것이 문제처럼 보이고, 이
  // 빨강을 보고 「저장이 왜 꺼졌나」를 읽는 길이 흐려진다.
  it("문제 빨강은 Space의 문제(고치기 화면 · 목록의 「문제 있음」 · 상세의 문제 줄)에만 선다", () => {
    const PROBLEM = [utilities(["fg-problem", "problem-soft"]), variables(["fg-problem", "problem-soft"])];
    const PLACES = ["src/features/spaces/SpaceEditor.tsx", "src/features/spaces/SpaceList.tsx", "src/features/spaces/SpaceDetail.tsx"];
    // 앵커: 변형(`decoration-`)까지 잡는다.
    expect(PROBLEM.flatMap((pattern) => offenders(pattern, [{ file: "예", text: "decoration-fg-problem bg-problem-soft/50" }]))).toEqual([
      "예:1: decoration-fg-problem",
      "예:1: bg-problem-soft/50",
    ]);
    const found = PROBLEM.flatMap((pattern) => offenders(pattern, scripts));
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((place) => !PLACES.some((file) => place.startsWith(`${file}:`)))).toEqual([]);
    expect(PLACES.filter((file) => !found.some((place) => place.startsWith(`${file}:`)))).toEqual([]);
  });

  // 같은 규칙의 다른 쪽(03 코드 리뷰 P11) — 03의 Projects · Space 화면은 danger 빨강을 위험 단추(DS의 `destructive` 갈래 — 이 글자를 쓰지 않는다)와
  // 실패 글에만 쓴다. Space의 문제는 위의 문제 빨강이다 — 같은 「문제 있음」이 화면마다 다른 빨강이 아니게.
  const PLACE_REDS: { file: string; literal: string; why: string }[] = [
    { file: "src/features/projects/ProjectAddDialog.tsx", literal: "text-danger", why: "추가 창의 실패 글(「추가하지 못했어요 — …」)" },
  ];
  it("Projects · Space 화면은 실패 글 말고는 danger 빨강을 쓰지 않는다", () => {
    const places = scripts.filter(({ file }) => file.startsWith("src/features/projects/") || file.startsWith("src/features/spaces/"));
    expect(places.length).toBeGreaterThan(10);
    const found = reds(places);
    const listed = (place: string) => PLACE_REDS.some((one) => place.startsWith(`${one.file}:`) && place.endsWith(`: ${one.literal}`));
    expect(found.filter((place) => !listed(place))).toEqual([]);
    expect(PLACE_REDS.filter((one) => !found.some((place) => place.startsWith(`${one.file}:`) && place.endsWith(`: ${one.literal}`)))).toEqual([]);
  });
});
