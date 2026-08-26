import { expect, test } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

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

// 사이드바 트리(판 04). **이 층에서만 마운트된다** — 정적 마크업 seam은 가지의 속을 슬롯
// 표식으로 대신하므로, 스토어를 구독하는 진짜 컴포넌트(`ShellBranch`)가 실제로 서는지는
// 여기서만 드러난다. 실제로 그 자리에서 훅 순서를 뒤집는 사고를 한 번 냈고, 그때 L2도 L3도
// 전부 초록이었다 — 이 화면을 여는 검사가 저장소에 하나도 없었기 때문이다.
//
// Works 화면으로 들어가므로 그 화면이 부르는 것까지 하네스가 답해야 한다. `plain-work`은
// spec 파일이 없어(fixtures) 본문이 빈 상태로 서고 문서를 읽지 않는다.
test("고른 work 아래에 트리가 서고, 가지 접힘은 세션까지만 산다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  // 표식으로 집는다 — 패널에도 `spec`이라 적힌 탭이 있어 글자로 집으면 갈린다.
  await expect(page.locator('[data-leaf="spec"]')).toBeVisible();

  // **표식에 값이 실린다** — 한 화면에 가지가 여럿이다(work 블럭 · 그 안의 `terminal` ·
  // nav `Terminal`). 빈 값으로 집으면 어느 것을 잡았는지가 화면 구성에 따라 갈린다.
  const branch = page.locator('[data-branch="terminal"]');
  // 가지의 속. 접혀도 DOM에는 남으므로(펴는 쪽도 애니메이션되어야 한다) **보이는가**로는
  // 가릴 수 없다 — 넘침에 잘릴 뿐이라 상자 크기는 그대로다. 닿을 수 없게 만드는 것이
  // `inert`이고, 그것이 이 계약의 관찰 가능한 형태다.
  const body = page.locator('[data-branch="terminal"] + div');

  // 처음 고른 work의 가지는 펼쳐진다(결정 107). 그 속이 실제로 서는 것까지 본다.
  await expect(branch).toHaveAttribute("aria-expanded", "true");
  await expect(body).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "셸 열기" })).toBeVisible();

  await branch.click();
  await expect(branch).toHaveAttribute("aria-expanded", "false");
  await expect(body).toHaveAttribute("inert", "");

  // **세션 메모리다**(결정 107) — 구획 접힘(위 검사)이 localStorage에 남는 것과 갈리는
  // 자리다. 다시 띄우면 기본값으로 돌아온다.
  await page.reload();
  await expect(branch).toHaveAttribute("aria-expanded", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 트리 행의 **배경이 work 행과 같은 왼쪽 끝에서 시작한다**. 한 컬럼에서 배경 폭이 갈리면
// 켜진 행과 hover가 앞에 빈 자리를 두고 시작해, 같은 목록의 행들이 다른 종류로 읽힌다.
//
// **이 층에서만 보인다** — 들여쓰기가 `--tree-indent` + `calc()`로 내려가므로 진짜 CSS가
// 있어야 재진다. 정적 마크업으로는 클래스 문자열밖에 못 본다.
test("트리 행의 배경은 work 행과 나란히 서고, 글자만 들여쓴다", async ({ page }) => {
  await installFixtureBackend(page);
  // 본문을 터미널로 두고 들어간다 — 그래야 셸이 하나 서서 **두 번째 단**까지 잴 수 있다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  // work 행의 배경 상자는 핀 버튼의 **부모**다 — 라벨·핀·화살표가 그 안의 형제라서다.
  // 핀으로 집는 것은 제목이 브레드크럼 말단에도 같은 글자로 서기 때문이다.
  const row = await page
    .getByRole("button", { name: `${plainWork.title} 고정` })
    .evaluate((el) => el.parentElement!.getBoundingClientRect().x);

  const leaf = page.locator('[data-leaf="spec"]');
  const branch = page.locator('[data-branch="terminal"]');
  await expect(leaf).toBeVisible();
  expect(Math.round((await leaf.boundingBox())!.x)).toBe(Math.round(row));
  expect(Math.round((await branch.boundingBox())!.x)).toBe(Math.round(row));

  // 배경만 나란한 것이지 **속은 한 단 들어가 있다.** 이 줄이 없으면 들여쓰기를 통째로
  // 잃은 것도 초록이다 — `calc()`가 안 먹어 padding이 0이 되는 경우가 정확히 그것이다.
  //
  // 재는 것은 **속이 시작하는 자리**이지 글자가 아니다 — 행마다 앞에 오는 것이 다르다
  // (잎은 아이콘, 셸 행은 이름이 바로 온다). 글자끼리 대면 모양 차이를 깊이로 오독한다.
  const leafInsetX = await leaf.evaluate((el) => el.firstElementChild!.getBoundingClientRect().x);
  expect(leafInsetX).toBeGreaterThan(row + 18);

  // 셸 행은 **두 단**이다(work 행 → `terminal` → 셸). 배경은 여전히 같은 끝에서 시작한다.
  const shell = page.locator("[data-shell-row]");
  await expect(shell).toBeVisible();
  expect(Math.round((await shell.evaluate((el) => el.parentElement!.getBoundingClientRect().x)))).toBe(
    Math.round(row),
  );
  const shellInsetX = await shell.evaluate((el) => el.firstElementChild!.getBoundingClientRect().x);
  expect(shellInsetX).toBeGreaterThan(leafInsetX);

  // **한 컬럼에서 세로 간격이 하나다.** 「머리행 아래」가 「행 사이」보다 넓으면 같은 목록의
  // 행들이 다른 무리로 읽힌다 — 접히는 상자가 부모의 gap 위에 자기 여백을 한 번 더 물면
  // 정확히 그렇게 된다(실측으로 6px 대 3px이었다).
  const gaps = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const workRow = document.querySelector("[data-branch]")!.parentElement!.getBoundingClientRect();
    const leaf = box('[data-leaf="spec"]');
    const branch = box('[data-branch="terminal"]');
    const shellRow = document.querySelector("[data-shell-row]")!.parentElement!.getBoundingClientRect();
    return [leaf.top - workRow.bottom, branch.top - leaf.bottom, shellRow.top - branch.bottom];
  });
  expect(gaps).toEqual([gaps[0], gaps[0], gaps[0]]);

  // **트리 한 단이 「글리프 칸 하나」다**(index.css의 `--tree-step`). 그래서 아래 단의
  // 글리프가 위 단의 글자와 같은 x에 선다 — 한 컬럼에 세로줄이 둘만 남는다.
  // 숫자를 따로 골라 두면 글리프 크기를 손보는 날 이 관계가 조용히 깨진다.
  const columns = await page.evaluate(() => {
    const x = (el: Element | null) => Math.round(el!.getBoundingClientRect().x);
    const work = document.querySelector("[data-branch]:not([data-branch='terminal'])")!;
    const leaf = document.querySelector('[data-leaf="spec"]')!;
    const branch = document.querySelector('[data-branch="terminal"]')!;
    return {
      // 아이콘은 SVG라 `getBoundingClientRect`가 획 넘침까지 재므로 글자로만 잰다.
      workText: x(work.children[1]),
      leafText: x(leaf.lastElementChild),
      branchText: x(branch.children[1]),
      shellText: x(document.querySelector("[data-shell-row]")!.firstElementChild),
    };
  });
  // 같은 단의 글자는 서로 맞고, 한 단 아래는 그만큼만 들어간다.
  expect(columns.branchText).toBe(columns.leafText);
  expect(columns.shellText).toBe(columns.leafText);
  expect(columns.leafText - columns.workText).toBe(columns.workText - 17);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 고른 work가 **하나의 블럭**이 됐다 — 행이 머리행이고 `spec`·`terminal`·셸이 그 속이다.
// 접기는 nav 항목이 자기 가지를 이는 모양과 같은 겹이라 애니메이션도 같은 것을 쓴다.
test("고른 work 블럭을 통째로 접을 수 있고, 남의 work에는 그 토글이 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  const block = page.locator(`[data-branch="${plainWork.slug}"]`);
  // 블럭의 속은 행 상자의 **다음 형제**다 — 화살표가 그 상자 안에 산다.
  const body = block.locator("xpath=../following-sibling::div[1]");

  await expect(block).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('[data-leaf="spec"]')).toBeVisible();
  await expect(body).not.toHaveAttribute("inert", "");

  await block.click();
  await expect(block).toHaveAttribute("aria-expanded", "false");
  // 접혀도 속은 DOM에 남는다 — 그래야 펴는 쪽도 애니메이션된다. 대신 닿을 수 없다.
  await expect(body).toHaveAttribute("inert", "");

  // 결정 101. 남의 work 항목을 건드리면 그 work로 **간다** — 접히는 것이 아니다.
  // 행 하나가 두 가지 일을 하게 됐으므로 갈림을 여기서 함께 본다.
  const [pinnedWork] = WORKS;
  await expect(page.locator(`[data-branch="${pinnedWork.slug}"]`)).toHaveCount(0);
  await page.getByRole("button", { name: pinnedWork.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}`));

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 확인 창이 **이 앱의 것**이다 — OS 시트가 아니다. 창 하나만 남의 글꼴·남의 모서리로 뜨면
// 그것이 앱 밖의 일처럼 읽힌다. 이 층에서만 보인다: 정적 마크업 seam에는 클릭이 없고,
// 「OS에 안 물었다」는 IPC 기록으로만 드러난다.
test("셸을 닫을 때 앱 창이 뜨고, OS 시트는 안 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const shell = page.locator("[data-shell-row]");
  await expect(shell).toBeVisible();
  await page.getByRole("button", { name: /닫기$/ }).first().click();

  // 앱이 그리는 창이다 — 이 요소가 DOM에 있다는 것 자체가 OS 시트가 아니라는 뜻이다.
  const dialog = page.getByRole("alertdialog", { name: "셸 닫기" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("실행 중인 명령이 있어요");

  // 취소하면 셸이 그대로 남는다 — 「물었고, 아니라고 하면 안 닫는다」(결정 92).
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(shell).toBeVisible();

  // 다시 물어 이번엔 닫는다.
  await page.getByRole("button", { name: /닫기$/ }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "닫기" }).click();
  await expect(shell).toHaveCount(0);

  // **마지막 칸이 닫히면 본문이 문서로 돌아온다.** 셸 0개인 터미널 본문은 볼 것이 없는
  // 화면이라(빈 자리와 `+` 하나) 사람을 거기 남겨 두면 다음에 무엇을 할지가 본문 밖에 있다.
  await expect(page).not.toHaveURL(/tab=terminal/);

  // **OS에는 한 번도 안 물었다.** `confirm`도 `message`도 와이어에서는 이 커맨드로 나간다.
  const calls = (await readIpcRecord(page))?.calls ?? [];
  expect(calls.filter((call) => call.startsWith("plugin:dialog"))).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **남의 work의 `spec` 잎이 남는다.** 한때 고른 work에만 섰는데, 그러면 옆 work을 잠깐
// 들여다보는 동안 방금까지 읽던 work의 문서가 트리에서 사라졌다 — 셸이 도는 work은 블럭이
// 서 있는데 그 안에 `terminal`만 남는 모양이었다.
test("남의 work의 spec 잎이 남고, 누르면 그 work으로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  // 터미널로 들어가 셸을 하나 띄운다 — 그래야 이 work을 떠나도 블럭이 선다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator("[data-shell-row]")).toBeVisible();

  const [pinnedWork] = WORKS;
  await page.getByRole("button", { name: pinnedWork.title, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}`));

  // 블럭이 선 work마다 잎이 있다 — 떠나온 것과 지금 고른 것 둘.
  const leaves = page.locator('[data-leaf="spec"]');
  await expect(leaves).toHaveCount(2);
  // 켜진 것은 **고른 work의 것 하나**다. 둘 다 켜지면 「지금 보고 있는 것」이 둘이 된다.
  await expect(page.locator('[data-leaf="spec"][aria-current]')).toHaveCount(1);

  // 남의 잎을 누르면 그 work으로 간다(결정 101). **켜지지 않은 것**이 남의 것이다 —
  // 순서로 집으면 구획(고정·작업)에 따라 갈린다.
  await page.locator('[data-leaf="spec"]:not([aria-current])').click();
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
  await expect(page).not.toHaveURL(/tab=terminal/);
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

// **블럭이 사라질 때도 접히면서 사라진다.** 조건이 거짓이 되는 순간 걷어 버리면 아래
// 행들이 그만큼 순간이동한다 — 실물에서 다른 work을 누를 때 목록이 68px 튀는 모습으로
// 났다(실측). 이 층에서만 보인다: 마운트/언마운트는 정적 마크업에 시간이 없다.
test("다른 work을 눌러도 목록이 순간이동하지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  const [pinnedWork] = WORKS;
  await page.goto(`/works/${pinnedWork.slug}`);

  const row = page.getByRole("button", { name: `${plainWork.title} 고정` });
  const y = () => row.evaluate((el) => el.parentElement!.getBoundingClientRect().y);
  const before = await y();

  await page.getByRole("button", { name: plainWork.title, exact: true }).click();
  await page.waitForTimeout(40);
  const mid = await y();
  await page.waitForTimeout(400);
  const after = await y();

  // 결국 자리는 바뀐다 — 앞 work의 블럭이 걷혔으니까.
  expect(after).toBeLessThan(before - 20);
  // **가는 중이 있었다.** 순간이동이면 40ms에 이미 끝자리라 이 줄이 빨개진다.
  // (실측: 고치기 전에는 40ms에 벌써 도착해 있었다.)
  expect(mid).toBeGreaterThan(after);
  expect(mid).toBeLessThan(before);
  expect(await unknownIpcCalls(page)).toEqual([]);
});
