import { expect, test, type Locator, type Page } from "./evidence";
import { ARCHIVE, PROJECTS, WORKS } from "./fixtures";
import {
  clipboardWrites,
  installFixtureBackend,
  ipcCallArgs,
  markAttention,
  openShell,
  recordClipboard,
  unknownIpcCalls,
  다떴다,
  띠,
  줄차례,
  탭으로,
  탭차례,
  토큰색,
  포커스자리,
  행버튼,
  type 포커스자리 as 자리,
  Work줄이가는곳,
} from "./harness";

// codex-ds 티켓 32 — **목록은 ↑↓, 영역은 Tab으로 다닌다**(codex-ds 스펙 §9 「키보드」 · S10). 창의 Tab은 영역 차례로 간다 — 창
// 컨트롤 → 머리 줄 → 사이드바 → 본문 → 패널 → 레일이고, 영역 안은 DOM 차례다(02 결정 「03」 — 머리 줄이 판 위 크롬에 한 줄이라
// DOM이 보이는 차례를 따른다. 한때 창 컨트롤 → 사이드바 → 머리 카드 → 머리 줄이었다). 목록 셋(사이드바 work 목록 · main nav ·
// spec 트리 — Archive 상세의 「문서」 트리 포함)은 저마다 **Tab 정류장 하나**이고(roving tabindex — `@/lib/roving`), 목록 안은 ↑↓로 옮기고 Enter로 연다.
// Projects · Services · Archive 목록은 03 판에서 표가 됐다 — 줄마다 이름 링크와 ⋯가 정류장이다(03 결정 「10」 · restart 03-4 — 한때 Archive 목록도 roving이었다). 트리는 →가 펴고 ←가 접는다. 행 안 버튼(고정 · 경로 복사)은 Tab에서 빠지고, 그 동작은 행의 대상 메뉴(⇧F10 · 메뉴 키)에
// 있다 — 고정은 work 메뉴의 「고정」, 경로 복사는 spec 트리 파일 행 메뉴의 「경로 복사」다(구현 노트 Q16).
//
// **Tab은 진짜 키로 누른다.** `.focus()`로 주면 Tab이 지나치는 자리(WebKit의 맨 `<button>` — `@/lib/roving` 머리말)도 초록이 된다.
// 차례는 포커스를 내려놓고 Tab을 누르며 선 자리를 적어(`탭차례`) 그 자리를 품은 상자로 영역을 가른다(`포커스자리`).
//
// 작업공간 화면에는 레일이 선다(restart 02a-14 — 칸 `spec` 하나) — 패널 토글은 머리 줄 할 일 묶음의 끝이고 레일의 칸이 차례 끝에 선다.
// 레일의 모양은 `rail.spec.ts`가 잰다. 작업공간 화면은 채팅이 없으면 새 채팅 탭으로 선다(02a-8 — 한때 `?tab=spec`의 문서 본문이었다).

const [billing] = PROJECTS;
const [shipped, bare] = ARCHIVE;
const [pinnedWork, plainWork, multiWork] = WORKS;

const 고정머리 = "section:pinned";
const 작업머리 = "section:works";

/** 지금 포커스가 선 목록 행의 키(`data-roving`). 행이 아니면 `null`이다. */
const 선행 = async (page: Page) => (await 포커스자리(page))?.행 ?? null;

/** 키를 누르고 포커스가 그 키의 행에 서기를 기다린다. */
async function 간다(page: Page, key: string, 행: string): Promise<void> {
  await page.keyboard.press(key);
  await expect.poll(() => 선행(page), `${key} 뒤`).toBe(행);
}

/** 사이드바 work 목록 · 패널 칸 안의 그 키의 행. */
const 목록행 = (page: Page, 키: string) => page.locator(`[data-worklist] [data-roving="${키}"]`);
const 패널 = (page: Page) => page.locator("aside:not([data-sidebar])");
const 트리행 = (page: Page, 키: string) => 패널(page).locator(`[data-roving="${키}"]`);
/** Archive 상세의 「문서」 트리 행 — 트리는 판 안의 `nav`다(restart 03-4 — 한때 둘째 `aside`의 spec 목록 패널). */
const 문서트리행 = (page: Page, 키: string) => page.locator(`main nav[aria-label="문서"] [data-roving="${키}"]`);
/** 목록 판의 정렬 단추 · 줄 끝 단추(작업공간 만들기 · 새 채팅)의 이름 — 아래 「맨 단추」 검사가 따로 잰다. */
const 정렬과줄단추 = (이름: string) => ["이름", "최근 활동", "보관한 날"].includes(이름) || / 범위로 (작업공간 만들기|새 채팅)$/.test(이름);

/** 차례에서 그 키들 가운데 선 정류장의 키 — 목록 하나가 정류장 하나인지를 본다. */
const 정류장 = (자리들: 자리[], 키들: readonly string[]) =>
  자리들.flatMap(({ 행 }) => (행 !== null && 키들.includes(행) ? [행] : []));

/** 이어진 같은 영역을 하나로 접은 영역 차례. */
const 영역차례 = (자리들: 자리[]) =>
  자리들.map(({ 영역 }) => 영역).filter((영역, i, all) => i === 0 || all[i - 1] !== 영역);

const 메뉴 = (page: Page) => page.getByRole("menu");

/** 열린 메뉴 안에서 ↓를 눌러 그 항목에 간다 — 키보드만으로 고르는 길이다. */
async function 항목으로(page: Page, name: string): Promise<Locator> {
  const item = 메뉴(page).getByRole("menuitem", { name, exact: true });
  await expect(item).toBeVisible();
  for (let n = 0; n < 20 && !(await item.evaluate((el) => el === document.activeElement)); n += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(item).toBeFocused();
  return item;
}

// ── 영역 차례 ──

test("작업 화면의 Tab은 창 컨트롤 → 머리 줄 → 사이드바 → 본문 → 패널 → 레일 차례이고, 목록마다 한 번 앉으며 행 안 버튼에는 안 앉는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(트리행(page, "overview.md")).toBeVisible();

  const 자리들 = await 탭차례(page);
  expect(영역차례(자리들)).toEqual(["창 컨트롤", "머리 줄", "사이드바", "본문", "패널", "레일"]);
  // 머리 줄의 정류장은 화면 자리의 것이다 — 이은 Service(03 구현 스펙 §10 — 「Service 없음」도 누르는 자리다) · 이름 · 상태 · 작업 메뉴 ·
  // 요약 카드, 그리고 묶음 끝의 패널 토글(02 티켓 03). 레일은 칸마다 앉는다. **맨 버튼도 앉는다**(02 코드 리뷰 C1) — `tabindex`를 명시해야
  // macOS WebKit의 Tab이 선다(`@/lib/roving` 머리말). 한때 세로선 너머 「분할」이 섰다 — restart 02a-13이 걷었고, 「요약 카드」가 패널 토글
  // 앞에 섰다(02a-9 · 02a-10).
  expect(자리들.filter(({ 영역 }) => 영역 === "머리 줄").map(({ 이름 }) => 이름)).toEqual([
    "Service: 없음",
    pinnedWork.title,
    pinnedWork.status,
    "작업공간 메뉴",
    "요약 카드",
    "작업공간 패널 접기",
  ]);
  expect(자리들.filter(({ 영역 }) => 영역 === "레일").map(({ 이름 }) => 이름)).toEqual(["spec"]);
  // 사이드바는 위 칸 nav 하나 · work 목록 하나 · 맨 아래 「설정」이다(v1 티켓 07 · 42 — 맨 위의 검색 칸은 46이 걷었다, 검색은 창
  // 컨트롤의 🔍다. 「전체 | 내 차례」 마디는 02 티켓 04가 걷어 「내 차례」가 nav의 한 줄이 됐다. 바닥 사람 줄은 02a-3이 「설정」으로
  // 바꿨다). nav의 정류장은 첫 항목(켜진 것이 없다), 목록의 정류장은 고른 행이다. 구획 머리 · 다른 행 · nav의 나머지는 ↑↓로 간다(아래 검사들).
  expect(자리들.filter(({ 영역 }) => 영역 === "사이드바").map(({ 이름, 행 }) => [이름, 행])).toEqual([
    ["새 채팅", "new-thread"],
    [pinnedWork.title, pinnedWork.slug],
    ["설정", null],
  ]);
  // 패널은 머리의 버튼 하나와 트리 하나다 — 트리의 정류장은 연 문서의 행이다.
  expect(자리들.filter(({ 영역 }) => 영역 === "패널").map(({ 이름, 행 }) => [이름, 행])).toEqual([
    ["spec 폴더 열기", null],
    ["overview.md", "overview.md"],
  ]);

  // 행 안 버튼(핀 · 트리의 경로 복사)은 차례에 없다. 그 버튼들이 서 있다는 것이 앵커다 — 없어서 안 앉은 것이 아니다.
  await expect(행버튼(page, `${pinnedWork.title} 고정`)).toHaveCount(1);
  await expect(패널(page).getByRole("button", { name: "overview.md 경로 복사", exact: true })).toHaveCount(1);
  expect(자리들.filter(({ 이름 }) => 이름.endsWith(" 고정") || 이름.endsWith(" 경로 복사"))).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("목록 표는 줄마다 이름 링크 · ⋯에 앉고, Archive 상세의 문서 트리는 Tab이 한 번 — 고른 행에 — 앉으며 숨은 목록에는 앉지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/projects");
  await expect(page.getByRole("table", { name: "Project 목록", exact: true })).toBeVisible();
  // 본문의 정류장 — 찾기 · 「Project 추가」 뒤에 줄마다 이름 링크와 그 줄의 ⋯다(roving 목록이 아니다). 정렬 단추 · 줄 끝 단추는 아래 검사가 잰다.
  const 본문정류장 = async () =>
    (await 탭차례(page)).filter(({ 영역, 이름 }) => 영역 === "본문" && !정렬과줄단추(이름)).map(({ 이름 }) => 이름);
  expect(await 본문정류장()).toEqual(["Project 찾기", "Project 추가", ...PROJECTS.flatMap((one) => [one.name, `${one.name} 메뉴`])]);

  // Archive 목록도 같은 표다(restart 03-4 — 한때 두 줄 행의 roving 목록이라 Tab이 한 번 앉았다). 주 단추는 없다.
  await page.goto("/archive");
  await expect(page.getByRole("table", { name: "Archive 목록", exact: true })).toBeVisible();
  expect(await 본문정류장()).toEqual(["Archive 찾기", ...[shipped, bare].flatMap((one) => [one.title, `${one.title} 메뉴`])]);

  // 상세 — 판(「← Archive」 · 「Finder에서 열기」 · ⋯ · 문서 글)과 트리. 트리의 정류장은 연 문서(기록)의 행 하나다. 상세가 선 동안 숨은 목록
  // (`inert`)의 이름 링크 · ⋯에는 앉지 않는다. 이 화면에는 패널이 없다.
  await page.goto(`/archive/${shipped.slug}`);
  await expect(문서트리행(page, "record.md")).toBeVisible();
  const 자리들 = await 탭차례(page);
  const 트리키 = ["record.md", "spec", "spec/tickets", "spec/tickets/할일.md", "spec/목업", "spec/목업/조각.html", "spec/증거", "spec/증거/샷.png"];
  expect(정류장(자리들, 트리키)).toEqual(["record.md"]);
  const 본문 = 자리들.filter(({ 영역 }) => 영역 === "본문").map(({ 이름 }) => 이름);
  expect(본문.slice(0, 3)).toEqual(["Archive", "Finder에서 열기", `${shipped.title} 메뉴`]);
  expect(본문[본문.length - 1]).toBe("record.md");
  expect(본문).not.toContain(bare.title);
  expect(본문).not.toContain(`${bare.title} 메뉴`);
  expect(영역차례(자리들)).not.toContain("패널");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **목록 · 상세의 맨 `<button>`에도 Tab이 앉는다** — 열 머리 정렬 단추(`SortHead`) · 줄 끝 「작업공간 만들기」 · 「새 채팅」(`Hint`) · 묶음 머리의
// +(한때 상세 제목 단추도 — restart 03-15c가 걷었다). macOS WebKit의 Tab은 `tabIndex`를 적지 않은 맨 단추를 지나친다(`@/lib/roving` 머리말 · 02 코드 리뷰 C1 「맨 버튼도
// 앉는다」). 03-13이 이 검사로 찾은 앱 어긋남이었고(03-4가 적은 차례는 「Archive 찾기」 → 열 머리 정렬 단추 둘 → 줄마다 이름 링크 · ⋯ —
// `e2e-수리.md` 「03」), 03-13b가 앱의 다른 단추처럼 `tabIndex`를 적어 고쳤다 — 시험을 앱에 맞추지 않았다.
test("목록 · 상세의 맨 단추(열 머리 정렬 · 줄 끝 「작업공간 만들기」 · 「새 채팅」 · 묶음의 +)에도 Tab이 앉는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");
  await expect(page.getByRole("table", { name: "Project 목록", exact: true })).toBeVisible();
  const 본문정류장 = async () => (await 탭차례(page)).filter(({ 영역 }) => 영역 === "본문").map(({ 이름 }) => 이름);
  expect(await 본문정류장()).toEqual([
    "Project 찾기",
    "Project 추가",
    "이름",
    "최근 활동",
    ...PROJECTS.flatMap((one) => [one.name, `${one.name} 메뉴`, `${one.name} 범위로 작업공간 만들기`, `${one.name} 범위로 새 채팅`]),
  ]);
  await page.goto("/archive");
  await expect(page.getByRole("table", { name: "Archive 목록", exact: true })).toBeVisible();
  expect(await 본문정류장()).toEqual(["Archive 찾기", "이름", "보관한 날", ...[shipped, bare].flatMap((one) => [one.title, `${one.title} 메뉴`])]);
  // 상세 — 묶음 머리의 +(「작업공간 만들기」 — 머리의 같은 이름 단추와 둘)도 맨 `<button>`이라 지나친다. 제목은 이름 글이라 정류장이 아니다.
  await page.goto(`/projects/${billing.slug}`);
  await expect(page.getByRole("region", { name: "작업공간", exact: true })).toBeVisible();
  const 상세 = await 본문정류장();
  expect(상세.filter((이름) => 이름 === "작업공간 만들기"), "머리 · 「작업공간」 묶음의 +").toHaveLength(2);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// Archive 상세 판 안의 Tab은 DOM 차례가 보이는 차례다 — 왼쪽 문서 글을 지나 오른쪽 「문서」 트리로 간다(restart 03-4 — 한때 내용 | 목록 카드의
// 두 칸이었다, codex-ds 결정 28). 트리를 CSS로 오른쪽에 옮겨 세우면 Tab이 오른쪽에서 왼쪽으로 거슬러 간다. 글과 트리 사이는 글 안 블록마다의
// 「N줄 참조 복사」(거터 단추 — 포커스면 선다)다(restart 03-13c — 한때 맨 `<button>`이라 WebKit Tab이 지나쳐 글 다음이 곧 트리였다).
test("Archive 상세 판 안 Tab은 왼쪽 문서 글을 지나 오른쪽 「문서」 트리로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);
  await expect(문서트리행(page, "record.md")).toBeVisible();
  const 본문 = (await 탭차례(page)).filter(({ 영역 }) => 영역 === "본문");
  const 글 = 본문.findIndex(({ 이름 }) => 이름.startsWith("기록 — 치운 일"));
  const 트리 = 본문.findIndex(({ 행 }) => 행 === "record.md");
  expect(글, "문서 글이 정류장이다").toBeGreaterThan(-1);
  expect(트리).toBeGreaterThan(글);
  const 사이 = 본문.slice(글 + 1, 트리).map(({ 이름 }) => 이름);
  expect(사이.length, "글 안 블록의 참조 복사").toBeGreaterThan(0);
  for (const 이름 of 사이) expect(이름).toMatch(/^[\d–]+줄 참조 복사$/);
  const 글상자 = (await page.locator("main [data-doc-text]").boundingBox())!;
  const 트리상자 = (await 문서트리행(page, "record.md").boundingBox())!;
  expect(트리상자.x).toBeGreaterThan(글상자.x + 글상자.width);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 레일은 패널 다음 정류장이고, 패널을 닫아도 남아 Tab이 앉는다 — 닫힌 패널을 다시 여는 길이 레일 칸이다(restart 02a-14). 한때 진열대
// (`e2e/rail-fixture.tsx`)에서 칸 둘(`spec` · `files`)의 차례를 쟀다 — 02a-14가 진열대와 files 칸을 걷었다.
test("레일이 서면 Tab은 패널 다음에 레일로 가고, 패널을 닫아도 본문 다음에 레일 칸에 앉는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(트리행(page, "overview.md")).toBeVisible();
  expect(영역차례(await 탭차례(page)).slice(-3)).toEqual(["본문", "패널", "레일"]);

  await page.getByRole("group", { name: "레일", exact: true }).getByRole("button", { name: "spec", exact: true }).click();
  await expect(page.getByRole("button", { name: "작업공간 패널 펼치기", exact: true })).toBeVisible();
  const 자리들 = await 탭차례(page);
  expect(영역차례(자리들).slice(-2)).toEqual(["본문", "레일"]);
  expect(자리들.filter(({ 영역 }) => 영역 === "레일").map(({ 이름 }) => 이름)).toEqual(["spec"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 알림 띠 ──
// 띠는 부르는 셸이 있을 때만 선다 — 위 사이드바 차례는 띠가 없는 화면에서 잰 것이다. 띠는 목록 다섯이 아니라 roving이 없고, 줄마다 ·
// ⌄가 저마다 Tab 정류장이다. 줄은 work 대상이다(codex-ds 스펙 §9 대상 표 「알림 띠 행」).
//
// **차례는 띠 앞뒤만 Tab으로 걷는다**(`탭차례`가 아니다) — 띠가 서는 터미널 화면에서는 xterm이 Tab을 셸 입력으로 받아 포커스가 그
// 칸에서 안 나온다.

test("알림 띠의 줄과 ⌄에도 Tab이 앉고, 줄의 ⇧F10 · 메뉴 키는 그 work 메뉴를 줄 곁에 열며, ⌄의 Enter는 띠를 펼친다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  // 셸 넷이 함께 부른다 — 띠가 ⌄로 접히는 가장 작은 수(`BAND_LIMIT` + 1)다. 칸은 `+`의 「새 셸」로 열고(작업공간 화면의 ⌘T는 새 채팅
  // 탭이다 — restart 02a-8), 연 순서가 곧 pty 번호다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  for (const ptyId of [1, 2, 3, 4]) {
    if (ptyId > 1) await openShell(page);
    await markAttention(
      page,
      { agent: "claude", event: "Elicitation", at: Date.now(), payload: { message: `말 ${ptyId}` } },
      ptyId,
    );
  }
  await expect(띠(page).locator("[data-band-count]")).toHaveText("4");
  const 줄들 = 띠(page).locator("[data-band-line]");
  await expect(줄들).toHaveCount(3);
  const 더보기 = 띠(page).getByRole("button", { name: "1개 더 보기", exact: true });

  // 칸의 xterm이 쥔 포커스를 내려놓고 창 앞에서 걷는다 — nav 다음이 띠의 줄 셋과 ⌄이고, 그다음이 work 목록의 고른 행이다.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await 탭으로(page, 줄들.nth(0));
  for (const 다음 of [줄들.nth(1), 줄들.nth(2), 더보기, 목록행(page, plainWork.slug)]) {
    await page.keyboard.press("Tab");
    await expect(다음).toBeFocused();
  }
  // 거꾸로도 같은 정류장이다.
  for (const 앞 of [더보기, 줄들.nth(2), 줄들.nth(1), 줄들.nth(0)]) {
    await page.keyboard.press("Shift+Tab");
    await expect(앞).toBeFocused();
  }

  // 메뉴를 닫으면 포커스가 줄로 돌아오므로 다음 키도 그 줄에서 누른다.
  for (const key of ["Shift+F10", "ContextMenu"]) {
    await page.keyboard.press(key);
    const menu = 메뉴(page);
    await expect(menu).toBeVisible();
    // 그 work의 메뉴다 — 고정되지 않은 work라 정리 묶음의 첫 줄이 「고정」이다.
    await expect(menu.getByRole("menuitem", { name: "고정", exact: true })).toBeVisible();
    // 커서가 없으니 줄의 왼쪽 아래에 선다.
    await 다떴다(menu);
    const spot = (await 줄들.nth(0).boundingBox())!;
    const card = (await menu.boundingBox())!;
    // 키로 연 메뉴도 대상의 왼쪽 아래를 정수 픽셀로 받는다(`openMenuByKey`가 쏘는 `MouseEvent`의 자리) — 대상이 반 픽셀에 서도 카드는
    // 그 아래 정수에 선다(`shell-tab-menu.spec.ts`와 같은 잣대).
    expect([Math.round(card.x), Math.round(card.y)], key).toEqual([Math.floor(spot.x), Math.floor(spot.y + spot.height)]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(줄들.nth(0), key).toBeFocused();
  }

  await 탭으로(page, 더보기);
  await page.keyboard.press("Enter");
  await expect(줄들).toHaveCount(4);
  await expect(띠(page).getByRole("button", { name: "접기", exact: true })).toHaveAttribute("aria-expanded", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 목록 안은 ↑↓ · Enter ──
// 끝에서 돌지 않는다 — 첫 행의 ↑, 끝 행의 ↓는 그 자리에 선다.

test("사이드바 work 목록은 ↑↓로 구획 머리와 행을 지나고, 머리의 Enter는 그 구획을 접으며 행의 Enter는 그 work를 연다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${billing.slug}`);
  // 고른 work가 없으면 정류장은 첫 머리(`고정`)다.
  await 탭으로(page, 목록행(page, 고정머리));
  await 간다(page, "ArrowUp", 고정머리);
  await 간다(page, "ArrowDown", pinnedWork.slug);
  await 간다(page, "ArrowDown", 작업머리);
  await 간다(page, "ArrowDown", plainWork.slug);
  await 간다(page, "ArrowDown", multiWork.slug);
  await 간다(page, "ArrowDown", multiWork.slug);
  await 간다(page, "ArrowUp", plainWork.slug);
  await 간다(page, "ArrowUp", 작업머리);
  await 간다(page, "ArrowUp", pinnedWork.slug);
  await 간다(page, "ArrowUp", 고정머리);

  // 머리의 Enter가 구획을 접는다 — 접힌 구획의 행은 지나친다.
  await page.keyboard.press("Enter");
  await expect(목록행(page, 고정머리)).toHaveAttribute("aria-expanded", "false");
  await 간다(page, "ArrowDown", 작업머리);
  await 간다(page, "ArrowUp", 고정머리);
  await page.keyboard.press("Enter");
  await expect(목록행(page, 고정머리)).toHaveAttribute("aria-expanded", "true");

  await 간다(page, "ArrowDown", pinnedWork.slug);
  await 간다(page, "ArrowDown", 작업머리);
  await 간다(page, "ArrowDown", plainWork.slug);
  // 행의 Enter는 그 작업공간의 채팅 탭으로 간다 — 이은 채팅이 없으면 새 채팅 탭이다(v1 티켓 37 · restart 02a-8).
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(Work줄이가는곳(plainWork.slug));
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// nav(위 칸)는 「새 채팅」 · 「내 차례」 뒤로 가는 곳 다섯이다(v1 티켓 07, 02 티켓 04 — 「내 차례」가 마디에서 nav로 왔다, 01a-1 — Library를
// 걷었다, restart 02a-3 — 한때 사람 메뉴에 있던 다섯이 위 칸으로 올라왔다).
test("nav는 ↑↓로 항목을 지나고 Enter가 그 화면으로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await 탭으로(page, page.locator("aside nav").getByRole("button", { name: "새 채팅", exact: true }));
  await 간다(page, "ArrowUp", "new-thread");
  for (const 행 of ["mine", "services", "projects", "terminal", "processes", "archive", "archive"]) await 간다(page, "ArrowDown", 행);
  await 간다(page, "ArrowUp", "processes");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/processes");
  await 간다(page, "ArrowUp", "terminal");
  for (const 행 of ["projects", "services", "mine", "new-thread"]) await 간다(page, "ArrowUp", 행);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 설정 nav는 목록 다섯 밖이지만 nav와 같은 `SidebarItem`이 같은 자리에 갈아 서서 같은 규칙이다(`Sidebar`의 `settingsRoving`).
test("설정 nav도 Tab이 켜진 항목에 한 번 앉고, ↑↓로 항목을 지나며 Enter가 그 항목을 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/notifications");
  const 설정nav = page.getByRole("navigation", { name: "설정", exact: true });
  const 알림 = 설정nav.getByRole("button", { name: "알림", exact: true });
  await expect(알림).toBeVisible();
  // 사이드바는 혼자 선 「앱으로 돌아가기」와 설정 nav 하나다 — nav의 정류장은 켜진 항목이다.
  expect((await 탭차례(page)).filter(({ 영역 }) => 영역 === "사이드바").map(({ 이름, 행 }) => [이름, 행])).toEqual([
    ["앱으로 돌아가기", null],
    ["알림", "notifications"],
  ]);

  await 탭으로(page, 알림);
  await 간다(page, "ArrowUp", "terminal");
  await 간다(page, "ArrowUp", "terminal");
  await 간다(page, "ArrowDown", "notifications");
  await 간다(page, "ArrowDown", "hooks");
  await 간다(page, "ArrowDown", "spec-layout");
  await 간다(page, "ArrowDown", "spec-layout");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/settings/spec-layout");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// Archive 목록은 표다(restart 03-4) — 한때 두 줄 행의 roving 목록이라 ↑↓로 행을 지났다. 이제 Tab이 줄마다 이름 링크에 서고, 그때 줄이 지날 때와 같은
// 면(`fill-soft` — 보드 `.pl-row:focus-visible`)이며 Enter가 그 아카이브를 연다.
test("Archive 목록 줄의 이름 링크에 Tab으로 서면 줄이 지날 때의 면이고, Enter가 그 아카이브를 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/archive");
  const 링크 = page.getByRole("table", { name: "Archive 목록", exact: true }).getByRole("link", { name: bare.title, exact: true });
  const 줄 = 링크.locator("xpath=ancestor::*[@role='row'][1]");
  const 면 = () => 줄.evaluate((el) => getComputedStyle(el).backgroundColor);
  const 쉴때 = await 면();
  await 탭으로(page, 링크);
  await expect(링크).toBeFocused();
  await expect.poll(면).toBe(await 토큰색(page, "--fill-soft"));
  expect(쉴때).not.toBe(await 토큰색(page, "--fill-soft"));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/archive/${bare.slug}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// Enter는 그 문서를 지금 채팅 탭(여기는 새 채팅 탭 — 채팅이 없는 작업공간)의 넓힌 카드로 연다 — 넓히면 spec 패널이 접힌다(restart 02a-12 ·
// SummarySheet 표). 한때 문서 탭에 열어 트리의 그 행이 고른 행 · 포커스로 남았다.
test("spec 트리는 ↑↓로 보이는 행을 지나고 Enter가 그 문서를 넓힌 카드로 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await 탭으로(page, 트리행(page, "overview.md"));
  await 간다(page, "ArrowUp", "overview.md");
  await 간다(page, "ArrowDown", "메타.json");
  await page.keyboard.press("Enter");
  await expect(page.locator("section[data-expanded]")).toBeVisible();
  await expect(page).toHaveURL(/tab=chat&file=%EB%A9%94%ED%83%80\.json|tab=chat&file=메타\.json/);
  await expect(page.getByRole("button", { name: "작업공간 패널 펼치기", exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 트리의 ← · → ──
// →는 접힌 폴더를 펴고 펼친 폴더에서는 첫 자식으로 간다. ←는 펼친 폴더를 접고, 아니면 부모 폴더로 간다(APG 트리 뷰).

test("작업 패널의 spec 트리는 →가 펴고 ←가 접으며, 펼친 폴더의 →는 첫 자식으로 · 파일의 ←는 부모로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await 탭으로(page, 트리행(page, "overview.md"));
  await 간다(page, "ArrowDown", "메타.json");
  await 간다(page, "ArrowDown", "목업");
  const 목업 = 트리행(page, "목업");
  await expect(목업).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("ArrowLeft");
  await expect(목업).toHaveAttribute("aria-expanded", "false");
  await expect(목업).toBeFocused();
  // 접힌 폴더의 자식은 지나친다.
  await 간다(page, "ArrowDown", "증거");
  await 간다(page, "ArrowUp", "목업");
  // 첫 층 폴더의 ←는 갈 부모가 없어 그 자리다.
  await 간다(page, "ArrowLeft", "목업");

  await page.keyboard.press("ArrowRight");
  await expect(목업).toHaveAttribute("aria-expanded", "true");
  await expect(목업).toBeFocused();
  await 간다(page, "ArrowRight", "목업/조각.html");
  // 파일의 →는 아무 데도 안 간다.
  await 간다(page, "ArrowRight", "목업/조각.html");
  await 간다(page, "ArrowLeft", "목업");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Archive 상세의 문서 트리도 ← · →로 중첩 폴더를 오르내린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/archive/${shipped.slug}`);
  const 트리행 = 문서트리행;
  await 탭으로(page, 트리행(page, "record.md"));
  await 간다(page, "ArrowDown", "spec");
  await 간다(page, "ArrowRight", "spec/tickets");
  await 간다(page, "ArrowRight", "spec/tickets/할일.md");
  await 간다(page, "ArrowLeft", "spec/tickets");
  await page.keyboard.press("ArrowLeft");
  await expect(트리행(page, "spec/tickets")).toHaveAttribute("aria-expanded", "false");
  await 간다(page, "ArrowLeft", "spec");
  await page.keyboard.press("ArrowLeft");
  await expect(트리행(page, "spec")).toHaveAttribute("aria-expanded", "false");
  // 접힌 `spec/`이 끝 행이다.
  await 간다(page, "ArrowDown", "spec");
  await 간다(page, "ArrowUp", "record.md");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 행 안 버튼의 동작은 행 메뉴에 ──

test("work 행에서 ⇧F10을 누르면 그 work 메뉴가 뜨고, 그 「고정」이 핀과 같은 명령을 낸다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${billing.slug}`);
  await 탭으로(page, 목록행(page, 고정머리));
  await 간다(page, "ArrowDown", pinnedWork.slug);
  await 간다(page, "ArrowDown", 작업머리);
  await 간다(page, "ArrowDown", plainWork.slug);

  await page.keyboard.press("Shift+F10");
  await expect(메뉴(page)).toBeVisible();
  await 항목으로(page, "고정");
  await page.keyboard.press("Enter");
  await expect(메뉴(page)).toHaveCount(0);
  await expect
    .poll(async () => (await ipcCallArgs(page, "set_work_pinned", "pinned")).map(({ args }) => args))
    .toEqual([{ slug: plainWork.slug, pinned: true }]);
  // 키로 연 메뉴가 닫히면 포커스가 그 행으로 돌아온다 — 목록의 자리를 잃지 않는다.
  await expect(행버튼(page, plainWork.title)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("spec 트리 파일 행에서 ⇧F10을 누르면 「경로 복사」 메뉴가 뜨고, 폴더 행에서는 아무것도 안 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await 탭으로(page, 트리행(page, "overview.md"));
  await 간다(page, "ArrowDown", "메타.json");

  await page.keyboard.press("Shift+F10");
  const menu = 메뉴(page);
  await expect(menu).toBeVisible();
  await expect.poll(() => 줄차례(menu)).toEqual(["경로 복사"]);
  await 항목으로(page, "경로 복사");
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect.poll(() => clipboardWrites(page)).toEqual([`~/.atelier/works/${pinnedWork.slug}/spec/메타.json`]);
  await expect(트리행(page, "메타.json")).toBeFocused();

  // 폴더 행은 메뉴의 대상이 아니다 — ⇧F10 뒤의 ↓가 메뉴 안이 아니라 트리의 다음 행으로 간다.
  await 간다(page, "ArrowDown", "목업");
  await page.keyboard.press("Shift+F10");
  await 간다(page, "ArrowDown", "목업/조각.html");
  await expect(menu).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── F2는 그대로 ──

// Project 목록 행의 F2는 03 판에서 걷혔다(03 결정 「10」). 그 뒤의 상세 제목 이름 바꾸기도 걷혔다 — Project 이름은 대화로 고친다(restart 03-15c).
test("↓로 옮겨 간 work 행에서도 F2가 그 행의 이름을 고치고, Esc면 포커스가 그 행으로 돌아온다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${billing.slug}`);
  await 탭으로(page, 목록행(page, 고정머리));
  await 간다(page, "ArrowDown", pinnedWork.slug);
  await page.keyboard.press("F2");
  const 작업이름 = page.getByRole("textbox", { name: "작업공간 이름", exact: true });
  await expect(작업이름).toBeFocused();
  await expect(작업이름).toHaveValue(pinnedWork.title);
  await page.keyboard.press("Escape");
  await expect(목록행(page, pinnedWork.slug)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 접히는 패널 ──
// 닫힌 사이드바 · 패널의 안쪽은 `inert`라 Tab이 안 닿고, 포커스를 품은 채 접히면 그 포커스가 여닫는 토글로 간다 — 다음 Tab이 창 맨
// 앞에서 다시 시작하지 않는다.

test("포커스를 품은 채 ⌘B로 사이드바를 접으면 포커스가 사이드바 토글로 가고, 접힌 사이드바는 Tab 차례에서 빠진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${billing.slug}`);
  await 탭으로(page, 목록행(page, 고정머리));

  await page.keyboard.press("Meta+b");
  const 토글 = page.getByRole("button", { name: "사이드바 토글", exact: true });
  await expect(토글).toHaveAttribute("aria-expanded", "false");
  await expect(토글).toBeFocused();
  await expect(page.locator("#app-sidebar > [inert]")).toHaveCount(1);
  expect(영역차례(await 탭차례(page))).not.toContain("사이드바");

  await page.keyboard.press("Meta+b");
  await expect(토글).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#app-sidebar > [inert]")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("포커스를 품은 채 ⌘Enter로 작업 패널을 접으면 포커스가 패널 토글로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await 탭으로(page, 트리행(page, "overview.md"));

  // 접힌 패널의 몸은 `inert`다 — 포커스를 쥔 행이 접힌 몸에 남아도 포커스는 토글로 간다(한때 접힐 때 트리를 새로 세워 행이 문서에서 빠졌다 —
  // restart 02a-14가 그 세대를 걷었다).
  await page.keyboard.press("Meta+Enter");
  await expect(page.getByRole("button", { name: "작업공간 패널 펼치기", exact: true })).toBeFocused();
  expect(영역차례(await 탭차례(page))).not.toContain("패널");
  expect(await unknownIpcCalls(page)).toEqual([]);
});
