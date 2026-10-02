import type { Settings } from "@/features/settings/types";
import { terminalSettings } from "@/features/settings/settings-fixture";
import { expect, test, type Locator, type Page } from "./evidence";
import { ARCHIVE, PROJECTS } from "./fixtures";
import { installFixtureBackend, SPEC_LAYOUT_EDITOR, unknownIpcCalls, 툴팁 } from "./harness";

// 판 04 티켓 01 — 공용 틀(`Frame`, ui-refresh 결정 4 · 5 · 27). 탭이 없거나 패널이 없는 화면이 옅은 회색 바탕 위의 둥근
// 카드로 뜨고, 바탕 줄(`<header>`)은 그 위 44px에 선다.
//
// **이 층에서만 보이는 것이다**: 카드 상자의 실제 자리와, 그 둘레에 드러난 회색 틈을 누르면 **무엇이 눌리는가**.
// Tauri는 누른 요소 **자신**의 `data-tauri-drag-region`만 본다 — 조상에 있는 속성은 Tauri에게 없는 것이라
// `elementFromPoint`가 돌려준 요소 자신을 잰다(`tab-keys.spec.ts`의 같은 재기). 틈을 드러내는 상자 하나만 속성을
// 빠뜨려도 그 틈이 창을 못 끄는 죽은 자리가 되는데, 화면으로는 어느 상자가 빠졌는지가 안 보인다.

const SCREENS = [
  { name: "Terminal", url: "/terminal" },
  { name: "Processes", url: "/processes" },
  { name: "Settings", url: "/settings/terminal" },
  { name: "레이아웃 편집기", url: SPEC_LAYOUT_EDITOR },
] as const;

/** 그 점에서 눌리는 요소 **자신**이 창을 끄는 자리인가. 점 아래에 요소가 없으면 `null`이다(창 밖). */
const draggable = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => document.elementFromPoint(px, py)?.hasAttribute("data-tauri-drag-region") ?? null,
    [x, y],
  );

/**
 * 앱이 쓰는 배치 변수 하나의 값(px). 숫자를 여기 적지 않는다 — 토큰이 바뀌면 이 검사가 거짓 빨강을 낸다. 셸의 뿌리
 * (`[data-titlebar]`)에서 읽는다 — 신호등 inset 묶음(`--tab-lead` 등)은 `:root`가 아니라 거기 선다.
 */
const token = (page: Page, name: string) =>
  page.evaluate(
    (one) => parseFloat(getComputedStyle(document.querySelector("[data-titlebar]")!).getPropertyValue(one)),
    name,
  );

/** 본문 카드(`<main>`)의 상자. 사이드바가 접히고 펴지는 220ms 동안의 값은 곧 낡으므로 부르는 쪽이 기다린다. */
async function cardOf(page: Page) {
  const box = await page.locator("main").boundingBox();
  if (!box) throw new Error("본문 카드의 상자를 못 읽었다");
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

for (const screen of SCREENS) {
  test(`${screen.name}: 본문이 바탕 위의 카드이고, 그 둘레의 회색 틈이 창을 끄는 자리다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(screen.url);
    await expect(page.locator("main")).toHaveCount(1);

    // 머리는 바탕 줄 하나이고(ui-refresh 결정 5 — `PageHeader`의 44px 머리가 카드 안에 따로 서지 않는다), `aside`는 사이드바뿐이다.
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("aside")).toHaveCount(1);

    const gap = await token(page, "--gap");
    const titlebar = await token(page, "--titlebar-height");
    const viewport = page.viewportSize()!;
    const card = await cardOf(page);
    // 앵커: 카드는 바탕 줄 바로 아래에서 시작하고 오른쪽 · 아래에 틈을 남긴다. 틈이 없으면 아래 두 점이 창 밖이나
    // 카드 위에 떨어져 무엇을 재는지가 흐려진다.
    expect(card.y, "카드가 바탕 줄 바로 아래에서 시작한다").toBe(titlebar);
    expect(viewport.width - card.right, "카드 오른쪽 틈").toBe(gap);
    expect(viewport.height - card.bottom, "카드 아래 틈").toBe(gap);

    const middleY = card.y + card.height / 2;
    expect(await draggable(page, card.right + gap / 2, middleY), "카드 오른쪽 틈").toBe(true);
    expect(await draggable(page, card.x + card.width / 2, card.bottom + gap / 2), "카드 아래 틈").toBe(true);
    // 대조: 카드 안은 끄는 자리가 아니다 — 바탕 전체가 끌기 영역이 된 것과 가른다.
    expect(await draggable(page, card.x + card.width / 2, middleY), "카드 안").toBe(false);

    // ⌘B로 사이드바를 접으면 카드가 왼쪽 틈까지 넓어지고, 그 틈도 끄는 자리다.
    await page.keyboard.press("Meta+b");
    await expect.poll(async () => (await cardOf(page)).x).toBe(gap);
    expect(await draggable(page, gap / 2, middleY), "사이드바를 접은 뒤의 왼쪽 틈").toBe(true);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

test("Terminal: 사이드바를 접어도 탭 줄의 첫 칸이 셸 컨트롤 뒤 `--tab-lead`에 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  const firstTab = page.locator('[data-tab="shell"]').first();
  await firstTab.waitFor();

  await page.keyboard.press("Meta+b");
  const lead = await token(page, "--tab-lead");
  // 셸 컨트롤의 마지막 칸이 검색이다. 그 오른쪽 끝에서 첫 칸까지가 `--tab-lead` — 사이드바가 열렸을 때 사이드바 끝에서
  // 재는 거리와 같은 값이다(index.css의 `[data-titlebar]`). 셸 컨트롤은 220ms 동안 옆으로 흐르므로 멈출 때까지 잰다.
  await expect
    .poll(async () => {
      const search = await page.getByRole("button", { name: "검색", exact: true }).boundingBox();
      const tab = await firstTab.boundingBox();
      return search && tab ? Math.round((tab.x - (search.x + search.width)) * 100) / 100 : null;
    })
    .toBe(lead);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 기본값 판 04 줄 — **터미널 카드의 바탕은 터미널 테마를 따른다.** 설정이 밝게면 흰 카드, 어둡게면 셸의 어두운 바탕이다.
// 카드의 둥근 모서리 안쪽 여백(`--term-inset`) 띠도 그 색이라 셸 화면과 카드 사이에 다른 색의 띠가 안 보인다.
for (const theme of ["light", "dark"] as const) {
  test(`Terminal: 테마가 ${theme}면 터미널 카드와 그 안쪽 여백 띠가 셸의 바탕색이다`, async ({ page }) => {
    await installFixtureBackend(page, {
      read_settings: { terminal: terminalSettings({ theme }) } satisfies Settings,
    });
    await page.goto("/terminal");
    await expect(page.locator(".xterm-screen")).toBeVisible();

    const inset = await token(page, "--term-inset");
    const colors = await page.evaluate((band) => {
      // 그 점에 **실제로 칠해진** 색 — 투명한 조상을 건너뛰며 올라간다(`terminal-fill.spec.ts`의 같은 재기).
      const painted = (x: number, y: number): string | null => {
        let node: Element | null = document.elementFromPoint(x, y);
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg && bg !== "transparent" && !/^rgba\(0, 0, 0, 0\)$/.test(bg)) return bg;
          node = node.parentElement;
        }
        return null;
      };
      const card = document.querySelector("main")!;
      const box = card.getBoundingClientRect();
      return {
        shell: getComputedStyle(document.querySelector(".xterm")!).backgroundColor,
        card: getComputedStyle(card).backgroundColor,
        band: painted(box.left + band / 2, box.top + box.height / 2),
      };
    }, inset);
    // 앵커: 두 테마가 정말 다른 색으로 칠해졌는가 — 같으면 아래 비교는 테마를 안 보고도 초록이다.
    expect(colors.shell).toBe(theme === "light" ? "rgb(255, 255, 255)" : "rgb(30, 30, 30)");
    expect(colors.card, "카드 바탕").toBe(colors.shell);
    expect(colors.band, "카드 안쪽 여백 띠").toBe(colors.shell);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 판 04 티켓 02 — **목록이 있는 두 화면**(ui-refresh 결정 15 — 칸 하나 = 카드 하나). 목록과 상세가 따로 카드이고 사이 틈은
// `--gap`이다. 틈은 목록 칸의 바깥 상자(카드 + 오른쪽 틈)가 들어, 목록을 닫으면 폭과 함께 0으로 접힌다 — 닫힌 칸 옆에 틈이
// 겹쳐 남지 않는다. 폭 손잡이는 그 틈의 가운데에 서고, 저장하는 폭은 **카드의 폭**이다(틈은 더하지 않는다).
const LIST_SCREENS = [
  {
    name: "Projects",
    url: `/projects/${PROJECTS[0].slug}`,
    list: "프로젝트 목록",
    widthKey: "panel-width",
    // 목록 카드 머리에 서는 것 — 검색칸과 `+`(이름 「프로젝트 등록」).
    headControls: (page: Page) => [
      page.getByRole("textbox", { name: "프로젝트 검색", exact: true }),
      page.getByRole("button", { name: "프로젝트 등록", exact: true }),
    ],
  },
  {
    name: "Archive",
    url: `/archive/${ARCHIVE[0].slug}`,
    list: "아카이브 목록",
    widthKey: "archive-panel-width",
    // 머리의 검색칸과 그 아래 첫 줄의 정렬 — 정렬은 늘 글자 「치운 날」과 함께 선다(이름이 그 글자다).
    headControls: (page: Page) => [
      page.getByRole("textbox", { name: "아카이브 검색", exact: true }),
      page.getByRole("button", { name: "치운 날", exact: true }),
    ],
  },
] as const;

const HANDLE = '[title="드래그로 폭 조절 · 더블클릭으로 기본 폭"]';
/** 목록 칸의 폭 손잡이 — 사이드바의 손잡이(`aside` 안)와 가른다. */
const listHandle = (page: Page) => page.locator(`${HANDLE}:not(aside ${HANDLE})`);

async function boxOf(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("상자를 못 읽었다");
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

const sidebarRight = (page: Page) => page.locator("aside").evaluate((el) => el.getBoundingClientRect().right);

for (const screen of LIST_SCREENS) {
  test(`${screen.name}: 목록과 상세가 각자 카드이고 사이 틈이 --gap이다 — 목록을 닫으면 상세가 사이드바 쪽 끝까지 넓어진다`, async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(screen.url);
    const list = page.getByRole("region", { name: screen.list, exact: true });
    const main = page.locator("main");
    await expect(list).toBeVisible();

    // 목록 카드는 `section`이다 — `aside`는 사이드바 하나뿐이고(`works-sidebar`), `header`는 바탕 줄 하나다.
    expect(await list.evaluate((el) => el.tagName)).toBe("SECTION");
    await expect(page.locator("aside")).toHaveCount(1);
    await expect(page.locator("header")).toHaveCount(1);

    const gap = await token(page, "--gap");
    const titlebar = await token(page, "--titlebar-height");
    const edge = await sidebarRight(page);
    const [card, detail] = [await boxOf(list), await boxOf(main)];
    // 두 카드가 바탕 줄 바로 아래에서 시작하고, 사이드바가 열렸으면 목록 카드가 사이드바에 붙는다(왼쪽 틈 0).
    expect(card.y, "목록 카드 위").toBe(titlebar);
    expect(detail.y, "상세 카드 위").toBe(titlebar);
    expect(card.x, "목록 카드 왼쪽").toBe(edge);
    expect(detail.x - card.right, "목록과 상세 사이 틈").toBe(gap);

    // 손잡이는 그 틈의 가운데다 — 카드 모서리 위가 아니다.
    const handle = await boxOf(listHandle(page));
    expect(handle.x + handle.width / 2, "손잡이 가운데").toBe(card.right + gap / 2);
    // 손잡이 옆에 드러난 틈은 창을 끄는 자리이고, 카드 안은 아니다. 손잡이(5px)가 틈(8px)의 가운데라 드러난 띠는 양쪽 1.5px씩이다 —
    // 카드 모서리 바로 옆을 짚는다(손잡이 쪽 경계는 서브픽셀이라 짚는 자리가 반올림에 걸린다).
    const middleY = card.y + card.height / 2;
    expect(await draggable(page, card.right + 0.5, middleY), "목록 카드 오른쪽 틈").toBe(true);
    expect(await draggable(page, card.x + card.width / 2, middleY), "목록 카드 안").toBe(false);

    // 목록 토글(ui-refresh 결정 15) — 열렸으면 접는 그림(`Minimize2`)이고, 도움말이 누르면 될 일을 말한다.
    const toggle = page.getByRole("button", { name: "목록 패널 토글", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle.locator("svg")).toHaveClass(/lucide-minimize-2/);
    await toggle.focus();
    await expect(툴팁(page)).toHaveText("목록 패널 접기");
    await toggle.blur();

    // ⌘Enter로 닫으면 상세가 사이드바 쪽 끝까지 넓어진다 — 접힌 칸 옆에 틈이 겹쳐 남지 않는다.
    await page.keyboard.press("Meta+Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle.locator("svg")).toHaveClass(/lucide-maximize-2/);
    await expect.poll(async () => (await boxOf(main)).x).toBe(edge);
    await toggle.focus();
    await expect(툴팁(page)).toHaveText("목록 패널 펼치기");

    // 토글을 누르면 다시 선다.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => (await boxOf(main)).x).toBe(card.right + gap);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${screen.name}: 사이드바를 ⌘B로 접어도 목록 카드 머리의 조작이 카드 안 같은 자리다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(screen.url);
    const list = page.getByRole("region", { name: screen.list, exact: true });
    await expect(list).toBeVisible();

    /** 조작마다 목록 카드 왼쪽 위에서 잰 자리. */
    const offsets = async () => {
      const card = await boxOf(list);
      return Promise.all(
        screen.headControls(page).map(async (control) => {
          const box = await boxOf(control);
          return { x: box.x - card.x, y: box.y - card.y };
        }),
      );
    };
    const before = await offsets();

    // 신호등을 피할 일은 바탕 줄 하나의 몫이다 — 카드 머리에는 그것을 피하는 여백 갈래가 없다. 카드는 창 왼쪽 틈까지 옮겨 가고,
    // 그 안의 조작은 카드 안에서 같은 자리다.
    await page.keyboard.press("Meta+b");
    const gap = await token(page, "--gap");
    await expect.poll(async () => (await boxOf(list)).x).toBe(gap);
    await expect.poll(offsets).toEqual(before);
    for (const control of screen.headControls(page)) await expect(control).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${screen.name}: 목록 폭을 끌어 바꾸면 카드의 폭이 저장되고 다시 열 때 그 폭이다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(screen.url);
    const list = page.getByRole("region", { name: screen.list, exact: true });
    await expect(list).toBeVisible();
    const start = (await boxOf(list)).width;

    const handle = await boxOf(listHandle(page));
    const y = handle.y + handle.height / 2;
    await page.mouse.move(handle.x + handle.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 40, y, { steps: 5 });
    await page.mouse.up();

    await expect.poll(async () => (await boxOf(list)).width).toBe(start + 40);
    expect(await page.evaluate((key) => localStorage.getItem(key), screen.widthKey)).toBe(String(start + 40));

    await page.reload();
    await expect(list).toBeVisible();
    await expect.poll(async () => (await boxOf(list)).width).toBe(start + 40);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}
