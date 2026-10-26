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
  줄표시,
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
// 여기는 행 글자 16이 서는 자리들과, 그 밖의 거터 자리(Projects 목록 · 상세 · Processes)를 잰다. Projects는 03 시안의 값이다(옆 40 —
// DS 눈금 밖의 판 값이라 수로 적는다).
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

test("사이드바: nav · 알림 띠 · 구획 소제목 · work 행 · 바닥 사람 줄의 행 글자가 사이드바 끝에서 16이고, 수 · 표시의 오른쪽 끝은 행 끝에서 8이다", async ({
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
  // 사이드바는 판 밖 크롬 위, 창 왼쪽 끝 + 5에 선다(03 구현 스펙 §3 · 시안 `.body`의 왼 5 — 상자는 `frame-sidebar.spec`이 잰다). 한때 흰
  // 판 안 왼끝에 붙었고(02 티켓 02), 그보다 앞에는 바탕에 붙어 창 끝이 곧 사이드바 끝이었다. 행 글자 16은 그 끝에서 잰다.
  expect(sidebar.x, "사이드바가 창 왼쪽 끝 + 5에 선다").toBe(5);

  const 자리: [string, Promise<number>][] = [
    // nav의 첫 항목은 「새 Thread」다 — 지금 화면들(옛 main nav)은 사람 메뉴로 갔다(v1 티켓 07 · S27).
    ["nav 아이콘", 아이콘(page.locator("aside nav").getByRole("button", { name: "새 Thread", exact: true })).then((box) => box.x)],
    ["알림 띠 머리 글자", 첫글자(띠(page)).then((box) => box.x)],
    ["알림 띠 줄의 점 레인", 상자(띠(page).getByRole("button", { name: `${plainWork.title} — 나를 기다림` }).locator("span").first()).then((box) => box.x)],
    ["구획 소제목 글자", 첫글자(page.locator("aside [data-section]").first()).then((box) => box.x)],
    // 레인(늘 폴더 — 02 티켓 05)이 행 맨 앞이다 — Codex 사이드바의 폴더 아이콘 칸(16)이다(v1 티켓 46). 한때 그 앞에 ▸의 제 칸이 섰다.
    ["work 행의 레인", 상자(workRow(page, pinnedWork.slug).locator("[data-lane]")).then((box) => box.x)],
    // 바닥은 사람 줄이다(옛 Settings 줄의 자리) — 얼굴 글자 원이 행 글자 자리에 선다.
    ["바닥 사람 줄의 얼굴", 상자(사람줄(page).locator("span").first()).then((box) => box.x)],
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

test("사이드바: 알림 띠는 nav 끝에서 8 아래에 서고, 구획 소제목은 nav 끝 줄에서 42 · 첫 행까지 34 · 앞 구획의 끝 행에서 54다(가운데끼리)", async ({
  page,
}) => {
  // 사이드바의 세로는 Codex 대화 사이드바를 잰 값이다(v1 티켓 46 · 시안-비교/46/차이.md — 줄 30 · 줄 사이 1). 소제목(구획 머리 30
  // 가운데의 라벨)은 nav 끝 줄 가운데에서 42 아래에 서고, 그 가운데에서 첫 행 가운데까지 34, 앞 구획의 끝 행 가운데에서 다음 소제목
  // 가운데까지 54다. 띠(`.at-band`)의 위 바깥 8은 DS 값 그대로라 띠가 서면 nav 끝 + 8에 서고, 소제목은 nav 끝 줄 대신 띠 끝에서 27
  // (42 − 줄 절반 15) 아래다. 가운데끼리 재는 것은 Codex 그림을 그렇게 쟀기 때문이다 — 글자 줄 높이가 갈려도 눈에 보이는 사이가 같다.
  // 한때 DS 기둥의 값(소제목 글자 줄이 앞 것 끝 + 14 · 첫 행까지 8)이었다.
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  const nav = page.locator("aside nav").first();
  const [고정머리, 작업머리] = [page.locator('aside [data-drop-head="pinned"]'), page.locator('aside [data-drop-head="works"]')];
  const 가운데 = async (target: Locator) => {
    const box = await 상자(target);
    return box.y + box.height / 2;
  };
  const 소제목 = (head: Locator) => 가운데(head.locator("span").first());
  const nav끝줄 = nav.getByRole("button", { name: "Library", exact: true });
  const 고정행 = workRow(page, pinnedWork.slug);
  await expect(작업머리).toBeVisible();
  // 앵커: 고정 구획이 서 있다 — 그 머리가 목록의 첫 머리이고 그 아래 첫 행이 고정 work이다.
  await expect(고정머리).toBeVisible();

  // 띠가 없으면 소제목은 nav 바로 다음이다. nav의 끝 줄은 「Library」다(v1 티켓 19).
  expect((await 소제목(고정머리)) - (await 가운데(nav끝줄)), "고정 소제목 — nav 끝 줄에서 42").toBe(42);

  await markAttention(page, { agent: "claude", event: "Elicitation", at: Date.now(), payload: { message: "커밋할까요?" } });
  await expect(띠(page)).toHaveCount(1);
  const band = await 상자(띠(page));
  expect(band.y - (await 상자(nav)).bottom, "띠 — nav 끝 + 8").toBe(8);
  expect((await 소제목(고정머리)) - band.bottom, "고정 소제목 — 띠 끝에서 27").toBe(27);
  expect((await 가운데(고정행)) - (await 소제목(고정머리)), "고정 소제목 → 첫 행 34").toBe(34);
  expect((await 소제목(작업머리)) - (await 가운데(고정행)), "작업 소제목 — 앞 구획의 끝 행에서 54").toBe(54);
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

// 03 시안 F1-Projects `.pl`(위 30 · 옆 40 · 줄 사이 18) · `.prow-h`(왼 14) · `.nm`(아이콘과 이름 사이 10), F1-ProjectDetail `.scroll`(위 22 ·
// 옆 40) · `.cols`(본문 | 오른쪽 칸 270, 사이 48). 한때 목록 | 내용이 한 카드의 두 칸이었다(codex-ds 결정 28 — 목록 칸 왼끝 + 16, 상세 글은
// 거터 20 · 위 24에 `size-thread` 폭) — 03이 목록을 판 하나의 표로, 상세를 두 칸 글로 바꿨다(03 결정 「10」).
test("Projects: 목록은 판 안 옆 40 · 위 30에서 서고 표 줄의 아이콘이 표 끝 + 14이며, 상세는 옆 40 · 위 22에서 서고 두 칸 사이가 48이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/projects");
  const list = page.getByRole("main", { name: "Projects", exact: true });
  const 제목 = list.getByRole("heading", { level: 1, name: "Projects", exact: true });
  const table = list.getByRole("table", { name: "Project 목록", exact: true });
  const 줄 = table.getByRole("link", { name: billing.name, exact: true });
  // 앵커: 표가 목록을 그렸다.
  await expect(줄).toBeVisible();
  const [판, 머리, 표] = [await 상자(list), await 상자(제목.locator("..")), await 상자(table)];
  expect((await 첫글자(제목)).x - 판.x, "제목 — 판 + 40").toBe(40);
  expect(머리.y - 판.y, "맨 위 줄 — 판 위 30").toBe(30);
  expect(표.x - 판.x, "표 — 판 + 40").toBe(40);
  expect(표.y - 머리.bottom, "맨 위 줄 → 표 18").toBe(18);
  expect((await 첫글자(table.getByRole("columnheader", { name: "이름", exact: true }))).x - 표.x, "열 머리 「이름」 — 표 + 14").toBe(14);
  const 아이콘상자 = await 아이콘(줄);
  expect(아이콘상자.x - 표.x, "줄 아이콘 — 표 + 14").toBe(14);
  expect((await 첫글자(줄)).x - 아이콘상자.right, "이름 — 아이콘 끝 + 10").toBe(10);

  for (const width of [1280, 1600]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`/projects/${billing.slug}`);
    const detail = page.getByRole("main", { name: "Projects 상세", exact: true });
    const 돌아가기 = detail.getByRole("link", { name: "Projects", exact: true });
    const rail = detail.getByRole("complementary", { name: "Project 정보", exact: true });
    await expect(rail).toBeVisible();
    const [상세판, 단추, 칸, 본문칸] = [
      await 상자(detail),
      await 상자(돌아가기),
      await 상자(rail),
      await 상자(rail.locator("xpath=preceding-sibling::*[1]")),
    ];
    expect([단추.x - 상세판.x, 단추.y - 상세판.y], `「← Projects」 — 판 + 40 · 위 22 (${width})`).toEqual([40, 22]);
    expect(본문칸.x - 상세판.x, `본문 칸 — 판 + 40 (${width})`).toBe(40);
    // 넓은 창에서도 가운데로 모이지 않는다 — 본문 칸이 늘고 오른쪽 칸은 270 그대로 판 오른쪽 끝 − 40에 붙는다.
    expect([칸.x - 본문칸.right, 칸.width, 상세판.right - 칸.right], `오른쪽 칸 — 사이 48 · 폭 270 · 판 끝 − 40 (${width})`).toEqual([
      48, 270, 40,
    ]);
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 03 시안 F1-ProjectDetail `.rl` · `.brsel` — 오른쪽 칸의 묶음 이름 아래 단추가 같은 왼끝에 서고, 안쪽 10 + 테두리 1 뒤에 가지 아이콘, 사이
// 6 뒤에 이름이다. 누르면 목록이 단추 아래에 뜨고 단추 글자는 그 자리 그대로다 — 한때 로컬 브랜치가 없는 프로젝트의 기준 브랜치는 누르면
// 그 자리가 입력 칸이 되는 버튼이었고(`InlineBranchEditor`) 칸의 투명 테두리만큼 글자가 밀리지 않는지를 쟀다. 03은 목록 밖 값을 적는 칸을
// 걷었다(스토리 119–121).
test("Projects: 기준 브랜치 단추는 묶음 이름과 한 왼끝에 서고, 누르면 목록이 떠도 단추 글자는 그 자리에 그대로 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${billing.slug}`);
  const 묶음 = page.getByRole("region", { name: "기준 브랜치", exact: true });
  const 단추 = 묶음.getByRole("combobox", { name: "기준 브랜치", exact: true });
  await expect(단추).toContainText(billing.baseBranch);
  const [이름, 상자전, 가지, 글자전] = [
    await 첫글자(묶음.getByRole("heading", { name: "기준 브랜치", exact: true })),
    await 상자(단추),
    await 아이콘(단추),
    await 첫글자(단추),
  ];
  expect(상자전.x, "단추 = 묶음 이름의 왼끝").toBe(이름.x);
  expect(가지.x - 상자전.x, "가지 아이콘 — 단추 + 11(안쪽 10 + 테두리 1)").toBe(11);
  // 이름은 mono 글자라 그려진 글자의 앞 여백이 소수 픽셀 남는다(`글자 — Range` 상자) — 소수 첫째 자리까지 본다.
  expect(글자전.x - 가지.right, "이름 — 아이콘 끝 + 6").toBeCloseTo(6, 1);
  await 단추.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  const 글자뒤 = await 첫글자(단추);
  expect([글자뒤.x, 글자뒤.y], "목록이 떠도 단추 글자는 그 자리").toEqual([글자전.x, 글자전.y]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
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
