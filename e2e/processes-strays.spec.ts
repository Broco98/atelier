import { expect, test, type Locator, type Page } from "./evidence";
import { shellKeyOf } from "./fixtures";
import {
  awaitSpawned,
  callCount,
  installFixtureBackend,
  ipcCallArgs,
  navButton,
  replaceAnswer,
  typeIntoShell,
  unknownIpcCalls,
  끌어놓는다,
  다떴다,
  스냅샷두박자,
  줄차례,
  테두리,
  토큰색,
} from "./harness";
import { formatMemory } from "@/features/processes/metrics";
import { envReadRow, metricsOf, poolShell, snapshotFixture } from "@/features/processes/process-fixture";
import type { ProcessIdentity, ProcessRow, ProcessSnapshot } from "@/features/processes/types";
import { terminalSettings } from "@/features/settings/settings-fixture";
import type { Settings } from "@/features/settings/types";

// 프로세스 티켓 31 — **고아 · 다른 인스턴스 · 예외를 보고, 고아를 치우고 프로세스를 끝낸다**(프로세스 결정 5 · 6 · 10 · 기본값
// [끝내기] · 프로세스 스펙 S4 · S7 · S54 · S58, 스토리 86 · 91 · 92 · 93).
//
// 묶음을 짓는 규칙(트리 · 실행마다 묶기 · 빌드 이름 · 끝낼 신원 · 확인 창의 말 · 예외 목록에 더하기)은 L2가 표로 잰다
// (`process-tree.test.ts` · `process-groups.test.ts` · `process-exceptions.test.ts`). 여기서 보는 것은 그 결과가 **진짜 스냅샷
// 폴러 · 진짜 확인 창 · 진짜 설정 저장**을 지나 화면에 서고 IPC에 실리는가다. 끝내기가 신호 직전에 신원을 다시 보는 것(재사용된 pid)은 L1이 잰다 — 이 층이 보는 것은
// **화면에 보인 신원이 그대로 실리는가**다.
//
// 숫자 칸의 기대 글자는 화면이 쓰는 그 표기 함수로 짓는다(`processes-metrics.spec.ts`와 같은 규칙) — 모양은 L2의 몫이다.

const MiB = 1024 * 1024;

const 묶음 = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const 줄 = (scope: Locator, name: string) => scope.getByRole("treeitem", { name, exact: true });
const 메모리칸 = (row: Locator) => row.locator('[data-cell="memory"]');
/** 구획의 머리 — 제목을 이름으로 든 여닫이 버튼이다(ui-refresh 결정 28). 수와 동작은 버튼 밖이다. */
const 머리 = (page: Page, name: string) => 묶음(page, name).getByRole("button", { name, exact: true });

/** 접어 여는 구획(출처 불명 · 다른 인스턴스 · 예외 — ui-refresh 결정 28)을 머리를 눌러 편다. */
async function 펼친다(page: Page, ...names: string[]): Promise<void> {
  for (const name of names) {
    await 머리(page, name).click();
    await expect(머리(page, name)).toHaveAttribute("aria-expanded", "true");
  }
}

/** 그 구획의 버튼 중 접는 것(머리 · 줄의 셰브론) 밖의 것의 이름 — 동작 버튼이다. */
const 동작버튼 = (page: Page, title: string) =>
  묶음(page, title)
    .getByRole("button")
    .evaluateAll(
      (buttons, title) =>
        buttons
          .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "")
          .filter((name) => name !== title && !/ (접기|펼치기)$/.test(name)),
      title,
    );

/** env를 읽은 행(`envReadRow`). 줄 이름에 메모리가 붙게 메모리만 늘 준다. */
const 행 = (pid: number, ppid: number, startedUs: number, name: string, memory: number): ProcessRow =>
  envReadRow(pid, ppid, startedUs, name, { metrics: metricsOf(memory) });

const 신원 = (row: ProcessRow): ProcessIdentity => row.id;
const pid순 = (ids: ProcessIdentity[]) => [...ids].sort((a, b) => a.pid - b.pid);

// 셸 1의 자손 — vite(node) 밑에 esbuild, 그 밑에 watcher. sleep은 셸 바로 밑의 형제다(node의 트리가 아니다).
const vite = 행(200, 1, 2_000, "node", 300 * MiB);
const esbuild = 행(210, 200, 2_100, "esbuild", 20 * MiB);
const watcher = 행(220, 210, 2_200, "watcher", 5 * MiB);
const sleep = 행(230, 1, 2_300, "sleep", MiB);

// 확정 고아 — 셸 키 둘. 출처 불명 — 셸 키 둘, 둘 다 한 줄씩(N = 2).
const 고아node = 행(400, 1, 4_000, "node", 120 * MiB);
const 고아esbuild = 행(410, 400, 4_100, "esbuild", 30 * MiB);
const 고아python = 행(450, 1, 4_500, "python3", 40 * MiB);
const 불명sleep = 행(500, 1, 5_000, "sleep", 2 * MiB);
const 불명ruby = 행(510, 1, 5_100, "ruby", 8 * MiB);

// 다른 인스턴스 — dev 빌드 하나(셸 키 H-2: zsh 밑에 node), 설치본 하나(셸 키 R-1: zsh).
const 남의zsh = 행(600, 1, 6_000, "zsh", 4 * MiB);
const 남의node = 행(610, 600, 6_100, "node", 200 * MiB);
const 설치본zsh = 행(650, 1, 6_500, "zsh", 3 * MiB);

// 예외 — tmux 서버와 그 밑의 zsh.
const tmux = 행(300, 1, 3_000, "tmux", 10 * MiB);
const tmux밑zsh = 행(310, 300, 3_100, "zsh", 6 * MiB);

function 스냅샷(): ProcessSnapshot {
  return snapshotFixture({
    verdict: {
      descendants: { [shellKeyOf(1)]: [vite, esbuild, watcher, sleep] },
      exceptions: [tmux, tmux밑zsh],
      orphans: {
        confirmed: { "OLD-3": [고아node, 고아esbuild], "OLD-5": [고아python] },
        unknown: { "X-1": [불명sleep], "X-2": [불명ruby] },
      },
      otherInstances: { "H-2": [남의zsh, 남의node], "R-1": [설치본zsh] },
    },
    pool: [poolShell(1, shellKeyOf(1), Date.now(), metricsOf(4 * MiB))],
    instances: [
      { generation: "H", build: "dev", version: "0.15.0", shellKeys: ["H-2"] },
      { generation: "R", build: "release", version: "0.14.1", shellKeys: ["R-1"] },
    ],
  });
}

/** 셸 하나를 띄우고 `Processes`를 연다 — 자손 행은 스토어의 셸과 이어져야 선다. */
async function 셸을띄우고연다(page: Page): Promise<void> {
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await navButton(page, "Processes").click();
  await expect(page).toHaveURL("/processes");
  await expect(줄(page.getByRole("tree", { name: "셸", exact: true }), `node, ${formatMemory(vite.metrics.memory)}`)).toBeVisible();
}

const 셸트리 = (page: Page) => page.getByRole("tree", { name: "셸", exact: true });
const 이름 = (row: ProcessRow) => `${row.name}, ${formatMemory(row.metrics.memory)}`;

test("확정 고아와 출처 불명이 갈린 묶음으로 서고, 다른 인스턴스는 실행마다 빌드 종류 · 버전이, 예외는 그 트리가 서며, 그 둘에는 동작이 없다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await page.goto("/processes");

  // 확정 고아 — 셸 키 둘의 행이 한 묶음에, 트리로(esbuild는 node 밑). [정리]가 선다.
  const 확정 = 묶음(page, "확정 고아");
  await expect(확정.getByRole("treeitem")).toHaveCount(3);
  await expect(줄(확정, 이름(고아node))).toHaveAttribute("aria-level", "1");
  await expect(줄(확정, 이름(고아esbuild))).toHaveAttribute("aria-level", "2");
  await expect(줄(확정, 이름(고아python))).toHaveAttribute("aria-level", "1");
  await expect(확정.getByRole("button", { name: "정리", exact: true })).toBeVisible();
  // 행 메뉴 ⋯에는 앱 툴팁 하나만 선다 — 명령줄 툴팁(`title`)은 이름 글자의 것이라 ⋯를 감싸지 않는다.
  const 메뉴 = 줄(확정, 이름(고아node)).getByRole("button", { name: "프로세스 메뉴", exact: true });
  await expect(메뉴).toBeVisible();
  expect(await 메뉴.evaluate((element) => element.closest("[title]")?.getAttribute("title") ?? null)).toBeNull();

  // 출처 불명 · 다른 인스턴스 · 예외는 접혀 연다(ui-refresh 결정 28) — 머리를 눌러 편 뒤 센다.
  await 펼친다(page, "출처 불명", "다른 인스턴스", "예외");

  // 출처 불명 — 따로 선 묶음이다. 확정 고아의 행이 섞이지 않는다.
  const 불명 = 묶음(page, "출처 불명");
  await expect(불명.getByRole("treeitem")).toHaveCount(2);
  await expect(줄(불명, 이름(불명sleep))).toBeVisible();
  await expect(줄(불명, 이름(불명ruby))).toBeVisible();
  await expect(불명.getByRole("button", { name: "정리", exact: true })).toBeVisible();

  // 다른 인스턴스 — 실행마다 머리(빌드 종류 · 버전)가 서고 그 밑에 그 실행의 셸 키가 낸 트리가 선다. 보기 전용이다.
  const 남 = 묶음(page, "다른 인스턴스");
  await expect(남).toContainText("보기 전용");
  const dev머리 = 남.getByRole("treeitem", { name: /^dev 빌드 · v0\.15\.0/ });
  const 설치본머리 = 남.getByRole("treeitem", { name: /^설치본 · v0\.14\.1/ });
  await expect(dev머리).toHaveAttribute("aria-level", "1");
  await expect(설치본머리).toHaveAttribute("aria-level", "1");
  await expect(줄(남, 이름(남의zsh))).toHaveAttribute("aria-level", "2");
  await expect(줄(남, 이름(남의node))).toHaveAttribute("aria-level", "3");
  await expect(줄(남, 이름(설치본zsh))).toHaveAttribute("aria-level", "2");

  // 예외 — 걸린 이름과 그 밑. 보기 전용이다.
  const 예외 = 묶음(page, "예외");
  await expect(예외).toContainText("보기 전용");
  await expect(줄(예외, 이름(tmux))).toHaveAttribute("aria-level", "1");
  await expect(줄(예외, 이름(tmux밑zsh))).toHaveAttribute("aria-level", "2");

  // 다른 인스턴스와 예외 행에는 끝내는 동작이 없다 — 동작 버튼(끝내기 · 정리 · 행 메뉴)이 하나도 안 선다. 있는 버튼은 접는 것(구획
  // 머리 · 부모 줄의 셰브론)뿐이다. 앵커: 고아 묶음에는 동작 버튼이 섰다(위).
  expect(await 동작버튼(page, "다른 인스턴스")).toEqual([]);
  expect(await 동작버튼(page, "예외")).toEqual([]);
  expect(await 동작버튼(page, "확정 고아")).toEqual(["정리", "프로세스 메뉴", "프로세스 메뉴", "프로세스 메뉴"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 그 구획에 그려진 줄의 수 — DOM에 선 줄이다. 접힌 구획 · 접힌 줄의 밑은 그려지지 않는다. */
const 그린줄 = (page: Page, name: string) => 묶음(page, name).locator('[role="treeitem"]');

// **구획과 부모 줄이 접힌다**(ui-refresh 결정 28). 처음 상태는 표다 — 정리할 것이 있는 확정 고아는 펼쳐 열고, 보기 전용 · 참고용인 출처
// 불명 · 다른 인스턴스 · 예외는 접어 연다. 접힌 구획도 머리(제목 · 수 · 동작)는 선다. 부모 줄(고아 · 예외의 부모, 다른 인스턴스의 머리)도
// 접힌다. 기억은 화면의 상태다: 박자가 와도 남고, 비었다가 다시 선 구획은 처음 상태로 서고, 화면을 떠났다 오면 표로 돌아간다.
test("구획이 ui-refresh 결정 28의 표대로 열리고 머리를 눌러 여닫으며, 부모 줄도 접히고, 박자에도 남고, 비었다 다시 선 구획 · 다시 연 화면은 표로 돌아간다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await page.goto("/processes");

  // ── 처음 ── 확정 고아만 펼쳤다. 접힌 구획은 줄을 안 그린다.
  await expect(머리(page, "확정 고아")).toHaveAttribute("aria-expanded", "true");
  await expect(그린줄(page, "확정 고아")).toHaveCount(3);
  for (const name of ["출처 불명", "다른 인스턴스", "예외"]) {
    await expect(머리(page, name)).toHaveAttribute("aria-expanded", "false");
    await expect(그린줄(page, name)).toHaveCount(0);
  }
  // 접혀 있어도 수와 동작은 머리에 선다 — 영역은 제목만으로 찾힌다(위). [정리]는 접힌 채 누른다(아래 「출처 불명의 [정리]」 검사).
  await expect(묶음(page, "출처 불명")).toContainText("프로세스 2개");
  await expect(묶음(page, "출처 불명").getByRole("button", { name: "정리", exact: true })).toBeVisible();
  await expect(묶음(page, "예외")).toContainText("보기 전용");

  // ── 머리를 눌러 여닫는다 ──
  await 머리(page, "확정 고아").click();
  await expect(머리(page, "확정 고아")).toHaveAttribute("aria-expanded", "false");
  await expect(그린줄(page, "확정 고아")).toHaveCount(0);
  await 펼친다(page, "출처 불명", "다른 인스턴스", "예외");
  await expect(그린줄(page, "출처 불명")).toHaveCount(2);

  // ── 부모 줄 ── 다른 인스턴스의 머리와 예외의 부모를 접는다. 그 밑만 빠진다.
  const 남 = 묶음(page, "다른 인스턴스");
  const dev머리 = 남.getByRole("treeitem", { name: /^dev 빌드 · v0\.15\.0/ });
  await dev머리.getByRole("button", { name: "dev 빌드 · v0.15.0 접기", exact: true }).click();
  await expect(dev머리).toHaveAttribute("aria-expanded", "false");
  await expect(그린줄(page, "다른 인스턴스")).toHaveCount(3);
  await expect(줄(남, 이름(설치본zsh))).toBeVisible();
  const tmux줄 = 줄(묶음(page, "예외"), 이름(tmux));
  await tmux줄.getByRole("button", { name: "tmux 접기", exact: true }).click();
  await expect(tmux줄).toHaveAttribute("aria-expanded", "false");
  await expect(그린줄(page, "예외")).toHaveCount(1);

  // ── 박자가 와도 그대로다 ──
  await 스냅샷두박자(page);
  await expect(머리(page, "확정 고아")).toHaveAttribute("aria-expanded", "false");
  await expect(머리(page, "출처 불명")).toHaveAttribute("aria-expanded", "true");
  await expect(dev머리).toHaveAttribute("aria-expanded", "false");
  await expect(그린줄(page, "다른 인스턴스")).toHaveCount(3);
  await expect(그린줄(page, "예외")).toHaveCount(1);

  // ── 비었다 다시 선 구획은 처음 상태다 ── 고아가 다 끝났다가(두 구획이 안 선다) 다시 생긴다. 접어 둔 확정 고아는 펼쳐, 펴 둔 출처 불명은
  // 접혀 다시 선다. 그동안 선 채였던 구획의 접힘은 그대로다.
  const 고아없음 = 스냅샷();
  고아없음.verdict.orphans = { confirmed: {}, unknown: {} };
  await replaceAnswer(page, "processes_snapshot", 고아없음);
  await expect(묶음(page, "확정 고아")).toHaveCount(0);
  await expect(묶음(page, "출처 불명")).toHaveCount(0);
  await replaceAnswer(page, "processes_snapshot", 스냅샷());
  await expect(머리(page, "확정 고아")).toHaveAttribute("aria-expanded", "true");
  await expect(그린줄(page, "확정 고아")).toHaveCount(3);
  await expect(머리(page, "출처 불명")).toHaveAttribute("aria-expanded", "false");
  await expect(머리(page, "예외")).toHaveAttribute("aria-expanded", "true");
  await expect(tmux줄).toHaveAttribute("aria-expanded", "false");

  // ── 화면을 떠났다 오면 표다 ── 줄의 접힘도 잊는다.
  await navButton(page, "Projects").click();
  await expect(묶음(page, "예외")).toHaveCount(0);
  await navButton(page, "Processes").click();
  await expect(머리(page, "확정 고아")).toHaveAttribute("aria-expanded", "true");
  for (const name of ["출처 불명", "다른 인스턴스", "예외"]) {
    await expect(머리(page, name)).toHaveAttribute("aria-expanded", "false");
  }
  await 펼친다(page, "예외");
  await expect(tmux줄).toHaveAttribute("aria-expanded", "true");
  await expect(그린줄(page, "예외")).toHaveCount(2);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **구획의 몸은 접히는 변형(`Collapsible` fold)이다**(ui-refresh 결정 28 · `tree-rows.tsx`의 `Section`). 그 변형의 짜임은 이 자리가 잰다 —
// 앱에서 그 변형을 쓰는 것이 이 구획뿐이다(한때 Archive 목록 항목도 썼다).
// - **접힘은 패널 자신의 전이다.** Base UI는 패널 자기 위의 전이만 기다렸다가 패널을 내린다 — 전이가 바깥 상자에 있으면 닫을 때 곧바로
//   사라진다. 그래서 닫을 때 행 전이(180ms)가 끝까지 돈다.
// - **열 때도 돈다.** 닫혀 내려간 패널은 새로 서므로, 시작 상태(`data-starting-style`)에 접힌 트랙이 없으면 전이가 돌지 않는다.
// - **닫히는 동안 몸은 `inert`다.** 전이가 도는 동안 줄은 아직 보이지만 포커스와 포인터가 닿으면 안 된다 — 열리면 곧바로 풀린다. 전이가
//   서는 순간(`transitionrun`)에 패널이 `inert`인지를 함께 적는다.
// - 움직임을 끄면 전역 규칙(`index.css`)이 그 전이를 끈다 — 여닫혀도 전이가 하나도 안 돈다.
//
// **끝은 `transitionend`가 아니라 그 전이의 `finished`로 잰다.** 이 구획의 패널은 닫힘이 끝나면 내려간다(`keepMounted`가 없다) — Base
// UI가 `finished`를 받자마자 패널을 걷어 `transitionend`는 문서에 닿지 못한다. `finished`는 끝까지 돌았을 때만 풀리고, 중간에 걷히면
// 전이가 취소되어 「cancel」로 적힌다. 기록은 페이지가 뜨기 전에 건다. 처음 뜰 때의 움직임이 가라앉은 뒤에 비우고 잰다.
test("구획은 열 때도 닫을 때도 180ms로 접히고 펼쳐지며 닫히는 동안 몸이 inert다 — 움직임을 끄면 전이 없이 여닫힌다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await page.addInitScript(() => {
    const folds: string[] = [];
    Object.assign(window, { __folds: folds });
    document.addEventListener(
      "transitionrun",
      (event) => {
        const target = event.target as Element;
        if (event.propertyName !== "grid-template-rows") return;
        if (target.getAttribute("data-slot") !== "collapsible-content") return;
        folds.push(target.hasAttribute("inert") ? "run inert" : "run");
        const transition = target
          .getAnimations()
          .find((one) => one instanceof CSSTransition && one.transitionProperty === "grid-template-rows");
        transition?.finished.then(
          () => folds.push(`end ${transition.effect?.getComputedTiming().duration}`),
          () => folds.push("cancel"),
        );
      },
      true,
    );
  });
  const 접힘기록 = () => page.evaluate(() => (window as unknown as { __folds: string[] }).__folds);
  const 기록을비운다 = () =>
    page.evaluate(() => {
      (window as unknown as { __folds: string[] }).__folds.length = 0;
    });
  await page.goto("/processes");
  const 패널 = 묶음(page, "확정 고아").locator('[data-slot="collapsible-content"]');
  await expect(그린줄(page, "확정 고아")).toHaveCount(3);
  await expect(패널).not.toHaveAttribute("inert");
  await expect.poll(() => 패널.evaluate((el) => el.getAnimations().length)).toBe(0);
  await 기록을비운다();

  // 닫기 — inert로 접히기 시작하고, 전이가 끝까지 돈 뒤에 내려간다.
  await 머리(page, "확정 고아").click();
  await expect(머리(page, "확정 고아")).toHaveAttribute("aria-expanded", "false");
  await expect(그린줄(page, "확정 고아")).toHaveCount(0);
  await expect.poll(접힘기록).toEqual(["run inert", "end 180"]);

  // 열기 — 내려갔던 패널이 새로 서도 전이가 돌고, inert가 아니다.
  await 기록을비운다();
  await 머리(page, "확정 고아").click();
  await expect(그린줄(page, "확정 고아")).toHaveCount(3);
  await expect.poll(접힘기록).toEqual(["run", "end 180"]);
  await expect(패널).not.toHaveAttribute("inert");

  // 움직임을 끈다. 닫힘의 앵커는 「줄이 내려갔다」다 — 전이가 돌았다면 그 끝에야 내려가므로, 내려간 뒤의 빈 기록이 헛돌지 않는다.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await 기록을비운다();
  await 머리(page, "확정 고아").click();
  await expect(머리(page, "확정 고아")).toHaveAttribute("aria-expanded", "false");
  await expect(그린줄(page, "확정 고아")).toHaveCount(0);
  expect(await 접힘기록()).toEqual([]);
  // 열림은 전이가 있어도 곧바로 보이므로, 두 프레임을 흘려 전이가 시작될 자리를 준 뒤에 센다.
  await 머리(page, "확정 고아").click();
  await expect(그린줄(page, "확정 고아")).toHaveCount(3);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  expect(await 접힘기록()).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("고아 · 다른 인스턴스 · 예외 행에도 28의 표기 함수로 메모리 칸이 선다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await page.goto("/processes");
  await 펼친다(page, "출처 불명", "다른 인스턴스", "예외");

  for (const [group, rows] of [
    ["확정 고아", [고아node, 고아esbuild, 고아python]],
    ["출처 불명", [불명sleep, 불명ruby]],
    ["다른 인스턴스", [남의zsh, 남의node, 설치본zsh]],
    ["예외", [tmux, tmux밑zsh]],
  ] as const) {
    for (const row of rows) {
      await expect(메모리칸(줄(묶음(page, group), 이름(row)))).toHaveText(formatMemory(row.metrics.memory));
    }
  }
  // 실행 머리는 그 실행의 행을 더한 것이다.
  await expect(메모리칸(묶음(page, "다른 인스턴스").getByRole("treeitem", { name: /^dev 빌드/ }))).toHaveText(
    formatMemory(남의zsh.metrics.memory! + 남의node.metrics.memory!),
  );
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("확정 고아의 [정리]는 묻지 않고 그 묶음의 신원 전부를 끝내기 IPC에 싣는다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await page.goto("/processes");

  await 묶음(page, "확정 고아").getByRole("button", { name: "정리", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "processes_end", "targets")).map(({ args }) => pid순(args.targets as ProcessIdentity[])))
    .toEqual([pid순([고아node, 고아esbuild, 고아python].map(신원))]);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("출처 불명의 [정리]는 「출처를 모르는 프로세스 N개를 끝내요」를 한 번 더 묻고, 취소하면 끝내기 IPC가 안 나간다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await page.goto("/processes");
  const 정리 = 묶음(page, "출처 불명").getByRole("button", { name: "정리", exact: true });

  await 정리.click();
  // 앵커: 확인 창이 섰다 — 안 서고 안 부른 것과 가른다.
  const dialog = page.getByRole("alertdialog", { name: "출처 불명 정리" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("출처를 모르는 프로세스 2개를 끝내요");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await callCount(page, "processes_end")).toBe(0);

  // 진행하면 그 묶음의 신원 전부가 실린다.
  await 정리.click();
  await dialog.getByRole("button", { name: "끝내기", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "processes_end", "targets")).map(({ args }) => pid순(args.targets as ProcessIdentity[])))
    .toEqual([pid순([불명sleep, 불명ruby].map(신원))]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("자손 행의 [끝내기]는 확인 창을 거친 뒤 화면에 보인 신원(그 프로세스와 그 PID 트리)을 싣고, 취소하면 안 부른다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await 셸을띄우고연다(page);
  const 끝내기 = 줄(셸트리(page), 이름(vite)).getByRole("button", { name: "끝내기", exact: true });

  await 끝내기.click();
  const dialog = page.getByRole("alertdialog", { name: "'node' 끝내기" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("이 프로세스와 그 밑에서 뜬 프로세스 2개를 끝내요.");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await callCount(page, "processes_end")).toBe(0);

  await 끝내기.click();
  await dialog.getByRole("button", { name: "끝내기", exact: true }).click();
  // 그 프로세스와 그 밑(esbuild → watcher)이다. 셸 바로 밑의 형제(sleep)는 안 든다. 신원은 스냅샷에 실린 (pid, 시작 시각) 그대로다.
  await expect
    .poll(async () => (await ipcCallArgs(page, "processes_end", "targets")).map(({ args }) => pid순(args.targets as ProcessIdentity[])))
    .toEqual([pid순([vite, esbuild, watcher].map(신원))]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 설정 저장에 실린 예외 목록들 — 저장마다 하나. */
const 저장된예외 = async (page: Page) =>
  (await ipcCallArgs(page, "write_settings", "settings")).map(({ args }) => (args.settings as Settings).terminal.processExceptions);

test("행 메뉴의 「예외로 두기」는 그 이름을 설정 저장에 싣고, 설정이 null이면 기본 목록 + 그 이름이다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await 셸을띄우고연다(page);

  await 줄(셸트리(page), 이름(esbuild)).getByRole("button", { name: "프로세스 메뉴", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "예외로 두기", exact: true }).click();
  // 픽스처의 설정은 `processExceptions: null`, 기본 목록은 `["tmux", "docker*"]`다.
  await expect.poll(() => 저장된예외(page)).toEqual([["tmux", "docker*", "esbuild"]]);
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await callCount(page, "processes_end")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("고아 행의 「예외로 두기」는 고친 목록이 있으면 그 목록 끝에 이름을 더한다", async ({ page }) => {
  await installFixtureBackend(page, {
    processes_snapshot: 스냅샷(),
    read_settings: { terminal: terminalSettings({ processExceptions: ["tmux"] }) } satisfies Settings,
  });
  await page.goto("/processes");

  await 줄(묶음(page, "확정 고아"), 이름(고아python)).getByRole("button", { name: "프로세스 메뉴", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "예외로 두기", exact: true }).click();
  await expect.poll(() => 저장된예외(page)).toEqual([["tmux", "python3"]]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **행을 우클릭해도 ⋯과 같은 메뉴가 선다**(codex-ds 티켓 30 · 스펙 §9 대상 메뉴 표 · 결정 6 · 7 · 11). 메뉴가 있는 행(셸 자손 · 확정 고아 ·
// 출처 불명)만이고, 다른 인스턴스 · 예외 행에는 ⋯이 없듯 우클릭 메뉴도 없다. 카드는 커서 자리에 서고, 열린 동안 그 행에 대상 테두리가
// 서며, 닫히면 포커스가 그 행의 ⋯로 간다 — 행 자신은 포커스를 받지 않는다. 행 안 버튼(⋯ · [끝내기])에 포커스를 두고 ⇧F10을 누르면 같은
// 메뉴가 그 행의 왼쪽 아래에 선다. 메뉴가 열린 동안은 부품이 바깥을 보조 기술에서 숨겨 역할로 집을 때 숨은 것까지 집는다.

const 숨은트리 = (page: Page) => page.getByRole("tree", { name: "셸", exact: true, includeHidden: true });
const 숨은줄 = (scope: Locator, name: string) => scope.getByRole("treeitem", { name, exact: true, includeHidden: true });
const 숨은메뉴버튼 = (row: Locator) => row.getByRole("button", { name: "프로세스 메뉴", exact: true, includeHidden: true });

test("메뉴가 있는 행을 우클릭하면 ⋯과 같은 메뉴가 커서 자리에 서고, 열린 동안 그 행에 대상 테두리가 서며 Esc면 포커스가 ⋯로 간다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await 셸을띄우고연다(page);
  const row = 숨은줄(숨은트리(page), 이름(esbuild));
  const more = 숨은메뉴버튼(row);
  const menu = page.getByRole("menu");
  const 링 = `1px solid ${await 토큰색(page, "--accent")}`;

  // ⋯의 목록을 먼저 읽는다 — 우클릭 메뉴가 그것과 같아야 한다(결정 6).
  await more.click();
  const 점점점 = await 줄차례(menu);
  expect(점점점).toEqual(["예외로 두기"]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await 테두리(row)).toBeNull();

  await row.click({ button: "right", position: { x: 6, y: 6 } });
  await expect(menu).toBeVisible();
  expect(await 줄차례(menu)).toEqual(점점점);
  await 다떴다(menu);
  const spot = (await row.boundingBox())!;
  const card = (await menu.boundingBox())!;
  expect([Math.round(card.x), Math.round(card.y)]).toEqual([Math.round(spot.x + 6), Math.round(spot.y + 6)]);
  await expect.poll(() => 테두리(row)).toBe(링);
  await expect(page).toHaveURL("/processes");

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect.poll(() => 테두리(row)).toBeNull();

  // ⇧F10 · 메뉴 키 — 행 안 버튼(⋯)에 포커스를 두고 누르면 같은 메뉴가 그 행의 왼쪽 아래에 선다. ↓가 첫 항목이다.
  for (const key of ["Shift+F10", "ContextMenu"]) {
    await page.keyboard.press(key);
    await expect(menu).toBeVisible();
    expect(await 줄차례(menu)).toEqual(점점점);
    await 다떴다(menu);
    const below = (await row.boundingBox())!;
    const keyed = (await menu.boundingBox())!;
    expect([Math.round(keyed.x), Math.round(keyed.y)]).toEqual([Math.round(below.x), Math.round(below.y + below.height)]);
    await expect.poll(() => 테두리(row)).toBe(링);
    await expect(menu).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "예외로 두기", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
  }
  expect(await callCount(page, "write_settings")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 행 메뉴의 뿌리는 행 · 몸을 감싸지 않는다(`TargetMenu`) — 감싸면 그 밑의 ⋯이 「우클릭 메뉴의 줄」로 쳐져, 누른 채 끌어 놓는 고름이 안
// 돈다. 이 몸짓이 그 자리를 잠근다(`끌어놓는다` — Works 머리 카드의 ⋯과 같은 잣대).
test("행의 ⋯을 누른 채 끌어 「예외로 두기」 위에서 놓으면 그 줄이 돈다 — 행 메뉴가 ⋯을 감싸지 않는다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await 셸을띄우고연다(page);

  await 끌어놓는다(page, 줄(셸트리(page), 이름(esbuild)).getByRole("button", { name: "프로세스 메뉴", exact: true }), (menu) =>
    menu.getByRole("menuitem", { name: "예외로 두기", exact: true }),
  );
  await expect.poll(() => 저장된예외(page)).toEqual([["tmux", "docker*", "esbuild"]]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 자손 행 · 고아 행을 우클릭해 「예외로 두기」를 고르면 ⋯과 같이 그 이름을 설정 저장에 싣는다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await 셸을띄우고연다(page);

  await 숨은줄(셸트리(page), 이름(esbuild)).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "예외로 두기", exact: true }).click();
  await expect.poll(() => 저장된예외(page)).toEqual([["tmux", "docker*", "esbuild"]]);
  await expect(page.getByRole("menu")).toHaveCount(0);

  await 숨은줄(묶음(page, "확정 고아"), 이름(고아python)).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "예외로 두기", exact: true }).click();
  await expect.poll(async () => (await 저장된예외(page)).length).toBe(2);
  expect((await 저장된예외(page))[1]).toContain("python3");
  expect(await callCount(page, "processes_end")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("메뉴가 없는 행(다른 인스턴스 · 예외 · 작업 줄)을 우클릭하면 웹뷰 메뉴가 막히고 아무 메뉴도 서지 않는다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: 스냅샷() });
  await 셸을띄우고연다(page);
  await 펼친다(page, "다른 인스턴스", "예외");
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { 막힘: boolean[] }).막힘 = seen;
    window.addEventListener("contextmenu", (event) => setTimeout(() => seen.push(event.defaultPrevented)), true);
  });
  const rows = [
    줄(묶음(page, "다른 인스턴스"), 이름(남의zsh)),
    줄(묶음(page, "예외"), 이름(tmux)),
    셸트리(page).getByRole("treeitem").first(),
  ];
  for (const row of rows) await row.click({ button: "right", position: { x: 6, y: 6 } });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { 막힘: boolean[] }).막힘))
    .toEqual(rows.map(() => true));
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
