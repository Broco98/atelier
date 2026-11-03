import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD, WORK_CHATS, WORKS, workChatAnswers } from "./fixtures";
import {
  callCount,
  fireEventToAll,
  heldCalls,
  holdCommand,
  installFixtureBackend,
  ipcArgs,
  liveSubscriptions,
  openShell,
  releaseCommand,
  replaceAnswer,
  unknownIpcCalls,
  작업화면으로,
  주소로간다,
  파일탭주소,
} from "./harness";
import type { Attachment, ThreadView } from "@/features/thread/types";

// restart 02a-16 — **새 채팅 탭**(구현 스펙 「02a — 앱 틀과 채팅 탭」의 `+`와 ⌘T · 숨은 탭 · 새 채팅의 글 · 새 채팅으로 가는 길, 「재는 동작 ·
// 화면」의 「작업공간 A의 새 채팅 글과 첨부가 B의 새 채팅 탭과 홈에 서지 않는다. `?work=`는 새 채팅 탭으로 간다」 · 「새 채팅 탭에서 Codex를 고르고
// 셸이나 파일 탭을 다녀와도 고른 값과 작업공간이 남는다」). 새 채팅 탭은 첫 말을 보낼 때 채팅이 된다 — 그 탭이 숨어 있으면 주소는 두고 칸만
// 채팅 탭으로 바뀐다.
//
// 칸 · 메뉴의 꼴은 시안 비교(02a-8)가, 글 열쇠 · 묶음 규칙은 L2(`new-chat.test.ts` · `shell-registry.test.ts`)가 잰다 — 여기는 손짓이 화면에
// 닿는 한 바퀴다.

test.use({ viewport: { width: 1440, height: 900 } });

const [pinnedWork, plainWork, multiWork] = WORKS;

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 칩들 = (page: Page) => page.getByRole("list", { name: "첨부", exact: true });
/**
 * 보이는 새 채팅 탭이 그 작업공간의 것이다 — 빈 칸의 말이 그 이름을 부른다(restart 02b-2 — 한때 트레이의 잠긴 작업공간 칩이었다). 숨은 새 채팅
 * 탭의 몸도 DOM에 남지만(내리지 않는다) 역할로 집는 입력칸은 보이는 것 하나다.
 */
const 작업공간말 = (page: Page, work: { title: string }) => expect(입력칸(page)).toHaveAttribute("placeholder", `${work.title}에서 무엇을 할까요?`);
const 고르는칩 = (page: Page, name: string) => page.getByRole("button", { name: `Runtime: ${name}`, exact: true });
/** 탭 줄의 칸 — 왼쪽부터 종류(`data-tab`), 채팅 칸이면 그 채팅 id. 끝의 `+`(「새 탭」)는 뺀다. */
const 칸차례 = (page: Page) =>
  page.locator("[data-tab-strip] > [data-tab]").evaluateAll((cells) =>
    cells
      .map((cell) => {
        const kind = cell.getAttribute("data-tab");
        const thread = cell.getAttribute("data-thread");
        return thread ? `${kind}:${thread}` : kind;
      })
      .filter((kind) => kind !== "new"),
  );
/** 켜진 칸의 차례(0부터) — 없으면 −1. */
const 켜진칸 = (page: Page) =>
  page
    .locator("[data-tab-strip] > [data-tab]")
    .evaluateAll((cells) => cells.findIndex((cell) => cell.querySelector('button[aria-pressed="true"]') !== null));
const 새채팅칸 = (page: Page, at: number) => page.locator('[data-tab="new-chat"]').nth(at).locator("button[aria-pressed]");
const 주소 = (slug: string, query: string) => new RegExp(`/works/${slug}\\?${query.replace(/[?&]/g, "\\$&")}$`);

/** 글을 치는 자리 밖으로 포커스를 뺀다 — ⌘T · ⌘W는 입력칸 안에서는 비켜 선다(`opensShellFromWindow`). */
const 포커스를뺀다 = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test("⌘T와 `+` → Enter가 묶음 끝에 새 채팅 탭을 열어 켜고, 「새 탭」 메뉴 맨 윗줄이 「새 채팅 ⌘T」이며, 마지막 칸을 닫아도 새 채팅 탭이 선다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  // 채팅이 없는 작업공간 — 새 채팅 탭 하나로 선다.
  await expect(page).toHaveURL(주소(plainWork.slug, "tab=chat"), { timeout: 20_000 });
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat"]);
  await expect(page.getByRole("main", { name: "새 채팅", exact: true })).toBeVisible();

  // ⌘T — 묶음 끝에 새 채팅 탭이 하나 더 서서 켜진다. 주소는 같은 `tab=chat`이다(어느 새 채팅 탭인지는 묶음이 쥔다).
  await 포커스를뺀다(page);
  await page.keyboard.press("Meta+t");
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat", "new-chat"]);
  await expect.poll(() => 켜진칸(page)).toBe(1);
  await expect(page).toHaveURL(주소(plainWork.slug, "tab=chat"));

  // `+`는 「새 탭」 메뉴다 — 맨 윗줄 「새 채팅 ⌘T」가 켜진 채 열려, Enter 한 번이 ⌘T와 같다. 그 아래가 셸 줄이다.
  const plus = page.locator('[data-tab="new"]');
  await expect(plus).toHaveAccessibleName("새 탭");
  await plus.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([/^새 채팅\s*⌘T$/, /^새 셸/]);
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat", "new-chat", "new-chat"]);
  await expect.poll(() => 켜진칸(page)).toBe(2);

  // 셸을 하나 연 뒤 새 채팅 탭을 모두 닫는다 — 셸이 남아 셸이 켜진다. 그 셸까지 닫으면(마지막 칸) 새 채팅 탭이 선다.
  await openShell(page);
  for (let left = 3; left > 0; left -= 1) {
    await page.getByRole("button", { name: "새 채팅 닫기", exact: true }).first().click();
    await expect(page.locator('[data-tab="new-chat"]')).toHaveCount(left - 1);
  }
  await expect.poll(() => 칸차례(page)).toEqual(["shell"]);
  await expect(page).toHaveURL(주소(plainWork.slug, "tab=terminal"));
  await page.locator('[data-tab="shell"]').getByRole("button", { name: /닫기$/ }).click();
  // 명령이 도는 셸이라 닫기 전에 묻는다(고정 답) — 닫는다.
  await page.getByRole("alertdialog").getByRole("button", { name: "닫기" }).click();
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat"]);
  await expect(page).toHaveURL(주소(plainWork.slug, "tab=chat"));
  await expect(page.getByRole("main", { name: "새 채팅", exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`?work=`는 그 작업공간의 새 채팅 탭으로 가고, `say`가 그 탭의 입력창을 채운다 — 보내지는 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  const say = "워처가 죽으면 알려 줘";
  await page.goto(`/?work=${plainWork.slug}&say=${encodeURIComponent(say)}`);
  await expect(page).toHaveURL(주소(plainWork.slug, "tab=chat"), { timeout: 20_000 });
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat"]);
  await expect(입력칸(page)).toHaveValue(say);
  await 작업공간말(page, plainWork);
  expect(await callCount(page, "thread_start")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/**
 * 끌어다 놓는 파일 둘 — 경로를 잰 답(`describe_attachments`)이 칩이 된다. 탭마다 **다른 파일**을 놓는다 — 같은 경로는 겹치지 않고 하나로
 * 서서(`addAttachments`), 숨은 탭에 새어 붙어도 칩 수로는 안 갈린다.
 */
const LOG: Attachment = { path: "/Users/tester/Desktop/error.log", size: 12_288, folder: false };
const SHOT: Attachment = { path: "/Users/tester/Desktop/shot.png", size: 48_213, folder: false };
const 놓는다 = async (page: Page, file: Attachment) => {
  await replaceAnswer(page, "describe_attachments", [file]);
  const paths = [file.path];
  const position = { x: 700, y: 500 };
  // 창의 끌어다 놓기 이벤트는 듣는 자리 모두에 간다(Tauri) — 숨은 새 채팅 탭이 듣고 있으면 거기에도 닿는다.
  await fireEventToAll(page, "tauri://drag-enter", { paths, position });
  await fireEventToAll(page, "tauri://drag-drop", { paths, position });
};

test("새 채팅 탭의 글 · 고른 Runtime은 그 탭의 것이다 — 셸 · 파일 탭을 다녀와도 그 작업공간과 함께 남고, 다른 새 채팅 탭 · 다른 작업공간 · 홈에는 서지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(page).toHaveURL(주소(pinnedWork.slug, "tab=chat"), { timeout: 20_000 });
  await 작업공간말(page, pinnedWork);

  // 첫 탭 — 글을 쓰고 Codex를 고른다.
  const typed = "첫 탭의 말";
  await 입력칸(page).fill(typed);
  await 고르는칩(page, "Claude Code").click();
  await page.getByRole("menuitemradio", { name: "Codex", exact: true }).click();
  await expect(고르는칩(page, "Codex")).toBeVisible();
  const 첫탭이남았다 = async () => {
    await expect(입력칸(page)).toHaveValue(typed);
    await expect(고르는칩(page, "Codex")).toBeVisible();
    await 작업공간말(page, pinnedWork);
  };

  // 둘째 새 채팅 탭(⌘T) — 빈 입력창 · Claude Code다. 여기서 쓴 글은 첫 탭에 가지 않는다.
  await 포커스를뺀다(page);
  await page.keyboard.press("Meta+t");
  await expect.poll(() => 켜진칸(page)).toBe(1);
  await expect(입력칸(page)).toHaveValue("");
  await expect(고르는칩(page, "Claude Code")).toBeVisible();
  await 입력칸(page).fill("둘째 탭의 말");
  await 새채팅칸(page, 0).click();
  await 첫탭이남았다();

  // 셸 탭을 다녀온다 — 첫 탭의 글 · Runtime · 작업공간이 그대로다.
  await openShell(page);
  await expect(page).toHaveURL(/tab=terminal/);
  await 새채팅칸(page, 0).click();
  await expect(page).toHaveURL(주소(pinnedWork.slug, "tab=chat"));
  await 첫탭이남았다();

  // 파일 탭을 다녀온다.
  await 주소로간다(page, 파일탭주소("billing/README.md"));
  await expect(page.locator('[data-tab="code"] button[aria-pressed="true"]')).toHaveCount(1);
  await 새채팅칸(page, 0).click();
  await 첫탭이남았다();
  await 새채팅칸(page, 1).click();
  await expect(입력칸(page)).toHaveValue("둘째 탭의 말");
  await expect(고르는칩(page, "Claude Code")).toBeVisible();

  // 다른 작업공간의 새 채팅 탭에는 서지 않는다 — 빈 입력창이고 그 작업공간의 칩이다.
  await 작업화면으로(page, multiWork);
  await expect(page).toHaveURL(주소(multiWork.slug, "tab=chat"));
  await 작업공간말(page, multiWork);
  await expect(입력칸(page)).toHaveValue("");

  // 홈에도 서지 않는다.
  await page.locator("aside[data-sidebar]").getByRole("button", { name: /^새 채팅/ }).click();
  await expect(page).toHaveURL("/");
  await expect(입력칸(page)).toHaveValue("");
  expect(await callCount(page, "thread_start")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 고른 값 · 보내는 중 상태도 그 탭의 것이다(구현 스펙 「02a — 숨은 탭」 — 「내리면 Codex를 고른 탭이 Claude로 돌아온 채 보내지고 Runtime이 잠긴다」).
// 작업공간을 옮기면 그 작업공간의 탭 몸은 내려가지만, 고른 값은 탭의 열쇠로 쥐어 돌아오면 그대로다.
test("새 채팅 탭에서 고른 Runtime과 보내는 중인 첫 말은 작업공간을 옮겼다 돌아와도 그 탭에 남는다 — 다시 보내지 않고 답이 오면 채팅 탭이 된다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_get: answerByArg("thread", { [started.id]: started }),
    thread_read_record: answerByArg("thread", { [started.id]: [] }),
  });
  await page.goto(`/works/${plainWork.slug}`);
  await expect(page).toHaveURL(주소(plainWork.slug, "tab=chat"), { timeout: 20_000 });

  // Codex를 고르고 다른 작업공간을 다녀온다 — 그 탭은 Codex 그대로다.
  await 고르는칩(page, "Claude Code").click();
  await page.getByRole("menuitemradio", { name: "Codex", exact: true }).click();
  await expect(고르는칩(page, "Codex")).toBeVisible();
  await 작업화면으로(page, multiWork);
  await 작업공간말(page, multiWork);
  await expect(고르는칩(page, "Claude Code")).toBeVisible();
  await 작업화면으로(page, plainWork);
  await expect(page).toHaveURL(주소(plainWork.slug, "tab=chat"));
  await 작업공간말(page, plainWork);
  await expect(고르는칩(page, "Codex")).toBeVisible();

  // 첫 말을 보내고 답이 오기 전에 다른 작업공간을 다녀온다 — 그 탭은 보내는 중이고 다시 보낼 수 없다.
  await holdCommand(page, "thread_start");
  await 입력칸(page).fill(started.title);
  await 입력칸(page).press("Enter");
  await expect.poll(() => heldCalls(page, "thread_start")).toBe(1);
  await 작업화면으로(page, multiWork);
  await 작업공간말(page, multiWork);
  await 작업화면으로(page, plainWork);
  await expect(입력칸(page)).toHaveAttribute("placeholder", "채팅을 시작하는 중…");
  await expect(page.getByText(started.title, { exact: true })).toBeVisible();

  // 답이 온다 — 그 칸이 채팅 탭이 되고, 첫 말은 Codex로 한 번만 갔다.
  await releaseCommand(page, "thread_start");
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${started.id}`]);
  expect(await ipcArgs(page, "thread_start", "text")).toEqual([
    expect.objectContaining({ text: started.title, runtime: "codex", link: { kind: "work", slug: plainWork.slug } }),
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 첨부도 글처럼 탭의 것이다(구현 스펙 「새 채팅의 글」 「글과 첨부의 열쇠를 탭마다 나눈다」). 끌어다 놓기는 창의 이벤트라 듣는 자리 모두에 간다 —
// 숨은 새 채팅 탭은 내리지 않으므로(「숨은 탭」) 그 탭이 듣고 있으면 보이지 않는 탭에도 붙는다.
test("새 채팅 탭에 끌어다 놓은 첨부는 그 탭의 것이다 — 다른 작업공간 · 홈에 서지 않고, 같은 작업공간의 숨은 새 채팅 탭에도 붙지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(page).toHaveURL(주소(pinnedWork.slug, "tab=chat"), { timeout: 20_000 });
  await 놓는다(page, LOG);
  await expect(칩들(page).getByRole("listitem")).toHaveText([/^error\.log/]);

  // 다른 작업공간의 새 채팅 탭과 홈에는 서지 않는다. 돌아오면 그 탭에 그대로다.
  await 작업화면으로(page, multiWork);
  await 작업공간말(page, multiWork);
  await expect(칩들(page)).toHaveCount(0);
  await page.locator("aside[data-sidebar]").getByRole("button", { name: /^새 채팅/ }).click();
  await expect(page).toHaveURL("/");
  await expect(칩들(page)).toHaveCount(0);
  await 작업화면으로(page, pinnedWork);
  await expect(page).toHaveURL(주소(pinnedWork.slug, "tab=chat"));
  await expect(칩들(page).getByRole("listitem")).toHaveText([/^error\.log/]);

  // 같은 작업공간의 둘째 새 채팅 탭(⌘T)에 다른 파일을 놓는다 — 그 탭에만 붙고, 숨은 첫 탭은 제 첨부 그대로다.
  await 포커스를뺀다(page);
  await page.keyboard.press("Meta+t");
  await expect.poll(() => 켜진칸(page)).toBe(1);
  await expect(칩들(page)).toHaveCount(0);
  await 놓는다(page, SHOT);
  await expect(칩들(page).getByRole("listitem")).toHaveText([/^shot\.png/]);
  await 새채팅칸(page, 0).click();
  await expect(칩들(page).getByRole("listitem")).toHaveText([/^error\.log/]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 끌어다 놓기는 켜진 탭의 입력창만 받는다(restart 02a-16b) — 채팅 탭이 켜져 있으면 그 채팅의 입력창에 붙고, 숨은 새 채팅 탭(내리지 않는다)과 숨은
// 채팅 탭(내려간다)에는 붙지 않는다. 셸 탭이 켜져 있으면 보이는 입력창이 없어 듣는 자리도 없다 — 숨은 곳에 몰래 붙지 않는다. 듣는 자리의 수는
// 창의 놓기 이벤트 구독으로 센다(놓기는 듣는 자리 모두에 간다 — 하나여야 한다).
test("채팅 탭이 켜져 있으면 놓은 파일이 그 채팅의 입력창에만 붙고, 셸 탭이 켜져 있으면 어느 입력창에도 붙지 않는다 — 숨은 새 채팅 탭 · 숨은 채팅 탭에는 붙지 않는다", async ({
  page,
}) => {
  const [chatA, chatB] = WORK_CHATS;
  await installFixtureBackend(page, workChatAnswers());
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(page).toHaveURL(주소(pinnedWork.slug, `tab=chat&thread=${chatB.id}`), { timeout: 20_000 });
  // 숨을 탭 둘 — 새 채팅 탭(⌘T)과 첫째 채팅의 탭(사이드바). 그 뒤 둘째 채팅 탭을 켠다.
  await 포커스를뺀다(page);
  await page.keyboard.press("Meta+t");
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatB.id}`, "new-chat"]);
  const 사이드바 = page.locator("aside[data-sidebar]");
  await 사이드바.getByRole("button", { name: `${pinnedWork.title}의 채팅 펼치기`, exact: true }).click();
  await 사이드바.locator(`[data-work-threads="${pinnedWork.slug}"]`).getByRole("button", { name: new RegExp(`^${chatA.title}`) }).click();
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatB.id}`, "new-chat", `chat:${chatA.id}`]);
  const 채팅칸 = (id: string) => page.locator(`[data-tab="chat"][data-thread="${id}"] button[aria-pressed]`);
  await 채팅칸(chatB.id).click();
  await expect(page).toHaveURL(주소(pinnedWork.slug, `tab=chat&thread=${chatB.id}`));

  // 채팅 탭이 켜져 있다 — 듣는 입력창은 그 채팅의 것 하나이고, 거기에만 붙는다.
  expect(await liveSubscriptions(page, "tauri://drag-drop")).toBe(1);
  await 놓는다(page, LOG);
  await expect(칩들(page).getByRole("listitem")).toHaveText([/^error\.log/]);

  // 셸 탭이 켜져 있다 — 듣는 입력창이 없다(숨은 새 채팅 탭도 듣지 않는다).
  await openShell(page);
  expect(await liveSubscriptions(page, "tauri://drag-drop")).toBe(0);

  // 탭마다 돌아본다 — 둘째 채팅에는 놓은 첫 파일만, 숨어 있던 새 채팅 탭 · 첫째 채팅에는 아무것도 없다.
  await 채팅칸(chatB.id).click();
  await expect(칩들(page).getByRole("listitem")).toHaveText([/^error\.log/]);
  await 새채팅칸(page, 0).click();
  await expect(입력칸(page)).toBeVisible();
  await expect(칩들(page)).toHaveCount(0);
  expect(await liveSubscriptions(page, "tauri://drag-drop")).toBe(1);
  await 채팅칸(chatA.id).click();
  await expect(page).toHaveURL(주소(pinnedWork.slug, `tab=chat&thread=${chatA.id}`));
  await expect(입력칸(page)).toBeVisible();
  await expect(칩들(page)).toHaveCount(0);
  expect(await callCount(page, "describe_attachments")).toBe(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 첫 말로 선 채팅 — 그 작업공간에 이었다. */
const started: ThreadView = { ...FIXTURE_THREAD, title: "숨은 탭의 첫 말", work: plainWork.slug, live: true, lastSeq: 0 };

test("숨은 새 채팅 탭에 첫 말의 답이 오면 주소는 그대로 두고 그 칸만 채팅 탭이 된다 — 첫 말은 그 탭의 작업공간으로 한 번 간다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_get: answerByArg("thread", { [started.id]: started }),
    thread_read_record: answerByArg("thread", { [started.id]: [] }),
  });
  await page.goto(`/works/${plainWork.slug}`);
  await expect(page).toHaveURL(주소(plainWork.slug, "tab=chat"), { timeout: 20_000 });
  await holdCommand(page, "thread_start");

  // 첫 말을 보낸다 — 답(새 채팅의 id)이 오기 전에 셸 탭으로 옮긴다.
  await 입력칸(page).fill(started.title);
  await 입력칸(page).press("Enter");
  await expect.poll(() => heldCalls(page, "thread_start")).toBe(1);
  await openShell(page);
  await expect(page).toHaveURL(주소(plainWork.slug, "tab=terminal"));

  // 답이 온다 — 그 칸이 같은 자리에서 그 채팅의 채팅 탭이 되고, 본문은 셸 그대로다(끌고 오지 않는다).
  await releaseCommand(page, "thread_start");
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${started.id}`, "shell"]);
  await expect(page).toHaveURL(주소(plainWork.slug, "tab=terminal"));
  await expect.poll(() => 켜진칸(page)).toBe(1);
  expect(await ipcArgs(page, "thread_start", "text")).toEqual([
    expect.objectContaining({ text: started.title, link: { kind: "work", slug: plainWork.slug } }),
  ]);

  // 그 칸을 누르면 그 채팅이다.
  await page.locator(`[data-tab="chat"][data-thread="${started.id}"] button[aria-pressed]`).click();
  await expect(page).toHaveURL(주소(plainWork.slug, `tab=chat&thread=${started.id}`));
  await expect(page.getByRole("main", { name: "채팅", exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});
