import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./dev-server";

// 브라우저에서 나온 우리 커맨드를 진짜 백엔드로 넘기는 통로. 브라우저 쪽은 이 파일의
// 존재를 모른다 — 전역 함수 이름 하나만 알고 부른다.

/** 다리를 부르는 함수가 브라우저 전역에 붙는 자리. */
export const BRIDGE_FN = "__atelierBridge__";

const BINARY = join(REPO_ROOT, "target/debug/atelier-test-bridge");

/**
 * 커맨드 하나를 다리에 넘긴다. 실패하면 **던진다** — Playwright가 그 오류를 브라우저의
 * `invoke()` 거절로 옮겨 주므로, 화면은 진짜 백엔드가 거절한 것과 똑같이 반응한다.
 */
export function callBridge(home: string, cmd: string, args: Record<string, unknown>): unknown {
  if (!existsSync(BINARY)) {
    throw new Error(
      `다리 바이너리가 없습니다: ${BINARY}\n` +
        `  cargo build -p atelier-test-bridge 로 만드세요 (pnpm verify --full이 먼저 해 줍니다).`,
    );
  }

  // 동기로 부른다. 이 호출을 기다리는 것은 화면 하나뿐이라 비동기로 얻을 게 없고,
  // 동기 쪽이 실패했을 때 스택이 짧아 증거를 읽기 쉽다.
  const result = spawnSync(BINARY, [cmd, JSON.stringify(args)], {
    encoding: "utf8",
    // ATELIER_HOME이 데이터 루트를 임시 폴더로 돌린다 (atelier-core의 paths.rs).
    // 이 한 줄이 개발자의 실제 ~/.atelier를 지키는 전부다.
    env: { ...process.env, ATELIER_HOME: home },
  });

  if (result.error) throw new Error(`다리를 실행하지 못했습니다: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `다리가 종료 코드 ${result.status}로 끝났습니다`);
  }
  // 값을 안 돌려주는 커맨드는 `null`을 찍는다. 빈 출력은 다리가 죽은 것과 구별되지 않는다.
  return JSON.parse(result.stdout);
}
