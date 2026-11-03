import { WORK_WRITING_EVENT } from "@/features/thread/events";
import type { ThreadView, WorkWritingEvent } from "@/features/thread/types";
import type { ProjectChanges } from "@/features/works/types";
import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, FIXTURE_THREAD, WORKS, worktreeFile, worktreeFolder } from "./fixtures";
import { fireEvent, fireEventToAll, installFixtureBackend, replaceAnswer, unknownIpcCalls } from "./harness";
import { atHome, lineOf, record, sentPayloads, specWrites, summaryOf, titleThrough, workView } from "./thread-records";

// restart 02b-9a — **요약 카드의 움직임**(restart 02b-8 · SummarySheet 움직임 · `시안-비교/02b-8/차이.md` 「움직임」). 작은 카드는 오른쪽 위
// (4, −4) · .98 · 옅음에서 220으로 서고 닫으면 곧바로 걷힌다. 대화 열은 오른쪽 몫 308을 500 spring으로 비운다. 넓어질 때는 자리 왼쪽 · 카드
// 높이 · 목록 폭이 500 spring으로 한 번에 옮겨 가고 보기가 500 `ease-panel`로 옅음에서 선다 — 카드 높이는 그동안 줄지 않는다. 쓰는 중 점은
// 1.6s로 숨 쉬고, 새로 바뀐 줄은 1.6s 빛나며, 「모두 보기」로 새로 선 줄만 아래 4에서 200으로 선다.
//
// Thread는 축복한 Work 만들기 턴(`thread-work`)이 끝난 자리이고, worktree의 변경 · 트리는 코어의 답을 손으로 적는다(`thread-work-card.spec.ts`와 같다).

test.use({ viewport: { width: 1440, height: 900 } });

const lines = atHome(record("thread-work"));
const CREATED = lineOf(lines, "work", "created");
const MADE = CREATED.payload as { slug: string; title: string; branch: string; projects: string[] };
const [PROJECT] = MADE.projects;
const LAST = lines[lines.length - 1].seq;
const view: ThreadView = { ...FIXTURE_THREAD, title: titleThrough(lines, LAST), work: MADE.slug, lastSeq: LAST };
const WRITTEN = specWrites(lines, MADE.slug);
const [OVERVIEW, PLAN] = Object.keys(WRITTEN);
/** 소스가 셋을 넘게 — 「모두 보기」 뒤에 둘이 숨는다. */
const MORE_DOCS = ["notes/첫-메모.md", "notes/둘째-메모.md"];
const SERVICE = "refund/service.py";
const CHANGES: ProjectChanges[] = [{ project: PROJECT, kind: "listed", base: "main", files: [{ path: SERVICE, additions: 6, deletions: 3 }] }];

const 흐름 = (page: Page) => page.getByRole("main");
const 카드 = (page: Page) => page.getByRole("region", { name: "요약", exact: true });

async function openChat(page: Page): Promise<void> {
  await installFixtureBackend(page, {
    list_works: [...WORKS, workView(MADE, { docs: [...Object.keys(WRITTEN), ...MORE_DOCS], trees: [PROJECT] })],
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: lines }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: LAST } }),
    read_spec_file: answerByArg("path", WRITTEN),
    list_work_changes: CHANGES,
    list_worktree_tree: answerByArg("project", {
      [PROJECT]: { kind: "listed", entries: [worktreeFolder("refund", [worktreeFile(SERVICE)]), worktreeFile("README.md")] },
    }),
  });
  await page.goto(`/threads/${view.id}`);
  await expect(page).toHaveURL(`/works/${MADE.slug}?tab=chat&thread=${view.id}`, { timeout: 20_000 });
  await expect(흐름(page).getByText(sentPayloads(lines)[0].text, { exact: true }).last()).toBeVisible({ timeout: 20_000 });
}

/** 그 요소에 걸린 CSS 움직임 · 전이 — 이름(전이면 속성) · 길이 · 곡선. */
const 걸림 = (target: Locator) =>
  target.evaluate((el) =>
    el.getAnimations().map((one) => {
      const style = getComputedStyle(el);
      const name = one instanceof CSSTransition ? one.transitionProperty : (one as CSSAnimation).animationName;
      const easing = one instanceof CSSTransition ? style.transitionTimingFunction : style.animationTimingFunction;
      return { name, ms: Number(one.effect?.getTiming().duration), spring: easing.startsWith("linear("), easing: easing.startsWith("linear(") ? "spring" : easing };
    }),
  );

/** 대화 열 오른쪽 빈 칸 — 몫(`flex-basis`)을 패널 박자로 옮기는 칸이다(`ThreadScreen`의 `Beside`). */
const 비킬칸 = (page: Page) =>
  흐름(page).evaluate((main) => {
    const room = [...main.querySelectorAll<HTMLElement>("span[aria-hidden]")].find((el) => getComputedStyle(el).transitionProperty === "flex-basis");
    if (!room) throw new Error("비킬 칸이 없다");
    const style = getComputedStyle(room);
    return { basis: style.flexBasis, duration: style.transitionDuration, spring: style.transitionTimingFunction.startsWith("linear(") };
  });

test("요약 카드는 오른쪽 위 (4, −4) · .98 · 옅음에서 220으로 서고, 대화 열이 몫 308을 500 spring으로 비우며, 닫으면 다음 프레임에 카드가 없다", async ({ page }) => {
  await openChat(page);
  expect((await 비킬칸(page)).basis).toBe("0px");
  await page.getByRole("button", { name: "요약 카드", exact: true }).click();
  await expect(카드(page)).toBeVisible();

  const slot = page.locator(".summary-in");
  await expect(slot).toHaveCount(1);
  expect(await 걸림(slot)).toEqual([{ name: "summary-in", ms: 220, spring: false, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }]);
  expect(
    await slot.evaluate((el) => {
      const [first] = el.getAnimations()[0].effect instanceof KeyframeEffect ? (el.getAnimations()[0].effect as KeyframeEffect).getKeyframes() : [];
      return [first?.opacity, first?.transform, getComputedStyle(el).transformOrigin];
    }),
  ).toEqual(["0", "translate(4px, -4px) scale(0.98)", "300px 0px"]);
  expect(await 비킬칸(page)).toMatchObject({ duration: "0.5s", spring: true });
  await expect.poll(async () => (await 비킬칸(page)).basis).toBe("308px");

  // 닫기 — 누른 다음 프레임에 카드가 없다(움직임 없이 곧바로).
  const gone = await page.evaluate(
    () =>
      new Promise<boolean>((done) => {
        (document.querySelector('button[aria-label="요약 카드"]') as HTMLElement).click();
        requestAnimationFrame(() => done(document.querySelector('section[aria-label="요약"]') === null));
      }),
  );
  expect(gone).toBe(true);
  await expect.poll(async () => (await 비킬칸(page)).basis).toBe("0px");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("카드가 넓어질 때 자리 왼쪽 · 카드 높이 · 목록 폭이 500 spring으로 한 번에 옮겨 가고 보기가 500 ease-panel로 옅음에서 서며, 그동안 카드 높이가 줄지 않는다", async ({
  page,
}) => {
  await openChat(page);
  await page.getByRole("button", { name: "요약 카드", exact: true }).click();
  await expect(카드(page)).toBeVisible();
  await expect.poll(() => page.locator(".summary-in").evaluate((el) => el.getAnimations().every((one) => one.playState === "finished"))).toBe(true);

  // 대화 속 문서 카드를 누르고 프레임마다 카드 높이와 자리 왼쪽을 적는다.
  const frames = await page.evaluate(
    (doc) =>
      new Promise<{ height: number; left: number }[]>((done) => {
        const seen: { height: number; left: number }[] = [];
        const start = performance.now();
        const frame = () => {
          const card = document.querySelector('section[aria-label="요약"]');
          if (card) seen.push({ height: Math.round(card.getBoundingClientRect().height), left: Math.round(card.getBoundingClientRect().left) });
          if (performance.now() - start < 800) requestAnimationFrame(frame);
          else done(seen);
        };
        (document.querySelector(`[data-doc-card="${doc}"]`) as HTMLElement).click();
        requestAnimationFrame(frame);
      }),
    OVERVIEW,
  );
  const said = frames.map(({ height, left }) => `${left}/${height}`).join(" ");
  // spring이 끝에서 1px 넘었다 돌아오는 것은 둔다 — 내용 높이로 줄었다 다시 자라는 튐(수십 px)을 잡는다.
  for (let at = 1; at < frames.length; at += 1) expect(frames[at].height, `높이가 줄지 않는다 ${said}`).toBeGreaterThanOrEqual(frames[at - 1].height - 1);
  expect(frames.filter((one) => one.left < frames[0].left && one.left > frames[frames.length - 1].left).length, `왼쪽이 여러 프레임에 걸쳐 옮겨 간다 ${said}`).toBeGreaterThanOrEqual(5);

  const card = page.locator("section[data-expanded]");
  await expect(card).toBeVisible();
  const slot = page.locator(".summary-in");
  expect(await slot.evaluate((el) => [getComputedStyle(el).transitionProperty, getComputedStyle(el).transitionDuration])).toEqual(["left", "0.5s"]);
  expect(await card.evaluate((el) => [getComputedStyle(el).transitionProperty, getComputedStyle(el).transitionDuration, getComputedStyle(el).transitionTimingFunction.startsWith("linear(")])).toEqual([
    "min-height",
    "0.5s",
    true,
  ]);
  const list = card.locator(":scope > div").first();
  expect(await list.evaluate((el) => [getComputedStyle(el).transitionProperty, getComputedStyle(el).transitionDuration, getComputedStyle(el).transitionTimingFunction.startsWith("linear(")])).toEqual([
    "width",
    "0.5s",
    true,
  ]);
  await expect.poll(() => list.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(264);
  const viewer = page.locator('[data-viewer="doc"]');
  expect(await viewer.evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).animationDuration, getComputedStyle(el).animationTimingFunction])).toEqual([
    "view-in",
    "0.5s",
    "cubic-bezier(0.2, 0, 0, 1)",
  ]);
  // 넓힌 카드면 비킬 몫이 없다 — 대화 열(입력창)이 왼쪽 480 안을 좌우 16만 남기고 다 쓴다.
  const composer = page.getByRole("textbox", { name: "보낼 말", exact: true }).locator("xpath=ancestor::form[1]");
  await expect.poll(() => composer.evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(480 - 32);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("쓰는 중인 문서의 점은 1.6s로 되풀이해 숨 쉬고, 「모두 보기」로 새로 선 줄만 row-in 200으로 서며, 새로 바뀐 파일이 오면 「변경 사항」 줄이 1.6s 빛난다", async ({
  page,
}) => {
  await openChat(page);
  await page.getByRole("button", { name: "요약 카드", exact: true }).click();
  await expect(카드(page).locator("[data-doc]")).toHaveCount(3);

  // 쓰는 중 — 그 줄이 맨 위로 오고 점이 숨 쉰다.
  const writing: WorkWritingEvent = { work: MADE.slug, writing: [{ path: PLAN, thread: view.id }] };
  await fireEvent(page, WORK_WRITING_EVENT, writing);
  const dot = 카드(page).locator(`[data-doc="${PLAN}"] .writing-pulse`);
  await expect(dot).toHaveCount(1);
  expect(await dot.evaluate((el) => el.getAnimations().map((one) => [(one as CSSAnimation).animationName, one.effect?.getTiming().duration, one.effect?.getTiming().iterations]))).toEqual([
    ["writing-pulse", 1600, Infinity],
  ]);
  // 다 쓰면 점이 걷히고 막 쓴 그 줄이 1.6s 빛난다.
  await fireEvent(page, WORK_WRITING_EVENT, { ...writing, writing: [] });
  await expect(dot).toHaveCount(0);
  expect(await 카드(page).locator(`[data-doc="${PLAN}"]`).evaluate((el) => el.getAnimations().map((one) => [(one as CSSAnimation).animationName, one.effect?.getTiming().duration]))).toEqual([
    ["doc-flash", 1600],
  ]);

  // 「모두 보기」 — 그 줄이 걷히고 숨은 줄만 아래 4에서 200으로 선다. 이미 선 줄은 그대로다.
  const shown = await 카드(page).locator("[data-doc]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-doc")));
  await 카드(page).getByRole("button", { name: "모두 보기", exact: true }).click();
  await expect(카드(page).getByRole("button", { name: "모두 보기", exact: true })).toHaveCount(0);
  const rows = await 카드(page)
    .locator("[data-doc], [data-project]")
    .evaluateAll((all) =>
      all.map((row) => ({
        name: row.getAttribute("data-doc") ?? row.getAttribute("data-project"),
        // 들어서는 움직임만 본다 — 가리킨 줄의 색 전이(150)와 막 쓴 줄의 빛남은 뺀다.
        moves: row
          .getAnimations()
          .filter((one) => one instanceof CSSAnimation)
          .map((one) => `${(one as CSSAnimation).animationName} ${one.effect?.getTiming().duration}`)
          .filter((move) => !move.startsWith("doc-flash")),
      })),
    );
  for (const row of rows) {
    if (shown.includes(row.name)) expect(row.moves, `이미 선 줄 ${row.name}`).toEqual([]);
  }
  const late = rows.filter((row) => !shown.includes(row.name));
  expect(late.length).toBeGreaterThan(0);
  for (const row of late) expect(row.moves, `새로 선 줄 ${row.name}`).toEqual(["row-in 200"]);

  // 새로 바뀐 파일 — 감시가 알리면 변경을 다시 읽고, 새로 온 파일이 있으면 「변경 사항」 줄이 1.6s 빛난다.
  const changes = 카드(page).locator("[data-changes]");
  expect(await changes.evaluate((el) => el.getAnimations().length)).toBe(0);
  await replaceAnswer(page, "list_work_changes", [
    { ...CHANGES[0], files: [...(CHANGES[0] as { files: unknown[] }).files, { path: "refund/views.py", additions: 2, deletions: 0 }] },
  ]);
  await fireEventToAll(page, "worktree:changed", { slug: MADE.slug, project: PROJECT });
  await expect(changes).toHaveText(/\+8\s*−3$/);
  expect(await changes.evaluate((el) => el.getAnimations().map((one) => [(one as CSSAnimation).animationName, one.effect?.getTiming().duration]))).toEqual([
    ["doc-flash", 1600],
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
