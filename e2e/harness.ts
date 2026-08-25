import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BRIDGE_FN, callBridge } from "./bridge";
import type { Page } from "./evidence";
import type { Sandbox } from "./l4";
import { IPC_RECORD_KEY, type IpcRecord } from "./ipc-record";
import { FIXTURE_COMMANDS } from "./fixtures";

// 공식 mocks의 CJS 빌드는 의존성이 없는 자립 스크립트다. 그 텍스트를 브라우저
// 초기화 스크립트로 넣으면 번들 단계도 테스트 전용 엔트리도 없이 앱 부팅 **전에**
// 시임이 선다. 늦게 설치하면 루트 셸이 창 정보를 읽다가 화면이 통째로 빈다.
// 패키지가 `mocks.cjs`를 서브패스로 내보내지 않아 직접 resolve할 수 없다.
// 진입점을 resolve해 같은 디렉터리에서 집는다 — 설치 레이아웃에 기대지 않는다.
const MOCKS_SOURCE = readFileSync(
  join(dirname(createRequire(import.meta.url).resolve("@tauri-apps/api")), "mocks.cjs"),
  "utf8",
);

/**
 * 와이어 층의 `plugin:*` 커맨드. 대응하는 코어 함수가 없어 L3·L4 모두 하네스가 직접 답한다.
 * 이 문자열은 `src/` 트리에 없다 — 전부 의존성 래퍼 안에 있어 소스에서 긁어낼 수 없고,
 * 그래서 손으로 관리한다. 새 플러그인을 쓰기 시작하면 여기에 더해야 한다.
 */
const PLUGINS: Record<string, unknown> = {
  "plugin:event|listen": 1,
  "plugin:event|unlisten": null,
  "plugin:window|is_fullscreen": false,
  // `confirm`도 와이어에서는 이 커맨드로 나간다 — `plugin:dialog|confirm`은 없다.
  // 그래서 답은 **null이어야 한다**: `message`는 반환값을 안 쓰고 `confirm`은 null을
  // 취소로 읽는다. true를 돌려주면 확인 대화상자가 전부 "예"가 되어, 삭제 같은 파괴적
  // 흐름이 테스트 안에서 조용히 실행된다.
  "plugin:dialog|message": null,
  // `homeDir()`가 와이어에서 이 이름으로 나간다. Works 화면을 여는 시나리오가 생기면서
  // (사이드바 트리 검사) 이 호출을 지나게 됐다 — 본문 뷰어가 홈 축약 경로(`~/…`)를 펴는 데
  // 쓴다(`useHomeDir`). 값이 화면에 드러나는 자리는 이미지 경로 하나뿐이라 아무 경로여도
  // 되지만, **`~`가 아닌 절대 경로**여야 편 결과가 편 것처럼 보인다.
  "plugin:path|resolve_directory": "/Users/tester",
};

// `plugin:dialog|open`(폴더 선택창)은 고정값이 될 수 없다 — 테스트가 미리 만든 임시
// 폴더의 절대경로를 돌려줘야 한다. 그래서 표에 없고 L4가 인자로 넘긴다.
//
// 아직 안 넣은 것은 `plugin:opener|open_url`이다. 지금 그것을 태우는 시나리오가 없고,
// **태우지 않는 스텁은 조용히 낡는다** — 화이트리스트 탐지기가 영원히 건드리지 않는
// 자리이기 때문이다. 그 시나리오를 쓰는 판이 같이 넣는다.
// (`plugin:path|resolve_directory`는 판 04가 Works 화면을 여는 검사를 들이면서 태웠다.)

/** addInitScript는 인자를 하나만 넘긴다 — 응답표와 전역 이름들을 같이 싣는다. */
interface InitArgs {
  responses: Record<string, unknown>;
  recordKey: string;
  /** 표에 없는 우리 커맨드를 넘길 전역 함수. null이면 넘기지 않고 실패시킨다(L3). */
  bridgeName: string | null;
}

/**
 * L3: 우리 커맨드에 고정 데이터가 답한다. 빠르고 결정론적이라 자가수리 루프가 수십 번
 * 돌아도 안 깨진다.
 */
export async function installFixtureBackend(page: Page): Promise<void> {
  await install(page, { responses: { ...FIXTURE_COMMANDS, ...PLUGINS }, bridgeName: null });
}

/**
 * L4: 우리 커맨드가 브라우저 밖으로 나가 진짜 코어·파일시스템·git을 탄다.
 *
 * 갈래는 **접두사로** 정한다 — `plugin:*`은 대응하는 코어 함수가 없어 넘길 수 없고,
 * 나머지는 전부 다리로 간다. 커맨드 목록을 여기 베껴 적지 않는 이유다: 베껴 적으면
 * 커맨드가 늘어도 양쪽이 같이 낡을 뿐 아무 신호도 나지 않는다. 등록부와 다리가 어긋나는
 * 것은 다리 크레이트의 테스트가 L1에서 잡는다.
 */
export async function installRealBackend(
  page: Page,
  { home, pickedFolder }: Sandbox,
): Promise<void> {
  await page.exposeFunction(BRIDGE_FN, (cmd: string, args: Record<string, unknown>) =>
    callBridge(home, cmd, args),
  );
  await install(page, {
    responses: { ...PLUGINS, "plugin:dialog|open": pickedFolder },
    bridgeName: BRIDGE_FN,
  });
}

/** 앱 번들이 실행되기 전에 시임을 세운다. 프로덕션 코드는 한 줄도 고치지 않는다. */
async function install(
  page: Page,
  { responses, bridgeName }: Omit<InitArgs, "recordKey">,
): Promise<void> {
  // mocks.cjs 텍스트에는 백틱과 `${`가 들어 있다. 템플릿 리터럴에 끼워 넣으면 깨지므로
  // 이 조각만 순수 문자열로 주입하고, 손으로 쓰는 로직은 아래 타입 검사되는 함수에 둔다.
  await page.addInitScript({
    content:
      "(() => { const exports = {};\n" +
      MOCKS_SOURCE +
      "\nwindow.__TAURI_MOCKS__ = exports; })();",
  });

  await page.addInitScript(({ responses, recordKey, bridgeName }: InitArgs) => {
    const mocks = (window as unknown as { __TAURI_MOCKS__: {
      mockWindows: (label: string) => void;
      mockIPC: (handler: (cmd: string, args?: unknown) => unknown) => void;
    } }).__TAURI_MOCKS__;

    mocks.mockWindows("main");

    const record: IpcRecord = { calls: [], unknown: [] };
    (window as unknown as Record<string, IpcRecord>)[recordKey] = record;

    mocks.mockIPC((cmd, args) => {
      // 인자까지 적는다 — "어느 폴더를 골랐나", "어떤 문구로 오류 대화상자를 띄웠나"가
      // 실패를 읽는 데 그대로 쓰인다. 기록하다 터지면 원래 실패보다 시끄러워지므로 감싼다.
      let detail = "";
      try {
        const json = args === undefined || args === null ? "" : JSON.stringify(args);
        detail = json && json !== "{}" ? ` ${json}` : "";
      } catch {
        detail = " (인자를 적지 못했습니다)";
      }
      record.calls.push(`${cmd}${detail}`);
      if (Object.prototype.hasOwnProperty.call(responses, cmd)) return responses[cmd];
      // `plugin:*`은 코어 함수가 없어 다리로 넘길 수 없다. 여기서 답하지 못하면 그게 곧
      // 하네스가 낡았다는 뜻이다.
      if (bridgeName !== null && !cmd.startsWith("plugin:")) {
        const bridge = (window as unknown as Record<string, (c: string, a: unknown) => unknown>)[
          bridgeName
        ];
        return bridge(cmd, args ?? {});
      }
      // `undefined`를 돌려주면 안 된다 — 폴더 선택 화면이 그것을 사용자 취소로 삼켜서,
      // 테스트는 "아무 일도 안 일어났다"로만 실패하고 원인이 엉뚱한 곳을 가리킨다.
      record.unknown.push(cmd);
      throw new Error(`하네스가 모르는 IPC 호출입니다: ${cmd}`);
    });
  }, { responses, recordKey: IPC_RECORD_KEY, bridgeName });
}

/** 화이트리스트 밖으로 새어 나간 호출. 비어 있지 않으면 하네스가 낡은 것이다. */
export async function unknownIpcCalls(page: Page): Promise<string[]> {
  return (await readIpcRecord(page))?.unknown ?? [];
}

/**
 * 브라우저 안의 기록을 그대로 꺼낸다. 실패한 실행에서도 읽히도록 **없을 때 던지지 않는다** —
 * 하네스를 안 세운 테스트, 페이지가 죽은 경우가 둘 다 정상적으로 있다.
 */
export async function readIpcRecord(page: Page): Promise<IpcRecord | null> {
  try {
    return await page.evaluate(
      (key) => (window as unknown as Record<string, IpcRecord | undefined>)[key] ?? null,
      IPC_RECORD_KEY,
    );
  } catch {
    return null;
  }
}
