/// <reference types="node" />
// Node 타입을 이 파일만 끌어온다 — tsconfig의 전역 types를 건드리면 프로젝트 전체의
// 자동 @types 포함이 좁아진다. 임포트 형태는 이웃한 tauri-commands.test.ts를 따른다.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 실패 증거(콘솔·DOM·실패 지점)는 e2e/evidence.ts의 fixture가 모은다. spec이
// `@playwright/test`에서 곧장 test를 가져오면 그 fixture를 건너뛰는데, **테스트는 그대로
// 통과한다** — 증거가 필요한 날에야 폴더가 비어 있는 걸 발견한다. 그 조용한 우회를 막는다.
//
// 규칙을 파일 목록이 아니라 **디렉터리 전체**에 건다. spec 글롭을 손으로 베껴 적으면
// Playwright의 testMatch(`*.@(spec|test).?(c|m)[jt]s?(x)`)와 어긋나서, 돌긴 도는데
// 검사에는 안 잡히는 파일이 생긴다 — vite.config.ts가 경고해 둔 그 함정과 같은 종류다.
//
// 이 검사가 src/ 에 사는 이유: vitest는 src/ 만 훑고, e2e/ 아래에 *.test.ts를 두면
// Playwright의 testMatch에도 걸려 두 러너가 같은 파일을 돌린다.
const root = fileURLToPath(new URL("..", import.meta.url));

/** 타입 전용 임포트는 fixture를 우회하지 않는다 — 지우고 나서 남는 것만 따진다. */
function importsPlaywrightValues(source: string): boolean {
  const withoutTypeImports = source.replace(
    /import\s+type\s[^;]*?from\s*['"]@playwright\/test['"]/g,
    "",
  );
  // 문자열 자체를 찾는다. 작은따옴표든 require()든 형태를 가리지 않는다.
  return withoutTypeImports.includes("@playwright/test");
}

describe("L3 증거 수집", () => {
  it("e2e에서 @playwright/test를 직접 쓰는 파일은 evidence.ts뿐이다", () => {
    const files = readdirSync(join(root, "e2e"), { recursive: true, encoding: "utf8" }).filter(
      (name) => /\.[cm]?[jt]sx?$/.test(name) && name !== "evidence.ts",
    );
    // 글롭이 무너지면 아래 검사가 빈 배열을 통과시킨다 — 아무것도 안 보고 초록이 된다.
    expect(files.length, "e2e에서 소스 파일을 하나도 찾지 못했다").toBeGreaterThan(0);

    const bypassing = files.filter((name) =>
      importsPlaywrightValues(readFileSync(join(root, "e2e", name), "utf8")),
    );
    expect(bypassing, "이 파일들은 e2e/evidence.ts의 test를 써야 한다").toEqual([]);
  });
});
