import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, markRunning, readIpcRecord, unknownIpcCalls } from "./harness";

// 사이드바 작업 목록은 어느 화면에나 있으므로 목록 화면에서 본다 — Works 화면으로 들어가면
// 그 화면이 부르는 것까지 하네스가 답해야 하는데, 여기서 볼 것은 사이드바뿐이다.
//
// 정적 마크업 seam(SidebarWorkList.test.tsx)이 못 보는 것만 여기서 본다: hover에만 뜨는
// 것(결정 85)은 진짜 CSS가 있어야 하고, 핀을 눌러 나가는 쓰기와 접힘이 다음 실행까지
// 남는 것(결정 108)은 이벤트와 localStorage가 있어야 한다.

const [pinnedWork, plainWork] = WORKS;

// 헤더의 접근성 이름에는 개수가 함께 들어간다 — 라벨과 옅은 숫자가 같은 버튼 안이다.
const PINNED_HEADER = "고정 1";
const MAIN_HEADER = "작업 1";

// 오른쪽 끝 페이드의 폭이자 **마퀴가 넘침 위에 더 가는 거리**다(결정 11) — 그만큼 더 가지
// 않으면 다 흐른 뒤에도 마지막 글자가 페이드에 먹힌다. `index.css`의 `--title-fade`와 같은 수다.
const TITLE_FADE = 24;

// 흐르는 **속도**(px/s) — `SidebarWorkList.tsx`의 `MARQUEE_SPEED`와 같은 수다. 상수인 것은
// 지속시간이 아니라 **이 값**이고(결정 11), 그래서 넘침이 다른 두 자리에서 같은 값이 나와야
// 한다. 실측이 들어야 하는 밴드는 ±12%다 — `speedOf`가 잰 시각으로 나누므로 이만큼 좁힐 수
// 있고, 좁아야 고정 지속시간이 두 자리를 다 통과하지 못한다.
const MARQUEE_SPEED = 50;
const 속도밴드 = [MARQUEE_SPEED * 0.88, MARQUEE_SPEED * 1.12];

/** 제목 상자 — 마스크가 걸리고 넘침을 재는 자리다. 흐르는 것은 그 **안쪽 글자**다. */
const titleBoxOf = (page: Page, title: string) =>
  page.getByRole("button", { name: title, exact: true }).locator("[data-title]");

/** 흐른 거리와 **그것을 읽은 시각**. 속도를 실제 시간으로 재려면 둘이 한 번에 나와야 한다. */
const sampleOf = (box: Locator) =>
  box.locator("span").evaluate((el) => {
    const transform = getComputedStyle(el).transform;
    return {
      shift: transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41,
      at: performance.now(),
    };
  });

/** 흐른 거리. `transform`이 문자열이라 행렬에서 x만 꺼낸다 — 안 흐르면 `none`이라 0이다. */
const shiftOf = async (box: Locator) => (await sampleOf(box)).shift;

/** 흐르는 **속도**(px/s) — 0.4초를 사이에 두고 찍은 두 점의 기울기다.
 *
 * 나누는 것은 재운 시간이 아니라 **잰 시각의 차**다. `waitForTimeout`은 명목값이라 실제로는
 * 늘 그보다 길게 자고, 그 명목값으로 나누면 속도가 실제보다 빠르게 읽혀 밴드를 넓게 열
 * 수밖에 없다. 그런데 「속도가 제목 길이와 무관하게 일정하다」를 재는 방법은 **넘침이 다른 두
 * 자리에서 이 값이 같은 밴드에 드는가**뿐이라, 밴드가 넓으면 고정 지속시간(기각안 「마퀴 —
 * 완전 CSS」)이 그 사이로 빠져나간다: ±40%면 1.5~3.5초짜리 고정 지속시간이 두 자리를 다
 * 통과한다. 트랜지션이 `linear`라(index.css) 기울기가 곧 속도다. */
const speedOf = async (box: Locator) => {
  const 앞 = await sampleOf(box);
  await box.page().waitForTimeout(400);
  const 뒤 = await sampleOf(box);
  return ((앞.shift - 뒤.shift) / (뒤.at - 앞.at)) * 1000;
};

/** 넘친 폭. 0보다 커야 흐를 것이 있다. */
const overflowOf = (box: Locator) => box.evaluate((el) => el.scrollWidth - el.clientWidth);

test("핀은 hover에만 뜨고, 누르면 그 사실이 백엔드로 나간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  const pin = page.getByRole("button", { name: `${plainWork.title} 고정` });
  // 상시 노출하지 않는 것이 결정 85다. opacity로 본다 — 이 버튼은 늘 DOM에 있다.
  await expect(pin).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: plainWork.title, exact: true }).hover();
  await expect(pin).toHaveCSS("opacity", "1");

  await pin.click();
  // 고정은 화면 설정이 아니라 그 작업에 대한 사실이라 백엔드로 나간다(결정 81).
  // 누른 것이 안 고정된 행이므로 나가는 값은 true다.
  expect((await readIpcRecord(page))?.calls).toContain(
    `set_work_pinned {"slug":"${plainWork.slug}","pinned":true}`,
  );
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`고정` 구획을 접으면 다음 실행에도 접혀 있다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  // 행이 화면에서 빠지는 모양(0fr·inert)은 마크업 seam이 본다. 여기서 볼 것은 **다시
  // 띄웠을 때도 접혀 있는가**뿐이다 — 접기는 "설정"이라 영속한다(결정 108).
  const header = page.getByRole("button", { name: PINNED_HEADER, exact: true });
  await expect(header).toHaveAttribute("aria-expanded", "true");

  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 판 04. **행 아래에 아무것도 딸리지 않는다**(결정 6) — 셸을 고르는 자리가 화면 안 탭 줄로
// 되돌아갔으므로(adr-03) 사이드바에 남은 것은 「누르면 간다」뿐이다.
//
// 정적 마크업 seam(SidebarWorkList.test.tsx)이 「그 마크업에 없다」까지는 보지만, **진짜
// 앱에서 그 자리가 비었는가**는 여기서만 드러난다 — 트리를 마운트하던 자리가 사이드바가
// 아니라 화면(Works)이었고, 그 화면을 여는 검사가 이 층에만 있다.
test("고른 work의 행 아래에 아무것도 서지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  // 본문을 터미널로 두고 들어간다 — 셸이 하나 서는 상태가 옛 트리가 가장 무성했던 때다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toBeVisible();

  const aside = page.locator("aside");
  // 잎(`spec`)도, 가지 머리행(`terminal`)도, 셸 행도 없다.
  await expect(aside.locator("[data-leaf]")).toHaveCount(0);
  await expect(aside.locator("[data-branch]")).toHaveCount(0);
  await expect(aside.locator("[data-shell-row]")).toHaveCount(0);
  // 셸을 여는 자리도 사이드바에 없다 — 탭 줄의 `+` 하나다(결정 19).
  await expect(aside.getByRole("button", { name: "셸 열기" })).toHaveCount(0);

  // 접히는 것은 구획 헤더 셋뿐이다. work 행에도 nav `Terminal`에도 여닫이가 없다.
  const expandable = aside.locator("[aria-expanded]");
  await expect(expandable).toHaveCount(await aside.locator("[data-section]").count());

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **행을 누르면 그 work로 가고, 마지막에 보던 자리가 열린다**(결정 5·77 — `recallView`).
// 남의 work 셸을 눌러 그리로 가던 길(결정 101)이 이 하나로 줄었다: 로고가 종류만 말해
// (결정 4) 어느 셸로 갈지가 정해지지 않으므로, 행이 가는 곳은 「그 work의 마지막 자리」다.
//
// 기억이 사는 곳이 sessionStorage라 이 층에서만 왕복이 진짜다.
test("남의 work 행을 누르면 그 work의 마지막 자리가 열린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toBeVisible();

  // 옆 work을 들여다본다 — 그쪽은 본 적이 없어 문서에서 시작한다.
  await page.getByRole("button", { name: pinnedWork.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}`));
  await expect(page).not.toHaveURL(/tab=terminal/);

  // 돌아오면 **터미널을 보던 자리 그대로**다. 이 줄이 없으면 「행을 누르면 간다」까지만
  // 참이고, 터미널을 보다 옆을 잠깐 들여다본 사람이 문서로 떨어지는 것(결정 77이
  // 없애려는 것)이 그대로 지나간다.
  await page.getByRole("button", { name: plainWork.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
  await expect(page).toHaveURL(/tab=terminal/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 확인 창이 **이 앱의 것**이다 — OS 시트가 아니다. 창 하나만 남의 글꼴·남의 모서리로 뜨면
// 그것이 앱 밖의 일처럼 읽힌다. 이 층에서만 보인다: 정적 마크업 seam에는 클릭이 없고,
// 「OS에 안 물었다」는 IPC 기록으로만 드러난다.
//
// **누르는 자리가 사이드바에서 탭 줄로 옮겨 왔다**(결정 7·22·92) — 닫는 길은 여전히 하나라
// 계약은 그대로이고, 이 검사가 그 계약을 보는 저장소의 유일한 자리라 함께 옮겼다.
test("셸을 닫을 때 앱 창이 뜨고, OS 시트는 안 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const tab = page.locator('[data-tab="shell"]');
  await expect(tab).toBeVisible();
  await tab.getByRole("button", { name: /닫기$/ }).click();

  // 앱이 그리는 창이다 — 이 요소가 DOM에 있다는 것 자체가 OS 시트가 아니라는 뜻이다.
  const dialog = page.getByRole("alertdialog", { name: "셸 닫기" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("실행 중인 명령이 있어요");

  // 취소하면 셸이 그대로 남는다 — 「물었고, 아니라고 하면 안 닫는다」(결정 92).
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(tab).toBeVisible();

  // 다시 물어 이번엔 닫는다.
  await tab.getByRole("button", { name: /닫기$/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "닫기" }).click();
  await expect(tab).toHaveCount(0);

  // **마지막 칸이 닫히면 본문이 문서로 돌아온다.** 셸 0개인 터미널 본문은 볼 것이 없는
  // 화면이라(안내 한 판 — 결정 19) 사람을 거기 남겨 두면 다음에 무엇을 할지가 본문 밖에 있다.
  await expect(page).not.toHaveURL(/tab=terminal/);

  // **OS에는 한 번도 안 물었다.** `confirm`도 `message`도 와이어에서는 이 커맨드로 나간다.
  const calls = (await readIpcRecord(page))?.calls ?? [];
  expect(calls.filter((call) => call.startsWith("plugin:dialog"))).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **트리에서 그림을 고르면 본문이 그림으로 선다.** 한때 확장자를 안 보고 글로 읽어,
// PNG를 UTF-8로 읽은 값이 줄번호 `1` 하나만 있는 빈 화면으로 섰다(실물에서 났다).
//
// 이 층에서만 보인다 — 그림을 거는 것은 asset 프로토콜이라 진짜 웹뷰가 있어야 하고,
// 「글로 안 읽는다」는 IPC 기록으로만 드러난다.
test("spec 트리의 그림은 그림으로 선다", async ({ page }) => {
  await installFixtureBackend(page);
  const shot = pinnedWork.specFiles[1];
  await page.goto(`/works/${pinnedWork.slug}?file=${encodeURIComponent(shot)}`);

  const image = page.locator("main img");
  await expect(image).toHaveCount(1);
  // 파일을 못 찾아도(고정 데이터라 실제 파일이 없다) **거는 자리는 맞아야** 한다.
  await expect(image).toHaveAttribute("alt", shot);

  // **읽지 않는다.** 그림을 문자열로 읽으면 쓸 수 없는 값이 오고, 그 호출 자체가 낭비다.
  const calls = (await readIpcRecord(page))?.calls ?? [];
  expect(calls.filter((call) => call.startsWith("read_spec_file"))).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **접히는 것이 보인다.** 조건이 바뀌는 순간 걷어 버리면 아래 행들이 그만큼 순간이동한다 —
// 실물에서 다른 work을 누를 때 목록이 68px 튀는 모습으로 났다(실측). 판 04가 걷은 것은
// 그 사고를 냈던 블럭이고, 같은 상자로 접히는 **구획**은 그대로 남았다.
//
// 이 층에서만 보인다: 정적 마크업에는 시간이 없다.
test("구획을 접으면 한 번에 사라지지 않고 접힌다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  const header = page.getByRole("button", { name: PINNED_HEADER, exact: true });
  // 구획의 속은 헤더의 **다음 형제**다.
  const body = header.locator("xpath=following-sibling::div[1]");
  const height = async () => (await body.boundingBox())?.height ?? 0;

  const before = await height();
  expect(before).toBeGreaterThan(20);

  await header.click();
  await page.waitForTimeout(40);
  const mid = await height();
  await page.waitForTimeout(400);
  const after = await height();

  // 끝내 접힌다.
  expect(after).toBe(0);
  // **가는 중이 있었다.** 한 번에 사라지면 40ms에 이미 0이라 이 줄이 빨개진다.
  expect(mid).toBeGreaterThan(0);
  expect(mid).toBeLessThan(before);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 2·3 — work 행 **오른쪽 끝의 메타가 상태를 말한다**: 무리마다 글리프와 **그 무리의
// 셸 수**.
//
// **이 경로는 어느 층도 통째로 안 지나간다.** `Sidebar.test.tsx`는 값(`runningAgentsOf`)과
// 배선(구독 리터럴)을 따로 못박고 `shell-meta.test.tsx`는 그림을 정적 마크업으로 보는데,
// 셋을 잇는 **한 바퀴** —— 이벤트가 스토어에 앉고 그 행이 다시 그려져 로고가 실제로 서는가 ——
// 는 아무도 안 돈다. 탭 줄 쪽은 `terminal-tabs.spec.ts`가 그 바퀴를 돈다.
//
// **제목 폭도 여기서 잰다**(결정 2·5). 2열이 한 무리분(28px)을 바닥으로 예약하므로 셸이
// 하나인 행은 claude가 켜지고 꺼져도 제목이 안 움직이고, **무리가 둘이 되는 순간에만** 한 번
// 움직인다. 예약이 `auto`로 돌아가면 앞이, 상한이 되면 뒤가 빨개진다.
test("도는 명령의 로고가 work 행 오른쪽 끝에 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  // 들어오면 이 work의 셸 하나가 뜬다(`ensureShell`) — 메타가 서는 조건이 그것이다(결정 3).
  const shells = page.locator(`[data-shells="${plainWork.slug}"]`);
  await expect(shells).toHaveCount(1);
  // **먼저 로고가 없음을 센다.** 이것이 없으면 아래 단언이 「원래 있던 것」으로도 초록이 된다.
  await expect(shells.locator('[role="img"]')).toHaveCount(0);

  const title = page.getByRole("button", { name: plainWork.title, exact: true });
  const 한무리 = (await title.boundingBox())!.width;

  await markRunning(page, "claude");

  // 그 work에서 claude가 돈다는 사실이 사이드바에 선다 —— 화면이 터미널이 아니어도 보이는
  // 자리이고(결정 2), 스크롤로 밀려난 칸에서 도는 것을 알 유일한 자리다.
  await expect(shells.getByRole("img", { name: "claude" })).toHaveCount(1);

  // **그 셸은 이제 한 번만 세어진다**(결정 3). 셸이 하나이고 거기서 claude가 도니 무리는
  // 하나이고, 한때 그 옆에 함께 서던 `⌨1`이 사라졌다 —— 그 두 `1`은 같은 셸이었다.
  await expect(shells).toHaveText("1");

  // **claude를 켜도 제목이 안 움직인다.** `⌨1`과 `✳1`은 둘 다 무리 하나라 같은 폭이고
  // (결정 3이 흔한 경우의 뜀을 원천적으로 없앴다), 예약이 그 폭을 바닥으로 잡고 있다.
  expect((await title.boundingBox())!.width).toBe(한무리);

  // **예약은 바닥이지 상한이 아니다**(결정 5). 셸을 하나 더 열면 무리가 둘(`✳1 ⌨1`)이 되어
  // 28px을 넘어 넓어지고, 그 순간 한 번 제목이 짧아진다. 두 숫자의 합(1+1)이 곧 셸 수다.
  await page.locator('[data-tab="new"]').click();
  await expect(shells.locator("span.tabular-nums")).toHaveText(["1", "1"]);
  expect((await title.boundingBox())!.width).toBeLessThan(한무리);

  // **그래도 행 높이는 32px 그대로다**(결정 0). 셸이 몇 개든 무엇이 돌든 안 바뀐다 — 넓어지는
  // 것은 칸의 폭이지 행의 높이가 아니고, 겹쳐 선 메타는 이름 버튼(h-8)보다 낮다.
  expect((await title.locator("xpath=..").boundingBox())!.height).toBe(32);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 0·5 — **행 오른쪽 끝이 한 줄로 선다.** 이 저장소는 「구획 헤더의 개수와 같은 규격이라,
// 한 컬럼에 세로로 붙어 서는 둘이 다른 무게로 읽히지 않는다」를 `SidebarItem` 주석에 **계약으로**
// 적어 두고 주석으로만 지켜 왔다 — work 행만 그 밖에 있었고(둘째 줄 · 왼쪽 32px 들여쓰기 ·
// 54px), 「같은 컬럼의 규격이 실제로 같은가」를 재는 검사는 이 저장소에 하나도 없었다.
//
// **기준을 구획 헤더로 잡는 것은 계약의 원문이 헤더를 가리키기 때문이다.** 헤더는 늘 떠 있어
// 화면을 옮길 필요도 없다 — nav `Terminal`의 숫자는 최상위 셸이 있어야 뜨고, 그것을 만들려면
// `/terminal` 진입 이펙트를 태워야 한다. nav에서 볼 것은 자리가 아니라 **어휘가 같은가**이고
// 그쪽은 아래 검사가 든다.
test("메타 숫자가 구획 헤더의 개수와 같은 x에 서고, 셸이 있든 없든 행이 32px이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  // 이 화면에 들어와야 셸이 하나 생긴다(`ensureShell`) — `/projects`에는 셸이 없어 메타가
  // 아예 안 선다. 사이드바는 어느 화면에나 같은 것이므로 보는 자리는 그대로다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const rowOf = (title: string) =>
    page.getByRole("button", { name: title, exact: true }).locator("xpath=..");
  const shells = page.locator(`[data-shells="${plainWork.slug}"]`);
  await expect(shells).toHaveCount(1);
  // 셸이 0개인 행에는 그 자리에 아무것도 안 선다 — 「없음」은 숫자로 말하지 않는다.
  await expect(page.locator(`[data-shells="${pinnedWork.slug}"]`)).toHaveCount(0);

  // **모든 work 행이 32px이다**(결정 0). 셸이 하나라도 있으면 둘째 줄이 서서 54px이 되던
  // 것을 걷은 자리다 — 행 높이는 이제 신호가 아니다.
  expect((await rowOf(plainWork.title).boundingBox())!.height).toBe(32);
  expect((await rowOf(pinnedWork.title).boundingBox())!.height).toBe(32);

  // **숫자로 집는다.** 재려는 것이 상자가 아니라 그 안의 옅은 숫자이고, 두 자리가 같은
  // 규격(11.5px · tabular)을 쓰는 것이 지키려는 그 계약이다.
  const rightOf = async (target: ReturnType<typeof page.locator>) => {
    const box = (await target.boundingBox())!;
    return Math.round(box.x + box.width);
  };
  const 헤더개수 = page
    .getByRole("button", { name: MAIN_HEADER, exact: true })
    .locator("span.tabular-nums");
  const 메타숫자 = shells.locator("span.tabular-nums");
  await expect(메타숫자).toHaveCount(1);
  expect(await rightOf(메타숫자)).toBe(await rightOf(헤더개수));

  // **셸이 있는 행과 없는 행의 제목 폭이 같다**(결정 2·5). 예약이 2열 자체에 걸려 있어서다 —
  // 메타 상자에만 걸면 셸이 없는 행만 핀의 24px로 줄어 제목이 끊기는 자리가 행마다 갈린다.
  const titleWidth = async (title: string) =>
    (await page.getByRole("button", { name: title, exact: true }).boundingBox())!.width;
  expect(await titleWidth(plainWork.title)).toBe(await titleWidth(pinnedWork.title));

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 1·6·7 — **hover하면 메타가 물러나고 그 자리에 핀이 선다.** 둘은 2열 같은 칸에 겹쳐
// 있고, 메타는 지워지는 게 아니라 **투명해진다**: `display:none`으로 빼면 그 칸의 폭 계산에서
// 빠져 칸이 핀의 24px로 줄고 **hover마다 제목이 좌우로 뛴다.**
//
// **키보드로 닿을 때도 같다.** 핀은 hover뿐 아니라 포커스에도 뜨므로 hover만 물리면 Tab으로
// 닿았을 때 둘이 겹쳐 그려진다(결정 7). 반대로 「행 안 어디든 포커스」로 넓히면 이름 버튼에
// 포커스가 갔을 때 핀도 안 뜬 채 그 자리가 통째로 빈다 — 그 갈래를 마지막 두 줄이 막는다.
//
// **이 층에서만 보인다**: 겹침도 칸 폭도 `focus-visible`도 진짜 CSS와 레이아웃이 있어야 난다.
// 셸이 있는 화면에서 보는 이유는 위 검사와 같다.
test("hover·포커스로 핀에 닿으면 메타가 물러나고, 제목은 안 움직인다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const shells = page.locator(`[data-shells="${plainWork.slug}"]`);
  const pin = page.getByRole("button", { name: `${plainWork.title} 고정` });
  const title = page.getByRole("button", { name: plainWork.title, exact: true });
  await expect(shells).toHaveCSS("opacity", "1");
  await expect(pin).toHaveCSS("opacity", "0");
  const 평소 = (await title.boundingBox())!.width;

  // **이름 버튼에 포커스가 가도 메타는 그대로다** — 그때는 핀이 안 떠서, 물러나게 하면 그
  // 자리가 통째로 빈다. `group-focus-within`이 틀린 답인 이유가 이 두 줄이다.
  await title.focus();
  await expect(title).toBeFocused();
  await expect(shells).toHaveCSS("opacity", "1");
  await expect(pin).toHaveCSS("opacity", "0");

  // **핀에 포커스가 가면 핀이 뜨고 메타가 물러난다.** `group-hover`만 물리면 여기서 둘이
  // 겹쳐 그려진다(결정 7). Tab으로 옮기지 않는 것은 WebKit이 macOS 관행대로 Tab 순회에서
  // 버튼을 빼기 때문이고, 실물 앱도 WKWebView라 이 층이 그쪽을 그대로 예측한다.
  await pin.focus();
  await expect(pin).toBeFocused();
  await expect(pin).toHaveCSS("opacity", "1");
  await expect(shells).toHaveCSS("opacity", "0");

  await title.focus();
  await expect(shells).toHaveCSS("opacity", "1");

  await title.hover();
  await expect(pin).toHaveCSS("opacity", "1");
  await expect(shells).toHaveCSS("opacity", "0");
  // **자리는 남는다.** 폭이 그대로여야 제목이 끊기는 자리가 hover마다 안 뛴다(결정 6).
  expect((await title.boundingBox())!.width).toBe(평소);

  // **겹친 자리라 메타가 핀의 클릭을 가로채면 안 된다** — 메타가 DOM에서 뒤라 위에 그려진다.
  await pin.click();
  expect((await readIpcRecord(page))?.calls).toContain(
    `set_work_pinned {"slug":"${plainWork.slug}","pinned":true}`,
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 9~12 — **긴 제목이 `…` 대신 페이드로 끝나고, 마우스를 올리면 흘러 끝까지 읽힌다.**
// 폭으로는 이 문제를 못 푼다(핀 +24px · 이름 버튼 여백 +6px · 기본 폭 0px — 다 합쳐도 두
// 글자다). 그래서 마퀴가 답이고, 이 판은 제목 폭을 짜내지 않는다.
//
// **이 층이 유일한 그물이다.** 정적 마크업 seam은 마스크가 걸리는지도 글자가 흐르는지도
// 영영 못 본다 — 거리는 `100cqw`가 풀고 타이밍은 트랜지션이 든다. 둘 다 진짜 CSS와 레이아웃이
// 있어야 난다.
//
// **넘치는 제목과 안 넘치는 제목을 함께 본다.** 「흐른다」만 보면 아무것도 안 흐르는 화면에서
// 초록이 되고, 「안 흐른다」만 보면 그 반대다.
test("긴 제목은 hover에 흘러 끝까지 읽히고, 모션을 끄면 안 흐른다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  const 긴제목 = titleBoxOf(page, pinnedWork.title);
  const 짧은제목 = titleBoxOf(page, plainWork.title);
  // **먼저 둘이 갈려 있음을 센다.** 이것이 없으면 아래 두 단언이 서로를 못 지킨다.
  const 넘침 = await overflowOf(긴제목);
  expect(넘침).toBeGreaterThan(0);
  expect(await overflowOf(짧은제목)).toBeLessThanOrEqual(0);

  // **`…`이 아니다**(결정 9·18). 끊는 것은 오른쪽 끝 24px 그라디언트이고, 마스크는 상시라
  // 넘치지 않는 제목에도 걸려 있다(결정 12 — 거의 꽉 찬 제목의 끝 글자가 옅어지는 대가).
  await expect(긴제목).toHaveCSS("text-overflow", "clip");
  for (const box of [긴제목, 짧은제목]) {
    const mask = await box.evaluate((el) => getComputedStyle(el).maskImage);
    expect(mask).toContain("linear-gradient");
    // **오른쪽만이다**(결정 18) — 왼쪽은 글자가 흘러 들어오는 쪽이라 하드 컷이다. 방향을
    // 뒤집어도 흐름도 정지도 복귀도 그대로라, 이 두 줄이 없으면 **AC가 요구한 것의 정반대**가
    // 초록으로 들어온다. 폭까지 보는 것은 `index.css`의 `--title-fade`와 여기 `TITLE_FADE`가
    // 「같은 수여야 한다」는 주석상의 계약을 실측으로 묶기 위해서다.
    expect(mask).toContain("to right");
    expect(mask).toContain(`${TITLE_FADE}px`);
  }
  // 쉴 때는 제자리다 — 쉴 때 계측도 없다(결정 12).
  expect(await shiftOf(긴제목)).toBe(0);

  // **hover하면 흐른다.** 200ms 뒤에 시작해 **넘침 + 페이드 폭**만큼 가는데, 그 24px이
  // 없으면 다 흐른 뒤에도 마지막 글자가 페이드에 먹힌다(결정 11).
  await 긴제목.hover();
  const 거리 = 넘침 + TITLE_FADE;

  // **200ms는 기다린다**(결정 11) — 목록을 훑고 지나갈 때 제목이 흔들리지 않고, 호버
  // 카드(350ms)보다는 먼저 답한다.
  await page.waitForTimeout(80);
  expect(-(await shiftOf(긴제목))).toBeLessThan(2);

  // **그다음 천천히 흐른다 — 50px/s, 거리에 비례**(결정 11). 이 단언들이 없으면 「툭 튀어
  // 끝으로 갔다」도 초록이 된다: 실제로 그렇게 났다(실측) — 마퀴를 `:hover`로 켜면 그 행을
  // **처음** 가리킬 때 트랜지션이 지속시간 없이 만들어져 0ms로 굳는다(index.css의 표식 주석).
  //
  // **같은 밴드를 다른 넘침에서 한 번 더 건다**(아래 드래그 검사) — 한 길이에서만 재면
  // 「길이와 무관하게 일정」은 아무것도 안 잰 것이 된다.
  await page.waitForTimeout(370);
  // 두 점이 **다 흐르는 도중**이어야 기울기가 속도다 — 출발 전이나 도착 뒤를 짚으면 0이 난다.
  expect(-(await shiftOf(긴제목))).toBeGreaterThan(4);
  const 속도 = await speedOf(긴제목);
  expect(-(await shiftOf(긴제목))).toBeLessThan(거리 - 4);
  expect(속도).toBeGreaterThan(속도밴드[0]);
  expect(속도).toBeLessThan(속도밴드[1]);

  await expect
    .poll(async () => Math.abs((await shiftOf(긴제목)) + 거리) <= 2, {
      timeout: 8000,
      message: "제목이 넘침 + 페이드 폭만큼 흐르지 않았다",
    })
    .toBe(true);

  // **호버 카드는 그대로다**(결정 11) — 350ms 뒤에 떠서 전체 제목을 줄바꿈해 보여준다.
  // 마퀴가 빠른 답, 카드가 완전한 답이라 이 판은 카드를 안 건드린다.
  await expect(page.locator("[data-popover]")).toContainText(pinnedWork.title);

  // **끝에서 멈춘다 — 반복하지 않는다**(결정 11). 왕복 루프는 시선을 계속 잡아끈다.
  const 멈춘자리 = await shiftOf(긴제목);
  await page.waitForTimeout(600);
  expect(await shiftOf(긴제목)).toBe(멈춘자리);

  // 마우스가 떠나면 제자리로 돌아온다(180ms, 지연 0).
  await 짧은제목.hover();
  await expect.poll(() => shiftOf(긴제목)).toBe(0);

  // **안 넘치는 제목은 hover해도 가만히 있다** — 시작 지연이 지나도 0이다. `min`이 0을
  // 고르기 때문이고(결정 10), 페이드 폭을 그냥 빼면 여기가 24px까지 흐른다.
  await page.waitForTimeout(500);
  expect(await shiftOf(짧은제목)).toBe(0);

  // **모션을 끄면 안 흐른다. 페이드는 남는다**(결정 11) — 그때 전체 제목을 보는 길이 카드다.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await 긴제목.hover();
  await page.waitForTimeout(700);
  expect(await shiftOf(긴제목)).toBe(0);
  expect(await 긴제목.evaluate((el) => getComputedStyle(el).maskImage)).toContain("linear-gradient");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 10 — **흐르는 거리는 CSS가 정한다. 아무도 재지 않는다.** 상자가 인라인 사이즈
// 컨테이너라 안쪽 글자가 `100cqw`로 상자 폭을 되읽고, 사이드바 폭이 바뀌면 CSS가 스스로 다시
// 푼다. **폭이 드래그로 바뀌는 이 화면에서 그게 결정적이다** — 관찰자가 필요 없는 이유가 이것이고,
// 「관찰자를 안 단다」 자체는 소스 스캔(SidebarWorkList.test.tsx)이 든다.
//
// 이 층에서만 보인다: 폭을 실제로 끌어야 나고, `cqw`는 진짜 레이아웃에서만 풀린다.
test("사이드바 폭을 드래그하면 흐르는 거리가 저절로 맞는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  const 긴제목 = titleBoxOf(page, pinnedWork.title);
  const 처음넘침 = await overflowOf(긴제목);

  // 폭 핸들은 사이드바의 **오른쪽 가장자리**에 얹힌 5px 띠다 — 좌표는 그 상자에서 읽는다.
  const handle = page.locator('aside [title="드래그로 폭 조절 · 더블클릭으로 기본 폭"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error("사이드바 폭 핸들의 상자를 못 읽었다");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 30, y, { steps: 5 });
  await page.mouse.up();

  // 좁아진 만큼 넘침이 늘었다 — 이것이 안 서면 아래는 「끌지도 못했다」를 초록으로 읽는다.
  const 좁힌뒤 = await overflowOf(긴제목);
  expect(좁힌뒤).toBeGreaterThan(처음넘침);

  // **다시 그리지도, 다시 재지도 않았는데** 흐르는 거리가 새 폭에 맞는다.
  await 긴제목.hover();

  // **속도는 넘침이 달라져도 같다** — AC 「흐르는 속도가 제목 길이와 무관하게 일정하다」를
  // 재는 자리가 여기다. 위 검사가 첫 넘침에서 건 밴드를 좁힌 뒤의 넘침에서도 걸어야 그 말이
  // 처음으로 실측된다: 고정 지속시간(기각안 「마퀴 — 완전 CSS」)은 거리가 늘면 속도가 함께
  // 늘어서 두 자리가 같은 값을 못 낸다. 이 줄들이 없으면 그 기각안이 전부 초록으로 들어온다.
  await page.waitForTimeout(450);
  expect(-(await shiftOf(긴제목))).toBeGreaterThan(4);
  const 속도 = await speedOf(긴제목);
  expect(속도).toBeGreaterThan(속도밴드[0]);
  expect(속도).toBeLessThan(속도밴드[1]);

  await expect
    .poll(async () => Math.abs((await shiftOf(긴제목)) + (좁힌뒤 + TITLE_FADE)) <= 2, {
      timeout: 8000,
      message: "좁힌 뒤의 넘침에 흐르는 거리가 안 맞는다",
    })
    .toBe(true);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 4 — **nav `Terminal`도 같은 어휘를 쓴다.** 최상위 셸에서 claude가 돌면 거기에도
// 로고가 뜬다: 무리가 하나뿐이라 숫자가 하나로 서는 것이고 규칙은 일반화될 뿐 안 깨진다.
//
// **여기서 보는 것은 자리가 아니라 어휘가 같은가다.** 그리고 이 층에서만 보인다 —
// `Sidebar.tsx`는 `terminal-store`를 물어 정적 마크업 seam이 닿지 않고(Sidebar.test.tsx
// 머리말), 최상위 셸은 이 화면의 진입 이펙트(`ensureShell`)를 태워야 생긴다.
test("최상위 셸에서 도는 명령의 로고가 nav `Terminal`에도 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");

  // 표식은 안 단다(결정 14) — nav는 **접근성 이름**으로 집는다. 배경 상자가 행이고 그 안에
  // 이름 버튼과 메타가 형제로 선다.
  const navRow = page
    .locator("nav")
    .getByRole("button", { name: "Terminal", exact: true })
    .locator("xpath=..");
  // **먼저 로고가 없음을 센다.** 이것이 없으면 아래 단언이 「원래 있던 것」으로도 초록이 된다.
  await expect(navRow.locator('[role="img"]')).toHaveCount(0);
  // 셸 하나가 이미 떠 있으므로(`ensureShell`) 그 자리에는 그 밖의 셸 무리가 서 있다.
  await expect(navRow).toContainText("1");

  await markRunning(page, "claude");

  await expect(navRow.getByRole("img", { name: "claude" })).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 30 — 호버 카드는 **행 옆에 뜬다**. 사이드바 경계선 밖으로 밀어내던 판을 걷은 자리다:
// 경계에서 재면 카드가 그 선에 딱 맞춰 서서 옆 화면에 끼워 넣은 칸처럼 읽혔다(실물).
//
// 이 층에서만 보인다 — 카드는 body 직계에 뜨는 fixed 상자라 자리가 진짜 레이아웃에서만 난다.
test("호버 카드는 행 바로 옆에 서서 사이드바 경계선 위로 올라선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  // 앵커는 이름 버튼이 아니라 **행 상자**다 — 그 오른쪽 끝과 이름 버튼 사이에 핀 칸이 있다.
  const row = page.getByRole("button", { name: plainWork.title, exact: true }).locator("xpath=..");
  const card = page.locator("[data-popover]");
  // **먼저 없음을 센다** — 이것이 없으면 아래가 「원래 떠 있던 것」으로도 초록이 된다.
  await expect(card).toHaveCount(0);

  await row.hover();
  // 350ms 머물러야 뜬다(HOVER_DELAY_MS). 자리를 재기 전 한 프레임은 invisible이라
  // toBeVisible이 그 프레임까지 함께 기다린다.
  await expect(card).toBeVisible();

  const rowBox = (await row.boundingBox())!;
  const cardBox = (await card.boundingBox())!;
  const aside = (await page.locator("aside").boundingBox())!;

  // **행에서 4px이다.** 경계선에서 재던 값은 눈에 19px 더 벌어져 보였다 — 거터 8px과
  // 늘 예약된 스크롤바 11px이 행과 경계선 사이에 있기 때문이다.
  expect(Math.round(cardBox.x - (rowBox.x + rowBox.width))).toBe(4);
  // 그래서 카드는 사이드바의 오른쪽 끝을 **덮고** 선다. 이 줄이 「떠 있다」를 말한다 —
  // 경계 밖으로 미는 판이 돌아오면 여기가 빨개진다.
  expect(cardBox.x).toBeLessThan(aside.x + aside.width);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
