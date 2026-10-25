import { expect, test, type Locator, type Page } from "./evidence";
import { ARCHIVE, ARCHIVED_DOCS, PROJECTS, WORKS } from "./fixtures";
import {
  callCount,
  clipboardWrites,
  installFixtureBackend,
  ipcCallArgs,
  recordClipboard,
  unknownIpcCalls,
  다떴다,
  화면머리,
  적힌주소,
  주소적기,
  줄차례,
  테두리,
  토큰색,
  표를꽂는다,
} from "./harness";

// codex-ds 티켓 30 — **프로젝트 · Archive · 문서 글을 우클릭한다**(codex-ds 스펙 §9 대상 메뉴 표 · 결정 6 · 7 · 10 · 11, 스토리 70 · 73
// · 75 · 76). work 대상(`work-context-menu.spec.ts`)과 같은 규칙이다 — 그 대상의 메뉴가 커서 자리에 서고, 고름 · 주소는 그대로이며, 열린
// 동안만 대상에 대상 테두리(포커스 링)가 선다. ⇧F10 · 메뉴 키는 포커스된 대상의 같은 메뉴를 그 대상 곁에 연다. ⋯이 있는 대상은 ⋯과
// 같은 목록이다. 나머지 두 대상(Processes 행 · spec 레이아웃 행)은 ⋯ 검사가 사는 파일에 우클릭 판을 더했다(`processes-strays` ·
// `spec-layout-page`).
//
// - 프로젝트(목록 행 · 머리 줄 이름): Finder에서 열기 · 경로 복사 — 이름 바꾸기 F2 — 제거(확인 창). 「LLM이 받는 텍스트」는 없다(S13).
// - Archive 목록 행: 머리 줄 ⋯(아카이브 메뉴)와 같은 목록 — Finder에서 열기 · 경로 복사.
// - spec 트리 파일 행(작업 · Archive 패널, 티켓 32 — 구현 노트 Q16): 경로 복사 하나다. 행의 복사 버튼이 Tab 정류장이 아니어서 키보드의
//   복사 길이 이 메뉴다. 폴더 행은 대상이 아니다.
// - 문서 글(Works · Archive 문서): 고른 글자가 있으면 복사, 없으면 원문으로 보기 · 경로 복사.
//
// **문서 글의 고름은 검사가 만든다** — macOS WebKit은 우클릭한 낱말을 스스로 고르고 리눅스 WebKit은 안 고른다(`edit-menu.spec.ts`와
// 같은 사정). 그래서 고름을 먼저 만들고 **그 고름 안을** 우클릭하거나, 고름 없이 글자를 우클릭해 「낱말을 골라도 고른 것 없음의 메뉴」를
// 잰다 — 앱은 오른쪽 누름의 순간(`pointerdown`)에 고름을 쥐므로 두 기계에서 같은 메뉴다.

const [billing, ledger] = PROJECTS;
const [shipped, bare] = ARCHIVE;
const [pinnedWork] = WORKS;
const [RECORD] = ARCHIVED_DOCS[shipped.slug].docs;

/** 열기 — 고치기 — 되돌릴 수 없는 것(codex-ds 결정 10). 「LLM이 받는 텍스트」는 없다(S13). */
const 프로젝트메뉴차례 = ["Finder에서 열기", "경로 복사", "—", "이름 바꾸기F2", "—", "제거"];

const 메뉴 = (page: Page) => page.getByRole("menu");
const 항목 = (page: Page, name: string) => 메뉴(page).getByRole("menuitem", { name, exact: true });

/**
 * 버튼을 역할로 집되 **메뉴가 열린 동안에도 찾는다** — 메뉴가 열리면 부품이 바깥을 보조 기술에서 숨겨(`aria-hidden`) 역할로는 대상이
 * 안 잡힌다. 열린 동안 대상의 자리 · 테두리를 재야 해서 숨은 것까지 집는다.
 */
const 버튼 = (scope: Locator | Page, name: string) => scope.getByRole("button", { name, exact: true, includeHidden: true });

/**
 * 목록에서 고른 행의 표식 값 — 고름이 그대로인지는 이것으로 잰다. 고른 줄(`selected-row`)이 표식을 단 행 자신이거나(목록 행) 그 안에
 * 선다(spec 트리 — 표식은 파일 행을 감싼 상자에 있다).
 */
const 고른행 = (page: Page, mark: string) =>
  page
    .locator(".selected-row")
    .evaluateAll((rows, mark) => rows.flatMap((row) => row.closest(`[${mark}]`)?.getAttribute(mark) ?? []), mark);

/** spec 트리에서 그 경로의 파일 행 이름 버튼 — 메뉴가 열린 동안에도 집도록 역할이 아니라 표식으로 집는다. */
const 트리파일 = (page: Page, path: string) => page.locator(`[data-spec-file="${path}"] [data-roving]`);

/** 그 대상을 커서로 우클릭해 메뉴가 뜬 것을 본다. */
async function 우클릭한다(page: Page, target: Locator): Promise<Locator> {
  await target.click({ button: "right", position: { x: 6, y: 6 } });
  const menu = 메뉴(page);
  await expect(menu).toBeVisible();
  return menu;
}

/** 열린 메뉴 카드의 왼쪽 위가 그 자리인가 — 우클릭은 커서 자리, 키는 대상의 왼쪽 아래다. */
async function 카드자리(menu: Locator): Promise<[number, number]> {
  await 다떴다(menu);
  const card = (await menu.boundingBox())!;
  return [Math.round(card.x), Math.round(card.y)];
}

// ── 대상 테두리 · 자리 · 고름 그대로 · ⇧F10 (결정 7 · 11) ──
// 대상마다 화면을 세우고 그 대상과 메뉴의 차례, 그때 고른 행(표식과 값)을 돌려준다. **대상은 고른 것이 아닐 수 있다**(결정 7) — 목록 행은
// 일부러 다른 것을 보는 중에 집어, 메뉴가 고른 것이 아니라 그 대상의 것인지를 함께 잰다.

interface 대상 {
  name: string;
  setUp: (page: Page) => Promise<{ target: Locator; order: string[]; mark: string; selected: string }>;
}

const 대상들: 대상[] = [
  {
    name: "프로젝트 목록 행",
    setUp: async (page) => {
      await page.goto(`/projects/${billing.slug}`);
      const list = page.getByRole("region", { name: "프로젝트 목록", exact: true, includeHidden: true });
      return { target: 버튼(list, `${ledger.name} ${ledger.path}`), order: 프로젝트메뉴차례, mark: "data-project-row", selected: billing.slug };
    },
  },
  {
    name: "프로젝트 머리 줄 이름",
    setUp: async (page) => {
      await page.goto(`/projects/${billing.slug}`);
      return {
        target: 화면머리(page).getByText(billing.name, { exact: true }),
        order: 프로젝트메뉴차례,
        mark: "data-project-row",
        selected: billing.slug,
      };
    },
  },
  {
    name: "Archive 목록 행",
    setUp: async (page) => {
      await page.goto(`/archive/${shipped.slug}`);
      // ⋯과 같은 목록이다(결정 6) — 머리 줄 ⋯를 먼저 열어 그 차례를 읽는다. 대상은 고르지 않은 행이다.
      const more = 버튼(화면머리(page), "아카이브 메뉴");
      await more.click();
      const order = await 줄차례(메뉴(page));
      await page.keyboard.press("Escape");
      await expect(메뉴(page)).toHaveCount(0);
      expect(order, "머리 줄 ⋯의 아카이브 메뉴").toEqual(["Finder에서 열기", "경로 복사"]);
      return { target: page.locator(`[data-archive-row="${bare.slug}"]`), order, mark: "data-archive-row", selected: shipped.slug };
    },
  },
  // spec 트리 파일 행 — 대상은 고른 파일이 아닌 행이고, 테두리 · 돌아올 포커스는 그 행의 이름 버튼(목록의 roving 줄)이다.
  {
    name: "작업 패널의 spec 트리 파일 행",
    setUp: async (page) => {
      await page.goto(`/works/${pinnedWork.slug}`);
      return { target: 트리파일(page, "메타.json"), order: ["경로 복사"], mark: "data-spec-file", selected: "overview.md" };
    },
  },
  {
    name: "Archive 패널의 spec 트리 파일 행",
    setUp: async (page) => {
      await page.goto(`/archive/${shipped.slug}`);
      return { target: 트리파일(page, "spec/tickets/할일.md"), order: ["경로 복사"], mark: "data-spec-file", selected: RECORD };
    },
  },
];

for (const { name, setUp } of 대상들) {
  test(`${name}을 우클릭하면 그 대상의 메뉴가 커서 자리에 서고, 고름 · 주소는 그대로이며 대상 테두리는 연 동안만 선다`, async ({ page }) => {
    await installFixtureBackend(page);
    const { target, order, mark, selected } = await setUp(page);
    const url = page.url();
    const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
    await expect(target).toBeVisible();
    // 전제: 닫혀 있으면 대상에 테두리가 없다 — 처음부터 있으면 「연 동안 선다」가 아무것도 안 잰다.
    expect(await 테두리(target)).toBeNull();

    const menu = await 우클릭한다(page, target);
    await expect.poll(() => 줄차례(menu)).toEqual(order);
    const spot = (await target.boundingBox())!;
    // 커서 자리는 정수 픽셀이다(`MouseEvent`의 `clientX` · `clientY`) — 흰 판의 테두리(0.5) 뒤로 대상이 반 픽셀에 서서 카드는 그 아래
    // 정수에 선다(`shell-tab-menu.spec.ts`와 같은 잣대).
    expect(await 카드자리(menu)).toEqual([Math.floor(spot.x + 6), Math.floor(spot.y + 6)]);
    // 고름 · 주소는 그대로다(결정 7) — 우클릭은 그 대상으로 가지 않는다.
    expect(page.url()).toBe(url);
    expect(await 고른행(page, mark)).toEqual([selected]);
    await expect.poll(() => 테두리(target)).toBe(링);

    // 바깥을 누르면 닫히고 테두리가 걷힌다.
    const viewport = page.viewportSize()!;
    await page.mouse.click(viewport.width - 8, viewport.height - 8);
    await expect(menu).toHaveCount(0);
    await expect.poll(() => 테두리(target)).toBeNull();
    expect(page.url()).toBe(url);

    // Esc로 닫으면 포커스가 그 대상으로 돌아온다.
    await 우클릭한다(page, target);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(target).toBeFocused();
    expect(page.url()).toBe(url);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  for (const key of ["Shift+F10", "ContextMenu"]) {
    test(`${name}에 포커스를 두고 ${key}를 누르면 같은 메뉴가 그 대상 곁에 서고 ↓가 첫 항목에 간다`, async ({ page }) => {
      await installFixtureBackend(page);
      const { target, order } = await setUp(page);
      const url = page.url();
      const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
      await target.focus();
      await expect(target).toBeFocused();

      await page.keyboard.press(key);
      const menu = 메뉴(page);
      await expect(menu).toBeVisible();
      await expect.poll(() => 줄차례(menu)).toEqual(order);
      // 커서가 없으니 대상의 왼쪽 아래에 선다.
      const spot = (await target.boundingBox())!;
      // 키로 연 메뉴도 대상의 왼쪽 아래를 정수 픽셀로 받는다(`openMenuByKey`가 쏘는 `MouseEvent`의 자리) — 흰 판의 테두리(0.5) 뒤로
      // 대상이 반 픽셀에 서서 카드는 그 아래 정수에 선다(`shell-tab-menu.spec.ts`와 같은 잣대).
      expect(await 카드자리(menu)).toEqual([Math.floor(spot.x), Math.floor(spot.y + spot.height)]);
      await expect.poll(() => 테두리(target)).toBe(링);

      // 카드 자신이 포커스를 쥐고, 그 뒤의 ↓가 첫 항목이다 — ⋯를 눌러 연 것과 같다.
      await expect(menu).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(항목(page, order[0])).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(target).toBeFocused();
      expect(page.url()).toBe(url);
      expect(await unknownIpcCalls(page)).toEqual([]);
    });
  }
}

// ── ⌃클릭은 우클릭이다 (결정 7) ──
// macOS에서 ⌃클릭은 우클릭이라 같은 메뉴를 연다 — 그 손이 그 행을 골라 버리면 「메뉴는 고름을 안 바꾼다」가 깨진다. 누르면 그 대상을
// 고르는 행(프로젝트 · Archive 목록 행 · spec 트리 파일 행)은 그 클릭에서 ⌃를 거른다 — work 행 · 띠 줄과 같은 거름이고, 재는 길도 그
// 검사(`work-context-menu.spec.ts`)와 같다: ⌃가 실린 `click` 사건을 내고, 주소를 바꾸는 부름을 적어(`주소적기`) ⌃클릭 뒤에 꽂은 표보다
// 먼저 적힌 것이 없음을 잰다. 머리 줄 이름은 누르면 고르는 자리가 아니라 뺀다. 키보드 Enter의 고름은 `keyboard.spec.ts`가 잰다.

for (const { name, setUp } of 대상들.filter((one) => one.name !== "프로젝트 머리 줄 이름")) {
  test(`${name}을 ⌃클릭하면 고름 · 주소가 그대로다 — ⌃ 없는 클릭은 그 행을 고른다`, async ({ page }) => {
    await installFixtureBackend(page);
    const { target, mark, selected } = await setUp(page);
    // 앵커: 화면이 섰고 고른 행이 섰다 — 적기 전에 주소가 멎었다(뒤늦은 정규화가 표 앞에 적히지 않게).
    await expect(target).toBeVisible();
    await expect.poll(() => 고른행(page, mark)).toEqual([selected]);
    const own = await target.evaluate((el, mark) => el.closest(`[${mark}]`)?.getAttribute(mark) ?? null, mark);
    await 주소적기(page);

    await target.dispatchEvent("click", { ctrlKey: true });
    await 표를꽂는다(page);
    await target.dispatchEvent("click");
    // 앵커: ⌃ 없는 클릭은 그 행을 골랐고, 적기가 그 부름을 봤다.
    await expect.poll(() => 고른행(page, mark)).toEqual([own]);
    const 주소들 = await 적힌주소(page);
    expect(주소들.length).toBeGreaterThan(1);
    expect(주소들[0], `⌃클릭이 ${selected}에서 옮겼다`).toBe("표");
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

// ── 프로젝트 메뉴가 부르는 것 ──
// 메뉴는 대상의 프로젝트에 건다 — 목록 행은 고르지 않은 프로젝트(원장)이고, 머리 줄 이름은 고른 프로젝트(빌링)다. Finder 열기는 코어
// 명령을 slug로 부르고(경로는 코어가 푼다), 경로 복사는 그 프로젝트 폴더의 참조(끝이 `/`)를 클립보드에 쓴다.

const 프로젝트대상들 = [
  {
    name: "프로젝트 목록 행",
    project: ledger,
    target: (page: Page) =>
      버튼(page.getByRole("region", { name: "프로젝트 목록", exact: true, includeHidden: true }), `${ledger.name} ${ledger.path}`),
    input: (page: Page) => page.getByRole("region", { name: "프로젝트 목록", exact: true }).getByRole("textbox", { name: "프로젝트 이름" }),
  },
  {
    name: "프로젝트 머리 줄 이름",
    project: billing,
    target: (page: Page) => 화면머리(page).getByText(billing.name, { exact: true }),
    input: (page: Page) => 화면머리(page).getByRole("textbox", { name: "프로젝트 이름" }),
  },
];

for (const { name, project, target, input } of 프로젝트대상들) {
  test(`${name}의 메뉴에서 「Finder에서 열기」는 그 프로젝트로 폴더를 열고 「경로 복사」는 그 폴더의 참조를 쓴다`, async ({ page }) => {
    await installFixtureBackend(page);
    await recordClipboard(page);
    await page.goto(`/projects/${billing.slug}`);

    await 우클릭한다(page, target(page));
    await 항목(page, "Finder에서 열기").click();
    await expect(메뉴(page)).toHaveCount(0);
    await expect
      .poll(async () => (await ipcCallArgs(page, "open_project_folder", "slug")).map(({ args }) => args))
      .toEqual([{ slug: project.slug }]);

    await 우클릭한다(page, target(page));
    await 항목(page, "경로 복사").click();
    await expect.poll(() => clipboardWrites(page)).toEqual([`${project.path}/`]);
    // 복사는 토스트가 말한다 — Projects 화면에도 토스트 자리가 선다.
    await expect(page.getByRole("region", { name: "메시지", exact: true })).toHaveText(`${project.path}/ 복사됨`);
    await expect(page).toHaveURL(`/projects/${billing.slug}`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${name}의 메뉴에서 「이름 바꾸기」는 그 자리를 입력칸으로 바꾸고, Enter면 그 프로젝트의 이름을 고친다`, async ({ page }) => {
    await installFixtureBackend(page);
    await page.goto(`/projects/${billing.slug}`);

    await 우클릭한다(page, target(page));
    await 항목(page, "이름 바꾸기").click();
    const field = input(page);
    // 메뉴가 닫히며 포커스를 대상으로 돌리지 않는다 — 막 선 입력칸이 포커스를 쥔다.
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(project.name);
    await field.fill("메뉴로 바꾼 이름");
    await field.press("Enter");
    await expect(field).toHaveCount(0);
    await expect
      .poll(async () => (await ipcCallArgs(page, "update_project", "slug")).map(({ args }) => args))
      .toEqual([{ slug: project.slug, name: "메뉴로 바꾼 이름" }]);
    await expect(page).toHaveURL(`/projects/${billing.slug}`);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${name}의 메뉴에서 「제거」는 그 프로젝트로 확인 창을 거친다 — 「취소」면 아무것도 안 나가고 「제거」면 그 프로젝트로 나간다`, async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await page.goto(`/projects/${billing.slug}`);
    const dialog = page.getByRole("alertdialog", { name: `'${project.name}' 제거` });
    const 고른다 = async () => {
      await 우클릭한다(page, target(page));
      await 항목(page, "제거").click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("코드 폴더는 삭제되지 않고 Atelier 목록에서만 제거됩니다.");
    };

    await 고른다();
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    // 앵커: 창이 닫혔다. 그다음에 「안 나갔다」와 고름 · 주소를 잰다.
    await expect(dialog).toHaveCount(0);
    expect(await callCount(page, "delete_project")).toBe(0);
    await expect(page).toHaveURL(`/projects/${billing.slug}`);

    await 고른다();
    await dialog.getByRole("button", { name: "제거", exact: true }).click();
    await expect
      .poll(async () => (await ipcCallArgs(page, "delete_project", "slug")).map(({ args }) => args))
      .toEqual([{ slug: project.slug }]);
    await expect(dialog).toHaveCount(0);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

test("고르지 않은 프로젝트를 목록 행의 메뉴로 제거하면 보던 프로젝트는 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${billing.slug}`);
  await 우클릭한다(page, 프로젝트대상들[0].target(page));
  await 항목(page, "제거").click();
  const dialog = page.getByRole("alertdialog", { name: `'${ledger.name}' 제거` });
  await dialog.getByRole("button", { name: "제거", exact: true }).click();
  await expect.poll(() => callCount(page, "delete_project")).toBe(1);
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(`/projects/${billing.slug}`);
  await expect(화면머리(page).getByText(billing.name, { exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("폴더를 못 찾은 프로젝트의 메뉴에서는 「Finder에서 열기」가 흐리고, 나머지는 선다", async ({ page }) => {
  await installFixtureBackend(page, {
    list_projects: PROJECTS.map((one) => (one.slug === ledger.slug ? { ...one, missing: true } : one)),
  });
  await page.goto(`/projects/${billing.slug}`);
  // 못 찾은 행은 이름 뒤에 「누락」 꼬리표가 서서 행 이름이 달라진다 — 표식으로 집는다.
  await 우클릭한다(page, page.locator(`[data-project-row="${ledger.slug}"]`));
  await expect.poll(() => 줄차례(메뉴(page))).toEqual(프로젝트메뉴차례);
  await expect(항목(page, "Finder에서 열기")).toBeDisabled();
  for (const one of ["경로 복사", "이름 바꾸기", "제거"]) await expect(항목(page, one)).toBeEnabled();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── Archive 목록 행이 부르는 것 ──
// 머리 줄 ⋯과 같은 정의라 같은 명령 · 같은 참조다 — 다만 그 행의 아카이브로 나간다.

test("Archive 목록 행의 메뉴는 그 행의 아카이브로 Finder 열기 · 경로 복사를 부르고, 고른 아카이브는 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/archive/${shipped.slug}`);
  const row = page.locator(`[data-archive-row="${bare.slug}"]`);

  await 우클릭한다(page, row);
  await 항목(page, "Finder에서 열기").click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "open_archived_spec_folder", "slug")).map(({ args }) => args.slug))
    .toEqual([bare.slug]);

  await 우클릭한다(page, row);
  await 항목(page, "경로 복사").click();
  await expect.poll(() => clipboardWrites(page)).toEqual([`~/.atelier/archive/${bare.slug}/spec/`]);
  await expect(page).toHaveURL(`/archive/${shipped.slug}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── spec 트리 파일 행이 부르는 것 ──
// 작업 패널의 복사는 `keyboard.spec.ts`(⇧F10)가 잰다. Archive 패널은 그 아카이브 안의 참조를 쓴다 — 보던 문서 · 주소는 그대로다.

test("Archive 패널의 spec 트리 파일 행 메뉴에서 「경로 복사」는 그 아카이브 안 파일의 참조를 쓰고, 보던 문서는 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/archive/${shipped.slug}`);
  const url = page.url();

  await 우클릭한다(page, 트리파일(page, "spec/tickets/할일.md"));
  await 항목(page, "경로 복사").click();
  await expect(메뉴(page)).toHaveCount(0);
  await expect.poll(() => clipboardWrites(page)).toEqual([`~/.atelier/archive/${shipped.slug}/spec/tickets/할일.md`]);
  expect(page.url()).toBe(url);
  expect(await 고른행(page, "data-spec-file")).toEqual([RECORD]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 문서 글 (스토리 75) ──
// 고른 글자가 있으면 복사, 없으면 원문으로 보기 · 경로 복사. 원문으로 보기는 경로 줄의 보기 묶음과 같은 상태를 바꾸고(이미 원문이면
// 「문서로 보기」다), 보기를 못 바꾸는 파일(그림)에서는 서지 않는다. 경로 복사는 경로 줄의 동그란 복사와 같은 참조다.

/** 문서 글의 상자 — 경로 줄 아래 구르는 문서 몸이다. */
const 문서글 = (page: Page) => page.locator("[data-doc-text]");

/** 문서 글 안에서 그 글자를 고른다 — 고름의 시작 · 끝은 같은 글자 마디다. */
const 글자를고른다 = (page: Page, text: string) =>
  page.evaluate((text) => {
    const box = document.querySelector("[data-doc-text]");
    if (!box) throw new Error("문서 글이 없다");
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(text) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`문서 글에 「${text}」가 없다`);
  }, text);
const 고른글자 = (page: Page) => page.evaluate(() => getSelection()?.toString() ?? "");

/** 그 글자의 가운데 — 고른 글자 안을 우클릭하는 자리다. */
async function 글자가운데(page: Page, text: string) {
  const box = (await 문서글(page).getByText(text, { exact: true }).boundingBox())!;
  return { x: box.x + Math.min(box.width / 2, 12), y: box.y + box.height / 2 };
}

const 문서자리들 = [
  {
    name: "Works 문서",
    open: (page: Page) => page.goto(`/works/${pinnedWork.slug}`),
    line: "한 줄.",
    heading: "개요",
    path: `~/.atelier/works/${pinnedWork.slug}/spec/overview.md`,
  },
  {
    name: "Archive 문서",
    open: (page: Page) => page.goto(`/archive/${shipped.slug}`),
    line: "한 줄.",
    heading: "기록 — 치운 일",
    path: `~/.atelier/archive/${shipped.slug}/${RECORD}`,
  },
];

for (const { name, open, line, heading, path } of 문서자리들) {
  test(`${name}에서 글자를 고르고 우클릭하면 「복사」 하나가 서고, 고른 글자를 쓴 뒤 고름이 그대로다`, async ({ page }) => {
    await installFixtureBackend(page);
    await recordClipboard(page);
    await open(page);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    const url = page.url();
    const 링 = `1px solid ${await 토큰색(page, "--accent")}`;
    expect(await 테두리(문서글(page))).toBeNull();

    await 글자를고른다(page, line);
    const at = await 글자가운데(page, line);
    await page.mouse.click(at.x, at.y, { button: "right" });
    const menu = 메뉴(page);
    await expect(menu).toBeVisible();
    await expect.poll(() => 줄차례(menu)).toEqual(["복사⌘C"]);
    // 커서 자리는 정수 픽셀이다(`MouseEvent`의 `clientX` · `clientY`) — 흰 판의 테두리(0.5) 뒤로 대상이 반 픽셀에 서서 카드는 그 아래
    // 정수에 선다(`shell-tab-menu.spec.ts`와 같은 잣대).
    expect(await 카드자리(menu)).toEqual([Math.floor(at.x), Math.floor(at.y)]);
    await expect.poll(() => 테두리(문서글(page))).toBe(링);
    expect(await 고른글자(page)).toBe(line);

    await 항목(page, "복사").click();
    await expect(menu).toHaveCount(0);
    await expect.poll(() => clipboardWrites(page)).toEqual([line]);
    // 토스트는 고른 글을 되풀이하지 않는다 — 긴 고름이면 글 전체가 토스트에 선다.
    await expect(page.getByRole("region", { name: "메시지", exact: true })).toHaveText("고른 글자 복사됨");
    expect(await 고른글자(page)).toBe(line);
    await expect.poll(() => 테두리(문서글(page))).toBeNull();
    expect(page.url()).toBe(url);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${name}에서 고른 것 없이 글자를 우클릭하면 원문으로 보기 · 경로 복사가 서고, 낱말이 골라지지 않는다`, async ({ page }) => {
    await installFixtureBackend(page);
    await recordClipboard(page);
    await open(page);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    const url = page.url();
    const 원문보기 = 버튼(page, "원문 보기");
    await expect(원문보기).toHaveAttribute("aria-pressed", "false");

    // 글자 위의 우클릭 — macOS WebKit은 여기서 낱말을 고르지만, 메뉴는 누른 순간의 고름(없음)으로 서고 그 낱말 고름을 걷는다.
    const at = await 글자가운데(page, line);
    await page.mouse.click(at.x, at.y, { button: "right" });
    const menu = 메뉴(page);
    await expect(menu).toBeVisible();
    await expect.poll(() => 줄차례(menu)).toEqual(["원문으로 보기", "경로 복사"]);
    expect(await 고른글자(page)).toBe("");

    // 원문으로 보기 — 경로 줄의 보기 묶음과 같은 상태다. 원문이면 같은 자리가 「문서로 보기」다.
    await 항목(page, "원문으로 보기").click();
    await expect(menu).toHaveCount(0);
    await expect(원문보기).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: heading })).toHaveCount(0);
    await 우클릭한다(page, 문서글(page));
    await expect.poll(() => 줄차례(menu)).toEqual(["문서로 보기", "경로 복사"]);
    await 항목(page, "문서로 보기").click();
    await expect(원문보기).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();

    // 경로 복사 — 경로 줄의 동그란 복사와 같은 참조다.
    await 우클릭한다(page, 문서글(page));
    await 항목(page, "경로 복사").click();
    await expect.poll(() => clipboardWrites(page)).toEqual([path]);
    await expect(page.getByRole("region", { name: "메시지", exact: true })).toHaveText(`${path} 복사됨`);
    expect(page.url()).toBe(url);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });

  test(`${name}에 포커스를 두고 ⇧F10 · 메뉴 키를 누르면 문서 글의 메뉴가 서고, 고른 글자가 있으면 그 끝 아래에 복사가 선다`, async ({
    page,
  }) => {
    await installFixtureBackend(page);
    await open(page);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    const box = 문서글(page);
    const menu = 메뉴(page);
    const 링 = `1px solid ${await 토큰색(page, "--accent")}`;

    for (const key of ["Shift+F10", "ContextMenu"]) {
      // 앞 판의 고름을 걷고 시작한다.
      await page.evaluate(() => getSelection()?.removeAllRanges());

      // 고른 것 없음 — 상자의 왼쪽 위에 선다(상자가 카드 높이라 왼쪽 아래면 카드 밖이다).
      await box.focus();
      await page.keyboard.press(key);
      await expect(menu).toBeVisible();
      await expect.poll(() => 줄차례(menu)).toEqual(["원문으로 보기", "경로 복사"]);
      const spot = (await box.boundingBox())!;
      // 키로 연 메뉴도 대상의 왼쪽 아래를 정수 픽셀로 받는다(`openMenuByKey`가 쏘는 `MouseEvent`의 자리) — 흰 판의 테두리(0.5) 뒤로
      // 대상이 반 픽셀에 서서 카드는 그 아래 정수에 선다(`shell-tab-menu.spec.ts`와 같은 잣대).
      expect(await 카드자리(menu)).toEqual([Math.floor(spot.x), Math.floor(spot.y)]);
      await expect.poll(() => 테두리(box)).toBe(링);
      await expect(menu).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(항목(page, "원문으로 보기")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(box).toBeFocused();

      // 고른 글자가 있으면 — 그 고름의 끝 줄 왼쪽 아래다. 메뉴를 여는 우클릭 사건의 자리는 온 픽셀이라(WebKit이 소수를 버린다) 줄의
      // 끝이 픽셀 사이에 걸치면 그 아래 자리에 선다.
      await 글자를고른다(page, line);
      await page.keyboard.press(key);
      await expect(menu).toBeVisible();
      await expect.poll(() => 줄차례(menu)).toEqual(["복사⌘C"]);
      const end = await page.evaluate(() => {
        const rects = getSelection()!.getRangeAt(0).getClientRects();
        const last = rects[rects.length - 1];
        return [Math.floor(last.left), Math.floor(last.bottom)];
      });
      expect(await 카드자리(menu)).toEqual(end);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      expect(await 고른글자(page)).toBe(line);
    }
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

test("보기를 못 바꾸는 문서(그림)의 문서 글 메뉴에는 경로 복사만 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  const image = pinnedWork.specFiles.find((file) => file.endsWith(".png"))!;
  await page.goto(`/works/${pinnedWork.slug}?file=${encodeURIComponent(image)}`);
  await expect(버튼(page, "원문 보기")).toBeDisabled();

  await 우클릭한다(page, 문서글(page));
  await expect.poll(() => 줄차례(메뉴(page))).toEqual(["경로 복사"]);
  await 항목(page, "경로 복사").click();
  await expect.poll(() => clipboardWrites(page)).toEqual([`~/.atelier/works/${pinnedWork.slug}/spec/${image}`]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("spec이 없는 work의 빈 자리를 우클릭하면 아무 메뉴도 서지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  const empty = WORKS.find((work) => work.specFiles.length === 0)!;
  await page.goto(`/works/${empty.slug}`);
  const notice = page.getByText("아직 spec이 없어요", { exact: true });
  await expect(notice).toBeVisible();
  await expect(문서글(page)).toHaveCount(0);
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { 막힘: boolean[] }).막힘 = seen;
    window.addEventListener("contextmenu", (event) => setTimeout(() => seen.push(event.defaultPrevented)), true);
  });
  await notice.click({ button: "right" });
  await expect.poll(() => page.evaluate(() => (window as unknown as { 막힘: boolean[] }).막힘)).toEqual([true]);
  await expect(메뉴(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
