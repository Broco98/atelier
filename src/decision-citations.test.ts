/// <reference types="node" />
// Node 타입을 이 파일만 끌어오는 이유는 tauri-commands.test.ts 상단 주석과 같다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// **UI개선 문서를 부르는 앞말은 하나다** — `UI개선 결정 N` · `UI개선 스펙 §n`/`Sn`. 결정 번호가 세
// 벌(터미널 2판 · header 탭 줄 · UI개선) 같은 파일에 섞여 살아, 앞말 없는 번호는 다음 사람에게
// 반대 규칙을 읽힌다(`search.rs` 머리말). 앞말이 두 가지면 「이 문서를 부르는 말」로 검색해도 반쪽만
// 걸린다.
//
// **앞말 없는 번호는 여기서 못 막는다.** 어느 벌인지는 뜻으로만 갈리고, 그것을 흉내 내는 검사는
// 파서가 새는 날 조용히 통과한다. 여기서 막는 것은 한때 섞여 쓰인 영어 앞말 하나 — 문자열 그대로다.

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// 이 파일 자신이 금지어를 적지 않게 잇는다 — 그대로 적으면 스스로 걸린다.
const BANNED = ["ui-improvement", "스펙"].join(" ");
const PREFERRED = "UI개선 스펙";

describe("결정·스펙 인용", () => {
  it("UI개선 스펙을 영어 앞말로 부르지 않는다", () => {
    const sources = ["src", "e2e"].flatMap((dir) => sourceFiles(join(root, dir)));
    const texts = sources.map((file) => ({ file: file.slice(root.length), text: readFileSync(file, "utf8") }));

    // **먼저 읽었음을 센다.** 경로가 새서 빈 목록이면 아래가 그냥 통과한다 — 바른 앞말이 실제로
    // 걸리는지까지 보면 「파일은 읽었는데 내용이 비었다」도 막힌다.
    expect(sources.length).toBeGreaterThan(100);
    expect(texts.filter(({ text }) => text.includes(PREFERRED)).length).toBeGreaterThan(5);
    expect(texts.filter(({ text }) => text.includes(BANNED)).map(({ file }) => file)).toEqual([]);
  });
});
