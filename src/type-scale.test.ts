/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { blankComments, blankCssComments } from "./blank-comments";

// **글자는 DS 단계로만 적는다**(codex-ds 결정 27 · 티켓 03). 단계는 `index.css`의 `@theme`에 DS 「Atelier」 2판
// `type.groups`의 이름 그대로 있고(`text-heading-lg` · `text-sm` · `text-chat-meta` · `text-code` …), 크기와 함께 줄 높이 ·
// 굵기 · 자간을 든다 — 12px은 18 줄에 +0.025em, 제목은 모두 600이다. 단계를 토큰만 두고 검사 없이 두면 흩어진다 — ui-refresh
// 때 고친 일곱 크기(11 · 11.5 · 12 · 12.5 · 13 · 13.5 · 14px)가 그렇게 생겼다. 손으로 적은 `text-[12.5px]` 하나는 화면에서
// 13과 거의 안 갈려, 눈으로는 지켜지지 않는다. 그래서 여기서 막는다.
//
// **DS 단계가 아닌 Tailwind 이름 단계(`text-base` · `text-xl` …)도 막는다.** 같은 `@theme`이 `--text-*: initial`로 기본
// 단계를 비웠으므로, DS가 다시 세운 이름(`text-xs` · `text-sm` · `text-md` · `text-lg` …) 밖의 이름 단계는 **아무 CSS도 안
// 나온다** — 빌드도 타입 검사도 통과하고 그 글자만 조용히 부모 크기를 물려받는다. 깨진 것이 화면에서 「조금 커 보인다」로만
// 남는 종류다. 걷은 옛 열 단계(`text-ui` · `text-caption` …)도 같은 까닭으로 막는다.
//
// **반경도 같은 방식으로 Codex 단계로만 적는다**(codex-ds 결정 27). 단계는 `index.css`의 `@theme`에 DS 이름 그대로 있다
// (`rounded-2xs` 2 … `rounded-2xl` 16 … `rounded-full`). 모서리 열 가지(2 · 5 · 6 · 7 · 8 · 9 · 10 · 12 · 13 · 14px)가 손으로 적은
// `rounded-[Npx]`로 그렇게 생겼다. **단계 밖 이름도 막는다** — 같은 `@theme`이 `--radius-*: initial`로 Tailwind 기본 반경을 비웠으므로,
// 목록에 없는 이름(걷은 옛 앱 단계 넷 같은)은 글자 단계처럼 아무 CSS도 안 나와 모서리가 조용히 각진다.
//
// **`rounded-[…]`는 px 숫자만이 아니라 식(`min()` · `calc()`)까지 막는다.** registry가 들여온
// `rounded-[min(var(--radius-md),10px)]` · `rounded-[calc(var(--radius)-3px)]`도 결국 한 자리의 모서리를
// 손으로 고른 것이다 — 숫자만 막으면 같은 일이 식의 모양으로 검사를 비켜 가고, 단계가 다시 흩어진다.
//
// 세는 곳은 `src`의 소스(테스트 빼고)와 `index.css`다. **주석은 세지 않는다** — shadcn 부품 머리말
// 「앱 규격으로 고친 자리」가 registry의 옛 값(`text-sm` · `rounded-xl` 같은)을 적고, 그 기록은 남아야 한다.
// 주석 밖은 전부 본다 — 문자열 · 템플릿 · CSS 선언(`@apply`)이다.
//
// 예외는 `EXCEPTIONS`에 자리와 까닭을 한 줄씩 적는다. 지금은 없다 — 하나 있던 것(그림자 토큰을 안쪽으로 칠하던 공용 틀 카드의 링)은 판
// 안의 칸이 카드의 겉을 버리며 걷혔다(02 구현 스펙 §3 S2).

const root = fileURLToPath(new URL("..", import.meta.url));

type Exception = { file: string; className: string; why: string };
const EXCEPTIONS: Exception[] = [];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// 주석을 지운 원문들 — `파일`은 저장소 뿌리에서 잰 경로다.
const sources = [
  ...sourceFiles(join(root, "src")).map((path) => ({
    file: path.slice(root.length),
    text: blankComments(readFileSync(path, "utf8")),
  })),
  { file: "src/index.css", text: blankCssComments(readFileSync(join(root, "src/index.css"), "utf8")) },
];

// 어긴 자리를 `파일:줄: 클래스`로 센다.
function offenders(pattern: RegExp): string[] {
  return sources.flatMap(({ file, text }) =>
    [...text.matchAll(pattern)]
      .filter((m) => !EXCEPTIONS.some((e) => e.file === file && e.className === m[0]))
      .map((m) => `${file}:${text.slice(0, m.index).split("\n").length}: ${m[0]}`),
  );
}

// `@theme`에 선 글자 단계의 이름 — `--text-chat-meta: 13px;`의 `chat-meta`. 줄 높이 같은 딸린 값(`--text-chat-meta--…`)과
// 초기화 줄(`--text-*`)은 뺀다.
const css = blankCssComments(readFileSync(join(root, "src/index.css"), "utf8"));
const steps = [...css.matchAll(/@theme\b[^{]*\{([^}]*)\}/g)].flatMap((block) =>
  [...block[1].matchAll(/--text-([a-z0-9]+(?:-[a-z0-9]+)*):/g)].map((m) => m[1]),
);

describe("글자 단계", () => {
  // **먼저 읽었음을 센다.** 주석 지우기가 새서 원문을 통째로 지우면 아래 「0건」이 저절로 초록이 된다 —
  // 단계 클래스가 주석 밖에서 실제로 보이는지까지 본다.
  it("검사가 실제로 소스를 읽는다", () => {
    // DS 「Atelier」 2판 `type.groups`의 차례 그대로다 — 제목 · 글 · 대화 · 라벨 · 코드 · Atelier. 끝의 둘은 02가 더한 Codex 실측이다 —
    // 인라인 코드의 .92em(`codespan`, 스펙 §8)과 첫 화면 물음의 28(`home`, 스펙 §11).
    expect(steps).toEqual([
      "heading-5xl",
      "heading-4xl",
      "heading-3xl",
      "heading-2xl",
      "heading-xl",
      "heading-lg",
      "heading-md",
      "heading-sm",
      "heading-xs",
      "lg",
      "md",
      "sm",
      "xs",
      "2xs",
      "3xs",
      "chat-body",
      "chat-meta",
      "form-body",
      "caps-lg",
      "caps-md",
      "code",
      "nav-row",
      "codespan",
      "home",
    ]);
    const uses = new RegExp(`(?<![\\w-])text-(?:${steps.join("|")})(?![\\w-])`, "g");
    expect(sources.length).toBeGreaterThan(100);
    expect(offenders(uses).length).toBeGreaterThan(150);
  });

  it("글자 크기를 임의 값으로 적지 않는다", () => {
    // 실패하면 그 자리를 단계로 옮긴다 — 짝은 크기가 아니라 자리다(DS README 「글자」 표의 「쓰는 곳」). 탭 · 트리 ·
    // 메뉴 · 소제목은 chat-meta(13), 행 · 버튼 · 입력은 sm(14), 메타 · 배지 · 툴팁 · 시간은 xs(12), 문서 본문은 chat-body,
    // 코드는 code(13 · `font-mono`가 글꼴을 든다)다. 표에 없는 자리는 그 DS 부품의 값을 따른다.
    expect(offenders(/text-\[\d+(?:\.\d+)?px\]/g)).toEqual([]);
  });

  it("DS가 세우지 않은 Tailwind 이름 단계를 쓰지 않는다", () => {
    // `--text-*: initial` 뒤라 이 클래스들은 CSS가 안 나온다. `xs` · `sm` · `md` · `lg` · `2xs` · `3xs`는 DS 단계라 막지 않는다.
    // base(16) → md, xl 이상 → heading-*다.
    expect(offenders(/(?<![\w-])text-(?:base|[2-9]?xl)(?![\w-])/g)).toEqual([]);
  });

  it("걷은 옛 열 단계를 쓰지 않는다", () => {
    // `@theme`에서 빠진 이름이라 CSS가 안 나온다 — 짝은 위 「임의 값」의 줄이다(title → heading-lg · h2 → heading-sm ·
    // 문서 body → chat-body · row → sm · caption · meta → xs · mono → code · mono-sm · mono-micro → xs · 2xs + `font-mono`).
    expect(
      offenders(/(?<![\w-])text-(?:meta|caption|ui|row|body|h2|title|mono|mono-sm|mono-micro)(?![\w-])/g),
    ).toEqual([]);
  });
});

// `@theme`에 선 반경 단계의 이름 — `--radius-2xl: 16px;`의 `2xl`. 초기화 줄(`--radius-*`)은 뺀다.
const radii = [...css.matchAll(/@theme\b[^{]*\{([^}]*)\}/g)].flatMap((block) =>
  [...block[1].matchAll(/--radius-([a-z0-9]+):/g)].map((m) => m[1]),
);

// **superellipse 단계**(02 구현 스펙 §4 · §7 · §8 · §10 · S24) — `corner-shape`를 쓸 수 있는 창에서 `index.css`의
// `@supports (corner-shape: …)` 상자가 `:root`에서 다시 세우는 반경 이름이다. 그 밖의 창(WebKit — 앱 · L3)은 `@theme`의 둥근 네모 값을 쓴다.
const superellipse = [
  ...(/@supports\s*\(\s*corner-shape:[^{]*\{\s*:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "").matchAll(/--radius-([a-z0-9]+):/g),
].map((m) => m[1]);

/** superellipse 단계를 쓰는 반경 클래스 — 모서리 쪽 앞말 · 변형도 센다. */
const superellipseUse = new RegExp(
  `(?<![\\w-])(?:[^\\s"'\`]*:)?rounded(?:-(?:[trblxyse]|tl|tr|br|bl|ss|se|es|ee))?-(?:${superellipse.join("|")})(?![\\w-])`,
);

/** 반경을 적는 한 단위 — 소스의 한 줄짜리 문자열(`"…"` · `` `…` ``)과 `index.css`의 `@apply` 한 문장. */
function classUnits({ file, text }: { file: string; text: string }): { file: string; text: string }[] {
  const pattern = file.endsWith(".css") ? /@apply[^;]*;/g : /"[^"\n]*"|`[^`\n]*`/g;
  return [...text.matchAll(pattern)].map((m) => ({ file, text: m[0] }));
}

describe("반경 단계", () => {
  it("Codex의 반경 이름이 `@theme`에 있다", () => {
    // 02가 Codex 실측 일곱을 더했다(크기 차례에 끼운다) — 인라인 코드 `codespan` · 사이드바 줄 `row` · 요약 카드 `summary` · 트레이 `tray` ·
    // 사람 말풍선 `speech` · 입력창 자리 카드 `slot` · 입력창 `prompt`. 값과 쓰임은 `index.css`의 반경 머리말이 든다.
    expect(radii).toEqual([
      "2xs",
      "xs",
      "sm",
      "codespan",
      "md",
      "lg",
      "row",
      "xl",
      "summary",
      "tray",
      "2xl",
      "speech",
      "3xl",
      "slot",
      "bubble",
      "prompt",
      "4xl",
      "composer",
      "full",
    ]);
  });

  it("superellipse 단계는 `@theme`의 반경 이름이다", () => {
    expect(superellipse).toEqual(["codespan", "row", "summary", "slot", "speech"]);
    expect(superellipse.filter((name) => !radii.includes(name))).toEqual([]);
  });

  // **superellipse 단계는 `corner-superellipse`와 함께 단다.** 단계가 다시 세우는 큰 값(12.5 · 15 · 22 · 25)은 모서리 모양이 superellipse일
  // 때의 값이라, 모양 없이 그 값만 서면 `corner-shape`를 쓰는 창에서 둥근 네모가 25% 커진다. 앱(WebKit)에는 `corner-shape`가 없어 그 차이가
  // 화면에 없다 — 눈으로는 안 지켜져 여기서 막는다.
  it("superellipse 단계를 쓰는 클래스에는 corner-superellipse가 함께 선다", () => {
    const unpaired = (units: { file: string; text: string }[]) =>
      units.filter(({ text }) => superellipseUse.test(text) && !/(?<![\w-])corner-superellipse(?![\w-])/.test(text));
    // 앵커: 꼴이 모서리 앞말 · 변형까지 잡고, superellipse 단계가 아닌 반경은 잡지 않는다.
    const sample = classUnits({
      file: "예.tsx",
      text: '"rounded-row corner-superellipse" "rounded-b-summary" "hover:rounded-slot" "rounded-lg rounded-tray" `rounded-speech`',
    });
    expect(unpaired(sample).map(({ text }) => text)).toEqual(['"rounded-b-summary"', '"hover:rounded-slot"', "`rounded-speech`"]);
    expect(unpaired(sources.flatMap(classUnits)).map(({ file, text }) => `${file}: ${text}`)).toEqual([]);
  });

  it("단계 밖 이름을 쓰지 않는다", () => {
    // 모서리 쪽 앞말(`rounded-t-` · `rounded-tl-` …)도 같은 단계를 읽는다. `rounded-none`은 단계가 아니라 0이다.
    const uses = /(?<![\w-])rounded(?:-(?:[trblxyse]|tl|tr|br|bl|ss|se|es|ee))?-([a-z0-9]+)(?![\w-])/g;
    const found = offenders(uses);
    // 앵커: 실제로 반경 클래스를 읽는다 — 주석 지우기가 새서 원문을 통째로 지우면 아래 「0건」이 저절로 초록이 된다.
    expect(found.length).toBeGreaterThan(100);
    const outside = found.filter((place) => {
      const name = /-([a-z0-9]+)$/.exec(place)![1];
      return name !== "none" && !radii.includes(name);
    });
    expect(outside).toEqual([]);
  });

  it("반경을 임의 값으로 적지 않는다", () => {
    // 실패하면 그 자리를 단계로 옮긴다 — 크기로는 2px → 2xs, 4 · 5px → xs, 6 · 7px → sm, 8 · 9px → md, 10 · 11px과 `min()` ·
    // `calc()` → lg, 12 · 13 · 14px → xl, 16px → 2xl, 20 · 22 · 24px → 3xl · bubble · 4xl이고 알약 · 원은 full이다. 역할이 크기와
    // 다르면 DS 「간격 · 반경 · 크기」의 쓰임(입력 · 툴팁 md · 버튼 · 메뉴 줄 lg · 카드 · 메뉴 2xl …)을 따른다.
    expect(offenders(/(?<![\w-])rounded(?:-[trblxyse]{1,2})?-\[[^\]]*\]/g)).toEqual([]);
  });
});

// `@theme`에 선 그림자 유틸리티의 이름 — `--shadow-prominent: var(--shadow-prominent);`의 `prominent`.
const shadows = [...css.matchAll(/@theme\b[^{]*\{([^}]*)\}/g)].flatMap((block) =>
  [...block[1].matchAll(/--shadow-([a-z0-9]+):/g)].map((m) => m[1]),
);

// **그림자도 Codex 이름으로만 적는다**(codex-ds 결정 27 · 스펙 §2). 반경과 달리 Tailwind 그림자 이름공간은 비우지 않았다 —
// 그래서 `shadow-lg` · `shadow-md` …는 CSS가 **나온다**. Tailwind 기본 그림자가 Codex 그림자 사이에 조용히 서고, 화면에서는
// 「조금 다른 그림자」로만 남아 눈으로는 안 지켜진다(스펙 레이아웃 화면의 메시지가 한 번 그렇게 남았다).
describe("그림자 단계", () => {
  it("Codex의 그림자 이름이 `@theme`에 있다", () => {
    // `modal` · `raised` · `lifted`는 두 겹을 합친 이름이다(`index.css`의 그 주석) — 한 요소에 `shadow-*` 둘을 달면 합치기가 앞의 것을
    // 지운다. 끝의 넷은 02가 더한 Codex 실측이다 — 흰 판 `panel` · 사람 메뉴 `menu` · 요약 카드 `summary` · 입력창 `prompt`.
    expect(shadows).toEqual([
      "hairline",
      "100",
      "200",
      "300",
      "400",
      "card",
      "composer",
      "prominent",
      "2xl",
      "modal",
      "raised",
      "lifted",
      "panel",
      "menu",
      "summary",
      "prompt",
    ]);
  });

  it("단계 밖 이름을 쓰지 않는다", () => {
    // `inset-shadow-*` · `drop-shadow-*`는 앞말이 붙어 세지 않는다. `shadow-none`은 단계가 아니라 그림자를 걷는 것이다.
    const found = offenders(/(?<![\w-])shadow-([a-z0-9]+)(?![\w-])/g);
    // 앵커: 실제로 그림자 클래스를 읽는다(위 반경과 같은 까닭) — 떠 있는 카드(`index.css`의 `floating-card`)의 그림자가 보여야 한다.
    expect(found).toContainEqual(expect.stringMatching(/^src\/index\.css:\d+: shadow-prominent$/));
    const outside = found.filter((place) => {
      const name = /-([a-z0-9]+)$/.exec(place)![1];
      return name !== "none" && !shadows.includes(name);
    });
    expect(outside).toEqual([]);
  });

  // **임의 값 그림자도 막는다** — 반경의 `rounded-[…]`와 같다. 이름 꼴(위)만 막으면 `shadow-[0_8px_24px_#0000001f]`처럼 손으로
  // 지은 그림자가 단계 밖에 서고, 그 안의 색은 Codex 토큰을 비켜 가 `.dark`도 못 따라온다. 앞말이 붙은 `inset-shadow-[…]` ·
  // `drop-shadow-[…]`도 같은 일이라 함께 센다. 토큰을 그대로 읽는 자리만 `EXCEPTIONS`에 둔다.
  it("그림자를 임의 값으로 적지 않는다", () => {
    const arbitrary = /(?<![\w-])(?:inset-|drop-)?shadow-\[[^\]\s"'`]*\]/g;
    // 앵커: 꼴을 실제로 잡는다 — 변형(`hover:`)이 붙어도, 앞말이 붙어도 센다.
    const sample = "shadow-[0_8px_24px_#0000001f] hover:shadow-[0_2px_8px_rgba(0,0,0,.1)] drop-shadow-[0_1px_0_white] shadow-card";
    expect([...sample.matchAll(arbitrary)].map((m) => m[0])).toEqual([
      "shadow-[0_8px_24px_#0000001f]",
      "shadow-[0_2px_8px_rgba(0,0,0,.1)]",
      "drop-shadow-[0_1px_0_white]",
    ]);
    // 앵커: 예외 자리가 지금도 그 글자를 쓴다 — 쓰이지 않는 예외는 다음 그림자의 뒷문이 된다.
    for (const one of EXCEPTIONS.filter((e) => /shadow-\[/.test(e.className))) {
      expect(sources.find(({ file }) => file === one.file)?.text, one.file).toContain(one.className);
    }
    // 실패하면 그 그림자를 Codex 단계(`shadow-hairline` · `shadow-prominent` …)로 옮긴다 — 겹이 둘이면 합친 이름(`shadow-raised`
    // 같은)을 `index.css`에 둔다.
    expect(offenders(arbitrary)).toEqual([]);
  });
});

// **클래스를 합치는 `cn`이 단계 이름을 안다.** 합치기는 같은 갈래의 앞 클래스를 지운다. `heading-lg` · `chat-meta` 같은
// 단계 이름은 Tailwind 기본 이름이 아니라서 따로 알려 주지 않으면 **글자색으로 읽혀**, `text-chat-meta text-fg-tertiary`에서
// 크기가 조용히 사라진다. 그 이름표는 `lib/utils.ts`에 있고, 부품은 모두 거기서 `cn`을 받는다.
// 반경 이름도 같다 — 모르면 `rounded-lg rounded-bubble`을 둘 다 남겨, 어느 모서리가 서는지를 CSS의 순서가 정한다.
describe("cn이 DS 단계를 안다", () => {
  it("단계와 글자색을 함께 남긴다", () => {
    // 글자색은 호출부가 쓰는 Codex 이름이다(codex-ds 결정 27) — 알리지 않아도 색으로 읽힌다(`lib/utils.ts`의 주석).
    const dropped = steps.filter((step) => cn(`text-${step} text-fg-tertiary`) !== `text-${step} text-fg-tertiary`);
    expect(dropped).toEqual([]);
    // 크기끼리는 뒤의 것이 이긴다 — 부르는 자리의 className이 부품의 단계를 덮는 길이다.
    expect(cn("text-chat-meta", "text-xs")).toBe("text-xs");
  });

  it("반경 단계도 모서리로 안다", () => {
    // 부품의 모서리(`rounded-lg`)를 부르는 자리의 className이 덮는다 — 뒤의 것 하나만 남아야 한다.
    const kept = radii.filter((name) => cn("rounded-lg", `rounded-${name}`) !== `rounded-${name}`);
    expect(kept).toEqual([]);
  });

  it("Codex 그림자도 그림자로 안다", () => {
    // 이름은 `@theme`의 그림자 유틸리티(위 「그림자 단계」)다. 부르는 자리의 `shadow-none`이 부품의 그림자를 덮어야 한다 — 모르면
    // 합치기가 그 이름을 그림자 색으로 읽어 둘 다 남긴다.
    expect(shadows.filter((name) => cn(`shadow-${name}`, "shadow-none") !== "shadow-none")).toEqual([]);
  });

  it("Codex 시간 · 곡선도 시간 · 곡선으로 안다", () => {
    // 이름은 `@theme`의 시간 유틸리티(`--transition-duration-panel: var(--duration-panel)` …)와 곡선(`--ease-panel` …)이다. 부르는
    // 자리의 `duration-0` · `ease-linear`가 부품의 Codex 시간 · 곡선(`PANEL_MOTION` 같은)을 덮어야 한다 — 모르면 합치기가 둘 다
    // 남겨, 어느 쪽이 서는지를 CSS의 순서가 정한다.
    const [durations, eases] = [/--transition-duration-([a-z0-9-]+):/g, /--ease-([a-z0-9-]+):/g].map((name) =>
      [...css.matchAll(/@theme\b[^{]*\{([^}]*)\}/g)].flatMap((block) => [...block[1].matchAll(name)].map((m) => m[1])),
    );
    // 둘째 줄 여섯 · `settle`은 모션 보드의 토큰이다(v1 티켓 43 — 02 티켓 12가 Codex 값으로 바꾼 단어 · 로그 · 버튼과 부르는 자리가 걷힌 Agent 참여를 걷었다). 끝의 다섯 · 넷은 02가 더한 Codex 움직임이다(02 구현 스펙 §12).
    expect(durations).toEqual([
      ...["basic", "relaxed", "chip", "dropdown", "pulse", "tip", "peek-close", "panel"],
      ...["card", "swap", "jump", "flash", "shimmer", "spin"],
      ...["sidebar", "think", "arrive", "wave", "morph"],
    ]);
    expect(eases).toEqual([
      ...["settle", "default", "enter", "enter-snappy", "exit", "exit-snappy", "move", "out", "panel"],
      ...["spring", "shimmer", "arrive", "wave"],
    ]);
    expect(durations.filter((name) => cn(`duration-${name}`, "duration-0") !== "duration-0")).toEqual([]);
    expect(eases.filter((name) => cn(`ease-${name}`, "ease-linear") !== "ease-linear")).toEqual([]);
  });

  it("부품은 이름표를 아는 cn 하나를 쓴다", () => {
    // `from "cn"`으로 바로 받으면 이름표 없는 합치기다. registry 부품을 새로 들이면 이 줄로 들어온다.
    expect(offenders(/from\s+["']cn["']/g).filter((place) => !place.startsWith("src/lib/utils.ts:"))).toEqual([]);
  });
});
