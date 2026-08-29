import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 판 05 — 분할. **이 층에서만 보이는 것 셋이다**: 포인터 제스처(정적 마크업 seam에는
// 이벤트가 없다), 끄는 동안 그려지는 겹판, 그리고 열 폭이 실제로 PTY 격자까지 내려가는 것.
//
// 마크업 seam(WorksPage.test.tsx)이 이미 보는 것은 여기서 다시 보지 않는다 — 열 머리가
// 몇 개 서는가, 좌우가 어느 쪽인가는 그쪽이 든다.

const [, plainWork] = WORKS;

/**
 * 셸 탭의 **이름 버튼** — 끄는 자리다. 형제인 `×`는 안 끌린다(닫으려다 분할이 켜지면 안 된다).
 *
 * 켜짐을 말하는 쪽이 이름 버튼이라 그 속성으로 집는다 — 한때 사이드바 셸 행이 `data-shell-row`로
 * 하던 일이고, 모양(클래스·자식 순서)으로 집지 않는 이유도 그쪽과 같다.
 */
async function shellTab(page: Page) {
  const tab = page.locator('[data-tab="shell"] button[aria-pressed]');
  await expect(tab).toBeVisible();
  const box = await tab.boundingBox();
  if (!box) throw new Error("셸 탭의 상자를 못 읽었다");
  return box;
}

/** 맨 앞 문서 칸. 고정 탭이라 `×`가 없어 칸 자체가 버튼이다(결정 7). */
async function specTab(page: Page) {
  const tab = page.locator('[data-tab="spec"]');
  await expect(tab).toBeVisible();
  const box = await tab.boundingBox();
  if (!box) throw new Error("문서 탭의 상자를 못 읽었다");
  return box;
}

const middle = (box: { x: number; y: number; width: number; height: number }) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/**
 * 행을 눌러 **드래그를 시작시킨다.** 겹판이 설 때까지가 여기까지이고, 어디에 놓을지는
 * 부르는 쪽이 정한다.
 *
 * 임계값을 넘기는 이동과 목적지로 가는 이동을 **나눈다.** 겹판이 서는 것은 임계값을 넘은
 * 그 이동에서인데, 그때 포인터 아래에는 아직 겹판이 없어 절반이 「내 위다」를 말하는 것은
 * 다음 이동부터다. 실물에서는 구멍이 아니다 — 임계값은 출발점에서 5px이라 사이드바 위에서
 * 넘고, 본문까지 오는 동안 이동이 수십 번 더 온다.
 */
async function startDrag(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const from = middle(box);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y);
  await expect(page.locator("[data-drop-half]")).toHaveCount(2);
  return from;
}

/** 그 절반 한가운데로 민다. **좌표를 손으로 적지 않는다** — 겹판이 자기 상자를 말한다. */
async function moveOnto(page: Page, half: "left" | "right") {
  const box = await page.locator(`[data-drop-half="${half}"]`).boundingBox();
  if (!box) throw new Error(`${half} 절반의 상자를 못 읽었다`);
  const at = middle(box);
  await page.mouse.move(at.x, at.y);
  await expect(page.locator(`[data-drop-half="${half}"]`)).toHaveAttribute("data-over", "");
}

const resizeCalls = async (page: Page) =>
  ((await readIpcRecord(page))?.calls ?? []).filter((call) => call.startsWith("pty_resize")).length;

test("왼쪽 절반에 떨구면 좌우가 맞바뀐다", async ({ page }) => {
  await installFixtureBackend(page);
  // 이미 문서가 오른쪽인 분할에서 출발한다 — 같은 종류를 반대쪽에 떨구는 것이
  // 결정 87이 말하는 「맞바뀜」이다.
  await page.goto(`/works/${plainWork.slug}?split=rl`);
  await expect(page.locator("[data-column]").first()).toHaveAttribute("data-column", "terminal");

  await startDrag(page, await specTab(page));
  await moveOnto(page, "left");
  await page.mouse.up();

  await expect(page).toHaveURL(/split=lr/);
  await expect(page.locator("[data-column]").first()).toHaveAttribute("data-column", "spec");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 결정 12(판 03): 분할을 **탭**에서 만든다 ───
//
// 사이드바 행이 하던 몸짓의 출발점이 머리행의 탭 줄로 옮겨 왔다(adr-03이 그 행을 걷었다).
// **놓일 자리도 분할 계산도 그대로다** — 바뀐 것은 끌 수 있는 것뿐이다. 한때 같은 것을
// 사이드바 잎·행에서 재던 검사 둘이 이 아래 둘과 겹쳐, 판 04가 그 행을 걷으면서 지웠다.
//
// 이 층이 아니면 아무것도 안 보인다: 배선은 핸들러라 마크업 seam에 없고, 5px 문턱과
// 겹판은 포인터가 있어야 선다.

// 수용 기준 「탭을 본문 오른쪽으로 끌면 분할이 켜지고 그 탭이 오른쪽 열에 선다」.
// **분할이 아닌 화면에서 출발한다** — 켜지는 것까지가 이 기준이다. 셸 칸이 서려면 그
// 화면에 셸이 있어야 해서 `tab=terminal`로 들어간다(진입 이펙트가 「없으면 하나 띄운다」).
test("셸 탭을 오른쪽 절반에 떨구면 터미널이 오른쪽 열이 된다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator("[data-column]")).toHaveCount(0);

  await startDrag(page, await shellTab(page));
  await moveOnto(page, "right");
  await page.mouse.up();

  // 떨군 것이 그 절반에 선다 — 터미널이 오른쪽이면 spec이 왼쪽으로 밀린다(결정 87).
  await expect(page).toHaveURL(/split=lr/);
  await expect(page.locator("[data-column]").first()).toHaveAttribute("data-column", "spec");
  await expect(page.locator("[data-column]").last()).toHaveAttribute("data-column", "terminal");
  // 떨군 뒤 `tab`이 가리키는 쪽 — 나중에 `×`로 분할을 닫으면 이 값이 남는다(결정 97).
  // **이 한 줄만으로는 `tabOfDrag`를 못 가른다**: 터미널 열이 서면 xterm이 포커스를
  // 가져가고 그 자체가 `tab`을 terminal로 민다(아래 「문서 탭」 검사의 머리말이 실측을 든다).
  await expect(page).toHaveURL(/tab=terminal/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 수용 기준 「탭을 왼쪽으로 끌면 반대로 선다」. **같은 탭을 반대쪽으로** 끈다 — 한쪽만
// 재면 좌우를 상수로 적어 둔 것과 구분이 안 된다.
test("셸 탭을 왼쪽 절반에 떨구면 터미널이 왼쪽 열이 된다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  await startDrag(page, await shellTab(page));
  await moveOnto(page, "left");
  await page.mouse.up();

  await expect(page).toHaveURL(/split=rl/);
  await expect(page.locator("[data-column]").first()).toHaveAttribute("data-column", "terminal");
  await expect(page.locator("[data-column]").last()).toHaveAttribute("data-column", "spec");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **이미 분할인 화면**에서 반대쪽으로 떨군다 — 위 둘은 분할을 켜는 몸짓이라, 「이미 열
// 둘인 화면에서 자리를 바꾼다」는 여기서만 선다. 한때 사이드바 셸 행으로 같은 것을 재던
// 검사이고, 판 04가 그 행을 걷으면서 출발점만 칸으로 옮겼다.
test("이미 분할인 화면에서 셸 탭을 반대쪽에 떨구면 `tab`도 셸을 가리킨다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?split=lr`);
  await expect(page.locator("[data-column]").first()).toHaveAttribute("data-column", "spec");

  await startDrag(page, await shellTab(page));
  await moveOnto(page, "left");
  await page.mouse.up();

  await expect(page).toHaveURL(/split=rl/);
  await expect(page.locator("[data-column]").first()).toHaveAttribute("data-column", "terminal");
  // **`tab`도 함께 본다.** 열 배치는 `dropSplit`이 정하므로 「끈 것이 셸이었다」가 `tab`에
  // 안 적혀도 화면은 똑같다 — 그 어긋남은 나중에 `×`로 분할을 닫는 순간(결정 97: `tab`이
  // 가리키는 쪽이 남는다) 「셸을 떨궜는데 문서가 남는」 사고로 터진다.
  await expect(page).toHaveURL(/tab=terminal/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 맨 앞 **문서 칸**도 끌린다 — 사이드바의 `spec` 잎이 하던 몫이 이 칸으로 왔다.
// 출발이 **꺼진 칸**이라는 것도 함께 선다(이 화면은 터미널을 보는 중이다): 끄는 것은
// 켜진 칸의 특권이 아니다.
//
// **`tab`은 여기서 재지 않는다.** 떨군 직후 터미널 열이 서면서 xterm이 포커스를 가져가고,
// 결정 97이 「포커스가 들어간 열이 곧 `tab`」이라 값이 곧바로 terminal로 간다 —
// 사이드바의 `spec` 잎을 떨구는 위 검사가 `tab`을 안 보는 것도 같은 이유다(실측:
// `tab` 없이 들어가 문서를 떨궈도 주소가 `split=rl&tab=terminal`로 끝난다).
test("문서 탭을 오른쪽 절반에 떨구면 문서가 오른쪽 열이 된다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  // **겹판이 서고 사라지는 것을 여기서 함께 든다** — 한때 사이드바 `spec` 잎으로 같은 것을
  // 재던 검사가 있었고, 판 04가 그 잎을 걷으면서 이 자리로 왔다.
  const from = middle(await specTab(page));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();

  // **5px 안쪽은 아직 드래그가 아니다**(결정 86). 겹판이 서지 않는 것이 그 관찰 가능한
  // 형태다 — 안 두면 그냥 클릭이 드래그로 읽혀 칸을 못 누른다.
  await page.mouse.move(from.x + 3, from.y);
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);

  // 넘기면 겹판이 서고, 포인터가 있는 절반**만** 밝아진다.
  await page.mouse.move(from.x + 12, from.y);
  await expect(page.locator("[data-drop-half]")).toHaveCount(2);
  await moveOnto(page, "right");
  await expect(page.locator('[data-drop-half="left"]')).not.toHaveAttribute("data-over", "");

  await page.mouse.up();
  await expect(page).toHaveURL(/split=rl/);
  // 떨구면 겹판이 걷힌다.
  await expect(page.locator("[data-drop-half]")).toHaveCount(0);
  await expect(page.locator("[data-column]").last()).toHaveAttribute("data-column", "spec");
  await expect(page.locator("[data-column]").first()).toHaveAttribute("data-column", "terminal");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 88의 「사람이 다시 열면 그 뜻을 존중한다 — 억지로 닫지 않는다」. 접는 판정이
// 「`split`이 null이 아니다」로 넓어지면 이미 분할인 화면에서 좌우를 맞바꾸기만 해도
// 사람이 열어 둔 패널이 닫힌다. **소스 문자열이 아니라 동작으로 본다.**
test("이미 분할인 화면에서 좌우를 바꿔도 열어 둔 패널이 닫히지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?split=lr`);

  // 분할로 들어오면 패널이 접혀 있다(결정 88) — 헤더에 여는 버튼이 서 있는 것이 그 모습이다.
  const opener = page.getByRole("button", { name: "작업 패널 펼치기" });
  await expect(opener).toBeVisible();
  await opener.click();
  await expect(opener).toHaveCount(0);

  // 좌우를 맞바꾼다 — 분할을 **켜는** 것이 아니다.
  await startDrag(page, await specTab(page));
  await moveOnto(page, "right");
  await page.mouse.up();
  await expect(page).toHaveURL(/split=rl/);

  await expect(opener).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 수용 기준 「5px 안쪽의 움직임은 클릭으로 읽힌다 — 그 칸이 그대로 눌린다」.
// 겹판이 안 서는 것(아래 「문서 탭」 검사)은 절반이고, **칸이 실제로 눌리는 것**이 나머지다.
test("5px 안쪽이면 칸이 그대로 눌린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const from = middle(await specTab(page));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 3, from.y);
  await page.mouse.up();

  // 문서 칸을 누르면 본문이 문서로 돌아온다 — 주소에서 `tab`이 빠지는 것이 그 모습이다.
  await expect(page).not.toHaveURL(/tab=terminal/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 반대쪽 — **끈 것이 눌린 것으로도 읽히면 안 된다.** 임계값을 넘긴 뒤 출발한 칸 위로
// 되돌아와 놓으면 pointerdown/up이 같은 버튼이라 브라우저가 `click`을 낸다.
test("끌었다 제자리에 놓으면 칸이 안 눌린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const from = await startDrag(page, await specTab(page));
  // 본문까지 갔다가 다시 칸 위로. 머리행은 겹판이 안 덮으므로 칸이 그대로 포인터를 받는다.
  await moveOnto(page, "right");
  await page.mouse.move(from.x, from.y);
  await page.mouse.up();

  // 놓은 자리가 본문이 아니므로 분할도 안 켜지고, 클릭도 안 나가 본문이 그대로 터미널이다.
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(page).not.toHaveURL(/split=/);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 수용 기준 「분할 상태에서 터미널 열이 실제로 리사이즈된다 (PTY `cols`/`rows`가 따라간다)」.
// 배선은 열 폭 → ResizeObserver → `fit()` → `term.onResize` → `pty_resize`인데, **이 사슬을
// 태우는 층이 여기뿐이다** — 마크업 seam에는 관찰자도 이벤트도 없다.
test("경계를 끌면 터미널 격자가 따라간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?split=lr`);
  // 셸이 떴다 — 격자를 내려보낼 상대가 있다는 뜻이다.
  await expect(page.locator('[data-tab="shell"]')).toBeVisible();
  const before = await resizeCalls(page);

  // 폭 핸들은 왼쪽 열의 **오른쪽 가장자리**에 얹힌 5px 띠다. 열 머리가 그 열의 폭을 그대로
  // 쓰므로 오른쪽 끝을 머리행에서 읽는다 — 좌표를 손으로 적지 않는다.
  const head = await page.locator('[data-column="spec"]').boundingBox();
  if (!head) throw new Error("문서 열 머리의 상자를 못 읽었다");
  const edge = head.x + head.width - 2;
  const y = head.y + head.height + 120;

  await page.mouse.move(edge, y);
  await page.mouse.down();
  await page.mouse.move(edge - 160, y);
  await page.mouse.up();

  // 열이 실제로 좁아졌는가 — 이것이 안 서면 아래 격자 검사는 「끌지도 못했다」를 초록으로
  // 읽는다(핸들을 못 잡은 것과 격자가 안 따라간 것이 구분되지 않는다).
  await expect
    .poll(async () => (await page.locator('[data-column="spec"]').boundingBox())?.width ?? 0)
    .toBeLessThan(head.width - 100);

  await expect.poll(() => resizeCalls(page)).toBeGreaterThan(before);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 97. 루트에 검증기가 없어 **아무 문자열이 컴포넌트까지 온다** — 눕히는 자리가
// 없으면 `?split=zzz`가 열 둘을 세운다. 순수 함수 seam(`splitOf`)이 그 판정을 들지만,
// 그 함수가 실제로 이 길 위에 놓여 있는지는 여기서만 드러난다.
test("모르는 split 값은 단일 뷰로 눕는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?split=zzz`);
  await expect(page.locator('[data-tab="spec"]')).toBeVisible();
  await expect(page.locator("[data-column]")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 수용 기준 「열의 `×`로 한쪽을 닫으면 남는 쪽이 전체가 된다」(결정 89). 남는 쪽이 곧
// `tab`이라(결정 97) 주소에도 그대로 드러난다 — 같은 쪽을 남기면 닫은 열이 그대로 선다.
test("열의 ×로 닫으면 반대쪽이 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?split=lr`);

  await page.getByRole("button", { name: "spec 열 닫기" }).click();
  await expect(page.locator("[data-column]")).toHaveCount(0);
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(page).not.toHaveURL(/split=/);

  // 반대 방향도 본다 — 한쪽만 맞으면 `otherTab`이 아니라 상수를 적어 둔 것과 구분이 안 된다.
  await page.goto(`/works/${plainWork.slug}?split=lr&tab=terminal`);
  await page.getByRole("button", { name: "terminal 열 닫기" }).click();
  await expect(page.locator("[data-column]")).toHaveCount(0);
  await expect(page).not.toHaveURL(/tab=terminal/);
  await expect(page).not.toHaveURL(/split=/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **자동 크기는 반반이다.** 두 열이 같은 본문을 나눠 갖는 것이 이 뷰의 전부라, 기본값이
// 「반」이지 「480px」이 아니다. px로 들면 창 크기마다 반이 아닌 자리에서 시작하고
// (실측: 창 1512에서 480은 본문의 38%였다) 창을 늘리면 오른쪽 열만 자란다.
test("두 열이 반반으로 서고, 창이 넓어져도 반반이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?split=lr`);

  const widths = async () => {
    const left = await page.locator('[data-column="spec"]').boundingBox();
    const right = await page.locator('[data-column="terminal"]').boundingBox();
    return [left!.width, right!.width];
  };

  const [a, b] = await widths();
  expect(Math.abs(a - b)).toBeLessThanOrEqual(2);

  // 창을 넓힌다 — px로 들면 여기서 한쪽만 자란다.
  await page.setViewportSize({ width: 1600, height: 900 });
  const [wideA, wideB] = await widths();
  expect(wideA).toBeGreaterThan(a);
  expect(Math.abs(wideA - wideB)).toBeLessThanOrEqual(2);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **분할 중에 문서를 골라도 분할이 남는다.**
//
// 주소에 `file`을 적는 자리가 이 판보다 오래됐고, 그때는 주소에 `file` 하나뿐이라
// 객체를 통째로 주는 것이 맞았다. 판 04가 `tab`을, 판 05가 `split`을 얹으면서 **그 자리만
// 안 따라왔다** — 객체를 주면 TanStack Router가 search를 통째로 갈아치운다(결정 15).
//
// 이 층에서만 보인다: 문서를 고르는 것은 주소를 바꾸는 일이라 마크업 seam에는 없다.
test("분할 중에 문서를 골라도 분할이 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  const [pinnedWork] = WORKS;
  await page.goto(`/works/${pinnedWork.slug}?split=lr`);

  // 분할로 들어오면 패널이 접혀 있다(결정 88). 트리를 보려면 사람이 다시 연다.
  await page.getByRole("button", { name: "작업 패널 펼치기" }).click();
  await page.getByRole("button", { name: pinnedWork.specFiles[0], exact: true }).click();

  await expect(page).toHaveURL(/file=/);
  // **분할이 남는다.** 여기가 무너지면 열이 하나로 접히면서 터미널이 통째로 사라진다.
  await expect(page).toHaveURL(/split=lr/);
  await expect(page.locator("[data-column]")).toHaveCount(2);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **놓을 수 없는 자리로 나가면 밝기가 꺼진다.** 놓기를 받는 것은 겹판 자신의 `pointerup`
// 이라, 사이드바로 되돌아가 손을 떼면 아무 일도 안 난다 — 그때까지 반쪽이 밝아 있으면
// 화면이 「여기 놓인다」고 말해 놓고 아무것도 안 한다.
test("겹판 밖으로 나가면 밝기가 꺼지고, 거기서 놓아도 분할이 안 켜진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  const from = await startDrag(page, await specTab(page));
  await moveOnto(page, "right");

  // 출발한 탭 줄로 되돌아간다 — 겹판이 안 덮는 자리다.
  await page.mouse.move(from.x, from.y);
  await expect(page.locator("[data-drop-half][data-over]")).toHaveCount(0);

  await page.mouse.up();
  await expect(page).not.toHaveURL(/split=/);
  await expect(page.locator("[data-column]")).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
