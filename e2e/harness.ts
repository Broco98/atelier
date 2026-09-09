import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { BRIDGE_FN, callBridge } from "./bridge";
import { expect } from "./evidence";
import type { Page } from "./evidence";
import type { Sandbox } from "./l4";
import { IPC_RECORD_KEY, type IpcRecord } from "./ipc-record";
import {
  FIXTURE_BY_ARG,
  FIXTURE_COMMANDS,
  FIXTURE_INCREMENTING_KEYS,
  FIXTURE_SHELL_NAME,
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
   * **인자를 한 겹 더 보는** 커맨드들의 답: 커맨드 이름 → 가르는 인자 이름 + 그 값별 답.
   * `responses`는 커맨드 이름으로만 갈리는데 한 시나리오가 문서 셋을 열어야 하고
   * (`read_spec_file`·`read_archived_file`), 아카이브 둘이 서로 다른 문서 목록을 가져야
   * 한다(`list_archived_docs`). 여기서 못 찾은 값은 그대로 `responses`가 답한다 —
   * L4는 진짜 백엔드가 답하므로 비어 있다.
   */
  byArg: Record<string, { arg: string; answers: Record<string, unknown> }>;
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
export async function installFixtureBackend(page: Page): Promise<void> {
  await install(page, {
    responses: { ...FIXTURE_COMMANDS, ...PLUGINS },
    bridgeName: null,
    byArg: FIXTURE_BY_ARG,
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
    byArg: {},
    incrementing: {},
  });
}

/** 앱 번들이 실행되기 전에 시임을 세운다. 프로덕션 코드는 한 줄도 고치지 않는다. */
async function install(
  page: Page,
  { responses, bridgeName, byArg, incrementing }: Omit<InitArgs, "recordKey">,
): Promise<void> {
  // mocks.cjs 텍스트에는 백틱과 `${`가 들어 있다. 템플릿 리터럴에 끼워 넣으면 깨지므로
  // 이 조각만 순수 문자열로 주입하고, 손으로 쓰는 로직은 아래 타입 검사되는 함수에 둔다.
  await page.addInitScript({
    content:
      "(() => { const exports = {};\n" +
      MOCKS_SOURCE +
      "\nwindow.__TAURI_MOCKS__ = exports; })();",
  });

  await page.addInitScript(({ responses, recordKey, bridgeName, byArg, incrementing }: InitArgs) => {
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
      // 문서 읽기·아카이브 문서 목록은 인자를 한 겹 더 본다 — 표에 있는 값이면 그 답을
      // 주고, 없으면 아래 커맨드 표가 그대로 답한다(앞 시나리오들이 그대로 돈다).
      // 아래 표에도 없으면 화이트리스트 밖이다 — 아카이브의 「그림은 안 읽는다」가 그 신호로
      // 잡힌다(fixtures의 `ARCHIVED_FILE_BODIES` 머리말).
      const keyed = Object.prototype.hasOwnProperty.call(byArg, cmd) ? byArg[cmd] : null;
      if (keyed) {
        const key = (args as Record<string, unknown> | undefined)?.[keyed.arg];
        if (typeof key === "string" && Object.prototype.hasOwnProperty.call(keyed.answers, key)) {
          return keyed.answers[key];
        }
      }
      if (Object.prototype.hasOwnProperty.call(responses, cmd)) {
        const answer = responses[cmd];
        if (!Object.prototype.hasOwnProperty.call(incrementing, cmd)) return answer;
        // 수를 올리는 커맨드다 — 표에 적힌 값을 **첫 값**으로 삼아 부를 때마다 하나씩 올린다.
        const key = incrementing[cmd];
        const base = (answer as Record<string, unknown>)[key];
        // **여기서 조용히 넘어가지 않는다.** 키가 틀렸거나 답의 모양이 바뀌면 `base + n`이
        // `undefined`나 문자열 이어붙이기가 되어 시나리오는 돌고 값만 이상해진다 — 그러면
        // 「셸마다 다른 id」를 재는 검사가 무엇을 재고 있는지 아무도 모른다.
        if (typeof base !== "number") {
          throw new Error(`수를 올릴 값이 수가 아닙니다: ${cmd}.${key}`);
        }
        const n = seen.get(cmd) ?? 0;
        seen.set(cmd, n + 1);
        return { ...(answer as Record<string, unknown>), [key]: base + n };
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
  }, { responses, recordKey: IPC_RECORD_KEY, bridgeName, byArg, incrementing });
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
  // 매여 있다 — 칸이 서면 xterm이 열리고 WebGL 애드온이 붙고 격자를 맞춘 **뒤에야**
  // spawn이 나간다(`terminal-store`의 `openOrReattach`). 한가한 러너에서 그 전부가
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
 * **칸을 세우는 길이 여기 하나여야 하는 이유는 `markRunning`의 `ptyId`다.** 픽스처는 칸이
 * 선 순서가 아니라 `pty_spawn`이 **불린 순서**로 id를 준다 — 둘이 같으려면 왕복이 겹치면
 * 안 되고, 겹치지 않게 하는 것이 이 함수의 기다림이다. `+`를 연달아 눌러 칸부터 세우면
 * 「둘째 칸 = pty 2」가 실행마다 갈리고, 그러면 엉뚱한 칸을 재고도 초록이 될 수 있다.
 */
export async function openShell(page: Page): Promise<void> {
  const tabs = page.locator('[data-tab="shell"]');
  const before = await tabs.count();
  // **이미 선 칸들이 먼저 앉은 뒤에 누른다.** 이 줄이 없으면 첫 칸의 `pty_spawn`이 둘째 칸의
  // 것보다 늦게 나갈 수 있고, 그러면 「첫 칸 = pty 1」부터 어긋난다.
  await awaitSpawned(page, before);
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
 * `state`에 `null`을 주면 「그 셸의 상태가 사라졌다」(파일이 지워졌다)를 흉내 낸다.
 */
export async function markAttention(
  page: Page,
  state: { agent: string; event: string; at?: number; payload?: unknown } | null,
  ptyId = 1,
): Promise<void> {
  let handler: string | undefined;
  for (let tries = 0; tries < 50 && !handler; tries += 1) {
    const calls = (await readIpcRecord(page))?.calls ?? [];
    const listen = calls.filter((call) => call.includes('"shell:attention"')).reverse()[0];
    handler = (listen && /"handler":(\d+)/.exec(listen)?.[1]) || undefined;
    if (!handler) await page.waitForTimeout(100);
  }
  if (!handler) {
    const calls = (await readIpcRecord(page))?.calls ?? [];
    throw new Error(`shell:attention 구독이 5초 안에 안 걸렸다 — IPC 기록: ${JSON.stringify(calls)}`);
  }

  await page.evaluate(
    ({ handler, payload }: { handler: number; payload: unknown }) => {
      const internals = (window as unknown as {
        __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
      }).__TAURI_INTERNALS__;
      internals.runCallback(handler, { event: "shell:attention", id: 0, payload });
    },
    {
      handler: Number(handler),
      payload: [
        {
          shellId: `l3-${ptyId}`,
          state:
            state === null
              ? null
              : { agent: state.agent, event: state.event, at: state.at ?? 1000, payload: state.payload ?? null },
        },
      ],
    },
  );
}
