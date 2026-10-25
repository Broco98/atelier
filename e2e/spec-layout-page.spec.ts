import { expect, test, type Page } from "./evidence";
import { BROKEN_LAYOUT_STATE, BUILTIN_LAYOUT_STATE, SPEC_LAYOUT_STATE } from "./fixtures";
import {
  callCount,
  clipboardWrites,
  installFixtureBackend,
  ipcCalls,
  ipcFailure,
  recordClipboard,
  SPEC_LAYOUT_EDITOR,
  unknownIpcCalls,
  끌어놓는다,
  다떴다,
  화면머리,
  줄차례,
  테두리,
  토큰색,
} from "./harness";

// 설정의 「spec 레이아웃」 페이지(spec 레이아웃 티켓 08 · 결정 20·23·25).
//
// 행의 모양(내장본 · 고침 · 읽지 못함)은 마크업 seam이 잰다(`SpecLayoutPage.test.tsx`). **이 층이 드는
// 것은 그 페이지가 화면의 문에 붙어 있는가**다 — 설정 nav의 넷째 줄로 들어가면 상태 명령이 실제로
// 나가고, [부탁]이 참조를 복사하고 화면 아래 메시지를 세우고, [다시 읽기]가 상태를 다시 부른다. 이 명령을 태우는 시나리오가 여기
// 있어야 fixture 이름 표에서 빠졌을 때 빨개진다(구현 스펙 3절).

const aside = (page: Page) => page.locator("aside");
// 위치는 머리 줄이 말한다(codex-ds 스펙 §7 — 「Settings」 · 항목 이름). 이 쪽에는 저장이 없어 머리 줄에 할 일이 없다. 글자로
// 읽으면 이름과 위치가 바로 잇닿는다(아래 정규식의 `\s*`).
const 행 = (page: Page) => page.locator("main li").filter({ has: page.getByText("Atelier", { exact: true }) });
const 부탁 = (page: Page) =>
  page.getByRole("button", { name: "Atelier 레이아웃을 에이전트에게 부탁", exact: true });
const 다시읽기 = (page: Page) => page.getByRole("button", { name: "Atelier 레이아웃 다시 읽기", exact: true });
// 화면 아래 메시지 — 스펙이 「복사 알림」이라 부른 것이다. 앱의 「알림」은 셸이 나를 부르는 사건의 말이라 코드와
// 검사는 「메시지」라 부른다(`CONTEXT.md` 「알림 띠」).
const 메시지 = (page: Page) => page.getByRole("status").filter({ hasText: "참조를 복사했어요" });

test("설정 nav에서 「spec 레이아웃」을 열면 상태 명령이 나가고 Atelier 한 행이 서며, [편집]이 고정 주소의 편집기로 간다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/terminal");
  await expect(page.getByRole("group", { name: "터미널 설정", exact: true })).toBeVisible();
  expect(await callCount(page, "spec_layout_state")).toBe(0);

  // 넷째 줄은 **맨 뒤**다 — `/settings`는 여전히 첫 항목(터미널)으로 넘긴다.
  const 항목 = aside(page).getByRole("button", { name: "spec 레이아웃", exact: true });
  await 항목.click();
  await expect(page).toHaveURL("/settings/spec-layout");
  await expect(화면머리(page)).toHaveText(/^Settings\s*spec 레이아웃$/);
  await expect(항목.locator("xpath=..")).toHaveClass(/selected-row/);
  await expect.poll(() => callCount(page, "spec_layout_state")).toBeGreaterThan(0);

  // **레이아웃은 하나다**(ui-refresh 결정 23) — 상태 명령은 인자 없이 나가 한 벌을 답하고, 행은 그 하나다.
  expect(new Set(await ipcCalls(page, "spec_layout_state"))).toEqual(new Set(["spec_layout_state"]));
  await expect(page.locator("main li")).toHaveCount(1);
  await expect(행(page)).toContainText(`${SPEC_LAYOUT_STATE.folder}/`);
  await expect(행(page)).toContainText(`템플릿 ${SPEC_LAYOUT_STATE.templateCount}개`);
  // 읽을 수 있는 행에는 [다시 읽기]가 없다
  await expect(다시읽기(page)).toHaveCount(0);
  // 설정 초안의 저장 버튼을 지나지 않는다. (게이트 밖인지는 아래 시나리오가 잰다 — 이 fixture의
  // `read_settings`는 성공하므로 여기서는 게이트 안이어도 행이 선다.)
  await expect(page.getByRole("button", { name: "저장", exact: true })).toHaveCount(0);

  // 편집기는 id 없는 고정 주소다(ui-refresh 결정 23)
  await page.getByRole("button", { name: "Atelier 레이아웃 편집", exact: true }).click();
  await expect(page).toHaveURL(SPEC_LAYOUT_EDITOR);
  await expect(page.getByRole("treeitem", { name: "overview.md", exact: true })).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **설정 파일 읽기 게이트 밖이다**(티켓 08) — 레이아웃은 `settings.json`에 살지 않으니, 우리 파일이 깨져
// 있다고 레이아웃을 못 볼 이유가 없다. 첫 시나리오에 이 거절을 싣지 않는 것은 그쪽이 먼저 여는 터미널
// 설정이 `read_settings`의 성공을 딛기 때문이다.
test("설정 파일을 읽지 못해도 「spec 레이아웃」의 행이 선다 — 설정 파일 읽기 게이트 밖이다", async ({ page }) => {
  await installFixtureBackend(page, { read_settings: ipcFailure("설정 파일을 읽지 못했어요") });
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(1);
  // 게이트였다면 행 대신 그 까닭과 「다시 읽기」가 섰다
  await expect(page.getByText("설정 파일을 읽지 못했어요")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다시 읽기", exact: true })).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 참조는 상태가 준 폴더 경로로 짓는다. 클립보드에 간 것은 하네스가 적어 둔 쓰기로 재고(`recordClipboard`), 메시지는
// 그 참조와 다음에 할 일을 적는다.
test("[부탁]을 누르면 레이아웃 참조가 클립보드로 가고, 화면 아래 메시지에 적힌다", async ({ page }) => {
  // 폴더가 아직 없는 레이아웃이다 — 붙여 받은 에이전트의 도구가 내장본을 돌려준다.
  await installFixtureBackend(page, { spec_layout_state: BUILTIN_LAYOUT_STATE });
  await recordClipboard(page);
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(1);
  await expect(메시지(page)).toHaveCount(0);
  // 내장본 행에는 되돌릴 것이 없다
  await expect(메뉴(page)).toHaveCount(0);

  // 도움말(툴팁)은 복사할 참조다 — 이름보다 더 말하는 것이라 설명으로도 남는다(S28).
  await expect(부탁(page)).toHaveAccessibleDescription("~/.atelier/layouts/atelier/ 참조를 복사해요");

  await 부탁(page).click();
  await expect(메시지(page)).toBeVisible();
  // 클립보드에 든 것은 참조 한 줄뿐이다 — 부탁은 사람이 앱 터미널에서 이어 적는다(결정 23).
  expect(await clipboardWrites(page)).toEqual(["~/.atelier/layouts/atelier/"]);
  await expect(메시지(page)).toContainText("~/.atelier/layouts/atelier/");
  await expect(메시지(page)).toContainText("앱 터미널의 에이전트에게 붙이고 부탁을 이어 적으세요.");

  // 한 번에 하나다 — 다시 누르면 뒤의 것이 앞의 것을 갈아 낀다.
  await 부탁(page).click();
  await expect(메시지(page)).toHaveCount(1);
  expect(await clipboardWrites(page)).toEqual(["~/.atelier/layouts/atelier/", "~/.atelier/layouts/atelier/"]);

  await 메시지(page).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(메시지(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("읽지 못한 행은 이유를 보이고, [다시 읽기]가 상태 명령을 다시 부른다", async ({ page }) => {
  await installFixtureBackend(page, { spec_layout_state: BROKEN_LAYOUT_STATE });
  await page.goto("/settings/spec-layout");

  await expect(행(page)).toContainText("읽지 못해 내장본으로 보여 주고 있어요");
  await expect(행(page)).toContainText(BROKEN_LAYOUT_STATE.fallback!);
  // 읽지 못하는 행에도 [부탁]이 있다 — 에이전트가 원문과 오류를 읽고 고친다.
  await expect(부탁(page)).toBeVisible();

  await expect.poll(() => callCount(page, "spec_layout_state")).toBeGreaterThan(0);
  const before = await callCount(page, "spec_layout_state");
  await 다시읽기(page).click();
  await expect.poll(() => callCount(page, "spec_layout_state")).toBeGreaterThan(before);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// [다시 읽기]는 감시가 놓친 경우를 메우는 버튼이다(구현 스펙 5절) — 감시와 같은 문을 타야 한다. 레이아웃이 바뀌면
// spec 트리도 바뀌므로 그 문은 spec 트리를 싣고 오는 work 목록까지 지운다(3절). 상태 행만 다시 부르면 손으로 고친
// 레이아웃이 행에서는 「고침」인데 `spec` 패널의 트리는 옛 모양인 채 남는다.
test("[다시 읽기]는 감시가 놓친 변경을 대신 알린다 — spec 트리를 싣고 오는 work 목록도 다시 부른다", async ({ page }) => {
  await installFixtureBackend(page, { spec_layout_state: BROKEN_LAYOUT_STATE });
  await page.goto("/settings/spec-layout");
  await expect(행(page)).toContainText("읽지 못해 내장본으로 보여 주고 있어요");

  // 사이드바가 설정 안에서도 work 목록을 쥐고 있다 — 지우면 곧바로 다시 부른다
  await expect.poll(() => callCount(page, "list_works")).toBeGreaterThan(0);
  const before = await callCount(page, "list_works");
  await 다시읽기(page).click();
  await expect.poll(() => callCount(page, "list_works")).toBeGreaterThan(before);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **기본값으로 되돌리기**(spec 레이아웃 티켓 10 · 결정 7·21). 되돌리기는 레이아웃 폴더를 지운다 —
// 그래서 **확인을 거친 뒤에만** `revert_spec_layout`이 나간다. 창의 글(지울 폴더, 사라지는 것의 수)은
// 스토어에 선 물음으로 L2가 잰다(`revert.test.tsx` — 창은 포털로 서서 정적 렌더에 안 그려진다). 이 층이 드는
// 것은 ⋯ → 메뉴 → 창 → 명령의 길이 화면에 붙어 있는가와, 창이 닫힌 뒤 포커스가 돌아오는 자리다. 이 명령을
// 태우는 시나리오가 여기 있어야 fixture 이름 표에서 빠졌을 때 빨개진다(구현 스펙 3절). ⋯가 여닫힘을 말하는가
// (`aria-expanded` 닫힘 → 열림 → 닫힘)도 여기서 잰다 — 메뉴 부품이 마운트 뒤에 달아 L2의 정적 렌더에는 없다.

const 메뉴 = (page: Page) => page.getByRole("button", { name: "Atelier 레이아웃 메뉴", exact: true });
const 되돌리기항목 = (page: Page) =>
  page.getByRole("menuitem", { name: "기본값으로 되돌리기", exact: true });
const 확인창 = (page: Page) =>
  page.getByRole("alertdialog", { name: "Atelier 레이아웃을 기본값으로 되돌릴까요?", exact: true });
const 되돌린메시지 = (page: Page) => page.getByRole("status").filter({ hasText: "되돌렸어요" });

test("⋯ → 「기본값으로 되돌리기」에서 [취소]를 고르면 되돌리기 명령이 나가지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(1);

  await expect(메뉴(page)).toHaveAttribute("aria-haspopup", "menu");
  await expect(메뉴(page)).toHaveAttribute("aria-expanded", "false");
  await 메뉴(page).click();
  await expect(되돌리기항목(page)).toBeVisible();
  await expect(메뉴(page)).toHaveAttribute("aria-expanded", "true");
  await 되돌리기항목(page).click();
  const dialog = 확인창(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${SPEC_LAYOUT_STATE.folder}/ 폴더를 지워요.`);
  await expect(dialog).toContainText(`템플릿 ${SPEC_LAYOUT_STATE.templateCount}개`);
  // 창이 떠 있는 동안에도 아직 아무것도 지우지 않았다
  expect(await callCount(page, "revert_spec_layout")).toBe(0);

  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await callCount(page, "revert_spec_layout")).toBe(0);
  // 창을 연 항목은 메뉴와 함께 사라졌다 — 포커스는 그 앞 자리(⋯)로 돌아온다. `<body>`로 떨어지면 키보드 사용자가
  // 행을 처음부터 다시 찾아야 한다.
  await expect(메뉴(page)).toBeFocused();
  // 창이 떠 있는 동안에는 재지 않는다 — 창 밖이 모두 `aria-hidden`이라 역할로 ⋯를 못 찾는다(alert-dialog.tsx).
  await expect(메뉴(page)).toHaveAttribute("aria-expanded", "false");
  await expect(되돌린메시지(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("[되돌리기]를 고르면 되돌리기가 인자 없이 한 번 나가고, 상태를 다시 부르고, 메시지가 선다", async ({
  page,
}) => {
  await installFixtureBackend(page, { spec_layout_state: BROKEN_LAYOUT_STATE });
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(1);
  await expect.poll(() => callCount(page, "spec_layout_state")).toBeGreaterThan(0);
  const before = await callCount(page, "spec_layout_state");

  // 읽지 못한 행도 가린 폴더가 있으므로 되돌릴 수 있다 — 깨진 폴더도 되돌리기는 늘 된다
  await 메뉴(page).click();
  await 되돌리기항목(page).click();
  const dialog = 확인창(page);
  await expect(dialog).toContainText(`파일 ${BROKEN_LAYOUT_STATE.otherFileCount}개가 함께 사라져요.`);
  expect(await callCount(page, "revert_spec_layout")).toBe(0);

  await dialog.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(되돌린메시지(page)).toBeVisible();
  await expect(되돌린메시지(page)).toContainText(`${BROKEN_LAYOUT_STATE.folder}/`);

  // 레이아웃은 하나라 무엇을 되돌릴지 묻는 인자가 없다(ui-refresh 결정 23)
  expect(await ipcCalls(page, "revert_spec_layout")).toEqual(["revert_spec_layout"]);
  // 감시 이벤트를 기다리지 않는다 — 되돌린 쪽이 스스로 상태를 다시 읽는다
  await expect.poll(() => callCount(page, "spec_layout_state")).toBeGreaterThan(before);

  await 되돌린메시지(page).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(되돌린메시지(page)).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **고친 행을 우클릭해도 ⋯과 같은 메뉴가 선다**(codex-ds 티켓 30 · 스펙 §9 대상 메뉴 표 · 결정 6 · 7 · 11). 메뉴의 대상은 행
// 전체다 — 카드는 커서 자리에 서고, 열린 동안 행에 대상 테두리가 서며, 닫히면 포커스가 그 행의 ⋯로 간다(행 자신은 포커스를 받지
// 않는다). 행 안 버튼에 포커스를 두고 ⇧F10을 누르면 같은 메뉴가 행의 왼쪽 아래에 선다. 내장본 행에는 ⋯이 없듯 우클릭 메뉴도 없다.
// 메뉴가 열린 동안은 부품이 바깥을 보조 기술에서 숨겨, 역할로 집을 때 숨은 것까지 집는다.

const 숨은메뉴버튼 = (page: Page) =>
  page.getByRole("button", { name: "Atelier 레이아웃 메뉴", exact: true, includeHidden: true });

test("고친 행을 우클릭하면 ⋯과 같은 메뉴가 커서 자리에 서고, 「기본값으로 되돌리기」는 같은 확인 창을 거친다 — 취소하면 안 나가고 포커스가 ⋯로 간다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(1);
  const menu = page.getByRole("menu");
  const 링 = `1px solid ${await 토큰색(page, "--accent")}`;

  await 메뉴(page).click();
  const 점점점 = await 줄차례(menu);
  expect(점점점).toEqual(["기본값으로 되돌리기폴더를 지우고 내장본으로 돌아가요"]);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await 테두리(행(page))).toBeNull();

  await 행(page).click({ button: "right", position: { x: 6, y: 6 } });
  await expect(menu).toBeVisible();
  expect(await 줄차례(menu)).toEqual(점점점);
  await 다떴다(menu);
  const spot = (await 행(page).boundingBox())!;
  const card = (await menu.boundingBox())!;
  // 커서 자리는 정수 픽셀이다(`MouseEvent`의 `clientX` · `clientY`) — 행이 반 픽셀에 서면(리눅스 WebKit의 글자 높이) 카드는 그 아래 정수에 선다.
  expect([Math.round(card.x), Math.round(card.y)]).toEqual([Math.floor(spot.x + 6), Math.floor(spot.y + 6)]);
  await expect.poll(() => 테두리(행(page))).toBe(링);
  await expect(page).toHaveURL("/settings/spec-layout");

  await menu.getByRole("menuitem", { name: "기본값으로 되돌리기", exact: true }).click();
  const dialog = 확인창(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${SPEC_LAYOUT_STATE.folder}/ 폴더를 지워요.`);
  expect(await callCount(page, "revert_spec_layout")).toBe(0);
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await callCount(page, "revert_spec_layout")).toBe(0);
  await expect(메뉴(page)).toBeFocused();
  await expect.poll(() => 테두리(행(page))).toBeNull();

  // Esc로 닫아도 포커스는 ⋯로 간다.
  await 행(page).click({ button: "right", position: { x: 6, y: 6 } });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(메뉴(page)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("행 안 버튼에 포커스를 두고 ⇧F10 · 메뉴 키를 누르면 같은 메뉴가 행의 왼쪽 아래에 서고, 고르면 확인 창을 거쳐 되돌린다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(1);
  const menu = page.getByRole("menu");
  const 링 = `1px solid ${await 토큰색(page, "--accent")}`;

  for (const key of ["Shift+F10", "ContextMenu"]) {
    await 메뉴(page).focus();
    await page.keyboard.press(key);
    await expect(menu).toBeVisible();
    await 다떴다(menu);
    const below = (await 행(page).boundingBox())!;
    const card = (await menu.boundingBox())!;
    // 키로 연 자리도 우클릭 사건으로 낸다(`openMenuByKey`) — 그래서 정수 픽셀이다(위 우클릭 검사).
    expect([Math.round(card.x), Math.round(card.y)]).toEqual([Math.floor(below.x), Math.floor(below.y + below.height)]);
    await expect.poll(() => 테두리(행(page))).toBe(링);
    await expect(menu).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "기본값으로 되돌리기", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(메뉴(page)).toBeFocused();
  }

  await 숨은메뉴버튼(page).focus();
  await page.keyboard.press("Shift+F10");
  // 카드가 포커스를 쥔 뒤에 누른다(위 차례와 같다) — 카드가 선 뒤에야 포커스를 옮기는 WebKit이 있다(리눅스). 그 전의 ↓ · Enter는 카드에 닿지 않는다.
  await expect(menu).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const dialog = 확인창(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await ipcCalls(page, "revert_spec_layout")).toEqual(["revert_spec_layout"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 행 메뉴의 뿌리는 행을 감싸지 않는다(`TargetMenu` · 묶음 밖) — 감싸면 행 안의 ⋯이 「우클릭 메뉴의 줄」로 쳐져, 누른 채 끌어 놓는 고름이
// 안 돈다. 이 몸짓이 그 자리를 잠근다(`끌어놓는다` — Works 머리 줄의 ⋯과 같은 잣대).
test("고친 행의 ⋯을 누른 채 끌어 「기본값으로 되돌리기」 위에서 놓으면 그 줄이 돌아 확인 창이 선다 — 행 메뉴가 ⋯을 감싸지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(1);

  await 끌어놓는다(page, 메뉴(page), (menu) => menu.getByRole("menuitem", { name: "기본값으로 되돌리기", exact: true }));
  const dialog = 확인창(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await callCount(page, "revert_spec_layout")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ⋯의 카드는 포털로 `body` 밑에 서지만 React로는 행의 자손이라, 그 안의 우클릭 · 키도 React 트리를 타고 행의 손잡이까지 올라온다.
// 행 DOM 밖에서 난 것이라 행 메뉴는 물러선다(`TargetMenu`) — 그 위에 같은 카드가 하나 더 서면 두 모달 메뉴가 포커스를 다툰다.
test("⋯을 연 채 그 항목을 우클릭하거나 ⇧F10 · 메뉴 키를 눌러도 행 메뉴가 겹쳐 서지 않는다 — 열린 메뉴는 ⋯의 것 하나다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/settings/spec-layout");
  await expect(page.locator("main li")).toHaveCount(1);
  // 카드를 숨은 것까지 센다 — 모달 메뉴가 서면 바깥을 보조 기술에서 숨겨, 역할로만 세면 아래 깔린 카드가 안 잡힌다.
  const menus = page.getByRole("menu", { includeHidden: true });
  // 행 메뉴는 숨은 Trigger에 낸 사건으로 다음 그림에 선다 — 「안 섰다」를 재기 전에 두 그림을 기다린다.
  const 두그림 = () =>
    page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

  await 메뉴(page).click();
  await expect(menus).toHaveCount(1);
  await 되돌리기항목(page).click({ button: "right" });
  await 두그림();
  await expect(menus).toHaveCount(1);
  expect(await 테두리(행(page))).toBeNull();

  // 키는 ⋯ 카드의 항목에서 누른다 — ↓가 그 항목에 포커스를 준다.
  await page.keyboard.press("ArrowDown");
  await expect(되돌리기항목(page)).toBeFocused();
  for (const key of ["Shift+F10", "ContextMenu"]) {
    await page.keyboard.press(key);
    await 두그림();
    await expect(menus).toHaveCount(1);
    expect(await 테두리(행(page))).toBeNull();
    await expect(되돌리기항목(page)).toBeFocused();
  }

  // 그 카드는 여전히 ⋯의 것이다 — Esc면 닫히고 포커스가 ⋯로 간다. 아무것도 되돌리지 않았다.
  await page.keyboard.press("Escape");
  await expect(menus).toHaveCount(0);
  await expect(메뉴(page)).toBeFocused();
  expect(await callCount(page, "revert_spec_layout")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("내장본 행(되돌릴 것이 없다)을 우클릭하면 웹뷰 메뉴가 막히고 아무 메뉴도 서지 않는다", async ({ page }) => {
  await installFixtureBackend(page, { spec_layout_state: BUILTIN_LAYOUT_STATE });
  await page.goto("/settings/spec-layout");
  await expect(행(page)).toContainText("내장본 그대로예요");
  await expect(메뉴(page)).toHaveCount(0);
  await page.evaluate(() => {
    const seen: boolean[] = [];
    (window as unknown as { 막힘: boolean[] }).막힘 = seen;
    window.addEventListener("contextmenu", (event) => setTimeout(() => seen.push(event.defaultPrevented)), true);
  });
  await 행(page).click({ button: "right", position: { x: 6, y: 6 } });
  await expect.poll(() => page.evaluate(() => (window as unknown as { 막힘: boolean[] }).막힘)).toEqual([true]);
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
