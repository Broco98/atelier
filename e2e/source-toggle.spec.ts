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
  const source = page.getByRole("button", { name: "마크다운 원문 보기" });
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
