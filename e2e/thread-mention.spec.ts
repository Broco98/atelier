import { expect, test, type Locator, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { callCount, installFixtureBackend, ipcArgs, unknownIpcCalls, 토큰색 } from "./harness";
import { linesThrough, record, sentPayloads, seqOf, summaryOf } from "./thread-records";
import type { ThreadView } from "@/features/thread/types";

// restart 02b-9a — **입력창의 `@`로 파일을 언급한다**(구현 스펙 「02b — 대화창」 `@` 파일 언급 · 「재는 동작 · 화면」 「`@` 메뉴가 작업 폴더, spec 폴더,
// 읽는 범위의 Project에서 찾고, 작업 폴더 파일은 상대 경로, 그 밖의 파일은 절대 경로로 들어간다」 · restart 02b-3이 넘긴 「새로 잴 것」). 커서 앞
// 낱말이 `@`로 시작하면 입력창 위 8에 「파일」 메뉴가 서고, 고르면 `@경로 `가 들어가 언급 칠을 입는다. 보낼 때는 글 그대로 간다.
//
// 찾는 자리와 파일은 고정 답(`MENTION_PLACES` — 작업 폴더 셋 · spec 하나 · 「빌링」 하나, 꾸민 경로)이다. 어느 자리에서 찾는지는 엔진의 몫(L1
// `mention_files`)이고, 이 층은 앱이 입력창이 쥔 범위 · 그 채팅으로 묻고 받은 답을 그대로 말하는지와 손맛을 잰다. 기하는 시안 창(1440 × 900)이다.

test.use({ viewport: { width: 1440, height: 900 } });

const twoTurns = record("thread-two-turns");
const [first] = sentPayloads(twoTurns);
const FIRST_SENT = seqOf(twoTurns, "sent");
const SECOND_SENT = seqOf(twoTurns, "sent", 2);

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 입력창 = (page: Page) => 입력칸(page).locator("xpath=ancestor::form[1]");
const 메뉴 = (page: Page) => page.getByRole("listbox", { name: "파일", exact: true });
const 줄들 = (page: Page) => 메뉴(page).getByRole("option");
const 켜진줄 = (page: Page) => 메뉴(page).getByRole("option", { selected: true });
const 칠 = (page: Page) => page.locator('[data-slot="mention-paint"]');
const 언급칠 = (page: Page) => 칠(page).locator("[data-mention]");

type Box = { x: number; y: number; width: number; height: number; right: number; bottom: number };
const 상자 = (target: Locator): Promise<Box> =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });
const 색 = (target: Locator) => target.evaluate((el) => getComputedStyle(el).color);

/** 받은 차례 그대로의 다섯 줄 — 작업 폴더 셋(상대 경로), spec 폴더 · 「빌링」(그 자리 안의 경로 · 줄 끝 자리 이름). */
const ALL = ["README.md", "src-tauri/src/watcher.rs", "src/features/works/watcher.test.ts", "overview.md", "src/lib.rs"];

async function openHome(page: Page, url = "/") {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });
}

test("`@`는 입력창 위 8에 「파일」 메뉴를 세워 작업 폴더 · spec 폴더 · 읽는 범위의 Project의 파일을 받은 차례로 보이고, 친 글자로 좁히며 ↓ · ↑가 켜진 줄을 돌리고 포커스는 입력칸에 남는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openHome(page);

  // 빈 말의 `@` — 받은 차례 앞 50줄이다. 머리 「파일」, 줄마다 파일 글리프와 경로이고 작업 폴더 밖 파일은 줄 끝에 자리 이름(12 `fg-tertiary`)이
  // 선다(접근성 설명도 그 이름). 첫 줄이 켜져 있다. 메뉴는 열 때 움직이지 않는다(Motion 「메뉴가 열린다」 — 움직이는 메뉴는 모델 메뉴 하나다).
  await 입력칸(page).pressSequentially("@");
  await expect(메뉴(page)).toBeVisible();
  await expect(줄들(page)).toHaveCount(ALL.length);
  expect(await 줄들(page).evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")))).toEqual(ALL);
  await expect(줄들(page).nth(3)).toHaveAccessibleDescription("spec");
  await expect(줄들(page).nth(4)).toHaveAccessibleDescription("빌링");
  await expect(줄들(page).nth(0)).toHaveAccessibleDescription("");
  await expect(줄들(page).nth(4)).toHaveText("src/lib.rs빌링");
  expect(await 색(줄들(page).nth(4).locator("span").last())).toBe(await 토큰색(page, "--fg-tertiary"));
  await expect(켜진줄(page)).toHaveAttribute("aria-label", ALL[0]);
  expect(await 메뉴(page).evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  const [menuBox, box] = [await 상자(메뉴(page)), await 상자(입력창(page))];
  expect(Math.round(box.y - menuBox.bottom), "상자 위 8").toBe(8);
  expect([menuBox.x, menuBox.width], "입력창과 같은 폭").toEqual([box.x, box.width]);
  expect((await 상자(줄들(page).first())).height, "줄 30").toBe(30);

  // 홈의 새 채팅 — 입력창이 쥔 범위(작업공간 · Service · Project, 여기서는 모두 없음)로 묻는다.
  expect(await ipcArgs(page, "mention_files", "thread")).toEqual([{ thread: null, work: null, service: null, project: null }]);

  // 친 글자로 좁힌다 — 이름이 그 글자로 시작하는 것이 먼저다. 첫 줄이 켜진다.
  await 입력칸(page).pressSequentially("wat");
  await expect(줄들(page)).toHaveCount(2);
  expect(await 줄들(page).evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")))).toEqual([ALL[1], ALL[2]]);
  await expect(켜진줄(page)).toHaveAttribute("aria-label", ALL[1]);

  // ↓ · ↑ — 켜진 줄이 돌고(끝에서 처음으로), 포커스는 입력칸에 남는다(`aria-activedescendant`가 켜진 줄).
  await page.keyboard.press("ArrowDown");
  await expect(켜진줄(page)).toHaveAttribute("aria-label", ALL[2]);
  await expect(입력칸(page)).toBeFocused();
  await expect(입력칸(page)).toHaveAttribute("aria-activedescendant", (await 켜진줄(page).getAttribute("id"))!);
  await page.keyboard.press("ArrowDown");
  await expect(켜진줄(page)).toHaveAttribute("aria-label", ALL[1]);
  await page.keyboard.press("ArrowUp");
  await expect(켜진줄(page)).toHaveAttribute("aria-label", ALL[2]);
  await expect(입력칸(page)).toHaveValue("@wat");

  // 가리키면 켜진다.
  await 줄들(page).first().hover();
  await expect(켜진줄(page)).toHaveAttribute("aria-label", ALL[1]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Enter · Tab이 켜진 파일을 `@경로 `로 넣고 메뉴가 걷히며 칠이 선다 — 작업 폴더 파일은 상대 경로, 밖의 파일은 절대 경로이고, 보내면 글 그대로 간다", async ({
  page,
}) => {
  const started: ThreadView = { ...FIXTURE_THREAD, title: first.text, live: true, lastSeq: FIRST_SENT };
  await installFixtureBackend(page, {
    thread_get: answerByArg("thread", { [started.id]: started }),
    thread_read_record: answerByArg("thread", { [started.id]: linesThrough(twoTurns, FIRST_SENT) }),
  });
  await openHome(page);

  // Enter — 작업 폴더 파일은 상대 경로다. 찾던 낱말이 `@경로 `가 되고 커서는 빈칸 뒤, 메뉴는 걷힌다.
  await 입력칸(page).pressSequentially("@wat");
  await expect(켜진줄(page)).toHaveAttribute("aria-label", ALL[1]);
  await page.keyboard.press("Enter");
  await expect(메뉴(page)).toHaveCount(0);
  await expect(입력칸(page)).toHaveValue(`@${ALL[1]} `);
  expect(await 입력칸(page).evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(`@${ALL[1]} `.length);
  expect(await callCount(page, "thread_start")).toBe(0);

  // 칠(Composer 「첨부 · 언급」 `.ra-mention`) — 면 `accent-soft` · 글자 `link` · 둥글기 4 · 안쪽 1 / 4. 언급이 선 동안 입력칸 글자는 투명이고
  // caret은 `fg`다(칠 층이 같은 자리에 글자를 그린다).
  await expect(언급칠(page)).toHaveText([`@${ALL[1]}`]);
  expect(
    await 언급칠(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.backgroundColor, style.color, style.borderTopLeftRadius, style.paddingTop, style.paddingLeft];
    }),
  ).toEqual([await 토큰색(page, "--accent-soft"), await 토큰색(page, "--link"), "4px", "1px", "4px"]);
  expect(await 입력칸(page).evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).caretColor])).toEqual([
    "rgba(0, 0, 0, 0)",
    await 토큰색(page, "--fg"),
  ]);

  // Tab — 밖의 파일(「빌링」 Project)은 절대 경로다(자리의 뿌리 + 경로).
  await 입력칸(page).pressSequentially("@lib");
  await expect(켜진줄(page)).toHaveAttribute("aria-label", "src/lib.rs");
  await page.keyboard.press("Tab");
  await expect(메뉴(page)).toHaveCount(0);
  await expect(입력칸(page)).toHaveValue(`@${ALL[1]} @/Users/tester/dev/billing/src/lib.rs `);
  await expect(입력칸(page)).toBeFocused();
  await expect(언급칠(page)).toHaveText([`@${ALL[1]}`, "@/Users/tester/dev/billing/src/lib.rs"]);

  // 메일 주소의 `@`는 언급이 아니다 — 낱말 처음이나 빈칸 바로 뒤의 `@`만 메뉴를 연다.
  await 입력칸(page).pressSequentially("me@x");
  await expect(메뉴(page)).toHaveCount(0);

  // 보내면 글 그대로 간다 — 언급은 글이다(첨부가 아니다).
  const text = `@${ALL[1]} @/Users/tester/dev/billing/src/lib.rs me@x`;
  await 입력칸(page).press("Enter");
  await expect.poll(async () => (await ipcArgs(page, "thread_start", "text")).map((args) => [args.text, args.attachments])).toEqual([[text, []]]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("새 채팅의 `@`는 입력창이 쥔 범위(Project 씨앗 · 작업공간)로 묻는다", async ({ page }) => {
  await installFixtureBackend(page);
  await openHome(page, "/?project=billing");
  await 입력칸(page).pressSequentially("@");
  await expect(메뉴(page)).toBeVisible();
  await expect.poll(() => ipcArgs(page, "mention_files", "thread")).toEqual([{ thread: null, work: null, service: null, project: "billing" }]);

  // 작업공간의 새 채팅 탭 — 그 작업공간과 그 Service로 묻는다(범위 칩이 쥔 것과 같다).
  await page.goto("/works/pinned-work?tab=chat");
  await expect(입력칸(page)).toBeVisible({ timeout: 20_000 });
  await 입력칸(page).pressSequentially("@");
  await expect(메뉴(page)).toBeVisible();
  await expect.poll(async () => (await ipcArgs(page, "mention_files", "thread")).map((args) => args.work)).toEqual(["pinned-work"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("채팅의 `@`는 그 채팅으로 묻고, Esc는 메뉴만 걷어 도는 턴을 멈추지 않으며, 글을 고치면 메뉴가 다시 선다", async ({ page }) => {
  const running: ThreadView = { ...FIXTURE_THREAD, title: first.text, live: true, lastSeq: SECOND_SENT };
  await installFixtureBackend(page, {
    thread_list: [summaryOf(running)],
    thread_get: answerByArg("thread", { [running.id]: running }),
    thread_read_record: answerByArg("thread", { [running.id]: linesThrough(twoTurns, SECOND_SENT) }),
    thread_mark_read: answerByArg("thread", { [running.id]: summaryOf(running) }),
  });
  await page.goto(`/threads/${running.id}`);
  await expect(page.getByRole("main").getByText("생각 중", { exact: true })).toBeVisible({ timeout: 20_000 });

  await 입력칸(page).pressSequentially("@READ");
  await expect(줄들(page)).toHaveCount(1);
  expect(await ipcArgs(page, "mention_files", "thread")).toEqual([{ thread: running.id, work: null, service: null, project: null }]);

  // Esc — 메뉴만 걷힌다. 도는 턴의 Esc(멈추기)로 새지 않는다.
  await page.keyboard.press("Escape");
  await expect(메뉴(page)).toHaveCount(0);
  await expect(입력칸(page)).toHaveValue("@READ");
  expect(await callCount(page, "thread_stop")).toBe(0);
  await expect(page.getByRole("main").getByText("생각 중", { exact: true })).toBeVisible();

  // 글을 고치면 다시 선다 — 지웠다 같은 글자로 되돌려도 그렇다.
  await page.keyboard.press("Backspace");
  await expect(메뉴(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(메뉴(page)).toHaveCount(0);
  await 입력칸(page).pressSequentially("D");
  await expect(메뉴(page)).toBeVisible();
  expect(await callCount(page, "thread_stop")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 입력칸에 한글 조합을 흉내 낸다 — 진짜 입력기가 아니라 밑줄은 그려지지 않고, 밑줄이 설 조건(입력칸 글자가 제 색)을 잰다(`시안-비교/02b-3` 「한글 조합」). */
const 조합 = {
  시작: (page: Page) =>
    입력칸(page).evaluate((el) => el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }))),
  글자: (page: Page, value: string, data: string) =>
    입력칸(page).evaluate(
      (el: HTMLTextAreaElement, [value, data]) => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
        el.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText", data }));
      },
      [value, data] as const,
    ),
  끝: (page: Page, data: string) =>
    입력칸(page).evaluate((el, data) => el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data })), data),
};

test("언급이 선 뒤 한글을 조합하는 동안은 입력칸이 글자를 제 색으로 그리고 칠 층은 면만 두며, 조합이 끝나면 칠 층이 확정 글자를 품어 되받는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await openHome(page);
  await 입력칸(page).pressSequentially("@wat");
  await page.keyboard.press("Enter");
  await 입력칸(page).pressSequentially("이 파일");
  const before = `@${ALL[1]} 이 파일`;
  await expect(입력칸(page)).toHaveValue(before);
  const fg = await 토큰색(page, "--fg");
  const 면자리 = () => 상자(언급칠(page));
  const 처음면 = await 면자리();
  expect(await 색(입력칸(page))).toBe("rgba(0, 0, 0, 0)");
  expect(await 색(칠(page))).toBe(fg);

  // 조합 중 — 입력칸 글자가 `fg`(입력기의 밑줄이 이 색으로 선다), 칠 층 글자는 투명이고 면은 같은 자리에 남는다.
  await 조합.시작(page);
  await 조합.글자(page, `${before} ㄱ`, "ㄱ");
  await 조합.글자(page, `${before} 가`, "가");
  await expect.poll(() => 색(입력칸(page))).toBe(fg);
  expect(await 색(칠(page))).toBe("rgba(0, 0, 0, 0)");
  expect(await 색(언급칠(page))).toBe("rgba(0, 0, 0, 0)");
  expect(await 언급칠(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await 토큰색(page, "--accent-soft"));
  expect(await 면자리()).toEqual(처음면);

  // 조합 끝 — 칠 층이 글자를 되받고 확정 글자를 품는다. 입력칸은 다시 투명이다.
  await 조합.끝(page, "가");
  await expect.poll(() => 색(입력칸(page))).toBe("rgba(0, 0, 0, 0)");
  expect(await 색(칠(page))).toBe(fg);
  expect(await 색(언급칠(page))).toBe(await 토큰색(page, "--link"));
  await expect(칠(page)).toHaveText(`${before} 가`);
  expect(await 면자리()).toEqual(처음면);

  // 조합 끝이 마지막 `input`보다 먼저 와도(값만 바뀐 채) 칠 층이 그 값을 함께 적는다.
  await 조합.시작(page);
  await 입력칸(page).evaluate((el: HTMLTextAreaElement, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "나" }));
  }, `${before} 가나`);
  await expect(칠(page)).toHaveText(`${before} 가나`);
  await expect.poll(() => 색(입력칸(page))).toBe("rgba(0, 0, 0, 0)");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
