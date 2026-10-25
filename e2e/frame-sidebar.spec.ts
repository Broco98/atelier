import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, ARCHIVE, FIXTURE_THREAD, PROJECTS, summaryWith as 요약, WORKS } from "./fixtures";
import {
  awaitSpawned,
  installFixtureBackend,
  markAttention,
  SPEC_LAYOUT_EDITOR,
  unknownIpcCalls,
  끄는자리,
  띠,
  사람메뉴항목,
  사람줄,
  셸입력,
  줄표시,
  창검색버튼,
  첫글자,
  칠한값,
  토큰값,
  토큰색,
  행버튼,
  검색어칸,
  검색팔레트를연다,
  그림자,
  화면머리,
  흰판안,
} from "./harness";
import { lineOf, linesThrough, record, seqOf, summaryOf, threadOf } from "./thread-records";
import { formatMemory } from "@/features/processes/metrics";

// 02 티켓 13a — 흐름 「틀과 사이드바」(02 구현 스펙 §3 · §4 · §5 · Testing Decisions). **어느 주소에서나 같은 머리 줄 하나와 흰 판 하나에
// 사이드바와 본문이 서고**, 사이드바 위 줄 세 행(새 Thread · 내 차례 · Library)과 ⌘N, Work 줄의 상태 표시 하나가 그 Work의 Thread와 셸
// 가운데 가장 센 것이며, Work 묶음 +가 「새 Work」 새 Thread를 열고, 사람 메뉴가 지금 화면들과 메모리 합계를 들고, 머리 카드였던 화면들이
// 머리 줄에 제 이름과 할 일을 세운다.
//
// 같은 것을 두 번 재지 않는다 — 다른 spec이 이미 재는 것:
//   판 안 칸의 자리 · 칸 사이 선 · 판 안이 끄는 자리가 아님 · 머리 줄 컨트롤 크기 · 끄는 자리   `frame.spec.ts`
//   사이드바 차례 · 사람 메뉴의 행선지 · ⌘K로 Thread · 「새 Thread」를 누르면 첫 화면            `thread-sidebar.spec.ts`
//   Thread 줄 다섯 상태 표시                                                                   `thread-status.spec.ts`
//   「내 차례」를 켜고 다시 눌러 끄기 · 기다리는 순서                                           `thread-waiting.spec.ts`
//   Work 줄의 셸 신호(내 차례 알약 · 새 결과 점) · 레인은 폴더 · 호버 카드                       `works-sidebar.spec.ts` · `shell-*.spec.ts`
//   위 줄 ↑↓ · Tab 차례(창 컨트롤 → 머리 줄 → 사이드바 …)                                      `keyboard.spec.ts`
//   ⌘N의 메뉴 바 항목 · ⌘N 글자 크기 · 사람 줄 기하 · `●`(손볼 것)                              `hotkeys` · `type-scale` · `sidebar-quiet` · `spacing` · `processes-nav-meta`
//   Thread 화면의 머리 줄(이름 · 「…」 · 요약 고정)                                              `thread-screen.spec.ts`

const thread = FIXTURE_THREAD;
const [pinnedWork, plainWork] = WORKS;
/** Thread 화면이 서는 데 드는 답 — 「새 Thread 두 턴」 기록의 Thread 하나다. */
const THREAD_ANSWERS = {
  thread_list: [summaryOf(thread)],
  thread_get: answerByArg("thread", { [thread.id]: thread }),
  thread_read_record: answerByArg("thread", { [thread.id]: record("thread-two-turns") }),
};

const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
/** 위 줄의 행 버튼(이름으로). */
const 위줄 = (page: Page, name: string) => 사이드바(page).locator("nav").first().getByRole("button", { name, exact: true });
/** 행의 면 — 고른 면 · hover 면은 행 버튼을 품은 상자가 칠한다(`SidebarItem`). */
const 면 = async (row: Locator) => row.locator("..").evaluate((el) => getComputedStyle(el).backgroundColor);
const 첫화면 = (page: Page) => page.getByRole("heading", { name: "무엇을 만들까요?", exact: true });

async function boxOf(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("상자를 못 읽었다");
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

// ─── 머리 줄과 흰 판 ───────────────────────────────────────────────────────────────────────────────────────────────

// **틀은 하나다**(02 구현 스펙 §3 「틀이 하나다」). 한때 두 벌이었다 — Thread 화면들(`/` · `/threads/<id>` · `/library`)의 `PlainFrame`과
// 나머지 화면의 `Frame`. 이제 앱 셸이 그리는 한 틀에 모든 화면이 선다: 크롬(`surface-shell`) 맨 위 44 머리 줄 하나에 신호등 자리 · 셸
// 컨트롤 · 지금 화면의 자리가 서고, 그 아래 흰 판 하나(왼 · 오 · 아래 5, 0.5 `border-panel`, 둥글기 12, 위 그림자 `shadow-panel`) 안 왼쪽에
// 사이드바, 그 오른쪽에 본문이 든다. 화면 자리는 사이드바 오른쪽 끝에서 시작하고 앞에 세로선(`separator` 1 × 20)이 선다 — 화면이 아무것도
// 보내지 않으면(새 Thread) 선도 없다. 머리 줄 아래에는 선이 없다(한때 Thread 머리 줄 아래 0.5 선이 섰다).
//
// 주소마다 하나씩 잰다 — 틀이 둘로 갈려 한 벌만 고쳐진 날 그 벌의 주소만 빨개진다.
const ADDRESSES: { name: string; url: string; overrides?: Record<string, unknown>; ready: (page: Page) => Locator; head: boolean }[] = [
  { name: "새 Thread", url: "/", overrides: THREAD_ANSWERS, ready: 첫화면, head: false },
  {
    name: "Thread",
    url: `/threads/${thread.id}`,
    overrides: THREAD_ANSWERS,
    ready: (page) => page.getByRole("main", { name: thread.title, exact: true }),
    head: true,
  },
  { name: "Library", url: "/library", ready: (page) => page.getByRole("main", { name: "Library", exact: true }), head: true },
  {
    name: "Projects",
    url: `/projects/${PROJECTS[0].slug}`,
    ready: (page) => page.getByRole("region", { name: "프로젝트 목록", exact: true }),
    head: true,
  },
  { name: "Terminal", url: "/terminal", ready: (page) => page.locator(".xterm-screen"), head: true },
  { name: "Processes", url: "/processes", ready: (page) => page.getByRole("heading", { name: "Processes", exact: true }), head: true },
  {
    name: "Archive",
    url: `/archive/${ARCHIVE[0].slug}`,
    ready: (page) => page.getByRole("region", { name: "아카이브 목록", exact: true }),
    head: true,
  },
  { name: "Settings", url: "/settings/terminal", ready: (page) => 화면머리(page).getByText("Settings", { exact: true }), head: true },
  {
    name: "레이아웃 편집기",
    url: SPEC_LAYOUT_EDITOR,
    ready: (page) => page.getByRole("region", { name: "항목 트리", exact: true }),
    head: true,
  },
  { name: "Work", url: `/works/${pinnedWork.slug}`, ready: (page) => page.getByRole("region", { name: "작업 패널", exact: true }), head: true },
];

for (const address of ADDRESSES) {
  test(`${address.name}: 머리 줄 44 하나에 셸 컨트롤과 화면 자리가 서고, 흰 판 하나에 사이드바와 본문이 든다`, async ({ page }) => {
    await installFixtureBackend(page, address.overrides);
    await page.goto(address.url);
    // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 그 화면을 처음 변환하는 것을 기다린다.
    await expect(address.ready(page)).toBeVisible({ timeout: 20_000 });
    const viewport = page.viewportSize()!;

    // 머리 줄 — 창 맨 위 44 줄 하나다. 아래에 선이 없다. 높이는 토큰에서 읽고 스펙의 수(44)는 따로 센다.
    const row = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector("[data-titlebar]")!).getPropertyValue("--titlebar-height")),
    );
    expect(row, "머리 줄 높이 — 02 구현 스펙 §3").toBe(44);
    await expect(page.locator("header")).toHaveCount(1);
    const header = await boxOf(page.locator("header"));
    expect([header.x, header.y, header.right, header.bottom], "머리 줄").toEqual([0, 0, viewport.width, row]);
    expect(await 칠한값(page.locator("header"), "border-bottom-width", "box-shadow"), "머리 줄 아래 선 · 그림자").toEqual(["0px", "none"]);
    // 셸 컨트롤은 어느 주소에서나 같은 자리다 — 신호등 끝 + 16, 머리 줄 가운데(그 크기 · 사이는 `frame.spec.ts`).
    const toggle = await boxOf(page.getByRole("button", { name: "사이드바 토글", exact: true }));
    expect([toggle.x, toggle.y + toggle.height / 2], "사이드바 토글 자리").toEqual([83, row / 2]);

    // 흰 판 — 하나이고, 머리 줄 아래 크롬 왼 · 오 · 아래 끝에서 5다.
    const panel = page.locator('[data-slot="panel"]');
    await expect(panel).toHaveCount(1);
    const outer = await boxOf(panel);
    expect([outer.x, outer.y, outer.right, outer.bottom], "흰 판").toEqual([5, row, viewport.width - 5, viewport.height - 5]);
    const [radius, border, borderStyle, borderColor, shadow, fill] = await 칠한값(
      panel,
      "border-top-left-radius",
      "border-top-width",
      "border-top-style",
      "border-top-color",
      "box-shadow",
      "background-color",
    );
    expect([radius, border, borderStyle], "판의 둥글기 · 테두리").toEqual(["12px", "0.5px", "solid"]);
    expect(borderColor, "테두리 색 — border-panel").toBe(await 토큰색(page, "--border-panel"));
    expect(await 토큰색(page, "--border-panel"), "DS 수 — #e8e8e8").toBe("rgb(232, 232, 232)");
    expect(그림자(shadow), "판의 위 그림자 — shadow-panel").toBe(await 토큰값(page, "box-shadow", "--shadow-panel"));
    expect(fill, "판의 면").toBe(await 토큰색(page, "--surface"));

    // 판 안 — 사이드바가 판 안 왼쪽 위에서 아래끝까지, 본문(`main` 하나)이 그 오른쪽에 판 위끝에서 아래끝까지 선다.
    const 판 = await 흰판안(page);
    const side = await boxOf(사이드바(page));
    expect([side.x, side.y, side.bottom], "사이드바 — 판 안").toEqual([판.x, 판.y, 판.bottom]);
    await expect(page.locator("main")).toHaveCount(1);
    const main = await boxOf(page.locator("main"));
    expect([main.x, main.y, main.bottom], "본문 — 사이드바 뒤 판 안").toEqual([side.right, 판.y, 판.bottom]);
    expect(main.right, "본문은 판 안에서 끝난다").toBeLessThanOrEqual(판.right);

    // 화면 자리 — 사이드바 오른쪽 끝에서 시작하고, 화면이 보낸 것이 있으면 앞에 세로선이 선다.
    const slot = 화면머리(page);
    expect((await boxOf(slot)).x, "화면 자리 왼쪽 끝 = 사이드바 오른쪽 끝").toBe(side.right);
    const 선 = await slot.evaluate((el) => {
      const style = getComputedStyle(el, "::before");
      const 선다 = style.display !== "none" && style.content !== "none" && style.content !== "normal";
      return [선다, style.width, style.top, style.bottom, style.backgroundColor];
    });
    if (address.head) {
      expect(선, "화면 자리 앞 세로선").toEqual([true, "1px", "12px", "12px", await 토큰색(page, "--separator")]);
    } else {
      await expect(slot, "새 Thread는 머리 줄에 보내는 것이 없다").toBeEmpty();
      expect(선[0], "보낸 것이 없으면 세로선도 없다").toBe(false);
    }
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// **화면 자리의 왼쪽 끝은 사이드바를 따른다**(02 구현 스펙 §3 「머리 줄 가운데」) — 열렸으면 사이드바 오른쪽 끝, 접혔으면 셸 컨트롤 바로
// 뒤(끝 + 8)이고 그때는 세로선이 없다. 사이드바를 끄는 동안은 둘 다 트랜지션 없이 커서를 곧장 따른다(`ShellHeadRow`의 `dragging`). Work
// 화면의 ⌘B는 `frame.spec.ts`가 잰다 — 여기는 Thread 화면(한때 `PlainFrame`)에서 끌기와 ⌘B 둘이다.
test("Thread: 사이드바를 끌면 머리 줄 화면 자리가 그 끝을 따르고, ⌘B로 접으면 셸 컨트롤 끝 + 8에서 세로선 없이 선다", async ({ page }) => {
  await installFixtureBackend(page, THREAD_ANSWERS);
  await page.goto(`/threads/${thread.id}`);
  await expect(page.getByRole("main", { name: thread.title, exact: true })).toBeVisible({ timeout: 20_000 });
  const slot = 화면머리(page);
  /** 화면 자리 앞 세로선이 서 있나 — 칠할 내용(`content`)이 있고 감춰지지 않았다. */
  const 선 = () =>
    slot.evaluate((el) => {
      const style = getComputedStyle(el, "::before");
      return style.display !== "none" && style.content !== "none" && style.content !== "normal";
    });
  const 자리 = async () => (await boxOf(slot)).x;
  const 끝 = async () => (await boxOf(사이드바(page))).right;
  const before = await 끝();
  expect(await 자리(), "앵커: 화면 자리가 사이드바 끝에서 시작한다").toBe(before);

  // 사이드바 오른쪽 끝의 폭 손잡이를 40 오른쪽으로 끈다 — 사이드바가 넓어지고 화면 자리 · 본문이 그 끝을 따른다.
  const handle = await boxOf(사이드바(page).locator('[title="드래그로 폭 조절 · 더블클릭으로 기본 폭"]'));
  const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(끝).toBe(before + 40);
  await expect.poll(자리).toBe(before + 40);
  expect((await boxOf(page.locator("main"))).x, "본문도 따른다").toBe(before + 40);
  expect(await 선(), "열린 동안 세로선").toBe(true);

  // ⌘B — 접으면 화면 자리가 셸 컨트롤 끝 + 8에서 시작하고 세로선이 걷힌다. 다시 펴면 끈 폭의 끝으로 돌아온다.
  await page.keyboard.press("Meta+b");
  const search = await boxOf(창검색버튼(page));
  await expect.poll(자리).toBe(search.right + 8);
  expect(await 선(), "접힌 동안 세로선").toBe(false);
  await page.keyboard.press("Meta+b");
  await expect.poll(자리).toBe(before + 40);
  expect(await 선()).toBe(true);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 위 줄 세 행과 ⌘N ──────────────────────────────────────────────────────────────────────────────────────────────

const permission = record("thread-permission");
const ASKED = lineOf(permission, "permission", "asked");
/** 승인을 묻고 기다리는 Thread — 나를 기다린다(내 차례). */
const asking = threadOf("20261025-090100", permission, { live: true, lastSeq: ASKED.seq });

// **위 줄은 세 행이다**(02 구현 스펙 §4 「위 줄 세 행」) — 새 Thread · 내 차례 · Library, 행 모양은 다른 사이드바 줄과 같은 30 · 간격 31이고 첫
// 행이 판 위끝 + 12에 선다(한때 그 자리에 「전체 | 내 차례」 마디가 섰다). 「새 Thread」 끝에는 그 키 ⌘N이 옅게(12 · 3단계 색 `fg-tertiary`)
// 행 안쪽 오른쪽 끝에 선다 — 보이는 글은 「새 Thread ⌘N」이지만 이름은 「새 Thread」이고 키는 `aria-keyshortcuts`가 말한다. 「내 차례」 끝에는
// 나를 기다리는 Thread 수가 파랗게(12/500 `mine`) 서고 이름에 함께 든다(「내 차례 1」). 0이면 비는 것은 `thread-sidebar.spec.ts`가 잰다.
test("위 줄 세 행이 판 위끝 + 12부터 30 · 간격 31로 서고 — 새 Thread 끝에 ⌘N이 옅게, 내 차례 끝에 기다리는 수가 파랗게 선다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(asking)],
    thread_get: answerByArg("thread", { [asking.id]: asking }),
    thread_read_record: answerByArg("thread", { [asking.id]: linesThrough(permission, ASKED.seq) }),
  });
  await page.goto("/");
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });
  const 새Thread = 위줄(page, "새 Thread");
  const 내차례 = 위줄(page, "내 차례 1");
  const Library = 위줄(page, "Library");
  await expect(내차례).toBeVisible();

  const 판 = await 흰판안(page);
  const rows = await Promise.all([새Thread, 내차례, Library].map((one) => boxOf(one.locator(".."))));
  expect(rows.map((one) => one.height), "행 높이").toEqual([30, 30, 30]);
  expect(rows.map((one) => one.y - 판.y), "판 위끝에서 — 12 · 간격 31").toEqual([12, 43, 74]);

  // ⌘N — 옅은 12 글자가 행 버튼 안쪽 오른쪽 끝에 서고, 이름에는 안 든다.
  await expect(새Thread).toHaveAttribute("aria-keyshortcuts", "Meta+N");
  const 키 = 새Thread.locator("span[aria-hidden]").filter({ hasText: "⌘N" });
  await expect(키).toHaveText("⌘N");
  expect(await 칠한값(키, "font-size", "color"), "⌘N 글자").toEqual(["12px", await 토큰색(page, "--fg-tertiary")]);
  const [button, glyph] = [await boxOf(새Thread), await boxOf(키)];
  const [padding] = await 칠한값(새Thread, "padding-right");
  expect(glyph.right, "⌘N — 행 안쪽 오른쪽 끝").toBe(button.right - parseFloat(padding));

  // 기다리는 수 — 12/500 `mine` 글자가 같은 자리에 선다.
  const 수 = 내차례.getByText("1", { exact: true });
  expect(await 칠한값(수, "font-size", "font-weight", "color"), "기다리는 수").toEqual(["12px", "500", await 토큰색(page, "--mine")]);
  expect((await boxOf(수)).right, "수 — 행 안쪽 오른쪽 끝").toBe((await boxOf(내차례)).right - parseFloat(padding));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **⌘N은 어느 화면에서나 새 Thread를 연다**(02 구현 스펙 §4 · 스토리 10) — 셸에 포커스가 있어도 먹는다(xterm이 ⌘ 글자 키를 앱으로 올린다).
// **확인 창이나 팔레트가 떠 있으면 안 먹는다**(`AppShell`의 ⌘N — ⌘J와 같은 게이트): 답을 기다리는 동안 화면을 옮기지 않고, 팔레트가 빌린
// 포커스와 다투지 않는다. 안 먹은 것은 「그 창이 그대로 서 있고 주소가 그대로다」로 잰다 — 대조로 같은 화면에서 창을 닫으면 먹는다.
test("⌘N이 Thread · Processes · 셸에 포커스가 선 Terminal에서 새 Thread를 열고, 확인 창 · 팔레트가 떠 있으면 안 연다", async ({ page }) => {
  await installFixtureBackend(page, THREAD_ANSWERS);
  const 새Thread로간다 = async (from: string) => {
    await page.keyboard.press("Meta+n");
    await expect(page, `${from}에서 ⌘N`).toHaveURL("/");
    await expect(첫화면(page)).toBeVisible();
  };

  await page.goto(`/threads/${thread.id}`);
  await expect(page.getByRole("main", { name: thread.title, exact: true })).toBeVisible({ timeout: 20_000 });
  await 새Thread로간다("Thread");

  await page.goto("/processes");
  await expect(page.getByRole("heading", { name: "Processes", exact: true })).toBeVisible();
  await 새Thread로간다("Processes");

  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await expect(셸입력(page), "앵커: 셸에 포커스가 있다").toBeFocused();
  await 새Thread로간다("셸에 포커스가 선 Terminal");

  // 팔레트 — 떠 있는 동안 ⌘N은 화면을 옮기지 않고 팔레트도 그대로다.
  await page.goto("/processes");
  await expect(page.getByRole("heading", { name: "Processes", exact: true })).toBeVisible();
  await 검색팔레트를연다(page);
  await page.keyboard.press("Meta+n");
  await expect(검색어칸(page)).toBeFocused();
  await expect(page).toHaveURL("/processes");
  await page.keyboard.press("Escape");
  await expect(검색어칸(page)).toHaveCount(0);
  // 팔레트가 닫힌 뒤에도 그 자리다 — ⌘N이 늦게 옮긴 것도 아니다.
  await expect(page).toHaveURL("/processes");

  // 확인 창 — 프로젝트 제거를 묻는 동안 ⌘N은 화면을 옮기지 않는다. 창을 닫으면(아니요) 먹는다.
  await page.goto(`/projects/${PROJECTS[0].slug}`);
  await 화면머리(page).getByRole("button", { name: "제거", exact: true }).click();
  const 확인 = page.getByRole("alertdialog");
  await expect(확인).toBeVisible();
  await page.keyboard.press("Meta+n");
  await expect(확인).toBeVisible();
  await expect(page).toHaveURL(`/projects/${PROJECTS[0].slug}`);
  await page.keyboard.press("Escape");
  await expect(확인).toHaveCount(0);
  await expect(page).toHaveURL(`/projects/${PROJECTS[0].slug}`);
  await 새Thread로간다("확인 창을 닫은 Projects");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **「내 차례」를 켠 동안 위 줄의 고른 줄은 그 하나다**(02 구현 스펙 §4 — 「그동안 행은 고른 모양이다. 다시 누르거나 다른 행을 고르면
// 돌아온다」). 지금 주소의 행(새 Thread · Library)은 고른 모양을 내려놓고, 그 둘 중 하나를 누르면 거르기가 풀려 그 행이 고른 줄이다. 다시
// 눌러 끄는 길과 기다리는 순서 목록은 `thread-waiting.spec.ts`가 잰다.
test("「내 차례」를 켠 동안 새 Thread · Library는 고른 모양을 내려놓고, 둘 중 하나를 누르면 거르기가 풀려 그 행이 고른 줄이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/");
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });
  const [새Thread, 내차례, Library] = [위줄(page, "새 Thread"), 위줄(page, "내 차례"), 위줄(page, "Library")];
  /** 세 행의 면 — 면은 색 전환(`transition-colors`)으로 바뀌어, 바뀐 뒤에는 전환이 끝날 때까지 기다려 읽는다. */
  const 면들 = async () => [await 면(새Thread), await 면(내차례), await 면(Library)];
  const 고른면 = await 면(새Thread);
  const 빈면 = "rgba(0, 0, 0, 0)";
  // 앵커: 첫 화면에서는 새 Thread가 고른 줄이다 — 고른 면이 빈 면과 다르다.
  expect(고른면, "새 Thread의 고른 면").not.toBe(빈면);
  expect([await 면(내차례), await 면(Library)]).toEqual([빈면, 빈면]);

  await 내차례.click();
  await expect(내차례).toHaveAttribute("aria-pressed", "true");
  await expect.poll(면들, { message: "켠 동안 — 내 차례만 고른 줄" }).toEqual([빈면, 고른면, 빈면]);

  // Library를 누르면 거르기가 풀리고 Library가 고른 줄이다.
  await Library.click();
  await expect(page).toHaveURL("/library");
  await expect(내차례).toHaveAttribute("aria-pressed", "false");
  await expect.poll(면들).toEqual([빈면, 빈면, 고른면]);

  // 다시 켜면 Library가 내려놓고, 새 Thread를 누르면 풀려 첫 화면이다.
  await 내차례.click();
  await expect(내차례).toHaveAttribute("aria-pressed", "true");
  await expect.poll(면들, { message: "켠 동안 Library가 내려놓는다" }).toEqual([빈면, 고른면, 빈면]);
  await 새Thread.click();
  await expect(page).toHaveURL("/");
  await expect(내차례).toHaveAttribute("aria-pressed", "false");
  await expect.poll(면들).toEqual([고른면, 빈면, 빈면]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── Work 줄의 상태 표시 하나 ─────────────────────────────────────────────────────────────────────────────────────

const twoTurns = record("thread-two-turns");
/** 둘째 턴이 도구를 다 돌리고 답 글을 내기 바로 앞 줄 — 그 뒤로 기록이 끊겼다(앱이 꺼졌다). 답 없이 끝난 턴이라 실패다. */
const CUT =
  twoTurns.find(
    (line) =>
      line.seq > seqOf(twoTurns, "sent", 2) &&
      (line.payload as { update?: { sessionUpdate?: string } }).update?.sessionUpdate === "agent_message_chunk",
  )!.seq - 1;
/** 그 Work에 이은, 실패한 Thread. */
const failedInWork = threadOf("20261025-090300", twoTurns, { live: false, lastSeq: CUT, work: plainWork.slug });

// **Work 줄 오른쪽 끝의 표시는 하나이고, 그 Work의 Thread들과 셸 가운데 가장 센 것이다**(02 구현 스펙 §4 · S8 · `work-mark.ts`) — 차례는
// 내 차례 › 도는 중 › 실패 › 새 결과다. 셸 신호는 그 차례의 자리로 옮겨 Thread와 함께 견준다: 답을 기다리는 셸은 내 차례라 실패한 Thread보다
// 세고, 끝났는데 안 본 셸은 새 결과라 실패한 Thread보다 약하며, 도는 셸은 표시가 없다. 고르는 표는 L2(`work-mark.test.ts`)가 잰다 — 여기는
// 두 출처(기록의 Thread · 셸 스토어)가 진짜 사이드바에서 한 표시로 모이는 한 바퀴다. 줄의 이름 꼬리가 그 표시의 말이다(`행버튼`).
test("Work 줄은 그 Work의 Thread와 셸 가운데 가장 센 상태 하나를 보인다 — 실패한 Thread 위에 셸이 부르면 내 차례, 셸이 돌거나 안 본 끝이면 실패", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(failedInWork)],
    thread_get: answerByArg("thread", { [failedInWork.id]: failedInWork }),
    thread_read_record: answerByArg("thread", { [failedInWork.id]: linesThrough(twoTurns, CUT) }),
  });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await expect(셸입력(page), "앵커: 셸에 포커스가 있다 — 아래 승인 키가 셸에 닿는다").toBeFocused();
  const 표시 = 줄표시(page, plainWork.slug);
  const 이름 = (말: string) => 행버튼(page, `${plainWork.title} — ${말}`);

  // 셸이 조용하다 — 이은 Thread가 실패라 줄이 실패다.
  await expect(표시).toHaveAttribute("data-mark", "failed");
  await expect(이름("실패")).toHaveCount(1);

  // 셸이 승인을 묻는다 — 나를 기다리는 셸이 실패한 Thread보다 세다.
  await markAttention(page, {
    agent: "claude",
    event: "PermissionRequest",
    at: Date.now(),
    payload: { tool_name: "Bash", tool_input: { command: "sleep 30" } },
  });
  await expect(표시).toHaveAttribute("data-mark", "mine");
  await expect(이름("내 차례")).toHaveCount(1);

  // 승인하면 셸이 돈다 — 도는 셸은 표시가 없어 Thread의 실패가 다시 선다. 앵커는 띠가 걷힌 것이다(기다림이 정말 풀렸다).
  await page.keyboard.press("1");
  await expect(띠(page)).toHaveCount(0);
  await expect(표시).toHaveAttribute("data-mark", "failed");

  // 셸에서 눈을 떼고 턴이 끝난다 — 안 본 끝은 새 결과라 실패한 Thread보다 약하다. 앵커는 띠의 「확인할 것」 줄이다(끝이 정말 닿았다).
  await page.locator('[data-tab="spec"]').click();
  await expect(page).not.toHaveURL(/tab=terminal/);
  await markAttention(page, {
    agent: "claude",
    event: "Stop",
    at: Date.now(),
    payload: { last_assistant_message: "다 했어요" },
    stopped: true,
  });
  await expect(띠(page).getByRole("button", { name: `${plainWork.title} — 확인할 것`, exact: true })).toHaveCount(1);
  await expect(표시).toHaveAttribute("data-mark", "failed");
  await expect(이름("실패")).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── Work 묶음 + ───────────────────────────────────────────────────────────────────────────────────────────────────

// **Work 묶음 머리 끝의 +는 「새 Work」다**(02 구현 스펙 §4 · S5) — 새 Thread를 열고 Work 칩을 「새 Work」로 둔 채 입력창에 놓는다(`/?new=work`).
// 머리를 접어도 선다. 목록의 Tab 정류장이 아니다(핀과 같다 — 키보드의 길은 ⌘N 뒤 Work 칩). **Work가 없으면** 머리 아래에 안내 한 줄이
// 선다(S6 — 12 · 3단계 색) — 그때도 +가 새 Work의 길이다. 칩의 갈래 · 고른 것이 첫 말과 함께 가는 것은 `thread-work-chip.spec.ts`가 잰다.
test("Work 묶음 머리 끝 +가 「새 Work」 새 Thread를 열고 — 머리를 접어도 서며 Tab 정류장이 아니다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/processes");
  const plus = 사이드바(page).getByRole("button", { name: "새 Work", exact: true });
  const 머리 = 사이드바(page).getByRole("button", { name: /^Work \d+$/ });
  await expect(plus).toBeVisible();
  await expect(plus).toHaveAttribute("tabindex", "-1");
  // + 는 머리 줄 오른쪽 끝에 겹쳐 선다 — 머리 단추 안이 아니다(단추 안의 단추가 아니다).
  expect(await plus.evaluate((el) => el.parentElement?.closest("button") === null)).toBe(true);
  const [head, mark] = [await boxOf(머리), await boxOf(plus)];
  expect(mark.y + mark.height / 2, "+ — 머리 줄 가운데").toBe(head.y + head.height / 2);

  // 머리를 접어도 + 는 선다.
  await 머리.click();
  await expect(머리).toHaveAttribute("aria-expanded", "false");
  await expect(plus).toBeVisible();

  await plus.click();
  await expect(page).toHaveURL("/?new=work");
  await expect(page.getByRole("button", { name: "어디서 일할지 새 Work", exact: true })).toBeVisible();
  await expect(첫화면(page)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Work가 없으면 Work 묶음 머리 아래에 안내 한 줄이 12 · 3단계 색으로 서고, + 는 그대로다", async ({ page }) => {
  await installFixtureBackend(page, { list_works: [] });
  await page.goto("/processes");
  const plus = 사이드바(page).getByRole("button", { name: "새 Work", exact: true });
  const 머리 = 사이드바(page).getByRole("button", { name: /^Work( \d+)?$/ });
  const 안내 = 사이드바(page).getByText("아직 Work가 없어요. 말로 시작하면 Host가 Work로 묶어 줘요.", { exact: true });
  await expect(안내).toBeVisible();
  expect(await 칠한값(안내, "font-size", "color"), "안내 글자").toEqual(["12px", await 토큰색(page, "--fg-tertiary")]);
  expect((await boxOf(안내)).y, "안내는 머리 아래").toBeGreaterThanOrEqual((await boxOf(머리)).bottom);
  await expect(plus).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 사람 메뉴 ─────────────────────────────────────────────────────────────────────────────────────────────────────

// **사람 메뉴**(02 구현 스펙 §4 · §5 · 스토리 31 · 32 · 35) — 사이드바 맨 아래 사람 줄을 누르면 지금 화면들로 가는 메뉴가 위로 뜬다. 메뉴는
// 사람 줄과 같은 폭으로 그 위 6에 서고(시안 「사람 메뉴」), 줄은 사이드바 줄과 같은 결이다 — 30 · 둥글기 8(`radius-md`) · 14 `fg-sidebar` ·
// 글리프 16 `fg-icon`, 구분선은 `separator`, 카드는 둥글기 12 · `shadow-menu`다. **메모리 합계는 메뉴의 `Processes` 줄 끝이다**(S12) — 한때
// 사람 줄 오른쪽에 늘 섰다(프로세스 결정 11). 사람 줄의 이름은 그대로다(메타가 이름에 안 섞인다). 합계 글자는 화면이 쓰는 표기 함수로
// 짓는다 — 픽스처의 기본 합계(3.4GB)가 아니라 이 시나리오의 값이다. `●`(손볼 것)는 `processes-nav-meta.spec.ts`가 잰다.
test("사람 메뉴가 사람 줄 폭으로 그 위 6에 뜨고 줄이 사이드바 줄의 결이며 — Processes 줄 끝에 앱 전체 메모리 합계가 선다", async ({
  page,
}) => {
  const summary = 요약({ total: 1_234_567_890 });
  await installFixtureBackend(page, { processes_summary: summary });
  await page.goto("/projects");
  await expect(page).toHaveURL(`/projects/${PROJECTS[0].slug}`);
  const total = formatMemory(summary.total);

  // 사람 줄 — 이름은 그대로이고 합계가 줄에 서지 않는다.
  await expect(사람줄(page)).toHaveAccessibleName("홍길동 — 사람 메뉴");
  await expect(사람줄(page)).not.toContainText(total);

  await 사람줄(page).click();
  const menu = page.getByRole("menu");
  await expect(사람메뉴항목(page)).toHaveText([/^Projects/, /^Terminal/, /^Processes/, /^Archive$/, /^Settings/]);
  await expect(사람메뉴항목(page).filter({ hasText: /^Processes/ })).toContainText(total);

  // 자리 — 사람 줄과 같은 폭, 그 위 6.
  const [foot, card] = [await boxOf(사람줄(page)), await boxOf(menu)];
  expect([card.x, card.width], "메뉴 — 사람 줄 폭").toEqual([foot.x, foot.width]);
  expect(foot.y - card.bottom, "사람 줄 위 6").toBe(6);
  // 카드 — 둥글기 12 · `shadow-menu`.
  const [radius, shadow] = await 칠한값(menu, "border-top-left-radius", "box-shadow");
  expect([radius, 그림자(shadow)], "카드").toEqual(["12px", await 토큰값(page, "box-shadow", "--shadow-menu")]);
  // 줄 — 30 · `radius-md` · 14 `fg-sidebar`, 글리프 16 `fg-icon`.
  const 줄값 = ["30px", await 토큰값(page, "border-top-left-radius", "--radius-md"), "14px", await 토큰색(page, "--fg-sidebar")];
  const 글리프값 = ["16px", "16px", await 토큰색(page, "--fg-icon")];
  expect(await 토큰색(page, "--fg-icon"), "DS 수 — #5d5f61").toBe("rgb(93, 95, 97)");
  for (const one of await 사람메뉴항목(page).all()) {
    const 이름 = await one.textContent();
    expect(await 칠한값(one, "height", "border-top-left-radius", "font-size", "color"), `「${이름}」 줄`).toEqual(줄값);
    expect(await 칠한값(one.locator("svg").first(), "width", "height", "color"), `「${이름}」 글리프`).toEqual(글리프값);
  }
  expect((await 칠한값(menu.getByRole("separator"), "background-color"))[0], "구분선").toBe(await 토큰색(page, "--separator"));
  // 켜진 줄 — 사이드바 · 사람 메뉴의 고른 면(`fill-nav-selected`)에 글자 `fg`다.
  await 사람메뉴항목(page).first().hover();
  await expect
    .poll(() => 칠한값(사람메뉴항목(page).first(), "background-color", "color"))
    .toEqual([await 토큰색(page, "--fill-nav-selected"), await 토큰색(page, "--fg")]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 머리 카드였던 화면들의 머리 줄 ──────────────────────────────────────────────────────────────────────────────

// codex-ds 티켓 14 · 02 티켓 03 — **어느 화면이든 머리 줄의 같은 자리에서 그 화면의 이름과 할 일을 찾는다**(codex-ds 스펙 §7 · 스토리 27 · 52 ·
// 59 · 60 · 02 구현 스펙 §3 S2). 한때 그 자리에 머리 카드가 떴다 — 카드의 겉만 버리고 안은 그대로 머리 줄에 바로 선다. 왼쪽은 그 화면 · 고른
// 것의 아이콘과 이름(과 그 안의 위치)이고, 오른쪽 끝은 그 화면의 머리 조작이다. 캔버스에만 있던 조작(Projects 「LLM이 받는 텍스트」 ·
// Processes 「새로 고침」 · 「고아 정리」 · Archive 「되살리기」)은 짓지 않았다(codex-ds 스펙 S13 · 결정 31). 조작은 역할 · 이름으로 집고, 모두
// 28로(아이콘 단추 · 글자 단추 — Thread 머리 줄과 한 벌, 02 티켓 03b) 머리 줄 가운데에 선다. 본문 칸에 고를 것이 남지 않은 화면은 본문 칸에
// 머리가 없다. 작업 화면의 머리 줄은 `frame.spec.ts`가 잰다.
const HEAD_SCREENS: {
  name: string;
  url: string;
  overrides?: Record<string, unknown>;
  /** 이름 상자 왼쪽 아이콘의 lucide 이름. */
  icon: string;
  /** 머리 줄에 보이는 이름과 그 뒤의 글자 — 왼쪽부터. 첫째는 이름이다. 날짜처럼 그리는 규칙이 따로 정하는 글자는 정규식이다. */
  words: readonly [string, ...(string | RegExp)[]];
  /** 이름 바로 뒤(`words`의 둘째)가 옅은 글자(`sub`)인가. */
  sub?: true;
  /** 이름이 누를 것인가(메뉴의 대상 · 그 자리 이름 바꾸기) — 포커스를 받고 창을 끌지 않는다. 아니면 보이기만 하는 글자라 창을 끈다. */
  target?: true;
  /** 머리 줄 화면 자리의 버튼 — 왼쪽부터, 이름으로. 이것뿐이다. */
  controls: readonly string[];
  /** 세로선이 서는 자리 — 이 이름의 버튼 바로 앞. 없으면 세로선이 없다. */
  splitBefore?: string;
  /** 캔버스에만 있어 짓지 않은 조작 — 화면 어디에도 없다. */
  absent: readonly string[];
}[] = [
  {
    name: "Projects",
    url: `/projects/${PROJECTS[0].slug}`,
    icon: "folder",
    words: [PROJECTS[0].name],
    target: true,
    controls: ["폴더 열기", "제거"],
    splitBefore: "제거",
    absent: ["LLM이 받는 텍스트"],
  },
  {
    name: "Archive",
    url: `/archive/${ARCHIVE[0].slug}`,
    icon: "zap",
    // 제목 뒤 옅은 글자는 걸쳤던 프로젝트와 치운 날이다 — 문서 칸의 머리 자리를 경로 줄이 가져 이리 왔다.
    words: [ARCHIVE[0].title, new RegExp(`^${ARCHIVE[0].projects.join(" · ")} · .+에 치움$`), ARCHIVE[0].status],
    sub: true,
    // 배지는 보이기만 한다 — 버튼이 아니다. 할 일은 ⋯ 아카이브 메뉴이고, 세로선 너머가 spec 목록 패널의 토글이다(codex-ds 티켓 21 —
    // 메뉴 안과 여닫기는 `archive-docs.spec.ts`).
    controls: ["아카이브 메뉴", "spec 목록 접기"],
    splitBefore: "spec 목록 접기",
    absent: ["되살리기"],
  },
  {
    name: "Processes",
    url: "/processes",
    icon: "activity",
    words: ["Processes"],
    controls: ["조용한 셸 모두 닫기"],
    absent: ["새로 고침", "고아 정리"],
  },
  {
    name: "Settings",
    url: "/settings/terminal",
    icon: "settings",
    words: ["Settings", "터미널"],
    sub: true,
    controls: ["저장"],
    absent: [],
  },
  {
    name: "레이아웃 편집기",
    url: SPEC_LAYOUT_EDITOR,
    icon: "settings",
    words: ["Settings", "spec 레이아웃", "Atelier"],
    sub: true,
    controls: ["설정으로 돌아가기", "LLM이 받는 텍스트", "저장"],
    absent: [],
  },
  { name: "Terminal", url: "/terminal", icon: "square-terminal", words: ["Terminal"], controls: [], absent: [] },
  {
    name: "Works(고른 작업 없음)",
    url: "/works",
    overrides: { list_works: [] },
    icon: "zap",
    words: ["Works"],
    controls: [],
    absent: [],
  },
];

for (const screen of HEAD_SCREENS) {
  test(`${screen.name}: 머리 줄 화면 자리에 그 화면의 이름과 할 일이 28로 서고, 캔버스에만 있던 조작은 없다`, async ({ page }) => {
    await installFixtureBackend(page, screen.overrides);
    await page.goto(screen.url);
    const head = 화면머리(page);
    await expect(head.getByText(screen.words[0], { exact: true })).toBeVisible();
    await expect(head).toHaveCount(1);

    // 왼쪽 — 아이콘 하나와 이름(그 뒤 위치)이 차례로 선다. 이름을 글자로 집으면 이름 상자(DS `.at-wtitle` — 아이콘 · 이름을 품는다)가
    // 잡혀, 이름 글자의 자리는 그 안 글자 마디로 잰다(`첫글자`).
    await expect(head.locator(`svg.lucide-${screen.icon}`)).toHaveCount(1);
    const iconBox = await boxOf(head.locator(`svg.lucide-${screen.icon}`));
    const words = await Promise.all(
      screen.words.map((word) => boxOf(head.getByText(word, typeof word === "string" ? { exact: true } : undefined))),
    );
    const nameText = await 첫글자(head.getByText(screen.words[0], { exact: true }));
    expect(nameText.x, "이름은 아이콘 뒤").toBeGreaterThan(iconBox.right);
    for (let at = 1; at < words.length; at += 1) {
      expect(words[at].x, `${screen.words[at]}가 앞 글자 뒤에 선다`).toBeGreaterThanOrEqual(words[at - 1].right);
    }
    // 이름 끝에서 그 뒤 옅은 글자(`sub`)까지는 DS 14다 — 이름 상자의 오른쪽 안쪽 8 + 위치의 왼쪽 6(DS `.at-wtitle` · `.at-winhead`의 사이 4 +
    // `.sub`의 왼쪽 2).
    if (screen.sub) expect(words[1].x - nameText.right, "이름 끝 → 위치").toBeCloseTo(14, 1);

    // 오른쪽 끝 — 할 일은 이 버튼들뿐이고 차례가 이렇다. 모두 28이고 머리 줄 가운데에, 화면 자리 안에 선다.
    const slot = await boxOf(head);
    const middle = slot.y + slot.height / 2;
    await expect(head.getByRole("button")).toHaveCount(screen.controls.length);
    const controls = await Promise.all(
      screen.controls.map((name) => boxOf(head.getByRole("button", { name, exact: true }))),
    );
    for (const [at, box] of controls.entries()) {
      const name = screen.controls[at];
      expect([box.height, box.y + box.height / 2], `${name} — 28 · 가운데 줄`).toEqual([28, middle]);
      expect(box.right, `${name}가 화면 자리 안`).toBeLessThanOrEqual(slot.right);
      if (at > 0) expect(box.x, `${name}가 앞의 것 뒤에 선다`).toBeGreaterThanOrEqual(controls[at - 1].right);
    }
    // 세로선은 할 일과 그 너머(보기 배치 · 위험한 할 일)를 가른다 — 그 자리에만 하나 선다.
    const separator = head.getByRole("separator");
    if (screen.splitBefore === undefined) {
      await expect(separator).toHaveCount(0);
    } else {
      const line = await boxOf(separator);
      const after = controls[screen.controls.indexOf(screen.splitBefore)];
      expect(line.right, "세로선 뒤가 그 버튼").toBeLessThanOrEqual(after.x);
      expect(line.x, "세로선 앞이 이름 · 할 일").toBeGreaterThanOrEqual(words[words.length - 1].right);
    }
    for (const name of screen.absent) {
      await expect(page.getByRole("button", { name, exact: true }), `${name}는 캔버스에만 있다`).toHaveCount(0);
    }

    // 창 끌기 — 머리 줄의 빈 자리와 보이기만 하는 것(아이콘 · 이름 · 위치 · 배지 글자)을 누르면 창이 끌린다. 누를 것(조작 · 메뉴가 있거나
    // 바꿀 수 있는 이름과 그 안의 아이콘)은 끌지 않는다.
    expect(await 끄는자리(page, iconBox.x + iconBox.width / 2, middle), "아이콘").toBe(!screen.target);
    for (const [at, box] of words.entries()) {
      const 끈다 = at === 0 ? !screen.target : true;
      expect(await 끄는자리(page, box.x + Math.min(4, box.width / 2), middle), `${screen.words[at]}`).toBe(끈다);
    }
    // 잠긴 버튼은 포인터를 안 받아(`Button` 머리말 — `disabled:pointer-events-none`) 누르면 그 아래 머리 줄이 잡힌다 — 빈 자리처럼
    // 끈다(Settings · 편집기의 바뀐 것 없는 [저장]).
    for (const [at, box] of controls.entries()) {
      const 잠김 = await head.getByRole("button", { name: screen.controls[at], exact: true }).isDisabled();
      expect(await 끄는자리(page, box.x + box.width / 2, middle), screen.controls[at]).toBe(잠김);
    }
    // 빈 자리 — 왼쪽 글자 끝과 할 일 묶음 앞 사이(묶음이 없으면 화면 자리 안쪽 오른쪽 끝 앞)와 화면 자리의 왼쪽 안쪽.
    const actions = head.locator("[data-head-actions]");
    const [padding] = await 칠한값(head, "padding-right");
    const 할일앞 = (await actions.count()) > 0 ? (await boxOf(actions)).x : slot.right - parseFloat(padding);
    const 글자끝 = Math.max(...words.filter((box) => box.x < 할일앞).map((box) => box.right));
    expect(할일앞 - 글자끝, "앵커: 글자와 할 일 사이에 빈 자리가 있다").toBeGreaterThan(8);
    expect(await 끄는자리(page, (글자끝 + 할일앞) / 2, middle), "화면 자리 안 빈 자리").toBe(true);
    expect(await 끄는자리(page, slot.x + 4, middle), "화면 자리 왼쪽 안").toBe(true);

    // 고를 것이 남지 않은 본문 칸에는 머리가 없다 — 위치와 할 일은 머리 줄이 말한다(목록 칸의 찾기 칸 · 머리는 `main` 밖이다).
    await expect(page.locator('main [data-slot="card-head"]')).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}
