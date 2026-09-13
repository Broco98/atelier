import { expect, test, type Page } from "./evidence";
import { ROOMS, ROOMS_MOVED, WORKS, WORKS_MOVED } from "./fixtures";
import {
  awaitSpawned,
  dragRowOnto,
  hoverRowPoint,
  installFixtureBackend,
  ipcCallArgs,
  markAttention,
  markRunning,
  pickUpRow,
  pointIn,
  shownWorkOrder,
  unknownIpcCalls,
  workRow,
  레인,
} from "./harness";

// 사이드바 작업 행을 끌어 **순서·고정**을 바꾼다(UI개선 티켓 05 · 스펙 §4·§5). 틈의 경계 규칙은
// `row-drop.test.ts`의 표가, 캐시 경쟁은 `hooks.test.ts`가 잰다 — 여기서 보는 것은 **진짜 포인터와
// 레이아웃에서만 서는 것**이다: 선이 뜨는가, 5px 안쪽이 클릭으로 남는가, 놓은 자리가 명령 인자로
// 나가는가, 놓은 행이 안 열리는가, 응답이 화면을 갈아 끼우는가.
//
// fixture 백엔드에는 상태가 없다 — `move_work`는 인자와 무관하게 **뒤집은 목록** 한 벌로 답한다
// (`WORKS_MOVED`). 그래서 인자 기대는 IPC 기록으로, 화면 순서는 그 상수로 잰다. 순서 규칙 자체는
// L1(코어 `move_work`)의 몫이다.

const [pinnedWork, plainWork, multiWork] = WORKS;

const headOf = (page: Page, section: "pinned" | "works") => page.locator(`[data-drop-head="${section}"]`);
const line = (page: Page) => page.locator("[data-drop-line]");

const moves = (page: Page) => ipcCallArgs(page, "move_work", "slug").then((calls) => calls.map((one) => one.args));

/** 코어가 돌려준 목록이 화면에 서는 순서 — 구획이 먼저 갈린다(`splitWorkSections`). */
const sectioned = (list: typeof WORKS) => [
  ...list.filter((work) => work.pinned).map((work) => work.slug),
  ...list.filter((work) => !work.pinned).map((work) => work.slug),
];

/** 목록 화면(`/projects`)이 첫 프로젝트로 정규화된 주소. 「아무 데도 안 갔다」의 기준이다. */
const HOME = /\/projects\/[^/]+$/;

async function openList(page: Page) {
  await installFixtureBackend(page);
  await page.goto("/projects");
  await expect(page).toHaveURL(HOME);
  // 행 수는 픽스처에서 파생한다 — `WORKS` 끝에 줄이 더해져도 여기를 손으로 안 고친다.
  await expect(page.locator("[data-work-row]")).toHaveCount(WORKS.length);
}

/**
 * 그 작업으로 **안 갔다.** 행의 클릭은 곧바로 주소를 바꾸지만 그 반영이 한 틱 뒤라, 곧장 재면
 * 「가는 중」도 초록이다 — 한 박자 쉰 뒤에 본다. 가는 쪽이 실제로 가는지는 「5px 안쪽」 검사가 붙든다.
 */
async function stayedHome(page: Page) {
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(HOME);
}

test("끄는 동안 틈 선이 서고, 놓으면 move_work가 나가고 그 작업으로 가지 않는다", async ({ page }) => {
  await openList(page);
  await expect(line(page)).toHaveCount(0);

  await pickUpRow(page, multiWork.slug);
  // 제자리(자기 앞)에서는 선이 없다 — 놓아도 아무것도 안 바뀌는 자리다.
  await expect(line(page)).toHaveCount(0);
  await hoverRowPoint(page, workRow(page, plainWork.slug), "upper");
  await expect(line(page)).toBeVisible();

  // 선은 **틈에** 선다 — 앞 머리의 아랫변과 그 행의 윗변 사이. 행을 밀지 않는다.
  const lineBox = (await line(page).boundingBox())!;
  const rowBox = (await workRow(page, plainWork.slug).boundingBox())!;
  const headBox = (await headOf(page, "works").boundingBox())!;
  expect(lineBox.y + lineBox.height / 2).toBeGreaterThanOrEqual(headBox.y + headBox.height - 1);
  expect(lineBox.y + lineBox.height / 2).toBeLessThanOrEqual(rowBox.y + 1);

  await page.mouse.up();
  await expect.poll(() => moves(page)).toEqual([
    { mode: "atelier", slug: multiWork.slug, pinned: false, before: plainWork.slug },
  ]);
  // 끌어 놓은 행은 **안 열린다** — 놓는 순간의 클릭을 제스처가 삼킨다.
  await stayedHome(page);
  await expect(line(page)).toHaveCount(0);
  await expect(workRow(page, multiWork.slug)).toHaveCSS("opacity", "1");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("5px 안쪽의 눌림은 그대로 클릭이다 — 그 작업으로 간다", async ({ page }) => {
  await openList(page);
  const from = await pointIn(workRow(page, plainWork.slug), "middle");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 3, from.y);
  await expect(line(page)).toHaveCount(0);
  await page.mouse.up();

  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
  expect(await moves(page)).toEqual([]);
});

test.describe("놓은 구획이 고정 여부를 정한다", () => {
  test("같은 구획 안에서 끌면 고정 여부가 그대로다", async ({ page }) => {
    await openList(page);
    await dragRowOnto(page, plainWork.slug, workRow(page, multiWork.slug), "lower");
    await expect.poll(() => moves(page)).toEqual([
      { mode: "atelier", slug: plainWork.slug, pinned: false, before: null },
    ]);
  });

  test("고정 아닌 행을 `고정` 행 사이에 놓으면 `pinned: true`", async ({ page }) => {
    await openList(page);
    await dragRowOnto(page, plainWork.slug, workRow(page, pinnedWork.slug), "upper");
    await expect.poll(() => moves(page)).toEqual([
      { mode: "atelier", slug: plainWork.slug, pinned: true, before: pinnedWork.slug },
    ]);
  });

  test("`고정` 행을 고정 아닌 행 사이에 놓으면 `pinned: false`", async ({ page }) => {
    await openList(page);
    await dragRowOnto(page, pinnedWork.slug, workRow(page, plainWork.slug), "lower");
    await expect.poll(() => moves(page)).toEqual([
      { mode: "atelier", slug: pinnedWork.slug, pinned: false, before: multiWork.slug },
    ]);
  });
});

test.describe("구획 머리 위에 놓으면 그 구획 맨 위", () => {
  test("펼친 머리", async ({ page }) => {
    await openList(page);
    await dragRowOnto(page, multiWork.slug, headOf(page, "works"), "middle");
    await expect.poll(() => moves(page)).toEqual([
      { mode: "atelier", slug: multiWork.slug, pinned: false, before: plainWork.slug },
    ]);
  });

  test("접힌 머리 — 행이 안 보여도 그 구획의 첫 slug 앞이다", async ({ page }) => {
    await openList(page);
    await headOf(page, "pinned").click();
    await expect(headOf(page, "pinned")).toHaveAttribute("aria-expanded", "false");

    await dragRowOnto(page, plainWork.slug, headOf(page, "pinned"), "middle");
    await expect.poll(() => moves(page)).toEqual([
      { mode: "atelier", slug: plainWork.slug, pinned: true, before: pinnedWork.slug },
    ]);
  });
});

test.describe("아무 일도 없는 끝", () => {
  test("목록 밖에 놓으면 명령이 안 나가고 아무 데도 안 간다", async ({ page }) => {
    await openList(page);
    await pickUpRow(page, plainWork.slug);
    await hoverRowPoint(page, workRow(page, pinnedWork.slug), "upper");
    await expect(line(page)).toBeVisible();

    // 본문 한가운데로 나간다 — 선이 걷혀야 「여기 놓인다」가 거짓말을 안 한다.
    await page.mouse.move(700, 400, { steps: 6 });
    await expect(line(page)).toHaveCount(0);
    await page.mouse.up();

    await expect(workRow(page, plainWork.slug)).toHaveCSS("opacity", "1");
    expect(await moves(page)).toEqual([]);
    await stayedHome(page);
  });

  // **`pointercancel`은 놓음이 아니다**(`DragHandlers.drop`의 계약) — 시스템이 제스처를 가로챈 것이라
  // 사람이 고른 자리가 없다. 탭 끌기는 받는 쪽 손잡이가 없어(`drag-gesture.spec.ts`) 이 계약이 거기서는
  // 안 보인다: 틈이 선 채 가로채이는 이 자리에서만 「놓음을 부르면 명령이 나간다」로 드러난다.
  // Playwright 마우스로는 못 만들어 창에 직접 쏜다 — 리스너가 창에 걸려 실물과 같은 자리에 닿는다.
  test("pointercancel이면 틈이 서 있어도 명령이 안 나가고 표시가 걷힌다", async ({ page }) => {
    await openList(page);
    await pickUpRow(page, plainWork.slug);
    const at = await pointIn(workRow(page, pinnedWork.slug), "upper");
    await page.mouse.move(at.x, at.y, { steps: 6 });
    await expect(line(page)).toBeVisible();

    // **틈 위의 좌표를 싣는다.** 좌표 없이(0,0) 쏘면 목록 밖이라, 취소를 놓음으로 읽는 변형도 명령을
    // 안 내 이 검사가 빈 초록이 된다.
    await page.evaluate(
      ({ x, y }) => window.dispatchEvent(new PointerEvent("pointercancel", { clientX: x, clientY: y })),
      at,
    );
    // `end`가 돌았다 — 선과 흐려짐이 걷힌다.
    await expect(line(page)).toHaveCount(0);
    await expect(workRow(page, plainWork.slug)).toHaveCSS("opacity", "1");
    await page.mouse.up();

    expect(await moves(page)).toEqual([]);
    await stayedHome(page);
  });

  test("Esc면 명령이 안 나가고, 떼도 그 행이 안 열린다", async ({ page }) => {
    await openList(page);
    await pickUpRow(page, plainWork.slug);
    await hoverRowPoint(page, workRow(page, pinnedWork.slug), "upper");
    await expect(line(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(line(page)).toHaveCount(0);
    await expect(workRow(page, plainWork.slug)).toHaveCSS("opacity", "1");
    // 출발한 행 위로 돌아와 뗀다 — 취소한 끌기가 「그 행을 눌렀다」로 읽히면 안 된다.
    await hoverRowPoint(page, workRow(page, plainWork.slug), "middle");
    await page.mouse.up();

    expect(await moves(page)).toEqual([]);
    await stayedHome(page);
  });
});

test("끄는 동안 호버 카드가 안 뜨고, 떠 있던 카드는 문턱을 넘는 순간 닫힌다", async ({ page }) => {
  await openList(page);
  const card = page.locator("[data-popover]");
  await workRow(page, plainWork.slug).hover();
  // 먼저 뜬 것을 본다 — 이것이 없으면 아래 「없다」가 원래 안 떴던 것으로도 초록이다.
  await expect(card).toBeVisible();

  await pickUpRow(page, plainWork.slug);
  await expect(card).toHaveCount(0);

  // 다른 행 위에 카드가 뜰 만큼(350ms) 머문다.
  await hoverRowPoint(page, workRow(page, multiWork.slug), "middle");
  await page.waitForTimeout(700);
  await expect(card).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.up();
});

// 셸 신호가 뜬 행은 레인이 점·링을 그린다(#203). 그 행도 같은 손짓이다 — 레인 위를 눌러도 끌린다.
test("셸 신호 레인이 선 행도 끌어 놓으면 move_work가 나간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await markRunning(page, "claude");
  await markAttention(page, { agent: "claude", event: "Stop", at: Date.now(), payload: {} });
  await expect(레인(page, plainWork.slug).locator('[data-signal="waiting"]')).toHaveCount(1);

  await pickUpRow(page, plainWork.slug);
  // work 화면 위에서 끌어도 **분할 겹판이 안 선다** — 작업 행 끌기는 본문이 안 받는다. 끄는
  // **동안** 센다: 놓은 뒤에는 원천이 비어 겹판이 어차피 없다.
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);
  await hoverRowPoint(page, workRow(page, pinnedWork.slug), "upper");
  await expect(line(page)).toBeVisible();
  await page.mouse.up();

  await expect.poll(() => moves(page)).toEqual([
    { mode: "atelier", slug: plainWork.slug, pinned: true, before: pinnedWork.slug },
  ]);
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
});

test("Maison Room도 같은 손짓이고 `mode: \"maison\"`이 실린다", async ({ page }) => {
  const [firstRoom, secondRoom] = ROOMS;
  await installFixtureBackend(page);
  await page.goto(`/maison/rooms/${firstRoom.slug}`);
  await expect(page.locator("[data-work-row]")).toHaveCount(ROOMS.length);

  await dragRowOnto(page, secondRoom.slug, workRow(page, firstRoom.slug), "upper");
  await expect.poll(() => moves(page)).toEqual([
    { mode: "maison", slug: secondRoom.slug, pinned: false, before: firstRoom.slug },
  ]);
  await expect.poll(() => shownWorkOrder(page)).toEqual(sectioned(ROOMS_MOVED));
  await expect(page).toHaveURL(new RegExp(`/maison/rooms/${firstRoom.slug}`));
});

// **낙관적 목록과 응답이 갈리는 끌기**를 고른다 — `고정` 행을 `작업` 끝으로. 낙관적으로는 그 행이
// `작업` 맨 아래에 고정이 풀린 채 서지만, fixture 응답(뒤집은 목록)은 그 행이 여전히 고정이고
// 나머지 순서가 뒤집혔다. 둘이 같은 끌기를 고르면 「응답으로 갈아 끼웠다」를 화면이 말하지 못한다.
test("move_work의 응답으로 화면이 그 순서로 선다", async ({ page }) => {
  await openList(page);
  expect(await shownWorkOrder(page)).toEqual(sectioned(WORKS));
  expect(sectioned(WORKS_MOVED)).not.toEqual(sectioned(WORKS));

  await dragRowOnto(page, pinnedWork.slug, workRow(page, multiWork.slug), "lower");
  await expect.poll(() => moves(page)).toEqual([
    { mode: "atelier", slug: pinnedWork.slug, pinned: false, before: null },
  ]);
  await expect.poll(() => shownWorkOrder(page)).toEqual(sectioned(WORKS_MOVED));
  expect(await unknownIpcCalls(page)).toEqual([]);
});
