/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// **구르는 상자는 전부 같은 막대를 쓴다**(결정 32) — 한 자리만 다른 막대를 쓰면 그 자리에서
// 폭이 달라지고, 그것이 화면에서는 「목록이 밀렸다」로 보인다.
//
// 눈으로는 안 지켜진다: 막대는 구르는 동안에만 보이고 macOS 기본 설정에서는 네이티브도
// 오버레이라, 클래스를 빠뜨린 상자 하나가 이 사람의 화면에서는 똑같아 보인다. 마우스를
// 꽂은 사람의 화면에서만 15px 밀림으로 드러난다. 그래서 눈이 아니라 여기서 막는다.

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// 넘침을 켜는 클래스가 든 **한 줄짜리 문자열 리터럴**만 본다. 줄을 넘지 않는 것이 이 검사가
// 파서 없이 사는 방법이다 — 소스를 반쯤 파싱하는 검사는 파서가 새는 날 조용히 통과한다.
const SCROLLING = /"[^"\n]*\boverflow-(?:[xy]-)?(?:auto|scroll)\b[^"\n]*"/g;

describe("스크롤 막대", () => {
  it("구르는 상자는 빠짐없이 scroll-quiet을 단다", () => {
    const boxes = sourceFiles(join(root, "src")).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(SCROLLING)].map((m) => `${file.slice(root.length)}: ${m[0]}`);
    });

    // **먼저 찾았음을 센다.** 정규식이 새면 빈 배열이 되어 아래가 그냥 통과한다.
    expect(boxes.length).toBeGreaterThan(10);
    expect(boxes.filter((box) => !box.includes("scroll-quiet"))).toEqual([]);
  });
});
