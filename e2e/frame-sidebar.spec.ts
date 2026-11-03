import { expect, test, type Locator, type Page } from "./evidence";
import { answerByArg, ARCHIVE, FIXTURE_THREAD, PROJECTS, SERVICES, summaryWith as 요약, WORKS } from "./fixtures";
import {
  awaitSpawned,
  installFixtureBackend,
  markAttention,
  SPEC_LAYOUT_EDITOR,
  unknownIpcCalls,
  끄는자리,
  띠,
  위칸,
  위칸줄,
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
  카드자리끝,
} from "./harness";
import { lineOf, linesThrough, record, seqOf, summaryOf, threadOf } from "./thread-records";
import { formatMemory } from "@/features/processes/metrics";

// 02 티켓 13a — 흐름 「틀과 사이드바」(02 구현 스펙 §3 · §4 · §5 · Testing Decisions). **어느 주소에서나 같은 머리 줄 하나와 카드 자리에
// 사이드바와 본문 카드가 서고**(restart 02a-2 — 한때 흰 판 하나), 사이드바 위 칸(새 Thread · 내 차례 · 가는 곳 다섯 — 02a-3)과 ⌘N, Work 줄의
// 상태 표시 하나가 그 Work의 Thread와 셸 가운데 가장 센 것이며, Work 묶음 +가 「작업공간 만들기」로 새 Thread를 열고, 위 칸 Processes 줄이
// 메모리 합계를 들고, 머리 카드였던 화면들이 머리 줄에 제 이름과 할 일을 세운다.
//
// 같은 것을 두 번 재지 않는다 — 다른 spec이 이미 재는 것:
//   카드의 자리 · 카드 사이 틈 · 카드 안이 끄는 자리가 아님 · 머리 줄 컨트롤 크기 · 끄는 자리   `frame.spec.ts`
//   사이드바 차례 · 위 칸의 행선지 · ⌘K로 Thread · 「새 채팅」을 누르면 첫 화면               `thread-sidebar.spec.ts`
//   Thread 줄 다섯 상태 표시                                                                   `thread-status.spec.ts`
//   「내 차례」를 켜고 다시 눌러 끄기 · 기다리는 순서                                           `thread-waiting.spec.ts`
//   Work 줄의 셸 신호(내 차례 알약 · 새 결과 점) · 레인은 폴더 · 호버 카드                       `works-sidebar.spec.ts` · `shell-*.spec.ts`
//   위 줄 ↑↓ · Tab 차례(창 컨트롤 → 머리 줄 → 사이드바 …)                                      `keyboard.spec.ts`
//   ⌘N의 메뉴 바 항목 · ⌘N 글자 크기 · 맨 아래 설정 줄 기하 · `●`(손볼 것)                       `hotkeys` · `type-scale` · `sidebar-quiet` · `spacing` · `processes-nav-meta`
//   Thread 화면의 머리 줄(이름 · 「…」 · 요약 고정)                                              `thread-screen.spec.ts`

const thread = FIXTURE_THREAD;
const [pinnedWork, plainWork] = WORKS;
/** Thread 화면이 서는 데 드는 답 — 「새 채팅 두 턴」 기록의 Thread 하나다. */
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

// ─── 머리 줄과 카드 ───────────────────────────────────────────────────────────────────────────────────────────────

/** 본문 카드 — 본문(`main`)을 품은 카드다. 공용 틀 · 채팅 화면은 `main` 자신이 카드이고, 내용 | 목록 카드는 `main`이 그 안의 칸이다. */
const 본문카드 = (page: Page) =>
  page.locator("main").evaluate((main) => {
    const card = main.closest('[data-slot="card"]') ?? main;
    const box = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    return {
      x: box.left,
      y: box.top,
      right: box.right,
      bottom: box.bottom,
      tone: card.getAttribute("data-tone"),
      radius: style.borderTopLeftRadius,
      shadow: style.boxShadow,
      fill: style.backgroundColor,
    };
  });

// **틀은 하나다**(02 구현 스펙 §3 「틀이 하나다」 · restart 02a-2). 앱 셸이 그리는 한 틀에 모든 화면이 선다: 크롬(`surface-shell`) 맨 위 44
// 머리 줄(`--size-titlebar`) 하나에 신호등 자리 · 셸 컨트롤 · 지금 화면의 자리가 서고, 그 아래 창 왼쪽 끝 0에 사이드바가, 그 오른쪽 끝에서
// 카드 자리(창 오 · 아래 끝 8 — 앱 셸 줄의 `pr-2 pb-2`)가 선다. 카드 자리에 겉은 없고 화면의 카드들이 8 틈으로 선다 — 카드는 둥글기 8 ·
// 0.5 링(`shadow-hairline`) · 면 `surface`다. **사이드바는 카드 밖 크롬 위다** — 바탕도 선도 없이 머리 줄 아래에서 창 아래 끝 8 앞까지 선다.
// 화면 자리는 사이드바와 상관없이 셸 컨트롤 끝 + 6에서 시작하고 앞에 세로선(0.5 × 16 `border-heavy`, 위아래 14)이 선다 — 화면이 아무것도
// 보내지 않으면 선도 없다(02a-7 — 한때 새 Thread가 그랬다. 이제 새 채팅도 화면 이름 「새 채팅」을 보낸다, restart 03-12a). 머리 줄 아래에는
// 선이 없다.
//
// 한때(02 §3 S2 – 02a-1) 카드 자리에 흰 판 한 장(오 · 아래 5, 0.5 `border-panel`, 둥글기 12, 위 그림자 `shadow-panel`)이 서고 사이드바가 창
// 왼쪽 + 5에 섰으며, 화면 자리는 판 안 왼쪽 끝에서 1 × 24 `separator` 세로선 뒤에 섰다 — 02a-2가 판을 걷고 02a-7이 화면 자리를 옮겼다.
//
// 주소마다 하나씩 잰다 — 틀이 둘로 갈려 한 벌만 고쳐진 날 그 벌의 주소만 빨개진다.
const ADDRESSES: { name: string; url: string; overrides?: Record<string, unknown>; ready: (page: Page) => Locator; head: boolean }[] = [
  { name: "새 채팅", url: "/", overrides: THREAD_ANSWERS, ready: 첫화면, head: true },
  {
    name: "채팅",
    url: `/threads/${thread.id}`,
    overrides: THREAD_ANSWERS,
    ready: (page) => page.getByRole("main", { name: thread.title, exact: true }),
    head: true,
  },
  { name: "Projects", url: "/projects", ready: (page) => page.getByRole("table", { name: "Project 목록", exact: true }), head: true },
  {
    name: "Project 상세",
    url: `/projects/${PROJECTS[0].slug}`,
    ready: (page) => page.getByRole("combobox", { name: "기준 브랜치", exact: true }),
    head: true,
  },
  { name: "Service", url: "/services", ready: (page) => page.getByRole("table", { name: "Service 목록", exact: true }), head: true },
  { name: "Terminal", url: "/terminal", ready: (page) => page.locator(".xterm-screen"), head: true },
  { name: "Processes", url: "/processes", ready: (page) => page.getByRole("heading", { name: "Processes", exact: true }), head: true },
  {
    name: "Archive",
    url: `/archive/${ARCHIVE[0].slug}`,
    ready: (page) => page.getByRole("main", { name: "Archive 상세", exact: true }).getByRole("navigation", { name: "문서", exact: true }),
    head: true,
  },
  { name: "Settings", url: "/settings/terminal", ready: (page) => 화면머리(page).getByText("Settings", { exact: true }), head: true },
  {
    name: "레이아웃 편집기",
    url: SPEC_LAYOUT_EDITOR,
    ready: (page) => page.getByRole("region", { name: "항목 트리", exact: true }),
    head: true,
  },
  { name: "작업공간", url: `/works/${pinnedWork.slug}`, ready: (page) => page.getByRole("region", { name: "작업공간 패널", exact: true }), head: true },
];

for (const address of ADDRESSES) {
  test(`${address.name}: 머리 줄 44 하나에 셸 컨트롤과 화면 자리가 서고, 카드 자리에 본문 카드가 선다`, async ({ page }) => {
    await installFixtureBackend(page, address.overrides);
    await page.goto(address.url);
    // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 그 화면을 처음 변환하는 것을 기다린다.
    await expect(address.ready(page)).toBeVisible({ timeout: 20_000 });
    const viewport = page.viewportSize()!;

    // 머리 줄 — 창 맨 위 44 줄 하나다. 아래에 선이 없다. 높이는 토큰에서 읽고 스펙의 수(44)는 따로 센다.
    const row = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--size-titlebar")));
    expect(row, "머리 줄 높이 — 02 구현 스펙 §3 · 시안 size-titlebar").toBe(44);
    await expect(page.locator("header")).toHaveCount(1);
    const header = await boxOf(page.locator("header"));
    expect([header.x, header.y, header.right, header.bottom], "머리 줄").toEqual([0, 0, viewport.width, row]);
    expect(await 칠한값(page.locator("header"), "border-bottom-width", "box-shadow"), "머리 줄 아래 선 · 그림자").toEqual(["0px", "none"]);
    // 셸 컨트롤은 어느 주소에서나 같은 자리다 — 신호등 끝 + 16, 머리 줄 가운데(그 크기 · 사이는 `frame.spec.ts`).
    const toggle = await boxOf(page.getByRole("button", { name: "사이드바 토글", exact: true }));
    expect([toggle.x, toggle.y + toggle.height / 2], "사이드바 토글 자리").toEqual([89, row / 2]);

    // 사이드바 — 카드 밖 크롬 위, 창 왼쪽 끝 0에서 머리 줄 아래부터 창 아래 끝 8 앞까지다. 바탕 · 오른쪽 선이 없다(크롬이 비친다).
    const side = await boxOf(사이드바(page));
    expect([side.x, side.y, side.bottom], "사이드바 — 카드 밖 크롬 위").toEqual([0, row, viewport.height - 8]);
    expect(
      await 사이드바(page).evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el, "::after").content]),
      "사이드바의 바탕 · ::after 선",
    ).toEqual(["rgba(0, 0, 0, 0)", "none"]);

    // 카드 자리 — 사이드바 오른쪽 끝에서 머리 줄 아래, 창 오 · 아래 끝 8까지다. 흰 판은 없다.
    const 자리 = await 카드자리끝(page);
    expect([자리.x, 자리.y, 자리.right, 자리.bottom], "카드 자리").toEqual([side.right, row, viewport.width - 8, viewport.height - 8]);
    await expect(page.locator('[data-slot="panel"]'), "흰 판은 걷혔다").toHaveCount(0);

    // 본문 카드 — 카드 자리 왼쪽 위에서 아래끝까지 서고, 둥글기 8 · 0.5 링 · 면 `surface`다(터미널 카드의 면은 테마의 바탕이다).
    await expect(page.locator("main")).toHaveCount(1);
    const card = await 본문카드(page);
    expect([card.x, card.y, card.bottom], "본문 카드 — 카드 자리 안").toEqual([자리.x, 자리.y, 자리.bottom]);
    expect(card.right, "본문 카드는 카드 자리 안에서 끝난다").toBeLessThanOrEqual(자리.right);
    expect(card.radius, "카드 둥글기 — rounded-card 8").toBe("8px");
    expect(그림자(card.shadow), "카드 링 — shadow-hairline").toBe(await 토큰값(page, "box-shadow", "--shadow-hairline"));
    if (card.tone !== "terminal") expect(card.fill, "카드의 면").toBe(await 토큰색(page, "--surface"));

    // 화면 자리 — 셸 컨트롤 끝 + 6에서 시작하고(사이드바와 무관), 화면이 보낸 것이 있으면 앞에 세로선이 선다.
    const slot = 화면머리(page);
    const search = await boxOf(창검색버튼(page));
    expect((await boxOf(slot)).x, "화면 자리 왼쪽 끝 = 셸 컨트롤 끝 + 6").toBe(search.right + 6);
    const 선 = await slot.evaluate((el) => {
      const style = getComputedStyle(el, "::before");
      const 선다 = style.display !== "none" && style.content !== "none" && style.content !== "normal";
      return [선다, style.width, style.top, style.bottom, style.backgroundColor];
    });
    if (address.head) {
      expect(선, "화면 자리 앞 세로선").toEqual([true, "0.5px", "14px", "14px", await 토큰색(page, "--border-heavy")]);
    } else {
      await expect(slot, "새 Thread는 머리 줄에 보내는 것이 없다").toBeEmpty();
      expect(선[0], "보낸 것이 없으면 세로선도 없다").toBe(false);
    }
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// **화면 자리는 사이드바를 따르지 않는다**(restart 02a-7 · 시안 MainLoose) — 사이드바를 끌어도 ⌘B로 접어도 셸 컨트롤 끝 + 6 그대로이고
// 세로선도 그대로다. 본문 카드만 사이드바 끝을 따른다(접히면 사이드바 상자가 틈 8로 남아 카드가 x 8에 선다 — 02a-2). 한때(02 §3 – 02a-6)
// 화면 자리는 열렸으면 판 안 왼쪽 끝, 접혔으면 셸 컨트롤 끝 + 8에서 세로선 없이 섰다.
test("Thread: 사이드바를 끌어도 ⌘B로 접어도 머리 줄 화면 자리와 세로선은 그대로이고, 본문 카드만 사이드바 끝을 따른다", async ({ page }) => {
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
  const 카드 = async () => (await 본문카드(page)).x;
  const before = await 끝();
  const head = (await boxOf(창검색버튼(page))).right + 6;
  expect(await 자리(), "앵커: 화면 자리가 셸 컨트롤 끝 + 6에서 시작한다").toBe(head);
  expect(await 카드(), "본문 카드는 사이드바 끝에서 선다").toBe(before);

  // 사이드바 오른쪽 끝의 폭 손잡이를 40 오른쪽으로 끈다 — 사이드바가 넓어지고 본문 카드가 그 끝을 따른다. 화면 자리는 그대로다.
  const handle = await boxOf(사이드바(page).locator('[title="드래그로 폭 조절 · 더블클릭으로 기본 폭"]'));
  const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(끝).toBe(before + 40);
  await expect.poll(카드).toBe(before + 40);
  expect(await 자리(), "끈 뒤에도 화면 자리는 그대로").toBe(head);
  expect(await 선(), "열린 동안 세로선").toBe(true);

  // ⌘B — 접으면 사이드바 상자가 틈 8로 남아 본문 카드가 x 8에 선다. 화면 자리와 세로선은 그대로다. 다시 펴면 끈 폭의 끝으로 돌아온다.
  await page.keyboard.press("Meta+b");
  await expect.poll(카드).toBe(8);
  expect(await 자리(), "접힌 동안에도 화면 자리는 그대로").toBe(head);
  expect(await 선(), "접힌 동안에도 세로선").toBe(true);
  await page.keyboard.press("Meta+b");
  await expect.poll(카드).toBe(before + 40);
  expect(await 자리()).toBe(head);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 위 줄 세 행과 ⌘N ──────────────────────────────────────────────────────────────────────────────────────────────

const permission = record("thread-permission");
const ASKED = lineOf(permission, "permission", "asked");
/** 승인을 묻고 기다리는 Thread — 나를 기다린다(내 차례). */
const asking = threadOf("20261025-090100", permission, { live: true, lastSeq: ASKED.seq });

// **위 칸은 새 Thread · 내 차례로 시작한다**(02 구현 스펙 §4 — 01a-1이 Library를 걷었다 · restart 02a-3 — 그 뒤로 가는 곳 다섯이 선다), 행
// 모양은 다른 사이드바 줄과 같은 30 · 줄 사이 2(시안 `.ra-sr-row`)이고 첫 행이 머리 줄 바로 밑에 선다(02a-3이 위 안쪽 여백을 걷었다 — 한때
// 머리 줄 밑 + 2 · 간격 31이었다. 그 앞에는 「전체 | 내 차례」 마디가 섰다). 「새 채팅」 끝에는 그 키 ⌘N이 옅게(12 · 3단계 색 `fg-tertiary`)
// 행 안쪽 오른쪽 끝에 선다 — 보이는 글은 「새 채팅 ⌘N」이지만 이름은 「새 채팅」이고 키는 `aria-keyshortcuts`가 말한다. 「내 차례」 끝에는
// 나를 기다리는 Thread 수가 파랗게(12/500 `mine`) 서고 이름에 함께 든다(「내 차례 1」). 0이면 비는 것은 `thread-sidebar.spec.ts`가 잰다.
test("위 칸 첫 두 행이 머리 줄 바로 밑부터 30 · 줄 사이 2로 서고 — 새 Thread 끝에 ⌘N이 옅게, 내 차례 끝에 기다리는 수가 파랗게 선다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(asking)],
    thread_get: answerByArg("thread", { [asking.id]: asking }),
    thread_read_record: answerByArg("thread", { [asking.id]: linesThrough(permission, ASKED.seq) }),
  });
  await page.goto("/");
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });
  const 새Thread = 위줄(page, "새 채팅");
  const 내차례 = 위줄(page, "내 차례 1");
  await expect(내차례).toBeVisible();

  const header = await boxOf(page.locator("header"));
  const rows = await Promise.all([새Thread, 내차례].map((one) => boxOf(one.locator(".."))));
  expect(rows.map((one) => one.height), "행 높이").toEqual([30, 30]);
  expect(rows.map((one) => one.y - header.bottom), "머리 줄 밑에서 — 0 · 줄 사이 2").toEqual([0, 32]);

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
//
// **씨앗을 단 새 Thread에서도 먹는다**(02 코드 리뷰 S1) — +로 연 「새 작업공간」(`/?new=work`)와 그 Work를 고른 새 Thread(`/?work=<slug>`)도 `/`라,
// 한때 가드가 거기서 키를 삼켜 Work 칩이 그대로 남았다. 거기서는 위 줄 「새 채팅」이 고른 줄이 아니고(눌러도 그 자리일 때만 고른 줄이다 —
// 가드와 같은 물음 `isBlankNewThread`), ⌘N이 씨앗을 걷어 Work 칩이 사라지며 그 행이 고른 줄이 된다. 같은 함수를 부르는 행을 눌러도 같다.
test("⌘N이 Thread · Processes · 셸에 포커스가 선 Terminal · 씨앗을 단 새 Thread에서 새 Thread를 열고, 확인 창 · 팔레트가 떠 있으면 안 연다", async ({
  page,
}) => {
  await installFixtureBackend(page, THREAD_ANSWERS);
  const 새Thread로간다 = async (from: string) => {
    await page.keyboard.press("Meta+n");
    await expect(page, `${from}에서 ⌘N`).toHaveURL("/");
    await expect(첫화면(page)).toBeVisible();
  };

  await page.goto(`/threads/${thread.id}`);
  await expect(page.getByRole("main", { name: thread.title, exact: true })).toBeVisible({ timeout: 20_000 });
  await 새Thread로간다("채팅");

  await page.goto("/processes");
  await expect(page.getByRole("heading", { name: "Processes", exact: true })).toBeVisible();
  await 새Thread로간다("Processes");

  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await expect(셸입력(page), "앵커: 셸에 포커스가 있다").toBeFocused();
  await 새Thread로간다("셸에 포커스가 선 Terminal");

  // 씨앗을 단 새 Thread 둘 — 씨앗을 말하는 것이 앵커다(이미 첫 화면이다). `?new=work`는 트레이의 「새 작업공간」 칩, `?work=`는 그 작업공간의 새 채팅
  // 탭이라(restart 02a-8) 그 이름을 부르는 빈 칸의 말이다(restart 02b-2 — 한때 트레이의 잠긴 Work 칩). 고른 줄은 행 버튼을 품은 상자의
  // `selected-row`다(`SidebarItem`).
  const 트레이 = page.locator('[data-slot="composer-tray"]');
  const 새Thread줄 = 위줄(page, "새 채팅").locator("..");
  for (const [from, chip] of [
    ["/?new=work", 트레이.locator('[data-slot="new-work-chip"]')],
    [`/?work=${plainWork.slug}`, page.getByPlaceholder(`${plainWork.title}에서 무엇을 할까요?`, { exact: true })],
  ] as const) {
    for (const how of ["⌘N", "「새 채팅」"] as const) {
      await page.goto(from);
      await expect(첫화면(page)).toBeVisible();
      await expect(chip, `${from} — 씨앗`).toBeVisible();
      await expect(새Thread줄, `${from} — 고른 줄이 아니다`).not.toHaveClass(/\bselected-row\b/);
      if (how === "⌘N") await 새Thread로간다(from);
      else {
        await 위줄(page, "새 채팅").click();
        await expect(page, `${from}에서 ${how}`).toHaveURL("/");
      }
      await expect(chip, `${from}에서 ${how} — 씨앗이 걷혔다`).toHaveCount(0);
      await expect(새Thread줄, `${from}에서 ${how} — 고른 줄`).toHaveClass(/\bselected-row\b/);
    }
  }

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

  // 확인 창 — Project 제거를 묻는 동안 ⌘N은 화면을 옮기지 않는다. 창을 닫으면(취소) 먹는다. 제거는 목록 줄 ⋯ 안에만 있다(03 §16).
  await page.goto("/projects");
  await page.getByRole("button", { name: `${PROJECTS[0].name} 메뉴`, exact: true }).click();
  await page.getByRole("menuitem", { name: "제거…", exact: true }).click();
  const 확인 = page.getByRole("alertdialog");
  await expect(확인).toBeVisible();
  await page.keyboard.press("Meta+n");
  await expect(확인).toBeVisible();
  await expect(page).toHaveURL("/projects");
  await page.keyboard.press("Escape");
  await expect(확인).toHaveCount(0);
  await expect(page).toHaveURL("/projects");
  await 새Thread로간다("확인 창을 닫은 Projects");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **「내 차례」를 켠 동안 위 줄의 고른 줄은 그 하나다**(02 구현 스펙 §4 — 「그동안 행은 고른 모양이다. 다시 누르거나 다른 행을 고르면
// 돌아온다」). 지금 주소의 행(새 Thread)은 고른 모양을 내려놓고, 그 행을 누르면 거르기가 풀려 그 행이 고른 줄이다. 다시 눌러 끄는 길과 기다리는 순서 목록은 `thread-waiting.spec.ts`가 잰다.
test("「내 차례」를 켠 동안 새 Thread는 고른 모양을 내려놓고, 그 행을 누르면 거르기가 풀려 그 행이 고른 줄이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/");
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });
  const [새Thread, 내차례] = [위줄(page, "새 채팅"), 위줄(page, "내 차례")];
  /** 두 행의 면 — 면은 색 전환(`transition-colors`)으로 바뀌어, 바뀐 뒤에는 전환이 끝날 때까지 기다려 읽는다. */
  const 면들 = async () => [await 면(새Thread), await 면(내차례)];
  const 고른면 = await 면(새Thread);
  const 빈면 = "rgba(0, 0, 0, 0)";
  // 앵커: 첫 화면에서는 새 Thread가 고른 줄이다 — 고른 면이 빈 면과 다르다.
  expect(고른면, "새 Thread의 고른 면").not.toBe(빈면);
  expect(await 면(내차례)).toBe(빈면);

  await 내차례.click();
  await expect(내차례).toHaveAttribute("aria-pressed", "true");
  await expect.poll(면들, { message: "켠 동안 — 내 차례만 고른 줄" }).toEqual([빈면, 고른면]);

  // 새 Thread를 누르면 거르기가 풀리고 새 Thread가 다시 고른 줄이다.
  await 새Thread.click();
  await expect(page).toHaveURL("/");
  await expect(내차례).toHaveAttribute("aria-pressed", "false");
  await expect.poll(면들).toEqual([고른면, 빈면]);
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
  // 눈을 떼는 길은 ⌘T의 새 채팅 탭이다(restart 02a-8 — 한때 spec 칸을 눌렀다).
  await page.keyboard.press("Meta+t");
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

// **Work 묶음 머리 끝의 +는 「작업공간 만들기」다**(02 구현 스펙 §4 · S5) — 새 Thread를 열어 「새 작업공간」 칩을 세운다(`/?new=work`). 머리를 접어도
// 선다. 목록의 Tab 정류장이 아니다(핀과 같다). **Work가 없으면** 머리 아래에 안내 한 줄이 선다(S6 — 12 · 3단계 색) — 그때도 +가 새 Work의 길이다.
// ×로 빼는 것 · 고른 것이 첫 말과 함께 가는 것은 `thread-work-chip.spec.ts`가 잰다.
test("Work 묶음 머리 끝 +가 「작업공간 만들기」로 새 Thread를 열고 — 머리를 접어도 서며 Tab 정류장이 아니다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/processes");
  const plus = 사이드바(page).getByRole("button", { name: "작업공간 만들기", exact: true });
  const 머리 = 사이드바(page).getByRole("button", { name: /^작업공간 \d+$/ });
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
  await expect(page.getByRole("button", { name: "새 작업공간 빼기", exact: true })).toBeVisible();
  await expect(첫화면(page)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Work가 없으면 Work 묶음 머리 아래에 안내 한 줄이 12 · 3단계 색으로 서고, + 는 그대로다", async ({ page }) => {
  await installFixtureBackend(page, { list_works: [] });
  await page.goto("/processes");
  const plus = 사이드바(page).getByRole("button", { name: "작업공간 만들기", exact: true });
  const 머리 = 사이드바(page).getByRole("button", { name: /^작업공간( \d+)?$/ });
  const 안내 = 사이드바(page).getByText("아직 작업공간이 없어요. 말로 시작하면 Runtime이 작업공간으로 묶어 줘요.", { exact: true });
  await expect(안내).toBeVisible();
  expect(await 칠한값(안내, "font-size", "color"), "안내 글자").toEqual(["12px", await 토큰색(page, "--fg-tertiary")]);
  expect((await boxOf(안내)).y, "안내는 머리 아래").toBeGreaterThanOrEqual((await boxOf(머리)).bottom);
  await expect(plus).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 위 칸의 가는 곳과 맨 아래 설정 ─────────────────────────────────────────────────────────────────────────────

// **지금 화면들은 위 칸의 줄이다**(restart 02a-3 · 스토리 86 · 시안 Main의 「가는 곳」) — 「새 채팅」 · 「내 차례」 뒤로 Services · Projects ·
// Terminal · Processes · Archive가 사이드바 줄의 결로 선다: 30 · 둥글기 4(`radius-ctl`) · 13 `fg-sidebar` · 글리프 15 `fg-secondary`, 지나는 면
// `fill-soft`, 지금 화면의 줄은 고른 면 `fill-hover` · 글자 `fg`(`aria-current="page"`). **메모리 합계는 `Processes` 줄 끝이다**(S12). 합계 글자는
// 화면이 쓰는 표기 함수로 짓는다 — 픽스처의 기본 합계(3.4GB)가 아니라 이 시나리오의 값이다. `●`(손볼 것)는 `processes-nav-meta.spec.ts`가 잰다.
// Projects · Services 줄 끝에는 수가 없다(시안 위 칸). **설정은 맨 아래 「설정」 줄 하나다**(시안 `.ra-sr-foot` — 「설정 ⌘,」) — 키는 이름이
// 아니라 `aria-keyshortcuts`가 말한다.
//
// 한때(v1 S27 – 02a-2) 다섯과 Settings는 맨 아래 사람 줄(「홍길동 — 사람 메뉴」)이 여는 메뉴의 항목이었다 — 메뉴는 사람 줄 폭으로 그 위 6에
// 떴고, 줄은 30 · 둥글기 8 · 14였으며 Projects · Service 끝에 수가 섰다. 02a-3이 메뉴를 걷었다.
test("위 칸에 가는 곳 다섯이 사이드바 줄의 결로 서고 — Processes 줄 끝에 앱 전체 메모리 합계가 서며 지금 화면의 줄이 골라져 있고, 맨 아래에 「설정」이 선다", async ({
  page,
}) => {
  const summary = 요약({ total: 1_234_567_890 });
  await installFixtureBackend(page, { processes_summary: summary });
  await page.goto("/projects");
  await expect(page.getByRole("table", { name: "Project 목록", exact: true })).toBeVisible({ timeout: 20_000 });
  const total = formatMemory(summary.total);

  // 차례 — 새 채팅 · 내 차례 뒤로 다섯(시안 Main 위 칸의 차례). 사람 줄 · 메뉴는 없다.
  await expect(위칸(page).getByRole("button")).toHaveText([/^새 채팅/, /^내 차례/, /^Services$/, /^Projects$/, /^Terminal/, /^Processes/, /^Archive$/]);
  await expect(page.getByRole("button", { name: /— 사람 메뉴$/ })).toHaveCount(0);
  await expect(위칸줄(page, "Processes")).toContainText(total);

  // 줄 — 30 · `radius-ctl` · 13 `fg-sidebar`, 글리프 15 `fg-secondary`. 면은 줄 버튼을 품은 상자가 칠한다. 지금 화면(Projects)의 줄은 따로 잰다.
  const 고른줄 = [await 토큰색(page, "--fill-hover"), await 토큰색(page, "--fg")];
  for (const label of ["Services", "Projects", "Terminal", "Processes", "Archive"] as const) {
    const one = 위칸줄(page, label);
    const 지금 = label === "Projects";
    expect(await 칠한값(one.locator(".."), "height", "border-top-left-radius"), `「${label}」 줄`).toEqual([
      "30px",
      await 토큰값(page, "border-top-left-radius", "--radius-ctl"),
    ]);
    expect(await 칠한값(one, "font-size"), `「${label}」 글자 크기`).toEqual(["13px"]);
    expect((await 칠한값(one.locator(".."), "color"))[0], `「${label}」 글자`).toBe(지금 ? 고른줄[1] : await 토큰색(page, "--fg-sidebar"));
    expect(await 칠한값(one.locator("svg").first(), "width", "height", "color"), `「${label}」 글리프`).toEqual([
      "15px",
      "15px",
      await 토큰색(page, "--fg-secondary"),
    ]);
  }
  // 지금 줄 — Projects 화면이라 「Projects」 줄 하나가 고른 면 · `fg` 글자다(포인터가 닿기 전에도).
  await expect(위칸(page).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(위칸줄(page, "Projects")).toHaveAttribute("aria-current", "page");
  expect(await 칠한값(위칸줄(page, "Projects").locator(".."), "background-color", "color"), "지금 줄 — Projects").toEqual(고른줄);
  // 지나는 줄 — 포인터가 가리킨 줄은 지나는 면 `fill-soft`다(고른 면보다 옅다).
  const services = 위칸줄(page, "Services").locator("..");
  await 위칸줄(page, "Services").hover();
  await expect.poll(async () => (await 칠한값(services, "background-color"))[0]).toBe(await 토큰색(page, "--fill-soft"));

  // 맨 아래 「설정」 — 이름은 「설정」이고 키(⌘,)는 `aria-keyshortcuts`다. 사이드바 줄의 결이다.
  const settings = page.locator("aside[data-sidebar]").getByRole("button", { name: "설정", exact: true });
  await expect(settings).toHaveAttribute("aria-keyshortcuts", "Meta+,");
  expect(await 칠한값(settings.locator(".."), "height"), "「설정」 줄").toEqual(["30px"]);

  // Services 화면에서는 「Services」 줄이 지금 줄이다(스토리 9).
  await 위칸줄(page, "Services").click();
  await expect(page.getByRole("table", { name: "Service 목록", exact: true })).toBeVisible();
  await expect(위칸(page).locator('[aria-current="page"]')).toHaveText(/^Services$/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 머리 카드였던 화면들의 머리 줄 ──────────────────────────────────────────────────────────────────────────────

// codex-ds 티켓 14 · 02 티켓 03 — **어느 화면이든 머리 줄의 같은 자리에서 그 화면의 이름과 할 일을 찾는다**(codex-ds 스펙 §7 · 스토리 27 · 52 ·
// 59 · 60 · 02 구현 스펙 §3 S2). 한때 그 자리에 머리 카드가 떴다 — 카드의 겉만 버리고 안은 그대로 머리 줄에 바로 선다. 왼쪽은 그 화면 · 고른
// 것의 이름(과 그 안의 위치)이고, 오른쪽 끝은 그 화면의 머리 조작이다. **이름 앞에 아이콘이 없다**(restart 03-12a · 시안 Main — 한때 화면마다
// nav 아이콘 · 작업공간 ⚡가 섰다). 이름은 13/18 · 400이고(한때 14/500) 이름 상자가 안쪽 6 · 바깥 −6이라 글자가 흐름 자리(세로선 뒤 10)에
// 선다. 캔버스에만 있던 조작(Projects 「LLM이 받는 텍스트」 · Processes 「새로 고침」 · 「고아 정리」)은 짓지 않았다(codex-ds 스펙 S13 · 결정 31).
// 조작은 역할 · 이름으로 집고, 모두 28로(아이콘 단추 · 글자 단추 — Thread 머리 줄과 한 벌, 02 티켓 03b) 머리 줄 가운데에 선다. 본문 칸에 고를
// 것이 남지 않은 화면은 본문 칸에 머리가 없다. 작업 화면의 머리 줄은 `frame.spec.ts`가 잰다. Projects · Services · Archive는 03 판에서 이 표를
// 떠났다 — 아래 「Projects · Services · Archive」 시험(restart 03-4 — 한때 Archive 상세의 머리 줄에 아카이브 메뉴 · spec 목록 접기가 섰다).
const HEAD_SCREENS: {
  name: string;
  url: string;
  overrides?: Record<string, unknown>;
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
    name: "Processes",
    url: "/processes",
    words: ["Processes"],
    // 머리 줄에는 이름만 선다 — [조용한 셸 모두 닫기]는 몸의 머리(h1 「Processes」 옆)로 옮겼다(restart 03-11 · 시안 Processes `.pr-head`).
    controls: [],
    absent: ["새로 고침", "고아 정리"],
  },
  {
    name: "Settings",
    url: "/settings/terminal",
    words: ["Settings", "터미널"],
    sub: true,
    controls: ["저장"],
    absent: [],
  },
  {
    name: "레이아웃 편집기",
    url: SPEC_LAYOUT_EDITOR,
    words: ["Settings", "spec 레이아웃", "Atelier"],
    sub: true,
    controls: ["설정으로 돌아가기", "LLM이 받는 텍스트", "저장"],
    absent: [],
  },
  { name: "Terminal", url: "/terminal", words: ["Terminal"], controls: [], absent: [] },
  {
    name: "Works(고른 작업 없음)",
    url: "/works",
    overrides: { list_works: [] },
    words: ["작업공간"],
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

    // 왼쪽 — 아이콘 없이 이름(그 뒤 위치)이 차례로 선다. 이름을 글자로 집으면 이름 상자(DS `.at-wtitle`)가 잡혀, 이름 글자의 자리는 그 안
    // 글자 마디로 잰다(`첫글자`). 이름 앞에는 단추 밖의 글리프가 없다(단추 안의 글리프 — 「설정으로 돌아가기」 — 는 할 일이고, 위치 사이의
    // 꺾쇠는 이름 뒤다).
    const slot = await boxOf(head);
    const words = await Promise.all(
      screen.words.map((word) => boxOf(head.getByText(word, typeof word === "string" ? { exact: true } : undefined))),
    );
    const name = head.getByText(screen.words[0], { exact: true });
    const nameText = await 첫글자(name);
    const 앞글리프 = await head.evaluate(
      (el, 끝) => [...el.querySelectorAll("svg")].filter((svg) => !svg.closest("button") && svg.getBoundingClientRect().right <= 끝).length,
      nameText.x,
    );
    expect(앞글리프, "이름 앞 아이콘 없음").toBe(0);
    expect(await 칠한값(name, "font-size", "font-weight"), "이름 13 · 400").toEqual(["13px", "400"]);
    expect(nameText.x - slot.x, "이름 글자 — 세로선 뒤 10").toBeGreaterThanOrEqual(10);
    for (let at = 1; at < words.length; at += 1) {
      expect(words[at].x, `${screen.words[at]}가 앞 글자 뒤에 선다`).toBeGreaterThanOrEqual(words[at - 1].right);
    }
    // 이름 끝에서 그 뒤 옅은 글자(`sub`)까지는 6이다 — 이름 상자가 바깥 −6으로 제 안쪽을 되돌려 위치의 왼쪽 6만 남는다(restart 03-12a —
    // 한때 이름 상자의 오른쪽 안쪽 8 + 위치의 왼쪽 6 = 14).
    if (screen.sub) expect(words[1].x - nameText.right, "이름 끝 → 위치").toBeCloseTo(6, 1);

    // 오른쪽 끝 — 할 일은 이 버튼들뿐이고 차례가 이렇다. 모두 28이고 머리 줄 가운데에, 화면 자리 안에 선다.
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

    // 창 끌기 — 머리 줄의 빈 자리와 보이기만 하는 것(이름 · 위치 · 배지 글자)을 누르면 창이 끌린다. 누를 것(조작 · 메뉴가 있거나 바꿀 수
    // 있는 이름)은 끌지 않는다.
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
    // 왼쪽 안쪽은 세로선과 첫 글자 사이다 — 첫 글자는 자리 + 10이고, 당김 6을 둔 조작(편집기의 「설정으로 돌아가기」)은 자리 + 4에서
    // 시작한다(02a-7 — Works의 Service는 restart 03-12a부터 자리 + 10). 그 앞 + 2를 누른다.
    expect(await 끄는자리(page, slot.x + 2, middle), "화면 자리 왼쪽 안").toBe(true);

    // 고를 것이 남지 않은 본문 칸에는 머리가 없다 — 위치와 할 일은 머리 줄이 말한다(목록 칸의 찾기 칸 · 머리는 `main` 밖이다).
    await expect(page.locator('main [data-slot="card-head"]')).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// **Projects · Services · Archive 화면의 머리 줄은 Thread 화면들과 한 결이다**(03 구현 스펙 §14 · §16 · 캔버스 F1-Projects · F1-ProjectDetail ·
// F1-Spaces · F1-SpaceDetail · restart 03-4) — 아이콘 없이 이름 하나(13/18 · 400 — restart 03-12a, 한때 14/500)이고, 상세는 이름 앞에 목록으로
// 가는 「Projects /」 · 「Services /」 · 「Archive /」가 선다. 머리 줄에 할 일이 없다 — 목록의 「Project 추가」 · 「만들기」와 상세의 할 일은
// 판 머리에 선다. 한때 Projects는 위 표의 한 칸이었다(폴더 아이콘 · 「폴더 열기」 · 「제거」), Archive 상세는 머리 줄에 아카이브 메뉴 · spec
// 목록 접기를 세웠다. 그 안의 칸 · 단추는 Projects · Service · Archive 흐름 spec이 잰다.
const PLACE_HEADS: { url: string; main: string; words: string[]; crumb?: string }[] = [
  { url: "/projects", main: "Projects", words: ["Projects"] },
  { url: `/projects/${PROJECTS[0].slug}`, main: "Projects 상세", words: ["Projects", "/", PROJECTS[0].name], crumb: "Projects" },
  { url: "/services", main: "Services", words: ["Services"] },
  { url: `/services/${encodeURIComponent(SERVICES[0].slug)}`, main: "Services 상세", words: ["Services", "/", SERVICES[0].name], crumb: "Services" },
  { url: "/archive", main: "Archive", words: ["Archive"] },
  { url: `/archive/${ARCHIVE[0].slug}`, main: "Archive 상세", words: ["Archive", "/", ARCHIVE[0].title], crumb: "Archive" },
];

test("Projects · Services · Archive 목록과 상세: 머리 줄에 아이콘 없는 이름이 서고, 상세는 목록으로 가는 이름 앞이 서며 할 일이 없다", async ({ page }) => {
  await installFixtureBackend(page);
  for (const screen of PLACE_HEADS) {
    await page.goto(screen.url);
    await expect(page.getByRole("main", { name: screen.main, exact: true })).toBeVisible({ timeout: 20_000 });
    const head = 화면머리(page);
    await expect(head, screen.url).toHaveText(screen.words.join(""));
    await expect(head.locator("svg"), `${screen.url} — 아이콘 없음`).toHaveCount(0);
    await expect(head.getByRole("button"), `${screen.url} — 머리 줄의 단추는 이름 앞뿐`).toHaveText(screen.crumb ? [screen.crumb] : []);
    const name = head.getByText(screen.words[screen.words.length - 1], { exact: true });
    expect(await 칠한값(name, "font-size", "line-height", "font-weight"), `${screen.url} — 이름 13/18 · 400`).toEqual(["13px", "18px", "400"]);
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});
