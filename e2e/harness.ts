import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import { PROJECTS } from "./fixtures";

// 공식 mocks의 CJS 빌드는 의존성이 없는 자립 스크립트다. 그 텍스트를 브라우저
// 초기화 스크립트로 넣으면 번들 단계도 테스트 전용 엔트리도 없이 앱 부팅 **전에**
// 시임이 선다. 늦게 설치하면 루트 셸이 창 정보를 읽다가 화면이 통째로 빈다.
// 패키지가 `mocks.cjs`를 서브패스로 내보내지 않아 직접 resolve할 수 없다.
// 진입점을 resolve해 같은 디렉터리에서 집는다 — 설치 레이아웃에 기대지 않는다.
const MOCKS_SOURCE = readFileSync(
  join(dirname(createRequire(import.meta.url).resolve("@tauri-apps/api")), "mocks.cjs"),
  "utf8",
);

/** 하네스가 답하는 우리 커맨드. L4에서는 이 자리가 진짜 백엔드로 바뀐다. */
const COMMANDS: Record<string, unknown> = {
  list_projects: PROJECTS,
  list_works: [],
  list_archive: [],
};

/**
 * 와이어 층의 `plugin:*` 커맨드. 대응하는 코어 함수가 없어 L3·L4 모두 하네스가 직접 답한다.
 * 이 문자열은 `src/` 트리에 없다 — 전부 의존성 래퍼 안에 있어 소스에서 긁어낼 수 없고,
 * 그래서 손으로 관리한다. 새 플러그인을 쓰기 시작하면 여기에 더해야 한다.
 */
const PLUGINS: Record<string, unknown> = {
  "plugin:event|listen": 1,
  "plugin:event|unlisten": null,
  "plugin:window|is_fullscreen": false,
};

// 이 앱이 쓰는 와이어 층의 나머지 `plugin:*`는 `plugin:dialog|open`(폴더 선택창),
// `plugin:dialog|message`(확인·알림 — `confirm`도 와이어에서는 이것으로 나간다),
// `plugin:opener|open_url`, 그리고 `plugin:path|resolve_directory`(`homeDir`)다.
// 지금 넣지 않는 이유는 둘이다.
// (1) 부팅 경로가 부르지 않아 아무 테스트도 태우지 않는다 — 태우지 않는 스텁은
//     화이트리스트 탐지기가 영원히 건드리지 않는 자리라 조용히 낡는다.
// (2) 폴더 선택창은 고정값이 될 수 없다. 테스트가 미리 만든 임시 폴더의 절대경로를
//     돌려줘야 하므로 테스트별 인자가 필요하다 — 그 형태는 L4(#118)가 정한다.

interface IpcRecord {
  calls: string[];
  unknown: string[];
}

/** 앱 번들이 실행되기 전에 시임을 세운다. 프로덕션 코드는 한 줄도 고치지 않는다. */
export async function installTauriMock(page: Page): Promise<void> {
  // mocks.cjs 텍스트에는 백틱과 `${`가 들어 있다. 템플릿 리터럴에 끼워 넣으면 깨지므로
  // 이 조각만 순수 문자열로 주입하고, 손으로 쓰는 로직은 아래 타입 검사되는 함수에 둔다.
  await page.addInitScript({
    content:
      "(() => { const exports = {};\n" +
      MOCKS_SOURCE +
      "\nwindow.__TAURI_MOCKS__ = exports; })();",
  });

  await page.addInitScript((responses: Record<string, unknown>) => {
    const mocks = (window as unknown as { __TAURI_MOCKS__: {
      mockWindows: (label: string) => void;
      mockIPC: (handler: (cmd: string, args?: unknown) => unknown) => void;
    } }).__TAURI_MOCKS__;

    mocks.mockWindows("main");

    const record: IpcRecord = { calls: [], unknown: [] };
    (window as unknown as { __ATELIER_IPC__: IpcRecord }).__ATELIER_IPC__ = record;

    mocks.mockIPC((cmd) => {
      record.calls.push(cmd);
      if (Object.prototype.hasOwnProperty.call(responses, cmd)) return responses[cmd];
      // `undefined`를 돌려주면 안 된다 — 폴더 선택 화면이 그것을 사용자 취소로 삼켜서,
      // 테스트는 "아무 일도 안 일어났다"로만 실패하고 원인이 엉뚱한 곳을 가리킨다.
      record.unknown.push(cmd);
      throw new Error(`하네스가 모르는 IPC 호출입니다: ${cmd}`);
    });
  }, { ...COMMANDS, ...PLUGINS });
}

/** 화이트리스트 밖으로 새어 나간 호출. 비어 있지 않으면 하네스가 낡은 것이다. */
export async function unknownIpcCalls(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __ATELIER_IPC__: IpcRecord }).__ATELIER_IPC__.unknown,
  );
}
