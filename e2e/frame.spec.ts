import type { Settings } from "@/features/settings/types";
import { terminalSettings } from "@/features/settings/settings-fixture";
import { expect, test, type Locator, type Page } from "./evidence";
import { ARCHIVE, PROJECTS, WORKS } from "./fixtures";
import {
  clipboardWrites,
  installFixtureBackend,
  recordClipboard,
  SPEC_LAYOUT_EDITOR,
  startSplitDrag,
  unknownIpcCalls,
  레인,
  시계를세운다,
  토큰색,
  툴팁,
} from "./harness";

// 판 04 티켓 01 — 공용 틀(`Frame`, ui-refresh 결정 4 · 5 · 27). 탭이 없거나 패널이 없는 화면이 옅은 회색 바탕 위의 둥근
// 카드로 뜨고, 바탕 줄(`<header>`)은 그 위 44px에 선다.
//
// **이 층에서만 보이는 것이다**: 카드 상자의 실제 자리와, 그 둘레에 드러난 회색 틈을 누르면 **무엇이 눌리는가**.
// Tauri는 누른 요소 **자신**의 `data-tauri-drag-region`만 본다 — 조상에 있는 속성은 Tauri에게 없는 것이라
// `elementFromPoint`가 돌려준 요소 자신을 잰다. 틈을 드러내는 상자 하나만 속성을 빠뜨려도 그 틈이 창을 못 끄는
// 죽은 자리가 되는데, 화면으로는 어느 상자가 빠졌는지가 안 보인다.

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

    // 머리는 바탕 줄 하나이고(ui-refresh 결정 5 — 옛 브레드크럼 머리의 44px 층이 카드 위에 따로 서지 않는다), `aside`는 사이드바뿐이다.
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("aside")).toHaveCount(1);

    const gap = await token(page, "--gap");
    const titlebar = await token(page, "--titlebar-height");
    const viewport = page.viewportSize()!;
    const card = await cardOf(page);
    // 카드 줄의 오른쪽 끝 카드 — 편집기는 본문 카드 오른쪽에 트리 카드가 서고(판 06 티켓 07), 다른 세 화면은 본문 카드다.
    const last = await boxOf(page.locator('[data-slot="card"]').last());
    // 앵커: 카드는 바탕 줄 바로 아래에서 시작하고 오른쪽 · 아래에 틈을 남긴다. 틈이 없으면 아래 두 점이 창 밖이나
    // 카드 위에 떨어져 무엇을 재는지가 흐려진다.
    expect(card.y, "카드가 바탕 줄 바로 아래에서 시작한다").toBe(titlebar);
    expect(viewport.width - last.right, "카드 오른쪽 틈").toBe(gap);
    expect(viewport.height - card.bottom, "카드 아래 틈").toBe(gap);

    const middleY = card.y + card.height / 2;
    expect(await draggable(page, last.right + gap / 2, middleY), "카드 오른쪽 틈").toBe(true);
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

// 판 06 티켓 07 — **레이아웃 편집기의 트리는 본문 카드 오른쪽의 카드다.** 작업 화면의 spec 패널과 같은 쪽 · 같은 폭(작업 패널의
// 기본 폭 330)이고, 둘 사이는 `--gap`이다. 트리 카드는 레일 · 접힘 · 손잡이가 없는 늘 열린 `section`이다 — `aside`는 사이드바
// 하나뿐이다(판 06 「지키는 것」). 트리 위 도구 줄(「항목 편집」)은 그 카드의 머리에 선다.
test("레이아웃 편집기: 트리가 본문 카드 오른쪽의 330 카드이고 머리에 도구가 서며, 둘 사이 틈이 창을 끄는 자리다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(SPEC_LAYOUT_EDITOR);
  const tree = page.getByRole("region", { name: "항목 트리", exact: true });
  const main = page.locator("main");
  await expect(tree.getByRole("treeitem", { name: "overview.md", exact: true })).toBeVisible();

  // 트리 카드는 본문 카드(`main`) 밖의 `section` 카드다.
  expect(await tree.evaluate((el) => [el.tagName, el.getAttribute("data-slot")])).toEqual(["SECTION", "card"]);
  await expect(main.getByRole("region", { name: "항목 트리", exact: true })).toHaveCount(0);
  await expect(page.locator("aside")).toHaveCount(1);
  await expect(page.locator("header")).toHaveCount(1);
  // 도구 줄은 트리 카드의 머리다 — 머리 `spec/`과 트리는 그 아래 몸이다.
  await expect(
    tree.locator('[data-slot="card-head"]').getByRole("toolbar", { name: "항목 편집", exact: true }),
  ).toBeVisible();
  // 폼(「고른 항목」)은 본문 카드 안이다.
  await expect(main.getByRole("region", { name: "고른 항목", exact: true })).toBeVisible();

  const gap = await token(page, "--gap");
  const titlebar = await token(page, "--titlebar-height");
  const viewport = page.viewportSize()!;
  const [form, card] = [await boxOf(main), await boxOf(tree)];
  expect(card.width, "트리 카드 폭").toBe(330);
  expect(card.y, "트리 카드 위").toBe(titlebar);
  expect(card.bottom, "트리 카드 아래").toBe(form.bottom);
  expect(card.x - form.right, "본문 카드와 트리 카드 사이 틈").toBe(gap);
  expect(viewport.width - card.right, "트리 카드 오른쪽 틈").toBe(gap);

  // 둘 사이 틈은 창을 끄는 자리이고, 트리 카드 안은 아니다.
  const middleY = card.y + card.height / 2;
  expect(await draggable(page, form.right + gap / 2, middleY), "두 카드 사이 틈").toBe(true);
  expect(await draggable(page, card.x + card.width / 2, middleY), "트리 카드 안").toBe(false);

  // ⌘B로 사이드바를 접어도 트리 카드는 330 그대로이고, 넓어지는 것은 본문 카드다.
  await page.keyboard.press("Meta+b");
  await expect.poll(async () => (await boxOf(main)).x).toBe(gap);
  expect((await boxOf(tree)).width, "사이드바를 접은 뒤의 트리 카드 폭").toBe(330);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 앱의 최소 창(900 — `tauri.conf.json`)에서 사이드바를 연 채로도 두 카드 머리의 조작이 카드 안에 다 선다. 트리 카드가 330을
// 고집하면 폼 카드가 머리의 조작(뒤로 · 「LLM이 받는 텍스트」 · 「저장」)보다 좁아진다 — 카드가 모서리 밖을 자르므로
// (`overflow-hidden`) 넘친 「저장」이 반쯤 잘린다. 그래서 그 폭에서만 트리 카드가 폼 카드에 자리를 내준다(작업 패널 칸과 같은 손버릇).
//
// **두 머리의 폭은 수로 정해져 있지 않다** — 글자가 시스템 글꼴이라 OS마다 다르다(macOS SF Pro · 리눅스 PR 게이트의 제 글꼴). 그래서
// 폼 카드의 바닥이 제 머리의 폭이고, 두 머리가 창에 안 들면 사이드바가 자리를 내준다(`Frame`의 `BesideBox`). 이 검사는 어느 글꼴에서나
// 같은 관계를 잰다: 조작이 카드 안이고, 트리 카드도 창 안이다 — 창 밖으로 밀린 카드의 조작은 「카드 안」이어도 안 보인다.
test("레이아웃 편집기: 최소 창에서 사이드바를 연 채로도 두 카드 머리의 조작이 카드 안에 다 선다", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await installFixtureBackend(page);
  await page.goto(SPEC_LAYOUT_EDITOR);
  const tree = page.getByRole("region", { name: "항목 트리", exact: true });
  const main = page.locator("main");
  await expect(tree.getByRole("treeitem", { name: "overview.md", exact: true })).toBeVisible();
  // 앵커: 사이드바가 열려 있다 — 접혀 있으면 폼 카드가 넉넉해 아래 셈이 아무것도 재지 않는다.
  expect((await boxOf(main)).x, "본문 카드가 사이드바 옆에 선다").toBe(await sidebarRight(page));

  const inside = async (control: Locator, card: Locator) => {
    const [box, edge] = [await boxOf(control), await boxOf(card)];
    return box.x >= edge.x && box.right <= edge.right;
  };
  expect(await inside(page.getByRole("button", { name: "설정으로 돌아가기", exact: true }), main), "뒤로").toBe(true);
  expect(await inside(page.getByRole("button", { name: "LLM이 받는 텍스트", exact: true }), main), "미리보기").toBe(true);
  expect(await inside(page.getByRole("button", { name: "저장", exact: true }), main), "저장").toBe(true);
  expect(await inside(page.getByRole("button", { name: "파일 항목 추가", exact: true }), tree), "파일").toBe(true);
  expect(await inside(page.getByRole("button", { name: "고른 항목 지우기", exact: true }), tree), "지우기").toBe(true);
  const edge = page.viewportSize()!.width - (await token(page, "--gap"));
  expect((await boxOf(tree)).right, "트리 카드가 창 안").toBeLessThanOrEqual(edge);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

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
    // 셸의 바탕은 DS 터미널 낱말 `term-bg`다 — 밝게는 라이트 값(카드 면), 어둡게는 DS 다크 값이다. 앱은 `.dark`를
    // 켜지 않으므로 다크 값은 `.dark` 상자 안에서 읽는다(`토큰색`).
    // 앵커: 두 테마가 정말 다른 색이다 — 같으면 아래 비교는 테마를 안 보고도 초록이다.
    const [밝게, 어둡게] = [await 토큰색(page, "--term-bg"), await 토큰색(page, "--term-bg", { 다크: true })];
    expect(밝게, "term-bg의 라이트와 다크가 같다").not.toBe(어둡게);
    expect(colors.shell).toBe(theme === "light" ? 밝게 : 어둡게);
    expect(colors.card, "카드 바탕").toBe(colors.shell);
    expect(colors.band, "카드 안쪽 여백 띠").toBe(colors.shell);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// codex-ds 티켓 01 — **앱이 Codex 색을 입는다**(codex-ds 결정 27). 창 바탕 · 카드 · 본문 글자를 칠해진 색(computed
// style)으로 읽어 토큰(CSS 변수)과 맞댄다 — 바탕은 `surface-shell`, 카드는 `surface`, 본문 글자는 `fg`다. 다크는 앱이 켜지
// 않지만(codex-ds 결정 17) `.dark`를 켜면 같은 자리가 DS 다크 값이어야 한다 — 그 팔레트의 정본이 `index.css`의 `.dark`다.
//
// 바탕은 **카드 오른쪽 틈에 실제로 칠해진 색**으로 읽는다 — 틈의 상자들은 투명하고 공용 틀의 뿌리가 바탕을 칠한다.
test("창 바탕은 surface-shell, 카드는 surface, 본문 글자는 fg다 — .dark를 켜면 같은 자리가 DS 다크 값이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/processes");
  await expect(page.locator("main")).toHaveCount(1);

  const gap = await token(page, "--gap");
  const 칠한색 = () =>
    page.evaluate((band) => {
      const painted = (x: number, y: number): string | null => {
        for (let node = document.elementFromPoint(x, y); node; node = node.parentElement) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
        }
        return null;
      };
      const card = document.querySelector("main")!;
      const box = card.getBoundingClientRect();
      return {
        바탕: painted(box.right + band / 2, box.top + box.height / 2),
        카드: getComputedStyle(card).backgroundColor,
        글자: getComputedStyle(card).color,
      };
    }, gap);
  const 토큰셋 = async () => ({
    바탕: await 토큰색(page, "--surface-shell"),
    카드: await 토큰색(page, "--surface"),
    글자: await 토큰색(page, "--fg"),
  });

  const 라이트 = await 칠한색();
  expect(라이트).toEqual(await 토큰셋());

  // 다크 팔레트를 켜고 색의 전환이 끝날 때까지 기다린다 — 전환 도중의 중간값을 재지 않게(`works-sidebar.spec.ts`의
  // `팔레트`와 같은 까닭).
  await page.evaluate(async () => {
    document.documentElement.classList.add("dark");
    await Promise.all(
      document
        .getAnimations()
        .filter((one) => one.effect?.getComputedTiming().iterations !== Infinity)
        .map((one) => one.finished),
    );
  });
  const 다크 = await 칠한색();
  // **팔레트가 정말 바뀌었는지를 먼저 센다** — `.dark`가 안 먹으면 아래가 라이트 값을 다시 재고, 토큰도 라이트로 풀려
  // 조용히 초록이 된다.
  for (const 자리 of ["바탕", "카드", "글자"] as const) {
    expect(다크[자리], `다크 · ${자리} — 라이트 색이 그대로다`).not.toBe(라이트[자리]);
  }
  expect(다크).toEqual(await 토큰셋());
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **CSS 변수 `--accent`는 Codex 파랑이지만 메뉴의 켜진 줄은 옅은 면(`fill-hover`)이다**(`index.css`의 `--color-accent`).
// registry는 그 줄을 shadcn `accent`(옅은 면)로 칠했고 부품은 그 면을 Codex 이름(`focus:bg-fill-hover`)으로 옮겨 적었다 —
// 이름이 겹치는 `accent`가 파랑으로 새지 않았는지를 화면에서 잰다. 상태 메뉴를 키보드로 열어 첫 줄을 켠다.
test("메뉴의 켜진 줄은 옅은 면(fill-hover)이고 파랑(accent)이 아니다", async ({ page }) => {
  const [work] = WORKS;
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}`);
  const badge = page.getByRole("button", { name: work.status, exact: true });
  await badge.focus();
  await page.keyboard.press("ArrowDown");
  const first = page.getByRole("menu").getByRole("menuitemradio").first();
  await expect(first).toBeFocused();

  const [옅은면, 파랑] = [await 토큰색(page, "--fill-hover"), await 토큰색(page, "--accent")];
  await expect.poll(() => first.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(옅은면);
  expect(옅은면, "fill-hover와 accent가 같은 색이다").not.toBe(파랑);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 티켓 06 — **상태 넷이 Atelier 낱말 색을 입는다**(codex-ds 스펙 2절 「Atelier 낱말」 · DS `st-*`). 상태 표
// (`status.tsx`의 `STATUS_META` · `StatusIcon`)가 칠하는 세 자리 — 머리의 상태 배지 글자, 그 배지가 여는 상태 메뉴의 점,
// 사이드바 행 레인의 상태 아이콘 — 를 칠해진 색으로 읽어 그 상태의 토큰(`st-draft` · `st-active` · `st-review` ·
// `st-done`)과 맞댄다.
//
// **상태마다 하나씩 잰다.** 상태 하나만 재면 표의 네 줄이 한 색으로 무너져도(한 줄을 베껴 넷에 붙이면) 초록이다.
// 픽스처 목록은 상태를 기억하지 않으므로(`set_work_status`의 답 — `fixtures.ts`) 목록을 덮어 그 상태의 work로 연다.
for (const status of ["draft", "active", "review", "done"] as const) {
  test(`상태 ${status}: 배지 글자 · 상태 메뉴의 점 · 행 레인의 상태 아이콘이 st-${status}다`, async ({ page }) => {
    const work = { ...WORKS[1], status };
    await installFixtureBackend(page, {
      list_works: WORKS.map((one) => (one.slug === work.slug ? work : one)),
    });
    await page.goto(`/works/${work.slug}`);
    const 색 = await 토큰색(page, `--st-${status}`);

    const badge = page.getByRole("button", { name: status, exact: true });
    await expect(badge).toHaveCSS("color", 색);
    // 셸이 부르지 않는 행이라 레인에는 상태 아이콘이 선다(부르면 그 자리를 부름의 점이 갖는다 — `works-sidebar.spec.ts`).
    await expect(레인(page, work.slug).locator("svg")).toHaveCSS("color", 색);

    await badge.click();
    // 줄의 첫 자식이 점이다(`WorksPage.tsx`의 `StatusMenu`) — 줄 끝의 체크는 부품이 뒤에 붙인다.
    const 줄 = page.getByRole("menu").getByRole("menuitemradio", { name: new RegExp(`^${status}\\b`) });
    await expect(줄.locator(":scope > span").first()).toHaveCSS("background-color", 색);
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

// 판 04 티켓 03 — **작업 화면**(ui-refresh 결정 4 · 5 · 15). 바탕 줄 아래에 문서 카드(`<main>`)와 작업 패널 카드가 각자 뜨고, 사이
// 틈은 `--gap`이다. 패널의 바깥 상자는 여전히 두 번째 `aside`이고 폭이 「왼쪽 틈 + 카드」라, 접으면 틈이 카드와 함께 0으로 접혀
// 문서 카드가 오른쪽 틈 끝까지 넓어진다. 폭 손잡이는 그 틈의 가운데다(목록 칸과 같은 자리).
const [pinnedWork, plainWork] = WORKS;
const 작업패널 = (page: Page) => page.getByRole("region", { name: "작업 패널", exact: true });

test("Works: 바탕 줄 아래에 문서 카드와 작업 패널 카드가 틈 --gap으로 서고, 패널을 접으면 문서 카드가 오른쪽 틈 끝까지 넓어진다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const doc = page.locator("main");
  const panel = 작업패널(page);
  await expect(panel).toBeVisible();

  // 머리는 바탕 줄 하나이고, `aside`는 사이드바와 작업 패널 둘이다 — 패널 카드는 두 번째 `aside` 안에 선다.
  await expect(page.locator("header")).toHaveCount(1);
  await expect(page.locator("aside")).toHaveCount(2);
  expect(await panel.evaluate((el) => el.closest("aside") === document.querySelectorAll("aside")[1])).toBe(true);

  const gap = await token(page, "--gap");
  const rail = await token(page, "--rail");
  const titlebar = await token(page, "--titlebar-height");
  const viewport = page.viewportSize()!;
  const edge = await page.locator("aside").first().evaluate((el) => el.getBoundingClientRect().right);
  const [card, side] = [await boxOf(doc), await boxOf(panel)];
  expect(card.y, "문서 카드 위").toBe(titlebar);
  expect(side.y, "패널 카드 위").toBe(titlebar);
  expect(card.x, "문서 카드 왼쪽").toBe(edge);
  expect(side.x - card.right, "문서와 패널 사이 틈").toBe(gap);
  // 패널 카드 오른쪽은 레일 열이다(ui-refresh 결정 10) — 틈 · 레일 · 틈을 지나 창 끝이다.
  expect(viewport.width - side.right, "패널 오른쪽 틈 · 레일 · 틈").toBe(gap + rail + gap);
  expect(viewport.height - side.bottom, "패널 아래 틈").toBe(gap);

  // 손잡이는 그 틈의 가운데이고 여전히 두 번째 `aside`의 자손이다. 드러난 틈은 창을 끄는 자리이고, 카드 안은 아니다.
  // 틈의 가운데 5px은 손잡이가 덮으므로 끄는 자리는 그 양옆이다 — 카드 바로 왼쪽 1px을 잰다(소수 좌표는 브라우저가
  // 반올림해 카드 안으로 떨어질 수 있다).
  const handle = await boxOf(page.locator("aside").nth(1).locator(HANDLE));
  expect(handle.x + handle.width / 2, "손잡이 가운데").toBe(card.right + gap / 2);
  const middleY = side.y + side.height / 2;
  expect(await draggable(page, side.x - 1, middleY), "패널 카드 왼쪽 틈").toBe(true);
  expect(await draggable(page, side.x + side.width / 2, side.bottom + gap / 2), "패널 카드 아래 틈").toBe(true);
  expect(await draggable(page, side.x + side.width / 2, side.bottom - 4), "패널 카드 안").toBe(false);

  // ⌘Enter로 접으면 틈이 카드와 함께 접혀 문서 카드가 오른쪽 틈 끝(레일 열 앞)까지 넓어진다 — 닫힌 칸 옆에 틈이 겹쳐 남지 않는다.
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => (await boxOf(doc)).right).toBe(viewport.width - rail - 2 * gap);
  await page.getByRole("button", { name: "작업 패널 펼치기", exact: true }).click();
  await expect.poll(async () => (await boxOf(panel)).x - (await boxOf(doc)).right).toBe(gap);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 판 04 티켓 03 — **분할의 두 열도 각자 카드이고, 사이 틈이 창을 끄는 자리다**(ui-refresh 결정 15 · 27). 두 열은 공용 틀의 분할
// (`Frame`의 `split`)이 목록 · 패널 칸과 같은 규칙으로 그린다: 틈은 `--gap`이고 왼쪽 열 상자의 안쪽 여백이라 그 상자가 끌기 영역이며,
// 폭 손잡이는 그 틈의 가운데다. 손잡이를 끄는 것 · 비율 저장 · PTY 격자는 `works-split.spec.ts`가 잰다 — 여기는 그 틈을 누르면 무엇이
// 눌리는가다. 한때 이 틈만 어느 L3도 재지 않았다(분할을 화면이 손으로 그리던 때).
test("Works: 분할이면 두 열이 각자 카드이고 사이 틈 --gap이 창을 끄는 자리다 — 손잡이는 그 틈의 가운데다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?split=lr`);
  const cards = page.locator("main").locator('[data-slot="card"]');
  await expect(cards).toHaveCount(2);
  // 머리는 바탕 줄 하나이고, `aside`는 사이드바와 (분할로 들어와 접힌) 작업 패널 둘 그대로다 — 열 카드는 `aside`가 아니다.
  await expect(page.locator("header")).toHaveCount(1);
  await expect(page.locator("aside")).toHaveCount(2);

  const gap = await token(page, "--gap");
  const titlebar = await token(page, "--titlebar-height");
  const [left, right] = [await boxOf(cards.first()), await boxOf(cards.last())];
  expect(left.y, "왼쪽 열 카드 위").toBe(titlebar);
  expect(right.y, "오른쪽 열 카드 위").toBe(titlebar);
  expect(right.x - left.right, "두 열 사이 틈").toBe(gap);

  // 손잡이는 그 틈의 가운데다. 손잡이(5px)가 틈(8px)의 가운데라 드러난 띠는 양쪽 1.5px씩이고, 손잡이 쪽 경계는 서브픽셀이라 짚는
  // 자리가 반올림에 걸린다 — 목록 칸(카드 오른쪽 + 0.5) · 패널 칸(카드 왼쪽 − 1)의 검사와 같은 자리를 짚는다.
  const handle = await boxOf(page.locator("main").locator(HANDLE));
  expect(handle.x + handle.width / 2, "손잡이 가운데").toBe(left.right + gap / 2);
  const middleY = left.y + left.height / 2;
  expect(await draggable(page, left.right + 0.5, middleY), "왼쪽 열 카드 오른쪽 틈").toBe(true);
  expect(await draggable(page, right.x - 1, middleY), "오른쪽 열 카드 왼쪽 틈").toBe(true);
  // 대조: 카드 안과 손잡이는 끄는 자리가 아니다 — 손잡이를 누르면 창이 아니라 두 열의 경계를 끈다.
  expect(await draggable(page, left.x + left.width / 2, middleY), "왼쪽 열 카드 안").toBe(false);
  expect(await draggable(page, right.x + right.width / 2, middleY), "오른쪽 열 카드 안").toBe(false);
  expect(await draggable(page, left.right + gap / 2, middleY), "손잡이").toBe(false);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 티켓 08 — **모서리 · 그림자 · 패널 박자가 Codex 토큰에서 나온다**(codex-ds 결정 27 · 스펙 §2 「반경 · 그림자 · 움직임」).
// 칠해진 값(computed style)을 토큰을 칠한 값(`토큰값`)과 맞대고, 스펙이 못박은 수(카드 16 · 패널 220ms)는 따로 센다 — 토큰 값이
// 바뀌는 날 견줌이 함께 흘러가 초록으로 남지 않게.

/**
 * 토큰 하나를 그 속성에 칠한 computed 값 — 빈 상자에 `속성: var(--이름)`을 주고 읽는다(하네스의 `토큰색`과 같은 길이고, 색이 아닌
 * 속성이다). 칠해진 자리와 같은 꼴(`16px` · `0.22s` · `rgba(…) 0px 0px 0px 0.5px`)로 나와 바로 맞댄다. `앞말`은 토큰 앞에 붙여 칠하는
 * 낱말이다 — 카드의 링은 같은 토큰을 안쪽(`inset`)에 칠한다(`Frame`의 `CardBox`).
 * **fail-closed** — 안 풀린 `var()`는 그 선언을 무효로 만들어 속성이 초기값으로 떨어진다. 그 값이면 던진다: 토큰이 지워진 날 칠해진
 * 자리도 같은 초기값이라, 견줌이 양쪽 다 초기값으로 초록이 된다.
 */
const 토큰값 = (page: Page, property: string, name: string, 앞말 = "") =>
  page.evaluate(
    ([prop, one, lead]) => {
      const probe = document.createElement("div");
      document.body.appendChild(probe);
      const initial = getComputedStyle(probe).getPropertyValue(prop);
      probe.style.setProperty(prop, `${lead} var(${one})`.trim());
      const value = getComputedStyle(probe).getPropertyValue(prop);
      probe.remove();
      if (value === initial) throw new Error(`토큰 ${one}이 ${prop}에 안 풀렸다 — ${value}`);
      return value;
    },
    [property, name, 앞말] as const,
  );

/** 그 요소에 칠해진 속성 값들(computed style) — 부른 차례대로다. */
const 칠한값 = (target: Locator, ...properties: string[]) =>
  target.evaluate((el, props) => props.map((one) => getComputedStyle(el).getPropertyValue(one)), properties);

/** 카드의 링 — 카드가 제 안쪽 가장자리에 덮는 `::after`의 `box-shadow`다(`Frame`의 `CardBox`). */
const 카드링 = (card: Locator) => card.evaluate((el) => getComputedStyle(el, "::after").boxShadow);

/**
 * 칠해진 `box-shadow`에서 Tailwind가 앞에 까는 **빈 층**을 걷는다 — 그림자 유틸리티는 링 · 안쪽 그림자 자리(`--tw-ring-shadow` …)를
 * 투명한 0 그림자로 먼저 깔고 제 그림자를 맨 뒤에 둔다. 걷고 남은 것이 토큰의 그림자다.
 */
const 그림자 = (painted: string) => painted.replace(/^(?:rgba\(0, 0, 0, 0\) 0px 0px 0px 0px, )+/, "");

/** `0.22s` · `220ms` → 밀리초. */
const 밀리초 = (time: string) => (time.endsWith("ms") ? parseFloat(time) : parseFloat(time) * 1000);

test("Works: 카드는 반경 16에 0.5px 링(--shadow-hairline)을 두르고, 메뉴는 떠 있는 그림자(shadow-prominent)다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const panel = 작업패널(page);
  await expect(panel).toBeVisible();

  const 반경 = await 토큰값(page, "border-top-left-radius", "--radius-2xl");
  const 링 = await 토큰값(page, "box-shadow", "--shadow-hairline");
  expect(반경, "카드 반경 — radius-2xl").toBe("16px");
  // 카드의 링은 같은 토큰을 카드 안쪽에 칠한다 — 그 링이 네 변에 다 칠해지는지는 아래 「링이 네 변에」가 픽셀로 잰다.
  const 안쪽링 = await 토큰값(page, "box-shadow", "--shadow-hairline", "inset");
  for (const [자리, card] of [
    ["문서 카드", page.locator("main")],
    ["작업 패널 카드", panel],
  ] as const) {
    const [위왼, 아래오른] = await 칠한값(card, "border-top-left-radius", "border-bottom-right-radius");
    expect([위왼, 아래오른], `${자리} 반경`).toEqual([반경, 반경]);
    expect(그림자(await 카드링(card)), `${자리} 링`).toBe(안쪽링);
  }

  // 떠 있는 카드 — 상태 메뉴를 키보드로 연다(위 「메뉴의 켜진 줄」과 같은 길). 모서리는 바탕 위 카드와 같은 단계다.
  await page.getByRole("button", { name: pinnedWork.status, exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
  const 뜬그림자 = await 토큰값(page, "box-shadow", "--shadow-prominent");
  expect(뜬그림자, "떠 있는 그림자가 바탕 위 링과 같다").not.toBe(링);
  const [메뉴반경, 메뉴그림자] = await 칠한값(menu, "border-top-left-radius", "box-shadow");
  expect([메뉴반경, 그림자(메뉴그림자)], "메뉴 반경 · 그림자").toEqual([반경, 뜬그림자]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/**
 * 카드의 네 변에 링이 **칠해졌나** — 변마다 경계를 가로지르는 6px 띠를 찍어, 그 안에 카드 바깥 바탕보다 뚜렷이 어두운 픽셀이
 * 있는지 본다. 링이 없으면 띠에는 바탕(`surface-shell` 246)과 카드 면(흰 255)뿐이고 둘 다 그 바탕보다 어둡지 않다. 링(라이트
 * `#0000001a`)은 카드 안쪽에 칠하든 바깥 바탕 위에 칠하든 그 바탕보다 어둡다 — 흰 면 위 229(실측) · 바탕 위 221. 문턱 8은 그
 * 차이(17)의 절반쯤이다. 카드 변이 온 px에 서서(위 배치 검사) 0.5px 링이 기기 픽셀 하나를 온전히 칠한다.
 *
 * **computed style로는 못 잰다.** 링이 조상의 `overflow`에 잘려도 `box-shadow` 값은 그대로라, 값을 맞대는 검사는 잘린 링에도 초록이다.
 * 띠는 왼쪽 · 오른쪽 변의 가운데가 아니라 위 1/3에 선다 — 작업 패널 왼쪽 틈 가운데의 폭 손잡이를 비킨다.
 */
async function 링이칠해진변(page: Page, card: Locator) {
  const box = await boxOf(card);
  const [midX, thirdY] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 3)];
  // `바깥`이 띠의 어느 끝이 카드 밖인지다 — 그 끝 픽셀이 견줄 바탕이다.
  const 띠 = {
    위: { clip: { x: midX, y: box.y - 3, width: 1, height: 6 }, 바깥: "앞" },
    아래: { clip: { x: midX, y: box.bottom - 3, width: 1, height: 6 }, 바깥: "뒤" },
    왼쪽: { clip: { x: box.x - 3, y: thirdY, width: 6, height: 1 }, 바깥: "앞" },
    오른쪽: { clip: { x: box.right - 3, y: thirdY, width: 6, height: 1 }, 바깥: "뒤" },
  } as const;
  const 칠해진변: Record<string, boolean> = {};
  for (const [변, { clip, 바깥 }] of Object.entries(띠)) {
    const png = (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
    칠해진변[변] = await page.evaluate(
      async ([data, fromEnd]) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const pen = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
        pen.canvas.width = image.width;
        pen.canvas.height = image.height;
        pen.drawImage(image, 0, 0);
        const { data: rgba } = pen.getImageData(0, 0, image.width, image.height);
        // 띠의 긴 축을 따라 한 줄로 편다 — 짧은 축(기기 픽셀 둘)은 평균한다.
        const along = image.width > image.height;
        const length = along ? image.width : image.height;
        const across = along ? image.height : image.width;
        const line = Array.from({ length }, (_, i) => {
          let sum = 0;
          for (let j = 0; j < across; j += 1) {
            const at = 4 * (along ? j * image.width + i : i * image.width + j);
            sum += (rgba[at] + rgba[at + 1] + rgba[at + 2]) / 3;
          }
          return sum / across;
        });
        const 바탕 = fromEnd ? line[length - 1] : line[0];
        return 바탕 - Math.min(...line) >= 8;
      },
      [png, 바깥 === "뒤"] as const,
    );
  }
  return 칠해진변;
}

// 바탕 위 카드의 링은 **칠해져야** 한다(codex-ds 결정 27 — 바탕 위 카드의 테두리는 0.5px 링뿐이다). 접히는 칸(목록 칸 · 작업 패널)의
// 바깥 상자는 접히는 동안 안쪽 열을 잘라 내려고 넘침을 숨기고, 카드는 그 상자의 세 변에 붙어 선다 — 링을 카드 바깥에 그리면 그 세
// 변에서 잘려 틈 쪽 한 변에만 남는다.
test("바탕 위 카드의 0.5px 링이 네 변에 다 칠해진다 — 접히는 칸의 상자가 잘라 내지 않는다", async ({ page }) => {
  const 네변 = { 위: true, 아래: true, 왼쪽: true, 오른쪽: true };
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(작업패널(page)).toBeVisible();
  // 앵커: 잘라 내는 상자가 없는 문서 카드 — 재는 길이 링을 보는지를 먼저 센다.
  expect(await 링이칠해진변(page, page.locator("main")), "문서 카드").toEqual(네변);
  expect(await 링이칠해진변(page, 작업패널(page)), "작업 패널 카드").toEqual(네변);

  await page.goto(`/projects/${PROJECTS[0].slug}`);
  const list = page.getByRole("region", { name: "프로젝트 목록", exact: true });
  await expect(list).toBeVisible();
  expect(await 링이칠해진변(page, list), "목록 카드").toEqual(네변);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Works: 접히는 칸(사이드바 · 작업 패널)과 셸 컨트롤 줄이 220ms · ease-panel로 움직인다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(작업패널(page)).toBeVisible();

  const 길이 = await 토큰값(page, "transition-duration", "--duration-panel");
  const 곡선 = await 토큰값(page, "transition-timing-function", "--ease-panel");
  expect(밀리초(길이), "패널 여닫기 — duration-panel").toBe(220);
  const 움직이는칸 = {
    사이드바: page.locator("aside").first(),
    "작업 패널": page.locator("aside").nth(1),
    // 셸 컨트롤 줄 — 첫 칸이 사이드바 토글이다. 전체화면에 들고 날 때 바탕 줄의 왼쪽 여백과 함께 옮겨 간다(`ShellControls`).
    "셸 컨트롤": page.getByRole("button", { name: "사이드바 토글", exact: true }).locator(".."),
  };
  for (const [자리, box] of Object.entries(움직이는칸)) {
    expect(await 칠한값(box, "transition-duration", "transition-timing-function"), 자리).toEqual([길이, 곡선]);
  }
  // 펴진 칸의 안쪽 열은 바깥 폭이 다 온 뒤에 상한을 받는다 — 그 지연이 같은 토큰이다(`panel-layout`의 `foldingInnerClass`).
  const [지연] = await 칠한값(page.locator("aside").nth(1).locator(":scope > div").first(), "transition-delay");
  expect(지연.split(",").map((one) => one.trim()), "작업 패널 안쪽 열의 지연").toEqual(["0s", 길이]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 분할의 되돌림 — 손잡이를 두 번 눌러 반반으로 돌아가는 순간만 두 열이 패널과 같은 박자로 움직이고(`Frame`의 분할), 그 순간을 끝내는
// 타이머도 같은 토큰을 읽는다(`useSplitRatio`). 토큰을 늘려 두고 시계로 잰다 — 타이머가 220을 따로 들면 늘린 길이보다 먼저 끝난다.
test("Works: 분할을 두 번 눌러 되돌리는 동안 두 열이 duration-panel · ease-panel로 움직이고, 그 길이가 지나면 멈춘다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.clock.install();
  await page.goto(`/works/${plainWork.slug}?split=lr`);
  const handle = page.locator("main").locator(HANDLE);
  // 몫을 드는 왼쪽 열 상자 — 손잡이가 그 자식이다(`Frame`의 분할).
  const column = handle.locator("..");
  await expect(handle).toBeVisible();
  await page.evaluate(() => document.documentElement.style.setProperty("--duration-panel", "400ms"));
  const 곡선 = await 토큰값(page, "transition-timing-function", "--ease-panel");
  expect(await 칠한값(column, "transition-duration"), "되돌리기 전에는 트랜지션이 없다").toEqual(["0s"]);

  await 시계를세운다(page);
  await handle.dblclick();
  await expect.poll(() => 칠한값(column, "transition-duration", "transition-timing-function")).toEqual(["0.4s", 곡선]);
  await page.clock.runFor(300);
  expect(await 칠한값(column, "transition-duration"), "늘린 길이 안에서는 아직 움직인다").toEqual(["0.4s"]);
  await page.clock.runFor(200);
  await expect.poll(() => 칠한값(column, "transition-duration")).toEqual(["0s"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 판 04 티켓 04 — **레일**(ui-refresh 결정 9 · 10). 작업 화면 바탕의 오른쪽 끝에 레일 열이 선다 — 맨 위 패널 토글은 바탕 줄 44px
// 띠의 가운데, 그 아래 칸 묶음(`spec` · `info`)은 카드 줄 꼭대기에서 시작한다. 레일 열은 본문 열의 형제라 `aside`도 `nav`도
// 바탕 줄 `<header>`의 자손도 아니고(`aside` · `header` 수와 그것을 집는 검사가 그대로다), 패널을 닫아도 그 자리에 남는다. 레일 열의
// 빈 자리(토글 둘레 · 칸 묶음 아래 · 오른쪽 틈)는 회색 바탕이 드러나는 자리라 창을 끄는 자리다.
test("Works: 레일 열이 바탕 오른쪽 끝에 서고 — 토글은 바탕 줄 띠 가운데, 칸 묶음은 카드 줄 꼭대기 — 패널을 닫아도 남고, 빈 자리가 창을 끄는 자리다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const toggle = page.getByRole("button", { name: "작업 패널 접기", exact: true });
  const group = page.getByRole("group", { name: "레일", exact: true });
  await expect(작업패널(page)).toBeVisible();
  await expect(toggle).toBeVisible();

  // 레일은 바탕 줄 밖 · `aside` 밖 · `nav` 밖이다 — `aside`는 둘, `header`는 하나 그대로다.
  for (const one of [toggle, group]) {
    expect(await one.evaluate((el) => el.closest("aside, nav, header")?.tagName ?? null)).toBeNull();
  }
  await expect(page.locator("aside")).toHaveCount(2);
  await expect(page.locator("header")).toHaveCount(1);
  // 칸은 목록 순서대로 `spec` · `info`다.
  expect(await group.getByRole("button").evaluateAll((all) => all.map((el) => el.getAttribute("aria-label")))).toEqual([
    "spec",
    "info",
  ]);

  const gap = await token(page, "--gap");
  const rail = await token(page, "--rail");
  const titlebar = await token(page, "--titlebar-height");
  const viewport = page.viewportSize()!;
  const [knob, pills, side] = [await boxOf(toggle), await boxOf(group), await boxOf(작업패널(page))];
  // 토글: 32px 원이 바탕 줄 띠의 가운데에, 레일 열 안에 선다.
  expect(knob.width, "토글 폭").toBe(32);
  expect(knob.y + knob.height / 2, "토글 세로 가운데 = 바탕 줄 띠의 가운데").toBe(titlebar / 2);
  expect(knob.x + knob.width / 2, "토글 가로 가운데 = 레일 열의 가운데").toBe(viewport.width - gap - rail / 2);
  // 칸 묶음: 카드 줄 꼭대기에서 시작하고 폭이 레일 폭이다. 패널 카드와 묶음 사이가 틈이다.
  expect(pills.y, "칸 묶음 위 = 카드 줄 꼭대기").toBe(titlebar);
  expect(pills.width, "칸 묶음 폭").toBe(rail);
  expect(viewport.width - pills.right, "레일 오른쪽 틈").toBe(gap);
  expect(pills.x - side.right, "패널 카드와 레일 사이 틈").toBe(gap);

  // 빈 자리는 창을 끄는 자리다 — 칸 묶음 아래, 토글 왼쪽 위 모서리 옆, 레일 오른쪽 틈, 패널 카드와 레일 사이 틈.
  const railMiddle = viewport.width - gap - rail / 2;
  expect(await draggable(page, railMiddle, pills.bottom + 40), "칸 묶음 아래").toBe(true);
  expect(await draggable(page, knob.x + 1, knob.y + 1), "토글 둘레(원 밖 모서리)").toBe(true);
  expect(await draggable(page, viewport.width - gap / 2, pills.bottom + 40), "레일 오른쪽 틈").toBe(true);
  expect(await draggable(page, side.right + gap / 2, pills.bottom + 40), "패널 카드와 레일 사이 틈").toBe(true);
  // 대조: 칸과 토글 자체는 눌리는 버튼이다.
  expect(await draggable(page, railMiddle, knob.y + knob.height / 2), "토글").toBe(false);
  expect(await draggable(page, railMiddle, pills.y + pills.height / 4), "칸").toBe(false);

  // 패널을 닫아도 레일은 그 자리다 — 칸으로 다시 열 길이 닫힌 패널과 함께 사라지지 않는다(ui-refresh 결정 10).
  await toggle.click();
  const closed = page.getByRole("button", { name: "작업 패널 펼치기", exact: true });
  await expect(closed).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await boxOf(page.locator("main"))).right).toBe(viewport.width - rail - 2 * gap);
  expect(await boxOf(group)).toEqual(pills);
  expect(await boxOf(closed)).toEqual(knob);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 레일은 작업을 고른 작업 화면에만 선다 — 빈 화면과 다른 화면에는 레일 열이 없고 본문 카드의 오른쪽 틈이 `--gap` 하나다(위 화면들의
// 「카드 오른쪽 틈」이 그것을 잰다).
test("Works: 고른 작업이 없는 빈 화면에는 레일이 없고 카드 오른쪽 틈이 --gap이다", async ({ page }) => {
  await installFixtureBackend(page, { list_works: [] });
  await page.goto("/works");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("group", { name: "레일", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^작업 패널 (접기|펼치기)$/ })).toHaveCount(0);
  const card = await cardOf(page);
  expect(page.viewportSize()!.width - card.right).toBe(await token(page, "--gap"));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 문서 카드 머리(ui-refresh 결정 5 · 7의 B) — 「지금 보는 것」의 캡슐 `slug › spec › … › 파일`과 원문 전환 · 경로 복사가 선다. 복사는
// 새 동작이 아니라 트리의 경로 복사가 선 자리 하나가 더 생긴 것이라, **같은 값**을 클립보드에 넣는다.
test("Works: 문서 카드 머리에 slug › spec › … › 파일 캡슐과 원문 전환 · 경로 복사가 서고, 복사가 트리의 경로 복사와 같은 값을 낸다", async ({
  page,
}) => {
  const file = "목업/조각.html";
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/works/${pinnedWork.slug}?file=${encodeURIComponent(file)}`);
  const doc = page.locator("main");
  const crumbs = doc.getByRole("navigation", { name: "위치", exact: true });
  await expect(crumbs).toBeVisible();
  expect(await crumbs.locator("span").allTextContents()).toEqual([pinnedWork.slug, "spec", "목업", "조각.html"]);
  await expect(doc.getByRole("button", { name: "원문 보기", exact: true })).toBeVisible();

  await doc.getByRole("button", { name: "경로 복사", exact: true }).click();
  await expect.poll(() => clipboardWrites(page)).toHaveLength(1);

  // 트리의 같은 문서 행에서 복사한다 — 두 자리가 같은 글자를 내야 한다.
  const row = 작업패널(page).getByRole("button", { name: "HTML 조각.html", exact: true });
  await row.hover();
  await 작업패널(page).getByRole("button", { name: "조각.html 경로 복사", exact: true }).click();
  await expect.poll(() => clipboardWrites(page)).toHaveLength(2);
  const [fromHead, fromTree] = await clipboardWrites(page);
  expect(fromHead).toBe(fromTree);
  expect(fromHead).toBe(`~/.atelier/works/${pinnedWork.slug}/spec/${file}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 덮는 것의 기준 상자(판 04 「지키는 것」) — 놓기 겹판과 토스트는 `Frame`의 `overlay` 칸이라 **카드 줄**에 선다. 카드 줄이 바탕 줄
// 아래에서 시작하므로 겹판이 패널까지 덮어도 끄는 것이 출발한 줄은 안 덮고(결정 12), 토스트는 카드 줄의 아래 가운데다. 카드 줄은
// 창 아래 틈(`--gap`) 위에서 끝나므로 겹판도 거기서 끝난다 — 한때(이 티켓 전) 겹판은 창 바닥까지 갔다.
test("Works: 셸 칸을 끄는 동안 겹판이 카드 줄을 덮고 바탕 줄은 안 덮고, 토스트는 카드 줄 아래 가운데에 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  const shellTab = page.locator('[data-tab="shell"] button[aria-pressed]');
  await expect(shellTab).toBeVisible();
  await expect(작업패널(page)).toBeVisible();

  const titlebar = await token(page, "--titlebar-height");
  const viewport = page.viewportSize()!;
  const edge = await page.locator("aside").first().evaluate((el) => el.getBoundingClientRect().right);
  // 카드 줄의 오른쪽 끝 — 그 뒤는 레일 열(틈 · 레일)이다. 레일은 카드 줄 밖이라 겹판도 토스트의 가운데도 그것을 안 센다.
  const rowRight = viewport.width - (await token(page, "--rail")) - (await token(page, "--gap"));
  const from = await startSplitDrag(page, await boxOf(shellTab));
  const cover = await boxOf(page.locator("[data-drop-half]").first().locator(".."));
  expect(cover.y, "겹판 위 — 바탕 줄 아래").toBe(titlebar);
  expect(cover.x, "겹판 왼쪽").toBe(edge);
  expect(cover.right, "겹판 오른쪽 — 패널까지 덮는다").toBe(rowRight);
  expect(cover.bottom, "겹판 아래 — 카드 줄의 바닥").toBe(viewport.height - (await token(page, "--gap")));
  // 출발한 줄로 되돌아와 놓으면 아무 일도 안 난다 — 그 줄은 겹판 밖이다.
  await page.mouse.move(from.x, from.y);
  await page.mouse.up();
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);
  await expect(page).not.toHaveURL(/split=/);

  // 토스트 — 셸 0개 화면에서도 서는 말이 아니라, 이 화면이 내는 복사 확인으로 세운다.
  await recordClipboard(page);
  await page.reload();
  await page.getByRole("group", { name: "레일", exact: true }).getByRole("button", { name: "info", exact: true }).click();
  await 작업패널(page).getByRole("button", { name: `slug ${plainWork.slug}`, exact: true }).click();
  const toast = page.getByRole("region", { name: "메시지", exact: true }).locator('[data-slot="toast"]');
  await expect(toast).toBeVisible();
  const box = await boxOf(toast);
  expect(Math.abs(box.x + box.width / 2 - (edge + rowRight) / 2), "토스트 가운데").toBeLessThanOrEqual(1);
  expect(box.bottom, "토스트 아래 — 카드 줄 안").toBeLessThan(viewport.height);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
