import { expect, test, type Page } from "./evidence";

import { chatSummaryOf, FIXTURE_THREAD, WORK_CHATS, WORKS, workChatAnswers } from "./fixtures";
import { callCount, fireEvent, installFixtureBackend, ipcCallArgs, openShell, replaceAnswer, unknownIpcCalls, workRow } from "./harness";
import { lineOf, linesAfter, linesThrough, record, sentPayloads, seqOf, streamLines, threadOf, workView } from "./thread-records";
import { THREAD_LIST_EVENT } from "@/features/thread/events";
import type { ThreadView } from "@/features/thread/types";

// restart 02a-16 — **채팅 탭**(구현 스펙 「Testing Decisions · 재는 동작 · 화면」의 02a 항목 · 「02a — 앱 틀과 채팅 탭」 · 스토리 02a). 작업공간
// 화면이 탭 줄을 쥐고, 살아 있는 작업공간에 이은 채팅은 그 묶음의 채팅 탭에 선다. 사이드바의 채팅 줄이 그 탭을 세우고 켜며, 탭을 닫아도 채팅은
// 남는다. 채팅이 없는 작업공간은 새 채팅 탭으로 열린다.
//
// 채팅은 고정 답의 「작업공간에 이은 채팅 둘」이다(`WORK_CHATS` — `pinned-work`). 둘째가 늦게 섰다 — 말이 없어 가장 최근은 선 때로 가른다.

test.use({ viewport: { width: 1440, height: 900 } });

const [pinnedWork, plainWork] = WORKS;
const [chatA, chatB] = WORK_CHATS;

const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
/** 펼친 Work 아래 그 채팅의 줄 — 이름 뒤에 상태 표시(새 결과 점 등)의 말이 붙을 수 있어 이름의 앞머리로 집는다. */
const 채팅줄 = (page: Page, title: string) =>
  사이드바(page)
    .locator(`[data-work-threads="${pinnedWork.slug}"]`)
    .getByRole("button", { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
/** 탭 줄의 칸 — 왼쪽부터 종류(`data-tab`)와, 채팅 칸이면 그 채팅 id. 끝의 `+`(「새 탭」)는 뺀다. */
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
/** 그 채팅의 칸 — 켜짐은 이름 버튼의 `aria-pressed`다. */
const 채팅칸 = (page: Page, id: string) => page.locator(`[data-tab="chat"][data-thread="${id}"]`);
const 켜짐 = (page: Page, id: string) => 채팅칸(page, id).locator("button[aria-pressed]");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
/** 입력창 위 가운데의 작업 중 점 — 사이드바 줄 끝의 스피너도 이름이 같아 본문에서 집는다. */
const 작업중 = (page: Page) => page.getByRole("main").getByRole("img", { name: "작업 중", exact: true });
const 작업공간주소 = (slug: string, query: string) => new RegExp(`/works/${slug}\\?${query.replace(/[?&]/g, "\\$&")}$`);

test("사이드바의 채팅을 누르면 그 채팅 탭이 서서 켜지고, 탭을 닫아도 채팅이 남으며, 채팅이 없는 작업공간은 새 채팅 탭으로 열린다", async ({
  page,
}) => {
  await installFixtureBackend(page, workChatAnswers());
  await page.goto(`/works/${pinnedWork.slug}`);
  // 작업공간을 처음 열면 가장 최근 채팅(둘째) 탭 하나가 선다.
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${chatB.id}`), { timeout: 20_000 });
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatB.id}`]);
  await expect(켜짐(page, chatB.id)).toHaveAttribute("aria-pressed", "true");

  // 사이드바에서 그 작업공간의 채팅을 펴고 첫째를 누른다 — 묶음 끝에 그 채팅 탭이 서서 켜지고, 사이드바의 그 줄이 켜진다.
  await 사이드바(page).getByRole("button", { name: `${pinnedWork.title}의 채팅 펼치기`, exact: true }).click();
  await expect(채팅줄(page, chatB.title)).toHaveAttribute("aria-current", "page");
  await 채팅줄(page, chatA.title).click();
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${chatA.id}`));
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatB.id}`, `chat:${chatA.id}`]);
  await expect(켜짐(page, chatA.id)).toHaveAttribute("aria-pressed", "true");
  await expect(켜짐(page, chatB.id)).toHaveAttribute("aria-pressed", "false");
  await expect(채팅줄(page, chatA.title)).toHaveAttribute("aria-current", "page");
  await expect(채팅줄(page, chatB.title)).not.toHaveAttribute("aria-current");

  // 이미 선 탭의 채팅을 다시 누르면 새 칸 없이 그 탭이 켜진다.
  await 채팅줄(page, chatB.title).click();
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${chatB.id}`));
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatB.id}`, `chat:${chatA.id}`]);
  await expect(켜짐(page, chatB.id)).toHaveAttribute("aria-pressed", "true");

  // 켜진 탭을 `×`로 닫는다 — 칸만 빠지고 이웃이 켜진다. 채팅과 돌던 턴은 그대로라 채팅에는 아무것도 부르지 않고, 사이드바 줄도 남는다.
  await page.getByRole("button", { name: `${chatB.title} 닫기`, exact: true }).click();
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatA.id}`]);
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${chatA.id}`));
  await expect(켜짐(page, chatA.id)).toHaveAttribute("aria-pressed", "true");
  await expect(채팅줄(page, chatB.title)).toBeVisible();
  expect(await callCount(page, "thread_stop")).toBe(0);

  // 사이드바에서 다시 연다 — 닫은 채팅이 묶음 끝에 다시 선다.
  await 채팅줄(page, chatB.title).click();
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatA.id}`, `chat:${chatB.id}`]);
  await expect(켜짐(page, chatB.id)).toHaveAttribute("aria-pressed", "true");

  // 채팅이 없는 작업공간 — 사이드바의 그 줄로 가면 새 채팅 탭 하나로 선다.
  await workRow(page, plainWork.slug).click();
  await expect(page).toHaveURL(작업공간주소(plainWork.slug, "tab=chat"));
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat"]);
  await expect(page.getByRole("main", { name: "새 채팅", exact: true })).toBeVisible();
  expect(await callCount(page, "thread_stop")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 작업공간을 열고 두 채팅을 탭으로 세운다 — 둘째(처음 여는 규칙) 뒤에 첫째(사이드바)가 서서 켜진다. */
async function 두채팅탭(page: Page): Promise<void> {
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${chatB.id}`), { timeout: 20_000 });
  await 사이드바(page).getByRole("button", { name: `${pinnedWork.title}의 채팅 펼치기`, exact: true }).click();
  await 채팅줄(page, chatA.title).click();
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatB.id}`, `chat:${chatA.id}`]);
  await expect(켜짐(page, chatA.id)).toHaveAttribute("aria-pressed", "true");
}

/** 칸의 이름 버튼을 눌러 문턱을 넘긴 뒤 그 칸 앞 틈(`before` 칸의 왼쪽 4분의 1)에 놓는다 — 탭 줄 안 옮기기다(`tab-order.spec`과 같은 손짓). */
async function 칸을끌어놓는다(page: Page, id: string, before: string): Promise<void> {
  const from = (await 켜짐(page, id).boundingBox())!;
  const to = (await 채팅칸(page, before).boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 3, start.y);
  await page.mouse.move(start.x - 12, start.y);
  await expect(page.locator("body")).toHaveClass(/dragging-row/);
  await page.mouse.move(to.x + to.width / 4, to.y + to.height / 2, { steps: 4 });
  await expect(page.locator("[data-tab-gap]")).toHaveCount(1);
  await page.mouse.up();
}

// 02a-5 — **채팅 탭은 셸 탭처럼 다룬다**(구현 스펙 「채팅 탭은 셸, 파일 탭과 같은 묶음에 서고 같은 규칙으로 끌린다. 더블클릭으로 채팅 이름을
// 바꾼다. 채팅의 ⋯ 항목은 탭 우클릭 메뉴로 온다」). 닫기(`×` · 우클릭 「닫기」 · ⌘W)는 확인 없이 칸만 빼고, 채팅에는 아무것도 부르지 않는다.
// 묶음의 마지막 칸을 닫으면 새 채팅 탭이 선다.
test("채팅 탭은 두 번 누르기 · F2 · 우클릭 「이름 바꾸기」로 이름을 바꾸고, 끌어 차례를 옮기며, ⌘W · 우클릭 「닫기」가 확인 없이 칸만 닫는다", async ({
  page,
}) => {
  await installFixtureBackend(page, workChatAnswers());
  await 두채팅탭(page);

  // 두 번 누르기 — 이름 자리가 그대로 입력칸이 되고, Enter가 그 채팅의 이름으로 저장한다. 사이드바 줄도 같은 이름을 읽는다.
  const renamed = "실패 신호를 띠에 올리기";
  await replaceAnswer(page, "thread_rename", { ...chatSummaryOf(chatA), title: renamed });
  const 이름칸 = 채팅칸(page, chatA.id).getByRole("textbox", { name: "채팅 이름", exact: true });
  await 켜짐(page, chatA.id).dblclick();
  await expect(이름칸).toBeFocused();
  await expect(이름칸).toHaveValue(chatA.title);
  await 이름칸.fill(renamed);
  await 이름칸.press("Enter");
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_rename", "thread")).map(({ args }) => args))
    .toEqual([{ thread: chatA.id, title: renamed }]);
  await expect(켜짐(page, chatA.id)).toHaveText(renamed);
  await expect(켜짐(page, chatA.id)).toBeFocused();
  await expect(채팅줄(page, renamed)).toBeVisible();

  // F2 — 포커스된 이름 버튼에서 같은 입력칸이 선다. Esc는 바꾸지 않고 닫는다.
  await page.keyboard.press("F2");
  await expect(이름칸).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(이름칸).toHaveCount(0);
  await expect(켜짐(page, chatA.id)).toBeFocused();

  // 우클릭 — 채팅의 ⋯ 항목(「이름 바꾸기」) 뒤에 구분선과 「닫기」가 선다. 「이름 바꾸기」를 고르면 입력칸이 포커스를 쥔다.
  await 채팅칸(page, chatA.id).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([/^이름 바꾸기\s*F2$/, /^닫기\s*⌘W$/]);
  await menu.getByRole("menuitem", { name: /^이름 바꾸기/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(이름칸).toBeFocused();
  await page.keyboard.press("Escape");
  expect(await ipcCallArgs(page, "thread_rename", "thread")).toHaveLength(1);

  // 끌기 — 이름 버튼을 끌어 앞 칸 앞 틈에 놓으면 차례가 바뀐다. 켜짐은 그대로다.
  await 칸을끌어놓는다(page, chatA.id, chatB.id);
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatA.id}`, `chat:${chatB.id}`]);
  await expect(켜짐(page, chatA.id)).toHaveAttribute("aria-pressed", "true");

  // ⌘W — 켜진 채팅 탭을 확인 없이 닫는다. 이웃이 켜지고 주소가 따라온다.
  await page.keyboard.press("Meta+w");
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatB.id}`]);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${chatB.id}`));

  // 우클릭 「닫기」 — 마지막 칸이라 닫으면 새 채팅 탭이 선다.
  await 채팅칸(page, chatB.id).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: /^닫기/ }).click();
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat"]);
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, "tab=chat"));

  // 채팅은 그대로다 — 멈추지도 지우지도 않았고, 사이드바에 둘 다 남는다.
  expect(await callCount(page, "thread_stop")).toBe(0);
  await expect(채팅줄(page, renamed)).toBeVisible();
  await expect(채팅줄(page, chatB.title)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 답만 한 턴과 도구를 쓴 턴(`thread-two-turns`). 첫 턴은 seq 8에서 끝난다. */
const twoTurns = record("thread-two-turns");
const FIRST_END = seqOf(twoTurns, "turn-end");
/**
 * 첫 턴의 답을 긴 글로 바꾼 기록 — 창 안에 다 들지 않아 굴러야 하는 대화다. 바꾸는 것은 답 조각(ACP 몸통)의 글뿐이다 — 우리 줄(보낸 말 · 턴 끝)은
 * 축복한 기록 그대로다.
 */
const 긴대화 = (label: string) =>
  twoTurns.map((line) => {
    const update = (line.payload as { update?: { sessionUpdate?: string; content?: { text?: string } } }).update;
    if (line.seq > FIRST_END || update?.sessionUpdate !== "agent_message_chunk") return line;
    const text = Array.from({ length: 40 }, (_, at) => `${label} 문단 ${at + 1} — 읽던 자리를 재는 긴 답이다.`).join("\n\n");
    return { ...line, payload: { ...(line.payload as object), update: { ...update, content: { ...update.content, text } } } };
  });
/** 그 채팅의 굴림 상자 — 본문 카드(`main`) 안에서 세로로 넘치는 상자다(`ThreadBody`의 흐름). */
const 굴림 = (page: Page) =>
  page.getByRole("main").evaluate((main) => {
    const box = [...main.querySelectorAll<HTMLElement>("div")].find(
      (el) => getComputedStyle(el).overflowY === "auto" && el.scrollHeight > el.clientHeight,
    );
    if (!box) throw new Error("굴림 상자가 없다");
    return { top: Math.round(box.scrollTop), rest: Math.round(box.scrollHeight - box.scrollTop - box.clientHeight), height: box.scrollHeight };
  });
const 맨아래로 = (page: Page) => page.getByRole("button", { name: "맨 아래로", exact: true });

// 02a-6 — **채팅 탭을 옮겼다 돌아오면 읽던 자리가 남는다**(구현 스펙 「숨은 탭」 「굴림 자리는 탭마다 쥐고 돌아오면 되살린다. 바닥을 따라가던 탭은
// 바닥으로 간다」). 숨은 채팅 탭은 내려간다 — 위로 올려 읽던 탭은 쥔 굴림 거리에 「맨 아래로」가 선 채 서고, 바닥을 따라가던 탭은 숨은 동안 쌓인
// 줄의 끝으로 간다. 셸 · 다른 채팅 탭을 다녀온다.
test.describe(() => {
  // 창을 낮춰 두 대화 모두 넘친다 — 넘치지 않으면 「바닥」과 「그 자리」가 갈리지 않는다.
  test.use({ viewport: { width: 1440, height: 640 } });

  test("위로 올려 읽던 채팅 탭은 셸 · 다른 채팅 탭을 다녀와도 그 자리에 「맨 아래로」가 선 채 서고, 바닥을 따라가던 탭은 숨은 동안 쌓인 끝으로 간다", async ({
    page,
  }) => {
    const reading = { ...chatA, lastSeq: FIRST_END };
    const following = { ...chatB, lastSeq: FIRST_END };
    await installFixtureBackend(page, workChatAnswers([reading, following], {
      [reading.id]: linesThrough(긴대화("첫째"), FIRST_END),
      [following.id]: linesThrough(긴대화("둘째"), FIRST_END),
    }));
    await page.goto(`/works/${pinnedWork.slug}?tab=chat&thread=${reading.id}`);
    await expect(page.getByText("첫째 문단 40 — 읽던 자리를 재는 긴 답이다.")).toBeVisible({ timeout: 20_000 });
    // 처음 연 채팅은 바닥이다. 위로 올려 읽는다 — 「맨 아래로」가 선다.
    await expect.poll(async () => (await 굴림(page)).rest).toBeLessThan(24);
    await page.getByRole("main").getByText("첫째 문단 10 — 읽던 자리를 재는 긴 답이다.").scrollIntoViewIfNeeded();
    await expect(맨아래로(page)).toBeVisible();
    const held = (await 굴림(page)).top;
    expect(held).toBeGreaterThan(0);

    // 다른 채팅 탭(사이드바) — 바닥에서 선다.
    await 사이드바(page).getByRole("button", { name: `${pinnedWork.title}의 채팅 펼치기`, exact: true }).click();
    await 채팅줄(page, following.title).click();
    await expect(page.getByText("둘째 문단 40 — 읽던 자리를 재는 긴 답이다.")).toBeVisible();
    await expect.poll(async () => (await 굴림(page)).rest).toBeLessThan(24);
    await expect(맨아래로(page)).toHaveCount(0);
    const before = (await 굴림(page)).height;

    // 셸 탭으로 간다 — 두 채팅 탭이 숨는다. 숨은 동안 바닥을 따라가던 채팅에 둘째 턴이 쌓인다.
    await openShell(page);
    await expect(page).toHaveURL(/tab=terminal/);
    await streamLines(page, following.id, linesAfter(twoTurns, FIRST_END));

    // 읽던 채팅 탭으로 돌아온다 — 쥔 굴림 거리에 「맨 아래로」가 선 채다.
    await 켜짐(page, reading.id).click();
    await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${reading.id}`));
    await expect(맨아래로(page)).toBeVisible();
    expect(Math.abs((await 굴림(page)).top - held)).toBeLessThanOrEqual(1);

    // 따라가던 채팅 탭으로 돌아온다 — 숨은 동안 쌓인 둘째 턴의 끝(바닥)이다.
    await 켜짐(page, following.id).click();
    await expect(page.getByRole("main").getByText(sentPayloads(twoTurns)[1].text, { exact: true })).toBeVisible();
    const back = await 굴림(page);
    expect(back.height).toBeGreaterThan(before);
    expect(back.rest).toBeLessThan(24);
    await expect(맨아래로(page)).toHaveCount(0);

    // 읽던 채팅 탭은 다시 와도 그 자리다 — 다른 채팅 탭을 다녀와도 같다.
    await 켜짐(page, reading.id).click();
    await expect(맨아래로(page)).toBeVisible();
    expect(Math.abs((await 굴림(page)).top - held)).toBeLessThanOrEqual(1);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
});

// **`/threads/:id`로 남는 채팅**(구현 스펙 「`work` 칸이 있고 작업공간이 살아 있는 채팅만 이 주소로 보낸다. 판단은 코어가 주는 `gone`으로 한다 …
// 작업공간 밖 채팅과, 작업공간이 보관되거나 지워져 읽기만 되는 채팅은 `/threads/:id`에 그대로 선다」). 목록이 아직 모르는 작업공간이어도 코어가
// 살아 있다고 하면 그 작업공간의 채팅 탭으로 가서 다른 작업공간으로 넘겨지지 않는다.
test("살아 있는 작업공간의 채팅 `/threads/:id`는 그 작업공간의 채팅 탭으로 가고, 보관되거나 지워진 작업공간의 채팅은 그 주소에 탭 줄 없이 선다", async ({
  page,
}) => {
  const archived: ThreadView = { ...chatA, id: "20261022-090000", title: "보관된 작업공간의 채팅", work: "shipped-work", readOnly: "archived" };
  const removed: ThreadView = { ...chatA, id: "20261022-100000", title: "지워진 작업공간의 채팅", work: "gone-work", readOnly: "removed" };
  /** 코어가 막 만든 작업공간 — 작업공간 목록은 아직 모른다. */
  const fresh: ThreadView = { ...chatA, id: "20261022-110000", title: "막 이은 채팅", work: "fresh-work" };
  await installFixtureBackend(page, workChatAnswers([chatA, archived, removed, fresh]));

  await page.goto(`/threads/${chatA.id}`);
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${chatA.id}`), { timeout: 20_000 });
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatA.id}`]);

  for (const gone of [archived, removed]) {
    await page.goto(`/threads/${gone.id}`);
    await expect(page.locator('[data-slot="screen-head"]').getByText(gone.title, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(`/threads/${gone.id}`);
    await expect(page.locator("[data-tab-row]")).toHaveCount(0);
  }

  // 목록이 모르는 작업공간 — 그 작업공간의 채팅 탭 주소에 머문다. 목록이 그 작업공간을 싣고 오면 화면이 선다.
  await page.goto(`/threads/${fresh.id}`);
  await expect(page).toHaveURL(작업공간주소("fresh-work", `tab=chat&thread=${fresh.id}`), { timeout: 20_000 });
  await replaceAnswer(page, "list_works", [...WORKS, workView({ slug: "fresh-work", title: "막 만든 작업공간", branch: null, projects: [] })]);
  await fireEvent(page, "works:changed", null);
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${fresh.id}`]);
  await expect(page).toHaveURL(작업공간주소("fresh-work", `tab=chat&thread=${fresh.id}`));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **작업공간이 바뀌는 순간**(구현 스펙 「채팅이 처음 작업공간에 이으면 주소만 그 작업공간의 채팅 탭으로 바꾼다(`replace`). 세션, 돌던 턴, 입력창의
// 글은 그대로다」). 엔진이 이음을 목록 요약 이벤트로 알린다 — 그 뒤 화면은 같은 채팅을 그 작업공간의 채팅 탭에 세운다. 한때 `/threads/:id`에만
// 섰다. 켜진 채팅 탭의 작업공간이 보관될 때(`/threads/:id`로 간다)는 `thread-archived`가 잰다.
test("돌던 턴이 있는 채팅이 처음 작업공간에 이으면 주소만 그 작업공간의 채팅 탭으로 바뀌고, 돌던 턴과 입력창의 글이 남는다", async ({ page }) => {
  const SECOND = seqOf(twoTurns, "sent", 2);
  const loose: ThreadView = { ...FIXTURE_THREAD, id: "20261023-090000", live: true, lastSeq: SECOND };
  const linked: ThreadView = { ...loose, work: pinnedWork.slug };
  await installFixtureBackend(page, workChatAnswers([loose], { [loose.id]: linesThrough(twoTurns, SECOND) }));
  await page.goto(`/threads/${loose.id}`);
  await expect(작업중(page)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(`/threads/${loose.id}`);
  const draft = "끝나면 테스트도 돌려 줘";
  await 입력칸(page).fill(draft);
  const depth = await page.evaluate(() => history.length);

  // 엔진이 이 채팅을 작업공간에 이었다 — 목록 요약 이벤트가 그 작업공간을 싣고 온다. 다시 읽는 답(보기 · 목록 · 읽은 자리의 요약)도 그 작업공간을
  // 싣는다 — 옛 답이 남으면 다음 읽기가 이음을 덮는다.
  for (const [command, answer] of Object.entries(workChatAnswers([linked], { [linked.id]: linesThrough(twoTurns, SECOND) }))) {
    await replaceAnswer(page, command, answer);
  }
  await fireEvent(page, THREAD_LIST_EVENT, chatSummaryOf(linked));

  // 주소만 바뀐다(replace — 뒤로 가기 칸이 늘지 않는다). 같은 채팅이 그 작업공간의 채팅 탭에 서고, 돌던 턴과 쓰던 글이 그대로다.
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${loose.id}`));
  expect(await page.evaluate(() => history.length)).toBe(depth);
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${loose.id}`]);
  await expect(작업중(page)).toBeVisible();
  await expect(입력칸(page)).toHaveValue(draft);

  // 턴은 그 자리에서 이어 끝난다 — 남은 줄이 같은 흐름에 선다. 세션을 새로 열거나 멈춘 것이 없다.
  await streamLines(page, loose.id, linesAfter(twoTurns, SECOND));
  await expect(작업중(page)).toHaveCount(0);
  await expect(page.getByRole("main").getByText(sentPayloads(twoTurns)[1].text, { exact: true })).toBeVisible();
  for (const command of ["thread_stop", "thread_start", "thread_reconnect", "thread_send"]) {
    expect(await callCount(page, command), command).toBe(0);
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** Host가 Work 밖 Project를 묻는 턴과 파일 쓰기를 묻는 턴 — 둘 다 나를 기다린다. Project 물음이 1초 먼저다. */
const projectAsk = record("thread-project");
const PROJECT_ASKED = lineOf(projectAsk, "question", "asked");
const permissionAsk = record("thread-permission");
const PERMISSION_ASKED = lineOf(permissionAsk, "permission", "asked");

// **켜진 채팅**(구현 스펙 「켜진 채팅을 읽는 함수가 주소의 `thread=`까지 읽게 넓히고 세 자리가 이것을 쓴다」) — 사이드바의 켜진 줄과 ⌘J의 지금
// 자리가 작업공간 화면의 채팅 탭(`thread=`)도 읽는다. 나를 기다리는 두 채팅 가운데 먼저 기다린 채팅 탭에서 ⌘J를 누르면 그다음으로 간다 —
// 지금 자리를 못 읽으면 처음(지금 그 채팅)으로 가 주소가 그대로다.
test("주소의 `thread=`로 켜진 채팅의 사이드바 줄이 켜지고, ⌘J가 그 자리에서 다음 내 차례로 간다", async ({ page }) => {
  const first = threadOf("20261024-100100", projectAsk, { work: pinnedWork.slug, live: true, lastSeq: PROJECT_ASKED.seq - 1 });
  const second = threadOf("20261024-100200", permissionAsk, { work: pinnedWork.slug, live: true, lastSeq: PERMISSION_ASKED.seq - 1 });
  await installFixtureBackend(page, workChatAnswers([first, second], {
    [first.id]: linesThrough(projectAsk, first.lastSeq),
    [second.id]: linesThrough(permissionAsk, second.lastSeq),
  }));
  await page.goto(`/works/${pinnedWork.slug}?tab=chat&thread=${first.id}`);
  await expect.poll(() => 칸차례(page), { timeout: 20_000 }).toEqual([`chat:${first.id}`]);
  await streamLines(page, first.id, [PROJECT_ASKED]);
  await streamLines(page, second.id, [PERMISSION_ASKED]);
  await expect(사이드바(page).locator("nav").first().getByRole("button", { name: "내 차례 2", exact: true })).toBeVisible();

  await 사이드바(page).getByRole("button", { name: `${pinnedWork.title}의 채팅 펼치기`, exact: true }).click();
  await expect(채팅줄(page, first.title)).toHaveAttribute("aria-current", "page");
  await expect(채팅줄(page, second.title)).not.toHaveAttribute("aria-current");

  // ⌘J — 지금 자리(첫째)의 다음인 둘째로 간다. 그 줄이 켜진다. 둘째는 마지막이라 다음 ⌘J는 처음으로 돈다.
  await page.keyboard.press("Meta+J");
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${second.id}`));
  await expect(채팅줄(page, second.title)).toHaveAttribute("aria-current", "page");
  await expect(채팅줄(page, first.title)).not.toHaveAttribute("aria-current");
  await page.keyboard.press("Meta+J");
  await expect(page).toHaveURL(작업공간주소(pinnedWork.slug, `tab=chat&thread=${first.id}`));
  expect(await unknownIpcCalls(page)).toEqual([]);
});
