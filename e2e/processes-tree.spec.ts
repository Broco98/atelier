import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, QUIET_SHELL, shellKeyOf, WORKS } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  fireAttention,
  installFixtureBackend,
  kills,
  markRunning,
  modeButton,
  navButton,
  openShell,
  typeIntoShell,
  unknownIpcCalls,
  두세계에셸을띄운다,
  셸입력,
} from "./harness";
import { poolShell, processRow as 행, snapshotFixture } from "@/features/processes/process-fixture";
import type { ProcessSnapshot } from "@/features/processes/types";

// 프로세스 티켓 27 — **`Processes`에서 셸과 자손 트리를 보고 이동하거나 닫는다**(프로세스 결정 9 · 10 · 프로세스 스펙 S32 · S53 ·
// S58 · P1, 스토리 60 · 79 · 80 · 85 · 88 · 98 · 100 · 102).
//
// 묶음의 층과 차례(지금 세계 먼저 · 사이드바 순서 · 시작 순 · 셸 키로 잇기)와 상태 칸의 갈래는 L2가 표로 잰다(`shell-tree.test.ts` ·
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

/**
 * 그 줄 글자의 **바탕과의 대비**(WCAG 대비비 — 1에서 21). 글자색의 알파에 그 줄과 조상들의 불투명도를 곱해 바탕 위에 섞은
 * 색으로 잰다 — 옅게 하는 길이 색 토큰(`text-tertiary`)이든 불투명도든 같은 값으로 읽힌다. 바탕은 위로 올라가며 처음 만나는
 * 불투명한 배경이다. 색은 캔버스에 칠해 읽는다 — 계산된 값이 늘 `rgb()`는 아니다(어두운 테마의 `oklch()` 토큰).
 */
const 글자대비 = (row: Locator): Promise<number> =>
  row.evaluate((element) => {
    const pen = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!pen) throw new Error("캔버스를 못 열었다 — 색을 읽을 수 없다");
    const rgba = (color: string): [number, number, number, number] => {
      pen.clearRect(0, 0, 1, 1);
      pen.fillStyle = color;
      pen.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = pen.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    let back: [number, number, number] = [255, 255, 255];
    let opacity = 1;
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      opacity *= Number(getComputedStyle(at).opacity);
    }
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      const [r, g, b, a] = rgba(getComputedStyle(at).backgroundColor);
      if (a === 1) {
        back = [r, g, b];
        break;
      }
    }
    const [r, g, b, a] = rgba(getComputedStyle(element).color);
    const alpha = a * opacity;
    const ink = [r, g, b].map((channel, at) => alpha * channel + (1 - alpha) * back[at]);
    const luminance = ([red, green, blue]: number[]) => {
      const [lr, lg, lb] = [red, green, blue].map((channel) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    };
    const [light, dark] = [luminance(ink), luminance(back)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  });

/** 켜진 셸 탭의 셸 키 — 탭 칸의 `data-shell-key`(티켓 23). */
const 켜진셸 = (page: Page) =>
  page.locator('[data-tab="shell"]:has(button[aria-pressed="true"])').getAttribute("data-shell-key");

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

test("지금 세계가 맨 위에 서고, 그 아래 저쪽 세계의 work 행 · 셸 행 · 자손 행 · 셸 도우미의 옅은 줄이 선다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷([1, 2, 3, 4]) });
  await 두세계에셸을띄운다(page);

  // Maison에서 연다 — Maison이 맨 위다.
  await navButton(page, "Processes").click();
  await expect(page).toHaveURL("/maison/processes");
  await expect(셸행(page, 1)).toBeVisible();
  expect(await 줄들(page)).toEqual([
    { level: "1", name: "Maison, 지금 세계" },
    { level: "2", name: "Terminal, 셸 1개" },
    { level: "3", name: "zsh, 조용함 2h" },
    { level: "1", name: "Atelier" },
    // work 행 — 이름(목록의 제목)과 셸 수. 결정 10 그림의 「process-manager · 셸 2」가 이 줄이다.
    { level: "2", name: `${plainWork.title}, 셸 2개` },
    // 명령 없이 사람이 띄운 것만 남은 셸 — 도우미는 안 센다.
    { level: "3", name: "zsh, 띄운 프로세스 2개" },
    { level: "4", name: "셸 도우미, gitstatusd-darwin-arm64" },
    { level: "4", name: "node" },
    { level: "5", name: "esbuild" },
    { level: "3", name: "zsh, 조용함 2h" },
    { level: "2", name: "Terminal, 셸 1개" },
    { level: "3", name: "zsh, 조용함 2h" },
  ]);
  // 스토어가 모르는 풀의 셸(`l3-99`)은 이 묶음에 없다 — 32의 화면 밖 셸이다. 앵커는 위에서 선 셸 넷이다.
  await expect(트리(page).locator(`[data-shell-key="${shellKeyOf(99)}"]`)).toHaveCount(0);

  // **셸 도우미는 옅게 선다**(P1) — 사람이 띄운 것과 한 무게로 읽히면 섞인다. 옆의 자손 행보다 글자가 옅다 — 바탕과의 대비가
  // 낮다. 색이 다른지만 보면 더 짙은 색으로 바뀌어도 초록이다.
  const 도우미 = 트리(page).getByRole("treeitem", { name: "셸 도우미, gitstatusd-darwin-arm64", exact: true });
  const 자손 = 트리(page).getByRole("treeitem", { name: "node", exact: true });
  const [도우미대비, 자손대비] = [await 글자대비(도우미), await 글자대비(자손)];
  expect(도우미대비, `셸 도우미 ${도우미대비.toFixed(2)} · 자손 ${자손대비.toFixed(2)}`).toBeLessThan(자손대비);

  // Atelier로 건너가 연다 — 이제 Atelier가 맨 위다. 같은 화면이 지금 세계만 바꿔 세운다.
  await modeButton(page, "Atelier").click();
  await navButton(page, "Processes").click();
  await expect(page).toHaveURL("/processes");
  await expect.poll(async () => (await 줄들(page))[0]).toEqual({ level: "1", name: "Atelier, 지금 세계" });
  expect((await 줄들(page)).map((row) => row.name)).toEqual([
    "Atelier, 지금 세계",
    `${plainWork.title}, 셸 2개`,
    "zsh, 띄운 프로세스 2개",
    "셸 도우미, gitstatusd-darwin-arm64",
    "node",
    "esbuild",
    "zsh, 조용함 2h",
    "Terminal, 셸 1개",
    "zsh, 조용함 2h",
    "Maison",
    "Terminal, 셸 1개",
    "zsh, 조용함 2h",
  ]);

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

// 셸 상태는 레지스트리가 내놓는 함수로 읽는다(셸 탭 · 사이드바 · 띠와 같은 말 — 스토리 79). 셸 상태가 없고 조용하면 「조용함」과
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
  // 마크는 에이전트의 것이다 — 이름은 접근성으로만 한 번 더 읽힌다(`SignalMeta`와 같은 규칙).
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

  // 같은 세계의 다른 화면 — 그 work의 첫 셸(켜진 칸은 둘째다)로 간다.
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
    .toEqual([{ id: 1, reason: "shellClose", owner: "atelier:" }]);
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
    "3",
  );
  const 줄 = await 줄들(page);
  expect(줄.map((row) => row.level)).toEqual(["1", "2", "3", "4", "4", "5"]);
  // 이름 없는 줄이 없다 — 트리에 선 모든 줄이 한 문장으로 읽힌다.
  expect(줄.every((row) => (row.name ?? "").length > 0)).toBe(true);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
