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

// 문자열이 **파일 어딘가에** 있는지 묻지 않는다. 그렇게 물었더니 이 파일 자신의 검사가
// 뚫려 있었다 — verify.yml:3의 주석이 `pnpm verify --full`을 그대로 인용하고 있어서,
// 57행의 실행 스텝을 통째로 지워도 초록이었다. 실제로 지워 보고 확인했다. CI가 아무것도
// 검증하지 않는 상태를, 그것을 막으라고 만든 검사가 통과시켰다.
//
// 아래 31~35행에 "스캔은 주석과 명령을 구별하지 못한다"고 이미 적혀 있었는데, 반대
// 방향에만 적용했다. 같은 함정이 이쪽에도 있었다.
//
// 그래서 **실행 스텝의 모양**을 본다. `run:` 키는 줄머리(공백 뒤)에 오고 주석 줄은
// `#`으로 시작하므로 둘이 겹칠 수 없다. YAML 파서를 들이지 않고도 갈린다.
// `run: |` 블록으로 바뀌면 이 검사는 **빨간불이 된다** — 오탐이지만 조용하지 않다.
//
// 뒤에 붙는 인자는 허용한다. 끝을 못 박으면 릴리스가 `pnpm verify --full`로 올라가는
// 정상적인 변경에 거짓 빨간불이 난다. 대신 인자 앞에 공백을 요구해서 `pnpm verify-xyz`
// 같은 다른 명령에는 걸리지 않게 한다.
function runsCommand(name: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[ \\t]*run:[ \\t]+${escaped}([ \\t].*)?$`, "m").test(workflow(name));
}

describe("CI 게이트", () => {
  it("PR 게이트는 관통 층까지 도는 검증을 부른다", () => {
    expect(runsCommand("verify.yml", "pnpm verify --full"), "PR 게이트가 --full을 안 돈다").toBe(
      true,
    );
  });

  it("릴리스도 같은 진입점을 지난다", () => {
    expect(runsCommand("release.yml", "pnpm verify"), "릴리스가 검증 진입점을 안 부른다").toBe(
      true,
    );
  });

  // 반대 방향("층을 직접 부르는 자리가 되살아나지 않았다")은 걸지 않는다. 텍스트에서
  // `cargo test`를 찾는 검사를 먼저 썼다가 **주석에 적힌 그 문자열에 걸렸다** — 스캔은
  // 주석과 명령을 구별하지 못한다. 위 두 검사는 실제로 일어난 회귀(진입점이 사라지고
  // 자기 목록이 들어서는 것)를 잡고, 그 방향으로는 fail-closed다.
});
