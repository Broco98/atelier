import { expect, test } from "./evidence";
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
// **이 경로는 어느 층도 통째로 안 지나간다.** `Sidebar.test.tsx`는 값(`runningKindsOf`)과
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
  // 메타 상자에만 걸면 셸이 없는 행만 핀의 24px로 줄어 말줄임 지점이 행마다 갈린다.
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
  // **자리는 남는다.** 폭이 그대로여야 제목의 말줄임 지점이 hover마다 안 뛴다(결정 6).
  expect((await title.boundingBox())!.width).toBe(평소);

  // **겹친 자리라 메타가 핀의 클릭을 가로채면 안 된다** — 메타가 DOM에서 뒤라 위에 그려진다.
  await pin.click();
  expect((await readIpcRecord(page))?.calls).toContain(
    `set_work_pinned {"slug":"${plainWork.slug}","pinned":true}`,
  );

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
