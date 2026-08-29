import { expect, test } from "./evidence";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// 결정 32 — 스크롤 막대는 **콘텐츠 위에 떠서 자리를 안 먹고**, 구르는 동안만 보인다.
//
// 이 층에서만 보인다. 값 쪽(어느 상자가 클래스를 다는가)은 `src/scroll-overlay.test.ts`가
// 소스로 세지만, **정말로 폭을 안 먹는가**와 **정말로 뜨고 사라지는가**는 진짜 레이아웃과
// 진짜 시간이 있어야 한다. 그 둘이 이 결정의 전부다.
test("막대는 자리를 안 먹고 떠서 뜨고, 멎으면 사라진다", async ({ page }) => {
  await installFixtureBackend(page);
  // 목록이 넘치도록 창을 낮춘다 — 고정 데이터의 work은 넷이라 기본 높이로는 안 넘친다.
  await page.setViewportSize({ width: 1280, height: 240 });
  await page.goto("/projects");

  const list = page.locator("aside .scroll-quiet");
  await expect(list).toHaveCount(1);

  const box = await list.evaluate((el) => ({
    over: el.scrollHeight > el.clientHeight,
    client: el.clientWidth,
    offset: (el as HTMLElement).offsetWidth,
  }));
  // 넘치지 않으면 아래가 전부 공허하게 통과한다.
  expect(box.over).toBe(true);
  // **자리를 안 먹는다.** 11px 커스텀 막대가 돌아오면 여기가 빨개진다.
  expect(box.client).toBe(box.offset);

  const bar = page.locator('[data-scrollbar="vertical"]');
  // 구르기 전에는 아예 없다 — 먼저 세지 않으면 아래가 「원래 있던 것」으로도 초록이 된다.
  await expect(bar).toHaveCount(0);

  await list.evaluate((el) => el.scrollBy(0, 40));
  await expect(bar).toHaveAttribute("data-on", "");

  // 상자 **안쪽** 오른쪽 끝에 선다. 밖에 그리면 옆 화면을 덮는다.
  const listBox = (await list.boundingBox())!;
  const thumb = (await bar.boundingBox())!;
  expect(thumb.x + thumb.width).toBeLessThanOrEqual(listBox.x + listBox.width);
  expect(thumb.x).toBeGreaterThan(listBox.x + listBox.width - 20);

  // 멎으면 사라진다.
  await expect(bar).not.toHaveAttribute("data-on", "", { timeout: 4000 });

  expect(await unknownIpcCalls(page)).toEqual([]);
});
