import { expect, test, type Locator, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { heldCalls, holdCommand, installFixtureBackend, ipcArgs, ipcCallArgs, releaseCommand, replaceAnswer, unknownIpcCalls, 토큰색 } from "./harness";
import { linesThrough, record, sentPayloads, seqOf, summaryOf } from "./thread-records";
import { PAYMENTS, REFUND, SCOPE_BY_SERVICE, SCOPES, SETTLEMENT, TOOLS, WORLD } from "./thread-service-world";
import type { RecordLine, ThreadView } from "@/features/thread/types";

// 03 티켓 13 흐름 「트레이」(캔버스 v52 F4-KitComposer · 구현 스펙 「01a — 범위와 새 채팅」 · restart 02b-2 Composer 보드) — **첫 말 전의 새 채팅에만 입력창
// 상자 아래에 회색 띠가 서서 「새 작업공간」 칩 · 범위 칩 · 범위 줄을 싣는다. 범위 칩은 이 채팅이 읽을 곳(없음 · Service · Project)을 고르고(관문이 아니다),
// 범위 줄이 지금 읽는 Project를 한 줄로 말한다. 첫 말 뒤에는 트레이가 없다 — 범위는 대화로 바꾼다. 입력창 안은 + · 물어보는 정도 · 모델 칩뿐이다**
// (03 구현 스펙 §5 · §6 · 티켓 02 · 06 · S2–S5 · 스토리 14–42 · 티켓 01a-13). 상황 모음판의 칸이 곧 경우다 — 같은 것을 두 번 재지 않는다.
//
//   여기서 잰다     트레이의 자리(상자 밑으로 14 겹침 · 칩 차례 · 칩 모양) · 첫 말 뒤 트레이 없음 · 범위 메뉴(범위 없음 · Service · Project — 상자에 붙는
//                   자리 · 끝 줄 없음) · ▾(빼기는 메뉴의 「범위 없음」) · 그 Work의 Service · 빈 Service · 범위 없음 · 범위 줄 · 고른 범위가 첫 말과 함께
//                   감 · 씨앗(`?new=` · `?work=` · `?service=` · `?project=` · `?say=`) · `@`는 파일 메뉴 · `/agent` 없음 · 입력이 있으면 짙은 보내기 ·
//                   세션 여는 중 모델 칩 스켈레톤
//   다른 spec이 잰다 정도 칩(`thread-work-chip`) · Work 만들기 카드를 받아들인 뒤(`thread-work`) · 대화로 바꾸는 범위 — 흐름의 Service 줄과 머리 줄의
//                   Service(흐름 「대화 속 Service와 설정」 — `thread-service-setting`) · `@` 메뉴의 손맛(`thread-mention`)
//
// 세계는 시안의 Project 셋 · Service 셋 · Work 넷이다(`thread-service-world`). 읽는 범위는 core가 짓는 모양을 그 세계로 적어 둔 답이고, 이 층은
// 그 답을 화면이 그대로 말하는지와 고른 것이 그 인자로 나가는지를 잰다(범위를 세는 규칙은 L1 `reading_scope` · `thread_service.rs`의 몫).
// 기하는 시안 창(1440 × 900)에서 잰다.

test.use({ viewport: { width: 1440, height: 900 } });

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
/** 입력창 — 보낼 말 칸을 싼 둘레 카드(`form`)다. 트레이의 자리는 이것과 견준다. */
const 입력창 = (page: Page) => 입력칸(page).locator("xpath=ancestor::form[1]");
const 첫화면 = (page: Page) => page.getByRole("heading", { name: "무엇을 만들까요?", exact: true });
const 트레이 = (page: Page) => page.locator('[data-slot="composer-tray"]');
/** 「새 작업공간」 칩 — `?new=work`로 연 새 채팅의 첫 말 전에만 선다. */
const 새작업공간칩 = (page: Page) => 트레이(page).locator('[data-slot="new-work-chip"]');
/** 비어 있는 범위 칩 — 「범위 없음 ▾」. */
const 빈칩 = (page: Page) => 트레이(page).getByRole("button", { name: "범위 없음", exact: true });
/** 고른 범위 칩 — 그 이름 ▾다. 빼기는 메뉴의 「범위 없음」이다(restart 02b-2 — 한때 흰 칩 + ×였다). */
const 이름칩 = (page: Page, name: string) => 트레이(page).getByRole("button", { name: `범위: ${name}`, exact: true });
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

/** 트레이 띠의 칠 · 안쪽 · 둥글기(Composer `.ra-tray`). */
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

/** 시안의 세계(`WORLD`)에 범위를 더한다 — 입력창이 쥔 Service로 범위를 세면(`reading_scope`의 `service`) 그 Service의 범위, 쥔 것이 없으면 전부다. Project 범위는 재는 시험이 덮는다. */
const TRAY_WORLD = {
  ...WORLD,
  reading_scope: answerByArg("service", SCOPE_BY_SERVICE, { otherwise: SCOPES.all }),
};

/** 답만 한 첫 턴(`thread-two-turns`) — 첫 말로 막 선 Thread가 그 첫 `sent`까지다. */
const API_SERVER = "api-server";

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

/** 범위를 센 자리 — 입력창이 쥔 Work · 범위(또는 연 Thread)로 부른 `reading_scope`의 인자들. */
const scopeAsks = (page: Page) => ipcArgs(page, "reading_scope", "service");

/** 씨앗을 실은 첫 화면 주소. */
const at = (search: Record<string, string>) => `/?${new URLSearchParams(search)}`;

/**
 * 첫 말을 보낸다 — 첫 말을 받은 Thread 화면이 선다. 작업공간에 이은 Thread는 그 작업공간 화면의 채팅 탭이다(`/works/<slug>?tab=chat&thread=<id>`
 * · 본문 카드 이름 「채팅」 — restart 02a-4). 작업공간 밖 Thread는 `/threads/<id>`에 그 이름의 본문으로 선다.
 */
async function sendFirst(page: Page, text: string, to: ThreadView) {
  await 입력칸(page).fill(text);
  await 입력칸(page).press("Enter");
  if (to.work) {
    await expect(page).toHaveURL(`/works/${to.work}?tab=chat&thread=${to.id}`);
    await expect(page.getByRole("main", { name: "채팅", exact: true })).toBeVisible();
    await expect(page.locator('[data-tab="chat"]')).toContainText(to.title);
    return;
  }
  await expect(page).toHaveURL(`/threads/${to.id}`);
  await expect(page.getByRole("main", { name: to.title, exact: true })).toBeVisible();
}

test("트레이 — 첫 화면의 트레이는 입력창 상자 밑으로 14 겹쳐 들어간 띠이고 칩은 새 작업공간 · 범위 · 범위 줄 차례이며, 첫 말을 보내면 걷힌다", async ({
  page,
}) => {
  // 첫 말을 받은 Thread — 「새 작업공간」으로 시작해 아직 Work가 서지 않았다(`newWork`). 시작을 붙잡아 보내는 동안의 입력창을 본다.
  const started: ThreadView = { ...FIXTURE_THREAD, title: first.text, live: true, lastSeq: FIRST_SENT, newWork: true };
  await withThreads(page, [started], linesThrough(twoTurns, FIRST_SENT));
  await holdCommand(page, "thread_start");
  await openHome(page, at({ new: "work" }));

  // 상자 아래(Composer `.ra-tray` — margin -14 14 0 · padding 20 8 6 · `surface-tray` · 아래 둥글기 15, restart 02b-2). 띠는 상자 밑으로 14 겹쳐
  // 들어가 상자가 덮고 보이는 안쪽은 위 6이다(한때 겹침 2 · 안쪽 위 10). 칩은 트레이 안에 「새 작업공간」 → 범위 칩 → 범위 줄 차례로 서고, 칩 사이
  // 2 · 범위 줄은 4를 더 띄운다(칩 곁 6). 칩은 28 높이다.
  const tray = 트레이(page);
  await expect(범위줄(page)).toHaveText("등록된 Project 3개를 읽어요");
  const [below, composer] = [await 상자(tray), await 상자(입력창(page))];
  expect(composer.bottom - below.y).toBeCloseTo(14, 0);
  expect([below.x - composer.x, composer.right - below.right]).toEqual([14, 14]);
  expect(await 모양(tray, BAND)).toEqual({
    "background-color": await 토큰색(page, "--surface-tray"),
    "padding-top": "20px",
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
  ).toEqual(["new-work-chip", "범위 없음", "scope-line"]);
  const [workChip, scopeChip, scope] = [await 상자(새작업공간칩(page)), await 상자(빈칩(page)), await 상자(범위줄(page))];
  expect([workChip.height, scopeChip.height]).toEqual([28, 28]);
  expect(scopeChip.x - workChip.right).toBeCloseTo(2, 0);
  expect(scope.x - scopeChip.right).toBeCloseTo(6, 0);
  // 칩의 글자 — 「새 작업공간」도 「범위 없음」도 13 `fg-secondary`다(한때 본문색 · 흐린 45%). 범위 줄은 12 · `fg-tertiary`다.
  const 버금 = await 토큰색(page, "--fg-secondary");
  expect(await 모양(새작업공간칩(page).getByText("새 작업공간", { exact: true }), ["font-size", "color"])).toEqual({ "font-size": "13px", color: 버금 });
  expect(await 모양(빈칩(page), ["color"])).toEqual({ color: 버금 });
  expect(await 모양(범위줄(page), ["font-size", "color"])).toEqual({ "font-size": "12px", color: await 토큰색(page, "--fg-tertiary") });

  // 보내는 동안 — 입력창이 바닥으로 내려가고 트레이는 걷힌다(범위는 대화로 바꾼다 — 구현 스펙 「01a — 범위와 새 채팅」 · Thread 보드). 한때 트레이가
  // 상자 위로 옮겨 잠긴 Work 칩을 실었다. 칩은 옅어지지 않고(한때 50%), 모델 칩 자리는 Runtime이 목록을 줄 때까지 스켈레톤(92 × 12 · 1.4s)이다.
  await 입력칸(page).fill(first.text);
  await 입력칸(page).press("Enter");
  await expect.poll(() => heldCalls(page, "thread_start")).toBe(1);
  await expect.poll(async () => Math.round((await 상자(입력창(page))).bottom)).toBeGreaterThan(800);
  await expect(tray).toHaveCount(0);
  await expect(page.locator('[data-slot="work-chip"]')).toHaveCount(0);
  const 정도칩 = 입력창(page).getByRole("button", { name: /^물어보는 정도 / });
  expect(await 정도칩.evaluate((el) => Number(getComputedStyle(el.parentElement!).opacity) * Number(getComputedStyle(el).opacity))).toBe(1);
  const 스켈레톤 = 입력창(page).getByRole("status", { name: "모델을 읽는 중", exact: true });
  await expect(스켈레톤).toBeVisible();
  const bone = await 상자(스켈레톤);
  expect([bone.width, bone.height]).toEqual([92, 12]);
  expect(await 스켈레톤.evaluate((el) => el.getAnimations().map((one) => Number(one.effect?.getTiming().duration)))).toEqual([1400]);

  // Session이 열려 Thread 화면이 서도 트레이는 없다 — 첫 말 뒤의 입력창에는 칩만 선다.
  await releaseCommand(page, "thread_start");
  await expect(page).toHaveURL(`/threads/${started.id}`);
  await expect(page.getByRole("main", { name: started.title, exact: true })).toBeVisible();
  await expect(입력칸(page)).toBeVisible();
  await expect(tray).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("동작 줄이기면 세션 여는 중의 모델 칩 스켈레톤이 흐르지 않는다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const started: ThreadView = { ...FIXTURE_THREAD, title: first.text, live: true, lastSeq: FIRST_SENT };
  await withThreads(page, [started], linesThrough(twoTurns, FIRST_SENT));
  await holdCommand(page, "thread_start");
  await openHome(page);
  await 입력칸(page).fill(first.text);
  await 입력칸(page).press("Enter");
  await expect.poll(() => heldCalls(page, "thread_start")).toBe(1);
  const 스켈레톤 = 입력창(page).getByRole("status", { name: "모델을 읽는 중", exact: true });
  await expect(스켈레톤).toBeVisible();
  expect(await 스켈레톤.evaluate((el) => el.getAnimations().length)).toBe(0);
  await releaseCommand(page, "thread_start");
  await expect(page).toHaveURL(`/threads/${started.id}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("범위 칩 — 메뉴에서 고른 Service가 칩 이름(▾)이 되어 범위 줄이 그 Project를 말하고, 메뉴의 「범위 없음」이 빼며, 빈 Service는 경고 한 줄이고, 고른 것은 「새 작업공간」 칩을 빼도 남아 첫 말과 함께 간다", async ({
  page,
}) => {
  await withThreads(page, [{ ...FIXTURE_THREAD, live: true, lastSeq: FIRST_SENT }], linesThrough(twoTurns, FIRST_SENT));
  await openHome(page, at({ new: "work" }));

  // 작업공간 만들기로 연 첫 화면 — 「새 작업공간」 · 「범위 없음」 · 등록된 Project 전부를 읽는다.
  await expect(새작업공간칩(page)).toBeVisible();
  await expect(빈칩(page)).toBeVisible();
  await expect(범위줄(page)).toHaveText("등록된 Project 3개를 읽어요");

  // 범위 메뉴(Composer 「범위 메뉴」) — 트리거가 아니라 입력창 상자에 붙어 상자 위 8 · 상자 왼쪽에서 8 들어선 320 폭으로 연다(restart 02b-2). 맨 위는
  // 늘 「범위 없음 — 등록된 Project 전부」(지금이 없음이면 ✓), 「이 채팅이 읽을 곳」 아래에 Service와 Project가 그 차례로 선다. 끝 줄(「Service
  // 관리」 · 「대화로 Service 만들기」)은 걷혔다 — Service 화면이 그 길이다.
  await 빈칩(page).click();
  await expect(메뉴(page)).toBeVisible();
  const [menuBox, box] = [await 상자(메뉴(page)), await 상자(입력창(page))];
  expect([Math.round(box.y - menuBox.bottom), Math.round(menuBox.x - box.x), menuBox.width]).toEqual([8, 8, 320]);
  await expect(메뉴(page).getByRole("menuitemradio")).toHaveText([
    "범위 없음등록된 Project 전부",
    "결제 서비스Service · Project 2개",
    "사내 도구Service · Project 2개",
    "정산Service · Project 없음",
    "api-serverProject · ~/MyProjects/api-server",
    "backofficeProject · ~/MyProjects/backoffice",
    "web-appProject · ~/MyProjects/web-app",
  ]);
  await expect(갈래(page, "범위 없음")).toHaveAttribute("aria-checked", "true");
  await expect(갈래(page, "범위 없음")).toHaveAccessibleDescription("등록된 Project 전부");
  await expect(메뉴(page).getByRole("group", { name: "이 채팅이 읽을 곳", exact: true })).toBeVisible();
  await expect(갈래(page, PAYMENTS.name)).toHaveAccessibleDescription("Service · Project 2개");
  await expect(메뉴(page).getByRole("menuitem")).toHaveCount(0);

  // Service를 고름 — 칩이 그 이름 ▾(층 글리프)이 되고 범위 줄이 그 Service의 Project를 말한다. 칩은 범위가 없을 때와 같은 글자색이고 면이 없다
  // (한때 흰 면 + 0.5 고리 + ×). 범위는 쥔 Service로 센다 — 아직 Thread가 없다.
  await 갈래(page, PAYMENTS.name).click();
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await expect(빈칩(page)).toHaveCount(0);
  await expect(트레이(page).getByRole("button", { name: "범위 빼기", exact: true })).toHaveCount(0);
  await expect(범위줄(page)).toHaveText("web-app · api-server를 읽어요");
  // 면은 손이 떠난 뒤 색 전이가 끝나야 빈다 — 메뉴가 닫히며 칩으로 돌아온 포커스는 누르는 손의 것이라 링 · 면이 없다.
  await page.mouse.move(720, 120);
  await expect.poll(async () => (await 모양(이름칩(page, PAYMENTS.name), ["background-color"]))["background-color"]).toBe("rgba(0, 0, 0, 0)");
  expect(await 모양(이름칩(page, PAYMENTS.name), ["color"])).toEqual({ color: await 토큰색(page, "--fg-secondary") });
  await expect(이름칩(page, PAYMENTS.name).locator("svg")).toHaveCount(2);
  expect((await 상자(이름칩(page, PAYMENTS.name))).height).toBe(28);
  expect(await scopeAsks(page)).toContainEqual({ thread: null, work: null, service: PAYMENTS.slug, project: null });
  await 이름칩(page, PAYMENTS.name).click();
  await expect(갈래(page, PAYMENTS.name)).toHaveAttribute("aria-checked", "true");
  await expect(갈래(page, "범위 없음")).toHaveAttribute("aria-checked", "false");

  // 「범위 없음」 — 빼면 다시 「범위 없음」 칩이고 등록된 전부를 읽는다.
  await 갈래(page, "범위 없음").click();
  await expect(메뉴(page)).toHaveCount(0);
  await expect(빈칩(page)).toBeVisible();
  await expect(이름칩(page, PAYMENTS.name)).toHaveCount(0);
  await expect(범위줄(page)).toHaveText("등록된 Project 3개를 읽어요");

  // 빈 Service(「빈 Service를 고름」) — 막지 않고 범위 줄이 경고 색 한 줄로 알린다.
  await 빈칩(page).click();
  await 갈래(page, SETTLEMENT.name).click();
  await expect(이름칩(page, SETTLEMENT.name)).toBeVisible();
  await expect(범위줄(page)).toHaveText("읽는 Project가 없어요 — Service에 Project를 넣어 주세요");
  expect(await 모양(범위줄(page), ["color"])).toEqual({ color: "rgb(154, 91, 0)" });

  // 「새 작업공간」 칩과 범위 칩은 따로다 — 칩을 ×로 빼도 쥔 범위는 남는다(03 결정 「06」 — 입력창이 쥐는 Service는 둘이다).
  await page.getByRole("button", { name: "새 작업공간 빼기", exact: true }).click();
  await expect(새작업공간칩(page)).toHaveCount(0);
  await expect(이름칩(page, SETTLEMENT.name)).toBeVisible();

  // 고른 Service는 첫 말과 함께 간다 — 시작 명령의 `service` 하나로(S4). 첫 말 전에 고른 것이라 흐름에 Service 줄이 서지 않는다(엔진 — L1).
  await 입력칸(page).fill(first.text);
  await 입력칸(page).press("Enter");
  await expect(page).toHaveURL(`/threads/${FIXTURE_THREAD.id}`);
  expect(await ipcArgs(page, "thread_start", "text")).toEqual([
    { text: first.text, attachments: [], link: { kind: "no-work" }, runtime: "claude-code", mode: "edits", model: null, effort: null, service: { slug: SETTLEMENT.slug }, project: null, quote: null },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("범위 메뉴 — Project를 고르면 앞의 Service가 빠지고 칩 · 범위 줄이 그 Project이며, 첫 말의 `project`로 간다", async ({ page }) => {
  const started: ThreadView = { ...FIXTURE_THREAD, live: true, lastSeq: FIRST_SENT };
  await withThreads(page, [started], linesThrough(twoTurns, FIRST_SENT));
  await openHome(page);
  await 빈칩(page).click();
  await 갈래(page, PAYMENTS.name).click();
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();

  // 범위 답은 인자 하나로만 가른다 — Service를 고른 뒤라 여기서 Project로 가른 답으로 간다.
  await replaceAnswer(page, "reading_scope", answerByArg("project", { [API_SERVER]: SCOPES.apiServer }, { otherwise: SCOPES.payments }));
  await 이름칩(page, PAYMENTS.name).click();
  await 갈래(page, API_SERVER).click();
  await expect(이름칩(page, API_SERVER)).toBeVisible();
  await expect(이름칩(page, PAYMENTS.name)).toHaveCount(0);
  await expect(범위줄(page)).toHaveText("api-server를 읽어요");
  expect(await scopeAsks(page)).toContainEqual({ thread: null, work: null, service: null, project: API_SERVER });

  // 메뉴에도 그 하나만 골라져 있다 — Service와 Project 범위는 함께 서지 않는다.
  await 이름칩(page, API_SERVER).click();
  await expect(갈래(page, API_SERVER)).toHaveAttribute("aria-checked", "true");
  await expect(갈래(page, PAYMENTS.name)).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(메뉴(page)).toHaveCount(0);

  await sendFirst(page, first.text, started);
  expect(await ipcArgs(page, "thread_start", "text")).toEqual([
    { text: first.text, attachments: [], link: { kind: "no-work" }, runtime: "claude-code", mode: "edits", model: null, effort: null, service: null, project: API_SERVER, quote: null },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`?work=`로 열면 그 작업공간의 새 채팅 탭이고 범위 칩은 그 Work의 Service(▾)이며, 메뉴에 Project 줄이 없고, 메뉴에서 바꾼 것 · 뺀 것이 첫 말 때 그 Work에 가도록 함께 간다", async ({
  page,
}) => {
  const linked: ThreadView = { ...FIXTURE_THREAD, work: REFUND.slug, live: true, lastSeq: FIRST_SENT };
  await withThreads(page, [linked], linesThrough(twoTurns, FIRST_SENT));
  await openHome(page, at({ work: REFUND.slug }));

  // 그 작업공간의 새 채팅 탭이다(restart 02a-8) — Work 칩 없이 빈 칸의 말이 그 작업공간을 부른다(restart 02b-2 — 한때 잠긴 Work 칩이 섰다). 범위
  // 칩은 그 Work의 Service ▾이고 빼기는 메뉴에서만이다. 범위는 그 Work와 그 Service로 센다.
  await expect(page).toHaveURL(`/works/${REFUND.slug}?tab=chat`);
  await expect(입력칸(page)).toHaveAttribute("placeholder", `${REFUND.title}에서 무엇을 할까요?`);
  await expect(page.locator('[data-slot="work-chip"]')).toHaveCount(0);
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await expect(이름칩(page, PAYMENTS.name).locator("svg")).toHaveCount(2);
  await expect(범위줄(page)).toHaveText("web-app · api-server를 읽어요");
  await expect.poll(() => scopeAsks(page)).toContainEqual({ thread: null, work: REFUND.slug, service: PAYMENTS.slug, project: null });

  // 메뉴에서 바꾸면 칩 · 범위 줄이 따라오지만 그 Work의 파일은 그대로다 — 보낼 때 적는다(메뉴를 훑다 버린 입력이 Work를 바꾸지 않게, S4). Project 범위는
  // 작업공간 밖의 값이라 메뉴에 Project 줄이 없다.
  await 이름칩(page, PAYMENTS.name).click();
  await expect(메뉴(page).getByRole("menuitemradio")).toHaveText([/^범위 없음/, /^결제 서비스/, /^사내 도구/, /^정산/]);
  await expect(갈래(page, "범위 없음")).toHaveAttribute("aria-checked", "false");
  await 갈래(page, TOOLS.name).click();
  await expect(이름칩(page, TOOLS.name)).toBeVisible();
  await expect(범위줄(page)).toHaveText("api-server · backoffice를 읽어요");
  expect(await ipcCallArgs(page, "thread_set_work_service", "work")).toEqual([]);
  await sendFirst(page, "환불 버튼 문구를 고쳐 줘", linked);
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => [args.link, args.service])).toEqual([
    [{ kind: "work", slug: REFUND.slug }, { slug: TOOLS.slug }],
  ]);
  expect(await ipcCallArgs(page, "thread_set_work_service", "work")).toEqual([]);

  // 다시 연 첫 화면 — 칩은 다시 그 Work의 지금 Service다(바꾼 것은 그 첫 말과 함께 떠났다). 「범위 없음」을 고르면 칩이 흐린 「범위 없음」이 되고, 그 뺌도
  // 첫 말과 함께 간다(`{slug: null}` — 고르지 않은 `null`과 다르다).
  await openHome(page, at({ work: REFUND.slug }));
  await 이름칩(page, PAYMENTS.name).click();
  await 갈래(page, "범위 없음").click();
  await expect(빈칩(page)).toBeVisible();
  await expect(범위줄(page)).toHaveText("등록된 Project 3개를 읽어요");
  await sendFirst(page, "결제 실패 문구도 봐 줘", linked);
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => [args.link, args.service])).toEqual([
    [{ kind: "work", slug: REFUND.slug }, { slug: null }],
  ]);
  expect(await ipcCallArgs(page, "thread_set_work_service", "work")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("첫 말 뒤 — 트레이가 없다: 작업공간에 이은 채팅 · 작업공간 없는 채팅 · Service가 있는 채팅 모두 범위 칩도 범위 줄도 서지 않는다", async ({ page }) => {
  const opened = { live: true, lastSeq: FIRST_SENT };
  const inWork: ThreadView = { ...FIXTURE_THREAD, ...opened, id: "20261020-090000", title: "환불 금액 확인", work: REFUND.slug };
  const loose: ThreadView = { ...FIXTURE_THREAD, ...opened, id: "20261021-090000", title: "결제 수단 정리" };
  const serviced: ThreadView = { ...FIXTURE_THREAD, ...opened, id: "20261022-090000", title: "checkout 같이 보기", service: PAYMENTS.slug };
  await withThreads(page, [inWork, loose, serviced], linesThrough(twoTurns, FIRST_SENT), {
    reading_scope: answerByArg("thread", { [inWork.id]: SCOPES.payments, [serviced.id]: SCOPES.payments }, { otherwise: SCOPES.all }),
  });
  // 작업공간에 이은 Thread는 `/threads/<id>`로 열어도 그 작업공간 화면의 채팅 탭으로 옮겨 선다(restart 02a-4 — 본문 카드 이름 「채팅」).
  const 열린다 = async (view: ThreadView) => {
    await page.goto(`/threads/${view.id}`);
    if (view.work) {
      await expect(page).toHaveURL(`/works/${view.work}?tab=chat&thread=${view.id}`, { timeout: 20_000 });
      await expect(page.getByRole("main", { name: "채팅", exact: true })).toBeVisible();
      return;
    }
    await expect(page.getByRole("main", { name: view.title, exact: true })).toBeVisible({ timeout: 20_000 });
  };
  /**
   * 범위는 대화로 바꾼다 — 그 Thread에 Service가 있어도 트레이가 없다(Thread 보드 — restart 02b-2). 한때 상자 위에 잠긴 Work 칩(「작업공간으로 가기:
   * …」 · 「작업공간 없이 대화」)이 섰다. Service는 머리 줄이 말한다(`thread-service-setting`).
   */
  const 트레이가없다 = async () => {
    await expect(입력칸(page)).toBeVisible();
    await expect(트레이(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="work-chip"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^범위/ })).toHaveCount(0);
  };

  await 열린다(inWork);
  await 트레이가없다();
  await 열린다(loose);
  await 트레이가없다();
  await 열린다(serviced);
  await 트레이가없다();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("등록된 Project가 없으면 범위 줄이 경고 색 「등록된 Project가 없어요 · Project 추가」로 추가 창을 열고, Service가 없으면 범위 메뉴에는 「범위 없음」 한 줄뿐이다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    ...TRAY_WORLD,
    list_projects: [],
    list_services: [],
    list_works: [],
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

  // 범위 메뉴 — Service가 없을 때: 「범위 없음」의 곁말이 등록된 Project가 없다고 말하고, 그 한 줄뿐이다. 끝의 「아직 Service가 없어요」 · 「대화로
  // Service 만들기」는 보드 칸에 없어 걷었다(restart 02b-2) — Service 화면이 그 길이다.
  await 빈칩(page).click();
  await expect(갈래(page, "범위 없음")).toHaveAccessibleDescription("등록된 Project가 없어요");
  await expect(메뉴(page).getByRole("menuitemradio")).toHaveCount(1);
  await expect(메뉴(page).getByRole("menuitem")).toHaveCount(0);
  await expect(메뉴(page).getByText("아직 Service가 없어요", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("씨앗 — 주소의 `?new=` · `?work=` · `?service=` · `?say=`가 처음 고를 「새 작업공간」 칩 · 범위 칩 · 입력 글 · 작업공간의 새 채팅 탭이 되고, 보내지는 않는다", async ({
  page,
}) => {
  const linked: ThreadView = { ...FIXTURE_THREAD, work: REFUND.slug, live: true, lastSeq: FIRST_SENT };
  await withThreads(page, [linked], linesThrough(twoTurns, FIRST_SENT));

  // Service 상세의 「작업공간 만들기」(`?new=work&service=`) — 「새 작업공간」과 그 Service(▾)를 고른 채 선다(F4-KitComposer 「Service를 고름」 칸의 곁말).
  await openHome(page, at({ new: "work", service: PAYMENTS.slug }));
  await expect(새작업공간칩(page)).toBeVisible();
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await expect(범위줄(page)).toHaveText("web-app · api-server를 읽어요");

  // Service 상세의 「대화로 고치기」(`?new=thread&service=&say=`) — 「새 작업공간」 칩 없이 그 Service · 맡기는 말이 입력칸에 들고, 보내지 않는다.
  const say = `${PAYMENTS.name} Service를 고치고 싶어요. `;
  await openHome(page, at({ new: "thread", service: PAYMENTS.slug, say }));
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await expect(새작업공간칩(page)).toHaveCount(0);
  await expect(입력칸(page)).toHaveValue(say);
  await expect(입력칸(page)).toBeFocused();

  // 씨앗 Service 하나(`?service=`) — 「새 작업공간」 칩 없이 그 Service를 쥔다. 빈 Service면 경고 한 줄이다.
  await openHome(page, at({ service: SETTLEMENT.slug }));
  await expect(이름칩(page, SETTLEMENT.name)).toBeVisible();
  await expect(새작업공간칩(page)).toHaveCount(0);
  await expect(범위줄(page)).toHaveText("읽는 Project가 없어요 — Service에 Project를 넣어 주세요");

  // Work와 Service를 함께(`?work=&service=`) — 그 작업공간의 새 채팅 탭으로 간다(restart 02a-8). **범위 씨앗은 따라가지 않는다** — 작업공간의 범위는 그
  // 작업공간의 것이라 칩은 그 Work의 지금 Service(▾)다(`routes/index.tsx`의 `WorkSeed`). 한때 그 Work의 Service를 씨앗으로 바꾼 것으로 쥐고 첫 말과
  // 함께 보냈다. 보내면 고르지 않은 범위(`null`)로 그 Work에 간다. Work 칩은 없고 빈 칸의 말이 그 작업공간을 부른다(restart 02b-2).
  await openHome(page, at({ work: REFUND.slug, service: TOOLS.slug }));
  await expect(page).toHaveURL(`/works/${REFUND.slug}?tab=chat`);
  await expect(입력칸(page)).toHaveAttribute("placeholder", `${REFUND.title}에서 무엇을 할까요?`);
  await expect(이름칩(page, PAYMENTS.name)).toBeVisible();
  await expect(이름칩(page, TOOLS.name)).toHaveCount(0);
  expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);
  await 입력칸(page).fill("배포 전에 볼 것 정리해 줘");
  await 입력칸(page).press("Enter");
  await expect(page).toHaveURL(`/works/${REFUND.slug}?tab=chat&thread=${linked.id}`);
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => [args.link, args.service])).toEqual([
    [{ kind: "work", slug: REFUND.slug }, null],
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("씨앗 — `?project=`가 범위 칩에 그 Project를 고르고, `?new=work&project=`는 「새 작업공간」 칩과 함께 서서 첫 말의 `project`로 간다", async ({ page }) => {
  const started: ThreadView = { ...FIXTURE_THREAD, live: true, lastSeq: FIRST_SENT };
  await withThreads(page, [started], linesThrough(twoTurns, FIRST_SENT), {
    reading_scope: answerByArg("project", { [API_SERVER]: SCOPES.apiServer }, { otherwise: SCOPES.all }),
  });

  // Project 범위 칩은 폴더 글리프 · 이름 ▾다.
  await openHome(page, at({ project: API_SERVER }));
  await expect(이름칩(page, API_SERVER)).toBeVisible();
  await expect(이름칩(page, API_SERVER).locator("svg")).toHaveCount(2);
  await expect(새작업공간칩(page)).toHaveCount(0);
  await expect(범위줄(page)).toHaveText("api-server를 읽어요");

  await openHome(page, at({ new: "work", project: API_SERVER }));
  await expect(새작업공간칩(page)).toBeVisible();
  await expect(이름칩(page, API_SERVER)).toBeVisible();
  await sendFirst(page, first.text, started);
  expect(await ipcArgs(page, "thread_start", "text")).toEqual([
    { text: first.text, attachments: [], link: { kind: "new-work" }, runtime: "claude-code", mode: "edits", model: null, effort: null, service: null, project: API_SERVER, quote: null },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("입력창 안은 + · 물어보는 정도 · Runtime 칩 · 모델 칩 · 보내기뿐이다 — `@`는 Agent가 아니라 파일 메뉴를 열고, `/agent` · `/work` 명령도 없으며, 입력이 있으면 보내기가 짙어진다", async ({
  page,
}) => {
  await installFixtureBackend(page, TRAY_WORLD);
  await openHome(page);

  // 입력창 상자 안의 단추(F4-KitComposer 머리말 — 「입력창 안은 + · 물어보는 정도 · 모델 칩뿐」). `@` 단추는 없다 — 채팅은 Runtime 세션 하나라 부를 Agent가
  // 없다(티켓 01a-2 · 01a-6). 새 채팅에서는 Runtime 칩이 모델 칩 앞에 선다(restart 01c-3 — 기본은 Claude Code, 고르는 일은 `thread-runtime`이 잰다).
  const buttons = 입력창(page).getByRole("button");
  await expect(buttons).toHaveCount(5);
  expect(await buttons.evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")))).toEqual([
    "파일 첨부",
    "물어보는 정도 편집 자동",
    "Runtime: Claude Code",
    expect.stringMatching(/^모델과 생각 깊이 /),
    "보내기",
  ]);
  await expect(page.getByRole("button", { name: "Agent 부르기", exact: true })).toHaveCount(0);

  // `@`는 파일을 언급한다(restart 02b-3) — 머리 「파일」의 목록이 서고 Agent를 부르는 줄은 없다. 손맛은 `thread-mention`이 잰다.
  await 입력칸(page).pressSequentially("@");
  await expect(입력칸(page)).toHaveValue("@");
  const files = page.getByRole("listbox", { name: "파일", exact: true });
  await expect(files).toBeVisible();
  await expect(files.getByRole("option").first()).toBeVisible();
  await expect(page.getByText(/Agent/)).toHaveCount(0);

  // 「/」 명령 메뉴에 `/agent`도 `/work`도 없다 — Agent를 부르는 길도 Work 칩의 스위치도 사라졌다.
  await 입력칸(page).fill("/");
  const commands = page.getByRole("listbox", { name: "명령", exact: true }).getByRole("option");
  await expect(commands.filter({ hasText: "/new" })).toHaveCount(1);
  const names = await commands.evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));
  expect(names).not.toContain("/agent");
  expect(names).not.toContain("/work");

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
