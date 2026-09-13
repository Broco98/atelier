import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import { FIXTURE_SHELL_NAME, ROOMS, WORKS } from "./fixtures";
import { fillToCap, MAX_SHELLS, rowOf } from "./tab-row";
import type { Row } from "./tab-row";
import {
  fireWindowEvent,
  installFixtureBackend,
  markAttention,
  markRunning,
  openShell,
  setWindowFocused,
  stubWindowFocus,
  unknownIpcCalls,
} from "./harness";

// 판 03 — `/terminal`의 머리행도 **같은 탭 줄**이다(결정 8 · adr-03). **이 층에서만 보이는
// 것 둘이다**: 키 이벤트(정적 마크업 seam에는 이벤트가 없어 이펙트가 아예 안 돈다)와,
// 화면에 실제로 보이는 순서와 ⌘1이 고르는 것이 같은가.
//
// **마크업 seam(TerminalPage.test.tsx)이 보는 것은 여기서 다시 안 본다** — `spec` 칸이
// 없는지, 무엇이 어느 순서로 서는지, 창 드래그 영역이 있는지는 그쪽이 든다. 여기서 그것을
// 한 번 더 확인하는 것은 「줄이 실제로 섰다」를 이 검사가 딛고 서기 위해서다: 안 서 있으면
// 아래 키 단언이 「고를 칸이 없어서」 초록이 될 수 있다.
//
// 픽스처 백엔드가 `pty_spawn`을 답해 xterm이 실제로 뜬다(terminal-fill.spec.ts가 선례다).

test("⌘1이 탭 줄에 보이는 첫 칸을 고른다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");

  // 들어오면 셸 하나가 뜬다(`ensureShell`) — 그 칸이 곧 탭 줄의 첫 칸이다.
  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  // **이 화면에는 `spec` 칸이 없다**(결정 8). 그래서 ⌘1부터가 셸이고, 화면마다 갈리는 것이
  // `firstKey` 하나라는 성질이 여기서 실물로 선다.
  await expect(page.locator('[data-tab="spec"]')).toHaveCount(0);

  // 탭 줄의 `+`로 한 칸 더 연다. **표식으로 집는다** — 한때 「셸 열기」 버튼이 이 화면에
  // 둘이었고(사이드바 가지에도 하나), 이름으로 집던 검사가 판 04가 그 가지를 걷는 날
  // 엉뚱한 자리에서 깨질 뻔했다. 표식은 그 왕복을 그대로 견뎠다.
  await page.locator('[data-tab="new"]').click();
  await expect(tabs).toHaveCount(2);
  // 새로 연 칸이 켜진 칸이다 — 여기가 안 서면 아래 ⌘1은 「원래 첫 칸이 켜져 있어서」 초록이다.
  const lit = (at: number) => tabs.nth(at).locator("button[aria-pressed]");
  await expect(lit(1)).toHaveAttribute("aria-pressed", "true");

  // ⌘1이 **첫 칸**으로 돌아온다. work 화면이라면 그 자리가 `spec`이라 셸이 안 바뀐다.
  await page.keyboard.press("Meta+1");
  await expect(lit(0)).toHaveAttribute("aria-pressed", "true");
  await expect(lit(1)).toHaveAttribute("aria-pressed", "false");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 티켓 #143: 좁은 창에서 탭이 **균등하게** 줄어들고, 바닥에 닿으면 스크롤한다(결정 11·20) ───
//
// **이 층이 아니면 아무것도 안 보인다.** 마크업 seam이 드는 것은 클래스 문자열뿐이고
// (`ShellTabs.test.tsx`), 이 판의 물음은 전부 실측이다: 한 줄로 남았나 · 넘쳤나 · 칸이
// 고르게 줄었나 · 로고가 남았나 · 오른쪽 끝 조작이 안 잘렸나.
//
// **work 화면에서 잰다.** `/terminal`에는 오른쪽 끝 조작이 없어(결정 10) 거기서는 이 줄이
// 가장 붐비는 모습을 못 만든다 — 줄 자체는 두 화면이 같은 것을 쓰므로(결정 8) 붐비는 쪽에서
// 재는 것이 둘 다를 잰다.

const [, plainWork] = WORKS;

/** 이 work은 워크트리가 없어 픽스처의 셸 이름 앞에 프로젝트가 안 붙는다(결정 18). */
const SHELL_NAME = FIXTURE_SHELL_NAME;

test("창을 좁혀도 줄이 안 넘치고 칸이 고르게 줄어든다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  // 이 줄이 가장 붐비는 모습이 곧 이 티켓의 물음이다.
  await fillToCap(page);

  await markRunning(page, "claude");
  const running = page.locator('[data-tab="shell"] [role="img"]');
  await expect(running).toHaveCount(1);

  const actionsWidth: Record<number, number> = {};
  const rows: Record<number, Row> = {};

  // 1280은 실물 기본 창, 900은 **창이 작아질 수 있는 끝**(tauri.conf의 `minWidth`),
  // 1120은 그 사이 — 칸이 최소 폭에 닿아 스크롤은 섰지만 상자에 한 칸은 온전히 들어가는 폭이다.
  //
  // **줄이 받는 폭은 창 폭이 아니다.** 창에서 사이드바(280)와 작업 패널(330)을 뺀 나머지라
  // 900px 창에서 290px뿐이고, 그래서 여덟 칸이 어떤 최소 폭으로도 안 들어간다 — 결정 20이
  // 「그 아래는 스크롤」로 답한 자리다.
  for (const width of [1280, 1120, 900]) {
    await page.setViewportSize({ width, height: 800 });
    // **xterm이 새 폭에 다시 맞을 때까지 기다린다.** 줄과 무관한 값이다 — FitAddon이
    // ResizeObserver로 도는 사이에는 캔버스가 옛 폭 그대로라 창 밖으로 나가 있고, 창 전체의
    // 가로 넘침이 그동안만 참이다. 여기서 안 기다리면 아래 `pageSpill`이 그것을 잡는다.
    await expect
      .poll(async () => (await rowOf(page)).pageSpill, { timeout: 5000 })
      .toBeLessThanOrEqual(0);
    const row = await rowOf(page);
    const at = `${width}px`;
    rows[width] = row;
    console.log(at, JSON.stringify(row));

    // 한 줄이다 — 넘겨 접히면 높이가 늘어난다.
    expect(row.height, at).toBe(44);
    // **머리행은 넘치지 않는다.** 넘치는 몫은 셸 칸 상자가 받는다(결정 20) — 이 값이
    // 0보다 크면 오른쪽 끝 조작이 창 밖으로 밀려난 그림이다(고치기 전 900px에서 380이었다).
    expect(row.spill, at).toBeLessThanOrEqual(0);
    expect(row.pageSpill, at).toBeLessThanOrEqual(0);

    // **균등하게** 줄어든다 — 하나만 찌그러지면 안 된다. 로고가 도는 칸이 그만큼 넓어지는
    // 것도 여기서 걸린다(칸 폭을 내용이 정하면 도는 칸만 넓다).
    expect(Math.max(...row.tabs) - Math.min(...row.tabs), at).toBeLessThanOrEqual(1);
    expect(row.tabs, at).toHaveLength(MAX_SHELLS);

    // **로고는 끝까지 남는다** — 이 판이 사려는 것이 「무엇이 도나」다. 세 폭 모두 칸이
    // 최소 폭(44px)이라 이름이 숨었고, 그때 서는 것이 이 글리프다(결정 27) — 넓은 폭에서는
    // 이름이 그 몫을 하므로 안 선다.
    expect(row.mark, at).not.toBeNull();
    // 글리프 하나의 규격이다(`size-3.5`). 한때 여기 스피너가 나란히 서서 30px이었다.
    expect(row.mark!.width, at).toBe(14);
    // 남아 있기만 하면 안 된다 — 제 칸을 넘어 옆 칸 위에 그려지면 그것도 잘린 것이다.
    expect(row.mark!.over, at).toBeLessThanOrEqual(0);

    // 오른쪽 끝 조작은 고정된 채다(결정 10) — 밀려나지도 좁아지지도 않는다.
    expect(row.actions.over, at).toBeLessThanOrEqual(0);
    actionsWidth[width] = row.actions.width;
  }

  // 조작 묶음의 폭이 세 폭에서 모두 같다 — 좁아진다고 눌리지 않는다.
  expect(actionsWidth[900]).toBe(actionsWidth[1280]);
  expect(actionsWidth[1120]).toBe(actionsWidth[1280]);

  // 좁힐수록 상자가 좁아지는데 칸은 이미 바닥이라, 스크롤로 넘어가는 몫이 커진다.
  // **줄이 넘친 것이 아니다** — 위에서 세 폭 모두 `spill`이 0이었다.
  expect(rows[900].strip.clientWidth).toBeLessThan(rows[1120].strip.clientWidth);
  expect(rows[1120].strip.clientWidth).toBeLessThan(rows[1280].strip.clientWidth);
  for (const width of [1280, 1120, 900]) {
    expect(rows[width].strip.scrollWidth, `${width}px`).toBeGreaterThan(rows[width].strip.clientWidth);
  }

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("스크롤이 선 줄에서도 ⌘로 고른 칸이 보이는 자리로 온다", async ({ page }) => {
  // 결정 20이 만든 빚이다 — 안 보이는 칸이 생기면 ⌘1~9가 그 칸을 고를 수 있고, 그러면
  // 「눌렀는데 아무 일도 없다」로 읽힌다. 키는 폭을 모르므로 줄이 끌어와야 한다.
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1120, height: 800 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await fillToCap(page);

  const strip = page.locator("[data-tab-strip]");
  const tabs = page.locator('[data-tab="shell"]');
  const last = tabs.nth(MAX_SHELLS - 1);

  const inside = async () => {
    const cell = (await last.boundingBox())!;
    const box = (await strip.boundingBox())!;
    return cell.x >= box.x - 1 && cell.x + cell.width <= box.x + box.width + 1;
  };

  // ⌘2가 첫 셸이다(⌘1은 spec — 결정 78·79). 줄이 맨 앞으로 돌아가면 마지막 칸은 밖이다.
  // **이 단언이 없으면 아래가 「원래 보이고 있어서」 초록이 된다.**
  await page.keyboard.press("Meta+2");
  await expect.poll(inside).toBe(false);

  // ⌘9가 여덟째 셸이다. 고른 칸이 상자 안으로 들어온다.
  await page.keyboard.press("Meta+9");
  await expect.poll(inside).toBe(true);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 위 두 검사는 「줄이 안 넘친다」와 「고른 칸이 상자 안으로 온다」를 들지만 **상자에 칸 하나가
// 들어갈 폭이 남는가**는 안 든다 — 상자가 0px이면 넘침도 없고 ⌘로 고른 칸의 좌표도 상자
// 「안」이다. 900px 창에서 작업 패널이 열린 기본 배치가 그랬다(줄 290px · 상자 0px): 칸이
// 화면에 없어 누를 수도, 끌어 옮길 수도 없다. 그래서 여기서는 **사람이 보는 것**을 잰다 — 상자에
// 칸 하나가 온전히 보이고, 그 칸을 눌러 켤 수 있다.
//
// 창이 작아질 수 있는 끝(`tauri.conf`의 `minWidth` 900)과 그 위 한 폭에서, 탭 줄을 이는 세
// 화면 모두를 패널을 연 채로도 접은 채로도 본다. `/terminal`에는 작업 패널이 없어 한 번만 본다.
const SCREENS = [
  { name: "work 화면", url: `/works/${plainWork.slug}?tab=terminal`, panel: true },
  { name: "Maison Room 화면", url: `/maison/rooms/${ROOMS[1].slug}?tab=terminal`, panel: true },
  { name: "`/terminal`", url: "/terminal", panel: false },
] as const;

for (const screen of SCREENS) {
  for (const width of [900, 1120]) {
    for (const panelOpen of screen.panel ? [true, false] : [true]) {
      const layout = screen.panel ? (panelOpen ? "패널 열림" : "패널 접힘") : "패널 없음";
      test(`${screen.name} ${width}px(${layout})에서도 셸 칸이 보이고 눌린다`, async ({ page }) => {
        await installFixtureBackend(page);
        await page.setViewportSize({ width, height: 800 });
        await page.goto(screen.url);

        const tabs = page.locator('[data-tab="shell"]');
        await tabs.first().waitFor();
        // 둘이어야 「다른 칸을 눌러 켠다」가 선다 — 새로 연 칸이 켜져 있으므로 첫 칸을 누른다.
        await openShell(page);
        await expect(tabs).toHaveCount(2);

        if (!panelOpen) await page.getByRole("button", { name: /패널 접기$/ }).click();
        // **폭이 멈출 때까지 기다린다** — 패널이 220ms 트랜지션으로 접히는 동안 잰 상자 폭은 곧 낡는다.
        let last = -1;
        await expect
          .poll(
            async () => {
              const now = (await rowOf(page)).strip.clientWidth;
              const settled = now === last;
              last = now;
              return settled;
            },
            { intervals: [150] },
          )
          .toBe(true);

        const row = await rowOf(page);
        const at = `${screen.name} ${width}px ${layout} ${JSON.stringify(row)}`;
        // 줄은 여전히 안 넘친다(결정 20) — 칸을 보이게 하려고 조작을 창 밖으로 밀면 안 된다.
        expect(row.spill, at).toBeLessThanOrEqual(0);
        expect(row.actions.over, at).toBeLessThanOrEqual(0);
        // **상자에 칸 하나가 온전히 들어간다.** 칸은 최소 폭 아래로 안 줄므로 이 폭이 칸 하나를
        // 못 담으면 어느 칸도 온전히 안 보인다(0px이면 하나도 안 보인다).
        expect(row.strip.clientWidth, at).toBeGreaterThanOrEqual(Math.min(...row.tabs));

        // 그리고 **눌린다** — 켜지지 않은 첫 칸을 눌러 켠다.
        const first = tabs.first().locator("button[aria-pressed]");
        await expect(first).toHaveAttribute("aria-pressed", "false");
        await first.click({ timeout: 5000 });
        await expect(first).toHaveAttribute("aria-pressed", "true");

        expect(await unknownIpcCalls(page)).toEqual([]);
      });
    }
  }
}

test("칸이 늘수록 이름이 먼저 줄고 아이콘만 남는다", async ({ page }) => {
  // 결정 11의 **순서**다 — 이름이 말줄임으로 줄다가, 몇 글자도 못 세우는 폭에서 자리를
  // 비운다. 창 폭이 아니라 **칸 수**로 폭을 미는 것은 그 사이에 사이드바·패널 폭이
  // 끼지 않아서다 — 재는 것은 같은 한 가지(칸 하나의 폭)다.
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const tabs = page.locator('[data-tab="shell"]');
  const name = tabs.first().getByText(SHELL_NAME, { exact: true });

  await expect(tabs).toHaveCount(1);
  // **`+`를 연달아 누르지 않는다** — 첫 칸은 글꼴을 기다린 뒤 **DOM에 붙어 있을 때만** 열리고
  // spawn한다(`terminal-store`의 `openOrReattach`). 그 전에 새 칸이 켜지면 첫 칸이 떼어져
  // 영영 `셸`로 남아, 아래 이름 단언이 붐비는 러너에서만 30초를 기다리다 빨개진다.
  await openShell(page);
  await openShell(page);
  await expect(tabs).toHaveCount(3);
  // 셋일 때는 이름이 보인다.
  expect((await name.boundingBox())!.width).toBeGreaterThan(10);
  // **그리고 그때는 스크롤이 없다** — 스크롤은 칸이 바닥에 닿은 뒤의 마지막 수단이지
  // 늘 서 있는 것이 아니라는 것이 이 한 줄이다(결정 20).
  const room = await rowOf(page);
  expect(room.strip.scrollWidth).toBeLessThanOrEqual(room.strip.clientWidth + 1);
  expect(Math.min(...room.tabs)).toBeGreaterThan(44);

  await fillToCap(page);
  // 여덟이면 칸이 최소 폭이라 이름이 자리를 비운다. **요소는 남는다** — `sr-only`라서
  // 스크린리더에는 그대로 불린다(이름 버튼의 접근성 이름이 이 글자 하나다).
  expect((await name.boundingBox())!.width).toBeLessThanOrEqual(1);
  await expect(name).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 티켓 #198: 백엔드가 **셸마다** 쏘는 값이 그 셸에 앉는다 ───
//
// 이 판(터미널 신호)의 검사는 거의 전부가 「서로 다른 상태의 셸 둘」을 필요로 한다 — 행의 점,
// 띠의 줄, 물든 탭이 전부 「어느 셸인가」를 말하는 것들이라, 값이 늘 맨 앞 셸에만 앉으면 그
// 검사들은 **자리가 옳은지를 아예 못 잰다.** 그 자리를 이 검사가 연다.
//
// 막고 있던 것은 고정 백엔드였다: `pty_spawn`이 늘 id 1을 답해 셸이 몇이든 백엔드 쪽 번호가
// 하나뿐이었고, `shellOfPty`가 먼저 찾은 칸을 주므로 값이 전부 맨 앞 칸에 앉았다.
//
// **재는 자리가 탭 줄인 것은 「어느 셸인가」가 화면에 드러나는 자리가 여기뿐이라서다.**
// 사이드바 메타는 줄 전체로 말하고(`runningAgentsOf` — 「claude 하나가 돈다」까지만 안다),
// pty id는 화면 어디에도 안 적힌다.
//
// **셸 둘이면 족하고 창 폭은 아무래도 좋다.** 도는 명령의 글리프는 폭과 무관하게 **DOM에 늘
// 있고**(`ShellTabs`의 `@max-[88px]:flex` — 좁은 폭에서 바뀌는 것은 `display`뿐이다), 여기서
// 세는 것은 그 DOM이다. 「이름이 숨는 폭에서만 눈에 선다」를 재는 것은 마크업 seam
// (`ShellTabs.test.tsx`)의 몫이고, 이 검사의 물음은 **값이 어느 칸에 앉나** 하나다 — 상한까지
// 채우면 그 물음이 상한·접힘 규칙에 공연히 매인다.
test("도는 명령은 그 셸의 칸에만 앉는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  // 들어오면 이 work의 셸 하나가 뜬다(`ensureShell`). 둘째 칸은 **응답까지 기다려** 연다 —
  // 「둘째 칸 = pty 2」가 그 기다림 위에 선다(`openShell`의 머리말).
  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  await openShell(page);
  await expect(tabs).toHaveCount(2);

  const marks = page.locator('[data-tab="shell"] [role="img"]');
  // **먼저 아무 칸도 안 물든 것을 센다.** 이것이 없으면 아래가 「원래 있던 것」으로도 초록이 된다.
  await expect(marks).toHaveCount(0);

  await markRunning(page, "claude", 2);

  // 그 칸 하나에만 앉는다. 세 단언이 각각 다른 것을 말한다: 둘째가 물들었다 · 첫째는 안
  // 물들었다 · 그리고 **줄 전체에 하나뿐이다**(마지막이 없으면 두 칸이 함께 물든 그림이
  // 통과한다 — 값이 셸 단위가 아니라 줄 단위로 앉는 회귀가 정확히 그 모양이다).
  await expect(tabs.nth(1).locator('[role="img"]')).toHaveCount(1);
  await expect(tabs.nth(0).locator('[role="img"]')).toHaveCount(0);
  await expect(marks).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **손잡이가 「앉았다」를 잘못 말하면 위 검사가 무엇을 재는지 아무도 모른다.** `markRunning`은
// 값이 앉을 때까지 다시 쏘는데, 앉았는지를 마크의 수로 판정한다 — 그 판정이 화면 전체에서
// 「하나라도 있는가」였을 때는 같은 에이전트의 마크가 이미 서 있으면(사이드바 행·nav도 같은
// 마크를 세운다) 값이 대상 pty에 **안 앉아도** 곧바로 성공을 냈다. 이 판의 뒤쪽 티켓들이
// 같은 에이전트를 셸 둘에 앉히므로(#203~#205) 그 fail-open이 정확히 그 그림에서 난다.
test("도는 명령 손잡이는 이미 선 마크에 안 속는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  await openShell(page);
  await markRunning(page, "claude", 2);
  await expect(page.locator('[data-tab="shell"] [role="img"]')).toHaveCount(1);

  // 모르는 pty를 주면 `shellOfPty`가 null을 주어 값이 **아무 칸에도 안 앉는다.** 그러면
  // 손잡이는 5초를 다 쓰고 던져야 한다 — 위 claude 하나를 보고 돌아가면 안 된다.
  const 던진말 = await markRunning(page, "claude", 99).then(
    () => "던지지 않았다",
    (error: Error) => error.message,
  );
  expect(던진말).toContain("pty 99");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ─── 티켓 #205: 칸이 **물든다**(결정 6 — 안 J3) ───
//
// **이 층이 아니면 아무것도 안 보인다.** 마크업 seam(`ShellTabs.test.tsx`)이 드는 것은 클래스
// 문자열이고, 여기서 재는 것은 셋이다 — 그 클래스가 실제로 **토큰 값으로** 칠해지는가 ·
// 스토어를 한 바퀴 돈 값이 그 칸에 앉는가 · 그리고 **칸을 켜면 초록이 꺼지는가**. 마지막
// 것은 정적 마크업에 아예 없다: 「봤다」는 창 포커스와 켜진 칸이 만나는 순간이라 이벤트가
// 도는 층에서만 난다.

/**
 * 안 물든 칸의 배경. 브라우저가 `transparent`를 이 글자로 돌려준다 — 토큰이 아니라 **없음**
 * 이라 `토큰색`으로 못 뽑고, 그래서 여기 한 번 적는다. 브라우저가 다른 글자를 돌려주는 날은
 * 이 줄이 그 자리에서 터진다(조용히 통과하지 않는다).
 */
const 안물듦 = "rgba(0, 0, 0, 0)";

/** 그 칸의 실제 배경색. 채움이 칸 상자에 붙으므로(스토리 53) 재는 것도 그 상자다. */
const 칸배경 = (page: Page, at: number) =>
  page.locator('[data-tab="shell"]').nth(at).evaluate((el) => getComputedStyle(el).backgroundColor);

/**
 * 토큰 하나를 브라우저가 쓰는 색 문자열로 바꾼다. **값을 검사에 손으로 적지 않기 위해서다** —
 * `rgba(217, 119, 6, 0.14)`를 여기 박아 두면 팔레트를 손보는 날 이 줄이 정본과 갈리고,
 * 무엇보다 「탭이 #203의 토큰을 그대로 읽는가」(수용 기준)를 못 재게 된다.
 */
const 토큰색 = async (page: Page, name: string) => {
  const 색 = await page.evaluate((one: string) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${one})`;
    document.body.appendChild(probe);
    const 값 = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return 값;
  }, name);
  // **fail-closed.** 없는 `var()`는 computed 시점에 그 선언을 통째로 무효로 만들고 프로퍼티가
  // 초기값으로 떨어지는데, 그 값이 바로 위 `안물듦`이다(WebKit 실측). 그대로 돌려주면 팔레트가
  // 지워지는 날 이 파일의 견줌이 **양쪽 다 투명**이라 전부 초록이 된다 — `--signal-wait-soft`가
  // 죽으면 `--color-wait-soft`(index.css)도 같이 죽어 `bg-wait-soft` 규칙 자체가 안 생기므로
  // 칸도 투명해지기 때문이다. 여기서 끊으면 그날 검사가 색이 아니라 **원인**을 말한다.
  if (색 === 안물듦 || 색 === "") throw new Error(`토큰 ${name}이 안 풀렸다 — ${색 || "빈 값"}`);
  return 색;
};

test("부르는 칸만 물들고, 색이 #203의 토큰 그대로다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  await openShell(page);
  await expect(tabs).toHaveCount(2);
  // 부르는 것은 **둘째 칸**이고 보고 있는 것은 첫째다 — 켜진 칸을 부르게 하면 「봤다」가
  // 곧바로 초록을 지워, 이 검사가 무엇을 재는지 모르게 된다.
  await tabs.nth(0).locator("button[aria-pressed]").click();

  // **먼저 아무 칸도 안 물든 것을 센다.** 이것이 없으면 아래가 「원래 그렇던 것」으로도 초록이다.
  //
  // 값을 한 번 재서 들고 있지 않고 **폴링으로 견준다** — 칸에 `transition-colors`가 걸려 있어
  // 켜짐이 옮겨 가는 150ms 동안 `getComputedStyle`이 중간 색을 돌려준다(실측: 켜짐이 빠지는
  // 도중에 `rgba(20, 20, 28, 0.09)`). 그 순간값을 기준으로 잡으면 마지막 「도는 중은 안
  // 물든다」가 존재하지 않는 색과 견주게 된다.
  await expect
    .poll(() => 칸배경(page, 1), { message: "안 부르는 칸이 물들어 있다" })
    .toBe(안물듦);

  await markAttention(
    page,
    { agent: "claude", event: "Stop", payload: { last_assistant_message: "커밋할까요?" } },
    2,
  );
  const 앰버 = await 토큰색(page, "--signal-wait-soft");
  await expect
    .poll(() => 칸배경(page, 1), { message: "둘째 칸이 앰버로 안 물들었다" })
    .toBe(앰버);
  // 옆 칸은 그대로다 — 값이 줄 단위로 앉는 회귀가 여기서 터진다.
  expect(await 칸배경(page, 0)).not.toBe(앰버);

  // 세션이 끝나면 초록이다(스펙 전이 표 — 턴 종료가 아니다).
  await markAttention(page, { agent: "claude", event: "SessionEnd", payload: { reason: "logout" } }, 2);
  const 초록 = await 토큰색(page, "--signal-done-soft");
  expect(앰버, "앰버와 초록이 같은 색이다").not.toBe(초록);
  await expect.poll(() => 칸배경(page, 1), { message: "둘째 칸이 초록으로 안 물들었다" }).toBe(초록);

  // **도는 중은 안 물든다**(스토리 52). 탭 칸에는 링을 안 세우므로 여기서 물들이면 claude가
  // 도는 내내 줄이 색을 띤 채라 「부른다」가 뜻을 잃는다.
  await markAttention(page, { agent: "claude", event: "UserPromptSubmit" }, 2);
  await expect
    .poll(() => 칸배경(page, 1), { message: "도는 중인 칸이 안 돌아왔다" })
    .toBe(안물듦);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **켜면 초록이 꺼지고 앰버는 남는다**(결정 6·7 · 스토리 49·50). 판정은 `isShellSeen` 하나이고
// 알림 억제(#206)가 같은 함수를 쓴다 — 여기서 꺼지는 것이 곧 그쪽에서 안 울리는 것이다.
test("초록 칸을 켜면 초록이 꺼지고, 앰버 칸을 켜도 앰버는 남는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);

  const tabs = page.locator('[data-tab="shell"]');
  await expect(tabs).toHaveCount(1);
  await openShell(page);
  await tabs.nth(0).locator("button[aria-pressed]").click();

  const 초록 = await 토큰색(page, "--signal-done-soft");
  const 앰버 = await 토큰색(page, "--signal-wait-soft");
  const 켜기 = (at: number) => tabs.nth(at).locator("button[aria-pressed]").click();

  await markAttention(page, { agent: "claude", event: "SessionEnd", payload: { reason: "logout" } }, 2);
  await expect.poll(() => 칸배경(page, 1)).toBe(초록);
  // 이름에도 붙어 있다 — 꺼지는 것이 색만이 아니라는 것을 아래에서 같은 자리로 잰다.
  await expect(tabs.nth(1).locator("button[aria-pressed]")).toHaveAttribute(
    "aria-label",
    /확인할 것$/,
  );

  await 켜기(1);
  // **켜는 순간 봤다다.** 색도 이름도 함께 걷힌다.
  await expect.poll(() => 칸배경(page, 1), { message: "켠 칸의 초록이 안 꺼졌다" }).not.toBe(초록);
  await expect(tabs.nth(1).locator("button[aria-pressed]")).not.toHaveAttribute(
    "aria-label",
    /확인할 것$/,
  );

  // **기다림은 켜도 안 꺼진다** — 본 것과 답한 것은 다르다(결정 7). 켜진 칸이라 회색
  // (`toggle-on`)이 서야 할 자리인데 앰버가 이긴다(결정 6).
  await markAttention(
    page,
    { agent: "claude", event: "Stop", payload: { last_assistant_message: "커밋할까요?" } },
    2,
  );
  await expect.poll(() => 칸배경(page, 1), { message: "켠 칸의 앰버가 꺼졌다" }).toBe(앰버);
  // 「고른 칸이다」는 1px 안쪽 테두리가 대신 말한다 — 그림자라 폭을 안 먹는다(스토리 54).
  const 그림자 = await tabs.nth(1).evaluate((el) => getComputedStyle(el).boxShadow);
  expect(그림자, `켜진 앰버 칸에 안쪽 테두리가 없다 — ${그림자}`).toContain("inset");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **「봤다」는 그 셸을 **보고 있을 때**만이다**(결정 7). 칸이 켜져 있어도 본문이 문서면 사람은
// 그 셸을 안 보고 있다 — 켜진 칸(`activeByOwner`)은 그 화면의 **기억**이라 spec을 읽는 동안에도
// 남아 있어서, 그것만 보고 「봤다」를 세우면 문서를 읽는 내내 완료가 조용히 지워진다.
//
// 분할이 그 반대쪽이다: 열 둘 중 하나가 터미널이면 그 셸은 **보고 있는 것**이다.
test("문서를 읽는 동안엔 안 꺼지고, 분할로 함께 보면 꺼진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  const tabs = page.locator('[data-tab="shell"]');
  const 초록 = await 토큰색(page, "--signal-done-soft");
  const 끝난다 = () =>
    markAttention(
      page,
      { agent: "claude", event: "SessionEnd", payload: { reason: "logout" } },
      1,
    );

  // 문서로 옮긴다 — 칸은 그대로 켜져 있고 본문만 바뀐다(주소에서 `tab`이 빠진다, 결정 14).
  await page.locator('[data-tab="spec"]').click();
  await expect(page).not.toHaveURL(/tab=terminal/);
  await 끝난다();
  // **안 꺼진다.** 켜진 칸이라는 이유로 지워지면 여기가 초록이 아니다.
  await expect
    .poll(() => 칸배경(page, 0), { message: "문서를 읽는 중인데 초록이 안 섰다" })
    .toBe(초록);

  // 분할을 켠다 — 열 하나가 터미널이라 그 셸은 보고 있는 것이다(결정 7).
  await page.locator('button[title="분할 켜기"]').click();
  await expect(page).toHaveURL(/split=/);
  await expect
    .poll(() => 칸배경(page, 0), { message: "분할로 보고 있는데 초록이 안 꺼졌다" })
    .not.toBe(초록);

  // 그리고 분할 중에 온 완료도 곧바로 봤다다 — 스토리 58이 알림 쪽에서 같은 말을 한다.
  await 끝난다();
  await expect(tabs.nth(0).locator("button[aria-pressed]")).not.toHaveAttribute(
    "aria-label",
    /확인할 것$/,
  );

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **포커스가 판정에 실제로 든다**(결정 7 · 스토리 10). 「봤다」는 켜진 칸과 창 포커스가
// **만나는** 순간인데, 한쪽(창 포커스)에는 지금까지 아무 그물도 없었다 — `windowFocused()`를
// `return true`로 바꿔도 L1~L4가 전부 초록이었다. 그 fail-open은 「초록이 안 뜬다」로만
// 나타나므로 화면에서 안 보인다.
//
// 헤드리스 WebKit은 배경 페이지에서도 `document.hasFocus()`가 참이라 진짜로 포커스를 뺏을
// 길이 없다(`stubWindowFocus` 머리말의 실측). 그래서 브라우저가 답하는 그 한 줄을 손으로
// 잡고 **앱이 그것을 딛는지**를 잰다.
test("창이 뒤에 있으면 초록이 안 꺼지고, 창이 앞으로 오면 그 순간 꺼진다", async ({ page }) => {
  await stubWindowFocus(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  const 초록 = await 토큰색(page, "--signal-done-soft");
  await setWindowFocused(page, false);
  await markAttention(
    page,
    { agent: "claude", event: "SessionEnd", payload: { reason: "logout" } },
    1,
  );

  // 그 셸을 **보고 있는데도** 안 꺼진다 — 창이 뒤에 있으면 사람이 본 것이 아니다.
  await expect
    .poll(() => 칸배경(page, 0), { message: "창이 뒤에 있는데 초록이 안 섰다" })
    .toBe(초록);

  // 값만 바꾸고 이벤트를 안 쏘면 화면은 그대로다 — 다시 재는 것은 리스너의 일이다.
  await setWindowFocused(page, true);
  expect(await 칸배경(page, 0), "이벤트 없이 초록이 꺼졌다").toBe(초록);

  // **알림을 눌러 돌아온 순간이 이것이다**(스토리 10) — 「알림이 왔는데 아무것도 없다」가
  // 아니라 「와서 봤다」로 읽히려면 그 순간 꺼져야 한다.
  await fireWindowEvent(page, "focus");
  await expect
    .poll(() => 칸배경(page, 0), { message: "창이 앞으로 왔는데 초록이 안 꺼졌다" })
    .not.toBe(초록);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **`blur`가 「봤다」를 세우는 길이 하나 있다** — 그 하나 때문에 그 리스너가 산다.
// 다른 앱을 보다가 분할된 화면의 spec 프레임을 **바로 눌러** 돌아오면, 포커스가 자식 문서로
// 들어가므로 부모 `window`에는 `focus` 없이 `blur`만 온다. 그때 창은 앞에 있다
// (`document.hasFocus()`가 참이고, SpecViewer의 `useFrameFocused`가 그 실측을 들고 있다).
// 이 줄이 없으면 눈앞의 셸이 다음 이벤트가 올 때까지 초록인 채로 남는다.
test("blur이 와도 창이 앞에 있으면 「봤다」다 — spec 프레임을 바로 누른 길", async ({ page }) => {
  await stubWindowFocus(page);
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toHaveCount(1);

  const 초록 = await 토큰색(page, "--signal-done-soft");
  await setWindowFocused(page, false);
  await markAttention(
    page,
    { agent: "claude", event: "SessionEnd", payload: { reason: "logout" } },
    1,
  );
  await expect
    .poll(() => 칸배경(page, 0), { message: "창이 뒤에 있는데 초록이 안 섰다" })
    .toBe(초록);

  // 앱이 앞으로 오면서 포커스가 프레임으로 들어간다 — 부모가 받는 것은 `blur` 하나다.
  await setWindowFocused(page, true);
  await fireWindowEvent(page, "blur");
  await expect
    .poll(() => 칸배경(page, 0), { message: "창이 앞에 있는데 blur에 초록이 안 꺼졌다" })
    .not.toBe(초록);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
