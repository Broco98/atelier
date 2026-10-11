import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, QUIET_SHELL, shellKeyOf, WORKS } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  fireAttention,
  installFixtureBackend,
  kills,
  markRunning,
  navButton,
  openShell,
  typeIntoShell,
  unknownIpcCalls,
  글자대비,
  셸셋을띄운다,
  셸입력,
  스냅샷두박자,
  칠한값,
  칸들,
  토큰값,
  토큰색,
} from "./harness";
import { formatPort } from "@/features/processes/metrics";
import { metricsOf, poolShell, processRow as 행, snapshotFixture } from "@/features/processes/process-fixture";
import type { ProcessSnapshot } from "@/features/processes/types";

// 프로세스 티켓 27 — **`Processes`에서 셸과 자손 트리를 보고 이동하거나 닫는다**(프로세스 결정 9 · 10 · 프로세스 스펙 S32 · S53 ·
// S58 · P1, 스토리 60 · 79 · 80 · 85 · 88 · 98 · 100 · 102).
//
// 묶음의 층과 차례(사이드바 순서 · 시작 순 · 셸 키로 잇기)와 상태 칸의 갈래는 L2가 표로 잰다(`shell-tree.test.ts` ·
// `process-tree.test.ts`). 여기서 보는 것은 그 표가 **진짜 스토어(진짜로 띄운 셸) · 진짜 스냅샷 폴러 · 진짜 라우터 · 진짜 포커스 ·
// 진짜 확인 창**을 지나 화면에 서는가다 — 스토어는 xterm을 들여 노드 seam에 없다.
//
// 셸 키는 픽스처의 spawn 답이 `l3-<pty 번호>`로 준다(`FIXTURE_INCREMENTING_KEYS`). 스냅샷 픽스처의 풀이 그 키를 실으면 화면이 스토어의
// 셸과 잇는다 — 실물에서 둘이 같은 셸 키 하나인 것과 같다.

const [, plainWork] = WORKS;

const 트리 = (page: Page) => page.getByRole("tree", { name: "셸", exact: true });
const 셸행 = (page: Page, pty: number) => 트리(page).locator(`[role="treeitem"][data-shell-key="${shellKeyOf(pty)}"]`);

/** 트리의 줄들 — 깊이와 접근성 이름. 화면에 선 차례 그대로다. */
async function 줄들(page: Page): Promise<Array<{ level: string | null; name: string | null }>> {
  return 트리(page)
    .getByRole("treeitem")
    .evaluateAll((rows) => rows.map((row) => ({ level: row.getAttribute("aria-level"), name: row.getAttribute("aria-label") })));
}

/** 켜진 셸 탭의 셸 키 — 탭 칸의 `data-shell-key`(티켓 23). */
const 켜진셸 = (page: Page) =>
  칸들(page).filter({ has: page.locator('button[aria-pressed="true"]') }).getAttribute("data-shell-key");

const gitstatusd = 행(150, 1, 1_000, "gitstatusd", {
  argv0: "/Users/me/.cache/gitstatus/gitstatusd-darwin-arm64",
  command: "gitstatusd-darwin-arm64 -G v1.5.4 -s -1",
});
const vite = 행(200, 1, 2_000, "node", { argv0: "node", command: "node vite --port 5173" });
const esbuild = 행(210, 200, 2_100, "esbuild", { argv0: "/p/node_modules/esbuild/bin/esbuild", command: "esbuild --service=0.25.0 --ping" });

/**
 * 풀에 `ptys`의 셸이 앉은 스냅샷. 첫 셸에는 셸 도우미 하나와 사람이 띄운 트리(vite → esbuild)가 있다. 마지막 출력은 두 시간
 * 전이다 — 조용한 셸의 경과가 「2h」로 선다. 스토어가 모르는 셸(`l3-99`)도 하나 싣는다: 그것은 32의 「화면 밖 셸」이라 이 묶음에
 * 안 선다.
 */
function 스냅샷(ptys: number[], withTree = true): ProcessSnapshot {
  const lastOutputMs = Date.now() - 2 * 3_600_000;
  return snapshotFixture({
    verdict: {
      descendants: withTree ? { [shellKeyOf(ptys[0])]: [gitstatusd, vite, esbuild] } : {},
      helpers: withTree ? [gitstatusd.id] : [],
    },
    pool: [...ptys, 99].map((pty) => poolShell(pty, shellKeyOf(pty), lastOutputMs)),
  });
}

test("work 행이 맨 윗단이고 그 아래 셸 행 · 자손 행 · 셸 도우미의 옅은 줄이 선다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷([1, 2, 3]) });
  await 셸셋을띄운다(page);

  await navButton(page, "Processes").click();
  await expect(page).toHaveURL("/processes");
  await expect(셸행(page, 1)).toBeVisible();
  expect(await 줄들(page)).toEqual([
    // work 행이 맨 윗단이다 — 이름(목록의 제목)과 셸 수. 프로세스 결정 10 그림의
    // 「process-manager · 셸 2」가 이 줄이다.
    { level: "1", name: `${plainWork.title}, 셸 2개` },
    // 명령 없이 사람이 띄운 것만 남은 셸 — 도우미는 안 센다.
    { level: "2", name: "zsh, 띄운 프로세스 2개" },
    { level: "3", name: "셸 도우미, gitstatusd-darwin-arm64" },
    { level: "3", name: "node" },
    { level: "4", name: "esbuild" },
    { level: "2", name: "zsh, 조용함 2h" },
    { level: "1", name: "Terminal, 셸 1개" },
    { level: "2", name: "zsh, 조용함 2h" },
  ]);
  // 스토어가 모르는 풀의 셸(`l3-99`)은 이 묶음에 없다 — 32의 화면 밖 셸이다. 앵커는 위에서 선 셸 셋이다.
  await expect(트리(page).locator(`[data-shell-key="${shellKeyOf(99)}"]`)).toHaveCount(0);

  // **셸 도우미는 옅게 선다**(P1) — 사람이 띄운 것과 한 무게로 읽히면 섞인다. 옆의 자손 행보다 글자가 옅다 — 바탕과의 대비가
  // 낮다. 색이 다른지만 보면 더 짙은 색으로 바뀌어도 초록이다.
  const 도우미 = 트리(page).getByRole("treeitem", { name: "셸 도우미, gitstatusd-darwin-arm64", exact: true });
  const 자손 = 트리(page).getByRole("treeitem", { name: "node", exact: true });
  const [도우미대비, 자손대비] = [await 글자대비(도우미), await 글자대비(자손)];
  expect(도우미대비, `셸 도우미 ${도우미대비.toFixed(2)} · 자손 ${자손대비.toFixed(2)}`).toBeLessThan(자손대비);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 툴팁의 명령줄은 수집이 `KERN_PROCARGS2`의 argv 전체에서 읽은 것이다(티켓 11). 스냅샷의 행마다 실려 온다. 명령줄은 **이름 글자의**
// 툴팁이다 — 줄 전체에 걸면 줄 안의 ⋯(앱 툴팁 「프로세스 메뉴」)에 올린 포인터에 브라우저 툴팁(명령줄)이 함께 떠 둘이 겹친다.
test("자손 행의 이름에 스냅샷의 명령줄이 툴팁으로 서고, 줄 안의 ⋯에는 앱 툴팁 하나만 선다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷([1]) });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await navButton(page, "Processes").click();

  const node = 트리(page).getByRole("treeitem", { name: "node", exact: true });
  await expect(node.getByText("node", { exact: true })).toHaveAttribute("title", "node vite --port 5173");
  await expect(트리(page).getByRole("treeitem", { name: "esbuild", exact: true }).getByText("esbuild", { exact: true })).toHaveAttribute(
    "title",
    "esbuild --service=0.25.0 --ping",
  );
  // ⋯와 [끝내기]는 명령줄 툴팁 밖이다 — 스스로도, 감싼 것도 `title`이 없다.
  for (const name of ["프로세스 메뉴", "끝내기"]) {
    const button = node.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    expect(await button.evaluate((element) => element.closest("[title]")?.getAttribute("title") ?? null), name).toBeNull();
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 그 요소가 눈에 보이는 정도 — 자신과 조상의 불투명도를 곱한다(숨김은 줄 끝 동작 칸이 든다). */
const 불투명도 = (element: Locator) =>
  element.evaluate((node) => {
    let opacity = 1;
    for (let at: Element | null = node; at !== null; at = at.parentElement) opacity *= Number(getComputedStyle(at).opacity);
    return opacity;
  });

// **프로세스 줄의 [끝내기] · ⋯은 손이 닿을 때만 선다**(ui-refresh 「같은 날 더 정한 것」 — Processes 다시 그림): 줄에 포인터가
// 있거나 키보드 포커스가 줄 안에 들면 보인다. 자리는 늘 차지한다(불투명도만 바뀐다 — 숫자 칸이 흔들리지 않는다). 셸 줄의 [이동] ·
// [닫기]는 늘 보인다 — 셸을 닫는 길이 숨지 않는다.
test("프로세스 줄의 [끝내기] · ⋯은 줄에 포인터나 포커스가 있을 때만 보이고, 셸 줄의 [이동] · [닫기]는 늘 보인다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷([1]) });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await navButton(page, "Processes").click();

  const node = 트리(page).getByRole("treeitem", { name: "node", exact: true });
  const 동작 = [
    node.getByRole("button", { name: "끝내기", exact: true }),
    node.getByRole("button", { name: "프로세스 메뉴", exact: true }),
  ];
  const 셸동작 = ["이동", "닫기"].map((name) => 셸행(page, 1).getByRole("button", { name, exact: true }));
  const 요약 = page.getByRole("region", { name: "요약", exact: true });

  // 포인터가 트리 밖이다 — 프로세스 줄의 동작은 숨고, 셸 줄의 동작은 선다.
  await 요약.hover();
  for (const button of 동작) await expect.poll(() => 불투명도(button)).toBe(0);
  for (const button of 셸동작) expect(await 불투명도(button)).toBe(1);

  // 줄에 포인터를 올리면 선다. 떠나면 다시 숨는다.
  await node.hover();
  for (const button of 동작) await expect.poll(() => 불투명도(button)).toBe(1);
  await 요약.hover();
  for (const button of 동작) await expect.poll(() => 불투명도(button)).toBe(0);

  // 키보드 포커스가 줄 안에 들면 포인터 없이도 선다.
  await 동작[0].focus();
  for (const button of 동작) await expect.poll(() => 불투명도(button)).toBe(1);
  for (const button of 셸동작) expect(await 불투명도(button)).toBe(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 셸 상태는 레지스트리가 내놓는 함수로 읽는다(셸 탭 · 사이드바 · 띠와 같은 말 — terminal-activity-signal 스토리 79). 셸 상태가 없고 조용하면 「조용함」과
// 경과, 둘 다 아니면 도는 명령의 마크와 이름이다.
test("셸 상태가 있는 셸은 상태 칸에 그 상태가, 조용한 셸은 「조용함」이, 명령이 도는 셸은 그 명령이 선다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷([1, 2, 3, 4], false) });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await openShell(page);
  await openShell(page);
  await openShell(page);

  // 첫 셸이 사람에게 묻는다. 둘째는 서브에이전트 둘을 둔 채 턴이 멈췄다 — 아직 도는 중이다(S50). 넷째에서 claude가 돈다.
  // 시각은 훅이 적은 것이다(`at`) — 경과가 그 값에서 잰다.
  const 시각 = Date.now();
  await fireAttention(page, { agent: "claude", event: "Elicitation", at: 시각, payload: { message: "어느 쪽으로 할까요?" } }, 1);
  await fireAttention(
    page,
    {
      agent: "claude",
      event: "Stop",
      at: 시각,
      payload: { last_assistant_message: "서브에이전트 둘을 띄웠어요" },
      subagents: 2,
      stopped: true,
    },
    2,
  );
  await markRunning(page, "claude", 4);

  await navButton(page, "Processes").click();
  await expect(셸행(page, 1)).toHaveAttribute("aria-label", /^zsh, 나를 기다림 \d+s$/);
  await expect(셸행(page, 1)).toContainText("나를 기다림");
  await expect(셸행(page, 2)).toHaveAttribute("aria-label", "zsh, 도는 중 · 서브에이전트 2");
  await expect(셸행(page, 2)).toContainText("도는 중 · 서브에이전트 2");
  await expect(셸행(page, 3)).toHaveAttribute("aria-label", "zsh, 조용함 2h");
  await expect(셸행(page, 3)).toContainText("조용함");
  await expect(셸행(page, 4)).toHaveAttribute("aria-label", "zsh, claude");
  // 마크는 에이전트의 것이다 — 이름은 접근성으로만 한 번 더 읽힌다(셸 탭 칸의 마크와 같은 규칙).
  await expect(셸행(page, 4).getByRole("img", { name: "claude", exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// [이동] = 화면 이동 + 닿으면 켜기와 포커스 요청(`selectShellWithFocus` · 티켓 16) — 띠의 줄 · ⌘J와 같은 길(`useGoToShell`)이다.
test("[이동]을 누르면 그 셸로 가서 포커스가 그 셸의 xterm 입력칸에 온다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷([1, 2, 3], false) });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await openShell(page);
  await navButton(page, "Terminal").click();
  await expect.poll(() => callCount(page, "pty_spawn"), { timeout: 20_000 }).toBe(3);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);

  // 다른 화면 — 그 work의 첫 셸(켜진 칸은 둘째다)로 간다.
  await navButton(page, "Processes").click();
  await 셸행(page, 1).getByRole("button", { name: "이동", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}\\?.*tab=terminal`));
  await expect.poll(() => 켜진셸(page), { message: "[이동]한 셸이 켜지지 않았다" }).toBe(shellKeyOf(1));
  // 포커스는 셸의 입력칸이다(하네스의 `셸입력` — 떼어 둔 셸은 DOM에서 빠져 화면에 선 입력칸은 켜진 셸 하나뿐이다).
  await expect(셸입력(page), "[이동]한 셸에 포커스가 없다").toBeFocused();

  // 최상위 터미널의 셸로 — 화면이 `/terminal`로 옮긴다.
  await navButton(page, "Processes").click();
  await 셸행(page, 3).getByRole("button", { name: "이동", exact: true }).click();
  await expect(page).toHaveURL("/terminal");
  await expect.poll(() => 켜진셸(page)).toBe(shellKeyOf(3));
  await expect(셸입력(page), "[이동]한 셸에 포커스가 없다").toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// [닫기] = 셸 탭의 ×와 같은 길(`requestCloseShell`). 명령이나 자손이 있으면 08의 확인 창이 묻는다. 까닭은 「셸 닫기」다 — 사람이 누른
// 닫기라 `●`를 켜지 않는다(29).
test("[닫기]를 누르면 명령도 자손도 없는 셸은 묻지 않고 닫히고, 자손이 있으면 확인 창이 선다", async ({ page }) => {
  await installFixtureBackend(page, {
    processes_snapshot: 스냅샷([1, 2], false),
    pty_close_check: answerByArg("id", {
      1: QUIET_SHELL,
      2: { command: false, descendants: 2 },
    }),
  });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await openShell(page);
  await navButton(page, "Processes").click();

  await 셸행(page, 1).getByRole("button", { name: "닫기", exact: true }).click();
  // 앵커: 닫기 전 물음이 나갔고 그 답으로 닫았다 — 묻기 전에 닫은 것이 아니다.
  await expect
    .poll(() => kills(page))
    .toEqual([{ id: 1, reason: "shellClose", owner: "" }]);
  expect(await callCount(page, "pty_close_check")).toBe(1);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(셸행(page, 1)).toHaveCount(0);

  await 셸행(page, 2).getByRole("button", { name: "닫기", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "셸 닫기" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("이 셸에서 띄운 프로세스 2개가 아직 돌아요. 닫을까요?");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(셸행(page, 2)).toBeVisible();
  expect(await callCount(page, "pty_kill")).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// S58 — 스크린리더가 트리 깊이를 읽는다. 셸 묶음은 트리 역할이고, 행의 접근성 이름은 「셸 이름, 상태」를 한 문장으로 잇고(메모리
// 조각은 지표를 읽은 셸에만 붙는다 — 여기 픽스처는 못 읽은 지표다. 붙은 모양은 `processes-metrics.spec.ts`), 행마다 `aria-level`이
// 깊이를 말한다.
test("셸 묶음이 트리 역할이고, 셸 행의 접근성 이름이 이름과 상태를 한 문장으로 잇고, 행마다 aria-level이 깊이를 말한다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷([1]) });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await navButton(page, "Processes").click();

  await expect(트리(page)).toBeVisible();
  await expect(트리(page).getByRole("treeitem", { name: "zsh, 띄운 프로세스 2개", exact: true })).toHaveAttribute(
    "aria-level",
    "2",
  );
  const 줄 = await 줄들(page);
  expect(줄.map((row) => row.level)).toEqual(["1", "2", "3", "3", "4"]);
  // 이름 없는 줄이 없다 — 트리에 선 모든 줄이 한 문장으로 읽힌다.
  expect(줄.every((row) => (row.name ?? "").length > 0)).toBe(true);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 트리의 줄들과 펼침 — 이름과 `aria-expanded`(자식이 없는 줄은 없다). **DOM에 선 줄을 센다** — 접은 줄의 밑은 그려지지 않는다. */
async function 펼침들(page: Page): Promise<Array<[string | null, string | null]>> {
  return 트리(page)
    .locator('[role="treeitem"]')
    .evaluateAll((rows) => rows.map((row) => [row.getAttribute("aria-label"), row.getAttribute("aria-expanded")]));
}

/** 그 줄의 셰브론 — 이름이 「<줄 이름> 접기」 · 「<줄 이름> 펼치기」다. */
const 셰브론 = (row: Locator, name: string, open: boolean) =>
  row.getByRole("button", { name: `${name} ${open ? "접기" : "펼치기"}`, exact: true });

// **트리가 접힌다**(ui-refresh 결정 28 · 「같은 날 더 정한 것」 — 사용자 요청으로 더한 동작). 자식이 있는 줄(작업 · 셸 도우미나 자손이
// 있는 셸 · 자손이 있는 프로세스)만 셰브론을 달고, 그 줄이 `aria-expanded`를 단다. 접으면 밑의 줄을 안 그린다 — 줄은 평평한 채다(S58).
// 기억은 화면의 상태다: 박자(2초)가 새 스냅샷을 가져와도 남고, 화면을 떠났다 오면 다 펼친 처음으로 돌아간다. [끝내기] · [닫기]의 대상은
// 접힘과 상관없이 그 줄의 트리 전부다.
test("작업 · 셸 · 자식 있는 프로세스 줄이 셰브론으로 접히고 펴지며, 박자가 와도 그대로이고, 다른 화면에 갔다 오면 다 펼친 처음으로 돌아간다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    processes_snapshot: 스냅샷([1, 2, 3]),
    pty_close_check: answerByArg("id", { 1: { command: false, descendants: 2 } }),
  });
  await 셸셋을띄운다(page);
  await navButton(page, "Processes").click();
  await expect(셸행(page, 1)).toBeVisible();

  const 작업 = `${plainWork.title}, 셸 2개`;
  const 처음: Array<[string, string | null]> = [
    [작업, "true"],
    ["zsh, 띄운 프로세스 2개", "true"],
    ["셸 도우미, gitstatusd-darwin-arm64", null],
    ["node", "true"],
    ["esbuild", null],
    ["zsh, 조용함 2h", null],
    ["Terminal, 셸 1개", "true"],
    ["zsh, 조용함 2h", null],
  ];
  // 처음은 다 펼쳤다. 자식이 없는 줄에는 셰브론이 없다 — 앵커: 자식이 있는 줄에는 있다.
  expect(await 펼침들(page)).toEqual(처음);
  await expect(셰브론(셸행(page, 2), "zsh", true)).toHaveCount(0);
  await expect(셰브론(셸행(page, 1), "zsh", true)).toBeVisible();

  // ── 프로세스 줄 ── 접으면 그 밑(esbuild)만 빠지고 셰브론의 이름이 「펼치기」가 된다.
  const node = 트리(page).getByRole("treeitem", { name: "node", exact: true });
  await 셰브론(node, "node", true).click();
  await expect(node).toHaveAttribute("aria-expanded", "false");
  await expect(셰브론(node, "node", false)).toBeVisible();
  expect(await 펼침들(page)).toEqual([처음[0], 처음[1], 처음[2], ["node", "false"], 처음[5], 처음[6], 처음[7]]);
  // 접은 줄의 [끝내기]는 그 트리 전부를 넘긴다 — 숨은 esbuild까지다(확인 창의 수가 펼쳤을 때와 같다).
  await node.getByRole("button", { name: "끝내기", exact: true }).click();
  const 끝내기창 = page.getByRole("alertdialog", { name: "'node' 끝내기" });
  await expect(끝내기창).toContainText("이 프로세스와 그 밑에서 뜬 프로세스 1개를 끝내요.");
  await 끝내기창.getByRole("button", { name: "취소", exact: true }).click();
  await expect(끝내기창).toHaveCount(0);

  // ── 셸 줄 ── 접으면 셸 도우미와 자손이 다 빠진다. [닫기]는 그대로 서고, 확인 창의 수가 그 셸의 트리 전부다.
  await 셰브론(셸행(page, 1), "zsh", true).click();
  await expect(셸행(page, 1)).toHaveAttribute("aria-expanded", "false");
  expect(await 펼침들(page)).toEqual([처음[0], ["zsh, 띄운 프로세스 2개", "false"], 처음[5], 처음[6], 처음[7]]);
  await 셸행(page, 1).getByRole("button", { name: "닫기", exact: true }).click();
  const 닫기창 = page.getByRole("alertdialog", { name: "셸 닫기" });
  await expect(닫기창).toContainText("이 셸에서 띄운 프로세스 2개가 아직 돌아요. 닫을까요?");
  await 닫기창.getByRole("button", { name: "취소", exact: true }).click();
  await expect(닫기창).toHaveCount(0);

  // ── 작업 줄 ── 접으면 그 work의 셸이 다 빠진다.
  const 터미널 = 트리(page).getByRole("treeitem", { name: "Terminal, 셸 1개", exact: true });
  await 셰브론(터미널, "Terminal", true).click();
  const 접은뒤: Array<[string, string | null]> = [처음[0], ["zsh, 띄운 프로세스 2개", "false"], 처음[5], ["Terminal, 셸 1개", "false"]];
  expect(await 펼침들(page)).toEqual(접은뒤);

  // 박자가 새 스냅샷을 가져와도 그대로다.
  await 스냅샷두박자(page);
  expect(await 펼침들(page)).toEqual(접은뒤);

  // 셸을 다시 펴면 그 안에서 접어 둔 프로세스는 접힌 채다.
  await 셰브론(셸행(page, 1), "zsh", false).click();
  expect(await 펼침들(page)).toEqual([처음[0], 처음[1], 처음[2], ["node", "false"], 처음[5], ["Terminal, 셸 1개", "false"]]);

  // 다른 화면에 갔다 오면 다 펼친 처음이다 — 기억은 화면에 있는 동안만이다.
  await navButton(page, "Projects").click();
  await expect(트리(page)).toHaveCount(0);
  await navButton(page, "Processes").click();
  await expect(셸행(page, 1)).toBeVisible();
  expect(await 펼침들(page)).toEqual(처음);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 티켓 22 — **트리의 줄이 DS `ProcessTree`의 줄이다**(스토리 59 · DS `.at-pr-row` · `.at-th` · `.at-sechead` · `.at-port`). 줄은
// 갈래마다 높이와 글자가 깊이를 거든다: 작업 40 · 14/20 500, 셸 32 · 13/18, 프로세스 30 · 13/18 `fg-secondary`, 셸 도우미 28 · 12/18
// `fg-tertiary` — 높이 넷은 DS `.at-pr-row`가 갈래마다 적은 수라 그 수로 센다. 줄은 옅은 면 묶음 없이 흰 카드 위에 서고, 안쪽 좌우 12에
// 아래 0.5px `border` 선이 줄을 가르며, 포인터가 오르면 `fill-soft`다. 열 머리는 같은 격자 위의 32 · 12/18 `fg-tertiary` 줄이고 아래에
// 1px `rule` 선이 선다 — 요약 타일에서 22 아래다. 구획 머리는 36 · 13/18 600에 수는 400 `fg-tertiary`다. 포트는 `fill-soft` 칩(20 ·
// 안쪽 6 · `radius-sm` · mono 12 `fg-secondary`)이다.
test("트리의 줄이 DS 줄이다 — 작업 40 · 셸 32 · 프로세스 30 · 도우미 28과 글자 단계, 줄 아래 0.5px 선, 열 머리 32 · 구획 머리 36, 포트 칩", async ({
  page,
}) => {
  const lastOutputMs = Date.now() - 2 * 3_600_000;
  await installFixtureBackend(page, {
    processes_snapshot: snapshotFixture({
      verdict: {
        descendants: { [shellKeyOf(1)]: [gitstatusd, { ...vite, metrics: metricsOf(300 * 1024 ** 2, 12, [5173]) }, esbuild] },
        helpers: [gitstatusd.id],
      },
      pool: [poolShell(1, shellKeyOf(1), lastOutputMs)],
    }),
  });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await navButton(page, "Processes").click();
  await expect(셸행(page, 1)).toBeVisible();

  const 작업줄 = 트리(page).locator('[role="treeitem"][aria-level="1"]');
  const 프로세스줄 = 트리(page).locator('[role="treeitem"][aria-level="3"]:not([data-helper])');
  const 도우미줄 = 트리(page).locator("[data-helper]");
  const [진한글자, 흐린글자, 옅은글자] = [
    await 토큰색(page, "--fg"),
    await 토큰색(page, "--fg-secondary"),
    await 토큰색(page, "--fg-tertiary"),
  ];

  // 줄 — 갈래마다 높이 · 글자 단계 · 색, 안쪽 좌우 12.
  const 줄표: Array<[string, Locator, string[]]> = [
    ["작업", 작업줄, ["40px", "14px", "20px", "500", 진한글자, "12px", "12px"]],
    ["셸", 셸행(page, 1), ["32px", "13px", "18px", "400", 진한글자, "12px", "12px"]],
    ["프로세스", 프로세스줄, ["30px", "13px", "18px", "400", 흐린글자, "12px", "12px"]],
    ["셸 도우미", 도우미줄, ["28px", "12px", "18px", "400", 옅은글자, "12px", "12px"]],
  ];
  const 선 = await 토큰색(page, "--border");
  for (const [이름, 줄, 값] of 줄표) {
    await expect(줄, 이름).toHaveCount(1);
    expect(
      await 칠한값(줄, "height", "font-size", "line-height", "font-weight", "color", "padding-left", "padding-right"),
      `${이름} 줄`,
    ).toEqual(값);
    // 줄 아래 0.5px `border` 선 — 테두리가 아니라 줄 안쪽 바닥에 칠한 면이다.
    const 아랫선 = await 줄.evaluate((el) => {
      const line = getComputedStyle(el, "::after");
      return [line.position, line.bottom, line.height, line.backgroundColor];
    });
    expect(아랫선, `${이름} 줄 아랫선`).toEqual(["absolute", "0px", "0.5px", 선]);
  }
  expect(await 칠한값(도우미줄, "letter-spacing"), "셸 도우미 글자 자간").toEqual(["0.3px"]);

  // 줄은 옅은 면 묶음 없이 카드 위에 선다 — 포인터가 오르면 `fill-soft`다.
  expect(await 칠한값(프로세스줄, "background-color"), "줄의 바탕").toEqual(["rgba(0, 0, 0, 0)"]);
  await 프로세스줄.hover();
  await expect.poll(() => 칠한값(프로세스줄, "background-color"), { message: "줄에 오른 면" }).toEqual([await 토큰색(page, "--fill-soft")]);

  // 열 머리 — 같은 격자 위의 32 · 12/18 `fg-tertiary` 줄, 안쪽 12, 아래 1px `rule` 선. 「이름」은 줄의 안쪽 끝에, 「메모리」의 오른끝은
  // 작업 줄 메모리 칸의 오른끝에 선다. 요약 타일에서 22 아래다.
  const 메모리머리 = page.getByText("메모리", { exact: true });
  const 열머리 = 메모리머리.locator("..");
  expect(
    await 칠한값(열머리, "height", "font-size", "line-height", "color", "padding-left", "padding-right"),
    "열 머리",
  ).toEqual(["32px", "12px", "18px", 옅은글자, "12px", "12px"]);
  const 머리선 = await 열머리.evaluate((el) => {
    const line = getComputedStyle(el, "::after");
    return [line.position, line.bottom, line.height, line.backgroundColor];
  });
  expect(머리선, "열 머리 아랫선").toEqual(["absolute", "0px", "1px", await 토큰색(page, "--rule")]);
  const [이름칸, 메모리칸, 작업상자, 작업메모리, 요약상자, 열머리상자] = await Promise.all([
    열머리.getByText("이름", { exact: true }).boundingBox(),
    메모리머리.boundingBox(),
    작업줄.boundingBox(),
    작업줄.locator('[data-cell="memory"]').boundingBox(),
    page.getByRole("region", { name: "요약", exact: true }).boundingBox(),
    열머리.boundingBox(),
  ]);
  expect(Math.round(이름칸!.x - 작업상자!.x), "「이름」은 줄 안쪽 12에").toBe(12);
  expect(Math.round(메모리칸!.x + 메모리칸!.width), "「메모리」의 오른끝").toBe(Math.round(작업메모리!.x + 작업메모리!.width));
  expect(Math.round(열머리상자!.y - (요약상자!.y + 요약상자!.height)), "요약 타일과 열 머리 사이").toBe(22);

  // 구획 머리 — 36 · 안쪽 12, 제목 13/18 600, 수 13 · 400 `fg-tertiary`.
  const 구획머리 = page.getByRole("region", { name: "작업", exact: true }).locator(":scope > div").first();
  expect(await 칠한값(구획머리, "height", "padding-left", "padding-right"), "구획 머리").toEqual(["36px", "12px", "12px"]);
  expect(await 칠한값(구획머리.getByText("작업", { exact: true }), "font-size", "line-height", "font-weight"), "구획 제목").toEqual([
    "13px",
    "18px",
    "600",
  ]);
  expect(await 칠한값(구획머리.getByText("셸 1개", { exact: true }), "font-size", "font-weight", "color"), "구획의 수").toEqual([
    "13px",
    "400",
    옅은글자,
  ]);

  // 포트 칩 — 20 · 안쪽 6 · `radius-sm` · `fill-soft` · mono 12/18 `fg-secondary`.
  const 칩 = 프로세스줄.getByText(formatPort(5173), { exact: true });
  const 칩반경 = await 토큰값(page, "border-top-left-radius", "--radius-sm");
  expect(칩반경, "radius-sm").toBe("6px");
  const 칩모양 = ["height", "padding-left", "padding-right", "border-top-left-radius", "background-color"];
  expect(await 칠한값(칩, ...칩모양, "font-family", "font-size", "line-height", "color"), "포트 칩").toEqual([
    "20px",
    "6px",
    "6px",
    칩반경,
    await 토큰색(page, "--fill-soft"),
    await 토큰값(page, "font-family", "--font-mono"),
    "12px",
    "18px",
    흐린글자,
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
