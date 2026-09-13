import { expect, test, type Page } from "./evidence";
import { PROJECTS, ROOMS, WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// 목록의 첫 줄은 초안 Room이고, 무선택 주소(`/maison/rooms`)의 정규화가 고르는 것도 그 첫 줄이다
// — 초안이어도 건너뛰지 않는다(UI개선 결정 6, `fixtures.ts`의 `ROOMS` 머리말). 세그먼트가 데려다
// 놓는 자리가 그 첫 줄이다.
const [draft, room] = ROOMS;
// 출발점. `/projects`도 무선택 주소라 첫 프로젝트로 정규화된다 — 뒤로가기가 돌아올 자리를
// 못박으려면 그 정규화가 끝난 주소를 알아야 한다.
const [project] = PROJECTS;

/**
 * 세그먼트의 한 칸. `role="group"` + `aria-label="모드 선택"` 안의 두 버튼이다(`ModeSwitch`).
 * 그룹으로 좁히는 것은 `Atelier`·`Maison`이 앞으로 다른 자리(팔레트·설정)에도 적힐 수 있어서다.
 */
const modeButton = (page: Page, label: string) =>
  page.getByRole("group", { name: "모드 선택" }).getByRole("button", { name: label, exact: true });

// 세그먼트 한 번에 **사이드바가 통째로** 저쪽 세계가 된다.
//
// **이 층에서만 보인다.** 마크업 seam(`ModeSwitch.test.tsx`·`SidebarWorkList.test.tsx`)은 각
// 조각에 `mode`를 손으로 넘겨 그리고, 라우터 테스트(`router.test.ts`)는 목적지와 히스토리 칸수만
// 센다 — 「누른 것이 실제로 그 목적지로 이어지고, 도착한 화면의 nav·목록·데이터가 **함께**
// 갈렸는가」는 진짜 클릭과 진짜 IPC가 있어야 한 번에 드러난다. 세 자리 중 하나만 모드를
// 빠뜨려도 앞의 두 층은 그대로 초록이다.
test("세그먼트를 누르면 사이드바가 통째로 저쪽 세계가 된다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");
  await expect(page).toHaveURL(`/projects/${project.slug}`);
  await expect(modeButton(page, "Atelier")).toHaveAttribute("aria-pressed", "true");

  await modeButton(page, "Maison").click();

  // 목적지는 그 세계의 **첫 화면**이다 — 아직 Maison에 가 본 적이 없어 기억할 마지막 주소가
  // 없다(`modeSwitchTarget`). 그 첫 화면이 무선택 주소라 도착하자마자 한 번 더 정규화된다.
  await expect(page).toHaveURL(`/maison/rooms/${draft.slug}`);
  await expect(modeButton(page, "Maison")).toHaveAttribute("aria-pressed", "true");

  // nav가 **둘**이다. `Projects`가 없는 것은 빠뜨린 게 아니라 이 세계에 프로젝트가 없기
  // 때문이고(결정 17), 그 사실이 화면에 남는 유일한 자리가 여기다. 개수까지 세는 것은
  // 「`Terminal`·`Archive`가 있다」만으로는 Atelier 배열이 그대로 그려져도 초록이라서다.
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("button")).toHaveCount(2);
  await expect(nav.getByRole("button", { name: "Terminal", exact: true })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Archive", exact: true })).toBeVisible();

  const aside = page.locator("aside");
  // 상주 목록의 머리가 `Rooms`다. 접근성 이름에 개수가 함께 들어간다 — 라벨과 옅은 숫자가
  // 같은 버튼 안이다(`works-sidebar.spec.ts`의 `MAIN_HEADER`와 같은 규격). 초안도 이 구획에
  // 서므로(UI개선 결정 5) 두 Room이 다 수에 든다.
  await expect(
    aside.getByRole("button", { name: `Rooms ${ROOMS.length}`, exact: true }),
  ).toBeVisible();
  await expect(aside.getByRole("button", { name: /^작업 \d+$/ })).toHaveCount(0);

  // 그리고 그 목록에 **정말 이 세계의 것**이 서 있다. 반대쪽 증거(Atelier work이 없다)가
  // 함께 있어야 한다: 프런트가 한 자리에서 **저쪽 세계의 값**을 실으면 그것은 어디서도
  // 오류가 아니라(#187이 닫은 것은 빠뜨린 호출이지 틀린 값이 아니다), 머리만 `Rooms`이고
  // 줄은 저쪽 것인 화면이 된다.
  for (const one of ROOMS) {
    await expect(aside.getByRole("button", { name: one.title, exact: true })).toBeVisible();
  }
  for (const work of WORKS) {
    await expect(aside.getByRole("button", { name: work.title, exact: true })).toHaveCount(0);
  }

  // 뒤로가기 **한 번**이면 이쪽으로 돌아온다 — 정규화는 REPLACE라 칸을 안 늘리므로 세계를
  // 건너며 쌓인 칸은 하나다. 두 칸이 쌓였다면 여기서 `/maison/rooms`에 머물러 걸린다.
  await page.goBack();
  await expect(page).toHaveURL(`/projects/${project.slug}`);
  await expect(modeButton(page, "Atelier")).toHaveAttribute("aria-pressed", "true");
  await expect(nav.getByRole("button", { name: "Projects", exact: true })).toBeVisible();
  await expect(aside.getByRole("button", { name: WORKS[1].title, exact: true })).toBeVisible();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// `/settings`에는 모드 접두사가 없어 **주소만 보면 언제나 Atelier다**(`modeOf`). 그 기본값이
// 그대로 화면에 나오면 Maison에서 설정을 한 번 여는 것만으로 세그먼트가 저쪽으로 튀고, 거기서
// nav를 누르면 세계를 건넌다. 셸이 마지막 모드를 얹어 읽는 것(`shellMode`)이 **브라우저에서**
// 실제로 도는지는 여기서만 보인다 — 그 합성은 저장소(`last-mode`)를 거치고, 저장소가 진짜인
// 층이 이 층이다.
test("설정 화면에서도 세그먼트는 떠나온 세계를 켠다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/maison/rooms/${room.slug}`);
  await expect(modeButton(page, "Maison")).toHaveAttribute("aria-pressed", "true");

  await page.locator("aside").getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL("/settings");

  await expect(modeButton(page, "Maison")).toHaveAttribute("aria-pressed", "true");
  await expect(modeButton(page, "Atelier")).toHaveAttribute("aria-pressed", "false");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 목록이 저쪽 세계의 것을 들고 있어도 **행이 가는 곳**은 따로 되돌아갈 수 있다. `routesOf(mode)`
// 대신 `/works/$slug`를 다시 적어 보면 — L0는 그 필드의 타입이 두 주소의 유니온이라 통과하고,
// 마크업 seam은 행의 `onOpen`이 목업이라 목적지를 아예 안 보고, `SidebarWorkList.test.tsx`의
// 리터럴 검사만 빨개진다. **정말 눌러 보는 자리는 여기뿐이다** — 그 되돌림이 살아 있으면
// Maison에서 Room을 누를 때마다 `/works/<slug>`로 가서 nav도 목록도 통째로 Atelier가 된다.
//
// 지금 서 있는 Room이 아닌 줄(`Rooms` 첫 줄의 초안)을 누른다 — 같은 줄을 누르면 주소가 안
// 움직인 것과 「아무 일도 안 일어났다」가 구분되지 않는다.
test("Maison에서 Room 행을 누르면 Maison 안에 머문다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/maison/rooms/${room.slug}`);
  await expect(page).toHaveURL(`/maison/rooms/${room.slug}`);

  // 한때 여기서 접힌 초안 구획을 먼저 폈다. 초안이 `Rooms` 안에 서면서(UI개선 결정 5) 펼 머리가
  // 없다 — 초안 행이 다른 Room과 같은 자리에서 곧장 눌린다.
  const aside = page.locator("aside");

  await aside.getByRole("button", { name: draft.title, exact: true }).click();
  await expect(page).toHaveURL(`/maison/rooms/${draft.slug}`);

  expect(await unknownIpcCalls(page)).toEqual([]);
});
