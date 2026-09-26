import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, unknownIpcCalls } from "./harness";

// 판 03 — **키가 실제로 그 일을 하는가**, 그리고 **탭을 누르면 본문이 바뀌는가.**
//
// `스펙-이슈-136.md`의 Testing Decisions가 이 층에 맡긴 것들이고, 티켓 #139의 수용 기준
// 둘(「⌘T가 새 셸을 열고 그것이 칸으로 선다」·「⌘W가 켜진 탭을 닫는다. `spec`에서는 아무
// 일도 안 한다」)이 여기 걸린다.
//
// **정적 마크업 seam으로는 못 본다.** 그쪽이 드는 것은 「`window`에 리스너를 건다」는 배선
// 문자열과 겨눌 칸을 정하는 순수 판정 둘뿐이라(WorksPage.test.tsx·TerminalPage.test.tsx),
// 그 둘이 다 초록이어도 **키가 브라우저를 거쳐 오지 않으면** 아무 일도 안 일어난다.
// 이벤트가 없는 seam에서는 이펙트가 아예 안 돈다.
//
// 픽스처 백엔드가 `pty_spawn`을 답해 xterm이 실제로 뜬다(terminal-tabs.spec.ts가 선례다).

// 문서가 있는 work과 없는 work을 갈라 쓴다 — 본문이 갈리는 것을 재려면 고를 문서가 있어야 한다.
const [specWork, plainWork] = WORKS;

const shells = (page: Page) => page.locator('[data-tab="shell"]');
/** 켜짐을 말하는 쪽은 이름 버튼이다 — 칸 자체가 아니라 그 속성으로 집는다. */
const lit = (page: Page, at: number) =>
  shells(page).nth(at).locator("button[aria-pressed]");

test("⌘T가 새 셸을 열고 그 칸이 켜진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(shells(page)).toHaveCount(1);

  await page.keyboard.press("Meta+t");

  await expect(shells(page)).toHaveCount(2);
  // **새 칸이 켜져야 한다.** 수만 세면 「열리긴 했는데 안 켜진다」가 통과한다.
  await expect(lit(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(lit(page, 0)).toHaveAttribute("aria-pressed", "false");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **셸이 0개인 화면에서도 열려야 한다**(결정 19). 위 검사와 **다른 길이다** — 셸에 포커스가
// 있으면 xterm의 키 핸들러가 먼저 받고(`terminal-store`의 `attachCustomKeyEventHandler`),
// 셸이 없으면 받을 xterm이 없어 window 리스너가 유일한 길이다(`opensShellFromWindow`).
// 위 검사만 두면 그 리스너를 통째로 끊어도 초록이다(뮤테이션으로 확인).
test("셸이 0개인 화면에서도 ⌘T가 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  // **닫기가 확인 창을 거치려면 그 칸이 pty를 가져야 한다**(`awaitSpawned`의 머리말).
  await awaitSpawned(page, 1);

  // 마지막 칸을 닫으면 새 셸이 저절로 안 뜬다(결정 19) — 그 자리를 만든다.
  await page.locator('[data-tab="shell"] button[aria-label$="닫기"]').click();
  await page.getByRole("alertdialog").getByRole("button", { name: "닫기" }).click();
  await expect(shells(page)).toHaveCount(0);

  await page.keyboard.press("Meta+t");

  await expect(shells(page)).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("⌘W가 켜진 셸 칸을 닫는다 — 확인을 거쳐서", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await page.locator('[data-tab="new"]').click();
  await expect(shells(page)).toHaveCount(2);
  // **칸이 선 것과 pty가 앉은 것은 다른 순간이다**(`awaitSpawned`의 머리말) — 안 기다리면
  // 아래 확인 창이 「안 뜨는 것이 옳은」 상태에서 눌러 러너가 붐빌 때만 빨개진다.
  await awaitSpawned(page, 2);

  await page.keyboard.press("Meta+w");

  // **확인 창을 우회하지 않는다**(결정 22·92). 픽스처의 `pty_command_running`이 참이라
  // 이 길은 늘 물어본다 — 여기가 안 서면 셸을 말없이 죽이는 길이 새로 생긴 것이다.
  const ask = page.getByRole("alertdialog");
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "닫기" }).click();

  await expect(shells(page)).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`spec`이 켜져 있으면 ⌘W가 아무 일도 안 한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(shells(page)).toHaveCount(1);

  // 문서 칸으로 옮긴다. **여기가 이 검사의 절반이다** — 옮겨지지 않으면 아래 ⌘W는
  // 「셸이 켜진 채로 눌렀는데 안 닫혔다」가 되어 정반대의 버그를 초록으로 덮는다.
  await page.locator('[data-tab="spec"]').click();
  await expect(page.locator('[data-tab="spec"]')).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Meta+w");

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(shells(page)).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("탭을 누르면 본문이 그 칸의 것으로 바뀐다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}?tab=terminal`);

  // 셸이 켜진 채로 들어온다 — 본문은 진짜 xterm이다.
  const term = page.locator(".xterm");
  await expect(term).toHaveCount(1);

  await page.locator('[data-tab="spec"]').click();
  // **본문이 정말 갈렸는가**를 양쪽으로 잰다 — xterm이 사라지고, 문서 쪽의 것이 선다.
  // 탭의 `aria-pressed`만 보면 「칸은 켜졌는데 본문은 그대로」가 통과한다.
  await expect(term).toHaveCount(0);
  // 문서 쪽의 것 = **본문에 선 문서 자체**다(픽스처의 `read_spec_file`이 「# 개요」를 준다).
  // 트리는 오른쪽 패널이라 본문이 갈렸는지를 못 말한다.
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();

  await lit(page, 0).click();
  await expect(term).toHaveCount(1);
  // **돌아올 때도 양쪽을 잰다.** 셸만 세면 「둘 다 서 있다」가 통과한다 — 분할이 아닌데
  // 문서가 남아 있는 상태가 그것이고, 그때 화면은 두 본문이 겹친 것이 된다(뮤테이션으로 확인).
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 작업 패널의 탭 (결정 9, 스토리 100~102, S18) ──
// 패널의 `spec | info`는 탭이다 — 스크린리더가 탭으로 읽고, ←/→로 옮긴다. 옮기면 그 탭이 곧바로 켜진다(S18 — 두
// 패널이 이미 마운트돼 있어 바로 바뀌어도 싸다). 안 보이는 패널도 마운트된 채라(`keepMounted`) `spec`에서 접어 둔
// 폴더가 `info`에 다녀와도 접혀 있다.
//
// 탭 줄은 창을 끄는 자리다. Tauri는 누른 요소 **자신**의 `data-tauri-drag-region`만 본다 — 탭을 감싼 목록(tablist)에
// 속성이 없으면 탭 사이 틈이 끌기 영역에서 빠진다. 그래서 `elementFromPoint`가 돌려준 요소 자신을 잰다(조상에
// 있는 것은 Tauri에게 없는 것이다). 문서는 `specWork`의 트리다 — 폴더 「증거」가 있다.

const 패널탭 = (page: Page, name: "spec" | "info") => page.getByRole("tab", { name, exact: true });
/** 켜진 패널만 잡힌다 — 숨은 패널은 `hidden`이라 접근성 트리에 없다. */
const 패널 = (page: Page, name: "spec" | "info") => page.getByRole("tabpanel", { name, exact: true });
/** info 패널이 섰다는 표식 — 그 패널 첫 줄의 slug 복사 행. */
const slug행 = (page: Page) =>
  패널(page, "info").getByRole("button", { name: `slug ${specWork.slug}`, exact: true });
const 폴더 = (page: Page) => 패널(page, "spec").getByRole("button", { name: "증거", exact: true });

test("패널의 spec·info는 탭이다 — ←/→로 옮기면 그 탭이 곧바로 켜지고 그 패널이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  const spec = 패널탭(page, "spec");
  const info = 패널탭(page, "info");
  await expect(spec).toHaveAttribute("aria-selected", "true");
  await expect(info).toHaveAttribute("aria-selected", "false");
  await expect(폴더(page)).toBeVisible();

  await spec.focus();
  await page.keyboard.press("ArrowRight");
  await expect(info).toBeFocused();
  await expect(info).toHaveAttribute("aria-selected", "true");
  // **본문이 정말 갈렸는가**를 양쪽으로 잰다 — 탭의 선택만 보면 「탭은 켜졌는데 패널은 그대로」가 통과한다.
  await expect(slug행(page)).toBeVisible();
  await expect(패널(page, "spec")).toHaveCount(0);

  await page.keyboard.press("ArrowLeft");
  await expect(spec).toBeFocused();
  await expect(spec).toHaveAttribute("aria-selected", "true");
  await expect(폴더(page)).toBeVisible();
  await expect(패널(page, "info")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`spec`에서 접은 폴더는 `info`에 다녀와도 접혀 있다 — 안 보이는 패널도 마운트된 채다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  const folder = 폴더(page);
  await expect(folder).toHaveAttribute("aria-expanded", "true");
  await folder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");

  await 패널탭(page, "info").click();
  // 앵커: info가 섰고 spec은 숨었다. 안 옮겨졌으면 아래 「그대로 접혀 있다」는 다녀온 적이 없어서 초록이다.
  await expect(slug행(page)).toBeVisible();
  await expect(folder).toHaveCount(0);

  await 패널탭(page, "spec").click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("패널 탭 줄의 빈 자리와 탭 사이 틈은 창을 끄는 자리다 — 그 자리의 요소 자신에 끌기 속성이 있다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  const boxOf = async (target: Locator) => {
    const box = await target.boundingBox();
    if (!box) throw new Error("상자를 못 읽었다");
    return box;
  };
  const spec = await boxOf(패널탭(page, "spec"));
  const info = await boxOf(패널탭(page, "info"));
  // 탭 줄 오른쪽의 문서/원문 토글 — 탭과 그 사이가 줄의 빈 자리다.
  const source = await boxOf(page.getByRole("button", { name: "문서로 보기", exact: true }));
  const draggable = (x: number, y: number) =>
    page.evaluate(
      ([px, py]) => document.elementFromPoint(px, py)?.hasAttribute("data-tauri-drag-region") ?? null,
      [x, y],
    );
  const y = spec.y + spec.height / 2;

  // 앵커: 두 탭 사이에 틈이 있고, info 뒤에 빈 자리가 있다 — 없으면 아래 두 점이 탭 위에 떨어진다.
  expect(info.x - (spec.x + spec.width)).toBeGreaterThan(1);
  expect(source.x - (info.x + info.width)).toBeGreaterThan(1);
  expect(await draggable((spec.x + spec.width + info.x) / 2, y), "탭 사이 틈").toBe(true);
  expect(await draggable((info.x + info.width + source.x) / 2, y), "줄의 빈 자리").toBe(true);
  // 대조: 탭 위는 누르는 자리다 — 줄 전체가 끌기 영역이 된 것과 가른다.
  expect(await draggable(spec.x + spec.width / 2, y), "탭 위").toBe(false);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
