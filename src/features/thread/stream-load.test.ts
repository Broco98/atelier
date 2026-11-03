/// <reference types="node" />
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// 간격 기록이 배포 빌드에 들지 않는다(01b-9). 정적 임포트가 하나라도 서면 번들에 든다 — 입구는 `main.tsx`의 dev 가드 안 동적 임포트 하나다.
// 실제 번들을 재는 것은 `scripts/stream-load.mjs --check-bundle`이다.
describe("부하 점검의 입구", () => {
  // 주석의 파일 이름은 임포트가 아니다.
  const importers = (module: string) =>
    sources(SRC)
      .filter((path) => new RegExp(`(from |import\\()"[^"]*${module}"`).test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path));

  it("점검 모듈을 부르는 곳은 main.tsx 하나다", () => {
    expect(importers("stream-load")).toEqual(["main.tsx"]);
  });

  it("프레임 기록을 부르는 곳은 점검 모듈 하나다", () => {
    expect(importers("frame-gaps")).toEqual(["features/thread/stream-load.ts"]);
  });

  it("입구는 dev 가드 안의 동적 임포트다", () => {
    const main = readFileSync(join(SRC, "main.tsx"), "utf8");
    expect(main).toMatch(/if \(import\.meta\.env\.DEV && import\.meta\.env\.VITE_STREAM_LOAD\) \{\n[^}]*\n\s*void import\("\.\/features\/thread\/stream-load"\)/);
    expect(main).not.toMatch(/^import .*stream-load/m);
  });
});
