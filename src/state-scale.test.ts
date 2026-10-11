/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { blankComments } from "./blank-comments";

// 상태(선택·hover·켜짐)를 말하는 배경은 Codex 면 알파(`fill-soft` · `fill-hover` · `fill-active`)를 **그 이름으로** 읽는다
// (codex-ds 결정 27 · index.css의 상태 농도 주석).
//
// **상태 뒤에 유틸리티 `accent`(`bg-accent`)를 붙이지 않는다** — hover · focus · 켜짐(`data-*` · `aria-*`) 어느 갈래로도.
// 그 이름은 두 뜻이 겹친다: shadcn이 건 옅은 면(Codex `fill-hover`)과 Codex 파랑. 유틸리티는 이제 파랑이라(codex-ds 스펙 S1),
// registry가 들여오는 `focus:bg-accent` · `hover:bg-accent`는 옅은 면이 아니라 **파랑 면**으로 켜진다. 그래서 메뉴 · Select의
// 켜진 줄도 registry의 그 쓰임이 아니라 `focus:bg-fill-hover`로 적는다 — 이 검사에 예외가 없다.
// 변형 없이 칠한 `bg-accent`(끌기 선 · 메모리 막대 · 추이 끝점 같은 Codex 파랑의 면)는 그 뜻 그대로라 막지 않는다.
//
// 이 불변조건은 눈으로는 지켜지지 않는다 — 새로 들인 부품의 `focus:bg-accent` 하나는 그 줄을 키보드로 켜기 전까지 화면에
// 없다. 그래서 눈이 아니라 여기서 막는다.
//
// 세는 곳은 `src`의 소스(테스트 빼고)이고 **주석은 세지 않는다**(`blank-comments.ts`) — 부품 머리말 「앱 규격으로 고친 자리」가
// registry의 옛 쓰임을 기록으로 적는다.

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// 주석을 지운 원문들 — `file`은 저장소 뿌리에서 잰 경로다.
const sources = sourceFiles(join(root, "src")).map((path) => ({
  file: path.slice(root.length),
  text: blankComments(readFileSync(path, "utf8")),
}));

// 어긴 자리를 `파일:줄: 클래스`로 센다.
function offenders(pattern: RegExp): string[] {
  return sources.flatMap(({ file, text }) =>
    [...text.matchAll(pattern)].map((m) => `${file}:${text.slice(0, m.index).split("\n").length}: ${m[0].trim()}`),
  );
}

describe("상태 농도 스케일", () => {
  // **먼저 읽었음을 센다.** 주석 지우기가 새서 원문을 통째로 지우면 아래 「0건」이 저절로 초록이 된다 — 면 알파 클래스가
  // 주석 밖에서 실제로 보이는지 본다.
  it("검사가 실제로 소스를 읽는다", () => {
    expect(offenders(/(?<![\w-])bg-fill-(?:soft|hover|active|selected)(?![\w-])/g).length).toBeGreaterThan(20);
  });

  it("상태 뒤에 유틸리티 accent를 면으로 붙이지 않는다", () => {
    // 실패하면 그 `bg-accent`를 면 알파로 옮긴다 — 행 hover는 `fill-soft`, 버튼 hover · 메뉴의 켜진 줄 · 꼬리표는
    // `fill-hover`, 켜짐은 `fill-active`다(index.css의 상태 농도 부등식). 흰 글자를 얹는 켜진 파랑 면은 `accent-solid`다.
    // 변형은 `hover:` · `focus:` · `data-highlighted:` · `data-[state=open]:` · `aria-expanded:` · `group-hover:`처럼 무엇이 몇
    // 겹 붙든 센다(변형은 모두 `:`로 끝난다). `bg-accent-soft` · `bg-accent-solid`는 다른 이름이라 세지 않는다.
    expect(offenders(/[^\s"'`]*:!?bg-accent(?![\w-])[^\s"'`]*/g)).toEqual([]);
  });

  // 「켜지지 않는 것의 hover」는 quiet-hover 하나가 답한다. 손으로 다시 적으면 열 자리가
  // 같은 문자열을 갖게 되고, 농도를 한 번 조정할 때 열 곳을 다 고쳐야 한다 — 실제로
  // 그 상태였고 ui-refresh가 걷어냈다. 눈으로는 안 보이는 종류라 여기서 막는다.
  it("조용한 hover를 손으로 다시 적지 않는다", () => {
    expect(offenders(/[^\s"'`]*hover:bg-fill-hover\s+hover:text-fg(?![\w-])[^\s"'`]*/g)).toEqual([]);
  });
});
