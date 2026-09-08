import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { SEARCH_HITS, WORKS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 결정 12·14. **work 화면이 떠 있게 되면 그 work을 「열었다」로 센다.**
//
// 여기서 재는 것은 배선이다 — 이력 파일이 실제로 써지는지는 L4가 들고(`works-recent.l4`),
// 그 순서로 목록이 서는지는 코어 단위가 든다. 이 층만 답할 수 있는 것은 **effect가 언제
// 도는가**이고, 정확히 그것이 조용히 어긋나는 자리다: 보던 화면을 적어 두는 이웃 effect의
// 의존성에 문서·탭·분할이 들어 있어서, 거기 얹으면 **문서를 바꿀 때마다** 나간다.
// 소스 스캔이 의존성 배열을 원문으로 못 박지만(`-work-search.test.ts`), 그것만으로는
// **그 effect가 실제로 도는지**를 못 본다 — 둘이 짝이어야 그물이 된다.

const [specWork] = WORKS;

const palette = (page: Page) => page.getByRole("listbox", { name: "검색 결과" });
const rows = (page: Page) => page.getByRole("option");

/** 「열었다」가 나간 slug들. **중복을 안 지운다** — 이 검사가 세려는 것이 그 수다. */
async function touched(page: Page): Promise<string[]> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  return calls
    .filter((call) => call.startsWith("touch_recent_work "))
    .map((call) => JSON.parse(call.slice("touch_recent_work ".length)).slug as string);
}

test("work 화면이 서면 그 work을 열었다고 적고, 문서·탭을 바꿔도 다시 안 적는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();

  // **그 work의 slug로 나간다.** 수를 절대값으로 못 박지 않는 것은 dev의 StrictMode가
  // effect를 마운트마다 두 번 돌리기 때문이다 — **「정확히 한 번」은 이 층에서 못 잰다.**
  // 대신 재는 것이 **무엇이 그 수를 늘리는가**이고, 아래 세 단이 그것을 나눠 든다.
  await expect.poll(() => touched(page)).not.toEqual([]);
  const afterOpen = await touched(page);
  expect(new Set(afterOpen)).toEqual(new Set([specWork.slug]));

  // ── ① 가만히 둬도 안 는다. 의존성이 불안정하면(매번 새 객체가 들어간다든지) **렌더마다**
  // 나가는데, 그 모양은 아래 두 단이 안 잡는다 — 저쪽은 「바꿨더니 나갔다」를 재고 이쪽은
  // 「아무것도 안 바꿔도 난다」를 잰다. 리렌더는 창 크기로 강제한다(가만히 기다리는 것보다
  // 러너 속도에 안 매인다).
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width - 40, height: size.height });
  await page.setViewportSize(size);
  expect(await touched(page), "아무것도 안 바꿨는데 「열었다」가 또 나갔다").toEqual(afterOpen);

  // ── ② 문서를 바꾼다. 같은 work 안이라 「열었다」는 그대로여야 한다.
  await page.keyboard.press("Meta+k");
  await expect(rows(page)).toHaveCount(SEARCH_HITS.length);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`file=`));

  expect(await touched(page), "문서를 바꾸는데 「열었다」가 또 나갔다").toEqual(afterOpen);

  // ── ③ 탭을 바꾼다(셸을 연다). 이것도 같은 work 안이다.
  await page.locator('[data-tab="new"]').click();
  await expect(page.locator(".xterm")).toHaveCount(1);

  expect(await touched(page), "탭을 바꾸는데 「열었다」가 또 나갔다").toEqual(afterOpen);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
