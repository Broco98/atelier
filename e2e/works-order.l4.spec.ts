import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installRealBackend, unknownIpcCalls } from "./harness";
import { expect, test } from "./l4";
import type { Page } from "./evidence";

// UI개선 티켓 05 — **작업 행을 끌어 놓고 새로고침하면 그 순서가 남는다.**
//
// L3 fixture 백엔드는 상태가 없어 「쓰고 다시 읽기」를 못 잰다. 이 층만 그것을 답한다: 끌기 →
// `move_work` IPC → 다리 → 코어가 `.order.json`을 쓰고 → 새로고침한 화면이 `list_works`로 그 파일을
// 읽는다. L4엔 감시자가 없으므로 놓은 직후 화면이 바뀌는 것도 **응답으로 갈아 끼우기**뿐이다.
//
// work을 손으로 심는 이유와 모양은 `works-recent.l4.spec.ts` 머리말과 같다.

function seedWork(home: string, slug: string, title: string, createdAt: string) {
  const dir = join(home, "works", slug);
  mkdirSync(join(dir, "spec"), { recursive: true });
  writeFileSync(
    join(dir, "work.json"),
    JSON.stringify({ title, status: "active", createdAt, projects: [], pinned: false }),
  );
  writeFileSync(join(dir, "spec", "overview.md"), "# 개요\n\n한 줄.\n");
}

const rowOf = (page: Page, slug: string) => page.locator(`[data-work-row="${slug}"]`);

const shownOrder = (page: Page) =>
  page.locator("[data-work-row]").evaluateAll((els) => els.map((el) => el.getAttribute("data-work-row")));

test("작업 행을 끌어 놓고 새로고침해도 그 순서가 남는다", async ({ page, sandbox }) => {
  const { home } = sandbox;
  seedWork(home, "셋째", "셋째 작업", "2026-08-01");
  seedWork(home, "둘째", "둘째 작업", "2026-08-02");
  seedWork(home, "첫째", "첫째 작업", "2026-08-03");
  await installRealBackend(page, sandbox);

  await page.goto("/projects");
  // 순서 파일이 없을 때의 기본 순서 — 만든 날 최신순이다. 이것을 먼저 봐야 「원래 그 순서였다」와
  // 「옮긴 것이 남았다」가 갈린다.
  await expect.poll(() => shownOrder(page)).toEqual(["첫째", "둘째", "셋째"]);

  // 맨 아래 행을 맨 위 행의 윗 절반에 놓는다.
  const from = (await rowOf(page, "셋째").boundingBox())!;
  const to = (await rowOf(page, "첫째").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 4, { steps: 8 });
  await expect(page.locator("[data-drop-line]")).toBeVisible();
  await page.mouse.up();

  await expect.poll(() => shownOrder(page)).toEqual(["셋째", "첫째", "둘째"]);

  await page.reload();
  await expect(page.locator("[data-work-row]")).toHaveCount(3);
  await expect.poll(() => shownOrder(page)).toEqual(["셋째", "첫째", "둘째"]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
