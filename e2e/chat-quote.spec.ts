import { expect, test, type Locator, type Page } from "./evidence";

import type { Quote } from "@/features/chat/types";
import { answerByArg } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";
import { cartWork, conversationRow, linesAfter, linesThrough, record, specCopy, streamLines } from "./chat-records";
import { 레일칸, 입력칸, 작업패널 } from "./chat-screen";

// three-axes 티켓 27 — **문서에서 고른 자리를 인용 칩으로 붙여 말한다**(스토리 78~83).
//
// 스펙 창에서 글을 고르면 그 곁에 「❝ 이 자리를 두고 말하기」가 뜨고, 누르면 지금 대화의 입력창에 인용 칩이 붙는다(대화창이
// 가려져 있었으면 작업 패널이 `chat`으로 열린다). 보내기 명령에는 파일 · 원문 줄 범위 · 고른 글이 실린다 — 렌더 보기면 고른 글이
// 걸친 블록의 경계, 원문 보기면 고른 줄 그대로다. 본문은 L1이 남긴 「고친 곳」 턴 뒤의 spec 폴더(`changes.spec/`)이고, 보낸 말
// 위의 인용은 L1이 남긴 「인용이 든 Codex 한 턴」 기록(S26)으로 잰다.
//
// 글은 사람처럼 마우스로 끌어 고른다. 줄 범위는 원문(`plan.md`)에서 손으로 센 값이다 — 1 `# 계획` · 3–4 문단 · 6 `## 할 일` · 8–9 목록.

const spec = specCopy("changes");
const quoted = record("codex-quote");
const SENT_SEQ = quoted.find((line) => line.kind === "sent")!.seq;


/** 기록의 머리말이 말하는 work — slug `cart`. 기본 문서는 `plan.md`다. */
const cart = cartWork(spec, "plan.md");

/** 그 work에 이미 선 Codex 대화 — 기록 읽기는 보낸 말 앞(열림 줄)까지를 답한다. */
const codex = conversationRow({ id: "c-cart-codex", agent: "codex", name: "Codex", lastSeq: SENT_SEQ - 1 });

const 토글 = (page: Page) => page.getByRole("button", { name: /^작업 패널 (접기|펼치기)$/ });
/** 작업 패널 칸(두 번째 `aside`)의 그려진 폭 — 닫히면 0이다(`tab-keys.spec.ts`와 같은 잼). */
const 패널폭 = (page: Page) => page.locator("aside").nth(1).evaluate((el) => Math.round(el.getBoundingClientRect().width));
const 문서 = (page: Page) => page.getByRole("main", { name: "문서", exact: true });
const 인용단추 = (page: Page) => page.getByRole("button", { name: "❝ 이 자리를 두고 말하기", exact: true });
/** 입력창의 인용 칩 — 칩마다 `data-quote`가 달린다(보낸 말 위의 인용은 `data-sent-quote`). */
const 인용칩 = (page: Page) => 작업패널(page).locator("[data-quote]");

/** cart의 plan.md를 연다 — 작업 패널은 기본값(열림 · `spec` 칸)이라 대화창은 가려져 있다. */
async function openPlan(page: Page): Promise<void> {
  await installFixtureBackend(page, {
    list_works: [cart],
    read_spec_file: answerByArg("path", spec.bodies),
    chat_list: answerByArg("work", { [cart.slug]: [codex] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [codex.id]: linesThrough(quoted, SENT_SEQ - 1) }),
  });
  await page.goto(`/works/${cart.slug}?file=plan.md`);
  await expect(문서(page).getByRole("heading", { level: 1, name: "계획" })).toBeVisible({ timeout: 20_000 });
}

/**
 * 사람처럼 끌어 고른다 — `from`의 글 첫 글자 왼쪽에서 눌러 `to` 안의 (`toX` 비율 · 세로 가운데) 자리에서 놓는다. 고른 글은 화면이
 * 실제로 고른 그대로(`getSelection()`)를 돌려준다.
 */
async function dragSelect(page: Page, from: Locator, to: Locator, toX: number): Promise<string> {
  const start = (await from.boundingBox())!;
  const end = (await to.boundingBox())!;
  await page.mouse.move(start.x + 1, start.y + Math.min(start.height / 2, 10));
  await page.mouse.down();
  await page.mouse.move(end.x + end.width * toX, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

/** 보내기 명령의 인자들 — 부른 차례대로. */
const sends = async (page: Page) => (await ipcCallArgs(page, "chat_send", "work")).map(({ args }) => args);

test("렌더 보기: 고른 글 곁에 단추가 뜨고, 누르면 가려져 있던 대화창이 작업 패널 `chat`으로 열리며 칩이 붙고, 보내기 명령에 파일 · 블록 경계의 줄 범위 · 글이 실린다", async ({
  page,
}) => {
  await openPlan(page);
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-pressed", "false");

  // 문단(3–4줄) 가운데에서 소제목(6줄) 가운데까지 고른다 — 두 블록에 걸친다.
  const paragraph = 문서(page).getByText("요약 한 줄.", { exact: false });
  const heading = 문서(page).getByRole("heading", { level: 2, name: "할 일" });
  const selected = (await dragSelect(page, paragraph, heading, 0.5)).trim();
  expect(selected).toContain("첫 문단을 고쳤다.");
  expect(selected).toMatch(/할/);

  // 단추는 고른 자리 곁에 선다 — 고른 글의 첫 줄(문단) 바로 위나 아래다.
  const button = 인용단추(page);
  await expect(button).toBeVisible();
  const at = (await button.boundingBox())!;
  const para = (await paragraph.boundingBox())!;
  expect(Math.abs(at.y + at.height / 2 - (para.y + para.height / 2))).toBeLessThan(60);

  await button.click();
  // 대화창이 가려져 있었다 — 작업 패널이 `chat`으로 열린다. 고른 글은 거둬지고 단추도 걷힌다.
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-pressed", "true");
  await expect(인용단추(page)).toHaveCount(0);
  await expect(인용칩(page)).toHaveCount(1);
  await expect(인용칩(page)).toContainText("· plan.md");
  await expect(인용칩(page)).toContainText(/^❝/);
  // 칩이 붙은 입력칸에서 곧바로 이어 쓴다.
  await expect(입력칸(page)).toBeFocused();

  await 입력칸(page).fill("이 두 블록을 한 문단으로 합쳐 줘");
  await 입력칸(page).press("Enter");
  const quote: Quote = { file: "plan.md", start: 3, end: 6, text: selected };
  expect(await sends(page)).toEqual([
    { work: cart.slug, conversation: codex.id, text: "이 두 블록을 한 문단으로 합쳐 줘", quote },
  ]);
  // 보낸 인용은 입력창에서 걷힌다 — 인용은 그 말 하나의 것이다.
  await expect(인용칩(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("원문 보기: 고른 줄 그대로 실리고, 새로 고르면 칩이 바뀌며(인용은 하나), 칩의 ×로 빠진다", async ({ page }) => {
  await openPlan(page);
  // 대화창이 이미 보이는 채로 시작한다 — 단추를 눌러도 패널이 닫히지 않는다.
  await 레일칸(page, "chat").click();
  await expect(입력칸(page)).toBeVisible();

  // 렌더 보기에서 목록(8–9줄) 한 줄을 고른다.
  const items = [문서(page).getByText("하나", { exact: true }), 문서(page).getByText("둘을 고쳤다.", { exact: true })] as const;
  await dragSelect(page, items[0], items[1], 0.3);
  await 인용단추(page).click();
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-pressed", "true");
  await expect(인용칩(page)).toHaveCount(1);
  await expect(인용칩(page)).toContainText("하나");

  // 원문 보기로 바꿔 3줄의 첫 글자부터 4줄 끝까지 고른다 — 줄번호는 고른 글에 섞이지 않는다.
  await page.getByRole("button", { name: "원문 보기", exact: true }).click();
  const row = (line: number) => 문서(page).locator(`[data-line="${line}"]`);
  await expect(row(9)).toContainText("둘을 고쳤다.");
  await dragSelect(page, row(3).locator("span").last(), row(4), 0.95);
  await 인용단추(page).click();
  await expect(인용칩(page)).toHaveCount(1);
  await expect(인용칩(page)).toContainText("❝요약 한 줄. 첫 문단을 고쳤다.❞ · plan.md");

  await 입력칸(page).fill("한 줄로");
  await 입력칸(page).press("Enter");
  const quote: Quote = { file: "plan.md", start: 3, end: 4, text: "요약 한 줄.\n첫 문단을 고쳤다." };
  expect(await sends(page)).toEqual([{ work: cart.slug, conversation: codex.id, text: "한 줄로", quote }]);

  // 다시 고르고 칩의 ×로 뺀다 — 그 뒤의 보내기에는 인용이 없다.
  await dragSelect(page, row(1).locator("span").last(), row(1), 0.95);
  await 인용단추(page).click();
  await expect(인용칩(page)).toContainText("❝# 계획❞ · plan.md");
  await 작업패널(page).getByRole("button", { name: "인용 빼기", exact: true }).click();
  await expect(인용칩(page)).toHaveCount(0);
  await 입력칸(page).fill("인용 없이");
  await 입력칸(page).press("Enter");
  expect((await sends(page))[1]).toEqual({ work: cart.slug, conversation: codex.id, text: "인용 없이" });
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("작업 패널이 닫혀 있었으면 `chat`으로 열린다 — 세 번 눌러 고른 문단은 그 블록 하나다", async ({ page }) => {
  await openPlan(page);
  await 토글(page).click();
  await expect(토글(page)).toHaveAccessibleName("작업 패널 펼치기");
  await expect.poll(() => 패널폭(page)).toBe(0);

  // 세 번 눌러 문단을 고른다 — 고른 범위의 끝이 다음 블록(소제목)의 첫머리에 닿아도 그 블록은 들지 않는다.
  await 문서(page).getByText("요약 한 줄.", { exact: false }).click({ clickCount: 3 });
  const selected = (await page.evaluate(() => window.getSelection()?.toString() ?? "")).trim();
  expect(selected).toContain("첫 문단을 고쳤다.");
  await 인용단추(page).click();
  await expect(토글(page)).toHaveAccessibleName("작업 패널 접기");
  await expect.poll(() => 패널폭(page)).toBeGreaterThan(200);
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-pressed", "true");
  await expect(인용칩(page)).toContainText("· plan.md");

  await 입력칸(page).fill("줄여 줘");
  await 입력칸(page).press("Enter");
  const quote: Quote = { file: "plan.md", start: 3, end: 4, text: selected };
  expect(await sends(page)).toEqual([{ work: cart.slug, conversation: codex.id, text: "줄여 줘", quote }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("보낸 말 위에 인용이 선다 — 기록의 `sent`에서, 에이전트에게 간 인용 블록(참조 꼴)은 흐름에 보이지 않는다", async ({
  page,
}) => {
  await openPlan(page);
  await 레일칸(page, "chat").click();
  await expect(입력칸(page)).toBeVisible();

  await streamLines(page, cart.slug, codex.id, linesAfter(quoted, SENT_SEQ - 1));
  const message = 작업패널(page).getByText("이 문단을 한 줄로 줄여 줘", { exact: true });
  const sentQuote = 작업패널(page).locator("[data-sent-quote]");
  await expect(message).toBeVisible();
  await expect(sentQuote).toHaveCount(1);
  await expect(sentQuote).toHaveText("❝요약 한 줄. 첫 문단을 고쳤다.❞ · plan.md");
  // 말풍선 바로 위에 선다.
  const quoteBox = (await sentQuote.boundingBox())!;
  const messageBox = (await message.boundingBox())!;
  expect(quoteBox.y + quoteBox.height).toBeLessThanOrEqual(messageBox.y);
  expect(messageBox.y - (quoteBox.y + quoteBox.height)).toBeLessThan(24);
  await expect(작업패널(page).getByText(/spec\/plan\.md:L3-4/)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
