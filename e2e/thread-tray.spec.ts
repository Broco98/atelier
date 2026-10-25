import { expect, test, type Locator, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD, SEARCH_RESULTS } from "./fixtures";
import { heldCalls, holdCommand, installFixtureBackend, ipcArgs, ipcCallArgs, releaseCommand, unknownIpcCalls, 칠한링 } from "./harness";
import { linesThrough, record, sentPayloads, seqOf, summaryOf } from "./thread-records";
import { PAYMENTS, REFUND, SCOPE_BY_SPACE, SCOPES, SETTLEMENT, TOOLS, WORLD } from "./thread-space-world";
import { HOST_MAKE } from "@/features/spaces/space-view";
import type { RecordLine, ThreadView } from "@/features/thread/types";

// 03 티켓 13 흐름 「트레이」(캔버스 v52 F4-KitComposer) — **입력창에 붙은 회색 띠에 Work 칩 · Space 칩 · 범위 줄이 서고, 첫 화면에서는 상자
// 아래 · 첫 말 뒤에는 상자 위에 선다. Space 칩은 Work 칩과 따로 읽을 Space를 고르고(관문이 아니다), 범위 줄이 지금 읽는 Project를 한 줄로
// 말한다. 입력창 안은 + · 물어보는 정도 · 모델 칩뿐이다**(03 구현 스펙 §5 · §6 · 티켓 02 · 06 · S2–S5 · 스토리 14–42). 상황 모음판의 칸이
// 곧 경우다 — 같은 것을 두 번 재지 않는다.
//
//   여기서 잰다     두 자리(상자 아래 · 위의 기하 · 칩 차례 · 칩 모양) · 잠김(보내는 동안 · 첫 말 뒤의 칩 셋 — 이은 Work · Work 없이 대화 ·
//                   흐린 새 Work, 이은 Work 칩이 그 Work로) · Space 칩 메뉴(Space 없음 · 목록 · Space 관리 · 없을 때 Host와 만들기) · × ·
//                   ▾(그 Work의 Space) · 빈 Space · Space 없음 · 범위 줄 넷 · 고른 Space가 첫 말과 함께 감 · 첫 말 뒤의 Space 칩 · 씨앗
//                   (`?new=` · `?work=` · `?space=` · `?say=`) · `@` 단추 없음 · `/agent` 없음 · 입력이 있으면 짙은 보내기
//   다른 spec이 잰다 Work 칩 메뉴의 스위치 둘 · 최근 Work · 기억 · 정도 칩(`thread-work-chip`) · Work 만들기 카드를 받아들인 뒤의 잠긴 칩
//                   (`thread-work`) · 글로 친 `@`의 Agent 메뉴(`thread-mention`) · 흐름의 Space 줄과 머리 줄의 Space(흐름 「대화 속 Space와
//                   설정」 — `thread-space-setting`)
//
// 세계는 시안의 Project 셋 · Space 셋 · Work 넷이다(`thread-space-world`). 읽는 범위는 core가 짓는 모양을 그 세계로 적어 둔 답이고, 이 층은
// 그 답을 화면이 그대로 말하는지와 고른 것이 그 인자로 나가는지를 잰다(범위를 세는 규칙은 L1 `reading_scope` · `thread_space.rs`의 몫).
// 기하는 시안 창(1440 × 900)에서 잰다.

test.use({ viewport: { width: 1440, height: 900 } });

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
/** 입력창 — 보낼 말 칸을 싼 둘레 카드(`form`)다. 트레이의 자리는 이것과 견준다. */
const 입력창 = (page: Page) => 입력칸(page).locator("xpath=ancestor::form[1]");
const 첫화면 = (page: Page) => page.getByRole("heading", { name: "무엇을 만들까요?", exact: true });
const 트레이 = (page: Page) => page.locator('[data-slot="composer-tray"]');
const 워크칩 = (page: Page, name: string) => page.getByRole("button", { name: `어디서 일할지 ${name}`, exact: true });
/** 첫 말 뒤의 잠긴 Work 칩 — 이은 Work만 단추다. */
const 잠긴칩 = (page: Page) => 트레이(page).locator('[data-slot="work-chip"]');
/** 비어 있는 Space 칩 — 흐린 「Space 넣기」. */
const 빈칩 = (page: Page) => 트레이(page).getByRole("button", { name: "Space 넣기", exact: true });
/** 고른 Space 칩 — 흰 면 안에 이름 단추와(Work 없는 쪽이면) × 단추가 선다. */
const 고른칩 = (page: Page) => 트레이(page).locator('[data-slot="space-chip"]');
const 이름칩 = (page: Page, name: string) => 트레이(page).getByRole("button", { name: `Space: ${name}`, exact: true });
const 빼기 = (page: Page) => 트레이(page).getByRole("button", { name: "Space 빼기", exact: true });
const 범위줄 = (page: Page) => 트레이(page).locator('[data-slot="scope-line"]');
const 메뉴 = (page: Page) => page.getByRole("menu");
const 갈래 = (page: Page, name: string) => 메뉴(page).getByRole("menuitemradio", { name, exact: true });

type Box = { x: number; y: number; width: number; height: number; right: number; bottom: number };
const 상자 = (target: Locator): Promise<Box> =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });
const 모양 = (target: Locator, props: readonly string[]) =>
  target.evaluate((el, names) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
  }, props);

/** 트레이 띠의 칠 · 안쪽 · 둥글기(시안 `.tray` · `.tray.up`). */
const BAND = [
  "background-color",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
] as const;

/** 시안의 세계(`WORLD`)에 범위를 더한다 — 입력창이 쥔 Space로 범위를 세면(`reading_scope`의 `space`) 그 Space의 범위, 쥔 것이 없으면 전부다. */
const TRAY_WORLD = {
  ...WORLD,
  reading_scope: answerByArg("space", SCOPE_BY_SPACE, { otherwise: SCOPES.all }),
};

/** 답만 한 첫 턴(`thread-two-turns`) — 첫 말로 막 선 Thread가 그 첫 `sent`까지다. */
const twoTurns = record("thread-two-turns");
const [first] = sentPayloads(twoTurns);
const FIRST_SENT = seqOf(twoTurns, "sent");

/** 그 Thread들을 열 수 있게 답한다 — 목록 · 읽기 · 읽은 자리. 더 덮어쓸 답은 함께 준다. */
async function withThreads(page: Page, views: readonly ThreadView[], lines: readonly RecordLine[], more: Record<string, unknown> = {}) {
  const byId = <T>(of: (view: ThreadView) => T) => Object.fromEntries(views.map((view) => [view.id, of(view)]));
  await installFixtureBackend(page, {
    ...TRAY_WORLD,
    thread_list: views.map(summaryOf),
    thread_get: answerByArg("thread", byId((view) => view)),
    thread_read_record: answerByArg("thread", byId(() => lines)),
    thread_mark_read: answerByArg("thread", byId((view) => ({ ...summaryOf(view), lastRead: view.lastSeq }))),
    ...more,
  });
}

/** 첫 화면을 연다. **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다. */
async function openHome(page: Page, url = "/") {
  await page.goto(url);
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });
}

/** 범위를 센 자리 — 입력창이 쥔 Work · Space(또는 연 Thread)로 부른 `reading_scope`의 인자들. */
const scopeAsks = (page: Page) => ipcArgs(page, "reading_scope", "space");

test("두 자리 — 첫 화면의 트레이는 입력창 상자 아래에, 첫 말을 보내면 상자 위에 서서 잠기고, 칩은 Work · Space · 범위 줄 차례다", async ({
  page,
}) => {
  // 첫 말을 받은 Thread — 「새 Work」로 시작해 아직 Work가 서지 않았다(`newWork`). 시작을 붙잡아 보내는 동안의 트레이를 본다.
  const started: ThreadView = { ...FIXTURE_THREAD, title: first.text, live: true, lastSeq: FIRST_SENT, newWork: true };
  await withThreads(page, [started], linesThrough(twoTurns, FIRST_SENT));
  await holdCommand(page, "thread_start");
  await openHome(page);

  // 상자 아래(시안 `.tray` — margin -2 14 0 · padding 10 8 6 · #f4f4f4 · 아래 둥글기 15). 칩은 트레이 안에 Work 칩 → Space 칩 → 범위 줄
  // 차례로 서고, 칩 사이 4 · 범위 줄은 4를 더 띄운다(`.scope{margin-left:4px}`). 칩은 26 높이다.
  const tray = 트레이(page);
  await expect(범위줄(page)).toHaveText("등록된 Project 3개를 읽어요");
  const [below, composer] = [await 상자(tray), await 상자(입력창(page))];
  expect(composer.bottom - below.y).toBeCloseTo(2, 0);
  expect([below.x - composer.x, composer.right - below.right]).toEqual([14, 14]);
  expect(await 모양(tray, BAND)).toEqual({
    "background-color": "rgb(244, 244, 244)",
    "padding-top": "10px",
    "padding-right": "8px",
    "padding-bottom": "6px",
    "padding-left": "8px",
    "border-top-left-radius": "0px",
    "border-top-right-radius": "0px",
    "border-bottom-left-radius": "15px",
    "border-bottom-right-radius": "15px",
  });
  expect(
    await tray.evaluate((el) => [...el.children].map((one) => one.getAttribute("aria-label") ?? one.getAttribute("data-slot"))),
  ).toEqual(["어디서 일할지 새 Work", "Space 넣기", "scope-line"]);
  const [workChip, spaceChip, scope] = [await 상자(워크칩(page, "새 Work")), await 상자(빈칩(page)), await 상자(범위줄(page))];
  expect([workChip.height, spaceChip.height]).toEqual([26, 26]);
  expect(spaceChip.x - workChip.right).toBeCloseTo(4, 0);
  expect(scope.x - spaceChip.right).toBeCloseTo(8, 0);
  // 칩의 글자 — 고르는 Work 칩은 본문색, 흐린 「Space 넣기」는 45%(`.tc.ghost`), 범위 줄은 12 · 옅은 글자(시안 12.5 · 49.5% — 글자 단계에 없다).
  expect(await 모양(워크칩(page, "새 Work"), ["font-size", "color"])).toEqual({ "font-size": "13px", color: "rgb(26, 28, 31)" });
  expect(await 모양(빈칩(page), ["color"])).toEqual({ color: "rgba(26, 28, 31, 0.45)" });
  expect(await 모양(범위줄(page), ["font-size", "color"])).toEqual({ "font-size": "12px", color: "rgba(26, 28, 31, 0.5)" });
  // Work 칩은 입력창 상자 안이 아니다(03 §5).
  await expect(입력창(page).getByRole("button", { name: /^어디서 일할지/ })).toHaveCount(0);

  // 보내는 동안 — 입력창이 바닥으로 내려가고 트레이는 상자 위로 옮겨 잠긴다. Work 칩은 흐린 「새 Work」(아직 Work가 서지 않았다 — S3)이고,
  // Space 칩은 Session이 열릴 때까지 고르지 못한다.
  await 입력칸(page).fill(first.text);
  await 입력칸(page).press("Enter");
  await expect.poll(() => heldCalls(page, "thread_start")).toBe(1);
  await expect(잠긴칩(page)).toHaveText("새 Work");
  await expect(빈칩(page)).toBeDisabled();
  await expect(워크칩(page, "새 Work")).toHaveCount(0);

  /** 상자 위(시안 `.tray.up` — margin 0 14 -2 · padding 6 8 10 · 위 둥글기 15). */
  const sitsAbove = async () => {
    const [above, box] = [await 상자(tray), await 상자(입력창(page))];
    expect(above.bottom - box.y).toBeCloseTo(2, 0);
    expect([above.x - box.x, box.right - above.right]).toEqual([14, 14]);
    expect(await 모양(tray, BAND)).toEqual({
      "background-color": "rgb(244, 244, 244)",
      "padding-top": "6px",
      "padding-right": "8px",
      "padding-bottom": "10px",
      "padding-left": "8px",
      "border-top-left-radius": "15px",
      "border-top-right-radius": "15px",
      "border-bottom-left-radius": "0px",
      "border-bottom-right-radius": "0px",
    });
  };
  await expect.poll(async () => Math.round((await 상자(입력창(page))).bottom)).toBeGreaterThan(800);
  await sitsAbove();

  // Session이 열려 Thread 화면이 서도 트레이는 상자 위 그 자리다. 흐린 「새 Work」(45% — `.tc.ghost`)는 그대로이고 누를 것이 없으며, Space
  // 칩은 이제 다시 고른다(첫 말 뒤에도 — F4-KitComposer 「Work 없이 · Space 없음」).
  await releaseCommand(page, "thread_start");
  await expect(page).toHaveURL(`/threads/${started.id}`);
  await expect(page.getByRole("main", { name: started.title, exact: true })).toBeVisible();
  await sitsAbove();
  await expect(잠긴칩(page)).toHaveText("새 Work");
  expect(await 모양(잠긴칩(page), ["color"])).toEqual({ color: "rgba(26, 28, 31, 0.45)" });
  await expect(잠긴칩(page).getByRole("button")).toHaveCount(0);
  await expect(빈칩(page)).toBeEnabled();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Space 칩 — 메뉴에서 고른 Space는 흰 칩 + ×가 되어 범위 줄이 그 Project를 말하고, ×가 빼며, 빈 Space는 경고 한 줄이고, 고른 것이 첫 말과 함께 간다", async ({
  page,
}) => {
  await withThreads(page, [{ ...FIXTURE_THREAD, live: true, lastSeq: FIRST_SENT }], linesThrough(twoTurns, FIRST_SENT));
  await openHome(page);

  // 처음 쓰는 사람(F4-KitComposer 「기본」) — 새 Work · 흐린 「Space 넣기」 · 등록된 Project 전부를 읽는다.
  await expect(워크칩(page, "새 Work")).toBeVisible();
  await expect(빈칩(page)).toBeVisible();
  await expect(범위줄(page)).toHaveText("등록된 Project 3개를 읽어요");

  // Space 칩 메뉴(「Space 칩 메뉴」) — 칩 아래로 트레이 밖 6에 연다. 맨 위는 늘 「Space 없음 — 등록된 Project 3개 읽기」(지금이 없음이면 ✓),
  // 구분선 아래 「Space — 고르면 그 안의 Project만 읽어요」와 Space마다 읽는 Project(없으면 「Project 없음」), 끝에 「Space 관리 · 메뉴 › Space」다.
  await 빈칩(page).click();
  await expect(메뉴(page)).toBeVisible();
  expect((await 상자(메뉴(page))).y - (await 상자(트레이(page))).bottom).toBeCloseTo(6, 0);
  await expect(메뉴(page).getByRole("menuitemradio")).toHaveText([
    "Space 없음등록된 Project 3개 읽기",
    "결제 서비스web-app · api-server",
    "사내 도구api-server · backoffice",
    "정산Project 없음",
  ]);
  await expect(갈래(page, "Space 없음")).toHaveAttribute("aria-checked", "true");
  await expect(갈래(page, "Space 없음")).toHaveAccessibleDescription("등록된 Project 3개 읽기");
  await expect(메뉴(page).getByRole("group", { name: "Space — 고르면 그 안의 Project만 읽어요", exact: true })).toBeVisible();
  await expect(갈래(page, PAYMENTS.name)).toHaveAccessibleDescription("web-app · api-server");
  await expect(메뉴(page).getByRole("menuitem")).toHaveText(["Space 관리메뉴 › Space"]);
  await expect(메뉴(page).getByRole("menuitem", { name: "Space 관리", exact: true })).toHaveAccessibleDescription("메뉴 › Space");

  // Space를 고름(「Space를 고름」) — 흰 면 + 0.5 고리(14%)의 칩에 이름과 ×가 서고, 범위 줄이 그 Space의 Project를 말한다. 범위는 쥔 Space로
  // 센다 — 아직 Thread가 없다.
  await 갈래(page, PAYMENTS.name).click();
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await expect(빼기(page)).toBeVisible();
  await expect(빈칩(page)).toHaveCount(0);
  await expect(범위줄(page)).toHaveText("web-app · api-server를 읽어요");
  expect(await 모양(고른칩(page), ["background-color"])).toEqual({ "background-color": "rgb(255, 255, 255)" });
  expect(await 칠한링(고른칩(page))).toEqual(["rgba(26, 28, 31, 0.14) 0px 0px 0px 0.5px"]);
  expect((await 상자(고른칩(page))).height).toBe(26);
  expect(await scopeAsks(page)).toContainEqual({ thread: null, work: null, space: PAYMENTS.slug });
  await 이름칩(page, PAYMENTS.name).click();
  await expect(갈래(page, PAYMENTS.name)).toHaveAttribute("aria-checked", "true");
  await expect(갈래(page, "Space 없음")).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(메뉴(page)).toHaveCount(0);

  // × — 빼면 다시 흐린 「Space 넣기」이고 등록된 전부를 읽는다.
  await 빼기(page).click();
  await expect(빈칩(page)).toBeVisible();
  await expect(고른칩(page)).toHaveCount(0);
  await expect(범위줄(page)).toHaveText("등록된 Project 3개를 읽어요");

  // 빈 Space(「빈 Space를 고름」) — 막지 않고 범위 줄이 경고 색(#9a5b00) 한 줄로 알린다.
  await 빈칩(page).click();
  await 갈래(page, SETTLEMENT.name).click();
  await expect(이름칩(page, SETTLEMENT.name)).toBeVisible();
  await expect(범위줄(page)).toHaveText("읽는 Project가 없어요 — Space에 Project를 넣어 주세요");
  expect(await 모양(범위줄(page), ["color"])).toEqual({ color: "rgb(154, 91, 0)" });

  // Work 칩과 Space 칩은 따로 고른다 — 스위치를 「Work 없이 대화」로 바꿔도 쥔 Space는 남는다(03 결정 「06」 — 입력창이 쥐는 Space는 둘이다).
  await 워크칩(page, "새 Work").click();
  await 메뉴(page).getByRole("menuitemradio", { name: "Work 없이 대화", exact: true }).click();
  await expect(이름칩(page, SETTLEMENT.name)).toBeVisible();

  // 고른 Space는 첫 말과 함께 간다 — 시작 명령의 `space` 하나로(S4). 첫 말 전에 고른 것이라 흐름에 Space 줄이 서지 않는다(엔진 — L1).
  await 입력칸(page).fill(first.text);
  await 입력칸(page).press("Enter");
  await expect(page).toHaveURL(`/threads/${FIXTURE_THREAD.id}`);
  expect(await ipcArgs(page, "thread_start", "text")).toEqual([
    { text: first.text, attachments: [], link: { kind: "no-work" }, mode: null, model: null, effort: null, space: { slug: SETTLEMENT.slug } },
  ]);
  expect(await ipcCallArgs(page, "thread_set_space", "thread")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("최근 Work를 고르면 Space 칩은 그 Work의 Space(× 없이 ▾)이고, 메뉴에서 바꾼 것 · 뺀 것이 첫 말 때 그 Work에 가도록 함께 간다", async ({
  page,
}) => {
  const linked: ThreadView = { ...FIXTURE_THREAD, work: REFUND.slug, live: true, lastSeq: FIRST_SENT };
  await withThreads(page, [linked], linesThrough(twoTurns, FIRST_SENT));
  await openHome(page);

  // 최근 Work를 고름(「최근 Work를 고름」) — 칩은 그 Work의 Space이고 끝이 ×가 아니라 ▾다(빼기도 메뉴에서만). 범위는 그 Work와 그 Space로 센다.
  await 워크칩(page, "새 Work").click();
  await 메뉴(page).getByRole("menuitemradio", { name: REFUND.title, exact: true }).click();
  await expect(워크칩(page, REFUND.title)).toBeVisible();
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await expect(이름칩(page, PAYMENTS.name).locator("svg")).toHaveCount(2);
  await expect(빼기(page)).toHaveCount(0);
  await expect(범위줄(page)).toHaveText("web-app · api-server를 읽어요");
  await expect.poll(() => scopeAsks(page)).toContainEqual({ thread: null, work: REFUND.slug, space: PAYMENTS.slug });

  // 메뉴에서 바꾸면 칩 · 범위 줄이 따라오지만 그 Work의 파일은 그대로다 — 보낼 때 적는다(메뉴를 훑다 버린 입력이 Work를 바꾸지 않게, S4).
  await 이름칩(page, PAYMENTS.name).click();
  await expect(갈래(page, "Space 없음")).toHaveAttribute("aria-checked", "false");
  await 갈래(page, TOOLS.name).click();
  await expect(이름칩(page, TOOLS.name)).toBeVisible();
  await expect(범위줄(page)).toHaveText("api-server · backoffice를 읽어요");
  expect(await ipcCallArgs(page, "thread_set_work_space", "work")).toEqual([]);
  await 입력칸(page).fill("환불 버튼 문구를 고쳐 줘");
  await 입력칸(page).press("Enter");
  await expect(page).toHaveURL(`/threads/${linked.id}`);
  await expect(page.getByRole("main", { name: linked.title, exact: true })).toBeVisible();

  // 다시 연 첫 화면 — 그 Work를 고르면 칩은 다시 그 Work의 지금 Space다(바꾼 것은 그 첫 말과 함께 떠났다). 「Space 없음」을 고르면 칩이 흐린
  // 「Space 넣기」가 되고, 그 뺌도 첫 말과 함께 간다(`{slug: null}` — 고르지 않은 `null`과 다르다).
  await page.locator("aside[data-sidebar]").getByRole("button", { name: "새 Thread", exact: true }).click();
  await expect(첫화면(page)).toBeVisible();
  await 워크칩(page, "새 Work").click();
  await 메뉴(page).getByRole("menuitemradio", { name: REFUND.title, exact: true }).click();
  await 이름칩(page, PAYMENTS.name).click();
  await 갈래(page, "Space 없음").click();
  await expect(빈칩(page)).toBeVisible();
  await expect(범위줄(page)).toHaveText("등록된 Project 3개를 읽어요");
  await 입력칸(page).fill("결제 실패 문구도 봐 줘");
  await 입력칸(page).press("Enter");
  await expect(page).toHaveURL(`/threads/${linked.id}`);
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => [args.link, args.space])).toEqual([
    [{ kind: "work", slug: REFUND.slug }, { slug: TOOLS.slug }],
    [{ kind: "work", slug: REFUND.slug }, { slug: null }],
  ]);
  expect(await ipcCallArgs(page, "thread_set_work_space", "work")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("첫 말 뒤 — Work 칩은 잠겨 보이기만 하고(이은 Work만 그 Work로 가는 단추), Space 칩은 상자 위에서 계속 바꾼다: Work면 ▾ 메뉴로 그 Work의 Space를, Work 없이면 × · 「Space 넣기」로", async ({
  page,
}) => {
  const opened = { live: true, lastSeq: FIRST_SENT };
  const inWork: ThreadView = { ...FIXTURE_THREAD, ...opened, id: "20261020-090000", title: "환불 금액 확인", work: REFUND.slug };
  const loose: ThreadView = { ...FIXTURE_THREAD, ...opened, id: "20261021-090000", title: "결제 수단 정리" };
  const spaced: ThreadView = { ...FIXTURE_THREAD, ...opened, id: "20261022-090000", title: "checkout 같이 보기", space: PAYMENTS.slug };
  await withThreads(page, [inWork, loose, spaced], linesThrough(twoTurns, FIRST_SENT), {
    reading_scope: answerByArg("thread", { [inWork.id]: SCOPES.payments, [spaced.id]: SCOPES.payments }, { otherwise: SCOPES.all }),
  });

  // Work로 시작한 대화(「첫 말 뒤」 첫 칸) — 잠긴 칩은 그 Work 이름(60% — `.tc.lock`)이고 누르면 그 Work 화면이다. Space 칩은 그 Work의 Space(▾)다.
  await page.goto(`/threads/${inWork.id}`);
  await expect(page.getByRole("main", { name: inWork.title, exact: true })).toBeVisible({ timeout: 20_000 });
  const toWork = 잠긴칩(page);
  await expect(toWork).toHaveAccessibleName(`Work로 가기: ${REFUND.title}`);
  await expect(toWork).toHaveText(REFUND.title);
  expect(await 모양(toWork, ["color"])).toEqual({ color: "rgba(26, 28, 31, 0.6)" });
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await expect(빼기(page)).toHaveCount(0);
  await expect(범위줄(page)).toHaveText("web-app · api-server를 읽어요");

  // 상자 위 트레이의 메뉴는 위로 연다(트레이 위 6). 고르면 곧바로 적힌다 — 이은 Work의 Space가 바뀐다(엔진 — 스토리 42, 줄은 L1).
  await 이름칩(page, PAYMENTS.name).click();
  await expect(메뉴(page)).toBeVisible();
  expect((await 상자(트레이(page))).y - (await 상자(메뉴(page))).bottom).toBeCloseTo(6, 0);
  await 갈래(page, TOOLS.name).click();
  await expect
    .poll(() => ipcArgs(page, "thread_set_space", "thread"))
    .toEqual([{ thread: inWork.id, space: TOOLS.slug }]);

  // Work 없이 · Space 없음(「Work 없이 · Space 없음」) — 잠긴 칩 「Work 없이 대화」는 글일 뿐이다. 흐린 「Space 넣기」는 그대로 누를 수 있다.
  await page.goto(`/threads/${loose.id}`);
  await expect(page.getByRole("main", { name: loose.title, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(잠긴칩(page)).toHaveText("Work 없이 대화");
  await expect(잠긴칩(page).getByRole("button")).toHaveCount(0);
  await expect(트레이(page).getByRole("button", { name: /^Work로 가기/ })).toHaveCount(0);
  expect(await 모양(잠긴칩(page), ["color"])).toEqual({ color: "rgba(26, 28, 31, 0.6)" });
  await expect(범위줄(page)).toHaveText("등록된 Project 3개를 읽어요");
  await 빈칩(page).click();
  await 갈래(page, PAYMENTS.name).click();
  await expect
    .poll(() => ipcArgs(page, "thread_set_space", "thread"))
    .toEqual([{ thread: loose.id, space: PAYMENTS.slug }]);

  // Work 없이 한 대화에 Space가 있으면(「Work 없이 한 대화」) 칩은 ×다 — 빼면 곧바로 적힌다. 메뉴의 「Space 관리」는 Space 목록으로 간다.
  await page.goto(`/threads/${spaced.id}`);
  await expect(page.getByRole("main", { name: spaced.title, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await 빼기(page).click();
  await expect
    .poll(() => ipcArgs(page, "thread_set_space", "thread"))
    .toEqual([{ thread: spaced.id, space: null }]);
  await 이름칩(page, PAYMENTS.name).click();
  await 메뉴(page).getByRole("menuitem", { name: /^Space 관리/ }).click();
  await expect(page).toHaveURL("/spaces");
  await expect(page.getByRole("main").getByText(TOOLS.name, { exact: true }).first()).toBeVisible();

  // 이은 Work의 잠긴 칩을 누르면 그 Work 화면이다(S3).
  await page.goto(`/threads/${inWork.id}`);
  await expect(page.getByRole("main", { name: inWork.title, exact: true })).toBeVisible({ timeout: 20_000 });
  await 잠긴칩(page).click();
  await expect(page).toHaveURL(new RegExp(`/works/${REFUND.slug}`));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("등록된 Project가 없으면 범위 줄이 경고 색 「등록된 Project가 없어요 · Project 추가」로 추가 창을 열고, Space가 없으면 Space 칩 메뉴가 「Host와 Space 만들기」로 이끈다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    ...TRAY_WORLD,
    list_projects: [],
    list_spaces: [],
    list_works: [],
    search: answerByArg("query", { "": { hits: [] } }, { otherwise: SEARCH_RESULTS }),
    reading_scope: SCOPES.none,
  });
  await openHome(page);

  // 등록된 Project가 없음(「등록된 Project가 없음」) — 그래도 대화는 된다. 범위 줄은 경고 색이고 끝의 「Project 추가」(#2c67c5)가 추가 창을 연다.
  await expect(범위줄(page)).toHaveText("등록된 Project가 없어요 · Project 추가");
  expect(await 모양(범위줄(page), ["color"])).toEqual({ color: "rgb(154, 91, 0)" });
  const add = 범위줄(page).getByRole("button", { name: "Project 추가", exact: true });
  expect(await 모양(add, ["color"])).toEqual({ color: "rgb(44, 103, 197)" });
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Project 추가", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(입력칸(page)).toBeEnabled();

  // Space 칩 메뉴 — Space가 없을 때(「Space 칩 메뉴 — Space가 없을 때」): 맨 위 「Space 없음」의 곁말은 등록된 Project가 없다고 말하고, 목록
  // 자리에 「아직 Space가 없어요」 · 「Host와 Space 만들기」가 선다. 고르면 첫 화면이 「Work 없이 대화」와 맡기는 말을 든 채 다시 선다 —
  // 보내는 것은 사람이다(S16).
  await 빈칩(page).click();
  await expect(갈래(page, "Space 없음")).toHaveAccessibleDescription("등록된 Project가 없어요");
  await expect(메뉴(page).getByText("아직 Space가 없어요", { exact: true })).toBeVisible();
  await expect(메뉴(page).getByRole("menuitemradio")).toHaveCount(1);
  const make = 메뉴(page).getByRole("menuitem", { name: "Host와 Space 만들기", exact: true });
  await expect(make).toHaveAccessibleDescription("Host가 Project를 읽고 초안을 내요");
  await make.click();
  await expect.poll(() => new URL(page.url()).searchParams.get("say")).toBe(HOST_MAKE.say);
  expect(new URL(page.url()).searchParams.get("new")).toBe("thread");
  await expect(워크칩(page, "Work 없이 대화")).toBeVisible();
  await expect(입력칸(page)).toHaveValue(HOST_MAKE.say!);
  expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("씨앗 — 주소의 `?new=` · `?work=` · `?space=` · `?say=`가 처음 고를 Work 칩 · Space 칩 · 입력 글이 되고, 보내지는 않는다", async ({
  page,
}) => {
  const linked: ThreadView = { ...FIXTURE_THREAD, work: REFUND.slug, live: true, lastSeq: FIRST_SENT };
  await withThreads(page, [linked], linesThrough(twoTurns, FIRST_SENT));
  const at = (search: Record<string, string>) => `/?${new URLSearchParams(search)}`;

  // Space 상세의 「새 Work」(`?new=work&space=`) — 새 Work와 그 Space(×)를 고른 채 선다(F4-KitComposer 「Space를 고름」 칸의 곁말).
  await openHome(page, at({ new: "work", space: PAYMENTS.slug }));
  await expect(워크칩(page, "새 Work")).toBeVisible();
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await expect(빼기(page)).toBeVisible();
  await expect(범위줄(page)).toHaveText("web-app · api-server를 읽어요");

  // Space 상세의 「Host와 고치기」(`?new=thread&space=&say=`) — Work 없이 대화 · 그 Space · 맡기는 말이 입력칸에 들고, 보내지 않는다.
  const say = `${PAYMENTS.name} Space를 고치고 싶어요. `;
  await openHome(page, at({ new: "thread", space: PAYMENTS.slug, say }));
  await expect(워크칩(page, "Work 없이 대화")).toBeVisible();
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await expect(입력칸(page)).toHaveValue(say);
  await expect(입력칸(page)).toBeFocused();

  // 씨앗 Space 하나(`?space=`) — Work 칩은 기억한 쪽(없으면 새 Work)이고 그 Space를 쥔다. 빈 Space면 경고 한 줄이다.
  await openHome(page, at({ space: SETTLEMENT.slug }));
  await expect(워크칩(page, "새 Work")).toBeVisible();
  await expect(이름칩(page, SETTLEMENT.name)).toBeVisible();
  await expect(범위줄(page)).toHaveText("읽는 Project가 없어요 — Space에 Project를 넣어 주세요");

  // Work와 Space를 함께(`?work=&space=`) — 그 Work의 Space를 바꾼 것으로 쥔다(▾). 보내면 그 Space가 첫 말과 함께 그 Work로 간다.
  await openHome(page, at({ work: REFUND.slug, space: TOOLS.slug }));
  await expect(워크칩(page, REFUND.title)).toBeVisible();
  await expect(이름칩(page, TOOLS.name)).toBeVisible();
  await expect(빼기(page)).toHaveCount(0);
  expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);
  await 입력칸(page).fill("배포 전에 볼 것 정리해 줘");
  await 입력칸(page).press("Enter");
  await expect(page).toHaveURL(`/threads/${linked.id}`);
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => [args.link, args.space])).toEqual([
    [{ kind: "work", slug: REFUND.slug }, { slug: TOOLS.slug }],
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("입력창 안은 + · 물어보는 정도 · 모델 칩 · 보내기뿐이다 — `@` 단추도 `/agent` 명령도 없고, 입력이 있으면 보내기가 짙어진다", async ({
  page,
}) => {
  await installFixtureBackend(page, TRAY_WORLD);
  await openHome(page);

  // 입력창 상자 안의 단추(F4-KitComposer 머리말 — 「입력창 안은 + · 물어보는 정도 · 모델 칩뿐」). `@` 단추(Agent 부르기)는 Agent 여럿과
  // 함께 채팅이 들어올 때까지 뺐다(03 §6 · S5).
  const buttons = 입력창(page).getByRole("button");
  await expect(buttons).toHaveCount(4);
  expect(await buttons.evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")))).toEqual([
    "파일 첨부",
    "물어보는 정도 매번 묻기",
    expect.stringMatching(/^모델과 생각 깊이 /),
    "보내기",
  ]);
  await expect(page.getByRole("button", { name: "Agent 부르기", exact: true })).toHaveCount(0);

  // 「/」 명령 메뉴에도 `/agent`가 없다 — 첫 말 전이라 `/work`는 선다.
  await 입력칸(page).fill("/");
  const commands = page.getByRole("listbox", { name: "명령", exact: true }).getByRole("option");
  await expect(commands.filter({ hasText: "/work" })).toHaveCount(1);
  expect(await commands.evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")))).not.toContain("/agent");

  // 보내기(「보내는 중」 칸 — 입력이 있으면 파란 보내기) — 빈 입력이면 옅고(40%) 눌리지 않으며, 글이 들면 짙은 파랑(#3a83f7)이다.
  const send = 입력창(page).getByRole("button", { name: "보내기", exact: true });
  await 입력칸(page).fill("");
  await expect(send).toBeDisabled();
  await expect.poll(async () => (await 모양(send, ["opacity"])).opacity).toBe("0.4");
  await 입력칸(page).fill("web-app 쪽 checkout도 같이 봐 줘");
  await expect(send).toBeEnabled();
  await expect.poll(async () => (await 모양(send, ["opacity"])).opacity).toBe("1");
  expect(await 모양(send, ["background-color"])).toEqual({ "background-color": "rgb(58, 131, 247)" });
  expect(await unknownIpcCalls(page)).toEqual([]);
});
