import { expect, test, type Page } from "./evidence";
import { FIXTURE_COMMANDS, PROJECTS, ROOMS, WORKS, answerByArg } from "./fixtures";
import {
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
  unknownIpcCalls,
  workRow,
} from "./harness";
import type { Mode } from "@/mode";

// **하네스의 도구 넷이 스스로를 잰다**(프로세스 관리 티켓 01). 이 도구들은 뒤 장의 L3가 딛는다 —
// 12의 MCP 아카이브 흉내(인자별 답 · 답 바꾸기), 14의 구독 · 호출 수(모든 구독에 쏘기 · 붙잡기),
// 29의 `●`(답 바꾸기). **도구가 헛돌면 그 단언들이 바꾸기 전 코드에서도 초록으로 지나간다** — 1판의
// 판 02 L3 셋이 정확히 그렇게 됐다(스펙 리뷰 코드 8). 그래서 도구마다 여기서 「헛돌면 빨갛다」를 세운다.
//
// 앱 코드는 안 본다. 재는 것은 하네스이고, 앱은 그 하네스를 실제로 태우는 무대다 — 구독 수를 앱의
// 구독으로 세지 않는 것도 그래서다: `works:changed`의 구독 수는 14가 바꿀 값이라, 그것을 여기
// 기대값으로 적으면 14가 이 파일을 깬다.

const [pinnedWork, plainWork] = WORKS;
const [project] = PROJECTS;
/** 셸 닫기 전 물음의 한 답 — 명령도 띄운 프로세스도 없다. 기본 답(명령이 돈다)과 다른 값이어야 인자별 답이 잰다. */
const QUIET = { command: false, descendants: 0 };
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
    "atelier",
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

// ─── (3) 인자별 답 · (4) 답 바꾸기 ───

/**
 * 브라우저 안에서 IPC를 한 번 부르고 **답이든 거절이든 그대로 들고 나온다**(`mode-fail-closed.spec.ts`의
 * `ask`와 같은 모양). 앱을 거치지 않는 것은 재는 것이 하네스의 답이라서다 — 앱의 어느 화면이 그 커맨드를
 * 어떤 인자로 부르는지는 뒤 장들이 바꾼다.
 */
async function ask(page: Page, cmd: string, args: Record<string, unknown>) {
  return page.evaluate(
    async ({ cmd, args }: { cmd: string; args: Record<string, unknown> }) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      try {
        return { answer: await internals.invoke(cmd, args), error: null as string | null };
      } catch (error) {
        return { answer: null as unknown, error: String(error) };
      }
    },
    { cmd, args },
  );
}

test("(3) 같은 커맨드를 인자 둘로 부르면 인자마다 다른 답이 온다 — 수 인자도 가르고, 맞는 답이 없으면 기본 답", async ({
  page,
}) => {
  // 안전장치가 인자별 답에도 걸린다 — 표에 없는 이름은 조용히 지나가지 않는다.
  await expect(
    installFixtureBackend(page, { no_such_command: answerByArg("id", { 1: false }) }),
  ).rejects.toThrow("no_such_command");

  // 셸 id는 **수**다. 표의 키는 문자열이라, 인자를 문자열로 바꿔 견주지 않으면 하나도 안 맞는다.
  await installFixtureBackend(page, {
    pty_command_running: answerByArg("id", { 1: QUIET, 2: null }),
  });
  await openProject(page);

  expect(await ask(page, "pty_command_running", { id: 1 })).toEqual({ answer: QUIET, error: null });
  expect(await ask(page, "pty_command_running", { id: 2 })).toEqual({ answer: null, error: null });
  // 맞는 답이 없으면 그 커맨드의 기본 답 — 이름 표의 값이다.
  expect(await ask(page, "pty_command_running", { id: 3 })).toEqual({
    answer: FIXTURE_COMMANDS.pty_command_running,
    error: null,
  });
  expect(FIXTURE_COMMANDS.pty_command_running, "기본 답이 인자별 답과 겹치면 위 줄이 아무것도 안 잰다").not.toEqual(
    QUIET,
  );

  // 인자가 아예 없으면 문다 — 인자 이름이 바뀐 것이다. 기본 답으로 떨어지면 그 개명이 조용히 초록이다.
  expect((await ask(page, "pty_command_running", {})).error).toContain("pty_command_running");
  expect(await unknownIpcCalls(page)).toEqual(["pty_command_running"]);
});

test("(4) list_works의 atelier 답에서 work 하나를 빼고 works:changed를 쏘면 사이드바에서 그 work이 사라진다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(workRow(page, plainWork.slug)).toBeVisible();

  // 안전장치 — 덮어쓰기와 같다. 모르는 이름 · 모르는 모드 · 모드를 빠뜨림 · 모드로 안 갈리는 커맨드에 모드.
  await expect(replaceAnswer(page, "no_such_command", null)).rejects.toThrow("no_such_command");
  // 와이어에서 온 모드가 아무 문자열일 수 있다는 것을 흉내 낸다 — 캐스트가 이 줄의 요점이다.
  await expect(replaceAnswer(page, "list_works", [], "masion" as Mode)).rejects.toThrow("masion");
  await expect(replaceAnswer(page, "list_works", [])).rejects.toThrow("list_works");
  await expect(replaceAnswer(page, "pty_command_running", QUIET, "atelier")).rejects.toThrow(
    "pty_command_running",
  );

  await replaceAnswer(
    page,
    "list_works",
    WORKS.filter((work) => work.slug !== plainWork.slug),
    "atelier",
  );
  await fireEvent(page, "works:changed", null);
  await expect(workRow(page, plainWork.slug)).toHaveCount(0);
  // 앵커: 목록은 그대로 서 있다 — 통째로 사라진 것이 아니다.
  await expect(workRow(page, pinnedWork.slug)).toBeVisible();

  // 한 모드만 갈았다 — 저쪽 세계의 답은 그대로다.
  expect(await ask(page, "list_works", { mode: "maison" })).toEqual({ answer: ROOMS, error: null });
  // 이름 표의 커맨드는 이름으로 간다.
  await replaceAnswer(page, "pty_command_running", QUIET);
  expect(await ask(page, "pty_command_running", { id: 1 })).toEqual({ answer: QUIET, error: null });

  expect(await unknownIpcCalls(page)).toEqual([]);
});
