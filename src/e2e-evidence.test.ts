/// <reference types="node" />
// Node 타입을 이 파일만 끌어온다 — tsconfig의 전역 types를 건드리면 프로젝트 전체의
// 자동 @types 포함이 좁아진다. 임포트 형태는 이웃한 tauri-commands.test.ts를 따른다.
import { spawnSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../playwright.config";

// 실패 증거(콘솔·DOM·실패 지점)는 e2e/evidence.ts의 fixture가 모은다. 그 수집이 멈추는
// 길은 전부 **조용하다** — 테스트는 그대로 통과하고, 증거가 필요한 날에야 폴더가 빈 것을
// 발견한다. 그래서 멈추는 길마다 걸쇠를 하나씩 건다.
//
// 이 검사가 src/ 에 사는 이유: vitest는 src/ 만 훑고, e2e/ 아래에 *.test.ts를 두면
// Playwright의 testMatch에도 걸려 두 러너가 같은 파일을 돌린다.
const root = fileURLToPath(new URL("..", import.meta.url));

describe("L3 증거 수집", () => {
  // 길 1: spec이 `@playwright/test`에서 곧장 test를 가져와 fixture를 건너뛴다.
  //
  // 검사를 **문자열 유무**로 건다. 임포트 문법을 파싱해 값과 타입을 가리려던 판이 먼저
  // 있었는데, `[^;]`가 개행을 먹는 바람에 주석에 "import type"이라는 말만 있어도 뒤따르는
  // 진짜 값 임포트가 통째로 안 보였다 — 그것도 **못 잡는 쪽으로** 샜다. 파서가 새면 조용히
  // 통과하므로, 파싱이 필요 없도록 문을 하나로 좁히고 그 문만 센다. 타입도 evidence.ts가
  // 다시 내보낸다.
  //
  // 파일 목록을 spec 글롭으로 좁히지 않는 것도 같은 이유다. 글롭을 손으로 베껴 적으면
  // Playwright의 testMatch(`*.@(spec|test).?(c|m)[jt]s?(x)`)와 어긋나서, 돌긴 도는데
  // 검사에는 안 잡히는 파일이 생긴다.
  it("e2e에서 @playwright/test를 쓰는 파일은 evidence.ts뿐이다", () => {
    const files = readdirSync(join(root, "e2e"), { recursive: true, encoding: "utf8" }).filter(
      (name) => /\.[cm]?[jt]sx?$/.test(name) && name !== "evidence.ts",
    );
    // 글롭이 무너지면 아래 검사가 빈 배열을 통과시킨다 — 아무것도 안 보고 초록이 된다.
    expect(files.length, "e2e에서 소스 파일을 하나도 찾지 못했다").toBeGreaterThan(0);

    const offenders = files.filter((name) =>
      readFileSync(join(root, "e2e", name), "utf8").includes("@playwright/test"),
    );
    expect(offenders, "이 파일들은 e2e/evidence.ts를 거쳐야 한다").toEqual([]);
  });

  // 길 2: fixture가 auto가 아니게 되어 아무 테스트에도 안 붙는다. 튜플+옵션 형태를 평범한
  // 함수 형태로 되돌리는 것은 리팩터로 흔한 모양이고 타입 검사도 통과한다.
  //
  // 이건 증명이 아니라 걸쇠다. fixture가 실제로 증거를 남기는지는 실패한 테스트가 있어야
  // 알 수 있고, 그 실증은 #120의 몫이다.
  it("증거 fixture가 모든 테스트에 자동으로 붙는다", () => {
    const source = readFileSync(join(root, "e2e/evidence.ts"), "utf8");
    expect(source, "auto가 사라지면 fixture가 아무 테스트에도 안 붙는다").toMatch(/auto:\s*true/);
  });

  // 길 3: 증거가 버전 관리로 새어 나간다. `.gitignore`의 한 줄과 Playwright가 실제로 쓰는
  // 출력 위치가 우연히 맞아떨어질 뿐이라, 어느 한쪽만 바뀌면 증거가 커밋에 딸려 들어간다.
  // 그래서 위치를 설정에서 **가져오고**, 무시되는지는 git에게 직접 묻는다 — .gitignore를
  // 우리가 해석하면 그 해석이 또 틀릴 수 있다.
  it("증거 디렉터리가 버전 관리에서 빠져 있다", () => {
    // 설정이 이 값을 비우면 Playwright는 자기 기본값으로 돌아가는데 verify.mjs는 여전히
    // JSON에 적힌 폴더를 지운다 — 둘이 갈라지는 유일한 길이라 여기서 먼저 막는다.
    const { outputDir } = playwrightConfig;
    expect(outputDir, "playwright.config.ts가 outputDir을 명시해야 한다").toBeDefined();
    const probe = join(outputDir as string, "sample-test", "console.txt");
    const check = spawnSync("git", ["check-ignore", "--quiet", probe], { cwd: root });
    expect(check.status, `${probe} 가 .gitignore에 걸리지 않는다`).toBe(0);
  });
});
