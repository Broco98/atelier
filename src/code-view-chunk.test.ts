/// <reference types="node" />
// node: 접두사를 쓰지 않는 이유는 이웃한 tauri-commands.test.ts의 주석과 같다.
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

// **코드 보기는 첫 로드에 붙지 않는다**(git-integration 결정 35 · 티켓 08). 강조 라이브러리(`@pierre/diffs`)는 첫 로드에
// gz 110K를 더한다(사실 12) — 파일 탭을 한 번도 안 여는 사람까지 그 값을 치르면 안 된다. 그래서 코드 보기 모듈
// (`features/code/CodeView`)을 화면이 `lazy`로 부르고, 라이브러리는 그 모듈 아래에서만 들어온다.
//
// 그 약속은 소스의 import 한 줄로 깨진다 — 누가 화면 쪽에서 라이브러리의 타입 아닌 값 하나를 부르면 번들러가 라이브러리를
// 첫 청크로 끌어올리고, 빌드도 타입 검사도 화면도 그대로 초록이다. 그래서 **프로덕션 빌드를 실제로 돌려** 청크 그래프를
// 잰다: 앱의 입구에서 정적 · 동적 import를 다 따라가되 코드 보기 청크로 드는 동적 import 하나만 안 넘으면, 닿는 어느
// 청크에도 라이브러리가 없어야 한다. 그리고 그 하나를 넘으면 라이브러리가 있다.

const root = fileURLToPath(new URL("..", import.meta.url));
const CODE_VIEW = "src/features/code/CodeView.tsx";
const isPierre = (id: string) => id.includes("/@pierre/diffs/");

interface Chunk {
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  moduleIds: string[];
  imports: string[];
  dynamicImports: string[];
}

let outDir: string;
let chunks: Map<string, Chunk>;

beforeAll(async () => {
  // 쓰지 않고 메모리에서 받는다 — 그래도 내보낼 폴더는 정해 두어 저장소의 `dist`를 건드리지 않게 한다.
  outDir = mkdtempSync(join(tmpdir(), "atelier-chunks-"));
  const result = await build({
    root,
    configFile: join(root, "vite.config.ts"),
    logLevel: "silent",
    build: { write: false, outDir, emptyOutDir: false, reportCompressedSize: false },
  });
  const outputs = Array.isArray(result) ? result : [result];
  chunks = new Map();
  for (const output of outputs) {
    if (!("output" in output)) throw new Error("빌드가 감시 모드로 돌았다");
    for (const item of output.output) if (item.type === "chunk") chunks.set(item.fileName, item);
  }
}, 120_000);

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

/** `from`에서 import를 따라 닿는 청크들. `skip`인 청크로는 들어가지 않는다. */
function reach(from: Chunk[], follow: (chunk: Chunk) => string[], skip?: Chunk): Set<Chunk> {
  const seen = new Set<Chunk>();
  const queue = [...from];
  while (queue.length > 0) {
    const chunk = queue.pop()!;
    if (chunk === skip || seen.has(chunk)) continue;
    seen.add(chunk);
    for (const name of follow(chunk)) {
      const next = chunks.get(name);
      if (next) queue.push(next);
    }
  }
  return seen;
}

const pierreIn = (set: Set<Chunk>) =>
  [...set].filter((chunk) => chunk.moduleIds.some(isPierre)).map((chunk) => chunk.fileName);

describe("코드 보기 청크", () => {
  it("코드 보기 모듈은 동적 import로만 닿는 제 청크다", () => {
    const codeView = [...chunks.values()].find((chunk) => chunk.facadeModuleId?.endsWith(CODE_VIEW));
    expect(codeView, `${CODE_VIEW}가 자기 청크의 입구가 아니다 — 누군가 정적으로 부른다`).toBeDefined();
    const staticallyImported = [...chunks.values()].filter((chunk) => chunk.imports.includes(codeView!.fileName));
    expect(staticallyImported.map((chunk) => chunk.fileName)).toEqual([]);
  });

  it("앱의 입구에서 코드 보기 청크를 거치지 않고 닿는 어느 청크에도 `@pierre/diffs`가 없다", () => {
    const entries = [...chunks.values()].filter((chunk) => chunk.isEntry);
    expect(entries.length).toBeGreaterThan(0);
    const codeView = [...chunks.values()].find((chunk) => chunk.facadeModuleId?.endsWith(CODE_VIEW));
    const withoutCodeView = reach(entries, (chunk) => [...chunk.imports, ...chunk.dynamicImports], codeView);
    expect(pierreIn(withoutCodeView)).toEqual([]);
  });

  it("코드 보기 청크가 정적으로 부르는 것 안에 `@pierre/diffs`가 있다", () => {
    const codeView = [...chunks.values()].find((chunk) => chunk.facadeModuleId?.endsWith(CODE_VIEW));
    expect(codeView).toBeDefined();
    expect(pierreIn(reach([codeView!], (chunk) => chunk.imports)).length).toBeGreaterThan(0);
  });
});
