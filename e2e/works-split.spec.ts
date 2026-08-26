import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// 판 05 — 분할. **이 층에서만 보이는 것 둘이다**: 포인터 제스처(정적 마크업 seam에는
// 이벤트가 없다)와, 끄는 동안 그려지는 겹판.
//
// 마크업 seam(WorksPage.test.tsx)이 이미 보는 것은 여기서 다시 보지 않는다 — 열 머리가
// 몇 개 서는가, 좌우가 어느 쪽인가는 그쪽이 든다.

const [, plainWork] = WORKS;

// 사이드바 264 + 본문. 절반의 경계는 본문 한가운데라, 아래 좌표는 각각 왼쪽·오른쪽
// 절반에 확실히 든다(창 폭 1280 기준).
const LEFT_HALF = { x: 500, y: 420 };
const RIGHT_HALF = { x: 1100, y: 420 };

/**
 * 겹판이 서는 것은 **임계값을 넘은 그 이동**에서다. 그 이동이 처리될 때 포인터 아래에는
 * 아직 겹판이 없으므로, 절반이 「내 위다」를 말하는 것은 **그 다음 이동**부터다.
 *
 * 실물에서는 이것이 구멍이 아니다 — 임계값은 출발점에서 5px이라 사이드바 위에서 넘고,
 * 본문까지 오는 동안 이동이 수십 번 더 온다. 여기서 두 번에 나눠 미는 것이 그 모양이다.
 */
async function dragFrom(
  page: Page,
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2);
  await page.mouse.move(to.x, to.y);
}

test("spec 잎을 오른쪽 절반에 떨구면 문서가 오른쪽 열이 된다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  const leaf = page.locator('[data-leaf="spec"]');
  await expect(leaf).toBeVisible();
  const from = await leaf.boundingBox();
  if (!from) throw new Error("spec 잎의 상자를 못 읽었다");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();

  // **5px 안쪽은 아직 드래그가 아니다**(결정 86). 겹판이 서지 않는 것이 그 관찰 가능한
  // 형태다 — 안 두면 그냥 클릭이 드래그로 읽혀 사이드바 행을 못 누른다.
  await page.mouse.move(from.x + from.width / 2 + 3, from.y + from.height / 2);
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);

  // 넘기면 겹판이 서고, 포인터가 있는 절반이 밝아진다.
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2);
  await expect(page.locator("[data-drop-half]")).toHaveCount(2);
  await page.mouse.move(RIGHT_HALF.x, RIGHT_HALF.y);
  await expect(page.locator('[data-drop-half="right"]')).toHaveAttribute("data-over", "");
  await expect(page.locator('[data-drop-half="left"]')).not.toHaveAttribute("data-over", "");

  await page.mouse.up();
  // 떨군 것이 그 절반에 선다 — spec이 오른쪽이면 `rl`이다(결정 87·97).
  await expect(page).toHaveURL(/split=rl/);
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);
  // 마크업에서 먼저 나오는 것이 왼쪽 열이다.
  await expect(page.locator("[data-column]").first()).toHaveAttribute("data-column", "terminal");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("왼쪽 절반에 떨구면 좌우가 맞바뀐다", async ({ page }) => {
  await installFixtureBackend(page);
  // 이미 문서가 오른쪽인 분할에서 출발한다 — 같은 종류를 반대쪽에 떨구는 것이
  // 결정 87이 말하는 「맞바뀜」이다.
  await page.goto(`/works/${plainWork.slug}?split=rl`);
  await expect(page.locator("[data-column]").first()).toHaveAttribute("data-column", "terminal");

  const leaf = page.locator('[data-leaf="spec"]');
  const from = await leaf.boundingBox();
  if (!from) throw new Error("spec 잎의 상자를 못 읽었다");

  await dragFrom(page, from, LEFT_HALF);
  await expect(page.locator('[data-drop-half="left"]')).toHaveAttribute("data-over", "");
  await page.mouse.up();

  await expect(page).toHaveURL(/split=lr/);
  await expect(page.locator("[data-column]").first()).toHaveAttribute("data-column", "spec");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 97. 루트에 검증기가 없어 **아무 문자열이 컴포넌트까지 온다** — 눕히는 자리가
// 없으면 `?split=zzz`가 열 둘을 세운다. 순수 함수 seam(`splitOf`)이 그 판정을 들지만,
// 그 함수가 실제로 이 길 위에 놓여 있는지는 여기서만 드러난다.
test("모르는 split 값은 단일 뷰로 눕는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?split=zzz`);
  await expect(page.locator('[data-leaf="spec"]')).toBeVisible();
  await expect(page.locator("[data-column]")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
