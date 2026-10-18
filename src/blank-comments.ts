/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

// **소스 지킴 검사가 주석을 빼고 읽는 길** — 글자 단계(`type-scale.test.ts`) · 아이콘 선(`icon-stroke.test.ts`) · 상태 면
// (`state-scale.test.ts`) · 색 지킴(`color-guard.test.ts`) · 여백 지킴(`spacing-guard.test.ts`) · 단축키 글자 지킴
// (`hotkey-glyphs.test.ts`)이 함께 쓴다.
// 주석은 옛 값을 기록으로 남기는 자리라(부품 머리말 「앱 규격으로 고친 자리」), 그 글자를 어긴 자리로 세면 안 된다.
//
// `src`를 걷고 읽는 것(`blankedSources`)과 어긴 자리를 `파일:줄: 글자`로 세는 것(`placesOf` · `where`, 원문 한 장의 꼴 `Source`)도
// 여기 한 벌이다 — 색 · 여백 · 아이콘 선 · 단축키 글자 지킴이 부른다.
// codex-ds 전부터 있던 여섯 검사의 걷기는 `origin/develop`과 겹치는 파일을 늘리지 않으려고 제 파일에 둔다.
//
// 테스트 파일이 아니다 — `*.test.ts`면 vitest가 이것을 테스트로 돌린다. 앱 코드는 이것을 부르지 않는다.

// 주석을 같은 길이의 공백으로 지운다 — 줄 번호가 그대로 남아 실패 메시지가 자리를 댈 수 있다.
// 문자열과 템플릿 안의 `//`(주소)를 주석으로 읽지 않으려고 따옴표를 따라간다. 정규식 리터럴은
// 앞 글자로 가른다(나눗셈은 이름 · 닫는 괄호 · 숫자 뒤에 온다).
export function blankComments(source: string): string {
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

// CSS의 주석(`/* … */`)도 같은 길이의 공백으로 지운다.
export function blankCssComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

// pathname은 한글 경로를 퍼센트 인코딩해서 넘긴다 — 이 저장소의 워크트리 경로가 그렇다
const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** 지킴 검사가 읽는 원문 한 장 — `file`은 저장소 뿌리에서 잰 경로이고(`src/main.tsx`), `text`는 주석을 지운 원문이다. */
export type Source = { file: string; text: string };

/** `src`의 소스(tsx · ts, 테스트 빼고)를 주석을 지운 원문으로 읽는다. */
export function blankedSources(): Source[] {
  return sourceFiles(join(root, "src")).map((path) => ({
    file: path.slice(root.length),
    text: blankComments(readFileSync(path, "utf8")),
  }));
}

/** 꼴이 걸린 자리 하나 — 파일 · 줄과 걸린 글자(`text`). `match`는 그 걸림 자체다 — 묶음(`match[1]`)이나 앞뒤 원문(`match.input`)을 더 읽는 검사가 쓴다. */
export type Place = { file: string; line: number; text: string; match: RegExpExecArray };

/**
 * 원문들에서 꼴(`g`를 단 정규식)이 걸린 자리를 센다. 줄은 걸린 글자의 첫 칸이 선 줄이다 — 주석을 같은 길이로 지웠으므로 원래
 * 파일의 줄과 같다.
 */
export function placesOf(pattern: RegExp, sources: Source[]): Place[] {
  return sources.flatMap(({ file, text }) =>
    [...text.matchAll(pattern)].map((match) => ({
      file,
      line: text.slice(0, match.index).split("\n").length,
      text: match[0],
      match,
    })),
  );
}

/** 실패 메시지에 서는 자리 — `파일:줄: 글자`. */
export const where = ({ file, line, text }: Place) => `${file}:${line}: ${text}`;
