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
// **반경도 같은 방식으로 DS 단계로만 적는다**(ui-refresh 결정 6 · 25). 알약(`rounded-pill`) · 원형
// (`rounded-full`) · 10(`rounded-lg`) · 16(`rounded-card`)의 세 단계와, 10px 컨트롤 안에 드는 것의
// `rounded-inner`(8) · 문서 안 인라인 코드와 트리 확장자 꼬리표의 `rounded-inline`(6)이다. 모서리 열 가지(2 · 5 · 6 · 7 · 8 ·
// 9 · 10 · 12 · 13 · 14px)가 손으로 적은 `rounded-[Npx]`로 그렇게 생겼다.
//
// **`rounded-[…]`는 px 숫자만이 아니라 식(`min()` · `calc()`)까지 막는다.** registry가 들여온
// `rounded-[min(var(--radius-md),10px)]` · `rounded-[calc(var(--radius)-3px)]`도 결국 한 자리의 모서리를
// 손으로 고른 것이다 — 숫자만 막으면 같은 일이 식의 모양으로 검사를 비켜 가고, 단계가 다시 흩어진다.
//
// 세는 곳은 `src`의 소스(테스트 빼고)와 `index.css`다. **주석은 세지 않는다** — shadcn 부품 머리말
// 「앱 규격으로 고친 자리」가 registry의 옛 값(`text-sm` · `rounded-xl` 같은)을 적고, 그 기록은 남아야 한다.
// 주석 밖은 전부 본다 — 문자열 · 템플릿 · CSS 선언(`@apply`)이다.
//
// 예외는 `EXCEPTIONS`에 자리와 까닭을 한 줄씩 적는다. 지금은 없다.

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
    // DS 「Atelier」 2판 `type.groups`의 차례 그대로다 — 제목 · 글 · 대화 · 라벨 · 코드 · Atelier.
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
    ]);
    const uses = new RegExp(`(?<![\\w-])text-(?:${steps.join("|")})(?![\\w-])`, "g");
    expect(sources.length).toBeGreaterThan(100);
    expect(offenders(uses).length).toBeGreaterThan(200);
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

// `@theme`에 선 반경 단계의 이름 — `--radius-card: 16px;`의 `card`. registry가 깐 `sm` · `md` · `xl` …도
// 함께 나온다(앱 코드는 안 쓰지만 `@theme`에 남아 있다).
const radii = [...css.matchAll(/@theme\b[^{]*\{([^}]*)\}/g)].flatMap((block) =>
  [...block[1].matchAll(/--radius-([a-z0-9]+):/g)].map((m) => m[1]),
);

describe("반경 단계", () => {
  it("DS의 반경 이름이 `@theme`에 있다", () => {
    expect(radii).toEqual(expect.arrayContaining(["card", "pill", "inner", "inline"]));
  });

  it("반경을 임의 값으로 적지 않는다", () => {
    // 실패하면 그 자리를 단계로 옮긴다 — 2px(툴팁 화살표) → xs, 5 · 6px → inner(문서 안 인라인 코드 · 트리 확장자 꼬리표는 inline),
    // 7 · 8 · 9 · 10px과 `min()` · `calc()` → lg(10px 컨트롤 **안에** 드는 칩 · kbd · 24px 이하 툴바 칸은 inner),
    // 12 · 13 · 14px → card다. 아이콘 버튼은 full이다.
    expect(offenders(/(?<![\w-])rounded(?:-[trblxyse]{1,2})?-\[[^\]]*\]/g)).toEqual([]);
  });
});

// **클래스를 합치는 `cn`이 단계 이름을 안다.** 합치기는 같은 갈래의 앞 클래스를 지운다. `heading-lg` · `chat-meta` 같은
// 단계 이름은 Tailwind 기본 이름이 아니라서 따로 알려 주지 않으면 **글자색으로 읽혀**, `text-chat-meta text-fg-tertiary`에서
// 크기가 조용히 사라진다. 그 이름표는 `lib/utils.ts`에 있고, 부품은 모두 거기서 `cn`을 받는다.
// 반경 이름도 같다 — 모르면 `rounded-lg rounded-card`를 둘 다 남겨, 어느 모서리가 서는지를 CSS의 순서가 정한다.
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

  it("부품은 이름표를 아는 cn 하나를 쓴다", () => {
    // `from "cn"`으로 바로 받으면 이름표 없는 합치기다. registry 부품을 새로 들이면 이 줄로 들어온다.
    expect(offenders(/from\s+["']cn["']/g).filter((place) => !place.startsWith("src/lib/utils.ts:"))).toEqual([]);
  });
});
