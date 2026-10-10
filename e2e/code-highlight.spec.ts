import { expect, test } from "./evidence";
import { codeCard, readCodeView, tokenOf } from "./code-view";
import { WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// git-integration 판 01 티켓 08(#481) — **강조된 코드가 보인다.**
//
// 파일 탭의 본문이 `@pierre/diffs`의 파일 보기다(결정 35). 엔진은 WASM(`shiki-wasm`), 강조는 워커 둘이 하고, 색은 Codex
// `syntax-*` 라이트 값의 코드 보기 범위 토큰이다(S16). 이 층은 **WebKit**이다 — 기본 JS 엔진이 토큰을 틀리는 엔진이
// 바로 이것이라(사실 12), 여기서 초록이면 실물(WKWebView)의 강조를 예측한다.

const [work] = WORKS;
const codeUrl = (ref: string) => `/works/${work.slug}?tab=code&code=${encodeURIComponent(ref)}`;

// S16 — Codex `syntax-*` 라이트 값(`three-axes` 디자인-참고 `atelier-codex.css`). 계산된 색으로 견준다.
const KEYWORD = "rgb(171, 79, 122)"; // #ab4f7a
const STRING = "rgb(58, 132, 63)"; // #3a843f
const COMMENT = "rgb(79, 79, 79)"; // #4f4f4f

test("TS 파일이 줄 번호와 함께 강조돼 뜬다 — 키워드 · 문자열 · 주석이 Codex 색으로 갈린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(codeUrl("billing/src/main.ts"));
  const card = codeCard(page, "billing/src/main.ts");

  // 강조가 끝나기를 기다린다 — 처음엔 평문으로 서고 워커가 답하면 토큰이 갈린다.
  await expect.poll(async () => tokenOf(await readCodeView(card), "const")?.color, { timeout: 10_000 }).toBe(KEYWORD);

  const reading = await readCodeView(card);
  // 줄 번호 — 줄마다 하나씩, 1부터. 끝의 줄바꿈 뒤도 한 줄로 센다(편집기와 같고, 04의 원문 보기도 그랬다).
  expect(reading.numbers).toEqual(["1", "2", "3", "4"]);
  expect(reading.lines.map((line) => line.text.trim())).toEqual([
    "const answer = 42;",
    "// 끝까지 읽는다",
    'export default "answer";',
    "",
  ]);
  // 같은 색이 이어지면 라이브러리가 한 토큰으로 묶는다 — 문자열은 따옴표째, 주석은 `//`째 한 토큰이다.
  expect(tokenOf(reading, '"answer"')?.color).toBe(STRING);
  const remark = tokenOf(reading, "// 끝까지 읽는다");
  expect(remark?.color).toBe(COMMENT);
  // 주석은 기울임이다(S16) — 다른 토큰은 바로 선다.
  expect(remark?.italic).toBe(true);
  expect(tokenOf(reading, "const")?.italic).toBe(false);

  // 강조는 워커 둘이 한다(결정 35) — 풀이 뜨지 못하면 라이브러리가 워커를 걷고 메인 스레드로 물러서므로 이 수가 0이 된다.
  expect(page.workers()).toHaveLength(2);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("WebKit 오토큰 검사 — 한 줄의 키워드 · 문자열 · 주석이 강조가 끝난 뒤 서로 다른 토큰 · 다른 색이다", async ({ page }) => {
  // 사실 12: 라이브러리 기본 엔진(shiki JS)은 WebKit에서 첫 강조가 시간 제한을 넘겨 **토큰이 틀린다** — 이 검사가 그때 빨개진다.
  // 그래서 엔진은 WASM이다(`HighlightedCode`의 `ENGINE`). 색 값이 아니라 「셋이 갈렸는가」를 잰다.
  await installFixtureBackend(page);
  await page.goto(codeUrl("billing/src/greeting.ts"));
  const card = codeCard(page, "billing/src/greeting.ts");

  // 셋을 각자의 토큰(요소)으로 찾고 그 색을 모은다 — 한 토큰에 둘이 붙었거나 셋 중 둘이 같은 색이면 3이 못 된다.
  const 갈린색 = async () => {
    const reading = await readCodeView(card);
    const colors = ["const", '"안녕"', "// 인사"].map((text) => tokenOf(reading, text)?.color);
    return colors.includes(undefined) ? 0 : new Set(colors).size;
  };
  await expect.poll(갈린색, { timeout: 10_000 }).toBe(3);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
