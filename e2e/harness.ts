import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BRIDGE_FN, callBridge } from "./bridge";
import type { Page } from "./evidence";
import type { Sandbox } from "./l4";
import { IPC_RECORD_KEY, type IpcRecord } from "./ipc-record";
import { FIXTURE_BY_MODE, FIXTURE_COMMANDS, type ModeAnswer } from "./fixtures";

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

/** addInitScript는 인자를 하나만 넘긴다 — 응답표와 전역 이름들을 같이 싣는다. */
interface InitArgs {
  responses: Record<string, unknown>;
  recordKey: string;
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
}

/**
 * L3: 우리 커맨드에 고정 데이터가 답한다. 빠르고 결정론적이라 자가수리 루프가 수십 번
 * 돌아도 안 깨진다.
 */
export async function installFixtureBackend(page: Page): Promise<void> {
  await install(page, {
    responses: { ...FIXTURE_COMMANDS, ...PLUGINS },
    bridgeName: null,
    byMode: FIXTURE_BY_MODE,
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
  });
}

/** 앱 번들이 실행되기 전에 시임을 세운다. 프로덕션 코드는 한 줄도 고치지 않는다. */
async function install(
  page: Page,
  { responses, bridgeName, byMode }: Omit<InitArgs, "recordKey">,
): Promise<void> {
  // mocks.cjs 텍스트에는 백틱과 `${`가 들어 있다. 템플릿 리터럴에 끼워 넣으면 깨지므로
  // 이 조각만 순수 문자열로 주입하고, 손으로 쓰는 로직은 아래 타입 검사되는 함수에 둔다.
  await page.addInitScript({
    content:
      "(() => { const exports = {};\n" +
      MOCKS_SOURCE +
      "\nwindow.__TAURI_MOCKS__ = exports; })();",
  });

  await page.addInitScript(({ responses, recordKey, bridgeName, byMode }: InitArgs) => {
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
              return answer.answers[key];
            }
          }
          if (Object.prototype.hasOwnProperty.call(answer, "value")) return answer.value;
        }
        // 인자를 함께 적는다 — 「`mode`가 없었나」와 「그 모드에 그 경로가 없었나」가
        // 실패 문구에서 갈려야 다음 수정이 정해진다.
        record.unknown.push(`${cmd}${detail}`);
        throw new Error(`하네스가 모드로 답하지 못하는 IPC 호출입니다: ${cmd}${detail}`);
      }
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
  }, { responses, recordKey: IPC_RECORD_KEY, bridgeName, byMode });
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
 * 한 칸에서 **명령이 돌게 만든다.** 백엔드가 1초마다 쏘는 `pty:running`을 손으로 한 번
 * 쏘는 것이다(adr-04) — 픽스처 백엔드는 커맨드에만 답하지 이벤트를 쏘지 않는다.
 *
 * 구독 id는 하네스가 적어 둔 IPC 기록에서 읽는다. **상수로 적을 수 없다** — `transformCallback`이
 * 난수로 짓는다. 못 찾으면 던진다: 구독이 안 걸린 채로 지나가면 아래 「로고가 남는다」가
 * **로고가 아예 없어서** 초록이 된다.
 *
 * 픽스처의 `pty_spawn`이 늘 같은 pty id(1)를 주므로 값이 앉는 칸은 **맨 앞 칸 하나**다
 * (`shellOfPty`가 먼저 찾은 인스턴스를 준다).
 *
 * **앉을 때까지 다시 쏜다.** 스폰 **응답**이 앉기 전에 쏘면 그 값은 조용히 버려진다 —
 * 그 칸은 이미 화면에 있지만 아직 pty를 모르는 상태라 `shellOfPty`가 null을 주고,
 * `setRunning`이 아무 칸에도 안 닿는다. 병렬 l3에서 두 번에 한 번 그 사이가 벌어졌다.
 * 다시 쏘는 것이 상태를 흔들지 않는다: 「지금 이것이 돈다」는 몇 번 와도 같은 말이고,
 * `setRunning`이 같은 값이면 상태를 그대로 돌려준다.
 */
export async function markRunning(page: Page, running: string): Promise<void> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  const listen = calls.filter((call) => call.includes('"pty:running"')).reverse()[0];
  const handler = listen && /"handler":(\d+)/.exec(listen)?.[1];
  if (!handler) throw new Error(`pty:running 구독을 못 찾았다 — IPC 기록: ${JSON.stringify(calls)}`);
  const fire = () =>
    page.evaluate(
      ([id, name]) => {
        const internals = (window as unknown as {
          __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
        }).__TAURI_INTERNALS__;
        internals.runCallback(Number(id), {
          event: "pty:running",
          id: 0,
          payload: [{ id: 1, running: name }],
        });
      },
      [handler, running],
    );

  const mark = page.locator(`[role="img"][aria-label*="${running}"]`);
  for (let tries = 0; tries < 50; tries += 1) {
    await fire();
    if ((await mark.count()) > 0) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`\`${running}\`이 도는 칸이 5초 안에 안 생겼다`);
}
