import { expect, test } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, markRunning, readIpcRecord, unknownIpcCalls } from "./harness";

// 사이드바 작업 목록은 어느 화면에나 있으므로 목록 화면에서 본다 — Works 화면으로 들어가면
// 그 화면이 부르는 것까지 하네스가 답해야 하는데, 여기서 볼 것은 사이드바뿐이다.
//
// 정적 마크업 seam(SidebarWorkList.test.tsx)이 못 보는 것만 여기서 본다: hover에만 뜨는
// 것(결정 85)은 진짜 CSS가 있어야 하고, 핀을 눌러 나가는 쓰기와 접힘이 다음 실행까지
// 남는 것(결정 108)은 이벤트와 localStorage가 있어야 한다.

const [, plainWork] = WORKS;

// 헤더의 접근성 이름에는 개수가 함께 들어간다 — 라벨과 옅은 숫자가 같은 버튼 안이다.
const PINNED_HEADER = "고정 1";

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
  const [pinnedWork] = WORKS;
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
  const [pinnedWork] = WORKS;
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

// 결정 2 — work 행 **둘째 줄이 상태를 말한다**: 셸 수와 **도는 것의 로고**.
//
// **이 경로는 어느 층도 통째로 안 지나간다.** `Sidebar.test.tsx`는 값(`runningKindsOf`)과
// 배선(구독 리터럴)을 따로 못박고 `SidebarWorkList.test.tsx`는 그림을 정적 마크업으로 보는데,
// 셋을 잇는 **한 바퀴** —— 이벤트가 스토어에 앉고 그 행이 다시 그려져 로고가 실제로 서는가 ——
// 는 아무도 안 돈다. 탭 줄 쪽은 `terminal-tabs.spec.ts`가 그 바퀴를 돈다.
test("도는 명령의 로고가 work 행 둘째 줄에 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  // 들어오면 이 work의 셸 하나가 뜬다(`ensureShell`) — 둘째 줄이 서는 조건이 그것이다(결정 3).
  const subrow = page.locator(`[data-subrow="${plainWork.slug}"]`);
  await expect(subrow).toHaveCount(1);
  // **먼저 로고가 없음을 센다.** 이것이 없으면 아래 단언이 「원래 있던 것」으로도 초록이 된다.
  await expect(subrow.locator('[role="img"]')).toHaveCount(0);

  await markRunning(page, "claude");

  // 그 work에서 claude가 돈다는 사실이 사이드바에 선다 —— 화면이 터미널이 아니어도 보이는
  // 자리이고(결정 2), 스크롤로 밀려난 칸에서 도는 것을 알 유일한 자리다.
  await expect(subrow.getByRole("img", { name: "claude" })).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
