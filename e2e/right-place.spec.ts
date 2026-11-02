import { expect, test, type Page } from "./evidence";

import { answerByArg, ARCHIVE, ARCHIVED_DOCS, FIXTURE_THREAD, SPEC_FALLBACK_BODY, WORK_CHATS, WORKS, workChatAnswers } from "./fixtures";
import {
  callCount,
  installFixtureBackend,
  ipcArgs,
  openShell,
  unknownIpcCalls,
  workRow,
  검색팔레트를연다,
  작업화면으로,
  주소로간다,
  파일탭주소,
} from "./harness";
import { atHome, lineOf, record, sentPayloads, specWrites, titleThrough, workView } from "./thread-records";
import type { ArchiveEntry } from "@/features/archive/types";
import type { ThreadView } from "@/features/thread/types";

// restart 02a-16 — **오른쪽 자리**(구현 스펙 「02a — 오른쪽 자리」 · 「`spec` 탭과 분할을 지운다」, 「재는 동작 · 화면」의 「셸이나 파일 탭에서
// 문서 줄을 누르면 채팅 탭이 켜지고 넓힌 카드가 선다 … `?file=`도 같다」 · 「셸이나 파일 탭이 켜지면 요약 카드가 닫히고 사이드바가 되돌아온다.
// 작업공간 밖 채팅에는 넓힌 카드가 없다」 · 「셸로 가는 주소에 `file`이 남지 않고, 검색에서 연 문서는 채팅 탭의 넓힌 카드로 열린다」 · 「오른쪽
// 자리에는 하나만 선다」 · 「넓힌 카드를 닫으면 사이드바가 되돌아온다」 · 보드 SummarySheet의 표).
//
// 값은 작업공간마다 하나다 — spec 패널 · 요약 카드 · 없음 중 하나만 서고, 넓힌 카드도 요약 카드다. 넓히면 사이드바와 spec 패널이 접히고, 닫으면
// 작은 카드와 사이드바만 돌아온다. 카드는 채팅 탭(새 채팅 탭도)에 서고, 셸 · 파일 탭이 켜지면 값이 없음이 된다. 규칙 표(`nextSeat` · `followTab` ·
// `cardTabOf` · `docArrival` · `cardDocFile`)는 L2(`right-place.test.ts`)가 잰다 — 여기는 손짓이 화면과 주소에 닿는 한 바퀴다.
//
// 채팅은 고정 답의 「작업공간에 이은 채팅 둘」(`WORK_CHATS` — `pinned-work`)이다. `multi-work`는 채팅이 없고 문서가 있다.

test.use({ viewport: { width: 1440, height: 900 } });

const [pinnedWork, plainWork, multiWork] = WORKS;
const [chatA, chatB] = WORK_CHATS;

const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
/** 사이드바의 그려진 폭 — 넓힌 카드가 서 있는 동안 접혀 틈 8로 남는다. */
const 사이드바폭 = (page: Page) => 사이드바(page).evaluate((el) => Math.round(el.getBoundingClientRect().width));
const 패널 = (page: Page) => page.getByRole("region", { name: "작업공간 패널", exact: true });
/** spec 패널 상자(`aside#work-panel` — 틈 8 + 카드)의 그려진 폭 — 닫히면 0이다. */
const 패널폭 = (page: Page) => page.locator("aside#work-panel").evaluate((el) => Math.round(el.getBoundingClientRect().width));
const 패널토글 = (page: Page) => page.getByRole("button", { name: /^작업공간 패널 (접기|펼치기)$/ });
const 레일칸 = (page: Page) => page.getByRole("group", { name: "레일", exact: true }).getByRole("button", { name: "spec", exact: true });
const 요약단추 = (page: Page) => page.getByRole("button", { name: "요약 카드", exact: true });
const 카드 = (page: Page) => page.getByRole("region", { name: "요약", exact: true });
const 넓힌카드 = (page: Page) => page.locator("section[data-expanded]");
const 카드로접기 = (page: Page) => page.getByRole("button", { name: "카드로 접기", exact: true });
/** spec 패널 트리의 그 문서 줄. */
const 문서줄 = (page: Page, path: string) => 패널(page).locator(`[data-roving="${path}"]`);
/** 요약 카드 소스의 그 문서 줄 — 넓힌 카드에서는 지금 연 문서에 `aria-current`가 선다. */
const 카드문서 = (page: Page, path: string) => 카드(page).locator(`[data-doc="${path}"]`);
/** 탭 줄의 칸 — 왼쪽부터 종류, 채팅 칸이면 그 채팅 id. 끝의 `+`는 뺀다. */
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
const 채팅칸 = (page: Page, id: string) => page.locator(`[data-tab="chat"][data-thread="${id}"] button[aria-pressed]`);
const 셸칸 = (page: Page) => page.locator('[data-tab="shell"] button[aria-pressed]').first();
/**
 * 주소의 검색 값 — `tab` · `thread` · `code` · `file` 차례로 다시 늘어놓아 읽는다. 키의 차례는 스펙이 정하지 않는다(처음 연 주소의 `file`이
 * 앞에 남기도 한다) — 무엇이 있고 없는지만 견준다.
 */
const 검색값 = (page: Page) => {
  const params = new URL(page.url()).searchParams;
  const rank = (key: string) => ["tab", "thread", "code", "file"].indexOf(key);
  const keys = [...params.keys()].sort((a, b) => rank(a) - rank(b));
  return keys.length === 0 ? "" : `?${keys.map((key) => `${key}=${params.get(key)}`).join("&")}`;
};
const 경로 = (page: Page) => new URL(page.url()).pathname;

/** 작업공간 화면이 섰다 — 기둥(레일 · 패널 상자)이 다 자랄 때까지 기다린다. 자라는 동안의 폭을 재지 않는다. */
async function 섰다(page: Page): Promise<void> {
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify([await 패널폭(page), await 사이드바폭(page)]);
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

test("오른쪽 자리에는 하나만 선다 — 요약 카드 · 레일의 spec · ⌘Enter가 서로를 걷고, 넓히면 사이드바와 spec 패널이 접히며, 닫으면 작은 카드와 사이드바만 돌아온다. 값은 작업공간마다다", async ({
  page,
}) => {
  await installFixtureBackend(page, workChatAnswers());
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(page).toHaveURL(/thread=/, { timeout: 20_000 });
  await 섰다(page);
  const 펼친사이드바 = await 사이드바폭(page);

  // 처음 — spec 패널이다(표 첫 줄). 요약 카드는 없다.
  await expect(패널(page)).toBeVisible();
  await expect(레일칸(page)).toHaveAttribute("aria-pressed", "true");
  await expect(요약단추(page)).toHaveAttribute("aria-pressed", "false");
  await expect(카드(page)).toHaveCount(0);

  // 요약 카드 — 패널이 접히고 작은 카드가 선다. 사이드바는 그대로다.
  await 요약단추(page).click();
  await expect(카드(page)).toBeVisible();
  await expect(요약단추(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => 패널폭(page)).toBe(0);
  await expect(레일칸(page)).toHaveAttribute("aria-pressed", "false");
  expect(await 사이드바폭(page)).toBe(펼친사이드바);

  // 레일의 spec — 카드가 걷히고 패널이 선다.
  await 레일칸(page).click();
  await expect(카드(page)).toHaveCount(0);
  await expect(요약단추(page)).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => 패널폭(page)).toBeGreaterThan(0);

  // 작은 카드의 문서 줄 — 카드가 넓어져 그 문서를 연다. 넓은 동안 사이드바가 접히고(틈 8), spec 패널도 접힌다.
  await 요약단추(page).click();
  await 카드문서(page, "overview.md").click();
  await expect(넓힌카드(page)).toBeVisible();
  await expect(카드문서(page, "overview.md")).toHaveAttribute("aria-current", "true");
  await expect.poll(() => 사이드바폭(page)).toBe(8);
  await expect.poll(() => 패널폭(page)).toBe(0);
  await expect(패널토글(page)).toHaveAccessibleName("작업공간 패널 펼치기");

  // 「카드로 접기」 — 작은 카드와 사이드바만 돌아온다. spec 패널은 접힌 채다.
  await 카드로접기(page).click();
  await expect(넓힌카드(page)).toHaveCount(0);
  await expect(카드(page)).toBeVisible();
  await expect.poll(() => 사이드바폭(page)).toBe(펼친사이드바);
  expect(await 패널폭(page)).toBe(0);

  // ⌘Enter — 패널이 서고 카드가 걷힌다(패널 토글 · 레일 칸과 같은 손짓).
  await page.getByRole("main").click({ position: { x: 40, y: 200 } });
  await page.keyboard.press("Meta+Enter");
  await expect(카드(page)).toHaveCount(0);
  await expect.poll(() => 패널폭(page)).toBeGreaterThan(0);

  // 값은 작업공간마다다 — 이 작업공간에 작은 카드를 세우고 다른 작업공간에 가면 그쪽은 제 처음 값(spec 패널)이고, 돌아오면 작은 카드 그대로다.
  await 요약단추(page).click();
  await expect(카드(page)).toBeVisible();
  await workRow(page, multiWork.slug).click();
  await expect(page).toHaveURL(new RegExp(`/works/${multiWork.slug}\\?`));
  await expect(패널(page)).toBeVisible();
  await expect(카드(page)).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}\\?`));
  await expect(카드(page)).toBeVisible();
  await expect.poll(() => 패널폭(page)).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 · 파일 탭이 켜지면 요약 카드가 닫히고 사이드바가 되돌아오며 spec 패널은 그대로다 — 다른 채팅 탭은 넓힌 카드를 작은 카드로 돌리고, 셸에서 요약 카드를 열면 가장 최근에 켠 채팅 탭에 선다", async ({
  page,
}) => {
  await installFixtureBackend(page, workChatAnswers());
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(page).toHaveURL(new RegExp(`thread=${chatB.id}`), { timeout: 20_000 });
  await 섰다(page);
  const 펼친사이드바 = await 사이드바폭(page);
  // 첫째 채팅도 탭으로 세운다(사이드바) — 넓힌 동안은 사이드바가 접혀 누를 수 없으니 미리 세운다.
  await 사이드바(page).getByRole("button", { name: `${pinnedWork.title}의 채팅 펼치기`, exact: true }).click();
  await 사이드바(page).locator(`[data-work-threads="${pinnedWork.slug}"]`).getByRole("button", { name: new RegExp(`^${chatA.title}`) }).click();
  await expect.poll(() => 칸차례(page)).toEqual([`chat:${chatB.id}`, `chat:${chatA.id}`]);

  // 첫째 채팅 탭에서 넓힌다.
  await 요약단추(page).click();
  await 카드문서(page, "overview.md").click();
  await expect(넓힌카드(page)).toBeVisible();
  await expect.poll(() => 사이드바폭(page)).toBe(8);

  // 셸 탭 — 카드가 닫혀 값이 없음이 되고 사이드바가 돌아온다. spec 패널은 넓힐 때 접힌 그대로다.
  await openShell(page);
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(카드(page)).toHaveCount(0);
  await expect(요약단추(page)).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => 사이드바폭(page)).toBe(펼친사이드바);
  expect(await 패널폭(page)).toBe(0);

  // 채팅 탭으로 돌아와도 카드는 없다(값이 없음이다).
  await 채팅칸(page, chatA.id).click();
  await expect(page).toHaveURL(new RegExp(`thread=${chatA.id}`));
  await expect(카드(page)).toHaveCount(0);

  // 셸에서 요약 카드를 연다 — 가장 최근에 켠 채팅 탭(첫째)이 켜지고 그 위에 작은 카드가 선다.
  await 셸칸(page).click();
  await expect(page).toHaveURL(/tab=terminal/);
  await 요약단추(page).click();
  await expect(page).toHaveURL(new RegExp(`tab=chat&thread=${chatA.id}`));
  await expect(카드(page)).toBeVisible();

  // 넓힌 채 다른 채팅 탭을 켜면 작은 카드로 돌아온다 — 사이드바도 돌아온다.
  await 카드문서(page, "overview.md").click();
  await expect(넓힌카드(page)).toBeVisible();
  await 채팅칸(page, chatB.id).click();
  await expect(page).toHaveURL(new RegExp(`thread=${chatB.id}`));
  await expect(넓힌카드(page)).toHaveCount(0);
  await expect(카드(page)).toBeVisible();
  await expect.poll(() => 사이드바폭(page)).toBe(펼친사이드바);

  // 파일 탭 — 셸처럼 카드가 닫힌다.
  await 주소로간다(page, 파일탭주소("billing/README.md"));
  await expect(page.locator('[data-tab="code"] button[aria-pressed="true"]')).toHaveCount(1);
  await expect(카드(page)).toHaveCount(0);
  await expect(요약단추(page)).toHaveAttribute("aria-pressed", "false");

  // 채팅이 없는 작업공간 — 셸에서 요약 카드를 열면 새 채팅 탭(묶음에 있던 것)에 선다. 칸이 늘지 않는다.
  await workRow(page, plainWork.slug).click();
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}\\?tab=chat$`));
  await openShell(page);
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat", "shell"]);
  await 요약단추(page).click();
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}\\?tab=chat$`));
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat", "shell"]);
  await expect(카드(page)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("셸 · 파일 탭에서 spec 패널의 문서 줄을 누르면 가장 최근 채팅 탭이 켜지고 넓힌 카드가 서며, 채팅이 없으면 새 채팅 탭에 선다 — 셸로 가는 주소에는 `file`이 남지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page, workChatAnswers());
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(page).toHaveURL(new RegExp(`thread=${chatB.id}`), { timeout: 20_000 });
  await 섰다(page);

  // 셸 탭에서 문서 줄 — 채팅 탭(가장 최근 — 둘째)이 켜지고 그 문서의 넓힌 카드가 선다. 주소가 문서를 든다.
  await openShell(page);
  await 문서줄(page, "overview.md").click();
  await expect(넓힌카드(page)).toBeVisible();
  await expect(카드문서(page, "overview.md")).toHaveAttribute("aria-current", "true");
  expect(경로(page)).toBe(`/works/${pinnedWork.slug}`);
  expect(검색값(page)).toBe(`?tab=chat&thread=${chatB.id}&file=overview.md`);
  await expect.poll(() => 사이드바폭(page)).toBe(8);

  // 셸로 가면 `file`이 걷힌다 — 셸로 가는 주소에 문서가 남지 않는다.
  await 셸칸(page).click();
  await expect(page).toHaveURL(/tab=terminal/);
  expect(검색값(page)).not.toContain("file=");
  await expect(넓힌카드(page)).toHaveCount(0);

  // 파일 탭에서 문서 줄 — 같은 채팅 탭에 넓힌 카드다. 넓힐 때 접힌 패널을 다시 편다.
  await 주소로간다(page, 파일탭주소("billing/README.md"));
  await expect(page.locator('[data-tab="code"] button[aria-pressed="true"]')).toHaveCount(1);
  await 패널토글(page).click();
  await 문서줄(page, "메타.json").click();
  await expect(넓힌카드(page)).toBeVisible();
  expect(검색값(page)).toBe(`?tab=chat&thread=${chatB.id}&file=메타.json`);

  // 채팅이 없는 작업공간 — 셸에서 문서 줄을 누르면 새 채팅 탭(묶음에 있던 것)에 넓힌 카드가 선다. 칸이 늘지 않는다.
  await 작업화면으로(page, multiWork);
  await expect(page).toHaveURL(new RegExp(`/works/${multiWork.slug}\\?tab=chat$`));
  await openShell(page);
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat", "shell"]);
  await 문서줄(page, "다이어그램.md").click();
  await expect(page.getByRole("main", { name: "새 채팅", exact: true }).locator("section[data-expanded]")).toBeVisible();
  expect(검색값(page)).toBe("?tab=chat&file=다이어그램.md");
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat", "shell"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("주소의 `?file=`에 닿으면 가장 최근 채팅 탭(채팅이 없으면 새 채팅 탭)의 넓힌 카드로 열고, 없는 문서면 카드 없이 값을 걷는다 — 셸에서 검색으로 연 문서도 같다", async ({
  page,
}) => {
  await installFixtureBackend(page, workChatAnswers());
  await page.goto(`/works/${pinnedWork.slug}?file=overview.md`);
  await expect(넓힌카드(page)).toBeVisible({ timeout: 20_000 });
  expect(검색값(page)).toBe(`?tab=chat&thread=${chatB.id}&file=overview.md`);
  await expect(카드문서(page, "overview.md")).toHaveAttribute("aria-current", "true");

  // 카드를 닫으면 값이 걷힌다.
  await 카드로접기(page).click();
  await expect(넓힌카드(page)).toHaveCount(0);
  await expect.poll(() => 검색값(page)).toBe(`?tab=chat&thread=${chatB.id}`);

  // 셸에서 ⌘K로 고른 문서 — 채팅 탭의 넓힌 카드로 열린다(검색 결과의 넷째 줄 — 고정 답의 넷째 문서).
  await openShell(page);
  await 검색팔레트를연다(page);
  await page.getByRole("option").nth(3).click();
  await expect(넓힌카드(page)).toBeVisible();
  await expect.poll(() => 검색값(page)).toBe(`?tab=chat&thread=${chatB.id}&file=${pinnedWork.specFiles[3]}`);

  // 없는 문서 — 카드 없이 값을 걷는다.
  await page.goto(`/works/${pinnedWork.slug}?file=${encodeURIComponent("지운 문서.md")}`);
  await expect(page).toHaveURL(new RegExp(`thread=${chatB.id}$`), { timeout: 20_000 });
  expect(검색값(page)).toBe(`?tab=chat&thread=${chatB.id}`);
  await expect(넓힌카드(page)).toHaveCount(0);

  // 채팅이 없는 작업공간 — 새 채팅 탭의 넓힌 카드다.
  await page.goto(`/works/${multiWork.slug}?file=${encodeURIComponent("넓은.md")}`);
  await expect(page.getByRole("main", { name: "새 채팅", exact: true }).locator("section[data-expanded]")).toBeVisible({ timeout: 20_000 });
  expect(검색값(page)).toBe("?tab=chat&file=넓은.md");
  await expect.poll(() => 칸차례(page)).toEqual(["new-chat"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 02a-12의 위험 — 카드 ↔ 주소는 이펙트 둘(「주소 → 카드」 · 「카드 → 주소」)이 같은 틱을 나눠 맡는다. 작업공간이나 주소의 문서가 함께 바뀐 틱은
// 「카드 → 주소」가 세지 않아야 한다 — 세면 뒤로 가기로 돌아온 문서를 카드에 남은 앞 문서로 덮거나, 다른 작업공간의 문서를 이 작업공간 주소에 적는다.
test("넓힌 카드의 문서는 주소를 따른다 — 검색으로 바꾼 문서와 다른 작업공간을 뒤로 · 앞으로 오가도 주소의 문서가 카드에 서고 주소가 덮이지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page, workChatAnswers());
  await page.goto(`/works/${pinnedWork.slug}?file=overview.md`);
  await expect(카드문서(page, "overview.md")).toHaveAttribute("aria-current", "true", { timeout: 20_000 });

  // 같은 작업공간 — 검색으로 다른 문서를 연다(쌓는 이동). 카드가 따라간다.
  await 검색팔레트를연다(page);
  await page.getByRole("option").nth(3).click();
  await expect(카드문서(page, "메타.json")).toHaveAttribute("aria-current", "true");
  expect(검색값(page)).toBe(`?tab=chat&thread=${chatB.id}&file=메타.json`);

  // 뒤로 — 주소의 문서(앞 문서)가 카드에 서고, 카드에 남아 있던 문서로 주소가 다시 덮이지 않는다. 앞으로도 같다.
  await page.goBack();
  await expect(카드문서(page, "overview.md")).toHaveAttribute("aria-current", "true");
  await expect.poll(() => 검색값(page)).toBe(`?tab=chat&thread=${chatB.id}&file=overview.md`);
  await page.goForward();
  await expect(카드문서(page, "메타.json")).toHaveAttribute("aria-current", "true");
  await expect.poll(() => 검색값(page)).toBe(`?tab=chat&thread=${chatB.id}&file=메타.json`);

  // 다른 작업공간에서 다른 문서를 넓힌다.
  await 작업화면으로(page, multiWork);
  await expect(page).toHaveURL(new RegExp(`/works/${multiWork.slug}\\?tab=chat$`));
  await 요약단추(page).click();
  await 카드문서(page, "넓은.md").click();
  await expect(카드문서(page, "넓은.md")).toHaveAttribute("aria-current", "true");
  expect(검색값(page)).toBe("?tab=chat&file=넓은.md");

  // 뒤로 — 앞 작업공간의 주소와 그 문서다. 다른 작업공간의 문서가 이 주소에 적히지 않고, 이 작업공간의 카드가 걷히지도 않는다.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}\\?`));
  await expect(카드문서(page, "메타.json")).toHaveAttribute("aria-current", "true");
  await page.waitForTimeout(300);
  expect(검색값(page)).toBe(`?tab=chat&thread=${chatB.id}&file=메타.json`);

  // 앞으로 — 그 작업공간의 문서 그대로다.
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/works/${multiWork.slug}\\?`));
  await expect(카드문서(page, "넓은.md")).toHaveAttribute("aria-current", "true");
  await page.waitForTimeout(300);
  expect(검색값(page)).toBe("?tab=chat&file=넓은.md");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 02a-11 — **새 채팅 탭에도 요약 카드와 넓힌 카드가 선다**(구현 스펙 「카드의 `thread`를 선택값으로 바꾸고, 읽는 범위는 작업공간으로 읽고, 문서의
// 인용은 그 탭의 글 열쇠로 붙인다」). 카드가 열리면 물음 · 입력창이 비켜나고, 넓히면 대화 칸이 480이다. 인용은 그 탭의 입력창에 붙어 첫 말과 함께 간다.
test("새 채팅 탭에도 요약 카드와 넓힌 카드가 서서 입력창이 비켜나고, 넓힌 카드에서 인용한 글이 그 탭의 입력창에 붙어 첫 말과 함께 간다", async ({
  page,
}) => {
  const started: ThreadView = { ...FIXTURE_THREAD, work: pinnedWork.slug };
  await installFixtureBackend(page, { thread_get: answerByArg("thread", { [started.id]: started }) });
  await page.goto(`/works/${pinnedWork.slug}`);
  const body = page.getByRole("main", { name: "새 채팅", exact: true });
  await expect(body).toBeVisible({ timeout: 20_000 });
  await 섰다(page);
  const 펼친사이드바 = await 사이드바폭(page);
  const 입력창 = body.getByRole("textbox", { name: "보낼 말", exact: true }).locator("xpath=ancestor::form[1]");

  // 작은 카드 — 새 채팅 탭 위에 서고, 입력창이 카드 왼쪽 16 앞에서 멈춘다. 읽는 범위는 채팅 없이 작업공간으로 읽는다.
  await 요약단추(page).click();
  await expect(body.getByRole("region", { name: "요약", exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const [form, card] = [await 입력창.boundingBox(), await 카드(page).boundingBox()];
      return Math.round(card!.x - (form!.x + form!.width));
    })
    .toBeGreaterThanOrEqual(16);
  await expect
    .poll(() => ipcArgs(page, "reading_scope", "work"))
    .toContainEqual(expect.objectContaining({ thread: null, work: pinnedWork.slug }));

  // 넓힌 카드 — 문서를 열고, 대화 칸이 480이며, 사이드바가 접힌다.
  await 카드문서(page, "overview.md").click();
  await expect(body.locator("section[data-expanded]")).toBeVisible();
  await expect
    .poll(() =>
      body.evaluate((main) => {
        const column = main.querySelector('[style*="--size-thread-beside"]');
        return column ? Math.round(column.getBoundingClientRect().right - main.getBoundingClientRect().left) : null;
      }),
    )
    .toBe(480);
  await expect.poll(() => 사이드바폭(page)).toBe(8);

  // 인용 — 문단을 골라 「이 자리를 두고 말하기」. 그 탭의 입력창에 인용이 붙는다.
  const doc = page.locator('[data-viewer="doc"]');
  const 문단 = doc.locator("[data-src-start]").filter({ has: page.locator("p") }).first();
  await 문단.locator("p").selectText();
  const quoted = await 문단.locator("p").innerText();
  expect(quoted).toBe(SPEC_FALLBACK_BODY.split("\n\n")[1].trim());
  await doc.getByRole("button", { name: /이 자리를 두고 말하기$/ }).click();
  await expect(body.locator("[data-quote]")).toBeVisible();
  const [start, end] = [Number(await 문단.getAttribute("data-src-start")), Number(await 문단.getAttribute("data-src-end"))];

  // 「카드로 접기」 — 사이드바가 돌아온다. 인용은 그 탭의 입력창에 남는다.
  await 카드로접기(page).click();
  await expect.poll(() => 사이드바폭(page)).toBe(펼친사이드바);
  await expect(body.locator("[data-quote]")).toBeVisible();

  // 첫 말 — 인용이 함께 간다.
  await body.getByRole("textbox", { name: "보낼 말", exact: true }).fill("이 줄을 고쳐 줘");
  await body.getByRole("textbox", { name: "보낼 말", exact: true }).press("Enter");
  await expect.poll(() => callCount(page, "thread_start")).toBe(1);
  expect(await ipcArgs(page, "thread_start", "text")).toEqual([
    expect.objectContaining({
      text: "이 줄을 고쳐 줘",
      link: { kind: "work", slug: pinnedWork.slug },
      quote: { file: "overview.md", start, end, text: quoted },
    }),
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** Work 만들기 턴(`thread-work`)이 끝난 채팅 — 그 턴이 spec 폴더에 문서 둘을 썼다(살아 있는 작업공간이면 대화에 그 문서 카드가 선다). */
const made = atHome(record("thread-work"));
const MADE = lineOf(made, "work", "created").payload as { slug: string; title: string; branch: string; projects: string[] };
const MADE_LAST = made[made.length - 1].seq;
const MADE_DOCS = Object.keys(specWrites(made, MADE.slug));
/** 그 작업공간이 보관되어 읽기만인 채팅. */
const shelved: ThreadView = {
  ...FIXTURE_THREAD,
  id: "20261025-090000",
  title: titleThrough(made, MADE_LAST),
  work: MADE.slug,
  readOnly: "archived",
  lastSeq: MADE_LAST,
};
/** 작업공간에 잇지 않은 채팅 — 같은 대화다. */
const loose: ThreadView = { ...shelved, id: "20261026-090000", work: null, readOnly: null };
const SHELVED: ArchiveEntry = { slug: MADE.slug, title: MADE.title, status: "active", archivedAt: "2026-10-24T05:10:00Z", projects: MADE.projects };

// **작업공간 밖 채팅**(구현 스펙 「오른쪽 자리는 작은 요약 카드만 쓴다. 넓힌 카드는 없고, 대화의 문서 카드와 바뀐 파일 알약도 그리지 않는다. 열
// 곳이 없기 때문이다」) — `/threads/:id`에 선 채팅이다. 작업공간에 잇지 않은 채팅과 보관된 작업공간의 채팅이다.
test("작업공간 밖 채팅(작업공간에 잇지 않은 채팅 · 보관된 작업공간의 채팅)에는 넓힌 카드가 없다 — 작은 요약 카드만 서고 그 줄은 누를 것이 아니며, 대화에 문서 카드가 그려지지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    ...workChatAnswers([shelved, loose], { [shelved.id]: made, [loose.id]: made }),
    list_archive: [...ARCHIVE, SHELVED],
    list_archived_docs: answerByArg("slug", {
      ...ARCHIVED_DOCS,
      [MADE.slug]: { docs: MADE_DOCS.map((one) => `spec/${one}`), specTree: workView(MADE, { docs: MADE_DOCS }).specTree },
    }),
  });
  for (const view of [loose, shelved]) {
    await page.goto(`/threads/${view.id}`);
    await expect(page.getByRole("main", { name: view.title, exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(`/threads/${view.id}`);
    await expect(page.getByRole("main").getByText(sentPayloads(made)[0].text, { exact: true })).toBeVisible();
    await expect(page.locator("[data-doc-card]")).toHaveCount(0);

    await 요약단추(page).click();
    await expect(카드(page)).toBeVisible();
    if (view === shelved) await expect(카드(page).locator("[data-doc]")).toHaveText(MADE_DOCS);
    // 카드의 줄은 누를 것이 아니다 — 넓힐 길이 없다.
    await expect(카드(page).locator("button[data-doc], button[data-changes], button[data-change], button[data-project]")).toHaveCount(0);
    for (const row of await 카드(page).locator("[data-doc], [data-project]").all()) await row.click();
    await expect(넓힌카드(page)).toHaveCount(0);
    await expect(카드(page)).toBeVisible();
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});
