import { expect, test, type Locator, type Page } from "./evidence";
import { FIXTURE_THREAD, PROJECTS, WORKS } from "./fixtures";
import {
  awaitSpawned,
  installFixtureBackend,
  markAttention,
  SPEC_LAYOUT_EDITOR,
  unknownIpcCalls,
  workRow,
  띠,
  설정줄,
  줄표시,
  첫글자,
  칠한값,
  토큰값,
  표줄,
} from "./harness";
import { settle } from "./tab-row";

// codex-ds 티켓 25 — **화면의 여백이 세 줄에 맞는다**(스펙 §4 「여백」 · DS README 「간격 · 반경 · 크기」 · DS `AppShell`). 틈 8(`space-2`)은
// 창 끝 · 카드 사이 · 카드 끝에서 행까지이고, 행 글자 16(`space-4` = 틈 8 + 행 안쪽 8)은 사이드바 행 · 소제목 · 카드 머리 제목 · 탭
// 아이콘 · 찾기 아이콘이 서는 세로줄이며, 글 거터 20(`space-5`)은 문서 · 설정 글의 옆이다(글은 위 24 — `space-6`에서 시작한다). 한 줄에
// 서야 할 것들이 1px씩 갈리면 화면에서는 「조금 들쭉날쭉」으로만 남아 눈으로는 안 지켜진다 — 사이드바 행 글자가 17, 편집기 트리 행이
// 18, Processes 몸이 24이던 것이 그렇게 남았다.
//
// 틈 8은 `frame.spec`이 화면마다 잰다. 문서 글의 거터는 `path-bar.spec`이, 설정 글과 편집기 폼의 거터는 `settings-group.spec`이 잰다.
// 여기는 행 글자 16이 서는 자리들과, 그 밖의 거터 자리(Projects 목록 · 상세 · Processes)를 잰다. Projects는 공용 목록 틀의 값이다(restart
// 03-1 — 위 36 · 옆 56, DS 눈금 밖의 판 값이라 수로 적는다).
//
// 글자 · 아이콘의 x는 **그것이 그려진 자리**로 잰다 — 글자는 `Range`의 상자, 아이콘은 svg의 상자다(요소의 상자는 안쪽 여백을 품는다).
// 길이는 토큰에서 읽는다(`index.css`의 `--space-*` — Tailwind 눈금 `--spacing`의 그 칸과 같은 값이다, `spacing-guard.test.ts`).

const [pinnedWork, plainWork, multiWork] = WORKS;
const [billing] = PROJECTS;

/** DS 간격 토큰 `space-N`의 길이(px). */
const 간격 = async (page: Page, n: number) => parseFloat(await 토큰값(page, "width", `--space-${n}`));

async function 상자(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("상자를 못 읽었다");
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

/** 그 안 첫 아이콘(svg)의 상자. */
const 아이콘 = (scope: Locator) => 상자(scope.locator("svg").first());

test("사이드바: nav · 알림 띠 · 구획 소제목 · work 행 · 맨 아래 설정 줄의 행 글자가 사이드바 끝에서 16이고, 수 · 표시의 오른쪽 끝은 행 끝에서 8이다", async ({
  page,
}) => {
  // work 행의 레인 위에 그 Work의 Thread를 펴는 ▸가 겹쳐 선다(v1 티켓 37 · 46) — 이은 Thread가 있어야 선다. 고정된 일에 Thread 하나를
  // 잇는다.
  await installFixtureBackend(page, {
    thread_list: [
      {
        id: FIXTURE_THREAD.id,
        title: FIXTURE_THREAD.title,
        createdAt: FIXTURE_THREAD.createdAt,
        lastAt: FIXTURE_THREAD.createdAt,
        work: pinnedWork.slug,
        service: null,
        project: null,
        lastRead: 0,
        readOnly: null,
        broken: null,
      },
    ],
  });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  // 알림 띠는 부를 때만 선다 — 기다림 하나로 세운다.
  await markAttention(page, { agent: "claude", event: "Elicitation", at: Date.now(), payload: { message: "커밋할까요?" } });
  await expect(띠(page)).toHaveCount(1);

  const [틈, 행글자] = [await 간격(page, 2), await 간격(page, 4)];
  // 앵커: 두 토큰을 실제로 읽었고 DS 값이다 — 틈 8 + 행 안쪽 8이 행 글자 16이다.
  expect([틈, 행글자]).toEqual([8, 16]);
  const sidebar = await 상자(page.locator("aside").first());
  // 사이드바는 카드 밖 크롬 위, 창 왼쪽 끝 0에 서고 안쪽 좌우가 8이다(restart 02a-2 — 상자는 `frame-sidebar.spec`이 잰다). 한때 창 왼쪽
  // 끝 + 5(03 구현 스펙 §3)였고, 그보다 앞에는 흰 판 안 왼끝에 붙었다(02 티켓 02). 행 글자 16은 그 끝에서 잰다.
  expect(sidebar.x, "사이드바가 창 왼쪽 끝 0에 선다").toBe(0);

  const 자리: [string, Promise<number>][] = [
    // 위 칸(「가는 곳」)의 첫 줄은 「새 채팅」이다 — 그 뒤에 「내 차례」와 지금 화면 다섯이 선다(restart 02a-3).
    ["nav 아이콘", 아이콘(page.getByRole("navigation", { name: "가는 곳", exact: true }).getByRole("button", { name: "새 채팅", exact: true })).then((box) => box.x)],
    ["알림 띠 머리 글자", 첫글자(띠(page)).then((box) => box.x)],
    ["알림 띠 줄의 점 레인", 상자(띠(page).getByRole("button", { name: `${plainWork.title} — 나를 기다림` }).locator("span").first()).then((box) => box.x)],
    ["구획 소제목 글자", 첫글자(page.locator("aside [data-section]").first()).then((box) => box.x)],
    // 레인(늘 폴더 — 02 티켓 05)이 행 맨 앞이다 — Codex 사이드바의 폴더 아이콘 칸(16)이다(v1 티켓 46). 한때 그 앞에 ▸의 제 칸이 섰다.
    ["work 행의 레인", 상자(workRow(page, pinnedWork.slug).locator("[data-lane]")).then((box) => box.x)],
    // 맨 아래는 「설정」 줄이다(restart 02a-3 — 한때 사람 줄의 얼굴 원이 이 자리에 섰다). 글리프가 행 글자 자리에 선다.
    ["맨 아래 설정 줄의 글리프", 아이콘(설정줄(page)).then((box) => box.x)],
  ];
  for (const [이름, x] of 자리) expect((await x) - sidebar.x, `${이름} — 사이드바 끝 + 16`).toBe(행글자);
  // ▸는 레인 가운데에 겹쳐 선다 — 가리키면 레인이 비키고 그 자리에 ▸가 선다(v1 티켓 46). 쉴 때는 투명해도 자리는 그대로다.
  const [레인, 펼침] = [
    await 상자(workRow(page, pinnedWork.slug).locator("[data-lane]")),
    await 아이콘(workRow(page, pinnedWork.slug).locator("[data-expander]")),
  ];
  expect(펼침.x + 펼침.width / 2, "▸ 가운데 = 레인 가운데").toBeCloseTo(레인.x + 레인.width / 2, 1);

  // 오른쪽도 행 안쪽 8이다(DS `.at-row` · `.at-band-head`의 좌우 8) — 띠 머리의 수 · work 행 끝의 상태 표시가 그 상자 끝에서 8에
  // 선다. 구획 머리의 수는 눈에서 걷혔다(v1 티켓 46 — 이름에만 남는다). work 행의 이은 Thread 수는 호버 카드로 갔고(02 티켓 05) 그
  // 자리에 표시 하나가 선다 — 기다리는 셸의 Work라 「내 차례」다(S8).
  const 띠머리 = 띠(page).locator("[data-band-count]");
  const 표시 = 줄표시(page, plainWork.slug);
  await expect(표시).toHaveAttribute("data-mark", "mine");
  expect((await 상자(띠(page))).right - (await 첫글자(띠머리)).right, "띠 수 — 띠 끝에서 8").toBeCloseTo(틈, 0);
  expect((await 상자(workRow(page, plainWork.slug))).right - (await 상자(표시)).right, "상태 표시 — 행 끝에서 8").toBeCloseTo(틈, 0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("사이드바: 알림 띠는 nav 끝에서 8 아래에 서고, 구획 소제목은 nav 끝 줄에서 42 · 첫 행까지 32 · 앞 구획의 끝 행에서 42다(가운데끼리)", async ({
  page,
}) => {
  // 사이드바의 세로는 restart 시안 값이다(02a-3 · 시안 `.ra-sr-label`의 위 10 + 줄 사이 2 · 머리 30 · 줄 30 — 한때 Codex 대화 사이드바를
  // 잰 값 34 · 54 · 줄 사이 1이었다). 소제목(구획 머리 30 가운데의 라벨)은 nav 끝 줄 가운데에서 42 아래에 서고, 그 가운데에서 첫 행
  // 가운데까지 32, 앞 구획의 끝 행 가운데에서 다음 소제목 가운데까지 42다. 띠(`.at-band`)의 위 바깥 8은 DS 값 그대로라 띠가 서면 nav 끝 + 8에 서고, 소제목은 nav 끝 줄 대신 띠 끝에서 27
  // (42 − 줄 절반 15) 아래다. 가운데끼리 재는 것은 Codex 그림을 그렇게 쟀기 때문이다 — 글자 줄 높이가 갈려도 눈에 보이는 사이가 같다.
  // 한때 DS 기둥의 값(소제목 글자 줄이 앞 것 끝 + 14 · 첫 행까지 8)이었다.
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  const nav = page.getByRole("navigation", { name: "가는 곳", exact: true });
  const [고정머리, 작업머리] = [page.locator('aside [data-drop-head="pinned"]'), page.locator('aside [data-drop-head="works"]')];
  const 가운데 = async (target: Locator) => {
    const box = await 상자(target);
    return box.y + box.height / 2;
  };
  const 소제목 = (head: Locator) => 가운데(head.locator("span").first());
  const nav끝줄 = nav.getByRole("button", { name: /^Archive/ });
  const 고정행 = workRow(page, pinnedWork.slug);
  await expect(작업머리).toBeVisible();
  // 앵커: 고정 구획이 서 있다 — 그 머리가 목록의 첫 머리이고 그 아래 첫 행이 고정 work이다.
  await expect(고정머리).toBeVisible();

  // 띠가 없으면 소제목은 nav 바로 다음이다. nav의 끝 줄은 지금 화면 다섯의 끝 「Archive」다(02a-3 — 한때 「내 차례」).
  expect((await 소제목(고정머리)) - (await 가운데(nav끝줄)), "고정 소제목 — nav 끝 줄에서 42").toBe(42);

  await markAttention(page, { agent: "claude", event: "Elicitation", at: Date.now(), payload: { message: "커밋할까요?" } });
  await expect(띠(page)).toHaveCount(1);
  const band = await 상자(띠(page));
  expect(band.y - (await 상자(nav)).bottom, "띠 — nav 끝 + 8").toBe(8);
  expect((await 소제목(고정머리)) - band.bottom, "고정 소제목 — 띠 끝에서 27").toBe(27);
  expect((await 가운데(고정행)) - (await 소제목(고정머리)), "고정 소제목 → 첫 행 32").toBe(32);
  expect((await 소제목(작업머리)) - (await 가운데(고정행)), "작업 소제목 — 앞 구획의 끝 행에서 42").toBe(42);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("작업 화면: 탭 아이콘이 카드 끝에서 16, 패널 머리 제목이 14, 패널 트리 첫 단 행 글자가 34이고, `+`는 마지막 칸 뒤 줄의 틈에 선다", async ({ page }) => {
  await installFixtureBackend(page);
  // 채팅이 없는 작업공간은 새 채팅 탭으로 선다(restart 02a-8). 탭 줄 맨 앞이 그 탭이다 — 한때 맨 앞은 spec 칸이었다(02a-13이 걷었다).
  await page.goto(`/works/${pinnedWork.slug}`);
  const card = page.getByRole("main", { name: "새 채팅", exact: true });
  await expect(card).toBeVisible();
  const 행글자 = await 간격(page, 4);

  const tab = await 아이콘(card.locator('[data-tab="new-chat"]'));
  expect(tab.x - (await 상자(card)).x, "새 채팅 탭 아이콘 — 카드 + 16").toBe(행글자);

  // `+`는 칸들과 같은 줄 틈(시안 `.ra-tabs`의 gap 2)을 두고 마지막 칸 뒤에 선다(restart 02a-17). 한때 0으로 맞붙었다 — 02a-5가 줄 틈을
  // 4 → 2로 줄일 때 틈 반을 덜던 `-ml-0.5`가 남아 틈을 다 지웠다.
  const 줄틈 = parseFloat(await card.locator("[data-tab-row]").evaluate((el) => getComputedStyle(el).columnGap));
  const 끝칸 = await 상자(card.locator("[data-tab-strip] > [data-tab]").last());
  const plus = await 상자(card.locator('[data-tab="new"]'));
  expect(plus.x - 끝칸.right, "`+` — 마지막 칸 끝 + 줄 틈").toBeCloseTo(줄틈, 1);

  // 작업 패널 카드 — 둘째 `aside` 안의 카드다. 머리(시안 Main `.ra-phead` — 안쪽 왼 14)의 제목이 카드 + 14, 촘촘한 트리(`.ra-pbody` 안쪽 0 6 8 ·
  // `.ra-tree-row` 들여쓰기 8 · 확장자 글자 칸)의 첫 단 행 이름이 카드 + 34다(restart 03-12a — `시안-비교/최종/Main/차이.md`). 한때 둘 다 카드 +
  // 16(DS `.at-panel-head .title` · `.at-tree-row`)의 한 세로줄이었다.
  const panel = page.locator("aside").nth(1).locator('[data-slot="card"]');
  await expect(panel).toBeVisible();
  // 패널 상자는 폭 0에서 자라 선다(02a-14) — 다 자란 뒤에 잰다.
  await settle(page, async () => (await 상자(panel)).x);
  const panelBox = await 상자(panel);
  const title = await 첫글자(panel.locator('[data-slot="card-head"]'));
  expect(title.x - panelBox.x, "패널 머리 제목 — 카드 + 14").toBeCloseTo(14, 0);
  const row = await 첫글자(panel.getByRole("button", { name: /overview\.md$/ }).getByText("overview.md", { exact: true }));
  expect(row.x - panelBox.x, "트리 첫 단 행 이름 — 카드 + 34").toBeCloseTo(34, 0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("터미널: 셸 화면이 카드 끝에서 16에 서서 탭 아이콘과 한 세로줄이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await expect(page.locator(".xterm-screen")).toBeVisible();
  const 행글자 = await 간격(page, 4);

  // DS `Terminal` — 안쪽 16. 셸 화면의 왼쪽 위가 카드 + 16이다(오른쪽 · 아래는 xterm이 셀 단위로 재고 남기는 잉여가 있다 — `terminal-fill.spec`).
  const card = await 상자(page.locator("main"));
  const screen = await 상자(page.locator(".xterm-screen"));
  const host = await 상자(page.locator("[data-shell-host]"));
  expect(screen.x - card.x, "셸 화면 — 카드 + 16").toBe(행글자);
  expect(screen.y - host.y, "셸 화면 — 집 위 16").toBe(행글자);
  // 탭 줄 맨 앞은 셸 칸이다(restart 02a-13 — 한때 spec 칸). 셸 칸의 글리프는 넓은 칸에도 늘 선다(02a-5).
  const tab = await 아이콘(page.locator('main [data-tab="shell"]').first());
  expect(screen.x, "셸 화면 x = 탭 아이콘 x").toBe(tab.x);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("문서 표: 칸의 위아래가 8이다", async ({ page }) => {
  // DS 2판의 표는 `Prose`의 것 하나이고 칸의 위아래가 8이다(`.at-prose td`). 칸의 높이가 제 줄 높이 + 위아래 8이다 — 픽스처
  // 「넓은.md」의 칸 값은 끊을 자리가 없는 한 낱말이라 한 줄이다.
  await installFixtureBackend(page);
  await page.goto(`/works/${multiWork.slug}?file=${encodeURIComponent("넓은.md")}`);
  const cell = page.getByRole("cell").first();
  await expect(cell).toBeVisible();
  const 틈 = await 간격(page, 2);
  const 칸 = await cell.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return {
      높이: el.getBoundingClientRect().height,
      줄높이: parseFloat(getComputedStyle(el).lineHeight),
      줄수: new Set([...range.getClientRects()].map((rect) => rect.top)).size,
    };
  });
  // 앵커: 칸의 글이 한 줄이다 — 두 줄이면 높이가 줄 높이 둘을 품어 아래 셈이 여백을 재지 않는다.
  expect(칸.줄수, "칸 글 한 줄").toBe(1);
  expect(칸.높이 - 칸.줄높이, "칸 — 줄 높이 + 위아래 8").toBe(2 * 틈);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 공용 목록 · 상세 틀(restart 03-1 · 03-2 · 보드 PlaceSheet 「규격」 · Places `.pl-col` · `.pl-head` · `.pl-row` · `.pl-back`) — 판 안 가운데 열(최대
// 1120)의 위 36 · 옆 56, 머리 → 표 24, 열 머리 글과 줄 아이콘이 표 왼끝(줄 면만 옆으로 8 나간다), 아이콘 → 이름 12. 상세는 같은 열이고
// 「← Projects」가 열 + 56 − 8(옆으로 8 나간 면) · 위 30.3(보드 값)에 선다. 한때(03) 목록은 판 안 옆 40 · 위 30 · 줄 아이콘 표 + 14 · 이름 10이었고,
// 상세는 옆 40 · 위 22에 본문 | 오른쪽 칸 270(사이 48) 두 단이었다.
test("Projects: 목록은 가운데 열의 위 36 · 옆 56에서 서고 표 줄의 아이콘이 표 왼끝이며, 상세는 같은 열에서 「← Projects」가 옆으로 8 나가 선다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  const 열 = async (판: { x: number; width: number }) => 판.x + (판.width - Math.min(판.width, 1120)) / 2;
  for (const width of [1280, 1600]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/projects");
    const list = page.getByRole("main", { name: "Projects", exact: true });
    const 제목 = list.getByRole("heading", { level: 1, name: "Projects", exact: true });
    const table = list.getByRole("table", { name: "Project 목록", exact: true });
    const 줄 = 표줄(table, billing.name);
    // 앵커: 표가 목록을 그렸다.
    await expect(줄).toBeVisible();
    const [판, 머리, 표] = [await 상자(list), await 상자(제목.locator("..")), await 상자(table)];
    const 열왼끝 = await 열(판);
    expect(표.x - 열왼끝, `표 — 열 + 56 (${width})`).toBe(56);
    expect((await 첫글자(제목)).x - 표.x, `제목 — 표 왼끝 (${width})`).toBeCloseTo(0, 0);
    expect(머리.y - 판.y, `맨 위 줄 — 판 위 36 (${width})`).toBe(36);
    expect(표.y - 머리.bottom, `맨 위 줄 → 표 24 (${width})`).toBe(24);
    expect((await 첫글자(table.getByRole("columnheader", { name: "이름", exact: true }))).x - 표.x, "열 머리 「이름」 — 표 왼끝").toBeCloseTo(0, 0);
    const 아이콘상자 = await 아이콘(줄);
    expect(아이콘상자.x - 표.x, "줄 아이콘 — 표 왼끝").toBe(0);
    expect(아이콘상자.width, "줄 아이콘 15").toBe(15);
    expect((await 첫글자(줄.getByRole("link", { name: billing.name, exact: true }))).x - 아이콘상자.right, "이름 — 아이콘 끝 + 12").toBeCloseTo(12, 0);
    // 줄의 면은 옆으로 8 나간다(보드 `.pl-row` — 표의 왼끝보다 8 앞).
    expect((await 상자(줄)).x - 표.x, "줄 면 — 표 − 8").toBe(-8);

    await page.goto(`/projects/${billing.slug}`);
    const detail = page.getByRole("main", { name: "Projects 상세", exact: true });
    const 돌아가기 = detail.getByRole("link", { name: "Projects", exact: true });
    await expect(돌아가기).toBeVisible();
    const [상세판, 단추, 상세제목] = [await 상자(detail), await 상자(돌아가기), await 첫글자(detail.getByRole("heading", { level: 1 }))];
    const 상세열 = await 열(상세판);
    // 위는 보드(PlaceSheet · 03-2 `시안-boxes-light.json`의 `back` — 30.3)와 같다: 36 − 8에 줄 안 상자가 14/20 줄에 앉으며 2.3 내려선다.
    expect(단추.x - 상세열, `「← Projects」 — 열 + 48 (${width})`).toBe(48);
    expect(단추.y - 상세판.y, `「← Projects」 — 위 30.3 (${width})`).toBeCloseTo(30.3, 1);
    // 목록과 같은 열이다 — 이름이 목록 제목과 한 세로줄이다. 오른쪽 칸(두 단)은 없다.
    expect(상세제목.x - 상세열, `이름 — 열 + 56 (${width})`).toBeCloseTo(56, 0);
    await expect(detail.getByRole("complementary")).toHaveCount(0);
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 기준 브랜치는 위 카드의 한 칸이다(restart 03-2 · 보드 `.pl-fact`) — 칸의 이름 · 값이 그 칸 안쪽 14에서 한 왼끝이다. 경로 · 원격 · 추가한 날과
// 같은 칸이다(restart 03-15c — 보드 상세에는 고치는 자리가 없다). 한때(03-2) 누르면 목록이 서는 단추였고, 그 앞(03 시안 F1-ProjectDetail `.rl` ·
// `.brsel`)은 오른쪽 칸의 묶음 이름 아래 단추였고 안쪽 10 + 테두리 1 뒤에 가지 아이콘, 사이 6 뒤에 mono 이름이었다.
test("Projects: 기준 브랜치 카드는 이름과 값이 칸 + 14의 한 왼끝이고, 경로 칸과 한 줄 · 같은 폭이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${billing.slug}`);
  const 이름글 = page.getByRole("main", { name: "Projects 상세", exact: true }).getByText("기준 브랜치", { exact: true });
  const 칸 = 이름글.locator("..");
  await expect(칸).toHaveText(`기준 브랜치${billing.baseBranch}`);
  const [칸상자, 이름, 글자] = [await 상자(칸), await 첫글자(이름글), await 첫글자(칸.getByText(billing.baseBranch, { exact: true }))];
  expect(이름.x - 칸상자.x, "칸 이름 — 칸 + 14").toBeCloseTo(14, 0);
  expect(글자.x, "값 = 이름의 왼끝").toBeCloseTo(이름.x, 0);
  // 위 카드 넷이 같은 폭 · 같은 줄이다 — 기준 브랜치 칸은 경로 칸의 오른쪽 이웃이다.
  const 경로칸 = await 상자(page.getByTitle(billing.path, { exact: true }).locator(".."));
  expect([칸상자.y, 칸상자.width, 칸상자.height], "경로 칸과 한 줄 · 같은 폭 · 같은 키").toEqual([경로칸.y, 경로칸.width, 경로칸.height]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("spec 레이아웃 편집기: 트리 카드의 도구가 카드 끝에서 8, 트리 행 글리프가 16이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(SPEC_LAYOUT_EDITOR);
  const tree = page.locator('[data-slot="card"][aria-label="항목 트리"]');
  await expect(tree.getByRole("treeitem", { name: "overview.md", exact: true })).toBeVisible();
  const [틈, 행글자] = [await 간격(page, 2), await 간격(page, 4)];

  const card = await 상자(tree);
  // 머리(DS `.at-toolbar` — 안쪽 8)의 첫 도구 버튼이 카드 끝에서 8이다.
  const tool = await 상자(tree.getByRole("toolbar", { name: "항목 편집" }).getByRole("button").first());
  expect(tool.x - card.x, "첫 도구 — 카드 + 8").toBe(틈);
  // 트리 행(DS `.at-tree-row` — 카드 끝에서 8 + 행 안쪽 8)의 글리프 — 뿌리인 머리 `spec/`의 글리프가 카드 + 16이고, 그 아래
  // 첫 단 항목은 들여쓰기 한 단(14 — `SpecLayoutEditor`의 `rowIndent`) 안에 선다.
  const head = await 아이콘(tree.getByRole("button", { name: "spec/", exact: true }));
  const row = await 아이콘(tree.getByRole("treeitem", { name: "overview.md", exact: true }));
  expect(head.x - card.x, "머리 spec/ 글리프 — 카드 + 16").toBe(행글자);
  expect(row.x - head.x, "첫 단 행 글리프 — spec/에서 한 단").toBe(14);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// restart 03-11 — **몸은 시안 Processes의 `.pr-col`이다**: 카드 가운데에 서고, 안쪽은 위 20 · 옆 28 · 아래 40이며, 폭 상한은 시안의 1080이다
// (`--measure-processes` — restart 03-12c, 한때 앱의 넓은 폭 `--measure-wide` 1120). 몸의 첫 줄은 머리(h1 · 잰 시각 · [조용한 셸 모두 닫기])다.
// 한때(03-9까지) 몸은 카드 끝에서 20 · 위 24에서 섰고 첫 줄이 요약 타일이었다.
test("Processes: 몸이 카드 가운데에 Processes 폭 상한(1080)으로 서고, 머리가 위 20 · 옆 28에서 시작하며 아래 40에서 끝난다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/processes");
  const card = page.getByRole("main", { name: "Processes", exact: true });
  const 제목 = card.getByRole("heading", { name: "Processes", exact: true });
  await expect(제목).toBeVisible();
  const 머리 = 제목.locator("..");
  const 몸 = 머리.locator("..");
  // 옆 28 · 아래 40은 간격 토큰에 없는 값이라 수로 적는다(시안 `.pr-col`의 `padding: 20px 28px 40px`).
  const [위, 옆] = [await 간격(page, 5), 28];
  const 넓은폭 = parseFloat(await 토큰값(page, "width", "--measure-processes"));
  expect(넓은폭, "--measure-processes").toBe(1080);

  // 카드가 폭 상한보다 좁은 창 — 몸이 카드를 다 채우고, 머리가 카드 + 28 · 20이다. 오른쪽도 28이다.
  const cardBox = await 상자(card);
  expect(cardBox.width, "앵커: 카드가 폭 상한보다 좁다").toBeLessThan(넓은폭);
  const head = await 상자(머리);
  expect(head.x - cardBox.x, "머리 — 카드 + 28").toBe(옆);
  expect(head.y - cardBox.y, "머리 — 위 20").toBe(위);
  expect(cardBox.right - head.right, "머리 — 오른쪽도 28").toBe(옆);

  // 넓은 창 — 몸이 폭 상한에서 멈추고 카드 가운데에 선다.
  await page.setViewportSize({ width: 2000, height: 900 });
  await expect.poll(async () => (await 상자(card)).width, { message: "앵커: 카드가 폭 상한보다 넓다" }).toBeGreaterThan(넓은폭);
  const [wideCard, wideBody] = [await 상자(card), await 상자(몸)];
  expect(wideBody.width, "몸 — 폭 상한").toBe(넓은폭);
  expect(Math.abs(wideBody.x - wideCard.x - (wideCard.right - wideBody.right)), "몸 — 가운데").toBeLessThanOrEqual(1);

  // 아래는 40이다. 몸이 넘칠 만큼 창을 낮추고 끝까지 굴려, 몸의 마지막 줄(표) 끝에서 카드 끝까지를 잰다. 픽스처의 몸은 머리 · 카드 · 보기 도구 ·
  // 표의 머리와 끝 줄뿐(셸이 없다)이라 창이 240까지 낮아야 넘친다.
  await page.setViewportSize({ width: 1280, height: 240 });
  const 끝 = await 몸.evaluate((body) => {
    const scroller = body.closest<HTMLElement>(".overflow-y-auto")!;
    scroller.scrollTop = scroller.scrollHeight;
    return {
      넘침: scroller.scrollHeight > scroller.clientHeight,
      아래: scroller.getBoundingClientRect().bottom - body.lastElementChild!.getBoundingClientRect().bottom,
    };
  });
  // 앵커: 몸이 카드보다 길다 — 짧으면 내용 끝이 카드 끝에 닿지 않아 아래 셈이 여백을 재지 않는다.
  expect(끝.넘침, "몸이 넘친다").toBe(true);
  expect(끝.아래, "몸 — 아래 40").toBe(40);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **좁은 창(900 이하)의 Processes 판**(restart 03-12c · 시안 Processes `@media (max-width: 900px)` — `시안-비교/최종/MainProcesses/차이.md`). 몸
// 안쪽이 사방 16이고, 카드가 한 열(CPU 152 · 메모리 112 · 손볼 것 112 — 사이 8)이며 추이 그림이 없다. 표의 열은 `minmax(0,1fr) 96 64 0 72`이고
// 「포트」 열 이름은 감춘다(0 칸 — 시안은 한 글자씩 꺾여 서는 그리기 결함, `결정.md`). CPU 열 이름은 두 줄로 꺾인다(시안 그대로). 앱은 900에서도
// 사이드바가 서 있어(시안은 걷는다 — 03-12a 몫) 카드(`main`) 기준으로 잰다.
test("Processes 좁은 창(900 × 700): 몸 안쪽 16, 카드 한 열(152 · 112 · 112), 추이 없음, 열 96 · 64 · 0 · 72에 「포트」 이름 감춤 · CPU 이름 두 줄", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await installFixtureBackend(page);
  await page.goto("/processes");
  const card = page.getByRole("main", { name: "Processes", exact: true });
  const 제목 = card.getByRole("heading", { name: "Processes", exact: true });
  await expect(제목).toBeVisible();
  const 몸 = 제목.locator("../..");
  expect(await 칠한값(몸, "padding-top", "padding-right", "padding-bottom", "padding-left"), "몸 안쪽 — 사방 16").toEqual(["16px", "16px", "16px", "16px"]);
  const [cardBox, head] = [await 상자(card), await 상자(제목.locator(".."))];
  expect([head.x - cardBox.x, head.y - cardBox.y, cardBox.right - head.right], "머리 — 16 · 16 · 16").toEqual([16, 16, 16]);

  // 카드 — 한 열. CPU 카드 아래 8에 메모리 · 손볼 것이 위아래로 112씩 선다. 추이 그림은 서지 않는다.
  const 요약 = card.getByRole("region", { name: "요약", exact: true });
  const [cpu, 둘] = [요약.locator(":scope > *").nth(0), 요약.locator(":scope > *").nth(1)];
  const [cpuBox, 메모리, 손볼것] = [await 상자(cpu), await 상자(둘.locator(":scope > *").nth(0)), await 상자(둘.locator(":scope > *").nth(1))];
  expect([cpuBox.height, 메모리.height, 손볼것.height], "카드 높이").toEqual([152, 112, 112]);
  expect([메모리.x, 손볼것.x], "한 열").toEqual([cpuBox.x, cpuBox.x]);
  expect([메모리.y - cpuBox.bottom, 손볼것.y - 메모리.bottom], "카드 사이 8").toEqual([8, 8]);
  await expect(요약.locator('svg[data-figure="trend"]'), "추이 없음").toBeHidden();

  // 표의 열 머리 — 열이 96 · 64 · 0 · 72(이름 칸은 남는 폭)이고, 「포트」 이름은 감추며, CPU 이름은 두 줄(36)이다.
  const 열머리 = card.locator("[data-process-table] > div").first();
  const 열 = (await 칠한값(열머리, "grid-template-columns"))[0].split(" ");
  expect(열.slice(1), "열 — 96 · 64 · 0 · 72").toEqual(["96px", "64px", "0px", "72px"]);
  expect(await 열머리.getByText("포트", { exact: true }).evaluate((el) => getComputedStyle(el).visibility), "「포트」 이름").toBe("hidden");
  expect((await 상자(열머리.getByText("CPU · 맥 전체 기준", { exact: true }))).height, "CPU 이름 — 두 줄").toBe(36);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
