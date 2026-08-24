/// <reference types="node" />
// node: 접두사를 쓰지 않는 이유는 이웃한 tauri-commands.test.ts의 주석과 같다.
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 무엇이 "검증"인지는 scripts/verify.mjs 한 곳에만 정의된다 (D9). 이 저장소는 이미 한 번
// 어겼다 — release.yml이 `cargo test` + `pnpm test`라는 자기 목록을 들고 있어서, 태그
// 시점에 통과한 것과 PR에서 통과한 것이 서로 다른 뜻이었다.
//
// 갈라지는 것은 조용하다. 두 목록은 각자 초록이고, 어긋난 사실은 한쪽에서만 잡히는
// 회귀가 실제로 나야 드러난다. 그래서 여기서 못 박는다.
const root = fileURLToPath(new URL("..", import.meta.url));

function workflow(name: string): string {
  return readFileSync(join(root, ".github/workflows", name), "utf8");
}

describe("CI 게이트", () => {
  it("PR 게이트는 관통 층까지 도는 검증을 부른다", () => {
    expect(workflow("verify.yml"), "PR 게이트가 --full을 안 돈다").toContain(
      "pnpm verify --full",
    );
  });

  it("릴리스도 같은 진입점을 지난다", () => {
    expect(workflow("release.yml"), "릴리스가 검증 진입점을 안 부른다").toContain("pnpm verify");
  });

  // 반대 방향("층을 직접 부르는 자리가 되살아나지 않았다")은 걸지 않는다. 텍스트에서
  // `cargo test`를 찾는 검사를 먼저 썼다가 **주석에 적힌 그 문자열에 걸렸다** — 스캔은
  // 주석과 명령을 구별하지 못한다. YAML을 손으로 파싱하는 쪽으로 가면 이 저장소가 이미
  // 한 번 데인 fail-open으로 돌아간다. 위 두 검사는 실제로 일어난 회귀(진입점이 사라지고
  // 자기 목록이 들어서는 것)를 잡고, 그 방향으로는 fail-closed다.
});
