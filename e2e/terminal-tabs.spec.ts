import { expect, test } from "./evidence";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// 판 03 — `/terminal`의 머리행도 **같은 탭 줄**이다(결정 8 · adr-03). **이 층에서만 보이는
// 것 둘이다**: 키 이벤트(정적 마크업 seam에는 이벤트가 없어 이펙트가 아예 안 돈다)와,
// 화면에 실제로 보이는 순서와 ⌘1이 고르는 것이 같은가.
//
// **마크업 seam(TerminalPage.test.tsx)이 보는 것은 여기서 다시 안 본다** — `spec` 칸이
// 없는지, 무엇이 어느 순서로 서는지, 창 드래그 영역이 있는지는 그쪽이 든다. 여기서 그것을
// 한 번 더 확인하는 것은 「줄이 실제로 섰다」를 이 검사가 딛고 서기 위해서다: 안 서 있으면
// 아래 키 단언이 「고를 칸이 없어서」 초록이 될 수 있다.
//
// 픽스처 백엔드가 `pty_spawn`을 답해 xterm이 실제로 뜬다(terminal-fill.spec.ts가 선례다).

test("⌘1이 탭 줄에 보이는 첫 칸을 고른다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");

  // 들어오면 셸 하나가 뜬다(`ensureShell`) — 그 칸이 곧 탭 줄의 첫 칸이다.
  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  // **이 화면에는 `spec` 칸이 없다**(결정 8). 그래서 ⌘1부터가 셸이고, 화면마다 갈리는 것이
  // `firstKey` 하나라는 성질이 여기서 실물로 선다.
  await expect(page.locator('[data-tab="spec"]')).toHaveCount(0);

  // 탭 줄의 `+`로 한 칸 더 연다. **표식으로 집는다** — 「셸 열기」 버튼은 이 화면에 둘이다
  // (사이드바 가지에도 하나 있다). 이름으로 집으면 판 04가 사이드바를
  // 손대는 날 이 검사가 엉뚱한 자리에서 실패한다.
  await page.locator('[data-tab="new"]').click();
  await expect(tabs).toHaveCount(2);
  // 새로 연 칸이 켜진 칸이다 — 여기가 안 서면 아래 ⌘1은 「원래 첫 칸이 켜져 있어서」 초록이다.
  const lit = (at: number) => tabs.nth(at).locator("button[aria-pressed]");
  await expect(lit(1)).toHaveAttribute("aria-pressed", "true");

  // ⌘1이 **첫 칸**으로 돌아온다. work 화면이라면 그 자리가 `spec`이라 셸이 안 바뀐다.
  await page.keyboard.press("Meta+1");
  await expect(lit(0)).toHaveAttribute("aria-pressed", "true");
  await expect(lit(1)).toHaveAttribute("aria-pressed", "false");

  expect(await unknownIpcCalls(page)).toEqual([]);
});
