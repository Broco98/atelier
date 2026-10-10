/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 상태(선택·hover·켜짐)를 말하는 배경은 Codex 면 알파(`fill-soft` · `fill-hover` · `fill-active`)를 **그 이름으로** 읽는다
// (codex-ds 결정 27 — 옛 이름 `state-1..4`는 그 셋을 가리키는 별칭으로만 남았다, index.css의 상태 농도 주석).
//
// **유틸리티 `accent`(`bg-accent`)를 면으로 쓰지 않는다** — hover · focus · 켜짐(`data-*` · `aria-*`) 어느 갈래로도,
// 변형 없이 조건부 클래스로 붙이는 상태(`at === selected ? … : …`)로도.
// 그 이름은 두 뜻이 겹친다: shadcn이 건 옅은 면(지금 유틸리티가 가리키는 `fill-hover`)과 Codex 파랑(CSS 변수 `--accent`).
// 유틸리티가 파랑으로 넘어가는 날 그 이름으로 칠한 면은 모두 파랑이 된다. 그래서 메뉴 · Select의 켜진 줄도
// registry의 `focus:bg-accent`가 아니라 `focus:bg-fill-hover`로 적는다 — 이 검사에 예외가 없다.
//
// 이 불변조건은 눈으로는 지켜지지 않는다 — 유틸리티 accent는 지금 `fill-hover`와 같은 면이라, 새로 쓴
// `hover:bg-accent` 하나가 화면에서는 버튼 hover와 똑같이 보인다. 이름이 뜻을 바꾸는 날에야 드러난다.
// 그래서 눈이 아니라 여기서 막는다.

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function offenders(pattern: RegExp): string[] {
  return sourceFiles(join(root, "src")).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(pattern)].map((m) => `${file.slice(root.length)}: ${m[0].trim()}`);
  });
}

describe("상태 농도 스케일", () => {
  it("유틸리티 accent를 면으로 쓰지 않는다", () => {
    // 실패하면 그 `bg-accent`를 면 알파로 옮긴다 — 행 hover는 `fill-soft`, 버튼 hover · 메뉴의 켜진 줄 · 꼬리표는
    // `fill-hover`, 켜짐은 `fill-active`다(index.css의 상태 농도 부등식). 변형은 `hover:` · `focus:` · `data-highlighted:` ·
    // `data-[state=open]:` · `aria-expanded:`처럼 무엇이 몇 겹 붙든 세고, 변형이 없어도 센다 — 유틸리티가 옅은 면인
    // 동안은 어느 `bg-accent`든 그 면을 파랑이 될 이름으로 적은 것이다. 유틸리티가 파랑이 되면(07) 맨 `bg-accent`는
    // 파랑 면이라 그때는 변형 뒤의 것만 막는다.
    // `bg-accent-soft` · `bg-accent-solid`(Codex 파랑의 면)와 변수를 바로 읽는 `bg-(--accent)/…`는 다른 이름이라 세지 않는다.
    expect(offenders(/.*(?<![\w-])bg-accent(?![\w-]).*/g)).toEqual([]);
  });

  // 「켜지지 않는 것의 hover」는 quiet-hover 하나가 답한다. 손으로 다시 적으면 열 자리가
  // 같은 문자열을 갖게 되고, 농도를 한 번 조정할 때 열 곳을 다 고쳐야 한다 — 실제로
  // 그 상태였고 ui-refresh가 걷어냈다. 눈으로는 안 보이는 종류라 여기서 막는다.
  // 옛 이름(`state-2` · `foreground`)과 Codex 이름(`fill-hover` · `fg`) 어느 쪽으로 적어도 같은 조합이다.
  it("조용한 hover를 손으로 다시 적지 않는다", () => {
    expect(
      offenders(/.*hover:bg-(?:state-2|fill-hover)\s+hover:text-(?:foreground|fg)(?![\w-]).*/g),
    ).toEqual([]);
  });
});
