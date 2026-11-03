import type { ProjectView } from "@/features/projects/types";
import { expect, test, type Locator, type Page } from "./evidence";
import { ARCHIVE, PROJECTS, SERVICES } from "./fixtures";
import {
  clipboardWrites,
  holdCommand,
  installFixtureBackend,
  ipcArgs,
  recordClipboard,
  releaseCommand,
  unknownIpcCalls,
  본문,
  탭으로,
  토큰색,
  폴더를고른다,
  화면토스트,
} from "./harness";

// **목록과 상세는 한 자리다**(restart 03-1 · 03-3 · 03-4 · 스펙 「03 — 목록과 상세」 · 보드 PlaceSheet 「움직임과 조작」 · 「뒤로 · 앞으로」 · 스토리 111 ·
// 113). Projects · Services · Archive가 한 틀(`PlaceStage` · `PlaceList` · `PlaceDetail`)을 쓴다 — 상세가 선 동안 목록은 언마운트되지 않고 `main`
// 안에 숨어(`invisible` · `inert`) 남아, 돌아오면 찾는 글 · 정렬 · 스크롤이 그대로다. 상세의 「← 목록」은 언제나 목록으로 가는 새 걸음이고(push),
// 창의 뒤로 · 앞으로는 목록과 상세를 오간다. ⌘F는 목록이 보이는 동안만 그 찾기 칸에 선다. 목록에서 줄로 상세에 가면 상세가 240ms 들어오고
// (`place-in`), 돌아온 목록도 그렇게 선다(`place-back`) — 주소로 곧장 연 상세는 움직이지 않는다.
//
// 화면마다 하나씩 잰다 — 한 틀이 둘로 갈려 한 벌만 고쳐진 날 그 화면만 빨개진다. 각 화면의 칸 · 줄 · 상세 안은 `projects-list` · `projects-kit` ·
// `services-kit` · `archive-docs`가 잰다.

const [billing] = PROJECTS;
const [결제] = SERVICES;
const [shipped] = ARCHIVE;

interface Place {
  /** 목록 `main`의 이름이자 「← 목록」 링크 · 머리 줄 앞 칸의 이름. */
  name: string;
  url: string;
  table: string;
  search: string;
  /** 상세 `main`의 이름. */
  detail: string;
  /** 목록 커맨드와 그 답을 늘리는 채움 줄 — 스크롤을 재려면 목록이 넘쳐야 한다. 채움 줄은 이름이 「가 채움 NN」이라 이름 순으로 맨 앞이다. */
  command: "list_projects" | "list_services" | "list_archive";
  rows: readonly unknown[];
  filler: (n: string) => unknown;
  /** 오가는 줄 — 이름과 상세 주소. */
  target: { name: string; url: string };
  /** 그 줄에 걸리는 찾는 글. */
  query: string;
}

const PLACES: Place[] = [
  {
    name: "Projects",
    url: "/projects",
    table: "Project 목록",
    search: "Project 찾기",
    detail: "Projects 상세",
    command: "list_projects",
    rows: PROJECTS,
    filler: (n) => ({ ...PROJECTS[1], slug: `chaeum-${n}`, name: `가 채움 ${n}`, path: `~/MyProjects/chaeum-${n}` }),
    target: { name: billing.name, url: `/projects/${billing.slug}` },
    query: billing.name.slice(0, 1),
  },
  {
    name: "Services",
    url: "/services",
    table: "Service 목록",
    search: "Service 찾기",
    detail: "Services 상세",
    command: "list_services",
    rows: SERVICES,
    filler: (n) => ({ ...SERVICES[1], slug: `chaeum-${n}`, name: `가 채움 ${n}` }),
    target: { name: 결제.name, url: `/services/${encodeURIComponent(결제.slug)}` },
    query: 결제.name.slice(0, 1),
  },
  {
    name: "Archive",
    url: "/archive",
    table: "Archive 목록",
    search: "Archive 찾기",
    detail: "Archive 상세",
    command: "list_archive",
    rows: ARCHIVE,
    filler: (n) => ({ ...ARCHIVE[1], slug: `chaeum-${n}`, title: `가 채움 ${n}` }),
    target: { name: shipped.title, url: `/archive/${shipped.slug}` },
    query: shipped.title.slice(0, 2),
  },
];

const 표 = (page: Page, place: Place) => page.getByRole("table", { name: place.table, exact: true });
const 찾기칸 = (page: Page, place: Place) => page.getByRole("searchbox", { name: place.search, exact: true });
const 줄링크 = (page: Page, place: Place, name = place.target.name) => 표(page, place).getByRole("link", { name, exact: true });
/**
 * 상세 제목 — 상세가 섰다는 앵커. 숨은 목록 줄에도 같은 이름이 있어 글로 `main` 전체를 찾지 않는다. 제목은 이름 바꾸기 단추를 품어 그 이름이
 * 제목의 이름이 되므로 글자로 견준다(`toHaveText`). Archive는 문서 글의 h1도 있어 첫째다.
 */
const 상세제목 = (page: Page, place: Place) => 본문(page, place.detail).getByRole("heading", { level: 1 }).first();
const 상세가섰다 = (page: Page, place: Place) => expect(상세제목(page, place)).toHaveText(place.target.name);
const 돌아가기 = (page: Page, place: Place) => 본문(page, place.detail).getByRole("link", { name: place.name, exact: true });
/** 지금 정렬 — `aria-sort`를 단 열 머리의 [이름, 방향]. */
const 정렬 = (page: Page, place: Place) =>
  표(page, place)
    .locator('[role="columnheader"][aria-sort]')
    .evaluateAll((all) => all.map((one) => [one.textContent, one.getAttribute("aria-sort")]));
/** 표에 선 줄의 이름(링크) 차례. */
const 줄이름들 = (page: Page, place: Place) => 표(page, place).getByRole("link").allInnerTexts();
/** 목록 판의 굴림 칸 — 표를 품은 가장 가까운 `overflow-y-auto` 상자(`PlaceList`). */
const 굴림칸 = (page: Page, place: Place) =>
  표(page, place).locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' overflow-y-auto ')][1]");

/** 채움 줄 서른 개를 앞에 둔 목록 답. */
const 넘치는목록 = (place: Place) => ({
  [place.command]: [...Array.from({ length: 30 }, (_, at) => place.filler(String(at + 1).padStart(2, "0"))), ...place.rows],
});

for (const place of PLACES) {
  test(`${place.name}: 찾는 글 · 정렬은 상세를 다녀와도 그대로다 — 「← ${place.name}」로도 창의 뒤로로도, 앞으로는 다시 상세다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(place.url);
    await expect(표(page, place)).toBeVisible();

    // 찾고, 이름 열 머리로 정렬을 바꾼다 — 처음 정렬은 시각 칸의 새것부터다(스토리 113).
    await 찾기칸(page, place).fill(place.query);
    await 표(page, place).getByRole("button", { name: "이름", exact: true }).click();
    await expect.poll(() => 정렬(page, place)).toEqual([["이름", "ascending"]]);
    const 줄들 = await 줄이름들(page, place);
    expect(줄들, "앵커: 찾는 글이 그 줄을 남긴다").toContain(place.target.name);
    const 그대로다 = async (때: string) => {
      await expect(찾기칸(page, place), `${때} — 찾는 글`).toHaveValue(place.query);
      expect(await 정렬(page, place), `${때} — 정렬`).toEqual([["이름", "ascending"]]);
      expect(await 줄이름들(page, place), `${때} — 줄`).toEqual(줄들);
    };

    // 줄 → 상세 → 「← 목록」 — 목록으로 가는 새 걸음이다. 목록이 그대로다.
    await 줄링크(page, place).click();
    await expect(page).toHaveURL(place.target.url);
    await 상세가섰다(page, place);
    await 돌아가기(page, place).click();
    await expect(page).toHaveURL(place.url);
    await expect(표(page, place)).toBeVisible();
    await 그대로다("「← 목록」 뒤");

    // 「← 목록」은 새 걸음이라 창의 뒤로가 방금의 상세로 가고, 앞으로가 다시 목록이다.
    await page.goBack();
    await expect(page).toHaveURL(place.target.url);
    await 상세가섰다(page, place);
    await page.goForward();
    await expect(page).toHaveURL(place.url);
    await 그대로다("앞으로 돌아온 목록");

    // 줄 → 상세 → 창의 뒤로 — 목록이 그대로다. 창의 앞으로는 다시 그 상세다.
    await 줄링크(page, place).click();
    await 상세가섰다(page, place);
    await page.goBack();
    await expect(page).toHaveURL(place.url);
    await 그대로다("창의 뒤로 뒤");
    await page.goForward();
    await expect(page).toHaveURL(place.target.url);
    await 상세가섰다(page, place);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${place.name}: 굴린 목록은 상세를 다녀와도 그 자리다`, async ({ page }) => {
    await installFixtureBackend(page, 넘치는목록(place));
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(place.url);
    await expect(줄링크(page, place)).toBeVisible();
    // 이름 순이면 채움 줄 서른이 앞이라 그 줄은 아래에 있다 — 굴려 세운다.
    await 표(page, place).getByRole("button", { name: "이름", exact: true }).click();
    await 줄링크(page, place).scrollIntoViewIfNeeded();
    const 칸 = 굴림칸(page, place);
    const 자리 = () => 칸.evaluate((el) => el.scrollTop);
    await expect.poll(자리, { message: "앵커: 목록을 굴렸다" }).toBeGreaterThan(100);
    const 굴린자리 = await 자리();

    await 줄링크(page, place).click();
    await 상세가섰다(page, place);
    await 돌아가기(page, place).click();
    await expect(표(page, place)).toBeVisible();
    expect(await 자리(), "「← 목록」 뒤").toBe(굴린자리);

    await 줄링크(page, place).click();
    await 상세가섰다(page, place);
    await page.goBack();
    await expect(표(page, place)).toBeVisible();
    expect(await 자리(), "창의 뒤로 뒤").toBe(굴린자리);
    await expect(줄링크(page, place)).toBeInViewport();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${place.name}: ⌘F는 목록이 보이는 동안만 「${place.search}」에 서고, 상세에서는 숨은 찾기 칸에 서지 않는다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(place.url);
    const 칸 = 찾기칸(page, place);
    await expect(칸).toBeVisible();
    // 칸이 듣는 키를 말한다(스토리 111).
    await expect(칸).toHaveAttribute("aria-keyshortcuts", "Meta+F");
    await expect(칸).not.toBeFocused();
    await page.keyboard.press("Meta+f");
    await expect(칸).toBeFocused();

    await 줄링크(page, place).click();
    await 상세가섰다(page, place);
    // 숨은 목록의 칸은 접근성 트리 밖이라 역할로 못 집는다 — 포커스가 선 요소로 잰다.
    await 돌아가기(page, place).focus();
    await page.keyboard.press("Meta+f");
    await expect(돌아가기(page, place), "상세의 포커스는 그 자리").toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.matches('input[type="search"]') ?? false), "찾기 칸에 서지 않는다").toBe(false);

    await 돌아가기(page, place).click();
    await expect(칸).toBeVisible();
    await page.keyboard.press("Meta+f");
    await expect(칸).toBeFocused();
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${place.name}: 줄의 빈 자리(시각 칸)를 눌러도 그 상세다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(place.url);
    const 줄 = 줄링크(page, place).locator("xpath=ancestor::*[@role='row'][1]");
    await 줄.getByRole("cell").nth(1).click();
    await expect(page).toHaveURL(place.target.url);
    await 상세가섰다(page, place);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 줄의 이름 링크에 Tab으로 서면 줄이 지날 때와 같은 면(`fill-soft` — 보드 `.pl-row:focus-visible`)이고 Enter가 그 상세를 연다. Archive는
// `keyboard.spec.ts`가 잰다(그쪽은 목록이 한때 roving이었던 자리라 거기 있다).
for (const place of PLACES.filter(({ name }) => name !== "Archive")) {
  test(`${place.name}: 줄의 이름 링크에 Tab으로 서면 줄이 지날 때의 면이고, Enter가 그 상세를 연다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(place.url);
    const 링크 = 줄링크(page, place);
    const 줄 = 링크.locator("xpath=ancestor::*[@role='row'][1]");
    const 면 = () => 줄.evaluate((el) => getComputedStyle(el).backgroundColor);
    const 옅은면 = await 토큰색(page, "--fill-soft");
    expect(await 면(), "앵커: 쉴 때는 면이 없다").not.toBe(옅은면);
    await 탭으로(page, 링크);
    await expect(링크).toBeFocused();
    await expect.poll(면).toBe(옅은면);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(place.target.url);
    await 상세가섰다(page, place);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 줄 끝의 「작업공간 만들기」 · 「새 채팅」은 그 Project · Service를 범위로 고른 새 채팅을 연다(01a-13 · 01a-14의 씨앗 — 상세 머리의 두 단추와 같은
// 주소다). Archive 줄에는 없다.
for (const [place, 범위] of [
  [PLACES[0], `project=${billing.slug}`],
  [PLACES[1], `service=${encodeURIComponent(결제.slug)}`],
] as const) {
  test(`${place.name}: 줄 끝 「작업공간 만들기」 · 「새 채팅」은 그 범위를 쥔 새 채팅의 주소로 간다`, async ({ page }) => {
    await installFixtureBackend(page);
    for (const [단추, 갈래] of [
      ["작업공간 만들기", "work"],
      ["새 채팅", "thread"],
    ] as const) {
      await page.goto(place.url);
      await 표(page, place).getByRole("button", { name: `${place.target.name} 범위로 ${단추}`, exact: true }).click();
      await expect(page).toHaveURL(`/?new=${갈래}&${범위}`);
      // 새 채팅이 다 섰다 — 그 화면이 씨앗을 읽고 주소를 고쳐 쓰는(replace) 동안 다음 걸음을 걸지 않는다.
      await expect(page.getByRole("textbox", { name: "보낼 말", exact: true })).toBeVisible();
    }
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// 처음 읽는 중의 뼈대는 300ms를 넘겨야 선다(보드 PlaceSheet 「처음 읽는 중」 — 빨리 오면 번쩍이지 않게, `useLate`). 읽는 동안 제목은 선다 —
// 뼈대가 선 때를 제목이 선 때와 견준다(둘 다 같은 관찰자가 적는다). 빨리 온 목록에서는 뼈대가 한 번도 서지 않는다.
const 뼈대 = (page: Page) => page.locator('[aria-busy="true"][aria-label="불러오는 중"]');
/** 제목 · 뼈대가 처음 선 때를 적는 관찰자 — 페이지가 뜨기 전에 깐다. */
const 때를적는다 = (page: Page) =>
  page.addInitScript(() => {
    const 적기 = window as unknown as { 뼈대?: number; 제목?: number };
    new MutationObserver(() => {
      const now = performance.now();
      if (적기.제목 === undefined && [...document.querySelectorAll("main h1")].some((h) => h.textContent === "Projects")) 적기.제목 = now;
      if (적기.뼈대 === undefined && document.querySelector('[aria-busy="true"][aria-label="불러오는 중"]')) 적기.뼈대 = now;
    }).observe(document, { childList: true, subtree: true });
  });
const 적은때 = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { 뼈대?: number; 제목?: number };
    return { 뼈대: w.뼈대 ?? null, 제목: w.제목 ?? null };
  });

test("Projects: 처음 읽기가 300ms를 넘기면 제목 뒤 300ms에 뼈대가 서고, 목록이 오면 걷힌다", async ({ page }) => {
  await 때를적는다(page);
  await installFixtureBackend(page);
  await holdCommand(page, "list_projects");
  await page.goto("/projects");
  await expect(뼈대(page)).toBeVisible();
  const { 뼈대: 선때, 제목 } = await 적은때(page);
  expect(제목, "앵커: 읽는 동안 제목이 섰다").not.toBeNull();
  expect(선때! - 제목!, "제목 → 뼈대").toBeGreaterThanOrEqual(295);
  await expect(표(page, PLACES[0])).toHaveCount(0);
  await releaseCommand(page, "list_projects");
  await expect(표(page, PLACES[0])).toBeVisible();
  await expect(뼈대(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Projects: 처음 읽기가 빨리 오면 뼈대가 한 번도 서지 않는다", async ({ page }) => {
  await 때를적는다(page);
  await installFixtureBackend(page);
  await page.goto("/projects");
  await expect(표(page, PLACES[0])).toBeVisible();
  // 표가 선 뒤 300ms를 더 지나도 — 걸어 둔 타이머가 늦게 터지지 않는다.
  await page.waitForTimeout(400);
  const { 뼈대: 선때, 제목 } = await 적은때(page);
  expect(제목, "앵커: 관찰자가 제목을 봤다").not.toBeNull();
  expect(선때, "뼈대").toBeNull();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 그 상자의 움직임 — 이름 · 길이 · 곡선. */
const 움직임 = (target: Locator) =>
  target.evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.animationName, style.animationDuration, style.animationTimingFunction];
  });
const 들어옴 = ["place-in", "0.24s", "cubic-bezier(0.23, 1, 0.32, 1)"];

// 움직임은 공용 틀(`PlaceStage`) 하나가 건다 — Projects로 잰다. 상세는 오른쪽 10 · 옅음 0에서, 돌아온 목록은 왼쪽 10에서 240ms 들어온다
// (보드 `place-in` · `place-back` — `--duration-place` · `--ease-enter-snappy`).
test("Projects: 줄로 연 상세는 place-in, 돌아온 목록은 place-back으로 들어오고 — 주소로 곧장 연 상세 · 동작 줄이기에서는 움직이지 않는다", async ({
  page,
}) => {
  const place = PLACES[0];
  await installFixtureBackend(page);
  await page.goto(place.url);
  await expect(표(page, place)).toBeVisible();
  // 처음 선 목록은 움직이지 않는다.
  await expect(page.locator("main .place-in, main .place-back")).toHaveCount(0);

  await 줄링크(page, place).click();
  const 상세칸 = page.locator("main .place-in");
  await expect(상세칸).toHaveCount(1);
  expect(await 움직임(상세칸)).toEqual(들어옴);
  await expect(상세칸.getByRole("heading", { level: 1 })).toHaveText(billing.name);

  await 돌아가기(page, place).click();
  const 목록칸 = page.locator("main .place-back");
  await expect(목록칸).toHaveCount(1);
  expect(await 움직임(목록칸)).toEqual(["place-back", ...들어옴.slice(1)]);
  await expect(목록칸.getByRole("table", { name: place.table, exact: true })).toBeVisible();

  // 주소로 곧장 연 상세는 움직이지 않는다.
  await page.goto(place.target.url);
  await 상세가섰다(page, place);
  await expect(page.locator("main .place-in, main .place-back")).toHaveCount(0);

  // 동작 줄이기 — 장면은 바뀌어도 움직임이 없다.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(place.url);
  await 줄링크(page, place).click();
  await 상세가섰다(page, place);
  expect((await 움직임(page.locator("main .place-in")))[0], "동작 줄이기").toBe("none");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// Project 상세의 묶음 줄(작업공간 · Service)로 다른 화면에 가도 창의 뒤로 · 앞으로가 상세와 그 화면을 오간다(restart 03-2 · 보드 PlaceSheet
// 「뒤로 · 앞으로」).
for (const [묶음, 주소] of [
  ["작업공간", /\/works\//],
  ["Service", /\/services\//],
] as const) {
  test(`Project 상세: 「${묶음}」 묶음의 줄로 가면 창의 뒤로가 상세로, 앞으로가 다시 그 화면으로 간다`, async ({ page }) => {
    const place = PLACES[0];
    await installFixtureBackend(page);
    await page.goto(place.target.url);
    await 상세가섰다(page, place);
    const 줄 = 본문(page, place.detail).getByRole("region", { name: 묶음, exact: true }).getByRole("link").first();
    await 줄.click();
    await expect(page).toHaveURL(주소);
    const 간곳 = page.url();
    await page.goBack();
    await expect(page).toHaveURL(place.target.url);
    await 상세가섰다(page, place);
    await page.goForward();
    await expect(page).toHaveURL(간곳);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

/** 폴더를 찾을 수 없는 Project(`projects-kit.spec.ts`의 것과 같은 꼴). */
const playground: ProjectView = {
  slug: "playground",
  name: "playground",
  path: "~/MyProjects/playground",
  baseBranch: "main",
  createdAt: "2026-01-04T03:04:05Z",
  description: "",
  git: null,
  missing: true,
};

test("Project 상세: 폴더를 찾을 수 없다는 경고의 「재설정」은 「<이름>의 새 위치」를 고르는 폴더 창을 연다", async ({ page }) => {
  await installFixtureBackend(page, { list_projects: [...PROJECTS, playground] });
  await page.goto(`/projects/${playground.slug}`);
  await 폴더를고른다(page, null);
  await 본문(page, "Projects 상세").getByRole("button", { name: "재설정", exact: true }).click();
  await expect.poll(() => ipcArgs(page, "plugin:dialog|open", "options")).toHaveLength(1);
  const [{ options }] = (await ipcArgs(page, "plugin:dialog|open", "options")) as { options: { title?: string; directory?: boolean } }[];
  expect([options.title, options.directory]).toEqual([`${playground.name}의 새 위치`, true]);
  // 고르다 그만두면 아무것도 바뀌지 않는다.
  expect(await ipcArgs(page, "relocate_project", "slug")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Project 상세: ⋯의 「이름 바꾸기」 · 「설명 고치기」를 고르면 포커스가 그 칸에 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${billing.slug}`);
  const 판 = 본문(page, "Projects 상세");
  const 메뉴 = 판.getByRole("button", { name: `${billing.name} 메뉴`, exact: true });
  for (const [항목, 칸이름] of [
    ["이름 바꾸기", "Project 이름"],
    ["설명 고치기", "설명"],
  ] as const) {
    await 메뉴.click();
    await page.getByRole("menu").getByRole("menuitem", { name: 항목, exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    const 칸 = 판.getByRole("textbox", { name: 칸이름, exact: true });
    await expect(칸).toBeFocused();
    // 메뉴가 닫히며 포커스를 ⋯로 되돌리지 않는다 — 한 박자 뒤에도 칸이다.
    await page.waitForTimeout(300);
    await expect(칸).toBeFocused();
    await 칸.press("Escape");
    await expect(칸).toHaveCount(0);
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// Services ⋯의 「경로 복사」는 Service 폴더(`services_folder` — fixture 「~/.atelier/services」) 아래 그 파일 경로를 복사하고 토스트가 그것을 말한다
// (restart 03-3).
test("Services: ⋯의 「경로 복사」는 그 Service 파일의 경로를 복사하고 「… 복사됨」 토스트가 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/services/${encodeURIComponent(결제.slug)}`);
  const 판 = 본문(page, "Services 상세");
  await 판.getByRole("button", { name: `${결제.name} 메뉴`, exact: true }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "경로 복사", exact: true }).click();
  const 경로 = `~/.atelier/services/${결제.slug}.md`;
  await expect.poll(() => clipboardWrites(page)).toEqual([경로]);
  await expect(화면토스트(page, `${경로} 복사됨`)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 찾기 칸은 한글을 조합하는 동안에도 거른다(보드 Places 「찾기」 · restart 03-12b) — 조합 중의 `input`(`isComposing`)마다 거른다. 조합이 끝나기를
// 기다리면 「결」을 치는 동안 표가 그대로다. 조합 중의 `input`은 진짜 IME 없이 이벤트로 세운다(`compositionstart` 뒤 `compositionend` 없이).
test("Services: 찾기 칸은 한글 조합 중(`isComposing`)의 입력에도 곧바로 거른다", async ({ page }) => {
  const place = PLACES[1];
  await installFixtureBackend(page);
  await page.goto(place.url);
  await expect(줄링크(page, place)).toBeVisible();
  expect(await 줄이름들(page, place), "앵커: 거르기 전에는 둘 다 선다").toEqual(expect.arrayContaining([결제.name, SERVICES[1].name]));
  await 찾기칸(page, place).evaluate((input: HTMLInputElement) => {
    input.focus();
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    // React가 지켜보는 값을 지나쳐 쓴다 — 키 입력이 쓰는 길과 같다.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "결");
    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "결", inputType: "insertCompositionText", isComposing: true }));
  });
  await expect.poll(() => 줄이름들(page, place)).toEqual([결제.name]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **좁은 창(900 이하)의 판**(restart 03-12b · 보드 `@media (max-width: 900px)` — `시안-비교/최종/Places/차이.md` 「좁은 창」). 판 여백이 위 20 · 옆 16이고,
// 목록 머리가 두 줄(제목 한 줄 · 그 아래 10에 찾기 칸이 주 단추 앞을 채움)이며, 열 머리 120 · 줄 156 + 64n, 줄의 옆 글과 마지막이 아닌 아이콘
// 단추가 숨는다. 상세는 「← 목록」 8 · 14.3, 이름 52.3, 단추 줄 94.3(제목 아래), 설명 134.3, 위 카드 176.3에 두 칸 두 줄(사이 8)이다. Archive
// 문서는 한 열 — 글 아래 32에 「문서」 트리가 판 폭으로 선다. 앱은 900에서도 사이드바가 서 있어(보드는 걷는다 — 03-12a 몫, `결정.md`) 판(본문
// 카드) 기준으로 잰다.
/** 판(`main`) 기준 상자. */
const 판기준 = async (page: Page, target: Locator) => {
  const [판, box] = [(await page.locator("main").boundingBox())!, (await target.boundingBox())!];
  const 반올림 = (n: number) => Math.round(n * 10) / 10;
  return { x: 반올림(box.x - 판.x), y: 반올림(box.y - 판.y), width: 반올림(box.width), height: 반올림(box.height), 판 };
};

test("좁은 창(900 × 700): Projects 목록 판 — 제목 16 · 20, 찾기 칸 62(34)이 주 단추 앞을 채우고, 열 머리 120 · 줄 156 + 64n, 줄 끝은 마지막 단추 하나다", async ({
  page,
}) => {
  const place = PLACES[0];
  await page.setViewportSize({ width: 900, height: 700 });
  await installFixtureBackend(page);
  await page.goto(place.url);
  const 판 = 본문(page, place.name);
  await expect(표(page, place)).toBeVisible();
  const 제목 = await 판기준(page, 판.getByRole("heading", { level: 1, name: place.name, exact: true }));
  expect([제목.x, 제목.y], "제목").toEqual([16, 20]);
  expect(제목.판.width - (제목.x + 제목.width), "제목 — 오른쪽도 16").toBe(16);
  const 찾기 = await 판기준(page, 찾기칸(page, place).locator(".."));
  const 추가 = await 판기준(page, 판.getByRole("button", { name: "Project 추가", exact: true }));
  expect([찾기.x, 찾기.y, 찾기.height], "찾기 칸 — 제목 아래 줄").toEqual([16, 62, 34]);
  expect([추가.y, 추가.height], "주 단추 — 찾기 칸과 한 줄").toEqual([62, 34]);
  expect(추가.x - (찾기.x + 찾기.width), "찾기 칸이 주 단추 앞을 채운다").toBeLessThanOrEqual(12);
  expect(추가.판.width - (추가.x + 추가.width), "주 단추 — 오른쪽 16").toBe(16);

  const 줄들 = 표(page, place).getByRole("row");
  expect((await 판기준(page, 줄들.nth(0))).y, "열 머리").toBe(120);
  const [첫줄, 둘째줄] = [await 판기준(page, 줄들.nth(1)), await 판기준(page, 줄들.nth(2))];
  expect([첫줄.y, 첫줄.height, 둘째줄.y], "줄 156 + 64n").toEqual([156, 64, 220]);
  // 줄의 옆 글(경로)과 마지막이 아닌 아이콘 단추(⋯ · 작업공간 만들기)가 숨고 「새 채팅」 하나가 선다.
  await expect(표(page, place).getByText(billing.path, { exact: true })).toBeHidden();
  await expect(표(page, place).getByRole("button", { name: `${billing.name} 메뉴`, exact: true })).toBeHidden();
  await expect(표(page, place).getByRole("button", { name: `${billing.name} 범위로 작업공간 만들기`, exact: true })).toBeHidden();
  await expect(표(page, place).getByRole("button", { name: `${billing.name} 범위로 새 채팅`, exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("좁은 창(900 × 700): Project 상세 판 — 「← Projects」 8 · 14.3, 이름 52.3, 단추 줄 94.3, 설명 134.3, 위 카드 176.3에 두 칸 두 줄", async ({ page }) => {
  const place = PLACES[0];
  await page.setViewportSize({ width: 900, height: 700 });
  await installFixtureBackend(page);
  await page.goto(place.target.url);
  const 판 = 본문(page, place.detail);
  await 상세가섰다(page, place);
  const 뒤로 = await 판기준(page, 돌아가기(page, place));
  expect([뒤로.x, 뒤로.y], "「← Projects」").toEqual([8, 14.3]);
  expect((await 판기준(page, 상세제목(page, place))).y, "이름").toBe(52.3);
  // 단추 줄 — 제목 아래로 내려와 「작업공간 만들기」 · 「새 채팅」 · ⋯가 판 왼쪽 16부터 선다.
  const 단추들 = await Promise.all(
    ["작업공간 만들기", "새 채팅", `${billing.name} 메뉴`].map((name) => 판기준(page, 판.getByRole("button", { name, exact: true }).first())),
  );
  expect(단추들.map(({ x }) => x), "단추 줄 x").toEqual([16, 136.2, 229.4]);
  expect(단추들[0].y, "단추 줄 y").toBe(94.3);
  expect((await 판기준(page, 판.getByText(billing.description, { exact: true }))).y, "설명").toBe(134.3);
  // 위 카드 넷 — 두 칸 두 줄, 사이 8.
  const 카드들 = await Promise.all(
    ["경로", "기준 브랜치", "원격", "추가한 날"].map((label) =>
      판기준(page, 판.getByText(label, { exact: true }).locator("xpath=ancestor::*[contains(@class,'rounded')][1]")),
    ),
  );
  const xs = [...new Set(카드들.map(({ x }) => x))];
  const ys = [...new Set(카드들.map(({ y }) => y))].sort((a, b) => a - b);
  expect([xs.length, ys.length], "두 칸 두 줄").toEqual([2, 2]);
  expect(ys[0], "위 카드").toBe(176.3);
  expect(ys[1] - (ys[0] + 카드들[0].height), "줄 사이").toBe(8);
  expect(Math.max(...xs) - (Math.min(...xs) + 카드들[0].width), "칸 사이").toBe(8);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("좁은 창(900 × 700): Archive 상세는 한 열 — 「문서」 트리가 글 아래 32에 판 폭으로 서고 붙어 서지 않는다", async ({ page }) => {
  const place = PLACES[2];
  await page.setViewportSize({ width: 900, height: 700 });
  await installFixtureBackend(page);
  await page.goto(place.target.url);
  const 판 = 본문(page, place.detail);
  await 상세가섰다(page, place);
  const [글, 트리] = [await 판기준(page, 판.locator("[data-doc-text]")), await 판기준(page, 판.getByRole("navigation", { name: "문서", exact: true }))];
  expect(Math.round(트리.y - (글.y + 글.height)), "글 아래 32").toBe(32);
  expect([트리.x, 트리.width], "판 폭 — 옆 16").toEqual([16, 트리.판.width - 32]);
  expect(await 판.getByRole("navigation", { name: "문서", exact: true }).evaluate((el) => getComputedStyle(el).position), "붙어 서지 않는다").not.toBe(
    "sticky",
  );
  expect(await unknownIpcCalls(page)).toEqual([]);
});
