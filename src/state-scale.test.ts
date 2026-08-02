/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 상태(선택·hover·켜짐)를 말하는 배경은 무채색 농도 4단(--state-1~4) 하나만 읽는다.
// --accent(5%)는 칩 배경·상태 배지 전용이다.
//
// 이 불변조건은 눈으로는 지켜지지 않는다 — 5%와 버튼 hover 6%는 사실상 구분되지 않아서,
// 새로 쓴 hover:bg-accent 하나가 화면에서 티가 나지 않는다. 다음에 농도를 조정할 때
// 그 자리만 따로 남아서야 드러난다. 그래서 눈이 아니라 여기서 막는다.

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("상태 농도 스케일", () => {
  it("상태 배경으로 --accent를 쓰지 않는다", () => {
    const offenders = sourceFiles(join(root, "src")).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/.*\bhover:bg-accent\b.*/g)].map(
        (m) => `${file.slice(root.length)}: ${m[0].trim()}`,
      );
    });
    // 실패하면 hover:bg-accent를 hover:bg-state-1(행) 또는 hover:bg-state-2(버튼)로 옮긴다.
    // 어느 쪽인지는 index.css의 부등식이 정한다: 행 hover(1) < 행 선택(2), 버튼 hover(2) < 켜짐(3).
    expect(offenders).toEqual([]);
  });
});
