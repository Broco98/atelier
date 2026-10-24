import type { Settings } from "@/features/settings/types";
import { terminalSettings } from "@/features/settings/settings-fixture";
import { expect, test, type Locator, type Page } from "./evidence";
import { ARCHIVE, PROJECTS, WORKS } from "./fixtures";
import {
  clipboardWrites,
  HEAD_CARD,
  installFixtureBackend,
  recordClipboard,
  SPEC_LAYOUT_EDITOR,
  startSplitDrag,
  unknownIpcCalls,
  레인,
  첫글자,
  머리카드,
  그림자,
  끄는자리,
  시계를세운다,
  칠한값,
  칠한링,
  토큰값,
  토큰색,
  팔레트,
  창검색버튼,
} from "./harness";
import { settle } from "./tab-row";

// 판 04 티켓 01 — 공용 틀(`Frame`, ui-refresh 결정 4 · 5 · 27). 탭이 없거나 패널이 없는 화면이 옅은 회색 바탕 위의 둥근
// 카드로 뜨고, 머리 줄(`<header>`)은 그 위 48에 선다(codex-ds 스펙 §4 — 틈 8 · 머리 카드 32 · 틈 8).
//
// **이 층에서만 보이는 것이다**: 카드 상자의 실제 자리와, 그 둘레에 드러난 회색 틈을 누르면 **무엇이 눌리는가**.
// 맨값 `data-tauri-drag-region`은 Tauri가 누른 요소 **자신**에서만 본다 — 조상의 맨값은 자식을 누른 것을 끌지 않는다. 그래서
// `elementFromPoint`가 돌려준 요소에서 Tauri의 판정을 그대로 따라 잰다(`harness`의 `끄는자리`). 틈을 드러내는 상자 하나만 속성을
// 빠뜨려도 그 틈이 창을 못 끄는 죽은 자리가 되는데, 화면으로는 어느 상자가 빠졌는지가 안 보인다. 머리 카드는 `deep`이라 그 안의
// 빈 자리 · 보이기만 하는 글자가 끌고, 누를 것(버튼 · 포커스 받는 이름)은 Tauri가 비켜 둔다.

const SCREENS = [
  { name: "Terminal", url: "/terminal" },
  { name: "Processes", url: "/processes" },
  { name: "Settings", url: "/settings/terminal" },
  { name: "레이아웃 편집기", url: SPEC_LAYOUT_EDITOR },
] as const;

/**
 * 앱이 쓰는 배치 변수 하나의 값(px). 숫자를 여기 적지 않는다 — 토큰이 바뀌면 이 검사가 거짓 빨강을 낸다. 셸의 뿌리
 * (`[data-titlebar]`)에서 읽는다 — 셸 컨트롤 묶음(`--titlebar-control-gap` 등)은 `:root`가 아니라 거기 선다. 수로 적힌 변수만
 * 읽힌다 — 식(`calc`)으로 적힌 것(`--titlebar-inset-head` 등)은 등록하지 않은 변수라 계산값이 식 그대로여서 `NaN`이 된다.
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

    // 머리는 머리 줄 하나이고(ui-refresh 결정 5 — 옛 브레드크럼 머리의 층이 카드 위에 따로 서지 않는다), `aside`는 사이드바뿐이다.
    // 머리 줄에는 그 화면의 머리 카드가 선다(codex-ds 티켓 14 — 이름과 할 일은 아래 `HEAD_SCREENS`가 잰다).
    await expect(page.locator("header")).toHaveCount(1);
    await expect(page.locator("aside")).toHaveCount(1);
    await expect(머리카드(page)).toHaveCount(1);

    const gap = await token(page, "--space-2");
    const titlebar = await token(page, "--titlebar-height");
    const viewport = page.viewportSize()!;
    const card = await cardOf(page);
    // 카드 줄의 오른쪽 끝 카드 — 편집기는 본문 카드 오른쪽에 트리 카드가 서고(판 06 티켓 07), 다른 세 화면은 본문 카드다.
    const last = await boxOf(page.locator('[data-slot="card"]').last());
    // 앵커: 카드는 머리 줄 바로 아래에서 시작하고 오른쪽 · 아래에 틈을 남긴다. 틈이 없으면 아래 두 점이 창 밖이나
    // 카드 위에 떨어져 무엇을 재는지가 흐려진다.
    expect(card.y, "카드가 머리 줄 바로 아래에서 시작한다").toBe(titlebar);
    expect(viewport.width - last.right, "카드 오른쪽 틈").toBe(gap);
    expect(viewport.height - card.bottom, "카드 아래 틈").toBe(gap);
    // 머리 카드는 본문 열 폭이다 — 본문 카드 왼쪽(사이드바 뒤)부터 카드 줄 오른쪽 끝 카드까지. 레일이 없는 화면이라 창 끝 틈 앞까지다.
    const head = await boxOf(머리카드(page));
    expect([head.x, head.right], "머리 카드 = 본문 열").toEqual([card.x, last.right]);

    const middleY = card.y + card.height / 2;
    expect(await 끄는자리(page, last.right + gap / 2, middleY), "카드 오른쪽 틈").toBe(true);
    expect(await 끄는자리(page, card.x + card.width / 2, card.bottom + gap / 2), "카드 아래 틈").toBe(true);
    // 대조: 카드 안은 끄는 자리가 아니다 — 바탕 전체가 끌기 영역이 된 것과 가른다.
    expect(await 끄는자리(page, card.x + card.width / 2, middleY), "카드 안").toBe(false);

    // ⌘B로 사이드바를 접으면 카드가 왼쪽 틈까지 넓어지고, 그 틈도 끄는 자리다.
    await page.keyboard.press("Meta+b");
    await expect.poll(async () => (await cardOf(page)).x).toBe(gap);
    expect(await 끄는자리(page, gap / 2, middleY), "사이드바를 접은 뒤의 왼쪽 틈").toBe(true);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 판 06 티켓 07 — **레이아웃 편집기의 트리는 본문 카드 오른쪽의 카드다.** 작업 화면의 spec 패널과 같은 쪽 · 같은 폭(작업 패널의
// 기본 폭 340 — DS `size-panel`, codex-ds 스펙 S4)이고, 둘 사이는 틈 `--space-2`다. 트리 카드는 레일 · 접힘 · 손잡이가 없는 늘 열린 `section`이다 — `aside`는 사이드바
// 하나뿐이다(판 06 「지키는 것」). 트리 위 도구 줄(「항목 편집」)은 그 카드의 머리에 선다.
test("레이아웃 편집기: 트리가 본문 카드 오른쪽의 340 카드이고 머리에 도구가 서며, 둘 사이 틈이 창을 끄는 자리다", async ({
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

  const gap = await token(page, "--space-2");
  const titlebar = await token(page, "--titlebar-height");
  const viewport = page.viewportSize()!;
  const [form, card] = [await boxOf(main), await boxOf(tree)];
  expect(card.width, "트리 카드 폭").toBe(340);
  expect(card.y, "트리 카드 위").toBe(titlebar);
  expect(card.bottom, "트리 카드 아래").toBe(form.bottom);
  expect(card.x - form.right, "본문 카드와 트리 카드 사이 틈").toBe(gap);
  expect(viewport.width - card.right, "트리 카드 오른쪽 틈").toBe(gap);

  // 둘 사이 틈은 창을 끄는 자리이고, 트리 카드 안은 아니다.
  const middleY = card.y + card.height / 2;
  expect(await 끄는자리(page, form.right + gap / 2, middleY), "두 카드 사이 틈").toBe(true);
  expect(await 끄는자리(page, card.x + card.width / 2, middleY), "트리 카드 안").toBe(false);

  // ⌘B로 사이드바를 접어도 트리 카드는 340 그대로이고, 넓어지는 것은 본문 카드다.
  await page.keyboard.press("Meta+b");
  await expect.poll(async () => (await boxOf(main)).x).toBe(gap);
  expect((await boxOf(tree)).width, "사이드바를 접은 뒤의 트리 카드 폭").toBe(340);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 앱의 최소 창(900 — `tauri.conf.json`)에서 사이드바를 연 채로도 편집기의 조작이 제 카드 안에 다 선다. 화면의 조작(뒤로 · 「LLM이
// 받는 텍스트」 · 「저장」)은 머리 카드에, 트리의 도구는 트리 카드 머리에 선다(codex-ds 티켓 14). 폼 카드는 몸을 격리해 바닥이 없어
// 트리 카드가 폼 카드에 자리를 내주는 일은 없다 — 밖 변경 배너가 선 동안만 그 배너가 폼 카드의 바닥이다(`spec-layout-outside.spec.ts`).
//
// **두 머리의 폭은 수로 정해져 있지 않다** — 글자가 시스템 글꼴이라 OS마다 다르다(macOS SF Pro · 리눅스 PR 게이트의 제 글꼴). 그래서
// 머리 카드의 조작과 트리 카드의 머리가 틀 뿌리의 바닥이고, 그것이 창에 안 들면 사이드바가 자리를 내준다(`Frame`의 `HeadCard` ·
// `BesideBox`). 이 검사는 어느 글꼴에서나 같은 관계를 잰다: 조작이 카드 안이고, 카드도 창 안이다 — 창 밖으로 밀린 카드의 조작은
// 「카드 안」이어도 안 보인다.
test("레이아웃 편집기: 최소 창에서 사이드바를 연 채로도 머리 카드와 트리 카드 머리의 조작이 카드 안에 다 선다", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await installFixtureBackend(page);
  await page.goto(SPEC_LAYOUT_EDITOR);
  const tree = page.getByRole("region", { name: "항목 트리", exact: true });
  const head = 머리카드(page);
  await expect(tree.getByRole("treeitem", { name: "overview.md", exact: true })).toBeVisible();
  // 앵커: 사이드바가 열려 있다 — 접혀 있으면 카드가 넉넉해 아래 셈이 아무것도 재지 않는다.
  expect((await boxOf(page.locator("main"))).x, "본문 카드가 사이드바 옆에 선다").toBe(await sidebarRight(page));

  const inside = async (control: Locator, card: Locator) => {
    const [box, edge] = [await boxOf(control), await boxOf(card)];
    return box.x >= edge.x && box.right <= edge.right;
  };
  expect(await inside(head.getByRole("button", { name: "설정으로 돌아가기", exact: true }), head), "뒤로").toBe(true);
  expect(await inside(head.getByRole("button", { name: "LLM이 받는 텍스트", exact: true }), head), "미리보기").toBe(true);
  expect(await inside(head.getByRole("button", { name: "저장", exact: true }), head), "저장").toBe(true);
  expect(await inside(tree.getByRole("button", { name: "파일 항목 추가", exact: true }), tree), "파일").toBe(true);
  expect(await inside(tree.getByRole("button", { name: "고른 항목 지우기", exact: true }), tree), "지우기").toBe(true);
  const edge = page.viewportSize()!.width - (await token(page, "--space-2"));
  expect((await boxOf(head)).right, "머리 카드가 창 안").toBeLessThanOrEqual(edge);
  expect((await boxOf(tree)).right, "트리 카드가 창 안").toBeLessThanOrEqual(edge);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 티켓 12 — **탭 줄은 카드 머리라 신호등을 피할 일이 없다**(codex-ds 스펙 §4 「탭 줄」). 한때 줄이 창 맨 위 줄에 서서 ⌘B로
// 사이드바를 접으면 첫 칸이 셸 컨트롤 뒤로 옮겨 갔다. 지금은 머리 줄 아래 카드 안이라, 접으면 카드가 창 왼쪽
// 틈까지 넓어지고 첫 칸은 카드 안 같은 자리(안쪽 8 — DS `.at-toolbar`)에 남는다. 셸 컨트롤은 머리 줄에 남아 줄과 겹치지 않는다.
test("Terminal: 사이드바를 ⌘B로 접어도 탭 줄의 첫 칸이 카드 안 같은 자리이고 셸 컨트롤과 겹치지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  const firstTab = page.locator('[data-tab="shell"]').first();
  await firstTab.waitFor();
  const card = page.locator("main");

  /** 첫 칸을 카드 왼쪽 위에서 잰 자리. */
  const offset = async () => {
    const [tab, edge] = [await boxOf(firstTab), await boxOf(card)];
    return { x: tab.x - edge.x, y: tab.y - edge.y };
  };
  const before = await offset();
  // 앵커: 첫 칸이 카드 왼쪽 안쪽 8에 선다 — 이 화면에는 `spec` 칸이 없어 셸 칸이 줄 맨 앞이다.
  expect(before.x).toBe(8);

  await page.keyboard.press("Meta+b");
  const gap = await token(page, "--space-2");
  await expect.poll(async () => (await boxOf(card)).x).toBe(gap);
  await expect.poll(offset).toEqual(before);
  // 셸 컨트롤의 마지막 칸(검색)은 머리 줄에 서고, 탭 줄은 그 아래 카드 안이다.
  const search = await boxOf(창검색버튼(page));
  expect(search.bottom).toBeLessThanOrEqual((await boxOf(firstTab)).y);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 기본값 판 04 줄 — **터미널 카드의 바탕은 터미널 테마를 따른다.** 설정이 밝게면 흰 카드, 어둡게면 셸의 어두운 바탕이다.
// 카드의 둥근 모서리 안쪽 여백(DS `Terminal`의 16 — `--space-4`) 띠도 그 색이라 셸 화면과 카드 사이에 다른 색의 띠가 안 보인다.
for (const theme of ["light", "dark"] as const) {
  test(`Terminal: 테마가 ${theme}면 터미널 카드와 그 안쪽 여백 띠가 셸의 바탕색이다`, async ({ page }) => {
    await installFixtureBackend(page, {
      read_settings: { terminal: terminalSettings({ theme }) } satisfies Settings,
    });
    await page.goto("/terminal");
    await expect(page.locator(".xterm-screen")).toBeVisible();

    const inset = await token(page, "--space-4");
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

  const gap = await token(page, "--space-2");
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

  // 다크 팔레트를 켜고 색의 전환이 끝날 때까지 기다린다 — 전환 도중의 중간값을 재지 않게(하네스 `팔레트`).
  await 팔레트(page, true);
  const 다크 = await 칠한색();
  // **팔레트가 정말 바뀌었는지를 먼저 센다** — `.dark`가 안 먹으면 아래가 라이트 값을 다시 재고, 토큰도 라이트로 풀려
  // 조용히 초록이 된다.
  for (const 자리 of ["바탕", "카드", "글자"] as const) {
    expect(다크[자리], `다크 · ${자리} — 라이트 색이 그대로다`).not.toBe(라이트[자리]);
  }
  expect(다크).toEqual(await 토큰셋());
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 티켓 07 — **유틸리티 `accent`가 Codex 파랑이다**(codex-ds 스펙 S1). 그 유틸리티로 칠한 한 자리(설정의 켜진 칩을 두른
// 링 — `toggle`의 chip 크기 `aria-pressed:inset-ring-accent`)를 칠해진 색으로 읽어 `#339cff` · 토큰 `--accent`와 맞댄다. 빌드가
// 내는 규칙은 `tokens.test.ts`가 보고, 여기서는 그 규칙이 화면에 닿았는지 본다 — 유틸리티가 옛 뜻(옅은 면)에 남으면 이 링이 회색이
// 된다. 끌기 없이 늘 화면에 서는 자리라 집었다.
test("유틸리티 accent로 칠한 자리(설정의 켜진 칩을 두른 링)는 Codex 파랑 #339cff다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");
  // 글꼴을 고르지 않은 설정이라 「기본」 칩이 켜져 있다.
  const 칩 = page.getByRole("group", { name: "글꼴 프리셋", exact: true }).getByRole("button", { name: "기본", exact: true });
  await expect(칩).toHaveAttribute("aria-pressed", "true");

  const 파랑 = await 토큰색(page, "--accent");
  expect(파랑).toBe("rgb(51, 156, 255)");
  // 칠해진 `box-shadow`에서 투명한 빈 층을 걷으면 1px 안쪽 링 하나가 남는다.
  expect(await 칠한링(칩)).toEqual([`${파랑} 0px 0px 0px 1px inset`]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **옅은 면이던 자리가 파랑으로 바뀌지 않았다** — 메뉴의 켜진 줄은 옅은 면(`fill-hover`)이다. registry는 그 줄을 shadcn
// `accent`(옅은 면)로 칠했고 부품은 그 면을 Codex 이름(`focus:bg-fill-hover`)으로 옮겨 적었다. 이제 유틸리티 `accent`는 파랑이라,
// registry의 이름이 하나라도 남았으면 이 줄이 파랑으로 켜진다. 상태 메뉴를 키보드로 열어 첫 줄을 켠다.
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
// (`status.tsx`의 `STATUS_META` · `StatusIcon`)가 칠하는 세 자리 — 머리의 상태 배지 앞 점, 그 배지가 여는 상태 메뉴의 점,
// 사이드바 행 레인의 상태 아이콘 — 를 칠해진 색으로 읽어 그 상태의 토큰(`st-draft` · `st-active` · `st-review` ·
// `st-done`)과 맞댄다. 배지 자신은 DS `StatusBadge`다 — 색은 점 하나에만 쓰고, 글자 · 면 · 모서리는 상태와 상관없이
// `fg-secondary` · `fill-soft` · `radius-sm`이다(상태색 글자는 글자 바닥 아래이고, 알약은 머리 컨트롤의 모양이 아니다 — `status.tsx` 머리말).
//
// **상태마다 하나씩 잰다.** 상태 하나만 재면 표의 네 줄이 한 색으로 무너져도(한 줄을 베껴 넷에 붙이면) 초록이다.
// 픽스처 목록은 상태를 기억하지 않으므로(`set_work_status`의 답 — `fixtures.ts`) 목록을 덮어 그 상태의 work로 연다.
for (const status of ["draft", "active", "review", "done"] as const) {
  test(`상태 ${status}: 배지 점 · 상태 메뉴의 점 · 행 레인의 상태 아이콘이 st-${status}이고, 배지는 회색 면 · fg-secondary 글자다`, async ({
    page,
  }) => {
    const work = { ...WORKS[1], status };
    await installFixtureBackend(page, {
      list_works: WORKS.map((one) => (one.slug === work.slug ? work : one)),
    });
    await page.goto(`/works/${work.slug}`);
    const 색 = await 토큰색(page, `--st-${status}`);

    const badge = page.getByRole("button", { name: status, exact: true });
    await expect(badge).toBeVisible();
    // 배지 — 24 높이 · `radius-sm`(6) · 좌우 8, 면 `fill-soft` · 글자 `fg-secondary`(DS `.at-badge`). 수는 따로도 센다.
    expect(await 칠한값(badge, "height", "border-top-left-radius", "padding-left", "padding-right")).toEqual([
      "24px",
      await 토큰값(page, "border-top-left-radius", "--radius-sm"),
      "8px",
      "8px",
    ]);
    expect(await 토큰값(page, "border-top-left-radius", "--radius-sm"), "radius-sm").toBe("6px");
    await expect(badge).toHaveCSS("background-color", await 토큰색(page, "--fill-soft"));
    await expect(badge).toHaveCSS("color", await 토큰색(page, "--fg-secondary"));
    // 앞의 점 — 6px 원이 그 상태의 색이다(배지의 `::before`).
    expect(
      await badge.evaluate((el) => {
        const dot = getComputedStyle(el, "::before");
        return [dot.width, dot.height, dot.backgroundColor];
      }),
    ).toEqual(["6px", "6px", 색]);
    // 셸이 부르지 않는 행이라 레인에는 상태 아이콘이 선다(부르면 그 자리를 부름의 점이 갖는다 — `works-sidebar.spec.ts`).
    await expect(레인(page, work.slug).locator("svg")).toHaveCSS("color", 색);

    await badge.click();
    // 줄의 첫 자식이 점이다(`WorksPage.tsx`의 `StatusMenu`) — 줄 끝의 체크는 부품이 뒤에 붙인다.
    const 줄 = page.getByRole("menu").getByRole("menuitemradio", { name: new RegExp(`^${status}\\b`) });
    await expect(줄.locator(":scope > span").first()).toHaveCSS("background-color", 색);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 판 04 티켓 02 · codex-ds 티켓 20 — **목록이 있는 두 화면**(codex-ds 결정 28 · 32). 목록 칸과 그 내용(프로젝트 상세 · 문서)은 **한
// 카드**이고, 내용이 왼쪽 · 목록 칸이 오른쪽이다 — 가운데 0.5px `border-heavy` 세로 선이 가른다. 그 선이 폭 손잡이다 — 왼쪽으로 끌면
// 목록이 넓어져 저장되고, 두 번 누르면 기본 폭(`size-list` 264)이다. 목록 칸은 접지 않는다 — 접는 토글도, 그것을 받던 ⌘Enter도 없다. 목록 머리는 내용의 경로 줄과 같은
// 48(`size-pathbar`)이라 두 머리가 한 줄에 선다. 따로 여닫는 패널만 틈 8로 떨어진 카드다(작업 패널 — 아래 「작업 화면」, Archive의
// spec 목록 패널 — 여닫기는 `archive-docs.spec.ts`).
const LIST_SCREENS = [
  {
    name: "Projects",
    url: `/projects/${PROJECTS[0].slug}`,
    list: "프로젝트 목록",
    widthKey: "panel-width",
    // 목록 머리 — 제목 · 개수(그리고 끝의 `+`).
    head: ["Projects", String(PROJECTS.length)],
    // 목록 칸 위쪽에 서는 조작 — 그 아래 찾기 칸과 머리의 `+`(이름 「프로젝트 등록」).
    headControls: (page: Page) => [
      page.getByRole("textbox", { name: "프로젝트 검색", exact: true }),
      page.getByRole("button", { name: "프로젝트 등록", exact: true }),
    ],
    // 오른쪽 패널이 없는 화면이다.
    panel: null,
  },
  {
    name: "Archive",
    url: `/archive/${ARCHIVE[0].slug}`,
    list: "아카이브 목록",
    widthKey: "archive-panel-width",
    head: ["Archive", String(ARCHIVE.length)],
    // 머리 아래의 찾기 칸과 머리 끝의 정렬 · 거르기 메뉴 버튼(codex-ds S11 — 아이콘 버튼이라 이름이 그 할 일이다).
    headControls: (page: Page) => [
      page.getByRole("textbox", { name: "아카이브 검색", exact: true }),
      page.getByRole("button", { name: "정렬 · 거르기", exact: true }),
    ],
    // 고른 아카이브의 spec 목록 패널(codex-ds 티켓 21) — 내용 | 목록 카드 곁에 떨어진 카드로 서는 둘째 `aside`다.
    panel: "spec 목록",
  },
] as const;

const HANDLE = '[title="드래그로 폭 조절 · 더블클릭으로 기본 폭"]';
/** 목록 칸의 폭 손잡이(세로 선 위) — 사이드바의 손잡이(`aside` 안)와 가른다. */
const listHandle = (page: Page) => page.locator(`${HANDLE}:not(aside ${HANDLE})`);
/** 목록 칸을 품은 카드 — 내용 | 목록 한 카드다. */
const joinedCard = (page: Page, list: Locator) => page.locator('[data-slot="card"]', { has: list });
/** 목록 칸 맨 위의 목록 머리. */
const listHead = (list: Locator) => list.locator('[data-slot="list-head"]');

async function boxOf(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("상자를 못 읽었다");
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

/** 사이드바 오른쪽 끝 — 사이드바는 첫 `aside`다(둘째는 오른쪽 패널). */
const sidebarRight = (page: Page) => page.locator("aside").first().evaluate((el) => el.getBoundingClientRect().right);

for (const screen of LIST_SCREENS) {
  test(`${screen.name}: 목록과 내용이 한 카드이고 0.5px border-heavy 세로 선이 가른다 — 그 선 위가 폭 손잡이다`, async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(screen.url);
    const list = page.getByRole("region", { name: screen.list, exact: true });
    const main = page.locator("main");
    await expect(list).toBeVisible();

    // 목록 칸은 `section`이다 — `aside`는 사이드바와 (있으면) 오른쪽 패널뿐이고(`works-sidebar`), `header`는 머리 줄 하나다.
    expect(await list.evaluate((el) => el.tagName)).toBe("SECTION");
    await expect(page.locator("aside")).toHaveCount(screen.panel ? 2 : 1);
    await expect(page.locator("header")).toHaveCount(1);
    // 한 카드 — 목록 칸과 내용 칸(`main`)이 같은 카드 안에 선다. 카드 줄의 카드는 그 하나와 (있으면) 패널의 카드다.
    const card = joinedCard(page, list);
    await expect(card).toHaveCount(1);
    await expect(card.locator("main")).toHaveCount(1);
    await expect(page.locator('[data-slot="card"]')).toHaveCount(screen.panel ? 2 : 1);
    const panelCard = page.locator("aside").nth(1).locator('[data-slot="card"]');
    if (screen.panel) await expect(panelCard).toHaveAttribute("aria-label", screen.panel);

    const gap = await token(page, "--space-2");
    const titlebar = await token(page, "--titlebar-height");
    const edge = await sidebarRight(page);
    const [whole, column, content] = [await boxOf(card), await boxOf(list), await boxOf(main)];
    // 카드가 머리 줄 바로 아래에서 사이드바에 붙어 시작하고(왼쪽 틈 0) 오른쪽에 틈을 남긴다 — 그 너머는 창 끝이거나 패널의 카드이고,
    // 패널이 서면 그 카드가 창 오른쪽에 틈을 남긴다.
    expect([whole.x, whole.y], "카드 왼쪽 위").toEqual([edge, titlebar]);
    const outer = screen.panel ? await boxOf(panelCard) : whole;
    if (screen.panel) expect([outer.x - whole.right, outer.y], "패널 카드 왼쪽 틈").toEqual([gap, titlebar]);
    expect(page.viewportSize()!.width - outer.right, "카드 줄 오른쪽 틈").toBe(gap);
    // 내용 칸은 카드 왼쪽 끝, 목록 칸은 그 바로 뒤에서 카드 오른쪽 끝까지다 — 둘 사이에 틈이 없다.
    expect([content.x, content.y, content.bottom], "내용 칸").toEqual([whole.x, whole.y, whole.bottom]);
    expect([column.x, column.y, column.right, column.bottom], "목록 칸").toEqual([
      content.right,
      whole.y,
      whole.right,
      whole.bottom,
    ]);

    // 세로 선 — 목록 칸 왼쪽 끝 안쪽에 칠한 0.5px `border-heavy` 면이고, 칸의 위에서 아래까지다.
    const rule = await list.evaluate((el) => {
      const style = getComputedStyle(el, "::after");
      return [style.width, style.left, style.top, style.bottom, style.backgroundColor];
    });
    expect(rule, "세로 선").toEqual(["0.5px", "0px", "0px", "0px", await 토큰색(page, "--border-heavy")]);
    // 손잡이는 그 선 위에 걸친다 — 가운데가 두 칸의 경계다. 카드 안이라 창을 끄는 자리가 아니다.
    const handle = await boxOf(listHandle(page));
    expect(handle.x + handle.width / 2, "손잡이 가운데 = 경계").toBe(column.x);
    expect([handle.y, handle.bottom], "손잡이는 칸의 위에서 아래까지").toEqual([column.y, column.bottom]);
    const middleY = whole.y + whole.height / 2;
    expect(await 끄는자리(page, column.x, middleY), "경계").toBe(false);
    expect(await 끄는자리(page, outer.right + gap / 2, middleY), "카드 줄 오른쪽 틈").toBe(true);

    // 목록 칸을 접는 토글이 없다(codex-ds 결정 32).
    await expect(page.getByRole("button", { name: "목록 패널 토글", exact: true })).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${screen.name}: 목록 머리가 경로 줄과 같은 48(size-pathbar)이고 제목 · 개수가 선다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(screen.url);
    const list = page.getByRole("region", { name: screen.list, exact: true });
    const head = listHead(list);
    await expect(head).toHaveCount(1);
    await expect(head.locator("span")).toHaveText(screen.head);

    const [box, column] = [await boxOf(head), await boxOf(list)];
    expect(box.height, "목록 머리 높이").toBe(parseFloat(await 토큰값(page, "height", "--size-pathbar")));
    expect(box.y, "목록 칸 맨 위").toBe(column.y);
    // 내용 칸에 경로 줄이 서는 화면(Archive 문서)은 두 머리가 한 줄이다 — 위끝과 높이가 같다.
    const bar = page.locator('main [data-slot="path-bar"]');
    if (screen.name === "Archive") await expect(bar).toHaveCount(1);
    if (await bar.count()) {
      const line = await boxOf(bar);
      expect([line.y, line.height], "경로 줄과 한 줄").toEqual([box.y, box.height]);
    }
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${screen.name}: 사이드바를 ⌘B로 접어도 목록 칸 위쪽의 조작이 칸 안 같은 자리다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(screen.url);
    const list = page.getByRole("region", { name: screen.list, exact: true });
    await expect(list).toBeVisible();

    /** 조작마다 목록 칸 왼쪽 위에서 잰 자리. */
    const offsets = async () => {
      const column = await boxOf(list);
      return Promise.all(
        screen.headControls(page).map(async (control) => {
          const box = await boxOf(control);
          return { x: box.x - column.x, y: box.y - column.y };
        }),
      );
    };
    const before = await offsets();

    // 신호등을 피할 일은 머리 줄 하나의 몫이다 — 목록 칸에는 그것을 피하는 여백 갈래가 없다. 카드는 창 왼쪽 틈까지 옮겨 가고,
    // 그 안의 조작은 칸 안에서 같은 자리다.
    await page.keyboard.press("Meta+b");
    const gap = await token(page, "--space-2");
    await expect.poll(async () => (await boxOf(joinedCard(page, list))).x).toBe(gap);
    await expect.poll(offsets).toEqual(before);
    for (const control of screen.headControls(page)) await expect(control).toBeVisible();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // **폭의 기본은 DS `size-list`(264)이고 범위는 240–560이다**(codex-ds 스펙 S4). 사람이 바꿔 둔 폭(로컬 저장)은 범위 안이면 그대로
  // 쓴다 — 기본값이 바뀌어도 고른 폭을 버리지 않는다(옛 기본 360도 그대로 선다). 범위 밖 값은 기본으로 선다.
  test(`${screen.name}: 세로 선을 끌면 목록 폭이 바뀌어 저장되고 두 번 누르면 기본 폭 size-list(264)다`, async ({ page }) => {
    await installFixtureBackend(page);
    // 곁에 패널이 열려 서는 화면(Archive)은 그 패널이 제 폭으로 서고도 560 목록 칸과 내용 칸의 최소가 드는 창에서 잰다 — 모자란 창에서
    // 목록 칸이 그려진 폭을 내주는 것은 `tab-row-floor.spec.ts`가 잰다.
    if (screen.panel) await page.setViewportSize({ width: 1600, height: 800 });
    await page.goto(screen.url);
    const list = page.getByRole("region", { name: screen.list, exact: true });
    const main = page.locator("main");
    await expect(list).toBeVisible();
    const 폭 = async () => (await boxOf(list)).width;
    const 저장 = () => page.evaluate((key) => localStorage.getItem(key), screen.widthKey);
    const 기본 = parseFloat(await 토큰값(page, "width", "--size-list"));
    expect(기본, "DS 수").toBe(264);
    expect(await 폭(), "저장된 폭이 없을 때").toBe(기본);

    // 선을 왼쪽으로 40 끈다 — 목록이 그만큼 넓어지고 내용 칸의 오른쪽 끝이 선을 따라온다.
    const handle = await boxOf(listHandle(page));
    const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 40, y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(폭).toBe(기본 + 40);
    expect((await boxOf(main)).right, "내용 칸이 선을 따라온다").toBe((await boxOf(list)).x);
    expect(await 저장()).toBe(String(기본 + 40));

    await page.reload();
    await expect(list).toBeVisible();
    await expect.poll(폭).toBe(기본 + 40);

    // 두 번 누르면 기본 폭이다.
    await listHandle(page).dblclick();
    await expect.poll(폭).toBe(기본);
    expect(await 저장()).toBe(String(기본));

    for (const [저장값, 선다] of [
      ["360", 360],
      ["240", 240],
      ["560", 560],
      ["600", 기본],
      ["239", 기본],
    ] as const) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [screen.widthKey, 저장값] as const);
      await page.reload();
      await expect(list).toBeVisible();
      expect(await 폭(), `저장된 폭 ${저장값}`).toBe(선다);
    }
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// **Projects의 ⌘Enter는 아무것도 하지 않는다**(codex-ds 결정 32) — 오른쪽 패널이 없는 화면이고, 목록 칸은 접지 않는다. 한때 이 키가
// 목록 칸을 접었고 그 접힘을 화면마다 로컬 저장에 적었다(`projects-panel-open` · `archive-panel-open`). 접어 둔 값이 남아 있어도
// 목록 칸이 서고, 앱은 그 값을 읽지 않고 지운다. 「아무 일도 안 한다」는 둘로 잰다: 화면(내용 칸 · 목록 폭 · `aside` 수)이 그대로이고,
// 그 키를 받아 막은(`preventDefault`) 리스너가 없다 — 화면만 재면 「받아서 다른 일을 했다」가 초록으로 지나간다.
test("Projects: ⌘Enter가 화면을 바꾸지 않고, 접어 두었던 목록 칸의 저장값은 지워진다", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("projects-panel-open", "0");
    localStorage.setItem("archive-panel-open", "0");
  });
  await installFixtureBackend(page);
  await page.goto(`/projects/${PROJECTS[0].slug}`);
  const list = page.getByRole("region", { name: "프로젝트 목록", exact: true });
  await expect(list).toBeVisible();
  expect((await boxOf(list)).width, "접어 둔 값이 있어도 목록 칸이 선다").toBe(
    parseFloat(await 토큰값(page, "width", "--size-list")),
  );
  expect(
    await page.evaluate(() => [localStorage.getItem("projects-panel-open"), localStorage.getItem("archive-panel-open")]),
    "접힘 값은 지워진다",
  ).toEqual([null, null]);

  const 화면 = async () => ({
    main: await boxOf(page.locator("main")),
    list: (await boxOf(list)).width,
    asides: await page.locator("aside").count(),
  });
  const before = await settle(page, 화면);
  // 창에서 그 키가 막혔는지를 적는다 — 앱의 리스너가 먼저 달려 있으므로 이 리스너가 그 뒤에 돈다.
  await page.evaluate(() => {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.metaKey) (window as unknown as { 막힌엔터: boolean }).막힌엔터 = e.defaultPrevented;
    });
  });
  await page.keyboard.press("Meta+Enter");
  expect(await page.evaluate(() => (window as unknown as { 막힌엔터?: boolean }).막힌엔터), "키를 받아 막은 리스너").toBe(false);
  expect(await settle(page, 화면)).toEqual(before);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 판 04 티켓 03 — **작업 화면**(ui-refresh 결정 4 · 5 · 15). 머리 줄 아래에 문서 카드(`<main>`)와 작업 패널 카드가 각자 뜨고, 사이
// 틈은 `--space-2`다. 패널의 바깥 상자는 여전히 두 번째 `aside`이고 폭이 「왼쪽 틈 + 카드」라, 접으면 틈이 카드와 함께 0으로 접혀
// 문서 카드가 오른쪽 틈 끝까지 넓어진다. 폭 손잡이는 그 틈의 가운데다(분할의 두 열 사이와 같은 자리).
const [pinnedWork, plainWork] = WORKS;
const 작업패널 = (page: Page) => page.getByRole("region", { name: "작업 패널", exact: true });

test("Works: 머리 줄 아래에 문서 카드와 작업 패널 카드가 틈 --space-2로 서고, 패널을 접으면 문서 카드가 오른쪽 틈 끝까지 넓어진다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const doc = page.locator("main");
  const panel = 작업패널(page);
  await expect(panel).toBeVisible();

  // 머리는 머리 줄 하나이고, `aside`는 사이드바와 작업 패널 둘이다 — 패널 카드는 두 번째 `aside` 안에 선다.
  await expect(page.locator("header")).toHaveCount(1);
  await expect(page.locator("aside")).toHaveCount(2);
  expect(await panel.evaluate((el) => el.closest("aside") === document.querySelectorAll("aside")[1])).toBe(true);

  const gap = await token(page, "--space-2");
  const prail = await token(page, "--size-prail");
  const titlebar = await token(page, "--titlebar-height");
  const viewport = page.viewportSize()!;
  const edge = await sidebarRight(page);
  const [card, side] = [await boxOf(doc), await boxOf(panel)];
  expect(card.y, "문서 카드 위").toBe(titlebar);
  expect(side.y, "패널 카드 위").toBe(titlebar);
  expect(card.x, "문서 카드 왼쪽").toBe(edge);
  expect(side.x - card.right, "문서와 패널 사이 틈").toBe(gap);
  // 패널 카드 오른쪽은 레일 열이다 — 칸이 `spec` · `files` 둘이라 레일이 서서(codex-ds 결정 25) 틈 · 레일 · 틈을 지나 창 끝이다.
  expect(viewport.width - side.right, "패널 오른쪽 틈 · 레일 · 틈").toBe(gap + prail + gap);
  // 끌어 바꾼 폭이 없으면 패널 카드는 DS 패널 폭 `size-panel`로 선다(codex-ds 스펙 S4). 폭 훅이 받는 수(`WORK_PANEL_WIDTH`)를 토큰과
  // 맞대고, 그 DS 수는 따로 센다 — 토큰이 바뀌는 날 견줌이 함께 흘러가지 않게.
  const 기본 = Number.parseFloat(await 토큰값(page, "width", "--size-panel"));
  expect(기본, "DS 수").toBe(340);
  expect(side.width, "패널 카드 기본 폭 = size-panel").toBe(기본);
  expect(viewport.height - side.bottom, "패널 아래 틈").toBe(gap);

  // 손잡이는 그 틈의 가운데이고 여전히 두 번째 `aside`의 자손이다. 드러난 틈은 창을 끄는 자리이고, 카드 안은 아니다.
  // 틈의 가운데 5px은 손잡이가 덮으므로 끄는 자리는 그 양옆이다 — 카드 바로 왼쪽 1px을 잰다(소수 좌표는 브라우저가
  // 반올림해 카드 안으로 떨어질 수 있다).
  const handle = await boxOf(page.locator("aside").nth(1).locator(HANDLE));
  expect(handle.x + handle.width / 2, "손잡이 가운데").toBe(card.right + gap / 2);
  const middleY = side.y + side.height / 2;
  expect(await 끄는자리(page, side.x - 1, middleY), "패널 카드 왼쪽 틈").toBe(true);
  expect(await 끄는자리(page, side.x + side.width / 2, side.bottom + gap / 2), "패널 카드 아래 틈").toBe(true);
  expect(await 끄는자리(page, side.x + side.width / 2, side.bottom - 4), "패널 카드 안").toBe(false);

  // ⌘Enter로 접으면 틈이 카드와 함께 접혀 문서 카드가 오른쪽 틈 끝(레일 열 앞)까지 넓어진다 — 닫힌 칸 옆에 틈이 겹쳐 남지 않는다.
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => (await boxOf(doc)).right).toBe(viewport.width - prail - 2 * gap);
  await page.getByRole("button", { name: "작업 패널 펼치기", exact: true }).click();
  await expect.poll(async () => (await boxOf(panel)).x - (await boxOf(doc)).right).toBe(gap);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** Tab을 `번` 번 누르는 동안 포커스가 둘째 `aside`(오른쪽 패널) 안에 선 횟수 — 포커스를 걷고 돈다. 한 바퀴가 이보다 짧아 여러 바퀴를 돈다. */
async function 패널정류장(page: Page, 번 = 60): Promise<number> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let count = 0;
  for (let n = 0; n < 번; n += 1) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.querySelectorAll("aside")[1]?.contains(document.activeElement) ?? false)) count += 1;
  }
  return count;
}

// **닫힌 오른쪽 패널은 Tab이 지나친다**(`Frame`의 `PanelBox`). 닫힌 칸은 폭만 0으로 접혀 DOM에 남으므로, 막지 않으면 Tab이 보이지
// 않는 트리 행에 선다(옛 Archive는 행 안에 펼친 트리를 `inert`로 막았다). 열린 동안은 그 행(폴더 머리)이 Tab 정류장이라 두 상태를
// 같은 길로 잰다 — 열린 쪽이 0이면 닫힌 쪽의 0도 아무것도 말하지 않는다. 칸은 두 화면이 한 벌이다(작업 패널 · spec 목록 패널).
const PANEL_SCREENS = [
  { name: "Works", url: `/works/${pinnedWork.slug}`, panel: "작업 패널" },
  { name: "Archive", url: `/archive/${ARCHIVE[0].slug}`, panel: "spec 목록" },
] as const;

for (const screen of PANEL_SCREENS) {
  test(`${screen.name}: 닫힌 오른쪽 패널은 Tab이 지나치고, 열린 동안은 그 안의 트리 행에 선다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(screen.url);
    const aside = page.locator("aside").nth(1);
    await expect(aside.getByRole("region", { name: screen.panel, exact: true })).toBeVisible();
    expect(await 패널정류장(page), "열린 패널").toBeGreaterThan(0);

    await page.getByRole("button", { name: `${screen.panel} 접기`, exact: true }).click();
    await expect.poll(async () => (await aside.boundingBox())!.width).toBe(0);
    expect(await 패널정류장(page), "닫힌 패널").toBe(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// codex-ds 티켓 18 — **작업 패널 머리는 「spec」과 spec 폴더 열기다**(codex-ds 스펙 §4 「패널 머리」 · §6 「작업 패널」). 제목은 DS 패널 머리
// 제목(`.at-panel-head .title` — 14/20 · 500)이고, 글자가 카드 + 16에 선다(머리 여백 8 + 제목 안쪽 8 — 행 글자 16, 스펙 §4 「여백」).
// 버튼은 머리 오른쪽 끝, 머리 줄의 가운데에 선다.
test("Works: 작업 패널 머리 제목이 DS 패널 머리 제목(14/20 · 500)이고 글자가 카드 + 16에 서며, spec 폴더 열기는 머리 오른쪽 끝이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const panel = 작업패널(page);
  const head = panel.locator('[data-slot="card-head"]');
  const title = head.getByText("spec", { exact: true });
  const open = head.getByRole("button", { name: "spec 폴더 열기", exact: true });
  await expect(title).toBeVisible();
  await expect(open).toBeVisible();

  expect(await 칠한값(title, "font-size", "line-height", "font-weight"), "제목 글자").toEqual(["14px", "20px", "500"]);
  const card = await boxOf(panel);
  // 글자가 그려진 자리 — 제목 상자의 안쪽 여백이 아니라 글자 줄 자체의 왼쪽 끝을 읽는다.
  const 글자 = await title.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().x;
  });
  expect(글자 - card.x, "제목 글자 — 카드 + 16").toBe(16);
  const [row, button] = [await boxOf(head), await boxOf(open)];
  const [padding] = await 칠한값(head, "padding-right");
  expect(button.right, "spec 폴더 열기 — 머리 안쪽 오른쪽 끝").toBe(row.right - parseFloat(padding));
  expect(button.y + button.height / 2, "spec 폴더 열기 — 머리 가운데").toBe(row.y + row.height / 2);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 티켓 13 — **머리 줄에 작업 화면의 머리 카드가 선다**(codex-ds 스펙 §4 · §6 · DS `HeadCard` · `.at-winhead`). 창 맨 위는
// 48 머리 줄(틈 8 · 머리 카드 32 · 틈 8)이고, 머리 카드는 그 줄에 뜬 흰 카드다 — 폭은 본문 열(사이드바 뒤 ~ 레일 앞 — 칸이
// `spec` · `files` 둘이라 레일이 선다, codex-ds 티켓 18), 높이는 `size-head`, 모서리는 `radius-xl`, 면은 `surface`에 0.5px 링
// (`shadow-hairline`)이다. 왼쪽에 ⚡ · work 이름이 서서 사이드바를 보지 않아도 지금 어느 work인지 안다(스토리 23). 오른쪽은 할 일
// (상태 배지 · ⋯) | 보기 배치(분할)이고 얇은 세로선이 가른다(스토리 24 · DS `.at-winctl-r`). 패널 토글은 레일이 서서 카드 밖 레일
// 위다(DS `.at-railtop`). 이름은 버튼이 아니다 — 우클릭 · ⇧F10으로 work 메뉴를 여는 대상이고(티켓 27 — `work-context-menu.spec.ts`),
// 두 번 클릭 · F2로 그 자리에서 이름을 바꾼다(티켓 28 — `inline-rename.spec.ts`).
test("Works: 머리 줄 48에 머리 카드가 본문 열 폭 · size-head로 서고 — 왼쪽에 ⚡ · work 이름, 오른쪽에 상태 배지 · ⋯ | 분할이 선다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const head = 머리카드(page);
  const panel = 작업패널(page);
  await expect(panel).toBeVisible();
  await expect(head).toHaveCount(1);

  // 길이는 토큰에서 읽고, 스펙이 못박은 수(머리 줄 48 · 머리 카드 32)는 따로 센다 — 토큰이 바뀌는 날 견줌이 함께 흘러가지 않게.
  const gap = await token(page, "--space-2");
  const row = await token(page, "--titlebar-height");
  const size = await token(page, "--size-head");
  expect([row, size], "머리 줄 · size-head").toEqual([48, 32]);
  const [card, header, doc, side] = [
    await boxOf(head),
    await boxOf(page.locator("header")),
    await boxOf(page.locator("main")),
    await boxOf(panel),
  ];
  expect([header.y, header.height], "머리 줄").toEqual([0, row]);
  expect(card.height, "머리 카드 높이").toBe(size);
  expect([card.y, row - card.bottom], "머리 카드 위 · 아래 틈").toEqual([gap, gap]);
  // 폭은 본문 열이다 — 본문 카드 왼쪽(사이드바 뒤)부터 작업 패널 카드 오른쪽까지. 레일이 서서 그 끝이 레일 열(틈 · 레일 · 틈) 앞이다.
  // 카드는 머리 줄 바로 아래에서 시작한다.
  const viewport = page.viewportSize()!;
  const prail = await token(page, "--size-prail");
  expect(card.x, "머리 카드 왼쪽 = 본문 카드 왼쪽").toBe(doc.x);
  expect(card.right, "머리 카드 오른쪽 = 작업 패널 카드 오른쪽").toBe(side.right);
  expect(side.right, "작업 패널 카드 오른쪽 = 레일 열 앞").toBe(viewport.width - gap - prail - gap);
  expect(doc.y, "본문 카드 위").toBe(row);
  // 사이드바 맨 위 빈 신호등 줄도 같은 48이다 — 사이드바의 첫 줄(「전체 | 내 차례」 — v1 티켓 42, 그 위의 검색 칸은 46이 걷었다)이
  // 본문 카드와 한 줄에서 시작한다. 그 줄이 제 높이를 따로 들면 두 열의 위끝이 갈린다.
  const 거르기 = page.locator("aside[data-sidebar]").getByRole("group", { name: "Thread 거르기", exact: true });
  expect((await boxOf(거르기)).y, "사이드바 거르기 줄 위 = 머리 줄 아래").toBe(row);
  expect(await 칠한값(head, "border-top-left-radius", "background-color")).toEqual([
    await 토큰값(page, "border-top-left-radius", "--radius-xl"),
    await 토큰색(page, "--surface"),
  ]);
  expect(await 토큰값(page, "border-top-left-radius", "--radius-xl"), "radius-xl").toBe("12px");
  expect(그림자((await 칠한값(head, "box-shadow"))[0]), "머리 카드 링").toBe(await 토큰값(page, "box-shadow", "--shadow-hairline"));

  // 왼쪽 — ⚡(work 아이콘이지 상태 글리프가 아니다)와 work 이름. 아이콘은 카드 + 16이다(DS — 아래 탭 줄의 첫 칸과 한 세로줄).
  const zap = head.locator("svg.lucide-zap");
  const name = head.getByText(pinnedWork.title, { exact: true });
  await expect(zap).toHaveCount(1);
  await expect(name).toBeVisible();
  // 이름을 글자로 집으면 이름 상자(DS `.at-wtitle` — ⚡ · 이름을 품는다)가 잡혀, 이름 글자의 자리는 그 안 글자 마디로 잰다(`첫글자`).
  const [icon, title] = [await boxOf(zap), await boxOf(name)];
  expect(icon.x - card.x, "⚡ — 카드 + 16").toBe(16);
  expect((await 첫글자(name)).x, "이름은 ⚡ 뒤").toBeGreaterThan(icon.right);
  // 이름은 버튼이 아니다(메뉴의 대상이자 이름 바꾸기의 자리라 포커스만 받는다). 역할이 없으니 듣는 키를 말한다 — F2(이름 바꾸기 —
  // `inline-rename.spec.ts`)와 ⇧F10 · 메뉴 키(`work-context-menu.spec.ts`가 그 키로 메뉴가 서는 것을 잰다).
  await expect(head.getByRole("button", { name: pinnedWork.title })).toHaveCount(0);
  await expect(name).toHaveAttribute("tabindex", "0");
  await expect(name).toHaveAttribute("aria-keyshortcuts", "F2 Shift+F10 ContextMenu");

  // 오른쪽 — 상태 배지 · ⋯ | 분할. 셋 다 24 높이로 카드 가운데 줄에 서고, ⋯와 분할 사이를 세로선이 가른다. 이름은 그 앞에서
  // 끝난다. 패널 토글은 레일이 서서 카드 밖 레일 위다(DS `.at-railtop`) — 카드 안에는 없다.
  const parts = [
    head.getByRole("button", { name: pinnedWork.status, exact: true }),
    head.getByRole("button", { name: "작업 메뉴", exact: true }),
    head.getByRole("separator"),
    head.getByRole("button", { name: "분할", exact: true }),
  ];
  await expect(head.getByRole("button", { name: "작업 패널 접기", exact: true })).toHaveCount(0);
  const boxes = await Promise.all(parts.map(boxOf));
  expect(title.right, "이름이 배지 앞에서 끝난다").toBeLessThanOrEqual(boxes[0].x);
  for (let at = 1; at < boxes.length; at += 1) {
    expect(boxes[at].x, `오른쪽 할 일 ${at}번째가 앞의 것 뒤에 선다`).toBeGreaterThanOrEqual(boxes[at - 1].right);
  }
  const [padding] = await 칠한값(head, "padding-right");
  expect(boxes[3].right, "분할이 카드 안쪽 오른쪽 끝").toBe(card.right - parseFloat(padding));
  const middle = card.y + card.height / 2;
  for (const [at, box] of [boxes[0], boxes[1], boxes[3]].entries()) {
    expect([box.height, box.y + box.height / 2], `오른쪽 조작 ${at}`).toEqual([24, middle]);
  }
  await expect(parts[2]).toHaveAttribute("aria-orientation", "vertical");

  // 작업 패널을 접어도 머리 카드는 본문 열 폭 그대로다 — 오른쪽 끝이 레일 열 앞까지 넓어진 본문 카드의 오른쪽이다.
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => (await boxOf(page.locator("main"))).right).toBe(card.right);
  expect((await boxOf(head)).right).toBe(card.right);

  // ⌘B로 사이드바를 접으면 머리 카드는 창 컨트롤 뒤 틈 하나부터 선다(DS 「머리 카드는 창 컨트롤 뒤부터」).
  await page.keyboard.press("Meta+b");
  const search = await boxOf(창검색버튼(page));
  await expect.poll(async () => (await boxOf(head)).x).toBe(search.right + gap);
  expect((await boxOf(head)).right).toBe(card.right);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 이름 상자의 폭은 DS `.at-wtitle`의 상한 520까지다 — 넓은 창에서도 긴 work 이름은 그 안에서 말줄임으로 준다. 그 너머는 카드의 빈
// 자리이고, 할 일 묶음은 그대로 카드 안쪽 오른쪽 끝에 붙는다(DS `.at-winctl-r`의 `margin-left: auto`).
test("Works: 머리 카드의 이름 칸은 520까지이고 긴 이름은 그 안에서 말줄임으로 준다 — 할 일 묶음은 카드 오른쪽 끝 그대로다", async ({
  page,
}) => {
  const work = { ...pinnedWork, title: "아주 긴 work 이름 ".repeat(30).trimEnd() };
  await installFixtureBackend(page, { list_works: WORKS.map((one) => (one.slug === work.slug ? work : one)) });
  await page.goto(`/works/${work.slug}`);
  const head = 머리카드(page);
  const name = head.getByText(work.title, { exact: true });
  await expect(name).toBeVisible();

  const card = await boxOf(head);
  // 앵커: 이 창에서 머리 카드는 상한보다 넉넉히 넓다 — 좁으면 아래 견줌이 상한이 아니라 카드가 남긴 폭을 잰다.
  expect(card.width).toBeGreaterThan(520 + 200);
  expect((await boxOf(name)).width, "이름 상자 — DS `.at-wtitle` 상한").toBe(520);
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth), "이름이 말줄임으로 준다").toBe(true);
  // 묶음의 끝은 보기 배치(분할)다 — 패널 토글은 레일이 서서 카드 밖 레일 위다(DS `.at-railtop`).
  const last = await boxOf(head.getByRole("button", { name: "분할", exact: true }));
  const [padding] = await 칠한값(head, "padding-right");
  expect(last.right, "할 일 묶음이 카드 안쪽 오른쪽 끝").toBe(card.right - parseFloat(padding));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **바꿀 수 있는 이름의 hover 면은 아이콘 · 이름 · 연필을 함께 덮는다**(DS `.at-wtitle` — 24 · 안쪽 0 8 · 사이 7 · `radius-md`, hover
// `fill-hover`, 연필 12 `fg-tertiary`의 왼쪽 -2). 면의 안쪽은 양쪽 8로 같다 — 아이콘 앞 8, 연필 뒤 8. 아이콘은 그대로 카드 + 16이고
// (카드 안쪽 8 + 면 안쪽 8), 글리프(아이콘 · 이름 글자)는 쉴 때 · hover · 고칠 때 한 자리다 — 고치기의 입력칸도 이름 글자가 선 자리에서
// 시작한다(`InlineRename`의 `fit="text"`). 면은 포커스 받는 그 이름 요소 자신이라, 포커스 링 · 대상 테두리도 이 면을 두른다.
test("Works: 머리 카드 이름의 hover 면이 ⚡ · 이름 · 연필을 함께 덮고 안쪽이 양쪽 8이며 — 글리프는 쉴 때 · hover · 고칠 때 한 자리다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  const head = 머리카드(page);
  const name = head.getByText(plainWork.title, { exact: true });
  const zap = head.locator("svg.lucide-zap");
  const pen = head.locator("svg.lucide-pencil");
  await expect(name).toBeVisible();

  const card = await boxOf(head);
  const 자리 = async () => ({ 아이콘: (await boxOf(zap)).x, 글자: (await 첫글자(name)).x });
  const 쉴때 = await 자리();
  expect(쉴때.아이콘 - card.x, "⚡ — 카드 + 16").toBe(16);

  await name.hover();
  await expect.poll(async () => (await 칠한값(name, "background-color"))[0], "hover 면").toBe(await 토큰색(page, "--fill-hover"));
  await expect.poll(async () => (await 칠한값(pen, "opacity"))[0], "hover에 연필이 선다").toBe("1");
  const [face, icon, mark, text] = [await boxOf(name), await boxOf(zap), await boxOf(pen), await 첫글자(name)];
  expect(icon.x - face.x, "면 왼쪽 안쪽 — 아이콘 앞 8").toBe(8);
  expect(face.right - mark.right, "면 오른쪽 안쪽 — 연필 뒤 8").toBeCloseTo(8, 1);
  expect([face.height, face.y + face.height / 2], "면 — 24, 머리 가운데").toEqual([24, card.y + card.height / 2]);
  expect([mark.width, mark.height], "연필 — 12").toEqual([12, 12]);
  expect(text.x - icon.right, "⚡ → 이름 — 사이 7").toBeCloseTo(7, 1);
  expect(mark.x - text.right, "이름 → 연필 — 사이 7에서 연필의 -2").toBeCloseTo(5, 1);
  expect((await 칠한값(name, "border-top-left-radius"))[0], "면 모서리").toBe(
    await 토큰값(page, "border-top-left-radius", "--radius-md"),
  );
  expect(await 자리(), "hover — 글리프 제자리").toEqual(쉴때);

  await name.dblclick();
  const input = head.getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();
  // 입력칸은 안쪽 여백이 없어 그 상자의 왼쪽이 글자의 왼쪽이다.
  expect((await 칠한값(input, "padding-left"))[0]).toBe("0px");
  expect({ 아이콘: (await boxOf(zap)).x, 글자: (await boxOf(input)).x }, "고칠 때 — 글리프 제자리").toEqual(쉴때);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 요청(2026-10-18 · 앱을 보는 사람) — **머리 카드의 work 이름 뒤에 그 work의 브랜치가 선다**. 모양은 프로젝트 화면 Works 행의 ⑂
// 브랜치와 같은 말이다(⑂ `GitFork` 12 · 고정폭 12 · `fg-secondary` · 사이 5). 자리는 이름의 면 밖, 면 끝에서 6이다 — 위치(`sub`)와
// 같은 자리(DS `.at-winhead`의 사이 4 + `.sub`의 왼쪽 2). 보이기만 해서 포커스를 받지 않는다 — 이름에서 Tab이 바로 상태 배지로 간다.
test("Works: 머리 카드의 work 이름 뒤에 ⑂ 브랜치가 고정폭 12 · fg-secondary로 서고 — 이름의 면 밖이며 포커스를 받지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const head = 머리카드(page);
  const name = head.getByText(pinnedWork.title, { exact: true });
  const branch = head.getByText(pinnedWork.branch!, { exact: true });
  const fork = head.locator("svg.lucide-git-fork");
  await expect(branch).toBeVisible();
  await expect(fork).toHaveCount(1);

  const [card, face, mark, text] = [await boxOf(head), await boxOf(name), await boxOf(fork), await boxOf(branch)];
  expect([mark.width, mark.height], "⑂ — 12").toEqual([12, 12]);
  const 회색 = await 토큰색(page, "--fg-secondary");
  expect(await 칠한값(branch, "font-family", "font-size", "color"), "브랜치 글자").toEqual([
    await 토큰값(page, "font-family", "--font-mono"),
    "12px",
    회색,
  ]);
  expect((await 칠한값(fork, "color"))[0], "⑂ 색").toBe(회색);
  expect(mark.x - face.right, "이름의 면 끝 → ⑂").toBeCloseTo(6, 1);
  expect(text.x - mark.right, "⑂ → 브랜치 글자").toBeCloseTo(5, 1);
  const middle = card.y + card.height / 2;
  expect(mark.y + mark.height / 2, "⑂ — 머리 가운데").toBe(middle);
  expect(text.y + text.height / 2, "브랜치 글자 — 머리 가운데").toBeCloseTo(middle, 0);
  expect(
    await branch.evaluate((el) => el.closest("[tabindex], button, a, input") === null),
    "브랜치는 이름의 면(포커스 받는 요소) 밖이고 제 포커스도 없다",
  ).toBe(true);

  await name.focus();
  await page.keyboard.press("Tab");
  await expect(head.getByRole("button", { name: pinnedWork.status, exact: true }), "이름 다음 포커스는 상태 배지").toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 브랜치는 이름에 자리를 내준다 — 이름의 면이 제 글자 폭(상한 520)을 먼저 갖고, 브랜치는 그 뒤 남는 폭에서 말줄임으로 준다. 남는
// 폭이 80 아래면 ⑂와 몇 글자도 못 들어 통째로 걷힌다 — 반쯤 잘린 ⑂가 서지 않는다. 남는 폭은 창을 좁혀 고른다: 이 창에서 창이 준
// 만큼 머리 카드가 준다(앵커로 센다).
test("Works: 좁은 창에서 머리 카드의 브랜치가 먼저 준다 — 이름은 제 폭 그대로이고, 브랜치는 말줄임으로 주다가 남는 폭이 80 아래면 걷힌다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const head = 머리카드(page);
  const name = head.getByText(pinnedWork.title, { exact: true });
  const branch = head.getByText(pinnedWork.branch!, { exact: true });
  await expect(branch).toBeVisible();
  const 넘친다 = (target: Locator) => target.evaluate((el) => el.scrollWidth > el.clientWidth);
  const [gap] = await 칠한값(head, "column-gap");
  // 브랜치가 받는 폭 — 이름의 면 끝에서 할 일 묶음 앞 사이까지.
  const 남는폭 = async () =>
    (await boxOf(head.locator("[data-head-actions]"))).x - parseFloat(gap) - (await boxOf(name)).right;

  const 처음 = { 창: page.viewportSize()!, 카드: (await boxOf(head)).width, 이름: (await boxOf(name)).width };
  expect(await 넘친다(branch), "넓은 창 — 브랜치가 다 든다").toBe(false);
  const 브랜치몫 = (await boxOf(branch)).right - (await boxOf(name)).right;
  const 좁힌다 = async (남길: number) => {
    const 카드 = (await boxOf(head)).width;
    const 창 = page.viewportSize()!;
    const 새폭 = Math.round(창.width - ((await 남는폭()) - 남길));
    await page.setViewportSize({ width: 새폭, height: 창.height });
    await expect
      .poll(async () => (await boxOf(head)).width, "앵커: 창이 준 만큼 머리 카드가 준다")
      .toBe(카드 - (창.width - 새폭));
  };

  // 남는 폭이 브랜치 몫보다 30 좁다 — 브랜치가 말줄임으로 주고 이름은 제 폭 그대로다.
  await 좁힌다(Math.round(브랜치몫 - 30));
  await expect(branch).toBeVisible();
  expect(await 넘친다(branch), "브랜치가 말줄임으로 준다").toBe(true);
  expect([(await boxOf(name)).width, await 넘친다(name)], "이름은 제 폭 그대로").toEqual([처음.이름, false]);

  // 남는 폭이 80 아래 — 브랜치가 통째로 걷히고 이름은 그대로다.
  await 좁힌다(60);
  await expect(branch).toBeHidden();
  await expect(head.locator("svg.lucide-git-fork")).toBeHidden();
  expect([(await boxOf(name)).width, await 넘친다(name)], "이름은 제 폭 그대로").toEqual([처음.이름, false]);

  // 더 좁히면 그제야 이름이 준다 — 브랜치는 걷힌 채다.
  await 좁힌다(-100);
  expect((await boxOf(name)).width, "이름이 준다").toBeLessThan(처음.이름);
  expect(await 넘친다(name), "이름이 말줄임으로 준다").toBe(true);
  await expect(branch).toBeHidden();
  expect(처음.카드, "앵커: 처음 창에서 머리 카드가 이름 · 브랜치보다 넓다").toBeGreaterThan(처음.이름 + 브랜치몫);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 프로젝트가 없는 work의 머리 카드에는 브랜치가 안 선다 — 이름이 미리 정해진 work(`start_work`에 브랜치를 건넸다)여도 어느 저장소에도
// 그 브랜치 · worktree가 없다. ⑂는 저장소에 선 브랜치의 말이라(프로젝트 화면 Works 행은 worktree가 선 행에만 ⑂를 둔다) 아직 없는
// 것을 있다고 하게 된다. 정해진 이름은 사이드바 호버 카드가 「브랜치」 줄로 말한다.
test("Works: 프로젝트가 없는 work의 머리 카드에는 브랜치가 안 선다 — 브랜치 이름이 미리 정해졌어도", async ({ page }) => {
  const reserved = { ...plainWork, branch: "feat/reserved-work" };
  await installFixtureBackend(page, { list_works: WORKS.map((one) => (one.slug === reserved.slug ? reserved : one)) });
  await page.goto(`/works/${reserved.slug}`);
  const head = 머리카드(page);
  await expect(head.getByText(reserved.title, { exact: true })).toBeVisible();
  await expect(head.locator("svg.lucide-git-fork")).toHaveCount(0);
  await expect(head.getByText(reserved.branch, { exact: true })).toHaveCount(0);

  // 대조: 프로젝트를 붙인 work로 가면 선다 — 위의 0이 머리 카드가 브랜치를 아예 안 그려서 나온 것이 아니다.
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(head.getByText(pinnedWork.branch!, { exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 창 컨트롤(사이드바 토글 · ← · → · 검색, 24)과 패널 토글이 머리 카드의 가운데 줄(위에서 24)에 선다(스토리 26). 컨트롤 사이는 Codex
// 값 2다(DS `.at-winctl`). 패널 토글은 레일이 서서 머리 카드 밖 레일 바로 위다(DS `.at-railtop` — 그 가로 자리는 위 레일 검사가
// 잰다). 신호등은 이 층이 그리지 않는다(`trafficLightPosition` — macOS 실기에서 본다).
test("Works: 창 컨트롤 넷과 패널 토글의 가운데가 머리 카드 가운데와 같은 높이이고, 컨트롤 사이는 2 · 패널 토글은 머리 카드 밖 레일 위다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const head = 머리카드(page);
  await expect(작업패널(page)).toBeVisible();

  const card = await boxOf(head);
  const middle = card.y + card.height / 2;
  expect(middle, "머리 카드 가운데 = 머리 줄 가운데").toBe((await token(page, "--titlebar-height")) / 2);
  const controls = await Promise.all(
    [
      ...["사이드바 토글", "뒤로", "앞으로"].map((name) => page.getByRole("button", { name, exact: true })),
      창검색버튼(page),
    ].map(boxOf),
  );
  for (const [at, box] of controls.entries()) {
    expect([box.width, box.height, box.y + box.height / 2], `창 컨트롤 ${at}`).toEqual([24, 24, middle]);
  }
  const gap = await token(page, "--titlebar-control-gap");
  expect(gap, "창 컨트롤 사이 — Codex 값").toBe(2);
  for (let at = 1; at < controls.length; at += 1) {
    expect(controls[at].x - controls[at - 1].right, `창 컨트롤 ${at - 1}과 ${at} 사이`).toBe(gap);
  }

  const toggle = page.getByRole("button", { name: "작업 패널 접기", exact: true });
  const knob = await boxOf(toggle);
  expect([knob.width, knob.height, knob.y + knob.height / 2], "패널 토글").toEqual([24, 24, middle]);
  expect(knob.x, "패널 토글은 머리 카드 오른쪽 너머").toBeGreaterThan(card.right);
  // 토글은 머리 줄에 서되 머리 카드 밖이고, 레일 · `aside` · `nav`의 자손이 아니다.
  expect(
    await toggle.evaluate(
      (el, card) => [el.closest(card) === null, el.closest('aside, nav, [aria-label="레일"]') === null],
      HEAD_CARD,
    ),
  ).toEqual([true, true]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 머리 줄 아이콘의 크기(codex-ds 스펙 §3 「머리 카드와 창 컨트롤 15」 · DS `AppShell` · `HeadCard` 미리보기의 `at-ib xs` + `s15`). 창
// 컨트롤 넷과 머리 카드의 아이콘 버튼(⋯ · 분할 · 패널 토글 · 편집기의 뒤로)은 24 상자에 15 글리프다. 머리 카드의 화면 아이콘(⚡ 등)은
// DS 부품 규칙 `.at-wtitle > .ic`의 14이고 — 스펙 문장의 15보다 부품이 못박은 값이 앞선다(스펙 머리말 「모양 정본은 DS」) — 상태
// 배지의 ⌄는 DS 미리보기의 `s12`다. 레일 칸 · 카드 안 28 아이콘 버튼의 16은 이 줄의 것이 아니다.
const HEAD_GLYPH_SCREENS = [
  {
    name: "Works",
    url: `/works/${pinnedWork.slug}`,
    icon: "zap",
    buttons: ["작업 메뉴", "분할"],
    // 레일이 서서 패널 토글은 머리 카드 밖 레일 위다 — 같은 머리 줄의 버튼이라 같은 15다.
    outside: ["작업 패널 접기"],
    chevron: pinnedWork.status,
  },
  { name: "Archive", url: `/archive/${ARCHIVE[0].slug}`, icon: "zap", buttons: ["아카이브 메뉴", "spec 목록 접기"] },
  { name: "레이아웃 편집기", url: SPEC_LAYOUT_EDITOR, icon: "settings", buttons: ["설정으로 돌아가기"] },
] as const;

/** 그 요소 안 글리프(svg) 하나의 [폭, 높이]. 둘 이상이면 어느 것을 쟀는지 모르므로 먼저 하나임을 센다. */
async function glyphOf(target: Locator) {
  const glyph = target.locator("svg");
  await expect(glyph).toHaveCount(1);
  const box = await boxOf(glyph);
  return [box.width, box.height];
}

for (const screen of HEAD_GLYPH_SCREENS) {
  test(`${screen.name}: 창 컨트롤 · 머리 카드 아이콘 버튼의 글리프가 15이고, 머리 카드의 화면 아이콘은 14다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(screen.url);
    const head = 머리카드(page);
    await expect(head.getByRole("button", { name: screen.buttons[screen.buttons.length - 1], exact: true })).toBeVisible();

    // 창 컨트롤은 머리 카드 밖 왼쪽 위 묶음이다(`ShellControls`) — 화면마다 같은 것이 선다.
    for (const name of ["사이드바 토글", "뒤로", "앞으로"]) {
      expect(await glyphOf(page.getByRole("button", { name, exact: true })), `창 컨트롤 ${name}`).toEqual([15, 15]);
    }
    expect(await glyphOf(창검색버튼(page)), "창 컨트롤 검색").toEqual([15, 15]);
    for (const name of screen.buttons) {
      expect(await glyphOf(head.getByRole("button", { name, exact: true })), `머리 카드 ${name}`).toEqual([15, 15]);
    }
    for (const name of "outside" in screen ? screen.outside : []) {
      expect(await glyphOf(page.locator("header").getByRole("button", { name, exact: true })), `머리 줄 ${name}`).toEqual([15, 15]);
    }
    const icon = await boxOf(head.locator(`svg.lucide-${screen.icon}`));
    expect([icon.width, icon.height], "머리 카드의 화면 아이콘 — DS `.at-wtitle > .ic`").toEqual([14, 14]);
    if ("chevron" in screen) {
      const badge = head.getByRole("button", { name: screen.chevron, exact: true });
      expect(await glyphOf(badge), "상태 배지 ⌄ — DS `s12`").toEqual([12, 12]);
    }
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 머리 줄의 회색과 **머리 카드의 빈 자리**가 창을 끄는 자리다(codex-ds 스펙 §4 「드래그 영역」 · 요청 2026-10-18 「머리 카드 빈 자리
// 드래그도 되게」). 머리 카드는 뿌리에 `deep`을 달아 그 안의 빈 자리 · 보이기만 하는 것(브랜치 ⑂ · 글자)을 눌러도 창이 끌린다 —
// 창 맨 위 줄의 관례다(macOS 제목 막대의 제목 글자도 끈다). 누를 것은 끌지 않는다: 이름(포커스를 받고 두 번 클릭이 이름 바꾸기다 —
// 끄는 자리의 두 번 클릭은 창 키우기다)과 그 안의 ⚡, 상태 배지 · ⋯ · 분할, 고치는 동안의 이름 상자. 패널 토글은 레일이 서서 카드
// 밖 레일 위다 — 토글은 눌리고, 그 둘레(머리 카드와 토글 사이 · 토글 위 틈)는 회색이라 끄는 자리다. 레일 열의 둘레는 아래 레일
// 검사가 잰다.
test("Works: 머리 줄의 회색과 머리 카드의 빈 자리 · 브랜치가 창을 끄는 자리이고, 이름 · 할 일 · 패널 토글 · 고치는 이름 상자는 아니다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const head = 머리카드(page);
  await expect(작업패널(page)).toBeVisible();

  const gap = await token(page, "--space-2");
  const viewport = page.viewportSize()!;
  const card = await boxOf(head);
  const middle = card.y + card.height / 2;
  const knob = await boxOf(page.getByRole("button", { name: "작업 패널 접기", exact: true }));
  const nameEl = head.getByText(pinnedWork.title, { exact: true });
  const name = await boxOf(nameEl);
  const zap = await boxOf(head.locator("svg.lucide-zap"));
  const fork = await boxOf(head.locator("svg.lucide-git-fork"));
  const branch = await boxOf(head.getByText(pinnedWork.branch!, { exact: true }));
  const badge = await boxOf(head.getByRole("button", { name: pinnedWork.status, exact: true }));
  const menu = await boxOf(head.getByRole("button", { name: "작업 메뉴", exact: true }));
  const split = await boxOf(head.getByRole("button", { name: "분할", exact: true }));
  // 앵커: 브랜치와 배지 사이에 카드의 빈 자리가 있다 — 붙어 있으면 아래 「카드 안 빈 자리」가 글자나 버튼 위에 떨어진다.
  expect(badge.x - branch.right).toBeGreaterThan(8);

  expect(await 끄는자리(page, card.x + card.width / 2, gap / 2), "머리 카드 위 틈").toBe(true);
  expect(await 끄는자리(page, card.x + card.width / 2, card.bottom + gap / 2), "머리 카드 아래 틈").toBe(true);
  expect(await 끄는자리(page, viewport.width - gap / 2, middle), "머리 줄 오른쪽 틈").toBe(true);
  expect(await 끄는자리(page, knob.x + knob.width / 2, gap / 2), "패널 토글 위 틈").toBe(true);
  expect(await 끄는자리(page, card.right + gap / 2, middle), "머리 카드와 패널 토글 사이").toBe(true);
  // 머리 카드 안 — 빈 자리 · 모서리 안쪽 · 할 일 사이 · 보이기만 하는 브랜치는 끈다.
  expect(await 끄는자리(page, (branch.right + badge.x) / 2, middle), "머리 카드 안 빈 자리").toBe(true);
  expect(await 끄는자리(page, card.x + 4, middle), "머리 카드 왼쪽 안").toBe(true);
  expect(await 끄는자리(page, card.right - 2, middle), "머리 카드 오른쪽 안").toBe(true);
  expect(await 끄는자리(page, (menu.right + split.x) / 2, middle), "⋯와 분할 사이(세로선 자리)").toBe(true);
  expect(await 끄는자리(page, (name.right + fork.x) / 2, middle), "이름 면과 ⑂ 사이").toBe(true);
  expect(await 끄는자리(page, fork.x + fork.width / 2, middle), "브랜치 ⑂").toBe(true);
  expect(await 끄는자리(page, branch.x + 4, middle), "브랜치 글자").toBe(true);
  // 대조: 누를 것 — 이름(그 안의 ⚡까지)과 조작은 끌지 않는다.
  expect(await 끄는자리(page, name.x + 4, middle), "이름 면 왼쪽 안쪽").toBe(false);
  expect(await 끄는자리(page, zap.x + zap.width / 2, middle), "이름 안의 ⚡").toBe(false);
  expect(await 끄는자리(page, name.x + name.width / 2, middle), "이름 글자").toBe(false);
  expect(await 끄는자리(page, badge.x + badge.width / 2, middle), "상태 배지").toBe(false);
  expect(await 끄는자리(page, menu.x + menu.width / 2, middle), "⋯").toBe(false);
  expect(await 끄는자리(page, split.x + split.width / 2, middle), "분할").toBe(false);
  expect(await 끄는자리(page, knob.x + knob.width / 2, middle), "패널 토글").toBe(false);

  // 고치는 동안의 이름 상자도 끌지 않는다 — 입력칸 둘레 · 그 앞 ⚡를 누르거나 두 번 눌러도 창이 끌리거나 커지지 않는다.
  await nameEl.dblclick();
  const input = head.getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();
  const field = await boxOf(input);
  expect(await 끄는자리(page, zap.x + zap.width / 2, middle), "고칠 때 ⚡").toBe(false);
  expect(await 끄는자리(page, field.x - 2, middle), "고칠 때 입력칸 왼쪽 둘레").toBe(false);
  expect(await 끄는자리(page, field.x + 4, middle), "고칠 때 입력칸").toBe(false);
  expect(await 끄는자리(page, (branch.right + badge.x) / 2, middle), "고칠 때도 카드 안 빈 자리는 끈다").toBe(true);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 티켓 14 — **다른 화면도 머리 카드에 그 화면의 이름과 할 일을 든다**(codex-ds 스펙 §7 · 스토리 27 · 52 · 59 · 60). 어느 화면이든
// 같은 자리(창 맨 위 머리 카드)에서 할 일을 찾는다. 왼쪽은 그 화면 · 고른 것의 아이콘과 이름(과 그 안의 위치)이고, 오른쪽은 지금 앱에
// 있던 머리 조작이다 — 한때 본문 카드 머리의 위치와 끝 버튼이었다. 캔버스에만 있던 조작(Projects 「LLM이 받는 텍스트」 ·
// Processes 「새로 고침」 · 「고아 정리」 · Archive 「되살리기」)은 짓지 않았다(codex-ds 스펙 S13 · 결정 31). 조작은 역할 · 이름으로 집고,
// 위 줄에 서는 것은 모두 24로 머리 카드의 가운데 줄에 선다(DS `HeadCard`). 카드 안에 고를 것이 남지 않은 화면은 본문 카드에 머리가 없다.
const HEAD_SCREENS: {
  name: string;
  url: string;
  overrides?: Record<string, unknown>;
  /** 머리 카드 왼쪽 아이콘의 lucide 이름. */
  icon: string;
  /** 머리 카드에 보이는 이름과 그 뒤의 글자 — 왼쪽부터. 첫째는 이름이다. 날짜처럼 그리는 규칙이 따로 정하는 글자는 정규식이다. */
  words: readonly [string, ...(string | RegExp)[]];
  /** 이름 바로 뒤(`words`의 둘째)가 옅은 글자(`sub`)인가. */
  sub?: true;
  /** 이름이 누를 것인가(메뉴의 대상 · 그 자리 이름 바꾸기) — 포커스를 받고 창을 끌지 않는다. 아니면 보이기만 하는 글자라 창을 끈다. */
  target?: true;
  /** 머리 카드의 버튼 — 왼쪽부터, 이름으로. 이것뿐이다. */
  controls: readonly string[];
  /** 세로선이 서는 자리 — 이 이름의 버튼 바로 앞. 없으면 세로선이 없다. */
  splitBefore?: string;
  /** 캔버스에만 있어 짓지 않은 조작 — 화면 어디에도 없다. */
  absent: readonly string[];
}[] = [
  {
    name: "Projects",
    url: `/projects/${PROJECTS[0].slug}`,
    icon: "folder",
    words: [PROJECTS[0].name],
    target: true,
    controls: ["폴더 열기", "제거"],
    splitBefore: "제거",
    absent: ["LLM이 받는 텍스트"],
  },
  {
    name: "Archive",
    url: `/archive/${ARCHIVE[0].slug}`,
    icon: "zap",
    // 제목 뒤 옅은 글자는 걸쳤던 프로젝트와 치운 날이다 — 문서 카드의 머리 자리를 경로 줄이 가져 이리 왔다.
    words: [ARCHIVE[0].title, new RegExp(`^${ARCHIVE[0].projects.join(" · ")} · .+에 치움$`), ARCHIVE[0].status],
    sub: true,
    // 배지는 보이기만 한다 — 버튼이 아니다. 할 일은 ⋯ 아카이브 메뉴이고, 세로선 너머가 spec 목록 패널의 토글이다(codex-ds 티켓 21 —
    // 메뉴 안과 여닫기는 `archive-docs.spec.ts`).
    controls: ["아카이브 메뉴", "spec 목록 접기"],
    splitBefore: "spec 목록 접기",
    absent: ["되살리기"],
  },
  {
    name: "Processes",
    url: "/processes",
    icon: "activity",
    words: ["Processes"],
    controls: ["조용한 셸 모두 닫기"],
    absent: ["새로 고침", "고아 정리"],
  },
  {
    name: "Settings",
    url: "/settings/terminal",
    icon: "settings",
    words: ["Settings", "터미널"],
    sub: true,
    controls: ["저장"],
    absent: [],
  },
  {
    name: "레이아웃 편집기",
    url: SPEC_LAYOUT_EDITOR,
    icon: "settings",
    words: ["Settings", "spec 레이아웃", "Atelier"],
    sub: true,
    controls: ["설정으로 돌아가기", "LLM이 받는 텍스트", "저장"],
    absent: [],
  },
  { name: "Terminal", url: "/terminal", icon: "square-terminal", words: ["Terminal"], controls: [], absent: [] },
  {
    name: "Works(고른 작업 없음)",
    url: "/works",
    overrides: { list_works: [] },
    icon: "zap",
    words: ["Works"],
    controls: [],
    absent: [],
  },
];

for (const screen of HEAD_SCREENS) {
  test(`${screen.name}: 머리 카드에 그 화면의 이름과 할 일이 서고, 캔버스에만 있던 조작은 없다`, async ({ page }) => {
    await installFixtureBackend(page, screen.overrides);
    await page.goto(screen.url);
    const head = 머리카드(page);
    await expect(head.getByText(screen.words[0], { exact: true })).toBeVisible();
    await expect(head).toHaveCount(1);

    // 왼쪽 — 아이콘 하나와 이름(그 뒤 위치)이 차례로 선다. 이름을 글자로 집으면 이름 상자(DS `.at-wtitle` — 아이콘 · 이름을 품는다)가
    // 잡혀, 이름 글자의 자리는 그 안 글자 마디로 잰다(`첫글자`).
    await expect(head.locator(`svg.lucide-${screen.icon}`)).toHaveCount(1);
    const iconBox = await boxOf(head.locator(`svg.lucide-${screen.icon}`));
    const words = await Promise.all(
      screen.words.map((word) => boxOf(head.getByText(word, typeof word === "string" ? { exact: true } : undefined))),
    );
    const nameText = await 첫글자(head.getByText(screen.words[0], { exact: true }));
    expect(nameText.x, "이름은 아이콘 뒤").toBeGreaterThan(iconBox.right);
    for (let at = 1; at < words.length; at += 1) {
      expect(words[at].x, `${screen.words[at]}가 앞 글자 뒤에 선다`).toBeGreaterThanOrEqual(words[at - 1].right);
    }
    // 이름 끝에서 그 뒤 옅은 글자(`sub`)까지는 DS 14다 — 이름 상자의 오른쪽 안쪽 8 + 머리 카드의 사이 4 + `.sub`의 왼쪽 2(DS
    // `.at-wtitle` · `.at-winhead` · `.at-winhead .sub`).
    if (screen.sub) expect(words[1].x - nameText.right, "이름 끝 → 위치").toBeCloseTo(14, 1);

    // 오른쪽 — 할 일은 이 버튼들뿐이고 차례가 이렇다. 모두 24이고 머리 카드의 가운데 줄에 선다.
    const card = await boxOf(head);
    const middle = card.y + card.height / 2;
    await expect(head.getByRole("button")).toHaveCount(screen.controls.length);
    const controls = await Promise.all(
      screen.controls.map((name) => boxOf(head.getByRole("button", { name, exact: true }))),
    );
    for (const [at, box] of controls.entries()) {
      const name = screen.controls[at];
      expect([box.height, box.y + box.height / 2], `${name} — 24 · 가운데 줄`).toEqual([24, middle]);
      expect(box.right, `${name}가 머리 카드 안`).toBeLessThanOrEqual(card.right);
      if (at > 0) expect(box.x, `${name}가 앞의 것 뒤에 선다`).toBeGreaterThanOrEqual(controls[at - 1].right);
    }
    // 세로선은 할 일과 그 너머(보기 배치 · 위험한 할 일)를 가른다 — 그 자리에만 하나 선다.
    const separator = head.getByRole("separator");
    if (screen.splitBefore === undefined) {
      await expect(separator).toHaveCount(0);
    } else {
      const line = await boxOf(separator);
      const after = controls[screen.controls.indexOf(screen.splitBefore)];
      expect(line.right, "세로선 뒤가 그 버튼").toBeLessThanOrEqual(after.x);
      expect(line.x, "세로선 앞이 이름 · 할 일").toBeGreaterThanOrEqual(words[words.length - 1].right);
    }
    for (const name of screen.absent) {
      await expect(page.getByRole("button", { name, exact: true }), `${name}는 캔버스에만 있다`).toHaveCount(0);
    }

    // 창 끌기(요청 2026-10-18 「머리 카드 빈 자리 드래그도 되게」) — 머리 카드의 빈 자리와 보이기만 하는 것(아이콘 · 이름 · 위치 · 배지
    // 글자)을 누르면 창이 끌린다. 누를 것(조작 · 메뉴가 있거나 바꿀 수 있는 이름과 그 안의 아이콘)은 끌지 않는다.
    expect(await 끄는자리(page, iconBox.x + iconBox.width / 2, middle), "아이콘").toBe(!screen.target);
    for (const [at, box] of words.entries()) {
      const 끈다 = at === 0 ? !screen.target : true;
      expect(await 끄는자리(page, box.x + Math.min(4, box.width / 2), middle), `${screen.words[at]}`).toBe(끈다);
    }
    // 잠긴 버튼은 포인터를 안 받아(`Button` 머리말 — `disabled:pointer-events-none`) 누르면 그 아래 머리 카드가 잡힌다 — 빈 자리처럼
    // 끈다(Settings · 편집기의 바뀐 것 없는 [저장]).
    for (const [at, box] of controls.entries()) {
      const 잠김 = await head.getByRole("button", { name: screen.controls[at], exact: true }).isDisabled();
      expect(await 끄는자리(page, box.x + box.width / 2, middle), screen.controls[at]).toBe(잠김);
    }
    // 빈 자리 — 왼쪽 글자 끝과 할 일 묶음 앞 사이(묶음이 없으면 카드 안쪽 오른쪽 끝 앞)와 카드의 왼쪽 안쪽.
    const actions = head.locator("[data-head-actions]");
    const [padding] = await 칠한값(head, "padding-right");
    const 할일앞 = (await actions.count()) > 0 ? (await boxOf(actions)).x : card.right - parseFloat(padding);
    const 글자끝 = Math.max(...words.filter((box) => box.x < 할일앞).map((box) => box.right));
    expect(할일앞 - 글자끝, "앵커: 글자와 할 일 사이에 빈 자리가 있다").toBeGreaterThan(8);
    expect(await 끄는자리(page, (글자끝 + 할일앞) / 2, middle), "머리 카드 안 빈 자리").toBe(true);
    expect(await 끄는자리(page, card.x + 4, middle), "머리 카드 왼쪽 안").toBe(true);

    // 고를 것이 남지 않은 본문 카드에는 머리가 없다 — 위치와 할 일은 머리 카드가 말한다(목록 칸의 찾기 칸 · 머리는 `main` 밖이다).
    await expect(page.locator('main [data-slot="card-head"]')).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 판 04 티켓 03 — **분할의 두 열도 각자 카드이고, 사이 틈이 창을 끄는 자리다**(ui-refresh 결정 15 · 27). 두 열은 공용 틀의 분할
// (`Frame`의 `split`)이 목록 · 패널 칸과 같은 규칙으로 그린다: 틈은 `--space-2`이고 왼쪽 열 상자의 안쪽 여백이라 그 상자가 끌기 영역이며,
// 폭 손잡이는 그 틈의 가운데다. 손잡이를 끄는 것 · 비율 저장 · PTY 격자는 `works-split.spec.ts`가 잰다 — 여기는 그 틈을 누르면 무엇이
// 눌리는가다. 한때 이 틈만 어느 L3도 재지 않았다(분할을 화면이 손으로 그리던 때).
test("Works: 분할이면 두 열이 각자 카드이고 사이 틈 --space-2가 창을 끄는 자리다 — 손잡이는 그 틈의 가운데다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?split=lr`);
  const cards = page.locator("main").locator('[data-slot="card"]');
  await expect(cards).toHaveCount(2);
  // 머리는 머리 줄 하나이고, `aside`는 사이드바와 (분할로 들어와 접힌) 작업 패널 둘 그대로다 — 열 카드는 `aside`가 아니다.
  await expect(page.locator("header")).toHaveCount(1);
  await expect(page.locator("aside")).toHaveCount(2);

  const gap = await token(page, "--space-2");
  const titlebar = await token(page, "--titlebar-height");
  const [left, right] = [await boxOf(cards.first()), await boxOf(cards.last())];
  expect(left.y, "왼쪽 열 카드 위").toBe(titlebar);
  expect(right.y, "오른쪽 열 카드 위").toBe(titlebar);
  expect(right.x - left.right, "두 열 사이 틈").toBe(gap);

  // 손잡이는 그 틈의 가운데다. 손잡이(5px)가 틈(8px)의 가운데라 드러난 띠는 양쪽 1.5px씩이고, 손잡이 쪽 경계는 서브픽셀이라 짚는
  // 자리가 반올림에 걸린다 — 패널 칸(카드 왼쪽 − 1)의 검사와 같은 손버릇으로 카드 모서리 바로 옆을 짚는다.
  const handle = await boxOf(page.locator("main").locator(HANDLE));
  expect(handle.x + handle.width / 2, "손잡이 가운데").toBe(left.right + gap / 2);
  const middleY = left.y + left.height / 2;
  expect(await 끄는자리(page, left.right + 0.5, middleY), "왼쪽 열 카드 오른쪽 틈").toBe(true);
  expect(await 끄는자리(page, right.x - 1, middleY), "오른쪽 열 카드 왼쪽 틈").toBe(true);
  // 대조: 카드 안과 손잡이는 끄는 자리가 아니다 — 손잡이를 누르면 창이 아니라 두 열의 경계를 끈다.
  expect(await 끄는자리(page, left.x + left.width / 2, middleY), "왼쪽 열 카드 안").toBe(false);
  expect(await 끄는자리(page, right.x + right.width / 2, middleY), "오른쪽 열 카드 안").toBe(false);
  expect(await 끄는자리(page, left.right + gap / 2, middleY), "손잡이").toBe(false);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 티켓 08 — **모서리 · 그림자 · 패널 박자가 Codex 토큰에서 나온다**(codex-ds 결정 27 · 스펙 §2 「반경 · 그림자 · 움직임」).
// 칠해진 값(computed style — 하네스의 `칠한값`)을 토큰을 칠한 값(하네스의 `토큰값`)과 맞대고, 스펙이 못박은 수(카드 16 · 패널 220ms)는 따로 센다 — 토큰 값이
// 바뀌는 날 견줌이 함께 흘러가 초록으로 남지 않게.

/** 카드의 링 — 카드가 제 안쪽 가장자리에 덮는 `::after`의 `box-shadow`다(`Frame`의 `Card`). */
const 카드링 = (card: Locator) => card.evaluate((el) => getComputedStyle(el, "::after").boxShadow);

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

// 바탕 위 카드의 링은 **칠해져야** 한다(codex-ds 결정 27 — 바탕 위 카드의 테두리는 0.5px 링뿐이다). 접히는 칸(작업 패널)의 바깥
// 상자는 접히는 동안 안쪽 열을 잘라 내려고 넘침을 숨기고, 카드는 그 상자의 세 변에 붙어 선다 — 링을 카드 바깥에 그리면 그 세 변에서
// 잘려 틈 쪽 한 변에만 남는다. 내용 | 목록 카드(codex-ds 결정 28)는 두 칸을 한 링이 두른다 — 안의 칸은 링을 따로 그리지 않는다.
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
  expect(await 링이칠해진변(page, joinedCard(page, list)), "내용 | 목록 카드").toEqual(네변);
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
    // 셸 컨트롤 줄 — 첫 칸이 사이드바 토글이다. 전체화면에 들고 날 때 머리 줄의 왼쪽 여백과 함께 옮겨 간다(`ShellControls`).
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

// codex-ds 티켓 11 — **메뉴가 Codex `Menu` 모양이다**(codex-ds 결정 10 · 스펙 §3 「메뉴」 · DS `.at-menu` · `.at-mi`). 작업 ⋯ 메뉴 하나를
// 열어 칠해진 값을 토큰과 맞댄다 — 카드의 폭 · 반경 · 그림자, 줄의 높이 · 반경, 줄 글리프의 크기 · 색, 지우기 줄의 글자색, 뜨는 박자.
// 스펙이 못박은 수(폭 260 · 줄 30 · 글리프 15)는 따로 센다. 앱의 메뉴는 모두 같은 부품(`dropdown-menu.tsx`)이 그려 한 메뉴로 잰다.
test("Works: 작업 ⋯ 메뉴는 폭 260 · 반경 16 · shadow-prominent 카드에 30 줄이고, 줄 글리프는 15 fg-secondary · 삭제는 danger 글자다 — duration-dropdown · ease-enter-snappy로 0.98에서 뜬다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await page.getByRole("button", { name: "작업 메뉴", exact: true }).click();
  const menu = page.getByRole("menu");
  const 줄 = menu.getByRole("menuitem");
  // 하위 메뉴를 여는 줄(▸ — Finder에서 열기 · 복사 · 상태)도 같은 줄이다(`menu-row`). 순서는 `works-floating.spec.ts`의 work 메뉴 절이 잰다.
  await expect(줄).toHaveText(["Finder에서 열기", "이름 바꾸기F2", "복사", "상태", "고정 풀기", "아카이브", "삭제"]);

  const 폭 = await 토큰값(page, "width", "--size-menu");
  expect(폭, "메뉴 폭 — size-menu").toBe("260px");
  const 카드 = [폭, await 토큰값(page, "border-top-left-radius", "--radius-2xl"), await 토큰값(page, "box-shadow", "--shadow-prominent")];
  const [카드폭, 카드반경, 카드그림자] = await 칠한값(menu, "width", "border-top-left-radius", "box-shadow");
  expect([카드폭, 카드반경, 그림자(카드그림자)], "카드 폭 · 반경 · 그림자").toEqual(카드);

  const 줄반경 = await 토큰값(page, "border-top-left-radius", "--radius-lg");
  expect(줄반경, "메뉴 줄 반경 — radius-lg").toBe("10px");
  for (const one of await 줄.all()) {
    expect(await 칠한값(one, "height", "border-top-left-radius"), `「${await one.textContent()}」 줄`).toEqual(["30px", 줄반경]);
  }
  // 글리프는 크기 · 색을 안 준 lucide 그림이다(work 메뉴의 정의 `WorkMenuItems.tsx`) — 줄이 주는 값이 그대로 선다.
  const 회색 = await 토큰색(page, "--fg-secondary");
  const 글리프 = menu.getByRole("menuitem", { name: "이름 바꾸기" }).locator("svg");
  expect(await 칠한값(글리프, "width", "height", "color"), "줄 글리프").toEqual(["15px", "15px", 회색]);
  const 빨강 = await 토큰색(page, "--danger");
  expect(빨강, "danger와 fg-secondary가 같은 색이다").not.toBe(회색);
  const 삭제 = menu.getByRole("menuitem", { name: "삭제" });
  expect([...(await 칠한값(삭제, "color")), ...(await 칠한값(삭제.locator("svg"), "color"))], "삭제 줄의 글자 · 글리프").toEqual([빨강, 빨강]);

  // 뜨는 박자 — 열림 애니메이션은 `data-open`에서 붙어 열려 있는 동안 남는다(`works-floating.spec.ts`의 「애니메이션」). 지연 30ms는 DS 값이다.
  const 길이 = await 토큰값(page, "animation-duration", "--duration-dropdown");
  expect(밀리초(길이), "메뉴 열림 — duration-dropdown").toBe(320);
  const 곡선 = await 토큰값(page, "animation-timing-function", "--ease-enter-snappy");
  expect(await 칠한값(menu, "animation-duration", "animation-timing-function", "animation-delay"), "열림 박자").toEqual([
    길이,
    곡선,
    "0.03s",
  ]);

  // 첫 장면 — 0.98 크기의 투명한 카드에서 시작한다. 끝난 애니메이션은 읽을 것이 없어, 토큰을 늘려 두고 다시 열어 도는 애니메이션을
  // 처음에 세운다(지연 동안도 첫 장면이다 — `fill-mode-backwards`). 늘린 길이가 그대로 칠해지는 것이 박자가 토큰을 읽는다는 증거다.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.evaluate(() => document.documentElement.style.setProperty("--duration-dropdown", "60s"));
  await page.getByRole("button", { name: "작업 메뉴", exact: true }).click();
  const 첫장면 = await menu.evaluate((el) => {
    const [animation] = el.getAnimations();
    animation.pause();
    animation.currentTime = 0;
    const style = getComputedStyle(el);
    const { a, d } = new DOMMatrix(style.transform);
    return { 길이: style.animationDuration, 크기: [a, d].map((one) => Math.round(one * 1000) / 1000), 불투명도: style.opacity };
  });
  expect(첫장면, "열림의 첫 장면").toEqual({ 길이: "60s", 크기: [0.98, 0.98], 불투명도: "0" });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 고른 값의 체크(`MenuCheck`)는 줄의 다른 글리프(15 · `fg-secondary`)와 다르다 — DS `.at-mi .chk`(`ic-check s14`)대로 14 · `fg`다.
// 상태 메뉴의 지금 상태 줄이 그 체크를 그리는 자리다(라디오 줄 — Select 목록의 고른 줄도 같은 그림이다).
test("Works: 상태 메뉴에서 지금 상태 줄 끝의 체크는 14 · fg다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await page.getByRole("button", { name: pinnedWork.status, exact: true }).click();
  const 지금 = page.getByRole("menu").getByRole("menuitemradio", { checked: true });
  await expect(지금).toHaveCount(1);
  const 체크 = 지금.locator("svg.lucide-check");
  await expect(체크).toHaveCount(1);

  const 검정 = await 토큰색(page, "--fg");
  expect(검정, "fg와 fg-secondary가 같은 색이다").not.toBe(await 토큰색(page, "--fg-secondary"));
  expect(await 칠한값(체크, "width", "height", "color"), "체크").toEqual(["14px", "14px", 검정]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 라디오 줄도 메뉴의 다른 줄처럼 **줄 사이 2px**로 선다(DS `.at-menu`의 `gap: 2px` — 앱은 `menu-list`). 라디오 줄은 묶음
// (`DropdownMenuRadioGroup`) 안에 서서 목록의 flex 사이를 받지 못한다 — 묶음이 같은 사이를 다시 준다. 한때 묶음이 맨 div라 라디오 줄만
// 30 간격으로 붙어 섰다(codex-ds 티켓 34의 화면 맞대기). 기준은 같은 메뉴 부품의 보통 줄(work ⋯ 메뉴의 「이름 바꾸기」 → 「복사」)이고,
// 라디오 묶음이 서는 두 자리 — 상태 메뉴(머리 카드 배지 · work 메뉴의 상태 ▸가 같은 줄을 쓴다)와 Archive 정렬 · 거르기의 두 묶음(라벨과
// 줄) — 를 잰다. 카드는 0.98에서 떠오르므로 다 뜬 뒤에 잰다.
test("Works · Archive: 상태 메뉴와 정렬 · 거르기 메뉴의 라디오 줄도 보통 메뉴 줄처럼 2px 사이로 선다", async ({ page }) => {
  const 사이들 = (rows: Locator) =>
    rows.evaluateAll((els) =>
      els.slice(1).map((el, i) => Math.round(el.getBoundingClientRect().top - els[i].getBoundingClientRect().bottom)),
    );
  const 다뜬 = (menu: Locator) => menu.evaluate((el) => Promise.all(el.getAnimations().map((one) => one.finished)));
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);

  await page.getByRole("button", { name: "작업 메뉴", exact: true }).click();
  const 작업메뉴 = page.getByRole("menu");
  await 다뜬(작업메뉴);
  const 보통 = 작업메뉴.getByRole("menuitem", { name: /^(이름 바꾸기|복사)$/ });
  await expect(보통).toHaveCount(2);
  expect(await 사이들(보통), "보통 줄 사이").toEqual([2]);
  await page.keyboard.press("Escape");
  await expect(작업메뉴).toHaveCount(0);

  await 머리카드(page).getByRole("button", { name: pinnedWork.status, exact: true }).click();
  const 상태메뉴 = page.getByRole("menu");
  await 다뜬(상태메뉴);
  const 상태줄 = 상태메뉴.getByRole("menuitemradio");
  await expect(상태줄).toHaveCount(4);
  expect(await 사이들(상태줄), "상태 메뉴의 라디오 줄 사이").toEqual([2, 2, 2]);
  await page.keyboard.press("Escape");
  await expect(상태메뉴).toHaveCount(0);

  await page.goto(`/archive/${ARCHIVE[0].slug}`);
  await page.getByRole("button", { name: "정렬 · 거르기", exact: true }).click();
  const 거르기 = page.getByRole("menu", { name: "정렬 · 거르기", exact: true });
  await 다뜬(거르기);
  for (const 묶음 of ["정렬", "프로젝트"]) {
    const 칸 = 거르기.getByRole("group", { name: 묶음, exact: true }).locator(":scope > *");
    const 수 = await 칸.count();
    expect(수, `「${묶음}」 묶음 — 라벨 하나와 줄 둘 이상`).toBeGreaterThanOrEqual(3);
    expect(await 사이들(칸), `「${묶음}」 묶음의 라벨 · 줄 사이`).toEqual(Array(수 - 1).fill(2));
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **끈 줄**(지금 못 하는 칸, codex-ds 결정 10)은 줄째 55%로 옅어지고 글자 · 글리프가 `fg-tertiary`다 — DS `.at-mi.is-off`. 앱에서 그
// 줄이 서는 첫 자리가 work 메뉴의 Finder에서 열기 ▸, 폴더가 사라진 worktree다(`WorkMenuItems.tsx`). 줄이 끈 것인지(`aria-disabled`)와
// 눌러도 안 여는 것은 `works-floating.spec.ts`의 work 메뉴 절이 잰다 — 여기는 칠해진 값이다.
test("Works: work 메뉴 Finder ▸에서 폴더가 사라진 worktree 줄은 55%이고 글자 · 글리프가 fg-tertiary다", async ({ page }) => {
  const multiWork = WORKS[2];
  const [billing, ledger] = multiWork.worktrees;
  await installFixtureBackend(page, {
    list_works: WORKS.map((work) =>
      work.slug === multiWork.slug ? { ...work, worktrees: [billing, { ...ledger, exists: false }] } : work,
    ),
  });
  await page.goto(`/works/${multiWork.slug}`);
  await page.getByRole("button", { name: "작업 메뉴", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Finder에서 열기", exact: true }).hover();
  const 하위 = page.locator("[data-slot=dropdown-menu-sub-content]");
  const 끈줄 = 하위.getByRole("menuitem", { name: /^ledger/ });
  const 산줄 = 하위.getByRole("menuitem", { name: /^billing/ });
  await expect(끈줄).toHaveAttribute("aria-disabled", "true");

  const [옅음, 회색, 검정] = [await 토큰색(page, "--fg-tertiary"), await 토큰색(page, "--fg-secondary"), await 토큰색(page, "--fg")];
  expect(new Set([옅음, 회색, 검정]).size, "fg · fg-secondary · fg-tertiary가 서로 다른 색이다").toBe(3);
  // 이름은 줄의 첫 글자 칸이다 — 그 뒤의 흐린 「worktree」는 켜진 줄에서도 늘 `fg-tertiary`라 끔을 말하지 못한다.
  const 칠 = async (row: Locator) => [
    ...(await 칠한값(row, "opacity")),
    ...(await 칠한값(row.locator("span").first(), "color")),
    ...(await 칠한값(row.locator("svg"), "color")),
  ];
  // 앵커: 옆의 산 줄은 다른 줄과 같다 — 불투명 · 이름 `fg` · 글리프 `fg-secondary`.
  expect(await 칠(산줄), "산 worktree 줄의 불투명도 · 이름 · 글리프").toEqual(["1", 검정, 회색]);
  expect(await 칠(끈줄), "끈 worktree 줄의 불투명도 · 이름 · 글리프").toEqual(["0.55", 옅음, 옅음]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// codex-ds 티켓 18 — **레일은 칸이 둘 이상일 때만 선다**(codex-ds 결정 25 · 스펙 §4). 작업 화면의 레일 칸은 `spec` · `files` 둘이라
// (git-integration 결정 29) 레일이 바탕 오른쪽 끝에 선다. 레일이 서면 패널 토글은 머리 카드 밖, 레일 열 바로 위로 나가고 머리 카드는
// 레일 앞에서 끝난다(DS `.with-rail` · `.at-railtop`). 레일 열은 본문 열의 형제라 `aside`도 `nav`도 머리 줄 `<header>`의 자손도
// 아니고(`aside` · `header` 수와 그것을 집는 검사가 그대로다), 패널을 닫아도 그 자리에 남는다. 레일의 DS 모양(홈 · 칸 · 켜짐)은
// 진열대(`e2e/rail-fixture.tsx` · `rail.spec.ts`)가 잰다.
test("Works: 레일(spec · files)이 바탕 오른쪽 끝에 서고 — 패널 토글은 머리 카드 밖 레일 위, 머리 카드는 레일 앞에서 끝나며 — 패널을 닫아도 남는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const toggle = page.getByRole("button", { name: "작업 패널 접기", exact: true });
  const group = page.getByRole("group", { name: "레일", exact: true });
  await expect(작업패널(page)).toBeVisible();
  await expect(toggle).toBeVisible();

  // 칸은 목록 순서대로 `spec` · `files`다(git-integration 결정 29 — files가 spec 뒤에 선다). 이름이 `spec`인 버튼은 탭 줄의 칸과
  // 레일의 칸 둘이다. `aside`는 둘, `header`는 하나 그대로다.
  expect(await group.getByRole("button").evaluateAll((all) => all.map((el) => el.getAttribute("aria-label")))).toEqual([
    "spec",
    "files",
  ]);
  await expect(page.locator("[data-tab-row]").getByRole("button", { name: "spec", exact: true })).toHaveCount(1);
  await expect(page.locator("aside")).toHaveCount(2);
  await expect(page.locator("header")).toHaveCount(1);
  expect(await group.evaluate((el) => el.closest("aside, nav, header")?.tagName ?? null)).toBeNull();
  // 토글은 머리 줄 안, 머리 카드 밖이다.
  expect(
    await toggle.evaluate((el, card) => [el.closest("header") !== null, el.closest(card) === null], HEAD_CARD),
  ).toEqual([true, true]);

  const gap = await token(page, "--space-2");
  const prail = await token(page, "--size-prail");
  const titlebar = await token(page, "--titlebar-height");
  const viewport = page.viewportSize()!;
  const [knob, head, side, pills] = [
    await boxOf(toggle),
    await boxOf(머리카드(page)),
    await boxOf(작업패널(page)),
    await boxOf(group),
  ];
  // 패널 카드 오른쪽은 레일 열이다 — 틈 · 레일 · 틈을 지나 창 끝이다. 머리 카드도 같은 세로줄(레일 앞)에서 끝난다.
  expect(viewport.width - side.right, "패널 카드 오른쪽 틈 · 레일 · 틈").toBe(gap + prail + gap);
  expect(side.y, "패널 카드 위 = 머리 줄 아래").toBe(titlebar);
  expect(head.right, "머리 카드 오른쪽 = 패널 카드 오른쪽").toBe(side.right);
  // 칸 묶음: 카드 줄 꼭대기에서 시작하고 폭이 줄 폭이다. 패널 카드와 묶음 사이가 틈이다.
  expect([pills.y, pills.width], "칸 묶음 위 · 폭").toEqual([titlebar, prail]);
  expect(pills.x - side.right, "패널 카드와 레일 사이 틈").toBe(gap);
  expect(viewport.width - pills.right, "레일 오른쪽 틈").toBe(gap);
  // 토글: 24 상자가 머리 줄 가운데에, 레일 열의 가운데에 선다.
  const railMiddle = pills.x + pills.width / 2;
  expect([knob.width, knob.height], "토글 상자").toEqual([24, 24]);
  expect(knob.y + knob.height / 2, "토글 세로 가운데 = 머리 줄의 가운데").toBe(titlebar / 2);
  expect(knob.x + knob.width / 2, "토글 가로 가운데 = 레일 열의 가운데").toBe(railMiddle);

  // 빈 자리는 창을 끄는 자리다 — 칸 묶음 아래, 레일 오른쪽 틈, 패널 카드와 레일 사이 틈, 머리 카드와 토글 사이. 칸과 토글은
  // 눌리는 버튼이다.
  const middle = titlebar / 2;
  const below = pills.bottom + 40;
  expect(await 끄는자리(page, railMiddle, below), "칸 묶음 아래").toBe(true);
  expect(await 끄는자리(page, viewport.width - gap / 2, below), "레일 오른쪽 틈").toBe(true);
  expect(await 끄는자리(page, side.right + gap / 2, below), "패널 카드와 레일 사이 틈").toBe(true);
  expect(await 끄는자리(page, head.right + gap / 2, middle), "머리 카드와 토글 사이").toBe(true);
  expect(await 끄는자리(page, railMiddle, pills.y + pills.height / 4), "칸").toBe(false);
  expect(await 끄는자리(page, knob.x + knob.width / 2, middle), "토글").toBe(false);

  // 패널을 닫아도 레일 · 토글 · 머리 카드는 그 자리다 — 칸으로 다시 열 길이 닫힌 패널과 함께 사라지지 않는다(ui-refresh 결정 10).
  // 문서 카드는 레일 열 앞까지 넓어진다.
  await toggle.click();
  const closed = page.getByRole("button", { name: "작업 패널 펼치기", exact: true });
  await expect(closed).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await boxOf(page.locator("main"))).right).toBe(viewport.width - prail - 2 * gap);
  expect(await boxOf(closed)).toEqual(knob);
  expect(await boxOf(group)).toEqual(pills);
  expect((await boxOf(머리카드(page))).right).toBe(head.right);
  await closed.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.poll(async () => viewport.width - (await boxOf(작업패널(page))).right).toBe(gap + prail + gap);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 작업을 고르지 않은 빈 Works에는 레일 · 작업 패널 토글이 없고 본문 카드의 오른쪽 틈이 `--space-2` 하나다(레일 열이 없는 다른
// 화면들의 「카드 오른쪽 틈」도 그것을 잰다 — Archive의 패널 토글은 spec 목록 패널의 것이다, 위 `HEAD_SCREENS`).
test("Works: 고른 작업이 없는 빈 화면에는 레일 · 패널 토글이 없고, 머리 카드가 화면 이름만 들며, 카드 오른쪽 틈이 --space-2다", async ({
  page,
}) => {
  await installFixtureBackend(page, { list_works: [] });
  await page.goto("/works");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("group", { name: "레일", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^작업 패널 (접기|펼치기)$/ })).toHaveCount(0);
  // 머리 카드는 화면 이름 「Works」만 든다 — 지금 보는 work가 없어 그 할 일도 없다(codex-ds 티켓 14).
  await expect(page.locator("header")).toHaveCount(1);
  await expect(머리카드(page)).toHaveText("Works");
  await expect(머리카드(page).getByRole("button")).toHaveCount(0);
  const card = await cardOf(page);
  expect(page.viewportSize()!.width - card.right).toBe(await token(page, "--space-2"));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 문서 위 경로 줄(codex-ds 스펙 §4 — `PathBar`) — 「지금 보는 것」의 경로 캡슐 `slug › spec › … › 파일`과 원문 전환 · 경로 복사가
// 선다. 복사는 새 동작이 아니라 트리의 경로 복사가 선 자리 하나가 더 생긴 것이라, **같은 값**을 클립보드에 넣는다. 줄의 기하(48 ·
// 캡슐 글자와 문서 글이 한 세로줄)는 `path-bar.spec.ts`가 잰다.
test("Works: 문서 위 경로 줄에 slug › spec › … › 파일 캡슐과 원문 전환 · 경로 복사가 서고, 복사가 트리의 경로 복사와 같은 값을 낸다", async ({
  page,
}) => {
  const file = "목업/조각.html";
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/works/${pinnedWork.slug}?file=${encodeURIComponent(file)}`);
  const doc = page.locator("main");
  const capsule = doc.getByRole("navigation", { name: "위치", exact: true });
  await expect(capsule).toBeVisible();
  expect(await capsule.locator("span").allTextContents()).toEqual([pinnedWork.slug, "spec", "목업", "조각.html"]);
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

// 덮는 것의 기준 상자(판 04 「지키는 것」) — 놓기 겹판과 토스트는 `Frame`의 `overlay` 칸이라 **카드 줄**에 선다. 카드 줄이 머리 줄
// 아래에서 시작하고, 끄는 것이 출발한 탭 줄은 카드 줄 맨 위 본문 카드의 머리라(codex-ds 스펙 §4) 겹판은 그 줄의 높이(`size-toolbar`)
// 만큼 아래에서 시작한다 — 패널까지 덮어도 출발한 줄은 안 덮는다(결정 12). 토스트는 카드 줄의 아래 가운데다. 카드 줄은 창 아래
// 틈(`--space-2`) 위에서 끝나므로 겹판도 거기서 끝난다 — 한때(판 04 티켓 전) 겹판은 창 바닥까지 갔다.
test("Works: 셸 칸을 끄는 동안 겹판이 탭 줄 아래 카드 줄을 덮고 탭 줄은 안 덮고, 토스트는 카드 줄 아래 가운데에 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  const shellTab = page.locator('[data-tab="shell"] button[aria-pressed]');
  await expect(shellTab).toBeVisible();
  await expect(작업패널(page)).toBeVisible();

  const titlebar = await token(page, "--titlebar-height");
  const viewport = page.viewportSize()!;
  const edge = await sidebarRight(page);
  // 카드 줄의 오른쪽 끝 — 그 뒤는 레일 열(레일 · 오른쪽 틈)이다. 레일은 카드 줄 밖이라 겹판도 토스트의 가운데도 그것을 안 센다.
  const rowRight = viewport.width - (await token(page, "--size-prail")) - (await token(page, "--space-2"));
  const toolbar = await token(page, "--size-toolbar");
  const from = await startSplitDrag(page, await boxOf(shellTab));
  const cover = await boxOf(page.locator("[data-drop-half]").first().locator(".."));
  // 앵커: 출발한 칸이 그 띠 안이다 — 카드 줄 맨 위 탭 줄에 선다.
  expect(from.y, "출발한 칸 — 탭 줄 안").toBeLessThan(titlebar + toolbar);
  expect(cover.y, "겹판 위 — 탭 줄 아래").toBe(titlebar + toolbar);
  expect(cover.x, "겹판 왼쪽").toBe(edge);
  expect(cover.right, "겹판 오른쪽 — 패널까지 덮는다").toBe(rowRight);
  expect(cover.bottom, "겹판 아래 — 카드 줄의 바닥").toBe(viewport.height - (await token(page, "--space-2")));
  // 출발한 줄로 되돌아와 놓으면 아무 일도 안 난다 — 그 줄은 겹판 밖이다.
  await page.mouse.move(from.x, from.y);
  await page.mouse.up();
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);
  await expect(page).not.toHaveURL(/split=/);

  // 토스트 — 셸 0개 화면에서도 서는 말이 아니라, 이 화면이 내는 복사 확인으로 세운다(work 메뉴의 복사 ▸ slug).
  await recordClipboard(page);
  await page.reload();
  await 머리카드(page).getByRole("button", { name: "작업 메뉴", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "복사", exact: true }).hover();
  await page.locator("[data-slot=dropdown-menu-sub-content]").getByRole("menuitem").filter({ hasText: "slug" }).click();
  const toast = page.getByRole("region", { name: "메시지", exact: true }).locator('[data-slot="toast"]');
  await expect(toast).toBeVisible();
  const box = await boxOf(toast);
  expect(Math.abs(box.x + box.width / 2 - (edge + rowRight) / 2), "토스트 가운데").toBeLessThanOrEqual(1);
  expect(box.bottom, "토스트 아래 — 카드 줄 안").toBeLessThan(viewport.height);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
