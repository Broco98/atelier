import { expect, test, type Locator } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls, 칠한값, 토큰값, 토큰색 } from "./harness";

// codex-ds — **문서 본문의 블록이 DS `Prose` 값이다**(DS 「Codex 그대로」 부품 · DS README 「간격 · 반경 · 크기」). 코드 블록(다이어그램
// 블록도) `radius-3xl`(20) · `surface-code` · 1px `border-light` 링, 인라인 코드 `radius-xs`(4) · `fill-soft` · 안쪽 1 · 5, 콜아웃 `surface-under` ·
// `radius-xl`(12) · 0.5px `border` 링 · 안쪽 12 · 14, 평범한 인용은 면 없이 3px `rule` 막대 · 글자 사이 16 · `fg-secondary`, 가름선은
// 0.5px `border-heavy`다. 글자 단계(제목 · 본문)는 `type-scale.spec.ts`가 잰다.
//
// 칠해진 값을 토큰을 칠한 값과 맞대고, DS가 못박은 수(20 · 4 · 12 · 3 · 16 · 0.5)는 따로 센다 — 토큰 값이 바뀌는 날 견줌이 함께
// 흘러가 초록으로 남지 않게(`frame.spec.ts`의 티켓 08 검사와 같은 길).

const [pinnedWork] = WORKS;

/** 블록 여섯(다이어그램 포함)을 한 문서에 담는다 — 어느 경로를 읽어도 이 글이 온다. */
const 문서 = [
  "# 본문 블록",
  "",
  "문단 안 `인라인` 코드.",
  "",
  "```",
  "블록 코드",
  "```",
  "",
  "```mermaid",
  "graph LR",
  "  A --> B",
  "```",
  "",
  "> 평범한 인용",
  "",
  "> [!NOTE]",
  "> 콜아웃 본문",
  "",
  "---",
  "",
  "끝 문단.",
  "",
].join("\n");

/** 칠해진 `box-shadow`에서 투명한 빈 층을 걷은 나머지 — 링 하나가 남는다. */
const 링 = async (target: Locator) =>
  (await 칠한값(target, "box-shadow"))[0]
    .split(/,(?![^(]*\))/)
    .map((one) => one.trim())
    .filter((one) => !one.startsWith("rgba(0, 0, 0, 0)"));

test("문서 본문의 코드 블록 · 인라인 코드 · 콜아웃 · 인용 · 가름선이 DS Prose 값이다", async ({ page }) => {
  await installFixtureBackend(page, { read_spec_file: 문서 });
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: "본문 블록" })).toBeVisible();

  // 코드 블록 — r20 · 코드 면 · 안쪽 1px `border-light` 링.
  const 블록 = page.locator("pre").filter({ hasText: "블록 코드" });
  const [블록반경, 블록면] = await 칠한값(블록, "border-top-left-radius", "background-color");
  expect(블록반경).toBe(await 토큰값(page, "border-top-left-radius", "--radius-3xl"));
  expect(블록반경, "코드 블록 — radius-3xl").toBe("20px");
  expect(블록면).toBe(await 토큰색(page, "--surface-code"));
  expect(await 링(블록)).toEqual([`${await 토큰색(page, "--border-light")} 0px 0px 0px 1px inset`]);

  // 다이어그램 블록도 같은 코드 블록이다 — 머리 줄(「mermaid」)을 든 상자가 r20 · 코드 면 · 같은 링이다.
  const 다이어그램 = page.getByText("mermaid", { exact: true }).locator("xpath=../..");
  expect(await 칠한값(다이어그램, "border-top-left-radius", "background-color")).toEqual([블록반경, 블록면]);
  expect(await 링(다이어그램)).toEqual(await 링(블록));

  // 인라인 코드 — r4 · 옅은 면 `fill-soft` · 안쪽 1 · 5.
  const 인라인 = page.locator("code", { hasText: "인라인" });
  const [인라인반경, 인라인면, 위, 옆] = await 칠한값(인라인, "border-top-left-radius", "background-color", "padding-top", "padding-left");
  expect(인라인반경).toBe(await 토큰값(page, "border-top-left-radius", "--radius-xs"));
  expect([인라인반경, 위, 옆], "인라인 코드 — 4 · 1 · 5").toEqual(["4px", "1px", "5px"]);
  expect(인라인면).toBe(await 토큰색(page, "--fill-soft"));

  // 콜아웃 — r12 · `surface-under` · 0.5px `border` 링 · 안쪽 12 · 14. 본문 문단의 부모가 콜아웃 상자다.
  const 콜아웃 = page.getByText("콜아웃 본문", { exact: true }).locator("xpath=..");
  await expect(콜아웃.getByText("Note", { exact: true })).toBeVisible();
  const [콜아웃반경, 콜아웃면, 콜아웃위, 콜아웃옆] = await 칠한값(콜아웃, "border-top-left-radius", "background-color", "padding-top", "padding-left");
  expect(콜아웃반경).toBe(await 토큰값(page, "border-top-left-radius", "--radius-xl"));
  expect([콜아웃반경, 콜아웃위, 콜아웃옆], "콜아웃 — 12 · 12 · 14").toEqual(["12px", "12px", "14px"]);
  expect(콜아웃면).toBe(await 토큰색(page, "--surface-under"));
  expect(await 링(콜아웃)).toEqual([`${await 토큰색(page, "--border")} 0px 0px 0px 0.5px inset`]);

  // 평범한 인용 — 면이 없고, 왼쪽 3px `rule` 막대와 글자 사이 16, 글자 `fg-secondary`.
  const 인용 = page.locator("blockquote", { hasText: "평범한 인용" });
  expect(await 칠한값(인용, "background-color", "padding-left", "color")).toEqual([
    "rgba(0, 0, 0, 0)",
    "16px",
    await 토큰색(page, "--fg-secondary"),
  ]);
  expect(
    await 인용.evaluate((el) => {
      const bar = getComputedStyle(el, "::before");
      return [bar.width, bar.left, bar.backgroundColor];
    }),
  ).toEqual(["3px", "0px", await 토큰색(page, "--rule")]);

  // 가름선 — 0.5px `border-heavy` 면이고 테두리가 없다.
  const 가름선 = page.locator("hr");
  expect(await 칠한값(가름선, "height", "border-top-width", "background-color")).toEqual([
    "0.5px",
    "0px",
    await 토큰색(page, "--border-heavy"),
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
