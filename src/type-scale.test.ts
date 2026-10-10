/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

// **글자 크기는 디자인 시스템의 열 단계로만 적는다**(ui-refresh 결정 25). 단계는 `index.css`의
// `@theme`에 DS 이름 그대로 있고(`text-meta` … `text-mono-micro`), 크기와 줄 높이를 함께 든다.
// 단계를 토큰만 두고 검사 없이 두면 흩어진다 — 지금 고친 일곱 단계(11 · 11.5 · 12 · 12.5 · 13 ·
// 13.5 · 14px)가 그렇게 생겼다. 손으로 적은 `text-[12.5px]` 하나는 화면에서 13과 거의 안 갈려,
// 눈으로는 지켜지지 않는다. 그래서 여기서 막는다.
//
// **Tailwind의 이름 단계(`text-xs` · `text-sm` …)도 막는다.** 같은 `@theme`이 `--text-*: initial`로
// 기본 단계를 비웠으므로, 이름 단계는 **아무 CSS도 안 나온다** — 빌드도 타입 검사도 통과하고 그
// 글자만 조용히 부모 크기를 물려받는다. 깨진 것이 화면에서 「조금 커 보인다」로만 남는 종류다.
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

// 주석을 같은 길이의 공백으로 지운다 — 줄 번호가 그대로 남아 실패 메시지가 자리를 댈 수 있다.
// 문자열과 템플릿 안의 `//`(주소)를 주석으로 읽지 않으려고 따옴표를 따라간다. 정규식 리터럴은
// 앞 글자로 가른다(나눗셈은 이름 · 닫는 괄호 · 숫자 뒤에 온다).
function blankComments(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  // 열린 템플릿마다 그 `${` 안의 중괄호 깊이
  const templates: number[] = [];
  let i = 0;
  let last = "";
  const skipString = (quote: string) => {
    for (i++; i < source.length && source[i] !== quote && source[i] !== "\n"; i++) {
      if (source[i] === "\\") i++;
    }
    i++;
  };
  const skipTemplate = () => {
    for (i++; i < source.length; i++) {
      if (source[i] === "\\") i++;
      else if (source[i] === "`") return void i++;
      else if (source[i] === "$" && source[i + 1] === "{") {
        templates.push(0);
        return void (i += 2);
      }
    }
  };
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      skipString(c);
      last = c;
    } else if (c === "`") {
      skipTemplate();
      last = c;
    } else if (c === "{" && templates.length > 0) {
      templates[templates.length - 1]++;
      i++;
      last = c;
    } else if (c === "}" && templates.length > 0 && templates[templates.length - 1] === 0) {
      templates.pop();
      skipTemplate();
      last = "`";
    } else if (c === "}" && templates.length > 0) {
      templates[templates.length - 1]--;
      i++;
      last = c;
    } else if (c === "/" && (last === "" || "(,=:[!&|?{};".includes(last))) {
      // 정규식 리터럴 — 문자 집합 `[…]` 안의 `/`는 끝이 아니다
      let inClass = false;
      for (i++; i < source.length && source[i] !== "\n"; i++) {
        if (source[i] === "\\") i++;
        else if (source[i] === "[") inClass = true;
        else if (source[i] === "]") inClass = false;
        else if (source[i] === "/" && !inClass) break;
      }
      i++;
      last = "/";
    } else {
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  return out.join("");
}

function blankCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
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

// `@theme`에 선 글자 단계의 이름 — `--text-ui: 13px;`의 `ui`. 줄 높이 같은 딸린 값(`--text-ui--…`)과
// 초기화 줄(`--text-*`)은 뺀다.
const css = blankCssComments(readFileSync(join(root, "src/index.css"), "utf8"));
const steps = [...css.matchAll(/@theme\b[^{]*\{([^}]*)\}/g)].flatMap((block) =>
  [...block[1].matchAll(/--text-([a-z0-9]+(?:-[a-z0-9]+)*):/g)].map((m) => m[1]),
);

describe("글자 단계", () => {
  // **먼저 읽었음을 센다.** 주석 지우기가 새서 원문을 통째로 지우면 아래 「0건」이 저절로 초록이 된다 —
  // 단계 클래스가 주석 밖에서 실제로 보이는지까지 본다.
  it("검사가 실제로 소스를 읽는다", () => {
    expect(steps).toEqual([
      "meta",
      "caption",
      "ui",
      "row",
      "body",
      "h2",
      "title",
      "mono",
      "mono-sm",
      "mono-micro",
    ]);
    const uses = new RegExp(`(?<![\\w-])text-(?:${steps.join("|")})(?![\\w-])`, "g");
    expect(sources.length).toBeGreaterThan(100);
    expect(offenders(uses).length).toBeGreaterThan(200);
  });

  it("글자 크기를 임의 값으로 적지 않는다", () => {
    // 실패하면 그 자리를 단계로 옮긴다 — 크기로는 11 · 11.5 → meta, 12 → caption, 12.5 · 13 · 13.5 → ui,
    // 14 · 14.5 → row, 15 · 15.5 · 16.5 → body, 18 · 19 → h2, 25 · 26 → title이고, 고정폭 자리는
    // mono-sm(12) · mono(13)이다. 역할이 크기와 다르면 DS의 「쓰는 자리」를 따른다.
    expect(offenders(/text-\[\d+(?:\.\d+)?px\]/g)).toEqual([]);
  });

  it("Tailwind 이름 단계를 쓰지 않는다", () => {
    // `--text-*: initial` 뒤라 이 클래스들은 CSS가 안 나온다. xs → caption · sm → ui · base → body다.
    expect(offenders(/(?<![\w-])text-(?:xs|sm|base|lg|[2-9]?xl)(?![\w-])/g)).toEqual([]);
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

// **클래스를 합치는 `cn`이 단계 이름을 안다.** 합치기는 같은 갈래의 앞 클래스를 지운다. 단계 이름은
// Tailwind 기본 이름이 아니라서 따로 알려 주지 않으면 **글자색으로 읽혀**, `text-ui text-tertiary`에서
// 크기가 조용히 사라진다. 그 이름표는 `lib/utils.ts`에 있고, 부품은 모두 거기서 `cn`을 받는다.
// 반경 이름도 같다 — 모르면 `rounded-lg rounded-card`를 둘 다 남겨, 어느 모서리가 서는지를 CSS의 순서가 정한다.
describe("cn이 DS 단계를 안다", () => {
  it("단계와 글자색을 함께 남긴다", () => {
    const dropped = steps.filter((step) => cn(`text-${step} text-tertiary`) !== `text-${step} text-tertiary`);
    expect(dropped).toEqual([]);
    // 크기끼리는 뒤의 것이 이긴다 — 부르는 자리의 className이 부품의 단계를 덮는 길이다.
    expect(cn("text-ui", "text-caption")).toBe("text-caption");
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
