import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import {
  awaitSpawned,
  installFixtureBackend,
  markRunning,
  readIpcRecord,
  unknownIpcCalls,
} from "./harness";

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
const TITLE_FADE = 12;

// 흐르는 **속도**(px/s) — `SidebarWorkList.tsx`의 `MARQUEE_SPEED`와 같은 수다. 상수인 것은
// 지속시간이 아니라 **이 값**이고(결정 11), 그래서 넘침이 다른 두 자리에서 같은 값이 나와야
// 한다. 실측이 들어야 하는 밴드는 ±12%다 — `speedOf`가 잰 시각으로 나누므로 이만큼 좁힐 수
// 있고, 좁아야 고정 지속시간이 두 자리를 다 통과하지 못한다.
const MARQUEE_SPEED = 50;
const 속도밴드 = [MARQUEE_SPEED * 0.88, MARQUEE_SPEED * 1.12];

// 핀 상자의 폭(`icon-button`). **행은 hover에 제목 상자가 정확히 이만큼 줄어든다** — 핀이
// 2열에 서면서 빈 칸이 처음으로 폭을 갖기 때문이다(SidebarWorkList의 핀 주석). 판 05에서는
// 셸이 0개인 행에서만 그랬는데, 이 판이 셸 메타를 둘째 줄로 내리면서 **2열에 남은 것이 핀
// 하나뿐이라** 모든 행이 같이 움직인다.
// 그래서 흐르는 거리를 **hover 중의 넘침**으로 재야 한다: 쉴 때 넘침으로 재면 이만큼 모자라
// 마지막 글자가 페이드에 남는다.
const PIN_WIDTH = 24;

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
  // **pty가 앉기 전에 닫으면 안 묻는 것이 옳다**(`awaitSpawned`의 머리말) — 확인 창을 보는
  // 이 검사는 그 전제를 먼저 세운다.
  await awaitSpawned(page, 1);
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

  // **「가는 중」을 브라우저 안에서 듣는다.** 한때 이 자리가 `waitForTimeout(40)` 뒤에 높이를
  // 한 번 재고 그 값이 0보다 큰지 봤는데, `boundingBox()`가 **프로토콜 왕복**이라 관찰 시점이
  // 러너 속도에 매였다: 느린 러너에서는 40ms를 노린 그 한 번이 트랜지션(180ms)이 **끝난 뒤에**
  // 도착해 0을 읽는다. macOS CI에서 2/2 빨간불이었고 로컬 macOS 3회·리눅스 CI에서는 안 났다 —
  // 코드가 아니라 검사가 흔들린 것이다(v0.11.0 릴리즈가 그 자리에서 두 번 멎었다).
  //
  // 리스너는 **클릭 전에** 걸고 결과는 나중에 읽으므로 왕복이 타이밍에 안 낀다. 그리고 이쪽이
  // 재려던 것을 더 곧게 잰다: 「한 번에 사라지지 않는다」 = **`grid-template-rows`가 전이됐다**
  // 이고, 높이 표본은 그것의 간접 증거였다.
  await body.evaluate((el) => {
    (window as unknown as { __collapsed: string[] }).__collapsed = [];
    el.addEventListener("transitionend", (e) => {
      (window as unknown as { __collapsed: string[] }).__collapsed.push(
        (e as TransitionEvent).propertyName,
      );
    });
  });

  await header.click();
  await page.waitForTimeout(400);
  const after = await height();
  const transitioned = await page.evaluate(
    () => (window as unknown as { __collapsed: string[] }).__collapsed,
  );

  // 끝내 접힌다.
  expect(after).toBe(0);
  // **가는 중이 있었다.** 한 번에 사라지면 전이가 안 일어나 이 줄이 빨개진다.
  expect(transitioned).toContain("grid-template-rows");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 2·3 — work 행이 **어디서 무엇이 도는지**를 말한다: 무리마다 글리프와 **그 무리의
// 셸 수**. 이 판이 옮긴 것은 **자리**뿐이다 — 오른쪽 끝 한 칸에서 둘째 줄로.
//
// **이 경로는 어느 층도 통째로 안 지나간다.** `Sidebar.test.tsx`는 값(`runningAgentsOf`)과
// 배선(구독 리터럴)을 따로 못박고 `shell-meta.test.tsx`는 그림을 정적 마크업으로 보는데,
// 셋을 잇는 **한 바퀴** —— 이벤트가 스토어에 앉고 그 행이 다시 그려져 로고가 실제로 서는가 ——
// 는 아무도 안 돈다. 탭 줄 쪽은 `terminal-tabs.spec.ts`가 그 바퀴를 돈다.
//
// **제목 폭도 여기서 잰다 — 그리고 이 판이 그것을 고친다**(스토리 27). 판 05에서는 메타가
// 제목과 같은 격자 행에 있어 셸이 붙고 떨어질 때마다 제목이 끊기는 자리가 좌우로 뛰었다
// (첫 셸이 서면 27.91px, 무리가 둘이 되면 다시 28.90px). 메타가 둘째 줄로 내려가면서 **첫
// 줄이 셸을 아예 모르게 됐다** — 그 뜀이 0이 되는 것을 아래가 잰다.
test("도는 명령의 로고가 work 행 둘째 줄에 서고, 제목은 안 움직인다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  // 들어오면 이 work의 셸 하나가 뜬다(`ensureShell`) — 종류·수가 서는 조건이 그것이다(결정 3).
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

  // **그 셸은 한 번만 세어진다**(결정 3). 셸이 하나이고 거기서 claude가 도니 무리는 하나이고,
  // 한때 그 옆에 함께 서던 `⌨1`이 없다 —— 그 두 `1`은 같은 셸이었다. 자리가 둘째 줄로
  // 옮겨 와도 그 불변조건은 그대로다.
  await expect(shells).toHaveText("1");

  // **무리가 둘이 되어도 제목이 안 움직인다 — 이 판이 산 것이 이 두 줄이다**(스토리 27).
  // 셸을 하나 더 열면 무리가 둘(`✳1 ⌨1`)이 되어 둘째 줄이 넓어지는데, 첫 줄은 그 값을
  // 아예 모른다. 메타를 다시 2열로 올리면 여기가 빨개진다(그때 실측 194.09 → 165.19px).
  await page.locator('[data-tab="new"]').click();
  await expect(shells.locator("span.tabular-nums")).toHaveText(["1", "1"]);
  expect((await title.boundingBox())!.width).toBe(한무리);

  // **행 높이도 그대로다.** 둘째 줄이 길어지는 것이지 줄이 늘어나는 것이 아니다 —
  // 트랙이 26px + 29px로 못박혀 있고, 넘치는 글자는 그 안에서 잘린다.
  expect((await title.locator("xpath=..").boundingBox())!.height).toBe(55);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 이 판 결정 4 — **모든 행이 두 줄이고, 높이가 같다.** 판 05 결정 0이 뒤집혔다: 그 판은
// 「셸이 있으면 둘째 줄이 서서 54px」이던 것을 걷어 전부 32px 한 줄로 만들었는데, 그 답이 산
// 것은 「높이가 신호다」를 죽인 것이고 잃은 것은 **둘째 줄이 실을 수 있던 새 사실**이었다.
// 이 판은 둘을 다 갖는다 — 줄은 둘이되 **모든 행이** 둘이라 높이는 여전히 아무 말도 안 한다.
//
// **치수는 판 05가 눈으로 고른 것이다**(목업 `행-신호-세-안.html`의 flat): 안쪽 위 8 · 아래 7 ·
// 좌 9 · 우 10, 줄 높이 18·18, 줄 간격 4 → 55px. 그 합을 **수로** 못박는 것은, 「둘이 같다」만
// 재면 두 행이 나란히 한 줄로 되돌아가도 초록이 되기 때문이다.
//
// **둘째 줄이 무엇을 싣는지도 여기서 본다.** 셸이 있으면 종류·수, 없으면 프로젝트 이름 —
// 그 갈림은 마크업 seam이 이미 보지만, **진짜 스토어에서 온 셸 수로** 그 갈래가 갈리는지는
// 이 층에서만 난다(`ensureShell`이 이 화면에서만 셸을 세운다).
test("모든 행이 두 줄이고 높이가 같다 — 둘째 줄이 셸이나 프로젝트를 싣는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  // 이 화면에 들어와야 셸이 하나 생긴다(`ensureShell`) — `/projects`에는 셸이 없어 종류·수가
  // 아예 안 선다. 사이드바는 어느 화면에나 같은 것이므로 보는 자리는 그대로다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const rowOf = (title: string) =>
    page.getByRole("button", { name: title, exact: true }).locator("xpath=..");
  const shells = page.locator(`[data-shells="${plainWork.slug}"]`);
  await expect(shells).toHaveCount(1);
  // 셸이 0개인 행에는 종류·수가 안 선다 — 「없음」은 숫자로 말하지 않는다. **둘째 줄 자체는
  // 선다**(아래) — 그것이 이 판과 판 05의 갈림이다.
  await expect(page.locator(`[data-shells="${pinnedWork.slug}"]`)).toHaveCount(0);

  // **모든 work 행이 같은 높이다.** 셸이 있는 행과 없는 행이 여기서 갈리면 높이가 다시
  // 신호가 된다 — 판 05가 32px 한 줄로 죽였던 그 병이다.
  const 셸행 = (await rowOf(plainWork.title).boundingBox())!.height;
  const 빈행 = (await rowOf(pinnedWork.title).boundingBox())!.height;
  expect(셸행).toBe(빈행);
  expect(셸행).toBe(55);

  // **둘째 줄은 두 행에 다 선다.** 셸이 있는 행은 종류·수(무리 하나이므로 `1`), 없는 행은
  // 프로젝트 이름이다(fixture: `billing` 하나).
  const 둘째줄 = (slug: string) => page.locator(`[data-subrow="${slug}"]`);
  await expect(둘째줄(plainWork.slug)).toHaveCount(1);
  await expect(둘째줄(pinnedWork.slug)).toHaveCount(1);
  await expect(둘째줄(plainWork.slug)).toHaveText("1");
  await expect(둘째줄(pinnedWork.slug)).toHaveText(pinnedWork.projects.join(" · "));

  // **둘째 줄은 제목의 왼쪽 끝과 x가 맞는다** — 레인 폭 + 간격(14 + 9)만큼 들여썼기
  // 때문이다. 들여쓰기를 잃으면 둘째 줄이 레인 아래로 파고들어 두 줄이 계단처럼 읽힌다.
  const x = async (target: Locator) => Math.round((await target.boundingBox())!.x);
  // 재는 것은 상자가 아니라 **그 안에 실제로 서는 것**이다 — 둘째 줄 상자는 두 칸을 다
  // 쓰므로(핀 아래를 지나간다) 왼쪽 끝이 행의 왼쪽 끝이고, 들여쓰기는 그 안쪽 padding이다.
  expect(await x(둘째줄(plainWork.slug).locator("> *").first())).toBe(
    await x(page.getByRole("button", { name: plainWork.title, exact: true }).locator("[data-title]")),
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **둘째 줄 글자가 사이드바 배경에서 대비 4.5를 넘는다**(이 판 결정 5). 이 판이 시작된
// 사람의 말이 「지금 활성화된 셸을 찾는 게 생각보다 어렵다. 이 한 줄이 가독성이 안 좋다」였고,
// 그 한 줄이 판 05의 오른쪽 메타(`tertiary`)다 — 사이드바 배경에서 대비가 **3.0**이라 제목
// 꼬리처럼 읽혔다. **자리를 옮기는 것은 그 말에 대한 답이 아니다.** 그래서 바닥을
// `muted-foreground`로 올렸고, 이 검사가 그 수를 **계산해서** 잰다.
//
// **계산이 이 층에 있는 이유**: 토큰이 `oklch`와 hex로 갈려 있어 「무슨 색을 골랐나」로는
// 대비를 못 잰다. 그리고 브라우저는 `oklch`를 **그대로 돌려준다**(WebKit 실측:
// `getComputedStyle(...).color === "oklch(0.708 0 0)"`) — 그래서 색 문자열을 캔버스에 한 번
// 칠해 실제 픽셀로 받는다. 그 픽셀이 곧 사람 눈에 닿는 값이라, 파서를 손으로 쓰는 것보다
// 짧고 새지 않는다.
//
// **라이트와 다크를 둘 다 잰다.** 다크 팔레트는 아직 앱에 켜는 손잡이가 없지만(`.dark`를
// 붙이는 자리가 이 저장소에 없다) 토큰은 이미 서 있고, 손잡이가 생기는 날 이 줄이 그 팔레트를
// 이미 지키고 있어야 한다 — 그날 대비를 다시 세는 사람은 없다.
const 대비를잰다 = (page: Page, 글자: Locator, 배경: Locator) =>
  Promise.all([
    글자.evaluate((el) => getComputedStyle(el).color),
    배경.evaluate((el) => getComputedStyle(el).backgroundColor),
  ]).then(([앞, 뒤]) =>
    page.evaluate(
      ([앞, 뒤]: [string, string]) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        const 휘도 = (color: string) => {
          // 캔버스는 이전 칠을 들고 있으므로 매번 지운다 — 반투명 색을 그 위에 칠하면
          // 앞의 것과 섞여, 「불투명한가」를 보는 아래 검사가 새어 나간다.
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
          if (a !== 255) throw new Error(`대비를 잴 수 없는 색이다(불투명하지 않다): ${color}`);
          const 선형 = (one: number) => {
            const c = one / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * 선형(r) + 0.7152 * 선형(g) + 0.0722 * 선형(b);
        };
        const [밝, 어] = [휘도(앞), 휘도(뒤)].sort((x, y) => y - x);
        return (밝 + 0.05) / (어 + 0.05);
      },
      [앞, 뒤] as [string, string],
    ),
  );

test("둘째 줄 글자는 사이드바 배경에서 대비 4.5를 넘는다 — 라이트·다크 둘 다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  const 줄 = page.locator(`[data-subrow="${pinnedWork.slug}"]`);
  // 먼저 잴 것이 실제로 서 있는가 — 빈 줄의 색을 재도 수는 나온다.
  await expect(줄).toHaveText(pinnedWork.projects.join(" · "));

  expect(await 대비를잰다(page, 줄, page.locator("aside"))).toBeGreaterThanOrEqual(4.5);

  // 다크 팔레트. 앱에 아직 켜는 손잡이가 없어 클래스를 손으로 붙인다 — `index.css`의
  // `.dark` 블록이 곧 그 팔레트의 정본이다.
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  expect(await 대비를잰다(page, 줄, page.locator("aside"))).toBeGreaterThanOrEqual(4.5);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 이 판이 **판 05 결정 6을 뒤집는다**: hover에 핀이 떠도 **레인과 둘째 줄은 안 사라진다.**
// 판 05에서는 메타와 핀이 2열 한 칸에 겹쳐 서서, 핀이 뜨면 메타가 투명해지는 것이 유일한
// 답이었다 — 자리가 하나뿐이었으니까. 이 판은 메타를 둘째 줄로 내려 그 겹침을 없앴고,
// 그래서 **띄우려는 것이 hover에 지워지는** 일이 구조적으로 안 난다. 상태 축이 들어오면
// (티켓 06) 레인의 점이 곧 이 판이 띄우려는 것이라, 그것이 마우스 위치에 따라 있다 없다 하면
// 이 판 전체가 무의미해진다.
//
// **핀이 폭을 hover에만 갖는 것은 그대로다.** 사람이 실물 앱에서 고른 모양이다:
// 「호버하면, 자동으로 아이콘 위치만큼 text의 최대 크기가 조정되지? 이런걸 원하는거임.
// (안겹치게)」 달라진 것은 **이제 모든 행이 똑같이 24px 줄어든다**는 것이다 — 2열이 셸을
// 모르므로 셸이 있는 행과 없는 행이 갈리지 않는다.
//
// 한때 핀이 `absolute right-1`로 격자 밖에 서서 뜀이 0이었는데, 칸이 핀을 몰라 **핀이 제목
// 글자 위에 얹혔다.** 마지막 단언(제목 끝 ≤ 핀 시작)이 그 회귀를 막는다.
//
// **키보드로 닿을 때도 같다**(결정 7). 핀은 hover뿐 아니라 포커스에도 뜬다.
//
// **이 층에서만 보인다**: 겹침도 칸 폭도 `focus-visible`도 진짜 CSS와 레이아웃이 있어야 난다.
test("hover에 핀이 떠도 레인과 둘째 줄이 남고, 핀은 글자를 안 덮는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const shells = page.locator(`[data-shells="${plainWork.slug}"]`);
  const subrow = page.locator(`[data-subrow="${plainWork.slug}"]`);
  const lane = page.locator(`[data-subrow="${plainWork.slug}"]`).locator("xpath=..").locator("[data-lane]");
  const pin = page.getByRole("button", { name: `${plainWork.title} 고정` });
  const title = page.getByRole("button", { name: plainWork.title, exact: true });
  await expect(shells).toHaveCount(1);
  await expect(pin).toHaveCSS("opacity", "0");
  const 평소 = (await title.boundingBox())!.width;

  // **핀에 포커스가 가도 레인과 둘째 줄은 그대로다.** 판 05에서는 이 자리에서 메타가
  // `opacity: 0`이 됐다(`peer-focus-visible:opacity-0`). 그 규칙이 남아 있으면 여기가 빨개진다.
  await pin.focus();
  await expect(pin).toBeFocused();
  await expect(pin).toHaveCSS("opacity", "1");
  await expect(subrow).toHaveCSS("opacity", "1");
  await expect(lane).toHaveCSS("opacity", "1");

  await title.hover();
  await expect(pin).toHaveCSS("opacity", "1");
  await expect(subrow).toHaveCSS("opacity", "1");
  await expect(lane).toHaveCSS("opacity", "1");
  // **둘째 줄은 폭도 안 변한다** — 두 칸을 다 쓰므로 핀 아래를 지나간다. 1열에만 두면
  // 여기가 24px 좁아져 프로젝트 이름이 hover마다 잘렸다 폈다 한다.
  const 줄폭 = (await subrow.boundingBox())!.width;

  // **제목만 핀만큼 줄어든다 — 셸이 있든 없든 같다.** 판 05에서는 메타(27.91px)가 이미 선
  // 행이 안 움직이고 셸 0개인 행만 24px 줄었는데, 그 갈림이 곧 「셸이 붙고 떨어질 때 제목이
  // 끊기는 자리가 뛴다」의 다른 쪽 얼굴이었다.
  const 핀상자 = (await pin.boundingBox())!;
  expect((await title.boundingBox())!.width).toBe(평소 - 핀상자.width);
  expect((await subrow.boundingBox())!.width).toBe(줄폭);

  // **핀은 첫 줄 글자와 눈높이가 맞는다.** 격자 1행이 위 8px 여백까지 안고 있어, 아무것도
  // 안 하면 핀이 글자보다 5px 위에 뜬다(트랙 위쪽에 붙는다).
  const 제목상자 = (await title.locator("[data-title]").boundingBox())!;
  expect(Math.round(핀상자.y + 핀상자.height / 2)).toBe(
    Math.round(제목상자.y + 제목상자.height / 2),
  );

  // **셸이 없는 행도 똑같이 움직인다.**
  const 빈행제목 = page.getByRole("button", { name: pinnedWork.title, exact: true });
  const 빈행핀 = page.getByRole("button", { name: `${pinnedWork.title} 고정` });
  const 빈행줄 = page.locator(`[data-subrow="${pinnedWork.slug}"]`);
  await expect(page.locator(`[data-shells="${pinnedWork.slug}"]`)).toHaveCount(0);
  const 빈행평소 = (await 빈행제목.boundingBox())!.width;
  await 빈행제목.hover();
  await expect(빈행핀).toHaveCSS("opacity", "1");
  await expect(빈행줄).toHaveCSS("opacity", "1");
  const 빈행핀상자 = (await 빈행핀.boundingBox())!;
  expect((await 빈행제목.boundingBox())!.width).toBe(빈행평소 - 빈행핀상자.width);

  // **핀은 2열이 무엇을 하든 같은 자리에 선다** — `justify-self-end`가 칸 끝에 붙든다.
  const 오른끝 = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    return Math.round(box.x + box.width);
  };
  expect(await 오른끝(빈행핀)).toBe(await 오른끝(pin));

  // **핀이 글자를 안 덮는다.** 격자 밖에 세우면 hover 밀림은 0이지만 칸이 핀을 몰라 제목
  // 상자가 핀 아래까지 뻗고, 페이드 띠와 글리프가 같은 자리에 겹쳐 끝 글자가 뭉개진다.
  const 빈행제목상자 = (await 빈행제목.locator("[data-title]").boundingBox())!;
  expect(빈행제목상자.x + 빈행제목상자.width).toBeLessThanOrEqual(빈행핀상자.x);

  await title.hover();
  // **둘째 줄이 핀의 클릭을 가로채면 안 된다** — 그 줄은 핀 아래를 지나간다.
  await pin.click();
  expect((await readIpcRecord(page))?.calls).toContain(
    `set_work_pinned {"slug":"${plainWork.slug}","pinned":true}`,
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **사이드바를 좁히면 글자가 먼저 잘리고 레인은 안 줄어든다**(이 판 결정 5). 레인은 상태 축이
// 들어오면(티켓 06) 점·링이 서는 자리이므로, 폭이 모자랄 때 **가장 먼저 포기해도 되는 것**의
// 정반대다. 제목과 둘째 줄은 잘려도 여전히 읽을 수 있지만, 8px 점은 12px만 줄어도 사라진다.
//
// **줄어드는 값을 수로 묶는다.** 「레인이 안 줄었다」만 재면 제목이 대신 안 줄고 행이 통째로
// 넘쳐도 초록이 된다 — 줄인 만큼이 두 글자 상자에 그대로 가야 그 말이 참이다.
//
// 이 층에서만 보인다: 폭을 실제로 끌어야 나고, `shrink-0`도 `min-w-0`도 진짜 레이아웃에서만
// 갈린다.
test("사이드바를 좁히면 제목과 둘째 줄이 잘리고 레인은 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  // 셸이 있는 행과 없는 행을 함께 본다 — 둘째 줄이 무엇을 싣든 잘리는 쪽은 같아야 한다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const 폭 = async (target: Locator) => (await target.boundingBox())!.width;
  const 행 = (work: (typeof WORKS)[number]) =>
    page.getByRole("button", { name: work.title, exact: true }).locator("xpath=..");
  const 잰다 = async (work: (typeof WORKS)[number]) => ({
    레인: await 폭(행(work).locator("[data-lane]")),
    제목: await 폭(행(work).locator("[data-title]")),
    둘째줄: await 폭(page.locator(`[data-subrow="${work.slug}"]`)),
  });

  const 앞 = { 셸행: await 잰다(plainWork), 빈행: await 잰다(pinnedWork) };
  // 레인은 이 판이 정한 14px 한 칸이다 — 이 줄이 없으면 아래 「안 줄었다」가 「원래 0이다」로도
  // 초록이 된다.
  expect(앞.셸행.레인).toBe(14);

  // 폭 핸들은 사이드바의 **오른쪽 가장자리**에 얹힌 5px 띠다. work 화면에는 작업 패널에도
  // 같은 핸들이 있으므로(aside 둘) 구획 헤더를 들고 있는 쪽으로 좁힌다 — 그것이 사이드바다.
  const sidebar = page
    .locator("aside")
    .filter({ has: page.getByRole("button", { name: MAIN_HEADER, exact: true }) });
  const box = (await sidebar
    .locator('[title="드래그로 폭 조절 · 더블클릭으로 기본 폭"]')
    .boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, y, { steps: 5 });
  await page.mouse.up();

  const 뒤 = { 셸행: await 잰다(plainWork), 빈행: await 잰다(pinnedWork) };
  // 실제로 좁아졌는가 — 이것이 없으면 아래 전부가 「끌지도 못했다」를 초록으로 읽는다.
  expect(뒤.셸행.둘째줄).toBeLessThan(앞.셸행.둘째줄);

  for (const 자리 of ["셸행", "빈행"] as const) {
    const 줄어든만큼 = 앞[자리].둘째줄 - 뒤[자리].둘째줄;
    expect(줄어든만큼).toBeGreaterThan(0);
    // **레인은 그대로다.**
    expect(뒤[자리].레인).toBe(앞[자리].레인);
    // **줄인 만큼이 제목과 둘째 줄에 그대로 간다.** 레인이 함께 줄면 여기가 어긋난다.
    expect(뒤[자리].제목).toBeCloseTo(앞[자리].제목 - 줄어든만큼, 1);
  }

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

  // **`…`이 아니다**(결정 9·18). 끊는 것은 오른쪽 끝 12px 그라디언트이고, 마스크는 상시라
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

  // **hover하면 흐른다.** 200ms 뒤에 시작해 **넘침 + 페이드 폭**만큼 가는데, 그 12px이
  // 없으면 다 흐른 뒤에도 마지막 글자가 페이드에 먹힌다(결정 11).
  await 긴제목.hover();
  // **넘침을 hover 중에 다시 잰다.** hover에 핀이 서면서 제목 상자가 `PIN_WIDTH`만큼 줄고,
  // 흐르는 거리는 **그 줄어든 상자** 기준이다 — 거리를 CSS가 `100cqw`로
  // 푸는데(결정 10) 그 `cqw`가 hover 상태의 폭이기 때문이다. 두 값이 갈리는 것을 함께 세는
  // 것은, 안 갈리면 핀이 격자 밖으로 돌아가 글자를 덮고 있다는 뜻이라서다(핀 검사와 한 쌍).
  const hover넘침 = await overflowOf(긴제목);
  expect(hover넘침).toBe(넘침 + PIN_WIDTH);
  const 거리 = hover넘침 + TITLE_FADE;

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
  // 고르기 때문이고(결정 10), 페이드 폭을 그냥 빼면 여기가 12px까지 흐른다.
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
  // 위 검사와 같은 이유로 hover 중에 다시 잰다.
  const hover넘침 = await overflowOf(긴제목);
  expect(hover넘침).toBe(좁힌뒤 + PIN_WIDTH);

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
    .poll(async () => Math.abs((await shiftOf(긴제목)) + (hover넘침 + TITLE_FADE)) <= 2, {
      timeout: 8000,
      message: "좁힌 뒤의 넘침에 흐르는 거리가 안 맞는다",
    })
    .toBe(true);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 4 — **nav `Terminal`도 같은 어휘를 쓴다.** 최상위 셸에서 claude가 돌면 거기에도
// 로고가 뜬다: 무리가 하나뿐이라 숫자가 하나로 서는 것이고 규칙은 일반화될 뿐 안 깨진다.
//
// **그리고 이제 그 규격이 사는 자리는 여기 하나뿐이다** — 판 05 결정 13의 「두 자리」가 한
// 자리가 됐다(이 판 결정 5). work 행의 오른쪽 끝 칸이 사라졌으므로, 이 저장소가 `SidebarItem`
// 주석에 **계약으로** 적어 둔 「구획 헤더의 개수와 같은 규격이라, 한 컬럼에 세로로 붙어 서는
// 둘이 다른 무게로 읽히지 않는다」를 실측으로 재는 자리도 여기로 옮겨 온다. 판 05는 그것을
// work 행에서 쟀는데, 그 행에는 이제 잴 것이 없다 — **계약이 사라진 것이 아니라 자리가
// 하나로 준 것이라, 검사도 남은 그 자리로 따라간다.**
//
// **이 층에서만 보인다** — `Sidebar.tsx`는 `terminal-store`를 물어 정적 마크업 seam이 닿지
// 않고(Sidebar.test.tsx 머리말), 최상위 셸은 이 화면의 진입 이펙트(`ensureShell`)를 태워야
// 생긴다.
test("최상위 셸의 로고가 nav `Terminal`에 서고, 그 숫자가 구획 헤더와 같은 x에 선다", async ({
  page,
}) => {
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

  // **숫자로 집는다.** 재려는 것이 상자가 아니라 그 안의 옅은 숫자이고, 두 자리가 같은
  // 규격(11.5px · tabular)을 쓰는 것이 지키려는 그 계약이다.
  const 오른끝 = async (target: Locator) => {
    const box = (await target.boundingBox())!;
    return Math.round(box.x + box.width);
  };
  const 헤더개수 = page
    .getByRole("button", { name: MAIN_HEADER, exact: true })
    .locator("span.tabular-nums");
  const 메타숫자 = navRow.locator("span.tabular-nums");
  await expect(메타숫자).toHaveCount(1);
  expect(await 오른끝(메타숫자)).toBe(await 오른끝(헤더개수));

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
