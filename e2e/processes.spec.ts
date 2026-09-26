import { expect, test, type Page } from "./evidence";
import { MAISON_LANDING_ROOM, NO_METRICS, PROCESS_SNAPSHOT, PROJECTS } from "./fixtures";
import { callCount, installFixtureBackend, unknownIpcCalls } from "./harness";
import type { ProcessSnapshot } from "@/features/processes/types";

// 프로세스 티켓 26 — **`Processes`가 두 세계 nav에 서고, 열려 있을 때만 스냅샷을 묻는다**(프로세스 결정 8 · 9 · 10, 스토리 79 ·
// 80 · 95). nav 배열과 라우트 표의 자리는 L2가 값으로 잰다(`mode.test.ts` · `router.test.ts`). 여기서 보는 것은 그 표가 **진짜 사이드바와
// 진짜 라우터**를 지나 화면이 서는가, 스냅샷이 화면까지 오는가, 그리고 떠나면 묻기가 멈추는가다 — 마지막은 진짜 타이머와
// 진짜 언마운트가 있어야 드러난다.
//
// **시계는 `page.clock`이다.** 주의 둘(`shell-orphans.spec.ts` 머리말): `install()`은 페이지를 열기 **전에** 부르고, 깐 뒤로 시간은
// 저절로 흐르므로 세기 전에 멈춘다(`pauseAt`). 그 뒤로는 `runFor`만큼만 간다 — 2초 박자가 러너 속도에 안 흐려진다.

const [project] = PROJECTS;

/** 사이드바 nav의 항목들. 버튼 글자는 라벨뿐이다 — 메타(셸 수)는 버튼 밖에 선다(`SidebarItem`). */
const navButtons = (page: Page) => page.locator("aside nav").getByRole("button");
const navButton = (page: Page, label: string) =>
  page.locator("aside nav").getByRole("button", { name: label, exact: true });
const modeButton = (page: Page, label: string) =>
  page.getByRole("group", { name: "모드 선택" }).getByRole("button", { name: label, exact: true });
/** 화면의 제목 — 머리의 글자는 제목 역할이 없어(`PageHeader`) 제목 역할은 따로 선다. */
const title = (page: Page) => page.getByRole("heading", { name: "Processes", exact: true });
/**
 * 요약 카드의 셸 수. **카드 안에서 찾는다** — 스토어가 모르는 풀의 셸은 두 박자 뒤 「화면 밖 셸」 묶음에 서고(티켓 32) 그 머리도
 * 「셸 N개」라, 화면 전체에서 찾으면 같은 글자가 둘이다.
 */
const shellCount = (page: Page, count: number) =>
  page.getByRole("region", { name: "요약", exact: true }).getByText(`셸 ${count}개`, { exact: true });

/**
 * 풀에 셸이 `keys`만큼 선 스냅샷. **두 세계의 셸을 섞는다** — 화면은 앱 전체를 보이므로(프로세스 결정 9) 어느 세계의 주소로
 * 열든 같은 수가 서야 한다. 셸 키의 세대는 픽스처의 것이 아니다: 이 검사는 스토어의 셸과 잇지 않는다(27의 몫).
 */
const withPool = (...keys: string[]): ProcessSnapshot => ({
  ...PROCESS_SNAPSHOT,
  pool: keys.map((shellKey, at) => ({ ptyId: at + 1, shellKey, lastOutputMs: 1_758_000_000_000, metrics: NO_METRICS })),
});

test("Processes가 두 세계의 nav에서 Terminal 다음, Archive 앞에 서고, 누르면 그 세계의 주소로 같은 화면이 열린다", async ({
  page,
}) => {
  await installFixtureBackend(page, { processes_snapshot: withPool("P-1", "P-2", "P-3") });
  await page.goto("/projects");
  await expect(page).toHaveURL(`/projects/${project.slug}`);

  // **순서까지 본다**(프로세스 스펙 S43) — 「있다」만 재면 끝에 붙여도 초록이다.
  await expect(navButtons(page)).toHaveText(["Projects", "Terminal", "Processes", "Archive"]);
  await navButton(page, "Processes").click();
  await expect(page).toHaveURL("/processes");
  await expect(title(page)).toBeVisible();
  await expect(shellCount(page, 3)).toBeVisible();

  // 저쪽 세계에서도 선다. 세계마다 nav 배열이 따로라(`MAISON_NAV`) 한쪽에만 더하면 다른 쪽에서 빠진다.
  await modeButton(page, "Maison").click();
  await expect(page).toHaveURL(`/maison/rooms/${MAISON_LANDING_ROOM.slug}`);
  await expect(navButtons(page)).toHaveText(["Terminal", "Processes", "Archive"]);
  // **각 세계의 nav는 자기 접두사로 간다**(프로세스 결정 9) — 눌러도 세계를 안 떠난다.
  await navButton(page, "Processes").click();
  await expect(page).toHaveURL("/maison/processes");
  await expect(modeButton(page, "Maison")).toHaveAttribute("aria-pressed", "true");
  // **같은 화면이다** — 제목도, 앱 전체의 셸 수도 같다. 세계로 나누면 절반이 안 보인다.
  await expect(title(page)).toBeVisible();
  await expect(shellCount(page, 3)).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스냅샷이 화면까지 오는 길의 앵커 — 기본 픽스처(풀이 빈 앱)가 아니라 **이 시나리오의 풀**이 선다. 주소로 곧바로 들어와도 선다.
test("fixture 스냅샷에 실린 풀의 셸 수가 화면에 선다", async ({ page }) => {
  await installFixtureBackend(page, { processes_snapshot: withPool("P-1", "P-2", "M-7", "M-8", "Q-1") });
  await page.goto("/maison/processes");
  await expect(title(page)).toBeVisible();
  await expect(shellCount(page, 5)).toBeVisible();
  await expect(shellCount(page, 0)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스토리 95 — **화면이 닫혀 있을 때는 무거운 수집을 안 한다.** 스냅샷 한 장은 이 맥의 프로세스 표 전체와 판정이다.
test("화면에 있는 동안은 2초마다 스냅샷을 묻고, 화면을 떠나면 멈춘다", async ({ page }) => {
  await page.clock.install();
  await installFixtureBackend(page, { processes_snapshot: withPool("P-1", "P-2") });
  await page.goto("/processes");
  await expect(shellCount(page, 2)).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));

  // 앵커: 화면에 있는 동안은 는다 — **2초에 한 번**. 멈춘 것이 시계가 안 돌아서가 아니다.
  const opened = await callCount(page, "processes_snapshot");
  await page.clock.runFor(6_000);
  expect(await callCount(page, "processes_snapshot")).toBe(opened + 3);

  await navButton(page, "Terminal").click();
  await expect(page).toHaveURL("/terminal");
  await expect(title(page)).toHaveCount(0);
  const left = await callCount(page, "processes_snapshot");
  await page.clock.runFor(10_000);
  expect(await callCount(page, "processes_snapshot")).toBe(left);

  // 앵커: 돌아오면 다시 묻는다 — 멈춘 것은 화면이 떠나서다.
  await navButton(page, "Processes").click();
  await expect(title(page)).toBeVisible();
  await page.clock.runFor(2_000);
  expect(await callCount(page, "processes_snapshot")).toBeGreaterThan(left);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
