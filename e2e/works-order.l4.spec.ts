import { dragRowOnto, installRealBackend, shownWorkOrder, unknownIpcCalls, workRow } from "./harness";
import { expect, seedWork, test } from "./l4";

// UI개선 티켓 05 — **작업 행을 끌어 놓고 새로고침하면 그 순서가 남는다.**
//
// L3 fixture 백엔드는 상태가 없어 「쓰고 다시 읽기」를 못 잰다. 이 층만 그것을 답한다: 끌기 →
// `move_work` IPC → 다리 → 코어가 `.order.json`을 쓰고 → 새로고침한 화면이 `list_works`로 그 파일을
// 읽는다. L4엔 감시자가 없으므로 놓은 직후 화면이 바뀌는 것도 **응답으로 갈아 끼우기**뿐이다.
//
// work을 손으로 심는 이유와 모양은 `l4.ts`의 `seedWork` 머리말에 있다.

test("작업 행을 끌어 놓고 새로고침해도 그 순서가 남는다", async ({ page, sandbox }) => {
  const { home } = sandbox;
  seedWork(home, "셋째", "셋째 작업", "2026-08-01");
  seedWork(home, "둘째", "둘째 작업", "2026-08-02");
  seedWork(home, "첫째", "첫째 작업", "2026-08-03");
  await installRealBackend(page, sandbox);

  await page.goto("/projects");
  // 순서 파일이 없을 때의 기본 순서 — 만든 날 최신순이다. 이것을 먼저 봐야 「원래 그 순서였다」와
  // 「옮긴 것이 남았다」가 갈린다.
  await expect.poll(() => shownWorkOrder(page)).toEqual(["첫째", "둘째", "셋째"]);

  // 맨 아래 행을 맨 위 행의 윗 절반에 놓는다.
  await dragRowOnto(page, "셋째", workRow(page, "첫째"), "upper");

  await expect.poll(() => shownWorkOrder(page)).toEqual(["셋째", "첫째", "둘째"]);

  await page.reload();
  await expect(page.locator("[data-work-row]")).toHaveCount(3);
  await expect.poll(() => shownWorkOrder(page)).toEqual(["셋째", "첫째", "둘째"]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
