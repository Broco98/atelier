import { THREAD_QUEUE_EVENT } from "@/features/thread/events";
import type { RecordLine, ThreadQueueEvent, ThreadView } from "@/features/thread/types";
import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { fireEvent, holdCommand, installFixtureBackend, releaseCommand, unknownIpcCalls, 그림자, 토큰값, 토큰색 } from "./harness";
import { linesThrough, record, sentPayloads, seqOf, streamLines, summaryOf } from "./thread-records";

// restart 02b-9a — **입력창**(restart 02b-2 · Composer 보드 · States 09 · Cards 「대기 중에 끼어든 말」 · `시안-비교/02b-2/차이.md`). 상자는 위 14 ·
// 좌우 · 아래 8 · 둥근 22 · `shadow-composer`이고 글은 14 / 22.75이며, 글 칸은 44에서 204까지 220ms로 자란다. 도는 동안 보낸 말은 `surface-tray`
// 대기 줄이고, 「지금 보내기」로 끼어든 말의 말풍선 아래에는 「하던 일을 멈추고 보냄」이 선다. 읽기만 되는 채팅은 입력창 자리가 안내 상자다.
// 입력창이 520보다 좁으면 모드 칩이 방패만 남는다.

const twoTurns = record("thread-two-turns");
const SECOND_SENT = seqOf(twoTurns, "sent", 2);
const LAST = twoTurns[twoTurns.length - 1].seq;
const TITLE = sentPayloads(twoTurns)[0].text;

const 흐름 = (page: Page) => page.getByRole("main");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 입력창 = (page: Page) => 입력칸(page).locator("xpath=ancestor::form[1]");

async function open(page: Page, view: ThreadView, lines: readonly RecordLine[]): Promise<void> {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: lines }),
    thread_mark_read: answerByArg("thread", { [view.id]: summaryOf(view) }),
  });
  await page.goto(`/threads/${view.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText(TITLE, { exact: true })).toBeVisible({ timeout: 20_000 });
}

const 스타일 = (target: Locator, ...names: string[]) =>
  target.evaluate((el, keys) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(keys.map((key) => [key, style.getPropertyValue(key)]));
  }, names);

const ended: ThreadView = { ...FIXTURE_THREAD, title: TITLE, live: false, lastSeq: LAST };

test.describe(() => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("입력창 상자는 위 14 · 좌우 아래 8 · 둥근 22 · shadow-composer이고 글은 14 / 22.75이며, 글 칸은 44에서 열한 줄의 204까지 220ms로 자라고 멈춘다", async ({
    page,
  }) => {
    await open(page, ended, twoTurns);
    const box = 입력창(page);
    expect(await 스타일(box, "padding", "border-top-left-radius", "background-color")).toEqual({
      padding: "14px 8px 8px",
      "border-top-left-radius": "22px",
      "background-color": await 토큰색(page, "--surface-composer"),
    });
    expect(그림자(await box.evaluate((el) => getComputedStyle(el).boxShadow))).toBe(그림자(await 토큰값(page, "box-shadow", "--shadow-composer")));
    // 끌어다 놓을 때 고리가 서는 그림자 전이(`duration-basic`)다.
    expect(await box.evaluate((el) => [getComputedStyle(el).transitionProperty, getComputedStyle(el).transitionDuration])).toEqual(["box-shadow", "0.15s"]);

    const field = 입력칸(page);
    await expect(field).toHaveAttribute("placeholder", "후속 작업을 입력하세요");
    expect(await 스타일(field, "font-size", "line-height", "letter-spacing", "transition")).toEqual({
      "font-size": "14px",
      "line-height": "22.75px",
      "letter-spacing": "-0.15px",
      transition: "height 0.22s cubic-bezier(0.2, 0, 0, 1)",
    });
    const 높이 = () => field.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(await 높이()).toBe(44);
    await field.fill(Array.from({ length: 4 }, (_, at) => `${at + 1}째 줄`).join("\n"));
    await expect.poll(높이).toBeGreaterThan(44);
    await field.fill(Array.from({ length: 20 }, (_, at) => `${at + 1}째 줄`).join("\n"));
    await expect.poll(높이).toBe(204);
    await field.fill("");
    await expect.poll(높이).toBe(44);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("「지금 보내기」로 끼어든 말의 말풍선 아래 4 오른쪽 끝에 「하던 일을 멈추고 보냄」(12 fg-tertiary)이 서고, 보통 말에는 없다", async ({ page }) => {
    const lines = twoTurns.map((line) => (line.seq === SECOND_SENT ? { ...line, payload: { ...(line.payload as object), sendNow: true } } : line));
    await open(page, ended, lines);
    const said = 흐름(page).getByText("하던 일을 멈추고 보냄", { exact: true });
    await expect(said).toHaveCount(1);
    const message = 흐름(page).locator("[data-user-message]").filter({ hasText: "하던 일을 멈추고 보냄" });
    await expect(message).toContainText(sentPayloads(twoTurns)[1].text);
    expect(await 스타일(said, "font-size", "color")).toEqual({ "font-size": "12px", color: await 토큰색(page, "--fg-tertiary") });
    const bubble = message.getByText(sentPayloads(twoTurns)[1].text, { exact: true });
    const [bubbleBox, saidBox] = [await bubble.boundingBox(), await said.boundingBox()];
    expect(Math.round(saidBox!.y - bubbleBox!.y - bubbleBox!.height), "말풍선 아래 4").toBe(4);
    expect(Math.round(saidBox!.x + saidBox!.width)).toBe(Math.round(bubbleBox!.x + bubbleBox!.width));
    // 첫 말은 보통 말이라 없다.
    await expect(흐름(page).locator("[data-user-message]").first().getByText("하던 일을 멈추고 보냄")).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("도는 동안 쌓인 말은 입력창 위 8에 최소 36 · 둥근 12 · surface-tray 대기 줄로 서고 「지금 보내기」는 24다", async ({ page }) => {
    const running: ThreadView = { ...FIXTURE_THREAD, title: TITLE, live: true, lastSeq: SECOND_SENT };
    await open(page, running, linesThrough(twoTurns, SECOND_SENT));
    await expect(입력칸(page)).toHaveAttribute("placeholder", "일하는 동안 더 말해 두면 차례로 보내요");
    const queued: ThreadQueueEvent = {
      thread: running.id,
      queue: [
        { id: "queued-1", text: "다 되면 표로 정리해 줘", sendNow: false },
        { id: "queued-2", text: "그다음 테스트도 돌려 줘", sendNow: false },
      ],
    };
    await fireEvent(page, THREAD_QUEUE_EVENT, queued);
    const rows = page.getByRole("list", { name: "기다리는 말", exact: true }).getByRole("listitem");
    await expect(rows).toHaveCount(2);
    expect(await 스타일(rows.first(), "min-height", "border-top-left-radius", "background-color", "font-size", "color")).toEqual({
      "min-height": "36px",
      "border-top-left-radius": "12px",
      "background-color": await 토큰색(page, "--surface-tray"),
      "font-size": "13px",
      color: await 토큰색(page, "--fg-secondary"),
    });
    // 대기 줄은 칩처럼 들어선다(`chip-in`) — 다 선 뒤에 잰다.
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter((one) => one.playState === "running" && (one as CSSAnimation).animationName === "chip-in").length)).toBe(0);
    const [first, second, composer] = [await rows.nth(0).boundingBox(), await rows.nth(1).boundingBox(), await 입력창(page).boundingBox()];
    expect(Math.round(second!.y - first!.y - first!.height), "줄 사이 8").toBe(8);
    expect(Math.round(composer!.y - second!.y - second!.height), "입력창까지 8").toBe(8);
    const sendNow = rows.first().getByRole("button", { name: "지금 보내기", exact: true });
    expect(await 스타일(sendNow, "height", "border-top-left-radius", "font-size")).toEqual({ height: "24px", "border-top-left-radius": "10px", "font-size": "12px" });
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 세션 여는 중(States 02 · restart 02b-9b) — 내려가 있던 Session에 말을 보내면 엔진이 Session을 다시 띄우는 동안(`spawning` → `opened`) 입력창이
  // 새 채팅의 첫 말처럼 「채팅을 시작하는 중…」 · 읽기만 · 모델 칩 스켈레톤 · 「보내는 중」 원이다. 열리면 돌아온다.
  test("내려간 Session에 보내면 Session을 다시 여는 동안 입력창이 「채팅을 시작하는 중…」 · 읽기만 · 「모델을 읽는 중」 · 「보내는 중」이고, 열리면 돌아온다", async ({
    page,
  }) => {
    const firstEnd = seqOf(twoTurns, "turn-end", 1);
    const down: ThreadView = { ...FIXTURE_THREAD, title: TITLE, live: false, lastSeq: firstEnd };
    await open(page, down, linesThrough(twoTurns, firstEnd));
    await holdCommand(page, "thread_send");
    const field = 입력칸(page);
    await field.fill(sentPayloads(twoTurns)[1].text);
    await field.press("Enter");
    const at = twoTurns[firstEnd - 1].at;
    await streamLines(page, down.id, [{ seq: firstEnd + 1, at, kind: "session", payload: { state: "spawning" } }]);
    await expect(field).toHaveAttribute("placeholder", "채팅을 시작하는 중…");
    await expect(field).toHaveAttribute("readonly", "");
    await expect(field).toHaveValue("");
    await expect(입력창(page).getByRole("status", { name: "모델을 읽는 중" })).toBeVisible();
    await expect(입력창(page).getByRole("button", { name: /^모델과 생각 깊이/ })).toHaveCount(0);
    await expect(입력창(page).getByRole("button", { name: "보내는 중", exact: true })).toBeDisabled();

    // Session이 열린다 — 보낸 말이 기록에 서기 전이라도 입력창이 돌아온다.
    const opened = twoTurns.find((line) => line.kind === "session" && (line.payload as { state?: string }).state === "opened")!;
    await streamLines(page, down.id, [{ ...opened, seq: firstEnd + 2, at }]);
    await expect(field).toHaveAttribute("placeholder", "후속 작업을 입력하세요");
    await expect(field).not.toHaveAttribute("readonly", "");
    await expect(입력창(page).getByRole("button", { name: /^모델과 생각 깊이/ })).toBeVisible();
    await expect(입력창(page).getByRole("button", { name: "보내는 중", exact: true })).toHaveCount(0);
    await releaseCommand(page, "thread_send");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  // 입력창의 메뉴(Composer 05 · 07 · 09 · 10) — 트리거가 아니라 입력창 상자에 붙어 위 8에 선다. 물어보는 정도는 왼쪽에서 8 들어선 280, 모델은
  // 오른쪽에서 8 들어선 280, Runtime은 320이다. 「/」 목록은 상자 위 8 · 둥근 16 · 머리 「Claude Code 명령」 · 줄 30이다.
  test("입력창 메뉴는 상자 위 8에 붙고(물어보는 정도 왼쪽 +8 · 280, 모델 오른쪽 −8 · 280, Runtime 320), 「/」 목록은 위 8 · 둥근 16 · 머리 「Claude Code 명령」 · 줄 30이다", async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });
    const box = await 입력창(page).boundingBox();
    const 메뉴자리 = async (chip: RegExp) => {
      await 입력창(page).getByRole("button", { name: chip }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      // 모델 메뉴는 자라며 선다 — 다 선 뒤에 잰다.
      await expect.poll(() => menu.evaluate((el) => el.getAnimations().every((one) => one.playState !== "running"))).toBe(true);
      const at = (await menu.boundingBox())!;
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      return { above: Math.round(box!.y - at.y - at.height), left: Math.round(at.x - box!.x), right: Math.round(box!.x + box!.width - at.x - at.width), width: Math.round(at.width) };
    };
    expect(await 메뉴자리(/^물어보는 정도/)).toMatchObject({ above: 8, left: 8, width: 280 });
    expect(await 메뉴자리(/^모델과 생각 깊이/)).toMatchObject({ above: 8, right: 8, width: 280 });
    expect(await 메뉴자리(/^Runtime: /)).toMatchObject({ above: 8, width: 320 });

    await 입력칸(page).fill("/");
    const list = page.getByRole("listbox", { name: "명령", exact: true });
    await expect(list).toBeVisible();
    const at = (await list.boundingBox())!;
    expect(Math.round(box!.y - at.y - at.height), "상자 위 8").toBe(8);
    expect(await 스타일(list, "border-top-left-radius")).toEqual({ "border-top-left-radius": "16px" });
    await expect(list.locator('[aria-hidden="true"]').first()).toHaveText("Claude Code 명령");
    expect(Math.round((await list.getByRole("option").first().boundingBox())!.height)).toBe(30);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test("보관된 작업공간의 채팅은 입력창 자리에 최소 40 · 둥근 12 · fill-soft · 13 fg-secondary 안내가 선다", async ({ page }) => {
    const archived: ThreadView = { ...ended, readOnly: "archived" };
    await open(page, archived, twoTurns);
    const notice = page.getByRole("status").filter({ hasText: "보관된 작업공간의 채팅은 읽기만 돼요" });
    await expect(notice).toBeVisible();
    await expect(입력칸(page)).toHaveCount(0);
    expect(await 스타일(notice, "min-height", "padding", "border-top-left-radius", "background-color", "font-size", "line-height", "color")).toEqual({
      "min-height": "40px",
      padding: "8px 8px 8px 12px",
      "border-top-left-radius": "12px",
      "background-color": await 토큰색(page, "--fill-soft"),
      "font-size": "13px",
      "line-height": "18px",
      color: await 토큰색(page, "--fg-secondary"),
    });
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

test.describe(() => {
  // 입력창이 520보다 좁은 창 — 사이드바를 접지 않은 채 열(737)이 줄어든다.
  test.use({ viewport: { width: 760, height: 900 } });

  test("입력창이 520보다 좁으면 모드 칩이 방패만 남고 이름은 접근성 이름으로만 남는다", async ({ page }) => {
    await open(page, ended, linesThrough(twoTurns, LAST));
    const width = await 입력창(page).evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeLessThan(520);
    const chip = 입력창(page).getByRole("button", { name: /^물어보는 정도/ });
    await expect(chip).toBeVisible();
    await expect(chip.locator("svg").first()).toBeVisible();
    const words = chip.locator("span").filter({ hasText: /\S/ });
    expect(await words.evaluateAll((all) => all.filter((el) => getComputedStyle(el).display !== "none").map((el) => el.textContent))).toEqual([]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});
