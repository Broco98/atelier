import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./dev-server";

// 브라우저에서 나온 우리 커맨드를 진짜 백엔드로 넘기는 통로. 브라우저 쪽은 이 파일의
// 존재를 모른다 — 전역 함수 이름 하나만 알고 부른다.

/** 다리를 부르는 함수가 브라우저 전역에 붙는 자리. */
export const BRIDGE_FN = "__atelierBridge__";

const BINARY = join(REPO_ROOT, "target/debug/atelier-test-bridge");

/** 다리가 서는 세상 — 데이터 루트와 git 전역 설정 파일(`l4.ts`의 `Sandbox`에서 이 둘만 본다). */
export interface BridgeWorld {
  home: string;
  gitConfig: string;
}

/**
 * 다리의 환경 — 검사를 돈 셸의 환경에서 git을 가리키는 것을 모두 걷고 sandbox의 것만 세운다.
 *
 * - `GIT_*`(사람 `GIT_AUTHOR_*` · `GIT_COMMITTER_*`, 그리고 훅 안에서 돌 때의 `GIT_DIR` · `GIT_INDEX_FILE` 같은 것)와 `EMAIL`(git이
 *   사람을 짐작하는 값)을 걷는다 — 남으면 진짜 git이 sandbox가 아닌 저장소 · 사람을 탄다.
 * - 전역 설정은 sandbox의 파일이고(`GIT_CONFIG_GLOBAL`), 시스템 설정은 읽지 않는다(`GIT_CONFIG_NOSYSTEM`). 첫 커밋의 사람이 검사가
 *   정한 값이다.
 */
function bridgeEnv({ home, gitConfig }: BridgeWorld): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && key !== "EMAIL"),
  );
  return { ...env, ATELIER_HOME: home, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };
}

/**
 * 커맨드 하나를 다리에 넘긴다. 실패하면 **던진다** — Playwright가 그 오류를 브라우저의
 * `invoke()` 거절로 옮겨 주므로, 화면은 진짜 백엔드가 거절한 것과 똑같이 반응한다.
 */
export function callBridge(world: BridgeWorld, cmd: string, args: Record<string, unknown>): unknown {
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
    // 이 한 줄이 개발자의 실제 ~/.atelier를 지키는 전부다. git은 sandbox의 설정만 탄다(`bridgeEnv`).
    env: bridgeEnv(world),
  });

  if (result.error) throw new Error(`다리를 실행하지 못했습니다: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `다리가 종료 코드 ${result.status}로 끝났습니다`);
  }
  // 값을 안 돌려주는 커맨드는 `null`을 찍는다. 빈 출력은 다리가 죽은 것과 구별되지 않는다.
  return JSON.parse(result.stdout);
}
