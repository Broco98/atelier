import { expect, test } from "./evidence";
import { codeCard, readCodeView, tokenOf, 주소로간다 } from "./code-view";
import { answerByArg, WORKS, WORKTREE_FILES } from "./fixtures";
import { awaitSpawned, installFixtureBackend, unknownIpcCalls } from "./harness";
import type { WorktreeFile } from "@/features/code/types";

// git-integration 판 01 티켓 08(#481) — **강조된 코드가 보인다.**
//
// 파일 탭의 본문이 `@pierre/diffs`의 파일 보기다(결정 35). 엔진은 WASM(`shiki-wasm`), 강조는 워커 둘이 하고, 색은 Codex
// `syntax-*` 라이트 값의 코드 보기 범위 토큰이다(S16). 이 층은 **WebKit**이다 — 기본 JS 엔진이 토큰을 틀리는 엔진이
// 바로 이것이라(사실 12), 여기서 초록이면 실물(WKWebView)의 강조를 예측한다.

// 강조 앞에는 코드 보기 청크 받기 · 워커 둘 띄우기 · WASM 엔진 올리기가 끼어, 붐비는 기계에서 기본 30초를 넘길 수 있다. 기다림은
// 다 「될 때까지」(`expect.poll`)라 빠른 기계에서 느려지지 않는다. 「멈추지 않음」의 시간 단언은 이 값과 무관하다.
test.describe.configure({ timeout: 90_000 });

const [work] = WORKS;
const codeUrl = (ref: string) => `/works/${work.slug}?tab=code&code=${encodeURIComponent(ref)}`;

// S16 — Codex `syntax-*` 라이트 값(`three-axes` 디자인-참고 `atelier-codex.css`). 계산된 색으로 견준다.
const KEYWORD = "rgb(171, 79, 122)"; // #ab4f7a
const STRING = "rgb(58, 132, 63)"; // #3a843f
const COMMENT = "rgb(79, 79, 79)"; // #4f4f4f

/** 같은 꼴의 줄 `n`개 — 강조되면 줄마다 키워드 · 문자열 · 주석이 갈린다. 끝 줄바꿈은 붙이지 않는다(줄 수 = `n`). */
const 줄들 = (n: number): WorktreeFile => ({
  kind: "text",
  content: Array.from({ length: n }, (_, i) => `const v${i} = "값"; // 줄 ${i + 1}`).join("\n"),
  lines: n,
});

/** 큰 표본은 이 시나리오에만 싣는다 — 고정 표(`WORKTREE_FILES`)에 두면 모든 L3 페이지의 시작 스크립트가 그만큼 붓는다. */
const 큰표본과함께 = (files: Record<string, WorktreeFile>) => ({
  read_worktree_file: answerByArg("path", { ...WORKTREE_FILES, ...files }, { otherwise: { kind: "missing" } }),
});

test("TS 파일이 줄 번호와 함께 강조돼 뜬다 — 키워드 · 문자열 · 주석이 Codex 색으로 갈린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(codeUrl("billing/src/main.ts"));
  const card = codeCard(page, "billing/src/main.ts");

  // 강조가 끝나기를 기다린다 — 처음엔 평문으로 서고 워커가 답하면 토큰이 갈린다.
  await expect.poll(async () => tokenOf(await readCodeView(card), "const")?.color, { timeout: 30_000 }).toBe(KEYWORD);

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

test("강조가 늦어도 글자는 먼저 선다 — 워커 풀이 서기 전에도 본문이 평문이고, 강조가 와도 글자가 제자리다(스토리 67)", async ({
  page,
}) => {
  // 워커 스크립트를 붙들어 둔다 — 붐비는 기계에서 워커 기동 · WASM 컴파일이 늦는 것, 또는 워커가 오류 없이 답하지 않는 것과
  // 같다. 라이브러리는 풀이 서기 전에는 평문조차 그리지 못한다(평문도 풀이 쥔 하이라이터로 그린다) — 그래서 이 동안 본문은
  // 라이브러리가 아니라 앱의 평문 보기다.
  let 풀어주기 = () => {};
  const 붙듦 = new Promise<void>((resolve) => (풀어주기 = resolve));
  await page.route(/\/worker\/worker\.js\?worker_file/, async (route) => {
    await 붙듦;
    await route.continue();
  });
  await installFixtureBackend(page);
  await page.goto(codeUrl("billing/src/main.ts"));
  const card = codeCard(page, "billing/src/main.ts");

  // 워커가 아직 뜨지 않았는데 글자와 줄 번호가 서 있다.
  await expect
    .poll(async () => (await readCodeView(card)).lines.map((line) => line.text.trim()), { timeout: 30_000 })
    .toEqual(["const answer = 42;", "// 끝까지 읽는다", 'export default "answer";', ""]);
  const 평문 = await readCodeView(card);
  expect(평문.numbers).toEqual(["1", "2", "3", "4"]);
  // 평문이다 — 줄마다 한 덩이이고 모두 같은 글자색이다.
  expect(tokenOf(평문, "const")).toBeUndefined();
  expect(new Set(평문.lines.flatMap((line) => line.tokens.map((token) => token.color))).size).toBe(1);

  // 워커를 풀어 주면 같은 카드에서 강조가 온다.
  풀어주기();
  await expect.poll(async () => tokenOf(await readCodeView(card), "const")?.color, { timeout: 30_000 }).toBe(KEYWORD);
  const 강조 = await readCodeView(card);
  expect(강조.numbers).toEqual(["1", "2", "3", "4"]);
  expect(page.workers()).toHaveLength(2);
  // 평문 보기는 라이브러리의 줄 자리와 같은 자리에 글자를 세운다 — 강조가 와도 글자가 뛰지 않는다.
  expect(평문.firstGlyph).toBeDefined();
  expect(Math.abs(강조.firstGlyph!.x - 평문.firstGlyph!.x)).toBeLessThan(1);
  expect(Math.abs(강조.firstGlyph!.y - 평문.firstGlyph!.y)).toBeLessThan(1);
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
  await expect.poll(갈린색, { timeout: 30_000 }).toBe(3);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("2만 줄이 넘는 파일은 글자는 보이고 토큰 색이 없다 — 강조 상한(결정 35)", async ({ page }) => {
  await installFixtureBackend(page, 큰표본과함께({ "src/short.ts": 줄들(10), "src/huge.ts": 줄들(20_001) }));

  // 대조 — 같은 꼴의 짧은 파일은 강조된다. 이 줄이 강조될 수 있는 글이고, 워커가 떠서 일하고 있다는 것을 먼저 본다.
  await page.goto(codeUrl("billing/src/short.ts"));
  const short = codeCard(page, "billing/src/short.ts");
  await expect.poll(async () => tokenOf(await readCodeView(short), "const")?.color, { timeout: 30_000 }).toBe(KEYWORD);

  await 주소로간다(page, codeUrl("billing/src/huge.ts"));
  const huge = codeCard(page, "billing/src/huge.ts");
  await expect
    .poll(async () => (await readCodeView(huge)).lines[0]?.text.trim(), { timeout: 30_000 })
    .toBe('const v0 = "값"; // 줄 1');

  // 강조가 올 시간을 준 뒤에도 평문이다 — 상한을 없애면(라이브러리 기본 10만 줄) 이 표본은 이 안에 칠해진다(한 번 확인했다).
  await page.waitForTimeout(4_000);
  const reading = await readCodeView(huge);
  // 그려진 줄은 줄마다 한 덩이이고, 모두 같은 글자색이다 — 키워드 · 문자열 · 주석 어느 색도 없다.
  expect(reading.lines.length).toBeGreaterThan(10);
  const colors = new Set(reading.lines.flatMap((line) => line.tokens.map((token) => token.color)));
  expect([...colors]).toHaveLength(1);
  expect(colors.has(KEYWORD) || colors.has(STRING) || colors.has(COMMENT)).toBe(false);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("수천 줄 파일을 연 직후 셸 탭을 누르면 곧바로 셸로 바뀐다 — 강조가 화면을 멈추지 않는다", async ({ page }) => {
  await installFixtureBackend(page, 큰표본과함께({ "src/big.ts": 줄들(5_000) }));
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  // 풀을 먼저 세운다 — 풀이 서기 전에는 본문이 앱의 평문 보기라(스토리 67) 강조가 끼지 않는다. 재려는 것은 라이브러리의 보기가
  // 큰 파일을 그리고 워커가 강조하는 동안이다.
  await 주소로간다(page, codeUrl("billing/src/main.ts"));
  const main = codeCard(page, "billing/src/main.ts");
  await expect.poll(async () => tokenOf(await readCodeView(main), "const")?.color, { timeout: 30_000 }).toBe(KEYWORD);

  await 주소로간다(page, codeUrl("billing/src/big.ts"));
  const big = codeCard(page, "billing/src/big.ts");
  // 첫 글자가 선 직후 — 강조는 아직 워커에서 돌고 있다.
  await expect
    .poll(async () => (await readCodeView(big)).lines[0]?.text.trim(), { timeout: 30_000 })
    .toBe('const v0 = "값"; // 줄 1');

  const shell = page.locator('[data-tab="shell"] button[aria-pressed]');
  const started = Date.now();
  await shell.click();
  await expect(page.locator(".xterm")).toBeVisible();
  const waited = Date.now() - started;
  await expect(big).toHaveCount(0);
  // 눌러서 셸이 서기까지 — 메인 스레드가 강조에 붙들려 있으면 이 사이에 강조 시간이 통째로 낀다. 지금은 붐비는 기계에서도
  // 0.3초 안팎이다. 워커 없이 · 가상화 없이 메인 스레드에서 강조하게 바꾸면(한 번 확인했다) 첫 글자조차 30초 안에 서지 않는다.
  expect(waited).toBeLessThan(1_000);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("읽은 적 있는 다른 파일 탭으로 곧장 옮기면 본문이 처음부터 그 파일이다 — 앞 파일이 새 경로 아래 남지 않는다", async ({ page }) => {
  // 라이브러리는 강조된 파일을 든 보기에 다른 파일이 오면 그 파일의 강조가 올 때까지 앞 파일을 그린다(같은 파일의 새 내용이
  // 평문으로 깜박이지 않게 — G6). 수천 줄 파일의 강조는 워커에서 수백 ms를 넘기므로, 보기를 파일마다 새로 세우지 않으면 그동안
  // 카드 이름은 새 파일인데 몸은 앞 파일이다.
  await installFixtureBackend(page, 큰표본과함께({ "src/big.ts": 줄들(5_000) }));
  await page.goto(codeUrl("billing/src/main.ts"));
  const main = codeCard(page, "billing/src/main.ts");
  const big = codeCard(page, "billing/src/big.ts");
  await expect.poll(async () => tokenOf(await readCodeView(main), "const")?.color, { timeout: 30_000 }).toBe(KEYWORD);

  // 큰 파일을 한 번 읽어 둔다 — 다시 갈 때는 읽기를 기다리지 않고 곧바로 내용이 온다(쿼리 캐시).
  await 주소로간다(page, codeUrl("billing/src/big.ts"));
  await expect
    .poll(async () => (await readCodeView(big)).lines[0]?.text.trim(), { timeout: 30_000 })
    .toBe('const v0 = "값"; // 줄 1');

  // 짧은 파일로 돌아와 강조가 끝나기를 기다린다 — 강조된 파일을 든 보기에서 떠나는 것이 그 경우다.
  await 주소로간다(page, codeUrl("billing/src/main.ts"));
  await expect.poll(async () => tokenOf(await readCodeView(main), "const")?.color, { timeout: 30_000 }).toBe(KEYWORD);

  await 주소로간다(page, codeUrl("billing/src/big.ts"));
  // 「끝내 맞는가」가 아니라 「처음 그려진 것이 맞는가」를 잰다 — 카드 이름이 바뀐 뒤 줄이 하나라도 선 첫 읽기를 붙든다.
  let 처음: string | undefined;
  await expect
    .poll(async () => (처음 ??= (await readCodeView(big)).lines[0]?.text.trim()), { intervals: [16], timeout: 30_000 })
    .toBeDefined();
  expect(처음).toBe('const v0 = "값"; // 줄 1');
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("워커가 뜨지 못하면 메인 스레드에서 강조하고 강조 상한이 2천 줄로 내려간다 — 결정 35의 물러서기", async ({ page }) => {
  // 워커 스크립트를 막는다 — 라이브러리가 풀을 멈추고 메인 스레드로 물러선다(초기화 실패).
  await page.route(/\/worker\/worker\.js\?worker_file/, (route) => route.abort());
  await installFixtureBackend(page, 큰표본과함께({ "src/short.ts": 줄들(10), "src/over.ts": 줄들(2_001) }));

  // 메인 스레드에서도 강조는 선다 — 같은 엔진(WASM) · 같은 색이다.
  await page.goto(codeUrl("billing/src/short.ts"));
  const short = codeCard(page, "billing/src/short.ts");
  await expect.poll(async () => tokenOf(await readCodeView(short), "const")?.color, { timeout: 30_000 }).toBe(KEYWORD);
  expect(page.workers()).toHaveLength(0);

  // 2천 1줄은 워커가 있으면 강조되지만(상한 2만), 메인 스레드에서는 평문이다 — 큰 파일이 메인 스레드를 붙들지 않게.
  await 주소로간다(page, codeUrl("billing/src/over.ts"));
  const over = codeCard(page, "billing/src/over.ts");
  await expect
    .poll(async () => (await readCodeView(over)).lines[0]?.text.trim(), { timeout: 30_000 })
    .toBe('const v0 = "값"; // 줄 1');
  await page.waitForTimeout(4_000);
  const colors = new Set((await readCodeView(over)).lines.flatMap((line) => line.tokens.map((token) => token.color)));
  expect([...colors]).toHaveLength(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
