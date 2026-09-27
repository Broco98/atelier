import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";

// 티켓 11 — **닫기 IPC가 까닭과 셸의 주인을 싣는다**(프로세스 스펙 S12). 백엔드는 그 닫기가 끝낸 것을 정리 기록에 이
// 까닭으로 적는다. 어느 닫기가 어느 까닭인지는 표 한 자리(`CLOSE_REASONS`)가 고르고, 이 층이 재는 것은 그 표가 진짜
// 사건에 붙어 있는가다 — 사람이 누른 `×`가 「셸 닫기」로, 아카이빙이 성공한 뒤의 회수가 「아카이브」로 나가는가. 둘이
// 뒤바뀌면 판 04의 `●`(까닭으로 켜진다)가 사람이 누른 닫기에 켜지거나, 기록이 아카이브를 셸 닫기로 적는다.
//
// 기록이 무엇을 적는지(도우미를 빼고, 셸만 끝난 사건은 안 적는다)는 Rust의 검사가 잰다 — 여기서는 인자만 본다.

const [, plainWork] = WORKS;

/** 지금까지 나간 닫기의 인자, 나간 순서대로. */
async function kills(page: Page): Promise<Record<string, unknown>[]> {
  return (await ipcCallArgs(page, "pty_kill", "id")).map(({ args }) => args);
}

/** 작업 화면(터미널 탭)에서 셸 하나가 뜬 뒤 ⋯ 메뉴의 「아카이빙」을 누르고 확인 창에서 한 번 더 누른다. */
async function archive(page: Page, path: string, menu: string): Promise<void> {
  await page.goto(`${path}?tab=terminal`);
  await awaitSpawned(page, 1);
  await page.getByRole("button", { name: menu, exact: true }).click();
  await page.getByRole("menuitem", { name: "아카이빙", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "아카이빙", exact: true }).click();
}

test("×로 닫으면 닫기에 까닭 「셸 닫기」와 그 셸의 주인이 실린다", async ({ page }) => {
  // 명령도 자손도 없으면 묻지 않고 닫는다 — 확인 창을 거치든 아니든 닫는 길은 하나다(`requestCloseShell`).
  await installFixtureBackend(page, { pty_close_check: { command: false, descendants: 0 } });
  await page.goto("/terminal");
  await awaitSpawned(page, 1);

  await page.locator('[data-tab="shell"] button[aria-label$="닫기"]').first().click();

  // 최상위 터미널의 주인은 뒤가 빈 `atelier:`다(결정 10).
  await expect.poll(() => kills(page)).toEqual([{ id: 1, reason: "shellClose", owner: "atelier:" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("UI 아카이브로 닫으면 까닭이 「아카이브」이고 주인이 그 work이다", async ({ page }) => {
  await installFixtureBackend(page);
  await archive(page, `/works/${plainWork.slug}`, "작업 메뉴");

  await expect.poll(() => kills(page)).toEqual([{ id: 1, reason: "archive", owner: `atelier:${plainWork.slug}` }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
