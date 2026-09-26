import { expect, test } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

const [work] = WORKS;

// 결정 33 — `문서 | </>` 두 칸이 **한 토글의 두 얼굴**이다: 어느 칸을 눌러도 뒤집힌다.
//
// 이 층에서만 보인다. 정적 마크업 seam(WorkPanel.test.tsx)은 두 칸이 받은 값을 그대로
// 그리는지까지만 보고 **누르면 무슨 일이 나는가**는 못 본다 — 실물에서 선 칸을 눌러도
// 아무 일이 없던 것이 그 사각지대에서 났다.
test("어느 칸을 눌러도 문서와 원문이 오간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?file=${encodeURIComponent(work.specFiles[0])}`);

  const doc = page.getByRole("button", { name: "문서로 보기" });
  const source = page.getByRole("button", { name: "원문 보기" });
  // 예쁜 보기에서는 `# 개요`가 제목으로 선다. 원문 보기면 글자 그대로라 제목이 없다 —
  // 값만 보면 「aria-pressed만 뒤집히고 본문은 그대로」가 통과한다.
  const heading = page.getByRole("heading", { name: "개요" });

  await expect(heading).toHaveCount(1);
  await expect(doc).toHaveAttribute("aria-pressed", "true");

  // **서 있는 칸을 누른다.** 세그먼트의 관습대로면 여기서 아무 일도 안 나고,
  // 그것이 실물에서 났던 그 모양이다.
  await doc.click();
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await expect(heading).toHaveCount(0);

  // 반대쪽에서도 같다 — 이제 서 있는 것은 `</>`다.
  await source.click();
  await expect(doc).toHaveAttribute("aria-pressed", "true");
  await expect(heading).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 판 4 — 두 칸은 ToggleGroup이다(결정 1). Tab 자리가 하나이고 그 안에서는 ←/→로 옮긴다(스토리 94).
// 끝에서 돈다. 옮기기만 하고 뒤집지 않는다 — 방향키 한 번에 본문이 바뀌면 칸을 고르러 가는 길에
// 보기가 오간다. 뒤집는 것은 Space다. Tab으로는 재지 않는다(스펙 「좋은 검사」).
test("칸에 포커스를 두면 ←/→로 옆 칸에 가고, 옮기기만 해서는 보기가 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?file=${encodeURIComponent(work.specFiles[0])}`);

  const doc = page.getByRole("button", { name: "문서로 보기" });
  const source = page.getByRole("button", { name: "원문 보기" });
  const heading = page.getByRole("heading", { name: "개요" });
  await expect(heading).toHaveCount(1);
  await expect(doc).toHaveAttribute("aria-pressed", "true");

  await doc.focus();
  await page.keyboard.press("ArrowRight");
  await expect(source).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(doc).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(source).toBeFocused();

  await expect(doc).toHaveAttribute("aria-pressed", "true");
  await expect(heading).toHaveCount(1);

  await page.keyboard.press("Space");
  await expect(source).toHaveAttribute("aria-pressed", "true");
  await expect(heading).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 원문이 없는 파일(그림)에서는 두 칸이 **함께** 잠긴다(결정 21) — 흐리기만 하면 눌리는데 아무 일도
// 없는 버튼이다. 잠김은 켜짐을 건드리지 않는다: 선 칸은 사람이 정한 값 그대로 선다(WorkPanel 주석).
// 대조로 `.md`에 오면 둘 다 풀린다 — 한 번 잠긴 채 남는 변형이 여기서 걸린다.
test("원문이 없는 파일에서는 두 칸이 다 잠기고, `.md`에 오면 풀린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${work.slug}?file=${encodeURIComponent("증거/샷.png")}`);

  const doc = page.getByRole("button", { name: "문서로 보기" });
  const source = page.getByRole("button", { name: "원문 보기" });
  await expect(doc).toBeDisabled();
  await expect(source).toBeDisabled();
  await expect(doc).toHaveAttribute("aria-pressed", "true");
  await expect(source).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: work.specFiles[0], exact: true }).click();
  await expect(page.getByRole("heading", { name: "개요" })).toHaveCount(1);
  await expect(doc).toBeEnabled();
  await expect(source).toBeEnabled();

  expect(await unknownIpcCalls(page)).toEqual([]);
});
