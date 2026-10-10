/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { blankComments } from "./blank-comments";

// **아이콘 선은 한 자리에서 정한다**(codex-ds 스펙 S3). 값은 `components/ui/icon-stroke.ts`가 들고, 앱의 lucide 기본값은
// `main.tsx`의 `LucideProvider` 하나가 준다. 호출부는 굵기를 고르지 않는다.
//
// 이 불변조건은 눈으로는 지켜지지 않는다 — 1.7과 1.8은 화면에서 거의 안 갈리고, 호출부마다 그럴듯한 숫자를 하나씩
// 적다 보면 굵기가 일곱 가지(2 · 1.8 · 1.9 · 1.7 · 2.2 · 1.6 · 2.4)가 된다 — 이 work 전의 앱이 그랬다.
// 한 자리의 값을 바꿔도 숫자를 적은 자리는 따라오지 않아, 규격이 바뀔 때마다 그 자리만 옛 굵기로 남는다. 그래서 여기서 막는다.
//
// 세는 곳은 `src`의 소스(테스트 빼고)이고 **주석은 세지 않는다**(`blank-comments.ts`) — 한 자리의 머리말이 DS의
// 「`strokeWidth={1.5}` + `absoluteStrokeWidth`」를 인용한다. 그려진 굵기(16px에서 1.5px)는 진짜 CSS가 있어야 나오므로
// L3(`e2e/icon-stroke.spec.ts`)가 잰다.

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

type DsException = { name: string; why: string; icon?: RegExp; maxPx?: number; file?: string };

/**
 * **DS가 따로 정한 굵기** — 호출부는 이 이름으로만 기본과 다른 굵기를 준다. 이름마다 쓰는 자리가 정해져 있어 이름이
 * 「조금 굵게」의 뒷문이 되지 않는다: 작은 글리프의 값은 그 모양 · 12px 이하에만, 상태 아이콘의 값은 그 파일에만 선다.
 */
const DS_EXCEPTIONS: DsException[] = [
  {
    name: "SMALL_GLYPH_STROKE",
    why: "12px 이하의 셰브런 · × · + · ✓ — DS가 24칸 2.4를 따로 준다(DS README 「아이콘」, 묶음의 `.ic-check`)",
    icon: /^(?:Chevron\w*|X|Plus|Check)(?:Icon)?$/,
    maxPx: 12,
  },
  {
    name: "STATUS_ICON_STROKE",
    why: "상태 아이콘 — lucide가 아닌 14칸 svg라 그 칸의 단위로 2다(DS `ic-st-*`)",
    file: "src/features/works/status.tsx",
  },
];

type NotIcon = { file: string; tags: string[]; why: string };

/**
 * 아이콘이 아닌 선 — 이 검사 밖이다. 자리는 파일과 그 선을 그리는 요소의 이름이고, 까닭을 한 줄씩 적는다.
 * 파일 통째가 아니다 — 같은 파일의 아이콘(요약 타일 이름 앞의 lucide 아이콘 같은)은 그대로 검사를 받는다.
 */
const NOT_ICONS: NotIcon[] = [
  {
    file: "src/features/processes/SummaryCard.tsx",
    tags: ["line", "polyline"],
    why: "요약 타일의 추이 그림 — 차트의 바닥 · 선이고(`non-scaling-stroke`) 아이콘이 아니다",
  },
];

// 주석을 지운 원문들 — `file`은 저장소 뿌리에서 잰 경로다.
const sources = sourceFiles(join(root, "src")).map((path) => ({
  file: path.slice(root.length),
  text: blankComments(readFileSync(path, "utf8")),
}));

/** 굵기를 고른 자리 하나 — 파일 · 줄, `strokeWidth=` 뒤의 값, 그 값을 받은 요소의 여는 태그(아래 `tag`). */
type StrokeSite = { file: string; line: number; value: string; tag: string };

const sites: StrokeSite[] = sources.flatMap(({ file, text }) =>
  // 값은 `{…}` 또는 따옴표 문자열이다. `tag`는 값 앞의 마지막 `<`에서 그 뒤 첫 `/>`까지다 — 아이콘 · svg 도형은
  // 자식이 없어 스스로 닫히므로 이것이 그 요소의 여는 태그다. 자식을 감싸는 요소(`main.tsx`의 `LucideProvider`)는
  // 첫 자식의 `/>`까지 이어지는데, 그 자리에서는 이름(`tagName`)만 읽는다. 못 찾으면 빈 글자라 아래 검사가 짚는다.
  [...text.matchAll(/\bstrokeWidth=(\{[^}]*\}|"[^"]*"|'[^']*')/g)].map((m) => {
    const start = text.lastIndexOf("<", m.index);
    const end = text.indexOf("/>", m.index);
    return {
      file,
      line: text.slice(0, m.index).split("\n").length,
      value: m[1],
      tag: start === -1 || end === -1 ? "" : text.slice(start, end + 2),
    };
  }),
);

const where = (site: StrokeSite) => `${site.file}:${site.line}: strokeWidth=${site.value}`;
const tagName = (site: StrokeSite) => /^<([\w.]+)/.exec(site.tag)?.[1] ?? "";
const isNumber = (site: StrokeSite) => /^[{"']\s*[\d.]+\s*[}"']$/.test(site.value);
const notIcon = (place: NotIcon, tag: string) => (site: StrokeSite) =>
  site.file === place.file && tagName(site) === tag;
const onIcon = (site: StrokeSite) => !NOT_ICONS.some((place) => place.tags.some((tag) => notIcon(place, tag)(site)));
const named = (name: string) => (site: StrokeSite) => site.value === `{${name}}`;

/** 여는 태그가 그리는 상자의 크기(px) — 클래스 `size-3` · `size-2.5` · `size-[11px]`에서 읽는다. 없으면 `null`. */
function sizeOf(tag: string): number | null {
  const m = /(?<![\w-])size-(?:(\d+(?:\.\d+)?)|\[(\d+(?:\.\d+)?)px\])(?![\w-])/.exec(tag);
  if (m === null) return null;
  return m[1] !== undefined ? Number(m[1]) * 4 : Number(m[2]);
}

/** 그 자리가 DS 예외의 이름을 그 이름이 허락한 자리에서 쓰는가. */
function fitsException(site: StrokeSite): boolean {
  const rule = DS_EXCEPTIONS.find(({ name }) => named(name)(site));
  if (rule === undefined) return false;
  if (rule.file !== undefined && site.file !== rule.file) return false;
  if (rule.icon !== undefined && !rule.icon.test(tagName(site))) return false;
  if (rule.maxPx !== undefined) {
    const px = sizeOf(site.tag);
    if (px === null || px > rule.maxPx) return false;
  }
  return true;
}

describe("아이콘 선", () => {
  // **먼저 읽었음을 센다.** 주석 지우기가 새서 원문을 통째로 지우면 아래 「0건」이 저절로 초록이 된다 — 아이콘을
  // 들이는 파일이 주석 밖에서 실제로 보이는지까지 본다. 굵기를 고른 자리의 수로는 재지 않는다(예외가 줄면 같이 준다).
  it("검사가 실제로 소스를 읽는다", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.filter(({ text }) => text.includes('from "lucide-react"')).length).toBeGreaterThan(20);
  });

  it("목록의 예외마다 쓰는 자리가 있다", () => {
    // 실패하면 그 줄을 목록에서 걷는다 — 아무도 안 쓰는 예외는 다음 사람에게 뒷문으로 보인다.
    for (const { name } of DS_EXCEPTIONS) {
      expect(sites.filter(named(name)).length, name).toBeGreaterThan(0);
    }
    for (const place of NOT_ICONS) {
      for (const tag of place.tags) {
        expect(sites.filter(notIcon(place, tag)).length, `${place.file} <${tag}>`).toBeGreaterThan(0);
      }
    }
  });

  it("앱의 lucide 기본값은 main.tsx의 Provider 하나가 준다", () => {
    const defaults = sites.filter(named("ICON_STROKE"));
    expect(defaults.map((site) => `${site.file} ${tagName(site)}`)).toEqual(["src/main.tsx LucideProvider"]);
  });

  it("호출부가 선 굵기를 숫자로 적지 않는다", () => {
    // 실패하면 그 숫자를 걷는다 — 기본(16px에서 1.5px)은 Provider가 준다. DS가 따로 정한 자리면 `DS_EXCEPTIONS`의 이름을 쓴다.
    expect(sites.filter((site) => onIcon(site) && isNumber(site)).map(where)).toEqual([]);
  });

  it("기본과 다른 굵기는 DS 예외의 이름으로, 그 이름의 자리에서만 준다", () => {
    const stray = sites.filter(
      (site) => onIcon(site) && !isNumber(site) && !named("ICON_STROKE")(site) && !fitsException(site),
    );
    expect(stray.map((site) => `${where(site)} — <${tagName(site)}> ${sizeOf(site.tag) ?? "?"}px`)).toEqual([]);
  });
});
