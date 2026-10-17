import { expect, test, type Locator, type Page } from "./evidence";
import { PINNED_HEADER, PROJECTS, WORKS } from "./fixtures";
import {
  archiveByMcp,
  awaitSpawned,
  callCount,
  fireEvent,
  installFixtureBackend,
  ipcCallArgs,
  markAttention,
  replaceAnswer,
  typeIntoShell,
  unknownIpcCalls,
  workRow,
  띠,
  머리카드,
  행버튼,
} from "./harness";

// codex-ds 티켓 28 — **work · 프로젝트 이름을 그 자리에서 바꾼다**(codex-ds 스펙 §9 · 결정 18 · S12). 이름이 쓰인 자리가 그대로
// 입력칸이 된다 — 창이 뜨지 않는다. 들어가는 길은 F2 · 메뉴 「이름 바꾸기」 · 두 번 클릭이고, 두 번 클릭은 머리 카드 이름만이다
// (사이드바 행의 두 번 클릭은 열기다). Enter · 다른 곳 누르기는 저장, Esc는 취소, 비우면 원래 이름, 그대로면 아무것도 부르지 않는다.
//
// 픽스처의 고정 답(`set_work_title` · `update_project`)은 바뀐 이름을 기억하지 않는다 — 저장은 화면 글자가 아니라 나간 IPC로 잰다.
// 「안 나갔다」(IPC 0)는 늘 **입력칸이 닫힌 것을 본 뒤에** 잰다 — 닫는 일이 아예 안 일어나도 0이다.

const [pinnedWork, plainWork, thirdWork] = WORKS;
const [project, otherProject] = PROJECTS;

/** 나간 work 이름 저장의 인자들, 차례대로. */
const 작업이름저장 = async (page: Page) =>
  (await ipcCallArgs(page, "set_work_title", "title")).map(({ args }) => args);

/** 나간 프로젝트 고치기의 인자들, 차례대로. 고치기는 부분 patch라 이름만 실린다. */
const 프로젝트저장 = async (page: Page) =>
  (await ipcCallArgs(page, "update_project", "slug")).map(({ args }) => args);

/** 입력칸에서 골라 둔 자리 `[시작, 끝]`. 전부 골랐으면 `[0, 글자 수]`다. */
const 고른자리 = (input: Locator) =>
  input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]);

/** 머리 카드의 이름 글자 — 역할이 없는 포커스 자리다(대상 메뉴 · F2를 듣는다). */
const 머리이름 = (page: Page, name: string) => 머리카드(page).getByText(name, { exact: true });

/**
 * **바깥이 work 이름을 바꿨다** — 에이전트의 MCP `atelier_edit_work`나 다른 창. 앱은 감시자의 `works:changed` 뒤의 목록 재조회로만
 * 안다(`archiveByMcp`와 같은 흉내 — 목록 답을 갈고 그 이벤트를 쏜다).
 */
const 바깥이이름을바꾼다 = async (page: Page, slug: string, title: string) => {
  await replaceAnswer(
    page,
    "list_works",
    WORKS.map((work) => (work.slug === slug ? { ...work, title } : work)),
  );
  await fireEvent(page, "works:changed", null);
};

/**
 * **입력기가 문 키** — 이 저장소가 WKWebView에서 잰 갈래다(`terminal-ime.ts` 머리말 · `shell-input.ts`의 `ime`). 그 경로에는
 * `compositionstart`가 없어 `isComposing`이 서지 않을 수 있고, 입력기가 쥔 키는 keyCode 229로 온다(조합 중의 Esc도). 합성 키다운의
 * keyCode는 초기값으로 못 넣어 그 사건의 값으로 덮는다.
 */
const 입력기가문키 = (input: Locator, key: "Enter" | "Escape") =>
  input.evaluate((el, key) => {
    const event = new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true });
    Object.defineProperty(event, "keyCode", { get: () => 229 });
    el.dispatchEvent(event);
  }, key);

/**
 * 「다른 곳」 — 본문 카드 안의 한 점. 머리 카드 · 사이드바 · 목록 칸 밖이고 누르는 자리가 없는 곳이라, 누르면 입력칸이 포커스를
 * 잃을 뿐 다른 일이 안 일어난다.
 */
const 다른곳을누른다 = async (page: Page) => {
  const box = await page.getByRole("main").last().boundingBox();
  if (!box) throw new Error("본문 카드의 자리를 못 쟀다");
  await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12);
};

// ── work 머리 카드 이름 ──
// 이름 글자가 그대로 입력칸이 된다. 지금 이름을 전부 고른 채 포커스를 받고, 닫히면(Enter · Esc) 포커스가 이름 글자로 돌아온다.

test("머리 카드 이름을 두 번 누르면 그 자리가 지금 이름을 전부 고른 입력칸이 되고, Enter면 앞뒤 공백을 뗀 이름으로 저장한다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  await 머리이름(page, plainWork.title).dblclick();

  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(plainWork.title);
  await expect.poll(() => 고른자리(input)).toEqual([0, plainWork.title.length]);
  // 창이 아니다.
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await input.fill("  새 이름  ");
  await input.press("Enter");

  await expect(input).toHaveCount(0);
  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: plainWork.slug, title: "새 이름" }]);
  await expect(머리이름(page, plainWork.title)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("머리 카드 이름에서 F2를 누르면 입력칸이 되고, Esc는 고친 이름이 있어도 부르지 않고 원래 이름으로 돌아간다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  const name = 머리이름(page, plainWork.title);
  await expect(name).toHaveAttribute("aria-keyshortcuts", /(^| )F2( |$)/);

  await name.focus();
  await page.keyboard.press("F2");

  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();
  await input.fill("고치다 만 이름");
  await input.press("Escape");

  await expect(input).toHaveCount(0);
  await expect(name).toBeFocused();
  expect(await callCount(page, "set_work_title")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 한글 조합 중의 Enter는 조합을 끝내는 키다 — 저장으로 읽으면 마지막 글자가 빠진 이름이 저장된다. 조합 중의 키는 IME가 보내는
// keydown(`isComposing`)이라 그것을 입력칸에 바로 띄워 잰다(실기 IME의 차례는 사람이 본다).
test("한글 조합 중의 Enter는 저장하지 않고 입력칸이 남으며, 조합이 끝난 뒤의 Enter가 저장한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  await 머리이름(page, plainWork.title).dblclick();
  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await input.fill("조합 중인 이름");

  await input.evaluate((el) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true })),
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("조합 중인 이름");
  expect(await callCount(page, "set_work_title")).toBe(0);

  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: plainWork.slug, title: "조합 중인 이름" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("입력기가 문 Enter · Esc(keyCode 229)는 끝내지 않고 입력칸이 친 글자째 남으며, 입력기가 놓은 뒤의 Enter가 저장한다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  await 머리이름(page, plainWork.title).dblclick();
  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await input.fill("입력기가 쥔 이름");

  for (const key of ["Enter", "Escape"] as const) {
    await 입력기가문키(input, key);
    await expect(input, key).toBeFocused();
    await expect(input, key).toHaveValue("입력기가 쥔 이름");
    expect(await callCount(page, "set_work_title"), key).toBe(0);
  }

  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: plainWork.slug, title: "입력기가 쥔 이름" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("⋯ 메뉴의 「이름 바꾸기」는 머리 카드 이름을 입력칸으로 바꾸고, 다른 곳을 누르면 저장한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  await page.getByRole("button", { name: "작업 메뉴", exact: true }).click();
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();

  // 메뉴가 닫히며 포커스를 ⋯로 되돌려 막 선 입력칸을 빼앗지 않는다 — 빼앗으면 「다른 곳 = 저장」으로 곧바로 닫힌다.
  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(input).toBeFocused();
  await input.fill("메뉴로 바꾼 이름");
  await 다른곳을누른다(page);

  await expect(input).toHaveCount(0);
  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: plainWork.slug, title: "메뉴로 바꾼 이름" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("머리 카드 이름의 우클릭 메뉴 「이름 바꾸기」도 그 자리를 입력칸으로 바꾼다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  await 머리이름(page, plainWork.title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();

  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(input).toBeFocused();
  await input.fill("우클릭으로 바꾼 이름");
  await input.press("Enter");

  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: plainWork.slug, title: "우클릭으로 바꾼 이름" }]);
  await expect(머리이름(page, plainWork.title)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

for (const [what, value] of [
  ["그대로인 이름", plainWork.title],
  ["앞뒤 공백만 붙인 지금 이름", ` ${plainWork.title} `],
  ["빈 이름", "   "],
] as const) {
  test(`머리 카드 이름을 ${what}으로 두고 Enter를 누르면 부르지 않고 원래 이름이 선다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/works/${plainWork.slug}`);

    await 머리이름(page, plainWork.title).dblclick();
    const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
    await input.fill(value);
    await input.press("Enter");

    await expect(input).toHaveCount(0);
    await expect(머리이름(page, plainWork.title)).toBeVisible();
    expect(await callCount(page, "set_work_title")).toBe(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

test("빈 이름으로 다른 곳을 눌러도 부르지 않고 원래 이름이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  await 머리이름(page, plainWork.title).dblclick();
  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await input.fill("");
  await 다른곳을누른다(page);

  await expect(input).toHaveCount(0);
  await expect(머리이름(page, plainWork.title)).toBeVisible();
  expect(await callCount(page, "set_work_title")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **고치는 동안 바깥이 이름을 바꾸면** 손대지 않은 입력칸은 새 이름을 따른다 — 손대지 않은 칸이 옛 이름을 쥔 채 「다른 곳 = 저장」으로
// 닫히면 바깥이 바꾼 이름을 말없이 되돌린다. 손댄 칸은 사람이 친 글자가 앞선다.
test("머리 카드 이름을 고치는 동안 바깥이 이름을 바꾸면, 손대지 않은 입력칸은 새 이름을 전부 고른 채 따르고 다른 곳을 눌러도 부르지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  await 머리이름(page, plainWork.title).dblclick();
  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();

  await 바깥이이름을바꾼다(page, plainWork.slug, "바깥에서 바꾼 이름");

  await expect(input).toHaveValue("바깥에서 바꾼 이름");
  await expect(input).toBeFocused();
  await expect.poll(() => 고른자리(input)).toEqual([0, "바깥에서 바꾼 이름".length]);
  await 다른곳을누른다(page);

  await expect(input).toHaveCount(0);
  await expect(머리이름(page, "바깥에서 바꾼 이름")).toBeVisible();
  expect(await callCount(page, "set_work_title")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("손댄 입력칸은 바깥이 바꾼 이름이 덮지 않고, Enter는 친 이름으로 저장한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  await 머리이름(page, plainWork.title).dblclick();
  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await input.fill("내가 친 이름");

  await 바깥이이름을바꾼다(page, plainWork.slug, "바깥에서 바꾼 이름");
  // 앵커 — 새 목록이 앉았다(머리 카드의 이름 자리는 입력칸이라 사이드바 행이 그 이름을 든다).
  await expect(행버튼(page, "바깥에서 바꾼 이름")).toBeVisible();

  await expect(input).toHaveValue("내가 친 이름");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: plainWork.slug, title: "내가 친 이름" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **입력칸이 blur 없이 걷혀도 끝은 온다** — 키로 화면이 바뀌면(⌘, · ⌘J) 입력칸이 포커스를 쥔 채 내려가고, 그 내려감에는 blur가 없다.
// 그때도 「다른 곳으로 갔다」라 저장하고 고치기를 접는다 — 누르는 쪽으로 옮긴 때와 같다.
test("머리 카드 이름을 고치는 중에 ⌘,로 설정에 가면 친 이름을 저장한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  await 머리이름(page, plainWork.title).dblclick();
  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await input.fill("설정에 가기 전에 친 이름");
  await expect(input).toBeFocused();

  // ⌘,는 네이티브 메뉴가 먹어 `settings:open`으로 온다 — 포커스는 입력칸에 그대로다.
  await fireEvent(page, "settings:open", null);

  await expect(page).toHaveURL(/\/settings/);
  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: plainWork.slug, title: "설정에 가기 전에 친 이름" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("머리 카드 이름을 고치는 중에 ⌘J로 다른 work에 가면 친 이름을 고치던 work에 저장하고, 돌아와도 입력칸이 다시 서지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  // 그냥 일의 셸이 부르게 하고 고정된 일로 옮겨 간다 — ⌘J가 그냥 일로 데려간다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await markAttention(page, { agent: "claude", event: "Elicitation", at: Date.now(), payload: { message: "어느 쪽으로 할까요?" } });
  await 행버튼(page, pinnedWork.title).click();
  await expect(page).toHaveURL(`/works/${pinnedWork.slug}`);

  await 머리이름(page, pinnedWork.title).dblclick();
  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await input.fill("옮기기 전에 친 이름");
  await expect(input).toBeFocused();
  await page.keyboard.press("Meta+j");

  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: pinnedWork.slug, title: "옮기기 전에 친 이름" }]);

  await 행버튼(page, pinnedWork.title).click();
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}`));
  await expect(머리이름(page, pinnedWork.title)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "작업 이름" })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **머리 카드의 입력칸은 이름 글자만큼이다**(DS `.at-wtitle.is-edit` — 고치는 꼴도 `.at-wtitle`의 글자 폭 `flex: 0 1 auto`를 그대로
// 둔다). 이름 칸은 짧은 이름에도 520까지 넓어, 그 폭을 다 먹는 입력칸은 고치기에 들 때 테두리가 글자 폭에서 520으로 튄다.
test("머리 카드의 입력칸은 이름 글자만큼이고, 친 글자를 따라 는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  const name = 머리이름(page, plainWork.title);
  const 글자폭 = await name.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.firstChild!);
    return range.getBoundingClientRect().width;
  });

  await name.dblclick();
  const input = 머리카드(page).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();
  const 폭 = async () => (await input.boundingBox())!.width;
  const 처음 = await 폭();
  expect(처음).toBeGreaterThanOrEqual(글자폭);
  expect(처음).toBeLessThan(글자폭 + 16);

  await input.fill(`${plainWork.title} 그리고 조금 더 긴 이름`);
  await expect.poll(폭).toBeGreaterThan(처음 + 40);
  // 친 글자가 다 든다 — 칸이 글자보다 좁으면 끝으로 간 커서를 따라 글자가 밀린다.
  await input.press("End");
  expect(await input.evaluate((el) => el.scrollLeft)).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 사이드바 work 행 ──
// 행의 이름 자리가 입력칸이 된다 — 들어가는 길은 F2와 행의 메뉴다. 두 번 클릭은 열기 그대로다. 고치는 동안 입력칸을 누르거나 끌어도
// 행이 열리지 않는다(행의 열기 · 끌기가 입력칸까지 올라오지 않는다). 대상은 **그 행의 work**다 — 고른 work가 아니어도 된다.

test("사이드바 행에서 F2를 누르면 그 행의 이름이 입력칸이 되고, Enter면 그 행의 work 이름으로 저장하며 고른 work는 그대로다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  const row = 행버튼(page, pinnedWork.title);

  await row.focus();
  await page.keyboard.press("F2");

  const input = workRow(page, pinnedWork.slug).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(pinnedWork.title);
  // 입력칸을 눌러도 행이 열리지 않는다.
  await input.click();
  await expect(page).toHaveURL(`/works/${plainWork.slug}`);

  await input.fill("행에서 바꾼 이름");
  await input.press("Enter");

  await expect(input).toHaveCount(0);
  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: pinnedWork.slug, title: "행에서 바꾼 이름" }]);
  await expect(행버튼(page, pinnedWork.title)).toBeFocused();
  await expect(page).toHaveURL(`/works/${plainWork.slug}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("사이드바 행의 우클릭 메뉴 「이름 바꾸기」는 그 행을 입력칸으로 바꾸고, Esc는 부르지 않고 행으로 포커스를 돌린다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  await 행버튼(page, pinnedWork.title).click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();

  const input = workRow(page, pinnedWork.slug).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(input).toBeFocused();
  await input.fill("고치다 만 이름");
  await input.press("Escape");

  await expect(input).toHaveCount(0);
  await expect(행버튼(page, pinnedWork.title)).toBeFocused();
  expect(await callCount(page, "set_work_title")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 행의 둘레는 누름(끌기 무장)과 클릭(열기)을 듣는다 — 다른 곳 · 다른 행을 눌러 blur로 저장하는 길이 머리 이름과 다른 자리다.
test("사이드바 행을 고치다 다른 곳을 누르면 그 행의 work 이름으로 저장하고 고른 work는 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  await 행버튼(page, pinnedWork.title).focus();
  await page.keyboard.press("F2");
  const input = workRow(page, pinnedWork.slug).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();
  await input.fill("다른 곳을 눌러 바꾼 이름");

  await 다른곳을누른다(page);

  await expect(input).toHaveCount(0);
  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: pinnedWork.slug, title: "다른 곳을 눌러 바꾼 이름" }]);
  await expect(page).toHaveURL(`/works/${plainWork.slug}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("사이드바 행을 고치다 다른 행을 누르면 고치던 행의 work 이름으로 저장하고 누른 행이 열린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  await 행버튼(page, pinnedWork.title).focus();
  await page.keyboard.press("F2");
  const input = workRow(page, pinnedWork.slug).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();
  await input.fill("다른 행을 눌러 바꾼 이름");

  await 행버튼(page, thirdWork.title).click();

  await expect(input).toHaveCount(0);
  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: pinnedWork.slug, title: "다른 행을 눌러 바꾼 이름" }]);
  await expect(page).toHaveURL(`/works/${thirdWork.slug}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 고치는 행이 바깥에서 사라지면(MCP 아카이브 · 지우기) 입력칸은 blur 없이 내려간다 — 그때도 고치기가 접혀야, 그 work가 돌아올 때
// 행이 고치는 꼴로 다시 서서 포커스를 가져가지 않는다.
test("고치는 사이드바 행이 바깥에서 사라졌다 돌아오면 입력칸이 아니라 행으로 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  await 행버튼(page, pinnedWork.title).focus();
  await page.keyboard.press("F2");
  const input = workRow(page, pinnedWork.slug).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();

  await archiveByMcp(page, WORKS, pinnedWork.slug);
  await expect(workRow(page, pinnedWork.slug)).toHaveCount(0);
  // 아카이브에서 되돌아온다.
  await replaceAnswer(page, "list_works", WORKS);
  await fireEvent(page, "works:changed", null);

  await expect(행버튼(page, pinnedWork.title)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "작업 이름" })).toHaveCount(0);
  expect(await callCount(page, "set_work_title")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 손이 다른 일을 시작하면 호버 카드를 닫는 목록이다(메뉴 · 고정 · 끌기 · 옮겨 가기). 고치기도 그렇다 — 고치는 행 옆에 옛 이름을 적은
// 카드가 서지 않는다.
test("고치는 사이드바 행에는 호버 카드가 서지 않는다 — 올린 채 고치기에 들면 걷히고, 다시 올려도 안 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  const card = page.locator("[data-popover]");
  // 앵커 — 고치지 않는 행에 올리면 카드가 선다.
  await workRow(page, pinnedWork.slug).hover();
  await expect(card).toBeVisible();

  await 행버튼(page, pinnedWork.title).focus();
  await page.keyboard.press("F2");
  const input = workRow(page, pinnedWork.slug).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();
  await expect(card).toHaveCount(0);

  // 나갔다 다시 올린다 — 카드가 뜨는 350ms(`HOVER_DELAY_MS`)를 넘겨 머문다.
  const main = (await page.getByRole("main").last().boundingBox())!;
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2);
  await workRow(page, pinnedWork.slug).hover();
  await page.waitForTimeout(700);
  await expect(card).toHaveCount(0);
  await expect(input).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("사이드바 행을 두 번 누르면 그 work가 열리고 이름은 입력칸이 되지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  await 행버튼(page, pinnedWork.title).dblclick();

  await expect(page).toHaveURL(`/works/${pinnedWork.slug}`);
  await expect(page.getByRole("textbox", { name: "작업 이름" })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("알림 띠 줄의 메뉴 「이름 바꾸기」는 그 work의 사이드바 행을 입력칸으로 바꾼다", async ({ page }) => {
  await installFixtureBackend(page);
  // 그냥 일의 셸이 부르게 하고(사람에게 묻는 claude), 고정된 일로 옮겨 간다 — 띠에 그냥 일의 줄이 남는다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await markAttention(page, { agent: "claude", event: "Elicitation", at: Date.now(), payload: { message: "어느 쪽으로 할까요?" } });
  await 행버튼(page, pinnedWork.title).click();
  await expect(page).toHaveURL(`/works/${pinnedWork.slug}`);

  await 띠(page).getByRole("button", { name: `${plainWork.title} — 나를 기다림`, exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();

  const input = workRow(page, plainWork.slug).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(input).toBeFocused();
  await input.fill("띠에서 바꾼 이름");
  await input.press("Enter");

  await expect.poll(() => 작업이름저장(page)).toEqual([{ slug: plainWork.slug, title: "띠에서 바꾼 이름" }]);
  await expect(page).toHaveURL(`/works/${pinnedWork.slug}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 띠 줄의 work 행이 접힌 구획에 있으면 그 구획이 펴지고, 입력칸이 포커스를 받는다 — 접힌 구획의 속은 `inert`라 그 안에 선 입력칸은
// 포커스를 못 받는다. 포커스를 못 받은 입력칸은 blur도 없어 「다른 곳 = 저장」으로 닫히지 않고 남는다.
test("알림 띠에서 「이름 바꾸기」를 고른 work의 행이 접힌 구획에 있으면 그 구획이 펴지고 입력칸이 포커스를 받는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await typeIntoShell(page);
  await markAttention(page, { agent: "claude", event: "Elicitation", at: Date.now(), payload: { message: "어느 쪽으로 할까요?" } });
  await 행버튼(page, plainWork.title).click();
  await expect(page).toHaveURL(`/works/${plainWork.slug}`);
  const header = page.getByRole("button", { name: PINNED_HEADER, exact: true });
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");

  await 띠(page).getByRole("button", { name: `${pinnedWork.title} — 나를 기다림`, exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "이름 바꾸기" }).click();

  const input = workRow(page, pinnedWork.slug).getByRole("textbox", { name: "작업 이름", exact: true });
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  // 편 구획은 편 채로 남는다.
  await expect(header).toHaveAttribute("aria-expanded", "true");
  expect(await callCount(page, "set_work_title")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 프로젝트 ──
// 머리 카드 이름(두 번 클릭 · F2)과 목록 행(F2). 저장은 프로젝트 고치기의 부분 patch — 이름만 실린다. 상세 칸에는 제목이 없다(S12 —
// 이름은 머리 카드가 든다).

test("프로젝트 머리 카드 이름을 두 번 누르면 입력칸이 되고, Enter면 이름만 실어 고친다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  // 상세 칸의 제목(「클릭해서 편집」)은 걷혔다.
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);

  await 머리이름(page, project.name).dblclick();

  const input = 머리카드(page).getByRole("textbox", { name: "프로젝트 이름", exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(project.name);
  await input.fill("새 프로젝트 이름");
  await input.press("Enter");

  await expect(input).toHaveCount(0);
  await expect.poll(() => 프로젝트저장(page)).toEqual([{ slug: project.slug, name: "새 프로젝트 이름" }]);
  await expect(머리이름(page, project.name)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("프로젝트 머리 카드 이름에서 F2를 누르면 입력칸이 되고, Esc는 부르지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  const name = 머리이름(page, project.name);

  await name.focus();
  await page.keyboard.press("F2");

  const input = 머리카드(page).getByRole("textbox", { name: "프로젝트 이름", exact: true });
  await expect(input).toBeFocused();
  await input.fill("고치다 만 이름");
  await input.press("Escape");

  await expect(input).toHaveCount(0);
  await expect(name).toBeFocused();
  expect(await callCount(page, "update_project")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("프로젝트 목록 행에서 F2를 누르면 그 행의 이름이 입력칸이 되고, 다른 곳을 누르면 그 프로젝트를 고친다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  const list = page.getByRole("region", { name: "프로젝트 목록", exact: true });
  const row = list.getByRole("button", { name: `${otherProject.name} ${otherProject.path}`, exact: true });

  await row.focus();
  await page.keyboard.press("F2");

  const input = list.getByRole("textbox", { name: "프로젝트 이름", exact: true });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(otherProject.name);
  // 입력칸을 눌러도 그 행이 골라지지 않는다.
  await input.click();
  await expect(page).toHaveURL(`/projects/${project.slug}`);

  await input.fill("목록에서 바꾼 이름");
  await 다른곳을누른다(page);

  await expect(input).toHaveCount(0);
  await expect.poll(() => 프로젝트저장(page)).toEqual([{ slug: otherProject.slug, name: "목록에서 바꾼 이름" }]);
  await expect(page).toHaveURL(`/projects/${project.slug}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("프로젝트 목록 행을 비우고 Enter를 누르면 부르지 않고 원래 이름이 서며, 포커스가 그 행으로 돌아간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);
  const list = page.getByRole("region", { name: "프로젝트 목록", exact: true });
  const row = () => list.getByRole("button", { name: `${otherProject.name} ${otherProject.path}`, exact: true });

  await row().focus();
  await page.keyboard.press("F2");
  const input = list.getByRole("textbox", { name: "프로젝트 이름", exact: true });
  await input.fill("");
  await input.press("Enter");

  await expect(input).toHaveCount(0);
  await expect(row()).toBeFocused();
  expect(await callCount(page, "update_project")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 「그대로면 아무것도 부르지 않는다」는 프로젝트 쪽에서도 잰다 — 저장 길이 둘이라(머리 카드의 `rename` · 목록 행의 `onRenameCommit`)
// 따로 잇는다. 손대지 않은 채 끝내는 갈래와, 앞뒤 공백만 붙여 지금 이름과 같아진 갈래를 자리마다 하나씩 둔다.
for (const [where, how, what] of [
  ["머리 카드", "Enter", "손대지 않은 이름"],
  ["머리 카드", "다른 곳", "앞뒤 공백만 붙인 지금 이름"],
  ["목록 행", "Enter", "앞뒤 공백만 붙인 지금 이름"],
  ["목록 행", "다른 곳", "손대지 않은 이름"],
] as const) {
  test(`프로젝트 ${where} 이름을 ${what}으로 두고 ${how}${how === "Enter" ? "를" : "을"} 누르면 프로젝트를 고치지 않는다`, async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(`/projects/${project.slug}`);
    const list = page.getByRole("region", { name: "프로젝트 목록", exact: true });
    const target = where === "머리 카드" ? project : otherProject;
    const input = (where === "머리 카드" ? 머리카드(page) : list).getByRole("textbox", {
      name: "프로젝트 이름",
      exact: true,
    });

    if (where === "머리 카드") await 머리이름(page, project.name).dblclick();
    else {
      await list.getByRole("button", { name: `${otherProject.name} ${otherProject.path}`, exact: true }).focus();
      await page.keyboard.press("F2");
    }
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(target.name);
    if (what !== "손대지 않은 이름") await input.fill(` ${target.name} `);
    if (how === "Enter") await input.press("Enter");
    else await 다른곳을누른다(page);

    await expect(input).toHaveCount(0);
    expect(await callCount(page, "update_project")).toBe(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}
