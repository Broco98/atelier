import { expect, test, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

const [work] = WORKS;

// 넓힌 카드 보기 머리의 렌더 | 원문(SummarySheet 보드 `.ra-vwhead` · restart 02b-8) — 두 단추가 **두 보기**다: 누른 쪽이 그 보기가 되고, 이미 눌린
// 쪽을 다시 누르면 그대로다. 한때(결정 33) `문서 | </>` 두 칸이 한 토글의 두 얼굴이라 어느 칸을 눌러도 뒤집혔고, 판 4의 ToggleGroup이라 Tab 자리
// 하나에 ←/→로 옮겼다 — 이제 두 단추는 Tab 자리 둘이다.
//
// 이 층에서만 보인다. 정적 마크업 seam(`ExpandedViewer.test.tsx`)은 두 단추가 받은 값을 그대로 그리는지까지만 보고 **누르면 무슨 일이 나는가**는
// 못 본다.

const 보기묶음 = (page: Page) => page.locator("section[data-expanded]").getByRole("group", { name: "문서 보기", exact: true });
const 렌더 = (page: Page) => 보기묶음(page).getByRole("button", { name: "렌더", exact: true });
const 원문 = (page: Page) => 보기묶음(page).getByRole("button", { name: "원문", exact: true });

test("누른 단추가 그 보기가 되고, 눌린 단추를 다시 누르면 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?file=${encodeURIComponent(work.specFiles[0])}`);

  // 렌더 보기에서는 `# 개요`가 제목으로 선다. 원문 보기면 글자 그대로라 제목이 없다 — 값만 보면 「aria-pressed만 뒤집히고 본문은 그대로」가
  // 통과한다.
  const heading = page.getByRole("heading", { name: "개요" });
  await expect(heading).toHaveCount(1);
  await expect(렌더(page)).toHaveAttribute("aria-pressed", "true");
  await expect(원문(page)).toHaveAttribute("aria-pressed", "false");

  // **눌린 단추를 누른다** — 그대로다.
  await 렌더(page).click();
  await expect(렌더(page)).toHaveAttribute("aria-pressed", "true");
  await expect(heading).toHaveCount(1);

  // 원문 — 그 보기가 된다. 다시 눌러도 그대로이고, 렌더가 돌린다.
  await 원문(page).click();
  await expect(원문(page)).toHaveAttribute("aria-pressed", "true");
  await expect(렌더(page)).toHaveAttribute("aria-pressed", "false");
  await expect(heading).toHaveCount(0);
  await 원문(page).click();
  await expect(원문(page)).toHaveAttribute("aria-pressed", "true");
  await expect(heading).toHaveCount(0);
  await 렌더(page).click();
  await expect(렌더(page)).toHaveAttribute("aria-pressed", "true");
  await expect(heading).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 두 단추는 Tab 자리 둘이다 — ←/→는 포커스도 보기도 옮기지 않는다. 키보드로는 그 단추에 포커스를 두고 Space로 누른다. Tab 차례로는 재지 않는다
// (스펙 「좋은 검사」).
test("단추에 포커스를 두어도 ←/→는 옆 단추로 옮기지 않고 보기도 그대로이며, Space가 그 단추를 누른다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?file=${encodeURIComponent(work.specFiles[0])}`);

  const heading = page.getByRole("heading", { name: "개요" });
  await expect(heading).toHaveCount(1);
  await 렌더(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(렌더(page)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(렌더(page)).toBeFocused();
  await expect(렌더(page)).toHaveAttribute("aria-pressed", "true");
  await expect(heading).toHaveCount(1);

  await 원문(page).focus();
  await page.keyboard.press("Space");
  await expect(원문(page)).toHaveAttribute("aria-pressed", "true");
  await expect(heading).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 원문이 없는 파일(그림)에서는 두 단추가 **함께** 잠긴다(결정 21) — 흐리기만 하면 눌리는데 아무 일도 없는 버튼이다. 잠김은 켜짐을 건드리지 않는다:
// 선 단추는 사람이 정한 값 그대로 선다. 대조로 `.md`에 오면 둘 다 풀린다 — 한 번 잠긴 채 남는 변형이 여기서 걸린다.
test("원문이 없는 파일에서는 두 단추가 다 잠기고, `.md`에 오면 풀린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?file=${encodeURIComponent("증거/샷.png")}`);

  await expect(렌더(page)).toBeDisabled();
  await expect(원문(page)).toBeDisabled();
  await expect(렌더(page)).toHaveAttribute("aria-pressed", "true");
  await expect(원문(page)).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: work.specFiles[0], exact: true }).click();
  await expect(page.getByRole("heading", { name: "개요" })).toHaveCount(1);
  await expect(렌더(page)).toBeEnabled();
  await expect(원문(page)).toBeEnabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});
