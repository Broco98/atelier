import { expect, test, type Page } from "./evidence";
import { answerByArg, FIXTURE_COMMANDS, PROJECTS, QUIET_SHELL, WORKS } from "./fixtures";
import {
  askBackendSettled,
  callCount,
  callsSinceRelease,
  fireEvent,
  fireEventToAll,
  heldCalls,
  holdCommand,
  installFixtureBackend,
  liveSubscriptions,
  readIpcRecord,
  releaseCommand,
  replaceAnswer,
  steadyCount,
  unknownIpcCalls,
  workRow,
} from "./harness";

// **하네스의 도구 넷이 스스로를 잰다**(프로세스 관리 티켓 01). 이 도구들은 뒤 장의 L3가 딛는다 —
// 12의 MCP 아카이브 흉내(인자별 답 · 답 바꾸기), 14의 구독 · 호출 수(모든 구독에 쏘기 · 붙잡기),
// 29의 `●`(답 바꾸기). **도구가 헛돌면 그 단언들이 바꾸기 전 코드에서도 초록으로 지나간다** — 1판의
// 판 02 L3 셋이 정확히 그렇게 됐다(스펙 리뷰 코드 8). 그래서 도구마다 여기서 「헛돌면 빨갛다」를 세운다.
//
// 앱 코드는 안 본다. 재는 것은 하네스이고, 앱은 그 하네스를 실제로 태우는 무대다 — 구독 수를 앱의
// 구독으로 세지 않는 것도 그래서다: `works:changed`의 구독 수는 앱이 정하는 값이라(14가 작업 화면의
// 넷을 하나로 모았다 — `works-changed.spec.ts`), 그것을 여기 기대값으로 적으면 앱의 변경이 이 파일을 깬다.
//
// (5)는 뒤에 하네스로 올라온 도구다 — `works-changed.spec.ts`가 딛는 멎은 호출 수(`steadyCount`)가 멎지 않는 커맨드에서 끝없이
// 기다리지 않고 센 수를 싣고 던지는지를 잰다.

const [pinnedWork, plainWork] = WORKS;
const [project] = PROJECTS;
/** 목록의 그 프로젝트 행. 이름과 경로를 함께 든다(`projects-list.spec.ts`와 같은 이유). */
const projectRow = (page: Page) =>
  page.getByRole("button", { name: `${project.name} ${project.path}` });

// ─── (1) 살아 있는 모든 구독에 쏘기 ───
//
// 구독은 **이 검사가 직접 붙인다** — 앱 번들의 `listen`과 같은 와이어로(`@tauri-apps/api` 2.x
// `event.js`: `transformCallback` → `plugin:event|listen`, 해제는 `unregisterListener` →
// `plugin:event|unlisten {event, eventId}`). 그 와이어가 실물과 같은지는 아래 StrictMode 검사가 앱의
// 진짜 구독으로 받친다.

/** 아무도 안 쏘는 이벤트 이름. 앱의 구독과 섞이지 않는다. */
const PROBE = "harness:probe";

type Probe = { hits: Record<string, number>; ids: Record<string, number> };
type ProbeWindow = {
  __probe?: Probe;
  __TAURI_INTERNALS__: {
    transformCallback: (callback: (event: unknown) => void) => number;
    invoke: (cmd: string, args?: unknown) => Promise<unknown>;
  };
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (event: string, eventId: number) => void };
};

/** `label`이라는 이름으로 구독 하나를 붙인다. 받은 횟수는 `hits`가 센다. */
async function subscribe(page: Page, label: string): Promise<void> {
  await page.evaluate(
    async ({ event, label }) => {
      const win = window as unknown as ProbeWindow;
      const probe = (win.__probe ??= { hits: {}, ids: {} });
      probe.hits[label] = 0;
      const handler = win.__TAURI_INTERNALS__.transformCallback(() => {
        probe.hits[label] += 1;
      });
      probe.ids[label] = Number(
        await win.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
          event,
          target: { kind: "Any" },
          handler,
        }),
      );
    },
    { event: PROBE, label },
  );
}

/**
 * 그 구독을 뗀다. `afterMs`를 주면 **그만큼 뒤에 비동기로** 뗀다 — StrictMode의 모양이다: 먼저 붙은
 * 구독의 해제가 둘째 구독 **뒤에** 온다(`useEffect` 정리가 `listen`의 promise를 기다린다).
 */
async function unsubscribe(page: Page, label: string, afterMs = 0): Promise<void> {
  await page.evaluate(
    async ({ event, label, afterMs }) => {
      const win = window as unknown as ProbeWindow;
      const eventId = win.__probe!.ids[label];
      const off = async () => {
        win.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
        await win.__TAURI_INTERNALS__.invoke("plugin:event|unlisten", { event, eventId });
      };
      if (afterMs === 0) await off();
      else setTimeout(() => void off(), afterMs);
    },
    { event: PROBE, label, afterMs },
  );
}

async function hits(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__probe!.hits);
}

/** 앱이 부팅을 마친 화면 — 부팅 중의 구독 · 호출이 아래 수에 섞이지 않게 먼저 본다. */
async function openProject(page: Page): Promise<void> {
  await page.goto(`/projects/${project.slug}`);
  await expect(projectRow(page)).toBeVisible();
}

test("(1) 살아 있는 구독을 멎은 뒤에 세고, 모든 구독에 쏘면 살아 있는 핸들러가 다 받는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openProject(page);

  await subscribe(page, "first");
  await subscribe(page, "second");
  await subscribe(page, "third");
  // 첫 구독의 해제가 **늦게** 온다. 기다리지 않고 읽으면 3이다 — 멎을 때까지 기다리는 것이 이 줄의 요점이다.
  await unsubscribe(page, "first", 100);
  expect(await liveSubscriptions(page, PROBE)).toBe(2);

  // 뗀 구독은 안 받는다 — 해제가 콜백을 안 지우므로(구독 번호는 핸들러 id가 아니다) 기록으로 가려야 한다.
  expect(await fireEventToAll(page, PROBE, null)).toBe(2);
  expect(await hits(page)).toEqual({ first: 0, second: 1, third: 1 });

  await unsubscribe(page, "second");
  expect(await liveSubscriptions(page, PROBE)).toBe(1);
  expect(await fireEventToAll(page, PROBE, null)).toBe(1);
  expect(await hits(page)).toEqual({ first: 0, second: 1, third: 2 });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 해제는 **번호로** 짝짓는다(`plugin:event|unlisten`의 `eventId`). 위 검사는 붙인 차례대로 떼서, 해제가 올 때마다 먼저 붙은
// 구독을 지우는 셈으로 세어도 같은 수가 나온다 — 가운데 구독을 먼저 떼야 두 셈이 갈린다.
test("(1) 해제를 번호로 짝짓는다 — 가운데 구독을 먼저 떼면 그 구독만 빠지고 앞뒤 둘이 받는다", async ({ page }) => {
  await installFixtureBackend(page);
  await openProject(page);

  await subscribe(page, "first");
  await subscribe(page, "second");
  await subscribe(page, "third");
  await unsubscribe(page, "second");
  expect(await liveSubscriptions(page, PROBE)).toBe(2);
  expect(await fireEventToAll(page, PROBE, null)).toBe(2);
  expect(await hits(page)).toEqual({ first: 1, second: 0, third: 1 });

  // 마지막 구독을 떼면 첫 구독이 남는다 — 차례로 세면 마지막 하나가 남는다.
  await unsubscribe(page, "third");
  expect(await fireEventToAll(page, PROBE, null)).toBe(1);
  expect(await hits(page)).toEqual({ first: 2, second: 0, third: 1 });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("(1) 앱의 구독도 StrictMode가 붙였다 뗀 첫 구독을 빼고 센다", async ({ page }) => {
  await installFixtureBackend(page);
  await openProject(page);

  // **앵커: StrictMode가 정말 두 번 붙였다.** 한 번만 붙었다면 아래 1은 해제와 짝짓지 않고도 1이다.
  const listens = async () =>
    ((await readIpcRecord(page))?.calls ?? []).filter(
      (call) => call.startsWith("plugin:event|listen ") && call.includes('"settings:open"'),
    ).length;
  await expect.poll(listens).toBe(2);

  expect(await liveSubscriptions(page, "settings:open")).toBe(1);
  // 그 하나가 앱의 진짜 핸들러다 — 쏘면 설정으로 간다.
  expect(await fireEventToAll(page, "settings:open", null)).toBe(1);
  await expect(page).toHaveURL(/\/settings/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("(1) 지금 쏘기 도구는 그대로다 — 마지막 구독 하나에만 쏘고, 구독이 끝내 없으면 던진다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openProject(page);

  await subscribe(page, "first");
  await subscribe(page, "second");
  await fireEvent(page, PROBE, null);
  expect(await hits(page)).toEqual({ first: 0, second: 1 });

  await expect(fireEvent(page, "harness:nobody", null)).rejects.toThrow("harness:nobody 구독");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── (2) 커맨드 붙잡기 ───

test("(2) 셸 띄우기가 아닌 커맨드를 붙잡으면 답이 안 오고 놓으면 온다 — 붙잡힌 부름과 놓은 뒤 부름을 따로 센다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  // 페이지를 열기 **전에** 붙잡는다 — 부팅 때 나가는 첫 부름부터 붙잡힌다.
  await holdCommand(page, "list_projects");
  await page.goto(`/projects/${project.slug}`);

  // 앵커: 부름이 **나갔고** 붙잡혔다. 붙잡힌 부름은 기록에 없다 — 픽스처까지 안 갔다.
  await expect.poll(() => heldCalls(page, "list_projects")).toBeGreaterThan(0);
  const held = await heldCalls(page, "list_projects");
  expect(await callCount(page, "list_projects")).toBe(0);
  await expect(projectRow(page)).toHaveCount(0);

  await releaseCommand(page, "list_projects");
  await expect(projectRow(page)).toBeVisible();
  // 놓은 부름이 이제야 기록에 남는다. 놓은 뒤에 새로 나간 것은 아직 없다.
  expect(await callCount(page, "list_projects")).toBe(held);
  expect(await callsSinceRelease(page, "list_projects")).toBe(0);

  // 놓은 뒤의 부름은 **따로** 센다 — 붙잡혔던 부름과 섞이지 않는다.
  await fireEvent(page, "projects:changed", null);
  await expect.poll(() => callsSinceRelease(page, "list_projects")).toBe(1);
  expect(await heldCalls(page, "list_projects")).toBe(held);
  expect(await callCount(page, "list_projects")).toBe(held + 1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("(2) 페이지가 뜬 뒤에 붙잡으면 그때부터 붙잡는다 — 갈아 끼운 답이 놓은 뒤에야 선다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(workRow(page, plainWork.slug)).toBeVisible();

  await replaceAnswer(
    page,
    "list_works",
    WORKS.filter((work) => work.slug !== plainWork.slug),
  );
  const before = await callCount(page, "list_works");
  await holdCommand(page, "list_works");
  await fireEvent(page, "works:changed", null);

  await expect.poll(() => heldCalls(page, "list_works")).toBeGreaterThan(0);
  const held = await heldCalls(page, "list_works");
  expect(await callCount(page, "list_works")).toBe(before);
  // 답이 안 왔다 — 갈아 끼운 목록이 아직 안 섰다.
  await expect(workRow(page, plainWork.slug)).toBeVisible();

  await releaseCommand(page, "list_works");
  await expect(workRow(page, plainWork.slug)).toHaveCount(0);
  await expect(workRow(page, pinnedWork.slug)).toBeVisible();
  expect(await callCount(page, "list_works")).toBe(before + held);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 놓기 전에 같은 커맨드를 또 붙잡으면 문이 새로 서서, 앞 문에 붙잡힌 부름은 놓을 길이 없다 — 놓기(`releaseCommand`)는 새
// 문만 연다. 그 부름을 기다리는 화면은 영영 안 서고, 검사는 러너의 제한 시간에서야 엉뚱한 줄로 빨개진다.
test("(2) 놓기 전에 같은 커맨드를 다시 붙잡으면 던지고 앞 문은 그대로다 — 놓은 뒤에는 다시 붙잡는다", async ({ page }) => {
  await installFixtureBackend(page);
  await holdCommand(page, "list_projects");
  // 페이지를 열기 전에도 던진다 — 여기서는 하네스가 센다(`holdCommand`). 초기화 스크립트가 둘 깔리면 뜰 때마다 뒤 것이 페이지
  // 안에서 던지고 앞 문은 그대로지만(`armHold`), 초기화 스크립트 안의 throw는 페이지 오류로만 남아 검사를 안 멈춘다 — 둘째
  // 붙잡기가 아무 신호 없이 지나간다. 열기 전에는 놓을 문도 없어서(`releaseCommand`가 「먼저 깔아야 한다」로 던진다) 안내는
  // 「연 뒤에 놓고 다시」다.
  await expect(holdCommand(page, "list_projects")).rejects.toThrow(/list_projects.*페이지를 연 뒤/);
  // 다른 커맨드는 따로 붙잡는다.
  await holdCommand(page, "list_works");
  await page.goto(`/projects/${project.slug}`);
  await expect.poll(() => heldCalls(page, "list_projects")).toBeGreaterThan(0);
  const held = await heldCalls(page, "list_projects");

  await expect(holdCommand(page, "list_projects")).rejects.toThrow("list_projects");
  // 앞 문이 그대로다 — 놓으면 붙잡혔던 부름이 풀려 화면이 선다.
  expect(await heldCalls(page, "list_projects")).toBe(held);
  await releaseCommand(page, "list_projects");
  await expect(projectRow(page)).toBeVisible();
  expect(await callCount(page, "list_projects")).toBe(held);

  // 놓은 뒤에는 다시 붙잡는다 — 수가 0부터 선다(`holdCommand` 머리말).
  await holdCommand(page, "list_projects");
  expect(await heldCalls(page, "list_projects")).toBe(0);
  await fireEvent(page, "projects:changed", null);
  await expect.poll(() => heldCalls(page, "list_projects")).toBe(1);
  expect(await callCount(page, "list_projects")).toBe(held);
  await releaseCommand(page, "list_projects");
  await expect.poll(() => callCount(page, "list_projects")).toBe(held + 1);

  await releaseCommand(page, "list_works");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── (3) 인자별 답 · (4) 답 바꾸기 ───
//
// 답은 앱을 거치지 않고 IPC 입구로 곧바로 묻는다(`askBackendSettled`). 재는 것이 하네스의 답이라서다 — 앱의 어느 화면이 그 커맨드를
// 어떤 인자로 부르는지는 뒤 장들이 바꾼다.

test("(3) 같은 커맨드를 인자 둘로 부르면 인자마다 다른 답이 온다 — 수 인자도 가르고, 맞는 답이 없으면 기본 답", async ({
  page,
}) => {
  // 안전장치가 인자별 답에도 걸린다 — 표에 없는 이름은 조용히 지나가지 않는다.
  await expect(
    installFixtureBackend(page, { no_such_command: answerByArg("id", { 1: false }) }),
  ).rejects.toThrow("no_such_command");

  // 셸 id는 **수**다. 표의 키는 문자열이라, 인자를 문자열로 바꿔 견주지 않으면 하나도 안 맞는다.
  await installFixtureBackend(page, {
    pty_close_check: answerByArg("id", { 1: QUIET_SHELL, 2: null }),
  });
  await openProject(page);

  expect(await askBackendSettled(page, "pty_close_check", { id: 1 })).toEqual({ answer: QUIET_SHELL, error: null });
  expect(await askBackendSettled(page, "pty_close_check", { id: 2 })).toEqual({ answer: null, error: null });
  // 맞는 답이 없으면 그 커맨드의 기본 답 — 이름 표의 값이다.
  expect(await askBackendSettled(page, "pty_close_check", { id: 3 })).toEqual({
    answer: FIXTURE_COMMANDS.pty_close_check,
    error: null,
  });
  expect(FIXTURE_COMMANDS.pty_close_check, "기본 답이 인자별 답과 겹치면 위 줄이 아무것도 안 잰다").not.toEqual(
    QUIET_SHELL,
  );

  // 인자가 아예 없으면 문다 — 인자 이름이 바뀐 것이다. 기본 답으로 떨어지면 그 개명이 조용히 초록이다.
  expect((await askBackendSettled(page, "pty_close_check", {})).error).toContain("pty_close_check");
  expect(await unknownIpcCalls(page)).toEqual(["pty_close_check"]);
});

test("(4) list_works의 답에서 work 하나를 빼고 works:changed를 쏘면 사이드바에서 그 work이 사라진다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(workRow(page, plainWork.slug)).toBeVisible();

  // 안전장치 — 덮어쓰기와 같다. 모르는 이름은 던진다.
  await expect(replaceAnswer(page, "no_such_command", null)).rejects.toThrow("no_such_command");

  await replaceAnswer(
    page,
    "list_works",
    WORKS.filter((work) => work.slug !== plainWork.slug),
  );
  await fireEvent(page, "works:changed", null);
  await expect(workRow(page, plainWork.slug)).toHaveCount(0);
  // 앵커: 목록은 그대로 서 있다 — 통째로 사라진 것이 아니다.
  await expect(workRow(page, pinnedWork.slug)).toBeVisible();

  // 이름 표의 커맨드는 이름으로 간다.
  await replaceAnswer(page, "pty_close_check", QUIET_SHELL);
  expect(await askBackendSettled(page, "pty_close_check", { id: 1 })).toEqual({ answer: QUIET_SHELL, error: null });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── (5) 멎은 호출 수 ───
//
// `steadyCount`는 0.3초 간격의 두 셈이 같아질 때까지 기다린다. 멎지 않는 커맨드(폴러 · 되풀이 조회)에 부르면 끝나지 않아, 검사는
// 러너의 제한 시간에서야 무엇을 기다렸는지 없이 빨개진다. 그래서 상한에서 **센 수를 싣고** 던진다.

test("(5) 호출 수가 멎으면 그 수를 주고, 멎지 않으면 상한에서 센 수를 싣고 던진다", async ({ page }) => {
  await installFixtureBackend(page);
  await openProject(page);
  const settled = await steadyCount(page, "list_projects");
  expect(settled).toBeGreaterThan(0);
  expect(await callCount(page, "list_projects")).toBe(settled);

  // 0.1초마다 부르는 손을 건다 — 0.3초 간격의 두 셈이 같을 날이 없다.
  await page.evaluate(() => {
    const internals = (
      window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }
    ).__TAURI_INTERNALS__;
    window.setInterval(() => void internals.invoke("list_projects", {}), 100);
  });
  await expect(steadyCount(page, "list_projects", { limitMs: 1_000 })).rejects.toThrow(
    /list_projects의 호출 수가 1000ms 안에 멎지 않았다 — 0\.3초마다 센 수: \d+( → \d+)+/,
  );
  expect(await unknownIpcCalls(page)).toEqual([]);
});
