import type { Settings } from "@/features/settings/types";
import { terminalSettings } from "@/features/settings/settings-fixture";
import { expect, test, type Page } from "./evidence";
import { installFixtureBackend, SPEC_LAYOUT_EDITOR, unknownIpcCalls } from "./harness";

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
