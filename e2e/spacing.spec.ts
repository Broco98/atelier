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
  사람줄,
  첫글자,
  토큰값,
} from "./harness";

// codex-ds 티켓 25 — **화면의 여백이 세 줄에 맞는다**(스펙 §4 「여백」 · DS README 「간격 · 반경 · 크기」 · DS `AppShell`). 틈 8(`space-2`)은
// 창 끝 · 카드 사이 · 카드 끝에서 행까지이고, 행 글자 16(`space-4` = 틈 8 + 행 안쪽 8)은 사이드바 행 · 소제목 · 카드 머리 제목 · 탭
// 아이콘 · 찾기 아이콘이 서는 세로줄이며, 글 거터 20(`space-5`)은 문서 · 설정 글의 옆이다(글은 위 24 — `space-6`에서 시작한다). 한 줄에
// 서야 할 것들이 1px씩 갈리면 화면에서는 「조금 들쭉날쭉」으로만 남아 눈으로는 안 지켜진다 — 사이드바 행 글자가 17, 편집기 트리 행이
// 18, Processes 몸이 24이던 것이 그렇게 남았다.
//
// 틈 8은 `frame.spec`이 화면마다 잰다. 문서 글의 거터는 `path-bar.spec`이, 설정 글과 편집기 폼의 거터는 `settings-group.spec`이 잰다.
// 여기는 행 글자 16이 서는 자리들과, 그 밖의 거터 자리(프로젝트 상세 · Processes)를 잰다.
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

test("사이드바: nav · 알림 띠 · 구획 소제목 · work 행 · 바닥 사람 줄의 행 글자가 창 끝에서 16이고, 수의 오른쪽 끝은 행 끝에서 8이다", async ({
  page,
}) => {
  // work 행의 맨 앞은 그 Work의 Thread를 펴는 ▸다(v1 티켓 37) — 이은 Thread가 있어야 선다. 고정된 일에 Thread 하나를 잇는다.
  await installFixtureBackend(page, {
    thread_list: [
      {
        id: FIXTURE_THREAD.id,
        title: FIXTURE_THREAD.title,
        createdAt: FIXTURE_THREAD.createdAt,
        work: pinnedWork.slug,
        handles: ["host"],
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
  // 사이드바는 바탕에 붙는다(DS `AppShell`) — 창 끝이 곧 사이드바 끝이다.
  expect(sidebar.x, "사이드바가 창 끝에 붙는다").toBe(0);

  const 자리: [string, Promise<number>][] = [
    // nav의 첫 항목은 「새 Thread」다 — 지금 화면들(옛 main nav)은 사람 메뉴로 갔다(v1 티켓 07 · S27).
    ["nav 아이콘", 아이콘(page.locator("aside nav").getByRole("button", { name: "새 Thread", exact: true })).then((box) => box.x)],
    ["알림 띠 머리 글자", 첫글자(띠(page)).then((box) => box.x)],
    ["알림 띠 줄의 점 레인", 상자(띠(page).getByRole("button", { name: `${plainWork.title} — 나를 기다림` }).locator("span").first()).then((box) => box.x)],
    ["구획 소제목 글자", 첫글자(page.locator("aside [data-section]").first()).then((box) => box.x)],
    // 레인(상태 아이콘 · 셸 신호)은 ▸ 뒤에 선다 — 보드에 없는 칸이라 ▸와 이름 사이에 남겼다(시안-비교/37/차이.md).
    ["work 행의 ▸", 아이콘(workRow(page, pinnedWork.slug).locator("[data-expander]")).then((box) => box.x)],
    // 바닥은 사람 줄이다(옛 Settings 줄의 자리) — 얼굴 글자 원이 행 글자 자리에 선다.
    ["바닥 사람 줄의 얼굴", 상자(사람줄(page).locator("span").first()).then((box) => box.x)],
  ];
  for (const [이름, x] of 자리) expect((await x) - sidebar.x, `${이름} — 창 끝 + 16`).toBe(행글자);

  // 오른쪽도 행 안쪽 8이다(DS `.at-row` · `.at-band-head`의 좌우 8) — 구획 머리 · 띠 머리의 수가 그 상자 끝에서 8에 선다.
  const 구획머리 = page.locator("aside [data-section]").first();
  const 띠머리 = 띠(page).locator("[data-band-count]");
  expect((await 상자(구획머리)).right - (await 첫글자(구획머리.locator("span").last())).right, "구획 수 — 머리 끝에서 8").toBeCloseTo(틈, 0);
  expect((await 상자(띠(page))).right - (await 첫글자(띠머리)).right, "띠 수 — 띠 끝에서 8").toBeCloseTo(틈, 0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("사이드바: 알림 띠는 nav 끝에서 8 아래에 서고, 구획 소제목 글자는 앞 것 끝에서 14 · 그 구획 첫 행까지 8이다", async ({ page }) => {
  // DS 사이드바의 세로 — 기둥(`.at-sidebar`)과 목록(`.at-side-list`)의 줄 사이 2, 띠(`.at-band`)의 위 바깥 6 · 아래 바깥 0, 소제목
  // (`.at-label`)의 안쪽 위 12 · 아래 6이다. 그래서 띠는 nav 끝 + 8에 서고, 소제목 글자 줄은 앞 것(nav · 띠 · 앞 구획의 행) 끝 + 14에서
  // 시작해 그 끝에서 첫 행까지 8이다. 소제목 글자 줄은 그 라벨 상자다(flex 칸이라 줄 높이 그대로 — `chat-meta` 18).
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  const nav = page.locator("aside nav").first();
  const [고정머리, 작업머리] = [page.locator('aside [data-drop-head="pinned"]'), page.locator('aside [data-drop-head="works"]')];
  const 소제목 = (head: Locator) => 상자(head.locator("span").first());
  const 고정행 = workRow(page, pinnedWork.slug);
  await expect(작업머리).toBeVisible();
  // 앵커: 고정 구획이 서 있다 — 그 머리가 목록의 첫 머리이고 그 아래 첫 행이 고정 work이다.
  await expect(고정머리).toBeVisible();

  // 띠가 없으면 소제목은 nav 바로 다음이다.
  expect((await 소제목(고정머리)).y - (await 상자(nav)).bottom, "고정 소제목 글자 — nav 끝 + 14").toBe(14);

  await markAttention(page, { agent: "claude", event: "Elicitation", at: Date.now(), payload: { message: "커밋할까요?" } });
  await expect(띠(page)).toHaveCount(1);
  const band = await 상자(띠(page));
  expect(band.y - (await 상자(nav)).bottom, "띠 — nav 끝 + 8").toBe(8);
  expect((await 소제목(고정머리)).y - band.bottom, "고정 소제목 글자 — 띠 끝 + 14").toBe(14);
  expect((await 상자(고정행)).y - (await 소제목(고정머리)).bottom, "고정 소제목 글자 끝 → 첫 행 8").toBe(8);
  expect((await 소제목(작업머리)).y - (await 상자(고정행)).bottom, "작업 소제목 글자 — 앞 구획의 행 끝 + 14").toBe(14);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("작업 화면: 탭 아이콘 · 패널 머리 제목 · 패널 트리 행이 카드 끝에서 16이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?file=overview.md`);
  await expect(page.getByRole("heading", { name: "개요" })).toBeVisible();
  const 행글자 = await 간격(page, 4);

  const card = page.getByRole("main", { name: "문서", exact: true });
  const tab = await 아이콘(card.locator('[data-tab="spec"]'));
  expect(tab.x - (await 상자(card)).x, "spec 탭 아이콘 — 카드 + 16").toBe(행글자);

  // 작업 패널 카드 — 둘째 `aside` 안의 카드다. 머리 제목과 트리의 첫 행 글리프가 같은 세로줄이다(DS `.at-panel-head .title` · `.at-tree-row`).
  const panel = page.locator("aside").nth(1).locator('[data-slot="card"]');
  const panelBox = await 상자(panel);
  const title = await 첫글자(panel.locator('[data-slot="card-head"]'));
  expect(title.x - panelBox.x, "패널 머리 제목 — 카드 + 16").toBe(행글자);
  const row = await 아이콘(panel.getByRole("button", { name: "overview.md", exact: true }));
  expect(row.x - panelBox.x, "트리 첫 단 행 글리프 — 카드 + 16").toBe(행글자);
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
  const tab = await 아이콘(page.locator('main [data-tab="spec"]'));
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

test("Projects: 목록 머리 제목 · 찾기 돋보기 · 목록 행 글리프가 목록 칸 왼쪽 끝에서 16이고, 상세 글은 내용 칸의 거터 20 · 위 24에서 시작한다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${billing.slug}`);
  const content = page.getByRole("main", { name: "프로젝트", exact: true });
  // 상세의 첫 글은 속성 묶음이다 — 상세 칸에는 제목이 없고 이름은 머리 카드가 든다(codex-ds 스펙 S12 · 티켓 28).
  const 속성 = content.locator("dl");
  await expect(속성).toContainText(billing.path);
  const [행글자, 거터, 위] = [await 간격(page, 4), await 간격(page, 5), await 간격(page, 6)];

  // 내용 | 목록은 한 카드다(codex-ds 결정 28) — 목록 칸의 것은 그 칸 왼쪽 끝(두 칸을 가르는 세로 선)에서, 상세는 내용 칸 끝에서 잰다.
  const list = page.getByRole("region", { name: "프로젝트 목록", exact: true });
  const column = await 상자(list);
  const 자리: [string, Promise<number>][] = [
    ["목록 머리 제목", 첫글자(list.locator('[data-slot="list-head"]')).then((box) => box.x)],
    ["찾기 돋보기", 아이콘(list.getByRole("group").first()).then((box) => box.x)],
    ["목록 행 글리프", 아이콘(list.getByRole("button", { name: new RegExp(billing.name) }).first()).then((box) => box.x)],
  ];
  for (const [이름, x] of 자리) expect((await x) - column.x, `${이름} — 목록 칸 + 16`).toBe(행글자);

  const contentBox = await 상자(content);
  const first = await 상자(속성);
  const thread = parseFloat(await 토큰값(page, "max-width", "--size-thread"));
  // 앵커: 기본 창에서는 내용 칸이 글 폭 + 거터 둘보다 좁다 — 글이 거터에 붙어 서서 아래 셈이 거터를 잰다.
  expect(contentBox.width, "내용 칸이 글 폭 + 거터 둘보다 좁다").toBeLessThan(thread + 2 * 거터);
  expect(first.x - contentBox.x, "상세 글 — 내용 칸 + 20").toBe(거터);
  expect(first.y - contentBox.y, "상세 글 — 위 24").toBe(위);

  // 넓은 창 — 글이 서는 폭이 `size-thread` 그대로이고 내용 칸 가운데에 선다. 거터 20은 그 폭 밖(구르는 칸)이 든다 — 설정 틀 · 문서
  // 글과 같은 나눔이다(`settings-group.spec` · `path-bar.spec`). 거터를 몸 안에 두면 글 폭이 48rem − 40으로 준다.
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(async () => (await 상자(속성)).width, "속성 묶음 폭 = size-thread").toBe(thread);
  const [wide, wideList] = [await 상자(content), await 상자(속성)];
  expect(wideList.x - wide.x, "가운데").toBeCloseTo(wide.right - wideList.right, 0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Projects: 기준 브랜치를 누르면 선 칸의 글자가 누르기 전 그 자리에 그대로 선다", async ({ page }) => {
  // 로컬 브랜치가 없는 프로젝트의 기준 브랜치는 누르면 그 자리가 칸이 되는 버튼이다(`ProjectDetail`의 `InlineBranchEditor`).
  // 칸은 폭을 먹는 투명 테두리 1px을 가져, 안쪽을 그만큼 덜어야 글자가 버튼일 때의 자리(칩 끝 + 7)에 선다.
  const bare = PROJECTS.find((p) => p.git === null)!;
  await installFixtureBackend(page);
  await page.goto(`/projects/${bare.slug}`);
  const 글자자리 = (target: Locator) =>
    target.evaluate((el) => {
      const style = getComputedStyle(el);
      return el.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    });
  const button = page.getByRole("button", { name: bare.baseBranch, exact: true });
  const 전 = await 첫글자(button);
  // 앵커: 버튼의 글자는 제 안쪽 끝에서 시작한다 — 아래가 칸의 안쪽 끝을 글자 자리로 읽는 셈이 이 버튼에도 맞는다.
  expect(전.x, "버튼 글자 = 안쪽 끝").toBeCloseTo(await 글자자리(button), 0);
  await button.click();
  const input = page.getByRole("textbox", { name: "기준 브랜치" });
  await expect(input).toBeFocused();
  expect(await 글자자리(input), "칸의 글자 = 누르기 전 버튼의 글자").toBeCloseTo(전.x, 0);
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

test("Processes: 몸이 카드의 거터 20 · 위 24에서 시작하고 아래 40에서 끝난다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/processes");
  const card = page.getByRole("main", { name: "Processes", exact: true });
  const 제목 = card.getByRole("heading", { name: "Processes", exact: true });
  await expect(제목).toBeAttached();
  const [거터, 위] = [await 간격(page, 5), await 간격(page, 6)];

  // 몸의 첫 줄은 요약 타일이다 — 그 줄의 왼쪽 위가 카드 + 20 · 24다(DS `ProcessTree` 미리보기의 몸 — 안쪽 24 20 40 · 스펙 §4 「card-pad
  // 24 옆 여백은 20」).
  const cardBox = await 상자(card);
  const summary = card.getByRole("region", { name: "요약", exact: true });
  const tiles = await 상자(summary);
  expect(tiles.x - cardBox.x, "몸 — 카드 + 20").toBe(거터);
  expect(tiles.y - cardBox.y, "몸 — 위 24").toBe(위);
  expect(cardBox.right - tiles.right, "몸 — 오른쪽도 20").toBe(거터);

  // 아래는 40이다(같은 미리보기 · DS `.at-thread`의 아래 40 — 간격 토큰에 없는 값이라 수로 적는다). 몸이 넘칠 만큼 창을 낮추고
  // 끝까지 굴려, 내용 끝에서 카드 끝까지를 잰다. 픽스처의 몸은 요약 타일과 열 머리뿐(셸이 없다)이라 창이 240까지 낮아야 넘친다.
  await page.setViewportSize({ width: 1280, height: 240 });
  const 끝 = await summary.evaluate((section) => {
    const body = section.parentElement!;
    const scroller = body.closest<HTMLElement>(".overflow-y-auto")!;
    scroller.scrollTop = scroller.scrollHeight;
    return {
      넘침: scroller.scrollHeight > scroller.clientHeight,
      아래: scroller.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom,
    };
  });
  // 앵커: 몸이 카드보다 길다 — 짧으면 내용 끝이 카드 끝에 닿지 않아 아래 셈이 여백을 재지 않는다.
  expect(끝.넘침, "몸이 넘친다").toBe(true);
  expect(끝.아래, "몸 — 아래 40").toBe(40);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
