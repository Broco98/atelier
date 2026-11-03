import type { RecordLine, ThreadView } from "@/features/thread/types";
import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { clipboardWrites, installFixtureBackend, recordClipboard, unknownIpcCalls, 시계를세운다, 토큰색 } from "./harness";
import { record, seqOf, summaryOf } from "./thread-records";

// restart 02b-9a — **내 말 · 긴 말 · 복사**(restart 02b-6 · Cards 보드 「기본」 · 「호버」 · 「긴 말」 · `시안-비교/02b-6/차이.md`). 내 말 아래 말 머리
// (시각 · 「메시지 복사」)는 투명하다가 그 말을 가리키면 150ms로 선다. 8줄 넘는 말은 112에서 잘려 옅어지고 「더 보기」가 높이를 300ms
// `ease-enter`로 펼친 뒤 높이 끝을 걷는다(`none`). 복사하면 글리프가 1.6초 ✓다.
//
// 기록은 축복한 두 턴(`thread-two-turns`)이고 둘째 말만 열두 줄로 늘였다(보낸 말은 기록의 `sent` 줄이 싣는다).

test.use({ viewport: { width: 1440, height: 900 } });

const twoTurns = record("thread-two-turns");
const LAST = twoTurns[twoTurns.length - 1].seq;
const LONG = Array.from({ length: 12 }, (_, at) => `긴 말 ${at + 1}째 줄 — 접히는지 잰다.`).join("\n");
const SECOND_SENT = seqOf(twoTurns, "sent", 2);
const lines: RecordLine[] = twoTurns.map((line) =>
  line.seq === SECOND_SENT ? { ...line, payload: { ...(line.payload as object), text: LONG } } : line,
);
const ended: ThreadView = { ...FIXTURE_THREAD, title: (twoTurns[seqOf(twoTurns, "sent", 1) - 1].payload as { text: string }).text, live: false, lastSeq: LAST };

const 흐름 = (page: Page) => page.getByRole("main");

async function openEnded(page: Page): Promise<void> {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(ended)],
    thread_get: answerByArg("thread", { [ended.id]: ended }),
    thread_read_record: answerByArg("thread", { [ended.id]: lines }),
    thread_mark_read: answerByArg("thread", { [ended.id]: summaryOf(ended) }),
  });
  await page.goto(`/threads/${ended.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText(ended.title, { exact: true })).toBeVisible({ timeout: 20_000 });
}

const 옅음 = (target: Locator) => target.evaluate((el) => getComputedStyle(el).opacity);

test("내 말의 말 머리는 투명하다가 그 말을 가리키면 150ms로 서고 다른 말의 머리는 그대로 투명하다", async ({ page }) => {
  await openEnded(page);
  const [first, second] = [흐름(page).locator("[data-user-message]").nth(0), 흐름(page).locator("[data-user-message]").nth(1)];
  const [firstMeta, secondMeta] = [first.locator("[data-message-meta]"), second.locator("[data-message-meta]")];
  expect([await 옅음(firstMeta), await 옅음(secondMeta)]).toEqual(["0", "0"]);
  expect(await firstMeta.evaluate((el) => getComputedStyle(el).transition)).toBe("opacity 0.15s cubic-bezier(0.4, 0, 0.2, 1)");
  expect(await firstMeta.evaluate((el) => [getComputedStyle(el).height, getComputedStyle(el).fontSize, getComputedStyle(el).color])).toEqual([
    "26px",
    "12px",
    await 토큰색(page, "--fg-tertiary"),
  ]);
  await first.getByText(ended.title, { exact: true }).hover();
  await expect.poll(() => 옅음(firstMeta)).toBe("1");
  expect(await 옅음(secondMeta)).toBe("0");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("8줄 넘는 말은 112에서 잘려 아래가 옅어지고, 「더 보기」가 높이를 300ms ease-enter로 글 높이까지 펼친 뒤 높이 끝을 걷으며, 「접기」가 112로 되돌린다", async ({
  page,
}) => {
  await openEnded(page);
  const bubble = 흐름(page).locator('[data-fold]');
  await expect(bubble).toHaveAttribute("data-fold", "folded");
  const 모양 = () =>
    bubble.evaluate((el) => {
      const style = getComputedStyle(el);
      return { max: style.maxHeight, mask: style.getPropertyValue("-webkit-mask-image"), height: Math.round(el.getBoundingClientRect().height) };
    });
  const folded = await 모양();
  expect(folded.max).toBe("112px");
  expect(folded.height).toBe(112);
  expect(folded.mask).toMatch(/linear-gradient\(.*60%.*\)/);
  expect(await bubble.evaluate((el) => getComputedStyle(el).transition)).toBe("max-height 0.3s cubic-bezier(0.19, 1, 0.22, 1)");

  const more = 흐름(page).getByRole("button", { name: "더 보기", exact: true });
  expect(await more.evaluate((el) => [getComputedStyle(el).height, getComputedStyle(el).paddingLeft, getComputedStyle(el).borderTopLeftRadius, getComputedStyle(el).fontSize])).toEqual([
    "24px",
    "8px",
    "10px",
    "12px",
  ]);
  const [bubbleBox, moreBox] = [await bubble.boundingBox(), await more.boundingBox()];
  expect(Math.round(moreBox!.y - bubbleBox!.y - bubbleBox!.height), "말풍선 아래 4").toBe(4);
  expect(Math.round(moreBox!.x + moreBox!.width), "오른쪽 끝").toBe(Math.round(bubbleBox!.x + bubbleBox!.width));

  // 펼침 — 프레임마다 높이를 적는다. 자라기만 하고, 첫 프레임에 옅음이 걷히며, 다 자라면 높이 끝이 `none`이다.
  const grown = await bubble.evaluate(
    (el, label) =>
      new Promise<{ heights: number[]; masks: string[]; full: number }>((done) => {
        const heights: number[] = [];
        const masks: string[] = [];
        const start = performance.now();
        const frame = () => {
          heights.push(Math.round(el.getBoundingClientRect().height * 10) / 10);
          masks.push(getComputedStyle(el).getPropertyValue("-webkit-mask-image"));
          if (performance.now() - start < 500) requestAnimationFrame(frame);
          else done({ heights, masks, full: el.scrollHeight });
        };
        ([...document.querySelectorAll("button")].find((one) => one.textContent === label) as HTMLElement).click();
        requestAnimationFrame(frame);
      }),
    "더 보기",
  );
  const said = grown.heights.join(" ");
  expect(grown.heights[grown.heights.length - 1], said).toBe(grown.full);
  expect(grown.full).toBeGreaterThan(200);
  expect(grown.heights.filter((height) => height > 112.5 && height < grown.full - 0.5).length, `자라는 프레임 ${said}`).toBeGreaterThanOrEqual(5);
  for (let at = 1; at < grown.heights.length; at += 1) expect(grown.heights[at], said).toBeGreaterThanOrEqual(grown.heights[at - 1]);
  expect(grown.masks[0]).toBe("none");
  await expect(bubble).toHaveAttribute("data-fold", "open");
  await expect.poll(() => bubble.evaluate((el) => getComputedStyle(el).maxHeight)).toBe("none");

  // 접기 — 같은 박자로 112에 돌아온다.
  const fold = 흐름(page).getByRole("button", { name: "접기", exact: true });
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await fold.click();
  await expect(bubble).toHaveAttribute("data-fold", "folded");
  await expect.poll(async () => (await 모양()).height).toBe(112);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **✓가 선 시간은 `page.clock`으로 잰다** — 페이지를 열기 전에 시계를 걸고, 누르기 직전에 세워 손으로 돌린다(1599ms에는 ✓, 1600ms면 돌아온다).
// 한때 벽시계로 ✓가 선 프레임부터 걷힌 프레임까지를 재(1550–1900ms) 느린 러너에서 흔들렸다.
test("복사 단추는 누르면 그 글을 클립보드에 쓰고 글리프가 1.6초 동안 ✓였다가 돌아온다", async ({ page }) => {
  await recordClipboard(page);
  await page.clock.install();
  await openEnded(page);
  const first = 흐름(page).locator("[data-user-message]").first();
  await first.hover();
  const copy = first.getByRole("button", { name: "메시지 복사", exact: true });
  const glyph = copy.locator("svg");
  await expect(glyph).toHaveClass(/lucide-copy/);
  await 시계를세운다(page);
  await copy.click();
  await expect(glyph).toHaveClass(/lucide-check/);
  await page.clock.runFor(1599);
  await expect(glyph).toHaveClass(/lucide-check/);
  await page.clock.runFor(1);
  await expect(glyph).toHaveClass(/lucide-copy/);
  await page.clock.resume();
  expect(await clipboardWrites(page)).toEqual([ended.title]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
