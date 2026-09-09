import { expect, test, type Page } from "./evidence";
import { ROOMS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 판 01 · 티켓 #184 — **두 세계의 최상위 터미널이 서로 다른 셸이다**(결정 10).
//
// **이 층에서만 보인다.** 아래 세 가지가 한 번에 있어야 이 물음이 서는데, 그것이 겹치는
// 자리가 여기뿐이다:
//   ① 진짜 세그먼트 클릭과 진짜 라우팅 — 마크업 seam(`TerminalPage.test.tsx`)은 화면 하나에
//      `mode`를 손으로 넘겨 그리고 어디로도 안 간다. 두 주소를 오가는 동안 무엇이 남는가는
//      그 층에 물음 자체가 없다.
//   ② **살아남는 스토어** — `terminal-store`는 화면 밖에 사는 싱글턴이고(결정 20·21) 셸이
//      화면 언마운트에 안 죽는다는 것이 이 판의 전제다. 그 성질은 라우트가 실제로 갈릴 때만
//      드러난다.
//   ③ **owner를 실제로 쓰는 화면 둘** — `shell-registry.test.ts`가 키의 대수(서로 다른
//      `(mode, slug)`는 다른 키)를 붙들지만, 그 키를 조회에도 쓰는지는 순수 함수가 못 본다.
//      `/terminal`과 `/maison/terminal`이 같은 컴포넌트라 `mode` 하나만 안 갈려도 두 세계가
//      한 목록을 나눠 쓰는데, L0도 L2도 그 화면을 두 번 그리지 않는다.
//
// **그리고 spawn 인자의 모드를 함께 읽는다.** 그것이 안 실리면 백엔드의 `or_atelier`가 조용히
// Atelier로 답해 Maison 셸이 저쪽 홈에서 뜨고 env도 `atelier`가 된다 — 화면에는 아무 오류도
// 안 난다. 「안 실렸다」는 픽스처 표가 문다(`FIXTURE_BY_MODE`의 `pty_spawn`); **어느 것이
// 실렸는지**는 그 표가 못 보므로 여기서 IPC 기록을 직접 읽는다. 그 값이 셸 env까지 정말
// 내려가는지는 `src-tauri/tests/top_terminal.rs`가 살아 있는 셸로 잰다.

/** 무선택 주소(`/maison/rooms`)가 정규화로 고르는 Room. 첫 줄은 초안이라 건너뛴다. */
const [, room] = ROOMS;

/** 세그먼트의 한 칸(`ModeSwitch`). `mode-switch.spec.ts`가 같은 규격으로 집는다. */
const modeButton = (page: Page, label: string) =>
  page.getByRole("group", { name: "모드 선택" }).getByRole("button", { name: label, exact: true });

/**
 * nav 한 행의 **상자**. 이름 버튼과 메타가 그 안에 형제로 서므로, 셸 수를 읽으려면 한 칸
 * 올라가야 한다(`works-sidebar.spec.ts`가 같은 자리를 그렇게 짚는다).
 */
const navRow = (page: Page, label: string) =>
  page.locator("nav").getByRole("button", { name: label, exact: true }).locator("xpath=..");

/**
 * 지금까지 나간 `pty_spawn`의 **모드를 부른 순서대로**. 인자에 모드가 없으면 그 호출을
 * 통째로 남긴다 — `undefined`로 접으면 「안 실렸다」와 「못 읽었다」가 같은 얼굴이 된다.
 *
 * 기록에서 읽는 것은 이 층에 다른 길이 없어서다: 픽스처의 답은 두 모드가 같아(그것이 실물
 * 그대로다) 답으로는 무엇이 실렸는지 갈리지 않는다. `terminal-fill.spec.ts`가 격자(`rows`)를
 * 같은 방식으로 캐낸다.
 */
async function spawnedModes(page: Page): Promise<string[]> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  return calls
    .filter((call) => call.startsWith("pty_spawn "))
    .map((call) => /"mode":"([^"]*)"/.exec(call)?.[1] ?? `(모드가 없다: ${call})`);
}

test("두 세계의 Terminal은 서로 다른 셸이고, 갈았다 돌아와도 그대로 돈다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");

  const tabs = page.locator('[data-tab="shell"]');
  // 들어오면 하나가 뜬다(`ensureShell`). **한 칸 더 연다** — 저쪽과 수가 같으면 소유자가
  // 통째로 섞여도 두 화면이 똑같아 보여서, 아래 단언이 무엇을 봐도 초록이 된다.
  await expect(tabs).toHaveCount(1);
  await page.locator('[data-tab="new"]').click();
  await expect(tabs).toHaveCount(2);
  // 사이드바도 같은 수를 말한다. 이 숫자는 `ownerOf(mode)`로 세므로(`Sidebar`의 `topShells`)
  // 화면과 사이드바가 각자 소유자를 지으면 여기서 갈린다.
  await expect(navRow(page, "Terminal")).toContainText("2");

  // 둘 다 이 세계로 나갔다. **`toEqual`로 통째로 견준다** — 「하나는 atelier였다」로 좁히면
  // 나머지 하나가 모드 없이 나가도 통과한다.
  await expect.poll(() => spawnedModes(page)).toEqual(["atelier", "atelier"]);
  const beforeCrossing = (await spawnedModes(page)).length;

  // ── 저쪽 세계로 ──
  // 세그먼트는 그 세계의 **첫 화면**으로 데려간다(아직 Maison에 가 본 적이 없다) — 거기서
  // nav로 터미널까지 간다. 주소를 직접 치면 페이지가 새로 뜨면서 스토어가 통째로 비어,
  // 이 검사가 재려는 「살아남는가」가 사라진다.
  await modeButton(page, "Maison").click();
  await expect(page).toHaveURL(`/maison/rooms/${room.slug}`);
  await page.locator("nav").getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page).toHaveURL("/maison/terminal");

  // **저쪽 셸이 이쪽 수에 안 섞인다.** 2가 아니라 1이다 — 이 화면은 `maison:`만 조회하고,
  // 그 목록이 비어 있어 들어오는 순간 이 세계의 첫 셸이 뜬다. 소유자가 안 갈렸다면 여기
  // 두 칸이 그대로 서 있고 새 셸도 안 떴을 것이다.
  await expect(tabs).toHaveCount(1);
  await expect(navRow(page, "Terminal")).toContainText("1");

  // 그리고 **건너온 뒤로 나간 spawn은 전부 Maison의 것이다.** 수를 안 세는 것은 지나온
  // Room 화면이 언젠가 셸을 열 수 있어서다(분할이면 본문에 터미널 열이 함께 선다 — 결정 87.
  // 지금은 `split`이 주소에 없어 안 열린다) — 그것도 이 세계의 것이라 답은 그대로다.
  // 비어 있으면 `[]`가 되어 함께 빨개진다 — 저쪽에서 아무것도 안 떴다는 것도 실패다.
  await expect
    .poll(async () => [...new Set((await spawnedModes(page)).slice(beforeCrossing))])
    .toEqual(["maison"]);
  const afterCrossing = (await spawnedModes(page)).length;

  // ── 돌아온다 ──
  // 마지막 주소를 기억하므로(`modeSwitchTarget`) 곧장 최상위 터미널로 온다.
  await modeButton(page, "Atelier").click();
  await expect(page).toHaveURL("/terminal");

  // **두 칸이 그대로다.** 여기가 1이면 저쪽에 다녀온 것만으로 이쪽 셸이 사라진 것이고,
  // 3이면 저쪽 셸이 이쪽 목록에 얹힌 것이다.
  await expect(tabs).toHaveCount(2);
  await expect(navRow(page, "Terminal")).toContainText("2");
  // 붙어 있던 xterm이 다시 자리에 든다(`attachShell`) — 「목록에는 있는데 화면에는 없다」가
  // 여기서 갈린다.
  await expect(page.locator(".xterm-screen")).toBeVisible();

  // **죽지도 새로 뜨지도 않았다.** 수만 맞으면 「돌아올 때마다 새로 띄운다」도 2가 되므로,
  // 그 사이 spawn이 하나도 안 늘었다는 것을 함께 본다. kill은 이 시나리오 전체에서 0이다 —
  // 화면을 옮기는 것만으로는 안 죽인다(결정 20)가 그 문장의 관찰 가능한 형태다.
  expect(await spawnedModes(page)).toHaveLength(afterCrossing);
  const calls = (await readIpcRecord(page))?.calls ?? [];
  expect(calls.filter((call) => call.startsWith("pty_kill"))).toEqual([]);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
