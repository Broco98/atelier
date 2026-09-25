import { expect, test, type Locator, type Page } from "./evidence";
import { FIXTURE_SHELL_NAME, MAIN_HEADER, PINNED_HEADER, WORKS } from "./fixtures";
import {
  awaitSpawned,
  installFixtureBackend,
  markAttention,
  markRunning,
  openShell,
  readIpcRecord,
  unknownIpcCalls,
  띠,
  레인,
} from "./harness";

// 사이드바 작업 목록은 어느 화면에나 있으므로 목록 화면에서 본다 — Works 화면으로 들어가면
// 그 화면이 부르는 것까지 하네스가 답해야 하는데, 여기서 볼 것은 사이드바뿐이다.
//
// 정적 마크업 seam(SidebarWorkList.test.tsx)이 못 보는 것만 여기서 본다: hover에만 뜨는
// 것(결정 85)은 진짜 CSS가 있어야 하고, 핀을 눌러 나가는 쓰기와 접힘이 다음 실행까지
// 남는 것(결정 108)은 이벤트와 localStorage가 있어야 한다.

const [pinnedWork, plainWork] = WORKS;

// 오른쪽 끝 페이드의 폭이자 **마퀴가 넘침 위에 더 가는 거리**다(결정 11) — 그만큼 더 가지
// 않으면 다 흐른 뒤에도 마지막 글자가 페이드에 먹힌다. `index.css`의 `--title-fade`와 같은 수다.
const TITLE_FADE = 12;

/**
 * 행 둘째 줄에서 마크·말·경과가 서로 떨어지는 거리. 목업 정본(`행-신호-세-안.html`의
 * `.row2 .l2 { gap: 6px }`)의 수이고, 화면에서는 `gap-1.5`가 그 값이다.
 */
const SUBROW_GAP = 6;

// 흐르는 **속도**(px/s) — `WorkSectionList.tsx`의 `MARQUEE_SPEED`와 같은 수다. 상수인 것은
// 지속시간이 아니라 **이 값**이고(결정 11), 그래서 넘침이 다른 두 자리에서 같은 값이 나와야
// 한다. 실측이 들어야 하는 밴드는 ±12%다 — `speedOf`가 잰 시각으로 나누므로 이만큼 좁힐 수
// 있고, 좁아야 고정 지속시간이 두 자리를 다 통과하지 못한다.
const MARQUEE_SPEED = 50;
const 속도밴드 = [MARQUEE_SPEED * 0.88, MARQUEE_SPEED * 1.12];

// 핀 상자의 폭(`icon-button`). **행은 hover에 제목 상자가 정확히 이만큼 줄어든다** — 핀이
// 2열에 서면서 빈 칸이 처음으로 폭을 갖기 때문이다(WorkSectionList의 핀 주석). 판 05에서는
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

/** 사이드바를 `px`만큼 **좁힌다.**
 *
 * 폭 핸들은 사이드바의 오른쪽 가장자리에 얹힌 5px 띠다. work 화면에는 작업 패널에도 같은
 * 핸들이 있으므로(aside 둘) 구획 헤더를 든 쪽으로 고른다 — 그것이 사이드바다. 이 여섯 줄이
 * 한때 이 파일 두 자리에 복사로 있었는데, 핸들 규격이 바뀌는 날 고칠 자리가 둘이 된다. */
const 좁힌다 = async (page: Page, px: number) => {
  const sidebar = page
    .locator("aside")
    .filter({ has: page.getByRole("button", { name: MAIN_HEADER, exact: true }) });
  const box = await sidebar
    .locator('[title="드래그로 폭 조절 · 더블클릭으로 기본 폭"]')
    .boundingBox();
  if (!box) throw new Error("사이드바 폭 핸들의 상자를 못 읽었다");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - px, y, { steps: 5 });
  await page.mouse.up();
};

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
    `set_work_pinned {"mode":"atelier","slug":"${plainWork.slug}","pinned":true}`,
  );
  // **핀은 그 work를 열지 않는다.** 행 전체가 눌리게 되면서(아래 검사) 이 버튼의 클릭도
  // 행 상자로 올라갈 수 있게 됐다 — 끊는 것이 `stopPropagation` 한 줄이고, 그것이 빠지면
  // 핀을 누를 때마다 화면이 그 work로 넘어간다.
  await expect(page).toHaveURL(/\/projects/);
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

// **행의 아래쪽을 눌러도 그 work로 간다.** 행이 두 줄(55px)이 되면서 이 자리에 처음으로
// 「배경은 덮이는데 눌러도 아무 일이 없는 죽은 자리」가 날 수 있게 됐다: 이름 버튼이 첫 줄
// 26px만 덮으면 아래 29px이 어느 버튼에도 안 속하는데, 배경(선택·hover)은 55px 전체에
// 깔린다. `WorkSectionList.tsx`가 두 자리에서 금지 사유로 드는 모양이 바로 그것이고
// (행 상자 주석 · 이름 버튼 주석), 게다가 그 29px은 프로젝트 이름·종류·수가 실리는
// **내용이 있는 줄**이라 사람이 가장 누르기 쉬운 자리다 — 행의 절반 이상이 그렇게 되는 것은
// 판 05에는 없던 회귀다(그때는 이름 버튼이 `h-8`로 행 전체를 덮었다).
//
// **이 층에서만 보인다** — 좌표로 눌러야 나고, 정적 마크업에는 클릭도 픽셀도 없다.
test("행의 둘째 줄을 눌러도 그 work로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  const 행 = page.getByRole("button", { name: pinnedWork.title, exact: true }).locator("xpath=..");
  const box = (await 행.boundingBox())!;
  // 행 55px 중 아래 29px이 둘째 줄이다 — 그 한가운데를 누른다. 위 14px은 여전히 이름
  // 버튼이므로, 이 좌표가 아니면 이 검사는 아무것도 새로 재지 않는다.
  expect(box.height).toBe(55);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 14);

  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}`));

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
//
// **계산은 색 문자열 둘을 받는 자리로 갈려 있다.** 아래 `대비를잰다`는 글자색을 재는데,
// 레인의 점은 **배경색**을 재기 때문이다(#203) — 한쪽 모양에 매어 두면 점을 재는 자리가
// 이 계산을 한 벌 더 갖는다.
const 색대비 = (page: Page, 앞: string, 뒤: string) =>
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
  );

const 대비를잰다 = (page: Page, 글자: Locator, 배경: Locator) =>
  Promise.all([
    글자.evaluate((el) => getComputedStyle(el).color),
    배경.evaluate((el) => getComputedStyle(el).backgroundColor),
  ]).then(([앞, 뒤]) => 색대비(page, 앞, 뒤));

/** 다크·라이트 팔레트를 손으로 갈아 끼운다 — 앱에 아직 켜는 손잡이가 없다. */
const 팔레트 = (page: Page, dark: boolean) =>
  page.evaluate(
    (dark) => document.documentElement.classList.toggle("dark", dark),
    dark,
  );

test("둘째 줄 글자는 사이드바 배경에서 대비 4.5를 넘는다 — 세 갈래, 라이트·다크", async ({
  page,
}) => {
  await installFixtureBackend(page);
  // **셸이 있는 행과 없는 행을 함께 본다.** 둘째 줄은 갈래가 셋이고(종류·수 / 프로젝트
  // 이름 / 셸이 스스로 한 말) 색을 정하는 자리도 여럿이다 — `WorkSectionList.tsx`의 상자가
  // 바닥을 깔고, `ShellMeta`와 `SignalLine` 안쪽이 그 위에서 자기 색을 다시 고른다.
  // 프로젝트 갈래만 재면 **가장 자주 서는 갈래**가 통째로 안 재어진 채 남는다: 셸은 열려
  // 있는데 우리가 아는 것은 안 도는 상태가 이 목록의 기본값이고(`shell-meta.tsx`), 그 행의
  // 둘째 줄에 서는 것은 `⌨ N`뿐이다. 셸이 서는 것은 work 화면뿐이라(`ensureShell`) 여기로
  // 들어온다.
  //
  // **셋째 갈래가 이 판에서 생겼다**(#203). 스토리 24가 이 자리의 수용 기준이고
  // (「둘째 줄 글자가 지금의 오른쪽 메타보다 또렷하길 원한다 — 자리만 옮기고 읽기 어려움은
  // 그대로인 일이 없다」), 그 갈래를 그물 밖에 두면 이 판이 고치려던 3.0짜리 한 줄을 이 판이
  // 다시 만들어도 아무 층도 말하지 않는다. 부르는 말과 **도는 중의 말**을 따로 재는 것은
  // 색을 고르는 가지가 그 둘로 갈리기 때문이다(`shell-signal.tsx`의 `TONE`).
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  // work 화면은 aside가 둘이다(사이드바 · 작업 패널) — 구획 헤더를 든 쪽이 사이드바다.
  const aside = page
    .locator("aside")
    .filter({ has: page.getByRole("button", { name: MAIN_HEADER, exact: true }) });
  const 프로젝트 = page.locator(`[data-subrow="${pinnedWork.slug}"]`);
  // 먼저 잴 것이 실제로 서 있는가 — 빈 줄의 색을 재도 수는 나온다.
  await expect(프로젝트).toHaveText(pinnedWork.projects.join(" · "));
  // 셸 갈래에서 **글리프를 실제로 칠하는 자리**는 무리 상자다(바깥 상자의 색을 무리가 다시
  // 덮는다). 무리가 하나임을 먼저 세어 두면 구조가 바뀌는 날 이 검사가 엉뚱한 상자를
  // 재면서 조용히 초록이 되지 않는다.
  const 무리 = page.locator(`[data-shells="${plainWork.slug}"] > span > span`);
  await expect(무리).toHaveCount(1);
  const 말 = page.locator(`[data-subrow="${plainWork.slug}"] [data-fade]`);

  const 배경색 = () => aside.evaluate((el) => getComputedStyle(el).backgroundColor);
  const 조용한둘 = async () => ({
    프로젝트: await 대비를잰다(page, 프로젝트, aside),
    무리: await 대비를잰다(page, 무리, aside),
  });
  /** 부르는 말과 도는 중의 말을 **차례로** 세워 각각 잰다. 색을 고르는 가지가 둘이다. */
  const 말둘 = async (이름: string) => {
    await 기다리게한다(page, "테스트 셋 통과");
    await expect(말).toHaveText("테스트 셋 통과");
    expect(await 대비를잰다(page, 말, aside), `${이름} · 부르는 말`).toBeGreaterThanOrEqual(4.5);
    // 프롬프트를 보내면 도는 중이 되고 직전 말이 남는다(전이 표의 `start`).
    await markAttention(page, { agent: "claude", event: "UserPromptSubmit" });
    await expect(레인(page, plainWork.slug).locator('[data-signal="working"]')).toHaveCount(1);
    expect(await 대비를잰다(page, 말, aside), `${이름} · 도는 중의 말`).toBeGreaterThanOrEqual(4.5);
  };

  const 라이트 = await 배경색();
  for (const [자리, 수] of Object.entries(await 조용한둘())) {
    expect(수, `라이트 · ${자리}`).toBeGreaterThanOrEqual(4.5);
  }

  // 다크 팔레트. 앱에 아직 켜는 손잡이가 없어 클래스를 손으로 붙인다 — `index.css`의
  // `.dark` 블록이 곧 그 팔레트의 정본이다.
  await 팔레트(page, true);
  // **팔레트가 정말 바뀌었는지를 먼저 센다.** `.dark`가 안 먹으면(선택자가 바뀌거나 토큰이
  // 다른 자리로 옮겨 가면) 아래가 라이트 값을 다시 재는데, 라이트는 이미 4.5를 넘으므로
  // **조용히 초록**이 된다 — 이 저장소가 금지하는 fail-open이고, 손잡이가 생기는 날
  // 「이 줄이 그 팔레트를 이미 지키고 있었다」는 말이 그때 처음 거짓으로 드러난다.
  expect(await 배경색()).not.toBe(라이트);
  for (const [자리, 수] of Object.entries(await 조용한둘())) {
    expect(수, `다크 · ${자리}`).toBeGreaterThanOrEqual(4.5);
  }

  // **셋째 갈래는 맨 뒤다** — 셸이 말하기 시작하면 종류·수 갈래가 그 행에서 물러난다.
  await 말둘("다크");
  await 팔레트(page, false);
  await 말둘("라이트");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// **상태 축이 처음 눈에 보이는 자리**(#203). 값이 프런트까지 오는 길은 이미 서 있고
// (`shell-attention.spec.ts`) 여기서 보는 것은 **그 값이 행에 그려지는가**다.
//
// 이 층이 유일한 그물인 것 셋: 진짜 스토어를 한 바퀴 도는 것(이벤트 → 셀렉터 → 행), 색이
// 실제로 칠해지는 것, 링이 실제로 도는 것. 마크업 seam은 「클래스가 붙었다」까지만 본다.

/**
 * 본문을 문서로 옮겨 **그 셸을 안 보는 상태로** 만든다. 셸은 그대로 살아 있고 칸도 켜진 채다.
 *
 * **초록을 세우려면 이 줄이 필요하다**(#205 · 결정 7). 그 셸을 보고 있는 동안 온 완료는 그
 * 순간 「봤다」가 되어 화면에 안 선다 — 사람이 이미 보고 있으니 그것이 맞다. 그래서 「안 본
 * 완료」를 재는 검사는 **안 보는 자리에서** 재야 하고, 그 자리가 이 앱에서는 문서다.
 * 앰버는 이 줄과 무관하다(「봤다」로 안 꺼진다).
 */
const 셸에서눈을뗀다 = async (page: Page) => {
  await page.locator('[data-tab="spec"]').click();
  await expect(page).not.toHaveURL(/tab=terminal/);
};

/** 그 셸이 **나를 기다린다**고 말하게 한다 — claude `Stop`이 그 길이다(스펙 전이 표). */
const 기다리게한다 = (page: Page, message: string, 지난ms = 0) =>
  markAttention(page, {
    agent: "claude",
    event: "Stop",
    at: Date.now() - 지난ms,
    payload: { last_assistant_message: message },
  });

test("부르는 행은 레인·둘째 줄·이름으로 함께 말한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  const lane = 레인(page, plainWork.slug);
  const subrow = page.locator(`[data-subrow="${plainWork.slug}"]`);
  // **먼저 없음을 센다.** 이것이 없으면 아래 단언들이 「원래 그렇던 것」으로도 초록이 된다 —
  // 그리고 이 줄이 곧 「값이 없으면 work 상태 아이콘이 되돌아온다」의 실물 확인이다(스토리 19).
  await expect(lane.locator("svg")).toHaveCount(1);
  await expect(lane.locator("[data-signal]")).toHaveCount(0);

  await markRunning(page, "claude");
  await 기다리게한다(page, "테스트 셋 통과\n커밋할까요?", 125_000);

  // **레인이 앰버 점으로 갈린다.** work 상태 아이콘은 그 자리에서 물러난다 — 둘이 함께
  // 서면 14px 한 칸이 두 말을 한다.
  await expect(lane.locator('[data-signal="waiting"]')).toHaveCount(1);
  await expect(lane.locator("svg")).toHaveCount(0);

  // **둘째 줄이 셸의 마지막 말과 경과를 싣는다**(결정 4·5). 말은 `last_assistant_message`의
  // **첫 줄**이고, 어댑터가 그것을 접었다는 사실까지 이 한 줄이 딛는다.
  await expect(subrow).toHaveText("테스트 셋 통과2m");
  // 마크는 그 자리에 남는다 — 「누구」를 말하는 자리다(판 04 결정 15).
  await expect(subrow.getByRole("img", { name: "claude" })).toHaveCount(1);

  // **세 조각이 서로 붙지 않는다**(목업 `행-신호-세-안.html`의 `.row2 .l2 { gap: 6px }`).
  // 마크 글리프는 `viewBox 0 0 16 16`을 거의 꽉 채우므로 간격이 0이면 로고가 첫 글자에
  // 그대로 닿고, `통과2m`처럼 말과 경과가 한 낱말로 읽힌다 — 바로 위 띠는 **같은 어휘**를
  // 9px 간격으로 그리므로, 여기만 0이면 같은 말이 두 자리에서 다른 리듬으로 선다.
  const 상자 = async (one: Locator) => (await one.boundingBox())!;
  const 마크 = await 상자(subrow.getByRole("img", { name: "claude" }));
  const 말 = await 상자(subrow.locator("[data-fade]"));
  const 경과 = await 상자(subrow.locator("[data-elapsed]"));
  expect(말.x - (마크.x + 마크.width)).toBeGreaterThanOrEqual(SUBROW_GAP);
  expect(경과.x - (말.x + 말.width)).toBeGreaterThanOrEqual(SUBROW_GAP);

  // **말 상자가 남는 폭까지 자란다 — 페이드가 빈 자리에 떨어지게.** 마스크는 상시라
  // (`index.css`의 `[data-fade]`, 결정 12) 상자가 글자 폭에 딱 붙어 앉으면 오른쪽 끝 12px이
  // **실제 글자** 위에 떨어져 끝 한 글자가 늘 유령이 된다 — 넘치지도 않는 짧은 말이 잘린
  // 것처럼 읽히고, 이 판을 시작한 말이 하필 「이 한 줄이 가독성이 안 좋다」였다. 띠와 목업은
  // 같은 상자를 남는 폭까지 늘려 그 램프가 여백에 떨어지게 한다.
  //
  // 재는 것은 `scrollWidth`가 아니라 **글자 자체의 폭**이다 — 안 넘치는 상자는 `scrollWidth`가
  // `clientWidth`와 같아져 「얼마나 남았나」를 못 말한다.
  const 여유 = await subrow.locator("[data-fade]").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return el.getBoundingClientRect().width - range.getBoundingClientRect().width;
  });
  expect(여유).toBeGreaterThanOrEqual(TITLE_FADE);

  // **이름에 상태가 붙는다**(스토리 33) — 점은 `aria-hidden`이라 이 이름이 유일한 말이다.
  //
  // **목록 안으로 좁혀 집는다.** 알림 띠의 줄이 **같은 이름**을 쓰기 때문이다
  // (#204, 결정 8) — 부르는 셸이 있으면 그 줄도 함께 서므로 화면 전체에서 세면 둘이다.
  // 좁히지 않으면 이 줄이 「행에 이름이 붙었다」가 아니라 「어딘가에 하나 있다」를 재게 된다.
  await expect(
    page
      .locator("[data-worklist]")
      .getByRole("button", { name: `${plainWork.title} — 나를 기다림`, exact: true }),
  ).toHaveCount(1);

  // **hover에 핀이 떠도 레인과 둘째 줄이 남는다**(판 05 결정 6 뒤집음). 아래 hover 검사가
  // 같은 것을 조용한 행에서 재는데, **띄우려는 것이 실제로 서 있을 때** 한 번 더 봐야 뜻이
  // 있다 — 이 판이 무의미해지는 자리가 바로 여기다.
  await subrow.locator("xpath=..").hover();
  await expect(page.getByRole("button", { name: `${plainWork.title} 고정` })).toHaveCSS(
    "opacity",
    "1",
  );
  await expect(lane.locator('[data-signal="waiting"]')).toHaveCount(1);
  await expect(lane).toHaveCSS("opacity", "1");
  await expect(subrow).toHaveCSS("opacity", "1");

  // **좁혀도 레인이 먼저 죽지 않는다**(스토리 34). 아래 드래그 검사가 조용한 행에서 같은
  // 것을 재지만, 그때 레인에 선 것은 14px 아이콘이다 — 8px 점은 12px만 줄어도 사라지므로
  // 부르는 행에서 한 번 더 본다.
  const 앞 = { 레인: (await lane.boundingBox())!.width, 줄: (await subrow.boundingBox())!.width };
  await 좁힌다(page, 40);
  expect((await subrow.boundingBox())!.width).toBeLessThan(앞.줄);
  expect((await lane.boundingBox())!.width).toBe(앞.레인);
  await expect(subrow).toHaveText("테스트 셋 통과2m");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **앰버·초록이 라이트·다크 사이드바 배경에서 다 또렷하다**(결정 3·31).
//
// **재는 것이 둘이다: 대비와 「팔레트가 갈렸는가」.** 대비만 재면 다크 팔레트를 통째로
// 빠뜨려도 초록이 된다 — 라이트 앰버는 다크 사이드바에서 5.63으로 오히려 **올라가기**
// 때문이다(실측). 결정 3의 표는 색을 **넷**으로 못박았으므로(라이트 `amber-600`·`green-700`,
// 다크 `amber-400`·`green-400`) 두 팔레트의 색이 서로 다른 것 자체가 계약이고, 그 한 줄이
// 이 검사의 fail-closed 지점이다.
//
// **바닥이 라이트에서 2.9인 것은 색을 알고 골랐기 때문이다.** 앰버는 라이트 사이드바에서
// **2.98**이다(실측) — 그림 요소의 바닥 3.0에 0.02 모자란다. 목업에서 사람이 눈으로 고른
// 색이고, 점은 3px 후광이 면적을 벌어 그 자리를 메운다. 바닥을 4.5로 올리면 이 검사는
// **결정을 어기라고 요구하는 검사**가 된다. 초록은 같은 배경에서 4.69다.
//
// **그러니 이 바닥은 「통과」가 아니라 「사람이 아직 안 봤다」이다.** 2.9는 기준(그림 요소
// 3.0)에 못 미치는 것을 **알고** 고정한 값이라, 이 줄이 초록인 것만으로 「앰버가 라이트에서
// 또렷하다」가 닫히지 않는다 — 그 물음은 `spec/물음-둘째-줄의-색.md`에 열려 있고, 사람이
// 「점도 한 단 어둡게(`amber-700`, 4.69)」로 정하면 여기 바닥이 3.0 이상으로 올라간다.
// **말**의 색은 이 물음 밖이다 — 그쪽은 이미 `-ink` 토큰으로 갈라져 4.5를 넘는다(옆 검사).
//
// 다크는 둘 다 10을 넘으므로(10.74 · 10.29) 바닥이 4.5여도 여유가 있다 — 그 바닥이 라이트
// 팔레트가 다크로 새는 갈래를 하나 더 잡는다(그때 초록이 3.57로 떨어진다).
test("앰버·초록이 라이트·다크 사이드바 배경에서 또렷하다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await 셸에서눈을뗀다(page);

  const aside = page
    .locator("aside")
    .filter({ has: page.getByRole("button", { name: MAIN_HEADER, exact: true }) });
  const lane = 레인(page, plainWork.slug);
  const 배경색 = () => aside.evaluate((el) => getComputedStyle(el).backgroundColor);
  const 점색 = async (kind: string) => {
    const dot = lane.locator(`[data-signal="${kind}"]`);
    await expect(dot).toHaveCount(1);
    return dot.evaluate((el) => getComputedStyle(el).backgroundColor);
  };

  // 앰버와 초록을 차례로 세워 둘의 점 색을 받는다. 초록을 만드는 것은 **세션 종료**다
  // (스펙 전이 표) — 턴 종료가 아니다.
  const 점색둘 = async () => {
    await 기다리게한다(page, "커밋할까요?");
    const 앰버 = await 점색("waiting");
    await markAttention(page, {
      agent: "claude",
      event: "SessionEnd",
      payload: { reason: "logout" },
    });
    return { 앰버, 초록: await 점색("done") };
  };

  // **앰버와 초록이 서로 다른가**를 팔레트마다 센다. 대비만 재면 이 축의 핵심 불변조건이
  // 어느 층에도 안 남는다 — `--signal-done`을 앰버 값으로 갈아 끼워도 라이트 대비는
  // 2.98 ≥ 2.9로 통과하고 다크 초록은 그대로라 아래 「라이트 색이 그대로다」도 통과하며,
  // 마크업 seam은 클래스 이름(`bg-wait`/`bg-done`)만 보므로 역시 안 잡는다. 그러면
  // 「기다림과 안 본 완료가 화면에서 갈린다」(결정 3)가 전 층에서 안 재어진 채 남는다.
  // 결정 3의 표가 색을 넷으로 못박았으므로 **그 넷이 서로 다른 것 자체가 계약**이고, 그
  // 논리는 팔레트 사이(아래 「라이트 색이 그대로다」)와 팔레트 안쪽에 똑같이 선다.
  const 갈렸나 = (색둘: { 앰버: string; 초록: string }, 이름: string) =>
    expect(색둘.앰버, `${이름} · 앰버와 초록이 같은 색이다`).not.toBe(색둘.초록);

  const 라이트배경 = await 배경색();
  const 라이트 = await 점색둘();
  갈렸나(라이트, "라이트");
  for (const [자리, 색] of Object.entries(라이트)) {
    expect(await 색대비(page, 색, 라이트배경), `라이트 · ${자리}`).toBeGreaterThanOrEqual(2.9);
  }

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  // **팔레트가 정말 바뀌었는지를 먼저 센다** — 안 먹으면 아래가 라이트 값을 다시 재고
  // 조용히 초록이 된다(옆 대비 검사와 같은 근거).
  const 다크배경 = await 배경색();
  expect(다크배경).not.toBe(라이트배경);
  const 다크 = await 점색둘();
  갈렸나(다크, "다크");
  for (const [자리, 색] of Object.entries(다크)) {
    expect(await 색대비(page, 색, 다크배경), `다크 · ${자리}`).toBeGreaterThanOrEqual(4.5);
    // **다크는 한 단 밝은 색이다**(결정 3의 표). 라이트 색이 그대로 새면 여기가 터진다.
    expect(색, `다크 · ${자리} — 라이트 색이 그대로다`).not.toBe(라이트[자리 as "앰버" | "초록"]);
  }

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **초록 행의 둘째 줄도 마크·말·경과 셋을 낸다**(티켓 #203 · 구현-스펙의 둘째 줄 규칙).
//
// **`markRunning`을 한 번도 안 부르는 것이 이 검사의 전부다.** 초록을 만드는 길은 스펙 전이
// 표에 둘뿐이고(세션 종료 · 벨) **둘 다 그 순간 그 PTY에 도는 에이전트가 없다** — 세션이
// 끝났다는 것은 프로세스가 나갔다는 뜻이고, 벨은 정의상 아는 마크가 없을 때만 초록이 된다.
// 그래서 마크를 「지금 도는 것」에서만 뽑으면 초록 행은 **늘** 말과 경과 둘뿐이 되는데,
// 도는 것을 손으로 넣어 주는 검사는 그 사라짐을 한 번도 못 본다(마크업 seam이 그 모양이다).
// 목업의 초록 예시가 바로 `codex` 셸의 「PR #174 열었다」라 정본과 화면이 갈리는 자리다.
test("초록 행도 마크·말·경과 셋을 낸다 — 도는 것이 없어도", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await 셸에서눈을뗀다(page);

  const subrow = page.locator(`[data-subrow="${plainWork.slug}"]`);
  // 턴이 끝나 말이 남고, 그 뒤 세션이 끝난다 — 초록을 만드는 것은 **세션 종료**다.
  // 시각을 둘 다 손으로 주는 것은 경과가 그 값에서 나오기 때문이다(둘째 줄의 셋째 조각).
  await markAttention(page, {
    agent: "codex",
    event: "Stop",
    at: Date.now() - 125_000,
    payload: { last_assistant_message: "PR #174 열었다" },
  });
  await markAttention(page, {
    agent: "codex",
    event: "SessionEnd",
    at: Date.now() - 125_000,
    payload: {},
  });

  await expect(레인(page, plainWork.slug).locator('[data-signal="done"]')).toHaveCount(1);
  await expect(subrow).toHaveText("PR #174 열었다2m");
  // **이 한 줄이 이 검사의 이유다.** 도는 것이 없으므로 마크의 재료는 「그 상태를 말한
  // 에이전트」뿐이고, 그것을 상태가 안 들고 다니면 여기서 0이 된다.
  await expect(subrow.getByRole("img", { name: "codex" })).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **링은 CSS로 돌고, 움직임을 끈 사람에게는 정지한 완전한 링이 선다**(스토리 30).
//
// **이 층이 유일한 그물이다.** 마크업 seam은 클래스 이름까지만 보고, 「자바스크립트 타이머가
// 없다」는 소스 스캔은 **안 도는 링**도 초록으로 넘긴다 — 실제로 도는지와, 움직임을 껐을 때
// 머리 색이 원주와 같아지는지는 계산된 스타일로만 난다.
test("링은 CSS로 돌고, 움직임을 끄면 멈춘 완전한 링이 된다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  // 프롬프트를 보낸 순간이 「도는 중」이다(스펙 전이 표의 `start`).
  await markAttention(page, { agent: "claude", event: "UserPromptSubmit" });
  const ring = 레인(page, plainWork.slug).locator('[data-signal="working"]');
  await expect(ring).toHaveCount(1);

  const 재본다 = () =>
    ring.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        name: style.animationName,
        timing: style.animationTimingFunction,
        duration: style.animationDuration,
        머리: style.borderTopColor,
        원주: style.borderRightColor,
      };
    });

  const 돌때 = await 재본다();
  expect(돌때.name).not.toBe("none");
  // **`steps(12)` 1초다**(구현 결정 4) — 매끄러운 회전이 아니라 열두 칸으로 끊어 돈다.
  expect(돌때.timing).toContain("steps(12");
  expect(돌때.duration).toBe("1s");
  // 머리만 앱 `primary`이고 원주는 옅은 색이다 — 둘이 같으면 도는 것이 안 보인다.
  expect(돌때.머리).not.toBe(돌때.원주);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const 멈출때 = await 재본다();
  expect(멈출때.name).toBe("none");
  // **완전한 링이다** — 머리가 남으면 「멈춘 스피너」로 읽혀 사람이 「굳었나」를 묻는다.
  expect(멈출때.머리).toBe(멈출때.원주);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// **알림 띠**(#204 · 이름과 ⌄는 `sidebar-active-band` 결정 13·15). 값을 내는 자리(`bandRows`)와 그리는 자리(`AttentionBand`)는
// 각자 자기 seam이 보고, 여기서만 보이는 것을 잰다: 띠가 **서고 사라지는 것**, 띠 이름이
// 상태 이름과 갈리는 것, ⌄/⌃가 펼치고 접는 것과 그 툴팁, 펼침이 어디에도 안 적히는 것,
// 줄을 눌러 **다른 화면의 다른 탭**으로 가는 것, 그리고 좁혔을 때 무엇이 먼저 줄어드는가.
// 진짜 스토어·라우터·포커스·CSS가 있어야 나는 것들이다.

/**
 * 띠의 줄들 — 이름을 단 버튼 가운데 **펼침을 말하지 않는 것**만 센다.
 *
 * ⌄/⌃ 토글도 아이콘 버튼이라 이름을 `aria-label`로 단다(`sidebar-active-band` 결정 15). 이름 붙은 버튼을 다
 * 세면 토글이 줄로 세어져 「셋만 보인다」가 넷으로 읽힌다. 둘을 가르는 것은 `aria-expanded`다 —
 * 토글만 그것을 단다.
 */
const 띠줄들 = (page: Page) => 띠(page).locator("button[aria-label]:not([aria-expanded])");

/** 그 이름의 띠 줄. **띠 안으로 좁힌다** — 같은 이름이 사이드바 행에도 서기 때문이다. */
const 띠줄 = (page: Page, name: string) => 띠(page).getByRole("button", { name, exact: true });

/**
 * 띠의 ⌄/⌃ 토글이 **하나라도 있는가**를 셀 때만 쓴다. 이름은 펼침에 따라 바뀌므로
 * (「N개 더 보기」·「접기」) 「없다」를 이름으로 세면 다른 이름의 토글이 빠져나간다.
 * 서 있는 토글을 재는 검사는 역할과 이름으로 집는다.
 */
const 띠토글 = (page: Page) => 띠(page).locator("button[aria-expanded]");

/** 떠 있는 툴팁. 역할이 없어(S28) 표식으로 집는다 — 앱에 툴팁은 한 번에 하나만 선다. */
const 툴팁 = (page: Page) => page.locator("[data-slot=tooltip-content]");

/** 그 셸이 부르게 한다 — 줄마다 말을 달리 두어 어느 셸의 것인지 글자로 갈린다. */
const 부르게한다 = (page: Page, ptyId: number) =>
  markAttention(
    page,
    { agent: "claude", event: "Stop", at: Date.now(), payload: { last_assistant_message: `말 ${ptyId}` } },
    ptyId,
  );

/**
 * 셸 넷이 함께 부르는 work 화면을 세운다 — 띠가 ⌄로 접히는 가장 작은 수(`BAND_LIMIT` + 1)다.
 *
 * **포인터를 안 쓴다.** 칸은 ⌘T로 연다. 포커스로 뜨는 툴팁을 재는 검사가 이것을 딛는데,
 * Base UI는 macOS WebKit에서 「키보드로 옮긴 포커스인가」를 마지막 포인터·키 입력으로
 * 가른다 — 앞서 `pointerdown`이 한 번이라도 나면 `focus()`에 툴팁이 안 뜬다.
 */
const 넷이부르게한다 = async (page: Page) => {
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await 부르게한다(page, 1);
  // 칸을 연 순서가 곧 pty 번호다(`openShell`의 머리말) — `markAttention`이 그 pty가 앉기를 기다린다.
  for (const ptyId of [2, 3, 4]) {
    await page.keyboard.press("Meta+t");
    await 부르게한다(page, ptyId);
  }
  await expect(띠(page).locator("[data-band-count]")).toHaveText("4");
  await expect(띠줄들(page)).toHaveCount(3);
};

test("띠는 부를 때만 서고, 넷이면 셋만 보인 채 ⌄로 펼치고 ⌃로 접는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  // **먼저 없음을 센다** — 이 판이 약속한 「평소 화면이 지금과 같다」가 이 한 줄이다.
  await expect(띠(page)).toHaveCount(0);

  await 기다리게한다(page, "커밋할까요?");
  await expect(띠(page)).toHaveCount(1);
  await expect(띠줄(page, `${plainWork.title} — 나를 기다림`)).toHaveCount(1);
  // **하나뿐이면 셸 이름이 안 붙는다**(결정 5) — 제목만으로 어느 셸인지 정해진다.
  await expect(띠(page)).not.toContainText(FIXTURE_SHELL_NAME);

  // 셸을 더 세워 여럿이 함께 부르게 한다. 앱이 칸을 연 순서대로 띄우므로(`terminal-store`의
  // `loadFont`) 여기서 세는 pty 번호가 곧 「n번째 칸」이고, `openShell`은 그 pty가 앉을 때까지 기다린다.
  for (const ptyId of [2, 3]) {
    await openShell(page);
    await 부르게한다(page, ptyId);
  }

  // **셋이면 ⌄가 없다**(`sidebar-active-band` 스토리 23) — 눌러도 아무 일이 없는 버튼은 서지 않는다. 앵커는
  // 「띠가 셋을 다 세운 채 섰다」다: 띠가 안 떠도 토글은 0이라, 그것부터 세지 않으면 이
  // 「없다」가 아무것도 안 잰 채 초록이 된다.
  await expect(띠줄들(page)).toHaveCount(3);
  await expect(띠(page).locator("[data-band-count]")).toHaveText("3");
  await expect(띠토글(page)).toHaveCount(0);

  await openShell(page);
  await 부르게한다(page, 4);

  // **넷이면 셋만 보인다** — 헤더는 접힌 것까지 세어 넷이다.
  await expect(띠줄들(page)).toHaveCount(3);
  // **표식으로 집는다** — 자리(`.first()`)나 겉모습(`tabular-nums`)으로 고르면 헤더와 줄의
  // 순서가 바뀌거나 그 클래스가 떨어지는 날 재는 대상이 조용히 다른 것이 된다.
  await expect(띠(page).locator("[data-band-count]")).toHaveText("4");
  // **한 화면에서 넷이 부르니 줄마다 셸 이름이 붙는다**(결정 5). 위에서 「안 붙는다」를
  // 먼저 셌으므로 이 줄은 「원래 붙어 있던 것」으로는 초록이 안 된다.
  for (const at of [0, 1, 2]) {
    await expect(띠줄들(page).nth(at)).toContainText(FIXTURE_SHELL_NAME);
  }

  // **⌄ 하나가 선다**(`sidebar-active-band` 결정 15). 이름은 숨은 줄의 수를 말하고, 펼침 상태는 `aria-expanded`가
  // 말한다(같은 work 스토리 21). 글자가 없는 아이콘 버튼이라 이름은 `aria-label`에만 있다.
  const 더보기 = 띠(page).getByRole("button", { name: "1개 더 보기", exact: true });
  await expect(더보기).toHaveAttribute("aria-expanded", "false");
  await expect(더보기).toHaveText("");

  // **펼침이 어디에도 안 적힌다**(결정 5 — 「앱이 떠 있는 동안만」). 새로고침해 다시 재는
  // 대신 저장소를 통째로 견준다: 새로고침을 넘겨 살아남는 길이 그 둘뿐이라 여기서 아무것도
  // 안 늘었다는 것이 곧 「껐다 켜면 잊힌다」이고, 이쪽은 셸 넷을 다시 세울 필요가 없다.
  const 저장된것 = () =>
    page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const 펼치기전 = await 저장된것();

  await 더보기.click();
  await expect(띠줄들(page)).toHaveCount(4);
  // **같은 자리에 ⌃가 선다**(같은 work 스토리 19) — 이름이 「접기」가 되고 펼침이 참이 된다.
  const 접기 = 띠(page).getByRole("button", { name: "접기", exact: true });
  await expect(접기).toHaveAttribute("aria-expanded", "true");
  await expect(더보기).toHaveCount(0);
  expect(await 저장된것()).toBe(펼치기전);

  // **펼쳐도 바닥의 Settings가 살아남는다**(스토리 39 · 결정 8이 상한을 둔 그 근거).
  // 낮은 창에서만 나는 일이라 여기서 창을 낮춘다: 띠 상자에 세로 한도와 자기 스크롤이
  // 없으면, 형제가 전부 `shrink-0`이고 목록만 `flex-1 min-h-0`이라 목록이 0으로 무너진 뒤
  // Settings가 `aside`의 `overflow-hidden` 밖으로 잘린다.
  await page.setViewportSize({ width: 1100, height: 300 });
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  const 바닥 = (await settings.boundingBox())!;
  expect(바닥.y + 바닥.height).toBeLessThanOrEqual(300);

  // ⌃를 누르면 셋으로 돌아가고 ⌄가 다시 선다. ⌃는 굴러가는 띠 상자 안이라 낮은 창에서는
  // 굴러 내려가 있다 — `click`이 그 자리까지 굴려 누른다.
  await 접기.click();
  await expect(띠줄들(page)).toHaveCount(3);
  await expect(더보기).toHaveAttribute("aria-expanded", "false");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **띠 이름은 「알림」이고, 줄의 상태 말은 그대로다**(`sidebar-active-band` 결정 13 · 스토리 15·16). 둘이 갈린다는
// 것을 재는 자리가 이 검사 하나다 — 예전에는 띠 이름이 「안 본 완료」의 이름 **그 값**이라
// (`BAND_LABEL = SIGNAL_LABEL.done`) 「나를 기다림」 줄만 서 있어도 머리가 「확인할 것」이라
// 말했다. 안 본 완료 줄을 세우는 것은 그 두 말이 한 띠 안에 함께 서는 그림이라서다: 이름이
// 다시 같은 값을 들면 이 띠에서 「확인할 것」이 두 번 선다.
test("띠 이름은 「알림」이고, 안 본 완료 줄은 「확인할 것」을 말한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  // **보고 있는 셸에 도착한 완료는 그 순간 「봤다」가 된다**(결정 7) — spec으로 비켜서야
  // 안 본 완료가 띠에 선다.
  await 셸에서눈을뗀다(page);

  // 세션이 끝난 것이 초록이다(스펙 전이 표의 `end`).
  await markAttention(page, { agent: "claude", event: "SessionEnd", at: Date.now(), payload: {} });

  // 앵커: 띠가 서고 그 줄이 「확인할 것」을 말한다(줄의 상태 말은 그대로다).
  await expect(띠줄(page, `${plainWork.title} — 확인할 것`)).toHaveCount(1);
  // 머리는 「알림」이다. 글자로 집는 것은 머리가 누를 것이 없는 글자 상자라서다 — 역할이 없다.
  await expect(띠(page).getByText("알림", { exact: true })).toBeVisible();
  // **띠 안에 「확인할 것」이라는 글자는 없다.** 줄의 상태 말은 이름(`aria-label`)에만 있고
  // 눈에 보이는 글자는 제목·마크·경과다 — 여기 걸리는 것이 있다면 그것은 머리다.
  await expect(띠(page).getByText("확인할 것", { exact: true })).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **⌄의 도움말은 앱 툴팁이다**(`sidebar-active-band` 결정 15 · 스토리 20). 툴팁은 이름을 주지 않으므로(S28) 버튼의
// 이름과 툴팁의 글자가 같은지는 둘을 따로 읽어 견줘야 난다.
//
// **떠 있는 것의 애니메이션**도 여기서 처음 잰다(`sidebar-active-band` 결정 7). 규칙이 전역 한 곳이라(`index.css`의
// 동작 줄이기 블록) 부품 하나에서 재면 된다 — 판 3이 메뉴로 한 번 더 잰다.
test("⌄에 올리면 버튼 이름이 툴팁으로 뜨고, 동작 줄이기면 애니메이션 없이 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  await 넷이부르게한다(page);

  const 더보기 = 띠(page).getByRole("button", { name: "1개 더 보기", exact: true });
  // 앵커: 올리기 전에는 툴팁이 없다.
  await expect(더보기).toBeVisible();
  await expect(툴팁(page)).toHaveCount(0);

  await 더보기.hover();
  await expect(툴팁(page)).toHaveText(
    (await 더보기.getAttribute("aria-label"))!,
  );

  // **뜰 때 움직인다** — 100ms 페이드·확대. 계산된 스타일로 잰다: 이것이 곧 사람이
  // 보는 것이다.
  const 애니메이션 = () => 툴팁(page).evaluate((el) => getComputedStyle(el).animationName);
  expect(await 애니메이션()).not.toBe("none");

  // ⌃에 올리면 「접기」다. 누르면 툴팁이 닫히므로(Base UI 기본) 포인터를 한 번 비켰다 다시 올린다.
  await 더보기.click();
  const 접기 = 띠(page).getByRole("button", { name: "접기", exact: true });
  await expect(접기).toHaveAttribute("aria-expanded", "true");
  await page.mouse.move(0, 0);
  await expect(툴팁(page)).toHaveCount(0);
  await 접기.hover();
  await expect(툴팁(page)).toHaveText("접기");

  // **동작 줄이기면 애니메이션 없이 뜬다**(같은 work 스토리 10). 새로 띄운 툴팁에서 잰다 — 이미 떠
  // 있는 것만 재면 「뜰 때」가 아니라 「떠 있는 동안」을 잰 것이 된다.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(0, 0);
  await expect(툴팁(page)).toHaveCount(0);
  await 접기.hover();
  await expect(툴팁(page)).toHaveText("접기");
  expect(await 애니메이션()).toBe("none");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **키보드로 닿은 ⌄에도 툴팁이 뜨고, Enter로 펼친다**(`sidebar-active-band` 스토리 22). WebKit은 Tab이 버튼을
// 건너뛰므로(판 05 결정 7의 정정) 포커스는 `focus()`로 옮긴다.
//
// **이 검사는 포인터를 한 번도 안 쓴다**(`넷이부르게한다` 머리말) — Base UI가 macOS WebKit에서
// 「키보드 포커스인가」를 마지막 입력으로 가르므로, 앞서 누른 것이 있으면 이 툴팁은 안 뜬다.
test("포인터 없이 ⌄에 포커스하면 툴팁이 뜨고, Enter로 펼친다", async ({ page }) => {
  await installFixtureBackend(page);
  await 넷이부르게한다(page);

  const 더보기 = 띠(page).getByRole("button", { name: "1개 더 보기", exact: true });
  await expect(툴팁(page)).toHaveCount(0);

  await 더보기.focus();
  await expect(툴팁(page)).toHaveText("1개 더 보기");

  await page.keyboard.press("Enter");
  await expect(띠줄들(page)).toHaveCount(4);
  await expect(띠(page).getByRole("button", { name: "접기", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **줄을 누르면 그 work의 터미널로 가고 그 셸 탭이 켜진다**(결정 13의 넷째). spec을 보고
// 있었으면 터미널로 밀어내고, 분할 중이면 분할은 그대로 두고 탭만 바꾼다 — 사람이 안 시킨
// 레이아웃 변경(분할 자동 열기)은 기각됐다.
test("띠 줄을 누르면 그 셸 탭이 켜진다 — spec을 보고 있어도, 분할 중이어도", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  // 들어오면 뜨는 첫 칸(`ensureShell`)이 선 뒤에 연다 — `openShell`은 누르기 전의 칸 수를 센다.
  // pty가 앉기를 기다리지 않는다: 칸 순서대로 뜨는 것은 앱이 지킨다(`openShell`의 머리말).
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);
  await openShell(page);

  const tabs = page.locator('[data-tab="shell"]');
  const lit = (at: number) => tabs.nth(at).locator("button[aria-pressed]");
  // 부르는 것은 **둘째 칸**이고 켜 두는 것은 첫째다 — 그래야 「탭이 바뀌었다」가 보인다.
  await markAttention(
    page,
    { agent: "claude", event: "Stop", at: Date.now(), payload: { last_assistant_message: "커밋할까요?" } },
    2,
  );
  await lit(0).click();
  await expect(lit(0)).toHaveAttribute("aria-pressed", "true");

  // spec으로 옮긴다 — 주소에서 `tab`이 빠지는 것이 이 앱의 규칙이다(결정 14).
  await page.locator('[data-tab="spec"]').click();
  await expect(page).not.toHaveURL(/tab=terminal/);

  await 띠줄(page, `${plainWork.title} — 나를 기다림`).click();
  // **spec을 밀어낸다.**
  await expect(page).toHaveURL(/tab=terminal/);
  await expect(lit(1)).toHaveAttribute("aria-pressed", "true");

  // 분할을 켜고 첫 칸으로 되돌린 뒤 다시 누른다.
  const 분할 = page.locator('button[title="분할 켜기"]');
  await 분할.click();
  await expect(page).toHaveURL(/split=/);
  await lit(0).click();
  await expect(lit(0)).toHaveAttribute("aria-pressed", "true");

  await 띠줄(page, `${plainWork.title} — 나를 기다림`).click();
  // **분할이 그대로다** — 열은 둘 그대로이고 바뀐 것은 터미널 열의 탭뿐이다.
  await expect(page).toHaveURL(/split=/);
  await expect(lit(1)).toHaveAttribute("aria-pressed", "true");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **다른 work의 줄을 누르는 갈래**(결정 13의 넷째 · 결정 77·97). 위 검사가 미는 것은 늘
// 「보고 있는 그 work」이라 `useOpenBand`의 **한쪽 갈래만** 지난다 — 그런데 이 띠가 존재하는
// 이유의 절반이 반대쪽이다(스토리 36·43: 지금 안 보고 있는 work으로 건너뛴다).
//
// 그 갈래에서 주소를 짓는 모양이 다르다: 같은 work이면 보던 문서·분할을 지키는 **함수형**에
// `replace`이고, 다른 work이면 그 work의 마지막 화면을 **빈 주소 위에** 얹는다
// (`recallSearch`). 함수형을 양쪽에 쓰는 뮤테이션은 떠나던 work의 `file`을 남의 work 주소에
// 딸려 보내고(`viewSearch` 머리말이 막으려는 그 사고), `replace`를 양쪽에 쓰는 뮤테이션은
// 뒤로가기를 한 번 먹는다. 아래 두 단언이 각각 그것이다.
test("다른 work의 띠 줄을 누르면 그 화면으로 건너뛰고, 보던 문서는 안 딸려간다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  // **고정된 일**의 문서를 보고 있다. `goto`는 여기 한 번뿐이다 — 셸은 앱 메모리에 살아서
  // 새로고침이 통째로 지운다(그 뒤 이동은 전부 앱 안에서 한다).
  await page.goto(`/works/${pinnedWork.slug}?file=${encodeURIComponent(pinnedWork.specFiles[0])}`);
  await expect(page).toHaveURL(/file=/);

  // **그냥 일**에 셸을 하나 세워 부르게 한다.
  await page.locator("[data-worklist]").getByRole("button", { name: plainWork.title, exact: true }).click();
  await page.locator('[data-tab="new"]').click();
  await awaitSpawned(page, 1);
  await 기다리게한다(page, "커밋할까요?");

  // 다시 **고정된 일**의 문서로 돌아온다 — 이 화면이 「떠나는 주소」다.
  await page.locator("[data-worklist]").getByRole("button", { name: pinnedWork.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}`));
  await expect(page).toHaveURL(/file=/);

  await 띠줄(page, `${plainWork.title} — 나를 기다림`).click();

  // 그 work의 터미널로 건너뛴다.
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
  await expect(page).toHaveURL(/tab=terminal/);
  // **떠나던 주소의 `file`이 안 딸려간다** — 문서 경로는 그 work 안에서만 뜻이 있다.
  await expect(page).not.toHaveURL(/file=/);
  // 그리고 그 셸 탭이 켜져 있다.
  await expect(
    page.locator('[data-tab="shell"]').first().locator("button[aria-pressed]"),
  ).toHaveAttribute("aria-pressed", "true");

  // **`replace`가 아니다**(결정 13) — 화면이 통째로 바뀌는 쪽은 히스토리를 남기므로
  // 뒤로가기 **한 번**이면 보던 문서로 돌아온다.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}`));
  await expect(page).toHaveURL(/file=/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **최상위 셸도 띠에 든다**(결정 13의 다섯째). 하나를 빼면 거기서 부를 때 어디에도 안
// 보인다 — nav `Terminal`은 이 판에서 종류·수 그대로이기 때문이다(스펙의 Out of Scope).
test("최상위 셸이 부르면 제목 자리에 `Terminal`이 서고, 눌러 그 화면으로 간다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await awaitSpawned(page, 1);
  await 기다리게한다(page, "커밋할까요?");

  await expect(띠줄(page, "Terminal — 나를 기다림")).toHaveCount(1);

  // work 화면으로 옮겨도 그 줄이 남는다 — 띠는 **전 화면**의 부르는 셸을 모은다.
  await page.getByRole("button", { name: plainWork.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
  await expect(띠줄(page, "Terminal — 나를 기다림")).toHaveCount(1);

  await 띠줄(page, "Terminal — 나를 기다림").click();
  await expect(page).toHaveURL(/\/terminal$/);
  await expect(page.locator('[data-tab="shell"]').first().locator("button[aria-pressed]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **스크롤로 밀려난 work의 셸도 띠에서 보인다**(스토리 43) — 판 04 결정 21이 감수했던
// 「어디에도 안 보인다」가 여기서 절반 닫힌다. 띠가 목록 **밖**에 서는 것이 그 전부이고,
// 그 사실은 목록이 실제로 넘칠 때만 보이므로 창을 낮춘다.
test("스크롤로 밀려난 work의 셸도 띠에서 보인다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1100, height: 320 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await 기다리게한다(page, "커밋할까요?");

  const list = page.locator("[data-worklist]");
  // **목록 안으로 좁혀 집는다.** 이 행은 지금 부르고 있어 이름에 상태가 붙어 있고
  // (`${plainWork.title} — 나를 기다림`, #203) 그 이름은 띠의 줄과 **글자가 같다**(결정 8) —
  // 화면 전체에서 집으면 둘이 함께 잡힌다. 스코프가 곧 이 검사가 가르려는 그 둘이다.
  const row = list.getByRole("button", { name: `${plainWork.title} — 나를 기다림`, exact: true });

  // **목록이 정말 넘치는가부터 센다** — 안 넘치면 아래 「밀려났다」가 아무것도 안 잰 채
  // 초록이 된다. 넘치게 만드는 것은 창 높이 하나다.
  const 넘침 = await list.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(넘침).toBeGreaterThan(0);
  await list.evaluate((el) => {
    el.scrollTop = 0;
  });

  // **`boundingBox`가 아니라 `evaluate`로 잰다.** 저쪽은 요소가 **보일 때까지** 기다리는데,
  // 여기서 재려는 것이 바로 「안 보인다」라서 그 기다림이 30초 뒤 시간 초과로 끝난다
  // (실측 — 이 검사의 첫 판이 그렇게 죽었다). `evaluate`는 붙어 있기만 하면 답한다.
  const 자리 = (target: Locator) =>
    target.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    });

  const listAt = await 자리(list);
  const rowAt = await 자리(row);
  // 그 행은 목록의 보이는 칸 아래로 밀려났다.
  expect(rowAt.top).toBeGreaterThanOrEqual(listAt.bottom);

  // 그런데 띠의 줄은 목록 **위**에 그대로 서 있다 — 그리고 실제로 보인다.
  const bandRow = 띠줄(page, `${plainWork.title} — 나를 기다림`);
  await expect(bandRow).toBeVisible();
  expect((await 자리(bandRow)).bottom).toBeLessThanOrEqual(listAt.top);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **스토리 34** — 사이드바를 좁혀도 띠가 먼저 죽지 않는다. 마크업 seam은 규격(`shrink-0`)
// 까지만 보고, 그것이 실제로 무엇을 지키는지는 진짜 레이아웃에서만 난다.
test("사이드바를 좁혀도 띠의 점과 경과는 그대로고 제목이 먼저 잘린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await 기다리게한다(page, "커밋할까요?", 125_000);

  const row = 띠줄(page, `${plainWork.title} — 나를 기다림`);
  const 재본다 = async () => ({
    점: (await row.locator("[data-signal]").boundingBox())!.width,
    경과: (await row.locator("[data-elapsed]").boundingBox())!.width,
    제목: (await row.locator("[data-fade]").boundingBox())!.width,
  });

  const 앞 = await 재본다();
  await 좁힌다(page, 40);
  const 뒤 = await 재본다();

  expect(뒤.제목).toBeLessThan(앞.제목);
  expect(뒤.점).toBe(앞.점);
  expect(뒤.경과).toBe(앞.경과);
  // 띠는 그대로 서 있고 경과도 그대로 읽힌다 — 죽는 것은 글자뿐이다.
  await expect(띠(page)).toHaveCount(1);
  await expect(row.locator("[data-elapsed]")).toHaveText("2m");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 이 판이 **판 05 결정 6을 뒤집는다**: hover에 핀이 떠도 **레인과 둘째 줄은 안 사라진다.**
// 판 05에서는 메타와 핀이 2열 한 칸에 겹쳐 서서, 핀이 뜨면 메타가 투명해지는 것이 유일한
// 답이었다 — 자리가 하나뿐이었으니까. 이 판은 메타를 둘째 줄로 내려 그 겹침을 없앴고,
// 그래서 **띄우려는 것이 hover에 지워지는** 일이 구조적으로 안 난다. 상태 축이 들어오면
// (#203) 레인의 점이 곧 이 판이 띄우려는 것이라, 그것이 마우스 위치에 따라 있다 없다 하면
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
  const lane = 레인(page, plainWork.slug);
  const pin = page.getByRole("button", { name: `${plainWork.title} 고정` });
  const title = page.getByRole("button", { name: plainWork.title, exact: true });
  await expect(shells).toHaveCount(1);
  await expect(pin).toHaveCSS("opacity", "0");
  const 평소 = (await title.boundingBox())!.width;
  // **둘째 줄 폭은 쉴 때 찍는다.** 한때 이 줄이 `title.hover()` **뒤에** 있었는데, 그러면
  // 같은 상태의 같은 값을 두 번 재는 것이라 아래 단언이 **무조건** 초록이었다 —
  // `col-span-2`를 `col-start-1`로 바꾸는 뮤테이션이 그대로 통과한다(그때는 이 값 자체가
  // 이미 좁아진 값으로 잡힌다).
  const 줄폭 = (await subrow.boundingBox())!.width;

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

  // **제목만 핀만큼 줄어든다 — 셸이 있든 없든 같다.** 판 05에서는 메타(27.91px)가 이미 선
  // 행이 안 움직이고 셸 0개인 행만 24px 줄었는데, 그 갈림이 곧 「셸이 붙고 떨어질 때 제목이
  // 끊기는 자리가 뛴다」의 다른 쪽 얼굴이었다.
  const 핀상자 = (await pin.boundingBox())!;
  expect((await title.boundingBox())!.width).toBe(평소 - 핀상자.width);
  // **둘째 줄만은 폭이 안 변한다** — 두 칸을 다 쓰므로 핀 아래를 지나간다(`col-span-2`).
  // 1열에만 두면 여기가 24px 좁아져 프로젝트 이름이 hover마다 잘렸다 폈다 한다. 비교할
  // 값은 hover **전에** 찍은 것이라야 한다(위 주석).
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

  // **핀이 글자를 안 덮는다 — 그리고 그 앞까지는 제목의 것이다.** 격자 밖에 세우면 hover
  // 밀림은 0이지만 칸이 핀을 몰라 제목 상자가 핀 아래까지 뻗고, 페이드 띠와 글리프가 같은
  // 자리에 겹쳐 끝 글자가 뭉개진다. 반대로 이름 버튼이 자기 오른쪽 여백을 다시 물면
  // (판 05의 `pr-1.5`) 우 여백이 행의 10에 더해져 **16**이 되고, 셸이 없는 행의 제목이
  // 판 05보다 좁아진다 — 스토리 25가 넓히라고 한 그 자리다. 둘 다 이 한 줄이 잡는다.
  const 빈행제목상자 = (await 빈행제목.locator("[data-title]").boundingBox())!;
  expect(빈행제목상자.x + 빈행제목상자.width).toBeCloseTo(빈행핀상자.x, 1);

  await title.hover();
  // **둘째 줄이 핀의 클릭을 가로채면 안 된다** — 그 줄은 핀 아래를 지나간다.
  await pin.click();
  expect((await readIpcRecord(page))?.calls).toContain(
    `set_work_pinned {"mode":"atelier","slug":"${plainWork.slug}","pinned":true}`,
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **사이드바를 좁히면 글자가 먼저 잘리고 레인은 안 줄어든다**(이 판 결정 5). 레인은 상태 축이
// 들어온 지금(#203) 점·링이 서는 자리이므로, 폭이 모자랄 때 **가장 먼저 포기해도 되는 것**의
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

  await 좁힌다(page, 40);

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

  await 좁힌다(page, 30);

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

  // **nav `Terminal`은 이 판에서 안 바뀐다**(스펙의 Out of Scope — 「셸 메타 규격의 nav
  // `Terminal` 변경」). 최상위 셸이 스스로 말해도 이 자리는 **종류·수 그대로**다: 그 셸이
  // 부르는 것을 받는 자리는 알림 띠이고(#204, 결정 13의 다섯째), 여기까지 상태를
  // 세우면 이 행이 work 행의 어휘를 반쯤 흉내 내는 자리가 된다.
  //
  // work 행과 **같은 구독 컴포넌트**를 쓰므로(`SubrowFor`) 그 가름이 빠지기 쉽다 —
  // 실제로 한 번 빠졌고 이 세 줄이 그것을 잡았다(2026-09-10).
  await markAttention(page, {
    agent: "claude",
    event: "Stop",
    at: Date.now(),
    payload: { last_assistant_message: "커밋할까요?" },
  });
  await expect(navRow.getByRole("img", { name: "claude" })).toHaveCount(1);
  await expect(navRow).not.toContainText("커밋할까요?");

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
