import { expect, test, type Locator } from "./evidence";
import { MAIN_HEADER, PROJECTS, WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls, 툴팁 } from "./harness";

// codex-ds 티켓 03 — **글자는 DS 단계에서만 나온다**(codex-ds 결정 27 · 스펙 「토큰」의 글자 단계). 단계가 크기와 함께
// 줄 높이 · 굵기 · 자간을 들어, 12px 글자는 18 줄에 +0.025em이고 제목은 모두 600이다(DS 「Atelier」 2판 `type.groups`).
//
// **이 층에서만 보인다.** 클래스가 단계 이름을 쓰는지는 vitest(`type-scale.test.ts`)가 소스에서 읽지만, 그 이름이
// `@theme`의 값을 실제 요소에 세우는지 — 줄 높이 · 굵기 · 자간이 단계에 실려 함께 서는지 — 는 진짜 CSS가 있어야 난다.
// 기대값은 DS 값표의 수다(토큰을 읽어 견주면 토큰이 틀려도 초록이다).

const [pinnedWork] = WORKS;

// WebKit은 `letter-spacing`의 em을 px로 풀어 돌려준다 — 12px의 +0.025em은 `0.3px`다.
const 글자 = (target: Locator) =>
  target.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      size: style.fontSize,
      line: style.lineHeight,
      weight: style.fontWeight,
      tracking: style.letterSpacing,
    };
  });

test("문서 h1 · h2 · 본문이 DS heading-lg · heading-sm · chat-body다", async ({ page }) => {
  // 제목 둘과 문단 하나를 가진 문서 — 어느 경로를 읽어도 이 글이 온다.
  await installFixtureBackend(page, { read_spec_file: "# 큰 제목\n\n## 둘째 제목\n\n본문 한 줄.\n" });
  await page.goto(`/works/${pinnedWork.slug}`);
  const h1 = page.getByRole("heading", { level: 1, name: "큰 제목" });
  await expect(h1).toBeVisible();

  expect(await 글자(h1)).toEqual({ size: "24px", line: "28px", weight: "600", tracking: "normal" });
  expect(await 글자(page.getByRole("heading", { level: 2, name: "둘째 제목" }))).toEqual({
    size: "18px",
    line: "26px",
    weight: "600",
    tracking: "normal",
  });
  expect(await 글자(page.getByText("본문 한 줄.", { exact: true }))).toEqual({
    size: "14px",
    line: "22.75px",
    weight: "400",
    tracking: "normal",
  });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("12px 글자는 줄 18에 자간 +0.025em이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");
  // 사이드바 구획 머리의 옅은 수 — DS 「글자」 표의 `text-xs`(행 메타)다.
  const 개수 = page.getByRole("button", { name: MAIN_HEADER, exact: true }).locator("span.tabular-nums");
  await expect(개수).toBeVisible();

  expect(await 글자(개수)).toEqual({ size: "12px", line: "18px", weight: "400", tracking: "0.3px" });

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 툴팁 상자는 한 줄 26px이다(Codex 툴팁 `.at-tip`, codex-ds 티켓 09) — 글자가 12/18(`text-xs`)이라 위아래 안쪽 4가 그 높이를 채운다.
// 높이는 `offsetHeight`로 잰다 — 열림 애니메이션(zoom-in-95)의 scale은 레이아웃 높이를 바꾸지 않는다.
test("한 줄 툴팁은 12/18 글자에 높이 26px이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${PROJECTS[0].slug}`);
  // 기준 브랜치 셀렉트 칩의 도움말 「브랜치 목록에서 변경」 — 포커스로 띄운다.
  await page.getByRole("combobox", { name: "기준 브랜치" }).focus();
  const tooltip = 툴팁(page);
  await expect(tooltip).toHaveText("브랜치 목록에서 변경");

  expect(await 글자(tooltip)).toEqual({ size: "12px", line: "18px", weight: "500", tracking: "0.3px" });
  expect(await tooltip.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(26);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
