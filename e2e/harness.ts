import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BRIDGE_FN, callBridge } from "./bridge";
import { expect } from "./evidence";
import type { Locator, Page } from "./evidence";
import type { Sandbox } from "./l4";
import { IPC_RECORD_KEY, type IpcRecord } from "./ipc-record";
import {
  FIXTURE_BY_MODE,
  FIXTURE_COMMANDS,
  FIXTURE_INCREMENTING_KEYS,
  FIXTURE_SHELL_NAME,
  type ModeAnswer,
} from "./fixtures";

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
  // `homeDir()`가 와이어에서 이 이름으로 나간다. Works 화면을 여는 시나리오가 생기면서
  // (사이드바 트리 검사) 이 호출을 지나게 됐다 — 본문 뷰어가 홈 축약 경로(`~/…`)를 펴는 데
  // 쓴다(`useHomeDir`). 값이 화면에 드러나는 자리는 이미지 경로 하나뿐이라 아무 경로여도
  // 되지만, **`~`가 아닌 절대 경로**여야 편 결과가 편 것처럼 보인다.
  "plugin:path|resolve_directory": "/Users/tester",
  // 설정 화면이 「알림 권한이 있나」를 묻는 길(#206 · 스토리 69). 헤드리스 WebKit의
  // `Notification.permission`이 `default`라 플러그인 JS가 여기까지 온다 — 답이 없으면
  // 설정 화면을 여는 시나리오(`search-palette.spec.ts`)가 화이트리스트 밖으로 샌다.
  // **`true`다**: 거부된 화면을 재는 것은 마크업 seam의 일이고(`SettingsPage.test.tsx`),
  // 여기서 거짓을 주면 설정 화면 검사가 매번 그 문구를 지고 선다.
  "plugin:notification|is_permission_granted": true,
  // 독 배지(#206 · 스토리 65). 값은 안 쓰이지만 **답이 있어야 화이트리스트를 안 넘는다** —
  // 실제로 무엇이 실려 나갔는지는 IPC 기록에서 읽는다(`e2e/shell-notify.spec.ts`).
  "plugin:window|set_badge_count": null,
};

// `plugin:dialog|open`(폴더 선택창)은 고정값이 될 수 없다 — 테스트가 미리 만든 임시
// 폴더의 절대경로를 돌려줘야 한다. 그래서 표에 없고 L4가 인자로 넘긴다.
//
// **`plugin:dialog|message`를 뺐다.** 확인·알림 창이 앱의 것으로 바뀌면서(`AppDialog`)
// 앱이 그 커맨드로 나가는 길이 없어졌다 — 남겨 두면 아무도 안 태우는 스텁이 되고, 그러면
// 「OS에 안 물었다」를 보는 검사가 **답이 준비돼 있어서** 초록인지 정말 안 물어서 초록인지
// 갈리지 않는다. 지금은 그 커맨드가 오면 화이트리스트 탐지기가 문다.
//
// 아직 안 넣은 것은 `plugin:opener|open_url`이다. 지금 그것을 태우는 시나리오가 없고,
// **태우지 않는 스텁은 조용히 낡는다** — 화이트리스트 탐지기가 영원히 건드리지 않는
// 자리이기 때문이다. 그 시나리오를 쓰는 판이 같이 넣는다.
// (`plugin:path|resolve_directory`는 판 04가 Works 화면을 여는 검사를 들이면서 태웠다.)

/**
 * 답 대신 **거절**을 싣는 표시의 키. 값으로는 실패를 못 적어서(`null`도 `false`도 멀쩡한 답이다)
 * 이 키 하나를 가진 객체만 거절로 읽는다 — 앱의 데이터에 이 모양이 우연히 나올 일은 없다.
 */
const IPC_FAILURE_KEY = "__atelierIpcFailure";

/**
 * `installFixtureBackend`의 덮어쓰기에 넣으면 그 커맨드가 **이 문구로 거절된다.** 실물 백엔드의
 * 거절도 문자열이라(`CmdResult`의 오류 · IPC 층의 오류) 문자열 그대로 던진다 — `Error`로 싸면
 * 앱이 `${e}`로 적을 때 「Error: 」가 붙어 실물과 다른 문구를 재게 된다.
 */
export const ipcFailure = (message: string): Record<string, string> => ({
  [IPC_FAILURE_KEY]: message,
});

/** addInitScript는 인자를 하나만 넘긴다 — 응답표와 전역 이름들을 같이 싣는다. */
interface InitArgs {
  responses: Record<string, unknown>;
  recordKey: string;
  /** 답 대신 거절을 싣는 표시의 키(`ipcFailure`). 브라우저 쪽이 모듈 상수를 못 읽어 함께 싣는다. */
  failureKey: string;
  /** 표에 없는 우리 커맨드를 넘길 전역 함수. null이면 넘기지 않고 실패시킨다(L3). */
  bridgeName: string | null;
  /**
   * **모드로 갈리는** 커맨드의 답: 커맨드 이름 → 모드 → 그 몫. `responses`보다 먼저 보고,
   * 여기 있는 커맨드는 **그 표로 안 떨어진다** — 못 찾으면 문다(`fixtures.ts`의 머리말).
   * 인자를 한 겹 더 봐야 하는 커맨드(문서 읽기·아카이브 문서 목록)도 여기서 함께 든다:
   * 그것들이 전부 모드를 받으므로(#187) 인자만 보는 표는 따로 설 자리가 없다 — 한때 있던
   * `byArg`가 그 자리였고, 마지막 두 줄이 `byMode`로 옮겨 가면서 통째로 사라졌다.
   *
   * 값이 `Record<string, …>`인 것은 와이어에서 온 `mode`가 아무 문자열일 수 있어서다:
   * `Mode`로 좁히면 그 인덱싱에 캐스트가 필요해지고, 캐스트는 모르는 값을 아는 값처럼 만든다.
   * L4는 진짜 백엔드가 답하므로 비어 있다 — 거기서 `mode`를 빠뜨린 호출은 하네스가 아니라
   * **다리가** 거절한다(`crates/atelier-test-bridge`).
   */
  byMode: Record<string, Record<string, ModeAnswer>>;
  /**
   * **부를 때마다 답이 달라져야 하는** 커맨드들: 커맨드 이름 → 그 답에서 하나씩 올릴 키.
   * 무엇을 왜 여기 넣는지는 `fixtures`의 `FIXTURE_INCREMENTING_KEYS`가 든다. L4는 진짜
   * 백엔드가 답하므로 비어 있다.
   */
  incrementing: Record<string, string>;
}

/**
 * L3: 우리 커맨드에 고정 데이터가 답한다. 빠르고 결정론적이라 자가수리 루프가 수십 번
 * 돌아도 안 깨진다.
 */
export async function installFixtureBackend(
  page: Page,
  /**
   * 이 시나리오에서만 다른 답을 줄 커맨드들. 표를 통째로 갈지 않고 **덮어쓴다** — 알림
   * 설정처럼 「파일이 이렇게 적혀 있을 때」를 재는 검사가 `read_settings` 하나만 바꾸면
   * 되게 하려는 것이고, 표에 없는 이름은 아래에서 거절하므로 새 커맨드를 세우는 자리로는
   * 못 쓴다(그것은 `FIXTURE_COMMANDS`의 몫이다).
   */
  overrides: Record<string, unknown> = {},
): Promise<void> {
  for (const cmd of Object.keys(overrides)) {
    // **모르는 이름은 여기서 터진다.** 커맨드가 개명되면 덮어쓰기가 아무 데도 안 걸린 채
    // 지나가고, 검사는 고정 표의 답을 받은 채로 「설정이 이랬는데도 조용했다」를 초록으로
    // 낸다 — 그 침묵이 이 층에서 가장 읽기 어려운 실패다.
    if (!Object.prototype.hasOwnProperty.call(FIXTURE_COMMANDS, cmd)) {
      throw new Error(`덮어쓸 커맨드가 고정 답 표에 없습니다: ${cmd}`);
    }
  }
  await install(page, {
    responses: { ...FIXTURE_COMMANDS, ...PLUGINS, ...overrides },
    bridgeName: null,
    byMode: FIXTURE_BY_MODE,
    incrementing: FIXTURE_INCREMENTING_KEYS,
  });
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
    byMode: {},
    incrementing: {},
  });
}

/** 앱 번들이 실행되기 전에 시임을 세운다. 프로덕션 코드는 한 줄도 고치지 않는다. */
async function install(
  page: Page,
  { responses, bridgeName, byMode, incrementing }: Omit<InitArgs, "recordKey" | "failureKey">,
): Promise<void> {
  // mocks.cjs 텍스트에는 백틱과 `${`가 들어 있다. 템플릿 리터럴에 끼워 넣으면 깨지므로
  // 이 조각만 순수 문자열로 주입하고, 손으로 쓰는 로직은 아래 타입 검사되는 함수에 둔다.
  await page.addInitScript({
    content:
      "(() => { const exports = {};\n" +
      MOCKS_SOURCE +
      "\nwindow.__TAURI_MOCKS__ = exports; })();",
  });

  await page.addInitScript(({ responses, recordKey, failureKey, bridgeName, byMode, incrementing }: InitArgs) => {
    const mocks = (window as unknown as { __TAURI_MOCKS__: {
      mockWindows: (label: string) => void;
      mockIPC: (handler: (cmd: string, args?: unknown) => unknown) => void;
    } }).__TAURI_MOCKS__;

    mocks.mockWindows("main");

    // **`convertFileSrc`는 IPC가 아니라 웹뷰가 주는 것이다** — 공식 mocks가 안 세운다.
    // 로컬 파일을 화면에 걸려면 asset 프로토콜을 거쳐야 하는데(본문의 그림), 없으면
    // 부르는 순간 터져 앱이 통째로 언마운트된다 — 실패가 「화면이 비었다」로만 보여
    // 원인이 엉뚱한 곳을 가리킨다. 실물 macOS가 만드는 모양을 그대로 흉내낸다.
    const internals = (window as unknown as Record<string, Record<string, unknown>>)
      .__TAURI_INTERNALS__;
    internals.convertFileSrc ??= (filePath: string, protocol = "asset") =>
      `${protocol}://localhost/${encodeURIComponent(filePath)}`;

    // 수를 올리는 커맨드가 지금까지 몇 번 불렸는가. 브라우저 안에서만 산다 — 답을 만드는
    // 일이 여기서 일어나야 하는 이유는 `FIXTURE_INCREMENTING_KEYS`의 머리말에 있다.
    const seen = new Map<string, number>();

    // 답 하나에 **회차를 얹는다.** 올릴 커맨드가 아니면 받은 것을 그대로 돌려주므로 모든
    // 답이 이 문을 지나도 된다 — 그것이 요점이다: 답을 내는 갈래가 둘인데(모드 표·이름 표)
    // 한쪽만 이 일을 하면 그 표로 옮겨 간 커맨드가 조용히 고정 id로 돌아간다. 실제로
    // `pty_spawn`이 #187에서 모드 표로 옮겨 갔다.
    const bump = (cmd: string, answer: unknown) => {
      if (!Object.prototype.hasOwnProperty.call(incrementing, cmd)) return answer;
      const key = incrementing[cmd];
      const base = (answer as Record<string, unknown> | undefined)?.[key];
      // **여기서 조용히 넘어가지 않는다.** 키가 틀렸거나 답의 모양이 바뀌면 `base + n`이
      // `undefined`나 문자열 이어붙이기가 되어 시나리오는 돌고 값만 이상해진다 — 그러면
      // 「셸마다 다른 id」를 재는 검사가 무엇을 재고 있는지 아무도 모른다.
      if (typeof base !== "number") {
        throw new Error(`수를 올릴 값이 수가 아닙니다: ${cmd}.${key}`);
      }
      const n = seen.get(cmd) ?? 0;
      seen.set(cmd, n + 1);
      return { ...(answer as Record<string, unknown>), [key]: base + n };
    };

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
      // **모드로 갈리는 커맨드가 맨 먼저다.** 그리고 여기 있는 커맨드는 아래 이름 표로 **안
      // 떨어진다** — 답을 못 찾으면 그 표가 아니라 화이트리스트 탐지기로 간다. 실물 백엔드는
      // `mode`를 필수로 받지만(#187) 그 거절은 L3에 안 온다: 여기서 백엔드 노릇을 하는 것이
      // 이 표라, 아래로 떨어지게 두면 `mode`가 없거나 모르는 값인 호출이 조용히 Atelier
      // 데이터를 받아 「Maison 화면에 Atelier 것이 떴다」가 아무 데도 안 걸린다.
      // 그 물림을 음성 케이스로 세우는 자리는 `mode-fail-closed.spec.ts`다.
      const forCmd = Object.prototype.hasOwnProperty.call(byMode, cmd) ? byMode[cmd] : null;
      if (forCmd) {
        const mode = (args as Record<string, unknown> | undefined)?.mode;
        const answer =
          typeof mode === "string" && Object.prototype.hasOwnProperty.call(forCmd, mode)
            ? forCmd[mode]
            : null;
        if (answer) {
          // 인자를 한 겹 더 보는 모드는 표를 먼저 보고, 못 찾으면 그 모드의 기본 답으로 간다.
          // `value`를 **키의 유무로** 가른다 — `null`도 답이 될 수 있어서 값으로는 못 가른다.
          if (answer.arg !== undefined && answer.answers !== undefined) {
            const key = (args as Record<string, unknown> | undefined)?.[answer.arg];
            if (
              typeof key === "string" &&
              Object.prototype.hasOwnProperty.call(answer.answers, key)
            ) {
              return bump(cmd, answer.answers[key]);
            }
          }
          if (Object.prototype.hasOwnProperty.call(answer, "value")) return bump(cmd, answer.value);
        }
        // 인자를 함께 적는다 — 「`mode`가 없었나」와 「그 모드에 그 경로가 없었나」가
        // 실패 문구에서 갈려야 다음 수정이 정해진다.
        record.unknown.push(`${cmd}${detail}`);
        throw new Error(`하네스가 모드로 답하지 못하는 IPC 호출입니다: ${cmd}${detail}`);
      }
      // 표에 적힌 값을 **첫 값**으로 삼아, 올릴 커맨드면 부를 때마다 하나씩 올린다.
      if (Object.prototype.hasOwnProperty.call(responses, cmd)) {
        const answer = responses[cmd];
        if (
          typeof answer === "object" &&
          answer !== null &&
          Object.prototype.hasOwnProperty.call(answer, failureKey)
        ) {
          throw (answer as Record<string, string>)[failureKey];
        }
        return bump(cmd, answer);
      }
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
  }, {
    responses,
    recordKey: IPC_RECORD_KEY,
    failureKey: IPC_FAILURE_KEY,
    bridgeName,
    byMode,
    incrementing,
  });
}

/**
 * 화면을 거치지 않고 앱의 IPC 입구로 **한 번 묻고 답을 그대로 들고 나온다.** 거절은 던진다.
 *
 * L3의 답은 손으로 적은 fixture라 「엔진이 정말 그렇게 답하는가」는 L4에서 답째 잰다 — 하네스를 지나 다리로
 * 가므로 「진짜 코어가 이렇게 답한다」가 된다. 화면이 값으로 보이지 않는 답의 모양(예: 트리의 행이 받은 아이콘의
 * 이름 — 글리프에는 이름이 없다)도 여기서 잰다. 앱이 부르지 않는 명령(`get_work`)이 입구를 타는지도 여기서
 * 잰다 — 화면으로는 그 호출을 만들 수 없다.
 */
export async function askBackend(
  page: Page,
  cmd: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return page.evaluate(
    ({ cmd, args }: { cmd: string; args: Record<string, unknown> }) =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__.invoke(cmd, args),
    { cmd, args },
  );
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

/**
 * 지금까지 나간 `pty_spawn`의 **cwd를 부른 순서대로**. 인자에 cwd가 없으면 그 호출을 통째로
 * 남긴다 — `undefined`로 접으면 「안 실렸다」와 「못 읽었다」가 같은 얼굴이 된다.
 *
 * 기록에서 읽는 것은 픽스처의 답이 자리와 무관해서다(그것이 실물 그대로다) — 답으로는 셸이
 * 어디서 떴는지가 안 갈린다.
 */
export async function spawnedCwds(page: Page): Promise<string[]> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  return calls
    .filter((call) => call.startsWith("pty_spawn "))
    .map((call) => /"cwd":"([^"]*)"/.exec(call)?.[1] ?? `(cwd가 없다: ${call})`);
}

/**
 * 지금까지 그 커맨드로 나간 호출의 수. 이름이 **정확히** 같은 것만 센다(`ipcCallArgs`와 같은 거름) —
 * 앞머리로 세면 뒷날 `pty_write_*` 같은 이웃 커맨드가 함께 세어진다.
 */
export async function callCount(page: Page, command: string): Promise<number> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  return calls.filter((call) => call === command || call.startsWith(`${command} `)).length;
}

/**
 * 경로 한 단계 위 — 「모든 프로젝트」(워크트리들의 부모)와 Work 폴더(`specDir`의 부모)의
 * 기대값을 픽스처 경로에서 **파생한다**(폴더 이름을 검사에 안 적는다).
 */
export const parentPath = (path: string): string => path.slice(0, path.lastIndexOf("/"));

/**
 * IPC 기록에서 **무엇인가가 나타나기를** 기다린다. 하네스가 백엔드 흉내를 내려면 브라우저가
 * 난수로 지은 번호(구독 핸들러 id · 채널 id)를 알아야 하는데, 그 번호는 앱이 실제로 그
 * 호출을 내보낸 뒤에야 기록에 남는다.
 *
 * **못 찾으면 던진다.** 이 자리를 fail-open으로 두면(못 찾은 채 그냥 지나가면) 뒤따르는
 * 단언들이 「값이 아무 데도 안 갔다」와 「값이 갔는데 앱이 아무 일도 안 했다」를 구분하지
 * 못한다 — 이 층에서 가장 읽기 어려운 침묵이다. 그래서 5초를 다 쓰고 나서는 기록을 통째로
 * 실어 던지고, **기다리는 수와 그 규율이 이 함수 하나에** 있다(부르는 자리 둘이 각자
 * 적으면 한쪽만 늙는다).
 */
async function awaitIpcMatch(
  page: Page,
  pick: (calls: ReadonlyArray<string>) => string | undefined,
  label: string,
): Promise<string> {
  let found: string | undefined;
  for (let tries = 0; tries < 50 && found === undefined; tries += 1) {
    found = pick((await readIpcRecord(page))?.calls ?? []);
    if (found === undefined) await page.waitForTimeout(100);
  }
  if (found === undefined) {
    const calls = (await readIpcRecord(page))?.calls ?? [];
    throw new Error(`${label}이(가) 5초 안에 안 나타났다 — IPC 기록: ${JSON.stringify(calls)}`);
  }
  return found;
}

/**
 * 백엔드가 쏘는 이벤트 `event`를 **손으로 쏜다** — `times`번을 **한 `evaluate` 안에서 연달아.**
 * 픽스처 백엔드는 커맨드에만 답하지 이벤트를 쏘지 않는다.
 *
 * 구독 id는 IPC 기록에서 읽는다 — **상수로 적을 수 없다**(`transformCallback`이 난수로 짓는다).
 * **`listen`만 고르고 마지막 구독을 쓴다**: 같은 이름이 `unlisten` 줄에도 있는데 그쪽에는 handler가
 * 없고, StrictMode가 붙였다 떼면서 살아 있는 것은 마지막 구독이다. 구독이 아직 안 보이면
 * 기다리고 끝내 없으면 **던진다**(`awaitIpcMatch`) — 아무것도 안 쏜 채 지나가면 「아무 일도 안
 * 일어났다」를 재는 단언이 초록이 된다.
 *
 * **한 번 쏘는 것이 기본이다.** 전이를 싣는 이벤트(`shell:attention`)는 여러 번 쏘면 그 수만큼
 * 발화한다 — 멱등한 값을 앉을 때까지 다시 쏘는 것은 `markRunning`의 일이다.
 */
export async function fireEvent(
  page: Page,
  event: string,
  payload: unknown,
  times = 1,
): Promise<void> {
  const handler = await awaitIpcMatch(
    page,
    (calls) => {
      const listen = calls
        .filter((call) => call.startsWith("plugin:event|listen") && call.includes(`"${event}"`))
        .reverse()[0];
      return (listen && /"handler":(\d+)/.exec(listen)?.[1]) || undefined;
    },
    `${event} 구독`,
  );
  await page.evaluate(
    ({ handler, event, payload, times }: { handler: number; event: string; payload: unknown; times: number }) => {
      const internals = (window as unknown as {
        __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
      }).__TAURI_INTERNALS__;
      for (let n = 0; n < times; n += 1) {
        internals.runCallback(handler, { event, id: 0, payload });
      }
    },
    { handler: Number(handler), event, payload, times },
  );
}

/**
 * **시나리오 도중에** 커맨드 하나의 답을 갈아 끼운다(spec 레이아웃 티켓 15) — 이 뒤로 그 커맨드는 `answer`를 답한다.
 *
 * 고정 답은 설치할 때 한 번 정해진다(`installFixtureBackend`). 그대로는 「밖에서 바뀌었다」를 못 세운다 — 처음부터
 * 다른 답이면 편집기가 그것을 기준본으로 읽는다. 그래서 편집기가 연 뒤에 읽기의 답을 바꾸고 이벤트를 쏜다
 * (`fireEvent`) — 전역 구독이 읽기를 다시 부르면 바뀐 답이 온다.
 *
 * 모양은 셸 생성 가로채기(`interceptPtySpawn`)와 같다: 앱의 `invoke`를 감싸고, 창 전역 값에서 답을 꺼낸다. 처음
 * 부를 때 한 번 감싸고, 그 뒤로는 전역 값만 고친다. **부름은 먼저 원래 자리를 지난다** — 하네스의 기록(`callCount`,
 * `ipcCallArgs`)이 그 부름을 세야 「다시 불렸다」를 기다릴 수 있다. 답만 바꿔 돌려준다.
 *
 * 페이지를 다시 읽으면 감싼 것이 사라진다 — 도중에만 쓴다. **표에 없는 이름은 여기서 터진다**(덮어쓰기와 같은
 * 규칙): 커맨드가 개명되면 갈아 끼우기가 아무 데도 안 걸린 채 지나가, 「바뀌었는데도 조용했다」가 초록이 된다.
 */
export async function swapAnswer(page: Page, command: string, answer: unknown): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(FIXTURE_COMMANDS, command)) {
    throw new Error(`갈아 끼울 커맨드가 고정 답 표에 없습니다: ${command}`);
  }
  await page.evaluate(
    ({ command, answer }: { command: string; answer: unknown }) => {
      const win = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown> };
        __ATELIER_SWAPPED_ANSWERS__?: Record<string, unknown>;
      };
      if (win.__ATELIER_SWAPPED_ANSWERS__ === undefined) {
        const swapped: Record<string, unknown> = {};
        win.__ATELIER_SWAPPED_ANSWERS__ = swapped;
        const internals = win.__TAURI_INTERNALS__;
        const invoke = internals.invoke;
        internals.invoke = async (cmd, args, options) => {
          const original = await invoke(cmd, args, options);
          return Object.prototype.hasOwnProperty.call(swapped, cmd) ? swapped[cmd] : original;
        };
      }
      win.__ATELIER_SWAPPED_ANSWERS__[command] = answer;
    },
    { command, answer },
  );
}

/**
 * 그 work 행의 **레인** — 화면값이 있으면 점·링이, 없으면 work 상태 아이콘이 든다.
 *
 * **여기 사는 이유는 마크업의 모양을 아는 자리를 하나로 두려는 것이다.** 레인은 둘째 줄의
 * **형제**라(`WorkSectionList`의 `WorkRow`) `[data-subrow]`에서 한 칸 올라가 집는데, 그 사정을 spec마다
 * 적어 두면 행의 구조가 바뀌는 날 고칠 자리가 셋이 된다.
 */
export const 레인 = (page: Page, slug: string) =>
  page.locator(`[data-subrow="${slug}"]`).locator("xpath=..").locator("[data-lane]");

/** 사이드바의 그 작업 행(UI개선 티켓 05) — 끄는 자리이자 놓일 기준이다. */
export const workRow = (page: Page, slug: string) => page.locator(`[data-work-row="${slug}"]`);

/** 사이드바에 선 작업 행의 slug, 위에서부터. */
export const shownWorkOrder = (page: Page) =>
  page.locator("[data-work-row]").evaluateAll((els) => els.map((el) => el.getAttribute("data-work-row")));

export type RowPoint = "upper" | "lower" | "middle";

/** 상자 안의 한 점 — 윗 사분의 일 · 아랫 사분의 일 · 가운데. 중심선에 바짝 붙이면 반올림에 흔들린다. */
export async function pointIn(target: Locator, where: RowPoint) {
  const box = await target.boundingBox();
  if (!box) throw new Error("끌 자리의 상자를 못 읽었다");
  const ratio = { upper: 0.25, lower: 0.75, middle: 0.5 }[where];
  return { x: box.x + box.width / 2, y: box.y + box.height * ratio };
}

/**
 * 작업 행을 눌러 **문턱을 넘긴 채** 멈춘다. 문턱을 넘었다는 증거로 끌리는 행이 흐려진 것을 먼저 본다 —
 * 안 보고 지나가면 뒤의 「IPC 없음」들이 「끌기가 시작도 안 됐다」로도 초록이 된다.
 *
 * L3·L4가 함께 딛는다 — 손짓을 spec마다 적으면 문턱이나 흐려짐이 바뀌는 날 고칠 자리가 여럿이 된다.
 */
export async function pickUpRow(page: Page, slug: string) {
  const from = await pointIn(workRow(page, slug), "middle");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 12, { steps: 3 });
  await expect(workRow(page, slug)).toHaveCSS("opacity", "0.4");
}

/** 끄는 중인 포인터를 그 자리로 옮긴다 — 여러 걸음으로, 실물처럼. */
export async function hoverRowPoint(page: Page, target: Locator, where: RowPoint) {
  const to = await pointIn(target, where);
  await page.mouse.move(to.x, to.y, { steps: 6 });
}

/** 작업 행을 끌어 놓는다 — 놓기 전에 틈 선이 섰는지 본다(놓을 곳이 있는 끌기만 부른다). */
export async function dragRowOnto(page: Page, slug: string, target: Locator, where: RowPoint) {
  await pickUpRow(page, slug);
  await hoverRowPoint(page, target, where);
  await expect(page.locator("[data-drop-line]")).toBeVisible();
  await page.mouse.up();
}

/**
 * 「spec 레이아웃」 편집기 트리의 항목을 눌러 **문턱을 넘긴 채** 멈춘다(spec 레이아웃 티켓 13). 문턱을 넘은
 * 증거로 끌리는 행이 흐려진 것을 먼저 본다 — `pickUpRow`와 같은 까닭이다: 안 보고 지나가면 뒤의 「아무것도
 * 안 바뀌었다」가 「끌기가 시작도 안 됐다」로도 초록이 된다.
 *
 * 작업 행 도우미와 따로 두는 것은 행을 찾는 자리가 달라서다 — 편집기의 행에는 slug가 없어 부르는 쪽이 행을
 * 로케이터로 준다. 문턱은 **옆으로** 넘긴다: 12px 옆은 아직 그 행 위라, 아래로 넘기면 들르는 이웃 행이 겨눠진다.
 */
export async function pickUpEntry(page: Page, row: Locator) {
  const from = await pointIn(row, "middle");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y, { steps: 3 });
  await expect(row).toHaveCSS("opacity", "0.4");
}

/**
 * 편집기 항목을 끌어 대상의 그 자리(윗 사분의 일 · 가운데 · 아랫 사분의 일)에 놓는다. 대상은 트리의 행이거나 트리
 * 아래 빈 자리(`[data-entry-end]`)다. 놓기 전에 거기 놓일 표시(`data-entry-drop` — 앞·뒤·빈 자리의 선, 안의
 * 밝아짐)가 섰는지 본다 — 놓을 곳이 있는 끌기만 부른다.
 */
export async function dragEntryOnto(page: Page, row: Locator, target: Locator, where: RowPoint) {
  await pickUpEntry(page, row);
  await hoverRowPoint(page, target, where);
  await expect(target).toHaveAttribute("data-entry-drop", /^(before|after|inside|end)$/);
  await page.mouse.up();
}

type Box = { x: number; y: number; width: number; height: number };

/** 상자의 한가운데. */
export const middle = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * 탭을 눌러 **분할 끌기를 시작시킨다**(`works-split`·`drag-gesture`가 함께 딛는다). 겹판이 설
 * 때까지가 여기까지이고, 어디에 놓을지는 부르는 쪽이 정한다. 돌려주는 것은 누른 자리다.
 *
 * 임계값을 넘기는 이동과 목적지로 가는 이동을 **나눈다.** 겹판이 서는 것은 임계값을 넘은
 * 그 이동에서인데, 그때 포인터 아래에는 아직 겹판이 없어 절반이 「내 위다」를 말하는 것은
 * 다음 이동부터다. 실물에서는 구멍이 아니다 — 임계값은 출발점에서 5px이라 사이드바 위에서
 * 넘고, 본문까지 오는 동안 이동이 수십 번 더 온다.
 *
 * 12px는 문턱(5px)을 넉넉히 넘기면서 누른 탭 밖으로는 안 나가는 거리다. `tab-order`의 누름과
 * `pickUpRow`도 12를 쓰지만 각자 자리의 기하가 정한 수라 여기로 묶지 않는다.
 */
export async function startSplitDrag(page: Page, box: Box) {
  const from = middle(box);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y);
  await expect(page.locator("[data-drop-half]")).toHaveCount(2);
  return from;
}

/** 끄는 중인 포인터를 그 절반 한가운데로 민다. **좌표를 손으로 적지 않는다** — 겹판이 자기 상자를 말한다. */
export async function moveOntoHalf(page: Page, half: "left" | "right") {
  const box = await page.locator(`[data-drop-half="${half}"]`).boundingBox();
  if (!box) throw new Error(`${half} 절반의 상자를 못 읽었다`);
  const at = middle(box);
  await page.mouse.move(at.x, at.y);
  await expect(page.locator(`[data-drop-half="${half}"]`)).toHaveAttribute("data-over", "");
}

/** 「확인할 것」 띠. 부르는 셸이 없으면 **DOM에 아예 없다**(#204 · 스토리 38). */
export const 띠 = (page: Page) => page.locator("[data-band]");

/**
 * 한 칸에서 **명령이 돌게 만든다.** 백엔드가 1초마다 쏘는 `pty:running`을 손으로 한 번
 * 쏘는 것이다(adr-04) — 픽스처 백엔드는 커맨드에만 답하지 이벤트를 쏘지 않는다.
 *
 * 구독 id는 하네스가 적어 둔 IPC 기록에서 읽는다. **상수로 적을 수 없다** — `transformCallback`이
 * 난수로 짓는다. 못 찾으면 던진다: 구독이 안 걸린 채로 지나가면 아래 「로고가 남는다」가
 * **로고가 아예 없어서** 초록이 된다.
 *
 * **어느 셸에 앉힐지 `ptyId`로 고른다.** 픽스처의 `pty_spawn`이 부를 때마다 다른 id를 주므로
 * (`FIXTURE_INCREMENTING_KEYS`) 그 수는 **n번째로 spawn 응답을 받은 셸**을 가리킨다 — 첫 셸이
 * 1이고, 안 주면 그 첫 셸이다. **그 수가 「n번째 칸」과 같으려면 부르는 쪽이 칸마다 응답을
 * 기다려 세워야 한다**(`openShell`) — 픽스처가 세는 것은 칸이 선 순서가 아니라 `pty_spawn`이
 * 불린 순서다. 모르는 id를 주면 `shellOfPty`가 null을 주어 아무 칸에도 안 앉고, 아래 기다림이
 * 5초 뒤에 던진다.
 *
 * **앉을 때까지 다시 쏜다.** 스폰 **응답**이 앉기 전에 쏘면 그 값은 조용히 버려진다 —
 * 그 칸은 이미 화면에 있지만 아직 pty를 모르는 상태라 `shellOfPty`가 null을 주고,
 * `setRunning`이 아무 칸에도 안 닿는다. 병렬 l3에서 두 번에 한 번 그 사이가 벌어졌다.
 * 다시 쏘는 것이 상태를 흔들지 않는다: 「지금 이것이 돈다」는 몇 번 와도 같은 말이고,
 * `setRunning`이 같은 값이면 상태를 그대로 돌려준다.
 *
 * **그 재시도는 멱등한 값에만 안전하다 — 이 모양을 그대로 베끼지 마라.** 여기 실리는 것은
 * 「지금 이 셸에서 이것이 돈다」는 **상태**라 같은 값이 쉰 번 와도 결과가 한 번 온 것과 같다.
 * 이 판이 더할 `shell:attention`(티켓 #202)은 그렇지 않다 — 상태가 **바뀌는 순간**을 싣는 전이라,
 * 알림이 그 엣지에서 한 번 울리게 되어 있다(스펙의 알림 판정). 그것을 쉰 번 쏘면 알림도
 * 쉰 번 울리고, 그러면 「한 번만 울린다」를 재는 검사가 하네스 때문에 빨개진다. 전이를
 * 흉내 내는 손잡이는 **구독이 걸렸는가**를 기다린 뒤 **한 번만** 쏴야 한다(티켓 #202).
 */
export async function markRunning(page: Page, running: string, ptyId = 1): Promise<void> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  const listen = calls.filter((call) => call.includes('"pty:running"')).reverse()[0];
  const handler = listen && /"handler":(\d+)/.exec(listen)?.[1];
  if (!handler) throw new Error(`pty:running 구독을 못 찾았다 — IPC 기록: ${JSON.stringify(calls)}`);
  const fire = () =>
    page.evaluate(
      ({ handler, running, ptyId }: { handler: number; running: string; ptyId: number }) => {
        const internals = (window as unknown as {
          __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
        }).__TAURI_INTERNALS__;
        internals.runCallback(handler, {
          event: "pty:running",
          id: 0,
          payload: [{ id: ptyId, running }],
        });
      },
      { handler: Number(handler), running, ptyId },
    );

  const mark = page.locator(`[role="img"][aria-label*="${running}"]`);
  // **부르기 전 수보다 늘었는가**를 본다 — 「하나라도 있는가」가 아니다. 이 마크는 탭 칸만이
  // 아니라 사이드바 work 행과 nav `Terminal` 행에도 서므로, 같은 에이전트가 화면 어딘가에 이미
  // 있으면 값이 대상 pty에 **안 앉아도** 첫 바퀴에 성공으로 돌아간다. 그러면 위 「모르는 id를
  // 주면 던진다」가 거짓말이 되고, 같은 에이전트를 셸 둘에 앉히는 그림(티켓 #203~#205)에서
  // 정확히 그 fail-open이 난다 — 이 저장소의 검사는 fail-closed여야 한다.
  const before = await mark.count();
  for (let tries = 0; tries < 50; tries += 1) {
    await fire();
    if ((await mark.count()) > before) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`pty ${ptyId}에 \`${running}\`이 도는 칸이 5초 안에 안 생겼다`);
}

/**
 * 셸 `count`개가 **spawn 응답을 받을 때까지** 기다린다.
 *
 * 칸이 화면에 서는 것과 그 칸이 pty를 갖는 것은 **다른 순간**이다 — 사이에 `pty_spawn`
 * 왕복이 있다. 닫는 길(`×`·⌘W)은 그 pty로 「명령이 도는가」를 물어 확인 창을 띄우므로,
 * 응답 전에 닫으면 **묻지 않고 닫는 것이 옳은 동작이다**(결정 92 — 물어볼 프로세스가 없고,
 * `needsCloseConfirm`이 판정 `null`에 `false`를 준다). 그래서 **확인 창을 보는 검사는 이
 * 전제를 먼저 세워야 한다.** 안 세우면 러너가 붐비는 날에만 빨개진다 — 병렬 l3 전체 실행
 * 세 번에 두 번, `tab-keys`의 서로 다른 두 검사가 그렇게 깨졌다(2026-09-09 실측). 응답을
 * 3초 늦추면 100% 재현된다.
 *
 * **재는 자리는 칸의 닫기 버튼 이름이다.** `terminal-store`의 `spawn`이 응답을 받아 `ptyId`와
 * 셸 이름을 **같은 자리 연달아** 앉히므로, 그 이름이 픽스처의 것으로 바뀐 순간이 곧 pty가 앉은
 * 순간이다. 이름이 오기 전 칸은 `셸`이라 「`닫기`로 끝난다」만 보면 둘이 안 갈린다.
 *
 * 워크트리가 있는 work은 이름 앞에 프로젝트가 붙으므로(결정 18) 끝으로 맞춘다.
 *
 * **역할과 이름으로 집지 않는다**(`getByRole`). 탭 줄의 닫기는 칸이 88px 아래로 눌리면 꺼진
 * 칸부터 `display:none`으로 접히는데(결정 20) 접근성 트리는 그것을 아예 안 보므로, 칸이 붐비는
 * 폭에서 부르면 **조용히 적게 세고 곧바로 초록이 된다** — 「응답이 하나만 왔다」로 읽고 지나가는
 * fail-open이다. 속성 선택자는 접혀도 남는 DOM을 세니 이 기다림이 줄의 폭과 무관해진다. 라벨이
 * 겹칠 위험은 없다: `<이름> 닫기`를 다는 곳은 `ShellTabs` 하나뿐이다.
 */
export async function awaitSpawned(page: Page, count: number): Promise<void> {
  // **기본 5초가 아니다.** 이 기다림은 IPC 왕복이 아니라 그 앞의 **진짜 브라우저 일**에
  // 매여 있다 — 칸이 서면 글꼴을 기다리고, 붙어 있으면 xterm이 열리고 WebGL 애드온이 붙고
  // 격자를 맞춘 **뒤에야** spawn이 나간다(`terminal-store`의 `loadFont`). 한가한 러너에서 그 전부가
  // 70~130ms인데(실측), `cargo test --workspace` 직후의 `verify --full`에서 한 번
  // 5초를 넘겼다. 여기서 시간을 아껴 봐야 얻는 것이 없고, 넘치면 **그 자리에서** 터져
  // 원인이 이 줄을 가리킨다 — 예전처럼 「확인 창이 안 떴다」로 엉뚱한 곳을 가리키지 않는다.
  await expect(
    page.locator(`[data-tab="shell"] button[aria-label$="${FIXTURE_SHELL_NAME} 닫기"]`),
  ).toHaveCount(count, { timeout: 20_000 });
}

/**
 * 셸 한 칸을 **열고 그 칸이 spawn 응답을 받을 때까지** 기다린다.
 *
 * **이 기다림은 순서를 만들지 않는다 — 순서는 앱이 지킨다.** 픽스처는 칸이 선 순서가 아니라
 * `pty_spawn`이 **불린 순서**로 id를 주는데, 앱은 칸을 연 순서대로 부른다(글꼴이 오면 붙었든
 * 떼어졌든 띄운다 — `terminal-store`의 `loadFont`). 그래서 `+`를 연달아 눌러도 「둘째 칸 = pty 2」다
 * (`shell-cold-start.spec.ts`가 여덟 칸으로 잰다). 여기서 기다리는 것은 **pty가 앉았다**는 것 하나로,
 * 그 번호로 값을 앉히는 손잡이들(`markRunning`·`markAttention`)과 확인 창을 보는 닫기가 그것을 딛는다.
 *
 * _한때 누르기 전에도 기다렸다_ — 첫 칸이 글꼴을 기다린 뒤 붙어 있을 때만 떠서, 그 전에 새 칸이
 * 켜지면 첫 칸의 spawn이 둘째 칸보다 늦게(또는 영영 안) 나갔다. 그 기다림은 앱의 결함을 덮고 있었다.
 */
export async function openShell(page: Page): Promise<void> {
  const tabs = page.locator('[data-tab="shell"]');
  const before = await tabs.count();
  await page.locator('[data-tab="new"]').click();
  await expect(tabs).toHaveCount(before + 1);
  await awaitSpawned(page, before + 1);
}

/**
 * 셸 하나가 **스스로 말하게 만든다.** 백엔드의 감시가 상태 파일을 읽어 쏘는
 * `shell:attention`을 손으로 한 번 쏘는 것이다(#201·#202) — 픽스처 백엔드는 커맨드에만
 * 답하지 이벤트를 쏘지 않는다.
 *
 * **`markRunning`과 결정적으로 다른 것이 하나 있다: 한 번만 쏜다.** 저쪽은 값이 화면에 앉을
 * 때까지 최대 쉰 번 다시 쏘는데, 그것이 안전한 이유는 실리는 것이 「지금 이것이 돈다」는
 * **상태**라 몇 번 와도 결과가 같기 때문이다. 이쪽에 실리는 것은 상태가 **바뀌는 순간**인
 * 전이라(훅 이벤트 한 장), 쉰 번 쏘면 「봤다」가 쉰 번 풀리고 알림 엣지가 쉰 번 발화한다.
 * 그러면 「진입당 한 번만 울린다」를 재는 검사가 하네스 때문에 빨개진다.
 *
 * **그래서 재시도 조건이 「값이 앉았는가」가 아니라 「구독이 걸렸는가」다.** 못 걸린 채
 * 쏘면 아무 데도 안 닿고, 그 조용함은 「전이가 아무것도 안 바꿨다」와 화면에서 구분되지
 * 않는다 — 그 자리를 fail-open으로 두면 이 값을 읽는 검사 전부가 무엇을 재는지 모르게 된다.
 * 구독이 안 보이면 기다렸다 다시 보고, 끝내 없으면 **던진다.**
 *
 * 셸 ID는 `<앱 인스턴스 접두사>-<pty id>`다(`pty.rs`의 `shell_id`). 프런트가 되뽑는 것은
 * 마지막 `-` 뒤의 번호뿐이라(`ptyIdOf`) 접두사는 아무 문자열이어도 된다. **어느 셸에 앉힐지
 * `ptyId`로 고르는 규칙은 `markRunning`과 같다** — 픽스처가 세는 것은 `pty_spawn`이 불린
 * 순서라, 칸마다 응답을 기다려 세우는 `openShell`을 써야 그 수가 「n번째 칸」과 같아진다.
 *
 * **구독 말고 하나를 더 기다린다: 그 pty가 앉았는가.** 값이 칸에 닿으려면 `shellOfPty(ptyId)`가
 * 그 번호를 알아야 하는데, 칸이 화면에 서는 순간과 그 칸이 pty를 갖는 순간은 다른 순간이라
 * (`awaitSpawned`의 독 — 2026-09-09 실측으로 병렬 l3 세 번에 두 번 그 사이가 벌어졌다) 그 앞에
 * 쏘면 값이 **조용히 버려진다.** 저쪽 `markRunning`은 멱등해서 다시 쏘아 메우지만 이쪽은
 * 일부러 한 번만 쏘므로 재시도가 그 창을 못 메운다 — 기다리는 것 말고 길이 없다. 그 규율을
 * 부르는 쪽에 넘겨 뒀더니 유일한 호출자가 안 지켰다. 여기서 기다리면 「전이를 여러 번 쏘지
 * 않는다」와도 안 부딪힌다: `awaitSpawned`는 아무것도 쏘지 않고 착석만 본다. `ptyId`가 곧
 * 「n번째로 spawn 응답을 받은 셸」이라 기다릴 수도 그 수 그대로다.
 *
 * `state`에 `null`을 주면 「그 셸의 상태가 사라졌다」(파일이 지워졌다)를 흉내 낸다.
 *
 * **탭 줄이 없는 화면에서는 이 함수를 못 쓴다** — 착석을 칸의 닫기 버튼으로 재므로(`awaitSpawned`)
 * 설정처럼 탭 줄이 없는 화면에서는 기다림이 던진다. 그때는 착석을 탭 줄이 있는 화면에서 먼저
 * 기다려 두고 옮긴 뒤 `fireAttention`으로 쏜다.
 */
export async function markAttention(
  page: Page,
  state: AttentionState | null,
  ptyId = 1,
): Promise<void> {
  await awaitSpawned(page, ptyId);
  await fireAttention(page, state, ptyId);
}

type AttentionState = { agent: string; event: string; at?: number; payload?: unknown };

/**
 * `markAttention`에서 **착석 기다림을 뺀 쏘기**(#226). 착석은 부르는 쪽이 이미 확인했어야 한다 —
 * 안 앉은 pty에 쏘면 값이 조용히 버려진다(`markAttention` 머리말). 구독이 걸렸는지는 여전히
 * 기다리고, 끝내 없으면 던진다(`fireEvent`).
 */
export async function fireAttention(
  page: Page,
  state: AttentionState | null,
  ptyId = 1,
): Promise<void> {
  await fireEvent(page, "shell:attention", [
    {
      shellId: `l3-${ptyId}`,
      state:
        state === null
          ? null
          : { agent: state.agent, event: state.event, at: state.at ?? 1000, payload: state.payload ?? null },
    },
  ]);
}

/**
 * 창 포커스를 **손으로 잡는다**(#205 · 결정 7). 헤드리스 WebKit에서는 진짜로 포커스를 뺏을
 * 길이 없다 — 실측(2026-09-10): 한 컨텍스트에 페이지 둘을 띄우고 `bringToFront`로 번갈아
 * 앞세워도 양쪽 다 `document.hasFocus()`가 참이다. 그래서 **브라우저가 답하는 그 한 줄만**
 * 갈아 끼우고, 앱이 그것을 실제로 딛는지를 잰다: 여기서 거짓을 돌려주는데도 「봤다」가 서면
 * 앱은 포커스를 안 보고 있는 것이다(그 fail-open은 초록이 안 뜨는 것으로만 나타나 화면에서
 * 안 보인다 — `terminal-store.ts`의 `windowFocused` 머리말).
 *
 * **값과 이벤트를 갈라 둔다.** `hasFocus`가 바뀌는 것과 `focus`/`blur`가 도착하는 것은 다른
 * 사실이고, 한 손잡이에 묶으면 「리스너가 일한다」와 「판정이 값을 읽는다」 중 무엇이 초록을
 * 만들었는지 갈리지 않는다.
 *
 * **페이지가 뜨기 전에 깔아야 한다** — `installFixtureBackend`와 같은 자리다.
 */
export async function stubWindowFocus(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let focused = true;
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => focused });
    Object.defineProperty(window, "__setWindowFocused", {
      configurable: true,
      value: (next: boolean) => {
        focused = next;
      },
    });
  });
}

/**
 * 위 손잡이가 답할 값을 바꾼다 — **이벤트는 안 쏜다.** 안 깔았으면 여기서 던진다(없는 것을
 * 조용히 지나가면 아래 단언이 「원래 그렇던 것」으로 초록이 된다).
 */
export async function setWindowFocused(page: Page, focused: boolean): Promise<void> {
  await page.evaluate((next: boolean) => {
    const set = (window as unknown as { __setWindowFocused?: (one: boolean) => void })
      .__setWindowFocused;
    if (!set) throw new Error("stubWindowFocus를 먼저 깔아야 한다");
    set(next);
  }, focused);
}

/** 창 이벤트 하나를 쏜다. `hasFocus`가 답할 값은 **안 건드린다**. */
export async function fireWindowEvent(page: Page, name: "focus" | "blur"): Promise<void> {
  await page.evaluate((one: string) => window.dispatchEvent(new Event(one)), name);
}

/**
 * 알림 채널을 **손으로 잡는다**(#206). 실물에서는 Rust 플러그인이 웹뷰에 `window.Notification`
 * 폴리필을 깔아 그 생성자가 곧 IPC가 되는데(`tauri-plugin-notification`의 init 스크립트),
 * L3는 앱 번들만 도는 맨 브라우저라 그 폴리필이 없다 — 그러면 헤드리스 WebKit의 진짜
 * `Notification`이 그것을 받아 **권한이 없다는 이유로 아무 소리도 안 내고 오류도 안 낸다.**
 * 그 조용함은 「안 울렸다」와 화면에서 구분되지 않아, 이 층의 알림 검사가 전부 fail-open이 된다.
 *
 * 그래서 그 생성자 하나만 갈아 끼우고 **앱이 실제로 그것을 부르는지**를 잰다. 권한을
 * `granted`로 세워 두는 것은 플러그인의 `isPermissionGranted`가 그 값을 먼저 보기 때문이다 —
 * `default`로 두면 앱이 IPC로 권한을 물으러 가고, 그 커맨드는 여기 표에 없다.
 *
 * **페이지가 뜨기 전에 깔아야 한다** — `installFixtureBackend`와 같은 자리다.
 */
export async function stubNotifications(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sent: Array<{ title: string; body?: string; sound?: string }> = [];
    (window as unknown as { __atelierNotifications: typeof sent }).__atelierNotifications = sent;
    const stub = function (title: string, options?: { body?: string; sound?: string }) {
      sent.push({ title, body: options?.body, sound: options?.sound });
    } as unknown as typeof window.Notification;
    Object.defineProperty(stub, "permission", { configurable: true, get: () => "granted" });
    Object.defineProperty(window, "Notification", { configurable: true, value: stub });
  });
}

/** 위 손잡이가 받아 적은 알림들. 안 깔았으면 던진다 — 없는 것을 「안 울렸다」로 읽지 않는다. */
export async function sentNotifications(
  page: Page,
): Promise<Array<{ title: string; body?: string; sound?: string }>> {
  return page.evaluate(() => {
    const sent = (window as unknown as {
      __atelierNotifications?: Array<{ title: string; body?: string; sound?: string }>;
    }).__atelierNotifications;
    if (!sent) throw new Error("stubNotifications를 먼저 깔아야 한다");
    return sent;
  });
}

/**
 * 독 배지로 나간 값들, 나간 순서대로. `undefined`는 「배지를 없앤다」이고 와이어에서는 키가
 * 통째로 빠지므로(`JSON.stringify`) 여기서는 `null`로 온다.
 */
export async function badgeCalls(page: Page): Promise<Array<number | null>> {
  // **먼저 호출의 모양을 세운다.** 이 커맨드의 인자에는 어느 창인지가 늘 실리므로
  // (`label`) 그것이 안 보이면 읽고 있는 것이 이 호출이 아니거나 기록 형식이 바뀐
  // 것이다 — 거기서 조용히 `null`을 내면 **모든 호출이 「배지를 없앴다」로 읽혀**
  // 「배지가 사라졌다」를 재는 단언이 통째로 fail-open이 된다(`ipcCallArgs`가 던진다).
  return (await ipcCallArgs(page, BADGE_COMMAND, "label")).map(({ call, args }) => {
    // **여기서만 `null`이 나온다.** `undefined`가 「배지를 없앤다」인데(`setBadgeCount`의
    // 계약) 와이어에서는 키가 통째로 빠진다(`JSON.stringify`) — 그 없음이 곧 뜻이다.
    if (!("value" in args)) return null;
    const value = args.value;
    if (typeof value !== "number") throw new Error(`배지 값이 수가 아니다 — ${call}`);
    return value;
  });
}

/**
 * 그 커맨드로 나간 호출들의 인자, 나간 순서대로. **늘 실리는 키 하나**(`requiredKey`)가 안 보이면
 * 던진다 — 읽고 있는 것이 그 호출이 아니거나 기록 형식이 바뀐 것이고, 거기서 조용히 넘기면 그
 * 인자를 재는 단언이 통째로 fail-open이 된다. 위 구독 손잡이 둘이 정규식이 안 맞을 때 IPC
 * 기록을 실어 던지는 것과 같은 이유다.
 */
export async function ipcCallArgs(
  page: Page,
  command: string,
  requiredKey: string,
): Promise<Array<{ call: string; args: Record<string, unknown> }>> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  return calls
    .filter((call) => call === command || call.startsWith(`${command} `))
    .map((call) => {
      const args: unknown = JSON.parse(call.slice(command.length).trim() || "null");
      if (typeof args !== "object" || args === null || !(requiredKey in args)) {
        throw new Error(`${command} 호출의 모양이 낯설다 — ${call}`);
      }
      return { call, args: args as Record<string, unknown> };
    });
}

/** 배지가 나가는 IPC 커맨드 이름. 위 손잡이가 호출을 고르고 인자를 잘라 내는 기준이다. */
const BADGE_COMMAND = "plugin:window|set_badge_count";

/**
 * 그 셸의 PTY에서 **바이트가 흘러나오게 만든다.** 백엔드가 채널로 흘려보내는 출력 프레임
 * 한 장을 손으로 밀어 넣는 것이다 — 픽스처 백엔드는 커맨드에만 답하지 프레임을 안 보낸다.
 *
 * **이것이 이 판에서 유일하게 「진짜 xterm」을 지나는 길이다**(#208). OSC 9·777과 벨은
 * xterm의 파서가 만드는 것이라, 프런트에서 흉내 낸 이벤트로는 「핸들러가 실제로 붙었나」를
 * 한 글자도 못 잰다. 여기 넣은 바이트는 진짜 파서를 지나 진짜 핸들러를 때린다.
 *
 * **채널 id는 IPC 기록에서 읽는다.** Tauri의 `Channel`은 직렬화될 때 자기를 
 * `__CHANNEL__:<id>`로 적고(`@tauri-apps/api`의 `SERIALIZE_TO_IPC_FN`), 하네스가 `pty_spawn`의
 * 인자를 통째로 적어 두므로 거기 그 문자열이 남는다. **상수로 적을 수 없다** —
 * `transformCallback`이 난수로 짓는다. 못 찾으면 **던진다**: 못 찾은 채 지나가면 아래
 * 단언들이 「바이트가 아무 데도 안 갔다」를 「핸들러가 아무 일도 안 했다」와 구분 못 한다.
 *
 * **어느 셸에 넣을지 `ptyId`로 고르는 규칙은 `markRunning`·`markAttention`과 같다** —
 * 픽스처가 세는 것은 `pty_spawn`이 **불린 순서**라, 칸마다 응답을 기다려 세우는 `openShell`을
 * 써야 그 수가 「n번째 칸」과 같아진다.
 *
 * **기다리는 것이 `awaitSpawned`가 아니라 그 채널이 기록에 나타나는 것**이다. 저쪽은 셸이
 * 정확히 n개일 때까지 기다리는 것이라 칸이 더 열린 화면에서는 영영 안 끝나고, 무엇보다 이
 * 길에는 **응답이 필요 없다** — xterm도 핸들러도 `pty_spawn`을 **부르기 전에** 이미 서 있고
 * (`createInstance`), 채널의 `onmessage`도 그때 걸린다. 기다릴 것은 「그 부름이 나갔는가」뿐이다.
 *
 * **순번(`index`)을 채널마다 세는 것**은 `Channel`이 순서를 지키려고 그 수를 보기 때문이다:
 * 기대하는 번호가 아니면 프레임을 **큐에 넣고 조용히 기다린다.** 늘 0으로 보내면 두 번째
 * 프레임부터 영영 안 도착하고, 그 조용함은 「핸들러가 아무 일도 안 했다」와 화면에서 구분되지
 * 않는다 — 그래서 페이지 안에 채널별 카운터를 둔다.
 */
export async function writeShell(page: Page, bytes: string, ptyId = 1): Promise<void> {
  await sendFrame(page, ptyId, { bytes });
}

/**
 * 셸 하나가 **스스로 끝난 것처럼** 종료 프레임을 쏜다. 코드 0이면 그 칸이 줄에서 스스로 빠진다
 * (결정 48 — `markExited`). 채널과 순번 규칙은 `writeShell`과 같아서 같은 자리에서 쏜다 — 순번을
 * 따로 세면 뒤에 오는 출력 프레임이 영영 큐에 갇힌다.
 */
export async function exitShell(page: Page, ptyId = 1, exitCode = 0): Promise<void> {
  await sendFrame(page, ptyId, { exit: { exitCode, signal: null } });
}

async function sendFrame(
  page: Page,
  ptyId: number,
  frame: { bytes: string } | { exit: { exitCode: number; signal: string | null } },
): Promise<void> {
  const channel = await awaitIpcMatch(
    page,
    (calls) => {
      const spawn = calls.filter((call) => call.startsWith("pty_spawn "))[ptyId - 1];
      return (spawn && /__CHANNEL__:(\d+)/.exec(spawn)?.[1]) || undefined;
    },
    `pty ${ptyId}의 출력 채널`,
  );

  await page.evaluate(
    ({ channel, frame }) => {
      const win = window as unknown as {
        __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
        __ATELIER_FRAME_INDEX__?: Record<number, number>;
      };
      const seen = (win.__ATELIER_FRAME_INDEX__ ??= {});
      const index = seen[channel] ?? 0;
      seen[channel] = index + 1;
      // 백엔드가 보내는 것과 **같은 모양**이어야 한다 — 출력 프레임은 ArrayBuffer이고
      // 종료 프레임만 객체다(`terminal-store`의 `spawn`이 `instanceof`로 가른다).
      win.__TAURI_INTERNALS__.runCallback(channel, {
        index,
        message: "bytes" in frame ? new TextEncoder().encode(frame.bytes).buffer : frame.exit,
      });
    },
    { channel: Number(channel), frame },
  );
}

/**
 * 터미널 글꼴 응답을 **붙잡는다** — 돌려받은 함수를 부르면 놓는다. 셸은 글꼴이 온 뒤에야 열리고
 * 뜨므로(`terminal-store`의 `loadFont`) 이 틈이 「글꼴이 오는 사이에 사람이 한 일」의 자리다.
 *
 * **붙잡지 않으면 그 틈이 러너 속도에 매인다.** 글꼴은 저장소에 든 0.94MB 파일이라 한가한
 * 러너에서는 먼저 와서 초록이고, 붐비는 러너에서만 틈이 벌어진다 — 918fbc5가 검사들에 기다림을
 * 넣어 덮은 것이 바로 그 모양이었다.
 *
 * **`page.goto`는 `waitUntil: "domcontentloaded"`로 불러야 한다.** `load`는 붙잡아 둔 글꼴을
 * 기다려 거기서 멈춘다. 페이지가 뜨기 전에 깔아야 한다(`installFixtureBackend`와 같은 자리).
 */
export async function holdTerminalFonts(page: Page): Promise<() => Promise<void>> {
  let open!: () => void;
  const held = new Promise<void>((resolve) => (open = resolve));
  let caught = 0;
  await page.route("**/JetBrainsMonoNLNerdFont-*.woff2*", async (route) => {
    caught += 1;
    await held;
    await route.continue();
  });
  // **놓기 전에 붙잡았는지부터 본다 — fail-closed다.** 글꼴 파일의 이름·경로·싣는 길이 바뀌어
  // 이 route가 아무것도 못 잡으면 글꼴이 먼저 와서 틈이 안 서고, 이 도우미를 딛는 검사가 전부
  // 러너 속도에 매인 초록으로 돌아간다. 붙잡기가 이 도우미의 계약이라 여기서 터뜨린다.
  return async () => {
    await expect
      .poll(() => caught, { message: "터미널 글꼴 요청을 하나도 못 붙잡았다 — route 패턴이 낡았다" })
      .toBeGreaterThan(0);
    open();
  };
}

/**
 * `pty_spawn`의 **응답을 붙잡는다** — 「셸을 띄우러 나갔는데 아직 안 돌아왔다」의 틈을 결정적으로
 * 세운다. 붙잡힌 부름의 수는 `heldSpawns`로 읽고, `releaseSpawns`로 한꺼번에 놓는다.
 *
 * **기록은 놓은 뒤에 남는다** — 하네스의 기록(`readIpcRecord`)은 답하는 자리에서 적으므로, 붙잡힌
 * 동안의 부름은 거기 없다. 그래서 수를 따로 센다: 기록으로 기다리면 「아직 안 나갔다」와
 * 「나갔는데 붙잡혔다」가 같은 얼굴이다. 놓는 순서는 부른 순서 그대로라 픽스처의 번호도 그대로다.
 *
 * `installFixtureBackend` **뒤에** 깔아야 한다 — 그쪽이 세운 `invoke`를 감싼다.
 */
export async function holdPtySpawn(page: Page): Promise<void> {
  await interceptPtySpawn(page, { hold: true });
}

/**
 * **첫 `pty_spawn` 하나를 그 이유로 거절한다** — 나머지는 그대로 답한다(결정 23의 「못 띄운 이유」).
 * `installFixtureBackend` **뒤에** 깔아야 한다(`holdPtySpawn`과 같다).
 */
export async function refuseFirstSpawn(page: Page, reason: string): Promise<void> {
  await interceptPtySpawn(page, { refuseFirst: reason });
}

/**
 * `pty_spawn`을 가로채는 초기화 스크립트 **한 벌.** 붙잡기·거절이 `invoke`를 감싸는 모양을 나눠
 * 쓴다 — 픽스처의 `invoke` 모양이 바뀌면 여기 하나만 고친다. 초기화 스크립트는 직렬화되어
 * 페이지로 가므로 동작을 함수가 아니라 값으로 받는다.
 */
async function interceptPtySpawn(page: Page, behaviour: { hold?: boolean; refuseFirst?: string }): Promise<void> {
  await page.addInitScript(({ hold, refuseFirst }: { hold?: boolean; refuseFirst?: string }) => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown> };
    }).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const gate = { count: 0, release };
    if (hold) (window as unknown as { __ATELIER_SPAWN_GATE__: typeof gate }).__ATELIER_SPAWN_GATE__ = gate;
    let refused = false;
    internals.invoke = async (cmd, args, options) => {
      if (cmd !== "pty_spawn") return invoke(cmd, args, options);
      if (refuseFirst !== undefined && !refused) {
        refused = true;
        // 문자열 그대로 거절한다 — 진짜 백엔드가 그렇다(위 `ipcFailure` 머리말). `Error`로 감싸면 앱이
        // 적는 이유에 「Error: 」가 붙어 실제와 다른 글을 잰다.
        throw refuseFirst;
      }
      if (hold) {
        gate.count += 1;
        await held;
      }
      return invoke(cmd, args, options);
    };
  }, behaviour);
}

/** 붙잡힌 `pty_spawn` 부름의 수(`holdPtySpawn`). 안 깔았으면 던진다. */
export async function heldSpawns(page: Page): Promise<number> {
  return page.evaluate(() => {
    const gate = (window as unknown as { __ATELIER_SPAWN_GATE__?: { count: number } }).__ATELIER_SPAWN_GATE__;
    if (!gate) throw new Error("holdPtySpawn을 먼저 깔아야 한다");
    return gate.count;
  });
}

/** 붙잡은 `pty_spawn` 응답을 한꺼번에 놓는다(`holdPtySpawn`). */
export async function releaseSpawns(page: Page): Promise<void> {
  await page.evaluate(() => {
    const gate = (window as unknown as { __ATELIER_SPAWN_GATE__?: { release: () => void } }).__ATELIER_SPAWN_GATE__;
    if (!gate) throw new Error("holdPtySpawn을 먼저 깔아야 한다");
    gate.release();
  });
}

/**
 * pty마다 **지금 백엔드가 아는 격자** — spawn에 실린 값에서 시작해 그 뒤 `pty_resize`로 덮는다.
 * 키는 픽스처의 pty 번호다: `pty_spawn`이 **불린 순서**로 1부터 준다(`FIXTURE_INCREMENTING_KEYS`).
 *
 * 화면에서 세지 않는 것은 셀이 캔버스에 그려져 DOM에 없어서다(`terminal-fill.spec.ts`와 같은 사정).
 * 값의 모양이 낯설면 던진다(`ipcCallArgs`) — 조용히 넘기면 격자를 재는 단언이 fail-open이 된다.
 */
export async function ptyGrids(page: Page): Promise<Map<number, { cols: number; rows: number }>> {
  const grids = new Map<number, { cols: number; rows: number }>();
  const calls = (await readIpcRecord(page))?.calls ?? [];
  let spawned = 0;
  for (const call of calls) {
    const isSpawn = call.startsWith("pty_spawn ");
    if (!isSpawn && !call.startsWith("pty_resize ")) continue;
    const args = JSON.parse(call.slice(call.indexOf(" ") + 1)) as Record<string, unknown>;
    const { cols, rows } = args;
    if (typeof cols !== "number" || typeof rows !== "number") {
      throw new Error(`격자가 수가 아니다 — ${call}`);
    }
    if (isSpawn) {
      spawned += 1;
      grids.set(spawned, { cols, rows });
    } else {
      if (typeof args.id !== "number") throw new Error(`resize에 id가 없다 — ${call}`);
      grids.set(args.id, { cols, rows });
    }
  }
  return grids;
}
